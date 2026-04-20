'use strict';

const fs = require('fs');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const examplePath = path.join(backendDir, '.env.local-v1.example');
const envPath = path.join(backendDir, '.env');
const force = process.argv.includes('--force');

if (!fs.existsSync(examplePath)) {
  throw new Error(`Missing example env file: ${examplePath}`);
}

if (fs.existsSync(envPath) && !force) {
  console.log(`Existing .env kept at ${envPath}`);
  console.log('Use --force to overwrite it from .env.local-v1.example');
  process.exit(0);
}

fs.copyFileSync(examplePath, envPath);

console.log(`Created ${envPath}`);
console.log('Next step: update DB_PASSWORD and any local connection values before starting the backend.');
