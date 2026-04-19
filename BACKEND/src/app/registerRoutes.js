'use strict';

const registerLegacyRoutes = require('../legacy/registerLegacyRoutes');

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
  app.use('/api/vendor', services.vendorRoutes);
  app.use('/api/sync', services.syncService.router);
  app.use('/api/update', services.updaterService.router);

  return registerLegacyRoutes({ app, pool, config, services });
}

module.exports = registerRoutes;
