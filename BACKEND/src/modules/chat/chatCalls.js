'use strict';

// JMS Chat voice calls (1-to-1, audio only, WebRTC in the app; MAIN only).
//
// The server only sets calls up. Both phones exchange the WebRTC offer / answer / ICE
// candidates through chat_call_signals and pick them up by polling
// GET /api/chat/calls/:id/signals?after=<seq> (works across PM2 workers and when the
// callee's app was closed). The callee is woken with an FCM data push { type: 'call' }.
// Audio flows phone to phone; on mobile data a TURN relay is usually needed:
//   TURN_URLS    comma list, e.g. "turn:jmsocean.cloud:3478,turn:jmsocean.cloud:3478?transport=tcp"
//   TURN_SECRET  coturn "static-auth-secret": short-lived credentials are made per call
// Without TURN, only STUN (Google) is offered: calls work on the same Wi-Fi and on many
// home networks, but often fail between two mobile-data phones.
//
// Each call ends with one line in the direct chat: "📞 Voice call · 3:21",
// "📞 Missed voice call" or "📞 Declined voice call".

const crypto = require('crypto');
const chatSync = require('./chatSync');
const chatFcm = require('./chatFcm');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RING_SECONDS = 45;
const MAX_SIGNAL = 16 * 1024;
const DM_ID = chatSync.deterministicIdSql('chat-dm', '$1::text');
const MEMBER_ID = chatSync.deterministicIdSql('chat-member', '$1::uuid', 'LOWER($2::text)');

let schemaReady = null;
function ensureCallSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_calls (
        id UUID PRIMARY KEY,
        caller TEXT NOT NULL,
        callee TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ringing',   -- ringing / accepted / ended / declined / missed / cancelled
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        answered_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        ended_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chat_calls_callee ON chat_calls (LOWER(callee), created_at DESC);
      CREATE TABLE IF NOT EXISTS chat_call_signals (
        seq BIGSERIAL PRIMARY KEY,
        call_id UUID NOT NULL,
        from_user TEXT NOT NULL,
        kind TEXT NOT NULL,      -- offer / answer / ice
        data TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_call_signals_call ON chat_call_signals (call_id, seq);
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

/** ICE servers for one call: Google STUN, plus TURN with time-limited credentials. */
function iceServers(username) {
  const out = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const urls = String(process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const secret = String(process.env.TURN_SECRET || '').trim();
  if (urls.length && secret) {
    const expires = Math.floor(Date.now() / 1000) + 6 * 3600;
    const user = `${expires}:${String(username).replace(/[^A-Za-z0-9_.-]/g, '')}`;
    const credential = crypto.createHmac('sha1', secret).update(user).digest('base64');
    out.push({ urls, username: user, credential });
  }
  return out;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The direct chat between two people (made if needed), for the call history line.
async function dmFor(pool, a, b) {
  const key = [a.toLowerCase(), b.toLowerCase()].sort().join('|');
  await pool.query(
    `INSERT INTO chat_conversations (sync_id, type, dm_key, created_by) VALUES (${DM_ID}, 'direct', $1, $2) ON CONFLICT DO NOTHING`,
    [key, a]
  );
  const { rows: [c] } = await pool.query('SELECT sync_id FROM chat_conversations WHERE dm_key = $1', [key]);
  for (const name of [a, b]) {
    await pool.query(
      `INSERT INTO chat_members (sync_id, conversation_sync_id, username) VALUES (${MEMBER_ID}, $1, $2)
       ON CONFLICT (conversation_sync_id, (LOWER(username))) DO UPDATE SET left_at = NULL, updated_at = NOW()
       WHERE chat_members.left_at IS NOT NULL`, [c.sync_id, name]
    );
  }
  return c.sync_id;
}

// Tell an open JMS web page (any worker) about a call: { type: 'call' | 'call_end' }.
function liveCall(pool, username, event) {
  pool.query("SELECT pg_notify('jms_chat', $1)", [JSON.stringify({ t: 'call', u: username, ev: event, e: true })]).catch(() => {});
}

async function historyLine(pool, call) {
  try {
    const conv = await dmFor(pool, call.caller, call.callee);
    let text;
    if (call.status === 'ended' && call.answered_at) {
      text = `📞 Voice call · ${fmtDuration(new Date(call.ended_at) - new Date(call.answered_at))}`;
    } else if (call.status === 'declined') {
      text = `📞 Declined voice call from ${call.caller}`;
    } else {
      text = `📞 Missed voice call from ${call.caller}`;
    }
    const { rows: [m] } = await pool.query(
      `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind) VALUES ($1, $2, $3, 'system') RETURNING server_ts`,
      [conv, call.caller, text]
    );
    await pool.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [conv, m.server_ts]);
  } catch (err) {
    console.warn('[chat-call] history line:', err.message);
  }
}

// Ringing calls nobody answered within RING_SECONDS become missed.
async function expireRinging(pool) {
  const { rows } = await pool.query(
    `UPDATE chat_calls SET status = 'missed', ended_at = NOW()
      WHERE status = 'ringing' AND created_at < NOW() - make_interval(secs => $1) RETURNING *`, [RING_SECONDS]
  );
  for (const c of rows) {
    await historyLine(pool, c);
    liveCall(pool, c.callee, { type: 'call_end', call_id: c.id, reason: 'missed' });
    liveCall(pool, c.caller, { type: 'call_end', call_id: c.id, reason: 'missed' });
    chatFcm.sendToUsers(pool, [c.callee], { type: 'call_end', call_id: c.id, reason: 'missed', caller: c.caller }).catch(() => {});
  }
}

function registerCallRoutes(app, pool, { ready, fail, activeUser }) {
  async function myCall(req, res) {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) { res.status(400).json({ ok: false, error: 'Bad call id.' }); return null; }
    await ensureCallSchema(pool);
    const { rows: [c] } = await pool.query('SELECT * FROM chat_calls WHERE id = $1', [id]);
    const me = req.auth.username.toLowerCase();
    if (!c || (c.caller.toLowerCase() !== me && c.callee.toLowerCase() !== me)) {
      res.status(404).json({ ok: false, error: 'Call not found.' });
      return null;
    }
    return c;
  }

  const out = (c, me) => ({
    id: c.id, caller: c.caller, callee: c.callee, status: c.status,
    created_at: c.created_at, answered_at: c.answered_at, ended_at: c.ended_at,
    peer: c.caller.toLowerCase() === me.toLowerCase() ? c.callee : c.caller,
    incoming: c.callee.toLowerCase() === me.toLowerCase()
  });

  app.post('/api/chat/calls', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      if (chatSync.isLocal()) return res.status(400).json({ ok: false, error: 'Calls work on the main JMS server.' });
      await ensureCallSchema(pool);
      await expireRinging(pool);
      const me = req.auth.username;
      const to = await activeUser(pool, String((req.body && req.body.to) || '').trim());
      if (!to) return res.status(400).json({ ok: false, error: 'That user was not found.' });
      if (to.toLowerCase() === me.toLowerCase()) return res.status(400).json({ ok: false, error: 'You cannot call yourself.' });
      const { rows: [busy] } = await pool.query(
        `SELECT 1 FROM chat_calls WHERE status IN ('ringing', 'accepted')
           AND (LOWER(caller) = LOWER($1) OR LOWER(callee) = LOWER($1)) AND created_at > NOW() - INTERVAL '4 hours' LIMIT 1`, [to]
      );
      const id = crypto.randomUUID();
      if (busy) {
        await pool.query(`INSERT INTO chat_calls (id, caller, callee, status, ended_at) VALUES ($1, $2, $3, 'missed', NOW())`, [id, me, to]);
        await historyLine(pool, { caller: me, callee: to, status: 'missed' });
        return res.status(409).json({ ok: false, error: `${to} is on another call.` });
      }
      const { rows: [c] } = await pool.query(
        'INSERT INTO chat_calls (id, caller, callee) VALUES ($1, $2, $3) RETURNING *', [id, me, to]
      );
      liveCall(pool, to, { type: 'call', call_id: id, caller: me });
      const push = await chatFcm.sendToUsers(pool, [to], { type: 'call', call_id: id, caller: me, title: me, body: 'Incoming voice call' })
        .catch(() => ({ sent: 0 }));
      res.json({ ok: true, call: out(c, me), ice: iceServers(me), ring_seconds: RING_SECONDS, pushed: push.sent > 0 });
    } catch (err) { fail(res, err, 'call'); }
  });

  app.get('/api/chat/calls/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await expireRinging(pool);
      const c = await myCall(req, res);
      if (!c) return;
      res.json({ ok: true, call: out(c, req.auth.username), ice: iceServers(req.auth.username) });
    } catch (err) { fail(res, err, 'call status'); }
  });

  for (const action of ['accept', 'decline', 'end']) {
    app.post(`/api/chat/calls/:id/${action}`, async (req, res) => {
      try {
        if (!(await ready(req, res))) return;
        const c = await myCall(req, res);
        if (!c) return;
        const me = req.auth.username;
        const isCallee = c.callee.toLowerCase() === me.toLowerCase();
        let row;
        if (action === 'accept') {
          if (!isCallee) return res.status(403).json({ ok: false, error: 'Only the person called can answer.' });
          ({ rows: [row] } = await pool.query(
            `UPDATE chat_calls SET status = 'accepted', answered_at = NOW() WHERE id = $1 AND status = 'ringing' RETURNING *`, [c.id]
          ));
          if (!row) return res.status(410).json({ ok: false, error: 'This call has ended.' });
        } else {
          const status = action === 'decline' || (c.status === 'ringing' && isCallee) ? 'declined'
            : (c.status === 'ringing' ? 'missed' : 'ended');
          ({ rows: [row] } = await pool.query(
            `UPDATE chat_calls SET status = $2, ended_at = NOW(), ended_by = $3
              WHERE id = $1 AND status IN ('ringing', 'accepted') RETURNING *`, [c.id, status, me]
          ));
          if (row) {
            await historyLine(pool, row);
            // stop the other phone ringing / end its call even if its app is in the background
            const other = isCallee ? c.caller : c.callee;
            chatFcm.sendToUsers(pool, [other], { type: 'call_end', call_id: c.id, reason: status, caller: c.caller }).catch(() => {});
            liveCall(pool, other, { type: 'call_end', call_id: c.id, reason: status });
          } else {
            row = c; // already over
          }
        }
        res.json({ ok: true, call: out(row, me) });
      } catch (err) { fail(res, err, `call ${action}`); }
    });
  }

  // WebRTC offer / answer / ICE candidate from one phone to the other
  app.post('/api/chat/calls/:id/signal', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const c = await myCall(req, res);
      if (!c) return;
      if (!['ringing', 'accepted'].includes(c.status)) return res.status(410).json({ ok: false, error: 'This call has ended.' });
      const kind = String((req.body && req.body.kind) || '');
      const data = typeof req.body.data === 'string' ? req.body.data : JSON.stringify(req.body.data || null);
      if (!['offer', 'answer', 'ice'].includes(kind)) return res.status(400).json({ ok: false, error: 'Bad signal.' });
      if (data.length > MAX_SIGNAL) return res.status(413).json({ ok: false, error: 'Signal too big.' });
      const { rows: [s] } = await pool.query(
        'INSERT INTO chat_call_signals (call_id, from_user, kind, data) VALUES ($1, $2, $3, $4) RETURNING seq',
        [c.id, req.auth.username, kind, data]
      );
      res.json({ ok: true, seq: Number(s.seq) });
    } catch (err) { fail(res, err, 'call signal'); }
  });

  // Signals from the OTHER phone after ?after=<seq>, plus the call's status.
  app.get('/api/chat/calls/:id/signals', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await expireRinging(pool);
      const c = await myCall(req, res);
      if (!c) return;
      const after = Number.parseInt(String(req.query.after || '0'), 10) || 0;
      const { rows } = await pool.query(
        `SELECT seq, kind, data FROM chat_call_signals
          WHERE call_id = $1 AND seq > $2 AND LOWER(from_user) <> LOWER($3) ORDER BY seq LIMIT 100`,
        [c.id, after, req.auth.username]
      );
      res.json({ ok: true, status: c.status, signals: rows.map((r) => ({ seq: Number(r.seq), kind: r.kind, data: r.data })) });
    } catch (err) { fail(res, err, 'call signals'); }
  });

  // Recent calls (call log)
  app.get('/api/chat/calls', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureCallSchema(pool);
      const { rows } = await pool.query(
        `SELECT * FROM chat_calls WHERE LOWER(caller) = LOWER($1) OR LOWER(callee) = LOWER($1)
          ORDER BY created_at DESC LIMIT 100`, [req.auth.username]
      );
      res.json({ ok: true, calls: rows.map((c) => out(c, req.auth.username)) });
    } catch (err) { fail(res, err, 'call log'); }
  });

  // Old signals are of no use once a call is over.
  const cleanup = setInterval(() => {
    pool.query(`DELETE FROM chat_call_signals WHERE created_at < NOW() - INTERVAL '1 day'`).catch(() => {});
  }, 6 * 3600 * 1000);
  if (cleanup.unref) cleanup.unref();
}

module.exports = { registerCallRoutes, ensureCallSchema, iceServers, fmtDuration, RING_SECONDS };
