'use strict';

/**
 * Packing station tables + the station jobs list for the plan form (assembly.html).
 *
 * A station has numbered tables (A1..A13 ...). A plan stays on its station
 * (assembly_plans.table_id = station name, which the station screen, scanner
 * bridge, labels and reports use) and lists the tables it runs on in
 * assembly_plans.tables ("A1,A2,A3").
 *
 *  - GET /api/packing/tables[?station=]     tables per station (seeds the default list on MAIN)
 *  - PUT /api/packing/tables                { station_name, codes: ['A1', ...] } MAIN only, masters edit right
 *  - PUT /api/packing/tables/:id            { label, scanner_config, persons, note } one table's details (Packing Settings)
 *  - GET /api/packing/station-jobs?station= open job cards whose item is packed at the station, with balance
 *
 * packing_tables is written on MAIN only and flows to the LOCALs (id key), like packing_stations.
 *
 * A table's scanner is mirrored to assembly_lines as line "<station>/<code>" (e.g. "Station A/A1").
 * /api/assembly/active lists each running plan once more per table under that line id, so the
 * scanner bridge posts a table scanner's scans to the plan of its station that runs on the table.
 */

const { getFactoryId, getRequestUsername, normalizeFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const { ensurePackingSchema, canEditMasters } = require('./registerPackingMasterRoutes');

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const JOB_DAYS = 180; // job cards older than this are left out of the station jobs list

/* Scanner line id of a table: "<station>/<code>". */
const tableLineId = (station, code) => `${clean(station, 120)}/${clean(code, 20).toUpperCase()}`;

/* Copy a table's scanner to assembly_lines (where the bridge reads it); '' clears it. */
async function mirrorTableScanner(db, station, code, config) {
  const exists = await db.query(`SELECT to_regclass('public.assembly_lines') AS t`);
  if (!exists.rows[0] || !exists.rows[0].t) return;
  const lineId = tableLineId(station, code);
  const cfg = clean(config, 120);
  const cur = await db.query('SELECT scanner_config FROM assembly_lines WHERE line_id = $1', [lineId]);
  if (!cur.rows.length && !cfg) return;
  if (cur.rows.length && String(cur.rows[0].scanner_config || '') === cfg) return;
  await db.query(
    `INSERT INTO assembly_lines (line_id, line_name, scanner_config, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (line_id) DO UPDATE SET scanner_config = EXCLUDED.scanner_config, updated_at = NOW()`,
    [lineId, `${clean(station, 120)} · ${clean(code, 20).toUpperCase()}`, cfg]);
}

/* Active plans once more per table they run on, under the table's scanner line id. */
function tableAliasRows(plans) {
  const out = [];
  for (const p of plans || []) {
    if (!p || !p.table_id || !p.tables) continue;
    for (const code of parseCodes(p.tables)) {
      out.push({ ...p, table_id: tableLineId(p.table_id, code), station_id: p.table_id, table_code: code, is_table_alias: true });
    }
  }
  return out;
}

/* "Station A/A1" -> { station: 'Station A', code: 'A1' }, or null. */
function splitTableLine(lineId) {
  const s = String(lineId || '');
  const i = s.lastIndexOf('/');
  if (i <= 0 || i === s.length - 1) return null;
  return { station: s.slice(0, i), code: s.slice(i + 1).toUpperCase() };
}

/* Owner's table list (Nov-2026), by station code or name. */
const DEFAULT_TABLES = [
  { match: /^a$/i, prefix: 'A', count: 13 },
  { match: /^b1?$/i, prefix: 'B', count: 14 },
  { match: /^c1?$/i, prefix: 'C', count: 13 },
  { match: /^d$/i, prefix: 'D', count: 13 },
  { match: /^d1\b|clean\s*max/i, prefix: 'DC', count: 7 },
  { match: /^e1?$/i, prefix: 'E', count: 3 },
  { match: /^f1?$/i, prefix: 'F', count: 1 },
  { match: /online|^sf\d*$/i, prefix: 'SF', count: 15 }
];

/* Default table codes for a station, or [] when it is not in the owner's list. */
function defaultTablesFor(station) {
  const code = clean(station && station.code, 40);
  const name = clean(station && station.name, 120);
  const short = name.replace(/^(assembly\s+)?station\s+/i, '');
  const hit = DEFAULT_TABLES.find(d => (code && d.match.test(code))) || DEFAULT_TABLES.find(d => d.match.test(short));
  if (!hit) return [];
  return Array.from({ length: hit.count }, (_, i) => `${hit.prefix}${i + 1}`);
}

/* "a1, A2 a2;A3" -> ['A1', 'A2', 'A3'] (upper case, unique, in order). */
function parseCodes(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
  const out = [];
  for (const c of list) {
    const code = clean(c, 20).toUpperCase();
    if (code && !out.includes(code)) out.push(code);
  }
  return out.slice(0, 60);
}

async function ensureTableSchema(pool) {
  await ensurePackingSchema(pool);
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_tables_schema'));
    CREATE TABLE IF NOT EXISTS packing_tables (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      station_name TEXT NOT NULL,
      code TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ix_packing_tables_station ON packing_tables (factory_id, station_name);
    CREATE INDEX IF NOT EXISTS ix_packing_tables_updated ON packing_tables (updated_at);
    ALTER TABLE packing_tables ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
    ALTER TABLE packing_tables ADD COLUMN IF NOT EXISTS scanner_config TEXT NOT NULL DEFAULT '';
    ALTER TABLE packing_tables ADD COLUMN IF NOT EXISTS persons INTEGER;
    ALTER TABLE packing_tables ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
    ALTER TABLE packing_stations ADD COLUMN IF NOT EXISTS tables_seeded BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE assembly_plans ADD COLUMN IF NOT EXISTS tables TEXT;
  `);
}

/* MAIN: give each station of the factory its default tables once. */
async function seedTables(db, fid) {
  if (isLocalServer() || !fid) return 0;
  const st = await db.query('SELECT id, name, code FROM packing_stations WHERE factory_id = $1 AND NOT tables_seeded', [fid]);
  let added = 0;
  for (const s of st.rows) {
    const codes = defaultTablesFor(s);
    const have = await db.query('SELECT 1 FROM packing_tables WHERE factory_id = $1 AND LOWER(station_name) = LOWER($2) LIMIT 1', [fid, s.name]);
    if (codes.length && !have.rows.length) {
      for (let i = 0; i < codes.length; i++) {
        await db.query('INSERT INTO packing_tables (factory_id, station_name, code, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5)',
          [fid, s.name, codes[i], (i + 1) * 10, 'system']);
        added++;
      }
    }
    await db.query('UPDATE packing_stations SET tables_seeded = TRUE, updated_at = NOW() WHERE id = $1', [s.id]);
  }
  return added;
}

function registerPackingTableRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureTableSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing tables] schema ensure failed:', err.message));

  const readFactory = (req) => normalizeFactoryId(getFactoryId(req));
  function requireReader(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }

  app.get('/api/packing/tables', async (req, res) => {
    try {
      if (!requireReader(req, res)) return;
      await ensureTables();
      const fid = readFactory(req);
      if (fid && !isLocalServer()) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing_tables_seed_${fid}`]);
          await seedTables(client, fid);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally { client.release(); }
      }
      const station = clean(req.query.station, 120);
      const r = await pool.query(`
        SELECT id, factory_id, station_name, code, sort_order, is_active, label, scanner_config, persons, note,
               station_name || '/' || code AS line_id, updated_by, updated_at FROM packing_tables
         WHERE ($1::int IS NULL OR factory_id = $1) AND ($2::text = '' OR LOWER(station_name) = LOWER($2))
         ORDER BY station_name, sort_order, id`, [fid, station]);
      res.json({ ok: true, data: r.rows });
    } catch (err) { sendServerError(res, err); }
  });

  /* Replace a station's table list: new codes are added, missing ones turned off, kept ones turned on and re-ordered. */
  app.put('/api/packing/tables', async (req, res) => {
    try {
      if (isLocalServer()) return res.status(403).json({ ok: false, error: 'Packing masters can only be changed on the MAIN server.' });
      if (!req.auth) return res.status(401).json({ ok: false, error: 'Please log in again.' });
      if (!canEditMasters(req.auth)) return res.status(403).json({ ok: false, error: 'Masters edit permission required.' });
      const fid = readFactory(req);
      if (!fid) return res.status(400).json({ ok: false, error: 'Select one factory first.' });
      await ensureTables();
      const station = clean(req.body && req.body.station_name, 120);
      const codes = parseCodes(req.body && req.body.codes);
      const st = await pool.query('SELECT name FROM packing_stations WHERE factory_id = $1 AND LOWER(name) = LOWER($2)', [fid, station]);
      if (!st.rows.length) return res.status(404).json({ ok: false, error: 'Station not found.' });
      const name = st.rows[0].name;
      const user = req.auth.username || 'system';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = await client.query('SELECT id, code FROM packing_tables WHERE factory_id = $1 AND LOWER(station_name) = LOWER($2)', [fid, name]);
        const byCode = new Map(cur.rows.map(r => [String(r.code).toUpperCase(), r.id]));
        for (let i = 0; i < codes.length; i++) {
          const id = byCode.get(codes[i]);
          if (id) {
            await client.query('UPDATE packing_tables SET is_active = TRUE, sort_order = $2, updated_by = $3, updated_at = NOW() WHERE id = $1', [id, (i + 1) * 10, user]);
            byCode.delete(codes[i]);
          } else {
            await client.query('INSERT INTO packing_tables (factory_id, station_name, code, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5)',
              [fid, name, codes[i], (i + 1) * 10, user]);
          }
        }
        for (const id of byCode.values()) {
          const off = await client.query(
            'UPDATE packing_tables SET is_active = FALSE, updated_by = $2, updated_at = NOW() WHERE id = $1 AND is_active RETURNING code, scanner_config', [id, user]);
          /* a table taken off the list lets go of its scanner */
          if (off.rows.length && off.rows[0].scanner_config) await mirrorTableScanner(client, name, off.rows[0].code, '');
        }
        /* a table put back on the list gets its scanner back (no-op when unchanged) */
        const back = await client.query(
          `SELECT code, scanner_config FROM packing_tables
            WHERE factory_id = $1 AND LOWER(station_name) = LOWER($2) AND is_active AND scanner_config <> ''`, [fid, name]);
        for (const t of back.rows) await mirrorTableScanner(client, name, t.code, t.scanner_config);
        await client.query('UPDATE packing_stations SET tables_seeded = TRUE, updated_at = NOW() WHERE factory_id = $1 AND name = $2', [fid, name]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
      res.json({ ok: true, data: { station_name: name, codes } });
    } catch (err) { sendServerError(res, err); }
  });

  /* One table's details: name, scanner, persons, note. */
  app.put('/api/packing/tables/:id', async (req, res) => {
    try {
      if (isLocalServer()) return res.status(403).json({ ok: false, error: 'Packing masters can only be changed on the MAIN server.' });
      if (!req.auth) return res.status(401).json({ ok: false, error: 'Please log in again.' });
      if (!canEditMasters(req.auth)) return res.status(403).json({ ok: false, error: 'Masters edit permission required.' });
      const fid = readFactory(req);
      if (!fid) return res.status(400).json({ ok: false, error: 'Select one factory first.' });
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'Bad table id.' });
      await ensureTables();
      const b = req.body || {};
      const label = clean(b.label, 60);
      const scanner = clean(b.scanner_config, 120);
      const note = clean(b.note, 300);
      const persons = b.persons === '' || b.persons === null || b.persons === undefined ? null : parseInt(b.persons, 10);
      if (persons !== null && (Number.isNaN(persons) || persons < 0 || persons > 50)) {
        return res.status(400).json({ ok: false, error: 'Persons must be 0 to 50.' });
      }
      const user = req.auth.username || 'system';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = await client.query('SELECT * FROM packing_tables WHERE id = $1 AND factory_id = $2 FOR UPDATE', [id, fid]);
        if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Table not found.' }); }
        const t = cur.rows[0];
        if (scanner) {
          /* one scanner, one table: refuse a scanner already set on another table of this factory */
          const dup = await client.query(
            `SELECT station_name, code FROM packing_tables
              WHERE factory_id = $1 AND id <> $2 AND is_active AND LOWER(scanner_config) = LOWER($3) LIMIT 1`, [fid, id, scanner]);
          if (dup.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ ok: false, error: `That scanner is already set on table ${dup.rows[0].code} (${dup.rows[0].station_name}).` });
          }
        }
        const up = await client.query(
          `UPDATE packing_tables SET label = $2, scanner_config = $3, persons = $4, note = $5, updated_by = $6, updated_at = NOW()
            WHERE id = $1 RETURNING *, station_name || '/' || code AS line_id`, [id, label, scanner, persons, note, user]);
        await mirrorTableScanner(client, t.station_name, t.code, t.is_active ? scanner : '');
        await client.query('COMMIT');
        res.json({ ok: true, data: up.rows[0] });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    } catch (err) { sendServerError(res, err); }
  });

  /* Open job cards whose item (and party) is packed at this station, with planned qty and balance. */
  app.get('/api/packing/station-jobs', async (req, res) => {
    try {
      if (!requireReader(req, res)) return;
      await ensureTables();
      const station = clean(req.query.station, 120);
      if (!station) return res.status(400).json({ ok: false, error: 'Pick a station.' });
      const t = await pool.query(`SELECT to_regclass('public.or_jr_report') AS jr`);
      if (!t.rows[0].jr) return res.json({ ok: true, data: [] });
      const fid = readFactory(req);
      const excludeId = parseInt(req.query.exclude_plan, 10);
      const r = await pool.query(`
        WITH std AS (
          SELECT DISTINCT item_key, LOWER(TRIM(party_group)) AS party, MAX(cycle_time_sec) AS cycle_time_sec
            FROM packing_item_standards
           WHERE is_active AND LOWER(station_name) = LOWER($1) AND ($2::int IS NULL OR factory_id = $2)
           GROUP BY 1, 2
        ), jr AS (
          SELECT DISTINCT ON (UPPER(TRIM(j.job_card_no)))
                 TRIM(j.job_card_no) AS job_card_no, j.or_jr_no, j.item_code, j.product_name, j.client_name,
                 COALESCE(j.jr_qty, 0)::int AS jr_qty, j.or_jr_date,
                 UPPER(REGEXP_REPLACE(TRIM(COALESCE(j.item_code, '')), '^0+(?=.)', '')) AS item_key
            FROM or_jr_report j
           WHERE COALESCE(j.is_deleted, FALSE) = FALSE
             AND NULLIF(TRIM(COALESCE(j.job_card_no, '')), '') IS NOT NULL
             AND ($2::int IS NULL OR j.factory_id = $2)
             AND (j.or_jr_date IS NULL OR j.or_jr_date >= CURRENT_DATE - ${JOB_DAYS})
           ORDER BY UPPER(TRIM(j.job_card_no)), j.or_jr_date DESC NULLS LAST
        ), planned AS (
          SELECT UPPER(TRIM(job_card_no)) AS jc, COALESCE(SUM(plan_qty), 0)::int AS qty, COUNT(*)::int AS plans
            FROM assembly_plans
           WHERE NULLIF(TRIM(COALESCE(job_card_no, '')), '') IS NOT NULL
             AND UPPER(COALESCE(status, '')) NOT IN ('ARCHIVED', 'CANCELLED')
             AND ($3::int IS NULL OR id <> $3)
           GROUP BY 1
        )
        SELECT jr.job_card_no, jr.or_jr_no, jr.item_code, jr.product_name AS item_name, jr.client_name, jr.jr_qty,
               to_char(jr.or_jr_date, 'DD-Mon') AS jr_date, std.cycle_time_sec,
               COALESCE(p.qty, 0) AS planned_qty, COALESCE(p.plans, 0) AS plans,
               GREATEST(jr.jr_qty - COALESCE(p.qty, 0), 0) AS balance_qty
          FROM jr
          JOIN std ON std.item_key = jr.item_key AND std.party = LOWER(TRIM(COALESCE(jr.client_name, '')))
          LEFT JOIN planned p ON p.jc = UPPER(jr.job_card_no)
         WHERE jr.jr_qty - COALESCE(p.qty, 0) > 0
         ORDER BY jr.or_jr_date ASC NULLS LAST, jr.job_card_no
         LIMIT 300`, [station, fid, Number.isNaN(excludeId) ? null : excludeId]);
      res.json({ ok: true, data: r.rows });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = {
  registerPackingTableRoutes, ensureTableSchema, defaultTablesFor, parseCodes, seedTables,
  tableLineId, tableAliasRows, splitTableLine, mirrorTableScanner
};
