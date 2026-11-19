'use strict';

const { refusal, slipNo, UNIT_SQL } = require('../src/modules/packing/registerPackingHandoverRoutes');

describe('store handover rules', () => {
  test('slip numbers carry the factory and a 4-digit sequence', () => {
    expect(slipNo(1, 7)).toBe('HO1-0007');
    expect(slipNo(null, 12345)).toBe('HOM-12345');
  });

  test('a fresh carton can be received', () => {
    expect(refusal({ kind: 'CARTON', boxes_per_carton: 4 })).toBeNull();
  });

  test('a loose box can be received when the item has no carton size', () => {
    expect(refusal({ kind: 'BOX', carton_code: null, boxes_per_carton: 0 })).toBeNull();
  });

  test('refuses unknown, opening, voided and already received labels', () => {
    expect(refusal(null)).toMatch(/Unknown label/);
    expect(refusal({ kind: 'OPENING' })).toMatch(/Unknown label/);
    expect(refusal({ kind: 'CARTON', voided_at: new Date(), void_reason: 'torn' })).toMatch(/voided \(torn\)/);
    expect(refusal({ kind: 'CARTON', received_at: new Date() }, 'HO1-0003')).toBe('Already received on slip HO1-0003.');
  });

  test('a box inside a carton, or waiting for one, must not be received alone', () => {
    expect(refusal({ kind: 'BOX', carton_code: 'PK1-3-C001', boxes_per_carton: 4 })).toMatch(/Scan the carton/);
    expect(refusal({ kind: 'BOX', carton_code: null, boxes_per_carton: 4 })).toMatch(/close the carton first/);
  });

  test('a rejected carton can be received again', () => {
    expect(refusal({ kind: 'CARTON', rejected_at: new Date(), reject_reason: 'damaged' })).toBeNull();
  });

  test('the unit filter counts cartons and loose boxes only', () => {
    expect(UNIT_SQL).toMatch(/kind\s*=\s*'CARTON'/);
    expect(UNIT_SQL).toMatch(/boxes_per_carton,\s*0\)\s*=\s*0/);
  });
});
