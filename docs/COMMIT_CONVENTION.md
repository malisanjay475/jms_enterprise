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

### Linking work

Reference the Jira key in the body or footer: `Refs: JMS-1234`.

## Why this matters here

Production auto-deploys from `main`, and releases are cut with a SemVer bump + tagged
changelog. Conventional Commits let `feat`/`fix`/`BREAKING CHANGE` map cleanly to
minor/patch/major bumps and grouped release notes.
