'use strict';

/**
 * Image optimization utility using sharp.
 *
 * Usage — post-multer middleware:
 *   router.post('/upload', upload.single('photo'), optimizeUploadedImage(), handler)
 *
 * Also exports optimizeImageFile(filePath) for direct use.
 */

let sharp;
try {
  sharp = require('sharp');
} catch (_) {
  // sharp is optional — if not installed, optimization is skipped silently
}

const DEFAULT_OPTIONS = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 82,       // WebP quality — 82 is near-lossless visually but ~40% smaller than JPEG
  convertToWebP: false // keep original format by default; set true to force WebP
};

/**
 * Optimizes an image file in-place (same path, same format or WebP).
 * Returns { originalSize, optimizedSize, skipped } for logging.
 */
async function optimizeImageFile(filePath, options = {}) {
  if (!sharp) return { skipped: true, reason: 'sharp not installed' };

  const fs = require('fs');
  const path = require('path');
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let stat;
  try { stat = fs.statSync(filePath); } catch (_) {
    return { skipped: true, reason: 'file not found' };
  }

  const ext = path.extname(filePath).toLowerCase();
  const SUPPORTED = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp'];
  if (!SUPPORTED.includes(ext)) return { skipped: true, reason: 'unsupported format' };

  try {
    const pipeline = sharp(filePath).resize(opts.maxWidth, opts.maxHeight, {
      fit: 'inside',
      withoutEnlargement: true
    });

    let outBuffer;
    let outExt = ext;

    if (opts.convertToWebP) {
      outBuffer = await pipeline.webp({ quality: opts.quality }).toBuffer();
      outExt = '.webp';
    } else if (ext === '.png') {
      outBuffer = await pipeline.png({ compressionLevel: 8, adaptiveFiltering: true }).toBuffer();
    } else {
      outBuffer = await pipeline.jpeg({ quality: opts.quality, mozjpeg: true }).toBuffer();
    }

    const originalSize = stat.size;
    // Only write if we actually made it smaller (never inflate a tiny image)
    if (outBuffer.length < originalSize) {
      if (opts.convertToWebP && outExt !== ext) {
        const newPath = filePath.replace(/\.[^.]+$/, outExt);
        fs.writeFileSync(newPath, outBuffer);
        fs.unlinkSync(filePath);
        return { originalSize, optimizedSize: outBuffer.length, newPath, skipped: false };
      }
      fs.writeFileSync(filePath, outBuffer);
    }

    return { originalSize, optimizedSize: Math.min(outBuffer.length, originalSize), skipped: false };
  } catch (err) {
    console.warn('[ImageProcessor] Optimization failed for', filePath, err.message);
    return { skipped: true, reason: err.message };
  }
}

/**
 * Express middleware: optimizes a multer-uploaded image after upload.single() / upload.array().
 * Safe to use — if sharp is missing or optimization fails, request continues normally.
 */
function optimizeUploadedImage(options = {}) {
  return async (req, res, next) => {
    try {
      const files = req.files || (req.file ? [req.file] : []);
      for (const file of files) {
        if (!file.path) continue;
        await optimizeImageFile(file.path, options);
      }
    } catch (_) {
      // Never block the request due to optimization failure
    }
    next();
  };
}

module.exports = { optimizeImageFile, optimizeUploadedImage };
