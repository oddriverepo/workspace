import { MongoClient, ObjectId, GridFSBucket } from 'mongodb';
import { applyCanonicalRaw } from '../lib/driverSheet.js';
import { normalizeName } from '../lib/normalize.js';
import { extractDriverKmSummary, parseKmNumber } from '../lib/driverKm.js';
import { getCampaignKmGoal } from '../lib/campaignKmGoal.js';

function getEnv(name, fallback = '') {
  const v = process.env[name];
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
}

const MONGO_URI = getEnv('MONGO_URI');
const MONGO_DB_NAME = getEnv('MONGO_DB_NAME', 'odrive_app');
const MONGO_TLS_ALLOW_INVALID_CERTS = getEnv('MONGO_TLS_ALLOW_INVALID_CERTS', '0') === '1';
const MONGO_TLS_CA_FILE = getEnv('MONGO_TLS_CA_FILE');
const MONGO_MAX_POOL_SIZE = Math.max(2, Number.parseInt(getEnv('MONGO_MAX_POOL_SIZE', '8'), 10) || 8);
const MONGO_MIN_POOL_SIZE = Math.max(0, Number.parseInt(getEnv('MONGO_MIN_POOL_SIZE', '0'), 10) || 0);
const STORAGE_COLLECTION = 'storage_files';
const CAMPAIGNS_COLLECTION = 'campaigns';
const DRIVERS_COLLECTION = 'drivers';
const GRAPHICS_COLLECTION = 'graphics';
const EVIDENCE_COLLECTION = 'evidence';
const ADMIN_USERS_COLLECTION = 'admin_users';
const AUDIT_LOG_COLLECTION = 'admin_audit_log';
const REPRESENTATIVE_REQUESTS_COLLECTION = 'representative_requests';
const CAMPAIGN_DRIVER_DETACHMENTS_COLLECTION = 'campaign_driver_detachments';
const CAMPAIGN_DRIVER_OVERRIDES_COLLECTION = 'campaign_driver_overrides';

let client = null;
let db = null;
let bucket = null;
let isConnecting = false;

async function getDb() {
  // Se já está conectado, retorna
  if (db) return db;
  
  // Se está conectando, aguarda
  if (isConnecting) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return getDb();
  }
  
  isConnecting = true;
  
  try {
    if (!MONGO_URI) {
      throw new Error('MongoDB não configurado (defina MONGO_URI no .env)');
    }
    
    const mongoOptions = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
      maxPoolSize: MONGO_MAX_POOL_SIZE,
      minPoolSize: Math.min(MONGO_MIN_POOL_SIZE, MONGO_MAX_POOL_SIZE),
      maxIdleTimeMS: 60000,
      retryWrites: true,
      retryReads: true,
    };
    
    if (MONGO_TLS_ALLOW_INVALID_CERTS) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('MONGO_TLS_ALLOW_INVALID_CERTS nao pode ser usado em producao');
      }
      mongoOptions.tlsAllowInvalidCertificates = true;
      mongoOptions.tlsAllowInvalidHostnames = true;
    }
    if (MONGO_TLS_CA_FILE) {
      mongoOptions.tlsCAFile = MONGO_TLS_CA_FILE;
    }
    
    console.log('[MongoDB] Conectando ao banco de dados...');
    
    // Retry logic - tenta 3 vezes
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        client = new MongoClient(MONGO_URI, mongoOptions);
        await client.connect();
        db = client.db(MONGO_DB_NAME);
        console.log('[MongoDB] ✅ Conectado com sucesso ao banco:', MONGO_DB_NAME);
        
        // Event listeners
        client.on('error', (err) => {
          console.error('[MongoDB] ❌ Erro na conexão:', err.message);
          db = null;
        });
        client.on('close', () => {
          console.warn('[MongoDB] ⚠️ Conexão fechada');
          db = null;
        });
        
        isConnecting = false;
        return db;
        
      } catch (error) {
        lastError = error;
        console.error(`[MongoDB] Tentativa ${attempt}/3 falhou:`, error.message);
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    throw lastError;
    
  } finally {
    isConnecting = false;
  }
}

export { getDb };

async function getBucket() {
  const database = await getDb();
  if (!bucket) {
    bucket = new GridFSBucket(database, { bucketName: 'media' });
  }
  return bucket;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) throw new Error('Imagem base64 invalida');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function sanitizeDigits(value) {
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

function getRawByAliases(raw = {}, aliases = []) {
  const entries = Object.entries(raw || {});
  if (!entries.length) return '';
  const normalizedTargets = aliases.map(normalizeColumnLabel);
  for (const [key, value] of entries) {
    if (normalizedTargets.includes(normalizeColumnLabel(key))) return value;
  }
  return '';
}

function extractDriverAdhesionSnapshot(driver) {
  const raw = driver?.raw && typeof driver.raw === 'object' ? driver.raw : {};
  const schedule = driver?.schedule && typeof driver.schedule === 'object' ? driver.schedule : {};

  const initialRawCandidate =
    schedule.initialAtRaw ??
    getRawByAliases(raw, ['Adesivagem Inicial', 'Horario Adesivagem Inicial']);
  const removalRawCandidate =
    schedule.removalAtRaw ??
    getRawByAliases(raw, ['Retirada Adesivo', 'Horario Retirada Adesivo']);
  const statusCandidate =
    schedule.status ??
    getRawByAliases(raw, ['Status Adesivagem', 'Situacao Adesivagem']);

  const initialAt = parseAdhesionDateTimeMs(schedule.initialAt ?? initialRawCandidate);
  const removalAt = parseAdhesionDateTimeMs(schedule.removalAt ?? removalRawCandidate);
  const initialAtRaw = formatAdhesionDateTimeInput(initialRawCandidate ?? initialAt);
  const removalAtRaw = formatAdhesionDateTimeInput(removalRawCandidate ?? removalAt);
  const status = normalizeAdhesionStatus(statusCandidate);

  return {
    initialAt: Number.isFinite(initialAt) ? initialAt : null,
    initialAtRaw,
    removalAt: Number.isFinite(removalAt) ? removalAt : null,
    removalAtRaw,
    status,
  };
}

function buildPhoneVariants(digits) {
  const clean = sanitizeDigits(digits);
  const variants = new Set();
  if (!clean) return variants;
  variants.add(clean);
  if (clean.startsWith('55')) variants.add(clean.slice(2));
  if (clean.length >= 11) variants.add(clean.slice(-11));
  if (clean.length >= 10) variants.add(clean.slice(-10));
  if (clean.length >= 9) variants.add(clean.slice(-9));
  if (clean.length >= 8) variants.add(clean.slice(-8));
  return variants;
}

function phoneMatchesStored(storedDigits, inputDigits) {
  const stored = sanitizeDigits(storedDigits);
  const input = sanitizeDigits(inputDigits);
  if (!stored || !input) return false;
  if (stored === input) return true;
  const strip = value => value.startsWith('55') ? value.slice(2) : value;
  if (strip(stored) === strip(input)) return true;
  return stored.endsWith(input) || input.endsWith(stored);
}

// Utility: sanitize name (compartilhado com outras camadas)
function sanitizeName(name) {
  return String(name || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function todayFolder() {
  // Use UTC date to create deterministic folder names independent of server local timezone
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function stepBaseName(step) {
  const map = {
    'odometer-photo': 'odometro',
    'photo-left': 'lateral esquerda',
    'photo-right': 'lateral direita',
    'photo-front': 'frente',
    'photo-rear': 'traseira',
  };
  return map[step] || 'foto';
}

function buildCampaignSlug(campaign) {
  return `campanha-${sanitizeName(campaign?.name || campaign?.id)}`;
}

function buildDriverSlug(driver) {
  return `driver-${sanitizeName(driver?.name || driver?.id)}-${String(driver?.id || '').slice(0, 6)}`;
}

export function getDriverStorageBasePath(campaign, driver, uploaderType = 'driver') {
  const camp = buildCampaignSlug(campaign);
  const drv = buildDriverSlug(driver);
  const type = String(uploaderType || 'driver').toLowerCase() === 'graphic' ? 'graphic' : 'driver';
  const roleFolder = type === 'graphic' ? 'Graficas' : 'Motoristas';
  return `${camp}/${roleFolder}/${drv}/${type}`;
}

// Storage: MongoDB (GridFS) guarda os binarios e expõe /api/storage/:id
export async function uploadBase64ImageMongo(
  campaign,
  driver,
  dataUrl,
  { step = 'photo', uploaderType = 'driver', refazer = false, graphicId = null } = {},
) {
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  const basePrefix = getDriverStorageBasePath(campaign, driver, uploaderType);
  const date = todayFolder();
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const label = stepBaseName(step);

  const ext = (mimeType.split('/')[1] || 'jpg').toLowerCase();
  let baseName = `${label} ${hh}h${mi}`;
  if (refazer) baseName = `${baseName}_refeito`;
  const fileName = `${baseName}.${ext}`;
  const objectPath = `${basePrefix}/${date}/${fileName}`;

  const bucket = await getBucket();
  const uploadStream = bucket.openUploadStream(objectPath, {
    contentType: mimeType,
    metadata: {
      campaignId: campaign.id,
      driverId: driver?.id || null,
      graphicId: graphicId || null,
      uploaderType,
      step,
    },
  });

  await new Promise((resolve, reject) => {
    uploadStream.once('finish', resolve);
    uploadStream.once('error', reject);
    uploadStream.end(buffer);
  });

  const fileId = uploadStream.id;
  const database = await getDb();
  const storageDoc = {
    _id: fileId,
    campaignId: campaign.id,
    driverId: driver?.id || null,
    graphicId: graphicId || null,
    uploaderType,
    step,
    path: objectPath,
    fileName,
    mimeType,
    folderPath: `${basePrefix}/${date}`,
    dateFolder: date,
    url: `/api/storage/${fileId.toString()}`,
    createdAt: new Date(),
  };
  await database.collection(STORAGE_COLLECTION).insertOne(storageDoc);

  return {
    bucket: 'mongo',
    path: objectPath,
    url: storageDoc.url,
    fileId: fileId.toString(),
  };
}

export async function listDriverStorageTree(campaign, driver, { uploaderType = 'driver', graphicId = null } = {}) {
  const database = await getDb();
  const basePrefix = getDriverStorageBasePath(campaign, driver, uploaderType);

  const query = {
    campaignId: campaign.id,
    driverId: driver?.id || null,
    uploaderType,
  };
  // When viewing a specific graphic's uploads, restrict to that graphic only
  if (uploaderType === 'graphic' && graphicId) {
    query.graphicId = graphicId;
  }

  const files = await database.collection(STORAGE_COLLECTION)
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();

  const folderMap = new Map();
  for (const file of files) {
    const fileId = file?._id ? String(file._id) : (file.id ? String(file.id) : null);
    const folder = file.dateFolder || 'unknown';
    if (!folderMap.has(folder)) {
      folderMap.set(folder, { name: folder, files: [] });
    }
    folderMap.get(folder).files.push({
      id: fileId,
      name: file.fileName,
      path: file.path,
      url: file.url,
      size: null,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt || file.createdAt,
      uploaderType: file.uploaderType || uploaderType,
      graphicId: file.graphicId || null,
      driverId: file.driverId || null,
    });
  }

  const folders = Array.from(folderMap.values()).sort((a, b) => b.name.localeCompare(a.name));
  return { bucket: 'mongo', prefix: `${basePrefix}/`, uploaderType, folders };
}

export async function listStorageEntriesByCampaign(campaignId) {
  if (!campaignId) return [];
  const database = await getDb();
  const cursor = await database.collection(STORAGE_COLLECTION)
    .find({ campaignId })
    .sort({ createdAt: 1 });
  const docs = await cursor.toArray();
  return docs.map(doc => ({
    id: doc._id ? String(doc._id) : `${doc.campaignId || 'storage'}-${Math.random().toString(36).slice(2, 8)}`,
    campaignId: doc.campaignId,
    driverId: doc.driverId || null,
    graphicId: doc.graphicId || null,
    uploaderType: doc.uploaderType || doc.uploader_type || 'driver',
    step: doc.step || '',
    url: doc.url || '',
    path: doc.path || '',
    fileName: doc.fileName || '',
    folderPath: doc.folderPath || '',
    dateFolder: doc.dateFolder || '',
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : (
      doc.created_at instanceof Date ? doc.created_at.getTime() : null
    ),
  }));
}

/**
 * Retorna timestamps (ms) da PRIMEIRA e ULTIMA atividade de storage por driver
 * para uma campanha. Considera apenas uploads cujo uploaderType seja 'driver'
 * (ou ausente, para compatibilidade). Uma unica agregacao Mongo evita N queries.
 *
 * A "primeira atividade" representa o momento em que o motorista comecou
 * efetivamente a rodar com o carro adesivado (primeiro upload pelo portal).
 *
 * @param {string} campaignId
 * @returns {Promise<Map<string, { firstAt: number, lastAt: number }>>}
 */
export async function getDriverLastActivityByCampaign(campaignId) {
  const result = new Map();
  if (!campaignId) return result;
  const database = await getDb();
  const cursor = database.collection(STORAGE_COLLECTION).aggregate([
    {
      $match: {
        campaignId,
        driverId: { $ne: null },
        $or: [
          { uploaderType: 'driver' },
          { uploaderType: { $exists: false } },
        ],
      },
    },
    {
      $group: {
        _id: '$driverId',
        firstAt: { $min: '$createdAt' },
        lastAt: { $max: '$createdAt' },
      },
    },
  ]);
  const docs = await cursor.toArray();
  const toMs = (v) => (v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : null));
  for (const doc of docs) {
    if (!doc?._id) continue;
    const firstAt = toMs(doc.firstAt);
    const lastAt = toMs(doc.lastAt);
    if (firstAt == null && lastAt == null) continue;
    result.set(String(doc._id), { firstAt: firstAt ?? lastAt, lastAt: lastAt ?? firstAt });
  }
  return result;
}

/**
 * Heatmap de uploads por dia da semana (1=domingo .. 7=sabado, padrao Mongo)
 * x hora do dia (0..23), filtrando uploads de motoristas. Usa fuso horario
 * America/Sao_Paulo para que os "horarios" reflitam o dia operacional do BR.
 *
 * @param {string} campaignId
 * @returns {Promise<{ matrix:number[][], total:number, firstAt:number|null, lastAt:number|null }>}
 *   matrix[day-1][hour] = contagem; matrix dimensoes 7x24.
 */
export async function getUploadHeatmapByCampaign(campaignId) {
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  const empty = { matrix, total: 0, firstAt: null, lastAt: null };
  if (!campaignId) return empty;
  const database = await getDb();
  const cursor = database.collection(STORAGE_COLLECTION).aggregate([
    {
      $match: {
        campaignId,
        createdAt: { $type: 'date' },
        $or: [
          { uploaderType: 'driver' },
          { uploaderType: { $exists: false } },
        ],
      },
    },
    {
      $group: {
        _id: {
          dow: { $dayOfWeek: { date: '$createdAt', timezone: 'America/Sao_Paulo' } },
          hour: { $hour: { date: '$createdAt', timezone: 'America/Sao_Paulo' } },
        },
        count: { $sum: 1 },
        firstAt: { $min: '$createdAt' },
        lastAt: { $max: '$createdAt' },
      },
    },
  ]);

  let total = 0;
  let firstAt = null;
  let lastAt = null;
  const docs = await cursor.toArray();
  for (const doc of docs) {
    const dow = Number(doc?._id?.dow);  // 1..7
    const hour = Number(doc?._id?.hour); // 0..23
    const count = Number(doc?.count) || 0;
    if (!Number.isFinite(dow) || !Number.isFinite(hour)) continue;
    if (dow < 1 || dow > 7 || hour < 0 || hour > 23) continue;
    matrix[dow - 1][hour] = count;
    total += count;
    const fAt = doc.firstAt instanceof Date ? doc.firstAt.getTime() : null;
    const lAt = doc.lastAt instanceof Date ? doc.lastAt.getTime() : null;
    if (fAt != null && (firstAt == null || fAt < firstAt)) firstAt = fAt;
    if (lAt != null && (lastAt == null || lAt > lastAt)) lastAt = lAt;
  }
  return { matrix, total, firstAt, lastAt };
}

export async function upsertCampaignRecord(campaign) {
  const database = await getDb();
  const kmGoal = getCampaignKmGoal(campaign, 0);
  const payload = {
    _id: campaign.id,
    name: campaign.name || null,
    client: campaign.client || null,
    period: campaign.period || null,
    status: campaign.status || null,
    campaign_code: campaign.campaignCode || null,
    sheet_id: campaign.sheetId || null,
    sheet_name: campaign.sheetName || null,
    km_sheet_id: campaign.kmSheetId || null,
    km_sheet_name: campaign.kmSheetName || null,
    km_periods: Number.isFinite(Number(campaign?.kmPeriods)) ? Number(campaign.kmPeriods) : null,
    km_minimum_per_driver: kmGoal.perDriver,
    km_goal: kmGoal,
    km_rule_updated_at: campaign.kmRuleUpdatedAt ? new Date(campaign.kmRuleUpdatedAt) : null,
    driver_cooldown_days: Number.isFinite(Number(campaign?.driverCooldownDays))
      ? Number(campaign.driverCooldownDays)
      : null,
    graphic_cooldown_days: Number.isFinite(Number(campaign?.graphicCooldownDays))
      ? Number(campaign.graphicCooldownDays)
      : null,
    drive_folder_id: campaign.driveFolderId || null,
    created_at: new Date(campaign.createdAt || Date.now()),
    updated_at: new Date(campaign.updatedAt || campaign.createdAt || Date.now()),
  };
  await database.collection('campaigns').replaceOne({ _id: payload._id }, payload, { upsert: true });
}

export async function upsertDriverRecord(driver) {
  const database = await getDb();
  const normalizedName = normalizeName(String(driver.name || ''));
  const phoneDigits = driver.phoneDigits || sanitizeDigits(driver.phone);
  const kmSnapshot = driver?.km && typeof driver.km === 'object' ? driver.km : {};
  const kmSummary = extractDriverKmSummary(driver);
  const adhesion = extractDriverAdhesionSnapshot(driver);

  let odometerText = null;
  let odometerValue = null;
  if (Number.isFinite(kmSummary.currentKm)) {
    odometerValue = kmSummary.currentKm;
    odometerText = String(kmSummary.currentKm);
  } else {
    const fallbackText = driver?.raw?.['DRV ODOMETRO VALOR INST'] ?? kmSnapshot?.raw?.['KM RODADO TOTAL'];
    if (fallbackText != null && String(fallbackText).trim() !== '') {
      odometerText = String(fallbackText).trim();
      odometerValue = parseKmNumber(odometerText);
    }
  }
  const payload = {
    _id: driver.id,
    campaign_id: driver.campaignId,
    driver_campaign_id: driver?.campaignData?.driverCampaignId || driver?.driverCampaignId || null,
    name: driver.name,
    name_key: normalizedName || null,
    status: driver.status || null,
    status_raw: driver.statusRaw || null,
    phone: driver.phone || null,
    phone_digits: phoneDigits || null,
    phone_suffix: phoneDigits ? phoneDigits.slice(-9) : null,
    cpf: driver.cpf ? sanitizeDigits(driver.cpf) : null,
    plate: driver.plate || null,
    city: driver.city || null,
    email: driver.email || null,
    pix: driver.pix || null,
    raw: driver.raw && typeof driver.raw === 'object' ? { ...driver.raw } : {},
    created_at: new Date(driver.createdAt || Date.now()),
    updated_at: new Date(driver.updatedAt || driver.createdAt || Date.now()),
  };

  if (Number.isFinite(kmSummary.initialKm)) {
    payload.km_initial_value = kmSummary.initialKm;
  }
  if (Number.isFinite(kmSummary.currentKm)) {
    payload.odometer_current_value = kmSummary.currentKm;
  }
  if (Number.isFinite(kmSummary.travelledKm)) {
    payload.km_travelled_value = kmSummary.travelledKm;
  }
  if (kmSummary.source) {
    payload.km_summary_source = kmSummary.source;
  }
  if (Number.isFinite(kmSummary.updatedAt)) {
    payload.km_summary_updated_at = new Date(kmSummary.updatedAt);
  }

  if (odometerText) {
    payload.odometer_text = odometerText;
    if (Number.isFinite(odometerValue)) payload.odometer_value = odometerValue;
    payload.odometer_updated_at = new Date(
      kmSummary.updatedAt || kmSnapshot?.total?.updatedAt || kmSnapshot?.updatedAt || driver.updatedAt || Date.now(),
    );
  }

  // Graphic odometer — more reliable source (submitted by the gráfica at installation)
  const graphicOdometer = kmSnapshot?.graphicOdometer;
  if (graphicOdometer && Number.isFinite(graphicOdometer.value)) {
    payload.graphic_odometer_value = graphicOdometer.value;
    payload.graphic_odometer_updated_at = new Date(graphicOdometer.updatedAt || Date.now());
  }

  if (Number.isFinite(adhesion.initialAt)) {
    payload.adhesion_start_at = new Date(adhesion.initialAt);
  }
  if (adhesion.initialAtRaw) {
    payload.adhesion_start_raw = adhesion.initialAtRaw;
  }
  if (Number.isFinite(adhesion.removalAt)) {
    payload.adhesion_end_at = new Date(adhesion.removalAt);
  }
  if (adhesion.removalAtRaw) {
    payload.adhesion_end_raw = adhesion.removalAtRaw;
  }
  if (adhesion.status) {
    payload.adhesion_status = adhesion.status;
  }
  await database.collection(DRIVERS_COLLECTION).replaceOne({ _id: payload._id }, payload, { upsert: true });
}

export async function insertEvidenceRecord({
  id,
  campaignId,
  driverId,
  graphicId,
  step,
  url,
  odometerValue,
  createdAt,
  uploaderType,
  path,
  storageFileId,
}) {
  const database = await getDb();
  const payload = {
    _id: id,
    campaign_id: campaignId,
    driver_id: driverId,
    step,
    url,
    path: path || '',
    uploader_type: uploaderType || 'driver',
    odometer_value: odometerValue || null,
    created_at: new Date(createdAt || Date.now()),
    updated_at: new Date(),
  };
  if (graphicId) payload.graphic_id = graphicId;
  if (storageFileId) payload.storage_file_id = storageFileId;
  await database.collection('evidence').replaceOne({ _id: payload._id }, payload, { upsert: true });
}

export async function listOdometerEvidenceByCampaign(campaignId) {
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!normalizedCampaignId) return [];

  const database = await getDb();
  const docs = await database.collection(EVIDENCE_COLLECTION)
    .find({ campaign_id: normalizedCampaignId, step: 'odometer-value' })
    .sort({ created_at: 1 })
    .toArray();

  return docs.map(doc => {
    const createdAt = doc.created_at instanceof Date
      ? doc.created_at.getTime()
      : new Date(doc.created_at || 0).getTime();
    const isGridFsEvidence = Boolean(doc.storage_file_id);
    return {
      id: String(isGridFsEvidence ? doc.storage_file_id : doc._id),
      evidenceRecordId: String(doc._id),
      type: doc.uploader_type === 'graphic' ? 'graphic' : 'driver',
      campaignId: String(doc.campaign_id || ''),
      driverId: String(doc.driver_id || ''),
      graphicId: doc.graphic_id ? String(doc.graphic_id) : null,
      step: 'odometer-value',
      odometerValue: doc.odometer_value,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      source: 'mongo-evidence',
    };
  });
}

export async function listEvidenceByCampaign(campaignId) {
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!normalizedCampaignId) return [];

  const database = await getDb();
  const docs = await database.collection(EVIDENCE_COLLECTION)
    .find({
      campaign_id: normalizedCampaignId,
      $or: [
        { step: 'odometer-value' },
        {
          source_provider: 'gptmaker',
          status: { $in: ['received', 'recebida'] },
        },
      ],
    })
    .sort({ created_at: 1 })
    .toArray();

  return docs.map(doc => {
    const isGridFsEvidence = Boolean(doc.storage_file_id);
    const createdAt = doc.created_at instanceof Date
      ? doc.created_at.getTime()
      : new Date(doc.created_at || 0).getTime();
    return {
      id: String(isGridFsEvidence ? doc.storage_file_id : doc._id),
      evidenceRecordId: String(doc._id),
      type: doc.uploader_type === 'graphic' ? 'graphic' : 'driver',
      campaignId: String(doc.campaign_id || ''),
      driverId: String(doc.driver_id || ''),
      graphicId: doc.graphic_id ? String(doc.graphic_id) : null,
      step: String(doc.step || ''),
      url: String(doc.url || ''),
      path: String(doc.path || ''),
      odometerValue: doc.odometer_value ?? null,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      source: isGridFsEvidence ? 'mongo' : String(doc.source || 'mongo-evidence'),
      driveFileId: doc.drive_file_id ? String(doc.drive_file_id) : null,
      messageId: doc.source_message_id ? String(doc.source_message_id) : null,
    };
  });
}

export async function getEvidenceRecordById(evidenceId) {
  const normalizedId = String(evidenceId || '').trim();
  if (!normalizedId) return null;
  const database = await getDb();
  let record = await database.collection(EVIDENCE_COLLECTION).findOne({ _id: normalizedId });
  if (!record && /^[a-f0-9]{24}$/i.test(normalizedId)) {
    record = await database.collection(EVIDENCE_COLLECTION).findOne({ _id: new ObjectId(normalizedId) });
  }
  return record;
}

export async function getReceivedEvidenceByDriveFileId(fileId) {
  const normalizedFileId = String(fileId || '').trim();
  if (!normalizedFileId) return null;
  const database = await getDb();
  return database.collection(EVIDENCE_COLLECTION).findOne({
    source_provider: 'gptmaker',
    drive_file_id: normalizedFileId,
    status: { $in: ['received', 'recebida'] },
  });
}

export async function deleteEvidenceRecord(evidenceId) {
  const database = await getDb();
  console.log('[mongo] deleteEvidenceRecord called with:', evidenceId);
  
  // Try with string id first (nanoid), then with ObjectId if that fails
  let result = await database.collection('evidence').deleteOne({ _id: evidenceId });
  console.log('[mongo] deleteEvidenceRecord first attempt (string):', { evidenceId, deletedCount: result.deletedCount });
  
  if (result.deletedCount === 0) {
    try {
      // Check if it's a valid ObjectId string and convert
      if (typeof evidenceId === 'string' && /^[a-f0-9]{24}$/i.test(evidenceId)) {
        const objId = new ObjectId(evidenceId);
        result = await database.collection('evidence').deleteOne({ _id: objId });
        console.log('[mongo] deleteEvidenceRecord second attempt (ObjectId):', { evidenceId, deletedCount: result.deletedCount });
      }
    } catch (e) {
      console.warn('[mongo] deleteEvidenceRecord ObjectId conversion error:', e.message);
    }
  }
  
  return result.deletedCount > 0;
}

export async function deleteStorageFile(storageFileId) {
  const database = await getDb();
  console.log('[mongo] deleteStorageFile called with:', storageFileId);
  
  // Resolve the ObjectId form (needed for GridFS bucket.delete)
  let resolvedOid = null;
  if (typeof storageFileId === 'string' && /^[a-f0-9]{24}$/i.test(storageFileId)) {
    try { resolvedOid = new ObjectId(storageFileId); } catch { /* ignore */ }
  } else if (storageFileId instanceof ObjectId) {
    resolvedOid = storageFileId;
  }

  // Remove metadata from storage_files (try string first, then ObjectId)
  let result = await database.collection(STORAGE_COLLECTION).deleteOne({ _id: storageFileId });
  console.log('[mongo] deleteStorageFile first attempt (string):', { storageFileId, deletedCount: result.deletedCount });
  
  if (result.deletedCount === 0 && resolvedOid) {
    try {
      result = await database.collection(STORAGE_COLLECTION).deleteOne({ _id: resolvedOid });
      console.log('[mongo] deleteStorageFile second attempt (ObjectId):', { storageFileId, deletedCount: result.deletedCount });
    } catch (e) {
      console.warn('[mongo] deleteStorageFile ObjectId conversion error:', e.message);
    }
  }

  // Also remove the GridFS binary blob to avoid orphaned data
  if (resolvedOid) {
    try {
      const bkt = await getBucket();
      await bkt.delete(resolvedOid);
      console.log('[mongo] deleteStorageFile GridFS blob deleted:', storageFileId);
    } catch (e) {
      // GridFS entry might not exist (already deleted or never uploaded to GridFS)
      console.warn('[mongo] deleteStorageFile GridFS delete skipped:', e.message);
    }
  }

  return result.deletedCount > 0;
}

export async function deleteStorageFilesByFolder(campaignId, driverId, dateFolder, uploaderType = null) {
  const database = await getDb();
  const filter = {
    campaignId,
    driverId,
    dateFolder
  };
  if (uploaderType) {
    filter.uploaderType = uploaderType;
  }
  console.log('[mongo] deleteStorageFilesByFolder filter:', filter);

  // Collect file IDs before deleting so we can purge GridFS blobs too
  const toDelete = await database.collection(STORAGE_COLLECTION)
    .find(filter)
    .project({ _id: 1 })
    .toArray();

  const result = await database.collection(STORAGE_COLLECTION).deleteMany(filter);
  console.log('[mongo] deleteStorageFilesByFolder result:', { deletedCount: result.deletedCount });

  // Purge GridFS blobs for each deleted metadata record
  if (toDelete.length > 0) {
    const bkt = await getBucket();
    for (const doc of toDelete) {
      try {
        const oid = doc._id instanceof ObjectId ? doc._id : new ObjectId(String(doc._id));
        await bkt.delete(oid);
      } catch (e) {
        console.warn('[mongo] deleteStorageFilesByFolder GridFS delete skipped for', doc._id, ':', e.message);
      }
    }
  }

  return result.deletedCount;
}

// Master records (campaign-specific driver data aggregation)
function campaignTableSlug(campaign) {
  const base = sanitizeName(campaign?.name || campaign?.id || 'campanha')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || `campanha_${String(campaign?.id || 'padrao').slice(0, 6).toLowerCase()}`;
}

export function getCampaignTableName(campaign) {
  const slug = campaignTableSlug(campaign);
  return `campanha_${slug}`;
}

export function getCampaignGraphicsTableName(campaign) {
  const slug = campaignTableSlug(campaign);
  return `campanha_${slug}_graficas`;
}

export async function ensureCampaignMasterTable(campaign, header = []) {
  // MongoDB doesn't require schema creation; collection is created on first insert
  const tableName = getCampaignTableName(campaign);
  const database = await getDb();
  // Optionally create index on id
  try {
    await database.collection(tableName).createIndex({ id: 1 }, { unique: true });
  } catch (e) {
    // index may exist
  }
  return { created: true, tableName };
}

export async function upsertCampaignMasterRows(campaign, drivers = [], header = []) {
  const database = await getDb();
  const tableName = getCampaignTableName(campaign);
  const rows = [];
  const cols = Array.isArray(header) ? header : [];
  const campFolder = `campanha-${sanitizeName(campaign?.name || campaign?.id)}`;

  for (const d of drivers) {
    try {
      const clone = JSON.parse(JSON.stringify(d || {}));
      const raw = applyCanonicalRaw(clone);
      const row = {
        _id: clone.id,
        id: clone.id,
        'CAMPANHA ID': campaign.id,
        'CAMPANHA NOME': campaign.name || '',
        'CAMPANHA PASTA': campFolder,
      };

      for (const col of cols) {
        if (raw[col] !== undefined && raw[col] !== null) row[col] = String(raw[col]);
        else row[col] = '';
      }
      if (!row['DRIVER ID']) row['DRIVER ID'] = clone.id;
      rows.push(row);
    } catch (err) {
      // ignore row-level serialization error
    }
  }

  if (!rows.length) return { inserted: 0, tableName };

  const coll = database.collection(tableName);
  for (const row of rows) {
    await coll.replaceOne({ _id: row._id }, row, { upsert: true });
  }

  return { inserted: rows.length, tableName };
}

export async function upsertMasterRecord(campaign, driver) {
  if (!campaign || !driver) return;
  const header = Array.isArray(campaign?.sheetHeader) && campaign.sheetHeader.length
    ? campaign.sheetHeader
    : Object.keys(driver?.raw || {});
  try {
    await ensureCampaignMasterTable(campaign, header);
  } catch (e) {
    console.warn('[mongo] upsertMasterRecord ensure table:', e?.message || e);
    return;
  }

  try {
    await upsertCampaignMasterRows(campaign, [driver], header);
  } catch (e) {
    console.warn('[mongo] upsertMasterRecord error:', e?.message || e);
  }
}

export async function deleteMastersByCampaign(campaign) {
  if (!campaign) return;
  const database = await getDb();
  const tableName = getCampaignTableName(campaign);
  try {
    await database.collection(tableName).deleteMany({});
  } catch (e) {
    console.warn('[mongo] deleteMastersByCampaign error:', e?.message || e);
  }

  try {
    await deleteCampaignGraphicsTable(campaign);
  } catch (e) {
    console.warn('[mongo] deleteCampaignGraphicsTable (by master):', e?.message || e);
  }
}

export async function deleteAllCampaignData(campaignId) {
  if (!campaignId) return;
  const database = await getDb();
  const bucket = await getBucket();

  console.log(`[mongo] Deleting all data for campaign: ${campaignId}`);

  // 1. Delete storage files + underlying GridFS blobs
  try {
    const storageFiles = await database.collection(STORAGE_COLLECTION)
      .find({ campaignId })
      .project({ _id: 1 })
      .toArray();

    for (const file of storageFiles) {
      const fileId = file?._id;
      if (!fileId) continue;
      try {
        const oid = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
        await bucket.delete(oid);
      } catch (err) {
        console.warn('[mongo] deleteAllCampaignData - gridfs delete error:', err?.message || err);
      }
    }

    const storageResult = await database.collection(STORAGE_COLLECTION).deleteMany({ campaignId });
    console.log(`[mongo] Deleted ${storageResult.deletedCount} storage files`);
  } catch (e) {
    console.warn('[mongo] deleteAllCampaignData - storage_files error:', e?.message || e);
  }

  // 2. Delete evidence records
  try {
    const evidenceResult = await database.collection(EVIDENCE_COLLECTION).deleteMany({ campaign_id: campaignId });
    console.log(`[mongo] Deleted ${evidenceResult.deletedCount} evidence records`);
  } catch (e) {
    console.warn('[mongo] deleteAllCampaignData - evidence error:', e?.message || e);
  }

  // 3. Delete drivers
  try {
    const driversResult = await database.collection(DRIVERS_COLLECTION).deleteMany({ campaign_id: campaignId });
    console.log(`[mongo] Deleted ${driversResult.deletedCount} drivers`);
  } catch (e) {
    console.warn('[mongo] deleteAllCampaignData - drivers error:', e?.message || e);
  }

  // 4. Delete graphics
  try {
    const graphicsResult = await database.collection(GRAPHICS_COLLECTION).deleteMany({ campaign_id: campaignId });
    console.log(`[mongo] Deleted ${graphicsResult.deletedCount} graphics`);
  } catch (e) {
    console.warn('[mongo] deleteAllCampaignData - graphics error:', e?.message || e);
  }

  // 5. Delete campaign record
  try {
    const campaignResult = await database.collection(CAMPAIGNS_COLLECTION).deleteOne({ _id: campaignId });
    console.log(`[mongo] Deleted ${campaignResult.deletedCount} campaign record`);
  } catch (e) {
    console.warn('[mongo] deleteAllCampaignData - campaign error:', e?.message || e);
  }

  console.log(`[mongo] Campaign ${campaignId} deletion complete`);
}

export async function deleteMasterByDriver(campaign, driverId) {
  if (!campaign || !driverId) return;
  const database = await getDb();
  const tableName = getCampaignTableName(campaign);
  try {
    await database.collection(tableName).deleteOne({ _id: driverId });
  } catch (e) {
    console.warn('[mongo] deleteMasterByDriver error:', e?.message || e);
  }
}

export async function ensureDatabaseSchema() {
  const database = await getDb();
  await Promise.all([
    database.collection(EVIDENCE_COLLECTION).createIndex({ campaign_id: 1, step: 1, created_at: 1 }),
    database.collection(EVIDENCE_COLLECTION).createIndex({ campaign_id: 1, driver_id: 1, created_at: -1 }),
    database.collection(CAMPAIGN_DRIVER_DETACHMENTS_COLLECTION)
      .createIndex({ campaignId: 1, status: 1, driverId: 1 }),
    database.collection(CAMPAIGN_DRIVER_OVERRIDES_COLLECTION)
      .createIndex({ campaignId: 1, driverId: 1 }),
  ]);
  return { created: true };
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (typeof id === 'string') return new ObjectId(id);
  throw new Error('ObjectId invalido');
}

export async function getStorageFileMetadata(fileId) {
  const database = await getDb();
  const _id = toObjectId(fileId);
  return database.collection(STORAGE_COLLECTION).findOne({ _id });
}

export async function openStorageFileStream(fileId) {
  const bucket = await getBucket();
  const _id = toObjectId(fileId);
  return bucket.openDownloadStream(_id);
}

export async function findDriverByIdentityMongo({ name, phone }) {
  const database = await getDb();
  const normalizedName = normalizeName(String(name || ''));
  const phoneDigits = sanitizeDigits(phone);
  const query = {};
  if (normalizedName) query.name_key = normalizedName;
  if (phoneDigits) query.phone_digits = { $in: Array.from(buildPhoneVariants(phoneDigits)) };
  if (!Object.keys(query).length) return null;

  let docs = await database.collection(DRIVERS_COLLECTION).find(query).limit(20).toArray();
  if (!docs.length && normalizedName) {
    docs = await database.collection(DRIVERS_COLLECTION).find({ name_key: normalizedName }).limit(5).toArray();
  }
  if (!docs.length) return null;

  let match = docs.find(doc => (phoneDigits ? phoneMatchesStored(doc.phone_digits, phoneDigits) : true));
  if (!match) match = docs[0];
  if (!match) return null;

  return {
    id: String(match._id),
    campaignId: match.campaign_id != null ? String(match.campaign_id) : null,
    driverCampaignId: match.driver_campaign_id ? String(match.driver_campaign_id) : null,
    name: match.name || '',
    nameKey: match.name_key || normalizeName(String(match.name || '')),
    phone: match.phone || null,
    phoneDigits: match.phone_digits || null,
    status: match.status || '',
    city: match.city || null,
    plate: match.plate || null,
    adhesionStartAt: match.adhesion_start_at ? new Date(match.adhesion_start_at).getTime() : null,
    adhesionStartRaw: match.adhesion_start_raw || null,
    adhesionEndAt: match.adhesion_end_at ? new Date(match.adhesion_end_at).getTime() : null,
    adhesionEndRaw: match.adhesion_end_raw || null,
    adhesionStatus: match.adhesion_status || null,
    createdAt: match.created_at ? new Date(match.created_at).getTime() : null,
    updatedAt: match.updated_at ? new Date(match.updated_at).getTime() : null,
  };
}

export async function listCampaignDriversRecords(campaignId) {
  if (!campaignId) return [];
  const database = await getDb();
  const campaignIdString = String(campaignId);
  const queryOptions = [{ campaign_id: campaignId }, { campaign_id: campaignIdString }];
  if (ObjectId.isValid(campaignIdString)) {
    try {
      queryOptions.push({ campaign_id: new ObjectId(campaignIdString) });
    } catch {
      // ignore invalid ObjectId conversion edge-cases
    }
  }
  const query = campaignIdString ? { $or: queryOptions } : { campaign_id: campaignId };
  const docs = await database
    .collection(DRIVERS_COLLECTION)
    .find(query)
    .toArray();

  return docs.map(doc => ({
    id: String(doc._id),
    campaignId: doc.campaign_id != null ? String(doc.campaign_id) : null,
    driverCampaignId: doc.driver_campaign_id ? String(doc.driver_campaign_id) : null,
    name: doc.name || '',
    nameKey: doc.name_key || normalizeName(String(doc.name || '')),
    phone: doc.phone || null,
    phoneDigits: doc.phone_digits || null,
    status: doc.status || '',
    city: doc.city || null,
    plate: doc.plate || null,
    email: doc.email || null,
    cpf: doc.cpf || null,
    pix: doc.pix || null,
    adhesionStartAt: doc.adhesion_start_at ? new Date(doc.adhesion_start_at).getTime() : null,
    adhesionStartRaw: doc.adhesion_start_raw || null,
    adhesionEndAt: doc.adhesion_end_at ? new Date(doc.adhesion_end_at).getTime() : null,
    adhesionEndRaw: doc.adhesion_end_raw || null,
    adhesionStatus: doc.adhesion_status || null,
    raw: doc.raw && typeof doc.raw === 'object' ? { ...doc.raw } : {},
    createdAt: doc.created_at ? new Date(doc.created_at).getTime() : null,
    updatedAt: doc.updated_at ? new Date(doc.updated_at).getTime() : null,
  }));
}

export async function getCampaignRecordById(campaignId) {
  if (!campaignId) return null;
  const database = await getDb();
  const doc = await database.collection(CAMPAIGNS_COLLECTION).findOne({ _id: campaignId });
  if (!doc) return null;
  const campaign = {
    id: String(doc._id),
    name: doc.name || '',
    client: doc.client || '',
    period: doc.period || '',
    status: doc.status || '',
    campaignCode: doc.campaign_code || '',
    sheetId: doc.sheet_id || null,
    sheetName: doc.sheet_name || null,
    kmSheetId: doc.km_sheet_id || null,
    kmSheetName: doc.km_sheet_name || null,
    kmPeriods: Number.isFinite(Number(doc.km_periods)) ? Number(doc.km_periods) : null,
    driverCooldownDays: Number.isFinite(Number(doc.driver_cooldown_days))
      ? Number(doc.driver_cooldown_days)
      : null,
    graphicCooldownDays: Number.isFinite(Number(doc.graphic_cooldown_days))
      ? Number(doc.graphic_cooldown_days)
      : null,
    driveFolderId: doc.drive_folder_id || null,
    createdAt: doc.created_at ? new Date(doc.created_at).getTime() : null,
    updatedAt: doc.updated_at ? new Date(doc.updated_at).getTime() : null,
  };
  campaign.kmGoal = getCampaignKmGoal(campaign, 0);
  campaign.kmMinimumPerDriver = campaign.kmGoal.perDriver;
  campaign.minKmPerDriver = campaign.kmGoal.perDriver;
  return campaign;
}

export async function findCampaignByCodeMongo(campaignCode) {
  if (!campaignCode) return null;
  const database = await getDb();
  const doc = await database.collection(CAMPAIGNS_COLLECTION).findOne({ campaign_code: campaignCode });
  if (!doc) return null;
  const campaign = {
    id: String(doc._id),
    name: doc.name || '',
    client: doc.client || '',
    period: doc.period || '',
    status: doc.status || '',
    campaignCode: doc.campaign_code || campaignCode,
    sheetId: doc.sheet_id || null,
    sheetName: doc.sheet_name || null,
    kmSheetId: doc.km_sheet_id || null,
    kmSheetName: doc.km_sheet_name || null,
    kmPeriods: Number.isFinite(Number(doc.km_periods)) ? Number(doc.km_periods) : null,
    driverCooldownDays: Number.isFinite(Number(doc.driver_cooldown_days))
      ? Number(doc.driver_cooldown_days)
      : null,
    graphicCooldownDays: Number.isFinite(Number(doc.graphic_cooldown_days))
      ? Number(doc.graphic_cooldown_days)
      : null,
    driveFolderId: doc.drive_folder_id || null,
    createdAt: doc.created_at ? new Date(doc.created_at).getTime() : null,
    updatedAt: doc.updated_at ? new Date(doc.updated_at).getTime() : null,
  };
  campaign.kmGoal = getCampaignKmGoal(campaign, 0);
  campaign.kmMinimumPerDriver = campaign.kmGoal.perDriver;
  campaign.minKmPerDriver = campaign.kmGoal.perDriver;
  return campaign;
}

export async function listCampaignGraphicsRecords(campaign) {
  if (!campaign) return [];
  const database = await getDb();
  const tableName = getCampaignGraphicsTableName(campaign);
  try {
    const docs = await database.collection(tableName).find({}).toArray();
    return docs;
  } catch (err) {
    console.warn('[mongo] listCampaignGraphicsRecords error:', err?.message || err);
    return [];
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findDriverRowInMasterTables({ name, phone }) {
  const normalizedName = normalizeName(String(name || ''));
  const phoneDigits = sanitizeDigits(phone);
  if (!normalizedName || !phoneDigits) return null;

  const database = await getDb();
  const campaignDocs = await database
    .collection(CAMPAIGNS_COLLECTION)
    .find({}, { projection: { _id: 1, name: 1 } })
    .toArray();

  const sources = campaignDocs.map(doc => ({
    tableName: getCampaignTableName({ id: doc._id, name: doc.name }),
    campaignId: doc._id,
    campaignName: doc.name || '',
  }));

  const seenTables = new Set(sources.map(src => src.tableName));
  try {
    const collections = await database.listCollections({}, { nameOnly: true }).toArray();
    for (const coll of collections) {
      const collectionName = coll.name;
      if (!collectionName.startsWith('campanha_')) continue;
      if (seenTables.has(collectionName)) continue;
      const readable = collectionName.replace(/^campanha_/, '').replace(/_/g, ' ');
      sources.push({ tableName: collectionName, campaignId: null, campaignName: readable });
      seenTables.add(collectionName);
    }
  } catch {
    // ignore listCollections errors (older Mongo clusters)
  }

  const regex = new RegExp(`^${escapeRegex(String(name || '').trim())}$`, 'i');
  const nameFields = ['Nome', 'NOME', 'nome', 'Motorista'];

  for (const source of sources) {
    let rows = [];
    try {
      const query = { $or: nameFields.map(field => ({ [field]: { $regex: regex } })) };
      rows = await database
        .collection(source.tableName)
        .find(query, {
          projection: {
            _id: 1,
            id: 1,
            'DRIVER ID': 1,
            Nome: 1,
            NOME: 1,
            nome: 1,
            Motorista: 1,
            Status: 1,
            status: 1,
            Numero: 1,
            'Numero ': 1,
            'Número': 1,
            'NÚMERO': 1,
            Telefone: 1,
            telefone: 1,
            Celular: 1,
            CELULAR: 1,
            WhatsApp: 1,
            CPF: 1,
            cpf: 1,
            Email: 1,
            EMAIL: 1,
            email: 1,
            Placa: 1,
            PLACA: 1,
            placa: 1,
            PIX: 1,
            Pix: 1,
            pix: 1,
            Cidade: 1,
            cidade: 1,
            'CAMPANHA ID': 1,
            'CAMPANHA NOME': 1,
          },
        })
        .limit(8)
        .toArray();
    } catch {
      rows = [];
    }

    for (const row of rows) {
      const rowName =
        String(row.Nome || row.NOME || row.nome || row.Motorista || '').trim();
      if (!rowName || normalizeName(rowName) !== normalizedName) continue;
      const phoneRaw =
        row.Numero ||
        row['Numero '] ||
        row['Número'] ||
        row['NÚMERO'] ||
        row.Telefone ||
        row.telefone ||
        row.Celular ||
        row.CELULAR ||
        row.WhatsApp ||
        '';
      if (!phoneMatchesStored(sanitizeDigits(phoneRaw), phoneDigits)) continue;

      return {
        campaignId: row['CAMPANHA ID'] || source.campaignId,
        campaignName: row['CAMPANHA NOME'] || source.campaignName || '',
        row,
        driverId: row.id || row._id || row['DRIVER ID'] || null,
      };
    }
  }

  return null;
}

// Graphics (gráficas) management
const GRAPHIC_COLUMNS = [
  'GRAFICA NOME',
  'GRAFICA EMAIL',
  'GRAFICA TELEFONE',
  'RESPONSAVEL 1 NOME',
  'RESPONSAVEL 1 TELEFONE',
  'RESPONSAVEL 2 NOME',
  'RESPONSAVEL 2 TELEFONE',
  'OBSERVACOES',
];

export async function ensureCampaignGraphicsTable(campaign, columns = GRAPHIC_COLUMNS) {
  const tableName = getCampaignGraphicsTableName(campaign);
  const database = await getDb();
  try {
    await database.collection(tableName).createIndex({ id: 1 }, { unique: true });
  } catch (e) {
    // index may exist
  }
  return { created: true, tableName };
}

export async function upsertCampaignGraphicsRows(campaign, graphics = []) {
  const database = await getDb();
  const tableName = getCampaignGraphicsTableName(campaign);
  const campFolder = `campanha-${sanitizeName(campaign?.name || campaign?.id)}`;

  const rows = (graphics || []).map(g => ({
    _id: g.id,
    id: g.id,
    'CAMPANHA ID': campaign.id,
    'CAMPANHA NOME': campaign.name || '',
    'CAMPANHA PASTA': campFolder,
    'GRAFICA NOME': g.name || '',
    'GRAFICA EMAIL': g.email || '',
    'GRAFICA TELEFONE': g.phone || '',
    'RESPONSAVEL 1 NOME': g.responsible1Name || '',
    'RESPONSAVEL 1 TELEFONE': g.responsible1Phone || '',
    'RESPONSAVEL 2 NOME': g.responsible2Name || '',
    'RESPONSAVEL 2 TELEFONE': g.responsible2Phone || '',
    'OBSERVACOES': g.notes || '',
  }));

  if (!rows.length) return { inserted: 0, tableName };

  const coll = database.collection(tableName);
  for (const row of rows) {
    await coll.replaceOne({ _id: row._id }, row, { upsert: true });
  }

  return { inserted: rows.length, tableName };
}

export async function deleteCampaignGraphicsTable(campaign) {
  if (!campaign) return;
  const database = await getDb();
  const tableName = getCampaignGraphicsTableName(campaign);
  try {
    await database.collection(tableName).deleteMany({});
  } catch (e) {
    console.warn('[mongo] deleteCampaignGraphicsTable error:', e?.message || e);
  }
}

export async function deleteGraphicRow(campaign, graphicId) {
  if (!campaign || !graphicId) return;
  const database = await getDb();
  const tableName = getCampaignGraphicsTableName(campaign);
  try {
    await database.collection(tableName).deleteOne({ _id: graphicId });
  } catch (e) {
    console.warn('[mongo] deleteGraphicRow error:', e?.message || e);
  }
}

// ==================== ADMIN USERS ====================

export async function findAdminUserByUsername(username) {
  const database = await getDb();
  const col = database.collection(ADMIN_USERS_COLLECTION);
  const user = await col.findOne({ username: String(username).toLowerCase().trim() });
  return user;
}

export async function createAdminUser(userData) {
  const database = await getDb();
  const col = database.collection(ADMIN_USERS_COLLECTION);
  const doc = {
    username: String(userData.username).toLowerCase().trim(),
    passwordHash: userData.passwordHash,
    name: userData.name || userData.username,
    email: userData.email || null,
    role: userData.role || 'admin',
    active: userData.active !== false,
    createdAt: Date.now(),
    createdBy: userData.createdBy || 'system',
    updatedAt: Date.now(),
  };
  const result = await col.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function listAdminUsers() {
  const database = await getDb();
  const col = database.collection(ADMIN_USERS_COLLECTION);
  const users = await col.find({}).sort({ createdAt: -1 }).toArray();
  return users;
}

export async function updateAdminUser(userId, updates) {
  const database = await getDb();
  const col = database.collection(ADMIN_USERS_COLLECTION);
  const updateDoc = { $set: { ...updates, updatedAt: Date.now() } };
  await col.updateOne({ _id: new ObjectId(userId) }, updateDoc);
}

export async function findAdminUserById(userId) {
  if (!userId) return null;
  const database = await getDb();
  const col = database.collection(ADMIN_USERS_COLLECTION);
  try {
    return await col.findOne({ _id: new ObjectId(userId) });
  } catch (_) {
    return null;
  }
}

// ==================== AUDIT LOG ====================

export async function insertAuditLog(logEntry) {
  const database = await getDb();
  const col = database.collection(AUDIT_LOG_COLLECTION);
  const doc = {
    userId: logEntry.userId ? new ObjectId(logEntry.userId) : null,
    username: logEntry.username || 'unknown',
    name: logEntry.name || logEntry.username || 'Unknown',
    action: logEntry.action || 'unknown',
    entityType: logEntry.entityType || null,
    entityId: logEntry.entityId || null,
    details: logEntry.details || {},
    ipAddress: logEntry.ipAddress || null,
    userAgent: logEntry.userAgent || null,
    timestamp: logEntry.timestamp || Date.now(),
    success: logEntry.success !== false,
  };
  const result = await col.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function listAuditLogs(filters = {}, options = {}) {
  const database = await getDb();
  const col = database.collection(AUDIT_LOG_COLLECTION);
  const query = {};
  
  if (filters.username) query.username = filters.username;
  if (filters.action) query.action = filters.action;
  if (filters.entityType) query.entityType = filters.entityType;
  if (filters.entityId) query.entityId = filters.entityId;
  if (filters.startDate) query.timestamp = { $gte: filters.startDate };
  if (filters.endDate) query.timestamp = { ...query.timestamp, $lte: filters.endDate };
  
  const limit = options.limit || 100;
  const skip = options.skip || 0;
  
  const logs = await col.find(query)
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
  
  return logs;
}

/**
 * Apaga TODOS os registros do audit log. Usado pelo botao "Limpar tudo".
 */
export async function clearAllAuditLogs() {
  const database = await getDb();
  const col = database.collection(AUDIT_LOG_COLLECTION);
  const result = await col.deleteMany({});
  return { deletedCount: result.deletedCount || 0 };
}

/**
 * Lista eventos do audit log relacionados a uma campanha, com paginacao
 * por cursor (timestamp). Retorna logs onde:
 *   - entityType='campaign' AND entityId=campaignId, OU
 *   - details.campaignId = campaignId (uploads, drivers etc.)
 *
 * @param {string} campaignId
 * @param {{ cursorTs?:number, limit?:number }} options
 * @returns {Promise<{ items:object[], nextCursor:number|null }>}
 */
export async function listCampaignHistory(campaignId, options = {}) {
  if (!campaignId) return { items: [], nextCursor: null };
  const database = await getDb();
  const col = database.collection(AUDIT_LOG_COLLECTION);
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const cursorTs = Number(options.cursorTs);

  const orQuery = [
    { entityType: 'campaign', entityId: campaignId },
    { 'details.campaignId': campaignId },
  ];
  const query = { $or: orQuery };
  if (Number.isFinite(cursorTs) && cursorTs > 0) {
    query.timestamp = { $lt: cursorTs };
  }

  // Busca limit+1 para detectar pagina seguinte
  const docs = await col.find(query)
    .sort({ timestamp: -1 })
    .limit(limit + 1)
    .toArray();

  let nextCursor = null;
  if (docs.length > limit) {
    const last = docs[limit - 1];
    nextCursor = Number(last?.timestamp) || null;
    docs.length = limit;
  }

  return { items: docs, nextCursor };
}

// ============================================
// REPRESENTATIVE REQUESTS
// ============================================

export async function createRepresentativeRequest(requestData) {
  const database = await getDb();
  const now = new Date();
  const doc = {
    ...requestData,
    createdAt: now,
    updatedAt: now,
  };
  const result = await database.collection(REPRESENTATIVE_REQUESTS_COLLECTION).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function listRepresentativeRequests() {
  const database = await getDb();
  const requests = await database
    .collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  return requests;
}

export async function getRepresentativeRequestById(requestId) {
  const database = await getDb();
  const request = await database
    .collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .findOne({ id: requestId });
  return request;
}

export async function updateRepresentativeRequestStatus(requestId, status) {
  const database = await getDb();
  const result = await database
    .collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .updateOne(
      { id: requestId },
      { 
        $set: { 
          status, 
          updatedAt: new Date() 
        } 
      }
    );
  if (result.matchedCount === 0) {
    throw new Error('Solicitação não encontrada');
  }
  return await getRepresentativeRequestById(requestId);
}

export async function updateRepresentativeRequest(requestId, updates) {
  const database = await getDb();
  const result = await database
    .collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .updateOne(
      { id: requestId },
      { 
        $set: { 
          ...updates,
          updatedAt: new Date() 
        } 
      }
    );
  if (result.matchedCount === 0) {
    throw new Error('Solicitação não encontrada');
  }
  return await getRepresentativeRequestById(requestId);
}

export async function deleteRepresentativeRequest(requestId) {
  const database = await getDb();
  const result = await database
    .collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .deleteOne({ id: requestId });
  return result.deletedCount > 0;
}

export async function upsertDriverScore(phone, scoreDoc) {
  if (!phone || typeof phone !== 'string') throw new Error('phone obrigatório');
  const database = await getDb();
  await database.collection('driver_scores').updateOne(
    { _id: phone },
    { $set: { ...scoreDoc, _id: phone, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function getDriverScore(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const database = await getDb();
  return database.collection('driver_scores').findOne({ _id: phone });
}

export async function upsertCampaignSettings(campaignId, settings) {
  const database = await getDb();
  await database.collection('campaign_settings').updateOne(
    { _id: campaignId },
    { $set: { ...settings, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function getCampaignSettingsByIds(campaignIds) {
  if (!campaignIds || !campaignIds.length) return new Map();
  const database = await getDb();
  const docs = await database.collection('campaign_settings')
    .find({ _id: { $in: campaignIds } })
    .toArray();
  return new Map(docs.map(d => [String(d._id), d]));
}

export async function detachCampaignDriver({
  campaignId,
  driverId,
  driverCampaignId = '',
  campaignName = '',
  driverName = '',
  detachedBy = null,
} = {}) {
  const normalizedCampaignId = String(campaignId || '').trim();
  const normalizedDriverId = String(driverId || '').trim();
  const normalizedDriverCampaignId = String(driverCampaignId || '').trim();
  if (!normalizedCampaignId || !normalizedDriverId) {
    throw new Error('campaignId e driverId sao obrigatorios');
  }

  const database = await getDb();
  const now = new Date();
  const id = `${normalizedCampaignId}:${normalizedDriverId}`;
  await database.collection(CAMPAIGN_DRIVER_DETACHMENTS_COLLECTION).updateOne(
    { _id: id },
    {
      $set: {
        campaignId: normalizedCampaignId,
        driverId: normalizedDriverId,
        driverCampaignId: normalizedDriverCampaignId || null,
        campaignName: String(campaignName || '').trim(),
        driverName: String(driverName || '').trim(),
        status: 'detached',
        detachedBy: detachedBy && typeof detachedBy === 'object' ? {
          id: String(detachedBy.id || '').trim() || null,
          username: String(detachedBy.username || '').trim() || null,
          name: String(detachedBy.name || '').trim() || null,
        } : null,
        detachedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return {
    campaignId: normalizedCampaignId,
    driverId: normalizedDriverId,
    driverCampaignId: normalizedDriverCampaignId || null,
    detachedAt: now,
  };
}

export async function restoreCampaignDriver({
  campaignId,
  driverId,
  restoredBy = null,
} = {}) {
  const normalizedCampaignId = String(campaignId || '').trim();
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedCampaignId || !normalizedDriverId) {
    throw new Error('campaignId e driverId sao obrigatorios');
  }

  const database = await getDb();
  const now = new Date();
  const result = await database.collection(CAMPAIGN_DRIVER_DETACHMENTS_COLLECTION).updateOne(
    { _id: `${normalizedCampaignId}:${normalizedDriverId}`, status: 'detached' },
    {
      $set: {
        status: 'restored',
        restoredBy: restoredBy && typeof restoredBy === 'object' ? {
          id: String(restoredBy.id || '').trim() || null,
          username: String(restoredBy.username || '').trim() || null,
          name: String(restoredBy.name || '').trim() || null,
        } : null,
        restoredAt: now,
        updatedAt: now,
      },
    },
  );

  return {
    campaignId: normalizedCampaignId,
    driverId: normalizedDriverId,
    restored: result.modifiedCount > 0,
  };
}

export async function listCampaignDriverDetachments(campaignIds = []) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(campaignIds) ? campaignIds : [campaignIds])
      .map(value => String(value || '').trim())
      .filter(Boolean),
  ));
  const database = await getDb();
  const query = { status: 'detached' };
  if (normalizedIds.length) query.campaignId = { $in: normalizedIds };

  return database.collection(CAMPAIGN_DRIVER_DETACHMENTS_COLLECTION)
    .find(query, { projection: { campaignId: 1, driverId: 1, driverCampaignId: 1, detachedAt: 1 } })
    .toArray();
}

export async function listDetachedDriverIdsByCampaign(campaignId) {
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!normalizedCampaignId) return new Set();
  const docs = await listCampaignDriverDetachments([normalizedCampaignId]);
  return new Set(docs.map(doc => String(doc.driverId || '').trim()).filter(Boolean));
}

export async function isCampaignDriverDetached(campaignId, driverId, driverCampaignId = '') {
  const normalizedCampaignId = String(campaignId || '').trim();
  const normalizedDriverId = String(driverId || '').trim();
  const normalizedDriverCampaignId = String(driverCampaignId || '').trim();
  if (!normalizedCampaignId || !normalizedDriverId) return false;
  const database = await getDb();
  const doc = await database.collection(CAMPAIGN_DRIVER_DETACHMENTS_COLLECTION).findOne(
    { _id: `${normalizedCampaignId}:${normalizedDriverId}`, status: 'detached' },
    { projection: { _id: 1, driverCampaignId: 1 } },
  );
  if (!doc) return false;

  const detachedDriverCampaignId = String(doc.driverCampaignId || '').trim();
  if (
    detachedDriverCampaignId &&
    normalizedDriverCampaignId &&
    detachedDriverCampaignId !== normalizedDriverCampaignId
  ) {
    return false;
  }
  return true;
}

function normalizeCampaignDriverOverrideKey(campaignId, driverId) {
  const normalizedCampaignId = String(campaignId || '').trim();
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedCampaignId || !normalizedDriverId) {
    throw new Error('campaignId e driverId sao obrigatorios');
  }
  return {
    campaignId: normalizedCampaignId,
    driverId: normalizedDriverId,
    id: `${normalizedCampaignId}:${normalizedDriverId}`,
  };
}

function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function normalizeOverrideAdmin(admin) {
  if (!admin || typeof admin !== 'object') return null;
  return compactObject({
    id: admin.id != null ? String(admin.id).trim() : null,
    username: admin.username != null ? String(admin.username).trim() : null,
    name: admin.name != null ? String(admin.name).trim() : null,
  });
}

export async function upsertCampaignDriverOverride({
  campaignId,
  driverId,
  driverCampaignId = '',
  campaignName = '',
  driverName = '',
  fields = {},
  patch = {},
  updatedBy = null,
} = {}) {
  const key = normalizeCampaignDriverOverrideKey(campaignId, driverId);
  const database = await getDb();
  const collection = database.collection(CAMPAIGN_DRIVER_OVERRIDES_COLLECTION);
  const now = new Date();
  const existing = await collection.findOne(
    { _id: key.id },
    { projection: { fields: 1, patch: 1 } },
  );
  const existingFields = existing?.fields && typeof existing.fields === 'object' && !Array.isArray(existing.fields)
    ? existing.fields
    : {};
  const existingPatch = existing?.patch && typeof existing.patch === 'object' && !Array.isArray(existing.patch)
    ? existing.patch
    : {};
  const normalizedFields = fields && typeof fields === 'object' && !Array.isArray(fields)
    ? {
      ...existingFields,
      ...compactObject(fields),
    }
    : existingFields;
  const normalizedPatch = patch && typeof patch === 'object' && !Array.isArray(patch)
    ? {
      ...existingPatch,
      ...compactObject(patch),
    }
    : existingPatch;

  await collection.updateOne(
    { _id: key.id },
    {
      $set: {
        campaignId: key.campaignId,
        driverId: key.driverId,
        driverCampaignId: String(driverCampaignId || '').trim() || null,
        campaignName: String(campaignName || '').trim(),
        driverName: String(driverName || '').trim(),
        fields: normalizedFields,
        patch: normalizedPatch,
        updatedBy: normalizeOverrideAdmin(updatedBy),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return {
    campaignId: key.campaignId,
    driverId: key.driverId,
    driverCampaignId: String(driverCampaignId || '').trim() || null,
    updatedAt: now,
  };
}

export async function getCampaignDriverOverride(campaignId, driverId) {
  let key;
  try {
    key = normalizeCampaignDriverOverrideKey(campaignId, driverId);
  } catch {
    return null;
  }
  const database = await getDb();
  return database.collection(CAMPAIGN_DRIVER_OVERRIDES_COLLECTION).findOne(
    { _id: key.id },
    {
      projection: {
        campaignId: 1,
        driverId: 1,
        driverCampaignId: 1,
        fields: 1,
        patch: 1,
        updatedAt: 1,
      },
    },
  );
}

export async function listCampaignDriverOverrides(campaignIds = []) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(campaignIds) ? campaignIds : [campaignIds])
      .map(value => String(value || '').trim())
      .filter(Boolean),
  ));
  if (!normalizedIds.length) return [];
  const database = await getDb();
  return database.collection(CAMPAIGN_DRIVER_OVERRIDES_COLLECTION)
    .find(
      { campaignId: { $in: normalizedIds } },
      {
        projection: {
          campaignId: 1,
          driverId: 1,
          driverCampaignId: 1,
          fields: 1,
          patch: 1,
          updatedAt: 1,
        },
      },
    )
    .toArray();
}

export default {
  uploadBase64ImageMongo,
  getDriverStorageBasePath,
  listDriverStorageTree,
  listStorageEntriesByCampaign,
  upsertCampaignRecord,
  upsertDriverRecord,
  insertEvidenceRecord,
  listOdometerEvidenceByCampaign,
  listEvidenceByCampaign,
  getEvidenceRecordById,
  getReceivedEvidenceByDriveFileId,
  deleteEvidenceRecord,
  deleteStorageFile,
  deleteStorageFilesByFolder,
  upsertMasterRecord,
  deleteMastersByCampaign,
  deleteAllCampaignData,
  deleteMasterByDriver,
  ensureDatabaseSchema,
  getCampaignTableName,
  getCampaignGraphicsTableName,
  ensureCampaignMasterTable,
  upsertCampaignMasterRows,
  ensureCampaignGraphicsTable,
  upsertCampaignGraphicsRows,
  deleteCampaignGraphicsTable,
  deleteGraphicRow,
  getDb,
  getStorageFileMetadata,
  openStorageFileStream,
  findDriverByIdentityMongo,
  getCampaignRecordById,
  findCampaignByCodeMongo,
  listCampaignGraphicsRecords,
  findDriverRowInMasterTables,
  findAdminUserByUsername,
  createAdminUser,
  listAdminUsers,
  updateAdminUser,
  insertAuditLog,
  listAuditLogs,
  clearAllAuditLogs,
  createRepresentativeRequest,
  listRepresentativeRequests,
  getRepresentativeRequestById,
  updateRepresentativeRequestStatus,
  updateRepresentativeRequest,
  deleteRepresentativeRequest,
  upsertCampaignSettings,
  getCampaignSettingsByIds,
  detachCampaignDriver,
  restoreCampaignDriver,
  listCampaignDriverDetachments,
  listDetachedDriverIdsByCampaign,
  isCampaignDriverDetached,
  upsertCampaignDriverOverride,
  getCampaignDriverOverride,
  listCampaignDriverOverrides,
  upsertDriverScore,
  getDriverScore,
};
