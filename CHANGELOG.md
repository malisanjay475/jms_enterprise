# Changelog

All notable changes to JMS Enterprise are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are grouped by change type. Under `[Unreleased]`, add your change in the right group as
part of your PR. On release, the `[Unreleased]` items move under the new version heading.

> Note: historical machine-readable release data also lives in `RELEASE_MANIFEST.json` and the
> per-release changelog used by the deploy tooling. This file is the human-readable summary.

## [Unreleased]

### Added
- Enterprise engineering docs: README, CONTRIBUTING, CODE_OF_CONDUCT, ARCHITECTURE, ROADMAP.
- `docs/` guides: GIT_WORKFLOW, GITHUB_SETTINGS, ENGINEERING_GUIDE, CODE_REVIEW_GUIDELINES,
  COMMIT_CONVENTION, JIRA_WORKFLOW, PROJECT_WORKFLOW, FOLDER_STRUCTURE, TESTING.
- GitHub issue templates (Bug, Feature, Task, Refactor, Documentation) + config.
- Quality tooling: `.editorconfig`, Prettier, ESLint (advisory, scoped), `.vscode` settings.
- `quality.yml` CI workflow (advisory format/lint on PRs).

### Changed
- (none)

### Fixed
- (none)

---

## [1.3.0] — Previous release

Baseline before the enterprise-workflow documentation effort. Backend at `1.3.0`
(`BACKEND/package.json`). See git history and `RELEASE_MANIFEST.json` for prior details.

[Unreleased]: https://github.com/malisanjay475/jms_enterprise/compare/main...develop
