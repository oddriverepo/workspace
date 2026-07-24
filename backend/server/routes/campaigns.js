import { Router, json as jsonParser } from 'express';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { STATUS, normalizeStatus, normalizeName } from '../lib/normalize.js';
import { buildDriversFromRows, resolveSheetName } from '../lib/campaignImport.js';
import {
  readSheetByRange,
  readSheetHeader,
  appendSheetRow,
  deleteSheetRow,
  getSheetId,
  updateSheetRow,
  ensureSheetTab,
  setSheetHeader,
  clearSheetData,
  updateSheetRows,
} from '../services/sheets.js';
import { detectKmColumns } from '../lib/kmColumns.js';
import {
  upsertCampaignRecord,
  upsertDriverRecord,
  insertEvidenceRecord,
  deleteEvidenceRecord,
  listEvidenceByCampaign,
  getEvidenceRecordById,
  deleteStorageFile,
  deleteStorageFilesByFolder,
  upsertMasterRecord,
  deleteMastersByCampaign,
  deleteAllCampaignData,
  detachCampaignDriver,
  isCampaignDriverDetached,
  ensureDatabaseSchema,
  ensureCampaignMasterTable,
  upsertCampaignMasterRows,
  ensureCampaignGraphicsTable,
  upsertCampaignGraphicsRows,
  deleteGraphicRow,
  getCampaignTableName,
  listDriverStorageTree,
  listStorageEntriesByCampaign,
  getDriverLastActivityByCampaign,
  getUploadHeatmapByCampaign,
  listCampaignHistory,
  fetchCampaigns,
  fetchCampaignSummaries,
  fetchCampaignDriverStats,
  fetchCampaignById,
  fetchDrivers,
  fetchDriversByCampaign,
  fetchDriversByCampaignPeriod,
  filterDetachedCampaignDrivers,
  getCacheStatus,
  getSyncStatus,
  getSyncHistory,
  hasMongoData,
  ensureSyncIndexes,
} from '../services/db.js';
import { upsertCampaignSettings, getCampaignSettingsByIds } from '../services/mongo.js';
import buildMasterHeader from '../lib/masterHeader.js';
import { applyCanonicalRaw, buildSheetRowValues, mergeDriverRawSources } from '../lib/driverSheet.js';
import { applyDriverKmSummary, parseKmNumber } from '../lib/driverKm.js';
import { DRIVER_FLOW, GRAPHIC_FLOW, DRIVER_REQUIRED_STEPS, GRAPHIC_REQUIRED_STEPS } from '../lib/flows.js';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { logAudit } from '../middleware/audit.js';
import { runWorkload } from '../services/workload-manager.js';
import { deleteAgentEvidenceDriveFile } from '../services/agent-evidence-drive.js';
import { ensureLegacyStoreReady, loadLegacyDb, saveLegacyDb } from '../services/legacyStore.js';
import { dispatchDriverCampaignMessage } from '../services/driver-outreach.js';
import { listTemplates, getTemplateById } from '../disparador/store/memory-store.js';
import { env as disparadorEnv } from '../disparador/config.js';
import { normalizePhone } from '../disparador/utils/phone.js';
import { createDispatchRun, completeDispatchRun } from '../disparador/services/mongo/dispatch-runs.repo.js';
import { upsertRecipient as upsertCampaignRecipient } from '../disparador/services/mongo/campaign-recipients.repo.js';

await ensureLegacyStoreReady();

const router = Router();

/**
 * Devolve mensagem de erro segura para o cliente.
 * Em 4xx (status setado pelo handler), preserva a mensagem para UX.
 * Em 5xx, retorna apenas o fallback gen\u00e9rico para n\u00e3o vazar internals.
 */
function safeErrorMessage(err, fallback) {
  const status = err && (err.status || err.statusCode);
  if (status && status >= 400 && status < 500 && err.message) return err.message;
  return fallback;
}

const CAMPAIGN_STATUS = ['ativa', 'pausada', 'encerrada', 'inativa'];

const DEFAULT_DRIVER_COLUMNS = [
  'Nome',
  'Cidade',
  'Status',
  'PIX',
  'CPF',
  'Email',
  'Numero',
  'Placa',
  'Modelo',
  'Convite',
  'Data de Instalacao',
  'Horario Plotagem',
  'Adesivagem Inicial',
  'Retirada Adesivo',
  'Status Adesivagem',
  'Observacoes',
  'Comentarios',
];
const CAMPAIGN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAMPAIGN_CODE_LENGTH = 6;
const MAX_KM_PERIODS = 12;
const DEFAULT_KM_PERIODS = 3;
const DEFAULT_MIN_KM_PER_DRIVER = 100;
const DRIVER_REQUIRED_STEP_IDS = [...DRIVER_REQUIRED_STEPS];
const GRAPHIC_REQUIRED_STEP_IDS = [...GRAPHIC_REQUIRED_STEPS];
const ADHESION_INITIAL_ALIASES = [
  'Adesivagem Inicial',
  'Horario Adesivagem Inicial',
  'Horário Adesivagem Inicial',
];
const ADHESION_REMOVAL_ALIASES = [
  'Retirada Adesivo',
  'Horario Retirada Adesivo',
  'Horário Retirada Adesivo',
];
const ADHESION_STATUS_ALIASES = [
  'Status Adesivagem',
  'Situacao Adesivagem',
  'Situação Adesivagem',
];

async function collectEvidenceByDriver(db, campaignId, storageEntries = []) {
  const map = new Map();
  // Build set of valid storage file IDs so we can discard orphaned evidence entries
  const validStorageIds = new Set((Array.isArray(storageEntries) ? storageEntries : []).map(e => String(e.id)));
  let persistedEvidence = [];
  try {
    persistedEvidence = await listEvidenceByCampaign(campaignId);
  } catch (err) {
    console.warn('[campaigns] evidence listing error', err?.message || err);
  }
  const entries = [];
  const seenIds = new Set();
  for (const entry of [
    ...(Array.isArray(db.evidence) ? db.evidence : []),
    ...persistedEvidence,
  ]) {
    const entryId = String(entry?.id || '').trim();
    if (entryId && seenIds.has(entryId)) continue;
    if (entryId) seenIds.add(entryId);
    entries.push(entry);
  }
  for (const entry of entries) {
    if (!entry || String(entry.campaignId || '') !== String(campaignId || '') || !entry.driverId) continue;
    // Skip evidence entries that reference a deleted storage file (orphaned)
    if (
      entry.url &&
      typeof entry.url === 'string' &&
      /^\/api\/storage\/[a-f0-9]{24}$/i.test(entry.url)
    ) {
      const storageId = entry.url.split('/').pop();
      if (!validStorageIds.has(storageId)) continue;
    }
    const key = String(entry.driverId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return mergeStorageEvidence(map, storageEntries, campaignId);
}
function mergeStorageEvidence(map, storageEntries = [], campaignId) {
  if (!Array.isArray(storageEntries)) return map;
  for (const entry of storageEntries) {
    if (!entry || !entry.driverId) {
      continue;
    }
    const key = String(entry.driverId);
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    const already = list.some(e => (e.source === 'mongo' && e.id === entry.id) || (e.url && e.url === entry.url && e.step === entry.step));
    if (already) continue;
    const item = {
      id: entry.id,
      type: entry.uploaderType === 'graphic' ? 'graphic' : 'driver',
      campaignId,
      driverId: entry.driverId,
      graphicId: entry.graphicId || null,
      step: entry.step || '',
      url: entry.url || '',
      path: entry.path || '',
      createdAt: entry.createdAt || Date.now(),
      source: 'mongo',
    };
    list.push(item);
  }
  return map;
}

function buildFlowStatus(entries = [], requiredSteps = [], reviewState = {}) {
  let lastUploadAt = null;

  for (const entry of entries) {
    const ts = Number(entry?.createdAt || entry?.uploadedAt);
    if (Number.isFinite(ts)) lastUploadAt = lastUploadAt ? Math.max(lastUploadAt, ts) : ts;
  }

  const hasUploads = Array.isArray(entries) && entries.length > 0;
  const completed = hasUploads;

  return {
    hasUploads,
    totalUploads: Array.isArray(entries) ? entries.length : 0,
    lastUploadAt: hasUploads ? (lastUploadAt || null) : null,
    completed,
    completedAt: completed ? (lastUploadAt || null) : null,
    pendingSteps: completed ? [] : requiredSteps,
    verifiedAt: reviewState?.verifiedAt || null,
    verifiedBy: reviewState?.verifiedBy || null,
    verifiedByName: reviewState?.verifiedByName || null,
    cooldownUntil: reviewState?.cooldownUntil || null,
  };
}

function computeCooldownUntil(campaign, targetKey) {
  const baseDays = targetKey === 'graphicFlow'
    ? (campaign.graphicCooldownDays ?? 10)
    : (campaign.driverCooldownDays ?? 10);
  const ms = Number(baseDays) * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Date.now() + ms;
}

function buildDriverEvidenceStatus(driver, driverEvidence = []) {
  const driverEntries = driverEvidence.filter(entry => entry?.type === 'driver');
  const graphicEntries = driverEvidence.filter(entry => entry?.type === 'graphic');
  const review = driver?.evidenceReview || {};
  return {
    driverFlow: buildFlowStatus(driverEntries, DRIVER_REQUIRED_STEP_IDS, review.driverFlow),
    graphicFlow: buildFlowStatus(graphicEntries, GRAPHIC_REQUIRED_STEP_IDS, review.graphicFlow),
  };
}

function buildDriverOdometerEvidenceSummary(evidenceEntries = []) {
  const readings = (Array.isArray(evidenceEntries) ? evidenceEntries : [])
    .filter(entry => String(entry?.step || '') === 'odometer-value')
    .map(entry => ({
      type: entry?.type === 'graphic' ? 'graphic' : 'driver',
      value: parseKmNumber(entry?.odometerValue),
      createdAt: Number(entry?.createdAt || entry?.uploadedAt || 0),
    }))
    .filter(entry => Number.isFinite(entry.value) && entry.value > 0)
    .sort((left, right) => left.createdAt - right.createdAt);

  const graphicReadings = readings.filter(entry => entry.type === 'graphic');
  const driverReadings = readings.filter(entry => entry.type === 'driver');
  const graphicInitial = graphicReadings[0] || null;
  const driverLatest = driverReadings[driverReadings.length - 1] || null;

  return {
    graphicInitialValue: graphicInitial?.value ?? null,
    graphicInitialAt: graphicInitial?.createdAt || null,
    driverLatestValue: driverLatest?.value ?? null,
    driverLatestAt: driverLatest?.createdAt || null,
  };
}

function cloneDriverForPayload(driver, evidenceEntries = []) {
  return {
    ...driver,
    evidenceStatus: buildDriverEvidenceStatus(driver, evidenceEntries),
    odometerEvidence: buildDriverOdometerEvidenceSummary(evidenceEntries),
  };
}

function ensureEvidenceReviewTarget(driver, targetKey) {
  if (!driver.evidenceReview || typeof driver.evidenceReview !== 'object') {
    driver.evidenceReview = {};
  }
  if (!driver.evidenceReview[targetKey] || typeof driver.evidenceReview[targetKey] !== 'object') {
    driver.evidenceReview[targetKey] = { verifiedAt: null, verifiedBy: null, verifiedByName: null };
  }
  return driver.evidenceReview[targetKey];
}

function loadDB() {
  return loadLegacyDb();
}

function saveDB(db) {
  saveLegacyDb(db);
}

function trim(value) {
  return String(value ?? '').trim();
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function normalizeColumnLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function findRawAliasEntry(raw = {}, aliases = []) {
  const entries = Object.entries(raw || {});
  if (!entries.length) return { found: false, value: '', key: null };
  const targets = aliases.map(normalizeColumnLabel);
  for (const [key, value] of entries) {
    if (targets.includes(normalizeColumnLabel(key))) {
      return { found: true, value, key };
    }
  }
  return { found: false, value: '', key: null };
}

function parseAdhesionDateTimeMs(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = String(value).trim();
  if (!text) return null;

  const parsedIso = new Date(text.replace(/\s+/, 'T'));
  if (Number.isFinite(parsedIso.getTime())) return parsedIso.getTime();

  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})$/);
  if (!dmy) return null;
  const year = dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3]);
  const month = Number(dmy[2]) - 1;
  const day = Number(dmy[1]);
  const hour = Number(dmy[4]);
  const minute = Number(dmy[5]);
  const date = new Date(year, month, day, hour, minute, 0, 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function formatAdhesionDateTimeInput(value) {
  const timestamp = parseAdhesionDateTimeMs(value);
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function normalizeAdhesionStatus(value) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (!normalized) return '';
  if (normalized === 'agendado' || normalized === 'agendada') return 'agendado';
  if (
    normalized === 'concluido' ||
    normalized === 'concluida' ||
    normalized === 'instalado' ||
    normalized === 'instalada' ||
    normalized === 'finalizado'
  ) {
    return 'concluido';
  }
  if (normalized === 'faltou' || normalized === 'ausente' || normalized === 'nao compareceu') {
    return 'faltou';
  }
  if (normalized === 'reagendado' || normalized === 'reagendada') return 'reagendado';
  return normalized;
}

function applyDriverAdhesionScheduleFromRaw(driver, raw = {}) {
  if (!driver || typeof driver !== 'object') return;
  const current = driver.schedule && typeof driver.schedule === 'object' ? driver.schedule : {};

  let initialAt = Number.isFinite(Number(current.initialAt)) ? Number(current.initialAt) : null;
  let initialAtRaw = formatAdhesionDateTimeInput(current.initialAtRaw ?? initialAt);
  let removalAt = Number.isFinite(Number(current.removalAt)) ? Number(current.removalAt) : null;
  let removalAtRaw = formatAdhesionDateTimeInput(current.removalAtRaw ?? removalAt);
  let status = normalizeAdhesionStatus(current.status);

  const initialEntry = findRawAliasEntry(raw, ADHESION_INITIAL_ALIASES);
  if (initialEntry.found) {
    initialAt = parseAdhesionDateTimeMs(initialEntry.value);
    initialAtRaw = formatAdhesionDateTimeInput(initialEntry.value);
    raw[ADHESION_INITIAL_ALIASES[0]] = initialAtRaw || '';
  }

  const removalEntry = findRawAliasEntry(raw, ADHESION_REMOVAL_ALIASES);
  if (removalEntry.found) {
    removalAt = parseAdhesionDateTimeMs(removalEntry.value);
    removalAtRaw = formatAdhesionDateTimeInput(removalEntry.value);
    raw[ADHESION_REMOVAL_ALIASES[0]] = removalAtRaw || '';
  }

  const statusEntry = findRawAliasEntry(raw, ADHESION_STATUS_ALIASES);
  if (statusEntry.found) {
    status = normalizeAdhesionStatus(statusEntry.value);
    raw[ADHESION_STATUS_ALIASES[0]] = status || '';
  }

  const hasData =
    Number.isFinite(initialAt) ||
    Number.isFinite(removalAt) ||
    Boolean(initialAtRaw) ||
    Boolean(removalAtRaw) ||
    Boolean(status);

  if (!hasData) {
    delete driver.schedule;
    return;
  }

  driver.schedule = {
    initialAt: Number.isFinite(initialAt) ? initialAt : null,
    initialAtRaw: initialAtRaw || '',
    removalAt: Number.isFinite(removalAt) ? removalAt : null,
    removalAtRaw: removalAtRaw || '',
    status: status || '',
  };
}

function generateCampaignCode(db) {
  const used = new Set(
    (db.campaigns || [])
      .map(c => trim(c.campaignCode).toUpperCase())
      .filter(Boolean),
  );

  let attempt = 0;
  while (attempt < 1000) {
    const buf = crypto.randomBytes(CAMPAIGN_CODE_LENGTH);
    const code = Array.from(buf, (b) => CAMPAIGN_CODE_ALPHABET[b % CAMPAIGN_CODE_ALPHABET.length]).join('');
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    attempt += 1;
  }

  let fallback = `C${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  if (fallback.length < CAMPAIGN_CODE_LENGTH) {
    fallback = fallback.padEnd(CAMPAIGN_CODE_LENGTH, 'X');
  } else if (fallback.length > CAMPAIGN_CODE_LENGTH) {
    fallback = fallback.slice(0, CAMPAIGN_CODE_LENGTH);
  }
  while (used.has(fallback)) {
    fallback = `${fallback.slice(0, CAMPAIGN_CODE_LENGTH - 1)}${crypto.randomBytes(1)[0] % 10}`;
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

function summarizeCampaign(db, campaign) {
  ensureCampaignCode(db, campaign);
  if (typeof campaign.driverCooldownDays !== 'number') campaign.driverCooldownDays = 10;
  if (typeof campaign.graphicCooldownDays !== 'number') campaign.graphicCooldownDays = 10;
  if (!Number.isFinite(Number(campaign.kmMinimumPerDriver))) {
    campaign.kmMinimumPerDriver = DEFAULT_MIN_KM_PER_DRIVER;
  } else {
    campaign.kmMinimumPerDriver = Math.max(0, Math.round(Number(campaign.kmMinimumPerDriver)));
  }
  const drivers = db.drivers.filter(d => d.campaignId === campaign.id);
  const graphics = (db.graphics || []).filter(g => g.campaignId === campaign.id);
  const reviewItems = db.review.filter(r => r.campaignId === campaign.id);

  const counts = drivers.reduce((acc, driver) => {
    const key = driver.status || 'revisar';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  for (const status of STATUS) {
    if (!counts[status]) counts[status] = 0;
  }

  return {
    ...campaign,
    counts,
    driverCount: drivers.length,
    graphicCount: graphics.length,
    reviewCount: reviewItems.length,
    updatedAt: campaign.updatedAt || campaign.createdAt || Date.now(),
    sheetHeader: Array.isArray(campaign.sheetHeader) ? [...campaign.sheetHeader] : [],
    sheetGid: campaign.sheetGid ?? null,
    driverCooldownDays: campaign.driverCooldownDays ?? 10,
    graphicCooldownDays: campaign.graphicCooldownDays ?? 10,
    kmMinimumPerDriver: campaign.kmMinimumPerDriver,
    minKmPerDriver: campaign.kmMinimumPerDriver,
  };
}

function ensureSheetConfig(campaign) {
  if (!campaign.sheetId) {
    throw Object.assign(new Error('Campanha não possui sheetId configurado'), { status: 400 });
  }
  const sheetName = resolveSheetName(campaign.sheetName, 'Pagina1');
  campaign.sheetName = sheetName;
  return { sheetId: campaign.sheetId, sheetName };
}

function extractRowNumber(range) {
  if (!range) return 0;
  const [, segment = ''] = range.split('!');
  const match = segment.match(/([0-9]+)(?::[A-Z]*([0-9]+))?$/i);
  if (!match) return 0;
  const [, start, end] = match;
  return parseInt(end || start, 10);
}

function respondNotFound(res, message) {
  return res.status(404).json({ error: message });
}

function parseKmPeriods(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > MAX_KM_PERIODS) return null;
  return rounded;
}

function buildAppendValues(header, fieldsInput) {
  const normalized = {};
  Object.entries(fieldsInput || {}).forEach(([key, value]) => {
    normalized[key] = value;
    const lower = key.toLowerCase();
    if (!(lower in normalized)) normalized[lower] = value;
    const compact = lower.replace(/\s+/g, '');
    if (!(compact in normalized)) normalized[compact] = value;
  });

  return header.map(col => {
    const direct = normalized[col];
    if (direct !== undefined) return direct;
    const lower = col.toLowerCase();
    if (normalized[lower] !== undefined) return normalized[lower];
    const compact = lower.replace(/\s+/g, '');
    if (normalized[compact] !== undefined) return normalized[compact];
    return '';
  });
}
async function getEvidenceEntries(db, campaign, filter = {}) {
  let storageEntries = [];
  try {
    storageEntries = await listStorageEntriesByCampaign(campaign.id);
  } catch (err) {
    console.warn('[campaigns] storage entries listing error', err?.message || err);
  }
  const evidenceMap = await collectEvidenceByDriver(db, campaign.id, storageEntries);

  const drivers = db.drivers || [];
  const graphics = db.graphics || [];
  
  // Get all valid storage file IDs to check for orphaned evidence
  const validStorageIds = new Set(storageEntries.map(e => e.id));

  const list = [];
  evidenceMap.forEach(entries => {
    for (const item of entries) {
      if (filter.driverId !== undefined && String(item.driverId) !== String(filter.driverId)) continue;
      if (filter.graphicId !== undefined && String(item.graphicId || '') !== String(filter.graphicId)) continue;
      
      // EXPLICIT TYPE FILTERING: When filtering by driverId, only show driver uploads
      // When filtering by graphicId, only show graphic uploads
      if (filter.driverId !== undefined && item.type !== 'driver') continue;
      if (filter.graphicId !== undefined && item.type !== 'graphic') continue;
      
      // Skip evidence that references deleted storage files (orphaned URLs)
      if (item.url && /^\/api\/storage\/[a-f0-9]{24}$/i.test(item.url)) {
        const storageId = item.url.split('/').pop();
        if (!validStorageIds.has(storageId)) {
          console.log('[campaigns] Skipping orphaned evidence:', { id: item.id, url: item.url });
          continue; // Skip this orphaned evidence
        }
      }
      
      const entry = { ...item };
      const driver = drivers.find(d => d.id === entry.driverId);
      if (driver) entry.driver = { id: driver.id, name: driver.name };
      const graphic = graphics.find(g => g.id === entry.graphicId);
      if (graphic) entry.graphic = { id: graphic.id, name: graphic.name };
      list.push(entry);
    }
  });
  return list;
}

// ------------------------------------------
//  MERGE: API + DADOS LOCAIS
// ------------------------------------------

/**
 * Mescla campanha da API com dados locais (campaignCode, cooldown, etc.)
 */
function mergeCampaignWithLocal(apiCampaign, localCampaign, db) {
  const base = { ...apiCampaign };

  if (localCampaign) {
    // Preservar dados que só existem localmente
    if (localCampaign.campaignCode) base.campaignCode = localCampaign.campaignCode;
    if (typeof localCampaign.driverCooldownDays === 'number') base.driverCooldownDays = localCampaign.driverCooldownDays;
    if (typeof localCampaign.graphicCooldownDays === 'number') base.graphicCooldownDays = localCampaign.graphicCooldownDays;
    if (typeof localCampaign.kmMinimumPerDriver === 'number') base.kmMinimumPerDriver = localCampaign.kmMinimumPerDriver;
    if (localCampaign.sheetId) base.sheetId = localCampaign.sheetId;
    if (localCampaign.sheetName) base.sheetName = localCampaign.sheetName;
    if (localCampaign.driveFolderId) base.driveFolderId = localCampaign.driveFolderId;
    if (localCampaign.kmPeriods) base.kmPeriods = localCampaign.kmPeriods;
    if (Array.isArray(localCampaign.sheetHeader) && localCampaign.sheetHeader.length) {
      base.sheetHeader = localCampaign.sheetHeader;
    }
    // Preservar nome de cliente definido manualmente (sobrescreve o campo vazio do sync)
    if (localCampaign.client) base.client = localCampaign.client;
  }

  // Gerar campaignCode se não existir
  if (!base.campaignCode) {
    base.campaignCode = generateCampaignCode(db || { campaigns: [] });
    // Persistir local para não gerar toda vez
    if (localCampaign) {
      localCampaign.campaignCode = base.campaignCode;
      saveDB(db);
    } else if (db) {
      // Campanha vem da API sem entrada local — criar stub mínimo para persistência
      const stub = {
        id: base.id,
        name: base.name || '',
        campaignCode: base.campaignCode,
        status: base.status || 'ativa',
        createdAt: base.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      db.campaigns.push(stub);
      saveDB(db);
    }
  }

  // Calcular contagens a partir de dados disponíveis
  const drivers = (db?.drivers || []).filter(d => d.campaignId === base.id);
  const graphics = (db?.graphics || []).filter(g => g.campaignId === base.id);
  const reviewItems = (db?.review || []).filter(r => r.campaignId === base.id);

  const counts = {};
  for (const status of STATUS) counts[status] = 0;
  for (const d of drivers) {
    const key = d.status || 'revisar';
    counts[key] = (counts[key] || 0) + 1;
  }

  base.counts = counts;
  base.driverCount = drivers.length;
  base.graphicCount = graphics.length;
  base.reviewCount = reviewItems.length;

  return base;
}

function buildCampaignListItem(campaign, {
  localCampaign = null,
  driverStats = null,
  settings = null,
  reviewCount = 0,
} = {}) {
  const id = String(campaign?.id || campaign?._id || '').trim();
  const apiData = campaign?.apiData || {};
  const counts = {};
  for (const status of STATUS) counts[status] = 0;
  for (const [status, value] of Object.entries(driverStats?.counts || {})) {
    counts[status] = Math.max(0, Number(value) || 0);
  }

  const configuredTarget = Number(settings?.driverTarget);
  const localTarget = Number(localCampaign?.driverTarget);
  const driverTarget = configuredTarget > 0
    ? configuredTarget
    : (localTarget > 0 ? localTarget : 0);

  return {
    id,
    name: campaign?.name || localCampaign?.name || '',
    client: localCampaign?.client || campaign?.client || '',
    status: campaign?.status || localCampaign?.status || 'ativa',
    period: campaign?.period || localCampaign?.period || '',
    apiData: {
      city: apiData.city || localCampaign?.apiData?.city || '',
      state: apiData.state || localCampaign?.apiData?.state || '',
      metaKms: Number(apiData.metaKms ?? localCampaign?.apiData?.metaKms) || 0,
    },
    counts,
    driverCount: Math.max(0, Number(driverStats?.driverCount) || 0),
    reviewCount: Math.max(0, Number(reviewCount) || 0),
    driverTarget,
    createdAt: campaign?.createdAt || localCampaign?.createdAt || null,
    updatedAt: campaign?.updatedAt || localCampaign?.updatedAt || null,
  };
}

/**
 * Mescla motorista da API com dados locais (evidence, schedule, etc.)
 */
function mergeDriverWithLocal(apiDriver, localDriver) {
  const merged = { ...apiDriver };

  if (localDriver) {
    // Preservar dados de evidence review
    if (localDriver.evidenceReview) merged.evidenceReview = localDriver.evidenceReview;
    // Preservar schedule (adesivagem)
    if (localDriver.schedule) merged.schedule = localDriver.schedule;
    // Preservar status local se foi editado manualmente
    if (localDriver._statusOverride) merged.status = localDriver.status;
    // Preservar raw (spreadsheet data) se existir
    if (localDriver.raw && Object.keys(localDriver.raw).length) merged.raw = localDriver.raw;
  }

  return merged;
}

// Protege todas as rotas com autenticação admin
router.use(authenticateAdmin);

router.use((req, res, next) => {
  if (process.env.DEBUG_ROUTES === '1') {
    console.log(`[campaigns] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// ------------------------------------------
//  ROTAS DE SYNC (escrita via script externo)
// ------------------------------------------

/**
 * GET /api/campaigns/sync-history
 * Retorna últimas sincronizações.
 */
router.get('/sync-history', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const history = await getSyncHistory(limit);
    res.json(history);
  } catch (err) {
    console.error('[campaigns] sync-history error:', err?.message);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

/**
 * POST /api/campaigns/refresh
 * DESABILITADO — sync agora é feito por script externo.
 * Mantido para compatibilidade, retorna erro informativo.
 */
router.post('/refresh', async (req, res) => {
  res.status(410).json({
    error: 'Sync direto desabilitado. Use o script externo sync-oddrive.ps1 ou POST /api/campaigns/sync-push.',
  });
});

/**
 * POST /api/campaigns/sync-push
 * Recebe dados brutos da API OdDrive enviados por um script local (PS/Node).
 * O script chama a API OdDrive do computador do usuário e envia os dados crus aqui.
 * O backend normaliza e grava no MongoDB.
 *
 * Body: { campaigns: [...raw API campaigns], drivers: [...raw API drivers] }
 */
router.post('/sync-push', jsonParser({ limit: '50mb' }), async (req, res) => {
  try {
    const { campaigns, drivers } = req.body || {};
    if (!Array.isArray(campaigns) && !Array.isArray(drivers)) {
      return res.status(400).json({ error: 'Body deve conter "campaigns" (array) e/ou "drivers" (array)' });
    }

    const { syncPush } = await import('../services/oddrive-sync.js');
    const result = await syncPush({
      campaigns: Array.isArray(campaigns) ? campaigns : [],
      drivers: Array.isArray(drivers) ? drivers : [],
    });

    await logAudit(req, 'campaigns:sync-push', {
      entityType: 'system',
      data: { campaigns: result.campaigns, drivers: result.drivers },
    });

    const status = result.partial ? 207 : 200;
    res.status(status).json(result);
  } catch (err) {
    console.error('[campaigns] sync-push error:', err?.message || err);
    res.status(500).json({ error: 'Falha ao processar sync-push.' });
  }
});

/**
 * GET /api/campaigns/sync-status
 * Retorna status da última sincronização e contagens no MongoDB.
 */
router.get('/sync-status', async (req, res) => {
  try {
    const status = await getSyncStatus();
    res.json(status);
  } catch (err) {
    console.error('[campaigns] sync-status error:', err?.message || err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

let mirrorRunning = false;
router.post('/mirror-run', async (req, res) => {
  if (mirrorRunning) {
    return res.status(409).json({ error: 'Mirror já em execução. Aguarde o ciclo atual.' });
  }
  mirrorRunning = true;
  try {
    const dryRun = req.body?.dryRun === true;
    const { runMirrorOnce } = await import('../services/oddrive-mirror.js');
    const result = await runMirrorOnce({ dryRun });
    await logAudit(req, 'campaigns:mirror-run', {
      entityType: 'system',
      data: { dryRun, campaigns: result.campaigns, drivers: result.drivers, prunedDrivers: result.prunedDrivers },
    });
    res.json(result);
  } catch (err) {
    console.error('[campaigns] mirror-run error:', err?.message || err);
    res.status(500).json({ error: 'Falha ao executar mirror.' });
  } finally {
    mirrorRunning = false;
  }
});

/**
 * GET /api/campaigns/cache-status
 * Retorna status do cache da API (alias de sync-status para compatibilidade).
 */
router.get('/cache-status', async (req, res) => {
  try {
    const status = await getSyncStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

/**
 * GET /api/campaigns
 * Lista campanhas — fonte: MongoDB (populado pelo sync) + dados locais mesclados.
 */
router.get('/', async (req, res) => {
  try {
    // Lê campanhas do MongoDB (populado pelo sync externo)
    let apiCampaigns = await fetchCampaigns();
    const db = loadDB();

    // Buscar todos os motoristas da API para contar por campanha
    let apiDrivers = [];
    try {
      apiDrivers = await fetchDrivers();
    } catch (driverErr) {
      console.warn('[campaigns] GET / falha ao buscar motoristas da API para contagem:', driverErr?.message);
    }

    // Agrupar motoristas da API por campaignId
    const driversByCampaign = new Map();
    for (const driver of apiDrivers) {
      if (!driver.campaignId) continue;
      if (!driversByCampaign.has(driver.campaignId)) driversByCampaign.set(driver.campaignId, []);
      driversByCampaign.get(driver.campaignId).push(driver);
    }

    // Buscar driverTarget de todas as campanhas (campaign_settings no MongoDB)
    let settingsMap = new Map();
    try {
      const allIds = apiCampaigns.map(c => c.id || c._id).filter(Boolean);
      settingsMap = await getCampaignSettingsByIds(allIds);
    } catch (settingsErr) {
      console.warn('[campaigns] GET / falha ao buscar campaign_settings:', settingsErr?.message);
    }

    // Mesclar dados locais (campaignCode, cooldown, graphics count) sobre dados da API
    const merged = apiCampaigns.map(apiCampaign => {
      const local = db.campaigns.find(c => c.id === apiCampaign.id);
      const result = mergeCampaignWithLocal(apiCampaign, local, db);

      // Mesclar driverTarget do campaign_settings (MongoDB) — tem prioridade sobre qualquer valor local
      const settings = settingsMap.get(String(result.id || result._id)) || {};
      if (typeof settings.driverTarget === 'number' && settings.driverTarget > 0) {
        result.driverTarget = settings.driverTarget;
      } else if (typeof local?.driverTarget === 'number' && local.driverTarget > 0) {
        result.driverTarget = local.driverTarget;
      }

      // Sobrescrever contagens com dados dos motoristas da API (se disponíveis)
      const campaignApiDrivers = driversByCampaign.get(apiCampaign.id) || [];
      if (campaignApiDrivers.length > 0) {
        const counts = {};
        for (const status of STATUS) counts[status] = 0;
        for (const d of campaignApiDrivers) {
          const key = d.status || 'cadastrando';
          counts[key] = (counts[key] || 0) + 1;
        }
        result.counts = counts;
        result.driverCount = campaignApiDrivers.length;
      }

      return result;
    });

    res.json(merged);
  } catch (err) {
    console.error('[campaigns] GET / API error, falling back to local:', err?.message);
    // Fallback: se a API falhar, retorna dados locais
    const db = loadDB();
    res.json(db.campaigns.map(c => summarizeCampaign(db, c)));
  }
});

/**
 * GET /api/campaigns/summary
 * Payload minimo para a listagem do Gerenciador de Campanhas. As contagens
 * sao agregadas no MongoDB e nenhum documento completo de motorista e enviado
 * para o processo Node durante a navegacao da lista.
 */
router.get('/summary', async (req, res) => {
  try {
    const [apiCampaigns, driverStatsByCampaign] = await Promise.all([
      fetchCampaignSummaries(),
      fetchCampaignDriverStats(),
    ]);
    const db = loadDB();
    const localCampaignsById = new Map(
      (db.campaigns || []).map(campaign => [String(campaign?.id || '').trim(), campaign]),
    );
    const reviewCountsByCampaign = new Map();
    for (const item of db.review || []) {
      const campaignId = String(item?.campaignId || '').trim();
      if (!campaignId) continue;
      reviewCountsByCampaign.set(campaignId, (reviewCountsByCampaign.get(campaignId) || 0) + 1);
    }

    const ids = apiCampaigns
      .map(campaign => String(campaign?.id || campaign?._id || '').trim())
      .filter(Boolean);
    let settingsByCampaign = new Map();
    try {
      settingsByCampaign = await getCampaignSettingsByIds(ids);
    } catch (settingsErr) {
      console.warn('[campaigns] GET /summary falha ao buscar campaign_settings:', settingsErr?.message);
    }

    const items = apiCampaigns.map(campaign => {
      const id = String(campaign?.id || campaign?._id || '').trim();
      return buildCampaignListItem(campaign, {
        localCampaign: localCampaignsById.get(id) || null,
        driverStats: driverStatsByCampaign.get(id) || null,
        settings: settingsByCampaign.get(id) || null,
        reviewCount: reviewCountsByCampaign.get(id) || 0,
      });
    });

    res.json(items);
  } catch (err) {
    console.error('[campaigns] GET /summary error, falling back to local:', err?.message);
    const db = loadDB();
    const localStats = new Map();
    for (const driver of db.drivers || []) {
      const campaignId = String(driver?.campaignId || '').trim();
      if (!campaignId) continue;
      const current = localStats.get(campaignId) || { counts: {}, driverCount: 0 };
      const status = String(driver?.status || 'cadastrando').trim() || 'cadastrando';
      current.counts[status] = (current.counts[status] || 0) + 1;
      current.driverCount += 1;
      localStats.set(campaignId, current);
    }
    const localReviewCounts = new Map();
    for (const item of db.review || []) {
      const campaignId = String(item?.campaignId || '').trim();
      if (!campaignId) continue;
      localReviewCounts.set(campaignId, (localReviewCounts.get(campaignId) || 0) + 1);
    }
    res.json((db.campaigns || []).map(campaign => buildCampaignListItem(campaign, {
      localCampaign: campaign,
      driverStats: localStats.get(String(campaign?.id || '').trim()) || null,
      settings: null,
      reviewCount: localReviewCounts.get(String(campaign?.id || '').trim()) || 0,
    })));
  }
});

/**
 * GET /api/campaigns/:id
 * Detalhe da campanha — fonte: MongoDB (sync) + dados locais.
 */
router.get('/:id', async (req, res) => {
  try {
    const apiCampaign = await fetchCampaignById(req.params.id);

    if (!apiCampaign) {
      // Fallback: tentar no local (campanhas que só existem localmente)
      const db = loadDB();
      const localCampaign = db.campaigns.find(c => c.id === req.params.id);
      if (!localCampaign) return respondNotFound(res, 'Campanha não encontrada');
      // Retornar no formato antigo (compatibilidade)
      const payload = summarizeCampaign(db, localCampaign);
      let storageEntries = [];
      try { storageEntries = await listStorageEntriesByCampaign(localCampaign.id); } catch (_) {}
      const evidenceByDriver = await collectEvidenceByDriver(db, localCampaign.id, storageEntries);
      const localCampaignDrivers = await filterDetachedCampaignDrivers(
        localCampaign.id,
        db.drivers.filter(d => d.campaignId === localCampaign.id),
      );
      payload.drivers = localCampaignDrivers
        .map(driver => cloneDriverForPayload(driver, evidenceByDriver.get(String(driver.id)) || []));
      payload.review = db.review.filter(r => r.campaignId === localCampaign.id);
      payload.graphics = (db.graphics || []).filter(g => g.campaignId === localCampaign.id);
      return res.json(payload);
    }

    // Campanha encontrada na API — mesclar com local
    const db = loadDB();
    let local = db.campaigns.find(c => c.id === apiCampaign.id);

    // Se não há código local, tentar restaurar do MongoDB (campaigns collection) para manter o código estável
    if (!local?.campaignCode) {
      try {
        const existing = await getCampaignRecordById(apiCampaign.id);
        if (existing?.campaignCode) {
          if (local) {
            local.campaignCode = existing.campaignCode;
          } else {
            local = { id: apiCampaign.id, name: apiCampaign.name || '', campaignCode: existing.campaignCode, status: existing.status || 'ativa', createdAt: existing.createdAt || Date.now(), updatedAt: Date.now() };
            db.campaigns.push(local);
          }
          saveDB(db);
        }
      } catch (err) {
        console.warn('[campaigns] Falha ao restaurar campaignCode do Mongo', err?.message);
      }
    }

    const hadCode = !!(local?.campaignCode);
    const payload = mergeCampaignWithLocal(apiCampaign, local, db);
    // Persistir campaignCode no MongoDB (campaigns collection) se foi gerado agora
    if (!hadCode && payload.campaignCode) {
      upsertCampaignRecord(payload).catch(err =>
        console.warn('[campaigns] Falha ao persistir campaignCode no Mongo', err?.message),
      );
    }

    // Buscar motoristas, storage e settings em paralelo
    const periodStart = apiCampaign.apiData?.periodStart;
    const periodEnd = apiCampaign.apiData?.periodEnd;

    const [driversResult, storageResult, settingsResult] = await Promise.allSettled([
      (periodStart && periodEnd)
        ? fetchDriversByCampaignPeriod(apiCampaign.id, periodStart, periodEnd)
        : fetchDriversByCampaign(apiCampaign.id),
      listStorageEntriesByCampaign(apiCampaign.id),
      getCampaignSettingsByIds([apiCampaign.id]),
    ]);

    const apiDrivers = driversResult.status === 'fulfilled' ? driversResult.value : [];
    const storageEntries = storageResult.status === 'fulfilled' ? storageResult.value : [];
    if (storageResult.status === 'rejected') console.warn('[campaigns] storage entries listing error', storageResult.reason?.message);
    const settingsMap = settingsResult.status === 'fulfilled' ? settingsResult.value : new Map();
    if (settingsResult.status === 'rejected') console.warn('[campaigns] GET /:id falha ao buscar campaign_settings:', settingsResult.reason?.message);

    // Mesclar evidence local nos motoristas da API
    const evidenceByDriver = await collectEvidenceByDriver(db, apiCampaign.id, storageEntries);

    payload.drivers = apiDrivers.map(apiDriver => {
      // Mesclar dados locais do motorista (evidence, schedule, etc.)
      const localDriver = db.drivers.find(d => d.id === apiDriver.id);
      const merged = mergeDriverWithLocal(apiDriver, localDriver);
      return cloneDriverForPayload(merged, evidenceByDriver.get(String(merged.id)) || []);
    });

    // Include locally-added drivers that don't exist in the API (added via workspace)
    const apiDriverIds = new Set(apiDrivers.map(d => d.id));
    const localOnlyCandidates = db.drivers.filter(d =>
      d.campaignId === apiCampaign.id &&
      !apiDriverIds.has(d.id)
    );
    const localOnlyDrivers = await filterDetachedCampaignDrivers(
      apiCampaign.id,
      localOnlyCandidates,
    );
    for (const localDriver of localOnlyDrivers) {
      payload.drivers.push(
        cloneDriverForPayload(localDriver, evidenceByDriver.get(String(localDriver.id)) || [])
      );
    }

    payload.review = db.review.filter(r => r.campaignId === apiCampaign.id);
    payload.graphics = (db.graphics || []).filter(g => g.campaignId === apiCampaign.id);

    // Injetar driverTarget do campaign_settings (MongoDB)
    const settings = settingsMap.get(String(apiCampaign.id)) || {};
    if (typeof settings.driverTarget === 'number' && settings.driverTarget > 0) {
      payload.driverTarget = settings.driverTarget;
    }

    res.json(payload);
  } catch (err) {
    console.error('[campaigns] GET /:id API error, falling back to local:', err?.message);
    // Fallback para dados locais
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');
    const payload = summarizeCampaign(db, campaign);
    let storageEntries = [];
    try { storageEntries = await listStorageEntriesByCampaign(campaign.id); } catch (_) {}
    const evidenceByDriver = await collectEvidenceByDriver(db, campaign.id, storageEntries);
    const fallbackDrivers = await filterDetachedCampaignDrivers(
      campaign.id,
      db.drivers.filter(d => d.campaignId === campaign.id),
    );
    payload.drivers = fallbackDrivers
      .map(driver => cloneDriverForPayload(driver, evidenceByDriver.get(String(driver.id)) || []));
    payload.review = db.review.filter(r => r.campaignId === campaign.id);
    payload.graphics = (db.graphics || []).filter(g => g.campaignId === campaign.id);
    res.json(payload);
  }
});

// Helper: busca campanha apenas no MongoDB (para campanhas que não estão no db.json local)
async function resolveCampaignFromApi(id) {
  const apiCampaign = await fetchCampaignById(id).catch(() => null);
  if (!apiCampaign) return null;
  return { id: apiCampaign.id, name: apiCampaign.name, sheetId: null, sheetHeader: [] };
}

// Helper: resolve campaign by id checking local db first, then MongoDB
async function resolveCampaign(id) {
  const db = loadDB();
  const local = db.campaigns.find(c => c.id === id);
  if (local) return local;
  // Campanha vem do MongoDB (API sync) — criar stub mínimo para compatibilidade
  const apiCampaign = await fetchCampaignById(id).catch(() => null);
  if (!apiCampaign) return null;
  return { id: apiCampaign.id, name: apiCampaign.name, sheetId: null, sheetHeader: [] };
}

router.get('/:id/graphics', async (req, res) => {
  const campaign = await resolveCampaign(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');
  const db = loadDB();
  res.json((db.graphics || []).filter(g => g.campaignId === campaign.id));
});

router.post('/:id/graphics', async (req, res) => {
  const db = loadDB();
  const campaign = await resolveCampaign(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const {
    name,
    email = '',
    phone = '',
    responsible1Name = '',
    responsible1Phone = '',
    responsible2Name = '',
    responsible2Phone = '',
    notes = '',
  } = req.body || {};

  if (!trim(name)) {
    return res.status(400).json({ error: 'Nome da Gráfica obrigatório' });
  }
  if (!trim(responsible1Name)) {
    return res.status(400).json({ error: 'Nome do responsavel 1 obrigatorio' });
  }

  const now = Date.now();
  const graphic = {
    id: nanoid(),
    campaignId: campaign.id,
    name: trim(name),
    email: trim(email),
    phone: trim(phone),
    phoneDigits: digitsOnly(phone),
    responsible1Name: trim(responsible1Name),
    responsible1Phone: trim(responsible1Phone),
    responsible1PhoneDigits: digitsOnly(responsible1Phone),
    responsible2Name: trim(responsible2Name),
    responsible2Phone: trim(responsible2Phone),
    responsible2PhoneDigits: digitsOnly(responsible2Phone),
    notes: trim(notes),
    createdAt: now,
    updatedAt: now,
  };

  db.graphics = Array.isArray(db.graphics) ? db.graphics : [];
  db.graphics.push(graphic);
  campaign.updatedAt = now;
  saveDB(db);

  try {
    await ensureCampaignGraphicsTable(campaign);
    await upsertCampaignGraphicsRows(campaign, [graphic]);
  } catch (err) {
    console.warn('[campaigns] db grafica create', err?.message || err);
  }

  await logAudit(req, 'graphic:create', {
    entityType: 'graphic',
    entityId: graphic.id,
    data: { campaignId: campaign.id, campaignName: campaign.name, graphicName: graphic.name },
  });

  res.status(201).json({ graphic });
});

router.patch('/:id/graphics/:graphicId', async (req, res) => {
  const db = loadDB();
  const campaign = await resolveCampaign(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  db.graphics = Array.isArray(db.graphics) ? db.graphics : [];
  const graphic = db.graphics.find(g => g.id === req.params.graphicId && g.campaignId === campaign.id);
  if (!graphic) return respondNotFound(res, 'Gráfica não encontrada');

  const {
    name,
    email,
    phone,
    responsible1Name,
    responsible1Phone,
    responsible2Name,
    responsible2Phone,
    notes,
  } = req.body || {};

  if (name !== undefined && !trim(name)) {
    return res.status(400).json({ error: 'Nome da Gráfica não pode ser vazio' });
  }
  if (responsible1Name !== undefined && !trim(responsible1Name)) {
    return res.status(400).json({ error: 'Nome do responsável 1 não pode ser vazio' });
  }

  if (name !== undefined) graphic.name = trim(name);
  if (email !== undefined) graphic.email = trim(email);
  if (phone !== undefined) {
    graphic.phone = trim(phone);
    graphic.phoneDigits = digitsOnly(phone);
  }
  if (responsible1Name !== undefined) graphic.responsible1Name = trim(responsible1Name);
  if (responsible1Phone !== undefined) {
    graphic.responsible1Phone = trim(responsible1Phone);
    graphic.responsible1PhoneDigits = digitsOnly(responsible1Phone);
  }
  if (responsible2Name !== undefined) graphic.responsible2Name = trim(responsible2Name);
  if (responsible2Phone !== undefined) {
    graphic.responsible2Phone = trim(responsible2Phone);
    graphic.responsible2PhoneDigits = digitsOnly(responsible2Phone);
  }
  if (notes !== undefined) graphic.notes = trim(notes);

  graphic.updatedAt = Date.now();
  campaign.updatedAt = graphic.updatedAt;
  saveDB(db);

  try {
    await ensureCampaignGraphicsTable(campaign);
    await upsertCampaignGraphicsRows(campaign, [graphic]);
  } catch (err) {
    console.warn('[campaigns] db grafica update', err?.message || err);
  }

  await logAudit(req, 'graphic:update', {
    entityType: 'graphic',
    entityId: graphic.id,
    data: { campaignId: campaign.id, campaignName: campaign.name, graphicName: graphic.name },
  });

  res.json({ graphic });
});

router.delete('/:id/graphics/:graphicId', async (req, res) => {
  const db = loadDB();
  const campaign = await resolveCampaign(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  db.graphics = Array.isArray(db.graphics) ? db.graphics : [];
  const index = db.graphics.findIndex(g => g.id === req.params.graphicId && g.campaignId === campaign.id);
  if (index === -1) return respondNotFound(res, 'Gráfica não encontrada');

  const [graphic] = db.graphics.splice(index, 1);
  campaign.updatedAt = Date.now();
  saveDB(db);

  try {
    await deleteGraphicRow(campaign, graphic.id);
  } catch (err) {
    console.warn('[campaigns] db grafica delete', err?.message || err);
  }

  await logAudit(req, 'graphic:delete', {
    entityType: 'graphic',
    entityId: graphic.id,
    data: { campaignId: campaign.id, campaignName: campaign.name, graphicName: graphic.name },
  });

  res.status(204).end();
});

// [DEPRECATED] Criar campanha manualmente — campanhas agora vêm da API OdDrive.
// Mantido para compatibilidade; retorna 410 a menos que ALLOW_LEGACY_CRUD=1.
router.post('/', async (req, res) => {
  if (process.env.ALLOW_LEGACY_CRUD !== '1') {
    return res.status(410).json({ error: 'Rota descontinuada. Campanhas são gerenciadas pela API OdDrive.' });
  }
  const { name, client, period } = req.body || {};
  const trimmedName = trim(name);
  if (!trimmedName) {
    return res.status(400).json({ error: 'Nome obrigatorio' });
  }

  const db = loadDB();
  const now = Date.now();
  const campaign = {
    id: nanoid(),
    name: trimmedName,
    client: client || '',
    period: period || '',
    status: 'ativa',
    sheetId: null,
    sheetName: null,
    driverCooldownDays: 10,
    graphicCooldownDays: 10,
    kmMinimumPerDriver: DEFAULT_MIN_KM_PER_DRIVER,
    sheetHeader: [
      'Nome',
      'Cidade',
      'Status',
      'PIX',
      'CPF',
      'Email',
      'Numero',
      'Placa',
      'Modelo',
      'Convite',
      'Data de Instalacao',
      'Horario Plotagem',
      'Adesivagem Inicial',
      'Retirada Adesivo',
      'Status Adesivagem',
      'Observacoes',
    ],
    driveFolderId: null,
    campaignCode: generateCampaignCode(db),
    createdAt: now,
    updatedAt: now,
  };

  db.campaigns.push(campaign);
  saveDB(db);

  try {
    await upsertCampaignRecord(campaign);
  } catch (err) {
    console.warn('[campaigns] db upsert campaign', err?.message || err);
  }

  await logAudit(req, 'campaign:create', {
    entityType: 'campaign',
    entityId: campaign.id,
    data: { campaignName: campaign.name, client: campaign.client, period: campaign.period },
  });

  res.status(201).json({ id: campaign.id, campaignCode: campaign.campaignCode });
});

router.post('/:id/sync', async (req, res) => {
  const { sheetId: overrideSheetId, sheetName, name, client, period } = req.body || {};
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const sheetId = trim(overrideSheetId || campaign.sheetId || '');
  if (!sheetId) {
    return res.status(400).json({ error: 'Campanha não possui sheetId configurado' });
  }

  try {
    const resolvedSheetName = resolveSheetName(sheetName || campaign.sheetName || 'Pagina1', 'Pagina1');

    const rows = await readSheetByRange(sheetId, `${resolvedSheetName}!A:Z`);
    const header = await readSheetHeader(sheetId, resolvedSheetName);
    const sheetGid = await getSheetId(sheetId, resolvedSheetName);
    const now = Date.now();

    const previousDrivers = db.drivers.filter(d => d.campaignId === campaign.id);
    const { drivers, counts, imported, reviewEntries } = buildDriversFromRows(rows, {
      campaignId: campaign.id,
      now,
      previousDrivers,
    });

    db.drivers = db.drivers.filter(d => d.campaignId !== campaign.id);
    db.drivers.push(...drivers);

    db.review = db.review.filter(r => !(r.campaignId === campaign.id && r.type === 'STATUS_INVALIDO'));
    for (const entry of reviewEntries) {
      db.review.push(entry);
    }

    campaign.sheetId = sheetId;
    campaign.sheetName = resolvedSheetName;
    campaign.sheetHeader = header;
    campaign.sheetGid = sheetGid;
    if (typeof name === 'string' && trim(name)) campaign.name = trim(name);
    if (typeof client === 'string') campaign.client = client;
    if (typeof period === 'string') campaign.period = period;
    campaign.updatedAt = now;
    ensureCampaignCode(db, campaign);

    if (Array.isArray(campaign.kmSheetHeader) && campaign.kmSheetHeader.length) {
      try {
        const mapping = detectKmColumns(campaign.kmSheetHeader);
        campaign.kmColumns = mapping;
        if (mapping?.periodCount) {
          const parsed = parseKmPeriods(mapping.periodCount);
          if (parsed) campaign.kmPeriods = parsed;
        }
      } catch (err) {
        console.warn('[campaigns] detectKmColumns', err?.message || err);
      }
    }

    saveDB(db);

    res.json({
      campaign: summarizeCampaign(db, campaign),
      imported,
      review: reviewEntries.length,
      counts,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: safeErrorMessage(err, 'Falha ao sincronizar campanha') });
  }
});

// [DEPRECATED] Excluir campanha — campanhas agora vêm da API OdDrive.
router.delete('/:id', async (req, res) => {
  if (process.env.ALLOW_LEGACY_CRUD !== '1') {
    return res.status(410).json({ error: 'Rota descontinuada. Campanhas são gerenciadas pela API OdDrive.' });
  }
  const db = loadDB();
  const index = db.campaigns.findIndex(c => c.id === req.params.id);
  if (index === -1) return respondNotFound(res, 'Campanha não encontrada');
  const [campaign] = db.campaigns.splice(index, 1);

  db.drivers = db.drivers.filter(d => d.campaignId !== campaign.id);
  db.review = db.review.filter(r => r.campaignId !== campaign.id);
  db.graphics = (db.graphics || []).filter(g => g.campaignId !== campaign.id);
  db.evidence = (db.evidence || []).filter(e => e.campaignId !== campaign.id);

  saveDB(db);

  await logAudit(req, 'campaign:delete', {
    entityType: 'campaign',
    entityId: campaign.id,
    data: { campaignName: campaign.name },
  });

  try {
    await deleteMastersByCampaign(campaign);
  } catch (err) {
    console.warn('[campaigns] db delete masters', err?.message || err);
  }

  try {
    await deleteAllCampaignData(campaign.id);
  } catch (err) {
    console.warn('[campaigns] MongoDB delete all campaign data', err?.message || err);
  }

  res.status(204).end();
});
// Adicionar motorista manualmente à campanha (salva no MongoDB + planilha se configurada).
router.post('/:id/drivers', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  let sheetId = null;
  let sheetName = null;
  let kmSheetId;
  let kmSheetName;
  let appendedRowNumber;
  let appendedKmRowNumber;

  try {
    const fieldsInput = req.body?.fields && typeof req.body.fields === 'object'
      ? req.body.fields
      : req.body;
    if (!fieldsInput || typeof fieldsInput !== 'object') {
      return res.status(400).json({ error: 'Payload invalido' });
    }

    const now = Date.now();
    const nameValue = trim(
      fieldsInput.Nome ??
        fieldsInput.nome ??
        fieldsInput.name ??
        '',
    );
    if (!nameValue) {
      throw Object.assign(new Error('Campo Nome obrigatorio'), { status: 400 });
    }

    const trimmedSheetId = trim(campaign.sheetId || '');
    const hasSheetConfig = Boolean(trimmedSheetId);

    let header = [];
    if (hasSheetConfig) {
      ({ sheetId, sheetName } = ensureSheetConfig(campaign));
      header = Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length
        ? campaign.sheetHeader
        : null;
      if (!header) {
        header = await readSheetHeader(sheetId, sheetName);
        campaign.sheetHeader = header;
        campaign.sheetGid = campaign.sheetGid ?? (await getSheetId(sheetId, sheetName));
      }
    } else {
      header =
        (Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length
          ? campaign.sheetHeader
          : null) ||
        Object.keys(fieldsInput || {}).filter(Boolean);
      if (!header.length) header = [...DEFAULT_DRIVER_COLUMNS];
      campaign.sheetHeader = header;
    }

    const values = buildAppendValues(header, fieldsInput);

    if (hasSheetConfig) {
      const updates = await appendSheetRow(sheetId, sheetName, values);
      appendedRowNumber = extractRowNumber(updates?.updatedRange) || undefined;
    }

    const raw = Object.fromEntries(header.map((col, idx) => [col, values[idx] ?? '']));

    const driver = {
      id: nanoid(),
      campaignId: campaign.id,
      name: nameValue,
      nameKey: normalizeName(nameValue),
      city:
        fieldsInput.Cidade ??
        fieldsInput.cidade ??
        fieldsInput.City ??
        fieldsInput.city ??
        raw.Cidade ??
        '',
      pix:
        fieldsInput.PIX ??
        fieldsInput.Pix ??
        fieldsInput.pix ??
        raw.PIX ??
        '',
      statusRaw:
        fieldsInput.Status ??
        fieldsInput.status ??
        fieldsInput.STATUS ??
        raw.Status ??
        '',
      status: normalizeStatus(
        fieldsInput.Status ??
          fieldsInput.status ??
          fieldsInput.STATUS ??
          raw.Status ??
          '',
      ),
      phone:
        fieldsInput['Número'] ??
        fieldsInput['Numero'] ??
        fieldsInput.numero ??
        fieldsInput.telefone ??
        fieldsInput.Telefone ??
        fieldsInput.whatsapp ??
        raw['Numero_dummy_skip'] ??
        raw.Numero ??
        '',
      cpf:
        fieldsInput.CPF ??
        fieldsInput.cpf ??
        raw.CPF ??
        '',
      email:
        fieldsInput.Email ??
        fieldsInput.email ??
        fieldsInput['E-mail'] ??
        raw.Email ??
        '',
      plate:
        fieldsInput.Placa ??
        fieldsInput.placa ??
        raw.Placa ??
        '',
      model:
        fieldsInput.Modelo ??
        fieldsInput.modelo ??
        raw.Modelo ??
        '',
      rowNumber: appendedRowNumber,
      raw,
      createdAt: now,
      updatedAt: now,
      _origin: 'ADMIN',
    };

    applyDriverAdhesionScheduleFromRaw(driver, raw);

    applyDriverKmSummary(driver, {
      initialKm: parseKmNumber(
        fieldsInput['KM INICIAL'] ??
        fieldsInput['Odometro inicial'] ??
        fieldsInput['ODOMETRO INICIAL'],
      ),
      currentKm: parseKmNumber(
        fieldsInput['ODOMETRO ATUAL'] ??
        fieldsInput['Odometro atual'] ??
        fieldsInput['KM TOTAL'] ??
        fieldsInput['KM ACUMULADO'],
      ),
      source: 'admin-create',
      updatedAt: now,
      syncTotalKmRodado: true,
    });

    applyCanonicalRaw(driver);

    if (hasSheetConfig && driver.rowNumber) {
      const rowValues = buildSheetRowValues(header, driver);
      await updateSheetRow(sheetId, sheetName, driver.rowNumber, rowValues);
    }

    if (
      campaign.kmSheetId &&
      campaign.kmSheetName &&
      Array.isArray(campaign.kmSheetHeader) &&
      campaign.kmSheetHeader.length
    ) {
      kmSheetId = campaign.kmSheetId;
      kmSheetName = campaign.kmSheetName;
      const kmHeader = campaign.kmSheetHeader;
      let kmValues = [];
      if (campaign.kmColumns && typeof campaign.kmColumns === 'object') {
        kmValues = new Array(kmHeader.length).fill('');
        const { nameColumn, driverIdColumn } = campaign.kmColumns;
        if (nameColumn?.index >= 0 && nameColumn.index < kmHeader.length) {
          kmValues[nameColumn.index] = driver.name;
        }
        if (driverIdColumn?.index >= 0 && driverIdColumn.index < kmHeader.length) {
          kmValues[driverIdColumn.index] = driver.id;
        }
      } else {
        kmValues = kmHeader.map(col => {
          const upper = String(col || '').toUpperCase();
          if (upper.includes('NOME') || upper.includes('NAME')) return driver.name;
          if (upper.includes('DRIVER') || upper.includes('MOTORISTA') || upper.includes('ID')) return driver.id;
          return '';
        });
      }

      const kmUpdates = await appendSheetRow(kmSheetId, kmSheetName, kmValues);
      appendedKmRowNumber = extractRowNumber(kmUpdates?.updatedRange) || undefined;

      driver.km = driver.km || {};
      if (appendedKmRowNumber) driver.km.rowNumber = appendedKmRowNumber;
      driver.km.raw = Object.fromEntries(
        kmHeader.map((col, idx) => [col, kmValues[idx] ?? '']),
      );
    }

    db.drivers.push(driver);
    campaign.updatedAt = now;
    saveDB(db);

    try {
      await upsertDriverRecord(driver);
    } catch (err) {
      console.warn('[campaigns] db upsert driver', err?.message || err);
    }
    try {
      await upsertMasterRecord(campaign, driver);
    } catch (err) {
      console.warn('[campaigns] db upsert master', err?.message || err);
    }

    res.status(201).json({
      driver,
      campaign: summarizeCampaign(db, campaign),
    });

    await logAudit(req, 'driver:create', {
      entityType: 'driver',
      entityId: driver.id,
      data: { campaignId: campaign.id, campaignName: campaign.name, driverName: driver.name },
    });
  } catch (err) {
    if (sheetId && sheetName && appendedRowNumber) {
      try {
        await deleteSheetRow(sheetId, sheetName, appendedRowNumber);
      } catch (cleanupErr) {
        console.warn('[campaigns] cleanup sheet row failed', cleanupErr?.message || cleanupErr);
      }
    }
    if (kmSheetId && kmSheetName && appendedKmRowNumber) {
      try {
        await deleteSheetRow(kmSheetId, kmSheetName, appendedKmRowNumber);
      } catch (cleanupErr) {
        console.warn('[campaigns] cleanup km row failed', cleanupErr?.message || cleanupErr);
      }
    }
    const status = err.status || 500;
    res.status(status).json({ error: safeErrorMessage(err, 'Falha ao adicionar motorista') });
  }
});

// Desvincula o motorista da campanha sem apagar cadastro, evidencias ou historico.
router.delete('/:id/drivers/:driverId', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  try {
    const driverId = String(req.params.driverId || '').trim();
    let driver = db.drivers.find(
      item => String(item.id) === driverId && item.campaignId === campaign.id,
    );

    if (!driver) {
      const campaignDrivers = await fetchDriversByCampaign(campaign.id);
      driver = campaignDrivers.find(item => String(item.id) === driverId) || null;
    }

    const driverCampaignId = String(
      driver?.campaignData?.driverCampaignId || driver?.driverCampaignId || '',
    ).trim();
    const alreadyDetached = await isCampaignDriverDetached(
      campaign.id,
      driverId,
      driverCampaignId,
    );

    if (!driver && !alreadyDetached) {
      return respondNotFound(res, 'Motorista não encontrado nesta campanha');
    }

    if (!alreadyDetached) {
      await detachCampaignDriver({
        campaignId: campaign.id,
        driverId,
        driverCampaignId,
        campaignName: campaign.name,
        driverName: driver?.name || '',
        detachedBy: req.adminUser,
      });
    }

    const localDriver = db.drivers.find(item =>
      String(item.id) === driverId && item.campaignId === campaign.id
    );
    if (localDriver) {
      localDriver.detachedFromCampaignId = campaign.id;
      localDriver.campaignId = null;
      localDriver.updatedAt = Date.now();
    }

    campaign.updatedAt = Date.now();
    saveDB(db);
    _inactivityCache.delete(campaign.id);

    await logAudit(req, 'driver:detach', {
      entityType: 'driver',
      entityId: driverId,
      data: {
        campaignId: campaign.id,
        campaignName: campaign.name,
        driverName: driver?.name || localDriver?.name || '',
      },
    });

    return res.json({ ok: true, detached: true, driverId });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: safeErrorMessage(err, 'Falha ao desvincular motorista') });
  }
});

router.patch('/:id', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const payload = req.body || {};
  const driverCooldownRaw = payload.driverCooldownDays ?? payload.driverCooldown;
  const graphicCooldownRaw = payload.graphicCooldownDays ?? payload.graphicCooldown;
  const kmMinimumRaw = payload.kmMinimumPerDriver ?? payload.minKmPerDriver ?? payload.kmMinPerDriver;
  let touched = false;

  if (payload.name && typeof payload.name === 'string') {
    campaign.name = trim(payload.name);
    touched = true;
  }
  if (typeof payload.client === 'string') {
    campaign.client = payload.client;
    touched = true;
  }
  if (typeof payload.period === 'string') {
    campaign.period = payload.period;
    touched = true;
  }
  if (payload.status) {
    const normalized = String(payload.status).toLowerCase();
    if (!CAMPAIGN_STATUS.includes(normalized)) {
      return res.status(400).json({ error: 'Status invalido' });
    }
    campaign.status = normalized;
    touched = true;
  }
  if (payload.kmPeriods !== undefined) {
    const parsed = parseKmPeriods(payload.kmPeriods);
    if (!parsed) {
      return res.status(400).json({ error: 'kmPeriods invalido' });
    }
    campaign.kmPeriods = parsed;
    touched = true;
  }
  if (driverCooldownRaw !== undefined) {
    const days = Number(driverCooldownRaw);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return res.status(400).json({ error: 'driverCooldownDays invalido (0-365)' });
    }
    campaign.driverCooldownDays = days;
    touched = true;
  }
  if (graphicCooldownRaw !== undefined) {
    const days = Number(graphicCooldownRaw);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return res.status(400).json({ error: 'graphicCooldownDays invalido (0-365)' });
    }
    campaign.graphicCooldownDays = days;
    touched = true;
  }
  if (kmMinimumRaw !== undefined) {
    const kmMin = Number(kmMinimumRaw);
    if (!Number.isFinite(kmMin) || kmMin < 0 || kmMin > 1000000) {
      return res.status(400).json({ error: 'kmMinimumPerDriver invalido (0-1000000)' });
    }
    campaign.kmMinimumPerDriver = Math.round(kmMin);
    campaign.kmRuleUpdatedAt = Date.now();
    touched = true;
  }
  if (payload.driverTarget !== undefined) {
    const target = parseInt(payload.driverTarget, 10);
    if (!Number.isFinite(target) || target < 0 || target > 100000) {
      return res.status(400).json({ error: 'driverTarget invalido (0-100000)' });
    }
    campaign.driverTarget = target;
    touched = true;
  }
  if (payload.evidenceWindowDays !== undefined) {
    const days = Number(payload.evidenceWindowDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: 'evidenceWindowDays invalido (1-365)' });
    }
    campaign.evidenceWindowDays = Math.round(days);
    touched = true;
  }

  if (!touched) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  }

  campaign.updatedAt = Date.now();
  saveDB(db);
  try {
    await upsertCampaignRecord(campaign);
  } catch (err) {
    console.warn('[campaigns] upsert campaign record', err?.message || err);
  }
  if (payload.driverTarget !== undefined) {
    try {
      await upsertCampaignSettings(campaign.id, { driverTarget: campaign.driverTarget });
    } catch (err) {
      console.warn('[campaigns] upsert campaign settings', err?.message || err);
    }
  }
  if (payload.evidenceWindowDays !== undefined) {
    try {
      await upsertCampaignSettings(campaign.id, { evidenceWindowDays: campaign.evidenceWindowDays });
    } catch (err) {
      console.warn('[campaigns] upsert evidenceWindowDays settings', err?.message || err);
    }
  }

  await logAudit(req, 'campaign:update', {
    entityType: 'campaign',
    entityId: campaign.id,
    data: { campaignName: campaign.name, fields: Object.keys(payload) },
  });

  res.json({ campaign: summarizeCampaign(db, campaign) });
});

router.patch('/:id/review/:reviewId', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const reviewItem = db.review.find(
    r => r.id === req.params.reviewId && r.campaignId === campaign.id,
  );
  if (!reviewItem) {
    return respondNotFound(res, 'Item de revisão não encontrado');
  }
  if (reviewItem.type !== 'STATUS_INVALIDO') {
    return res.status(400).json({ error: 'Tipo de revisão não suportado' });
  }

  const requestedStatus = trim(req.body?.status);
  if (!requestedStatus) {
    return res.status(400).json({ error: 'Status obrigatorio' });
  }
  const normalizedStatus = normalizeStatus(requestedStatus);
  if (!STATUS.includes(normalizedStatus)) {
    return res.status(400).json({ error: 'Status invalido' });
  }

  const driver = db.drivers.find(
    d => d.id === reviewItem.driverId && d.campaignId === campaign.id,
  );
  if (!driver) return respondNotFound(res, 'Motorista não encontrado');
  if (!driver.rowNumber) {
    return res.status(400).json({ error: 'Motorista sem referencia de linha para atualizacao' });
  }

  try {
    const { sheetId, sheetName } = ensureSheetConfig(campaign);

    let header = Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length
      ? campaign.sheetHeader
      : null;
    if (!header) {
      header = await readSheetHeader(sheetId, sheetName);
      campaign.sheetHeader = header;
      campaign.sheetGid = campaign.sheetGid ?? (await getSheetId(sheetId, sheetName));
    }

    const columnKey = reviewItem.column || 'Status';
    if (!header.includes(columnKey)) {
      return res.status(400).json({ error: `Coluna ${columnKey} não encontrada na planilha` });
    }

    const raw = mergeDriverRawSources(driver);
    raw[columnKey] = normalizedStatus;
    driver.raw = raw;
    driver.status = normalizedStatus;
    driver.statusRaw = normalizedStatus;
    driver.updatedAt = Date.now();

    applyCanonicalRaw(driver);
    const values = buildSheetRowValues(header, driver);
    await updateSheetRow(sheetId, sheetName, driver.rowNumber, values);

    db.review = db.review.filter(r => r.id !== reviewItem.id);
    campaign.updatedAt = Date.now();
    saveDB(db);

    try {
      await upsertMasterRecord(campaign, driver);
    } catch (err) {
      console.warn('[campaigns] db upsert master review', err?.message || err);
    }

    await logAudit(req, 'review:update', {
      entityType: 'driver',
      entityId: driver.id,
      data: { campaignId: campaign.id, campaignName: campaign.name, driverName: driver.name, reviewId: reviewItem.id },
    });

    res.json({
      driver,
      campaign: summarizeCampaign(db, campaign),
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: safeErrorMessage(err, 'Falha ao aplicar revisao') });
  }
});

router.delete('/:id/review/:reviewId', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const exists = db.review.some(
    r => r.id === req.params.reviewId && r.campaignId === campaign.id,
  );
  if (!exists) return respondNotFound(res, 'Item de revisão não encontrado');

  db.review = db.review.filter(r => r.id !== req.params.reviewId);
  saveDB(db);

  await logAudit(req, 'review:delete', {
    entityType: 'review',
    entityId: req.params.reviewId,
    data: { campaignId: campaign.id, campaignName: campaign.name },
  });

  res.status(204).end();
});

router.patch('/:id/drivers/:driverId', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const driver = db.drivers.find(
    d => d.id === req.params.driverId && d.campaignId === campaign.id,
  );
  if (!driver) return respondNotFound(res, 'Motorista não encontrado');

  const fieldsInput = req.body?.fields && typeof req.body.fields === 'object'
    ? req.body.fields
    : req.body;

  if (!fieldsInput || typeof fieldsInput !== 'object') {
    return res.status(400).json({ error: 'Payload invalido' });
  }

  try {
    // Merge fields into driver.raw
    const raw = mergeDriverRawSources(driver);
    Object.entries(fieldsInput).forEach(([key, value]) => {
      raw[key] = value;
    });
    driver.raw = raw;

    // Update specific driver properties
    if ('Nome' in fieldsInput || 'nome' in fieldsInput || 'name' in fieldsInput) {
      const newName =
        fieldsInput.Nome ??
        fieldsInput.nome ??
        fieldsInput.name ??
        driver.name;
      driver.name = newName;
      driver.nameKey = normalizeName(newName);
    }
    if ('Cidade' in fieldsInput || 'cidade' in fieldsInput) {
      driver.city = fieldsInput.Cidade ?? fieldsInput.cidade ?? driver.city;
    }
    if ('PIX' in fieldsInput || 'Pix' in fieldsInput || 'pix' in fieldsInput) {
      driver.pix = fieldsInput.PIX ?? fieldsInput.Pix ?? fieldsInput.pix ?? driver.pix;
    }
    if ('Status' in fieldsInput || 'status' in fieldsInput || 'STATUS' in fieldsInput) {
      const rawStatus =
        fieldsInput.Status ??
        fieldsInput.status ??
        fieldsInput.STATUS ??
        driver.status;
      driver.statusRaw = rawStatus;
      driver.status = normalizeStatus(rawStatus);
    }

    applyDriverAdhesionScheduleFromRaw(driver, raw);

    const now = Date.now();
    applyDriverKmSummary(driver, {
      updatedAt: now,
      syncTotalKmRodado: true,
    });

    driver.updatedAt = now;
    campaign.updatedAt = now;

    applyCanonicalRaw(driver);

    // If campaign has a linked sheet, update it
    if (campaign.sheetId && campaign.sheetName && driver.rowNumber) {
      let header = Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length
        ? campaign.sheetHeader
        : null;
      if (!header) {
        header = await readSheetHeader(campaign.sheetId, campaign.sheetName);
        campaign.sheetHeader = header;
        campaign.sheetGid = campaign.sheetGid ?? (await getSheetId(campaign.sheetId, campaign.sheetName));
      }
      const rowValues = buildSheetRowValues(header, driver);
      await updateSheetRow(campaign.sheetId, campaign.sheetName, driver.rowNumber, rowValues);
    }

    saveDB(db);

    try {
      await upsertDriverRecord(driver);
    } catch (err) {
      console.warn('[campaigns] db upsert driver update', err?.message || err);
    }

    try {
      await upsertMasterRecord(campaign, driver);
    } catch (err) {
      console.warn('[campaigns] db upsert master driver update', err?.message || err);
    }

    await logAudit(req, 'driver:update', {
      entityType: 'driver',
      entityId: driver.id,
      data: { campaignId: campaign.id, campaignName: campaign.name, driverName: driver.name, fields: Object.keys(fieldsInput) },
    });

    res.json({ driver });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: safeErrorMessage(err, 'Falha ao atualizar motorista') });
  }
});

router.patch('/:id/drivers/:driverId/evidence-status', async (req, res) => {
  const { target, verified, reviewerName } = req.body || {};
  if (typeof target !== 'string') {
    return res.status(400).json({ error: 'Campo target obrigatorio (driver ou graphic).' });
  }
  if (typeof verified !== 'boolean') {
    return res.status(400).json({ error: 'Campo verified obrigatorio (boolean).' });
  }

  const normalizedTarget = target.toLowerCase();
  const targetKey = normalizedTarget === 'graphic'
    ? 'graphicFlow'
    : normalizedTarget === 'driver'
      ? 'driverFlow'
      : null;
  if (!targetKey) {
    return res.status(400).json({ error: 'Valor de target invalido. Use \"driver\" ou \"graphic\".' });
  }

  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const driver = db.drivers.find(d => d.id === req.params.driverId && d.campaignId === campaign.id);
  if (!driver) return respondNotFound(res, 'Motorista não encontrado');

  let storageEntries = [];
  try {
    storageEntries = await listStorageEntriesByCampaign(campaign.id);
  } catch (err) {
    console.warn('[campaigns] storage entries listing error', err?.message || err);
  }
  const evidenceByDriver = await collectEvidenceByDriver(db, campaign.id, storageEntries);
  const driverEvidence = evidenceByDriver.get(String(driver.id)) || [];
  const currentStatus = buildDriverEvidenceStatus(driver, driverEvidence);
  const flowStatus = currentStatus[targetKey];

  if (verified && !flowStatus.completed) {
    return res.status(400).json({ error: 'Envio ainda não foi concluído para este perfil.' });
  }

  const reviewer = req.adminUser ? req.adminUser.name : (trim(reviewerName) || 'admin');
  const reviewEntry = ensureEvidenceReviewTarget(driver, targetKey);
  if (verified) {
    reviewEntry.verifiedAt = Date.now();
    reviewEntry.verifiedBy = reviewer;
    reviewEntry.verifiedByName = reviewer;
    reviewEntry.cooldownUntil = computeCooldownUntil(campaign, targetKey);
  } else {
    reviewEntry.verifiedAt = null;
    reviewEntry.verifiedBy = null;
    reviewEntry.verifiedByName = null;
    reviewEntry.cooldownUntil = null;
  }

  driver.updatedAt = Date.now();
  campaign.updatedAt = driver.updatedAt;
  saveDB(db);

  try {
    await upsertDriverRecord(driver);
  } catch (err) {
    console.warn('[campaigns] upsert driver record after evidence verification', err?.message || err);
  }

  await logAudit(req, 'evidence:verify', {
    entityType: 'driver',
    entityId: driver.id,
    data: {
      campaignName: campaign.name,
      driverName: driver.name,
      flowType: target,
      verified,
    },
  });

  const payloadDriver = cloneDriverForPayload(driver, driverEvidence);
  res.json({ ok: true, driver: payloadDriver });
});

router.patch('/:id/drivers/:driverId/summary-km', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const driver = db.drivers.find(
    d => d.id === req.params.driverId && d.campaignId === campaign.id,
  );
  if (!driver) return respondNotFound(res, 'Motorista não encontrado');

  const payload = req.body || {};
  const initialKm = parseKmNumber(payload.initialKm ?? payload.kmInitial);
  const currentKm = parseKmNumber(payload.currentKm ?? payload.odometerCurrent ?? payload.odometroAtual);

  const hasInitial = Number.isFinite(initialKm);
  const hasCurrent = Number.isFinite(currentKm);
  if (!hasInitial && !hasCurrent) {
    return res.status(400).json({ error: 'Informe initialKm e/ou currentKm para atualizar.' });
  }
  if (hasInitial && initialKm < 0) {
    return res.status(400).json({ error: 'initialKm deve ser maior ou igual a 0.' });
  }
  if (hasCurrent && currentKm < 0) {
    return res.status(400).json({ error: 'currentKm deve ser maior ou igual a 0.' });
  }
  if (hasInitial && hasCurrent && currentKm < initialKm) {
    return res.status(400).json({ error: 'currentKm deve ser maior ou igual ao initialKm.' });
  }

  const now = Date.now();
  applyDriverKmSummary(driver, {
    initialKm: hasInitial ? initialKm : undefined,
    currentKm: hasCurrent ? currentKm : undefined,
    source: 'admin-summary',
    updatedAt: now,
    syncTotalKmRodado: true,
  });

  driver.updatedAt = now;
  campaign.updatedAt = now;
  applyCanonicalRaw(driver);

  try {
    if (campaign.sheetId && campaign.sheetName && driver.rowNumber) {
      let header = Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length
        ? campaign.sheetHeader
        : null;
      if (!header) {
        header = await readSheetHeader(campaign.sheetId, campaign.sheetName);
        campaign.sheetHeader = header;
        campaign.sheetGid = campaign.sheetGid ?? (await getSheetId(campaign.sheetId, campaign.sheetName));
      }
      const rowValues = buildSheetRowValues(header, driver);
      await updateSheetRow(campaign.sheetId, campaign.sheetName, driver.rowNumber, rowValues);
    }

    saveDB(db);

    try {
      await upsertCampaignRecord(campaign);
    } catch (err) {
      console.warn('[campaigns] db upsert campaign summary km', err?.message || err);
    }
    try {
      await upsertDriverRecord(driver);
    } catch (err) {
      console.warn('[campaigns] db upsert driver summary km', err?.message || err);
    }
    try {
      await upsertMasterRecord(campaign, driver);
    } catch (err) {
      console.warn('[campaigns] db upsert master summary km', err?.message || err);
    }

    await logAudit(req, 'driver:km-update', {
      entityType: 'driver',
      entityId: driver.id,
      data: { campaignId: campaign.id, campaignName: campaign.name, driverName: driver.name },
    });

    return res.json({ ok: true, driver });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: safeErrorMessage(err, 'Falha ao atualizar KM do resumo') });
  }
});

router.patch('/:id/km/:driverId', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const driver = db.drivers.find(
    d => d.id === req.params.driverId && d.campaignId === campaign.id,
  );
  if (!driver) return respondNotFound(res, 'Motorista não encontrado');

  const sheetId = campaign.kmSheetId || campaign.sheetId || '';
  const sheetName = campaign.kmSheetName || campaign.sheetName || '';
  const usingKmSheet = Boolean(campaign.kmSheetId && campaign.kmSheetName);

  let header = Array.isArray(campaign.kmSheetHeader) && campaign.kmSheetHeader.length
    ? campaign.kmSheetHeader
    : null;

  try {
    if (!header) {
      if (Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length && !usingKmSheet) {
        header = campaign.sheetHeader;
      } else if (sheetId && sheetName) {
        header = await readSheetHeader(sheetId, sheetName);
        if (usingKmSheet) {
          campaign.kmSheetHeader = header;
        } else {
          campaign.sheetHeader = header;
        }
      }
    }
  } catch (err) {
    console.warn('[campaigns] read km header', err?.message || err);
  }

  const fieldsInput = req.body?.fields && typeof req.body.fields === 'object'
    ? req.body.fields
    : req.body;
  if (!fieldsInput || typeof fieldsInput !== 'object') {
    return res.status(400).json({ error: 'Payload invalido' });
  }

  const kmRowNumber = (sheetId && sheetName && header)
    ? (usingKmSheet ? driver.km?.rowNumber : driver.rowNumber)
    : undefined;

  if (sheetId && sheetName && header && !kmRowNumber) {
    return res.status(400).json({ error: 'Motorista sem referencia de linha para atualizacao de KM' });
  }

  try {
    const normalizeKeyForMatch = value => String(value || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/["'`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

    const sourceRaw = usingKmSheet ? (driver.km?.raw || {}) : (driver.raw || {});
    const raw = { ...sourceRaw };

    const headerList = Array.isArray(header) ? header : [];
    for (const [key, value] of Object.entries(fieldsInput)) {
      const normalizedKey = normalizeKeyForMatch(key);
      let matched = null;
      if (headerList.length) {
        matched = headerList.find(h => normalizeKeyForMatch(h) === normalizedKey);
        if (!matched) {
          matched = headerList.find(h => normalizeKeyForMatch(h).includes(normalizedKey) || normalizedKey.includes(normalizeKeyForMatch(h)));
        }
        if (!matched) {
          const re = /(KM|KM RODADO|META KM|STATUS)\s*(\d+)/i;
          const match = String(key || '').match(re);
          if (match && match[1] && match[2]) {
            const base = match[1].toUpperCase();
            const num = match[2];
            matched = headerList.find(
              h => normalizeKeyForMatch(h).includes(base) && normalizeKeyForMatch(h).includes(num),
            );
          }
        }
      }
      if (matched) raw[matched] = value;
      else raw[key] = value;
    }

    if (sheetId && sheetName && header && usingKmSheet) {
      const values = header.map(col => raw[col] ?? '');
      await updateSheetRow(sheetId, sheetName, kmRowNumber, values);
    }

    driver.km = driver.km || {};
    if (!usingKmSheet) {
      driver.raw = raw;
    }
    driver.km.raw = raw;

    const parseNum = (val) => {
      if (val === undefined || val === null) return null;
      const str = String(val).trim();
      if (!str) return null;
      const cleaned = str.replace(/\./g, '').replace(/,/g, '.').replace('%', '');
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : null;
    };

    let maxPeriod = 0;
    const periodRegex = /(KM|META|STATUS)\s*(\d+)/i;
    Object.keys(raw).forEach(key => {
      const match = String(key || '').match(periodRegex);
      if (match && match[2]) {
        const idx = parseInt(match[2], 10);
        if (Number.isFinite(idx) && idx > maxPeriod) maxPeriod = idx;
      }
    });

    const periodCount = Number.isFinite(Number(campaign.kmPeriods))
      ? Number(campaign.kmPeriods)
      : (maxPeriod > 0 ? maxPeriod : DEFAULT_KM_PERIODS);

    const periods = [];
    let totalKm = 0;
    let totalMeta = 0;

    for (let i = 1; i <= periodCount; i += 1) {
      const kmKeys = [`KM RODADO ${i}`, `KM RODADO${i}`, `KM ${i}`, `KM${i}`];
      const metaKeys = [`META KM ${i}`, `META KM${i}`];
      const statusKeys = [`STATUS ${i}`];

      let kmValue = null;
      for (const key of kmKeys) {
        if (raw[key] !== undefined && String(raw[key]).trim() !== '') {
          kmValue = parseNum(raw[key]);
          break;
        }
      }
      if (Number.isFinite(kmValue)) totalKm += kmValue ?? 0;

      let metaValue = null;
      for (const key of metaKeys) {
        if (raw[key] !== undefined && String(raw[key]).trim() !== '') {
          metaValue = parseNum(raw[key]);
          break;
        }
      }
      if (Number.isFinite(metaValue)) totalMeta += metaValue ?? 0;

      let statusValue = '';
      for (const key of statusKeys) {
        if (raw[key] !== undefined && String(raw[key]).trim() !== '') {
          statusValue = String(raw[key]);
          break;
        }
      }

      periods.push({
        index: i,
        kmRodado: Number.isFinite(kmValue) ? kmValue : '',
        metaKm: Number.isFinite(metaValue) ? metaValue : '',
        percent: null,
        status: statusValue,
      });
    }

    const totalPercent = (Number.isFinite(totalKm) && Number.isFinite(totalMeta) && totalMeta)
      ? (totalKm / totalMeta) * 100
      : null;

    const pickFirst = (keys) => {
      const normalizedTargets = keys.map(normalizeKeyForMatch);
      for (const [key, value] of Object.entries(raw)) {
        if (normalizedTargets.includes(normalizeKeyForMatch(key)) && String(value).trim() !== '') {
          return value;
        }
      }
      for (const key of keys) {
        if (raw[key] !== undefined && String(raw[key]).trim() !== '') return raw[key];
      }
      return '';
    };

    driver.km.periods = periods;
    driver.km.total = {
      kmRodado: Number.isFinite(totalKm) ? totalKm : '',
      metaKm: Number.isFinite(totalMeta) ? totalMeta : '',
      percent: Number.isFinite(totalPercent) ? totalPercent : '',
      status: pickFirst(['STATUS TOTAL']),
      source: 'km-sheet-total',
    };
    driver.km.checkIn = pickFirst(['CHECK IN', 'CHECK-IN', 'CHECKIN']);
    driver.km.comentarios = pickFirst(['COMENTÁRIOS', 'COMENT\u00c1RIOS', 'COMENTARIO']);
    driver.km.observacoes = pickFirst(['OBSERVAÇÕES', 'OBSERVA\u00c7\u00d5ES', 'OBSERVACAO']);

    const now = Date.now();
    driver.km.importedAt = now;
    applyDriverKmSummary(driver, {
      updatedAt: now,
      syncTotalKmRodado: false,
    });
    driver.updatedAt = now;

    applyCanonicalRaw(driver);

    if (!usingKmSheet && sheetId && sheetName && header && kmRowNumber) {
      const rowValues = buildSheetRowValues(header, driver);
      await updateSheetRow(sheetId, sheetName, kmRowNumber, rowValues);
    }

    campaign.updatedAt = now;
    saveDB(db);

    try {
      await upsertCampaignRecord(campaign);
    } catch (err) {
      console.warn('[campaigns] db upsert campaign km', err?.message || err);
    }
    try {
      await upsertDriverRecord(driver);
    } catch (err) {
      console.warn('[campaigns] db upsert driver km', err?.message || err);
    }
    try {
      await upsertMasterRecord(campaign, driver);
    } catch (err) {
      console.warn('[campaigns] db upsert master km', err?.message || err);
    }

    await logAudit(req, 'driver:km-update', {
      entityType: 'driver',
      entityId: driver.id,
      data: { campaignId: campaign.id, campaignName: campaign.name, driverName: driver.name, periods: 'km-sheet' },
    });

    res.json({ driver });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: safeErrorMessage(err, 'Falha ao atualizar KM') });
  }
});
router.get('/:id/evidence', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    const evidence = await getEvidenceEntries(db, campaign);
    res.json({ evidence });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.get('/:id/evidence/driver/:driverId', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    const evidence = await getEvidenceEntries(db, campaign, { driverId: req.params.driverId });
    res.json({ evidence });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.get('/:id/evidence/graphic/:graphicId', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    const evidence = await getEvidenceEntries(db, campaign, { graphicId: req.params.graphicId });
    res.json({ evidence });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.get('/:id/evidence/graphic/:graphicId/driver/:driverId', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    const evidence = await getEvidenceEntries(db, campaign, {
      graphicId: req.params.graphicId,
      driverId: req.params.driverId,
    });
    res.json({ evidence });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.delete('/:id/evidence/:evidenceId', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    const evidenceId = req.params.evidenceId;
    if (!evidenceId) {
      return res.status(400).json({ error: 'ID da evidência obrigatório' });
    }

    const persistentRecord = await getEvidenceRecordById(evidenceId);
    const persistentCampaignId = String(
      persistentRecord?.campaign_id || persistentRecord?.campaignId || '',
    ).trim();
    if (persistentRecord && persistentCampaignId && persistentCampaignId !== String(campaign.id)) {
      return res.status(404).json({ error: 'Evidência não encontrada nesta campanha' });
    }

    let removedFromDbJson = false;
    // Remove from db.json evidence array (if exists)
    if (Array.isArray(db.evidence)) {
      const index = db.evidence.findIndex(e => e.id === evidenceId && e.campaignId === campaign.id);
      if (index >= 0) {
        db.evidence.splice(index, 1);
        saveDB(db);
        removedFromDbJson = true;
        console.log('[evidence:delete] Removed from db.json:', evidenceId);
      }
    }

    // Remove from MongoDB
    const deleted = await deleteEvidenceRecord(evidenceId);
    console.log('[evidence:delete] MongoDB result:', { evidenceId, deleted, removedFromDbJson });

    // O registro deixa de aparecer no sistema antes da limpeza externa. Se o
    // Drive estiver temporariamente indisponivel, evitamos manter uma evidencia
    // quebrada visivel e registramos o arquivo privado para limpeza posterior.
    if (persistentRecord?.drive_file_id && deleted) {
      try {
        await deleteAgentEvidenceDriveFile(String(persistentRecord.drive_file_id));
      } catch (driveError) {
        console.warn(
          '[evidence:delete] registro removido; limpeza do Drive ficou pendente:',
          driveError?.message || driveError,
        );
      }
    }

    await logAudit(req, 'evidence:delete', {
      entityType: 'evidence',
      entityId: evidenceId,
      data: { campaignId: campaign.id, campaignName: campaign.name },
    });

    res.json({ success: true, deleted, removedFromDbJson });
  } catch (err) {
    console.error('[evidence:delete] Error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.delete('/:id/storage/:storageFileId', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    const storageFileId = req.params.storageFileId;
    if (!storageFileId) {
      return res.status(400).json({ error: 'ID do arquivo obrigatório' });
    }

    console.log('[storage:delete] Deleting storage file:', storageFileId);

    // Remove from MongoDB
    const deleted = await deleteStorageFile(storageFileId);
    console.log('[storage:delete] MongoDB result:', { storageFileId, deleted });

    await logAudit(req, 'storage:delete', {
      entityType: 'storage_file',
      entityId: storageFileId,
      data: { campaignId: campaign.id, campaignName: campaign.name },
    });

    res.json({ success: true, deleted });
  } catch (err) {
    console.error('[storage:delete] Error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.delete('/:id/storage/folder/:driverId/:dateFolder', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    const { driverId, dateFolder } = req.params;
    const { uploaderType } = req.query; // optional: 'driver' or 'graphic'

    if (!driverId || !dateFolder) {
      return res.status(400).json({ error: 'Driver ID e pasta de data são obrigatórios' });
    }

    console.log('[storage:delete-folder] Deleting folder:', { driverId, dateFolder, uploaderType });

    // Delete all storage files in this folder
    const deletedCount = await deleteStorageFilesByFolder(
      campaign.id,
      driverId,
      dateFolder,
      uploaderType || null
    );

    console.log('[storage:delete-folder] Result:', { deletedCount });

    await logAudit(req, 'storage:delete-folder', {
      entityType: 'storage_folder',
      entityId: `${driverId}/${dateFolder}`,
      data: { 
        campaignId: campaign.id, 
        campaignName: campaign.name,
        driverId,
        dateFolder,
        uploaderType: uploaderType || 'all',
        deletedCount 
      },
    });

    res.json({ success: true, deletedCount });
  } catch (err) {
    console.error('[storage:delete-folder] Error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.post('/:id/cleanup-orphaned-evidence', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    // Get all valid storage file IDs
    let storageEntries = [];
    try {
      storageEntries = await listStorageEntriesByCampaign(campaign.id);
    } catch (err) {
      console.warn('[campaigns] storage entries listing error', err?.message || err);
    }
    
    const validStorageIds = new Set(storageEntries.map(e => String(e.id)));
    const orphanedEvidenceIds = [];
    
    // Find and remove orphaned evidence from db.json
    const evidenceBefore = (db.evidence || []).length;
    db.evidence = (db.evidence || []).filter(item => {
      // Keep if not related to this campaign
      if (item.campaignId !== campaign.id) return true;
      
      // Remove if URL references a deleted storage file
      if (item.url && item.url.startsWith('/api/storage/')) {
        const storageId = item.url.split('/').pop();
        if (!validStorageIds.has(String(storageId))) {
          console.log('[cleanup] Removing orphaned evidence with deleted file:', { id: item.id, url: item.url });
          if (item.id) orphanedEvidenceIds.push(String(item.id));
          return false;
        }
      }

      return true;
    });

    saveDB(db);
    const removedCount = evidenceBefore - db.evidence.length;
    const mongoCleanupResults = await Promise.allSettled(
      orphanedEvidenceIds.map(evidenceId => deleteEvidenceRecord(evidenceId)),
    );
    const mongoCleanupFailures = mongoCleanupResults.filter(result => result.status === 'rejected').length;
    if (mongoCleanupFailures) {
      console.warn('[cleanup] Falha ao remover evidencias orfas do Mongo:', mongoCleanupFailures);
    }
    
    console.log('[cleanup] Orphaned evidence cleanup:', { removedCount });

    await logAudit(req, 'evidence:cleanup', {
      entityType: 'evidence',
      entityId: campaign.id,
      data: { 
        campaignId: campaign.id, 
        campaignName: campaign.name,
        removedCount 
      },
    });

    res.json({ success: true, removedCount });
  } catch (err) {
    console.error('[cleanup] Error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.get('/:id/storage/graphic/:driverId', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    // Motoristas podem vir do MongoDB (api_drivers) e não estar no db.json local.
    // listDriverStorageTree só precisa de campaign.id e driver.id — criar stub mínimo.
    const driver = (db.drivers || []).find(
      d => d.id === req.params.driverId && d.campaignId === campaign.id,
    ) || { id: req.params.driverId, campaignId: campaign.id };

    // graphicId scopes the query to a specific graphic's uploads
    const graphicId = req.query.graphicId || null;

    const tree = await listDriverStorageTree(campaign, driver, { uploaderType: 'graphic', graphicId });
    res.json({ storage: tree });
  } catch (err) {
    console.warn('[campaigns] storage graphic listing error', err?.message || err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.get('/:id/storage/driver/:driverId', async (req, res) => {
  try {
    const db = loadDB();
    const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
    if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

    // Motoristas podem vir do MongoDB (api_drivers) e não estar no db.json local.
    // listDriverStorageTree só precisa de campaign.id e driver.id — criar stub mínimo.
    const driver = (db.drivers || []).find(
      d => d.id === req.params.driverId && d.campaignId === campaign.id,
    ) || { id: req.params.driverId, campaignId: campaign.id };

    const tree = await listDriverStorageTree(campaign, driver, { uploaderType: 'driver' });
    res.json({ storage: tree });
  } catch (err) {
    console.warn('[campaigns] storage driver listing error', err?.message || err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});







router.post('/:id/master-ensure', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');
  const settings = db.settings || {};
  const masterSheetId = settings.masterSheetId;
  const masterProvider = String(process.env.MASTER_PROVIDER || '').toLowerCase();

  const useMongoDatabase = masterProvider !== 'sheets';

  if (useMongoDatabase) {
    try {
      const schemaResult = await ensureDatabaseSchema();
      if (schemaResult?.requiresManual) {
        return res.status(400).json({
          error: 'Schema do MongoDB ainda não existe.',
          hint: schemaResult.message,
        });
      }

      const baseHeader = Array.isArray(campaign.sheetHeader) ? campaign.sheetHeader : [];
      const periods = Number.isFinite(Number(campaign.kmPeriods))
        ? Number(campaign.kmPeriods)
        : DEFAULT_KM_PERIODS;
      const header = buildMasterHeader({ periods, baseHeader });

      campaign.sheetHeader = header;
      campaign.sheetName = campaign.sheetName || trim(campaign.name) || `Campanha ${campaign.id.slice(0, 6)}`;
      campaign.updatedAt = Date.now();
      saveDB(db);

      const tableResult = await ensureCampaignMasterTable(campaign, header);
      if (tableResult?.requiresManual) {
        return res.status(400).json({
          error: 'Tabela da campanha no MongoDB não pode ser criada automaticamente.',
          hint: tableResult.message || 'Crie/atualize manualmente as coleções no MongoDB.',
        });
      }

      const drivers = db.drivers.filter(d => d.campaignId === campaign.id);
      const { inserted } = await upsertCampaignMasterRows(campaign, drivers, header);

      try {
        const graphics = (db.graphics || []).filter(g => g.campaignId === campaign.id);
        await ensureCampaignGraphicsTable(campaign);
        if (graphics.length) await upsertCampaignGraphicsRows(campaign, graphics);
      } catch (err) {
        console.warn('[campaigns] db graphics ensure', err?.message || err);
      }

      return res.json({
        ok: true,
        provider: 'mongo',
        rowsWritten: inserted,
        table: getCampaignTableName(campaign),
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: safeErrorMessage(err, 'Falha ao vincular campanha ao MongoDB') });
    }
  }

  if (!masterSheetId) {
    return res.status(400).json({ error: 'Planilha mestre não configurada. Defina em /api/config/master-sheet' });
  }

  const title = String(campaign.name || `Campanha ${campaign.id.slice(0, 6)}`).trim().slice(0, 96);

  try {
    const tab = await ensureSheetTab(masterSheetId, title);

    const baseHeader = Array.isArray(campaign.sheetHeader) ? campaign.sheetHeader : [];
    const periods = Number.isFinite(Number(campaign.kmPeriods))
      ? Number(campaign.kmPeriods)
      : DEFAULT_KM_PERIODS;
    const header = buildMasterHeader({ periods, baseHeader });
    await setSheetHeader(masterSheetId, title, header);

    campaign.sheetId = masterSheetId;
    campaign.sheetName = title;
    campaign.sheetHeader = header;
    campaign.sheetGid = tab.sheetId ?? (await getSheetId(masterSheetId, title));
    campaign.updatedAt = Date.now();
    saveDB(db);

    const drivers = db.drivers.filter(d => d.campaignId === campaign.id);
    const rows = drivers.map(driver => buildSheetRowValues(header, driver));

    await clearSheetData(masterSheetId, title);
    if (rows.length) {
      await updateSheetRows(masterSheetId, title, 2, header.length, rows);
    }

    drivers.forEach((driver, idx) => {
      driver.rowNumber = idx + 2;
    });
    saveDB(db);

    let mongoMirrored = false;
    try {
      await ensureDatabaseSchema();
      const tableResult = await ensureCampaignMasterTable(campaign, header);
      if (!tableResult?.requiresManual) {
        await upsertCampaignMasterRows(campaign, drivers, header);
        const graphics = (db.graphics || []).filter(g => g.campaignId === campaign.id);
        await ensureCampaignGraphicsTable(campaign);
        if (graphics.length) await upsertCampaignGraphicsRows(campaign, graphics);
        mongoMirrored = true;
      }
    } catch (err) {
      console.warn('[campaigns] db mirror master', err?.message || err);
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(masterSheetId)}/edit#gid=${encodeURIComponent(campaign.sheetGid)}`;
    res.json({
      ok: true,
      provider: 'sheets',
      campaign: summarizeCampaign(db, campaign),
      sheetUrl,
      rowsWritten: drivers.length,
      mirroredToDb: mongoMirrored,
      dbTable: mongoMirrored ? getCampaignTableName(campaign) : null,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: safeErrorMessage(err, 'Falha ao vincular campanha a planilha mestre') });
  }
});

router.get('/:id/master-status', async (req, res) => {
  const db = loadDB();
  const campaign = db.campaigns.find(c => c.id === req.params.id) || await resolveCampaignFromApi(req.params.id);
  if (!campaign) return respondNotFound(res, 'Campanha não encontrada');

  const settings = db.settings || {};
  const masterSheetId = settings.masterSheetId;
  if (!masterSheetId) {
    return res.status(400).json({ error: 'Planilha mestre não configurada' });
  }

  const title = String(campaign.sheetName || campaign.name || '').trim();
  if (!title) {
    return res.status(400).json({ error: 'Nome da aba mestre não configurado' });
  }

  try {
    const sheetGid = await getSheetId(masterSheetId, title);
    const header = await readSheetHeader(masterSheetId, title);
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(masterSheetId)}/edit#gid=${encodeURIComponent(sheetGid)}`;

    res.json({
      sheetId: masterSheetId,
      sheetName: title,
      sheetGid,
      sheetUrl,
      header,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: safeErrorMessage(err, 'Falha ao inspecionar planilha') });
  }
});

// ------------------------------------------
//  EXPORT DE MOTORISTAS (Excel/CSV)
// ------------------------------------------

const EXPORT_DRIVERS_LIMIT = 5000;

/** Formata timestamp em ms para "YYYY-MM-DD HH:mm" pt-BR. */
function formatExportDate(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Map de status -> label legivel. */
function statusLabel(status) {
  if (!status) return '';
  const map = {
    cadastrando: 'Cadastrando',
    aprovado: 'Aprovado',
    agendado: 'Agendado',
    plotado: 'Plotado',
    rodando: 'Rodando',
    pausado: 'Pausado',
    encerrado: 'Encerrado',
    cancelado: 'Cancelado',
  };
  return map[status] || status;
}

/** Conta evidencias por step. */
function countEvidence(driver, step) {
  const list = Array.isArray(driver.evidence) ? driver.evidence : [];
  return list.filter((e) => String(e?.step || '').toLowerCase() === step).length;
}

/** Constroi linha do export a partir de um driver normalizado. */
function buildExportRow(driver, campaign) {
  const raw = driver.raw || {};
  const address = driver.address || {};
  const schedule = driver.schedule || {};
  const km = driver.km || driver.kmSummary || {};
  const evidenceList = Array.isArray(driver.evidence) ? driver.evidence : [];

  return {
    id: driver.id || '',
    nome: driver.name || '',
    status: statusLabel(driver.status),
    statusBruto: driver.statusRaw || '',
    cpf: driver.cpf || raw['CPF'] || '',
    email: driver.email || raw['Email'] || '',
    telefone: driver.phone || raw['Numero'] || '',
    cidade: driver.city || address.city || raw['Cidade'] || '',
    estado: address.state || '',
    bairro: address.neighborhood || '',
    cep: address.zipcode || '',
    endereco: address.street || '',
    placa: driver.plate || raw['Placa'] || '',
    modelo: raw['Modelo'] || raw['Veiculo'] || '',
    pix: driver.pix || raw['PIX'] || '',
    convite: raw['Convite'] || raw['Codigo Convite'] || '',
    appPrincipal: driver.mainApp || '',
    aplicativos: Array.isArray(driver.appsRegistered) ? driver.appsRegistered.join(', ') : '',
    periodoOperacao: driver.operationPeriod || '',
    bairroOperacao: driver.operationNeighborhood || '',
    kmTotal: Number(driver.totalKms ?? driver.kmTravelledValue ?? km.totalKm ?? 0) || 0,
    kmFimPeriodo: Number(km.endKm ?? km.lastKm ?? 0) || 0,
    kmInicioPeriodo: Number(km.startKm ?? km.firstKm ?? 0) || 0,
    horarioPlotagem: schedule.startTime || raw['Horario Plotagem'] || '',
    dataInstalacao: schedule.startDate || raw['Data de Instalacao'] || '',
    adesivagemInicial: raw['Adesivagem Inicial'] || '',
    retiradaAdesivo: raw['Retirada Adesivo'] || '',
    statusAdesivagem: raw['Status Adesivagem'] || '',
    grafica: schedule.graphicId || raw['Grafica'] || '',
    evidenciasInstalacao: countEvidence(driver, 'install'),
    evidenciasRemocao: countEvidence(driver, 'remove') + countEvidence(driver, 'removal'),
    evidenciasManutencao: countEvidence(driver, 'maintenance') + countEvidence(driver, 'maint'),
    evidenciasTotal: evidenceList.length,
    observacoes: raw['Observacoes'] || '',
    comentarios: raw['Comentarios'] || '',
    criadoEm: formatExportDate(driver.createdAt),
    atualizadoEm: formatExportDate(driver.updatedAt),
    campanhaId: campaign?.id || '',
    campanhaNome: campaign?.name || '',
  };
}

const EXPORT_COLUMNS = [
  { header: 'ID', key: 'id', width: 26 },
  { header: 'Nome', key: 'nome', width: 32 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Status (bruto)', key: 'statusBruto', width: 18 },
  { header: 'CPF', key: 'cpf', width: 16 },
  { header: 'E-mail', key: 'email', width: 28 },
  { header: 'Telefone', key: 'telefone', width: 16 },
  { header: 'Cidade', key: 'cidade', width: 18 },
  { header: 'Estado', key: 'estado', width: 8 },
  { header: 'Bairro', key: 'bairro', width: 20 },
  { header: 'CEP', key: 'cep', width: 12 },
  { header: 'Endereco', key: 'endereco', width: 32 },
  { header: 'Placa', key: 'placa', width: 10 },
  { header: 'Modelo', key: 'modelo', width: 18 },
  { header: 'PIX', key: 'pix', width: 24 },
  { header: 'Convite', key: 'convite', width: 12 },
  { header: 'App Principal', key: 'appPrincipal', width: 14 },
  { header: 'Aplicativos', key: 'aplicativos', width: 24 },
  { header: 'Periodo Operacao', key: 'periodoOperacao', width: 18 },
  { header: 'Bairro Operacao', key: 'bairroOperacao', width: 20 },
  { header: 'KM Total', key: 'kmTotal', width: 12 },
  { header: 'KM Inicio Periodo', key: 'kmInicioPeriodo', width: 16 },
  { header: 'KM Fim Periodo', key: 'kmFimPeriodo', width: 16 },
  { header: 'Horario Plotagem', key: 'horarioPlotagem', width: 16 },
  { header: 'Data Instalacao', key: 'dataInstalacao', width: 16 },
  { header: 'Adesivagem Inicial', key: 'adesivagemInicial', width: 18 },
  { header: 'Retirada Adesivo', key: 'retiradaAdesivo', width: 18 },
  { header: 'Status Adesivagem', key: 'statusAdesivagem', width: 18 },
  { header: 'Grafica', key: 'grafica', width: 18 },
  { header: 'Evid. Instalacao', key: 'evidenciasInstalacao', width: 14 },
  { header: 'Evid. Remocao', key: 'evidenciasRemocao', width: 14 },
  { header: 'Evid. Manutencao', key: 'evidenciasManutencao', width: 14 },
  { header: 'Evid. Total', key: 'evidenciasTotal', width: 12 },
  { header: 'Observacoes', key: 'observacoes', width: 32 },
  { header: 'Comentarios', key: 'comentarios', width: 32 },
  { header: 'Criado em', key: 'criadoEm', width: 16 },
  { header: 'Atualizado em', key: 'atualizadoEm', width: 16 },
  { header: 'Campanha ID', key: 'campanhaId', width: 26 },
  { header: 'Campanha', key: 'campanhaNome', width: 24 },
];

/** Sanitiza string para uso em filename (Content-Disposition). */
function sanitizeFilename(name) {
  return String(name || 'campanha')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'campanha';
}

/**
 * Mitiga CSV/Spreadsheet Injection (OWASP): celulas que comecam com =, +, -, @,
 * tab ou CR sao prefixadas com aspa simples para evitar execucao como formula
 * quando o arquivo for aberto em Excel/LibreOffice/Google Sheets.
 */
function neutralizeCellFormula(value) {
  if (value == null) return '';
  const s = String(value);
  if (!s) return s;
  const first = s.charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return "'" + s;
  }
  return s;
}

/**
 * GET /:id/export/drivers?format=xlsx|csv&status=all
 * Exporta motoristas da campanha em Excel ou CSV.
 * Limite: EXPORT_DRIVERS_LIMIT motoristas (HTTP 413 acima).
 */
router.get('/:id/export/drivers', async (req, res) => {
  const { id } = req.params;
  const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const statusFilter = String(req.query.status || 'all').toLowerCase();

  try {
    // 1) Resolver campanha (API + local)
    const apiCampaign = await fetchCampaignById(id).catch(() => null);
    const db = loadDB();
    const localCampaign = db.campaigns.find((c) => c.id === id);
    const campaign = apiCampaign || localCampaign;
    if (!campaign) return respondNotFound(res, 'Campanha nao encontrada');

    // 2) Buscar motoristas (API + locais)
    let drivers = [];
    if (apiCampaign) {
      const periodStart = apiCampaign.apiData?.periodStart;
      const periodEnd = apiCampaign.apiData?.periodEnd;
      drivers = (periodStart && periodEnd)
        ? await fetchDriversByCampaignPeriod(apiCampaign.id, periodStart, periodEnd)
        : await fetchDriversByCampaign(apiCampaign.id);
      // Mesclar com locais
      const apiIds = new Set(drivers.map((d) => d.id));
      const localOnlyCandidates = (db.drivers || []).filter((d) =>
        d.campaignId === id &&
        !apiIds.has(d.id)
      );
      const localOnly = await filterDetachedCampaignDrivers(id, localOnlyCandidates);
      drivers = drivers.concat(localOnly);
    } else {
      drivers = await filterDetachedCampaignDrivers(
        id,
        (db.drivers || []).filter((d) => d.campaignId === id),
      );
    }

    // 3) Mesclar evidencias locais
    let storageEntries = [];
    try { storageEntries = await listStorageEntriesByCampaign(id); } catch (_) {}
    const evidenceByDriver = await collectEvidenceByDriver(db, id, storageEntries);
    // Indexa motoristas locais por id (evita O(N*M))
    const localDriversById = new Map((db.drivers || []).map((d) => [d.id, d]));
    drivers = drivers.map((driver) => {
      const localDriver = localDriversById.get(driver.id);
      const merged = localDriver ? mergeDriverWithLocal(driver, localDriver) : driver;
      return cloneDriverForPayload(merged, evidenceByDriver.get(String(merged.id)) || []);
    });

    // 4) Filtro por status (opcional)
    if (statusFilter && statusFilter !== 'all') {
      drivers = drivers.filter((d) => String(d.status || '').toLowerCase() === statusFilter);
    }

    if (drivers.length > EXPORT_DRIVERS_LIMIT) {
      return res.status(413).json({
        error: `Export excede o limite de ${EXPORT_DRIVERS_LIMIT} motoristas (encontrados ${drivers.length}). Aplique um filtro de status.`,
      });
    }

    const filenameBase = `motoristas_${sanitizeFilename(campaign.name || id)}_${new Date().toISOString().slice(0, 10)}`;

    // 5) Gerar arquivo
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
      // BOM para Excel abrir UTF-8 corretamente
      res.write('\uFEFF');
      res.write(EXPORT_COLUMNS.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(';') + '\r\n');
      for (const driver of drivers) {
        const row = buildExportRow(driver, campaign);
        const line = EXPORT_COLUMNS.map((c) => {
          const v = row[c.key];
          if (v == null) return '';
          // Sanitiza contra CSV injection antes de escapar aspas
          const safe = typeof v === 'number' ? String(v) : neutralizeCellFormula(v);
          const s = safe.replace(/"/g, '""');
          return `"${s}"`;
        }).join(';');
        res.write(line + '\r\n');
      }
      res.end();
    } else {
      await runWorkload('heavy', 'campaigns:export-drivers', async () => {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
        const { default: ExcelJS } = await import('exceljs');
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
        const sheet = workbook.addWorksheet('Motoristas');
        sheet.columns = EXPORT_COLUMNS;
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).commit();
        for (const driver of drivers) {
          const row = buildExportRow(driver, campaign);
          // Sanitiza strings contra CSV injection (numeros passam direto)
          for (const key of Object.keys(row)) {
            if (typeof row[key] === 'string') row[key] = neutralizeCellFormula(row[key]);
          }
          sheet.addRow(row).commit();
        }
        sheet.commit();
        await workbook.commit();
      });
    }

    // 6) Auditoria (apos enviar resposta)
    logAudit(req, 'export:drivers', {
      campaignId: id,
      format,
      status: statusFilter,
      count: drivers.length,
    }).catch(() => {});
  } catch (err) {
    console.error('[campaigns] export/drivers', err);
    if (!res.headersSent) {
      const status = err.status || 500;
      res.status(status).json({ error: safeErrorMessage(err, 'Falha ao exportar motoristas') });
    } else {
      try { res.end(); } catch (_) {}
    }
  }
});

// ------------------------------------------
//  INATIVIDADE DE MOTORISTAS
// ------------------------------------------

const INACTIVITY_GRACE_DAYS = 3;
const INACTIVITY_THRESHOLD_WARNING = 7;
const INACTIVITY_THRESHOLD_ATTENTION = 14;
const INACTIVITY_THRESHOLD_CRITICAL = 30;
const INACTIVITY_CACHE_TTL_MS = 60 * 1000;

const _inactivityCache = new Map(); // campaignId -> { ts, payload }

/** Determina severidade pelo numero de dias inativos. */
function inactivitySeverity(daysInactive) {
  if (daysInactive >= INACTIVITY_THRESHOLD_CRITICAL) return 'critical';
  if (daysInactive >= INACTIVITY_THRESHOLD_ATTENTION) return 'attention';
  if (daysInactive >= INACTIVITY_THRESHOLD_WARNING) return 'warning';
  return null;
}

/**
 * GET /:id/inactivity
 * Lista motoristas inativos da campanha. Inatividade = dias desde a ultima
 * evidencia/upload em storage_files. Motoristas com cadastro mais recente
 * que INACTIVITY_GRACE_DAYS ficam fora (carencia inicial).
 * Cache em memoria de INACTIVITY_CACHE_TTL_MS.
 */
router.get('/:id/inactivity', async (req, res) => {
  const { id } = req.params;
  try {
    const cached = _inactivityCache.get(id);
    if (cached && (Date.now() - cached.ts) < INACTIVITY_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const apiCampaign = await fetchCampaignById(id).catch(() => null);
    const db = loadDB();
    const localCampaign = db.campaigns.find((c) => c.id === id);
    const campaign = apiCampaign || localCampaign;
    if (!campaign) return respondNotFound(res, 'Campanha nao encontrada');

    let drivers = [];
    if (apiCampaign) {
      drivers = await fetchDriversByCampaign(apiCampaign.id);
      const apiIds = new Set(drivers.map((d) => String(d.id)));
      const localOnlyCandidates = (db.drivers || []).filter(
        (d) =>
          d.campaignId === id &&
          !apiIds.has(String(d.id)),
      );
      const localOnly = await filterDetachedCampaignDrivers(id, localOnlyCandidates);
      drivers = drivers.concat(localOnly);
    } else {
      drivers = await filterDetachedCampaignDrivers(
        id,
        (db.drivers || []).filter((d) => d.campaignId === id),
      );
    }

    // 1 query agregada: primeira e ultima atividade por driver
    const activityByDriver = await getDriverLastActivityByCampaign(id);

    const now = Date.now();
    const graceMs = INACTIVITY_GRACE_DAYS * 86400000;
    const minThresholdMs = INACTIVITY_THRESHOLD_WARNING * 86400000;

    const inactiveDrivers = [];
    for (const driver of drivers) {
      const driverId = String(driver.id || '');
      if (!driverId) continue;

      // Status finais nao precisam de alerta
      const status = String(driver.status || '').toLowerCase();
      if (status === 'encerrado' || status === 'cancelado') continue;

      // Motorista so entra na lista se JA enviou ao menos uma foto pelo portal.
      // Sem upload = nao comecou a rodar = nao conta como inativo.
      const activity = activityByDriver.get(driverId);
      if (!activity || !activity.firstAt) continue;

      // Carencia inicial contada a partir do primeiro upload (inicio na campanha)
      if ((now - activity.firstAt) < graceMs) continue;

      const sinceMs = now - activity.lastAt;
      if (sinceMs < minThresholdMs) continue;

      const daysInactive = Math.floor(sinceMs / 86400000);
      const severity = inactivitySeverity(daysInactive);
      if (!severity) continue;

      inactiveDrivers.push({
        id: driverId,
        name: driver.name || '',
        status: driver.status || '',
        firstActivityAt: activity.firstAt,
        lastActivityAt: activity.lastAt,
        daysInactive,
        severity,
        hasPhone: Boolean(resolveDriverPhone(driver)),
      });
    }

    // Ordena: critical primeiro, depois mais dias inativos
    const severityOrder = { critical: 0, attention: 1, warning: 2 };
    inactiveDrivers.sort((a, b) => {
      const so = severityOrder[a.severity] - severityOrder[b.severity];
      if (so !== 0) return so;
      return b.daysInactive - a.daysInactive;
    });

    const payload = {
      ok: true,
      thresholds: {
        warning: INACTIVITY_THRESHOLD_WARNING,
        attention: INACTIVITY_THRESHOLD_ATTENTION,
        critical: INACTIVITY_THRESHOLD_CRITICAL,
        graceDays: INACTIVITY_GRACE_DAYS,
      },
      total: inactiveDrivers.length,
      bySeverity: {
        warning: inactiveDrivers.filter((d) => d.severity === 'warning').length,
        attention: inactiveDrivers.filter((d) => d.severity === 'attention').length,
        critical: inactiveDrivers.filter((d) => d.severity === 'critical').length,
      },
      drivers: inactiveDrivers,
      generatedAt: now,
    };

    _inactivityCache.set(id, { ts: now, payload });
    res.json(payload);
  } catch (err) {
    console.error('[campaigns] inactivity', err);
    res.status(500).json({ ok: false, error: safeErrorMessage(err, 'Falha ao calcular inatividade') });
  }
});

// ------------------------------------------
//  HEATMAP DE UPLOADS (slots dia x hora)
// ------------------------------------------

const HEATMAP_CACHE_TTL_MS = 60 * 1000;
const _heatmapCache = new Map(); // campaignId -> { ts, payload }

/**
 * GET /:id/heatmap
 * Retorna matriz 7x24 com contagem de uploads (storage_files) por
 * dia da semana (0=domingo .. 6=sabado) x hora (0..23), considerando
 * o fuso America/Sao_Paulo. Inclui totais por dia e por hora para
 * facilitar renderizacao no frontend.
 */
router.get('/:id/heatmap', async (req, res) => {
  const { id } = req.params;
  try {
    const cached = _heatmapCache.get(id);
    if (cached && (Date.now() - cached.ts) < HEATMAP_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const { matrix, total, firstAt, lastAt } = await getUploadHeatmapByCampaign(id);

    const totalsByDay = matrix.map((row) => row.reduce((a, b) => a + b, 0));
    const totalsByHour = Array(24).fill(0);
    let max = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const v = matrix[d][h];
        totalsByHour[h] += v;
        if (v > max) max = v;
      }
    }

    // Identifica picos (dia/hora com mais uploads)
    const peaks = [];
    if (max > 0) {
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          if (matrix[d][h] === max) peaks.push({ day: d, hour: h, count: max });
        }
      }
    }

    const payload = {
      ok: true,
      timezone: 'America/Sao_Paulo',
      matrix,
      max,
      total,
      totalsByDay,
      totalsByHour,
      peaks: peaks.slice(0, 5),
      firstAt,
      lastAt,
      generatedAt: Date.now(),
    };

    _heatmapCache.set(id, { ts: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    console.error('[campaigns] heatmap', err);
    res.status(500).json({ ok: false, error: safeErrorMessage(err, 'Falha ao gerar heatmap') });
  }
});

// ------------------------------------------
//  HISTORICO / TIMELINE DA CAMPANHA
// ------------------------------------------

const HISTORY_DEFAULT_LIMIT = 30;
const HISTORY_MAX_LIMIT = 100;

/**
 * GET /:id/history?cursor=<ms>&limit=<n>
 * Retorna eventos do audit log relacionados a esta campanha em ordem
 * cronologica decrescente, com paginacao por cursor (timestamp).
 */
router.get('/:id/history', async (req, res) => {
  const { id } = req.params;
  try {
    const cursorTs = Number(req.query.cursor);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || HISTORY_DEFAULT_LIMIT, 1),
      HISTORY_MAX_LIMIT,
    );

    const { items, nextCursor } = await listCampaignHistory(id, {
      cursorTs: Number.isFinite(cursorTs) && cursorTs > 0 ? cursorTs : undefined,
      limit,
    });

    // Saneia para o cliente: remove ObjectIds e campos pesados
    const safeItems = items.map((it) => ({
      id: it._id ? String(it._id) : null,
      action: it.action || 'unknown',
      entityType: it.entityType || null,
      entityId: it.entityId || null,
      username: it.username || 'system',
      name: it.name || it.username || null,
      success: it.success !== false,
      timestamp: Number(it.timestamp) || 0,
      details: it.details && typeof it.details === 'object' ? it.details : {},
    }));

    res.json({
      ok: true,
      items: safeItems,
      nextCursor,
      limit,
      generatedAt: Date.now(),
    });
  } catch (err) {
    console.error('[campaigns] history', err);
    res.status(500).json({ ok: false, error: safeErrorMessage(err, 'Falha ao carregar historico') });
  }
});

// ------------------------------------------
//  DISPARO DE MENSAGENS (WhatsApp via Meta)
// ------------------------------------------

/** List approved templates available for dispatch */
router.get('/dispatch/templates', async (_req, res) => {
  try {
    const all = await listTemplates();
    const approved = all.filter(t => t.status === 'approved');
    res.json({ ok: true, items: approved });
  } catch (err) {
    console.error('[dispatch:templates]', err);
    res.status(500).json({ ok: false, error: 'Falha ao listar templates.' });
  }
});

function isMetaConfigured() {
  return Boolean(disparadorEnv.metaSystemUserToken && disparadorEnv.metaPhoneNumberId);
}

/** Resolve phone from top-level or raw aliases */
function resolveDriverPhone(driver) {
  if (driver.phone) return normalizePhone(driver.phone);
  const raw = driver.raw || {};
  const candidate = raw['Numero'] || raw['numero'] || raw['telefone'] || raw['Telefone'] || raw['whatsapp'] || '';
  return normalizePhone(candidate);
}

/** Dispatch KM alert to attention drivers of a campaign */
router.post('/:id/dispatch', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const { templateId, driverIds, message, dryRun } = req.body || {};

    // Fetch campaign and drivers
    const campaign = await fetchCampaignById(campaignId);
    if (!campaign) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });

    const apiDrivers = await fetchDriversByCampaign(campaignId);

    // Merge locally-added drivers that don't exist in the API
    const db = loadDB();
    const apiDriverIds = new Set((apiDrivers || []).map(d => String(d.id)));
    const localOnlyCandidates = db.drivers.filter(d =>
      d.campaignId === campaignId &&
      !apiDriverIds.has(String(d.id))
    );
    const localOnlyDrivers = await filterDetachedCampaignDrivers(
      campaignId,
      localOnlyCandidates,
    );
    const drivers = [...(apiDrivers || []), ...localOnlyDrivers];

    if (!drivers.length) {
      return res.status(400).json({ ok: false, error: 'Nenhum motorista nesta campanha.' });
    }

    // Filter target drivers
    let targets;
    if (Array.isArray(driverIds) && driverIds.length > 0) {
      const idSet = new Set(driverIds.map(String));
      targets = drivers.filter(d => idSet.has(String(d.id)));
    } else {
      targets = drivers;
    }

    // Filter to only those with a phone number (check top-level and raw)
    const withPhone = targets.filter(d => resolveDriverPhone(d));
    const noPhone = targets.length - withPhone.length;

    if (!withPhone.length) {
      return res.status(400).json({ ok: false, error: 'Nenhum motorista com telefone válido para envio.' });
    }

    // Resolve template if templateId provided
    let template = null;
    if (templateId) {
      template = await getTemplateById(templateId);
      if (!template) return res.status(404).json({ ok: false, error: 'Template não encontrado.' });
      if (template.status !== 'approved') {
        return res.status(400).json({ ok: false, error: 'Template precisa estar aprovado pela Meta para uso.' });
      }
    }

    // Must have either template or free text message
    const freeText = String(message || '').trim();
    if (!template && !freeText) {
      return res.status(400).json({ ok: false, error: 'Informe um template ou uma mensagem para enviar.' });
    }

    // Dry run — return preview
    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        metaConfigured: isMetaConfigured(),
        summary: {
          total: targets.length,
          withPhone: withPhone.length,
          noPhone,
          template: template ? { id: template.id, name: template.name } : null,
          freeText: freeText || null,
        },
      });
    }

    if (!isMetaConfigured()) {
      return res.status(400).json({ ok: false, error: 'Meta API não configurada (META_SYSTEM_USER_TOKEN / META_PHONE_NUMBER_ID).' });
    }

    // Send messages
    const blockedCodes = new Set([
      'TEXT_OUTSIDE_WINDOW',
      'CONTACT_BLOCKED',
      'OPT_OUT_ACTIVE',
      'COOLDOWN_ACTIVE',
      'MARKETING_OPT_OUT',
      'TEMPLATE_NOT_ALLOWED',
    ]);
    const _dispatchRun = await createDispatchRun({
      source: 'campaign_attention',
      sourceName: `Atenção: ${campaign.name}`,
      campaignId,
      campaignName: campaign.name || '',
      templateId: template?.id || '',
      templateName: template?.name || '',
      operatorId: req.adminUser?.id || '',
      operatorName: req.adminUser?.name || req.adminUser?.username || '',
    }).catch(() => null);

    const results = [];
    for (const driver of withPhone) {
      const phone = resolveDriverPhone(driver);
      let _dResult = null;
      try {
        _dResult = await dispatchDriverCampaignMessage({
          driver,
          campaignId,
          type: template ? 'template' : 'text',
          templateId: template?.id || '',
          text: freeText,
          dispatchScope: 'campaign_dispatch',
          dispatchRunId: _dispatchRun?.id || '',
        });

        if (!_dResult.ok) {
          const errorCode = String(_dResult.error?.code || '').trim();
          results.push({
            driverId: driver.id,
            name: driver.name,
            phone,
            status: blockedCodes.has(errorCode) ? 'blocked' : 'failed',
            code: errorCode,
            error: _dResult.error?.message || 'Falha no envio',
          });
          continue;
        }

        results.push({ driverId: driver.id, name: driver.name, phone, status: 'sent' });
      } catch (err) {
        results.push({
          driverId: driver.id,
          name: driver.name,
          phone,
          status: 'failed',
          error: safeErrorMessage(err, 'Falha no envio'),
        });
      } finally {
        if (_dispatchRun) {
          const msg = _dResult?.item;
          const errorCode = String(_dResult?.error?.code || '').trim();
          const upsertStatus = msg?.deliveryStatus
            || (_dResult?.ok ? 'sent' : (blockedCodes.has(errorCode) ? 'blocked' : 'failed'));
          await upsertCampaignRecipient({
            campaignId: _dispatchRun.id,
            contactId: msg?.contactId || String(driver.id),
            contactName: driver.name || '',
            phoneE164: msg?.phoneE164 || phone,
            metaMessageId: msg?.metaMessageId || '',
            deliveryStatus: upsertStatus,
            outboundMessageId: msg?.id || '',
            templateId: template?.id || '',
            templateName: template?.name || '',
            deliveryError: _dResult?.ok ? null : (_dResult?.error?.message || null),
          }).catch(() => null);
        }
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const blocked = results.filter(r => r.status === 'blocked').length;
    const failed = results.filter(r => r.status === 'failed').length;

    if (_dispatchRun) {
      await completeDispatchRun(_dispatchRun.id, {
        totals: { targeted: withPhone.length, sent, failed, blocked, noPhone },
        results: results.map(r => ({ driverId: r.driverId, name: r.name, phone: r.phone, status: r.status, error: r.error || null })),
      }).catch(() => null);
    }

    console.log(`[dispatch] Campaign ${campaign.name}: ${sent} sent, ${blocked} blocked, ${failed} failed, ${noPhone} no phone`);

    res.json({
      ok: true,
      summary: { total: targets.length, sent, blocked, failed, noPhone },
      results,
    });
  } catch (err) {
    console.error('[dispatch] Error:', err);
    res.status(500).json({ ok: false, error: 'Falha no disparo.' });
  }
});

export default router;
