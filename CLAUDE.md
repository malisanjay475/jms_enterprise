# CLAUDE.md — JMS Enterprise

> Claude Code operating guide. Read this before any task.

---

## Project Identity

**JMS Enterprise** — a Job Management System (manufacturing ERP) for a plastic injection moulding factory.

- Multi-surface: Backend API + HTML frontend + Scanner Bridge + Flutter Mobile
- Stack: Node.js / Express 5 / PostgreSQL / Docker / Nginx / GitHub Actions
- Live site: Hostinger VPS (production) + Local server at factory (LOCAL mode)
- Owner: malisanjay475 (GitHub)

---

## Repo Location (Claude Code working directory)

```
<your-codex-workspace>/jms_enterprise-git
```

Start Claude Code from this directory:
```bash
cd "<your-codex-workspace>/jms_enterprise-git"
claude
```

Local backend copy (live factory server — sync target):
```
<local-downloads>/jms-local-server-jms-01/JMS_LOCAL_SERVER_jms-01/BACKEND
```

---

## Subsystem Map

| Folder | What it is | When to touch it |
|--------|-----------|-----------------|
| `BACKEND/` | Node/Express server + 70+ HTML pages | API, business logic, UI pages |
| `BACKEND/PUBLIC/` | All HTML pages served to browser | Frontend UI changes |
| `BACKEND/src/` | Modular backend (new architecture) | New features, route refactors |
| `BACKEND/src/legacy/registerLegacyRoutes.js` | Legacy API routes (469 lines) | Most API work lives here |
| `CLIENT_BRIDGE/` | Scanner/device WebSocket bridge (port 8999) | Hardware scanner issues only |
| `ios_app_demo/` | Flutter mobile app | Mobile-only work |
| `scripts/` | Deploy, backup, ops scripts | Deployment/ops work only |
| `.github/workflows/` | CI/CD pipelines | Never touch unless deploy task |
| `nginx/` | Nginx config | Infra/proxy changes only |

---

## Key Files (Read First for Each Task)

| Task type | Read these first |
|-----------|-----------------|
| Any backend feature | `BACKEND/server.js`, `BACKEND/src/app/createApp.js` |
| API/route work | `BACKEND/src/legacy/registerLegacyRoutes.js` |
| DPR module | `BACKEND/PUBLIC/dpr.html`, `BACKEND/PUBLIC/assets/app.js` |
| Planning module | `BACKEND/PUBLIC/planning.html` |
| DB/startup | `BACKEND/docker-entrypoint.sh`, `BACKEND/scripts/auto-import-db-if-needed.js` |
| Deploy | `.github/workflows/deploy-v1-staging.yml` |

---

## Git Workflow (How We Work)

```
feature/your-feature   →  PR  →  develop  →  PR  →  main  →  Deploy to LIVE
```

### Branch Rules
- **develop** = integration branch, auto-deploys to staging on push
- **main** = production branch, deploy manually via GitHub Actions
- **feature branches** = always branch from develop, name: `feature/short-description`
- Branch protection: both develop and main require PR + CI pass before merge
- Never push directly to develop or main

### Starting a New Feature
```bash
git checkout develop
git pull origin develop
git checkout -b feature/what-you-are-building
# ... code ...
git add <files>
git commit -m "feat: describe the change"
git push origin feature/what-you-are-building
gh pr create --base develop --title "feat: ..." --body "..."
```

### Commit Message Format
```
feat: add thing
fix: correct thing
chore: housekeeping
refactor: restructure thing (no behavior change)
```

---

## Running Locally

### Backend (main dev server)
```bash
cd BACKEND
npm install
node server.js
# Runs at: http://localhost:3000
```

### Key local test URLs
```
http://localhost:3000/dpr.html?view=summary      # DPR (Daily Production Report)
http://localhost:3000/planning.html              # Planning Board
http://localhost:3000/supervisor.html            # Supervisor Dashboard
http://localhost:3000/masters.html              # Masters / Config
http://localhost:3000/hr.html                   # HR Module
```

### Scanner Bridge
```bash
cd CLIENT_BRIDGE
npm install
node bridge.js
# WebSocket on port 8999
```

---

## Database

- PostgreSQL 14
- DB name: `jms_v1`, user: `jms_v1`
- Config via `.env` in `BACKEND/` (never commit real `.env`)
- Local server uses its own PG instance + syncs with VPS main server

---

## Testing Checklist Before Any PR

- [ ] `node --check BACKEND/src/legacy/registerLegacyRoutes.js` — syntax check
- [ ] `node server.js` starts without errors
- [ ] Target page loads in browser (`localhost:3000/xxx.html`)
- [ ] Core feature works (open modals, submit forms, data loads)
- [ ] No console errors in browser devtools
- [ ] `git diff --check` — no whitespace errors

---

## Deploy Pipeline

| Environment | How | Trigger |
|-------------|-----|---------|
| Staging | Auto | Push to develop (via PR merge) |
| Production (Hostinger VPS) | Manual | GitHub Actions → `deploy-vps-docker-isolated.yml` → Run workflow |

### To deploy to LIVE after merging develop → main:
1. Go to GitHub → Actions → `deploy-vps-docker-isolated.yml`
2. Click "Run workflow"
3. Select branch: `main`
4. Click Run

### Rollback
The deploy script auto-rolls back if health check fails. Manual rollback: re-run workflow with previous image tag.

---

## Current State (as of 2026-05-06)

- **develop** is 86 commits ahead of **main** — production is behind
- PR #44 merged: DPR summary detail improvements (last feature)
- PR #45 open: .gitignore fix for .cursor/.claude dirs
- **Next step**: After PR #45 merges, create develop → main PR, then deploy to live

---

## CI/CD Pipelines Summary

| File | What it does |
|------|-------------|
| `pr-backend-ci.yml` | Runs on every PR — validates backend boots + DB connects |
| `deploy-v1-staging.yml` | Auto-deploys to staging when develop changes |
| `deploy-vps-docker-isolated.yml` | Manual deploy to Hostinger production VPS |
| `refresh-staging-from-live.yml` | Copies production DB to staging |

---

## Architecture: LOCAL vs MAIN Server

This app runs in two modes controlled by `SERVER_TYPE` env var:

- `SERVER_TYPE=MAIN` — Hostinger VPS (production, internet-facing)
- `SERVER_TYPE=LOCAL` — Factory floor server (syncs data with MAIN via HTTP)

Local servers are provisioned with a package built by `BACKEND/src/local-servers/buildProvisioningPackage.js`.

---

## Important Rules (from AGENTS.md)

1. Never commit `.env`, passwords, API keys, or secrets
2. Never push directly to `develop` or `main` — always use PRs
3. Never reorder the startup sequence: `wait-postgres → auto-import → node server.js`
4. Never touch `CLIENT_BRIDGE/` for non-scanner tasks
5. Never change DB restore/import behavior without documenting rollback
6. Keep changes scoped to one subsystem per PR
7. `.cursor/` and `.claude/` are gitignored — never commit them

---

## Modules & HTML Pages Reference

| Module | File | Description |
|--------|------|-------------|
| DPR | `dpr.html` | Daily Production Report — job tracking per machine |
| Planning | `planning.html` | Plan board — schedules jobs per machine per shift |
| Supervisor | `supervisor.html` | Real-time shop floor dashboard |
| Masters | `masters.html` | Products, moulds, machines, clients config |
| QC Supervisor | `QCSupervisor.html` | Quality control supervisor view |
| HR | `hr.html`, `hr_new.html` | HR management |
| HR Performance | `hr_performance.html` | Employee performance tracking |
| Purchase Orders | `purchase_orders.html` | PO management |
| Reports | `reports.html` | Report generation |
| Settings | `settings.html` | App configuration |
