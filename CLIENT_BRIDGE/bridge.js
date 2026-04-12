const WebSocket = require('ws');
const net = require('net');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// CONFIG
const WS_PORT = 8999;
const BAUD_RATE = 9600;

console.log(`Starting JPSMS Serial Bridge on port ${WS_PORT}...`);

const wss = new WebSocket.Server({ port: WS_PORT });

// Track open ports
// Map<path, { port: SerialPort, parser: Parser }>
const openPorts = new Map();

wss.on('connection', (ws) => {
    console.log('Frontend Client connected.');

    // Send initial list
    listPorts().then(ports => {
        ws.send(JSON.stringify({ type: 'ports', ports }));
    });

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            console.log('Received:', msg);

            switch (msg.action) {
                case 'list':
                    const ports = await listPorts();
                    ws.send(JSON.stringify({ type: 'ports', ports }));
                    break;

                case 'open':
                    openPort(msg.path, ws, msg);
                    break;

                case 'close':
                    closePort(msg.path);
                    break;

                case 'open-tcp':
                    openTcpPort(msg.host, msg.port, ws);
                    break;

                case 'close-tcp':
                    closeTcpPort(msg.host, msg.port);
                    break;
            }
        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Frontend Client disconnected. (Keeping ports open for now, or optional cleanup)');
        // Optional: close all ports if client drops? 
        // Better to keep them open if user just refreshes page?
        // Let's keep specific logic simple for now.
    });
});

async function listPorts() {
    try {
        const ports = await SerialPort.list();
        return ports.map(p => ({
            path: p.path,
            manufacturer: p.manufacturer,
            serialNumber: p.serialNumber,
            pnpId: p.pnpId,
            friendlyName: p.friendlyName || p.path // Windows friendly name often undefined in basics
        }));
    } catch (e) {
        console.error('List Error:', e);
        return [];
    }
}

// LOCK
const pendingPorts = new Set();

function openPort(path, ws, options = {}) {
    if (openPorts.has(path)) {
        console.log(`Port ${path} already open. Updating client ownership.`);
        // UPDATE: Allow the new 'ws' to take over receiving data for this port.
        // This handles Page Refreshes where the port stays open but the old WS died.
        const entry = openPorts.get(path);
        entry.activeWs = ws;

        ws.send(JSON.stringify({ type: 'status', path, connected: true }));
        return;
    }

    // RACE CONDITION FIX:
    if (pendingPorts.has(path)) {
        console.log(`Port ${path} is currently opening. Ignoring duplicate request.`);
        return;
    }

    console.log(`Opening ${path}...`);
    pendingPorts.add(path);

    try {
        const portOptions = {
            path,
            baudRate: options.baudRate || BAUD_RATE
        };
        // Only add other options if they are NOT the defaults, as some drivers fail SetCommState with defaults
        if (options.dataBits && options.dataBits !== 8) portOptions.dataBits = options.dataBits;
        if (options.stopBits && options.stopBits !== 1) portOptions.stopBits = options.stopBits;
        if (options.parity && options.parity !== 'none') portOptions.parity = options.parity;

        const port = new SerialPort(portOptions);
        const parser = port.pipe(new ReadlineParser({ delimiter: '\r' })); // standard barcode

        port.on('open', () => {
            console.log(`${path} Opened.`);
            ws.send(JSON.stringify({ type: 'status', path, connected: true }));

            // Store activeWs in the entry so we can update it later
            const entry = { port, parser, activeWs: ws };
            openPorts.set(path, entry);
            pendingPorts.add(path); // Update: Mark as definitely in use
            pendingPorts.delete(path); // Clean opening state
        });

        port.on('data', (raw) => {
            console.log(`[${path}] RAW:`, raw.toString('hex'), `(${raw.toString().trim()})`);
            const entry = openPorts.get(path);
            const currentWs = entry ? entry.activeWs : ws;
            if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                currentWs.send(JSON.stringify({ type: 'raw', path, data: raw.toString('hex') }));
            }
        });

        port.on('error', (err) => {
            let errMsg = err.message;
            console.error(`${path} Error:`, errMsg);

            if (errMsg.includes('31')) {
                errMsg = "General Failure (Error 31). Please re-plug the scanner and check Device Manager.";
            } else if (errMsg.includes('Access denied')) {
                errMsg = "Port Busy. Ensure no other apps (e.g., Putty, Arduino) are using " + path;
            }

            ws.send(JSON.stringify({ type: 'error', path, message: errMsg }));
            openPorts.delete(path);
            pendingPorts.delete(path);
        });

        // FIX: Listen for 'close' to clean up state if unplugged or closed by error
        port.on('close', () => {
            if (openPorts.has(path)) {
                console.log(`${path} Closed (Event).`);
                openPorts.delete(path);
            }
            pendingPorts.delete(path);
        });

        // Use a more inclusive parser or handle manually
        // Standard Readline might miss data if the scanner doesn't send the exact delimiter
        parser.on('data', (data) => {
            const cleanData = data.toString().trim();
            if (cleanData) {
                console.log(`[${path}] Scanned: ${cleanData}`);
                const currentEntry = openPorts.get(path);
                const currentWs = currentEntry ? currentEntry.activeWs : ws;

                if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                    currentWs.send(JSON.stringify({ type: 'data', path, data: cleanData }));
                }
            }
        });

    } catch (e) {
        console.error(`Failed to open ${path}:`, e);
        ws.send(JSON.stringify({ type: 'error', path, message: e.message }));
        pendingPorts.delete(path);
    }
}

function closePort(path) {
    if (openPorts.has(path)) {
        const { port } = openPorts.get(path);
        if (port.isOpen) {
            port.close((err) => {
                if (err) console.error('Close Error:', err);
                else console.log(`${path} closed.`);
            });
        }
        openPorts.delete(path);
    }
}

function openTcpPort(host, port, ws) {
    const key = `${host}:${port}`;
    if (openPorts.has(key)) {
        console.log(`TCP ${key} already open. Updating client.`);
        const entry = openPorts.get(key);
        entry.activeWs = ws;
        ws.send(JSON.stringify({ type: 'status', path: key, connected: true }));
        return;
    }

    console.log(`Connecting to TCP Scanner at ${key}...`);
    const client = new net.Socket();

    // Store immediately to prevent race conditions
    // We don't have a parser stream for net.Socket, we handle data directly
    // Added buffer for TCP framing + Timeout 
    const entry = { port: client, activeWs: ws, type: 'tcp', buffer: '', flushTimer: null };
    openPorts.set(key, entry);

    client.connect(port, host, () => {
        console.log(`TCP ${key} Connected.`);
        ws.send(JSON.stringify({ type: 'status', path: key, connected: true }));
    });

    client.on('data', (data) => {
        const entry = openPorts.get(key);
        if (!entry) return;

        // Reset Flush Timer on new data
        if (entry.flushTimer) {
            clearTimeout(entry.flushTimer);
            entry.flushTimer = null;
        }

        entry.buffer += data.toString();

        // Check for delimiter immediately
        if (/[\r\n]/.test(entry.buffer)) {
            processBuffer(entry, key, ws);
        } else {
            // No delimiter yet? Wait a bit, maybe it's coming in next packet
            // If not, flush it anyway (Scanner might not send \r)
            entry.flushTimer = setTimeout(() => {
                processBuffer(entry, key, ws);
            }, 100); // 100ms timeout to flush raw data
        }
    });

    function processBuffer(entry, key, ws) {
        if (!entry.buffer) return;

        let parts = entry.buffer.split(/[\r\n]+/);

        // Clear buffer fast to avoid race
        entry.buffer = '';

        // If perfectly delimited, parts has empty string at end.
        // If not, we are forcing flush, so we consume EVERYTHING.

        parts.forEach(p => {
            const scan = p.trim();
            if (scan) sendData(key, scan, ws);
        });
    }

    function sendData(path, data, originalWs) {
        if (!data) return;
        console.log(`[${path}] TCP Recv: ${data}`);
        const currentEntry = openPorts.get(path);
        const currentWs = currentEntry ? currentEntry.activeWs : originalWs;
        if (currentWs && currentWs.readyState === WebSocket.OPEN) {
            currentWs.send(JSON.stringify({ type: 'data', path, data }));
        }
    }

    client.on('close', () => {
        console.log(`TCP ${key} Closed.`);
        openPorts.delete(key);
    });

    client.on('error', (err) => {
        console.error(`TCP ${key} Error:`, err.message);
        ws.send(JSON.stringify({ type: 'error', path: key, message: err.message }));
        openPorts.delete(key);
    });
}

function closeTcpPort(host, port) {
    const key = `${host}:${port}`;
    if (openPorts.has(key)) {
        const entry = openPorts.get(key);
        if (entry.type === 'tcp' && entry.port) {
            entry.port.destroy(); // TCP socket destroy
        }
        openPorts.delete(key);
    }
}

console.log('Bridge Ready. Run this script on the CLIENT PC.');
console.log('Ensure "npm install serialport ws" is run first.');
