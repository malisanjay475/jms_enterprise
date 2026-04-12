const net = require('net');

const IP = process.argv[2] || '192.168.1.228';
const COMMON_PORTS = [23, 80, 443, 2000, 3000, 4001, 5000, 5001, 6001, 8000, 8080, 9000, 9001, 9002, 9100, 502, 515];

console.log(`Scanning ports on ${IP}...`);

let pending = 0;

COMMON_PORTS.forEach(port => {
    pending++;
    const s = new net.Socket();
    s.setTimeout(2000);

    s.on('connect', () => {
        console.log(`\x1b[32m[OPEN]  Port ${port} is OPEN!\x1b[0m`);
        s.destroy();
    });

    s.on('timeout', () => {
        s.destroy();
    });

    s.on('error', (e) => {
        // console.log(`[CLOSED] Port ${port} (${e.message})`);
    });

    s.on('close', () => {
        pending--;
        if (pending === 0) console.log('Scan Complete.');
    });

    s.connect(port, IP);
});
