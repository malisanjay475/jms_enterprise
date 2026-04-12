
const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

async function archiveClosed() {
    console.log('Archiving (Deleting) PLANNED items that are Closed...');

    try {
        // Select IDs first for logging/safety (optional, skipping for speed)
        const res = await pool.query(`
        DELETE FROM plan_board 
        WHERE status = 'PLANNED'
          AND order_no IN (
             SELECT or_jr_no FROM or_jr_report WHERE jr_close = 'Close'
          )
    `);

        console.log(`Deleted ${res.rowCount} Closed Plans.`);

        // Verify count
        const count = await pool.query('SELECT COUNT(*) FROM plan_board');
        console.log(`Remaining Plans: ${count.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

archiveClosed();
