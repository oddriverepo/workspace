import { getDb } from "../../../services/mongo.js";

const COL = "disparador_flow_runs";

async function col() {
  const db = await getDb();
  return db.collection(COL);
}

export async function insert(doc) {
  const c = await col();
  await c.replaceOne({ _id: doc.id }, { _id: doc.id, ...doc }, { upsert: true });
}

export async function findById(id) {
  const c = await col();
  const row = await c.findOne({ _id: id });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findAll(filters = {}) {
  const c = await col();
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.flowId) query.flowId = filters.flowId;
  if (filters.flowKey) query.flowKey = filters.flowKey;
  if (filters.contactId) query.contactId = filters.contactId;
  const rows = await c.find(query).sort({ updatedAt: -1 }).toArray();
  return rows.map((r) => ({ ...r, id: r._id }));
}

export async function findLatestActiveByContact(contactId, flowKey = "") {
  const c = await col();
  const query = { contactId, status: "active" };
  if (flowKey) query.flowKey = flowKey;
  const row = await c.findOne(query, { sort: { updatedAt: -1 } });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function updateFields(id, fields) {
  const c = await col();
  await c.updateOne({ _id: id }, { $set: fields });
}

export async function replaceDoc(doc) {
  const c = await col();
  await c.replaceOne({ _id: doc.id }, { _id: doc.id, ...doc }, { upsert: true });
}

export async function ensureIndexes() {
  const c = await col();
  await c.createIndex({ contactId: 1, status: 1 }, { background: true });
  await c.createIndex({ flowId: 1 }, { background: true });
  await c.createIndex({ flowKey: 1, status: 1 }, { background: true });
  await c.createIndex({ updatedAt: -1 }, { background: true });
}
