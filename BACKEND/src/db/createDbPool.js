'use strict';

const { Pool } = require('pg');

function createDbPool(config) {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database
  });

  pool.on('error', (error) => {
    console.error('[DB] Unexpected pool error:', error.message);
  });

  return pool;
}

module.exports = createDbPool;
