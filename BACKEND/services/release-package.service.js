'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const APP_ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.resolve(APP_ROOT, '..');
const RELEASES_DIR = path.join(APP_ROOT, 'updates');
const CLIENT_BRIDGE_ROOT = path.resolve(APP_ROOT, '..', 'CLIENT_BRIDGE');

const CLIENT_BRIDGE_FILES = [
  'bridge.js',
  'find_scanner.js',
  'scan_ports.js',
  'package.json',
  'package-lock.json'
];

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
    "const crypto = require('crypto');",
    "const { spawn, spawnSync } = require('child_process');",
    '',
    "const rootDir = __dirname;",
    "const backendDir = path.join(rootDir, 'BACKEND');",
    "const clientBridgeDir = path.join(rootDir, 'CLIENT_BRIDGE');",
    "const RESTART_DELAY_MS = 3000;",
    "const BACKOFF_AFTER = 5;       // after this many fast crashes, slow down",
    "const BACKOFF_DELAY_MS = 30000; // 30 s between retries once in backoff",
    '',
    '// Auto-install BACKEND node_modules when package files change.',
    '// This fixes old factory packages after new backend dependencies are added.',
    'function getDependencySignature(rootDir) {',
    "  const hash = crypto.createHash('sha256');",
    "  ['package.json', 'package-lock.json'].forEach(function(fileName) {",
    '    var filePath = path.join(rootDir, fileName);',
    '    if (fs.existsSync(filePath)) {',
    '      hash.update(fileName);',
    '      hash.update(fs.readFileSync(filePath));',
    '    }',
    '  });',
    "  return hash.digest('hex');",
    '}',
    '',
    'function ensureBackendDeps() {',
    "  var pkgJson = path.join(backendDir, 'package.json');",
    '  if (!fs.existsSync(pkgJson)) return true;',
    "  var nodeModulesDir = path.join(backendDir, 'node_modules');",
    "  var markerPath = path.join(nodeModulesDir, '.jms-backend-deps.sha256');",
    '  var signature = getDependencySignature(backendDir);',
    "  var currentMarker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';",
    '  if (fs.existsSync(nodeModulesDir) && currentMarker === signature) return true;',
    "  console.log('[Supervisor] BACKEND dependencies changed/missing - running npm install...');",
    "  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';",
    "  const result = spawnSync(npm, ['install', '--production', '--no-audit'], {",
    "    cwd: backendDir, stdio: 'inherit', shell: false",
    '  });',
    '  if (result.status !== 0) {',
    "    console.error('[Supervisor] npm install for BACKEND failed - backend disabled until next restart.');",
    '    return false;',
    '  }',
    '  fs.mkdirSync(nodeModulesDir, { recursive: true });',
    "  fs.writeFileSync(markerPath, signature, 'utf8');",
    "  console.log('[Supervisor] BACKEND deps installed successfully.');",
    '  return true;',
    '}',
    '',
    '// Auto-install CLIENT_BRIDGE node_modules if ws (or any dep) is missing.',
    '// This handles: fresh install without running INSTALL_LOCAL_SERVER.bat,',
    '// and the first boot after an auto-update that added a new package.',
    'function ensureClientBridgeDeps() {',
    "  const wsModule = path.join(clientBridgeDir, 'node_modules', 'ws');",
    '  if (fs.existsSync(wsModule)) return true;',
    "  console.log('[Supervisor] CLIENT_BRIDGE node_modules missing — running npm install...');",
    "  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';",
    "  const result = spawnSync(npm, ['install', '--production', '--no-audit'], {",
    "    cwd: clientBridgeDir, stdio: 'inherit', shell: false",
    '  });',
    '  if (result.status !== 0) {',
    "    console.error('[Supervisor] npm install for CLIENT_BRIDGE failed — bridge disabled until next restart.');",
    '    return false;',
    '  }',
    "  console.log('[Supervisor] CLIENT_BRIDGE deps installed successfully.');",
    '  return true;',
    '}',
    '',
    'function startManagedProcess(label, cwd, scriptName, enabled) {',
    '  if (!enabled) return;',
    '  var failCount = 0;',
    '  function launch() {',
    '    var child = spawn(process.execPath, [scriptName], {',
    '      cwd: cwd,',
    "      stdio: 'inherit',",
    '      detached: false',
    '    });',
    "    child.on('exit', function(code) {",
    '      failCount++;',
    '      var delay = failCount >= BACKOFF_AFTER ? BACKOFF_DELAY_MS : RESTART_DELAY_MS;',
    "      console.log('[' + label + '] exited (code ' + code + '). Restart #' + failCount + ' in ' + (delay / 1000) + 's...');",
    '      setTimeout(launch, delay);',
    '    });',
    '  }',
    '  launch();',
    '}',
    '',
    'if (!fs.existsSync(path.join(backendDir, "server.js"))) {',
    "  console.error('[Supervisor] BACKEND/server.js not found.');",
    '  process.exit(1);',
    '}',
    '',
    "console.log('[Supervisor] Starting JMS local services...');",
    'var backendEnabled = ensureBackendDeps();',
    "startManagedProcess('Backend', backendDir, 'server.js', backendEnabled);",
    '',
    "var bridgeEnabled = fs.existsSync(path.join(clientBridgeDir, 'bridge.js'));",
    'if (bridgeEnabled) {',
    '  bridgeEnabled = ensureClientBridgeDeps();',
    '}',
    "startManagedProcess('Client Bridge', clientBridgeDir, 'bridge.js', bridgeEnabled);",
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

    // Include CLIENT_BRIDGE source files so auto-updates cover the bridge too.
    // node_modules are intentionally excluded — the supervisor auto-installs them
    // on first boot after update if the ws package is missing.
    for (const file of CLIENT_BRIDGE_FILES) {
      addFile(zip, path.join(CLIENT_BRIDGE_ROOT, file), path.posix.join('CLIENT_BRIDGE', file));
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
