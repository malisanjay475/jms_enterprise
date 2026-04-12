require('dotenv').config();
const { Pool } = require('pg');

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
        console.log('Running Scanning Migration...');

        // 1. Create assembly_scans table
        await client.query(`
            CREATE TABLE IF NOT EXISTS assembly_scans (
                id SERIAL PRIMARY KEY,
                plan_id INTEGER,
                scanned_ean TEXT,
                is_match BOOLEAN DEFAULT FALSE,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT fk_plan FOREIGN KEY(plan_id) REFERENCES assembly_plans(id)
            )
        `);
        console.log('Created assembly_scans table.');

        // 2. Add scanned_qty to assembly_plans
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='assembly_plans' AND column_name='scanned_qty'
        `);

        if (res.rows.length === 0) {
            await client.query(`ALTER TABLE assembly_plans ADD COLUMN scanned_qty INTEGER DEFAULT 0`);
            console.log('Added scanned_qty column to assembly_plans.');
        } else {
            console.log('scanned_qty column already exists.');
        }

    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
