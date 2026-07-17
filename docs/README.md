# JMS Enterprise — Knowledge Map

> The single place to understand **what** every part of this software is and **why** it exists.
> Start here. Every module, connection, and data flow is mapped from the real code.

---

## How this documentation is organised

| Doc | Read it when you want to know… |
|-----|-------------------------------|
| [architecture.md](architecture.md) | The big picture — how all the pieces connect (with diagrams) |
| [modules.md](modules.md) | What each module is, why it exists, its files & API endpoints |
| [database.md](database.md) | The data — tables, how they relate, LOCAL↔MAIN sync |
| [OPS-SETUP.md](OPS-SETUP.md) | Server/ops setup (already existed) |
| [RECOVERY.md](RECOVERY.md) | Disaster recovery (already existed) |

**Engineering process & workflow docs:**

| Doc | Read it when you want to know… |
|-----|-------------------------------|
| [ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md) | Onboarding: clone → run → branch → PR → merge → deploy |
| [GIT_WORKFLOW.md](GIT_WORKFLOW.md) | Git Flow branches, releases, hotfixes |
| [PROJECT_WORKFLOW.md](PROJECT_WORKFLOW.md) | Daily / junior / senior / PR / release / hotfix workflows |
| [CODE_REVIEW_GUIDELINES.md](CODE_REVIEW_GUIDELINES.md) | What reviewers check before approving |
| [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md) | Conventional Commits rules |
| [JIRA_WORKFLOW.md](JIRA_WORKFLOW.md) | Board columns and role responsibilities |
| [GITHUB_SETTINGS.md](GITHUB_SETTINGS.md) | Repo roles + branch-protection rules |
| [FOLDER_STRUCTURE.md](FOLDER_STRUCTURE.md) | Current vs. target layered structure + migration plan |
| [TESTING.md](TESTING.md) | Test pyramid and what to test here |

Higher-level guides live at the repo root:
- [../CLAUDE.md](../CLAUDE.md) — operating guide & workflow
- [../AGENTS.md](../AGENTS.md) — full agent rules
- [../DEPLOYMENT.md](../DEPLOYMENT.md) — deploy details
- [../SECURITY.md](../SECURITY.md) — security policy

---

## The 30-second overview

**JMS Enterprise** is a manufacturing ERP for a plastic injection-moulding factory. It tracks a job from **planning** → **production (DPR)** → **quality** → **assembly/shifting** → **dispatch**, plus HR and purchasing.

It runs in **two modes**:
- **MAIN** — the internet-facing production server on a Hostinger VPS (`jmsocean.cloud`).
- **LOCAL** — a server physically at the factory that keeps working if the internet drops, then **syncs** back to MAIN.

Four surfaces talk to one backend:
1. **HTML pages** (70+ pages in `BACKEND/PUBLIC/`) — the main UI.
2. **Scanner Bridge** (`CLIENT_BRIDGE/`, port 8999) — barcode/hardware scanners.
3. **Flutter mobile app** (`ios_app_demo/`).
4. **Desktop app** (`DESKTOP_APP/`).

All of them hit the **Express backend** (`BACKEND/`), which reads/writes **PostgreSQL** (`jms_v1`).

---

## Where do I go to change X?

| I want to change… | Go to |
|-------------------|-------|
| A UI page | `BACKEND/PUBLIC/<page>.html` |
| Most API logic | `BACKEND/src/legacy/registerLegacyRoutes.js` |
| App startup / wiring | `BACKEND/src/app/` |
| A new modular feature | `BACKEND/src/modules/` |
| The database schema | `BACKEND/migrations/` |
| Deploy / CI | `.github/workflows/` |
| Scanner hardware | `CLIENT_BRIDGE/` |

See [modules.md](modules.md) for the full breakdown.
