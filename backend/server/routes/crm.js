import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { logAudit } from '../middleware/audit.js';
import {
  callCrmAppsScript,
  CrmIntegrationError,
  getCrmIntegrationStatus,
} from '../services/crm-app-script.js';
import {
  getMetaAdsDashboard,
  getMetaAdsStatus,
} from '../services/meta-ads.js';
import {
  getGptMakerCrmStatus,
  getGptMakerInstagramSummary,
} from '../services/gpt-maker-crm.js';
import { reconcileAcquisitionSources } from '../services/crm-acquisition-utils.js';

const router = Router();

const MAIN_FIELDS = new Set([
  'nome',
  'cidade',
  'campanha',
  'telefone',
  'origem',
  'status',
  'atendente',
  'motivoPerda',
]);

const FORWARDED_FIELDS = new Set([
  'nome',
  'cidade',
  'telefone',
  'atendente',
  'status',
  'observacao',
  'dataFinal',
]);

const FIELD_LIMITS = {
  nome: 180,
  cidade: 120,
  campanha: 180,
  telefone: 30,
  origem: 80,
  status: 80,
  atendente: 120,
  motivoPerda: 500,
  observacao: 1000,
  dataFinal: 40,
};

router.use(authenticateAdmin);

function sendError(res, error) {
  if (error instanceof CrmIntegrationError) {
    return res.status(error.status).json({
      ok: false,
      error: error.message,
      code: error.code,
    });
  }

  console.error('[crm] Unexpected error:', error);
  return res.status(500).json({
    ok: false,
    error: 'Erro interno ao processar o CRM.',
    code: 'CRM_INTERNAL_ERROR',
  });
}

function extractItems(result) {
  const candidates = [
    result?.items,
    result?.data?.items,
    Array.isArray(result?.data) ? result.data : null,
    result?.rows,
  ];
  const items = candidates.find(Array.isArray);
  if (!items) {
    throw new CrmIntegrationError('O Apps Script retornou uma lista em formato inesperado.', {
      code: 'CRM_INVALID_LIST_RESPONSE',
    });
  }
  return items;
}

function parseRow(value) {
  const row = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(row) && row >= 2 ? row : null;
}

function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function sanitizeValues(input, allowedFields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Os dados enviados sao invalidos.' };
  }

  const values = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (!allowedFields.has(key)) continue;
    const value = String(rawValue ?? '').trim();
    const maxLength = FIELD_LIMITS[key] || 500;
    if (value.length > maxLength) {
      return { error: `O campo ${key} excede o limite de ${maxLength} caracteres.` };
    }
    values[key] = value;
  }

  if (!Object.keys(values).length) {
    return { error: 'Nenhum campo editavel foi enviado.' };
  }

  if (Object.hasOwn(values, 'telefone')) {
    const phone = cleanPhone(values.telefone);
    if (phone && (phone.length < 8 || phone.length > 15)) {
      return { error: 'O telefone deve conter entre 8 e 15 digitos.' };
    }
    values.telefone = phone;
  }

  return { values };
}

router.get('/status', (_req, res) => {
  return res.json({
    ok: true,
    ...getCrmIntegrationStatus(),
    acquisition: {
      metaAds: getMetaAdsStatus(),
      gptMaker: getGptMakerCrmStatus(),
    },
  });
});

router.get('/acquisition-funnel', async (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const force = String(req.query.refresh || '') === '1';
  const metaStatus = getMetaAdsStatus();
  const gptMakerStatus = getGptMakerCrmStatus();
  const accountId = String(req.query.accountId || metaStatus.defaultAccountId || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return res.status(400).json({ ok: false, error: 'O período informado é inválido.' });
  }
  const fromDate = new Date(`${from}T12:00:00Z`);
  const toDate = new Date(`${to}T12:00:00Z`);
  const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  if (!Number.isFinite(rangeDays) || rangeDays < 1 || rangeDays > 366) {
    return res.status(400).json({ ok: false, error: 'O período deve ter no máximo 366 dias.' });
  }

  const [metaResult, gptMakerResult] = await Promise.allSettled([
    metaStatus.configured
      ? getMetaAdsDashboard({ accountId, from, to, force })
      : Promise.resolve(null),
    getGptMakerInstagramSummary({ from, to, force }),
  ]);

  const metaDashboard = metaResult.status === 'fulfilled' ? metaResult.value : null;
  const directSummary = gptMakerResult.status === 'fulfilled' ? gptMakerResult.value : null;
  const metaSummary = metaDashboard?.summary || {};
  const spend = Number(metaSummary.spendCents || 0) / 100;
  const directConversations = directSummary?.available === true
    && directSummary.conversations !== null
    && directSummary.conversations !== undefined
    && Number.isFinite(Number(directSummary.conversations))
    ? Number(directSummary.conversations)
    : null;
  const attributedConversations = metaDashboard
    ? Number(metaSummary.leadsStarted || 0)
    : null;
  const reconciliation = reconcileAcquisitionSources({
    attributedConversations,
    observedChats: directConversations,
    spend,
  });

  return res.json({
    ok: true,
    period: { from, to },
    methodology: {
      mode: 'hybrid-aggregate-and-probabilistic-identity',
      identityLinkingFrom: 'gptmaker-profile-name-to-registered-lead',
      metaClickIdentityAvailable: false,
      directIdentityMethod: 'normalized-name-with-date-and-ambiguity-guards',
      directIdentityIsConfirmation: false,
      directScope: gptMakerStatus.scope === 'agent'
        ? 'instagram-chats-from-configured-agent'
        : 'all-instagram-chats-in-workspace',
      unattributedMeaning: 'observed-gptmaker-chats-without-meta-attribution-in-the-same-period',
      unattributedIsOrganicConfirmation: false,
    },
    configuration: {
      metaAds: metaStatus,
      gptMaker: gptMakerStatus,
    },
    metaAds: metaDashboard ? {
      available: true,
      account: metaDashboard.account,
      clicks: Number(metaSummary.clicks || 0),
      spend,
      cpc: Number(metaSummary.cpc || 0),
      ctr: Number(metaSummary.ctr || 0),
      attributedConversations,
      costPerAttributedConversation: Number(metaSummary.cpl || 0),
      freshness: metaDashboard.freshness,
    } : {
      available: false,
      code: metaStatus.configured
        ? String(metaResult.reason?.code || 'META_ADS_UNAVAILABLE')
        : 'META_ADS_NOT_CONFIGURED',
    },
    direct: directSummary ? {
      ...directSummary,
      spendPerObservedChat: directConversations > 0 ? spend / directConversations : null,
    } : {
      configured: gptMakerStatus.configured,
      available: false,
      provider: 'gptmaker',
      conversations: null,
      interactions: null,
      code: String(gptMakerResult.reason?.code || 'GPTMAKER_UNAVAILABLE'),
    },
    reconciliation,
  });
});

router.get('/leads', async (_req, res) => {
  try {
    const result = await callCrmAppsScript('listLeads');
    const items = extractItems(result);
    return res.json({ ok: true, items, total: items.length, meta: result?.meta || {} });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/forwarded', async (_req, res) => {
  try {
    const result = await callCrmAppsScript('listForwarded');
    const items = extractItems(result);
    return res.json({ ok: true, items, total: items.length, meta: result?.meta || {} });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/leads', async (req, res) => {
  const parsed = sanitizeValues(req.body?.values || req.body, MAIN_FIELDS);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
  if (!parsed.values.cidade || !parsed.values.telefone) {
    return res.status(400).json({ ok: false, error: 'Cidade e telefone sao obrigatorios.' });
  }

  try {
    const result = await callCrmAppsScript('createLead', { values: parsed.values });
    await logAudit(req, 'crm:lead-create', {
      entityType: 'crm-lead',
      entityId: 'new',
      data: { fields: Object.keys(parsed.values) },
    });
    return res.status(201).json({ ok: true, data: result?.data || result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch('/leads/:row', async (req, res) => {
  const row = parseRow(req.params.row);
  if (!row) return res.status(400).json({ ok: false, error: 'Linha da planilha invalida.' });

  const parsed = sanitizeValues(req.body?.values, MAIN_FIELDS);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  const keyPhone = cleanPhone(req.body?.keyPhone);
  if (!keyPhone) {
    return res.status(400).json({ ok: false, error: 'A chave de telefone do lead e obrigatoria.' });
  }

  try {
    const result = await callCrmAppsScript('updateLead', {
      row,
      keyPhone,
      values: parsed.values,
    });
    await logAudit(req, 'crm:lead-update', {
      entityType: 'crm-lead',
      entityId: String(row),
      data: { row, fields: Object.keys(parsed.values) },
    });
    return res.json({ ok: true, data: result?.data || result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch('/forwarded/:row', async (req, res) => {
  const row = parseRow(req.params.row);
  if (!row) return res.status(400).json({ ok: false, error: 'Linha da planilha invalida.' });

  const parsed = sanitizeValues(req.body?.values, FORWARDED_FIELDS);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  const keyPhone = cleanPhone(req.body?.keyPhone);
  if (!keyPhone) {
    return res.status(400).json({ ok: false, error: 'A chave de telefone do lead e obrigatoria.' });
  }

  try {
    const result = await callCrmAppsScript('updateForwarded', {
      row,
      keyPhone,
      values: parsed.values,
    });
    await logAudit(req, 'crm:forwarded-update', {
      entityType: 'crm-forwarded-lead',
      entityId: String(row),
      data: { row, fields: Object.keys(parsed.values) },
    });
    return res.json({ ok: true, data: result?.data || result });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
