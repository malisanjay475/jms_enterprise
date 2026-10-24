'use strict';

// JMS Bot: chat that does JMS work (MAIN only for the background jobs).
//
//  * "/" commands in any chat: /dpr <machine>, /job <job card or plan>, /order <order no>,
//    /help. The answer is posted into the chat by "JMS Bot" so everyone there sees it.
//  * Maintenance ticket from chat: POST /api/chat/maintenance creates the same ticket the
//    Maintenance page does (numbering and manager notifications from the legacy module via
//    app.locals.jmsMaintenance); status changes are posted back into that chat.
//  * Job-card approvals from chat: list + Approve / Reject through the existing approval
//    route (same stage and role rules). Only for users who already have full JMS access
//    (global access or admin), since the chat-only login is not a full JMS login.
//  * End-of-shift summary per factory group (08:05 and 20:05 IST).
//  * Alert acknowledge + escalation: JMS Alerts messages carry meta.alert; not acknowledged
//    in 30 min → factory managers are pushed, 60 min → superadmins.

const http = require('http');
const chatSync = require('./chatSync');
const chatFcm = require('./chatFcm');
const { signSession } = require('../../app/auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT = 'JMS Bot';
const ALERTS = 'JMS Alerts';
const LOCK = 'jms_chat_bot';
const MANAGER_ROLES = ['admin', 'superadmin', 'moulding_manager', 'moulding_ass_manager', 'production_manager', 'plant_head', 'qc_manager', 'quality_manager'];

let schemaReady = null;
function ensureBotSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_ticket_links (
        ticket_sync_id UUID PRIMARY KEY,
        conversation_sync_id UUID NOT NULL,
        last_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chat_alert_acks (
        message_sync_id UUID PRIMARY KEY,
        acked_by TEXT,
        acked_at TIMESTAMPTZ,
        escalated_level INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS chat_bot_state (name TEXT PRIMARY KEY, value TEXT);
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// ---------------- helpers ----------------
function istNow() { return new Date(Date.now() + 330 * 60000); }
/** Current shift (IST): Day 08-20, Night 20-08 (night belongs to the date it started). */
function currentShift(d = istNow()) {
  const h = d.getUTCHours();
  const date = new Date(d);
  if (h < 8) date.setUTCDate(date.getUTCDate() - 1);
  return { date: date.toISOString().slice(0, 10), shift: h >= 8 && h < 20 ? 'Day' : 'Night' };
}
const n = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');

async function post(db, convId, sender, text, meta) {
  const { rows: [m] } = await db.query(
    `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, meta) VALUES ($1, $2, $3, 'text', $4) RETURNING sync_id, server_ts`,
    [convId, sender, String(text).slice(0, 4000), meta ? JSON.stringify(meta) : null]
  );
  await db.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [convId, m.server_ts]);
  return m;
}

async function userFactoryIds(pool, username) {
  const { rows } = await pool.query(
    `SELECT u.factory_id AS f FROM users u WHERE LOWER(u.username) = LOWER($1) AND u.factory_id IS NOT NULL
     UNION SELECT uf.factory_id FROM user_factories uf JOIN users u ON u.id = uf.user_id WHERE LOWER(u.username) = LOWER($1)`, [username]
  ).catch(() => ({ rows: [] }));
  return rows.map((r) => Number(r.f));
}

// ---------------- commands ----------------
const HELP = [
  '🤖 JMS Bot commands:',
  '/dpr <machine> — today\'s output for a machine (e.g. /dpr M-07)',
  '/job <job card or plan id> — job status, produced, balance, QC holds',
  '/order <order no> — order quantity, produced, balance, status',
  '/help — this list'
].join('\n');

async function cmdDpr(pool, arg, factories) {
  if (!arg) return 'Usage: /dpr <machine>, e.g. /dpr M-07';
  const { date, shift } = currentShift();
  const { rows } = await pool.query(
    `SELECT machine, shift, COALESCE(SUM(good_qty),0) AS good, COALESCE(SUM(reject_qty),0) AS rej, COALESCE(SUM(downtime_min),0) AS dt,
            MAX(hour_slot) AS last_slot, MAX(order_no) AS order_no, MAX(plan_id) AS plan_id
       FROM dpr_hourly
      WHERE dpr_date = $1 AND COALESCE(is_deleted, false) = false AND machine ILIKE $2
        AND ($3::int[] IS NULL OR factory_id = ANY($3::int[]))
      GROUP BY machine, shift ORDER BY machine, shift`,
    [date, `%${arg}%`, factories && factories.length ? factories : null]
  );
  if (!rows.length) return `No DPR entries today (${date}) for "${arg}".`;
  const lines = [`📈 DPR ${date} · now ${shift} shift`];
  for (const r of rows.slice(0, 12)) {
    lines.push(`${r.machine} · ${r.shift}: good ${n(r.good)}, reject ${n(r.rej)}, downtime ${n(r.dt)} min${r.last_slot ? ' · last ' + r.last_slot : ''}${r.order_no ? ' · order ' + r.order_no : ''}`);
  }
  return lines.join('\n');
}

async function cmdJob(pool, arg) {
  if (!arg) return 'Usage: /job <job card or plan id>';
  const { rows: [p] } = await pool.query(
    `SELECT * FROM plan_board WHERE (job_card_no ILIKE $1 OR plan_id ILIKE $1) ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [arg]
  ).catch(async () => pool.query('SELECT * FROM plan_board WHERE plan_id ILIKE $1 LIMIT 1', [arg]));
  if (!p) return `No job or plan "${arg}" found.`;
  const { rows: [d] } = await pool.query(
    `SELECT COALESCE(SUM(good_qty),0) AS good, COALESCE(SUM(reject_qty),0) AS rej, MAX(dpr_date) AS last
       FROM dpr_hourly WHERE plan_id = $1 AND COALESCE(is_deleted, false) = false`, [p.plan_id]
  );
  const { rows: [h] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM qc_holds WHERE status = 'ACTIVE' AND (job_card_no = $1 OR job_card_no = $2)`, [p.job_card_no || '', arg]
  ).catch(() => ({ rows: [{ n: 0 }] }));
  const plan = Number(p.plan_qty) || 0;
  const bal = Math.max(0, plan - Number(d.good));
  return [
    `🧾 ${p.job_card_no ? 'JC ' + p.job_card_no + ' · ' : ''}Plan ${p.plan_id}`,
    `${p.item_name || p.item_code || ''}${p.mould_name ? ' · mould ' + p.mould_name : ''}`,
    `Machine ${p.machine || '-'} · order ${p.order_no || '-'} · status ${p.status || '-'}${p.jc_approval_status ? ' · JC ' + p.jc_approval_status : ''}`,
    `Plan ${n(plan)} · produced ${n(d.good)} · balance ${n(bal)} · rejects ${n(d.rej)}${d.last ? ' · last DPR ' + String(d.last).slice(0, 10) : ''}`,
    h.n ? `🛑 ${h.n} open QC hold${h.n > 1 ? 's' : ''}` : '✅ No open QC holds'
  ].filter(Boolean).join('\n');
}

async function cmdOrder(pool, arg) {
  if (!arg) return 'Usage: /order <order no>';
  const { rows: [o] } = await pool.query('SELECT * FROM orders WHERE order_no ILIKE $1 LIMIT 1', [arg]);
  if (!o) return `No order "${arg}" found.`;
  const { rows: [d] } = await pool.query(
    `SELECT COALESCE(SUM(good_qty),0) AS good FROM dpr_hourly WHERE order_no = $1 AND COALESCE(is_deleted, false) = false`, [o.order_no]
  );
  const { rows: [pl] } = await pool.query(
    `SELECT COUNT(*)::int AS plans, COUNT(*) FILTER (WHERE UPPER(COALESCE(status,'')) IN ('RUNNING','IN PROGRESS'))::int AS running
       FROM plan_board WHERE order_no = $1`, [o.order_no]
  );
  return [
    `📦 Order ${o.order_no} · ${o.status || '-'}${o.priority && o.priority !== 'Normal' ? ' · ' + o.priority : ''}`,
    `${o.item_name || o.item_code || ''}${o.client_name ? ' · ' + o.client_name : ''}`,
    `Qty ${n(o.qty)} · produced ${n(d.good)} · balance ${n(o.balance)}`,
    `${pl.plans} plan${pl.plans === 1 ? '' : 's'}${pl.running ? ` · ${pl.running} running` : ''}`
  ].join('\n');
}

async function runCommand(pool, text, username) {
  // Parsed without a backtracking regex (CodeQL js/polynomial-redos), on a capped string.
  const t = String(text || '').slice(0, 200).trim();
  if (t[0] !== '/') return null;
  const sp = t.search(/\s/);
  const cmd = (sp === -1 ? t.slice(1) : t.slice(1, sp)).toLowerCase();
  if (!/^\w{1,20}$/.test(cmd)) return null;
  const arg = (sp === -1 ? '' : t.slice(sp + 1)).trim().slice(0, 60);
  const factories = await userFactoryIds(pool, username);
  if (cmd === 'help') return HELP;
  if (cmd === 'dpr') return cmdDpr(pool, arg, factories);
  if (cmd === 'job' || cmd === 'jc') return cmdJob(pool, arg);
  if (cmd === 'order') return cmdOrder(pool, arg);
  return `Unknown command /${cmd}.\n\n${HELP}`;
}

// ---------------- internal call into the existing JMS routes (approvals) ----------------
function internalCall(req, method, path, body, user) {
  return signSession(req.app.locals.chatPool, user).then((token) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: req.socket.localPort, method, path,
      headers: Object.assign({ Authorization: `Bearer ${token}`, Accept: 'application/json' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(buf || '{}'); } catch (_e) { j = { ok: false, error: 'Bad answer from JMS.' }; }
        resolve({ status: res.statusCode, json: j });
      });
    });
    r.on('error', reject);
    r.setTimeout(20000, () => r.destroy(new Error('JMS did not answer in time.')));
    if (data) r.write(data);
    r.end();
  }));
}

async function fullAccessUser(pool, username) {
  const { rows: [u] } = await pool.query(
    'SELECT id, username, role_code, global_access FROM users WHERE LOWER(username) = LOWER($1) AND COALESCE(is_active, TRUE) = TRUE', [username]
  );
  if (!u) return null;
  const role = String(u.role_code || '').toLowerCase();
  return u.global_access === true || role === 'admin' || role === 'superadmin' ? u : null;
}

// ---------------- routes ----------------
function registerBotRoutes(app, pool, h) {
  const { ready, fail, membership, decorate } = h;
  app.locals.chatPool = pool;

  // "/" command: posts the answer into the chat as JMS Bot
  app.post('/api/chat/command', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const b = req.body || {};
      const convId = String(b.conversation_sync_id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      if (!(await membership(pool, convId, req.auth.username))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const text = String(b.text || '').trim();
      const answer = await runCommand(pool, text, req.auth.username).catch((err) => `Could not run that: ${err.message}`);
      if (!answer) return res.status(400).json({ ok: false, error: 'Commands start with / (try /help).' });
      const m = await post(pool, convId, BOT, `${req.auth.username}: ${text}\n\n${answer}`, { bot: true });
      const { rows } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [m.sync_id]);
      res.json({ ok: true, message: (await decorate(pool, rows, req.auth.username))[0] });
    } catch (err) { fail(res, err, 'command'); }
  });

  // maintenance ticket from chat (photo optional: message_sync_id of a photo in this chat)
  app.post('/api/chat/maintenance', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureBotSchema(pool);
      const b = req.body || {};
      const convId = String(b.conversation_sync_id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      if (!(await membership(pool, convId, req.auth.username))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const machine = String(b.machine || '').trim().slice(0, 100);
      const problem = String(b.problem || '').trim().slice(0, 1000);
      if (!machine || !problem) return res.status(400).json({ ok: false, error: 'Enter the machine and the problem.' });
      const priority = ['low', 'normal', 'high', 'breakdown'].includes(String(b.priority || '')) ? String(b.priority) : 'high';
      const factories = await userFactoryIds(pool, req.auth.username);
      const factoryId = factories[0] || null;
      const helpers = app.locals.jmsMaintenance;
      const ticketNo = helpers ? await helpers.nextMaintenanceTicketNo(factoryId) : `MNT-${Date.now()}`;
      const photo = UUID_RE.test(String(b.message_sync_id || '')) ? ' (photo in JMS Chat)' : '';
      const { rows: [t] } = await pool.query(
        `INSERT INTO maintenance_tickets (ticket_no, asset_type, machine, status, priority, problem_desc, reported_by, factory_id)
         VALUES ($1, 'machine', $2, 'reported', $3, $4, $5, $6) RETURNING *`,
        [ticketNo, machine, priority, problem + photo, req.auth.username, factoryId]
      );
      if (helpers) await helpers.notifyMaintenance(t, factoryId, req.auth.username, 'opened').catch(() => {});
      await pool.query(
        'INSERT INTO chat_ticket_links (ticket_sync_id, conversation_sync_id, last_status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [t.sync_id, convId, t.status]
      );
      await post(pool, convId, BOT, `🔧 Maintenance ticket ${t.ticket_no} raised for ${machine} (${priority}) by ${req.auth.username}\n${problem}`, { bot: true, ticket: t.sync_id });
      res.json({ ok: true, ticket: { sync_id: t.sync_id, ticket_no: t.ticket_no } });
    } catch (err) { fail(res, err, 'maintenance ticket'); }
  });

  // job-card approvals waiting for me (full-access users only)
  app.get('/api/chat/approvals', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const u = await fullAccessUser(pool, req.auth.username);
      if (!u) return res.json({ ok: true, allowed: false, items: [] });
      const r = await internalCall(req, 'GET', '/api/planning/job-card-approvals', null, u);
      const items = (r.json && (r.json.data || r.json.rows || r.json.items)) || [];
      res.json({ ok: true, allowed: true, items: Array.isArray(items) ? items.slice(0, 100) : [] });
    } catch (err) { fail(res, err, 'approvals'); }
  });

  app.post('/api/chat/approvals/:id/action', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const u = await fullAccessUser(pool, req.auth.username);
      if (!u) return res.status(403).json({ ok: false, error: 'Approvals from chat need full JMS access (global login).' });
      const id = Number.parseInt(String(req.params.id || ''), 10);
      if (!id) return res.status(400).json({ ok: false, error: 'Bad approval id.' });
      const b = req.body || {};
      const action = String(b.action || '').toUpperCase() === 'REJECTED' ? 'REJECTED' : 'APPROVED';
      const remarks = String(b.remarks || '').slice(0, 500);
      const r = await internalCall(req, 'POST', `/api/planning/job-card-approvals/${id}/action`,
        { action, ppc_remarks: remarks, moulding_remarks: remarks }, u);
      if (r.status >= 400 || r.json.ok === false) return res.status(r.status >= 400 ? r.status : 400).json({ ok: false, error: r.json.error || 'Not done.' });
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'approval action'); }
  });

  // acknowledge a JMS Alerts message (stops escalation)
  app.post('/api/chat/messages/:id/ack', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureBotSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad message id.' });
      const { rows: [m] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [id]);
      if (!m || !(m.meta && m.meta.alert)) return res.status(400).json({ ok: false, error: 'Not an alert.' });
      if (!(await membership(pool, m.conversation_sync_id, req.auth.username))) return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      const { rows: [a] } = await pool.query(
        `INSERT INTO chat_alert_acks (message_sync_id, acked_by, acked_at) VALUES ($1, $2, NOW())
         ON CONFLICT (message_sync_id) DO UPDATE SET acked_by = COALESCE(chat_alert_acks.acked_by, EXCLUDED.acked_by),
           acked_at = COALESCE(chat_alert_acks.acked_at, EXCLUDED.acked_at) RETURNING *`, [id, req.auth.username]
      );
      if (a.acked_by.toLowerCase() === req.auth.username.toLowerCase()) {
        await post(pool, m.conversation_sync_id, BOT, `✋ ${req.auth.username} is on it: ${String(m.body).split('\n')[0]}`, { bot: true });
      }
      res.json({ ok: true, acked_by: a.acked_by, acked_at: a.acked_at });
    } catch (err) { fail(res, err, 'ack'); }
  });
}

/** For decorate(): alert message id -> { acked_by, acked_at } */
async function acksFor(pool, rows) {
  const ids = rows.filter((r) => r.meta && r.meta.alert).map((r) => r.sync_id);
  if (!ids.length) return new Map();
  await ensureBotSchema(pool);
  const { rows: acks } = await pool.query('SELECT * FROM chat_alert_acks WHERE message_sync_id = ANY($1::uuid[])', [ids]);
  return new Map(acks.map((a) => [a.message_sync_id, a]));
}

// ---------------- background jobs ----------------
async function ticketUpdates(db) {
  const { rows } = await db.query(
    `SELECT l.ticket_sync_id, l.conversation_sync_id, l.last_status, t.status, t.ticket_no, t.machine, t.fix_desc, t.rejected_reason, t.assigned_to
       FROM chat_ticket_links l JOIN maintenance_tickets t ON t.sync_id = l.ticket_sync_id
      WHERE t.status IS DISTINCT FROM l.last_status AND l.created_at > NOW() - INTERVAL '30 days' LIMIT 50`
  ).catch(() => ({ rows: [] }));
  const label = { acknowledged: '👀 acknowledged', in_progress: '🛠 work started', handover: '✅ handed back to production', rejected: '❌ rejected (not maintenance)', closed: '✅ closed' };
  for (const r of rows) {
    const extra = r.status === 'handover' && r.fix_desc ? `\nFix: ${r.fix_desc}` : r.status === 'rejected' && r.rejected_reason ? `\nReason: ${r.rejected_reason}` : r.status === 'acknowledged' && r.assigned_to ? ` · assigned to ${r.assigned_to}` : '';
    await post(db, r.conversation_sync_id, BOT, `🔧 ${r.ticket_no} · ${r.machine}: ${label[r.status] || r.status}${extra}`, { bot: true, ticket: r.ticket_sync_id });
    await db.query('UPDATE chat_ticket_links SET last_status = $2 WHERE ticket_sync_id = $1', [r.ticket_sync_id, r.status]);
  }
}

async function escalate(db) {
  const { rows } = await db.query(
    `SELECT m.sync_id, m.body, m.server_ts, m.conversation_sync_id, COALESCE(a.escalated_level, 0) AS level,
            (SELECT g.key FROM chat_auto_groups g WHERE g.conversation_sync_id = m.conversation_sync_id LIMIT 1) AS gkey
       FROM chat_messages m LEFT JOIN chat_alert_acks a ON a.message_sync_id = m.sync_id
      WHERE m.meta ? 'alert' AND m.server_ts > NOW() - INTERVAL '6 hours' AND a.acked_at IS NULL
        AND ((COALESCE(a.escalated_level, 0) = 0 AND m.server_ts < NOW() - INTERVAL '30 minutes')
          OR (COALESCE(a.escalated_level, 0) = 1 AND m.server_ts < NOW() - INTERVAL '60 minutes'))
      LIMIT 30`
  ).catch(() => ({ rows: [] }));
  for (const r of rows) {
    const level = Number(r.level) + 1;
    const factoryId = r.gkey && /^factory:(\d+)$/.test(r.gkey) ? Number(r.gkey.split(':')[1]) : null;
    const roles = level === 1 ? MANAGER_ROLES : ['superadmin'];
    const { rows: people } = await db.query(
      `SELECT DISTINCT u.username FROM users u LEFT JOIN user_factories uf ON uf.user_id = u.id
        WHERE COALESCE(u.is_active, TRUE) AND LOWER(COALESCE(u.role_code,'')) = ANY($1::text[])
          AND ($2::int IS NULL OR LOWER(COALESCE(u.role_code,'')) = 'superadmin' OR uf.factory_id = $2)`, [roles, factoryId]
    ).catch(() => ({ rows: [] }));
    const first = String(r.body).split('\n')[0];
    if (people.length) {
      chatFcm.sendToUsers(db, people.map((p) => p.username), {
        type: 'chat', title: `⚠ Not handled for ${level === 1 ? 30 : 60} min`, body: first, sender: ALERTS,
        conversation_sync_id: String(r.conversation_sync_id), message_sync_id: String(r.sync_id), is_group: '1', unread: '1', urgent: '1'
      }).catch(() => {});
    }
    await post(db, r.conversation_sync_id, BOT,
      `⏫ Escalated to ${level === 1 ? 'managers' : 'superadmins'} — nobody acknowledged in ${level === 1 ? 30 : 60} min: ${first}`, { bot: true });
    await db.query(
      `INSERT INTO chat_alert_acks (message_sync_id, escalated_level) VALUES ($1, $2)
       ON CONFLICT (message_sync_id) DO UPDATE SET escalated_level = EXCLUDED.escalated_level`, [r.sync_id, level]
    );
  }
}

async function shiftSummary(db) {
  const now = istNow();
  const h = now.getUTCHours(), mi = now.getUTCMinutes();
  if (!((h === 8 || h === 20) && mi >= 5 && mi < 15)) return;
  // the shift that just ended
  const ended = new Date(now.getTime() - 30 * 60000);
  const { date, shift } = currentShift(ended);
  const key = `summary:${date}:${shift}`;
  const { rows: [done] } = await db.query('SELECT 1 FROM chat_bot_state WHERE name = $1', [key]);
  if (done) return;
  await db.query('INSERT INTO chat_bot_state (name, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [key, new Date().toISOString()]);
  const { rows: groups } = await db.query(`SELECT key, conversation_sync_id FROM chat_auto_groups WHERE key LIKE 'factory:%'`).catch(() => ({ rows: [] }));
  for (const g of groups) {
    const fid = Number(g.key.split(':')[1]);
    const { rows: [t] } = await db.query(
      `SELECT COALESCE(SUM(good_qty),0) AS good, COALESCE(SUM(reject_qty),0) AS rej, COALESCE(SUM(downtime_min),0) AS dt,
              COUNT(DISTINCT machine)::int AS machines
         FROM dpr_hourly WHERE dpr_date = $1 AND shift ILIKE $2 AND COALESCE(is_deleted,false) = false AND factory_id = $3`,
      [date, shift, fid]
    ).catch(() => ({ rows: [{}] }));
    const { rows: top } = await db.query(
      `SELECT machine, SUM(downtime_min) AS dt FROM dpr_hourly
        WHERE dpr_date = $1 AND shift ILIKE $2 AND COALESCE(is_deleted,false) = false AND factory_id = $3
        GROUP BY machine HAVING SUM(downtime_min) > 0 ORDER BY SUM(downtime_min) DESC LIMIT 3`, [date, shift, fid]
    ).catch(() => ({ rows: [] }));
    const { rows: [holds] } = await db.query(`SELECT COUNT(*)::int AS n FROM qc_holds WHERE status = 'ACTIVE' AND factory_id = $1`, [fid]).catch(() => ({ rows: [{ n: 0 }] }));
    if (!t || !Number(t.machines)) continue;
    const rejPct = Number(t.good) + Number(t.rej) > 0 ? (Number(t.rej) * 100 / (Number(t.good) + Number(t.rej))).toFixed(1) : '0.0';
    const lines = [
      `📊 Shift summary · ${date} ${shift}`,
      `Machines reporting: ${t.machines}`,
      `Good: ${n(t.good)} · Rejects: ${n(t.rej)} (${rejPct}%)`,
      `Downtime: ${n(t.dt)} min${top.length ? ' · most: ' + top.map((x) => `${x.machine} ${n(x.dt)}m`).join(', ') : ''}`,
      `Open QC holds: ${holds.n}`
    ];
    await post(db, g.conversation_sync_id, ALERTS, lines.join('\n'), { summary: true });
  }
}

function start(pool) {
  if (chatSync.isLocal()) return;
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
      await ensureBotSchema(client);
      await ticketUpdates(client);
      await escalate(client);
      await shiftSummary(client);
    } catch (err) {
      console.warn('[chat-bot]', err.message);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK]).catch(() => {});
      client.release();
      running = false;
    }
  }
  const every = setInterval(tick, 60 * 1000);
  if (every.unref) every.unref();
}

module.exports = { registerBotRoutes, ensureBotSchema, acksFor, runCommand, start, currentShift, HELP, __test: { cmdDpr, cmdJob, cmdOrder } };
