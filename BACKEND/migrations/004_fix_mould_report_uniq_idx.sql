-- Migration 004: Repair mould_planning_report natural-key unique index
--
-- PROBLEM
--   Sync upserts use ON CONFLICT (or_jr_no, mould_no, mould_item_code, plan_date)
--   as the arbiter for mould_planning_report. On older databases (e.g. factory
--   local servers provisioned before the current index definition), the unique
--   index `mould_report_date_uniq_idx` was created with a DIFFERENT column set,
--   or duplicate rows exist. Because the table's index is only ever created with
--   `CREATE UNIQUE INDEX IF NOT EXISTS`, the stale index is never replaced, so
--   every sync of rows that differ only by `mould_item_code` fails with:
--     duplicate key value violates unique constraint "mould_report_date_uniq_idx"
--   and those planning rows never sync between LOCAL and MAIN.
--
-- FIX (idempotent, safe to run on every server)
--   1. If the table exists:
--   2. Drop the stale index so distinct rows can coexist.
--   3. Delete rows that duplicate the intended natural key, keeping the newest
--      (highest id) — mirrors the dedup approach in migration 002.
--   4. Recreate the index with the exact 4-column natural key the sync layer
--      arbitrates on.
--
-- Note: mould_planning_report is created by inline DDL in the legacy routes,
-- which runs AFTER migrations. This guard skips cleanly on a fresh install
-- (table not yet present); the inline CREATE ... IF NOT EXISTS then builds the
-- correct index from scratch. On existing installs the table is present and the
-- repair runs immediately.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name   = 'mould_planning_report'
    ) THEN
        -- 2. Drop whatever the stale index currently is.
        EXECUTE 'DROP INDEX IF EXISTS mould_report_date_uniq_idx';

        -- 3. Remove duplicate rows on the intended natural key, keeping the
        --    newest row (highest id) for each key group.
        DELETE FROM mould_planning_report a
              USING mould_planning_report b
              WHERE a.id < b.id
                AND a.or_jr_no        IS NOT DISTINCT FROM b.or_jr_no
                AND a.mould_no        IS NOT DISTINCT FROM b.mould_no
                AND a.mould_item_code IS NOT DISTINCT FROM b.mould_item_code
                AND a.plan_date       IS NOT DISTINCT FROM b.plan_date;

        -- 4. Recreate the canonical unique index.
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS mould_report_date_uniq_idx '
             || 'ON mould_planning_report (or_jr_no, mould_no, mould_item_code, plan_date)';
    END IF;
END
$$;
