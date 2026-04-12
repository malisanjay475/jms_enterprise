
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const BACKUP_DIR = path.join(__dirname, '../BACKUPS');
const PG_DUMP_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
const MAX_BACKUPS = 12; // Keep last 1 hour (12 * 5min)

// Ensure backup dir exists
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function runBackup() {
    const date = new Date();
    const timestamp = date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0') + '_' +
        String(date.getHours()).padStart(2, '0') + '-' +
        String(date.getMinutes()).padStart(2, '0');

    const filename = `backup_${timestamp}.sql`;
    const filePath = path.join(BACKUP_DIR, filename);

    console.log(`[Backup] Starting backup: ${filename}`);

    const env = {
        ...process.env,
        PGPASSWORD: process.env.PGPASSWORD || 'Sanjay@541##'
    };

    const args = [
        '-h', process.env.PGHOST || 'localhost',
        '-p', process.env.PGPORT || '5432',
        '-U', process.env.PGUSER || 'postgres',
        '-d', process.env.PGDATABASE || 'jpsms',
        '-f', filePath
    ];

    const child = spawn(PG_DUMP_PATH, args, { env });

    child.on('exit', (code) => {
        if (code === 0) {
            console.log(`[Backup] Success: ${filename}`);
            rotateBackups();
        } else {
            console.error(`[Backup] Failed with code ${code}`);
        }
    });

    child.on('error', (err) => {
        console.error('[Backup] Process Error:', err);
    });
}

function rotateBackups() {
    fs.readdir(BACKUP_DIR, (err, files) => {
        if (err) return console.error('[Backup] Rotation Error:', err);

        const backups = files.filter(f => f.startsWith('backup_') && f.endsWith('.sql'));

        if (backups.length > MAX_BACKUPS) {
            // Sort by time (oldest first)
            // Since filename has timestamp YYYY-MM-DD_HH-mm, string sort works
            backups.sort();

            const toDelete = backups.slice(0, backups.length - MAX_BACKUPS);

            toDelete.forEach(f => {
                fs.unlink(path.join(BACKUP_DIR, f), (e) => {
                    if (e) console.error(`[Backup] Failed to delete ${f}:`, e);
                    else console.log(`[Backup] Rotated/Deleted: ${f}`);
                });
            });
        }
    });
}

// Export start function
module.exports = {
    start: () => {
        console.log('[Backup] Service Started. Schedule: Every 5 minutes.');
        // Run immediately on start? Maybe wait 1 min?
        // Let's run immediately for test, then interval.
        runBackup();
        setInterval(runBackup, 5 * 60 * 1000); // 5 minutes
    }
};
