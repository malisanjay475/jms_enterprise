const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'jpsms'
});

async function run() {
    const client = await pool.connect();
    try {
        console.log("Starting Cloud User Creation...");

        // 1. Get All Active Factories
        console.log("Fetching Remote Factories...");
        const facRes = await client.query("SELECT id, name FROM factories WHERE is_active = true");
        const factories = facRes.rows;

        if (factories.length === 0) {
            console.log("No factories found! creating defaults...");
            // Fallback logic if needed, but we saw factories exists
        }

        console.log(`Found ${factories.length} factories: ${factories.map(f => f.name).join(', ')}`);

        // 1.5 Fix Sequence (in case of sync issues)
        console.log("Fixing Users Sequence...");
        try {
            await client.query("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))");
        } catch (seqErr) {
            console.warn("Sequence fix warning (might be using different sequence name):", seqErr.message);
        }

        // 2. Create User
        const username = 'cloud_admin';
        const rawPass = 'admin123';
        const hash = await bcrypt.hash(rawPass, 10);

        console.log(`Creating/Updating User: ${username}...`);

        // Check if exists
        const uRes = await client.query("SELECT id FROM users WHERE username = $1", [username]);
        let userId;

        if (uRes.rows.length > 0) {
            userId = uRes.rows[0].id;
            await client.query("UPDATE users SET password = $1, role_code = 'admin', is_active = true WHERE id = $2", [hash, userId]);
            console.log("User updated.");
        } else {
            const ins = await client.query(`
                INSERT INTO users (username, password, role_code, is_active, permissions)
                VALUES ($1, $2, 'admin', true, '{}')
                RETURNING id
            `, [username, hash]);
            userId = ins.rows[0].id;
            console.log("User created.");
        }

        // 3. Assign Factories
        console.log(`Assigning User ${userId} to Factories...`);
        await client.query("DELETE FROM user_factories WHERE user_id = $1", [userId]);

        for (const f of factories) {
            await client.query("INSERT INTO user_factories (user_id, factory_id) VALUES ($1, $2)", [userId, f.id]);
        }

        console.log("User Setup Complete!");
        console.log("------------------------------------------------");
        console.log(`Username: ${username}`);
        console.log(`Password: ${rawPass}`);
        console.log("factories: Factory A, Factory B");
        console.log("------------------------------------------------");

    } catch (e) {
        console.error("Error:", e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
