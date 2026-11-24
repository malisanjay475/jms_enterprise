'use strict';

// True when a GET that matched no route is a request for a file (script, style, image,
// upload, dotfile) rather than a page. Those must answer 404: the home page with a 200
// hid missing files (a missing barcode library looked like a successful download).
// Unknown page addresses (no extension, or .html) still get the home page.
function isMissingFileRequest(reqPath) {
  const p = String(reqPath || '').toLowerCase();
  if (p.startsWith('/assets/') || p.startsWith('/uploads/')) return true;
  if (p.includes('/.')) return true;
  const last = p.slice(p.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  return dot > 0 && last.slice(dot + 1) !== 'html';
}

module.exports = { isMissingFileRequest };
