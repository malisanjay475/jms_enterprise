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
const { buildTonnageWorkbook } = require('./tonnageWorkbook');

const RATE_DAYS = 3;
/* a set needing more pieces of one mould than this is almost certainly a data error */
const MAX_SANE_RATIO = 24;
/* the factory runs on IST; an ERP target date means the end of that day there */
const TZ = '+05:30';
const TARGET_DAY_END = 'T23:59:59' + TZ;
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

/* machine name compared without spaces, case or the "Line>" prefix */
const mkey = v => key(stripPrefix(v)).replace(/\s+/g, '');
/* primary / secondary machine from the mould master; a cell may list several */
const allowedOf = std => [std && std.primary_machine, std && std.secondary_machine]
  .flatMap(v => String(v || '').split(/[,;|\n]+/)).map(x => x.trim()).filter(Boolean);
const sameMachine = (a, b) => {
  const A = mkey(a), B = mkey(b);
  return !!A && !!B && (A === B || A.endsWith('-' + B) || B.endsWith('-' + A) || A.endsWith('>' + B) || B.endsWith('>' + A));
};

const addHours = (h) => (h == null ? null : new Date(Date.now() + h * 3600000).toISOString());

/* ---------------------------------------------------------------- SQL --- */

const JC_SQL = `
  SELECT TRIM(or_jr_no) AS order_no, or_jr_date::text AS order_date,
         or_qty, jr_qty, NULLIF(TRIM(job_card_no), '') AS job_card_no,
         job_card_date::text AS job_card_date, item_code, product_name, client_name,
         prod_plan_qty, planned_comp_date::text AS planned_comp_date,
         mld_start_date::text AS mld_start_date, mld_end_date::text AS mld_end_date,
         actual_mld_start_date::text AS actual_start_date, mld_status,
         rev_mld_end_date::text AS rev_mld_end_date,
         shift_status, shift_comp_date::text AS shift_comp_date,
         prt_tuf_status, prt_tuf_end_date::text AS prt_tuf_end_date, rev_ptd_tuf_end_date::text AS rev_prt_end_date,
         pack_status, pack_end_date::text AS pack_end_date, rev_pak_end_date::text AS rev_pack_end_date,
         wh_status, wh_rec_date::text AS wh_rec_date,
         NULLIF(TRIM(jr_close), '') AS jr_close, is_closed
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
         MAX(NULLIF(regexp_replace(COALESCE(tonnage::text, ''), '[^0-9.]+', '', 'g'), '')::numeric) AS tonnage,
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
         pb.start_date, pb.end_date, pb.completed_at, pb.completed_by, NULLIF(TRIM(pb.remarks), '') AS remarks, pb.seq,
         pb.created_at, pb.colour_details, pb.job_card_date
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

/* moulded pieces moved on from the machine (Shifting), per plan */
const SHIFT_SQL = `
  SELECT plan_id, COALESCE(SUM(quantity), 0) AS qty, MAX(created_at) AS last_at
    FROM shifting_records
   WHERE plan_id = ANY($1::int[])
   GROUP BY plan_id`;

const MOULD_SQL = `
  SELECT TRIM(mould_number) AS code, TRIM(mould_name) AS name,
         COALESCE(pcs_per_hour, 0) AS pcs_per_hour, cycle_time, no_of_cav, consumption_ratio_qty,
         primary_machine, secondary_machine,
         NULLIF(regexp_replace(COALESCE(tonnage::text, ''), '[^0-9.]+', '', 'g'), '')::numeric AS tonnage
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

/* Moulds of an item when the order has no ERP mould BOM and no plan: mould
   numbers start with the item code ("1031-BODY", "0102-LID"), leading zeros
   and a trailing variant letter ignored. A guess, so each row is marked. */
const ITEM_MOULD_SQL = `
  SELECT ltrim(UPPER(split_part(TRIM(mould_number), '-', 1)), '0') AS base,
         TRIM(mould_number) AS mould_no, TRIM(mould_name) AS mould_name, cycle_time, no_of_cav AS cavity,
         NULLIF(regexp_replace(COALESCE(tonnage::text, ''), '[^0-9.]+', '', 'g'), '')::numeric AS tonnage
    FROM moulds
   WHERE ltrim(UPPER(split_part(TRIM(mould_number), '-', 1)), '0') = ANY($1::text[])
     AND COALESCE(is_active, TRUE) = TRUE
     AND ($2::int IS NULL OR factory_id = $2 OR factory_id IS NULL)`;
const itemBase = v => key(v).replace(/[A-Z]+$/, '').replace(/^0+/, '');

async function loadOrders(pool, orderNos, factoryId, sched, board, { itemFallback = false } = {}) {
  if (!orderNos.length) return [];
  const p = [orderNos, factoryId];
  const [jc, bom, plans, dpr] = await Promise.all([
    pool.query(JC_SQL, p), pool.query(BOM_SQL, p), pool.query(PLAN_SQL, p), pool.query(DPR_SQL, p)
  ]);
  if (itemFallback) {
    const hasMould = new Set(bom.rows.map(b => b.order_no).concat(plans.rows.map(r => r.order_no)));
    const need = new Map();
    jc.rows.forEach(r => { const b = itemBase(r.item_code); if (b && !hasMould.has(r.order_no) && !need.has(r.order_no)) need.set(r.order_no, b); });
    const bases = [...new Set(need.values())];
    const found = bases.length ? (await pool.query(ITEM_MOULD_SQL, [bases, factoryId])).rows : [];
    /* "BODY 1" .. "BODY 4" are copies of one part: one mould, n copies */
    const part = m => key(m.mould_no).replace(/[\s-]*\d+$/, '');
    need.forEach((b, orderNo) => {
      const parts = new Map();
      found.filter(m => m.base === b).forEach(m => (parts.get(part(m)) || parts.set(part(m), []).get(part(m))).push(m));
      parts.forEach(list => {
        const m = list.slice().sort((x, y) => key(x.mould_no).localeCompare(key(y.mould_no)))[0];
        bom.rows.push({
          order_no: orderNo, mould_no: m.mould_no, mould_name: m.mould_name, item_qty: null, jr_qty: null,
          cycle_time: m.cycle_time, cavity: m.cavity, tonnage: m.tonnage, items: [], from_item: true, copies: list.length
        });
      });
    });
  }
  const planIds = plans.rows.map(r => Number(r.id)).filter(Number.isInteger);
  const shifted = planIds.length
    ? (await pool.query(SHIFT_SQL, [planIds]).catch(() => ({ rows: [] }))).rows : [];
  const shiftByPlan = new Map(shifted.map(r => [String(r.plan_id), r]));
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
    mouldStd,
    sched,
    board,
    shiftByPlan
  })).filter(Boolean);
}

function buildOrder(orderNo, { jcRows, bomRows, planRows, dprRows, mouldStd, sched, board, shiftByPlan }) {
  if (!jcRows.length && !planRows.length) return null;
  const head = jcRows[0] || {};
  const orderQty = num(head.jr_qty) || num(head.or_qty) || Math.max(0, ...bomRows.map(b => num(b.jr_qty)));
  const planById = new Map();
  planRows.forEach(p => { planById.set(String(p.plan_id), p); planById.set(String(p.id), p); });

  /* ---- moulds: BOM first, then any planned mould missing from the BOM ----
     Consumption ratio (pieces of the mould per finished set), most trusted
     first: the plan board (what Planning used), the mould master, then the
     ERP BOM total / JR qty. The BOM figure is kept to flag a mismatch. */
  const moulds = new Map();
  bomRows.forEach(b => {
    const jr = num(b.jr_qty) || orderQty;
    moulds.set(key(b.mould_no), {
      mould_no: b.mould_no, mould_name: b.mould_name || b.mould_no,
      bomRatio: jr > 0 ? +(num(b.item_qty) / jr).toFixed(3) : null,
      cycle: num(b.cycle_time), cavity: num(b.cavity) || 1, items: b.items || [], tonnage: num(b.tonnage),
      fromItem: !!b.from_item, copies: b.copies || 1
    });
  });
  planRows.forEach(p => {
    const k = key(p.mould_code || p.mould_name);
    if (k && !moulds.has(k)) {
      moulds.set(k, { mould_no: p.mould_code || p.mould_name, mould_name: p.mould_name || p.mould_code, bomRatio: null, cycle: 0, cavity: 1, items: [] });
    }
  });
  moulds.forEach((m, k) => {
    const planRatio = Math.max(0, ...planRows.filter(p => key(p.mould_code || p.mould_name) === k).map(p => num(p.consumption_ratio_qty)));
    const masterRatio = num(mouldStd.get(k) && mouldStd.get(k).consumption_ratio_qty);
    if (planRatio > 0) { m.ratio = planRatio; m.ratioSource = 'plan'; }
    else if (masterRatio > 0) { m.ratio = masterRatio; m.ratioSource = 'mould master'; }
    else if (m.bomRatio > 0) { m.ratio = m.bomRatio; m.ratioSource = 'ERP BOM'; }
    else { m.ratio = 1; m.ratioSource = 'assumed'; }
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
  const target = jcRows.map(r => r.planned_comp_date).filter(Boolean).sort().pop() || null;
  const targetEndMs = target ? new Date(target.slice(0, 10) + TARGET_DAY_END).getTime() : null;

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

    const shiftedQty = plansOf.reduce((sum, p) => sum + num(shiftByPlan && shiftByPlan.get(String(p.id)) && shiftByPlan.get(String(p.id)).qty), 0);
    /* every plan for the mould is closed but the pieces are not all made */
    const closedShort = balance > 0 && produced > 0 && plansOf.length > 0 && !pending.length;

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

    /* where the mould sits in its machine's queue (plan sequence) */
    const queued = pending.filter(p => p.status !== 'RUNNING')
      .map(p => ({ p, q: sched && sched.get(String(p.plan_id)) }))
      .filter(x => x.q)
      .sort((a, b) => String(a.q.start_eta || '9').localeCompare(String(b.q.start_eta || '9')))[0] || null;

    let eta = null, etaBasis = null;
    if (status === 'COMPLETE') { eta = completedOn; etaBasis = 'done'; }
    else if (status === 'RUNNING' && hoursLeft != null) { eta = addHours(hoursLeft); etaBasis = liveRate ? 'live rate' : 'std rate'; }
    else if (queued && queued.q.start_eta && hoursLeft != null) {
      eta = new Date(new Date(queued.q.start_eta).getTime() + hoursLeft * 3600000).toISOString(); etaBasis = 'machine queue';
    }
    else if (plannedEnd) { eta = new Date(plannedEnd).toISOString(); etaBasis = 'plan end'; }
    else if (hoursLeft != null) { eta = addHours(hoursLeft); etaBasis = 'if started now'; }

    /* start plan: the latest moment this mould can start (or must be running)
       and still give the order its sets by the target date */
    const firstRunMs = daily.length ? new Date(daily[0].date + 'T00:00:00' + TZ).getTime() : null;
    const startedMs = running.length ? (firstRunMs || Date.now()) : null;
    const expStartMs = status === 'RUNNING' ? startedMs : (queued && queued.q.start_eta ? new Date(queued.q.start_eta).getTime() : null);
    const mustStartMs = targetEndMs && balance > 0 && hoursLeft != null ? targetEndMs - hoursLeft * 3600000 : null;
    const etaMs = eta && status !== 'COMPLETE' ? new Date(eta).getTime() : null;
    let startState, slackHours = null;
    if (status === 'COMPLETE') startState = 'DONE';
    else if (!targetEndMs) startState = 'NO_TARGET';
    else if (status === 'RUNNING') {
      slackHours = etaMs ? (targetEndMs - etaMs) / 3600000 : null;
      startState = slackHours == null ? 'RUNNING' : slackHours >= 0 ? 'ON_TRACK' : 'FINISH_LATE';
    } else if (expStartMs && mustStartMs) {
      slackHours = (mustStartMs - expStartMs) / 3600000;
      startState = slackHours >= 0 ? 'ON_TIME' : 'START_LATE';
    } else if (mustStartMs) {
      slackHours = (mustStartMs - Date.now()) / 3600000;
      startState = slackHours >= 0 ? 'NEEDS_MACHINE' : 'OVERDUE';
    } else startState = 'NO_RATE';

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
      started_at: startedMs ? new Date(startedMs).toISOString() : (daily.length ? daily[0].date : null),
      expected_start: expStartMs ? new Date(expStartMs).toISOString() : null,
      must_start_by: mustStartMs ? new Date(mustStartMs).toISOString() : null,
      start_state: startState, slack_hours: slackHours == null ? null : +slackHours.toFixed(1),
      queue: queued ? { machine: queued.q.machine, position: queued.q.queue_pos, plan_id: queued.p.plan_id } : null,
      shifted: shiftedQty, closed_short: closedShort,
      ratio_source: m.ratioSource, ratio_bom: m.bomRatio,
      copies: m.copies || 1,
      mould_source: m.fromItem ? 'item code' : (bomRows.some(b => key(b.mould_no) === k) ? 'ERP BOM' : 'plan'),
      /* suspect = the ratio in use is implausible; mismatch = the ERP BOM disagrees with it */
      ratio_suspect: m.ratio > MAX_SANE_RATIO,
      ratio_mismatch: m.bomRatio > 0 && Math.abs(m.bomRatio - m.ratio) / m.ratio > 0.05,
      cycle_time: num(std && std.cycle_time) || m.cycle || null, cavity: num(std && std.no_of_cav) || m.cavity || null,
      /* machine size the mould needs: mould master first, then the ERP BOM */
      tonnage: num(std && std.tonnage) || m.tonnage || null,
      allowed_machines: allowedOf(std),
      tonnage_source: num(std && std.tonnage) ? 'mould master' : (m.tonnage ? 'ERP BOM' : null),
      std_pph: Math.round(stdRate) || null, live_pph: liveRate ? Math.round(liveRate) : null,
      /* what it must do to make the target, against what it does now */
      need_pph: targetEndMs && balance > 0 && targetEndMs > Date.now() ? Math.ceil(balance / ((targetEndMs - Date.now()) / 3600000)) : null,
      run_pph: status === 'RUNNING' ? Math.round(rate * lanes) : 0,
      lanes,
      scheduled: status === 'COMPLETE' || status === 'RUNNING' || !!(queued && queued.q.start_eta),
      plan_start: plansOf.map(p => p.start_date).filter(Boolean).map(d => new Date(d).toISOString()).sort()[0] || null,
      plan_end: plansOf.map(p => p.end_date).filter(Boolean).map(d => new Date(d).toISOString()).sort().pop() || null,
      /* forecast basis for job cards: pieces per hour over all machines, and from when */
      rate_all_pph: rate > 0 ? +(rate * lanes).toFixed(2) : 0,
      /* same basis as eta: running or not yet on a machine = from now, queued = its queue start */
      forecast_from: expStartMs && status !== 'RUNNING' ? new Date(expStartMs).toISOString() : (eta && status !== 'COMPLETE' ? new Date().toISOString() : null),
      plans: plansOf.map(p => ({
        plan_id: p.plan_id, machine: stripPrefix(p.machine), status: p.status, plan_qty: num(p.plan_qty),
        job_card_no: p.job_card_no, start_date: p.start_date, end_date: p.end_date, completed_at: p.completed_at,
        completed_by: p.completed_by || null, remarks: p.remarks || null,
        plan_date: p.created_at || null, job_card_date: p.job_card_date || null, colour_details: Array.isArray(p.colour_details) ? p.colour_details : [],
        produced: dprRows.filter(d => d.plan_id != null && (String(d.plan_id) === String(p.plan_id) || String(d.plan_id) === String(p.id)))
          .reduce((s, d) => s + num(d.good), 0),
        exp_end: (sched && sched.get(String(p.plan_id)) && sched.get(String(p.plan_id)).eta) || null
      }))
    };
  });

  /* ---- start sequence: the mould that must start first gets 1 ---- */
  mouldList.filter(m => m.status !== 'COMPLETE')
    .sort((a, b) => String(a.must_start_by || '9').localeCompare(String(b.must_start_by || '9')) || (a.pct - b.pct))
    .forEach((m, i) => { m.start_seq = i + 1; });
  mouldList.forEach(m => { if (m.start_seq == null) m.start_seq = null; });

  /* ---- sets: the bottleneck mould decides ---- */
  const withRatio = mouldList.filter(m => m.ratio > 0);
  const setsMade = withRatio.length ? Math.min(orderQty || Infinity, ...withRatio.map(m => m.sets_equiv)) : 0;
  const bottleneck = withRatio.slice().sort((a, b) => (a.sets_equiv - b.sets_equiv) || ((b.hours_left || 0) - (a.hours_left || 0)))[0] || null;

  /* ---- job cards ----
     Sets per JC come from production booked against that JC. Dates treat each
     mould's output as filling the job cards in issue order (first in, first
     out): JC k is done on a mould when the mould's total output reaches the
     pieces needed by JC 1..k, and its forecast is the time to reach that. */
  const fifoNeed = new Map();
  const jcSorted = jcRows.filter(r => r.job_card_no)
    .slice().sort((a, b) => String(a.job_card_date || '9').localeCompare(String(b.job_card_date || '9')));
  mouldList.forEach(m => {
    let cum = 0;
    jcSorted.forEach(r => { cum += Math.round(num(r.prod_plan_qty) * m.ratio); fifoNeed.set(r.job_card_no + '|' + m.mould_no, cum); });
  });
  const reachDate = (m, need) => {
    let run = 0;
    for (const d of m.daily) { run += d.qty; if (run >= need) return d.date; }
    return null;
  };
  const jobCards = jcSorted.map(r => {
    const qty = num(r.prod_plan_qty);
    const perMould = mouldList.map(m => {
      const k = key(m.mould_no);
      const made = dprRows.filter(d => d.jobcard_no === r.job_card_no && mouldKeyOfDpr(d) === k)
        .reduce((s, d) => s + num(d.good), 0);
      const need = Math.round(qty * m.ratio);
      const cumNeed = fifoNeed.get(r.job_card_no + '|' + m.mould_no) || 0;
      const doneOn = cumNeed > 0 && m.produced >= cumNeed ? reachDate(m, cumNeed) : null;
      let eta = null;
      if (!doneOn && cumNeed > 0 && m.forecast_from && m.rate_all_pph > 0) {
        const from = Math.max(Date.now(), new Date(m.forecast_from).getTime());
        eta = new Date(from + (cumNeed - m.produced) / m.rate_all_pph * 3600000).toISOString();
      }
      return { mould_no: m.mould_no, mould_name: m.mould_name, ratio: m.ratio, required: need, produced: made,
        balance: Math.max(0, need - made), sets_equiv: m.ratio > 0 ? Math.floor(made / m.ratio) : 0,
        done_on: doneOn, eta };
    });
    const allDone = perMould.length > 0 && perMould.every(x => x.done_on);
    const ends = perMould.map(x => x.done_on || x.eta);
    const jcScheduled = perMould.every(x => x.done_on || (mouldList.find(m => m.mould_no === x.mould_no) || {}).scheduled);
    const sets = perMould.length ? Math.min(qty, ...perMould.map(x => x.sets_equiv)) : 0;
    const dates = dprRows.filter(d => d.jobcard_no === r.job_card_no).map(d => d.dpr_date).sort();
    return {
      job_card_no: r.job_card_no, job_card_date: r.job_card_date, qty, sets_made: sets,
      pct: qty > 0 ? +(sets / qty * 100).toFixed(1) : 0,
      status: qty > 0 && sets >= qty ? 'COMPLETE' : (dates.length ? 'IN_PROGRESS' : 'NOT_STARTED'),
      planned_start: r.mld_start_date, planned_end: r.mld_end_date, planned_comp_date: r.planned_comp_date,
      actual_start: dates[0] || r.actual_start_date || null, last_production: dates[dates.length - 1] || null,
      completed_on: allDone ? perMould.map(x => x.done_on).sort().pop() : null,
      expected_end: allDone || !jcScheduled ? null : (ends.length && ends.every(Boolean) ? ends.map(x => new Date(x.length === 10 ? x + 'T23:59:00' + TZ : x).toISOString()).sort().pop() : null),
      earliest_end: allDone || jcScheduled ? null : (ends.length && ends.every(Boolean) ? ends.map(x => new Date(x.length === 10 ? x + 'T23:59:00' + TZ : x).toISOString()).sort().pop() : null),
      process: processStages(r, perMould, mouldList, allDone ? perMould.map(x => x.done_on).sort().pop() : null, sets, qty, orderQty),
      erp_status: r.mld_status, moulds: perMould
    };
  });
  const unlinked = dprRows.filter(d => !d.jobcard_no).reduce((s, d) => s + num(d.good), 0);

  /* ---- order dates ---- */
  const open = mouldList.filter(m => m.status !== 'COMPLETE');
  const complete = orderQty > 0 && setsMade >= orderQty;
  const allScheduled = open.every(m => m.scheduled && m.eta);
  const expectedEnd = complete
    ? mouldList.map(m => m.completed_on).filter(Boolean).sort().pop() || null
    : (open.length && allScheduled ? open.map(m => m.eta).sort().pop() : null);
  /* if every waiting mould were put on a machine right now */
  const earliestEnd = complete || !open.length || !open.every(m => m.eta) ? null : open.map(m => m.eta).sort().pop();
  const runningMachines = [...new Set(mouldList.flatMap(m => m.machines))];
  const delayed = !complete && target && expectedEnd && expectedEnd.slice(0, 10) > target.slice(0, 10);

  /* ERP has closed every JR row of the order, or marked its moulding done / cancelled */
  const rowClosed = r => r.is_closed === true || /^(CLOSE|CLOSED|YES)$/i.test(r.jr_close || '') || /^(COMPLETED|CANCELLED)$/i.test(r.mld_status || '');
  const erpClosed = jcRows.length > 0 && jcRows.every(rowClosed);

  const order = {
    order_no: orderNo, order_date: head.order_date || null,
    erp_closed: erpClosed,
    erp_state: erpClosed ? (jcRows.every(r => /^CANCELLED$/i.test(r.mld_status || '')) ? 'Cancelled in ERP'
      : jcRows.some(r => /^COMPLETED$/i.test(r.mld_status || '')) ? 'Moulding completed in ERP' : 'JR closed in ERP') : null,
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
    plan_start: jcRows.map(r => r.mld_start_date).filter(Boolean).sort()[0] || null,
    plan_end: jcRows.map(r => r.mld_end_date).filter(Boolean).sort().pop() || null,
    completed_on: complete ? expectedEnd : null,
    earliest_end: expectedEnd ? null : earliestEnd,
    pace: (() => {
      const tgtMs = target ? new Date(target.slice(0, 10) + TARGET_DAY_END).getTime() : null;
      const daysLeft = tgtMs ? (tgtMs - Date.now()) / 86400000 : null;
      const setsLeft = Math.max(0, orderQty - setsMade);
      /* sets per day the moulds on machines can make now: the slowest one decides */
      const caps = mouldList.filter(m => m.status !== 'COMPLETE').map(m => m.ratio > 0 ? (m.run_pph || 0) * 24 / m.ratio : 0);
      return {
        days_left: daysLeft == null ? null : +daysLeft.toFixed(1),
        sets_left: setsLeft,
        need_sets_per_day: daysLeft > 0 && setsLeft ? Math.ceil(setsLeft / daysLeft) : null,
        now_sets_per_day: caps.length ? Math.floor(Math.min(...caps)) : null
      };
    })(),
    data_warnings: mouldList.filter(m => m.ratio_suspect || m.ratio_mismatch).map(m => ({
      level: m.ratio_suspect ? 'bad' : 'warn',
      text: m.ratio_suspect
        ? `${m.mould_name}: ratio ×${m.ratio} from ${m.ratio_source} cannot be right. Fix the consumption ratio; every date and quantity for this mould depends on it.`
        : `${m.mould_name}: the ERP BOM gives ×${m.ratio_bom} per set, the ${m.ratio_source} says ×${m.ratio}. Using ×${m.ratio}; correct the BOM in ERP if ×${m.ratio} is right.`
    })),
    eta_unknown_reason: !complete && !expectedEnd
      ? (open.filter(m => !m.scheduled).map(m => m.mould_name).join(', ') || 'A mould') + ' not on a machine yet' : null,
    delayed: !!delayed, unlinked_qty: unlinked,
    late_starts: mouldList.filter(m => ['START_LATE', 'OVERDUE', 'FINISH_LATE'].includes(m.start_state)).length,
    next_start: (() => {
      const n = mouldList.filter(m => !['COMPLETE', 'RUNNING'].includes(m.status)).sort((a, b) => a.start_seq - b.start_seq)[0];
      return n ? { mould_no: n.mould_no, mould_name: n.mould_name, must_start_by: n.must_start_by, expected_start: n.expected_start, start_state: n.start_state, machine: n.queue && n.queue.machine } : null;
    })(),
    moulds: mouldList, job_cards: jobCards
  };
  order.process = orderProcess(jobCards);
  order.verdict = verdictOf(order);
  order.suggestions = suggest(order, board);
  return order;
}

/* ---------------------------------------------------- process stages --- */

const STAGE_DONE = /complet|done|yes|close|receiv|finish/i;
const STAGE_WIP = /process|progress|running|partial|start|wip/i;
const stageState = (status, actualDate) => {
  if (actualDate || STAGE_DONE.test(status || '')) return 'DONE';
  if (STAGE_WIP.test(status || '')) return 'IN_PROGRESS';
  return 'PENDING';
};

/* Moulding -> Shifting -> Printing / TUF -> Packing -> Warehouse for one job
   card, from the OR-JR stage fields (ERP) plus our own moulding / shifting. */
function processStages(r, perMould, mouldList, mouldDoneOn, setsMade, jcQty, orderQty) {
  /* counted in sets: the slowest mould decides, so one mould over-producing cannot hide another one short */
  const made = setsMade;
  const need = jcQty;
  const made_pcs = perMould.reduce((s, m) => s + m.produced, 0);
  const shiftedSets = mouldList.length && mouldList.every(m => m.ratio > 0)
    ? Math.min(...mouldList.map(m => Math.floor((m.shifted || 0) / m.ratio))) : 0;
  const mouldState = mouldDoneOn ? 'DONE' : (made > 0 ? 'IN_PROGRESS' : stageState(r.mld_status));
  const stages = [
    { key: 'moulding', name: 'Moulding', state: mouldState, erp_status: r.mld_status || null,
      plan_start: r.mld_start_date, plan_end: r.mld_end_date, revised_end: r.rev_mld_end_date,
      actual_start: r.actual_start_date, actual_end: mouldDoneOn, qty_done: made, qty_need: need, unit: 'sets', pcs_done: made_pcs },
    { key: 'shifting', name: 'Shifting', state: stageState(r.shift_status, r.shift_comp_date), erp_status: r.shift_status || null,
      plan_end: null, revised_end: null, actual_end: r.shift_comp_date, qty_done: shiftedSets, qty_need: orderQty, unit: 'sets (whole order)' },
    { key: 'printing', name: 'Printing / TUF', state: stageState(r.prt_tuf_status), erp_status: r.prt_tuf_status || null,
      plan_end: r.prt_tuf_end_date, revised_end: r.rev_prt_end_date, actual_end: null },
    { key: 'packing', name: 'Packing', state: stageState(r.pack_status), erp_status: r.pack_status || null,
      plan_end: r.pack_end_date, revised_end: r.rev_pack_end_date, actual_end: null },
    { key: 'warehouse', name: 'Warehouse', state: stageState(r.wh_status, r.wh_rec_date), erp_status: r.wh_status || null,
      plan_end: null, revised_end: null, actual_end: r.wh_rec_date }
  ];
  /* a later stage being done means the earlier ones are too */
  for (let i = stages.length - 1; i > 0; i--) if (stages[i].state === 'DONE') stages.slice(0, i).forEach(x => { if (x.state !== 'DONE') x.state = 'DONE'; });
  const current = stages.find(x => x.state !== 'DONE');
  return { current: current ? current.key : 'done', current_name: current ? current.name : 'Delivered to warehouse', stages };
}

/* order level: the least advanced job card decides */
function orderProcess(jobCards) {
  if (!jobCards.length) return { current: 'moulding', current_name: 'Moulding', by_job_card: [] };
  const order = ['moulding', 'shifting', 'printing', 'packing', 'warehouse', 'done'];
  const least = jobCards.map(j => j.process).sort((a, b) => order.indexOf(a.current) - order.indexOf(b.current))[0];
  return { current: least.current, current_name: least.current_name,
    by_job_card: jobCards.map(j => ({ job_card_no: j.job_card_no, current: j.process.current, current_name: j.process.current_name })) };
}

/* ----------------------------------------------------- verdict + advice --- */

const fmtH = h => h == null ? '?' : h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? h.toFixed(1) + ' h' : (h / 24).toFixed(1) + ' days';
const fmtD = iso => {
  if (!iso) return '?';
  const d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' + TZ : iso);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

function verdictOf(o) {
  if (o.status === 'COMPLETE') return { code: 'DONE', text: 'All sets made', detail: o.completed_on ? 'finished ' + fmtD(o.completed_on) : '' };
  const tgt = o.target_date ? new Date(o.target_date.slice(0, 10) + TARGET_DAY_END).getTime() : null;
  if (!tgt) return { code: 'NO_TARGET', text: 'No target date', detail: 'set the job completion date in ERP' };
  const short = o.moulds.filter(m => m.closed_short);
  if (!o.expected_end) {
    const earliest = o.earliest_end ? new Date(o.earliest_end).getTime() : null;
    if (earliest && earliest <= tgt) {
      return { code: 'AT_RISK', text: 'Can still be on time', detail: `only if ${o.eta_unknown_reason.replace(' not on a machine yet', '')} goes on a machine soon${short.length ? ' (plan closed short)' : ''}`, hours: (tgt - earliest) / 3600000 };
    }
    return { code: 'LATE', text: 'Will be late', detail: o.eta_unknown_reason + (earliest ? '; even if started now it ends ' + fmtD(o.earliest_end) : '') };
  }
  const h = (tgt - new Date(o.expected_end).getTime()) / 3600000;
  if (h < 0) return { code: 'LATE', text: 'Will be late', detail: fmtH(-h) + ' after target', hours: h };
  if (o.late_starts > 0) return { code: 'AT_RISK', text: 'At risk', detail: o.late_starts + ' mould(s) starting late', hours: h };
  return { code: 'ON_TIME', text: 'On time', detail: fmtH(h) + ' before target', hours: h };
}

/* What to do so the order finishes on time. Uses the live machine board:
   machines that are free now, and machines that ran the mould before. */
function suggest(o, board) {
  const out = [];
  if (o.status === 'COMPLETE') return out;
  const tgt = o.target_date ? new Date(o.target_date.slice(0, 10) + TARGET_DAY_END).getTime() : null;
  const machines = board || [];
  /* only machines the mould master allows (primary / secondary machine) */
  const pickFor = m => {
    const allowed = m.allowed_machines || [];
    if (!allowed.length) return { list: [], why: '', none: true };
    const ok = machines.filter(x => allowed.some(a => sameMachine(x.machine, a)));
    const free = ok.filter(x => x.state === 'IDLE');
    if (free.length) return { list: free.slice(0, 3).map(x => x.machine), why: 'free now, mould master machine' };
    const soon = ok.filter(x => x.free_at).sort((a, b) => String(a.free_at).localeCompare(String(b.free_at))).slice(0, 2);
    if (soon.length) return { list: soon.map(x => `${x.machine} (free ${fmtD(x.free_at)})`), why: 'mould master machine, frees up first' };
    return { list: [], why: '', busy: allowed };
  };
  /* when no machine can be suggested, say why: never a machine outside the mould master */
  const hint = (m, p) => p.list.length ? ''
    : p.none ? ` No primary / secondary machine is set for this mould in the mould master; set it in Masters → Moulds to get machine advice.`
    : ` Its mould master machines (${p.busy.join(', ')}) are not on the machine board.`;
  const neckSets = o.bottleneck ? (o.moulds.find(m => m.mould_no === o.bottleneck.mould_no) || {}).sets_equiv : null;

  o.moulds.filter(m => m.status !== 'COMPLETE').sort((a, b) => (a.start_seq || 99) - (b.start_seq || 99)).forEach(m => {
    const hrs = m.hours_left;
    const setsShort = m.ratio > 0 ? Math.ceil(m.balance / m.ratio) : m.balance;
    if (m.closed_short) {
      const p = pickFor(m);
      out.push({ level: 'bad', mould: m.mould_name,
        title: `${m.mould_name}: plan closed ${m.balance.toLocaleString('en-IN')} pcs short`,
        text: `That is ${setsShort.toLocaleString('en-IN')} sets (×${m.ratio}). About ${fmtH(hrs)} of moulding${m.rate_pph ? ' at ' + m.rate_pph + '/h' : ''}. Plan ${m.balance.toLocaleString('en-IN')} pcs${p.list.length ? ' on ' + p.list.join(', ') + ' (' + p.why + ')' : ''}, or close the order ${setsShort.toLocaleString('en-IN')} sets short.${hint(m, p)}` });
      return;
    }
    if (m.status === 'RUNNING') {
      if (m.start_state === 'FINISH_LATE' && tgt && hrs) {
        const left = (tgt - Date.now()) / 3600000;
        const need = left > 0 ? Math.ceil(hrs / left) : null;
        const p = pickFor(m);
        out.push({ level: 'bad', mould: m.mould_name,
          title: `${m.mould_name} finishes ${fmtH(-m.slack_hours)} after target`,
          text: m.ratio_suspect
            ? `Needs ${fmtH(hrs)} at ×${m.ratio} per set, which looks wrong. Check the consumption ratio first.`
            : need && need > 1 && need - m.machines.length <= p.list.length
            ? `Needs ${fmtH(hrs)} on ${m.machines.length} machine(s) but only ${fmtH(left)} remain. Run it on ${need} machines: add ${p.list.slice(0, need - m.machines.length).join(', ')} (${p.why}).`
            : need && need > 1
            ? `Needs ${fmtH(hrs)} but only ${fmtH(left)} remain: it would take ${need} machines and only ${p.list.length} mould master machine(s) can take it. Ask for a later date, or split the order.${hint(m, p)}`
            : `Target can no longer be met on the current rate (${m.rate_pph}/h). Speed up the cycle, add a machine${p.list.length ? ' (' + p.list.join(', ') + ')' : ''} or move the date.${hint(m, p)}` });
      } else if (m.start_state === 'ON_TRACK') {
        out.push({ level: 'good', mould: m.mould_name, title: `${m.mould_name} is running on ${m.machines.join(', ')}`, text: `Ends ${fmtD(m.eta)}, ${fmtH(m.slack_hours)} before target. Keep it running.` });
      }
      return;
    }
    if (m.queue) {
      if (m.start_state === 'START_LATE') {
        const p = pickFor(m);
        out.push({ level: 'bad', mould: m.mould_name,
          title: `${m.mould_name} starts ${fmtH(-m.slack_hours)} too late`,
          text: `It is #${m.queue.position} in the queue on ${m.queue.machine} and starts ${fmtD(m.expected_start)}, but must start by ${fmtD(m.must_start_by)}. Move it up the queue on ${m.queue.machine}${p.list.length ? ', or start it on ' + p.list.join(', ') + ' (' + p.why + ')' : ''}.${p.none ? hint(m, p) : ''}` });
      } else {
        out.push({ level: 'good', mould: m.mould_name, title: `${m.mould_name} is queued on ${m.queue.machine}`, text: `Starts ${fmtD(m.expected_start)}, must start by ${fmtD(m.must_start_by)}. No action needed yet.` });
      }
      return;
    }
    const p = pickFor(m);
    out.push({ level: m.start_state === 'OVERDUE' ? 'bad' : 'warn', mould: m.mould_name,
      title: `Put ${m.mould_name} on a machine${m.must_start_by ? ' by ' + fmtD(m.must_start_by) : ''}`,
      text: `${m.balance.toLocaleString('en-IN')} pcs left (${setsShort.toLocaleString('en-IN')} sets × ${m.ratio}), about ${fmtH(hrs)}.${p.list.length ? ' Suggested: ' + p.list.join(', ') + ' (' + p.why + ').' : hint(m, p)}` });
  });

  /* a running mould far ahead of the bottleneck while the bottleneck waits */
  const neck = o.bottleneck && o.moulds.find(m => m.mould_no === o.bottleneck.mould_no);
  if (neck && neck.status !== 'RUNNING' && neck.status !== 'COMPLETE') {
    o.moulds.filter(m => m.status === 'RUNNING' && m.mould_no !== neck.mould_no && m.sets_equiv - neckSets > 0).forEach(m => {
      /* swap only onto a machine the mould master allows for the bottleneck mould */
      const fits = m.machines.filter(x => (neck.allowed_machines || []).some(a => sameMachine(x, a)));
      out.push({ level: 'warn', mould: m.mould_name,
        title: `${m.mould_name} is ${(m.sets_equiv - neckSets).toLocaleString('en-IN')} sets ahead of ${neck.mould_name}`,
        text: fits.length
          ? `Complete sets wait for ${neck.mould_name}. ${fits.join(', ')} is a mould master machine for it: run ${neck.mould_name} there first, then go back to ${m.mould_name}.`
          : `Complete sets wait for ${neck.mould_name}. Give ${neck.mould_name} priority on its own mould master machine${(neck.allowed_machines || []).length ? ' (' + neck.allowed_machines.join(', ') + ')' : ''}.` });
    });
  }
  (o.data_warnings || []).forEach(w => out.unshift({ level: w.level, title: 'Check the data', text: w.text }));
  const rank = { bad: 0, warn: 1, good: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

const slim = o => {
  const { moulds, job_cards, suggestions, ...rest } = o;
  return {
    ...rest,
    action_count: (suggestions || []).filter(x => x.level !== 'good').length,
    moulds: moulds.map(m => ({ mould_no: m.mould_no, mould_name: m.mould_name, ratio: m.ratio, pct: m.pct,
      produced: m.produced, required: m.required, status: m.status, machines: m.machines, eta: m.eta,
      start_seq: m.start_seq, start_state: m.start_state, must_start_by: m.must_start_by, expected_start: m.expected_start }))
  };
};

/* ------------------------------------------------------ tonnage load --- */

/* Open-order load per machine tonnage, against the machine hours the factory
   has until a chosen date - the monthly "machine planning summary" sheet.
   Load of a mould = balance pieces / pieces per hour on one machine. The mould
   goes to the smallest machine class that fits its tonnage (mould master, ERP
   BOM, else the machine it ran on). Days are 24 machine hours.
   Complete moulds and orders the ERP has closed are listed but not counted.
   A mould runs on one machine at a time (more only when it is running on more
   machines now, i.e. there are copies), so hours of one mould beyond the hours
   left are a mould limit, not a machine shortage. */
function buildTonnageLoad(orders, board, { untilMs, eff, basis, colourByPlan }) {
  const days = Math.max(0, (untilMs - Date.now()) / 86400000);
  const perMachine = 24 * days * eff;
  const classes = [...new Set(board.map(m => num(m.tonnage)).filter(t => t > 0))].sort((a, b) => a - b);
  const tonOf = new Map(board.map(m => [key(m.machine), num(m.tonnage)]));
  const fit = t => classes.find(c => c >= t * 0.95) || (classes.length ? classes[classes.length - 1] : null);
  const rows = new Map(classes.map(c => [c, {
    tonnage: c, machines: board.filter(m => num(m.tonnage) === c).map(m => m.machine), items: []
  }]));
  const unknown = { tonnage: null, machines: [], items: [] };
  const noMould = [];

  /* one detail line per plan and colour; a mould with no plan gets one line */
  const linesOf = (o, m) => {
    const jcs = o.job_cards || [];
    const jcDate = new Map(jcs.map(j => [j.job_card_no, j.job_card_date]));
    const allJc = jcs.map(j => j.job_card_no).join(', ') || null;
    const base = { order_no: o.order_no, order_date: o.order_date, mould_no: m.mould_no, mould_name: m.mould_name };
    if (!m.plans || !m.plans.length) {
      return [{ ...base, jc_no: allJc, jc_date: jcs[0] ? jcs[0].job_card_date : null,
        plan_id: null, plan_date: null, machine: null, colour: null, plan_qty: null,
        produced: m.produced, balance: m.balance, plan_start: null, plan_end: null, plan_exp: null, status: m.status }];
    }
    return m.plans.flatMap(p => {
      const made = colourByPlan && colourByPlan.get(String(p.plan_id));
      const cols = p.colour_details.filter(c => c && (c.colourName || c.planQty));
      const common = {
        ...base, jc_no: p.job_card_no || allJc, jc_date: (p.job_card_no && jcDate.get(p.job_card_no)) || p.job_card_date || null,
        plan_id: p.plan_id, plan_date: p.plan_date, machine: p.machine, plan_start: p.start_date, plan_end: p.end_date,
        plan_exp: ['COMPLETED', 'CLOSED'].includes(p.status) ? p.completed_at : (p.exp_end || p.end_date || null),
        status: p.status || null
      };
      if (cols.length < 2) {
        const colour = (cols[0] && cols[0].colourName) || (made ? [...made.keys()].filter(Boolean).join(', ') : '') || null;
        return [{ ...common, colour, plan_qty: p.plan_qty, produced: p.produced, balance: Math.max(0, p.plan_qty - p.produced) }];
      }
      return cols.map(c => {
        const q = num(c.planQty || c.batchQty);
        const got = made ? num(made.get(key(c.colourName))) : 0;
        return { ...common, colour: c.colourName || null, plan_qty: q, produced: got, balance: Math.max(0, q - got) };
      });
    });
  };

  orders.forEach(o => {
    const due = !o.target_date || new Date(o.target_date.slice(0, 10) + TARGET_DAY_END).getTime() <= untilMs;
    if (basis === 'due' && !due) return;
    if (!o.moulds.length) {
      if (!o.erp_closed) {
        noMould.push({ order_no: o.order_no, order_date: o.order_date, client_name: o.client_name, product_name: o.product_name,
          item_code: o.item_code, order_qty: o.order_qty, source: o.source || 'ERP JR' });
      }
      return;
    }
    o.moulds.forEach(m => {
      let ton = num(m.tonnage), src = m.tonnage_source;
      if (!ton) {
        ton = Math.max(0, ...(m.all_machines || []).map(n => tonOf.get(key(n)) || 0));
        src = ton ? 'machine used' : null;
      }
      const cls = ton ? fit(ton) : null;
      const rate = num(m.rate_pph);
      const done = m.status === 'COMPLETE' || m.balance <= 0;
      const counted = !done && !o.erp_closed;
      const item = {
        order_no: o.order_no, order_date: o.order_date, client_name: o.client_name, product_name: o.product_name, target_date: o.target_date,
        due, mould_no: m.mould_no, mould_name: m.mould_name, mould_tonnage: ton || null, tonnage_source: src,
        mould_source: m.mould_source,
        oversize: !!(ton && cls && ton > cls * 1.05),
        required: m.required, produced: m.produced, balance: m.balance, rate_pph: rate,
        hours: counted ? (rate > 0 ? +(m.balance / rate).toFixed(1) : null) : 0,
        counted, status: done ? 'COMPLETE' : (o.erp_closed ? 'ERP_CLOSED' : m.status), erp_state: o.erp_state,
        lanes: Math.max(m.lanes || 1, m.copies || 1),
        machines: m.machines, queue: m.queue, start_state: m.start_state, slack_hours: m.slack_hours, must_start_by: m.must_start_by,
        lines: linesOf(o, m)
      };
      (cls ? rows.get(cls) : unknown).items.push(item);
    });
  });

  const boardOf = new Map(board.map(b => [b.machine, b]));
  const summarise = r => {
    const st = m => (boardOf.get(m) || {}).state;
    const count = r.machines.length;
    const live = r.items.filter(i => i.counted);
    const sum = f => +live.filter(f).reduce((s, i) => s + (i.hours || 0), 0).toFixed(1);
    const load = sum(() => true);

    /* one mould, one machine at a time: hours past what it can run until the date */
    const byMould = new Map();
    live.forEach(i => {
      const k = key(i.mould_no);
      const g = byMould.get(k) || byMould.set(k, { mould_no: i.mould_no, mould_name: i.mould_name, hours: 0, copies: 1, orders: new Set() }).get(k);
      g.hours += i.hours || 0; g.copies = Math.max(g.copies, i.lanes || 1); g.orders.add(i.order_no);
    });
    const limits = [...byMould.values()].map(g => {
      const cap = perMachine * g.copies, extra = Math.max(0, g.hours - cap);
      return { mould_no: g.mould_no, mould_name: g.mould_name, hours: +g.hours.toFixed(1), copies: g.copies,
        cap_hours: +cap.toFixed(1), extra_hours: +extra.toFixed(1), extra_days: +(extra / 24 / g.copies).toFixed(2), orders: g.orders.size };
    }).filter(g => g.extra_hours > 0).sort((a, b) => b.extra_hours - a.extra_hours);
    const limited = +limits.reduce((s, g) => s + g.extra_hours, 0).toFixed(1);
    const limitedSet = new Set(limits.map(g => key(g.mould_no)));
    r.items.forEach(i => { i.mould_limited = i.counted && limitedSet.has(key(i.mould_no)); });

    /* machines can only take the hours the moulds can run */
    const machLoad = Math.max(0, load - limited);
    const availH = count * perMachine;
    const needed = days > 0 && eff > 0 ? machLoad / perMachine : null;
    const loadDays = machLoad / 24, availDays = count * days * eff;
    r.items.sort((a, b) => (b.counted - a.counted) || (b.hours || 0) - (a.hours || 0));

    /* each machine of the tonnage: what it is doing and how much of it is free */
    const machine_rows = r.machines.map(name => {
      const b = boardOf.get(name) || { running: [], queue: [] };
      const jobs = (b.running || []).concat(b.queue || []);
      const booked = jobs.reduce((s, j) => s + (j.hours_left || 0), 0);
      return {
        machine: name, line: b.line || '', state: b.state || 'IDLE',
        running: (b.running || []).map(j => ({ order_no: j.order_no, mould_name: j.mould_name, plan_id: j.plan_id, hours_left: j.hours_left, eta: j.eta })),
        queue_count: (b.queue || []).length, no_rate: jobs.filter(j => j.hours_left == null).length,
        booked_hours: +booked.toFixed(1), avail_hours: Math.round(perMachine),
        free_hours: +Math.max(0, perMachine - booked).toFixed(1),
        booked_pct: perMachine > 0 ? Math.round(booked / perMachine * 100) : null, free_at: b.free_at || null
      };
    });

    return {
      tonnage: r.tonnage, machines: r.machines, machine_count: count, machine_rows,
      running: r.machines.filter(m => st(m) === 'RUNNING').length,
      idle: r.machines.filter(m => st(m) === 'IDLE').length,
      load_hours: load, load_days: +(load / 24).toFixed(2),
      mould_limited_hours: limited, mould_limits: limits,
      running_hours: sum(i => i.status === 'RUNNING'),
      queued_hours: sum(i => i.status !== 'RUNNING' && !!i.queue),
      unplanned_hours: sum(i => i.status !== 'RUNNING' && !i.queue),
      avail_hours: Math.round(availH), avail_days: +availDays.toFixed(2),
      machines_needed: needed == null ? null : +needed.toFixed(2),
      shortage_machines: needed != null && needed > count ? +(needed - count).toFixed(2) : 0,
      shortage_days: loadDays > availDays ? +(loadDays - availDays).toFixed(2) : 0,
      excess_machines: needed != null && needed < count ? +(count - needed).toFixed(2) : 0,
      excess_days: availDays > loadDays ? +(availDays - loadDays).toFixed(2) : 0,
      booked_pct: availH > 0 ? Math.round(load / availH * 100) : (load > 0 ? null : 0),
      orders: new Set(live.map(i => i.order_no)).size,
      moulds: live.length, no_rate: live.filter(i => i.hours == null).length,
      done_moulds: r.items.length - live.length,
      items: r.items
    };
  };
  const data = [...rows.values()].map(summarise);
  const tot = data.reduce((t, r) => {
    ['machine_count', 'running', 'idle', 'load_hours', 'load_days', 'mould_limited_hours', 'running_hours', 'queued_hours', 'unplanned_hours',
      'avail_hours', 'avail_days', 'machines_needed', 'shortage_machines', 'shortage_days', 'excess_machines', 'excess_days', 'moulds', 'no_rate', 'done_moulds']
      .forEach(k => { t[k] = +((t[k] || 0) + (r[k] || 0)).toFixed(2); });
    return t;
  }, {});
  tot.booked_pct = tot.avail_hours > 0 ? Math.round(tot.load_hours / tot.avail_hours * 100) : null;
  tot.orders = new Set(data.flatMap(r => r.items.filter(i => i.counted).map(i => i.order_no))).size;
  tot.all_orders = orders.length;
  tot.closed_orders = orders.filter(o => o.erp_closed || o.status === 'COMPLETE').length;
  /* no tonnage = no machines to compare with; show only its load */
  const unk = Object.assign(summarise(unknown), { machines_needed: null, shortage_machines: 0, shortage_days: 0, booked_pct: null, machine_rows: [] });
  return { days: +days.toFixed(2), eff, classes: data, total: tot, unknown: unk, no_mould: noMould };
}

/* last day of the current month in IST, as YYYY-MM-DD */
const monthEnd = () => {
  const ist = new Date(Date.now() + 330 * 60000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

/* ------------------------------------------------------------- routes --- */

/* Every moulding machine with its running job and queue, each job carrying
   start_eta / eta chained through the queue in plan sequence. */
async function buildMachineBoard(pool, factoryId) {
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
    /* the machine is free once its running jobs and its queue are done; a job
       with no known rate breaks the chain, so later queue times stay unknown */
    let clock = Math.max(0, ...running.map(j => j.hours_left || 0));
    let known = running.every(j => j.hours_left != null);
    running.forEach((j, i) => { j.queue_pos = 0; j.start_eta = null; j.eta = addHours(j.hours_left); });
    queue.forEach((j, i) => {
      j.queue_pos = i + 1;
      j.start_eta = known ? addHours(clock) : null;
      if (known && j.hours_left != null) { clock += j.hours_left; j.eta = addHours(clock); } else { known = false; j.eta = null; }
    });
    return {
      machine: name, line: mc.line || mc.building || '', tonnage: mc.tonnage || null,
      state: running.length ? 'RUNNING' : (queue.length ? 'QUEUED' : 'IDLE'),
      running, queue, free_at: running.length || queue.length ? addHours(clock) : null,
      today_qty: running.concat(queue).reduce((s, j) => s + j.today_qty, 0)
    };
  });
  return data;
}

/* plan_id -> its place on the machine board (machine, queue position, start / end) */
async function queueSchedule(pool, factoryId) {
  const board = await buildMachineBoard(pool, factoryId);
  const map = new Map();
  board.forEach(m => m.running.concat(m.queue).forEach(j => map.set(String(j.plan_id), { ...j, machine: m.machine })));
  return { map, board };
}

/* every moulding machine in the machine master, active or not */
const MASTER_SQL = `
  SELECT TRIM(machine) AS machine, line, building, tonnage, COALESCE(is_active, TRUE) AS active
    FROM machines
   WHERE COALESCE(NULLIF(TRIM(machine_process), ''), 'Moulding') = 'Moulding'
     AND COALESCE(TRIM(machine), '') <> ''
     AND ($1::int IS NULL OR factory_id = $1 OR factory_id IS NULL)`;

/* machine master per tonnage: how many machines we have, active / inactive,
   and what the active ones are doing now (running / queued / idle) */
function machineMaster(rows, board) {
  const sorter = machineSorter(rows);
  const stateOf = new Map(board.map(m => [key(m.machine), m.state]));
  const list = rows.slice().sort((a, b) => sorter(a.machine, b.machine)).map(r => ({
    machine: r.machine, line: r.line || r.building || '', tonnage: num(r.tonnage) || null, active: !!r.active,
    state: r.active ? (stateOf.get(key(r.machine)) || 'IDLE') : 'INACTIVE'
  }));
  const tons = [...new Set(list.map(m => m.tonnage).filter(Boolean))].sort((a, b) => a - b);
  const sum = ms => ({
    total: ms.length, active: ms.filter(m => m.active).length, inactive: ms.filter(m => !m.active).length,
    running: ms.filter(m => m.state === 'RUNNING').length, queued: ms.filter(m => m.state === 'QUEUED').length,
    idle: ms.filter(m => m.state === 'IDLE').length
  });
  const noTon = list.filter(m => !m.tonnage);
  return {
    ...sum(list),
    by_tonnage: tons.map(t => { const ms = list.filter(m => m.tonnage === t); return { tonnage: t, ...sum(ms), machines: ms }; }),
    no_tonnage: { ...sum(noTon), machines: noTon }
  };
}

/* open orders for the tonnage load: order master not completed / cancelled,
   JR rows the ERP still has open (jr_close is 'Open' / 'Close'), and anything
   on the plan board now */
const OPEN_ORDERS_SQL = `
  WITH o AS (
    SELECT TRIM(order_no) AS order_no FROM orders
     WHERE COALESCE(TRIM(order_no), '') <> ''
       AND UPPER(COALESCE(TRIM(status), '')) NOT IN ('COMPLETED', 'COMPLETE', 'CLOSED', 'CANCELLED')
       AND ($1::int IS NULL OR factory_id = $1 OR factory_id IS NULL)
    UNION
    SELECT TRIM(or_jr_no) FROM or_jr_report
     WHERE COALESCE(TRIM(or_jr_no), '') <> ''
       AND UPPER(COALESCE(TRIM(jr_close), '')) NOT IN ('CLOSE', 'CLOSED', 'YES') AND is_closed IS NOT TRUE
       AND UPPER(COALESCE(TRIM(mld_status), '')) NOT IN ('COMPLETED', 'CANCELLED')
       AND ($1::int IS NULL OR factory_id = $1 OR factory_id IS NULL)
    UNION
    SELECT TRIM(order_no) FROM plan_board
     WHERE COALESCE(TRIM(order_no), '') <> ''
       AND UPPER(COALESCE(status, '')) IN ('RUNNING', 'PLANNED', 'PENDING', 'ON HOLD', 'HOLD')
       AND ($1::int IS NULL OR factory_id = $1 OR factory_id IS NULL)
  )
  SELECT o.order_no, m.order_date, m.client_name, m.item_code, m.item_name, m.qty
    FROM o
    LEFT JOIN LATERAL (
      SELECT created_at::date::text AS order_date, client_name, item_code, item_name, qty
        FROM orders WHERE TRIM(order_no) = o.order_no ORDER BY id DESC LIMIT 1) m ON TRUE
   /* another plant's order mis-filed under this factory (JR/JP/... is Kachigam's):
      the plant code in the order no wins, as in Order Master */
   WHERE $1::int IS NULL OR NOT EXISTS (
     SELECT 1 FROM factories pf
      WHERE pf.id <> $1
        AND UPPER(SPLIT_PART(o.order_no, '/', 2))
            = ANY(string_to_array(UPPER(REPLACE(COALESCE(pf.plant_codes, ''), ' ', '')), ',')))`;

/* good pieces per plan and colour (latest edit of each hourly entry) */
const COLOUR_SQL = `
  SELECT plan_id::text AS plan_id, COALESCE(TRIM(colour), '') AS colour, SUM(good_qty) AS good
    FROM (SELECT DISTINCT ON (machine, hour_slot, plan_id, dpr_date, shift, COALESCE(colour, ''))
                 plan_id, colour, COALESCE(good_qty, 0) AS good_qty
            FROM dpr_hourly
           WHERE is_deleted IS NOT TRUE AND plan_id::text = ANY($1::text[])
           ORDER BY machine, hour_slot, plan_id, dpr_date, shift, COALESCE(colour, ''), id DESC) x
   GROUP BY 1, 2`;

/* query parameters -> tonnage load for the factory */
async function tonnageFor(pool, req) {
  const factoryId = getFactoryId(req) || null;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.until || '')) ? req.query.until : monthEnd();
  const eff = Math.min(Math.max(Number(req.query.eff) || 100, 10), 100) / 100;
  const basis = req.query.basis === 'due' ? 'due' : 'all';
  /* every order still open anywhere: pending in the order master, a JR row the
     ERP has not closed, or a plan on a machine - no date window, no limit */
  const open = (await pool.query(OPEN_ORDERS_SQL, [factoryId])).rows;
  const orderNos = open.map(r => r.order_no);
  const q = await queueSchedule(pool, factoryId);
  const orders = await loadOrders(pool, orderNos, factoryId, q.map, q.board, { itemFallback: true });
  /* order master rows with no JR and no plan: nothing to build an order from */
  const built = new Set(orders.map(o => o.order_no));
  open.filter(r => !built.has(r.order_no)).forEach(r => orders.push({
    order_no: r.order_no, order_date: r.order_date, client_name: r.client_name || '', product_name: r.item_name || '',
    item_code: r.item_code || '', order_qty: num(r.qty), status: 'NOT_STARTED', moulds: [], job_cards: [], source: 'Order master'
  }));
  const planIds = [...new Set(orders.flatMap(o => o.moulds.flatMap(m => (m.plans || []).map(p => String(p.plan_id)))).filter(Boolean))];
  const colourByPlan = new Map();
  if (planIds.length) {
    (await pool.query(COLOUR_SQL, [planIds])).rows.forEach(r => {
      const m = colourByPlan.get(r.plan_id) || colourByPlan.set(r.plan_id, new Map()).get(r.plan_id);
      m.set(key(r.colour), (m.get(key(r.colour)) || 0) + num(r.good));
    });
  }
  const untilMs = new Date(until + TARGET_DAY_END).getTime();
  const data = buildTonnageLoad(orders, q.board, { untilMs, eff, basis, colourByPlan });
  const master = (await pool.query(MASTER_SQL, [factoryId])).rows;
  data.master = machineMaster(master, q.board);
  return { until, basis, data };
}

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
      const q = await queueSchedule(pool, factoryId);
      const orders = await loadOrders(pool, orderNos, factoryId, q.map, q.board);
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
      const factoryId = getFactoryId(req) || null;
      const q = await queueSchedule(pool, factoryId);
      const [order] = await loadOrders(pool, [orderNo], factoryId, q.map, q.board);
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
      const data = await buildMachineBoard(pool, getFactoryId(req) || null);
      res.json({ ok: true, server_time: new Date().toISOString(), data });
    } catch (e) {
      console.error('[order-tracker/machines]', e);
      sendServerError(res, e);
    }
  });

  /* GET /api/order-tracker/tonnage?until=YYYY-MM-DD&eff=100&basis=all|due
     open-order machine load per tonnage against machine hours until the date */
  app.get('/api/order-tracker/tonnage', async (req, res) => {
    try {
      const { until, basis, data } = await tonnageFor(pool, req);
      res.json({ ok: true, server_time: new Date().toISOString(), until, basis, data });
    } catch (e) {
      console.error('[order-tracker/tonnage]', e);
      sendServerError(res, e);
    }
  });

  /* GET /api/order-tracker/tonnage.xlsx - same figures as an Excel sheet */
  app.get('/api/order-tracker/tonnage.xlsx', async (req, res) => {
    try {
      const { until, basis, data } = await tonnageFor(pool, req);
      const factoryName = String(req.query.factory || '').replace(/[^\w .&()-]/g, '').slice(0, 40);
      const buf = await buildTonnageWorkbook(data, { until, basis, factoryName });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Machine_Planning_Summary_${until}.xlsx"`);
      res.end(Buffer.from(buf));
    } catch (e) {
      console.error('[order-tracker/tonnage.xlsx]', e);
      sendServerError(res, e);
    }
  });
}

module.exports = { registerOrderTrackerRoutes, buildOrder, buildTonnageLoad, machineMaster };
