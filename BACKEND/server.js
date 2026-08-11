'use strict';

// Pin the process timezone to India Standard Time BEFORE anything else loads, so
// all local-time date logic ("today", Day/Night shift, DPR/ERP date parsing) is
// correct on every deployment. MAIN gets TZ=Asia/Kolkata from its Docker env, but
// the LOCAL Windows/PM2 factory servers run bare node and inherit the machine's
// timezone — a mis-set box (e.g. US Pacific) then computes the wrong day/shift.
// Respect an explicitly-provided TZ (e.g. MAIN's Docker env) and only default here.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const { startServer } = require('./src/app/startServer');

startServer().catch((error) => {
  console.error('[BOOT] Failed to start server:', error);
  process.exit(1);
});
