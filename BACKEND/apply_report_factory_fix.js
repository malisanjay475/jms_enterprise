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
        console.log("Checking schema for mould_planning_report...");
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'mould_planning_report'
        `);
        const columns = res.rows.map(r => r.column_name);
        console.log("Existing columns:", columns.join(', '));

        if (!columns.includes('factory_id')) {
            console.log("Adding factory_id column...");
            await client.query('ALTER TABLE mould_planning_report ADD COLUMN factory_id INTEGER');
        }

        if (!columns.includes('bo_uom')) {
            console.log("Adding bo_uom column...");
            await client.query('ALTER TABLE mould_planning_report ADD COLUMN bo_uom TEXT');
        }

        if (!columns.includes('updated_at')) {
            console.log("Adding updated_at column...");
            await client.query('ALTER TABLE mould_planning_report ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()');
        }

        // Add index for factory_id if not present
        await client.query('CREATE INDEX IF NOT EXISTS idx_mpr_factory ON mould_planning_report(factory_id)');
        
        // Ensure the unique constraint is correct for BO Planning Detail
        // We want (or_jr_no, mould_no, mould_item_code, plan_date) to be unique
        console.log("Ensuring unique constraint for planning details...");
        try {
            await client.query('ALTER TABLE mould_planning_report DROP CONSTRAINT IF EXISTS mould_report_strict_uniq_idx');
        } catch (e) {}
        
        // Add a more comprehensive constraint for both ORJR Wise Detail and BO Planning Detail
        await client.query(`
            ALTER TABLE mould_planning_report 
            ADD CONSTRAINT mould_report_planning_uniq 
            UNIQUE (or_jr_no, mould_no, mould_item_code, plan_date)
        `);

        console.log("Migration complete.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
