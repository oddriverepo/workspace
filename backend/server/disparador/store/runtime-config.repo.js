/**
 * runtime-config.repo.js
 *
 * MongoDB-backed key-value store for runtime configuration that can be
 * updated without restarting the server (e.g. META_SYSTEM_USER_TOKEN
 * obtained via OAuth onboarding).
 *
 * Collection: disparador_runtime_config
 * Document shape: { _id, key, value, updatedAt }
 */
import { getDb } from "../../services/mongo.js";
import { encryptSecret, decryptSecret, isSensitiveConfigKey } from "../../services/secretVault.js";

const COLLECTION = "disparador_runtime_config";

async function col() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

export async function ensureRuntimeConfigIndexes() {
  const c = await col();
  await c.createIndex({ key: 1 }, { unique: true });
}

export async function getRuntimeConfig(key) {
  const c = await col();
  const doc = await c.findOne({ key });
  return doc ? decryptSecret(doc.value) : null;
}

export async function setRuntimeConfig(key, value) {
  const c = await col();
  const storedValue = isSensitiveConfigKey(key) ? encryptSecret(value) : value;
  await c.updateOne(
    { key },
    { $set: { key, value: storedValue, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
}

export async function deleteRuntimeConfig(key) {
  const c = await col();
  await c.deleteOne({ key });
}

export async function listRuntimeConfig() {
  const c = await col();
  const rows = await c.find({}).toArray();
  return rows.map((row) => ({
    ...row,
    value: isSensitiveConfigKey(row.key) ? '[redacted]' : row.value,
  }));
}
