# Engineering Guide — Developer Handbook

Everything a developer needs from day one. Read [GIT_WORKFLOW.md](GIT_WORKFLOW.md),
[COMMIT_CONVENTION.md](COMMIT_CONVENTION.md), and [CODE_REVIEW_GUIDELINES.md](CODE_REVIEW_GUIDELINES.md) alongside this.

---

## 1. Onboarding checklist

- [ ] GitHub access with **Write** role, added to the team.
- [ ] Jira access; understand the board ([JIRA_WORKFLOW.md](JIRA_WORKFLOW.md)).
- [ ] Node.js 20+ and PostgreSQL 14 installed (or Docker).
- [ ] Read the [top-level README](../README.md), [architecture.md](architecture.md), [modules.md](modules.md), [database.md](database.md).
- [ ] Read [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md) — the house rules.
- [ ] Run the app locally (below) and open `dpr.html`, `planning.html`, `supervisor.html`.

---

## 2. Clone

```bash
git clone https://github.com/malisanjay475/jms_enterprise.git
cd jms_enterprise
```

## 3. Install

```bash
cd BACKEND
npm install
```

Scanner bridge (only if working on hardware):

```bash
cd CLIENT_BRIDGE && npm install
```

## 4. Configure environment

```bash
cp ../env.docker.example .env     # BACKEND/.env
```

Edit `.env` and set at minimum the DB connection and `SERVER_TYPE=MAIN` for normal dev.
**Never commit `.env`.** See [SECURITY.md](../SECURITY.md) for secret handling.

## 5. Run locally

```bash
# from BACKEND/
node server.js          # http://localhost:3000
```

Do not reorder the startup sequence `wait-postgres → auto-import → node server.js`.

Test URLs:

```
http://localhost:3000/dpr.html?view=summary
http://localhost:3000/planning.html
http://localhost:3000/supervisor.html
http://localhost:3000/masters.html
```

## 6. Run tests

```bash
# from BACKEND/
npm test                # jest
npm run test:coverage   # with coverage
```

Optional local quality checks (advisory, not blocking):

```bash
npx prettier --check .
npx eslint .            # scoped to BACKEND/src + tests via eslint.config.js
```

---

## 7. Create a feature branch

```bash
git checkout develop && git pull origin develop
git checkout -b feature/what-you-are-building
```

Branch types: `feature/*`, `bugfix/*`, `hotfix/*`, `release/*` — see [GIT_WORKFLOW.md](GIT_WORKFLOW.md).

## 8. Commit (Conventional Commits)

```bash
git add BACKEND/src/...       # stage specific files, not `git add .`
git commit -m "feat(planning): add fill-to-max helper"
```

Rules in [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md).

## 9. Push

```bash
git push -u origin feature/what-you-are-building
```

## 10. Open a Pull Request

```bash
gh pr create --base develop --title "feat(planning): ..." --body "..."
```

Fill in the PR template (`.github/pull_request_template.md`): summary, Jira issue, testing,
DB changes, breaking changes, rollback. Target **`develop`** (unless it's an emergency hotfix → `main`).

## 11. Fix review comments

- Push follow-up commits to the same branch; the PR updates automatically.
- Resolve each conversation once addressed.
- Re-request review after substantial changes. Stale approvals are dismissed on new commits.

## 12. Merge

- Requires green CI + required approvals (see [GITHUB_SETTINGS.md](GITHUB_SETTINGS.md)).
- Use **Squash and merge**. The head branch auto-deletes.
- `develop` merge → **staging auto-deploys** → QA verifies.

## 13. Deployment

- **Staging**: automatic on merge to `develop`.
- **Production**: automatic on merge to `main` (via a `release/*` PR). Validate → publish image → deploy over SSH with a safety DB dump + health-check gate.
- Rollback / manual deploy: `deploy-vps-docker-isolated.yml`. Details in [../DEPLOYMENT.md](../DEPLOYMENT.md).

---

## Repository layout (where things live)

| Folder | What |
|--------|------|
| `BACKEND/` | Node/Express server + 70+ HTML pages |
| `BACKEND/PUBLIC/` | All HTML pages served to the browser |
| `BACKEND/src/` | Modular backend (app, config, db, modules, services, utils, monitoring) |
| `BACKEND/src/legacy/registerLegacyRoutes.js` | Legacy API routes — most current API work |
| `BACKEND/tests/` | Jest tests |
| `BACKEND/migrations/` | SQL migrations (tracked source, not dumps) |
| `CLIENT_BRIDGE/` | Scanner WebSocket bridge (port 8999) |
| `ios_app_demo/` | Flutter mobile app |
| `DESKTOP_APP/` | Desktop app |
| `scripts/` | Deploy/backup/ops scripts |
| `.github/workflows/` | CI/CD |
| `docs/` | This documentation |

Target folder structure & migration plan: [FOLDER_STRUCTURE.md](FOLDER_STRUCTURE.md).
