'use strict';

/**
 * Packing day close and lost time (step 11).
 *
 *  - GET  /api/packing/day-close?station=&day=     the station's day: plan vs packed per plan, the
 *                                                  stoppages found from the scans, and the saved close
 *  - POST /api/packing/day-close                   { station, day, lines:[{plan_id, reason, note}],
 *                                                    stoppages:[{key, reason, note}] } close the day.
 *                                                  Every short plan and every stoppage needs a reason.
 *  - POST /api/packing/day-close/reopen            { station, day, pin, reason } supervisor PIN
 *  - GET  /api/packing/day-close/open              stations with an earlier day not closed (live screen)
 *  - GET  /api/packing/loss-reasons[?all=1]        the reasons list
 *  - POST /api/packing/loss-reasons                { id?, label, needs_note, is_active } MAIN only, masters edit
 *
 * Nothing is carried forward: what is left on a plan stays on the station's jobs list.
 * packing_loss_reasons is a MAIN-only master (id key); packing_day_closes is written where
 * the supervisor works (usually the factory LOCAL) and replicates up by sync_id.
 */

const { getFactoryId, getRequestUsername, normalizeFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const { ensurePackingSchema, canEditMasters } = require('./registerPackingMasterRoutes');
const dc = require('./packingDayClose');

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';
const serverFactoryId = () => (isLocalServer() ? normalizeFactoryId(process.env.LOCAL_FACTORY_ID) : null);
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const OPEN_PLAN_DAYS = 7;
const UNCLOSED_LOOKBACK_DAYS = 3;
const MAX_REASONS = 40;

async function ensureDayCloseSchema(pool) {
  await ensurePackingSchema(pool);
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_day_close_schema'));
    CREATE TABLE IF NOT EXISTS packing_loss_reasons (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      needs_note BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ix_packing_loss_reasons_updated ON packing_loss_reasons (updated_at);
    CREATE TABLE IF NOT EXISTS packing_day_closes (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL DEFAULT gen_random_uuid(),
      factory_id INTEGER,
      station_name TEXT NOT NULL,
      day DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'CLOSED',
      plan_qty INTEGER NOT NULL DEFAULT 0,
      packed_qty INTEGER NOT NULL DEFAULT 0,
      short_qty INTEGER NOT NULL DEFAULT 0,
      lost_min INTEGER NOT NULL DEFAULT 0,
      lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      stoppages JSONB NOT NULL DEFAULT '[]'::jsonb,
      closed_by TEXT,
      closed_at TIMESTAMPTZ,
      reopen_count INTEGER NOT NULL DEFAULT 0,
      reopened_by TEXT,
      reopened_at TIMESTAMPTZ,
      last_reopen_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_day_closes ON packing_day_closes (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_day_closes_day ON packing_day_closes (factory_id, day, LOWER(station_name));
    CREATE INDEX IF NOT EXISTS ix_packing_day_closes_updated ON packing_day_closes (updated_at);
  `);
  /* the reasons list starts with the owner's six plus Other; seeded on MAIN only (LOCALs get it by sync) */
  if (!isLocalServer()) {
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM packing_loss_reasons');
    if (!n.rows[0].n) {
      for (let i = 0; i < dc.DEFAULT_REASONS.length; i++) {
        const r = dc.DEFAULT_REASONS[i];
        await pool.query('INSERT INTO packing_loss_reasons (label, needs_note, sort_order, updated_by) VALUES ($1, $2, $3, $4)',
          [r.label, r.needs_note, (i + 1) * 10, 'system']);
      }
    }
  }
}

/* Active reasons; the built-in list while a LOCAL has not had the master yet. */
async function lossReasons(db, all = false) {
  const r = await db.query(`
    SELECT id, label, needs_note, sort_order, is_active, updated_by,
           to_char(updated_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS updated
      FROM packing_loss_reasons WHERE ($1::boolean OR is_active)
     ORDER BY is_active DESC, sort_order, LOWER(label)`, [all]);
  if (r.rows.length) return r.rows;
  return dc.DEFAULT_REASONS.map((x, i) => ({ id: null, label: x.label, needs_note: x.needs_note, sort_order: (i + 1) * 10, is_active: true }));
}

/* The saved close of a station's day (newest row), or null. */
async function savedClose(db, fid, station, day, lock = false) {
  const r = await db.query(`
    SELECT id, sync_id, station_name, to_char(day, 'YYYY-MM-DD') AS day, status, plan_qty, packed_qty, short_qty, lost_min,
           lines, stoppages, closed_by, reopen_count, reopened_by, last_reopen_reason,
           to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS closed_at,
           to_char(reopened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS reopened_at
      FROM packing_day_closes
     WHERE factory_id IS NOT DISTINCT FROM $1 AND LOWER(station_name) = LOWER($2) AND day = $3::date
     ORDER BY updated_at DESC, id DESC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`, [fid, station, day]);
  return r.rows[0] || null;
}

/* The station's plans touching the day, its good scans and the draft. */
async function computeDraft(db, station, b, nowMs = Date.now()) {
  const plans = await db.query(`
    SELECT p.id, p.job_card_no, p.item_name, p.client_name, COALESCE(p.tables, '') AS tables, p.plan_qty,
           COALESCE(p.scanned_qty, 0)::int AS scanned_qty, p.duration_min,
           UPPER(COALESCE(NULLIF(TRIM(p.status), ''), 'PLANNED')) AS status,
           to_char(p.start_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_local,
           to_char(p.end_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_local
      FROM assembly_plans p
     WHERE LOWER(p.table_id) = LOWER($1)
       AND UPPER(COALESCE(p.status, '')) NOT IN ('ARCHIVED', 'CANCELLED')
       AND p.start_time < ($2::date + 1)
       AND (COALESCE(p.end_time, p.start_time) >= $2::date
            OR (UPPER(COALESCE(p.status, '')) IN ('RUNNING', 'DONE') AND p.start_time >= $2::date - ${OPEN_PLAN_DAYS}))
     ORDER BY p.start_time, p.id`, [station, b.day]);
  const ids = plans.rows.map(p => Number(p.id));
  const dayFrom = new Date(b.midMs).toISOString();
  const dayTo = new Date(b.midMs + 86400e3).toISOString();
  const packedByPlan = new Map();
  const upTo = new Map();
  let scans = [];
  if (ids.length) {
    /* per plan: good scans on the day, good scans up to the end of the day, last good scan by then */
    const c = await db.query(`
      SELECT plan_id, COUNT(*) FILTER (WHERE "timestamp" >= $2::timestamptz)::int AS n, COUNT(*)::int AS upto,
             (EXTRACT(EPOCH FROM MAX("timestamp")) * 1000)::bigint AS last_ms
        FROM assembly_scans
       WHERE plan_id = ANY($1::int[]) AND is_match AND "timestamp" < $3::timestamptz
       GROUP BY plan_id`, [ids, dayFrom, dayTo]);
    for (const x of c.rows) {
      packedByPlan.set(Number(x.plan_id), x.n);
      upTo.set(Number(x.plan_id), { n: x.upto, last: Number(x.last_ms) || null });
    }
    const t = await db.query(`
      SELECT (EXTRACT(EPOCH FROM "timestamp") * 1000)::bigint AS ms FROM assembly_scans
       WHERE plan_id = ANY($1::int[]) AND is_match AND "timestamp" >= $2::timestamptz AND "timestamp" < $3::timestamptz
       ORDER BY "timestamp" LIMIT 50000`, [ids, new Date(b.startMs).toISOString(), new Date(b.endMs).toISOString()]);
    scans = t.rows.map(x => Number(x.ms));
  }
  const rows = plans.rows.map(p => {
    const u = upTo.get(Number(p.id)) || { n: 0, last: null };
    return { ...p, left: Math.max(0, Number(p.plan_qty || 0) - u.n), last_ms: u.last };
  });
  return dc.buildDraft(rows, packedByPlan, scans, b, nowMs);
}

/*
 * Stations with an earlier day (the last few days, not today) that had a plan or a good
 * scan and is not closed. Returns [{ station, day }], newest day first.
 */
async function unclosedDays(db, fid, stationNames, nowMs = Date.now(), lookback = UNCLOSED_LOOKBACK_DAYS) {
  if (!stationNames.length) return [];
  const today = dc.istToday(nowMs);
  const r = await db.query(`
    WITH days AS (
      SELECT (generate_series($2::date - $3::int, $2::date - 1, INTERVAL '1 day'))::date AS d
    ), act AS (
      SELECT DISTINCT LOWER(p.table_id) AS st, d.d
        FROM days d JOIN assembly_plans p
          ON p.start_time < (d.d + 1) AND COALESCE(p.end_time, p.start_time) >= d.d
         AND UPPER(COALESCE(p.status, '')) NOT IN ('ARCHIVED', 'CANCELLED')
       WHERE LOWER(p.table_id) = ANY($1::text[])
      UNION
      SELECT DISTINCT LOWER(p.table_id), (s."timestamp" AT TIME ZONE 'Asia/Kolkata')::date
        FROM assembly_scans s JOIN assembly_plans p ON p.id = s.plan_id
       WHERE s.is_match AND s."timestamp" >= ($2::date - $3::int)::timestamp AT TIME ZONE 'Asia/Kolkata'
         AND s."timestamp" < $2::date::timestamp AT TIME ZONE 'Asia/Kolkata'
         AND LOWER(p.table_id) = ANY($1::text[])
    )
    SELECT a.st, to_char(a.d, 'YYYY-MM-DD') AS day
      FROM act a
     WHERE NOT EXISTS (
       SELECT 1 FROM packing_day_closes c
        WHERE c.factory_id IS NOT DISTINCT FROM $4 AND LOWER(c.station_name) = a.st AND c.day = a.d AND c.status = 'CLOSED')
     ORDER BY a.d DESC, a.st`,
  [stationNames.map(s => s.toLowerCase()), today, lookback, fid]);
  const byKey = new Map(stationNames.map(s => [s.toLowerCase(), s]));
  return r.rows.map(x => ({ station: byKey.get(x.st) || x.st, day: x.day }));
}

function registerPackingDayCloseRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureDayCloseSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing day close] schema ensure failed:', err.message));

  const readFactory = (req) => serverFactoryId() || normalizeFactoryId(getFactoryId(req));
  const userOf = (req) => (req.auth && req.auth.username) || getRequestUsername(req) || 'system';
  function requireUser(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }
  const bad = (res, msg, code = 400, extra = {}) => res.status(code).json({ ok: false, error: msg, ...extra });
  async function inTx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }
  const reopenTries = new Map();

  /* station + day from the request, or an error message */
  async function readDay(src, fid) {
    const station = clean(src.station, 80);
    if (!station) return { error: 'Choose a station.' };
    const day = String(src.day || '').trim() || dc.istToday();
    const b = dc.dayBounds(day);
    if (!b) return { error: 'The day must be YYYY-MM-DD.' };
    if (day > dc.istToday()) return { error: 'You cannot close a day that has not started.' };
    const st = await pool.query(`SELECT name FROM packing_stations WHERE is_active AND LOWER(name) = LOWER($1)
                                  AND ($2::int IS NULL OR factory_id = $2) LIMIT 1`, [station, fid]);
    return { station: st.rows[0] ? st.rows[0].name : station, b };
  }

  app.get('/api/packing/day-close', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const d = await readDay(req.query || {}, fid);
      if (d.error) return bad(res, d.error);
      const now = Date.now();
      const saved = await savedClose(pool, fid, d.station, d.b.day);
      const reasons = await lossReasons(pool);
      const isToday = d.b.day === dc.istToday(now);
      const closed = saved && saved.status === 'CLOSED';
      const draft = closed ? null : await computeDraft(pool, d.station, d.b, now);
      res.json({
        ok: true,
        data: {
          station: d.station,
          day: d.b.day,
          status: closed ? 'CLOSED' : (saved ? 'REOPENED' : 'OPEN'),
          before_17: isToday && now < d.b.endMs,
          saved,
          draft,
          /* a reopened day keeps the reasons given at the last close as a starting point */
          previous: !closed && saved ? { lines: saved.lines, stoppages: saved.stoppages } : null,
          reasons,
          idle_min: require('./packingLive').IDLE_MIN,
          note: 'What is left on a plan stays on the station\'s jobs list. Nothing is carried forward to tomorrow.'
        }
      });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/day-close', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      if (!fid) return bad(res, 'Select one factory first.');
      const body = req.body || {};
      const d = await readDay(body, fid);
      if (d.error) return bad(res, d.error);
      const user = userOf(req);
      const reasons = await lossReasons(pool);
      const out = await inTx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing_day_close:${fid}:${d.station.toLowerCase()}:${d.b.day}`]);
        const saved = await savedClose(db, fid, d.station, d.b.day, true);
        if (saved && saved.status === 'CLOSED') return { status: 409, error: `${d.station} ${d.b.day} is already closed by ${saved.closed_by || 'someone'}.` };
        const draft = await computeDraft(db, d.station, d.b, Date.now());
        /* a day with nothing planned or packed can still be closed, so the live screen stops asking */
        const given = {
          lines: Array.isArray(body.lines) ? body.lines.slice(0, 200) : [],
          stoppages: Array.isArray(body.stoppages) ? body.stoppages.slice(0, 200) : []
        };
        const put = dc.applyReasons(draft, given, reasons);
        if (put.missing.length) return { status: 400, error: `Give a reason for: ${put.missing.slice(0, 5).join('; ')}${put.missing.length > 5 ? ` and ${put.missing.length - 5} more` : ''}.`, missing: put.missing };
        const t = dc.totalsOf(put.lines, put.stoppages);
        const stoppages = put.stoppages.map(({ from_ms, to_ms, ...g }) => g);
        let row;
        if (saved) {
          const r = await db.query(`
            UPDATE packing_day_closes SET status = 'CLOSED', plan_qty = $2, packed_qty = $3, short_qty = $4, lost_min = $5,
                   lines = $6::jsonb, stoppages = $7::jsonb, closed_by = $8, closed_at = NOW(), updated_at = NOW()
             WHERE id = $1 RETURNING id`, [saved.id, t.plan_qty, t.packed, t.short, t.lost_min, JSON.stringify(put.lines), JSON.stringify(stoppages), user]);
          row = r.rows[0];
        } else {
          const r = await db.query(`
            INSERT INTO packing_day_closes (factory_id, station_name, day, status, plan_qty, packed_qty, short_qty, lost_min, lines, stoppages, closed_by, closed_at)
            VALUES ($1, $2, $3::date, 'CLOSED', $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, NOW()) RETURNING id`,
          [fid, d.station, d.b.day, t.plan_qty, t.packed, t.short, t.lost_min, JSON.stringify(put.lines), JSON.stringify(stoppages), user]);
          row = r.rows[0];
        }
        return { data: { id: row.id, station: d.station, day: d.b.day, totals: t } };
      });
      if (out.error) return bad(res, out.error, out.status, out.missing ? { missing: out.missing } : {});
      res.json({ ok: true, ...out });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/day-close/reopen', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      if (!fid) return bad(res, 'Select one factory first.');
      const body = req.body || {};
      const d = await readDay(body, fid);
      if (d.error) return bad(res, d.error);
      const why = clean(body.reason, 200);
      if (why.length < 3) return bad(res, 'Write why the day is being reopened.');
      const saved = await savedClose(pool, fid, d.station, d.b.day);
      if (!saved || saved.status !== 'CLOSED') return bad(res, `${d.station} ${d.b.day} is not closed.`, 409);
      const { verifySupervisorPin } = require('./registerPackingHandoverRoutes');
      const check = await verifySupervisorPin(pool, fid, body.pin, reopenTries, `day:${saved.id}`);
      if (check.error) return bad(res, check.error, check.status);
      const r = await pool.query(`
        UPDATE packing_day_closes SET status = 'REOPENED', reopen_count = reopen_count + 1, reopened_by = $2,
               reopened_at = NOW(), last_reopen_reason = $3, updated_at = NOW()
         WHERE id = $1 AND status = 'CLOSED' RETURNING id`, [saved.id, `${check.name} (by ${userOf(req)})`, why]);
      if (!r.rows.length) return bad(res, 'Someone changed this day just now. Refresh.', 409);
      res.json({ ok: true, data: { station: d.station, day: d.b.day, reopened_by: check.name } });
    } catch (err) { sendServerError(res, err); }
  });

  /* Every station's day at a glance (the board's "Close day" list and its station tags). */
  app.get('/api/packing/day-close/day', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const day = String((req.query && req.query.day) || '').trim() || dc.istToday();
      const b = dc.dayBounds(day);
      if (!b) return bad(res, 'The day must be YYYY-MM-DD.');
      const now = Date.now();
      const st = await pool.query(`SELECT name FROM packing_stations WHERE is_active AND ($1::int IS NULL OR factory_id = $1)
                                    ORDER BY sort_order, name`, [fid]);
      const out = [];
      for (const s of st.rows) {
        const saved = await savedClose(pool, fid, s.name, day);
        if (saved && saved.status === 'CLOSED') {
          out.push({ station: s.name, status: 'CLOSED', closed_by: saved.closed_by, closed_at: saved.closed_at,
            totals: { plan_qty: saved.plan_qty, packed: saved.packed_qty, short: saved.short_qty, lost_min: saved.lost_min } });
          continue;
        }
        const draft = day > dc.istToday(now) ? null : await computeDraft(pool, s.name, b, now);
        out.push({ station: s.name, status: saved ? 'REOPENED' : 'OPEN', totals: draft ? draft.totals : null,
          stoppages: draft ? draft.stoppages.length : 0, has_work: Boolean(draft && (draft.lines.length || draft.stoppages.length)) });
      }
      res.json({ ok: true, data: { day, future: day > dc.istToday(now), is_today: day === dc.istToday(now), before_17: day === dc.istToday(now) && now < b.endMs, stations: out } });
    } catch (err) { sendServerError(res, err); }
  });

  app.get('/api/packing/day-close/open', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const st = await pool.query('SELECT name FROM packing_stations WHERE is_active AND ($1::int IS NULL OR factory_id = $1)', [fid]);
      res.json({ ok: true, data: await unclosedDays(pool, fid, st.rows.map(x => x.name)) });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- reasons master ---------------- */

  app.get('/api/packing/loss-reasons', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      res.json({ ok: true, data: await lossReasons(pool, req.query.all === '1'), can_edit: !isLocalServer() && canEditMasters(req.auth) });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/loss-reasons', async (req, res) => {
    try {
      if (isLocalServer()) return bad(res, 'The reasons list can only be changed on the MAIN server.', 403);
      if (!req.auth) return bad(res, 'Please log in again.', 401);
      if (!canEditMasters(req.auth)) return bad(res, 'Masters edit permission required.', 403);
      await ensureTables();
      const b = req.body || {};
      const label = clean(b.label, 60);
      if (!label) return bad(res, 'Enter the reason.');
      const id = parseInt(b.id, 10);
      const dup = await pool.query('SELECT id FROM packing_loss_reasons WHERE LOWER(label) = LOWER($1) AND id <> $2 LIMIT 1', [label, Number.isNaN(id) ? 0 : id]);
      if (dup.rows.length) return bad(res, `"${label}" is already in the list.`, 409);
      const order = Number.isFinite(Number(b.sort_order)) ? Math.max(0, Math.min(9999, Math.round(Number(b.sort_order)))) : null;
      const user = userOf(req);
      if (!Number.isNaN(id) && id > 0) {
        const r = await pool.query(`
          UPDATE packing_loss_reasons SET label = $2, needs_note = $3, is_active = $4, sort_order = COALESCE($5, sort_order),
                 updated_by = $6, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, label, b.needs_note === true, b.is_active !== false, order, user]);
        if (!r.rows.length) return bad(res, 'Reason not found.', 404);
        return res.json({ ok: true, data: r.rows[0] });
      }
      const n = await pool.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(sort_order), 0)::int AS m FROM packing_loss_reasons');
      if (n.rows[0].n >= MAX_REASONS) return bad(res, `The list can hold ${MAX_REASONS} reasons. Switch one off or rename it instead.`);
      const r = await pool.query(`INSERT INTO packing_loss_reasons (label, needs_note, sort_order, updated_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [label, b.needs_note === true, order ?? n.rows[0].m + 10, user]);
      res.json({ ok: true, data: r.rows[0] });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = { registerPackingDayCloseRoutes, ensureDayCloseSchema, lossReasons, savedClose, computeDraft, unclosedDays };
