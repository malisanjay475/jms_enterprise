'use strict';

// Which factory a new record belongs to. Records used to fall back to factory 1 (in code, and
// as the column default in the database), so a save made in the All Factories view of any unit
// was booked to factory 1.

const { normalizeFactoryId } = require('./requestContext');

const NO_FACTORY_MESSAGE = 'Select one factory and save again. This record could not be matched to a single factory.';

/**
 * The selected factory, else the factory of the record's plan, machine or order when that is
 * certain (only one factory has it), else null.
 * q(sql, params) => rows. Plan ids repeat per factory, so a plan counts only with its order.
 */
async function resolveSaveFactory(q, { factoryId, planId, orderNo, machine }) {
  const selected = normalizeFactoryId(factoryId);
  if (selected) return selected;
  const one = async (from, params) => {
    const rows = await q(`SELECT MIN(factory_id) AS f FROM ${from} HAVING COUNT(DISTINCT factory_id) = 1`, params);
    return normalizeFactoryId(rows[0]?.f);
  };
  const order = String(orderNo ?? '').trim();
  const plan = String(planId ?? '').trim();
  const mc = String(machine ?? '').trim();
  return (plan && order && await one('plan_board WHERE plan_id::text = $1 AND TRIM(order_no) = $2', [plan, order]))
    || (mc && await one('machines WHERE TRIM(machine) = $1', [mc]))
    || (order && await one('orders WHERE TRIM(order_no) = $1', [order]))
    || null;
}

module.exports = { NO_FACTORY_MESSAGE, resolveSaveFactory };
