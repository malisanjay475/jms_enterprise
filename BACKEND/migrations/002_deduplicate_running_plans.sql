-- Migration 002: Deduplicate RUNNING plans per machine
-- Ensures that each machine has at most ONE plan with status = 'Running'.
-- Plans that are surplus (older updated_at) are set to 'Stopped'.
-- This is a one-time fix for data accumulated before the single-running-plan
-- enforcement was added to /api/planning/start, /api/planning/run, and the
-- sync service upsert logic.

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
