'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// Fixed advisory-lock key so every process/worker contends for the SAME lock.
// The app boots under PM2 cluster mode (multiple workers) and may run as
// several container instances, all of which call runMigrations() on startup.
// Without serialization they race: each reads schema_migrations before any has
// recorded a pending migration, all execute the migration body concurrently,
// then collide on `INSERT INTO schema_migrations` (unique `name`) with SQLSTATE
// 23505, crashing boot. A session-level advisory lock makes exactly one worker
// run migrations while the rest wait, then find everything applied and skip.
const MIGRATION_LOCK_KEY = 4715132009; // arbitrary constant, shared by all workers

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    // Serialize migrations across all workers/instances. Blocks until acquired;
    // released explicitly below and also on connection close.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    const applied = new Set(rows.map(r => r.name));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrations] applying ${file}`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        // ON CONFLICT guards the case where the row was recorded out-of-band
        // (belt-and-suspenders alongside the advisory lock above).
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [file]
        );
        await client.query('COMMIT');
        ran++;
        console.log(`[migrations] applied  ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrations] FAILED   ${file}: ${err.message}`);
        throw err;
      }
    }

    if (ran === 0) {
      console.log(`[migrations] up to date (${applied.size} applied)`);
    } else {
      console.log(`[migrations] done — ran ${ran} migration(s)`);
    }
  } finally {
    // Release the session-level advisory lock. client.release() only returns the
    // connection to the pool without resetting session state, so a still-held
    // lock would persist on that pooled backend and block the next migrator. If
    // the explicit unlock fails, destroy the connection (release(true)) so the
    // stuck lock leaves the pool along with it.
    let unlockFailed = false;
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } catch (err) {
      unlockFailed = true;
      console.error(`[migrations] advisory unlock failed, destroying client: ${err.message}`);
    }
    client.release(unlockFailed);
  }
}

module.exports = runMigrations;
