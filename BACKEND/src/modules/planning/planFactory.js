'use strict';

// Which factory a plan belongs to.
//
// A plan_board row with factory_id NULL used to be treated as "global": sync sent it to
// every LOCAL server and every unit's timeline showed it. 24-Nov-2026: a Unit-II plan
// saved on MAIN without a user or a factory (no X-User-Name, no X-Factory-ID) appeared on
// Dungra Unit 1. These helpers stop such a plan being saved, decide who may see the ones
// that still exist, and put the missing factory back when it is certain.

const { stripMachinePrefix } = require('../../utils/machineName');

class PlanFactoryError extends Error {
  constructor(message, status = 400, code = 'PLAN_FACTORY') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A plan may only be created by a known user working in ONE factory. */
function assertPlanCreator({ username, factoryId }) {
  if (!String(username || '').trim()) {
    // AUTH_REQUIRED sends the page to the login screen (assets/app.js).
    throw new PlanFactoryError('Your login has ended. Please log in again and create the plan.', 401, 'AUTH_REQUIRED');
  }
  if (!Number.isInteger(factoryId) || factoryId <= 0) {
    throw new PlanFactoryError('Select one factory before creating a plan. The All Factories view cannot create plans.');
  }
  return factoryId;
}

/**
 * Every planned machine must be in this factory's machine master. Labour Job machines are
 * exempt (they may be registered under another factory), and so is a factory that has no
 * machine master yet.
 */
async function assertMachinesInFactory(query, plans, factoryId) {
  const wanted = new Map();
  for (const p of plans) {
    if (!p || p.planType === 'Labour Job') continue;
    const name = stripMachinePrefix(p.machine);
    if (name) wanted.set(name.toLowerCase(), name);
  }
  if (!wanted.size) return;

  const res = await query(
    'SELECT machine, factory_id FROM machines WHERE factory_id = $1 OR factory_id IS NULL',
    [factoryId]
  );
  const rows = res.rows;
  if (!rows.some((r) => Number(r.factory_id) === factoryId)) return;

  const known = new Set(rows.map((r) => stripMachinePrefix(r.machine).toLowerCase()));
  const foreign = [...wanted].filter(([key]) => !known.has(key)).map(([, name]) => name);
  if (foreign.length) {
    throw new PlanFactoryError(
      `Machine ${foreign.join(', ')} is not in the machine master of the selected factory. Switch to the right factory and try again.`
    );
  }
}

/**
 * SQL condition: the plan is visible to the factory in `param` (e.g. "$2"). A plan without
 * a factory is shown only where its machine is in that factory's master.
 */
function planVisibleToFactorySql(param, alias = 'pb') {
  return `(${alias}.factory_id = ${param} OR (${alias}.factory_id IS NULL AND EXISTS (
      SELECT 1 FROM machines own_m
       WHERE own_m.factory_id = ${param}
         AND LOWER(TRIM(own_m.machine)) IN (LOWER(TRIM(${alias}.machine)), LOWER(TRIM(SPLIT_PART(${alias}.machine, '>', 2)))))))`;
}

const NO_CLASH_SQL = `NOT EXISTS (
        SELECT 1 FROM plan_board other
         WHERE other.plan_id = pb.plan_id AND other.factory_id = owner.factory_id)`;

// A machine registered in exactly one factory decides the plan's factory.
const HEAL_BY_MACHINE_SQL = `
  UPDATE plan_board pb
     SET factory_id = owner.factory_id
    FROM (SELECT LOWER(TRIM(machine)) AS name, MIN(factory_id) AS factory_id
            FROM machines
           GROUP BY 1
          HAVING COUNT(*) = COUNT(factory_id) AND COUNT(DISTINCT factory_id) = 1) owner
   WHERE pb.factory_id IS NULL
     AND owner.name <> ''
     AND owner.name IN (LOWER(TRIM(pb.machine)), LOWER(TRIM(SPLIT_PART(pb.machine, '>', 2))))
     AND ${NO_CLASH_SQL}`;

// Otherwise its order decides, when that order belongs to exactly one factory.
const HEAL_BY_ORDER_SQL = `
  UPDATE plan_board pb
     SET factory_id = owner.factory_id
    FROM (SELECT TRIM(order_no) AS order_no, MIN(factory_id) AS factory_id
            FROM orders
           WHERE factory_id IS NOT NULL AND TRIM(COALESCE(order_no, '')) <> ''
           GROUP BY 1
          HAVING COUNT(DISTINCT factory_id) = 1) owner
   WHERE pb.factory_id IS NULL
     AND TRIM(COALESCE(pb.order_no, '')) = owner.order_no
     AND ${NO_CLASH_SQL}`;

/** Put the missing factory back. Idempotent; never blocks startup. */
async function healPlansWithoutFactory(query) {
  for (const [label, sql] of [['machine', HEAL_BY_MACHINE_SQL], ['order', HEAL_BY_ORDER_SQL]]) {
    try {
      await query(sql);
    } catch (err) {
      console.warn(`[DB] plan_board factory_id heal by ${label} skipped:`, err.message);
    }
  }
}

module.exports = {
  PlanFactoryError,
  assertPlanCreator,
  assertMachinesInFactory,
  planVisibleToFactorySql,
  healPlansWithoutFactory
};
