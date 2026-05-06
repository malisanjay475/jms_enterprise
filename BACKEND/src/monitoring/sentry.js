'use strict';

// Sentry is completely optional.
// If SENTRY_DSN is not set in .env → all functions are no-ops, nothing breaks.
// If SENTRY_DSN is set → errors are captured and sent to your Sentry project.

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
    // @sentry/node not installed — safe to ignore, just won't monitor
    console.warn('[Sentry] Skipping — package not installed:', e.message);
  }
}

function captureException(err, context) {
  if (_sentry) _sentry.captureException(err, context);
}

// Returns Sentry request handler middleware, or a pass-through if Sentry is off
function requestHandler() {
  if (_sentry) return _sentry.Handlers.requestHandler();
  return (req, res, next) => next();
}

// Returns Sentry error handler middleware, or a pass-through if Sentry is off
function errorHandler() {
  if (_sentry) return _sentry.Handlers.errorHandler();
  return (err, req, res, next) => next(err);
}

module.exports = { initSentry, captureException, requestHandler, errorHandler };
