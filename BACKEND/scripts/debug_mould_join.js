const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Sanjay@541##', database: 'jpsms' });
async function run() {
    try {
        const res = await pool.query(`
            SELECT DISTINCT dh.mould_no as dpr_mould_no, dh.plan_id, pb.mould_name as pb_mould_name
            FROM dpr_hourly dh
            LEFT JOIN plan_board pb ON dh.plan_id = pb.plan_id
            WHERE dh.order_no = 'JR/JG/2526/5788'
        `);
        console.log('dpr_hourly moulds with plan_board links:');
        console.log(res.rows);
    } catch(e) { console.error(e.message); } finally { await pool.end(); }
}
run();
