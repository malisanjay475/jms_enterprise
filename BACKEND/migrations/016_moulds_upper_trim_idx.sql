-- Index the exact expression the mould-name lookups compare on:
--   WHERE UPPER(TRIM(mould_number)) = UPPER(TRIM($x))
-- used per row by /api/dpr/recent (up to 50 rows per call) and by the
-- /api/std-actual/status plan lookup. The existing indexes are on TRIM(mould_number)
-- and lower(mould_number), which the planner can't use for this form, so each lookup
-- read the whole moulds table (~741 full scans per 7 minutes on factory-1).
-- No traffic reaches the table while migrations run, so a plain CREATE INDEX is safe
-- (~2k rows). Guarded: on a fresh DB moulds is created later by the inline schema
-- bootstrap, which also creates this index (registerLegacyRoutes.js).
-- Rollback: DROP INDEX idx_moulds_mould_number_upper_trim.
DO $$
BEGIN
  IF to_regclass('public.moulds') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_moulds_mould_number_upper_trim
      ON moulds ((UPPER(TRIM(mould_number))));
  END IF;
END
$$;
