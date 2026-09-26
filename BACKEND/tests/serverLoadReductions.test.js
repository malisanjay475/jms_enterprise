'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const { cacheControlForAsset } = require('../src/app/staticCachePolicy');
const createPrecompressedStatic = require('../src/app/precompressedStatic');

describe('Static cache policy', () => {
  it('makes our own JS/CSS revalidate, keeps long caching for vendor libs, fonts and images', () => {
    expect(cacheControlForAsset('/assets/app.min.js')).toBe('no-cache');
    expect(cacheControlForAsset('/assets/supervisor-script-1.js')).toBe('no-cache');
    expect(cacheControlForAsset(['D:', 'x', 'PUBLIC', 'assets', 'app.css'].join('\\'))).toBe('no-cache');
    expect(cacheControlForAsset('/assets/vendor/jquery/3.7.1/jquery.min.js')).toMatch(/immutable/);
    expect(cacheControlForAsset('/planning.html')).toMatch(/max-age=300/);
    expect(cacheControlForAsset('/assets/fonts/inter.woff2')).toBe('public, max-age=604800');
    expect(cacheControlForAsset('/assets/jms-logo.png')).toBe('public, max-age=604800');
  });
});

describe('Precompressed static: conditional GET', () => {
  let dir;
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

  function setup() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-static-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    const src = path.join(dir, 'assets', 'app.js');
    fs.writeFileSync(src, 'console.log(1)');
    fs.writeFileSync(src + '.br', Buffer.from([1, 2, 3]));
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(src, past, past);
    const app = express();
    app.use(createPrecompressedStatic(dir, (req) => cacheControlForAsset(req.path)));
    return { app, mtime: past };
  }

  it('answers 304 when the browser copy is current, 200 with the file otherwise', async () => {
    const { app, mtime } = setup();
    const first = await request(app).get('/assets/app.js').set('Accept-Encoding', 'br');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-cache');
    const lm = first.headers['last-modified'];
    expect(lm).toBe(mtime.toUTCString());

    const again = await request(app).get('/assets/app.js').set('Accept-Encoding', 'br').set('If-Modified-Since', lm);
    expect(again.status).toBe(304);

    const stale = await request(app).get('/assets/app.js').set('Accept-Encoding', 'br')
      .set('If-Modified-Since', new Date(mtime.getTime() - 3600000).toUTCString());
    expect(stale.status).toBe(200);
  });
});

describe('Background tabs stop polling (app.js heartbeat)', () => {
  const APP_JS = fs.readFileSync(path.join(__dirname, '../PUBLIC/assets/app.js'), 'utf8');
  const start = APP_JS.indexOf('(function initActivityHeartbeat()');
  const end = APP_JS.indexOf('}());', start) + '}());'.length;
  const SNIPPET = APP_JS.slice(start, end);

  function run({ hidden }) {
    const timers = [];
    const listeners = {};
    const document = {
      hidden,
      readyState: 'complete',
      addEventListener: (ev, fn) => { listeners[ev] = fn; }
    };
    const calls = [];
    const fetch = (url, opts) => { calls.push(JSON.parse(opts.body).action); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    const localStorage = { getItem: (k) => (k === 'user' ? JSON.stringify({ username: 'ravi' }) : null) };
    const window = { location: { pathname: '/planning.html' }, addEventListener: () => {}, crypto: { getRandomValues: (a) => a } };
    let clock = 1000000;
    const FakeDate = { now: () => clock };
    vm.runInNewContext(SNIPPET, {
      window, document, fetch, localStorage, navigator: { userAgent: 'test' }, sessionStorage: { getItem: () => null, setItem: () => {} },
      setInterval: (fn, ms) => timers.push({ fn, ms }), Date: Object.assign(function () { return new Date(); }, FakeDate),
      Uint32Array, JSON, String, Number, Math, console
    });
    return { calls, timers, listeners, document, tick: (ms) => { clock += ms; } };
  }

  it('sends no heartbeat from a hidden tab, and catches up when it becomes visible', () => {
    const t = run({ hidden: true });
    const heartbeatTimer = t.timers.find((x) => x.ms === 60000);
    expect(heartbeatTimer).toBeDefined();
    const before = t.calls.filter((a) => a === 'heartbeat').length;
    heartbeatTimer.fn();
    heartbeatTimer.fn();
    expect(t.calls.filter((a) => a === 'heartbeat').length).toBe(before);

    t.tick(61000);
    t.document.hidden = false;
    t.listeners.visibilitychange();
    expect(t.calls.filter((a) => a === 'heartbeat').length).toBe(before + 1);
  });

  it('keeps the normal 60 s heartbeat while visible', () => {
    const t = run({ hidden: false });
    const heartbeatTimer = t.timers.find((x) => x.ms === 60000);
    heartbeatTimer.fn();
    expect(t.calls.filter((a) => a === 'heartbeat').length).toBe(1);
  });
});
