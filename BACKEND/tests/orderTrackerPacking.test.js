'use strict';

const { applyPacking, shiftMinutesBetween, fullyDone } = require('../src/modules/orderTracker/packingProgress');

const IST = (s) => new Date(s + '+05:30').getTime();

function order(extra = {}) {
  return {
    order_no: 'JR/1', order_qty: 1000, sets_made: 1000, status: 'COMPLETE', target_date: '2026-11-25',
    last_date: '2026-11-18', job_cards: [{ job_card_no: 'JC/1' }],
    verdict: { code: 'DONE', text: 'All sets made' }, ...extra
  };
}

function rows({ packed = 0, units = [], since = '2026-11-01T00:00:00+05:30', stockDays = 30 } = {}) {
  return {
    plans: packed ? [{ id: 5, jc: 'JC/1', table_id: 'Assembly Station B1', plan_qty: 1000, packed, status: 'RUNNING', start_local: '2026-11-18T09:00:00' }] : [],
    lastScan: new Map(packed ? [[5, { first: '2026-11-18T04:00:00Z', last: '2026-11-18T10:00:00Z' }]] : []),
    units, since, stockDays
  };
}

const carton = (o) => ({ jc: 'JC/1', kind: 'CARTON', qty: 100, created_at: '2026-11-18T06:00:00Z', ...o });

describe('order tracker: packing to dispatch', () => {
  test('shift minutes count 09:00-17:00 IST only', () => {
    expect(shiftMinutesBetween(IST('2026-11-19T15:00:00'), IST('2026-11-20T13:00:00'))).toBe(360);
    expect(shiftMinutesBetween(IST('2026-11-19T18:00:00'), IST('2026-11-20T08:00:00'))).toBe(0);
  });

  test('an order with no packing data keeps the moulding verdict and drops off the open list when moulded', () => {
    const o = applyPacking(order(), rows(), IST('2026-11-19T12:00:00'));
    expect(o.packing.tracked).toBe(false);
    expect(o.verdict.code).toBe('DONE');
    expect(fullyDone(o)).toBe(true);
  });

  test('moulded but not dispatched stays open with a dispatch verdict', () => {
    const units = [carton({ received_at: '2026-11-18T08:00:00Z' }), carton({ received_at: '2026-11-18T08:00:00Z', dispatched_at: '2026-11-19T05:00:00Z', ds_status: 'CLOSED', ds_slip: 'DS1-0001', ds_closed: '2026-11-19T05:00:00Z' })];
    const o = applyPacking(order(), rows({ packed: 1000, units }), IST('2026-11-19T12:00:00'));
    expect(o.packing.dispatched).toBe(100);
    expect(o.packing.in_store).toBe(100);
    expect(o.packing.reached).toBe(200);
    expect(o.verdict.code).toBe('DISPATCH');
    expect(fullyDone(o)).toBe(false);
    expect(o.packing.job_cards[0].dispatches[0]).toMatchObject({ slip_no: 'DS1-0001', units: 1, pcs: 100 });
  });

  test('past target and not dispatched is late', () => {
    const o = applyPacking(order({ target_date: '2026-11-10' }), rows({ packed: 500, units: [carton({})] }), IST('2026-11-19T12:00:00'));
    expect(o.verdict.code).toBe('LATE');
  });

  test('dispatched >= order qty completes the order; an open slip does not count', () => {
    const closed = { received_at: '2026-11-18T08:00:00Z', dispatched_at: '2026-11-19T05:00:00Z', ds_status: 'CLOSED', ds_closed: '2026-11-19T05:00:00Z', ds_slip: 'DS1-1' };
    const units = Array.from({ length: 10 }, () => carton(closed));
    const done = applyPacking(order(), rows({ packed: 1000, units }), IST('2026-11-19T12:00:00'));
    expect(done.verdict).toMatchObject({ code: 'DONE', text: 'Dispatched' });
    expect(fullyDone(done)).toBe(true);
    const open = applyPacking(order(), rows({ packed: 1000, units: units.map(u => ({ ...u, ds_status: 'OPEN' })) }), IST('2026-11-19T12:00:00'));
    expect(open.packing.dispatched).toBe(0);
    expect(open.packing.loading).toBe(1000);
    expect(open.verdict.code).toBe('DISPATCH');
  });

  test('boxes inside cartons count as labelled pieces, not as extra units', () => {
    const units = [carton({}), { jc: 'JC/1', kind: 'BOX', qty: 50, carton_code: 'PK1-5-C001', boxes_per_carton: 2, created_at: '2026-11-18T06:00:00Z' },
      { jc: 'JC/1', kind: 'BOX', qty: 50, carton_code: 'PK1-5-C001', boxes_per_carton: 2, created_at: '2026-11-18T06:00:00Z' }];
    const o = applyPacking(order(), rows({ packed: 100, units }), IST('2026-11-18T13:00:00'));
    expect(o.packing.labelled).toBe(100);
    expect(o.packing.job_cards[0].not_handed_units).toBe(0);
  });

  test('gap flags: not handed to store after 24 h, old stock, moulded not packed for 2 shift days', () => {
    const units = [carton({ created_at: '2026-11-15T06:00:00Z' }), carton({ received_at: '2026-10-01T06:00:00Z', created_at: '2026-10-01T05:00:00Z' })];
    // last packing scan 18-Nov 15:30, so by 23-Nov noon packing has been idle 4.6 shift days
    const o = applyPacking(order({ last_date: '2026-11-14' }), rows({ packed: 200, units }), IST('2026-11-23T12:00:00'));
    const keys = o.packing.gaps.map(g => g.key).sort();
    expect(keys).toEqual(['not_handed', 'not_packed', 'old_stock']);
  });

  test('moulding from before packing went live does not flag "not packed"', () => {
    const o = applyPacking(order({ last_date: '2026-09-01' }), rows({ packed: 10, units: [] }), IST('2026-11-19T12:00:00'));
    expect(o.packing.gaps.map(g => g.key)).not.toContain('not_packed');
  });
});
