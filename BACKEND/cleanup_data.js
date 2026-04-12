
const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'jpsms',
  password: 'Sanjay@541##',
  port: 5432,
});

async function cleanup() {
  try {
    const res = await pool.query(`
      DELETE FROM dpr_hourly 
      WHERE dpr_date = '2026-03-13' 
      AND shift = 'Day' 
      AND hour_slot = '07-08'
      RETURNING id, machine, hour_slot, created_at
    `);
    console.log("Deleted erroneous entries:", res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
cleanup();
