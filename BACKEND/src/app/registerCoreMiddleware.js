'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

// Ensure log directory exists
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const accessLogStream = fs.createWriteStream(path.join(LOG_DIR, 'access.log'), { flags: 'a' });

// Parse and validate CORS origins — only accept http(s):// URLs from the env var
const _rawOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = _rawOrigins.filter(o => /^https?:\/\/[^/]+$/.test(o));

function shouldSkipApiLimiter(req) {
  const fullPath = `${req.baseUrl || ''}${req.path || req.url || ''}`;
  return fullPath.startsWith('/api/sync') || fullPath.startsWith('/sync');
}

// 600 requests/minute per IP for general API.
// Raised from 300: factory WiFi shares 1 IP across all users.
// 10 supervisors × avg 60 req/min = 600 req/min needed at peak.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipApiLimiter,
  message: { ok: false, error: 'Too many requests, please slow down.' }
});

// Sync routes get a separate, more focused limiter — they skip the main apiLimiter but still
// need protection. 120 req/min covers normal sync cycles without opening an abuse path.
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Sync rate limit exceeded.' }
});

function registerCoreMiddleware(app) {
  // Request logging — combined format to file, dev format to console
  app.use(morgan('combined', { stream: accessLogStream }));
  app.use(morgan('dev', { skip: (_req, res) => res.statusCode < 400 }));

  app.use(helmet({
    // HSTS must be off — server runs plain HTTP on factory intranet and VPS port
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'", "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://code.jquery.com',
          'https://cdn.datatables.net',
          'https://unpkg.com'
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.datatables.net', 'https:'],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        connectSrc: ["'self'", 'https:', 'http:', 'wss:', 'ws:'],
        fontSrc: ["'self'", 'https:', 'http:', 'data:'],
        // Allow inline onclick/onkeydown attrs — whole app uses them extensively
        scriptSrcAttr: ["'unsafe-inline'"],
        // Disable upgrade-insecure-requests — app is intentionally served over HTTP
        upgradeInsecureRequests: null
      }
    }
  }));
  app.use(cors({ origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));
  app.use(compression({
    level: 6,
    threshold: 256,
    filter: (req, res) => {
      if (req.path.includes('/api/assembly/events')) return false;
      return compression.filter(req, res);
    }
  }));
  app.use('/api/', apiLimiter);
  app.use(['/api/sync', '/sync'], syncLimiter);

  // ── Static asset cache headers ──────────────────────────────────────────
  // HTML pages: 5-minute browser cache. Short so deploys take effect quickly.
  // JS/CSS already have ?v=release-XX version strings → safe for 24h cache.
  // Fonts/images rarely change → 7-day cache.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const p = req.path;
    if (/\.html$/i.test(p)) {
      // 5 min cache + stale-while-revalidate so browser reuses instantly while
      // revalidating in background. Revalidation uses ETag (Express sets it).
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    } else if (/\.(js|css)$/i.test(p)) {
      // JS/CSS are versioned with ?v= query strings → long cache is safe.
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    } else if (/\.(woff2?|ttf|eot|otf)$/i.test(p)) {
      // Fonts never change — 7-day cache.
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(p)) {
      // Images — 24h cache.
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    }
    next();
  });
}

module.exports = registerCoreMiddleware;
