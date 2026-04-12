
const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres', host: 'localhost', database: 'jpsms',
  password: 'Sanjay@541##', port: 5432,
});

async function cleanup() {
  try {
    // For HYD-300-10 specifically
    const res1 = await pool.query(`
      DELETE FROM dpr_hourly 
      WHERE id = 138000
    `);
    console.log("Deleted duplicate for HYD-300-10:", res1.rowCount);

    // General cleanup for other duplicates if they are exactly the same
    // We'll just target the ones we found
    const dups = [137714, 137841, 137850, 137800, 138196, 138216, 138143];
    const res2 = await pool.query(`
      DELETE FROM dpr_hourly 
      WHERE id = ANY($1)
    `, [dups]);
    console.log("Deleted other duplicates:", res2.rowCount);

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
cleanup();
