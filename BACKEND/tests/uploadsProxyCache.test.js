'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { cacheTargetFor, saveCopy } = require('../src/app/uploadsProxyCache');

describe('Uploads proxy: which files are kept locally', () => {
  const root = path.resolve(os.tmpdir(), 'jms-uploads-root');

  it('keeps public images, with their real file name', () => {
    expect(cacheTargetFor(root, '/uploads/machines/machine_1780982808749_20.png'))
      .toBe(path.join(root, 'machines', 'machine_1780982808749_20.png'));
    expect(cacheTargetFor(root, '/uploads/machines/Machine_A.PNG')).toBe(path.join(root, 'machines', 'Machine_A.PNG'));
  });

  it('never keeps private, non-image or escaping paths', () => {
    for (const p of [
      '/uploads/interviews/cv.png',
      '/uploads/Interviews/cv.png',
      '/uploads/machines/../interviews/cv.png',
      '/uploads/machines/%2e%2e/%2e%2e/secret.png',
      '/uploads/machines/..%5c..%5csecret.png',
      '/uploads/machines/doc.pdf',
      '/uploads/qc-images/a%20b.jpg',
      '/other/x.png',
      '/uploads/%E0%A4%A.png'
    ]) {
      expect(cacheTargetFor(root, p)).toBeNull();
    }
  });
});

describe('Uploads proxy: fetch once, then serve from disk', () => {
  let dir;
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

  it('writes the fetched image atomically and express.static serves the copy', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-uploads-'));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const upstream = jest.fn(async () => png);

    const app = express();
    app.use('/uploads', express.static(dir));
    app.get('/uploads/*path', async (req, res) => {
      const target = cacheTargetFor(dir, req.path);
      const body = await upstream();
      if (target) saveCopy(target, body);
      res.type('png').end(body);
    });

    const first = await request(app).get('/uploads/machines/machine_1_2.png');
    expect(first.status).toBe(200);
    const second = await request(app).get('/uploads/machines/machine_1_2.png');
    expect(second.status).toBe(200);
    expect(Buffer.compare(second.body, png)).toBe(0);
    expect(upstream).toHaveBeenCalledTimes(1); // second request came from disk
    expect(fs.readdirSync(path.join(dir, 'machines'))).toEqual(['machine_1_2.png']); // no .part left
  });

  it('refuses empty or oversized bodies', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-uploads-'));
    expect(saveCopy(path.join(dir, 'a.png'), Buffer.alloc(0))).toBe(false);
    expect(saveCopy(path.join(dir, 'b.png'), Buffer.alloc(11 * 1024 * 1024))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
