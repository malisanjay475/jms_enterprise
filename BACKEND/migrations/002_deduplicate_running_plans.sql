-- Migration 002: Deduplicate RUNNING plans per machine
-- Ensures that each machine has at most ONE plan with status = 'Running'.
-- Plans that are surplus (older updated_at) are set to 'Stopped'.
--
-- Note: plan_board is created by inline DDL in the legacy routes, which runs
-- after migrations. This DO block safely skips the cleanup if the table doesn't
-- exist yet (fresh install). On all existing installs the table already exists
-- and the dedup runs immediately.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name   = 'plan_board'
    ) THEN
        UPDATE plan_board
           SET status = 'Stopped',
               updated_at = NOW()
         WHERE UPPER(status) = 'RUNNING'
           AND id NOT IN (
               SELECT DISTINCT ON (machine) id
                 FROM plan_board
                WHERE UPPER(status) = 'RUNNING'
                ORDER BY machine, updated_at DESC NULLS LAST
           );
    END IF;
END
$$;
