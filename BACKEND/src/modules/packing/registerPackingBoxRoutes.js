'use strict';

/**
 * Packing boxes and cartons - labels printed from the station screen.
 *
 * A good scan that fills a box (pcs per box from the item packing standard) saves a
 * BOX row; when a carton's worth of boxes is done (boxes per carton) a CARTON row is
 * saved and the boxes get its code. Rows are made with printed_at NULL; the station
 * screen claims and prints them (automatic per station, or a Print button).
 *
 *  - POST /api/packing/boxes/claim          { station } claim unprinted labels to print now
 *  - GET  /api/packing/boxes?plan_id=|station=   box list
 *  - POST /api/packing/boxes/:id/print      first print of one label
 *  - POST /api/packing/boxes/:id/reprint    { reason } - logged in packing_label_reprints
 *  - POST /api/packing/boxes/:id/void       { reason } box not yet in a carton, or a carton
 *  - POST /api/packing/plans/:id/close-box  part box + part carton at the end of a job
 *
 * Opening balance: a job that already had a box's worth packed before box labels began
 * (or before its item got a pcs per box) gets one OPENING row for those pieces, so no
 * back-dated labels are made for them. OPENING rows are never printed or listed.
 *
 * Box codes: PK<factory|M>-<plan id>-B<nnn> / -C<nnn>; numbers never repeat in a plan
 * (voided ones included). Both tables replicate LOCAL -> MAIN by sync_id; plan_id is
 * re-pointed from plan_sync_id after each pull.
 */

const { getRequestUsername } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');
const { normalizeFactoryId } = require('../../app/requestContext');

const isLocalServer = () => String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL';
const serverFactoryId = () => (isLocalServer() ? normalizeFactoryId(process.env.LOCAL_FACTORY_ID) : null);
const KEY_SQL = (col) => `UPPER(REGEXP_REPLACE(TRIM(COALESCE(${col}, '')), '^0+(?=.)', ''))`;
const MAX_NEW_PER_SCAN = 50;

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function ensurePackingBoxSchema(pool) {
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('packing_box_schema'));
    CREATE TABLE IF NOT EXISTS packing_boxes (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'BOX',
      code TEXT NOT NULL,
      seq_no INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      box_count INTEGER,
      is_part BOOLEAN NOT NULL DEFAULT FALSE,
      plan_id INTEGER,
      plan_sync_id UUID,
      table_id TEXT NOT NULL DEFAULT '',
      item_name TEXT NOT NULL DEFAULT '',
      item_code TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '',
      job_card_no TEXT NOT NULL DEFAULT '',
      carton_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      printed_at TIMESTAMPTZ,
      printed_by TEXT,
      reprint_count INTEGER NOT NULL DEFAULT 0,
      voided_at TIMESTAMPTZ,
      voided_by TEXT,
      void_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_id UUID NOT NULL DEFAULT gen_random_uuid()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_boxes ON packing_boxes (sync_id);
    ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS boxes_per_carton INTEGER;
    ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS handover_sync_id UUID;
    ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS received_by TEXT;
    ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
    ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS rejected_by TEXT;
    ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS reject_reason TEXT;
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_handover ON packing_boxes (handover_sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_waiting ON packing_boxes (factory_id, created_at) WHERE received_at IS NULL AND voided_at IS NULL;
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_plan ON packing_boxes (plan_id, kind, seq_no);
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_unprinted ON packing_boxes (LOWER(table_id)) WHERE printed_at IS NULL AND voided_at IS NULL;
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_code ON packing_boxes (code);
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_created ON packing_boxes (created_at);
    CREATE INDEX IF NOT EXISTS ix_packing_boxes_updated ON packing_boxes (updated_at);
    CREATE TABLE IF NOT EXISTS packing_label_reprints (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER,
      box_sync_id UUID,
      code TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'BOX',
      table_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      reprinted_by TEXT,
      reprinted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_id UUID NOT NULL DEFAULT gen_random_uuid()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_packing_label_reprints ON packing_label_reprints (sync_id);
    CREATE INDEX IF NOT EXISTS ix_packing_label_reprints_at ON packing_label_reprints (reprinted_at);
    CREATE INDEX IF NOT EXISTS ix_packing_label_reprints_updated ON packing_label_reprints (updated_at);
  `);
}

/* Pcs per box, boxes per carton and item code for a plan, from the item packing standard via its job card. */
async function boxStandard(db, plan) {
  const jc = clean(plan && plan.job_card_no, 80);
  if (!jc) return null;
  const hasJr = await db.query(`SELECT to_regclass('public.or_jr_report') AS t`);
  if (!hasJr.rows[0] || !hasJr.rows[0].t) return null;
  const r = await db.query(`
    SELECT jr.item_code, s.pcs_per_box, s.boxes_per_carton
      FROM (SELECT j.item_code FROM or_jr_report j
             WHERE (UPPER(TRIM(j.job_card_no)) = UPPER($1) OR UPPER(TRIM(j.or_jr_no)) = UPPER($1))
               AND COALESCE(j.is_deleted, FALSE) = FALSE LIMIT 1) jr
      LEFT JOIN LATERAL (
        SELECT s.pcs_per_box, s.boxes_per_carton FROM packing_item_standards s
         WHERE s.is_active AND s.item_key = ${KEY_SQL('jr.item_code')} AND s.pcs_per_box > 0
         ORDER BY (LOWER(s.party_group) = LOWER($2)) DESC, (LOWER(s.station_name) = LOWER($3)) DESC
         LIMIT 1
      ) s ON TRUE`, [jc, clean(plan.client_name, 120), clean(plan.table_id, 80)]);
  const row = r.rows[0];
  if (!row || !(Number(row.pcs_per_box) > 0)) return null;
  return {
    item_code: row.item_code || '',
    pcs_per_box: Math.round(Number(row.pcs_per_box)),
    boxes_per_carton: Number(row.boxes_per_carton) > 0 ? Math.round(Number(row.boxes_per_carton)) : 0
  };
}

const codeFor = (fid, planId, kind, seq) => `PK${fid || 'M'}-${planId}-${kind === 'CARTON' ? 'C' : 'B'}${String(seq).padStart(3, '0')}`;

async function planBoxTotals(db, planId) {
  const r = await db.query(`
    SELECT COALESCE(SUM(qty) FILTER (WHERE kind IN ('BOX', 'OPENING') AND voided_at IS NULL), 0)::int AS boxed,
           COUNT(*)::int AS all_rows,
           COUNT(*) FILTER (WHERE kind = 'BOX' AND voided_at IS NULL)::int AS boxes,
           COUNT(*) FILTER (WHERE kind = 'CARTON' AND voided_at IS NULL)::int AS cartons,
           COUNT(*) FILTER (WHERE kind = 'BOX' AND voided_at IS NULL AND carton_code IS NULL)::int AS loose_boxes,
           COALESCE(MAX(seq_no) FILTER (WHERE kind = 'BOX'), 0)::int AS max_box,
           COALESCE(MAX(seq_no) FILTER (WHERE kind = 'CARTON'), 0)::int AS max_carton
      FROM packing_boxes WHERE plan_id = $1`, [planId]);
  return r.rows[0];
}

async function insertRow(db, plan, std, fid, kind, seq, qty, extra = {}) {
  const r = await db.query(`
    INSERT INTO packing_boxes (factory_id, kind, code, seq_no, qty, box_count, is_part, plan_id, plan_sync_id, table_id,
                               item_name, item_code, client_name, job_card_no, created_by, boxes_per_carton)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
    [fid, kind, codeFor(fid, plan.id, kind, seq), seq, qty, extra.box_count || null, Boolean(extra.is_part), plan.id, plan.sync_id || null,
      clean(plan.table_id, 80), clean(plan.item_name, 200), clean(std.item_code, 40), clean(plan.client_name, 120),
      clean(plan.job_card_no, 80), extra.user || null, std.boxes_per_carton || 0]);
  return r.rows[0];
}

async function insertOpening(db, plan, std, fid, qty) {
  await db.query(
    `INSERT INTO packing_boxes (factory_id, kind, code, seq_no, qty, plan_id, plan_sync_id, table_id, item_name, item_code, client_name, job_card_no, printed_at)
     VALUES ($1, 'OPENING', $2, 0, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [fid, `PK${fid || 'M'}-${plan.id}-OPEN`, qty, plan.id, plan.sync_id || null, clean(plan.table_id, 80),
      clean(plan.item_name, 200), clean(std.item_code, 40), clean(plan.client_name, 120), clean(plan.job_card_no, 80)]);
}

/* Put loose boxes into cartons: full cartons only, or every loose box when `closeAll`. */
async function makeCartons(db, plan, std, fid, totals, closeAll, user) {
  const out = [];
  if (!std.boxes_per_carton) return out;
  const loose = await db.query(
    `SELECT id, code, qty FROM packing_boxes
      WHERE plan_id = $1 AND kind = 'BOX' AND voided_at IS NULL AND carton_code IS NULL ORDER BY seq_no`, [plan.id]);
  let rows = loose.rows;
  let seq = totals.max_carton;
  while (rows.length >= std.boxes_per_carton || (closeAll && rows.length)) {
    const take = rows.slice(0, std.boxes_per_carton);
    rows = rows.slice(take.length);
    seq += 1;
    const carton = await insertRow(db, plan, std, fid, 'CARTON', seq, take.reduce((t, b) => t + b.qty, 0),
      { box_count: take.length, is_part: take.length < std.boxes_per_carton, user });
    await db.query('UPDATE packing_boxes SET carton_code = $1, updated_at = NOW() WHERE id = ANY($2::int[])', [carton.code, take.map(b => b.id)]);
    out.push(carton);
    if (out.length >= MAX_NEW_PER_SCAN) break;
  }
  return out;
}

async function withPlanLock(pool, planId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing_box_${planId}`]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

/**
 * Called after a good scan. Saves every box (and carton) the packed qty has filled.
 * Returns the new rows (empty when the item has no pcs per box).
 */
async function afterGoodScan(pool, plan, packedQty) {
  const std = await boxStandard(pool, plan);
  if (!std) return [];
  const fid = serverFactoryId();
  return withPlanLock(pool, plan.id, async (db) => {
    const cur = await db.query('SELECT COALESCE(scanned_qty, 0)::int AS q FROM assembly_plans WHERE id = $1', [plan.id]);
    const packed = Math.max(Number(packedQty) || 0, cur.rows[0] ? cur.rows[0].q : 0);
    const totals = await planBoxTotals(db, plan.id);
    const out = [];
    let boxed = totals.boxed;
    let seq = totals.max_box;
    /* first look at this job with a box's worth already packed before this scan: opening balance, no labels */
    const before = packed - 1;
    if (!totals.all_rows && before >= std.pcs_per_box) {
      await insertOpening(db, plan, std, fid, before);
      boxed = before;
    }
    while (packed - boxed >= std.pcs_per_box && out.length < MAX_NEW_PER_SCAN) {
      seq += 1;
      out.push(await insertRow(db, plan, std, fid, 'BOX', seq, std.pcs_per_box));
      boxed += std.pcs_per_box;
    }
    if (out.length || totals.loose_boxes >= (std.boxes_per_carton || Infinity)) {
      out.push(...await makeCartons(db, plan, std, fid, totals, false));
    }
    return out;
  });
}

/* End of a job: the loose pieces become a part box, loose boxes a part carton. */
async function closeOpenBoxes(pool, plan, user) {
  const std = await boxStandard(pool, plan);
  if (!std) return [];
  const fid = serverFactoryId();
  return withPlanLock(pool, plan.id, async (db) => {
    const cur = await db.query('SELECT COALESCE(scanned_qty, 0)::int AS q FROM assembly_plans WHERE id = $1', [plan.id]);
    const packed = cur.rows[0] ? cur.rows[0].q : 0;
    const totals = await planBoxTotals(db, plan.id);
    const out = [];
    let boxedNow = totals.boxed;
    /* no box history (job older than box labels): full boxes' worth becomes the opening balance */
    if (!totals.all_rows && packed >= std.pcs_per_box) {
      boxedNow = packed - (packed % std.pcs_per_box);
      await insertOpening(db, plan, std, fid, boxedNow);
    }
    const loose = packed - boxedNow;
    if (loose > 0) {
      out.push(await insertRow(db, plan, std, fid, 'BOX', totals.max_box + 1, loose, { is_part: loose < std.pcs_per_box, user }));
    }
    out.push(...await makeCartons(db, plan, std, fid, totals, true, user));
    return out;
  });
}

/* What the station screen shows for its current job. */
async function boxState(pool, plan) {
  const std = await boxStandard(pool, plan);
  if (!std) return null;
  const t = await planBoxTotals(pool, plan.id);
  const packed = Number(plan.scanned_qty) || 0;
  const loose = Math.max(0, packed - t.boxed);
  return {
    pcs_per_box: std.pcs_per_box,
    boxes_per_carton: std.boxes_per_carton,
    boxes: t.boxes,
    cartons: t.cartons,
    box_no: t.max_box + 1,
    in_box: loose,
    carton_no: t.max_carton + 1,
    in_carton: t.loose_boxes,
    boxes_planned: Math.ceil((Number(plan.plan_qty) || 0) / std.pcs_per_box)
  };
}

const LABEL_SQL = `
  SELECT b.id, b.kind, b.code, b.seq_no, b.qty, b.box_count, b.is_part, b.plan_id, b.table_id, b.item_name, b.item_code,
         b.client_name, b.job_card_no, b.carton_code, b.reprint_count, b.voided_at IS NOT NULL AS voided, b.void_reason,
         b.printed_at IS NOT NULL AS printed,
         to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS made_at,
         CASE WHEN b.kind = 'CARTON' THEN (SELECT MIN(c.code) || ' – ' || MAX(c.code) FROM packing_boxes c
                                             WHERE c.carton_code = b.code AND c.plan_id = b.plan_id AND c.voided_at IS NULL) END AS box_range
    FROM packing_boxes b`;
const LISTED = `b.kind IN ('BOX', 'CARTON')`;

async function recentLabels(pool, station, limit = 12) {
  const r = await pool.query(`${LABEL_SQL} WHERE ${LISTED} AND LOWER(b.table_id) = LOWER($1) ORDER BY b.created_at DESC, b.id DESC LIMIT $2`, [station, limit]);
  return r.rows;
}

async function pendingCount(pool, station) {
  const r = await pool.query(
    'SELECT COUNT(*)::int AS n FROM packing_boxes WHERE LOWER(table_id) = LOWER($1) AND printed_at IS NULL AND voided_at IS NULL', [station]);
  return r.rows[0].n;
}

function registerPackingBoxRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensurePackingBoxSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  ensureTables().catch(err => console.warn('[Packing boxes] schema ensure failed:', err.message));

  const userOf = (req) => (req.auth && req.auth.username) || getRequestUsername(req) || '';
  function requireUser(req, res) {
    if (req.auth || getRequestUsername(req)) return true;
    res.status(401).json({ ok: false, error: 'Please log in again.' });
    return false;
  }
  const idOf = (req) => parseInt(req.params.id, 10);

  /* Claim unprinted labels of a station (oldest first) so one screen prints each once. */
  app.post('/api/packing/boxes/claim', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const station = clean(req.body && req.body.station, 80);
      if (!station) return res.status(400).json({ ok: false, error: 'Station missing.' });
      const r = await pool.query(`
        UPDATE packing_boxes SET printed_at = NOW(), printed_by = $2, updated_at = NOW()
         WHERE id IN (SELECT id FROM packing_boxes
                       WHERE LOWER(table_id) = LOWER($1) AND printed_at IS NULL AND voided_at IS NULL
                       ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING id`, [station, userOf(req)]);
      const ids = r.rows.map(x => x.id);
      const labels = ids.length ? (await pool.query(`${LABEL_SQL} WHERE b.id = ANY($1::int[]) ORDER BY b.kind DESC, b.id`, [ids])).rows : [];
      res.json({ ok: true, data: labels });
    } catch (err) { sendServerError(res, err); }
  });

  app.get('/api/packing/boxes', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const planId = parseInt(req.query.plan_id, 10);
      const station = clean(req.query.station, 80);
      if (!planId && !station) return res.status(400).json({ ok: false, error: 'Pick a job or a station.' });
      const r = planId
        ? await pool.query(`${LABEL_SQL} WHERE ${LISTED} AND b.plan_id = $1 ORDER BY b.kind, b.seq_no DESC LIMIT 500`, [planId])
        : await pool.query(`${LABEL_SQL} WHERE ${LISTED} AND LOWER(b.table_id) = LOWER($1) ORDER BY b.created_at DESC LIMIT 200`, [station]);
      res.json({ ok: true, data: r.rows });
    } catch (err) { sendServerError(res, err); }
  });

  async function loadBox(id) {
    const r = await pool.query('SELECT * FROM packing_boxes WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  async function labelOf(id) {
    return (await pool.query(`${LABEL_SQL} WHERE b.id = $1`, [id])).rows[0];
  }

  app.post('/api/packing/boxes/:id/print', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const box = await loadBox(idOf(req));
      if (!box || box.kind === 'OPENING') return res.status(404).json({ ok: false, error: 'Label not found.' });
      if (box.voided_at) return res.status(400).json({ ok: false, error: 'This label was voided.' });
      if (box.printed_at) return res.status(409).json({ ok: false, error: 'Already printed. Use Reprint and give a reason.' });
      await pool.query('UPDATE packing_boxes SET printed_at = NOW(), printed_by = $2, updated_at = NOW() WHERE id = $1 AND printed_at IS NULL', [box.id, userOf(req)]);
      res.json({ ok: true, data: await labelOf(box.id) });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/boxes/:id/reprint', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const reason = clean(req.body && req.body.reason, 200);
      if (reason.length < 3) return res.status(400).json({ ok: false, error: 'Give a reason for the reprint.' });
      const box = await loadBox(idOf(req));
      if (!box || box.kind === 'OPENING') return res.status(404).json({ ok: false, error: 'Label not found.' });
      if (box.voided_at) return res.status(400).json({ ok: false, error: 'This label was voided.' });
      await pool.query(
        `INSERT INTO packing_label_reprints (factory_id, box_sync_id, code, kind, table_id, reason, reprinted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [box.factory_id, box.sync_id, box.code, box.kind, box.table_id, reason, userOf(req)]);
      await pool.query(
        `UPDATE packing_boxes SET reprint_count = reprint_count + 1, printed_at = COALESCE(printed_at, NOW()),
                printed_by = COALESCE(printed_by, $2), updated_at = NOW() WHERE id = $1`, [box.id, userOf(req)]);
      res.json({ ok: true, data: await labelOf(box.id) });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/boxes/:id/void', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const reason = clean(req.body && req.body.reason, 200);
      if (reason.length < 3) return res.status(400).json({ ok: false, error: 'Give a reason.' });
      const box = await loadBox(idOf(req));
      if (!box || box.kind === 'OPENING') return res.status(404).json({ ok: false, error: 'Label not found.' });
      if (box.voided_at) return res.json({ ok: true, already: true });
      if (box.kind === 'BOX' && box.carton_code) {
        return res.status(400).json({ ok: false, error: `This box is in carton ${box.carton_code}. Void the carton first.` });
      }
      await withPlanLock(pool, box.plan_id || 0, async (db) => {
        await db.query(
          `UPDATE packing_boxes SET voided_at = NOW(), voided_by = $2, void_reason = $3, updated_at = NOW() WHERE id = $1`,
          [box.id, userOf(req), reason]);
        if (box.kind === 'CARTON') {
          await db.query(
            `UPDATE packing_boxes SET carton_code = NULL, updated_at = NOW()
              WHERE carton_code = $1 AND plan_id IS NOT DISTINCT FROM $2 AND kind = 'BOX'`, [box.code, box.plan_id]);
        }
      });
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/packing/plans/:id/close-box', async (req, res) => {
    try {
      if (!requireUser(req, res)) return;
      await ensureTables();
      const r = await pool.query('SELECT * FROM assembly_plans WHERE id = $1', [idOf(req)]);
      const plan = r.rows[0];
      if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found.' });
      const made = await closeOpenBoxes(pool, plan, userOf(req));
      res.json({ ok: true, data: made });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = {
  registerPackingBoxRoutes,
  ensurePackingBoxSchema,
  afterGoodScan,
  closeOpenBoxes,
  boxState,
  boxStandard,
  recentLabels,
  pendingCount,
  codeFor
};
