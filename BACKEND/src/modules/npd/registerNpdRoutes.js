'use strict';

/**
 * NPD Tracker - PUBLIC/npd.html.
 *
 * New Product Development tracking sheet: one row per new product, one cell
 * per launch stage (mould received -> trials -> QC -> packing -> ERP -> mass
 * production -> price -> launch). Each stage cell is Pending / In Progress /
 * Complete / N/A; a few stages are dates. Every product carries an overall
 * status (Hold / Launched / Delayed / On Schedule / Cancelled), remarks, the
 * trial reports and the product photos taken after the trial.
 *
 * Everyone who can open the page can view. Admin / superadmin edit every
 * stage; only superadmin deletes products and child moulds. PPC managers add
 * products and child moulds, set name / status / remarks and upload files.
 * Sales Co-ordinator only adds products and child moulds.
 * Department roles (DEPT_ROLES) edit only their department's stages
 * (STAGES[].depts), on products and child moulds alike.
 *
 * Every new product needs at least one child mould. Products and moulds carry
 * a product code; the colours for trials are picked by HO (admin). Marking
 * "Final mould received" complete also records who received the mould.
 *
 * A product can have child moulds: rows with parent_sync_id = the product's
 * sync_id, tracked through the same stages and shown under their product.
 * Every stage change needs a remark; stage_info[key] keeps the latest remark,
 * who changed it and when, and the date the stage was completed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { getRequestUsername } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');

/* Admin / superadmin edit everything. Only superadmin deletes products / moulds.
   PPC managers also run the sheet itself (add products and moulds, name,
   status, remarks, files). */
const ADMIN_ROLES = new Set(['admin', 'superadmin']);
const SHEET_ROLES = new Set(['ppcassmanager', 'ppcmanager', 'srppcmanager']);
/* Sales Co-ordinator only adds new products and child moulds (no stage, status,
   remarks, file or delete rights). Matched loosely: 'sales_coordinator',
   'Sales Co-ordinator', 'Sales Coord.' all normalise to contain 'salescoord'. */
const ADD_ONLY_ROLE = /salescoord/;

/* Department roles, matched on the role code or its label with everything but
   letters / digits removed (so 'sr__ppc_manager' and 'Sr. PPC Manager' are the
   same); a RegExp entry matches any role containing it (Purchase roles are
   created in Settings with varying names). Production (printing / tufting) is
   run by Moulding; W/H is the Dispatch Manager. HO stages are admin only. */
const DEPT_ROLES = {
  'Tool Room': ['toolroommanager'],
  Moulding: ['mouldingmanager'],
  Planning: ['srppcmanager', 'ppcmanager', 'ppcassmanager'],
  QC: ['quality', 'qchod', 'qualityassmanager', 'qualityasstmanager', 'qcassmanager'],
  Packing: ['packingmanager'],
  Purchase: [/purchase/],
  Production: ['mouldingmanager'],
  'W/H': ['dispatchmanager']
};
const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const userKeys = u => [norm(u && u.role_code), norm(u && u.role_label)].filter(Boolean);
function roleDepts(u) {
  const keys = userKeys(u);
  return Object.keys(DEPT_ROLES).filter(d => DEPT_ROLES[d].some(k =>
    k instanceof RegExp ? keys.some(x => k.test(x)) : keys.includes(k)));
}

/* Columns of the NPD tracking sheet, in sheet order. type 'status' cells hold a
   stage state, type 'date' cells hold a YYYY-MM-DD date. Keep in sync with npd.html. */
const STAGES = [
  { key: 'mould_received', level: 'mould', type: 'status', group: 'Mould & Trial', label: 'Final mould received @ factory (Tool Room)', depts: ['Tool Room'] },
  { key: 'mould_trials', level: 'mould', type: 'status', group: 'Mould & Trial', label: 'Product mould final trials @ factory (Moulding)', depts: ['Moulding'] },
  { key: 'rm_colour', level: 'mould', type: 'status', group: 'Mould & Trial', label: 'RM & colour finalization (Planning / Moulding)', depts: ['Planning', 'Moulding'] },
  { key: 'samples_ho', level: 'product', type: 'status', group: 'Mould & Trial', label: 'Final samples sent to HO for approval & photo shoot (QC)', depts: ['QC'] },
  { key: 'sample_approval_ho', level: 'product', type: 'status', group: 'Mould & Trial', label: 'Final sample approval from HO (HO)', depts: ['HO'] },
  { key: 'pilot_drop_test', level: 'mould', type: 'status', group: 'Mould & Trial', label: 'Pilot run & drop test @ factory (Moulding / QC)', depts: ['Moulding', 'QC'] },
  { key: 'qc_approval_ho', level: 'mould', type: 'status', group: 'Mould & Trial', label: 'Final QC approved after testing (QC)', depts: ['QC'] },
  { key: 'packing_material', level: 'product', type: 'status', group: 'Packing, BOM & ERP', label: 'Packing material finalization (Packing)', depts: ['Packing'] },
  { key: 'bom_approval', level: 'product', type: 'status', group: 'Packing, BOM & ERP', label: 'Product BOM finalization / approval (Planning)', depts: ['Planning'] },
  { key: 'packing_receiving', level: 'product', type: 'status', group: 'Packing, BOM & ERP', label: 'Packing material follow up & receiving @ factory (Purchase)', depts: ['Purchase'] },
  { key: 'or_jr_erp', level: 'product', type: 'status', group: 'Packing, BOM & ERP', label: 'OR making in ERP by H.O (HO)', depts: ['HO'] },
  { key: 'or_jr_erp_wh', level: 'product', type: 'status', group: 'Packing, BOM & ERP', label: 'OR - JR making in ERP by Warehouse (W/H)', depts: ['W/H'] },
  { key: 'production_planning', level: 'product', type: 'status', group: 'Packing, BOM & ERP', label: 'Production planning as per OR-JR ERP (Planning)', depts: ['Planning'] },
  { key: 'jc_start_date', level: 'mould', type: 'date', group: 'Packing, BOM & ERP', label: 'Planned job card start date (Planning)', depts: ['Planning'] },
  { key: 'jc_end_date', level: 'mould', type: 'date', group: 'Packing, BOM & ERP', label: 'Planned job card completion date (Planning)', depts: ['Planning'] },
  { key: 'launch_date', level: 'product', type: 'date', group: 'Packing, BOM & ERP', label: 'Launch date finalization by Planning (Planning)', depts: ['Planning'] },
  { key: 'launch_date_ho', level: 'product', type: 'date', group: 'Packing, BOM & ERP', label: 'Launch date by H.O (HO)', depts: ['HO'] },
  { key: 'mass_moulding', level: 'mould', type: 'status', group: 'Mass Production', label: 'Mass production - moulding (Moulding)', depts: ['Moulding'] },
  { key: 'mass_printing', level: 'product', type: 'status', group: 'Mass Production', label: 'Mass production - printing (Production)', depts: ['Production'] },
  { key: 'mass_tufting', level: 'product', type: 'status', group: 'Mass Production', label: 'Mass production - tufting (Production)', depts: ['Production'] },
  { key: 'mass_packaging', level: 'product', type: 'status', group: 'Mass Production', label: 'Mass production - packing (Packing)', depts: ['Packing'] },
  { key: 'fg_receiving', level: 'product', type: 'status', group: 'Mass Production', label: 'Finish goods receiving (W/H)', depts: ['W/H'] },
  { key: 'ex_factory_cost', level: 'product', type: 'status', group: 'Costing & Launch', label: 'Ex factory cost finalization (Planning)', depts: ['Planning'] },
  { key: 'price_final', level: 'product', type: 'status', group: 'Costing & Launch', label: 'Price finalization (HO)', depts: ['HO'] },
  { key: 'post_card_receiving', level: 'product', type: 'status', group: 'Costing & Launch', label: 'Final post card follow up & receiving by Planning (Planning)', depts: ['Planning'] },
  { key: 'post_card_making_ho', level: 'product', type: 'status', group: 'Costing & Launch', label: 'Post card making by H.O (HO)', depts: ['HO'] },
  { key: 'post_card_posting', level: 'product', type: 'status', group: 'Costing & Launch', label: 'Posting post card in new product launch group (Planning)', depts: ['Planning'] },
  { key: 'dispatch_date', level: 'product', type: 'date', group: 'Costing & Launch', label: 'Actual dispatch date (W/H & Dispatch)', depts: ['W/H'] }
];
/* Excel export: same words and colours as the page (Blue pending, Yellow in
   progress, Green complete, Red N/A) */
const STATE_STYLE = {
  pending: { text: 'Pending', fill: 'FFDBEAFE', font: 'FF1D4ED8' },
  in_progress: { text: 'In Progress', fill: 'FFFEF3C7', font: 'FFA16207' },
  complete: { text: 'Complete', fill: 'FFDCFCE7', font: 'FF15803D' },
  na: { text: 'N/A', fill: 'FFFEE2E2', font: 'FFB91C1C' }
};
const STATUS_STYLE = {
  Hold: { fill: 'FFF1F5F9', font: 'FF475569' },
  Launched: { fill: 'FFDCFCE7', font: 'FF15803D' },
  Delayed: { fill: 'FFFEE2E2', font: 'FFB91C1C' },
  'On Schedule': { fill: 'FFDBEAFE', font: 'FF1D4ED8' },
  Cancelled: { fill: 'FFE5E7EB', font: 'FF374151' }
};
/* level: 'mould' stages are worked on each child mould and the product row
   shows their roll-up; 'product' stages are worked once on the product row. */
const STAGE_LEVEL = new Map(STAGES.map(s => [s.key, s.level]));
/* Product-row value of a mould stage, from its child moulds. Status: N/A when
   every mould is N/A, Complete when every mould is Complete or N/A, In Progress
   once any mould has started, else Pending. Dates: earliest start, latest end. */
function rollupStage(key, moulds) {
  const vals = (moulds || []).map(m => (m.stages || {})[key]);
  if (STAGE_TYPE.get(key) === 'date') {
    const d = vals.filter(isDate).sort();
    if (!d.length) return '';
    return key === 'jc_start_date' ? d[0] : d[d.length - 1];
  }
  const st = vals.map(v => STAGE_STATES.has(v) ? v : 'pending');
  if (!st.length) return 'pending';
  if (st.every(v => v === 'na')) return 'na';
  if (st.every(v => v === 'complete' || v === 'na')) return 'complete';
  if (st.some(v => v !== 'pending')) return 'in_progress';
  return 'pending';
}
const STAGE_TYPE = new Map(STAGES.map(s => [s.key, s.type]));
const STAGE_STATES = new Set(['pending', 'in_progress', 'complete', 'na']);
/* stage whose completion also records who received it */
const RECEIVED_BY_STAGE = 'mould_received';
const PRODUCT_STATUSES = new Set(['', 'Hold', 'Launched', 'Delayed', 'On Schedule', 'Cancelled']);

const isNpdAdmin = u => !!u && ADMIN_ROLES.has(norm(u.role_code));
const isNpdSuperadmin = u => !!u && norm(u.role_code) === 'superadmin';
const canEditSheet = u => isNpdAdmin(u) || (!!u && userKeys(u).some(k => SHEET_ROLES.has(k)));
const canAddItems = u => canEditSheet(u) || (!!u && userKeys(u).some(k => ADD_ONLY_ROLE.test(k)));
const editableStageKeys = u => {
  if (!u) return [];
  if (isNpdAdmin(u)) return STAGES.map(s => s.key);
  const d = roleDepts(u);
  return STAGES.filter(s => s.depts.some(x => d.includes(x))).map(s => s.key);
};

const uploadRoot = path.join(__dirname, '../../../PUBLIC/uploads/npd');
fs.mkdirSync(uploadRoot, { recursive: true });

const REPORT_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg', '.jpeg', '.png', '.webp']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `npd-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = req.params.kind === 'image' ? IMAGE_EXT : REPORT_EXT;
    cb(null, allowed.has(ext));
  }
});

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const clean = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
/* colours for trials: comma separated, each trimmed, no repeats */
const cleanColours = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
  .map(c => clean(c, 40)).filter(Boolean))].slice(0, 30).join(', ');
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/* Keep only known stage keys with valid values. */
function cleanStages(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input)) {
    const type = STAGE_TYPE.get(k);
    if (type === 'status' && STAGE_STATES.has(v)) out[k] = v;
    else if (type === 'date' && (v === '' || v === null)) out[k] = '';
    else if (type === 'date' && isDate(v)) out[k] = v;
  }
  return out;
}

function removeFile(filePath) {
  const full = path.join(uploadRoot, path.basename(String(filePath || '')));
  fs.promises.unlink(full).catch(() => {});
}

/* NPD replicates between MAIN and every LOCAL (services/sync.service.js), so rows
   are identified by sync_id, never the per-server serial id: a file links to its
   product by product_sync_id. sync.service calls this before its schema sweep so
   the tables exist (with their sync triggers) even where NPD was never opened. */
async function ensureNpdSchema(pool) {
  /* one string = one implicit transaction, so the lock holds until the end and
     several workers starting together don't race on CREATE / ALTER */
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('npd_schema'));
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS npd_products (
      id SERIAL PRIMARY KEY,
      sr_no TEXT,
      product_name TEXT NOT NULL,
      stages JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT '',
      remarks TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS npd_files (
      id SERIAL PRIMARY KEY,
      product_id INTEGER,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE npd_products ADD COLUMN IF NOT EXISTS sync_id UUID DEFAULT gen_random_uuid();
    UPDATE npd_products SET sync_id = gen_random_uuid() WHERE sync_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_npd_products ON npd_products(sync_id);
    ALTER TABLE npd_files ADD COLUMN IF NOT EXISTS sync_id UUID DEFAULT gen_random_uuid();
    ALTER TABLE npd_files ADD COLUMN IF NOT EXISTS product_sync_id UUID;
    ALTER TABLE npd_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    UPDATE npd_files SET sync_id = gen_random_uuid() WHERE sync_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_npd_files ON npd_files(sync_id);
    /* v1.115 linked files by the serial product_id with a cascading FK: fill the
       sync link once, then drop the FK (a file can arrive before its product) */
    UPDATE npd_files f SET product_sync_id = p.sync_id
      FROM npd_products p WHERE f.product_sync_id IS NULL AND f.product_id = p.id;
    ALTER TABLE npd_files DROP CONSTRAINT IF EXISTS npd_files_product_id_fkey;
    ALTER TABLE npd_files ALTER COLUMN product_id DROP NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_npd_files_product_sync ON npd_files(product_sync_id);
    /* child moulds point at their product; stage_info = per stage remark / completion date */
    ALTER TABLE npd_products ADD COLUMN IF NOT EXISTS parent_sync_id UUID;
    ALTER TABLE npd_products ADD COLUMN IF NOT EXISTS stage_info JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_npd_products_parent ON npd_products(parent_sync_id);
    ALTER TABLE npd_products ADD COLUMN IF NOT EXISTS product_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE npd_products ADD COLUMN IF NOT EXISTS trial_colours TEXT NOT NULL DEFAULT '';
      ALTER TABLE npd_products ADD COLUMN IF NOT EXISTS factory TEXT NOT NULL DEFAULT '';

    /* Sr No: MAIN and a LOCAL can both hand out the same next number while apart.
       MAIN decides: a row arriving with a number another product already has gets
       the next free one, and updated_at moves so the new number syncs back out. */
    CREATE OR REPLACE FUNCTION npd_unique_sr_no() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('npd_sr_no'));
      IF NEW.sr_no IS NOT NULL AND EXISTS (
           SELECT 1 FROM npd_products
            WHERE sr_no = NEW.sr_no AND sync_id IS DISTINCT FROM NEW.sync_id) THEN
        NEW.sr_no := (SELECT (COALESCE(MAX(NULLIF(regexp_replace(sr_no, '[^0-9]', '', 'g'), '')::bigint), 0) + 1)::text
                        FROM npd_products);
        NEW.updated_at := NOW();
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_npd_unique_sr_no ON npd_products;
    ${String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL' ? '' : `
    CREATE TRIGGER trg_npd_unique_sr_no BEFORE INSERT OR UPDATE OF sr_no ON npd_products
      FOR EACH ROW EXECUTE FUNCTION npd_unique_sr_no();
    /* duplicates already here: the oldest keeps its number, the others are renumbered */
    UPDATE npd_products p SET sr_no = p.sr_no
     WHERE EXISTS (SELECT 1 FROM npd_products o WHERE o.sr_no = p.sr_no AND o.id < p.id);
    /* A LOCAL pulls only rows changed since its last pull (one watermark for all
       tables), so products made before NPD joined sync never reached it. Mark them
       changed once; every LOCAL then pulls the whole list on its next cycle. */
    CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT);
    DO $$
    BEGIN
      INSERT INTO server_config (key, value) VALUES ('NPD_SYNC_RESEND_V1', NOW()::text);
      UPDATE npd_products SET updated_at = NOW();
      UPDATE npd_files SET updated_at = NOW();
    EXCEPTION WHEN unique_violation THEN NULL; /* already done */
    END $$;`}
  `);
}

/* One-time data move for the Product / Mould split (MAIN only, so it runs once
   and syncs out): the old combined printing / tufting stage is copied to the
   new tufting stage, and every product stage worked on the moulds so far is
   copied up to its product row (roll-up rule) when the product has no value. */
async function migrateNpdLevels(pool) {
  if (String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL') return;
  await pool.query('CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT)');
  const flag = await pool.query(
    `INSERT INTO server_config (key, value) VALUES ('NPD_LEVELS_V1', NOW()::text)
     ON CONFLICT (key) DO NOTHING RETURNING key`);
  if (!flag.rowCount) return;
  await pool.query(`UPDATE npd_products
     SET stages = stages || jsonb_build_object('mass_tufting', stages->'mass_printing'),
         stage_info = CASE WHEN stage_info ? 'mass_printing'
           THEN stage_info || jsonb_build_object('mass_tufting', stage_info->'mass_printing') ELSE stage_info END,
         updated_at = NOW()
   WHERE stages ? 'mass_printing' AND NOT stages ? 'mass_tufting'`);
  const all = (await pool.query('SELECT id, sync_id, parent_sync_id, stages FROM npd_products')).rows;
  const productKeys = STAGES.filter(s => s.level === 'product').map(s => s.key);
  for (const p of all.filter(r => !r.parent_sync_id)) {
    const kids = all.filter(c => String(c.parent_sync_id) === String(p.sync_id));
    const add = {};
    for (const k of productKeys) {
      if ((p.stages || {})[k] !== undefined) continue;
      if (!kids.some(c => (c.stages || {})[k] !== undefined)) continue;
      add[k] = rollupStage(k, kids);
    }
    if (Object.keys(add).length) {
      await pool.query('UPDATE npd_products SET stages = stages || $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(add), p.id]);
    }
  }
}

function registerNpdRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureNpdSchema(pool).then(() => migrateNpdLevels(pool)).catch(err => { ready = null; throw err; });
    return ready;
  }
  /* LOCAL: send the change to MAIN now instead of waiting for the next cycle */
  const pushNow = () => {
    if (String(process.env.SERVER_TYPE || '').toUpperCase() !== 'LOCAL') return;
    try { require('../../../services/sync.service').triggerSync(); } catch (_) { /* sync not loaded */ }
  };

  async function sessionUser(req) {
    const username = getRequestUsername(req);
    if (!username) return null;
    const r = await pool.query(
      `SELECT u.username, u.role_code, r.label AS role_label
         FROM users u LEFT JOIN roles r ON r.code = u.role_code
        WHERE u.username = $1 LIMIT 1`, [username]);
    return r.rows[0] || null;
  }
  const isAdmin = isNpdAdmin;
  const isSuperadmin = isNpdSuperadmin;
  const canEdit = canEditSheet;
  /* stage keys this user may change */
  const editableStages = editableStageKeys;

  async function requireEditor(req, res) {
    const u = await sessionUser(req);
    if (!u) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return null; }
    if (!canEdit(u)) { res.status(403).json({ ok: false, error: 'Only admin and PPC managers can do this in NPD' }); return null; }
    return u;
  }
  async function requireAdder(req, res) {
    const u = await sessionUser(req);
    if (!u) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return null; }
    if (!canAddItems(u)) { res.status(403).json({ ok: false, error: 'Only admin, PPC managers and Sales Co-ordinator can add NPD products' }); return null; }
    return u;
  }

  app.get('/api/npd/products', async (req, res) => {
    try {
      await ensureTables();
      const u = await sessionUser(req);
      const [products, files] = await Promise.all([
        pool.query('SELECT * FROM npd_products ORDER BY id'),
        pool.query('SELECT id, product_sync_id, kind, file_path, original_name, uploaded_by, uploaded_at FROM npd_files ORDER BY uploaded_at, id')
      ]);
      const byProduct = new Map();
      files.rows.forEach(f => {
        const k = String(f.product_sync_id);
        if (!byProduct.has(k)) byProduct.set(k, []);
        byProduct.get(k).push({ ...f, url: `/uploads/npd/${path.basename(f.file_path)}` });
      });
      res.json({
        ok: true,
        can_edit: canEdit(u),
        can_add: canAddItems(u),
        can_delete: isSuperadmin(u),
        can_colours: isAdmin(u),
        editable_stages: editableStages(u),
        departments: u ? (isAdmin(u) ? ['All'] : roleDepts(u)) : [],
        data: products.rows.map(p => ({ ...p, files: byProduct.get(String(p.sync_id)) || [] }))
      });
    } catch (err) { sendServerError(res, err); }
  });

  /* Excel copy of the tracker, colour coded like the page. Takes the page's
     filters: status ('' = all, 'No status' = blank) and q (product / Sr No search). */
  app.get('/api/npd/export.xlsx', async (req, res) => {
    try {
      await ensureTables();
      if (!await sessionUser(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      const status = clean(req.query.status, 40);
      const q = clean(req.query.q, 100).toLowerCase();
      const [products, files] = await Promise.all([
        pool.query('SELECT * FROM npd_products ORDER BY id'),
        pool.query('SELECT product_sync_id, kind, COUNT(*)::int AS n FROM npd_files GROUP BY product_sync_id, kind')
      ]);
      const count = new Map(files.rows.map(f => [`${f.product_sync_id}:${f.kind}`, f.n]));
      const parents = products.rows.filter(p => !p.parent_sync_id).filter(p =>
        (!status || (p.status || 'No status') === status) &&
        (!q || `${p.product_name} ${p.sr_no || ''}`.toLowerCase().includes(q)));
      /* each product followed by its child moulds */
      const rows = parents.flatMap(p => [p, ...products.rows.filter(c => String(c.parent_sync_id) === String(p.sync_id))]);

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'JMS';
      const ws = wb.addWorksheet('NPD Tracker', { views: [{ state: 'frozen', xSplit: 6, ySplit: 3 }] });
      const S0 = 7; /* first stage column */
      const head = ['Sr No', 'Level', 'Product / Mould', 'Factory (HO)', 'Product code', 'Colour details for trials (HO)', ...STAGES.map(s => s.label), 'Status', 'Remarks', 'Trial reports', 'Images', 'Last updated by', 'Last updated'];
      const last = head.length;
      const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } };
      const border = { top: thin, left: thin, bottom: thin, right: thin };
      const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

      ws.mergeCells(1, 1, 1, last);
      const title = ws.getCell(1, 1);
      title.value = `NPD Tracker - exported ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` +
        (status ? ` - status: ${status}` : '') + (q ? ` - search: ${q}` : '');
      title.font = { bold: true, size: 14 };

      /* row 2: stage group bands over their columns */
      for (let c = 0; c < STAGES.length;) {
        let e = c;
        while (e + 1 < STAGES.length && STAGES[e + 1].group === STAGES[c].group) e++;
        ws.mergeCells(2, c + S0, 2, e + S0);
        const g = ws.getCell(2, c + S0);
        g.value = STAGES[c].group.toUpperCase();
        g.font = { bold: true, color: { argb: 'FF334155' } };
        g.alignment = { horizontal: 'center' };
        g.fill = fill('FFE2E8F0');
        c = e + 1;
      }
      const hr = ws.getRow(3);
      hr.values = head;
      hr.height = 60;
      hr.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = fill('FF0F172A');
        c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
        c.border = border;
      });

      rows.forEach(p => {
        const isMould = !!p.parent_sync_id;
        const kids = isMould ? [] : products.rows.filter(c => String(c.parent_sync_id) === String(p.sync_id));
        /* product row: mould stages are the roll-up of its moulds */
        const st = { ...(p.stages || {}) };
        if (!isMould) STAGES.forEach(s => { if (s.level === 'mould') st[s.key] = rollupStage(s.key, kids); });
        const info = p.stage_info || {};
        /* stage that does not belong to this row's level: left blank and greyed */
        const off = s => s.level !== (isMould ? 'mould' : 'product');
        const vals = [/^\d+$/.test(p.sr_no || '') ? Number(p.sr_no) : (p.sr_no || ''), isMould ? 'Mould' : 'Product',
          p.parent_sync_id ? `   ↳ Mould: ${p.product_name}` : p.product_name, p.factory || '', p.product_code || '', p.trial_colours || ''];
        STAGES.forEach(s => {
          const v = st[s.key];
          if (off(s)) vals.push(null);
          else if (s.type === 'date') vals.push(v ? new Date(v + 'T00:00:00Z') : null);
          else {
            const done = v === 'complete' && info[s.key] && info[s.key].completed_on;
            const rb = s.key === RECEIVED_BY_STAGE && v === 'complete' && info[s.key] && info[s.key].received_by;
            vals.push((STATE_STYLE[v] || STATE_STYLE.pending).text + (done ? ` (${done})` : '') + (rb ? ` - by ${rb}` : ''));
          }
        });
        vals.push(p.status || '', p.remarks || '', count.get(`${p.sync_id}:report`) || 0, count.get(`${p.sync_id}:image`) || 0,
          p.updated_by || '', p.updated_at ? new Date(p.updated_at) : null);
        const r = ws.addRow(vals);
        r.eachCell({ includeEmpty: true }, (c, col) => {
          c.border = border;
          c.alignment = { vertical: 'middle', wrapText: col === 3 || col === 6 || col === STAGES.length + S0 + 1 };
          const s = STAGES[col - S0];
          if (s && off(s)) {
            c.fill = fill('FFE5E7EB');
          } else if (s && s.type === 'status') {
            const k = STATE_STYLE[st[s.key]] || STATE_STYLE.pending;
            c.fill = fill(k.fill);
            c.font = { bold: true, color: { argb: k.font } };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (s) {
            c.numFmt = 'dd-mmm-yy';
            c.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
        STAGES.forEach((s, i) => {
          if (off(s)) return;
          const rm = (p.stage_info || {})[s.key];
          if (rm && rm.remarks) r.getCell(i + S0).note = `${rm.remarks}${rm.by ? ` - ${rm.by}` : ''}`;
        });
        r.getCell(3).font = { bold: !p.parent_sync_id, italic: !!p.parent_sync_id };
        const ps = STATUS_STYLE[p.status];
        if (ps) {
          const c = r.getCell(STAGES.length + S0);
          c.fill = fill(ps.fill);
          c.font = { bold: true, color: { argb: ps.font } };
        }
        r.getCell(last).numFmt = 'dd-mmm-yy hh:mm';
      });

      ws.getColumn(1).width = 7;
      ws.getColumn(2).width = 10;
      ws.getColumn(3).width = 34;
      ws.getColumn(4).width = 14;
      ws.getColumn(5).width = 16;
      ws.getColumn(6).width = 22;
      STAGES.forEach((s, i) => { ws.getColumn(i + S0).width = s.type === 'date' ? 13 : 15; });
      ws.getColumn(STAGES.length + S0).width = 14;
      ws.getColumn(STAGES.length + S0 + 1).width = 40;
      [STAGES.length + S0 + 2, STAGES.length + S0 + 3].forEach(c => { ws.getColumn(c).width = 10; });
      ws.getColumn(last - 1).width = 16;
      ws.getColumn(last).width = 17;
      if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: last } };

      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="NPD_Tracker_${day}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/npd/products', async (req, res) => {
    try {
      await ensureTables();
      const u = await requireAdder(req, res);
      if (!u) return;
      const name = clean(req.body?.product_name, 300);
      if (!name) return res.status(400).json({ ok: false, error: 'Product name is required' });
      const status = clean(req.body?.status, 40);
      const code = clean(req.body?.product_code, 60);
      /* child mould of an existing product: no Sr No of its own */
      const parentId = parseInt(req.body?.parent_id, 10);
      if (parentId) {
        const par = await pool.query('SELECT sync_id, parent_sync_id FROM npd_products WHERE id = $1', [parentId]);
        if (!par.rows.length || par.rows[0].parent_sync_id) return res.status(400).json({ ok: false, error: 'Parent product not found' });
        const c = await pool.query(
          `INSERT INTO npd_products (sr_no, product_name, product_code, parent_sync_id, created_by, updated_by)
           VALUES (NULL, $1, $2, $3, $4, $4) RETURNING *`, [name, code, par.rows[0].sync_id, u.username]);
        pushNow();
        return res.json({ ok: true, data: { ...c.rows[0], files: [] } });
      }
      /* a new product needs at least one child mould: [{ name, code }] (plain names still accepted) */
      const moulds = (Array.isArray(req.body?.moulds) ? req.body.moulds : [])
        .map(m => (m && typeof m === 'object') ? { name: clean(m.name, 300), code: clean(m.code, 60) } : { name: clean(m, 300), code: '' })
        .filter(m => m.name).slice(0, 50);
      if (!moulds.length) return res.status(400).json({ ok: false, error: 'Add at least one child mould - a product cannot be created without a mould' });
      /* Sr No is automatic: one more than the highest number used so far. */
      const r = await pool.query(
        `INSERT INTO npd_products (sr_no, product_name, product_code, trial_colours, stages, status, remarks, created_by, updated_by)
         VALUES ((SELECT (COALESCE(MAX(NULLIF(regexp_replace(sr_no, '[^0-9]', '', 'g'), '')::bigint), 0) + 1)::text
                    FROM npd_products),
                 $1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
        [name, code, isAdmin(u) ? cleanColours(req.body?.trial_colours) : '', JSON.stringify(cleanStages(req.body?.stages)),
          PRODUCT_STATUSES.has(status) ? status : '', clean(req.body?.remarks, 2000), u.username]
      );
      const out = [{ ...r.rows[0], files: [] }];
      for (const m of moulds) {
        const c = await pool.query(
          `INSERT INTO npd_products (sr_no, product_name, product_code, parent_sync_id, created_by, updated_by)
           VALUES (NULL, $1, $2, $3, $4, $4) RETURNING *`, [m.name, m.code, r.rows[0].sync_id, u.username]);
        out.push({ ...c.rows[0], files: [] });
      }
      pushNow();
      res.json({ ok: true, data: out[0], children: out.slice(1) });
    } catch (err) { sendServerError(res, err); }
  });

  /* Partial update: any of product_name, product_code, status, remarks,
     trial_colours (admin = HO only), stages (merged).
     Sheet owners may send anything; department users only stages of their
     department. Every stage in the body needs a remark in stage_remarks. */
  app.put('/api/npd/products/:id', async (req, res) => {
    try {
      await ensureTables();
      const u = await sessionUser(req);
      if (!u) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      const id = parseInt(req.params.id, 10);
      const b = req.body || {};
      const owner = canEdit(u);
      if (!owner && (b.product_name !== undefined || b.product_code !== undefined || b.status !== undefined || b.remarks !== undefined)) {
        return res.status(403).json({ ok: false, error: 'Only admin and PPC managers can change product name, code, status or remarks' });
      }
      if (b.factory !== undefined && !isAdmin(u)) {
        return res.status(403).json({ ok: false, error: 'Only H.O (admin) can set the factory' });
      }
      if (b.trial_colours !== undefined && !isAdmin(u)) {
        return res.status(403).json({ ok: false, error: 'Only H.O (admin) can set the colours for trials' });
      }
      let stageInfo = null;
      if (b.stages !== undefined) {
        const allowed = new Set(editableStages(u));
        const keys = Object.keys(b.stages || {});
        if (!keys.length) return res.status(400).json({ ok: false, error: 'Nothing to update' });
        const denied = keys.find(k => !allowed.has(k));
        if (denied) {
          const s = STAGES.find(x => x.key === denied);
          return res.status(403).json({ ok: false, error: `You cannot edit "${s ? s.label : denied}" - only ${s ? s.depts.join(' / ') : 'its department'} can` });
        }
        const remarks = b.stage_remarks || {};
        const missing = keys.find(k => !clean(remarks[k], 1000));
        if (missing) return res.status(400).json({ ok: false, error: 'Remarks are mandatory for every stage change' });
        const cur = await pool.query('SELECT stages, stage_info, parent_sync_id FROM npd_products WHERE id = $1', [id]);
        if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Product not found' });
        const rowLevel = cur.rows[0].parent_sync_id ? 'mould' : 'product';
        const wrong = keys.find(k => STAGE_LEVEL.get(k) !== rowLevel);
        if (wrong) {
          const s = STAGES.find(x => x.key === wrong);
          return res.status(400).json({ ok: false, error: `"${s ? s.label : wrong}" is filled on the ${rowLevel === 'mould' ? 'main product' : 'child mould'} row` });
        }
        const cleaned = cleanStages(b.stages);
        if (Object.keys(cleaned).length !== keys.length) return res.status(400).json({ ok: false, error: 'Invalid stage value' });
        const receivedBy = clean(b.received_by, 100);
        if (cleaned[RECEIVED_BY_STAGE] === 'complete' && !receivedBy) {
          return res.status(400).json({ ok: false, error: 'Enter the name of who received the mould' });
        }
        stageInfo = {};
        const prevInfo = cur.rows[0].stage_info || {};
        const prevStages = cur.rows[0].stages || {};
        const now = new Date().toISOString();
        for (const k of keys) {
          const old = prevInfo[k] || {};
          const v = cleaned[k];
          let completedOn = old.completed_on || null;
          if (STAGE_TYPE.get(k) === 'status') {
            if (v !== 'complete') completedOn = null;
            else if (prevStages[k] !== 'complete' || !completedOn) completedOn = todayIST();
          }
          stageInfo[k] = { remarks: clean(remarks[k], 1000), by: u.username, at: now, completed_on: completedOn };
          if (k === RECEIVED_BY_STAGE && v === 'complete') stageInfo[k].received_by = receivedBy;
        }
      }
      const sets = [];
      const vals = [];
      const add = (sql, v) => { vals.push(v); sets.push(sql.replace('?', '$' + vals.length)); };
      if (b.product_name !== undefined) {
        const name = clean(b.product_name, 300);
        if (!name) return res.status(400).json({ ok: false, error: 'Product name is required' });
        add('product_name = ?', name);
      }
      if (b.product_code !== undefined) add('product_code = ?', clean(b.product_code, 60));
      if (b.trial_colours !== undefined) add('trial_colours = ?', cleanColours(b.trial_colours));
      if (b.factory !== undefined) add('factory = ?', clean(b.factory, 120));
      if (b.status !== undefined) {
        if (!PRODUCT_STATUSES.has(b.status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
        add('status = ?', b.status);
      }
      if (b.remarks !== undefined) add('remarks = ?', clean(b.remarks, 2000));
      if (b.stages !== undefined) {
        add('stages = stages || ?::jsonb', JSON.stringify(cleanStages(b.stages)));
        add('stage_info = stage_info || ?::jsonb', JSON.stringify(stageInfo));
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: 'Nothing to update' });
      add('updated_by = ?', u.username);
      vals.push(id);
      const r = await pool.query(
        `UPDATE npd_products SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`, vals);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Product not found' });
      pushNow();
      res.json({ ok: true, data: r.rows[0] });
    } catch (err) { sendServerError(res, err); }
  });

  app.delete('/api/npd/products/:id', async (req, res) => {
    try {
      await ensureTables();
      const u = await sessionUser(req);
      if (!u) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      if (!isSuperadmin(u)) return res.status(403).json({ ok: false, error: 'Only superadmin can delete NPD products and child moulds' });
      const id = parseInt(req.params.id, 10);
      const r = await pool.query('DELETE FROM npd_products WHERE id = $1 RETURNING sync_id', [id]);
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Product not found' });
      /* its child moulds go with it */
      const kids = await pool.query('DELETE FROM npd_products WHERE parent_sync_id = $1 RETURNING sync_id', [r.rows[0].sync_id]);
      const gone = [r.rows[0].sync_id, ...kids.rows.map(k => k.sync_id)];
      /* row by row (not a cascade) so each file's deletion is recorded for sync too */
      const files = await pool.query('DELETE FROM npd_files WHERE product_sync_id = ANY($1::uuid[]) RETURNING file_path', [gone]);
      files.rows.forEach(f => removeFile(f.file_path));
      pushNow();
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });

  /* kind = report (trial report) | image (product photo after trial).
     The role check runs before multer so a non-editor's file never touches disk. */
  app.post('/api/npd/products/:id/files/:kind', async (req, res, next) => {
    try {
      await ensureTables();
      if (!['report', 'image'].includes(req.params.kind)) return res.status(400).json({ ok: false, error: 'Unknown file kind' });
      const u = await requireEditor(req, res);
      if (!u) return;
      req.npdUser = u;
      next();
    } catch (err) { sendServerError(res, err); }
  }, upload.array('files', 10), async (req, res) => {
    const saved = req.files || [];
    try {
      const id = parseInt(req.params.id, 10);
      if (!saved.length) return res.status(400).json({ ok: false, error: 'No file, or file type not allowed' });
      const exists = await pool.query('SELECT sync_id FROM npd_products WHERE id = $1', [id]);
      if (!exists.rows.length) {
        saved.forEach(f => removeFile(f.filename));
        return res.status(404).json({ ok: false, error: 'Product not found' });
      }
      const out = [];
      for (const f of saved) {
        const r = await pool.query(
          `INSERT INTO npd_files (product_id, product_sync_id, kind, file_path, original_name, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, product_sync_id, kind, file_path, original_name, uploaded_by, uploaded_at`,
          [id, exists.rows[0].sync_id, req.params.kind, f.filename, clean(f.originalname, 255), req.npdUser.username]);
        out.push({ ...r.rows[0], url: `/uploads/npd/${f.filename}` });
      }
      /* LOCAL: the file itself goes to MAIN right away (the 30-min upload sweep is the fallback) */
      const pushFile = app.locals && app.locals.pushUploadFileToMain;
      if (typeof pushFile === 'function') {
        saved.forEach(f => pushFile('npd', f.filename).catch(e => console.warn('[NPD] file push failed:', e.message)));
      }
      pushNow();
      res.json({ ok: true, data: out });
    } catch (err) {
      saved.forEach(f => removeFile(f.filename));
      sendServerError(res, err);
    }
  });

  app.delete('/api/npd/files/:fileId', async (req, res) => {
    try {
      await ensureTables();
      const u = await requireEditor(req, res);
      if (!u) return;
      const r = await pool.query('DELETE FROM npd_files WHERE id = $1 RETURNING file_path', [parseInt(req.params.fileId, 10)]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'File not found' });
      removeFile(r.rows[0].file_path);
      pushNow();
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = {
  registerNpdRoutes,
  ensureNpdSchema,
  STAGES,
  STAGE_LEVEL,
  rollupStage,
  migrateNpdLevels,
  DEPT_ROLES,
  ADMIN_ROLES,
  SHEET_ROLES,
  STAGE_STATES,
  PRODUCT_STATUSES,
  cleanStages,
  cleanColours,
  roleDepts,
  norm,
  editableStageKeys,
  canEditSheet,
  canAddItems,
  isNpdAdmin,
  isNpdSuperadmin
};
