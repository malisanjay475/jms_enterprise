const { Client } = require('pg');

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'jpsms',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    port: 5432,
});

async function run() {
    try {
        await client.connect();
        console.log('Connected.');

        // 1. Create Audit Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS plan_audit_logs (
        id SERIAL PRIMARY KEY,
        plan_id INT,
        action VARCHAR(50), -- ACTIVATE, DELETE, SWAP
        details JSONB,        -- Snapshot of machine, order, etc.
        user_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log('Created table plan_audit_logs.');

        // 2. Add indexes
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON plan_audit_logs(created_at DESC);`);
        console.log('Indexes created.');

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.end();
    }
}

run();
