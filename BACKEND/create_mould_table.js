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
        // Drop first to ensure clean state with correct columns
        await client.query('DROP TABLE IF EXISTS mould_planning_report');

        // Create Table with EXACT columns from OR-JR
        await client.query(`
      CREATE TABLE mould_planning_report (
        or_jr_no TEXT PRIMARY KEY,
        or_jr_date TEXT, 
        or_qty TEXT, 
        jr_qty TEXT, 
        plan_qty TEXT, 
        plan_date TEXT, 
        job_card_no TEXT, 
        job_card_date TEXT, 
        item_code TEXT, 
        product_name TEXT, 
        client_name TEXT, 
        prod_plan_qty TEXT, 
        std_pack TEXT, 
        uom TEXT, 
        planned_comp_date TEXT, 
        mld_start_date TEXT, 
        mld_end_date TEXT, 
        actual_mld_start_date TEXT, 
        prt_tuf_end_date TEXT, 
        pack_end_date TEXT, 
        mld_status TEXT, 
        shift_status TEXT, 
        prt_tuf_status TEXT, 
        pack_status TEXT, 
        wh_status TEXT, 
        rev_mld_end_date TEXT, 
        shift_comp_date TEXT, 
        rev_ptd_tuf_end_date TEXT, 
        rev_pak_end_date TEXT, 
        wh_rec_date TEXT, 
        remarks_all TEXT, 
        jr_close TEXT, 
        or_remarks TEXT, 
        jr_remarks TEXT, 
        created_by TEXT, 
        created_date TIMESTAMP DEFAULT NOW(),
        edited_by TEXT, 
        edited_date TIMESTAMP DEFAULT NOW()
      );
    `);

        console.log("Table mould_planning_report created successfully with exact OR-JR schema.");
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
run();
