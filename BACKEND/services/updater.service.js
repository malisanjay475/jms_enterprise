const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');

let config = {};
let CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 Hour

const express = require('express');
const router = express.Router();

router.get('/check', (req, res) => {
    const currentVersion = require('../package.json').version;
    res.json({ version: currentVersion, url: '/api/update/download' });
});

router.get('/download', (req, res) => {
    const file = path.join(__dirname, '../updates/latest.zip');
    if (fs.existsSync(file)) {
        res.download(file);
    } else {
        res.status(404).json({ error: 'No update package found' });
    }
});

async function init(pool) {
    try {
        // Load Config
        const res = await pool.query('SELECT * FROM server_config');
        res.rows.forEach(r => config[r.key] = r.value);

        const SERVER_TYPE = config['SERVER_TYPE'] || 'MAIN';
        const MAIN_URL = config['MAIN_SERVER_URL'];

        if (SERVER_TYPE === 'LOCAL' && MAIN_URL) {
            console.log('[Updater] Auto-Update Service Started.');
            setInterval(() => checkUpdate(MAIN_URL), CHECK_INTERVAL_MS);
            // Check on startup
            setTimeout(() => checkUpdate(MAIN_URL), 30000);
        } else {
            console.log(`[Updater] Disabled (Mode: ${SERVER_TYPE}).`);
        }
    } catch (e) { console.error('[Updater] Init failed:', e); }
}

async function checkUpdate(mainUrl) {
    try {
        const localVersion = require('../package.json').version;
        console.log(`[Updater] Checking for updates. Current: ${localVersion}`);

        const res = await fetch(`${mainUrl}/api/update/check`);
        if (!res.ok) return;

        const remote = await res.json();
        if (remote.version !== localVersion) {
            console.log(`[Updater] New version found: ${remote.version}. Downloading...`);
            await downloadAndApply(mainUrl, remote.url);
        } else {
            console.log('[Updater] System is up to date.');
        }
    } catch (e) {
        console.error('[Updater] Check failed:', e.message);
    }
}

async function downloadAndApply(mainUrl, downloadPath) {
    const tmpPath = path.join(__dirname, '../temp_update.zip');
    const destPath = path.join(__dirname, '../');

    try {
        const res = await fetch(`${mainUrl}${downloadPath}`);
        const fileStream = fs.createWriteStream(tmpPath);

        await new Promise((resolve, reject) => {
            res.body.pipe(fileStream);
            res.body.on('error', reject);
            fileStream.on('finish', resolve);
        });

        console.log('[Updater] Download complete. Extracting...');

        const zip = new AdmZip(tmpPath);
        zip.extractAllTo(destPath, true);

        console.log('[Updater] Extraction complete. Restarting service...');

        // Cleanup
        fs.unlinkSync(tmpPath);

        // TRIGGER RESTART (Using PM2 or simple exit to let watcher restart)
        // If not using PM2, this might kill the process without restart.
        // Assuming PM2 or Service Wrapper:
        process.exit(0);

    } catch (e) {
        console.error('[Updater] Update failed:', e);
    }
}

module.exports = { init, router };
