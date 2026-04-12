const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

async function createTables() {
    const client = await pool.connect();
    try {
        console.log('Connected to database...');

        // 1. Users Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(255) PRIMARY KEY,
        password VARCHAR(255),
        line VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE
      );
    `);
        console.log('Created users table');

        // 2. Machines Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS machines (
        machine VARCHAR(255) PRIMARY KEY,
        line VARCHAR(50),
        building VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE
      );
    `);
        console.log('Created machines table');

        // 3. Plan Board Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS plan_board (
        id SERIAL PRIMARY KEY,
        plan_id VARCHAR(255) UNIQUE,
        plant VARCHAR(100),
        building VARCHAR(100),
        line VARCHAR(50),
        machine VARCHAR(255),
        seq INTEGER,
        order_no VARCHAR(255),
        item_code VARCHAR(255),
        item_name VARCHAR(255),
        mould_name VARCHAR(255),
        plan_qty NUMERIC,
        bal_qty NUMERIC,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        status VARCHAR(50) DEFAULT 'PLANNED',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
        console.log('Created plan_board table');

        // 4. Jobs Queue Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS jobs_queue (
        id SERIAL PRIMARY KEY,
        plan_id VARCHAR(255),
        machine VARCHAR(255),
        line VARCHAR(50),
        order_no VARCHAR(255),
        mould_no VARCHAR(255),
        jobcard_no VARCHAR(255),
        status VARCHAR(50),
        complete_img TEXT,
        complete_img_name VARCHAR(255),
        completed_by VARCHAR(255),
        completed_at TIMESTAMPTZ,
        complete_geo_lat NUMERIC,
        complete_geo_lng NUMERIC,
        complete_geo_acc NUMERIC
      );
    `);
        console.log('Created jobs_queue table');

        // 5. Std Actual Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS std_actual (
        id SERIAL PRIMARY KEY,
        plan_id VARCHAR(255),
        shift VARCHAR(50),
        dpr_date DATE,
        machine VARCHAR(255),
        line VARCHAR(50),
        order_no VARCHAR(255),
        mould_name VARCHAR(255),
        article_act NUMERIC,
        runner_act NUMERIC,
        cavity_act NUMERIC,
        cycle_act NUMERIC,
        pcshr_act NUMERIC,
        man_act NUMERIC,
        entered_by VARCHAR(255),
        sfgqty_act NUMERIC,
        operator_activities TEXT,
        geo_lat NUMERIC,
        geo_lng NUMERIC,
        geo_acc NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (plan_id, shift, dpr_date, machine)
      );
    `);
        console.log('Created std_actual table');

        // 6. DPR Hourly Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS dpr_hourly (
        id SERIAL PRIMARY KEY,
        dpr_date DATE,
        shift VARCHAR(50),
        hour_slot VARCHAR(50),
        shots NUMERIC,
        good_qty NUMERIC,
        reject_qty NUMERIC,
        downtime_min NUMERIC,
        remarks TEXT,
        line VARCHAR(50),
        machine VARCHAR(255),
        plan_id VARCHAR(255),
        order_no VARCHAR(255),
        mould_no VARCHAR(255),
        jobcard_no VARCHAR(255),
        colour VARCHAR(100),
        reject_breakup JSONB,
        downtime_breakup JSONB,
        entry_type VARCHAR(50) DEFAULT 'MAIN',
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        geo_lat NUMERIC,
        geo_lng NUMERIC,
        geo_acc NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
        console.log('Created dpr_hourly table');

        console.log('All tables created successfully!');
    } catch (err) {
        console.error('Error creating tables:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

createTables();
