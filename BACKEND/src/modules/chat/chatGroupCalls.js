'use strict';

// JMS Chat phase E: group voice calls (MAIN only).
//
// One "room" per group at a time, up to MAX_PEOPLE. Audio is a WebRTC mesh: every phone
// talks to every other phone. Signals (offer / answer / ICE) are addressed to one person
// (to_user) and picked up by polling GET /api/chat/rooms/:id/poll?after=<seq>, which also
// returns who is in the room and keeps me "seen". Someone not seen for STALE_SECONDS
// (app killed, no network) is taken out; the room ends when nobody is left and posts
// "📞 Group call · 4 people · 12:30" in the group.
//
// Who offers: in each pair, the one who joined LATER sends the offer (same time: the
// larger username). Each side decides this from the participant list alone, so two
// people joining together never both offer, and a rejoin (new joined_at) starts fresh.
//
// Group members get an FCM push { type: 'group_call' } (a notification with Join, not a
// ringing phone) and an open web page gets the same as a live event.

const crypto = require('crypto');
const chatSync = require('./chatSync');
const chatFcm = require('./chatFcm');
const chatCalls = require('./chatCalls');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PEOPLE = 8;
const STALE_SECONDS = 25;
const MAX_SIGNAL = 16 * 1024;

let schemaReady = null;
function ensureRoomSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_rooms (
        id UUID PRIMARY KEY,
        conversation_sync_id UUID NOT NULL,
        started_by TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        peak INT NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_live ON chat_rooms (conversation_sync_id) WHERE ended_at IS NULL;
      CREATE TABLE IF NOT EXISTS chat_room_members (
        room_id UUID NOT NULL,
        username TEXT NOT NULL,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_room_members ON chat_room_members (room_id, LOWER(username));
      CREATE TABLE IF NOT EXISTS chat_room_signals (
        seq BIGSERIAL PRIMARY KEY,
        room_id UUID NOT NULL,
        from_user TEXT NOT NULL,
        to_user TEXT NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_room_signals_to ON chat_room_signals (room_id, LOWER(to_user), seq);
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function live(pool, users, event) {
  for (const u of users) {
    pool.query("SELECT pg_notify('jms_chat', $1)", [JSON.stringify({ t: 'call', u, ev: event, e: true })]).catch(() => {});
  }
}

async function groupMembers(pool, convId) {
  const { rows } = await pool.query(
    'SELECT username FROM chat_members WHERE conversation_sync_id = $1 AND left_at IS NULL', [convId]
  );
  return rows.map((r) => r.username);
}

async function participants(pool, roomId) {
  const { rows } = await pool.query(
    `SELECT username, joined_at FROM chat_room_members WHERE room_id = $1 AND left_at IS NULL ORDER BY joined_at, LOWER(username)`,
    [roomId]
  );
  return rows.map((r) => ({ username: r.username, joined_at: r.joined_at }));
}

// Take out people not seen lately; end rooms with nobody left (with the history line).
async function sweep(pool) {
  await pool.query(
    `UPDATE chat_room_members m SET left_at = NOW() FROM chat_rooms r
      WHERE r.id = m.room_id AND r.ended_at IS NULL AND m.left_at IS NULL
        AND m.seen_at < NOW() - make_interval(secs => $1)`, [STALE_SECONDS]
  );
  const { rows: ended } = await pool.query(
    `UPDATE chat_rooms r SET ended_at = NOW()
      WHERE r.ended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = r.id AND m.left_at IS NULL)
        AND r.started_at < NOW() - INTERVAL '5 seconds'
      RETURNING *`
  );
  for (const r of ended) await endedLine(pool, r);
}

async function endedLine(pool, room) {
  try {
    const { rows: [n] } = await pool.query('SELECT COUNT(*)::int AS n FROM chat_room_members WHERE room_id = $1', [room.id]);
    const people = Math.max(n ? n.n : 1, room.peak || 1);
    const text = people > 1
      ? `📞 Group call · ${people} people · ${chatCalls.fmtDuration(new Date(room.ended_at) - new Date(room.started_at))}`
      : `📞 Group call by ${room.started_by} · nobody joined`;
    const { rows: [m] } = await pool.query(
      `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind) VALUES ($1, $2, $3, 'system') RETURNING server_ts`,
      [room.conversation_sync_id, room.started_by, text]
    );
    await pool.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1',
      [room.conversation_sync_id, m.server_ts]);
    live(pool, await groupMembers(pool, room.conversation_sync_id), { type: 'group_call_end', room_id: room.id, conversation_sync_id: room.conversation_sync_id });
  } catch (err) {
    console.warn('[chat-room] history line:', err.message);
  }
}

function registerGroupCallRoutes(app, pool, { ready, fail, membership }) {
  const lc = (s) => String(s).toLowerCase();

  async function myRoom(req, res, mustBeIn = true) {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) { res.status(400).json({ ok: false, error: 'Bad call id.' }); return null; }
    await ensureRoomSchema(pool);
    const { rows: [r] } = await pool.query('SELECT * FROM chat_rooms WHERE id = $1', [id]);
    if (!r || !(await membership(pool, r.conversation_sync_id, req.auth.username))) {
      res.status(404).json({ ok: false, error: 'Call not found.' });
      return null;
    }
    if (mustBeIn) {
      const { rows: [m] } = await pool.query(
        'SELECT 1 FROM chat_room_members WHERE room_id = $1 AND LOWER(username) = LOWER($2) AND left_at IS NULL', [id, req.auth.username]
      );
      if (!m && !r.ended_at) { res.status(409).json({ ok: false, error: 'You are not in this call.', left: true }); return null; }
    }
    return r;
  }

  // Start the group's call, or join the one already going.
  app.post('/api/chat/groups/:id/call', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      if (chatSync.isLocal()) return res.status(400).json({ ok: false, error: 'Calls work on the main JMS server.' });
      const convId = String(req.params.id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      const me = req.auth.username;
      if (!(await membership(pool, convId, me))) return res.status(403).json({ ok: false, error: 'You are not in this group.' });
      const { rows: [cv] } = await pool.query('SELECT type, title FROM chat_conversations WHERE sync_id = $1', [convId]);
      if (!cv || cv.type !== 'group') return res.status(400).json({ ok: false, error: 'Group calls are for groups.' });
      await ensureRoomSchema(pool);
      await chatCalls.ensureCallSchema(pool);
      await sweep(pool);
      const { rows: [busy] } = await pool.query(
        `SELECT 1 FROM chat_calls WHERE status IN ('ringing', 'accepted') AND (LOWER(caller) = LOWER($1) OR LOWER(callee) = LOWER($1))
           AND created_at > NOW() - INTERVAL '4 hours' LIMIT 1`, [me]
      );
      if (busy) return res.status(409).json({ ok: false, error: 'End your other call first.' });

      let started = false;
      let { rows: [room] } = await pool.query('SELECT * FROM chat_rooms WHERE conversation_sync_id = $1 AND ended_at IS NULL', [convId]);
      if (!room) {
        ({ rows: [room] } = await pool.query(
          `INSERT INTO chat_rooms (id, conversation_sync_id, started_by) VALUES ($1, $2, $3)
           ON CONFLICT (conversation_sync_id) WHERE ended_at IS NULL DO NOTHING RETURNING *`,
          [crypto.randomUUID(), convId, me]
        ));
        if (room) started = true;
        else ({ rows: [room] } = await pool.query('SELECT * FROM chat_rooms WHERE conversation_sync_id = $1 AND ended_at IS NULL', [convId]));
      }
      const inNow = await participants(pool, room.id);
      if (!inNow.some((p) => lc(p.username) === lc(me)) && inNow.length >= MAX_PEOPLE) {
        return res.status(409).json({ ok: false, error: `This call is full (${MAX_PEOPLE} people).` });
      }
      // (re)join: a fresh joined_at tells the others to connect to me again
      const { rows: [mine] } = await pool.query(
        `INSERT INTO chat_room_members (room_id, username) VALUES ($1, $2)
         ON CONFLICT (room_id, LOWER(username)) DO UPDATE
           SET joined_at = CASE WHEN chat_room_members.left_at IS NULL THEN chat_room_members.joined_at ELSE NOW() END,
               left_at = NULL, seen_at = NOW()
         RETURNING joined_at`, [room.id, me]
      );
      const list = await participants(pool, room.id);
      await pool.query('UPDATE chat_rooms SET peak = GREATEST(peak, $2) WHERE id = $1', [room.id, list.length]);
      if (started) {
        const others = (await groupMembers(pool, convId)).filter((u) => lc(u) !== lc(me));
        const ev = { type: 'group_call', room_id: room.id, conversation_sync_id: convId, title: cv.title || 'Group', caller: me };
        live(pool, others, ev);
        chatFcm.sendToUsers(pool, others, {
          type: 'group_call', room_id: room.id, conversation_sync_id: convId, caller: me,
          title: cv.title || 'Group', body: `📞 ${me} started a group call`
        }).catch(() => {});
      }
      res.json({
        ok: true, started,
        room: { id: room.id, conversation_sync_id: convId, title: cv.title || 'Group', started_at: room.started_at },
        me: { username: me, joined_at: mine.joined_at },
        participants: list, ice: chatCalls.iceServers(me), max: MAX_PEOPLE
      });
    } catch (err) { fail(res, err, 'group call'); }
  });

  // Group calls going on now in my chats (for "Join" banners).
  app.get('/api/chat/rooms/active', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureRoomSchema(pool);
      await sweep(pool);
      const { rows } = await pool.query(
        `SELECT r.id, r.conversation_sync_id, r.started_by, r.started_at,
                (SELECT COUNT(*)::int FROM chat_room_members x WHERE x.room_id = r.id AND x.left_at IS NULL) AS people,
                EXISTS (SELECT 1 FROM chat_room_members x WHERE x.room_id = r.id AND x.left_at IS NULL
                          AND LOWER(x.username) = LOWER($1)) AS joined
           FROM chat_rooms r
           JOIN chat_members mb ON mb.conversation_sync_id = r.conversation_sync_id
                               AND LOWER(mb.username) = LOWER($1) AND mb.left_at IS NULL
          WHERE r.ended_at IS NULL`, [req.auth.username]
      );
      res.json({ ok: true, rooms: rows });
    } catch (err) { fail(res, err, 'active calls'); }
  });

  app.post('/api/chat/rooms/:id/signal', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const r = await myRoom(req, res);
      if (!r) return;
      if (r.ended_at) return res.status(410).json({ ok: false, error: 'This call has ended.' });
      const b = req.body || {};
      const kind = String(b.kind || '');
      const to = String(b.to || '').trim();
      const data = typeof b.data === 'string' ? b.data : JSON.stringify(b.data || null);
      if (!['offer', 'answer', 'ice'].includes(kind) || !to) return res.status(400).json({ ok: false, error: 'Bad signal.' });
      if (data.length > MAX_SIGNAL) return res.status(413).json({ ok: false, error: 'Signal too big.' });
      const { rows: [s] } = await pool.query(
        'INSERT INTO chat_room_signals (room_id, from_user, to_user, kind, data) VALUES ($1, $2, $3, $4, $5) RETURNING seq',
        [r.id, req.auth.username, to, kind, data]
      );
      res.json({ ok: true, seq: Number(s.seq) });
    } catch (err) { fail(res, err, 'call signal'); }
  });

  // Who is in, signals for me after ?after=<seq>; also marks me as still here.
  app.get('/api/chat/rooms/:id/poll', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const r = await myRoom(req, res);
      if (!r) return;
      if (!r.ended_at) {
        await pool.query('UPDATE chat_room_members SET seen_at = NOW() WHERE room_id = $1 AND LOWER(username) = LOWER($2)', [r.id, req.auth.username]);
        await sweep(pool);
      }
      const after = Number.parseInt(String(req.query.after || '0'), 10) || 0;
      const { rows } = await pool.query(
        `SELECT seq, from_user, kind, data FROM chat_room_signals
          WHERE room_id = $1 AND LOWER(to_user) = LOWER($2) AND seq > $3 ORDER BY seq LIMIT 200`,
        [r.id, req.auth.username, after]
      );
      const { rows: [now] } = await pool.query('SELECT ended_at FROM chat_rooms WHERE id = $1', [r.id]);
      res.json({
        ok: true, status: now && now.ended_at ? 'ended' : 'live',
        participants: await participants(pool, r.id),
        signals: rows.map((s) => ({ seq: Number(s.seq), from: s.from_user, kind: s.kind, data: s.data }))
      });
    } catch (err) { fail(res, err, 'call poll'); }
  });

  app.post('/api/chat/rooms/:id/leave', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const r = await myRoom(req, res, false);
      if (!r) return;
      await pool.query('UPDATE chat_room_members SET left_at = NOW() WHERE room_id = $1 AND LOWER(username) = LOWER($2) AND left_at IS NULL',
        [r.id, req.auth.username]);
      const { rows: [ended] } = await pool.query(
        `UPDATE chat_rooms SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = $1 AND m.left_at IS NULL) RETURNING *`, [r.id]
      );
      if (ended) await endedLine(pool, ended);
      res.json({ ok: true, ended: Boolean(ended) });
    } catch (err) { fail(res, err, 'leave call'); }
  });

  const cleanup = setInterval(() => {
    pool.query(`DELETE FROM chat_room_signals WHERE created_at < NOW() - INTERVAL '1 day'`).catch(() => {});
    if (schemaReady) sweep(pool).catch(() => {});
  }, 60 * 1000);
  if (cleanup.unref) cleanup.unref();
}

module.exports = { registerGroupCallRoutes, ensureRoomSchema, MAX_PEOPLE, STALE_SECONDS, __test: { sweep } };
