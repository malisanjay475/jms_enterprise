'use strict';

// ERP's GetORJRSummary is a change feed: a row sent with a blank mould may not be sent
// again when the mould is linked later. GetORJRDetails does carry the mould, so for an
// order with no mould in any ERP summary row, build its mould_planning_summary rows
// from Details: one per order + mould, quantity = sum over its colours (this equals
// ERP's own summary quantity for 98% of live rows, 24-Nov-2026).
const norm = (v) => String(v ?? '').trim().toLowerCase();

// summaryRows: usable ERP summary rows. detailRows: ERP detail rows in planning shape.
// plannedOrderNos: orders that already have a planning summary row. They are skipped
// whole: their rows may carry an older mould, and adding the new one beside it would
// double the order's load.
function deriveSummaryRowsFromDetails(summaryRows, detailRows, plannedOrderNos) {
  const skip = new Set([...summaryRows.map((r) => r.or_jr_no), ...plannedOrderNos].map(norm));
  const derived = new Map();
  for (const d of detailRows) {
    if (!norm(d.or_jr_no) || !norm(d.mould_no) || skip.has(norm(d.or_jr_no))) continue;
    const key = `${norm(d.or_jr_no)}|${norm(d.mould_no)}`;
    const row = derived.get(key);
    if (row) {
      row.mould_item_qty = (Number(row.mould_item_qty) || 0) + (Number(d.mould_item_qty) || 0);
      row.plan_qty = row.mould_item_qty;
    } else {
      const copy = { ...d };
      delete copy.mould_item_code;
      delete copy.mould_item_name;
      derived.set(key, copy);
    }
  }
  return Array.from(derived.values());
}

module.exports = { deriveSummaryRowsFromDetails };
