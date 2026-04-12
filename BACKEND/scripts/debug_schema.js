const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Sanjay%40541%23%23@localhost:5432/jpsms' });

client.connect().then(async () => {
    try {
        console.log("Checking tables...");
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND (table_name ILIKE 'user%' OR table_name ILIKE 'dpr_hourly')
        `);
        console.log("Tables found:", tables.rows);

        for (const table of tables.rows) {
            const cols = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = '${table.table_name}'
            `);
            console.log(`Columns for ${table.table_name}:`, cols.rows.map(c => c.column_name));
        }

    } catch (e) {
        console.error(e);
    } finally {
        client.end();
    }
});
