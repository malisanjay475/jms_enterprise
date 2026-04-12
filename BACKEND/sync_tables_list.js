
// List of all business tables to be synced bidirectionally
const SYNC_ALL = [
    'assembly_lines',
    'assembly_plans',
    'assembly_scans',
    'bom_components',
    'bom_master',
    'dispatch_items',
    'dpr_hourly',
    'dpr_reasons',
    // 'erp_sync_log', // Log - maybe no need
    'factories',
    'grinding_logs',
    'grn_entries',
    'jc_details',
    'jc_summaries', // Generated?
    'job_cards',
    'jobs_queue',
    'machine_operators',
    'machine_status_logs',
    'machines',
    'mould_audit_logs', // Audit - useful to sync? Yes.
    'mould_planning_report',
    'mould_planning_summary',
    'moulds',
    'operator_history',
    'or_jr_report',
    'orders',
    'plan_audit_logs',
    'plan_board',
    // 'plan_history', // Legacy?
    'planning_drops',
    'purchase_order_items',
    'purchase_orders',
    'qc_deviations',
    'qc_issue_memos',
    'qc_online_reports',
    'qc_training_sheets',
    // 'roles', // Static?
    // 'server_config', // LOCAL ONLY
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

module.exports = SYNC_ALL;
