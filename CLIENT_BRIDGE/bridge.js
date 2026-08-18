const WebSocket = require('ws');
const net = require('net');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// CONFIG
const WS_PORT = 8999;
const BAUD_RATE = 9600;

// Backend the bridge posts scans to. On the factory PC the LOCAL backend
// listens on 3001; override with JMS_BACKEND_URL when needed.
const BACKEND_URL = (process.env.JMS_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
// How often the persistent manager re-reads line config + active plans.
const LINES_POLL_MS = Number(process.env.JMS_LINES_POLL_MS || 15000);
const PLANS_POLL_MS = Number(process.env.JMS_PLANS_POLL_MS || 5000);
// Reconnect delay for a dropped ESP32 socket.
const TCP_RECONNECT_MS = Number(process.env.JMS_TCP_RECONNECT_MS || 4000);

console.log(`Starting JPSMS Serial Bridge on port ${WS_PORT}...`);
console.log(`[Persistent] Backend: ${BACKEND_URL}`);

const wss = new WebSocket.Server({ port: WS_PORT });

// Track open ports
// Map<path, { port: SerialPort, parser: Parser }>
const openPorts = new Map();

// Every connected browser tab. Persistent-scanner activity is broadcast to
// all of them so any open packing/production page shows live status + counts.
const browserClients = new Set();

// Always-on ESP32 scanners the bridge owns, keyed by assembly line_id (table).
// Map<line_id, { host, port, socket, connected, buffer, flushTimer, reconnectTimer }>
const persistentScanners = new Map();
// line_id (table) -> currently active plan_id, refreshed from /api/assembly/active.
const tablePlan = new Map();

function broadcastToBrowsers(payload) {
    const msg = JSON.stringify(payload);
    for (const ws of browserClients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
}

wss.on('connection', (ws) => {
    console.log('Frontend Client connected.');
    browserClients.add(ws);

    // Send initial list
    listPorts().then(ports => {
        ws.send(JSON.stringify({ type: 'ports', ports }));
    });

    // Bring the new tab up to date on every persistent scanner we own.
    for (const [lineId, s] of persistentScanners) {
        ws.send(JSON.stringify({
            type: 'scanner-status',
            table_id: lineId,
            path: `${s.host}:${s.port}`,
            connected: s.connected,
            persistent: true
        }));
    }

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
        browserClients.delete(ws);
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

    // If the persistent manager already owns this ESP32, do NOT open a second
    // TCP socket — the ESP32 only accepts one client and would reject it. The
    // bridge is already scanning + posting for this table; just tell the tab
    // it's connected so the UI reflects the live persistent link.
    for (const s of persistentScanners.values()) {
        if (s.host === host && String(s.port) === String(port)) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'status', path: key, connected: s.connected }));
            }
            console.log(`TCP ${key} is persistent-owned; browser attached in monitor mode.`);
            return;
        }
    }

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


// =====================================================
// PERSISTENT SCANNER MANAGER
// -----------------------------------------------------
// Keeps every IP-configured ESP32 scanner connected 24/7, independent of any
// browser tab. On each barcode it resolves the table's active plan and POSTs
// the scan to the backend itself, then broadcasts the result to any open page.
// =====================================================

async function backendJson(path, options) {
    const res = await fetch(`${BACKEND_URL}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options && options.headers) }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
}

// Parse an assembly_lines.scanner_config into { host, port } if it is an IP
// scanner, else null. Accepts "IP:host:port" and bare "host:port".
function parseIpConfig(cfg) {
    if (!cfg) return null;
    let val = String(cfg).trim();
    if (/^IP:/i.test(val)) val = val.slice(3);
    else if (/^(BRIDGE:|COM)/i.test(val)) return null; // COM/serial — page-owned
    const m = val.match(/^([^:\s]+):(\d+)$/);
    if (!m) return null;
    return { host: m[1], port: parseInt(m[2], 10) };
}

// Refresh table -> active plan map. "Auto: newest RUNNING plan per table":
// prefer the latest RUNNING plan; fall back to the latest active plan.
async function refreshActivePlans() {
    try {
        const { data } = await backendJson('/api/assembly/active', { method: 'GET' });
        const byTable = new Map();
        for (const p of (data || [])) {
            const tid = p.table_id;
            if (!tid) continue;
            const cur = byTable.get(tid);
            const better = (a, b) => {
                if (!b) return true;
                const ar = a.status === 'RUNNING', br = b.status === 'RUNNING';
                if (ar !== br) return ar;                       // RUNNING wins
                return new Date(a.start_time || 0) >= new Date(b.start_time || 0); // else newest
            };
            if (better(p, cur)) byTable.set(tid, p);
        }
        tablePlan.clear();
        for (const [tid, p] of byTable) tablePlan.set(tid, p.id);
    } catch (e) {
        console.error('[Persistent] active-plans refresh failed:', e.message);
    }
}

// Reconcile configured IP scanners: open new ones, drop removed ones.
async function refreshScannerConfig() {
    try {
        const { data } = await backendJson('/api/assembly/lines', { method: 'GET' });
        const wanted = new Map();
        for (const line of (data || [])) {
            const ip = parseIpConfig(line.scanner_config);
            if (ip) wanted.set(line.line_id, ip);
        }

        // Remove scanners no longer configured (or whose host/port changed).
        for (const [lineId, s] of persistentScanners) {
            const w = wanted.get(lineId);
            if (!w || w.host !== s.host || String(w.port) !== String(s.port)) {
                console.log(`[Persistent] Dropping scanner for ${lineId} (config changed/removed).`);
                teardownPersistentScanner(lineId);
            }
        }

        // Add newly configured scanners.
        for (const [lineId, ip] of wanted) {
            if (!persistentScanners.has(lineId)) {
                console.log(`[Persistent] New scanner ${lineId} -> ${ip.host}:${ip.port}`);
                persistentScanners.set(lineId, {
                    host: ip.host, port: ip.port,
                    socket: null, connected: false,
                    buffer: '', flushTimer: null, reconnectTimer: null
                });
                connectPersistentScanner(lineId);
            }
        }
    } catch (e) {
        console.error('[Persistent] scanner-config refresh failed:', e.message);
    }
}

function teardownPersistentScanner(lineId) {
    const s = persistentScanners.get(lineId);
    if (!s) return;
    if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
    if (s.flushTimer) clearTimeout(s.flushTimer);
    if (s.socket) { try { s.socket.destroy(); } catch (_) {} }
    persistentScanners.delete(lineId);
    broadcastToBrowsers({ type: 'scanner-status', table_id: lineId, connected: false, persistent: true });
}

function schedulePersistentReconnect(lineId) {
    const s = persistentScanners.get(lineId);
    if (!s || s.reconnectTimer) return;
    s.reconnectTimer = setTimeout(() => {
        s.reconnectTimer = null;
        connectPersistentScanner(lineId);
    }, TCP_RECONNECT_MS);
}

function connectPersistentScanner(lineId) {
    const s = persistentScanners.get(lineId);
    if (!s) return;

    const key = `${s.host}:${s.port}`;
    const socket = new net.Socket();
    s.socket = socket;
    s.buffer = '';

    socket.connect(s.port, s.host, () => {
        s.connected = true;
        console.log(`[Persistent] ${lineId} connected -> ${key}`);
        broadcastToBrowsers({ type: 'scanner-status', table_id: lineId, path: key, connected: true, persistent: true });
    });

    socket.on('data', (data) => {
        if (s.flushTimer) { clearTimeout(s.flushTimer); s.flushTimer = null; }
        s.buffer += data.toString();
        if (/[\r\n]/.test(s.buffer)) {
            flushPersistentBuffer(lineId);
        } else {
            s.flushTimer = setTimeout(() => flushPersistentBuffer(lineId), 100);
        }
    });

    const drop = (why) => {
        if (s.connected) console.log(`[Persistent] ${lineId} ${why} -> ${key}`);
        s.connected = false;
        broadcastToBrowsers({ type: 'scanner-status', table_id: lineId, path: key, connected: false, persistent: true });
        schedulePersistentReconnect(lineId);
    };

    socket.on('close', () => drop('closed'));
    socket.on('error', (err) => {
        // Don't spam; connect errors fire before 'close'.
        if (s.connected) console.error(`[Persistent] ${lineId} error: ${err.message}`);
    });
}

function flushPersistentBuffer(lineId) {
    const s = persistentScanners.get(lineId);
    if (!s || !s.buffer) return;
    const parts = s.buffer.split(/[\r\n]+/);
    s.buffer = '';
    for (const p of parts) {
        const scan = p.trim();
        if (scan) handlePersistentScan(lineId, scan);
    }
}

async function handlePersistentScan(lineId, ean) {
    const key = persistentScanners.has(lineId)
        ? `${persistentScanners.get(lineId).host}:${persistentScanners.get(lineId).port}` : '';
    const planId = tablePlan.get(lineId);

    if (!planId) {
        console.warn(`[Persistent] ${lineId} scan ${ean} ignored — no active plan.`);
        broadcastToBrowsers({ type: 'scan-result', table_id: lineId, path: key, ean, ok: false, error: 'No active plan for table' });
        return;
    }

    try {
        const result = await backendJson('/api/assembly/scan', {
            method: 'POST',
            body: JSON.stringify({ plan_id: planId, ean })
        });
        console.log(`[Persistent] ${lineId} scan ${ean} -> plan ${planId}: ${JSON.stringify(result)}`);
        broadcastToBrowsers({
            type: 'scan-result',
            table_id: lineId,
            path: key,
            plan_id: planId,
            ean,
            ok: !!result.ok,
            match: !!result.match,
            new_qty: result.new_qty,
            error: result.error || null
        });
    } catch (e) {
        console.error(`[Persistent] ${lineId} scan POST failed:`, e.message);
        broadcastToBrowsers({ type: 'scan-result', table_id: lineId, path: key, ean, ok: false, error: e.message });
    }
}

async function startPersistentScanners() {
    if (typeof fetch !== 'function') {
        console.error('[Persistent] global fetch unavailable (need Node 18+). Persistent scanners disabled.');
        return;
    }
    await refreshActivePlans();
    await refreshScannerConfig();
    setInterval(refreshActivePlans, PLANS_POLL_MS);
    setInterval(refreshScannerConfig, LINES_POLL_MS);
    console.log('[Persistent] Manager started — scanners stay connected without any open page.');
}

startPersistentScanners();
