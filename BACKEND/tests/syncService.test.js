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

describe('Sync service push outbox (no row loss)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('parks unsent rows in the outbox when the push to MAIN fails', async () => {
    const syncService = require('../services/sync.service');
    const outboxInserts = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('information_schema') || text.includes('column_name')) {
          // pretend the table exists and has no factory_id column
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('FROM orders')) {
          // one batch of two rows, then nothing
          if (!pool._served) {
            pool._served = true;
            return { rows: [{ id: 1, updated_at: 'x' }, { id: 2, updated_at: 'y' }], rowCount: 2 };
          }
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('INSERT INTO sync_failed_rows')) {
          outboxInserts.push(params);
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

    global.fetch = jest.fn().mockResolvedValue(mockResponse(500, 'boom'));

    const stats = await syncService.__test.pushTableAllBatches('orders', '1970-01-01');

    expect(stats.failed).toBe(2);
    // both rows recorded in the outbox for retry
    expect(outboxInserts.length).toBe(2);
    expect(outboxInserts.map((p) => p[0])).toEqual(['orders', 'orders']);
  });

  it('recovers and clears outbox rows once MAIN accepts them', async () => {
    const syncService = require('../services/sync.service');
    const deletes = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('SELECT DISTINCT table_name FROM sync_failed_rows')) {
          return { rows: [{ table_name: 'orders' }], rowCount: 1 };
        }
        if (text.includes('SELECT id, payload FROM sync_failed_rows')) {
          return { rows: [{ id: 10, payload: { id: 2 } }], rowCount: 1 };
        }
        if (text.includes('DELETE FROM sync_failed_rows')) {
          deletes.push(params);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    syncService.__test.setRuntimeForTests({
      pool,
      SERVER_TYPE: 'LOCAL',
      MAIN_SERVER_URL: 'http://main.example',
      LOCAL_FACTORY_ID: 1,
      API_KEY: 'test-key'
    });

    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { ok: true }));

    const stats = await syncService.__test.drainOutbox();

    expect(stats.recovered).toBe(1);
    expect(stats.stillFailed).toBe(0);
    expect(deletes.length).toBe(1);
  });

  it('parks rows and does NOT advance when MAIN reports partial row failures (HTTP 200 + stats.failed)', async () => {
    const syncService = require('../services/sync.service');
    const outboxInserts = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('information_schema') || text.includes('column_name')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('FROM orders')) {
          if (!pool._served) {
            pool._served = true;
            return { rows: [{ id: 1, updated_at: 'x' }, { id: 2, updated_at: 'y' }], rowCount: 2 };
          }
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('INSERT INTO sync_failed_rows')) {
          outboxInserts.push(params);
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

    // MAIN accepts the request (200) but reports one row failed to upsert.
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { ok: true, stats: { failed: 1 } }));

    const stats = await syncService.__test.pushTableAllBatches('orders', '1970-01-01');

    // the failure is surfaced and the rows are parked for retry, not lost
    expect(stats.failed).toBe(1);
    expect(outboxInserts.length).toBe(2);
  });

  it('keeps outbox rows parked when a retry still partially fails on MAIN', async () => {
    const syncService = require('../services/sync.service');
    const deletes = [];
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('SELECT DISTINCT table_name FROM sync_failed_rows')) {
          return { rows: [{ table_name: 'orders' }], rowCount: 1 };
        }
        if (text.includes('SELECT id, payload FROM sync_failed_rows')) {
          return { rows: [{ id: 10, payload: { id: 2 } }], rowCount: 1 };
        }
        if (text.includes('DELETE FROM sync_failed_rows')) {
          deletes.push(params);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    syncService.__test.setRuntimeForTests({
      pool,
      SERVER_TYPE: 'LOCAL',
      MAIN_SERVER_URL: 'http://main.example',
      LOCAL_FACTORY_ID: 1,
      API_KEY: 'test-key'
    });

    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { ok: true, stats: { failed: 1 } }));

    const stats = await syncService.__test.drainOutbox();

    expect(stats.recovered).toBe(0);
    expect(stats.stillFailed).toBe(1);
    expect(deletes.length).toBe(0);
  });
});

describe('Sync service JSONB array coercion', () => {
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

  it('stringifies array-valued jsonb columns before sending to MAIN', async () => {
    const syncService = require('../services/sync.service');
    const pool = {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        if (text.includes("data_type IN ('json', 'jsonb')")) {
          return { rows: [{ column_name: 'colour_details' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };
    syncService.__test.setRuntimeForTests({ pool });

    const rows = [{ id: 1, colour_details: [{ c: 'red' }], other: 'x' }];
    const out = await syncService.__test.coerceJsonColumnsForWire('plan_board', rows);

    // the array is serialized to a JSON string so node-pg binds it as jsonb
    expect(typeof out[0].colour_details).toBe('string');
    expect(out[0].colour_details).toBe('[{"c":"red"}]');
    // untouched columns pass through, original row is not mutated
    expect(out[0].other).toBe('x');
    expect(Array.isArray(rows[0].colour_details)).toBe(true);
  });
});

describe('Sync service plan_board resurrection guard', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A plan_board schema with the columns upsertData filters against.
  function makePool(clientQuery) {
    const query = jest.fn(async (sql) => {
      const text = String(sql);
      if (text.includes("data_type IN ('json', 'jsonb')")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('information_schema.columns')) {
        return {
          rows: ['plan_id', 'updated_at', 'status', 'mould_name'].map((c) => ({ column_name: c })),
          rowCount: 4
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query: clientQuery, release: jest.fn() };
    return { pool: { query, connect: jest.fn(async () => client) }, client };
  }

  it('skips an incoming plan_board row when a tombstone is at least as new as its edit', async () => {
    const syncService = require('../services/sync.service');
    const insertCalls = [];
    const clientQuery = jest.fn(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM sync_deletions')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO plan_board')) {
        insertCalls.push(text);
        return { rows: [{ inserted: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const { pool } = makePool(clientQuery);
    syncService.__test.setRuntimeForTests({ pool });

    const stats = await syncService.__test.upsertData('plan_board', [
      { plan_id: 'PLN-2627-0989', updated_at: '2026-07-11T09:00:00.000Z', status: 'Planned' }
    ]);

    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
    expect(stats.updated).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });

  it('inserts an incoming plan_board row when no tombstone exists', async () => {
    const syncService = require('../services/sync.service');
    const insertCalls = [];
    const clientQuery = jest.fn(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM sync_deletions')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO plan_board')) {
        insertCalls.push(text);
        return { rows: [{ inserted: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const { pool } = makePool(clientQuery);
    syncService.__test.setRuntimeForTests({ pool });

    const stats = await syncService.__test.upsertData('plan_board', [
      { plan_id: 'PLN-2627-0989', updated_at: '2026-07-11T09:00:00.000Z', status: 'Planned' }
    ]);

    expect(stats.skipped).toBe(0);
    expect(stats.created).toBe(1);
    expect(insertCalls).toHaveLength(1);
  });
});
