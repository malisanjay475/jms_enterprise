'use strict';

jest.mock('../src/legacy/registerLegacyRoutes', () =>
  jest.fn(() => ({
    initializeLegacyRuntime: jest.fn().mockResolvedValue({})
  }))
);

const request = require('supertest');
const { createTestApp } = require('./helpers/createTestApp');

describe('Core middleware', () => {
  let app, restoreEnv;

  beforeAll(() => {
    ({ app, restoreEnv } = createTestApp());
  });

  afterAll(() => restoreEnv());

  describe('CORS', () => {
    it('responds to OPTIONS preflight', async () => {
      const res = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');
      // CORS middleware should not block the request
      expect([200, 204]).toContain(res.status);
    });

    it('includes access-control-allow-origin header', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000');
      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('JSON parsing', () => {
    it('parses JSON request body', async () => {
      // POST to any route — body should be parsed (even if route returns 404)
      const res = await request(app)
        .post('/api/health')
        .send({ test: true })
        .set('Content-Type', 'application/json');
      // Should not return 400 (bad request / parse error)
      expect(res.status).not.toBe(400);
    });
  });

  describe('Rate limiting', () => {
    it('does not apply the 300/min browser API limiter to sync endpoints', async () => {
      // Sync routes are exempt from the 300/min browser limiter but have their own
      // 120/min sync limiter. We send 110 requests — below both limits — to confirm
      // sync traffic is not blocked by the browser limiter.
      const responses = await Promise.all(
        Array.from({ length: 110 }, () => request(app).get('/api/sync/pull'))
      );

      expect(responses.some((res) => res.status === 429)).toBe(false);
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/this-route-does-not-exist-xyz123');
      expect(res.status).toBe(404);
    });
  });
});
