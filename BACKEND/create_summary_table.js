const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

const createQuery = `
CREATE TABLE IF NOT EXISTS mould_planning_summary (
    id SERIAL PRIMARY KEY,
    or_jr_no TEXT,
    or_jr_date DATE,
    item_code TEXT,
    bom_type TEXT,
    product_name TEXT,
    jr_qty INTEGER,
    uom TEXT,
    plan_date DATE,
    plan_qty INTEGER,
    mould_no TEXT,
    mould_name TEXT,
    mould_item_qty INTEGER,
    tonnage INTEGER,
    machine_name TEXT,
    cycle_time NUMERIC,
    cavity INTEGER,
    created_by TEXT,
    created_date TIMESTAMP DEFAULT NOW(),
    edited_by TEXT,
    edited_date TIMESTAMP
);
`;

(async () => {
    try {
        await pool.query(createQuery);
        console.log("Table 'mould_planning_summary' created successfully.");
    } catch (err) {
        console.error("Error creating table:", err);
    } finally {
        await pool.end();
    }
})();
