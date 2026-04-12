const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'Sanjay@541##',
    database: 'jpsms'
});

async function verifyAllJobs() {
    try {
        const res = await pool.query(`
            SELECT COUNT(DISTINCT or_jr_no) as report_jobs FROM or_jr_report
        `);
        const dpr = await pool.query(`
            SELECT COUNT(DISTINCT order_no) as production_jobs FROM dpr_hourly
        `);
        const unionCount = await pool.query(`
            SELECT COUNT(*) FROM (
                SELECT or_jr_no FROM or_jr_report
                UNION
                SELECT order_no FROM dpr_hourly
            ) sub
        `);

        console.log('Jobs in OR-JR Report:', res.rows[0].report_jobs);
        console.log('Jobs in DPR Hourly:', dpr.rows[0].production_jobs);
        console.log('Total Unique Jobs (Union):', unionCount.rows[0].count);

    } catch (err) {
        console.error('Verification failed:', err);
    } finally {
        await pool.end();
    }
}

verifyAllJobs();
