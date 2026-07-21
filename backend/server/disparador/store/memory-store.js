/**
 * Disparador store – MongoDB-backed facade.
 *
 * Every exported function keeps the SAME signature as the original in-memory
 * store but is now **async** and delegates persistence to the repo layer.
 * Business logic (flow transitions, contact merging, inbox management)
 * stays here.
 */
import { randomUUID } from "crypto";

import * as bridge from "../services/mongo/bridge.js";
import * as templateRepo from "../services/mongo/templates.repo.js";
import * as waCampaignRepo from "../services/mongo/whatsapp-campaigns.repo.js";
import * as campaignRecipientsRepo from "../services/mongo/campaign-recipients.repo.js";
import * as dispatchRunsRepo from "../services/mongo/dispatch-runs.repo.js";
import * as flowRepo from "../services/mongo/flows.repo.js";
import * as flowRunRepo from "../services/mongo/flow-runs.repo.js";
import * as inboxRepo from "../services/mongo/inbox.repo.js";
import * as miscRepo from "../services/mongo/misc.repo.js";
import { broadcast } from "../services/inbox-events.js";

// ── Helpers (unchanged) ────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeFlowKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEventType(value) {
  return String(value || "").trim().toLowerCase();
}

function parseTimeoutMinutes(node) {
  const value = Number(node?.runtimeConfig?.timeoutMinutes || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function computeDueAt(node) {
  const timeout = parseTimeoutMinutes(node);
  if (!timeout) return null;
  return new Date(Date.now() + timeout * 60 * 1000).toISOString();
}

function findEdgeByLabel(edges, label) {
  const normalized = String(label || "").trim().toLowerCase();
  if (!normalized) return null;
  return edges.find((edge) => String(edge.l || "").trim().toLowerCase() === normalized) || null;
}

function findConditionEdge(edges, isTruePath) {
  if (!Array.isArray(edges) || !edges.length) return null;
  const trueLabels = ["sim", "true", "yes", "positivo"];
  const falseLabels = ["nao", "não", "false", "no", "negativo"];
  const labels = isTruePath ? trueLabels : falseLabels;
  return edges.find((edge) => labels.includes(String(edge.l || "").trim().toLowerCase())) || null;
}

function getFlowDefinitionNode(flow, nodeId) {
  const nodes = flow?.definition?.nodes;
  if (!Array.isArray(nodes)) return null;
  return nodes.find((node) => String(node.id) === String(nodeId)) || null;
}

function getFlowDefinitionEdgesFrom(flow, nodeId) {
  const edges = flow?.definition?.edges;
  if (!Array.isArray(edges)) return [];
  return edges.filter((edge) => String(edge.f) === String(nodeId));
}

function normalizeInboxDirection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["inbound", "outbound", "system"].includes(normalized)) return normalized;
  return "system";
}

function normalizeInboxKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const valid = new Set([
    "text", "template", "status", "interactive", "image", "audio", "video",
    "document", "sticker", "location", "contacts", "reaction", "unknown",
  ]);
  return valid.has(normalized) ? normalized : "unknown";
}

function safeIso(value, fallback = nowIso()) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.valueOf())) return fallback;
  return date.toISOString();
}

function buildInboxPreview(message = {}) {
  const text = String(message.text || "").trim();
  const renderedText = String(message?.payload?.renderedText || "").trim();
  const media = message?.payload?.media && typeof message.payload.media === "object" ? message.payload.media : null;
  const templateName = String(message.templateName || "").trim();
  const status = String(message.deliveryStatus || "").trim();
  if (text) return text.slice(0, 160);
  if (renderedText) return renderedText.slice(0, 160);
  if (media?.kind === "image") return String(media.caption ? `Imagem: ${media.caption}` : "Imagem recebida").slice(0, 160);
  if (media?.kind === "video") return String(media.caption ? `Video: ${media.caption}` : "Video recebido").slice(0, 160);
  if (media?.kind === "document") return String(media.filename ? `Documento: ${media.filename}` : "Documento recebido").slice(0, 160);
  if (media?.kind === "audio") return String(media.isVoiceNote ? "Mensagem de voz" : "Audio recebido").slice(0, 160);
  if (message.kind === "template" && templateName) return `Template: ${templateName}`;
  if (message.kind === "status" && status) return `Status: ${status}`;
  return message.kind === "unknown" ? "Mensagem" : message.kind;
}

function normalizeContactSnapshot(value) {
  const raw = value && typeof value === "object" ? value : null;
  if (!raw) return null;
  const id = String(raw.id || "").trim();
  const name = String(raw.name || raw.firstName || "").trim();
  const phoneE164 = String(raw.phoneE164 || "").trim();
  const avatar = String(raw.avatar || "").trim();
  const optIn = raw.optIn === true;
  if (!id && !name && !phoneE164 && !avatar && !optIn) return null;
  return { id, name, phoneE164, avatar, optIn };
}

// ── Contacts (bridge to drivers + orphans) ─────────────────────

export async function upsertContact(input) {
  return bridge.upsertContact(input);
}

export async function listContacts() {
  return bridge.listContacts();
}

export async function getContactByPhone(phoneE164) {
  return bridge.getContactByPhone(phoneE164);
}

export async function getContactById(id) {
  return bridge.getContactById(id);
}

// ── Lists (bridge to campaigns + custom lists) ─────────────────

export async function createList(input) {
  return bridge.createList(input);
}

export async function getListByName(name) {
  return bridge.getListByName(name);
}

export async function getOrCreateListByName(name, extra = {}) {
  const existing = await bridge.getListByName(name);
  if (existing) return existing;
  return bridge.createList({ name, ...extra });
}

export async function addContactsToList(listId, contactIds) {
  return bridge.addContactsToList(listId, contactIds);
}

export async function listLists() {
  return bridge.listLists();
}

export async function getListById(id) {
  return bridge.getListById(id);
}

// ── Templates ──────────────────────────────────────────────────

export async function createTemplate(input) {
  const timestamp = nowIso();
  const id = randomUUID();
  const normalizedButtons = Array.isArray(input.buttons)
    ? input.buttons
        .map((item) => ({
          type: String(item?.type || "quick_reply"),
          text: String(item?.text || "").trim().slice(0, 25),
          url: item?.url ? String(item.url).trim() : "",
          phoneNumber: item?.phoneNumber ? String(item.phoneNumber).trim() : "",
        }))
        .filter((item) => item.text)
        .slice(0, 3)
    : [];

  const template = {
    id,
    name: input.name,
    language: input.language,
    category: input.category,
    status: input.status || "draft",
    bodyText: input.bodyText || "",
    headerType: input.headerType || "none",
    headerText: input.headerText || "",
    headerMediaHandle: input.headerMediaHandle || "",
    headerMediaUrl: input.headerMediaUrl || "",
    footerText: input.footerText || "",
    buttons: normalizedButtons,
    metaTemplateId: input.metaTemplateId || "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await templateRepo.insert(template);
  return template;
}

export async function updateTemplateStatus(id, status, extras = {}) {
  const current = await templateRepo.findById(id);
  if (!current) return null;
  const fields = { status, updatedAt: nowIso(), ...extras };
  await templateRepo.updateFields(id, fields);
  return { ...current, ...fields };
}

export async function listTemplates() {
  return templateRepo.findAll();
}

export async function getTemplateById(id) {
  return templateRepo.findById(id);
}

// ── WhatsApp Campaigns ─────────────────────────────────────────

export async function createCampaign(input) {
  const timestamp = nowIso();
  const id = randomUUID();
  const campaign = {
    id,
    name: input.name,
    listId: input.listId,
    templateId: input.templateId,
    status: "draft",
    scheduledAt: input.scheduledAt || null,
    startedAt: null,
    finishedAt: null,
    metrics: { queued: 0, sent: 0, delivered: 0, failed: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await waCampaignRepo.insert(campaign);
  return campaign;
}

export async function getCampaignById(id) {
  return waCampaignRepo.findById(id);
}

export async function listCampaigns() {
  return waCampaignRepo.findAll();
}

export async function startCampaign(id, metrics) {
  const current = await waCampaignRepo.findById(id);
  if (!current) return null;
  const timestamp = nowIso();
  const fields = {
    status: "running",
    startedAt: current.startedAt || timestamp,
    updatedAt: timestamp,
    metrics: { ...current.metrics, ...metrics },
  };
  await waCampaignRepo.updateFields(id, fields);
  return { ...current, ...fields };
}

export async function completeCampaign(id, metrics = {}) {
  const current = await waCampaignRepo.findById(id);
  if (!current) return null;
  const timestamp = nowIso();
  const fields = {
    status: "completed",
    finishedAt: timestamp,
    updatedAt: timestamp,
    metrics: { ...current.metrics, ...metrics },
  };
  await waCampaignRepo.updateFields(id, fields);
  return { ...current, ...fields };
}

// ── Flows ──────────────────────────────────────────────────────

export async function listFlows() {
  return flowRepo.findAll();
}

export async function getFlowById(id) {
  return flowRepo.findById(id);
}

export async function getFlowByKey(key) {
  const normalized = normalizeFlowKey(key);
  if (!normalized) return null;
  return flowRepo.findByKey(normalized);
}

export async function createFlow(input) {
  const timestamp = nowIso();
  const id = randomUUID();
  const item = {
    id,
    key: normalizeFlowKey(input.key),
    name: input.name,
    description: input.description || "",
    status: input.status || "draft",
    version: 1,
    definition: deepClone(input.definition),
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: input.status === "published" ? timestamp : null,
  };
  await flowRepo.insert(item);
  return deepClone(item);
}

export async function updateFlow(id, input) {
  const current = await flowRepo.findById(id);
  if (!current) return null;
  const timestamp = nowIso();
  const next = {
    ...current,
    key: input.key ? normalizeFlowKey(input.key) : current.key,
    name: input.name || current.name,
    description: input.description !== undefined ? input.description : current.description,
    status: input.status || current.status,
    definition: input.definition ? deepClone(input.definition) : current.definition,
    updatedAt: timestamp,
  };
  await flowRepo.insert(next);
  return deepClone(next);
}

export async function publishFlow(id) {
  const current = await flowRepo.findById(id);
  if (!current) return null;
  const timestamp = nowIso();
  const next = {
    ...current,
    status: "published",
    version: Number(current.version || 0) + 1,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
  await flowRepo.insert(next);
  return deepClone(next);
}

// ── Flow Transitions (business logic, unchanged) ───────────────

function resolveFlowRunTransition(flow, run, eventTypeRaw, payload = {}) {
  const eventType = normalizeEventType(eventTypeRaw);
  const currentNode = getFlowDefinitionNode(flow, run.currentNodeId);
  if (!currentNode) {
    return { nextNodeId: null, reason: "NODE_NOT_FOUND", completed: true };
  }

  const runtime =
    currentNode.runtimeConfig && typeof currentNode.runtimeConfig === "object"
      ? currentNode.runtimeConfig
      : {};
  const edges = getFlowDefinitionEdgesFrom(flow, currentNode.id);
  const normalizedEdges = Array.isArray(edges) ? edges : [];

  if (String(runtime.kind || "").toLowerCase() === "end") {
    return { nextNodeId: null, reason: "END_NODE", completed: true };
  }

  if (!normalizedEdges.length) {
    return { nextNodeId: null, reason: "NO_OUTGOING_EDGE", completed: true };
  }

  const payloadNextNodeId = String(payload.nextNodeId || "").trim();
  if (payloadNextNodeId) {
    const direct = normalizedEdges.find((edge) => String(edge.t) === payloadNextNodeId);
    if (direct) {
      return { nextNodeId: String(direct.t), reason: "EXPLICIT_NEXT_NODE", completed: false };
    }
  }

  if (eventType === "timeout.reached") {
    const timeoutTarget = String(runtime.timeoutNextNodeId || "").trim();
    if (timeoutTarget) {
      const timeoutEdge = normalizedEdges.find((edge) => String(edge.t) === timeoutTarget);
      if (timeoutEdge) {
        return { nextNodeId: String(timeoutEdge.t), reason: "TIMEOUT_EDGE", completed: false };
      }
    }
  }

  const byEventKey = normalizedEdges.find((edge) => {
    const edgeEvent = normalizeEventType(edge?.k || "");
    return edgeEvent && edgeEvent === eventType;
  });
  if (byEventKey) {
    return { nextNodeId: String(byEventKey.t), reason: "EDGE_EVENT_MATCH", completed: false };
  }

  const routeLabel = String(payload.routeLabel || payload.label || "").trim();
  if (routeLabel) {
    const byLabel = findEdgeByLabel(normalizedEdges, routeLabel);
    if (byLabel) {
      return { nextNodeId: String(byLabel.t), reason: "ROUTE_LABEL", completed: false };
    }
  }

  const kind = String(runtime.kind || "").toLowerCase();
  if (kind === "condition") {
    if (eventType === "condition.true") {
      const edge = findConditionEdge(normalizedEdges, true);
      if (edge) return { nextNodeId: String(edge.t), reason: "CONDITION_TRUE", completed: false };
    }
    if (eventType === "condition.false") {
      const edge = findConditionEdge(normalizedEdges, false);
      if (edge) return { nextNodeId: String(edge.t), reason: "CONDITION_FALSE", completed: false };
    }
  }

  const waitEvent = normalizeEventType(runtime.waitEvent);
  if (waitEvent && eventType === waitEvent) {
    if (normalizedEdges.length === 1) {
      return { nextNodeId: String(normalizedEdges[0].t), reason: "WAIT_EVENT_MATCH", completed: false };
    }
  }

  const autoEvents = new Set([
    "manual.done", "message.sent", "message.failed",
    "inbound.text", "inbound.button", "inbound.list_reply",
    "v2.km_below_threshold", "v2.campaign_status_changed", "v2.pending_action_detected",
  ]);
  if (autoEvents.has(eventType) && normalizedEdges.length === 1) {
    return { nextNodeId: String(normalizedEdges[0].t), reason: "SINGLE_EDGE_AUTOROUTE", completed: false };
  }

  return { nextNodeId: null, reason: "NO_TRANSITION_RULE_MATCH", completed: false };
}

// ── Flow Runs ──────────────────────────────────────────────────

export async function listFlowRuns(filters = {}) {
  const normalizedFilters = {};
  const status = String(filters.status || "").trim().toLowerCase();
  const flowId = String(filters.flowId || "").trim();
  const flowKey = normalizeFlowKey(filters.flowKey || "");
  const contactId = String(filters.contactId || "").trim();
  if (status) normalizedFilters.status = status;
  if (flowId) normalizedFilters.flowId = flowId;
  if (flowKey) normalizedFilters.flowKey = flowKey;
  if (contactId) normalizedFilters.contactId = contactId;
  return flowRunRepo.findAll(normalizedFilters);
}

export async function getFlowRunById(id) {
  return flowRunRepo.findById(id);
}

export async function findLatestActiveFlowRunByContact(contactId, flowKey = "") {
  const normalizedContactId = String(contactId || "").trim();
  if (!normalizedContactId) return null;
  const normalizedFlowKey = normalizeFlowKey(flowKey || "");
  return flowRunRepo.findLatestActiveByContact(normalizedContactId, normalizedFlowKey);
}

export async function createFlowRun(input) {
  const flow = await flowRepo.findById(input.flowId);
  if (!flow) return null;
  const nodes = flow?.definition?.nodes;
  if (!Array.isArray(nodes) || !nodes.length) return null;

  const requestedStartNodeId = String(input.startNodeId || "").trim();
  const startNode = requestedStartNodeId
    ? nodes.find((node) => String(node.id) === requestedStartNodeId)
    : nodes[0];
  if (!startNode) return null;

  const timestamp = nowIso();
  const id = randomUUID();
  const run = {
    id,
    flowId: String(flow.id),
    flowKey: String(flow.key || ""),
    flowVersion: Number(flow.version || 1),
    flowName: String(flow.name || ""),
    contactId: String(input.contactId || ""),
    status: "active",
    currentNodeId: String(startNode.id),
    startedAt: timestamp,
    finishedAt: null,
    enteredAt: timestamp,
    dueAt: computeDueAt(startNode),
    ownerUserId: String(input.ownerUserId || ""),
    context: input.context && typeof input.context === "object" ? deepClone(input.context) : {},
    nodeHistory: [{ nodeId: String(startNode.id), enteredAt: timestamp, enteredBy: "run.start" }],
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await flowRunRepo.insert(run);
  return deepClone(run);
}

export async function appendFlowRunEvent(runId, eventInput) {
  const run = await flowRunRepo.findById(runId);
  if (!run) return null;
  const flow = await flowRepo.findById(run.flowId);
  if (!flow) return null;

  const timestamp = nowIso();
  const eventType = normalizeEventType(eventInput.type || "");
  const payload =
    eventInput.payload && typeof eventInput.payload === "object"
      ? deepClone(eventInput.payload)
      : {};
  const event = {
    id: randomUUID(),
    type: eventType || "unknown",
    source: String(eventInput.source || "api"),
    payload,
    createdAt: timestamp,
  };

  const events = Array.isArray(run.events) ? [...run.events, event] : [event];
  if (events.length > 500) {
    events.splice(0, events.length - 500);
  }

  let transition = {
    moved: false,
    completed: false,
    reason: "RUN_FINISHED",
    fromNodeId: run.currentNodeId,
    toNodeId: null,
  };

  const updatedRun = { ...run, events, updatedAt: timestamp };

  if (run.status === "active") {
    const resolved = resolveFlowRunTransition(flow, run, event.type, payload);
    transition = {
      moved: false,
      completed: !!resolved.completed,
      reason: resolved.reason,
      fromNodeId: run.currentNodeId,
      toNodeId: null,
    };

    if (resolved.nextNodeId) {
      const nextNode = getFlowDefinitionNode(flow, resolved.nextNodeId);
      if (nextNode) {
        updatedRun.currentNodeId = String(nextNode.id);
        updatedRun.enteredAt = timestamp;
        updatedRun.dueAt = computeDueAt(nextNode);
        const nodeHistory = Array.isArray(updatedRun.nodeHistory) ? [...updatedRun.nodeHistory] : [];
        nodeHistory.push({
          nodeId: String(nextNode.id),
          enteredAt: timestamp,
          enteredBy: event.type,
        });
        updatedRun.nodeHistory = nodeHistory;
        transition.moved = true;
        transition.toNodeId = String(nextNode.id);

        const nextKind = String(nextNode.runtimeConfig?.kind || "").toLowerCase();
        const nextEdges = getFlowDefinitionEdgesFrom(flow, nextNode.id);
        if (nextKind === "end" || !nextEdges.length) {
          transition.completed = true;
          transition.reason = nextKind === "end" ? "ENTERED_END_NODE" : "NO_OUTGOING_EDGE";
        }
      }
    }
  }

  if (transition.completed) {
    updatedRun.status = "finished";
    updatedRun.finishedAt = timestamp;
    updatedRun.dueAt = null;
  }

  await flowRunRepo.replaceDoc(updatedRun);
  return { run: deepClone(updatedRun), event: deepClone(event), transition };
}

export async function summarizeFlowRunsByNode(flowId = "") {
  const normalizedFlowId = String(flowId || "").trim();
  const filters = normalizedFlowId ? { flowId: normalizedFlowId } : {};
  const runs = await flowRunRepo.findAll(filters);

  const counters = new Map();
  runs.forEach((run) => {
    const key = String(run.currentNodeId || "");
    if (!key) return;
    if (!counters.has(key)) {
      counters.set(key, { nodeId: key, total: 0, active: 0, finished: 0 });
    }
    const bucket = counters.get(key);
    bucket.total += 1;
    if (String(run.status) === "finished") bucket.finished += 1;
    else bucket.active += 1;
  });

  return [...counters.values()].sort((a, b) => b.total - a.total);
}

// ── Inbox ──────────────────────────────────────────────────────

export async function ensureInboxConversation(input = {}) {
  const timestamp = nowIso();
  const normalizedPhone = String(input.phoneE164 || "").trim();
  let normalizedContactId = String(input.contactId || "").trim();

  if (!normalizedContactId && normalizedPhone) {
    const contact = await bridge.getContactByPhone(normalizedPhone);
    normalizedContactId = contact?.id || "";
  }

  const contact = normalizedContactId ? await bridge.getContactById(normalizedContactId) : null;
  const displayName = String(
    input.displayName || contact?.name || contact?.firstName || "",
  ).trim();

  // Find existing conversation
  const convId = String(input.conversationId || "").trim();
  let matched = null;
  if (convId) matched = await inboxRepo.findConversationById(convId);
  if (!matched && normalizedContactId) matched = await inboxRepo.findConversationByContactId(normalizedContactId);
  if (!matched && normalizedPhone) matched = await inboxRepo.findConversationByPhone(normalizedPhone);

  if (matched) {
    const next = {
      ...matched,
      contactId: normalizedContactId || matched.contactId || "",
      phoneE164: normalizedPhone || matched.phoneE164 || "",
      displayName: displayName || matched.displayName || "",
      updatedAt: timestamp,
    };
    await inboxRepo.upsertConversation(next);
    return deepClone(next);
  }

  const created = {
    id: convId || randomUUID(),
    contactId: normalizedContactId || "",
    phoneE164: normalizedPhone || "",
    displayName: displayName || "",
    status: "open",
    flowPaused: false,
    unreadCount: 0,
    lastMessageAt: null,
    lastMessagePreview: "",
    operatorId: String(input.operatorId || ""),
    operatorName: String(input.operatorName || ""),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await inboxRepo.upsertConversation(created);
  return deepClone(created);
}

export async function getInboxConversationById(id) {
  return inboxRepo.findConversationById(String(id || "").trim());
}

export async function getInboxConversationByContactId(contactId) {
  const normalizedContactId = String(contactId || "").trim();
  if (!normalizedContactId) return null;
  return inboxRepo.findConversationByContactId(normalizedContactId);
}

export async function listInboxConversations(filters = {}) {
  const search = String(filters.search || "").trim().toLowerCase();
  const status = String(filters.status || "").trim().toLowerCase();
  const operatorId = String(filters.operatorId || "").trim();
  const limitRaw = Number(filters.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.round(limitRaw))) : 200;

  return inboxRepo.findAllConversations({ search, status, operatorId, limit });
}

export async function listInboxMessages(conversationId, filters = {}) {
  const normalizedConversationId = String(conversationId || "").trim();
  if (!normalizedConversationId) return { items: [], hasMore: false, nextBefore: "" };
  const limitRaw = Number(filters.limit || 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.round(limitRaw))) : 100;
  const before = String(filters.before || "").trim();
  return inboxRepo.findMessagesByConversation(normalizedConversationId, { limit, before });
}

export async function addInboxMessage(input = {}) {
  const conversation = await ensureInboxConversation({
    conversationId: input.conversationId,
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    displayName: input.displayName,
    operatorId: input.operatorId,
    operatorName: input.operatorName,
  });
  if (!conversation) return null;

  const messageId = String(input.id || randomUUID());
  const existing = await inboxRepo.findMessageById(messageId);
  if (existing) return deepClone(existing);

  const timestamp = safeIso(input.createdAt, nowIso());
  const direction = normalizeInboxDirection(input.direction);
  const kind = normalizeInboxKind(input.kind || input.messageType || "unknown");
  const text = String(input.text || "").trim();
  const templateName = String(input.templateName || "").trim();
  const templateLanguage = String(input.templateLanguage || "").trim();
  const metaMessageId = String(input.metaMessageId || "").trim();
  const deliveryStatus = String(input.deliveryStatus || "").trim();
  const msgPayload =
    input.payload && typeof input.payload === "object" ? deepClone(input.payload) : {};
  const statusHistory = [];
  if (deliveryStatus) {
    statusHistory.push({
      status: deliveryStatus,
      at: timestamp,
      payload: msgPayload.statusPayload || null,
    });
  }

  const message = {
    id: messageId,
    conversationId: conversation.id,
    contactId: String(conversation.contactId || ""),
    phoneE164: String(conversation.phoneE164 || ""),
    direction,
    kind,
    text,
    templateName,
    templateLanguage,
    metaMessageId,
    contextMetaMessageId: String(input.contextMetaMessageId || "").trim(),
    deliveryStatus: deliveryStatus || "",
    statusHistory,
    source: String(input.source || "system"),
    operatorId: String(input.operatorId || ""),
    operatorName: String(input.operatorName || ""),
    payload: msgPayload,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await inboxRepo.insertMessage(message);
  const contactSnapshot = normalizeContactSnapshot(input.contactSnapshot) || null;

  // Update conversation
  const convUpdates = {
    contactId: message.contactId || conversation.contactId || "",
    phoneE164: message.phoneE164 || conversation.phoneE164 || "",
    displayName: String(input.displayName || conversation.displayName || ""),
    updatedAt: nowIso(),
  };

  // Operator ownership: assign on first outbound message and never overwrite.
  if (
    direction === "outbound" &&
    !conversation.operatorId &&
    String(input.operatorId || "").trim()
  ) {
    convUpdates.operatorId = String(input.operatorId);
    convUpdates.operatorName = String(input.operatorName || "");
  }

  if (
    !conversation.lastMessageAt ||
    String(timestamp) >= String(conversation.lastMessageAt)
  ) {
    convUpdates.lastMessageAt = timestamp;
    convUpdates.lastMessagePreview = buildInboxPreview(message);
  }
  if (direction === "inbound") {
    convUpdates.unreadCount = Number(conversation.unreadCount || 0) + 1;
  }
  if (contactSnapshot) {
    convUpdates.contact = contactSnapshot;
    if (!convUpdates.displayName && contactSnapshot.name) {
      convUpdates.displayName = contactSnapshot.name;
    }
  }
  await inboxRepo.updateConversationFields(conversation.id, convUpdates);

  // SSE: broadcast to connected OdChat clients
  try {
    broadcast("message.new", { message: deepClone(message), conversationId: conversation.id });
    broadcast("conversation.updated", { conversation: deepClone({ ...conversation, ...convUpdates }) });
  } catch (_) { /* best-effort */ }

  return deepClone(message);
}

export async function updateInboxMessageStatusByMetaId(metaMessageId, status, payload = null) {
  const normalizedMetaId = String(metaMessageId || "").trim();
  if (!normalizedMetaId) return null;

  const message = await inboxRepo.findMessageByMetaId(normalizedMetaId);
  if (!message) return null;

  const statusValue = String(status || "").trim().toLowerCase();
  if (!statusValue) return null;

  const timestamp = nowIso();
  const historyEntry = {
    status: statusValue,
    at: timestamp,
    payload: payload && typeof payload === "object" ? deepClone(payload) : null,
  };

  const nextMessage = {
    ...message,
    deliveryStatus: statusValue,
    updatedAt: timestamp,
    statusHistory: [...(message.statusHistory || []), historyEntry],
  };

  await inboxRepo.updateMessageFields(message.id, {
    deliveryStatus: statusValue,
    updatedAt: timestamp,
    statusHistory: nextMessage.statusHistory,
  });

  const conversation = await inboxRepo.findConversationById(nextMessage.conversationId);
  if (conversation) {
    await inboxRepo.updateConversationFields(conversation.id, { updatedAt: timestamp });
  }

  const result = {
    message: deepClone(nextMessage),
    conversation: conversation
      ? deepClone({ ...conversation, updatedAt: timestamp })
      : null,
  };

  // SSE: broadcast delivery status update
  try {
    broadcast("message.status", { messageId: message.id, conversationId: nextMessage.conversationId, status: statusValue });
  } catch (_) { /* best-effort */ }

  return result;
}

export async function markInboxConversationRead(conversationId) {
  const current = await inboxRepo.findConversationById(String(conversationId || "").trim());
  if (!current) return null;
  const fields = { unreadCount: 0, updatedAt: nowIso() };
  await inboxRepo.updateConversationFields(current.id, fields);
  return deepClone({ ...current, ...fields });
}

export async function setInboxConversationFlowPaused(conversationId, paused) {
  const current = await inboxRepo.findConversationById(String(conversationId || "").trim());
  if (!current) return null;
  const fields = { flowPaused: paused === true, updatedAt: nowIso() };
  await inboxRepo.updateConversationFields(current.id, fields);
  return deepClone({ ...current, ...fields });
}

// ── Webhook Events ─────────────────────────────────────────────

export async function addWebhookEvent(payload) {
  const event = { id: randomUUID(), payload, receivedAt: nowIso() };
  await miscRepo.insertWebhookEvent(event);
  return event;
}

export async function listWebhookEvents(limit = 50) {
  return miscRepo.findWebhookEvents(Math.max(1, limit));
}

// ── Idempotency ────────────────────────────────────────────────

export async function getIdempotentResult(key) {
  if (!key) return null;
  return miscRepo.getIdempotent(key);
}

export async function saveIdempotentResult(key, value) {
  if (!key) return;
  await miscRepo.setIdempotent(key, value);
}

// ── Onboarding ─────────────────────────────────────────────────

export async function createOnboardingSession(payload) {
  const stateId = randomUUID();
  const session = {
    state: stateId,
    createdAt: nowIso(),
    completedAt: null,
    status: "pending",
    payload,
    callback: null,
  };
  await miscRepo.insertOnboarding(session);
  return session;
}

export async function completeOnboardingSession(stateId, callbackData) {
  const current = await miscRepo.findOnboarding(stateId);
  if (!current) return null;
  const fields = { status: "completed", completedAt: nowIso(), callback: callbackData };
  await miscRepo.updateOnboarding(stateId, fields);
  return { ...current, ...fields };
}

export async function getOnboardingSession(stateId) {
  return miscRepo.findOnboarding(stateId);
}

// ── Startup indexes ────────────────────────────────────────────

export async function ensureStoreIndexes() {
  await Promise.all([
    bridge.ensureIndexes(),
    templateRepo.ensureIndexes(),
    waCampaignRepo.ensureIndexes(),
    campaignRecipientsRepo.ensureCampaignRecipientIndexes(),
    dispatchRunsRepo.ensureDispatchRunIndexes(),
    flowRepo.ensureIndexes(),
    flowRunRepo.ensureIndexes(),
    inboxRepo.ensureIndexes(),
    miscRepo.ensureIndexes(),
  ]);
}
