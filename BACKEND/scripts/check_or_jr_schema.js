const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Sanjay@541##', database: 'jpsms' });
async function checkSchema() {
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'or_jr_report'");
        console.log("Schema of or_jr_report:");
        console.log(JSON.stringify(res.rows, null, 2));

        const dataRes = await pool.query("SELECT * FROM or_jr_report WHERE or_jr_no = 'JR/JG/2526/5788' LIMIT 5");
        console.log("\nSample data for JR/JG/2526/5788:");
        console.log(JSON.stringify(dataRes.rows, null, 2));
    } catch (e) {
        console.error(e.message);
    } finally {
        await pool.end();
    }
}
checkSchema();
