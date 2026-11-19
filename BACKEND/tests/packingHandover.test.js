'use strict';

const { refusal, slipNo, UNIT_SQL } = require('../src/modules/packing/registerPackingHandoverRoutes');

/* What the store may and may not scan onto a handover slip. Real SQL is checked on a test server. */
describe('packing handover refusal', () => {
  test('unknown codes and opening-balance rows are refused', () => {
    expect(refusal(null)).toMatch(/Unknown label/);
    expect(refusal({ kind: 'OPENING' })).toMatch(/Unknown label/);
  });

  test('voided labels are refused with the void reason', () => {
    expect(refusal({ kind: 'CARTON', voided_at: new Date(), void_reason: 'torn' })).toBe('This label was voided (torn). Packing must relabel it.');
  });

  test('a label already received names the slip', () => {
    expect(refusal({ kind: 'CARTON', received_at: new Date() }, 'HO1-0004')).toBe('Already received on slip HO1-0004.');
  });

  test('a box inside a carton asks for the carton', () => {
    expect(refusal({ kind: 'BOX', carton_code: 'PK1-3-C002', boxes_per_carton: 4 })).toMatch(/carton PK1-3-C002\. Scan the carton/);
  });

  test('a box that should go in a carton but is not in one yet is refused', () => {
    expect(refusal({ kind: 'BOX', carton_code: null, boxes_per_carton: 4 })).toMatch(/close the carton first/);
  });

  test('cartons and loose boxes (no carton size) are accepted', () => {
    expect(refusal({ kind: 'CARTON' })).toBeNull();
    expect(refusal({ kind: 'BOX', carton_code: null, boxes_per_carton: 0 })).toBeNull();
    expect(refusal({ kind: 'BOX', carton_code: null, boxes_per_carton: null })).toBeNull();
  });

  test('a rejected carton can still be received', () => {
    expect(refusal({ kind: 'CARTON', rejected_at: new Date(), reject_reason: 'damaged' })).toBeNull();
  });
});

describe('packing handover slip numbers', () => {
  test('slip numbers carry the factory and a 4-digit sequence', () => {
    expect(slipNo(1, 7)).toBe('HO1-0007');
    expect(slipNo(2, 12345)).toBe('HO2-12345');
    expect(slipNo(null, 3)).toBe('HOM-0003');
  });

  test('the handover unit rule covers cartons and loose boxes only', () => {
    expect(UNIT_SQL).toMatch(/kind = 'CARTON'/);
    expect(UNIT_SQL).toMatch(/carton_code IS NULL/);
  });
});
