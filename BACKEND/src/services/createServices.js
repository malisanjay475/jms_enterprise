'use strict';

function createServices() {
  const backupService = require('../../services/backupService');
  if (process.env.BACKUP_ENABLED !== '0') {
    backupService.start();
  }

  return {
    aiService: require('../../services/ai.service'),
    localNodeAgent: require('../local-servers/localNodeAgent'),
    localServerService: require('../local-servers/localServerService'),
    syncService: require('../../services/sync.service'),
    updaterService: require('../../services/updater.service'),
    erpRoutes: require('../../routes/erp.routes'),
    vendorRoutes: require('../../routes/vendor.routes'),
    backupService
  };
}

module.exports = createServices;
