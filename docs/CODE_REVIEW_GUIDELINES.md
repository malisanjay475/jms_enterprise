# Code Review Guidelines

The goal of review is a **correct, secure, maintainable** change that won't break a live
manufacturing system. Review the diff against these dimensions. Authors: self-review against
this list *before* requesting review.

Reviewers approve only when they'd be comfortable being paged for this change at 2 a.m.

---

## Author responsibilities before requesting review

- PR is small and scoped to **one subsystem** where possible.
- PR description filled in (summary, Jira key, testing performed, DB/breaking/rollback).
- CI is green. Tests added/updated for the change.
- No debug code, no `console.log` spam, no commented-out blocks, no secrets.

---

## What reviewers check

### 1. Naming
- Intention-revealing names; no `data2`, `tmp`, cryptic abbreviations.
- Consistent with existing module vocabulary (e.g. `plan_board`, `mould_name`).
- Booleans read as predicates (`isRejected`, `hasStock`).

### 2. Architecture
- Change lives in the right layer (route → service → repository), not business logic stuffed into a route handler.
- No new circular dependencies; no duplication of an existing helper.
- New modules follow `BACKEND/src/modules/*` structure.
- No scope creep — unrelated refactors belong in their own PR.

### 3. Security
- No secrets/keys/tokens in code or logs. Config via env vars only.
- Authn/authz enforced on protected routes; superadmin gating respected.
- User input treated as untrusted; no reflected input into HTML (XSS) or shell (command injection).
- Dependencies: no unnecessary new deps; no known-vulnerable versions.

### 4. Validation
- Inputs validated at the boundary (prefer `zod` schemas already in the stack).
- Reject early with clear errors; never trust client-supplied IDs/quantities blindly.
- Guard against nulls/empties on aggregation and join paths.

### 5. Performance
- No N+1 queries; batch where possible.
- Indexed columns used in WHERE/JOIN; avoid `SELECT *` on hot paths.
- No unbounded loops over large result sets; paginate.
- Avoid blocking the event loop (heavy sync work, large sync JSON in one tick).

### 6. SQL
- Parameterized queries **always** — never string-concatenate user input.
- `DISTINCT ON`/dedup guards preserved where they exist (e.g. planning board fan-out).
- Migrations are additive and reversible; document rollback. Natural keys for sync conflict resolution, not serial ids.
- No destructive migration without an explicit, documented rollback.

### 7. Logging
- Meaningful, structured logs at boundaries; no logging of secrets or full payloads with PII.
- Correct level (error vs warn vs info); no noisy per-row logs on hot paths.

### 8. Testing
- New logic has unit tests; bug fixes include a regression test.
- Tests are deterministic (no reliance on wall-clock/order); sync/dedup logic covered.
- Coverage not reduced for touched files.

### 9. Error handling
- Errors caught at the right level; no swallowed exceptions.
- User-facing errors are safe (no stack traces/DB internals leaked).
- External calls (ERP proxy, sync HTTP) handle timeouts, retries, and empty responses.

### 10. API standards
- Consistent REST shapes and status codes; backward-compatible unless flagged `BREAKING CHANGE`.
- Contract changes documented; mobile/bridge consumers considered.

### 11. Frontend standards
- No inline secrets/API keys in HTML/JS.
- Graceful loading/empty/error states; no console errors in devtools.
- Accessible controls; existing page conventions followed.

### 12. Database standards
- Schema changes via `BACKEND/migrations/`; never ad-hoc on production.
- Column/table naming consistent with existing schema.
- LOCAL↔MAIN sync impact considered (tombstones, conflict keys, granularity).

---

## Review etiquette

- Be specific and kind: suggest, don't command; explain the "why".
- Distinguish **blocking** (must fix) from **nit** (optional) — prefix nits with `nit:`.
- Approve with confidence or request changes clearly. Don't rubber-stamp.
- Authors: respond to every comment; resolve when addressed; don't force-push over a review silently.
