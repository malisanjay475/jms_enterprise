'use strict';

// The Sep-2026 audit flagged handlers echoing raw error messages (SQL text, DB
// driver detail) back to API clients. sendServerError() must never leak that in
// production, while still logging the full error server-side.

function loadFresh(env) {
  jest.resetModules();
  const prev = { NODE_ENV: process.env.NODE_ENV, EXPOSE_ERRORS: process.env.EXPOSE_ERRORS };
  process.env.NODE_ENV = env.NODE_ENV;
  if (env.EXPOSE_ERRORS === undefined) delete process.env.EXPOSE_ERRORS;
  else process.env.EXPOSE_ERRORS = env.EXPOSE_ERRORS;
  const mod = require('../src/app/httpErrors');
  return { mod, restore: () => { process.env.NODE_ENV = prev.NODE_ENV; if (prev.EXPOSE_ERRORS === undefined) delete process.env.EXPOSE_ERRORS; else process.env.EXPOSE_ERRORS = prev.EXPOSE_ERRORS; } };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('sendServerError', () => {
  let logSpy;
  beforeEach(() => { logSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  it('hides internal detail in production', () => {
    const { mod, restore } = loadFresh({ NODE_ENV: 'production' });
    try {
      const res = fakeRes();
      mod.sendServerError(res, new Error('SELECT secret FROM users WHERE id=1'));
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ ok: false, error: 'Internal server error' });
      expect(res.body.error).not.toMatch(/SELECT|users/);
    } finally { restore(); }
  });

  it('still logs the full error server-side', () => {
    const { mod, restore } = loadFresh({ NODE_ENV: 'production' });
    try {
      mod.sendServerError(fakeRes(), new Error('boom detail'));
      expect(logSpy).toHaveBeenCalled();
      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toMatch(/boom detail/);
    } finally { restore(); }
  });

  it('exposes detail when EXPOSE_ERRORS=1', () => {
    const { mod, restore } = loadFresh({ NODE_ENV: 'production', EXPOSE_ERRORS: '1' });
    try {
      const res = fakeRes();
      mod.sendServerError(res, new Error('detail here'));
      expect(res.body).toEqual({ ok: false, error: 'detail here' });
    } finally { restore(); }
  });

  it('exposes detail outside production (dev)', () => {
    const { mod, restore } = loadFresh({ NODE_ENV: 'development' });
    try {
      const res = fakeRes();
      mod.sendServerError(res, new Error('dev detail'));
      expect(res.body.error).toBe('dev detail');
    } finally { restore(); }
  });

  it('honours a custom status code', () => {
    const { mod, restore } = loadFresh({ NODE_ENV: 'production' });
    try {
      const res = fakeRes();
      mod.sendServerError(res, new Error('x'), 503);
      expect(res.statusCode).toBe(503);
    } finally { restore(); }
  });
});
