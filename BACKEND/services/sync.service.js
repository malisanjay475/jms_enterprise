const fetch = require('node-fetch');
const { Pool } = require('pg');
const express = require('express');
const router = express.Router();

let pool;
let SERVER_TYPE = 'STANDALONE'; // Default to isolated
let MAIN_SERVER_URL = ''; // No remote connection by default
let LOCAL_FACTORY_ID = 1; // Default to 1 if not set
let API_KEY = 'jpsms-sync-key'; // Simple shared secret

const SYNC_INTERVAL_MS = 60 * 1000; // 1 Minute (Real-Time)

const SYNC_ALL = [
    'app_settings',
    'assembly_lines',
    'assembly_plans',
    'assembly_scans',
    'bom_components',
    'bom_master',
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
    'machine_operators',
    'machine_status_logs',
    'machines',
    'mould_audit_logs',
    'mould_planning_report',
    'mould_planning_summary',
    'moulds',
    'operator_history',
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
    'wip_outward_logs'
];

const TABLES_TO_PUSH = [...SYNC_ALL];
const TABLES_TO_PULL = [...SYNC_ALL];

/* ============================================================
   ROUTER DEFINITIONS (Mounted at /api/sync)
   ============================================================ */

// Receive Push Data (from Local)
router.post('/push', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { factoryId, table, data, apiKey } = req.body;
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });
        if (!TABLES_TO_PUSH.includes(table)) return res.status(400).json({ error: 'Invalid Table' });

        console.log(`[Sync] Received ${data.length} rows for ${table} from Factory ${factoryId}`);

        // Inject Source Factory ID and ensure Sync ID
        data.forEach(row => {
            row.factory_id = factoryId;
            if (!row.sync_id) row.sync_id = row.global_id; // Fallback if needed
        });

        await upsertData(table, data);
        res.json({ ok: true, rows: data.length });
    } catch (e) {
        console.error('[Sync] Push Receive Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Serve Pull Data (to Local)
router.get('/pull', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { table, lastSync, apiKey, factoryId } = req.query; // Added factoryId
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });
        if (!TABLES_TO_PULL.includes(table)) return res.status(400).json({ error: 'Invalid Table' });

        // If factoryId is provided (Local pulling from Main), filter by it.
        // If not (Main pulling from Local?), usually Main doesn't pull via GET, it receives POST push.
        // But if bidirectional Sync uses Pull, we need to be careful.
        // For Main -> Local: Local sends ITS factoryId. Main filters data for THAT factory.

        const rows = await getChanges(table, lastSync, factoryId);
        res.json({ ok: true, data: rows });
    } catch (e) {
        console.error('[Sync] Pull Serve Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get Sync Status
router.get('/status', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        let lastSync = 'Never';
        let lastPush = 'Never';
        let lastPull = 'Never';

        const result = await pool.query("SELECT * FROM server_config WHERE key IN ('LAST_SYNC', 'LAST_PUSH', 'LAST_PULL')");
        result.rows.forEach(r => {
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
        const res = await pool.query("SELECT key, value FROM server_config");
        const config = {};
        res.rows.forEach(r => config[r.key] = r.value);

        if (config.SERVER_TYPE) SERVER_TYPE = config.SERVER_TYPE;
        if (config.MAIN_SERVER_URL) MAIN_SERVER_URL = config.MAIN_SERVER_URL;
        if (config.LOCAL_FACTORY_ID) LOCAL_FACTORY_ID = parseInt(config.LOCAL_FACTORY_ID);
        if (config.SYNC_API_KEY) API_KEY = config.SYNC_API_KEY;

        console.log(`[Sync] Init. Type: ${SERVER_TYPE}, Factory: ${LOCAL_FACTORY_ID}, Main: ${MAIN_SERVER_URL}`);
        console.log('[Sync] Service Version: v4.4 (Standalone Support)');

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
function startSchedule() {
    console.log('[Sync] Starting Schedule...');
    setTimeout(runSyncCycle, 10000);
}

// Trigger Sync immediately (Debounced)
let triggerTimeout = null;
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
    }, 2000); // 2s debounce
}

let lastSyncTime = null;
let lastPushTime = null;
let lastPullTime = null;

async function runSyncCycle() {
    if (!pool || !LOCAL_FACTORY_ID) return;
    console.log('[Sync] Running Cycle...');
    lastSyncTime = new Date();

    try {
        if (TABLES_TO_PUSH.length > 0) {
            await pushChanges();
            lastPushTime = new Date();
        }
        if (TABLES_TO_PULL.length > 0) {
            await pullChanges();
            lastPullTime = new Date();
        }
        // Persist Last Sync
        await pool.query(`INSERT INTO server_config (key, value) VALUES ('LAST_SYNC', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    } catch (e) {
        console.error('[Sync] Cycle Failed:', e);
    }

    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(runSyncCycle, SYNC_INTERVAL_MS);
}

async function pushChanges() {
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PUSH'`);
    const lastPush = res.rows.length ? res.rows[0].value : '1970-01-01';

    for (const table of TABLES_TO_PUSH) {
        const rows = await pool.query(`
            SELECT * FROM ${table} 
            WHERE updated_at > $1 
            AND factory_id = $2
            LIMIT 100
        `, [lastPush, LOCAL_FACTORY_ID]);

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
                throw new Error(`Push failed: ${response.status} ${response.statusText} - ${text}`);
            }
        }
    }
    await pool.query(`INSERT INTO server_config (key, value) VALUES ('LAST_PUSH', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

async function pullChanges() {
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';

    for (const table of TABLES_TO_PULL) {
        try {
            // Send OUR factory ID so Main knows what to send us
            const response = await fetch(`${MAIN_SERVER_URL}/api/sync/pull?table=${table}&since=${lastPull}&apiKey=${API_KEY}&factoryId=${LOCAL_FACTORY_ID}`);
            if (!response.ok) continue;

            const json = await response.json();
            const data = json.data || [];

            if (data.length > 0) {
                console.log(`[Sync] Pulled ${data.length} rows for ${table}...`);
                await upsertData(table, data);
            }
        } catch (e) {
            console.error(`[Sync] Pull Failed ${table}:`, e);
        }
    }
    await pool.query(`INSERT INTO server_config (key, value) VALUES ('LAST_PULL', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

const CONFLICT_KEYS = {
    'users': 'id',
    'roles': 'code',
    'orders': 'id',
    'plan_audit_logs': 'id',
    'plan_history': 'id',
    'purchase_order_items': 'id',
    'purchase_orders': 'id',
    'user_factories': 'id',
    'dpr_reasons': 'id',
    'mould_planning_report': 'id',
    'mould_planning_summary': 'id',
    'jc_details': 'id',
    'jc_summaries': 'id',
    'job_cards': 'id',
    'machine_operators': 'id',
    'machine_status_logs': 'id',
    'mould_audit_logs': 'id',
    'qc_deviations': 'id',
    'qc_issue_memos': 'id',
    'qc_online_reports': 'id',
    'qc_training_sheets': 'id',
    'shifting_records': 'id',
    'std_actual': 'id',
    'vendor_dispatch': 'id',
    'vendor_payments': 'id',
    'vendor_users': 'id',
    'wip_inventory': 'id',
    'wip_outward_logs': 'id',
    'assembly_lines': 'line_id',
    'assembly_plans': 'id',
    'assembly_scans': 'id',
    'vendors': 'id',
    'app_settings': 'key',
    'factories': 'id',
    'grinding_logs': 'id',
    'shift_teams': 'line, shift_date, shift'
    // Add others as needed. Default is 'sync_id' if present, else 'id'
};

const TRANSFORMERS = {
    'vendors': (row) => {
        if (row.factory_access) {
            console.log(`[Sync] Vendors Debug: type=${typeof row.factory_access}, value=${JSON.stringify(row.factory_access)}`);
            // Fix malformed JSON like {"1"} which some legacy data might have as string
            if (typeof row.factory_access === 'string') {
                if (row.factory_access.includes('{') && !row.factory_access.includes(':')) {
                    // It's likely a malformed set-like string e.g. {"1"} -> convert to array [1]
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
                // Check if it's already an object but maybe invalid structure?
                console.log('[Sync] Vendor access is object:', JSON.stringify(row.factory_access));
                row.factory_access = JSON.stringify(row.factory_access); // Explicitly stringify for PG
            }
        }
        return row;
    }
};

async function upsertData(table, data) {
    if (!data.length) return;

    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        const client = await pool.connect();
        try {
            console.log(`[Sync] DEBUG: Starting upsert for table=${table} rows=${data.length} (Attempt ${attempt + 1})`);
            await client.query('BEGIN');
            for (let row of data) {

                // Apply Transformers
                if (TRANSFORMERS[table]) {
                    row = TRANSFORMERS[table](row);
                }

                const keys = Object.keys(row);
                const vals = Object.values(row);
                const idx = keys.map((_, i) => `$${i + 1}`);
                const setClause = keys.map((k, i) => `${k} = EXCLUDED.${k}`).join(', ');

                // Determine Conflict Key
                let conflictKey = 'id'; // Default default
                if (CONFLICT_KEYS[table]) {
                    conflictKey = CONFLICT_KEYS[table];
                } else if (row.sync_id) {
                    conflictKey = 'sync_id';
                }

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
                `;

                try {
                    await client.query(sql, vals);
                } catch (innerErr) {
                    // Check for Deadlock (40P01)
                    if (innerErr.code === '40P01') {
                        throw innerErr; // Throw to trigger outer catch and retry
                    }
                    console.error(`[Sync] Row Error in ${table}:`, innerErr.message);
                    console.error('Failed Row:', JSON.stringify(row));
                }
            }
            await client.query('COMMIT');
            return; // Success!

        } catch (e) {
            await client.query('ROLLBACK');

            if (e.code === '40P01') {
                attempt++;
                console.warn(`[Sync] Deadlock detected in ${table}. Retrying in ${attempt}s...`);
                await new Promise(r => setTimeout(r, 1000 * attempt));
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

    if (since) {
        params.push(since);
        where.push(`updated_at > $${params.length}`);
    }

    // [FIX] Factory Isolation for Sync
    if (targetFactoryId) {
        params.push(targetFactoryId);
        // Return rows matching factory OR rows with NULL factory (Global)
        where.push(`(factory_id = $${params.length} OR factory_id IS NULL)`);
    }

    if (where.length) {
        sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ` LIMIT 1000`;

    try {
        const rows = await pool.query(sql, params);
        return rows.rows;
    } catch (e) {
        // Fallback: If column doesn't exist (undefined column factory_id), return all data without filtering
        if (e.code === '42703') { // Undefined column code in Postgres
            // Remove the factory param if it was added last
            if (targetFactoryId) params.pop();

            // Rebuild SQL without filter
            let fallbackSql = `SELECT * FROM ${table}`;
            if (since) fallbackSql += ` WHERE updated_at > $1`;
            fallbackSql += ` LIMIT 1000`;
            const r = await pool.query(fallbackSql, since ? [since] : []);
            return r.rows;
        }
        throw e;
    }
}

module.exports = { init, router, triggerSync };
