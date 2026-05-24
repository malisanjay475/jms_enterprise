'use strict';

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Parse and validate CORS origins — only accept http(s):// URLs from the env var
const _rawOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = _rawOrigins.filter(o => /^https?:\/\/[^/]+$/.test(o));

function shouldSkipApiLimiter(req) {
  const fullPath = `${req.baseUrl || ''}${req.path || req.url || ''}`;
  return fullPath.startsWith('/api/sync') || fullPath.startsWith('/sync');
}

// 300 requests/minute per IP — generous for factory intranet, blocks bots/scrapers.
// Sync uses API-key auth and pulls many tables in one cycle, so it has its own
// pacing/retry logic instead of sharing this browser/API limiter.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipApiLimiter,
  message: { ok: false, error: 'Too many requests, please slow down.' }
});

function registerCoreMiddleware(app) {
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
}

module.exports = registerCoreMiddleware;
