# Project Workflow

Concrete, step-by-step workflows for the recurring situations in this project.
Cross-references: [GIT_WORKFLOW.md](GIT_WORKFLOW.md) · [JIRA_WORKFLOW.md](JIRA_WORKFLOW.md) · [ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md).

---

## Daily workflow (everyone)

1. Pull latest `develop`. Sync your active branch (`git merge develop`).
2. Standup: what you did / will do / blockers. Update Jira.
3. Work in small commits (Conventional Commits). Push often.
4. Keep PRs small; open a draft PR early for feedback.
5. Respond to reviews on your PRs before starting new work.
6. End of day: push your branch so work isn't lost locally.

---

## Junior developer workflow

1. Take a ticket from **Ready** (never straight from Backlog). Confirm acceptance criteria.
2. `git checkout develop && git pull` → `git checkout -b feature/JMS-xxxx-desc`.
3. Implement the smallest change that satisfies the criteria. Add tests.
4. Run locally: `node server.js`, click through the affected page, `npm test`.
5. Self-review the diff against [CODE_REVIEW_GUIDELINES.md](CODE_REVIEW_GUIDELINES.md).
6. Push → open PR to `develop` → fill the template → move ticket to **Code Review**.
7. Address **every** review comment; ask questions when unsure. Re-request review.
8. On merge, watch staging; help QA reproduce if needed.

**When stuck > ~30–60 min:** ask. Move to **Blocked** with a specific note.

---

## Senior developer workflow

1. Keep `develop` healthy; refine Backlog → Ready with clear scope + criteria.
2. Review PRs quickly and rigorously; mentor via comments (explain the "why").
3. Personally own risky areas: startup order, DB restore/import, LOCAL↔MAIN sync, deploy.
4. Approve only with green CI and confidence in rollback.
5. Cut and shepherd releases; approve/lead hotfixes.

---

## PR workflow

```
branch → commits → push → open PR (target develop) → CI runs
      → senior review → address comments → approvals + green CI
      → squash merge → head branch deleted → staging auto-deploys → QA
```

- Required checks and approvals per [GITHUB_SETTINGS.md](GITHUB_SETTINGS.md).
- Target `develop` normally; `main` only for release PRs and emergency hotfixes.
- Resolve all conversations; keep the description accurate as the PR evolves.

---

## Release workflow

1. Decide the version scope on `develop`. Cut `release/x.y.z` from `develop`.
2. Bump version (SemVer), update [CHANGELOG.md](../CHANGELOG.md), run full staging smoke test.
3. Only stabilization fixes on the release branch — **no new features**.
4. PR `release/x.y.z → main`. Two approvals + green CI.
5. Merge → **production auto-deploys** (validate → publish GHCR image → SSH deploy → safety DB dump → health-check gate).
6. Tag `vX.Y.Z`. Merge `release/x.y.z` back into `develop`.
7. Announce in the team channel; watch production health/logs for a bit.

---

## Emergency hotfix workflow

Use only when production is broken and it can't wait for the normal cycle.

1. Declare the incident; note it in the team channel and Jira (severity S1/S2).
2. `git checkout main && git pull` → `git checkout -b hotfix/short-desc`.
3. Make the **minimal** fix + a regression test. No refactors, nothing extra.
4. Push → PR to `main` → expedited senior review → CI must still pass.
5. Merge → production auto-deploys. Verify the fix live; watch logs/health.
6. **Immediately** open a second PR merging the same fix into `develop` (so it isn't lost).
7. If deploy makes things worse: roll back via `deploy-vps-docker-isolated.yml` (previous image tag) — the auto-deploy also self-rolls-back on a failed health check.
8. Write a short post-incident note (what broke, why, follow-ups).

Recovery/runbook detail: [RECOVERY.md](RECOVERY.md) · [../DEPLOYMENT.md](../DEPLOYMENT.md).
