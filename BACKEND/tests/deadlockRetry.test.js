'use strict';

const { withTransactionDeadlockRetry } = require('../src/utils/deadlockRetry');

function fakePool() {
  const log = [];
  let open = 0;
  return {
    log,
    open: () => open,
    connect: async () => {
      open++;
      return { query: async (sql) => { log.push(sql); }, release: () => { open--; } };
    }
  };
}
const err = (code) => Object.assign(new Error(code), { code });

describe('withTransactionDeadlockRetry', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('rolls back and runs again after a deadlock', async () => {
    const pool = fakePool();
    let n = 0;
    const out = await withTransactionDeadlockRetry(pool, async () => {
      if (++n === 1) throw err('40P01');
      return 'done';
    }, { delayMs: 0 });
    expect(out).toBe('done');
    expect(pool.log).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
    expect(pool.open()).toBe(0);
  });

  it('gives up after the last attempt', async () => {
    const pool = fakePool();
    await expect(withTransactionDeadlockRetry(pool, async () => { throw err('40P01'); }, { delayMs: 0 }))
      .rejects.toThrow('40P01');
    expect(pool.log.filter((s) => s === 'ROLLBACK')).toHaveLength(3);
    expect(pool.open()).toBe(0);
  });

  it('does not retry any other error', async () => {
    const pool = fakePool();
    await expect(withTransactionDeadlockRetry(pool, async () => { throw err('23505'); }, { delayMs: 0 }))
      .rejects.toThrow('23505');
    expect(pool.log).toEqual(['BEGIN', 'ROLLBACK']);
  });
});
