'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
// fetch is available globally in Node.js 18+ — no require needed
const AdmZip = require('adm-zip');
const {
  PACKAGE_ROOT,
  buildCurrentReleasePackage,
  getCurrentReleaseInfo
} = require('./release-package.service');

const router = express.Router();

const DEFAULT_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min — frequent enough to get updates, won't restart server mid-shift
const DEFAULT_STARTUP_DELAY_MS = 30000;
const RUNTIME_RELEASE_PATH = path.join(__dirname, '..', 'runtime-release.json');
const BACKEND_DIR = path.resolve(PACKAGE_ROOT, 'BACKEND');
const CLIENT_BRIDGE_DIR = path.resolve(PACKAGE_ROOT, 'CLIENT_BRIDGE');

function getDependencySignature(rootDir) {
  const hash = crypto.createHash('sha256');
  for (const fileName of ['package.json', 'package-lock.json']) {
    const filePath = path.join(rootDir, fileName);
    if (fs.existsSync(filePath)) {
      hash.update(fileName);
      hash.update(fs.readFileSync(filePath));
    }
  }
  return hash.digest('hex');
}

function runProductionNpmInstall(label, cwd) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // On Windows, .cmd files cannot be spawned with shell:false — they return EINVAL.
  // shell:true routes through cmd.exe which handles .cmd files correctly.
  const useShell = process.platform === 'win32';
  const result = spawnSync(npm, ['install', '--production', '--no-audit'], {
    cwd,
    stdio: 'inherit',
    shell: useShell
  });

  if (result.status !== 0) {
    console.error(`[Updater] ${label} npm install failed (exit code ${result.status}).`);
    return false;
  }

  console.log(`[Updater] ${label} deps installed successfully.`);
  return true;
}

function ensureBackendDeps() {
  const pkgJson = path.join(BACKEND_DIR, 'package.json');
  if (!fs.existsSync(pkgJson)) return true;

  const nodeModulesDir = path.join(BACKEND_DIR, 'node_modules');
  const markerPath = path.join(nodeModulesDir, '.jms-backend-deps.sha256');
  const signature = getDependencySignature(BACKEND_DIR);
  const currentMarker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';

  if (fs.existsSync(nodeModulesDir) && currentMarker === signature) return true;

  console.log('[Updater] BACKEND dependencies changed/missing — running npm install...');
  if (!runProductionNpmInstall('BACKEND', BACKEND_DIR)) return false;

  fs.mkdirSync(nodeModulesDir, { recursive: true });
  fs.writeFileSync(markerPath, signature, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Self-heal CLIENT_BRIDGE node_modules (ws and friends).
//
// WHY THIS EXISTS HERE (and not only in the supervisor):
//   The supervisor script fix (ensureClientBridgeDeps inside LOCAL_SERVER_SUPERVISOR.js)
//   only works for newly-provisioned servers or after the supervisor process itself
//   is restarted.  When an auto-update arrives, BACKEND/server.js gets replaced on
//   disk AND process.exit(0) is called — but the running supervisor process is NOT
//   reloaded; it keeps running the OLD code from before the fix.  So the old
//   supervisor never calls npm install and CLIENT_BRIDGE keeps crashing.
//
//   The BACKEND process IS always restarted on every auto-update and on every
//   supervisor-triggered crash-restart, so calling ensureClientBridgeDeps() here
//   guarantees ws gets installed without requiring a supervisor restart.
// ---------------------------------------------------------------------------
function ensureClientBridgeDeps() {
  const wsModule = path.join(CLIENT_BRIDGE_DIR, 'node_modules', 'ws');
  if (fs.existsSync(wsModule)) return; // already installed — nothing to do

  const pkgJson = path.join(CLIENT_BRIDGE_DIR, 'package.json');
  if (!fs.existsSync(pkgJson)) return; // no CLIENT_BRIDGE on this machine

  console.log('[Updater] CLIENT_BRIDGE node_modules missing — running npm install...');
  runProductionNpmInstall('CLIENT_BRIDGE', CLIENT_BRIDGE_DIR);
}

// NOTE: ensureBackendDeps() is defined once above (content-signature based).
// A second, mtime-based copy used to live here and silently overrode the first
// via hoisting — which (a) reinstalled deps on every auto-update because zip
// extraction always bumps package.json's mtime even when content is identical,
// and (b) returned undefined, so downloadAndApply()'s `if (!ensureBackendDeps())`
// guard treated every SUCCESSFUL update as a failure. Removed in favour of the
// single signature-based implementation, which only reinstalls when the
// package.json / package-lock.json content actually changes.

let pool = null;
let configMap = {};
let checkTimer = null;

async function setServerConfigValue(key, value) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO server_config (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value == null ? '' : String(value)]
  );
  configMap[key] = value == null ? '' : String(value);
}

async function setUpdaterState(patch = {}) {
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    await setServerConfigValue(key, value);
  }
}

function readRuntimeRelease() {
  try {
    if (!fs.existsSync(RUNTIME_RELEASE_PATH)) return {};
    return JSON.parse(fs.readFileSync(RUNTIME_RELEASE_PATH, 'utf8'));
  } catch (error) {
    console.warn('[Updater] Failed to read runtime-release.json:', error.message);
    return {};
  }
}

function getConfigValue(key, fallback = '') {
  const envValue = process.env[key];
  if (envValue !== undefined && envValue !== null && String(envValue).trim() !== '') {
    return String(envValue).trim();
  }

  const tableValue = configMap[key];
  if (tableValue !== undefined && tableValue !== null && String(tableValue).trim() !== '') {
    return String(tableValue).trim();
  }

  return fallback;
}

function getCurrentLocalRelease() {
  const runtimeRelease = readRuntimeRelease();
  // If runtime-release.json exists and has a releaseId, trust it completely.
  // Do NOT fall back to APP_GIT_SHA — that env var reflects the initial install,
  // not the currently-running code after an auto-update.  Using it would cause an
  // infinite download loop: every restart would look out-of-date because the .env
  // is never overwritten by the zip.
  if (runtimeRelease.releaseId) {
    return getCurrentReleaseInfo({
      version: runtimeRelease.version,
      commit: runtimeRelease.commit || ''
    });
  }
  // No runtime-release.json yet (initial install from provisioning package).
  // Fall back to APP_GIT_SHA so the factory reports its installed version.
  return getCurrentReleaseInfo({
    version: undefined,
    commit: process.env.APP_GIT_SHA || ''
  });
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

async function authenticateNode(nodeId, request) {
  if (!pool || !Number.isInteger(nodeId) || nodeId <= 0) {
    return null;
  }

  const secret = String(request.headers['x-node-key'] || '').trim();
  if (!secret) {
    return null;
  }

  const result = await pool.query(
    `SELECT id, target_version, node_secret_hash, is_active
       FROM local_servers
      WHERE id = $1
      LIMIT 1`,
    [nodeId]
  );

  const row = result.rows[0];
  if (!row || row.is_active !== true) {
    return null;
  }

  if (hashSecret(secret) !== row.node_secret_hash) {
    return null;
  }

  return row;
}

function isReleaseAllowedForNode(releaseInfo, targetVersion) {
  if (!targetVersion) return true;

  return [
    releaseInfo.version,
    releaseInfo.commit,
    releaseInfo.releaseId
  ].includes(String(targetVersion).trim());
}

router.get('/check', async (req, res) => {
  try {
    const releaseInfo = buildCurrentReleasePackage();
    const nodeId = Number.parseInt(String(req.query.nodeId || ''), 10);
    const currentVersion = String(req.query.currentVersion || '').trim();
    const currentCommit = String(req.query.currentCommit || '').trim();
    const authenticatedNode = await authenticateNode(nodeId, req);
    const targetVersion = authenticatedNode?.target_version || null;
    const updateAllowed = isReleaseAllowedForNode(releaseInfo, targetVersion);

    const updateAvailable = updateAllowed && (
      currentVersion !== releaseInfo.version ||
      currentCommit !== releaseInfo.commit
    );

    const url = nodeId
      ? `/api/update/download?nodeId=${encodeURIComponent(String(nodeId))}&release=${encodeURIComponent(releaseInfo.releaseId)}`
      : `/api/update/download?release=${encodeURIComponent(releaseInfo.releaseId)}`;

    res.json({
      ok: true,
      version: releaseInfo.version,
      commit: releaseInfo.commit,
      releaseId: releaseInfo.releaseId,
      checksum: releaseInfo.checksum,
      targetVersion,
      updateAllowed,
      updateAvailable,
      url,
      reason: updateAllowed ? null : `Node target version is ${targetVersion}, current VPS release is ${releaseInfo.releaseId}`
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/download', async (req, res) => {
  try {
    const requestedRelease = String(req.query.release || '').trim();
    const nodeId = Number.parseInt(String(req.query.nodeId || ''), 10);
    const authenticatedNode = await authenticateNode(nodeId, req);
    const releaseInfo = buildCurrentReleasePackage();

    if (requestedRelease && requestedRelease !== releaseInfo.releaseId) {
      return res.status(404).json({ ok: false, error: 'Requested release is not available on this server' });
    }

    if (authenticatedNode && !isReleaseAllowedForNode(releaseInfo, authenticatedNode.target_version)) {
      return res.status(409).json({ ok: false, error: `Node target version is ${authenticatedNode.target_version}; release ${releaseInfo.releaseId} is not approved for this node` });
    }

    res.download(releaseInfo.filePath, releaseInfo.fileName);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

async function loadServerConfig() {
  configMap = {};

  if (!pool) return;

  try {
    const result = await pool.query('SELECT key, value FROM server_config');
    result.rows.forEach(row => {
      configMap[row.key] = row.value;
    });
  } catch (error) {
    console.error('[Updater] Failed to load server_config:', error.message);
  }
}

async function init(dbPool) {
  pool = dbPool;
  await loadServerConfig();

  // Heal deps on every boot — detects new packages added after initial
  // provisioning and re-runs npm install automatically (only when the
  // package.json / package-lock.json content signature actually changes).
  // Works even if an old supervisor is still running in memory, because the
  // BACKEND process is restarted on every auto-update and crash-restart.
  ensureBackendDeps();
  ensureClientBridgeDeps();

  const serverType = getConfigValue('SERVER_TYPE', 'MAIN');
  const mainUrl = getConfigValue('MAIN_SERVER_URL', '');

  if (serverType !== 'LOCAL' || !mainUrl) {
    console.log(`[Updater] Disabled (Mode: ${serverType}).`);
    return;
  }

  const localRelease = getCurrentLocalRelease();
  await setUpdaterState({
    LOCAL_UPDATE_CURRENT_RELEASE: localRelease.releaseId,
    LOCAL_UPDATE_TARGET_RELEASE: configMap.LOCAL_UPDATE_TARGET_RELEASE || localRelease.releaseId,
    LOCAL_UPDATE_PENDING: '0'
  });

  console.log('[Updater] Auto-Update Service Started.');

  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }

  setTimeout(() => {
    checkUpdate(mainUrl).catch(error => {
      console.error('[Updater] Startup check failed:', error.message);
    });
  }, DEFAULT_STARTUP_DELAY_MS);

  checkTimer = setInterval(() => {
    checkUpdate(mainUrl).catch(error => {
      console.error('[Updater] Scheduled check failed:', error.message);
    });
  }, DEFAULT_CHECK_INTERVAL_MS);

  if (typeof checkTimer.unref === 'function') {
    checkTimer.unref();
  }
}

function buildCheckUrl(mainUrl, releaseInfo) {
  const url = new URL('/api/update/check', mainUrl);
  url.searchParams.set('currentVersion', releaseInfo.version);
  url.searchParams.set('currentCommit', releaseInfo.commit);

  const nodeId = getConfigValue('LOCAL_SERVER_NODE_ID', '');
  if (nodeId) {
    url.searchParams.set('nodeId', nodeId);
  }

  return url.toString();
}

function buildAuthHeaders() {
  const headers = {};
  const nodeKey = getConfigValue('LOCAL_SERVER_NODE_KEY', '');
  if (nodeKey) {
    headers['x-node-key'] = nodeKey;
  }
  return headers;
}

async function checkUpdate(mainUrl) {
  const localRelease = getCurrentLocalRelease();
  console.log(`[Updater] Checking for updates. Current: ${localRelease.releaseId}`);

  try {
    await setUpdaterState({
      LOCAL_UPDATE_CURRENT_RELEASE: localRelease.releaseId,
      LOCAL_UPDATE_LAST_CHECK_AT: new Date().toISOString(),
      LOCAL_UPDATE_LAST_FAILURE_REASON: ''
    });

    const response = await fetch(buildCheckUrl(mainUrl, localRelease), {
      headers: buildAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`Check request failed: ${response.status} ${response.statusText}`);
    }

    const remote = await response.json();
    if (!remote.ok) {
      throw new Error(remote.error || 'Remote update check failed');
    }

    await setUpdaterState({
      LOCAL_UPDATE_CURRENT_RELEASE: localRelease.releaseId,
      LOCAL_UPDATE_TARGET_RELEASE: remote.targetVersion || remote.releaseId || localRelease.releaseId,
      LOCAL_UPDATE_PENDING: remote.updateAvailable ? '1' : '0'
    });

    if (!remote.updateAllowed) {
      console.log(`[Updater] Hold: ${remote.reason || 'Release is not approved for this node.'}`);
      return;
    }

    if (!remote.updateAvailable) {
      console.log(`[Updater] System is up to date at ${localRelease.releaseId}.`);
      return;
    }

    console.log(`[Updater] New release found: ${remote.releaseId}. Downloading...`);
    await downloadAndApply(mainUrl, remote);
  } catch (error) {
    await setUpdaterState({
      LOCAL_UPDATE_LAST_FAILURE_REASON: error.message || 'Update check failed'
    });
    throw error;
  }
}

async function downloadAndApply(mainUrl, remote) {
  const packageRoot = PACKAGE_ROOT;
  const tmpPath = path.join(packageRoot, 'temp_update.zip');
  try {
    const response = await fetch(new URL(remote.url, mainUrl).toString(), {
      headers: buildAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    // Native fetch returns a Web Streams ReadableStream, not a Node.js stream.
    // Use arrayBuffer() to read the entire response body into memory, then write to disk.
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);

    console.log('[Updater] Download complete. Extracting release...');
    const zip = new AdmZip(tmpPath);
    zip.extractAllTo(packageRoot, true);

    // After extracting new files, install any newly-added BACKEND/CLIENT_BRIDGE
    // packages before restart. Old supervisors may still be running in memory.
    if (!ensureBackendDeps()) {
      throw new Error('BACKEND npm install failed after update extraction');
    }
    ensureClientBridgeDeps();

    await setUpdaterState({
      LOCAL_UPDATE_CURRENT_RELEASE: remote.releaseId,
      LOCAL_UPDATE_TARGET_RELEASE: remote.releaseId,
      LOCAL_UPDATE_PENDING: '0',
      LOCAL_UPDATE_LAST_SUCCESS_AT: new Date().toISOString(),
      LOCAL_UPDATE_LAST_FAILURE_REASON: ''
    });
  } catch (error) {
    await setUpdaterState({
      LOCAL_UPDATE_TARGET_RELEASE: remote.releaseId || '',
      LOCAL_UPDATE_PENDING: '1',
      LOCAL_UPDATE_LAST_FAILURE_REASON: error.message || 'Download/apply failed'
    });
    throw error;
  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`[Updater] Release ${remote.releaseId} applied. Restarting service...`);
  process.exit(0);
}

module.exports = { init, router };
