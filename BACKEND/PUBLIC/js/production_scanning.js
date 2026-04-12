// Production Scanning Shared Logic
// Handles: Port Enumeration (Web Serial + Bridge + IP), State Management, API Calls

// Global State
let ALL_LINES = []; // Master Data from Settings
let TABLE_PLANS = {};
let TABLE_SCANNERS = {}; // { 'Table1': { type: 'serial'|'bridge'|'tcp', port: '...', ... } }
let KNOWN_PORTS = [];
let BRIDGE_PORTS = [];
let BRIDGE_WS = null;
let USING_BRIDGE = false;

// UI State
let TABLE_MODES = {}; // { 'Table1': 'COM' | 'IP' }
let SAVED_IPS = JSON.parse(localStorage.getItem('JPSMS_SAVED_IPS') || '[]');
let CURRENT_FILTER = localStorage.getItem('JPSMS_SCAN_FILTER') || '';

/**
 * Initialize Scanning Module
 * @param {Function} renderCallback - Function to call when state changes (e.g. renderCards)
 */
async function initScanning(renderCallback) {
    JPSMS.auth.requireAuth();
    JPSMS.renderShell('packing');

    // 0. Fetch Lines (Configs)
    try {
        const res = await JPSMS.api.get('/assembly/lines');
        ALL_LINES = res.data || [];
        renderFilter();
    } catch (e) { console.error('Lines Error:', e); }

    // 1. Try Bridge Connection
    connectToBridge(() => {
        // On Bridge Ready:
        checkAutoConnect(renderCallback);
        if (renderCallback) renderCallback();
    });

    // 2. Check Web Serial Support
    if ('serial' in navigator) {
        try {
            KNOWN_PORTS = await navigator.serial.getPorts();
            navigator.serial.addEventListener('connect', () => refreshPorts(renderCallback));
            navigator.serial.addEventListener('disconnect', () => refreshPorts(renderCallback));
        } catch (e) { console.error('Error listing ports:', e); }
    } else {
        console.log('Web Serial not supported. Waiting for Bridge...');
    }

    await loadActivePlans(renderCallback);
}

// --- DATA LOADING ---

async function refreshPorts(renderCallback) {
    if ('serial' in navigator) KNOWN_PORTS = await navigator.serial.getPorts();
    if (renderCallback) renderCallback();
}

async function loadActivePlans(renderCallback) {
    try {
        const res = await JPSMS.api.get('/assembly/active');
        const rawPlans = res.data || [];

        TABLE_PLANS = rawPlans.reduce((acc, p) => {
            if (!acc[p.table_id]) acc[p.table_id] = [];
            acc[p.table_id].push(p);
            return acc;
        }, {});

        // Init Modes
        Object.keys(TABLE_PLANS).forEach(tid => {
            if (!TABLE_MODES[tid]) TABLE_MODES[tid] = 'COM';
        });

        // Apply Config Modes if present in ALL_LINES
        ALL_LINES.forEach(l => {
            if (l.scanner_config && l.scanner_config.startsWith('IP:')) {
                if (TABLE_PLANS[l.line_id]) TABLE_MODES[l.line_id] = 'IP';
            }
        });

        if (renderCallback) renderCallback();
    } catch (e) {
        JPSMS.toast(e.message, 'error');
    }
}

// --- BRIDGE LOGIC ---

function connectToBridge(renderCallback) {
    console.log('Attempting to connect to Local Bridge...');
    try {
        const ws = new WebSocket('ws://localhost:8999');

        ws.onopen = () => {
            console.log('Bridge Connected!');
            USING_BRIDGE = true;
            BRIDGE_WS = ws;
            JPSMS.toast('Connected to Local Scanner Bridge', 'success');
            // Check Auto Connect immediately if plans are already loaded?
            // Or the caller handles it.
            // Caller (initScanning) passed a callback that calls checkAutoConnect.
            if (renderCallback) renderCallback();
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleBridgeMessage(msg, renderCallback); // pass callback if re-render needed
            // If main callback was passed to connectToBridge, we assume handled by wrapper
        };

        ws.onclose = () => {
            console.log('Bridge Disconnected.');
            USING_BRIDGE = false;
            BRIDGE_WS = null;
            // Update UI
            if (window.renderCards) window.renderCards();
        };

        ws.onerror = (e) => { /* quiet */ };

    } catch (e) {
        console.error('Bridge Error:', e);
    }
}

function handleBridgeMessage(msg, renderCallback) {
    if (msg.type === 'ports') {
        BRIDGE_PORTS = msg.ports || [];
        // Force re-render if we can
        if (window.renderCards) window.renderCards();
    }
    else if (msg.type === 'data') {
        const sourcePath = msg.path;
        const tid = Object.keys(TABLE_SCANNERS).find(t => TABLE_SCANNERS[t].port === sourcePath);
        if (tid) {
            processScan(tid, msg.data);
        }
    }
    else if (msg.type === 'raw') {
        const sourcePath = msg.path;
        const tid = Object.keys(TABLE_SCANNERS).find(t => TABLE_SCANNERS[t].port === sourcePath);
        if (tid) {
            log(tid, `Raw Activity: ${msg.data.substring(0, 20)}...`, 'warn');
            // Flash dot briefly to show activity
            const dot = document.getElementById(`dot-${tid}`);
            if (dot) {
                dot.style.background = '#f59e0b'; // Amber
                setTimeout(() => {
                    if (TABLE_SCANNERS[tid]) dot.style.background = '#10b981';
                    else dot.style.background = '#cbd5e1';
                }, 100);
            }
        }
    }
    else if (msg.type === 'error') {
        let errText = msg.message;
        if (errText.includes('121')) {
            errText = 'Port Busy/Timeout (Code 121). Unplug/replug scanner or close other apps using COM port.';
        }
        JPSMS.toast(`Bridge Error: ${errText}`, 'error');
    }
}

// --- AUTO CONNECT & FILTER ---

function renderFilter() {
    let filter = document.getElementById('lineFilter');
    if (!filter) {
        const header = document.querySelector('.header div:last-child');
        if (header) {
            const wrap = document.createElement('div');
            wrap.className = 'd-inline-block me-2';
            wrap.innerHTML = `<select id="lineFilter" class="form-select form-select-sm" style="width:200px"></select>`;
            header.prepend(wrap);
            filter = wrap.querySelector('select');
        }
    }

    if (filter) {
        filter.innerHTML = '<option value="">show all tables</option>' +
            ALL_LINES.map(l => `<option value="${l.line_id}" ${CURRENT_FILTER === l.line_id ? 'selected' : ''}>${l.line_name}</option>`).join('');

        filter.onchange = (e) => {
            CURRENT_FILTER = e.target.value;
            localStorage.setItem('JPSMS_SCAN_FILTER', CURRENT_FILTER);
            if (window.renderCards) window.renderCards();
        };
    }
}

function checkAutoConnect(renderCallback) {
    // Attempt connections for all lines with config
    ALL_LINES.forEach(line => {
        if (!line.scanner_config) return;
        const tid = line.line_id;
        let config = line.scanner_config.trim();

        // Don't reconnect if already connected
        if (TABLE_SCANNERS[tid]) return;

        console.log(`[AutoConnect] Checking ${tid} -> ${config}`);

        // Normalize
        let type = 'UNKNOWN';
        let val = '';

        if (config.startsWith('IP:')) { type = 'IP'; val = config.split('IP:')[1]; }
        else if (config.startsWith('BRIDGE:')) { type = 'BRIDGE'; val = config.split('BRIDGE:')[1]; }
        else if (config.toUpperCase().startsWith('COM')) { type = 'BRIDGE'; val = config; } // Implied COM
        else if (config.includes('.') && config.includes(':')) { type = 'IP'; val = config; } // Implied IP

        if (type === 'IP') {
            if (USING_BRIDGE && BRIDGE_WS) {
                TABLE_MODES[tid] = 'IP';
                connectTcpPort(tid, val);
                JPSMS.toast(`Auto-Connecting ${tid} to ${val}`, 'info');
            }
        }
        else if (type === 'BRIDGE') {
            if (USING_BRIDGE && BRIDGE_WS) {
                TABLE_MODES[tid] = 'COM';
                connectBridgePort(tid, val);
                JPSMS.toast(`Auto-Connecting ${tid} to ${val}`, 'info');
            }
        }
    });
}

function getVisibleTables() {
    let tables = Object.keys(TABLE_PLANS);
    if (CURRENT_FILTER) {
        // Only show the filtered table
        // But also, if it's not in TABLE_PLANS (active), we might not show it?
        // User wants "Selection of Main Assembly".
        tables = tables.filter(t => t === CURRENT_FILTER);
    }
    return tables;
}
window.getVisibleTables = getVisibleTables;

// --- UI HELPERS ---

function toggleMode(tid, mode) {
    TABLE_MODES[tid] = mode;
    if (window.renderCards) window.renderCards();
}

function getScannerControlHtml(tid) {
    const isConnected = !!TABLE_SCANNERS[tid];
    const mode = TABLE_MODES[tid] || 'COM';

    // 1. Mode Toggles
    const toggleHtml = `
        <div class="btn-group w-100 mb-2" role="group">
            <input type="radio" class="btn-check" name="mode-${tid}" id="mode-com-${tid}" autocomplete="off" 
                ${mode === 'COM' ? 'checked' : ''} onclick="toggleMode('${tid}','COM')" ${isConnected ? 'disabled' : ''}>
            <label class="btn btn-outline-secondary btn-sm" for="mode-com-${tid}">COM</label>

            <input type="radio" class="btn-check" name="mode-${tid}" id="mode-ip-${tid}" autocomplete="off" 
                ${mode === 'IP' ? 'checked' : ''} onclick="toggleMode('${tid}','IP')" ${isConnected ? 'disabled' : ''}>
            <label class="btn btn-outline-secondary btn-sm" for="mode-ip-${tid}">Network IP</label>
        </div>
    `;

    // 2. Select / Input Area
    let inputHtml = '';

    if (mode === 'COM') {
        let opts = '<option value="-1">-- Select Port --</option>';
        if (USING_BRIDGE && BRIDGE_PORTS.length) {
            opts += `<optgroup label="Local COM (Bridge)">`;
            opts += BRIDGE_PORTS.map(p => `<option value="BRIDGE:${p.path}">${p.path}</option>`).join('');
            opts += `</optgroup>`;
        }
        if (KNOWN_PORTS.length) {
            opts += `<optgroup label="Web Serial">`;
            opts += KNOWN_PORTS.map((p, i) => `<option value="SERIAL:${i}">Web Serial Device ${i + 1}</option>`).join('');
            opts += `</optgroup>`;
        }
        if (true) opts += `<option value="NEW_SERIAL">+ Pair New (Web Serial)...</option>`;

        inputHtml = `<select id="port-select-${tid}" class="form-select form-select-sm" ${isConnected ? 'disabled' : ''}>${opts}</select>`;
    } else {
        // IP Mode
        let opts = '<option value="-1">-- Select Saved IP --</option>';
        opts += SAVED_IPS.map(ip => `<option value="IP:${ip}">${ip}</option>`).join('');
        opts += `<option value="NEW_IP">+ Add New IP...</option>`;
        if (SAVED_IPS.length) opts += `<option value="CLEAR_IPS" style="color:red">-- Clear List --</option>`;

        inputHtml = `<select id="port-select-${tid}" class="form-select form-select-sm" ${isConnected ? 'disabled' : ''}>${opts}</select>`;
    }

    return `
        <div class="mt-3 p-2 bg-slate-50 rounded border border-slate-200">
             <label class="form-label text-xs">Scanner Connection</label>
             ${toggleHtml}
             <div class="d-flex gap-2 mb-2">
                ${inputHtml}
                <select id="baud-select-${tid}" class="form-select form-select-sm" style="width:100px" ${isConnected ? 'disabled' : ''}>
                    <option value="9600" selected>9600</option>
                    <option value="115200">115200</option>
                    <option value="19200">19200</option>
                    <option value="38400">38400</option>
                    <option value="57600">57600</option>
                </select>
             </div>

             <div class="scanner-status justify-content-between">
                <div class="d-flex align-items-center gap-2">
                    <div class="dot ${isConnected ? 'connected' : ''}" id="dot-${tid}"></div>
                    <span id="label-${tid}" class="text-xs font-mono">
                        ${isConnected ? TABLE_SCANNERS[tid].port : 'Disconnected'}
                    </span>
                </div>
                <div>
                    ${isConnected ?
            `<button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="disconnectScanner('${tid}')">Disconnect</button>` :
            `<button class="btn btn-sm btn-primary py-0 px-2" onclick="connectScanner('${tid}')">Connect</button>`
        }
                </div>
             </div>
             ${USING_BRIDGE && mode === 'COM' ? '<div class="text-xs text-green-600 mt-1"><i class="bi bi-diagram-3-fill"></i> Bridge Active</div>' : ''}
             ${!USING_BRIDGE && mode === 'IP' ? '<div class="text-xs text-red-500 mt-1"><i class="bi bi-exclamation-triangle"></i> Bridge Required for IP</div>' : ''}
        </div>
    `;
}

function getDetailsHtml(p) {
    return `
        <div class="form-group">
                <label class="form-label" style="font-size:0.7rem; color:#94a3b8">Item</label>
            <div style="font-weight:600; font-size:0.9rem">${p.item_name}</div>
        </div>
        <div class="ean-display">${p.ean_number || 'NO EAN'}</div>
        <div class="scan-metrics">
            <div class="metric-box"><div class="metric-label">Plan</div><div class="metric-val" id="plan-qty-${p.table_id}">${p.plan_qty}</div></div>
            <div class="metric-box"><div class="metric-label">Done</div><div class="metric-val" id="scan-qty-${p.table_id}" style="color:#2563eb">${p.scanned_qty || 0}</div></div>
        </div>
    `;
}

function switchPlan(tid, planId) {
    const plan = TABLE_PLANS[tid].find(p => p.id == planId);
    if (!plan) return;

    // Update DOM directly if elements exist
    const card = document.getElementById(`card-${tid}`);
    if (card) card.dataset.planId = plan.id;

    const detailsEl = document.getElementById(`details-${tid}`);
    if (detailsEl) detailsEl.innerHTML = getDetailsHtml(plan);

    const badge = document.getElementById(`badge-${tid}`);
    if (badge) {
        badge.style.background = plan.status === 'RUNNING' ? '#dcfce7' : '#f1f5f9';
        badge.style.color = plan.status === 'RUNNING' ? '#166534' : '#475569';
        badge.textContent = plan.status;
    }
}

// --- CONNECTIVITY ACTIONS ---

async function connectScanner(tid, renderCallback) {
    const selectEl = document.getElementById(`port-select-${tid}`);
    const val = selectEl.value;

    if (val === '-1') return JPSMS.toast('Please select a port/IP first', 'warn');

    // CLEAR
    if (val === 'CLEAR_IPS') {
        if (confirm('Clear all saved IPs?')) {
            SAVED_IPS = [];
            localStorage.removeItem('JPSMS_SAVED_IPS');
            if (window.renderCards) window.renderCards();
            JPSMS.toast('Saved IPs cleared', 'success');
        }
        return;
    }

    // NEW IP
    if (val === 'NEW_IP') {
        const ip = prompt("Enter Scanner IP:PORT (e.g., 192.168.1.50:9000)");
        if (!ip) return;
        if (!ip.includes(':')) return JPSMS.toast("Format must be IP:PORT", 'error');

        // Save
        if (!SAVED_IPS.includes(ip)) {
            SAVED_IPS.push(ip);
            localStorage.setItem('JPSMS_SAVED_IPS', JSON.stringify(SAVED_IPS));
            if (window.renderCards) window.renderCards();
        }
        connectTcpPort(tid, ip);
        return;
    }

    // SAVED IP
    if (val.startsWith('IP:')) {
        const ip = val.split('IP:')[1];
        connectTcpPort(tid, ip);
        return;
    }

    // NEW SERIAL
    if (val === 'NEW_SERIAL') {
        if (!('serial' in navigator)) return JPSMS.toast('Web Serial not supported.', 'error');
        try {
            const port = await navigator.serial.requestPort();
            await openSerialPort(tid, port, renderCallback);
            refreshPorts(renderCallback);
        } catch (e) { log(tid, e.message, 'error'); }
        return;
    }

    // KNOWN SERIAL
    if (val.startsWith('SERIAL:')) {
        const idx = parseInt(val.split(':')[1]);
        const port = KNOWN_PORTS[idx];
        if (port) await openSerialPort(tid, port, renderCallback);
        return;
    }

    // BRIDGE COM
    if (val.startsWith('BRIDGE:')) {
        const comPath = val.split('BRIDGE:')[1];
        const baudRate = parseInt(document.getElementById(`baud-select-${tid}`).value) || 9600;
        connectBridgePort(tid, comPath, baudRate);
        return;
    }
}

async function openSerialPort(tid, port) {
    try {
        await port.open({ baudRate: 9600 });
        log(tid, 'Web Serial Connected!', 'success');

        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
        const reader = textDecoder.readable.getReader();

        TABLE_SCANNERS[tid] = { type: 'serial', port: 'Serial', reader, keepReading: true, buffer: '' };
        if (window.renderCards) window.renderCards();
        readSerialLoop(tid);
    } catch (e) {
        log(tid, 'Connect Fail: ' + e.message, 'error');
    }
}

async function connectBridgePort(tid, comPath, baudRate = 9600) {
    if (!BRIDGE_WS) return JPSMS.toast('Bridge not connected!', 'error');

    BRIDGE_WS.send(JSON.stringify({
        action: 'open',
        path: comPath,
        baudRate: baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none'
    }));
    log(tid, `Requesting ${comPath}...`, 'info');
    TABLE_SCANNERS[tid] = { type: 'bridge', port: comPath };
    if (window.renderCards) window.renderCards();
}

function connectTcpPort(tid, ipStr) {
    if (!BRIDGE_WS) return JPSMS.toast('Bridge not connected! Cannot use IP.', 'error');
    const [host, port] = ipStr.split(':');
    BRIDGE_WS.send(JSON.stringify({ action: 'open-tcp', host, port: parseInt(port) }));
    log(tid, `Connecting to ${ipStr}...`, 'warn');
    TABLE_SCANNERS[tid] = { type: 'tcp', port: ipStr };
    if (window.renderCards) window.renderCards();
}

function disconnectScanner(tid) {
    const scanner = TABLE_SCANNERS[tid];
    if (!scanner) return;

    if (scanner.type === 'serial') {
        scanner.keepReading = false;
        if (scanner.reader) scanner.reader.cancel();
        if (scanner.port && scanner.port.close) scanner.port.close();
    } else if (scanner.type === 'bridge') {
        if (BRIDGE_WS) BRIDGE_WS.send(JSON.stringify({ action: 'close', path: scanner.port }));
    } else if (scanner.type === 'tcp') {
        const [host, port] = scanner.port.split(':');
        if (BRIDGE_WS) BRIDGE_WS.send(JSON.stringify({ action: 'close-tcp', host, port: parseInt(port) }));
    }

    delete TABLE_SCANNERS[tid];
    if (window.renderCards) window.renderCards();
    log(tid, 'Disconnected.', 'warn');
}

// --- READ LOOPS ---

async function readSerialLoop(tid) {
    const scanner = TABLE_SCANNERS[tid];
    if (!scanner || scanner.type !== 'serial') return;
    while (scanner.port && scanner.keepReading) {
        try {
            const { value, done } = await scanner.reader.read();
            if (done) break;
            if (value) {
                scanner.buffer += value;
                if (scanner.buffer.includes('\r') || scanner.buffer.includes('\n')) {
                    let scan = scanner.buffer.replace(/[\r\n]+/g, '').trim();
                    if (scan) processScan(tid, scan);
                    scanner.buffer = '';
                }
            }
        } catch (e) { break; }
    }
}

function handleManualScan(e, tid) {
    if (e.key === 'Enter' && e.target.value) {
        processScan(tid, e.target.value);
        e.target.value = '';
    }
}

// Duplicate Check State
let LAST_SCANS = {}; // { tid: 'EAN123' }

async function processScan(tid, ean) {
    const card = document.getElementById(`card-${tid}`);
    if (!card) return;

    // 1. Check Duplication (User Request: "Scanning Same Product Twice")
    /* 
    if (LAST_SCANS[tid] === ean) {
        log(tid, `Simulated Duplicate: ${ean}`, 'warn');
        JPSMS.toast('You are scanning Same product twice!', 'error');
        flashCard(tid, '#fef3c7'); // Warning Color
        return; // BLOCK Duplicate
    } 
    */

    const planId = card.dataset.planId;
    if (!planId) {
        log(tid, 'No Plan Selected', 'error');
        return;
    }
    try {
        const res = await JPSMS.api.post('/assembly/scan', { plan_id: planId, ean });
        if (res.ok && res.match) {
            LAST_SCANS[tid] = ean; // Store for duplicate check
            log(tid, `MATCH: ${ean}`, 'success');
            const qtyEl = document.getElementById(`scan-qty-${tid}`);
            if (qtyEl) qtyEl.textContent = res.new_qty;
            const p = TABLE_PLANS[tid].find(x => x.id == planId);
            if (p) p.scanned_qty = res.new_qty;
            flashCard(tid, '#dcfce7');
            unlockTable(tid); // Ensure unlocked
        } else if (res.ok && !res.match) {
            log(tid, `MISMATCH: ${ean}`, 'error');
            // flashCard(tid, '#fee2e2'); // Old Flash

            // NEW: Lock Table
            lockTable(tid, `WRONG BARCODE! <br> <span style="font-size:1.5rem; color:yellow">${ean}</span>`);

        } else { log(tid, `Error: ${res.error}`, 'error'); }
    } catch (e) { log(tid, `API: ${e.message}`, 'error'); }
}

// --- LOCK / UNLOCK TABLE ---
function lockTable(tid, msg) {
    const card = document.getElementById(`card-${tid}`);
    if (!card) return;

    let overlay = document.getElementById(`lock-overlay-${tid}`);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = `lock-overlay-${tid}`;
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(220, 38, 38, 0.95)'; // Red
        overlay.style.zIndex = '100';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.color = '#fff';
        overlay.style.textAlign = 'center';
        overlay.style.borderRadius = '12px';

        overlay.innerHTML = `
            <i class="bi bi-exclamation-triangle-fill" style="font-size:3rem; margin-bottom:10px"></i>
            <h3 style="font-weight:800; margin:0">STOP!</h3>
            <div id="lock-msg-${tid}" style="font-size:1.2rem; margin:10px 0; font-weight:600"></div>
            <button class="btn btn-light btn-lg mt-3" onclick="unlockTable('${tid}')" style="color:#dc2626; font-weight:800">
                <i class="bi bi-unlock-fill"></i> RESUME
            </button>
        `;
        card.appendChild(overlay);
        card.style.position = 'relative'; // Ensure overlay fits
    }

    document.getElementById(`lock-msg-${tid}`).innerHTML = msg;
    overlay.style.display = 'flex';

    // Disable inputs
    const input = card.querySelector('input');
    if (input) input.disabled = true;
}

function unlockTable(tid) {
    const overlay = document.getElementById(`lock-overlay-${tid}`);
    if (overlay) overlay.style.display = 'none';

    const card = document.getElementById(`card-${tid}`);
    if (card) {
        const input = card.querySelector('input');
        if (input) {
            input.disabled = false;
            input.focus();
        }
    }
}

// --- UI UPDATERS ---

function log(tid, msg, type) {
    const el = document.getElementById(`log-${tid}`);
    if (!el) return;
    const div = document.createElement('div');
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (type === 'error') div.className = 'log-error';
    if (type === 'success') div.style.color = '#10b981';
    el.prepend(div);
}

function flashCard(tid, color) {
    const card = document.getElementById(`card-${tid}`);
    if (card) {
        card.style.background = color;
        setTimeout(() => card.style.background = '#fff', 500);
    }
}

// Cleanup on Page Exit
window.addEventListener('beforeunload', () => {
    Object.keys(TABLE_SCANNERS).forEach(tid => {
        disconnectScanner(tid);
    });
});
