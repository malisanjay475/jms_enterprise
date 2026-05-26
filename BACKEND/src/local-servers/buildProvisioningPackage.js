'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

// In development:  __dirname = .../jms_enterprise/BACKEND/src/local-servers
//                  2 levels up = .../jms_enterprise/BACKEND  ✓
// In Docker:       __dirname = /app/src/local-servers  (BACKEND contents copied to /app)
//                  2 levels up = /app  ✓
// OLD code used 3 levels up + joined 'BACKEND' → resolved to /BACKEND in Docker (missing)
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const CLIENT_BRIDGE_ROOT = path.join(REPO_ROOT, 'CLIENT_BRIDGE');

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

const CLIENT_BRIDGE_FILES = [
  'bridge.js',
  'find_scanner.js',
  'scan_ports.js',
  'package.json',
  'package-lock.json'
];

function sanitizeFilePart(value, fallback) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return raw || fallback;
}

function addFile(zip, sourcePath, zipPath) {
  if (!fs.existsSync(sourcePath)) return;
  zip.addFile(zipPath.replace(/\\/g, '/'), fs.readFileSync(sourcePath));
}

function addDirectory(zip, sourceDir, zipDir) {
  if (!fs.existsSync(sourceDir)) return;

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'uploads' || entry.name === 'tmp') continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const nextZipPath = path.posix.join(zipDir.replace(/\\/g, '/'), entry.name);

    if (entry.isDirectory()) {
      addDirectory(zip, sourcePath, nextZipPath);
      continue;
    }

    if (
      entry.name === '.env' ||
      entry.name.startsWith('.env.backup') ||
      entry.name.startsWith('tmp-local-server') ||
      entry.name.endsWith('.log')
    ) {
      continue;
    }

    addFile(zip, sourcePath, nextZipPath);
  }
}

function buildBackendEnv({ localServer, nodeKey, mainServerUrl, syncApiKey }) {
  return [
    'NODE_ENV=production',
    `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    'PORT=3001',
    'HTTPS_PORT=3444',
    '',
    '# Local PostgreSQL for this factory server',
    'DB_HOST=localhost',
    'DB_PORT=5432',
    'DB_USER=jms_v1',
    'DB_PASSWORD=replace_with_local_db_password',
    'DB_NAME=jms_v1',
    '',
    '# Main VPS connection',
    'SERVER_TYPE=LOCAL',
    `MAIN_SERVER_URL=${mainServerUrl}`,
    `LOCAL_FACTORY_ID=${localServer.factoryId}`,
    `SYNC_API_KEY=${syncApiKey || ''}`,
    'GEMINI_API_KEY=',
    `APP_GIT_SHA=${process.env.APP_GIT_SHA || ''}`,
    '',
    '# Local server agent registration',
    'LOCAL_SERVER_AGENT_ENABLED=1',
    `LOCAL_SERVER_NODE_ID=${localServer.id}`,
    `LOCAL_SERVER_NODE_KEY=${nodeKey}`,
    'LOCAL_SERVER_PUBLIC_IP=',
    'LOCAL_SERVER_HEARTBEAT_INTERVAL_MS=60000',
    ''
  ].join('\n');
}

function buildReadme({ localServer, mainServerUrl }) {
  return [
    '# JMS Local Server Installer',
    '',
    `Factory: ${localServer.factoryName || localServer.factoryId}`,
    `Node: ${localServer.nodeName || localServer.nodeCode || localServer.id}`,
    `Main Site: ${mainServerUrl}`,
    '',
    '## Install',
    '1. Extract this zip on the factory computer.',
    '2. Make sure Node.js LTS and PostgreSQL 14+ are installed on that computer.',
    '3. Run INSTALL_LOCAL_SERVER.bat.',
    '4. The installer will ask for the local PostgreSQL details and save BACKEND/.env for you.',
    '5. The default local JMS port is 3001. If another app already uses it, enter any free port.',
    '6. Create or restore the local jms_v1 PostgreSQL database for this factory if it is not ready yet.',
    '7. Run START_LOCAL_SERVER.bat.',
    '8. (Recommended) Run REGISTER_AUTOSTART.bat as Administrator so the server starts on every reboot.',
    '',
    '## Auto-update',
    '- The server checks the main site for code updates every 5 minutes and restarts itself automatically.',
    '- Database migrations run automatically on every startup — no manual SQL needed.',
    '',
    '## Auto-restart',
    '- If the server crashes, the supervisor restarts it within 3 seconds.',
    '- After running REGISTER_AUTOSTART.bat, it also starts automatically on Windows reboot.',
    '',
    '## Result',
    '- The local server will register itself to the main site automatically.',
    '- The Local Servers screen on the main site will show IP, heartbeat, and version after registration.',
    '- Open the local app on the port saved in BACKEND/.env, for example http://localhost:3001.',
    '',
    '## Important',
    '- This package contains the node registration key for this local server.',
    '- If you download a fresh installer later, use the newest package and discard the old one.'
  ].join('\r\n');
}

function buildInstallBat() {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'echo ================================================',
    'echo         JMS LOCAL SERVER INSTALLER',
    'echo ================================================',
    'echo.',
    'echo TIP: Open SETUP.html in your browser for a visual step-by-step guide.',
    'echo.',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo [ERROR] Node.js is not installed. Install Node.js LTS first.',
    '  echo         Download from: https://nodejs.org',
    '  pause',
    '  exit /b 1',
    ')',
    'if not exist INSTALL_LOCAL_SERVER.js (',
    '  echo [ERROR] INSTALL_LOCAL_SERVER.js was not found in this package.',
    '  pause',
    '  exit /b 1',
    ')',
    'node INSTALL_LOCAL_SERVER.js',
    'if errorlevel 1 (',
    '  echo.',
    '  echo [ERROR] Installer failed. See message above for details.',
    '  echo         Open SETUP.html for troubleshooting tips.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo.',
    'echo [SUCCESS] Installation complete. Run START_LOCAL_SERVER.bat to start the server.',
    'pause'
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
    '  echo [ERROR] LOCAL_SERVER_SUPERVISOR.js was not found in this package.',
    '  pause',
    '  exit /b 1',
    ')',
    'start "JMS Local Supervisor" cmd /k "cd /d %~dp0 && node LOCAL_SERVER_SUPERVISOR.js"',
    'exit /b 0'
  ].join('\r\n');
}

function buildSupervisorJs() {
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
    "if (!fs.existsSync(path.join(backendDir, 'server.js'))) {",
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

function buildInstallerJs() {
  return [
    "'use strict';",
    '',
    "const fs = require('fs');",
    "const path = require('path');",
    "const crypto = require('crypto');",
    "const readline = require('readline');",
    "const { spawnSync } = require('child_process');",
    '',
    "const rootDir = __dirname;",
    "const backendDir = path.join(rootDir, 'BACKEND');",
    "const clientBridgeDir = path.join(rootDir, 'CLIENT_BRIDGE');",
    "const backendEnvPath = path.join(backendDir, '.env');",
    '',
    'function loadEnv(filePath) {',
    "  const map = new Map();",
    "  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';",
    "  for (const line of raw.split(/\\r?\\n/)) {",
    "    if (!line || /^\\s*#/.test(line) || !line.includes('=')) continue;",
    "    const eqIndex = line.indexOf('=');",
    "    const key = line.slice(0, eqIndex).trim();",
    "    const value = line.slice(eqIndex + 1);",
    "    if (key) map.set(key, value);",
    '  }',
    '  return map;',
    '}',
    '',
    'function saveEnv(filePath, envMap) {',
    '  const lines = [',
    "    'NODE_ENV=' + (envMap.get('NODE_ENV') || 'production'),",
    "    'JWT_SECRET=' + (envMap.get('JWT_SECRET') || crypto.randomBytes(32).toString('hex')),",
    "    'PORT=' + (envMap.get('PORT') || '3001'),",
    "    'HTTPS_PORT=' + (envMap.get('HTTPS_PORT') || '3444'),",
    "    '',",
    "    '# Local PostgreSQL for this factory server',",
    "    'DB_HOST=' + (envMap.get('DB_HOST') || 'localhost'),",
    "    'DB_PORT=' + (envMap.get('DB_PORT') || '5432'),",
    "    'DB_USER=' + (envMap.get('DB_USER') || 'jms_v1'),",
    "    'DB_PASSWORD=' + (envMap.get('DB_PASSWORD') || ''),",
    "    'DB_NAME=' + (envMap.get('DB_NAME') || 'jms_v1'),",
    "    '',",
    "    '# Main VPS connection',",
    "    'SERVER_TYPE=' + (envMap.get('SERVER_TYPE') || 'LOCAL'),",
    "    'MAIN_SERVER_URL=' + (envMap.get('MAIN_SERVER_URL') || ''),",
    "    'LOCAL_FACTORY_ID=' + (envMap.get('LOCAL_FACTORY_ID') || ''),",
    "    'SYNC_API_KEY=' + (envMap.get('SYNC_API_KEY') || ''),",
    "    'GEMINI_API_KEY=' + (envMap.get('GEMINI_API_KEY') || ''),",
    "    'APP_GIT_SHA=' + (envMap.get('APP_GIT_SHA') || 'local-installer'),",
    "    '',",
    "    '# Local server agent registration',",
    "    'LOCAL_SERVER_AGENT_ENABLED=' + (envMap.get('LOCAL_SERVER_AGENT_ENABLED') || '1'),",
    "    'LOCAL_SERVER_NODE_ID=' + (envMap.get('LOCAL_SERVER_NODE_ID') || ''),",
    "    'LOCAL_SERVER_NODE_KEY=' + (envMap.get('LOCAL_SERVER_NODE_KEY') || ''),",
    "    'LOCAL_SERVER_PUBLIC_IP=' + (envMap.get('LOCAL_SERVER_PUBLIC_IP') || ''),",
    "    'LOCAL_SERVER_HEARTBEAT_INTERVAL_MS=' + (envMap.get('LOCAL_SERVER_HEARTBEAT_INTERVAL_MS') || '60000'),",
    "    ''",
    '  ];',
    "  fs.writeFileSync(filePath, lines.join('\\r\\n'), 'utf8');",
    '}',
    '',
    'function askQuestion(rl, label, defaultValue) {',
    "  const suffix = defaultValue ? ' [' + defaultValue + ']' : '';",
    "  return new Promise(resolve => rl.question(label + suffix + ': ', answer => {",
    "    const trimmed = String(answer || '').trim();",
    '    resolve(trimmed || defaultValue || \'\');',
    '  }));',
    '}',
    '',
    'function normalizePort(value, fallback) {',
    "  const n = Number(String(value || '').trim());",
    '  return Number.isInteger(n) && n >= 1 && n <= 65535 ? String(n) : fallback;',
    '}',
    '',
    'function askYesNo(rl, label, defaultYes = true) {',
    "  const hint = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';",
    "  return new Promise(resolve => rl.question(label + hint, answer => {",
    "    const normalized = String(answer || '').trim().toLowerCase();",
    "    if (!normalized) return resolve(defaultYes);",
    "    resolve(['y', 'yes', '1', 'true'].includes(normalized));",
    '  }));',
    '}',
    '',
    'function runCommand(command, args, cwd) {',
    '  const result = spawnSync(command, args, {',
    '    cwd,',
    "    stdio: 'inherit',",
    "    shell: process.platform === 'win32'",
    '  });',
    '  if (result.status !== 0) {',
    "    throw new Error(command + ' ' + args.join(' ') + ' failed with exit code ' + result.status);",
    '  }',
    '}',
    '',
    'async function main() {',
    "  console.log('===============================================');",
    "  console.log('        JMS LOCAL SERVER INSTALLER');",
    "  console.log('===============================================');",
    "  console.log('');",
    '',
    '  const envMap = loadEnv(backendEnvPath);',
    '  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });',
    '',
    '  try {',
    "    console.log('This installer will save local DB settings and install the required packages.');",
    "    console.log('');",
    "    envMap.set('DB_HOST', await askQuestion(rl, 'Local PostgreSQL host', envMap.get('DB_HOST') || 'localhost'));",
    "    envMap.set('DB_PORT', await askQuestion(rl, 'Local PostgreSQL port', envMap.get('DB_PORT') || '5432'));",
    "    envMap.set('DB_USER', await askQuestion(rl, 'Local PostgreSQL user', envMap.get('DB_USER') || 'jms_v1'));",
    "    envMap.set('DB_NAME', await askQuestion(rl, 'Local PostgreSQL database name', envMap.get('DB_NAME') || 'jms_v1'));",
    "    envMap.set('DB_PASSWORD', await askQuestion(rl, 'Local PostgreSQL password', envMap.get('DB_PASSWORD') || ''));",
    "    envMap.set('PORT', normalizePort(await askQuestion(rl, 'Local JMS app port', envMap.get('PORT') || '3001'), '3001'));",
    "    envMap.set('HTTPS_PORT', normalizePort(await askQuestion(rl, 'Local JMS HTTPS port (only used when HTTPS is enabled)', envMap.get('HTTPS_PORT') || '3444'), '3444'));",
    "    envMap.set('MAIN_SERVER_URL', await askQuestion(rl, 'Main site URL', envMap.get('MAIN_SERVER_URL') || ''));",
    "    envMap.set('LOCAL_FACTORY_ID', await askQuestion(rl, 'Factory ID', envMap.get('LOCAL_FACTORY_ID') || ''));",
    "    saveEnv(backendEnvPath, envMap);",
    "    console.log('');",
    "    console.log('[DONE] BACKEND/.env updated successfully.');",
    '',
    '    if (await askYesNo(rl, \'Install backend dependencies now?\', true)) {',
    "      console.log('');",
    "      console.log('[INFO] Installing backend dependencies (this may take a minute)...');",
    "      runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--production', '--no-audit'], backendDir);",
    '    }',
    '',
    "    if (fs.existsSync(path.join(clientBridgeDir, 'package.json'))) {",
    "      console.log('');",
    "      console.log('[INFO] Installing client bridge dependencies...');",
    "      runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--production', '--no-audit'], clientBridgeDir);",
    '    }',
    '',
    "    console.log('');",
    "    console.log('[NEXT] If the local database is not ready yet, restore/create it now.');",
    "    console.log('[NEXT] Then run START_LOCAL_SERVER.bat to connect this factory server to the main site.');",
    '  } finally {',
    '    rl.close();',
    '  }',
    '}',
    '',
    "main().catch(error => {",
    "  console.error('[ERROR]', error.message);",
    '  process.exitCode = 1;',
    '});',
    ''
  ].join('\r\n');
}

function buildAutostartBat() {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'echo ================================================',
    'echo     JMS LOCAL SERVER - REGISTER AUTOSTART',
    'echo ================================================',
    'echo.',
    'echo This will register JMS Local Server to start automatically',
    'echo when Windows starts, even after a reboot.',
    'echo.',
    'echo IMPORTANT: Run this as Administrator for best results.',
    'echo.',
    ':: Get full path of node.exe',
    'for /f "tokens=*" %%i in (\'where node 2^>nul\') do set "NODE_EXE=%%i" & goto :found_node',
    ':found_node',
    'if not defined NODE_EXE (',
    '  echo [ERROR] Node.js not found in PATH. Install Node.js LTS first.',
    '  pause',
    '  exit /b 1',
    ')',
    ':: Full path to supervisor script',
    'set "SUPERVISOR=%~dp0LOCAL_SERVER_SUPERVISOR.js"',
    'if not exist "%SUPERVISOR%" (',
    '  echo [ERROR] LOCAL_SERVER_SUPERVISOR.js not found.',
    '  pause',
    '  exit /b 1',
    ')',
    ':: Register Task Scheduler entry',
    'schtasks /create /tn "JMS Local Server" /tr "\"%NODE_EXE%\" \"%SUPERVISOR%\"" /sc onlogon /rl highest /f',
    'if errorlevel 1 (',
    '  echo.',
    '  echo [WARN] Task Scheduler registration failed. Trying startup folder fallback...',
    '  set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
    '  echo @echo off > "%STARTUP%\\JMS_Local_Server.bat"',
    '  echo start "" /b "%NODE_EXE%" "%SUPERVISOR%" >> "%STARTUP%\\JMS_Local_Server.bat"',
    '  echo [OK] Added to Windows Startup folder: %STARTUP%\\JMS_Local_Server.bat',
    ') else (',
    '  echo.',
    '  echo [OK] Registered as Windows Task Scheduler task "JMS Local Server".',
    '  echo      The server will start automatically on next Windows login/reboot.',
    ')',
    'echo.',
    'pause'
  ].join('\r\n');
}

function buildOpenSetupBat() {
  return [
    '@echo off',
    'cd /d "%~dp0"',
    'echo Starting JMS Setup...',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo Node.js not found - opening HTML directly...',
    '  start "" "%~dp0SETUP.html"',
    '  exit /b 0',
    ')',
    'node "%~dp0OPEN_SETUP.js"',
    'exit /b 0'
  ].join('\r\n');
}

function buildOpenSetupJs() {
  return [
    "'use strict';",
    "const http = require('http');",
    "const fs   = require('fs');",
    "const path = require('path');",
    "const { exec } = require('child_process');",
    '',
    "const htmlFile = path.join(__dirname, 'SETUP.html');",
    "const server = http.createServer((req, res) => {",
    "  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });",
    "  fs.createReadStream(htmlFile).pipe(res);",
    '});',
    '',
    'server.listen(0, "127.0.0.1", () => {',
    "  const port = server.address().port;",
    "  const url  = 'http://127.0.0.1:' + port + '/setup';",
    "  console.log('[JMS Setup] Opening ' + url);",
    "  const cmd = process.platform === 'win32'",
    "    ? 'start \"\" \"' + url + '\"'",
    "    : process.platform === 'darwin' ? 'open \"' + url + '\"' : 'xdg-open \"' + url + '\"';",
    '  exec(cmd);',
    "  console.log('[JMS Setup] Browser opened. Press Ctrl+C to close this window when done.');",
    '});',
    ''
  ].join('\r\n');
}

function buildInstallerHtml({ localServer, mainServerUrl }) {
  const factoryName = localServer.factoryName || localServer.factoryId || 'Factory';
  const nodeName    = localServer.nodeName || localServer.nodeCode || localServer.id;

  return `<!DOCTYPE html>
<!-- saved from url=(0014)about:internet -->
<html lang="en">
<head>
<meta charset="UTF-8">
<title>JMS Local Server Setup — ${factoryName}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
    background: #f0f4f8;
    color: #1a202c;
    min-height: 100vh;
  }

  /* Header */
  .header {
    background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
    color: white;
    padding: 28px 40px 24px;
  }
  .header-row { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
  .logo-box {
    width: 48px; height: 48px; border-radius: 12px;
    background: rgba(255,255,255,0.2);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 900; letter-spacing: -1px;
    flex-shrink: 0;
  }
  .header h1 { font-size: 22px; font-weight: 700; }
  .header .sub { font-size: 13px; opacity: 0.8; margin-top: 4px; }
  .badge-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  .badge {
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.25);
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
  }

  /* Steps */
  .steps-bar {
    background: white;
    border-bottom: 1px solid #e2e8f0;
    padding: 0 40px;
    display: flex;
    gap: 0;
  }
  .step-tab {
    padding: 14px 20px;
    font-size: 12px;
    font-weight: 600;
    color: #94a3b8;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    transition: color .15s, border-color .15s;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .step-tab.active { color: #1d4ed8; border-bottom-color: #1d4ed8; }
  .step-tab.done { color: #16a34a; border-bottom-color: #16a34a; }
  .step-num {
    width: 20px; height: 20px; border-radius: 50%;
    background: #e2e8f0; color: #64748b;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700;
    flex-shrink: 0;
  }
  .step-tab.active .step-num { background: #1d4ed8; color: white; }
  .step-tab.done   .step-num { background: #16a34a; color: white; }

  /* Content */
  .content { max-width: 780px; margin: 0 auto; padding: 32px 24px; }
  .page { display: none; }
  .page.active { display: block; }

  /* Cards */
  .card {
    background: white;
    border-radius: 12px;
    box-shadow: 0 1px 4px rgba(0,0,0,.08);
    padding: 24px 28px;
    margin-bottom: 20px;
  }
  .card h2 { font-size: 16px; font-weight: 700; margin-bottom: 4px; color: #1e293b; }
  .card .desc { font-size: 13px; color: #64748b; margin-bottom: 18px; line-height: 1.55; }

  /* Checklist */
  .check-list { list-style: none; }
  .check-item {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .check-item:last-child { border-bottom: none; }
  .check-icon {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; flex-shrink: 0; margin-top: 1px;
  }
  .check-icon.ok   { background: #dcfce7; color: #16a34a; }
  .check-icon.warn { background: #fef9c3; color: #b45309; }
  .check-icon.info { background: #dbeafe; color: #1d4ed8; }
  .check-label { font-size: 14px; font-weight: 600; color: #1e293b; }
  .check-sub   { font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.4; }

  /* Steps list */
  .steps-list { counter-reset: steps; }
  .step-item {
    counter-increment: steps;
    display: flex; gap: 16px;
    margin-bottom: 20px;
  }
  .step-item::before {
    content: counter(steps);
    min-width: 28px; height: 28px; border-radius: 50%;
    background: #dbeafe; color: #1d4ed8;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700;
    flex-shrink: 0; margin-top: 1px;
  }
  .step-item h3 { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
  .step-item p  { font-size: 13px; color: #475569; line-height: 1.5; }

  /* Code box */
  .code {
    background: #0f172a;
    color: #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 13px;
    margin: 10px 0;
    white-space: pre-wrap;
    word-break: break-all;
    position: relative;
  }
  .copy-btn {
    position: absolute; top: 8px; right: 8px;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: #94a3b8;
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
    transition: background .15s;
  }
  .copy-btn:hover { background: rgba(255,255,255,0.2); color: white; }

  /* Info box */
  .info-box {
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 13px;
    line-height: 1.5;
    margin: 12px 0;
  }
  .info-box.blue { background: #eff6ff; border-left: 3px solid #2563eb; color: #1e40af; }
  .info-box.green { background: #f0fdf4; border-left: 3px solid #16a34a; color: #166534; }
  .info-box.yellow { background: #fffbeb; border-left: 3px solid #f59e0b; color: #92400e; }

  /* Field display */
  .field-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .field-row:last-child { border-bottom: none; }
  .field-label { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  .field-val   { font-size: 13px; font-weight: 600; color: #1e293b; font-family: 'Consolas', monospace; }

  /* Buttons */
  .btn-row { display: flex; gap: 10px; margin-top: 20px; }
  .btn {
    padding: 10px 22px; border-radius: 8px;
    font-size: 14px; font-weight: 600;
    border: none; cursor: pointer;
    transition: opacity .15s;
    text-decoration: none;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .btn:hover { opacity: .85; }
  .btn-primary { background: linear-gradient(135deg, #1d4ed8, #2563eb); color: white; }
  .btn-secondary { background: #e2e8f0; color: #475569; }
  .btn-success { background: linear-gradient(135deg, #16a34a, #15803d); color: white; }

  /* Nav */
  .nav-row { display: flex; justify-content: space-between; align-items: center; margin-top: 28px; }

  /* Footer */
  .footer { text-align: center; padding: 24px; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>

<div class="header">
  <div class="header-row">
    <div class="logo-box">JM</div>
    <div>
      <h1>JMS Local Server Setup</h1>
      <div class="sub">Factory setup wizard — follow each step to install the local server</div>
    </div>
  </div>
  <div class="badge-row">
    <span class="badge">🏭 ${factoryName}</span>
    <span class="badge">🖥 Node: ${nodeName}</span>
    <span class="badge">🌐 ${mainServerUrl}</span>
  </div>
</div>

<div class="steps-bar">
  <div class="step-tab active" id="tab-1" onclick="goStep(1)">
    <span class="step-num">1</span> Prerequisites
  </div>
  <div class="step-tab" id="tab-2" onclick="goStep(2)">
    <span class="step-num">2</span> Install
  </div>
  <div class="step-tab" id="tab-3" onclick="goStep(3)">
    <span class="step-num">3</span> Configure DB
  </div>
  <div class="step-tab" id="tab-4" onclick="goStep(4)">
    <span class="step-num">4</span> Start &amp; Verify
  </div>
</div>

<div class="content">

  <!-- PAGE 1: Prerequisites -->
  <div class="page active" id="page-1">
    <div class="card">
      <h2>Check Prerequisites</h2>
      <p class="desc">Before installing, make sure these are set up on this computer.</p>
      <ul class="check-list">
        <li class="check-item">
          <div class="check-icon info">🟦</div>
          <div>
            <div class="check-label">Node.js LTS (v18 or newer)</div>
            <div class="check-sub">Download from <strong>nodejs.org</strong> — choose the LTS version. After install, verify by opening CMD and typing: <code>node --version</code></div>
          </div>
        </li>
        <li class="check-item">
          <div class="check-icon info">🐘</div>
          <div>
            <div class="check-label">PostgreSQL 14 or newer</div>
            <div class="check-sub">Download from <strong>postgresql.org/download/windows</strong>. During setup, note the password you set for the <strong>postgres</strong> user — you'll need it to create the JMS database.</div>
          </div>
        </li>
        <li class="check-item">
          <div class="check-icon info">🗄</div>
          <div>
            <div class="check-label">JMS database created in PostgreSQL</div>
            <div class="check-sub">
              Open <strong>pgAdmin</strong> (installed with PostgreSQL) and create:<br>
              • User: <code>jms_v1</code>&nbsp; Password: (your choice)<br>
              • Database: <code>jms_v1</code>&nbsp; Owner: <code>jms_v1</code><br>
              Or run the SQL commands on Step 3 of this guide.
            </div>
          </div>
        </li>
        <li class="check-item">
          <div class="check-icon ok">✓</div>
          <div>
            <div class="check-label">This package extracted completely</div>
            <div class="check-sub">You're reading this file, so the ZIP was extracted correctly. Make sure all files are in the same folder.</div>
          </div>
        </li>
      </ul>
    </div>

    <div class="card">
      <h2>Quick Check Commands</h2>
      <p class="desc">Open <strong>Command Prompt</strong> (press Win+R → type <code>cmd</code> → Enter) and run:</p>
      <div class="code">node --version<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
      <div class="code">npm --version<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
      <div class="info-box blue">If you see version numbers like <strong>v20.x.x</strong> and <strong>10.x.x</strong>, Node.js is ready. If you see an error, install Node.js first.</div>
    </div>

    <div class="nav-row">
      <span></span>
      <button class="btn btn-primary" onclick="goStep(2)">Next: Install →</button>
    </div>
  </div>

  <!-- PAGE 2: Install -->
  <div class="page" id="page-2">
    <div class="card">
      <h2>Run the Installer</h2>
      <p class="desc">The installer will ask for your local PostgreSQL password and install required packages automatically.</p>
      <div class="steps-list">
        <div class="step-item">
          <div>
            <h3>Double-click INSTALL_LOCAL_SERVER.bat</h3>
            <p>Find the file <strong>INSTALL_LOCAL_SERVER.bat</strong> in the same folder as this HTML file. Double-click it.</p>
          </div>
        </div>
        <div class="step-item">
          <div>
            <h3>Answer the questions</h3>
            <p>The installer will ask for your local PostgreSQL host, port, user, database name, and password. Use the defaults (press Enter) for most unless you changed them.</p>
            <div class="info-box yellow">⚠ The <strong>password</strong> is the one you set for <code>jms_v1</code> user in PostgreSQL — not the Windows password.</div>
          </div>
        </div>
        <div class="step-item">
          <div>
            <h3>Wait for package install to finish</h3>
            <p>It will run <code>npm install</code> to download backend packages. This takes 1-3 minutes on first run. A green <strong>[DONE]</strong> message confirms success.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>If INSTALL_LOCAL_SERVER.bat flashes and closes</h2>
      <p class="desc">Open CMD manually and run the installer from the command line to see the error:</p>
      <div class="code">cd /d "C:\\Path\\To\\This\\Folder"<br>node INSTALL_LOCAL_SERVER.js<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
      <div class="info-box blue">Replace <code>C:\\Path\\To\\This\\Folder</code> with the actual path of this folder. You can copy the path from the address bar in Windows Explorer.</div>
    </div>
    <div class="nav-row">
      <button class="btn btn-secondary" onclick="goStep(1)">← Back</button>
      <button class="btn btn-primary" onclick="goStep(3)">Next: Configure DB →</button>
    </div>
  </div>

  <!-- PAGE 3: Configure DB -->
  <div class="page" id="page-3">
    <div class="card">
      <h2>Database Setup</h2>
      <p class="desc">If you haven't created the PostgreSQL database yet, use these SQL commands in <strong>pgAdmin</strong> or <strong>psql</strong>.</p>
      <div class="code">-- Run as postgres superuser:
CREATE USER jms_v1 WITH PASSWORD 'your_password_here';
CREATE DATABASE jms_v1 OWNER jms_v1;
GRANT ALL PRIVILEGES ON DATABASE jms_v1 TO jms_v1;<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
      <div class="info-box yellow">⚠ Replace <code>your_password_here</code> with the password you want. Remember it — you'll need it in <code>BACKEND/.env</code>.</div>
    </div>
    <div class="card">
      <h2>Your Server Details</h2>
      <p class="desc">These are pre-configured in your <code>BACKEND/.env</code> file from this package.</p>
      <div class="field-row">
        <span class="field-label">Main Server URL</span>
        <span class="field-val">${mainServerUrl}</span>
      </div>
      <div class="field-row">
        <span class="field-label">Factory</span>
        <span class="field-val">${factoryName}</span>
      </div>
      <div class="field-row">
        <span class="field-label">Node Name</span>
        <span class="field-val">${nodeName}</span>
      </div>
      <div class="field-row">
        <span class="field-label">Default DB Host</span>
        <span class="field-val">localhost</span>
      </div>
      <div class="field-row">
        <span class="field-label">Default DB Port</span>
        <span class="field-val">5432</span>
      </div>
      <div class="field-row">
        <span class="field-label">Default DB Name</span>
        <span class="field-val">jms_v1</span>
      </div>
      <div class="info-box green">✓ To change any setting, open <code>BACKEND/.env</code> in Notepad and edit the values there.</div>
    </div>
    <div class="nav-row">
      <button class="btn btn-secondary" onclick="goStep(2)">← Back</button>
      <button class="btn btn-primary" onclick="goStep(4)">Next: Start Server →</button>
    </div>
  </div>

  <!-- PAGE 4: Start & Verify -->
  <div class="page" id="page-4">
    <div class="card">
      <h2>Start the Local Server</h2>
      <p class="desc">Once the database is ready and packages are installed:</p>
      <div class="steps-list">
        <div class="step-item">
          <div>
            <h3>Double-click START_LOCAL_SERVER.bat</h3>
            <p>This opens the supervisor window which keeps the server running. Leave that window open.</p>
          </div>
        </div>
        <div class="step-item">
          <div>
            <h3>Open the dashboard in your browser</h3>
            <p>After 15-20 seconds, visit:</p>
            <div class="code">http://localhost:3001<button class="copy-btn" onclick="copyCode(this)">Copy</button></div>
            <p>If you see the JMS login page, the server is running correctly.</p>
          </div>
        </div>
        <div class="step-item">
          <div>
            <h3>(Optional) Register auto-start</h3>
            <p>To start the server automatically on every Windows reboot, right-click <strong>REGISTER_AUTOSTART.bat</strong> → <em>Run as Administrator</em>.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Verify Connection to Main Site</h2>
      <p class="desc">After the server starts, check that it connected to the main JMS server.</p>
      <div class="info-box blue">
        Go to <strong>${mainServerUrl}</strong> → Settings → Local Servers.<br>
        This node (<strong>${nodeName}</strong>) should appear with a green heartbeat indicator within 2 minutes.
      </div>
      <div class="info-box green">✅ If everything works, the local server is ready for factory use!</div>
    </div>
    <div class="card">
      <h2>Troubleshooting</h2>
      <ul class="check-list">
        <li class="check-item">
          <div class="check-icon warn">!</div>
          <div>
            <div class="check-label">Server not starting</div>
            <div class="check-sub">Check that PostgreSQL is running and the password in <code>BACKEND/.env</code> is correct. Look for error messages in the supervisor window.</div>
          </div>
        </li>
        <li class="check-item">
          <div class="check-icon warn">!</div>
          <div>
            <div class="check-label">Can't connect to main site</div>
            <div class="check-sub">Check internet connection. Make sure <code>MAIN_SERVER_URL</code> in <code>BACKEND/.env</code> is correct and the main site is running.</div>
          </div>
        </li>
        <li class="check-item">
          <div class="check-icon warn">!</div>
          <div>
            <div class="check-label">npm install errors</div>
            <div class="check-sub">Ensure Node.js is installed correctly. Try running <code>npm install --production</code> manually inside the <code>BACKEND</code> folder.</div>
          </div>
        </li>
      </ul>
    </div>
    <div class="nav-row">
      <button class="btn btn-secondary" onclick="goStep(3)">← Back</button>
      <button class="btn btn-success" onclick="goComplete()">✓ Mark as Complete</button>
    </div>
  </div>

</div>

<!-- Completion overlay -->
<div id="complete-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:999; align-items:center; justify-content:center;">
  <div style="background:white; border-radius:16px; padding:40px 36px; max-width:420px; width:90%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,.3);">
    <div style="width:72px; height:72px; border-radius:50%; background:#dcfce7; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:36px;">✅</div>
    <h2 style="font-size:22px; font-weight:800; color:#1e293b; margin-bottom:8px;">Setup Complete!</h2>
    <p style="font-size:14px; color:#64748b; line-height:1.6; margin-bottom:24px;">
      <strong>${factoryName}</strong> local server is configured.<br>
      Open your browser and visit <strong>http://localhost:3001</strong> to confirm the server is running.
    </p>
    <div style="background:#f0fdf4; border-radius:10px; padding:14px 18px; margin-bottom:24px; text-align:left;">
      <div style="font-size:12px; font-weight:700; color:#16a34a; text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px;">Next steps</div>
      <div style="font-size:13px; color:#166534; line-height:1.7;">
        1. Run <strong>START_LOCAL_SERVER.bat</strong> if not done yet<br>
        2. Visit <strong>http://localhost:3001</strong> — should show JMS login<br>
        3. Check the main site → Local Servers to see heartbeat<br>
        4. Run <strong>REGISTER_AUTOSTART.bat</strong> as Administrator for auto-start on reboot
      </div>
    </div>
    <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
      <button onclick="document.getElementById('complete-overlay').style.display='none'" style="padding:10px 20px; border-radius:8px; border:1px solid #e2e8f0; background:white; color:#475569; font-size:14px; font-weight:600; cursor:pointer;">Close</button>
      <button onclick="window.open('http://localhost:3001','_blank')" style="padding:10px 22px; border-radius:8px; border:none; background:linear-gradient(135deg,#1d4ed8,#2563eb); color:white; font-size:14px; font-weight:600; cursor:pointer;">Open Local Server →</button>
    </div>
  </div>
</div>

<div class="footer">JMS Enterprise · Local Server Installer · ${factoryName} — ${nodeName}</div>

<script>
  var currentStep = 1;
  function goStep(n) {
    document.getElementById('page-' + currentStep).classList.remove('active');
    document.getElementById('tab-' + currentStep).classList.remove('active');
    if (n < currentStep) {
      // going back — don't mark as done
    } else {
      document.getElementById('tab-' + currentStep).classList.add('done');
    }
    currentStep = n;
    document.getElementById('page-' + n).classList.add('active');
    document.getElementById('tab-' + n).classList.add('active');
    window.scrollTo(0, 0);
  }
  function goComplete() {
    // Mark all tabs as done
    for (var i = 1; i <= 4; i++) {
      document.getElementById('tab-' + i).classList.remove('active');
      document.getElementById('tab-' + i).classList.add('done');
    }
    var overlay = document.getElementById('complete-overlay');
    overlay.style.display = 'flex';
  }
  function copyCode(btn) {
    var code = btn.parentElement.cloneNode(true);
    var copyBtnEl = code.querySelector('.copy-btn');
    if (copyBtnEl) copyBtnEl.remove();
    var text = code.textContent.trim();
    navigator.clipboard.writeText(text).then(function() {
      var orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = orig; }, 1500);
    });
  }
</script>
</body>
</html>`;
}

function buildProvisioningPackage({ localServer, nodeKey, mainServerUrl, syncApiKey }) {
  const zip = new AdmZip();
  const packageRoot = `JMS_LOCAL_SERVER_${sanitizeFilePart(localServer.nodeCode || localServer.nodeName, `node-${localServer.id}`)}`;

  for (const file of BACKEND_FILES) {
    addFile(zip, path.join(BACKEND_ROOT, file), path.posix.join(packageRoot, 'BACKEND', file));
  }

  for (const dir of BACKEND_DIRECTORIES) {
    addDirectory(zip, path.join(BACKEND_ROOT, dir), path.posix.join(packageRoot, 'BACKEND', dir));
  }

  for (const file of CLIENT_BRIDGE_FILES) {
    addFile(zip, path.join(CLIENT_BRIDGE_ROOT, file), path.posix.join(packageRoot, 'CLIENT_BRIDGE', file));
  }

  zip.addFile(
    path.posix.join(packageRoot, 'BACKEND', '.env'),
    Buffer.from(buildBackendEnv({ localServer, nodeKey, mainServerUrl, syncApiKey }), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'README_LOCAL_SERVER.md'),
    Buffer.from(buildReadme({ localServer, mainServerUrl }), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'SETUP.html'),
    Buffer.from(buildInstallerHtml({ localServer, mainServerUrl }), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'OPEN_SETUP.bat'),
    Buffer.from(buildOpenSetupBat(), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'OPEN_SETUP.js'),
    Buffer.from(buildOpenSetupJs(), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'INSTALL_LOCAL_SERVER.bat'),
    Buffer.from(buildInstallBat(), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'INSTALL_LOCAL_SERVER.js'),
    Buffer.from(buildInstallerJs(), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'START_LOCAL_SERVER.bat'),
    Buffer.from(buildStartBat(), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'LOCAL_SERVER_SUPERVISOR.js'),
    Buffer.from(buildSupervisorJs(), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'REGISTER_AUTOSTART.bat'),
    Buffer.from(buildAutostartBat(), 'utf8')
  );

  return {
    buffer: zip.toBuffer(),
    fileName: `jms-local-server-${sanitizeFilePart(localServer.nodeCode || localServer.nodeName, `node-${localServer.id}`)}.zip`
  };
}

module.exports = buildProvisioningPackage;
