'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// Arbitrary constant identifying the migration lock. All app instances must use
// the same value so they serialize against each other.
const MIGRATION_LOCK_ID = 776610042;

async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Serialize migrations across PM2 cluster workers / multiple app instances.
  // Without this, every worker boots and runs pending migrations in parallel;
  // when a migration does real work (e.g. 004 takes ~50s), the losers of the
  // race collide inserting into schema_migrations and crash with
  // "duplicate key value violates unique constraint schema_migrations_name_key",
  // failing the deploy health check. The lock holder migrates; the rest block
  // here, then find everything already applied. Held on a dedicated connection
  // for the whole run and released in finally.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    const applied = new Set(rows.map(r => r.name));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrations] applying ${file}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
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
      } finally {
        client.release();
      }
    }

    if (ran === 0) {
      console.log(`[migrations] up to date (${applied.size} applied)`);
    } else {
      console.log(`[migrations] done — ran ${ran} migration(s)`);
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } catch (_) { /* connection may already be gone; unlock is best-effort */ }
    lockClient.release();
  }
}

module.exports = runMigrations;
