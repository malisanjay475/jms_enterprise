const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Sanjay%40541%23%23@localhost:5432/jpsms' });

client.connect().then(async () => {
    try {
        const res = await client.query(`
            SELECT dpr_date::text, count(1) as cnt 
            FROM dpr_hourly 
            WHERE order_no = 'JR/JG/2526/5788' 
            GROUP BY dpr_date 
            ORDER BY dpr_date DESC 
            LIMIT 10
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        client.end();
    }
});
