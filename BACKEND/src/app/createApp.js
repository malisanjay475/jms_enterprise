'use strict';

const express = require('express');
const registerCoreMiddleware = require('./registerCoreMiddleware');
const registerRoutes = require('./registerRoutes');
const { requestHandler, setupErrorHandler } = require('../monitoring/sentry');

function createApp(deps) {
  const app = express();

  app.locals.config = deps.config;
  app.locals.pool = deps.pool;

  // Trust the reverse proxy in front of us (nginx on the VPS) so req.ip and
  // req.protocol reflect the real client, not the proxy. Without this the
  // rate limiter and the ERP IP whitelist see every request as the proxy's IP.
  // Configurable via TRUST_PROXY (a number of hops, 'true'/'false', or an IP/
  // subnet list per Express). Defaults to trusting one hop on the internet-facing
  // MAIN server, and off on LOCAL factory servers (no proxy, so a client could
  // otherwise spoof X-Forwarded-For).
  const trustProxyCfg = String((deps.config && deps.config.trustProxy) || '').trim();
  let trustProxy;
  if (trustProxyCfg === '') {
    trustProxy = (String((deps.config && deps.config.serverType) || 'MAIN').toUpperCase() === 'LOCAL') ? false : 1;
  } else if (trustProxyCfg.toLowerCase() === 'true') {
    trustProxy = true;
  } else if (trustProxyCfg.toLowerCase() === 'false') {
    trustProxy = false;
  } else if (/^\d+$/.test(trustProxyCfg)) {
    trustProxy = parseInt(trustProxyCfg, 10);
  } else {
    trustProxy = trustProxyCfg; // IP / subnet list
  }
  app.set('trust proxy', trustProxy);

  app.use(requestHandler());

  registerCoreMiddleware(app);
  const legacyRuntime = registerRoutes(app, deps);

  // Sentry v8+ error handler — must be after all routes
  setupErrorHandler(app);

  return { app, legacyRuntime };
}

module.exports = createApp;
