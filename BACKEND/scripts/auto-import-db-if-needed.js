'use strict';
/**
 * One-shot import before server.js (Docker entrypoint).
 *
 * Dump resolution (first match wins):
 *   1) AUTO_IMPORT_DB_PATH if set
 *   2) /seed/restore.dump, /seed/jms.dump, /seed/backup.dump
 *   3) /seed/*.dump (alphabetical first)
 *   4) /seed/*.sql (alphabetical first)
 *
 * Compose mounts ./seed → /seed by default. Put your PC pg_dump -Fc file as seed/restore.dump.
 *
 * - If `users` already has rows, import is skipped (set AUTO_IMPORT_DB_FORCE=1 to replace).
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const host = process.env.DB_HOST || process.env.PGHOST || 'localhost';
const port = Number(process.env.DB_PORT || process.env.PGPORT || 5432);
const user = process.env.DB_USER || process.env.PGUSER || 'postgres';
const password = String(process.env.DB_PASSWORD || process.env.PGPASSWORD || '');
const dbName = process.env.DB_NAME || process.env.PGDATABASE || 'jms_v1';

function assertSqlIdent(name, label) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`[auto-import] Refusing unsafe ${label} identifier: ${name}`);
  }
}

function conn(database) {
  return {
    host,
    port,
    user,
    password,
    database,
    connectionTimeoutMillis: 15000
  };
}

async function tableExists(client, table) {
  const r = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS ex`,
    [table]
  );
  return !!r.rows[0].ex;
}

function firstFileInDir(dir, ext) {
  if (!fs.existsSync(dir)) return '';
  const names = fs.readdirSync(dir).filter(n => n.endsWith(ext));
  names.sort();
  return names[0] ? path.join(dir, names[0]) : '';
}

function resolveDumpPath() {
  const explicit = process.env.AUTO_IMPORT_DB_PATH && String(process.env.AUTO_IMPORT_DB_PATH).trim();
  if (explicit) return explicit;

  const fixed = ['/seed/restore.dump', '/seed/jms.dump', '/seed/backup.dump'];
  for (const p of fixed) {
    if (fs.existsSync(p)) return p;
  }
  const anyDump = firstFileInDir('/seed', '.dump');
  if (anyDump) return anyDump;
  const anySql = firstFileInDir('/seed', '.sql');
  if (anySql) return anySql;
  return '';
}

async function main() {
  const dumpPathRaw = resolveDumpPath();
  if (!dumpPathRaw) {
    console.log('[auto-import] No seed file (./seed on host → /seed). Skipping.');
    return;
  }

  if (!fs.existsSync(dumpPathRaw)) {
    console.log('[auto-import] File not found:', dumpPathRaw, '- skipping.');
    return;
  }

  const dumpPath = fs.realpathSync(dumpPathRaw);  const force = process.env.AUTO_IMPORT_DB_FORCE === '1';

  assertSqlIdent(dbName, 'DB_NAME');
  assertSqlIdent(user, 'DB_USER');

  let usersExist = false;
  let userCount = 0;

  const probe = new Client(conn(dbName));
  try {
    await probe.connect();
    usersExist = await tableExists(probe, 'users');
    if (usersExist) {
      const c = await probe.query('SELECT COUNT(*)::int AS c FROM users');
      userCount = c.rows[0].c || 0;
    }
  } catch (e) {
    console.log('[auto-import] Target DB not ready or missing:', e.message);
    usersExist = false;
    userCount = 0;
  } finally {
    try {
      await probe.end();
    } catch (_) {
      /* ignore */
    }
  }

  const shouldImport = force || !usersExist || userCount === 0;
  if (!shouldImport) {
    console.log(
      '[auto-import] Database already has users; skipping import. Set AUTO_IMPORT_DB_FORCE=1 to replace from dump.'
    );
    return;
  }

  console.log('[auto-import] Importing', dumpPath, '→ database', dbName, force ? '(AUTO_IMPORT_DB_FORCE=1)' : '(empty / no users)');

  const admin = new Client(conn('postgres'));
  await admin.connect();
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName} OWNER ${user}`);
  await admin.end();

  const env = { ...process.env, PGPASSWORD: password };
  const isPlainSql = dumpPath.toLowerCase().endsWith('.sql');

  let result;
  if (isPlainSql) {
    result = spawnSync(
      'psql',
      ['-h', host, '-p', String(port), '-U', user, '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-f', dumpPath],
      { env, stdio: 'inherit' }
    );
  } else {
    result = spawnSync(
      'pg_restore',
      ['-h', host, '-p', String(port), '-U', user, '-d', dbName, '--no-owner', '--no-acl', '-v', dumpPath],
      { env, stdio: 'inherit' }
    );
  }

  if (result.error) {
    console.error('[auto-import] Failed to spawn psql/pg_restore:', result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error('[auto-import] Import exited with code', result.status);
    process.exit(result.status || 1);
  }

  console.log('[auto-import] Import finished successfully.');
}

main().catch(err => {
  console.error('[auto-import]', err);
  process.exit(1);
});
