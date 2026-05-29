// fetch is available globally in Node.js 18+ — no require needed
const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();

let pool;
let SERVER_TYPE = 'STANDALONE';
let MAIN_SERVER_URL = '';
let LOCAL_FACTORY_ID = 1;
let API_KEY = process.env.SYNC_API_KEY || 'jpsms-sync-key';

function readPositiveIntegerEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeIntegerEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const DEFAULT_SYNC_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 100 : 5 * 60 * 1000;
const SYNC_INTERVAL_MS = readPositiveIntegerEnv(
    'SYNC_INTERVAL_MS',
    readPositiveIntegerEnv('LOCAL_SYNC_INTERVAL_MS', DEFAULT_SYNC_INTERVAL_MS)
);
const SYNC_INITIAL_DELAY_MS = readNonNegativeIntegerEnv(
    'SYNC_INITIAL_DELAY_MS',
    process.env.NODE_ENV === 'test' ? 0 : 30 * 1000
);
const SYNC_TRIGGER_DEBOUNCE_MS = readNonNegativeIntegerEnv(
    'SYNC_TRIGGER_DEBOUNCE_MS',
    process.env.NODE_ENV === 'test' ? 0 : 5000
);
const PENDING_COUNT_INTERVAL_MS = readNonNegativeIntegerEnv(
    'SYNC_PENDING_COUNT_INTERVAL_MS',
    process.env.NODE_ENV === 'test' ? 0 : 5 * 60 * 1000
);
const DELETE_BATCH_LIMIT = 1000;
const PULL_REQUEST_DELAY_MS = readNonNegativeIntegerEnv(
    'SYNC_PULL_REQUEST_DELAY_MS',
    process.env.NODE_ENV === 'test' ? 0 : 250
);
const PULL_RETRY_BASE_DELAY_MS = readNonNegativeIntegerEnv(
    'SYNC_PULL_RETRY_BASE_DELAY_MS',
    process.env.NODE_ENV === 'test' ? 0 : 1000
);
const PULL_MAX_RETRIES = readNonNegativeIntegerEnv('SYNC_PULL_MAX_RETRIES', 4);

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
    'hr_employee_profiles',
    'hr_interviews',
    'hr_interview_scores',
    'hr_kra_assignment_items',
    'hr_kra_assignments',
    'hr_kra_daily_entries',
    'hr_kra_template_items',
    'hr_kra_templates',
    'jc_details',
    'jc_summaries',
    'job_card_label_print_log',
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
    'plan_job_card_approval_history',
    'planning_drops',
    'purchase_order_items',
    'purchase_orders',
    'qc_deviations',
    'qc_issue_memos',
    'qc_job_checks',
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

// Tables that LOCAL servers must NEVER push to MAIN.
// These are auth/identity tables where the VPS (MAIN) is the authoritative source.
// Pushing them from LOCAL would overwrite VPS user credentials with local seed data.
const LOCAL_NO_PUSH_TABLES = ['users', 'roles'];

const CONFLICT_KEYS = {
    users: 'id',
    roles: 'code',
    orders: 'id',
    plan_board: 'plan_id',
    plan_audit_logs: 'id',
    plan_history: 'id',
    purchase_order_items: 'id',
    purchase_orders: 'id',
    user_factories: 'user_id, factory_id',
    or_jr_report: 'or_jr_no',
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
    qc_job_checks: 'id',
    qc_online_reports: 'id',
    qc_training_sheets: 'id',
    shifting_records: 'id',
    std_actual: 'plan_id, shift, dpr_date, machine',
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
    wip_stock_snapshot_lines: 'factory_id, stock_date, comparison_key',
    // Master tables — explicit id conflict (previously relied on fallback)
    moulds: 'id',
    machines: 'id',
    bom_master: 'id',
    bom_components: 'id',
    dpr_hourly: 'id',
    grn_entries: 'id',
    dispatch_items: 'id',
    jobs_queue: 'id',
    planning_drops: 'id',
    operator_history: 'id',
    // HR Performance tables
    hr_employee_profiles: 'id',
    hr_kra_templates: 'id',
    hr_kra_template_items: 'id',
    hr_kra_assignments: 'id',
    hr_kra_assignment_items: 'id',
    hr_kra_daily_entries: 'employee_user_id, assignment_item_id, entry_date',
    // Interview Panel tables
    hr_interviews: 'id',
    hr_interview_scores: 'id',
    // Job card / planning tables
    job_card_label_print_log: 'label_uid',
    plan_job_card_approval_history: 'id'
};

const SYNC_UPDATED_AT_SOURCE_COLUMNS = {
    closed_plants: 'created_at',
    machine_audit_logs: 'changed_at',
    notifications: 'created_at',
    order_completion_history: 'changed_at',
    raw_material_issues: 'created_at',
    wip_stock_movements: 'created_at',
    // job_card_label_print_log has no updated_at — use printed_at as the source column
    // so existing rows get updated_at = printed_at (not just NOW())
    job_card_label_print_log: 'printed_at'
};

const SYNC_CONFLICT_INDEXES = {
    closed_plants: 'factory_id, dpr_date, plant, shift',
    order_completion_history: 'factory_id, order_no, action_type, changed_at',
    raw_material_issues: 'factory_id, plan_id, created_at',
    shift_teams: 'line, shift_date, shift',
    wip_stock_movements: 'factory_id, source_type, source_ref, movement_type, created_at',
    wip_stock_snapshots: 'factory_id, stock_date, source_file_name',
    wip_stock_snapshot_lines: 'factory_id, stock_date, comparison_key',
    // HR daily entries have a natural unique constraint used as conflict identity
    hr_kra_daily_entries: 'employee_user_id, assignment_item_id, entry_date',
    // std_actual uses the natural unique constraint — LOCAL serial IDs diverge from MAIN
    std_actual: 'plan_id, shift, dpr_date, machine'
};

// Tables that represent global master/reference data shared across ALL factories.
// These are pulled from MAIN in full — no factory_id filter is applied.
// Without this, LOCAL servers only receive rows where factory_id = LOCAL_FACTORY_ID
// (or factory_id IS NULL), permanently missing master records that belong to other
// factories on MAIN (e.g. moulds imported under factory_id = 2 when LOCAL is factory 1).
const GLOBAL_MASTER_TABLES = new Set([
    'moulds'        // Mould master — company-wide reference, not factory-scoped
]);

const SYNC_ID_REQUIRED_TABLES = ['notifications'];
const SYNC_SCHEMA_READY_KEY = 'SYNC_SCHEMA_READY_VERSION';
const SYNC_SCHEMA_READY_VERSION = '2026-05-27-pull-constraint-fixes-v1';

// Tables that carry a UNIQUE constraint on sync_id created by the app schema (outside
// the sync service).  When a pull-upsert fails because another LOCAL row already owns
// the same sync_id (assigned locally before MAIN synced), we reassign that row's
// sync_id to a fresh random UUID so the main upsert can then succeed.
const TABLES_WITH_EXTERNAL_SYNC_ID_CONSTRAINT = new Set(['shift_teams']);
const tableColumnCache = new Map();
const tableExistsCache = new Map();

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

function sleep(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableSyncStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfterMs(response, attempt) {
    const retryAfter = response.headers?.get?.('retry-after');
    if (retryAfter) {
        const seconds = Number.parseFloat(retryAfter);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

        const retryDate = new Date(retryAfter).getTime();
        if (Number.isFinite(retryDate)) return Math.max(0, retryDate - Date.now());
    }

    return PULL_RETRY_BASE_DELAY_MS * Math.max(1, attempt);
}

async function fetchWithSyncRetry(url, label, options = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= PULL_MAX_RETRIES + 1; attempt += 1) {
        if (PULL_REQUEST_DELAY_MS > 0) await sleep(PULL_REQUEST_DELAY_MS);

        try {
            const response = await fetch(url, options);
            if (response.ok || !isRetryableSyncStatus(response.status) || attempt > PULL_MAX_RETRIES) {
                return response;
            }

            const delayMs = parseRetryAfterMs(response, attempt);
            console.warn(`[Sync] ${label} HTTP ${response.status}; retrying in ${Math.ceil(delayMs / 1000)}s (${attempt}/${PULL_MAX_RETRIES})`);
            await sleep(delayMs);
        } catch (error) {
            lastError = error;
            if (attempt > PULL_MAX_RETRIES) break;

            const delayMs = PULL_RETRY_BASE_DELAY_MS * Math.max(1, attempt);
            console.warn(`[Sync] ${label} request failed: ${error.message}. Retrying in ${Math.ceil(delayMs / 1000)}s (${attempt}/${PULL_MAX_RETRIES})`);
            await sleep(delayMs);
        }
    }

    throw lastError || new Error(`${label} request failed after retries`);
}

/* ============================================================
   ROUTER DEFINITIONS (Mounted at /api/sync)
   ============================================================ */

// Rate limiter: max 300 asset uploads per IP per minute.
// A LOCAL server can have 100+ machine icons to sync in one bulk pass — the old limit of 60
// caused 429 rejections for the excess files, leaving icons missing on MAIN.
const uploadAssetLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});

// Upload an asset file (e.g. machine icon) from a LOCAL server so it exists on MAIN too.
// LOCAL calls this after saving the file locally — keeps icons in sync across servers.
router.post('/upload-asset', uploadAssetLimiter, async (req, res) => {
    try {
        const { apiKey, folder, filename, data } = req.body || {};
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });

        // Validate inputs
        const safeFolder = String(folder || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const safeFilename = String(filename || '').replace(/[^a-zA-Z0-9_.\-]/g, '');
        if (!safeFolder || !safeFilename) return res.status(400).json({ error: 'Invalid folder or filename' });
        if (!data || typeof data !== 'string') return res.status(400).json({ error: 'Missing data' });

        const fs = require('fs');
        const path = require('path');
        const uploadsDir = path.join(__dirname, '..', 'PUBLIC', 'uploads', safeFolder);
        fs.mkdirSync(uploadsDir, { recursive: true });
        const filePath = path.join(uploadsDir, safeFilename);
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

        console.log(`[Sync] Asset uploaded from LOCAL: /uploads/${safeFolder}/${safeFilename}`);
        res.json({ ok: true, path: `/uploads/${safeFolder}/${safeFilename}` });
    } catch (e) {
        console.error('[Sync] upload-asset failed:', e.message);
        res.status(500).json({ error: e.message });
    }
});

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
            // Partial row failures: log clearly but return 200 so the factory's
            // LAST_PUSH watermark still advances and new data keeps flowing.
            // A 500 here causes the factory to freeze ALL future pushes indefinitely.
            console.warn(`[Sync] Partial upsert: ${stats.failed} row(s) failed for ${table} (${stats.created} created, ${stats.updated} updated)`);
        }
        res.json({ ok: true, rows: normalized.length, stats, partialFailures: stats.failed > 0 });
    } catch (e) {
        // upsertData should not throw any more (it now returns failed stats), but
        // keep this as a last-resort safety net. Return 200 so the factory's
        // LAST_PUSH watermark can still advance — a 500 freezes ALL pushes forever.
        console.error('[Sync] Push Receive Error (safety-net catch):', e.message);
        res.json({ ok: true, rows: 0, stats: { created: 0, updated: 0, failed: 0 }, partialFailures: true });
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

        // Determine connection status for LOCAL servers.
        // A successful push or pull within the last 10 minutes means we are connected.
        const CONNECTED_WINDOW_MS = 10 * 60 * 1000;
        const now = Date.now();
        function isRecent(ts) {
            if (!ts || ts === 'Never') return false;
            const t = new Date(ts).getTime();
            return !Number.isNaN(t) && (now - t) < CONNECTED_WINDOW_MS;
        }
        const connected = SERVER_TYPE === 'LOCAL'
            ? (isRecent(lastPush) || isRecent(lastPull))
            : null; // null means "not applicable" for MAIN/STANDALONE

        // Count pending rows waiting to be pushed (LOCAL only, best-effort)
        let pendingPushCount = null;
        if (SERVER_TYPE === 'LOCAL') {
            try {
                pendingPushCount = await getCachedPendingChanges();
            } catch (_) { /* non-fatal */ }
        }

        res.json({
            ok: true,
            type: SERVER_TYPE,
            factory_id: LOCAL_FACTORY_ID,
            main_url: MAIN_SERVER_URL,
            last_sync: lastSync,
            last_push: lastPush,
            last_pull: lastPull,
            connected,
            pending_push_count: pendingPushCount
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/health', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        let lastPush = 'Never';
        let lastPull = 'Never';

        const result = await pool.query("SELECT * FROM server_config WHERE key IN ('LAST_PUSH', 'LAST_PULL')");
        result.rows.forEach((r) => {
            if (r.key === 'LAST_PUSH') lastPush = r.value;
            if (r.key === 'LAST_PULL') lastPull = r.value;
        });

        const now = Date.now();
        function getLagHours(ts) {
            if (!ts || ts === 'Never') return 999;
            const t = new Date(ts).getTime();
            if (Number.isNaN(t)) return 999;
            return (now - t) / (1000 * 60 * 60);
        }

        const pullLagHours = getLagHours(lastPull);
        const pushLagHours = getLagHours(lastPush);

        // Healthy means pull and push have succeeded within the last 2 hours.
        const isHealthy = pullLagHours <= 2 && pushLagHours <= 2;

        res.json({
            ok: isHealthy,
            last_push: lastPush,
            last_pull: lastPull,
            pull_lag_hours: pullLagHours === 999 ? 'Never' : Number(pullLagHours.toFixed(2)),
            push_lag_hours: pushLagHours === 999 ? 'Never' : Number(pushLagHours.toFixed(2)),
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// Admin: reset pull watermarks so the next sync cycle fetches ALL rows from MAIN again.
// Use this to recover missing master data (e.g. moulds that were synced before pagination
// was added, or moulds with historical updated_at values that slipped behind the watermark).
// Only available on LOCAL servers. Authenticate with SYNC_API_KEY.
router.post('/admin/full-pull-reset', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { apiKey } = req.body || {};
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });
        if (SERVER_TYPE !== 'LOCAL') return res.status(400).json({ error: 'Only available on LOCAL servers' });

        await setServerConfigValue('LAST_PULL', '1970-01-01T00:00:00.000Z');
        await setServerConfigValue('LAST_DELETE_PULL', '1970-01-01T00:00:00.000Z');

        console.log('[Sync] Admin: LAST_PULL reset to 1970-01-01. Full re-pull will start in 1s...');
        scheduleSyncCycle(1000);

        res.json({ ok: true, message: 'LAST_PULL reset. Full re-pull starting in 1 second. Check supervisor window for progress.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: reset push watermarks so the next sync cycle re-pushes ALL local rows to MAIN.
// Use this after a LOCAL server was offline for a long time and data was lost because
// the push watermark jumped past rows that were never sent (the 100-row-per-cycle gap).
// Only available on LOCAL servers. Authenticate with SYNC_API_KEY.
router.post('/admin/full-push-reset', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { apiKey } = req.body || {};
        if (apiKey !== API_KEY) return res.status(403).json({ error: 'Invalid Key' });
        if (SERVER_TYPE !== 'LOCAL') return res.status(400).json({ error: 'Only available on LOCAL servers' });

        await setServerConfigValue('LAST_PUSH', '1970-01-01T00:00:00.000Z');
        await setServerConfigValue('LAST_DELETE_PUSH', '1970-01-01T00:00:00.000Z');

        console.log('[Sync] Admin: LAST_PUSH reset to 1970-01-01. Full re-push will start in 1s...');
        setTimeout(() => runSyncCycle().catch((e) => console.error('[Sync] Admin-triggered cycle failed:', e)), 1000);

        res.json({ ok: true, message: 'LAST_PUSH reset. Full re-push starting in 1 second. All local data will be sent to MAIN.' });
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
        let config = await getServerConfigSnapshot().catch((e) => {
            console.warn('[Sync] Config read before schema check skipped:', e.message);
            return {};
        });

        await ensureSyncRuntimeSchema(config);
        if (Object.keys(config).length === 0) {
            config = await getServerConfigSnapshot().catch(() => ({}));
        }

        if (config.SERVER_TYPE) SERVER_TYPE = config.SERVER_TYPE;
        if (config.MAIN_SERVER_URL) MAIN_SERVER_URL = config.MAIN_SERVER_URL;
        if (config.LOCAL_FACTORY_ID) LOCAL_FACTORY_ID = parseInt(config.LOCAL_FACTORY_ID, 10);
        // env var wins; server_config is only a fallback for legacy LOCAL servers without .env entry
        if (!process.env.SYNC_API_KEY && config.SYNC_API_KEY) API_KEY = config.SYNC_API_KEY;

        console.log(`[Sync] Init. Type: ${SERVER_TYPE}, Factory: ${LOCAL_FACTORY_ID}, Main: ${MAIN_SERVER_URL}`);
        console.log('[Sync] Service Version: v4.7 (Global Master Tables, Paginated Pull, Moulds Full Sync)');

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
let syncInFlight = false;
let syncRerunRequested = false;
let lastPendingCountAt = 0;
let lastPendingCountValue = 0;

async function getServerConfigSnapshot() {
    const res = await pool.query('SELECT key, value FROM server_config');
    const config = {};
    res.rows.forEach((r) => {
        config[r.key] = r.value;
    });
    return config;
}

function shouldForceSyncSchemaEnsure() {
    const raw = String(process.env.SYNC_FORCE_SCHEMA_ENSURE || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

async function ensureSyncRuntimeSchema(config = {}) {
    if (!shouldForceSyncSchemaEnsure() && config[SYNC_SCHEMA_READY_KEY] === SYNC_SCHEMA_READY_VERSION) {
        console.log('[Sync] Schema already verified; skipping startup schema sweep.');
        return;
    }

    await ensureSyncUpdatedAtSchema();
    await ensureSyncIdSchema();
    await ensureSyncConflictIndexes();
    await ensureDeleteTrackingSchema();

    await setServerConfigValue(SYNC_SCHEMA_READY_KEY, SYNC_SCHEMA_READY_VERSION).catch((e) => {
        console.warn('[Sync] Could not persist schema version marker:', e.message);
    });
}

function installTimer(callback, delayMs) {
    const timer = setTimeout(callback, Math.max(0, delayMs));
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

function scheduleSyncCycle(delayMs = SYNC_INTERVAL_MS) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = installTimer(() => {
        syncTimer = null;
        runSyncCycle().catch((e) => console.error('[Sync] Scheduled cycle failed:', e));
    }, delayMs);
}

function startSchedule() {
    console.log(`[Sync] Starting Schedule. Interval: ${Math.round(SYNC_INTERVAL_MS / 1000)}s, first run: ${Math.round(SYNC_INITIAL_DELAY_MS / 1000)}s`);
    scheduleSyncCycle(SYNC_INITIAL_DELAY_MS);
}

function triggerSync() {
    if (SERVER_TYPE !== 'LOCAL') {
        console.log(`[Sync] Trigger ignored (Mode: ${SERVER_TYPE})`);
        return;
    }
    console.log('[Sync] Trigger requested...');
    if (syncInFlight) {
        syncRerunRequested = true;
        console.log('[Sync] Cycle already running; queued one follow-up cycle.');
        return;
    }
    if (triggerTimeout) clearTimeout(triggerTimeout);
    triggerTimeout = setTimeout(() => {
        triggerTimeout = null;
        console.log('[Sync] Triggering Cycle!');
        runSyncCycle().catch((e) => console.error('[Sync] Triggered cycle failed:', e));
    }, SYNC_TRIGGER_DEBOUNCE_MS);
    if (typeof triggerTimeout.unref === 'function') triggerTimeout.unref();
}

async function runSyncCycle() {
    if (!pool || !LOCAL_FACTORY_ID || !MAIN_SERVER_URL) return;
    if (syncInFlight) {
        syncRerunRequested = true;
        console.log('[Sync] Cycle already running; queued one follow-up cycle.');
        return;
    }
    if (triggerTimeout) {
        clearTimeout(triggerTimeout);
        triggerTimeout = null;
    }

    syncInFlight = true;
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
            cycleStats.pending = await getCachedPendingChanges();
            await setServerConfigValue('LAST_SYNC', await getDatabaseNowIso());
            await setSyncAuditState(cycleStats);
        } catch (e) {
            console.error('[Sync] Cycle Failed:', e);
            cycleStats.failed += 1;
            cycleStats.pending = await getCachedPendingChanges().catch(() => cycleStats.pending);
            await setSyncAuditState(cycleStats).catch((err) => {
                console.error('[Sync] Failed to persist sync audit state:', err.message);
            });
        }
    } finally {
        syncInFlight = false;
        const followUpRequested = syncRerunRequested;
        syncRerunRequested = false;
        scheduleSyncCycle(followUpRequested ? SYNC_TRIGGER_DEBOUNCE_MS : SYNC_INTERVAL_MS);
    }
}

// Push all changed rows for a table to MAIN in batches, paging through the full backlog.
//
// WHY THIS IS NEEDED:
//   The old pushChanges() grabbed only 100 rows per table per cycle and then advanced
//   LAST_PUSH to NOW(). Any rows beyond that 100 had updated_at < NOW() on the next
//   cycle and were permanently skipped. If LOCAL was offline for hours (e.g. power cut),
//   only the first 100 rows per table would ever reach MAIN — the rest were silently lost.
//
//   This function pages through ALL pending rows in batches of 100 (like pullTableAllPages
//   does for pull) so no rows are skipped before LAST_PUSH advances.
async function pushTableAllBatches(table, lastPush) {
    const PUSH_BATCH_SIZE = 100;
    const stats = { pushed: 0, failed: 0 };
    const hasFactoryId = await tableHasColumn(table, 'factory_id');
    let currentSince = lastPush;
    let batchNum = 0;

    while (true) {
        batchNum += 1;
        let rows;
        try {
            const sql = hasFactoryId
                ? `SELECT * FROM ${table} WHERE updated_at > $1 AND factory_id = $2 ORDER BY updated_at ASC LIMIT ${PUSH_BATCH_SIZE}`
                : `SELECT * FROM ${table} WHERE updated_at > $1 ORDER BY updated_at ASC LIMIT ${PUSH_BATCH_SIZE}`;
            const params = hasFactoryId ? [currentSince, LOCAL_FACTORY_ID] : [currentSince];
            const result = await pool.query(sql, params);
            rows = result.rows;
        } catch (err) {
            console.error(`[Sync] Push query failed ${table} batch ${batchNum}:`, err.message);
            stats.failed += 1;
            break;
        }

        if (rows.length === 0) break;

        if (batchNum > 1) {
            console.log(`[Sync] Pushing ${rows.length} rows for ${table} (batch ${batchNum}, since=${currentSince})...`);
        } else {
            console.log(`[Sync] Pushing ${rows.length} rows for ${table}...`);
        }

        const payload = { factoryId: LOCAL_FACTORY_ID, table, data: rows, apiKey: API_KEY };
        let response;
        try {
            response = await fetch(`${MAIN_SERVER_URL}/api/sync/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.error(`[Sync] Push request failed ${table} batch ${batchNum}:`, err.message);
            stats.failed += rows.length;
            break;
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.error(`[Sync] Push HTTP error ${table} batch ${batchNum}:`, text.slice(0, 200));
            stats.failed += rows.length;
            // Keep moving so a bad table cannot block the rest of the push cycle.
            break;
        }

        stats.pushed += rows.length;

        if (rows.length < PUSH_BATCH_SIZE) break; // last batch — no more rows

        const lastUpdatedAt = rows[rows.length - 1]?.updated_at;
        if (!lastUpdatedAt || lastUpdatedAt <= currentSince) break; // safety: no forward progress
        currentSince = lastUpdatedAt;
    }

    return stats;
}

async function pushChanges() {
    const stats = { pushed: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PUSH'`);
    const lastPush = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    for (const table of TABLES_TO_PUSH) {
        if (SERVER_TYPE === 'LOCAL' && LOCAL_NO_PUSH_TABLES.includes(table)) {
            // Auth tables are MAIN-authoritative. Never push from LOCAL to avoid
            // overwriting VPS user credentials with locally-seeded data.
            continue;
        }
        if (!(await tableExistsPublic(table))) {
            console.warn(`[Sync] Push skipped ${table}: table does not exist locally`);
            continue;
        }
        if (!(await tableHasColumn(table, 'updated_at'))) {
            console.warn(`[Sync] Push skipped ${table}: updated_at column is missing`);
            continue;
        }

        const tableStats = await pushTableAllBatches(table, lastPush);
        stats.pushed += tableStats.pushed;
        stats.failed += tableStats.failed;
    }

    // Always advance the watermark so new data is never permanently blocked by
    // a persistently-failing table (e.g. stale notification constraint violations).
    // Network-level failures (fetch throws) still count as failed but we advance
    // anyway — the VPS will deduplicate on the next cycle via upsert conflict keys.
    await setServerConfigValue('LAST_PUSH', cycleWatermark);
    if (stats.failed > 0) {
        console.warn(`[Sync] LAST_PUSH advanced despite ${stats.failed} push error(s) — failed rows will not be retried.`);
    }
    return stats;
}

async function pushDeletionChanges() {
    const stats = { deleted: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PUSH'`);
    const lastPush = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();
    let deletions = await getDeletionChanges(lastPush, LOCAL_FACTORY_ID);

    // On LOCAL servers, never push deletions for auth-authoritative tables.
    if (SERVER_TYPE === 'LOCAL' && LOCAL_NO_PUSH_TABLES.length) {
        deletions = deletions.filter((d) => !LOCAL_NO_PUSH_TABLES.includes(d.table));
    }

    if (deletions.length > 0) {
        console.log(`[Sync] Pushing ${deletions.length} deletions...`);
        let response;
        try {
            response = await fetch(`${MAIN_SERVER_URL}/api/sync/push-deletions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deletions, apiKey: API_KEY })
            });
        } catch (error) {
            console.error('[Sync] Push Deletions Request Failed:', error.message);
            stats.failed += deletions.length;
            return stats;
        }

        if (!response.ok) {
            const text = await response.text();
            console.error('[Sync] Push Deletions Failed:', text);
            stats.failed += deletions.length;
            return stats;
        }
        stats.deleted += deletions.length;
    }

    // Always advance so deletion sync never gets permanently stuck.
    await setServerConfigValue('LAST_DELETE_PUSH', cycleWatermark);
    if (stats.failed > 0) {
        console.warn(`[Sync] LAST_DELETE_PUSH advanced despite ${stats.failed} deletion push error(s).`);
    }
    return stats;
}

// Fetch ALL changed rows for a table from MAIN, handling pagination automatically.
//
// WHY PAGINATION MATTERS:
//   getChanges() on MAIN returns at most 1000 rows per request (ORDER BY updated_at ASC LIMIT 1000).
//   pullChanges() then advances LAST_PULL to NOW().  Any rows with updated_at < NOW() that
//   were not in the first 1000 are permanently behind the new watermark and NEVER synced.
//   Example: MAIN has 1318 moulds → only 1000 get synced → 318 are lost forever.
//
//   This function pages through in batches of 1000 using the last returned row's updated_at
//   as the new 'since' for each subsequent request, until fewer than 1000 rows are returned.
async function pullTableAllPages(table, since) {
    const PAGE_LIMIT = 1000; // must match LIMIT in getChanges() on MAIN
    const allData = [];
    let currentSince = since;
    let pageNum = 0;

    while (true) {
        pageNum += 1;
        const url = `${MAIN_SERVER_URL}/api/sync/pull?table=${encodeURIComponent(table)}&since=${encodeURIComponent(currentSince)}&apiKey=${encodeURIComponent(API_KEY)}&factoryId=${encodeURIComponent(LOCAL_FACTORY_ID)}`;
        const response = await fetchWithSyncRetry(url, `Pull ${table} page ${pageNum}`);

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Pull ${table} page ${pageNum} HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }

        const json = await response.json();
        const rows = json.data || [];
        allData.push(...rows);

        if (rows.length < PAGE_LIMIT) break; // this was the last page

        // Advance 'since' to the last row's updated_at so the next page starts after it.
        const lastUpdatedAt = rows[rows.length - 1]?.updated_at;
        if (!lastUpdatedAt || lastUpdatedAt <= currentSince) break; // safety: no forward progress

        console.log(`[Sync] Pull ${table} page ${pageNum} (${rows.length} rows). Fetching more since ${lastUpdatedAt}...`);
        currentSince = lastUpdatedAt;
    }

    return allData;
}

async function pullChanges() {
    const stats = { created: 0, updated: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    for (const table of TABLES_TO_PULL) {
        try {
            if (!(await tableExistsPublic(table))) {
                console.warn(`[Sync] Pull skipped ${table}: table does not exist locally`);
                continue;
            }

            const data = await pullTableAllPages(table, lastPull);

            if (data.length > 0) {
                console.log(`[Sync] Pulled ${data.length} rows for ${table}...`);
                const tableStats = await upsertData(table, data);
                stats.created += tableStats.created;
                stats.updated += tableStats.updated;
                stats.failed += tableStats.failed;
            }
        } catch (e) {
            console.error(`[Sync] Pull Failed ${table}:`, e.message);
            stats.failed += 1;
        }
    }

    if (stats.failed === 0) {
        await setServerConfigValue('LAST_PULL', cycleWatermark);
    } else {
        console.warn(`[Sync] LAST_PULL kept at ${lastPull} because ${stats.failed} pull error(s) occurred — failed rows will retry next cycle.`);
    }
    return stats;
}

async function pullDeletionChanges() {
    const stats = { deleted: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    try {
        const response = await fetchWithSyncRetry(
            `${MAIN_SERVER_URL}/api/sync/pull-deletions?since=${encodeURIComponent(lastPull)}&apiKey=${encodeURIComponent(API_KEY)}&factoryId=${encodeURIComponent(LOCAL_FACTORY_ID)}`,
            'Pull deletions'
        );
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Pull deletions HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }

        const json = await response.json();
        const deletions = json.data || [];
        if (deletions.length > 0) {
            console.log(`[Sync] Pulled ${deletions.length} deletions...`);
            const applied = await applyRemoteDeletions(deletions);
            stats.deleted += applied.deleted;
            stats.failed += applied.failed;
        }
    } catch (e) {
        console.error('[Sync] Pull Deletions Failed:', e);
        stats.failed += 1;
    }

    if (stats.failed === 0) {
        await setServerConfigValue('LAST_DELETE_PULL', cycleWatermark);
    } else {
        console.warn(`[Sync] LAST_DELETE_PULL kept at ${lastPull} because ${stats.failed} deletion pull error(s) occurred.`);
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
    const tableColumns = await getTableColumns(table);
    const hasUpdatedAtColumn = tableColumns.has('updated_at');
    if (tableColumns.size === 0) {
        console.warn(`[Sync] Upsert skipped ${table}: table does not exist`);
        return { created: 0, updated: 0, failed: data.length };
    }

    while (attempt < MAX_RETRIES) {
        const client = await pool.connect();
        try {
            if (attempt > 0) console.log(`[Sync] Upsert retry ${attempt + 1} for ${table} (${data.length} rows)`);
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

                row = Object.fromEntries(
                    Object.entries(row).filter(([key]) => tableColumns.has(key))
                );

                const conflictColumns = getConflictColumns(table, row);
                const missingConflictColumns = conflictColumns.filter((column) => !tableColumns.has(column));
                if (missingConflictColumns.length) {
                    console.warn(`[Sync] Skipping ${table} row: conflict column(s) missing in schema: ${missingConflictColumns.join(', ')}`);
                    stats.failed += 1;
                    continue;
                }

                // When the conflict key is NOT 'id' (e.g. natural keys like plan_id+shift+dpr_date+machine
                // for std_actual, or line+shift_date+shift for shift_teams), drop the 'id' column from
                // the payload entirely.  Serial IDs diverge between LOCAL and MAIN when both sides create
                // rows independently, so keeping 'id' in the INSERT would either overwrite the wrong row
                // (ON CONFLICT id) or violate the serial uniqueness on the target server.
                if (row && Object.prototype.hasOwnProperty.call(row, 'id') && !conflictColumns.includes('id')) {
                    delete row.id;
                }

                const keys = Object.keys(row);
                const vals = Object.values(row);
                if (keys.length === 0) {
                    stats.failed += 1;
                    continue;
                }
                const idx = keys.map((_, i) => `$${i + 1}`);
                const setClause = keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ');
                const conflictKey = conflictColumns.join(', ');

                let whereClause = hasUpdatedAtColumn
                    ? `WHERE (EXCLUDED.updated_at > ${table}.updated_at OR ${table}.updated_at IS NULL)`
                    : '';

                if (table === 'plan_board') {
                    whereClause += whereClause ? ' AND ' : 'WHERE ';
                    whereClause += `NOT (${table}.status = 'Running' AND EXCLUDED.status IN ('Planned', 'Stopped', 'Pending'))`;
                    if (hasUpdatedAtColumn) {
                        whereClause += ` AND (${table}.updated_at < NOW() - INTERVAL '15 seconds' OR ${table}.updated_at IS NULL)`;
                    }
                }

                const sql = `
                    INSERT INTO ${table} (${keys.join(',')})
                    VALUES (${idx.join(',')})
                    ON CONFLICT (${conflictKey})
                    DO UPDATE SET ${setClause}
                    ${whereClause}
                    RETURNING (xmax = 0) AS inserted
                `;

                let savepointActive = false;
                try {
                    await client.query('SAVEPOINT sync_row_upsert');
                    savepointActive = true;
                    const result = await client.query(sql, vals);
                    await client.query('RELEASE SAVEPOINT sync_row_upsert');
                    savepointActive = false;
                    if (result.rows.length && result.rows[0].inserted === true) {
                        stats.created += 1;
                    } else if (result.rows.length) {
                        stats.updated += 1;
                    }
                    } catch (innerErr) {
                        if (savepointActive) {
                            try {
                                await client.query('ROLLBACK TO SAVEPOINT sync_row_upsert');
                                await client.query('RELEASE SAVEPOINT sync_row_upsert');
                            } catch (savepointErr) {
                                console.error(`[Sync] Savepoint rollback failed for ${table}:`, savepointErr.message);
                                throw savepointErr;
                            }
                            savepointActive = false;
                        }
                        if (innerErr.code === '40P01') {
                            throw innerErr;
                        }

                        if (table === 'notifications' && innerErr.constraint === 'uq_sync_conflict_notifications') {
                            let legacySavepointActive = false;
                            try {
                                await client.query('SAVEPOINT sync_legacy_notif');
                                legacySavepointActive = true;
                                const resolved = await tryResolveLegacyNotificationConflict(client, row, keys, vals);
                                await client.query('RELEASE SAVEPOINT sync_legacy_notif');
                                legacySavepointActive = false;
                                if (resolved) {
                                    stats.updated += 1;
                                    continue;
                                }
                            } catch (legacyErr) {
                                if (legacySavepointActive) {
                                    try {
                                        await client.query('ROLLBACK TO SAVEPOINT sync_legacy_notif');
                                        await client.query('RELEASE SAVEPOINT sync_legacy_notif');
                                    } catch (cleanupErr) {
                                        console.error('[Sync] Legacy savepoint rollback failed:', cleanupErr.message);
                                        // Re-throw so the outer catch can ROLLBACK the transaction.
                                        // Without this, the transaction stays in an aborted state and
                                        // every subsequent row in the batch fails with
                                        // "current transaction is aborted, commands ignored until
                                        // end of transaction block".
                                        throw cleanupErr;
                                    }
                                }
                                console.error('[Sync] Legacy notification conflict fallback failed:', legacyErr.message);
                            }
                        }

                        // --- sync_id external-constraint deconfliction ---
                        // Applies to tables (e.g. shift_teams) that have a UNIQUE index on
                        // sync_id created by the app schema outside the sync service.
                        // Symptom: INSERT fails with 23505 on the sync_id constraint because
                        // a different LOCAL row was previously assigned the same sync_id that
                        // MAIN considers authoritative for a different natural key.
                        // Fix: reassign the conflicting row's sync_id to a new random UUID
                        // (inside a fresh savepoint), then retry the original upsert.
                        if (
                            innerErr.code === '23505'
                            && row && row.sync_id
                            && TABLES_WITH_EXTERNAL_SYNC_ID_CONSTRAINT.has(table)
                            && String(innerErr.constraint || innerErr.detail || '').toLowerCase().includes('sync_id')
                        ) {
                            let deconflictActive = false;
                            try {
                                await client.query('SAVEPOINT sync_deconflict_syncid');
                                deconflictActive = true;
                                // Reassign the stale sync_id on the conflicting LOCAL row
                                await client.query(
                                    `UPDATE ${table} SET sync_id = gen_random_uuid() WHERE sync_id = $1`,
                                    [row.sync_id]
                                );
                                // Retry the original upsert — it can now INSERT or UPDATE cleanly
                                const result2 = await client.query(sql, vals);
                                await client.query('RELEASE SAVEPOINT sync_deconflict_syncid');
                                deconflictActive = false;
                                if (result2.rows.length && result2.rows[0].inserted === true) {
                                    stats.created += 1;
                                } else if (result2.rows.length) {
                                    stats.updated += 1;
                                }
                                continue; // row handled — move on to the next one
                            } catch (deconflictErr) {
                                if (deconflictActive) {
                                    try {
                                        await client.query('ROLLBACK TO SAVEPOINT sync_deconflict_syncid');
                                        await client.query('RELEASE SAVEPOINT sync_deconflict_syncid');
                                    } catch (cleanupErr) {
                                        console.error('[Sync] Deconflict savepoint cleanup failed:', cleanupErr.message);
                                        throw cleanupErr;
                                    }
                                }
                                console.error(`[Sync] sync_id deconflict fallback failed for ${table}:`, deconflictErr.message);
                                // Fall through to the generic error log below
                            }
                        }
                        // -------------------------------------------------------

                        console.error(`[Sync] Row Error in ${table}:`, innerErr.message);
                        console.error('Failed Row:', JSON.stringify(row));
                        stats.failed += 1;
                    }
            }

            await client.query('COMMIT');

            // After committing plan_board upserts, enforce the invariant that only
            // ONE plan per machine can be RUNNING at a time.  A LOCAL server may
            // have started a plan independently (e.g. via DPR entry) and pushed it
            // here while MAIN already had a different plan RUNNING on the same
            // machine.  Keep the most-recently-updated Running plan per machine and
            // stop the rest.  This runs outside the batch transaction so a failure
            // here never rolls back the data already committed.
            if (table === 'plan_board') {
                try {
                    await pool.query(`
                        UPDATE plan_board
                           SET status = 'Stopped', updated_at = NOW()
                         WHERE UPPER(status) = 'RUNNING'
                           AND id NOT IN (
                               SELECT DISTINCT ON (machine) id
                                 FROM plan_board
                                WHERE UPPER(status) = 'RUNNING'
                                ORDER BY machine, updated_at DESC NULLS LAST
                           )
                    `);
                } catch (dedupErr) {
                    console.warn('[Sync] plan_board RUNNING dedup failed (non-fatal):', dedupErr.message);
                }
            }

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
                // Do NOT re-throw non-deadlock errors. Instead, count all rows in
                // this batch as failed and return stats so the caller (push endpoint)
                // can return HTTP 200 with partialFailures=true.
                //
                // WHY: throwing here causes the push endpoint to return 500, which
                // causes the factory server's LAST_PUSH to freeze indefinitely —
                // blocking ALL tables, not just the one that failed. Returning stats
                // lets LAST_PUSH advance so all other tables keep flowing.
                console.error(`[Sync] Upsert Batch Error ${table} (returning failed stats, not throwing):`, e.message);
                return { created: stats.created, updated: stats.updated, failed: stats.failed + data.length };
            }
        } finally {
            client.release();
        }
    }
}

async function getChanges(table, since, targetFactoryId) {
    if (!(await tableExistsPublic(table))) {
        return [];
    }

    let sql = `SELECT * FROM ${table}`;
    const params = [];
    const where = [];
    const normalizedSince = normalizeSyncTimestampInput(since);

    if (normalizedSince && await tableHasColumn(table, 'updated_at')) {
        params.push(normalizedSince);
        where.push(`updated_at > $${params.length}`);
    }

    // Global master tables are NOT scoped to a factory — every LOCAL server should
    // receive the complete set regardless of factory_id assignment.
    if (targetFactoryId && !GLOBAL_MASTER_TABLES.has(table)) {
        params.push(targetFactoryId);
        where.push(`(factory_id = $${params.length} OR factory_id IS NULL)`);
    }

    if (where.length) {
        sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' ORDER BY updated_at ASC LIMIT 1000';

    try {
        const rows = await pool.query(sql, params);
        return rows.rows;
    } catch (e) {
        if (e.code === '42703') {
            if (targetFactoryId) params.pop();

            let fallbackSql = `SELECT * FROM ${table}`;
            if (normalizedSince) fallbackSql += ' WHERE updated_at > $1';
            fallbackSql += ' ORDER BY updated_at ASC LIMIT 1000';
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
            if (!(await tableExistsPublic(table))) {
                console.warn(`[Sync] updated_at tracking skipped for ${table}: table does not exist`);
                continue;
            }
            const sourceColumn = SYNC_UPDATED_AT_SOURCE_COLUMNS[table];
            const hasUpdatedAt = await tableHasColumn(table, 'updated_at');
            const hasSourceColumn = sourceColumn ? await tableHasColumn(table, sourceColumn) : false;

            if (!hasUpdatedAt) {
                await pool.query(`ALTER TABLE ${table} ADD COLUMN updated_at TIMESTAMPTZ`);
                tableColumnCache.delete(table);
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
            if (!(await tableExistsPublic(table))) {
                console.warn(`[Sync] sync_id schema skipped for ${table}: table does not exist`);
                continue;
            }
            const hasSyncId = await tableHasColumn(table, 'sync_id');
            if (!hasSyncId) {
                await pool.query(`ALTER TABLE ${table} ADD COLUMN sync_id UUID`);
                tableColumnCache.delete(table);
            }

            if (table === 'notifications') {
                await pool.query(`
                    WITH source AS (
                        SELECT id,
                               md5(concat_ws('|',
                                   COALESCE(target_user, ''),
                                   COALESCE(type, ''),
                                   COALESCE(title, ''),
                                   COALESCE(message, ''),
                                   COALESCE(link, ''),
                                   COALESCE(created_by, ''),
                                   COALESCE(created_at::text, '')
                               )) AS seed
                          FROM ${table}
                         WHERE sync_id IS NULL
                    )
                    UPDATE ${table} n
                       SET sync_id = (
                           substr(source.seed, 1, 8) || '-' ||
                           substr(source.seed, 9, 4) || '-' ||
                           substr(source.seed, 13, 4) || '-' ||
                           substr(source.seed, 17, 4) || '-' ||
                           substr(source.seed, 21, 12)
                       )::uuid
                      FROM source
                     WHERE n.id = source.id
                `);
                // Older local packages generated the same deterministic sync_id for duplicate
                // notification rows. Repair only duplicates so valid IDs stay stable.
                await pool.query(`
                    WITH ranked AS (
                        SELECT id,
                               ROW_NUMBER() OVER (PARTITION BY sync_id ORDER BY id) AS rn
                          FROM ${table}
                         WHERE sync_id IS NOT NULL
                    )
                    UPDATE ${table} n
                       SET sync_id = gen_random_uuid()
                      FROM ranked r
                     WHERE n.id = r.id
                       AND r.rn > 1
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
            if (!(await tableExistsPublic(table))) {
                console.warn(`[Sync] conflict index skipped for ${table}: table does not exist`);
                continue;
            }
            await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table} (${columns})`);
        } catch (e) {
            console.warn(`[Sync] conflict index skipped for ${table}:`, e.message);
        }
    }

    console.log('[Sync] conflict indexes ready');
}

async function tableExistsPublic(table) {
    if (tableExistsCache.has(table)) return tableExistsCache.get(table);

    const result = await pool.query(`
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
        LIMIT 1
    `, [table]);

    const exists = result.rows.length > 0;
    tableExistsCache.set(table, exists);
    return exists;
}

async function getTableColumns(table) {
    if (tableColumnCache.has(table)) return tableColumnCache.get(table);

    const result = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
    `, [table]);
    const columns = new Set(result.rows.map((row) => row.column_name));
    tableColumnCache.set(table, columns);
    return columns;
}

async function tableHasColumn(table, column) {
    if (tableExistsCache.get(table) === false) return false;

    const columns = await getTableColumns(table);
    if (columns.size > 0) return columns.has(column);

    const result = await pool.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        LIMIT 1
    `, [table, column]);

    return result.rows.length > 0;
}

async function getCachedPendingChanges() {
    const now = Date.now();
    if (
        PENDING_COUNT_INTERVAL_MS > 0
        && lastPendingCountAt
        && now - lastPendingCountAt < PENDING_COUNT_INTERVAL_MS
    ) {
        return lastPendingCountValue;
    }

    const pending = await countPendingChanges();
    lastPendingCountAt = now;
    lastPendingCountValue = pending;
    return pending;
}

async function countPendingChanges() {
    let pending = 0;
    const lastPushRes = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_PUSH'`);
    const lastDeletePushRes = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PUSH'`);
    const lastPush = lastPushRes.rows.length ? lastPushRes.rows[0].value : '1970-01-01';
    const lastDeletePush = lastDeletePushRes.rows.length ? lastDeletePushRes.rows[0].value : '1970-01-01';

    for (const table of TABLES_TO_PUSH) {
        try {
            if (SERVER_TYPE === 'LOCAL' && LOCAL_NO_PUSH_TABLES.includes(table)) continue;
            if (!(await tableExistsPublic(table))) {
                console.warn(`[Sync] Pending count skipped for ${table}: table does not exist`);
                continue;
            }
            if (!(await tableHasColumn(table, 'updated_at'))) {
                console.warn(`[Sync] Pending count skipped for ${table}: updated_at column is missing`);
                continue;
            }
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

function setRuntimeForTests(patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, 'pool')) pool = patch.pool;
    if (Object.prototype.hasOwnProperty.call(patch, 'SERVER_TYPE')) SERVER_TYPE = patch.SERVER_TYPE;
    if (Object.prototype.hasOwnProperty.call(patch, 'MAIN_SERVER_URL')) MAIN_SERVER_URL = patch.MAIN_SERVER_URL;
    if (Object.prototype.hasOwnProperty.call(patch, 'LOCAL_FACTORY_ID')) LOCAL_FACTORY_ID = patch.LOCAL_FACTORY_ID;
    if (Object.prototype.hasOwnProperty.call(patch, 'API_KEY')) API_KEY = patch.API_KEY;
    if (syncTimer) clearTimeout(syncTimer);
    if (triggerTimeout) clearTimeout(triggerTimeout);
    syncTimer = null;
    triggerTimeout = null;
    syncInFlight = false;
    syncRerunRequested = false;
    lastPendingCountAt = 0;
    lastPendingCountValue = 0;
    tableColumnCache.clear();
    tableExistsCache.clear();
}

module.exports = {
    init,
    router,
    triggerSync,
    __test: {
        fetchWithSyncRetry,
        pullChanges,
        pullTableAllPages,
        setRuntimeForTests
    }
};
