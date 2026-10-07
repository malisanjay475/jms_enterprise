'use strict';

const express = require('express');
const request = require('supertest');
const { blockRetiredPublicFiles } = require('../src/app/registerRoutes');

// Internal code maps moved out of PUBLIC; factory servers keep old copies on disk.
function buildApp() {
  const app = express();
  app.use(blockRetiredPublicFiles);
  app.use((req, res) => res.json({ ok: true, path: req.path }));
  return app;
}

describe('retired public files', () => {
  it.each([
    '/api-inventory.json',
    '/graphify-graph.json',
    '/graph-view.html',
    '/API-INVENTORY.JSON',
    '//graph-view.html',
    '/./graphify-graph.json',
    '/api-inventory%2Ejson'
  ])('%s -> 404', async (p) => {
    const res = await request(buildApp()).get(p);
    expect(res.status).toBe(404);
  });

  it.each(['/analyze.html', '/joy.html', '/dpr.html', '/api/health'])('%s still served', async (p) => {
    const res = await request(buildApp()).get(p);
    expect(res.status).toBe(200);
  });
});
