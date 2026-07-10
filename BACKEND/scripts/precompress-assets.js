'use strict';

// Pre-compress static text assets (.js/.css) to Brotli (.br) and Gzip (.gz)
// siblings so the server can serve them directly instead of compressing on
// every request. Idempotent: a target is (re)written only when the source is
// newer, so restarts are cheap and re-runs after a file sync only touch what
// changed.
//
// Run manually:   node scripts/precompress-assets.js
// Runs on boot:   invoked (fire-and-forget) from startServer after listen.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EXTS = new Set(['.js', '.css']);
const MIN_BYTES = 512; // tiny files aren't worth a separate request/decompress

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

function isFresh(target, srcStat) {
  try { return fs.statSync(target).mtimeMs >= srcStat.mtimeMs; }
  catch { return false; }
}

function precompressAssets(publicDir) {
  const root = path.resolve(publicDir);
  const files = walk(root, []);
  let written = 0, skipped = 0;

  for (const file of files) {
    const srcStat = fs.statSync(file);
    if (srcStat.size < MIN_BYTES) continue;
    const data = fs.readFileSync(file);

    const gzPath = file + '.gz';
    if (!isFresh(gzPath, srcStat)) {
      fs.writeFileSync(gzPath, zlib.gzipSync(data, { level: 9 }));
      written++;
    } else skipped++;

    const brPath = file + '.br';
    if (!isFresh(brPath, srcStat)) {
      fs.writeFileSync(brPath, zlib.brotliCompressSync(data, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length
        }
      }));
      written++;
    } else skipped++;
  }
  return { files: files.length, written, skipped };
}

module.exports = precompressAssets;

if (require.main === module) {
  const publicDir = process.argv[2]
    || path.join(__dirname, '..', 'PUBLIC');
  const t0 = Date.now();
  const r = precompressAssets(publicDir);
  console.log(`[precompress] ${r.files} assets, ${r.written} written, ${r.skipped} up-to-date in ${Date.now() - t0}ms`);
}
