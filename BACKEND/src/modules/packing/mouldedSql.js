'use strict';

/**
 * Packing plans only job cards that moulding has started on: a DPR entry (dpr_hourly)
 * with good qty for the job card. Counted the way the Order Tracker counts it: one row
 * per hourly entry, the latest edit wins.
 *
 * mouldedCte(jcCte) is a CTE body (use as `moulded AS (${mouldedCte('jc')})`) giving
 * jc (upper-case job card no) and qty (good pieces) for the job cards of `jcCte`, which
 * must have the columns job_card_no and or_jr_no. DPR rows are read by order no (indexed).
 */
function mouldedCte(jcCte) {
  return `
    SELECT jc, SUM(good)::int AS qty FROM (
      SELECT DISTINCT ON (d.factory_id, d.machine, d.hour_slot, d.plan_id, d.dpr_date, d.shift, COALESCE(d.colour, ''))
             UPPER(TRIM(d.jobcard_no)) AS jc, COALESCE(d.good_qty, 0) AS good
        FROM dpr_hourly d
       WHERE d.is_deleted IS NOT TRUE
         AND d.order_no = ANY(ARRAY(SELECT DISTINCT TRIM(or_jr_no) FROM ${jcCte} WHERE or_jr_no IS NOT NULL))
         AND NULLIF(TRIM(COALESCE(d.jobcard_no, '')), '') IS NOT NULL
       ORDER BY d.factory_id, d.machine, d.hour_slot, d.plan_id, d.dpr_date, d.shift, COALESCE(d.colour, ''), d.id DESC
    ) x
     GROUP BY jc
    HAVING SUM(good) > 0`;
}

module.exports = { mouldedCte };
