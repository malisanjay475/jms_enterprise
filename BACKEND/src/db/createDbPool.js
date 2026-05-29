'use strict';

const { Pool } = require('pg');

// NOTE: Do NOT add pg.types.setTypeParser(1082, ...) here.
// DATE columns are intentionally returned as JavaScript Date objects by pg.
// Timezone correctness is handled by TZ=Asia/Kolkata in docker-compose (hardcoded,
// not ${TZ:-fallback} which Hostinger's host TZ=UTC overrides).
// Changing the DATE parser globally breaks date comparisons and plan_board queries.

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
