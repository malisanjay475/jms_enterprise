'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const rootDir = __dirname;
const backendDir = path.join(rootDir, 'BACKEND');
const clientBridgeDir = path.join(rootDir, 'CLIENT_BRIDGE');
const RESTART_DELAY_MS = 3000;
const BACKOFF_AFTER = 5;       // after this many fast crashes, slow down
const BACKOFF_DELAY_MS = 30000; // 30 s between retries once in backoff

// Auto-install BACKEND node_modules when package files change.
// This fixes old factory packages after new backend dependencies are added.
function getDependencySignature(rootDir) {
  const hash = crypto.createHash('sha256');
  ['package.json', 'package-lock.json'].forEach(function(fileName) {
    var filePath = path.join(rootDir, fileName);
    if (fs.existsSync(filePath)) {
      hash.update(fileName);
      hash.update(fs.readFileSync(filePath));
    }
  });
  return hash.digest('hex');
}

function ensureBackendDeps() {
  var pkgJson = path.join(backendDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return true;
  var nodeModulesDir = path.join(backendDir, 'node_modules');
  var markerPath = path.join(nodeModulesDir, '.jms-backend-deps.sha256');
  var signature = getDependencySignature(backendDir);
  var currentMarker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
  if (fs.existsSync(nodeModulesDir) && currentMarker === signature) return true;
  console.log('[Supervisor] BACKEND dependencies changed/missing - running npm install...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--production', '--no-audit'], {
    cwd: backendDir, stdio: 'inherit', shell: false
  });
  if (result.status !== 0) {
    console.error('[Supervisor] npm install for BACKEND failed - backend disabled until next restart.');
    return false;
  }
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  fs.writeFileSync(markerPath, signature, 'utf8');
  console.log('[Supervisor] BACKEND deps installed successfully.');
  return true;
}

// Auto-install CLIENT_BRIDGE node_modules if ws (or any dep) is missing.
// This handles: fresh install without running INSTALL_LOCAL_SERVER.bat,
// and the first boot after an auto-update that added a new package.
function ensureClientBridgeDeps() {
  const wsModule = path.join(clientBridgeDir, 'node_modules', 'ws');
  if (fs.existsSync(wsModule)) return true;
  console.log('[Supervisor] CLIENT_BRIDGE node_modules missing — running npm install...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--production', '--no-audit'], {
    cwd: clientBridgeDir, stdio: 'inherit', shell: false
  });
  if (result.status !== 0) {
    console.error('[Supervisor] npm install for CLIENT_BRIDGE failed — bridge disabled until next restart.');
    return false;
  }
  console.log('[Supervisor] CLIENT_BRIDGE deps installed successfully.');
  return true;
}

function startManagedProcess(label, cwd, scriptName, enabled) {
  if (!enabled) return;
  var failCount = 0;
  function launch() {
    var child = spawn(process.execPath, [scriptName], {
      cwd: cwd,
      stdio: 'inherit',
      detached: false
    });
    child.on('exit', function(code) {
      failCount++;
      var delay = failCount >= BACKOFF_AFTER ? BACKOFF_DELAY_MS : RESTART_DELAY_MS;
      console.log('[' + label + '] exited (code ' + code + '). Restart #' + failCount + ' in ' + (delay / 1000) + 's...');
      setTimeout(launch, delay);
    });
  }
  launch();
}

if (!fs.existsSync(path.join(backendDir, "server.js"))) {
  console.error('[Supervisor] BACKEND/server.js not found.');
  process.exit(1);
}

console.log('[Supervisor] Starting JMS local services...');
var backendEnabled = ensureBackendDeps();
startManagedProcess('Backend', backendDir, 'server.js', backendEnabled);

var bridgeEnabled = fs.existsSync(path.join(clientBridgeDir, 'bridge.js'));
if (bridgeEnabled) {
  bridgeEnabled = ensureClientBridgeDeps();
}
startManagedProcess('Client Bridge', clientBridgeDir, 'bridge.js', bridgeEnabled);
