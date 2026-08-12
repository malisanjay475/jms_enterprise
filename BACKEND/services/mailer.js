'use strict';

/**
 * Thin SMTP mailer wrapper around nodemailer.
 *
 * Configuration is entirely env-driven so no credentials live in the repo:
 *   SMTP_HOST     — mail server host (e.g. smtp.zoho.in / smtp.gmail.com)
 *   SMTP_PORT     — port (default 587)
 *   SMTP_SECURE   — '1' for implicit TLS (port 465), default false (STARTTLS on 587)
 *   SMTP_USER     — auth username (usually the full mailbox address)
 *   SMTP_PASS     — auth password / app password
 *   SMTP_FROM     — From header (default: "JMS Alerts <SMTP_USER>")
 *
 * If SMTP is not configured, isMailConfigured() returns false and sendMail()
 * throws — callers should check isMailConfigured() first and skip gracefully so
 * the app never crashes just because mail is unset (e.g. on LOCAL servers).
 */

let _transport = null;

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getFrom() {
  if (process.env.SMTP_FROM && process.env.SMTP_FROM.trim()) return process.env.SMTP_FROM.trim();
  return `JMS Alerts <${process.env.SMTP_USER}>`;
}

function getTransport() {
  if (_transport) return _transport;
  if (!isMailConfigured()) {
    throw new Error('SMTP is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS).');
  }
  // Lazy-require so a missing dependency or unconfigured mail never breaks boot.
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = String(process.env.SMTP_SECURE || '') === '1' || port === 465;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transport;
}

/**
 * Send an email. Returns the nodemailer info object.
 * @param {{to:string|string[], cc?:string|string[], subject:string, html?:string, text?:string}} opts
 */
async function sendMail({ to, cc, subject, html, text }) {
  const transport = getTransport();
  return transport.sendMail({
    from: getFrom(),
    to,
    cc,
    subject,
    html,
    text,
  });
}

module.exports = { sendMail, isMailConfigured, getFrom };
