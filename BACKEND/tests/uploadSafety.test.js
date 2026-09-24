'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const request = require('supertest');

const USERS = {
  hr: { id: 1, username: 'hr', role_code: 'hr_manager', permissions: {}, global_access: false, is_active: true, logout_all_after: null },
  op: { id: 2, username: 'op', role_code: 'operator', permissions: {}, global_access: false, is_active: true, logout_all_after: null }
};

function makePool() {
  return {
    query: jest.fn(async (sql, params = []) => {
      if (String(sql).includes('FROM users')) {
        const u = USERS[params[0]];
        return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    })
  };
}

describe('extensionForUpload', () => {
  const { extensionForUpload } = require('../src/app/uploadSafety');

  it.each([
    ['photo.JPG', 'image/jpeg', '.jpg'],
    ['clip.mp4', 'video/mp4', '.mp4'],
    ['blob', 'image/jpeg', '.jpg'],              // phone camera, no extension
    ['image', 'image/webp', '.webp'],
    ['evil.html', 'image/png', '.png'],          // saved as the image type, never .html
    ['evil.html', 'text/html', null],
    ['evil.svg', 'image/svg+xml', null],
    ['evil.js', 'application/javascript', null],
    ['noext', 'application/octet-stream', null]
  ])('%s (%s) -> %s', (name, mime, expected) => {
    expect(extensionForUpload(name, mime)).toBe(expected);
  });
});

describe('private upload folders (resumes)', () => {
  let publicDir;
  let app;
  const originalSecret = process.env.JWT_SECRET;

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  beforeAll(() => {
    process.env.JWT_SECRET = 'upload-test-secret';
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-public-'));
    fs.mkdirSync(path.join(publicDir, 'uploads', 'interviews'), { recursive: true });
    fs.mkdirSync(path.join(publicDir, 'uploads', 'machines'), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'uploads', 'interviews', 'cv.pdf'), 'candidate resume');
    fs.writeFileSync(path.join(publicDir, 'uploads', 'machines', 'icon.png'), 'png');

    jest.resetModules();
    const auth = require('../src/app/auth');
    auth.__test.resetForTests();
    const { createPrivateUploadGuard } = require('../src/app/uploadSafety');
    const pool = makePool();

    // Same order as the app: root-mounted guard, then static handlers for all of PUBLIC
    // and for /uploads (as registerLegacyRoutes does).
    app = express();
    app.use(createPrivateUploadGuard(auth.createAuthMiddleware(pool)));
    app.post('/login-as/:user', async (req, res) => {
      await auth.issueSession(pool, req, res, USERS[req.params.user]);
      res.json({ ok: true });
    });
    app.use(express.static(publicDir));
    app.use('/uploads', express.static(path.join(publicDir, 'uploads')));
  });

  afterAll(() => fs.rmSync(publicDir, { recursive: true, force: true }));

  async function cookieFor(user) {
    const res = await request(app).post(`/login-as/${user}`);
    return res.headers['set-cookie'].find((c) => c.startsWith('jms_session=')).split(';')[0];
  }

  // Raw request so the path is sent exactly as written (no client-side normalisation).
  function rawGet(rawPath, cookie) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, () => {
        const req = http.request({ port: server.address().port, path: rawPath, method: 'GET', headers: cookie ? { cookie } : {} }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body }); });
        });
        req.on('error', (e) => { server.close(); reject(e); });
        req.end();
      });
    });
  }

  it.each([
    '/uploads/interviews/cv.pdf',
    '/UPLOADS/Interviews/cv.pdf',
    '/uploads/interviews%2Fcv.pdf',
    '/uploads/INTERVIEWS/cv.pdf',
    '//uploads/interviews/cv.pdf',
    '/./uploads/interviews/cv.pdf',
    '/uploads/./interviews/cv.pdf',
    '/uploads/machines/../interviews/cv.pdf',
    '/uploads%2finterviews%2fcv.pdf'
  ])('never serves a resume without a session: %s', async (rawPath) => {
    const res = await rawGet(rawPath);
    expect(res.body).not.toContain('candidate resume');
    expect(res.status).not.toBe(200);
  });

  it('refuses a logged-in non-HR user', async () => {
    const res = await rawGet('/uploads/interviews/cv.pdf', await cookieFor('op'));
    expect(res.status).toBe(403);
  });

  it('serves the resume to HR', async () => {
    const res = await rawGet('/uploads/interviews/cv.pdf', await cookieFor('hr'));
    expect(res.status).toBe(200);
    expect(res.body).toBe('candidate resume');
  });

  it('leaves public uploads (machine icons) public', async () => {
    const res = await rawGet('/uploads/machines/icon.png');
    expect(res.status).toBe(200);
  });
});

describe('sync upload-asset', () => {
  function mountSync() {
    jest.resetModules();
    const syncService = require('../services/sync.service');
    syncService.__test.setRuntimeForTests({ pool: { query: jest.fn() }, API_KEY: 'k' });
    const app = express();
    app.use(express.json());
    app.use('/api/sync', syncService.router);
    return app;
  }

  it.each(['evil.html', 'evil.svg', 'payload.js', '..'])('rejects %s', async (filename) => {
    const res = await request(mountSync()).post('/api/sync/upload-asset')
      .send({ apiKey: 'k', folder: 'machines', filename, data: Buffer.from('x').toString('base64') });
    expect(res.status).toBe(400);
  });

  it('rejects writes into the private resumes folder', async () => {
    const res = await request(mountSync()).post('/api/sync/upload-asset')
      .send({ apiKey: 'k', folder: 'interviews', filename: 'cv.png', data: Buffer.from('x').toString('base64') });
    expect(res.status).toBe(400);
  });
});

describe('QC APK temp upload is never served', () => {
  it('the app static handlers ignore the .upload-*.apk temp name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-qcapp-'));
    try {
      fs.mkdirSync(path.join(dir, 'qc-app'));
      fs.writeFileSync(path.join(dir, 'qc-app', '.upload-123-abc.apk'), 'attacker apk');
      const createPrecompressedStatic = require('../src/app/precompressedStatic');
      const app = express();
      // Same handlers and options registerLegacyRoutes uses for PUBLIC.
      app.use(createPrecompressedStatic(dir, () => 'public, max-age=60'));
      app.use(express.static(dir, { setHeaders: () => {} }));

      const res = await request(app).get('/qc-app/.upload-123-abc.apk');

      expect(res.status).toBe(404);
      expect(res.text || '').not.toContain('attacker apk');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
