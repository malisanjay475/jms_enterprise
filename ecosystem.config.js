module.exports = {
  apps: [
    {
      name: 'jms-legacy-backend',
      cwd: './BACKEND',
      script: 'server.js',
      env: {
        NODE_ENV: 'development',
        PORT: 5003,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5003,
      },
    },
  ],
};
