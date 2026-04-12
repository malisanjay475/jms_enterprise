const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

const createTableQuery = `
CREATE TABLE IF NOT EXISTS or_jr_report (
    or_jr_no TEXT PRIMARY KEY,
    or_jr_date DATE,
    or_qty INTEGER,
    jr_qty INTEGER,
    plan_qty INTEGER,
    plan_date DATE,
    job_card_no TEXT,
    job_card_date DATE,
    item_code TEXT,
    product_name TEXT,
    client_name TEXT,
    prod_plan_qty INTEGER,
    std_pack INTEGER,
    uom TEXT,
    planned_comp_date DATE,
    mld_start_date DATE,
    mld_end_date DATE,
    actual_mld_start_date DATE,
    prt_tuf_end_date DATE,
    pack_end_date DATE,
    mld_status TEXT,
    shift_status TEXT,
    prt_tuf_status TEXT,
    pack_status TEXT,
    wh_status TEXT,
    rev_mld_end_date DATE,
    shift_comp_date DATE,
    rev_ptd_tuf_end_date DATE,
    rev_pak_end_date DATE,
    wh_rec_date DATE,
    remarks_all TEXT,
    jr_close TEXT,
    or_remarks TEXT,
    jr_remarks TEXT,
    created_by TEXT,
    created_date TIMESTAMP DEFAULT NOW(),
    edited_by TEXT,
    edited_date TIMESTAMP
);
`;

(async () => {
    try {
        await pool.query(createTableQuery);
        console.log("Table 'or_jr_report' created successfully.");
    } catch (err) {
        console.error("Error creating table:", err);
    } finally {
        await pool.end();
    }
})();
