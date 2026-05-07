-- ERP integration tables and plan_board column
-- Safe to run on any DB — all statements use IF NOT EXISTS / IF EXISTS guards

CREATE TABLE IF NOT EXISTS erp_sync_log (
  id            SERIAL PRIMARY KEY,
  endpoint      VARCHAR(100),
  status        VARCHAR(20),
  payload_hash  VARCHAR(64),
  error_message TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bom_master (
  id           SERIAL PRIMARY KEY,
  erp_bom_id   VARCHAR(255),
  product_code VARCHAR(100),
  version      INTEGER DEFAULT 1,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_product ON bom_master(product_code);

CREATE TABLE IF NOT EXISTS bom_components (
  id             SERIAL PRIMARY KEY,
  bom_master_id  INTEGER REFERENCES bom_master(id) ON DELETE CASCADE,
  component_code VARCHAR(100),
  description    TEXT,
  qty_per_unit   NUMERIC(10,4),
  uom            VARCHAR(20),
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jc_details (
  id         SERIAL PRIMARY KEY,
  data       JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jc_details_unique_jc_no
  ON jc_details ((data->>'job_card_no'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_board') THEN
    ALTER TABLE plan_board ADD COLUMN IF NOT EXISTS erp_ref_id VARCHAR(255);
  END IF;
END $$;
