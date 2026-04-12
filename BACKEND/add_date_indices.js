const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

async function run() {
    const client = await pool.connect();
    try {
        console.log("Adding Date Indices for Reports...");

        // 1. Detail Report Index
        await client.query(`CREATE INDEX IF NOT EXISTS idx_mpr_plandate ON mould_planning_report(plan_date)`);

        // 2. Summary Report Index (if table exists)
        try {
            await client.query(`CREATE INDEX IF NOT EXISTS idx_mps_plandate ON mould_planning_summary(plan_date)`);
        } catch (e) {
            console.log("Summary table might not exist yet, skipping.");
        }

        console.log("Date Indices created successfully.");
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
run();
