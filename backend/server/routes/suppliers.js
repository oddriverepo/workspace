import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { logAudit } from '../middleware/audit.js';
import {
  callSuppliersAppsScript,
  getSuppliersIntegrationStatus,
  SuppliersIntegrationError,
} from '../services/suppliers-app-script.js';

const router = Router();

const SUPPLIER_FIELDS = new Set([
  'fornecedor',
  'praca',
  'estado',
  'ativado',
  'classificacao',
  'observacoes',
  'contato',
  'email',
  'telefone',
  'celular',
  'odInPar',
  'odVt',
  'odInVt',
  'odDoor',
  'odInDoor',
  'odPack',
  'odInPack',
  'odFull',
  'odInFull',
  'odLight',
  'odInLight',
  'odDrop',
  'odInDrop',
  'adesivoOd',
  'remocao',
  'observacaoFinal',
  'endereco',
]);

const FIELD_LIMITS = {
  fornecedor: 220,
  praca: 120,
  estado: 80,
  ativado: 40,
  classificacao: 120,
  observacoes: 1500,
  contato: 180,
  email: 180,
  telefone: 80,
  celular: 80,
  observacaoFinal: 1500,
  endereco: 800,
};

const BLOCKED_GENERIC_KEYS = new Set([
  'rowNumber',
  'row',
  '_row',
  '__proto__',
  'constructor',
  'prototype',
]);

router.use(authenticateAdmin);

function sendError(res, error) {
  if (error instanceof SuppliersIntegrationError) {
    return res.status(error.status).json({
      ok: false,
      error: error.message,
      code: error.code,
    });
  }

  console.error('[suppliers] Unexpected error:', error);
  return res.status(500).json({
    ok: false,
    error: 'Erro interno ao processar a tabela de graficas.',
    code: 'SUPPLIERS_INTERNAL_ERROR',
  });
}

function extractItems(result, fallbackKeys = []) {
  const candidates = [
    result?.items,
    result?.data?.items,
    Array.isArray(result?.data) ? result.data : null,
    result?.rows,
    ...fallbackKeys.map((key) => result?.[key]),
    ...fallbackKeys.map((key) => result?.data?.[key]),
  ];
  const items = candidates.find(Array.isArray);
  if (!items) {
    throw new SuppliersIntegrationError('O Apps Script retornou uma lista em formato inesperado.', {
      code: 'SUPPLIERS_INVALID_LIST_RESPONSE',
    });
  }
  return items;
}

function shouldForceRefresh(req) {
  const value = String(req.query?.force || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function parseRow(value) {
  const row = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(row) && row >= 2 ? row : null;
}

function normalizeCellValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return '';
  if (typeof rawValue === 'boolean' || typeof rawValue === 'number') return String(rawValue);
  return String(rawValue).trim();
}

function sanitizeSupplierValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Os dados enviados sao invalidos.' };
  }

  const values = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (!SUPPLIER_FIELDS.has(key)) continue;
    const value = normalizeCellValue(rawValue);
    const maxLength = FIELD_LIMITS[key] || 500;
    if (value.length > maxLength) {
      return { error: `O campo ${key} excede o limite de ${maxLength} caracteres.` };
    }
    values[key] = value;
  }

  if (!Object.keys(values).length) {
    return { error: 'Nenhum campo editavel foi enviado.' };
  }

  return { values };
}

function sanitizeGenericSheetValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Os dados enviados sao invalidos.' };
  }

  const values = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (!key || BLOCKED_GENERIC_KEYS.has(key) || key.length > 80) continue;
    const lower = key.toLowerCase();
    if (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('authorization')
    ) {
      continue;
    }
    const value = normalizeCellValue(rawValue);
    if (value.length > 800) {
      return { error: `O campo ${key} excede o limite de 800 caracteres.` };
    }
    values[key] = value;
  }

  if (!Object.keys(values).length) {
    return { error: 'Nenhum campo editavel foi enviado.' };
  }

  return { values };
}

router.get('/status', (_req, res) => {
  return res.json({ ok: true, ...getSuppliersIntegrationStatus() });
});

router.get('/data', async (req, res) => {
  try {
    const readOptions = { force: shouldForceRefresh(req) };
    const [suppliersResult, saleValuesResult] = await Promise.all([
      callSuppliersAppsScript('listSuppliers', {}, readOptions),
      callSuppliersAppsScript('listSaleValues', {}, readOptions),
    ]);
    const suppliers = extractItems(suppliersResult, ['suppliers']);
    const saleValues = extractItems(saleValuesResult, ['saleValues', 'values']);
    return res.json({
      ok: true,
      suppliers: {
        items: suppliers,
        total: suppliers.length,
        meta: suppliersResult?.meta || {},
      },
      saleValues: {
        items: saleValues,
        total: saleValues.length,
        meta: saleValuesResult?.meta || {},
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/suppliers', async (req, res) => {
  try {
    const result = await callSuppliersAppsScript('listSuppliers', {}, { force: shouldForceRefresh(req) });
    const items = extractItems(result, ['suppliers']);
    return res.json({ ok: true, items, total: items.length, meta: result?.meta || {} });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/suppliers', async (req, res) => {
  const parsed = sanitizeSupplierValues(req.body?.values || req.body?.supplier || req.body);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
  if (!parsed.values.fornecedor) {
    return res.status(400).json({ ok: false, error: 'O nome do fornecedor e obrigatorio.' });
  }

  try {
    const result = await callSuppliersAppsScript('createSupplier', {
      values: parsed.values,
      supplier: parsed.values,
    });
    await logAudit(req, 'suppliers:create', {
      entityType: 'supplier',
      entityId: 'new',
      data: { fields: Object.keys(parsed.values) },
    });
    return res.status(201).json({ ok: true, data: result?.data || result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch('/suppliers/:row', async (req, res) => {
  const row = parseRow(req.params.row);
  if (!row) return res.status(400).json({ ok: false, error: 'Linha da planilha invalida.' });

  const parsed = sanitizeSupplierValues(req.body?.values);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const result = await callSuppliersAppsScript('updateSupplier', {
      row,
      rowNumber: row,
      values: parsed.values,
      updates: parsed.values,
    });
    await logAudit(req, 'suppliers:update', {
      entityType: 'supplier',
      entityId: String(row),
      data: { row, fields: Object.keys(parsed.values) },
    });
    return res.json({ ok: true, data: result?.data || result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/sale-values', async (req, res) => {
  try {
    const result = await callSuppliersAppsScript('listSaleValues', {}, { force: shouldForceRefresh(req) });
    const items = extractItems(result, ['saleValues', 'values']);
    return res.json({ ok: true, items, total: items.length, meta: result?.meta || {} });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/sale-values', async (req, res) => {
  const parsed = sanitizeGenericSheetValues(req.body?.values || req.body);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const result = await callSuppliersAppsScript('createSaleValue', {
      values: parsed.values,
      saleValue: parsed.values,
    });
    await logAudit(req, 'suppliers:sale-value-create', {
      entityType: 'supplier-sale-value',
      entityId: 'new',
      data: { fields: Object.keys(parsed.values) },
    });
    return res.status(201).json({ ok: true, data: result?.data || result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch('/sale-values/:row', async (req, res) => {
  const row = parseRow(req.params.row);
  if (!row) return res.status(400).json({ ok: false, error: 'Linha da planilha invalida.' });

  const parsed = sanitizeGenericSheetValues(req.body?.values);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const result = await callSuppliersAppsScript('updateSaleValue', {
      row,
      rowNumber: row,
      values: parsed.values,
      updates: parsed.values,
    });
    await logAudit(req, 'suppliers:sale-value-update', {
      entityType: 'supplier-sale-value',
      entityId: String(row),
      data: { row, fields: Object.keys(parsed.values) },
    });
    return res.json({ ok: true, data: result?.data || result });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
