'use strict';

require('dotenv').config();

const { initSentry } = require('../monitoring/sentry');
const fs = require('fs');
const https = require('https');
const path = require('path');
const loadConfig = require('../config/loadConfig');
const createDbPool = require('../db/createDbPool');
const runMigrations = require('./runMigrations');
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

  return new Promise((resolve, reject) => {
    httpsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[HTTPS] Port ${httpsPort} already in use — HTTPS server skipped, HTTP only. Server will NOT crash.`);
        resolve(null);
      } else {
        reject(err);
      }
    });
    httpsServer.listen(httpsPort, '0.0.0.0', () => resolve({ httpsServer, httpsPort }));
  });
}

async function startServer() {
  const config = loadConfig();
  initSentry(config.sentryDsn);
  const pool = createDbPool(config);
  await runMigrations(pool);
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

  // Track every open socket so shutdown can force-close them. Without this,
  // server.close() waits forever for idle keep-alive / half-closed (CLOSE_WAIT)
  // connections to end — which is exactly how the old process wedged and kept
  // holding the port after a restart, blocking the new process from binding.
  const openSockets = new Set();
  const trackSocket = (socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
  };
  server.on('connection', trackSocket);

  if (httpsRuntime?.httpsServer) {
    httpsRuntime.httpsServer.on('connection', trackSocket);
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

  // Pre-compress static assets (.js/.css → .br/.gz) off the request path so the
  // factory PC serves them without re-compressing on every cache miss. Runs
  // after listen (non-blocking) and is idempotent, so restarts/syncs are cheap.
  setImmediate(() => {
    try {
      const precompressAssets = require('../../scripts/precompress-assets');
      const publicDir = path.join(process.cwd(), fs.existsSync(path.join(process.cwd(), 'PUBLIC')) ? 'PUBLIC' : 'public');
      const t0 = Date.now();
      const r = precompressAssets(publicDir);
      console.log(`[precompress] ${r.files} assets, ${r.written} written, ${r.skipped} up-to-date in ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn('[precompress] skipped:', e.message);
    }
  });
  if (services.localNodeAgent?.init) {
    await services.localNodeAgent.init({ pool, config });
  }

  // Graceful, DETERMINISTIC shutdown. Give in-flight requests a short grace
  // window, then force-close every remaining socket so the listener always
  // releases the port. A hard fallback guarantees the process exits even if
  // something hangs — the process must NEVER linger holding the port.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — draining (${openSockets.size} open sockets)`);

    // Stop accepting new connections.
    server.close(() => console.log('[shutdown] http listener closed'));
    if (httpsRuntime?.httpsServer) {
      try { httpsRuntime.httpsServer.close(); } catch (_) {}
    }
    // Stop keep-alive so idle connections don't block the close.
    server.keepAliveTimeout = 1;

    // After a brief grace period, destroy anything still open (stuck/CLOSE_WAIT).
    setTimeout(() => {
      for (const socket of openSockets) {
        try { socket.destroy(); } catch (_) {}
      }
      openSockets.clear();
      Promise.resolve()
        .then(() => pool.end())
        .catch(() => {})
        .finally(() => {
          console.log('[shutdown] clean exit');
          process.exit(0);
        });
    }, 3000);

    // Absolute hard stop — always fires, never unref'd, so the process can
    // never get stuck mid-shutdown holding the port.
    setTimeout(() => {
      console.error('[shutdown] hard force exit');
      process.exit(0);
    }, 8000);
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return { app, pool, server, httpsServer: httpsRuntime?.httpsServer || null, config };
}

module.exports = { startServer };
