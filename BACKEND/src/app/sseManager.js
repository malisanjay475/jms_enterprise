'use strict';

/**
 * Minimal Server-Sent Events manager.
 * Keeps a Set of active response objects and broadcasts JSON events to all of them.
 * Stale connections (closed by client) are removed lazily on the next broadcast.
 */

const clients = new Set();

/**
 * Register an SSE response object.
 * Auto-removes it when the underlying request closes.
 */
function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

/**
 * Broadcast an event to every connected client.
 * @param {{ type: string, module?: string, path?: string, ts?: number }} event
 */
function broadcast(event) {
  if (!clients.size) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const dead = [];
  for (const res of clients) {
    try {
      res.write(data);
    } catch (_e) {
      dead.push(res);
    }
  }
  dead.forEach((r) => clients.delete(r));
}

/** Number of currently connected SSE clients. */
function clientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, clientCount };
