'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// fetch is available globally in Node.js 18+ — no require needed

const packageJson = require(path.resolve(__dirname, '..', '..', 'package.json'));

const DEFAULT_INTERVAL_MS = 60 * 1000;

let state = {
  started: false,
  timer: null,
  inFlight: false
};

function normalizeBool(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizeIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.replace(/^::ffff:/, '');
}

function getPrimaryLanIp() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue;
      return normalizeIp(entry.address);
    }
  }
  return null;
}

function buildUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

// Bounded fetch — aborts if the remote (MAIN/VPS) never responds, so a
// half-open socket can never park the event loop or leak a pending request.
async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options, options.timeoutMs || 20000);
  const text = await response.text();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }

  if (!response.ok) {
    const error = new Error((json && json.error) || text || `Request failed with ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return json || {};
}

async function getServerConfigMap(pool) {
  const result = await pool.query(
    `SELECT key, value
       FROM server_config
      WHERE key = ANY($1::text[])`,
    [[
      'LOCAL_SERVER_NODE_ID',
      'LOCAL_SERVER_NODE_KEY',
      'LOCAL_SERVER_PUBLIC_IP',
      'LOCAL_SERVER_HEARTBEAT_INTERVAL_MS',
      'LAST_SYNC',
      'LAST_PUSH',
      'LAST_PULL',
      'SERVER_TYPE',
      'MAIN_SERVER_URL',
      'LOCAL_FACTORY_ID',
      'LOCAL_UPDATE_CURRENT_RELEASE',
      'LOCAL_UPDATE_TARGET_RELEASE',
      'LOCAL_UPDATE_PENDING',
      'LOCAL_UPDATE_LAST_SUCCESS_AT',
      'LOCAL_UPDATE_LAST_FAILURE_REASON',
      'LOCAL_UPDATE_LAST_CHECK_AT',
      'LAST_SYNC_CREATED_COUNT',
      'LAST_SYNC_UPDATED_COUNT',
      'LAST_SYNC_DELETED_COUNT',
      'LAST_SYNC_FAILED_COUNT',
      'LAST_SYNC_PENDING_COUNT',
      'LAST_SYNC_CYCLE_AT'
    ]]
  );

  return result.rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function buildAgentConfig(config, serverConfig) {
  const enabledFlag = normalizeBool(config.localServer?.agentEnabled);
  const serverType = pickFirst(config.serverType, serverConfig.SERVER_TYPE);
  const nodeId = pickFirst(config.localServer?.nodeId, serverConfig.LOCAL_SERVER_NODE_ID);
  const nodeKey = pickFirst(config.localServer?.nodeKey, serverConfig.LOCAL_SERVER_NODE_KEY);
  const mainServerUrl = pickFirst(config.mainServerUrl, serverConfig.MAIN_SERVER_URL);
  const localFactoryId = pickFirst(config.localFactoryId, serverConfig.LOCAL_FACTORY_ID);
  const publicIp = pickFirst(config.localServer?.publicIp, serverConfig.LOCAL_SERVER_PUBLIC_IP);
  const heartbeatRaw = pickFirst(
    config.localServer?.heartbeatIntervalMs,
    serverConfig.LOCAL_SERVER_HEARTBEAT_INTERVAL_MS
  );
  const heartbeatIntervalMs = Number.parseInt(heartbeatRaw || `${DEFAULT_INTERVAL_MS}`, 10);

  return {
    enabled:
      enabledFlag === true ||
      (enabledFlag !== false && String(serverType).toUpperCase() === 'LOCAL' && !!mainServerUrl && !!nodeId && !!nodeKey),
    serverType: String(serverType || '').toUpperCase(),
    nodeId,
    nodeKey,
    mainServerUrl,
    localFactoryId: localFactoryId || null,
    publicIp: publicIp || null,
    heartbeatIntervalMs: Number.isInteger(heartbeatIntervalMs) && heartbeatIntervalMs > 0
      ? heartbeatIntervalMs
      : DEFAULT_INTERVAL_MS
  };
}

function buildLocalMetadata(config, agentConfig, serverConfig = {}) {
  return {
    hostname: os.hostname(),
    serverType: agentConfig.serverType || config.serverType || '',
    localFactoryId: agentConfig.localFactoryId,
    databaseName: config.db?.database || null,
    nodeEnv: config.nodeEnv,
    appVersion: packageJson.version || null,
    autoUpdate: {
      currentRelease: serverConfig.LOCAL_UPDATE_CURRENT_RELEASE || null,
      targetRelease: serverConfig.LOCAL_UPDATE_TARGET_RELEASE || null,
      updatePending: normalizeBool(serverConfig.LOCAL_UPDATE_PENDING) === true,
      lastSuccessfulAutoUpdateAt: serverConfig.LOCAL_UPDATE_LAST_SUCCESS_AT || null,
      failedUpdateReason: serverConfig.LOCAL_UPDATE_LAST_FAILURE_REASON || null,
      lastCheckedAt: serverConfig.LOCAL_UPDATE_LAST_CHECK_AT || null
    },
    syncAudit: {
      created: parseInteger(serverConfig.LAST_SYNC_CREATED_COUNT, 0),
      updated: parseInteger(serverConfig.LAST_SYNC_UPDATED_COUNT, 0),
      deleted: parseInteger(serverConfig.LAST_SYNC_DELETED_COUNT, 0),
      failed: parseInteger(serverConfig.LAST_SYNC_FAILED_COUNT, 0),
      pending: parseInteger(serverConfig.LAST_SYNC_PENDING_COUNT, 0),
      lastCycleAt: serverConfig.LAST_SYNC_CYCLE_AT || serverConfig.LAST_SYNC || null
    }
  };
}

async function getSyncStatus(pool) {
  const serverConfig = await getServerConfigMap(pool);
  return {
    lastSyncAt: serverConfig.LAST_SYNC || null,
    lastPushAt: serverConfig.LAST_PUSH || null,
    lastPullAt: serverConfig.LAST_PULL || null
  };
}

async function registerNode(pool, config, agentConfig) {
  const serverConfig = await getServerConfigMap(pool);
  const syncStatus = {
    lastSyncAt: serverConfig.LAST_SYNC || null,
    lastPushAt: serverConfig.LAST_PUSH || null,
    lastPullAt: serverConfig.LAST_PULL || null
  };
  const payload = {
    localIp: getPrimaryLanIp(),
    publicIp: agentConfig.publicIp,
    currentVersion: packageJson.version || '',
    lastSeenCommit: config.appGitSha || '',
    metadata: {
      ...buildLocalMetadata(config, agentConfig, serverConfig),
      lastSyncAt: syncStatus.lastSyncAt
    }
  };

  const response = await fetchJson(
    buildUrl(agentConfig.mainServerUrl, `/api/local-servers/${agentConfig.nodeId}/register`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-node-key': agentConfig.nodeKey
      },
      body: JSON.stringify(payload)
    }
  );

  if (response.heartbeatIntervalSeconds) {
    const suggestedMs = Number.parseInt(String(response.heartbeatIntervalSeconds), 10) * 1000;
    if (Number.isInteger(suggestedMs) && suggestedMs > 0) {
      agentConfig.heartbeatIntervalMs = suggestedMs;
    }
  }

  if (response.targetVersion && response.targetVersion !== packageJson.version) {
    console.log(
      `[Local Node Agent] Target version ${response.targetVersion} differs from current ${packageJson.version}`
    );
  }
}

async function sendHeartbeat(pool, config, agentConfig) {
  const serverConfig = await getServerConfigMap(pool);
  const syncStatus = {
    lastSyncAt: serverConfig.LAST_SYNC || null,
    lastPushAt: serverConfig.LAST_PUSH || null,
    lastPullAt: serverConfig.LAST_PULL || null
  };
  await fetchJson(
    buildUrl(agentConfig.mainServerUrl, `/api/local-servers/${agentConfig.nodeId}/heartbeat`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-node-key': agentConfig.nodeKey
      },
      body: JSON.stringify({
        status: 'online',
        localIp: getPrimaryLanIp(),
        publicIp: agentConfig.publicIp,
        currentVersion: packageJson.version || '',
        lastSeenCommit: config.appGitSha || '',
        lastPushAt: syncStatus.lastPushAt,
        lastPullAt: syncStatus.lastPullAt,
        syncStatus: 'connected',
        metadata: {
          ...buildLocalMetadata(config, agentConfig, serverConfig),
          lastSyncAt: syncStatus.lastSyncAt
        }
      })
    }
  );
}

async function sendSyncStatus(pool, config, agentConfig) {
  const serverConfig = await getServerConfigMap(pool);
  const syncStatus = {
    lastSyncAt: serverConfig.LAST_SYNC || null,
    lastPushAt: serverConfig.LAST_PUSH || null,
    lastPullAt: serverConfig.LAST_PULL || null
  };
  await fetchJson(
    buildUrl(agentConfig.mainServerUrl, `/api/local-servers/${agentConfig.nodeId}/sync-status`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-node-key': agentConfig.nodeKey
      },
      body: JSON.stringify({
        status: 'online',
        localIp: getPrimaryLanIp(),
        publicIp: agentConfig.publicIp,
        currentVersion: packageJson.version || '',
        lastSeenCommit: config.appGitSha || '',
        lastPushAt: syncStatus.lastPushAt,
        lastPullAt: syncStatus.lastPullAt,
        syncStatus: syncStatus.lastPushAt || syncStatus.lastPullAt ? 'active' : 'waiting_initial_sync',
        metadata: {
          ...buildLocalMetadata(config, agentConfig, serverConfig),
          lastSyncAt: syncStatus.lastSyncAt
        }
      })
    }
  );
}

// ── Auto-update: pull changed files from main server ─────────────────────────
// Runs inside the backend process (works even with the old supervisor).
// Every AUTO_UPDATE_INTERVAL_MS it fetches a file manifest, compares SHA-256
// hashes with local files, downloads anything different, then exits so the
// supervisor restarts the backend with the updated code.

const AUTO_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// __dirname = BACKEND/src/local-servers  →  resolve up 2 levels = BACKEND root
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) { return null; }
}

async function fetchWithNodeKey(url, nodeKey) {
  // 30s allows for larger file downloads during auto-update, but never hangs forever.
  const res = await fetchWithTimeout(url, { headers: { 'x-node-key': nodeKey } }, 30000);
  return res;
}

async function runAutoUpdate(agentConfig) {
  const { mainServerUrl, nodeId, nodeKey } = agentConfig;
  if (!mainServerUrl || !nodeId || !nodeKey) return;

  const base = mainServerUrl.replace(/\/+$/, '');
  const manifestUrl = `${base}/api/local-servers/${nodeId}/file-manifest`;

  let manifestRes;
  try {
    manifestRes = await fetchWithNodeKey(manifestUrl, nodeKey);
  } catch (err) {
    console.error('[AutoUpdate] Manifest fetch failed:', err.message);
    return;
  }

  if (!manifestRes.ok) return;

  let data;
  try { data = await manifestRes.json(); } catch (_) { return; }
  if (!data.ok || !data.manifest) return;

  const manifest = data.manifest;
  // Belt-and-suspenders: never treat derived build artifacts (.gz/.br/.min.js/
  // .min.css/.map) as update triggers. They are regenerated locally on every
  // boot by minifyAssets/precompressAssets, so their bytes never match MAIN's
  // copies — which previously caused an infinite download -> process.exit(0) ->
  // restart loop (~every 76s). MAIN also excludes these from the manifest now
  // (collectManifest in localServerService.js); this guard protects LOCAL
  // servers still talking to an un-patched MAIN.
  const DERIVED_ASSET_RE = /(\.gz|\.br|\.min\.js|\.min\.css|\.map)$/i;
  const toUpdate = Object.keys(manifest).filter(relPath => {
    if (DERIVED_ASSET_RE.test(relPath)) return false;
    const localPath = path.join(BACKEND_ROOT, relPath);
    return sha256File(localPath) !== manifest[relPath];
  });

  if (toUpdate.length === 0) return;

  console.log(`[AutoUpdate] ${toUpdate.length} file(s) changed — downloading...`);

  let anyUpdated = false;
  for (const relPath of toUpdate) {
    try {
      const fileUrl = `${base}/api/local-servers/${nodeId}/file?p=${encodeURIComponent(relPath)}`;
      const fileRes = await fetchWithNodeKey(fileUrl, nodeKey);
      if (!fileRes.ok) {
        console.warn(`[AutoUpdate] Skip ${relPath} (HTTP ${fileRes.status})`);
        continue;
      }
      const buf = Buffer.from(await fileRes.arrayBuffer());
      const localPath = path.join(BACKEND_ROOT, relPath);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, buf);
      console.log(`[AutoUpdate] Updated: ${relPath}`);
      anyUpdated = true;
    } catch (err) {
      console.warn(`[AutoUpdate] Failed to update ${relPath}:`, err.message);
    }
  }

  if (anyUpdated) {
    console.log('[AutoUpdate] Restarting backend to apply updates...');
    // Supervisor will restart us automatically
    process.exit(0);
  }
}

async function runCycle(pool, config, agentConfig) {
  if (state.inFlight) return;
  state.inFlight = true;

  try {
    await registerNode(pool, config, agentConfig);
    await sendHeartbeat(pool, config, agentConfig);
    await sendSyncStatus(pool, config, agentConfig);
  } catch (error) {
    console.error('[Local Node Agent] Cycle failed:', error.message);
  } finally {
    state.inFlight = false;
  }
}

async function init({ pool, config }) {
  const serverConfig = await getServerConfigMap(pool);
  const agentConfig = buildAgentConfig(config, serverConfig);

  if (!agentConfig.enabled) {
    console.log('[Local Node Agent] Disabled');
    return;
  }

  if (!agentConfig.mainServerUrl || !agentConfig.nodeId || !agentConfig.nodeKey) {
    console.warn('[Local Node Agent] Missing MAIN_SERVER_URL, LOCAL_SERVER_NODE_ID, or LOCAL_SERVER_NODE_KEY');
    return;
  }

  if (state.started) return;
  state.started = true;

  console.log(
    `[Local Node Agent] Started for node ${agentConfig.nodeId} -> ${agentConfig.mainServerUrl} every ${agentConfig.heartbeatIntervalMs}ms`
  );

  await runCycle(pool, config, agentConfig);

  state.timer = setInterval(() => {
    runCycle(pool, config, agentConfig).catch(error => {
      console.error('[Local Node Agent] Unexpected interval failure:', error.message);
    });
  }, agentConfig.heartbeatIntervalMs);

  if (typeof state.timer.unref === 'function') {
    state.timer.unref();
  }

  // Auto-update: check for code changes from main server every 5 minutes.
  // Works with both old and new supervisors — exits so supervisor restarts with new code.
  console.log(`[AutoUpdate] Scheduled — checking every ${AUTO_UPDATE_INTERVAL_MS / 60000} min`);
  const updateTimer = setInterval(() => {
    runAutoUpdate(agentConfig).catch(err => {
      console.error('[AutoUpdate] Unexpected error:', err.message);
    });
  }, AUTO_UPDATE_INTERVAL_MS);
  // Also run once after 60 seconds (give backend time to fully start first)
  setTimeout(() => {
    runAutoUpdate(agentConfig).catch(err => {
      console.error('[AutoUpdate] Initial check error:', err.message);
    });
  }, 60 * 1000);

  if (typeof updateTimer.unref === 'function') {
    updateTimer.unref();
  }
}

module.exports = {
  init
};
