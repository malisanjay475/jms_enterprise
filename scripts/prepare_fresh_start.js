const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { execSync } = require('child_process');

// Config
const rootDir = path.resolve(__dirname, '..'); 
const DB_USER = 'postgres'; 
const DB_NAME = 'jpsms';
const DB_PASS = "Sanjay@541##"; 
const BACKUP_DIR = path.join(rootDir, 'BACKUPS');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
const SCHEMA_FILE = path.join(BACKUP_DIR, `jpsms_schema_${TIMESTAMP}.sql`);
const ZIP_FILE = path.join(BACKUP_DIR, `JPSMS_FRESH_START_${TIMESTAMP}.zip`);

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

console.log('==========================================');
console.log('   JPSMS FRESH START BACKUP');
console.log('==========================================');

try {
    // 1. Dump Schema
    console.log(`[1/3] Dumping Schema for '${DB_NAME}'...`);
    const pgPath = '"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe"'; 
    try {
        execSync(`${pgPath} -s -U ${DB_USER} ${DB_NAME} > "${SCHEMA_FILE}"`, { env: { ...process.env, PGPASSWORD: DB_PASS } });
    } catch (e) {
        try {
            execSync(`pg_dump -s -U ${DB_USER} ${DB_NAME} > "${SCHEMA_FILE}"`, { env: { ...process.env, PGPASSWORD: DB_PASS } });
        } catch (e2) {
             console.log('Warning: pg_dump not in PATH, attempting to find it...');
             // Try standard Postgres paths
             let found = false;
             for (let v of ['18','17','16','15','14','13']) {
                 const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`;
                 if (fs.existsSync(p)) {
                     execSync(`"${p}" -s -U ${DB_USER} ${DB_NAME} > "${SCHEMA_FILE}"`, { env: { ...process.env, PGPASSWORD: DB_PASS } });
                     found = true;
                     break;
                 }
             }
             if (!found) throw new Error('Could not find pg_dump.exe. Please ensure PostgreSQL is installed.');
        }
    }
    console.log('      Schema dump successful.');

    // 2. Create Zip
    console.log(`[2/3] Zipping Codebase (excluding node_modules and logs)...`);
    const zip = new AdmZip();

    function addRecursive(currentPath) {
        const items = fs.readdirSync(currentPath);
        items.forEach(item => {
            const fullPath = path.join(currentPath, item);
            const relativePath = path.relative(rootDir, fullPath);
            
            // Stats (follow symlinks? No, for code it's simple)
            const stats = fs.statSync(fullPath);

            // Exclusions
            if (item === 'node_modules' || item === 'BACKUPS' || item === '.git' || item === '.next' || item === 'tmp' || item === '.gemini') return;
            if (item.endsWith('.log') || item.endsWith('.zip') || item.endsWith('.tar.gz') || (item.endsWith('.sql') && fullPath !== SCHEMA_FILE)) return;

            if (stats.isDirectory()) {
                addRecursive(fullPath);
            } else {
                const zipFolder = path.dirname(relativePath);
                zip.addLocalFile(fullPath, zipFolder === '.' ? '' : zipFolder);
            }
        });
    }

    addRecursive(rootDir);
    
    // Add schema dump
    zip.addLocalFile(SCHEMA_FILE, '');

    console.log('      Writing archive (this may take a moment)...');
    zip.writeZip(ZIP_FILE);
    console.log(`[3/3] Created: ${ZIP_FILE}`);

    // Cleanup
    fs.unlinkSync(SCHEMA_FILE);

    console.log('==========================================');
    console.log('   SUCCESS: Backup package created!');
    console.log(`   Location: ${ZIP_FILE}`);
    console.log('==========================================');

} catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
}
