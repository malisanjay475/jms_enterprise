const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Sanjay%40541%23%23@localhost:5432/jpsms' });

client.connect().then(async () => {
    try {
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND (table_name ILIKE '%reason%' 
                   OR table_name ILIKE '%code%' 
                   OR table_name ILIKE '%master%'
                   OR table_name ILIKE '%downtime%')
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        client.end();
    }
});
