'use strict';

// 'clientError' handling for the HTTP/HTTPS servers.
//
// ERR_HTTP_REQUEST_TIMEOUT means a device started sending a request but the full
// request did not arrive within headersTimeout (61 s) — typically a tablet or phone
// on weak Wi-Fi. That request fails. It was logged as one error + a Node-internal
// stack trace per occurrence (171 on factory-1 on 26-Sep) without saying WHICH device,
// so nothing could be done about it. Timeouts are now counted per client address and
// written as one summary line every 10 minutes; other client errors get one line with
// the address and error code (no internal stack).

const SUMMARY_INTERVAL_MS = 10 * 60 * 1000;

function clientAddress(socket) {
  const addr = String((socket && socket.remoteAddress) || 'unknown');
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

function createClientErrorHandler(label, { log = console, intervalMs = SUMMARY_INTERVAL_MS } = {}) {
  let timeouts = new Map();
  let timer = null;

  function flush() {
    if (timeouts.size === 0) return null;
    const entries = [...timeouts.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    const line = `[${label}] ${total} request(s) timed out before the full request arrived ` +
      `(slow or dropped client connection): ${entries.map(([ip, n]) => `${ip} x${n}`).join(', ')}`;
    timeouts = new Map();
    log.warn(line);
    return line;
  }

  function handler(err, socket) {
    // ECONNRESET/EPIPE on a client socket = the peer dropped the connection
    // (idle keep-alive timeout, tab close/refresh, flaky factory LAN, sync
    // blip). These are expected background noise on any keep-alive server and
    // do not affect other requests — don't log, and don't try to write a 400
    // to an already-dead socket (per Node http docs).
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || !socket.writable) {
      return;
    }
    const ip = clientAddress(socket);
    if (err.code === 'ERR_HTTP_REQUEST_TIMEOUT') {
      timeouts.set(ip, (timeouts.get(ip) || 0) + 1);
      if (!timer) {
        timer = setInterval(flush, intervalMs);
        if (typeof timer.unref === 'function') timer.unref();
      }
    } else {
      log.error(`[${label}] ${err.code || 'error'} from ${ip}: ${err.message}`);
    }
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }

  handler.flush = flush;
  handler.stop = () => { if (timer) clearInterval(timer); timer = null; };
  return handler;
}

module.exports = { createClientErrorHandler, clientAddress };
