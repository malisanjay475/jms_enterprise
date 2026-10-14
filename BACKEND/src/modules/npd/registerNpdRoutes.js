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

const EDIT_ROLES = new Set(['ppc_ass_manager', 'ppc_manager', 'sr_ppc_manager', 'admin', 'superadmin']);

/* Columns of the NPD tracking sheet, in sheet order. type 'status' cells hold a
   stage state, type 'date' cells hold a YYYY-MM-DD date. Keep in sync with npd.html. */
const STAGES = [
  { key: 'mould_received', type: 'status' },
  { key: 'mould_trials', type: 'status' },
  { key: 'rm_colour', type: 'status' },
  { key: 'samples_ho', type: 'status' },
  { key: 'pilot_drop_test', type: 'status' },
  { key: 'qc_approval_ho', type: 'status' },
  { key: 'packing_material', type: 'status' },
  { key: 'bom_approval', type: 'status' },
  { key: 'packing_receiving', type: 'status' },
  { key: 'or_jr_erp', type: 'status' },
  { key: 'production_planning', type: 'status' },
  { key: 'jc_start_date', type: 'date' },
  { key: 'jc_end_date', type: 'date' },
  { key: 'launch_date', type: 'date' },
  { key: 'mass_moulding', type: 'status' },
  { key: 'mass_printing', type: 'status' },
  { key: 'mass_packaging', type: 'status' },
  { key: 'fg_receiving', type: 'status' },
  { key: 'ex_factory_cost', type: 'status' },
  { key: 'price_final', type: 'status' },
  { key: 'post_card_receiving', type: 'status' },
  { key: 'post_card_posting', type: 'status' },
  { key: 'dispatch_date', type: 'date' }
];
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

function registerNpdRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) {
      ready = pool.query(`
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
          product_id INTEGER NOT NULL REFERENCES npd_products(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          file_path TEXT NOT NULL,
          original_name TEXT,
          uploaded_by TEXT,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_npd_files_product ON npd_files(product_id);
      `).catch(err => { ready = null; throw err; });
    }
    return ready;
  }

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
        pool.query('SELECT id, product_id, kind, file_path, original_name, uploaded_by, uploaded_at FROM npd_files ORDER BY id')
      ]);
      const byProduct = new Map();
      files.rows.forEach(f => {
        if (!byProduct.has(f.product_id)) byProduct.set(f.product_id, []);
        byProduct.get(f.product_id).push({ ...f, url: `/uploads/npd/${path.basename(f.file_path)}` });
      });
      res.json({
        ok: true,
        can_edit: canEdit(u),
        data: products.rows.map(p => ({ ...p, files: byProduct.get(p.id) || [] }))
      });
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
      res.json({ ok: true, data: r.rows[0] });
    } catch (err) { sendServerError(res, err); }
  });

  app.delete('/api/npd/products/:id', async (req, res) => {
    try {
      await ensureTables();
      const u = await requireEditor(req, res);
      if (!u) return;
      const id = parseInt(req.params.id, 10);
      const files = await pool.query('SELECT file_path FROM npd_files WHERE product_id = $1', [id]);
      const r = await pool.query('DELETE FROM npd_products WHERE id = $1', [id]);
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Product not found' });
      files.rows.forEach(f => removeFile(f.file_path));
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
      const exists = await pool.query('SELECT 1 FROM npd_products WHERE id = $1', [id]);
      if (!exists.rows.length) {
        saved.forEach(f => removeFile(f.filename));
        return res.status(404).json({ ok: false, error: 'Product not found' });
      }
      const out = [];
      for (const f of saved) {
        const r = await pool.query(
          `INSERT INTO npd_files (product_id, kind, file_path, original_name, uploaded_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, product_id, kind, file_path, original_name, uploaded_by, uploaded_at`,
          [id, req.params.kind, f.filename, clean(f.originalname, 255), req.npdUser.username]);
        out.push({ ...r.rows[0], url: `/uploads/npd/${f.filename}` });
      }
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
      res.json({ ok: true });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = { registerNpdRoutes, STAGES };
