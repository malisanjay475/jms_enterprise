'use strict';

/**
 * DPR change counting — ONE rule for Mould Change (MC), Colour Change (CC) and
 * Job Change (JC), so every report counts the same way.
 *
 * Input: dpr_hourly rows for ONE machine, any shifts. Rows are walked in real
 * time order (Day 07-08 … 06-07, then Night 07-08 … 06-07; within an hour by
 * created_at, then id). Each change is attributed to the shift it happens in.
 *
 *  MC — a Mould Change / Changeover entry, or a block of Mould Change downtime
 *       (code '2'), counts once per contiguous block of hours. A produced mould
 *       that differs from the previous produced mould also counts — unless a
 *       change event was already counted since that previous mould (so one
 *       physical change is never counted twice). A→B→A = 2 changes.
 *  CC — same idea: a ColourChange entry or a block of Colour Change downtime
 *       (code '9'), or the colour differing from the previous colour.
 *  JC — the job (plan) differing from the previous produced job.
 *
 * `seed` carries the last mould/colour/job from the previous shift so a change
 * right at the shift boundary (Day → Night, or previous Night → Day) counts.
 */

const SLOT_ORDER = ['07-08', '08-09', '09-10', '10-11', '11-12', '12-01',
  '01-02', '02-03', '03-04', '04-05', '05-06', '06-07'];
const SHIFT_ORDER = { Day: 0, Night: 1 };

const cleanSlot = s => {
  const v = String(s || '');
  return v.includes('|') ? v.split('|').pop().trim() : v.trim();
};
const slotRank = s => {
  const i = SLOT_ORDER.indexOf(cleanSlot(s));
  return i < 0 ? 99 : i;
};
const norm = v => {
  const s = v === null || v === undefined ? '' : String(v).trim().toUpperCase();
  return s || null;
};
const num = v => Number(v) || 0;
const breakup = row => {
  let b = row && row.downtime_breakup;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  return b && typeof b === 'object' ? b : {};
};

function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const sa = SHIFT_ORDER[a.shift] ?? 9, sb = SHIFT_ORDER[b.shift] ?? 9;
    if (sa !== sb) return sa - sb;
    const ra = slotRank(a.hour_slot), rb = slotRank(b.hour_slot);
    if (ra !== rb) return ra - rb;
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return num(a.id) - num(b.id);
  });
}

/**
 * @param {Array} rows   dpr_hourly rows of one machine (shift, hour_slot, entry_type,
 *                       downtime_breakup, good_qty, reject_qty, mould_key, job_key, colour)
 * @param {Object} seed  { mould, colour, job } last values before these rows (optional)
 * @returns {{ byShift: Object<string,{mc,cc,jc}>, last: {mould,colour,job} }}
 */
function countChanges(rows, seed = {}) {
  const byShift = {};
  const bump = (shift, k) => {
    if (!byShift[shift]) byShift[shift] = { mc: 0, cc: 0, jc: 0 };
    byShift[shift][k]++;
  };

  let lastMould = norm(seed.mould), lastColour = norm(seed.colour), lastJob = norm(seed.job);
  // "an event was counted since the last produced value" — suppresses double count
  let mcSinceMould = false, ccSinceColour = false;
  // contiguous-hour event blocks
  let prevHourKey = null, mcPrevHour = false, ccPrevHour = false, mcThisHour = false, ccThisHour = false;

  for (const r of sortRows(rows || [])) {
    const shift = r.shift || 'Day';
    const hourKey = `${shift}|${cleanSlot(r.hour_slot)}`;
    if (hourKey !== prevHourKey) {
      if (prevHourKey !== null) { mcPrevHour = mcThisHour; ccPrevHour = ccThisHour; }
      mcThisHour = false; ccThisHour = false;
      prevHourKey = hourKey;
    }

    const et = String(r.entry_type || '');
    const dt = breakup(r);
    const isMcEvent = et === 'MouldChange' || et === 'MouldChangeover' || num(dt['2']) > 0;
    const isCcEvent = et === 'ColourChange' || num(dt['9']) > 0;

    if (isMcEvent) {
      if (!mcThisHour && !mcPrevHour) { bump(shift, 'mc'); mcSinceMould = true; }
      mcThisHour = true;
    }
    if (isCcEvent) {
      if (!ccThisHour && !ccPrevHour) { bump(shift, 'cc'); ccSinceColour = true; }
      ccThisHour = true;
    }

    const produced = num(r.good_qty) > 0 || num(r.reject_qty) > 0 || num(r.shots) > 0;
    const colour = norm(r.colour);
    if (colour && (produced || et === 'ColourChange')) {
      if (lastColour && colour !== lastColour && !ccSinceColour) bump(shift, 'cc');
      lastColour = colour; ccSinceColour = false;
    }
    if (!produced) continue;

    const mould = norm(r.mould_key);
    if (mould) {
      if (lastMould && mould !== lastMould && !mcSinceMould) bump(shift, 'mc');
      lastMould = mould; mcSinceMould = false;
    }
    const job = norm(r.job_key);
    if (job) {
      if (lastJob && job !== lastJob) bump(shift, 'jc');
      lastJob = job;
    }
  }

  return { byShift, last: { mould: lastMould, colour: lastColour, job: lastJob } };
}

module.exports = { countChanges, cleanSlot, SLOT_ORDER };
