'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const { spawn, execFile } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const https = require('https');
const http  = require('http');

// ── Paths ─────────────────────────────────────────────────────────────────────
const IS_PACKAGED    = app.isPackaged;
const APP_DATA       = path.join(app.getPath('appData'), 'JMSLocalServer');
const CONFIG_FILE    = path.join(APP_DATA, 'config.json');
const BACKEND_SRC    = IS_PACKAGED
  ? path.join(process.resourcesPath, 'backend')
  : path.join(__dirname, '..', 'BACKEND');
const BACKEND_DEST   = path.join(APP_DATA, 'backend');
const LOG_FILE       = path.join(APP_DATA, 'server.log');

fs.mkdirSync(APP_DATA, { recursive: true });

// ── State ─────────────────────────────────────────────────────────────────────
let tray         = null;
let setupWin     = null;
let serverProc   = null;
let serverStatus = 'stopped';   // stopped | starting | running | error
let config       = null;
let restartTimer = null;

// ── Config helpers ────────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}
function saveConfig(c) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), 'utf8');
}

// ── Tray icon helpers ─────────────────────────────────────────────────────────
function iconPath(name) {
  const base = IS_PACKAGED ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, 'assets');
  return path.join(base, name);
}
function setTrayStatus(status) {
  if (!tray) return;
  serverStatus = status;
  const icons = { running: 'tray-green.png', starting: 'tray-yellow.png', error: 'tray-red.png', stopped: 'tray-red.png' };
  const labels = { running: 'JMS Local Server — Running', starting: 'JMS Local Server — Starting…', error: 'JMS Local Server — Error', stopped: 'JMS Local Server — Stopped' };
  try { tray.setImage(nativeImage.createFromPath(iconPath(icons[status] || 'tray-red.png'))); } catch {}
  tray.setToolTip(labels[status] || 'JMS Local Server');
  buildTrayMenu();
}

function buildTrayMenu() {
  const isRunning = serverStatus === 'running';
  const menu = Menu.buildFromTemplate([
    { label: 'JMS Local Server', enabled: false },
    { label: `Status: ${serverStatus.charAt(0).toUpperCase() + serverStatus.slice(1)}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      enabled: isRunning,
      click: () => {
        const port = config?.port || 3000;
        shell.openExternal(`http://localhost:${port}/dashboard.html`);
      }
    },
    {
      label: 'Open in Browser',
      enabled: isRunning,
      click: () => shell.openExternal(`http://localhost:${config?.port || 3000}`)
    },
    { type: 'separator' },
    {
      label: isRunning ? 'Restart Server' : 'Start Server',
      click: () => { stopServer(); setTimeout(startServer, 500); }
    },
    {
      label: 'Stop Server',
      enabled: isRunning || serverStatus === 'starting',
      click: stopServer
    },
    { type: 'separator' },
    { label: 'Settings', click: openSetupWindow },
    { label: 'View Logs', click: () => shell.openPath(LOG_FILE) },
    { type: 'separator' },
    { label: 'Quit JMS Local Server', role: 'quit' }
  ]);
  tray.setContextMenu(menu);
}

// ── Backend management ────────────────────────────────────────────────────────
function prepareBackend() {
  // Copy backend source to APP_DATA if not already there or if version changed
  const destPkg = path.join(BACKEND_DEST, 'package.json');
  const srcPkg  = path.join(BACKEND_SRC, 'package.json');
  if (!fs.existsSync(srcPkg)) return;

  let needCopy = !fs.existsSync(destPkg);
  if (!needCopy) {
    try {
      const sv = JSON.parse(fs.readFileSync(srcPkg, 'utf8')).version;
      const dv = JSON.parse(fs.readFileSync(destPkg, 'utf8')).version;
      needCopy = sv !== dv;
    } catch { needCopy = true; }
  }
  if (needCopy) copyDir(BACKEND_SRC, BACKEND_DEST);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.env' || entry.name.endsWith('.log')) continue;
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function writeBackendEnv() {
  if (!config) return;
  const lines = [
    `NODE_ENV=production`,
    `PORT=${config.port || 3000}`,
    `DB_HOST=${config.dbHost || 'localhost'}`,
    `DB_PORT=${config.dbPort || 5432}`,
    `DB_USER=${config.dbUser || 'jms_v1'}`,
    `DB_PASSWORD=${config.dbPassword || ''}`,
    `DB_NAME=${config.dbName || 'jms_v1'}`,
    `SERVER_TYPE=LOCAL`,
    `MAIN_SERVER_URL=${config.mainServerUrl || ''}`,
    `LOCAL_FACTORY_ID=${config.factoryId || ''}`,
    `SYNC_API_KEY=${config.syncApiKey || ''}`,
    `LOCAL_SERVER_AGENT_ENABLED=1`,
    `LOCAL_SERVER_NODE_ID=${config.nodeId || ''}`,
    `LOCAL_SERVER_NODE_KEY=${config.nodeKey || ''}`,
    `GEMINI_API_KEY=`,
  ].join('\n');
  fs.writeFileSync(path.join(BACKEND_DEST, '.env'), lines, 'utf8');
}

function startServer() {
  if (serverProc) return;
  setTrayStatus('starting');
  prepareBackend();
  writeBackendEnv();

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const modulesDir = path.join(BACKEND_DEST, 'node_modules');

  const doStart = () => {
    const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    logStream.write(`\n[${new Date().toISOString()}] Starting server...\n`);
    serverProc = spawn(process.execPath, ['server.js'], {
      cwd: BACKEND_DEST,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    });
    serverProc.stdout.on('data', d => logStream.write(d));
    serverProc.stderr.on('data', d => logStream.write(d));

    // Wait for server to be healthy
    let attempts = 0;
    const checkHealth = setInterval(async () => {
      attempts++;
      try {
        await httpGet(`http://localhost:${config?.port || 3000}/health`);
        clearInterval(checkHealth);
        setTrayStatus('running');
      } catch {
        if (attempts > 30) { clearInterval(checkHealth); setTrayStatus('error'); }
      }
    }, 2000);

    serverProc.on('exit', code => {
      logStream.write(`[${new Date().toISOString()}] Server exited (code ${code}). Restarting in 3s...\n`);
      serverProc = null;
      if (serverStatus !== 'stopped') {
        setTrayStatus('error');
        restartTimer = setTimeout(startServer, 3000);
      }
    });
  };

  if (!fs.existsSync(modulesDir)) {
    const install = spawn(npm, ['install', '--omit=dev', '--no-audit', '--prefer-offline'], { cwd: BACKEND_DEST, stdio: 'ignore', shell: false });
    install.on('exit', code => { if (code === 0) doStart(); else setTrayStatus('error'); });
  } else {
    doStart();
  }
}

function stopServer() {
  clearTimeout(restartTimer);
  restartTimer = null;
  serverStatus = 'stopped';
  if (serverProc) { try { serverProc.kill(); } catch {} serverProc = null; }
  setTrayStatus('stopped');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 2000 }, res => {
      if (res.statusCode >= 200 && res.statusCode < 400) resolve();
      else reject(new Error(res.statusCode));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Setup window ──────────────────────────────────────────────────────────────
function openSetupWindow() {
  if (setupWin) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 560,
    height: 680,
    resizable: false,
    icon: iconPath('icon.png'),
    title: 'JMS Local Server Setup',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  setupWin.setMenuBarVisibility(false);
  setupWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWin.on('closed', () => { setupWin = null; });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => {
  saveConfig(cfg);
  config = cfg;
});
ipcMain.handle('get-status', () => ({ status: serverStatus, logFile: LOG_FILE }));
ipcMain.handle('check-postgres', () => {
  return new Promise(resolve => {
    httpGet(`http://localhost:5432`).then(() => resolve(true)).catch(() => {
      // Try a raw TCP connect — httpGet won't work for postgres, but a refused connection (ECONNREFUSED) means postgres is up
      const net = require('net');
      const s = net.createConnection({ port: 5432, host: 'localhost', timeout: 2000 });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.on('timeout', () => { s.destroy(); resolve(false); });
    });
  });
});
ipcMain.handle('install-and-start', async (_, cfg) => {
  saveConfig(cfg);
  config = cfg;
  if (setupWin) setupWin.close();
  createTray();
  startServer();
  return { ok: true };
});
ipcMain.handle('open-logs', () => shell.openPath(LOG_FILE));

// ── Tray creation ─────────────────────────────────────────────────────────────
function createTray() {
  if (tray) return;
  const img = nativeImage.createFromPath(iconPath('tray-red.png'));
  tray = new Tray(img);
  tray.setToolTip('JMS Local Server');
  tray.on('double-click', () => {
    if (serverStatus === 'running') shell.openExternal(`http://localhost:${config?.port || 3000}`);
    else openSetupWindow();
  });
  buildTrayMenu();
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.setAppUserModelId('com.jmsenterprise.localserver');

  // Don't show in taskbar — lives in system tray only
  if (process.platform === 'win32') app.setAppUserModelId(app.name);

  config = loadConfig();
  createTray();

  if (!config || !config.mainServerUrl || !config.dbPassword) {
    openSetupWindow();
  } else {
    startServer();
  }
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray
app.on('before-quit', stopServer);
