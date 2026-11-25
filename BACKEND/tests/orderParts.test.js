'use strict';

const { allocateParts, buildParts, pickRatio } = require('../src/modules/orderTracker/orderParts');

const mould = (mould_no, o = {}) => ({
  mould_no, mould_name: mould_no + ' NAME', ratio: 1, ratio_bom: 1, ratio_source: 'plan', produced: 0, reject: 0, today_qty: 0,
  machines: [], run_pph: 0, rate_all_pph: 0, plans: [], status: 'NOT_PLANNED', allowed_machines: [], ...o
});
const plan = (plan_id, plan_qty, status = 'RUNNING', produced = 0, colour_details = []) => ({ plan_id, plan_qty, status, produced, colour_details, machine: 'M-1' });
const item = (mould_no, item_code, item_name, qty) => ({ mould_no, item_code, item_name, qty });
const order = (moulds, o = {}) => ({
  order_qty: 100, jc_qty: 100, target_date: '2099-01-01', moulds,
  job_cards: [{ job_card_no: 'JC1', qty: 100, moulds: moulds.map(m => ({ mould_no: m.mould_no, produced: m.produced })) }], ...o
});

/* Body made by BODY 1 (BODY 2 free), Ring dropped on RING 2, Bush x5 */
const sample = () => order([
  mould('BODY 1', { produced: 60, machines: ['M-1'], run_pph: 10, plans: [plan('P1', 100, 'RUNNING', 60)], status: 'RUNNING' }),
  mould('BODY 2'),
  mould('RING', { produced: 0, plans: [plan('P2', 100, 'STOPPED')], status: 'PLANNED' }),
  mould('RING 2'),
  mould('BUSH', { ratio: 5, ratio_bom: 5, produced: 450, machines: ['M-2'], run_pph: 50, plans: [plan('P3', 500, 'RUNNING', 450)], status: 'RUNNING' })
]);
const items = [
  item('BODY 1', 'B-RED', 'Patla Body - Red', 50), item('BODY 1', 'B-BLUE', 'Patla Body - Blue', 50),
  item('BODY 2', 'B-RED', 'Patla Body - Red', 50), item('BODY 2', 'B-BLUE', 'Patla Body - Blue', 50),
  item('RING', 'R-W', 'Patla Ring - White', 100), item('RING 2', 'R-W', 'Patla Ring - White', 100),
  item('BUSH', 'U-W', 'Patla Bush - White', 500)
];
const drops = [{ mould_no: 'RING 2', item_code: 'RING 2', mould_name: 'RING 2 NAME', remarks: 'DROP', dropped_by: 'User', created_at: '2026-11-19' }];
const part = (v, name) => v.parts.find(p => p.name === name);

describe('order parts', () => {
  test('moulds that make the same ERP part are one part, needed once', () => {
    const v = buildParts(sample(), { items, drops });
    expect(v.parts.map(p => [p.name, p.required, p.moulds_total])).toEqual([['Body', 100, 2], ['Ring', 100, 2], ['Bush', 500, 1]]);
  });

  test('an unused mould is not pending: alternate or dropped', () => {
    const v = buildParts(sample(), { items, drops });
    expect(part(v, 'Body').moulds.map(m => [m.mould_no, m.role])).toEqual([['BODY 1', 'IN_USE'], ['BODY 2', 'ALTERNATE']]);
    expect(part(v, 'Ring').moulds.map(m => [m.mould_no, m.role])).toEqual([['RING', 'IN_USE'], ['RING 2', 'DROPPED']]);
  });

  test('complete products = the slowest part, with the reason', () => {
    const v = buildParts(sample(), { items, drops });
    expect(v.parts.map(p => p.sets)).toEqual([60, 0, 90]);
    expect(v.sets).toBe(0);
    expect(v.next_sets).toBe(60);
    expect(v.limit).toEqual({ name: 'Ring', sets: 0, status: 'STOPPED' });
    expect(v.expected_end).toBeNull();
    expect(v.verdict.code).toBe('RISK');
    expect(v.alerts[0].text).toMatch(/Ring is holding the order \(stopped\)/);
  });

  test('two moulds used together add up, plan and production', () => {
    const o = sample();
    o.moulds[1] = mould('BODY 2', { produced: 30, machines: ['M-9'], run_pph: 10, plans: [plan('P9', 40, 'RUNNING', 30)], status: 'RUNNING' });
    o.moulds[0].plans = [plan('P1', 60, 'RUNNING', 60)];
    const b = part(buildParts(o, { items, drops }), 'Body');
    expect([b.planned, b.produced, b.balance, b.sets, b.moulds_used, b.hours_left]).toEqual([100, 90, 10, 90, 2, 0.5]);
    expect(b.moulds.map(m => m.share_pct)).toEqual([66.7, 33.3]);
  });

  test('a part with every mould dropped does not block the count', () => {
    const o = sample();
    o.moulds[2] = mould('RING');
    const v = buildParts(o, { items, drops: [...drops, { mould_no: 'RING' }] });
    expect(part(v, 'Ring').status).toBe('DROPPED');
    expect(v.sets).toBe(60);
  });

  test('colour need comes from one mould only, production from all', () => {
    const v = buildParts(sample(), { items, drops, colours: [{ mould_no: 'BODY 1', colour: 'red', good: '40', reject: '1' }, { mould_no: 'BODY 2', colour: 'Red', good: '5', reject: '0' }] });
    expect(part(v, 'Body').colours).toEqual([
      { colour: 'Blue', required: 50, produced: 0, reject: 0, balance: 50 },
      { colour: 'Red', required: 50, produced: 45, reject: 1, balance: 5 }
    ]);
  });
});

describe('pieces per product when the plan and ERP disagree', () => {
  const pick = (own, erp, planQty, o = {}) => pickRatio({ mould_no: 'X', ratio: own, ratio_bom: erp, ratio_source: 'plan' },
    planQty ? [plan('P', planQty, 'RUNNING', 0, o.colours || [])] : [], o.items || [], { jrQty: o.jr || 100, jcQty: o.jc || 100 }).ratio;

  test('3 Pc Set: planned 3 per set, master ratio 1', () => expect(pick(1, 3, 300)).toBe(3));
  test('ERP asks double, planned at the master ratio', () => expect(pick(5, 10, 500)).toBe(5));
  test('only the first job card is planned', () => expect(pick(5, 10, 250, { jc: 50 })).toBe(5));
  test('ERP repeats the part, planned in between', () => expect(pick(1, 6, 300)).toBe(3));
  test('nothing planned: ERP', () => expect(pick(1, 3, 0)).toBe(3));
  test('only one of three colours planned: ERP', () => expect(pick(1, 3, 100, {
    colours: [{ itemCode: 'A', planQty: 100 }],
    items: [item('X', 'A', 'Lid - Red', 100), item('X', 'B', 'Lid - Blue', 100), item('X', 'C', 'Lid - Green', 100)]
  })).toBe(3));
});

describe('order tracker need per mould', () => {
  const m = (k, o = {}) => ({ key: k, mould_no: k, mould_name: k + ' NAME', ratio: 1, ratio_bom: 1, ratio_source: 'plan', produced: 0, plans: [], ...o });
  const its = [item('A', 'P', 'Lid - Red', 100), item('B', 'P', 'Lid - Red', 100)];
  const run = (list, o = {}) => allocateParts(list, its, { jrQty: 100, jcQty: 100, ...o });

  test('the spare mould is not needed', () => {
    const r = run([m('A', { produced: 40, plans: [plan('1', 100, 'RUNNING', 40)] }), m('B')]);
    expect([...r.alloc.keys()]).toEqual(['A']);
    expect(r.alloc.get('A').required).toBe(100);
    expect(r.spare).toEqual([{ mould_no: 'B', mould_name: 'B NAME', role: 'ALTERNATE', used_instead: ['A'] }]);
  });
  test('two moulds in use share the need by open plan balance', () => {
    const r = run([m('A', { produced: 40, plans: [plan('1', 60, 'RUNNING', 40)] }), m('B', { plans: [plan('2', 40, 'PLANNED')] })]);
    expect(['A', 'B'].map(k => r.alloc.get(k).required)).toEqual([60, 40]);
  });
  test('done between them: both complete', () => {
    const r = run([m('A', { produced: 70, plans: [plan('1', 70, 'COMPLETED', 70)] }), m('B', { produced: 50, plans: [plan('2', 50, 'COMPLETED', 50)] })]);
    expect(r.alloc.get('A').required).toBeLessThanOrEqual(70);
    expect(r.alloc.get('B').required).toBeLessThanOrEqual(50);
  });
  test('all dropped: the part is not counted; nothing planned: one mould is', () => {
    expect(run([m('A'), m('B')], { drops: [{ mould_no: 'A' }, { mould_no: 'B' }] }).alloc.size).toBe(0);
    expect([...run([m('A'), m('B')], { drops: [{ mould_no: 'A' }] }).alloc.keys()]).toEqual(['B']);
  });
});
