import { getDb } from "../../../services/mongo.js";

const COL = "disparador_automation_queue";

async function col() {
  const db = await getDb();
  return db.collection(COL);
}

export async function ensureAutomationQueueIndexes() {
  const c = await col();
  await c.createIndex({ key: 1 }, { unique: true });
  await c.createIndex({ createdAt: 1 });
}

export async function insertJob(job) {
  const c = await col();
  await c.insertOne(job);
}

export async function removeJobByKey(key) {
  const c = await col();
  await c.deleteOne({ key });
}

export async function loadPendingJobs() {
  const c = await col();
  return c.find({}).sort({ createdAt: 1 }).toArray();
}

export async function clearAllJobs() {
  const c = await col();
  await c.deleteMany({});
}
