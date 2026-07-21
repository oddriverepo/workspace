import express from 'express';
import { getDb } from '../services/mongo.js';
import { loadLegacyDb } from '../services/legacyStore.js';
import { fetchDrivers, fetchCampaigns } from '../services/db.js';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';

const router = express.Router();
const FLOW_STUDIO_SOURCE = 'od-flow-studio';

/**
 * GET /api/notifications
 * Retorna envios de fotos pendentes de verificação (motorista e gráfica)
 * nos últimos N dias (default 30, max 90).
 *
 * Resposta:
 * {
 *   notifications: [
 *     { type, driverId, driverName, campaignId, campaignName,
 *       lastUploadAt, uploadCount, verified, verifiedAt, verifiedByName }
 *   ],
 *   updatedAt: timestamp
 * }
 */
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // ── 1. Buscar uploads recentes no MongoDB ──────────────────
    let rawEntries = [];
    try {
      const database = await getDb();
      rawEntries = await database
        .collection('storage_files')
        .find({ createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .project({ _id: 1, source: 1, campaignId: 1, driverId: 1, graphicId: 1, uploaderType: 1, templateId: 1, templateName: 1, flowId: 1, step: 1, createdAt: 1 })
        .toArray();

      // Cross-check: filtrar apenas arquivos cujo binário ainda existe no GridFS
      // Evita mostrar notificações de arquivos "órfãos" (metadata sem binário)
      if (rawEntries.length > 0) {
        const allIds = rawEntries.map(e => e._id).filter(Boolean);
        const existingFiles = await database
          .collection('media.files')
          .find({ _id: { $in: allIds } })
          .project({ _id: 1 })
          .toArray();
        const existingIdSet = new Set(existingFiles.map(f => String(f._id)));
        rawEntries = rawEntries.filter(e => existingIdSet.has(String(e._id)));
      }
    } catch (mongoErr) {
      console.warn('[notifications] MongoDB indisponível:', mongoErr.message);
    }

    if (!rawEntries.length) {
      return res.json({ notifications: [], updatedAt: Date.now() });
    }

    // ── 2. Agrupar por (campaignId, driverId, uploaderType) ────
    const groups = new Map();
    for (const entry of rawEntries) {
      const source = String(entry.source || '').trim();
      const uploaderType = entry.uploaderType || (source === FLOW_STUDIO_SOURCE ? FLOW_STUDIO_SOURCE : 'driver');
      const isFlowUpload = source === FLOW_STUDIO_SOURCE || uploaderType === FLOW_STUDIO_SOURCE;
      const key = isFlowUpload
        ? `${FLOW_STUDIO_SOURCE}::${String(entry.templateId || '')}::${String(entry.flowId || '')}`
        : `${entry.campaignId}::${entry.driverId}::${uploaderType}`;
      if (!groups.has(key)) {
        groups.set(key, {
          source: source || null,
          campaignId: entry.campaignId || null,
          driverId: entry.driverId || null,
          graphicId: entry.graphicId || null,
          uploaderType,
          templateId: entry.templateId || null,
          templateName: entry.templateName || null,
          flowId: entry.flowId || null,
          isFlowUpload,
          uploadCount: 0,
          lastUploadAt: null,
        });
      }
      const g = groups.get(key);
      if (!g.templateId && entry.templateId) g.templateId = entry.templateId;
      if (!g.templateName && entry.templateName) g.templateName = entry.templateName;
      if (!g.flowId && entry.flowId) g.flowId = entry.flowId;
      g.uploadCount++;
      const ts = entry.createdAt instanceof Date ? entry.createdAt.getTime() : null;
      if (ts && (!g.lastUploadAt || ts > g.lastUploadAt)) g.lastUploadAt = ts;
    }

    // ── 3. Verificação: carregar evidenceReview do DB local ─────
    const db = loadLegacyDb();
    const localDriverById = new Map();
    for (const d of db.drivers || []) {
      if (d.id) localDriverById.set(String(d.id), d);
    }

    // ── 4. Nomes de motoristas e campanhas (cache da API) ───────
    let apiDrivers = [];
    let apiCampaigns = [];
    try {
      [apiDrivers, apiCampaigns] = await Promise.all([
        fetchDrivers(),
        fetchCampaigns(),
      ]);
    } catch (e) {
      console.warn('[notifications] Cache da API indisponível:', e.message);
    }

    const driverNameById = new Map();
    for (const d of apiDrivers) {
      if (d.id) driverNameById.set(String(d.id), d.name || '');
    }

    const campaignNameById = new Map();
    for (const c of apiCampaigns) {
      if (c.id) campaignNameById.set(String(c.id), c.name || '');
    }
    // Fallback: campanhas locais
    for (const c of db.campaigns || []) {
      if (c.id && !campaignNameById.has(String(c.id))) {
        campaignNameById.set(String(c.id), c.name || '');
      }
    }

    // ── 5. Montar lista de notificações ─────────────────────────
    const notifications = [];
    for (const g of groups.values()) {
      if (g.isFlowUpload) {
        const templateId = String(g.templateId || '').trim();
        const templateName = String(g.templateName || '').trim();
        const flowId = String(g.flowId || '').trim();

        notifications.push({
          type: FLOW_STUDIO_SOURCE,
          source: g.source || FLOW_STUDIO_SOURCE,
          driverId: null,
          driverName: templateName || (templateId ? `Template ${templateId.slice(0, 8)}` : 'OD Flow Studio'),
          campaignId: null,
          campaignName: flowId ? `Fluxo ${flowId.slice(0, 8)}` : 'Midia das etapas',
          templateId: templateId || null,
          templateName: templateName || null,
          flowId: flowId || null,
          lastUploadAt: g.lastUploadAt,
          uploadCount: g.uploadCount,
          verified: true,
          verifiedAt: null,
          verifiedByName: null,
          requiresVerification: false,
          actionKind: 'open-od-flow',
          actionId: templateId,
          actionLabel: templateId ? 'Abrir fluxo' : 'Abrir Studio',
        });
        continue;
      }

      const localDriver = localDriverById.get(String(g.driverId));
      const review = localDriver?.evidenceReview || {};
      const flowKey = g.uploaderType === 'graphic' ? 'graphicFlow' : 'driverFlow';
      const flow = review[flowKey] || {};
      const verifiedAt = flow.verifiedAt || null;
      const verifiedByName = flow.verifiedByName || null;

      // Incluir verificadas recentes (< 7 dias) para dar contexto de "feito"
      const isRecentlyVerified = verifiedAt && verifiedAt > Date.now() - 7 * 24 * 60 * 60 * 1000;
      const isPending = !verifiedAt;
      if (!isPending && !isRecentlyVerified) continue;

      const driverName =
        driverNameById.get(String(g.driverId)) ||
        localDriver?.name ||
        `Motorista ${String(g.driverId || '').slice(0, 6) || '?'}`;
      const campaignName =
        campaignNameById.get(String(g.campaignId)) ||
        `Campanha ${String(g.campaignId || '').slice(0, 8) || '?'}`;

      notifications.push({
        type: g.uploaderType,
        source: g.source || null,
        driverId: g.driverId,
        driverName,
        campaignId: g.campaignId,
        campaignName,
        templateId: null,
        templateName: null,
        flowId: null,
        lastUploadAt: g.lastUploadAt,
        uploadCount: g.uploadCount,
        verified: !!verifiedAt,
        verifiedAt,
        verifiedByName,
        requiresVerification: true,
        actionKind: 'open-campaign',
        actionId: String(g.campaignId || ''),
        actionLabel: 'Ver agora',
      });
    }

    // Pendentes primeiro, depois por data mais recente
    notifications.sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? 1 : -1;
      return (b.lastUploadAt || 0) - (a.lastUploadAt || 0);
    });

    res.json({ notifications, updatedAt: Date.now() });
  } catch (err) {
    console.error('[notifications] Erro:', err);
    res.status(500).json({ error: 'Erro ao carregar notificações', notifications: [] });
  }
});

export default router;
