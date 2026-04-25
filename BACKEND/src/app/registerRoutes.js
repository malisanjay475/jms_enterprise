'use strict';

const registerLegacyRoutes = require('../legacy/registerLegacyRoutes');
const { getFactoryId } = require('./requestContext');

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

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'jms-backend',
      status: 'healthy',
      env: config.nodeEnv
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
