'use strict';

/**
 * Packing Masters - PUBLIC/packing_masters.html.
 *
 * Two masters, kept per factory:
 *  - packing_stations: the packing / assembly stations (Assembly Station - A, B1, ...).
 *  - packing_item_standards: one row per item + party group + station with the
 *    station's cycle time (SECONDS PER PIECE for the whole station, confirmed by the
 *    owner), the persons it needs, and the packing details the plan will use later
 *    (EAN, pcs per box, boxes per carton, carton type).
 *
 * Rows can be typed in or imported from the ERP "StoreMachineOutPut" Excel
 * (ItemCode, ItemName, Store, CycleTime, Persons, PartyGroup). The import is
 * always previewed first; commit applies the same analysis. Rows in the file
 * without a station are kept as "missing" so the gaps can be filled here. The
 * import never touches EAN / box / carton fields, and never changes a row a
 * person has edited here (source = 'edited'): those are reported as kept.
 *
 * Both tables are edited on MAIN only (a LOCAL refuses writes and receives the
 * rows through sync, like shifting_locations), so MAIN mints every serial id.
 */

const multer = require('multer');
const XLSX = require('xlsx');
const { getFactoryId, getRequestUsername, normalizeFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });

/* Values outside these ranges are imported but marked "Check". */
const PERSONS_CHECK_MAX = 40;
const CYCLE_CHECK_MAX_SEC = 100;

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';

function clean(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Item codes match JMS orders after leading zeros are dropped ('0121' = '121'). */
function itemKey(code) {
  const c = clean(code, 60).toUpperCase();
  const stripped = c.replace(/^0+(?=.)/, '');
  return stripped;
}

function toNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function toInt(value) {
  const n = toNumber(value);
  if (n === null) return null;
  return Number.isInteger(n) ? n : NaN;
}

/* "Assembly Station - B1" -> "B1"; anything else keeps its own name. */
function stationCode(name) {
  const m = /station\s*-\s*(.+)$/i.exec(clean(name));
  return m ? m[1].trim() : clean(name, 40);
}

function pcsPerHour(cycle) {
  const c = Number(cycle);
  return c > 0 ? Math.round(3600 / c) : null;
}

const HEADER_ALIASES = {
  item_code: ['itemcode', 'item code', 'code'],
  item_name: ['itemname', 'item name', 'item', 'name'],
  station: ['store', 'station', 'packing station', 'assembly station'],
  cycle: ['cycletime', 'cycle time', 'cycle', 'cycle time (sec)'],
  persons: ['persons', 'person', 'manpower'],
  party: ['partygroup', 'party group', 'party', 'client']
};

/* Map the sheet's header row to our fields. Returns { map, missing }. */
function mapHeaders(headerRow) {
  const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z ()]/g, '').replace(/\s+/g, ' ').trim();
  const map = {};
  headerRow.forEach((h, i) => {
    const n = norm(h);
    const squashed = n.replace(/ /g, '');
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.some(a => a === n || a.replace(/ /g, '') === squashed)) { map[field] = i; break; }
    }
  });
  const missing = ['item_code', 'item_name', 'station', 'cycle', 'persons', 'party'].filter(f => map[f] === undefined);
  return { map, missing };
}

/**
 * Read the import rows (array of arrays, first row = headers) into clean records.
 * Pure: no DB. Returns { records, skipped, warnings, stations, missingHeaders }.
 *  - records: { item_code, item_key, item_name, party_group, station_name,
 *               cycle_time_sec, persons, check_note, row }
 *  - skipped: [{ row, reason }] rows that cannot be imported
 */
function analyseImportRows(rows) {
  const out = { records: [], skipped: [], warnings: [], stations: [], missingHeaders: [] };
  if (!Array.isArray(rows) || !rows.length) { out.missingHeaders = Object.keys(HEADER_ALIASES); return out; }
  const { map, missing } = mapHeaders(rows[0] || []);
  if (missing.length) { out.missingHeaders = missing; return out; }

  const byKey = new Map();
  const namesByItem = new Map();
  const stationNames = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const rowNo = i + 1;
    const code = clean(r[map.item_code], 60);
    const name = clean(r[map.item_name], 200);
    const party = clean(r[map.party], 120);
    const station = clean(r[map.station], 80);
    const cycle = toNumber(r[map.cycle]);
    const persons = toInt(r[map.persons]);
    if (!code && !name && !station && !party) continue; // blank line
    if (!code) { out.skipped.push({ row: rowNo, reason: 'No item code' }); continue; }

    const notes = [];
    if (station) {
      if (cycle === null || Number.isNaN(cycle) || cycle <= 0) {
        out.skipped.push({ row: rowNo, item_code: code, reason: 'Station given but cycle time is missing or not a number' });
        continue;
      }
      if (persons === null || Number.isNaN(persons) || persons < 0) {
        out.skipped.push({ row: rowNo, item_code: code, reason: 'Station given but persons is missing or not a whole number' });
        continue;
      }
      if (persons === 0) notes.push('Persons is 0');
      if (persons > PERSONS_CHECK_MAX) notes.push(`Persons ${persons} looks too high`);
      if (cycle > CYCLE_CHECK_MAX_SEC) notes.push(`Cycle ${cycle} s is very slow`);
      if (!stationNames.has(station.toLowerCase())) stationNames.set(station.toLowerCase(), station);
    }

    const key = itemKey(code);
    if (!namesByItem.has(key)) namesByItem.set(key, new Set());
    namesByItem.get(key).add(name);

    const rec = {
      item_code: code,
      item_key: key,
      item_name: name,
      party_group: party,
      station_name: station,
      cycle_time_sec: station ? Math.round(cycle * 100) / 100 : null,
      persons: station ? persons : null,
      notes,
      row: rowNo
    };
    const dedupe = `${key}|${party.toLowerCase()}|${station.toLowerCase()}`;
    const prev = byKey.get(dedupe);
    if (prev && (prev.cycle_time_sec !== rec.cycle_time_sec || prev.persons !== rec.persons)) {
      out.warnings.push({ row: rowNo, item_code: code, message: `Repeats row ${prev.row} with different values; the later row is used` });
    }
    byKey.set(dedupe, rec);
  }

  /* An item + party with a station drops its blank-station line. */
  const stationed = new Set();
  for (const rec of byKey.values()) if (rec.station_name) stationed.add(`${rec.item_key}|${rec.party_group.toLowerCase()}`);
  for (const [k, rec] of byKey) {
    if (!rec.station_name && stationed.has(`${rec.item_key}|${rec.party_group.toLowerCase()}`)) byKey.delete(k);
  }

  for (const rec of byKey.values()) {
    const names = namesByItem.get(rec.item_key);
    if (names && names.size > 1) rec.notes.push('Same code has more than one name');
    rec.check_note = rec.notes.join('; ');
    delete rec.notes;
    out.records.push(rec);
  }
  out.stations = [...stationNames.values()].sort((a, b) => a.localeCompare(b));
  return out;
}

function recordKey(r) {
  return `${r.item_key}|${String(r.party_group || '').toLowerCase()}|${String(r.station_name || '').toLowerCase()}`;
}

function sameValues(existing, rec) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  return clean(existing.item_name) === rec.item_name
    && num(existing.cycle_time_sec) === num(rec.cycle_time_sec)
    && num(existing.persons) === num(rec.persons)
    && String(existing.check_note || '') === rec.check_note
    && existing.is_active !== false;
}

async function ensurePackingSchema(pool) {
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_masters_schema'));
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS packing_stations (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      scanner_config TEXT NOT NULL DEFAULT '',
      persons INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_id UUID DEFAULT gen_random_uuid()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_stations_name ON packing_stations (COALESCE(factory_id, 0), LOWER(name));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_stations ON packing_stations (sync_id);
    CREATE TABLE IF NOT EXISTS packing_item_standards (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      item_code TEXT NOT NULL,
      item_key TEXT NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      party_group TEXT NOT NULL DEFAULT '',
      station_name TEXT NOT NULL DEFAULT '',
      cycle_time_sec NUMERIC(10,2),
      persons INTEGER,
      ean TEXT NOT NULL DEFAULT '',
      pcs_per_box INTEGER,
      boxes_per_carton INTEGER,
      carton_type TEXT NOT NULL DEFAULT '',
      check_note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_id UUID DEFAULT gen_random_uuid()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_item_standards_key
      ON packing_item_standards (COALESCE(factory_id, 0), item_key, LOWER(party_group), LOWER(station_name));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_item_standards ON packing_item_standards (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_item_standards_item ON packing_item_standards (item_key);
    CREATE INDEX IF NOT EXISTS ix_packing_item_standards_updated ON packing_item_standards (updated_at);
    CREATE INDEX IF NOT EXISTS ix_packing_stations_updated ON packing_stations (updated_at);
  `);
}

/* Same rule as the Masters page edit right (userCanEditMasters in the legacy routes). */
function canEditMasters(auth) {
  if (!auth) return false;
  const role = String(auth.role || '').toLowerCase();
  if (role === 'admin' || role === 'superadmin') return true;
  const p = (auth.permissions && typeof auth.permissions === 'object') ? auth.permissions : {};
  if (p.masters_edit !== undefined) return p.masters_edit === true;
  if (p.masters && typeof p.masters === 'object' && p.masters.edit !== undefined) return p.masters.edit === true;
  return ['supervisor', 'manager', 'planner'].includes(role);
}

const STANDARD_FILTERS = {
  all: '',
  ready: `AND s.station_name <> '' AND s.cycle_time_sec > 0 AND s.check_note = ''`,
  missing: `AND s.station_name = ''`,
  check: `AND s.check_note <> ''`,
  no_ean: `AND s.station_name <> '' AND s.ean = ''`
};

function registerPackingMasterRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensurePackingSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing] schema ensure failed:', err.message));

  function requireReader(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }

  /* Writers: MAIN only, masters edit right, one factory selected. Returns { user, factoryId } or null. */
  function requireWriter(req, res) {
    if (isLocalServer()) {
      res.status(403).json({ ok: false, error: 'Packing masters can only be changed on the MAIN server. This factory server receives them automatically via sync.' });
      return null;
    }
    if (!req.auth) { res.status(401).json({ ok: false, error: 'Please log in again to use this feature.' }); return null; }
    if (!canEditMasters(req.auth)) { res.status(403).json({ ok: false, error: 'Masters edit permission required.' }); return null; }
    const factoryId = normalizeFactoryId(getFactoryId(req));
    if (!factoryId) { res.status(400).json({ ok: false, error: 'Select one factory first. Packing masters are kept per factory.' }); return null; }
    return { user: req.auth.username || getRequestUsername(req) || 'system', factoryId };
  }

  const readFactory = (req) => normalizeFactoryId(getFactoryId(req));

  app.get('/api/packing/meta', async (req, res) => {
    if (!requireReader(req, res)) return;
    res.json({
      ok: true,
      can_edit: !isLocalServer() && canEditMasters(req.auth),
      is_local: isLocalServer(),
      factory_id: readFactory(req)
    });
  });

  /* ---------------- Stations ---------------- */

  app.get('/api/packing/stations', async (req, res) => {
    try {
      if (!requireReader(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      const r = await pool.query(`
        SELECT st.*,
               COALESCE(c.items, 0)::int AS items,
               COALESCE(c.rows, 0)::int AS rows,
               c.avg_cycle, c.min_persons, c.max_persons
          FROM packing_stations st
          LEFT JOIN (
            SELECT COALESCE(factory_id, 0) AS fid, LOWER(station_name) AS sn,
                   COUNT(DISTINCT item_key) AS items, COUNT(*) AS rows,
                   ROUND(AVG(cycle_time_sec), 2) AS avg_cycle,
                   MIN(persons) AS min_persons, MAX(persons) AS max_persons
              FROM packing_item_standards
             WHERE is_active AND station_name <> ''
             GROUP BY 1, 2
          ) c ON c.fid = COALESCE(st.factory_id, 0) AND c.sn = LOWER(st.name)
         WHERE ($1::int IS NULL OR st.factory_id = $1)
         ORDER BY st.is_active DESC, st.sort_order, st.name`, [fid]);
      res.json({ ok: true, data: r.rows });
    } catch (err) { sendServerError(res, err); }
  });

  function readStationBody(body) {
    const name = clean(body?.name, 80);
    const persons = body?.persons === '' || body?.persons === undefined || body?.persons === null ? null : toInt(body.persons);
    const sort = body?.sort_order === '' || body?.sort_order === undefined ? null : toInt(body.sort_order);
    return {
      name,
      code: clean(body?.code, 40) || stationCode(name),
      scanner_config: clean(body?.scanner_config, 120),
      persons,
      sort_order: sort,
      is_active: body?.is_active === undefined ? undefined : body.is_active !== false && body.is_active !== 'false'
    };
  }

  app.post('/api/packing/stations', async (req, res) => {
    try {
      const w = requireWriter(req, res); if (!w) return;
      await ensureTables();
      const s = readStationBody(req.body);
      if (!s.name) return res.status(400).json({ ok: false, error: 'Enter a station name.' });
      if (Number.isNaN(s.persons) || (s.persons !== null && s.persons < 0)) return res.status(400).json({ ok: false, error: 'Persons must be a whole number.' });
      const clash = await pool.query('SELECT id FROM packing_stations WHERE COALESCE(factory_id, 0) = $1 AND LOWER(name) = LOWER($2)', [w.factoryId, s.name]);
      if (clash.rows.length) return res.status(409).json({ ok: false, error: `"${s.name}" already exists.` });
      let sort = s.sort_order;
      if (sort === null || Number.isNaN(sort)) {
        const m = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM packing_stations WHERE factory_id = $1', [w.factoryId]);
        sort = Number(m.rows[0].m || 0) + 10;
      }
      const r = await pool.query(
        `INSERT INTO packing_stations (factory_id, name, code, scanner_config, persons, sort_order, is_active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
        [w.factoryId, s.name, s.code, s.scanner_config, s.persons, sort, s.is_active !== false, w.user]);
      res.json({ ok: true, data: r.rows[0] });
    } catch (err) { sendServerError(res, err); }
  });

  app.put('/api/packing/stations/:id', async (req, res) => {
    try {
      const w = requireWriter(req, res); if (!w) return;
      await ensureTables();
      const id = toInt(req.params.id);
      if (!id || Number.isNaN(id)) return res.status(400).json({ ok: false, error: 'Bad station id.' });
      const cur = await pool.query('SELECT * FROM packing_stations WHERE id = $1 AND factory_id = $2', [id, w.factoryId]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Station not found in this factory.' });
      const old = cur.rows[0];
      const body = { ...req.body };
      /* a rename without a new short code takes the code from the new name */
      if (body.code === undefined && body.name !== undefined && clean(body.name, 80) !== old.name) body.code = '';
      const s = readStationBody({ ...old, ...body });
      if (!s.name) return res.status(400).json({ ok: false, error: 'Enter a station name.' });
      if (Number.isNaN(s.persons) || (s.persons !== null && s.persons < 0)) return res.status(400).json({ ok: false, error: 'Persons must be a whole number.' });
      if (s.name.toLowerCase() !== String(old.name).toLowerCase()) {
        const clash = await pool.query('SELECT id FROM packing_stations WHERE COALESCE(factory_id, 0) = $1 AND LOWER(name) = LOWER($2) AND id <> $3', [w.factoryId, s.name, id]);
        if (clash.rows.length) return res.status(409).json({ ok: false, error: `"${s.name}" already exists.` });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          `UPDATE packing_stations SET name = $1, code = $2, scanner_config = $3, persons = $4,
                  sort_order = COALESCE($5, sort_order), is_active = COALESCE($6, is_active),
                  updated_by = $7, updated_at = NOW()
            WHERE id = $8 RETURNING *`,
          [s.name, s.code, s.scanner_config, s.persons, Number.isNaN(s.sort_order) ? null : s.sort_order,
            s.is_active === undefined ? null : s.is_active, w.user, id]);
        /* a rename carries the item standards along */
        if (s.name !== old.name) {
          await client.query(
            `UPDATE packing_item_standards SET station_name = $1, updated_by = $2, updated_at = NOW()
              WHERE factory_id = $3 AND LOWER(station_name) = LOWER($4)`,
            [s.name, w.user, w.factoryId, old.name]);
        }
        await client.query('COMMIT');
        res.json({ ok: true, data: r.rows[0] });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- Item packing standards ---------------- */

  function standardsWhere(req) {
    const fid = readFactory(req);
    const q = clean(req.query.q, 100);
    const station = clean(req.query.station, 80);
    const filter = Object.prototype.hasOwnProperty.call(STANDARD_FILTERS, req.query.filter) ? req.query.filter : 'all';
    const params = [fid];
    let sql = `WHERE ($1::int IS NULL OR s.factory_id = $1) AND s.is_active`;
    if (q) {
      params.push(`%${q.toLowerCase()}%`, itemKey(q));
      sql += ` AND (LOWER(s.item_name) LIKE $${params.length - 1} OR LOWER(s.item_code) LIKE $${params.length - 1}
                    OR s.item_key = $${params.length} OR LOWER(s.party_group) LIKE $${params.length - 1} OR s.ean LIKE $${params.length - 1})`;
    }
    if (station === '__none__') sql += ` AND s.station_name = ''`;
    else if (station) { params.push(station.toLowerCase()); sql += ` AND LOWER(s.station_name) = $${params.length}`; }
    sql += ` ${STANDARD_FILTERS[filter]}`;
    return { sql, params, fid };
  }

  app.get('/api/packing/standards', async (req, res) => {
    try {
      if (!requireReader(req, res)) return;
      await ensureTables();
      const { sql, params, fid } = standardsWhere(req);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const [rows, count, summary] = await Promise.all([
        pool.query(
          `SELECT s.* FROM packing_item_standards s ${sql}
            ORDER BY (s.station_name = '') , LPAD(s.item_key, 12, '0'), s.party_group, s.station_name
            LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
        pool.query(`SELECT COUNT(*)::int AS n FROM packing_item_standards s ${sql}`, params),
        pool.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(DISTINCT item_key)::int AS items,
                  COUNT(*) FILTER (WHERE station_name <> '' AND cycle_time_sec > 0 AND check_note = '')::int AS ready,
                  COUNT(*) FILTER (WHERE station_name = '')::int AS missing,
                  COUNT(*) FILTER (WHERE check_note <> '')::int AS "check",
                  COUNT(*) FILTER (WHERE station_name <> '' AND ean = '')::int AS no_ean,
                  MAX(updated_at) AS last_updated
             FROM packing_item_standards s
            WHERE ($1::int IS NULL OR s.factory_id = $1) AND s.is_active`, [fid])
      ]);
      res.json({
        ok: true,
        data: rows.rows.map(r => ({ ...r, pcs_per_hour: pcsPerHour(r.cycle_time_sec) })),
        total: count.rows[0].n,
        page,
        limit,
        summary: summary.rows[0]
      });
    } catch (err) { sendServerError(res, err); }
  });

  function readStandardBody(body, old = {}) {
    const pick = (k) => (body && Object.prototype.hasOwnProperty.call(body, k) ? body[k] : old[k]);
    const optInt = (v) => (v === '' || v === null || v === undefined ? null : toInt(v));
    const cycleRaw = pick('cycle_time_sec');
    const cycle = cycleRaw === '' || cycleRaw === null || cycleRaw === undefined ? null : toNumber(cycleRaw);
    return {
      item_code: clean(pick('item_code'), 60),
      item_name: clean(pick('item_name'), 200),
      party_group: clean(pick('party_group'), 120),
      station_name: clean(pick('station_name'), 80),
      cycle_time_sec: cycle === null || Number.isNaN(cycle) ? cycle : Math.round(cycle * 100) / 100,
      persons: optInt(pick('persons')),
      ean: clean(pick('ean'), 40).replace(/\s/g, ''),
      pcs_per_box: optInt(pick('pcs_per_box')),
      boxes_per_carton: optInt(pick('boxes_per_carton')),
      carton_type: clean(pick('carton_type'), 80)
    };
  }

  function validateStandard(s) {
    if (!s.item_code) return 'Enter the item code.';
    if (s.station_name) {
      if (s.cycle_time_sec === null || Number.isNaN(s.cycle_time_sec) || s.cycle_time_sec <= 0) return 'Enter the cycle time in seconds per piece (more than 0).';
      if (s.persons === null || Number.isNaN(s.persons) || s.persons <= 0) return 'Enter persons as a whole number (1 or more).';
    } else if (Number.isNaN(s.cycle_time_sec) || Number.isNaN(s.persons)) return 'Cycle time and persons must be numbers.';
    for (const k of ['pcs_per_box', 'boxes_per_carton']) {
      if (Number.isNaN(s[k]) || (s[k] !== null && s[k] <= 0)) return `${k === 'pcs_per_box' ? 'Pcs per box' : 'Boxes per carton'} must be a whole number above 0.`;
    }
    if (s.ean && !/^[0-9A-Za-z-]{4,40}$/.test(s.ean)) return 'EAN may only have digits, letters and dashes.';
    return null;
  }

  async function stationExists(factoryId, name) {
    if (!name) return true;
    const r = await pool.query('SELECT 1 FROM packing_stations WHERE factory_id = $1 AND LOWER(name) = LOWER($2) AND is_active', [factoryId, name]);
    return r.rows.length > 0;
  }

  app.post('/api/packing/standards', async (req, res) => {
    try {
      const w = requireWriter(req, res); if (!w) return;
      await ensureTables();
      const s = readStandardBody(req.body);
      const bad = validateStandard(s); if (bad) return res.status(400).json({ ok: false, error: bad });
      if (!await stationExists(w.factoryId, s.station_name)) return res.status(400).json({ ok: false, error: `Station "${s.station_name}" is not in the station master.` });
      const key = itemKey(s.item_code);
      const clash = await pool.query(
        `SELECT id, is_active FROM packing_item_standards
          WHERE COALESCE(factory_id, 0) = $1 AND item_key = $2 AND LOWER(party_group) = LOWER($3) AND LOWER(station_name) = LOWER($4)`,
        [w.factoryId, key, s.party_group, s.station_name]);
      if (clash.rows.length && clash.rows[0].is_active) return res.status(409).json({ ok: false, error: 'This item, party and station already has a row. Edit that row instead.' });
      const vals = [s.item_code, key, s.item_name, s.party_group, s.station_name, s.cycle_time_sec, s.persons, s.ean, s.pcs_per_box, s.boxes_per_carton, s.carton_type, w.user];
      let r;
      if (clash.rows.length) {
        r = await pool.query(
          `UPDATE packing_item_standards SET item_code = $1, item_key = $2, item_name = $3, party_group = $4, station_name = $5,
                  cycle_time_sec = $6, persons = $7, ean = $8, pcs_per_box = $9, boxes_per_carton = $10, carton_type = $11,
                  check_note = '', is_active = TRUE, updated_by = $12, updated_at = NOW()
            WHERE id = $13 RETURNING *`, [...vals, clash.rows[0].id]);
      } else {
        r = await pool.query(
          `INSERT INTO packing_item_standards (item_code, item_key, item_name, party_group, station_name, cycle_time_sec, persons,
                  ean, pcs_per_box, boxes_per_carton, carton_type, created_by, updated_by, factory_id, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, 'manual') RETURNING *`, [...vals, w.factoryId]);
      }
      res.json({ ok: true, data: { ...r.rows[0], pcs_per_hour: pcsPerHour(r.rows[0].cycle_time_sec) } });
    } catch (err) { sendServerError(res, err); }
  });

  app.put('/api/packing/standards/:id', async (req, res) => {
    try {
      const w = requireWriter(req, res); if (!w) return;
      await ensureTables();
      const id = toInt(req.params.id);
      if (!id || Number.isNaN(id)) return res.status(400).json({ ok: false, error: 'Bad row id.' });
      const cur = await pool.query('SELECT * FROM packing_item_standards WHERE id = $1 AND factory_id = $2', [id, w.factoryId]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Row not found in this factory.' });
      const old = cur.rows[0];
      if (req.body && req.body.is_active === false) {
        const r = await pool.query(`UPDATE packing_item_standards SET is_active = FALSE, updated_by = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [w.user, id]);
        return res.json({ ok: true, data: r.rows[0] });
      }
      const s = readStandardBody(req.body, old);
      const bad = validateStandard(s); if (bad) return res.status(400).json({ ok: false, error: bad });
      if (s.station_name.toLowerCase() !== String(old.station_name).toLowerCase() && !await stationExists(w.factoryId, s.station_name)) {
        return res.status(400).json({ ok: false, error: `Station "${s.station_name}" is not in the station master.` });
      }
      const key = itemKey(s.item_code);
      const clash = await pool.query(
        `SELECT id FROM packing_item_standards
          WHERE COALESCE(factory_id, 0) = $1 AND item_key = $2 AND LOWER(party_group) = LOWER($3) AND LOWER(station_name) = LOWER($4) AND id <> $5`,
        [w.factoryId, key, s.party_group, s.station_name, id]);
      if (clash.rows.length) return res.status(409).json({ ok: false, error: 'Another row already has this item, party and station.' });
      /* a saved edit clears the import's "Check" note; values were looked at by a person */
      const r = await pool.query(
        `UPDATE packing_item_standards SET item_code = $1, item_key = $2, item_name = $3, party_group = $4, station_name = $5,
                cycle_time_sec = $6, persons = $7, ean = $8, pcs_per_box = $9, boxes_per_carton = $10, carton_type = $11,
                check_note = '', source = 'edited', updated_by = $12, updated_at = NOW()
          WHERE id = $13 RETURNING *`,
        [s.item_code, key, s.item_name, s.party_group, s.station_name, s.cycle_time_sec, s.persons, s.ean,
          s.pcs_per_box, s.boxes_per_carton, s.carton_type, w.user, id]);
      res.json({ ok: true, data: { ...r.rows[0], pcs_per_hour: pcsPerHour(r.rows[0].cycle_time_sec) } });
    } catch (err) { sendServerError(res, err); }
  });

  app.get('/api/packing/standards/export.xlsx', async (req, res) => {
    try {
      if (!requireReader(req, res)) return;
      await ensureTables();
      const { sql, params } = standardsWhere(req);
      const r = await pool.query(
        `SELECT s.* FROM packing_item_standards s ${sql}
          ORDER BY (s.station_name = ''), LPAD(s.item_key, 12, '0'), s.party_group, s.station_name`, params);
      const rows = r.rows.map(x => ({
        'Item Code': x.item_code,
        'Item Name': x.item_name,
        'Party Group': x.party_group,
        Station: x.station_name,
        'Cycle Time (sec/pc)': x.cycle_time_sec === null ? '' : Number(x.cycle_time_sec),
        Persons: x.persons ?? '',
        'Pcs / Hour': pcsPerHour(x.cycle_time_sec) ?? '',
        EAN: x.ean,
        'Pcs / Box': x.pcs_per_box ?? '',
        'Boxes / Carton': x.boxes_per_carton ?? '',
        'Carton Type': x.carton_type,
        Check: x.check_note
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Item Code': '' }]);
      ws['!cols'] = [10, 40, 26, 26, 12, 9, 10, 16, 9, 12, 14, 30].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, 'Item Packing Standard');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="packing_item_standards.xlsx"');
      res.send(buf);
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------------- Excel import (preview, then commit) ---------------- */

  app.post('/api/packing/standards/import', (req, res, next) => {
    if (!requireWriter(req, res)) return;
    upload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 15 MB.' : 'Could not read the upload.';
        return res.status(400).json({ ok: false, error: msg });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const w = requireWriter(req, res); if (!w) return;
      await ensureTables();
      if (!req.file || !req.file.buffer) return res.status(400).json({ ok: false, error: 'Choose the Excel file first.' });
      let sheetRows;
      try {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      } catch (_) {
        return res.status(400).json({ ok: false, error: 'This file is not a readable Excel sheet.' });
      }
      const a = analyseImportRows(sheetRows);
      if (a.missingHeaders.length) {
        return res.status(400).json({ ok: false, error: `Columns not found: ${a.missingHeaders.join(', ')}. Expected ItemCode, ItemName, Store, CycleTime, Persons, PartyGroup.` });
      }
      const commit = String(req.query.commit || req.body?.commit || '') === '1';

      const existing = await pool.query(
        `SELECT id, item_key, party_group, station_name, item_name, cycle_time_sec, persons, check_note, is_active, source
           FROM packing_item_standards WHERE factory_id = $1`, [w.factoryId]);
      const byKey = new Map(existing.rows.map(r => [recordKey(r), r]));
      const stationsNow = await pool.query('SELECT LOWER(name) AS n FROM packing_stations WHERE factory_id = $1', [w.factoryId]);
      const known = new Set(stationsNow.rows.map(r => r.n));
      const newStations = a.stations.filter(s => !known.has(s.toLowerCase()));

      const inserts = []; const updates = []; const keptEdited = []; let unchanged = 0;
      for (const rec of a.records) {
        const ex = byKey.get(recordKey(rec));
        if (!ex) inserts.push(rec);
        else if (sameValues(ex, rec)) unchanged++;
        else if (ex.source === 'edited' && ex.is_active) keptEdited.push({ row: rec.row, item_code: rec.item_code, item_name: rec.item_name, party_group: rec.party_group });
        else updates.push({ id: ex.id, rec });
      }
      /* blank-station rows already in the DB whose item + party now has a station */
      const stationedPairs = new Set(a.records.filter(r => r.station_name).map(r => `${r.item_key}|${r.party_group.toLowerCase()}`));
      const retireIds = existing.rows
        .filter(r => r.is_active && !r.station_name && stationedPairs.has(`${r.item_key}|${String(r.party_group).toLowerCase()}`))
        .map(r => r.id);

      const stationCounts = {};
      a.records.forEach(r => { if (r.station_name) stationCounts[r.station_name] = (stationCounts[r.station_name] || 0) + 1; });
      const checks = a.records.filter(r => r.check_note).map(r => ({ row: r.row, item_code: r.item_code, item_name: r.item_name, party_group: r.party_group, message: r.check_note }));
      const report = {
        file_rows: Math.max(0, sheetRows.length - 1),
        records: a.records.length,
        items: new Set(a.records.map(r => r.item_key)).size,
        with_station: a.records.filter(r => r.station_name).length,
        without_station: a.records.filter(r => !r.station_name).length,
        new_rows: inserts.length,
        updated_rows: updates.length,
        unchanged_rows: unchanged,
        kept_edited: keptEdited.length,
        kept_edited_rows: keptEdited.slice(0, 200),
        retired_blank_rows: retireIds.length,
        new_stations: newStations,
        station_counts: stationCounts,
        skipped: a.skipped.length,
        skipped_rows: a.skipped.slice(0, 200),
        check: checks.length,
        check_rows: checks.slice(0, 200),
        warnings: a.warnings.slice(0, 200)
      };
      if (!commit) return res.json({ ok: true, committed: false, report });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (newStations.length) {
          const m = await client.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM packing_stations WHERE factory_id = $1', [w.factoryId]);
          let sort = Number(m.rows[0].m || 0);
          for (const name of newStations) {
            sort += 10;
            await client.query(
              `INSERT INTO packing_stations (factory_id, name, code, sort_order, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT DO NOTHING`,
              [w.factoryId, name, stationCode(name), sort, w.user]);
          }
        }
        const CHUNK = 1000;
        for (let i = 0; i < inserts.length; i += CHUNK) {
          const part = inserts.slice(i, i + CHUNK);
          await client.query(
            `INSERT INTO packing_item_standards (factory_id, item_code, item_key, item_name, party_group, station_name,
                    cycle_time_sec, persons, check_note, source, created_by, updated_by)
             SELECT $1, * , 'import', $10, $10 FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                    $7::numeric[], $8::int[], $9::text[])`,
            [w.factoryId, part.map(r => r.item_code), part.map(r => r.item_key), part.map(r => r.item_name),
              part.map(r => r.party_group), part.map(r => r.station_name), part.map(r => r.cycle_time_sec),
              part.map(r => r.persons), part.map(r => r.check_note), w.user]);
        }
        for (let i = 0; i < updates.length; i += CHUNK) {
          const part = updates.slice(i, i + CHUNK);
          await client.query(
            `UPDATE packing_item_standards s SET item_code = u.code, item_name = u.name, cycle_time_sec = u.cycle,
                    persons = u.persons, check_note = u.note, is_active = TRUE, updated_by = $7, updated_at = NOW()
               FROM UNNEST($1::int[], $2::text[], $3::text[], $4::numeric[], $5::int[], $6::text[])
                    AS u(id, code, name, cycle, persons, note)
              WHERE s.id = u.id`,
            [part.map(u => u.id), part.map(u => u.rec.item_code), part.map(u => u.rec.item_name),
              part.map(u => u.rec.cycle_time_sec), part.map(u => u.rec.persons), part.map(u => u.rec.check_note), w.user]);
        }
        if (retireIds.length) {
          await client.query(
            `UPDATE packing_item_standards SET is_active = FALSE, updated_by = $2, updated_at = NOW() WHERE id = ANY($1::int[])`,
            [retireIds, w.user]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
      res.json({ ok: true, committed: true, report });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = {
  registerPackingMasterRoutes,
  ensurePackingSchema,
  analyseImportRows,
  itemKey,
  stationCode,
  pcsPerHour,
  canEditMasters
};
