'use strict';

/**
 * ERP Masters - PUBLIC/erp_masters.html (Masters menu).
 *
 * Read-only views of the Item / Variant / Party / Rate masters that
 * smartopsSync.js copies from Smart Ops. The ERP is the source of truth, so
 * there is no add / edit / delete here.
 *
 *   GET  /api/erp-masters/:key/data   paged, searched, sorted rows
 *   GET  /api/erp-masters/sync-state  smartops_sync_state rows
 *   POST /api/erp-masters/sync-now    admin only: run the sync now (MAIN)
 */

const { sendServerError } = require('../../app/httpErrors');
const { isAdminLike } = require('../../app/auth');
const { MASTERS, runSync, startSmartopsSync, isConfigured, isMain } = require('./smartopsSync');

const MAX_LIMIT = 5000;

function requireLogin(req, res) {
  if (req.auth && req.auth.username) return true;
  res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Please log in' });
  return false;
}

function registerErpMastersRoutes(app, pool) {
  startSmartopsSync(pool);

  app.get('/api/erp-masters/sync-state', async (req, res) => {
    if (!requireLogin(req, res)) return;
    try {
      const r = await pool.query(
        `SELECT master_key, row_count, status, last_run_at, last_success_at, last_error
           FROM smartops_sync_state ORDER BY master_key`);
      res.json({
        ok: true,
        configured: isConfigured(),
        main: isMain(),
        can_sync: isAdminLike(req.auth) && isMain(),
        data: r.rows
      });
    } catch (err) { sendServerError(res, err); }
  });

  app.post('/api/erp-masters/sync-now', async (req, res) => {
    if (!requireLogin(req, res)) return;
    if (!isAdminLike(req.auth)) return res.status(403).json({ ok: false, error: 'Only admin can run the sync' });
    if (!isMain()) return res.status(400).json({ ok: false, error: 'The Smart Ops sync runs on the main server only' });
    if (!isConfigured()) return res.status(400).json({ ok: false, error: 'Smart Ops sync not configured' });
    try {
      const result = await runSync(pool);
      res.status(result.ok || result.skipped ? 200 : 502).json(result);
    } catch (err) { sendServerError(res, err); }
  });

  app.get('/api/erp-masters/:key/data', async (req, res) => {
    if (!requireLogin(req, res)) return;
    const def = MASTERS[String(req.params.key || '').toLowerCase()];
    if (!def) return res.status(404).json({ ok: false, error: 'Unknown master' });
    try {
      // Identifiers only ever come from the MASTERS whitelist, never from the request.
      const cols = def.cols.map(c => c[0]);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), MAX_LIMIT);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const sortCol = cols.find(c => c === String(req.query.sort)) || 'smartops_id';
      const dir = String(req.query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      const search = String(req.query.search || '').trim().slice(0, 200);

      const params = [];
      let where = '';
      if (search) {
        params.push(`%${search.replace(/[\\%_]/g, m => `\\${m}`)}%`);
        where = `WHERE concat_ws(' ', ${cols.map(c => `${c}::text`).join(', ')}) ILIKE $1`;
      }
      const total = await pool.query(`SELECT count(*)::int AS n FROM ${def.table} ${where}`, params);
      const n = params.length;
      const rows = await pool.query(
        `SELECT ${cols.join(', ')} FROM ${def.table} ${where}
          ORDER BY ${sortCol} ${dir} NULLS LAST, smartops_id
          LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, (page - 1) * limit]);
      res.json({ ok: true, total: total.rows[0].n, page, limit, data: rows.rows });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = { registerErpMastersRoutes };
