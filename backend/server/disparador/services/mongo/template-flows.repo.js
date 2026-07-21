import { getDb } from "../../../services/mongo.js";

const FLOWS_COL = "disparador_template_flows";
const VERSIONS_COL = "disparador_template_flow_versions";

async function flowsCol() {
  const db = await getDb();
  return db.collection(FLOWS_COL);
}

async function versionsCol() {
  const db = await getDb();
  return db.collection(VERSIONS_COL);
}

function withId(row) {
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function upsertFlow(doc) {
  const c = await flowsCol();
  try {
    await c.replaceOne({ _id: doc.id }, { _id: doc.id, ...doc }, { upsert: true });
  } catch (err) {
    console.error("[TEMPLATE_FLOW_UPSERT_ERROR]", {
      docId: doc?.id,
      templateId: doc?.templateId,
      code: err?.code,
      message: err?.message,
    });
    throw err;
  }
}

export async function findFlowById(id) {
  const c = await flowsCol();
  const row = await c.findOne({ _id: id });
  return withId(row);
}

export async function findFlowByTemplateId(templateId) {
  const c = await flowsCol();
  const row = await c.findOne({ templateId: String(templateId || "").trim() });
  return withId(row);
}

export async function listFlows() {
  const c = await flowsCol();
  const rows = await c.find({}).sort({ updatedAt: -1 }).toArray();
  return rows.map(withId);
}

export async function insertVersion(doc) {
  const c = await versionsCol();
  await c.replaceOne({ _id: doc.id }, { _id: doc.id, ...doc }, { upsert: true });
}

export async function listVersionsByFlowId(flowId) {
  const c = await versionsCol();
  const rows = await c.find({ flowId: String(flowId || "").trim() }).sort({ version: -1 }).toArray();
  return rows.map(withId);
}

export async function ensureTemplateFlowIndexes() {
  const flows = await flowsCol();
  await flows.createIndex({ templateId: 1 }, { unique: true, background: true });
  await flows.createIndex({ updatedAt: -1 }, { background: true });
  await flows.createIndex({ publishedAt: -1 }, { background: true, sparse: true });

  const versions = await versionsCol();
  await versions.createIndex({ flowId: 1, version: -1 }, { unique: true, background: true });
  await versions.createIndex({ templateId: 1, createdAt: -1 }, { background: true });
}
