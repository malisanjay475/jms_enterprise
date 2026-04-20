## Summary
- What changed:
- Why it changed:
- Subsystem: backend | scanner bridge | mobile | startup/bootstrap | deploy/ops

## Files touched
- `path/to/file`
- `path/to/file`

## Risk
- Risk level: Low | Medium | High
- Compatibility impact:
  - API contract:
  - Bridge event contract:
  - Startup behavior:
  - DB import/restore behavior:
  - Mobile behavior:
  - Env/config requirements:
- Operational impact:

## Validation
- Commands run:
- What was verified:
- What remains unverified:
- Staging deploy required before main merge: Yes/No
- Smoke test results:

## Docs
- Updated docs:
- AGENTS.md updated: Yes/No

## Rollback
- Rollback approach:

## Extra details for risky changes
If this PR touches any of the following, fill this in explicitly:
- startup ordering
- DB restore/import logic
- bridge event schema or port behavior
- auth/security behavior
- deployment scripts
- manifest/dependency changes

- Who or what might break:
- Is the change additive or breaking:
- Rollback difficulty: simple | medium | hard

## Release checklist
- [ ] Branch is `feature/*` or equivalent non-main working branch
- [ ] PR targets `develop` first unless this is an emergency hotfix
- [ ] PR CI passed
- [ ] Staging deploy completed
- [ ] Staging smoke test completed
- [ ] Production follow-up and rollback plan are clear
