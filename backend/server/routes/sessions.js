import { Router } from 'express';
import { nanoid } from 'nanoid';
import { normalizeName, normalizeStatus } from '../lib/normalize.js';
import { normalizeMasterKey } from '../lib/masterHeader.js';
import { applyCanonicalRaw, buildSheetRowValues } from '../lib/driverSheet.js';
import { applyDriverKmSummary, parseKmNumber } from '../lib/driverKm.js';
import { DRIVER_FLOW, GRAPHIC_FLOW, DRIVER_REQUIRED_STEPS, GRAPHIC_REQUIRED_STEPS } from '../lib/flows.js';
import { readSheetHeader, updateSheetRow } from '../services/sheets.js';
import {
  uploadBase64ImageMongo,
  upsertCampaignRecord,
  upsertDriverRecord,
  insertEvidenceRecord,
  upsertMasterRecord,
  findDriverByIdentityMongo,
  listCampaignDriversRecords,
  getCampaignRecordById,
  findCampaignByCodeMongo,
  listCampaignGraphicsRecords,
  findDriverRowInMasterTables,
  // API OdDrive (fase 4)
  findDriverByIdentity,
  fetchCampaignById,
  fetchDriversByCampaign,
  filterDetachedCampaignDrivers,
  isCampaignDriverDetached,
} from '../services/db.js';
import { ensureLegacyStoreReady, loadLegacyDb, saveLegacyDb } from '../services/legacyStore.js';
import { createUserSession, deleteUserSession, getUserSession } from '../services/sessionStore.js';
import { validateDriverLogin, validateGraphicLogin, validateBase64Image } from '../middleware/validators.js';

const DETAILED_GRAPHIC_ERRORS = process.env.DETAILED_GRAPHIC_ERRORS === '1';

await ensureLegacyStoreReady();

const router = Router();

// Health check endpoint (público, sem autenticação)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

function loadDB() {
  const db = loadLegacyDb();
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.evidence = Array.isArray(db.evidence) ? db.evidence : [];
  db.settings = db.settings || {};
  db.drivers = Array.isArray(db.drivers) ? db.drivers : [];
  db.campaigns = Array.isArray(db.campaigns) ? db.campaigns : [];
  db.graphics = Array.isArray(db.graphics) ? db.graphics : [];
  return db;
}

function saveDB(db) {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  if (!Array.isArray(db.evidence)) db.evidence = [];
  saveLegacyDb(db);
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function formatSheetDate(timestamp) {
  const date = new Date(timestamp || Date.now());
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatSheetTime(timestamp) {
  const date = new Date(timestamp || Date.now());
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildCompletionStatus(entries = [], required = []) {
  const requiredSet = new Set(required || []);
  const seen = new Set();
  let lastUploadAt = null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry?.step) continue;
    seen.add(String(entry.step).trim());
    const ts = Number(entry.createdAt || entry.uploadedAt);
    if (Number.isFinite(ts)) lastUploadAt = lastUploadAt ? Math.max(lastUploadAt, ts) : ts;
  }
  const completed = requiredSet.size === 0 ? entries.length > 0 : Array.from(requiredSet).every(id => seen.has(id));
  return {
    completed,
    pendingSteps: Array.from(requiredSet).filter(id => !seen.has(id)),
    totalUploads: Array.isArray(entries) ? entries.length : 0,
    lastUploadAt: lastUploadAt || null,
  };
}

function validateFlowEvidence(flow, { step, photoData, odometerValue } = {}) {
  const stepId = String(step || '').trim();
  const definition = (Array.isArray(flow) ? flow : []).find(item => item.id === stepId);
  if (!definition) return { error: 'Etapa invalida para este perfil' };

  if (definition.type === 'photo' && !(typeof photoData === 'string' && photoData.startsWith('data:image'))) {
    return { error: 'A foto desta etapa e obrigatoria' };
  }

  if (definition.type !== 'photo' && photoData) {
    return { error: 'Esta etapa nao aceita envio de foto' };
  }

  if (definition.type === 'number') {
    const numericValue = parseKmNumber(String(odometerValue ?? ''));
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return { error: 'Quilometragem invalida' };
    }
    return { stepId, numericValue };
  }

  return { stepId };
}

function isMobileEvidenceRequest(req) {
  if (process.env.DEV_ALLOW_DESKTOP_EVIDENCE === '1') return true;
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  return /(android|iphone|ipad|ipod|windows phone|mobile)/.test(ua);
}

function sanitizeDigits(value) {
  return value ? String(value).replace(/\D/g, '') : '';
}

function sanitizePlate(value) {
  if (!value) return '';
  return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function sanitizeEmail(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const ADHESION_INITIAL_KEYS = [
  'Adesivagem Inicial',
  'Horario Adesivagem Inicial',
  'Horário Adesivagem Inicial',
];
const ADHESION_REMOVAL_KEYS = [
  'Retirada Adesivo',
  'Horario Retirada Adesivo',
  'Horário Retirada Adesivo',
];
const ADHESION_STATUS_KEYS = [
  'Status Adesivagem',
  'Situacao Adesivagem',
  'Situação Adesivagem',
];

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

function extractDriverAdhesionSchedule(driver) {
  const raw = driver?.raw && typeof driver.raw === 'object' ? driver.raw : {};
  const schedule = driver?.schedule && typeof driver.schedule === 'object' ? driver.schedule : {};

  const initialRawCandidate =
    schedule.initialAtRaw ??
    getFromRaw(raw, ADHESION_INITIAL_KEYS) ??
    schedule.initialAt;
  const removalRawCandidate =
    schedule.removalAtRaw ??
    getFromRaw(raw, ADHESION_REMOVAL_KEYS) ??
    schedule.removalAt;
  const statusRawCandidate =
    schedule.status ??
    getFromRaw(raw, ADHESION_STATUS_KEYS);

  const initialAt = parseAdhesionDateTimeMs(schedule.initialAt ?? initialRawCandidate);
  const removalAt = parseAdhesionDateTimeMs(schedule.removalAt ?? removalRawCandidate);
  const status = normalizeAdhesionStatus(statusRawCandidate);

  return {
    initialAt: Number.isFinite(initialAt) ? initialAt : null,
    initialAtRaw: formatAdhesionDateTimeInput(initialRawCandidate ?? initialAt),
    removalAt: Number.isFinite(removalAt) ? removalAt : null,
    removalAtRaw: formatAdhesionDateTimeInput(removalRawCandidate ?? removalAt),
    status,
  };
}

function getFromRaw(raw = {}, candidates = []) {
  for (const key of candidates) {
    if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== '') {
      return raw[key];
    }
  }

  const normalized = new Map();
  for (const [key, value] of Object.entries(raw)) {
    normalized.set(normalizeMasterKey(key), value);
  }
  for (const key of candidates) {
    const norm = normalizeMasterKey(key);
    if (normalized.has(norm)) {
      const value = normalized.get(norm);
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
  }

  return '';
}

function extractDriverMetadata(driver) {
  const raw = driver?.raw || {};
  const cpf = driver?.cpf || getFromRaw(raw, ['CPF', 'Cpf', 'cpf']);
  const plate = driver?.plate || getFromRaw(raw, ['Placa', 'PLACA', 'placa']);
  const email = driver?.email || getFromRaw(raw, ['Email', 'E-mail', 'EMAIL']);
  const phone = driver?.phone || getFromRaw(raw, ['Numero', 'Numero ', 'Número', 'Telefone', 'Celular']);
  return {
    cpf: sanitizeDigits(cpf),
    plate: sanitizePlate(plate),
    email: sanitizeEmail(email),
    phoneDigits: sanitizeDigits(phone),
    nameKey: driver?.nameKey || normalizeName(driver?.name),
    raw,
  };
}

function updateDriverContactFields(driver, { cpf, plate, email, phone }) {
  driver.raw = driver.raw || {};
  if (cpf) {
    driver.cpf = sanitizeDigits(cpf);
    driver.raw.CPF = driver.cpf;
  }
  if (plate) {
    driver.plate = sanitizePlate(plate);
    driver.raw.Placa = driver.plate;
  }
  if (email) {
    driver.email = sanitizeEmail(email);
    driver.raw.Email = driver.email;
  }
  if (phone) {
    const digits = sanitizeDigits(phone);
    driver.phone = trimString(phone);
    driver.phoneDigits = digits;
    driver.raw.Numero = driver.phone;
    driver.raw.Telefone = driver.phone;
  }
}

function matchDriver(db, { name, phone, cpf, plate, email }, campaignId = null) {
  const normalizedName = normalizeName(name);
  const sanitizedPhone = sanitizeDigits(phone);
  const sanitizedCpf = sanitizeDigits(cpf);
  const sanitizedPlate = sanitizePlate(plate);
  const sanitizedEmail = sanitizeEmail(email);

  const drivers = (db.drivers || []).filter(driver => (
    !campaignId || String(driver?.campaignId || '') === String(campaignId)
  ));

  // Flexible phone matching: ignore country code (55), allow suffix match (last 9-10 digits)
  const phoneVariants = (digits) => {
    const v = new Set();
    const d = String(digits || '');
    if (!d) return v;
    v.add(d);
    if (d.startsWith('55')) v.add(d.slice(2));
    // Add suffixes of 10, 9 and 8 digits (common patterns)
    if (d.length >= 10) v.add(d.slice(-10));
    if (d.length >= 9) v.add(d.slice(-9));
    if (d.length >= 8) v.add(d.slice(-8));
    return v;
  };

  const userPhones = phoneVariants(sanitizedPhone);

  if (sanitizedPhone) {
    const byPhone = drivers.filter(d => {
      const meta = extractDriverMetadata(d);
      const cand = phoneVariants(meta.phoneDigits);
      for (const up of userPhones) { if (cand.has(up)) return true; }
      return false;
    });
    if (byPhone.length === 1) return byPhone[0];
    if (byPhone.length > 1) {
      const narrowedByName = normalizedName ? byPhone.filter(d => (d.nameKey || normalizeName(d.name)) === normalizedName) : byPhone;
      if (narrowedByName.length === 1) return narrowedByName[0];
      if (sanitizedCpf) {
        const narrowed = byPhone.filter(d => extractDriverMetadata(d).cpf === sanitizedCpf);
        if (narrowed.length === 1) return narrowed[0];
      }
    }
  }

  if (sanitizedCpf) {
    const byCpf = drivers.filter(d => extractDriverMetadata(d).cpf === sanitizedCpf);
    if (byCpf.length === 1) return byCpf[0];
    if (byCpf.length > 1 && sanitizedPlate) {
      const narrowed = byCpf.filter(d => extractDriverMetadata(d).plate === sanitizedPlate);
      if (narrowed.length === 1) return narrowed[0];
    }
  }

  if (sanitizedPlate) {
    const byPlate = drivers.filter(d => extractDriverMetadata(d).plate === sanitizedPlate);
    if (byPlate.length === 1) return byPlate[0];
    if (byPlate.length > 1 && sanitizedEmail) {
      const narrowed = byPlate.filter(d => extractDriverMetadata(d).email === sanitizedEmail);
      if (narrowed.length === 1) return narrowed[0];
    }
  }

  if (sanitizedEmail) {
    const byEmail = drivers.filter(d => extractDriverMetadata(d).email === sanitizedEmail);
    if (byEmail.length === 1) return byEmail[0];
  }

  if (normalizedName) {
    const byName = drivers.filter(d => (d.nameKey || normalizeName(d.name)) === normalizedName);
    if (byName.length === 1) return byName[0];
  }

  return null;
}

async function resolveDriverFromMasterRecords(db, identity, contact) {
  try {
    const match = await findDriverRowInMasterTables({
      name: identity.name,
      phone: identity.phone,
    });
    if (!match) return null;
    let campaign = null;
    if (match.campaignId) {
      campaign = await ensureCampaignFromMongo(db, match.campaignId);
    }
    const normalizedCampName = normalizeName(match.campaignName || identity.campaignName || '');
    if (!campaign && normalizedCampName) {
      campaign = db.campaigns.find(
        c => normalizeName(c.name || '') === normalizedCampName,
      );
    }
    if (!campaign) {
      campaign = {
        id: match.campaignId || nanoid(),
        name: match.campaignName || identity.campaignName || 'Campanha importada',
        client: '',
        period: '',
        status: 'ativa',
        sheetId: null,
        sheetName: null,
        sheetHeader: [],
        sheetGid: null,
        campaignCode: null,
        driveFolderId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      db.campaigns.push(campaign);
      saveDB(db);
    }
    if (!campaign) return null;
    const row = match.row || {};
    const rawName =
      String(row.Nome || row.NOME || row.nome || row.Motorista || identity.name || '').trim();
    const normalizedName = normalizeName(rawName || identity.name || '');
    const statusRaw = row.Status || row.status || '';
    const driver = {
      id: match.driverId || nanoid(),
      campaignId: campaign.id,
      name: rawName || identity.name || '',
      nameKey: normalizedName,
      statusRaw: statusRaw || '',
      status: normalizeStatus(statusRaw) || 'revisar',
      raw: { ...row },
      rowNumber: row.__rowNumber || row.rowNumber || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const phoneValue =
      row.Numero ||
      row['Numero '] ||
      row['Número'] ||
      row['NÚMERO'] ||
      row.Telefone ||
      row.telefone ||
      row.Celular ||
      row.CELULAR ||
      row.WhatsApp ||
      identity.phone ||
      '';

    updateDriverContactFields(driver, {
      phone: phoneValue,
      cpf: row.CPF || row.cpf || contact.cpf,
      plate: row.Placa || row.PLACA || row.placa || contact.plate,
      email: row.Email || row.EMAIL || row.email || contact.email,
    });

    db.drivers.push(driver);
    return { driver, campaign };
  } catch (err) {
    console.warn('Falha ao buscar motorista nos masters do Mongo', err?.message || err);
    return null;
  }
}

function phoneMatchesStored(storedDigits, inputDigits) {
  const stored = sanitizeDigits(storedDigits);
  const input = sanitizeDigits(inputDigits);
  if (!stored || !input) return false;
  if (stored === input) return true;
  const strip = value => String(value).replace(/^55/, '');
  if (strip(stored) === strip(input)) return true;
  return stored.endsWith(input) || input.endsWith(stored);
}

function graphicPhoneMatches(graphic = {}, digits) {
  if (!digits) return false;
  const candidates = [
    graphic.phoneDigits,
    graphic.responsible1PhoneDigits,
    graphic.responsible2PhoneDigits,
    sanitizeDigits(graphic.phone),
    sanitizeDigits(graphic.responsible1Phone),
    sanitizeDigits(graphic.responsible2Phone),
  ].filter(Boolean);
  return candidates.some(stored => phoneMatchesStored(stored, digits));
}

function matchGraphicAccess(graphics = [], { name, phoneDigits, email }) {
  const list = Array.isArray(graphics) ? graphics : [];
  const normalizedName = normalizeName(name);
  const sanitizedEmail = sanitizeEmail(email);
  const digits = sanitizeDigits(phoneDigits);

  const byName = normalizedName
    ? list.filter(g => {
        const names = [
          normalizeName(g.name),
          normalizeName(g.responsible1Name),
          normalizeName(g.responsible2Name),
        ];
        return names.includes(normalizedName);
      })
    : [];

  let candidates = byName;
  if (candidates.length > 1 && digits) {
    const narrowed = candidates.filter(g => graphicPhoneMatches(g, digits));
    if (narrowed.length) candidates = narrowed;
  }
  if (candidates.length > 1 && sanitizedEmail) {
    const narrowed = candidates.filter(g => sanitizeEmail(g.email) === sanitizedEmail);
    if (narrowed.length) candidates = narrowed;
  }
  if (candidates.length === 1) return candidates[0];

  if (!candidates.length && digits) {
    const byPhone = list.filter(g => graphicPhoneMatches(g, digits));
    if (byPhone.length === 1) return byPhone[0];
    candidates = byPhone;
  }

  if ((!candidates || !candidates.length) && sanitizedEmail) {
    const byEmail = list.filter(g => sanitizeEmail(g.email) === sanitizedEmail);
    if (byEmail.length === 1) return byEmail[0];
    candidates = byEmail;
  }

  return candidates && candidates.length ? candidates[0] : null;
}

function rejectGraphicAuth(res, message) {
  if (DETAILED_GRAPHIC_ERRORS) {
    return res.status(403).json({ error: message });
  }
  return res.status(403).json({ error: 'Credenciais invalidas.' });
}

async function createDriverSession({
  driverId,
  campaignId,
  driverCampaignId,
  driverName,
  phone,
  email,
}) {
  const token = nanoid(48);
  return createUserSession(token, {
    userId: driverId,
    name: driverName,
    type: 'driver',
    campaignId,
    driverCampaignId: String(driverCampaignId || '').trim() || null,
    identity: phone || email,
  });
}

async function createGraphicSession({ graphicId, campaignId, graphicName, responsibleName, email }) {
  const token = nanoid(48);
  return createUserSession(token, {
    userId: graphicId,
    name: graphicName,
    type: 'graphic',
    campaignId,
    identity: email,
    responsibleName,
  });
}

async function authenticateSession(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [, token] = authHeader.split(' ');
    if (!token) return res.status(401).json({ error: 'Sessao invalida ou expirada' });

    const session = await getUserSession(token);
    if (!session) {
      return res.status(401).json({ error: 'Sessao invalida ou expirada' });
    }

    const sessionRole = session.role || session.type;
    if (
      sessionRole === 'driver' &&
      await isCampaignDriverDetached(
        session.campaignId,
        session.driverId || session.userId,
        session.driverCampaignId,
      )
    ) {
      await deleteUserSession(token);
      return res.status(403).json({ error: 'Motorista desvinculado desta campanha' });
    }

    const db = loadDB();
    req.sessionContext = { db, session };
    next();
  } catch (err) {
    console.error('[sessions] authenticateSession error', err?.message || err);
    res.status(500).json({ error: 'Falha ao validar sessao' });
  }
}

async function syncDriverRowIfPossible(db, driver, campaign) {
  if (!driver?.rowNumber || !campaign?.sheetId || !campaign?.sheetName) return;

  let header = Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length
    ? campaign.sheetHeader
    : null;
  if (!header) {
    header = await readSheetHeader(campaign.sheetId, campaign.sheetName);
    campaign.sheetHeader = header;
  }

  const rowValues = buildSheetRowValues(header, driver);
  await updateSheetRow(campaign.sheetId, campaign.sheetName, driver.rowNumber, rowValues);
}

router.post('/driver', validateDriverLogin, async (req, res) => {
  const { name, phone, cpf, plate, email } = req.body || {};
  if (!trimString(name) || !trimString(phone)) {
    return res.status(400).json({ error: 'Nome e telefone sao obrigatorios' });
  }

  const db = loadDB();
  let driver = null;
  let campaign = null;

  // 1) Fonte primária: API OdDrive
  try {
    const apiDriver = await findDriverByIdentity({ name, phone });
    if (apiDriver && apiDriver.campaignId) {
      campaign = await ensureCampaignFromApi(db, apiDriver.campaignId);
      if (campaign) {
        driver = ensureDriverFromApi(db, apiDriver, { name, phone, cpf, plate, email });
      }
    }
  } catch (err) {
    console.warn('[sessions] Falha ao consultar API OdDrive no login', err?.message || err);
  }

  // 2) Fallback: MongoDB
  if (!driver) {
    try {
      const mongoDriver = await findDriverByIdentityMongo({ name, phone });
      if (mongoDriver) {
        campaign = await ensureCampaignFromMongo(db, mongoDriver.campaignId);
        if (campaign) {
          driver = ensureDriverFromMongo(db, mongoDriver, { name, phone, cpf, plate, email });
        }
      }
    } catch (err) {
      console.warn('Falha ao consultar Mongo no login', err?.message || err);
    }
  }

  // 3) Fallback: Master tables (planilha importada)
  if (!driver) {
    const resolved = await resolveDriverFromMasterRecords(
      db,
      { name, phone },
      { cpf, plate, email, phone },
    );
    if (resolved) {
      driver = resolved.driver;
      campaign = resolved.campaign;
    }
  }

  if (driver?.campaignId) {
    try {
      if (await isCampaignDriverDetached(
        driver.campaignId,
        driver.id,
        driver?.campaignData?.driverCampaignId || driver?.driverCampaignId,
      )) {
        driver = null;
        campaign = null;
      }
    } catch (err) {
      console.warn('[sessions] Falha ao validar desvinculo do motorista', err?.message || err);
    }
  }

  if (!driver) {
    return res.status(404).json({ error: 'Motorista nao encontrado. Verifique os dados informados.' });
  }

  if (!campaign || campaign.id !== driver.campaignId) {
    campaign = db.campaigns.find(c => c.id === driver.campaignId);
  }
  if (!campaign) {
    campaign = await ensureCampaignFromApi(db, driver.campaignId);
  }
  if (!campaign) {
    campaign = await ensureCampaignFromMongo(db, driver.campaignId);
  }
  if (!campaign) {
    return res.status(500).json({ error: 'Campanha vinculada ao motorista nao encontrada' });
  }

  // Garanta que o telefone informado fique cadastrado (mesmo no primeiro acesso)
  updateDriverContactFields(driver, { cpf, plate, email, phone });
  driver._origin = 'DRIVER_APP';
  driver.updatedAt = Date.now();

  try {
    applyCanonicalRaw(driver);
    await syncDriverRowIfPossible(db, driver, campaign);
  } catch (err) {
    console.warn('Falha ao sincronizar linha do motorista na planilha', err?.message || err);
  }

  const session = await createDriverSession({
    driverId: driver.id,
    campaignId: campaign.id,
    driverCampaignId: driver?.campaignData?.driverCampaignId || driver?.driverCampaignId,
    driverName: trimString(name),
    phone: sanitizeDigits(phone),
    email: sanitizeEmail(email),
  });

  // Reflete campanha/motorista no MongoDB
  try {
    await upsertCampaignRecord(campaign);
    await upsertDriverRecord(driver);
  } catch {}

  saveDB(db);

  res.json({
    token: session.token,
    role: 'driver',
    expiresAt: session.expiresAt,
    driver: {
      id: driver.id,
      name: driver.name,
      phone: driver.phone || null,
    },
    campaign: {
      id: campaign.id,
      name: campaign.name,
    },
  });
});


async function ensureCampaignFromMongo(db, campaignId) {
  if (!campaignId) return null;
  let campaign = db.campaigns.find(c => c.id === campaignId);
  if (campaign) return campaign;
  try {
    const doc = await getCampaignRecordById(campaignId);
    if (!doc) return null;
    campaign = {
      id: doc.id,
      name: doc.name || '',
      client: doc.client || '',
      period: doc.period || '',
      status: doc.status || 'ativa',
      sheetId: doc.sheetId || null,
      sheetName: doc.sheetName || null,
      sheetHeader: [],
      sheetGid: null,
      campaignCode: doc.campaignCode || '',
      driveFolderId: doc.driveFolderId || null,
      createdAt: doc.createdAt || Date.now(),
      updatedAt: doc.updatedAt || Date.now(),
    };
    db.campaigns.push(campaign);
    saveDB(db);
    return campaign;
  } catch (err) {
    console.warn('Falha ao sincronizar campanha via Mongo', err?.message || err);
    return null;
  }
}

// ── Helpers API OdDrive (fase 4) ──

async function ensureCampaignFromApi(db, campaignId) {
  if (!campaignId) return null;
  const existing = db.campaigns.find(c => c.id === campaignId);
  if (existing) return existing;
  try {
    const apiCampaign = await fetchCampaignById(campaignId);
    if (!apiCampaign) return null;
    db.campaigns.push(apiCampaign);
    saveDB(db);
    return apiCampaign;
  } catch (err) {
    console.warn('[sessions] Falha ao buscar campanha via API', err?.message || err);
    return null;
  }
}

function ensureDriverFromApi(db, apiDriver, contact = {}) {
  if (!apiDriver) return null;
  let driver = db.drivers.find(d => d.id === apiDriver.id);
  if (!driver) {
    driver = {
      id: apiDriver.id,
      campaignId: apiDriver.campaignId,
      driverCampaignId: apiDriver?.campaignData?.driverCampaignId || apiDriver?.driverCampaignId || null,
      name: apiDriver.name || trimString(contact.name),
      nameKey: apiDriver.nameKey || normalizeName(apiDriver.name || contact.name || ''),
      status: apiDriver.status || 'revisar',
      city: apiDriver.city || '',
      plate: apiDriver.plate || '',
      email: apiDriver.email || '',
      cpf: apiDriver.cpf || '',
      phone: apiDriver.phone || '',
      phoneDigits: apiDriver.phoneDigits || '',
      pix: apiDriver.pix || '',
      address: apiDriver.address || {},
      ratingApp: apiDriver.ratingApp || null,
      campaignData: apiDriver.campaignData || null,
      kmTravelledValue: apiDriver.kmTravelledValue || 0,
      raw: {},
      createdAt: apiDriver.createdAt || Date.now(),
      updatedAt: Date.now(),
      _source: 'api',
    };
    db.drivers.push(driver);
  } else {
    driver.campaignId = apiDriver.campaignId;
    driver.driverCampaignId = apiDriver?.campaignData?.driverCampaignId || apiDriver?.driverCampaignId || null;
    delete driver.detachedFromCampaignId;
    if (apiDriver.name) driver.name = apiDriver.name;
    if (apiDriver.nameKey) driver.nameKey = apiDriver.nameKey;
    if (apiDriver.status) driver.status = apiDriver.status;
    if (apiDriver.city) driver.city = apiDriver.city;
    if (apiDriver.plate) driver.plate = apiDriver.plate;
    if (apiDriver.email) driver.email = apiDriver.email;
    if (apiDriver.cpf) driver.cpf = apiDriver.cpf;
    if (apiDriver.phone) driver.phone = apiDriver.phone;
    if (apiDriver.phoneDigits) driver.phoneDigits = apiDriver.phoneDigits;
    if (apiDriver.pix) driver.pix = apiDriver.pix;
    if (apiDriver.address) driver.address = apiDriver.address;
    if (apiDriver.ratingApp != null) driver.ratingApp = apiDriver.ratingApp;
    if (apiDriver.campaignData) driver.campaignData = apiDriver.campaignData;
    if (apiDriver.kmTravelledValue) driver.kmTravelledValue = apiDriver.kmTravelledValue;
    driver._source = 'api';
  }
  updateDriverContactFields(driver, contact);
  driver.updatedAt = Date.now();
  return driver;
}

async function ensureCampaignDriversFromApi(db, campaignId) {
  if (!campaignId) return [];
  try {
    const apiDrivers = await fetchDriversByCampaign(campaignId);
    if (!apiDrivers.length) return [];
    const synced = [];
    for (const apiDriver of apiDrivers) {
      const driver = ensureDriverFromApi(db, apiDriver, {});
      if (driver) synced.push(driver);
    }
    if (synced.length) saveDB(db);
    return synced;
  } catch (err) {
    console.warn('[sessions] Falha ao carregar motoristas via API', err?.message || err);
    return [];
  }
}

async function ensureCampaignByCode(db, normalizedCode) {
  if (!normalizedCode) return null;
  const existing = db.campaigns.find(c => String(c.campaignCode || '').toUpperCase() === normalizedCode);
  if (existing) return existing;
  try {
    const doc = await findCampaignByCodeMongo(normalizedCode);
    if (!doc) return null;
    const campaign = {
      id: doc.id,
      name: doc.name || '',
      client: doc.client || '',
      period: doc.period || '',
      status: doc.status || 'ativa',
      sheetId: doc.sheetId || null,
      sheetName: doc.sheetName || null,
      sheetHeader: [],
      sheetGid: null,
      campaignCode: doc.campaignCode || normalizedCode,
      driveFolderId: doc.driveFolderId || null,
      createdAt: doc.createdAt || Date.now(),
      updatedAt: doc.updatedAt || Date.now(),
    };
    db.campaigns.push(campaign);
    saveDB(db);
    return campaign;
  } catch (err) {
    console.warn('Falha ao buscar campanha por codigo no Mongo', err?.message || err);
    return null;
  }
}

function ensureDriverFromMongo(db, mongoDriver, contact = {}) {
  if (!mongoDriver) return null;
  let driver = db.drivers.find(d => d.id === mongoDriver.id);
  if (!driver) {
    driver = {
      id: mongoDriver.id,
      campaignId: mongoDriver.campaignId,
      driverCampaignId: mongoDriver.driverCampaignId || null,
      name: mongoDriver.name || trimString(contact.name),
      nameKey: mongoDriver.nameKey || normalizeName(mongoDriver.name || contact.name || ''),
      status: mongoDriver.status || 'revisar',
      city: mongoDriver.city || '',
      plate: mongoDriver.plate || '',
      raw: {},
      createdAt: mongoDriver.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    db.drivers.push(driver);
  }
  if (!driver.name && (mongoDriver.name || contact.name)) {
    driver.name = mongoDriver.name || trimString(contact.name);
  }
  if (!driver.nameKey && driver.name) {
    driver.nameKey = normalizeName(driver.name);
  }
  driver.phone = driver.phone || mongoDriver.phone || contact.phone || null;
  driver.phoneDigits = driver.phoneDigits || mongoDriver.phoneDigits || sanitizeDigits(contact.phone);
  if (!driver.city && mongoDriver.city) driver.city = mongoDriver.city;
  if (!driver.plate && mongoDriver.plate) driver.plate = mongoDriver.plate;
  if (mongoDriver.driverCampaignId) {
    driver.driverCampaignId = mongoDriver.driverCampaignId;
    driver.campaignData = {
      ...(driver.campaignData || {}),
      driverCampaignId: mongoDriver.driverCampaignId,
    };
  }

  const schedule = driver.schedule && typeof driver.schedule === 'object' ? { ...driver.schedule } : {};
  if (Number.isFinite(mongoDriver.adhesionStartAt)) schedule.initialAt = mongoDriver.adhesionStartAt;
  if (mongoDriver.adhesionStartRaw) schedule.initialAtRaw = mongoDriver.adhesionStartRaw;
  if (Number.isFinite(mongoDriver.adhesionEndAt)) schedule.removalAt = mongoDriver.adhesionEndAt;
  if (mongoDriver.adhesionEndRaw) schedule.removalAtRaw = mongoDriver.adhesionEndRaw;
  if (mongoDriver.adhesionStatus) schedule.status = normalizeAdhesionStatus(mongoDriver.adhesionStatus);

  if (Object.keys(schedule).length) {
    driver.schedule = schedule;
    driver.raw = driver.raw || {};
    if (schedule.initialAtRaw) driver.raw['Adesivagem Inicial'] = formatAdhesionDateTimeInput(schedule.initialAtRaw);
    if (schedule.removalAtRaw) driver.raw['Retirada Adesivo'] = formatAdhesionDateTimeInput(schedule.removalAtRaw);
    if (schedule.status) driver.raw['Status Adesivagem'] = schedule.status;
  }

  updateDriverContactFields(driver, contact);
  driver.updatedAt = Date.now();
  return driver;
}

async function ensureGraphicsFromMongo(db, campaign) {
  if (!campaign) return [];
  try {
    const docs = await listCampaignGraphicsRecords(campaign);
    if (!docs.length) return [];
    db.graphics = Array.isArray(db.graphics) ? db.graphics : [];
    const normalized = docs.map(doc => normalizeGraphicDoc(campaign, doc));
    for (const graphic of normalized) {
      const idx = db.graphics.findIndex(g => g.id === graphic.id);
      if (idx === -1) db.graphics.push(graphic);
      else db.graphics[idx] = { ...db.graphics[idx], ...graphic };
    }
    saveDB(db);
    return normalized;
  } catch (err) {
    console.warn('Falha ao carregar graficas via Mongo', err?.message || err);
    return [];
  }
}

async function ensureCampaignDriversFromMongo(db, campaign) {
  if (!campaign?.id) return [];
  try {
    const docs = await listCampaignDriversRecords(campaign.id);
    if (!docs.length) return [];

    const synced = [];
    for (const mongoDriver of docs) {
      const driver = ensureDriverFromMongo(db, mongoDriver, {});
      if (!driver) continue;

      if (mongoDriver.name) {
        driver.name = mongoDriver.name;
        driver.nameKey = mongoDriver.nameKey || normalizeName(mongoDriver.name);
      }
      if (mongoDriver.status) driver.status = mongoDriver.status;
      if (mongoDriver.city !== undefined && mongoDriver.city !== null) driver.city = mongoDriver.city;
      if (mongoDriver.plate) driver.plate = mongoDriver.plate;
      if (mongoDriver.phone) driver.phone = mongoDriver.phone;
      if (mongoDriver.phoneDigits) driver.phoneDigits = mongoDriver.phoneDigits;
      if (mongoDriver.email) driver.email = mongoDriver.email;
      if (mongoDriver.cpf) driver.cpf = mongoDriver.cpf;
      if (mongoDriver.pix) driver.pix = mongoDriver.pix;

      const rawFromMongo = mongoDriver.raw && typeof mongoDriver.raw === 'object' ? mongoDriver.raw : {};
      driver.raw = {
        ...rawFromMongo,
        ...(driver.raw || {}),
      };
      driver.updatedAt = Date.now();
      synced.push(driver);
    }

    saveDB(db);
    return synced;
  } catch (err) {
    console.warn('Falha ao sincronizar motoristas via Mongo', err?.message || err);
    return [];
  }
}

function normalizeGraphicDoc(campaign, doc = {}) {
  const digits = value => sanitizeDigits(value);
  const graphic = {
    id: doc.id || doc._id || nanoid(),
    campaignId: campaign.id,
    name: trimString(doc['GRAFICA NOME'] || doc.name || doc['NOME'] || ''),
    email: trimString(doc['GRAFICA EMAIL'] || doc.email || ''),
    phone: trimString(doc['GRAFICA TELEFONE'] || doc.phone || ''),
    phoneDigits: digits(doc['GRAFICA TELEFONE'] || doc.phone),
    responsible1Name: trimString(doc['RESPONSAVEL 1 NOME'] || doc.responsavel1Nome || ''),
    responsible1Phone: trimString(doc['RESPONSAVEL 1 TELEFONE'] || doc.responsavel1Telefone || ''),
    responsible1PhoneDigits: digits(doc['RESPONSAVEL 1 TELEFONE'] || doc.responsavel1Telefone),
    responsible2Name: trimString(doc['RESPONSAVEL 2 NOME'] || doc.responsavel2Nome || ''),
    responsible2Phone: trimString(doc['RESPONSAVEL 2 TELEFONE'] || doc.responsavel2Telefone || ''),
    responsible2PhoneDigits: digits(doc['RESPONSAVEL 2 TELEFONE'] || doc.responsavel2Telefone),
    notes: trimString(doc['OBSERVACOES'] || doc.observacoes || ''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return graphic;
}

router.post('/graphic', validateGraphicLogin, async (req, res) => {
  const { campaignCode, name } = req.body || {};
  const identifier = trimString(name);
  const rawCode = trimString(campaignCode);
  if (!identifier) {
    return res.status(400).json({ error: 'Informe o nome do responsavel' });
  }
  if (!rawCode) {
    return res.status(400).json({ error: 'Informe o codigo da campanha' });
  }

  const db = loadDB();
  const normalizedCode = rawCode.toUpperCase();
  let campaign = db.campaigns.find(c => String(c.campaignCode || '').toUpperCase() === normalizedCode) || null;

  if (!campaign) {
    campaign = await ensureCampaignByCode(db, normalizedCode);
  }

  if (!campaign) {
    return rejectGraphicAuth(res, 'Campanha nao encontrada para o codigo informado.');
  }

  // Carrega motoristas: API + MongoDB
  try {
    await ensureCampaignDriversFromApi(db, campaign.id);
  } catch (err) {
    console.warn('[sessions] Falha ao carregar motoristas via API no login grafica', err?.message || err);
  }
  await ensureCampaignDriversFromMongo(db, campaign);

  const storedCode = String(campaign.campaignCode || '').toUpperCase();
  if (!storedCode) {
    return rejectGraphicAuth(res, 'Codigo de acesso ainda nao configurado para esta campanha.');
  }
  if (storedCode !== normalizedCode) {
    return rejectGraphicAuth(res, 'Codigo da campanha invalido.');
  }
  campaign.campaignCode = storedCode;

  let graphics = (db.graphics || []).filter(g => g.campaignId === campaign.id);
  if (!graphics.length) {
    const synced = await ensureGraphicsFromMongo(db, campaign);
    // Refilter after sync to ensure we only have graphics for this campaign
    if (synced.length) {
      graphics = synced.filter(g => g.campaignId === campaign.id);
    }
  }
  
  // Double-check: filter again to ensure strict campaign match
  graphics = graphics.filter(g => g.campaignId === campaign.id);
  
  if (!graphics.length) {
    return rejectGraphicAuth(res, 'Nenhuma grafica cadastrada para esta campanha.');
  }

  const match = matchGraphicAccess(graphics, {
    name: identifier,
  });

  if (!match) {
    return rejectGraphicAuth(res, 'Nome do responsavel nao confere com a grafica cadastrada.');
  }
  
  // Final verification: ensure the matched graphic belongs to this campaign
  if (match.campaignId !== campaign.id) {
    console.warn('[sessions] Graphic match campaignId mismatch:', { matchCampaignId: match.campaignId, campaignId: campaign.id });
    return rejectGraphicAuth(res, 'Grafica nao pertence a esta campanha.');
  }

  const session = await createGraphicSession({
    graphicId: match.id,
    campaignId: campaign.id,
    graphicName: match.name,
    responsibleName: identifier,
    email: identifier,
  });

  saveDB(db);

  res.json({
    token: session.token,
    role: 'graphic',
    expiresAt: session.expiresAt,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      code: campaign.campaignCode,
    },
    graphic: {
      id: match.id,
      name: match.name,
      responsible: identifier,
    },
  });
});

router.post('/logout', authenticateSession, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  await deleteUserSession(token);
  return res.status(204).end();
});

router.get('/me', authenticateSession, (req, res) => {
  const { db, session } = req.sessionContext;
  const campaign = db.campaigns.find(c => c.id === session.campaignId) || null;
  const driver = session.role === 'driver'
    ? db.drivers.find(d => d.id === session.driverId) || null
    : null;
  const graphic = session.role === 'graphic'
    ? (db.graphics || []).find(g => g.id === session.meta?.graphicId) || null
    : null;

  res.json({
    role: session.role,
    expiresAt: session.expiresAt,
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
    driver: driver ? { id: driver.id, name: driver.name } : null,
    graphic: graphic ? { id: graphic.id, name: graphic.name, responsible: session.meta?.responsibleName || '' } : null,
  });
});

router.get('/flow', authenticateSession, (req, res) => {
  const { db, session } = req.sessionContext;
  const campaign = db.campaigns.find(c => c.id === session.campaignId) || null;
  const driver = session.role === 'driver'
    ? db.drivers.find(d => d.id === session.driverId) || null
    : null;

  const steps = session.role === 'driver' ? DRIVER_FLOW : GRAPHIC_FLOW;

  res.json({
    role: session.role,
    steps,
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
    driver: driver ? { id: driver.id, name: driver.name } : null,
  });
});

router.get('/status', authenticateSession, (req, res) => {
  const { db, session } = req.sessionContext;
  const campaignId = session.campaignId;
  const evidence = Array.isArray(db.evidence) ? db.evidence : [];

  if (session.role === 'driver') {
    const driverId = session.driverId;
    const driver = db.drivers.find(d => d.id === driverId && d.campaignId === campaignId);
    if (!driver) return res.status(404).json({ error: 'Motorista nao encontrado' });
    const entries = evidence.filter(e => e && e.campaignId === campaignId && e.driverId === driverId && e.type === 'driver');
    const status = buildCompletionStatus(entries, DRIVER_REQUIRED_STEPS);
    const review = driver?.evidenceReview?.driverFlow || {};
    const cooldownUntil = review.cooldownUntil || null;
    const verifiedAt = review.verifiedAt || null;
    const locked = Boolean(verifiedAt && cooldownUntil && cooldownUntil > Date.now());
    return res.json({
      role: 'driver',
      driverId,
      ...status,
      verified: Boolean(verifiedAt),
      cooldownUntil,
      locked,
    });
  }

  if (session.role === 'graphic') {
    const driverId = req.query.driverId;
    if (!driverId) return res.status(400).json({ error: 'driverId obrigatorio' });
    const driver = db.drivers.find(d => d.id === driverId && d.campaignId === campaignId);
    if (!driver) return res.status(404).json({ error: 'Motorista nao encontrado' });
    const entries = evidence.filter(e => e && e.campaignId === campaignId && e.driverId === driverId && e.type === 'graphic');
    const status = buildCompletionStatus(entries, GRAPHIC_REQUIRED_STEPS);
    const review = driver?.evidenceReview?.graphicFlow || {};
    const cooldownUntil = review.cooldownUntil || null;
    const verifiedAt = review.verifiedAt || null;
    const locked = Boolean(verifiedAt && cooldownUntil && cooldownUntil > Date.now());
    return res.json({
      role: 'graphic',
      driverId,
      ...status,
      verified: Boolean(verifiedAt),
      cooldownUntil,
      locked,
    });
  }

  return res.status(400).json({ error: 'Perfil de sessao invalido' });
});

router.get('/graphic/drivers', authenticateSession, async (req, res) => {
  const { db, session } = req.sessionContext;
  if (session.role !== 'graphic') {
    return res.status(403).json({ error: 'Acesso restrito a graficas' });
  }
  const sessionCampaignId = String(session.campaignId || '');
  const campaign = db.campaigns.find(c => String(c.id || '') === sessionCampaignId) || null;

  // Carrega motoristas: API primeiro, MongoDB como fallback
  try {
    await ensureCampaignDriversFromApi(db, sessionCampaignId);
  } catch (err) {
    console.warn('[sessions] Falha ao carregar motoristas via API para grafica', err?.message || err);
  }
  if (campaign) {
    await ensureCampaignDriversFromMongo(db, campaign);
  }

  const campaignDrivers = (db.drivers || []).filter(
    d => String(d.campaignId || '') === sessionCampaignId,
  );
  const drivers = await filterDetachedCampaignDrivers(sessionCampaignId, campaignDrivers);
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  const list = drivers
    .map(d => ({
      id: d.id,
      name: d.name || '',
      status: d.status || '',
      city: d.city || '',
      plate: trimString(d.plate || getFromRaw(d.raw || {}, ['Placa', 'PLACA', 'placa'])),
      adhesion: extractDriverAdhesionSchedule(d),
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
  res.json({ drivers: list });
});

// Recebe evidências do motorista (foto e/ou valor do odômetro) e persiste no db.json
router.post('/evidence', authenticateSession, validateBase64Image, async (req, res) => {
  const { db, session } = req.sessionContext;
  if (session.role === 'driver') {

  const { step, photoData, odometerValue, meta, refazer } = req.body || {};
  const evidenceValidation = validateFlowEvidence(DRIVER_FLOW, { step, photoData, odometerValue });
  if (evidenceValidation.error) {
    return res.status(400).json({ error: evidenceValidation.error });
  }
  if (photoData && !isMobileEvidenceRequest(req)) {
    return res.status(400).json({ error: 'Envio de imagem permitido apenas pela camera em dispositivo movel.' });
  }

  let campaign = db.campaigns.find(c => c.id === session.campaignId)
    || await ensureCampaignFromMongo(db, session.campaignId)
    || await ensureCampaignFromApi(db, session.campaignId);
  let driver = db.drivers.find(d => d.id === session.driverId);
  if (!driver && session.driverId) {
    try {
      const mongoDrivers = await listCampaignDriversRecords(session.campaignId);
      const mongoDriver = mongoDrivers.find(d => d.id === session.driverId);
      if (mongoDriver) {
        driver = ensureDriverFromMongo(db, mongoDriver, {});
      } else {
        driver = {
          id: session.driverId,
          campaignId: session.campaignId,
          name: session.name || '',
          nameKey: normalizeName(session.name || ''),
          status: 'ativa',
          raw: {},
          km: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        db.drivers.push(driver);
      }
    } catch (recoveryErr) {
      console.warn('[sessions] Driver recovery failed:', recoveryErr?.message || recoveryErr);
    }
  }
  if (!campaign || !driver) return res.status(400).json({ error: 'Sessao inconsistente' });

  const id = nanoid();
  const item = {
    id,
    type: 'driver',
    campaignId: campaign.id,
    driverId: driver.id,
    step: evidenceValidation.stepId,
    photoData: typeof photoData === 'string' && photoData.startsWith('data:image') ? photoData : null,
    odometerValue: odometerValue != null ? String(odometerValue) : null,
    meta: meta && typeof meta === 'object' ? meta : {},
    createdAt: Date.now(),
  };
  // Atualiza campos canônicos
  if (item.odometerValue) {
    const now = Date.now();
    const odometerNumeric = evidenceValidation.numericValue;
    applyDriverKmSummary(driver, {
      currentKm: Number.isFinite(odometerNumeric) ? odometerNumeric : undefined,
      source: 'driver-app',
      updatedAt: now,
      syncTotalKmRodado: true,
    });

    if (!driver.km.raw || typeof driver.km.raw !== 'object') {
      driver.km.raw = {};
    }
    driver.km.raw['KM RODADO TOTAL'] = String(item.odometerValue).trim();
    driver.km.updatedAt = now;
    driver.updatedAt = now;
  }

  // Política: só aceitar foto enviada via dispositivo móvel (UA check) – hardening
  // Se houver foto, envia ao provedor configurado e grava o link na planilha (coluna conforme o passo)
  let lastLinkGlobal = null;
  let lastStoragePath = null;
  let lastStorageId = null;
  if (item.photoData) {
    try {
      const uploaded = await uploadBase64ImageMongo(campaign, driver, item.photoData, {
        step,
        uploaderType: 'driver',
        refazer,
        graphicId: null,
      });
      const link = uploaded.url;
      lastStoragePath = uploaded.path;
      lastStorageId = uploaded.fileId;

      // detecta header alvo por passo, com fallback por nomes existentes
      let header = Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length
        ? campaign.sheetHeader
        : null;
      if (!header && campaign.sheetId && campaign.sheetName) {
        try {
          header = await readSheetHeader(campaign.sheetId, campaign.sheetName);
          campaign.sheetHeader = header;
        } catch (readErr) {
          console.warn('[sessions] readSheetHeader durante upload', readErr?.message || readErr);
        }
      }

      const prefMap = {
        'odometer-photo': [
          'DRV FOTO ODOMETRO INST','FOTO ODOMETRO','FOTOS ODOMETRO','FOTOS INICIO','FOTOS INÍCIO'
        ],
        'photo-left': [
          'DRV FOTO LATERAL ESQ INST','FOTO LATERAL ESQ','FOTO LATERAL ESQUERDA','FOTOS INICIO','FOTOS INÍCIO'
        ],
        'photo-right': [
          'DRV FOTO LATERAL DIR INST','FOTO LATERAL DIR','FOTO LATERAL DIREITA','FOTOS INICIO','FOTOS INÍCIO'
        ],
        'photo-rear': [
          'DRV FOTO TRASEIRA INST','FOTO TRASEIRA','FOTOS INICIO','FOTOS INÍCIO'
        ],
        'photo-front': [
          'DRV FOTO FRENTE INST','FOTO FRENTE','FOTOS INICIO','FOTOS INÍCIO'
        ],
      };

      const normalize = s => String(s||'')
        .normalize('NFD').replace(/\p{Diacritic}/gu,'')
        .replace(/\s+/g,' ').trim().toUpperCase();

      const headerNorm = new Map((Array.isArray(header) ? header : []).map(h => [normalize(h), h]));
      const candidates = prefMap[step] || [];
      let target = null;
      for (const c of candidates) {
        const norm = normalize(c);
        if (headerNorm.has(norm)) { target = headerNorm.get(norm); break; }
      }
      // por padrão, se não achou, não falha: apenas segue sem gravar
      if (target) {
        driver.raw = driver.raw || {};
        // usar fórmula IMAGE para visualização na célula
        const imgFn = process.env.SHEETS_IMAGE_FORMULA || "IMAGE";
        if (process.env.SHEETS_IMAGE_AS_LINK === '1') {
          driver.raw[target] = link;
        } else {
          driver.raw[target] = `=${imgFn}("${link}")`;
        }
      }
      // Persist the public URL into the local evidence item to avoid storing large base64 blobs
      try {
        item.url = link;
        item.uploadedAt = Date.now();
        if (lastStoragePath) item.path = lastStoragePath;
        // remove base64 payload to reduce db.json size when upload succeeded
        if (item.photoData) delete item.photoData;
      } catch (e) {
        // ignore local persistence errors
      }
      lastLinkGlobal = link;
    } catch (e) {
      console.error('Falha ao enviar imagem para o armazenamento do MongoDB', e?.message || e);
      return res.status(502).json({ error: 'Nao foi possivel armazenar a imagem. Tente novamente.' });
    }
  }

  db.evidence.push(item);

  // Sincroniza a linha com a planilha mestre (se configurada)
  try {
    await syncDriverRowIfPossible(db, driver, campaign);
  } catch (e) {
    console.warn('Falha ao sincronizar linha apos evidencia', e?.message || e);
  }

  // Persistir no MongoDB (mantem admin em sincronia)
  try {
    await upsertCampaignRecord(campaign);
    await upsertDriverRecord(driver);
    const pathForRecord = lastStoragePath;
    const storageFileId = lastStorageId;
    lastStoragePath = null;
    lastStorageId = null;
    await insertEvidenceRecord({
      id,
      campaignId: campaign.id,
      driverId: driver.id,
      step: item.step,
      url: lastLinkGlobal,
      odometerValue: item.odometerValue,
      createdAt: item.createdAt,
      uploaderType: 'driver',
      path: pathForRecord,
      storageFileId,
    });
  } catch {}

    saveDB(db);
    return res.status(201).json({ ok: true, id });
  }

  if (session.role !== 'graphic') return res.status(403).json({ error: 'Perfil nao autorizado' });

  // Accept either driverId or driver data to create/find a driver
  const { driverId, step, photoData, notes, driver: driverData, refazer, odometerValue: rawOdometerValue } = req.body || {};
  const evidenceValidation = validateFlowEvidence(GRAPHIC_FLOW, {
    step,
    photoData,
    odometerValue: rawOdometerValue,
  });
  if (evidenceValidation.error) {
    return res.status(400).json({ error: evidenceValidation.error });
  }
  if (photoData && !isMobileEvidenceRequest(req)) {
    return res.status(400).json({ error: 'Envio de imagem permitido apenas pela camera em dispositivo movel.' });
  }

  let campaign = db.campaigns.find(c => c.id === session.campaignId)
    || await ensureCampaignFromMongo(db, session.campaignId)
    || await ensureCampaignFromApi(db, session.campaignId);
  if (!campaign) return res.status(400).json({ error: 'Campanha nao encontrada na sessao' });

  let cachedSheetHeader = null;
  const getSheetHeader = async () => {
    if (cachedSheetHeader) return cachedSheetHeader;
    if (Array.isArray(campaign.sheetHeader) && campaign.sheetHeader.length) {
      cachedSheetHeader = campaign.sheetHeader;
      return cachedSheetHeader;
    }
    if (campaign.sheetId && campaign.sheetName) {
      try {
        const header = await readSheetHeader(campaign.sheetId, campaign.sheetName);
        if (Array.isArray(header) && header.length) {
          campaign.sheetHeader = header;
          cachedSheetHeader = header;
          return cachedSheetHeader;
        }
      } catch (err) {
        console.warn('[sessions] readSheetHeader (graphic evidence)', err?.message || err);
      }
    }
    cachedSheetHeader = Array.isArray(campaign.sheetHeader) ? campaign.sheetHeader : [];
    return cachedSheetHeader;
  };

  let driver = null;
  let provisionalDriver = null;
  if (driverId) {
    driver = db.drivers.find(d => d.id === driverId && d.campaignId === session.campaignId);
    if (!driver) {
      try {
        const mongoDrivers = await listCampaignDriversRecords(session.campaignId);
        const mongoDriver = mongoDrivers.find(d => d.id === driverId);
        if (mongoDriver) {
          driver = ensureDriverFromMongo(db, mongoDriver, {});
        } else {
          return res.status(400).json({ error: 'Motorista nao encontrado na campanha' });
        }
      } catch (recoveryErr) {
        console.warn('[sessions] Graphic driver recovery failed:', recoveryErr?.message || recoveryErr);
        return res.status(400).json({ error: 'Motorista nao encontrado na campanha' });
      }
    }
  } else if (driverData && typeof driverData === 'object') {
    // Try to match existing driver by provided metadata
    const { name, phone, cpf, plate, email } = driverData;
    const matched = matchDriver(db, { name, phone, cpf, plate, email }, session.campaignId);
    if (matched) {
      driver = matched;
    } else {
      const cleanName = String(name || '').trim();
      if (cleanName.length < 2) {
        return res.status(400).json({ error: 'Nome do motorista obrigatorio' });
      }
      // create provisional driver record
      const newDriver = {
        id: nanoid(),
        campaignId: session.campaignId,
        name: cleanName,
        nameKey: normalizeName(cleanName),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provisional: true,
        raw: {},
      };
      updateDriverContactFields(newDriver, { cpf, plate, email, phone });
      provisionalDriver = newDriver;
      driver = newDriver;
    }
  } else {
    return res.status(400).json({ error: 'driverId ou dados do motorista obrigatorios' });
  }

  if (driver?.id && await isCampaignDriverDetached(
    session.campaignId,
    driver.id,
    driver?.campaignData?.driverCampaignId || driver?.driverCampaignId,
  )) {
    return res.status(400).json({ error: 'Motorista nao pertence mais a esta campanha' });
  }

  const id = nanoid();
  const item = {
    id,
    type: 'graphic',
    campaignId: campaign.id,
    // ensure local evidence stores the actual driver.id (if we resolved/created one)
    driverId: driver?.id || driverId || null,
    graphicId: session.meta?.graphicId || null,
    step: evidenceValidation.stepId,
    photoData: typeof photoData === 'string' && photoData.startsWith('data:image') ? photoData : null,
    notes: typeof notes === 'string' ? notes : '',
    odometerValue: null,
    createdAt: Date.now(),
  };
  let photoUrl = null;
  let photoPath = null;
  let photoStorageId = null;
  if (item.photoData) {
    try {
      const uploaded = await uploadBase64ImageMongo(campaign, driver, item.photoData, {
        step: item.step || 'graphic',
        uploaderType: 'graphic',
        refazer,
        graphicId: session.meta?.graphicId || null,
      });
      const link = uploaded.url;
      photoPath = uploaded.path;
      photoStorageId = uploaded.fileId;

      const header = await getSheetHeader();

      const GRAPHIC_PREF_MAP = {
        'odometer-photo': ['GFX FOTO ODOMETRO INST'],
        'photo-left': ['GFX FOTO LATERAL ESQ INST','GFX FOTO LATERAL ESQ','FOTO LATERAL ESQ GRAFICA','FOTO LATERAL ESQ'],
        'photo-right': ['GFX FOTO LATERAL DIR INST','GFX FOTO LATERAL DIR','FOTO LATERAL DIR GRAFICA','FOTO LATERAL DIR'],
        'photo-rear': ['GFX FOTO TRASEIRA INST','GFX FOTO TRASEIRA','FOTO TRASEIRA GRAFICA','FOTO TRASEIRA'],
        'photo-front': ['GFX FOTO FRENTE INST','GFX FOTO FRENTE','FOTO FRENTE GRAFICA','FOTO FRENTE'],
      };

      const normalize = s => String(s||'')
        .normalize('NFD').replace(/\p{Diacritic}/gu,'')
        .replace(/\s+/g,' ').trim().toUpperCase();

      const headerNorm = new Map(header.map(h => [normalize(h), h]));
      const candidates = GRAPHIC_PREF_MAP[item.step] || [];
      let target = null;
      for (const c of candidates) {
        const norm = normalize(c);
        if (headerNorm.has(norm)) { target = headerNorm.get(norm); break; }
      }
      if (target) {
        driver.raw = driver.raw || {};
        const imgFn = process.env.SHEETS_IMAGE_FORMULA || 'IMAGE';
        if (process.env.SHEETS_IMAGE_AS_LINK === '1') driver.raw[target] = link;
        else driver.raw[target] = `=${imgFn}("${link}")`;
      }
      photoUrl = link;
      // persist url into the local evidence record and remove base64
      try {
        item.url = link;
        item.uploadedAt = Date.now();
        if (photoPath) item.path = photoPath;
        if (item.photoData) delete item.photoData;
      } catch (e) {
        // ignore
      }
    } catch (err) {
      console.error('Falha ao processar imagem da grafica (Mongo storage)', err?.message || err);
      return res.status(502).json({ error: 'Nao foi possivel armazenar a imagem. Tente novamente.' });
    }
  }

  if (trimString(notes)) {
    try {
      const header = await getSheetHeader();
      const normalize = s => String(s||'')
        .normalize('NFD').replace(/\p{Diacritic}/gu,'')
        .replace(/\s+/g,' ').trim().toUpperCase();
      const headerNorm = new Map(header.map(h => [normalize(h), h]));
      const noteTargets = ['GFX OBSERVACOES','OBSERVACOES','OBSERVAÇÕES'];
      let target = null;
      for (const col of noteTargets) {
        const norm = normalize(col);
        if (headerNorm.has(norm)) { target = headerNorm.get(norm); break; }
      }
      driver.raw = driver.raw || {};
      const text = String(notes).trim();
      if (target) driver.raw[target] = text;
      else driver.raw['OBSERVACOES'] = text;
    } catch (err) {
      console.warn('Falha ao registrar observacoes da grafica', err?.message || err);
    }
  }

  // Handle odometer-value step from graphic flow (numeric, no photo)
  if (String(item.step || '') === 'odometer-value' && rawOdometerValue != null) {
    try {
      const odometerNumeric = evidenceValidation.numericValue;
      if (Number.isFinite(odometerNumeric) && odometerNumeric > 0) {
        if (!driver.km || typeof driver.km !== 'object') driver.km = {};
        driver.km.graphicOdometer = {
          value: odometerNumeric,
          source: 'graphic-app',
          updatedAt: Date.now(),
        };
        driver.raw = driver.raw || {};
        driver.raw['GFX ODOMETRO VALOR INST'] = String(odometerNumeric);
        item.odometerValue = String(odometerNumeric);
        driver.updatedAt = Date.now();
      }
    } catch (err) {
      console.warn('Falha ao registrar odometro da grafica', err?.message || err);
    }
  }

  if (provisionalDriver) db.drivers.push(provisionalDriver);
  db.evidence.push(item);

  try {
    const header = await getSheetHeader();
    const normalize = value => normalizeMasterKey(value || '');
    const headerNorm = new Map((Array.isArray(header) ? header : []).map(col => [normalize(col), col]));
    const findColumn = candidates => {
      for (const candidate of candidates) {
        const norm = normalize(candidate);
        if (headerNorm.has(norm)) return headerNorm.get(norm);
      }
      return null;
    };
    const setIfEmpty = (key, value) => {
      if (!key || !value) return false;
      driver.raw = driver.raw || {};
      if (hasValue(driver.raw[key])) return false;
      driver.raw[key] = value;
      return true;
    };

    const ts = item.createdAt || Date.now();
    const dateValue = formatSheetDate(ts);
    const timeValue = formatSheetTime(ts);
    const dateColumn = findColumn(['Data de Instalacao']);
    const timeColumn = findColumn(['Horario Plotagem']);

    let updated = false;
    updated = setIfEmpty(dateColumn || 'Data de Instalacao', dateValue) || updated;
    updated = setIfEmpty(timeColumn || 'Horario Plotagem', timeValue) || updated;
    if (updated) {
      driver.updatedAt = Date.now();
    }
  } catch (err) {
    console.warn('Falha ao preencher data/horario de plotagem automaticamente', err?.message || err);
  }

  try {
    await syncDriverRowIfPossible(db, driver, campaign);
  } catch (err) {
    console.warn('Falha ao sincronizar planilha apos envio da grafica', err?.message || err);
  }

  try {
    await upsertCampaignRecord(campaign);
    await upsertDriverRecord(driver);
    await upsertMasterRecord(campaign, driver);
    await insertEvidenceRecord({
      id,
      campaignId: campaign.id,
      driverId: driver.id,
      graphicId: item.graphicId || null,
      step: item.step || 'graphic',
      url: photoUrl,
      odometerValue: item.odometerValue || null,
      createdAt: item.createdAt,
      uploaderType: 'graphic',
      path: photoPath,
      storageFileId: photoStorageId,
    });
    photoPath = null;
    photoStorageId = null;
  } catch (err) {
    console.warn('Falha ao sincronizar Mongo apos envio da grafica', err?.message || err);
  }

  saveDB(db);
  return res.status(201).json({ ok: true, id, url: photoUrl });
});

export default router;
