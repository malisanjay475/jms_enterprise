-- Index the exact expression the planning code filters and joins on:
--   WHERE TRIM(COALESCE(or_jr_no, '')) = TRIM($1)            (resolveJobCardFromOrJrRemarks)
--   ON TRIM(COALESCE(r.or_jr_no, '')) = TRIM(COALESCE(pb.order_no, ''))
-- The existing index is on TRIM(or_jr_no), which the planner can't use for the
-- COALESCE form, so every lookup read the whole table. /api/planning/job-card-approvals
-- did ~32 such full scans per call (a per-row lookup loop). Measured on factory-1:
-- 6.2 ms seq scan -> 0.036 ms index scan per lookup.
-- No traffic reaches the table while migrations run, so a plain CREATE INDEX is safe
-- (~11k rows: well under a second). Guarded: on a fresh DB or_jr_report is created
-- later by the inline schema bootstrap, which also creates this index
-- (registerLegacyRoutes.js). Rollback: DROP INDEX idx_or_jr_report_trim_coalesce_no.
DO $$
BEGIN
  IF to_regclass('public.or_jr_report') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_or_jr_report_trim_coalesce_no
      ON or_jr_report ((TRIM(COALESCE(or_jr_no, ''))));
  END IF;
END
$$;
