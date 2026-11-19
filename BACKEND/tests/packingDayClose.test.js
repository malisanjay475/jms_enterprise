'use strict';

const dc = require('../src/modules/packing/packingDayClose');

const at = (s) => Date.parse(s + '+05:30'); // IST wall clock
const DAY = '2026-11-19';
const b = dc.dayBounds(DAY);
const plan = (o) => ({ id: 1, job_card_no: 'JC1', item_name: 'Cap 28mm', tables: 'A1,A2', plan_qty: 800,
  start_local: `${DAY}T09:00:00`, end_local: `${DAY}T17:00:00`, left: 0, last_ms: null, ...o });
const every = (from, to, stepMin) => { const out = []; for (let t = at(from); t < at(to); t += stepMin * 60000) out.push(t); return out; };
const AFTER = at(`${DAY}T20:00:00`);

describe('day close - day and plan qty', () => {
  test('day bounds are the IST shift', () => {
    expect(b.startMs).toBe(at(`${DAY}T09:00:00`));
    expect(b.endMs).toBe(at(`${DAY}T17:00:00`));
    expect(dc.dayBounds('19-11-2026')).toBeNull();
    expect(dc.istToday(at('2026-11-19T23:30:00'))).toBe('2026-11-19');
    expect(dc.istToday(at('2026-11-20T00:10:00'))).toBe('2026-11-20');
  });

  test('a plan inside the day keeps its whole qty', () => {
    expect(dc.planDayQty(plan(), b)).toBe(800);
  });

  test('a plan rolling over 17:00 is split by working minutes', () => {
    /* 13:00-17:00 today (240 min) + 09:00-13:00 tomorrow (240 min) */
    const p = plan({ plan_qty: 1000, start_local: `${DAY}T13:00:00`, end_local: '2026-11-20T13:00:00' });
    expect(dc.planDayQty(p, b)).toBe(500);
    expect(dc.planDayQty(p, dc.dayBounds('2026-11-20'))).toBe(500);
  });

  test('a plan of another day gives nothing', () => {
    expect(dc.planDayQty(plan({ start_local: '2026-11-18T09:00:00', end_local: '2026-11-18T12:00:00' }), b)).toBe(0);
  });
});

describe('day close - stoppages', () => {
  test('steady scanning has no stoppage', () => {
    expect(dc.stoppagesOf(every(`${DAY}T09:00:00`, `${DAY}T17:00:00`, 2), [plan()], b, AFTER)).toEqual([]);
  });

  test('a 25 minute gap between scans is one stoppage with the plan tables', () => {
    const scans = [...every(`${DAY}T09:00:00`, `${DAY}T11:00:00`, 2), ...every(`${DAY}T11:25:00`, `${DAY}T17:00:00`, 2)];
    const g = dc.stoppagesOf(scans, [plan()], b, AFTER);
    expect(g).toHaveLength(1);
    expect(g[0].minutes).toBe(27); // last scan 10:58 -> next 11:25
    expect(g[0].tables).toEqual(['A1', 'A2']);
    expect(dc.hhmm(g[0].from_ms)).toBe('10:58');
  });

  test('a 10 minute gap is not a stoppage (more than 10 is)', () => {
    const scans = [at(`${DAY}T09:00:00`), at(`${DAY}T09:10:00`), at(`${DAY}T09:21:00`), ...every(`${DAY}T09:22:00`, `${DAY}T17:00:00`, 1)];
    const g = dc.stoppagesOf(scans, [plan()], b, AFTER);
    expect(g.map(x => x.minutes)).toEqual([11]);
  });

  test('a late start counts from when the plan was due', () => {
    const scans = every(`${DAY}T10:00:00`, `${DAY}T17:00:00`, 2);
    const g = dc.stoppagesOf(scans, [plan({ start_local: `${DAY}T09:30:00` })], b, AFTER);
    expect(g).toHaveLength(1);
    expect(dc.hhmm(g[0].from_ms)).toBe('09:30');
    expect(g[0].minutes).toBe(30);
  });

  test('stopping early with work left runs to 17:00; finishing early does not', () => {
    const scans = every(`${DAY}T09:00:00`, `${DAY}T16:00:00`, 2);
    const left = dc.stoppagesOf(scans, [plan({ left: 200 })], b, AFTER);
    expect(left).toHaveLength(1);
    expect(dc.hhmm(left[left.length - 1].to_ms)).toBe('17:00');
    const done = dc.stoppagesOf(scans, [plan({ left: 0, last_ms: scans[scans.length - 1] })], b, AFTER);
    expect(done).toEqual([]);
  });

  test('a planned gap between two jobs is not a stoppage', () => {
    const p1 = plan({ id: 1, end_local: `${DAY}T11:00:00`, tables: 'A1', last_ms: at(`${DAY}T10:58:00`) });
    const p2 = plan({ id: 2, start_local: `${DAY}T13:00:00`, tables: 'B1' });
    const scans = [...every(`${DAY}T09:00:00`, `${DAY}T11:00:00`, 2), ...every(`${DAY}T13:00:00`, `${DAY}T17:00:00`, 2)];
    expect(dc.stoppagesOf(scans, [p1, p2], b, AFTER)).toEqual([]);
  });

  test('no scan at all with work left is one stoppage of the whole window', () => {
    const g = dc.stoppagesOf([], [plan({ left: 800, start_local: `${DAY}T13:00:00` })], b, AFTER);
    expect(g).toHaveLength(1);
    expect(g[0].minutes).toBe(240);
  });

  test('closing before 17:00 counts only up to now', () => {
    const scans = every(`${DAY}T09:00:00`, `${DAY}T12:00:00`, 2);
    const g = dc.stoppagesOf(scans, [plan({ left: 500 })], b, at(`${DAY}T12:30:00`));
    expect(g).toHaveLength(1);
    expect(dc.hhmm(g[0].to_ms)).toBe('12:30');
  });

  test('lunch-time scans outside the shift do not matter; evening OT is ignored', () => {
    const scans = [...every(`${DAY}T09:00:00`, `${DAY}T17:00:00`, 2), at(`${DAY}T18:30:00`)];
    expect(dc.stoppagesOf(scans, [plan()], b, AFTER)).toEqual([]);
  });
});

describe('day close - draft and reasons', () => {
  const reasons = dc.DEFAULT_REASONS;
  const scans = [...every(`${DAY}T09:00:00`, `${DAY}T11:00:00`, 1), ...every(`${DAY}T11:30:00`, `${DAY}T17:00:00`, 1)];
  const draft = dc.buildDraft([plan({ left: 100 })], new Map([[1, 700]]), scans, b, AFTER);

  test('draft has plan vs packed and the stoppage', () => {
    expect(draft.lines).toEqual([expect.objectContaining({ plan_id: 1, plan_qty: 800, packed: 700, short: 100 })]);
    expect(draft.stoppages).toHaveLength(1);
    expect(draft.totals).toEqual({ plan_qty: 800, packed: 700, short: 100, lost_min: 31 });
  });

  test('every short plan and every stoppage needs a reason', () => {
    const none = dc.applyReasons(draft, {}, reasons);
    expect(none.missing).toHaveLength(2);
    const some = dc.applyReasons(draft, { lines: [{ plan_id: 1, reason: 'Short crew' }] }, reasons);
    expect(some.missing).toEqual([expect.stringContaining('stoppage 10:59-11:30')]);
  });

  test('"Other" needs a note; unknown reasons are refused', () => {
    const key = draft.stoppages[0].key;
    const other = dc.applyReasons(draft, { lines: [{ plan_id: 1, reason: 'other' }], stoppages: [{ key, reason: 'Made up' }] }, reasons);
    expect(other.missing).toHaveLength(2);
    expect(other.missing[0]).toContain('add a note');
    const ok = dc.applyReasons(draft, { lines: [{ plan_id: 1, reason: 'Other', note: 'Box size changed' }], stoppages: [{ key, reason: 'scanner / power' }] }, reasons);
    expect(ok.missing).toEqual([]);
    expect(ok.lines[0]).toEqual(expect.objectContaining({ reason: 'Other', note: 'Box size changed' }));
    expect(ok.stoppages[0].reason).toBe('Scanner / power');
  });

  test('a plan on target needs no reason', () => {
    const d = dc.buildDraft([plan()], new Map([[1, 820]]), every(`${DAY}T09:00:00`, `${DAY}T17:00:00`, 1), b, AFTER);
    expect(d.lines[0].short).toBe(0);
    expect(dc.applyReasons(d, {}, reasons).missing).toEqual([]);
  });
});

describe('day close - overtime plans', () => {
  test('a plan wholly after 17:00 is not in the day plan, but its packing counts', () => {
    const ot = plan({ id: 9, start_local: `${DAY}T18:00:00`, end_local: `${DAY}T21:00:00` });
    expect(dc.planDayQty(ot, b)).toBe(0);
    const d = dc.buildDraft([ot], new Map([[9, 120]]), [], b, AFTER);
    expect(d.lines).toEqual([expect.objectContaining({ plan_qty: 0, packed: 120, short: 0 })]);
    expect(dc.buildDraft([ot], new Map(), [], b, AFTER).lines).toEqual([]);
  });
});
