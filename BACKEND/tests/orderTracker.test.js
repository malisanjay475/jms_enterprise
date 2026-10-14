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

  test('a mould whose plan closed short: no fake end date, verdict and advice', () => {
    const target = new Date(Date.now() + 6 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const o = buildOrder('JR/3883', {
      jcRows: [{ order_no: 'JR/3883', jr_qty: 10000, job_card_no: 'JC/3687', prod_plan_qty: 10000, planned_comp_date: target,
        mld_status: 'Completed', shift_status: 'Pending', prt_tuf_status: '', pack_status: '', wh_status: '' }],
      bomRows: [{ mould_no: 'LID', mould_name: 'LID TWO CAVITY', item_qty: 30000, jr_qty: 10000 },
        { mould_no: 'BTM', mould_name: 'BTM 2', item_qty: 30000, jr_qty: 10000 }],
      planRows: [{ id: 1, plan_id: 'P-LID', mould_code: 'LID', machine: 'B -L3-AKAR-110-9', status: 'COMPLETED' },
        { id: 2, plan_id: 'P-BTM', mould_code: 'BTM', machine: 'B -L3-OM-150-7', status: 'COMPLETED' }],
      dprRows: [
        { plan_id: 'P-LID', mould_no: 'LID', jobcard_no: 'JC/3687', machine: 'B -L3-AKAR-110-9', dpr_date: '2026-10-01', good: 29951, reject: 0, run_hours: 104 },
        { plan_id: 'P-BTM', mould_no: 'BTM', jobcard_no: 'JC/3687', machine: 'B -L3-OM-150-7', dpr_date: '2026-10-09', good: 30567, reject: 0, run_hours: 270 }],
      mouldStd: new Map(),
      shiftByPlan: new Map([['1', { qty: 29000 }], ['2', { qty: 30000 }]]),
      board: [{ machine: 'B -L3-AKAR-110-9', tonnage: 110, state: 'IDLE', running: [], queue: [] },
        { machine: 'B -L3-OM-150-7', tonnage: 150, state: 'RUNNING', running: [], queue: [] }]
    });
    const lid = o.moulds.find(m => m.mould_no === 'LID');
    expect(lid.closed_short).toBe(true);
    expect(lid.balance).toBe(49);
    expect(lid.shifted).toBe(29000);
    expect(o.sets_made).toBe(9983);
    expect(o.expected_end).toBeNull();          /* nothing is running it */
    expect(o.earliest_end).not.toBeNull();      /* but it could still be done in time */
    expect(o.verdict.code).toBe('AT_RISK');
    const tip = o.suggestions[0];
    expect(tip.level).toBe('bad');
    expect(tip.title).toMatch(/49 pcs short/);
    expect(tip.text).toMatch(/17 sets/);
    expect(tip.text).toMatch(/AKAR-110-9/);    /* free now and ran this mould before */
    expect(o.process.current).toBe('moulding');
    expect(o.job_cards[0].process.stages.map(x => x.name)).toEqual(['Moulding', 'Shifting', 'Printing / TUF', 'Packing', 'Warehouse']);
  });

  test('ratio: plan board first, impossible BOM ratio flagged (JR/3903, x240)', () => {
    const target = new Date(Date.now() + 17 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const build = planRatio => buildOrder('JR/3903', {
      jcRows: [{ order_no: 'JR/3903', jr_qty: 100000, job_card_no: 'JC/1', prod_plan_qty: 100000, planned_comp_date: target }],
      bomRows: [{ mould_no: 'BODY', mould_name: 'FILO BASKET BODY', item_qty: 24000000, jr_qty: 100000 }],
      planRows: [{ id: 9, plan_id: 'P9', mould_code: 'BODY', machine: 'C -L3-OM-150-1', status: 'RUNNING', consumption_ratio_qty: planRatio }],
      dprRows: [{ plan_id: 'P9', mould_no: 'BODY', jobcard_no: 'JC/1', machine: 'C -L3-OM-150-1', dpr_date: '2026-10-13', good: 31659, reject: 0, run_hours: 200 }],
      mouldStd: new Map(), board: []
    });
    const withPlan = build(1);
    const body = withPlan.moulds[0];
    expect([body.ratio, body.ratio_source, body.ratio_bom]).toEqual([1, 'plan', 240]);
    expect(body.required).toBe(100000);
    expect(withPlan.sets_made).toBe(31659);
    expect(body.ratio_suspect).toBe(false);          /* x1 itself is fine */
    expect(body.ratio_mismatch).toBe(true);          /* the BOM disagrees with the plan */
    /* the late finish comes first; the BOM mismatch is a warning after it */
    expect(withPlan.suggestions[0].level).toBe('bad');
    expect(withPlan.suggestions.find(t => t.title === 'Check the data').level).toBe('warn');
    expect(withPlan.pace.need_sets_per_day).toBeGreaterThan(0);

    const bomOnly = build(null).moulds[0];
    expect([bomOnly.ratio, bomOnly.ratio_source, bomOnly.ratio_suspect]).toEqual([240, 'ERP BOM', true]);
    expect(withPlan.suggestions.some(t => /machines/.test(t.text))).toBe(true); /* real advice, not 'ratio looks wrong' */
  });
});
