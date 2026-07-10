'use strict';

// Shared machine-name helpers. Kept in a standalone module so they can be unit
// tested without booting the whole legacy routes file (which needs a DB).

// Strip the legacy building/line prefix from a machine code:
//   "B -L1>HYD-350-1" -> "HYD-350-1"
// Storing the prefixed form creates a second machines-master row for a code that
// also exists in clean form. The machines unique index compares the raw string,
// so it does NOT treat the two forms as the same and both are allowed. The
// planning-board query then matches BOTH rows and every plan on that machine is
// returned twice. Normalising at every write keeps a single canonical form.
function stripMachinePrefix(value) {
  const raw = String(value == null ? '' : value).trim();
  if (raw.includes('>')) {
    const after = raw.split('>').pop().trim();
    if (after) return after;
  }
  return raw;
}

// JS safety net mirroring the SQL `DISTINCT ON (pb.id)` guard on /api/planning/board.
// Even if the SQL guard is ever removed or a new join fans out, this collapses any
// repeated plan id so the board can never render the same plan twice. Keeps the
// first occurrence (SQL already ordered the preferred row first).
function dedupePlansById(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = r && r.id;
    if (id === undefined || id === null) { out.push(r); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

module.exports = { stripMachinePrefix, dedupePlansById };
