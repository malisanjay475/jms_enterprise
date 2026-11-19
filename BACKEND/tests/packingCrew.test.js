'use strict';

const crew = require('../src/modules/packing/packingCrew');
const { readWorkerSheet } = require('../src/modules/packing/registerPackingCrewRoutes');
const live = require('../src/modules/packing/packingLive');

const at = (s) => Date.parse(s + '+05:30'); // IST wall clock
const W = (id, name, station, from, to) => ({ worker_id: id, worker_name: name, station, start_ms: at(from), end_ms: to ? at(to) : null });
const hour = (station, h, n, cycle = 12, persons = 4) => ({ station, hour_ms: at(`2026-11-19T${h}:00:00`), n, cycle, persons });
const NOW = at('2026-11-19T18:00:00');

describe('packing crew - sharing a station\'s pieces', () => {
  test('pieces in an hour are split equally among the packers there all hour', () => {
    const { rows } = crew.shareOutput(
      [W(1, 'Ramesh', 'B1', '2026-11-19T09:00:00', '2026-11-19T11:00:00'), W(2, 'Sunita', 'B1', '2026-11-19T09:00:00', '2026-11-19T11:00:00')],
      [hour('B1', '09', 300), hour('B1', '10', 200)], NOW);
    expect(rows.map(r => [r.worker_name, r.pcs, r.hours])).toEqual([['Ramesh', 250, 2], ['Sunita', 250, 2]]);
    // 250 pcs x 12 s x 4 persons = 12000 person-s earned in 7200 s => 167%
    expect(rows[0].vs_std).toBe(167);
  });

  test('a packer who joins half way gets the share for their minutes', () => {
    const { rows } = crew.shareOutput(
      [W(1, 'A', 'B1', '2026-11-19T09:00:00', '2026-11-19T10:00:00'), W(2, 'B', 'B1', '2026-11-19T09:30:00', '2026-11-19T10:00:00')],
      [hour('B1', '09', 90)], NOW);
    const by = Object.fromEntries(rows.map(r => [r.worker_name, r.pcs]));
    expect(by).toEqual({ A: 60, B: 30 });
  });

  test('a move between stations counts on both, hours add up', () => {
    const { rows } = crew.shareOutput(
      [W(1, 'Anil', 'B1', '2026-11-19T09:00:00', '2026-11-19T11:30:00'), W(1, 'Anil', 'D', '2026-11-19T11:30:00', '2026-11-19T13:00:00')],
      [hour('B1', '11', 100), hour('D', '11', 40)], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stations: 'B1, D', hours: 4, pcs: 140 });
  });

  test('only 09:00-17:00 counts and a row left open stops at 17:00', () => {
    const { rows } = crew.shareOutput([W(1, 'A', 'B1', '2026-11-19T08:30:00', null)], [hour('B1', '16', 50), hour('B1', '17', 999)], at('2026-11-20T10:00:00'));
    expect(rows[0].hours).toBe(8);
    expect(rows[0].pcs).toBe(50);
  });

  test('pieces packed with no packer recorded are reported apart', () => {
    const { rows, unassigned } = crew.shareOutput([W(1, 'A', 'B1', '2026-11-19T10:00:00', '2026-11-19T11:00:00')], [hour('B1', '09', 70), hour('C1', '10', 30)], NOW);
    expect(rows[0].pcs).toBe(0);
    expect(unassigned).toEqual(expect.arrayContaining([{ day: '2026-11-19', station: 'B1', pcs: 70 }, { day: '2026-11-19', station: 'C1', pcs: 30 }]));
  });

  test('no standard on the item leaves vs std empty', () => {
    const { rows } = crew.shareOutput([W(1, 'A', 'B1', '2026-11-19T09:00:00', '2026-11-19T10:00:00')], [hour('B1', '09', 80, null, null)], NOW);
    expect(rows[0].vs_std).toBeNull();
    expect(rows[0].pcs_hr).toBe(80);
  });
});

describe('packing crew - helpers', () => {
  test('standard speed scales with the people on the station', () => {
    expect(crew.crewStdRate(260, 3, 2)).toBe(173);
    expect(crew.crewStdRate(260, null, 2)).toBe(260);
    expect(crew.crewStdRate(0, 3, 2)).toBe(0);
  });

  test('a time typed for today; future or bad times are refused', () => {
    const now = at('2026-11-19T13:42:00');
    expect(crew.todayAt('09:00', now)).toBe(at('2026-11-19T09:00:00'));
    expect(crew.todayAt('14:30', now)).toBeNull();
    expect(crew.todayAt('25:00', now)).toBeNull();
    expect(crew.todayAt('nine', now)).toBeNull();
  });

  test('packers Excel: loose headers, blank names skipped, no Name column refused', () => {
    expect(readWorkerSheet([['Worker Name', 'Token No', 'Agency'], ['Ramesh K', 'T-12', 'Sai Labour'], ['', 'x', ''], ['Sunita', '', '']]))
      .toEqual([{ name: 'Ramesh K', badge_no: 'T-12', contractor: 'Sai Labour' }, { name: 'Sunita', badge_no: '', contractor: '' }]);
    expect(readWorkerSheet([['Qty', 'Item'], [1, 'x']])).toBeNull();
  });
});

describe('packing live - with the crew recorded', () => {
  const now = at('2026-11-19T13:42:00');
  const plan = { id: 1, status: 'RUNNING', plan_qty: 2000, scanned_qty: 800, rate_now: 210, std_pcs_hr: 260, std_persons: 3, start_local: '2026-11-19T09:00:00' };
  const scan = { good_today: 800, last_good_at: new Date(now - 60000).toISOString() };

  test('efficiency is against the standard for the people actually there', () => {
    const t = live.stationTile({ name: 'C1', persons: 3 }, [plan], scan, null, now, { n: 2, names: ['Vijay', 'Meena'] });
    expect(t.std_pcs_hr).toBe(173);
    expect(t.efficiency).toBe(121);
    expect(t.crew_short).toBe(true);
    expect(live.alertsOf([t], { waiting_old: 0, old_stock_units: 0 }).map(a => a.kind)).toEqual(['crew']);
  });

  test('without crew records the tile keeps the full standard and no shortage', () => {
    const t = live.stationTile({ name: 'C1', persons: 3 }, [plan], scan, null, now, null);
    expect(t.std_pcs_hr).toBe(260);
    expect(t.crew).toBeNull();
    expect(t.crew_short).toBe(false);
  });
});
