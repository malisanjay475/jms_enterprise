'use strict';

function createServices() {
  return {
    aiService: require('../../services/ai.service'),
    syncService: require('../../services/sync.service'),
    updaterService: require('../../services/updater.service'),
    erpRoutes: require('../../routes/erp.routes'),
    vendorRoutes: require('../../routes/vendor.routes')
  };
}

module.exports = createServices;
