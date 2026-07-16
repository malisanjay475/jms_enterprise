# Contributing to JMS Enterprise

Thanks for contributing. This is a **live manufacturing system** — correctness and safety come
first. Please read this before opening a PR.

## Ground rules

1. **Never push directly to `main` or `develop`.** Branch from `develop`, open a PR.
2. **Never commit secrets** — `.env`, passwords, keys, tokens, customer data. See [SECURITY.md](SECURITY.md).
3. **One subsystem per PR** where possible.
4. **Never reorder the startup sequence**: `wait-postgres → auto-import → node server.js`.
5. **Never change DB restore/import or sync behavior** without a documented rollback.
6. Don't touch `CLIENT_BRIDGE/` for non-scanner tasks.
7. Follow the house rules in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

## Workflow at a glance

```
fork/branch from develop → code + tests → Conventional Commit → push
→ PR to develop → CI green + senior review → squash merge → staging → QA
```

- Branching model: [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)
- Commit format: [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
- Full onboarding: [docs/ENGINEERING_GUIDE.md](docs/ENGINEERING_GUIDE.md)
- What reviewers check: [docs/CODE_REVIEW_GUIDELINES.md](docs/CODE_REVIEW_GUIDELINES.md)

## Before you open a PR

- [ ] `node --check` passes on changed backend files.
- [ ] `node server.js` starts without errors.
- [ ] Affected page loads at `localhost:3000/...` with no console errors.
- [ ] `npm test` passes; you added/updated tests (regression test for bug fixes).
- [ ] `git diff --check` — no whitespace errors.
- [ ] PR template filled: summary, Jira key, testing, DB changes, breaking changes, rollback.
- [ ] Target branch is `develop` (or `main` only for release/hotfix).

## Reporting bugs & requesting features

Use the issue templates (Bug / Feature / Task / Refactor / Documentation). Include a Jira key.
Security issues: **do not** open a public issue — follow [SECURITY.md](SECURITY.md).

## Code style

- EditorConfig + Prettier are configured; format before committing (`npx prettier --write <files>`).
- ESLint (advisory) is scoped to `BACKEND/src` + tests. Keep new code warning-free.
- Match existing conventions in the file you're editing.

By contributing you agree your work is licensed to the project owner for internal use.
