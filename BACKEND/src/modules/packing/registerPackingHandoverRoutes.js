'use strict';

/**
 * Packing -> store handover (PUBLIC/packing_handover.html).
 *
 * The store opens a handover slip and scans carton labels (or loose box labels for
 * items packed without cartons). Each scan marks the packing_boxes row received on
 * that slip; the slip is closed and printed. Cartons labelled but not received are
 * "waiting at packing".
 *
 *  - GET  /api/packing/handover/summary          my open slip, waiting list, recent slips
 *  - POST /api/packing/handover/slips            open a new slip
 *  - GET  /api/packing/handover/slips/:id        slip with lines (for the printed slip)
 *  - POST /api/packing/handover/slips/:id/scan   { code }
 *  - POST /api/packing/handover/slips/:id/undo   take the last scan off an open slip
 *  - POST /api/packing/handover/slips/:id/close
 *  - POST /api/packing/handover/slips/:id/reopen { pin, reason } supervisor PIN
 *  - POST /api/packing/handover/reject           { code, reason } store refuses a carton
 *
 * Scope: a LOCAL server works on its own factory; MAIN uses the selected factory.
 * packing_handovers replicates LOCAL -> MAIN by sync_id; received / rejected columns
 * ride on packing_boxes.
 */

const { getFactoryId, getRequestUsername, normalizeFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const { ensurePackingBoxSchema } = require('./registerPackingBoxRoutes');

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';
const serverFactoryId = () => (isLocalServer() ? normalizeFactoryId(process.env.LOCAL_FACTORY_ID) : null);
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const WAIT_ALERT_HOURS = 24;

/* A label the store takes: a carton, or a loose box of an item packed without cartons. */
const UNIT_SQL = `(b.kind = 'CARTON' OR (b.kind = 'BOX' AND b.carton_code IS NULL AND COALESCE(b.boxes_per_carton, 0) = 0))`;

async function ensureHandoverSchema(pool) {
  await ensurePackingBoxSchema(pool);
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_handover_schema'));
    CREATE TABLE IF NOT EXISTS packing_handovers (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      seq INTEGER NOT NULL,
      slip_no TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
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
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_handovers ON packing_handovers (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_handovers_open ON packing_handovers (factory_id, status);
    CREATE INDEX IF NOT EXISTS ix_packing_handovers_opened ON packing_handovers (opened_at);
    CREATE INDEX IF NOT EXISTS ix_packing_handovers_updated ON packing_handovers (updated_at);
  `);
}

const slipNo = (fid, seq) => `HO${fid || 'M'}-${String(seq).padStart(4, '0')}`;

/* Why a label can't be received, or null when it can. */
function refusal(box, slipOf) {
  if (!box || box.kind === 'OPENING') return 'Unknown label. Check the code.';
  if (box.voided_at) return `This label was voided${box.void_reason ? ` (${box.void_reason})` : ''}. Packing must relabel it.`;
  if (box.received_at) return `Already received on slip ${slipOf || 'another slip'}.`;
  if (box.kind === 'BOX' && box.carton_code) return `This box is in carton ${box.carton_code}. Scan the carton.`;
  if (box.kind === 'BOX' && Number(box.boxes_per_carton) > 0) return 'This box is not in a carton yet. Packing must close the carton first.';
  return null;
}

async function slipTotals(db, slip) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS cartons, COALESCE(SUM(qty), 0)::int AS pcs FROM packing_boxes WHERE handover_sync_id = $1`, [slip.sync_id]);
  await db.query('UPDATE packing_handovers SET cartons = $2, pcs = $3, updated_at = NOW() WHERE id = $1', [slip.id, r.rows[0].cartons, r.rows[0].pcs]);
  return r.rows[0];
}

async function slipLines(db, slip) {
  const lines = await db.query(`
    SELECT item_name, item_code, client_name, job_card_no, COUNT(*)::int AS cartons, SUM(qty)::int AS pcs,
           COUNT(*) FILTER (WHERE kind = 'BOX')::int AS loose_boxes
      FROM packing_boxes WHERE handover_sync_id = $1
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 4`, [slip.sync_id]);
  const codes = await db.query(`
    SELECT code, kind, qty, item_name, job_card_no, table_id,
           to_char(received_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS at
      FROM packing_boxes WHERE handover_sync_id = $1 ORDER BY received_at DESC, id DESC`, [slip.sync_id]);
  return { lines: lines.rows, codes: codes.rows };
}

const SLIP_SQL = `
  SELECT h.*, to_char(h.opened_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS opened_local,
         to_char(h.closed_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS closed_local
    FROM packing_handovers h`;

/* Labels waiting at packing, grouped by station and job. */
async function waitingList(db, fid, station) {
  const r = await db.query(`
    SELECT b.table_id, b.item_name, b.job_card_no, b.client_name, COUNT(*)::int AS units, SUM(b.qty)::int AS pcs,
           COUNT(*) FILTER (WHERE b.kind = 'BOX')::int AS loose_boxes,
           ROUND(EXTRACT(EPOCH FROM NOW() - MIN(b.created_at)) / 3600.0, 1)::float AS oldest_h,
           COUNT(*) FILTER (WHERE b.rejected_at IS NOT NULL)::int AS rejected,
           string_agg(DISTINCT b.reject_reason, '; ') FILTER (WHERE b.rejected_at IS NOT NULL) AS reject_reasons,
           array_agg(b.code ORDER BY b.created_at) AS codes
      FROM packing_boxes b
     WHERE ${UNIT_SQL} AND b.voided_at IS NULL AND b.received_at IS NULL
       AND ($1::int IS NULL OR b.factory_id = $1)
       AND ($2::text IS NULL OR LOWER(b.table_id) = LOWER($2))
     GROUP BY 1, 2, 3, 4
     ORDER BY MIN(b.created_at)
     LIMIT 300`, [fid, station || null]);
  return r.rows;
}

async function waitingCount(db, station, fid = serverFactoryId()) {
  try {
    const r = await db.query(`
      SELECT COUNT(*)::int AS n FROM packing_boxes b
       WHERE ${UNIT_SQL} AND b.voided_at IS NULL AND b.received_at IS NULL
         AND LOWER(b.table_id) = LOWER($1) AND ($2::int IS NULL OR b.factory_id = $2)`, [station, fid]);
    return r.rows[0].n;
  } catch (_) { return 0; }
}

async function findLabel(db, code, fid) {
  const r = await db.query(`
    SELECT b.*, h.slip_no AS received_slip FROM packing_boxes b
      LEFT JOIN packing_handovers h ON h.sync_id = b.handover_sync_id
     WHERE UPPER(b.code) = UPPER($1) AND ($2::int IS NULL OR b.factory_id = $2)
     ORDER BY b.id DESC LIMIT 1`, [code, fid]);
  return r.rows[0] || null;
}

function registerPackingHandoverRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureHandoverSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing handover] schema ensure failed:', err.message));

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
    const r = await pool.query(`${SLIP_SQL} WHERE h.id = $1 AND h.factory_id IS NOT DISTINCT FROM $2`, [id, fid]);
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

  app.get('/api/packing/handover/summary', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const user = userOf(req);
      const open = await pool.query(
        `${SLIP_SQL} WHERE h.status = 'OPEN' AND h.factory_id IS NOT DISTINCT FROM $1 ORDER BY (h.opened_by = $2) DESC, h.id DESC`, [fid, user]);
      const mine = open.rows.find(s => s.opened_by === user) || null;
      const recent = await pool.query(
        `${SLIP_SQL} WHERE h.status = 'CLOSED' AND h.factory_id IS NOT DISTINCT FROM $1 ORDER BY h.closed_at DESC LIMIT 15`, [fid]);
      res.json({
        ok: true,
        data: {
          slip: mine ? { ...mine, ...(await slipLines(pool, mine)) } : null,
          other_open: open.rows.filter(s => !mine || s.id !== mine.id),
          waiting: await waitingList(pool, fid),
          recent: recent.rows,
          wait_alert_hours: WAIT_ALERT_HOURS
        }
      });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/handover/slips', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const user = userOf(req);
      const slip = await inTx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing_handover_${fid || 0}`]);
        const mine = await db.query(
          `SELECT id FROM packing_handovers WHERE status = 'OPEN' AND factory_id IS NOT DISTINCT FROM $1 AND opened_by = $2 LIMIT 1`, [fid, user]);
        if (mine.rows.length) return { id: mine.rows[0].id, existing: true };
        const m = await db.query('SELECT COALESCE(MAX(seq), 0)::int AS m FROM packing_handovers WHERE factory_id IS NOT DISTINCT FROM $1', [fid]);
        const seq = m.rows[0].m + 1;
        const r = await db.query(
          `INSERT INTO packing_handovers (factory_id, seq, slip_no, opened_by) VALUES ($1, $2, $3, $4) RETURNING id`,
          [fid, seq, slipNo(fid, seq), user]);
        return { id: r.rows[0].id, existing: false };
      });
      res.json({ ok: true, data: { ...(await loadSlip(slip.id, fid)), existing: slip.existing } });
    } catch (err) { sendServerError(res, err); }
  });

  app.get('/api/packing/handover/slips/:id', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const slip = await loadSlip(parseInt(req.params.id, 10), factoryOf(req));
      if (!slip) return bad(res, 404, 'Slip not found.');
      res.json({ ok: true, data: { ...slip, ...(await slipLines(pool, slip)) } });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/handover/slips/:id/scan', async (req, res) => {
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
        const why = refusal(box, box && box.received_slip);
        if (why) return { refused: why, box };
        await db.query(
          `UPDATE packing_boxes SET received_at = NOW(), received_by = $2, handover_sync_id = $3,
                  rejected_at = NULL, rejected_by = NULL, reject_reason = NULL, updated_at = NOW() WHERE id = $1`,
          [box.id, userOf(req), slip.sync_id]);
        const totals = await slipTotals(db, slip);
        return { box, totals };
      });
      if (result.refused) {
        return res.status(409).json({ ok: false, error: result.refused, code, label: result.box ? { item_name: result.box.item_name, kind: result.box.kind } : null });
      }
      const b = result.box;
      res.json({ ok: true, data: { code: b.code, kind: b.kind, qty: b.qty, item_name: b.item_name, job_card_no: b.job_card_no, was_rejected: Boolean(b.rejected_at), ...result.totals } });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/handover/slips/:id/undo', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const slip = await loadSlip(parseInt(req.params.id, 10), fid);
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status !== 'OPEN') return bad(res, 400, 'This slip is closed.');
      const out = await inTx(async (db) => {
        const last = await db.query(
          `SELECT id, code FROM packing_boxes WHERE handover_sync_id = $1 ORDER BY received_at DESC, id DESC LIMIT 1`, [slip.sync_id]);
        if (!last.rows.length) return null;
        await db.query(
          `UPDATE packing_boxes SET received_at = NULL, received_by = NULL, handover_sync_id = NULL, updated_at = NOW() WHERE id = $1`, [last.rows[0].id]);
        await slipTotals(db, slip);
        return last.rows[0].code;
      });
      if (!out) return bad(res, 400, 'Nothing scanned on this slip yet.');
      res.json({ ok: true, data: { code: out } });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/handover/slips/:id/close', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const slip = await loadSlip(parseInt(req.params.id, 10), fid);
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status !== 'OPEN') return res.json({ ok: true, already: true });
      const totals = await slipTotals(pool, slip);
      if (!totals.cartons) return bad(res, 400, 'Scan at least one carton before closing the slip.');
      await pool.query(
        `UPDATE packing_handovers SET status = 'CLOSED', closed_by = $2, closed_at = NOW(), updated_at = NOW() WHERE id = $1`, [slip.id, userOf(req)]);
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/handover/slips/:id/reopen', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const reason = clean(req.body && req.body.reason, 200);
      const pin = String((req.body && req.body.pin) || '').trim();
      if (reason.length < 3) return bad(res, 400, 'Give a reason to reopen the slip.');
      const slip = await loadSlip(parseInt(req.params.id, 10), fid);
      if (!slip) return bad(res, 404, 'Slip not found.');
      if (slip.status === 'OPEN') return res.json({ ok: true, already: true });
      const now = Date.now();
      const tries = (reopenTries.get(slip.id) || []).filter(t => now - t < 60e3);
      if (tries.length >= 5) return bad(res, 429, 'Too many wrong PINs. Wait one minute.');
      const floor = require('./registerPackingFloorRoutes');
      const pins = await pool.query('SELECT * FROM packing_supervisor_pins WHERE is_active AND factory_id IS NOT DISTINCT FROM $1', [fid]);
      if (!pins.rows.length) return bad(res, 400, 'No supervisor PIN is set for this factory. Set one in Packing Settings.');
      const who = /^\d{4,6}$/.test(pin) ? pins.rows.find(p => floor.pinMatches(pin, p)) : null;
      if (!who) { tries.push(now); reopenTries.set(slip.id, tries); return bad(res, 403, 'Wrong supervisor PIN.'); }
      reopenTries.delete(slip.id);
      await pool.query(
        `UPDATE packing_handovers SET status = 'OPEN', closed_at = NULL, closed_by = NULL, reopen_count = reopen_count + 1,
                last_reopen_reason = $2, last_reopen_by = $3, updated_at = NOW() WHERE id = $1`,
        [slip.id, reason, who.display_name || who.username]);
      res.json({ ok: true, data: { reopened_by: who.display_name || who.username } });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/handover/reject', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const fid = factoryOf(req);
      const code = clean(req.body && req.body.code, 60).toUpperCase();
      const reason = clean(req.body && req.body.reason, 200);
      if (!code) return bad(res, 400, 'Scan or type the label to reject.');
      if (reason.length < 3) return bad(res, 400, 'Give a reason, for example damaged or short count.');
      const box = await findLabel(pool, code, fid);
      if (box && box.received_at) return bad(res, 409, `Already received on slip ${box.received_slip || ''}. Undo it from the slip first.`);
      const why = refusal(box, null);
      if (why) return bad(res, 409, why);
      await pool.query(
        `UPDATE packing_boxes SET rejected_at = NOW(), rejected_by = $2, reject_reason = $3, updated_at = NOW() WHERE id = $1`,
        [box.id, userOf(req), reason]);
      res.json({ ok: true, data: { code: box.code, item_name: box.item_name } });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = { registerPackingHandoverRoutes, ensureHandoverSchema, refusal, slipNo, waitingCount, UNIT_SQL };
