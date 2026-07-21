import { Router } from 'express';
import multer from 'multer';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import {
  createMetaTemplate,
  deleteMetaTemplate,
  listMetaTemplates,
  uploadTemplateMedia,
  getMetaRateLimitState,
} from '../disparador/services/meta-client.js';

const router = Router();
router.use(authenticateAdmin);

// Cache em memoria da listagem de templates: a Meta da 5000 req/h por WABA;
// evitamos GETs repetidos quando o admin abre/fecha o painel varias vezes.
const LIST_CACHE_TTL_MS = 30_000;
const _listCache = { data: null, at: 0 };
function _invalidateListCache() { _listCache.data = null; _listCache.at = 0; }

// MIME types aceitos pela Meta para HEADER de templates
const ACCEPTED_MIME = new Set([
  'image/jpeg', 'image/png',
  'video/mp4', 'video/3gpp',
  'application/pdf',
]);

// 30MB para video; imagem/documento bem menores
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

function safeError(res, err) {
  const status = err?.statusCode || 500;
  const message = err?.message || 'Erro inesperado.';
  const meta = err?.meta;
  return res.status(status).json({ ok: false, error: message, code: err?.code, meta });
}

/**
 * GET /api/meta/templates
 * Lista templates da WABA (status, categoria, idioma, components).
 */
router.get('/', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.refresh === '1';
    const now = Date.now();
    if (!force && _listCache.data && (now - _listCache.at) < LIST_CACHE_TTL_MS) {
      return res.json({ ok: true, cached: true, ageMs: now - _listCache.at, ..._listCache.data });
    }
    const data = await listMetaTemplates({
      limit: 200,
      fields: 'name,status,language,category,id,components,quality_score,rejected_reason',
    });
    const payload = { data: data?.data || [], paging: data?.paging || null };
    _listCache.data = payload;
    _listCache.at = now;
    res.json({ ok: true, cached: false, ...payload });
  } catch (err) {
    safeError(res, err);
  }
});

/**
 * GET /api/meta/templates/rate-limit
 * Telemetria do uso da Meta Graph API (header X-Business-Use-Case-Usage).
 */
router.get('/rate-limit', (_req, res) => {
  res.json({ ok: true, data: getMetaRateLimitState() });
});

/**
 * POST /api/meta/templates
 * Cria template e envia para aprovacao da Meta.
 */
router.post('/', async (req, res) => {
  try {
    const result = await createMetaTemplate(req.body || {});
    _invalidateListCache();
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    safeError(res, err);
  }
});

/**
 * DELETE /api/meta/templates/:name
 * Remove template (opcionalmente com hsm_id no query).
 * Fallback: se a Meta exigir hsm_id (caso multi-idioma), busca o id pelo nome
 * e tenta de novo automaticamente.
 */
router.delete('/:name', async (req, res) => {
  try {
    const name = req.params.name;
    let hsmId = req.query.hsm_id || req.query.hsmId;
    try {
      const result = await deleteMetaTemplate({ name, hsmId });
      _invalidateListCache();
      return res.json({ ok: true, data: result });
    } catch (err) {
      // Se a Meta retornou erro indicando que precisa de hsm_id (multi-idioma),
      // buscamos o id pelo nome e tentamos novamente.
      const needsHsmId = !hsmId && err?.statusCode === 400;
      if (!needsHsmId) throw err;
      const list = await listMetaTemplates({ limit: 200, fields: 'name,id,language' });
      const match = (list?.data || []).find((t) => String(t.name) === String(name));
      if (!match?.id) throw err;
      const result = await deleteMetaTemplate({ name, hsmId: match.id });
      _invalidateListCache();
      return res.json({ ok: true, data: result, retriedWithHsmId: match.id });
    }
  } catch (err) {
    safeError(res, err);
  }
});

/**
 * POST /api/meta/templates/upload-media  (multipart/form-data, campo "file")
 * Faz upload de imagem/video/documento usando Resumable Upload API.
 * Retorna { handle } para usar em createMetaTemplate({ headerMediaHandle }).
 */
router.post('/upload-media', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Arquivo obrigatorio (campo "file").' });
    }
    if (!ACCEPTED_MIME.has(req.file.mimetype)) {
      return res.status(400).json({
        ok: false,
        error: `Tipo de arquivo nao suportado: ${req.file.mimetype}. Aceitos: JPG, PNG, MP4, 3GPP, PDF.`,
      });
    }
    const result = await uploadTemplateMedia({
      fileBuffer: req.file.buffer,
      fileLength: req.file.size,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    safeError(res, err);
  }
});

export default router;
