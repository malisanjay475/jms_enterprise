-- 003_perf_indexes.sql
-- Performance: add btree indexes on the columns the app filters on most.
-- These columns were the most-frequent WHERE/AND targets across the API layer
-- (factory_id, plan_id, machine, username, order_no, dpr_date, shift, status, ...).
-- Without them Postgres does sequential scans, which get slower as tables grow.
--
-- SAFE BY DESIGN: this whole file runs inside one transaction (see runMigrations.js),
-- and a single bad statement would abort server startup. So instead of hard-coding
-- (table, column) pairs that might not exist, we auto-discover every public table
-- that actually HAS one of these hot columns and create the index only then.
-- CREATE INDEX IF NOT EXISTS makes it idempotent and re-runnable.

DO $$
DECLARE
  rec       record;
  idx_name  text;
BEGIN
  -- Single-column indexes on high-value, high-selectivity filter columns.
  FOR rec IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name   = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type   = 'BASE TABLE'
      AND c.column_name IN (
        'factory_id', 'plan_id', 'machine', 'machine_name', 'username',
        'order_no', 'dpr_date', 'shift', 'status', 'mould_number',
        'or_jr_no', 'mould_id', 'snapshot_id', 'target_user'
      )
  LOOP
    idx_name := left('idx_' || rec.table_name || '_' || rec.column_name, 63);
    BEGIN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
        idx_name, rec.table_name, rec.column_name
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'perf-index skip %.%: %', rec.table_name, rec.column_name, SQLERRM;
    END;
  END LOOP;

  -- High-value composite index for the DPR hot path (filter by date + machine + shift),
  -- created only if all three columns exist on the table.
  FOR rec IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type   = 'BASE TABLE'
      AND EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='dpr_date')
      AND EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='machine')
      AND EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='shift')
  LOOP
    idx_name := left('idx_' || rec.table_name || '_date_machine_shift', 63);
    BEGIN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (dpr_date, machine, shift)',
        idx_name, rec.table_name
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'perf-index skip %(composite): %', rec.table_name, SQLERRM;
    END;
  END LOOP;
END $$;
