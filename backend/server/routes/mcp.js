/**
 * MCP (Model Context Protocol) endpoint — JSON-RPC 2.0 over HTTP.
 *
 * Mounted at /api/mcp. Single POST endpoint. Methods supported:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *   - notifications/initialized (no-op)
 *   - ping (no-op)
 *
 * Auth: Bearer token in Authorization header (see authenticate-mcp.js).
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateMcp } from '../middleware/authenticate-mcp.js';
import { TOOLS } from '../services/mcp/tools.js';

const router = Router();

const SERVER_INFO = {
  name: 'oddrive-mcp',
  version: '1.0.0',
};

const PROTOCOL_VERSION = '2025-03-26';

const TOOL_DEFS = [
  {
    name: 'lookup_contact',
    description:
      'Identifica se um contato (telefone, nome ou @ do Instagram) já é motorista cadastrado, gráfica parceira ou lead desconhecido. Use ANTES de fornecer informações personalizadas.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Telefone com DDD' },
        name: { type: 'string', description: 'Nome completo' },
        instagram_handle: { type: 'string', description: '@ do Instagram' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_driver_details',
    description:
      'Retorna dados básicos e progresso de um motorista a partir do telefone. Não retorna CPF, PIX, e-mail ou fotos.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Telefone com DDD' },
      },
      required: ['phone'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_campaigns_by_city',
    description:
      'Lista campanhas ATIVAS na cidade informada e indica se ainda aceitam novos motoristas (true) ou se a meta já foi batida (false).',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Nome da cidade' },
      },
      required: ['city'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_graphic',
    description:
      'Procura uma gráfica parceira por telefone ou nome.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        name: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_active_campaigns',
    description:
      'Lista todas as campanhas ATIVAS, com cidade e disponibilidade.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 chamadas por IP por minuto — suficiente para um agente
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32002, message: 'Rate limit exceeded' },
  },
});

// Explicit set of allowed tool names — avoids prototype-key attacks.
const ALLOWED_TOOLS = new Set(Object.keys(TOOLS));

// Rate limit applies to all routes.
// Auth (authenticateMcp) applies ONLY to POST — the GET endpoint is used by MCP
// clients (including GPT Maker) for endpoint discovery and SSE channel setup.
// GET only exposes non-sensitive metadata (tool names, protocol version).
router.use(mcpLimiter);

function ok(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// Supported protocol versions — negotiate with client.
const SUPPORTED_VERSIONS = new Set(['2025-03-26', '2024-11-05']);

router.post('/', authenticateMcp, async (req, res) => {
  // Echo Mcp-Session-Id if provided (MCP 2025-03-26 Streamable HTTP spec)
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId) res.setHeader('Mcp-Session-Id', sessionId);

  const body = req.body || {};
  const { jsonrpc, id, method, params } = body;

  if (jsonrpc !== '2.0') {
    return res.json(fail(id, -32600, 'Invalid JSON-RPC version'));
  }
  if (typeof method !== 'string') {
    return res.json(fail(id, -32600, 'Missing method'));
  }

  try {
    if (method === 'initialize') {
      // Negotiate protocol version: echo client's version if we support it,
      // otherwise fall back to our latest. This avoids version mismatch errors
      // when clients send "2024-11-05".
      const requestedVersion = String(params?.protocolVersion || '');
      const agreedVersion = SUPPORTED_VERSIONS.has(requestedVersion)
        ? requestedVersion
        : PROTOCOL_VERSION;
      return res.json(
        ok(id, {
          protocolVersion: agreedVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        }),
      );
    }

    if (method === 'notifications/initialized' || method === 'ping') {
      // Always return 200 + empty result. Some clients don't handle 204 gracefully.
      return res.json(ok(id ?? 0, {}));
    }

    if (method === 'tools/list') {
      return res.json(ok(id, { tools: TOOL_DEFS }));
    }

    if (method === 'tools/call') {
      const toolName = String(params?.name || '');
      const args = params?.arguments && typeof params.arguments === 'object'
        ? params.arguments
        : {};
      // Validate against an explicit allowlist before indexing into TOOLS.
      // This prevents prototype-key attacks (e.g. 'constructor', '__proto__')
      // that would otherwise pass a naive `typeof fn !== 'function'` check.
      if (!ALLOWED_TOOLS.has(toolName)) {
        return res.json(fail(id, -32601, `Tool not found: ${toolName}`));
      }
      const fn = TOOLS[toolName];
      const result = await fn(args);
      return res.json(
        ok(id, {
          content: [
            { type: 'text', text: JSON.stringify(result, null, 2) },
          ],
          isError: false,
        }),
      );
    }

    return res.json(fail(id, -32601, `Method not found: ${method}`));
  } catch (err) {
    console.error('[MCP] erro inesperado:', err?.message);
    return res.json(fail(id, -32603, 'Internal error'));
  }
});

// GET — SSE stream (MCP 2025-03-26 Streamable HTTP: server-to-client channel)
// When client sends Accept: text/event-stream, open a persistent SSE connection.
// When client sends a regular GET, return metadata JSON (health / discovery).
router.get('/', (req, res) => {
  const acceptHeader = req.headers['accept'] || '';
  if (acceptHeader.includes('text/event-stream')) {
    // Echo session id if provided
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId) res.setHeader('Mcp-Session-Id', sessionId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering on Render

    // Establish channel — send initial comment so the client knows we're alive
    res.write(': connected\n\n');

    // Keep-alive ping every 30s to prevent proxy timeout
    const ping = setInterval(() => {
      if (res.writableEnded) { clearInterval(ping); return; }
      res.write(': ping\n\n');
    }, 30_000);

    req.on('close', () => clearInterval(ping));
    return;
  }

  // Regular JSON — discovery / health check
  res.json({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    server: SERVER_INFO,
    transport: 'streamable-http',
    tools: TOOL_DEFS.map((t) => t.name),
  });
});

export default router;
