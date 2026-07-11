# Database — The Data Map

> PostgreSQL `jms_v1` (user `jms_v1`). Tables grouped by the module that owns them.
> Schema is created partly by `BACKEND/migrations/*.sql` and partly by `BACKEND/create_*.js` scripts.
> Almost every table is scoped by `factory_id` for multi-factory support.

---

## Tables by module

### Planning
| Table | Purpose |
|-------|---------|
| `plan_board` | The planning board — jobs scheduled per machine/shift |
| `mould_planning_report` | Mould-level planning report rows |
| `mould_planning_summary` | Aggregated planning summary |
| `or_jr_report` | Order / Job-Requirement report |
| `priority_lists` | Machine job priority ordering |
| `planning_drops` | Dropped/removed plan entries |
| `plan_audit_logs`, `plan_job_card_approval_history` | Planning audit trail |

### Production / DPR
| Table | Purpose |
|-------|---------|
| `dpr_hourly` | Hourly production entries |
| `dpr_labour` | Labour records per DPR |
| `dpr_reasons` | Downtime / loss reasons |
| `jobs_queue`, `orders`, `order_completion_history` | Job & order tracking |
| `job_cards`, `jc_details`, `job_card_label_print_log` | Job cards & label printing |

### Machines & masters
| Table | Purpose |
|-------|---------|
| `machines`, `machine_status_logs`, `machine_audit_logs` | Machines + status/audit |
| `machine_operators`, `operator_history` | Operator assignments |
| `moulds`, `mould_audit_logs` | Moulds + audit |
| `bom_master`, `bom_components` | Bill of materials (ERP) |

### Quality (QC)
| Table | Purpose |
|-------|---------|
| `qc_job_checks`, `qc_job_setup`, `qc_verifications` | Inspections & setup |
| `qc_online_reports`, `qc_online_report_slots` | Online QC reporting |
| `qc_holds`, `qc_deviations`, `qc_issue_memos` | Holds, deviations, memos |
| `qc_material_issues`, `raw_material_issues` | Material issue tracking |
| `qc_shift_team`, `shift_teams`, `qc_training_sheets`, `qc_notifications` | Teams, training, alerts |

### Assembly & shifting
| Table | Purpose |
|-------|---------|
| `assembly_lines`, `assembly_plans`, `assembly_scans` | Assembly tracking |
| `labour_parties` | Labour party master |

### HR
| Table | Purpose |
|-------|---------|
| `hr_employee_profiles` | Employee master |
| `hr_interviews`, `hr_interview_scores` | Interview panel |
| `hr_kra_templates`, `hr_kra_template_items`, `hr_kra_assignments`, `hr_kra_assignment_items`, `hr_kra_daily_entries` | KRA / performance |

### Users, factories & system
| Table | Purpose |
|-------|---------|
| `factories`, `roles` | Multi-factory + role-based access |
| `closed_plants` | Closed plants/plants admin |
| `app_settings`, `server_config` | Configuration |
| `notifications`, `ai_memory` | Notifications, AI memory |
| `schema_migrations` | Migration bookkeeping |

### Sync (LOCAL ↔ MAIN)
| Table | Purpose |
|-------|---------|
| `local_servers`, `local_server_heartbeats` | Registered factory LOCAL servers + health |
| `erp_sync_log` | ERP sync attempts/results |

---

## Migrations

Ordered SQL in `BACKEND/migrations/`, run at startup by `src/app/runMigrations.js`:

| File | What it adds |
|------|-------------|
| `001_erp_tables.sql` | ERP tables (`erp_sync_log`, `bom_master`, `bom_components`, `jc_details`) + `plan_board.erp_ref_id` |
| `002_deduplicate_running_plans.sql` | Removes duplicate running plans |
| `003_perf_indexes.sql` | Performance indexes |
| `004_fix_mould_report_uniq_idx.sql` | Fixes mould report unique index |

All statements are idempotent (`IF NOT EXISTS` / `IF EXISTS`) so they're safe to re-run.

> ⚠️ Some schema is also ensured lazily at request time (e.g. `ensureJmsPlanReportSchema` in `src/app/registerRoutes.js` adds columns to `plan_board`, `mould_planning_report`, `or_jr_report`). If a column seems to appear "from nowhere," check there.

---

## LOCAL ↔ MAIN sync model

- **LOCAL** writes shop-floor data to its own PostgreSQL, then pushes to **MAIN** via `/api/sync/push-uploads` and `/api/sync/force-full-push`.
- MAIN records each attempt in `erp_sync_log`; LOCAL servers register in `local_servers` and beat in `local_server_heartbeats`.
- Never change DB restore/import behaviour without documenting rollback (see [../AGENTS.md](../AGENTS.md)).
