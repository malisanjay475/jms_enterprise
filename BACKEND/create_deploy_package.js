const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const pkg = require('./package.json');
const VERSION = pkg.version;

console.log(`Creating Deployment Package for v${VERSION}...`);

const zip = new AdmZip();

// Folders to include
const folders = ['public', 'services', 'routes', 'scripts', 'uploads', 'nginx', 'middleware', 'migrations'];
// Files to include
const files = ['server.js', 'package.json', '.env.example', 'docker-compose.yml', 'Dockerfile', 'setup_factory.bat'];

// Special handling for backup file (it might be in root OR scripts)
const backupFile = 'jpsms_backup.sql';
if (fs.existsSync(path.join(__dirname, 'scripts', backupFile))) {
    zip.addLocalFile(path.join(__dirname, 'scripts', backupFile));
    console.log(`Added file: scripts/${backupFile}`);
} else if (fs.existsSync(backupFile)) {
    zip.addLocalFile(backupFile);
    console.log(`Added file: ${backupFile}`);
} else {
    console.error('WARNING: jpsms_backup.sql NOT FOUND! Deployment will miss database.');
}

// Add Files
files.forEach(f => {
    if (fs.existsSync(f)) {
        zip.addLocalFile(f);
        console.log(`Added file: ${f}`);
    }
});

// Add Folders
folders.forEach(d => {
    if (fs.existsSync(d)) {
        zip.addLocalFolder(d, d); // (path, zipPath)
        console.log(`Added folder: ${d}`);
    }
});

// Output Dir
const updatesDir = path.join(__dirname, 'updates');
if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir);

const outFile = path.join(updatesDir, 'latest.zip');
zip.writeZip(outFile);

console.log(`Package created at: ${outFile}`);
