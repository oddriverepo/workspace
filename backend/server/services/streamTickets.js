import crypto from 'crypto';

const DEFAULT_TTL_MS = 60 * 1000;
const tickets = new Map();

function hashTicket(ticket) {
  return crypto.createHash('sha256').update(String(ticket || '')).digest('hex');
}

export function createAdminStreamTicket(adminUser, ttlMs = DEFAULT_TTL_MS) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + ttlMs;
  tickets.set(hashTicket(ticket), {
    userId: adminUser?.id || adminUser?.userId || null,
    username: adminUser?.username || '',
    name: adminUser?.name || '',
    role: adminUser?.role || 'admin',
    expiresAt,
  });
  setTimeout(() => {
    tickets.delete(hashTicket(ticket));
  }, ttlMs + 1000).unref?.();
  return { ticket, expiresAt };
}

export function consumeAdminStreamTicket(ticket) {
  const key = hashTicket(ticket);
  const entry = tickets.get(key);
  tickets.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}
