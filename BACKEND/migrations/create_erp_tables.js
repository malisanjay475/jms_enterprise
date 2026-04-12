const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Sanjay@541##',
    database: process.env.DB_NAME || 'jpsms'
});

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('[Migration] Starting ERP Tables Creation...');

        await client.query('BEGIN');

        // 1. ERP Sync Log
        // Tracks every hit to the API for audit
        await client.query(`
      CREATE TABLE IF NOT EXISTS erp_sync_log (
        id SERIAL PRIMARY KEY,
        endpoint VARCHAR(100),
        status VARCHAR(20),     -- 'SUCCESS', 'FAILED', 'PENDING'
        payload_hash VARCHAR(64), -- To prevent processing duplicate identical payloads
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log(' - erp_sync_log created/verified');

        // 2. BOM Master (Versioning Support)
        // Structure: One Product has many Versions. Only one 'is_active' usually.
        await client.query(`
      CREATE TABLE IF NOT EXISTS bom_master (
        id SERIAL PRIMARY KEY,
        erp_bom_id VARCHAR(255),  -- ID from ERP side
        product_code VARCHAR(100),
        version INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      -- Index for quick lookup
      CREATE INDEX IF NOT EXISTS idx_bom_product ON bom_master(product_code);
    `);
        console.log(' - bom_master created/verified');

        // 3. BOM Components
        // Linked to bom_master
        await client.query(`
      CREATE TABLE IF NOT EXISTS bom_components (
        id SERIAL PRIMARY KEY,
        bom_master_id INTEGER REFERENCES bom_master(id) ON DELETE CASCADE,
        component_code VARCHAR(100),
        description TEXT,
        qty_per_unit NUMERIC(10, 4),
        uom VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log(' - bom_components created/verified');

        // 4. Ensure JC/Mould columns exist (JSONB data)
        // We expect 'jc_details' to likely store the raw JSON from ERP in a 'data' column
        // or we might map fields. Based on snippet, 'jc_details' uses 'data' JSONB.
        await client.query(`
      CREATE TABLE IF NOT EXISTS jc_details (
         id SERIAL PRIMARY KEY,
         data JSONB,
         created_at TIMESTAMP DEFAULT NOW(),
         updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        // Add unique constraint on job_card_no to support upsert
        // We need a functional index or a constraint. 
        // Since data is JSONB, we create a unique index on the extracted field.
        await client.query(`
       CREATE UNIQUE INDEX IF NOT EXISTS idx_jc_details_unique_jc_no 
       ON jc_details ((data->>'job_card_no'));
    `);
        console.log(' - jc_details & index created/verified');

        // 5. Plan Board (Mould Plan) - Ensure ERP columns
        // We might need 'otp_ref_no' or 'erp_ref_id'
        await client.query(`
       ALTER TABLE plan_board ADD COLUMN IF NOT EXISTS erp_ref_id VARCHAR(255);
    `);

        await client.query('COMMIT');
        console.log('[Migration] ERP Tables Setup Complete.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[Migration] Failed:', e);
        process.exit(1);
    } finally {
        client.release();
        pool.end();
    }
}

runMigration();
