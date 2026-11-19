'use strict';

/**
 * Packing day close (step 11) - the maths, no database.
 *
 * For one station and one IST day (shift 09:00-17:00):
 *  - each plan's day qty = its plan qty x the share of its working minutes that fall on
 *    the day (a plan rolling past 17:00 is split over its days);
 *  - packed = good scans of the plan on the day;
 *  - stoppages = stretches of more than IDLE_MIN minutes with no good scan of the station
 *    while it was meant to be packing: inside a plan's window (09:00-17:00 only), or to
 *    17:00 while a plan still had work left. A planned gap between two jobs is not a
 *    stoppage. The same 10 minutes the reports and the live screen use.
 */

const { shiftMinutesBetween } = require('../orderTracker/packingProgress');
const { IDLE_MIN, istMs } = require('./packingLive');

const IST_MS = 5.5 * 3600e3;
const DAY_MS = 86400e3;
const SHIFT_START_MIN = 9 * 60;
const SHIFT_END_MIN = 17 * 60;
const MAX_STOPPAGES = 60;

const num = (v) => Number(v) || 0;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* 'YYYY-MM-DD' -> the day's IST midnight and shift start / end as instants, or null. */
function dayBounds(day) {
  if (!DAY_RE.test(String(day || ''))) return null;
  const mid = Date.parse(`${day}T00:00:00+05:30`);
  if (!Number.isFinite(mid)) return null;
  return { day, midMs: mid, startMs: mid + SHIFT_START_MIN * 60000, endMs: mid + SHIFT_END_MIN * 60000 };
}

/* Today's IST date. */
function istToday(nowMs = Date.now()) {
  return new Date(Math.floor((nowMs + IST_MS) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/* A plan's planned window as instants: start .. end (or start + duration when end is missing). */
function planWindow(p) {
  const s = istMs(p.start_local);
  if (!s) return null;
  let e = istMs(p.end_local);
  if (!e || e <= s) e = s + Math.max(1, num(p.duration_min)) * 60000;
  return { s, e };
}

/* The part of a plan's qty that belongs to the day. */
function planDayQty(p, b) {
  const w = planWindow(p);
  const qty = num(p.plan_qty);
  if (!w || !qty) return 0;
  const total = shiftMinutesBetween(w.s, w.e);
  /* planned wholly outside 09:00-17:00 (overtime): not part of the day-shift plan; what it packs still counts */
  if (total <= 0) return 0;
  const inDay = shiftMinutesBetween(Math.max(w.s, b.midMs), Math.min(w.e, b.midMs + DAY_MS));
  return Math.round(qty * inDay / total);
}

/* Tables of the plans whose window overlaps [a, b). */
function tablesAt(plans, a, b) {
  const out = [];
  for (const p of plans) {
    const w = planWindow(p);
    if (!w || w.e <= a || w.s >= b) continue;
    for (const c of String(p.tables || '').split(',').map(x => x.trim()).filter(Boolean)) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/*
 * When the station was meant to be packing on the day: each plan's window, clipped to the
 * shift (and to now). A plan with work left at the end of the day stays busy to 17:00; a
 * plan that was finished early stops at its last good scan. Returns merged [from, to] pairs.
 */
function busyWindows(plans, b, end) {
  const list = [];
  for (const p of plans) {
    const w = planWindow(p);
    if (!w) continue;
    let e = w.e;
    if (num(p.left) > 0) e = Math.max(e, end);
    else if (p.last_ms) e = Math.min(e, Number(p.last_ms));
    const a = Math.max(w.s, b.startMs), z = Math.min(e, end);
    if (z > a) list.push([a, z]);
  }
  list.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, z] of list) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], z);
    else out.push([a, z]);
  }
  return out;
}

/**
 * Stoppages of a station on a day: stretches of more than idleMin minutes with no good
 * scan while the station was meant to be packing (busyWindows).
 * scans: good-scan instants (ms) of the station's plans on the day, any order.
 * plans: the station's plans of the day (start_local / end_local / tables / left / last_ms).
 * nowMs: stoppages never run past now (closing the day before 17:00).
 */
function stoppagesOf(scans, plans, b, nowMs = Date.now(), idleMin = IDLE_MIN) {
  const end = Math.min(b.endMs, nowMs);
  if (end <= b.startMs || !plans.length) return [];
  const busy = busyWindows(plans, b, end);
  if (!busy.length) return [];
  const sorted = scans.filter(t => t >= b.startMs && t < end).sort((x, y) => x - y);
  const marks = [b.startMs, ...sorted, end];
  const gaps = [];
  for (let i = 1; i < marks.length && gaps.length < MAX_STOPPAGES; i++) {
    const a = marks[i - 1], z = marks[i];
    if (z - a <= idleMin * 60000) continue;
    /* the busy part of the gap, as one stretch from its first to its last busy minute */
    let from = null, to = null, min = 0;
    for (const [bs, be] of busy) {
      const x = Math.max(a, bs), y = Math.min(z, be);
      if (y <= x) continue;
      if (from === null) from = x;
      to = y;
      min += (y - x) / 60000;
    }
    if (from !== null && min > idleMin) gaps.push({ from_ms: from, to_ms: to, minutes: Math.round(min), tables: tablesAt(plans, from, to) });
  }
  return gaps.map(g => ({
    ...g,
    key: String(g.from_ms),
    from: new Date(g.from_ms).toISOString(),
    to: new Date(g.to_ms).toISOString()
  }));
}

/**
 * The day-close draft of a station.
 * plans: rows { id, job_card_no, item_name, client_name, tables, plan_qty, start_local, end_local, duration_min,
 *        status, left, last_ms } - left = qty still to pack at the end of the day (plan qty - good scans up to
 *        then), last_ms = the plan's last good scan up to the end of the day
 * packedByPlan: Map plan id -> good scans on the day
 * scans: good-scan instants (ms) of the station on the day
 */
function buildDraft(plans, packedByPlan, scans, b, nowMs = Date.now()) {
  const lines = [];
  for (const p of plans) {
    const dayQty = planDayQty(p, b);
    const packed = num(packedByPlan.get(Number(p.id)));
    if (!dayQty && !packed) continue;
    /* a plan that has not started yet when the day is closed (overtime after 17:00) is not short */
    const w = planWindow(p);
    if (!packed && w && w.s > nowMs) continue;
    lines.push({
      plan_id: Number(p.id),
      job_card_no: p.job_card_no || '',
      item_name: p.item_name || '',
      client_name: p.client_name || '',
      tables: p.tables || '',
      plan_qty: dayQty,
      packed,
      short: Math.max(0, dayQty - packed)
    });
  }
  const dayPlans = plans.filter(p => lines.some(l => l.plan_id === Number(p.id)));
  const stoppages = stoppagesOf(scans, dayPlans, b, nowMs);
  return { lines, stoppages, totals: totalsOf(lines, stoppages) };
}

function totalsOf(lines, stoppages) {
  return {
    plan_qty: lines.reduce((s, l) => s + num(l.plan_qty), 0),
    packed: lines.reduce((s, l) => s + num(l.packed), 0),
    short: lines.reduce((s, l) => s + num(l.short), 0),
    lost_min: stoppages.reduce((s, g) => s + num(g.minutes), 0)
  };
}

/**
 * Put the supervisor's reasons on the draft. Returns { lines, stoppages, missing }:
 * missing lists what still needs a reason (short plans and every stoppage).
 * reasons: the active reason labels; a label that needs a note ("Other") must have one.
 */
function applyReasons(draft, given, reasons) {
  const byPlan = new Map((given.lines || []).slice(0, 200).map(l => [Number(l && l.plan_id), l]));
  const byKey = new Map((given.stoppages || []).slice(0, 200).map(g => [String(g && g.key), g]));
  const known = new Map(reasons.map(r => [String(r.label).toLowerCase(), r]));
  const missing = [];
  const pick = (src, what) => {
    const label = String((src && src.reason) || '').trim().slice(0, 80);
    const note = String((src && src.note) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const r = known.get(label.toLowerCase());
    if (!r) { missing.push(what); return { reason: '', note }; }
    if (r.needs_note && note.length < 3) { missing.push(`${what} (add a note)`); return { reason: r.label, note }; }
    return { reason: r.label, note };
  };
  const lines = draft.lines.map(l => (l.short > 0
    ? { ...l, ...pick(byPlan.get(l.plan_id), `${l.item_name || 'Plan ' + l.plan_id}${l.job_card_no ? ` (${l.job_card_no})` : ''}: why ${l.short} short`) }
    : { ...l, reason: '', note: '' }));
  const stoppages = draft.stoppages.map(g => ({ ...g, ...pick(byKey.get(g.key), `stoppage ${hhmm(g.from_ms)}-${hhmm(g.to_ms)}`) }));
  return { lines, stoppages, missing };
}

function hhmm(ms) {
  const d = new Date(ms + IST_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const DEFAULT_REASONS = [
  { label: 'No moulded stock', needs_note: false },
  { label: 'No packing material', needs_note: false },
  { label: 'Short crew', needs_note: false },
  { label: 'Scanner / power', needs_note: false },
  { label: 'Quality hold', needs_note: false },
  { label: 'Plan too high', needs_note: false },
  { label: 'Other', needs_note: true }
];

module.exports = {
  dayBounds, istToday, planWindow, planDayQty, tablesAt, busyWindows, stoppagesOf, buildDraft, totalsOf, applyReasons, hhmm,
  DEFAULT_REASONS, MAX_STOPPAGES
};
