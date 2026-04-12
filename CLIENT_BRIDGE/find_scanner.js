const { exec } = require('child_process');
const net = require('net');
const os = require('os');

// Scanner Ports to check
const SCANNER_PORTS = [9000, 23, 2000, 3000, 4001, 502, 80, 8080];

function getLocalBaseIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal && net.address.startsWith('192.168.')) {
                return net.address.split('.').slice(0, 3).join('.');
            }
        }
    }
    return '192.168.1';
}

const BASE_IP = getLocalBaseIp();
console.log(`Searching for Scanners on ${BASE_IP}.x (Parallel Mode)...`);
console.log(`Checking ports: ${SCANNER_PORTS.join(', ')}`);

const activeIps = [];

// 1. Ping Scan
async function pingScan() {
    const promises = [];
    for (let i = 1; i < 255; i++) {
        const ip = `${BASE_IP}.${i}`;
        promises.push(new Promise(resolve => {
            exec(`ping -n 1 -w 100 ${ip}`, (err, stdout) => {
                if (!err && stdout.includes('TTL=')) {
                    // process.stdout.write('.');
                    activeIps.push(ip);
                }
                resolve();
            });
        }));
    }
    await Promise.all(promises);
    console.log(`Found ${activeIps.length} active devices.`);
}

// 2. Port Scan (Parallel)
async function portScan() {
    console.log('Scanning ports...');
    const scanners = [];

    // Create a massive list of checks
    const checks = [];
    for (const ip of activeIps) {
        for (const port of SCANNER_PORTS) {
            checks.push(checkPort(ip, port).then(isOpen => {
                if (isOpen) {
                    console.log(`\x1b[32m[MATCH] ${ip}:${port}\x1b[0m`);
                    scanners.push({ ip, port });
                }
            }));
        }
    }

    // Run all checks in parallel (might hit header limit, but usually fine for 500 socket requests)
    // To be safe, we could batch, but 500 is low enough for Node.
    await Promise.all(checks);

    console.log('\n--- POTENTIAL SCANNERS ---');
    if (scanners.length === 0) console.log('No devices found with open scanner ports.');

    // Sort by IP
    scanners.sort((a, b) => {
        const lastA = parseInt(a.ip.split('.')[3]);
        const lastB = parseInt(b.ip.split('.')[3]);
        return lastA - lastB;
    });

    scanners.forEach(s => console.log(`Scanner found at: ${s.ip}:${s.port}`));
    console.log('--------------------------');
}

function checkPort(ip, port) {
    return new Promise(resolve => {
        const s = new net.Socket();
        s.setTimeout(1000); // 1s timeout is fine if parallel
        s.on('connect', () => { s.destroy(); resolve(true); });
        s.on('timeout', () => { s.destroy(); resolve(false); });
        s.on('error', () => { resolve(false); }); // Need to catch error to prevent crash
        s.connect(port, ip);
    });
}

(async () => {
    await pingScan();
    await portScan();
})();
