import fs from 'fs';
import { getDb } from './mongo.js';

const DB_PATH = new URL('../data/db.json', import.meta.url);
const LEGACY_COLLECTION = 'admin_state';
const LEGACY_DOC_ID = 'legacy-db';
const DB_TYPE = (process.env.DB_TYPE || '').toLowerCase().trim();
const USE_MONGO = DB_TYPE === 'mongo' || (!DB_TYPE && !!process.env.MONGO_URI);

let cachedDb = null;
let initPromise = null;
let persistPromise = null;

function createEmptyDb() {
  return {
    campaigns: [],
    drivers: [],
    review: [],
    graphics: [],
    evidence: [],
    settings: {},
    sessions: [],
    adminSessions: [],
  };
}

function normalizeDb(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyDb();
  return {
    campaigns: Array.isArray(raw.campaigns) ? raw.campaigns : [],
    drivers: Array.isArray(raw.drivers) ? raw.drivers : [],
    review: Array.isArray(raw.review) ? raw.review : [],
    graphics: Array.isArray(raw.graphics) ? raw.graphics : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    adminSessions: Array.isArray(raw.adminSessions) ? raw.adminSessions : [],
  };
}

function readFromDisk() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    return normalizeDb(data);
  } catch {
    return createEmptyDb();
  }
}

function writeToDisk(db) {
  // Security: when DB_TYPE=mongo, do NOT persist to disk to avoid plaintext data exposure
  if (USE_MONGO) {
    return; // skip disk write
  }
  try {
    fs.mkdirSync(new URL('.', DB_PATH), { recursive: true });
  } catch {
    // ignore mkdir errors
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

async function persistToMongo(db) {
  try {
    const database = await getDb();
    const col = database.collection(LEGACY_COLLECTION);
    await col.replaceOne(
      { _id: LEGACY_DOC_ID },
      { payload: db, updatedAt: new Date() },
      { upsert: true },
    );
  } catch (err) {
    console.warn('[legacyStore] Falha ao persistir estado no Mongo:', err?.message || err);
  }
}

async function hydrateFromMongo() {
  const database = await getDb();
  const col = database.collection(LEGACY_COLLECTION);
  const doc = await col.findOne({ _id: LEGACY_DOC_ID });
  if (doc && doc.payload) {
    cachedDb = normalizeDb(doc.payload);
  } else {
    cachedDb = normalizeDb(readFromDisk());
    await persistToMongo(cachedDb);
  }
}

export async function ensureLegacyStoreReady() {
  if (cachedDb) return;
  if (USE_MONGO) {
    if (!initPromise) initPromise = hydrateFromMongo();
    await initPromise;
    return;
  }
  cachedDb = readFromDisk();
}

export function loadLegacyDb() {
  if (!cachedDb) {
    cachedDb = USE_MONGO ? createEmptyDb() : readFromDisk();
  }
  return cachedDb;
}

export function saveLegacyDb(db) {
  cachedDb = db || createEmptyDb();
  const snapshot = normalizeDb(cachedDb);
  if (USE_MONGO) {
    persistPromise = persistPromise
      ? persistPromise.then(() => persistToMongo(snapshot))
      : persistToMongo(snapshot);
    persistPromise.catch(err => console.warn('[legacyStore] Persist loop', err?.message || err));
    // Security: do NOT write to disk when using Mongo
  } else {
    writeToDisk(snapshot);
  }
}
