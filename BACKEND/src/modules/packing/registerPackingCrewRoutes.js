'use strict';

/**
 * Packing crew (step 10): the packers list and who works on which station today.
 *
 *  - GET  /api/packing/workers[?all=1]          packers of the factory (Packing Masters)
 *  - POST /api/packing/workers                  { id?, name, badge_no, contractor, is_active } MAIN only, masters edit right
 *  - POST /api/packing/workers/import           Excel / CSV (Name, Badge No, Contractor) MAIN only, masters edit right
 *  - GET  /api/packing/crew                     today's crew per station, today's moves, packers not on a station
 *  - POST /api/packing/crew/assign              { worker_id, station, at? 'HH:MM' } put a packer on a station
 *                                               (moves them off another station at the same time)
 *  - POST /api/packing/crew/remove              { worker_id, at? } take a packer off their station
 *  - POST /api/packing/crew/copy-yesterday      put yesterday's crew back on the stations they ended on
 *
 * packing_workers is written on MAIN only and flows to the LOCALs (id key), like the other
 * packing masters. packing_crew rows are written where the supervisor works (usually the
 * factory LOCAL) and replicate up by sync_id. A packer has at most one open row; an open row
 * from an earlier day counts until 17:00 of that day only (packingCrew.effectiveEnd).
 */

const multer = require('multer');
const XLSX = require('xlsx');
const { getFactoryId, getRequestUsername, normalizeFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const { ensurePackingSchema, canEditMasters } = require('./registerPackingMasterRoutes');
const crewMath = require('./packingCrew');

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';
const serverFactoryId = () => (isLocalServer() ? normalizeFactoryId(process.env.LOCAL_FACTORY_ID) : null);
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const MAX_IMPORT_ROWS = 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

async function ensureCrewSchema(pool) {
  await ensurePackingSchema(pool);
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_crew_schema'));
    CREATE TABLE IF NOT EXISTS packing_workers (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      name TEXT NOT NULL,
      badge_no TEXT NOT NULL DEFAULT '',
      contractor TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ix_packing_workers_factory ON packing_workers (factory_id, is_active);
    CREATE INDEX IF NOT EXISTS ix_packing_workers_updated ON packing_workers (updated_at);
    CREATE TABLE IF NOT EXISTS packing_crew (
      id SERIAL PRIMARY KEY,
      sync_id UUID NOT NULL DEFAULT gen_random_uuid(),
      factory_id INTEGER,
      worker_id INTEGER NOT NULL,
      worker_name TEXT NOT NULL DEFAULT '',
      station_name TEXT NOT NULL,
      work_date DATE NOT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ,
      created_by TEXT,
      ended_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_crew ON packing_crew (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_crew_day ON packing_crew (factory_id, work_date);
    CREATE INDEX IF NOT EXISTS ix_packing_crew_open ON packing_crew (worker_id) WHERE end_at IS NULL;
    CREATE INDEX IF NOT EXISTS ix_packing_crew_updated ON packing_crew (updated_at);
  `);
}

const CREW_COLS = `c.id, c.worker_id, c.worker_name, c.station_name, to_char(c.work_date, 'YYYY-MM-DD') AS work_date,
  to_char(c.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_at,
  to_char(c.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_at, c.created_by, c.ended_by`;

/* Crew rows of the factory whose span touches [fromMs, toMs). */
async function crewRows(db, fid, fromMs, toMs) {
  const r = await db.query(`
    SELECT ${CREW_COLS}, COALESCE(w.badge_no, '') AS badge_no, COALESCE(w.contractor, '') AS contractor
      FROM packing_crew c LEFT JOIN packing_workers w ON w.id = c.worker_id
     WHERE ($1::int IS NULL OR c.factory_id = $1)
       AND c.start_at < $3::timestamptz AND (c.end_at IS NULL OR c.end_at > $2::timestamptz)
       AND c.work_date >= ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date - 1
     ORDER BY c.start_at`, [fid, new Date(fromMs).toISOString(), new Date(toMs).toISOString()]);
  return r.rows.map(x => ({ ...x, start_ms: Date.parse(x.start_at), end_ms: x.end_at ? Date.parse(x.end_at) : null, station: x.station_name }));
}

/* Packers on each station right now (today's open rows), keyed by lower-case station name. */
async function crewNow(db, fid, nowMs = Date.now()) {
  try {
    const t = await db.query(`SELECT to_regclass('public.packing_crew') AS t`);
    if (!t.rows[0] || !t.rows[0].t) return new Map();
    const r = await db.query(`
      SELECT LOWER(station_name) AS k, COUNT(*)::int AS n, array_agg(worker_name ORDER BY worker_name) AS names
        FROM packing_crew
       WHERE end_at IS NULL AND work_date = $2::date AND ($1::int IS NULL OR factory_id = $1)
       GROUP BY 1`, [fid, crewMath.istDate(nowMs)]);
    return new Map(r.rows.map(x => [x.k, { n: x.n, names: x.names || [] }]));
  } catch (_) { return new Map(); }
}

/* Close a packer's open rows at `atMs` (rows from earlier days close at 17:00 of their day). */
async function closeOpen(db, workerId, atMs, user) {
  const open = await db.query(`SELECT id, start_at FROM packing_crew WHERE worker_id = $1 AND end_at IS NULL FOR UPDATE`, [workerId]);
  for (const o of open.rows) {
    const start = new Date(o.start_at).getTime();
    const sameDay = crewMath.istDate(start) === crewMath.istDate(atMs);
    const end = Math.max(start, sameDay ? atMs : crewMath.shiftEnd(start));
    await db.query(`UPDATE packing_crew SET end_at = $2, ended_by = $3, updated_at = NOW() WHERE id = $1`, [o.id, new Date(end).toISOString(), user]);
  }
  return open.rows.length;
}

/* One sheet row -> { name, badge_no, contractor } (header names are matched loosely). */
function readWorkerSheet(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(h => clean(h, 60).toLowerCase().replace(/[^a-z]/g, ''));
  const col = (names) => head.findIndex(h => names.includes(h));
  const iName = col(['name', 'packer', 'packername', 'worker', 'workername', 'employeename', 'fullname']);
  const iBadge = col(['badge', 'badgeno', 'badgenumber', 'code', 'empcode', 'employeecode', 'tokenno', 'token', 'cardno']);
  const iCon = col(['contractor', 'agency', 'contractorname', 'vendor']);
  if (iName < 0) return null;
  const out = [];
  for (const r of rows.slice(1, MAX_IMPORT_ROWS + 1)) {
    const name = clean(r[iName], 80);
    if (!name) continue;
    out.push({ name, badge_no: iBadge >= 0 ? clean(r[iBadge], 30) : '', contractor: iCon >= 0 ? clean(r[iCon], 80) : '' });
  }
  return out;
}

/* Insert or update one packer: matched by badge no, else by name. */
async function saveWorker(db, fid, w, user) {
  const found = await db.query(`
    SELECT id FROM packing_workers
     WHERE factory_id = $1 AND (($2 <> '' AND LOWER(badge_no) = LOWER($2)) OR ($2 = '' AND badge_no = '' AND LOWER(name) = LOWER($3)))
     ORDER BY id LIMIT 1`, [fid, w.badge_no, w.name]);
  if (found.rows.length) {
    await db.query(`UPDATE packing_workers SET name = $2, badge_no = $3, contractor = $4, is_active = TRUE, updated_by = $5, updated_at = NOW() WHERE id = $1`,
      [found.rows[0].id, w.name, w.badge_no, w.contractor, user]);
    return { id: found.rows[0].id, added: false };
  }
  const r = await db.query(`INSERT INTO packing_workers (factory_id, name, badge_no, contractor, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [fid, w.name, w.badge_no, w.contractor, user]);
  return { id: r.rows[0].id, added: true };
}

function registerPackingCrewRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureCrewSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing crew] schema ensure failed:', err.message));

  const readFactory = (req) => serverFactoryId() || normalizeFactoryId(getFactoryId(req));
  const userOf = (req) => (req.auth && req.auth.username) || getRequestUsername(req) || 'system';
  function requireUser(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }
  function masterWriter(req, res) {
    if (isLocalServer()) { res.status(403).json({ ok: false, error: 'The packers list can only be changed on the MAIN server.' }); return null; }
    if (!req.auth) { res.status(401).json({ ok: false, error: 'Please log in again.' }); return null; }
    if (!canEditMasters(req.auth)) { res.status(403).json({ ok: false, error: 'Masters edit permission required.' }); return null; }
    const fid = readFactory(req);
    if (!fid) { res.status(400).json({ ok: false, error: 'Select one factory first.' }); return null; }
    return { fid, user: userOf(req) };
  }
  function crewWriter(req, res) {
    if (!requireUser(req, res)) return null;
    const fid = readFactory(req);
    if (!fid) { res.status(400).json({ ok: false, error: 'Select one factory first.' }); return null; }
    return { fid, user: userOf(req) };
  }
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
  const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

  /* ---------------- packers list ---------------- */

  app.get('/api/packing/workers', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const all = req.query.all === '1';
      const r = await pool.query(`
        SELECT id, factory_id, name, badge_no, contractor, is_active, updated_by,
               to_char(updated_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS updated
          FROM packing_workers
         WHERE ($1::int IS NULL OR factory_id = $1) AND ($2::boolean OR is_active)
         ORDER BY is_active DESC, LOWER(name)`, [fid, all]);
      res.json({ ok: true, data: r.rows, can_edit: !isLocalServer() && canEditMasters(req.auth) });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/workers', async (req, res) => {
    try {
      const w = masterWriter(req, res); if (!w) return;
      await ensureTables();
      const b = req.body || {};
      const name = clean(b.name, 80);
      const badge = clean(b.badge_no, 30);
      const contractor = clean(b.contractor, 80);
      if (!name) return bad(res, 'Enter the packer\'s name.');
      const id = parseInt(b.id, 10);
      if (badge) {
        const dup = await pool.query(`SELECT name FROM packing_workers WHERE factory_id = $1 AND LOWER(badge_no) = LOWER($2) AND id <> $3 AND is_active LIMIT 1`,
          [w.fid, badge, Number.isNaN(id) ? 0 : id]);
        if (dup.rows.length) return bad(res, `Badge ${badge} is already given to ${dup.rows[0].name}.`, 409);
      }
      if (!Number.isNaN(id) && id > 0) {
        const r = await pool.query(`
          UPDATE packing_workers SET name = $3, badge_no = $4, contractor = $5, is_active = $6, updated_by = $7, updated_at = NOW()
           WHERE id = $1 AND factory_id = $2 RETURNING *`, [id, w.fid, name, badge, contractor, b.is_active !== false, w.user]);
        if (!r.rows.length) return bad(res, 'Packer not found in this factory.', 404);
        return res.json({ ok: true, data: r.rows[0] });
      }
      const r = await pool.query(`INSERT INTO packing_workers (factory_id, name, badge_no, contractor, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [w.fid, name, badge, contractor, w.user]);
      res.json({ ok: true, data: r.rows[0] });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/workers/import', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB.' : 'Could not read the upload.');
      next();
    });
  }, async (req, res) => {
    try {
      const w = masterWriter(req, res); if (!w) return;
      if (!req.file) return bad(res, 'Choose an Excel or CSV file.');
      await ensureTables();
      let rows;
      try {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      } catch (_) { return bad(res, 'That file is not a readable Excel or CSV file.'); }
      const list = readWorkerSheet(rows);
      if (list === null) return bad(res, 'No "Name" column found. Use columns Name, Badge No, Contractor.');
      if (!list.length) return bad(res, 'The file has no packer names.');
      const out = await inTx(async (db) => {
        let added = 0, updated = 0;
        for (const x of list) { const r = await saveWorker(db, w.fid, x, w.user); if (r.added) added++; else updated++; }
        return { added, updated };
      });
      res.json({ ok: true, data: { ...out, rows: list.length } });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- today's crew ---------------- */

  app.get('/api/packing/crew', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const now = Date.now();
      const dayStart = crewMath.istDayStart(now);
      const rows = await crewRows(pool, fid, dayStart, dayStart + 86400e3);
      const today = rows.filter(r => r.work_date === crewMath.istDate(now));
      const workers = (await pool.query(
        `SELECT id, name, badge_no, contractor FROM packing_workers WHERE is_active AND ($1::int IS NULL OR factory_id = $1) ORDER BY LOWER(name)`, [fid])).rows;
      const onNow = new Map(today.filter(r => !r.end_at).map(r => [r.worker_id, r]));
      const stations = {};
      for (const r of onNow.values()) {
        const k = r.station_name;
        (stations[k] = stations[k] || []).push({ worker_id: r.worker_id, name: r.worker_name, since: r.start_at, badge_no: r.badge_no });
      }
      const worked = new Set(today.map(r => r.worker_id));
      const yesterday = await pool.query(`
        SELECT COUNT(DISTINCT worker_id)::int AS n, to_char(MAX(work_date), 'YYYY-MM-DD') AS d FROM packing_crew
         WHERE ($1::int IS NULL OR factory_id = $1) AND work_date = (
           SELECT MAX(work_date) FROM packing_crew WHERE ($1::int IS NULL OR factory_id = $1) AND work_date < $2::date)`, [fid, crewMath.istDate(now)]);
      res.json({
        ok: true,
        data: {
          date: crewMath.istDate(now),
          stations,
          moves: today.map(r => ({ worker_id: r.worker_id, name: r.worker_name, station: r.station_name, start_at: r.start_at, end_at: r.end_at, by: r.created_by })),
          free: workers.filter(x => !onNow.has(x.id)).map(x => ({ ...x, worked_today: worked.has(x.id) })),
          workers: workers.length,
          last_day: yesterday.rows[0] && yesterday.rows[0].d ? { date: yesterday.rows[0].d, packers: yesterday.rows[0].n } : null
        }
      });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/crew/assign', async (req, res) => {
    try {
      const w = crewWriter(req, res); if (!w) return;
      await ensureTables();
      const b = req.body || {};
      const workerId = parseInt(b.worker_id, 10);
      const station = clean(b.station, 120);
      if (!workerId || !station) return bad(res, 'Pick a packer and a station.');
      const now = Date.now();
      const at = b.at ? crewMath.todayAt(b.at, now) : now;
      if (at === null) return bad(res, 'Enter a time today, not later than now (HH:MM).');
      const worker = await pool.query(`SELECT id, name FROM packing_workers WHERE id = $1 AND factory_id = $2 AND is_active`, [workerId, w.fid]);
      if (!worker.rows.length) return bad(res, 'Packer not found in this factory.', 404);
      const st = await pool.query(`SELECT name FROM packing_stations WHERE is_active AND factory_id = $1 AND LOWER(name) = LOWER($2)`, [w.fid, station]);
      if (!st.rows.length) return bad(res, 'Station not found.', 404);
      const stationName = st.rows[0].name;
      const out = await inTx(async (db) => {
        const open = await db.query(`SELECT id, station_name, start_at, work_date FROM packing_crew WHERE worker_id = $1 AND end_at IS NULL FOR UPDATE`, [workerId]);
        const todayOpen = open.rows.find(o => crewMath.istDate(new Date(o.start_at).getTime()) === crewMath.istDate(now));
        if (todayOpen && todayOpen.station_name.toLowerCase() === stationName.toLowerCase()) return { already: true };
        if (todayOpen && new Date(todayOpen.start_at).getTime() > at) {
          const e = new Error(`${worker.rows[0].name} started on ${todayOpen.station_name} after that time.`); e.status = 400; throw e;
        }
        await closeOpen(db, workerId, at, w.user);
        await db.query(`
          INSERT INTO packing_crew (factory_id, worker_id, worker_name, station_name, work_date, start_at, created_by)
          VALUES ($1, $2, $3, $4, $5::date, $6, $7)`,
          [w.fid, workerId, worker.rows[0].name, stationName, crewMath.istDate(at), new Date(at).toISOString(), w.user]);
        return { moved_from: todayOpen ? todayOpen.station_name : null };
      });
      res.json({ ok: true, data: out });
    } catch (err) {
      if (err && err.status) return bad(res, err.message, err.status);
      sendServerError(res, err);
    }
  });

  app.post('/api/packing/crew/remove', async (req, res) => {
    try {
      const w = crewWriter(req, res); if (!w) return;
      await ensureTables();
      const b = req.body || {};
      const workerId = parseInt(b.worker_id, 10);
      if (!workerId) return bad(res, 'Pick a packer.');
      const now = Date.now();
      const at = b.at ? crewMath.todayAt(b.at, now) : now;
      if (at === null) return bad(res, 'Enter a time today, not later than now (HH:MM).');
      const n = await inTx(async (db) => {
        const open = await db.query(`SELECT start_at FROM packing_crew WHERE worker_id = $1 AND end_at IS NULL AND factory_id = $2`, [workerId, w.fid]);
        if (open.rows.some(o => new Date(o.start_at).getTime() > at && crewMath.istDate(new Date(o.start_at).getTime()) === crewMath.istDate(now))) {
          const e = new Error('That time is before the packer started on the station.'); e.status = 400; throw e;
        }
        return closeOpen(db, workerId, at, w.user);
      });
      res.json({ ok: true, data: { closed: n } });
    } catch (err) {
      if (err && err.status) return bad(res, err.message, err.status);
      sendServerError(res, err);
    }
  });

  /* Put the last working day's crew back on the stations they ended that day on. */
  app.post('/api/packing/crew/copy-yesterday', async (req, res) => {
    try {
      const w = crewWriter(req, res); if (!w) return;
      await ensureTables();
      const now = Date.now();
      const today = crewMath.istDate(now);
      const out = await inTx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing_crew_copy_${w.fid}_${today}`]);
        const last = await db.query(`
          SELECT DISTINCT ON (c.worker_id) c.worker_id, c.worker_name, c.station_name
            FROM packing_crew c
            JOIN packing_workers wk ON wk.id = c.worker_id AND wk.is_active
            JOIN packing_stations st ON st.factory_id = c.factory_id AND LOWER(st.name) = LOWER(c.station_name) AND st.is_active
           WHERE c.factory_id = $1 AND c.work_date = (SELECT MAX(work_date) FROM packing_crew WHERE factory_id = $1 AND work_date < $2::date)
           ORDER BY c.worker_id, c.start_at DESC`, [w.fid, today]);
        const busy = new Set((await db.query(
          `SELECT DISTINCT worker_id FROM packing_crew WHERE factory_id = $1 AND work_date = $2::date`, [w.fid, today])).rows.map(r => r.worker_id));
        let added = 0;
        for (const r of last.rows) {
          if (busy.has(r.worker_id)) continue;
          await closeOpen(db, r.worker_id, now, w.user);
          await db.query(`
            INSERT INTO packing_crew (factory_id, worker_id, worker_name, station_name, work_date, start_at, created_by)
            VALUES ($1, $2, $3, $4, $5::date, $6, $7)`, [w.fid, r.worker_id, r.worker_name, r.station_name, today, new Date(now).toISOString(), w.user]);
          added++;
        }
        return { added, skipped: last.rows.length - added };
      });
      res.json({ ok: true, data: out });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = { serverFactoryId, registerPackingCrewRoutes, ensureCrewSchema, crewRows, crewNow, readWorkerSheet, closeOpen };
