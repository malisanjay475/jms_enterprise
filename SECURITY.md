# Security Policy

## Scope

This policy applies to the `jms_enterprise` repository and its operational surfaces, including:
- backend application logic
- database connectivity and bootstrap/import behavior
- scanner and device bridge behavior
- mobile application code
- deployment and operational scripts
- secrets, environment variables, and configuration handling

This repository contains business logic, infrastructure-sensitive startup behavior, and device integration code. Security issues should be handled carefully and should not be disclosed publicly before they are reviewed.

---

## Supported versions

Security fixes are supported for the current active code on the default branch and the currently deployed production version maintained by the repository owner.

At this time, do not assume old historical branches, tags, or forks are supported unless the maintainer explicitly says so.

Practical rule:
- `main`: supported
- older snapshots, stale forks, or unmaintained branches: not guaranteed to receive security fixes

If formal versioning is introduced later, this section should be updated to match the real release process.

---

## Reporting a vulnerability

### Do not open a public GitHub issue
If you discover a suspected vulnerability, do **not** report it through a public issue, public pull request, or public discussion thread.

### Preferred reporting path
Report the issue privately to the repository maintainer/owner through a private channel already used for this project.

Recommended private paths:
1. direct message or internal company communication channel to the maintainer
2. private email to the repository owner/maintainer
3. private security report through GitHub, if enabled later

If no dedicated security inbox exists yet, the repository owner should establish one and update this file.

---

## What to include in a report

Please include as much of the following as possible:
- affected area or file path
- vulnerability type
- clear description of the impact
- reproduction steps
- proof of concept, if safe to share
- whether authentication is required
- whether the issue is tenant-specific or cross-tenant
- whether data exposure, privilege escalation, remote code execution, or destructive DB behavior is possible
- logs, screenshots, or request samples if relevant
- suggested remediation if you already know one

Good reports are specific, reproducible, and scoped.

---

## Expected response process

The maintainer should aim to:
- acknowledge receipt within 3 business days
- assess severity and reproduce the issue as soon as reasonably possible
- provide status updates when there is meaningful progress
- coordinate a fix before public disclosure

Response times may vary depending on maintainer availability, severity, and reproducibility.

---

## Disclosure policy

Please allow the maintainer a reasonable period to investigate and patch the issue before any public disclosure.

Until the issue is confirmed and a mitigation plan exists:
- do not publish exploit details
- do not open public PRs with weaponized proof-of-concept code
- do not post secrets, tokens, DB credentials, or internal endpoints

When a fix is ready, the maintainer may choose to:
- release the fix silently first
- publish a short advisory later
- credit the reporter, if the reporter wants that

---

## Sensitive areas in this repository

The following areas should be treated as especially sensitive during review and testing:

### Backend and application security
- authentication and authorization logic
- user/session/token flows
- file upload and import/export paths
- API endpoints that expose tenant or operational data
- database query paths and permission checks

### Database bootstrap and restore behavior
- `BACKEND/docker-entrypoint.sh`
- `BACKEND/scripts/wait-for-postgres.js`
- `BACKEND/scripts/auto-import-db-if-needed.js`

These files are security-relevant because mistakes here can affect startup safety, data integrity, restore behavior, or destructive DB replacement logic.

### Scanner/device bridge
- `CLIENT_BRIDGE/bridge.js`

This area is sensitive because it handles device connectivity, TCP/serial behavior, and WebSocket event propagation that may affect trust boundaries and client-visible data flow.

### Secrets and configuration
- `.env`-style files
- DB credentials
- API keys
- import/restore paths
- deployment configuration
- external service credentials

### Mobile/client surfaces
Client code should not contain embedded production secrets, privileged tokens, or hidden admin-only logic.

---

## Security expectations for contributors

Contributors and coding agents should:
- keep secrets out of source control
- avoid hardcoding credentials or private endpoints
- preserve authorization checks
- avoid weakening validation or tenant boundaries
- avoid changing startup/import safeguards casually
- document any new security-sensitive config
- treat bridge protocol and bootstrap changes as high risk
- prefer least-privilege and fail-safe defaults

If a change affects auth, startup ordering, DB restore logic, bridge event flow, or deployment behavior, it should be reviewed with extra care.

---

## Out-of-scope or lower-priority reports

The following may be treated as lower priority unless they create a real exploit path:
- missing best-practice headers without exploit impact
- version disclosure without meaningful attack value
- theoretical issues without a practical scenario
- self-XSS or local-only issues without privilege impact
- reports that require unrealistic assumptions with no real deployment relevance

That said, anything that risks data exposure, privilege escalation, cross-tenant access, destructive DB operations, or unauthorized device/control flow should be treated seriously.

---

## Safe handling during testing

Do not test vulnerabilities against production systems unless you have explicit authorization.

Prefer testing in:
- local development environments
- staging environments
- isolated test databases
- non-production device/bridge environments

Do not use real customer data, real secrets, or live destructive restore actions in proof-of-concept testing.

---

## Future improvements

This policy should be updated later to include:
- a dedicated security email address
- formal severity levels
- CVE/advisory process, if needed
- exact supported release/version matrix
- incident response ownership
- secret rotation guidance

Until then, this file should be treated as the repository’s active minimum security reporting and handling policy.
