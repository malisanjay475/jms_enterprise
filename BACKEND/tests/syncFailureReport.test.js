'use strict';

// From the factory server's sync to what its heartbeat reports, through one shared config table.

const sync = require('../services/sync.service');
const { __test: { getServerConfigMap, collectSyncFailures } } = require('../src/local-servers/localNodeAgent');

describe('what a LOCAL reports to MAIN', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('a failing pull and local-only access are stored, read back and reported', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const config = { LAST_PULL: '2026-11-24T11:09:00.000Z' };
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('INSERT INTO server_config')) { config[params[0]] = params[1]; return { rows: [] }; }
        if (text.includes('FROM server_config')) {
          const keys = Array.isArray(params[0]) ? params[0] : ['LAST_PULL'];
          return { rows: keys.filter((k) => k in config).map((key) => ({ key, value: config[key] })) };
        }
        return { rows: [{ exists: true, ts: '2026-11-25T06:00:00.000Z' }], rowCount: 1 };
      }),
      connect: jest.fn()
    };
    sync.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'LOCAL', MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 2, API_KEY: 'k' });
    global.fetch = jest.fn(async (url) => {
      const bad = String(url).includes('table=moulds&');
      return {
        ok: !bad, status: bad ? 400 : 200, headers: { get: () => null },
        json: async () => ({ ok: true, data: [] }), text: async () => 'bad mould row'
      };
    });
    await sync.__test.pullChanges();
    expect(config.LAST_PULL).toBe('2026-11-24T11:09:00.000Z'); // kept, as before

    config.LOCAL_ONLY_ACCESS = JSON.stringify({ count: 1, users: ['ravi'], checkedAt: '2026-11-25T06:00:00.000Z' });
    const reported = await collectSyncFailures({ query: async (sql, params) => (
      String(sql).includes('sync_failed_rows') ? { rows: [] } : pool.query(sql, params)
    ) }, await getServerConfigMap(pool));
    expect(reported).toEqual([
      expect.objectContaining({ table: 'moulds (pull)', count: 1, error: expect.stringContaining('bad mould row') }),
      expect.objectContaining({ table: 'user_factories (only on this server)', error: 'Not on the main site: ravi' })
    ]);
  });

  it('a row that cannot be saved gives its reason', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (String(sql).includes('INSERT INTO roles')) throw new Error('violates foreign key');
        return { rows: [] };
      })
    };
    const pool = {
      connect: async () => client,
      query: jest.fn(async () => ({ rows: [{ column_name: 'code' }, { column_name: 'label' }], rowCount: 2 }))
    };
    sync.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'LOCAL', LOCAL_FACTORY_ID: 2 });
    const stats = await sync.__test.upsertData('roles', [{ code: 'x', label: 'X' }]);
    expect(stats).toMatchObject({ failed: 1, error: 'violates foreign key' });
  });

  it('a clean pull clears the report', async () => {
    const failures = await collectSyncFailures({ query: async () => ({ rows: [] }) }, {
      LAST_PULL_FAILURES: JSON.stringify({ at: '2026-11-25T06:00:00.000Z', tables: [] })
    });
    expect(failures).toEqual([]);
  });
});
