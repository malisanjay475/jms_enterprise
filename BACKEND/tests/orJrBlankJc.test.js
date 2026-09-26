'use strict';

const fs = require('fs');
const path = require('path');
const { createRealJcIndex, addRealJcRow, isSupersededBlankJc } = require('../src/utils/orJrBlankJc');

describe('OR-JR blank-JC placeholders superseded by a real Job Card', () => {
  const index = createRealJcIndex();
  // Existing or_jr_report rows (as loadOrJrExistingMap reads them).
  addRealJcRow(index, { or_jr_no: 'JR/JGUI/2526/10', job_card_no: 'JC/1', item_code: 'ITEM-A', factory_id: 1 });
  addRealJcRow(index, { or_jr_no: ' JR/JP/2526/5 ', job_card_no: ' JC/9 ', item_code: ' ITEM-B ', factory_id: '3' });
  addRealJcRow(index, { or_jr_no: 'JR/JGUI/2526/11', job_card_no: '', item_code: 'ITEM-C', factory_id: 1 }); // blank JC: not a real one

  it('skips a placeholder whose order + item already has a real Job Card in the same factory', () => {
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/10', job_card_no: '', item_code: 'ITEM-A', factory_id: 1 }, index, 1)).toBe(true);
    // trimmed on both sides, factory id given as text
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JP/2526/5', job_card_no: null, item_code: 'ITEM-B', factory_id: 3 }, index, 3)).toBe(true);
  });

  it('skips a placeholder with no item when the order has any real Job Card', () => {
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/10', job_card_no: '', item_code: '', factory_id: 1 }, index, 1)).toBe(true);
  });

  it('falls back to the importing factory when the row has no factory_id', () => {
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/10', job_card_no: '', item_code: 'ITEM-A' }, index, 1)).toBe(true);
  });

  it('keeps a placeholder for a different item, a different factory, or an order with no real Job Card', () => {
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/10', job_card_no: '', item_code: 'ITEM-Z', factory_id: 1 }, index, 1)).toBe(false);
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/10', job_card_no: '', item_code: 'ITEM-A', factory_id: 2 }, index, 2)).toBe(false);
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/11', job_card_no: '', item_code: 'ITEM-C', factory_id: 1 }, index, 1)).toBe(false);
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/99', job_card_no: '', item_code: 'ITEM-A', factory_id: 1 }, index, 1)).toBe(false);
  });

  it('never skips a row that has its own Job Card, and is safe without an index', () => {
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/10', job_card_no: 'JC/2', item_code: 'ITEM-A', factory_id: 1 }, index, 1)).toBe(false);
    expect(isSupersededBlankJc({ or_jr_no: 'JR/JGUI/2526/10', job_card_no: '', item_code: 'ITEM-A', factory_id: 1 }, undefined, 1)).toBe(false);
  });
});

describe('legacy wiring for the OR-JR / Order Master ERP churn fixes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'legacy', 'registerLegacyRoutes.js'), 'utf8');

  it('classifies a superseded blank-JC placeholder as SKIP instead of NEW', () => {
    expect(src).toMatch(/if \(isSupersededBlankJc\(row, dbMap\.realJcIndex, requestFactoryId\)\) \{\s*return \{ \.\.\.row, _status: 'SKIP'/);
    expect(src).toMatch(/addRealJcRow\(realJcIndex, row\)/);
  });

  it('Order Master build only updates an order when a field would change', () => {
    const start = src.indexOf('async function runOrdersFetchFromOrJr');
    const body = src.slice(start, src.indexOf('// C. FINAL SAFEGUARD', start));
    expect(body).toMatch(/WHERE id = \$1\s*AND \(\s*item_code IS DISTINCT FROM \$2/);
    expect(body).toMatch(/if \(upd\.rowCount > 0\) updated\+\+;/);
  });
});
