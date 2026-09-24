'use strict';

// Writable stream for the request log that starts a new file each day
// (access-YYYY-MM-DD.log) and deletes access logs older than `keepDays`.
// It replaces a single logs/access.log that was never rotated (3 GB on factory-1 by
// Sep-2026). The old access.log matches the clean-up pattern, so it is removed
// automatically once it has not been written for `keepDays`.

const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');

const LOG_FILE_RE = /^access(-\d{4}-\d{2}-\d{2})?\.log$/;

function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pruneOldLogs(dir, keepDays, now = Date.now()) {
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return removed; }
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  for (const name of entries) {
    if (!LOG_FILE_RE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch { /* in use or already gone — try again tomorrow */ }
  }
  return removed;
}

class DailyLogStream extends Writable {
  constructor({ dir, keepDays = 14, now = () => new Date() }) {
    super();
    this.dir = dir;
    this.keepDays = keepDays;
    this.now = now;
    this.day = null;
    this.file = null;
    fs.mkdirSync(dir, { recursive: true });
  }

  currentFile() {
    const day = localDay(this.now());
    if (day !== this.day) {
      if (this.file) this.file.end();
      this.day = day;
      this.file = fs.createWriteStream(path.join(this.dir, `access-${day}.log`), { flags: 'a' });
      // A logging problem must never take the server down.
      this.file.on('error', () => {});
      pruneOldLogs(this.dir, this.keepDays, this.now().getTime());
    }
    return this.file;
  }

  _write(chunk, encoding, callback) {
    try {
      this.currentFile().write(chunk, encoding, () => callback());
    } catch {
      callback();
    }
  }

  _final(callback) {
    if (this.file) this.file.end(callback);
    else callback();
  }
}

module.exports = { DailyLogStream, pruneOldLogs, localDay, LOG_FILE_RE };
