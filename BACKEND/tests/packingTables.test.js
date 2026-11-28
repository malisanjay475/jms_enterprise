'use strict';

const { defaultTablesFor, parseCodes, tableLineId, tableAliasRows, splitTableLine } = require('../src/modules/packing/registerPackingTableRoutes');

describe('packing station default tables (owner list, Nov-2026)', () => {
  test('stations get their tables by code or name', () => {
    expect(defaultTablesFor({ code: 'A', name: 'Station A' })).toHaveLength(13);
    expect(defaultTablesFor({ code: 'B1', name: 'Assembly Station B1' })).toEqual(Array.from({ length: 14 }, (_, i) => `B${i + 1}`));
    expect(defaultTablesFor({ name: 'Assembly Station C1' })[12]).toBe('C13');
    expect(defaultTablesFor({ code: 'D', name: 'Station D' })).toHaveLength(13);
    expect(defaultTablesFor({ code: 'D1', name: 'Station D1 Cleanmax' })).toEqual(['DC1', 'DC2', 'DC3', 'DC4', 'DC5', 'DC6', 'DC7']);
    expect(defaultTablesFor({ name: 'Station E1' })).toEqual(['E1', 'E2', 'E3']);
    expect(defaultTablesFor({ name: 'Station F1' })).toEqual(['F1']);
    expect(defaultTablesFor({ name: 'Station Online' })[14]).toBe('SF15');
  });

  test('a station not in the list gets none', () => {
    expect(defaultTablesFor({ name: 'Station Z' })).toEqual([]);
    expect(defaultTablesFor(null)).toEqual([]);
  });
});

describe('packing table codes', () => {
  test('codes are upper case, unique and in order', () => {
    expect(parseCodes('a1, A2 a2;A3')).toEqual(['A1', 'A2', 'A3']);
    expect(parseCodes(['b1', ' B2 ', '', null])).toEqual(['B1', 'B2']);
    expect(parseCodes('')).toEqual([]);
  });
});

describe('table scanner lines', () => {
  test('a table scanner line is "<station>/<code>" and splits back', () => {
    expect(tableLineId('Station A', 'a1')).toBe('Station A/A1');
    expect(splitTableLine('Station A/A1')).toEqual({ station: 'Station A', code: 'A1' });
    expect(splitTableLine('Table B1')).toBeNull();
    expect(splitTableLine('/A1')).toBeNull();
    expect(splitTableLine('Station A/')).toBeNull();
  });

  test('each active plan is listed again per table, marked as an alias', () => {
    const plans = [
      { id: 1, table_id: 'Station A', tables: 'A1,A2', status: 'RUNNING' },
      { id: 2, table_id: 'Station B1', tables: null },
      { id: 3, table_id: 'Station C1', tables: '' }
    ];
    const rows = tableAliasRows(plans);
    expect(rows.map(r => r.table_id)).toEqual(['Station A/A1', 'Station A/A2']);
    expect(rows[0]).toMatchObject({ id: 1, station_id: 'Station A', table_code: 'A1', is_table_alias: true, status: 'RUNNING' });
    expect(plans[0].table_id).toBe('Station A'); // the original rows stay as they were
  });
});
