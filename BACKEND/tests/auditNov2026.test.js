'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { findGuard } = require('../src/app/routeGuards');
const { isMissingFileRequest } = require('../src/app/spaFallback');
const { dprSlotKey, withDprSlotLock } = require('../src/app/dprSlotLock');
const { __test: { applyReleaseZip } } = require('../services/updater.service');

describe('Nov-2026 audit fixes', () => {
  it('locks writes that had no check', () => {
    for (const [m, p, need] of [
      ['POST', '/api/settings', 'session'], ['POST', '/API/Settings', 'session'],
      ['POST', '/api/admin/sync/reset-pull', 'admin'], ['POST', '/api/admin/restore-closed-orders', 'admin'],
      ['DELETE', '/api/admin/close-plant/5', 'session'], ['POST', '/api/roles/create', 'manageUsers'],
      ['POST', '/api/hr/operators/delete', 'session'], ['POST', '/api/planning/stop', 'session'],
      ['DELETE', '/api/assembly/lines/B9', 'session'], ['POST', '/api/sync/force-full-push', 'session']
    ]) expect(findGuard(m, p)).toMatchObject({ need });
  });

  it('keeps floor, sync and device routes open', () => {
    for (const [m, p] of [
      ['POST', '/api/dpr/submit'], ['POST', '/api/std-actual/save'], ['POST', '/api/shift/team'],
      ['POST', '/api/planning/switch-priority-job'], ['POST', '/api/planning/create'],
      ['GET', '/api/settings'], ['GET', '/api/assembly/lines'], ['POST', '/api/assembly/device-scan'],
      ['POST', '/api/assembly/scan'], ['POST', '/api/sync/push']
    ]) expect(findGuard(m, p)).toBeNull();
  });

  it('answers 404 for missing files, the home page for pages', () => {
    for (const p of ['/assets/vendor/x/y.min.js', '/uploads/a.jpg', '/.env', '/.git/config', '/package.json']) {
      expect(isMissingFileRequest(p)).toBe(true);
    }
    for (const p of ['/', '/planning', '/old-page.html']) expect(isMissingFileRequest(p)).toBe(false);
  });

  it('moves a file aside when the release needs a folder there', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-block-'));
    try {
      fs.writeFileSync(path.join(root, 'lib@2.0.0'), 'old');
      const zip = new AdmZip();
      zip.addFile('lib@2.0.0/a.min.js', Buffer.from('new'));
      applyReleaseZip(new AdmZip(zip.toBuffer()), root);
      expect(fs.readFileSync(path.join(root, 'lib@2.0.0', 'a.min.js'), 'utf8')).toBe('new');
      const aside = fs.readdirSync(root).find((f) => f.startsWith('lib@2.0.0.replaced-'));
      expect(fs.readFileSync(path.join(root, aside), 'utf8')).toBe('old');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('locks per factory + slot, rolls back and releases on error', async () => {
    expect(dprSlotKey(1, 'M1', '2026-11-24', 'Day', '01-02')).not.toBe(dprSlotKey(2, 'M1', '2026-11-24', 'Day', '01-02'));
    const calls = [];
    const client = { query: jest.fn(async (s) => { calls.push(s); return { rows: [] }; }), release: jest.fn() };
    const pool = { connect: async () => client };
    expect(await withDprSlotLock(pool, 'k', async (lq) => { await lq('X'); return 7; })).toBe(7);
    expect(calls.findIndex((s) => s.includes('advisory'))).toBeLessThan(calls.indexOf('X'));
    expect(calls[calls.length - 1]).toBe('COMMIT');
    await expect(withDprSlotLock(pool, 'k', async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(calls[calls.length - 1]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(2);
  });
});
