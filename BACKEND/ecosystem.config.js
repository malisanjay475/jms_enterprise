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

      // --- Stability settings ---
      // Restart a worker if it uses more than 1 GB RAM (guards against memory leaks).
      // Was 512 MB: on the VPS the first worker (which also runs ERP AutoSync) sits
      // around 590-620 MB and was restarted every ~7 minutes (25-Sep-2026).
      max_memory_restart: '1G',

      // Delay between restarts so a crash-looping worker doesn't hammer the system.
      restart_delay: 3000,

      // Maximum restarts in a 60-second window before PM2 stops retrying.
      max_restarts: 10,
      min_uptime: '10s',

      // --- Graceful shutdown ---
      // Give in-flight requests up to 10 s to finish before killing the worker.
      kill_timeout: 10000,

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
