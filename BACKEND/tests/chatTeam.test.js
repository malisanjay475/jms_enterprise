'use strict';

const chatTeam = require('../src/modules/chat/chatTeam');

describe('team groups', () => {
  test('line names are normalised; junk is ignored', () => {
    expect(chatTeam.normLine('Line 3')).toBe('3');
    expect(chatTeam.normLine('line-a')).toBe('A');
    expect(chatTeam.normLine('L2')).toBe('L2');
    expect(chatTeam.normLine('')).toBeNull();
    expect(chatTeam.normLine('a very long free text that is not a line')).toBeNull();
  });

  test('departments from role codes', () => {
    const D = chatTeam.DEPARTMENTS;
    expect(D.qc.test('qc_inspector')).toBe(true);
    expect(D.ppc.test('sr_ppc_manager')).toBe(true);
    expect(D.moulding.test('moulding_supervisor')).toBe(true);
    expect(D.maintenance.test('maintenance_manager')).toBe(true);
    expect(D.qc.test('planner')).toBe(false);
  });
});

describe('@team mentions', () => {
  test('finds @Line3 / @QC and asks for those groups', async () => {
    const pool = { query: jest.fn(async (_sql, params) => ({ rows: params[0].length ? [{ u: 'ravi' }] : [] })) };
    const s = await chatTeam.teamMentions(pool, 'Please check @Line3 and @QC now');
    expect([...s]).toEqual(['ravi']);
    expect(pool.query.mock.calls[0][1][0].sort()).toEqual(['dept:%:qc', 'line:%:3']);
  });
  test('no team, no query', async () => {
    const pool = { query: jest.fn() };
    expect((await chatTeam.teamMentions(pool, 'hello @ravi')).size).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('check-in distance', () => {
  test('metres between two points', () => {
    expect(Math.round(chatTeam.distanceM(21.0, 72.0, 21.0, 72.0))).toBe(0);
    const d = chatTeam.distanceM(21.0, 72.0, 21.001, 72.0); // ~111 m
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});
