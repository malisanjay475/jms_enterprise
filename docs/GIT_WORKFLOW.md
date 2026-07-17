# Git Workflow — Git Flow

JMS Enterprise uses **Git Flow**. Two long-lived branches, four kinds of short-lived branches.

```
feature/*  ┐
bugfix/*   ├─►  develop  ──►  release/*  ──►  main  ──►  Production (auto-deploy)
           │                                    ▲
hotfix/*   ─────────────────────────────────────┘
```

---

## Long-lived branches

| Branch | Purpose | Deploys to | Direct push? |
|--------|---------|-----------|--------------|
| `main` | Production-ready code. Every commit is a shippable release. | **Production VPS (auto on push)** | ❌ Never — PR only |
| `develop` | Integration branch. The latest delivered development work. | **Staging (auto on push)** | ❌ Never — PR only |

## Short-lived branches

| Prefix | Branch from | Merge back to | Use for |
|--------|-------------|---------------|---------|
| `feature/*` | `develop` | `develop` | New functionality |
| `bugfix/*` | `develop` | `develop` | Fixing a bug found in development/staging |
| `release/*` | `develop` | `main` **and** `develop` | Stabilizing a version for production |
| `hotfix/*` | `main` | `main` **and** `develop` | Emergency production fix that can't wait |

Name branches descriptively: `feature/planning-fill-to-max`, `bugfix/dpr-summary-empty-qty`, `hotfix/sync-delete-resurrection`.

---

## How developers work day to day

```bash
git checkout develop
git pull origin develop
git checkout -b feature/what-you-are-building

# ...code, committing in small logical chunks...
git add <specific files>          # avoid `git add .`
git commit -m "feat: add fill-to-max helper to planning board"

git push -u origin feature/what-you-are-building
gh pr create --base develop --title "feat: ..." --body "..."
```

Then: CI runs → a senior reviews → approvals + green CI → **squash merge** into `develop` → staging auto-deploys → QA verifies on staging.

Keep your branch fresh:

```bash
git checkout develop && git pull
git checkout feature/xyz
git merge develop        # or: git rebase develop  (before opening the PR)
```

---

## How releases happen

1. When `develop` has the scope for a version, cut `release/x.y.z` from `develop`.
2. On the release branch: bump the version (SemVer), update `CHANGELOG.md`, final QA/staging smoke. **Only stabilization fixes** land here — no new features.
3. Open a PR `release/x.y.z → main`. On merge, the push to `main` **auto-deploys to production** (validate → publish image to GHCR → deploy over SSH, with a safety DB dump and health-check gate).
4. Tag the release (`vX.Y.Z`) and merge `release/x.y.z` back into `develop` so version/changelog stay in sync.

See [../DEPLOYMENT.md](../DEPLOYMENT.md) for the deploy pipeline internals.

---

## How hotfixes are handled

A hotfix is an **emergency production fix** that cannot wait for the normal `develop` cycle.

```bash
git checkout main && git pull
git checkout -b hotfix/short-description
# ...minimal fix + test...
git commit -m "fix: prevent sync delete resurrection on LOCAL upsert"
git push -u origin hotfix/short-description
gh pr create --base main --title "fix: ..." --body "HOTFIX — see incident"
```

- PR targets **`main`**, gets an expedited senior review, CI must still pass.
- After merge to `main` (auto-deploys), **immediately open a second PR merging the same fix into `develop`** so it isn't lost on the next release.
- Keep hotfixes as small as possible. No refactors, no unrelated changes.

Emergency runbook: [PROJECT_WORKFLOW.md § Emergency hotfix](PROJECT_WORKFLOW.md).

---

## Rules (non-negotiable)

1. Never push directly to `main` or `develop`.
2. Never force-push a shared branch.
3. One subsystem per PR where possible.
4. Every PR: green CI + at least one senior approval before merge.
5. Hotfixes always get back-merged into `develop`.
