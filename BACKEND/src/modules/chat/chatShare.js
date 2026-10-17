'use strict';

// JMS Chat: "Share to chat" (deep links to a spot in JMS, with a work status) and
// WhatsApp-style replies.
//
//  * A shared problem is a chat message of kind 'link' whose `meta` holds
//    { url, title, factory_id, locator, excerpt, priority }. The url is always a
//    same-origin relative path (/page.html?...#...): never absolute, protocol-relative,
//    javascript: or with backslashes. Opening it goes through that page's own
//    permissions; chat grants nothing.
//  * Work status lives in chat_tasks, one row per link message, keyed by a sync_id
//    derived from the message (both servers write the same row), last write wins, and
//    replicated by the chat sync like the other chat tables. Start work / Mark done also
//    post a system line that replies to the shared message.
//  * Replies: reply_to_sync_id must point at a message in the same chat. The quoted
//    message (sender, one line, kind, thumbnail id) comes back with every message.

const crypto = require('crypto');
const chatSync = require('./chatSync');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TARGETS = 20;
const STATUSES = { open: 'Open', in_progress: 'In progress', done: 'Done' };
const TASK_ID = (msg) => chatSync.deterministicIdSql('chat-task', msg);

async function ensureShareSchema(pool) {
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('jms_chat_schema'));
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta JSONB;
    CREATE INDEX IF NOT EXISTS idx_chat_messages_reply ON chat_messages (reply_to_sync_id) WHERE reply_to_sync_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS chat_tasks (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL UNIQUE,
      message_sync_id UUID NOT NULL UNIQUE,
      conversation_sync_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      updated_by TEXT,
      factory_id INTEGER,
      sync_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_tasks_conv ON chat_tasks (conversation_sync_id);
  `);
}

// ---- link validation ----
function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// A same-origin relative URL, or null. Returned normalised: path + query + hash.
function safeRelativeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\u0000-\u001f\s]/.test(s) || s.length > 1500) return null;
  let u;
  try { u = new URL(s, 'http://jms.invalid'); } catch (_e) { return null; }
  if (u.origin !== 'http://jms.invalid') return null;
  if (/^\/api\//i.test(u.pathname)) return null; // pages only, never API calls
  return u.pathname + u.search + u.hash;
}

function cleanLocator(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const out = {};
  if (loc.id) out.id = cleanText(loc.id, 120);
  if (loc.data && typeof loc.data === 'object') {
    out.data = {};
    for (const [k, v] of Object.entries(loc.data).slice(0, 6)) {
      if (/^data-[a-z0-9_-]{1,40}$/i.test(k)) out.data[k] = cleanText(v, 120);
    }
  }
  if (loc.path) out.path = cleanText(loc.path, 400);
  if (loc.text) out.text = cleanText(loc.text, 160);
  if (loc.tag) out.tag = cleanText(loc.tag, 20).toLowerCase();
  if (Array.isArray(loc.codes)) out.codes = loc.codes.slice(0, 6).map((c) => cleanText(c, 40)).filter(Boolean);
  return Object.keys(out).length ? out : null;
}

// Validated link meta, or { error }.
function cleanLinkMeta(link, priority) {
  const url = safeRelativeUrl(link && link.url);
  if (!url) return { error: 'Only links to pages of this JMS site can be shared.' };
  const fid = link.factory_id == null || link.factory_id === '' ? null : parseInt(link.factory_id, 10);
  return {
    meta: {
      url,
      title: cleanText(link.title, 120) || url.split('?')[0],
      factory_id: Number.isFinite(fid) ? fid : null,
      factory_name: cleanText(link.factory_name, 80) || null,
      locator: cleanLocator(link.locator),
      excerpt: cleanText(link.excerpt, 300),
      priority: priority === 'urgent' ? 'urgent' : 'normal'
    }
  };
}

// ---- replies ----
async function validReplyTarget(pool, convId, replyId) {
  if (!replyId) return null;
  if (!UUID_RE.test(String(replyId))) return undefined;
  const { rows: [r] } = await pool.query(
    'SELECT sync_id FROM chat_messages WHERE sync_id = $1 AND conversation_sync_id = $2', [replyId, convId]
  );
  return r ? r.sync_id : undefined;
}

function oneLine(row) {
  if (row.deleted_at || row.purged_at) return '';
  const label = { image: '📷 Photo', pdf: '📄 PDF', xlsx: '📊 Excel file', audio: '🎤 Audio' }[row.kind];
  if (row.kind === 'link') return `🔗 ${(row.meta && row.meta.title) || 'Shared page'}${row.body ? ': ' + row.body : ''}`;
  const text = String(row.body || '').replace(/\s+/g, ' ').trim();
  return (label ? (text ? `${label}: ${text}` : label) : text).slice(0, 140);
}

// Adds reply quotes, link meta and task status to messageOut() results (same order).
async function decorateShare(pool, rows, outs) {
  const replyIds = [...new Set(rows.map((r) => r.reply_to_sync_id).filter(Boolean))];
  const linkIds = rows.filter((r) => r.kind === 'link').map((r) => r.sync_id);
  const quotes = new Map();
  if (replyIds.length) {
    const { rows: qs } = await pool.query(
      `SELECT x.sync_id, x.sender, x.body, x.kind, x.meta, x.deleted_at, x.purged_at, a.sync_id AS att_id
         FROM chat_messages x LEFT JOIN chat_attachments a ON a.message_sync_id = x.sync_id AND x.kind = 'image'
        WHERE x.sync_id = ANY($1::uuid[])`, [replyIds]
    );
    for (const q of qs) {
      quotes.set(q.sync_id, {
        sync_id: q.sync_id, sender: q.sender, kind: q.kind, text: oneLine(q),
        deleted: Boolean(q.deleted_at || q.purged_at), image: q.att_id && !q.deleted_at && !q.purged_at ? q.att_id : null
      });
    }
  }
  const tasks = new Map();
  if (linkIds.length) {
    const { rows: ts } = await pool.query(
      'SELECT message_sync_id, status, updated_by, updated_at FROM chat_tasks WHERE message_sync_id = ANY($1::uuid[])', [linkIds]
    );
    for (const t of ts) tasks.set(t.message_sync_id, { status: t.status, by: t.updated_by, at: t.updated_at });
  }
  rows.forEach((r, i) => {
    const o = outs[i];
    if (!o) return;
    if (r.reply_to_sync_id) {
      o.reply_to = quotes.get(r.reply_to_sync_id) || { sync_id: r.reply_to_sync_id, deleted: true, text: '', sender: '' };
    }
    if (r.kind === 'link') {
      o.link = r.deleted_at || r.purged_at ? null : (r.meta || null);
      o.task = tasks.get(r.sync_id) || { status: 'open' };
    }
  });
  return outs;
}

// ---- routes ----
function registerShareRoutes(app, pool, h) {
  const { ready, membership, fail, decorate, sendRateOk, localFactoryId, activeUser, dmIdSql, memberIdSql } = h;

  async function openDirect(me, other) {
    const key = [me.toLowerCase(), other.toLowerCase()].sort().join('|');
    await pool.query(
      `INSERT INTO chat_conversations (sync_id, type, dm_key, created_by, factory_id)
       VALUES (${dmIdSql}, 'direct', $1, $2, $3) ON CONFLICT DO NOTHING`, [key, me, localFactoryId()]
    );
    const { rows: [conv] } = await pool.query('SELECT sync_id FROM chat_conversations WHERE dm_key = $1', [key]);
    for (const name of [me, other]) {
      await pool.query(
        `INSERT INTO chat_members (sync_id, conversation_sync_id, username, factory_id)
         VALUES (${memberIdSql}, $1, $2, $3)
         ON CONFLICT (conversation_sync_id, (LOWER(username)))
         DO UPDATE SET left_at = NULL, updated_at = NOW() WHERE chat_members.left_at IS NOT NULL`,
        [conv.sync_id, name, localFactoryId()]
      );
    }
    return conv.sync_id;
  }

  async function insertMessage(db, { convId, me, body, kind, meta, replyTo }) {
    const { rows: [row] } = await db.query(
      `INSERT INTO chat_messages (sync_id, conversation_sync_id, sender, body, kind, meta, reply_to_sync_id, factory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [crypto.randomUUID(), convId, me, body, kind, meta ? JSON.stringify(meta) : null, replyTo || null, localFactoryId()]
    );
    await db.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [convId, row.server_ts]);
    if (kind !== 'system') {
      await db.query(
        `UPDATE chat_members SET last_read_at = $3, updated_at = NOW()
          WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2)`, [convId, me, row.server_ts]
      );
    }
    return row;
  }

  // Share a marked spot to people and/or chats:
  // { users: [...], conversations: [sync_id...], note, priority, link: { url, title, factory_id, locator, excerpt } }
  app.post('/api/chat/share', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const b = req.body || {};
      const { meta, error } = cleanLinkMeta(b.link || {}, b.priority);
      if (error) return res.status(400).json({ ok: false, error });
      const note = String(b.note || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
      const users = [...new Set((Array.isArray(b.users) ? b.users : []).map((u) => String(u || '').trim()).filter(Boolean))];
      const convs = [...new Set((Array.isArray(b.conversations) ? b.conversations : []).filter((c) => UUID_RE.test(String(c))))];
      if (!users.length && !convs.length) return res.status(400).json({ ok: false, error: 'Pick at least one person or chat.' });
      if (users.length + convs.length > MAX_TARGETS) {
        return res.status(400).json({ ok: false, error: `Share with at most ${MAX_TARGETS} people or chats at once.` });
      }
      const targets = [];
      for (const u of users) {
        const other = await activeUser(pool, u);
        if (!other || other.toLowerCase() === me.toLowerCase()) continue;
        targets.push(await openDirect(me, other));
      }
      for (const c of convs) if (await membership(pool, c, me)) targets.push(c);
      const unique = [...new Set(targets)];
      if (!unique.length) return res.status(400).json({ ok: false, error: 'None of those people or chats can receive it.' });
      if (!sendRateOk(me.toLowerCase())) return res.status(429).json({ ok: false, error: 'You are sending too fast. Please wait a moment.' });
      const sent = [];
      for (const convId of unique) {
        const row = await insertMessage(pool, { convId, me, body: note, kind: 'link', meta });
        await pool.query(
          `INSERT INTO chat_tasks (sync_id, message_sync_id, conversation_sync_id, status, updated_by, factory_id)
           VALUES (${TASK_ID('$1::uuid')}, $1, $2, 'open', $3, $4) ON CONFLICT (message_sync_id) DO NOTHING`,
          [row.sync_id, convId, me, localFactoryId()]
        );
        sent.push({ conversation_sync_id: convId, message_sync_id: row.sync_id });
      }
      res.json({ ok: true, sent });
    } catch (err) { fail(res, err, 'share'); }
  });

  // One message (the page a shared link opens loads it to show the banner).
  app.get('/api/chat/messages/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad message id.' });
      const { rows } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [id]);
      if (!rows[0]) return res.status(404).json({ ok: false, error: 'Message not found.' });
      if (!(await membership(pool, rows[0].conversation_sync_id, req.auth.username))) {
        return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      }
      const [out] = await decorate(pool, rows, req.auth.username);
      res.json({ ok: true, message: out });
    } catch (err) { fail(res, err, 'message'); }
  });

  // Start work / Mark done / Reopen on a shared link: { status: 'in_progress' | 'done' | 'open' }
  app.post('/api/chat/tasks/:messageId', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const id = String(req.params.messageId || '');
      const status = String((req.body && req.body.status) || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad message id.' });
      if (!STATUSES[status]) return res.status(400).json({ ok: false, error: 'Status must be open, in_progress or done.' });
      const { rows: [m] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [id]);
      if (!m || m.kind !== 'link' || m.deleted_at || m.purged_at) return res.status(404).json({ ok: false, error: 'Shared item not found.' });
      if (!(await membership(pool, m.conversation_sync_id, me))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const { rows: [t] } = await pool.query(
        `INSERT INTO chat_tasks (sync_id, message_sync_id, conversation_sync_id, status, updated_by, factory_id)
         VALUES (${TASK_ID('$1::uuid')}, $1, $2, $3, $4, $5)
         ON CONFLICT (message_sync_id) DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = NOW()
           WHERE chat_tasks.status <> EXCLUDED.status
         RETURNING status, updated_by, updated_at`,
        [id, m.conversation_sync_id, status, me, localFactoryId()]
      );
      if (t) {
        const verb = { in_progress: 'started work', done: 'marked done', open: 'reopened' }[status];
        await insertMessage(pool, { convId: m.conversation_sync_id, me, body: `${me} ${verb}`, kind: 'system', replyTo: id });
      }
      res.json({ ok: true, task: t ? { status: t.status, by: t.updated_by, at: t.updated_at } : { status } });
    } catch (err) { fail(res, err, 'task'); }
  });
}

module.exports = {
  ensureShareSchema,
  decorateShare,
  validReplyTarget,
  registerShareRoutes,
  oneLine,
  __test: { safeRelativeUrl, cleanLinkMeta, cleanLocator }
};
