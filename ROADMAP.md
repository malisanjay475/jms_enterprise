# Roadmap

Direction for JMS Enterprise. This is a living document — refine it in planning/refinement and keep
it honest. Dates are targets, not commitments. Detailed work is tracked in Jira; this is the map.

Legend: 🟢 done · 🟡 in progress · ⚪ planned · 🔵 exploring

---

## Now — engineering foundation

- 🟡 Enterprise workflow & documentation (this effort): Git Flow docs, review guidelines, templates, quality tooling.
- ⚪ Wire Jest into required PR checks once the suite is reliably green across the team.
- ⚪ Add advisory Prettier/ESLint check to CI (non-blocking first, then enforce on new code).
- ⚪ Harden GHCR deploy auth (add a dedicated pull-token secret instead of relying on cached creds).

## Next — architecture hardening

- ⚪ Incrementally migrate `src/legacy/registerLegacyRoutes.js` into the layered structure
  (routes → controllers → services → repositories → validation) — one endpoint per PR.
  See [docs/FOLDER_STRUCTURE.md](docs/FOLDER_STRUCTURE.md).
- ⚪ Expand automated test coverage: sync conflict/dedup, planning board, DPR aggregation, auth.
- ⚪ Strengthen input validation with `zod` schemas at all API boundaries.
- ⚪ Improve observability: structured logging + dashboards for sync health and deploy health.

## Later — reliability & scale

- ⚪ Formalize LOCAL↔MAIN sync test harness (tombstones, natural keys, resurrection guards).
- ⚪ Backup/restore drills automated and documented as runbooks.
- ⚪ Blue/green or canary deploy option beyond current auto-rollback.
- 🔵 Evaluate migration of static HTML pages toward a componentized frontend (exploratory only).

## Ongoing

- Security reviews (CodeQL, Dependabot, secret scanning) and dependency upkeep.
- Documentation kept in sync with code as part of every PR.
- Incident post-mortems feed regression tests.

---

Have an idea? Open a **Feature Request** issue or raise it in refinement.
Status of anything here: check Jira and `git log`.
