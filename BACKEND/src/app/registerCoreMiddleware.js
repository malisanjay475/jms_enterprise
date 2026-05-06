'use strict';

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : true; // allow all when not configured (factory intranet default)

// 300 requests/minute per IP — generous for factory intranet, blocks bots/scrapers
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please slow down.' }
});

function registerCoreMiddleware(app) {
  app.use(helmet({
    contentSecurityPolicy: false // HTML pages use inline scripts; enable per-page CSP when ready
  }));
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));
  app.use(compression({
    filter: (req, res) => {
      if (req.path.includes('/api/assembly/events')) return false;
      return compression.filter(req, res);
    }
  }));
  app.use('/api/', apiLimiter);
}

module.exports = registerCoreMiddleware;
