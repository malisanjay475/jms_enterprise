'use strict';

const fs = require('fs');
const path = require('path');

// Serve pre-compressed (.br / .gz) siblings of static text assets when the
// client supports them. This is a pure win on the factory LOCAL box:
//   - Payload is smaller than on-the-fly gzip level 6 (Brotli q11 ≈ -20-25%).
//   - The CPU cost of compressing moves from request-time to build/boot-time,
//     so a weak factory PC no longer re-gzips big JS on every cache miss.
//
// Safety:
//   - Only GET/HEAD for .js/.css under the public dir (no traversal, no API).
//   - A pre-compressed file is used ONLY if it is newer than its source, so a
//     freshly synced/updated asset is never served as stale compressed bytes —
//     it just falls through to express.static (+ compression) until recompressed.
//   - Sets Content-Encoding + Vary so proxies/browsers cache correctly. The
//     downstream `compression` middleware skips responses that already carry a
//     Content-Encoding, so there is no double-encoding.

const CONTENT_TYPES = {
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8'
};

function pickEncoding(acceptEncoding) {
  const ae = String(acceptEncoding || '').toLowerCase();
  if (ae.includes('br')) return { enc: 'br', ext: '.br' };
  if (ae.includes('gzip')) return { enc: 'gzip', ext: '.gz' };
  return null;
}

function createPrecompressedStatic(publicDir, cacheControlFor) {
  const root = path.resolve(publicDir);

  return function precompressedStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const ext = path.extname(req.path).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) return next();

    const choice = pickEncoding(req.headers['accept-encoding']);
    if (!choice) return next();

    // Resolve the request path safely inside the public dir (block traversal).
    const decoded = decodeURIComponent(req.path);
    const sourcePath = path.resolve(root, '.' + decoded);
    if (sourcePath !== root && !sourcePath.startsWith(root + path.sep)) return next();

    const compressedPath = sourcePath + choice.ext;

    let srcStat, cmpStat;
    try {
      srcStat = fs.statSync(sourcePath);
      cmpStat = fs.statSync(compressedPath);
    } catch (_e) {
      return next(); // no source or no precompressed sibling → let express.static handle it
    }
    // Never serve a stale precompressed file (source changed after compression).
    if (cmpStat.mtimeMs < srcStat.mtimeMs) return next();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Encoding', choice.enc);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', cmpStat.size);
    res.setHeader('Last-Modified', srcStat.mtime.toUTCString());
    if (typeof cacheControlFor === 'function') {
      const cc = cacheControlFor(req);
      if (cc) res.setHeader('Cache-Control', cc);
    }

    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(compressedPath);
    stream.on('error', (err) => {
      if (!res.headersSent) { res.removeHeader('Content-Encoding'); next(err); }
      else res.destroy();
    });
    stream.pipe(res);
  };
}

module.exports = createPrecompressedStatic;
