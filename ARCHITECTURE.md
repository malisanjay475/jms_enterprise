# Architecture

High-level overview. Deep dives live in [docs/architecture.md](docs/architecture.md),
[docs/modules.md](docs/modules.md), and [docs/database.md](docs/database.md).

---

## System at a glance

JMS Enterprise is a single Express backend serving four client surfaces, backed by PostgreSQL,
running in two deployment modes.

```
        ┌───────────────┐   ┌───────────────┐   ┌──────────────┐   ┌────────────┐
        │ HTML pages    │   │ Scanner Bridge│   │ Flutter app  │   │ Desktop app│
        │ (BACKEND/     │   │ (CLIENT_BRIDGE│   │ (ios_app_    │   │ (DESKTOP_  │
        │  PUBLIC, :3000)│  │  :8999, WS)   │   │  demo)       │   │  APP)      │
        └──────┬────────┘   └──────┬────────┘   └──────┬───────┘   └─────┬──────┘
               └───────────────────┴──────── HTTP/WS ──┴─────────────────┘
                                        │
                             ┌──────────▼───────────┐
                             │  Express backend      │
                             │  BACKEND/ (:3000)     │
                             │  app · services ·     │
                             │  legacy routes ·      │
                             │  modules · sync       │
                             └──────────┬───────────┘
                                        │
                             ┌──────────▼───────────┐
                             │  PostgreSQL 14        │
                             │  (jms_v1)             │
                             └──────────────────────┘
```

## Two deployment modes (`SERVER_TYPE`)

| Mode | Where | Role |
|------|-------|------|
| **MAIN** | Hostinger VPS (`jmsocean.cloud`), behind shared-host Traefik | Internet-facing production, source of truth |
| **LOCAL** | Server physically at the factory | Keeps working offline; **syncs** back to MAIN over HTTP |

LOCAL↔MAIN sync is a critical, subtle subsystem: conflict resolution uses **natural keys**,
deletes use **tombstones**, and dedup guards (e.g. `DISTINCT ON` on the planning board) must be
preserved. See [docs/database.md](docs/database.md).

## Backend layering

`server.js` → `src/app/createApp.js` wires middleware and routes. Most API logic currently lives in
`src/legacy/registerLegacyRoutes.js`; newer features use `src/modules/*` and `src/services/*`.
The target layered structure (routes → controllers → services → repositories → validation) and the
incremental migration plan are in [docs/FOLDER_STRUCTURE.md](docs/FOLDER_STRUCTURE.md).

## Business flow

```
Planning → Production (DPR) → Quality (QC) → Assembly / Shifting → Dispatch
                                   +  HR   +  Purchasing
```

Module-by-module detail: [docs/modules.md](docs/modules.md).

## Runtime & delivery

- **Containerized** with Docker; images published to GHCR (`ghcr.io/<owner>/jms-v1-app`).
- **CI/CD** via GitHub Actions: PR validation, staging auto-deploy on `develop`, production
  auto-deploy on `main` (with safety DB dump + health-check gate). See [DEPLOYMENT.md](DEPLOYMENT.md).
- **Reverse proxy**: shared-host Traefik routes `jmsocean.cloud`; the app compose must keep its
  `traefik.*` labels or production 404s site-wide.
- **Backups**: scheduled `pg_dump` every 6h with off-site copy. Recovery: [docs/RECOVERY.md](docs/RECOVERY.md).

## Key non-functional concerns

- **Security**: Helmet, rate limiting, JWT auth, bcrypt, superadmin gating. [SECURITY.md](SECURITY.md).
- **Reliability**: startup ordering `wait-postgres → auto-import → server`; health checks; self-rollback on failed deploy. [RELIABILITY_PLAN.md](RELIABILITY_PLAN.md).
- **Observability**: Sentry, morgan logging, `src/monitoring/`.
