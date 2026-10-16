'use strict';

// JMS Chat: direct and group chats between users, live over SSE, with a read-only
// "all chats" view for superadmins (every such view is logged).
// Phase 1: direct chats, stream, superadmin view. Phase 2: groups, attachments,
// delivered/read receipts per message, typing indicator, search, edit and delete.
//
// Rows are linked by sync_id (UUID), never by SERIAL id, so Phase 3 can sync these
// tables between LOCAL and MAIN without remapping ids. A direct chat is keyed by
// dm_key (the two lower-cased usernames, sorted) so two servers can't each create
// their own copy of the same chat.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { isSuperadmin } = require('../../app/auth');
const { sniffAttachment } = require('./attachmentType');

const MAX_BODY = 4000;
const PAGE_SIZE = 50;
const SEND_LIMIT_PER_MIN = 30;
const MAX_TITLE = 80;
const MAX_GROUP = 256;
const EDIT_WINDOW_MIN = 15;
const MAX_FILE = 10 * 1024 * 1024;
const TYPING_GAP_MS = 2000;
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
// Attachments live under PUBLIC/uploads (the folder the deploy keeps on a volume), but
// /uploads/chat/ is blocked for static serving (uploadSafety.js): files are handed out
// only by GET /api/chat/files/:id after a membership check.
const uploadRoot = path.join(__dirname, '../../../PUBLIC/uploads/chat');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 1, fields: 10 }
});

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
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      message_sync_id UUID NOT NULL,
      conversation_sync_id UUID NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_name TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      factory_id INTEGER,
      sync_status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments (message_sync_id);
    CREATE TABLE IF NOT EXISTS chat_receipts (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      message_sync_id UUID NOT NULL,
      conversation_sync_id UUID NOT NULL,
      username TEXT NOT NULL,
      delivered_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,
      factory_id INTEGER,
      sync_status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_receipts_msg_user
      ON chat_receipts (message_sync_id, LOWER(username));
    CREATE INDEX IF NOT EXISTS idx_chat_receipts_conv ON chat_receipts (conversation_sync_id);
  `);
  // Message search index. pg_trgm ships with PostgreSQL but the DB user may not be allowed
  // to create it; search still works (just slower) without the index.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_chat_messages_body_trgm ON chat_messages USING gin (body gin_trgm_ops)'
    );
  } catch (err) {
    console.warn('[chat] pg_trgm search index not created:', err.message);
  }
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

function attachmentOut(a) {
  return { sync_id: a.sync_id, kind: a.kind, mime: a.mime, file_name: a.file_name, size: a.size_bytes };
}

function messageOut(row, att, receipts) {
  const out = {
    sync_id: row.sync_id,
    conversation_sync_id: row.conversation_sync_id,
    sender: row.sender,
    body: row.deleted_at ? '' : row.body,
    kind: row.kind,
    server_ts: row.server_ts,
    edited_at: row.edited_at,
    deleted: Boolean(row.deleted_at),
    attachment: att && !row.deleted_at ? attachmentOut(att) : null
  };
  if (receipts) {
    out.delivered_to = receipts.filter((r) => r.delivered_at).map((r) => r.username);
    out.read_by = receipts.filter((r) => r.read_at).map((r) => r.username);
  }
  return out;
}

// Attachments and (for my own messages) receipts for a list of message rows.
async function decorate(pool, rows, me) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.sync_id);
  const { rows: atts } = await pool.query(
    'SELECT * FROM chat_attachments WHERE message_sync_id = ANY($1::uuid[])', [ids]
  );
  const attBy = new Map(atts.map((a) => [a.message_sync_id, a]));
  const mine = rows.filter((r) => me && r.sender.toLowerCase() === me.toLowerCase()).map((r) => r.sync_id);
  const recBy = new Map(mine.map((id) => [id, []]));
  if (mine.length) {
    const { rows: recs } = await pool.query(
      `SELECT message_sync_id, username, delivered_at, read_at FROM chat_receipts
        WHERE message_sync_id = ANY($1::uuid[])`, [mine]
    );
    for (const r of recs) recBy.get(r.message_sync_id).push(r);
  }
  return rows.map((r) => messageOut(r, attBy.get(r.sync_id), recBy.get(r.sync_id)));
}

// Record "delivered" for every message this user has not acknowledged yet (in one chat,
// or in all their chats), then tell the senders. Returns nothing; never throws.
async function markDelivered(pool, username, convId) {
  try {
    const params = [username, localFactoryId()];
    let cond = '';
    if (convId) { params.push(convId); cond = 'AND x.conversation_sync_id = $3'; }
    const { rows } = await pool.query(
      `INSERT INTO chat_receipts (message_sync_id, conversation_sync_id, username, delivered_at, factory_id)
       SELECT x.sync_id, x.conversation_sync_id, $1, NOW(), $2
         FROM chat_messages x
         JOIN chat_members me ON me.conversation_sync_id = x.conversation_sync_id
                             AND LOWER(me.username) = LOWER($1) AND me.left_at IS NULL
        WHERE LOWER(x.sender) <> LOWER($1) AND x.deleted_at IS NULL AND x.kind <> 'system'
          AND x.server_ts > NOW() - INTERVAL '30 days' ${cond}
          AND NOT EXISTS (SELECT 1 FROM chat_receipts r
                           WHERE r.message_sync_id = x.sync_id AND LOWER(r.username) = LOWER($1))
       ON CONFLICT (message_sync_id, (LOWER(username))) DO NOTHING
       RETURNING conversation_sync_id, message_sync_id`,
      params
    );
    await announceReceipts(pool, rows, username, 'delivered');
  } catch (err) {
    console.warn('[chat] delivered receipts failed:', err.message);
  }
}

async function announceReceipts(pool, rows, username, kind) {
  const byConv = new Map();
  for (const r of rows) {
    if (!byConv.has(r.conversation_sync_id)) byConv.set(r.conversation_sync_id, []);
    byConv.get(r.conversation_sync_id).push(r.message_sync_id);
  }
  for (const [conv, ids] of byConv) {
    pushTo(await memberNames(pool, conv), {
      type: 'receipt', kind, conversation_sync_id: conv, username, message_sync_ids: ids
    });
  }
}

// System lines in a group ("Ravi added Sita"). Stored as messages so they show in history.
async function systemMessage(db, convId, actor, text) {
  const { rows: [row] } = await db.query(
    `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, factory_id)
     VALUES ($1, $2, $3, 'system', $4) RETURNING *`,
    [convId, actor, text, localFactoryId()]
  );
  await db.query(
    'UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1',
    [convId, row.server_ts]
  );
  return row;
}

// Send an event to the chat's members, and a copy to superadmins who are not in it.
async function notify(pool, convId, event, extraNames = []) {
  const members = await memberNames(pool, convId);
  const all = members.concat(extraNames);
  pushTo(all, event);
  const admins = (await superadminNames(pool))
    .filter((a) => !all.some((m) => m.toLowerCase() === a.toLowerCase()));
  if (admins.length) pushToSuperadmins(admins, event);
}

function previewText(kind, body) {
  const label = { image: '📷 Photo', pdf: '📄 PDF', xlsx: '📊 Excel file', audio: '🎤 Audio' }[kind];
  if (label) return body ? `${label}: ${body}` : label;
  return body || '';
}

function cleanTitle(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

function cleanFileName(v) {
  const base = path.basename(String(v || 'file').replace(/\\/g, '/'));
  return base.replace(/[\u0000-\u001f\u007f"<>|]/g, '').slice(0, 120) || 'file';
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
                (SELECT m.role FROM chat_members m WHERE m.conversation_sync_id = c.sync_id
                    AND LOWER(m.username) = LOWER($1) AND m.left_at IS NULL) AS my_role,
                (SELECT array_agg(m.username ORDER BY LOWER(m.username)) FROM chat_members m
                  WHERE m.conversation_sync_id = c.sync_id AND m.left_at IS NULL) AS members,
                lm.body AS last_body, lm.sender AS last_sender, lm.deleted_at AS last_deleted,
                lm.kind AS last_kind,
                (SELECT COUNT(*)::int FROM chat_messages x
                   JOIN chat_members me ON me.conversation_sync_id = x.conversation_sync_id
                                       AND LOWER(me.username) = LOWER($1)
                  WHERE x.conversation_sync_id = c.sync_id
                    AND LOWER(x.sender) <> LOWER($1)
                    AND x.deleted_at IS NULL AND x.kind <> 'system'
                    AND (me.last_read_at IS NULL OR x.server_ts > me.last_read_at)) AS unread
           FROM chat_conversations c
           LEFT JOIN LATERAL (
             SELECT body, sender, deleted_at, kind FROM chat_messages
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
            title: r.type === 'group'
              ? (r.title || 'Group')
              : (r.title || (all && others.length > 1 ? members.join(' ↔ ') : (others[0] || me))),
            members,
            my_role: r.my_role || null,
            online: r.type === 'group' ? false : others.some(isOnline),
            last_message_at: r.last_message_at,
            last_body: r.last_deleted ? 'This message was deleted' : previewText(r.last_kind, r.last_body),
            last_sender: r.last_kind === 'system' ? '' : (r.last_sender || ''),
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
          WHERE LOWER(x.sender) <> LOWER($1) AND x.deleted_at IS NULL AND x.kind <> 'system'
            AND (me.last_read_at IS NULL OR x.server_ts > me.last_read_at)`,
        [req.auth.username]
      );
      res.json({ ok: true, unread: rows[0].n });
      // The badge loads on every page: a good moment to mark new messages delivered.
      markDelivered(pool, req.auth.username, null);
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
      else if (!before) await markDelivered(pool, me, convId);
      const { rows: [conv] } = await pool.query(
        'SELECT type, title FROM chat_conversations WHERE sync_id = $1', [convId]
      );
      const { rows: mem } = await pool.query(
        `SELECT username, role FROM chat_members
          WHERE conversation_sync_id = $1 AND left_at IS NULL ORDER BY LOWER(username)`,
        [convId]
      );
      res.json({
        ok: true,
        messages: await decorate(pool, page, member ? me : null),
        has_more: hasMore,
        is_member: Boolean(member),
        type: conv ? conv.type : 'direct',
        title: conv ? conv.title : null,
        my_role: member ? member.role : null,
        members: mem.map((m) => m.username),
        member_roles: mem.map((m) => ({ username: m.username, role: m.role, online: isOnline(m.username) }))
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
        await notify(pool, convId, { type: 'message', message: messageOut(row) });
      }
      const [out] = await decorate(pool, [row], me);
      res.json({ ok: true, message: out, duplicate });
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
      const { rows: done } = await pool.query(
        `INSERT INTO chat_receipts (message_sync_id, conversation_sync_id, username, delivered_at, read_at, factory_id)
         SELECT x.sync_id, x.conversation_sync_id, $2, NOW(), NOW(), $3
           FROM chat_messages x
          WHERE x.conversation_sync_id = $1 AND LOWER(x.sender) <> LOWER($2)
            AND x.deleted_at IS NULL AND x.kind <> 'system'
            AND x.server_ts > NOW() - INTERVAL '90 days'
            AND NOT EXISTS (SELECT 1 FROM chat_receipts r WHERE r.message_sync_id = x.sync_id
                             AND LOWER(r.username) = LOWER($2) AND r.read_at IS NOT NULL)
         ON CONFLICT (message_sync_id, (LOWER(username)))
         DO UPDATE SET read_at = EXCLUDED.read_at,
                       delivered_at = COALESCE(chat_receipts.delivered_at, EXCLUDED.delivered_at),
                       updated_at = NOW()
         RETURNING conversation_sync_id, message_sync_id`,
        [convId, me, localFactoryId()]
      );
      await announceReceipts(pool, done, me, 'read');
      res.json({ ok: true, last_read_at: rows[0].last_read_at });
    } catch (err) { fail(res, err, 'read'); }
  });

  // ---------------- groups ----------------
  async function groupFor(req, res, convId) {
    if (!UUID_RE.test(convId)) { res.status(400).json({ ok: false, error: 'Bad chat id.' }); return null; }
    const { rows: [conv] } = await pool.query('SELECT * FROM chat_conversations WHERE sync_id = $1', [convId]);
    if (!conv || conv.type !== 'group') { res.status(404).json({ ok: false, error: 'Group not found.' }); return null; }
    const member = await membership(pool, convId, req.auth.username);
    if (!member) { res.status(403).json({ ok: false, error: 'You are not in this group.' }); return null; }
    return { conv, member };
  }

  // Resolve requested usernames to active users (exact names), dropping unknowns and me.
  async function resolveUsers(names, me) {
    const wanted = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n || '').trim().toLowerCase()))]
      .filter((n) => n && n !== me.toLowerCase());
    if (!wanted.length) return [];
    const { rows } = await pool.query(
      `SELECT username FROM users
        WHERE LOWER(username) = ANY($1::text[]) AND COALESCE(is_active, TRUE) = TRUE`,
      [wanted]
    );
    return rows.map((r) => r.username);
  }

  async function addMembers(db, convId, names) {
    const added = [];
    for (const name of names) {
      const { rows } = await db.query(
        `INSERT INTO chat_members (conversation_sync_id, username, factory_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_sync_id, (LOWER(username)))
         DO UPDATE SET left_at = NULL, role = 'member', joined_at = NOW(), updated_at = NOW()
         WHERE chat_members.left_at IS NOT NULL
         RETURNING username`,
        [convId, name, localFactoryId()]
      );
      if (rows[0]) added.push(rows[0].username);
    }
    return added;
  }

  async function inTx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  function groupChanged(convId, extra) {
    return notify(pool, convId, { type: 'conversation', conversation_sync_id: convId }, extra);
  }

  // Create a group: { title, members: [usernames] }. The creator is its admin.
  app.post('/api/chat/groups', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const title = cleanTitle(req.body && req.body.title);
      if (!title) return res.status(400).json({ ok: false, error: 'Give the group a name.' });
      const names = await resolveUsers(req.body && req.body.members, me);
      if (!names.length) return res.status(400).json({ ok: false, error: 'Add at least one person to the group.' });
      if (names.length + 1 > MAX_GROUP) {
        return res.status(400).json({ ok: false, error: `A group can have at most ${MAX_GROUP} people.` });
      }
      const conv = await inTx(async (db) => {
        const { rows: [c] } = await db.query(
          `INSERT INTO chat_conversations (type, title, created_by, factory_id)
           VALUES ('group', $1, $2, $3) RETURNING *`,
          [title, me, localFactoryId()]
        );
        await db.query(
          `INSERT INTO chat_members (conversation_sync_id, username, role, factory_id)
           VALUES ($1, $2, 'admin', $3)`,
          [c.sync_id, me, localFactoryId()]
        );
        await addMembers(db, c.sync_id, names);
        await systemMessage(db, c.sync_id, me, `${me} created the group "${title}"`);
        return c;
      });
      await groupChanged(conv.sync_id);
      res.json({
        ok: true,
        conversation: { sync_id: conv.sync_id, type: 'group', title, members: [me, ...names], my_role: 'admin', is_member: true }
      });
    } catch (err) { fail(res, err, 'create group'); }
  });

  // Rename a group (any member).
  app.patch('/api/chat/groups/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const g = await groupFor(req, res, String(req.params.id || ''));
      if (!g) return;
      const title = cleanTitle(req.body && req.body.title);
      if (!title) return res.status(400).json({ ok: false, error: 'Give the group a name.' });
      if (title === g.conv.title) return res.json({ ok: true, title });
      const me = req.auth.username;
      await inTx(async (db) => {
        await db.query('UPDATE chat_conversations SET title = $2, updated_at = NOW() WHERE sync_id = $1',
          [g.conv.sync_id, title]);
        await systemMessage(db, g.conv.sync_id, me, `${me} renamed the group to "${title}"`);
      });
      await groupChanged(g.conv.sync_id);
      res.json({ ok: true, title });
    } catch (err) { fail(res, err, 'rename group'); }
  });

  // Add people (group admins only): { members: [usernames] }.
  app.post('/api/chat/groups/:id/members', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const g = await groupFor(req, res, String(req.params.id || ''));
      if (!g) return;
      if (g.member.role !== 'admin') return res.status(403).json({ ok: false, error: 'Only a group admin can add people.' });
      const me = req.auth.username;
      const names = await resolveUsers(req.body && req.body.members, me);
      if (!names.length) return res.status(400).json({ ok: false, error: 'Pick someone to add.' });
      const current = await memberNames(pool, g.conv.sync_id);
      if (current.length + names.length > MAX_GROUP) {
        return res.status(400).json({ ok: false, error: `A group can have at most ${MAX_GROUP} people.` });
      }
      const added = await inTx(async (db) => {
        const a = await addMembers(db, g.conv.sync_id, names);
        if (a.length) await systemMessage(db, g.conv.sync_id, me, `${me} added ${a.join(', ')}`);
        return a;
      });
      if (added.length) await groupChanged(g.conv.sync_id);
      res.json({ ok: true, added });
    } catch (err) { fail(res, err, 'add members'); }
  });

  // Remove someone (group admins only).
  app.delete('/api/chat/groups/:id/members/:username', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const g = await groupFor(req, res, String(req.params.id || ''));
      if (!g) return;
      if (g.member.role !== 'admin') return res.status(403).json({ ok: false, error: 'Only a group admin can remove people.' });
      const me = req.auth.username;
      const target = String(req.params.username || '');
      if (target.toLowerCase() === me.toLowerCase()) {
        return res.status(400).json({ ok: false, error: 'Use "Leave group" to leave.' });
      }
      const removed = await inTx(async (db) => {
        const { rows } = await db.query(
          `UPDATE chat_members SET left_at = NOW(), updated_at = NOW()
            WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2) AND left_at IS NULL
            RETURNING username`,
          [g.conv.sync_id, target]
        );
        if (rows[0]) await systemMessage(db, g.conv.sync_id, me, `${me} removed ${rows[0].username}`);
        return rows[0] ? rows[0].username : null;
      });
      if (!removed) return res.status(404).json({ ok: false, error: 'That person is not in this group.' });
      await groupChanged(g.conv.sync_id, [removed]);
      res.json({ ok: true, removed });
    } catch (err) { fail(res, err, 'remove member'); }
  });

  // Leave a group. If the last admin leaves, the longest-standing member becomes admin.
  app.post('/api/chat/groups/:id/leave', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const g = await groupFor(req, res, String(req.params.id || ''));
      if (!g) return;
      const me = req.auth.username;
      await inTx(async (db) => {
        await db.query(
          `UPDATE chat_members SET left_at = NOW(), role = 'member', updated_at = NOW()
            WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2)`,
          [g.conv.sync_id, me]
        );
        await systemMessage(db, g.conv.sync_id, me, `${me} left`);
        const { rows: admins } = await db.query(
          `SELECT 1 FROM chat_members WHERE conversation_sync_id = $1 AND left_at IS NULL AND role = 'admin'`,
          [g.conv.sync_id]
        );
        if (!admins.length) {
          const { rows: [next] } = await db.query(
            `UPDATE chat_members SET role = 'admin', updated_at = NOW()
              WHERE sync_id = (SELECT sync_id FROM chat_members
                                WHERE conversation_sync_id = $1 AND left_at IS NULL
                                ORDER BY joined_at, id LIMIT 1)
              RETURNING username`,
            [g.conv.sync_id]
          );
          if (next) await systemMessage(db, g.conv.sync_id, next.username, `${next.username} is now an admin`);
        }
      });
      await groupChanged(g.conv.sync_id, [me]);
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'leave group'); }
  });

  // ---------------- attachments ----------------
  // multipart: file, conversation_sync_id, sync_id (optional, for retries), body (caption).
  app.post('/api/chat/attachments', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
    } catch (err) { return fail(res, err, 'attachment'); }
    // The session is checked before multer reads the body. The file stays in memory
    // and reaches disk only once its real type is known.
    upload.single('file')(req, res, async (upErr) => {
      try {
        if (upErr) {
          const tooBig = upErr.code === 'LIMIT_FILE_SIZE';
          return res.status(tooBig ? 413 : 400).json({
            ok: false, error: tooBig ? 'File is too big (max 10 MB).' : 'Could not read the file.'
          });
        }
        const me = req.auth.username;
        const b = req.body || {};
        const convId = String(b.conversation_sync_id || '');
        const syncId = UUID_RE.test(String(b.sync_id || '')) ? String(b.sync_id) : crypto.randomUUID();
        const caption = String(b.body || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY);
        if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
        if (!req.file) return res.status(400).json({ ok: false, error: 'No file attached.' });
        if (!(await membership(pool, convId, me))) {
          return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
        }
        const type = sniffAttachment(req.file.buffer);
        if (!type) {
          return res.status(415).json({ ok: false, error: 'Only photos, PDF, Excel (.xlsx) and audio files can be sent.' });
        }
        const { rows: [dup] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [syncId]);
        if (dup) {
          if (dup.conversation_sync_id !== convId) return res.status(409).json({ ok: false, error: 'Message id clash. Please resend.' });
          const [prev] = await decorate(pool, [dup], me);
          return res.json({ ok: true, message: prev, duplicate: true });
        }
        if (!sendRateOk(me.toLowerCase())) {
          return res.status(429).json({ ok: false, error: 'You are sending too fast. Please wait a moment.' });
        }
        let fileName = cleanFileName(req.file.originalname);
        if (path.extname(fileName).toLowerCase() !== type.ext) {
          fileName = `${path.basename(fileName, path.extname(fileName))}${type.ext}`;
        }
        const month = new Date().toISOString().slice(0, 7);
        const storageName = `${month}/${crypto.randomUUID()}${type.ext}`;
        await fs.promises.mkdir(path.join(uploadRoot, month), { recursive: true });
        const full = path.join(uploadRoot, storageName);
        await fs.promises.writeFile(full, req.file.buffer, { flag: 'wx' });
        let row;
        try {
          row = await inTx(async (db) => {
            const { rows: [m] } = await db.query(
              `INSERT INTO chat_messages (sync_id, conversation_sync_id, sender, body, kind, factory_id)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
              [syncId, convId, me, caption, type.kind, localFactoryId()]
            );
            await db.query(
              `INSERT INTO chat_attachments (message_sync_id, conversation_sync_id, kind, mime, file_name,
                                             size_bytes, storage_name, uploaded_by, factory_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [m.sync_id, convId, type.kind, type.mime, fileName, req.file.size, storageName, me, localFactoryId()]
            );
            await db.query(
              'UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1',
              [convId, m.server_ts]
            );
            await db.query(
              `UPDATE chat_members SET last_read_at = $3, updated_at = NOW()
                WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2)`,
              [convId, me, m.server_ts]
            );
            return m;
          });
        } catch (err) {
          fs.promises.unlink(full).catch(() => {});
          throw err;
        }
        const [out] = await decorate(pool, [row], me);
        const [plain] = await decorate(pool, [row], null);
        await notify(pool, convId, { type: 'message', message: plain });
        res.json({ ok: true, message: out, duplicate: false });
      } catch (err) { fail(res, err, 'attachment'); }
    });
  });

  // View or download an attachment (members, or a superadmin: logged).
  app.get('/api/chat/files/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad file id.' });
      const { rows: [a] } = await pool.query(
        `SELECT a.*, m.deleted_at FROM chat_attachments a
           JOIN chat_messages m ON m.sync_id = a.message_sync_id
          WHERE a.sync_id = $1`,
        [id]
      );
      if (!a) return res.status(404).json({ ok: false, error: 'File not found.' });
      const me = req.auth.username;
      const member = await membership(pool, a.conversation_sync_id, me);
      if (!member && !isSuperadmin(req.auth)) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      if (a.deleted_at) return res.status(410).json({ ok: false, error: 'This message was deleted.' });
      if (!member) await logAudit(pool, me, a.conversation_sync_id, 'open_file');
      const base = path.resolve(uploadRoot);
      const full = path.resolve(base, a.storage_name);
      if (!full.startsWith(base + path.sep)) return res.status(404).json({ ok: false, error: 'File not found.' });
      const inline = a.kind !== 'xlsx' && req.query.download !== '1';
      res.setHeader('Content-Type', a.mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // A sandbox CSP would stop the browser's PDF viewer; PDFs were checked to be real PDFs.
      if (a.kind !== 'pdf') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      }
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
      res.sendFile(a.storage_name, { root: base, headers: { 'Content-Type': a.mime } }, (err) => {
        if (err && !res.headersSent) res.status(404).json({ ok: false, error: 'File not found.' });
      });
    } catch (err) { fail(res, err, 'file'); }
  });

  // ---------------- typing ----------------
  const typingSeen = new Map(); // "user|conv" -> last push time
  app.post('/api/chat/typing', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const me = req.auth.username;
      const convId = String((req.body && req.body.conversation_sync_id) || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      const key = `${me.toLowerCase()}|${convId}`;
      const now = Date.now();
      if (now - (typingSeen.get(key) || 0) < TYPING_GAP_MS) return res.json({ ok: true, throttled: true });
      typingSeen.set(key, now);
      if (typingSeen.size > 5000) {
        for (const [k, t] of typingSeen) if (now - t > 60000) typingSeen.delete(k);
      }
      if (!(await membership(pool, convId, me))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const others = (await memberNames(pool, convId)).filter((n) => n.toLowerCase() !== me.toLowerCase());
      pushTo(others, { type: 'typing', conversation_sync_id: convId, username: me });
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'typing'); }
  });

  // ---------------- search ----------------
  // ?q=text: messages in my own chats, newest first (the superadmin view is not searched).
  app.get('/api/chat/search', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const q = String(req.query.q || '').trim().slice(0, 100);
      if (q.length < 2) return res.json({ ok: true, results: [] });
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const me = req.auth.username;
      const { rows } = await pool.query(
        `SELECT x.*, c.type AS conv_type, c.title AS conv_title,
                (SELECT array_agg(m2.username) FROM chat_members m2
                  WHERE m2.conversation_sync_id = c.sync_id AND m2.left_at IS NULL) AS members
           FROM chat_messages x
           JOIN chat_members me ON me.conversation_sync_id = x.conversation_sync_id
                               AND LOWER(me.username) = LOWER($1) AND me.left_at IS NULL
           JOIN chat_conversations c ON c.sync_id = x.conversation_sync_id
          WHERE x.deleted_at IS NULL AND x.kind <> 'system' AND x.body ILIKE $2
          ORDER BY x.server_ts DESC
          LIMIT 50`,
        [me, like]
      );
      res.json({
        ok: true,
        results: rows.map((r) => {
          const others = (r.members || []).filter((m) => m.toLowerCase() !== me.toLowerCase());
          return {
            message: messageOut(r),
            conversation_title: r.conv_type === 'group' ? (r.conv_title || 'Group') : (others[0] || me)
          };
        })
      });
    } catch (err) { fail(res, err, 'search'); }
  });

  // ---------------- edit / delete ----------------
  async function ownMessage(req, res) {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) { res.status(400).json({ ok: false, error: 'Bad message id.' }); return null; }
    const { rows: [m] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [id]);
    if (!m || m.kind === 'system') { res.status(404).json({ ok: false, error: 'Message not found.' }); return null; }
    if (m.sender.toLowerCase() !== req.auth.username.toLowerCase()) {
      res.status(403).json({ ok: false, error: 'You can only change your own messages.' });
      return null;
    }
    if (m.deleted_at) { res.status(410).json({ ok: false, error: 'This message was deleted.' }); return null; }
    if (!(await membership(pool, m.conversation_sync_id, req.auth.username))) {
      res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      return null;
    }
    return m;
  }

  async function announceUpdate(row, me) {
    const [plain] = await decorate(pool, [row], null);
    await notify(pool, row.conversation_sync_id, { type: 'message_update', message: plain });
    const [out] = await decorate(pool, [row], me);
    return out;
  }

  // Edit text (or a caption) within 15 minutes of sending.
  app.patch('/api/chat/messages/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const m = await ownMessage(req, res);
      if (!m) return;
      const body = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').trim();
      if (!body && m.kind === 'text') return res.status(400).json({ ok: false, error: 'Message is empty.' });
      if (body.length > MAX_BODY) {
        return res.status(400).json({ ok: false, error: `Message is too long (max ${MAX_BODY} characters).` });
      }
      const { rows: [row] } = await pool.query(
        `UPDATE chat_messages SET body = $2, edited_at = NOW(), updated_at = NOW()
          WHERE sync_id = $1 AND deleted_at IS NULL
            AND server_ts > NOW() - make_interval(mins => $3)
          RETURNING *`,
        [m.sync_id, body, EDIT_WINDOW_MIN]
      );
      if (!row) {
        return res.status(403).json({ ok: false, error: `Messages can only be edited within ${EDIT_WINDOW_MIN} minutes.` });
      }
      res.json({ ok: true, message: await announceUpdate(row, req.auth.username) });
    } catch (err) { fail(res, err, 'edit'); }
  });

  // Delete for everyone (soft: the row stays; its text and file are no longer shown).
  app.delete('/api/chat/messages/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const m = await ownMessage(req, res);
      if (!m) return;
      const { rows: [row] } = await pool.query(
        `UPDATE chat_messages SET deleted_at = NOW(), updated_at = NOW()
          WHERE sync_id = $1 AND deleted_at IS NULL RETURNING *`,
        [m.sync_id]
      );
      if (!row) return res.status(410).json({ ok: false, error: 'This message was deleted.' });
      res.json({ ok: true, message: await announceUpdate(row, req.auth.username) });
    } catch (err) { fail(res, err, 'delete'); }
  });
}

module.exports = { registerChatRoutes, ensureChatSchema, dmKey, __test: { messageOut, previewText } };
