import { Router } from 'express';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { readSheetByRange, readSheetHeader, getSheetId } from '../services/sheets.js';
import { normalizeName } from '../lib/normalize.js';
import { buildDriversFromRows, resolveSheetName } from '../lib/campaignImport.js';
import { detectKmColumns } from '../lib/kmColumns.js';
import { upsertCampaignRecord, upsertDriverRecord, upsertMasterRecord } from '../services/db.js';
import { ensureLegacyStoreReady, loadLegacyDb, saveLegacyDb } from '../services/legacyStore.js';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { validateSpreadsheetId, requireFields } from '../middleware/validators.js';

await ensureLegacyStoreReady();

function trim(value) {
  return String(value ?? '').trim();
}

function generateCampaignCode(db) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const used = new Set(
    (db.campaigns || [])
      .map(c => trim(c.campaignCode).toUpperCase())
      .filter(Boolean),
  );

  let attempt = 0;
  while (attempt < 1000) {
    const buf = crypto.randomBytes(6);
    const code = Array.from(buf, (b) => alphabet[b % alphabet.length]).join('');
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    attempt += 1;
  }

  let fallback = `C${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  if (fallback.length < 6) fallback = fallback.padEnd(6, 'X');
  if (fallback.length > 6) fallback = fallback.slice(0, 6);
  while (used.has(fallback)) {
    fallback = `${fallback.slice(0, 5)}${crypto.randomBytes(1)[0] % 10}`;
  }
  used.add(fallback);
  return fallback;
}

function ensureCampaignCode(db, campaign) {
  if (!campaign) return '';
  const current = trim(campaign.campaignCode).toUpperCase();
  if (current) {
    campaign.campaignCode = current;
    return current;
  }
  const code = generateCampaignCode(db);
  campaign.campaignCode = code;
  return code;
}

function loadDB() {
  const db = loadLegacyDb();
  db.campaigns = Array.isArray(db.campaigns) ? db.campaigns : [];
  db.drivers = Array.isArray(db.drivers) ? db.drivers : [];
  db.review = Array.isArray(db.review) ? db.review : [];
  return db;
}

function saveDB(db) {
  saveLegacyDb(db);
}

const router = Router();
const DEFAULT_MIN_KM_PER_DRIVER = 100;

const REQUIRED_DRIVER_COLUMNS = [
  'DRIVER ID',
  'Nome',
  'Cidade',
  'Status',
  'PIX',
];


function ensureDriverHeader(header = []) {
  const out = Array.isArray(header) ? [...header] : [];
  const seen = new Set(out.map(col => String(col || '').toUpperCase()));
  for (const col of REQUIRED_DRIVER_COLUMNS) {
    if (!seen.has(col.toUpperCase())) {
      out.push(col);
      seen.add(col.toUpperCase());
    }
  }
  return out;
}

// Importa a planilha principal da campanha (aba Pagina1 por padrao)
router.post('/campaign', authenticateAdmin, validateSpreadsheetId, requireFields('campaignName'), async (req, res) => {
  const {
    spreadsheetId,
    sheetName = 'Pagina1',
    campaignName,
    client = '',
    period = '',
  } = req.body;

  if (!spreadsheetId) {
    return res.status(400).json({ error: 'spreadsheetId obrigatorio' });
  }

  const resolvedSheetName = resolveSheetName(sheetName, 'Pagina1');
  let rows;
  let header;
  let sheetGid;

  // small helper to avoid hanging indefinitely on remote API calls
  const withTimeout = (promise, ms = 20000) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);

  try {
    // Protect against long network stalls (Google Sheets / Drive)
    rows = await withTimeout(
      readSheetByRange(spreadsheetId, `${resolvedSheetName}!A:Z`),
      20000,
    );
    header = await withTimeout(readSheetHeader(spreadsheetId, resolvedSheetName), 15000);
    sheetGid = await withTimeout(getSheetId(spreadsheetId, resolvedSheetName), 15000);
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err?.message || String(err);
    console.warn('[imports] sheet read error or timeout', detail);
    return res.status(400).json({
      error: 'Nao foi possivel ler a planilha informada. Verifique o ID, a aba e as permissoes da conta de servico. (timeout ou erro de rede)',
      detail,
    });
  }
  header = ensureDriverHeader(header);
  const db = loadDB();

  const campaignId = nanoid();
  const now = Date.now();

  const campObj = {
    id: campaignId,
    name: campaignName || `Campanha ${campaignId.slice(0, 5)}`,
    client,
    period,
    status: 'ativa',
    sheetId: spreadsheetId,
    sheetName: resolvedSheetName,
    sheetHeader: header,
    sheetGid,
    driveFolderId: null,
    kmMinimumPerDriver: DEFAULT_MIN_KM_PER_DRIVER,
    createdAt: now,
    updatedAt: now,
  };
  ensureCampaignCode(db, campObj);
  db.campaigns = Array.isArray(db.campaigns) ? db.campaigns : [];
  db.campaigns.push(campObj);
  const { drivers, counts, imported, reviewEntries } = buildDriversFromRows(rows, {
    campaignId,
    now,
  });

  db.drivers.push(...drivers);

  for (const entry of reviewEntries) {
    db.review.push(entry);
  }

  saveDB(db);
  res.json({
    campaignId,
    imported,
    review: reviewEntries.length,
    counts,
  });

  // MongoDB sync em background para nao travar o import
  ;(async () => {
    try {
      await upsertCampaignRecord(campObj);
    } catch (err) {
      console.warn('[imports] upsertCampaignRecord falhou', err?.message || err);
    }
    try {
      for (const d of drivers) {
        try {
          await upsertDriverRecord(d);
        } catch (err) {
          console.warn('[imports] upsertDriverRecord falhou', err?.message || err);
        }
        try {
          await upsertMasterRecord(campObj, d);
        } catch (err) {
          console.warn('[imports] upsertMasterRecord falhou', err?.message || err);
        }
      }
    } catch (err) {
      console.warn('[imports] db sync falhou', err?.message || err);
    }
  })().catch(() => {});
});

// Importa planilha de KM (Planilha1) e tenta vincular por nome normalizado
router.post('/km', authenticateAdmin, validateSpreadsheetId, requireFields('campaignId'), async (req, res) => {
  const { spreadsheetId, sheetName = 'Planilha1', campaignId } = req.body;

  if (!spreadsheetId || !campaignId) {
    return res
      .status(400)
      .json({ error: 'spreadsheetId e campaignId sao obrigatorios' });
  }

  const resolvedSheetName = resolveSheetName(sheetName, 'Planilha1');
  let rows;
  try {
    rows = await readSheetByRange(
      spreadsheetId,
      `${resolvedSheetName}!A:Z`,
    );
  } catch (err) {
    const remoteMessage = err?.response?.data?.error?.message || err?.message || String(err);
    console.error('Error reading KM sheet', remoteMessage, err);
    const reason = err?.response?.data?.error?.errors?.[0]?.reason;
    const hint = reason === 'failedPrecondition'
      ? 'Possivel causa: o arquivo informado nao é uma planilha Google (Sheets) ou a operacao nao é suportada para este documento.'
      : 'Verifique se o ID está correto e se a conta de servico (GOOGLE_CLIENT_EMAIL) tem acesso a planilha.';
    return res.status(400).json({
      error: 'Nao foi possivel importar a planilha de KM.',
      detail: remoteMessage,
      hint,
    });
  }

  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === campaignId);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha nao encontrada' });
  }

  const drivers = db.drivers.filter(d => d.campaignId === campaignId);
  const driversById = new Map(drivers.map(d => [d.id, d]));
  const driversByName = new Map(drivers.map(d => [d.nameKey, d]));

  // remove entradas anteriores de KM_MATCH para esta campanha
  db.review = db.review.filter(r => !(r.campaignId === campaignId && r.type === 'KM_MATCH'));

  let linked = 0;
  const reviewEntries = [];
  const now = Date.now();

  // Save reference to the KM sheet used for this import so we can
  // update KM rows later (sheetId, sheetName and header)
  try {
    campaign.kmSheetId = spreadsheetId;
    campaign.kmSheetName = resolvedSheetName;
    campaign.kmSheetHeader = await readSheetHeader(spreadsheetId, resolvedSheetName);
    // Detect and persist KM column mapping (periods/totals/extras)
    try {
      const header = campaign.kmSheetHeader || [];
      const mapping = detectKmColumns(header);
      campaign.kmColumns = mapping;
      // Prefer the detected period count if available, else keep existing heuristic/fallback
      if (mapping && Number.isFinite(Number(mapping.periodCount)) && mapping.periodCount > 0) {
        campaign.kmPeriods = mapping.periodCount;
      } else {
        // fallback: derive number of KM periods from header columns (fallback to 3 if none detected)
        let maxIdx = 0;
        const re = /(?:KM RODADO|META KM|KM|STATUS)\s*(\d+)/i;
        for (const h of header) {
          const m = String(h || '').match(re);
          if (m && m[1]) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > maxIdx) maxIdx = n;
          }
        }
        campaign.kmPeriods = maxIdx > 0 ? maxIdx : (campaign.kmPeriods || 3);
      }
    } catch (err) {
      // keep existing fallback if mapping fails
      campaign.kmPeriods = campaign.kmPeriods || 3;
    }
  } catch (err) {
    // ignore header read failure; not critical for import to succeed
    console.warn('Failed to read KM sheet header for campaign', campaignId, err?.message || err);
  }

  campaign.updatedAt = now;

  for (const row of rows) {
    const rowNumber = row.__rowNumber || null;
    const normalizedRow = normalizeRowKeys(row);
    const raw = buildRawSnapshot(row);

    const nameValue = pick(normalizedRow, ['NOME', 'NAME']);
    const nome = String(nameValue || '').trim();
    if (!nome) continue;
    const nameKey = normalizeName(nome);

    const driverIdValue = pick(normalizedRow, ['_DRIVERID', '_DRIVER ID', 'DRIVERID', 'DRIVER ID']);
    const driverIdTrimmed = driverIdValue ? String(driverIdValue).trim() : '';
    let driver = null;
    if (driverIdTrimmed && driversById.has(driverIdTrimmed)) {
      driver = driversById.get(driverIdTrimmed);
    } else if (driversByName.has(nameKey)) {
      driver = driversByName.get(nameKey);
    }

    const kmData = buildKmData(normalizedRow, raw, rowNumber, nome, now);

    if (!driver) {
      reviewEntries.push({
        id: nanoid(),
        type: 'KM_MATCH',
        campaignId,
        driverId: null,
        driverName: nome,
        rowNumber,
        payload: kmData.raw,
        note: 'Motorista nao encontrado para a linha de KM',
        createdAt: now,
      });
      continue;
    }

    driver.km = kmData;
    driver.updatedAt = now;
    linked += 1;
  }

  for (const entry of reviewEntries) {
    db.review.push(entry);
  }

  campaign.updatedAt = now;
  saveDB(db);

  // MongoDB: sincroniza a tabela mestre para os motoristas desta campanha
  try {
    const affectedDrivers = db.drivers.filter(d => d.campaignId === campaignId);
    for (const d of affectedDrivers) { try { await upsertMasterRecord(campaign, d); } catch {} }
  } catch {}

  res.json({ linked, review: reviewEntries.length });
});

export default router;

function normalizeRowKeys(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '__rowNumber') continue;
    const normKey = normalizeHeaderKey(key);
    normalized[normKey] = value ?? '';
  }
  return normalized;
}

function buildRawSnapshot(row) {
  const snapshot = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '__rowNumber') continue;
    snapshot[key] = value ?? '';
  }
  return snapshot;
}

function normalizeHeaderKey(key) {
  return String(key || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function pick(row, keys) {
  for (const key of keys) {
    const normalized = normalizeHeaderKey(key);
    if (row[normalized] !== undefined && String(row[normalized]).trim() !== '') {
      return row[normalized];
    }
  }
  const first = normalizeHeaderKey(keys[0]);
  return row[first];
}

function normalizeNumber(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  if (!str) return null;
  const sanitized = str.replace(/\./g, '').replace(/,/g, '.').replace('%', '');
  const num = Number(sanitized);
  return Number.isFinite(num) ? num : null;
}

function normalizeDate(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (!str) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const matchDMY = str.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (matchDMY) {
    const day = matchDMY[1];
    const month = matchDMY[2];
    let year = matchDMY[3];
    if (year.length === 2) {
      year = Number(year) + 2000;
    }
    return `${year}-${month}-${day}`;
  }

  const matchYMD = str.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (matchYMD) {
    return `${matchYMD[1]}-${matchYMD[2]}-${matchYMD[3]}`;
  }

  return '';
}

function normalizeInt(val) {
  const num = normalizeNumber(val);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function derivePercent(rawStatus, km, meta) {
  const value = normalizeNumber(rawStatus);
  if (value !== null) return value;
  if (km !== null && meta !== null && meta !== 0) {
    return (km / meta) * 100;
  }
  return null;
}

function deriveStatus(rawStatus, percent) {
  const normalized = normalizeHeaderKey(rawStatus || '');
  if (normalized === 'OK') return 'OK';
  if (normalized === 'ATENCAO' || normalized === 'ATENÇÃO') return 'Atenção';
  if (normalized === 'CRITICO' || normalized === 'CRÍTICO') return 'Crítico';

  if (percent === null || !Number.isFinite(percent)) return '';
  if (percent >= 100) return 'OK';
  if (percent >= 80) return 'Atenção';
  return 'Crítico';
}

function buildKmData(row, raw, rowNumber, nome, timestamp) {
  const periods = [];
  for (let i = 1; i <= 3; i += 1) {
    const dataInicio = normalizeDate(pick(row, [`DATA INICIO ${i}`, `DATA INICIO${i}`]));
    const dataAtual = normalizeDate(pick(row, [`DATA ATUAL ${i}`, `DATA ATUAL${i}`]));
    const qtdeDias = normalizeInt(pick(row, [`QTDE DIAS ${i}`, `QTDE DIAS${i}`]));
    const kmRodado = normalizeNumber(pick(row, [`KM RODADO ${i}`, `KM RODADO${i}`, `KM ${i}`]));
    const metaKm = normalizeNumber(pick(row, [`META KM ${i}`, `META KM${i}`]));
    const statusRaw = pick(row, [`STATUS ${i}`]);
    const percent = derivePercent(statusRaw, kmRodado, metaKm);
    const status = deriveStatus(statusRaw, percent);

    const hasData = [dataInicio, dataAtual, qtdeDias, kmRodado, metaKm, statusRaw]
      .some(value => value !== null && value !== '' && value !== undefined);

    if (!hasData) continue;

    periods.push({
      index: i,
      dataInicio,
      dataAtual,
      qtdeDias,
      kmRodado,
      metaKm,
      status,
      statusRaw: statusRaw ?? '',
      percent,
    });
  }

  const km1 = normalizeNumber(pick(row, ['KM RODADO 1', 'KM RODADO1', 'KM 1']));
  const km2 = normalizeNumber(pick(row, ['KM RODADO 2', 'KM RODADO2', 'KM 2']));
  const km3 = normalizeNumber(pick(row, ['KM RODADO 3', 'KM RODADO3', 'KM 3']));
  const meta1 = normalizeNumber(pick(row, ['META KM 1', 'META KM1']));
  const meta2 = normalizeNumber(pick(row, ['META KM 2', 'META KM2']));
  const meta3 = normalizeNumber(pick(row, ['META KM 3', 'META KM3']));

  let kmTotal = normalizeNumber(pick(row, ['KM RODADO TOTAL', 'KM TOTAL']));
  if (kmTotal === null) {
    const parts = [km1, km2, km3].filter(n => Number.isFinite(n));
    if (parts.length) kmTotal = parts.reduce((acc, cur) => acc + cur, 0);
  }

  let metaTotal = normalizeNumber(pick(row, ['META KM TOTAL', 'META TOTAL']));
  if (metaTotal === null) {
    const parts = [meta1, meta2, meta3].filter(n => Number.isFinite(n));
    if (parts.length) metaTotal = parts.reduce((acc, cur) => acc + cur, 0);
  }

  const statusTotalRaw = pick(row, ['STATUS TOTAL']);
  const percentTotal = derivePercent(statusTotalRaw, kmTotal, metaTotal);
  const statusTotal = deriveStatus(statusTotalRaw, percentTotal);

  const checkIn = pick(row, ['CHECK IN', 'CHECK-IN', 'CHECKIN']) ?? '';
  const comentarios = pick(row, ['COMENTARIOS', 'COMENTÁRIOS', 'COMENTARIO']) ?? '';
  const observacoes = pick(row, ['OBSERVACOES', 'OBSERVAÇÕES']) ?? '';
  const extra = {
    adri: pick(row, ['ADRI']),
  };

  return {
    rowNumber,
    importedAt: timestamp,
    name: nome,
    periods,
    total: {
      kmRodado: kmTotal,
      metaKm: metaTotal,
      status: statusTotal,
      statusRaw: statusTotalRaw ?? '',
      percent: percentTotal,
    },
    summary: {
      km1,
      km2,
      km3,
      meta1,
      meta2,
      meta3,
    },
    checkIn,
    comentarios,
    observacoes,
    raw,
    extra,
  };
}
