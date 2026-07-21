import { getDb } from "../../../services/mongo.js";

const COL = "disparador_campaign_recipients";

async function col() {
  const db = await getDb();
  return db.collection(COL);
}

function buildId(campaignId, contactId) {
  return `${String(campaignId || "").trim()}:${String(contactId || "").trim()}`;
}

function withId(row) {
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function upsertRecipient(doc) {
  const c = await col();
  const _id = buildId(doc.campaignId, doc.contactId);
  const now = new Date().toISOString();
  const base = {
    _id,
    campaignId: String(doc.campaignId || "").trim(),
    contactId: String(doc.contactId || "").trim(),
    contactName: String(doc.contactName || "").trim(),
    phoneE164: String(doc.phoneE164 || "").trim(),
    sentAt: doc.sentAt || now,
    metaMessageId: String(doc.metaMessageId || "").trim(),
    deliveryStatus: String(doc.deliveryStatus || "sent").trim(),
    deliveryStatusAt: doc.deliveryStatusAt || now,
    deliveryError: doc.deliveryError || null,
    templateId: String(doc.templateId || "").trim(),
    templateName: String(doc.templateName || "").trim(),
    outboundMessageId: String(doc.outboundMessageId || "").trim(),
    templateFlowRunId: null,
    flowStatus: "pending",
    lastFlowStep: "",
    buttonPressed: "",
    reactedAt: null,
    updatedAt: now,
  };
  await c.replaceOne({ _id }, base, { upsert: true });
  return base;
}

export async function updateDeliveryStatusByMetaId(metaMessageId, status, statusItem = null) {
  const normalized = String(metaMessageId || "").trim();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!normalized || !normalizedStatus) return null;
  const c = await col();
  const now = new Date().toISOString();
  const set = {
    deliveryStatus: normalizedStatus,
    deliveryStatusAt: now,
    updatedAt: now,
  };
  if (normalizedStatus === "failed" && statusItem) {
    const errors = Array.isArray(statusItem?.errors) ? statusItem.errors : [];
    set.deliveryError = errors[0] || null;
  }
  const result = await c.findOneAndUpdate(
    { metaMessageId: normalized },
    { $set: set },
    { returnDocument: "after" }
  );
  return withId(result?.value || result);
}

export async function recordReactionByContact(campaignId, contactId, fields = {}) {
  const _id = buildId(campaignId, contactId);
  const c = await col();
  const now = new Date().toISOString();
  const set = { updatedAt: now };
  if (fields.templateFlowRunId) set.templateFlowRunId = String(fields.templateFlowRunId);
  if (fields.flowStatus) set.flowStatus = String(fields.flowStatus);
  if (fields.lastFlowStep != null) set.lastFlowStep = String(fields.lastFlowStep || "");
  if (fields.buttonPressed != null) set.buttonPressed = String(fields.buttonPressed || "");
  if (!set.reactedAt) set.reactedAt = fields.reactedAt || now;

  // Primary: match by _id (campaignId:contactId)
  const primaryResult = await c.updateOne({ _id }, { $set: set });
  if (primaryResult.matchedCount > 0) return;

  // Fallback: match by metaMessageId (outbound template message ID — stable, never changes)
  // Necessary when contactId resolved at webhook time differs from contactId at dispatch time
  const sourceMetaId = String(fields.sourceMetaMessageId || "").trim();
  if (sourceMetaId) {
    await c.updateOne({ metaMessageId: sourceMetaId }, { $set: set });
  }
}

export async function findRecipientByMetaMessageId(metaMessageId) {
  const normalized = String(metaMessageId || "").trim();
  if (!normalized) return null;
  const c = await col();
  return withId(await c.findOne({ metaMessageId: normalized }));
}

export async function findRecipientsByCampaign(campaignId, filters = {}) {
  const c = await col();
  const query = { campaignId: String(campaignId || "").trim() };
  if (filters.deliveryStatus) query.deliveryStatus = filters.deliveryStatus;
  if (filters.flowStatus) query.flowStatus = filters.flowStatus;
  if (filters.reacted === true) query.reactedAt = { $ne: null };
  if (filters.reacted === false) query.reactedAt = null;
  const rows = await c.find(query).sort({ contactName: 1 }).toArray();
  return rows.map(withId);
}

export async function countRecipientsByCampaign(campaignId) {
  const c = await col();
  const cId = String(campaignId || "").trim();
  const pipeline = [
    { $match: { campaignId: cId } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] } },
        read: { $sum: { $cond: [{ $eq: ["$deliveryStatus", "read"] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$deliveryStatus", "failed"] }, 1, 0] } },
        reacted: { $sum: { $cond: [{ $ne: ["$reactedAt", null] }, 1, 0] } },
        noReaction: { $sum: { $cond: [{ $and: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, { $eq: ["$reactedAt", null] }] }, 1, 0] } },
      },
    },
  ];
  const rows = await c.aggregate(pipeline).toArray();
  const r = rows[0] || {};
  return {
    total: r.total || 0,
    delivered: r.delivered || 0,
    read: r.read || 0,
    failed: r.failed || 0,
    reacted: r.reacted || 0,
    noReaction: r.noReaction || 0,
  };
}

export async function ensureCampaignRecipientIndexes() {
  const c = await col();
  await c.createIndex({ campaignId: 1, contactName: 1 }, { background: true });
  await c.createIndex({ metaMessageId: 1 }, { sparse: true, background: true });
  await c.createIndex({ campaignId: 1, deliveryStatus: 1 }, { background: true });
  await c.createIndex({ campaignId: 1, flowStatus: 1 }, { background: true });
  await c.createIndex({ updatedAt: -1 }, { background: true });
}
