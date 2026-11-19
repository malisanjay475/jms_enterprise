'use strict';

/**
 * Packing crew maths (step 10): who worked on which station when, and each packer's
 * share of the station's pieces.
 *
 * Scans are made per station, not per person, so a station's good scans in each clock
 * hour are split among the packers on it during that hour, by the minutes each was
 * there (equal split when they were all there the whole hour).
 *
 * Only the day shift counts (09:00-17:00 IST). A crew row left open past 17:00 stops
 * at 17:00 of the day it started, so a forgotten "remove" does not run overnight.
 *
 * vs std = standard person-time earned / time on station, where one piece earns
 * cycle seconds x standard persons (Packing Masters: CycleTime is seconds per piece
 * for the whole station crew).
 */

const IST_MS = 5.5 * 3600e3;
const DAY_MS = 86400e3;
const HOUR_MS = 3600e3;
const SHIFT_START_MIN = 9 * 60;
const SHIFT_END_MIN = 17 * 60;

const num = (v) => Number(v) || 0;

function istDayStart(ms) {
  return Math.floor((ms + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
}
const istDate = (ms) => new Date(istDayStart(ms) + IST_MS).toISOString().slice(0, 10);
const shiftStart = (ms) => istDayStart(ms) + SHIFT_START_MIN * 60000;
const shiftEnd = (ms) => istDayStart(ms) + SHIFT_END_MIN * 60000;

/* When a crew row really ended: its end, or 17:00 of its day if still open / later. */
function effectiveEnd(row, nowMs) {
  const start = num(row.start_ms);
  const cap = shiftEnd(start);
  const end = row.end_ms ? num(row.end_ms) : nowMs;
  return Math.max(start, Math.min(end, cap));
}

/* Milliseconds of [a, b) that fall inside the shift (a and b on the same IST day). */
function shiftOverlap(a, b) {
  const lo = Math.max(a, shiftStart(a));
  const hi = Math.min(b, shiftEnd(a));
  return hi > lo ? hi - lo : 0;
}

/**
 * crew:  [{ worker_id, worker_name, station, start_ms, end_ms }]
 * scans: [{ station, hour_ms, n, cycle, persons }]  good scans per station, clock hour and plan std
 * Returns one row per IST day + worker, and per day + station the pieces packed with no crew on it.
 */
function shareOutput(crew, scans, nowMs) {
  const spans = crew.map(c => ({
    ...c,
    key: String(c.station || '').toLowerCase(),
    a: num(c.start_ms),
    b: effectiveEnd(c, nowMs)
  })).filter(c => c.b > c.a);

  const rows = new Map(); // day|worker -> row
  const rowOf = (day, c) => {
    const k = `${day}|${c.worker_id}`;
    if (!rows.has(k)) {
      rows.set(k, { day, worker_id: c.worker_id, worker_name: c.worker_name || '', badge_no: c.badge_no || '', contractor: c.contractor || '',
        stations: [], work_ms: 0, pcs: 0, earned_s: 0, std_pcs: 0 });
    }
    return rows.get(k);
  };
  for (const c of spans) {
    const r = rowOf(istDate(c.a), c);
    r.work_ms += shiftOverlap(c.a, c.b);
    if (!r.stations.includes(c.station)) r.stations.push(c.station);
  }

  const byStation = new Map();
  for (const c of spans) {
    if (!byStation.has(c.key)) byStation.set(c.key, []);
    byStation.get(c.key).push(c);
  }
  const noCrew = new Map(); // day|station -> pcs
  for (const s of scans) {
    const h0 = num(s.hour_ms), h1 = h0 + HOUR_MS;
    const n = num(s.n);
    if (!n) continue;
    const list = byStation.get(String(s.station || '').toLowerCase()) || [];
    const share = new Map();
    let total = 0;
    for (const c of list) {
      const ms = shiftOverlap(Math.max(c.a, h0), Math.min(c.b, h1));
      if (ms > 0) { share.set(c, (share.get(c) || 0) + ms); total += ms; }
    }
    if (!total) {
      const k = `${istDate(h0)}|${s.station}`;
      noCrew.set(k, (noCrew.get(k) || 0) + n);
      continue;
    }
    for (const [c, ms] of share) {
      const pcs = n * ms / total;
      const r = rowOf(istDate(c.a), c);
      r.pcs += pcs;
      if (num(s.cycle) > 0 && num(s.persons) > 0) {
        r.earned_s += pcs * num(s.cycle) * num(s.persons);
        r.std_pcs += pcs;
      }
    }
  }

  const out = [...rows.values()].map(r => {
    const workS = r.work_ms / 1000;
    return {
      day: r.day,
      worker_id: r.worker_id,
      worker_name: r.worker_name,
      badge_no: r.badge_no,
      contractor: r.contractor,
      stations: r.stations.join(', '),
      hours: Math.round(workS / 360) / 10,
      pcs: Math.round(r.pcs),
      pcs_hr: workS >= 360 ? Math.round(r.pcs / (workS / 3600)) : null,
      vs_std: workS >= 360 && r.std_pcs > 0 ? Math.round(r.earned_s / workS * 100) : null,
      std_partial: r.std_pcs > 0 && r.std_pcs < r.pcs - 0.5
    };
  }).sort((x, y) => (x.day < y.day ? 1 : x.day > y.day ? -1 : x.worker_name.localeCompare(y.worker_name)));
  const unassigned = [...noCrew.entries()].map(([k, pcs]) => { const [day, station] = k.split('|'); return { day, station, pcs }; });
  return { rows: out, unassigned };
}

/* Standard speed for the people actually on the station: std x actual / std persons. */
function crewStdRate(stdPcsHr, stdPersons, actual) {
  const std = num(stdPcsHr), p = num(stdPersons), a = num(actual);
  if (!(std > 0) || !(p > 0) || !(a > 0)) return std > 0 ? std : 0;
  return Math.round(std * a / p);
}

/* "HH:MM" today (IST) -> instant, or null. Refuses a time in the future. */
function todayAt(hhmm, nowMs) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const t = istDayStart(nowMs) + (h * 60 + mi) * 60000;
  return t > nowMs + 60000 ? null : t;
}

module.exports = { IST_MS, istDayStart, istDate, shiftStart, shiftEnd, effectiveEnd, shiftOverlap, shareOutput, crewStdRate, todayAt };
