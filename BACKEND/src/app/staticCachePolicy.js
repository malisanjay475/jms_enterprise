'use strict';

const path = require('path');

// Cache-Control for files served from PUBLIC.
//
// Our own JS/CSS used to be cached for 7 days without revalidation, under URLs that
// never change (every page loads /assets/app.min.js?v=1576 — that number was last
// bumped at v1.57.8). So a fixed page script reached a browser only when its cached
// copy expired, up to a week after the deploy. They are now "no-cache": the browser
// keeps its copy but asks each time, and gets a tiny 304 when nothing changed.
// Third-party libraries under /assets/vendor/ are pinned by version in their path, so
// they stay cached for a year; fonts and images keep 7 days; HTML keeps 5 minutes.
function cacheControlForAsset(urlOrFilePath) {
  const p = String(urlOrFilePath || '').split('\\').join('/');
  if (p.includes('/assets/vendor/')) return 'public, max-age=31536000, immutable';
  const ext = path.extname(p.split('?')[0]).toLowerCase();
  if (ext === '.html') return 'public, max-age=300, stale-while-revalidate=60';
  if (ext === '.js' || ext === '.css' || ext === '.json') return 'no-cache';
  return 'public, max-age=604800';
}

module.exports = { cacheControlForAsset };
