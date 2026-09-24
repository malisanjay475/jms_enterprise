-- Drop exact-duplicate indexes (Sep-2026 audit): 94 redundant indexes in 81 groups on
-- factory-1 (~65 MB), e.g. dpr_hourly carried 22 indexes with 3 twins. Every write and
-- every sync upsert paid for all of them.
--
-- Each pair drops `drop_name` ONLY when, on THIS server:
--   * both indexes exist and `keep_name` is valid,
--   * they are on the same table with an identical definition (key columns, order,
--     expressions, predicate, operator classes, sort options),
--   * `drop_name` does not back a constraint / primary key,
--   * dropping a UNIQUE index leaves a UNIQUE twin (ON CONFLICT targets keep working).
-- Otherwise the pair is skipped, so servers whose schema differs are left alone.
-- Boot code that used to re-create these names now uses ensureUniqueIndex (skips when an
-- equivalent unique index exists) or no longer creates them (see this PR), so they stay gone.
-- Rollback: re-create any index with its old CREATE [UNIQUE] INDEX statement (in git history).
CREATE OR REPLACE FUNCTION pg_temp.jms_drop_duplicate_index(p_drop text, p_keep text, p_dry boolean)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  d_oid regclass := to_regclass('public.' || quote_ident(p_drop));
  k_oid regclass := to_regclass('public.' || quote_ident(p_keep));
  d pg_index%ROWTYPE;
  k pg_index%ROWTYPE;
BEGIN
  IF d_oid IS NULL THEN RETURN 'absent'; END IF;
  IF k_oid IS NULL THEN RETURN 'skip: keep index missing'; END IF;
  SELECT * INTO d FROM pg_index WHERE indexrelid = d_oid;
  SELECT * INTO k FROM pg_index WHERE indexrelid = k_oid;
  IF d.indexrelid IS NULL OR k.indexrelid IS NULL THEN RETURN 'skip: not an index'; END IF;
  IF d.indrelid <> k.indrelid THEN RETURN 'skip: different tables'; END IF;
  IF NOT k.indisvalid THEN RETURN 'skip: keep index invalid'; END IF;
  IF d.indkey::text <> k.indkey::text
     OR d.indclass::text <> k.indclass::text
     OR d.indoption::text <> k.indoption::text
     OR COALESCE(pg_get_expr(d.indexprs, d.indrelid), '') <> COALESCE(pg_get_expr(k.indexprs, k.indrelid), '')
     OR COALESCE(pg_get_expr(d.indpred, d.indrelid), '') <> COALESCE(pg_get_expr(k.indpred, k.indrelid), '')
  THEN RETURN 'skip: definitions differ'; END IF;
  IF d.indisunique AND NOT k.indisunique THEN RETURN 'skip: would lose uniqueness'; END IF;
  IF d.indisprimary OR EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = d_oid) THEN
    RETURN 'skip: backs a constraint';
  END IF;
  IF p_dry THEN RETURN 'would drop'; END IF;
  -- DROP INDEX briefly takes an exclusive lock on the table. Never queue behind a long
  -- query (everything else on that table would wait too): give up after 3 s and keep the
  -- harmless duplicate instead.
  BEGIN
    EXECUTE format('DROP INDEX %I', p_drop);
  EXCEPTION WHEN lock_not_available THEN
    RETURN 'skip: table busy';
  END;
  RETURN 'dropped';
END
$fn$;

DO $$
DECLARE
  r record;
  result text;
  dropped int := 0;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true); -- this transaction only
  FOR r IN SELECT * FROM (VALUES
    ('assembly_plans', 'idx_assembly_plans_factory', 'idx_assembly_plans_factory_id'),
    ('dpr_hourly', 'idx_dpr_hourly_order', 'idx_dpr_hourly_order_no'),
    ('dpr_hourly', 'idx_dpr_hourly_factory', 'idx_dpr_hourly_factory_id'),
    ('grinding_logs', 'idx_grinding_order', 'idx_grinding_logs_order_no'),
    ('jc_details', 'idx_jc_details_key', 'jc_details_unique_key_idx'),
    ('jc_details', 'idx_jc_details_factory', 'idx_jc_details_factory_id'),
    ('jc_summaries', 'idx_jc_summaries_factory', 'idx_jc_summaries_factory_id'),
    ('machine_status_logs', 'idx_machine_status_logs_factory_id', 'idx_machine_status_logs_factory'),
    ('machines', 'idx_machines_factory', 'idx_machines_factory_id'),
    ('machines', 'idx_machines_name', 'idx_machines_machine'),
    ('mould_audit_logs', 'idx_mould_audit_logs_mould_id', 'idx_mould_audit_id'),
    ('mould_planning_report', 'idx_mould_planning_report_or_jr_no', 'idx_mpr_order'),
    ('mould_planning_summary', 'idx_mps_or_jr_no', 'idx_summary_or_jr_no'),
    ('mould_planning_summary', 'idx_mould_planning_summary_or_jr_no', 'idx_summary_or_jr_no'),
    ('mould_planning_summary', 'idx_mould_planning_summary_factory', 'idx_mould_planning_summary_factory_id'),
    ('moulds', 'idx_moulds_factory', 'idx_moulds_factory_id'),
    ('moulds', 'idx_moulds_mould_number', 'idx_moulds_erp_item'),
    ('moulds', 'idx_moulds_erp_code', 'idx_moulds_erp_item'),
    ('notifications', 'idx_notif_user', 'idx_notifications_target_user'),
    ('operator_history', 'idx_operator_history_factory_id', 'idx_operator_history_factory'),
    ('or_jr_report', 'idx_or_jr_report_or_jr_no', 'idx_or_jr_report_no'),
    ('or_jr_report', 'idx_or_jr_no_main', 'idx_or_jr_report_no'),
    ('or_jr_report', 'idx_or_jr_report_factory', 'idx_or_jr_report_factory_id'),
    ('orders', 'idx_orders_factory', 'idx_orders_factory_id'),
    ('plan_board', 'idx_plan_board_factory', 'idx_plan_board_factory_id'),
    ('plan_board', 'idx_plan_board_plan_id', 'idx_plan_board_plan_id_text'),
    ('planning_drops', 'idx_planning_drops_factory', 'idx_planning_drops_factory_id'),
    ('priority_lists', 'idx_priority_lists_factory_id', 'idx_priority_lists_factory'),
    ('purchase_orders', 'idx_purchase_orders_factory_id', 'idx_po_factory'),
    ('purchase_orders', 'idx_po_status', 'idx_purchase_orders_status'),
    ('qc_deviations', 'idx_qc_deviations_factory_id', 'idx_qc_deviations_factory'),
    ('qc_issue_memos', 'idx_qc_issue_memos_factory_id', 'idx_qc_issue_memos_factory'),
    ('qc_online_reports', 'idx_qc_online_reports_factory_id', 'idx_qc_online_reports_factory'),
    ('qc_training_sheets', 'idx_qc_training_sheets_factory_id', 'idx_qc_training_sheets_factory'),
    ('raw_material_issues', 'idx_raw_material_issues_status', 'idx_rm_issues_status'),
    ('raw_material_issues', 'idx_raw_material_issues_factory_id', 'idx_rm_issues_factory_id'),
    ('raw_material_issues', 'idx_raw_material_issues_plan_id', 'idx_rm_issues_plan_id'),
    ('raw_material_issues', 'idx_raw_material_issues_order_no', 'idx_rm_issues_order_no'),
    ('shift_teams', 'idx_shift_teams_factory', 'idx_shift_teams_factory_id'),
    ('shifting_records', 'idx_shifting_records_factory', 'idx_shifting_factory_id'),
    ('shifting_records', 'idx_shifting_records_factory_id', 'idx_shifting_factory_id'),
    ('shifting_records', 'idx_shifting_records_plan_id', 'idx_shifting_plan_id'),
    ('std_actual', 'idx_std_actual_factory', 'idx_std_actual_factory_id'),
    ('vendor_users', 'idx_vendor_users_username', 'vendor_users_username_key'),
    ('wip_inventory', 'idx_wip_inventory_factory', 'idx_wip_inventory_factory_id'),
    ('assembly_plans', 'uq_sync_id_assembly_plans', 'assembly_plans_sync_id_key'),
    ('assembly_plans', 'idx_assembly_plans_sync_id', 'assembly_plans_sync_id_key'),
    ('assembly_scans', 'uq_sync_id_assembly_scans', 'idx_assembly_scans_sync_id'),
    ('dpr_hourly', 'idx_dpr_hourly_sync_id', 'dpr_hourly_sync_id_key'),
    ('dpr_reasons', 'uq_sync_id_dpr_reasons', 'idx_dpr_reasons_sync_id'),
    ('grinding_logs', 'idx_grinding_logs_sync_id', 'uq_sync_id_grinding_logs'),
    ('hr_kra_daily_entries', 'uq_sync_conflict_hr_kra_daily_entries', 'hr_kra_daily_entries_employee_user_id_assignment_item_id_en_key'),
    ('jobs_queue', 'idx_jobs_queue_sync_id', 'uq_sync_id_jobs_queue'),
    ('machine_status_logs', 'idx_machine_status_logs_sync_id', 'machine_status_logs_sync_id_key'),
    ('machine_status_logs', 'uq_sync_id_machine_status_logs', 'machine_status_logs_sync_id_key'),
    ('machines', 'idx_machines_sync_id', 'machines_sync_id_key'),
    ('maintenance_tickets', 'uq_sync_id_maintenance_tickets', 'uq_maintenance_tickets_sync_id'),
    ('maintenance_worklogs', 'uq_sync_id_maintenance_worklogs', 'uq_maintenance_worklogs_sync_id'),
    ('mould_audit_logs', 'uq_sync_id_mould_audit_logs', 'idx_mould_audit_logs_sync_id'),
    ('mould_audit_logs', 'idx_mould_audit_sync_id', 'idx_mould_audit_logs_sync_id'),
    ('mould_planning_summary', 'idx_mould_planning_summary_sync_id', 'mould_planning_summary_sync_id_key'),
    ('mould_verify_notes', 'uq_sync_id_mould_verify_notes', 'idx_mould_verify_notes_sync_id'),
    ('moulds', 'idx_moulds_sync_id', 'moulds_sync_id_key'),
    ('operator_history', 'uq_sync_id_operator_history', 'operator_history_sync_id_key'),
    ('operator_history', 'idx_operator_history_sync_id', 'operator_history_sync_id_key'),
    ('or_jr_report', 'idx_or_jr_report_sync_id', 'or_jr_report_sync_id_key'),
    ('order_completion_history', 'uq_sync_conflict_order_completion_history', 'uq_order_completion_history_sync'),
    ('org_departments', 'uq_org_departments_sync_id', 'uq_sync_id_org_departments'),
    ('org_designations', 'uq_org_designations_sync_id', 'uq_sync_id_org_designations'),
    ('org_grades', 'uq_org_grades_sync_id', 'uq_sync_id_org_grades'),
    ('org_people', 'uq_org_people_sync_id', 'uq_sync_id_org_people'),
    ('org_units', 'uq_org_units_sync_id', 'uq_sync_id_org_units'),
    ('plan_audit_logs', 'idx_audit_created', 'idx_plan_audit_logs_created'),
    ('plan_audit_logs', 'uq_sync_id_plan_audit_logs', 'idx_plan_audit_logs_sync_id'),
    ('plan_board', 'idx_plan_board_sync_id', 'plan_board_sync_id_key'),
    ('planning_drops', 'uq_sync_id_planning_drops', 'planning_drops_sync_id_key'),
    ('planning_drops', 'idx_planning_drops_sync_id', 'planning_drops_sync_id_key'),
    ('qc_deviations', 'idx_qc_deviations_sync_id', 'qc_deviations_sync_id_key'),
    ('qc_deviations', 'uq_sync_id_qc_deviations', 'qc_deviations_sync_id_key'),
    ('qc_issue_memos', 'uq_sync_id_qc_issue_memos', 'qc_issue_memos_sync_id_key'),
    ('qc_issue_memos', 'idx_qc_issue_memos_sync_id', 'qc_issue_memos_sync_id_key'),
    ('qc_online_reports', 'uq_sync_id_qc_online_reports', 'qc_online_reports_sync_id_key'),
    ('qc_online_reports', 'idx_qc_online_reports_sync_id', 'qc_online_reports_sync_id_key'),
    ('qc_training_sheets', 'uq_sync_id_qc_training_sheets', 'idx_qc_training_sheets_sync_id'),
    ('shift_teams', 'idx_shift_teams_sync_id', 'shift_teams_sync_id_key'),
    ('shift_teams', 'uq_sync_conflict_shift_teams', 'shift_teams_line_shift_date_shift_key'),
    ('shifting_records', 'idx_shifting_records_sync_id', 'shifting_records_sync_id_key'),
    ('shifting_records', 'uq_sync_id_shifting_records', 'shifting_records_sync_id_key'),
    ('std_actual', 'uq_sync_conflict_std_actual', 'std_actual_plan_id_shift_dpr_date_machine_key'),
    ('std_actual', 'idx_std_actual_sync_id', 'std_actual_sync_id_key'),
    ('users', 'idx_users_username', 'users_username_key'),
    ('wip_inventory', 'idx_wip_inventory_sync_id', 'uq_sync_id_wip_inventory'),
    ('wip_outward_logs', 'uq_sync_id_wip_outward_logs', 'idx_wip_outward_logs_sync_id')
  ) AS p(tbl, drop_name, keep_name)
  LOOP
    result := pg_temp.jms_drop_duplicate_index(r.drop_name, r.keep_name, false);
    IF result = 'dropped' THEN dropped := dropped + 1; END IF;
    IF result LIKE 'skip:%' THEN RAISE NOTICE 'duplicate index %.%: %', r.tbl, r.drop_name, result; END IF;
  END LOOP;
  RAISE NOTICE 'duplicate indexes dropped: %', dropped;
END
$$;
