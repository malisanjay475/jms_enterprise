'use strict';

require('dotenv').config();

const { initSentry } = require('../monitoring/sentry');
const fs = require('fs');
const https = require('https');
const path = require('path');
const loadConfig = require('../config/loadConfig');
const createDbPool = require('../db/createDbPool');
const createServices = require('../services/createServices');
const createApp = require('./createApp');

function createHttpsServerIfConfigured(app, config) {
  if (!config.https?.enabled) return null;
  const pfxPath = config.https.pfxPath
    ? path.resolve(process.cwd(), config.https.pfxPath)
    : '';
  if (!pfxPath || !fs.existsSync(pfxPath)) {
    console.warn('[HTTPS] HTTPS_ENABLED is on, but HTTPS_PFX_PATH is missing or not found. HTTPS server not started.');
    return null;
  }

  const httpsPort = config.https.port || (Number(config.port) + 443);
  const httpsServer = https.createServer({
    pfx: fs.readFileSync(pfxPath),
    passphrase: config.https.pfxPassphrase || undefined
  }, app);

  return new Promise((resolve) => {
    httpsServer.listen(httpsPort, '0.0.0.0', () => resolve({ httpsServer, httpsPort }));
  });
}

async function startServer() {
  const config = loadConfig();
  initSentry(config.sentryDsn);
  const pool = createDbPool(config);
  const services = createServices();
  const { app, legacyRuntime } = createApp({ config, pool, services });

  const legacyHooks = legacyRuntime && legacyRuntime.initializeLegacyRuntime
    ? await legacyRuntime.initializeLegacyRuntime()
    : {};

  if (services.localServerService?.init) {
    await services.localServerService.init(pool);
  }

  const server = await new Promise((resolve) => {
    const httpServer = app.listen(config.port, '0.0.0.0', () => resolve(httpServer));
  });
  const httpsRuntime = await createHttpsServerIfConfigured(app, config);

  server.setTimeout(600000);
  server.keepAliveTimeout = 60000;
  server.headersTimeout = 61000;

  if (httpsRuntime?.httpsServer) {
    httpsRuntime.httpsServer.setTimeout(600000);
    httpsRuntime.httpsServer.keepAliveTimeout = 60000;
    httpsRuntime.httpsServer.headersTimeout = 61000;
    httpsRuntime.httpsServer.on('clientError', (err, socket) => {
      console.error('[HTTPS CLIENT ERROR]', err.message, err.stack);
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    server.httpsServer = httpsRuntime.httpsServer;
    server.httpsPort = httpsRuntime.httpsPort;
  }

  server.on('clientError', (err, socket) => {
    console.error('[HTTP CLIENT ERROR]', err.message, err.stack);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  if (legacyHooks.startupLog) legacyHooks.startupLog(server);
  if (legacyHooks.onServerStarted) legacyHooks.onServerStarted(server);
  if (services.localNodeAgent?.init) {
    await services.localNodeAgent.init({ pool, config });
  }

  // Graceful shutdown — allows in-flight requests to complete before Docker stop
  function shutdown(signal) {
    console.log(`[shutdown] ${signal} received — closing server`);
    server.close(async () => {
      try { await pool.end(); } catch (_) {}
      console.log('[shutdown] clean exit');
      process.exit(0);
    });
    // Force exit after 15 s if requests don't drain
    setTimeout(() => { console.error('[shutdown] force exit after timeout'); process.exit(1); }, 15000).unref();
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return { app, pool, server, httpsServer: httpsRuntime?.httpsServer || null, config };
}

module.exports = { startServer };
