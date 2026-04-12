const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: '127.0.0.1',
  database: 'jpsms',
  password: 'Sanjay@541##',
  port: 55432
});

const hash = '$2b$10$t8m9swC7Xtbuy39dB9FGher1s4.797oOjJlcaRoLk5TvlifIwp0AO'; // Sanjay@123

pool.query('UPDATE users SET password = $1 WHERE username = $2', [hash, 'Sanjay'])
  .then(() => {
    console.log('Password reset successfully for user Sanjay on DOCKER port 55432');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error resetting password on Docker:', err);
    process.exit(1);
  });
