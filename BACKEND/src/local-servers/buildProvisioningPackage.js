'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BACKEND_ROOT = path.join(REPO_ROOT, 'BACKEND');
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

function buildBackendEnv({ localServer, nodeKey, mainServerUrl }) {
  return [
    'NODE_ENV=production',
    'PORT=3000',
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
    'SYNC_API_KEY=',
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
    '5. Create or restore the local jms_v1 PostgreSQL database for this factory if it is not ready yet.',
    '6. Run START_LOCAL_SERVER.bat.',
    '',
    '## Result',
    '- The local server will register itself to the main site automatically.',
    '- The Local Servers screen on the main site will show IP, heartbeat, and version after registration.',
    '- START_LOCAL_SERVER.bat launches a supervisor so backend updates can restart automatically after download.',
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
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo [ERROR] Node.js is not installed. Install Node.js LTS first.',
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
    '  echo [ERROR] Installer failed.',
    '  pause',
    '  exit /b 1',
    ')',
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
    "const { spawn } = require('child_process');",
    '',
    "const rootDir = __dirname;",
    "const backendDir = path.join(rootDir, 'BACKEND');",
    "const clientBridgeDir = path.join(rootDir, 'CLIENT_BRIDGE');",
    "const restartDelayMs = 3000;",
    '',
    'function runProcess(label, cwd, scriptFile, enabled) {',
    '  if (!enabled) return;',
    '  const child = spawn(process.execPath, [scriptFile], { cwd, stdio: "inherit", detached: false });',
    '  child.on("exit", code => {',
    '    console.log("[" + label + "] exited with code " + code + ". Restarting in " + restartDelayMs + "ms...");',
    '    setTimeout(() => runProcess(label, cwd, scriptFile, enabled), restartDelayMs);',
    '  });',
    '}',
    '',
    'if (!fs.existsSync(path.join(backendDir, "server.js"))) {',
    '  console.error("[Supervisor] BACKEND/server.js not found.");',
    '  process.exit(1);',
    '}',
    '',
    'console.log("[Supervisor] Starting JMS local services...");',
    'runProcess("Backend", backendDir, "server.js", true);',
    'runProcess("Client Bridge", clientBridgeDir, "bridge.js", fs.existsSync(path.join(clientBridgeDir, "bridge.js")));',
    ''
  ].join('\r\n');
}

function buildInstallerJs() {
  return [
    "'use strict';",
    '',
    "const fs = require('fs');",
    "const path = require('path');",
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
    "    'PORT=' + (envMap.get('PORT') || '3000'),",
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
    "    envMap.set('MAIN_SERVER_URL', await askQuestion(rl, 'Main site URL', envMap.get('MAIN_SERVER_URL') || ''));",
    "    envMap.set('LOCAL_FACTORY_ID', await askQuestion(rl, 'Factory ID', envMap.get('LOCAL_FACTORY_ID') || ''));",
    "    saveEnv(backendEnvPath, envMap);",
    "    console.log('');",
    "    console.log('[DONE] BACKEND/.env updated successfully.');",
    '',
    '    if (await askYesNo(rl, \'Install backend dependencies now?\', true)) {',
    "      console.log('');",
    "      console.log('[INFO] Installing backend dependencies...');",
    "      runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], backendDir);",
    '    }',
    '',
    "    if (fs.existsSync(path.join(clientBridgeDir, 'package.json')) && await askYesNo(rl, 'Install client bridge dependencies too?', true)) {",
    "      console.log('');",
    "      console.log('[INFO] Installing client bridge dependencies...');",
    "      runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], clientBridgeDir);",
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

function buildProvisioningPackage({ localServer, nodeKey, mainServerUrl }) {
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
    Buffer.from(buildBackendEnv({ localServer, nodeKey, mainServerUrl }), 'utf8')
  );
  zip.addFile(
    path.posix.join(packageRoot, 'README_LOCAL_SERVER.md'),
    Buffer.from(buildReadme({ localServer, mainServerUrl }), 'utf8')
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

  return {
    buffer: zip.toBuffer(),
    fileName: `jms-local-server-${sanitizeFilePart(localServer.nodeCode || localServer.nodeName, `node-${localServer.id}`)}.zip`
  };
}

module.exports = buildProvisioningPackage;
