'use strict';

const { startServer } = require('./src/app/startServer');

startServer().catch((error) => {
  console.error('[BOOT] Failed to start server:', error);
  process.exit(1);
});
