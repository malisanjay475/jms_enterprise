'use strict';

// JMS Chat extras (MAIN and LOCAL each keep their own; these tables are not synced):
//  * reactions  (chat_reactions)   one emoji per person per message, live to the chat
//  * starred    (chat_stars)       a person's saved messages
//  * pin / archive (chat_user_prefs) per person per chat
//  * message info: who it was delivered to / read by, with times (from chat_receipts)
//  * forward: copies a message (text, shared link or file) into up to 5 chats

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FORWARD = 5;
const MAX_EMOJI = 16;

let schemaReady = null;
function ensureExtrasSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_reactions (
        message_sync_id UUID NOT NULL,
        conversation_sync_id UUID NOT NULL,
        username_lower TEXT NOT NULL,
        username TEXT NOT NULL,
        emoji TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_sync_id, username_lower)
      );
      CREATE TABLE IF NOT EXISTS chat_stars (
        username_lower TEXT NOT NULL,
        message_sync_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (username_lower, message_sync_id)
      );
      CREATE TABLE IF NOT EXISTS chat_user_prefs (
        username_lower TEXT NOT NULL,
        conversation_sync_id UUID NOT NULL,
        pinned_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        PRIMARY KEY (username_lower, conversation_sync_id)
      );
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

/** message id -> [{ emoji, users: [..] }] (most used first). */
async function reactionsFor(pool, messageIds) {
  const out = new Map();
  if (!messageIds.length) return out;
  await ensureExtrasSchema(pool);
  const { rows } = await pool.query(
    'SELECT message_sync_id, emoji, username FROM chat_reactions WHERE message_sync_id = ANY($1::uuid[]) ORDER BY updated_at',
    [messageIds]
  );
  for (const r of rows) {
    if (!out.has(r.message_sync_id)) out.set(r.message_sync_id, new Map());
    const byEmoji = out.get(r.message_sync_id);
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji).push(r.username);
  }
  const result = new Map();
  for (const [id, byEmoji] of out) {
    result.set(id, [...byEmoji].map(([emoji, users]) => ({ emoji, users })).sort((a, b) => b.users.length - a.users.length));
  }
  return result;
}

/** Set of message ids this user starred (among these). */
async function starredAmong(pool, username, messageIds) {
  if (!username || !messageIds.length) return new Set();
  await ensureExtrasSchema(pool);
  const { rows } = await pool.query(
    'SELECT message_sync_id FROM chat_stars WHERE username_lower = LOWER($1) AND message_sync_id = ANY($2::uuid[])',
    [username, messageIds]
  );
  return new Set(rows.map((r) => r.message_sync_id));
}

/** conversation id -> { pinned_at, archived_at } for this user. */
async function prefsFor(pool, username) {
  await ensureExtrasSchema(pool);
  const { rows } = await pool.query(
    'SELECT conversation_sync_id, pinned_at, archived_at FROM chat_user_prefs WHERE username_lower = LOWER($1)', [username]
  );
  return new Map(rows.map((r) => [r.conversation_sync_id, r]));
}

function registerExtrasRoutes(app, pool, h) {
  const { ready, fail, membership, decorate, sendRateOk, localFactoryId, uploadRoot } = h;

  async function messageInMyChat(req, res) {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) { res.status(400).json({ ok: false, error: 'Bad message id.' }); return null; }
    const { rows: [m] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [id]);
    if (!m || m.kind === 'system') { res.status(404).json({ ok: false, error: 'Message not found.' }); return null; }
    if (!(await membership(pool, m.conversation_sync_id, req.auth.username))) {
      res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      return null;
    }
    return m;
  }

  // ---- reactions ----
  app.post('/api/chat/messages/:id/react', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureExtrasSchema(pool);
      const m = await messageInMyChat(req, res);
      if (!m) return;
      if (m.deleted_at) return res.status(410).json({ ok: false, error: 'This message was deleted.' });
      const emoji = String((req.body && req.body.emoji) || '').trim();
      if (emoji.length > MAX_EMOJI || /[<>\s]/.test(emoji)) return res.status(400).json({ ok: false, error: 'Pick one emoji.' });
      const me = req.auth.username;
      if (!emoji) {
        await pool.query('DELETE FROM chat_reactions WHERE message_sync_id = $1 AND username_lower = LOWER($2)', [m.sync_id, me]);
      } else {
        await pool.query(
          `INSERT INTO chat_reactions (message_sync_id, conversation_sync_id, username_lower, username, emoji)
           VALUES ($1, $2, LOWER($3), $3, $4)
           ON CONFLICT (message_sync_id, username_lower) DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = NOW()`,
          [m.sync_id, m.conversation_sync_id, me, emoji]
        );
      }
      const reactions = (await reactionsFor(pool, [m.sync_id])).get(m.sync_id) || [];
      // every worker tells its own streams (see onNote in registerChatRoutes)
      await pool.query("SELECT pg_notify('jms_chat', $1)",
        [JSON.stringify({ t: 'reaction', c: m.conversation_sync_id, m: m.sync_id, e: true })]);
      res.json({ ok: true, reactions });
    } catch (err) { fail(res, err, 'react'); }
  });

  // ---- message info ----
  app.get('/api/chat/messages/:id/info', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const m = await messageInMyChat(req, res);
      if (!m) return;
      const { rows } = await pool.query(
        `SELECT mb.username, r.delivered_at, r.read_at
           FROM chat_members mb
           LEFT JOIN chat_receipts r ON r.message_sync_id = $1 AND LOWER(r.username) = LOWER(mb.username)
          WHERE mb.conversation_sync_id = $2 AND mb.left_at IS NULL AND LOWER(mb.username) <> LOWER($3)
          ORDER BY r.read_at NULLS LAST, r.delivered_at NULLS LAST, LOWER(mb.username)`,
        [m.sync_id, m.conversation_sync_id, m.sender]
      );
      res.json({
        ok: true,
        sent_at: m.server_ts,
        read: rows.filter((r) => r.read_at).map((r) => ({ username: r.username, at: r.read_at })),
        delivered: rows.filter((r) => r.delivered_at && !r.read_at).map((r) => ({ username: r.username, at: r.delivered_at })),
        pending: rows.filter((r) => !r.delivered_at).map((r) => ({ username: r.username }))
      });
    } catch (err) { fail(res, err, 'message info'); }
  });

  // ---- starred ----
  app.post('/api/chat/messages/:id/star', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureExtrasSchema(pool);
      const m = await messageInMyChat(req, res);
      if (!m) return;
      const on = !(req.body && req.body.on === false);
      if (on) {
        await pool.query(
          'INSERT INTO chat_stars (username_lower, message_sync_id) VALUES (LOWER($1), $2) ON CONFLICT DO NOTHING',
          [req.auth.username, m.sync_id]
        );
      } else {
        await pool.query('DELETE FROM chat_stars WHERE username_lower = LOWER($1) AND message_sync_id = $2', [req.auth.username, m.sync_id]);
      }
      res.json({ ok: true, starred: on });
    } catch (err) { fail(res, err, 'star'); }
  });

  app.get('/api/chat/starred', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureExtrasSchema(pool);
      const me = req.auth.username;
      const { rows } = await pool.query(
        `SELECT x.*, c.type AS conv_type, c.title AS conv_title,
                (SELECT array_agg(m2.username) FROM chat_members m2
                  WHERE m2.conversation_sync_id = c.sync_id AND m2.left_at IS NULL) AS members
           FROM chat_stars s
           JOIN chat_messages x ON x.sync_id = s.message_sync_id
           JOIN chat_conversations c ON c.sync_id = x.conversation_sync_id
           JOIN chat_members me ON me.conversation_sync_id = x.conversation_sync_id
                               AND LOWER(me.username) = LOWER($1) AND me.left_at IS NULL
          WHERE s.username_lower = LOWER($1)
          ORDER BY s.created_at DESC LIMIT 200`,
        [me]
      );
      const msgs = await decorate(pool, rows, me);
      res.json({
        ok: true,
        results: rows.map((r, i) => {
          const others = (r.members || []).filter((u) => u.toLowerCase() !== me.toLowerCase());
          return { message: msgs[i], conversation_title: r.conv_type === 'group' ? (r.conv_title || 'Group') : (others[0] || me) };
        })
      });
    } catch (err) { fail(res, err, 'starred'); }
  });

  // ---- pin / archive ----
  for (const what of ['pin', 'archive']) {
    app.post(`/api/chat/conversations/:id/${what}`, async (req, res) => {
      try {
        if (!(await ready(req, res))) return;
        await ensureExtrasSchema(pool);
        const convId = String(req.params.id || '');
        if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
        if (!(await membership(pool, convId, req.auth.username))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
        const on = !(req.body && req.body.on === false);
        const col = what === 'pin' ? 'pinned_at' : 'archived_at';
        if (on && what === 'pin') {
          const { rows: [n] } = await pool.query(
            'SELECT COUNT(*)::int AS n FROM chat_user_prefs WHERE username_lower = LOWER($1) AND pinned_at IS NOT NULL AND conversation_sync_id <> $2',
            [req.auth.username, convId]
          );
          if (n.n >= 3) return res.status(400).json({ ok: false, error: 'You can pin up to 3 chats.' });
        }
        await pool.query(
          `INSERT INTO chat_user_prefs (username_lower, conversation_sync_id, ${col}) VALUES (LOWER($1), $2, ${on ? 'NOW()' : 'NULL'})
           ON CONFLICT (username_lower, conversation_sync_id) DO UPDATE SET ${col} = EXCLUDED.${col}`,
          [req.auth.username, convId]
        );
        res.json({ ok: true, [what === 'pin' ? 'pinned' : 'archived']: on });
      } catch (err) { fail(res, err, what); }
    });
  }

  // ---- forward ----
  app.post('/api/chat/forward', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const b = req.body || {};
      req.params.id = String(b.message_sync_id || '');
      const src = await messageInMyChat(req, res);
      if (!src) return;
      if (src.deleted_at || src.purged_at) return res.status(410).json({ ok: false, error: 'This message was deleted.' });
      const targets = [...new Set((Array.isArray(b.to) ? b.to : []).map(String))].filter((t) => UUID_RE.test(t));
      if (!targets.length) return res.status(400).json({ ok: false, error: 'Pick a chat to forward to.' });
      if (targets.length > MAX_FORWARD) return res.status(400).json({ ok: false, error: `Forward to at most ${MAX_FORWARD} chats at a time.` });
      for (const t of targets) {
        if (!(await membership(pool, t, me))) return res.status(403).json({ ok: false, error: 'You are not in one of those chats.' });
      }
      if (!sendRateOk(me.toLowerCase())) return res.status(429).json({ ok: false, error: 'You are sending too fast. Please wait a moment.' });
      const { rows: [att] } = await pool.query('SELECT * FROM chat_attachments WHERE message_sync_id = $1', [src.sync_id]);
      const meta = Object.assign({}, src.kind === 'link' ? (src.meta || {}) : {}, { forwarded: true });
      const sent = [];
      for (const t of targets) {
        const client = await pool.connect();
        let copied = null;
        try {
          await client.query('BEGIN');
          const id = crypto.randomUUID();
          const { rows: [row] } = await client.query(
            `INSERT INTO chat_messages (sync_id, conversation_sync_id, sender, body, kind, meta, factory_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [id, t, me, src.body || '', src.kind, JSON.stringify(meta), localFactoryId()]
          );
          if (att) {
            const ext = path.extname(att.storage_name);
            const month = new Date().toISOString().slice(0, 7);
            const storageName = `${month}/${crypto.randomUUID()}${ext}`;
            await fs.promises.mkdir(path.join(uploadRoot, month), { recursive: true });
            await fs.promises.copyFile(path.join(uploadRoot, att.storage_name), path.join(uploadRoot, storageName));
            copied = path.join(uploadRoot, storageName);
            await client.query(
              `INSERT INTO chat_attachments (message_sync_id, conversation_sync_id, kind, mime, file_name,
                                             size_bytes, storage_name, uploaded_by, factory_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [id, t, att.kind, att.mime, att.file_name, att.size_bytes, storageName, me, localFactoryId()]
            );
          }
          await client.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [t, row.server_ts]);
          await client.query(
            'UPDATE chat_members SET last_read_at = $3, updated_at = NOW() WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2)',
            [t, me, row.server_ts]
          );
          await client.query('COMMIT');
          sent.push(row);
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          if (copied) fs.promises.unlink(copied).catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }
      res.json({ ok: true, messages: await decorate(pool, sent, me) });
    } catch (err) { fail(res, err, 'forward'); }
  });
}

module.exports = { ensureExtrasSchema, reactionsFor, starredAmong, prefsFor, registerExtrasRoutes, MAX_FORWARD };
