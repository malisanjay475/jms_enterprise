-- 008_fix_machine_name_gt_corruption.sql
--
-- Historical machine-name corruption: a ">" sits where the line-separator "-"
-- should be, e.g. "B -L1>HYD-300-11" instead of "B -L1-HYD-300-11". It affects
-- ~128 machines but only in OLD transactional rows (roughly 2017 .. 2026-06-01);
-- the `machines` master is clean and current data already uses the correct
-- names. The bad names break historical joins (DPR compliance, STD resolution)
-- because they no longer match the master.
--
-- Fix: normalize ">" -> "-" in the affected tables. The migration runner applies
-- this on LOCAL and MAIN independently, and the transform is deterministic, so
-- every server converges to identical, correct machine strings.
--
-- Safety notes:
--  * dpr_hourly has NO natural unique key (it syncs by surrogate sync_id/
--    global_id), and 0 corrupted rows collide with a correct twin, so a straight
--    normalize creates no duplicates and no constraint errors.
--  * std_actual has UNIQUE(plan_id, shift, dpr_date, machine). A corrupted row
--    whose normalized name already exists (a correct twin) would violate it, so
--    those duplicate setups are dropped FIRST, then the remainder normalized.
--  * plan_board and qc_job_checks have no machine-bearing unique key.
--  * Every statement is scoped to rows containing ">", so re-running is a no-op.

-- dpr_hourly — safe straight normalize (no natural unique key).
UPDATE dpr_hourly
   SET machine = REPLACE(machine, '>', '-')
 WHERE machine LIKE '%>%';

-- std_actual — drop corrupted duplicates that would collide on the unique key,
-- then normalize the rest.
DELETE FROM std_actual d
 WHERE d.machine LIKE '%>%'
   AND EXISTS (
     SELECT 1
       FROM std_actual x
      WHERE x.plan_id  = d.plan_id
        AND x.shift    = d.shift
        AND x.dpr_date = d.dpr_date
        AND x.machine  = REPLACE(d.machine, '>', '-')
        AND x.id <> d.id
   );

UPDATE std_actual
   SET machine = REPLACE(machine, '>', '-')
 WHERE machine LIKE '%>%';

-- Small tables with no machine-bearing unique key.
UPDATE plan_board
   SET machine = REPLACE(machine, '>', '-')
 WHERE machine LIKE '%>%';

UPDATE qc_job_checks
   SET machine = REPLACE(machine, '>', '-')
 WHERE machine LIKE '%>%';
