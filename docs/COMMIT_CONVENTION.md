# Commit Convention — Conventional Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/). This keeps history
readable, enables automatic changelog grouping, and communicates intent at a glance.

## Format

```
<type>(<optional scope>): <short summary>

<optional body — the "why", wrapped at ~72 cols>

<optional footer — BREAKING CHANGE / Refs / Co-Authored-By>
```

- **Summary**: imperative mood, lowercase, no trailing period, ≤ 72 chars.
- **Scope** (optional): subsystem — `dpr`, `planning`, `sync`, `bridge`, `auth`, `deploy`, `hr`.

## Types

| Type | Use for | Appears in changelog |
|------|---------|----------------------|
| `feat` | A new feature | ✅ Features |
| `fix` | A bug fix | ✅ Fixes |
| `refactor` | Code change that neither fixes a bug nor adds a feature | — |
| `docs` | Documentation only | — |
| `style` | Formatting, whitespace, semicolons — no code-behavior change | — |
| `test` | Adding or fixing tests | — |
| `chore` | Build, tooling, deps, housekeeping | — |
| `perf` | A performance improvement | ✅ |
| `ci` | CI/CD pipeline changes | — |

## Examples

```
feat(planning): add Fill-to-Max helper for per-colour plan editing
fix(sync): stop deleted plans resurrecting via LOCAL upsert path
refactor(dpr): extract summary aggregation into service
docs: add engineering onboarding guide
chore(deps): bump express to 5.2.1
perf(supervisor): batch queue query to cut round-trips
```

### Breaking changes

Add a `!` after the type/scope **and** a `BREAKING CHANGE:` footer:

```
feat(api)!: change job-card payload shape

BREAKING CHANGE: `qty` is now nested under `colours[]`. Mobile app < 2.3 must upgrade.
```

### Linking work — Jira ticket key is required

Every branch, commit, and PR **must** carry its Jira ticket key (e.g. `KAN-12`) so GitHub's
Jira integration auto-links the work to its ticket. Once the GitHub for Jira app is connected,
any branch/commit/PR containing the key shows up automatically on that ticket's **Development**
panel — no manual updates needed.

**Branch name** — start with the key:

```
KAN-12-fill-to-max-helper
feat/KAN-45-dpr-summary-service
```

**Commit message** — put the key in the summary or footer:

```
feat(planning): add Fill-to-Max helper for per-colour plan editing

Refs: KAN-12
```

**Smart commits** — drive Jira straight from the commit message. Put commands after the key:

| Command | Effect on the ticket |
|---------|----------------------|
| `KAN-12 #comment <text>` | Adds a comment |
| `KAN-12 #time 2h 30m <text>` | Logs work |
| `KAN-12 #in-progress` | Transitions to In Progress |
| `KAN-12 #done` | Transitions to Done |

Example:

```
fix(sync): stop deleted plans resurrecting via LOCAL upsert path

KAN-12 #time 1h 30m #comment guarded upsert against tombstones #done
```

> Transition names (`#in-progress`, `#done`) must match the board's workflow — see
> [JIRA_WORKFLOW.md](JIRA_WORKFLOW.md).

## Why this matters here

Production auto-deploys from `main`, and releases are cut with a SemVer bump + tagged
changelog. Conventional Commits let `feat`/`fix`/`BREAKING CHANGE` map cleanly to
minor/patch/major bumps and grouped release notes.
