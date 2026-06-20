'use strict';
/**
 * Extracts large inline <script> blocks from planning.html into versioned
 * external .js files so the browser can cache them across page loads.
 *
 * Run once: node scripts/extract-planning-scripts.js
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'PUBLIC');
const ASSETS = path.join(PUBLIC, 'assets');
const HTML_PATH = path.join(PUBLIC, 'planning.html');
const VERSION = 'release62';

// Minimum line-count for a script block to be worth extracting
const MIN_LINES = 200;

let html = fs.readFileSync(HTML_PATH, 'utf8');
const lines = html.split('\n');

console.log(`planning.html: ${lines.length} lines`);

// Find all inline <script>...</script> blocks (no src attribute)
const blocks = [];
let inScript = false;
let blockStart = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!inScript) {
    // Match opening <script> tag with no src=
    if (/^\s*<script(?![^>]*\bsrc\b)[^>]*>\s*$/.test(line) || /^\s*<script>\s*$/.test(line)) {
      inScript = true;
      blockStart = i;
    }
  } else {
    if (/^\s*<\/script>\s*$/.test(line)) {
      const blockLines = i - blockStart - 1; // exclude opening/closing tags
      blocks.push({ start: blockStart, end: i, lines: blockLines });
      inScript = false;
    }
  }
}

console.log(`Found ${blocks.length} inline script blocks:`);
blocks.forEach((b, idx) => {
  console.log(`  [${idx}] lines ${b.start + 1}–${b.end + 1} (${b.lines} JS lines)`);
});

// Extract blocks that are large enough, from bottom to top (to preserve line numbers)
const toExtract = blocks.filter(b => b.lines >= MIN_LINES).reverse();
console.log(`\nExtracting ${toExtract.length} block(s) >= ${MIN_LINES} lines...`);

let extractCount = 0;
for (const block of toExtract) {
  extractCount++;
  const fileName = `planning-script-${extractCount}.js`;
  const filePath = path.join(ASSETS, fileName);

  const jsContent = lines.slice(block.start + 1, block.end).join('\n');
  fs.writeFileSync(filePath, jsContent, 'utf8');
  console.log(`  → Wrote ${fileName} (${block.lines} lines)`);

  // Replace the block in lines array with external script tag
  const replacement = `  <script src="/assets/${fileName}?v=${VERSION}"></script>`;
  lines.splice(block.start, block.end - block.start + 1, replacement);
}

const newHtml = lines.join('\n');
fs.writeFileSync(HTML_PATH, newHtml, 'utf8');

const newLineCount = newHtml.split('\n').length;
console.log(`\nDone. planning.html: ${lines.length} lines → ${newLineCount} lines`);
console.log('Extracted files are in BACKEND/PUBLIC/assets/');
