'use strict';

function mockResponse(status, body, headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: jest.fn((name) => normalizedHeaders[String(name).toLowerCase()] || null)
    },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body))
  };
}

describe('Sync service pull resilience', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retries HTTP 429 pull responses before returning data', async () => {
    const syncService = require('../services/sync.service');
    syncService.__test.setRuntimeForTests({
      MAIN_SERVER_URL: 'http://main.example',
      LOCAL_FACTORY_ID: 1,
      API_KEY: 'test-key'
    });

    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockResponse(429, { ok: false, error: 'Too many requests' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: [] }));

    await expect(syncService.__test.pullTableAllPages('orders', '2026-05-23T00:00:00.000Z')).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps LAST_PULL unchanged when any table pull fails', async () => {
    const syncService = require('../services/sync.service');
    const configWrites = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("WHERE key = 'LAST_PULL'")) {
          return { rows: [{ value: '2026-05-23T00:00:00.000Z' }], rowCount: 1 };
        }
        if (text.includes('SELECT NOW() AS ts')) {
          return { rows: [{ ts: '2026-05-23T01:00:00.000Z' }], rowCount: 1 };
        }
        if (text.includes('information_schema.tables')) {
          return { rows: params[0] === 'orders' ? [{ exists: 1 }] : [], rowCount: params[0] === 'orders' ? 1 : 0 };
        }
        if (text.includes('INSERT INTO server_config')) {
          configWrites.push(params);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    syncService.__test.setRuntimeForTests({
      pool,
      MAIN_SERVER_URL: 'http://main.example',
      LOCAL_FACTORY_ID: 1,
      API_KEY: 'test-key'
    });

    global.fetch = jest.fn().mockResolvedValue(
      mockResponse(429, { ok: false, error: 'Too many requests' }, { 'retry-after': '0' })
    );

    const stats = await syncService.__test.pullChanges();

    expect(stats.failed).toBeGreaterThan(0);
    expect(configWrites.some(([key]) => key === 'LAST_PULL')).toBe(false);
  });
});
