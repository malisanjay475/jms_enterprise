const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

async function addMissingColumns() {
    const client = await pool.connect();
    try {
        console.log('Adding missing columns to orders table...');

        // Add remarks column
        await client.query(`
            ALTER TABLE orders 
            ADD COLUMN IF NOT EXISTS remarks TEXT;
        `);
        console.log('Added remarks column.');

        // Add client_name column (suspected missing)
        await client.query(`
            ALTER TABLE orders 
            ADD COLUMN IF NOT EXISTS client_name VARCHAR(255);
        `);
        console.log('Added client_name column.');

    } catch (err) {
        console.error('Error adding columns:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

addMissingColumns();
