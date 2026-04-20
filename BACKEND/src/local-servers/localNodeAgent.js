'use strict';

const os = require('os');
const path = require('path');
const fetch = require('node-fetch');

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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
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
      'LOCAL_FACTORY_ID'
    ]]
  );

  return result.rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
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

function buildLocalMetadata(config, agentConfig) {
  return {
    hostname: os.hostname(),
    serverType: agentConfig.serverType || config.serverType || '',
    localFactoryId: agentConfig.localFactoryId,
    databaseName: config.db?.database || null,
    nodeEnv: config.nodeEnv,
    appVersion: packageJson.version || null
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
  const syncStatus = await getSyncStatus(pool);
  const payload = {
    localIp: getPrimaryLanIp(),
    publicIp: agentConfig.publicIp,
    currentVersion: packageJson.version || '',
    lastSeenCommit: config.appGitSha || '',
    metadata: {
      ...buildLocalMetadata(config, agentConfig),
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
  const syncStatus = await getSyncStatus(pool);
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
          ...buildLocalMetadata(config, agentConfig),
          lastSyncAt: syncStatus.lastSyncAt
        }
      })
    }
  );
}

async function sendSyncStatus(pool, config, agentConfig) {
  const syncStatus = await getSyncStatus(pool);
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
          ...buildLocalMetadata(config, agentConfig),
          lastSyncAt: syncStatus.lastSyncAt
        }
      })
    }
  );
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
}

module.exports = {
  init
};
