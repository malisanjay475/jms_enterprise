-- Delete-audit columns for extra_qty_allowances.
-- Admin / Superadmin can soft-delete an extra-qty grant (is_deleted = TRUE).
-- Record WHO deleted it and WHEN for the audit trail. Soft-delete + updated_at
-- bump keeps the LOCAL<->MAIN sync last-write-wins predicate correct (a delete
-- must out-rank an older active row). [[project_completed_plan_resurrection]]
ALTER TABLE extra_qty_allowances
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE extra_qty_allowances
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
