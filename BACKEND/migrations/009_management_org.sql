-- Management / Organisation Structure (superadmin only).
-- Joyo Plastics org: units -> departments/grades/designations -> people, with a
-- reports_to hierarchy. People are NOT app users (most never log in); a person may
-- optionally link to a users row via user_id.
--
-- Sync rules (LOCAL<->MAIN): surrogate sync_id natural key (never serial id),
-- is_deleted + updated_at last-write-wins. All org_* tables are added to
-- sync.service.js SYNC_ALL + CONFLICT_KEYS('sync_id') + SYNC_ID_REQUIRED_TABLES.

CREATE TABLE IF NOT EXISTS org_units (
  id          SERIAL PRIMARY KEY,
  sync_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  code        TEXT,
  unit_type   TEXT NOT NULL DEFAULT 'plant',   -- ho | plant | warehouse
  factory_id  INTEGER,                         -- nullable link to factories.id
  location    TEXT,
  sort_order  INTEGER DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_units_sync_id ON org_units (sync_id);

CREATE TABLE IF NOT EXISTS org_departments (
  id          SERIAL PRIMARY KEY,
  sync_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  code        TEXT,
  sort_order  INTEGER DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_departments_sync_id ON org_departments (sync_id);

CREATE TABLE IF NOT EXISTS org_grades (
  id          SERIAL PRIMARY KEY,
  sync_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  band_name   TEXT NOT NULL,                   -- Top Management, Middle Management, ...
  level_code  TEXT,                            -- 1A, 1B, ... 6B
  rank_order  INTEGER DEFAULT 100,             -- lower = more senior
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_grades_sync_id ON org_grades (sync_id);

CREATE TABLE IF NOT EXISTS org_designations (
  id             SERIAL PRIMARY KEY,
  sync_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,                -- Plant Manager, Tool Room Manager, Operator ...
  grade_id       INTEGER,                      -- -> org_grades.id (nullable)
  department_id  INTEGER,                      -- -> org_departments.id (nullable)
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_designations_sync_id ON org_designations (sync_id);

CREATE TABLE IF NOT EXISTS org_people (
  id             SERIAL PRIMARY KEY,
  sync_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  emp_code       TEXT,
  full_name      TEXT NOT NULL,
  unit_id        INTEGER,                      -- -> org_units.id
  department_id  INTEGER,                      -- -> org_departments.id
  designation_id INTEGER,                      -- -> org_designations.id
  grade_id       INTEGER,                      -- -> org_grades.id
  reports_to_id  INTEGER,                      -- -> org_people.id (the manager)
  user_id        INTEGER,                      -- nullable -> users.id (if they have a login)
  phone          TEXT,
  email          TEXT,
  doj            DATE,
  status         TEXT NOT NULL DEFAULT 'active',  -- active | left
  notes          TEXT,
  sort_order     INTEGER DEFAULT 100,
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_people_sync_id ON org_people (sync_id);
CREATE INDEX IF NOT EXISTS idx_org_people_unit ON org_people (unit_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_org_people_reports ON org_people (reports_to_id) WHERE is_deleted = FALSE;

-- ---- Seed: the 8 Joyo Plastics units (Head Office first) ----
INSERT INTO org_units (name, code, unit_type, location, sort_order) VALUES
  ('Head Office',        'HO',   'ho',        'Joyo Plastics', 10),
  ('Dungra Plant 1',     'DP1',  'plant',     'Dungra',        20),
  ('Dungra Plant 2',     'DP2',  'plant',     'Dungra',        30),
  ('Kachigam Premier',   'KACH', 'plant',     'Kachigam',      40),
  ('Matoshree Plant',    'MATO', 'plant',     'Matoshree',     50),
  ('Shavani Plant',      'SHAV', 'plant',     'Shavani',       60),
  ('Sabri Plant',        'SABRI','plant',     'Sabri',         70),
  ('Warehouse & Dispatch','WH',  'warehouse', 'Warehouse',     80)
ON CONFLICT DO NOTHING;

-- ---- Seed: departments (from the structure sheet) ----
INSERT INTO org_departments (name, sort_order) VALUES
  ('Production', 10), ('Tool Room', 20), ('Quality (QC/QA)', 30), ('Planning (PPC)', 40),
  ('Maintenance / Engineering', 50), ('Packing', 60), ('Warehouse & Dispatch', 70),
  ('Sales Coordination', 80), ('Purchase', 90), ('Stores (RM/MB/Packing)', 100),
  ('Accounts & Billing', 110), ('HR', 120), ('IT', 130), ('Admin', 140),
  ('Security', 150), ('Facility', 160), ('Housekeeping', 170), ('Canteen', 180),
  ('Shifting', 190)
ON CONFLICT DO NOTHING;

-- ---- Seed: grade bands with level codes (editable) ----
INSERT INTO org_grades (band_name, level_code, rank_order) VALUES
  ('Top Management', '1A', 10), ('Top Management', '1B', 11), ('Top Management', '1C', 12),
  ('Middle Management', '2A', 20), ('Middle Management', '2B', 21),
  ('Assistant Manager / Incharge', '3A', 30), ('Assistant Manager / Incharge', '3B', 31),
  ('Engineers', '4A', 40),
  ('Sr Executive / Sr Supervisor', '4B', 45),
  ('Executive / Supervisor', '5A', 50),
  ('Operators / Helpers', '6A', 60),
  ('Packing Ladies / Helpers', '6B', 61)
ON CONFLICT DO NOTHING;

-- ---- Seed: common designations (grade/department linked later in-app) ----
INSERT INTO org_designations (title) VALUES
  ('Chairman / MD'), ('COO'), ('CFO'), ('CMO'),
  ('General Manager / Plant Manager'), ('Sr Production Manager'), ('Production Manager'),
  ('Tool Room Manager'), ('QC / QA Incharge'), ('Maintenance Engineer'),
  ('Warehouse / Dispatch Manager'), ('HR / IT / Admin Manager'), ('Purchase Manager'),
  ('Accounts & Billing Manager'), ('Asst. Manager'), ('Section Incharge'),
  ('Engineer'), ('Jr. Engineer'), ('Sr Supervisor'), ('Supervisor'),
  ('Coordinator'), ('Die Setter'), ('Production Writer'), ('Operator'),
  ('Helper'), ('Driver'), ('Security Guard'), ('Office Assistant'),
  ('Packing Incharge'), ('Packing Staff'), ('Data Entry')
ON CONFLICT DO NOTHING;

-- Link units to existing factories by name where an obvious match exists
-- (best-effort). Guarded: on a fresh DB the `factories` table may not exist yet
-- when this migration runs, so only attempt the link when it's present.
DO $$
BEGIN
  IF to_regclass('public.factories') IS NOT NULL THEN
    UPDATE org_units u SET factory_id = f.id
      FROM factories f
     WHERE u.factory_id IS NULL
       AND LOWER(TRIM(f.name)) = LOWER(TRIM(u.name));
  END IF;
END $$;
