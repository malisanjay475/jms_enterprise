const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Sanjay@541##', database: 'jpsms' });
async function run() {
    try {
        const orderNo = 'JR/JG/2526/5788';
        const mouldNo = '4 SIDE LOCK 9000 RECTANGLE BTM';
        const res = await pool.query(`
            SELECT COUNT(*) 
            FROM dpr_hourly dh
            LEFT JOIN plan_board pb ON dh.plan_id = pb.plan_id
            LEFT JOIN moulds m ON dh.mould_no = m.erp_item_code
            WHERE dh.order_no = $1 AND dh.is_deleted = false 
            AND (dh.mould_no = $2 OR pb.mould_name = $2 OR m.product_name = $2)
        `, [orderNo, mouldNo]);
        console.log('Count:', res.rows[0].count);

        const res2 = await pool.query(`
            SELECT DISTINCT pb.mould_name 
            FROM dpr_hourly dh
            LEFT JOIN plan_board pb ON dh.plan_id = pb.plan_id
            WHERE dh.order_no = $1
        `, [orderNo]);
        console.log('Distinct names:', res2.rows);
    } catch(e) { console.error(e.message); } finally { await pool.end(); }
}
run();
