'use strict';

// The app's one connection pool, for modules that are loaded before it exists
// (routes/vendor.routes.js, services/erp.service.js). They used to open their own
// pools — two more per worker, outside the connection budget (see poolSizing.js) and
// without the app pool's timeouts and IST timezone setting.

let sharedPool = null;
let fallbackPool = null;

function setSharedPool(pool) {
  sharedPool = pool;
}

function getPool() {
  if (sharedPool) return sharedPool;
  // Only reached if a module is used outside the server (e.g. a one-off script).
  if (!fallbackPool) {
    const { Pool } = require('pg');
    fallbackPool = new Pool({
      host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
      port: process.env.DB_PORT || process.env.PGPORT || 5432,
      user: process.env.DB_USER || process.env.PGUSER || 'postgres',
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
      database: process.env.DB_NAME || process.env.PGDATABASE || 'jpsms',
      max: 3
    });
  }
  return fallbackPool;
}

/** A pool-shaped object that always uses the shared pool. */
const pool = {
  query: (...args) => getPool().query(...args),
  connect: (...args) => getPool().connect(...args)
};

module.exports = { setSharedPool, getPool, pool };
