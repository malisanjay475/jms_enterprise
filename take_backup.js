const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('./BACKEND/node_modules/adm-zip');

// Configuration
const DB_USER = 'postgres';
const DB_NAME = 'jpsms';
const DB_PASS = 'Sanjay@541##';
const DB_PORT = '5433';
const DB_HOST = '127.0.0.1';
const PG_DUMP_PATH = '"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe"';
const ROOT_DIR = __dirname;
const BACKUP_NAME = `JPSMS_COMPLETE_BACKUP_${new Date().toISOString().replace(/[:.]/g, '-')}`;
const ZIP_FILE = path.join(ROOT_DIR, `${BACKUP_NAME}.zip`);
const DB_SQL_FILE = path.join(ROOT_DIR, 'jpsms_dump.sql');

console.log('--- JPSMS COMPLETE SYSTEM BACKUP ---');

try {
    // 1. Export Database
    console.log(`[1/3] Exporting Database '${DB_NAME}'...`);
    execSync(`${PG_DUMP_PATH} -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} ${DB_NAME} > "${DB_SQL_FILE}"`, {
        env: { ...process.env, PGPASSWORD: DB_PASS }
    });
    console.log('      Database exported successfully.');

    // 2. Create ZIP Archive
    console.log(`[2/3] Creating ZIP archive...`);
    const zip = new AdmZip();

    // Add Database Dump
    zip.addLocalFile(DB_SQL_FILE);

    // Folders to include (everything in root except node_modules, .git, and huge logs)
    const items = fs.readdirSync(ROOT_DIR);
    items.forEach(item => {
        const fullPath = path.join(ROOT_DIR, item);
        const stats = fs.statSync(fullPath);

        // Exclusions
        if (item === '.git' || item === 'node_modules' || item.endsWith('.zip') || item === 'BACKUPS' || item === '.gemini') {
            return;
        }

        if (stats.isDirectory()) {
            console.log(`      Adding directory: ${item}...`);
            // Custom logic for BACKEND to exclude node_modules and huge logs
            if (item === 'BACKEND') {
                const backendZip = new AdmZip();
                const backendItems = fs.readdirSync(fullPath);
                backendItems.forEach(bItem => {
                    const bPath = path.join(fullPath, bItem);
                    if (bItem === 'node_modules' || bItem === 'debug_query.log' || bItem === 'BACKUPS') return;
                    
                    const bStats = fs.statSync(bPath);
                    if (bStats.isDirectory()) {
                        zip.addLocalFolder(bPath, `BACKEND/${bItem}`);
                    } else {
                        zip.addLocalFile(bPath, 'BACKEND');
                    }
                });
                // Also include node_modules if it's small (we checked, it's 22MB)
                // Actually, let's include node_modules as requested "Everything"
                zip.addLocalFolder(path.join(fullPath, 'node_modules'), 'BACKEND/node_modules');
            } else {
                zip.addLocalFolder(fullPath, item);
            }
        } else {
            console.log(`      Adding file: ${item}...`);
            zip.addLocalFile(fullPath);
        }
    });

    // 3. Save ZIP
    console.log(`[3/3] Saving final archive...`);
    zip.writeZip(ZIP_FILE);
    
    // Cleanup SQL file
    fs.unlinkSync(DB_SQL_FILE);

    console.log('------------------------------------');
    console.log('   BACKUP COMPLETED SUCCESSFULLY!');
    console.log(`   File: ${ZIP_FILE}`);
    console.log('------------------------------------');

} catch (error) {
    console.error('Backup Failed:', error.message);
    process.exit(1);
}
