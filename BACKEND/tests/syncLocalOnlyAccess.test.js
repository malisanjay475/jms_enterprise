'use strict';

const sync = require('../services/sync.service');
const { __test: { localOnlyAccessEntry } } = require('../src/local-servers/localNodeAgent');

const answer = (data) => ({
  ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, data }), text: async () => ''
});

describe('access rows that exist only on a LOCAL', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  async function run(mainRows, SERVER_TYPE = 'LOCAL') {
    const saved = {};
    const sqls = [];
    const pool = {
      query: jest.fn(async (sql, params) => {
        sqls.push(String(sql));
        if (String(sql).includes('FROM user_factories')) {
          return { rows: [{ user_id: 1, factory_id: 2, username: 'asha' }, { user_id: 9, factory_id: 2, username: 'ravi' }] };
        }
        if (String(sql).includes('INSERT INTO server_config')) saved[params[0]] = params[1];
        return { rows: [] };
      })
    };
    sync.__test.setRuntimeForTests({ pool, SERVER_TYPE, MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 2, API_KEY: 'k' });
    global.fetch = jest.fn().mockResolvedValue(answer(mainRows));
    await sync.__test.checkLocalOnlyAccess();
    expect(sqls.join('\n')).not.toMatch(/DELETE|UPDATE user_factories/);
    return saved.LOCAL_ONLY_ACCESS;
  }

  it('reports them by name, deletes nothing, and checks at most hourly', async () => {
    const raw = await run([{ id: 5, user_id: 1, factory_id: 2 }]);
    expect(JSON.parse(raw)).toMatchObject({ count: 1, users: ['ravi'] });
    await sync.__test.checkLocalOnlyAccess();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(localOnlyAccessEntry(raw)).toEqual([
      expect.objectContaining({ count: 1, error: 'Not on the main site: ravi' })
    ]);
  });

  it('does not trust an empty answer, and does nothing on MAIN', async () => {
    expect(await run([])).toBeUndefined();
    expect(await run([{ id: 5, user_id: 1, factory_id: 2 }], 'MAIN')).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows nothing when there are none or the value is unreadable', () => {
    expect(localOnlyAccessEntry('{"count":0,"users":[]}')).toEqual([]);
    expect(localOnlyAccessEntry(undefined)).toEqual([]);
    expect(localOnlyAccessEntry('x')).toEqual([]);
  });
});
