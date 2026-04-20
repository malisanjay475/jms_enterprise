# JMS Sync Certification Matrix

This is the fast coverage map for bidirectional VPS <-> local server sync.

Status meanings:
- `Verified Live`: proven with live create/delete testing.
- `Enabled`: included in the sync engine with create, update, and delete paths.
- `Needs QA`: enabled in sync, but still needs module-specific live screen testing.
- `Excluded by Design`: internal/system tables that should not be mirrored between sites.

## Verified Live

| Module | Tables | Status |
| --- | --- | --- |
| Planning Board | `plan_board` | Verified Live |

## Enabled Core Modules

| Module | Tables | Status |
| --- | --- | --- |
| Settings | `app_settings` | Needs QA |
| Factories / Access | `factories`, `roles`, `users`, `user_factories` | Needs QA |
| Orders / Planning | `orders`, `plan_board`, `plan_history`, `plan_audit_logs`, `planning_drops`, `job_cards`, `jobs_queue`, `jc_details`, `jc_summaries`, `or_jr_report`, `order_completion_history` | Needs QA |
| Mould / Machine Masters | `moulds`, `mould_audit_logs`, `machines`, `machine_audit_logs`, `machine_operators`, `machine_status_logs` | Needs QA |
| DPR / Production | `dpr_hourly`, `dpr_reasons`, `grinding_logs`, `std_actual`, `operator_history` | Needs QA |
| Assembly | `assembly_lines`, `assembly_plans`, `assembly_scans` | Needs QA |
| Purchase / Vendor | `purchase_orders`, `purchase_order_items`, `dispatch_items`, `grn_entries`, `vendors`, `vendor_users`, `vendor_dispatch`, `vendor_payments` | Needs QA |
| QC | `qc_deviations`, `qc_issue_memos`, `qc_online_reports`, `qc_training_sheets` | Needs QA |
| WIP | `wip_inventory`, `wip_outward_logs`, `wip_stock_movements`, `wip_stock_snapshots`, `wip_stock_snapshot_lines` | Needs QA |
| Shifting | `shift_teams`, `shifting_records` | Needs QA |
| Raw Material | `raw_material_issues` | Needs QA |
| Closed Plant | `closed_plants` | Needs QA |
| BOM | `bom_master`, `bom_components` | Needs QA |

## Excluded by Design

These are internal/system tables and are intentionally not part of local factory bidirectional sync:

| Table | Reason |
| --- | --- |
| `local_servers` | Main-server control plane data |
| `local_server_heartbeats` | Main-server node monitoring data |
| `server_config` | Site-local runtime configuration |
| `sync_deletions` | Sync engine bookkeeping |
| `erp_sync_log` | Integration log / audit trail |
| `ai_memory` | AI/internal context memory |

## Important Notes

- The sync engine now auto-adds `updated_at` tracking for operational tables that previously only had `created_at` or `changed_at`.
- Enabled does not mean every UI screen is fully certified yet. Some screens write multiple tables and still need a live create/edit/delete walkthrough.
- For a true production sign-off, every enabled module should be tested with:
  - local create -> VPS
  - local edit -> VPS
  - local delete -> VPS
  - VPS create -> local
  - VPS edit -> local
  - VPS delete -> local
