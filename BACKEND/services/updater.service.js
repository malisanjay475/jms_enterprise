'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const {
  PACKAGE_ROOT,
  buildCurrentReleasePackage,
  getCurrentReleaseInfo
} = require('./release-package.service');

const router = express.Router();

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_STARTUP_DELAY_MS = 30000;
const RUNTIME_RELEASE_PATH = path.join(__dirname, '..', 'runtime-release.json');

let pool = null;
let configMap = {};
let checkTimer = null;

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
  return getCurrentReleaseInfo({
    version: runtimeRelease.version,
    commit: runtimeRelease.commit || process.env.APP_GIT_SHA || runtimeRelease.releaseId || ''
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

  const serverType = getConfigValue('SERVER_TYPE', 'MAIN');
  const mainUrl = getConfigValue('MAIN_SERVER_URL', '');

  if (serverType !== 'LOCAL' || !mainUrl) {
    console.log(`[Updater] Disabled (Mode: ${serverType}).`);
    return;
  }

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
}

async function downloadAndApply(mainUrl, remote) {
  const packageRoot = PACKAGE_ROOT;
  const tmpPath = path.join(packageRoot, 'temp_update.zip');
  const response = await fetch(new URL(remote.url, mainUrl).toString(), {
    headers: buildAuthHeaders()
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(tmpPath);
    response.body.pipe(stream);
    response.body.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
  });

  console.log('[Updater] Download complete. Extracting release...');

  try {
    const zip = new AdmZip(tmpPath);
    zip.extractAllTo(packageRoot, true);
  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`[Updater] Release ${remote.releaseId} applied. Restarting service...`);
  process.exit(0);
}

module.exports = { init, router };
