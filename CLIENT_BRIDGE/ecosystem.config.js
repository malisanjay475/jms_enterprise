'use strict';

// PM2 configuration for the JMS Scanner Bridge (factory PC).
//
// Keeps the ESP32 packing / production scanners connected 24/7 and auto-starts
// on boot, independent of any open browser tab.
//
// Usage (on the factory PC, from this CLIENT_BRIDGE folder):
//   npm install
//   pm2 start ecosystem.config.js
//   pm2 save          # remember it across reboots
//   pm2 startup       # print the command that registers PM2 on OS boot
//
// IMPORTANT: this MUST stay a single fork instance (not cluster). The ESP32
// sketch accepts only one TCP client, so exactly one bridge process may own
// each scanner socket. Running multiple workers would make them fight over the
// same scanner and drop connections.

module.exports = {
  apps: [
    {
      name: 'jms-scanner-bridge',
      script: 'bridge.js',

      // Single owner — do NOT switch to cluster / multiple instances.
      instances: 1,
      exec_mode: 'fork',

      // --- Stability ---
      max_memory_restart: '256M',
      restart_delay: 4000,
      max_restarts: 20,
      min_uptime: '10s',

      // --- Logging ---
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // --- Environment ---
      // The LOCAL backend the bridge posts scans to. Override here if this
      // factory box does not run its backend on http://localhost:3001.
      env: {
        NODE_ENV: 'production',
        JMS_BACKEND_URL: 'http://localhost:3001'
        // JMS_PLANS_POLL_MS: 5000,       // active-plan refresh cadence
        // JMS_LINES_POLL_MS: 15000,      // scanner-config refresh cadence
        // JMS_TCP_RECONNECT_MS: 4000,    // ESP32 reconnect delay
      }
    }
  ]
};
