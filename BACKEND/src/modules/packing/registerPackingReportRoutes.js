'use strict';

/**
 * Packing reports - PUBLIC/packing_reports.html.
 *
 *   GET /api/packing/reports/:type?from=YYYY-MM-DD&to=YYYY-MM-DD&station=&party=
 *   GET /api/packing/reports/:type/export.xlsx?...same filters
 *
 * Types: daily, jobs, jobcards, hourly, wrong, boxes, handover, stock, dispatch, packers (step 10). Read-only over assembly_plans,
 * assembly_scans, packing_item_standards, or_jr_report and packing_lock_events.
 *
 * Rules agreed with the owner (19-Nov-2026):
 *  - idle = a pause of more than 10 minutes between two good scans of a station;
 *  - working time = first to last scan minus idle;
 *  - efficiency = standard time earned (packed x station cycle seconds per piece,
 *    from Packing Masters) / working time;
 *  - a job is over-packed above 110 % of its plan qty.
 * Days and hours are IST.
 */

const XLSX = require('xlsx');
const { getRequestUsername, getFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const crewMath = require('./packingCrew');
const crewRoutes = require('./registerPackingCrewRoutes');

const IDLE_MIN = 10;
const OVER_PCT = 110;
const MAX_DAYS = 92;
const ROW_LIMIT = 3000;
const TZ = 'Asia/Kolkata';

const KEY_SQL = (col) => `UPPER(REGEXP_REPLACE(TRIM(COALESCE(${col}, '')), '^0+(?=.)', ''))`;
const NOT_CANCELLED = `UPPER(COALESCE(p.status, '')) NOT IN ('ARCHIVED', 'CANCELLED')`;

function istToday() {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

function readFilters(q) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
  const to = isDate(q.to) ? q.to : istToday();
  let from = isDate(q.from) ? q.from : new Date(Date.parse(to) - 6 * 864e5).toISOString().slice(0, 10);
  if (from > to) from = to;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  if (days > MAX_DAYS) {
    const err = new Error(`Pick at most ${MAX_DAYS} days.`);
    err.status = 400;
    throw err;
  }
  const station = String(q.station || '').trim().slice(0, 80) || null;
  const party = String(q.party || '').trim().slice(0, 120) || null;
  return { from, to, days, station, party };
}

/* $1 from, $2 to, $3 station, $4 party (LIKE pattern) */
const filterParams = (f) => [f.from, f.to, f.station, f.party ? `%${f.party.toLowerCase()}%` : null];
const PLAN_FILTER = `($3::text IS NULL OR LOWER(p.table_id) = LOWER($3))
  AND ($4::text IS NULL OR LOWER(COALESCE(p.client_name, '')) LIKE $4)`;
const SCAN_RANGE = `sc."timestamp" >= ($1::date)::timestamp AT TIME ZONE '${TZ}'
  AND sc."timestamp" < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'`;

/* Station cycle seconds per piece for each plan in `idsSql`, from its job card's item. */
function planStdSql(hasJr, idsSql) {
  const jr = hasJr ? `
    LEFT JOIN LATERAL (
      SELECT j.item_code FROM or_jr_report j
       WHERE NULLIF(TRIM(COALESCE(p.job_card_no, '')), '') IS NOT NULL
         AND (UPPER(TRIM(j.job_card_no)) = UPPER(TRIM(p.job_card_no)) OR UPPER(TRIM(j.or_jr_no)) = UPPER(TRIM(p.job_card_no)))
         AND COALESCE(j.is_deleted, FALSE) = FALSE
       LIMIT 1
    ) jr ON TRUE` : 'LEFT JOIN LATERAL (SELECT NULL::text AS item_code) jr ON TRUE';
  return `
    SELECT p.id, st.cycle, st.persons
      FROM assembly_plans p
      ${jr}
      LEFT JOIN LATERAL (
        SELECT s.cycle_time_sec::float AS cycle, s.persons::float AS persons FROM packing_item_standards s
         WHERE s.is_active AND jr.item_code IS NOT NULL AND s.item_key = ${KEY_SQL('jr.item_code')}
           AND LOWER(s.station_name) = LOWER(p.table_id) AND s.cycle_time_sec > 0
         ORDER BY (LOWER(s.party_group) = LOWER(COALESCE(p.client_name, ''))) DESC
         LIMIT 1
      ) st ON TRUE
     WHERE p.id IN (${idsSql})`;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round = (v, d = 0) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/* ---------------- report builders ---------------- */

async function dailyReport(pool, f, hasJr) {
  const r = await pool.query(`
    WITH s AS (
      SELECT sc.plan_id, p.table_id, (sc."timestamp" AT TIME ZONE '${TZ}') AS t, sc.is_match
        FROM assembly_scans sc JOIN assembly_plans p ON p.id = sc.plan_id
       WHERE ${SCAN_RANGE} AND ${PLAN_FILTER}
    ), ps AS (${planStdSql(hasJr, 'SELECT DISTINCT plan_id FROM s')}
    ), m AS (
      SELECT s.*, s.t::date AS d, s.t - LAG(s.t) OVER (PARTITION BY s.table_id, s.t::date ORDER BY s.t) AS gap
        FROM s WHERE s.is_match
    ), day AS (
      SELECT d, table_id, COUNT(*)::int AS packed, COUNT(DISTINCT plan_id)::int AS jobs,
             to_char(MIN(t), 'HH24:MI') AS first_t, to_char(MAX(t), 'HH24:MI') AS last_t,
             EXTRACT(EPOCH FROM MAX(t) - MIN(t))::float AS span_s,
             COALESCE(SUM(EXTRACT(EPOCH FROM gap)) FILTER (WHERE gap > INTERVAL '${IDLE_MIN} minutes'), 0)::float AS idle_s,
             COUNT(*) FILTER (WHERE gap > INTERVAL '${IDLE_MIN} minutes')::int AS idle_n
        FROM m GROUP BY 1, 2
    ), earn AS (
      SELECT m.d, m.table_id, SUM(ps.cycle)::float AS earned_s, COUNT(*) FILTER (WHERE ps.cycle > 0)::int AS std_pcs
        FROM m JOIN ps ON ps.id = m.plan_id GROUP BY 1, 2
    ), wrong AS (
      SELECT t::date AS d, table_id, COUNT(*)::int AS n FROM s WHERE NOT is_match GROUP BY 1, 2
    ), planned AS (
      SELECT p.start_time::date AS d, p.table_id, SUM(p.plan_qty)::int AS q
        FROM assembly_plans p
       WHERE p.start_time >= $1::date AND p.start_time < $2::date + 1 AND ${NOT_CANCELLED} AND ${PLAN_FILTER}
       GROUP BY 1, 2
    ), k AS (
      SELECT d, table_id FROM day UNION SELECT d, table_id FROM planned UNION SELECT d, table_id FROM wrong
    )
    SELECT to_char(k.d, 'YYYY-MM-DD') AS day, k.table_id, planned.q AS planned, day.packed, day.jobs, day.first_t, day.last_t,
           day.span_s, day.idle_s, day.idle_n, earn.earned_s, earn.std_pcs, COALESCE(wrong.n, 0) AS wrong
      FROM k
      LEFT JOIN day ON day.d = k.d AND day.table_id = k.table_id
      LEFT JOIN planned ON planned.d = k.d AND planned.table_id = k.table_id
      LEFT JOIN earn ON earn.d = k.d AND earn.table_id = k.table_id
      LEFT JOIN wrong ON wrong.d = k.d AND wrong.table_id = k.table_id
     ORDER BY k.d DESC, k.table_id
     LIMIT ${ROW_LIMIT}`, filterParams(f));

  const tot = { planned: 0, packed: 0, idle_s: 0, work_s: 0, earned_s: 0, wrong: 0 };
  const rows = r.rows.map(x => {
    const packed = x.packed || 0;
    const work = packed > 1 ? Math.max(0, num(x.span_s) - num(x.idle_s)) : 0;
    const rate = work > 0 ? packed / (work / 3600) : null;
    const std = x.std_pcs > 0 && x.earned_s > 0 ? x.std_pcs / (x.earned_s / 3600) : null;
    const eff = work > 0 && x.earned_s > 0 ? (x.earned_s / work) * 100 : null;
    tot.planned += x.planned || 0; tot.packed += packed; tot.idle_s += num(x.idle_s) || 0;
    tot.work_s += work; tot.earned_s += num(x.earned_s) || 0; tot.wrong += x.wrong || 0;
    let note = '';
    if (!packed && x.planned) note = 'not packed';
    else if (packed && work < 1800) note = 'stopped early';
    else if (packed && !x.std_pcs) note = 'no standard';
    return {
      day: x.day, station: x.table_id, planned: x.planned, packed, done_pct: x.planned ? round(packed * 100 / x.planned) : null,
      jobs: x.jobs, worked: x.first_t ? `${x.first_t}–${x.last_t}` : '', work_min: round(work / 60), idle_min: round((num(x.idle_s) || 0) / 60),
      idle_n: x.idle_n || 0, rate: round(rate), std_rate: round(std), eff: round(eff), wrong: x.wrong, note
    };
  });
  return {
    columns: [
      { key: 'day', label: 'Date', type: 'date' }, { key: 'station', label: 'Station' },
      { key: 'planned', label: 'Planned', type: 'int' }, { key: 'packed', label: 'Packed', type: 'int' },
      { key: 'done_pct', label: 'Done %', type: 'pct' }, { key: 'jobs', label: 'Jobs', type: 'int' },
      { key: 'worked', label: 'First–last scan' }, { key: 'work_min', label: 'Working', type: 'min' },
      { key: 'idle_min', label: `Idle (> ${IDLE_MIN} min)`, type: 'min' }, { key: 'idle_n', label: 'Pauses', type: 'int' },
      { key: 'rate', label: 'Pcs / hr', type: 'int' }, { key: 'std_rate', label: 'Std pcs / hr', type: 'int' },
      { key: 'eff', label: 'Efficiency', type: 'pct' }, { key: 'wrong', label: 'Wrong scans', type: 'int' },
      { key: 'note', label: 'Note' }
    ],
    rows,
    summary: [
      { label: 'Planned', value: tot.planned, type: 'int' },
      { label: 'Packed', value: tot.packed, type: 'int' },
      { label: 'Efficiency', value: tot.work_s > 0 && tot.earned_s > 0 ? round(tot.earned_s / tot.work_s * 100) : null, type: 'pct' },
      { label: `Idle (pauses > ${IDLE_MIN} min)`, value: round(tot.idle_s / 60), type: 'min' },
      { label: 'Wrong scans', value: tot.wrong, type: 'int' }
    ]
  };
}

/* Plans that start in the period or were scanned in it. */
const PLANS_IN_PERIOD = `
  SELECT p.* FROM assembly_plans p
   WHERE ${NOT_CANCELLED} AND ${PLAN_FILTER}
     AND ((p.start_time >= $1::date AND p.start_time < $2::date + 1)
          OR EXISTS (SELECT 1 FROM assembly_scans sc WHERE sc.plan_id = p.id AND ${SCAN_RANGE}))`;

async function jobsReport(pool, f, hasJr, hasBoxes) {
  const bxSel = hasBoxes ? `, bx.boxes, bx.cartons, bx.boxed` : ', NULL::int AS boxes, NULL::int AS cartons, NULL::int AS boxed';
  const bxJoin = hasBoxes ? `LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE b.kind = 'BOX')::int AS boxes, COUNT(*) FILTER (WHERE b.kind = 'CARTON')::int AS cartons,
               COALESCE(SUM(b.qty) FILTER (WHERE b.kind IN ('BOX', 'OPENING')), 0)::int AS boxed
          FROM packing_boxes b WHERE b.plan_id = pl.id AND b.voided_at IS NULL) bx ON TRUE` : '';
  const r = await pool.query(`
    WITH pl AS (${PLANS_IN_PERIOD}
    ), st AS (
      /* gaps are taken per station (any job on it), then each gap is given to the job of the later scan */
      SELECT sc.plan_id, sc."timestamp" AS ts,
             sc."timestamp" - LAG(sc."timestamp") OVER (PARTITION BY LOWER(p.table_id) ORDER BY sc."timestamp") AS gap
        FROM assembly_scans sc JOIN assembly_plans p ON p.id = sc.plan_id
       WHERE sc.is_match AND LOWER(p.table_id) IN (SELECT LOWER(table_id) FROM pl)
         AND sc."timestamp" >= (SELECT MIN(s2."timestamp") FROM assembly_scans s2 WHERE s2.plan_id IN (SELECT id FROM pl))
    ), m AS (
      SELECT plan_id, (ts AT TIME ZONE '${TZ}') AS t, gap FROM st WHERE plan_id IN (SELECT id FROM pl)
    ), agg AS (
      SELECT plan_id, to_char(MIN(t), 'DD-Mon HH24:MI') AS first_t, to_char(MAX(t), 'DD-Mon HH24:MI') AS last_t,
             COALESCE(SUM(EXTRACT(EPOCH FROM gap)) FILTER (WHERE gap <= INTERVAL '${IDLE_MIN} minutes'), 0)::float AS work_s,
             COUNT(*)::int AS good
        FROM m GROUP BY 1
    ), ps AS (${planStdSql(hasJr, 'SELECT id FROM pl')})
    SELECT pl.id, pl.table_id, pl.item_name, pl.client_name, pl.job_card_no, pl.plan_qty,
           COALESCE(pl.scanned_qty, 0)::int AS packed, UPPER(COALESCE(NULLIF(TRIM(pl.status), ''), 'PLANNED')) AS status,
           to_char(pl.start_time, 'YYYY-MM-DD HH24:MI') AS start_local, pl.duration_min,
           (pl.end_time < LOCALTIMESTAMP) AS ended, to_char(pl.finished_at, 'DD-Mon HH24:MI') AS finished,
           agg.first_t, agg.last_t, agg.work_s, agg.good, ps.cycle ${bxSel}
      FROM pl LEFT JOIN agg ON agg.plan_id = pl.id LEFT JOIN ps ON ps.id = pl.id ${bxJoin}
     ORDER BY pl.start_time DESC NULLS LAST
     LIMIT ${ROW_LIMIT}`, filterParams(f));

  const count = { over: 0, short: 0, done: 0 };
  const rows = r.rows.map(x => {
    const qty = Number(x.plan_qty) || 0;
    const pct = qty > 0 ? (x.packed * 100) / qty : null;
    const work = num(x.work_s) || 0;
    const stdMin = x.cycle && qty ? (qty * x.cycle) / 60 : null;
    let flag = { RUNNING: 'running', DONE: 'done' }[x.status] || (x.packed ? 'started' : 'not started');
    if (pct !== null && pct > OVER_PCT) flag = 'over-packed';
    else if (pct !== null && pct < 100 && (x.status === 'DONE' || (x.ended && x.status !== 'RUNNING'))) flag = 'short';
    if (flag === 'over-packed') count.over++;
    if (flag === 'short') count.short++;
    if (x.status === 'DONE') count.done++;
    return {
      id: x.id, start: x.start_local, station: x.table_id, item: x.item_name, party: x.client_name, job_card: x.job_card_no,
      plan_qty: qty, packed: x.packed, pct: round(pct), diff: x.packed - qty,
      plan_min: x.duration_min, std_min: round(stdMin), actual_min: work ? round(work / 60) : null,
      eff: work > 0 && x.cycle ? round(((Math.min(x.good, x.packed) * x.cycle) / work) * 100) : null,
      boxes: x.boxes, cartons: x.cartons, loose: x.boxes === null ? null : Math.max(0, x.packed - (x.boxed || 0)),
      first: x.first_t, last: x.last_t, finished: x.finished, status: flag
    };
  });
  return {
    columns: [
      { key: 'start', label: 'Plan start' }, { key: 'station', label: 'Station' }, { key: 'item', label: 'Item' },
      { key: 'party', label: 'Party' }, { key: 'job_card', label: 'Job card' }, { key: 'plan_qty', label: 'Plan', type: 'int' },
      { key: 'packed', label: 'Packed', type: 'int' }, { key: 'pct', label: '%', type: 'pct' }, { key: 'diff', label: '+ / −', type: 'int' },
      { key: 'plan_min', label: 'Planned time', type: 'min' }, { key: 'std_min', label: 'Std time', type: 'min' },
      { key: 'actual_min', label: 'Actual working', type: 'min' }, { key: 'eff', label: 'Efficiency', type: 'pct' },
      ...(hasBoxes ? [{ key: 'boxes', label: 'Boxes', type: 'int' }, { key: 'cartons', label: 'Cartons', type: 'int' }, { key: 'loose', label: 'Not in a box', type: 'int' }] : []),
      { key: 'first', label: 'First scan' }, { key: 'last', label: 'Last scan' }, { key: 'finished', label: 'Finished' },
      { key: 'status', label: 'Status', type: 'status' }
    ],
    rows,
    summary: [
      { label: 'Jobs', value: rows.length, type: 'int' },
      { label: 'Done', value: count.done, type: 'int' },
      { label: `Over-packed (> ${OVER_PCT}%)`, value: count.over, type: 'int' },
      { label: 'Short', value: count.short, type: 'int' }
    ]
  };
}

async function jobcardsReport(pool, f, hasJr) {
  const jr = hasJr ? `
    LEFT JOIN LATERAL (
      SELECT j.jr_qty, j.item_code, j.product_name, j.client_name, j.or_jr_no FROM or_jr_report j
       WHERE UPPER(TRIM(j.job_card_no)) = a.jc AND COALESCE(j.is_deleted, FALSE) = FALSE
       ORDER BY j.or_jr_date DESC NULLS LAST LIMIT 1
    ) jr ON TRUE` : 'LEFT JOIN LATERAL (SELECT NULL::numeric AS jr_qty, NULL::text AS item_code, NULL::text AS product_name, NULL::text AS client_name, NULL::text AS or_jr_no) jr ON TRUE';
  const r = await pool.query(`
    WITH pl AS (${PLANS_IN_PERIOD}
    ), jcs AS (
      SELECT DISTINCT UPPER(TRIM(job_card_no)) AS jc FROM pl WHERE NULLIF(TRIM(COALESCE(job_card_no, '')), '') IS NOT NULL
    ), a AS (
      SELECT UPPER(TRIM(p.job_card_no)) AS jc, MAX(p.job_card_no) AS job_card_no, COUNT(*)::int AS plans,
             SUM(p.plan_qty)::int AS planned, SUM(COALESCE(p.scanned_qty, 0))::int AS packed,
             MAX(p.item_name) AS item_name, MAX(p.client_name) AS client_name,
             COUNT(*) FILTER (WHERE UPPER(COALESCE(p.status, '')) = 'DONE')::int AS done_plans
        FROM assembly_plans p
       WHERE UPPER(TRIM(p.job_card_no)) IN (SELECT jc FROM jcs) AND ${NOT_CANCELLED}
       GROUP BY 1
    )
    SELECT a.*, jr.jr_qty, jr.item_code, jr.product_name, jr.client_name AS jr_party, jr.or_jr_no,
           (SELECT to_char(MAX(sc."timestamp") AT TIME ZONE '${TZ}', 'DD-Mon HH24:MI') FROM assembly_scans sc
             JOIN assembly_plans p2 ON p2.id = sc.plan_id WHERE UPPER(TRIM(p2.job_card_no)) = a.jc) AS last_scan
      FROM a ${jr}
     ORDER BY a.jc DESC
     LIMIT ${ROW_LIMIT}`, filterParams(f));
  let full = 0, balanceTotal = 0;
  const rows = r.rows.map(x => {
    const jrQty = x.jr_qty === null || x.jr_qty === undefined ? null : Number(x.jr_qty);
    const balance = jrQty === null ? null : jrQty - x.packed;
    if (balance !== null && balance <= 0) full++;
    if (balance !== null && balance > 0) balanceTotal += balance;
    return {
      job_card: x.job_card_no, jr_no: x.or_jr_no, item: x.product_name || x.item_name, item_code: x.item_code,
      party: x.jr_party || x.client_name, jr_qty: jrQty, planned: x.planned, packed: x.packed, balance,
      pct: jrQty ? round(x.packed * 100 / jrQty) : null, plans: x.plans, done_plans: x.done_plans, last_scan: x.last_scan,
      status: balance === null ? 'no JR' : balance <= 0 ? (x.packed > jrQty * OVER_PCT / 100 ? 'over-packed' : 'packed') : x.packed ? 'in progress' : 'not started'
    };
  });
  return {
    columns: [
      { key: 'job_card', label: 'Job card' }, { key: 'jr_no', label: 'JR no' }, { key: 'item', label: 'Item' },
      { key: 'item_code', label: 'Code' }, { key: 'party', label: 'Party' }, { key: 'jr_qty', label: 'JR qty', type: 'int' },
      { key: 'planned', label: 'In packing plans', type: 'int' }, { key: 'packed', label: 'Packed', type: 'int' },
      { key: 'balance', label: 'Balance', type: 'int' }, { key: 'pct', label: '%', type: 'pct' },
      { key: 'plans', label: 'Plans', type: 'int' }, { key: 'last_scan', label: 'Last scan' }, { key: 'status', label: 'Status', type: 'status' }
    ],
    rows,
    summary: [
      { label: 'Job cards', value: rows.length, type: 'int' },
      { label: 'Fully packed', value: full, type: 'int' },
      { label: 'Balance to pack', value: balanceTotal, type: 'int' }
    ]
  };
}

async function hourlyReport(pool, f, hasJr) {
  const r = await pool.query(`
    WITH s AS (
      SELECT sc.plan_id, p.table_id, (sc."timestamp" AT TIME ZONE '${TZ}') AS t
        FROM assembly_scans sc JOIN assembly_plans p ON p.id = sc.plan_id
       WHERE sc.is_match AND ${SCAN_RANGE} AND ${PLAN_FILTER}
    ), ps AS (${planStdSql(hasJr, 'SELECT DISTINCT plan_id FROM s')}
    ), st AS (
      SELECT s.table_id, COUNT(DISTINCT s.t::date)::int AS days, AVG(ps.cycle)::float AS avg_cycle
        FROM s LEFT JOIN ps ON ps.id = s.plan_id GROUP BY 1
    )
    SELECT s.table_id, EXTRACT(HOUR FROM s.t)::int AS h, COUNT(*)::int AS n, st.days, st.avg_cycle
      FROM s JOIN st ON st.table_id = s.table_id
     GROUP BY s.table_id, 2, st.days, st.avg_cycle
     ORDER BY s.table_id, 2`, filterParams(f));
  const byStation = new Map();
  for (const x of r.rows) {
    if (!byStation.has(x.table_id)) {
      byStation.set(x.table_id, { station: x.table_id, days: x.days, std_rate: x.avg_cycle ? round(3600 / x.avg_cycle) : null, total: 0, cells: Array(24).fill(null) });
    }
    const s = byStation.get(x.table_id);
    s.cells[x.h] = Math.max(1, round(x.n / Math.max(1, x.days)));
    s.total += x.n;
  }
  const used = new Set();
  byStation.forEach(s => s.cells.forEach((v, h) => { if (v !== null) used.add(h); }));
  const hours = used.size ? Array.from({ length: Math.max(...used) - Math.min(...used) + 1 }, (_, i) => Math.min(...used) + i) : [];
  const rows = [...byStation.values()].map(s => {
    const o = { station: s.station, days: s.days, total: s.total, std_rate: s.std_rate };
    hours.forEach(h => { o[`h${h}`] = s.cells[h]; });
    return o;
  });
  const hourTotals = hours.map(h => rows.reduce((t, x) => t + (x[`h${h}`] || 0), 0));
  const peakIdx = hourTotals.length ? hourTotals.indexOf(Math.max(...hourTotals)) : -1;
  return {
    columns: [
      { key: 'station', label: 'Station' }, { key: 'days', label: 'Days', type: 'int' },
      ...hours.map(h => ({ key: `h${h}`, label: String(h).padStart(2, '0'), type: 'heat' })),
      { key: 'std_rate', label: 'Std / hr', type: 'int' }, { key: 'total', label: 'Total', type: 'int' }
    ],
    rows,
    note: 'Average pieces per clock hour on the days the station packed. Shaded amber below 70% of the standard rate.',
    summary: [
      { label: 'Packed', value: rows.reduce((t, x) => t + x.total, 0), type: 'int' },
      { label: 'Busiest hour', value: peakIdx >= 0 ? `${String(hours[peakIdx]).padStart(2, '0')}:00` : '–', type: 'text' }
    ]
  };
}

async function wrongReport(pool, f, hasLocks, factoryId) {
  const r = await pool.query(`
    SELECT to_char(sc."timestamp" AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS') AS at, p.table_id, p.item_name, p.client_name,
           p.job_card_no, sc.scanned_ean, p.ean_number
      FROM assembly_scans sc JOIN assembly_plans p ON p.id = sc.plan_id
     WHERE NOT sc.is_match AND ${SCAN_RANGE} AND ${PLAN_FILTER}
     ORDER BY sc."timestamp" DESC
     LIMIT ${ROW_LIMIT}`, filterParams(f));
  let locks = [];
  if (hasLocks) {
    const l = await pool.query(`
      SELECT to_char(e.locked_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS') AS at, e.table_id, e.scanned_ean, e.expected_ean,
             e.unlocked_by, EXTRACT(EPOCH FROM COALESCE(e.unlocked_at, NOW()) - e.locked_at)::float AS locked_s,
             (e.unlocked_at IS NULL) AS still_locked
        FROM packing_lock_events e
        LEFT JOIN assembly_plans p ON p.id = e.plan_id
       WHERE e.locked_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}' AND e.locked_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
         AND ($3::text IS NULL OR LOWER(e.table_id) = LOWER($3))
         AND ($4::text IS NULL OR LOWER(COALESCE(p.client_name, '')) LIKE $4)
         AND ($5::int IS NULL OR e.factory_id IS NULL OR e.factory_id = $5)
       ORDER BY e.locked_at DESC LIMIT ${ROW_LIMIT}`, [...filterParams(f), factoryId]);
    locks = l.rows;
  }
  /* each wrong scan, with the lock it caused (same station, within a few seconds) */
  const rows = r.rows.map(x => {
    const lock = locks.find(k => k.table_id === x.table_id && Math.abs(Date.parse(k.at) - Date.parse(x.at)) <= 5000);
    return {
      at: x.at, station: x.table_id, item: x.item_name, party: x.client_name, job_card: x.job_card_no,
      scanned: x.scanned_ean, expected: x.ean_number,
      unlocked_by: lock ? (lock.still_locked ? 'still locked' : lock.unlocked_by) : '',
      locked_min: lock ? round(lock.locked_s / 60, 1) : null
    };
  });
  return {
    columns: [
      { key: 'at', label: 'Time' }, { key: 'station', label: 'Station' }, { key: 'item', label: 'Item' },
      { key: 'party', label: 'Party' }, { key: 'job_card', label: 'Job card' },
      { key: 'scanned', label: 'Scanned' }, { key: 'expected', label: 'Expected' },
      { key: 'unlocked_by', label: 'Unlocked by' }, { key: 'locked_min', label: 'Locked (min)', type: 'dec' }
    ],
    rows,
    summary: [
      { label: 'Wrong scans', value: rows.length, type: 'int' },
      { label: 'Station locks', value: locks.length, type: 'int' },
      { label: 'Time locked', value: round(locks.reduce((t, k) => t + k.locked_s, 0) / 60), type: 'min' }
    ]
  };
}

/* Every box and carton made in the period, with its reprints. */
async function boxesReport(pool, f, hasBoxes) {
  const empty = { columns: [], rows: [], summary: [{ label: 'Boxes', value: 0, type: 'int' }] };
  if (!hasBoxes) return empty;
  const r = await pool.query(`
    SELECT to_char(b.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS made, b.table_id, b.kind, b.seq_no, b.code, b.item_name,
           b.client_name, b.job_card_no, b.qty, b.box_count, b.is_part, b.carton_code, b.printed_at IS NOT NULL AS printed,
           b.reprint_count, b.voided_at IS NOT NULL AS voided, b.void_reason, b.voided_by,
           (SELECT string_agg(rp.reason || ' (' || COALESCE(rp.reprinted_by, '') || ')', '; ' ORDER BY rp.reprinted_at)
              FROM packing_label_reprints rp WHERE rp.box_sync_id = b.sync_id) AS reprint_reasons
      FROM packing_boxes b
     WHERE b.created_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}' AND b.created_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
       AND ($3::text IS NULL OR LOWER(b.table_id) = LOWER($3))
       AND ($4::text IS NULL OR LOWER(b.client_name) LIKE $4)
       AND b.kind IN ('BOX', 'CARTON')
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT ${ROW_LIMIT}`, filterParams(f));
  const live = r.rows.filter(x => !x.voided);
  const rows = r.rows.map(x => ({
    made: x.made, station: x.table_id, label: `${x.kind === 'CARTON' ? 'Carton' : 'Box'} ${x.seq_no}${x.is_part ? ' (part)' : ''}`,
    code: x.code, item: x.item_name, party: x.client_name, job_card: x.job_card_no, qty: x.qty,
    boxes: x.kind === 'CARTON' ? x.box_count : null, carton: x.carton_code || '',
    printed: x.voided ? '' : (x.printed ? 'yes' : 'not yet'), reprints: x.reprint_count || 0, reprint_reasons: x.reprint_reasons || '',
    status: x.voided ? 'voided' : (x.kind === 'BOX' && !x.carton_code ? 'loose box' : 'ok'), void_reason: x.voided ? `${x.void_reason || ''} (${x.voided_by || ''})` : ''
  }));
  return {
    columns: [
      { key: 'made', label: 'Made' }, { key: 'station', label: 'Station' }, { key: 'label', label: 'Label' }, { key: 'code', label: 'Code' },
      { key: 'item', label: 'Item' }, { key: 'party', label: 'Party' }, { key: 'job_card', label: 'Job card' },
      { key: 'qty', label: 'Pcs', type: 'int' }, { key: 'boxes', label: 'Boxes', type: 'int' }, { key: 'carton', label: 'In carton' },
      { key: 'printed', label: 'Printed' }, { key: 'reprints', label: 'Reprints', type: 'int' }, { key: 'reprint_reasons', label: 'Reprint reasons' },
      { key: 'status', label: 'Status', type: 'status' }, { key: 'void_reason', label: 'Void reason' }
    ],
    rows,
    note: 'Every box and carton label made in the period. Reprints show the reason and who reprinted.',
    summary: [
      { label: 'Boxes', value: live.filter(x => x.kind === 'BOX').length, type: 'int' },
      { label: 'Cartons', value: live.filter(x => x.kind === 'CARTON').length, type: 'int' },
      { label: 'Pcs in boxes', value: live.filter(x => x.kind === 'BOX').reduce((t, x) => t + x.qty, 0), type: 'int' },
      { label: 'Reprints', value: r.rows.reduce((t, x) => t + (x.reprint_count || 0), 0), type: 'int' },
      { label: 'Voided', value: r.rows.length - live.length, type: 'int' }
    ]
  };
}

/* Handover slips opened in the period, plus what is waiting at packing now. */
async function handoverReport(pool, f, t) {
  if (!t.handovers) return { columns: [], rows: [], summary: [{ label: 'Slips', value: 0, type: 'int' }] };
  const fid = t.factoryId;
  const r = await pool.query(`
    SELECT h.slip_no, h.status, h.cartons, h.pcs, h.opened_by, h.closed_by, h.reopen_count, h.last_reopen_reason,
           to_char(h.opened_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS opened,
           to_char(h.closed_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS closed,
           (SELECT string_agg(DISTINCT b.table_id, ', ') FROM packing_boxes b WHERE b.handover_sync_id = h.sync_id) AS stations,
           (SELECT COUNT(DISTINCT b.job_card_no)::int FROM packing_boxes b WHERE b.handover_sync_id = h.sync_id) AS jobs
      FROM packing_handovers h
     WHERE h.opened_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}' AND h.opened_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
       AND ($3::int IS NULL OR h.factory_id = $3)
     ORDER BY h.opened_at DESC LIMIT ${ROW_LIMIT}`, [f.from, f.to, fid]);
  const w = await pool.query(`
    SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE b.created_at < NOW() - INTERVAL '24 hours')::int AS old,
           COUNT(*) FILTER (WHERE b.rejected_at IS NOT NULL)::int AS rejected
      FROM packing_boxes b
     WHERE (b.kind = 'CARTON' OR (b.kind = 'BOX' AND b.carton_code IS NULL AND COALESCE(b.boxes_per_carton, 0) = 0))
       AND b.voided_at IS NULL AND b.received_at IS NULL
       AND ($1::int IS NULL OR b.factory_id = $1)
       AND ($2::text IS NULL OR LOWER(b.table_id) = LOWER($2))`, [fid, f.station]);
  const rows = r.rows.map(x => ({
    slip: x.slip_no, opened: x.opened, closed: x.closed || '', opened_by: x.opened_by, closed_by: x.closed_by || '',
    stations: x.stations || '', jobs: x.jobs, cartons: x.cartons, pcs: x.pcs,
    status: x.status === 'OPEN' ? 'open' : 'closed', reopened: x.reopen_count ? `${x.reopen_count} times (${x.last_reopen_reason || ''})` : ''
  }));
  const wt = w.rows[0];
  return {
    columns: [
      { key: 'slip', label: 'Slip' }, { key: 'opened', label: 'Opened' }, { key: 'closed', label: 'Closed' },
      { key: 'opened_by', label: 'Store person' }, { key: 'stations', label: 'Stations' }, { key: 'jobs', label: 'Jobs', type: 'int' },
      { key: 'cartons', label: 'Cartons', type: 'int' }, { key: 'pcs', label: 'Pcs', type: 'int' },
      { key: 'status', label: 'Status', type: 'status' }, { key: 'reopened', label: 'Reopened' }
    ],
    rows,
    note: 'Handover slips opened in the period. The waiting figures are for right now; the list is on the Store Handover page.',
    summary: [
      { label: 'Slips', value: rows.length, type: 'int' },
      { label: 'Cartons received', value: rows.reduce((s, x) => s + x.cartons, 0), type: 'int' },
      { label: 'Pcs received', value: rows.reduce((s, x) => s + x.pcs, 0), type: 'int' },
      { label: 'Waiting at packing now', value: wt.n, type: 'int' },
      { label: 'Waiting over 24 h', value: wt.old, type: 'int' },
      { label: 'Rejected by store', value: wt.rejected, type: 'int' }
    ]
  };
}

/* Packed stock right now (received by the store, not dispatched), by item + party. */
async function stockReport(pool, f, t) {
  if (!t.dispatches) return { columns: [], rows: [], summary: [{ label: 'Cartons in store', value: 0, type: 'int' }] };
  const dispatch = require('./registerPackingDispatchRoutes');
  const fid = dispatch.serverFactoryId() || t.factoryId; // a LOCAL server is always its own factory, like /api/packing/stock
  const days = await dispatch.alertDays(pool, fid);
  const r = await pool.query(`
    SELECT b.item_name, MAX(b.item_code) AS item_code, b.client_name, COUNT(*)::int AS units,
           COUNT(*) FILTER (WHERE b.kind = 'BOX')::int AS loose_boxes, COALESCE(SUM(b.qty), 0)::int AS pcs,
           COUNT(DISTINCT b.job_card_no)::int AS jobs,
           FLOOR(EXTRACT(EPOCH FROM NOW() - MIN(b.received_at)) / 86400)::int AS oldest_days,
           COUNT(*) FILTER (WHERE b.received_at < NOW() - make_interval(days => $3))::int AS old_units
      FROM packing_boxes b
     WHERE ${dispatch.STOCK_SQL}
       AND ($1::int IS NULL OR b.factory_id = $1)
       AND ($2::text IS NULL OR LOWER(COALESCE(b.client_name, '')) = LOWER($2))
     GROUP BY b.item_name, b.client_name
     ORDER BY MIN(b.received_at) LIMIT ${ROW_LIMIT}`, [fid, f.party, days]);
  const rows = r.rows.map(x => ({
    item: x.item_name, code: x.item_code || '', party: x.client_name || '', jobs: x.jobs,
    cartons: x.units - x.loose_boxes, boxes: x.loose_boxes, pcs: x.pcs, oldest_days: x.oldest_days,
    status: x.old_units ? 'old-stock' : 'ok'
  }));
  return {
    columns: [
      { key: 'item', label: 'Item' }, { key: 'code', label: 'Code' }, { key: 'party', label: 'Party' }, { key: 'jobs', label: 'Job cards', type: 'int' },
      { key: 'cartons', label: 'Cartons', type: 'int' }, { key: 'boxes', label: 'Loose boxes', type: 'int' }, { key: 'pcs', label: 'Pcs', type: 'int' },
      { key: 'oldest_days', label: 'Oldest (days)', type: 'int' }, { key: 'status', label: 'Status', type: 'status' }
    ],
    rows,
    note: `Stock right now: cartons the store received and has not dispatched. Dates do not apply. Old stock = older than ${days} days (Packing Masters).`,
    summary: [
      { label: 'Items', value: rows.length, type: 'int' },
      { label: 'Cartons', value: rows.reduce((s, x) => s + x.cartons, 0), type: 'int' },
      { label: 'Loose boxes', value: rows.reduce((s, x) => s + x.boxes, 0), type: 'int' },
      { label: 'Pcs', value: rows.reduce((s, x) => s + x.pcs, 0), type: 'int' },
      { label: `Items with stock over ${days} days`, value: rows.filter(x => x.status === 'old-stock').length, type: 'int' }
    ]
  };
}

/* Dispatch slips opened in the period. */
async function dispatchReport(pool, f, t) {
  if (!t.dispatches) return { columns: [], rows: [], summary: [{ label: 'Slips', value: 0, type: 'int' }] };
  const r = await pool.query(`
    SELECT d.slip_no, d.status, d.party, d.vehicle_no, d.invoice_no, d.cartons, d.pcs, d.opened_by, d.reopen_count, d.last_reopen_reason,
           to_char(d.opened_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS opened,
           to_char(d.closed_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS closed,
           (SELECT COUNT(DISTINCT b.job_card_no)::int FROM packing_boxes b WHERE b.dispatch_sync_id = d.sync_id) AS jobs
      FROM packing_dispatches d
     WHERE d.opened_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}' AND d.opened_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
       AND ($3::int IS NULL OR d.factory_id = $3)
       AND ($4::text IS NULL OR LOWER(d.party) = LOWER($4))
     ORDER BY d.opened_at DESC LIMIT ${ROW_LIMIT}`, [f.from, f.to, require('./registerPackingDispatchRoutes').serverFactoryId() || t.factoryId, f.party]);
  const rows = r.rows.map(x => ({
    slip: x.slip_no, opened: x.opened, closed: x.closed || '', party: x.party, vehicle: x.vehicle_no || '', invoice: x.invoice_no || '',
    opened_by: x.opened_by || '', jobs: x.jobs, cartons: x.cartons, pcs: x.pcs,
    status: x.status === 'OPEN' ? 'open' : 'closed', reopened: x.reopen_count ? `${x.reopen_count} times (${x.last_reopen_reason || ''})` : ''
  }));
  return {
    columns: [
      { key: 'slip', label: 'Slip' }, { key: 'opened', label: 'Opened' }, { key: 'closed', label: 'Closed' }, { key: 'party', label: 'Party' },
      { key: 'vehicle', label: 'Vehicle' }, { key: 'invoice', label: 'Invoice / DC' }, { key: 'opened_by', label: 'Store person' },
      { key: 'jobs', label: 'Jobs', type: 'int' }, { key: 'cartons', label: 'Cartons', type: 'int' }, { key: 'pcs', label: 'Pcs', type: 'int' },
      { key: 'status', label: 'Status', type: 'status' }, { key: 'reopened', label: 'Reopened' }
    ],
    rows,
    note: 'Dispatch slips opened in the period. The station filter does not apply.',
    summary: [
      { label: 'Slips', value: rows.length, type: 'int' },
      { label: 'Cartons dispatched', value: rows.reduce((s, x) => s + x.cartons, 0), type: 'int' },
      { label: 'Pcs dispatched', value: rows.reduce((s, x) => s + x.pcs, 0), type: 'int' },
      { label: 'Vehicles', value: new Set(rows.map(x => x.vehicle).filter(Boolean)).size, type: 'int' }
    ]
  };
}

/* Packers (step 10): each packer's hours on station and share of the station's pieces. */
async function packersReport(pool, f, t) {
  const empty = (note) => ({ columns: PACKER_COLUMNS, rows: [], note, summary: [] });
  if (!t.crew) return empty('No crew has been recorded on this server yet. Put packers on stations from the Packing Plan or a station screen.');
  const fid = t.factoryId || crewRoutes.serverFactoryId();
  const fromMs = Date.parse(`${f.from}T00:00:00+05:30`);
  const toMs = Date.parse(`${f.to}T00:00:00+05:30`) + 864e5;
  let crew = await crewRoutes.crewRows(pool, fid, fromMs, toMs);
  crew = crew.filter(c => c.start_ms < toMs && c.start_ms >= fromMs - 864e5 && (!f.station || c.station_name.toLowerCase() === f.station.toLowerCase()));
  const r = await pool.query(`
    WITH s AS (
      SELECT sc.plan_id, p.table_id, date_trunc('hour', sc."timestamp" AT TIME ZONE '${TZ}') AS h
        FROM assembly_scans sc JOIN assembly_plans p ON p.id = sc.plan_id
       WHERE sc.is_match AND ${SCAN_RANGE} AND ($3::text IS NULL OR LOWER(p.table_id) = LOWER($3)) AND ($4::text IS NULL OR TRUE)
    ), ps AS (${planStdSql(t.jr, 'SELECT DISTINCT plan_id FROM s')})
    SELECT s.table_id, to_char(s.h, 'YYYY-MM-DD"T"HH24:MI:SS') AS h, COUNT(*)::int AS n, ps.cycle, COALESCE(ps.persons, stn.persons)::float AS persons
      FROM s LEFT JOIN ps ON ps.id = s.plan_id
      LEFT JOIN LATERAL (SELECT persons FROM packing_stations x WHERE LOWER(x.name) = LOWER(s.table_id) AND x.is_active ORDER BY x.id LIMIT 1) stn ON TRUE
     GROUP BY s.table_id, s.h, ps.cycle, COALESCE(ps.persons, stn.persons)`, filterParams(f));
  const scans = r.rows.map(x => ({ station: x.table_id, hour_ms: Date.parse(`${x.h}+05:30`), n: x.n, cycle: x.cycle, persons: x.persons }));
  const { rows, unassigned } = crewMath.shareOutput(crew, scans, Date.now());
  const inRange = rows.filter(x => x.day >= f.from && x.day <= f.to);
  const noCrewPcs = unassigned.filter(x => x.day >= f.from && x.day <= f.to).reduce((s, x) => s + x.pcs, 0);
  const stdRows = inRange.filter(x => x.vs_std !== null);
  return {
    columns: PACKER_COLUMNS,
    rows: inRange,
    note: 'A station\'s good scans in each hour are shared among the packers on it in that hour, by their minutes there. Hours count 09:00-17:00 only. vs std = standard person-time earned (pieces x cycle seconds x standard persons) / time on station.' +
      (noCrewPcs ? ` ${noCrewPcs.toLocaleString('en-IN')} pieces were packed while no packer was recorded on the station.` : ''),
    summary: [
      { label: 'Packers', value: new Set(inRange.map(x => x.worker_id)).size, type: 'int' },
      { label: 'Person-hours', value: (Math.round(inRange.reduce((s, x) => s + x.hours, 0) * 10) / 10).toFixed(1), type: 'text' },
      { label: 'Pieces shared', value: inRange.reduce((s, x) => s + x.pcs, 0), type: 'int' },
      { label: 'Pieces with no crew', value: noCrewPcs, type: 'int' },
      { label: 'Average vs std', value: stdRows.length ? `${Math.round(stdRows.reduce((s, x) => s + x.vs_std * x.hours, 0) / Math.max(0.1, stdRows.reduce((s, x) => s + x.hours, 0)))}%` : '–', type: 'text' }
    ]
  };
}

const PACKER_COLUMNS = [
  { key: 'day', label: 'Day' }, { key: 'worker_name', label: 'Packer' }, { key: 'badge_no', label: 'Badge' },
  { key: 'contractor', label: 'Contractor' }, { key: 'stations', label: 'Stations' },
  { key: 'hours', label: 'Hours', type: 'dec' }, { key: 'pcs', label: 'Pieces', type: 'int' },
  { key: 'pcs_hr', label: 'Pcs / hr', type: 'int' }, { key: 'vs_std', label: 'vs std %', type: 'pct' }
];

const REPORTS = {
  daily: { title: 'Daily summary', run: (pool, f, t) => dailyReport(pool, f, t.jr) },
  jobs: { title: 'Jobs', run: (pool, f, t) => jobsReport(pool, f, t.jr, t.boxes) },
  jobcards: { title: 'Job cards', run: (pool, f, t) => jobcardsReport(pool, f, t.jr) },
  hourly: { title: 'Hourly output', run: (pool, f, t) => hourlyReport(pool, f, t.jr) },
  wrong: { title: 'Wrong scans', run: (pool, f, t) => wrongReport(pool, f, t.locks, t.factoryId) },
  boxes: { title: 'Boxes and labels', run: (pool, f, t) => boxesReport(pool, f, t.boxes) },
  handover: { title: 'Store handover', run: (pool, f, t) => handoverReport(pool, f, t) },
  stock: { title: 'Packed stock', run: (pool, f, t) => stockReport(pool, f, t) },
  dispatch: { title: 'Dispatch', run: (pool, f, t) => dispatchReport(pool, f, t) },
  packers: { title: 'Packers', run: (pool, f, t) => packersReport(pool, f, t) }
};

function minText(v) {
  if (v === null || v === undefined) return '';
  const h = Math.floor(v / 60), m = Math.round(v % 60);
  return h ? `${h} h ${m} m` : `${m} m`;
}

function toSheetRows(report) {
  return report.rows.map(row => {
    const o = {};
    report.columns.forEach(c => {
      const v = row[c.key];
      o[c.label] = c.type === 'min' ? minText(v) : (v === null || v === undefined ? '' : v);
    });
    return o;
  });
}

function registerPackingReportRoutes(app, pool) {
  async function tables() {
    const r = await pool.query(`SELECT to_regclass('public.or_jr_report') AS jr, to_regclass('public.packing_lock_events') AS locks, to_regclass('public.packing_boxes') AS boxes, to_regclass('public.packing_handovers') AS handovers, to_regclass('public.packing_dispatches') AS dispatches, to_regclass('public.packing_crew') AS crew,
                                       to_regclass('public.assembly_scans') AS scans, to_regclass('public.packing_item_standards') AS std`);
    const t = r.rows[0] || {};
    return { jr: Boolean(t.jr), locks: Boolean(t.locks), boxes: Boolean(t.boxes), handovers: Boolean(t.handovers), dispatches: Boolean(t.dispatches), crew: Boolean(t.crew), ready: Boolean(t.scans) && Boolean(t.std) };
  }

  async function build(req) {
    const def = REPORTS[req.params.type];
    if (!def) { const e = new Error('Unknown report.'); e.status = 404; throw e; }
    const f = readFilters(req.query);
    const t = await tables();
    const fid = req.headers ? getFactoryId(req) : null;
    t.factoryId = Number.isInteger(fid) && fid > 0 ? fid : null;
    if (!t.ready) { const e = new Error('Packing tables are not set up on this server yet.'); e.status = 400; throw e; }
    const report = await def.run(pool, f, t);
    return { def, f, report };
  }

  function guard(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }

  function fail(res, err) {
    if (err && err.status) return res.status(err.status).json({ ok: false, error: err.message });
    return sendServerError(res, err);
  }

  app.get('/api/packing/reports/:type/export.xlsx', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const { def, f, report } = await build(req);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(toSheetRows(report), { header: report.columns.map(c => c.label) });
      ws['!cols'] = report.columns.map(c => ({ wch: Math.max(8, Math.min(40, c.label.length + 4, ['item', 'party'].includes(c.key) ? 34 : 18)) }));
      XLSX.utils.book_append_sheet(wb, ws, def.title.slice(0, 31));
      const info = XLSX.utils.aoa_to_sheet([
        ['Packing report', def.title], ['From', f.from], ['To', f.to], ['Station', f.station || 'All'], ['Party', f.party || 'All'],
        ['Idle', `pauses over ${IDLE_MIN} minutes between good scans`],
        ['Efficiency', 'standard time earned (packed x cycle seconds from Packing Masters) / working time'],
        ...report.summary.map(s => [s.label, s.type === 'min' ? minText(s.value) : s.value ?? ''])
      ]);
      XLSX.utils.book_append_sheet(wb, info, 'Filters');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="packing-${req.params.type}-${f.from}-to-${f.to}.xlsx"`);
      res.send(buf);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/packing/reports/:type', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const { def, f, report } = await build(req);
      res.json({ ok: true, data: { type: req.params.type, title: def.title, filters: f, rules: { idle_min: IDLE_MIN, over_pct: OVER_PCT }, ...report, truncated: report.rows.length >= ROW_LIMIT } });
    } catch (err) { fail(res, err); }
  });
}

module.exports = { registerPackingReportRoutes, readFilters, minText, IDLE_MIN, OVER_PCT };
