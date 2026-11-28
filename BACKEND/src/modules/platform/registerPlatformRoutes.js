'use strict';

const { getProductMap } = require('./productMap');

function registerPlatformRoutes(app) {
  app.get('/api/platform/map', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getProductMap());
  });
}

module.exports = { registerPlatformRoutes };
