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

const CONFLICT_KEYS = {
    users: 'id',
    roles: 'code',
    orders: 'id',
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
    shift_teams: 'line, shift_date, shift'
};

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
        normalized.forEach((row) => {
            row.factory_id = factoryId;
            if (!row.sync_id) row.sync_id = row.global_id;
        });

        await upsertData(table, normalized);
        res.json({ ok: true, rows: normalized.length });
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
        await applyRemoteDeletions(normalized);
        res.json({ ok: true, rows: normalized.length });
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

    try {
        if (TABLES_TO_PUSH.length > 0) {
            await pushChanges();
            await pushDeletionChanges();
            lastPushTime = new Date();
        }
        if (TABLES_TO_PULL.length > 0) {
            await pullChanges();
            await pullDeletionChanges();
            lastPullTime = new Date();
        }
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

async function pushDeletionChanges() {
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PUSH'`);
    const lastPush = res.rows.length ? res.rows[0].value : '1970-01-01';
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
            throw new Error(`Push deletions failed: ${response.status} ${response.statusText} - ${text}`);
        }
    }

    await pool.query(`INSERT INTO server_config (key, value) VALUES ('LAST_DELETE_PUSH', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

async function pullChanges() {
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';

    for (const table of TABLES_TO_PULL) {
        try {
            const response = await fetch(`${MAIN_SERVER_URL}/api/sync/pull?table=${encodeURIComponent(table)}&since=${encodeURIComponent(lastPull)}&apiKey=${encodeURIComponent(API_KEY)}&factoryId=${encodeURIComponent(LOCAL_FACTORY_ID)}`);
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

async function pullDeletionChanges() {
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';

    try {
        const response = await fetch(`${MAIN_SERVER_URL}/api/sync/pull-deletions?since=${encodeURIComponent(lastPull)}&apiKey=${encodeURIComponent(API_KEY)}&factoryId=${encodeURIComponent(LOCAL_FACTORY_ID)}`);
        if (response.ok) {
            const json = await response.json();
            const deletions = json.data || [];
            if (deletions.length > 0) {
                console.log(`[Sync] Pulled ${deletions.length} deletions...`);
                await applyRemoteDeletions(deletions);
            }
        }
    } catch (e) {
        console.error('[Sync] Pull Deletions Failed:', e);
    }

    await pool.query(`INSERT INTO server_config (key, value) VALUES ('LAST_DELETE_PULL', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
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
                if (TRANSFORMERS[table]) {
                    row = TRANSFORMERS[table](row);
                }

                const keys = Object.keys(row);
                const vals = Object.values(row);
                const idx = keys.map((_, i) => `$${i + 1}`);
                const setClause = keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ');
                const conflictColumns = getConflictColumns(table, row);
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
                `;

                try {
                    await client.query(sql, vals);
                } catch (innerErr) {
                    if (innerErr.code === '40P01') {
                        throw innerErr;
                    }
                    console.error(`[Sync] Row Error in ${table}:`, innerErr.message);
                    console.error('Failed Row:', JSON.stringify(row));
                }
            }

            await client.query('COMMIT');
            return;
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

    if (since) {
        params.push(since);
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
            if (since) fallbackSql += ' WHERE updated_at > $1';
            fallbackSql += ' LIMIT 1000';
            const fallback = await pool.query(fallbackSql, since ? [since] : []);
            return fallback.rows;
        }
        throw e;
    }
}

async function getDeletionChanges(since, targetFactoryId) {
    const params = [];
    const where = [];

    if (since) {
        params.push(since);
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
    if (!Array.isArray(deletions) || deletions.length === 0) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const deletion of deletions) {
            const table = deletion.table;
            if (!TABLES_TO_PUSH.includes(table)) continue;

            const keyValues = parseDeletionRecordPk(table, deletion.record_pk);
            if (!keyValues) continue;

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

            await client.query(`DELETE FROM ${table} WHERE ${where}`, params);
        }

        await client.query('COMMIT');
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

async function tableHasColumn(table, column) {
    const result = await pool.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        LIMIT 1
    `, [table, column]);

    return result.rows.length > 0;
}

module.exports = { init, router, triggerSync };
