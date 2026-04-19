# Reliability Plan for JMS Enterprise

## Goal

Build JMS Enterprise so that accepted data is not silently lost when:
- app process crashes
- browser refreshes
- internet goes down
- main server is unavailable
- local machine restarts
- database host fails

The real target is:
- local durability first
- retryable sync second
- backup and restore always

---

## What data this covers

This plan applies to all important data, including:
- scanner and device events
- hourly entries
- manual form entries
- production/job updates
- uploads/imports
- local-to-main sync traffic

---

## Current repo reality

The repo already has:
- `BACKEND/` as the main backend
- `CLIENT_BRIDGE/bridge.js` for serial/TCP scanner and WebSocket relay
- PostgreSQL startup wait logic
- DB import/bootstrap logic
- Docker Compose with app + Postgres + Nginx

This plan improves the current repo instead of assuming the future architecture is already complete.

---

## Non-negotiable rules

### 1. Local DB is the first source of truth
No critical event is considered accepted until it is stored in local PostgreSQL.

### 2. Browser/UI is never the source of truth
The UI can disconnect or crash. Important data must already be stored before UI update is trusted.

### 3. Internet must not be required for local acceptance
If the central server is down, local factory writes must still succeed and sync later.

### 4. Every accepted write must be retryable
If sync fails, the data must stay queued durably until acknowledged.

### 5. Retries must be idempotent
The same event may be delivered more than once. Duplicate delivery must not create duplicate business data.

---

## Target write flow

## A. Scanner and device data
1. Device sends event to `CLIENT_BRIDGE/`
2. Bridge generates `event_id`
3. Bridge sends event to local backend ingest endpoint
4. Backend writes raw event to local PostgreSQL
5. Backend returns success only after DB commit
6. Backend or bridge emits UI/WebSocket update
7. Sync worker sends event to main server asynchronously

## B. Hourly/manual/business entries
1. User submits to backend
2. Backend validates input
3. Backend writes business record to local PostgreSQL
4. In the same transaction, backend writes an outbox row
5. Request returns success
6. Background worker syncs outbox row to main server

This means all important data becomes durable locally before any remote dependency matters.

---

## Required database additions

## 1. Raw event table
Store low-level accepted incoming events.

Suggested columns:
- `id`
- `event_id`
- `factory_id`
- `source_type`
- `source_id`
- `event_type`
- `occurred_at`
- `received_at`
- `payload_json`
- `status`
- `processed_at`
- `processing_error`

Use this for:
- scanner events
- machine readings
- external device payloads
- replay and audit

## 2. Outbox table
Store durable sync work.

Suggested columns:
- `id`
- `event_id`
- `factory_id`
- `aggregate_type`
- `aggregate_id`
- `operation_type`
- `payload_json`
- `status`
- `retry_count`
- `next_retry_at`
- `last_error`
- `created_at`
- `acked_at`

Use this for:
- hourly entries
- job updates
- inventory or production changes
- any write that must reach central server

## 3. Dead-letter state
Repeatedly failing sync rows must move to a visible failed state.
They must not disappear silently.

---

## Repo-specific changes

## `CLIENT_BRIDGE/`
Change the bridge from a live relay into a durable ingest producer.

Required changes:
- generate `event_id`
- POST accepted events to local backend ingest API
- only treat event as accepted after backend confirms DB write
- keep WebSocket UX, but make it secondary to durability
- optionally add short emergency spool if backend is briefly unavailable

## `BACKEND/`
Required additions:
- device ingest endpoint such as `POST /ingest/device-event`
- raw event persistence service
- transactional business write helper
- outbox persistence in same transaction as business writes
- sync worker with retries and backoff
- dead-letter handling
- health endpoints for DB, queue backlog, and last sync time

## `BACKEND/scripts/`
Production startup must be separated from destructive restore/bootstrap logic.

Required rule:
- normal mode must not perform destructive import automatically
- bootstrap/restore must be explicit and logged

---

## Backup and recovery design

## 1. Continuous WAL archiving
Use PostgreSQL WAL archiving for near-real-time recovery.
Do not try to use `pg_dump` every few seconds.

## 2. Daily base backup
Use one of:
- `pgBackRest`
- `WAL-G`

## 3. Off-host storage
Backups must be stored outside the same machine.
Use object storage or another server.

## 4. Restore drills
Test restore regularly.
A backup is not real until restore is verified.

## 5. Replica
Add a standby Postgres replica for important environments to reduce downtime and improve recovery.

---

## Observability requirements

Track at least:
- events received per minute
- outbox pending count
- oldest pending outbox age
- dead-letter count
- last successful sync time
- backup freshness
- WAL archive freshness
- bridge ingest failure rate
- local DB health

Alert on:
- backup failure
- sync backlog growth
- dead-letter entries
- no heartbeat from local system
- restore test failure

---

## Phased implementation

## Phase 1: No silent local data loss
- add raw event table
- add outbox table
- add ingest endpoint
- add event IDs and idempotency
- make important writes transactional with outbox

## Phase 2: Reliable sync
- add worker retries
- add backoff
- add dead-letter handling
- make central receiver idempotent

## Phase 3: Backup and restore hardening
- add WAL archive
- add base backups
- add off-host storage
- add restore runbook and restore tests

## Phase 4: Availability and monitoring
- add replica
- add health dashboards
- add alerting
- add failover procedure

---

## Definition of done

JMS Enterprise can be called strongly reliable when:
- scanner/device data is stored durably before being considered accepted
- hourly/manual/business entries are written locally with transactional outbox rows
- sync retries are durable and idempotent
- failed sync is visible
- backups are continuous plus periodic
- restore is tested
- destructive restore is separated from normal startup

---

## First implementation priority

Start with this exact order:
1. durable local ingest for bridge/device data
2. transactional outbox for hourly/manual/business entries
3. reliable sync worker
4. WAL backup + base backup + restore drill
5. replica + alerting

This is the shortest path from the current repo to a world-class reliability foundation.
