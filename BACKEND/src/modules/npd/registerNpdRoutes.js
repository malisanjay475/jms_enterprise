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
        pool.query('SELECT product_id, kind, COUNT(*)::int AS n FROM npd_files GROUP BY product_id, kind')
      ]);
      const count = new Map(files.rows.map(f => [`${f.product_id}:${f.kind}`, f.n]));
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
        vals.push(p.status || '', p.remarks || '', count.get(`${p.id}:report`) || 0, count.get(`${p.id}:image`) || 0,
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
