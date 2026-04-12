const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

async function updateSchema() {
    const client = await pool.connect();
    try {
        console.log('Connected to database...');

        // 1. Update Users Table (Add role)
        await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role_code VARCHAR(50) DEFAULT 'operator',
      ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';
    `);
        console.log('Updated users table');

        // 2. Orders Master
        await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_no VARCHAR(255) UNIQUE NOT NULL,
        item_code VARCHAR(255),
        item_name VARCHAR(255),
        mould_code VARCHAR(255),
        qty NUMERIC DEFAULT 0,
        balance NUMERIC DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Pending',
        priority VARCHAR(50) DEFAULT 'Normal',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
        console.log('Created orders table');

        // 3. Moulds Master
        await client.query(`
      CREATE TABLE IF NOT EXISTS moulds (
        mould_code VARCHAR(255) PRIMARY KEY,
        mould_name VARCHAR(255),
        cavity INTEGER DEFAULT 1,
        cycle_time NUMERIC,
        compatible_machines JSONB DEFAULT '[]',
        active BOOLEAN DEFAULT TRUE
      );
    `);
        console.log('Created moulds table');

        // 4. Job Cards Master
        await client.query(`
      CREATE TABLE IF NOT EXISTS job_cards (
        jobcard_no VARCHAR(255) PRIMARY KEY,
        item_code VARCHAR(255),
        description TEXT,
        parameter_json JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
        console.log('Created job_cards table');

        // 5. Update Machines Table
        await client.query(`
      ALTER TABLE machines
      ADD COLUMN IF NOT EXISTS capacity NUMERIC,
      ADD COLUMN IF NOT EXISTS tonnage NUMERIC;
    `);
        console.log('Updated machines table');

        console.log('Schema update complete!');
    } catch (err) {
        console.error('Error updating schema:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

updateSchema();
