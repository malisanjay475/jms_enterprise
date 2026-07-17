# Testing Guide

We use **Jest** + **Supertest** (already in `BACKEND/devDependencies`). Tests live in `BACKEND/tests/`.

```bash
cd BACKEND
npm test               # run all
npm run test:coverage  # with coverage report
```

Existing tests cover config, health, middleware, planning-board dedup, supervisor queue, and sync —
keep these green; they encode hard-won production fixes.

---

## The testing pyramid

```
        ▲  fewer, slower, higher-confidence
   /────────\   API / E2E tests
  /──────────\  Integration tests
 /────────────\ Unit tests   ← most of your tests
        ▼  many, fast, focused
```

### 1. Unit tests — `tests/unit/`
- Pure functions, service logic with repositories mocked.
- Fast, deterministic, no DB/network.
- Target: every non-trivial service function; every bug fix gets one.

### 2. Integration tests — `tests/integration/`
- Service ↔ real PostgreSQL (a disposable test database).
- Verify SQL, transactions, constraints, and **sync conflict/dedup** behavior.
- Never point at production or staging DBs.

### 3. API tests — `tests/api/`
- Supertest against the Express app: status codes, payload shape, auth, validation errors.
- Guard the API contract that mobile and the scanner bridge depend on.

### 4. Regression tests — `tests/regression/`
- One test per shipped production fix, named for the incident, so it can never silently return.
  Examples already in the codebase: planning-board fan-out dedup, sync delete resurrection,
  plan/summary mould granularity.

---

## What to test here (project-specific priorities)

- **Sync (LOCAL↔MAIN)**: conflict keys are natural keys; tombstones respected; no duplicate/resurrected rows.
- **Planning board**: `DISTINCT ON` dedup preserved; per-colour qty caps.
- **DPR aggregation**: correct sums, no empty-qty regressions from join granularity.
- **Auth / superadmin gating**: protected routes reject unauthorized; gating rule honored.
- **Startup**: health endpoint up; config validation.

---

## Conventions

- Name tests `*.test.js`. One behavior per `it`. Arrange–Act–Assert.
- Deterministic: no reliance on real time, random, or test ordering. Seed/reset DB per suite.
- Fixtures/helpers go in `tests/helpers/`.
- A bug fix PR **must** include a failing-then-passing regression test.
- Don't reduce coverage on files you touch.

## CI

`pr-backend-ci.yml` runs on every PR (boots backend + DB connects). Add the Jest run to the required
checks so tests gate merges once the suite is reliably green across the team.
