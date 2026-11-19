'use strict';

const { dispatchRefusal, dispatchSlipNo, STOCK_SQL, DEFAULT_ALERT_DAYS } = require('../src/modules/packing/registerPackingDispatchRoutes');

const received = { kind: 'CARTON', client_name: 'Reliance Retail', received_at: new Date() };

/* What may go out on a dispatch slip. Real SQL is checked on a test server. */
describe('packing dispatch refusal', () => {
  test('a received carton for the slip party can go out (party match ignores case and spaces)', () => {
    expect(dispatchRefusal(received, 'Reliance Retail')).toBeNull();
    expect(dispatchRefusal(received, '  reliance   retail ')).toBeNull();
  });

  test('a received loose box can go out', () => {
    expect(dispatchRefusal({ ...received, kind: 'BOX', carton_code: null, boxes_per_carton: 0 }, 'Reliance Retail')).toBeNull();
  });

  test('unknown and opening rows are refused', () => {
    expect(dispatchRefusal(null, 'X')).toMatch(/Unknown label/);
    expect(dispatchRefusal({ kind: 'OPENING' }, 'X')).toMatch(/Unknown label/);
  });

  test('voided, box-in-carton and already dispatched are refused', () => {
    expect(dispatchRefusal({ ...received, voided_at: new Date(), void_reason: 'torn' }, 'Reliance Retail')).toMatch(/voided \(torn\)/);
    expect(dispatchRefusal({ ...received, kind: 'BOX', carton_code: 'PK1-3-C001' }, 'Reliance Retail')).toMatch(/Scan the carton/);
    expect(dispatchRefusal({ ...received, dispatched_at: new Date() }, 'Reliance Retail', 'DS1-0002')).toBe('Already dispatched on slip DS1-0002.');
  });

  test('a carton the store has not received is refused', () => {
    expect(dispatchRefusal({ kind: 'CARTON', client_name: 'Reliance Retail' }, 'Reliance Retail')).toMatch(/not received/);
  });

  test('a carton for another party is blocked with both names', () => {
    expect(dispatchRefusal({ ...received, client_name: 'ABRL Pvt. Label' }, 'Reliance Retail'))
      .toBe('This carton is for ABRL Pvt. Label, not Reliance Retail.');
  });

  test('a supervisor override lets only the party rule go', () => {
    expect(dispatchRefusal({ ...received, client_name: 'ABRL Pvt. Label' }, 'Reliance Retail', null, true)).toBeNull();
    expect(dispatchRefusal({ kind: 'CARTON', client_name: 'ABRL Pvt. Label' }, 'Reliance Retail', null, true)).toMatch(/not received/);
    expect(dispatchRefusal(null, 'Reliance Retail', null, true)).toMatch(/Unknown label/);
  });
});

describe('packing dispatch numbers and stock rule', () => {
  test('slip numbers carry the factory and a 4-digit sequence', () => {
    expect(dispatchSlipNo(1, 42)).toBe('DS1-0042');
    expect(dispatchSlipNo(null, 3)).toBe('DSM-0003');
  });

  test('stock = received, not dispatched, not voided; default age flag 30 days', () => {
    expect(STOCK_SQL).toMatch(/received_at IS NOT NULL/);
    expect(STOCK_SQL).toMatch(/dispatched_at IS NULL/);
    expect(STOCK_SQL).toMatch(/voided_at IS NULL/);
    expect(DEFAULT_ALERT_DAYS).toBe(30);
  });
});
