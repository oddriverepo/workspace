import { getDb } from "../../../services/mongo.js";

const COL = "disparador_templates";

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

export async function findAll() {
  const c = await col();
  const rows = await c.find({}).toArray();
  return rows.map((r) => ({ ...r, id: r._id }));
}

export async function updateFields(id, fields) {
  const c = await col();
  await c.updateOne({ _id: id }, { $set: fields });
}

export async function ensureIndexes() {
  const c = await col();
  await c.createIndex({ name: 1 }, { background: true });
  await c.createIndex({ metaTemplateId: 1 }, { sparse: true, background: true });
}
