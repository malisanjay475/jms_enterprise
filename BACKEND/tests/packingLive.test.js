'use strict';

const live = require('../src/modules/packing/packingLive');

const at = (s) => Date.parse(s + '+05:30'); // IST wall clock
const plan = (o) => ({ id: 1, status: 'RUNNING', plan_qty: 2000, scanned_qty: 1440, rate_now: 312, std_pcs_hr: 300, start_local: '2026-11-19T09:00:00', ...o });
const row = { name: 'Assembly Station B1', persons: 4, is_station: true };

describe('packing live - shift clock', () => {
  test('IST day and minutes left to 17:00', () => {
    expect(live.istDay(at('2026-11-19T01:00:00')).day).toBe('2026-11-19');
    expect(live.minutesLeftToday(at('2026-11-19T13:42:00'))).toBe(198);
    expect(live.minutesLeftToday(at('2026-11-19T08:00:00'))).toBe(480);
    expect(live.minutesLeftToday(at('2026-11-19T17:30:00'))).toBe(0);
    expect(live.inShift(at('2026-11-19T09:00:00'))).toBe(true);
    expect(live.inShift(at('2026-11-19T17:00:00'))).toBe(false);
  });
});

describe('packing live - station status', () => {
  const now = at('2026-11-19T13:42:00');
  const scan = (min) => ({ good_today: 1440, wrong_today: 1, last_good_at: new Date(now - min * 60000).toISOString() });

  test('running station adds its speed until 17:00, capped at what is left', () => {
    const t = live.stationTile(row, [plan()], scan(1), null, now);
    expect(t.status).toBe('RUNNING');
    expect(t.remaining).toBe(560);
    expect(t.add_by_17).toBe(560); // 312/h for 198 min = 1029, capped at 560
    expect(t.efficiency).toBe(104);
    expect(t.persons).toBe(4);
  });

  test('more than 10 working minutes without a good scan is idle and adds nothing', () => {
    const t = live.stationTile(row, [plan({ rate_now: 0 })], scan(18), null, now);
    expect(t.status).toBe('IDLE');
    expect(t.idle_min).toBe(18);
    expect(t.add_by_17).toBe(0);
  });

  test('idle counts working minutes only (overnight does not count)', () => {
    const morning = at('2026-11-20T09:05:00');
    const t = live.stationTile(row, [plan({ rate_now: 0 })], { last_good_at: new Date(at('2026-11-19T16:58:00')).toISOString() }, null, morning);
    expect(t.idle_min).toBe(7);
    expect(t.status).toBe('RUNNING');
  });

  test('a just-started job with no scans uses the standard speed', () => {
    const t = live.stationTile(row, [plan({ scanned_qty: 0, rate_now: 0, start_local: '2026-11-19T13:40:00' })], null, null, now);
    expect(t.status).toBe('RUNNING');
    expect(t.rate_used).toBe(300);
    expect(t.add_by_17).toBe(990);
  });

  test('a lock wins over everything; planned-only and empty stations', () => {
    expect(live.stationTile(row, [plan()], scan(1), { locked_at: 'x' }, now).status).toBe('LOCKED');
    expect(live.stationTile(row, [plan({ status: 'PLANNED' })], null, null, now).status).toBe('NOT_STARTED');
    expect(live.stationTile(row, [plan({ status: 'DONE', scanned_qty: 2000 })], null, null, now).status).toBe('NO_PLAN');
    expect(live.stationTile(row, [], null, null, now).status).toBe('NO_PLAN');
  });

  test('a job still running after 17:00 is off shift', () => {
    const t = live.stationTile(row, [plan()], scan(40), null, at('2026-11-19T17:40:00'));
    expect(t.status).toBe('OFF_SHIFT');
    expect(t.add_by_17).toBe(0);
  });
});

describe('packing live - totals and alerts', () => {
  test('target, projection and shortfall', () => {
    const tiles = [
      { packed_today: 1440, remaining: 560, add_by_17: 560, status: 'RUNNING', is_station: true, wrong_today: 0 },
      { packed_today: 800, remaining: 1200, add_by_17: 0, status: 'IDLE', is_station: true, wrong_today: 2 },
      { packed_today: 0, remaining: 0, add_by_17: 0, status: 'NO_PLAN', is_station: false, wrong_today: 0 }
    ];
    expect(live.totalsOf(tiles)).toMatchObject({ packed_today: 2240, target: 4000, projected: 2800, short: 1200, running: 1, idle: 1, stations: 2, wrong_today: 2 });
  });

  test('alerts list locked first, then idle, handover and old stock', () => {
    const a = live.alertsOf(
      [{ name: 'C1', status: 'IDLE', idle_min: 18 }, { name: 'D1', status: 'LOCKED' }],
      { waiting_old: 12, not_handed_hours: 24, old_stock_units: 1, alert_days: 30 });
    expect(a.map(x => x.kind)).toEqual(['locked', 'idle', 'handover', 'old_stock']);
    expect(a[3].text).toContain('1 carton in the store');
  });
});
