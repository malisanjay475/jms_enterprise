'use strict';

// Factory access (user_factories) is decided on MAIN only.

const express = require('express');
const request = require('supertest');
const sync = require('../services/sync.service');

const runtime = (pool, SERVER_TYPE) => sync.__test.setRuntimeForTests({
  pool, SERVER_TYPE, MAIN_SERVER_URL: 'http://main.example', LOCAL_FACTORY_ID: 2, API_KEY: 'test-key'
});

describe('factory access sync', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('a LOCAL drops parked access rows without sending them', async () => {
    const pool = {
      query: jest.fn(async (sql) => ({
        rows: String(sql).includes('SELECT DISTINCT table_name') ? [{ table_name: 'user_factories' }] : []
      }))
    };
    runtime(pool, 'LOCAL');
    global.fetch = jest.fn();
    await sync.__test.drainOutbox();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM sync_failed_rows WHERE table_name = $1', ['user_factories']);
  });

  it('MAIN ignores access rows and deletions from an older LOCAL, and answers OK so it stops retrying', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }), connect: jest.fn().mockResolvedValue(client) };
    runtime(pool, 'MAIN');
    const app = express().use(express.json()).use(sync.router);
    const pushed = await request(app).post('/push').send({
      apiKey: 'test-key', factoryId: 2, table: 'user_factories', data: [{ user_id: 9, factory_id: 2 }]
    });
    expect(pushed.body).toMatchObject({ ok: true, rows: 1, partialFailures: false, stats: { failed: 0 } });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();

    const removed = await request(app).post('/push-deletions').send({
      apiKey: 'test-key', deletions: [{ table: 'user_factories', record_pk: '{"user_id":9,"factory_id":2}' }]
    });
    expect(removed.body).toMatchObject({ ok: true, rows: 0 });
    const sql = [...client.query.mock.calls, ...pool.query.mock.calls].map((c) => String(c[0])).join('\n');
    expect(sql).not.toContain('user_factories');
  });

  it('still needs the sync key', async () => {
    runtime({ query: jest.fn() }, 'MAIN');
    const app = express().use(express.json()).use(sync.router);
    await request(app).post('/push').send({ apiKey: 'wrong', table: 'user_factories', data: [] }).expect(403);
  });
});
