'use strict';

const pg = require('pg');
const { Pool } = pg;

// Prevent timezone-shifting by returning DATE columns as raw YYYY-MM-DD strings
pg.types.setTypeParser(1082, (val) => val);

function createDbPool(config) {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    max: 50,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (error) => {
    console.error('[DB] Unexpected pool error:', error.message);
  });

  return pool;
}

module.exports = createDbPool;
