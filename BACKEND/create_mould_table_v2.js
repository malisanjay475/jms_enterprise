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
        // Drop to recreate with proper columns for the detailed report
        await client.query('DROP TABLE IF EXISTS mould_planning_report');

        // Create Table with Superset of Columns (Detail Report + OR-JR base)
        // Mapping:
        // A: OR/JR No (or_jr_no)
        // B: JR Date (or_jr_date)
        // C: Our Code (item_code)
        // D: BomType (bom_type)
        // E: JR Item Name (product_name)
        // F: JR Qty (jr_qty)
        // G: UOM (uom)
        // H: Plan Date (plan_date)
        // I: Plan Qty (plan_qty)
        // J: Mold Item Code (mould_item_code)
        // K: Mold Item Name (mould_item_name)
        // L: Mould No (mould_no)
        // M: Mould (mould_name)
        // N: Mould Item Qty (mould_item_qty)
        // O: Tonnage (tonnage)
        // P: Machine (machine_name)
        // Q: Cycle Time (cycle_time)
        // R: Cavity (cavity)

        // Plus meta columns: _status, created_xxx, edited_xxx

        await client.query(`
      CREATE TABLE mould_planning_report (
        or_jr_no TEXT PRIMARY KEY,
        or_jr_date TEXT, 
        item_code TEXT, 
        bom_type TEXT,
        product_name TEXT, 
        jr_qty TEXT, 
        uom TEXT,
        plan_date TEXT, 
        plan_qty TEXT,
        mould_item_code TEXT,
        mould_item_name TEXT,
        mould_no TEXT,
        mould_name TEXT,
        mould_item_qty TEXT,
        tonnage TEXT,
        machine_name TEXT,
        cycle_time TEXT,
        cavity TEXT,
        
        -- Meta / Extra from previous (keep specific ones if needed, or just generic)
        -- We'll keep standard meta
        _status TEXT,
        created_by TEXT, 
        created_date TIMESTAMP DEFAULT NOW(),
        edited_by TEXT, 
        edited_date TIMESTAMP DEFAULT NOW(),
        
        -- Extra columns from compatible OR-JR structure if we want to reuse logic easily?
        -- Nah, let's stick to the requested columns strictly + meta.
        -- But to avoid "missing column" errors if we reuse OR-JR logic, we might need dummies?
        -- No, we will write specific logic.
        
        -- Actually, keeping "remarks_all" is generally good for Reports.
        remarks_all TEXT
      );
    `);

        console.log("Table mould_planning_report re-created with new schema.");
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
run();
