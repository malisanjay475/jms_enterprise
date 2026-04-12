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
        console.log("Adding indices for performance...");

        // 1. Index on mould_planning_report.or_jr_no (Already exists? idx_mpr_order)
        // Let's make sure.
        await client.query(`CREATE INDEX IF NOT EXISTS idx_mpr_order ON mould_planning_report(or_jr_no)`);

        // 2. Index on mould_planning_report.item_code (For Joins)
        await client.query(`CREATE INDEX IF NOT EXISTS idx_mpr_item ON mould_planning_report(item_code)`);

        // 3. Index on moulds.erp_item_code (For Joins)
        await client.query(`CREATE INDEX IF NOT EXISTS idx_moulds_erp_item ON moulds(erp_item_code)`);

        // 4. Index on mould_planning_report.status (For filtering Pending)
        await client.query(`CREATE INDEX IF NOT EXISTS idx_mpr_status ON mould_planning_report(_status)`);

        console.log("Indices created successfully.");
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
run();
