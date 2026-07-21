/**
 * partner-leads.js — Rotas da API de Leads de Parceiros
 *
 * GET    /api/partner-leads            — lista leads do MongoDB
 * GET    /api/partner-leads/sync-status — status da última sync + config (sem apiKey)
 * GET    /api/partner-leads/config      — configurações atuais (sem apiKey)
 * PUT    /api/partner-leads/config      — salva configurações (aceita apiKey)
 * POST   /api/partner-leads/sync        — dispara sync manual imediato
 */

import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import {
  listPartnerLeads,
  countPartnerLeads,
  getSyncConfig,
  saveSyncConfig,
  syncPartnerLeads,
  startLeadsScheduler,
  getSyncRuntimeState,
} from '../services/partner-leads-sync.js';

const router = Router();

// ──────────────────────────────────────────────────────────────
//  GET /api/partner-leads
//  Parâmetros: source=driver|whatsapp|all, ref_code, since, convertido
// ──────────────────────────────────────────────────────────────
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const { source, ref_code, since, convertido } = req.query;

    const filter = {
      source:    source && source !== 'all' ? source : undefined,
      ref_code:  ref_code  || undefined,
      since:     since     || undefined,
      convertido: convertido !== undefined
        ? convertido === 'true' || convertido === '1'
        : undefined,
    };

    const leads = await listPartnerLeads(filter);

    // Mapeia para formato compatível com o frontend
    const items = leads.map(lead => ({
      id:            lead._id,
      source:        lead.source,
      nome:          lead.nome,
      telefone:      lead.telefone,
      email:         lead.email,
      cidade:        lead.cidade,
      estado:        lead.estado,
      ref_code:      lead.ref_code,
      partner_name:  lead.partner_name,
      status:        lead.status,
      convertido:    lead.convertido,
      origem:        lead.origem,
      message:       lead.message,
      cnh_categoria: lead.cnh_categoria,
      veiculo_marca: lead.veiculo_marca,
      veiculo_modelo:lead.veiculo_modelo,
      veiculo_ano:   lead.veiculo_ano,
      veiculo_placa: lead.veiculo_placa,
      created_at:    lead.created_at,
      synced_at:     lead.synced_at,
      // campos esperados pelo frontend motoristas
      _isLead:       true,
      listName:      'Leads dos representantes',
    }));

    return res.json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error('[partner-leads] GET / error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
//  GET /api/partner-leads/sync-status
// ──────────────────────────────────────────────────────────────
router.get('/sync-status', authenticateAdmin, async (req, res) => {
  try {
    const cfg = await getSyncConfig();
    const total = await countPartnerLeads();
    return res.json({
      ok: true,
      lastSyncAt:    cfg.lastSyncAt,
      lastSyncCount: cfg.lastSyncCount,
      lastSyncError: cfg.lastSyncError,
      total,
      hasApiKey: !!(process.env.LEADS_API_KEY || '').trim(),
      runtime: getSyncRuntimeState(),
      config: {
        enabled:         cfg.enabled,
        intervalMinutes: cfg.intervalMinutes,
        windowStart:     cfg.windowStart,
        windowEnd:       cfg.windowEnd,
      },
    });
  } catch (err) {
    console.error('[partner-leads] GET /sync-status error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
//  GET /api/partner-leads/config
// ──────────────────────────────────────────────────────────────
router.get('/config', authenticateAdmin, async (req, res) => {
  try {
    const cfg = await getSyncConfig();
    // apiKey NUNCA retornada — apenas indica se está configurada via env
    return res.json({
      ok: true,
      enabled:         cfg.enabled,
      intervalMinutes: cfg.intervalMinutes,
      windowStart:     cfg.windowStart,
      windowEnd:       cfg.windowEnd,
      hasApiKey:       !!(process.env.LEADS_API_KEY || '').trim(),
    });
  } catch (err) {
    console.error('[partner-leads] GET /config error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
//  PUT /api/partner-leads/config
// ──────────────────────────────────────────────────────────────
router.put('/config', authenticateAdmin, async (req, res) => {
  try {
    const { enabled, intervalMinutes, windowStart, windowEnd } = req.body || {};
    // apiKey NUNCA aceita pelo frontend — configurada exclusivamente via env var LEADS_API_KEY no servidor

    if (intervalMinutes !== undefined) {
      const mins = Number(intervalMinutes);
      if (!Number.isInteger(mins) || mins < 5 || mins > 1440) {
        return res.status(400).json({ ok: false, error: 'intervalMinutes deve ser entre 5 e 1440' });
      }
    }

    await saveSyncConfig({ enabled, intervalMinutes, windowStart, windowEnd });

    // Reinicia o scheduler com as novas configurações
    startLeadsScheduler();

    return res.json({ ok: true });
  } catch (err) {
    console.error('[partner-leads] PUT /config error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
//  POST /api/partner-leads/sync  — sync manual
// ──────────────────────────────────────────────────────────────
router.post('/sync', authenticateAdmin, async (req, res) => {
  // 409 se já há uma sync em andamento (mutex)
  const runtimeState = getSyncRuntimeState();
  if (runtimeState.running) {
    return res.status(409).json({ ok: false, error: 'Sync já está em andamento. Aguarde a conclusão.' });
  }

  try {
    const result = await syncPartnerLeads({ force: true });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[partner-leads] POST /sync error:', err);
    const status = err.message?.includes('Circuit breaker') ? 429 : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

export default router;
