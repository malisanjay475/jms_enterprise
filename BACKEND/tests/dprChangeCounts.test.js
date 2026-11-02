'use strict';

const { countChanges } = require('../src/modules/dpr/changeCounts');

const P = (shift, slot, mould, colour, job, extra = {}) =>
  ({ shift, hour_slot: slot, mould_key: mould, colour, job_key: job, good_qty: 10, ...extra });

describe('DPR change counts (MC / CC / JC)', () => {
  test('re-mounted mould counts every change: A > B > A = 2', () => {
    const r = countChanges([P('Day', '07-08', 'A', 'RED', '1'), P('Day', '08-09', 'B', 'RED', '2'), P('Day', '09-10', 'A', 'RED', '3')]);
    expect(r.byShift.Day).toEqual({ mc: 2, cc: 0, jc: 2 });
  });

  test('a multi-hour changeover event plus the new mould is ONE change', () => {
    const r = countChanges([
      P('Day', '07-08', 'A', 'RED', '1'),
      { shift: 'Day', hour_slot: '08-09', entry_type: 'MouldChange' },
      { shift: 'Day', hour_slot: '09-10', downtime_breakup: { 2: 60 } },
      P('Day', '10-11', 'B', 'RED', '2')
    ]);
    expect(r.byShift.Day).toEqual({ mc: 1, cc: 0, jc: 1 });
  });

  test('two separate changeover blocks count twice', () => {
    const r = countChanges([
      { shift: 'Day', hour_slot: '07-08', downtime_breakup: { 2: 30 } },
      P('Day', '08-09', 'A', 'RED', '1'),
      { shift: 'Day', hour_slot: '09-10', downtime_breakup: { 2: 30 } }
    ]);
    expect(r.byShift.Day.mc).toBe(2);
  });

  test('colour change inside the same hour is counted', () => {
    const r = countChanges([
      P('Day', '07-08', 'A', 'RED', '1', { created_at: '2026-01-01T01:00:00Z' }),
      P('Day', '07-08', 'A', 'BLUE', '1', { entry_type: 'ColourChange', created_at: '2026-01-01T02:00:00Z' })
    ]);
    expect(r.byShift.Day).toEqual({ mc: 0, cc: 1, jc: 0 });
  });

  test('a colour used again needs a fresh purge: Gray > Green > Gray = 2', () => {
    const r = countChanges([P('Day', '07-08', 'A', 'GRAY', '1'), P('Day', '08-09', 'A', 'GREEN', '1'), P('Day', '09-10', 'A', 'GRAY', '1')]);
    expect(r.byShift.Day.cc).toBe(2);
  });

  test('a change at the Day > Night boundary is counted in Night', () => {
    const r = countChanges([P('Day', '06-07', 'A', 'RED', '1'), P('Night', '07-08', 'B', 'RED', '2')]);
    expect(r.byShift.Night).toEqual({ mc: 1, cc: 0, jc: 1 });
    expect(r.byShift.Day).toBeUndefined();
  });

  test('seed from previous Night counts a change at the start of Day', () => {
    const r = countChanges([P('Day', '07-08', 'B', 'RED', '2')], { mould: 'A', colour: 'RED', job: '1' });
    expect(r.byShift.Day).toEqual({ mc: 1, cc: 0, jc: 1 });
  });

  test('prefixed hour slots (plan|08-09) are walked in shift order', () => {
    const r = countChanges([P('Day', 'p1|09-10', 'A', 'BLUE', '1'), P('Day', 'p1|07-08', 'A', 'RED', '1'), P('Day', 'p1|08-09', 'A', 'RED', '1')]);
    expect(r.byShift.Day.cc).toBe(1);
  });

  test('same mould, two job cards = 1 job change, 0 mould change', () => {
    const r = countChanges([P('Day', '07-08', 'A', 'RED', 'JC1'), P('Day', '08-09', 'A', 'RED', 'JC2')]);
    expect(r.byShift.Day).toEqual({ mc: 0, cc: 0, jc: 1 });
  });
});
