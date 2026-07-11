# Modules — What Each Part Is & Why

> One row per module: what it does, why it exists, its UI page, and its API endpoints.
> API logic (unless noted) lives in `BACKEND/src/legacy/registerLegacyRoutes.js`.

---

## Production & Planning (the core)

### Planning
- **What:** Schedules which job runs on which machine, in which shift.
- **Why:** The factory can't produce without a plan; this is the entry point of every job.
- **UI:** `planning.html`
- **Key API:** `/api/planning/board`, `/api/planning/priority`, `/api/planning/machine-priority`, `/api/planning/machine-jobs`, `/api/planning/set-jc`, `/api/planning/switch-priority-job`
- ⚠️ `/api/planning/board` uses `DISTINCT ON (pb.id)` to prevent a double-render from duplicate machine-master rows — **never remove it**.

### DPR (Daily Production Report)
- **What:** Records actual daily output per machine — the heartbeat of the shop floor.
- **Why:** Turns the plan into measured reality; feeds every downstream report.
- **UI:** `dpr.html`, `dpr_daily_report.html`
- **Key API:** `/api/dpr/submit`, `/api/dpr/edit`, `/api/dpr/delete`, `/api/dpr/recent`, `/api/dpr/dashboard-matrix`, `/api/dpr/used-slots`, `/api/dpr/plan-drilldown`, `/api/dpr/job-summary`, `/api/std-actual/save`
- **Assets:** `BACKEND/PUBLIC/assets/app.js`

### Supervisor / Production Dashboard
- **What:** Real-time shop-floor overview for supervisors.
- **Why:** Lets supervisors see machine status live without digging into DPR.
- **UI:** `supervisor.html`, `production_dashboard.html`, `activity-monitor.html`
- **Key API:** `/api/machines/status`, `/api/machines/live-status`

---

## Quality

### Quality Control
- **What:** Inspect batches, pass/reject, record QC reports.
- **Why:** Gates defective product before it moves downstream.
- **UI:** `Quality.html`, `QCSupervisor.html`
- **Key API:** `/api/qc/reports`, `/api/qc/*`

---

## Post-production flow

### Assembly / Grinding
- **What:** Tracks secondary operations after moulding.
- **UI:** `assembly.html`, `grinding.html`
- **Key API:** `/api/assembly/grid`

### Shifting / WIP
- **What:** Moves work-in-progress between physical locations; barcode-driven.
- **Why:** Keeps an accurate map of where every batch physically is.
- **UI:** `shifting_supervisor.html`, `shifting.html`, `wip.html`, `wip_supervisor.html`, `scanning.html`
- **Key API:** `/api/shifting/dashboard`, `/api/shifting/jobs`, `/api/shifting/matrix`, `/api/shifting/entry`, `/api/shifting/scan-entry`, `/api/shifting/scan-label`, `/api/shifting/logs`, `/api/job/complete`

---

## Master data & admin

### Masters
- **What:** Config for products, moulds, machines, clients. Also hosts ERP live-proxy reports (JR Status/Summary/Details).
- **Why:** Everything else references this reference data.
- **UI:** `masters.html`
- **Key API:** `/api/machines`, `/api/masters/moulds`

### Users / Roles / Access
- **What:** Authentication, users, roles, permissions, factories.
- **Why:** Multi-factory, role-gated access control.
- **UI:** `users.html`, `login.html`, `settings.html`
- **Key API:** `/api/login`, `/api/users`, `/api/users/save`, `/api/roles`, `/api/user/access`, `/api/factories`
- ⚠️ Superadmin features gate on `role_code==='superadmin' OR username==='superadmin'` (the seed account's role_code is `admin`).

---

## HR & Purchasing

### HR
- **What:** Employee management, performance, interview panel.
- **Why:** Workforce side of the ERP; feeds labour into production.
- **UI:** `hr.html`, `hr_new.html`, `hr_performance.html`, `hr_interview_panel.html`
- **Code:** modular — `BACKEND/src/modules/hrPerformance/`, `BACKEND/src/modules/interviewPanel/`
- **Key API:** `/api/hr/*`

### Purchasing
- **What:** Purchase orders, vendors, GRN (goods receipt).
- **UI:** `purchase_orders.html`, `purchase_vendors.html`, `purchase_grn.html`
- **Code:** `BACKEND/routes/vendor.routes.js`

---

## Reports & sync

### Reports
- **UI:** `reports.html`, `job_summary.html`, `analyze.html`, `graph-view.html`
- **Key API:** `/api/reports/jms-plan` (in `src/app/registerRoutes.js`), ERP proxy in `BACKEND/routes/erp.routes.js`

### Sync (LOCAL ↔ MAIN)
- **What:** Pushes LOCAL factory data up to the MAIN production server.
- **Why:** Keeps the factory running offline, then reconciles.
- **UI:** `sync_monitor.html`
- **Key API:** `/api/sync/push-uploads`, `/api/sync/force-full-push`, `/api/admin/sync/reset-pull`

---

## Infrastructure surfaces (not HTML)

| Surface | Folder | Purpose |
|---------|--------|---------|
| Scanner Bridge | `CLIENT_BRIDGE/` | WebSocket bridge (:8999) for barcode scanners — **scanner tasks only** |
| Flutter mobile | `ios_app_demo/` | Mobile app |
| Desktop app | `DESKTOP_APP/` | Desktop client |
| LOCAL provisioning | `BACKEND/src/local-servers/` | Builds the install package for a new factory LOCAL server |
| Deploy/ops | `scripts/`, `.github/workflows/` | CI/CD and ops |
