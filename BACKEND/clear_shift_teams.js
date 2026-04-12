const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'jpsms',
    password: 'Sanjay@541##',
    port: 5432,
});

async function run() {
    try {
        console.log("Truncating shift_teams...");
        await pool.query("TRUNCATE TABLE shift_teams");
        console.log("Done.");
        pool.end();
    } catch (e) {
        console.error(e);
    }
}
run();
