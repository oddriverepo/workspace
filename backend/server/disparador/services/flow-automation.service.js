import { randomUUID } from "crypto";
import { env } from "../config.js";
import { sendTemplateMessage } from "./meta-client.js";
import {
  getFlowById,
  getFlowRunById,
  appendFlowRunEvent,
  getContactById,
  getListById,
  getListByName,
  getTemplateById,
  listTemplates,
  addInboxMessage,
  getInboxConversationByContactId,
} from "../store/memory-store.js";
import * as queueRepo from "./mongo/automation-queue.repo.js";
import { buildTemplateSnapshot, renderTemplateMessageText } from "../utils/template-render.js";

// Throttle delay between Meta API sends (ms).
const SEND_THROTTLE_MS = Number(process.env.META_SEND_THROTTLE_MS) || 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const queueState = {
  running: false,
  items: [],
  pendingKeys: new Set(),
  processingKeys: new Set(),
  processedCount: 0,
  failedCount: 0,
  lastError: "",
  lastJobAt: null,
};

function nowIso() {
  return new Date().toISOString();
}

function toLower(value) {
  return String(value || "").trim().toLowerCase();
}

function isMetaDispatchConfigured() {
  return Boolean(env.metaSystemUserToken && env.metaPhoneNumberId);
}

async function resolveTemplate(templateRef) {
  const raw = String(templateRef || "").trim();
  if (!raw) return null;
  const byId = await getTemplateById(raw);
  if (byId) return byId;
  const normalized = toLower(raw);
  const all = await listTemplates();
  return all.find((item) => toLower(item.name) === normalized || toLower(item.metaTemplateId) === normalized) || null;
}

async function resolveTargetList(listRef) {
  const raw = String(listRef || "").trim();
  if (!raw) return null;
  return (await getListById(raw)) || (await getListByName(raw)) || null;
}

function filterEligibleContacts(contacts) {
  const valid = [];
  const blocked = [];
  (contacts || []).forEach((item) => {
    if (!item || !item.id) return;
    if (item.optIn === true && !item.optOutAt) {
      valid.push(item);
    } else {
      blocked.push(item);
    }
  });
  return { valid, blocked };
}

async function resolveDispatchTargets(run, runtime) {
  const mode = toLower(runtime.targetMode || "contact");
  if (mode === "list") {
    const list = await resolveTargetList(runtime.listId);
    if (!list) {
      return { contacts: [], target: { mode: "list", listId: String(runtime.listId || ""), listName: "", total: 0 } };
    }
    const contactPromises = [...new Set(list.contactIds || [])].map((contactId) => getContactById(contactId));
    const contacts = (await Promise.all(contactPromises)).filter(Boolean);
    return { contacts, target: { mode: "list", listId: list.id, listName: list.name || "", total: contacts.length } };
  }
  const contact = await getContactById(run.contactId);
  return { contacts: contact ? [contact] : [], target: { mode: "contact", contactId: run.contactId, total: contact ? 1 : 0 } };
}

function extractMetaMessageId(metaResponse = {}) {
  const list = Array.isArray(metaResponse?.messages) ? metaResponse.messages : [];
  const first = list[0] || {};
  return String(first.id || "").trim();
}

async function dispatchForNode(run, node) {
  const runtime = node?.runtimeConfig && typeof node.runtimeConfig === "object" ? node.runtimeConfig : {};
  const template = await resolveTemplate(runtime.templateId);

  if (!template) {
    return { eventType: "message.failed", payload: { reason: "TEMPLATE_NOT_FOUND", templateRef: String(runtime.templateId || ""), nodeId: String(node?.id || "") } };
  }

  const target = await resolveDispatchTargets(run, runtime);
  const { valid: eligibleContacts, blocked: blockedContacts } = filterEligibleContacts(target.contacts);

  if (!eligibleContacts.length) {
    return { eventType: "message.failed", payload: { reason: "NO_ELIGIBLE_CONTACTS", nodeId: String(node?.id || ""), target, blockedCount: blockedContacts.length } };
  }

  const sendReal = isMetaDispatchConfigured();
  let sentCount = 0;
  let failedCount = blockedContacts.length;
  const failures = blockedContacts.map((item) => ({ contactId: item.id, phoneE164: item.phoneE164 || "", reason: "CONTACT_BLOCKED" }));

  if (toLower(template.status) !== "approved") {
    return { eventType: "message.failed", payload: { reason: "TEMPLATE_NOT_APPROVED", templateId: template.id, templateName: template.name, templateStatus: template.status, nodeId: String(node?.id || "") } };
  }

  for (const contact of eligibleContacts) {
    const parameters = [contact.firstName || contact.name || "cliente"];
    const renderedText = renderTemplateMessageText(template, parameters);
    const templateSnapshot = buildTemplateSnapshot(template);
    if (!sendReal) {
      await addInboxMessage({
        contactId: contact.id, phoneE164: contact.phoneE164, displayName: contact.name || contact.firstName || "",
        direction: "outbound", kind: "template", templateName: template.name, templateLanguage: template.language || "pt_BR",
        text: renderedText, deliveryStatus: "simulated", source: "flow.dispatch",
        payload: {
          flowRunId: run.id,
          flowId: run.flowId,
          nodeId: String(node?.id || ""),
          dispatchMode: "simulado",
          parameters,
          renderedText,
          templateSnapshot,
        },
      });
      sentCount += 1;
      continue;
    }
    try {
      const response = await sendTemplateMessage({
        to: contact.phoneE164, templateName: template.name, languageCode: template.language || "pt_BR",
        parameters,
        bodyTemplateText: template.bodyText || "",
        headerType: template.headerType || "none",
        headerImageUrl: template.headerMediaUrl || "",
      });
      await addInboxMessage({
        contactId: contact.id, phoneE164: contact.phoneE164, displayName: contact.name || contact.firstName || "",
        direction: "outbound", kind: "template", templateName: template.name, templateLanguage: template.language || "pt_BR",
        text: renderedText, deliveryStatus: "sent", metaMessageId: extractMetaMessageId(response), source: "flow.dispatch",
        payload: {
          flowRunId: run.id,
          flowId: run.flowId,
          nodeId: String(node?.id || ""),
          dispatchMode: "meta_cloud_api",
          parameters,
          renderedText,
          templateSnapshot,
        },
      });
      sentCount += 1;
    } catch (err) {
      failedCount += 1;
      await addInboxMessage({
        contactId: contact.id, phoneE164: contact.phoneE164, displayName: contact.name || contact.firstName || "",
        direction: "outbound", kind: "template", templateName: template.name, templateLanguage: template.language || "pt_BR",
        text: renderedText, deliveryStatus: "failed", source: "flow.dispatch",
        payload: {
          flowRunId: run.id,
          flowId: run.flowId,
          nodeId: String(node?.id || ""),
          dispatchMode: "meta_cloud_api",
          parameters,
          renderedText,
          templateSnapshot,
          error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio." },
        },
      });
      failures.push({ contactId: contact.id, phoneE164: contact.phoneE164 || "", reason: err.code || "SEND_ERROR", message: err.message || "Falha no envio." });
    }
    // Throttle between sends to respect Meta rate limits
    if (SEND_THROTTLE_MS > 0) await sleep(SEND_THROTTLE_MS);
  }

  const eventType = sentCount > 0 ? "message.sent" : "message.failed";
  return {
    eventType,
    payload: {
      nodeId: String(node?.id || ""), target,
      template: { id: template.id, name: template.name, status: template.status },
      dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
      sentCount, failedCount, failures,
    },
  };
}

function queueKeyForRun(run) {
  return `${run.id}:${run.currentNodeId}`;
}

function scheduleProcessor() {
  if (queueState.running) return;
  queueState.running = true;
  setImmediate(async () => {
    while (queueState.items.length) {
      const job = queueState.items.shift();
      queueState.pendingKeys.delete(job.key);
      queueState.processingKeys.add(job.key);
      try {
        await processAutomationJob(job);
        queueState.processedCount += 1;
      } catch (err) {
        queueState.failedCount += 1;
        queueState.lastError = `${err?.message || "Falha ao processar automacao."}`;
      } finally {
        queueState.processingKeys.delete(job.key);
        queueState.lastJobAt = nowIso();
        // Remove from persistent store after processing (success or failure)
        try { await queueRepo.removeJobByKey(job.key); } catch (_) { /* best-effort */ }
      }
    }
    queueState.running = false;
  });
}

async function processAutomationJob(job) {
  const run = await getFlowRunById(job.runId);
  if (!run || String(run.status) !== "active") return;

  const inboxConversation = await getInboxConversationByContactId(run.contactId);
  if (inboxConversation && inboxConversation.flowPaused === true) return;

  const currentKey = queueKeyForRun(run);
  if (job.key !== currentKey) return;

  const flow = await getFlowById(run.flowId);
  if (!flow || !Array.isArray(flow.definition?.nodes)) return;

  const node = flow.definition.nodes.find((item) => String(item.id) === String(run.currentNodeId));
  if (!node) return;

  const runtime = node.runtimeConfig && typeof node.runtimeConfig === "object" ? node.runtimeConfig : {};
  const kind = toLower(runtime.kind || "manual");
  if (kind !== "dispatch") return;
  if (runtime.autoStart !== true && job.force !== true) return;

  const dispatchResult = await dispatchForNode(run, node);
  const eventType = dispatchResult?.eventType || "message.failed";
  const payload = dispatchResult?.payload && typeof dispatchResult.payload === "object" ? dispatchResult.payload : {};

  const outcome = await appendFlowRunEvent(run.id, {
    type: eventType,
    source: "flow.automation.dispatch",
    payload,
  });
  if (!outcome) return;

  if (outcome.transition?.moved && String(outcome.run?.status) === "active") {
    await enqueueFlowAutomation({
      runId: outcome.run.id,
      reason: "AUTOMATION_CHAIN",
      source: "flow.automation",
      force: false,
    });
  }
}

export async function enqueueFlowAutomation(input = {}) {
  const runId = String(input.runId || "").trim();
  if (!runId) {
    return { ok: false, queued: false, reason: "MISSING_RUN_ID" };
  }

  const run = await getFlowRunById(runId);
  if (!run) {
    return { ok: false, queued: false, reason: "RUN_NOT_FOUND" };
  }
  if (String(run.status) !== "active") {
    return { ok: false, queued: false, reason: "RUN_NOT_ACTIVE" };
  }

  const key = queueKeyForRun(run);
  if (queueState.pendingKeys.has(key) || queueState.processingKeys.has(key)) {
    return { ok: true, queued: false, reason: "ALREADY_QUEUED", key };
  }

  const job = {
    id: randomUUID(),
    runId: run.id,
    key,
    reason: String(input.reason || "UNSPECIFIED"),
    source: String(input.source || "system"),
    force: input.force === true,
    createdAt: nowIso(),
  };
  queueState.items.push(job);
  queueState.pendingKeys.add(key);

  // Persist to MongoDB so the job survives restarts
  try { await queueRepo.insertJob(job); } catch (_) { /* best-effort — in-memory is primary */ }

  scheduleProcessor();
  return { ok: true, queued: true, jobId: job.id, key: job.key };
}

export function getFlowAutomationQueueStatus() {
  return {
    running: queueState.running,
    pending: queueState.items.length,
    processedCount: queueState.processedCount,
    failedCount: queueState.failedCount,
    lastError: queueState.lastError,
    lastJobAt: queueState.lastJobAt,
  };
}

/**
 * Restore pending automation jobs from MongoDB after a server restart.
 * Should be called once during application startup.
 */
export async function restoreAutomationQueue() {
  try {
    await queueRepo.ensureAutomationQueueIndexes();
    const pendingJobs = await queueRepo.loadPendingJobs();
    if (!pendingJobs.length) return { restored: 0 };

    let restored = 0;
    for (const job of pendingJobs) {
      if (!job.key || queueState.pendingKeys.has(job.key) || queueState.processingKeys.has(job.key)) continue;
      queueState.items.push(job);
      queueState.pendingKeys.add(job.key);
      restored += 1;
    }
    if (restored > 0) {
      console.log(`[FLOW AUTOMATION] Restaurados ${restored} jobs pendentes do MongoDB.`);
      scheduleProcessor();
    }
    return { restored };
  } catch (err) {
    console.warn("[FLOW AUTOMATION] Falha ao restaurar fila:", err.message);
    return { restored: 0, error: err.message };
  }
}
