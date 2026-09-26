'use strict';

const { normalizeFactoryId } = require('../app/requestContext');

// A blank-Job-Card OR-JR row is only a placeholder for an order line whose Job Card
// is not created yet. Once a real Job Card row exists for the same order (same
// factory, and the same item — or the placeholder has no item), the OR-JR save's
// de-dup step deletes the placeholder again (saveOrJrRows in registerLegacyRoutes).
// Importing such a placeholder is therefore pointless: the ERP snapshot keeps listing
// them, and every ERP AutoSync run re-inserted ~1,560 of them only to delete them
// again (VPS, 26-Sep-2026). These helpers apply the same rule as that DELETE.

function createRealJcIndex() {
  return new Set();
}

// Record an existing or_jr_report row; only rows with a real Job Card count.
function addRealJcRow(index, row) {
  const o = String(row.or_jr_no || '').trim();
  const j = String(row.job_card_no || '').trim();
  if (!o || !j) return;
  const fac = normalizeFactoryId(row.factory_id) ?? 0;
  index.add(`${o}|${fac}|*`);
  index.add(`${o}|${fac}|${String(row.item_code || '').trim()}`);
}

// True when `row` is a blank-JC placeholder that the save would delete straight away.
function isSupersededBlankJc(row, index, requestFactoryId) {
  if (!index) return false;
  if (String(row.job_card_no || '').trim() !== '') return false;
  const o = String(row.or_jr_no || '').trim();
  if (!o) return false;
  const fac = normalizeFactoryId(row.factory_id) ?? normalizeFactoryId(requestFactoryId) ?? 0;
  const item = String(row.item_code || '').trim();
  return item === '' ? index.has(`${o}|${fac}|*`) : index.has(`${o}|${fac}|${item}`);
}

module.exports = { createRealJcIndex, addRealJcRow, isSupersededBlankJc };
