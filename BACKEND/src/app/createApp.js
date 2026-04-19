'use strict';

const express = require('express');
const registerCoreMiddleware = require('./registerCoreMiddleware');
const registerRoutes = require('./registerRoutes');

function createApp(deps) {
  const app = express();

  app.locals.config = deps.config;
  app.locals.pool = deps.pool;

  registerCoreMiddleware(app);
  const legacyRuntime = registerRoutes(app, deps);

  return { app, legacyRuntime };
}

module.exports = createApp;
