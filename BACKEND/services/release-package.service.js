'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const APP_ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.resolve(APP_ROOT, '..');
const RELEASES_DIR = path.join(APP_ROOT, 'updates');

const BACKEND_DIRECTORIES = [
  'PUBLIC',
  'middleware',
  'migrations',
  'nginx',
  'routes',
  'scripts',
  'services',
  'src',
  'utils',
  'REPORTS',
  'graphify-view'
];

const BACKEND_FILES = [
  'server.js',
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  '.dockerignore'
];

function sanitizeReleasePart(value, fallback = 'release') {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return raw || fallback;
}

function getPackageVersion() {
  const packageJson = require(path.join(APP_ROOT, 'package.json'));
  return packageJson.version || '0.0.0';
}

function getCurrentReleaseInfo(options = {}) {
  const version = options.version || getPackageVersion();
  const commit = String(options.commit || process.env.APP_GIT_SHA || '').trim();
  const shortCommit = commit ? commit.slice(0, 12) : '';
  const releaseId = shortCommit ? `${version}+${shortCommit}` : version;

  return {
    version,
    commit,
    shortCommit,
    releaseId
  };
}

function addFile(zip, sourcePath, zipPath) {
  if (!fs.existsSync(sourcePath)) return;
  zip.addFile(zipPath.replace(/\\/g, '/'), fs.readFileSync(sourcePath));
}

function addDirectory(zip, sourceDir, zipDir) {
  if (!fs.existsSync(sourceDir)) return;

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'uploads' || entry.name === 'tmp' || entry.name === 'updates') {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const zipEntryPath = path.posix.join(zipDir.replace(/\\/g, '/'), entry.name);

    if (entry.isDirectory()) {
      addDirectory(zip, sourcePath, zipEntryPath);
      continue;
    }

    if (
      entry.name === '.env' ||
      entry.name.startsWith('.env.backup') ||
      entry.name.startsWith('temp_update') ||
      entry.name.endsWith('.log')
    ) {
      continue;
    }

    addFile(zip, sourcePath, zipEntryPath);
  }
}

function buildSupervisorScript() {
  return [
    "'use strict';",
    '',
    "const fs = require('fs');",
    "const path = require('path');",
    "const { spawn } = require('child_process');",
    '',
    "const rootDir = __dirname;",
    "const backendDir = path.join(rootDir, 'BACKEND');",
    "const clientBridgeDir = path.join(rootDir, 'CLIENT_BRIDGE');",
    "const restartDelayMs = 3000;",
    '',
    'function startManagedProcess(label, cwd, scriptName, enabled) {',
    '  if (!enabled) return null;',
    '  const child = spawn(process.execPath, [scriptName], {',
    '    cwd,',
    "    stdio: 'inherit',",
    '    detached: false',
    '  });',
    '',
    "  child.on('exit', code => {",
    "    console.log('[' + label + '] exited with code ' + code + '. Restarting in ' + restartDelayMs + 'ms...');",
    "    setTimeout(() => startManagedProcess(label, cwd, scriptName, enabled), restartDelayMs);",
    '  });',
    '',
    '  return child;',
    '}',
    '',
    'if (!fs.existsSync(path.join(backendDir, "server.js"))) {',
    "  console.error('[Supervisor] BACKEND/server.js not found.');",
    '  process.exit(1);',
    '}',
    '',
    "console.log('[Supervisor] Starting JMS local services...');",
    "startManagedProcess('Backend', backendDir, 'server.js', true);",
    "startManagedProcess('Client Bridge', clientBridgeDir, 'bridge.js', fs.existsSync(path.join(clientBridgeDir, 'bridge.js')));",
    ''
  ].join('\r\n');
}

function buildStartBat() {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo [ERROR] Node.js is not installed or not in PATH.',
    '  pause',
    '  exit /b 1',
    ')',
    'if not exist "%~dp0LOCAL_SERVER_SUPERVISOR.js" (',
    '  echo [ERROR] LOCAL_SERVER_SUPERVISOR.js was not found.',
    '  pause',
    '  exit /b 1',
    ')',
    'start "JMS Local Supervisor" cmd /k "cd /d %~dp0 && node LOCAL_SERVER_SUPERVISOR.js"',
    'exit /b 0'
  ].join('\r\n');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildReleaseManifest(releaseInfo) {
  return {
    version: releaseInfo.version,
    commit: releaseInfo.commit,
    releaseId: releaseInfo.releaseId,
    builtAt: new Date().toISOString()
  };
}

function buildCurrentReleasePackage(options = {}) {
  const releaseInfo = getCurrentReleaseInfo(options);
  ensureDir(RELEASES_DIR);

  const releaseFileName = `local-release-${sanitizeReleasePart(releaseInfo.releaseId, 'current')}.zip`;
  const releasePath = path.join(RELEASES_DIR, releaseFileName);
  const manifestPath = path.join(RELEASES_DIR, `${releaseFileName}.json`);

  if (!fs.existsSync(releasePath)) {
    const zip = new AdmZip();

    for (const file of BACKEND_FILES) {
      addFile(zip, path.join(APP_ROOT, file), path.posix.join('BACKEND', file));
    }

    for (const dir of BACKEND_DIRECTORIES) {
      addDirectory(zip, path.join(APP_ROOT, dir), path.posix.join('BACKEND', dir));
    }

    zip.addFile(
      path.posix.join('BACKEND', 'runtime-release.json'),
      Buffer.from(JSON.stringify(buildReleaseManifest(releaseInfo), null, 2), 'utf8')
    );
    zip.addFile(
      'LOCAL_SERVER_SUPERVISOR.js',
      Buffer.from(buildSupervisorScript(), 'utf8')
    );
    zip.addFile(
      'START_LOCAL_SERVER.bat',
      Buffer.from(buildStartBat(), 'utf8')
    );
    zip.addFile(
      'RELEASE_MANIFEST.json',
      Buffer.from(JSON.stringify(buildReleaseManifest(releaseInfo), null, 2), 'utf8')
    );

    zip.writeZip(releasePath);
  }

  const fileBuffer = fs.readFileSync(releasePath);
  const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      ...buildReleaseManifest(releaseInfo),
      fileName: releaseFileName,
      checksum
    }, null, 2),
    'utf8'
  );

  return {
    ...releaseInfo,
    checksum,
    fileName: releaseFileName,
    filePath: releasePath,
    publicPath: `/api/update/download?release=${encodeURIComponent(releaseInfo.releaseId)}`
  };
}

module.exports = {
  APP_ROOT,
  PACKAGE_ROOT,
  RELEASES_DIR,
  buildCurrentReleasePackage,
  getCurrentReleaseInfo
};
