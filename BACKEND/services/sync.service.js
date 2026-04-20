const fetch = require('node-fetch');
const express = require('express');

const router = express.Router();

let pool;
let SERVER_TYPE = 'STANDALONE';
let MAIN_SERVER_URL = '';
let LOCAL_FACTORY_ID = 1;
let API_KEY = 'jpsms-sync-key';

const SYNC_INTERVAL_MS = 60 * 1000;
const DELETE_BATCH_LIMIT = 1000;

const SYNC_ALL = [
    'app_settings',
    'assembly_lines',
    'assembly_plans',
    'assembly_scans',
    'bom_components',
    'bom_master',
    'closed_plants',
    'dispatch_items',
    'dpr_hourly',
    'dpr_reasons',
    'factories',
    'grinding_logs',
    'grn_entries',
    'jc_details',
    'jc_summaries',
    'job_cards',
    'jobs_queue',
    'machine_audit_logs',
    'machine_operators',
    'machine_status_logs',
    'machines',
    'mould_audit_logs',
    'mould_planning_report',
    'mould_planning_summary',
    'moulds',
    'notifications',
    'operator_history',
    'order_completion_history',
    'or_jr_report',
    'orders',
    'plan_audit_logs',
    'plan_board',
    'plan_history',
    'planning_drops',
    'purchase_order_items',
    'purchase_orders',
    'qc_deviations',
    'qc_issue_memos',
    'qc_online_reports',
    'qc_training_sheets',
    'raw_material_issues',
    'roles',
    'shift_teams',
    'shifting_records',
    'std_actual',
    'user_factories',
    'users',
    'vendor_dispatch',
    'vendor_payments',
    'vendor_users',
    'vendors',
    'wip_inventory',
    'wip_outward_logs',
    'wip_stock_movements',
    'wip_stock_snapshot_lines',
    'wip_stock_snapshots'
];

const TABLES_TO_PUSH = [...SYNC_ALL];
const TABLES_TO_PULL = [...SYNC_ALL];

const CONFLICT_KEYS = {
    users: 'id',
    roles: 'code',
    orders: 'id',
    plan_board: 'plan_id',
    plan_audit_logs: 'id',
    plan_history: 'id',
    purchase_order_items: 'id',
    purchase_orders: 'id',
    user_factories: 'id',
    dpr_reasons: 'id',
    mould_planning_report: 'id',
    mould_planning_summary: 'id',
    jc_details: 'id',
    jc_summaries: 'id',
    job_cards: 'id',
    machine_operators: 'id',
    machine_status_logs: 'id',
    mould_audit_logs: 'id',
    qc_deviations: 'id',
    qc_issue_memos: 'id',
    qc_online_reports: 'id',
    qc_training_sheets: 'id',
    shifting_records: 'id',
    std_actual: 'id',
    vendor_dispatch: 'id',
    vendor_payments: 'id',
    vendor_users: 'id',
    wip_inventory: 'id',
    wip_outward_logs: 'id',
    assembly_lines: 'line_id',
    assembly_plans: 'id',
    assembly_scans: 'id',
    vendors: 'id',
    app_settings: 'key',
    factories: 'id',
    grinding_logs: 'id',
    shift_teams: 'line, shift_date, shift',
    closed_plants: 'factory_id, dpr_date, plant, shift',
    machine_audit_logs: 'sync_id',
    notifications: 'sync_id',
    order_completion_history: 'factory_id, order_no, action_type, changed_at',
    raw_material_issues: 'factory_id, plan_id, created_at',
    wip_stock_movements: 'factory_id, source_type, source_ref, movement_type, created_at',
    wip_stock_snapshots: 'factory_id, stock_date, source_file_name',
    wip_stock_snapshot_lines: 'factory_id, stock_date, comparison_key'
};

const SYNC_UPDATED_AT_SOURCE_COLUMNS = {
    closed_plants: 'created_at',
    machine_audit_logs: 'changed_at',
    notifications: 'created_at',
    order_completion_history: 'changed_at',
    raw_material_issues: 'created_at',
    wip_stock_movements: 'created_at'
};

const SYNC_CONFLICT_INDEXES = {
    closed_plants: 'factory_id, dpr_date, plant, shift',
    order_completion_history: 'factory_id, order_no, action_type, changed_at',
    raw_material_issues: 'factory_id, plan_id, created_at',
    shift_teams: 'line, shift_date, shift',
    wip_stock_movements: 'factory_id, source_type, source_ref, movement_type, created_at',
    wip_stock_snapshots: 'factory_id, stock_date, source_file_name',
    wip_stock_snapshot_lines: 'factory_id, stock_date, comparison_key'
};

const SYNC_ID_REQUIRED_TABLES = ['notifications'];

function getDeterministicNotificationSyncIdSql(tableAlias = '') {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    return `
        (
            substr(
                md5(
                    concat_ws(
                        '||',
                        COALESCE(${prefix}target_user, ''),
                        COALESCE(${prefix}type, ''),
                        COALESCE(${prefix}title, ''),
                        COALESCE(to_char(${prefix}created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')
                    )
                ),
                1,
                32
            )::uuid
        )
    `;
}

const TRANSFORMERS = {
    vendors: (row) => {
        if (row.factory_access) {
            console.log(`[Sync] Vendors Debug: type=${typeof row.factory_access}, value=${JSON.stringify(row.factory_access)}`);
            if (typeof row.factory_access === 'string') {
                if (row.factory_access.includes('{') && !row.factory_access.includes(':')) {
                    try {
                        const clean = row.factory_access.replace(/["{}]/g, '').split(',');
                        row.factory_access = JSON.stringify(clean.map(Number).filter(n => !isNaN(n)));
                        console.log(`[Sync] Fixed vendor access to: ${row.factory_access}`);
                    } catch (e) {
                        row.factory_access = '[]';
                        console.log('[Sync] Failed to fix vendor access, set to []');
                    }
                }
            } else if (typeof row.factory_access === 'object') {
                console.log('[Sync] Vendor access is object:', JSON.stringify(row.factory_access));
                row.factory_access = JSON.stringify(row.factory_access);
            }
        }
        return row;
    }
};

async function setServerConfigValue(key, value) {
    if (!pool) return;
    await pool.query(
        `INSERT INTO server_config (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value == null ? '' : String(value)]
    );
}

async function setSyncAuditState(stats = {}) {
    await setServerConfigValue('LAST_SYNC_CREATED_COUNT', stats.created || 0);
    await setServerConfigValue('LAST_SYNC_UPDATED_COUNT', stats.updated || 0);
    await setServerConfigValue('LAST_SYNC_DELETED_COUNT', stats.deleted || 0);
    await setServerConfigValue('LAST_SYNC_FAILED_COUNT', stats.failed || 0);
    await setServerConfigValue('LAST_SYNC_PENDING_COUNT', stats.pending || 0);
    await setServerConfigValue('LAST_SYNC_CYCLE_AT', new Date().toISOString());
}

async function getDatabaseNowIso() {
    const result = await pool.query('SELECT NOW() AS ts');
    return new Date(result.rows[0].ts).toISOString();
}

function normalizeSyncTimestampInput(value) {
    if (!value) return value;
    const raw = String(value).trim();
    if (!raw) return raw;

    if (/\s\d{2}:\d{2}$/.test(raw) && !/[+-]\d{2}:\d{2}$/.test(raw)) {
        return raw.replace(/\s(\d{2}:\d{2})$/, '+$1');
    }

    return raw;
}

/* ============================================================
   ROUTER DEFINITIONS (Mounted at /api/sync)
   ============================================================ */

router.post('/push', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { factoryId, table, data, apiKey } = req.body || {};
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });
        if (!TABLES_TO_PUSH.includes(table)) return res.status(400).json({ error: 'Invalid Table' });

        console.log(`[Sync] Received ${Array.isArray(data) ? data.length : 0} rows for ${table} from Factory ${factoryId}`);

        const normalized = Array.isArray(data) ? data : [];
        const hasFactoryIdColumn = await tableHasColumn(table, 'factory_id');
        const hasSyncIdColumn = await tableHasColumn(table, 'sync_id');
        normalized.forEach((row) => {
            if (hasFactoryIdColumn) {
                row.factory_id = factoryId;
            } else if (Object.prototype.hasOwnProperty.call(row, 'factory_id')) {
                delete row.factory_id;
            }

            if (hasSyncIdColumn) {
                if (!row.sync_id && row.global_id) row.sync_id = row.global_id;
            } else if (Object.prototype.hasOwnProperty.call(row, 'sync_id')) {
                delete row.sync_id;
            }
        });

        const stats = await upsertData(table, normalized);
        if (stats.failed > 0) {
            return res.status(500).json({ error: `Failed to upsert ${stats.failed} row(s) for ${table}`, stats });
        }
        res.json({ ok: true, rows: normalized.length, stats });
    } catch (e) {
        console.error('[Sync] Push Receive Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/push-deletions', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { deletions, apiKey } = req.body || {};
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });
        if (!Array.isArray(deletions)) return res.status(400).json({ error: 'Invalid deletions payload' });

        const normalized = deletions.filter((entry) => entry && TABLES_TO_PUSH.includes(entry.table));
        const stats = await applyRemoteDeletions(normalized);
        if (stats.failed > 0) {
            return res.status(500).json({ error: `Failed to apply ${stats.failed} deletion(s)`, stats });
        }
        res.json({ ok: true, rows: normalized.length, stats });
    } catch (e) {
        console.error('[Sync] Push Deletions Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/pull', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { table, lastSync, since, apiKey, factoryId } = req.query;
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });
        if (!TABLES_TO_PULL.includes(table)) return res.status(400).json({ error: 'Invalid Table' });

        const rows = await getChanges(table, since || lastSync, factoryId);
        res.json({ ok: true, data: rows });
    } catch (e) {
        console.error('[Sync] Pull Serve Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/pull-deletions', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { since, apiKey, factoryId } = req.query;
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });

        const deletions = await getDeletionChanges(since, factoryId);
        res.json({ ok: true, data: deletions });
    } catch (e) {
        console.error('[Sync] Pull Deletions Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/status', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        let lastSync = 'Never';
        let lastPush = 'Never';
        let lastPull = 'Never';

        const result = await pool.query("SELECT * FROM server_config WHERE key IN ('LAST_SYNC', 'LAST_PUSH', 'LAST_PULL')");
        result.rows.forEach((r) => {
            if (r.key === 'LAST_SYNC') lastSync = r.value;
            if (r.key === 'LAST_PUSH') lastPush = r.value;
            if (r.key === 'LAST_PULL') lastPull = r.value;
        });

        res.json({
            ok: true,
            type: SERVER_TYPE,
            factory_id: LOCAL_FACTORY_ID,
            main_url: MAIN_SERVER_URL,
            last_sync: lastSync,
            last_push: lastPush,
            last_pull: lastPull
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* ============================================================
   CORE SYNC LOGIC
   ============================================================ */

async function init(dbPool) {
    pool = dbPool;
    try {
        await ensureSyncUpdatedAtSchema();
        await ensureSyncIdSchema();
        await ensureSyncConflictIndexes();
        await ensureDeleteTrackingSchema();

        const res = await pool.query('SELECT key, value FROM server_config');
        const config = {};
        res.rows.forEach((r) => {
            config[r.key] = r.value;
        });

        if (config.SERVER_TYPE) SERVER_TYPE = config.SERVER_TYPE;
        if (config.MAIN_SERVER_URL) MAIN_SERVER_URL = config.MAIN_SERVER_URL;
        if (config.LOCAL_FACTORY_ID) LOCAL_FACTORY_ID = parseInt(config.LOCAL_FACTORY_ID, 10);
        if (config.SYNC_API_KEY) API_KEY = config.SYNC_API_KEY;

        console.log(`[Sync] Init. Type: ${SERVER_TYPE}, Factory: ${LOCAL_FACTORY_ID}, Main: ${MAIN_SERVER_URL}`);
        console.log('[Sync] Service Version: v4.5 (Delete Sync)');

        if (SERVER_TYPE === 'LOCAL') {
            startSchedule();
        } else if (SERVER_TYPE === 'STANDALONE') {
            console.log('[Sync] STANDALONE MODE: Sync is DISABLED.');
        }
    } catch (e) {
        console.error('[Sync] Init Failed:', e);
    }
}

let syncTimer = null;
let triggerTimeout = null;
let lastSyncTime = null;
let lastPushTime = null;
let lastPullTime = null;

function startSchedule() {
    console.log('[Sync] Starting Schedule...');
    setTimeout(runSyncCycle, 10000);
}

function triggerSync() {
    if (SERVER_TYPE !== 'LOCAL') {
        console.log(`[Sync] Trigger ignored (Mode: ${SERVER_TYPE})`);
        return;
    }
    console.log('[Sync] Trigger requested...');
    if (triggerTimeout) clearTimeout(triggerTimeout);
    triggerTimeout = setTimeout(() => {
        console.log('[Sync] Triggering Immediate Cycle!');
        runSyncCycle();
    }, 2000);
}

async function runSyncCycle() {
    if (!pool || !LOCAL_FACTORY_ID || !MAIN_SERVER_URL) return;
    console.log('[Sync] Running Cycle...');
    lastSyncTime = new Date();
    const cycleStats = {
        created: 0,
        updated: 0,
        deleted: 0,
        failed: 0,
        pending: 0
    };

    try {
        if (TABLES_TO_PUSH.length > 0) {
            const pushStats = await pushChanges();
            const deletePushStats = await pushDeletionChanges();
            cycleStats.failed += pushStats.failed + deletePushStats.failed;
            cycleStats.deleted += deletePushStats.deleted;
            lastPushTime = new Date();
        }
        if (TABLES_TO_PULL.length > 0) {
            const pullStats = await pullChanges();
            const deletePullStats = await pullDeletionChanges();
            cycleStats.created += pullStats.created;
            cycleStats.updated += pullStats.updated;
            cycleStats.failed += pullStats.failed + deletePullStats.failed;
            cycleStats.deleted += deletePullStats.deleted;
            lastPullTime = new Date();
        }
        cycleStats.pending = await countPendingChanges();
        await setServerConfigValue('LAST_SYNC', await getDatabaseNowIso());
        await setSyncAuditState(cycleStats);
    } catch (e) {
        console.error('[Sync] Cycle Failed:', e);
        cycleStats.failed += 1;
        cycleStats.pending = await countPendingChanges().catch(() => cycleStats.pending);
        await setSyncAuditState(cycleStats).catch((err) => {
            console.error('[Sync] Failed to persist sync audit state:', err.message);
        });
    }

    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(runSyncCycle, SYNC_INTERVAL_MS);
}

async function pushChanges() {
    const stats = { pushed: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PUSH'`);
    const lastPush = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    for (const table of TABLES_TO_PUSH) {
        let rows;
        try {
            const hasFactoryId = await tableHasColumn(table, 'factory_id');
            const sql = hasFactoryId
                ? `
                    SELECT * FROM ${table}
                    WHERE updated_at > $1
                      AND factory_id = $2
                    LIMIT 100
                `
                : `
                    SELECT * FROM ${table}
                    WHERE updated_at > $1
                    LIMIT 100
                `;
            const params = hasFactoryId ? [lastPush, LOCAL_FACTORY_ID] : [lastPush];
            rows = await pool.query(sql, params);
        } catch (error) {
            console.error(`[Sync] Push Query Failed ${table}:`, error.message);
            stats.failed += 1;
            continue;
        }

        if (rows.rows.length > 0) {
            console.log(`[Sync] Pushing ${rows.rows.length} rows for ${table}...`);
            const payload = {
                factoryId: LOCAL_FACTORY_ID,
                table,
                data: rows.rows,
                apiKey: API_KEY
            };

            const response = await fetch(`${MAIN_SERVER_URL}/api/sync/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const text = await response.text();
                console.error(`[Sync] Push Failed Details for ${table}:`, text);
                stats.failed += rows.rows.length;
                throw new Error(`Push failed: ${response.status} ${response.statusText} - ${text}`);
            }
            stats.pushed += rows.rows.length;
        }
    }

    if (stats.failed === 0) {
        await setServerConfigValue('LAST_PUSH', cycleWatermark);
    } else {
        console.warn('[Sync] LAST_PUSH not advanced because one or more table pushes failed.');
    }
    return stats;
}

async function pushDeletionChanges() {
    const stats = { deleted: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PUSH'`);
    const lastPush = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();
    const deletions = await getDeletionChanges(lastPush, LOCAL_FACTORY_ID);

    if (deletions.length > 0) {
        console.log(`[Sync] Pushing ${deletions.length} deletions...`);
        const response = await fetch(`${MAIN_SERVER_URL}/api/sync/push-deletions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deletions, apiKey: API_KEY })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error('[Sync] Push Deletions Failed:', text);
            stats.failed += deletions.length;
            throw new Error(`Push deletions failed: ${response.status} ${response.statusText} - ${text}`);
        }
        stats.deleted += deletions.length;
    }

    if (stats.failed === 0) {
        await setServerConfigValue('LAST_DELETE_PUSH', cycleWatermark);
    } else {
        console.warn('[Sync] LAST_DELETE_PUSH not advanced because one or more deletion pushes failed.');
    }
    return stats;
}

async function pullChanges() {
    const stats = { created: 0, updated: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    for (const table of TABLES_TO_PULL) {
        try {
            const response = await fetch(`${MAIN_SERVER_URL}/api/sync/pull?table=${encodeURIComponent(table)}&since=${encodeURIComponent(lastPull)}&apiKey=${encodeURIComponent(API_KEY)}&factoryId=${encodeURIComponent(LOCAL_FACTORY_ID)}`);
            if (!response.ok) continue;

            const json = await response.json();
            const data = json.data || [];

            if (data.length > 0) {
                console.log(`[Sync] Pulled ${data.length} rows for ${table}...`);
                const tableStats = await upsertData(table, data);
                stats.created += tableStats.created;
                stats.updated += tableStats.updated;
                stats.failed += tableStats.failed;
            }
        } catch (e) {
            console.error(`[Sync] Pull Failed ${table}:`, e);
            stats.failed += 1;
        }
    }

    if (stats.failed === 0) {
        await setServerConfigValue('LAST_PULL', cycleWatermark);
    } else {
        console.warn('[Sync] LAST_PULL not advanced because one or more table pulls failed.');
    }
    return stats;
}

async function pullDeletionChanges() {
    const stats = { deleted: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    try {
        const response = await fetch(`${MAIN_SERVER_URL}/api/sync/pull-deletions?since=${encodeURIComponent(lastPull)}&apiKey=${encodeURIComponent(API_KEY)}&factoryId=${encodeURIComponent(LOCAL_FACTORY_ID)}`);
        if (response.ok) {
            const json = await response.json();
            const deletions = json.data || [];
            if (deletions.length > 0) {
                console.log(`[Sync] Pulled ${deletions.length} deletions...`);
                const applied = await applyRemoteDeletions(deletions);
                stats.deleted += applied.deleted;
                stats.failed += applied.failed;
            }
        }
    } catch (e) {
        console.error('[Sync] Pull Deletions Failed:', e);
        stats.failed += 1;
    }

    if (stats.failed === 0) {
        await setServerConfigValue('LAST_DELETE_PULL', cycleWatermark);
    } else {
        console.warn('[Sync] LAST_DELETE_PULL not advanced because one or more deletion pulls failed.');
    }
    return stats;
}

function getConflictColumns(table, row) {
    if (CONFLICT_KEYS[table]) {
        return CONFLICT_KEYS[table].split(',').map((col) => col.trim()).filter(Boolean);
    }
    if (row && row.sync_id) return ['sync_id'];
    return ['id'];
}

function parseDeletionRecordPk(table, recordPk) {
    const columns = getConflictColumns(table);
    if (columns.length === 1) {
        return { [columns[0]]: recordPk };
    }

    if (typeof recordPk === 'string') {
        try {
            const parsed = JSON.parse(recordPk);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) {
            console.warn(`[Sync] Invalid deletion key for ${table}:`, recordPk);
        }
    }

    return null;
}

async function tryResolveLegacyNotificationConflict(client, row, keys, vals) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'created_at')) return false;

    const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
    const matchOffset = vals.length;
    const result = await client.query(
        `
            UPDATE notifications
               SET ${setClause}
             WHERE target_user IS NOT DISTINCT FROM $${matchOffset + 1}
               AND type IS NOT DISTINCT FROM $${matchOffset + 2}
               AND title IS NOT DISTINCT FROM $${matchOffset + 3}
               AND created_at IS NOT DISTINCT FROM $${matchOffset + 4}::timestamptz
         RETURNING 1
        `,
        [
            ...vals,
            row.target_user ?? null,
            row.type ?? null,
            row.title ?? null,
            row.created_at ?? null
        ]
    );

    return result.rowCount > 0;
}

async function upsertData(table, data) {
    if (!data.length) return { created: 0, updated: 0, failed: 0 };

    const MAX_RETRIES = 3;
    let attempt = 0;
    const stats = { created: 0, updated: 0, failed: 0 };

    while (attempt < MAX_RETRIES) {
        const client = await pool.connect();
        try {
            console.log(`[Sync] DEBUG: Starting upsert for table=${table} rows=${data.length} (Attempt ${attempt + 1})`);
            await client.query('BEGIN');

            for (let row of data) {
                if (table === 'plan_board' && (row.plan_id == null || String(row.plan_id).trim() === '')) {
                    console.warn('[Sync] Skipping plan_board row with empty plan_id to avoid unstable conflict identity');
                    stats.failed += 1;
                    continue;
                }

                if (table === 'plan_board' && Object.prototype.hasOwnProperty.call(row, 'id')) {
                    delete row.id;
                }

                if (TRANSFORMERS[table]) {
                    row = TRANSFORMERS[table](row);
                }

                const conflictColumns = getConflictColumns(table, row);
                if (row && row.sync_id && Object.prototype.hasOwnProperty.call(row, 'id') && !conflictColumns.includes('id')) {
                    delete row.id;
                }

                const keys = Object.keys(row);
                const vals = Object.values(row);
                const idx = keys.map((_, i) => `$${i + 1}`);
                const setClause = keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ');
                const conflictKey = conflictColumns.join(', ');

                let whereClause = `WHERE (EXCLUDED.updated_at > ${table}.updated_at OR ${table}.updated_at IS NULL)`;

                if (table === 'plan_board') {
                    whereClause += ` AND NOT (${table}.status = 'Running' AND EXCLUDED.status IN ('Planned', 'Stopped', 'Pending'))`;
                    whereClause += ` AND (${table}.updated_at < NOW() - INTERVAL '60 seconds' OR ${table}.updated_at IS NULL)`;
                }

                const sql = `
                    INSERT INTO ${table} (${keys.join(',')})
                    VALUES (${idx.join(',')})
                    ON CONFLICT (${conflictKey})
                    DO UPDATE SET ${setClause}
                    ${whereClause}
                    RETURNING (xmax = 0) AS inserted
                `;

                try {
                    await client.query('SAVEPOINT sync_row_upsert');
                    const result = await client.query(sql, vals);
                    await client.query('RELEASE SAVEPOINT sync_row_upsert');
                    if (result.rows.length && result.rows[0].inserted === true) {
                        stats.created += 1;
                    } else if (result.rows.length) {
                        stats.updated += 1;
                    }
                    } catch (innerErr) {
                        try {
                            await client.query('ROLLBACK TO SAVEPOINT sync_row_upsert');
                            await client.query('RELEASE SAVEPOINT sync_row_upsert');
                        } catch (savepointErr) {
                        console.error(`[Sync] Savepoint rollback failed for ${table}:`, savepointErr.message);
                        throw savepointErr;
                        }
                        if (innerErr.code === '40P01') {
                            throw innerErr;
                        }

                        if (table === 'notifications' && innerErr.constraint === 'uq_sync_conflict_notifications') {
                            try {
                                const resolved = await tryResolveLegacyNotificationConflict(client, row, keys, vals);
                                if (resolved) {
                                    stats.updated += 1;
                                    continue;
                                }
                            } catch (legacyErr) {
                                console.error('[Sync] Legacy notification conflict fallback failed:', legacyErr.message);
                            }
                        }

                        console.error(`[Sync] Row Error in ${table}:`, innerErr.message);
                        console.error('Failed Row:', JSON.stringify(row));
                        stats.failed += 1;
                    }
            }

            await client.query('COMMIT');
            return stats;
        } catch (e) {
            await client.query('ROLLBACK');

            if (e.code === '40P01') {
                attempt += 1;
                console.warn(`[Sync] Deadlock detected in ${table}. Retrying in ${attempt}s...`);
                await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                if (attempt >= MAX_RETRIES) {
                    console.error(`[Sync] Max retries reached for ${table}.`);
                    throw e;
                }
            } else {
                console.error(`[Sync] Upsert Batch Error ${table}:`, e);
                throw e;
            }
        } finally {
            client.release();
        }
    }
}

async function getChanges(table, since, targetFactoryId) {
    let sql = `SELECT * FROM ${table}`;
    const params = [];
    const where = [];
    const normalizedSince = normalizeSyncTimestampInput(since);

    if (normalizedSince) {
        params.push(normalizedSince);
        where.push(`updated_at > $${params.length}`);
    }

    if (targetFactoryId) {
        params.push(targetFactoryId);
        where.push(`(factory_id = $${params.length} OR factory_id IS NULL)`);
    }

    if (where.length) {
        sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' LIMIT 1000';

    try {
        const rows = await pool.query(sql, params);
        return rows.rows;
    } catch (e) {
        if (e.code === '42703') {
            if (targetFactoryId) params.pop();

            let fallbackSql = `SELECT * FROM ${table}`;
            if (normalizedSince) fallbackSql += ' WHERE updated_at > $1';
            fallbackSql += ' LIMIT 1000';
            const fallback = await pool.query(fallbackSql, normalizedSince ? [normalizedSince] : []);
            return fallback.rows;
        }
        throw e;
    }
}

async function getDeletionChanges(since, targetFactoryId) {
    const params = [];
    const where = [];
    const normalizedSince = normalizeSyncTimestampInput(since);

    if (normalizedSince) {
        params.push(normalizedSince);
        where.push(`deleted_at > $${params.length}`);
    }

    if (targetFactoryId) {
        params.push(targetFactoryId);
        where.push(`(factory_id = $${params.length} OR factory_id IS NULL)`);
    }

    let sql = `
        SELECT table_name AS table, record_pk, factory_id, deleted_at
        FROM sync_deletions
    `;

    if (where.length) {
        sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ` ORDER BY deleted_at ASC LIMIT ${DELETE_BATCH_LIMIT}`;
    const result = await pool.query(sql, params);
    return result.rows;
}

async function applyRemoteDeletions(deletions) {
    if (!Array.isArray(deletions) || deletions.length === 0) return { deleted: 0, failed: 0 };

    const client = await pool.connect();
    const stats = { deleted: 0, failed: 0 };
    try {
        await client.query('BEGIN');

        for (const deletion of deletions) {
            const table = deletion.table;
            if (!TABLES_TO_PUSH.includes(table)) continue;

            const keyValues = parseDeletionRecordPk(table, deletion.record_pk);
            if (!keyValues) {
                stats.failed += 1;
                continue;
            }

            const factoryScope = deletion.factory_id == null ? '__global__' : String(deletion.factory_id);
            await client.query(`
                INSERT INTO sync_deletions (table_name, record_pk, factory_id, factory_scope, deleted_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (table_name, record_pk, factory_scope) DO NOTHING
            `, [table, deletion.record_pk, deletion.factory_id ?? null, factoryScope, deletion.deleted_at || new Date().toISOString()]);

            const entries = Object.entries(keyValues);
            if (!entries.length) continue;

            const params = entries.map(([, value]) => value);
            const where = entries.map(([column], index) => `${column} = $${index + 1}`).join(' AND ');

            let existingRow = null;
            try {
                const result = await client.query(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`, params);
                existingRow = result.rows[0] || null;
            } catch (e) {
                console.warn(`[Sync] Existing row check skipped for ${table}:`, e.message);
            }

            if (existingRow && existingRow.updated_at && deletion.deleted_at) {
                const rowUpdatedAt = new Date(existingRow.updated_at).getTime();
                const deletedAt = new Date(deletion.deleted_at).getTime();
                if (Number.isFinite(rowUpdatedAt) && Number.isFinite(deletedAt) && rowUpdatedAt > deletedAt) {
                    continue;
                }
            }

            const deleteResult = await client.query(`DELETE FROM ${table} WHERE ${where}`, params);
            stats.deleted += deleteResult.rowCount || 0;
        }

        await client.query('COMMIT');
        return stats;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function ensureDeleteTrackingSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sync_deletions (
            id BIGSERIAL PRIMARY KEY,
            table_name TEXT NOT NULL,
            record_pk TEXT NOT NULL,
            factory_id INTEGER,
            factory_scope TEXT NOT NULL,
            deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (table_name, record_pk, factory_scope)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sync_deletions_deleted_at
        ON sync_deletions (deleted_at)
    `);

    await pool.query(`
        CREATE OR REPLACE FUNCTION record_sync_deletion() RETURNS trigger AS $$
        DECLARE
            key_columns TEXT[] := string_to_array(TG_ARGV[0], ',');
            key_col TEXT;
            key_payload JSONB := '{}'::jsonb;
            key_count INTEGER := 0;
            record_key TEXT;
            factory_value INTEGER := NULL;
            factory_scope_value TEXT := '__global__';
        BEGIN
            FOREACH key_col IN ARRAY key_columns LOOP
                key_col := btrim(key_col);
                IF key_col <> '' THEN
                    key_payload := key_payload || jsonb_build_object(key_col, to_jsonb(OLD)->>key_col);
                    key_count := key_count + 1;
                END IF;
            END LOOP;

            IF key_count = 0 THEN
                key_payload := jsonb_build_object('id', to_jsonb(OLD)->>'id');
                key_count := 1;
            END IF;

            IF key_count = 1 THEN
                record_key := COALESCE(to_jsonb(OLD)->>btrim(COALESCE(key_columns[1], 'id')), key_payload->>'id');
            ELSE
                record_key := key_payload::TEXT;
            END IF;

            IF TG_ARGV[1] = '1' THEN
                BEGIN
                    factory_value := NULLIF(to_jsonb(OLD)->>'factory_id', '')::INTEGER;
                EXCEPTION WHEN invalid_text_representation THEN
                    factory_value := NULL;
                END;
                factory_scope_value := COALESCE(factory_value::TEXT, '__global__');
            END IF;

            INSERT INTO sync_deletions (table_name, record_pk, factory_id, factory_scope, deleted_at)
            VALUES (TG_TABLE_NAME, record_key, factory_value, factory_scope_value, NOW())
            ON CONFLICT (table_name, record_pk, factory_scope) DO NOTHING;

            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql
    `);

    for (const table of SYNC_ALL) {
        const conflictColumns = getConflictColumns(table).join(', ');
        try {
            const hasFactoryId = await tableHasColumn(table, 'factory_id');
            await pool.query(`DROP TRIGGER IF EXISTS trg_record_sync_deletion_${table} ON ${table}`);
            await pool.query(`
                CREATE TRIGGER trg_record_sync_deletion_${table}
                AFTER DELETE ON ${table}
                FOR EACH ROW
                EXECUTE FUNCTION record_sync_deletion('${conflictColumns}', '${hasFactoryId ? '1' : '0'}')
            `);
        } catch (e) {
            console.warn(`[Sync] Delete trigger skipped for ${table}:`, e.message);
        }
    }

    console.log('[Sync] Delete tracking ready');
}

async function ensureSyncUpdatedAtSchema() {
    await pool.query(`
        CREATE OR REPLACE FUNCTION touch_sync_updated_at_column() RETURNS trigger AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);

    for (const table of SYNC_ALL) {
        try {
            const sourceColumn = SYNC_UPDATED_AT_SOURCE_COLUMNS[table];
            const hasUpdatedAt = await tableHasColumn(table, 'updated_at');
            const hasSourceColumn = sourceColumn ? await tableHasColumn(table, sourceColumn) : false;

            if (!hasUpdatedAt && !sourceColumn) {
                continue;
            }

            if (!hasUpdatedAt) {
                await pool.query(`ALTER TABLE ${table} ADD COLUMN updated_at TIMESTAMPTZ`);
            }

            if (hasSourceColumn) {
                await pool.query(`
                    UPDATE ${table}
                       SET updated_at = COALESCE(updated_at, ${sourceColumn}::timestamptz, NOW())
                     WHERE updated_at IS NULL
                `);
            } else {
                await pool.query(`
                    UPDATE ${table}
                       SET updated_at = COALESCE(updated_at, NOW())
                     WHERE updated_at IS NULL
                `);
            }

            await pool.query(`ALTER TABLE ${table} ALTER COLUMN updated_at SET DEFAULT NOW()`);
            await pool.query(`ALTER TABLE ${table} ALTER COLUMN updated_at SET NOT NULL`);
            await pool.query(`DROP TRIGGER IF EXISTS trg_touch_sync_updated_at_${table} ON ${table}`);
            await pool.query(`
                CREATE TRIGGER trg_touch_sync_updated_at_${table}
                BEFORE UPDATE ON ${table}
                FOR EACH ROW
                EXECUTE FUNCTION touch_sync_updated_at_column()
            `);
        } catch (e) {
            console.warn(`[Sync] updated_at tracking skipped for ${table}:`, e.message);
        }
    }

    console.log('[Sync] updated_at tracking ready');
}

async function ensureSyncIdSchema() {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    for (const table of SYNC_ID_REQUIRED_TABLES) {
        try {
            const hasSyncId = await tableHasColumn(table, 'sync_id');
            if (!hasSyncId) {
                await pool.query(`ALTER TABLE ${table} ADD COLUMN sync_id UUID`);
            }

            if (table === 'notifications') {
                await pool.query(`
                    UPDATE ${table}
                       SET sync_id = ${getDeterministicNotificationSyncIdSql()}
                `);
            } else {
                await pool.query(`UPDATE ${table} SET sync_id = gen_random_uuid() WHERE sync_id IS NULL`);
            }
            await pool.query(`ALTER TABLE ${table} ALTER COLUMN sync_id SET DEFAULT gen_random_uuid()`);
            await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_${table} ON ${table} (sync_id)`);
        } catch (e) {
            console.warn(`[Sync] sync_id schema skipped for ${table}:`, e.message);
        }
    }

    console.log('[Sync] sync_id schema ready');
}

async function ensureSyncConflictIndexes() {
    for (const [table, columns] of Object.entries(SYNC_CONFLICT_INDEXES)) {
        const indexName = `uq_sync_conflict_${table}`;
        try {
            await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table} (${columns})`);
        } catch (e) {
            console.warn(`[Sync] conflict index skipped for ${table}:`, e.message);
        }
    }

    console.log('[Sync] conflict indexes ready');
}

async function tableHasColumn(table, column) {
    const result = await pool.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        LIMIT 1
    `, [table, column]);

    return result.rows.length > 0;
}

async function countPendingChanges() {
    let pending = 0;
    const lastPushRes = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PUSH'`);
    const lastDeletePushRes = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PUSH'`);
    const lastPush = lastPushRes.rows.length ? lastPushRes.rows[0].value : '1970-01-01';
    const lastDeletePush = lastDeletePushRes.rows.length ? lastDeletePushRes.rows[0].value : '1970-01-01';

    for (const table of TABLES_TO_PUSH) {
        try {
            const hasFactoryId = await tableHasColumn(table, 'factory_id');
            const query = hasFactoryId
                ? `SELECT COUNT(*)::int AS count FROM ${table} WHERE updated_at > $1 AND factory_id = $2`
                : `SELECT COUNT(*)::int AS count FROM ${table} WHERE updated_at > $1`;
            const params = hasFactoryId ? [lastPush, LOCAL_FACTORY_ID] : [lastPush];
            const result = await pool.query(query, params);
            pending += result.rows[0]?.count || 0;
        } catch (error) {
            console.warn(`[Sync] Pending count skipped for ${table}:`, error.message);
        }
    }

    try {
        const deleteResult = await pool.query(
            `SELECT COUNT(*)::int AS count
               FROM sync_deletions
              WHERE deleted_at > $1
                AND (factory_id = $2 OR factory_id IS NULL)`,
            [lastDeletePush, LOCAL_FACTORY_ID]
        );
        pending += deleteResult.rows[0]?.count || 0;
    } catch (error) {
        console.warn('[Sync] Pending delete count skipped:', error.message);
    }

    return pending;
}

module.exports = { init, router, triggerSync };
