'use strict';

const fs = require('fs');
const path = require('path');
const { stripMachinePrefix, dedupePlansById } = require('../src/utils/machineName');

describe('machine name normalization (prevents duplicate master rows)', () => {
  it('strips the legacy "B -L1>" building/line prefix', () => {
    expect(stripMachinePrefix('B -L1>HYD-350-1')).toBe('HYD-350-1');
    expect(stripMachinePrefix('E -L2>OMEGA-100-11')).toBe('OMEGA-100-11');
  });

  it('leaves already-clean codes untouched', () => {
    expect(stripMachinePrefix('HYD-350-1')).toBe('HYD-350-1');
  });

  it('trims whitespace and handles empty/null', () => {
    expect(stripMachinePrefix('  HYD-350-1  ')).toBe('HYD-350-1');
    expect(stripMachinePrefix('')).toBe('');
    expect(stripMachinePrefix(null)).toBe('');
    expect(stripMachinePrefix(undefined)).toBe('');
  });
});

describe('dedupePlansById (planning board fan-out safety net)', () => {
  it('collapses repeated plan ids to a single row, keeping the first', () => {
    const rows = [
      { id: 1, machine: 'A', tag: 'keep' },
      { id: 1, machine: 'A', tag: 'drop' },
      { id: 2, machine: 'B' },
    ];
    const out = dedupePlansById(rows);
    expect(out).toHaveLength(2);
    expect(out.map(r => r.id)).toEqual([1, 2]);
    expect(out[0].tag).toBe('keep');
  });

  it('returns unique input unchanged', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(dedupePlansById(rows)).toHaveLength(3);
  });

  it('keeps rows with missing ids rather than dropping them', () => {
    const rows = [{ id: null }, { id: undefined }, { id: 5 }, { id: 5 }];
    expect(dedupePlansById(rows)).toHaveLength(3);
  });

  it('tolerates non-array input', () => {
    expect(dedupePlansById(null)).toEqual([]);
  });
});

describe('planning board SQL guard is present', () => {
  it('/api/planning/board query still uses DISTINCT ON (pb.id)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/legacy/registerLegacyRoutes.js'),
      'utf8'
    );
    // Tripwire: if this guard is ever removed, the board can fan out and render
    // plans twice again. See project_planning_board_join_fanout memory / PR #913.
    expect(src).toMatch(/SELECT DISTINCT ON \(pb\.id\)/);
  });
});
