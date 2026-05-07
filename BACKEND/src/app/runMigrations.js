'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

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
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
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
}

module.exports = runMigrations;
