const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 60000;

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

export async function callCrmAppsScript(action, payload = {}) {
  const config = readConfig();
  if (!config.configured) {
    throw new CrmIntegrationError('A integracao do CRM ainda nao foi configurada no servidor.', {
      status: 503,
      code: 'CRM_NOT_CONFIGURED',
    });
  }

  const url = validateWebAppUrl(config.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
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
    });

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
  }
}
