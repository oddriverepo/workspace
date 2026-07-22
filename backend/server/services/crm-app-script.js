import { recordCacheEvent, recordExternalCall } from './runtime-telemetry.js';
import { runWorkload } from './workload-manager.js';

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 60000;
const READ_CACHE_TTL_MS = Math.max(
  5000,
  Number.parseInt(process.env.CRM_APPS_SCRIPT_CACHE_TTL_MS || '60000', 10) || 60000,
);
const READ_ACTIONS = new Set(['listLeads', 'listForwarded']);
const readCache = new Map();
const inFlightReads = new Map();

export class CrmIntegrationError extends Error {
  constructor(message, { status = 502, code = 'CRM_INTEGRATION_ERROR', details = null } = {}) {
    super(message);
    this.name = 'CrmIntegrationError';
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
  const url = String(process.env.CRM_APPS_SCRIPT_URL || '').trim();
  const secret = String(process.env.CRM_APPS_SCRIPT_SECRET || '').trim();

  return {
    url,
    secret,
    timeoutMs: parseTimeout(process.env.CRM_APPS_SCRIPT_TIMEOUT_MS),
    configured: Boolean(url && secret),
  };
}

function validateWebAppUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CrmIntegrationError('A URL do Web App do CRM e invalida.', {
      status: 503,
      code: 'CRM_INVALID_URL',
    });
  }

  const allowedHosts = new Set(['script.google.com', 'script.googleusercontent.com']);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new CrmIntegrationError('A URL do CRM deve apontar para um Web App HTTPS do Google Apps Script.', {
      status: 503,
      code: 'CRM_INVALID_URL',
    });
  }

  return url.toString();
}

export function getCrmIntegrationStatus() {
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
    throw new CrmIntegrationError(
      'O Web App do CRM nao retornou JSON. Verifique a publicacao e as permissoes do Apps Script.',
      { code: 'CRM_INVALID_RESPONSE' },
    );
  }
}

function cacheGet(action) {
  const entry = readCache.get(action);
  if (!entry || Date.now() - entry.at >= READ_CACHE_TTL_MS) {
    if (entry) readCache.delete(action);
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
    const response = await runWorkload('external', `apps-script:${action}`, () => fetch(url, {
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
      throw new CrmIntegrationError('O Web App do CRM recusou a solicitacao.', {
        status: 502,
        code: 'CRM_UPSTREAM_HTTP_ERROR',
        details: { upstreamStatus: response.status },
      });
    }

    if (result?.ok === false || result?.success === false) {
      throw new CrmIntegrationError(
        String(result.error || result.message || 'O Apps Script nao conseguiu processar a operacao.'),
        { code: String(result.code || 'CRM_UPSTREAM_ERROR') },
      );
    }

    ok = true;
    return result;
  } catch (error) {
    if (error instanceof CrmIntegrationError) throw error;
    if (error?.name === 'AbortError') {
      throw new CrmIntegrationError('O Web App do CRM demorou demais para responder.', {
        status: 504,
        code: 'CRM_TIMEOUT',
      });
    }
    throw new CrmIntegrationError('Nao foi possivel conectar ao Web App do CRM.', {
      code: 'CRM_CONNECTION_ERROR',
    });
  } finally {
    clearTimeout(timeout);
    recordExternalCall('Google Apps Script', { durationMs: Date.now() - startedAt, ok });
  }
}

export async function callCrmAppsScript(action, payload = {}) {
  const config = readConfig();
  if (!config.configured) {
    throw new CrmIntegrationError('A integracao do CRM ainda nao foi configurada no servidor.', {
      status: 503,
      code: 'CRM_NOT_CONFIGURED',
    });
  }
  const url = validateWebAppUrl(config.url);

  if (READ_ACTIONS.has(action)) {
    const cached = cacheGet(action);
    if (cached) {
      recordCacheEvent(`Apps Script - ${action}`, true);
      return cached;
    }
    recordCacheEvent(`Apps Script - ${action}`, false);
    if (inFlightReads.has(action)) return inFlightReads.get(action);
    const promise = callUpstream(action, payload, config, url)
      .then((result) => {
        readCache.set(action, { value: result, at: Date.now() });
        return result;
      })
      .finally(() => inFlightReads.delete(action));
    inFlightReads.set(action, promise);
    return promise;
  }

  const result = await callUpstream(action, payload, config, url);
  invalidateReadCache();
  return result;
}
