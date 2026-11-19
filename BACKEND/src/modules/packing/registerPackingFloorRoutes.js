'use strict';

/**
 * Packing floor - the planning board (assembly.html) and the station scanning
 * screen (scan_station.html).
 *
 *  - GET  /api/packing/board?date=YYYY-MM-DD   stations as rows, the day's plans with
 *                                               packed qty, live rate, standard rate and
 *                                               boxes; totals; job cards waiting to pack.
 *  - GET  /api/packing/station-screen?station=  everything one station's screen shows.
 *  - GET  /api/packing/live                    the live packing screen: station tiles, totals,
 *                                               store and dispatch figures, alerts (packingLive.js).
 *  - POST /api/packing/plans/:id/start          make this the station's running job.
 *  - POST /api/packing/plans/:id/finish         mark the job Done.
 *  - POST /api/packing/unlock                   supervisor PIN clears a wrong-barcode lock.
 *  - GET/POST/DELETE /api/packing/pins          supervisor PINs (MAIN only, per factory).
 *
 * Plans and scans stay in assembly_plans / assembly_scans. The scanner bridge
 * (CLIENT_BRIDGE) still reads /api/assembly/lines and /api/assembly/active and posts
 * to /api/assembly/scan, so a station's IP scanner lives in assembly_lines under the
 * station name (saving a station mirrors it there).
 *
 * Wrong-barcode lock: when a factory has at least one supervisor PIN, a wrong scan
 * opens a row in packing_lock_events and every scan on that station is refused until
 * a supervisor unlocks it with a PIN. With no PIN set nothing locks on the server
 * (the old pages keep their own Resume button).
 */

const crypto = require('crypto');
const { getFactoryId, getRequestUsername, normalizeFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const { itemKey, canEditMasters, pcsPerHour, ensurePackingSchema } = require('./registerPackingMasterRoutes');
const packingBoxes = require('./registerPackingBoxRoutes');
const live = require('./packingLive');

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';
/* The factory this server stands in: a LOCAL box's own factory, null on MAIN. */
const serverFactoryId = () => (isLocalServer() ? normalizeFactoryId(process.env.LOCAL_FACTORY_ID) : null);

const RATE_WINDOW_MIN = 15;
const OPEN_PLAN_DAYS = 7;
const PIN_RE = /^\d{4,6}$/;

function clean(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const KEY_SQL = (col) => `UPPER(REGEXP_REPLACE(TRIM(COALESCE(${col}, '')), '^0+(?=.)', ''))`;

async function ensurePackingFloorSchema(pool) {
  await ensurePackingSchema(pool);
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_floor_schema'));
    CREATE TABLE IF NOT EXISTS packing_supervisor_pins (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      pin_salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_id UUID DEFAULT gen_random_uuid()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_pins_user ON packing_supervisor_pins (COALESCE(factory_id, 0), LOWER(username));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_supervisor_pins ON packing_supervisor_pins (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_pins_updated ON packing_supervisor_pins (updated_at);
    CREATE TABLE IF NOT EXISTS packing_lock_events (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      table_id TEXT NOT NULL,
      plan_id INTEGER,
      plan_sync_id UUID,
      scanned_ean TEXT NOT NULL DEFAULT '',
      expected_ean TEXT NOT NULL DEFAULT '',
      locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unlocked_at TIMESTAMPTZ,
      unlocked_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_id UUID NOT NULL DEFAULT gen_random_uuid()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_lock_events ON packing_lock_events (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_lock_open ON packing_lock_events (table_id) WHERE unlocked_at IS NULL;
    CREATE INDEX IF NOT EXISTS ix_packing_lock_updated ON packing_lock_events (updated_at);
    DO $$
    BEGIN
      IF to_regclass('public.assembly_plans') IS NOT NULL THEN
        ALTER TABLE assembly_plans ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP;
        ALTER TABLE assembly_plans ADD COLUMN IF NOT EXISTS finished_by TEXT;
        ALTER TABLE assembly_plans ADD COLUMN IF NOT EXISTS tables TEXT;
      END IF;
      IF to_regclass('public.assembly_scans') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS ix_assembly_scans_plan_ts ON assembly_scans (plan_id, "timestamp");
        CREATE INDEX IF NOT EXISTS ix_assembly_scans_ts ON assembly_scans ("timestamp");
      END IF;
    END $$;
  `);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function pinMatches(pin, row) {
  const a = Buffer.from(hashPin(pin, row.pin_salt), 'hex');
  const b = Buffer.from(String(row.pin_hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- used by the legacy /api/assembly/scan handler ---------- */

async function pinsEnabled(pool, fid = serverFactoryId()) {
  if (!fid) return false;
  try {
    const r = await pool.query(
      'SELECT 1 FROM packing_supervisor_pins WHERE is_active AND factory_id = $1 LIMIT 1', [fid]);
    return r.rows.length > 0;
  } catch (_) { return false; }
}

async function openLockFor(pool, tableId, fid = serverFactoryId()) {
  try {
    const r = await pool.query(
      `SELECT * FROM packing_lock_events
        WHERE table_id = $1 AND unlocked_at IS NULL AND factory_id IS NOT DISTINCT FROM $2
        ORDER BY locked_at DESC LIMIT 1`, [tableId, fid]);
    return r.rows[0] || null;
  } catch (_) { return null; }
}

/* A wrong scan locks the station - only when this factory has a supervisor PIN to unlock it. */
async function lockStationForWrongScan(pool, plan, scannedEan, expectedEan) {
  const fid = serverFactoryId();
  if (!await pinsEnabled(pool, fid)) return null;
  if (await openLockFor(pool, plan.table_id, fid)) return null;
  const r = await pool.query(
    `INSERT INTO packing_lock_events (factory_id, table_id, plan_id, plan_sync_id, scanned_ean, expected_ean)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [fid, plan.table_id, plan.id, plan.sync_id || null, clean(scannedEan, 80), clean(expectedEan, 80)]);
  return r.rows[0];
}

/* ---------- routes ---------- */

function registerPackingFloorRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensurePackingFloorSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing floor] schema ensure failed:', err.message));

  const readFactory = (req) => normalizeFactoryId(getFactoryId(req));
  const userOf = (req) => (req.auth && req.auth.username) || getRequestUsername(req) || '';

  function requireUser(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }

  async function tableExists(name) {
    const r = await pool.query('SELECT to_regclass($1) AS t', [`public.${name}`]);
    return Boolean(r.rows[0] && r.rows[0].t);
  }

  /* Plans with packed qty, live rate, standard rate and box size. */
  async function planDetails(whereSql, params) {
    const hasJr = await tableExists('or_jr_report');
    const jrJoin = hasJr ? `
      LEFT JOIN LATERAL (
        SELECT item_code FROM or_jr_report j
         WHERE NULLIF(TRIM(COALESCE(p.job_card_no, '')), '') IS NOT NULL
           AND (UPPER(TRIM(j.job_card_no)) = UPPER(TRIM(p.job_card_no)) OR UPPER(TRIM(j.or_jr_no)) = UPPER(TRIM(p.job_card_no)))
           AND COALESCE(j.is_deleted, FALSE) = FALSE
         LIMIT 1
      ) jr ON TRUE` : 'LEFT JOIN LATERAL (SELECT NULL::text AS item_code) jr ON TRUE';
    const r = await pool.query(`
      SELECT p.id, p.table_id, p.item_name, p.client_name, p.job_card_no, p.ean_number, p.plan_qty,
             COALESCE(p.scanned_qty, 0)::int AS scanned_qty,
             UPPER(COALESCE(NULLIF(TRIM(p.status), ''), 'PLANNED')) AS status,
             p.duration_min, p.delay_min, p.finished_at, p.machine, p.tables,
             to_char(p.start_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_local,
             to_char(p.end_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_local,
             to_char(p.finished_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS finished_local,
             (SELECT COUNT(*)::int FROM assembly_scans s
               WHERE s.plan_id = p.id AND s.is_match AND s."timestamp" > NOW() - INTERVAL '${RATE_WINDOW_MIN} minutes') AS recent_scans,
             (SELECT to_char(MAX(s."timestamp") AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM assembly_scans s WHERE s.plan_id = p.id) AS last_scan_at,
             st.cycle_time_sec, st.persons AS std_persons, bx.pcs_per_box, bx.boxes_per_carton,
             jr.item_code
        FROM assembly_plans p
        ${jrJoin}
        LEFT JOIN LATERAL (
          SELECT s.cycle_time_sec, s.persons FROM packing_item_standards s
           WHERE s.is_active AND jr.item_code IS NOT NULL AND s.item_key = ${KEY_SQL('jr.item_code')}
             AND LOWER(s.station_name) = LOWER(p.table_id) AND s.cycle_time_sec > 0
           ORDER BY (LOWER(s.party_group) = LOWER(COALESCE(p.client_name, ''))) DESC
           LIMIT 1
        ) st ON TRUE
        LEFT JOIN LATERAL (
          SELECT s.pcs_per_box, s.boxes_per_carton FROM packing_item_standards s
           WHERE s.is_active AND jr.item_code IS NOT NULL AND s.item_key = ${KEY_SQL('jr.item_code')} AND s.pcs_per_box > 0
           ORDER BY (LOWER(s.party_group) = LOWER(COALESCE(p.client_name, ''))) DESC, (LOWER(s.station_name) = LOWER(p.table_id)) DESC
           LIMIT 1
        ) bx ON TRUE
       ${whereSql}
       ORDER BY p.table_id, p.start_time`, params);
    return r.rows.map(p => ({
      ...p,
      rate_now: Math.round(p.recent_scans * (60 / RATE_WINDOW_MIN)),
      std_pcs_hr: pcsPerHour(p.cycle_time_sec)
    }));
  }

  async function stationRows(fid) {
    const r = await pool.query(
      `SELECT st.id, st.name, st.code, st.persons, st.sort_order, st.scanner_config, st.auto_print_labels,
              COALESCE(NULLIF(al.scanner_config, ''), NULLIF(st.scanner_config, ''), '') AS scanner
         FROM packing_stations st
         LEFT JOIN assembly_lines al ON al.line_id = st.name
        WHERE st.is_active AND ($1::int IS NULL OR st.factory_id = $1)
        ORDER BY st.sort_order, st.name`, [fid]);
    return r.rows;
  }

  /* ---------------- Planning board ---------------- */

  app.get('/api/packing/board', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
      const day = date || new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const stations = await stationRows(fid);
      /* plans touching the day; a running job from an earlier day stays on the board */
      const plans = await planDetails(`
        WHERE UPPER(COALESCE(p.status, '')) NOT IN ('ARCHIVED', 'CANCELLED')
          AND ((p.start_time < ($1::date + 1) AND COALESCE(p.end_time, p.start_time) >= $1::date)
               OR (UPPER(COALESCE(p.status, '')) = 'RUNNING' AND p.start_time >= $1::date - ${OPEN_PLAN_DAYS} AND p.start_time < ($1::date + 1)))`, [day]);

      const known = new Set(stations.map(s => s.name.toLowerCase()));
      const oldTables = [...new Set(plans.map(p => p.table_id).filter(t => t && !known.has(String(t).toLowerCase())))];
      const lines = await pool.query('SELECT line_id, scanner_config FROM assembly_lines WHERE line_id = ANY($1::text[])', [oldTables]);
      const lineScanner = Object.fromEntries(lines.rows.map(l => [l.line_id, l.scanner_config || '']));
      const rows = [
        ...stations.map(s => ({ name: s.name, persons: s.persons, scanner: s.scanner, is_station: true })),
        ...oldTables.sort().map(t => ({ name: t, persons: null, scanner: lineScanner[t] || '', is_station: false }))
      ];

      let waiting = [];
      if (await tableExists('or_jr_report')) {
        const w = await pool.query(`
          WITH ready AS (
            SELECT DISTINCT item_key FROM packing_item_standards
             WHERE is_active AND station_name <> '' AND ($1::int IS NULL OR factory_id = $1)
          ), jc AS (
            SELECT DISTINCT ON (UPPER(TRIM(job_card_no))) job_card_no, or_jr_no, item_code, product_name, client_name,
                   jr_qty, or_jr_date
              FROM or_jr_report
             WHERE COALESCE(is_deleted, FALSE) = FALSE
               AND NULLIF(TRIM(COALESCE(job_card_no, '')), '') IS NOT NULL
               AND or_jr_date >= CURRENT_DATE - 45
               AND ($1::int IS NULL OR factory_id = $1)
             ORDER BY UPPER(TRIM(job_card_no)), or_jr_date DESC NULLS LAST
          ), planned AS (
            SELECT UPPER(TRIM(job_card_no)) AS jc, SUM(plan_qty)::int AS qty FROM assembly_plans
             WHERE NULLIF(TRIM(COALESCE(job_card_no, '')), '') IS NOT NULL
               AND UPPER(COALESCE(status, '')) NOT IN ('ARCHIVED', 'CANCELLED')
             GROUP BY 1
          )
          SELECT jc.job_card_no, jc.or_jr_no, jc.item_code, jc.product_name AS item_name, jc.client_name,
                 COALESCE(jc.jr_qty, 0)::int AS jr_qty, COALESCE(pl.qty, 0)::int AS planned_qty,
                 (COALESCE(jc.jr_qty, 0) - COALESCE(pl.qty, 0))::int AS balance_qty,
                 to_char(jc.or_jr_date, 'YYYY-MM-DD') AS jr_date
            FROM jc
            JOIN ready ON ready.item_key = ${KEY_SQL('jc.item_code')}
            LEFT JOIN planned pl ON pl.jc = UPPER(TRIM(jc.job_card_no))
           WHERE COALESCE(jc.jr_qty, 0) > COALESCE(pl.qty, 0)
             AND COALESCE(pl.qty, 0) = 0
           ORDER BY jc.or_jr_date DESC NULLS LAST, jc.job_card_no
           LIMIT 40`, [fid]);
        waiting = w.rows;
      }

      const totals = plans.reduce((t, p) => {
        t.planned += Number(p.plan_qty) || 0;
        t.packed += Math.min(Number(p.scanned_qty) || 0, Number(p.plan_qty) || 0);
        t.running += p.status === 'RUNNING' ? 1 : 0;
        return t;
      }, { planned: 0, packed: 0, running: 0, plans: plans.length });

      res.json({ ok: true, data: { date: day, rows, plans, totals, waiting } });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- Live screen (packing_live.html) ---------------- */

  app.get('/api/packing/live', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const now = Date.now();
      const { day, startMs } = live.istDay(now);
      const fid = readFactory(req);
      const boxFid = serverFactoryId() || fid;
      const stations = await stationRows(fid);
      const plans = await planDetails(`
        WHERE UPPER(COALESCE(p.status, '')) NOT IN ('ARCHIVED', 'CANCELLED')
          AND ((p.start_time < ($1::date + 1) AND COALESCE(p.end_time, p.start_time) >= $1::date)
               OR (UPPER(COALESCE(p.status, '')) = 'RUNNING' AND p.start_time >= $1::date - ${OPEN_PLAN_DAYS} AND p.start_time < ($1::date + 1)))`, [day]);
      const scans = await live.scanFigures(pool, startMs);
      const crewNow = await require('./registerPackingCrewRoutes').crewNow(pool, serverFactoryId() || fid, now);
      const crewInUse = crewNow.size > 0;

      const known = new Set(stations.map(s => s.name.toLowerCase()));
      const oldTables = [...new Set(plans.map(p => p.table_id).filter(t => t && !known.has(String(t).toLowerCase())))].sort();
      const rows = [
        ...stations.map(s => ({ name: s.name, persons: s.persons, is_station: true })),
        ...oldTables.map(t => ({ name: t, persons: null, is_station: false }))
      ];
      const tiles = [];
      for (const row of rows) {
        const key = row.name.toLowerCase();
        const own = plans.filter(p => String(p.table_id || '').toLowerCase() === key);
        const lock = await openLockFor(pool, row.name);
        tiles.push(live.stationTile(row, own, scans.get(key), lock, now, crewInUse ? (crewNow.get(key) || { n: 0, names: [] }) : null));
      }

      let store = null;
      try {
        await packingBoxes.ensurePackingBoxSchema(pool);
        const { alertDays } = require('./registerPackingDispatchRoutes');
        store = await live.storeFigures(pool, boxFid, startMs, await alertDays(pool, boxFid));
        for (const t of tiles) t.waiting_store = store.waiting_by_station[t.name.toLowerCase()] || 0;
        delete store.waiting_by_station;
      } catch (e) { console.warn('[Packing live] store figures failed:', e.message); }

      res.json({
        ok: true,
        data: {
          date: day,
          now: new Date(now).toISOString(),
          in_shift: live.inShift(now),
          minutes_left: Math.round(live.minutesLeftToday(now)),
          idle_min: live.IDLE_MIN,
          stations: tiles,
          totals: live.totalsOf(tiles),
          store,
          alerts: live.alertsOf(tiles, store || { waiting_old: 0, old_stock_units: 0 })
        }
      });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- Station screen ---------------- */

  app.get('/api/packing/station-screen', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const stations = await stationRows(fid);
      const name = clean(req.query.station, 80);
      if (!name) return res.json({ ok: true, data: { stations, station: null } });

      const station = stations.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
      const line = await pool.query('SELECT scanner_config FROM assembly_lines WHERE line_id = $1', [name]);
      const plans = await planDetails(`
        WHERE LOWER(p.table_id) = LOWER($1)
          AND UPPER(COALESCE(p.status, '')) NOT IN ('ARCHIVED', 'CANCELLED', 'DONE')
          AND p.start_time >= CURRENT_DATE - ${OPEN_PLAN_DAYS}`, [name]);
      const running = plans.filter(p => p.status === 'RUNNING');
      const current = running[running.length - 1] || plans[0] || null;
      const queue = plans.filter(p => !current || p.id !== current.id).slice(0, 6);

      let scans = [];
      if (current) {
        const s = await pool.query(
          `SELECT scanned_ean, is_match, to_char("timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
             FROM assembly_scans WHERE plan_id = $1 ORDER BY "timestamp" DESC LIMIT 12`, [current.id]);
        scans = s.rows;
      }
      const today = await pool.query(
        `SELECT COUNT(*)::int AS n FROM assembly_scans s JOIN assembly_plans p ON p.id = s.plan_id
          WHERE LOWER(p.table_id) = LOWER($1) AND s.is_match AND s."timestamp" >= date_trunc('day', NOW())`, [name]);
      const finished = await pool.query(
        `SELECT p.id, p.item_name, p.plan_qty, COALESCE(p.scanned_qty, 0)::int AS scanned_qty,
                to_char(p.finished_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS finished_local
           FROM assembly_plans p
          WHERE LOWER(p.table_id) = LOWER($1) AND UPPER(COALESCE(p.status, '')) = 'DONE'
            AND p.finished_at >= CURRENT_DATE
          ORDER BY p.finished_at DESC LIMIT 5`, [name]);
      const lock = await openLockFor(pool, name);
      const crewMap = await require('./registerPackingCrewRoutes').crewNow(pool, serverFactoryId() || fid);
      const crew = crewMap.get(name.toLowerCase()) || { n: 0, names: [] };
      let box = null, labels = [], pendingLabels = 0, waitingStore = 0;
      try {
        await packingBoxes.ensurePackingBoxSchema(pool);
        if (current) box = await packingBoxes.boxState(pool, current);
        labels = await packingBoxes.recentLabels(pool, name);
        pendingLabels = await packingBoxes.pendingCount(pool, name);
        waitingStore = await require('./registerPackingHandoverRoutes').waitingCount(pool, name);
      } catch (e) { console.warn('[Packing] box state failed:', e.message); }

      res.json({
        ok: true,
        data: {
          stations,
          station: station || { name, persons: null, scanner: '', is_old_table: true },
          scanner: (line.rows[0] && line.rows[0].scanner_config) || (station && station.scanner) || '',
          current,
          queue,
          scans,
          finished_today: finished.rows,
          packed_today: today.rows[0].n,
          lock,
          pins_enabled: await pinsEnabled(pool),
          box,
          labels,
          pending_labels: pendingLabels,
          waiting_store: waitingStore,
          auto_print: station ? station.auto_print_labels !== false : true,
          crew,
          crew_in_use: crewMap.size > 0
        }
      });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- Start / finish a job ---------------- */

  async function loadPlan(id) {
    const r = await pool.query('SELECT * FROM assembly_plans WHERE id = $1', [id]);
    return r.rows[0] || null;
  }

  app.post('/api/packing/plans/:id/start', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const plan = await loadPlan(parseInt(req.params.id, 10));
      if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found.' });
      const user = userOf(req);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        /* the station's other running job: Done when its qty is packed, else back to Planned */
        await client.query(
          `UPDATE assembly_plans
              SET status = CASE WHEN COALESCE(scanned_qty, 0) >= COALESCE(plan_qty, 0) AND COALESCE(plan_qty, 0) > 0 THEN 'DONE' ELSE 'PLANNED' END,
                  finished_at = CASE WHEN COALESCE(scanned_qty, 0) >= COALESCE(plan_qty, 0) AND COALESCE(plan_qty, 0) > 0 THEN LOCALTIMESTAMP ELSE finished_at END,
                  finished_by = CASE WHEN COALESCE(scanned_qty, 0) >= COALESCE(plan_qty, 0) AND COALESCE(plan_qty, 0) > 0 THEN $3 ELSE finished_by END,
                  updated_at = NOW()
            WHERE table_id = $1 AND id <> $2 AND UPPER(COALESCE(status, '')) = 'RUNNING'`, [plan.table_id, plan.id, user]);
        await client.query(
          `UPDATE assembly_plans SET status = 'RUNNING', finished_at = NULL, finished_by = NULL, updated_at = NOW() WHERE id = $1`, [plan.id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/plans/:id/finish', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const plan = await loadPlan(parseInt(req.params.id, 10));
      if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found.' });
      /* the last part box and part carton are closed with the job */
      let made = [];
      try { made = await packingBoxes.closeOpenBoxes(pool, plan, userOf(req)); } catch (e) { console.warn('[Packing] close boxes failed:', e.message); }
      await pool.query(
        `UPDATE assembly_plans SET status = 'DONE', finished_at = LOCALTIMESTAMP, finished_by = $2, updated_at = NOW() WHERE id = $1`,
        [plan.id, userOf(req)]);
      res.json({ ok: true, boxes_made: made.length });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- Wrong-barcode unlock ---------------- */

  const attempts = new Map(); // station -> [timestamps of failed tries]
  app.post('/api/packing/unlock', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const station = clean(req.body && req.body.station, 80);
      const pin = String((req.body && req.body.pin) || '').trim();
      if (!station) return res.status(400).json({ ok: false, error: 'Station missing.' });
      const now = Date.now();
      const tries = (attempts.get(station) || []).filter(t => now - t < 60e3);
      if (tries.length >= 5) return res.status(429).json({ ok: false, error: 'Too many wrong PINs. Wait one minute.' });
      const fid = serverFactoryId() || readFactory(req);
      const lock = await openLockFor(pool, station, serverFactoryId());
      if (!lock) return res.json({ ok: true, already: true });
      const pins = await pool.query(
        'SELECT * FROM packing_supervisor_pins WHERE is_active AND factory_id IS NOT DISTINCT FROM $1', [fid]);
      const who = PIN_RE.test(pin) ? pins.rows.find(p => pinMatches(pin, p)) : null;
      if (!who) {
        tries.push(now); attempts.set(station, tries);
        return res.status(403).json({ ok: false, error: 'Wrong PIN.' });
      }
      attempts.delete(station);
      const by = who.display_name ? `${who.display_name} (${who.username})` : who.username;
      await pool.query(
        `UPDATE packing_lock_events SET unlocked_at = NOW(), unlocked_by = $3, updated_at = NOW()
          WHERE table_id = $1 AND unlocked_at IS NULL AND factory_id IS NOT DISTINCT FROM $2`,
        [station, serverFactoryId(), by]);
      res.json({ ok: true, unlocked_by: by });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- Supervisor PINs (MAIN only) ---------------- */

  function requirePinWriter(req, res) {
    if (isLocalServer()) {
      res.status(403).json({ ok: false, error: 'Supervisor PINs are set on the MAIN server. This factory server receives them via sync.' });
      return null;
    }
    if (!req.auth) { res.status(401).json({ ok: false, error: 'Please log in again.' }); return null; }
    if (!canEditMasters(req.auth)) { res.status(403).json({ ok: false, error: 'Masters edit permission required.' }); return null; }
    const factoryId = readFactory(req);
    if (!factoryId) { res.status(400).json({ ok: false, error: 'Select one factory first. PINs are kept per factory.' }); return null; }
    return { user: userOf(req) || 'system', factoryId };
  }

  app.get('/api/packing/pins', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const r = await pool.query(
        `SELECT id, factory_id, username, display_name, is_active, updated_by,
                to_char(updated_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS updated
           FROM packing_supervisor_pins
          WHERE is_active AND ($1::int IS NULL OR factory_id = $1)
          ORDER BY LOWER(username)`, [fid]);
      res.json({ ok: true, data: r.rows, can_edit: !isLocalServer() && canEditMasters(req.auth) });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/pins', async (req, res) => {
    try {
      const w = requirePinWriter(req, res); if (!w) return;
      await ensureTables();
      const username = clean(req.body && req.body.username, 60);
      const displayName = clean(req.body && req.body.display_name, 80);
      const pin = String((req.body && req.body.pin) || '').trim();
      if (!username) return res.status(400).json({ ok: false, error: 'Enter the supervisor\'s user name.' });
      if (!PIN_RE.test(pin)) return res.status(400).json({ ok: false, error: 'PIN must be 4 to 6 digits.' });
      const others = await pool.query(
        'SELECT * FROM packing_supervisor_pins WHERE is_active AND factory_id = $1 AND LOWER(username) <> LOWER($2)', [w.factoryId, username]);
      if (others.rows.some(p => pinMatches(pin, p))) {
        return res.status(409).json({ ok: false, error: 'Another supervisor already uses this PIN. Choose a different one.' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const r = await pool.query(
        `INSERT INTO packing_supervisor_pins (factory_id, username, display_name, pin_salt, pin_hash, is_active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6)
         ON CONFLICT (COALESCE(factory_id, 0), LOWER(username))
         DO UPDATE SET display_name = EXCLUDED.display_name, pin_salt = EXCLUDED.pin_salt, pin_hash = EXCLUDED.pin_hash,
                       is_active = TRUE, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING id, username, display_name`,
        [w.factoryId, username, displayName, salt, hashPin(pin, salt), w.user]);
      res.json({ ok: true, data: r.rows[0] });
    } catch (err) { sendServerError(res, err); }
  });

  app.delete('/api/packing/pins/:id', async (req, res) => {
    try {
      const w = requirePinWriter(req, res); if (!w) return;
      await ensureTables();
      const r = await pool.query(
        `UPDATE packing_supervisor_pins SET is_active = FALSE, updated_by = $3, updated_at = NOW()
          WHERE id = $1 AND factory_id = $2 RETURNING id`, [parseInt(req.params.id, 10), w.factoryId, w.user]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'PIN not found in this factory.' });
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = {
  registerPackingFloorRoutes,
  ensurePackingFloorSchema,
  lockStationForWrongScan,
  openLockFor,
  pinsEnabled,
  hashPin,
  pinMatches,
  serverFactoryId
};
