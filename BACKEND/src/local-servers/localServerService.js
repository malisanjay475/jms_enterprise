'use strict';

const crypto = require('crypto');
const express = require('express');
const { getRequestUsername, normalizeFactoryId } = require('../app/requestContext');
const buildProvisioningPackage = require('./buildProvisioningPackage');

const router = express.Router();

let pool = null;

const HEARTBEAT_WINDOW_MINUTES = 5;

function ensureReady() {
  if (!pool) {
    const error = new Error('Local server service is initializing');
    error.statusCode = 503;
    throw error;
  }
}

function q(text, params = []) {
  ensureReady();
  return pool.query(text, params);
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function createNodeSecret() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeNodeCode(value, fallbackFactoryId) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  if (raw) return raw;
  return `factory-${fallbackFactoryId || 'node'}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.replace(/^::ffff:/, '');
}

function getRequestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map(part => normalizeIp(part))
    .filter(Boolean);

  if (forwarded.length) return forwarded[0];
  return normalizeIp(req.socket?.remoteAddress || req.ip || null);
}

function parseOptionalTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return false;
}

function buildReleaseLabel(version, commit) {
  const cleanVersion = String(version || '').trim();
  const cleanCommit = String(commit || '').trim();
  if (cleanVersion && cleanCommit) return `${cleanVersion}+${cleanCommit.slice(0, 12)}`;
  return cleanVersion || cleanCommit || null;
}

async function getActor(req) {
  const username = getRequestUsername(req);
  if (!username) return null;

  const result = await q(
    `SELECT id, username, role_code, global_access
       FROM users
      WHERE username = $1
        AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [username]
  );

  return result.rows[0] || null;
}

function isSuperadmin(actor) {
  return String(actor?.role_code || '').toLowerCase() === 'superadmin';
}

function isAdminLike(actor) {
  const role = String(actor?.role_code || '').toLowerCase();
  return role === 'admin' || role === 'superadmin';
}

async function getActorAccess(req) {
  const actor = await getActor(req);

  if (!actor || !isAdminLike(actor)) {
    return { actor, canSelectAllFactories: false, factoryIds: [] };
  }

  const canSelectAllFactories =
    isSuperadmin(actor) ||
    String(actor.username || '').toLowerCase() === 'superadmin' ||
    actor.global_access === true;

  if (canSelectAllFactories) {
    return { actor, canSelectAllFactories: true, factoryIds: [] };
  }

  const result = await q(
    `SELECT DISTINCT factory_id
       FROM user_factories
      WHERE user_id = $1`,
    [actor.id]
  );

  return {
    actor,
    canSelectAllFactories: false,
    factoryIds: result.rows
      .map(row => normalizeFactoryId(row.factory_id))
      .filter(id => id !== null)
  };
}

function requireAdminLike(access) {
  if (!access.actor || !isAdminLike(access.actor)) {
    const error = new Error('Admin or Superadmin access required');
    error.statusCode = 403;
    throw error;
  }
}

function requireSuperadmin(access) {
  if (!access.actor || !isSuperadmin(access.actor)) {
    const error = new Error('Only Superadmin can perform this action');
    error.statusCode = 403;
    throw error;
  }
}

function assertFactoryVisible(access, factoryId) {
  requireAdminLike(access);

  if (access.canSelectAllFactories) return;

  if (!access.factoryIds.includes(factoryId)) {
    const error = new Error(`You do not have access to Factory ${factoryId}`);
    error.statusCode = 403;
    throw error;
  }
}

async function ensureFactoryExists(factoryId) {
  const result = await q(
    `SELECT id, name, code
       FROM factories
      WHERE id = $1
      LIMIT 1`,
    [factoryId]
  );

  return result.rows[0] || null;
}

async function getLocalServerById(localServerId) {
  const result = await q(
    `SELECT ls.id,
            ls.factory_id,
            ls.node_code,
            ls.node_name,
            ls.status,
            ls.server_mode,
            ls.local_ip,
            ls.public_ip,
            ls.last_heartbeat_at,
            ls.last_registration_at,
            ls.last_push_at,
            ls.last_pull_at,
            ls.current_version,
            ls.target_version,
            ls.last_seen_commit,
            ls.last_error,
            ls.last_sync_status,
            ls.is_active,
            ls.metadata,
            ls.created_by,
            ls.updated_by,
            ls.created_at,
            ls.updated_at,
            f.name AS factory_name,
            f.code AS factory_code
       FROM local_servers ls
       JOIN factories f ON f.id = ls.factory_id
      WHERE ls.id = $1
      LIMIT 1`,
    [localServerId]
  );

  return result.rows[0] || null;
}

async function getLocalServerSecretHash(localServerId) {
  const result = await q(
    `SELECT node_secret_hash
       FROM local_servers
      WHERE id = $1
      LIMIT 1`,
    [localServerId]
  );

  return result.rows[0]?.node_secret_hash || null;
}

async function authenticateNode(req, localServerId) {
  const secret = String(req.headers['x-node-key'] || req.headers['x-local-server-key'] || '').trim();
  if (!secret) {
    const error = new Error('Missing node authentication key');
    error.statusCode = 401;
    throw error;
  }

  const result = await q(
    `SELECT id, factory_id, node_code, node_name, target_version, is_active, node_secret_hash
       FROM local_servers
      WHERE id = $1
      LIMIT 1`,
    [localServerId]
  );

  const localServer = result.rows[0];
  if (!localServer || !localServer.is_active) {
    const error = new Error('Local server is not active');
    error.statusCode = 404;
    throw error;
  }

  if (hashSecret(secret) !== localServer.node_secret_hash) {
    const error = new Error('Invalid node authentication key');
    error.statusCode = 403;
    throw error;
  }

  return localServer;
}

function buildLocalServerRow(row) {
  const metadata = normalizeMetadata(row.metadata);
  const autoUpdate = normalizeMetadata(metadata.autoUpdate);
  const syncAudit = normalizeMetadata(metadata.syncAudit);
  const currentRelease = buildReleaseLabel(row.current_version, row.last_seen_commit) || autoUpdate.currentRelease || null;
  const targetRelease = String(autoUpdate.targetRelease || row.target_version || '').trim() || null;
  const updatePending = parseBoolean(autoUpdate.updatePending) || (!!targetRelease && targetRelease !== currentRelease);

  return {
    id: row.id,
    factoryId: row.factory_id,
    factoryName: row.factory_name,
    factoryCode: row.factory_code,
    nodeCode: row.node_code,
    nodeName: row.node_name,
    status: row.status,
    serverMode: row.server_mode,
    localIp: row.local_ip,
    publicIp: row.public_ip,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastRegistrationAt: row.last_registration_at,
    lastPushAt: row.last_push_at,
    lastPullAt: row.last_pull_at,
    currentVersion: row.current_version,
    currentRelease,
    targetVersion: row.target_version,
    targetRelease,
    updatePending,
    lastSuccessfulAutoUpdateAt: parseOptionalTimestamp(autoUpdate.lastSuccessfulAutoUpdateAt),
    failedUpdateReason: String(autoUpdate.failedUpdateReason || '').trim() || null,
    lastUpdateCheckAt: parseOptionalTimestamp(autoUpdate.lastCheckedAt),
    lastSeenCommit: row.last_seen_commit,
    lastError: row.last_error,
    lastSyncStatus: row.last_sync_status,
    syncAudit: {
      created: Number.parseInt(String(syncAudit.created || '0'), 10) || 0,
      updated: Number.parseInt(String(syncAudit.updated || '0'), 10) || 0,
      deleted: Number.parseInt(String(syncAudit.deleted || '0'), 10) || 0,
      failed: Number.parseInt(String(syncAudit.failed || '0'), 10) || 0,
      pending: Number.parseInt(String(syncAudit.pending || '0'), 10) || 0,
      lastCycleAt: parseOptionalTimestamp(syncAudit.lastCycleAt)
    },
    isActive: row.is_active,
    isConnected: !!row.is_connected,
    metadata,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS local_servers (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
      node_code TEXT NOT NULL UNIQUE,
      node_name TEXT NOT NULL,
      node_secret_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_registration',
      server_mode TEXT NOT NULL DEFAULT 'local',
      local_ip TEXT,
      public_ip TEXT,
      last_heartbeat_at TIMESTAMPTZ,
      last_registration_at TIMESTAMPTZ,
      last_push_at TIMESTAMPTZ,
      last_pull_at TIMESTAMPTZ,
      current_version TEXT,
      target_version TEXT,
      last_seen_commit TEXT,
      last_error TEXT,
      last_sync_status TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS local_server_heartbeats (
      id BIGSERIAL PRIMARY KEY,
      local_server_id INTEGER NOT NULL REFERENCES local_servers(id) ON DELETE CASCADE,
      status TEXT,
      local_ip TEXT,
      public_ip TEXT,
      current_version TEXT,
      last_seen_commit TEXT,
      last_push_at TIMESTAMPTZ,
      last_pull_at TIMESTAMPTZ,
      last_error TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_local_servers_factory_id ON local_servers(factory_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_local_servers_status ON local_servers(status)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_local_servers_last_heartbeat_at ON local_servers(last_heartbeat_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_local_server_heartbeats_server_id ON local_server_heartbeats(local_server_id, created_at DESC)`);
}

async function updateNodeState(localServerId, payload, fallbackStatus = 'online') {
  const nowIp = getRequestIp(payload.req);
  const localIp = normalizeIp(payload.localIp || nowIp);
  const publicIp = normalizeIp(payload.publicIp);
  const currentVersion = String(payload.currentVersion || '').trim() || null;
  const lastSeenCommit = String(payload.lastSeenCommit || '').trim() || null;
  const lastError = String(payload.lastError || '').trim() || null;
  const syncStatus = String(payload.syncStatus || '').trim() || null;
  const status = String(payload.status || '').trim() || fallbackStatus;
  const lastPushAt = parseOptionalTimestamp(payload.lastPushAt);
  const lastPullAt = parseOptionalTimestamp(payload.lastPullAt);
  const metadata = normalizeMetadata(payload.metadata);

  const result = await q(
    `UPDATE local_servers
        SET local_ip = COALESCE($2, local_ip),
            public_ip = COALESCE($3, public_ip),
            status = $4,
            current_version = COALESCE($5, current_version),
            last_seen_commit = COALESCE($6, last_seen_commit),
            last_error = $7,
            last_sync_status = COALESCE($8, last_sync_status),
            last_push_at = COALESCE($9::timestamptz, last_push_at),
            last_pull_at = COALESCE($10::timestamptz, last_pull_at),
            metadata = CASE
              WHEN $11::jsonb = '{}'::jsonb THEN metadata
              ELSE COALESCE(metadata, '{}'::jsonb) || $11::jsonb
            END,
            last_heartbeat_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      localServerId,
      localIp,
      publicIp,
      status,
      currentVersion,
      lastSeenCommit,
      lastError,
      syncStatus,
      lastPushAt,
      lastPullAt,
      JSON.stringify(metadata)
    ]
  );

  await q(
    `INSERT INTO local_server_heartbeats (
        local_server_id,
        status,
        local_ip,
        public_ip,
        current_version,
        last_seen_commit,
        last_push_at,
        last_pull_at,
        last_error,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10::jsonb)`,
    [
      localServerId,
      status,
      localIp,
      publicIp,
      currentVersion,
      lastSeenCommit,
      lastPushAt,
      lastPullAt,
      lastError,
      JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

router.get('/', async (req, res) => {
  try {
    const access = await getActorAccess(req);
    requireAdminLike(access);

    const requestedFactoryId = normalizeFactoryId(req.query.factoryId);
    const requestedStatus = String(req.query.status || '').trim().toLowerCase();
    const includeInactive = String(req.query.includeInactive || '').trim() === '1';

    if (requestedFactoryId !== null) {
      assertFactoryVisible(access, requestedFactoryId);
    }

    const clauses = [];
    const params = [];

    if (!includeInactive) {
      clauses.push('ls.is_active = TRUE');
    }

    if (requestedFactoryId !== null) {
      params.push(requestedFactoryId);
      clauses.push(`ls.factory_id = $${params.length}`);
    } else if (!access.canSelectAllFactories) {
      if (!access.factoryIds.length) {
        return res.json({ ok: true, localServers: [] });
      }
      params.push(access.factoryIds);
      clauses.push(`ls.factory_id = ANY($${params.length}::int[])`);
    }

    if (requestedStatus) {
      params.push(requestedStatus);
      clauses.push(`LOWER(ls.status) = $${params.length}`);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await q(
      `SELECT ls.*,
              f.name AS factory_name,
              f.code AS factory_code,
              (ls.last_heartbeat_at IS NOT NULL AND ls.last_heartbeat_at >= NOW() - INTERVAL '${HEARTBEAT_WINDOW_MINUTES} minutes') AS is_connected
         FROM local_servers ls
         JOIN factories f ON f.id = ls.factory_id
        ${whereSql}
        ORDER BY f.id, ls.node_name, ls.id`,
      params
    );

    res.json({
      ok: true,
      localServers: result.rows.map(buildLocalServerRow)
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const access = await getActorAccess(req);
    requireAdminLike(access);

    const localServerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(localServerId) || localServerId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid local server id' });
    }

    const localServer = await getLocalServerById(localServerId);
    if (!localServer) {
      return res.status(404).json({ ok: false, error: 'Local server not found' });
    }

    assertFactoryVisible(access, normalizeFactoryId(localServer.factory_id));

    const result = await q(
      `SELECT status,
              local_ip,
              public_ip,
              current_version,
              last_seen_commit,
              last_push_at,
              last_pull_at,
              last_error,
              payload,
              created_at
         FROM local_server_heartbeats
        WHERE local_server_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [localServerId]
    );

    res.json({
      ok: true,
      localServer: buildLocalServerRow({
        ...localServer,
        is_connected:
          localServer.last_heartbeat_at &&
          new Date(localServer.last_heartbeat_at).getTime() >= Date.now() - HEARTBEAT_WINDOW_MINUTES * 60 * 1000
      }),
      heartbeats: result.rows.map(row => ({
        status: row.status,
        localIp: row.local_ip,
        publicIp: row.public_ip,
        currentVersion: row.current_version,
        lastSeenCommit: row.last_seen_commit,
        lastPushAt: row.last_push_at,
        lastPullAt: row.last_pull_at,
        lastError: row.last_error,
        payload: row.payload || {},
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const access = await getActorAccess(req);
    requireSuperadmin(access);

    const factoryId = normalizeFactoryId(req.body?.factoryId);
    const nodeName = String(req.body?.nodeName || '').trim();
    const targetVersion = String(req.body?.targetVersion || '').trim() || null;
    const metadata = normalizeMetadata(req.body?.metadata);

    if (factoryId === null) {
      return res.status(400).json({ ok: false, error: 'factoryId is required' });
    }
    if (!nodeName) {
      return res.status(400).json({ ok: false, error: 'nodeName is required' });
    }

    const factory = await ensureFactoryExists(factoryId);
    if (!factory) {
      return res.status(400).json({ ok: false, error: `Factory ${factoryId} does not exist` });
    }

    const nodeCode = normalizeNodeCode(req.body?.nodeCode, factoryId);
    const nodeKey = createNodeSecret();

    const result = await q(
      `INSERT INTO local_servers (
          factory_id,
          node_code,
          node_name,
          node_secret_hash,
          status,
          target_version,
          metadata,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, 'pending_registration', $5, $6::jsonb, $7, $7)
        RETURNING *`,
      [
        factoryId,
        nodeCode,
        nodeName,
        hashSecret(nodeKey),
        targetVersion,
        JSON.stringify(metadata),
        access.actor.username
      ]
    );

    const localServer = await getLocalServerById(result.rows[0].id);

    res.status(201).json({
      ok: true,
      localServer: buildLocalServerRow({ ...localServer, is_connected: false }),
      nodeKey
    });
  } catch (error) {
    const statusCode = error.code === '23505' ? 409 : error.statusCode || 500;
    const message = error.code === '23505'
      ? 'nodeCode already exists. Use a different node code.'
      : error.message;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const access = await getActorAccess(req);
    requireSuperadmin(access);

    const localServerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(localServerId) || localServerId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid local server id' });
    }

    const existing = await getLocalServerById(localServerId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Local server not found' });
    }

    const updates = [];
    const params = [];

    if (req.body?.nodeName !== undefined) {
      const nodeName = String(req.body.nodeName || '').trim();
      if (!nodeName) {
        return res.status(400).json({ ok: false, error: 'nodeName cannot be empty' });
      }
      params.push(nodeName);
      updates.push(`node_name = $${params.length}`);
    }

    if (req.body?.targetVersion !== undefined) {
      params.push(String(req.body.targetVersion || '').trim() || null);
      updates.push(`target_version = $${params.length}`);
    }

    if (req.body?.isActive !== undefined) {
      params.push(Boolean(req.body.isActive));
      updates.push(`is_active = $${params.length}`);
    }

    if (req.body?.status !== undefined) {
      params.push(String(req.body.status || '').trim() || existing.status);
      updates.push(`status = $${params.length}`);
    }

    if (req.body?.metadata !== undefined) {
      params.push(JSON.stringify(normalizeMetadata(req.body.metadata)));
      updates.push(`metadata = $${params.length}::jsonb`);
    }

    if (!updates.length) {
      return res.status(400).json({ ok: false, error: 'No valid fields provided for update' });
    }

    params.push(access.actor.username);
    updates.push(`updated_by = $${params.length}`);
    updates.push('updated_at = NOW()');
    params.push(localServerId);

    await q(
      `UPDATE local_servers
          SET ${updates.join(', ')}
        WHERE id = $${params.length}`,
      params
    );

    const localServer = await getLocalServerById(localServerId);
    res.json({
      ok: true,
      localServer: buildLocalServerRow({
        ...localServer,
        is_connected:
          localServer.last_heartbeat_at &&
          new Date(localServer.last_heartbeat_at).getTime() >= Date.now() - HEARTBEAT_WINDOW_MINUTES * 60 * 1000
      })
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

router.post('/:id/rotate-key', async (req, res) => {
  try {
    const access = await getActorAccess(req);
    requireSuperadmin(access);

    const localServerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(localServerId) || localServerId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid local server id' });
    }

    const existing = await getLocalServerById(localServerId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Local server not found' });
    }

    const nodeKey = createNodeSecret();
    await q(
      `UPDATE local_servers
          SET node_secret_hash = $2,
              updated_by = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [localServerId, hashSecret(nodeKey), access.actor.username]
    );

    res.json({ ok: true, nodeKey });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

router.post('/:id/download-package', async (req, res) => {
  try {
    const access = await getActorAccess(req);
    requireSuperadmin(access);

    const localServerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(localServerId) || localServerId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid local server id' });
    }

    const existing = await getLocalServerById(localServerId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Local server not found' });
    }

    const providedNodeKey = String(req.body?.nodeKey || '').trim();
    let nodeKey = providedNodeKey;

    if (providedNodeKey) {
      const currentHash = await getLocalServerSecretHash(localServerId);
      if (!currentHash || hashSecret(providedNodeKey) !== currentHash) {
        return res.status(403).json({ ok: false, error: 'Provided node key is no longer valid. Download a fresh installer.' });
      }
    } else {
      nodeKey = createNodeSecret();
      await q(
        `UPDATE local_servers
            SET node_secret_hash = $2,
                updated_by = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [localServerId, hashSecret(nodeKey), access.actor.username]
      );
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || '';
    const mainServerUrl = String(req.app?.locals?.config?.mainServerUrl || '').trim() || `${protocol}://${host}`;

    const { buffer, fileName } = buildProvisioningPackage({
      localServer: buildLocalServerRow({ ...existing, is_connected: false }),
      nodeKey,
      mainServerUrl
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

router.post('/:id/register', async (req, res) => {
  try {
    const localServerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(localServerId) || localServerId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid local server id' });
    }

    const localServer = await authenticateNode(req, localServerId);

    await q(
      `UPDATE local_servers
          SET status = 'online',
              local_ip = COALESCE($2, local_ip),
              public_ip = COALESCE($3, public_ip),
              current_version = COALESCE($4, current_version),
              last_seen_commit = COALESCE($5, last_seen_commit),
              metadata = CASE
                WHEN $6::jsonb = '{}'::jsonb THEN metadata
                ELSE COALESCE(metadata, '{}'::jsonb) || $6::jsonb
              END,
              last_registration_at = NOW(),
              last_heartbeat_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [
        localServerId,
        normalizeIp(req.body?.localIp || getRequestIp(req)),
        normalizeIp(req.body?.publicIp),
        String(req.body?.currentVersion || '').trim() || null,
        String(req.body?.lastSeenCommit || '').trim() || null,
        JSON.stringify(normalizeMetadata(req.body?.metadata))
      ]
    );

    const fullRow = await getLocalServerById(localServerId);

    res.json({
      ok: true,
      localServer: {
        id: fullRow.id,
        nodeCode: fullRow.node_code,
        nodeName: fullRow.node_name,
        factoryId: fullRow.factory_id,
        targetVersion: fullRow.target_version,
        status: fullRow.status
      },
      heartbeatIntervalSeconds: 60
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

router.post('/:id/heartbeat', async (req, res) => {
  try {
    const localServerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(localServerId) || localServerId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid local server id' });
    }

    const localServer = await authenticateNode(req, localServerId);
    const updated = await updateNodeState(localServer.id, {
      req,
      localIp: req.body?.localIp,
      publicIp: req.body?.publicIp,
      currentVersion: req.body?.currentVersion,
      lastSeenCommit: req.body?.lastSeenCommit,
      lastPushAt: req.body?.lastPushAt,
      lastPullAt: req.body?.lastPullAt,
      lastError: req.body?.lastError,
      syncStatus: req.body?.syncStatus,
      status: req.body?.status || 'online',
      metadata: req.body?.metadata
    });

    res.json({
      ok: true,
      status: updated.status,
      serverTime: new Date().toISOString(),
      targetVersion: localServer.target_version
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

router.post('/:id/sync-status', async (req, res) => {
  try {
    const localServerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(localServerId) || localServerId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid local server id' });
    }

    const localServer = await authenticateNode(req, localServerId);
    const updated = await updateNodeState(localServer.id, {
      req,
      localIp: req.body?.localIp,
      publicIp: req.body?.publicIp,
      currentVersion: req.body?.currentVersion,
      lastSeenCommit: req.body?.lastSeenCommit,
      lastPushAt: req.body?.lastPushAt,
      lastPullAt: req.body?.lastPullAt,
      lastError: req.body?.lastError,
      syncStatus: req.body?.syncStatus,
      status: req.body?.status || (req.body?.lastError ? 'degraded' : 'online'),
      metadata: req.body?.metadata
    }, req.body?.lastError ? 'degraded' : 'online');

    res.json({
      ok: true,
      status: updated.status,
      targetVersion: localServer.target_version
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

async function init(dbPool) {
  pool = dbPool;
  await ensureSchema();
  console.log('[Local Servers] Phase 1 schema ready');
}

module.exports = {
  init,
  router
};
