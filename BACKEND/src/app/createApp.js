'use strict';

const express = require('express');
const registerCoreMiddleware = require('./registerCoreMiddleware');
const registerRoutes = require('./registerRoutes');
const { requestHandler, errorHandler } = require('../monitoring/sentry');

function createApp(deps) {
  const app = express();

  app.locals.config = deps.config;
  app.locals.pool = deps.pool;

  // Sentry request handler must be first middleware (no-op if Sentry not configured)
  app.use(requestHandler());

  registerCoreMiddleware(app);
  const legacyRuntime = registerRoutes(app, deps);

  // Sentry error handler must be after all routes (no-op if Sentry not configured)
  app.use(errorHandler());

  return { app, legacyRuntime };
}

module.exports = createApp;
