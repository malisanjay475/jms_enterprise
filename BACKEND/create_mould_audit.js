const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

(async () => {
    const client = await pool.connect();
    try {
        console.log('Creating mould_audit_logs table...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS mould_audit_logs (
                id SERIAL PRIMARY KEY,
                mould_id TEXT NOT NULL,          -- Links to moulds.erp_item_code or custom ID
                action_type TEXT NOT NULL,       -- CREATE, UPDATE, DELETE
                changed_fields JSONB,            -- Stores { "field": { "old": val, "new": val } }
                changed_by TEXT,                 -- User who made the change
                changed_at TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log('Table mould_audit_logs created successfully.');

        // Index for fast history lookup
        await client.query(`CREATE INDEX IF NOT EXISTS idx_mould_audit_id ON mould_audit_logs(mould_id)`);
        console.log('Index created on mould_id.');

    } catch (err) {
        console.error("Error creating table:", err);
    } finally {
        client.release();
        await pool.end();
    }
})();
