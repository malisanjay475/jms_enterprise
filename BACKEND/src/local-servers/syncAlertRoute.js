'use strict';

// Sync-staleness alert (key-guarded, CI-pollable). Runs ON MAIN.
// LOCAL servers sit behind factory NAT and can't be reached from GitHub
// Actions — but each LOCAL agent heartbeats to MAIN, which records
// last_push_at / last_seen_at in local_servers. This endpoint flags any active
// LOCAL server that stopped pushing within the threshold, so a scheduled
// Action can email an alert. Catches the gap that hid a multi-day sync outage.
//
//   GET /api/sync-alert?key=SYNC_API_KEY
//   -> 200 { ok:true,  stale:[], servers:[...] }
//   -> 200 { ok:false, stale:[...], servers:[...] }
//   -> 401 wrong key
// HTTP stays 200 either way so a generic uptime probe won't misread it.

const express = require('express');

function createSyncAlertRoute(pool) {
  const router = express.Router();
  const API_KEY = process.env.SYNC_API_KEY || 'jms-secret-key-2024';
  const STALE_MS = Number(process.env.SYNC_STALE_THRESHOLD_MS || 2 * 60 * 60 * 1000);

  router.get('/', async (req, res) => {
    const key = req.query.key || req.headers['x-sync-key'] || '';
    if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'Invalid key' });
    if (!pool) return res.status(503).json({ ok: false, error: 'DB not ready' });
    try {
      const { rows } = await pool.query(`
        SELECT node_name, factory_id, status, last_push_at, last_seen_at
        FROM local_servers
        WHERE COALESCE(LOWER(status), '') NOT IN ('retired','disabled','decommissioned')
        ORDER BY node_name
      `);
      const servers = rows.map(r => {
        const pushAge = r.last_push_at ? (Date.now() - new Date(r.last_push_at).getTime()) : null;
        const seenAge = r.last_seen_at ? (Date.now() - new Date(r.last_seen_at).getTime()) : null;
        const stale = r.last_push_at != null && pushAge > STALE_MS;
        return {
          node_name: r.node_name, factory_id: r.factory_id, status: r.status,
          last_push_at: r.last_push_at, last_seen_at: r.last_seen_at,
          push_age_minutes: pushAge != null ? Math.round(pushAge / 60000) : null,
          seen_age_minutes: seenAge != null ? Math.round(seenAge / 60000) : null,
          stale
        };
      });
      const stale = servers.filter(s => s.stale);
      res.json({ ok: stale.length === 0, threshold_minutes: Math.round(STALE_MS / 60000), checked: servers.length, stale, servers });
    } catch (e) {
      console.error('[sync-alert] query failed:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createSyncAlertRoute };
