// =====================================================
// CONFIGURACAO CENTRAL DE BACKEND
// =====================================================
// Ordem de prioridade:
// 1) window.__API_BASE_OVERRIDE__
// 2) <meta name="api-base" content="https://api...">
// 3) URL query (?apiBase=...)
// 4) PRODUCTION_BACKEND_URL (ambiente remoto)
// 5) localStorage['oddrive_api_base'] (principalmente dev/local)
// 6) local/LAN: protocolo atual + hostname + :10000
// 7) fallback: mesmo dominio (API_BASE vazio => '/api')
// =====================================================

(function () {
  'use strict';

  const hostname = window.location.hostname;
  const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';
  const isLAN = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  const isHttps = window.location.protocol === 'https:';

  // URL do backend em produção (Render.com).
  // Após o deploy, atualize com a URL real do serviço "oddrive-backend" no Render.
  // Acesse: Render Dashboard → oddrive-backend → URL do serviço
  const PRODUCTION_BACKEND_URL = 'https://oddrive-backend-hpt8.onrender.com';

  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/\/+$/, '');
  }

  function isAllowedApiBase(apiBase) {
    if (!apiBase) return true;
    if (isLocalDev || isLAN) return true;
    try {
      const candidate = new URL(apiBase, window.location.origin);
      const allowedOrigins = new Set([window.location.origin]);
      const productionBase = normalizeUrl(PRODUCTION_BACKEND_URL);
      if (productionBase) allowedOrigins.add(new URL(productionBase).origin);
      return allowedOrigins.has(candidate.origin);
    } catch (_) {
      return false;
    }
  }

  function readMetaApiBase() {
    try {
      const meta = document.querySelector('meta[name="api-base"]');
      return normalizeUrl(meta ? meta.content : '');
    } catch (_) {
      return '';
    }
  }

  function readUrlApiBase() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (!params.has('apiBase') && !params.has('api_base')) {
        return { provided: false, value: '' };
      }
      const rawValue = params.get('apiBase') || params.get('api_base') || '';
      return { provided: true, value: normalizeUrl(rawValue) };
    } catch (_) {
      return { provided: false, value: '' };
    }
  }

  function readStoredApiBase() {
    try {
      return normalizeUrl(localStorage.getItem('oddrive_api_base') || '');
    } catch (_) {
      return '';
    }
  }

  function persistApiBase(apiBase) {
    try {
      if (!isLocalDev && !isLAN) return;
      if (apiBase) {
        localStorage.setItem('oddrive_api_base', apiBase);
      } else {
        localStorage.removeItem('oddrive_api_base');
      }
    } catch (_) {}
  }

  const overrideApiBase = normalizeUrl(window.__API_BASE_OVERRIDE__ || '');
  const urlApiBase = readUrlApiBase();
  if (urlApiBase.provided && isAllowedApiBase(urlApiBase.value)) {
    persistApiBase(urlApiBase.value);
  }
  const metaApiBase = readMetaApiBase();
  const storedApiBase = readStoredApiBase();
  const configuredProductionBase = normalizeUrl(PRODUCTION_BACKEND_URL);

  let apiBase = '';

  if (overrideApiBase) {
    apiBase = overrideApiBase;
  } else if (metaApiBase) {
    apiBase = metaApiBase;
  } else if (urlApiBase.provided && isAllowedApiBase(urlApiBase.value)) {
    apiBase = urlApiBase.value;
  } else if (!isLocalDev && !isLAN && configuredProductionBase) {
    // Em ambiente remoto, prioriza URL oficial para evitar localhost salvo no navegador.
    apiBase = configuredProductionBase;
  } else if (storedApiBase) {
    apiBase = storedApiBase;
  } else if (isLocalDev || isLAN) {
    apiBase = `${window.location.protocol}//${hostname}:10000`;
  } else {
    // Mesmo dominio: front e backend servidos sob o mesmo host.
    apiBase = '';
  }

  window.API_BASE = apiBase;

  // Compatibilidade com scripts legados que usam WORKSPACE_CONFIG.
  window.WORKSPACE_CONFIG = {
    isProduction: !isLocalDev,
    isDevelopment: isLocalDev,
    BACKEND_URL: window.API_BASE,
    getBackendUrl: function () {
      return this.BACKEND_URL;
    },
  };

  if (!window.API_BASE && !isLocalDev && !isLAN) {
    console.warn(
      '[CONFIG] API_BASE vazio em ambiente remoto. Configure PRODUCTION_BACKEND_URL ou window.__API_BASE_OVERRIDE__.'
    );
  }

  if (!isHttps && !isLocalDev) {
    console.warn('[CONFIG] Frontend remoto em HTTP. A camera do motorista/grafica exige HTTPS.');
  }

  console.log('[CONFIG] API_BASE =', window.API_BASE || '(same-origin)');
})();
