# AGENTS.md

## Purpose

This file tells coding agents how to work safely and correctly in the `jms_enterprise` repository.

This is not a generic coding-style file. It is a repo operating manual.

Agents must use this file to:
- understand what this repository contains
- identify which subsystem a task belongs to
- avoid changing unrelated areas
- preserve runtime contracts
- keep deployment, bootstrap, scanner, and app behavior stable
- produce small, reviewable, operationally safe changes

---

## Repository identity

`jms_enterprise` is a multi-surface application repository, not a single simple app.

From the verified repository structure, this repo includes at least:

- `BACKEND/`  
  Main server/backend runtime and startup logic

- `CLIENT_BRIDGE/`  
  A separate Node runtime that handles scanner/device connectivity and exposes events over WebSocket

- `ios_app_demo/`  
  A Flutter mobile client/app surface

- Docker/bootstrap/startup scripts  
  Backend startup waits for PostgreSQL and may auto-import a database dump

- Operational scripts/utilities  
  The repo also contains deployment/update/backup style surfaces and should be treated like an ops-aware codebase, not only app code

Agents must assume this repo supports real business workflows and real runtime dependencies.

---

## What is confirmed about this repo

The following are grounded repo facts and must be treated as real constraints:

### 1. Backend startup is ordered and intentional
The backend entrypoint runs startup in this order:

1. wait for PostgreSQL
2. auto-import database if needed
3. start the main app command

Do not casually reorder this sequence.

### 2. PostgreSQL readiness is part of system correctness
The backend includes an explicit Postgres wait script driven by environment variables.  
That means startup reliability depends on DB readiness, not just process launch.

### 3. Database bootstrap can be destructive when forced
The auto-import script can:
- restore from a seed/dump path
- skip import if the `users` table already contains rows
- force replace the database when a force flag is enabled

This area is high risk. Treat it as production-sensitive.

### 4. Scanner bridge is a real runtime service
`CLIENT_BRIDGE/bridge.js` is not a demo helper. It is a dedicated Node service that:
- uses WebSocket
- supports serial and TCP scanner/device connectivity
- broadcasts scanner-related events
- serves as an integration layer between devices and app clients

### 5. Scanner bridge uses a known WebSocket port
The bridge opens a WebSocket server on port `8999`.

Changing this is a breaking operational change unless all consumers/config are updated together.

### 6. Backend is a Node/Express service with business integrations
Backend dependencies indicate support for:
- Express/server behavior
- PostgreSQL/database work
- auth/session-type concerns
- file handling/uploads
- Excel/data import-export style functionality
- AI-related dependencies/integrations

Agents must not assume the backend is only CRUD or only authentication. It likely contains multiple business surfaces.

### 7. Mobile app surface exists
`ios_app_demo/` is a Flutter project.  
Do not assume all product behavior lives only in the backend or bridge.

---

## Agent mission

Your job is to complete the requested task while preserving repo boundaries.

A good change in this repo is:

- scoped to the correct subsystem
- minimally invasive
- compatible with existing runtime behavior
- safe for startup and deployment
- documented when behavior changes
- explicit about operational risk

A bad change in this repo is:

- fixing the wrong layer
- touching startup/bootstrap scripts for unrelated product work
- changing bridge event shapes without coordinating consumers
- altering DB restore behavior for local convenience
- mixing feature work and infra migration in one unfocused diff
- making broad “cleanup” changes in critical runtime paths

---

## Top rule: do not go out of context

Before changing anything, agents must identify which area the task belongs to.

### Map the task to the correct subsystem

#### Use `BACKEND/` when the task is about:
- API behavior
- business rules
- server-side validation
- DB queries or data flow
- uploads/import/export
- auth/session/token handling
- server integrations
- startup application behavior after bootstrap completes

#### Use `CLIENT_BRIDGE/` when the task is about:
- scanners
- serial devices
- TCP device connections
- WebSocket device broadcasting
- bridge connection lifecycle
- device error/status/data messages

#### Use `ios_app_demo/` when the task is about:
- Flutter UI
- mobile navigation
- mobile API consumption
- mobile presentation or state handling
- mobile platform-specific packaging/build behavior

#### Use backend startup/bootstrap scripts when the task is about:
- container startup
- DB readiness
- seed import
- first-run restore
- environment-driven bootstrap behavior

#### Use deployment/update/ops scripts only when the task is explicitly about:
- deployment
- environment provisioning
- backups/restores
- update flow
- operational automation
- release workflow

---

## Out-of-context changes are forbidden

Do not do any of the following:

- Do not change DB bootstrap scripts to solve a normal feature issue.
- Do not edit deployment scripts to fix a local dev inconvenience unless the task explicitly asks for it.
- Do not change scanner bridge payloads for a frontend/UI issue unless the protocol really must change.
- Do not change mobile code to patch a backend contract bug unless the task is explicitly client-side only.
- Do not change ports, hostnames, restore paths, or startup order without documenting impact.
- Do not treat production-sensitive scripts as safe refactor targets.
- Do not combine business logic edits with infrastructure rewrites.
- Do not silently add environment variables.
- Do not weaken safety checks around DB restore/import.
- Do not rewrite critical files just to “modernize” them.

---

## Required discovery workflow before editing

Before making changes, agents must inspect the smallest relevant file set.

### For backend work
Read, at minimum:
- `BACKEND/package.json`
- `BACKEND/server.js`
- any route/controller/service/model files directly involved
- any env/config files referenced by the changed code

### For bridge work
Read, at minimum:
- `CLIENT_BRIDGE/package.json`
- `CLIENT_BRIDGE/bridge.js`
- any helper modules used by device/transport logic

### For mobile work
Read, at minimum:
- `ios_app_demo/pubspec.yaml`
- `ios_app_demo/lib/main.dart`
- relevant screens/services/providers/widgets before changing behavior

### For startup/bootstrap work
Read, at minimum:
- `BACKEND/docker-entrypoint.sh`
- `BACKEND/scripts/wait-for-postgres.js`
- `BACKEND/scripts/auto-import-db-if-needed.js`
- any related Docker/env configuration

### For deployment/ops work
Read the target script end-to-end before editing anything.
Do not make partial assumptions in ops code.

---

## Repository subsystem guide

## 1. BACKEND/

### What this area is for
This is the primary backend application surface.

Agents should assume it contains:
- core business logic
- API/server entrypoint behavior
- database access
- request/response logic
- import/export related behavior
- integration code
- authentication/authorization-related logic
- possibly AI-assisted or AI-adjacent functionality

### Backend rules
- Keep changes local to the feature being touched.
- Preserve existing API contracts unless a contract change is explicitly required.
- Prefer additive fields over breaking response changes.
- Keep validation close to existing patterns.
- Reuse existing middleware/service patterns where possible.
- Do not introduce new framework structure unless the repo already uses it or the task requires it.
- Keep env-driven behavior env-driven.
- Do not hardcode credentials, tokens, hostnames, DB names, or tenant-specific values.
- Avoid broad file moves or architecture rewrites.

### Backend change checklist
Before finishing a backend change, confirm:
- request shape still matches callers
- response shape is unchanged or intentionally documented
- DB queries still match existing schema assumptions
- existing auth/security checks still hold
- uploads/import/export flows still behave correctly
- any new env vars are documented
- any startup dependency changes are documented

---

## 2. CLIENT_BRIDGE/

### What this area is for
This is the hardware/device bridge surface.

Confirmed characteristics:
- separate Node package/runtime
- WebSocket server
- serial support
- TCP support
- scanner/device connection handling
- device events forwarded to clients
- known bridge port: `8999`

### What agents must assume
The bridge likely serves external consumers that expect specific event flow and connection behavior.

That means:
- event names matter
- payload shape matters
- timing/connection lifecycle matters
- error propagation matters
- cleanup and reconnect behavior matter

### Bridge rules
- Preserve compatibility first.
- Do not rename or reshape outgoing events casually.
- Do not change port `8999` unless task explicitly requires a coordinated system-wide update.
- Preserve both serial and TCP support.
- Preserve cleanup/close behavior.
- Preserve client notifications for status, data, and error conditions.
- Avoid hiding transport errors.
- Avoid large refactors in connection state management.
- Prefer narrow, testable fixes over full protocol rewrites.

### Bridge change checklist
Before finishing a bridge change, confirm:
- bridge still starts
- WebSocket server still binds
- serial path still works
- TCP path still works
- clients still receive expected events
- connection close/error behavior is still surfaced
- no breaking event schema changes were introduced silently

---

## 3. ios_app_demo/

### What this area is for
This is the Flutter/mobile application surface.

Agents must assume:
- mobile may depend on backend contracts
- mobile may also depend on scanner bridge data
- UI changes can expose hidden API or contract assumptions
- presentation changes should not mutate backend or bridge behavior unless required

### Mobile rules
- Keep UI changes in mobile scope unless there is a real backend contract issue.
- Do not use mobile changes as a reason to alter stable backend payloads.
- Respect Flutter project structure already in use.
- Keep platform/build config changes isolated from normal UI logic work.
- Do not introduce unnecessary package churn.
- Keep state management aligned with existing project patterns.

### Mobile change checklist
Before finishing a mobile change, confirm:
- app entrypoint/build still works
- changed screens still compile
- API consumption paths are still compatible
- scanner/device-related UI still aligns with existing backend/bridge contracts
- no unrelated package/config changes slipped in

---

## 4. Backend startup and bootstrap scripts

### Files in this category
- `BACKEND/docker-entrypoint.sh`
- `BACKEND/scripts/wait-for-postgres.js`
- `BACKEND/scripts/auto-import-db-if-needed.js`

### Why these are high risk
These scripts affect:
- first startup
- restart behavior
- container readiness
- data restore/import logic
- destructive database operations when forced

### Startup contract
Agents must preserve the current startup model unless the task explicitly changes it:

1. wait for database
2. perform conditional import/restore
3. launch application

### Rules for this area
- Do not reorder startup steps casually.
- Do not remove DB readiness wait without equivalent reliability.
- Do not weaken import-skip checks.
- Do not soften destructive-force behavior into accidental behavior.
- Do not add silent fallbacks that hide failures.
- Do not make restore behavior less explicit.
- Prefer fail-loudly over half-broken startup in production paths.
- Treat restore, recreate, and force flags as sensitive operations.

### Required caution for DB import logic
Because import behavior can recreate/replace DB state:
- never make destructive behavior the default
- keep force behavior explicit
- document impact whenever restore logic changes
- think through fresh DB, existing DB, and partially initialized DB cases separately

### Bootstrap change checklist
Before finishing a bootstrap change, confirm:
- DB wait still blocks until DB is reachable
- timeout/failure still exits clearly
- empty DB path still works
- populated DB skip behavior still works
- force import behavior is still intentional and explicit
- startup still reaches final app command only after prerequisites complete

---

## 5. Deployment, backup, update, and ops utilities

### What agents must assume
This repository contains operational surfaces beyond normal app code.

Those surfaces can affect:
- deployment stability
- restore safety
- backups
- environment rollout
- updates in live or semi-live systems

### Rules for ops scripts
- Do not “clean up” ops code unless task explicitly requires it.
- Do not simplify safety checks for convenience.
- Do not embed environment-specific secrets or machine paths.
- Do not assume local development is the only runtime.
- Do not merge product fixes and ops rewrites in the same change unless necessary.
- Document operator-facing behavior changes.

### Ops change checklist
Before finishing an ops change, confirm:
- command order still makes sense
- rollback path is understood
- logs remain understandable
- destructive operations remain gated
- docs reflect changed usage

---

## Feature boundary rules

Agents must not drift between layers.

### Backend features
Belong in backend when the change is about:
- server logic
- data persistence
- permissions
- processing pipelines
- business calculations
- exports/imports
- integration endpoints

### Bridge features
Belong in bridge when the change is about:
- device input
- scanner communication
- raw device transport
- WebSocket relay of device data
- connection state transitions

### Mobile features
Belong in Flutter app when the change is about:
- rendering
- navigation
- user interaction
- local state
- screen-level behavior

### Bootstrap/deploy features
Belong in scripts/ops only when the change is about:
- startup lifecycle
- infrastructure readiness
- first-run import
- deploy/release workflow
- backup/restore procedures

---

## Compatibility rules

Compatibility is a first-class requirement.

### Do not break these casually
- backend request/response contracts
- auth assumptions
- database bootstrap behavior
- bridge event semantics
- serial/TCP scanner support
- WebSocket bridge port/config behavior
- startup ordering
- env-driven configuration behavior

### Preferred compatibility strategy
When change is needed:
- add instead of replace
- preserve old behavior when possible
- document any required migrations
- call out consumer impact explicitly

---

## Environment, config, and secrets rules

### Secrets
Never:
- commit secrets
- commit real passwords
- hardcode API keys
- hardcode DB creds
- hardcode private URLs or tenant-specific endpoints

### Environment variables
- Keep configuration environment-driven.
- Reuse existing env names/patterns when possible.
- Do not silently invent new env variables.
- Any new env variable must be documented with purpose, default behavior, and impact.
- If a new env var changes startup or restore semantics, mark it as high risk in the change summary.

### Paths and hostnames
- Do not hardcode local machine paths.
- Preserve configurable dump/import paths.
- Treat `/seed` and import path behavior as part of deployment logic, not personal dev shortcuts.

---

## Database safety rules

When touching DB-related code:
- assume real data exists
- assume migration/restore mistakes are expensive
- avoid destructive defaults
- preserve skip checks for already-initialized systems unless explicitly changing that behavior
- call out schema assumptions
- verify compatibility with existing startup/import scripts

If a change affects:
- schema
- seed/import expectations
- startup restore logic
- data presence checks

then the change must include:
- impact description
- rollout note
- rollback note
- validation steps

---

## Logging and error-handling rules

- Preserve operator visibility.
- Do not swallow errors in critical startup or bridge paths.
- Keep logs actionable.
- Prefer explicit failure on unrecoverable startup conditions.
- Preserve client-visible error/status flows where consumers depend on them.
- Avoid noisy debug output in production-sensitive paths unless task explicitly requires it.

---

## Allowed change size

Default to small, targeted diffs.

### Good changes
- focused bug fix in one subsystem
- small contract-preserving improvement
- clearly documented env/config addition
- surgical startup script fix
- narrow bridge protocol bug fix
- localized Flutter UI fix

### Bad changes
- broad refactor with no feature need
- mixed mobile/backend/infra rewrite
- framework migration during unrelated work
- renaming or moving many files in critical runtime areas
- changing startup, restore, and protocol behavior all at once

---

## Mandatory validation by subsystem

Agents must validate the specific area they changed.

## Backend validation
At minimum:
- app still starts in the expected way
- changed route/service logic still works
- no obvious request/response contract break
- DB-dependent code still matches runtime assumptions
- any import/export/upload logic touched still behaves correctly

## Bridge validation
At minimum:
- process starts
- WebSocket server binds
- serial path still initializes correctly
- TCP path still initializes correctly
- event flow still reaches clients
- error and close flows still propagate

## Mobile validation
At minimum:
- Flutter project still builds/compiles for changed area
- changed screen path still works
- API consumption remains compatible
- any bridge-related UI still matches current event expectations

## Startup/bootstrap validation
At minimum:
- DB wait still works
- import-skip logic still works
- force-import path remains explicit
- final app command still runs after prerequisites
- errors remain visible and fail correctly

## Ops/deploy validation
At minimum:
- script still executes in intended order
- destructive steps remain gated
- operator-facing behavior is documented
- no hidden environment coupling was introduced

---

## Definition of done

A task is not done unless all of the following are true:

- the correct subsystem was changed
- unrelated subsystems were not touched without reason
- runtime contracts were preserved or intentionally documented
- risky areas were handled conservatively
- validation was performed for the changed area
- docs/config notes were updated where needed
- the final summary clearly explains impact and risk

---

## Documentation policy

When behavior changes, agents must update documentation in the same change when relevant.

This includes:
- setup instructions
- runtime instructions
- deployment notes
- env var documentation
- startup/bootstrap notes
- scanner/bridge usage notes
- restore/import notes
- mobile setup or usage notes
- this `AGENTS.md` when repo conventions change

Do not leave behavior changes undocumented.

---

## Required PR/change summary format

Every agent-produced diff or PR summary should include:

### 1. What changed
A concrete summary of files and behavior changed.

### 2. Why it changed
Bug, feature, refactor-for-required-reason, or ops fix.

### 3. Which subsystem it belongs to
One or more of:
- backend
- scanner bridge
- mobile
- startup/bootstrap
- deploy/ops

### 4. Risk level
Use:
- Low
- Medium
- High

### 5. Compatibility impact
State whether these changed:
- API contract
- bridge event contract
- startup behavior
- DB import/restore behavior
- mobile behavior
- env/config requirements

### 6. Validation performed
List what was actually checked.

### 7. Follow-up items
Only include real follow-ups. Do not invent them.

---

## Required wording for risky changes

If the change affects any of the following:
- DB restore/import
- startup ordering
- bridge event shape
- port/config defaults
- auth/security behavior
- deployment scripts

the summary must explicitly say:
- what compatibility risk exists
- who/what may be impacted
- whether rollback is simple or not

---

## Read-before-edit matrix

Use this matrix before touching code.

### Task: backend API or business logic
Read:
- `BACKEND/package.json`
- `BACKEND/server.js`
- directly related route/service/model files

### Task: scanner/device issue
Read:
- `CLIENT_BRIDGE/package.json`
- `CLIENT_BRIDGE/bridge.js`
- any transport/parser/helper modules involved

### Task: mobile UI change
Read:
- `ios_app_demo/pubspec.yaml`
- `ios_app_demo/lib/main.dart`
- related widgets/screens/services

### Task: startup/import problem
Read:
- `BACKEND/docker-entrypoint.sh`
- `BACKEND/scripts/wait-for-postgres.js`
- `BACKEND/scripts/auto-import-db-if-needed.js`

### Task: deploy/update/backup script
Read the entire script and related docs before modifying it.

---

## Safe default behavior when uncertain

When you are not sure:
1. stop expanding scope
2. identify the subsystem again
3. inspect the local files involved
4. preserve existing contracts
5. choose additive change over breaking change
6. document assumptions in summary
7. avoid touching startup, restore, scanner protocol, or ops code unless task clearly requires it

Stability beats cleverness in this repository.

---

## Preferred agent style for this repo

Agents working in `jms_enterprise` should be:

- surgical
- conservative in critical paths
- aware of runtime boundaries
- careful with data/bootstrap behavior
- strict about compatibility
- explicit about risk
- disciplined about not drifting across subsystems

---

## Final instruction

Do not treat this repo as a generic full-stack sandbox.

It is a multi-runtime operational repository with:
- backend application logic
- device/scanner bridge logic
- mobile client logic
- database bootstrap logic
- deployment/ops-sensitive scripts

Work inside the correct boundary.
Protect existing contracts.
Do not go out of context.

---

## Known commands and entrypoints

These are the repo-aligned entrypoints agents should prefer when checking or running the changed surface.
Do not invent alternate commands when the repo already has a direct runtime entrypoint.
Do not assume a test suite exists unless it is defined in the relevant manifest.

### Backend
Use this surface for backend/API work.

Common entrypoint:
```bash
cd BACKEND
npm install
node server.js
```

Backend command rules:
- Prefer the existing `server.js` entrypoint for direct runtime checks.
- Only run package scripts that actually exist in `BACKEND/package.json`.
- Do not add dependencies unless the task truly requires them.
- Do not replace entrypoint behavior with a new framework or loader unless explicitly required.

### Scanner bridge
Use this surface for scanner, serial, TCP, or WebSocket relay work.

Common entrypoint:
```bash
cd CLIENT_BRIDGE
npm install
node bridge.js
```

Bridge command rules:
- Preserve bridge startup behavior.
- Do not introduce a new runtime wrapper unless the task explicitly requires it.
- Do not change the bridge port contract casually.

### Mobile app
Use this surface for Flutter/mobile work.

Common entrypoint:
```bash
cd ios_app_demo
flutter pub get
flutter run
```

Useful non-destructive check:
```bash
cd ios_app_demo
flutter analyze
```

Mobile command rules:
- Keep Flutter dependency changes minimal.
- Do not add packages for convenience when existing project code can solve the task.
- Do not edit platform/build files unless the task actually requires platform-level changes.

### Startup and bootstrap
When validating startup behavior, use the existing backend bootstrap flow rather than bypassing it.
Relevant files:
- `BACKEND/docker-entrypoint.sh`
- `BACKEND/scripts/wait-for-postgres.js`
- `BACKEND/scripts/auto-import-db-if-needed.js`

Do not test bootstrap behavior by skipping the readiness/import path and then assume the system is correct.

---

## Folder ownership and responsibility map

Agents must route work to the correct folder.
If a task spans multiple folders, clearly explain why and keep the cross-folder diff minimal.

### `BACKEND/`
Owner scope:
- API behavior
- business rules
- data access
- validation
- auth/session logic
- imports/exports/uploads
- server integrations
- app startup after bootstrap completes

Files here should not be changed for:
- scanner transport fixes
- Flutter UI-only work
- deployment-only changes unless directly required

### `CLIENT_BRIDGE/`
Owner scope:
- scanner/device connectivity
- serial transport
- TCP transport
- WebSocket relay behavior
- device status/data/error propagation
- bridge lifecycle handling

Files here should not be changed for:
- API schema redesign
- Flutter-only presentation bugs
- DB bootstrap changes

### `ios_app_demo/`
Owner scope:
- Flutter UI
- mobile flows
- mobile navigation
- screen logic
- app-side API usage
- app-side device/scanner presentation

Files here should not be changed for:
- server-side business rules
- scanner transport behavior
- deployment/bootstrap logic

### `BACKEND/scripts/` and `BACKEND/docker-entrypoint.sh`
Owner scope:
- DB readiness
- bootstrap/import/restore behavior
- startup ordering
- first-run initialization
- container startup flow

Files here should not be changed for:
- normal UI features
- normal API bug fixes unless startup is directly involved
- scanner behavior unrelated to startup

### Manifest files
Critical manifests include:
- `BACKEND/package.json`
- `CLIENT_BRIDGE/package.json`
- `ios_app_demo/pubspec.yaml`

Only change these when:
- a dependency is truly required
- a script must change for a valid repo-level reason
- a version/config change is necessary for the requested work

Do not churn manifests casually.

---

## Common task to file routing

Use this section to keep agents from solving the right problem in the wrong place.

### If the issue is about API response, validation, data save, auth, or business logic
Primary area:
- `BACKEND/`

### If the issue is about scanner not connecting, serial/TCP issues, missing device data, or WebSocket relay behavior
Primary area:
- `CLIENT_BRIDGE/`

### If the issue is about mobile layout, Flutter UX, navigation, or app-side display/state
Primary area:
- `ios_app_demo/`

### If the issue is about startup hanging, DB not ready, restore/import behavior, or first-run initialization
Primary area:
- `BACKEND/docker-entrypoint.sh`
- `BACKEND/scripts/`

### If the issue is about backup, deploy, update, or operational scripts
Primary area:
- ops/deployment scripts only

### If a task seems to require touching everything
Stop and reduce scope first.
Most tasks in this repo should be solved in one subsystem.
Cross-subsystem edits require an explicit reason.

---

## Critical files: do not touch casually

These files have outsized operational impact.
Changes here must be intentional, minimal, and documented.

### Highest-risk files
- `AGENTS.md`
- `BACKEND/server.js`
- `BACKEND/docker-entrypoint.sh`
- `BACKEND/scripts/wait-for-postgres.js`
- `BACKEND/scripts/auto-import-db-if-needed.js`
- `CLIENT_BRIDGE/bridge.js`

### High-sensitivity manifests
- `BACKEND/package.json`
- `CLIENT_BRIDGE/package.json`
- `ios_app_demo/pubspec.yaml`

### Rules for critical files
- Do not refactor these for style only.
- Do not rename, move, or split them casually.
- Do not change behavior without updating docs and summary notes.
- Do not batch unrelated edits into these files.
- For startup, bootstrap, or bridge protocol changes, include rollback notes.
- For manifest changes, explain why the dependency or script change is required.

---

## Dependency and package change policy

Dependency churn is a common source of out-of-context edits.
Agents must be conservative.

### Before adding a dependency
Ask internally:
- Is this already possible with existing dependencies?
- Is this change required by the task, or just convenient?
- Does this affect startup, package size, build stability, or deployment?

### Allowed dependency changes
- necessary bug fix dependency
- required SDK/package update for the requested task
- security or compatibility change directly relevant to the task

### Disallowed dependency changes
- convenience libraries for small tasks
- broad modernization not requested by the task
- multiple package upgrades unrelated to the requested work
- package-manager churn for style reasons

---

## Required agent PR template

Agents should use this template when proposing a PR, commit summary, or change summary.

```md
## Summary
- What changed:
- Why it changed:
- Subsystem:

## Files touched
- `path/to/file`
- `path/to/file`

## Risk
- Risk level: Low | Medium | High
- Compatibility impact:
- Operational impact:

## Validation
- Commands run:
- What was verified:
- What remains unverified:

## Docs
- Updated docs:
- AGENTS.md updated: Yes/No

## Rollback
- Rollback approach:
```

### Additional requirements for risky changes
If the PR touches any of the following:
- startup ordering
- DB restore/import logic
- bridge event schema or port behavior
- auth/security behavior
- deployment scripts
- manifest/dependency changes

then the summary must also say:
- who or what might break
- whether the change is additive or breaking
- whether rollback is simple, medium, or hard

---

## Documentation sync checklist

When changing behavior, agents should check whether these also need updates:
- `AGENTS.md`
- README/setup notes
- env var documentation
- startup/bootstrap instructions
- scanner or bridge usage notes
- restore/import notes
- mobile usage notes
- deployment/operator instructions

Do not leave operational behavior changes undocumented.

---

## Final guardrail for agents

When in doubt, choose the narrowest valid change.
In this repo, wrong-scope fixes are more dangerous than small incomplete fixes.
It is better to clearly say a change belongs in another subsystem than to patch the wrong layer.
