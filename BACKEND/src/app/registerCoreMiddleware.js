'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
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
// Sync routes have their own stricter limiter.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipApiLimiter,
  keyGenerator: (req) => {
    const user = req.headers['x-user-name'] || 'anonymous';
    const ip = ipKeyGenerator(req.ip);
    return `${ip}_${user}`;
  },
  validate: false,
  message: { ok: false, error: 'Too many requests, please slow down.' }
});

// Sync routes get a separate, more focused limiter — they skip the main apiLimiter but still
// need protection against unauthenticated abuse. Requests carrying the correct SYNC_API_KEY
// are trusted (LOCAL→MAIN pushes) and bypass the limiter entirely, so a full re-sync or
// backlog drain can't get throttled to 429 mid-flight — that previously advanced the LOCAL
// watermark past rows that never landed, stranding them. Unauthenticated traffic still hits
// the (raised) ceiling.
//
// Fail closed: the bypass only applies when SYNC_API_KEY is explicitly configured in the
// environment. We intentionally do NOT fall back to a hardcoded default here — a repo-visible
// default would let anyone using that well-known value skip the limiter if the env var were
// ever unset. If SYNC_API_KEY is missing, no request bypasses the limiter.
const SYNC_KEY = process.env.SYNC_API_KEY || '';
function shouldSkipSyncLimiter(req) {
  if (!SYNC_KEY) return false;
  const key = (req.body && req.body.apiKey) || (req.query && req.query.apiKey);
  return key === SYNC_KEY;
}
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: shouldSkipSyncLimiter,
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
  // Static asset cache headers.
  // HTML: 5-min cache (short so deploys take effect quickly) → repeat visits
  // load in <1s. JS/CSS already ?v= versioned → 24h. Fonts → 7d. Images → 24h.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const p = req.path;
    if (p === '/sw.js') {
      // The service worker must update promptly — never cache it. The browser
      // re-checks /sw.js on navigation; a stale SW would pin old asset logic.
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.html$/i.test(p)) {
      // 5 min cache + stale-while-revalidate so browser reuses instantly while
      // revalidating in background. Revalidation uses ETag (Express sets it).
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    } else if (p.startsWith('/assets/vendor/') || req.query.v) {
      // Third-party libs are pinned by version in their path (…/1.13.4/…), and
      // our own assets are busted with ?v= query strings. Either way the URL
      // changes when the content changes, so cache for a year + immutable
      // (browser never even revalidates → instant repeat loads).
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.(js|css)$/i.test(p)) {
      // Un-versioned JS/CSS → moderate cache with background revalidation.
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

  // ── Read-mostly API cache hints ─────────────────────────────────────────
  // These config endpoints already have a ~30s server-side cache and change
  // rarely. A short private browser cache + stale-while-revalidate makes repeat
  // loads instant while a background revalidation (cheap 304 via Express ETag)
  // keeps them fresh. Scoped to an allowlist so live/transactional endpoints
  // (DPR counts, planning board, etc.) are never cached.
  const READ_MOSTLY_GET = [
    /^\/api\/machines(?:\/|$)/,
    /^\/api\/masters\/moulds(?:\/|$)/,
    /^\/api\/moulds(?:\/|$)/,
    /^\/api\/settings(?:\/|$)/,
    /^\/api\/reasons(?:\/|$)/
  ];
  app.use((req, res, next) => {
    if (req.method === 'GET' && READ_MOSTLY_GET.some((re) => re.test(req.path))) {
      res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
    }
    next();
  });
}

module.exports = registerCoreMiddleware;
