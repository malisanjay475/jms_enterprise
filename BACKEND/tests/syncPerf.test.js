'use strict';

// Covers the sync load/correctness fixes: id-cursor paging for tables without factory_id,
// streaming pull pages, the echo-loop flag, deletion paging, and fetch timeouts.

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn(() => null) },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function rowsWithIds(from, count) {
  return Array.from({ length: count }, (_, i) => ({ id: from + i, updated_at: '2026-09-24T05:00:00.000Z' }));
}

// Pool whose information_schema answers come from `columnsByTable`.
function schemaPool(columnsByTable, handler = () => null) {
  return {
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);
      const custom = await handler(text, params);
      if (custom) return custom;
      if (text.includes("data_type IN ('json', 'jsonb')")) return { rows: [], rowCount: 0 };
      if (text.includes('information_schema.tables')) {
        const ok = Boolean(columnsByTable[params[0]]);
        return { rows: ok ? [{ exists: 1 }] : [], rowCount: ok ? 1 : 0 };
      }
      if (text.includes('information_schema.columns')) {
        const cols = columnsByTable[params[0]] || [];
        return { rows: cols.map((c) => ({ column_name: c })), rowCount: cols.length };
      }
      return { rows: [], rowCount: 0 };
    })
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('getChanges (MAIN serving a pull page)', () => {
  it('does not filter on factory_id for a table without that column and keeps the id cursor', async () => {
    const syncService = require('../services/sync.service');
    const pool = schemaPool({ notifications: ['id', 'updated_at', 'target_user'] });
    syncService.__test.setRuntimeForTests({ pool });

    await syncService.__test.getChanges('notifications', '2026-09-24T00:00:00.000Z', 1, 5000);

    const [sql, params] = pool.query.mock.calls.map((c) => [String(c[0]), c[1]]).find(([s]) => s.startsWith('SELECT * FROM notifications'));
    expect(sql).not.toContain('factory_id');
    expect(sql).toContain('updated_at > $1');
    expect(sql).toContain('id > $2');
    expect(sql).toContain('ORDER BY id ASC');
    expect(params).toEqual(['2026-09-24T00:00:00.000Z', 5000]);
  });

  it('still scopes factory tables to the requesting factory', async () => {
    const syncService = require('../services/sync.service');
    const pool = schemaPool({ dpr_hourly: ['id', 'updated_at', 'factory_id'] });
    syncService.__test.setRuntimeForTests({ pool });

    await syncService.__test.getChanges('dpr_hourly', '2026-09-24T00:00:00.000Z', 1, null);

    const [sql, params] = pool.query.mock.calls.map((c) => [String(c[0]), c[1]]).find(([s]) => s.startsWith('SELECT * FROM dpr_hourly'));
    expect(sql).toContain('(factory_id = $2 OR factory_id IS NULL)');
    expect(params).toEqual(['2026-09-24T00:00:00.000Z', 1]);
  });
});

describe('pullTableAllPages (LOCAL paging)', () => {
  it('hands each page to onPage instead of accumulating, advancing afterId', async () => {
    const syncService = require('../services/sync.service');
    syncService.__test.setRuntimeForTests({ MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 1, API_KEY: 'k' });
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: rowsWithIds(1, 1000) }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: rowsWithIds(1001, 1000) }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: rowsWithIds(2001, 5) }));

    const pages = [];
    const result = await syncService.__test.pullTableAllPages('notifications', '2026-09-24T00:00:00.000Z', async (rows) => {
      pages.push(rows.length);
    });

    expect(pages).toEqual([1000, 1000, 5]);
    expect(result).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[1][0]).toContain('afterId=1000');
    expect(global.fetch.mock.calls[2][0]).toContain('afterId=2000');
  });

  it('stops when MAIN does not advance the id cursor (older MAIN ignoring afterId)', async () => {
    const syncService = require('../services/sync.service');
    syncService.__test.setRuntimeForTests({ MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 1, API_KEY: 'k' });
    // An old MAIN returns the same "first 1000 by updated_at" page every time.
    global.fetch = jest.fn().mockImplementation(async () => mockResponse(200, { ok: true, data: rowsWithIds(1, 1000) }));

    await syncService.__test.pullTableAllPages('notifications', '2026-09-24T00:00:00.000Z', async () => {});

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('passes an abort signal so a hung request to MAIN times out', async () => {
    const syncService = require('../services/sync.service');
    syncService.__test.setRuntimeForTests({ MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 1, API_KEY: 'k' });
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { ok: true, data: [] }));

    await syncService.__test.pullTableAllPages('orders', '2026-09-24T00:00:00.000Z');

    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('echo-loop fix (keep MAIN timestamps on LOCAL)', () => {
  it('trigger functions skip the re-stamp while the sync-apply flag is on', () => {
    const syncService = require('../services/sync.service');
    const sql = syncService.__test.buildTouchFunctionSql('touch_sync_updated_at_column');
    expect(sql).toContain("current_setting('jms.sync_apply', true) = 'on'");
    expect(sql.indexOf('RETURN NEW')).toBeLessThan(sql.indexOf('NEW.updated_at = NOW()'));
  });

  function upsertClient() {
    const calls = [];
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        calls.push(String(sql));
        if (String(sql).includes('INSERT INTO shift_teams')) return { rows: [{ inserted: true }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      })
    };
    return { client, calls };
  }

  it('LOCAL sets the flag right after BEGIN when applying pulled rows', async () => {
    const syncService = require('../services/sync.service');
    const { client, calls } = upsertClient();
    const pool = schemaPool({ shift_teams: ['id', 'line', 'shift_date', 'shift', 'updated_at', 'factory_id'] });
    pool.connect = jest.fn(async () => client);
    syncService.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'LOCAL' });

    await syncService.__test.upsertData('shift_teams', [
      { line: 'B -L4', shift_date: '2026-09-24', shift: 'Day', updated_at: '2026-09-24T05:00:00.000Z', factory_id: 1 }
    ]);

    const begin = calls.indexOf('BEGIN');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(calls[begin + 1]).toContain("set_config('jms.sync_apply', 'on', true)");
  });

  it('MAIN does not set the flag, so its arrival re-stamp stays visible to other servers', async () => {
    const syncService = require('../services/sync.service');
    const { client, calls } = upsertClient();
    const pool = schemaPool({ shift_teams: ['id', 'line', 'shift_date', 'shift', 'updated_at', 'factory_id'] });
    pool.connect = jest.fn(async () => client);
    syncService.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'MAIN' });

    await syncService.__test.upsertData('shift_teams', [
      { line: 'B -L4', shift_date: '2026-09-24', shift: 'Day', updated_at: '2026-09-24T05:00:00.000Z', factory_id: 1 }
    ]);

    expect(calls.some((c) => c.includes('jms.sync_apply'))).toBe(false);
  });

  it('refreshes the legacy update_updated_at_column() only where it exists', async () => {
    const syncService = require('../services/sync.service');
    const withLegacy = schemaPool({}, (text) => (text.includes("proname = 'update_updated_at_column'") ? { rows: [{ '?column?': 1 }], rowCount: 1 } : null));
    syncService.__test.setRuntimeForTests({ pool: withLegacy });
    await syncService.__test.ensureSyncTouchFunctions();
    const replaced = withLegacy.query.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('CREATE OR REPLACE FUNCTION'));
    expect(replaced.some((s) => s.includes('touch_sync_updated_at_column()'))).toBe(true);
    expect(replaced.some((s) => s.includes('update_updated_at_column()'))).toBe(true);

    jest.resetModules();
    const fresh = require('../services/sync.service');
    const withoutLegacy = schemaPool({});
    fresh.__test.setRuntimeForTests({ pool: withoutLegacy });
    await fresh.__test.ensureSyncTouchFunctions();
    const replaced2 = withoutLegacy.query.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('CREATE OR REPLACE FUNCTION'));
    expect(replaced2).toHaveLength(1);
  });
});

describe('deletion paging', () => {
  function deletionRows(from, count) {
    return Array.from({ length: count }, (_, i) => ({
      id: from + i, table: 'dpr_hourly', record_pk: String(from + i), factory_id: 1, deleted_at: '2026-09-24T05:00:00.000Z'
    }));
  }

  it('getDeletionChanges pages by id', async () => {
    const syncService = require('../services/sync.service');
    const pool = schemaPool({});
    syncService.__test.setRuntimeForTests({ pool });

    await syncService.__test.getDeletionChanges('2026-09-24T00:00:00.000Z', 1, 42);

    const [sql, params] = pool.query.mock.calls.map((c) => [String(c[0]), c[1]]).find(([s]) => s.includes('FROM sync_deletions'));
    expect(sql).toContain('id > $2');
    expect(sql).toContain('ORDER BY id ASC');
    expect(params).toEqual(['2026-09-24T00:00:00.000Z', 42, 1]);
  });

  function deletionPool(pages, configWrites) {
    return schemaPool({}, (text, params) => {
      if (text.includes("WHERE key = 'LAST_DELETE_PUSH'")) return { rows: [{ value: '2026-09-24T00:00:00.000Z' }], rowCount: 1 };
      if (text.includes('SELECT NOW() AS ts')) return { rows: [{ ts: '2026-09-24T06:00:00.000Z' }], rowCount: 1 };
      if (text.includes('FROM sync_deletions')) {
        const afterId = text.includes('id > $2') ? params[1] : null;
        const page = (afterId === null ? pages[0] : pages.find((p) => p[0] && p[0].id > afterId)) || [];
        return { rows: page, rowCount: page.length };
      }
      if (text.includes('INSERT INTO server_config')) {
        configWrites.push(params);
        return { rows: [], rowCount: 1 };
      }
      return null;
    });
  }

  it('pushes every tombstone page, not just the first 1000, then advances the watermark', async () => {
    const syncService = require('../services/sync.service');
    const configWrites = [];
    const pool = deletionPool([deletionRows(1, 1000), deletionRows(1001, 3)], configWrites);
    syncService.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'LOCAL', MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 1, API_KEY: 'k' });
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { ok: true }));

    const stats = await syncService.__test.pushDeletionChanges();

    expect(stats.deleted).toBe(1003);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(configWrites).toContainEqual(['LAST_DELETE_PUSH', '2026-09-24T06:00:00.000Z']);
  });

  it('keeps LAST_DELETE_PUSH when a batch fails so the tombstones are retried', async () => {
    const syncService = require('../services/sync.service');
    const configWrites = [];
    const pool = deletionPool([deletionRows(1, 3)], configWrites);
    syncService.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'LOCAL', MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 1, API_KEY: 'k' });
    global.fetch = jest.fn().mockResolvedValue(mockResponse(500, 'boom'));

    const stats = await syncService.__test.pushDeletionChanges();

    expect(stats.failed).toBe(3);
    expect(configWrites.some(([key]) => key === 'LAST_DELETE_PUSH')).toBe(false);
  });

  it('pulls deletions page by page and stops on an older MAIN that sends no ids', async () => {
    const syncService = require('../services/sync.service');
    const configWrites = [];
    const client = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })), release: jest.fn() };
    const pool = schemaPool({}, (text, params) => {
      if (text.includes("WHERE key = 'LAST_DELETE_PULL'")) return { rows: [{ value: '2026-09-24T00:00:00.000Z' }], rowCount: 1 };
      if (text.includes('SELECT NOW() AS ts')) return { rows: [{ ts: '2026-09-24T06:00:00.000Z' }], rowCount: 1 };
      if (text.includes('INSERT INTO server_config')) { configWrites.push(params); return { rows: [], rowCount: 1 }; }
      return null;
    });
    pool.connect = jest.fn(async () => client);
    syncService.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'LOCAL', MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 1, API_KEY: 'k' });

    const oldMainPage = deletionRows(1, 1000).map(({ id, ...rest }) => rest); // no id field
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { ok: true, data: oldMainPage }));

    await syncService.__test.pullDeletionChanges();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(configWrites).toContainEqual(['LAST_DELETE_PULL', '2026-09-24T06:00:00.000Z']);
  });
});

describe('sync key travels in a header, never in the URL', () => {
  const express = require('express');
  const request = require('supertest');

  function mountRouter(syncService) {
    const pool = schemaPool({ orders: ['id', 'updated_at', 'factory_id'] });
    syncService.__test.setRuntimeForTests({ pool, API_KEY: 'secret-key' });
    const app = express();
    app.use(express.json());
    app.use('/api/sync', syncService.router);
    return app;
  }

  it('LOCAL pulls send the key as x-sync-api-key and leave it out of the URL', async () => {
    const syncService = require('../services/sync.service');
    syncService.__test.setRuntimeForTests({ MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 1, API_KEY: 'secret-key' });
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { ok: true, data: [] }));

    await syncService.__test.pullTableAllPages('orders', '2026-09-24T00:00:00.000Z');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).not.toContain('secret-key');
    expect(url).not.toContain('apiKey');
    expect(options.headers['x-sync-api-key']).toBe('secret-key');
  });

  it('MAIN /pull and /pull-deletions reject a key in the query string', async () => {
    const syncService = require('../services/sync.service');
    const app = mountRouter(syncService);

    const pull = await request(app).get('/api/sync/pull?table=orders&since=2026-09-24&apiKey=secret-key');
    const del = await request(app).get('/api/sync/pull-deletions?since=2026-09-24&apiKey=secret-key');

    expect(pull.status).toBe(403);
    expect(del.status).toBe(403);
  });

  it('MAIN /pull and /pull-deletions accept the key from the header', async () => {
    const syncService = require('../services/sync.service');
    const app = mountRouter(syncService);

    const pull = await request(app).get('/api/sync/pull?table=orders&since=2026-09-24').set('x-sync-api-key', 'secret-key');
    const del = await request(app).get('/api/sync/pull-deletions?since=2026-09-24').set('x-sync-api-key', 'secret-key');

    expect(pull.status).toBe(200);
    expect(pull.body.ok).toBe(true);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
  });
});
