import { randomUUID } from "crypto";
import { getDb } from "../../../services/mongo.js";

const COL = "disparador_dispatch_runs";

async function col() {
  const db = await getDb();
  return db.collection(COL);
}

/**
 * Create a dispatch run record (before sending starts).
 * source: 'campaign_attention' | 'drivers_bulk' | 'overview_bulk' | 'disparador_campaign'
 */
export async function createDispatchRun(doc) {
  const c = await col();
  const _id = randomUUID();
  const now = new Date().toISOString();
  const run = {
    _id,
    source: String(doc.source || "unknown"),
    sourceName: String(doc.sourceName || ""),
    campaignId: String(doc.campaignId || ""),
    campaignName: String(doc.campaignName || ""),
    templateId: String(doc.templateId || ""),
    templateName: String(doc.templateName || ""),
    operatorId: String(doc.operatorId || ""),
    operatorName: String(doc.operatorName || ""),
    triggeredAt: doc.triggeredAt || now,
    finishedAt: null,
    status: "running",
    totals: { targeted: 0, sent: 0, failed: 0, blocked: 0, noPhone: 0 },
    results: [],
  };
  await c.insertOne(run);
  return { ...run, id: _id };
}

/**
 * Mark a run as done with final summary.
 * results: [{ driverId, name, phone, status, error? }]
 */
export async function completeDispatchRun(runId, { totals = {}, results = [], finishedAt } = {}) {
  const c = await col();
  const now = new Date().toISOString();
  await c.updateOne(
    { _id: runId },
    {
      $set: {
        finishedAt: finishedAt || now,
        status: "done",
        totals: {
          targeted: Number(totals.targeted || 0),
          sent: Number(totals.sent || 0),
          failed: Number(totals.failed || 0),
          blocked: Number(totals.blocked || 0),
          noPhone: Number(totals.noPhone || 0),
        },
        results: Array.isArray(results) ? results : [],
      },
    }
  );
}

/**
 * List recent dispatch runs, sorted by date desc.
 * Optional filters: { operatorId }
 */
export async function listDispatchRuns(limitOrFilters = 300, maybeFilters = null) {
  let limit = 300;
  let filters = {};
  if (typeof limitOrFilters === "number") {
    limit = limitOrFilters;
    filters = maybeFilters || {};
  } else if (limitOrFilters && typeof limitOrFilters === "object") {
    filters = limitOrFilters;
    limit = Number(filters.limit) > 0 ? Number(filters.limit) : 300;
  }
  const query = {};
  if (filters.operatorId) query.operatorId = String(filters.operatorId);
  const c = await col();
  const items = await c.find(query).sort({ triggeredAt: -1 }).limit(limit).toArray();
  return items.map((r) => ({ ...r, id: r._id }));
}

/**
 * Distinct operators that have at least one dispatch run.
 * Returns: [{ operatorId, operatorName }]
 */
export async function listDispatchRunOperators() {
  const c = await col();
  const rows = await c
    .aggregate([
      { $match: { operatorId: { $nin: [null, ""] } } },
      { $group: { _id: "$operatorId", operatorName: { $last: "$operatorName" } } },
      { $project: { _id: 0, operatorId: "$_id", operatorName: 1 } },
    ])
    .toArray();
  return rows;
}

/**
 * Get a single dispatch run by id (includes full results array).
 */
export async function getDispatchRunById(runId) {
  const c = await col();
  const r = await c.findOne({ _id: String(runId || "").trim() });
  if (!r) return null;
  return { ...r, id: r._id };
}

export async function ensureDispatchRunIndexes() {
  const c = await col();
  await Promise.all([
    c.createIndex({ triggeredAt: -1 }),
    c.createIndex({ source: 1, triggeredAt: -1 }),
    c.createIndex({ campaignId: 1 }, { sparse: true }),
    c.createIndex({ operatorId: 1, triggeredAt: -1 }, { sparse: true }),
  ]);
}
