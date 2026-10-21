'use strict';

// JMS Chat app sign-in (chat_app.html and the Android app).
//
// Everyone talks on MAIN: any active user may sign in here with their JMS username and
// password, from anywhere — no MAIN geofence and no global access needed. The session
// it issues (auth.js, typ 'chat', cookie jms_chat_session) identifies the user ONLY on
// /api/chat/*; on every other API it counts as no session, so full JMS on MAIN stays
// global-only. Factory LOCAL servers refuse it: the chat app always talks to MAIN.

const bcrypt = require('bcryptjs');
const { issueChatSession, clearChatSession } = require('../../app/auth');
const lockout = require('../../app/loginLockout');
const chatSync = require('./chatSync');
const chatGate = require('./chatGate');

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

function registerChatAppAuthRoutes(app, pool) {
  app.post('/api/chat-app/login', async (req, res) => {
    try {
      if (chatSync.isLocal()) {
        return res.status(400).json({ ok: false, error: 'The chat app signs in on the main JMS server.' });
      }
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) return res.status(400).json({ ok: false, error: 'Enter your username and password.' });

      const lockMsg = lockout.checkBruteForce(username, req.ip);
      if (lockMsg) return res.status(429).json({ ok: false, error: lockMsg });

      const { rows: [u] } = await pool.query(
        `SELECT id, username, password, role_code FROM users
          WHERE LOWER(username) = LOWER($1) AND COALESCE(is_active, TRUE) = TRUE
          ORDER BY (username = $1) DESC LIMIT 1`,
        [username]
      );
      const valid = !!u && String(u.password || '').startsWith('$2') && await bcrypt.compare(password, u.password);
      if (!valid) {
        lockout.recordLoginFailure(username, req.ip);
        return res.status(401).json({ ok: false, error: 'Invalid username or password' });
      }
      lockout.clearLoginFailures(username, req.ip);

      // Chat switched off, or this user's factory not yet in the rollout.
      const a = await chatGate.access(pool, { username: u.username, role: String(u.role_code || '').toLowerCase() });
      if (!a.ok) return res.status(403).json({ ok: false, error: 'Chat is not available for your login yet.' });

      await issueChatSession(pool, req, res, u);
      const ua = String(req.headers['user-agent'] || '');
      pool.query(
        `INSERT INTO user_activity_log (username, role_code, app_id, action, page, device_type, ip_address, user_agent, created_at)
         VALUES ($1,$2,'chat_app','login',NULL,$3,$4,$5,NOW())`,
        [u.username, u.role_code || '', /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop', clientIp(req), ua.slice(0, 500)]
      ).catch(() => {});
      res.json({ ok: true, username: u.username });
    } catch (err) {
      console.error('[chat] app login:', err);
      res.status(500).json({ ok: false, error: 'Sign-in failed. Please try again.' });
    }
  });

  app.post('/api/chat-app/logout', (req, res) => {
    clearChatSession(req, res);
    res.json({ ok: true });
  });
}

module.exports = { registerChatAppAuthRoutes };
