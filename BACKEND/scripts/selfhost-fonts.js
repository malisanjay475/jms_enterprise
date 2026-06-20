'use strict';
/**
 * Self-host Google Fonts.
 *
 * For each unique Google Fonts css2 URL used in PUBLIC/*.html, this:
 *   1. fetches the CSS with a modern browser UA (so Google returns woff2),
 *   2. keeps only the latin + latin-ext subsets (factory UI is English),
 *   3. downloads each woff2 into PUBLIC/assets/vendor/fonts/files/,
 *   4. writes a local stylesheet PUBLIC/assets/vendor/fonts/<slug>.css whose
 *      @font-face rules point at the local woff2 files (font-display: swap),
 *   5. rewrites the <link> in every HTML page to the local stylesheet.
 *
 * Run once: node scripts/selfhost-fonts.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, '..', 'PUBLIC');
const FONT_DIR = path.join(PUBLIC, 'assets', 'vendor', 'fonts');
const FILES_DIR = path.join(FONT_DIR, 'files');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);

fs.mkdirSync(FILES_DIR, { recursive: true });

// Collect unique googleapis css2 hrefs from all HTML pages
const htmlFiles = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
const linkRe = /<link[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/g;
const urls = new Map(); // url -> slug
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const url = m[1].replace(/&amp;/g, '&');
    if (!urls.has(url)) {
      const slug = 'g-' + crypto.createHash('md5').update(url).digest('hex').slice(0, 10);
      urls.set(url, slug);
    }
  }
}
console.log(`Found ${urls.size} unique Google Fonts URL(s)`);

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
async function download(url, dest) {
  if (fs.existsSync(dest)) return;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

(async () => {
  for (const [url, slug] of urls) {
    console.log(`\n=== ${slug}  (${url})`);
    const css = await fetchText(url);

    // Split into per-subset chunks. Each @font-face is preceded by a /* subset */ comment.
    const chunks = css.split(/\/\*\s*([\w-]+)\s*\*\//).slice(1); // [subset, block, subset, block...]
    let out = `/* Self-hosted from ${url}\n   Subsets: ${[...KEEP_SUBSETS].join(', ')} only. font-display: swap. */\n`;
    let kept = 0;
    for (let i = 0; i < chunks.length; i += 2) {
      const subset = chunks[i].trim();
      let block = chunks[i + 1] || '';
      if (!KEEP_SUBSETS.has(subset)) continue;
      // Find the woff2 URL in this block
      const um = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
      if (!um) continue;
      const woff2Url = um[1];
      const fileName = slug + '-' + path.basename(new URL(woff2Url).pathname);
      await download(woff2Url, path.join(FILES_DIR, fileName));
      block = block.replace(woff2Url, `/assets/vendor/fonts/files/${fileName}`);
      out += `/* ${subset} */${block}`;
      kept++;
    }
    fs.writeFileSync(path.join(FONT_DIR, slug + '.css'), out, 'utf8');
    console.log(`  wrote ${slug}.css (${kept} @font-face kept)`);
  }

  // Rewrite HTML links
  for (const f of htmlFiles) {
    const p = path.join(PUBLIC, f);
    let html = fs.readFileSync(p, 'utf8');
    let changed = false;
    for (const [url, slug] of urls) {
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reAmp = url.replace(/&/g, '&amp;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const linkRe2 = new RegExp(`href="(${esc}|${reAmp})"`, 'g');
      if (linkRe2.test(html)) {
        html = html.replace(linkRe2, `href="/assets/vendor/fonts/${slug}.css"`);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(p, html, 'utf8');
      console.log(`  updated ${f}`);
    }
  }
  console.log('\nDone.');
})().catch(e => { console.error(e); process.exit(1); });
