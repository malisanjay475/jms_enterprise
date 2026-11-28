'use strict';

/**
 * Part-wise view of one order, for the Machine Timeline order popup.
 *
 * ERP lists the same part (mould_item_code) under every mould that can make it,
 * each with the full quantity: "Btm" under 0574-BODY 1 and again under
 * 0574-BODY 2. Those moulds are alternatives, so their output is added together
 * and the part is needed once, not once per mould.
 *
 * Complete products = MIN over parts of (good pieces / pieces per product).
 *
 * buildParts() is pure (no database): it takes an order from the Order Tracker
 * engine plus the ERP part rows, dropped moulds and colour-wise production.
 */

const num = v => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const key = v => String(v == null ? '' : v).trim().toUpperCase();
const ckey = v => key(v).replace(/[^A-Z0-9]+/g, '');
const family = v => key(v).replace(/[\s-]*\d+$/, '');
const CLOSED = ['COMPLETED', 'CLOSED'];
const ROLES = ['IN_USE', 'TO_PLAN', 'ALTERNATE', 'DROPPED', 'INACTIVE'];

/* "Better Home Tuff Patla Bush - SM White" -> part name and colour */
function splitItemName(name) {
  const s = String(name || '').trim();
  const i = s.lastIndexOf(' - ');
  return i > 0 ? { part: s.slice(0, i).trim(), colour: s.slice(i + 3).trim() } : { part: s, colour: '' };
}

/* Groups mould keys that share at least one ERP part code. */
function groupMoulds(mouldKeys, items) {
  const parent = new Map(mouldKeys.map(k => [k, k]));
  const find = k => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  const firstOf = new Map();
  items.forEach(it => {
    const m = key(it.mould_no), c = key(it.item_code);
    if (!parent.has(m) || !c) return;
    if (!firstOf.has(c)) { firstOf.set(c, m); return; }
    const a = find(firstOf.get(c)), b = find(m);
    if (a !== b) parent.set(b, a);
  });
  /* a planned mould that ERP did not list: same family as exactly one listed part */
  const listed = new Set(items.map(it => key(it.mould_no)));
  mouldKeys.filter(k => !listed.has(k)).forEach(k => {
    const roots = new Set(mouldKeys.filter(x => listed.has(x) && family(x) === family(k)).map(find));
    if (roots.size === 1) parent.set(find(k), [...roots][0]);
  });
  const groups = new Map();
  mouldKeys.forEach(k => { const r = find(k); (groups.get(r) || groups.set(r, []).get(r)).push(k); });
  return [...groups.values()];
}

/* Pieces per product. The plan / mould master ratio and the ERP BOM can disagree:
   a "3 Pc Set" has master ratio 1 but needs 3, while an ERP BOM that repeats a
   part asks for double. What Planning planned per job card product decides when
   it is a whole number between the two; otherwise the ERP BOM is used. */
function pickRatio(lead, plans, items, { jrQty, jcQty }) {
  const own = lead.ratio;
  const erp = lead.ratio_bom;
  if (!(erp > 0) || Math.abs(erp - own) / own <= 0.05) return { ratio: own, source: lead.ratio_source };
  const useErp = { ratio: erp, source: 'ERP BOM' };
  const planQty = plans.reduce((s, p) => s + num(p.plan_qty), 0);
  if (!planQty) return useErp;

  const whole = Number.isInteger(+erp.toFixed(2));
  /* colours of the same part that are not planned yet: the plan is only a share of the need */
  const planned = new Set(plans.flatMap(p => p.colour_details || []).map(c => key(c.itemCode)).filter(Boolean));
  const mine = items.filter(it => key(it.mould_no) === key(lead.mould_no));
  const inPlan = mine.filter(it => planned.has(key(it.item_code))).map(it => splitItemName(it.item_name));
  const waiting = mine.some(it => {
    const x = splitItemName(it.item_name);
    return !planned.has(key(it.item_code)) && inPlan.some(y => key(y.part) === key(x.part)) && !inPlan.some(y => ckey(y.colour) === ckey(x.colour));
  });
  if (whole && waiting) return useErp;

  for (const qty of [jcQty, jrQty]) {
    if (!(qty > 0)) continue;
    const r = planQty / qty;
    const near = Math.round(r);
    if (near >= 1 && Math.abs(r - near) / near <= 0.03 && near >= Math.min(own, erp) - 0.01 && near <= Math.max(own, erp) + 0.01) {
      return { ratio: near, source: near === own ? lead.ratio_source : 'plan quantity' };
    }
  }
  return useErp;
}

function buildParts(order, { items = [], drops = [], colours = [], inactive = new Set(), now = Date.now() } = {}) {
  const byKey = new Map(order.moulds.map(m => [key(m.mould_no), m]));
  const jrQty = num(order.order_qty);
  const iso = ms => new Date(ms).toISOString();

  const dropOf = m => drops.find(d => [d.mould_no, d.item_code].some(v => v && key(v) === key(m.mould_no))
    || (d.mould_name && key(d.mould_name) === key(m.mould_name))) || null;

  const parts = groupMoulds([...byKey.keys()], items).map(keys => {
    const list = keys.map(k => byKey.get(k));
    const used = list.filter(m => m.plans.length || m.produced > 0);
    const rows = list.map(m => {
      const drop = dropOf(m);
      const role = m.plans.length || m.produced > 0 ? 'IN_USE'
        : drop ? 'DROPPED'
          : inactive.has(key(m.mould_no)) ? 'INACTIVE'
            : used.length ? 'ALTERNATE' : 'TO_PLAN';
      return { m, role, drop };
    });
    const lead = used[0] || list.find(m => !dropOf(m)) || list[0];
    const plans = list.flatMap(m => m.plans);
    const own = items.filter(it => keys.includes(key(it.mould_no)));
    const picked = pickRatio(lead, plans, own, { jrQty, jcQty: num(order.jc_qty) });
    const ratio = picked.ratio;
    const required = Math.round(jrQty * ratio);
    const produced = list.reduce((s, m) => s + m.produced, 0);
    const reject = list.reduce((s, m) => s + m.reject, 0);
    /* a closed plan only covers what it made */
    const planned = plans.reduce((s, p) => s + (CLOSED.includes(p.status) ? Math.min(num(p.plan_qty), num(p.produced)) : num(p.plan_qty)), 0);
    const balance = Math.max(0, required - produced);

    const names = [...new Set(own.map(it => splitItemName(it.item_name).part).filter(Boolean))];

    let status;
    if (required > 0 && balance === 0) status = 'COMPLETE';
    else if (list.some(m => m.machines.length)) status = 'RUNNING';
    else if (plans.some(p => p.status === 'STOPPED')) status = 'STOPPED';
    else if (plans.some(p => !CLOSED.includes(p.status))) status = 'PLANNED';
    else if (produced > 0) status = 'SHORT';
    else if (!used.length && rows.every(r => r.role === 'DROPPED' || r.role === 'INACTIVE')) status = 'DROPPED';
    else status = 'NOT_PLANNED';

    /* finish: all running moulds of the part share what is left */
    const pph = list.reduce((s, m) => s + num(m.run_pph), 0);
    let eta = null;
    let hoursLeft = null;
    if (balance > 0 && pph > 0) {
      hoursLeft = balance / pph;
      eta = iso(now + hoursLeft * 3600e3);
    } else if (balance > 0) {
      const q = list.filter(m => m.status === 'PLANNED' && m.scheduled && m.expected_start && m.rate_all_pph > 0)
        .sort((a, b) => String(a.expected_start).localeCompare(String(b.expected_start)))[0];
      if (q) {
        hoursLeft = balance / q.rate_all_pph;
        eta = iso(Math.max(now, new Date(q.expected_start).getTime()) + hoursLeft * 3600e3);
      }
    }

    /* colours: need from ERP (scaled to the ratio in use), made from DPR */
    const src = own.filter(it => key(it.mould_no) === key(lead.mould_no));
    const planName = new Map(plans.flatMap(p => p.colour_details || []).map(c => [key(c.itemCode), c.colourName]));
    const scale = lead.ratio_bom > 0 ? ratio / lead.ratio_bom : 1;
    const col = new Map();
    const colRow = name => {
      const k = ckey(name) || '-';
      if (!col.has(k)) col.set(k, { colour: name || 'No colour', required: 0, produced: 0, reject: 0 });
      return col.get(k);
    };
    src.forEach(it => { colRow(planName.get(key(it.item_code)) || splitItemName(it.item_name).colour || it.item_name).required += num(it.qty) * scale; });
    colours.filter(c => keys.includes(key(c.mould_no))).forEach(c => {
      const r = colRow(c.colour);
      r.produced += num(c.good);
      r.reject += num(c.reject);
    });
    const colourRows = [...col.values()]
      .map(c => ({ ...c, required: Math.round(c.required), balance: Math.max(0, Math.round(c.required) - c.produced) }))
      .sort((a, b) => b.required - a.required || a.colour.localeCompare(b.colour));

    return {
      key: keys[0],
      name: names.length ? names.slice(0, 2).join(' / ') : lead.mould_name,
      ratio, ratio_source: picked.source, ratio_own: lead.ratio, ratio_own_source: lead.ratio_source, ratio_erp: lead.ratio_bom,
      erp_required: lead.ratio_bom > 0 ? Math.round(jrQty * lead.ratio_bom) : null,
      required, planned, produced, reject, balance,
      plan_gap: Math.max(0, required - Math.max(planned, produced)),
      over_planned: Math.max(0, planned - required),
      today: list.reduce((s, m) => s + num(m.today_qty), 0),
      reject_pct: produced + reject > 0 ? +(reject / (produced + reject) * 100).toFixed(1) : 0,
      sets: ratio > 0 ? Math.floor(produced / ratio) : 0,
      pct: required > 0 ? Math.min(100, +(produced / required * 100).toFixed(1)) : 0,
      counted: status !== 'DROPPED',
      status, rate_pph: pph, hours_left: hoursLeft == null ? null : +hoursLeft.toFixed(1), eta,
      machines: [...new Set(list.flatMap(m => m.machines))],
      moulds_total: list.length, moulds_used: used.length,
      colours: colourRows,
      moulds: rows
        .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || key(a.m.mould_no).localeCompare(key(b.m.mould_no)))
        .map(({ m, role, drop }) => ({
          mould_no: m.mould_no, mould_name: m.mould_name, role,
          drop: drop ? { by: drop.dropped_by, at: drop.created_at, remarks: drop.remarks } : null,
          produced: m.produced, reject: m.reject, today: m.today_qty,
          planned: m.plans.reduce((s, p) => s + num(p.plan_qty), 0),
          share_pct: produced > 0 ? +(m.produced / produced * 100).toFixed(1) : 0,
          cavity: m.cavity, cycle_time: m.cycle_time, tonnage: m.tonnage, std_pph: m.std_pph, live_pph: m.live_pph,
          shifted: m.shifted, first_date: m.first_date, last_date: m.last_date, allowed_machines: m.allowed_machines,
          plans: m.plans
        }))
    };
  });

  /* short names: drop the words every part name starts with (the product name) */
  if (parts.length > 1) {
    const words = parts.map(p => p.name.split(/\s+/));
    let k = 0;
    while (words.every(w => w.length > k + 1 && key(w[k]) === key(words[0][k]))) k++;
    const short = words.map(w => {
      const rest = w.slice(k).join(' ');
      return rest.replace(/^\([^)]*\)\s+/, '') || rest;
    });
    const unique = new Set(short.map(key)).size === short.length && short.every(x => /^[A-Za-z0-9(]/.test(x));
    parts.forEach((p, i) => { p.full_name = p.name; if (k > 0 && unique) p.name = short[i]; });
  }

  /* ---- complete products ---- */
  const counted = parts.filter(p => p.counted && p.ratio > 0);
  const cap = jrQty || Infinity;
  const ranked = counted.slice().sort((a, b) => a.sets - b.sets);
  const sets = ranked.length ? Math.min(cap, ranked[0].sets) : 0;
  const limit = ranked.length && (!jrQty || ranked[0].sets < jrQty) ? ranked[0] : null;
  const nextSets = limit && ranked[1] ? Math.min(cap, ranked[1].sets) : null;
  parts.forEach(p => {
    p.waiting = p.counted ? Math.max(0, Math.round(p.produced - sets * p.ratio)) : 0;
    p.is_limit = !!limit && p.counted && p.sets === limit.sets;
  });
  const plannedSets = counted.length ? Math.floor(Math.min(cap, ...counted.map(p => Math.max(p.planned, p.produced) / p.ratio))) : 0;

  /* ---- job cards, part-wise (with one job card, everything made belongs to it) ---- */
  const single = order.job_cards.length === 1;
  const jobCards = order.job_cards.map(j => {
    const rows = counted.map(p => {
      const own = new Set(p.moulds.map(m => key(m.mould_no)));
      const made = single ? p.produced : j.moulds.filter(x => own.has(key(x.mould_no))).reduce((s, x) => s + x.produced, 0);
      const need = Math.round(j.qty * p.ratio);
      return { name: p.name, ratio: p.ratio, required: need, produced: made, balance: Math.max(0, need - made), sets: Math.floor(made / p.ratio) };
    });
    const made = rows.length ? Math.min(j.qty || Infinity, ...rows.map(r => r.sets)) : 0;
    return {
      job_card_no: j.job_card_no, job_card_date: j.job_card_date, qty: j.qty, sets: made,
      pct: j.qty > 0 ? Math.min(100, +(made / j.qty * 100).toFixed(1)) : 0,
      planned_start: j.planned_start, planned_end: j.planned_end, planned_comp_date: j.planned_comp_date, parts: rows
    };
  });

  /* ---- finish date ---- */
  const open = counted.filter(p => p.balance > 0);
  const blocked = open.filter(p => !p.eta);
  const eta = open.length && !blocked.length ? open.map(p => p.eta).sort().pop() : null;
  const targetMs = order.target_date ? new Date(order.target_date.slice(0, 10) + 'T23:59:59+05:30').getTime() : null;
  let verdict;
  if (counted.length && !open.length) verdict = { code: 'DONE', text: 'All parts made' };
  else if (!targetMs) verdict = { code: 'NONE', text: 'No target date' };
  else if (targetMs < now) verdict = { code: 'LATE', text: 'Target date passed' };
  else if (!eta) verdict = { code: 'RISK', text: 'At risk' };
  else verdict = new Date(eta).getTime() <= targetMs ? { code: 'OK', text: 'On time' } : { code: 'LATE', text: 'Will be late' };

  /* ---- what needs attention ---- */
  const n = v => Number(v || 0).toLocaleString('en-IN');
  const alerts = [];
  if (limit) {
    const why = { STOPPED: 'stopped', PLANNED: 'planned, not started', NOT_PLANNED: 'not planned yet', SHORT: 'plans closed short', RUNNING: 'running' }[limit.status] || '';
    alerts.push({
      level: limit.status === 'RUNNING' ? 'warn' : 'bad',
      text: `${limit.name} is holding the order (${why}): ${n(limit.produced)} of ${n(limit.required)} made, so ${n(sets)} complete.`
        + (nextSets > sets ? ` Without this wait, ${n(nextSets)} could be complete.` : '')
    });
  }
  open.filter(p => p !== limit && ['STOPPED', 'NOT_PLANNED', 'SHORT'].includes(p.status)).forEach(p => alerts.push({
    level: 'bad',
    text: `${p.name}: ${p.status === 'STOPPED' ? 'stopped' : p.status === 'SHORT' ? 'plans closed, still short' : 'no mould planned'}; ${n(p.balance)} pcs to make.`
  }));
  open.filter(p => p.plan_gap > 0 && p.planned > 0).forEach(p => {
    const alt = p.moulds.filter(m => m.role === 'ALTERNATE').map(m => m.mould_no);
    alerts.push({ level: 'warn', text: `${p.name}: plans cover ${n(Math.max(p.planned, p.produced))} of ${n(p.required)}; ${n(p.plan_gap)} pcs not planned.${alt.length ? ' Other mould available: ' + alt.join(', ') + '.' : ''}` });
  });
  counted.filter(p => p.over_planned > 0 && p.moulds_used > 1).forEach(p => alerts.push({
    level: 'warn', text: `${p.name}: ${p.moulds_used} moulds are planned for ${n(p.planned)} pcs together, ${n(p.over_planned)} more than needed.`
  }));
  counted.filter(p => p.ratio_erp > 0 && Math.abs(p.ratio_erp - p.ratio) / p.ratio > 0.05).forEach(p => alerts.push({
    level: 'warn',
    text: `${p.name}: ERP asks ${n(p.erp_required)} pcs (${+p.ratio_erp.toFixed(2)} per product), Planning planned for ${+p.ratio.toFixed(2)} per product (${n(p.required)} pcs). Counting with ${+p.ratio.toFixed(2)}; check which is right.`
  }));
  parts.filter(p => !p.counted).forEach(p => alerts.push({ level: 'info', text: `${p.name}: every mould was dropped or is inactive, so it is not counted in complete products.` }));
  counted.filter(p => p.reject_pct >= 5).forEach(p => alerts.push({ level: 'warn', text: `${p.name}: rejection ${p.reject_pct}% (${n(p.reject)} pcs).` }));

  return {
    parts, parts_total: counted.length, parts_complete: counted.filter(p => p.balance === 0).length,
    sets, sets_balance: Math.max(0, jrQty - sets), sets_pct: jrQty > 0 ? +(sets / jrQty * 100).toFixed(1) : 0,
    planned_sets: plannedSets, next_sets: nextSets,
    limit: limit ? { name: limit.name, sets: limit.sets, status: limit.status } : null,
    blocked: blocked.map(p => p.name), expected_end: eta, verdict, alerts, job_cards: jobCards
  };
}

/* Splits each part's need over the moulds really making it, for the Order Tracker
   page. moulds: [{ key, mould_no, mould_name, ratio, ratio_bom, ratio_source, produced, plans }].
   Returns alloc (key -> { ratio, source, required, share, group }) for moulds that count,
   and the spare moulds (another mould makes the part, dropped, or inactive). */
function allocateParts(moulds, items, { drops = [], inactive = new Set(), jrQty, jcQty }) {
  const byKey = new Map(moulds.map(m => [m.key, m]));
  const alloc = new Map();
  const spare = [];
  const isDropped = m => drops.some(d => [d.mould_no, d.item_code].some(v => v && key(v) === m.key) || (d.mould_name && key(d.mould_name) === key(m.mould_name)));
  const isOpen = p => !CLOSED.includes(key(p.status));
  groupMoulds([...byKey.keys()], items).forEach((keys, group) => {
    const list = keys.map(k => byKey.get(k));
    /* a closed plan that made nothing leaves nothing to count */
    let used = list.filter(m => m.produced > 0 || m.plans.some(isOpen));
    if (!used.length) {
      const free = list.find(m => m.plans.length) || list.find(m => !isDropped(m) && !inactive.has(m.key));
      used = free ? [free] : [];
    }
    list.filter(m => !used.includes(m)).forEach(m => spare.push({
      mould_no: m.mould_no, mould_name: m.mould_name,
      role: m.plans.length ? 'CLOSED' : isDropped(m) ? 'DROPPED' : inactive.has(m.key) ? 'INACTIVE' : 'ALTERNATE',
      used_instead: used.map(u => u.mould_no)
    }));
    if (!used.length) return;
    const lead = list.find(m => m.produced > 0 || m.plans.length) || used[0];
    const picked = pickRatio(lead, list.flatMap(m => m.plans), items.filter(it => keys.includes(key(it.mould_no))), { jrQty, jcQty });
    const need = Math.round(jrQty * picked.ratio);
    const made = used.reduce((t, m) => t + m.produced, 0);
    const balance = Math.max(0, need - made);
    /* what is left goes by open plan balance; with no open plan, to the mould that made most */
    const open = used.map(m => m.plans.some(isOpen));
    let weight = used.map(m => m.plans.filter(isOpen).reduce((t, p) => t + Math.max(0, num(p.plan_qty) - num(p.produced)), 0));
    if (!weight.some(w => w > 0)) {
      const most = used.reduce((best, m, i) => (m.produced > used[best].produced ? i : best), 0);
      weight = used.map((m, i) => (open.some(Boolean) ? Number(open[i]) : Number(i === most)));
    }
    const total = weight.reduce((a, b) => a + b, 0);
    const last = weight.reduce((at, w, i) => (w > 0 ? i : at), 0);
    let left = balance;
    used.forEach((m, i) => {
      const extra = i === last ? left : Math.min(left, Math.round(balance * weight[i] / total));
      left -= extra;
      const required = used.length === 1 ? need
        : balance === 0 && made > 0 ? Math.min(m.produced, Math.round(m.produced * need / made))
          : m.produced + extra;
      alloc.set(m.key, { ratio: picked.ratio, source: picked.source, required, share: need > 0 ? required / need : 1, group, partMoulds: used.length });
    });
  });
  return { alloc, spare };
}

module.exports = { allocateParts, buildParts, groupMoulds, pickRatio, splitItemName };
