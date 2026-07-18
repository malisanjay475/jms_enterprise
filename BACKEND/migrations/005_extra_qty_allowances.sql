-- Extra Qty Allowances: PPC/admin roles can grant extra production qty
-- (beyond the 10% colour over-production cap) per plan + colour, with remarks.
CREATE TABLE IF NOT EXISTS extra_qty_allowances (
  id            SERIAL PRIMARY KEY,
  plan_id       TEXT NOT NULL,
  order_no      TEXT,
  jc_no         TEXT,
  machine       TEXT,
  mould_name    TEXT,
  colour        TEXT NOT NULL,
  extra_qty     INTEGER NOT NULL CHECK (extra_qty > 0),
  remarks       TEXT NOT NULL,
  allowed_by    TEXT NOT NULL,
  allowed_role  TEXT NOT NULL,
  allowed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  factory_id    TEXT,
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_eqa_plan_colour
  ON extra_qty_allowances (plan_id, colour) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_eqa_allowed_at
  ON extra_qty_allowances (allowed_at);

-- Natural key guard for LOCAL<->MAIN sync (serial ids differ across servers):
CREATE UNIQUE INDEX IF NOT EXISTS uq_eqa_natural
  ON extra_qty_allowances (plan_id, colour, allowed_by, allowed_at);
