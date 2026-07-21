import { getDb } from "../../../services/mongo.js";

const CONV_COL = "disparador_inbox_conversations";
const MSG_COL = "disparador_inbox_messages";

async function convCol() {
  const db = await getDb();
  return db.collection(CONV_COL);
}

async function msgCol() {
  const db = await getDb();
  return db.collection(MSG_COL);
}

// ── Conversations ──────────────────────────────────────────────

export async function upsertConversation(doc) {
  const c = await convCol();
  await c.replaceOne({ _id: doc.id }, { _id: doc.id, ...doc }, { upsert: true });
}

export async function findConversationById(id) {
  const c = await convCol();
  const row = await c.findOne({ _id: id });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findConversationByContactId(contactId) {
  const c = await convCol();
  const row = await c.findOne({ contactId });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findConversationByPhone(phoneE164) {
  const c = await convCol();
  const row = await c.findOne({ phoneE164 });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findAllConversations(filters = {}) {
  const c = await convCol();
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.search) {
    const escaped = String(filters.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = { $regex: escaped, $options: "i" };
    query.$or = [{ displayName: regex }, { phoneE164: regex }, { lastMessagePreview: regex }];
  }
  // operator filter: includes own conversations OR ones never contacted (no operator assigned)
  if (filters.operatorId) {
    const opQuery = [
      { operatorId: String(filters.operatorId) },
      { operatorId: { $in: [null, ""] } },
      { operatorId: { $exists: false } },
    ];
    if (query.$or) {
      // combine search + operator with $and
      query.$and = [{ $or: query.$or }, { $or: opQuery }];
      delete query.$or;
    } else {
      query.$or = opQuery;
    }
  }
  const limit = filters.limit || 200;
  const sortField = filters.sortField || "lastMessageAt";
  const rows = await c.find(query).sort({ [sortField]: -1, updatedAt: -1 }).limit(limit).toArray();
  return rows.map((r) => ({ ...r, id: r._id }));
}

/**
 * Distinct operators that own at least one conversation.
 * Returns: [{ operatorId, operatorName }]
 */
export async function listConversationOperators() {
  const c = await convCol();
  const rows = await c
    .aggregate([
      { $match: { operatorId: { $nin: [null, ""] } } },
      { $group: { _id: "$operatorId", operatorName: { $last: "$operatorName" } } },
      { $project: { _id: 0, operatorId: "$_id", operatorName: 1 } },
    ])
    .toArray();
  return rows;
}

export async function updateConversationFields(id, fields) {
  const c = await convCol();
  await c.updateOne({ _id: id }, { $set: fields });
}

// ── Messages ───────────────────────────────────────────────────

export async function insertMessage(doc) {
  const c = await msgCol();
  const existing = await c.findOne({ _id: doc.id });
  if (existing) return { ...existing, id: existing._id };
  await c.insertOne({ _id: doc.id, ...doc });
  return doc;
}

export async function findMessageById(id) {
  const c = await msgCol();
  const row = await c.findOne({ _id: id });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findMessageByMetaId(metaMessageId) {
  const c = await msgCol();
  const row = await c.findOne({ metaMessageId });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findMessagesByConversation(conversationId, options = {}) {
  const c = await msgCol();
  const limitRaw = Number(options.limit || 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.round(limitRaw))) : 100;
  const before = String(options.before || "").trim();
  const query = { conversationId };
  if (before) {
    query.createdAt = { $lt: before };
  }

  const rows = await c
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .toArray();
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const ordered = slice.reverse().map((r) => ({ ...r, id: r._id }));
  const nextBefore = hasMore && ordered.length
    ? String(ordered[0].createdAt || "").trim()
    : "";
  return { items: ordered, hasMore, nextBefore };
}

export async function findLatestOutboundTemplateMessage(conversationId, before = "") {
  const c = await msgCol();
  const query = {
    conversationId,
    direction: "outbound",
    kind: "template",
  };
  const normalizedBefore = String(before || "").trim();
  if (normalizedBefore) {
    query.createdAt = { $lt: normalizedBefore };
  }
  const row = await c.find(query).sort({ createdAt: -1 }).limit(1).next();
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findOutboundTemplateByMetaMessageId(metaMessageId) {
  const c = await msgCol();
  const normalizedId = String(metaMessageId || "").trim();
  if (!normalizedId) return null;
  const row = await c.findOne({
    metaMessageId: normalizedId,
    direction: "outbound",
    kind: "template",
  });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function findOutboundFlowMessageByMetaMessageId(metaMessageId) {
  const c = await msgCol();
  const normalizedId = String(metaMessageId || "").trim();
  if (!normalizedId) return null;
  const row = await c.findOne({
    metaMessageId: normalizedId,
    direction: "outbound",
    source: "od-flow-studio",
  });
  if (!row) return null;
  return { ...row, id: row._id };
}

export async function updateMessageFields(id, fields) {
  const c = await msgCol();
  await c.updateOne({ _id: id }, { $set: fields });
}

// ── Indexes (call once at startup) ─────────────────────────────

export async function ensureIndexes() {
  try {
    const cc = await convCol();
    await cc.createIndex({ contactId: 1 });
    await cc.createIndex({ phoneE164: 1 });
    await cc.createIndex({ lastMessageAt: -1 });
    await cc.createIndex({ operatorId: 1, lastMessageAt: -1 }, { sparse: true });
    const mc = await msgCol();
    await mc.createIndex({ conversationId: 1, createdAt: 1 });
    await mc.createIndex({ conversationId: 1, direction: 1, kind: 1, createdAt: -1 });
    await mc.createIndex({ metaMessageId: 1 }, { sparse: true });
  } catch (_) {}
}
