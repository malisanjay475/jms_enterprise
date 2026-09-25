'use strict';

const bcrypt = require('bcryptjs');
const { hashLegacyPlaintextPasswords } = require('../src/app/passwordUpgrade');

describe('Legacy plain-text password upgrade', () => {
  const quiet = { log: () => {} };

  it('hashes plain-text passwords so the owner can still log in', async () => {
    const updates = [];
    const pool = {
      query: jest.fn(async (sql, params) => {
        if (/^\s*SELECT/i.test(sql)) return { rows: [{ id: 7, password: 'secret123' }] };
        updates.push(params);
        return { rowCount: 1 };
      })
    };
    const n = await hashLegacyPlaintextPasswords(pool, { rounds: 4, log: quiet });
    expect(n).toBe(1);
    const [hash, id, oldValue] = updates[0];
    expect(id).toBe(7);
    expect(oldValue).toBe('secret123');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('secret123', hash)).toBe(true);
  });

  it('only selects rows that are not bcrypt hashes and does nothing when there are none', async () => {
    const pool = { query: jest.fn(async () => ({ rows: [] })) };
    expect(await hashLegacyPlaintextPasswords(pool, { log: quiet })).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/NOT LIKE '\$2%'/);
  });

  it('never overwrites a password that changed in the meantime', async () => {
    const pool = {
      query: jest.fn(async (sql) => (/^\s*SELECT/i.test(sql)
        ? { rows: [{ id: 1, password: 'old' }] }
        : { rowCount: 0 }))
    };
    expect(await hashLegacyPlaintextPasswords(pool, { rounds: 4, log: quiet })).toBe(0);
    expect(pool.query.mock.calls[1][0]).toMatch(/AND password = \$3/);
  });
});
