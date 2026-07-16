# JMS Enterprise

> A production **Job Management System (Manufacturing ERP)** for a plastic injection-moulding factory.
> Tracks a job from **planning → production (DPR) → quality → assembly/shifting → dispatch**, plus HR and purchasing.

[![PR CI](https://github.com/malisanjay475/jms_enterprise/actions/workflows/pr-backend-ci.yml/badge.svg)](https://github.com/malisanjay475/jms_enterprise/actions/workflows/pr-backend-ci.yml)
[![CodeQL](https://github.com/malisanjay475/jms_enterprise/actions/workflows/codeql.yml/badge.svg)](https://github.com/malisanjay475/jms_enterprise/actions/workflows/codeql.yml)

---

## What is this?

JMS Enterprise runs in **two modes** controlled by the `SERVER_TYPE` env var:

- **MAIN** — internet-facing production on a Hostinger VPS (`jmsocean.cloud`).
- **LOCAL** — a server physically at the factory that keeps working if the internet drops, then **syncs** back to MAIN.

Four surfaces talk to one backend:

| Surface | Path | Port |
|---------|------|------|
| HTML pages (70+) — main UI | `BACKEND/PUBLIC/` | 3000 |
| Express backend + API | `BACKEND/` | 3000 |
| Scanner Bridge (barcode hardware) | `CLIENT_BRIDGE/` | 8999 |
| Flutter mobile app | `ios_app_demo/` | — |
| Desktop app | `DESKTOP_APP/` | — |

Data lives in **PostgreSQL 14** (`jms_v1`).

---

## Tech stack

Node.js · Express 5 · PostgreSQL 14 · Docker · Nginx/Traefik · GitHub Actions · Flutter · Jest

---

## Quick start (local dev)

```bash
git clone https://github.com/malisanjay475/jms_enterprise.git
cd jms_enterprise/BACKEND
cp ../env.docker.example .env      # then edit values — never commit .env
npm install
node server.js                     # http://localhost:3000
```

Key local URLs:

```
http://localhost:3000/dpr.html?view=summary   # Daily Production Report
http://localhost:3000/planning.html            # Planning board
http://localhost:3000/supervisor.html          # Supervisor dashboard
http://localhost:3000/masters.html             # Masters / config
http://localhost:3000/hr.html                  # HR
```

Full onboarding: **[docs/ENGINEERING_GUIDE.md](docs/ENGINEERING_GUIDE.md)**.

---

## Documentation map

| Doc | Read it when you want to know… |
|-----|-------------------------------|
| [docs/ENGINEERING_GUIDE.md](docs/ENGINEERING_GUIDE.md) | Onboarding: clone → run → branch → PR → merge → deploy |
| [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) | Git Flow branches and how releases/hotfixes happen |
| [docs/PROJECT_WORKFLOW.md](docs/PROJECT_WORKFLOW.md) | Daily / junior / senior / PR / release / hotfix workflows |
| [docs/CODE_REVIEW_GUIDELINES.md](docs/CODE_REVIEW_GUIDELINES.md) | What reviewers check before approving |
| [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md) | Conventional Commits rules |
| [docs/JIRA_WORKFLOW.md](docs/JIRA_WORKFLOW.md) | Board columns and role responsibilities |
| [docs/GITHUB_SETTINGS.md](docs/GITHUB_SETTINGS.md) | Repo roles + branch-protection rules to configure |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture summary (details in `docs/architecture.md`) |
| [docs/architecture.md](docs/architecture.md) · [docs/modules.md](docs/modules.md) · [docs/database.md](docs/database.md) | Deep dives on architecture, modules, and data |
| [DEPLOYMENT.md](DEPLOYMENT.md) · [docs/RECOVERY.md](docs/RECOVERY.md) | Deploy pipeline · disaster recovery |
| [SECURITY.md](SECURITY.md) | Security policy and reporting |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | How to contribute · behavior expectations |
| [ROADMAP.md](ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md) | Where we're going · what changed |

---

## Contributing

Never push directly to `main` or `develop`. Branch from `develop`, open a PR, get a review, let CI pass.
See **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)**.

## Security

Never commit `.env`, secrets, keys, or customer data. Report vulnerabilities privately per **[SECURITY.md](SECURITY.md)**.

## License

Proprietary — © JMS. All rights reserved. Internal use only.
