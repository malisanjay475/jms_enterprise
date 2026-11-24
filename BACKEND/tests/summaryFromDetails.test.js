'use strict';

const { deriveSummaryRowsFromDetails } = require('../src/modules/planning/summaryFromDetails');

const d = (or, mould, code, qty) => ({
  or_jr_no: or, mould_no: mould, mould_item_code: code, mould_item_name: code,
  mould_item_qty: qty, plan_qty: qty, machine_name: 'M1', factory_id: 4
});

describe('ORJR Wise Summary rows built from ERP Details', () => {
  // The real JR/JGUII/2627/0092 case.
  const details = [
    d('O/92', 'BODY 1', 'Peach', 7200), d('O/92', 'BODY 1', 'Blue', 7200), d('O/92', 'BODY 1', 'Green', 7200),
    d('O/92', 'LID', 'Peach', 7200), d('O/92', 'LID', 'Blue', 7200), d('O/92', 'LID', 'Green', 7200)
  ];

  it('gives one row per mould with the colour quantities added up', () => {
    const rows = deriveSummaryRowsFromDetails([], details, []);
    expect(rows.map((r) => [r.mould_no, r.mould_item_qty, r.plan_qty])).toEqual([
      ['BODY 1', 21600, 21600], ['LID', 21600, 21600]
    ]);
    expect(rows[0]).toMatchObject({ factory_id: 4, machine_name: 'M1' });
    expect(rows[0]).not.toHaveProperty('mould_item_code');
    expect(details[0].mould_item_qty).toBe(7200);
  });

  it('leaves an order alone when ERP summary has a mould for it', () => {
    expect(deriveSummaryRowsFromDetails([{ or_jr_no: ' o/92 ', mould_no: 'X' }], details, [])).toEqual([]);
  });

  it('leaves an order alone when it is already in the planning summary', () => {
    expect(deriveSummaryRowsFromDetails([], details, ['O/92 '])).toEqual([]);
  });

  it('ignores detail rows with no mould', () => {
    expect(deriveSummaryRowsFromDetails([], [d('O/92', ' ', 'Peach', 1)], [])).toEqual([]);
  });
});
