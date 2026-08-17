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
    // Detect dead TCP sockets so a hung DB connection can't park a request forever.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    // Safety caps — high enough that legitimate heavy reports still finish (5 min),
    // but a runaway/stuck query is aborted instead of wedging the event loop.
    statement_timeout: 300000,
    query_timeout: 300000,
    // Never let an abandoned open transaction hold locks indefinitely.
    idle_in_transaction_session_timeout: 120000,

    // Pin every DB session to IST via the Postgres startup `options` packet, so
    // timestamptz values read/write in India time regardless of the server's
    // postgresql.conf timezone. MAIN sets PGTZ via Docker, but LOCAL Windows
    // Postgres installs default their `timezone` GUC to the machine's zone at
    // install time — so a mis-set box returns e.g. -07 offsets.
    //
    // This replaces a previous `pool.on('connect')` that ran an un-awaited
    // `SET TIME ZONE` query: that query raced the first real query on each new
    // connection, producing "Calling client.query() when the client is already
    // executing a query" deprecation warnings and, under load, genuine
    // concurrent-query state on one client. Setting it as a startup parameter
    // applies the timezone BEFORE any query runs — no extra query, no race.
    options: '-c timezone=Asia/Kolkata',
  });

  pool.on('error', (error) => {
    console.error('[DB] Unexpected pool error:', error.message);
  });

  return pool;
}

module.exports = createDbPool;
