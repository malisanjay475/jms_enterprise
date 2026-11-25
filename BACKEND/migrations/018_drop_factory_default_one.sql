-- factory_id had DEFAULT 1 on 23 tables (old schema leftover), so any insert that did not
-- name a factory was booked to factory 1. Inserts now name it; drop the default.
-- Only the default changes: no row is read or written, and only a default of exactly 1 is
-- dropped, so servers with another schema are left alone.
-- Rollback: ALTER TABLE <table> ALTER COLUMN factory_id SET DEFAULT 1;
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tbl
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'factory_id' AND NOT a.attisdropped
      JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND pg_get_expr(d.adbin, d.adrelid) = '1'
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN factory_id DROP DEFAULT', t.tbl);
  END LOOP;
END $$;
