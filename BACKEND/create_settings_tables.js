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
        await client.query('BEGIN');

        // 1. App Settings Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        console.log("Table app_settings created.");

        // Insert Default Geofence Setting if not exists
        await client.query(`
            INSERT INTO app_settings (key, value) 
            VALUES ('geofence_enabled', 'false') 
            ON CONFLICT (key) DO NOTHING;
        `);

        // 2. DPR Reasons Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS dpr_reasons (
                id SERIAL PRIMARY KEY,
                type TEXT NOT NULL, -- 'REJECTION' or 'DOWNTIME'
                reason TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("Table dpr_reasons created.");

        await client.query('COMMIT');
        console.log("Settings initialization complete.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
run();
