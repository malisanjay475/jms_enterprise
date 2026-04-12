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
        console.log('Scanning for redundant Empty-JC records...');

        // 1. Count them first for logging
        const check = await pool.query(`
            SELECT count(*) as c
            FROM or_jr_report 
            WHERE (job_card_no IS NULL OR TRIM(job_card_no) = '') 
              AND or_jr_no IN (
                 SELECT or_jr_no 
                 FROM or_jr_report 
                 WHERE job_card_no IS NOT NULL AND TRIM(job_card_no) != ''
              )
        `);

        const count = check.rows[0].c;
        console.log(`Found ${count} duplicate/redundant empty records to delete.`);

        if (count > 0) {
            // 2. Delete
            const res = await pool.query(`
                DELETE FROM or_jr_report 
                WHERE (job_card_no IS NULL OR TRIM(job_card_no) = '') 
                  AND or_jr_no IN (
                     SELECT or_jr_no 
                     FROM or_jr_report 
                     WHERE job_card_no IS NOT NULL AND TRIM(job_card_no) != ''
                  )
            `);
            console.log(`Successfully deleted ${res.rowCount} rows.`);
        } else {
            console.log('No cleanup needed.');
        }

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
