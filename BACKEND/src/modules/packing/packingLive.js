'use strict';

/**
 * Packing live screen (packing_live.html) - the maths behind GET /api/packing/live.
 * Read only: it uses the data of steps 1-8 and writes nothing.
 *
 * Station status, in this order:
 *  - LOCKED      a wrong-barcode lock is open (supervisor PIN needed)
 *  - OFF_SHIFT   a job is running but it is outside the 09:00-17:00 shift
 *  - IDLE        a job is running and there has been no good scan for more than
 *                IDLE_MIN working minutes (the same 10 minutes the reports use)
 *  - RUNNING     a job is running and scanning
 *  - NOT_STARTED the station has a plan today but nothing is running
 *  - NO_PLAN     nothing planned
 *
 * "On track for 17:00" = packed today + what each running station adds by 17:00 at
 * its last-15-minute speed (the standard speed when it has just started), capped at
 * what is left on its plans. Idle, locked and not-started stations add nothing.
 */

const { shiftMinutesBetween } = require('../orderTracker/packingProgress');
const { UNIT_SQL } = require('./registerPackingHandoverRoutes');
const { crewStdRate } = require('./packingCrew');

const IDLE_MIN = 10;
const NOT_HANDED_HOURS = 24;
const IST_MS = 5.5 * 3600e3;
const DAY_MS = 86400e3;
const SHIFT_START_MIN = 9 * 60;
const SHIFT_END_MIN = 17 * 60;

const num = (v) => Number(v) || 0;

/* IST calendar day (YYYY-MM-DD) and the UTC instant of its midnight. */
function istDay(nowMs) {
  const d = Math.floor((nowMs + IST_MS) / DAY_MS);
  return { day: new Date(d * DAY_MS).toISOString().slice(0, 10), startMs: d * DAY_MS - IST_MS };
}

function inShift(nowMs) {
  const m = ((nowMs + IST_MS) % DAY_MS) / 60000;
  return m >= SHIFT_START_MIN && m < SHIFT_END_MIN;
}

/* Working minutes left until 17:00 IST today (0 after 17:00). */
function minutesLeftToday(nowMs) {
  const { startMs } = istDay(nowMs);
  return shiftMinutesBetween(nowMs, startMs + SHIFT_END_MIN * 60000);
}

/* A naive IST wall-clock string ('2026-11-19T09:00:00') as an instant. */
function istMs(local) {
  if (!local) return null;
  const t = Date.parse(String(local).slice(0, 19) + '+05:30');
  return Number.isFinite(t) ? t : null;
}

/**
 * One station's tile.
 * plans: the station's plans on today's board (planDetails rows).
 * scan:  { good_today, wrong_today, last_good_at } for the station.
 * crew:  { n, names } packers on the station now (step 10), or null when the factory
 *        does not record its crew; then the standard persons and speed are used as is.
 */
function stationTile(row, plans, scan, lock, nowMs, crew = null) {
  const open = plans.filter(p => p.status !== 'DONE');
  const running = plans.filter(p => p.status === 'RUNNING');
  const current = running[running.length - 1] || open[0] || null;
  const remaining = open.reduce((s, p) => s + Math.max(0, num(p.plan_qty) - num(p.scanned_qty)), 0);
  const lastGood = scan && scan.last_good_at ? Date.parse(scan.last_good_at) : null;
  const startedAt = current ? istMs(current.start_local) : null;
  const since = Math.max(lastGood || 0, running.length ? (startedAt || 0) : 0) || null;
  const idleMin = running.length && since ? Math.round(shiftMinutesBetween(since, nowMs)) : 0;

  let status = 'NO_PLAN';
  if (lock) status = 'LOCKED';
  else if (running.length && !inShift(nowMs)) status = 'OFF_SHIFT';
  else if (running.length && idleMin > IDLE_MIN) status = 'IDLE';
  else if (running.length) status = 'RUNNING';
  else if (open.length) status = 'NOT_STARTED';

  const fullStd = current ? num(current.std_pcs_hr) : 0;
  const stdPersons = num((current && current.std_persons) || row.persons) || null;
  const crewN = crew ? num(crew.n) : null;
  /* standard speed for the people actually there (std x crew / std persons) */
  const std = crewN ? crewStdRate(fullStd, stdPersons, crewN) : fullStd;
  const rateNow = current ? num(current.rate_now) : 0;
  const rateUsed = status === 'RUNNING' ? (rateNow > 0 ? rateNow : std) : 0;
  const addBy17 = rateUsed > 0 ? Math.min(remaining, Math.floor(rateUsed * minutesLeftToday(nowMs) / 60)) : 0;

  return {
    name: row.name,
    is_station: row.is_station !== false,
    persons: row.persons ?? null,
    std_persons: stdPersons,
    crew: crew ? { n: crewN, names: crew.names || [] } : null,
    crew_short: Boolean(crew && stdPersons && crewN < stdPersons && ['RUNNING', 'IDLE'].includes(status)),
    std_pcs_hr_full: fullStd,
    status,
    idle_min: idleMin,
    current: current ? {
      id: current.id,
      item_name: current.item_name,
      client_name: current.client_name,
      job_card_no: current.job_card_no,
      status: current.status,
      plan_qty: num(current.plan_qty),
      scanned_qty: num(current.scanned_qty),
      std_persons: current.std_persons ?? null
    } : null,
    plans_today: plans.length,
    plans_open: open.length,
    remaining,
    rate_now: rateNow,
    std_pcs_hr: std,
    rate_used: rateUsed,
    efficiency: rateNow > 0 && std > 0 ? Math.round(rateNow / std * 100) : null,
    add_by_17: addBy17,
    packed_today: scan ? num(scan.good_today) : 0,
    wrong_today: scan ? num(scan.wrong_today) : 0,
    last_good_at: lastGood ? new Date(lastGood).toISOString() : null,
    lock: lock ? { locked_at: lock.locked_at, scanned_ean: lock.scanned_ean || null } : null
  };
}

function totalsOf(tiles) {
  const t = { packed_today: 0, remaining: 0, add_by_17: 0, running: 0, idle: 0, locked: 0, not_started: 0, stations: 0, wrong_today: 0 };
  for (const s of tiles) {
    t.packed_today += s.packed_today;
    t.remaining += s.remaining;
    t.add_by_17 += s.add_by_17;
    t.wrong_today += s.wrong_today;
    if (s.status === 'RUNNING') t.running++;
    if (s.status === 'IDLE') t.idle++;
    if (s.status === 'LOCKED') t.locked++;
    if (s.status === 'NOT_STARTED') t.not_started++;
    if (s.is_station) t.stations++;
  }
  t.target = t.packed_today + t.remaining;
  t.projected = t.packed_today + t.add_by_17;
  t.short = Math.max(0, t.target - t.projected);
  return t;
}

/* Good / wrong scans today and the last good scan, per station (lower-case name). */
async function scanFigures(pool, dayStartMs) {
  const r = await pool.query(`
    SELECT LOWER(p.table_id) AS t,
           COUNT(*) FILTER (WHERE s.is_match AND s."timestamp" >= $1::timestamptz)::int AS good_today,
           COUNT(*) FILTER (WHERE NOT COALESCE(s.is_match, FALSE) AND s."timestamp" >= $1::timestamptz)::int AS wrong_today,
           to_char(MAX(s."timestamp") FILTER (WHERE s.is_match) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_good_at
      FROM assembly_scans s
      JOIN assembly_plans p ON p.id = s.plan_id
     WHERE s."timestamp" >= $1::timestamptz - INTERVAL '7 days'
     GROUP BY 1`, [new Date(dayStartMs).toISOString()]);
  return new Map(r.rows.map(x => [x.t, x]));
}

async function hasTable(pool, name) {
  const r = await pool.query('SELECT to_regclass($1) AS t', [`public.${name}`]);
  return Boolean(r.rows[0] && r.rows[0].t);
}

/* Cartons waiting for the store, old stock and today's dispatch. Missing tables give zeros. */
async function storeFigures(pool, fid, dayStartMs, alertDays) {
  const out = { waiting_units: 0, waiting_pcs: 0, waiting_old: 0, not_handed_hours: NOT_HANDED_HOURS,
    old_stock_units: 0, alert_days: alertDays, dispatched_slips: 0, dispatched_pcs: 0, open_slips: 0, waiting_by_station: {} };
  if (!await hasTable(pool, 'packing_boxes')) return out;
  const w = await pool.query(`
    SELECT LOWER(b.table_id) AS t, COUNT(*)::int AS units, COALESCE(SUM(b.qty), 0)::int AS pcs,
           COUNT(*) FILTER (WHERE b.created_at < NOW() - INTERVAL '${NOT_HANDED_HOURS} hours')::int AS old
      FROM packing_boxes b
     WHERE ${UNIT_SQL} AND b.voided_at IS NULL AND b.received_at IS NULL
       AND ($1::int IS NULL OR b.factory_id = $1)
     GROUP BY 1`, [fid]);
  for (const x of w.rows) {
    out.waiting_units += x.units; out.waiting_pcs += x.pcs; out.waiting_old += x.old;
    out.waiting_by_station[x.t] = x.units;
  }
  const hasDispatch = await hasTable(pool, 'packing_dispatches');
  const o = await pool.query(`
    SELECT COUNT(*)::int AS n FROM packing_boxes b
     WHERE ${UNIT_SQL} AND b.voided_at IS NULL AND b.received_at IS NOT NULL
       ${hasDispatch ? 'AND b.dispatched_at IS NULL' : ''}
       AND b.received_at < NOW() - make_interval(days => $2::int)
       AND ($1::int IS NULL OR b.factory_id = $1)`, [fid, alertDays]);
  out.old_stock_units = o.rows[0].n;
  if (hasDispatch) {
    const d = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE d.status = 'CLOSED' AND d.closed_at >= $2::timestamptz)::int AS slips,
             COUNT(*) FILTER (WHERE d.status = 'OPEN')::int AS open_slips,
             COALESCE((SELECT SUM(b.qty) FROM packing_boxes b
                        JOIN packing_dispatches x ON x.sync_id = b.dispatch_sync_id
                       WHERE ${UNIT_SQL} AND b.voided_at IS NULL AND x.status = 'CLOSED' AND x.closed_at >= $2::timestamptz
                         AND ($1::int IS NULL OR x.factory_id = $1)), 0)::int AS pcs
        FROM packing_dispatches d
       WHERE ($1::int IS NULL OR d.factory_id = $1)`, [fid, new Date(dayStartMs).toISOString()]);
    out.dispatched_slips = d.rows[0].slips;
    out.open_slips = d.rows[0].open_slips;
    out.dispatched_pcs = d.rows[0].pcs;
  }
  return out;
}

/* The "needs action" strip. */
function alertsOf(tiles, store) {
  const a = [];
  for (const s of tiles) {
    if (s.status === 'LOCKED') a.push({ level: 'danger', kind: 'locked', station: s.name, text: `${s.name} is locked after a wrong barcode. A supervisor PIN is needed.` });
  }
  for (const s of tiles) {
    if (s.status === 'IDLE') a.push({ level: 'warning', kind: 'idle', station: s.name, text: `${s.name} idle ${s.idle_min} min (no good scan).` });
  }
  for (const s of tiles) {
    if (s.crew_short) a.push({ level: 'warning', kind: 'crew', station: s.name, text: `${s.name} has ${s.crew.n} of ${s.std_persons} packers.` });
  }
  if (store.waiting_old > 0) a.push({ level: 'warning', kind: 'handover', text: `${store.waiting_old} carton${store.waiting_old === 1 ? '' : 's'} labelled more than ${store.not_handed_hours} h ago, not handed to the store.` });
  if (store.old_stock_units > 0) a.push({ level: 'neutral', kind: 'old_stock', text: `${store.old_stock_units} carton${store.old_stock_units === 1 ? '' : 's'} in the store for more than ${store.alert_days} days.` });
  return a;
}

module.exports = {
  IDLE_MIN, istDay, inShift, minutesLeftToday, istMs, stationTile, totalsOf, scanFigures, storeFigures, alertsOf
};
