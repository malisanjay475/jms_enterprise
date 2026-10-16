'use strict';

// JMS Chat (Phase 1): one-to-one messages between users, live over SSE, with a
// read-only "all chats" view for superadmins (every such view is logged).
//
// Rows are linked by sync_id (UUID), never by SERIAL id, so Phase 3 can sync these
// tables between LOCAL and MAIN without remapping ids. A direct chat is keyed by
// dm_key (the two lower-cased usernames, sorted) so two servers can't each create
// their own copy of the same chat.

const crypto = require('crypto');
const { isSuperadmin } = require('../../app/auth');

const MAX_BODY = 4000;
const PAGE_SIZE = 50;
const SEND_LIMIT_PER_MIN = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- live stream: username (lower) -> Set<res> ----
const streams = new Map();

function addStream(username, res) {
  const key = username.toLowerCase();
  if (!streams.has(key)) streams.set(key, new Set());
  streams.get(key).add(res);
  res.on('close', () => {
    const set = streams.get(key);
    if (!set) return;
    set.delete(res);
    if (!set.size) streams.delete(key);
  });
}

function pushTo(usernames, event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const sent = new Set();
  for (const name of usernames) {
    const key = String(name || '').toLowerCase();
    if (!key || sent.has(key)) continue;
    sent.add(key);
    for (const res of streams.get(key) || []) {
      try { res.write(data); } catch (_e) { /* closed; removed on 'close' */ }
    }
  }
}

function pushToSuperadmins(superadmins, event) {
  pushTo(superadmins, { ...event, adminCopy: true });
}

function isOnline(username) {
  return streams.has(String(username || '').toLowerCase());
}

// ---- helpers ----
function dmKey(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|');
}

function localFactoryId() {
  const n = parseInt(process.env.LOCAL_FACTORY_ID || '', 10);
  return Number.isFinite(n) ? n : null;
}

function requireSession(req, res) {
  if (req.auth && req.auth.username) return true;
  res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Please log in again to use chat.' });
  return false;
}

const sendLog = new Map(); // username -> [timestamps]
function sendRateOk(username) {
  const now = Date.now();
  const list = (sendLog.get(username) || []).filter((t) => now - t < 60000);
  if (list.length >= SEND_LIMIT_PER_MIN) { sendLog.set(username, list); return false; }
  list.push(now);
  sendLog.set(username, list);
  return true;
}

let schemaPromise = null;
function ensureChatSchema(pool) {
  if (!schemaPromise) {
    schemaPromise = createSchema(pool).catch((err) => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

async function createSchema(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      type TEXT NOT NULL DEFAULT 'direct',
      title TEXT,
      dm_key TEXT UNIQUE,
      created_by TEXT,
      factory_id INTEGER,
      sync_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_message_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS chat_members (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      conversation_sync_id UUID NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      last_read_at TIMESTAMPTZ,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      factory_id INTEGER,
      sync_status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_members_conv_user
      ON chat_members (conversation_sync_id, LOWER(username));
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members (LOWER(username));
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      conversation_sync_id UUID NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'text',
      reply_to_sync_id UUID,
      client_ts TIMESTAMPTZ,
      server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      factory_id INTEGER,
      sync_status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_ts
      ON chat_messages (conversation_sync_id, server_ts DESC);
    CREATE TABLE IF NOT EXISTS chat_audit_views (
      id SERIAL PRIMARY KEY,
      viewer TEXT NOT NULL,
      conversation_sync_id UUID,
      action TEXT NOT NULL,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function activeUser(pool, username) {
  const { rows } = await pool.query(
    `SELECT username FROM users
      WHERE LOWER(username) = LOWER($1) AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [username]
  );
  return rows[0] ? rows[0].username : null;
}

async function membership(pool, convSyncId, username) {
  const { rows } = await pool.query(
    `SELECT * FROM chat_members
      WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2) AND left_at IS NULL`,
    [convSyncId, username]
  );
  return rows[0] || null;
}

async function memberNames(pool, convSyncId) {
  const { rows } = await pool.query(
    'SELECT username FROM chat_members WHERE conversation_sync_id = $1 AND left_at IS NULL',
    [convSyncId]
  );
  return rows.map((r) => r.username);
}

async function superadminNames(pool) {
  const { rows } = await pool.query(
    `SELECT username FROM users
      WHERE LOWER(role_code) = 'superadmin' AND COALESCE(is_active, TRUE) = TRUE`
  );
  return rows.map((r) => r.username);
}

async function logAudit(pool, viewer, convSyncId, action) {
  await pool.query(
    'INSERT INTO chat_audit_views (viewer, conversation_sync_id, action) VALUES ($1, $2, $3)',
    [viewer, convSyncId, action]
  ).catch((err) => console.warn('[chat] audit log failed:', err.message));
}

function messageOut(row) {
  return {
    sync_id: row.sync_id,
    conversation_sync_id: row.conversation_sync_id,
    sender: row.sender,
    body: row.deleted_at ? '' : row.body,
    kind: row.kind,
    server_ts: row.server_ts,
    edited_at: row.edited_at,
    deleted: Boolean(row.deleted_at)
  };
}

function fail(res, err, where) {
  console.error(`[chat] ${where}:`, err);
  res.status(500).json({ ok: false, error: 'Chat is not available right now. Please try again.' });
}

// ---- routes ----
function registerChatRoutes(app, pool) {
  ensureChatSchema(pool).catch((err) => console.warn('[chat] schema init failed:', err.message));

  async function ready(req, res) {
    if (!requireSession(req, res)) return false;
    await ensureChatSchema(pool);
    return true;
  }

  app.get('/api/chat/me', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      res.json({ ok: true, username: req.auth.username, isSuperadmin: isSuperadmin(req.auth) });
    } catch (err) { fail(res, err, 'me'); }
  });

  // Live events for the signed-in user.
  app.get('/api/chat/stream', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
    } catch (err) { return fail(res, err, 'stream'); }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('data: {"type":"connected"}\n\n');
    addStream(req.auth.username, res);
    const hb = setInterval(() => {
      try { res.write(': hb\n\n'); } catch (_e) { clearInterval(hb); }
    }, 20000);
    req.on('close', () => clearInterval(hb));
  });

  // People you can start a chat with.
  app.get('/api/chat/users', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const { rows } = await pool.query(
        `SELECT username, role_code, line FROM users
          WHERE COALESCE(is_active, TRUE) = TRUE AND LOWER(username) <> LOWER($1)
          ORDER BY LOWER(username)`,
        [req.auth.username]
      );
      res.json({
        ok: true,
        users: rows.map((u) => ({
          username: u.username, role: u.role_code || '', line: u.line || '', online: isOnline(u.username)
        }))
      });
    } catch (err) { fail(res, err, 'users'); }
  });

  // My chats (or, for a superadmin with ?all=1, every chat).
  app.get('/api/chat/conversations', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const all = req.query.all === '1';
      if (all && !isSuperadmin(req.auth)) {
        return res.status(403).json({ ok: false, error: 'Only a superadmin can see all chats.' });
      }
      const params = [me];
      const scope = all
        ? ''
        : `AND EXISTS (SELECT 1 FROM chat_members mm WHERE mm.conversation_sync_id = c.sync_id
                         AND LOWER(mm.username) = LOWER($1) AND mm.left_at IS NULL)`;
      const { rows } = await pool.query(
        `SELECT c.sync_id, c.type, c.title, c.last_message_at,
                (SELECT array_agg(m.username ORDER BY LOWER(m.username)) FROM chat_members m
                  WHERE m.conversation_sync_id = c.sync_id AND m.left_at IS NULL) AS members,
                lm.body AS last_body, lm.sender AS last_sender, lm.deleted_at AS last_deleted,
                (SELECT COUNT(*)::int FROM chat_messages x
                   JOIN chat_members me ON me.conversation_sync_id = x.conversation_sync_id
                                       AND LOWER(me.username) = LOWER($1)
                  WHERE x.conversation_sync_id = c.sync_id
                    AND LOWER(x.sender) <> LOWER($1)
                    AND x.deleted_at IS NULL
                    AND (me.last_read_at IS NULL OR x.server_ts > me.last_read_at)) AS unread
           FROM chat_conversations c
           LEFT JOIN LATERAL (
             SELECT body, sender, deleted_at FROM chat_messages
              WHERE conversation_sync_id = c.sync_id ORDER BY server_ts DESC LIMIT 1
           ) lm ON TRUE
          WHERE c.last_message_at IS NOT NULL ${scope}
          ORDER BY c.last_message_at DESC
          LIMIT 300`,
        params
      );
      if (all) await logAudit(pool, me, null, 'list_all');
      res.json({
        ok: true,
        conversations: rows.map((r) => {
          const members = r.members || [];
          const others = members.filter((m) => m.toLowerCase() !== me.toLowerCase());
          return {
            sync_id: r.sync_id,
            type: r.type,
            title: r.title || (all && others.length > 1 ? members.join(' ↔ ') : (others[0] || me)),
            members,
            online: others.some(isOnline),
            last_message_at: r.last_message_at,
            last_body: r.last_deleted ? 'This message was deleted' : (r.last_body || ''),
            last_sender: r.last_sender || '',
            unread: r.unread || 0,
            is_member: members.some((m) => m.toLowerCase() === me.toLowerCase())
          };
        })
      });
    } catch (err) { fail(res, err, 'conversations'); }
  });

  // Total unread, for the badge on the chat button.
  app.get('/api/chat/unread', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM chat_messages x
           JOIN chat_members me ON me.conversation_sync_id = x.conversation_sync_id
                               AND LOWER(me.username) = LOWER($1) AND me.left_at IS NULL
          WHERE LOWER(x.sender) <> LOWER($1) AND x.deleted_at IS NULL
            AND (me.last_read_at IS NULL OR x.server_ts > me.last_read_at)`,
        [req.auth.username]
      );
      res.json({ ok: true, unread: rows[0].n });
    } catch (err) { fail(res, err, 'unread'); }
  });

  // Open (or create) the direct chat with another user.
  app.post('/api/chat/conversations', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const other = await activeUser(pool, String((req.body && req.body.username) || '').trim());
      if (!other) return res.status(400).json({ ok: false, error: 'That user was not found.' });
      if (other.toLowerCase() === me.toLowerCase()) {
        return res.status(400).json({ ok: false, error: 'You cannot start a chat with yourself.' });
      }
      const key = dmKey(me, other);
      const client = await pool.connect();
      let conv;
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO chat_conversations (type, dm_key, created_by, factory_id)
           VALUES ('direct', $1, $2, $3) ON CONFLICT (dm_key) DO NOTHING`,
          [key, me, localFactoryId()]
        );
        ({ rows: [conv] } = await client.query('SELECT * FROM chat_conversations WHERE dm_key = $1', [key]));
        for (const name of [me, other]) {
          await client.query(
            `INSERT INTO chat_members (conversation_sync_id, username, factory_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (conversation_sync_id, (LOWER(username)))
             DO UPDATE SET left_at = NULL, updated_at = NOW()
             WHERE chat_members.left_at IS NOT NULL`,
            [conv.sync_id, name, localFactoryId()]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      res.json({
        ok: true,
        conversation: { sync_id: conv.sync_id, type: 'direct', title: other, members: [me, other], online: isOnline(other) }
      });
    } catch (err) { fail(res, err, 'open conversation'); }
  });

  // Message history, newest page first (?before=<ISO time> for older pages).
  app.get('/api/chat/conversations/:id/messages', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const convId = String(req.params.id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      const me = req.auth.username;
      const member = await membership(pool, convId, me);
      if (!member && !isSuperadmin(req.auth)) {
        return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      }
      const before = req.query.before ? new Date(String(req.query.before)) : null;
      const params = [convId, PAGE_SIZE + 1];
      let cond = '';
      if (before && !Number.isNaN(before.getTime())) {
        params.push(before.toISOString());
        cond = 'AND server_ts < $3';
      }
      const { rows } = await pool.query(
        `SELECT * FROM chat_messages WHERE conversation_sync_id = $1 ${cond}
          ORDER BY server_ts DESC LIMIT $2`,
        params
      );
      const hasMore = rows.length > PAGE_SIZE;
      const page = rows.slice(0, PAGE_SIZE).reverse();
      if (!member) await logAudit(pool, me, convId, 'read_messages');
      // Read receipts for direct chats: the other side's last read time.
      const { rows: others } = await pool.query(
        `SELECT username, last_read_at FROM chat_members
          WHERE conversation_sync_id = $1 AND LOWER(username) <> LOWER($2) AND left_at IS NULL`,
        [convId, me]
      );
      res.json({
        ok: true,
        messages: page.map(messageOut),
        has_more: hasMore,
        is_member: Boolean(member),
        members: (await memberNames(pool, convId)),
        others_read_at: others.map((o) => ({ username: o.username, last_read_at: o.last_read_at }))
      });
    } catch (err) { fail(res, err, 'messages'); }
  });

  // Send a message. The client may pass its own sync_id so a retry never doubles it.
  app.post('/api/chat/messages', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const b = req.body || {};
      const convId = String(b.conversation_sync_id || '');
      const body = String(b.body || '').replace(/\r\n/g, '\n').trim();
      const syncId = UUID_RE.test(String(b.sync_id || '')) ? String(b.sync_id) : crypto.randomUUID();
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      if (!body) return res.status(400).json({ ok: false, error: 'Message is empty.' });
      if (body.length > MAX_BODY) {
        return res.status(400).json({ ok: false, error: `Message is too long (max ${MAX_BODY} characters).` });
      }
      if (!(await membership(pool, convId, me))) {
        return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      }
      if (!sendRateOk(me.toLowerCase())) {
        return res.status(429).json({ ok: false, error: 'You are sending too fast. Please wait a moment.' });
      }
      const clientTs = b.client_ts ? new Date(String(b.client_ts)) : null;
      const ins = await pool.query(
        `INSERT INTO chat_messages (sync_id, conversation_sync_id, sender, body, client_ts, factory_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (sync_id) DO NOTHING
         RETURNING *`,
        [syncId, convId, me, body,
          clientTs && !Number.isNaN(clientTs.getTime()) ? clientTs.toISOString() : null, localFactoryId()]
      );
      let row = ins.rows[0];
      const duplicate = !row;
      if (duplicate) {
        ({ rows: [row] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [syncId]));
        if (!row || row.conversation_sync_id !== convId) {
          return res.status(409).json({ ok: false, error: 'Message id clash. Please resend.' });
        }
      } else {
        await pool.query(
          'UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1',
          [convId, row.server_ts]
        );
        // Sending marks the chat read for the sender.
        await pool.query(
          `UPDATE chat_members SET last_read_at = $3, updated_at = NOW()
            WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2)`,
          [convId, me, row.server_ts]
        );
        const members = await memberNames(pool, convId);
        const event = { type: 'message', message: messageOut(row) };
        pushTo(members, event);
        const admins = (await superadminNames(pool))
          .filter((a) => !members.some((m) => m.toLowerCase() === a.toLowerCase()));
        if (admins.length) pushToSuperadmins(admins, event);
      }
      res.json({ ok: true, message: messageOut(row), duplicate });
    } catch (err) { fail(res, err, 'send'); }
  });

  // Mark a chat read up to now.
  app.post('/api/chat/read', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const convId = String((req.body && req.body.conversation_sync_id) || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      const { rows } = await pool.query(
        `UPDATE chat_members SET last_read_at = NOW(), updated_at = NOW()
          WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2) AND left_at IS NULL
          RETURNING last_read_at`,
        [convId, me]
      );
      if (!rows[0]) return res.json({ ok: true, member: false });
      const members = await memberNames(pool, convId);
      pushTo(members, { type: 'read', conversation_sync_id: convId, username: me, last_read_at: rows[0].last_read_at });
      res.json({ ok: true, last_read_at: rows[0].last_read_at });
    } catch (err) { fail(res, err, 'read'); }
  });
}

module.exports = { registerChatRoutes, ensureChatSchema, dmKey };
