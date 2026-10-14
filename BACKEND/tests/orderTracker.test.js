'use strict';

const { buildOrder } = require('../src/modules/orderTracker/registerOrderTrackerRoutes');

/* OR 001, qty 100, two job cards of 50; Lid x1, Handle x2, Bottom x1 per set. */
function sample(dprRows) {
  return buildOrder('001', {
    jcRows: [
      { order_no: '001', jr_qty: 100, job_card_no: 'JC1', prod_plan_qty: 50, planned_comp_date: '2099-01-01' },
      { order_no: '001', jr_qty: 100, job_card_no: 'JC2', prod_plan_qty: 50, planned_comp_date: '2099-01-01' }
    ],
    bomRows: [['LID', 100], ['HANDLE', 200], ['BTM', 100]].map(([m, q]) => ({
      mould_no: m, mould_name: m, item_qty: q, jr_qty: 100, cycle_time: 30, cavity: 1
    })),
    planRows: [
      { plan_id: 'P1', mould_code: 'LID', machine: 'M-1', status: 'COMPLETED' },
      { plan_id: 'P2', mould_code: 'HANDLE', machine: 'B -L1>M-2', status: 'RUNNING' },
      { plan_id: 'P3', mould_code: 'BTM', machine: 'M-3', status: 'RUNNING' }
    ],
    dprRows,
    mouldStd: new Map()
  });
}
const d = (plan, mould, jc, date, good) => ({ plan_id: plan, mould_no: mould, jobcard_no: jc, machine: 'x', dpr_date: date, good, reject: 0, run_hours: 5 });

describe('order tracker set maths', () => {
  test('ratio comes from the mould BOM', () => {
    const o = sample([]);
    expect(o.moulds.map(m => [m.mould_no, m.ratio, m.required])).toEqual([
      ['LID', 1, 100], ['HANDLE', 2, 200], ['BTM', 1, 100]
    ]);
    expect(o.status).toBe('RUNNING'); // on machines, nothing booked yet
    expect(o.sets_made).toBe(0);
  });

  test('sets per job card and per order follow the slowest mould', () => {
    const o = sample([
      d('P1', 'LID', 'JC1', '2026-10-10', 50), d('P1', 'LID', 'JC2', '2026-10-11', 50),
      d('P2', 'HANDLE', 'JC1', '2026-10-11', 100), d('P2', 'HANDLE', 'JC2', '2026-10-12', 2),
      d('P3', 'BTM', 'JC1', '2026-10-12', 50), d('P3', 'BTM', 'JC2', '2026-10-13', 1)
    ]);
    const [jc1, jc2] = o.job_cards;
    expect([jc1.sets_made, jc1.status]).toEqual([50, 'COMPLETE']);
    expect([jc2.sets_made, jc2.status]).toEqual([1, 'IN_PROGRESS']);
    expect(o.sets_made).toBe(51);
    expect(o.status).toBe('RUNNING');
    expect(o.running_machines).toEqual(['M-2', 'M-3']);
    const lid = o.moulds.find(m => m.mould_no === 'LID');
    expect([lid.status, lid.completed_on]).toEqual(['COMPLETE', '2026-10-11']);
    expect(o.expected_end).not.toBeNull();
    /* job cards fill first in, first out: JC1 is done when every mould has
       made JC1's pieces (Lid 10 Oct, Handle 11 Oct, Btm 12 Oct) */
    expect(jc1.completed_on).toBe('2026-10-12');
    expect(jc1.moulds.map(m => m.done_on)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(jc2.completed_on).toBeNull();
    expect(jc2.moulds.find(m => m.mould_no === 'LID').done_on).toBe('2026-10-11');
    expect(jc2.expected_end).not.toBeNull();
  });

  test('a mould with no machine leaves the end date unknown', () => {
    const o = buildOrder('002', {
      jcRows: [{ order_no: '002', jr_qty: 10, job_card_no: 'JC9', prod_plan_qty: 10 }],
      bomRows: [{ mould_no: 'CAP', mould_name: 'CAP', item_qty: 10, jr_qty: 10 }],
      planRows: [], dprRows: [], mouldStd: new Map()
    });
    expect(o.moulds[0].status).toBe('NOT_PLANNED');
    expect(o.expected_end).toBeNull();
    expect(o.eta_unknown_reason).toBeTruthy();
  });

  test('start plan: must-start date, start order and late starts', () => {
    const H = 3600000, now = Date.now();
    const target = new Date(now + 48 * H).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const build = startEtaH => buildOrder('003', {
      jcRows: [{ order_no: '003', jr_qty: 100, job_card_no: 'JC', prod_plan_qty: 100, planned_comp_date: target }],
      bomRows: [{ mould_no: 'LID', mould_name: 'LID', item_qty: 100, jr_qty: 100 },
        { mould_no: 'HANDLE', mould_name: 'HANDLE', item_qty: 200, jr_qty: 100 }],
      planRows: [{ plan_id: 'L', mould_code: 'LID', machine: 'M-1', status: 'RUNNING' },
        { plan_id: 'H', mould_code: 'HANDLE', machine: 'M-2', status: 'PLANNED' }],
      dprRows: [],
      /* 10 pcs/h standard: LID needs 10 h, HANDLE (ratio 2) needs 20 h */
      mouldStd: new Map([['LID', { pcs_per_hour: 10 }], ['HANDLE', { pcs_per_hour: 10 }]]),
      sched: new Map([['H', { machine: 'M-2', queue_pos: 2, start_eta: new Date(now + startEtaH * H).toISOString() }]])
    });

    const ok = build(5);
    const lid = ok.moulds.find(m => m.mould_no === 'LID');
    const handle = ok.moulds.find(m => m.mould_no === 'HANDLE');
    expect(lid.start_state).toBe('ON_TRACK');
    expect(handle.queue).toEqual({ machine: 'M-2', position: 2, plan_id: 'H' });
    expect(handle.start_state).toBe('ON_TIME');
    expect(handle.eta_basis).toBe('machine queue');
    /* HANDLE needs twice the hours, so it has to start before LID */
    expect(handle.start_seq).toBe(1);
    expect(lid.start_seq).toBe(2);
    expect(new Date(handle.must_start_by) < new Date(lid.must_start_by)).toBe(true);
    expect(ok.next_start.mould_no).toBe('HANDLE');

    const late = build(60).moulds.find(m => m.mould_no === 'HANDLE');
    expect(late.start_state).toBe('START_LATE');
    expect(late.slack_hours).toBeLessThan(0);
  });
});
