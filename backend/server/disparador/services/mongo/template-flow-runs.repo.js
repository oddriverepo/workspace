import { getDb } from "../../../services/mongo.js";

const COL = "disparador_template_flow_runs";

async function col() {
  const db = await getDb();
  return db.collection(COL);
}

function withId(row) {
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function insertRun(doc) {
  const c = await col();
  await c.insertOne({ _id: doc.id, ...doc });
  return doc;
}

export async function replaceRun(doc) {
  const c = await col();
  await c.replaceOne({ _id: doc.id }, { _id: doc.id, ...doc }, { upsert: true });
  return doc;
}

export async function findRunById(id) {
  const c = await col();
  return withId(await c.findOne({ _id: id }));
}

export async function findRunByInboundMetaMessageId(metaMessageId) {
  const normalized = String(metaMessageId || "").trim();
  if (!normalized) return null;
  const c = await col();
  return withId(await c.findOne({ inboundMetaMessageId: normalized }));
}

export async function findRunByInboundMessageId(messageId) {
  const normalized = String(messageId || "").trim();
  if (!normalized) return null;
  const c = await col();
  return withId(await c.findOne({ inboundMessageId: normalized }));
}

export async function findHandledRunBySourceMessage(contactId, sourceTemplateMessageId, sourceTemplateMetaMessageId) {
  const normalizedContactId = String(contactId || "").trim();
  const normalizedSourceMessageId = String(sourceTemplateMessageId || "").trim();
  const normalizedSourceMetaMessageId = String(sourceTemplateMetaMessageId || "").trim();
  if (!normalizedContactId || (!normalizedSourceMessageId && !normalizedSourceMetaMessageId)) return null;

  const query = {
    contactId: normalizedContactId,
    status: { $in: ["completed", "handoff", "failed"] },
    $or: [],
  };

  if (normalizedSourceMessageId) {
    query.$or.push({ sourceTemplateMessageId: normalizedSourceMessageId });
  }
  if (normalizedSourceMetaMessageId) {
    query.$or.push({ sourceTemplateMetaMessageId: normalizedSourceMetaMessageId });
  }

  const c = await col();
  const row = await c.find(query).sort({ startedAt: -1 }).limit(1).next();
  return withId(row);
}

export async function ensureTemplateFlowRunIndexes() {
  const c = await col();
  await c.createIndex({ inboundMetaMessageId: 1 }, { unique: true, sparse: true, background: true });
  await c.createIndex({ inboundMessageId: 1 }, { unique: true, sparse: true, background: true });
  await c.createIndex({ contactId: 1, startedAt: -1 }, { background: true });
  await c.createIndex({ sourceTemplateMessageId: 1, startedAt: -1 }, { sparse: true, background: true });
  await c.createIndex({ sourceTemplateMetaMessageId: 1, startedAt: -1 }, { sparse: true, background: true });
  await c.createIndex({ contactId: 1, status: 1, sourceTemplateMessageId: 1, startedAt: -1 }, { sparse: true, background: true });
  await c.createIndex({ contactId: 1, status: 1, sourceTemplateMetaMessageId: 1, startedAt: -1 }, { sparse: true, background: true });
}
