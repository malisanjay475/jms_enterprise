/**
 * Modbus TCP register probe for JMS machine-data setup.
 *
 * Purpose: We don't have the machine's register map yet. This script connects
 * to the machine, dumps a block of registers, and (in watch mode) shows which
 * registers CHANGE as the machine runs a shot. That reveals which address holds
 * the shot count, cycle time, status, etc.
 *
 * Run this ON THE LOCAL FACTORY SERVER (it must be on the LAN that can reach
 * 192.168.1.91). It only READS registers — it never writes to the machine.
 *
 *   cd MACHINE_COLLECTOR
 *   npm install
 *
 *   # One-shot dump of holding registers 0..49:
 *   node probe.js --host 192.168.1.91 --port 502 --start 0 --count 50 --fn 3
 *
 *   # Watch mode — polls every 1s and highlights registers that changed.
 *   # Run a shot on the machine and watch which numbers move:
 *   node probe.js --host 192.168.1.91 --watch
 *
 * Modbus function codes (--fn):
 *   3 = Read Holding Registers   (4xxxx)  <-- try this first
 *   4 = Read Input Registers     (3xxxx)
 */

const ModbusRTU = require('modbus-serial');

// ---- tiny arg parser ----
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true; // flag
  return v;
}

const HOST   = arg('host', '192.168.1.91');
const PORT   = parseInt(arg('port', '502'), 10);
const UNIT   = parseInt(arg('unit', '1'), 10);   // Modbus slave/unit id
const START  = parseInt(arg('start', '0'), 10);
const COUNT  = parseInt(arg('count', '50'), 10); // max 125 per Modbus read
const FN     = parseInt(arg('fn', '3'), 10);     // 3=holding, 4=input
const WATCH  = arg('watch', false) !== false;
const EVERY  = parseInt(arg('interval', '1000'), 10);

const client = new ModbusRTU();

async function readBlock() {
  client.setID(UNIT);
  const res = FN === 4
    ? await client.readInputRegisters(START, COUNT)
    : await client.readHoldingRegisters(START, COUNT);
  return res.data; // array of 16-bit unsigned ints
}

function fmtRow(addr, val, changed) {
  const mark = changed ? ' *' : '  ';
  // show both the raw register number and the conventional 4xxxx/3xxxx label
  const label = (FN === 4 ? 30001 : 40001) + addr;
  return `${mark} reg[${String(addr).padStart(3)}]  (${label})  = ${String(val).padStart(6)}`;
}

async function main() {
  console.log(`Connecting to Modbus TCP ${HOST}:${PORT} (unit ${UNIT}, fn ${FN})...`);
  await client.connectTCP(HOST, { port: PORT });
  client.setTimeout(3000);
  console.log('Connected.\n');

  let prev = null;

  async function tick() {
    let data;
    try {
      data = await readBlock();
    } catch (e) {
      console.error('Read error:', e.message);
      return;
    }
    console.clear && WATCH && console.clear();
    console.log(`${new Date().toLocaleTimeString()}  ${HOST}:${PORT}  registers ${START}..${START + COUNT - 1}`);
    console.log('(* = changed since last poll)\n');
    data.forEach((val, i) => {
      const changed = prev && prev[i] !== val;
      console.log(fmtRow(START + i, val, changed));
    });
    prev = data;
  }

  await tick();

  if (WATCH) {
    console.log(`\nWatching every ${EVERY}ms — run a shot on the machine and watch for '*'. Ctrl+C to stop.`);
    setInterval(tick, EVERY);
  } else {
    client.close(() => process.exit(0));
  }
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
