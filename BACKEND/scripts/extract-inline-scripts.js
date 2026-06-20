'use strict';
/**
 * Generalized inline <script> extractor.
 *
 * Extracts large inline <script>...</script> blocks (no src attr) from an HTML
 * page into versioned external .js files so the browser can cache them across
 * page loads instead of re-downloading them inside the HTML every visit.
 *
 * Safety: a plain external <script src> (no async/defer) executes synchronously
 * in document order — identical semantics to the inline block it replaces, so
 * global-scope sharing and DOM timing are preserved.
 *
 * Usage:
 *   node scripts/extract-inline-scripts.js <page.html> [minLines]
 *   node scripts/extract-inline-scripts.js dpr.html 200
 *
 * Output files: PUBLIC/assets/<basename>-script-<n>.js
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'PUBLIC');
const ASSETS = path.join(PUBLIC, 'assets');
const VERSION = 'release63';

const pageArg = process.argv[2];
const MIN_LINES = parseInt(process.argv[3], 10) || 200;

if (!pageArg) {
  console.error('Usage: node scripts/extract-inline-scripts.js <page.html> [minLines]');
  process.exit(1);
}

const HTML_PATH = path.join(PUBLIC, pageArg);
if (!fs.existsSync(HTML_PATH)) {
  console.error(`Not found: ${HTML_PATH}`);
  process.exit(1);
}

const baseName = path.basename(pageArg, '.html');

let html = fs.readFileSync(HTML_PATH, 'utf8');
const lines = html.split('\n');
console.log(`${pageArg}: ${lines.length} lines`);

// Find all inline <script>...</script> blocks (opening tag has no src=)
const blocks = [];
let inScript = false;
let blockStart = -1;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!inScript) {
    if (/^\s*<script(?![^>]*\bsrc\b)[^>]*>\s*$/.test(line) || /^\s*<script>\s*$/.test(line)) {
      inScript = true;
      blockStart = i;
    }
  } else if (/^\s*<\/script>\s*$/.test(line)) {
    blocks.push({ start: blockStart, end: i, lines: i - blockStart - 1 });
    inScript = false;
  }
}

console.log(`Found ${blocks.length} inline script blocks:`);
blocks.forEach((b, idx) => {
  console.log(`  [${idx}] lines ${b.start + 1}-${b.end + 1} (${b.lines} JS lines)`);
});

// Extract big-enough blocks bottom-to-top so earlier line indices stay valid
const toExtract = blocks.filter(b => b.lines >= MIN_LINES).reverse();
console.log(`\nExtracting ${toExtract.length} block(s) >= ${MIN_LINES} lines...`);

// Number files top-to-bottom for readability: total minus reverse index
const total = toExtract.length;
let i = 0;
for (const block of toExtract) {
  const num = total - i; // because we iterate bottom-to-top
  i++;
  const fileName = `${baseName}-script-${num}.js`;
  const filePath = path.join(ASSETS, fileName);
  const jsContent = lines.slice(block.start + 1, block.end).join('\n');
  fs.writeFileSync(filePath, jsContent, 'utf8');
  console.log(`  -> Wrote ${fileName} (${block.lines} lines)`);
  const replacement = `  <script src="/assets/${fileName}?v=${VERSION}"></script>`;
  lines.splice(block.start, block.end - block.start + 1, replacement);
}

const newHtml = lines.join('\n');
fs.writeFileSync(HTML_PATH, newHtml, 'utf8');
console.log(`\nDone. ${pageArg}: ${html.split('\n').length} -> ${newHtml.split('\n').length} lines`);
