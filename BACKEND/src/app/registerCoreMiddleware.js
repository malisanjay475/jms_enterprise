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

// 300 requests/minute per IP for general API. Sync routes have their own stricter limiter.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
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
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
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

  // Static asset cache headers — 24h for PUBLIC assets, forces revalidation with ETag
  app.use((req, res, next) => {
    if (req.method === 'GET' && /\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i.test(req.path)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    }
    next();
  });
}

module.exports = registerCoreMiddleware;
