/**
 * oddrive-sync.js
 *
 * Camada MongoDB para campanhas e motoristas da OdDrive.
 *
 * - Leitura: read*() → consultas diretas ao MongoDB
 * - Escrita: syncPush() → recebe dados brutos do script externo, normaliza e grava
 *
 * Nenhuma chamada HTTP à API OdDrive é feita neste arquivo.
 *
 * Coleções:
 *   api_campaigns  — campanhas normalizadas
 *   api_drivers    — motoristas normalizados
 *   api_sync_log   — log de cada sincronização
 */

import { getDb } from './mongo.js';
import { normalizeName } from '../lib/normalize.js';
import { recordCacheEvent } from './runtime-telemetry.js';

const COL_CAMPAIGNS = 'api_campaigns';
const COL_DRIVERS   = 'api_drivers';
const COL_SYNC_LOG  = 'api_sync_log';

// ══════════════════════════════════════════
//  CACHE EM MEMÓRIA (leitura)
//  Evita consultas repetidas ao MongoDB Atlas durante navegação normal.
//  Invalidado automaticamente ao receber novo syncPush.
// ══════════════════════════════════════════

const READ_CACHE_TTL_MS = 90_000; // 90 segundos

const _cache = {
  campaigns: { data: null, at: 0 },
  drivers:   { data: null, at: 0 },
};
const _inFlight = { campaigns: null, drivers: null };
let _cacheGeneration = 0;

function _isFresh(entry) {
  return entry.data !== null && (Date.now() - entry.at) < READ_CACHE_TTL_MS;
}

function invalidateReadCache() {
  _cacheGeneration += 1;
  _cache.campaigns.data = null;
  _cache.drivers.data   = null;
}

// ══════════════════════════════════════════
//  LEITURA: MongoDB → Workspace
// ══════════════════════════════════════════

/**
 * Lê todas as campanhas do MongoDB (com cache em memória).
 */
export async function readCampaigns() {
  if (_isFresh(_cache.campaigns)) {
    recordCacheEvent('MongoDB - campanhas', true);
    return _cache.campaigns.data;
  }
  recordCacheEvent('MongoDB - campanhas', false);
  if (_inFlight.campaigns) return _inFlight.campaigns;
  const generation = _cacheGeneration;
  _inFlight.campaigns = (async () => {
    const db = await getDb();
    const data = await db.collection(COL_CAMPAIGNS).find({}).toArray();
    if (generation === _cacheGeneration) _cache.campaigns = { data, at: Date.now() };
    return data;
  })().finally(() => { _inFlight.campaigns = null; });
  return _inFlight.campaigns;
}

/**
 * Lê uma campanha por ID (derivado do cache de campanhas).
 */
export async function readCampaignById(campaignId) {
  const all = await readCampaigns();
  return all.find(c => c._id === campaignId || c.id === campaignId) ?? null;
}

/**
 * Lê todos os motoristas do MongoDB (com cache em memória).
 */
export async function readDrivers() {
  if (_isFresh(_cache.drivers)) {
    recordCacheEvent('MongoDB - motoristas', true);
    return _cache.drivers.data;
  }
  recordCacheEvent('MongoDB - motoristas', false);
  if (_inFlight.drivers) return _inFlight.drivers;
  const generation = _cacheGeneration;
  _inFlight.drivers = (async () => {
    const db = await getDb();
    const data = await db.collection(COL_DRIVERS).find({}).toArray();
    if (generation === _cacheGeneration) _cache.drivers = { data, at: Date.now() };
    return data;
  })().finally(() => { _inFlight.drivers = null; });
  return _inFlight.drivers;
}

/**
 * Lê motoristas de uma campanha específica (derivado do cache global).
 */
export async function readDriversByCampaign(campaignId) {
  const all = await readDrivers();
  return all.filter(d => d.campaignId === campaignId);
}

/**
 * Lê um motorista por ID do MongoDB.
 */
export async function readDriverById(driverId) {
  const db = await getDb();
  return db.collection(COL_DRIVERS).findOne({ _id: driverId });
}

/**
 * Busca motorista por identidade (nome normalizado + telefone).
 */
export async function readDriverByIdentity({ name, phone }) {
  const { normalizeName } = await import('../lib/normalize.js');
  const targetName = normalizeName(name);
  const targetDigits = (phone || '').replace(/\D/g, '');
  const targetSuffix = targetDigits.slice(-9);

  const db = await getDb();
  const query = { nameKey: targetName };
  const candidates = await db.collection(COL_DRIVERS).find(query).toArray();

  for (const driver of candidates) {
    const driverSuffix = (driver.phoneSuffix || (driver.phone || '').replace(/\D/g, '').slice(-9));
    if (targetSuffix && driverSuffix && targetSuffix === driverSuffix) {
      return driver;
    }
    if (!targetDigits) return driver;
  }

  return null;
}

/**
 * Busca motorista por telefone (sufixo 9 dígitos).
 */
export async function readDriverByPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const suffix = digits.slice(-9);
  if (suffix.length < 8) return null;

  const db = await getDb();
  return db.collection(COL_DRIVERS).findOne({ phoneSuffix: suffix });
}

/**
 * Retorna status da última sincronização.
 */
export async function getSyncStatus() {
  const db = await getDb();
  const lastSync = await db.collection(COL_SYNC_LOG)
    .find({})
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();

  const campaignCount = await db.collection(COL_CAMPAIGNS).countDocuments();
  const driverCount = await db.collection(COL_DRIVERS).countDocuments();

  return {
    lastSync: lastSync[0] || null,
    mongoData: {
      campaigns: campaignCount,
      drivers: driverCount,
    },
  };
}

/**
 * Verifica se o MongoDB tem dados da API (para bootstrap inicial).
 */
export async function hasMongoData() {
  const db = await getDb();
  const count = await db.collection(COL_CAMPAIGNS).countDocuments();
  return count > 0;
}

// ══════════════════════════════════════════
//  SYNC PUSH: receber dados brutos da API via script externo
// ══════════════════════════════════════════

/**
 * Corrige strings com encoding Latin-1 incorretamente interpretado como UTF-8.
 * O PowerShell às vezes envia JSON com bytes Latin-1 que o Express lê como UTF-8,
 * resultando em sequências corrompidas (ex: "Ã£o" em vez de "ão", "Ã§" em vez de "ç").
 * Esta função detecta e corrige recursivamente todos os campos string do objeto.
 */
function fixEncoding(value) {
  if (typeof value === 'string') {
    // Detectar se contém sequências típicas de Latin-1 lido como UTF-8
    // "Ã³" = ó, "Ã£" = ã, "Ã§" = ç, "Ã©" = é, "Ã " = à, "Ã¡" = á, "Ã­" = í, "Ãº" = ú
    if (/Ã[£¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏ]/.test(value)) {
      try {
        // Re-encodar: tratar a string como Latin-1 e ler como UTF-8
        const bytes = Buffer.from(value, 'latin1');
        const fixed = bytes.toString('utf8');
        // Se o resultado tem replacement chars U+FFFD, não aplicar
        if (!fixed.includes('\uFFFD')) return fixed;
      } catch (_) {}
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(fixEncoding);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = fixEncoding(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Recebe dados brutos da API OdDrive (vindos do script PS local) e grava no MongoDB.
 * O script local chama a API e envia os dados crus para este endpoint.
 * A normalização é feita aqui no servidor.
 * @param {{ campaigns: Array, drivers: Array }} rawData
 * @returns {{ campaigns: number, drivers: number, partial: boolean, errors: string[], durationMs: number }}
 */
export async function syncPush(rawData) {
  const start = Date.now();
  const db = await getDb();

  const errors = [];
  let campaignCount = 0;
  let driverCount = 0;

  // ── Normalizar e gravar campanhas ──
  const rawCampaigns = rawData.campaigns || [];
  if (rawCampaigns.length) {
    try {
      const campaigns = rawCampaigns.map(c => normalizeCampaign(fixEncoding(c)));
      await upsertMany(db, COL_CAMPAIGNS, campaigns, c => c.id);
      campaignCount = campaigns.length;
      console.log(`[SyncPush] ✅ ${campaignCount} campanhas gravadas no MongoDB`);
    } catch (err) {
      errors.push('campanhas (normalização/gravação): ' + (err?.message || 'erro'));
      console.error('[SyncPush] Erro ao processar campanhas:', err);
    }
  }

  // ── Normalizar e gravar motoristas ──
  const rawDrivers = rawData.drivers || [];
  if (rawDrivers.length) {
    try {
      const drivers = rawDrivers.map(d => normalizeDriver(fixEncoding(d)));
      await upsertMany(db, COL_DRIVERS, drivers, d => d.id);
      driverCount = drivers.length;
      console.log(`[SyncPush] ✅ ${driverCount} motoristas gravados no MongoDB`);
    } catch (err) {
      errors.push('motoristas (normalização/gravação): ' + (err?.message || 'erro'));
      console.error('[SyncPush] Erro ao processar motoristas:', err);
    }
  }

  // ── Invalidar cache de leitura após escrita ──
  invalidateReadCache();

  const durationMs = Date.now() - start;
  const partial = errors.length > 0;

  // ── Log ──
  const logEntry = {
    _id: new Date().toISOString(),
    type: 'push',
    source: 'script-local',
    campaigns: campaignCount,
    drivers: driverCount,
    driversWithCampaign: driverCount,
    errors,
    partial,
    durationMs,
    timestamp: Date.now(),
  };

  try {
    await db.collection(COL_SYNC_LOG).insertOne(logEntry);
  } catch (err) {
    console.warn('[SyncPush] Falha ao gravar sync_log:', err?.message);
  }

  return {
    campaigns: campaignCount,
    drivers: driverCount,
    partial,
    errors: errors.length ? errors : undefined,
    durationMs,
    timestamp: logEntry.timestamp,
  };
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

/**
 * Upsert em massa: grava cada documento com _id = getId(doc).
 * Usa bulkWrite para performance.
 */
async function upsertMany(db, collectionName, docs, getId) {
  if (!docs.length) return;

  const ops = docs.map(doc => ({
    replaceOne: {
      filter: { _id: getId(doc) },
      replacement: { ...doc, _id: getId(doc), _syncedAt: Date.now() },
      upsert: true,
    },
  }));

  // Processar em lotes de 500
  const BATCH = 500;
  for (let i = 0; i < ops.length; i += BATCH) {
    await db.collection(collectionName).bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
  }
}

/**
 * Cria índices para as coleções de API.
 * Chamado uma vez na inicialização.
 */
export async function ensureSyncIndexes() {
  try {
    const db = await getDb();
    await db.collection(COL_CAMPAIGNS).createIndex({ status: 1 });
    await db.collection(COL_DRIVERS).createIndex({ campaignId: 1 });
    await db.collection(COL_DRIVERS).createIndex({ nameKey: 1 });
    await db.collection(COL_DRIVERS).createIndex({ phoneSuffix: 1 });
    await db.collection(COL_SYNC_LOG).createIndex({ timestamp: -1 });
    console.log('[Sync] ✅ Índices criados/verificados');
  } catch (err) {
    console.warn('[Sync] Falha ao criar índices:', err?.message);
  }
}

/**
 * Retorna log das últimas sincronizações.
 */
export async function getSyncHistory(limit = 20) {
  const db = await getDb();
  return db.collection(COL_SYNC_LOG)
    .find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

// ══════════════════════════════════════════
//  NORMALIZAÇÃO (funções puras de transformação)
// ══════════════════════════════════════════

function formatDate(date) {
  if (!date || !Number.isFinite(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function mapDriverStatus(apiStatus) {
  switch (apiStatus) {
    case 'in_campaign':  return 'instalado';
    case 'approved':     return 'confirmado';
    case 'pending':      return 'agendado';
    case 'rejected':     return 'problema';
    case 'removed':      return 'inativo';
    default:             return 'cadastrando';
  }
}

/**
 * Normaliza dados brutos de campanha da API OdDrive.
 */
export function normalizeCampaign(apiCampaign) {
  const period = apiCampaign.period || {};
  const startDate = period.start ? new Date(period.start) : null;
  const endDate = period.end ? new Date(period.end) : null;

  let status = 'ativa';
  switch (apiCampaign.current_status) {
    case 'active':   status = 'ativa'; break;
    case 'finished': status = 'encerrada'; break;
    case 'pending':  status = 'pausada'; break;
    default:         status = apiCampaign.current_status || 'ativa';
  }

  const periodLabel = (startDate && endDate)
    ? `${formatDate(startDate)} - ${formatDate(endDate)}`
    : '';

  return {
    id: apiCampaign._id,
    name: (apiCampaign.title || '').trim(),
    client: '',        // nome do anunciante não vem da API; definido manualmente pelo admin
    status,
    period: periodLabel,
    apiData: {
      description: apiCampaign.description || '',
      subTitle: apiCampaign.sub_title || '',
      monthlyValue: apiCampaign.monthly_value || '0',
      totalInvestment: apiCampaign.total_investment || '0',
      city: apiCampaign.city || '',
      state: apiCampaign.state || '',
      terms: apiCampaign.terms || '',
      metaKms: Number(apiCampaign.meta_kms) || 0,
      campaignLink: apiCampaign.campaign_link || '',
      images: Array.isArray(apiCampaign.images) ? apiCampaign.images : [],
      links: Array.isArray(apiCampaign.links) ? apiCampaign.links : [],
      sponsorId: apiCampaign.sponsor_id || '',
      currentStatus: apiCampaign.current_status || '',
      periodStart: period.start || null,
      periodEnd: period.end || null,
      createdAt: apiCampaign.created_at || null,
      createdBy: apiCampaign.created_by || '',
    },
    campaignCode: '',
    driverCooldownDays: 10,
    graphicCooldownDays: 10,
    kmMinimumPerDriver: 100,
    sheetId: null,
    sheetName: null,
    sheetHeader: [],
    driveFolderId: null,
    createdAt: new Date(apiCampaign.created_at || Date.now()).getTime(),
    updatedAt: Date.now(),
    _source: 'api',
  };
}

/**
 * Normaliza dados brutos de motorista da API OdDrive.
 */
export function normalizeDriver(apiDriver) {
  const campaign = apiDriver.campaign || {};
  const address = apiDriver.address || {};
  const opNeighborhood = apiDriver.operation_neighborhood || {};
  const hasCampaign = !!(campaign.driver_campaign_id);
  const currentCampaignKms = hasCampaign ? (Number(campaign.totalKms) || 0) : 0;
  const historicalTotalKms = Number(
    apiDriver.kmHistoricalTotal ??
    apiDriver.km_all_campaigns_total ??
    apiDriver.totalKmsAllCampaigns ??
    campaign.totalHistoricalKms ??
    currentCampaignKms
  ) || 0;

  const phoneRaw = apiDriver.phone || '';
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const vehicleModel = campaign.vehicle_model || '';
  const createdAtRaw = apiDriver.created_at ?? apiDriver.createdAt ?? null;
  const createdAtNumber = Number(createdAtRaw);
  const createdAtDate = createdAtRaw == null || createdAtRaw === ''
    ? null
    : new Date(Number.isFinite(createdAtNumber)
      ? (createdAtNumber < 100_000_000_000 ? createdAtNumber * 1000 : createdAtNumber)
      : createdAtRaw);
  const createdAt = createdAtDate && Number.isFinite(createdAtDate.getTime())
    ? createdAtDate.getTime()
    : null;

  return {
    id: apiDriver._id,
    name: (apiDriver.name || '').trim(),
    nameKey: normalizeName(apiDriver.name),
    email: apiDriver.email || '',
    cpf: (apiDriver.cpf || '').replace(/\D/g, ''),
    phone: phoneRaw,
    phoneDigits,
    phoneSuffix: phoneDigits.slice(-9),
    plate: (campaign.vehicle_plate || '').replace(/[^a-z0-9]/gi, '').toUpperCase(),
    model: vehicleModel,
    pix: apiDriver.pix || '',
    address: {
      street: address.address || '',
      neighborhood: address.neighborhood || '',
      city: address.city || '',
      state: address.state || '',
      zipcode: address.zipcode || '',
      complement: address.complement || '',
    },
    city: address.city || opNeighborhood.city || '',
    ratingApp: apiDriver.rating_app || null,
    mainApp: apiDriver.main_app_registered || '',
    appsRegistered: Array.isArray(apiDriver.apps_registered) ? apiDriver.apps_registered : [],
    operationPeriod: apiDriver.operation_period || '',
    operationNeighborhood: opNeighborhood.neighborhood || '',
    avatar: apiDriver.avatar || '',
    indicationCode: apiDriver.indication_code || '',
    howMeetApp: apiDriver.how_meet_app || '',
    whoIndicatedApp: apiDriver.who_indicated_app || '',
    campaignId: hasCampaign ? campaign.campaign_id : null,
    campaignData: hasCampaign ? {
      driverCampaignId: campaign.driver_campaign_id,
      campaignId: campaign.campaign_id,
      currentStatus: campaign.current_campaign_status || '',
      joinedAt: campaign.created_at || campaign.createdAt || null,
      vehicleId: campaign.vehicle_id || '',
      vehiclePlate: campaign.vehicle_plate || '',
      vehicleModel,
      totalKms: currentCampaignKms,
      totalScans: Number(campaign.totalScans) || 0,
    } : null,
    status: hasCampaign ? mapDriverStatus(campaign.current_campaign_status) : 'cadastrando',
    statusRaw: hasCampaign ? campaign.current_campaign_status : '',
    kmTravelledValue: currentCampaignKms,
    kmHistoricalTotal: historicalTotalKms,
    evidenceReview: {},
    schedule: null,
    raw: vehicleModel ? { Modelo: vehicleModel } : {},
    createdAt,
    updatedAt: Date.now(),
    _source: 'api',
  };
}
