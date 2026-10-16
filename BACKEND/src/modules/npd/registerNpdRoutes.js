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
 * Everyone who can open the page can view. Only PPC Ass. Manager, PPC Manager,
 * Sr. PPC Manager (and admin / superadmin) can add, edit, upload or delete.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { getRequestUsername } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');

const EDIT_ROLES = new Set(['ppc_ass_manager', 'ppc_manager', 'sr_ppc_manager', 'sr__ppc_manager', 'admin', 'superadmin']);

/* Columns of the NPD tracking sheet, in sheet order. type 'status' cells hold a
   stage state, type 'date' cells hold a YYYY-MM-DD date. Keep in sync with npd.html. */
const STAGES = [
  { key: 'mould_received', type: 'status', group: 'Mould & Trial', label: 'Final mould received @ factory (Tool Room)' },
  { key: 'mould_trials', type: 'status', group: 'Mould & Trial', label: 'Product mould final trials @ factory (Moulding)' },
  { key: 'rm_colour', type: 'status', group: 'Mould & Trial', label: 'RM & colour finalization (Planning / Moulding)' },
  { key: 'samples_ho', type: 'status', group: 'Mould & Trial', label: 'Final samples sent to HO for approval & photo shoot (QC)' },
  { key: 'pilot_drop_test', type: 'status', group: 'Mould & Trial', label: 'Pilot run & drop test @ factory (Moulding / QC)' },
  { key: 'qc_approval_ho', type: 'status', group: 'Mould & Trial', label: 'Final QC testing & approval from HO (QC)' },
  { key: 'packing_material', type: 'status', group: 'Packing, BOM & ERP', label: 'Packing material finalization (Packing)' },
  { key: 'bom_approval', type: 'status', group: 'Packing, BOM & ERP', label: 'Product BOM finalization / approval (Planning)' },
  { key: 'packing_receiving', type: 'status', group: 'Packing, BOM & ERP', label: 'Packing material follow up & receiving @ factory (Purchase)' },
  { key: 'or_jr_erp', type: 'status', group: 'Packing, BOM & ERP', label: 'OR-JR making in ERP (HO)' },
  { key: 'production_planning', type: 'status', group: 'Packing, BOM & ERP', label: 'Production planning as per OR-JR ERP (Planning)' },
  { key: 'jc_start_date', type: 'date', group: 'Packing, BOM & ERP', label: 'Planned job card start date (Planning)' },
  { key: 'jc_end_date', type: 'date', group: 'Packing, BOM & ERP', label: 'Planned job card completion date (Planning)' },
  { key: 'launch_date', type: 'date', group: 'Packing, BOM & ERP', label: 'Launch date finalization (Planning)' },
  { key: 'mass_moulding', type: 'status', group: 'Mass Production', label: 'Mass production - moulding (Moulding)' },
  { key: 'mass_printing', type: 'status', group: 'Mass Production', label: 'Mass production - printing / tufting (Production)' },
  { key: 'mass_packaging', type: 'status', group: 'Mass Production', label: 'Mass production - packaging (Packing)' },
  { key: 'fg_receiving', type: 'status', group: 'Mass Production', label: 'Finish goods receiving (W/H)' },
  { key: 'ex_factory_cost', type: 'status', group: 'Costing & Launch', label: 'Ex factory cost finalization (Planning)' },
  { key: 'price_final', type: 'status', group: 'Costing & Launch', label: 'Price finalization (HO)' },
  { key: 'post_card_receiving', type: 'status', group: 'Costing & Launch', label: 'Final post card follow up & receiving (Planning)' },
  { key: 'post_card_posting', type: 'status', group: 'Costing & Launch', label: 'Posting post card in new product launch group (Planning)' },
  { key: 'dispatch_date', type: 'date', group: 'Costing & Launch', label: 'Actual dispatch date' }
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
const STAGE_TYPE = new Map(STAGES.map(s => [s.key, s.type]));
const STAGE_STATES = new Set(['pending', 'in_progress', 'complete', 'na']);
const PRODUCT_STATUSES = new Set(['', 'Hold', 'Launched', 'Delayed', 'On Schedule', 'Cancelled']);

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

const clean = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
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
/* Dungra Unit-I: owner of every product made before NPD became factory wise */
const NPD_LEGACY_FACTORY_ID = 1;

async function ensureNpdSchema(pool) {
  const localFactoryId = parseInt(process.env.LOCAL_FACTORY_ID, 10);
  /* purge other factories' copies only when this LOCAL knows its own factory */
  const isLocal = String(process.env.SERVER_TYPE || '').toUpperCase() === 'LOCAL' && Number.isInteger(localFactoryId) && localFactoryId > 0;
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

    /* NPD is factory wise. Products made before v1.121 had no factory; they are all
       Dungra Unit-I's (owner, 16-Oct-2026). With factory_id the sync sends each
       LOCAL only its own factory's rows. A file carries its product's factory. */
    ALTER TABLE npd_products ADD COLUMN IF NOT EXISTS factory_id INTEGER;
    ALTER TABLE npd_files ADD COLUMN IF NOT EXISTS factory_id INTEGER;
    UPDATE npd_products SET factory_id = ${NPD_LEGACY_FACTORY_ID} WHERE factory_id IS NULL;
    UPDATE npd_files f SET factory_id = COALESCE(p.factory_id, ${NPD_LEGACY_FACTORY_ID})
      FROM npd_products p WHERE f.factory_id IS NULL AND p.sync_id = f.product_sync_id;
    UPDATE npd_files SET factory_id = ${NPD_LEGACY_FACTORY_ID} WHERE factory_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_npd_products_factory ON npd_products(factory_id);
    CREATE INDEX IF NOT EXISTS idx_npd_files_factory ON npd_files(factory_id);

    /* Sr No runs per factory. MAIN and a LOCAL can both hand out the same next
       number while apart; MAIN decides: a row arriving with a number another product
       of that factory already has gets the next free one, and updated_at moves so
       the new number syncs back out. */
    CREATE OR REPLACE FUNCTION npd_unique_sr_no() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('npd_sr_no'));
      IF NEW.sr_no IS NOT NULL AND EXISTS (
           SELECT 1 FROM npd_products
            WHERE sr_no = NEW.sr_no AND factory_id IS NOT DISTINCT FROM NEW.factory_id
              AND sync_id IS DISTINCT FROM NEW.sync_id) THEN
        NEW.sr_no := (SELECT (COALESCE(MAX(NULLIF(regexp_replace(sr_no, '[^0-9]', '', 'g'), '')::bigint), 0) + 1)::text
                        FROM npd_products WHERE factory_id IS NOT DISTINCT FROM NEW.factory_id);
        NEW.updated_at := NOW();
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_npd_unique_sr_no ON npd_products;
    CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT);
    ${isLocal ? `
    /* This LOCAL pulled every factory's products while NPD was not factory wise.
       Drop the other factories' copies here only: their tombstones are removed in
       the same transaction so the deletes never reach MAIN. */
    DELETE FROM npd_files WHERE factory_id IS DISTINCT FROM ${localFactoryId};
    DELETE FROM npd_products WHERE factory_id IS DISTINCT FROM ${localFactoryId};
    DO $$
    BEGIN
      DELETE FROM sync_deletions s
       WHERE s.table_name IN ('npd_products', 'npd_files')
         AND s.factory_id IS DISTINCT FROM ${localFactoryId}
         AND s.deleted_at > NOW() - interval '1 minute';
    EXCEPTION WHEN undefined_table THEN NULL; /* sync not set up yet */
    END $$;` : `
    CREATE TRIGGER trg_npd_unique_sr_no BEFORE INSERT OR UPDATE OF sr_no, factory_id ON npd_products
      FOR EACH ROW EXECUTE FUNCTION npd_unique_sr_no();
    /* duplicates already here: the oldest keeps its number, the others are renumbered */
    UPDATE npd_products p SET sr_no = p.sr_no
     WHERE EXISTS (SELECT 1 FROM npd_products o
                    WHERE o.sr_no = p.sr_no AND o.factory_id IS NOT DISTINCT FROM p.factory_id AND o.id < p.id);
    /* A LOCAL pulls only rows changed since its last pull (one watermark for all
       tables). Mark every NPD row changed once per version so each LOCAL pulls its
       factory's list again: V1 = joined sync, V2 = became factory wise. */
    DO $$
    BEGIN
      INSERT INTO server_config (key, value) VALUES ('NPD_SYNC_RESEND_V2', NOW()::text);
      UPDATE npd_products SET updated_at = NOW();
      UPDATE npd_files SET updated_at = NOW();
    EXCEPTION WHEN unique_violation THEN NULL; /* already done */
    END $$;`}
  `);
}

function registerNpdRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureNpdSchema(pool).catch(err => { ready = null; throw err; });
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
    const r = await pool.query('SELECT username, role_code FROM users WHERE username = $1 LIMIT 1', [username]);
    return r.rows[0] || null;
  }
  const canEdit = u => !!u && EDIT_ROLES.has(String(u.role_code || '').toLowerCase());

  async function requireEditor(req, res) {
    const u = await sessionUser(req);
    if (!u) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return null; }
    if (!canEdit(u)) { res.status(403).json({ ok: false, error: 'Only PPC Ass. Manager, PPC Manager and Sr. PPC Manager can edit NPD' }); return null; }
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
      const rows = products.rows.filter(p =>
        (!status || (p.status || 'No status') === status) &&
        (!q || `${p.product_name} ${p.sr_no || ''}`.toLowerCase().includes(q)));

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'JMS';
      const ws = wb.addWorksheet('NPD Tracker', { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
      const head = ['Sr No', 'Product', ...STAGES.map(s => s.label), 'Status', 'Remarks', 'Trial reports', 'Images', 'Last updated by', 'Last updated'];
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
        ws.mergeCells(2, c + 3, 2, e + 3);
        const g = ws.getCell(2, c + 3);
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
        const st = p.stages || {};
        const vals = [/^\d+$/.test(p.sr_no || '') ? Number(p.sr_no) : (p.sr_no || ''), p.product_name];
        STAGES.forEach(s => {
          const v = st[s.key];
          if (s.type === 'date') vals.push(v ? new Date(v + 'T00:00:00Z') : null);
          else vals.push((STATE_STYLE[v] || STATE_STYLE.pending).text);
        });
        vals.push(p.status || '', p.remarks || '', count.get(`${p.sync_id}:report`) || 0, count.get(`${p.sync_id}:image`) || 0,
          p.updated_by || '', p.updated_at ? new Date(p.updated_at) : null);
        const r = ws.addRow(vals);
        r.eachCell({ includeEmpty: true }, (c, col) => {
          c.border = border;
          c.alignment = { vertical: 'middle', wrapText: col === 2 || col === STAGES.length + 4 };
          const s = STAGES[col - 3];
          if (s && s.type === 'status') {
            const k = STATE_STYLE[st[s.key]] || STATE_STYLE.pending;
            c.fill = fill(k.fill);
            c.font = { bold: true, color: { argb: k.font } };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (s) {
            c.numFmt = 'dd-mmm-yy';
            c.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
        r.getCell(2).font = { bold: true };
        const ps = STATUS_STYLE[p.status];
        if (ps) {
          const c = r.getCell(STAGES.length + 3);
          c.fill = fill(ps.fill);
          c.font = { bold: true, color: { argb: ps.font } };
        }
        r.getCell(last).numFmt = 'dd-mmm-yy hh:mm';
      });

      ws.getColumn(1).width = 7;
      ws.getColumn(2).width = 34;
      STAGES.forEach((s, i) => { ws.getColumn(i + 3).width = s.type === 'date' ? 13 : 15; });
      ws.getColumn(STAGES.length + 3).width = 14;
      ws.getColumn(STAGES.length + 4).width = 40;
      [STAGES.length + 5, STAGES.length + 6].forEach(c => { ws.getColumn(c).width = 10; });
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
      const u = await requireEditor(req, res);
      if (!u) return;
      const name = clean(req.body?.product_name, 300);
      if (!name) return res.status(400).json({ ok: false, error: 'Product name is required' });
      const status = clean(req.body?.status, 40);
      /* Sr No is automatic: one more than the highest number used so far. */
      const r = await pool.query(
        `INSERT INTO npd_products (sr_no, product_name, stages, status, remarks, created_by, updated_by)
         VALUES ((SELECT (COALESCE(MAX(NULLIF(regexp_replace(sr_no, '[^0-9]', '', 'g'), '')::bigint), 0) + 1)::text
                    FROM npd_products),
                 $1, $2, $3, $4, $5, $5) RETURNING *`,
        [name, JSON.stringify(cleanStages(req.body?.stages)),
          PRODUCT_STATUSES.has(status) ? status : '', clean(req.body?.remarks, 2000), u.username]
      );
      pushNow();
      res.json({ ok: true, data: { ...r.rows[0], files: [] } });
    } catch (err) { sendServerError(res, err); }
  });

  /* Partial update: any of product_name, status, remarks, stages (merged). */
  app.put('/api/npd/products/:id', async (req, res) => {
    try {
      await ensureTables();
      const u = await requireEditor(req, res);
      if (!u) return;
      const id = parseInt(req.params.id, 10);
      const b = req.body || {};
      const sets = [];
      const vals = [];
      const add = (sql, v) => { vals.push(v); sets.push(sql.replace('?', '$' + vals.length)); };
      if (b.product_name !== undefined) {
        const name = clean(b.product_name, 300);
        if (!name) return res.status(400).json({ ok: false, error: 'Product name is required' });
        add('product_name = ?', name);
      }
      if (b.status !== undefined) {
        if (!PRODUCT_STATUSES.has(b.status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
        add('status = ?', b.status);
      }
      if (b.remarks !== undefined) add('remarks = ?', clean(b.remarks, 2000));
      if (b.stages !== undefined) add('stages = stages || ?::jsonb', JSON.stringify(cleanStages(b.stages)));
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
      const u = await requireEditor(req, res);
      if (!u) return;
      const id = parseInt(req.params.id, 10);
      const r = await pool.query('DELETE FROM npd_products WHERE id = $1 RETURNING sync_id', [id]);
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Product not found' });
      /* row by row (not a cascade) so each file's deletion is recorded for sync too */
      const files = await pool.query('DELETE FROM npd_files WHERE product_sync_id = $1 RETURNING file_path', [r.rows[0].sync_id]);
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

module.exports = { registerNpdRoutes, ensureNpdSchema, STAGES };
