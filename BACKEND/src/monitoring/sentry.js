'use strict';

// Sentry is completely optional.
// If SENTRY_DSN is not set → all functions are no-ops, zero impact.
// If SENTRY_DSN is set → errors are captured in your Sentry dashboard.
// Supports @sentry/node v8+ (v10 API — Handlers removed, use setupExpressErrorHandler).

let _sentry = null;

function initSentry(dsn) {
  if (!dsn) return;
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV || 'production'
    });
    _sentry = Sentry;
    console.log('[Sentry] Error monitoring active');
  } catch (e) {
    console.warn('[Sentry] Skipping — package not installed or init failed:', e.message);
  }
}

function captureException(err, context) {
  if (_sentry) _sentry.captureException(err, context);
}

// No-op request middleware — Sentry v8+ uses expressIntegration() in init instead
function requestHandler() {
  return (req, res, next) => next();
}

// Registers Sentry error handler on the app (v8+ API)
function setupErrorHandler(app) {
  if (!_sentry) return;
  try {
    _sentry.setupExpressErrorHandler(app);
  } catch (e) {
    console.warn('[Sentry] Could not set up error handler:', e.message);
  }
}

module.exports = { initSentry, captureException, requestHandler, setupErrorHandler };
