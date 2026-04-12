const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'Sanjay@541##',
    database: 'jpsms'
});

async function testApi() {
    const orderNo = 'JR/JG/2526/5788';
    try {
        const res = await pool.query(`
            SELECT 
                o.or_jr_no,
                o.job_card_no,
                ord.client_name
            FROM or_jr_report o
            LEFT JOIN orders ord ON ord.order_no = o.or_jr_no
            WHERE o.or_jr_no = $1
        `, [orderNo]);
        
        console.log('Order Metadata:', res.rows);

        const dpr = await pool.query(`
            SELECT COUNT(*) as dpr_entries 
            FROM dpr_hourly 
            WHERE order_no = $1
        `, [orderNo]);

        console.log('DPR Entries:', dpr.rows[0]);
    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        await pool.end();
    }
}

testApi();
