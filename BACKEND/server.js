'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SAFETY NET — must be registered BEFORE any other require()
// so it catches errors from any module, including legacy routes.
//
// Node.js 15+ exits on unhandledRejection by default.  These handlers keep
// the process alive and log the error so PM2 / Docker can decide when to
// restart (controlled by restart policies, not a crash cascade).
// ─────────────────────────────────────────────────────────────────────────────
process.on('uncaughtException', (err, origin) => {
  console.error('[FATAL] uncaughtException — process will continue (check root cause!)');
  console.error(`  origin : ${origin}`);
  console.error(`  error  : ${err && err.stack ? err.stack : err}`);
  // Do NOT exit — let PM2 / Docker handle lifecycle.
  // If the error corrupts critical state the health-check will catch it.
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WARN] unhandledRejection — caught by global safety net');
  console.error(`  promise: ${promise}`);
  console.error(`  reason : ${reason && reason.stack ? reason.stack : reason}`);
  // Do NOT exit — unhandled rejections from setInterval / sync timers
  // must not bring down the entire server.
});

const { startServer } = require('./src/app/startServer');

startServer().catch((error) => {
  console.error('[BOOT] Failed to start server:', error);
  // On boot failure we DO exit so PM2 / Docker can restart cleanly.
  process.exit(1);
});
