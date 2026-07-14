'use strict';

// Minify PUBLIC/assets/*.js to .min.js siblings with esbuild.
// Idempotent: a .min.js is (re)written only when the source is newer, so boot
// and rebuilds are cheap. Skips already-minified inputs (*.min.js) and only
// rewrites when the minified output would actually differ in freshness.
//
// Run manually:   node scripts/minify-assets.js
// Runs on boot:   invoked (fire-and-forget) from startServer before precompress.
// Runs on build:  Docker build + `npm run precompress`.

const fs = require('fs');
const path = require('path');

function isFresh(target, srcStat) {
  try { return fs.statSync(target).mtimeMs >= srcStat.mtimeMs; }
  catch { return false; }
}

function minifyAssets(assetsDir) {
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (e) {
    console.warn('[minify] esbuild not installed — skipping (serving unminified):', e.message);
    return { files: 0, written: 0, skipped: 0 };
  }

  const root = path.resolve(assetsDir);
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return { files: 0, written: 0, skipped: 0 }; }

  const sources = entries
    .filter((e) => e.isFile()
      && e.name.endsWith('.js')
      && !e.name.endsWith('.min.js'))
    .map((e) => path.join(root, e.name));

  let written = 0, skipped = 0;
  for (const src of sources) {
    const srcStat = fs.statSync(src);
    const out = src.replace(/\.js$/, '.min.js');
    if (isFresh(out, srcStat)) { skipped++; continue; }
    try {
      const code = fs.readFileSync(src, 'utf8');
      const result = esbuild.transformSync(code, {
        minify: true,
        legalComments: 'none'
        // No `format` set: esbuild transform then leaves the code unwrapped, so
        // these classic browser scripts keep their global vars/functions and
        // load-order behaviour unchanged (no IIFE/module wrapping).
      });
      fs.writeFileSync(out, result.code);
      written++;
    } catch (e) {
      console.warn(`[minify] failed ${path.basename(src)}: ${e.message}`);
    }
  }
  return { files: sources.length, written, skipped };
}

module.exports = minifyAssets;

if (require.main === module) {
  const assetsDir = process.argv[2]
    || path.join(__dirname, '..', 'PUBLIC', 'assets');
  const t0 = Date.now();
  const r = minifyAssets(assetsDir);
  console.log(`[minify] ${r.files} assets, ${r.written} written, ${r.skipped} up-to-date in ${Date.now() - t0}ms`);
}
