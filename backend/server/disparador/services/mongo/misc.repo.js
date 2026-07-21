import { getDb } from "../../../services/mongo.js";

// ── Webhook Events ─────────────────────────────────────────────

const WEBHOOK_COL = "disparador_webhook_events";

export async function insertWebhookEvent(doc) {
  const db = await getDb();
  await db.collection(WEBHOOK_COL).insertOne({ _id: doc.id, ...doc });
}

export async function findWebhookEvents(limit = 50) {
  const db = await getDb();
  const rows = await db
    .collection(WEBHOOK_COL)
    .find({})
    .sort({ receivedAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map((r) => ({ ...r, id: r._id }));
}

// ── Idempotency Cache ──────────────────────────────────────────

const IDEMP_COL = "disparador_idempotency";

export async function getIdempotent(key) {
  if (!key) return null;
  const db = await getDb();
  const row = await db.collection(IDEMP_COL).findOne({ _id: key });
  return row ? row.value : null;
}

export async function setIdempotent(key, value) {
  if (!key) return;
  const db = await getDb();
  await db.collection(IDEMP_COL).replaceOne(
    { _id: key },
    { _id: key, value, updatedAt: new Date().toISOString() },
    { upsert: true },
  );
}

// ── Onboarding Sessions ───────────────────────────────────────

const ONBOARD_COL = "disparador_onboarding";

export async function insertOnboarding(doc) {
  const db = await getDb();
  await db.collection(ONBOARD_COL).replaceOne(
    { _id: doc.state },
    { _id: doc.state, ...doc },
    { upsert: true },
  );
}

export async function findOnboarding(stateId) {
  const db = await getDb();
  const row = await db.collection(ONBOARD_COL).findOne({ _id: stateId });
  if (!row) return null;
  const { _id, ...rest } = row;
  return { state: _id, ...rest };
}

export async function updateOnboarding(stateId, fields) {
  const db = await getDb();
  await db.collection(ONBOARD_COL).updateOne({ _id: stateId }, { $set: fields });
}

// ── Indexes ────────────────────────────────────────────────────

export async function ensureIndexes() {
  try {
    const db = await getDb();
    await db.collection(WEBHOOK_COL).createIndex({ receivedAt: -1 });
    await db.collection(IDEMP_COL).createIndex(
      { updatedAt: 1 },
      { expireAfterSeconds: 86400 * 7 },
    );
  } catch (_) {}
}
