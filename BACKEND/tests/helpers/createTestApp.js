'use strict';

const express = require('express');

function createTestApp() {
  // Snapshot env before mutation so it can be restored in afterAll
  const _originalEnv = { ...process.env };

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '3099',
    DB_HOST: '127.0.0.1',
    DB_PORT: '5432',
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    DB_NAME: 'test_jms',
    SERVER_TYPE: 'STANDALONE',
    LOCAL_FACTORY_ID: '1',
    SYNC_API_KEY: 'test-key'
  });

  const loadConfig = require('../../src/config/loadConfig');
  const createApp = require('../../src/app/createApp');

  const config = loadConfig();

  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined)
  };

  const mockRouter = express.Router();
  mockRouter.use((req, res) => res.status(404).json({ ok: false }));

  const services = {
    aiService: {},
    erpRoutes: mockRouter,
    vendorRoutes: mockRouter,
    localServerService: {
      router: mockRouter,
      init: jest.fn().mockResolvedValue(undefined)
    },
    syncService: { router: mockRouter },
    updaterService: { router: mockRouter },
    localNodeAgent: { init: jest.fn().mockResolvedValue(undefined) }
  };

  const { app } = createApp({ config, pool, services });

  // Call this in afterAll() to prevent env leaking between test suites
  function restoreEnv() {
    for (const key of Object.keys(process.env)) {
      if (!(key in _originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, _originalEnv);
  }

  return { app, pool, config, restoreEnv };
}

module.exports = { createTestApp };
