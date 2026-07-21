import { MongoClient } from 'mongodb';

const URI = process.env.ODDRIVE_DB_URI || '';
const DB_NAME = process.env.ODDRIVE_DB_NAME || 'ODDrive';
const DEFAULT_MAX_TIME_MS = Number(process.env.ODDRIVE_MAX_TIME_MS) || 8000;

let client = null;
let connecting = null;

function buildClient() {
  if (!URI) {
    const err = new Error('ODDRIVE_DB_URI não configurada (cliente read-only da OdDrive).');
    err.code = 'ODDRIVE_DB_URI_MISSING';
    throw err;
  }
  return new MongoClient(URI, {
    readPreference: 'secondaryPreferred',
    retryWrites: false,
    retryReads: true,
    maxPoolSize: 3,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 20000,
    appName: 'oddrive-mirror-ro',
  });
}

export async function getLiveDb() {
  if (client) return client.db(DB_NAME);
  if (connecting) { await connecting; return client.db(DB_NAME); }
  connecting = (async () => {
    const c = buildClient();
    await c.connect();
    client = c;
  })();
  try {
    await connecting;
  } finally {
    connecting = null;
  }
  return client.db(DB_NAME);
}

export async function liveCollection(name) {
  const db = await getLiveDb();
  return db.collection(name);
}

export { DEFAULT_MAX_TIME_MS, DB_NAME as ODDRIVE_DB_NAME };

export async function closeLiveClient() {
  if (client) { await client.close(); client = null; }
}
