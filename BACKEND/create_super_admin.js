const { Pool } = require('pg');

// Use defaults matching server.js if env vars are missing
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'Sanjay@541##',
    database: process.env.PGDATABASE || 'jpsms'
});

async function q(sql, params) {
    const client = await pool.connect();
    try {
        const res = await client.query(sql, params);
        return res.rows;
    } finally {
        client.release();
    }
}

async function createSuperAdmin() {
    const username = 'superadmin';
    const password = 'admin123'; // Default password
    const role = 'admin';
    const line = null;
    const permissions = JSON.stringify({
        dashboard: { view: true, edit: true, print: true, other: true },
        planning: { view: true, edit: true, print: true, other: true },
        masters: { view: true, edit: true, print: true, other: true },
        users: { view: true, edit: true, print: true, other: true }
    });

    try {
        console.log(`Creating user: ${username}...`);
        // Check if user exists first to log what we are doing
        const existing = await q('SELECT * FROM users WHERE username = $1', [username]);
        if (existing.length) {
            console.log('User already exists, updating...');
        } else {
            console.log('User does not exist, creating...');
        }

        await q(
            `INSERT INTO users (username, password, line, role_code, permissions)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET
         password = EXCLUDED.password,
         role_code = EXCLUDED.role_code,
         permissions = EXCLUDED.permissions,
         is_active = true`,
            [username, password, line, role, permissions]
        );
        console.log('Super Admin created/updated successfully!');
        console.log(`Username: ${username}`);
        console.log(`Password: ${password}`);
    } catch (e) {
        console.error('Error creating superadmin:', e);
    } finally {
        pool.end();
    }
}

createSuperAdmin();
