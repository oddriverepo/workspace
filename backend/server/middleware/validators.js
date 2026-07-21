/**
 * Middleware de validação de entrada para prevenir injeções e dados maliciosos
 */

const SPREADSHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{20,}$/;
const CAMPAIGN_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\d{10,15}$/;
const CPF_PATTERN = /^\d{11}$/;
const PLATE_PATTERN = /^[A-Z]{3}\d{1}[A-Z0-9]{1}\d{2}$/i;
const MONGO_OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_IMAGE_BYTES = (() => {
  const raw = process.env.MAX_IMAGE_BYTES || '';
  const num = parseInt(raw, 10);
  if (Number.isFinite(num) && num > 0) return num;
  const mb = parseInt(process.env.MAX_IMAGE_MB || '', 10);
  if (Number.isFinite(mb) && mb > 0) return mb * 1024 * 1024;
  return 6 * 1024 * 1024;
})();
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function parseImageDataUrl(payload) {
  const match = String(payload || '').match(/^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), base64: match[2] };
}

function estimateBase64Size(base64) {
  if (!base64) return 0;
  const len = base64.length;
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.floor((len * 3) / 4) - padding;
}

function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return 'image/png';
  // WEBP (RIFF....WEBP)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) return 'image/webp';
  return null;
}

/**
 * Valida ID de planilha do Google Sheets
 */
export function validateSpreadsheetId(req, res, next) {
  const { spreadsheetId } = req.body || req.query || {};
  
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'spreadsheetId é obrigatório' });
  }
  
  if (!SPREADSHEET_ID_PATTERN.test(spreadsheetId)) {
    return res.status(400).json({ error: 'spreadsheetId inválido' });
  }
  
  next();
}

/**
 * Valida código de campanha
 */
export function validateCampaignCode(req, res, next) {
  const { campaignCode } = req.body || req.query || {};
  
  if (!campaignCode) {
    return res.status(400).json({ error: 'campaignCode é obrigatório' });
  }
  
  if (!CAMPAIGN_CODE_PATTERN.test(campaignCode)) {
    return res.status(400).json({ error: 'Código de campanha inválido' });
  }
  
  next();
}

/**
 * Valida campos de login de motorista
 */
export function validateDriverLogin(req, res, next) {
  const { name, phone, cpf, plate, email } = req.body || {};
  
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 150) {
    return res.status(400).json({ error: 'Nome inválido (entre 2 e 150 caracteres)' });
  }
  
  if (!phone || !/^\d{10,15}$/.test(String(phone).replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Telefone inválido (10-15 dígitos)' });
  }
  
  if (cpf && !/^\d{11}$/.test(String(cpf).replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'CPF inválido (11 dígitos)' });
  }
  
  if (email && !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  
  if (plate && !PLATE_PATTERN.test(plate)) {
    return res.status(400).json({ error: 'Placa inválida (formato ABC1D23)' });
  }
  
  // Sanitiza strings para prevenir XSS
  req.body.name = sanitizeString(name);
  if (email) req.body.email = sanitizeString(email);
  
  next();
}

/**
 * Valida campos de login de gráfica
 */
export function validateGraphicLogin(req, res, next) {
  // Accept either `identifier` or `name` field from clients (legacy/varied frontends)
  const { identifier, name, campaignCode } = req.body || {};
  const rawIdentifier = typeof identifier === 'string' && identifier.trim() ? identifier : (typeof name === 'string' ? name : '');

  if (!rawIdentifier || rawIdentifier.trim().length < 3 || rawIdentifier.trim().length > 150) {
    return res.status(400).json({ error: 'Identificador inválido (entre 3 e 150 caracteres)' });
  }

  if (!campaignCode || !CAMPAIGN_CODE_PATTERN.test(campaignCode)) {
    return res.status(400).json({ error: 'Código de campanha inválido' });
  }

  // Normalize into both `name` and `identifier` so downstream handlers find either
  const clean = sanitizeString(rawIdentifier);
  req.body.identifier = clean;
  req.body.name = clean;
  req.body.campaignCode = sanitizeString(campaignCode);

  next();
}

/**
 * Valida ID de objeto MongoDB
 */
export function validateMongoId(paramName = 'id') {
  return (req, res, next) => {
    const id = req.params[paramName] || req.query[paramName] || req.body[paramName];
    
    if (!id) {
      return res.status(400).json({ error: `${paramName} é obrigatório` });
    }
    
    if (!MONGO_OBJECT_ID_PATTERN.test(id)) {
      return res.status(400).json({ error: `${paramName} inválido` });
    }
    
    next();
  };
}

/**
 * Valida credenciais de login do admin.
 *
 * IMPORTANTE: politica de senha forte (tamanho minimo, classes de caracteres)
 * deve ser aplicada apenas no MOMENTO DE CRIACAO/ALTERACAO da senha (ver
 * scripts/ensure_admin.js). No login nao validamos politica porque:
 *   1) Bloquearia usuarios legitimos com senhas antigas mais curtas;
 *   2) Vazaria a politica para atacantes;
 *   3) A senha real e conferida via bcrypt contra o hash no banco.
 * Aqui validamos somente o formato basico (campos presentes, username sem
 * caracteres perigosos para prevenir injection em logs/queries).
 */
export function validateAdminCredentials(req, res, next) {
  const { username, password } = req.body || {};

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username inválido (mínimo 3 caracteres)' });
  }

  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ error: 'Informe a senha.' });
  }

  // Previne username injection
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username contém caracteres inválidos' });
  }

  req.body.username = username.trim().toLowerCase();

  next();
}

/**
 * Valida imagem base64
 */
export function validateBase64Image(req, res, next) {
  const { imageBase64, photoData } = req.body || {};
  const payload = typeof photoData === 'string' && photoData ? photoData : imageBase64;

  // Quando nenhuma imagem foi enviada (ex.: motorista informou apenas o odômetro),
  // não bloqueamos o fluxo.
  if (!payload) return next();

  const parsed = parseImageDataUrl(payload);
  if (!parsed) {
    return res.status(400).json({ error: 'Formato de imagem inválido' });
  }

  if (!ALLOWED_IMAGE_TYPES.has(parsed.mimeType)) {
    return res.status(400).json({ error: 'Tipo de imagem não permitido' });
  }

  const estimatedSize = estimateBase64Size(parsed.base64);
  if (estimatedSize > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: `Imagem muito grande (máximo ${Math.ceil(MAX_IMAGE_BYTES / (1024 * 1024))}MB)` });
  }

  let buffer = null;
  try {
    buffer = Buffer.from(parsed.base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Imagem inválida' });
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: `Imagem muito grande (máximo ${Math.ceil(MAX_IMAGE_BYTES / (1024 * 1024))}MB)` });
  }

  const detected = detectImageType(buffer);
  if (!detected) {
    return res.status(400).json({ error: 'Imagem inválida' });
  }

  if (detected !== parsed.mimeType) {
    return res.status(400).json({ error: 'Tipo de imagem inválido' });
  }

  next();
}

/**
 * Sanitiza string removendo caracteres perigosos
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  
  return str
    .trim()
    .replace(/[<>]/g, '') // Remove < > para prevenir XSS básico
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove caracteres de controle
    .slice(0, 500); // Limita tamanho
}

/**
 * Middleware genérico para validar presença de campos obrigatórios
 */
export function requireFields(...fields) {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query, ...req.params };
    const missing = fields.filter(field => !data[field]);
    
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Campos obrigatórios ausentes: ${missing.join(', ')}`
      });
    }
    
    next();
  };
}

/**
 * Middleware para sanitizar todos os campos de string do body
 */
export function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    }
  }
  next();
}
