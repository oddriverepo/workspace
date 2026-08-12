// ════════════════════════════════════════════════════════════════════════════
//  USER WIDGETS — Widgets customizáveis (gráficos) por usuário
//  Persistência em MongoDB · escopo por adminUser.id
//  Coleção: user_widgets
//  Endpoints:
//    GET    /api/user-widgets?context=overview|campaigns
//    POST   /api/user-widgets
//    PUT    /api/user-widgets/:id
//    DELETE /api/user-widgets/:id
//    PATCH  /api/user-widgets/order   (reordena uma lista)
// ════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../services/mongo.js';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';

const router = express.Router();

const VALID_CONTEXTS  = new Set(['overview', 'campaigns']);
const VALID_CHART_TYPES = new Set(['bar', 'line', 'pie', 'doughnut']);
const VALID_CAMPAIGN_SCOPES = new Set(['all', 'active']);
const VALID_DOCUMENT_FILTERS = new Set([
  'all',
  'active_campaign',
  'without_campaign',
  'missing',
  'incomplete',
  'pending',
  'complete',
  'approved',
]);
const VALID_PARAMS = new Set([
  // KPIs — Motoristas
  'kpi_total_drivers',
  'kpi_active_drivers',
  'kpi_critical_drivers',
  'kpi_drivers_with_km',
  'kpi_drivers_documents_complete',
  'kpi_drivers_documents_missing',
  'kpi_drivers_documents_pending',
  // KPIs — KM
  'kpi_total_km',
  'kpi_historical_total_km',
  'kpi_avg_km_progress',
  // KPIs — Campanhas
  'kpi_total_campaigns',
  'kpi_active_campaigns',
  // Campanhas
  'campaigns_by_status',
  'campaigns_by_client',
  'campaigns_by_city',
  // Motoristas — Status
  'drivers_by_status',
  'drivers_by_adhesion',
  'drivers_by_app',
  'drivers_by_photos',
  'drivers_by_documents',
  'drivers_by_documents_approval',
  // Motoristas — Localização
  'drivers_by_city',
  'drivers_by_campaign',
  'drivers_documents_list',
  // Motoristas — KM
  'km_total_by_campaign',
  'km_by_driver',
  'km_progress_pct_by_driver',
  // Motoristas — Risco
  'drivers_by_risk',
  'drivers_by_stale',
  'drivers_by_km_data',
  // legado (compatibilidade)
  'km_by_campaign',
]);

let _indexesEnsured = false;
async function getCollection() {
  const db = await getDb();
  const col = db.collection('user_widgets');
  if (!_indexesEnsured) {
    try {
      await col.createIndex({ userId: 1, context: 1, position: 1 });
      _indexesEnsured = true;
    } catch (_) {}
  }
  return col;
}

function sanitizeTitle(value) {
  return String(value || '').trim().slice(0, 80);
}

function validatePayload(body) {
  const title = sanitizeTitle(body?.title);
  const context = String(body?.context || '').trim();
  const paramA = String(body?.paramA || '').trim();
  const paramB = body?.paramB ? String(body.paramB).trim() : null;
  const chartType = String(body?.chartType || 'bar').trim();
  const campaignScope = String(body?.campaignScope || 'all').trim();
  const documentFilter = String(body?.documentFilter || 'all').trim();

  if (!title) return { error: 'Título obrigatório.' };
  if (!VALID_CONTEXTS.has(context)) return { error: 'Contexto inválido.' };
  if (!VALID_PARAMS.has(paramA)) return { error: 'Parâmetro principal inválido.' };
  if (paramB && !VALID_PARAMS.has(paramB)) return { error: 'Parâmetro de cruzamento inválido.' };
  if (!VALID_CHART_TYPES.has(chartType)) return { error: 'Tipo de gráfico inválido.' };
  if (!VALID_CAMPAIGN_SCOPES.has(campaignScope)) return { error: 'Filtro de campanhas inválido.' };

  if (!VALID_DOCUMENT_FILTERS.has(documentFilter)) return { error: 'Filtro de documentos invalido.' };

  return { value: { title, context, paramA, paramB, chartType, campaignScope, documentFilter } };
}

function serialize(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    userId: doc.userId,
    context: doc.context,
    title: doc.title,
    paramA: doc.paramA,
    paramB: doc.paramB || null,
    chartType: doc.chartType,
    campaignScope: VALID_CAMPAIGN_SCOPES.has(doc.campaignScope) ? doc.campaignScope : 'all',
    documentFilter: VALID_DOCUMENT_FILTERS.has(doc.documentFilter) ? doc.documentFilter : 'all',
    position: typeof doc.position === 'number' ? doc.position : 0,
    w: typeof doc.w === 'number' && doc.w >= 1 ? doc.w : 1,
    h: typeof doc.h === 'number' && doc.h >= 1 ? doc.h : 1,
    widthPx: typeof doc.widthPx === 'number' ? doc.widthPx : null,
    heightPx: typeof doc.heightPx === 'number' ? doc.heightPx : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ── GET ─────────────────────────────────────────────────────────────────────
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.adminUser.id;
    const context = String(req.query.context || '').trim();
    const query = { userId };
    if (context && VALID_CONTEXTS.has(context)) query.context = context;

    const col = await getCollection();
    const docs = await col.find(query).sort({ position: 1, createdAt: 1 }).toArray();
    res.json({ items: docs.map(serialize) });
  } catch (err) {
    console.error('[user-widgets] GET erro:', err);
    res.status(500).json({ error: 'Falha ao listar widgets.' });
  }
});

// ── POST ────────────────────────────────────────────────────────────────────
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.adminUser.id;
    const v = validatePayload(req.body);
    if (v.error) return res.status(400).json({ error: v.error });

    const col = await getCollection();
    const lastPos = await col.find({ userId, context: v.value.context })
      .sort({ position: -1 }).limit(1).toArray();
    const nextPosition = lastPos.length ? (Number(lastPos[0].position) || 0) + 1 : 0;

    const now = new Date();
    const doc = {
      _id: randomUUID(),
      userId,
      ...v.value,
      position: nextPosition,
      createdAt: now,
      updatedAt: now,
    };
    await col.insertOne(doc);
    res.status(201).json({ item: serialize(doc) });
  } catch (err) {
    console.error('[user-widgets] POST erro:', err);
    res.status(500).json({ error: 'Falha ao criar widget.' });
  }
});

// ── PUT ─────────────────────────────────────────────────────────────────────
router.put('/:id', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.adminUser.id;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const v = validatePayload(req.body);
    if (v.error) return res.status(400).json({ error: v.error });

    const col = await getCollection();
    const result = await col.findOneAndUpdate(
      { _id: id, userId },
      { $set: { ...v.value, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const doc = result?.value || result;
    if (!doc || !doc._id) return res.status(404).json({ error: 'Widget não encontrado.' });
    res.json({ item: serialize(doc) });
  } catch (err) {
    console.error('[user-widgets] PUT erro:', err);
    res.status(500).json({ error: 'Falha ao atualizar widget.' });
  }
});

// ── DELETE ──────────────────────────────────────────────────────────────────
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.adminUser.id;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const col = await getCollection();
    const r = await col.deleteOne({ _id: id, userId });
    if (!r.deletedCount) return res.status(404).json({ error: 'Widget não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[user-widgets] DELETE erro:', err);
    res.status(500).json({ error: 'Falha ao remover widget.' });
  }
});

// ── PATCH /:id/size ─────────────────────────────────────────────────────────
router.patch('/:id/size', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.adminUser.id;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const widthPx = parseFloat(req.body?.widthPx);
    const heightPx = parseFloat(req.body?.heightPx);
    if (isNaN(widthPx) || isNaN(heightPx) || widthPx < 50 || widthPx > 3000 || heightPx < 80 || heightPx > 3000) {
      return res.status(400).json({ error: 'Tamanho inválido.' });
    }

    const col = await getCollection();
    const result = await col.findOneAndUpdate(
      { _id: id, userId },
      { $set: { widthPx, heightPx, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const doc = result?.value || result;
    if (!doc || !doc._id) return res.status(404).json({ error: 'Widget não encontrado.' });
    res.json({ item: serialize(doc) });
  } catch (err) {
    console.error('[user-widgets] PATCH size erro:', err);
    res.status(500).json({ error: 'Falha ao redimensionar widget.' });
  }
});

// ── PATCH /order ────────────────────────────────────────────────────────────
router.patch('/order', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.adminUser.id;
    const context = String(req.body?.context || '').trim();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!VALID_CONTEXTS.has(context)) return res.status(400).json({ error: 'Contexto inválido.' });

    const col = await getCollection();
    const ops = ids.map((id, idx) => ({
      updateOne: {
        filter: { _id: String(id), userId, context },
        update: { $set: { position: idx, updatedAt: new Date() } },
      },
    }));
    if (ops.length) await col.bulkWrite(ops);
    res.json({ ok: true, count: ops.length });
  } catch (err) {
    console.error('[user-widgets] PATCH order erro:', err);
    res.status(500).json({ error: 'Falha ao reordenar widgets.' });
  }
});

export default router;
