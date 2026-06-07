'use strict';

// PM2 Cluster Configuration for JMS Enterprise
// Runs one worker per CPU core so all cores handle requests in parallel.
// Nginx proxies to port 3000 — PM2 cluster listens on the same port across all workers.

module.exports = {
  apps: [
    {
      name: 'jms-backend',
      script: 'server.js',

      // 'max' = one worker per available CPU core.
      // On a 2-core VPS this means 2 workers; on 4-core it means 4, etc.
      // Each worker is a full Node.js process sharing the same port via SO_REUSEPORT.
      instances: 'max',
      exec_mode: 'cluster',

      // --- Node.js memory flags ---
      // Give Node.js 1.5 GB heap before GC pressure triggers.
      // Previous 512M limit was too low for large Excel exports & sync cycles.
      node_args: '--max-old-space-size=1536',

      // --- Stability settings ---
      // REMOVED max_memory_restart — the 512M limit was killing workers during
      // large sync / Excel exports. Node's own GC handles heap; PM2 memory-kill
      // was causing false-positive crashes on the factory LOCAL server.
      // If you need a safety net on a very memory-constrained machine, uncomment:
      // max_memory_restart: '1500M',

      // Delay between restarts so a crash-looping worker doesn't hammer the system.
      restart_delay: 5000,

      // NO max_restarts cap — always restart. The global uncaughtException handler
      // in server.js keeps the process alive for transient errors; PM2 restarts
      // cover any case where the process does exit. Factory server must never
      // stay down because PM2 gave up after N restarts.
      // (Remove the following two lines entirely — omitting max_restarts means
      //  PM2 v5 defaults to "no limit", which is what we want.)
      // max_restarts: 10   ← intentionally removed
      min_uptime: '5s',

      // --- Graceful shutdown ---
      // Give in-flight requests up to 15 s to finish before killing the worker.
      kill_timeout: 15000,
      listen_timeout: 10000,

      // --- Logging ---
      // Merge stdout/stderr into a single log per worker. Docker captures these.
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // --- Environment ---
      // Inherit all env vars from the Docker container (.env / docker-compose envs).
      // Do NOT hard-code secrets here.
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
