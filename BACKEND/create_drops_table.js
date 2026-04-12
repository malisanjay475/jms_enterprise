const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres:password@localhost:5432/jpsms', // Adjust as needed, assuming env var usually
    // For this script I'll use process.env or hardcode typical dev defaults if not present
});

// Load Env if possible, or just try typical default
if (!process.env.DATABASE_URL) {
    // defaults
}

async function run() {
    const client = await pool.connect();
    try {
        console.log('Creating planning_drops table...');
        await client.query(`
      CREATE TABLE IF NOT EXISTS planning_drops (
        id SERIAL PRIMARY KEY,
        order_no TEXT NOT NULL,
        item_code TEXT,
        mould_no TEXT,
        mould_name TEXT,
        remarks TEXT,
        dropped_by TEXT DEFAULT 'User',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('Table planning_drops created (or existed).');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
