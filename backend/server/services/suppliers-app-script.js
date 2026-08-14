import { recordCacheEvent, recordExternalCall } from './runtime-telemetry.js';
import { runWorkload } from './workload-manager.js';

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 60000;
const READ_CACHE_TTL_MS = Math.max(
  5000,
  Number.parseInt(process.env.SUPPLIERS_APPS_SCRIPT_CACHE_TTL_MS || '60000', 10) || 60000,
);
const READ_ACTIONS = new Set(['status', 'listSuppliers', 'listSaleValues']);
const readCache = new Map();
const inFlightReads = new Map();

export class SuppliersIntegrationError extends Error {
  constructor(message, { status = 502, code = 'SUPPLIERS_INTEGRATION_ERROR', details = null } = {}) {
    super(message);
    this.name = 'SuppliersIntegrationError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parseTimeout(value) {
  const timeout = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(timeout) || timeout < 1000) return DEFAULT_TIMEOUT_MS;
  return Math.min(timeout, MAX_TIMEOUT_MS);
}

function readConfig() {
  const url = String(process.env.SUPPLIERS_APPS_SCRIPT_URL || '').trim();
  const secret = String(process.env.SUPPLIERS_APPS_SCRIPT_SECRET || '').trim();

  return {
    url,
    secret,
    timeoutMs: parseTimeout(process.env.SUPPLIERS_APPS_SCRIPT_TIMEOUT_MS),
    configured: Boolean(url && secret),
  };
}

function validateWebAppUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SuppliersIntegrationError('A URL do Web App da tabela de graficas e invalida.', {
      status: 503,
      code: 'SUPPLIERS_INVALID_URL',
    });
  }

  const allowedHosts = new Set(['script.google.com', 'script.googleusercontent.com']);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new SuppliersIntegrationError(
      'A URL da tabela de graficas deve apontar para um Web App HTTPS do Google Apps Script.',
      { status: 503, code: 'SUPPLIERS_INVALID_URL' },
    );
  }

  return url.toString();
}

export function getSuppliersIntegrationStatus() {
  const config = readConfig();
  return {
    configured: config.configured,
    provider: 'google-apps-script',
  };
}

function parseJsonResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SuppliersIntegrationError(
      'O Web App da tabela de graficas nao retornou JSON. Verifique a publicacao e as permissoes do Apps Script.',
      { code: 'SUPPLIERS_INVALID_RESPONSE' },
    );
  }
}

function cacheKey(action, payload) {
  if (!payload || !Object.keys(payload).length) return action;
  return `${action}:${JSON.stringify(payload)}`;
}

function cacheGet(key) {
  const entry = readCache.get(key);
  if (!entry || Date.now() - entry.at >= READ_CACHE_TTL_MS) {
    if (entry) readCache.delete(key);
    return null;
  }
  return entry.value;
}

function invalidateReadCache() {
  readCache.clear();
}

async function callUpstream(action, payload, config, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  let ok = false;

  try {
    const response = await runWorkload('external', `apps-script-suppliers:${action}`, () => fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        action,
        secret: config.secret,
      }),
      signal: controller.signal,
    }));

    const text = await response.text();
    const result = parseJsonResponse(text);

    if (!response.ok) {
      throw new SuppliersIntegrationError('O Web App da tabela de graficas recusou a solicitacao.', {
        status: 502,
        code: 'SUPPLIERS_UPSTREAM_HTTP_ERROR',
        details: { upstreamStatus: response.status },
      });
    }

    if (result?.ok === false || result?.success === false) {
      throw new SuppliersIntegrationError(
        String(result.error || result.message || 'O Apps Script nao conseguiu processar a operacao.'),
        { code: String(result.code || 'SUPPLIERS_UPSTREAM_ERROR') },
      );
    }

    ok = true;
    return result;
  } catch (error) {
    if (error instanceof SuppliersIntegrationError) throw error;
    if (error?.name === 'AbortError') {
      throw new SuppliersIntegrationError('O Web App da tabela de graficas demorou demais para responder.', {
        status: 504,
        code: 'SUPPLIERS_TIMEOUT',
      });
    }
    throw new SuppliersIntegrationError('Nao foi possivel conectar ao Web App da tabela de graficas.', {
      code: 'SUPPLIERS_CONNECTION_ERROR',
    });
  } finally {
    clearTimeout(timeout);
    recordExternalCall('Google Apps Script - Tabela de Graficas', {
      durationMs: Date.now() - startedAt,
      ok,
    });
  }
}

export async function callSuppliersAppsScript(action, payload = {}, options = {}) {
  const config = readConfig();
  if (!config.configured) {
    throw new SuppliersIntegrationError('A integracao da tabela de graficas ainda nao foi configurada no servidor.', {
      status: 503,
      code: 'SUPPLIERS_NOT_CONFIGURED',
    });
  }
  const url = validateWebAppUrl(config.url);

  if (READ_ACTIONS.has(action)) {
    const forceRefresh = Boolean(options?.force);
    const key = cacheKey(action, payload);
    if (!forceRefresh) {
      const cached = cacheGet(key);
      if (cached) {
        recordCacheEvent(`Apps Script Suppliers - ${action}`, true);
        return cached;
      }
    }
    recordCacheEvent(`Apps Script Suppliers - ${action}`, false);
    if (inFlightReads.has(key)) return inFlightReads.get(key);
    const promise = callUpstream(action, payload, config, url)
      .then((result) => {
        readCache.set(key, { value: result, at: Date.now() });
        return result;
      })
      .finally(() => inFlightReads.delete(key));
    inFlightReads.set(key, promise);
    return promise;
  }

  const result = await callUpstream(action, payload, config, url);
  invalidateReadCache();
  return result;
}
