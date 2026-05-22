'use strict';

const path = require('path');
const registerLegacyRoutes = require('../legacy/registerLegacyRoutes');
const { getFactoryId } = require('./requestContext');
const sseManager = require('./sseManager');

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/** Map an API path to a frontend module name, or null to suppress broadcast. */
function ssePathToModule(reqPath) {
  if (/^\/api\/planning/.test(reqPath))                                     return 'planning';
  if (/^\/api\/(dpr|job|shifting|std-actual|rm)/.test(reqPath))             return 'dpr';
  if (/^\/api\/wip/.test(reqPath))                                           return 'dpr';
  if (/^\/api\/qc/.test(reqPath))                                            return 'qc';
  if (/^\/api\/(machines|moulds)|^\/(api\/)?upload/.test(reqPath))          return 'masters';
  if (/^\/api\/hr/.test(reqPath))                                            return 'hr';
  if (/^\/api\/assembly/.test(reqPath))                                      return 'assembly';
  return null;
}

/**
 * Middleware: after any successful POST/PUT/DELETE/PATCH response, broadcast
 * a lightweight "refresh" event to all connected SSE clients so that other
 * open tabs can reload the affected module without a manual page refresh.
 */
function sseBroadcastMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const module = ssePathToModule(req.path);
  if (!module) return next();

  const origJson = res.json.bind(res);
  res.json = function (body) {
    // Only broadcast when the handler reports success (ok: true or no ok field)
    if (body && body.ok !== false) {
      sseManager.broadcast({ type: 'refresh', module, path: req.path, ts: Date.now() });
    }
    return origJson(body);
  };
  next();
}

const _pkg = (() => {
  try { return require(path.join(__dirname, '../../package.json')); } catch { return {}; }
})();
const APP_VERSION = process.env.APP_VERSION || _pkg.version || '0.0.0';

async function ensureJmsPlanReportSchema(query) {
  const planBoardColumns = [
    ['mould_code', 'VARCHAR(255)'],
    ['our_code', 'TEXT'],
    ['batch_no', 'INTEGER'],
    ['batch_qty', 'NUMERIC'],
    ['mould_item_qty', 'NUMERIC'],
    ['consumption_ratio_qty', 'NUMERIC'],
    ['colour_details', 'JSONB'],
    ['created_by', 'TEXT'],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['job_card_given', 'BOOLEAN DEFAULT false'],
    ['factory_id', 'INTEGER']
  ];
  for (const [name, typeSql] of planBoardColumns) {
    await query(`ALTER TABLE plan_board ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`);
  }

  const mouldReportColumns = [
    ['or_jr_date', 'TEXT'],
    ['bom_type', 'TEXT'],
    ['product_name', 'TEXT'],
    ['jr_qty', 'TEXT'],
    ['uom', 'TEXT'],
    ['mould_no', 'TEXT'],
    ['mould_name', 'TEXT'],
    ['mould_item_qty', 'TEXT'],
    ['tonnage', 'TEXT'],
    ['cycle_time', 'TEXT'],
    ['cavity', 'TEXT'],
    ['factory_id', 'INTEGER']
  ];
  for (const [name, typeSql] of mouldReportColumns) {
    await query(`ALTER TABLE mould_planning_report ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`);
  }

  const orJrColumns = [
    ['or_jr_date', 'DATE'],
    ['client_name', 'TEXT'],
    ['product_name', 'TEXT'],
    ['jr_qty', 'INTEGER'],
    ['uom', 'TEXT'],
    ['factory_id', 'INTEGER']
  ];
  for (const [name, typeSql] of orJrColumns) {
    await query(`ALTER TABLE or_jr_report ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`);
  }
}

function registerJmsPlanReportRoute(app, pool) {
  app.get('/api/reports/jms-plan', async (req, res) => {
    const query = async (text, params) => {
      const result = await pool.query(text, params);
      return result.rows;
    };

    try {
      await ensureJmsPlanReportSchema(query);
      const requestFactoryId = getFactoryId(req);
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const rows = await query(`
        SELECT
          pb.order_no AS "orJrNo",
          COALESCE(mpr.or_jr_date::text, ojr.or_jr_date::text, '') AS "jrDate",
          COALESCE(pb.our_code, '') AS "ourCode",
          COALESCE(mpr.bom_type, ojr.client_name, '') AS "bomType",
          COALESCE(mpr.product_name, ojr.product_name, pb.item_name, '') AS "jrItemName",
          COALESCE(NULLIF(mpr.jr_qty, ''), ojr.jr_qty::text, '') AS "jrQty",
          COALESCE(mpr.uom, ojr.uom, '') AS "uom",
          COALESCE(pb.created_at::date::text, pb.start_date::date::text, CURRENT_DATE::text) AS "planDate",
          pb.plan_qty AS "planQty",
          COALESCE(pb.mould_code, mpr.mould_no, '') AS "mouldNo",
          COALESCE(pb.mould_name, mpr.mould_name, '') AS "mould",
          COALESCE(pb.mould_item_qty::text, mpr.mould_item_qty, '') AS "mouldItemQty",
          COALESCE(mpr.tonnage, m.tonnage::text, '') AS "tonnage",
          pb.machine AS "machine",
          COALESCE(mpr.cycle_time, m.cycle_time::text, '') AS "cycleTime",
          COALESCE(mpr.cavity, m.no_of_cav::text, '') AS "cavity",
          pb.batch_no AS "batchNo",
          pb.batch_qty AS "batchQty",
          pb.consumption_ratio_qty AS "consumptionRatioQty",
          COALESCE(pb.created_by, 'System') AS "createdBy",
          pb.created_at AS "timestamp"
        FROM plan_board pb
        LEFT JOIN LATERAL (
          SELECT *
          FROM mould_planning_report mpr0
          WHERE TRIM(COALESCE(mpr0.or_jr_no, '')) = TRIM(COALESCE(pb.order_no, ''))
            AND (
              TRIM(COALESCE(mpr0.mould_no, '')) = TRIM(COALESCE(pb.mould_code, ''))
              OR TRIM(COALESCE(mpr0.mould_name, '')) = TRIM(COALESCE(pb.mould_name, ''))
            )
            AND ($3::int IS NULL OR mpr0.factory_id = $3 OR mpr0.factory_id IS NULL)
          ORDER BY mpr0.id DESC
          LIMIT 1
        ) mpr ON true
        LEFT JOIN LATERAL (
          SELECT *
          FROM or_jr_report ojr0
          WHERE TRIM(COALESCE(ojr0.or_jr_no, '')) = TRIM(COALESCE(pb.order_no, ''))
            AND ($3::int IS NULL OR ojr0.factory_id = $3 OR ojr0.factory_id IS NULL)
          ORDER BY ojr0.id DESC
          LIMIT 1
        ) ojr ON true
        LEFT JOIN moulds m ON TRIM(COALESCE(m.mould_number, '')) = TRIM(COALESCE(pb.mould_code, ''))
        WHERE COALESCE(pb.our_code, '') <> ''
          AND ($1::date IS NULL OR COALESCE(pb.created_at::date, pb.start_date::date, CURRENT_DATE) >= $1::date)
          AND ($2::date IS NULL OR COALESCE(pb.created_at::date, pb.start_date::date, CURRENT_DATE) <= $2::date)
        ORDER BY pb.created_at DESC NULLS LAST, pb.our_code DESC, pb.batch_no DESC, pb.id DESC
      `, [from || null, to || null, requestFactoryId]);

      res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('/api/reports/jms-plan', e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}

function registerRoutes(app, deps) {
  const { config, pool, services } = deps;

  // -----------------------------------------------------------------------
  // SSE: register broadcast middleware early so it covers all routes below
  // -----------------------------------------------------------------------
  app.use(sseBroadcastMiddleware);

  // SSE endpoint — clients connect here to receive live-update push events
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // prevent Nginx from buffering SSE
    res.flushHeaders();
    // Send an initial connected event so the client knows the stream is live
    res.write('data: {"type":"connected"}\n\n');
    sseManager.addClient(res);
    // Heartbeat every 20 s keeps the connection alive through idle periods
    // and prevents proxies / load-balancers from closing it due to inactivity.
    const hb = setInterval(() => {
      try { res.write(': hb\n\n'); } catch (_e) { clearInterval(hb); }
    }, 20000);
    req.on('close', () => clearInterval(hb));
  });

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'jms-backend',
      status: 'healthy',
      env: config.nodeEnv
    });
  });

  app.get('/api/version', (req, res) => {
    res.json({
      version: APP_VERSION,
      gitSha: process.env.APP_GIT_SHA || null,
      buildDate: process.env.APP_BUILD_DATE || null,
      serverType: process.env.SERVER_TYPE || 'MAIN',
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      db: {
        host: config.db.host,
        database: config.db.database,
        port: config.db.port
      }
    });
  });

  app.use('/api/erp', services.erpRoutes);
  app.use('/api/local-servers', services.localServerService.router);
  app.use('/api/vendor', services.vendorRoutes);
  app.use('/api/sync', services.syncService.router);
  app.use('/api/update', services.updaterService.router);
  registerJmsPlanReportRoute(app, pool);

  return registerLegacyRoutes({ app, pool, config, services });
}

module.exports = registerRoutes;
