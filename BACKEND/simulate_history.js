
const { Client } = require('pg');

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'jpsms',
    password: 'Sanjay@541##',
    port: 5432,
});

async function run() {
    await client.connect();

    const mouldId = '9822-HANDLE'; // Using an existing ID from logs
    const user = 'DebugUser';

    console.log(`--- Simulating Update for ${mouldId} ---`);

    // 1. Get Old Data
    const oldRes = await client.query('SELECT * FROM moulds WHERE erp_item_code = $1', [mouldId]);
    if (!oldRes.rows.length) { console.log('Mould not found'); return; }
    const oldData = oldRes.rows[0];

    // 2. Simulate Change (Primary Machine)
    const updates = {
        primary_machine: 'Test-Machine-1',
        secondary_machine: 'Test-Machine-2'
    };

    // Explicitly using the logic from server.js to test IT
    const changed = {};
    let hasChanges = false;
    const fields = ['primary_machine', 'secondary_machine']; // Testing these specifically

    for (const f of fields) {
        if (updates[f] !== undefined) {
            const val = updates[f];
            // Simple string comparison for test
            if (val != oldData[f]) {
                changed[f] = { old: oldData[f], new: val };
                hasChanges = true;
            }
        }
    }

    if (hasChanges) {
        console.log('Changes detected:', changed);

        // 3. Update DB
        await client.query(`
            UPDATE moulds 
            SET primary_machine = $1, secondary_machine = $2 
            WHERE erp_item_code = $3
        `, [updates.primary_machine, updates.secondary_machine, mouldId]);

        // 4. Insert Audit
        await client.query(`
            INSERT INTO mould_audit_logs (mould_id, action_type, changed_fields, changed_by)
            VALUES ($1, 'UPDATE', $2, $3)
        `, [mouldId, JSON.stringify(changed), user]);

        console.log('Update simulated and logged.');
    } else {
        console.log('No changes detected compared to DB.');
    }

    console.log("--- Checking Logs After Update ---");
    const logRes = await client.query(`
        SELECT * FROM mould_audit_logs 
        WHERE changed_by = $1 
        ORDER BY changed_at DESC LIMIT 1
    `, [user]);
    console.table(logRes.rows);

    await client.end();
}

run().catch(e => console.error(e));
