'use strict';

/**
 * Automated PostgreSQL backup service — Linux/Docker compatible.
 *
 * Runs pg_dump every 5 minutes inside the container (pg_dump is available because
 * the Dockerfile installs postgresql-client). Keeps the last 48 dumps (~4 hours).
 * Dumps are gzip-compressed (.sql.gz) and stored in /app/backups/ which should be
 * mapped to a persistent volume in docker-compose.
 *
 * Start by calling backupService.start() — called automatically from createServices.
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const BACKUP_DIR   = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const MAX_BACKUPS  = Number(process.env.BACKUP_MAX_COUNT || 48); // 48 × 5 min = 4 hours
const INTERVAL_MS  = Number(process.env.BACKUP_INTERVAL_MS || 5 * 60 * 1000); // 5 minutes

// Resolve pg_dump across environments:
//   - Docker/Linux: postgresql-client installs it on PATH (/usr/bin).
//   - Windows factory servers: PostgreSQL installs to
//     C:\Program Files\PostgreSQL\<ver>\bin\pg_dump.exe, which is NOT added to
//     PATH by the installer — so a bare `pg_dump` spawn fails with ENOENT and
//     local backups silently never run. We scan the standard install dirs and
//     pick the newest version, with an env override for non-standard installs.
function resolvePgDump() {
  // 1. Explicit override always wins (full path to pg_dump[.exe], or a bin dir).
  const override = process.env.PG_DUMP_PATH || process.env.PG_DUMP || process.env.PGBIN;
  if (override) {
    const candidate = /pg_dump(\.exe)?$/i.test(override)
      ? override
      : path.join(override, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch (_) { /* fall through */ }
  }

  if (process.platform === 'win32') {
    // Scan C:\Program Files[ (x86)]\PostgreSQL\<ver>\bin\pg_dump.exe, newest first.
    const programDirs = [
      process.env.ProgramW6432,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)']
    ].filter(Boolean);

    const found = [];
    for (const base of programDirs) {
      const pgRoot = path.join(base, 'PostgreSQL');
      let versions = [];
      try { versions = fs.readdirSync(pgRoot); } catch (_) { continue; }
      for (const ver of versions) {
        const exe = path.join(pgRoot, ver, 'bin', 'pg_dump.exe');
        if (fs.existsSync(exe)) {
          const numericVersion = parseInt(String(ver).replace(/[^0-9].*$/, ''), 10) || 0;
          found.push({ exe, numericVersion });
        }
      }
    }
    if (found.length) {
      found.sort((a, b) => b.numericVersion - a.numericVersion); // newest major version first
      return found[0].exe;
    }
  } else {
    const candidates = ['/usr/bin/pg_dump', '/usr/local/bin/pg_dump'];
    for (const c of candidates) {
      try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) { /* try next */ }
    }
  }

  return 'pg_dump'; // last resort: rely on PATH
}

const PG_DUMP = resolvePgDump();

function resolveDbConfig() {
  return {
    host:     process.env.DB_HOST     || process.env.PGHOST     || 'localhost',
    port:     process.env.DB_PORT     || process.env.PGPORT     || '5432',
    user:     process.env.DB_USER     || process.env.PGUSER     || 'jms_v1',
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
    database: process.env.DB_NAME     || process.env.PGDATABASE || 'jms_v1'
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

function makeTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function runBackup() {
  ensureBackupDir();
  const db     = resolveDbConfig();
  const ts     = makeTimestamp();
  const gzPath = path.join(BACKUP_DIR, `backup_${ts}.sql.gz`);

  const env = {
    ...process.env,
    PGPASSWORD: db.password
  };

  const args = [
    '-h', db.host,
    '-p', db.port,
    '-U', db.user,
    '--no-password',
    '--format=plain',
    '--no-owner',
    '--no-acl',
    db.database
  ];

  console.log(`[Backup] Starting: ${path.basename(gzPath)}`);

  // Stream pg_dump stdout → gzip → file. Streaming (not execFile buffering) is
  // required: a buffered dump loads the ENTIRE database into memory, and once the
  // DB outgrew execFile's maxBuffer the dump aborted with "stdout maxBuffer length
  // exceeded" and no backup was written. A pipeline has no such ceiling.
  const child = spawn(PG_DUMP, args, { env });
  const gzip  = zlib.createGzip({ level: 6 });
  const out   = fs.createWriteStream(gzPath);

  let stderr = '';
  let failed = false;
  let fileFinished = false;
  let procCode = null; // set once pg_dump closes

  const fail = (msg) => {
    if (failed) return;
    failed = true;
    console.error('[Backup] pg_dump failed:', msg);
    try { child.kill(); } catch (_) {}
    // Remove empty/partial file if it was created
    out.destroy();
    try { if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath); } catch (_) {}
  };

  // Report success only when BOTH the process exited 0 AND the gzip→file pipeline
  // has fully flushed — otherwise a non-zero exit that arrives after the pipe
  // finishes would be logged as a successful (but truncated) backup.
  const finalize = () => {
    if (failed || !fileFinished || procCode === null) return;
    if (procCode !== 0) {
      fail(stderr.trim() || `pg_dump exited with code ${procCode}`);
      return;
    }
    let kb = 0;
    try { kb = Math.round(fs.statSync(gzPath).size / 1024); } catch (_) {}
    console.log(`[Backup] Saved: ${path.basename(gzPath)} (${kb} KB)`);
    rotateBackups();
  };

  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('error', (err) => fail(`spawn error (pg_dump not found?): ${err.message}`));
  gzip.on('error', (err) => fail(`gzip failed: ${err.message}`));
  out.on('error', (err) => fail(`write failed: ${err.message}`));

  child.stdout.pipe(gzip).pipe(out);

  child.on('close', (code) => { procCode = code; finalize(); });
  out.on('finish', () => { fileFinished = true; finalize(); });
}

function rotateBackups() {
  let files;
  try { files = fs.readdirSync(BACKUP_DIR); } catch (_) { return; }

  const dumps = files
    .filter(f => f.startsWith('backup_') && f.endsWith('.sql.gz'))
    .sort(); // ISO timestamp → lexicographic sort = chronological order

  if (dumps.length > MAX_BACKUPS) {
    const toDelete = dumps.slice(0, dumps.length - MAX_BACKUPS);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
        console.log(`[Backup] Rotated: ${f}`);
      } catch (err) {
        console.error(`[Backup] Rotation delete failed for ${f}:`, err.message);
      }
    }
  }
}

/**
 * List available backups (newest first).
 * Returns array of { filename, size, createdAt }.
 */
function listBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR);
    return files
      .filter(f => f.startsWith('backup_') && f.endsWith('.sql.gz'))
      .sort()
      .reverse()
      .map(f => {
        const fullPath = path.join(BACKUP_DIR, f);
        let size = 0;
        try { size = fs.statSync(fullPath).size; } catch (_) {}
        return { filename: f, size, path: fullPath };
      });
  } catch (_) {
    return [];
  }
}

let _timer = null;

function start() {
  if (_timer) return; // already started
  console.log(`[Backup] Service started. Interval: ${INTERVAL_MS / 60000} min. Max dumps: ${MAX_BACKUPS}. Dir: ${BACKUP_DIR}`);
  runBackup(); // run immediately on start
  _timer = setInterval(runBackup, INTERVAL_MS);
  if (_timer.unref) _timer.unref(); // don't keep process alive for backup alone
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, runBackup, listBackups };
