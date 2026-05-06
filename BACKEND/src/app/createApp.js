'use strict';

const express = require('express');
const registerCoreMiddleware = require('./registerCoreMiddleware');
const registerRoutes = require('./registerRoutes');
const { requestHandler, setupErrorHandler } = require('../monitoring/sentry');

function createApp(deps) {
  const app = express();

  // Trust one nginx hop so req.ip = real client IP for rate limiting and IP whitelisting
  app.set('trust proxy', 1);

  app.locals.config = deps.config;
  app.locals.pool = deps.pool;

  app.use(requestHandler());

  registerCoreMiddleware(app);
  const legacyRuntime = registerRoutes(app, deps);

  // Sentry v8+ error handler — must be after all routes
  setupErrorHandler(app);

  return { app, legacyRuntime };
}

module.exports = createApp;
