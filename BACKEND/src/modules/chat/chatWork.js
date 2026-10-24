'use strict';

// JMS Chat "work" features (MAIN and LOCAL each keep their own; these tables are not synced):
//  * polls          a message with meta.poll { question, options[], multi }; votes in chat_poll_votes
//  * pinned         up to 3 pinned messages per chat (chat_pins); group admins / superadmin in groups
//  * tasks          "make task" from a message: assignee + due time, reminders until done (chat_todos)
//  * scheduled      messages sent later by a background job (chat_scheduled)
//  * quiet hours    per person (chat_user_settings): no push in that window unless urgent / @mention
// Urgent and announcement flags live on the message itself (meta.urgent, meta.announcement).

const crypto = require('crypto');
const chatSync = require('./chatSync');
const chatFcm = require('./chatFcm');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK = 'jms_chat_work';
const MAX_PINS = 3;
const MAX_OPTIONS = 10;

let schemaReady = null;
function ensureWorkSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta JSONB;
      CREATE TABLE IF NOT EXISTS chat_poll_votes (
        message_sync_id UUID NOT NULL,
        username_lower TEXT NOT NULL,
        username TEXT NOT NULL,
        options INTEGER[] NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_sync_id, username_lower)
      );
      CREATE TABLE IF NOT EXISTS chat_pins (
        conversation_sync_id UUID NOT NULL,
        message_sync_id UUID NOT NULL,
        pinned_by TEXT NOT NULL,
        pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (conversation_sync_id, message_sync_id)
      );
      CREATE TABLE IF NOT EXISTS chat_todos (
        id UUID PRIMARY KEY,
        conversation_sync_id UUID NOT NULL,
        message_sync_id UUID,
        title TEXT NOT NULL,
        assignee TEXT NOT NULL,
        created_by TEXT NOT NULL,
        due_at TIMESTAMPTZ,
        done_at TIMESTAMPTZ,
        done_by TEXT,
        reminded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_todos_assignee ON chat_todos (LOWER(assignee), done_at);
      CREATE TABLE IF NOT EXISTS chat_scheduled (
        id UUID PRIMARY KEY,
        conversation_sync_id UUID NOT NULL,
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        send_at TIMESTAMPTZ NOT NULL,
        sent_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_scheduled_due ON chat_scheduled (send_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;
      CREATE TABLE IF NOT EXISTS chat_user_settings (
        username_lower TEXT PRIMARY KEY,
        quiet_from TEXT,
        quiet_to TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// ---------------- polls ----------------
/** Clean a poll from a send request, or null. */
function cleanPoll(p) {
  if (!p || typeof p !== 'object') return null;
  const question = String(p.question || '').trim().slice(0, 300);
  const options = (Array.isArray(p.options) ? p.options : []).map((o) => String(o || '').trim().slice(0, 100)).filter(Boolean);
  if (!question || options.length < 2) return null;
  return { question, options: [...new Set(options)].slice(0, MAX_OPTIONS), multi: Boolean(p.multi) };
}

/** message id -> { question, options: [{ text, votes, voters }], multi, total, mine: [idx] } */
async function pollsFor(pool, rows, me) {
  const polls = rows.filter((r) => r.meta && r.meta.poll);
  const out = new Map();
  if (!polls.length) return out;
  await ensureWorkSchema(pool);
  const { rows: votes } = await pool.query(
    'SELECT message_sync_id, username, options FROM chat_poll_votes WHERE message_sync_id = ANY($1::uuid[])',
    [polls.map((r) => r.sync_id)]
  );
  for (const r of polls) {
    const p = r.meta.poll;
    const opts = p.options.map((text) => ({ text, votes: 0, voters: [] }));
    const mine = [];
    const voters = new Set();
    for (const v of votes.filter((x) => x.message_sync_id === r.sync_id)) {
      voters.add(v.username.toLowerCase());
      for (const i of v.options || []) {
        if (!opts[i]) continue;
        opts[i].votes += 1;
        opts[i].voters.push(v.username);
        if (me && v.username.toLowerCase() === me.toLowerCase()) mine.push(i);
      }
    }
    out.set(r.sync_id, { question: p.question, multi: Boolean(p.multi), options: opts, total: voters.size, mine });
  }
  return out;
}

// ---------------- quiet hours ----------------
function inQuiet(setting, now = new Date()) {
  if (!setting || !setting.quiet_from || !setting.quiet_to) return false;
  const [fh, fm] = setting.quiet_from.split(':').map(Number);
  const [th, tm] = setting.quiet_to.split(':').map(Number);
  // server time is UTC; the factory runs on IST
  const ist = new Date(now.getTime() + 330 * 60000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? mins >= from && mins < to : mins >= from || mins < to;
}

/** Set of usernames (lower) in quiet hours right now, among these. */
async function quietNow(pool, usernames) {
  if (!usernames.length) return new Set();
  await ensureWorkSchema(pool);
  const { rows } = await pool.query(
    'SELECT username_lower, quiet_from, quiet_to FROM chat_user_settings WHERE username_lower = ANY($1::text[])',
    [usernames.map((u) => String(u).toLowerCase())]
  );
  return new Set(rows.filter((r) => inQuiet(r)).map((r) => r.username_lower));
}

// ---------------- routes ----------------
function registerWorkRoutes(app, pool, h) {
  const { ready, fail, membership, decorate, localFactoryId } = h;
  const { isSuperadmin } = require('../../app/auth');

  async function messageInMyChat(req, res, id) {
    if (!UUID_RE.test(String(id || ''))) { res.status(400).json({ ok: false, error: 'Bad message id.' }); return null; }
    const { rows: [m] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [id]);
    if (!m) { res.status(404).json({ ok: false, error: 'Message not found.' }); return null; }
    const member = await membership(pool, m.conversation_sync_id, req.auth.username);
    if (!member && !isSuperadmin(req.auth)) { res.status(403).json({ ok: false, error: 'You are not in this chat.' }); return null; }
    return { m, member };
  }

  async function canAdmin(req, convId, member) {
    if (isSuperadmin(req.auth)) return true;
    const { rows: [c] } = await pool.query('SELECT type FROM chat_conversations WHERE sync_id = $1', [convId]);
    return !c || c.type !== 'group' || (member && member.role === 'admin');
  }

  // vote: { options: [index, ...] } (empty = take my vote back)
  app.post('/api/chat/messages/:id/vote', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const got = await messageInMyChat(req, res, req.params.id);
      if (!got) return;
      const poll = got.m.meta && got.m.meta.poll;
      if (!poll) return res.status(400).json({ ok: false, error: 'This message is not a poll.' });
      let picks = [...new Set((Array.isArray(req.body && req.body.options) ? req.body.options : []).map(Number))]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < poll.options.length);
      if (!poll.multi) picks = picks.slice(0, 1);
      if (!picks.length) {
        await pool.query('DELETE FROM chat_poll_votes WHERE message_sync_id = $1 AND username_lower = LOWER($2)', [got.m.sync_id, req.auth.username]);
      } else {
        await pool.query(
          `INSERT INTO chat_poll_votes (message_sync_id, username_lower, username, options) VALUES ($1, LOWER($2), $2, $3)
           ON CONFLICT (message_sync_id, username_lower) DO UPDATE SET options = EXCLUDED.options, updated_at = NOW()`,
          [got.m.sync_id, req.auth.username, picks]
        );
      }
      await pool.query("SELECT pg_notify('jms_chat', $1)",
        [JSON.stringify({ t: 'chat_messages', op: 'UPDATE', s: got.m.sync_id, c: got.m.conversation_sync_id, e: true })]);
      const [msg] = await decorate(pool, [got.m], req.auth.username);
      res.json({ ok: true, message: msg });
    } catch (err) { fail(res, err, 'vote'); }
  });

  // pinned messages: GET list, POST { message_sync_id } pin, DELETE unpin
  app.get('/api/chat/conversations/:id/pins', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const convId = String(req.params.id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      if (!(await membership(pool, convId, req.auth.username)) && !isSuperadmin(req.auth)) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const { rows } = await pool.query(
        `SELECT x.* FROM chat_pins p JOIN chat_messages x ON x.sync_id = p.message_sync_id
          WHERE p.conversation_sync_id = $1 AND x.deleted_at IS NULL ORDER BY p.pinned_at DESC`, [convId]
      );
      res.json({ ok: true, pins: await decorate(pool, rows, req.auth.username) });
    } catch (err) { fail(res, err, 'pins'); }
  });

  for (const method of ['post', 'delete']) {
    app[method]('/api/chat/messages/:id/pin', async (req, res) => {
      try {
        if (!(await ready(req, res))) return;
        await ensureWorkSchema(pool);
        const got = await messageInMyChat(req, res, req.params.id);
        if (!got) return;
        const convId = got.m.conversation_sync_id;
        if (!(await canAdmin(req, convId, got.member))) return res.status(403).json({ ok: false, error: 'Only a group admin can pin messages.' });
        if (method === 'post') {
          const { rows: [n] } = await pool.query('SELECT COUNT(*)::int AS n FROM chat_pins WHERE conversation_sync_id = $1', [convId]);
          if (n.n >= MAX_PINS) return res.status(400).json({ ok: false, error: `Up to ${MAX_PINS} pinned messages. Unpin one first.` });
          await pool.query(
            'INSERT INTO chat_pins (conversation_sync_id, message_sync_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [convId, got.m.sync_id, req.auth.username]
          );
        } else {
          await pool.query('DELETE FROM chat_pins WHERE conversation_sync_id = $1 AND message_sync_id = $2', [convId, got.m.sync_id]);
        }
        await pool.query("SELECT pg_notify('jms_chat', $1)", [JSON.stringify({ t: 'chat_conversations', op: 'UPDATE', c: convId, e: true })]);
        res.json({ ok: true, pinned: method === 'post' });
      } catch (err) { fail(res, err, 'pin'); }
    });
  }

  // tasks: POST { message_sync_id?, conversation_sync_id, title, assignee, due_at? }
  app.post('/api/chat/todos', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const b = req.body || {};
      const convId = String(b.conversation_sync_id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      if (!(await membership(pool, convId, req.auth.username))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const title = String(b.title || '').trim().slice(0, 300);
      if (!title) return res.status(400).json({ ok: false, error: 'Write what needs doing.' });
      const assignee = String(b.assignee || req.auth.username).trim();
      if (!(await membership(pool, convId, assignee))) return res.status(400).json({ ok: false, error: `${assignee} is not in this chat.` });
      const due = b.due_at ? new Date(String(b.due_at)) : null;
      const id = crypto.randomUUID();
      const msgId = UUID_RE.test(String(b.message_sync_id || '')) ? String(b.message_sync_id) : null;
      await pool.query(
        `INSERT INTO chat_todos (id, conversation_sync_id, message_sync_id, title, assignee, created_by, due_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, convId, msgId, title, assignee, req.auth.username, due && !Number.isNaN(due.getTime()) ? due.toISOString() : null]
      );
      await systemLine(pool, convId, req.auth.username,
        `📋 Task for ${assignee}: ${title}${due && !Number.isNaN(due.getTime()) ? ' · due ' + fmtIst(due) : ''}`, localFactoryId());
      if (assignee.toLowerCase() !== req.auth.username.toLowerCase()) {
        chatFcm.sendToUsers(pool, [assignee], {
          type: 'chat', title: `📋 New task from ${req.auth.username}`, body: title, sender: req.auth.username,
          conversation_sync_id: convId, message_sync_id: id, is_group: '0', unread: '1'
        }).catch(() => {});
      }
      res.json({ ok: true, id });
    } catch (err) { fail(res, err, 'task'); }
  });

  app.get('/api/chat/todos', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const { rows } = await pool.query(
        `SELECT t.*, c.title AS conv_title, c.type AS conv_type FROM chat_todos t
           JOIN chat_conversations c ON c.sync_id = t.conversation_sync_id
          WHERE (LOWER(t.assignee) = LOWER($1) OR LOWER(t.created_by) = LOWER($1))
            AND (t.done_at IS NULL OR t.done_at > NOW() - INTERVAL '7 days')
          ORDER BY t.done_at NULLS FIRST, t.due_at NULLS LAST, t.created_at DESC LIMIT 200`, [req.auth.username]
      );
      res.json({ ok: true, todos: rows });
    } catch (err) { fail(res, err, 'tasks'); }
  });

  app.post('/api/chat/todos/:id/done', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad task id.' });
      const undo = req.body && req.body.done === false;
      const { rows: [t] } = await pool.query(
        `UPDATE chat_todos SET done_at = ${undo ? 'NULL' : 'NOW()'}, done_by = $2
          WHERE id = $1 AND (LOWER(assignee) = LOWER($2) OR LOWER(created_by) = LOWER($2)) RETURNING *`,
        [id, req.auth.username]
      );
      if (!t) return res.status(404).json({ ok: false, error: 'Task not found.' });
      if (!undo) await systemLine(pool, t.conversation_sync_id, req.auth.username, `✅ Done: ${t.title} (by ${req.auth.username})`, localFactoryId());
      res.json({ ok: true, todo: t });
    } catch (err) { fail(res, err, 'task done'); }
  });

  // scheduled messages
  app.post('/api/chat/scheduled', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const b = req.body || {};
      const convId = String(b.conversation_sync_id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      if (!(await membership(pool, convId, req.auth.username))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const body = String(b.body || '').trim().slice(0, 4000);
      const at = new Date(String(b.send_at || ''));
      if (!body) return res.status(400).json({ ok: false, error: 'Message is empty.' });
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 30000) return res.status(400).json({ ok: false, error: 'Pick a time at least a minute from now.' });
      if (at.getTime() > Date.now() + 60 * 86400000) return res.status(400).json({ ok: false, error: 'Up to 60 days ahead.' });
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO chat_scheduled (id, conversation_sync_id, sender, body, send_at) VALUES ($1, $2, $3, $4, $5)',
        [id, convId, req.auth.username, body, at.toISOString()]);
      res.json({ ok: true, id, send_at: at.toISOString() });
    } catch (err) { fail(res, err, 'schedule'); }
  });

  app.get('/api/chat/scheduled', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const convId = String(req.query.conversation || '');
      const { rows } = await pool.query(
        `SELECT id, conversation_sync_id, body, send_at FROM chat_scheduled
          WHERE LOWER(sender) = LOWER($1) AND sent_at IS NULL AND cancelled_at IS NULL
            AND ($2 = '' OR conversation_sync_id::text = $2) ORDER BY send_at`, [req.auth.username, convId]
      );
      res.json({ ok: true, scheduled: rows });
    } catch (err) { fail(res, err, 'scheduled'); }
  });

  app.delete('/api/chat/scheduled/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      await pool.query('UPDATE chat_scheduled SET cancelled_at = NOW() WHERE id = $1 AND LOWER(sender) = LOWER($2) AND sent_at IS NULL',
        [String(req.params.id || ''), req.auth.username]);
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'cancel scheduled'); }
  });

  // quiet hours: GET / PUT { quiet_from: "22:00", quiet_to: "07:00" } (empty = off)
  app.get('/api/chat/settings', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const { rows: [r] } = await pool.query('SELECT quiet_from, quiet_to FROM chat_user_settings WHERE username_lower = LOWER($1)', [req.auth.username]);
      res.json({ ok: true, quiet_from: (r && r.quiet_from) || '', quiet_to: (r && r.quiet_to) || '' });
    } catch (err) { fail(res, err, 'settings'); }
  });

  app.put('/api/chat/settings', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureWorkSchema(pool);
      const hm = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);
      const from = hm(req.body && req.body.quiet_from);
      const to = hm(req.body && req.body.quiet_to);
      await pool.query(
        `INSERT INTO chat_user_settings (username_lower, quiet_from, quiet_to) VALUES (LOWER($1), $2, $3)
         ON CONFLICT (username_lower) DO UPDATE SET quiet_from = EXCLUDED.quiet_from, quiet_to = EXCLUDED.quiet_to, updated_at = NOW()`,
        [req.auth.username, from && to ? from : null, from && to ? to : null]
      );
      res.json({ ok: true, quiet_from: from && to ? from : '', quiet_to: from && to ? to : '' });
    } catch (err) { fail(res, err, 'settings save'); }
  });
}

function fmtIst(d) {
  const t = new Date(new Date(d).getTime() + 330 * 60000);
  return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

async function systemLine(db, convId, actor, text, factoryId) {
  const { rows: [m] } = await db.query(
    `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, factory_id) VALUES ($1, $2, $3, 'system', $4) RETURNING server_ts`,
    [convId, actor, text.slice(0, 4000), factoryId == null ? null : factoryId]
  );
  await db.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [convId, m.server_ts]);
}

// ---------------- background job: scheduled messages + task reminders ----------------
function start(pool, { localFactoryId }) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    const client = await pool.connect().catch(() => null);
    if (!client) { running = false; return; }
    let locked = false;
    try {
      const { rows: [l] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK]);
      locked = l.ok;
      if (!locked) return;
      await ensureWorkSchema(client);
      // scheduled messages that are due (a missed one older than a day is dropped)
      const { rows: due } = await client.query(
        `UPDATE chat_scheduled SET sent_at = NOW()
          WHERE id IN (SELECT id FROM chat_scheduled WHERE sent_at IS NULL AND cancelled_at IS NULL AND send_at <= NOW()
                         AND send_at > NOW() - INTERVAL '1 day' ORDER BY send_at LIMIT 50)
          RETURNING *`
      );
      for (const s of due) {
        const { rows: [mem] } = await client.query(
          'SELECT 1 FROM chat_members WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2) AND left_at IS NULL', [s.conversation_sync_id, s.sender]
        );
        if (!mem) continue;
        const { rows: [m] } = await client.query(
          `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, factory_id, meta) VALUES ($1, $2, $3, 'text', $4, $5) RETURNING server_ts`,
          [s.conversation_sync_id, s.sender, s.body, localFactoryId(), JSON.stringify({ scheduled: true })]
        );
        await client.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [s.conversation_sync_id, m.server_ts]);
      }
      // task reminders: due and not done; remind again every 4 hours
      const { rows: todos } = await client.query(
        `UPDATE chat_todos SET reminded_at = NOW()
          WHERE id IN (SELECT id FROM chat_todos WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at <= NOW()
                         AND (reminded_at IS NULL OR reminded_at < NOW() - INTERVAL '4 hours') LIMIT 50)
          RETURNING *`
      );
      for (const t of todos) {
        chatFcm.sendToUsers(client, [t.assignee], {
          type: 'chat', title: '⏰ Task due', body: t.title, sender: t.created_by,
          conversation_sync_id: t.conversation_sync_id, message_sync_id: t.id, is_group: '0', unread: '1', urgent: '1'
        }).catch(() => {});
        await systemLine(client, t.conversation_sync_id, t.created_by, `⏰ Reminder for ${t.assignee}: ${t.title}`, localFactoryId());
      }
    } catch (err) {
      console.warn('[chat-work]', err.message);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK]).catch(() => {});
      client.release();
      running = false;
    }
  }
  const every = setInterval(tick, 30 * 1000);
  if (every.unref) every.unref();
}

module.exports = { ensureWorkSchema, cleanPoll, pollsFor, inQuiet, quietNow, registerWorkRoutes, start, __test: { fmtIst } };
