'use strict';

// Upload hardening shared by every place that saves a user file under PUBLIC/uploads,
// which the server hands out as static files on its own origin.
//
// The file extension decides how the browser treats a served file, so it must come from
// an allowlist, never from the uploader. Before this, a file named evil.html (or an SVG,
// which can carry script) could be stored and then served from the app's domain, where it
// runs with the logged-in user's access (stored XSS).

const path = require('path');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

// Lower-cased extension of `filename` if it is in `allowed`, otherwise null.
function allowedExtension(filename, allowed = MEDIA_EXTS) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return allowed.has(ext) ? ext : null;
}

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov'
};

// Extension to save an upload with: the filename's own extension when it is allowed,
// else one derived from a known MIME type (phone cameras often send "blob" or "image"
// with no extension), else null = reject. A dangerous name ("x.html") with an image
// MIME type is saved as that image type, never as .html.
function extensionForUpload(originalname, mimetype, allowed = MEDIA_EXTS) {
  const byName = allowedExtension(originalname, allowed);
  if (byName) return byName;
  const byMime = EXT_BY_MIME[String(mimetype || '').toLowerCase()];
  return byMime && allowed.has(byMime) ? byMime : null;
}

// Upload folders that must not be public. Resumes are candidates' personal data
// (name, phone, address, work history); only HR and admins may open them.
const PRIVATE_UPLOAD_DIRS = [
  { prefix: '/uploads/interviews/', roles: new Set(['admin', 'superadmin', 'hr_manager']) }
];

// The static file handler decodes the URL and, on the Windows factory servers, reads
// from a case-insensitive filesystem that also accepts backslashes. Match on the same
// decoded, slash-normalised, lower-cased path, so /UPLOADS/Interviews/x.pdf,
// /uploads/interviews%2Fx.pdf, /uploads//interviews/x.pdf or /uploads/./interviews/x.pdf
// can't reach a private file around the guard. Returns null for undecodable input.
function canonicalRequestPath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(rawPath || ''));
  } catch {
    return null;
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/').replace(/\0/g, ''));
  return normalized.toLowerCase();
}

// Mount at the app ROOT, before every static handler. A path-mounted guard
// (app.use('/uploads', ...)) is not enough: "//uploads/..." or "/./uploads/..." skip the
// mount but the PUBLIC static handler still resolves them to the same file.
// `authMiddleware` (src/app/auth.js) runs only for requests that hit a private folder.
function createPrivateUploadGuard(authMiddleware) {
  return function privateUploadGuard(req, res, next) {
    const fullPath = canonicalRequestPath(req.path);
    if (fullPath === null) return res.status(400).json({ ok: false, error: 'Bad file path.' });
    const rule = PRIVATE_UPLOAD_DIRS.find((r) => fullPath.startsWith(r.prefix) || `${fullPath}/` === r.prefix);
    if (!rule) return next();
    return authMiddleware(req, res, () => {
      if (!req.auth) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Please log in again to open this file.' });
      if (!rule.roles.has(req.auth.role)) return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'This file is only available to HR and admins.' });
      return next();
    });
  };
}

module.exports = {
  IMAGE_EXTS,
  VIDEO_EXTS,
  MEDIA_EXTS,
  allowedExtension,
  extensionForUpload,
  PRIVATE_UPLOAD_DIRS,
  createPrivateUploadGuard,
  canonicalRequestPath
};
