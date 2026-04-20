'use strict';

require('dotenv').config();

const loadConfig = require('../config/loadConfig');
const createDbPool = require('../db/createDbPool');
const createServices = require('../services/createServices');
const createApp = require('./createApp');

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

  server.setTimeout(600000);
  server.keepAliveTimeout = 60000;
  server.headersTimeout = 61000;

  server.on('clientError', (err, socket) => {
    console.error('[HTTP CLIENT ERROR]', err.message, err.stack);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  if (legacyHooks.startupLog) legacyHooks.startupLog(server);
  if (legacyHooks.onServerStarted) legacyHooks.onServerStarted(server);

  return { app, pool, server, config };
}

module.exports = { startServer };
