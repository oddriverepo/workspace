import dns from 'dns/promises';
import https from 'https';
import net from 'net';

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

function positiveInt(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function normalizeEvidencePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  return '';
}

export function mapEvidenceType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  const mapping = {
    odometro: 'odometer-photo',
    frontal: 'photo-front',
    frente: 'photo-front',
    traseira: 'photo-rear',
    lateral_esquerda: 'photo-left',
    esquerda: 'photo-left',
    lateral_direita: 'photo-right',
    direita: 'photo-right',
    comprovante: 'receipt',
    outro: 'other',
    desconhecido: 'other',
  };
  return mapping[normalized] || 'other';
}

export function detectImageType(buffer, headerMime = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const mime = String(headerMime || '').split(';')[0].trim().toLowerCase();

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  const brand = buffer.subarray(4, 12).toString('ascii').toLowerCase();
  if (brand.startsWith('ftyp') && /(heic|heix|hevc|hevx|mif1|msf1)/.test(brand)) {
    return { mimeType: 'image/heic', extension: 'heic' };
  }

  // Some providers omit a recognizable signature from a small initial chunk.
  if (['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(mime)) {
    return null;
  }
  return null;
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    if (net.isIP(mappedIpv4) === 4) return isPrivateIpv4(mappedIpv4);
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

export function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function validateRemoteUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw Object.assign(new Error('URL de imagem inválida.'), { status: 400 });
  }
  if (url.protocol !== 'https:') {
    throw Object.assign(new Error('A imagem precisa usar HTTPS.'), { status: 400 });
  }
  if (!url.hostname || url.username || url.password) {
    throw Object.assign(new Error('URL de imagem inválida.'), { status: 400 });
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw Object.assign(new Error('Destino de imagem não permitido.'), { status: 400 });
  }

  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw Object.assign(new Error('Destino de imagem não permitido.'), { status: 400 });
  }
  const selected = addresses[0];
  return {
    url,
    address: selected.address,
    family: Number(selected.family || net.isIP(selected.address)),
  };
}

function getResponseHeader(response, name) {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name);
  const value = response?.headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function requestPinnedHttps(validated, signal) {
  const { url, address, family } = validated;
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      signal,
      lookup: (_hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{ address, family }]);
          return;
        }
        callback(null, address, family);
      },
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,image/heic',
        Host: url.host,
        'User-Agent': 'ODDrive-Evidence/1.0',
      },
    }, resolve);
    request.on('error', reject);
    request.end();
  });
}

async function readResponseBuffer(response, maxBytes) {
  const declaredLength = Number(getResponseHeader(response, 'content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw Object.assign(new Error('Imagem acima do limite permitido.'), { status: 413 });
  }

  const chunks = [];
  let total = 0;
  const body = response.body || response;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw Object.assign(new Error('Imagem acima do limite permitido.'), { status: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

export async function downloadRemoteImage(rawUrl, options = {}) {
  const maxBytes = positiveInt(
    options.maxBytes ?? process.env.AGENT_EVIDENCE_MAX_IMAGE_BYTES,
    DEFAULT_MAX_BYTES,
    30 * 1024 * 1024,
  );
  const timeoutMs = positiveInt(
    options.timeoutMs ?? process.env.AGENT_EVIDENCE_DOWNLOAD_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    60_000,
  );

  let currentUrl = String(rawUrl || '');
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const validated = await validateRemoteUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await requestPinnedHttps(validated, controller.signal);
      const status = Number(response.status ?? response.statusCode ?? 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = getResponseHeader(response, 'location');
        response.resume?.();
        if (!location || redirect === MAX_REDIRECTS) {
          throw Object.assign(new Error('Redirecionamento de imagem inválido.'), { status: 502 });
        }
        currentUrl = new URL(location, validated.url).toString();
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume?.();
        throw Object.assign(new Error('O provedor não disponibilizou a imagem.'), { status: 502 });
      }

      const buffer = await readResponseBuffer(response, maxBytes);
      const type = detectImageType(buffer, getResponseHeader(response, 'content-type'));
      if (!type) {
        throw Object.assign(new Error('O arquivo recebido não é uma imagem suportada.'), { status: 415 });
      }
      return { buffer, ...type };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error('Tempo limite ao baixar a imagem.'), { status: 504 });
      }
      if (error?.status) throw error;
      throw Object.assign(new Error('Não foi possível baixar a imagem.'), { status: 502, cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(new Error('Não foi possível baixar a imagem.'), { status: 502 });
}

function responseItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  for (const key of ['messages', 'items', 'data', 'results']) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return [];
}

function extractMessageImageUrl(message) {
  const candidates = [
    message?.imageUrl,
    message?.image_url,
    message?.mediaUrl,
    message?.media_url,
    message?.fileUrl,
    message?.file_url,
    message?.media?.url,
    message?.file?.url,
    message?.content?.imageUrl,
    message?.content?.url,
  ];
  return candidates.find(value => typeof value === 'string' && value.startsWith('https://')) || '';
}

export async function resolveGptMakerImage({ chatId, messageId, fetchImpl = fetch }) {
  const token = String(process.env.GPTMAKER_API_TOKEN || '').trim();
  if (!token) throw Object.assign(new Error('API do GPT Maker não configurada.'), { status: 503 });
  if (!chatId) throw Object.assign(new Error('chat_id é obrigatório quando image_url não é enviado.'), { status: 400 });

  const baseUrl = String(process.env.GPTMAKER_API_BASE_URL || 'https://api.gptmaker.ai/v2')
    .replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutMs = positiveInt(process.env.GPTMAKER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  let response;
  try {
    response = await fetchImpl(
      `${baseUrl}/chat/${encodeURIComponent(chatId)}/messages`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) {
    throw Object.assign(new Error('Não foi possível consultar a mídia no GPT Maker.'), { status: 502 });
  }
  const payload = await response.json();
  const target = responseItems(payload).find(item =>
    String(item?.id ?? item?.messageId ?? item?.message_id ?? '') === String(messageId),
  );
  const imageUrl = extractMessageImageUrl(target);
  if (!target || !imageUrl) {
    throw Object.assign(new Error('Imagem não localizada na mensagem informada.'), { status: 404 });
  }
  return {
    imageUrl,
    fileName: target.fileName || target.file_name || target.file?.name || '',
    messageTime: target.time || target.createdAt || target.created_at || null,
  };
}
