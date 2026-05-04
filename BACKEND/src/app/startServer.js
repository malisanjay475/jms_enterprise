'use strict';

require('dotenv').config();

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
  console.log('-----------------------------------------');
  console.log('SERVER RELOADED WITH FIX (cleanEAN)');
  console.log('-----------------------------------------');

  const config = loadConfig();
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

  return { app, pool, server, httpsServer: httpsRuntime?.httpsServer || null, config };
}

module.exports = { startServer };
