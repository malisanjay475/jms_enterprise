# Folder Structure — Current & Target

> **Guiding rule: do not break the running application.** The current structure works and is
> deployed. This document recommends an *incremental, opt-in* target that new code follows and
> legacy code migrates toward one PR at a time — never a big-bang move.

---

## Current structure (as-is)

```
BACKEND/
├── server.js                     # entrypoint
├── src/
│   ├── app/                      # app wiring (createApp.js)
│   ├── config/                   # runtime config
│   ├── db/                       # database access
│   ├── legacy/
│   │   └── registerLegacyRoutes.js   # most API logic today (large)
│   ├── local-servers/            # LOCAL provisioning
│   ├── modules/                  # newer feature modules (hrPerformance, interviewPanel)
│   ├── monitoring/               # health / metrics
│   ├── services/                 # business services
│   └── utils/                    # helpers
├── PUBLIC/                       # 70+ served HTML pages + assets
├── migrations/                   # SQL migrations
├── scripts/                      # build/ops scripts
└── tests/                        # jest tests
```

A modular `src/` already exists — the main debt is the monolithic
`src/legacy/registerLegacyRoutes.js`. The target below is where that logic should migrate.

---

## Target structure (to-be, adopt incrementally)

Standard layered backend. Each **feature module** owns its slice; shared concerns live at the top.

```
BACKEND/src/
├── app/                # app bootstrap & middleware wiring (exists)
├── config/             # env + runtime config (exists)
├── middleware/         # auth, error handler, rate-limit, request logging
├── routes/             # thin HTTP routing → delegates to controllers
├── controllers/        # request/response handling, no business logic
├── services/           # business logic (exists — grow this)
├── repositories/       # DB queries only (parameterized SQL), no business logic
├── validation/         # zod schemas per resource
├── db/                 # pool, migration runner (exists)
├── utils/              # pure helpers (exists)
├── monitoring/         # health/metrics (exists)
└── modules/            # optional: self-contained feature folders bundling the above
    └── <feature>/
        ├── <feature>.routes.js
        ├── <feature>.controller.js
        ├── <feature>.service.js
        ├── <feature>.repository.js
        └── <feature>.validation.js
```

### Layer responsibilities

| Layer | Does | Must NOT |
|-------|------|----------|
| **routes** | Map HTTP verb+path → controller | Contain business logic or SQL |
| **controllers** | Parse request, call service, shape response | Talk to the DB directly |
| **services** | Business rules, orchestration | Build raw SQL strings |
| **repositories** | Parameterized SQL, mapping rows | Contain business rules |
| **validation** | zod schemas at the boundary | Side effects |
| **middleware** | auth, errors, logging, rate-limit | Feature logic |
| **config** | Read/validate env once | Be imported for secrets scattered around |

---

## Migration strategy (safe & incremental)

1. **New features** are written in the target layout from day one.
2. **Touched legacy routes**: when you modify an endpoint in `registerLegacyRoutes.js`, extract
   *that* endpoint into a `routes → controller → service → repository` slice. Leave the rest.
3. Keep behavior identical — add characterization/regression tests before extracting.
4. One subsystem per PR. Never move the whole legacy file at once.
5. Track progress in [ROADMAP.md](../ROADMAP.md).

This yields a clean architecture over time with zero risky rewrites.

---

## Tests folder

```
BACKEND/tests/
├── unit/               # pure functions, services (mock repos)
├── integration/        # service ↔ db (real test DB)
├── api/                # supertest against the Express app
├── regression/         # locked-in fixes (e.g. sync dedup, plan fan-out)
└── helpers/            # shared fixtures/utilities (exists)
```

See [TESTING.md](TESTING.md).
