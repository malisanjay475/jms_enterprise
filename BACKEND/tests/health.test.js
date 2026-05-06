'use strict';

// Mock legacy routes — 469 lines of business routes, tested separately
jest.mock('../src/legacy/registerLegacyRoutes', () =>
  jest.fn(() => ({
    initializeLegacyRuntime: jest.fn().mockResolvedValue({})
  }))
);

const request = require('supertest');
const { createTestApp } = require('./helpers/createTestApp');

describe('Health endpoints', () => {
  let app;

  beforeAll(() => {
    ({ app } = createTestApp());
  });

  describe('GET /health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('returns ok: true', async () => {
      const res = await request(app).get('/health');
      expect(res.body.ok).toBe(true);
    });

    it('returns service name', async () => {
      const res = await request(app).get('/health');
      expect(res.body.service).toBe('jms-backend');
    });

    it('returns status: healthy', async () => {
      const res = await request(app).get('/health');
      expect(res.body.status).toBe('healthy');
    });

    it('returns JSON content-type', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('GET /api/health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('returns ok: true', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.ok).toBe(true);
    });

    it('returns db connection info', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.db).toBeDefined();
      expect(res.body.db.host).toBeDefined();
      expect(res.body.db.database).toBeDefined();
      expect(res.body.db.port).toBeDefined();
    });
  });
});
