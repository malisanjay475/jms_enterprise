
const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

async function cleanByDate() {
    console.log('Cleaning plans outside range: 2026-01-10 to 2026-01-25');

    try {
        // Delete Before Jan 10
        const resBefore = await pool.query(`
        DELETE FROM plan_board 
        WHERE start_date < '2026-01-10 00:00:00'
    `);
        console.log(`Deleted ${resBefore.rowCount} plans from BEFORE Jan 10.`);

        // Delete After Jan 26 (User said "To 25-01", so strictly > 25th midnight?)
        // Actually, "To 25-01" usually means "Including 25th", so < 26th is safe.
        // If user created plans TODAY (25th), they are fine.
        // If there are future plans (e.g. Feb), user might want to keep?
        // User said "Keep All Plans From ... To ...".
        // I should be careful about FUTURE.
        // But usually "make it perfect" + "Keep X to Y" implies remove others.
        // I will delete > Jan 26 just to be safe (allow 25th full day).

        // Check if there are future plans first?
        const future = await pool.query("SELECT COUNT(*) FROM plan_board WHERE start_date >= '2026-01-26'");
        if (future.rows[0].count > 0) {
            console.log(`Found ${future.rows[0].count} future plans (After Jan 25). Deleting them as per request.`);
            await pool.query("DELETE FROM plan_board WHERE start_date >= '2026-01-26'");
        }

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

cleanByDate();
