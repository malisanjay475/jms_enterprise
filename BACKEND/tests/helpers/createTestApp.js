'use strict';

const express = require('express');

function createTestApp() {
  // Set test env before loading config — no real DB needed
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

  // Mock DB pool — no real Postgres connection
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined)
  };

  // Mock all services with empty Express routers
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
  return { app, pool, config };
}

module.exports = { createTestApp };
