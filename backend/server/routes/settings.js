/**
 * Rotas de Settings Google (Gerador de Orçamentos)
 * Convertido de CJS para ESM
 */
import { Router } from 'express';
import { createRequire } from 'module';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';

const require = createRequire(import.meta.url);
const { buildGoogleConfig } = require('../lib/google/config.cjs');

const SENSITIVE_GOOGLE_KEYS = new Set([
  'clientSecret',
  'googleClientSecret',
  'refreshToken',
  'accessToken',
]);

function normalizeConfig(payload = {}) {
  const cleaned = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'publicShare') {
      cleaned.publicShare = Boolean(value);
      return;
    }
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) cleaned[key] = trimmed;
    } else {
      cleaned[key] = value;
    }
  });
  return cleaned;
}

function stripSensitiveGoogleFields(config = {}) {
  if (!config || typeof config !== 'object') return {};
  const safe = {};
  Object.entries(config).forEach(([key, value]) => {
    if (SENSITIVE_GOOGLE_KEYS.has(key)) return;
    safe[key] = value;
  });
  return safe;
}

function buildPublicGoogleConfig(config = {}) {
  return stripSensitiveGoogleFields(buildGoogleConfig(config));
}

export function buildSettingsRouter(store) {
  const router = Router();

  router.get('/google', authenticateAdmin, async (_req, res) => {
    const stored = (await store.get('googleConfig')) || {};
    res.json({
      success: true,
      stored: stripSensitiveGoogleFields(stored),
      effective: buildPublicGoogleConfig(stored),
      defaults: buildPublicGoogleConfig({}),
    });
  });

  router.post('/google', authenticateAdmin, async (req, res) => {
    const payload = normalizeConfig(req.body || {});
    // Credenciais sensíveis são gerenciadas via variáveis de ambiente no servidor
    delete payload.clientId;
    delete payload.googleClientId;
    delete payload.clientSecret;
    delete payload.googleClientSecret;
    delete payload.redirectUri;
    delete payload.googleRedirectUri;
    delete payload.accessToken;
    delete payload.refreshToken;
    await store.set('googleConfig', payload);
    res.json({
      success: true,
      effective: buildPublicGoogleConfig(payload),
    });
  });
  return router;
}
