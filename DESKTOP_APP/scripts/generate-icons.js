'use strict';
// Generates assets/icon.png (256x256) and assets/icon.ico using only Node.js built-ins.
// Run: node scripts/generate-icons.js

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

// ── PNG builder ──────────────────────────────────────────────────────────────

function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t   = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(size, drawPixel) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = drawPixel(x, y, size);
      const off = y * (1 + size * 4) + 1 + x * 4;
      raw[off] = r; raw[off+1] = g; raw[off+2] = b; raw[off+3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function makeICO(pngBuf, size) {
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = size === 256 ? 0 : size;
  dir[1] = size === 256 ? 0 : size;
  dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(pngBuf.length, 8); dir.writeUInt32LE(22, 12);
  return Buffer.concat([hdr, dir, pngBuf]);
}

// ── Draw the JMS icon ─────────────────────────────────────────────────────────
// Blue rounded square with white "J" lettermark

function drawIcon(x, y, size) {
  const cx = size / 2, cy = size / 2, r = size * 0.42, rr = size * 0.14;
  const dx = x - cx + 0.5, dy = y - cy + 0.5;
  const inSquare = Math.abs(dx) <= r && Math.abs(dy) <= r;
  const corner = (Math.abs(Math.abs(dx) - r) < rr && Math.abs(Math.abs(dy) - r) < rr)
    ? Math.sqrt((Math.abs(dx) - (r - rr)) ** 2 + (Math.abs(dy) - (r - rr)) ** 2) > rr
    : false;
  if (!inSquare || corner) return [0, 0, 0, 0]; // transparent

  // Background gradient: deep blue
  const t = (dy + r) / (2 * r);
  const bg = [Math.round(30 + t*10), Math.round(80 + t*20), Math.round(180 + t*30), 255];

  // Draw "J" lettermark (centered)
  const lx = dx / (size * 0.28), ly = dy / (size * 0.28);
  const stroke = 0.12;

  // J vertical bar: top area x ~ 0.1..0.35
  const inVBar = lx > 0.08 && lx < 0.38 && ly > -0.75 && ly < 0.35;
  // J bottom curve: circle arc at bottom-left
  const curveR = 0.38, curveCx = -0.08, curveCy = 0.28;
  const curveDist = Math.sqrt((lx - curveCx) ** 2 + (ly - curveCy) ** 2);
  const inCurve = curveDist > curveR - stroke && curveDist < curveR + stroke && lx < curveCx + 0.01 && ly > curveCy - 0.4;
  // J top serif (horizontal bar)
  const inTopBar = lx > -0.25 && lx < 0.38 && ly > -0.75 && ly < -0.75 + stroke * 2;

  if (inVBar || inCurve || inTopBar) return [255, 255, 255, 255];
  return bg;
}

const png256 = makePNG(256, drawIcon);
const png32  = makePNG(32,  drawIcon);
const png16  = makePNG(16,  drawIcon);

fs.writeFileSync(path.join(OUT, 'icon.png'),      png256);
fs.writeFileSync(path.join(OUT, 'icon-32.png'),   png32);
fs.writeFileSync(path.join(OUT, 'icon-16.png'),   png16);
fs.writeFileSync(path.join(OUT, 'icon.ico'),      makeICO(png256, 256));
fs.writeFileSync(path.join(OUT, 'tray-green.png'), makePNG(16, (x, y, s) => {
  const cx = 7.5, cy = 7.5;
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return d < 6.5 ? [39, 174, 96, 255] : [0, 0, 0, 0];
}));
fs.writeFileSync(path.join(OUT, 'tray-yellow.png'), makePNG(16, (x, y, s) => {
  const d = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
  return d < 6.5 ? [243, 156, 18, 255] : [0, 0, 0, 0];
}));
fs.writeFileSync(path.join(OUT, 'tray-red.png'), makePNG(16, (x, y, s) => {
  const d = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
  return d < 6.5 ? [231, 76, 60, 255] : [0, 0, 0, 0];
}));

console.log('Icons generated in assets/');
