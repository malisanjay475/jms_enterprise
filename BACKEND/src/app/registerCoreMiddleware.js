'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const morgan = require('morgan');
const { DailyLogStream } = require('./dailyLogStream');

// Request log: one file per day (logs/access-YYYY-MM-DD.log), 14 days kept. The old
// single access.log grew without limit (3 GB on factory-1).
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const accessLogStream = new DailyLogStream({
  dir: LOG_DIR,
  keepDays: Number.parseInt(process.env.ACCESS_LOG_KEEP_DAYS || '', 10) || 14
});

// Parse and validate CORS origins — only accept http(s):// URLs from the env var
const _rawOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = _rawOrigins.filter(o => /^https?:\/\/[^/]+$/.test(o));

function shouldSkipApiLimiter(req) {
  const fullPath = `${req.baseUrl || ''}${req.path || req.url || ''}`;
  return fullPath.startsWith('/api/sync') || fullPath.startsWith('/sync');
}

// 600 requests/minute per bucket for the general API.
// Raised from 300: 10 supervisors × avg 60 req/min = 600 req/min at peak.
// Sync routes have their own limiter.
//
// Bucket = the VERIFIED user (req.auth, from the session cookie) when there is one,
// otherwise the client IP. It used to be `${ip}_${X-User-Name}`, and that header is set
// by the client, so rotating it gave an attacker a fresh 600/min bucket per request.
// With `trust proxy` set (createApp), req.ip is the real client address behind Traefik.
// Mounted by registerRoutes AFTER the session middleware, so req.auth is available.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipApiLimiter,
  keyGenerator: (req) => (req.auth && req.auth.username
    ? `user:${String(req.auth.username).toLowerCase()}`
    : `ip:${ipKeyGenerator(req.ip)}`),
  validate: false,
  message: { ok: false, error: 'Too many requests, please slow down.' }
});

// Server errors (5xx) used to return the raw exception text (`String(e)` in ~350 handlers:
// SQL messages, table/column names, file paths). Send users a short message with a
// reference and keep the detail in the server log. Sync and local-server (machine-to-
// machine, key-authenticated) endpoints keep their detailed errors for diagnosis.
const DETAILED_ERROR_PREFIXES = ['/api/sync', '/sync', '/api/local-servers', '/api/update'];
function hideServerErrorDetails(req, res, next) {
  const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (!fullPath.startsWith('/api') || DETAILED_ERROR_PREFIXES.some((p) => fullPath.startsWith(p))) {
    return next();
  }
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object' && typeof body.error === 'string') {
      const ref = `E${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;
      console.error(`[API ${res.statusCode}] ref=${ref} ${req.method} ${fullPath}: ${body.error}`);
      return originalJson({ ...body, error: `Server error — please try again. If it keeps happening, tell your admin (ref ${ref}).`, ref });
    }
    return originalJson(body);
  };
  return next();
}

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
  // GET pulls send the key in the x-sync-api-key header (never in the URL, which is
  // logged); POST pushes send it in the JSON body.
  const key = req.get('x-sync-api-key') || (req.body && req.body.apiKey);
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
    // HSTS only on MAIN, which is always served over HTTPS (Traefik, jmsocean.cloud).
    // LOCAL factory servers run plain HTTP (browsers ignore HSTS there anyway) or an
    // optional self-signed HTTPS port, where a pinned HSTS policy would lock browsers
    // out of clicking through the certificate warning — so never on LOCAL.
    // includeSubDomains stays off: other *.jmsocean.cloud services are separate apps.
    strictTransportSecurity: String(process.env.SERVER_TYPE || '').toUpperCase() === 'MAIN'
      ? { maxAge: 180 * 24 * 60 * 60, includeSubDomains: false }
      : false,
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
  app.use(hideServerErrorDetails);
  // apiLimiter is mounted by registerRoutes, after the session middleware (see above).
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
module.exports.apiLimiter = apiLimiter;
module.exports.hideServerErrorDetails = hideServerErrorDetails;
