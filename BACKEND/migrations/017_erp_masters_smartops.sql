-- ERP Masters copied from Smart Ops (src/modules/erpMasters). Smart Ops pulls the JOYO
-- ERP every 5 minutes; MAIN pulls the changed rows from Smart Ops every 5 minutes.
-- smartops_id is Smart Ops' own row id (unique, stable), so re-reads are plain upserts.
-- synced_at / smartops_sync_state.since are kept as the exact text Smart Ops sends
-- (microseconds), never round-tripped through a JS Date.
-- New tables only; no existing master is touched.
-- Rollback: DROP TABLE jo_erp_item_master, jo_erp_variant_master, jo_erp_party_master,
--           jo_erp_rate_master, smartops_sync_state;

CREATE TABLE IF NOT EXISTS jo_erp_item_master (
  smartops_id BIGINT PRIMARY KEY,
  item_id INT,
  item_code TEXT,
  item_name TEXT,
  uom TEXT,
  tax_rate NUMERIC,
  category TEXT,
  project_id TEXT,
  project_name TEXT,
  item_weight NUMERIC,
  hsn_code TEXT,
  is_active BOOLEAN,
  action TEXT,
  synced_at TEXT,
  local_updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jo_erp_item_master_item_id ON jo_erp_item_master (item_id);
CREATE INDEX IF NOT EXISTS idx_jo_erp_item_master_item_code ON jo_erp_item_master (item_code);

CREATE TABLE IF NOT EXISTS jo_erp_variant_master (
  smartops_id BIGINT PRIMARY KEY,
  item_id INT,
  our_code TEXT,
  our_name TEXT,
  party_code TEXT,
  party TEXT,
  party_item_name TEXT,
  party_item_code TEXT,
  po_item_name TEXT,
  party_item_barcode TEXT,
  party_group TEXT,
  party_packing_size TEXT,
  our_party_item_code TEXT,
  content TEXT,
  capacity TEXT,
  barcode_item_name TEXT,
  barcode_outer_label_item_code TEXT,
  remarks TEXT,
  gross_weight NUMERIC,
  inner_carton_qty NUMERIC,
  vendor_code TEXT,
  number_of_design INT,
  number_of_color INT,
  outer_label_category TEXT,
  outer_l NUMERIC,
  outer_w NUMERIC,
  outer_h NUMERIC,
  per_pkg_cbm NUMERIC,
  action TEXT,
  synced_at TEXT,
  local_updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jo_erp_variant_master_our_code ON jo_erp_variant_master (our_code);
CREATE INDEX IF NOT EXISTS idx_jo_erp_variant_master_party_item_code ON jo_erp_variant_master (party_item_code);
CREATE INDEX IF NOT EXISTS idx_jo_erp_variant_master_party_group ON jo_erp_variant_master (party_group);

CREATE TABLE IF NOT EXISTS jo_erp_party_master (
  smartops_id BIGINT PRIMARY KEY,
  party_id INT,
  party_code TEXT,
  party_group TEXT,
  price_group TEXT,
  party_name TEXT,
  party_type TEXT,
  gstin TEXT,
  pan TEXT,
  is_unregistered_for_gst TEXT,
  payment_term TEXT,
  credit_days INT,
  sales_person TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  contact_number TEXT,
  email TEXT,
  is_active BOOLEAN,
  action TEXT,
  synced_at TEXT,
  local_updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jo_erp_party_master_party_id ON jo_erp_party_master (party_id);
CREATE INDEX IF NOT EXISTS idx_jo_erp_party_master_party_code ON jo_erp_party_master (party_code);
CREATE INDEX IF NOT EXISTS idx_jo_erp_party_master_gstin ON jo_erp_party_master (gstin);

CREATE TABLE IF NOT EXISTS jo_erp_rate_master (
  smartops_id BIGINT PRIMARY KEY,
  item_id INT,
  our_code TEXT,
  our_name TEXT,
  party_item_name TEXT,
  party_item_code TEXT,
  po_item_name TEXT,
  party_group TEXT,
  price_group TEXT,
  factory_id INT,
  factory TEXT,
  uom TEXT,
  mrp_price NUMERIC,
  offer_price NUMERIC,
  rate NUMERIC,
  effective_date TEXT,
  synced_at TEXT,
  local_updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jo_erp_rate_master_our_code ON jo_erp_rate_master (our_code);
CREATE INDEX IF NOT EXISTS idx_jo_erp_rate_master_party_group ON jo_erp_rate_master (party_group);

CREATE TABLE IF NOT EXISTS smartops_sync_state (
  master_key TEXT PRIMARY KEY,
  since TEXT,
  after_id BIGINT,
  row_count INT,
  status TEXT NOT NULL DEFAULT 'never',
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT
);
INSERT INTO smartops_sync_state (master_key, status) VALUES
  ('item', 'never'), ('variant', 'never'), ('party', 'never'), ('rate', 'never')
ON CONFLICT (master_key) DO NOTHING;
