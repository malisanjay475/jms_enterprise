'use strict';
/**
 * Used by docker-entrypoint.sh before server.js.
 * Waits until PostgreSQL accepts connections (database "postgres").
 */
require('dotenv').config();

const { Client } = require('pg');

const host = process.env.DB_HOST || process.env.PGHOST || 'localhost';
const port = Number(process.env.DB_PORT || process.env.PGPORT || 5432);
const user = process.env.DB_USER || process.env.PGUSER || 'postgres';
const password = String(process.env.DB_PASSWORD || process.env.PGPASSWORD || '');

const retries = Number(process.env.DB_WAIT_RETRIES || 45);
const delayMs = Number(process.env.DB_WAIT_DELAY_MS || 2000);

async function main() {
  for (let i = 0; i < retries; i++) {
    const client = new Client({
      host,
      port,
      user,
      password,
      database: 'postgres',
      connectionTimeoutMillis: 5000
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      console.log(`[wait-db] PostgreSQL reachable at ${host}:${port}.`);
      return;
    } catch (e) {
      try {
        await client.end();
      } catch (_) {
        /* ignore */
      }
      console.error(`[wait-db] Waiting (${i + 1}/${retries}): ${e.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error('[wait-db] Timed out waiting for PostgreSQL.');
  process.exit(1);
}

main();
