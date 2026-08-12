/**
 * overview-actions.js — Endpoints da home (cartão Campanhas reformulado)
 *
 * Fornece 3 listas operacionais e 1 endpoint de disparo em lote:
 *   GET  /api/overview/drivers-low-km           → motoristas com km abaixo do mínimo
 *   GET  /api/overview/drivers-without-booking  → motoristas em campanha sem reserva de adesivagem
 *   GET  /api/overview/drivers-accepted-invite  → contatos do disparador que aceitaram convite (optIn) e não estão em campanha ativa
 *   POST /api/overview/bulk-message             → dispara template para uma lista de motoristas
 *
 * Todas as rotas exigem authenticateAdmin.
 */

import { Router, json as jsonParser } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { fetchCampaigns, fetchDrivers, fetchDriverById } from '../services/db.js';
import { getDb, getCampaignSettingsByIds } from '../services/mongo.js';
import { dispatchDriverCampaignMessage } from '../services/driver-outreach.js';
import { listContacts, getTemplateById } from '../disparador/store/memory-store.js';
import { createDispatchRun, completeDispatchRun } from '../disparador/services/mongo/dispatch-runs.repo.js';
import { upsertRecipient as upsertCampaignRecipient } from '../disparador/services/mongo/campaign-recipients.repo.js';
import { getCampaignKmGoal } from '../lib/campaignKmGoal.js';

const router = Router();
const COL_BOOKINGS = 'scheduling_bookings';

const HARD_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(HARD_LIMIT, Math.floor(n));
}

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function toMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function daysBetween(fromMs, toMs = Date.now()) {
  if (!fromMs) return null;
  return Math.max(0, Math.floor((toMs - fromMs) / 86400000));
}

function buildDriverSummary(driver, campaign) {
  return {
    driverId: driver.id,
    name: driver.name || '',
    avatar: driver.avatar || '',
    phone: driver.phone || '',
    phoneDigits: driver.phoneDigits || '',
    city: driver.city || driver.address?.city || '',
    state: driver.address?.state || '',
    campaignId: driver.campaignId || null,
    campaignName: campaign?.name || '',
    campaignClient: campaign?.client || '',
    status: driver.status || 'cadastrando',
  };
}

/**
 * GET /api/overview/drivers-low-km
 * Query: campaignId? (filtro), limit? (max 200)
 *
 * Critério: motoristas com status === 'instalado' (in_campaign) cujo
 * kmTravelledValue < meta operacional da respectiva campanha ativa.
 * Regra: 3.000 KM por motorista por mês-calendário, proporcional nos meses parciais.
 */
router.get('/drivers-low-km', authenticateAdmin, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const filterCampaignId = trimStr(req.query.campaignId);

    const [campaigns, drivers] = await Promise.all([fetchCampaigns(), fetchDrivers()]);

    const activeById = new Map();
    for (const c of campaigns) {
      if ((c.status || '').toLowerCase() !== 'ativa') continue;
      activeById.set(c.id, c);
    }

    const items = [];
    for (const d of drivers) {
      if (d.status !== 'instalado') continue;
      if (!d.campaignId || !activeById.has(d.campaignId)) continue;
      if (filterCampaignId && d.campaignId !== filterCampaignId) continue;

      const camp = activeById.get(d.campaignId);
      const kmMin = getCampaignKmGoal(camp, 1).perDriver;
      const km = Number(d.kmTravelledValue || d.campaignData?.totalKms || 0);

      if (km >= kmMin) continue; // está acima do limite → não entra

      items.push({
        ...buildDriverSummary(d, camp),
        km,
        kmMinimum: kmMin,
        kmDeficit: Math.max(0, kmMin - km),
        kmPct: kmMin > 0 ? Math.round((km / kmMin) * 100) : 0,
      });
    }

    // ordena pelos piores primeiro (menor % da meta)
    items.sort((a, b) => a.kmPct - b.kmPct);

    // dropdown de filtro: campanhas ativas com pelo menos 1 motorista instalado
    const campaignOptions = [...activeById.values()]
      .map(c => ({ id: c.id, name: c.name || '(sem nome)' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    res.json({
      total: items.length,
      items: items.slice(0, limit),
      campaignOptions,
    });
  } catch (err) {
    console.error('[overview/drivers-low-km]', err);
    res.status(500).json({ error: 'Falha ao listar motoristas com km baixa.' });
  }
});

/**
 * GET /api/overview/drivers-without-booking
 * Query: campaignId?, limit?
 *
 * Critério: motoristas em campanha ativa com status em ['confirmado', 'agendado']
 * (aprovado ou pendente) e SEM booking confirmado em scheduling_bookings.
 */
router.get('/drivers-without-booking', authenticateAdmin, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const filterCampaignId = trimStr(req.query.campaignId);

    const [campaigns, drivers] = await Promise.all([fetchCampaigns(), fetchDrivers()]);

    const activeById = new Map();
    for (const c of campaigns) {
      if ((c.status || '').toLowerCase() !== 'ativa') continue;
      activeById.set(c.id, c);
    }

    // motoristas candidatos antes de checar booking
    const candidates = [];
    for (const d of drivers) {
      if (!d.campaignId || !activeById.has(d.campaignId)) continue;
      if (filterCampaignId && d.campaignId !== filterCampaignId) continue;
      // status que indicam "ainda não instalado"
      const s = d.status;
      if (s !== 'confirmado' && s !== 'agendado' && s !== 'cadastrando') continue;
      candidates.push(d);
    }

    // busca bookings confirmados/pendentes no Mongo de uma vez só
    let bookedDriverIds = new Set();
    try {
      const db = await getDb();
      const driverIds = candidates.map(d => d.id).filter(Boolean);
      if (driverIds.length) {
        const docs = await db.collection(COL_BOOKINGS)
          .find(
            { driverId: { $in: driverIds }, status: { $in: ['confirmed', 'pending'] } },
            { projection: { driverId: 1 } }
          )
          .toArray();
        bookedDriverIds = new Set(docs.map(b => String(b.driverId)));
      }
    } catch (mongoErr) {
      console.warn('[overview/drivers-without-booking] mongo bookings indisponivel:', mongoErr?.message);
    }

    const items = [];
    for (const d of candidates) {
      if (bookedDriverIds.has(String(d.id))) continue;
      const camp = activeById.get(d.campaignId);
      const days = daysBetween(toMillis(d.createdAt));
      items.push({
        ...buildDriverSummary(d, camp),
        daysInCampaign: days,
        createdAt: d.createdAt || null,
      });
    }

    // mais antigos primeiro (mais críticos)
    items.sort((a, b) => (b.daysInCampaign || 0) - (a.daysInCampaign || 0));

    const campaignOptions = [...activeById.values()]
      .map(c => ({ id: c.id, name: c.name || '(sem nome)' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    res.json({
      total: items.length,
      items: items.slice(0, limit),
      campaignOptions,
    });
  } catch (err) {
    console.error('[overview/drivers-without-booking]', err);
    res.status(500).json({ error: 'Falha ao listar motoristas sem reserva.' });
  }
});

/**
 * GET /api/overview/drivers-accepted-invite
 * Query: limit?
 *
 * Critério: contatos do disparador com optIn === true cujo telefone NÃO
 * corresponde a nenhum motorista atualmente em campanha ativa.
 */
router.get('/drivers-accepted-invite', authenticateAdmin, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);

    const [campaigns, drivers, contacts] = await Promise.all([
      fetchCampaigns(),
      fetchDrivers(),
      listContacts().catch(() => []),
    ]);

    const activeIds = new Set(
      campaigns
        .filter(c => (c.status || '').toLowerCase() === 'ativa')
        .map(c => c.id)
    );

    // telefones de motoristas atualmente em campanha ativa (exclusão)
    const inActivePhones = new Set();
    for (const d of drivers) {
      if (!d.campaignId || !activeIds.has(d.campaignId)) continue;
      const last9 = (d.phoneDigits || '').slice(-9);
      if (last9) inActivePhones.add(last9);
    }

    const items = [];
    for (const c of contacts) {
      if (c.optIn !== true) continue;
      if (c.optOutAt) continue;
      const digits = String(c.phoneE164 || '').replace(/\D/g, '');
      const last9 = digits.slice(-9);
      if (!last9) continue;
      if (inActivePhones.has(last9)) continue;

      // tenta enriquecer com dados de driver (mesmo telefone, mas sem campanha ativa)
      const driver = drivers.find(d => (d.phoneDigits || '').slice(-9) === last9) || null;
      items.push({
        contactId: c.id || '',
        driverId: driver?.id || '',
        name: c.name || driver?.name || 'Sem nome',
        phone: c.phoneE164 || driver?.phone || '',
        phoneDigits: digits,
        avatar: c.avatar || driver?.avatar || '',
        city: driver?.city || '',
        state: driver?.address?.state || '',
        optInAt: c.optInAt || null,
        optInDays: daysBetween(toMillis(c.optInAt)),
      });
    }

    // mais recentes primeiro
    items.sort((a, b) => toMillis(b.optInAt) - toMillis(a.optInAt));

    res.json({
      total: items.length,
      items: items.slice(0, limit),
    });
  } catch (err) {
    console.error('[overview/drivers-accepted-invite]', err);
    res.status(500).json({ error: 'Falha ao listar motoristas que aceitaram convite.' });
  }
});

/**
 * POST /api/overview/bulk-message
 * Body: { driverIds: string[], templateId: string, simulate?: boolean, campaignId?: string }
 *
 * Dispara o mesmo template para todos os motoristas listados (sequencial,
 * para evitar rate-limit da Meta). Retorna sumário por driver.
 */
router.post('/bulk-message', authenticateAdmin, jsonParser({ limit: '64kb' }), async (req, res) => {
  try {
    const driverIds = Array.isArray(req.body?.driverIds) ? req.body.driverIds : [];
    const templateId = trimStr(req.body?.templateId);
    const simulate = req.body?.simulate === true;
    const campaignIdHint = trimStr(req.body?.campaignId);

    if (!driverIds.length) {
      return res.status(400).json({ error: 'driverIds obrigatorio (array nao vazio).' });
    }
    if (driverIds.length > 100) {
      return res.status(400).json({ error: 'Máximo 100 motoristas por disparo em lote.' });
    }
    if (!templateId) {
      return res.status(400).json({ error: 'templateId obrigatorio.' });
    }

    const _tpl = templateId ? await getTemplateById(templateId).catch(() => null) : null;
    const _dispatchRun = await createDispatchRun({
      source: 'overview_bulk',
      sourceName: 'Disparo em Lote (Overview)',
      campaignId: campaignIdHint || '',
      campaignName: '',
      templateId: templateId || '',
      templateName: _tpl?.name || '',
      operatorId: req.adminUser?.id || '',
      operatorName: req.adminUser?.name || req.adminUser?.username || '',
    }).catch(() => null);

    const results = [];
    let okCount = 0;
    let failCount = 0;

    for (const rawId of driverIds) {
      const driverId = String(rawId || '').trim();
      if (!driverId) {
        results.push({ driverId: '', ok: false, error: { code: 'INVALID_ID' } });
        failCount++;
        continue;
      }

      try {
        const r = await dispatchDriverCampaignMessage({
          driverId,
          campaignId: campaignIdHint || undefined,
          type: 'template',
          templateId,
          simulate,
          dispatchScope: 'overview_bulk',
          dispatchRunId: _dispatchRun?.id || '',
        });
        if (r?.ok) {
          okCount++;
          results.push({ driverId, ok: true, dispatchMode: r.dispatchMode || (simulate ? 'simulado' : '') });
        } else {
          failCount++;
          results.push({ driverId, ok: false, error: r?.error || { code: 'UNKNOWN' } });
        }
        if (_dispatchRun) {
          const msg = r?.item;
          await upsertCampaignRecipient({
            campaignId: _dispatchRun.id,
            contactId: msg?.contactId || driverId,
            contactName: msg?.displayName || driverId,
            phoneE164: msg?.phoneE164 || '',
            metaMessageId: msg?.metaMessageId || '',
            deliveryStatus: msg?.deliveryStatus || (r?.ok ? 'sent' : 'failed'),
            outboundMessageId: msg?.id || '',
            templateId: templateId || '',
            templateName: _tpl?.name || '',
            deliveryError: r?.ok ? null : (r?.error?.message || null),
          }).catch(() => null);
        }
      } catch (err) {
        failCount++;
        results.push({ driverId, ok: false, error: { code: 'EXCEPTION', message: err?.message || 'Falha inesperada.' } });
        if (_dispatchRun) {
          await upsertCampaignRecipient({
            campaignId: _dispatchRun.id,
            contactId: driverId,
            contactName: driverId,
            phoneE164: '',
            metaMessageId: '',
            deliveryStatus: 'failed',
            outboundMessageId: '',
            templateId: templateId || '',
            templateName: _tpl?.name || '',
            deliveryError: err?.message || null,
          }).catch(() => null);
        }
      }
    }

    if (_dispatchRun) {
      await completeDispatchRun(_dispatchRun.id, {
        totals: { targeted: driverIds.length, sent: okCount, failed: failCount, blocked: 0, noPhone: 0 },
        results: results.map(r => ({ driverId: r.driverId, name: r.driverId, phone: '', status: r.ok ? 'sent' : 'failed', error: r.error?.message || null })),
      }).catch(() => null);
    }

    res.json({
      summary: { total: driverIds.length, ok: okCount, fail: failCount, simulate },
      results,
    });
  } catch (err) {
    console.error('[overview/bulk-message]', err);
    res.status(500).json({ error: 'Falha ao processar disparo em lote.' });
  }
});

/**
 * GET /api/overview/campaign-targets
 * Retorna metas de motoristas por campanha ativa.
 * Colunas: meta (driverTarget), total, faltaCaptar, instalados, faltaInstalar
 * Ordenado por faltaInstalar DESC.
 */
router.get('/campaign-targets', authenticateAdmin, async (req, res) => {
  try {
    const [campaigns, drivers] = await Promise.all([fetchCampaigns(), fetchDrivers()]);

    const activeCampaigns = campaigns.filter(c => (c.status || '').toLowerCase() === 'ativa');

    // Buscar configurações admin (driverTarget) da coleção campaign_settings
    const activeIds = activeCampaigns.map(c => String(c.id || c._id)).filter(Boolean);
    let settingsMap = new Map();
    try {
      settingsMap = await getCampaignSettingsByIds(activeIds);
    } catch (err) {
      console.warn('[overview/campaign-targets] settings fetch failed:', err?.message);
    }

    const items = activeCampaigns.map(c => {
      const cId = String(c.id || c._id);
      const settings = settingsMap.get(cId) || {};
      // driverTarget: prioridade → campaign_settings (MongoDB) → c.driverTarget (db.json)
      const meta = (typeof settings.driverTarget === 'number' && settings.driverTarget > 0)
        ? settings.driverTarget
        : (typeof c.driverTarget === 'number' && c.driverTarget > 0 ? c.driverTarget : 0);

      const campaignDrivers = drivers.filter(d => (d.campaignId || d.campaign_id) === cId);
      const total = campaignDrivers.length;
      const instalados = campaignDrivers.filter(d => d.status === 'instalado').length;
      const faltaCaptar = meta > 0 ? Math.max(0, meta - total) : null;
      const faltaInstalar = Math.max(0, total - instalados);
      return {
        campaignId: cId,
        campaignName: c.name || '(sem nome)',
        meta,
        total,
        instalados,
        faltaCaptar,
        faltaInstalar,
      };
    });

    // ordenar por faltaInstalar DESC (maior déficit primeiro)
    items.sort((a, b) => b.faltaInstalar - a.faltaInstalar);

    res.json({ total: items.length, items });
  } catch (err) {
    console.error('[overview/campaign-targets]', err);
    res.status(500).json({ error: 'Falha ao listar metas de motoristas.' });
  }
});

export default router;
