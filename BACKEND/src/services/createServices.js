'use strict';

// Under PM2 cluster mode every worker runs this file. Singleton background jobs
// (DB backups, schedulers) must run in ONE worker only — otherwise N workers each
// fire their own pg_dump every few minutes, and those concurrent dumps hold read
// locks that block the boot-time schema DDL, deadlocking startup. PM2 sets
// NODE_APP_INSTANCE per worker ('0' for the first); when unset (plain `node`,
// non-cluster) we are the only process, so treat that as primary too.
function isPrimaryWorker() {
  const inst = process.env.NODE_APP_INSTANCE;
  return inst === undefined || inst === '' || inst === '0';
}

function createServices() {
  const backupService = require('../../services/backupService');
  // Only the primary worker runs the in-app backup loop (guarded by BACKUP_ENABLED).
  if (process.env.BACKUP_ENABLED !== '0' && isPrimaryWorker()) {
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
