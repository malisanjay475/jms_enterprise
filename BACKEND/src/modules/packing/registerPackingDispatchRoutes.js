'use strict';

/**
 * Packed stock and dispatch (PUBLIC/packing_stock.html, PUBLIC/packing_dispatch.html).
 *
 * Stock = cartons (and loose boxes of items packed without cartons) the store has
 * received on a handover slip and not yet dispatched. The store opens a dispatch slip
 * for one party and vehicle, scans cartons out, closes and prints it.
 *
 *  - GET  /api/packing/stock                      stock by item + party, totals
 *  - GET  /api/packing/stock/detail?item=&party=  job cards and carton codes inside a row
 *  - GET  /api/packing/dispatch/summary           my open slip, other open slips, recent, parties in stock
 *  - POST /api/packing/dispatch/slips             { party, vehicle_no, invoice_no } open a slip
 *  - PUT  /api/packing/dispatch/slips/:id         { vehicle_no, invoice_no } while open
 *  - GET  /api/packing/dispatch/slips/:id         slip with lines (printed slip)
 *  - POST /api/packing/dispatch/slips/:id/scan    { code }
 *  - POST /api/packing/dispatch/slips/:id/undo
 *  - POST /api/packing/dispatch/slips/:id/close
 *  - POST /api/packing/dispatch/slips/:id/reopen  { pin, reason } supervisor PIN
 *  - GET  /api/packing/settings                   { stock_alert_days }
 *  - PUT  /api/packing/settings                   MAIN only, masters edit right
 *
 * packing_dispatches replicates LOCAL -> MAIN by sync_id; dispatched columns ride on
 * packing_boxes. packing_settings is written on MAIN only and flows to the LOCALs.
 */

const { getFactoryId, getRequestUsername, normalizeFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const { ensureHandoverSchema, UNIT_SQL, verifySupervisorPin } = require('./registerPackingHandoverRoutes');

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';
const serverFactoryId = () => (isLocalServer() ? normalizeFactoryId(process.env.LOCAL_FACTORY_ID) : null);
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const partyKey = (v) => clean(v, 200).toLowerCase();
const DEFAULT_ALERT_DAYS = 30;

/* In store: received, not dispatched, not voided. */
const STOCK_SQL = `${UNIT_SQL} AND b.voided_at IS NULL AND b.received_at IS NOT NULL AND b.dispatched_at IS NULL`;

async function ensureDispatchSchema(pool) {
  await ensureHandoverSchema(pool);
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_dispatch_schema'));
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_dispatch ON packing_boxes (dispatch_sync_id) WHERE dispatch_sync_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_stock ON packing_boxes (factory_id, client_name) WHERE received_at IS NOT NULL AND dispatched_at IS NULL AND voided_at IS NULL;
    CREATE TABLE IF NOT EXISTS packing_dispatches (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      seq INTEGER NOT NULL,
      slip_no TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      party TEXT NOT NULL,
      vehicle_no TEXT,
      invoice_no TEXT,
      cartons INTEGER NOT NULL DEFAULT 0,
      pcs INTEGER NOT NULL DEFAULT 0,
      opened_by TEXT,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_by TEXT,
      closed_at TIMESTAMPTZ,
      reopen_count INTEGER NOT NULL DEFAULT 0,
      last_reopen_reason TEXT,
      last_reopen_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_id UUID NOT NULL DEFAULT gen_random_uuid()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_dispatches ON packing_dispatches (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_dispatches_open ON packing_dispatches (factory_id, status);
    CREATE INDEX IF NOT EXISTS ix_packing_dispatches_opened ON packing_dispatches (opened_at);
    CREATE INDEX IF NOT EXISTS ix_packing_dispatches_updated ON packing_dispatches (updated_at);
    CREATE TABLE IF NOT EXISTS packing_settings (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      stock_alert_days INTEGER NOT NULL DEFAULT ${DEFAULT_ALERT_DAYS},
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_settings_factory ON packing_settings (factory_id);
    CREATE INDEX IF NOT EXISTS ix_packing_settings_updated ON packing_settings (updated_at);
  `);
}

const dispatchSlipNo = (fid, seq) => `DS${fid || 'M'}-${String(seq).padStart(4, '0')}`;

/* Why a label can't go out on this slip, or null when it can. */
function dispatchRefusal(box, slipParty, dispatchedSlip) {
  if (!box || box.kind === 'OPENING') return 'Unknown label. Check the code.';
  if (box.voided_at) return `This label was voided${box.void_reason ? ` (${box.void_reason})` : ''}.`;
  if (box.kind === 'BOX' && box.carton_code) return `This box is in carton ${box.carton_code}. Scan the carton.`;
  if (box.dispatched_at) return `Already dispatched on slip ${dispatchedSlip || 'another slip'}.`;
  if (!box.received_at) return 'The store has not received this carton yet. Scan it on a handover slip first.';
  if (partyKey(box.client_name) !== partyKey(slipParty)) {
    return `This carton is for ${clean(box.client_name) || 'no party'}, not ${clean(slipParty)}.`;
  }
  return null;
}

async function alertDays(db, fid) {
  try {
    const r = await db.query('SELECT stock_alert_days FROM packing_settings WHERE factory_id IS NOT DISTINCT FROM $1 LIMIT 1', [fid]);
    const d = r.rows.length ? Number(r.rows[0].stock_alert_days) : DEFAULT_ALERT_DAYS;
    return d > 0 ? d : DEFAULT_ALERT_DAYS;
  } catch (_) { return DEFAULT_ALERT_DAYS; }
}

/* Stock grouped by item + party. */
async function stockRows(db, fid, { q, party } = {}) {
  const like = q ? `%${q.toLowerCase()}%` : null;
  const r = await db.query(`
    SELECT b.item_name, MAX(b.item_code) AS item_code, b.client_name,
           COUNT(*)::int AS units, COUNT(*) FILTER (WHERE b.kind = 'BOX')::int AS loose_boxes,
           COALESCE(SUM(b.qty), 0)::int AS pcs, COUNT(DISTINCT b.job_card_no)::int AS jobs,
           FLOOR(EXTRACT(EPOCH FROM NOW() - MIN(b.received_at)) / 86400)::int AS oldest_days
      FROM packing_boxes b
     WHERE ${STOCK_SQL}
       AND ($1::int IS NULL OR b.factory_id = $1)
       AND ($2::text IS NULL OR LOWER(b.item_name) LIKE $2 OR LOWER(COALESCE(b.client_name, '')) LIKE $2
            OR LOWER(COALESCE(b.job_card_no, '')) LIKE $2 OR LOWER(COALESCE(b.item_code, '')) LIKE $2)
       AND ($3::text IS NULL OR LOWER(COALESCE(b.client_name, '')) = LOWER($3))
     GROUP BY b.item_name, b.client_name
     ORDER BY MIN(b.received_at)
     LIMIT 1000`, [fid, like, party || null]);
  return r.rows;
}

async function stockTotals(db, fid, days) {
  const r = await db.query(`
    SELECT COUNT(*)::int AS units, COALESCE(SUM(b.qty), 0)::int AS pcs,
           COUNT(*) FILTER (WHERE b.kind = 'BOX')::int AS loose_boxes,
           COUNT(*) FILTER (WHERE b.received_at < NOW() - make_interval(days => $2))::int AS old
      FROM packing_boxes b WHERE ${STOCK_SQL} AND ($1::int IS NULL OR b.factory_id = $1)`, [fid, days]);
  const t = await db.query(`
    SELECT COUNT(*)::int AS units, COALESCE(SUM(b.qty), 0)::int AS pcs FROM packing_boxes b
     WHERE b.dispatched_at >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
       AND ($1::int IS NULL OR b.factory_id = $1)`, [fid]);
  return { ...r.rows[0], dispatched_today: t.rows[0].units, dispatched_today_pcs: t.rows[0].pcs };
}

async function stockDetail(db, fid, item, party) {
  const r = await db.query(`
    SELECT b.job_card_no, b.table_id, COUNT(*)::int AS units, COUNT(*) FILTER (WHERE b.kind = 'BOX')::int AS loose_boxes,
           COALESCE(SUM(b.qty), 0)::int AS pcs,
           to_char(MIN(b.received_at) AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY') AS first_in,
           FLOOR(EXTRACT(EPOCH FROM NOW() - MIN(b.received_at)) / 86400)::int AS oldest_days,
           array_agg(b.code ORDER BY b.received_at) AS codes
      FROM packing_boxes b
     WHERE ${STOCK_SQL} AND ($1::int IS NULL OR b.factory_id = $1)
       AND b.item_name = $2 AND COALESCE(b.client_name, '') = COALESCE($3, '')
     GROUP BY 1, 2 ORDER BY MIN(b.received_at)`, [fid, item, party]);
  return r.rows;
}

async function slipTotals(db, slip) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS cartons, COALESCE(SUM(qty), 0)::int AS pcs FROM packing_boxes WHERE dispatch_sync_id = $1`, [slip.sync_id]);
  await db.query('UPDATE packing_dispatches SET cartons = $2, pcs = $3, updated_at = NOW() WHERE id = $1', [slip.id, r.rows[0].cartons, r.rows[0].pcs]);
  return r.rows[0];
}

async function slipLines(db, slip) {
  const lines = await db.query(`
    SELECT item_name, item_code, job_card_no, COUNT(*)::int AS cartons, SUM(qty)::int AS pcs,
           COUNT(*) FILTER (WHERE kind = 'BOX')::int AS loose_boxes
      FROM packing_boxes WHERE dispatch_sync_id = $1
     GROUP BY 1, 2, 3 ORDER BY 1, 3`, [slip.sync_id]);
  const codes = await db.query(`
    SELECT code, kind, qty, item_name, job_card_no,
           to_char(dispatched_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS at
      FROM packing_boxes WHERE dispatch_sync_id = $1 ORDER BY dispatched_at DESC, id DESC`, [slip.sync_id]);
  return { lines: lines.rows, codes: codes.rows };
}

const SLIP_SQL = `
  SELECT d.*, to_char(d.opened_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS opened_local,
         to_char(d.closed_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS closed_local
    FROM packing_dispatches d`;

async function findLabel(db, code, fid) {
  const r = await db.query(`
    SELECT b.*, d.slip_no AS dispatched_slip FROM packing_boxes b
      LEFT JOIN packing_dispatches d ON d.sync_id = b.dispatch_sync_id
     WHERE UPPER(b.code) = UPPER($1) AND ($2::int IS NULL OR b.factory_id = $2)
     ORDER BY b.id DESC LIMIT 1`, [code, fid]);
  return r.rows[0] || null;
}

function registerPackingDispatchRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureDispatchSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing dispatch] schema ensure failed:', err.message));

  const userOf = (req) => (req.auth && req.auth.username) || getRequestUsername(req) || '';
  const factoryOf = (req) => serverFactoryId() || normalizeFactoryId(req.headers ? getFactoryId(req) : null);
  function requireUser(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }
  const bad = (res, status, error) => res.status(status).json({ ok: false, error });
  const reopenTries = new Map(); // slip id -> wrong PIN times

  async function loadSlip(id, fid) {
    const r = await pool.query(`${SLIP_SQL} WHERE d.id = $1 AND d.factory_id IS NOT DISTINCT FROM $2`, [id, fid]);
    return r.rows[0] || null;
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

  /* ---------- stock ---------- */
  app.get('/api/packing/stock', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const days = await alertDays(pool, fid);
      const rows = await stockRows(pool, fid, { q: clean(req.query.q, 80) || null, party: clean(req.query.party, 200) || null });
      res.json({ ok: true, data: { rows, totals: await stockTotals(pool, fid, days), alert_days: days } });
    } catch (err) { sendServerError(res, err); }
  });

  app.get('/api/packing/stock/detail', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const item = clean(req.query.item, 200);
      if (!item) return bad(res, 400, 'Pick an item.');
      res.json({ ok: true, data: await stockDetail(pool, factoryOf(req), item, clean(req.query.party, 200)) });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------- settings ---------- */
  app.get('/api/packing/settings', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      res.json({ ok: true, data: { stock_alert_days: await alertDays(pool, factoryOf(req)) } });
    } catch (err) { sendServerError(res, err); }
  });

  app.put('/api/packing/settings', async (req, res) => {
    try {
      if (isLocalServer()) return bad(res, 403, 'Packing settings can only be changed on the MAIN server.');
      if (!req.auth) return bad(res, 401, 'Please log in again.');
      if (!require('./registerPackingMasterRoutes').canEditMasters(req.auth)) return bad(res, 403, 'Masters edit permission required.');
      const fid = normalizeFactoryId(getFactoryId(req));
      if (!fid) return bad(res, 400, 'Select one factory first.');
      const days = parseInt(req.body && req.body.stock_alert_days, 10);
      if (!(days >= 1 && days <= 365)) return bad(res, 400, 'Days must be between 1 and 365.');
      await ensureTables();
      await pool.query(`
        INSERT INTO packing_settings (factory_id, stock_alert_days, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
        ON CONFLICT (factory_id) DO UPDATE SET stock_alert_days = EXCLUDED.stock_alert_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [fid, days, userOf(req)]);
      res.json({ ok: true, data: { stock_alert_days: days } });
    } catch (err) { sendServerError(res, err); }
  });

  /* ---------- dispatch slips ---------- */
  app.get('/api/packing/dispatch/summary', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const user = userOf(req);
      const open = await pool.query(
        `${SLIP_SQL} WHERE d.status = 'OPEN' AND d.factory_id IS NOT DISTINCT FROM $1 ORDER BY (d.opened_by = $2) DESC, d.id DESC`, [fid, user]);
      const mine = open.rows.find(s => s.opened_by === user) || null;
      const recent = await pool.query(
        `${SLIP_SQL} WHERE d.status = 'CLOSED' AND d.factory_id IS NOT DISTINCT FROM $1 ORDER BY d.closed_at DESC LIMIT 15`, [fid]);
      const parties = await pool.query(`
        SELECT b.client_name AS party, COUNT(*)::int AS units, COALESCE(SUM(b.qty), 0)::int AS pcs
          FROM packing_boxes b WHERE ${STOCK_SQL} AND ($1::int IS NULL OR b.factory_id = $1) AND COALESCE(b.client_name, '') <> ''
         GROUP BY 1 ORDER BY 2 DESC LIMIT 200`, [fid]);
      let partyStock = null;
      if (mine) partyStock = await stockRows(pool, fid, { party: mine.party });
      res.json({
        ok: true,
        data: {
          slip: mine ? { ...mine, ...(await slipLines(pool, mine)), party_stock: partyStock } : null,
          other_open: open.rows.filter(s => !mine || s.id !== mine.id),
          recent: recent.rows,
          parties: parties.rows
        }
      });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/dispatch/slips', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const user = userOf(req);
      let party = clean(req.body && req.body.party, 200);
      if (!party) return bad(res, 400, 'Pick the party.');
      // use the party's own spelling from the labels when it matches
      const known = await pool.query(
        `SELECT b.client_name FROM packing_boxes b WHERE ${STOCK_SQL} AND ($1::int IS NULL OR b.factory_id = $1)
            AND LOWER(TRIM(b.client_name)) = LOWER($2) LIMIT 1`, [fid, party]);
      if (known.rows.length) party = clean(known.rows[0].client_name, 200);
      const vehicle = clean(req.body && req.body.vehicle_no, 30).toUpperCase();
      const invoice = clean(req.body && req.body.invoice_no, 60);
      const slip = await inTx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing_dispatch_${fid || 0}`]);
        const mine = await db.query(
          `SELECT id FROM packing_dispatches WHERE status = 'OPEN' AND factory_id IS NOT DISTINCT FROM $1 AND opened_by = $2 LIMIT 1`, [fid, user]);
        if (mine.rows.length) return { id: mine.rows[0].id, existing: true };
        const m = await db.query('SELECT COALESCE(MAX(seq), 0)::int AS m FROM packing_dispatches WHERE factory_id IS NOT DISTINCT FROM $1', [fid]);
        const seq = m.rows[0].m + 1;
        const r = await db.query(
          `INSERT INTO packing_dispatches (factory_id, seq, slip_no, party, vehicle_no, invoice_no, opened_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [fid, seq, dispatchSlipNo(fid, seq), party, vehicle || null, invoice || null, user]);
        return { id: r.rows[0].id, existing: false };
      });
      res.json({ ok: true, data: { ...(await loadSlip(slip.id, fid)), existing: slip.existing } });
    } catch (err) { sendServerError(res, err); }
  });

  app.put('/api/packing/dispatch/slips/:id', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const slip = await loadSlip(parseInt(req.params.id, 10), factoryOf(req));
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status !== 'OPEN') return bad(res, 400, 'This slip is closed.');
      const vehicle = clean(req.body && req.body.vehicle_no, 30).toUpperCase();
      const invoice = clean(req.body && req.body.invoice_no, 60);
      await pool.query('UPDATE packing_dispatches SET vehicle_no = $2, invoice_no = $3, updated_at = NOW() WHERE id = $1',
        [slip.id, vehicle || null, invoice || null]);
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });

  app.get('/api/packing/dispatch/slips/:id', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const slip = await loadSlip(parseInt(req.params.id, 10), factoryOf(req));
      if (!slip) return bad(res, 404, 'Slip not found.');
      res.json({ ok: true, data: { ...slip, ...(await slipLines(pool, slip)) } });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/dispatch/slips/:id/scan', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const code = clean(req.body && req.body.code, 60).toUpperCase();
      if (!code) return bad(res, 400, 'Scan a label.');
      const slip = await loadSlip(parseInt(req.params.id, 10), fid);
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status !== 'OPEN') return bad(res, 400, `Slip ${slip.slip_no} is closed. Start a new slip.`);
      const result = await inTx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing_label_${code}`]);
        const box = await findLabel(db, code, fid);
        const why = dispatchRefusal(box, slip.party, box && box.dispatched_slip);
        if (why) return { refused: why, box };
        await db.query(
          'UPDATE packing_boxes SET dispatched_at = NOW(), dispatched_by = $2, dispatch_sync_id = $3, updated_at = NOW() WHERE id = $1',
          [box.id, userOf(req), slip.sync_id]);
        const totals = await slipTotals(db, slip);
        return { box, totals };
      });
      if (result.refused) {
        return res.status(409).json({ ok: false, error: result.refused, code, label: result.box ? { item_name: result.box.item_name, kind: result.box.kind } : null });
      }
      const b = result.box;
      res.json({ ok: true, data: { code: b.code, kind: b.kind, qty: b.qty, item_name: b.item_name, job_card_no: b.job_card_no, ...result.totals } });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/dispatch/slips/:id/undo', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const slip = await loadSlip(parseInt(req.params.id, 10), factoryOf(req));
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status !== 'OPEN') return bad(res, 400, 'This slip is closed.');
      const out = await inTx(async (db) => {
        const last = await db.query(
          'SELECT id, code FROM packing_boxes WHERE dispatch_sync_id = $1 ORDER BY dispatched_at DESC, id DESC LIMIT 1', [slip.sync_id]);
        if (!last.rows.length) return null;
        await db.query(
          'UPDATE packing_boxes SET dispatched_at = NULL, dispatched_by = NULL, dispatch_sync_id = NULL, updated_at = NOW() WHERE id = $1', [last.rows[0].id]);
        await slipTotals(db, slip);
        return last.rows[0].code;
      });
      if (!out) return bad(res, 400, 'Nothing scanned on this slip yet.');
      res.json({ ok: true, data: { code: out } });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/dispatch/slips/:id/close', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const slip = await loadSlip(parseInt(req.params.id, 10), factoryOf(req));
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status !== 'OPEN') return res.json({ ok: true, already: true });
      const totals = await slipTotals(pool, slip);
      if (!totals.cartons) return bad(res, 400, 'Scan at least one carton before closing the slip.');
      await pool.query(
        `UPDATE packing_dispatches SET status = 'CLOSED', closed_by = $2, closed_at = NOW(), updated_at = NOW() WHERE id = $1`, [slip.id, userOf(req)]);
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/dispatch/slips/:id/reopen', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const reason = clean(req.body && req.body.reason, 200);
      if (reason.length < 3) return bad(res, 400, 'Give a reason to reopen the slip.');
      const slip = await loadSlip(parseInt(req.params.id, 10), fid);
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status === 'OPEN') return res.json({ ok: true, already: true });
      const check = await verifySupervisorPin(pool, fid, req.body && req.body.pin, reopenTries, slip.id);
      if (check.error) return bad(res, check.status, check.error);
      await pool.query(
        `UPDATE packing_dispatches SET status = 'OPEN', closed_at = NULL, closed_by = NULL, reopen_count = reopen_count + 1,
                last_reopen_reason = $2, last_reopen_by = $3, updated_at = NOW() WHERE id = $1`,
        [slip.id, reason, check.name]);
      res.json({ ok: true, data: { reopened_by: check.name } });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = {
  registerPackingDispatchRoutes, ensureDispatchSchema, dispatchRefusal, dispatchSlipNo, alertDays, STOCK_SQL, DEFAULT_ALERT_DAYS
};
