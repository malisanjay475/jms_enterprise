'use strict';

const A = require('../PUBLIC/assets/dpr-job-analysis');

const log = (date, shift, hour_slot, good_qty, reject_qty, downtime_min, x) => ({ date, shift, hour_slot, good_qty, reject_qty, downtime_min, machine: 'M1', ...x });
const info = { std_cycle: 45, std_cavity: 1, act_cycle: 33.48, act_cavity: 1, std_weight: 0.49, act_weight: 0.502 };

describe('DPR job popup analysis', () => {
  test('timeline: dates in order with days between, first production from the first hour', () => {
    const hours = A.hourly([log('2026-11-22', 'Day', '07-08', 50, 0, 0), log('2026-11-24', 'Night', '01-02', 50, 0, 0)]);
    const lifecycle = { or_date: '2026-11-18', jc_date: '2026-11-18', plan_created: '2026-11-20T10:15:00' };
    const finishTs = new Date('2026-11-27T03:42:00').getTime();
    const tl = A.timeline({ lifecycle, hours, finishTs, done: false });
    expect(tl.steps.map(s => s.key)).toEqual(['or', 'jc', 'plan', 'start', 'last', 'finish']);
    expect(tl.steps.map(s => s.gap)).toEqual([null, 0, 2, 2, 3, 2]);
    expect(tl.steps[3].at.getHours()).toBe(7); // slot 07-08 starts at 07:00
    expect(tl.steps[4].at.getDate()).toBe(25); // Night 01-02 of the 24th ends on the 25th
    expect(tl.orderToStart).toBe(4);
    expect(tl.leadDays).toBe(9);
    expect(tl.runHours).toBe(67);
  });

  test('timeline: a finished job ends at its last production, missing dates stay empty', () => {
    const hours = A.hourly([log('2026-11-22', 'Day', '07-08', 50, 0, 0)]);
    const tl = A.timeline({ lifecycle: { or_date: '2026-11-20' }, hours, done: true });
    expect(tl.steps.map(s => s.key)).toEqual(['or', 'jc', 'plan', 'start', 'last']);
    expect(tl.steps[4].label).toBe('Finished');
    expect(tl.steps[1].at).toBeNull();
    expect(tl.steps[3].gap).toBe(2); // counted from the last known date (the order)
    expect(tl.leadDays).toBe(2);
    expect(A.timeline({ lifecycle: {}, hours: [] }).orderToStart).toBeNull();
  });

  test('night slots after midnight fall on the next day, in order', () => {
    const h = A.hourly([log('2026-11-24', 'Night', '01-02', 1, 0, 0), log('2026-11-24', 'Night', '11-12', 1, 0, 0), log('2026-11-24', 'Day', '06-07', 1, 0, 0)]);
    expect(h.map(x => x.slot)).toEqual(['06-07', '11-12', '01-02']);
    expect(new Date(h[2].ts).getDate()).toBe(25);
    expect(new Date(A.slotEnd('2026-11-24', 'Night', '11-12')).getHours()).toBe(0);
  });

  test('two colours in one hour are one hour, and downtime never passes 60 min', () => {
    const h = A.hourly([log('2026-11-24', 'Day', '07-08', 10, 1, 40, { colour: 'A' }), log('2026-11-24', 'Day', '07-08', 20, 2, 40, { colour: 'B' })]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ good: 30, rej: 3, dt: 60 });
  });

  test('time parts add up to the logged hours, slower and faster than STD', () => {
    for (const good of [40, 80, 120]) {
      const p = A.timeUse(A.hourly([log('2026-11-24', 'Day', '07-08', good, 10, 0), log('2026-11-24', 'Day', '08-09', 10, 5, 30)]), 80).parts;
      expect(p.good + p.reject + p.slow + p.down).toBeCloseTo(2);
    }
  });

  test('OEE = availability x speed x quality', () => {
    const u = A.timeUse(A.hourly([log('2026-11-24', 'Day', '07-08', 60, 10, 0), log('2026-11-24', 'Day', '08-09', 20, 5, 30)]), A.targetPerHour(info));
    expect(u.availability * u.speed * u.quality).toBeCloseTo(u.oee);
  });

  test('finish estimate counts stopped hours in the pace', () => {
    const now = A.slotEnd('2026-11-24', 'Day', '10-11');
    const h = A.hourly([log('2026-11-24', 'Day', '07-08', 80, 0, 0), log('2026-11-24', 'Day', '08-09', 0, 0, 60), log('2026-11-24', 'Day', '09-10', 0, 0, 60), log('2026-11-24', 'Day', '10-11', 80, 0, 0)]);
    const f = A.forecast(h, 400, 80, now);
    expect(f.pace).toBe(40);
    expect(f.hoursLeft).toBe(10);
    expect(f.bestHours).toBe(5);
    expect(A.forecast(h, 0, 80, now)).toBeNull();
  });

  test('extra of one colour does not hide what is left of another', () => {
    const c = { Red: { plan_qty: 100, good_qty: 130 }, Blue: { plan_qty: 100, good_qty: 60 } };
    expect(A.balance(c, 200, 190)).toEqual({ left: 40, extra: 30 });
    // not a full colour split: counted as a whole
    expect(A.balance(c, 300, 190)).toEqual({ left: 110, extra: 0 });
    expect(A.balance({ Red: { plan_qty: 200, good_qty: 0 }, Other: { plan_qty: 0, good_qty: 190 } }, 200, 190)).toEqual({ left: 10, extra: 0 });
  });

  test('findings name the top reject reason and the extra material', () => {
    const hours = A.hourly(A.SLOTS.map(s => log('2026-11-24', 'Day', s, 60, 10, 0)));
    const list = A.findings({ info, hours, target: 80, use: A.timeUse(hours, 80), rejStats: { Scratches: 100, Warpage: 20 }, dtStats: {} });
    expect(list[0]).toMatchObject({ level: 'bad', title: 'Reject is 14.3%' });
    expect(list[0].text).toContain('Scratches, 83%');
    expect(list.some(f => f.title === 'Part is 2.4% heavier than STD' && f.text.includes('10 kg'))).toBe(true);
  });

  test('a weight saved in grams does not create a false finding', () => {
    const hours = A.hourly([log('2026-11-24', 'Day', '07-08', 80, 0, 0)]);
    const list = A.findings({ info: { std_weight: 0.49, act_weight: 502 }, hours, target: 0, use: A.timeUse(hours, 0) });
    expect(list).toEqual([]);
  });

  test('no data gives no findings', () => {
    const u = A.timeUse([], 0);
    expect(u.oee).toBeNull();
    expect(A.findings({ info: {}, hours: [], use: u, target: 0 })).toEqual([]);
  });
});
