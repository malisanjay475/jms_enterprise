# GitHub Repository Settings

Reference for how the `jms_enterprise` GitHub repository should be configured.
Only an **Admin** can change these under **Settings**.

---

## Repository roles

GitHub provides five permission levels. Assign the least privilege needed.

| Role | Can do | Give it to |
|------|--------|-----------|
| **Read** | Clone, pull, open issues, comment | Stakeholders, auditors, read-only viewers |
| **Triage** | Read + manage issues/PRs (label, assign, close) — **no code write** | QA, project managers |
| **Write** | Triage + push to non-protected branches, open PRs | Developers (junior & senior) |
| **Maintain** | Write + manage some settings (not sensitive/destructive) | Team leads |
| **Admin** | Everything, incl. branch protection, secrets, roles | Repo owner / principal (`@malisanjay475`) |

Guidance:
- Junior and senior developers → **Write** (they cannot merge into protected branches without review/CI).
- QA → **Triage** (moves tickets, verifies, but doesn't push code).
- PM → **Triage**.
- Keep **Admin** to one or two people. Secrets and branch protection are Admin-only.

---

## Branch protection rules

Configure under **Settings → Branches → Branch protection rules** (or the newer **Rulesets**).

### Protect `main`

- ✅ Require a pull request before merging
  - ✅ Require **2 approvals** (at least one senior / CODEOWNER)
  - ✅ Dismiss stale approvals when new commits are pushed
  - ✅ Require review from **Code Owners** (see `.github/CODEOWNERS`)
- ✅ Require status checks to pass before merging
  - Required checks: `pr-backend-ci`, `CodeQL`
  - ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ✅ Require linear history (squash/rebase only)
- ✅ **Do not allow force pushes**
- ✅ **Do not allow deletions**
- ✅ Include administrators (apply rules to admins too)
- ✅ Require signed commits (recommended)

### Protect `develop`

- ✅ Require a pull request before merging
  - ✅ Require **1 approval** (senior developer)
- ✅ Require status checks to pass: `pr-backend-ci`
  - ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ✅ **Do not allow force pushes**
- ✅ **Do not allow deletions**

### `feature/*`, `bugfix/*`, `release/*`, `hotfix/*`

No protection needed — they are short-lived and merged via PR into a protected branch.

---

## Merge settings (Settings → General → Pull Requests)

- ✅ Allow **squash merging** (default) — keeps history linear and readable.
- ⬜ Disable merge commits (optional, for clean linear history).
- ✅ Allow **auto-merge**.
- ✅ **Automatically delete head branches** after merge.

---

## Actions & secrets

- Deploy/CI secrets live in **Settings → Secrets and variables → Actions**. Never in code.
- Restrict who can approve/run workflows for first-time contributors.
- See [../SECURITY.md](../SECURITY.md) for secret-management policy.

---

## Other recommended settings

- **Settings → Code security**: enable Dependabot alerts + security updates (config in `.github/dependabot.yml`), secret scanning, and push protection.
- **CODEOWNERS** (`.github/CODEOWNERS`) is already configured so owners are auto-requested on PRs.
- Require issues/PRs to reference a Jira key (enforced by convention + review).
