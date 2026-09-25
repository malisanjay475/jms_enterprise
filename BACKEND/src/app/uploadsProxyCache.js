'use strict';

const fs = require('fs');
const path = require('path');
const { IMAGE_EXTS, PRIVATE_UPLOAD_DIRS, canonicalRequestPath } = require('./uploadSafety');

// LOCAL servers fetch an /uploads/ file from MAIN when it isn't on disk (machine icons
// etc. uploaded on MAIN). Before, nothing was kept, so every page view fetched every
// such image again (~1 s each over the internet) and busy pages hit the 30 s timeout
// ("[Uploads Proxy] Stream error ... aborted due to timeout"). A fetched image is now
// saved under the local uploads folder, so the next request is served from disk by
// express.static. Only public image files are kept: never a private folder
// (PRIVATE_UPLOAD_DIRS), never a non-image, never anything outside the uploads folder.

const MAX_CACHE_BYTES = 10 * 1024 * 1024;
const SAFE_REL_PATH = /^[A-Za-z0-9._\-/]+$/;

/** Absolute local path to keep a copy of this /uploads/... request, or null if it must not be kept. */
function cacheTargetFor(uploadsDir, requestPath) {
  // Checks use the canonical (decoded, normalised, lower-cased) path, the same one the
  // private-upload guard uses; the saved file keeps its real name.
  const canonical = canonicalRequestPath(requestPath);
  if (!canonical || !canonical.startsWith('/uploads/')) return null;
  if (PRIVATE_UPLOAD_DIRS.some((r) => canonical.startsWith(r.prefix))) return null;

  let decoded;
  try {
    decoded = path.posix.normalize(decodeURIComponent(String(requestPath)).split('\\').join('/'));
  } catch {
    return null;
  }
  if (!decoded.toLowerCase().startsWith('/uploads/')) return null;
  const rel = decoded.slice('/uploads/'.length);
  if (!rel || !SAFE_REL_PATH.test(rel)) return null;
  if (rel.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null;
  if (!IMAGE_EXTS.has(path.extname(rel).toLowerCase())) return null;

  const root = path.resolve(uploadsDir);
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep)) return null;
  return target;
}

/** Writes the file atomically (temp name + rename). Returns false instead of throwing. */
function saveCopy(target, buffer) {
  if (!target || !buffer || buffer.length === 0 || buffer.length > MAX_CACHE_BYTES) return false;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.part`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    console.warn('[Uploads Proxy] could not keep a local copy:', err.message);
    return false;
  }
}

module.exports = { cacheTargetFor, saveCopy, MAX_CACHE_BYTES };
