const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'jpsms',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    port: process.env.PGPORT || 5432,
});

async function migrate() {
    try {
        console.log('Creating assembly_lines table...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS assembly_lines (
                line_id TEXT PRIMARY KEY,
                line_name TEXT,
                scanner_config TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Backfilling existing table_ids...');
        // Insert existing table_ids from plans if they don't exist
        const res = await pool.query(`
            INSERT INTO assembly_lines (line_id, line_name)
            SELECT DISTINCT table_id, table_id 
            FROM assembly_plans 
            WHERE table_id IS NOT NULL
            ON CONFLICT (line_id) DO NOTHING;
        `);

        console.log(`Backfilled ${res.rowCount} lines.`);
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        pool.end();
    }
}

migrate();
