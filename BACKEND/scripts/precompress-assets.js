'use strict';

// Pre-compress static text assets (.js/.css) to Brotli (.br) and Gzip (.gz)
// siblings so the server can serve them directly instead of compressing on
// every request. Idempotent: a target is (re)written only when the source
// CONTENT changes (tracked by a sha256 manifest), so restarts are cheap and a
// deploy that ships new source always regenerates the compressed siblings.
//
// Content hashing (not mtime) is deliberate: across Docker deploys a stale
// .br/.gz on a persisted asset volume can carry an mtime >= the freshly
// deployed source, which made the old mtime check skip regeneration and serve
// stale brotli to browsers indefinitely.
//
// Run manually:   node scripts/precompress-assets.js
// Runs on boot:   invoked (fire-and-forget) from startServer after listen.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const EXTS = new Set(['.js', '.css']);
const MIN_BYTES = 512; // tiny files aren't worth a separate request/decompress
const MANIFEST_NAME = '.precompress-manifest.json';

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

function loadManifest(manifestPath) {
  try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { return {}; }
}

function precompressAssets(publicDir) {
  const root = path.resolve(publicDir);
  const manifestPath = path.join(root, MANIFEST_NAME);
  const manifest = loadManifest(manifestPath);
  const nextManifest = {};
  const files = walk(root, []);
  let written = 0, skipped = 0;

  for (const file of files) {
    const srcStat = fs.statSync(file);
    if (srcStat.size < MIN_BYTES) continue;
    const data = fs.readFileSync(file);
    const rel = path.relative(root, file);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    nextManifest[rel] = hash;

    const gzPath = file + '.gz';
    const brPath = file + '.br';
    // Regenerate when content changed, or either sibling is missing on disk.
    const fresh = manifest[rel] === hash && fs.existsSync(gzPath) && fs.existsSync(brPath);
    if (fresh) { skipped++; continue; }

    fs.writeFileSync(gzPath, zlib.gzipSync(data, { level: 9 }));
    fs.writeFileSync(brPath, zlib.brotliCompressSync(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length
      }
    }));
    written++;
  }

  try { fs.writeFileSync(manifestPath, JSON.stringify(nextManifest)); }
  catch { /* manifest is an optimization; serving still works without it */ }

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
