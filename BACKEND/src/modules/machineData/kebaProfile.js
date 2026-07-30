'use strict';

/**
 * KEBA SAM 4.0 Modbus register profile.
 *
 * Source: machine vendor's "SAM 4.0_KEBA" register map. The controller exposes
 * data as Modbus HOLDING registers (function code 3). Each variable occupies a
 * 2-register (32-bit) slot starting at the given Modbus address. Addresses are
 * given in the conventional 4xxxx form; the zero-based PDU offset used on the
 * wire is (address - 40001).
 *
 * Data types (KEBA):
 *   DINT  -> 32-bit signed integer      (2 regs)
 *   INT   -> 16-bit signed integer      (2-reg slot, value in first word)
 *   REAL  -> 32-bit IEEE-754 float      (2 regs)
 *   TIME  -> 32-bit duration in ms      (2 regs)  -> we expose seconds
 *   BOOL  -> boolean                    (2-reg slot, value in first word)
 *   LINT  -> 64-bit counter             (2-reg slot here; read low 32 bits)
 *
 * Byte/word order is not guaranteed across gateways, so it is configurable per
 * machine (see machine_modbus_config.word_order). Defaults to 'ABCD'
 * (big-endian bytes, big-endian word order). If decoded floats/counters look
 * wrong during commissioning, try 'CDAB' (word-swapped) first.
 */

const PROFILE_ID = 'KEBA_SAM_4_0';

// key: stable machine-readable id used in raw_json and API payloads.
// address: 4xxxx Modbus address. type: decode type. label: human description.
const REGISTERS = [
  // NOTE: On the live KEBA/AXISGATE gateway, all these values are served as
  // IEEE-754 floats (REAL), not the INT/TIME types the vendor sheet lists.
  // Verified on E-L2-WIND-250-6: 40002 decodes to 33.95 (machine cycle 33.9s),
  // and 40018 steps 200.0 -> 201.0 -> 202.0, +1.0 per shot. Cavity counts read
  // as small integers in the high word (INT).
  { key: 'ideal_cycle_time',   address: 40002, type: 'REAL', label: 'Ideal cycle time' },
  { key: 'total_cavity',       address: 40004, type: 'INT',  label: 'Total cavity' },
  { key: 'running_cavity',     address: 40006, type: 'INT',  label: 'Running cavity' },
  { key: 'shot_weight',        address: 40008, type: 'REAL', label: 'Product shot weight' },
  { key: 'product_code',       address: 40010, type: 'INT',  label: 'Product code' },
  { key: 'cycle_time_set',     address: 40012, type: 'REAL', label: 'Cycle time set' },
  { key: 'cycle_time_act',     address: 40014, type: 'REAL', label: 'Cycle time act' },
  { key: 'shot_counter_set',   address: 40016, type: 'REAL', label: 'Shot counter set' },
  { key: 'good_shots',         address: 40018, type: 'REAL', label: 'Good shot act' },
  { key: 'bad_shots_set',      address: 40020, type: 'REAL', label: 'Bad shot set' },
  { key: 'bad_shots',          address: 40022, type: 'REAL', label: 'Bad shot act' },
  { key: 'set_temp_zone_1',    address: 40024, type: 'REAL', label: 'Set Temp zone 1' },
  { key: 'set_temp_zone_2',    address: 40026, type: 'REAL', label: 'Set Temp zone 2' },
  { key: 'set_temp_zone_3',    address: 40028, type: 'REAL', label: 'Set Temp zone 3' },
  { key: 'set_temp_zone_4',    address: 40030, type: 'REAL', label: 'Set Temp zone 4' },
  { key: 'set_temp_zone_5',    address: 40032, type: 'REAL', label: 'Set Temp zone 5' },
  { key: 'set_temp_zone_6',    address: 40034, type: 'REAL', label: 'Set Temp zone 6' },
  { key: 'act_temp_zone_1',    address: 40036, type: 'REAL', label: 'Act Temp zone 1' },
  { key: 'act_temp_zone_2',    address: 40038, type: 'REAL', label: 'Act Temp zone 2' },
  { key: 'act_temp_zone_3',    address: 40040, type: 'REAL', label: 'Act Temp zone 3' },
  { key: 'act_temp_zone_4',    address: 40042, type: 'REAL', label: 'Act Temp zone 4' },
  { key: 'act_temp_zone_5',    address: 40044, type: 'REAL', label: 'Act Temp zone 5' },
  { key: 'act_temp_zone_6',    address: 40046, type: 'REAL', label: 'Act Temp zone 6' },
  { key: 'servo1_motor_temp',  address: 40048, type: 'REAL', label: 'Servo 1 motor temp' },
  { key: 'servo1_drive_temp',  address: 40050, type: 'REAL', label: 'Servo 1 drive temp' },
  { key: 'servo2_motor_temp',  address: 40052, type: 'REAL', label: 'Servo 2 motor temp' },
  { key: 'servo2_drive_temp',  address: 40054, type: 'REAL', label: 'Servo 2 drive temp' },
  { key: 'servo3_motor_temp',  address: 40056, type: 'REAL', label: 'Servo 3 motor temp' },
  { key: 'servo3_drive_temp',  address: 40058, type: 'REAL', label: 'Servo 3 drive temp' },
  { key: 'cycle_time_act_2',   address: 40060, type: 'TIME', label: 'Cycle time act (2)' },
  { key: 'injection_time',     address: 40062, type: 'TIME', label: 'Injection time' },
  { key: 'cushion_position',   address: 40064, type: 'REAL', label: 'Cushion position' },
  { key: 'refill_time',        address: 40066, type: 'TIME', label: 'Refill time' },
  { key: 'refill_end_pos',     address: 40068, type: 'REAL', label: 'Refill end position' },
  { key: 'vp_position',        address: 40070, type: 'REAL', label: 'V-P position' },
  { key: 'cycle_time_act_3',   address: 40072, type: 'TIME', label: 'Cycle time act (3)' },
  { key: 'inject_start_pos',   address: 40074, type: 'REAL', label: 'Injection start position' },
  { key: 'mold_open_end_pos',  address: 40076, type: 'REAL', label: 'Mold open end position' },
  { key: 'oil_temp',           address: 40078, type: 'REAL', label: 'Oil temperature' },
  { key: 'mold_close_time',    address: 40080, type: 'TIME', label: 'Mold close time' },
  { key: 'mold_safety_time',   address: 40082, type: 'TIME', label: 'Mold safety time' },
  { key: 'tonnage_time',       address: 40084, type: 'TIME', label: 'Tonnage time' },
  { key: 'unit_fwd_time',      address: 40086, type: 'TIME', label: 'Unit fwd time' },
  { key: 'hold_on_time',       address: 40088, type: 'TIME', label: 'Hold on time' },
  { key: 'suck_back_time',     address: 40090, type: 'TIME', label: 'Suck back time' },
  { key: 'unit_ret_time',      address: 40092, type: 'TIME', label: 'Unit ret time' },
  { key: 'mold_open_time',     address: 40094, type: 'TIME', label: 'Mold open time' },
  { key: 'ejector_fwd_time',   address: 40096, type: 'TIME', label: 'Ejector fwd time' },
  { key: 'ejector_bwd_time',   address: 40098, type: 'TIME', label: 'Ejector bwd time' },
  { key: 'reject_reason_1',    address: 40100, type: 'INT',  label: 'Rejection reason 1' },
  { key: 'reject_reason_1_qty',address: 40102, type: 'INT',  label: 'Rejection reason qty 1' },
  { key: 'reject_reason_2',    address: 40104, type: 'INT',  label: 'Rejection reason 2' },
  { key: 'reject_reason_2_qty',address: 40106, type: 'INT',  label: 'Rejection reason qty 2' },
  { key: 'reject_reason_3',    address: 40108, type: 'INT',  label: 'Rejection reason 3' },
  { key: 'reject_reason_3_qty',address: 40110, type: 'INT',  label: 'Rejection reason qty 3' },
  { key: 'reject_reason_4',    address: 40112, type: 'INT',  label: 'Rejection reason 4' },
  { key: 'reject_reason_4_qty',address: 40114, type: 'INT',  label: 'Rejection reason qty 4' },
  { key: 'reject_reason_5',    address: 40116, type: 'INT',  label: 'Rejection reason 5' },
  { key: 'reject_reason_5_qty',address: 40118, type: 'INT',  label: 'Rejection reason qty 5' },
  { key: 'down_time_reason',   address: 40120, type: 'INT',  label: 'Down time reason' },
  { key: 'machine_running',    address: 40122, type: 'BOOL', label: 'Machine status (auto cycle running)' },
  { key: 'runner_weight',      address: 40124, type: 'REAL', label: 'Runner weight' },
  { key: 'part_reject_weight', address: 40126, type: 'REAL', label: 'Product rejection weight' },
  { key: 'other_reject_weight',address: 40128, type: 'REAL', label: 'Other rejection weight' },
  { key: 'machine_mode',       address: 40130, type: 'INT',  label: 'Machine mode' },
  { key: 'control_on_hours',   address: 40132, type: 'LINT', label: 'Control on time (hours)' },
  { key: 'motor_on_hours',     address: 40134, type: 'LINT', label: 'Motor on time (hours)' },
  { key: 'heater_on_hours',    address: 40136, type: 'LINT', label: 'Heater on time (hours)' },
];

// Zero-based PDU offset for a 4xxxx address.
const OFFSET_BASE = 40001;

// Registers span offsets 1..135. Modbus caps a single read at 125 registers,
// so the collector reads in chunks; this profile advertises the full span.
function span() {
  const offsets = REGISTERS.map(r => r.address - OFFSET_BASE);
  const start = Math.min(...offsets);
  const end = Math.max(...offsets) + 1; // +1 word for the second register of the last slot
  return { startOffset: start, endOffset: end, count: end - start + 1 };
}

/**
 * Decode a variable from two 16-bit register words per its type and word order.
 * hi/lo are the two consecutive registers as returned by modbus (uint16 each).
 * wordOrder: 'ABCD' = [hi, lo] (big-endian words), 'CDAB' = [lo, hi] (swapped).
 */
function decodeSlot(type, reg0, reg1, wordOrder = 'ABCD') {
  const swapped = wordOrder === 'CDAB' || wordOrder === 'BADC';
  const high = swapped ? reg1 : reg0;
  const low = swapped ? reg0 : reg1;

  switch (type) {
    case 'INT':
      // 16-bit signed, value carried in the first (high) word
      return int16(high);
    case 'BOOL':
      return (high & 0xffff) !== 0;
    case 'DINT':
    case 'LINT': {
      const u = ((high & 0xffff) * 0x10000) + (low & 0xffff);
      return u >= 0x80000000 ? u - 0x100000000 : u; // to signed 32-bit
    }
    case 'REAL': {
      const buf = Buffer.alloc(4);
      buf.writeUInt16BE(high & 0xffff, 0);
      buf.writeUInt16BE(low & 0xffff, 2);
      return round(buf.readFloatBE(0), 3);
    }
    case 'TIME': {
      // 32-bit milliseconds -> seconds
      const ms = ((high & 0xffff) * 0x10000) + (low & 0xffff);
      return round(ms / 1000, 3);
    }
    default:
      return null;
  }
}

function int16(v) {
  v &= 0xffff;
  return v >= 0x8000 ? v - 0x10000 : v;
}

function round(n, dp) {
  if (!Number.isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/**
 * Decode a full register block (array of uint16 starting at startOffset) into a
 * { key: value } map using this profile.
 */
function decodeBlock(words, startOffset, wordOrder = 'ABCD') {
  const out = {};
  for (const reg of REGISTERS) {
    const off = reg.address - OFFSET_BASE - startOffset;
    if (off < 0 || off + 1 >= words.length) continue;
    // Words the collector could not read are null (a chunk the controller
    // rejected). Skip them so a failed read yields no value rather than a
    // spurious 0 that would corrupt counters and averages.
    if (words[off] == null || words[off + 1] == null) continue;
    out[reg.key] = decodeSlot(reg.type, words[off], words[off + 1], wordOrder);
  }
  return out;
}

module.exports = {
  PROFILE_ID,
  REGISTERS,
  OFFSET_BASE,
  span,
  decodeSlot,
  decodeBlock,
};
