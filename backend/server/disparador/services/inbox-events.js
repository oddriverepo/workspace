/**
 * Inbox SSE event bus.
 *
 * Lightweight pub/sub that pushes real-time events to connected OdChat
 * clients via Server-Sent Events. Uses a simple Set of response objects.
 *
 * Events emitted:
 *   message.new          – new inbound or outbound message added
 *   message.status       – delivery status updated (sent/delivered/read/failed)
 *   conversation.updated – conversation metadata changed (unread, preview, etc.)
 */

/** @type {Set<import("express").Response>} */
const clients = new Set();

let _clientIdSeq = 0;

/**
 * Register an Express response as an SSE client.
 * Call this inside a GET route handler after setting SSE headers.
 */
export function addClient(res) {
  const clientId = ++_clientIdSeq;
  res._sseClientId = clientId;
  clients.add(res);
  return clientId;
}

/** Remove a client (called on close/error). */
export function removeClient(res) {
  clients.delete(res);
}

/** How many clients are connected right now. */
export function clientCount() {
  return clients.size;
}

/**
 * Broadcast an event to all connected SSE clients.
 * @param {string} event – event name (e.g. "message.new")
 * @param {object} data  – JSON-serialisable payload
 */
export function broadcast(event, data) {
  if (!clients.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (_) {
      clients.delete(res);
    }
  }
}

/** Send a keep-alive comment to all clients (prevents proxy timeouts). */
export function heartbeat() {
  if (!clients.size) return;
  for (const res of clients) {
    try {
      res.write(": heartbeat\n\n");
    } catch (_) {
      clients.delete(res);
    }
  }
}

// Keep-alive every 25 seconds (Render/Cloudflare timeout is ~30s for idle connections)
setInterval(heartbeat, 25_000);
