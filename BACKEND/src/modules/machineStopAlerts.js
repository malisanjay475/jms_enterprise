'use strict';

// "Machine stopped 3 h+" alerts in JMS Chat.
//
// Every 5 minutes the MAIN server looks for machines that hold an active plan but have
// produced nothing for 3 hours or more (computeStoppedMachines in registerLegacyRoutes),
// and posts ONE message per stoppage into the group chat named "Moulding Alerts":
//
//   @all ⛔ B -L1-HYD-350-1 stopped for 3 h+ · Reason: Manpower Shortage
//
// The message is a chat 'link' (opens the DPR Compliance Summary) with a chat_tasks row,
// so the chat shows an Acknowledge button; acknowledging sets the task to 'done' and
// posts "<name> acknowledged" under it. Skipped: machines whose current stop reason is a
// power cut (code 8 / Power Cut quick action), plants marked closed for the shift, and
// stops that began more than 24 h ago (so the first run does not flood the group).
//
// The message sync_id is derived from machine + factory + stop time, so a stoppage is
// posted once even with several PM2 workers, a restart, or a LOCAL running the same job.
// Settings (env): MACHINE_STOP_ALERTS=off, MACHINE_STOP_ALERT_HOURS (default 3),
// MACHINE_STOP_ALERT_GROUP (default "Moulding Alerts").

const chatSync = require('./chat/chatSync');

const SENDER = 'JMS Alerts';
const TICK_MS = 5 * 60 * 1000;
const FIRST_TICK_MS = 90 * 1000;
const MAX_AGE_MS = 24 * 3600 * 1000;
const LOCK = 'jms_machine_stop_alerts';

function settings() {
  const hours = Math.max(1, Math.min(24, Number(process.env.MACHINE_STOP_ALERT_HOURS) || 3));
  const group = String(process.env.MACHINE_STOP_ALERT_GROUP || 'Moulding Alerts').trim();
  return { hours, group };
}

function enabled() {
  if (/^(off|0|false|no)$/i.test(String(process.env.MACHINE_STOP_ALERTS || '').trim())) return false;
  return !chatSync.isLocal(); // MAIN has every factory's DPR; LOCALs get the message by chat sync
}

// IST clock → { date: 'YYYY-MM-DD' (DPR date), shift: 'Day' | 'Night' }. Day = 07:00-19:00;
// after midnight the night shift still belongs to the previous DPR date.
function dprNow(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000);
  const h = ist.getUTCHours();
  const shift = h >= 7 && h < 19 ? 'Day' : 'Night';
  if (h < 7) ist.setUTCDate(ist.getUTCDate() - 1);
  return { date: ist.toISOString().slice(0, 10), shift };
}

function fmtIst(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function plantClosed(closures, machineInfo, factoryId) {
  if (!closures.length) return false;
  const plants = new Set(['ALL']);
  if (machineInfo) {
    if (machineInfo.building) plants.add(String(machineInfo.building).trim().toUpperCase());
    if (machineInfo.line) plants.add(String(machineInfo.line).trim().toUpperCase());
  }
  return closures.some((c) => plants.has(String(c.plant || '').trim().toUpperCase())
    && (c.factory_id == null || factoryId == null || Number(c.factory_id) === Number(factoryId)));
}

function alertMessage(s, hours, factoryName) {
  const where = factoryName ? ` (${factoryName})` : '';
  const reason = s.reason || 'No entry / unknown';
  return {
    body: `@all ⛔ ${s.machine}${where} stopped for ${hours} h+ · Reason: ${reason}`,
    meta: {
      url: '/dpr.html?view=summary',
      title: `⛔ ${s.machine} stopped ${hours} h+`,
      factory_id: s.factoryId == null ? null : s.factoryId,
      factory_name: factoryName || null,
      locator: null,
      excerpt: `Since ${fmtIst(s.stoppedSince)} · Reason: ${reason}${s.mould && s.mould !== '-' ? ` · Mould: ${s.mould}` : ''}`,
      priority: 'urgent',
      alert: { type: 'machine_stop', machine: s.machine, hours, reason, since: s.stoppedSince }
    }
  };
}

async function runOnce({ pool, q, computeStoppedMachines }) {
  const { hours, group } = settings();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [lk] } = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [LOCK]);
    if (!lk.ok) { await client.query('ROLLBACK'); return { posted: 0, skipped: 'busy' }; }

    const { rows: [t] } = await client.query(
      "SELECT to_regclass('chat_tasks') AS tasks, to_regclass('chat_conversations') AS convs"
    );
    if (!t.tasks || !t.convs) { await client.query('ROLLBACK'); return { posted: 0, skipped: 'no chat' }; }
    const { rows: [conv] } = await client.query(
      `SELECT sync_id FROM chat_conversations
        WHERE type = 'group' AND LOWER(TRIM(title)) = LOWER($1)
        ORDER BY last_message_at DESC NULLS LAST LIMIT 1`, [group]
    );
    if (!conv) { await client.query('ROLLBACK'); return { posted: 0, skipped: 'no group' }; }

    const now = Date.now();
    const stopped = (await computeStoppedMachines(null, hours * 60, 2))
      .filter((s) => s.stoppedSince && !s.powerCut && now - new Date(s.stoppedSince).getTime() <= MAX_AGE_MS);
    if (!stopped.length) { await client.query('COMMIT'); return { posted: 0 }; }

    const { date, shift } = dprNow(new Date(now));
    const closures = await q(
      "SELECT plant, factory_id FROM closed_plants WHERE dpr_date = $1 AND (shift = $2 OR shift = 'Both')", [date, shift]
    ).catch(() => []);
    const machineRows = await q('SELECT machine, line, building, factory_id FROM machines').catch(() => []);
    const machineInfo = new Map(machineRows.map((m) => [String(m.machine || '').trim().toUpperCase(), m]));
    const factoryRows = await q('SELECT id, name FROM factories').catch(() => []);
    const factoryName = new Map(factoryRows.map((f) => [Number(f.id), f.name]));

    let posted = 0;
    for (const s of stopped) {
      const info = machineInfo.get(String(s.machine || '').trim().toUpperCase());
      if (plantClosed(closures, info, s.factoryId)) continue;
      const { body, meta } = alertMessage(s, hours, factoryName.get(Number(s.factoryId)) || '');
      const key = `${String(s.machine).trim().toUpperCase()}|${s.factoryId == null ? '' : s.factoryId}|${s.stoppedSince}`;
      const { rows: [row] } = await client.query(
        `INSERT INTO chat_messages (sync_id, conversation_sync_id, sender, body, kind, meta, factory_id)
         VALUES (${chatSync.deterministicIdSql('machine-stop-alert', '$1::text')}, $2, $3, $4, 'link', $5, NULL)
         ON CONFLICT (sync_id) DO NOTHING RETURNING sync_id, server_ts`,
        [key, conv.sync_id, SENDER, body, JSON.stringify(meta)]
      );
      if (!row) continue; // already alerted for this stoppage
      await client.query(
        `INSERT INTO chat_tasks (sync_id, message_sync_id, conversation_sync_id, status, updated_by, factory_id)
         VALUES (${chatSync.deterministicIdSql('chat-task', '$1::uuid')}, $1, $2, 'open', $3, NULL)
         ON CONFLICT (message_sync_id) DO NOTHING`, [row.sync_id, conv.sync_id, SENDER]
      );
      await client.query(
        'UPDATE chat_conversations SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2), updated_at = NOW() WHERE sync_id = $1',
        [conv.sync_id, row.server_ts]
      );
      posted += 1;
    }
    await client.query('COMMIT');
    if (posted) console.log(`[machine-stop-alerts] posted ${posted} alert(s) to "${group}"`);
    return { posted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function startMachineStopAlerts(deps) {
  if (startMachineStopAlerts.started || process.env.NODE_ENV === 'test' || !deps || !deps.pool) return;
  startMachineStopAlerts.started = true;
  const tick = () => {
    if (!enabled()) return;
    runOnce(deps).catch((err) => console.warn('[machine-stop-alerts]', err.message));
  };
  const first = setTimeout(tick, FIRST_TICK_MS);
  if (first.unref) first.unref();
  const timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
}

module.exports = { startMachineStopAlerts, runOnce, __test: { dprNow, plantClosed, alertMessage, enabled } };
