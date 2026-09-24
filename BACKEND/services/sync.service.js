// fetch is available globally in Node.js 18+ — no require needed
const express = require('express');
const rateLimit = require('express-rate-limit');
const { allowedExtension, PRIVATE_UPLOAD_DIRS } = require('../src/app/uploadSafety');
const { ensureUniqueIndex } = require('../src/db/indexUtils');

const router = express.Router();

let pool;
let SERVER_TYPE = 'STANDALONE';
let MAIN_SERVER_URL = '';
let LOCAL_FACTORY_ID = 1;
// No hardcoded default: a well-known fallback key used to let anyone authenticate
// sync requests (and be sent to MAIN) whenever the env var was unset. When empty,
// syncKeyValid() rejects every request (see below), so sync stays closed until a
// real key is configured via SYNC_API_KEY or server_config.
let API_KEY = process.env.SYNC_API_KEY || '';

// Full replication: when enabled on a LOCAL box, it pulls EVERY factory's data from MAIN
// (not just its own home factory), so cross-factory users can view other units offline.
// Requested via env FULL_REPLICATION=1 (or a server_config override), but only actually
// turned on after assertFullReplicationSafe() confirms no LOCAL-writable table still keys
// sync on the serial `id` — an id-keyed table would collide across factories once other
// factories' rows arrive. If the guard fails the flag is forced OFF and the box keeps
// running in normal per-factory mode. [[project_full_replication_all_locals]]
let FULL_REPLICATION = false;
function readBooleanEnv(name) {
    const v = String(process.env[name] || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// Parse the factoryId a LOCAL sends on /pull and /pull-deletions. 'all'/'*'/blank/non-numeric
// means "serve every factory" (full replication) and returns null so getChanges applies no
// factory filter; a positive integer scopes to that one factory (normal per-factory LOCAL).
function normalizePullFactoryScope(factoryId) {
    const raw = String(factoryId ?? '').trim().toLowerCase();
    if (raw === '' || raw === 'all' || raw === '*') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

// What a LOCAL puts in the factoryId param of its pull requests: 'all' when full replication
// is on (pull every factory), otherwise its own home factory id (normal per-factory sync).
function localPullFactoryParam() {
    return FULL_REPLICATION ? 'all' : String(LOCAL_FACTORY_ID);
}

// Safety interlock for full replication. Once a LOCAL pulls OTHER factories' rows, any table
// whose sync ON CONFLICT key is still the serial `id` will collide across factories (each
// server mints ids independently), overwriting/duplicating rows. This returns the tables that
// make full replication unsafe: those in the push set, keyed on `id`, that a LOCAL actually
// writes (i.e. NOT MAIN-only-write LOCAL_NO_PUSH_TABLES, whose ids are globally unique because
// MAIN is the sole minter). Every such table must be converted to a natural/surrogate key
// (batches 1-4) before the flag can turn on. [[project_full_replication_all_locals]]
function findFullReplicationKeyOffenders() {
    const offenders = [];
    for (const table of TABLES_TO_PUSH) {
        if (LOCAL_NO_PUSH_TABLES.includes(table)) continue; // MAIN-only writer → ids globally unique
        const key = CONFLICT_KEYS[table];
        // A missing entry falls back to 'id' in getConflictColumns; treat that as unsafe too.
        if (!key || key.split(',').map(s => s.trim()).join(',') === 'id') offenders.push(table);
    }
    return offenders;
}

function assertFullReplicationSafe() {
    const offenders = findFullReplicationKeyOffenders();
    return { safe: offenders.length === 0, offenders };
}

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
// Upper bound for any single HTTP call to MAIN. Without it a half-open connection could
// hold syncInFlight=true and stall every later cycle. Generous because a 1000-row page
// travels over the factory internet line.
const SYNC_FETCH_TIMEOUT_MS = readPositiveIntegerEnv('SYNC_FETCH_TIMEOUT_MS', 120 * 1000);

function withSyncTimeout(options = {}) {
    return { ...options, signal: AbortSignal.timeout(SYNC_FETCH_TIMEOUT_MS) };
}

// GET pulls carry the sync key in this header. It used to travel as ?apiKey= in the URL,
// which access logs record, so the key sat in plain text in logs/access.log on MAIN.
// POST routes keep the key in the JSON body (bodies are not logged).
const SYNC_KEY_HEADER = 'x-sync-api-key';

function syncPullHeaders() {
    return { [SYNC_KEY_HEADER]: API_KEY };
}

// Validate a sync key supplied by a caller. Rejects when the server has no key
// configured (API_KEY empty), so an unset key can never authenticate — and a
// caller sending an empty/missing key never matches.
function syncKeyValid(provided) {
    return Boolean(API_KEY) && provided === API_KEY;
}

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
    'erp_bom',
    'erp_jr_details',
    'erp_jr_status',
    'erp_jr_summary',
    'erp_mould_item',
    'extra_qty_allowances',
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
    'maintenance_tickets',
    'maintenance_worklogs',
    'mould_audit_logs',
    'mould_planning_report',
    'mould_planning_summary',
    'mould_verify_notes',
    'moulds',
    'notifications',
    'operator_history',
    'org_units',
    'org_departments',
    'org_grades',
    'org_designations',
    'org_people',
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
// ERP report tables (erp_jr_*) are populated on MAIN by the superadmin "Fetch
// Latest Data" button pulling from the Joyo ERP. MAIN is authoritative; LOCAL
// only pulls them down and must never push, or empty local tables would wipe MAIN.
// Tables a LOCAL never PUSHES because they are authored only on MAIN (or nowhere). Their
// serial ids are therefore globally unique (MAIN is the sole minter), so they stay safe on
// an `id` conflict key even under full replication — no per-factory conversion needed.
// Full-replication batch 5 additions (write-origin audited):
//   bom_master/bom_components — written only by erp.service (MAIN ERP sync).
//   factories — seeded with fixed canonical ids (1..N) identically on every server; the id
//     is the load-bearing factory_id referenced everywhere, so it must never be re-minted.
//   vendor_payments/grn_entries/jc_summaries/job_cards/plan_history — no writer anywhere;
//     they only ever receive rows from MAIN, so a LOCAL has nothing to push.
const LOCAL_NO_PUSH_TABLES = ['users', 'roles', 'erp_jr_status', 'erp_jr_summary', 'erp_jr_details', 'erp_bom', 'erp_mould_item',
    'bom_master', 'bom_components', 'factories', 'vendor_payments', 'grn_entries', 'jc_summaries', 'job_cards', 'plan_history',
    // Full-replication batch 6 — head-office modules authored on MAIN (procurement, HR,
    // interview panel, job-card detail). They keep serial-id keys with internal id links
    // (purchase_order_items→purchase_orders, hr_kra_* chains) intact; MAIN is the sole id
    // minter so those ids are globally unique and safe under full replication. Factory LOCAL
    // boxes treat them read-only (per "LOCAL read-only for masters/imports"), so a LOCAL never
    // authors them and has nothing to push. If a module later needs LOCAL authoring, convert
    // it (with sync_id links) instead of listing it here.
    'jc_details', 'vendors', 'vendor_dispatch', 'vendor_users',
    'purchase_orders', 'purchase_order_items', 'dispatch_items',
    'hr_employee_profiles', 'hr_kra_templates', 'hr_kra_template_items',
    'hr_kra_assignments', 'hr_kra_assignment_items', 'hr_interviews', 'hr_interview_scores'];

const CONFLICT_KEYS = {
    users: 'id',
    roles: 'code',
    // Natural key. order_no is unique only WITHIN a factory (the orders table is
    // per-factory: the app's own bulk-import upserts by order_no + factory_id, and the
    // same order_no legitimately exists in more than one factory — e.g. the Dungra order
    // that fanned out in the DPR matrix, KAN-127). Serial `id` diverges LOCAL↔MAIN, so it
    // can't be the key either. Keying on order_no ALONE made a second factory's order
    // collide with the first factory's identical order_no on MAIN — ON CONFLICT (order_no)
    // UPDATED the existing row instead of INSERTing, so the pushing factory's order never
    // became its own MAIN row (same defect that lost plan_board rows). The identity is
    // (order_no, factory_id); the backing global UNIQUE (orders_order_no_key) is dropped
    // and replaced by the factory-scoped expression index in the schema heal. Nothing
    // references orders.id (no FK, no order_id column anywhere; all joins use order_no).
    // Backed by RAW_CONFLICT_TARGETS.orders (COALESCE(factory_id, 0), NULL-safe).
    // [[project_plan_id_not_globally_unique]] [[project_sync_conflict_natural_key]]
    orders: 'order_no, factory_id',
    // plan_id (PLN-<fy>-<seq>) is unique only WITHIN a factory — every factory mints
    // the same sequence independently, so PLN-2026-050 exists on factory 1 AND factory 3.
    // Keying the MAIN upsert on plan_id alone made a LOCAL factory-3 plan collide with an
    // unrelated factory-1 plan already on MAIN: ON CONFLICT (plan_id) UPDATED the existing
    // row instead of INSERTing, so the pushing factory's plan never became its own row on
    // MAIN — the direct cause of "LOCAL has 93 plans, MAIN has 46". The natural identity is
    // (plan_id, factory_id). Backed by the expression index in RAW_CONFLICT_TARGETS.plan_board
    // (COALESCE(factory_id, 0), so NULL-factory legacy plans still collapse to one row).
    // Same per-factory-natural-key fix already applied to moulds and machines.
    // [[project_plan_id_not_globally_unique]] [[project_sync_conflict_natural_key]]
    plan_board: 'plan_id, factory_id',
    plan_audit_logs: 'sync_id',
    plan_history: 'id',
    purchase_order_items: 'id',
    purchase_orders: 'id',
    user_factories: 'user_id, factory_id',
    or_jr_report: 'or_jr_no',
    // Surrogate UUID key: dpr_reasons has no business natural key, and serial id
    // diverges/collides across factories under replication. sync_id is UNIQUE with a
    // gen_random_uuid() default; dpr_reasons is added to SYNC_ID_REQUIRED_TABLES so any
    // pre-existing NULL sync_ids are backfilled. Same pattern as notifications.
    dpr_reasons: 'sync_id',
    // Natural key matches mould_report_date_uniq_idx — serial id diverges LOCAL↔MAIN
    mould_planning_report: 'or_jr_no, mould_no, mould_item_code, plan_date',
    // Summary identity is one row per (or_jr_no, mould_no) — plan_date is NOT part
    // of it (the upload has no plan_date; it's derived from JR Date, which changing
    // would otherwise split the mould into a duplicate row). Matches
    // mould_planning_summary_upsert_idx. Serial id diverges LOCAL↔MAIN so it can't
    // be the key.
    mould_planning_summary: 'or_jr_no, mould_no',
    jc_details: 'id',
    jc_summaries: 'id',
    job_cards: 'id',
    // Natural key: operator_id is declared UNIQUE on the table and is the operator's
    // company-wide identity, so it's collision-free across factories — unlike the serial id.
    // [[project_full_replication_all_locals]] [[project_sync_conflict_natural_key]]
    machine_operators: 'operator_id',
    // Append-only log/audit tables — surrogate UUID key for full replication. Serial id
    // is minted independently per server and collides across factories, so ON CONFLICT (id)
    // would overwrite unrelated rows. sync_id is UNIQUE (gen_random_uuid default); all are in
    // SYNC_ID_REQUIRED_TABLES with a DETERMINISTIC seed (SYNC_ID_SEED_COLUMNS) so the same
    // physical row on MAIN and its LOCAL derives one id and dedups. [[project_full_replication_all_locals]]
    machine_status_logs: 'sync_id',
    mould_audit_logs: 'sync_id',
    // Verification notes carry a surrogate sync_id so LOCAL & MAIN never collide on
    // their independent serial ids (same pattern as assembly_plans).
    mould_verify_notes: 'sync_id',
    // QC entry tables — surrogate UUID key. These are LOCAL-writable and factory-scoped
    // (each carries factory_id), with no stable business composite. Under full
    // replication the serial id collides across factories, so ON CONFLICT (id) would let
    // one factory's row overwrite an unrelated same-id row from another. sync_id is UNIQUE
    // with a gen_random_uuid() default; all five are in SYNC_ID_REQUIRED_TABLES and get a
    // DETERMINISTIC backfill (SYNC_ID_SEED_COLUMNS) so the same physical row already present
    // on MAIN and a LOCAL derives the SAME sync_id and dedups instead of duplicating.
    // Same pattern as assembly_plans/dpr_reasons. [[project_full_replication_all_locals]]
    qc_deviations: 'sync_id',
    qc_issue_memos: 'sync_id',
    qc_job_checks: 'sync_id',
    qc_online_reports: 'sync_id',
    qc_training_sheets: 'sync_id',
    // Surrogate UUID key (full-replication batch 3): append-only shifting log, no factory_id,
    // serial id collides across factories. Deterministic seed in SYNC_ID_SEED_COLUMNS.
    shifting_records: 'sync_id',
    std_actual: 'plan_id, shift, dpr_date, machine',
    // Natural key matches uq_eqa_natural — serial id diverges LOCAL↔MAIN
    extra_qty_allowances: 'plan_id, colour, allowed_by, allowed_at',
    vendor_dispatch: 'id',
    vendor_payments: 'id',
    vendor_users: 'id',
    // WIP chain (full-replication batch 4). Both have a sync_id column already.
    // wip_inventory keys on its own sync_id (deterministic seed). wip_outward_logs keys on
    // its own sync_id AND links to its parent inventory row by wip_inventory_sync_id (NOT the
    // serial wip_inventory_id, which diverges cross-server) — the old FK to wip_inventory(id)
    // is dropped and the link column backfilled, exactly like assembly_scans→assembly_plans.
    wip_inventory: 'sync_id',
    wip_outward_logs: 'sync_id',
    assembly_lines: 'line_id',
    // Surrogate UUID key: assembly_plans/assembly_scans have no business natural key,
    // and the serial id is minted independently on MAIN and every LOCAL, so
    // ON CONFLICT (id) let one server's row overwrite an unrelated same-id row on
    // another — plans created in Packing/Assembly vanished on the next sync cycle.
    // sync_id is UNIQUE with a gen_random_uuid() default; both tables are in
    // SYNC_ID_REQUIRED_TABLES so pre-existing NULL sync_ids get backfilled. Same
    // pattern as notifications/dpr_reasons. [[project_sync_conflict_natural_key]]
    assembly_plans: 'sync_id',
    assembly_scans: 'sync_id',
    vendors: 'id',
    app_settings: 'key',
    factories: 'id',
    // Surrogate UUID key (full-replication batch 5): LOCAL floor grinding/rejection log,
    // serial id collides across factories. Deterministic seed in SYNC_ID_SEED_COLUMNS.
    grinding_logs: 'sync_id',
    shift_teams: 'line, shift_date, shift',
    closed_plants: 'factory_id, dpr_date, plant, shift',
    machine_audit_logs: 'sync_id',
    // Maintenance module: sync identity is sync_id (UNIQUE with gen_random_uuid()
    // default; both tables in SYNC_ID_REQUIRED_TABLES so pre-existing NULLs backfill).
    // Worklogs link to their ticket by ticket_sync_id, never the serial id.
    maintenance_tickets: 'sync_id',
    maintenance_worklogs: 'sync_id',
    // Management org tables — sync identity is sync_id (gen_random_uuid default;
    // all in SYNC_ID_REQUIRED_TABLES). org_people.reports_to_id/user_id are serial
    // FKs that diverge across servers, but the org tree is superadmin-managed on a
    // single source (MAIN) so cross-server relink is not needed for v1.
    org_units: 'sync_id',
    org_departments: 'sync_id',
    org_grades: 'sync_id',
    org_designations: 'sync_id',
    org_people: 'sync_id',
    // notifications sync identity is sync_id (backed by uq_sync_id_notifications,
    // built in ensureSyncIdSchema). The old 4-column natural key emitted
    // ON CONFLICT (target_user, type, title, created_at) which matched no index
    // on servers where uq_sync_conflict_notifications was never created (42P10).
    notifications: 'sync_id',
    order_completion_history: 'factory_id, order_no, action_type, changed_at',
    raw_material_issues: 'factory_id, plan_id, created_at',
    wip_stock_movements: 'factory_id, source_type, source_ref, movement_type, created_at',
    wip_stock_snapshots: 'factory_id, stock_date, source_file_name',
    wip_stock_snapshot_lines: 'factory_id, stock_date, comparison_key',
    // Master tables — explicit id conflict (previously relied on fallback)
    // moulds keys on the NATURAL identity (mould_number + factory_id), not the serial
    // id: LOCAL and MAIN mint mould ids independently, so ON CONFLICT (id) made a LOCAL
    // factory-2 mould collide with an unrelated MAIN mould, fail the real
    // (mould_number, factory_id) unique index, and get dropped — so factory-2 moulds
    // never reached MAIN (KAN-118). Natural key also drops the divergent id from the
    // payload (see upsertData). Upsert target is the expression index — see
    // RAW_CONFLICT_TARGETS.moulds. [[project_sync_conflict_natural_key]]
    moulds: 'mould_number, factory_id',
    // Natural key (machine, factory_id) — same per-factory-master shape as moulds. machines
    // is LOCAL-writable and pulled company-wide, so the serial id diverges across factories
    // and can't be the conflict key. Backed by the existing expression unique index
    // idx_machines_factory_machine_unique ((LOWER(machine)), (COALESCE(factory_id, 0))) —
    // see RAW_CONFLICT_TARGETS.machines. machines.id is FK'd only by the machineData/Modbus
    // tables, which are NOT synced, so re-minting an incoming factory's machine id locally is
    // safe. [[project_sync_conflict_natural_key]] [[project_full_replication_all_locals]]
    machines: 'machine, factory_id',
    bom_master: 'id',
    bom_components: 'id',
    // Surrogate UUID key: dpr_hourly has NO unique business composite (even
    // factory_id+dpr_date+shift+machine+hour_slot+plan_id+entry_type+colour still has
    // thousands of legitimate duplicate rows), and serial id collides across factories
    // under replication. global_id is UNIQUE, NOT NULL, uuid_generate_v4() default on
    // every row and preserved through sync — a collision-free cross-server identity.
    dpr_hourly: 'global_id',
    grn_entries: 'id',
    dispatch_items: 'id',
    // Surrogate UUID key (full-replication batch 3). jobs_queue: no factory_id/created_at,
    // seed from its immutable job-identity columns. planning_drops: append-only drop log.
    jobs_queue: 'sync_id',
    planning_drops: 'sync_id',
    operator_history: 'sync_id',
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
    plan_job_card_approval_history: 'sync_id',
    // ERP report tables — row_key is the stable natural key (unique) from the ERP source
    erp_jr_status: 'row_key',
    erp_jr_summary: 'row_key',
    erp_jr_details: 'row_key',
    erp_bom: 'row_key',
    erp_mould_item: 'row_key'
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

// Tables whose ON CONFLICT target must be a raw expression rather than a plain
// column list, because the backing unique index is built on an expression.
// or_jr_report's unique index is idx_or_jr_jc_unique ON (TRIM(or_jr_no), COALESCE(job_card_no, '')) —
// the single-column unique on or_jr_no was dropped (one OR/JR can have many job cards),
// so ON CONFLICT (or_jr_no) no longer matches any index. The target must reproduce the
// index expression EXACTLY — including TRIM(or_jr_no). Omitting TRIM made ON CONFLICT
// infer against a non-existent index and fail every row with 42P10 ("no unique or
// exclusion constraint matching the ON CONFLICT specification"), which froze LAST_PULL.
// getConflictColumns still returns ['or_jr_no'] for deletion-PK parsing; only the upsert
// conflict target is overridden here.
const RAW_CONFLICT_TARGETS = {
    or_jr_report: `TRIM(or_jr_no), COALESCE(job_card_no, '')`,
    // plan_board's unique identity is idx_plan_board_plan_factory_unique ON
    // (plan_id, (COALESCE(factory_id, 0))) — an EXPRESSION index (factory_id is
    // nullable on legacy plans, and NULLs must collapse to a single row, not be
    // treated as all-distinct). The ON CONFLICT target must reproduce it exactly or
    // Postgres infers against a non-existent plain (plan_id, factory_id) index and
    // fails every row with 42P10. getConflictColumns still returns
    // ['plan_id','factory_id'] for the delete-trigger key and id-drop logic; only the
    // upsert conflict target is overridden here. See CONFLICT_KEYS.plan_board.
    plan_board: `plan_id, COALESCE(factory_id, 0)`,
    // orders' unique identity is idx_orders_factory_order_unique ON
    // (order_no, (COALESCE(factory_id, 0))) — an EXPRESSION index (factory_id is nullable
    // on legacy rows and NULLs must collapse to one row). Same reasoning as plan_board:
    // getConflictColumns still returns ['order_no','factory_id']; only the upsert conflict
    // target is overridden here. See CONFLICT_KEYS.orders.
    orders: `order_no, COALESCE(factory_id, 0)`,
    // moulds' unique index is idx_moulds_factory_mould_number_unique ON
    // ((LOWER(mould_number)), (COALESCE(factory_id, 0))) — an EXPRESSION index. The
    // ON CONFLICT target must reproduce it exactly, or Postgres infers against a
    // non-existent plain (mould_number, factory_id) index and fails every row with
    // 42P10. getConflictColumns still returns ['mould_number','factory_id'] for the
    // id-drop and deletion-PK parsing; only the upsert conflict target is overridden here.
    moulds: `LOWER(mould_number), COALESCE(factory_id, 0)`,
    // machines' unique index idx_machines_factory_machine_unique ON
    // ((LOWER(machine)), (COALESCE(factory_id, 0))) is an EXPRESSION index — reproduce it
    // exactly or Postgres fails every row with 42P10. getConflictColumns still returns
    // ['machine','factory_id']; only the upsert conflict target is overridden here.
    machines: `LOWER(machine), COALESCE(factory_id, 0)`
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
    'moulds',       // Mould master — company-wide reference, not factory-scoped
    'mould_verify_notes', // Verification notes ride with the company-wide mould master
    // Users are company-wide: a person created on MAIN carries a single users.factory_id
    // (their "home" factory), but can be granted access to OTHER factories via
    // user_factories. Factory-scoping the users pull on users.factory_id meant a user
    // home-tagged to factory 1 but assigned to factory 3 never reached the factory-3
    // LOCAL box — only their user_factories row arrived, which then failed its FK to the
    // absent users row. Pull every user to every server so factory access (checked via
    // user_factories / global_access) always has its user record present.
    'users',
    // ERP report tables have no factory_id — they are company-wide ERP snapshots.
    'erp_jr_status',
    'erp_jr_summary',
    'erp_jr_details',
    'erp_bom',
    'erp_mould_item'
]);

const SYNC_ID_REQUIRED_TABLES = ['notifications', 'dpr_reasons', 'assembly_plans', 'assembly_scans', 'maintenance_tickets', 'maintenance_worklogs', 'org_units', 'org_departments', 'org_grades', 'org_designations', 'org_people', 'mould_verify_notes', 'qc_online_reports', 'qc_issue_memos', 'qc_training_sheets', 'qc_deviations', 'qc_job_checks', 'plan_audit_logs', 'mould_audit_logs', 'machine_status_logs', 'operator_history', 'plan_job_card_approval_history', 'jobs_queue', 'planning_drops', 'shifting_records', 'wip_inventory', 'wip_outward_logs', 'grinding_logs'];

// Deterministic sync_id backfill seeds for tables converted to a surrogate UUID key.
// The same physical row already exists on MAIN AND on its factory's LOCAL (LOCAL pushed
// it up). A random gen_random_uuid() default would assign two DIFFERENT ids to that one
// logical row, so the first full-replication pull would treat them as distinct and
// DUPLICATE it. Seeding sync_id from stable business columns (md5 -> uuid, identical on
// both servers because the columns are set once at insert and synced verbatim) makes both
// sides derive the SAME id and dedup. Columns must be immutable after insert and, together,
// unique per logical row — created_at (row-birth timestamp, synced) provides that.
// ensureSyncIdSchema routes any SYNC_ID_REQUIRED_TABLES entry with a seed here through the
// deterministic path; entries without one fall back to a plain random backfill.
// [[project_full_replication_all_locals]] [[project_sync_conflict_natural_key]]
const SYNC_ID_SEED_COLUMNS = {
    qc_online_reports: ['factory_id', 'date', 'shift', 'hour_slot', 'line', 'machine', 'item_name', 'mould_name', 'defect_description', 'created_at'],
    qc_issue_memos: ['factory_id', 'date', 'line', 'machine', 'issue_description', 'responsibility', 'supervisor', 'created_at'],
    qc_training_sheets: ['factory_id', 'date', 'trainee_name', 'trainer_name', 'topic', 'created_at'],
    qc_deviations: ['factory_id', 'date', 'part_name', 'machine', 'deviation_details', 'reason', 'created_at'],
    qc_job_checks: ['factory_id', 'date', 'shift', 'hour_slot', 'plan_id', 'job_card_no', 'machine', 'item_name', 'mould_name', 'created_at'],
    // Append-only audit/log group (Phase A batch 2). Seeds use only columns set once at
    // insert (never the mutable status/end_* fields), so the id stays identical across
    // servers for one physical row.
    plan_audit_logs: ['plan_id', 'action', 'user_name', 'details', 'created_at'],
    mould_audit_logs: ['factory_id', 'mould_id', 'action_type', 'changed_by', 'changed_fields', 'changed_at'],
    machine_status_logs: ['machine', 'start_date', 'start_slot', 'created_at'],
    operator_history: ['operator_id', 'machine_at_time', 'scanned_by', 'scanned_at'],
    plan_job_card_approval_history: ['factory_id', 'plan_id', 'order_no', 'action', 'approval_stage', 'acted_by', 'acted_at'],
    // Full-replication batch 3. jobs_queue has NO created_at — seed from its immutable
    // job-identity columns (the complete_*/status fields mutate and are excluded).
    jobs_queue: ['plan_id', 'machine', 'order_no', 'mould_no', 'jobcard_no'],
    planning_drops: ['order_no', 'item_code', 'mould_no', 'mould_name', 'dropped_by', 'created_at'],
    shifting_records: ['machine_code', 'plan_id', 'quantity', 'from_location', 'to_location', 'shifted_by', 'created_at'],
    // Full-replication batch 4. wip_inventory seeds from its immutable identity columns
    // (qty/updated_at mutate and are excluded). wip_outward_logs is NOT here — it needs the
    // custom ensureSyncIdSchema branch (link column + FK drop + backfill) below.
    wip_inventory: ['factory_id', 'order_no', 'item_code', 'item_name', 'mould_name', 'rack_no', 'created_at'],
    // Full-replication batch 5. Immutable columns only (helper skips any that don't exist).
    grinding_logs: ['factory_id', 'plan_id', 'order_no', 'job_card_no', 'rejection_weight', 'rejection_qty', 'reason', 'created_by', 'created_at']
};
const SYNC_SCHEMA_READY_KEY = 'SYNC_SCHEMA_READY_VERSION';
// Bump this whenever ensureSyncRuntimeSchema()'s migrations change, so every server
// re-runs the full startup sweep once instead of skipping it on the cached marker.
// 2026-08-03: drop the obsolete uq_sync_conflict_notifications index (see ensureSyncIdSchema).
// 2026-09-15: mould_verify_notes → sync_id (develop).
// 2026-09-19: qc_* tables converted to surrogate sync_id key for full replication (Phase A batch 1).
// 2026-09-19: audit/log group (plan_audit_logs, mould_audit_logs, machine_status_logs,
//             operator_history, plan_job_card_approval_history) → sync_id (Phase A batch 2).
// 2026-09-21: jobs_queue/planning_drops/shifting_records → sync_id, machine_operators →
//             operator_id natural key (Phase A batch 3).
// 2026-09-21: WIP chain — wip_inventory → sync_id, wip_outward_logs → sync_id + relink to
//             parent by wip_inventory_sync_id, drop serial FK (Phase A batch 4).
// 2026-09-21: grinding_logs → sync_id; bom_*/factories/vendor_payments/grn_entries/
//             jc_summaries/job_cards/plan_history marked MAIN-only (Phase A batch 5).
// 2026-09-21: machines → natural key (machine, factory_id); vendor/purchase/HR/jc_details
//             marked MAIN-only (Phase A batch 6). Guard now clears — full replication armable.
const SYNC_SCHEMA_READY_VERSION = '2026-09-21-machines-nopush-v6';

// "Sync token" columns: app-schema UNIQUE columns that carry a per-row identity
// token (a UUID) MAIN considers authoritative, but which a LOCAL row may have been
// assigned independently before syncing.  When a natural-key upsert collides on one
// of these (23505), the row-loop handler reassigns the stale local value to a fresh
// UUID and retries.  Listed broadest-first; a single row (e.g. shift_teams) can carry
// more than one and collide on each in turn.
// NOTE: deconfliction is no longer table-whitelisted — the handler fires on the shape
// of the failure (a unique violation on a token column not in the conflict target),
// so new tables with the same pattern need no code change here.
const DECONFLICT_TOKEN_COLUMNS = ['sync_id', 'global_id'];
const tableColumnCache = new Map();
const tableExistsCache = new Map();
const jsonColumnCache = new Map();
const dateColumnCache = new Map();

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
            const response = await fetch(url, withSyncTimeout(options));
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
        if (!syncKeyValid(apiKey)) return res.status(403).json({ error: 'Invalid Key' });

        // Validate inputs
        const safeFolder = String(folder || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const safeFilename = String(filename || '').replace(/[^a-zA-Z0-9_.\-]/g, '');
        if (!safeFolder || !safeFilename) return res.status(400).json({ error: 'Invalid folder or filename' });
        // Files land in PUBLIC/uploads and are served from the app's origin, so only image
        // and video types are accepted (never .html/.svg/.js), and never into a private
        // folder (resumes).
        if (!allowedExtension(safeFilename)) return res.status(400).json({ error: 'File type not allowed' });
        if (PRIVATE_UPLOAD_DIRS.some((d) => d.prefix === `/uploads/${safeFolder.toLowerCase()}/`)) {
            return res.status(400).json({ error: 'Folder not allowed' });
        }
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
        if (!syncKeyValid(apiKey)) return res.status(403).json({ error: 'Invalid Key' });
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
        if (!syncKeyValid(apiKey)) return res.status(403).json({ error: 'Invalid Key' });
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
        const { table, lastSync, since, factoryId, afterId } = req.query;
        if (!syncKeyValid(req.get(SYNC_KEY_HEADER))) return res.status(403).json({ error: 'Invalid Key' });
        if (!TABLES_TO_PULL.includes(table)) return res.status(400).json({ error: 'Invalid Table' });

        // afterId is the keyset tiebreaker: the id of the last row the client
        // already has at the `since` timestamp. Lets pagination page through a
        // block of rows sharing an identical updated_at. Parsed as an integer;
        // anything non-numeric is ignored (falls back to updated_at-only paging).
        const parsedAfterId = Number.parseInt(afterId, 10);
        const afterIdArg = Number.isFinite(parsedAfterId) ? parsedAfterId : null;
        // A full-replication LOCAL asks for every factory by sending factoryId=all; treat
        // that (and any blank/non-numeric value) as "no factory filter". A numeric value
        // still scopes to that one factory (normal per-factory LOCAL).
        const rows = await getChanges(table, since || lastSync, normalizePullFactoryScope(factoryId), afterIdArg);
        res.json({ ok: true, data: await coerceDateColumnsForWire(table, rows) });
    } catch (e) {
        console.error('[Sync] Pull Serve Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/pull-deletions', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { since, factoryId, afterId } = req.query;
        if (!syncKeyValid(req.get(SYNC_KEY_HEADER))) return res.status(403).json({ error: 'Invalid Key' });

        // factoryId=all (full replication) → no factory filter; numeric → that factory only.
        // afterId pages through large deletion batches (older LOCALs omit it: first page only).
        const deletions = await getDeletionChanges(since, normalizePullFactoryScope(factoryId), parseAfterIdParam(afterId));
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
            full_replication: FULL_REPLICATION,
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

// Readiness probe for full replication: is the key-conversion guard satisfied, and which
// tables (if any) still block it. Read-only; safe to call on any server. Use this to decide
// whether it's safe to set FULL_REPLICATION=1 on a LOCAL before actually doing so.
router.get('/full-replication-readiness', (req, res) => {
    const { safe, offenders } = assertFullReplicationSafe();
    res.json({
        ok: true,
        server_type: SERVER_TYPE,
        full_replication_enabled: FULL_REPLICATION,
        guard_safe: safe,
        blocking_tables: offenders,
        note: safe
            ? 'All LOCAL-writable sync tables use collision-free keys; FULL_REPLICATION=1 on a LOCAL will be honoured.'
            : 'Convert the blocking_tables off the serial id key before enabling full replication.'
    });
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
router.get('/health', async (_req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'Service initializing' });
    try {
        const STALE_MS = Number(process.env.SYNC_STALE_THRESHOLD_MS || 2 * 60 * 60 * 1000);
        const cfg = await getServerConfigSnapshot();
        const stamps = [cfg.LAST_SYNC, cfg.LAST_PUSH, cfg.LAST_PULL]
            .map(v => (v ? new Date(v).getTime() : 0)).filter(t => t > 0);
        const newest = stamps.length ? Math.max(...stamps) : 0;
        const ageMs = newest ? (Date.now() - newest) : null;
        const stale = newest === 0 || ageMs > STALE_MS;
        res.json({
            ok: !stale,
            last_sync: cfg.LAST_SYNC || null, last_push: cfg.LAST_PUSH || null, last_pull: cfg.LAST_PULL || null,
            age_minutes: ageMs != null ? Math.round(ageMs / 60000) : null,
            threshold_minutes: Math.round(STALE_MS / 60000),
            reason: stale ? (newest === 0 ? 'no sync activity yet' : `last sync ${Math.round(ageMs / 60000)}m ago`) : 'healthy'
        });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/admin/full-pull-reset', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Service initializing' });
    try {
        const { apiKey } = req.body || {};
        if (!syncKeyValid(apiKey)) return res.status(403).json({ error: 'Invalid Key' });
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
        if (!syncKeyValid(apiKey)) return res.status(403).json({ error: 'Invalid Key' });
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

const DATE_TZ_BACKFILL_MARKER = 'DATE_TZ_BACKFILL_V1';
const DATE_TZ_BACKFILL_LOCK = 918273645;

// One-time repair (MAIN only) for rows synced BEFORE the DATE-wire fix
// (see coerceDateColumnsForWire). Old pushes serialized DATE columns as UTC
// instants, so on MAIN's UTC session every synced date landed one calendar day
// early. This shifts those pre-fix rows +1 day across every synced DATE column,
// exactly once, inside a single all-or-nothing transaction. LOCAL is the source
// of truth and is never touched. A server_config marker plus a transaction-scoped
// advisory lock guard against double-application (a second run would push +2).
async function ensureDateTimezoneBackfill() {
    if (SERVER_TYPE !== 'MAIN') return; // LOCAL/STANDALONE dates are authoritative

    let alreadyDone = false;
    try {
        const r = await pool.query('SELECT value FROM server_config WHERE key = $1', [DATE_TZ_BACKFILL_MARKER]);
        alreadyDone = r.rows.length > 0 && !!r.rows[0].value;
    } catch (e) {
        console.warn('[Sync] Date-TZ backfill marker check failed; skipping:', e.message);
        return;
    }
    if (alreadyDone) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Serialize against a concurrent boot so the shift can never run twice.
        await client.query('SELECT pg_advisory_xact_lock($1)', [DATE_TZ_BACKFILL_LOCK]);

        // Re-check under the lock: another worker may have completed the backfill
        // between our first read and acquiring the lock.
        const mk = await client.query('SELECT value FROM server_config WHERE key = $1', [DATE_TZ_BACKFILL_MARKER]);
        if (mk.rows.length > 0 && mk.rows[0].value) {
            await client.query('COMMIT');
            return;
        }

        // Rows written before this instant came from the old (broken) code and are
        // shifted -1 day. Anything the fixed code writes carries updated_at >= now
        // and is left untouched, so the run is race-free even if a push lands mid-way.
        const cutoff = (await client.query('SELECT NOW() AS c')).rows[0].c;
        console.log(`[Sync] Date-TZ backfill starting (MAIN); +1 day on pre-fix rows, cutoff=${cutoff.toISOString()}`);

        let totalRows = 0;
        let totalTables = 0;
        for (const table of SYNC_ALL) {
            if (!(await tableExistsPublic(table))) continue;
            const dateCols = await getDateColumns(table);
            if (dateCols.size === 0) continue;
            const hasUpdatedAt = await tableHasColumn(table, 'updated_at');

            const setClause = [...dateCols].map((c) => `"${c}" = "${c}" + 1`).join(', ');
            const sql = `UPDATE "${table}" SET ${setClause}${hasUpdatedAt ? ' WHERE updated_at < $1' : ''}`;
            const res = await client.query(sql, hasUpdatedAt ? [cutoff] : []);
            if (res.rowCount > 0) {
                totalRows += res.rowCount;
                totalTables += 1;
                console.log(`[Sync] Date-TZ backfill: ${table} +1 day on ${res.rowCount} row(s) [${[...dateCols].join(', ')}]`);
            }
        }

        await client.query(
            `INSERT INTO server_config (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [DATE_TZ_BACKFILL_MARKER, new Date().toISOString()]
        );
        await client.query('COMMIT');
        console.log(`[Sync] Date-TZ backfill complete: ${totalRows} row(s) across ${totalTables} table(s). Marker set.`);
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[Sync] Date-TZ backfill failed; rolled back, will retry next boot:', e.message);
    } finally {
        client.release();
    }
}

async function init(dbPool) {
    pool = dbPool;
    try {
        let config = await getServerConfigSnapshot().catch((e) => {
            console.warn('[Sync] Config read before schema check skipped:', e.message);
            return {};
        });

        await ensureSyncRuntimeSchema(config);
        // Background: must not hold up the first sync cycle or the app.
        ensureSyncUpdatedAtIndexes().catch((e) => {
            console.warn('[Sync] updated_at index build failed:', e.message);
        });
        if (Object.keys(config).length === 0) {
            config = await getServerConfigSnapshot().catch(() => ({}));
        }

        if (config.SERVER_TYPE) SERVER_TYPE = config.SERVER_TYPE;
        if (config.MAIN_SERVER_URL) MAIN_SERVER_URL = config.MAIN_SERVER_URL;
        if (config.LOCAL_FACTORY_ID) LOCAL_FACTORY_ID = parseInt(config.LOCAL_FACTORY_ID, 10);
        // env var wins; server_config is only a fallback for legacy LOCAL servers without .env entry
        if (!process.env.SYNC_API_KEY && config.SYNC_API_KEY) API_KEY = config.SYNC_API_KEY;

        // Full replication: requested via env (or server_config fallback), but ONLY armed on
        // a LOCAL after the safety guard confirms no LOCAL-writable table still keys on `id`.
        const fullReplRequested = readBooleanEnv('FULL_REPLICATION')
            || ['1', 'true', 'yes', 'on'].includes(String(config.FULL_REPLICATION || '').trim().toLowerCase());
        FULL_REPLICATION = false;
        if (fullReplRequested && SERVER_TYPE === 'LOCAL') {
            const { safe, offenders } = assertFullReplicationSafe();
            if (safe) {
                FULL_REPLICATION = true;
                console.log('[Sync] FULL REPLICATION ENABLED — this LOCAL will pull ALL factories\' data.');
            } else {
                console.error(`[Sync] FULL REPLICATION REQUESTED BUT BLOCKED: ${offenders.length} table(s) still key sync on the serial id and would collide across factories. Running in normal per-factory mode. Convert these first: ${offenders.join(', ')}`);
            }
        } else if (fullReplRequested) {
            console.log(`[Sync] FULL_REPLICATION requested but ignored (only applies to LOCAL; this is ${SERVER_TYPE}).`);
        }

        console.log(`[Sync] Init. Type: ${SERVER_TYPE}, Factory: ${LOCAL_FACTORY_ID}, Main: ${MAIN_SERVER_URL}, FullReplication: ${FULL_REPLICATION}`);
        console.log('[Sync] Service Version: v4.8 (No echo re-stamp, id-cursor paging for all tables + deletions, updated_at indexes, fetch timeouts)');

        await ensureDateTimezoneBackfill();

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

// Heal servers that already absorbed explicit-id rows before resyncSerialSequence
// existed and are sitting on a stale sequence right now (symptom: every insert the
// app attempts fails with duplicate key on <table>_pkey). Cheap and idempotent, so
// it runs on every boot — deliberately placed ahead of the schema-version early
// return, which would otherwise skip it on already-provisioned servers.
async function resyncIdKeyedSequences() {
    const idKeyedTables = Object.entries(CONFLICT_KEYS)
        .filter(([, key]) => key.split(',').map((c) => c.trim()).includes('id'))
        .map(([table]) => table);
    for (const table of idKeyedTables) {
        await resyncSerialSequence(table);
    }
    if (idKeyedTables.length) {
        console.log(`[Sync] Sequence resync checked ${idKeyedTables.length} id-keyed table(s).`);
    }
}

async function ensureSyncRuntimeSchema(config = {}) {
    await resyncIdKeyedSequences();
    await ensureSyncTouchFunctions();

    if (!shouldForceSyncSchemaEnsure() && config[SYNC_SCHEMA_READY_KEY] === SYNC_SCHEMA_READY_VERSION) {
        console.log('[Sync] Schema already verified; skipping startup schema sweep.');
        return;
    }

    await ensureSyncUpdatedAtSchema();
    await ensureSyncIdSchema();
    await ensureSyncConflictIndexes();
    await ensureDeleteTrackingSchema();
    await ensureSyncOutboxSchema();

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
// POST a batch of rows to MAIN. Returns {ok, error} instead of throwing so
// callers can decide whether to record the rows in the outbox.
async function pushRowsToMain(table, rows) {
    let wireRows = await coerceDateColumnsForWire(table, rows);
    wireRows = await coerceJsonColumnsForWire(table, wireRows);
    const payload = { factoryId: LOCAL_FACTORY_ID, table, data: wireRows, apiKey: API_KEY };
    try {
        const response = await fetch(`${MAIN_SERVER_URL}/api/sync/push`, withSyncTimeout({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }));
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        // MAIN returns HTTP 200 even when individual rows fail to upsert
        // (stats.failed > 0). Surface that count so the caller can park the
        // batch for retry instead of silently advancing the watermark past
        // rows that never actually landed.
        let body = null;
        try { body = await response.json(); } catch (e) { body = null; }
        const partialFailed = body && body.stats ? Number(body.stats.failed) || 0 : 0;
        return { ok: true, partialFailed };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// Park rows that could not reach MAIN so they are retried on later cycles.
// Keyed by (table, record_pk): a newer edit of the same row overwrites the
// stale payload rather than creating a duplicate outbox entry.
async function recordFailedRows(table, rows, errMsg) {
    if (!rows || rows.length === 0) return;
    const err = String(errMsg || '').slice(0, 500);
    for (const row of rows) {
        const pk = rowRecordPk(table, row);
        if (!pk) continue;
        try {
            await pool.query(
                `INSERT INTO sync_failed_rows (table_name, record_pk, payload, attempts, last_error)
                 VALUES ($1, $2, $3, 1, $4)
                 ON CONFLICT (table_name, record_pk)
                 DO UPDATE SET payload = EXCLUDED.payload,
                               attempts = sync_failed_rows.attempts + 1,
                               last_error = EXCLUDED.last_error,
                               updated_at = NOW()`,
                [table, pk, JSON.stringify(row), err]
            );
        } catch (e) {
            console.error(`[Sync] Could not record failed row for ${table}:`, e.message);
        }
    }
    console.warn(`[Sync] Parked ${rows.length} unsent row(s) for ${table} in outbox (will retry next cycle).`);
}

// Re-push previously-failed rows before the normal watermark push, so nothing
// is lost when a cycle advanced LAST_PUSH past a row that never reached MAIN.
async function drainOutbox() {
    const stats = { retried: 0, recovered: 0, stillFailed: 0 };
    const DRAIN_LIMIT = 500;
    let tables;
    try {
        const r = await pool.query('SELECT DISTINCT table_name FROM sync_failed_rows');
        tables = r.rows.map((x) => x.table_name);
    } catch (e) {
        return stats; // outbox table not present yet (very old server) — nothing to drain
    }

    for (const table of tables) {
        if (!TABLES_TO_PUSH.includes(table)) continue;
        if (SERVER_TYPE === 'LOCAL' && LOCAL_NO_PUSH_TABLES.includes(table)) continue;

        let res;
        try {
            res = await pool.query(
                `SELECT id, payload FROM sync_failed_rows WHERE table_name = $1 ORDER BY id ASC LIMIT ${DRAIN_LIMIT}`,
                [table]
            );
        } catch (e) {
            console.error(`[Sync] Outbox read failed for ${table}:`, e.message);
            continue;
        }
        if (res.rows.length === 0) continue;

        const ids = res.rows.map((r) => r.id);
        const rows = res.rows.map((r) => r.payload);
        stats.retried += rows.length;

        const result = await pushRowsToMain(table, rows);
        // Only clear parked rows when MAIN accepted them AND reported no
        // row-level failures. A partial failure (HTTP 200 + stats.failed > 0)
        // means the rows still did not land, so keep them for the next retry.
        if (result.ok && !result.partialFailed) {
            await pool.query('DELETE FROM sync_failed_rows WHERE id = ANY($1::bigint[])', [ids]).catch((e) => {
                console.error(`[Sync] Outbox cleanup failed for ${table}:`, e.message);
            });
            stats.recovered += rows.length;
            console.log(`[Sync] Outbox recovered ${rows.length} row(s) for ${table}.`);
        } else {
            const errMsg = result.partialFailed
                ? `MAIN reported ${result.partialFailed} partial failure(s)`
                : result.error;
            stats.stillFailed += rows.length;
            await pool.query(
                'UPDATE sync_failed_rows SET attempts = attempts + 1, last_error = $2, updated_at = NOW() WHERE id = ANY($1::bigint[])',
                [ids, String(errMsg || '').slice(0, 500)]
            ).catch(() => {});
            console.warn(`[Sync] Outbox retry still failing for ${table}: ${errMsg}`);
        }
    }

    return stats;
}

async function pushTableAllBatches(table, lastPush) {
    const PUSH_BATCH_SIZE = 100;
    const stats = { pushed: 0, failed: 0 };
    const hasFactoryId = await tableHasColumn(table, 'factory_id');
    // Pagination strategy:
    //   When the table has an integer `id` primary key we page by ID, using the
    //   updated_at watermark only as a FILTER (updated_at > lastPush). This is
    //   immune to two problems that broke updated_at-cursor paging:
    //     1. Bulk regenerations stamp tens of thousands of rows with an identical
    //        updated_at; an updated_at-only cursor jumps past that timestamp after
    //        the first batch and permanently SKIPS the rest.
    //     2. node-postgres reads timestamptz into a JS Date truncated to
    //        millisecond precision, while Postgres stores microseconds. A cursor
    //        derived from that truncated Date (updated_at > cursor) re-matches the
    //        same sub-millisecond rows forever → an infinite push loop.
    //   The id cursor strictly increases and never repeats or skips a row.
    //   lastPush comes from server_config as a full-precision string, so the
    //   watermark boundary itself is exact (no truncation there).
    const hasId = await tableHasColumn(table, 'id');
    let currentSince = lastPush;   // updated_at watermark (filter only)
    let lastId = null;             // id keyset cursor
    let batchNum = 0;

    while (true) {
        batchNum += 1;
        let rows;
        try {
            const where = ['updated_at > $1'];
            const params = [currentSince];
            if (hasId && lastId !== null) { params.push(lastId); where.push(`id > $${params.length}`); }
            if (hasFactoryId) { params.push(LOCAL_FACTORY_ID); where.push(`factory_id = $${params.length}`); }
            const orderClause = hasId ? 'ORDER BY id ASC' : 'ORDER BY updated_at ASC';

            const sql = `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ${orderClause} LIMIT ${PUSH_BATCH_SIZE}`;
            const result = await pool.query(sql, params);
            rows = result.rows;
        } catch (err) {
            console.error(`[Sync] Push query failed ${table} batch ${batchNum}:`, err.message);
            stats.failed += 1;
            break;
        }

        if (rows.length === 0) break;

        if (batchNum > 1) {
            console.log(`[Sync] Pushing ${rows.length} rows for ${table} (batch ${batchNum}, afterId=${lastId})...`);
        } else {
            console.log(`[Sync] Pushing ${rows.length} rows for ${table}...`);
        }

        const result = await pushRowsToMain(table, rows);
        if (!result.ok) {
            console.error(`[Sync] Push failed ${table} batch ${batchNum}: ${result.error}`);
            stats.failed += rows.length;
            // Park the unsent rows so they are retried next cycle instead of
            // being skipped once LAST_PUSH advances past them. Then stop so a
            // bad table cannot block the rest of the push cycle.
            await recordFailedRows(table, rows, result.error);
            break;
        }

        stats.pushed += rows.length;

        // MAIN accepted the request (HTTP 200) but reported that some rows
        // failed to upsert. Park those so drainOutbox retries them next cycle
        // rather than losing them once LAST_PUSH advances. Keep going through
        // the remaining batches — the failure is row-level, not table-level.
        if (result.partialFailed > 0) {
            stats.failed += result.partialFailed;
            await recordFailedRows(table, rows, `MAIN reported ${result.partialFailed} partial failure(s)`);
        }

        if (rows.length < PUSH_BATCH_SIZE) break; // last batch — no more rows

        const lastRow = rows[rows.length - 1];
        if (hasId) {
            // id strictly increases → always forward progress, never re-matches.
            if (lastRow.id === undefined || lastRow.id === null || lastRow.id === lastId) break;
            lastId = lastRow.id;
        } else {
            const lastUpdatedAt = lastRow?.updated_at;
            if (!lastUpdatedAt || lastUpdatedAt <= currentSince) break; // safety: no forward progress
            currentSince = lastUpdatedAt;
        }
    }

    return stats;
}

async function pushChanges() {
    const stats = { pushed: 0, failed: 0 };

    // Retry anything parked from previous failed cycles first, so a row that
    // missed its watermark window is recovered rather than lost forever.
    const drained = await drainOutbox().catch((e) => {
        console.error('[Sync] Outbox drain failed:', e.message);
        return { retried: 0, recovered: 0, stillFailed: 0 };
    });
    stats.pushed += drained.recovered;
    stats.failed += drained.stillFailed;

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
    // Rows that failed to reach MAIN are not lost: pushTableAllBatches parked
    // them in the sync_failed_rows outbox and drainOutbox() retries them at the
    // start of every cycle until they succeed.
    await setServerConfigValue('LAST_PUSH', cycleWatermark);
    if (stats.failed > 0) {
        console.warn(`[Sync] LAST_PUSH advanced; ${stats.failed} row(s) parked in outbox for retry next cycle.`);
    }
    return stats;
}

async function pushDeletionChanges() {
    const stats = { deleted: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PUSH'`);
    const lastPush = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    // Page through every tombstone newer than the watermark (id cursor). The old code sent
    // only the first DELETE_BATCH_LIMIT and then advanced the watermark, so a bulk delete
    // larger than one batch never reached MAIN beyond its first 1000 rows.
    let afterId = null;
    for (;;) {
        const page = await getDeletionChanges(lastPush, LOCAL_FACTORY_ID, afterId);
        if (page.length === 0) break;

        // On LOCAL servers, never push deletions for auth-authoritative tables.
        const deletions = (SERVER_TYPE === 'LOCAL' && LOCAL_NO_PUSH_TABLES.length)
            ? page.filter((d) => !LOCAL_NO_PUSH_TABLES.includes(d.table))
            : page;

        if (deletions.length > 0) {
            console.log(`[Sync] Pushing ${deletions.length} deletions...`);
            let response;
            try {
                response = await fetch(`${MAIN_SERVER_URL}/api/sync/push-deletions`, withSyncTimeout({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deletions, apiKey: API_KEY })
                }));
            } catch (error) {
                console.error('[Sync] Push Deletions Request Failed:', error.message);
                stats.failed += deletions.length;
                break;
            }

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                console.error('[Sync] Push Deletions Failed:', text);
                stats.failed += deletions.length;
                break;
            }
            stats.deleted += deletions.length;
        }

        if (page.length < DELETE_BATCH_LIMIT) break;
        const nextAfterId = maxRowId(page);
        if (nextAfterId === null || (afterId !== null && nextAfterId <= afterId)) break; // no forward progress
        afterId = nextAfterId;
    }

    // Hold the watermark when a batch failed so those tombstones are retried next cycle.
    // (Previously it always advanced, and failed deletions were lost for good.) MAIN
    // applies tombstones idempotently, so re-sending the ones that did land is harmless.
    if (stats.failed === 0) {
        await setServerConfigValue('LAST_DELETE_PUSH', cycleWatermark);
    } else {
        console.warn(`[Sync] LAST_DELETE_PUSH kept at ${lastPush} because ${stats.failed} deletion(s) failed to push — retrying next cycle.`);
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
//
//   With `onPage`, each page is handed to the callback as soon as it arrives and is NOT
//   kept in memory — pullChanges upserts page by page. Accumulating a whole table first
//   (up to 136k notification rows in one cycle) held tens of MB in the web process and
//   coincided with a measured 10 s event-loop freeze. Without `onPage` the rows are
//   returned as one array (tests / small callers).
async function pullTableAllPages(table, since, onPage = null) {
    const PAGE_LIMIT = 1000; // must match LIMIT in getChanges() on MAIN
    const allData = [];
    // `since` (the updated_at watermark) stays FIXED for the whole pagination;
    // MAIN pages by id (ORDER BY id) when the table has an id column, so only the
    // id cursor advances. Advancing `since` mid-pagination would wrongly drop rows
    // whose updated_at is <= the last row's timestamp but id is beyond the cursor.
    // Paging by id is immune to identical-timestamp blocks and to millisecond
    // truncation of timestamps that broke the previous updated_at cursor.
    let currentAfterId = null; // id keyset cursor
    let usedIdCursor = false;
    let currentSince = since;  // only advances in the no-id fallback path
    let pageNum = 0;

    while (true) {
        pageNum += 1;
        let url = `${MAIN_SERVER_URL}/api/sync/pull?table=${encodeURIComponent(table)}&since=${encodeURIComponent(currentSince)}&factoryId=${encodeURIComponent(localPullFactoryParam())}`;
        if (currentAfterId !== null) url += `&afterId=${encodeURIComponent(currentAfterId)}`;
        const response = await fetchWithSyncRetry(url, `Pull ${table} page ${pageNum}`, { headers: syncPullHeaders() });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Pull ${table} page ${pageNum} HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }

        const json = await response.json();
        const rows = json.data || [];
        if (onPage) {
            if (rows.length > 0) await onPage(rows);
        } else {
            allData.push(...rows);
        }

        if (rows.length < PAGE_LIMIT) break; // this was the last page

        const lastRow = rows[rows.length - 1];
        const lastId = maxRowId(rows);

        if (lastId !== null) {
            // id keyset: keep `since` fixed, advance only afterId. The cursor must strictly
            // increase; if it doesn't, MAIN is not honouring afterId (e.g. an older build
            // that fell back to an updated_at-ordered query) and further pages would just
            // repeat rows, so stop instead of looping.
            if (usedIdCursor && lastId <= currentAfterId) {
                console.warn(`[Sync] Pull ${table}: page ${pageNum} did not advance the id cursor (${lastId} <= ${currentAfterId}); stopping pagination.`);
                break;
            }
            currentAfterId = lastId;
            usedIdCursor = true;
            console.log(`[Sync] Pull ${table} page ${pageNum} (${rows.length} rows). Fetching more afterId ${lastId}...`);
        } else {
            // No id column: fall back to updated_at cursor (strict forward progress
            // required to avoid looping on a same-timestamp block).
            const lastUpdatedAt = lastRow?.updated_at;
            if (!lastUpdatedAt || lastUpdatedAt <= currentSince) break;
            currentSince = lastUpdatedAt;
            console.log(`[Sync] Pull ${table} page ${pageNum} (${rows.length} rows). Fetching more since ${lastUpdatedAt}...`);
        }
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

            let pulled = 0;
            await pullTableAllPages(table, lastPull, async (rows) => {
                pulled += rows.length;
                const pageStats = await upsertData(table, rows);
                stats.created += pageStats.created;
                stats.updated += pageStats.updated;
                stats.failed += pageStats.failed;
            });
            if (pulled > 0) console.log(`[Sync] Pulled ${pulled} rows for ${table}...`);
        } catch (e) {
            console.error(`[Sync] Pull Failed ${table}:`, e.message);
            stats.failed += 1;
        }
    }

    // Repair assembly_scans.plan_id to the LOCAL plan identified by the stable
    // plan_sync_id. A scan pulled from another server carries that server's serial
    // plan_id, which points at a different (or missing) plan here; plan_sync_id is
    // the durable link, so re-resolve plan_id from it after every pull.
    await reconcileAssemblyScanLinks();

    if (stats.failed === 0) {
        await setServerConfigValue('LAST_PULL', cycleWatermark);
    } else {
        console.warn(`[Sync] LAST_PULL kept at ${lastPull} because ${stats.failed} pull error(s) occurred — failed rows will retry next cycle.`);
    }
    return stats;
}

// Re-point assembly_scans.plan_id at the local plan row that shares the scan's
// plan_sync_id. Serial ids diverge across MAIN/LOCAL, so this keeps the scan->plan
// link locally correct after sync without a cross-server serial FK.
async function reconcileAssemblyScanLinks() {
    try {
        if (!(await tableExistsPublic('assembly_scans'))) return;
        if (!(await tableHasColumn('assembly_scans', 'plan_sync_id'))) return;
        await pool.query(`
            UPDATE assembly_scans s
               SET plan_id = p.id
              FROM assembly_plans p
             WHERE s.plan_sync_id = p.sync_id
               AND s.plan_id IS DISTINCT FROM p.id
        `);
    } catch (e) {
        console.warn('[Sync] reconcileAssemblyScanLinks skipped:', e.message);
    }
}

async function pullDeletionChanges() {
    const stats = { deleted: 0, failed: 0 };
    const res = await pool.query(`SELECT value FROM server_config WHERE key = 'LAST_DELETE_PULL'`);
    const lastPull = res.rows.length ? res.rows[0].value : '1970-01-01';
    const cycleWatermark = await getDatabaseNowIso();

    try {
        // Page with an id cursor so a bulk delete larger than one batch is fully applied
        // before LAST_DELETE_PULL advances. An older MAIN ignores afterId and repeats its
        // first page; the strict-progress check below stops that after one extra request.
        let afterId = null;
        let pageNum = 0;
        for (;;) {
            pageNum += 1;
            let url = `${MAIN_SERVER_URL}/api/sync/pull-deletions?since=${encodeURIComponent(lastPull)}&factoryId=${encodeURIComponent(localPullFactoryParam())}`;
            if (afterId !== null) url += `&afterId=${encodeURIComponent(afterId)}`;
            const response = await fetchWithSyncRetry(url, `Pull deletions page ${pageNum}`, { headers: syncPullHeaders() });
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

            if (deletions.length < DELETE_BATCH_LIMIT) break;
            const nextAfterId = maxRowId(deletions);
            if (nextAfterId === null || (afterId !== null && nextAfterId <= afterId)) break;
            afterId = nextAfterId;
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

// Stable identity for a row, used as the outbox de-dup key. Mirrors the
// conflict-key logic so a retried row upserts onto the same target row on MAIN.
function rowRecordPk(table, row) {
    const columns = getConflictColumns(table, row);
    if (columns.length === 1) {
        return String(row?.[columns[0]] ?? row?.id ?? '');
    }
    const key = {};
    columns.forEach((col) => { key[col] = row?.[col] ?? null; });
    return JSON.stringify(key);
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

// Re-align a table's serial sequence with the highest id actually present.
//
// WHY: for tables whose sync conflict key IS 'id' (see CONFLICT_KEYS —
// plan_job_card_approval_history, jobs_queue, planning_drops, ...), the upsert
// keeps the incoming 'id' in the INSERT so MAIN's ids are reproduced verbatim on
// LOCAL. An INSERT that supplies the serial column explicitly does NOT advance
// the sequence, so LOCAL's nextval stays far behind the ids it just absorbed.
// The next row the app itself creates then draws an id that is already taken:
//   duplicate key value violates unique constraint "<table>_pkey"
// That surfaced as approvals failing on the factory LOCAL server — the INSERT
// into plan_job_card_approval_history is inside the approval transaction, so the
// whole approve rolled back and the plan stayed stuck in Pending.
//
// Fully error-guarded: a failure here must never cost us data that would
// otherwise land. Tables with no serial-backed sequence (pg_get_serial_sequence
// returns NULL) are a no-op.
//
// Pass `client` to run inside an open transaction — the call is then wrapped in a
// savepoint so a failure rolls back only the setval, leaving the batch intact.
// Without a client it runs standalone on the pool.
async function resyncSerialSequence(table, column = 'id', client = null) {
    const sql = `SELECT setval(seq, COALESCE((SELECT MAX(${column}) FROM ${table}), 0) + 1, false)
                   FROM pg_get_serial_sequence($1, $2) AS seq
                  WHERE seq IS NOT NULL`;
    const params = [table, column];

    if (!client) {
        try {
            await pool.query(sql, params);
        } catch (seqErr) {
            console.warn(`[Sync] Sequence resync failed for ${table}.${column} (non-fatal):`, seqErr.message);
        }
        return;
    }

    let savepointActive = false;
    try {
        await client.query('SAVEPOINT sync_seq_resync');
        savepointActive = true;
        await client.query(sql, params);
        await client.query('RELEASE SAVEPOINT sync_seq_resync');
    } catch (seqErr) {
        console.warn(`[Sync] Sequence resync failed for ${table}.${column} (non-fatal):`, seqErr.message);
        if (savepointActive) {
            try {
                await client.query('ROLLBACK TO SAVEPOINT sync_seq_resync');
                await client.query('RELEASE SAVEPOINT sync_seq_resync');
            } catch (cleanupErr) {
                // Re-throw: the transaction is now in an aborted state and the
                // caller's COMMIT would silently fail otherwise.
                console.error(`[Sync] Sequence savepoint cleanup failed for ${table}:`, cleanupErr.message);
                throw cleanupErr;
            }
        }
    }
}

async function upsertData(table, data) {
    if (!data.length) return { created: 0, updated: 0, failed: 0 };

    const MAX_RETRIES = 3;
    let attempt = 0;
    const stats = { created: 0, updated: 0, failed: 0, skipped: 0 };
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
            // LOCAL applying rows pulled from MAIN: keep MAIN's updated_at (see SYNC_APPLY_FLAG).
            if (SERVER_TYPE === 'LOCAL') await markSyncApply(client);

            // Set when at least one row in this batch carried an explicit 'id'
            // into the INSERT — those bypass nextval and leave the sequence stale.
            let sawExplicitId = false;

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

                // Coerce json/jsonb array values before INSERT. node-postgres sends JS
                // arrays as Postgres array literals ("{...}"), not JSON, which causes
                // "invalid input syntax for type json" on jsonb columns like
                // plan_board.colour_details. Stringify any object/array so PG accepts it.
                const jsonColsForRow = await getJsonColumns(table);
                if (jsonColsForRow.size > 0) {
                    for (const col of jsonColsForRow) {
                        const v = row[col];
                        if (v !== null && v !== undefined && typeof v === 'object') {
                            row[col] = JSON.stringify(v);
                        }
                    }
                }

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

                if (row && row.id != null && conflictColumns.includes('id')) {
                    sawExplicitId = true;
                }

                const keys = Object.keys(row);
                const vals = Object.values(row);
                if (keys.length === 0) {
                    stats.failed += 1;
                    continue;
                }
                const idx = keys.map((_, i) => `$${i + 1}`);
                const setClause = keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ');
                const conflictKey = RAW_CONFLICT_TARGETS[table] || conflictColumns.join(', ');

                // plan_board resurrection guard. When a plan was deleted on THIS server,
                // the incoming row hits no ON CONFLICT target and would be re-INSERTed —
                // silently resurrecting a plan the user removed, which drives the
                // LOCAL<->MAIN create/delete churn. If a tombstone for this plan_id is at
                // least as new as the incoming row's own edit, the delete wins: skip it.
                // A row edited strictly AFTER the delete (updated_at > deleted_at) is a
                // genuine newer intent and still passes through.
                if (table === 'plan_board') {
                    // record_pk format transitioned with the composite (plan_id, factory_id)
                    // conflict key: NEW tombstones are JSON ({"plan_id":..,"factory_id":..}),
                    // while tombstones written before the change are the bare plan_id string.
                    // Match BOTH, and scope by factory so a delete on one factory's plan never
                    // suppresses a different factory's same-numbered plan.
                    const tomb = await client.query(
                        `SELECT 1 FROM sync_deletions
                          WHERE table_name = 'plan_board'
                            AND deleted_at >= COALESCE($2::timestamptz, deleted_at)
                            AND (
                                  record_pk = $1
                               OR (left(record_pk, 1) = '{' AND (record_pk::jsonb->>'plan_id') = $1)
                            )
                            AND (factory_id IS NULL OR $3::int IS NULL OR factory_id = $3::int)
                          LIMIT 1`,
                        [String(row.plan_id), row.updated_at ?? null, row.factory_id ?? null]
                    );
                    if (tomb.rowCount > 0) {
                        stats.skipped += 1;
                        continue;
                    }
                }

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

                        // --- external unique-token deconfliction ---
                        // Applies to ANY table that carries one or more UNIQUE indexes on
                        // "sync token" columns (sync_id, global_id) created by the app schema
                        // outside the sync service, while the sync upsert keys on a natural
                        // key instead.
                        // Symptom: the natural-key upsert fails with 23505 on a token column's
                        // unique index because a DIFFERENT local row already owns the token
                        // value MAIN considers authoritative for this natural key.
                        // A single row can collide on MORE THAN ONE token — e.g. shift_teams
                        // has unique sync_id AND global_id — so we reassign each colliding
                        // token in turn (nested savepoints so a second collision doesn't undo
                        // the first reassignment) and retry until the upsert succeeds.
                        // Generalized (was whitelisted to shift_teams / sync_id only): the
                        // guard is now the shape of the failure — a unique violation on a token
                        // column not in the conflict target — so new tables need no whitelist.
                        const deconflictTokenCols = DECONFLICT_TOKEN_COLUMNS.filter(
                            (c) => row && row[c] != null && !conflictColumns.includes(c)
                        );
                        if (innerErr.code === '23505' && deconflictTokenCols.length) {
                            let deconflictActive = false;
                            try {
                                await client.query('SAVEPOINT sync_deconflict_token');
                                deconflictActive = true;
                                let lastErr = innerErr;
                                let handled = false;
                                const triedCols = new Set();
                                // At most one reassignment per token column is ever required.
                                for (let attempt = 0; attempt < deconflictTokenCols.length; attempt++) {
                                    const constraintStr = String(lastErr.constraint || lastErr.detail || '').toLowerCase();
                                    // Prefer the column named by the failing constraint; otherwise
                                    // fall back to the next untried candidate.
                                    const col = deconflictTokenCols.find((c) => !triedCols.has(c) && constraintStr.includes(c))
                                        || deconflictTokenCols.find((c) => !triedCols.has(c));
                                    if (!col) break;
                                    triedCols.add(col);
                                    // Free the token value the incoming row wants by reassigning
                                    // whichever existing local row currently holds it.
                                    await client.query(
                                        `UPDATE ${table} SET ${col} = gen_random_uuid() WHERE ${col} = $1`,
                                        [row[col]]
                                    );
                                    // Retry under an inner savepoint so a further 23505 (a second
                                    // colliding token) doesn't abort the reassignments already made.
                                    await client.query('SAVEPOINT sync_deconflict_retry');
                                    try {
                                        const result2 = await client.query(sql, vals);
                                        await client.query('RELEASE SAVEPOINT sync_deconflict_retry');
                                        if (result2.rows.length && result2.rows[0].inserted === true) {
                                            stats.created += 1;
                                        } else if (result2.rows.length) {
                                            stats.updated += 1;
                                        }
                                        handled = true;
                                        break;
                                    } catch (retryErr) {
                                        await client.query('ROLLBACK TO SAVEPOINT sync_deconflict_retry');
                                        await client.query('RELEASE SAVEPOINT sync_deconflict_retry');
                                        lastErr = retryErr;
                                        if (retryErr.code !== '23505') throw retryErr; // not a dup — give up
                                    }
                                }
                                if (handled) {
                                    await client.query('RELEASE SAVEPOINT sync_deconflict_token');
                                    deconflictActive = false;
                                    continue; // row handled — move on to the next one
                                }
                                throw lastErr; // exhausted token reassignments
                            } catch (deconflictErr) {
                                if (deconflictActive) {
                                    try {
                                        await client.query('ROLLBACK TO SAVEPOINT sync_deconflict_token');
                                        await client.query('RELEASE SAVEPOINT sync_deconflict_token');
                                    } catch (cleanupErr) {
                                        console.error('[Sync] Deconflict savepoint cleanup failed:', cleanupErr.message);
                                        throw cleanupErr;
                                    }
                                }
                                console.error(`[Sync] token deconflict fallback failed for ${table}:`, deconflictErr.message);
                                // Fall through to the generic error log below
                            }
                        }
                        // -------------------------------------------------------

                        console.error(`[Sync] Row Error in ${table}:`, innerErr.message);
                        console.error('Failed Row:', JSON.stringify(row));
                        stats.failed += 1;
                    }
            }

            // Explicit-id rows in this batch bypassed nextval, leaving the sequence
            // behind the data. Re-align it BEFORE COMMIT, not after: between COMMIT
            // and a post-commit setval there is a window where the new rows are
            // visible but the sequence is still stale, and an app INSERT landing in
            // that window draws an id that is already taken — the exact duplicate-key
            // failure this fix exists to prevent.
            //
            // Running inside the transaction is safe because sequence operations are
            // non-transactional in Postgres: setval takes effect immediately and is
            // NOT rolled back if this transaction later aborts. So the sequence can
            // only ever end up too high (harmless — ids are opaque), never too low.
            // MAX(id) here sees this transaction's own uncommitted rows, which is
            // precisely the value we need.
            //
            // Savepoint-guarded so a setval failure cannot abort the whole batch.
            if (sawExplicitId) {
                await resyncSerialSequence(table, 'id', client);
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

async function getChanges(table, since, targetFactoryId, afterId) {
    if (!(await tableExistsPublic(table))) {
        return [];
    }

    let sql = `SELECT * FROM ${table}`;
    const params = [];
    const where = [];
    const normalizedSince = normalizeSyncTimestampInput(since);
    const hasUpdatedAt = await tableHasColumn(table, 'updated_at');
    // When the table has an integer `id` primary key we page by ID (cursor =
    // afterId), using updated_at only as a filter. This is immune to (1) blocks
    // of rows sharing an identical updated_at being skipped once the cursor
    // advances past that timestamp, and (2) millisecond-truncation of timestamps
    // (JS Date / JSON ISO strings only carry ms, Postgres stores microseconds) —
    // an updated_at cursor re-matches sub-ms rows forever. The id cursor strictly
    // increases, so no row is skipped or repeated.
    const hasId = await tableHasColumn(table, 'id');

    if (normalizedSince && hasUpdatedAt) {
        params.push(normalizedSince);
        where.push(`updated_at > $${params.length}`);
    }

    if (hasId && afterId !== null && afterId !== undefined) {
        params.push(afterId);
        where.push(`id > $${params.length}`);
    }

    // Global master tables are NOT scoped to a factory — every LOCAL server should
    // receive the complete set regardless of factory_id assignment. Tables without a
    // factory_id column (e.g. notifications) are served unscoped too. Filtering them on
    // factory_id used to fail with 42703 and drop into a fallback query that ignored the
    // afterId cursor, so every "page" returned roughly the same 1000 rows and the LOCAL
    // re-pulled the table 70-136 times per cycle.
    const hasFactoryId = await tableHasColumn(table, 'factory_id');
    if (targetFactoryId && hasFactoryId && !GLOBAL_MASTER_TABLES.has(table)) {
        params.push(targetFactoryId);
        where.push(`(factory_id = $${params.length} OR factory_id IS NULL)`);
    }

    if (where.length) {
        sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += hasId ? ' ORDER BY id ASC LIMIT 1000' : ' ORDER BY updated_at ASC LIMIT 1000';

    const rows = await pool.query(sql, params);
    return rows.rows;
}

// Pages by the serial id (deleted_at is only a filter), like getChanges does for rows.
// A single bulk delete stamps every tombstone with the same deleted_at, so a
// deleted_at cursor would skip the rest of that block once the first page advanced
// past it. `id` is returned so callers can pass it back as afterId.
async function getDeletionChanges(since, targetFactoryId, afterId = null) {
    const params = [];
    const where = [];
    const normalizedSince = normalizeSyncTimestampInput(since);

    if (normalizedSince) {
        params.push(normalizedSince);
        where.push(`deleted_at > $${params.length}`);
    }

    if (afterId !== null && afterId !== undefined) {
        params.push(afterId);
        where.push(`id > $${params.length}`);
    }

    if (targetFactoryId) {
        params.push(targetFactoryId);
        where.push(`(factory_id = $${params.length} OR factory_id IS NULL)`);
    }

    let sql = `
        SELECT id, table_name AS table, record_pk, factory_id, deleted_at
        FROM sync_deletions
    `;

    if (where.length) {
        sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ` ORDER BY id ASC LIMIT ${DELETE_BATCH_LIMIT}`;
    const result = await pool.query(sql, params);
    return result.rows;
}

function parseAfterIdParam(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

// Largest numeric `id` in a page, or null. Used to advance an id cursor.
function maxRowId(rows) {
    let max = null;
    for (const row of rows) {
        if (row?.id === null || row?.id === undefined || row.id === '') continue;
        const id = Number(row.id);
        if (Number.isFinite(id) && (max === null || id > max)) max = id;
    }
    return max;
}

async function applyRemoteDeletions(deletions) {
    if (!Array.isArray(deletions) || deletions.length === 0) return { deleted: 0, failed: 0 };

    const client = await pool.connect();
    const stats = { deleted: 0, failed: 0, skipped: 0 };
    try {
        await client.query('BEGIN');

        for (const deletion of deletions) {
            const table = deletion.table;
            if (!TABLES_TO_PUSH.includes(table)) continue;

            const keyValues = parseDeletionRecordPk(table, deletion.record_pk);
            if (!keyValues) {
                // Legacy/malformed record_pk that can't be resolved against this table's
                // current conflict key — e.g. old single-id (UUID) tombstones for a table
                // since migrated to a multi-column composite key. We genuinely can't
                // identify the target row, so skip it instead of failing. A hard failure
                // here makes the whole batch return 500, which stalls the sender's delete
                // watermark and re-pushes the same un-appliable rows forever.
                stats.skipped += 1;
                console.warn(`[Sync] Skipping unresolvable deletion for ${table} (record_pk=${deletion.record_pk})`);
                continue;
            }

            // Isolate every deletion in a SAVEPOINT. A type-incompatible key (e.g. an old
            // integer id "7" pushed against a table whose key column is now uuid) makes the
            // failing statement abort the WHOLE transaction at the Postgres level (25P02),
            // even when we catch the JS error. That aborted state then fails the next query,
            // rolls back the entire batch, and stalls LAST_DELETE_PULL so the same rows
            // re-pull every cycle forever. The savepoint lets one bad row be skipped cleanly.
            await client.query('SAVEPOINT sync_del');
            try {
                const factoryScope = deletion.factory_id == null ? '__global__' : String(deletion.factory_id);
                await client.query(`
                    INSERT INTO sync_deletions (table_name, record_pk, factory_id, factory_scope, deleted_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (table_name, record_pk, factory_scope) DO NOTHING
                `, [table, deletion.record_pk, deletion.factory_id ?? null, factoryScope, deletion.deleted_at || new Date().toISOString()]);

                const entries = Object.entries(keyValues);
                if (!entries.length) {
                    await client.query('RELEASE SAVEPOINT sync_del');
                    continue;
                }

                const params = entries.map(([, value]) => value);
                const where = entries.map(([column], index) => `${column} = $${index + 1}`).join(' AND ');

                const result = await client.query(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`, params);
                const existingRow = result.rows[0] || null;

                if (existingRow && existingRow.updated_at && deletion.deleted_at) {
                    const rowUpdatedAt = new Date(existingRow.updated_at).getTime();
                    const deletedAt = new Date(deletion.deleted_at).getTime();
                    if (Number.isFinite(rowUpdatedAt) && Number.isFinite(deletedAt) && rowUpdatedAt > deletedAt) {
                        await client.query('RELEASE SAVEPOINT sync_del');
                        continue;
                    }
                }

                const deleteResult = await client.query(`DELETE FROM ${table} WHERE ${where}`, params);
                stats.deleted += deleteResult.rowCount || 0;
                await client.query('RELEASE SAVEPOINT sync_del');
            } catch (e) {
                // Roll this single deletion back to the savepoint so the transaction stays
                // usable and the batch can still commit + advance the watermark.
                await client.query('ROLLBACK TO SAVEPOINT sync_del');
                stats.skipped += 1;
                // Pass external values as %s args (not in the format-string position)
                // so an unexpected % in record_pk can't be treated as a format specifier.
                console.warn('[Sync] Deletion skipped for %s (record_pk=%s): %s', table, deletion.record_pk, e.message);
            }
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

// Durable outbox so a row that fails to reach MAIN (network blip, HTTP 5xx,
// mid-batch outage) is retried on later cycles instead of being silently
// skipped once LAST_PUSH advances past it. Stores the full row payload so the
// retry is self-contained and order-independent.
async function ensureSyncOutboxSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sync_failed_rows (
            id BIGSERIAL PRIMARY KEY,
            table_name TEXT NOT NULL,
            record_pk TEXT NOT NULL,
            payload JSONB NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 1,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (table_name, record_pk)
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sync_failed_rows_table
        ON sync_failed_rows (table_name)
    `);
    console.log('[Sync] Failed-row outbox ready');
}

// Session flag the sync applier sets (transaction-local) while writing rows pulled from
// MAIN. The updated_at triggers leave such rows' updated_at exactly as MAIN sent it.
//
// Why: the triggers used to re-stamp every row the applier wrote with the LOCAL's NOW(),
// so a row received from MAIN looked freshly edited, was pushed straight back, MAIN
// re-stamped it on arrival, and the next pull brought it back again — every edited row
// bounced forever (measured: the same 5,634 plan_board rows each 2-3 min cycle). Keeping
// MAIN's timestamp on the LOCAL ends that: the row is re-pushed at most once, and MAIN's
// upsert guard (EXCLUDED.updated_at > existing) ignores an equal timestamp.
//
// MAIN deliberately does NOT set the flag: its arrival re-stamp is what makes a pushed row
// visible to every OTHER server's pull watermark (other factories, global tables, full
// replication). Keeping the sender's older timestamp there would hide late pushes.
const SYNC_APPLY_FLAG = 'jms.sync_apply';

async function markSyncApply(client) {
    await client.query(`SELECT set_config('${SYNC_APPLY_FLAG}', 'on', true)`);
}

function buildTouchFunctionSql(name) {
    return `
        CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
        BEGIN
            IF current_setting('${SYNC_APPLY_FLAG}', true) = 'on' THEN
                RETURN NEW;
            END IF;
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `;
}

// Runs on every boot (not behind the schema-version marker): it is cheap, idempotent, and
// servers that already passed the one-time sweep still need the flag-aware bodies.
// update_updated_at_column() is a legacy per-table trigger (7 tables, from an old DB
// restore, not defined in this repo) that also re-stamps updated_at; it only gets the
// flag-aware body where it already exists.
async function ensureSyncTouchFunctions() {
    try {
        await pool.query(buildTouchFunctionSql('touch_sync_updated_at_column'));
        const legacy = await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column' LIMIT 1`);
        if (legacy.rowCount > 0) {
            await pool.query(buildTouchFunctionSql('update_updated_at_column'));
        }
    } catch (e) {
        // Several PM2 workers may replace the function at once ("tuple concurrently
        // updated"); one of them wins, which is all that is needed.
        console.warn('[Sync] updated_at trigger function refresh skipped:', e.message);
    }
}

const SYNC_INDEX_LOCK_KEY = 918273646; // one index builder across PM2 workers

// Every push, pull page and pending count filters on `updated_at > $since`. Only 2 of 81
// sync tables had an index on it, so each of those queries was a full table scan
// (measured on factory-1: hundreds of millions of rows read per day on std_actual,
// notifications and dpr_hourly). Built CONCURRENTLY so reads and writes carry on; runs in
// the background after init because the first build on a large table takes a while.
// An interrupted CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would keep
// skipping, so invalid leftovers are dropped and rebuilt.
async function ensureSyncUpdatedAtIndexes() {
    const client = await pool.connect();
    let locked = false;
    try {
        const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [SYNC_INDEX_LOCK_KEY]);
        locked = lock.rows[0]?.ok === true;
        if (!locked) return; // another worker is on it

        let built = 0;
        for (const table of SYNC_ALL) {
            try {
                if (!(await tableExistsPublic(table))) continue;
                if (!(await tableHasColumn(table, 'updated_at'))) continue;
                const indexName = `idx_sync_updated_at_${table}`.slice(0, 63);
                const existing = await client.query(
                    `SELECT i.indisvalid
                       FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                      WHERE c.relname = $1 AND c.relkind = 'i'`,
                    [indexName]
                );
                if (existing.rowCount > 0 && existing.rows[0].indisvalid) continue;
                if (existing.rowCount > 0) {
                    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
                }
                await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${table} (updated_at)`);
                built += 1;
            } catch (e) {
                console.warn(`[Sync] updated_at index skipped for ${table}:`, e.message);
            }
        }
        if (built > 0) console.log(`[Sync] Built ${built} updated_at index(es) for sync tables.`);
    } finally {
        if (locked) await client.query('SELECT pg_advisory_unlock($1)', [SYNC_INDEX_LOCK_KEY]).catch(() => {});
        client.release();
    }
}

async function ensureSyncUpdatedAtSchema() {
    await pool.query(buildTouchFunctionSql('touch_sync_updated_at_column'));

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

// Backfill NULL sync_ids from a deterministic md5(business columns) -> uuid so the same
// physical row derives an identical id on MAIN and every LOCAL (avoids duplication on the
// first full-replication pull), then repair any collisions the seed produced by handing
// duplicates a fresh random id. Only columns that actually exist on the table are used, so
// a seed listing an optional column is safe. Same md5->uuid shape as the notifications /
// assembly_plans branches. [[project_full_replication_all_locals]]
async function backfillDeterministicSyncId(table, seedColumns) {
    const present = [];
    for (const col of seedColumns) {
        if (await tableHasColumn(table, col)) present.push(col);
    }
    // Fall back to random if none of the seed columns exist (schema drift) — better a
    // valid unique id than a NULL that blocks the unique index.
    if (present.length === 0) {
        await pool.query(`UPDATE ${table} SET sync_id = gen_random_uuid() WHERE sync_id IS NULL`);
        return;
    }
    await pool.query(`
        WITH source AS (
            SELECT id, md5(concat_ws('|', ${present.map((c) => `COALESCE(${c}::text, '')`).join(', ')})) AS seed
              FROM ${table}
             WHERE sync_id IS NULL
        )
        UPDATE ${table} t
           SET sync_id = (
               substr(source.seed, 1, 8) || '-' ||
               substr(source.seed, 9, 4) || '-' ||
               substr(source.seed, 13, 4) || '-' ||
               substr(source.seed, 17, 4) || '-' ||
               substr(source.seed, 21, 12)
           )::uuid
          FROM source
         WHERE t.id = source.id
    `);
    // Two genuinely distinct rows can share a seed (identical business columns AND
    // created_at). Give the later row(s) a fresh random id so the unique index can build.
    await pool.query(`
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY sync_id ORDER BY id) AS rn
              FROM ${table} WHERE sync_id IS NOT NULL
        )
        UPDATE ${table} t SET sync_id = gen_random_uuid()
          FROM ranked r WHERE t.id = r.id AND r.rn > 1
    `);
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
                // Drop the obsolete natural-key unique index left by older packages.
                // notifications identity is now sync_id (uq_sync_id_notifications, created
                // below); the stale uq_sync_conflict_notifications on
                // (target_user, type, title, created_at) is no longer in SYNC_CONFLICT_INDEXES
                // and, where it lingers, rejects incoming rows that carry a fresh sync_id but
                // repeat those four columns — failing the pull every cycle and pinning
                // LAST_PULL. Removing it lets sync_id be the sole identity.
                await pool.query('DROP INDEX IF EXISTS uq_sync_conflict_notifications');
            } else if (table === 'assembly_plans') {
                // Deterministic backfill from stable business columns so the SAME
                // pre-existing plan on MAIN and a LOCAL derives the SAME sync_id and
                // dedups, instead of two random ids that the new key would treat as
                // distinct rows (duplicates). Same md5->uuid shape as notifications.
                await pool.query(`
                    WITH source AS (
                        SELECT id,
                               md5(concat_ws('|',
                                   COALESCE(table_id, ''),
                                   COALESCE(item_name, ''),
                                   COALESCE(plan_qty::text, ''),
                                   COALESCE(machine, ''),
                                   COALESCE(start_time::text, ''),
                                   COALESCE(created_by, ''),
                                   COALESCE(created_at::text, '')
                               )) AS seed
                          FROM ${table}
                         WHERE sync_id IS NULL
                    )
                    UPDATE ${table} t
                       SET sync_id = (
                           substr(source.seed, 1, 8) || '-' ||
                           substr(source.seed, 9, 4) || '-' ||
                           substr(source.seed, 13, 4) || '-' ||
                           substr(source.seed, 17, 4) || '-' ||
                           substr(source.seed, 21, 12)
                       )::uuid
                      FROM source
                     WHERE t.id = source.id
                `);
                await pool.query(`
                    WITH ranked AS (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY sync_id ORDER BY id) AS rn
                          FROM ${table} WHERE sync_id IS NOT NULL
                    )
                    UPDATE ${table} t SET sync_id = gen_random_uuid()
                      FROM ranked r WHERE t.id = r.id AND r.rn > 1
                `);
            } else if (table === 'assembly_scans') {
                // Scans link to plans by the plan's stable sync_id, not the serial
                // plan_id (which diverges across servers). Ensure the link column,
                // drop the invalid cross-server serial FK, backfill the link from the
                // local plan, then derive a deterministic sync_id for the scan.
                if (!(await tableHasColumn('assembly_scans', 'plan_sync_id'))) {
                    await pool.query('ALTER TABLE assembly_scans ADD COLUMN plan_sync_id UUID');
                    tableColumnCache.delete('assembly_scans');
                }
                await pool.query('ALTER TABLE assembly_scans DROP CONSTRAINT IF EXISTS fk_plan');
                await pool.query(`
                    UPDATE assembly_scans s
                       SET plan_sync_id = p.sync_id
                      FROM assembly_plans p
                     WHERE s.plan_id = p.id AND s.plan_sync_id IS NULL
                `);
                await pool.query(`
                    WITH source AS (
                        SELECT id,
                               md5(concat_ws('|',
                                   COALESCE(plan_sync_id::text, ''),
                                   COALESCE(scanned_ean, ''),
                                   COALESCE(timestamp::text, '')
                               )) AS seed
                          FROM ${table}
                         WHERE sync_id IS NULL
                    )
                    UPDATE ${table} t
                       SET sync_id = (
                           substr(source.seed, 1, 8) || '-' ||
                           substr(source.seed, 9, 4) || '-' ||
                           substr(source.seed, 13, 4) || '-' ||
                           substr(source.seed, 17, 4) || '-' ||
                           substr(source.seed, 21, 12)
                       )::uuid
                      FROM source
                     WHERE t.id = source.id
                `);
                await pool.query(`
                    WITH ranked AS (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY sync_id ORDER BY id) AS rn
                          FROM ${table} WHERE sync_id IS NOT NULL
                    )
                    UPDATE ${table} t SET sync_id = gen_random_uuid()
                      FROM ranked r WHERE t.id = r.id AND r.rn > 1
                `);
            } else if (table === 'wip_outward_logs') {
                // Outward logs link to their parent wip_inventory row by the parent's stable
                // sync_id, not the serial wip_inventory_id (which is minted independently on
                // MAIN and every LOCAL). Ensure the link column, drop the invalid cross-server
                // serial FK, backfill the link from the local inventory row, then derive a
                // deterministic sync_id for the log. Same shape as assembly_scans.
                if (!(await tableHasColumn('wip_outward_logs', 'wip_inventory_sync_id'))) {
                    await pool.query('ALTER TABLE wip_outward_logs ADD COLUMN wip_inventory_sync_id UUID');
                    tableColumnCache.delete('wip_outward_logs');
                }
                await pool.query('ALTER TABLE wip_outward_logs DROP CONSTRAINT IF EXISTS wip_outward_logs_wip_inventory_id_fkey');
                await pool.query(`
                    UPDATE wip_outward_logs l
                       SET wip_inventory_sync_id = i.sync_id
                      FROM wip_inventory i
                     WHERE l.wip_inventory_id = i.id AND l.wip_inventory_sync_id IS NULL
                `);
                await pool.query(`
                    WITH source AS (
                        SELECT id,
                               md5(concat_ws('|',
                                   COALESCE(wip_inventory_sync_id::text, ''),
                                   COALESCE(qty::text, ''),
                                   COALESCE(to_location, ''),
                                   COALESCE(receiver_name, ''),
                                   COALESCE(created_by, ''),
                                   COALESCE(created_at::text, '')
                               )) AS seed
                          FROM wip_outward_logs
                         WHERE sync_id IS NULL
                    )
                    UPDATE wip_outward_logs t
                       SET sync_id = (
                           substr(source.seed, 1, 8) || '-' ||
                           substr(source.seed, 9, 4) || '-' ||
                           substr(source.seed, 13, 4) || '-' ||
                           substr(source.seed, 17, 4) || '-' ||
                           substr(source.seed, 21, 12)
                       )::uuid
                      FROM source
                     WHERE t.id = source.id
                `);
                await pool.query(`
                    WITH ranked AS (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY sync_id ORDER BY id) AS rn
                          FROM wip_outward_logs WHERE sync_id IS NOT NULL
                    )
                    UPDATE wip_outward_logs t SET sync_id = gen_random_uuid()
                      FROM ranked r WHERE t.id = r.id AND r.rn > 1
                `);
            } else if (SYNC_ID_SEED_COLUMNS[table]) {
                await backfillDeterministicSyncId(table, SYNC_ID_SEED_COLUMNS[table]);
            } else {
                await pool.query(`UPDATE ${table} SET sync_id = gen_random_uuid() WHERE sync_id IS NULL`);
            }

            await pool.query(`ALTER TABLE ${table} ALTER COLUMN sync_id SET DEFAULT gen_random_uuid()`);
            // Skipped when an equivalent unique index already exists (e.g. the table's
            // <table>_sync_id_key constraint) — see src/db/indexUtils.js.
            await ensureUniqueIndex((t, p) => pool.query(t, p), { table, columns: 'sync_id', name: `uq_sync_id_${table}` });
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
            // ON CONFLICT needs *a* unique index on these columns; reuse the table's own
            // unique constraint when it already has one instead of adding a twin.
            await ensureUniqueIndex((t, p) => pool.query(t, p), { table, columns, name: indexName });
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

async function getDateColumns(table) {
    if (dateColumnCache.has(table)) return dateColumnCache.get(table);

    let columns = new Set();
    try {
        const result = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'date'
        `, [table]);
        columns = new Set(result.rows.map((row) => row.column_name));
    } catch (e) {
        console.warn(`[Sync] Could not read date columns for ${table}:`, e.message);
    }
    dateColumnCache.set(table, columns);
    return columns;
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

// A DATE column carries no time-of-day, but the pg driver hands it back as a JS
// Date at local midnight. JSON.stringify then emits a UTC *instant* — e.g. the
// IST date 2026-07-05 becomes "2026-07-04T18:30:00.000Z". When the receiving
// server's Postgres session runs a different timezone (Hostinger MAIN defaults to
// UTC) it truncates that instant back to a DATE and lands one calendar day early,
// so every synced dpr_date/plan date silently shifts −1 day. Sending the value as
// a bare 'YYYY-MM-DD' string is timezone-immune: it inserts as the same day on any
// session. Idempotent for values already in 'YYYY-MM-DD' form (drained outbox rows).
function toWireDateString(value) {
    if (value == null) return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Rewrite DATE columns to bare 'YYYY-MM-DD' strings before a row crosses the sync
// wire, so timezone differences between LOCAL and MAIN cannot shift the calendar day.
// Only touches columns whose Postgres type is exactly `date` — timestamp/timestamptz
// (e.g. updated_at) are left intact so watermark comparisons stay precise.
async function coerceDateColumnsForWire(table, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const dateCols = await getDateColumns(table);
    if (dateCols.size === 0) return rows;

    return rows.map((row) => {
        let clone = null;
        for (const col of dateCols) {
            if (Object.prototype.hasOwnProperty.call(row, col) && row[col] != null) {
                if (!clone) clone = { ...row };
                clone[col] = toWireDateString(row[col]);
            }
        }
        return clone || row;
    });
}

// Names of json / jsonb columns for a table (cached). Used to serialize array
// values before sending to MAIN — see coerceJsonColumnsForWire.
async function getJsonColumns(table) {
    if (jsonColumnCache.has(table)) return jsonColumnCache.get(table);
    let columns = new Set();
    try {
        const result = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
              AND data_type IN ('json', 'jsonb')
        `, [table]);
        columns = new Set(result.rows.map((row) => row.column_name));
    } catch (e) {
        console.error(`[Sync] getJsonColumns failed for ${table}:`, e.message);
    }
    jsonColumnCache.set(table, columns);
    return columns;
}

function toWireJsonString(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

// node-postgres binds a JS ARRAY parameter as a Postgres array literal ("{...}"),
// NOT as JSON. So a jsonb column holding an array (e.g. plan_board.colour_details,
// plan_audit_logs.details, mould_audit_logs.changed_fields) fails MAIN's upsert
// with `invalid input syntax for type json`. Plain objects are auto-stringified by
// node-pg and bind fine. To make arrays (and objects) bind reliably, stringify all
// non-null json/jsonb values on the SEND side so MAIN always receives a JSON string.
async function coerceJsonColumnsForWire(table, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const jsonCols = await getJsonColumns(table);
    if (jsonCols.size === 0) return rows;
    return rows.map((row) => {
        let clone = null;
        for (const col of jsonCols) {
            const value = row[col];
            if (value !== null && value !== undefined && typeof value === 'object') {
                if (!clone) clone = { ...row };
                clone[col] = toWireJsonString(value);
            }
        }
        return clone || row;
    });
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
    jsonColumnCache.clear();
}

// Effective full-replication state (env/config requested AND the startup guard passed).
// The app read-path uses this to decide whether a LOCAL box may serve other factories'
// data — never the raw env var, which is only the *request*.
function isFullReplicationActive() {
    return FULL_REPLICATION === true;
}

module.exports = {
    init,
    router,
    triggerSync,
    isFullReplicationActive,
    __test: {
        fetchWithSyncRetry,
        pullChanges,
        pullTableAllPages,
        pushTableAllBatches,
        drainOutbox,
        recordFailedRows,
        rowRecordPk,
        pushRowsToMain,
        coerceJsonColumnsForWire,
        upsertData,
        setRuntimeForTests,
        findFullReplicationKeyOffenders,
        assertFullReplicationSafe,
        normalizePullFactoryScope,
        localPullFactoryParam,
        getChanges,
        getDeletionChanges,
        pushDeletionChanges,
        pullDeletionChanges,
        ensureSyncTouchFunctions,
        buildTouchFunctionSql,
        maxRowId
    }
};
