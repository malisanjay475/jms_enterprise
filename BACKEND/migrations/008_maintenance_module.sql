-- Maintenance Module: Machine & Mould maintenance tickets + technician worklogs.
-- One table drives both sub-menus (asset_type = 'machine' | 'mould').
--
-- Sync rules (LOCAL<->MAIN): surrogate sync_id natural key (NEVER the serial id),
-- factory_id scope, updated_at + is_deleted for last-write-wins. Both tables are
-- added to sync.service.js SYNC_ALL + CONFLICT_KEYS('sync_id') + SYNC_ID_REQUIRED_TABLES.
-- [[project_assembly_plans_sync_id]] [[project_sync_conflict_natural_key]]

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id                  SERIAL PRIMARY KEY,
  sync_id             UUID NOT NULL DEFAULT gen_random_uuid(),
  ticket_no           TEXT,                 -- human ref, factory-scoped sequence e.g. MNT-26-0417
  asset_type          TEXT NOT NULL DEFAULT 'machine',  -- 'machine' | 'mould'
  machine             TEXT,                 -- machine ref (asset_type='machine')
  mould_name          TEXT,                 -- mould ref  (asset_type='mould')
  mould_code          TEXT,
  plan_id             TEXT,                 -- plan running when it went down (nullable)
  order_no            TEXT,
  status              TEXT NOT NULL DEFAULT 'reported',
                       -- reported | acknowledged | in_progress | handover | closed | rejected
  priority            TEXT NOT NULL DEFAULT 'normal',    -- low | normal | high | breakdown
  problem_desc        TEXT,                 -- what the supervisor reported
  fix_desc            TEXT,                 -- what maintenance did (on handover)
  reported_by         TEXT,
  assigned_to         TEXT,
  rejected_by         TEXT,
  rejected_reason     TEXT,
  -- lifecycle stamps (durations are derived from these, never typed)
  down_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- went into maintenance
  ack_at              TIMESTAMPTZ,
  work_started_at     TIMESTAMPTZ,          -- technician tapped Start Job
  handover_at         TIMESTAMPTZ,          -- machine handed back
  rejected_at         TIMESTAMPTZ,
  expected_ready_date DATE,                 -- ETA date shown in DPR Compliance Summary
  expected_ready_time TIME,                 -- ETA time (optional)
  downtime_ref        TEXT,                 -- link to the dpr_hourly downtime this created, so reject/handover can reverse it
  factory_id          INTEGER,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_tickets_sync_id
  ON maintenance_tickets (sync_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_open
  ON maintenance_tickets (factory_id, asset_type, status)
  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_machine
  ON maintenance_tickets (machine) WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS maintenance_worklogs (
  id              SERIAL PRIMARY KEY,
  sync_id         UUID NOT NULL DEFAULT gen_random_uuid(),
  ticket_sync_id  UUID NOT NULL,            -- parent ticket (link by sync_id, not serial)
  note            TEXT NOT NULL,
  minutes         INTEGER,                  -- time spent this entry (optional)
  logged_by       TEXT,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  factory_id      INTEGER,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_worklogs_sync_id
  ON maintenance_worklogs (sync_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_worklogs_ticket
  ON maintenance_worklogs (ticket_sync_id) WHERE is_deleted = FALSE;
