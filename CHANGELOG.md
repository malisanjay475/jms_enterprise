# Changelog

All notable changes to JMS Enterprise are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are grouped by change type. Under `[Unreleased]`, add your change in the right group as
part of your PR. On release, the `[Unreleased]` items move under the new version heading.

> Note: historical machine-readable release data also lives in `RELEASE_MANIFEST.json` and the
> per-release changelog used by the deploy tooling. This file is the human-readable summary.

## [Unreleased]

### Added
- Job quantity flow (v1.97.0): `GET /api/shifting/job-flow?machines=` (running job per machine:
  produced, balance, QC verified, QC hold, QC balance, shifted, shifting balance, shop floor);
  `job-shifting-panel.js` adds a compact flow strip to every machine cell of the Moulding / QC /
  Shifting Compliance Summary and flow tiles under Overall Progress in the job modal.
### Fixed
- `qc_verifications` now replicates LOCAL -> MAIN (natural key machine/date/shift/hour_slot,
  sync schema v11), so MAIN shows QC-verified qty; `/api/qc/verify/pending` matches by slot
  when the synced `dpr_entry_id` points to another row.

### Added
- Job details show shifting everywhere (v1.96.0): `/api/shifting/availability` adds shifted
  qty per location (job + colour), the latest 15 entries, and lookup by `order_no` (+`machine`).
  New shared `assets/job-shifting-panel.js` ("Production · QC · Shifting") in the DPR / QC
  Compliance job-details modal (dpr.html) and the Shifting Supervisor job modal.

### Added
- Shifting: produced + QC-verified only (v1.95.0): `shiftingAvailabilityMap` (DPR good qty,
  QC-verified share per machine/date/shift/hour from `qc_verifications`, shifted, ready),
  `GET /api/shifting/availability?plan_id` (job info, party, totals, colour-wise, holds).
  `scan-entry` / `entry` refuse NOT PRODUCED and more than the verified-ready qty
  (verification enforced only where recent `qc_verifications` exist, i.e. factory LOCAL).
  `scan-label` returns colour produced/verified/ready + `block_code`/`block_message`;
  `/api/shifting/jobs` adds verified, not verified, ready, hold and client.

### Added
- Shifting v2 backend + web (v1.94.0):
  - `shifting_line_teams` (Shifting Supervisor + Incharge per line/date/shift) with
    `GET/POST /api/shifting/line-team`; replicates LOCAL -> MAIN like `qc_line_teams`
    (sync schema v10).
  - `unit_weight_kg` (Mould Master `std_wt_kg`, kg per piece) on `/api/shifting/scan-label`
    and `/api/shifting/jobs`; jobs fall back to the machine master line.
  - `POST /api/shifting/entry` saves an optional `weightKg`.
  - `GET /api/shifting/compliance?date&shift`: per line team, per machine pcs/kg per 2-hour
    slot with entries, DPR production per slot, running-job shop-floor balance.
  - DPR Compliance Summary: new Process "Shifting" (dpr-script-1.js).

### Fixed
- Shifting APK auto-publish (v1.93.2): `android-shifting-apk.yml` now waits (up to 25 min) for
  MAIN to report version >= 1.93.1 before publishing. On the 1.93.1 release the publish reached the
  old server first, which ignored `app=shifting` and overwrote the QC feed (restored by re-runs).

### Added
- Shifting app update feed (v1.93.1): `POST /api/qc-app/publish` takes `app=shifting` to publish
  the native Shifting APK to `PUBLIC/qc-app/shifting/` (`jms-shifting.apk` + `version.json`),
  inside the existing qc-app volume. Default `app=qc` keeps the QC feed unchanged.

### Performance
- Order Master (v1.91.2): `/api/masters/orders` builds the excluded OR/JR set once
  (`order_excluded` CTE) instead of two per-order NOT EXISTS scans, counts plans and required
  moulds once per order (LATERAL) instead of 5 correlated subqueries, and drops the unused
  `planned_details` JSON. Factory-1 local: 466 ms -> 94 ms, 3.4 MB -> 2.8 MB (156 KB gzip), same
  rows and plan status. Count cards filter the cached response instead of refetching.

### Changed
- Orders auto-complete (v1.91.0): when every OR-JR row of an order is Completed (or a mix of
  Completed/Cancelled), `syncOrderCompletionConfirmations` sets the order to `Completed` directly
  (history action `AUTO_COMPLETED`) instead of flagging it for confirmation. The planning gate
  (fully planned + job cards linked) no longer holds completed orders on the board. Orders
  already waiting for confirmation are completed on the next sync. The OR-JR fetch also skips
  `Complete` / `Canceled` / `Cancel` spellings. Order Master drops the Status Change and
  Confirmation columns, the hourglass, and Confirm All.
  Rollback: revert the PR; orders set Completed by `AUTO_COMPLETED` can be found in
  `order_completion_history`.

### Changed
- Order Master (v1.90.1): "Job card overdue" card replaced by "Job card not created" (orders with
  no job_card_no); the red "late" job card date highlight is removed.

### Added
- Order Master row detail drawer (v1.90.0): `GET /api/orders/detail?order_no=` returns the order's
  required moulds (mould_planning_summary), plans (plan_board) and DPR good/reject per plan
  (dpr_hourly), factory-scoped and read-only. The eye button opens it instead of the old modal.
- Order Master redesign (v1.89.0): count cards (open / not planned / partial / fully planned /
  job card overdue) that act as quick filters, a mould plan progress bar, red "Not Planned"
  status, and late job card dates highlighted. Client-side only; no API change.

### Fixed
- Order Master / OR-JR Status showed another plant's orders (JR/JP in Dungra) (v1.88.1). The ERP
  import trusted the ERP factoryID over the OR/JR plant code; the plant code now wins when it maps
  to a known factory. Both pages hide mis-filed rows (`?include_other_factory=1` shows them), and
  `BACKEND/scripts/fix_misfiled_factory_orders.js` moves existing rows (dry run by default, writes
  a backup JSON, `--rollback <file>` restores).
- Local servers missed new orders from MAIN (v1.76.9). A long MAIN transaction (ERP import)
  committed after the local pull watermark had passed its updated_at, so those rows were never
  pulled. Pulls now re-check the last 20 minutes (`SYNC_PULL_OVERLAP_MINUTES`); re-pulled rows
  are no-ops.

### Added
- Enterprise engineering docs: README, CONTRIBUTING, CODE_OF_CONDUCT, ARCHITECTURE, ROADMAP.
- `docs/` guides: GIT_WORKFLOW, GITHUB_SETTINGS, ENGINEERING_GUIDE, CODE_REVIEW_GUIDELINES,
  COMMIT_CONVENTION, JIRA_WORKFLOW, PROJECT_WORKFLOW, FOLDER_STRUCTURE, TESTING.
- GitHub issue templates (Bug, Feature, Task, Refactor, Documentation) + config.
- Quality tooling: `.editorconfig`, Prettier, ESLint (advisory, scoped), `.vscode` settings.
- `quality.yml` CI workflow (advisory format/lint on PRs).

### Changed
- (none)

### Fixed
- (none)

---

## [1.3.0] — Previous release

Baseline before the enterprise-workflow documentation effort. Backend at `1.3.0`
(`BACKEND/package.json`). See git history and `RELEASE_MANIFEST.json` for prior details.

[Unreleased]: https://github.com/malisanjay475/jms_enterprise/compare/main...develop
