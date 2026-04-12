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
        console.log('Checking for ean_number column in assembly_plans...');

        // Check if column exists
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='assembly_plans' AND column_name='ean_number'
        `);

        if (res.rows.length === 0) {
            console.log('Column missing. Adding ean_number...');
            await client.query(`ALTER TABLE assembly_plans ADD COLUMN ean_number TEXT`);
            console.log('SUCCESS: Column added.');
        } else {
            console.log('Column already exists.');
        }

    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
