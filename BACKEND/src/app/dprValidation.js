'use strict';

// Server-side sanity checks for hourly DPR quantities.
//
// Before this, /api/dpr/submit and /api/dpr/edit stored whatever numbers arrived. A
// negative good quantity lowered a colour's "produced" total, which also let later
// entries get past the 110% over-production cap, and downtime had no upper bound per
// hourly slot. Limits were checked against every live entry on factory-1 (24-Sep-2026,
// 320,011 rows): no quantity was ever negative and every quick-action type caps at
// 60 minutes, so real entries are not affected (the only two misses were one -1 and
// one 80-minute downtime).

const MAX_DOWNTIME_PER_SLOT_MIN = 60;

function toNumberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(typeof v === 'string' ? v.trim().replace(/,/g, '') : v);
  return Number.isNaN(n) ? NaN : n;
}

// Returns an error message for the operator, or null when the values are fine.
// Blank fields are allowed (they are stored as empty, as before).
function validateDprQuantities({ shots, good, reject, downtime } = {}) {
  const fields = [
    ['Shots', shots],
    ['Good quantity', good],
    ['Reject quantity', reject],
    ['Downtime', downtime]
  ];
  for (const [label, raw] of fields) {
    const n = toNumberOrNull(raw);
    if (n === null) continue;
    if (!Number.isFinite(n)) return `${label} must be a number.`;
    if (n < 0) return `${label} cannot be negative.`;
  }
  const dt = toNumberOrNull(downtime);
  if (dt !== null && dt > MAX_DOWNTIME_PER_SLOT_MIN) {
    return `Downtime cannot be more than ${MAX_DOWNTIME_PER_SLOT_MIN} minutes in one hour slot.`;
  }
  return null;
}

module.exports = { validateDprQuantities, MAX_DOWNTIME_PER_SLOT_MIN };
