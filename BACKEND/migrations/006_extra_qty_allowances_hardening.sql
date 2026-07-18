-- Hardening for extra_qty_allowances (CodeRabbit review, PR #1056):
-- 1. updated_at so the LOCAL<->MAIN sync last-write-wins predicate applies
--    (without it, stale rows could overwrite newer tombstones on sync).
-- 2. Reject empty/whitespace-only remarks at the DB level too — the audit
--    reason must survive direct inserts, imports, and sync.
ALTER TABLE extra_qty_allowances
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eqa_remarks_not_blank'
  ) THEN
    ALTER TABLE extra_qty_allowances
      ADD CONSTRAINT eqa_remarks_not_blank CHECK (length(btrim(remarks)) > 0);
  END IF;
END $$;
