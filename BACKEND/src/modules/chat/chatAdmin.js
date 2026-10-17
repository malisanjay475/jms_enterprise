'use strict';

// JMS Chat phase 5: superadmin console (chat_admin.html), exports, audit log, retention.
//
//  * Every console read, open and export is written to chat_audit_views (with the
//    filters in `details`), and the audit log itself is readable from the console.
//    The log is kept on the server where the viewing happened (the console is used on
//    MAIN); it is not synced.
//  * Retention (server_config CHAT_RETENTION_DAYS, default 730 = 2 years, set from
//    settings.html) runs on MAIN only, once a day, in one worker. It soft-purges: the
//    message row stays (sync_id, sender, time) but its text is emptied and purged_at is
//    set, with a fresh updated_at, so the change replicates to every LOCAL through the
//    chat sync like any edit (newer wins; messages that old can no longer be edited, so
//    nothing can bring the text back). Each server then deletes its own copies of the
//    purged attachments' files. Chat lines in the bell older than the limit are emptied
//    too.

const fs = require('fs');
const path = require('path');
const { isSuperadmin } = require('../../app/auth');
const chatSync = require('./chatSync');

const DEFAULT_RETENTION_DAYS = 730;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;
const EXPORT_MAX_ROWS = 100000;
const PURGE_BATCH = 2000;
const PURGE_LOCK = 'jms_chat_retention';
const DAY_MS = 24 * 3600 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL = { image: 'Photo', pdf: 'PDF', xlsx: 'Excel file', audio: 'Audio' };

async function ensureAdminSchema(pool) {
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('jms_chat_schema'));
    ALTER TABLE chat_audit_views ADD COLUMN IF NOT EXISTS details JSONB;
    CREATE INDEX IF NOT EXISTS idx_chat_audit_viewed ON chat_audit_views (viewed_at DESC);
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_chat_messages_server_ts ON chat_messages (server_ts);
    ALTER TABLE chat_attachments ADD COLUMN IF NOT EXISTS file_removed_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT);
  `);
}

// ---- settings ----
async function getRetentionDays(pool) {
  const { rows: [r] } = await pool.query("SELECT value FROM server_config WHERE key = 'CHAT_RETENTION_DAYS'");
  const n = parseInt(r && r.value, 10);
  return Number.isFinite(n) && n >= MIN_RETENTION_DAYS && n <= MAX_RETENTION_DAYS ? n : DEFAULT_RETENTION_DAYS;
}

// ---- filters (user, factory, date range) shared by list, export ----
function parseFilters(q) {
  const f = { user: String(q.user || '').trim().slice(0, 80), conversation: '', factory: null, from: null, to: null, text: String(q.q || '').trim().slice(0, 100) };
  if (UUID_RE.test(String(q.conversation || ''))) f.conversation = String(q.conversation);
  const fac = String(q.factory || '').trim();
  if (fac === 'main') f.factory = 'main';
  else if (/^\d{1,6}$/.test(fac)) f.factory = parseInt(fac, 10);
  for (const k of ['from', 'to']) {
    const v = String(q[k] || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) f[k] = v;
  }
  return f;
}

// WHERE parts on chat_messages x (and conversation c) for the filters. Dates are whole
// days in India time, inclusive.
function messageWhere(f, params) {
  const where = ["x.kind <> 'system'"];
  if (f.conversation) { params.push(f.conversation); where.push(`x.conversation_sync_id = $${params.length}`); }
  if (f.user) {
    params.push(f.user);
    where.push(`(LOWER(x.sender) = LOWER($${params.length}) OR EXISTS (SELECT 1 FROM chat_members fm
                  WHERE fm.conversation_sync_id = x.conversation_sync_id AND LOWER(fm.username) = LOWER($${params.length})))`);
  }
  if (f.factory === 'main') where.push('x.factory_id IS NULL');
  else if (f.factory != null) { params.push(f.factory); where.push(`x.factory_id = $${params.length}`); }
  if (f.from) { params.push(f.from); where.push(`x.server_ts >= ($${params.length}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`); }
  if (f.to) { params.push(f.to); where.push(`x.server_ts < (($${params.length}::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'`); }
  if (f.text.length >= 2) {
    params.push(`%${f.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`x.body ILIKE $${params.length}`);
  }
  return where.join(' AND ');
}

function convTitle(type, title, members) {
  if (type === 'group') return title || 'Group';
  return (members || []).join(' ↔ ');
}

function bodyText(row) {
  if (row.purged_at) return '[removed after the retention period]';
  if (row.deleted_at) return '[deleted by sender]';
  if (row.kind === 'link' && row.meta) return `[shared ${row.meta.title || 'page'}: ${row.meta.url}]${row.body ? ' ' + row.body : ''}`;
  return row.body || '';
}

// CSV cells: quoted, and anything a spreadsheet would run as a formula is made text.
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

async function logAudit(pool, viewer, convId, action, details) {
  await pool.query(
    'INSERT INTO chat_audit_views (viewer, conversation_sync_id, action, details) VALUES ($1, $2, $3, $4)',
    [viewer, convId || null, action, details ? JSON.stringify(details) : null]
  ).catch((err) => console.warn('[chat-admin] audit log failed:', err.message));
}

function registerAdminRoutes(app, pool, { ready, fail, uploadRoot }) {
  async function admin(req, res) {
    if (!(await ready(req, res))) return false;
    if (!isSuperadmin(req.auth)) {
      res.status(403).json({ ok: false, error: 'Only a superadmin can use the chat console.' });
      return false;
    }
    return true;
  }

  // Factories for the filter.
  app.get('/api/chat/admin/meta', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      let factories = [];
      try {
        ({ rows: factories } = await pool.query('SELECT id, name FROM factories ORDER BY id'));
      } catch (_e) { factories = []; }
      const { rows: users } = await pool.query('SELECT username FROM users ORDER BY LOWER(username)');
      res.json({
        ok: true,
        factories: factories.map((f) => ({ id: f.id, name: f.name })),
        users: users.map((u) => u.username),
        retention_days: await getRetentionDays(pool),
        server_type: chatSync.runtime().serverType
      });
    } catch (err) { fail(res, err, 'admin meta'); }
  });

  // Chats with messages matching the filters.
  app.get('/api/chat/admin/conversations', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      const f = parseFilters(req.query);
      const params = [];
      const where = messageWhere(f, params);
      const { rows } = await pool.query(
        `SELECT c.sync_id, c.type, c.title, COUNT(*)::int AS messages, MAX(x.server_ts) AS last_at, MIN(x.server_ts) AS first_at,
                (SELECT array_agg(m.username ORDER BY LOWER(m.username)) FROM chat_members m
                  WHERE m.conversation_sync_id = c.sync_id AND m.left_at IS NULL) AS members,
                array_agg(DISTINCT COALESCE(x.factory_id, 0)) AS factories
           FROM chat_messages x JOIN chat_conversations c ON c.sync_id = x.conversation_sync_id
          WHERE ${where}
          GROUP BY c.sync_id, c.type, c.title
          ORDER BY MAX(x.server_ts) DESC
          LIMIT 500`,
        params
      );
      await logAudit(pool, req.auth.username, null, 'admin_search', { filters: f, results: rows.length });
      res.json({
        ok: true,
        conversations: rows.map((r) => ({
          sync_id: r.sync_id, type: r.type, title: convTitle(r.type, r.title, r.members), members: r.members || [],
          messages: r.messages, first_at: r.first_at, last_at: r.last_at,
          factories: (r.factories || []).map((x) => (x === 0 ? 'main' : x))
        }))
      });
    } catch (err) { fail(res, err, 'admin conversations'); }
  });

  // One chat, read-only, oldest first within the filters (paged by ?after=<ISO>).
  app.get('/api/chat/admin/conversations/:id/messages', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      const convId = String(req.params.id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      const f = { ...parseFilters(req.query), conversation: convId, user: '', text: '' };
      const params = [];
      let where = messageWhere(f, params);
      where = where.replace("x.kind <> 'system'", 'TRUE'); // show system lines inside a chat
      const after = req.query.after ? new Date(String(req.query.after)) : null;
      if (after && !Number.isNaN(after.getTime())) { params.push(after.toISOString()); where += ` AND x.server_ts > $${params.length}`; }
      const { rows } = await pool.query(
        `SELECT x.*, a.sync_id AS att_id, a.kind AS att_kind, a.file_name AS att_name, a.size_bytes AS att_size, a.file_removed_at
           FROM chat_messages x LEFT JOIN chat_attachments a ON a.message_sync_id = x.sync_id
          WHERE ${where} ORDER BY x.server_ts ASC LIMIT 501`,
        params
      );
      const { rows: [c] } = await pool.query('SELECT type, title FROM chat_conversations WHERE sync_id = $1', [convId]);
      const { rows: mem } = await pool.query(
        'SELECT username, role, left_at FROM chat_members WHERE conversation_sync_id = $1 ORDER BY LOWER(username)', [convId]
      );
      if (!after) await logAudit(pool, req.auth.username, convId, 'admin_view', { from: f.from, to: f.to, factory: f.factory });
      const page = rows.slice(0, 500);
      res.json({
        ok: true,
        conversation: c ? { type: c.type, title: convTitle(c.type, c.title, mem.filter((m) => !m.left_at).map((m) => m.username)) } : null,
        members: mem.map((m) => ({ username: m.username, role: m.role, left: Boolean(m.left_at) })),
        has_more: rows.length > 500,
        messages: page.map((x) => ({
          sync_id: x.sync_id, sender: x.sender, kind: x.kind, body: bodyText(x), server_ts: x.server_ts,
          edited: Boolean(x.edited_at), deleted: Boolean(x.deleted_at), purged: Boolean(x.purged_at),
          factory: x.factory_id == null ? 'main' : x.factory_id,
          attachment: x.att_id && !x.deleted_at && !x.purged_at && !x.file_removed_at
            ? { sync_id: x.att_id, kind: x.att_kind, file_name: x.att_name, size: x.att_size } : null
        }))
      });
    } catch (err) { fail(res, err, 'admin messages'); }
  });

  // Export one chat or a filtered range: ?format=xlsx|csv plus the list filters.
  app.get('/api/chat/admin/export', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const f = parseFilters(req.query);
      if (!f.conversation && !f.user && f.factory == null && !f.from && !f.to && f.text.length < 2) {
        return res.status(400).json({ ok: false, error: 'Pick a chat, a person, a factory or a date range to export.' });
      }
      const params = [];
      const where = messageWhere(f, params);
      params.push(EXPORT_MAX_ROWS + 1);
      const { rows } = await pool.query(
        `SELECT x.server_ts, x.sender, x.kind, x.body, x.meta, x.edited_at, x.deleted_at, x.purged_at, x.factory_id,
                c.type AS conv_type, c.title AS conv_title, x.conversation_sync_id,
                (SELECT array_agg(m.username ORDER BY LOWER(m.username)) FROM chat_members m
                  WHERE m.conversation_sync_id = c.sync_id AND m.left_at IS NULL) AS members,
                a.file_name AS att_name
           FROM chat_messages x
           JOIN chat_conversations c ON c.sync_id = x.conversation_sync_id
           LEFT JOIN chat_attachments a ON a.message_sync_id = x.sync_id
          WHERE ${where}
          ORDER BY c.sync_id, x.server_ts
          LIMIT $${params.length}`,
        params
      );
      if (rows.length > EXPORT_MAX_ROWS) {
        return res.status(413).json({ ok: false, error: `More than ${EXPORT_MAX_ROWS.toLocaleString('en-IN')} messages. Narrow the filters.` });
      }
      await logAudit(pool, req.auth.username, f.conversation || null, 'export', { format, filters: f, rows: rows.length });
      const header = ['Date & time (IST)', 'Chat', 'Chat type', 'Sender', 'Message', 'Attachment', 'Edited', 'Deleted', 'Sent from'];
      const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
      const data = rows.map((r) => [
        fmt(r.server_ts), convTitle(r.conv_type, r.conv_title, r.members), r.conv_type, r.sender, bodyText(r),
        r.att_name ? `${LABEL[r.kind] || 'File'}: ${r.att_name}` : '', r.edited_at ? 'Yes' : '', r.deleted_at ? 'Yes' : '',
        r.factory_id == null ? 'Main site' : `Factory ${r.factory_id}`
      ]);
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `jms-chat-export-${stamp}.${format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Cache-Control', 'no-store');
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.send(`﻿${[header, ...data].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`);
        return;
      }
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'JMS Chat console';
      const ws = wb.addWorksheet('Chat export');
      ws.addRow(header);
      ws.getRow(1).font = { bold: true };
      // Text cells only: nothing a spreadsheet would evaluate.
      for (const r of data) ws.addRow(r.map((v) => String(v)));
      [20, 28, 10, 16, 70, 30, 8, 8, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      ws.getColumn(5).alignment = { wrapText: true, vertical: 'top' };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      const meta = wb.addWorksheet('About this export');
      meta.addRows([
        ['Exported by', req.auth.username],
        ['Exported at (IST)', fmt(new Date())],
        ['Filters', JSON.stringify(f)],
        ['Messages', String(rows.length)],
        ['Note', 'This export is recorded in the chat audit log.']
      ]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      await wb.xlsx.write(res);
      res.end();
    } catch (err) { fail(res, err, 'admin export'); }
  });

  // A file from the console (read-only open, logged).
  app.get('/api/chat/admin/files/:id', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad file id.' });
      const { rows: [a] } = await pool.query(
        `SELECT a.*, m.deleted_at, m.purged_at FROM chat_attachments a
           JOIN chat_messages m ON m.sync_id = a.message_sync_id WHERE a.sync_id = $1`, [id]
      );
      if (!a || a.deleted_at || a.purged_at || a.file_removed_at) return res.status(404).json({ ok: false, error: 'File not available.' });
      if (!(await chatSync.fileExists(uploadRoot, a.storage_name))) {
        const got = await chatSync.fetchFileFromMain(uploadRoot, a).catch(() => false);
        if (!got) return res.status(503).json({ ok: false, error: 'This file is still on its way from the other server.' });
      }
      await logAudit(pool, req.auth.username, a.conversation_sync_id, 'admin_open_file', { file: a.file_name });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `${a.kind === 'xlsx' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
      if (a.kind !== 'pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
      res.sendFile(a.storage_name, { root: path.resolve(uploadRoot), headers: { 'Content-Type': a.mime } });
    } catch (err) { fail(res, err, 'admin file'); }
  });

  // Who viewed / exported what.
  app.get('/api/chat/admin/audit', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      const params = [];
      const where = ['TRUE'];
      const viewer = String(req.query.viewer || '').trim();
      if (viewer) { params.push(viewer); where.push(`LOWER(v.viewer) = LOWER($${params.length})`); }
      const action = String(req.query.action || '').trim();
      if (/^[a-z_]{1,40}$/.test(action)) { params.push(action); where.push(`v.action = $${params.length}`); }
      const f = parseFilters(req.query);
      if (f.from) { params.push(f.from); where.push(`v.viewed_at >= ($${params.length}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`); }
      if (f.to) { params.push(f.to); where.push(`v.viewed_at < (($${params.length}::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'`); }
      const { rows } = await pool.query(
        `SELECT v.id, v.viewer, v.action, v.viewed_at, v.details, v.conversation_sync_id, c.type, c.title,
                (SELECT array_agg(m.username ORDER BY LOWER(m.username)) FROM chat_members m
                  WHERE m.conversation_sync_id = c.sync_id) AS members
           FROM chat_audit_views v LEFT JOIN chat_conversations c ON c.sync_id = v.conversation_sync_id
          WHERE ${where.join(' AND ')}
          ORDER BY v.viewed_at DESC LIMIT 1000`,
        params
      );
      res.json({
        ok: true,
        entries: rows.map((r) => ({
          id: r.id, viewer: r.viewer, action: r.action, at: r.viewed_at, details: r.details,
          conversation_sync_id: r.conversation_sync_id,
          conversation: r.conversation_sync_id ? convTitle(r.type, r.title, r.members) : null
        }))
      });
    } catch (err) { fail(res, err, 'admin audit'); }
  });

  // Retention setting (MAIN only: the purge runs there).
  app.get('/api/chat/admin/retention', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      const { rows: [last] } = await pool.query("SELECT value FROM server_config WHERE key = 'CHAT_RETENTION_LAST_RUN'");
      res.json({
        ok: true, days: await getRetentionDays(pool), min: MIN_RETENTION_DAYS, max: MAX_RETENTION_DAYS,
        default: DEFAULT_RETENTION_DAYS, editable: !chatSync.isLocal(), last_run: last ? JSON.parse(last.value) : null
      });
    } catch (err) { fail(res, err, 'retention get'); }
  });

  app.put('/api/chat/admin/retention', async (req, res) => {
    try {
      if (!(await admin(req, res))) return;
      if (chatSync.isLocal()) {
        return res.status(400).json({ ok: false, error: 'Change chat retention on the main site; factory servers follow it.' });
      }
      const days = parseInt(req.body && req.body.days, 10);
      if (!Number.isFinite(days) || days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS) {
        return res.status(400).json({ ok: false, error: `Keep messages between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days.` });
      }
      const before = await getRetentionDays(pool);
      await pool.query(
        `INSERT INTO server_config (key, value) VALUES ('CHAT_RETENTION_DAYS', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(days)]
      );
      await logAudit(pool, req.auth.username, null, 'retention_change', { from: before, to: days });
      res.json({ ok: true, days });
    } catch (err) { fail(res, err, 'retention put'); }
  });
}

// ---- retention job ----
// MAIN: empty the text of messages older than the limit (in batches, so each sync pull
// stays small). Every server: delete the files of purged attachments it holds.
async function runRetention(pool, { uploadRoot, now = null } = {}) {
  const out = { purged: 0, files: 0, bell: 0, ran: false };
  const client = await pool.connect();
  try {
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [PURGE_LOCK]);
    if (!lock.ok) return out; // another worker is on it
    try {
      out.ran = true;
      if (!chatSync.isLocal()) {
        const days = await getRetentionDays(client);
        const cutoffSql = now ? `$1::timestamptz - make_interval(days => ${days})` : `NOW() - make_interval(days => ${days})`;
        const p = now ? [now] : [];
        for (;;) {
          const { rowCount } = await client.query(
            `UPDATE chat_messages SET body = '', meta = NULL, purged_at = NOW(), updated_at = NOW()
              WHERE sync_id IN (SELECT sync_id FROM chat_messages
                                 WHERE server_ts < ${cutoffSql} AND purged_at IS NULL
                                 ORDER BY server_ts LIMIT ${PURGE_BATCH})`, p
          );
          out.purged += rowCount;
          if (rowCount < PURGE_BATCH) break;
        }
        const bell = await client.query(
          `UPDATE notifications SET message = '', updated_at = NOW()
            WHERE type = 'CHAT' AND created_at < ${cutoffSql} AND COALESCE(message, '') <> ''`, p
        );
        out.bell = bell.rowCount;
        await client.query(
          `INSERT INTO server_config (key, value) VALUES ('CHAT_RETENTION_LAST_RUN', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [JSON.stringify({ at: new Date().toISOString(), days, purged: out.purged })]
        );
      }
      // Files of purged messages, on whichever server holds them (rows synced from MAIN).
      for (;;) {
        const { rows } = await client.query(
          `SELECT a.sync_id, a.storage_name FROM chat_attachments a
             JOIN chat_messages m ON m.sync_id = a.message_sync_id
            WHERE m.purged_at IS NOT NULL AND a.file_removed_at IS NULL LIMIT 500`
        );
        if (!rows.length) break;
        for (const a of rows) {
          const base = path.resolve(uploadRoot);
          const full = path.resolve(base, a.storage_name);
          if (full.startsWith(base + path.sep)) await fs.promises.unlink(full).catch(() => {});
          out.files += 1;
        }
        // file_removed_at is local bookkeeping: set with the pull flag so it does not
        // count as a change to push (the row itself already says the message is purged).
        await client.query('BEGIN');
        await client.query("SELECT set_config('jms.chat_apply', 'pull', true)");
        await client.query('UPDATE chat_attachments SET file_removed_at = NOW() WHERE sync_id = ANY($1::uuid[])', [rows.map((r) => r.sync_id)]);
        await client.query('COMMIT');
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [PURGE_LOCK]).catch(() => {});
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (out.purged || out.files) console.log(`[chat-retention] purged ${out.purged} message(s), removed ${out.files} file(s)`);
  return out;
}

function startRetentionJob(pool, { uploadRoot }) {
  if (startRetentionJob.started || process.env.NODE_ENV === 'test') return;
  startRetentionJob.started = true;
  const run = () => runRetention(pool, { uploadRoot }).catch((err) => console.warn('[chat-retention] failed:', err.message));
  const first = setTimeout(run, 60 * 1000);
  const daily = setInterval(run, DAY_MS);
  if (first.unref) first.unref();
  if (daily.unref) daily.unref();
}

module.exports = {
  ensureAdminSchema,
  registerAdminRoutes,
  runRetention,
  startRetentionJob,
  getRetentionDays,
  DEFAULT_RETENTION_DAYS,
  __test: { parseFilters, messageWhere, csvCell, bodyText }
};
