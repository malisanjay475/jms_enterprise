module.exports = {
  apps: [
    {
      name: 'jms-v2-backend',
      script: './dist/main.js',
      instances: 'max',       // 10/10 Scaling: Spin up 1 process per physical CPU core
      exec_mode: 'cluster',   // Cluster mode balances HTTP traffic across cores
      watch: false,
      max_memory_restart: '2G', // Auto-restart if a massive sync payload crashes node's garbage collector
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Zero-Downtime Settings
      wait_ready: true,
      listen_timeout: 50000,
      kill_timeout: 10000, // Wait 10s for active HTTP sync requests to finish before killing
    },
    {
      name: 'jms-v2-frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3001',
      instances: 1,
      env_production: {
        NODE_ENV: 'production',
      }
    }
  ]
};
