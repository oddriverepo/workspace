import { env } from "../config.js";
import { getRuntimeConfig } from "../store/runtime-config.repo.js";

// In-memory cache for the runtime token so we don't hit MongoDB on every API call
let _cachedRuntimeToken = null;
let _cachedRuntimeTokenAt = 0;
const RUNTIME_TOKEN_CACHE_MS = 60_000; // re-read from DB at most once per minute

function getGraphBaseUrl() {
  return `https://graph.facebook.com/${env.metaApiVersion}`;
}

async function resolveToken(token) {
  if (token) return token;
  if (env.metaSystemUserToken) return env.metaSystemUserToken;

  // Fallback: check runtime config (token saved via onboarding or admin API)
  const now = Date.now();
  if (_cachedRuntimeToken && (now - _cachedRuntimeTokenAt) < RUNTIME_TOKEN_CACHE_MS) {
    return _cachedRuntimeToken;
  }
  try {
    const stored = await getRuntimeConfig("META_SYSTEM_USER_TOKEN");
    if (stored) {
      _cachedRuntimeToken = stored;
      _cachedRuntimeTokenAt = now;
      return stored;
    }
  } catch (_) { /* MongoDB may not be ready yet */ }

  const error = new Error("Token da Meta nao configurado.");
  error.code = "MISSING_META_TOKEN";
  error.statusCode = 400;
  throw error;
}

/** Clear the in-memory token cache (call after saving a new token). */
export function clearTokenCache() {
  _cachedRuntimeToken = null;
  _cachedRuntimeTokenAt = 0;
}

// =====================================================================
// Rate limit telemetry & backoff
// =====================================================================
// A Meta retorna o header X-Business-Use-Case-Usage (JSON) com:
//   call_count, total_cputime, total_time (cada um 0-100, % do limite por hora)
//   estimated_time_to_regain_access (minutos, > 0 quando bloqueado)
// Quando estouramos, vem erro com code=80001 / subcode 2494055.
// Mantemos a "cool down" em memoria para curto-circuitar novas chamadas.
const _rateLimitState = {
  lastUsage: null,            // { call_count, total_cputime, total_time, capturedAt }
  lastUsageMax: 0,
  blockedUntil: 0,            // epoch ms; > Date.now() => recusa chamadas
  lastWarnAt: 0,
};
const RATE_WARN_THRESHOLD = 70;   // %
const RATE_WARN_COOLDOWN_MS = 60_000;

export function getMetaRateLimitState() {
  return {
    lastUsage: _rateLimitState.lastUsage,
    lastUsageMax: _rateLimitState.lastUsageMax,
    blockedUntil: _rateLimitState.blockedUntil,
    blockedNow: _rateLimitState.blockedUntil > Date.now(),
    secondsUntilReset: Math.max(0, Math.ceil((_rateLimitState.blockedUntil - Date.now()) / 1000)),
  };
}

function _parseUsageHeader(headerValue) {
  if (!headerValue) return null;
  try {
    const parsed = JSON.parse(headerValue);
    // Header pode vir como objeto { "<id>": [ { call_count, ... } ] } ou array direto.
    if (Array.isArray(parsed)) return parsed[0] || null;
    if (parsed && typeof parsed === "object") {
      const firstKey = Object.keys(parsed)[0];
      const firstVal = firstKey ? parsed[firstKey] : null;
      if (Array.isArray(firstVal)) return firstVal[0] || null;
      return firstVal || parsed;
    }
  } catch (_) { /* nao e JSON valido */ }
  return null;
}

function _recordUsageFromResponse(response, label) {
  const raw =
    response.headers.get("x-business-use-case-usage") ||
    response.headers.get("x-app-usage") ||
    response.headers.get("x-ad-account-usage");
  const usage = _parseUsageHeader(raw);
  if (!usage) return;

  const callCount = Number(usage.call_count || 0);
  const cpu = Number(usage.total_cputime || 0);
  const time = Number(usage.total_time || 0);
  const max = Math.max(callCount, cpu, time);
  const wait = Number(usage.estimated_time_to_regain_access || 0);

  _rateLimitState.lastUsage = { call_count: callCount, total_cputime: cpu, total_time: time, capturedAt: Date.now() };
  _rateLimitState.lastUsageMax = max;

  if (wait > 0) {
    _rateLimitState.blockedUntil = Date.now() + (wait * 60_000);
    console.warn(`[meta-rate-limit] ${label || "request"}: BLOQUEADO. Aguardar ~${wait} min (call=${callCount}% cpu=${cpu}% time=${time}%).`);
    return;
  }

  if (max >= RATE_WARN_THRESHOLD) {
    const now = Date.now();
    if (now - _rateLimitState.lastWarnAt > RATE_WARN_COOLDOWN_MS) {
      _rateLimitState.lastWarnAt = now;
      console.warn(`[meta-rate-limit] ${label || "request"}: uso alto (call=${callCount}% cpu=${cpu}% time=${time}%). Limite e 5000/h por WABA.`);
    }
  }
}

function _checkBackoffOrThrow() {
  const remaining = _rateLimitState.blockedUntil - Date.now();
  if (remaining > 0) {
    const minutes = Math.ceil(remaining / 60_000);
    const error = new Error(`Limite de chamadas da Meta atingido. Aguarde ~${minutes} minuto(s) e tente novamente.`);
    error.code = "META_RATE_LIMITED";
    error.statusCode = 429;
    error.meta = { secondsUntilReset: Math.ceil(remaining / 1000), source: "local-backoff" };
    throw error;
  }
}

async function graphRequest(path, { method = "GET", token, body, params } = {}) {
  _checkBackoffOrThrow();

  const url = new URL(`${getGraphBaseUrl()}/${path.replace(/^\//, "")}`);
  if (params && typeof params === "object") {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const resolvedToken = await resolveToken(token);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  _recordUsageFromResponse(response, `${method} ${path}`);

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    // Erros tipicos de rate limit: code 80001 (too many calls) ou 4 (app limit) ou 17 (user limit) ou 32 (page limit) ou 613.
    const errCode = payload && payload.error && payload.error.code;
    const isRateLimit =
      response.status === 429 ||
      errCode === 80001 || errCode === 4 || errCode === 17 || errCode === 32 || errCode === 613;

    if (isRateLimit) {
      // Se a Meta nao mandou estimated_time, usamos 5min de fallback.
      if (_rateLimitState.blockedUntil <= Date.now()) {
        _rateLimitState.blockedUntil = Date.now() + 5 * 60_000;
      }
      const minutes = Math.ceil((_rateLimitState.blockedUntil - Date.now()) / 60_000);
      const error = new Error(`Limite de chamadas da Meta atingido (code ${errCode || response.status}). Aguarde ~${minutes} minuto(s).`);
      error.code = "META_RATE_LIMITED";
      error.statusCode = 429;
      error.meta = payload;
      throw error;
    }

    const error = new Error(`Erro Meta Graph API (${response.status}).`);
    error.code = "META_API_ERROR";
    error.statusCode = response.status;
    error.meta = payload;
    throw error;
  }

  return payload;
}

export async function testMetaConnection() {
  if (!env.metaWabaId) {
    const error = new Error("META_WABA_ID nao configurado.");
    error.code = "MISSING_WABA_ID";
    error.statusCode = 400;
    throw error;
  }
  return graphRequest(`${env.metaWabaId}`, {
    params: { fields: "id,name,currency" },
  });
}

export async function listPhoneNumbers() {
  if (!env.metaWabaId) {
    const error = new Error("META_WABA_ID nao configurado.");
    error.code = "MISSING_WABA_ID";
    error.statusCode = 400;
    throw error;
  }
  return graphRequest(`${env.metaWabaId}/phone_numbers`);
}

export async function createMetaTemplate(input) {
  if (!env.metaWabaId) {
    const error = new Error("META_WABA_ID nao configurado para criar template.");
    error.code = "MISSING_WABA_ID";
    error.statusCode = 400;
    throw error;
  }

  const components = [];
  const headerType = String(input.headerType || "none").toLowerCase();
  if (headerType === "text" && input.headerText) {
    const headerComponent = { type: "HEADER", format: "TEXT", text: String(input.headerText) };
    if (Array.isArray(input.headerExamples) && input.headerExamples.length) {
      headerComponent.example = { header_text: input.headerExamples.map(String) };
    }
    components.push(headerComponent);
  } else if (headerType === "image" || headerType === "video" || headerType === "document") {
    const handle = String(input.headerMediaHandle || "").trim();
    const headerComponent = { type: "HEADER", format: headerType.toUpperCase() };
    if (handle) headerComponent.example = { header_handle: [handle] };
    components.push(headerComponent);
  } else if (headerType === "location") {
    components.push({ type: "HEADER", format: "LOCATION" });
  }

  const bodyComponent = { type: "BODY", text: String(input.bodyText || "") };
  const bodyTextStr = String(input.bodyText || "");
  // Detecta placeholders nomeados ({{nome}}) — formato atual recomendado pela Meta.
  const namedPlaceholderNames = (() => {
    const list = [];
    const seen = new Set();
    bodyTextStr.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => {
      if (!seen.has(name)) {
        seen.add(name);
        list.push(name);
      }
      return _;
    });
    return list;
  })();
  const hasNamedPlaceholders = namedPlaceholderNames.length > 0;
  const bodyExamplesRaw = Array.isArray(input.bodyExamples) ? input.bodyExamples : [];
  if (bodyExamplesRaw.length) {
    if (hasNamedPlaceholders) {
      // Constroi body_text_named_params no formato exigido pela Meta v22.
      const byName = new Map();
      bodyExamplesRaw.forEach((item, idx) => {
        if (item && typeof item === "object" && (item.name || item.param_name)) {
          byName.set(String(item.name || item.param_name), String(item.example ?? item.value ?? ""));
        } else {
          const fallbackName = namedPlaceholderNames[idx];
          if (fallbackName) byName.set(fallbackName, String(item ?? ""));
        }
      });
      const named = namedPlaceholderNames.map((name, idx) => ({
        param_name: name,
        example: byName.has(name) ? byName.get(name) : String(bodyExamplesRaw[idx] ?? ""),
      }));
      bodyComponent.example = { body_text_named_params: named };
    } else {
      // Compatibilidade com formato posicional ({{1}}) legado.
      const flat = bodyExamplesRaw.map((it) =>
        it && typeof it === "object" ? String(it.example ?? it.value ?? "") : String(it ?? "")
      );
      bodyComponent.example = { body_text: [flat] };
    }
  }
  components.push(bodyComponent);

  if (input.footerText) {
    components.push({ type: "FOOTER", text: String(input.footerText).slice(0, 60) });
  }

  const buttons = Array.isArray(input.buttons) ? input.buttons : [];
  if (buttons.length) {
    const normalizedButtons = buttons
      .map((btn) => {
        const type = String(btn?.type || "quick_reply").toLowerCase();
        const isOptOut = btn?.isOptOut === true;
        // Meta nao tem flag explicito de opt-out: e detectado pelo texto.
        // Quando marcado, usamos o texto recomendado pela Meta.
        const text = isOptOut
          ? String(btn?.text || "Parar promocoes").trim().slice(0, 25)
          : String(btn?.text || "").trim().slice(0, 25);
        if (!text && type !== "copy_code") return null;
        if (type === "url") {
          const url = String(btn?.url || "").trim();
          if (!url) return null;
          const out = { type: "URL", text, url };
          if (Array.isArray(btn?.urlExamples) && btn.urlExamples.length) {
            out.example = btn.urlExamples.map(String);
          }
          return out;
        }
        if (type === "phone_number") {
          const phoneNumber = String(btn?.phoneNumber || "").trim();
          if (!phoneNumber) return null;
          return { type: "PHONE_NUMBER", text, phone_number: phoneNumber };
        }
        if (type === "copy_code") {
          const code = String(btn?.code || btn?.example || "").trim();
          if (!code) return null;
          return { type: "COPY_CODE", example: code };
        }
        return { type: "QUICK_REPLY", text };
      })
      .filter(Boolean)
      .slice(0, 10);
    if (normalizedButtons.length) {
      components.push({ type: "BUTTONS", buttons: normalizedButtons });
    }
  }

  const payload = {
    name: String(input.name || "").toLowerCase(),
    language: String(input.language || "pt_BR"),
    category: String(input.category || "MARKETING").toUpperCase(),
    components,
  };
  if (input.allowCategoryChange === true) {
    payload.allow_category_change = true;
  }

  return graphRequest(`${env.metaWabaId}/message_templates`, {
    method: "POST",
    body: payload,
  });
}

/**
 * Remove um template (Meta exige nome, e id se houver multiplos idiomas).
 */
export async function deleteMetaTemplate({ name, hsmId } = {}) {
  if (!env.metaWabaId) {
    const error = new Error("META_WABA_ID nao configurado para remover template.");
    error.code = "MISSING_WABA_ID";
    error.statusCode = 400;
    throw error;
  }
  if (!name) {
    const error = new Error("Nome do template obrigatorio para remocao.");
    error.code = "INVALID_TEMPLATE_NAME";
    error.statusCode = 400;
    throw error;
  }
  const params = { name };
  if (hsmId) params.hsm_id = hsmId;
  return graphRequest(`${env.metaWabaId}/message_templates`, {
    method: "DELETE",
    params,
  });
}

/**
 * Upload de midia para uso em template HEADER (imagem/video/documento).
 * Usa Resumable Upload API: POST /{app_id}/uploads cria sessao, depois
 * envia bytes em POST /{upload_id}. Retorna o handle "h:..." para usar
 * em example.header_handle.
 *
 * @param {object} args
 * @param {Buffer} args.fileBuffer
 * @param {number} args.fileLength
 * @param {string} args.fileName
 * @param {string} args.fileType - mime
 */
export async function uploadTemplateMedia({ fileBuffer, fileLength, fileName, fileType }) {
  if (!env.metaAppId) {
    const error = new Error("META_APP_ID nao configurado para upload de midia.");
    error.code = "MISSING_APP_ID";
    error.statusCode = 400;
    throw error;
  }
  const token = await resolveToken();

  // Respeita backoff global da Meta antes de gastar 2 chamadas com upload
  _checkBackoffOrThrow();

  // 1) Cria sessao resumable
  const createUrl = new URL(`${getGraphBaseUrl()}/${env.metaAppId}/uploads`);
  createUrl.searchParams.set("file_name", String(fileName || "upload.bin"));
  createUrl.searchParams.set("file_length", String(fileLength));
  createUrl.searchParams.set("file_type", String(fileType || "application/octet-stream"));
  createUrl.searchParams.set("access_token", token);

  const createRes = await fetch(createUrl.toString(), { method: "POST" });
  _recordUsageFromResponse(createRes, `POST ${env.metaAppId}/uploads`);
  const createPayload = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createPayload?.id) {
    const error = new Error("Falha ao iniciar upload de midia na Meta.");
    error.code = "META_UPLOAD_INIT_ERROR";
    error.statusCode = createRes.status;
    error.meta = createPayload;
    throw error;
  }
  const uploadId = createPayload.id; // ex.: "upload:abc..."

  // 2) Envia bytes
  _checkBackoffOrThrow();
  const uploadUrl = `${getGraphBaseUrl()}/${uploadId}`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      file_offset: "0",
    },
    body: fileBuffer,
  });
  _recordUsageFromResponse(uploadRes, `POST ${uploadId}`);
  const uploadPayload = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || !uploadPayload?.h) {
    const error = new Error("Falha ao enviar bytes da midia para Meta.");
    error.code = "META_UPLOAD_BYTES_ERROR";
    error.statusCode = uploadRes.status;
    error.meta = uploadPayload;
    throw error;
  }

  return { handle: uploadPayload.h, uploadId };
}

// Extrai nomes de placeholders nomeados ({{nome}}) do texto na ordem de ocorrencia, sem duplicar.
function extractNamedPlaceholders(text) {
  const names = [];
  const seen = new Set();
  String(text || "").replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    return _;
  });
  return names;
}

export async function sendTemplateMessage({ to, templateName, languageCode = "pt_BR", parameters = [], bodyTemplateText = "", headerType = "none", headerImageUrl = "", headerImageId = "" }) {
  if (!env.metaPhoneNumberId) {
    const error = new Error("META_PHONE_NUMBER_ID nao configurado para envio.");
    error.code = "MISSING_PHONE_NUMBER_ID";
    error.statusCode = 400;
    throw error;
  }

  // Detecta se o template usa parametros nomeados ({{nome}}) ou posicionais ({{1}}).
  const bodyText = String(bodyTemplateText || "");
  const hasPositional = /\{\{\s*\d+\s*\}\}/.test(bodyText);
  const namedParams = !hasPositional ? extractNamedPlaceholders(bodyText) : [];
  const useNamed = namedParams.length > 0 && parameters.length > 0;

  const bodyParameters = useNamed
    ? namedParams.map((name, idx) => ({
        type: "text",
        parameter_name: name,
        text: String(parameters[idx] ?? parameters[0] ?? ""),
      }))
    : parameters.map((value) => ({ type: "text", text: String(value) }));

  const components = [];

  // Header IMAGE: a Meta exige o componente header no envio quando o template foi
  // criado com header de imagem. Preferimos `id` (whatsapp media id), senao `link`.
  const normalizedHeaderType = String(headerType || "").toLowerCase();
  if (normalizedHeaderType === "image") {
    const imageId = String(headerImageId || "").trim();
    const imageLink = String(headerImageUrl || "").trim();
    if (imageId) {
      components.push({ type: "header", parameters: [{ type: "image", image: { id: imageId } }] });
    } else if (imageLink) {
      components.push({ type: "header", parameters: [{ type: "image", image: { link: imageLink } }] });
    }
  } else if (normalizedHeaderType === "video") {
    const id = String(headerImageId || "").trim();
    const link = String(headerImageUrl || "").trim();
    if (id) components.push({ type: "header", parameters: [{ type: "video", video: { id } }] });
    else if (link) components.push({ type: "header", parameters: [{ type: "video", video: { link } }] });
  } else if (normalizedHeaderType === "document") {
    const id = String(headerImageId || "").trim();
    const link = String(headerImageUrl || "").trim();
    if (id) components.push({ type: "header", parameters: [{ type: "document", document: { id } }] });
    else if (link) components.push({ type: "header", parameters: [{ type: "document", document: { link } }] });
  }

  if (bodyParameters.length) {
    components.push({ type: "body", parameters: bodyParameters });
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {}),
    },
  };

  return graphRequest(`${env.metaPhoneNumberId}/messages`, {
    method: "POST",
    body: payload,
  });
}

export async function sendTextMessage({ to, text, previewUrl = false }) {
  if (!env.metaPhoneNumberId) {
    const error = new Error("META_PHONE_NUMBER_ID nao configurado para envio.");
    error.code = "MISSING_PHONE_NUMBER_ID";
    error.statusCode = 400;
    throw error;
  }

  const content = String(text || "").trim();
  if (!content) {
    const error = new Error("Texto da mensagem nao pode ser vazio.");
    error.code = "INVALID_TEXT_PAYLOAD";
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: content,
      preview_url: previewUrl === true,
    },
  };

  return graphRequest(`${env.metaPhoneNumberId}/messages`, {
    method: "POST",
    body: payload,
  });
}

export async function sendImageMessage({ to, imageUrl, caption = "" }) {
  if (!env.metaPhoneNumberId) {
    const error = new Error("META_PHONE_NUMBER_ID nao configurado para envio.");
    error.code = "MISSING_PHONE_NUMBER_ID";
    error.statusCode = 400;
    throw error;
  }

  const link = String(imageUrl || "").trim();
  if (!link) {
    const error = new Error("URL da imagem nao pode ser vazia.");
    error.code = "INVALID_IMAGE_PAYLOAD";
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link,
    },
  };

  const safeCaption = String(caption || "").trim();
  if (safeCaption) {
    payload.image.caption = safeCaption;
  }

  return graphRequest(`${env.metaPhoneNumberId}/messages`, {
    method: "POST",
    body: payload,
  });
}

export async function sendInteractiveButtonsMessage({ to, bodyText, buttons = [] }) {
  if (!env.metaPhoneNumberId) {
    const error = new Error("META_PHONE_NUMBER_ID nao configurado para envio.");
    error.code = "MISSING_PHONE_NUMBER_ID";
    error.statusCode = 400;
    throw error;
  }

  const safeBody = String(bodyText || "").trim();
  if (!safeBody) {
    const error = new Error("Texto do corpo nao pode ser vazio para mensagem com botoes.");
    error.code = "INVALID_BUTTONS_PAYLOAD";
    error.statusCode = 400;
    throw error;
  }

  const safeButtons = (Array.isArray(buttons) ? buttons : []).slice(0, 3).map((btn, i) => ({
    type: "reply",
    reply: {
      id: String(btn.id || btn.buttonId || `btn_${i}`),
      title: String(btn.text || btn.title || "").slice(0, 20),
    },
  }));

  if (!safeButtons.length) {
    const error = new Error("Pelo menos um botao e necessario.");
    error.code = "INVALID_BUTTONS_PAYLOAD";
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: safeBody },
      action: { buttons: safeButtons },
    },
  };

  return graphRequest(`${env.metaPhoneNumberId}/messages`, {
    method: "POST",
    body: payload,
  });
}

export async function exchangeCodeForAccessToken({ code, redirectUri }) {
  if (!env.metaAppId || !env.metaAppSecret) {
    const error = new Error("META_APP_ID ou META_APP_SECRET nao configurados.");
    error.code = "MISSING_META_APP_CREDENTIALS";
    error.statusCode = 400;
    throw error;
  }

  const url = new URL(`https://graph.facebook.com/${env.metaApiVersion}/oauth/access_token`);
  const body = new URLSearchParams({
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error("Falha ao trocar code por access token na Meta.");
    error.code = "META_TOKEN_EXCHANGE_ERROR";
    error.statusCode = response.status;
    error.meta = payload;
    throw error;
  }

  return payload;
}

/**
 * List message templates from Meta Cloud API for the configured WABA.
 * Useful for syncing template statuses (approved/rejected) from Meta.
 */
export async function listMetaTemplates({ limit = 100, fields = "name,status,language,category,id" } = {}) {
  if (!env.metaWabaId) {
    const error = new Error("META_WABA_ID nao configurado para listar templates.");
    error.code = "MISSING_WABA_ID";
    error.statusCode = 400;
    throw error;
  }
  return graphRequest(`${env.metaWabaId}/message_templates`, {
    params: { fields, limit: String(limit) },
  });
}

/**
 * Baixa uma midia recebida via webhook (inbound).
 * Fluxo Meta:
 *   1) GET /{media_id} -> retorna { url, mime_type, sha256, file_size }
 *   2) GET <url> com Authorization Bearer -> bytes
 *
 * Retorna { buffer, mimeType, sha256, fileSize }.
 */
export async function downloadInboundMedia(mediaId) {
  const id = String(mediaId || "").trim();
  if (!id) {
    const error = new Error("mediaId obrigatorio.");
    error.code = "MISSING_MEDIA_ID";
    error.statusCode = 400;
    throw error;
  }

  // 1) Resolve a URL temporaria + metadados (passa pela telemetria/backoff do graphRequest)
  const meta = await graphRequest(id, {
    params: { fields: "url,mime_type,sha256,file_size,messaging_product" },
  });
  const downloadUrl = String(meta?.url || "").trim();
  if (!downloadUrl) {
    const error = new Error("Meta nao retornou URL para download da midia.");
    error.code = "META_MEDIA_NO_URL";
    error.statusCode = 502;
    error.meta = meta;
    throw error;
  }

  // 2) Baixa bytes (a URL e do dominio lookaside.fbsbx.com e exige Bearer)
  _checkBackoffOrThrow();
  const token = await resolveToken();
  const bytesRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  _recordUsageFromResponse(bytesRes, `GET media bytes ${id}`);
  if (!bytesRes.ok) {
    const error = new Error(`Falha ao baixar bytes da midia (${bytesRes.status}).`);
    error.code = "META_MEDIA_DOWNLOAD_ERROR";
    error.statusCode = bytesRes.status;
    throw error;
  }

  const arrayBuf = await bytesRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    mimeType: String(meta?.mime_type || bytesRes.headers.get("content-type") || "application/octet-stream"),
    sha256: String(meta?.sha256 || ""),
    fileSize: Number(meta?.file_size || arrayBuf.byteLength),
  };
}
