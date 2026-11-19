'use strict';

const floor = require('../src/modules/packing/registerPackingFloorRoutes');

/* A tiny fake pool: answers by matching the SQL text. */
function fakePool(handlers) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) if (re.test(sql)) return fn(params);
      return { rows: [] };
    }
  };
}

describe('packing floor - supervisor PINs', () => {
  test('a PIN matches only its own hash', () => {
    const salt = 'a1b2c3';
    const row = { pin_salt: salt, pin_hash: floor.hashPin('4321', salt) };
    expect(floor.pinMatches('4321', row)).toBe(true);
    expect(floor.pinMatches('1234', row)).toBe(false);
    expect(floor.pinMatches('4321', { pin_salt: 'other', pin_hash: row.pin_hash })).toBe(false);
  });
});

describe('packing floor - station lock', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  test('MAIN never locks (no server factory)', async () => {
    delete process.env.SERVER_TYPE;
    const pool = fakePool([]);
    expect(floor.serverFactoryId()).toBeNull();
    expect(await floor.pinsEnabled(pool)).toBe(false);
    expect(await floor.lockStationForWrongScan(pool, { id: 1, table_id: 'B1' }, '111', '222')).toBeNull();
    expect(pool.calls.some(c => /INSERT INTO packing_lock_events/.test(c.sql))).toBe(false);
  });

  test('LOCAL without any PIN does not lock', async () => {
    process.env.SERVER_TYPE = 'LOCAL';
    process.env.LOCAL_FACTORY_ID = '1';
    const pool = fakePool([[/FROM packing_supervisor_pins/, () => ({ rows: [] })]]);
    expect(await floor.lockStationForWrongScan(pool, { id: 1, table_id: 'B1' }, '111', '222')).toBeNull();
    expect(pool.calls.some(c => /INSERT INTO packing_lock_events/.test(c.sql))).toBe(false);
  });

  test('LOCAL with a PIN opens one lock for the station and its factory', async () => {
    process.env.SERVER_TYPE = 'LOCAL';
    process.env.LOCAL_FACTORY_ID = '2';
    const pool = fakePool([
      [/FROM packing_supervisor_pins/, () => ({ rows: [{ '?column?': 1 }] })],
      [/SELECT \* FROM packing_lock_events/, () => ({ rows: [] })],
      [/INSERT INTO packing_lock_events/, (p) => ({ rows: [{ id: 9, factory_id: p[0], table_id: p[1], scanned_ean: p[4], expected_ean: p[5] }] })]
    ]);
    const lock = await floor.lockStationForWrongScan(pool, { id: 5, table_id: 'Assembly Station B1', sync_id: null }, '8904098900138', '8904098900121');
    expect(lock).toMatchObject({ factory_id: 2, table_id: 'Assembly Station B1', scanned_ean: '8904098900138', expected_ean: '8904098900121' });
  });

  test('a station already locked is not locked twice', async () => {
    process.env.SERVER_TYPE = 'LOCAL';
    process.env.LOCAL_FACTORY_ID = '1';
    const pool = fakePool([
      [/FROM packing_supervisor_pins/, () => ({ rows: [{}] })],
      [/SELECT \* FROM packing_lock_events/, () => ({ rows: [{ id: 3, table_id: 'B1' }] })]
    ]);
    expect(await floor.lockStationForWrongScan(pool, { id: 1, table_id: 'B1' }, '1', '2')).toBeNull();
    expect(pool.calls.some(c => /INSERT INTO packing_lock_events/.test(c.sql))).toBe(false);
  });

  test('openLockFor scopes the lock to the server factory', async () => {
    process.env.SERVER_TYPE = 'LOCAL';
    process.env.LOCAL_FACTORY_ID = '3';
    const pool = fakePool([[/SELECT \* FROM packing_lock_events/, () => ({ rows: [{ id: 1 }] })]]);
    await floor.openLockFor(pool, 'B1');
    expect(pool.calls[0].params).toEqual(['B1', 3]);
  });
});
