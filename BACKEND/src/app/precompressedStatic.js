'use strict';

const fs = require('fs');
const path = require('path');

// Serve pre-compressed (.br / .gz) siblings of static text assets when the
// client supports them. This is a pure win on the factory LOCAL box:
//   - Payload is smaller than on-the-fly gzip level 6 (Brotli q11 ≈ -20-25%).
//   - The CPU cost of compressing moves from request-time to build/boot-time,
//     so a weak factory PC no longer re-gzips big JS on every cache miss.
//
// Safety / design:
//   - The request path is NEVER used to build a filesystem path. Instead we
//     build a manifest by scanning the public dir (readdir) and use the request
//     path only as an exact-match key into that manifest. The absolute file path
//     handed to fs comes from the directory listing, so there is no path
//     injection surface (and no per-request stat of an attacker-controlled path).
//   - A pre-compressed file is used ONLY if it is newer than its source, so a
//     freshly synced/updated asset is never served as stale compressed bytes —
//     it just falls through to express.static (+ compression) until recompressed.
//   - The manifest is rebuilt on a short TTL so assets added/updated after boot
//     (e.g. a LOCAL file sync) are picked up without a restart.
//   - Sets Content-Encoding + Vary so proxies/browsers cache correctly. The
//     downstream `compression` middleware skips responses that already carry a
//     Content-Encoding, so there is no double-encoding.

const CONTENT_TYPES = {
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8'
};
const MANIFEST_TTL_MS = 60 * 1000;

function pickEncoding(acceptEncoding) {
  const ae = String(acceptEncoding || '').toLowerCase();
  if (ae.includes('br')) return { enc: 'br', ext: '.br' };
  if (ae.includes('gzip')) return { enc: 'gzip', ext: '.gz' };
  return null;
}

// Walk the public dir and index every .js/.css source that has fresh .br/.gz
// siblings. Keys are URL paths ('/assets/app.js'); values hold only
// filesystem-derived absolute paths and sizes — never anything user-supplied.
function buildManifest(root) {
  const manifest = new Map();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!CONTENT_TYPES[ext]) continue;

      let srcStat;
      try { srcStat = fs.statSync(full); } catch { continue; }

      const variants = {};
      for (const [enc, cext] of [['br', '.br'], ['gzip', '.gz']]) {
        try {
          const cStat = fs.statSync(full + cext);
          if (cStat.mtimeMs >= srcStat.mtimeMs) {
            variants[enc] = { file: full + cext, size: cStat.size };
          }
        } catch { /* no such variant */ }
      }
      if (!variants.br && !variants.gzip) continue;

      const urlPath = '/' + path.relative(root, full).split(path.sep).join('/');
      manifest.set(urlPath, {
        type: CONTENT_TYPES[ext],
        lastModified: srcStat.mtime.toUTCString(),
        variants
      });
    }
  }
  return manifest;
}

function createPrecompressedStatic(publicDir, cacheControlFor) {
  const root = path.resolve(publicDir);
  let manifest = new Map();
  let builtAt = 0;

  function getManifest() {
    if (Date.now() - builtAt > MANIFEST_TTL_MS) {
      manifest = buildManifest(root);
      builtAt = Date.now();
    }
    return manifest;
  }

  return function precompressedStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const choice = pickEncoding(req.headers['accept-encoding']);
    if (!choice) return next();

    // req.path is used ONLY as an exact-match key — never to build an FS path.
    const entry = getManifest().get(req.path);
    if (!entry) return next();

    const variant = entry.variants[choice.enc];
    if (!variant) return next();

    res.setHeader('Content-Type', entry.type);
    res.setHeader('Content-Encoding', choice.enc);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', variant.size);
    res.setHeader('Last-Modified', entry.lastModified);
    if (typeof cacheControlFor === 'function') {
      const cc = cacheControlFor(req);
      if (cc) res.setHeader('Cache-Control', cc);
    }

    if (req.method === 'HEAD') return res.end();

    // variant.file comes from readdir/statSync above — not from the request.
    const stream = fs.createReadStream(variant.file);
    stream.on('error', (err) => {
      if (!res.headersSent) { res.removeHeader('Content-Encoding'); next(err); }
      else res.destroy();
    });
    stream.pipe(res);
  };
}

module.exports = createPrecompressedStatic;
