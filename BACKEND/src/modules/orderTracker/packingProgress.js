'use strict';

/**
 * Packing to dispatch progress for Order Tracker (packing step 8).
 *
 * Per job card, read only, from the packing module's own scans:
 *   packed      good scans at the station   assembly_plans.scanned_qty
 *   labelled    pieces in printed boxes     packing_boxes kind BOX
 *   reached     units the store received    cartons + loose boxes with received_at
 *   in store    received, not dispatched
 *   loading     on an open dispatch slip
 *   dispatched  on a closed dispatch slip   packing_dispatches CLOSED
 *
 * When an order has packing data, it counts as complete only when dispatched >= order qty.
 * Orders with no packing data keep the moulding verdict.
 *
 * Gap flags:
 *   moulded, not packed   for more than 2 shift days (09:00-17:00), only for moulding
 *                         after packing went live, so old orders don't all flag
 *   packed, not handed    unit labelled more than 24 h ago, store has not received it
 *   in store too long     received more than stock_alert_days ago (Packing Masters, default 30)
 */

const SHIFT_START_MIN = 9 * 60;
const SHIFT_END_MIN = 17 * 60;
const SHIFT_DAY_MIN = SHIFT_END_MIN - SHIFT_START_MIN;
const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const NOT_PACKED_SHIFT_DAYS = 2;
const NOT_HANDED_HOURS = 24;
const DEFAULT_STOCK_DAYS = 30;

const num = (v) => Number(v) || 0;
const jcKey = (v) => String(v || '').trim().toUpperCase();

/* Working minutes (09:00-17:00 IST, every day) between two instants. */
function shiftMinutesBetween(fromMs, toMs) {
  if (!(toMs > fromMs)) return 0;
  let total = 0;
  const firstDay = Math.floor((fromMs + IST_MS) / DAY_MS);
  const lastDay = Math.floor((toMs + IST_MS) / DAY_MS);
  for (let d = firstDay; d <= lastDay && d - firstDay < 2000; d++) {
    const dayStart = d * DAY_MS - IST_MS;
    const a = Math.max(fromMs, dayStart + SHIFT_START_MIN * 60000);
    const b = Math.min(toMs, dayStart + SHIFT_END_MIN * 60000);
    if (b > a) total += (b - a) / 60000;
  }
  return total;
}

const isUnit = (b) => b.kind === 'CARTON' || (b.kind === 'BOX' && !b.carton_code && !num(b.boxes_per_carton));
const iso = (v) => (v ? new Date(v).toISOString() : null);
const minIso = (list) => list.filter(Boolean).map(iso).sort()[0] || null;
const maxIso = (list) => list.filter(Boolean).map(iso).sort().pop() || null;

async function tablesPresent(pool) {
  const r = await pool.query(`SELECT to_regclass('public.assembly_plans') AS plans, to_regclass('public.packing_boxes') AS boxes,
    to_regclass('public.packing_handovers') AS handovers, to_regclass('public.packing_dispatches') AS dispatches,
    to_regclass('public.packing_settings') AS settings, to_regclass('public.assembly_scans') AS scans`);
  const t = r.rows[0] || {};
  return { plans: !!t.plans, boxes: !!t.boxes, handovers: !!t.handovers, dispatches: !!t.dispatches, settings: !!t.settings, scans: !!t.scans };
}

/* Raw rows for these job cards. Every query is guarded: a server without the packing tables gets empty data. */
async function loadPackingRows(pool, jobCardNos, factoryId) {
  const out = { plans: [], lastScan: new Map(), units: [], since: null, stockDays: DEFAULT_STOCK_DAYS };
  const jcs = [...new Set(jobCardNos.map(jcKey).filter(Boolean))];
  if (!jcs.length) return out;
  const t = await tablesPresent(pool);
  if (t.plans) {
    out.plans = (await pool.query(`
      SELECT id, UPPER(TRIM(job_card_no)) AS jc, table_id, item_name, plan_qty, COALESCE(scanned_qty, 0) AS packed, status,
             to_char(start_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_local
        FROM assembly_plans
       WHERE UPPER(TRIM(job_card_no)) = ANY($1::text[]) AND COALESCE(status, '') <> 'Archived'
       ORDER BY start_time`, [jcs])).rows;
    const ids = out.plans.map(p => p.id);
    if (t.scans && ids.length) {
      const s = await pool.query(`SELECT plan_id, MIN("timestamp") AS first_at, MAX("timestamp") AS last_at
        FROM assembly_scans WHERE is_match AND plan_id = ANY($1::int[]) GROUP BY plan_id`, [ids]);
      s.rows.forEach(r => out.lastScan.set(Number(r.plan_id), { first: r.first_at, last: r.last_at }));
    }
  }
  if (t.boxes) {
    const ho = t.handovers;
    const ds = t.dispatches;
    out.units = (await pool.query(`
      SELECT UPPER(TRIM(b.job_card_no)) AS jc, b.kind, b.qty, b.carton_code, b.boxes_per_carton, b.created_at, b.received_at,
             ${ds ? 'b.dispatched_at, d.slip_no AS ds_slip, d.status AS ds_status, d.closed_at AS ds_closed, d.vehicle_no, d.invoice_no' : 'NULL::timestamptz AS dispatched_at, NULL AS ds_slip, NULL AS ds_status, NULL::timestamptz AS ds_closed, NULL AS vehicle_no, NULL AS invoice_no'},
             ${ho ? 'h.slip_no AS ho_slip, h.opened_at AS ho_opened' : 'NULL AS ho_slip, NULL::timestamptz AS ho_opened'}
        FROM packing_boxes b
        ${ho ? 'LEFT JOIN packing_handovers h ON h.sync_id = b.handover_sync_id' : ''}
        ${ds ? 'LEFT JOIN packing_dispatches d ON d.sync_id = b.dispatch_sync_id' : ''}
       WHERE UPPER(TRIM(b.job_card_no)) = ANY($1::text[]) AND b.voided_at IS NULL AND b.kind IN ('BOX', 'CARTON')
         AND ($2::int IS NULL OR b.factory_id = $2 OR b.factory_id IS NULL)`, [jcs, factoryId || null])).rows;
    const since = await pool.query(`SELECT MIN(created_at) AS at FROM packing_boxes WHERE kind IN ('BOX', 'CARTON')`);
    out.since = since.rows[0] && since.rows[0].at;
  }
  if (t.settings) {
    const s = await pool.query('SELECT stock_alert_days FROM packing_settings WHERE factory_id IS NOT DISTINCT FROM $1 LIMIT 1', [factoryId || null])
      .catch(() => ({ rows: [] }));
    if (s.rows.length && num(s.rows[0].stock_alert_days) > 0) out.stockDays = num(s.rows[0].stock_alert_days);
  }
  return out;
}

/* Per job card numbers and lists. */
function jobCardPacking(jc, rows, nowMs) {
  const plans = rows.plans.filter(p => p.jc === jc);
  const units = rows.units.filter(u => u.jc === jc);
  const scans = plans.map(p => rows.lastScan.get(Number(p.id))).filter(Boolean);
  const unitRows = units.filter(isUnit);
  const dispatched = unitRows.filter(u => u.dispatched_at && u.ds_status === 'CLOSED');
  const loading = unitRows.filter(u => u.dispatched_at && u.ds_status !== 'CLOSED');
  const received = unitRows.filter(u => u.received_at);
  const inStore = received.filter(u => !u.dispatched_at);
  const notHanded = unitRows.filter(u => !u.received_at && nowMs - new Date(u.created_at).getTime() > NOT_HANDED_HOURS * 3600e3);
  const oldStock = inStore.filter(u => nowMs - new Date(u.received_at).getTime() > rows.stockDays * DAY_MS);
  const pcs = (list) => list.reduce((s, u) => s + num(u.qty), 0);
  const group = (list, keyOf, make) => {
    const m = new Map();
    list.forEach(u => { const k = keyOf(u); if (!k) return; const g = m.get(k) || make(u); g.units++; g.pcs += num(u.qty); m.set(k, g); });
    return [...m.values()];
  };
  return {
    job_card_no: jc,
    packed: plans.reduce((s, p) => s + num(p.packed), 0),
    labelled: pcs(units.filter(u => u.kind === 'BOX')),
    reached: pcs(received), reached_units: received.length,
    in_store: pcs(inStore), in_store_units: inStore.length,
    loading: pcs(loading), loading_units: loading.length,
    dispatched: pcs(dispatched), dispatched_units: dispatched.length,
    first_packed: minIso(scans.map(s => s.first)), last_packed: maxIso(scans.map(s => s.last)),
    first_received: minIso(received.map(u => u.received_at)),
    last_dispatched: maxIso(dispatched.map(u => u.ds_closed || u.dispatched_at)),
    not_handed_units: notHanded.length, not_handed_pcs: pcs(notHanded),
    old_stock_units: oldStock.length, old_stock_pcs: pcs(oldStock),
    plans: plans.map(p => {
      const s = rows.lastScan.get(Number(p.id)) || {};
      return { id: p.id, station: p.table_id, plan_qty: num(p.plan_qty), packed: num(p.packed), status: p.status,
        start: p.start_local, first_scan: iso(s.first), last_scan: iso(s.last) };
    }),
    handovers: group(received, u => u.ho_slip, u => ({ slip_no: u.ho_slip, at: iso(u.received_at), units: 0, pcs: 0 })),
    dispatches: group(dispatched.concat(loading), u => u.ds_slip, u => ({
      slip_no: u.ds_slip, status: u.ds_status, at: iso(u.ds_closed || u.dispatched_at), vehicle_no: u.vehicle_no || null, invoice_no: u.invoice_no || null, units: 0, pcs: 0
    }))
  };
}

/* Adds order.packing and adjusts status / verdict. Mutates and returns the order. */
function applyPacking(order, rows, nowMs = Date.now()) {
  const jcs = [...new Set(order.job_cards.map(j => jcKey(j.job_card_no)).filter(Boolean))];
  const byJc = jcs.map(jc => jobCardPacking(jc, rows, nowMs));
  const sum = (k) => byJc.reduce((s, j) => s + num(j[k]), 0);
  const qty = num(order.order_qty);
  const p = {
    tracked: byJc.some(j => j.packed > 0 || j.labelled > 0 || j.plans.length > 0),
    order_qty: qty,
    moulded: num(order.sets_made),
    packed: sum('packed'), labelled: sum('labelled'),
    reached: sum('reached'), in_store: sum('in_store'), in_store_units: sum('in_store_units'),
    loading: sum('loading'), loading_units: sum('loading_units'),
    dispatched: sum('dispatched'), dispatched_units: sum('dispatched_units'),
    first_packed: minIso(byJc.map(j => j.first_packed)), last_packed: maxIso(byJc.map(j => j.last_packed)),
    first_received: minIso(byJc.map(j => j.first_received)), last_dispatched: maxIso(byJc.map(j => j.last_dispatched)),
    stock_alert_days: rows.stockDays,
    gaps: [],
    job_cards: byJc
  };
  p.complete = p.tracked && qty > 0 && p.dispatched >= qty;
  const pct = (v) => (qty > 0 ? +Math.min(100, (v / qty) * 100).toFixed(1) : 0);
  p.stages = [
    { key: 'moulded', name: 'Moulded', qty: p.moulded, pct: pct(p.moulded), unit: 'sets' },
    { key: 'packed', name: 'Packed', qty: p.packed, pct: pct(p.packed), unit: 'pcs', sub: p.labelled ? `${p.labelled.toLocaleString('en-IN')} in labelled boxes` : '' },
    { key: 'store', name: 'Reached store', qty: p.reached, pct: pct(p.reached), unit: 'pcs', sub: p.in_store ? `${p.in_store.toLocaleString('en-IN')} in store now` : '' },
    { key: 'dispatched', name: 'Dispatched', qty: p.dispatched, pct: pct(p.dispatched), unit: 'pcs', sub: p.loading ? `${p.loading.toLocaleString('en-IN')} loading on an open slip` : '' }
  ];

  /* gaps */
  const lastMould = order.last_date ? new Date(order.last_date.slice(0, 10) + 'T17:00:00+05:30').getTime() : null;
  const sinceMs = rows.since ? new Date(rows.since).getTime() : null;
  const waiting = Math.max(0, p.moulded - p.packed);
  if (waiting > 0 && lastMould && sinceMs && lastMould >= sinceMs - DAY_MS) {
    const lastPack = p.last_packed ? new Date(p.last_packed).getTime() : 0;
    const from = Math.max(lastMould, lastPack);
    const idleDays = shiftMinutesBetween(from, nowMs) / SHIFT_DAY_MIN;
    if (idleDays > NOT_PACKED_SHIFT_DAYS) {
      p.gaps.push({ key: 'not_packed', level: 'warn', text: `${waiting.toLocaleString('en-IN')} sets moulded but not packed for ${idleDays.toFixed(1)} shift days.` });
    }
  }
  const notHanded = byJc.reduce((s, j) => s + j.not_handed_units, 0);
  if (notHanded) {
    p.gaps.push({ key: 'not_handed', level: 'warn', text: `${notHanded} carton${notHanded === 1 ? '' : 's'} (${sum('not_handed_pcs').toLocaleString('en-IN')} pcs) packed more than ${NOT_HANDED_HOURS} h ago and not yet received by the store.` });
  }
  const old = byJc.reduce((s, j) => s + j.old_stock_units, 0);
  if (old) {
    p.gaps.push({ key: 'old_stock', level: 'bad', text: `${old} carton${old === 1 ? '' : 's'} (${sum('old_stock_pcs').toLocaleString('en-IN')} pcs) in store for more than ${rows.stockDays} days without dispatch.` });
  }

  order.packing = p;
  if (!p.tracked) return order;

  /* complete = dispatched >= order qty */
  const target = order.target_date ? new Date(order.target_date.slice(0, 10) + 'T23:59:59+05:30').getTime() : null;
  const dayDiff = (ms) => Math.round(Math.abs(ms) / DAY_MS * 10) / 10;
  if (p.complete) {
    const at = p.last_dispatched ? new Date(p.last_dispatched).getTime() : null;
    const when = at && target ? (at <= target ? `${dayDiff(target - at)} days before target` : `${dayDiff(at - target)} days after target`) : '';
    order.verdict = { code: 'DONE', text: 'Dispatched', detail: [`all ${qty.toLocaleString('en-IN')} dispatched`, when].filter(Boolean).join(' · ') };
  } else if (order.status === 'COMPLETE') {
    const left = Math.max(0, qty - p.dispatched);
    const detail = `${p.dispatched.toLocaleString('en-IN')} of ${qty.toLocaleString('en-IN')} dispatched · ${p.in_store.toLocaleString('en-IN')} in store · ${left.toLocaleString('en-IN')} to go`;
    order.verdict = target && nowMs > target
      ? { code: 'LATE', text: 'Moulded, not dispatched by target', detail }
      : { code: 'DISPATCH', text: 'Moulded · packing and dispatch to finish', detail };
  }
  return order;
}

/* Done for the "open" list: moulded, and dispatched when packing tracks the order. */
const fullyDone = (o) => o.status === 'COMPLETE' && (!o.packing || !o.packing.tracked || o.packing.complete);

/* List view keeps the totals, not the per job card lists. */
function slimPacking(p) {
  if (!p) return null;
  const { job_cards, ...rest } = p;
  return rest;
}

module.exports = { loadPackingRows, applyPacking, jobCardPacking, shiftMinutesBetween, fullyDone, slimPacking, isUnit };
