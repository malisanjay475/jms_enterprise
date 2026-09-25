'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { __test: { applyReleaseZip } } = require('../services/updater.service');

function makeRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-release-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function makeZip(files) {
  const zip = new AdmZip();
  for (const [rel, content] of Object.entries(files)) zip.addFile(rel, Buffer.from(content));
  return new AdmZip(zip.toBuffer());
}

describe('Updater: apply release zip', () => {
  const current = {
    'BACKEND/server.js': 'server v2',
    'BACKEND/services/sync.service.js': 'sync v2',
    'BACKEND/PUBLIC/assets/app.js': 'app v2'
  };
  let root;
  afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));

  it('needs no restart when the per-file updater already copied the code', () => {
    root = makeRoot({ ...current, 'BACKEND/runtime-release.json': '{"releaseId":"1.0.0+old"}' });
    const result = applyReleaseZip(makeZip({
      ...current,
      'BACKEND/runtime-release.json': '{"releaseId":"1.0.1+new"}',
      'RELEASE_MANIFEST.json': '{"releaseId":"1.0.1+new"}',
      'BACKEND/PUBLIC/assets/app.js.br': 'compressed v2',
      'BACKEND/PUBLIC/assets/app.min.js': 'min v2'
    }), root);
    expect(result.codeChanged).toBe(0);
    expect(result.written).toBe(4); // metadata + derived assets are still written
    expect(JSON.parse(fs.readFileSync(path.join(root, 'BACKEND/runtime-release.json'), 'utf8')).releaseId).toBe('1.0.1+new');
    expect(fs.readFileSync(path.join(root, 'BACKEND/PUBLIC/assets/app.js.br'), 'utf8')).toBe('compressed v2');
  });

  it('restarts when code in the package differs from disk', () => {
    root = makeRoot(current);
    const result = applyReleaseZip(makeZip({ ...current, 'BACKEND/services/sync.service.js': 'sync v3' }), root);
    expect(result).toEqual({ written: 1, codeChanged: 1 });
    expect(fs.readFileSync(path.join(root, 'BACKEND/services/sync.service.js'), 'utf8')).toBe('sync v3');
  });

  it('creates new files and folders', () => {
    root = makeRoot(current);
    const result = applyReleaseZip(makeZip({ 'BACKEND/src/app/newModule.js': 'new' }), root);
    expect(result.codeChanged).toBe(1);
    expect(fs.existsSync(path.join(root, 'BACKEND/src/app/newModule.js'))).toBe(true);
  });

  it('refuses entries that would land outside the package root', () => {
    root = makeRoot(current);
    const zip = makeZip({ 'BACKEND/x.js': 'x' });
    zip.getEntries()[0].entryName = '../escape.js';
    expect(() => applyReleaseZip(zip, root)).toThrow(/outside package root/);
    expect(fs.existsSync(path.join(path.dirname(root), 'escape.js'))).toBe(false);
  });
});
