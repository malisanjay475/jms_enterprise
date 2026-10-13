'use strict';

/**
 * Order Tracker - PUBLIC/order_tracker.html.
 *
 * Two views of the same production data:
 *   Order wise   - every open order, how many complete sets are made, which
 *                  mould is the bottleneck, and when the order should finish.
 *                  Drill into one order for job card wise and mould wise detail.
 *   Machine wise - every moulding machine, the order / job card / mould on it,
 *                  progress, expected finish, and the jobs queued behind it.
 *
 * A "set" is one finished product. Each mould has a consumption ratio (pieces
 * per set) taken from the OR-JR mould BOM: SUM(mould_item_qty) / jr_qty, e.g.
 * Lid 1, Handle 2, Bottom 1. Sets made = MIN over moulds of produced / ratio.
 *
 * Sources (read only):
 *   or_jr_report           order + job card rows (qty, ERP planned dates)
 *   mould_planning_report  mould BOM per order (ratio, cycle, cavity)
 *   plan_board             machine plans per order / mould
 *   dpr_hourly             good / reject pieces per plan, job card and mould
 *   moulds, machines       standard rate, machine line for ordering
 *
 * Expected end = now + remaining pieces / rate, with the rate taken from the
 * last 3 production days (pieces per running hour) or, failing that, the mould
 * standard. Machines run 24 h a day (two 12 h shifts).
 */

const { getFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');

const RATE_DAYS = 3;
const MAX_ORDERS = 400;

const num = v => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const key = v => String(v == null ? '' : v).trim().toUpperCase();
const stripPrefix = v => {
  const raw = String(v == null ? '' : v).trim();
  return raw.includes('>') ? (raw.split('>').pop().trim() || raw) : raw;
};

/* Line from the machine master, then the trailing machine number, then name. */
function machineSorter(machineRows) {
  const lineOf = new Map();
  machineRows.forEach(m => lineOf.set(String(m.machine || '').trim(), String(m.line || m.building || '').trim()));
  const idx = s => { const x = String(s).match(/(\d+)\s*$/); return x ? parseInt(x[1], 10) : 999999; };
  const opts = { numeric: true, sensitivity: 'base' };
  return (a, b) => {
    const A = String(a || '').trim(), B = String(b || '').trim();
    const inA = lineOf.has(A), inB = lineOf.has(B);
    if (inA !== inB) return inA ? -1 : 1;
    const c = (lineOf.get(A) || '').localeCompare(lineOf.get(B) || '', undefined, opts);
    if (c) return c;
    return (idx(A) - idx(B)) || A.localeCompare(B, undefined, opts);
  };
}

const addHours = (h) => (h == null ? null : new Date(Date.now() + h * 3600000).toISOString());

/* ---------------------------------------------------------------- SQL --- */

const JC_SQL = `
  SELECT TRIM(or_jr_no) AS order_no, or_jr_date::text AS order_date,
         or_qty, jr_qty, NULLIF(TRIM(job_card_no), '') AS job_card_no,
         job_card_date::text AS job_card_date, item_code, product_name, client_name,
         prod_plan_qty, planned_comp_date::text AS planned_comp_date,
         mld_start_date::text AS mld_start_date, mld_end_date::text AS mld_end_date,
         actual_mld_start_date::text AS actual_start_date, mld_status
    FROM or_jr_report
   WHERE TRIM(or_jr_no) = ANY($1::text[])
     AND ($2::int IS NULL OR factory_id = $2 OR factory_id IS NULL)
   ORDER BY job_card_date NULLS LAST, id`;

const BOM_SQL = `
  SELECT TRIM(or_jr_no) AS order_no, TRIM(mould_no) AS mould_no,
         MAX(mould_name) AS mould_name,
         SUM(COALESCE(NULLIF(regexp_replace(COALESCE(mould_item_qty, ''), '[^0-9.]+', '', 'g'), '')::numeric, 0)) AS item_qty,
         MAX(NULLIF(regexp_replace(COALESCE(jr_qty, ''), '[^0-9.]+', '', 'g'), '')::numeric) AS jr_qty,
         MAX(NULLIF(regexp_replace(COALESCE(cycle_time, ''), '[^0-9.]+', '', 'g'), '')::numeric) AS cycle_time,
         MAX(NULLIF(regexp_replace(COALESCE(cavity, ''), '[^0-9.]+', '', 'g'), '')::numeric) AS cavity,
         ARRAY_AGG(DISTINCT mould_item_name) FILTER (WHERE COALESCE(mould_item_name, '') <> '') AS items
    FROM mould_planning_report
   WHERE TRIM(or_jr_no) = ANY($1::text[])
     AND COALESCE(TRIM(mould_no), '') <> ''
     AND ($2::int IS NULL OR factory_id = $2 OR factory_id IS NULL)
   GROUP BY 1, 2`;

const PLAN_SQL = `
  SELECT pb.id, pb.plan_id, TRIM(pb.order_no) AS order_no, pb.machine, pb.line,
         TRIM(COALESCE(pb.mould_code, '')) AS mould_code, pb.mould_name, pb.item_name,
         COALESCE(pb.plan_qty, 0) AS plan_qty, UPPER(COALESCE(pb.status, '')) AS status,
         NULLIF(TRIM(pb.job_card_no), '') AS job_card_no, pb.consumption_ratio_qty,
         pb.start_date, pb.end_date, pb.completed_at, pb.seq
    FROM plan_board pb
   WHERE TRIM(pb.order_no) = ANY($1::text[])
     AND UPPER(COALESCE(pb.status, '')) NOT IN ('REJECTED', 'CANCELLED', 'DELETED')
     AND ($2::int IS NULL OR pb.factory_id = $2 OR pb.factory_id IS NULL)`;

/* One row per hourly entry (latest edit wins), rolled up per day. */
const DPR_SQL = `
  SELECT order_no, plan_id, mould_no, jobcard_no, machine, dpr_date::text AS dpr_date,
         SUM(good_qty) AS good, SUM(reject_qty) AS reject,
         COUNT(*) FILTER (WHERE good_qty > 0) AS run_hours
    FROM (
      SELECT DISTINCT ON (machine, hour_slot, plan_id, dpr_date, shift, COALESCE(colour, ''))
             TRIM(order_no) AS order_no, plan_id, TRIM(COALESCE(mould_no, '')) AS mould_no,
             NULLIF(TRIM(jobcard_no), '') AS jobcard_no, TRIM(machine) AS machine, dpr_date,
             COALESCE(good_qty, 0) AS good_qty, COALESCE(reject_qty, 0) AS reject_qty
        FROM dpr_hourly
       WHERE is_deleted IS NOT TRUE
         AND TRIM(order_no) = ANY($1::text[])
         AND ($2::int IS NULL OR factory_id = $2 OR factory_id IS NULL)
       ORDER BY machine, hour_slot, plan_id, dpr_date, shift, COALESCE(colour, ''), id DESC
    ) x
   GROUP BY 1, 2, 3, 4, 5, 6`;

const MOULD_SQL = `
  SELECT TRIM(mould_number) AS code, TRIM(mould_name) AS name,
         COALESCE(pcs_per_hour, 0) AS pcs_per_hour, cycle_time, no_of_cav
    FROM moulds
   WHERE TRIM(mould_number) = ANY($1::text[])
     AND ($2::int IS NULL OR factory_id = $2 OR factory_id IS NULL)`;

const MACHINES_SQL = `
  SELECT TRIM(machine) AS machine, line, building, tonnage
    FROM machines
   WHERE COALESCE(is_active, TRUE) = TRUE
     AND COALESCE(NULLIF(TRIM(machine_process), ''), 'Moulding') = 'Moulding'
     AND ($1::int IS NULL OR factory_id = $1 OR factory_id IS NULL)`;

/* ------------------------------------------------------- order engine --- */

async function loadOrders(pool, orderNos, factoryId) {
  if (!orderNos.length) return [];
  const p = [orderNos, factoryId];
  const [jc, bom, plans, dpr] = await Promise.all([
    pool.query(JC_SQL, p), pool.query(BOM_SQL, p), pool.query(PLAN_SQL, p), pool.query(DPR_SQL, p)
  ]);
  const mouldCodes = [...new Set(bom.rows.map(b => b.mould_no).concat(plans.rows.map(r => r.mould_code)).filter(Boolean))];
  const moulds = mouldCodes.length ? (await pool.query(MOULD_SQL, [mouldCodes, factoryId])).rows : [];
  const mouldStd = new Map();
  moulds.forEach(m => { if (!mouldStd.has(key(m.code))) mouldStd.set(key(m.code), m); });

  const group = (rows, f) => rows.reduce((m, r) => { const k = f(r); (m.get(k) || m.set(k, []).get(k)).push(r); return m; }, new Map());
  const jcBy = group(jc.rows, r => r.order_no);
  const bomBy = group(bom.rows, r => r.order_no);
  const planBy = group(plans.rows, r => r.order_no);
  const dprBy = group(dpr.rows, r => r.order_no);

  return orderNos.map(orderNo => buildOrder(orderNo, {
    jcRows: jcBy.get(orderNo) || [],
    bomRows: bomBy.get(orderNo) || [],
    planRows: planBy.get(orderNo) || [],
    dprRows: dprBy.get(orderNo) || [],
    mouldStd
  })).filter(Boolean);
}

function buildOrder(orderNo, { jcRows, bomRows, planRows, dprRows, mouldStd }) {
  if (!jcRows.length && !planRows.length) return null;
  const head = jcRows[0] || {};
  const orderQty = num(head.jr_qty) || num(head.or_qty) || Math.max(0, ...bomRows.map(b => num(b.jr_qty)));
  const planById = new Map();
  planRows.forEach(p => { planById.set(String(p.plan_id), p); planById.set(String(p.id), p); });

  /* ---- moulds: BOM first, then any planned mould missing from the BOM ---- */
  const moulds = new Map();
  bomRows.forEach(b => {
    const jr = num(b.jr_qty) || orderQty;
    moulds.set(key(b.mould_no), {
      mould_no: b.mould_no, mould_name: b.mould_name || b.mould_no,
      ratio: jr > 0 ? +(num(b.item_qty) / jr).toFixed(3) : 1,
      cycle: num(b.cycle_time), cavity: num(b.cavity) || 1, items: b.items || []
    });
  });
  planRows.forEach(p => {
    const k = key(p.mould_code || p.mould_name);
    if (k && !moulds.has(k)) {
      moulds.set(k, {
        mould_no: p.mould_code || p.mould_name, mould_name: p.mould_name || p.mould_code,
        ratio: num(p.consumption_ratio_qty) || 1, cycle: 0, cavity: 1, items: []
      });
    }
  });

  const mouldKeyOfDpr = d => {
    if (d.mould_no) return key(d.mould_no);
    const plan = planById.get(String(d.plan_id));
    return plan ? key(plan.mould_code || plan.mould_name) : '';
  };

  /* recent window for the live rate */
  const allDates = [...new Set(dprRows.map(d => d.dpr_date))].sort();
  const recentFrom = allDates.length ? allDates[Math.max(0, allDates.length - RATE_DAYS)] : null;
  const today = new Date().toISOString().slice(0, 10);

  const mouldList = [...moulds.entries()].map(([k, m]) => {
    const rows = dprRows.filter(d => mouldKeyOfDpr(d) === k);
    const plansOf = planRows.filter(p => key(p.mould_code || p.mould_name) === k);
    const required = Math.round(orderQty * m.ratio);
    const produced = rows.reduce((s, r) => s + num(r.good), 0);
    const reject = rows.reduce((s, r) => s + num(r.reject), 0);

    /* daily series, and the day the requirement was reached */
    const byDate = new Map();
    rows.forEach(r => byDate.set(r.dpr_date, (byDate.get(r.dpr_date) || 0) + num(r.good)));
    const daily = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, qty]) => ({ date, qty }));
    let cum = 0, completedOn = null;
    for (const d of daily) { cum += d.qty; if (!completedOn && required > 0 && cum >= required) completedOn = d.date; }

    const recent = rows.filter(r => recentFrom && r.dpr_date >= recentFrom);
    const rHours = recent.reduce((s, r) => s + num(r.run_hours), 0);
    const liveRate = rHours > 0 ? recent.reduce((s, r) => s + num(r.good), 0) / rHours : 0;
    const std = mouldStd.get(k);
    const stdRate = num(std && std.pcs_per_hour)
      || (num(std && std.cycle_time) > 0 ? 3600 / num(std.cycle_time) * (num(std.no_of_cav) || 1) : 0)
      || (m.cycle > 0 ? 3600 / m.cycle * m.cavity : 0);
    const rate = liveRate || stdRate;

    const running = plansOf.filter(p => p.status === 'RUNNING');
    const pending = plansOf.filter(p => !['COMPLETED', 'CLOSED'].includes(p.status));
    const machinesNow = [...new Set(running.map(p => stripPrefix(p.machine)))];
    const balance = Math.max(0, required - produced);

    let status;
    if (required > 0 && balance === 0) status = 'COMPLETE';
    else if (running.length) status = 'RUNNING';
    else if (pending.length) status = 'PLANNED';
    else if (produced > 0) status = 'PAUSED';
    else status = 'NOT_PLANNED';

    /* hours left: parallel machines share the work */
    const lanes = Math.max(1, machinesNow.length);
    const hoursLeft = balance > 0 && rate > 0 ? balance / (rate * lanes) : (balance === 0 ? 0 : null);
    const plannedEnd = pending.map(p => p.end_date).filter(Boolean).sort().pop() || null;
    let eta = null, etaBasis = null;
    if (status === 'COMPLETE') { eta = completedOn; etaBasis = 'done'; }
    else if (status === 'RUNNING' && hoursLeft != null) { eta = addHours(hoursLeft); etaBasis = liveRate ? 'live rate' : 'std rate'; }
    else if (plannedEnd) { eta = new Date(plannedEnd).toISOString(); etaBasis = 'plan end'; }
    else if (hoursLeft != null) { eta = addHours(hoursLeft); etaBasis = 'if started now'; }

    return {
      mould_no: m.mould_no, mould_name: m.mould_name, items: m.items, ratio: m.ratio,
      required, produced, reject, balance,
      sets_equiv: m.ratio > 0 ? Math.floor(produced / m.ratio) : 0,
      pct: required > 0 ? Math.min(100, +(produced / required * 100).toFixed(1)) : 0,
      status, machines: machinesNow,
      all_machines: [...new Set(rows.map(r => r.machine).concat(plansOf.map(p => stripPrefix(p.machine))).filter(Boolean))],
      rate_pph: Math.round(rate), rate_basis: liveRate ? 'live' : (stdRate ? 'std' : null),
      today_qty: byDate.get(today) || 0,
      first_date: daily.length ? daily[0].date : null,
      last_date: daily.length ? daily[daily.length - 1].date : null,
      completed_on: completedOn, hours_left: hoursLeft == null ? null : +hoursLeft.toFixed(1),
      eta, eta_basis: etaBasis, daily,
      plans: plansOf.map(p => ({
        plan_id: p.plan_id, machine: stripPrefix(p.machine), status: p.status, plan_qty: num(p.plan_qty),
        job_card_no: p.job_card_no, start_date: p.start_date, end_date: p.end_date, completed_at: p.completed_at
      }))
    };
  });

  /* ---- sets: the bottleneck mould decides ---- */
  const withRatio = mouldList.filter(m => m.ratio > 0);
  const setsMade = withRatio.length ? Math.min(orderQty || Infinity, ...withRatio.map(m => m.sets_equiv)) : 0;
  const bottleneck = withRatio.slice().sort((a, b) => (a.sets_equiv - b.sets_equiv) || ((b.hours_left || 0) - (a.hours_left || 0)))[0] || null;

  /* ---- job cards: sets per JC from production booked against that JC ---- */
  const jobCards = jcRows.filter(r => r.job_card_no).map(r => {
    const qty = num(r.prod_plan_qty);
    const perMould = mouldList.map(m => {
      const k = key(m.mould_no);
      const made = dprRows.filter(d => d.jobcard_no === r.job_card_no && mouldKeyOfDpr(d) === k)
        .reduce((s, d) => s + num(d.good), 0);
      const need = Math.round(qty * m.ratio);
      return { mould_no: m.mould_no, mould_name: m.mould_name, ratio: m.ratio, required: need, produced: made,
        balance: Math.max(0, need - made), sets_equiv: m.ratio > 0 ? Math.floor(made / m.ratio) : 0 };
    });
    const sets = perMould.length ? Math.min(qty, ...perMould.map(x => x.sets_equiv)) : 0;
    const dates = dprRows.filter(d => d.jobcard_no === r.job_card_no).map(d => d.dpr_date).sort();
    return {
      job_card_no: r.job_card_no, job_card_date: r.job_card_date, qty, sets_made: sets,
      pct: qty > 0 ? +(sets / qty * 100).toFixed(1) : 0,
      status: qty > 0 && sets >= qty ? 'COMPLETE' : (dates.length ? 'IN_PROGRESS' : 'NOT_STARTED'),
      planned_start: r.mld_start_date, planned_end: r.mld_end_date, planned_comp_date: r.planned_comp_date,
      actual_start: dates[0] || r.actual_start_date || null, last_production: dates[dates.length - 1] || null,
      erp_status: r.mld_status, moulds: perMould
    };
  });
  const unlinked = dprRows.filter(d => !d.jobcard_no).reduce((s, d) => s + num(d.good), 0);

  /* ---- order dates ---- */
  const etas = mouldList.filter(m => m.status !== 'COMPLETE').map(m => m.eta);
  const complete = orderQty > 0 && setsMade >= orderQty;
  const expectedEnd = complete
    ? mouldList.map(m => m.completed_on).filter(Boolean).sort().pop() || null
    : (etas.length && etas.every(Boolean) ? etas.sort().pop() : null);
  const target = jcRows.map(r => r.planned_comp_date).filter(Boolean).sort().pop() || null;
  const runningMachines = [...new Set(mouldList.flatMap(m => m.machines))];
  const delayed = !complete && target && expectedEnd && expectedEnd.slice(0, 10) > target.slice(0, 10);

  return {
    order_no: orderNo, order_date: head.order_date || null,
    client_name: head.client_name || '', product_name: head.product_name || (planRows[0] && planRows[0].item_name) || '',
    item_code: head.item_code || '', order_qty: orderQty,
    jc_count: jobCards.length, jc_qty: jobCards.reduce((s, j) => s + j.qty, 0),
    sets_made: setsMade, sets_balance: Math.max(0, orderQty - setsMade),
    pct: orderQty > 0 ? +(setsMade / orderQty * 100).toFixed(1) : 0,
    mould_count: mouldList.length, moulds_complete: mouldList.filter(m => m.status === 'COMPLETE').length,
    bottleneck: bottleneck && !complete ? { mould_no: bottleneck.mould_no, mould_name: bottleneck.mould_name } : null,
    running_machines: runningMachines,
    status: complete ? 'COMPLETE' : runningMachines.length ? 'RUNNING' : (mouldList.some(m => m.produced > 0) ? 'PAUSED' : 'NOT_STARTED'),
    start_date: allDates[0] || null, last_date: allDates[allDates.length - 1] || null,
    target_date: target, expected_end: expectedEnd,
    eta_unknown_reason: !complete && !expectedEnd ? 'Some moulds are not running or planned on a machine yet' : null,
    delayed: !!delayed, unlinked_qty: unlinked,
    moulds: mouldList, job_cards: jobCards
  };
}

const slim = o => {
  const { moulds, job_cards, ...rest } = o;
  return {
    ...rest,
    moulds: moulds.map(m => ({ mould_no: m.mould_no, mould_name: m.mould_name, ratio: m.ratio, pct: m.pct,
      produced: m.produced, required: m.required, status: m.status, machines: m.machines, eta: m.eta }))
  };
};

/* ------------------------------------------------------------- routes --- */

function registerOrderTrackerRoutes(app, pool) {
  /* GET /api/order-tracker/orders?scope=running|open|all&days=120&q= */
  app.get('/api/order-tracker/orders', async (req, res) => {
    try {
      const factoryId = getFactoryId(req) || null;
      const scope = ['running', 'open', 'all'].includes(req.query.scope) ? req.query.scope : 'open';
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 120, 7), 730);
      const search = String(req.query.q || '').trim();
      const params = [factoryId, days];
      let sql;
      if (scope === 'running') {
        sql = `SELECT DISTINCT TRIM(order_no) AS order_no FROM plan_board
                WHERE UPPER(COALESCE(status, '')) = 'RUNNING' AND COALESCE(TRIM(order_no), '') <> ''
                  AND ($1::int IS NULL OR factory_id = $1 OR factory_id IS NULL) AND $2::int > 0`;
      } else {
        sql = `SELECT TRIM(or_jr_no) AS order_no, MAX(or_jr_date) AS d FROM or_jr_report
                WHERE COALESCE(TRIM(or_jr_no), '') <> ''
                  AND ($1::int IS NULL OR factory_id = $1 OR factory_id IS NULL)
                  AND or_jr_date >= CURRENT_DATE - $2::int
                  ${scope === 'open' ? `AND COALESCE(TRIM(jr_close), '') <> 'Yes' AND is_closed IS NOT TRUE` : ''}
                  ${search ? `AND (or_jr_no ILIKE $3 OR job_card_no ILIKE $3 OR product_name ILIKE $3 OR client_name ILIKE $3)` : ''}
                GROUP BY 1 ORDER BY d DESC NULLS LAST LIMIT ${MAX_ORDERS}`;
        if (search) params.push(`%${search}%`);
      }
      const orderNos = (await pool.query(sql, params)).rows.map(r => r.order_no);
      const orders = await loadOrders(pool, orderNos, factoryId);
      /* open scope hides orders already complete in production */
      const data = (scope === 'open' ? orders.filter(o => o.status !== 'COMPLETE') : orders).map(slim);
      res.json({ ok: true, scope, server_time: new Date().toISOString(), data });
    } catch (e) {
      console.error('[order-tracker/orders]', e);
      sendServerError(res, e);
    }
  });

  /* GET /api/order-tracker/order?order_no= - full mould + job card detail */
  app.get('/api/order-tracker/order', async (req, res) => {
    try {
      const orderNo = String(req.query.order_no || '').trim();
      if (!orderNo) return res.status(400).json({ ok: false, error: 'order_no is required' });
      const [order] = await loadOrders(pool, [orderNo], getFactoryId(req) || null);
      if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
      res.json({ ok: true, server_time: new Date().toISOString(), data: order });
    } catch (e) {
      console.error('[order-tracker/order]', e);
      sendServerError(res, e);
    }
  });

  /* GET /api/order-tracker/machines - each machine's current job and queue */
  app.get('/api/order-tracker/machines', async (req, res) => {
    try {
      const factoryId = getFactoryId(req) || null;
      const [machines, plans] = await Promise.all([
        pool.query(MACHINES_SQL, [factoryId]),
        pool.query(`
          SELECT pb.id, pb.plan_id, pb.machine, TRIM(pb.order_no) AS order_no,
                 TRIM(COALESCE(pb.mould_code, '')) AS mould_code, pb.mould_name, pb.item_name,
                 COALESCE(pb.plan_qty, 0) AS plan_qty, UPPER(COALESCE(pb.status, '')) AS status,
                 NULLIF(TRIM(pb.job_card_no), '') AS job_card_no, pb.seq, pb.start_date, pb.end_date
            FROM plan_board pb
           WHERE UPPER(COALESCE(pb.status, '')) IN ('RUNNING', 'PLANNED', 'PENDING', 'ON HOLD', 'HOLD')
             AND COALESCE(TRIM(pb.machine), '') <> ''
             AND ($1::int IS NULL OR pb.factory_id = $1 OR pb.factory_id IS NULL)`, [factoryId])
      ]);
      const planCodes = plans.rows.map(p => String(p.plan_id || '')).filter(Boolean);
      const [made, recent] = planCodes.length ? await Promise.all([
        pool.query(`SELECT plan_id, SUM(good_qty) AS good, MAX(dpr_date)::text AS last_date,
                           MIN(dpr_date)::text AS first_date
                      FROM (SELECT DISTINCT ON (machine, hour_slot, plan_id, dpr_date, shift, COALESCE(colour, ''))
                                   plan_id, dpr_date, COALESCE(good_qty, 0) AS good_qty
                              FROM dpr_hourly
                             WHERE is_deleted IS NOT TRUE AND plan_id = ANY($1::text[])
                             ORDER BY machine, hour_slot, plan_id, dpr_date, shift, COALESCE(colour, ''), id DESC) x
                     GROUP BY plan_id`, [planCodes]),
        pool.query(`SELECT plan_id, SUM(good_qty) AS good, COUNT(*) FILTER (WHERE good_qty > 0) AS hrs,
                           SUM(good_qty) FILTER (WHERE dpr_date = CURRENT_DATE) AS today
                      FROM dpr_hourly
                     WHERE is_deleted IS NOT TRUE AND plan_id = ANY($1::text[])
                       AND dpr_date >= CURRENT_DATE - ${RATE_DAYS}
                     GROUP BY plan_id`, [planCodes])
      ]) : [{ rows: [] }, { rows: [] }];
      const madeBy = new Map(made.rows.map(r => [String(r.plan_id), r]));
      const rateBy = new Map(recent.rows.map(r => [String(r.plan_id), r]));
      const codes = [...new Set(plans.rows.map(p => p.mould_code).filter(Boolean))];
      const std = new Map(codes.length ? (await pool.query(MOULD_SQL, [codes, factoryId])).rows.map(m => [key(m.code), m]) : []);

      const job = p => {
        const m = madeBy.get(String(p.plan_id)) || {};
        const r = rateBy.get(String(p.plan_id)) || {};
        const s = std.get(key(p.mould_code)) || {};
        const produced = num(m.good), planQty = num(p.plan_qty);
        const live = num(r.hrs) > 0 ? num(r.good) / num(r.hrs) : 0;
        const rate = live || num(s.pcs_per_hour) || (num(s.cycle_time) > 0 ? 3600 / num(s.cycle_time) * (num(s.no_of_cav) || 1) : 0);
        const balance = Math.max(0, planQty - produced);
        const hours = balance > 0 && rate > 0 ? balance / rate : (balance === 0 ? 0 : null);
        return {
          plan_id: p.plan_id, status: p.status, order_no: p.order_no, job_card_no: p.job_card_no,
          mould_no: p.mould_code, mould_name: p.mould_name || p.mould_code, item_name: p.item_name,
          plan_qty: planQty, produced, balance, pct: planQty > 0 ? Math.min(100, +(produced / planQty * 100).toFixed(1)) : 0,
          today_qty: num(r.today), rate_pph: Math.round(rate), rate_basis: live ? 'live' : (rate ? 'std' : null),
          hours_left: hours == null ? null : +hours.toFixed(1),
          first_date: m.first_date || null, last_date: m.last_date || null,
          plan_start: p.start_date, plan_end: p.end_date
        };
      };

      const byMachine = new Map();
      plans.rows.forEach(p => {
        const k = key(stripPrefix(p.machine));
        (byMachine.get(k) || byMachine.set(k, []).get(k)).push(p);
      });
      const sorter = machineSorter(machines.rows);
      const data = machines.rows.map(mc => mc.machine).sort(sorter).map(name => {
        const mc = machines.rows.find(x => x.machine === name);
        const list = (byMachine.get(key(name)) || []).slice().sort((a, b) =>
          (a.status === 'RUNNING' ? 0 : 1) - (b.status === 'RUNNING' ? 0 : 1) || (num(a.seq) - num(b.seq)));
        const running = list.filter(p => p.status === 'RUNNING').map(job);
        const queue = list.filter(p => p.status !== 'RUNNING').map(job);
        /* the machine is free once its running jobs and its queue are done */
        let clock = Math.max(0, ...running.map(j => j.hours_left || 0));
        running.forEach(j => { j.eta = addHours(j.hours_left); });
        queue.forEach(j => { if (j.hours_left != null) { clock += j.hours_left; j.eta = addHours(clock); } else j.eta = null; });
        return {
          machine: name, line: mc.line || mc.building || '', tonnage: mc.tonnage || null,
          state: running.length ? 'RUNNING' : (queue.length ? 'QUEUED' : 'IDLE'),
          running, queue, free_at: running.length || queue.length ? addHours(clock) : null,
          today_qty: running.concat(queue).reduce((s, j) => s + j.today_qty, 0)
        };
      });
      res.json({ ok: true, server_time: new Date().toISOString(), data });
    } catch (e) {
      console.error('[order-tracker/machines]', e);
      sendServerError(res, e);
    }
  });
}

module.exports = { registerOrderTrackerRoutes, buildOrder };
