const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Sanjay@541##', database: 'jpsms' });
async function run() {
    try {
        const res = await pool.query("SELECT DISTINCT mould_no FROM dpr_hourly WHERE order_no = 'JR/JG/2526/5788'");
        console.log('Distinct moulds in dpr_hourly for order:', res.rows);
        const res2 = await pool.query("SELECT * FROM moulds WHERE erp_item_code = '3612' OR product_name ILIKE '%4 SIDE LOCK 9000 RECTANGLE BTM%'");
        console.log('Mould details from moulds table:', res2.rows);
        const res3 = await pool.query("SELECT * FROM or_jr_report WHERE or_jr_no = 'JR/JG/2526/5788' LIMIT 1");
        console.log('or_jr_report:', res3.rows[0].item_code, res3.rows[0].product_name);
    } catch(e) {
        console.error(e.message);
    } finally {
        await pool.end();
    }
}
run();
