import { Router } from 'express';
import { z } from 'zod';

import { fetchDrivers, restoreCampaignDriver } from '../services/db.js';
import { env as disparadorEnv } from '../disparador/config.js';
import {
  createEmptyDriverOutreachSummary,
  dispatchDriverCampaignMessage,
  getDriverContactPolicy,
  getDriverOutreachHistory,
  getDriverOutreachSummary,
  listDriverContactPolicies,
  listDriverOutreachSummaries,
  updateDriverContactPolicy,
} from '../services/driver-outreach.js';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { logAudit } from '../middleware/audit.js';
import { loadLegacyDb } from '../services/legacyStore.js';
import { createDispatchRun, completeDispatchRun } from '../disparador/services/mongo/dispatch-runs.repo.js';
import { upsertRecipient as upsertCampaignRecipient } from '../disparador/services/mongo/campaign-recipients.repo.js';
import { runWorkload } from '../services/workload-manager.js';

const router = Router();
router.use(authenticateAdmin);

const dispatchPayloadSchema = z.object({
  type: z.enum(['text', 'template']),
  text: z.string().optional(),
  templateId: z.string().optional(),
  isInvite: z.coerce.boolean().optional(),
  simulate: z.coerce.boolean().optional(),
});

const singleDispatchSchema = dispatchPayloadSchema.extend({
  campaignId: z.string().optional(),
});

const bulkDispatchSchema = dispatchPayloadSchema.extend({
  campaignId: z.string().optional(),
  driverIds: z.array(z.string().min(1)).min(1),
});

const contactPolicySchema = z.object({
  optInStatus: z.enum(['unknown', 'granted', 'revoked']).optional(),
  optInSource: z.string().max(160).optional(),
  optInCapturedAt: z.string().optional(),
  optInNotes: z.string().max(2000).optional(),
  contactBlocked: z.coerce.boolean().optional(),
  contactBlockReason: z.string().max(240).optional(),
  marketingOptOut: z.coerce.boolean().optional(),
  marketingOptOutReason: z.string().max(240).optional(),
  cooldownUntil: z.string().optional(),
  cooldownReason: z.string().max(240).optional(),
});

const EXPORT_ROWS_LIMIT = 20_000;
const exportDriversSchema = z.object({
  rows: z.array(z.object({}).passthrough()).min(1).max(EXPORT_ROWS_LIMIT),
  totalAvailable: z.number().optional(),
  filteredCount: z.number().optional(),
});

const DRIVER_EXPORT_COLUMNS = [
  { header: 'Nome', key: 'nome', width: 32 },
  { header: 'Telefone', key: 'telefone', width: 18 },
  { header: 'Cidade', key: 'cidade', width: 22 },
  { header: 'UF', key: 'uf', width: 8 },
  { header: 'Campanha atual', key: 'campanhaAtual', width: 32 },
  { header: 'Placa', key: 'placa', width: 12 },
  { header: 'Modelo', key: 'modelo', width: 24 },
  { header: 'CPF', key: 'cpf', width: 16 },
  { header: 'PIX', key: 'pix', width: 24 },
  { header: 'Email', key: 'email', width: 34 },
  { header: 'Apps', key: 'apps', width: 28 },
  { header: 'Rating', key: 'rating', width: 10 },
  { header: 'Periodo', key: 'periodo', width: 18 },
  { header: 'Cadastro', key: 'cadastro', width: 14 },
];

function asArray(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function asBooleanFlag(value) {
  return value === true || value === '1' || value === 'true';
}

function driverKey(driver) {
  return String(driver?.id || driver?._id || '').trim();
}

function applyNoCampaignFilter(drivers, noCampaignOnly) {
  if (!noCampaignOnly) return drivers;
  return drivers.filter((driver) => !driver?.campaignId);
}

function validateDispatchPayload(payload) {
  if (payload.type === 'text' && !String(payload.text || '').trim()) {
    return 'Texto nao pode ser vazio.';
  }
  if (payload.type === 'template' && !String(payload.templateId || '').trim()) {
    return 'Template obrigatorio para envio por template.';
  }
  return '';
}

function mapErrorStatus(code) {
  if (code === 'DRIVER_NOT_FOUND' || code === 'CAMPAIGN_NOT_FOUND' || code === 'TEMPLATE_NOT_FOUND') {
    return 404;
  }
  if (
    code === 'PHONE_NOT_FOUND' ||
    code === 'INVALID_TEXT' ||
    code === 'INVALID_TYPE' ||
    code === 'TEMPLATE_NOT_APPROVED'
  ) {
    return 400;
  }
  if (
    code === 'TEXT_OUTSIDE_WINDOW' ||
    code === 'CONTACT_BLOCKED' ||
    code === 'OPT_OUT_ACTIVE' ||
    code === 'COOLDOWN_ACTIVE' ||
    code === 'MARKETING_OPT_OUT' ||
    code === 'TEMPLATE_NOT_ALLOWED'
  ) {
    return 409;
  }
  if (code === 'SEND_ERROR') {
    return 502;
  }
  return 502;
}

function sanitizeExportFilename(value) {
  return String(value || 'motoristas_oddrive')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'motoristas_oddrive';
}

function exportTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join('-') + '_' + [pad(d.getHours()), pad(d.getMinutes())].join('-');
}

function neutralizeSpreadsheetFormula(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao';

  let text = String(value).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ');
  if (text.length > 32760) text = text.slice(0, 32760);

  if (/^\s*[=+\-@\t\r]/.test(text)) {
    return "'" + text;
  }
  return text;
}

function buildDriverExportRow(row) {
  return DRIVER_EXPORT_COLUMNS.reduce((acc, column) => {
    acc[column.key] = neutralizeSpreadsheetFormula(row?.[column.key]);
    return acc;
  }, {});
}

async function attachOutreachSummary(drivers, enabled) {
  if (!enabled) return drivers;
  const ids = drivers.map(driverKey).filter(Boolean);
  if (!ids.length) return drivers;

  try {
    const summaryMap = await listDriverOutreachSummaries(ids);
    return drivers.map((driver) => ({
      ...driver,
      outreachSummary: summaryMap.get(driverKey(driver)) || createEmptyDriverOutreachSummary(),
    }));
  } catch (err) {
    console.warn('[drivers] outreach summary error:', err?.message || err);
    return drivers.map((driver) => ({
      ...driver,
      outreachSummary: createEmptyDriverOutreachSummary(),
    }));
  }
}

/** GET /api/drivers?noCampaign=1&includeOutreach=1 */
router.get('/', async (req, res) => {
  const noCampaignOnly = asBooleanFlag(req.query.noCampaign);
  const includeOutreach = asBooleanFlag(req.query.includeOutreach);

  try {
    let drivers = applyNoCampaignFilter(asArray(await fetchDrivers()), noCampaignOnly);
    drivers = await attachOutreachSummary(drivers, includeOutreach);
    return res.json({ ok: true, items: drivers, total: drivers.length, source: 'api' });
  } catch (err) {
    console.error('[drivers] fetch error:', err);

    try {
      const db = loadLegacyDb();
      let fallback = applyNoCampaignFilter(asArray(db?.drivers), noCampaignOnly);
      fallback = await attachOutreachSummary(fallback, includeOutreach);

      console.warn('[drivers] Returning legacy fallback data:', fallback.length);
      return res.json({
        ok: true,
        items: fallback,
        total: fallback.length,
        source: 'legacy-fallback',
        warning: 'OdDrive API indisponivel; retornando dados locais de contingencia.',
      });
    } catch (fallbackErr) {
      console.error('[drivers] fallback error:', fallbackErr);
      return res.status(500).json({ ok: false, error: 'Falha ao buscar motoristas.' });
    }
  }
});

router.post('/outreach/bulk-send', async (req, res) => {
  const parsed = bulkDispatchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Payload invalido para disparo em massa.' });
  }

  const validationError = validateDispatchPayload(parsed.data);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  try {
    const drivers = asArray(await fetchDrivers());
    const driverMap = new Map(drivers.map((driver) => [driverKey(driver), driver]));
    const hardLimit = Math.max(1, Number(disparadorEnv.campaignSendLimit || 1));
    const queuedDriverIds = parsed.data.driverIds.slice(0, hardLimit);
    const skippedByLimit = Math.max(0, parsed.data.driverIds.length - queuedDriverIds.length);
    const _dispatchRun = await createDispatchRun({
      source: 'drivers_bulk',
      sourceName: 'Disparo em Massa (Motoristas)',
      campaignId: parsed.data.campaignId || '',
      campaignName: '',
      templateId: parsed.data.templateId || '',
      templateName: '',
      operatorId: req.adminUser?.id || '',
      operatorName: req.adminUser?.name || req.adminUser?.username || '',
    }).catch(() => null);

    const results = [];

    for (const requestedId of queuedDriverIds) {
      const driver = driverMap.get(String(requestedId || '').trim());
      if (!driver) {
        results.push({
          ok: false,
          driverId: requestedId,
          error: { code: 'DRIVER_NOT_FOUND', message: 'Motorista nao encontrado.' },
        });
        continue;
      }

      const result = await dispatchDriverCampaignMessage({
        ...parsed.data,
        driver,
        driverId: driverKey(driver),
        dispatchScope: 'bulk',
        dispatchRunId: _dispatchRun?.id || '',
      });
      results.push({
        ...result,
        driverId: driverKey(driver),
        driverName: driver.name || '',
      });
      if (_dispatchRun) {
        const msg = result?.item;
        await upsertCampaignRecipient({
          campaignId: _dispatchRun.id,
          contactId: msg?.contactId || driverKey(driver),
          contactName: driver.name || '',
          phoneE164: msg?.phoneE164 || '',
          metaMessageId: msg?.metaMessageId || '',
          deliveryStatus: msg?.deliveryStatus || (result?.ok ? 'sent' : 'failed'),
          outboundMessageId: msg?.id || '',
          templateId: parsed.data.templateId || '',
          templateName: '',
          deliveryError: result?.ok ? null : (result?.error?.message || null),
        }).catch(() => null);
      }
    }

    const sent = results.filter((item) => item.ok).length;
    const failed = results.length - sent;
    const status = sent > 0 ? 200 : mapErrorStatus(results[0]?.error?.code || 'SEND_ERROR');

    if (_dispatchRun) {
      await completeDispatchRun(_dispatchRun.id, {
        totals: { targeted: queuedDriverIds.length, sent, failed, blocked: 0, noPhone: 0 },
        results: results.map(r => ({ driverId: r.driverId, name: r.driverName || r.driverId, phone: '', status: r.ok ? 'sent' : 'failed', error: r.error?.message || null })),
      }).catch(() => null);
    }

    return res.status(status).json({
      ok: sent > 0,
      summary: {
        totalRequested: parsed.data.driverIds.length,
        queuedCount: queuedDriverIds.length,
        sent,
        failed,
        skippedByLimit,
        limitApplied: hardLimit,
      },
      ...(skippedByLimit > 0
        ? { warning: `Limite operacional aplicado: ${hardLimit} motorista(s) processado(s) nesta requisicao.` }
        : {}),
      results,
    });
  } catch (err) {
    console.error('[drivers] bulk send error:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao disparar mensagens em massa.' });
  }
});

router.post('/export', async (req, res) => {
  const parsed = exportDriversSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: `Payload invalido para exportacao. Envie entre 1 e ${EXPORT_ROWS_LIMIT} motorista(s).`,
    });
  }

  try {
    const rows = parsed.data.rows.map(buildDriverExportRow);
    const filename = sanitizeExportFilename(`motoristas_oddrive_${exportTimestamp()}`) + '.xlsx';

    await runWorkload('heavy', 'drivers:export', async () => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
        useStyles: true,
        useSharedStrings: false,
      });
      workbook.creator = 'OD Drive';
      workbook.created = new Date();
      workbook.modified = new Date();

      const sheet = workbook.addWorksheet('Motoristas', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      sheet.columns = DRIVER_EXPORT_COLUMNS;
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: DRIVER_EXPORT_COLUMNS.length },
      };
      const headerRow = sheet.getRow(1);
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        cell.alignment = { vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF99F6E4' } } };
      });
      headerRow.commit();

      for (const row of rows) {
        const excelRow = sheet.addRow(row);
        excelRow.eachCell((cell) => { cell.alignment = { vertical: 'top' }; });
        excelRow.commit();
      }
      sheet.commit();
      await workbook.commit();
    });
  } catch (err) {
    console.error('[drivers] export error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: 'Falha ao exportar motoristas.' });
    }
    try { res.end(); } catch (_) {}
  }
});

router.post('/:id/restore-campaign', async (req, res) => {
  try {
    const driverId = String(req.params.id || '').trim();
    if (!driverId) {
      return res.status(400).json({ ok: false, error: 'Motorista obrigatorio.' });
    }

    const drivers = asArray(await fetchDrivers());
    const driver = drivers.find((item) => driverKey(item) === driverId) || null;
    const campaignId = String(
      req.body?.campaignId || driver?.detachedFromCampaignId || '',
    ).trim();

    if (!campaignId) {
      return res.status(400).json({
        ok: false,
        error: 'Este motorista nao possui campanha removida para restaurar.',
      });
    }

    const result = await restoreCampaignDriver({
      campaignId,
      driverId,
      restoredBy: req.adminUser,
    });

    if (!result.restored) {
      return res.status(404).json({
        ok: false,
        error: 'Nao havia uma desvinculacao ativa para restaurar.',
      });
    }

    const refreshedDrivers = asArray(await fetchDrivers());
    const refreshedDriver = refreshedDrivers.find((item) => driverKey(item) === driverId) || null;

    await logAudit(req, 'driver:restore-campaign', {
      entityType: 'driver',
      entityId: driverId,
      data: {
        campaignId,
        campaignName: refreshedDriver?.campaignName || '',
        driverName: refreshedDriver?.name || driver?.name || '',
      },
    });

    return res.json({
      ok: true,
      restored: true,
      campaignId,
      driver: refreshedDriver,
    });
  } catch (err) {
    console.error('[drivers] restore campaign error:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao restaurar motorista na campanha.' });
  }
});

router.get('/:id/outreach', async (req, res) => {
  try {
    const normalizedDriverId = String(req.params.id || '').trim();
    const [items, summary] = await Promise.all([
      getDriverOutreachHistory(normalizedDriverId),
      getDriverOutreachSummary(normalizedDriverId),
    ]);
    return res.json({ ok: true, items, summary });
  } catch (err) {
    console.error('[drivers] outreach history error:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao carregar historico de comunicacao.' });
  }
});

/**
 * GET /api/drivers/contact-policies?ids=id1,id2,...
 * Retorna políticas de contato de múltiplos motoristas em lote.
 */
router.get('/contact-policies', async (req, res) => {
  try {
    const raw = String(req.query.ids || '').trim();
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) {
      return res.status(400).json({ ok: false, error: 'ids obrigatorio.' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ ok: false, error: 'Maximo 500 ids por requisicao.' });
    }
    const map = await listDriverContactPolicies(ids);
    const policies = {};
    for (const [id, policy] of map.entries()) {
      policies[id] = { contactBlocked: policy.contactBlocked, contactBlockReason: policy.contactBlockReason };
    }
    return res.json({ ok: true, policies });
  } catch (err) {
    console.error('[drivers] contact policies batch error:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao carregar politicas de contato.' });
  }
});

router.get('/:id/contact-policy', async (req, res) => {
  try {
    const policy = await getDriverContactPolicy(req.params.id);
    return res.json({ ok: true, policy });
  } catch (err) {
    console.error('[drivers] contact policy read error:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao carregar politica de contato.' });
  }
});

router.patch('/:id/contact-policy', async (req, res) => {
  const parsed = contactPolicySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Payload invalido para politica de contato.' });
  }

  try {
    const driverId = String(req.params.id || '').trim();
    const policy = await updateDriverContactPolicy(driverId, parsed.data, {
      updatedBy: req.adminUser?.username || req.adminUser?.id || 'admin',
    });
    const summary = await getDriverOutreachSummary(driverId);
    return res.json({ ok: true, policy, summary });
  } catch (err) {
    console.error('[drivers] contact policy update error:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar politica de contato.' });
  }
});

router.post('/:id/outreach/send', async (req, res) => {
  const parsed = singleDispatchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Payload invalido para disparo individual.' });
  }

  const validationError = validateDispatchPayload(parsed.data);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  const _dispatchRun = await createDispatchRun({
    source: 'drivers_individual',
    sourceName: 'Motoristas',
    campaignId: parsed.data.campaignId || '',
    campaignName: '',
    templateId: parsed.data.templateId || '',
    templateName: '',
    operatorId: req.adminUser?.id || '',
    operatorName: req.adminUser?.name || req.adminUser?.username || '',
  }).catch(() => null);

  try {
    const result = await dispatchDriverCampaignMessage({
      ...parsed.data,
      driverId: req.params.id,
      dispatchScope: 'individual',
      dispatchRunId: _dispatchRun?.id || '',
    });

    if (_dispatchRun) {
      const msg = result?.item;
      await upsertCampaignRecipient({
        campaignId: _dispatchRun.id,
        contactId: msg?.contactId || req.params.id,
        contactName: msg?.displayName || '',
        phoneE164: msg?.phoneE164 || '',
        metaMessageId: msg?.metaMessageId || '',
        deliveryStatus: msg?.deliveryStatus || (result?.ok ? 'sent' : 'failed'),
        outboundMessageId: msg?.id || '',
        templateId: parsed.data.templateId || '',
        templateName: '',
        deliveryError: result?.ok ? null : (result?.error?.message || null),
      }).catch(() => null);
      await completeDispatchRun(_dispatchRun.id, {
        totals: { targeted: 1, sent: result.ok ? 1 : 0, failed: result.ok ? 0 : 1, blocked: 0, noPhone: 0 },
        results: [],
      }).catch(() => null);
    }

    if (!result.ok) {
      return res.status(mapErrorStatus(result.error?.code || 'SEND_ERROR')).json(result);
    }

    return res.json(result);
  } catch (err) {
    if (_dispatchRun) {
      await completeDispatchRun(_dispatchRun.id, {
        totals: { targeted: 1, sent: 0, failed: 1, blocked: 0, noPhone: 0 },
        results: [],
      }).catch(() => null);
    }
    console.error('[drivers] single send error:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao disparar mensagem para o motorista.' });
  }
});

export default router;
