'use strict';

describe('Sync serial-sequence resync', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  function load(columnsByTable) {
    const syncService = require('../services/sync.service');
    const calls = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        calls.push(text);
        if (text.includes('information_schema.columns')) {
          const has = (columnsByTable[params[0]] || []).includes(params[1]);
          return { rows: has ? [{ '?column?': 1 }] : [], rowCount: has ? 1 : 0 };
        }
        return { rows: [], rowCount: 1 };
      })
    };
    syncService.__test.setRuntimeForTests({ pool });
    return { resync: syncService.__test.resyncSerialSequence, calls, pool };
  }

  it('resets the sequence for a table that has the column', async () => {
    const { resync, calls } = load({ plan_board: ['id'] });
    await resync('plan_board');
    expect(calls.some((t) => t.includes('setval'))).toBe(true);
  });

  it('skips a table without the column (job_cards has no id) and warns nothing', async () => {
    const { resync, calls } = load({ job_cards: ['jobcard_no'] });
    await resync('job_cards');
    await resync('job_cards');
    expect(calls.some((t) => t.includes('setval'))).toBe(false);
    expect(calls.filter((t) => t.includes('information_schema.columns'))).toHaveLength(1);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
