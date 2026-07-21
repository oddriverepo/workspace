/**
 * MCP authentication middleware.
 *
 * Validates Bearer token against process.env.MCP_SECRET using a
 * constant-time comparison to mitigate timing side-channels.
 *
 * If MCP_SECRET is not configured, the endpoint is hard-disabled (503).
 * This prevents accidental exposure when the env var is missing in
 * production. There is no fallback / dev mode on purpose.
 */
import crypto from 'crypto';

// Hash both sides to SHA-256 before comparing.
// This equalises buffer lengths unconditionally and eliminates the
// length oracle that a simple Buffer.byteLength comparison would create.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hash = (s) => crypto.createHash('sha256').update(s, 'utf8').digest();
  try {
    return crypto.timingSafeEqual(hash(a), hash(b));
  } catch {
    return false;
  }
}

export function authenticateMcp(req, res, next) {
  const secret = process.env.MCP_SECRET;
  if (!secret || String(secret).trim().length < 16) {
    return res.status(503).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'MCP service not configured' },
    });
  }

  const auth = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Missing bearer token' },
    });
  }

  const presented = match[1].trim();
  if (!timingSafeEqual(presented, String(secret))) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Invalid token' },
    });
  }

  next();
}

export default authenticateMcp;
