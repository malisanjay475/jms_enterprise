const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Sanjay@541##', database: 'jpsms' });
async function run() {
    try {
        const res = await pool.query("SELECT * FROM dpr_hourly WHERE order_no = 'JR/JG/2526/5788' LIMIT 1;");
        console.log('Columns:', Object.keys(res.rows[0]));
        console.log('Data:', JSON.stringify(res.rows[0], null, 2));
    } catch(e) {
        console.error(e.message);
    } finally {
        await pool.end();
    }
}
run();
