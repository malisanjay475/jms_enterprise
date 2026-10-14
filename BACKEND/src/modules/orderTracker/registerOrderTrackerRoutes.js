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
         wh_status, wh_rec_date::text AS wh_rec_date
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

/* moulded pieces moved on from the machine (Shifting), per plan */
const SHIFT_SQL = `
  SELECT plan_id, COALESCE(SUM(quantity), 0) AS qty, MAX(created_at) AS last_at
    FROM shifting_records
   WHERE plan_id = ANY($1::int[])
   GROUP BY plan_id`;

const MOULD_SQL = `
  SELECT TRIM(mould_number) AS code, TRIM(mould_name) AS name,
         COALESCE(pcs_per_hour, 0) AS pcs_per_hour, cycle_time, no_of_cav, consumption_ratio_qty
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

async function loadOrders(pool, orderNos, factoryId, sched, board) {
  if (!orderNos.length) return [];
  const p = [orderNos, factoryId];
  const [jc, bom, plans, dpr] = await Promise.all([
    pool.query(JC_SQL, p), pool.query(BOM_SQL, p), pool.query(PLAN_SQL, p), pool.query(DPR_SQL, p)
  ]);
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
      cycle: num(b.cycle_time), cavity: num(b.cavity) || 1, items: b.items || []
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
      /* suspect = the ratio in use is implausible; mismatch = the ERP BOM disagrees with it */
      ratio_suspect: m.ratio > MAX_SANE_RATIO,
      ratio_mismatch: m.bomRatio > 0 && Math.abs(m.bomRatio - m.ratio) / m.ratio > 0.05,
      cycle_time: num(std && std.cycle_time) || m.cycle || null, cavity: num(std && std.no_of_cav) || m.cavity || null,
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
        job_card_no: p.job_card_no, start_date: p.start_date, end_date: p.end_date, completed_at: p.completed_at
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

  const order = {
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
  const idle = machines.filter(m => m.state === 'IDLE');
  const tonOf = name => { const m = machines.find(x => key(x.machine) === key(name)); return m ? num(m.tonnage) : 0; };
  const pickFor = m => {
    const used = new Set((m.all_machines || []).map(key));
    const known = idle.filter(x => used.has(key(x.machine)));
    if (known.length) return { list: known.slice(0, 3).map(x => x.machine), why: 'free now and ran this mould before' };
    const ton = Math.max(0, ...(m.all_machines || []).map(tonOf));
    const fit = ton ? idle.filter(x => num(x.tonnage) >= ton * 0.9 && num(x.tonnage) <= ton * 1.6) : [];
    if (fit.length) return { list: fit.slice(0, 3).map(x => x.machine), why: `free now, ${ton} T class` };
    if (idle.length) return { list: idle.slice(0, 3).map(x => x.machine), why: 'free now; check the mould fits' };
    const soon = machines.filter(x => x.free_at).sort((a, b) => String(a.free_at).localeCompare(String(b.free_at))).slice(0, 2);
    return { list: soon.map(x => `${x.machine} (free ${fmtD(x.free_at)})`), why: 'no machine is free now; these free up first' };
  };
  const neckSets = o.bottleneck ? (o.moulds.find(m => m.mould_no === o.bottleneck.mould_no) || {}).sets_equiv : null;

  o.moulds.filter(m => m.status !== 'COMPLETE').sort((a, b) => (a.start_seq || 99) - (b.start_seq || 99)).forEach(m => {
    const hrs = m.hours_left;
    const setsShort = m.ratio > 0 ? Math.ceil(m.balance / m.ratio) : m.balance;
    if (m.closed_short) {
      const p = pickFor(m);
      out.push({ level: 'bad', mould: m.mould_name,
        title: `${m.mould_name}: plan closed ${m.balance.toLocaleString('en-IN')} pcs short`,
        text: `That is ${setsShort.toLocaleString('en-IN')} sets (×${m.ratio}). About ${fmtH(hrs)} of moulding${m.rate_pph ? ' at ' + m.rate_pph + '/h' : ''}. Plan ${m.balance.toLocaleString('en-IN')} pcs${p.list.length ? ' on ' + p.list.join(', ') + ' (' + p.why + ')' : ''}, or close the order ${setsShort.toLocaleString('en-IN')} sets short.` });
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
            ? `Needs ${fmtH(hrs)} but only ${fmtH(left)} remain: it would take ${need} machines and only ${p.list.length} are free. Ask for a later date, or split the order.`
            : `Target can no longer be met on the current rate (${m.rate_pph}/h). Speed up the cycle, add a machine${p.list.length ? ' (' + p.list.join(', ') + ')' : ''} or move the date.` });
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
          text: `It is #${m.queue.position} in the queue on ${m.queue.machine} and starts ${fmtD(m.expected_start)}, but must start by ${fmtD(m.must_start_by)}. Move it up the queue on ${m.queue.machine}${p.list.length ? ', or start it on ' + p.list.join(', ') + ' (' + p.why + ')' : ''}.` });
      } else {
        out.push({ level: 'good', mould: m.mould_name, title: `${m.mould_name} is queued on ${m.queue.machine}`, text: `Starts ${fmtD(m.expected_start)}, must start by ${fmtD(m.must_start_by)}. No action needed yet.` });
      }
      return;
    }
    const p = pickFor(m);
    out.push({ level: m.start_state === 'OVERDUE' ? 'bad' : 'warn', mould: m.mould_name,
      title: `Put ${m.mould_name} on a machine${m.must_start_by ? ' by ' + fmtD(m.must_start_by) : ''}`,
      text: `${m.balance.toLocaleString('en-IN')} pcs left (${setsShort.toLocaleString('en-IN')} sets × ${m.ratio}), about ${fmtH(hrs)}.${p.list.length ? ' Suggested: ' + p.list.join(', ') + ' (' + p.why + ').' : ''}` });
  });

  /* a running mould far ahead of the bottleneck while the bottleneck waits */
  const neck = o.bottleneck && o.moulds.find(m => m.mould_no === o.bottleneck.mould_no);
  if (neck && neck.status !== 'RUNNING' && neck.status !== 'COMPLETE') {
    o.moulds.filter(m => m.status === 'RUNNING' && m.mould_no !== neck.mould_no && m.sets_equiv - neckSets > 0).forEach(m => {
      out.push({ level: 'warn', mould: m.mould_name,
        title: `${m.mould_name} is ${(m.sets_equiv - neckSets).toLocaleString('en-IN')} sets ahead of ${neck.mould_name}`,
        text: `Complete sets wait for ${neck.mould_name}. If ${neck.mould_name} fits ${m.machines.join(', ')}, run it there first, then go back to ${m.mould_name}.` });
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
}

module.exports = { registerOrderTrackerRoutes, buildOrder };
