import { randomUUID } from "crypto";

import { getDb } from "../../services/mongo.js";
import { env } from "../config.js";
import {
  addInboxMessage,
  getContactById,
  getInboxConversationById,
  listTemplates,
  setInboxConversationFlowPaused,
  upsertContact,
} from "../store/memory-store.js";
import { buildTemplateSnapshot, renderTemplateMessageText } from "../utils/template-render.js";
import { sendImageMessage, sendInteractiveButtonsMessage, sendTemplateMessage, sendTextMessage } from "./meta-client.js";
import { findLatestOutboundTemplateMessage, findOutboundTemplateByMetaMessageId, findOutboundFlowMessageByMetaMessageId } from "./mongo/inbox.repo.js";
import { findFlowByTemplateId } from "./mongo/template-flows.repo.js";
import {
  findHandledRunBySourceMessage,
  findRunByInboundMessageId,
  findRunByInboundMetaMessageId,
  insertRun,
  replaceRun,
} from "./mongo/template-flow-runs.repo.js";
import { recordReactionByContact as recordCampaignRecipientReaction } from "./mongo/campaign-recipients.repo.js";
import {
  applyDriverGlobalOptOut,
  buildForwardedOutreachPayload,
  syncDriverOutreachFlowRun,
  syncDriverOutreachOutboundMessage,
} from "../../services/driver-outreach.js";

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqStrings(items) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function toContactSnapshot(contact) {
  if (!contact || typeof contact !== "object") return null;
  return {
    id: String(contact.id || "").trim(),
    name: String(contact.name || contact.firstName || "").trim(),
    phoneE164: String(contact.phoneE164 || "").trim(),
    avatar: String(contact.avatar || "").trim(),
    optIn: contact.optIn === true,
  };
}

function extractMetaMessageId(metaResponse = {}) {
  const messages = Array.isArray(metaResponse?.messages) ? metaResponse.messages : [];
  const first = messages[0] || {};
  return String(first.id || "").trim();
}

function buildFlowMessagePayload(basePayload, sourceTemplateMessage) {
  const outreach = buildForwardedOutreachPayload(sourceTemplateMessage);
  return outreach ? { ...basePayload, outreach } : basePayload;
}

function isMetaDispatchConfigured() {
  return Boolean(env.metaPhoneNumberId);
}

async function resolveTemplate(templateRef) {
  const raw = String(templateRef || "").trim();
  if (!raw) return null;
  const all = await listTemplates();
  const normalized = normalizeText(raw);
  return all.find((item) => {
    return String(item.id || "").trim() === raw ||
      normalizeText(item.name || "") === normalized ||
      normalizeText(item.metaTemplateId || "") === normalized;
  }) || null;
}

function getPublishedTemplateFlow(templateId) {
  return findFlowByTemplateId(String(templateId || "").trim());
}

function collectInboundTokens(message = {}) {
  const raw = message?.payload?.raw && typeof message.payload.raw === "object"
    ? message.payload.raw
    : {};

  const rawCandidates = [
    raw?.button?.payload,
    raw?.button?.text,
    raw?.interactive?.button_reply?.id,
    raw?.interactive?.button_reply?.title,
    raw?.interactive?.list_reply?.id,
    raw?.interactive?.list_reply?.title,
    raw?.text?.body,
    message?.text,
  ];

  const exact = uniqStrings(rawCandidates);
  const normalized = uniqStrings(exact.map(normalizeText));
  return { exact, normalized };
}

function matchesFreeText(branch, tokens, messageText) {
  const branchValue = String(branch?.match?.value || "").trim();
  if (!branchValue || branchValue === "*") return Boolean(String(messageText || "").trim() || tokens.exact.length);
  const normalizedValues = uniqStrings(
    branchValue
      .split(/[\n,;|]+/g)
      .map((item) => normalizeText(item))
      .filter(Boolean),
  );
  return normalizedValues.some((value) => (
    tokens.normalized.some((item) => item === value || item.includes(value))
  ));
}

function matchesButtonOrList(branch, tokens) {
  const values = uniqStrings([
    branch?.match?.buttonId,
    branch?.match?.value,
    branch?.label,
  ]);
  if (!values.length) return false;
  const normalizedValues = values.map(normalizeText);
  return normalizedValues.some((value) => tokens.normalized.includes(value));
}

function collectAllBranches(branches) {
  const all = [];
  for (const branch of branches) {
    all.push(branch);
    if (Array.isArray(branch.children) && branch.children.length) {
      all.push(...collectAllBranches(branch.children));
    }
  }
  return all;
}

function findMatchingBranch(snapshot, inboundMessage) {
  const branches = Array.isArray(snapshot?.branches) ? snapshot.branches : [];
  if (!branches.length) return null;

  const allBranches = collectAllBranches(branches);
  const tokens = collectInboundTokens(inboundMessage);
  const messageText = String(inboundMessage?.text || "").trim();
  const fallback = allBranches.find((branch) => String(branch?.match?.type || "").toLowerCase() === "fallback") || null;

  for (const branch of allBranches) {
    const type = String(branch?.match?.type || "").toLowerCase();
    if (type === "fallback") continue;
    if ((type === "button" || type === "list") && matchesButtonOrList(branch, tokens)) {
      return branch;
    }
    if (type === "free_text" && matchesFreeText(branch, tokens, messageText)) {
      return branch;
    }
  }

  return fallback;
}

async function sendFlowText({ contact, conversation, node, runId, flow, conversationLabel, sourceTemplateMessage }) {
  const text = String(node?.config?.text || "").trim();
  if (!text) {
    return { ok: false, reason: "EMPTY_TEXT" };
  }

  const sendReal = isMetaDispatchConfigured();
  let metaResponse = null;
  let deliveryStatus = sendReal ? "sent" : "simulated";

  if (sendReal) {
    try {
      metaResponse = await sendTextMessage({ to: contact.phoneE164, text });
    } catch (err) {
      console.error("[TEMPLATE_FLOW_RT] sendTextMessage failed:", {
        phone: contact.phoneE164,
        code: err?.code,
        message: err?.message,
      });
      deliveryStatus = "failed";
    }
  }

  const message = await addInboxMessage({
    contactId: contact.id,
    contactSnapshot: toContactSnapshot(contact),
    conversationId: conversation.id,
    phoneE164: contact.phoneE164,
    displayName: conversationLabel,
    direction: "outbound",
    kind: "text",
    text,
    deliveryStatus,
    metaMessageId: sendReal && metaResponse ? extractMetaMessageId(metaResponse) : "",
    source: "od-flow-studio",
    payload: buildFlowMessagePayload({
      odFlowRunId: runId,
      odFlowId: flow.id,
      nodeId: String(node.id || ""),
      dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
    }, sourceTemplateMessage),
  });
  await syncDriverOutreachOutboundMessage({ message });

  return {
    ok: deliveryStatus !== "failed",
    dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
    messageId: message.id,
    metaMessageId: message.metaMessageId || "",
    ...(deliveryStatus === "failed" ? { reason: "TEXT_SEND_FAILED" } : {}),
  };
}

async function sendFlowImage({ contact, conversation, node, runId, flow, conversationLabel, sourceTemplateMessage }) {
  let imageUrl = String(node?.config?.imageUrl || "").trim();
  const caption = String(node?.config?.caption || "").trim();
  if (!imageUrl) {
    return { ok: false, reason: "EMPTY_IMAGE_URL" };
  }

  // Resolve relative URLs so Meta can fetch them
  if (imageUrl.startsWith("/")) {
    imageUrl = env.appBaseUrl.replace(/\/+$/, "") + imageUrl;
  }

  const sendReal = isMetaDispatchConfigured();
  let metaResponse = null;
  let deliveryStatus = sendReal ? "sent" : "simulated";

  if (sendReal) {
    try {
      metaResponse = await sendImageMessage({ to: contact.phoneE164, imageUrl, caption });
    } catch (err) {
      console.error("[TEMPLATE_FLOW_RT] sendImageMessage failed:", {
        imageUrl,
        phone: contact.phoneE164,
        code: err?.code,
        message: err?.message,
      });
      deliveryStatus = "failed";
    }
  }

  const message = await addInboxMessage({
    contactId: contact.id,
    contactSnapshot: toContactSnapshot(contact),
    conversationId: conversation.id,
    phoneE164: contact.phoneE164,
    displayName: conversationLabel,
    direction: "outbound",
    kind: "image",
    text: caption || "Imagem enviada",
    deliveryStatus,
    metaMessageId: sendReal && metaResponse ? extractMetaMessageId(metaResponse) : "",
    source: "od-flow-studio",
    payload: buildFlowMessagePayload({
      odFlowRunId: runId,
      odFlowId: flow.id,
      nodeId: String(node.id || ""),
      dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
      media: {
        kind: "image",
        url: imageUrl,
        caption,
      },
    }, sourceTemplateMessage),
  });
  await syncDriverOutreachOutboundMessage({ message });

  return {
    ok: deliveryStatus !== "failed",
    dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
    messageId: message.id,
    metaMessageId: message.metaMessageId || "",
    ...(deliveryStatus === "failed" ? { reason: "IMAGE_SEND_FAILED" } : {}),
  };
}

async function sendFlowTemplate({ contact, conversation, node, runId, flow, conversationLabel, sourceTemplateMessage }) {
  const template = await resolveTemplate(node?.config?.templateId);
  if (!template) {
    return { ok: false, reason: "TEMPLATE_NOT_FOUND" };
  }

  const sendReal = isMetaDispatchConfigured();
  const parameters = [contact.firstName || contact.name || "cliente"];
  const renderedText = renderTemplateMessageText(template, parameters);
  const templateSnapshot = buildTemplateSnapshot(template);
  let metaResponse = null;

  if (sendReal && normalizeText(template.status) !== "approved") {
    return {
      ok: false,
      reason: "TEMPLATE_NOT_APPROVED",
      templateId: template.id,
      templateStatus: template.status,
    };
  }

  if (sendReal) {
    metaResponse = await sendTemplateMessage({
      to: contact.phoneE164,
      templateName: template.name,
      languageCode: template.language || "pt_BR",
      parameters,
      bodyTemplateText: template.bodyText || "",
      headerType: template.headerType || "none",
      headerImageUrl: template.headerMediaUrl || "",
    });
  }

  const message = await addInboxMessage({
    contactId: contact.id,
    contactSnapshot: toContactSnapshot(contact),
    conversationId: conversation.id,
    phoneE164: contact.phoneE164,
    displayName: conversationLabel,
    direction: "outbound",
    kind: "template",
    text: renderedText,
    templateName: template.name,
    templateLanguage: template.language || "pt_BR",
    deliveryStatus: sendReal ? "sent" : "simulated",
    metaMessageId: sendReal ? extractMetaMessageId(metaResponse) : "",
    source: "od-flow-studio",
    payload: buildFlowMessagePayload({
      odFlowRunId: runId,
      odFlowId: flow.id,
      nodeId: String(node.id || ""),
      templateId: template.id,
      dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
      parameters,
      renderedText,
      templateSnapshot,
    }, sourceTemplateMessage),
  });
  await syncDriverOutreachOutboundMessage({ message });

  return {
    ok: true,
    dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
    messageId: message.id,
    metaMessageId: message.metaMessageId || "",
    templateId: template.id,
  };
}

async function sendFlowButtons({ contact, conversation, node, runId, flow, conversationLabel, sourceTemplateMessage }) {
  const buttons = Array.isArray(node?.config?.buttons) ? node.config.buttons : [];
  if (!buttons.length) {
    return { ok: false, reason: "EMPTY_BUTTONS" };
  }

  // The body text for interactive buttons is required by Meta.
  // Use the previous send_text node's text or a generic prompt.
  const bodyText = String(node?.config?.bodyText || "Selecione uma opção:").trim();

  const sendReal = isMetaDispatchConfigured();
  let metaResponse = null;
  let deliveryStatus = sendReal ? "sent" : "simulated";

  if (sendReal) {
    try {
      metaResponse = await sendInteractiveButtonsMessage({
        to: contact.phoneE164,
        bodyText,
        buttons,
      });
    } catch (err) {
      console.error("[TEMPLATE_FLOW_RT] sendInteractiveButtonsMessage failed:", {
        phone: contact.phoneE164,
        code: err?.code,
        message: err?.message,
      });
      deliveryStatus = "failed";
    }
  }

  const btnLabels = buttons.map((b) => b.text || b.title || "").join(", ");
  const message = await addInboxMessage({
    contactId: contact.id,
    contactSnapshot: toContactSnapshot(contact),
    conversationId: conversation.id,
    phoneE164: contact.phoneE164,
    displayName: conversationLabel,
    direction: "outbound",
    kind: "interactive",
    text: `${bodyText} [${btnLabels}]`,
    deliveryStatus,
    metaMessageId: sendReal && metaResponse ? extractMetaMessageId(metaResponse) : "",
    source: "od-flow-studio",
    payload: buildFlowMessagePayload({
      odFlowRunId: runId,
      odFlowId: flow.id,
      templateId: String(flow.templateId || ""),
      nodeId: String(node.id || ""),
      dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
      interactiveType: "button",
      buttons: buttons.map((b) => ({ id: b.id || b.buttonId, text: b.text || b.title })),
    }, sourceTemplateMessage),
  });
  await syncDriverOutreachOutboundMessage({ message });

  return {
    ok: deliveryStatus !== "failed",
    dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
    messageId: message.id,
    metaMessageId: message.metaMessageId || "",
    ...(deliveryStatus === "failed" ? { reason: "BUTTONS_SEND_FAILED" } : {}),
  };
}

async function updateDriverFlowStatus(contact, node) {
  const contactId = String(contact?.id || "").trim();
  if (!contactId) return { ok: false, reason: "CONTACT_NOT_FOUND" };

  const statusValue = String(node?.config?.status || "").trim();
  if (!statusValue) return { ok: false, reason: "EMPTY_STATUS" };

  const db = await getDb();
  const updatePayload = {
    whatsapp_flow_status: statusValue,
    whatsapp_flow_status_updated_at: nowIso(),
    updated_at: new Date(),
  };

  const result = await db.collection("drivers").updateOne(
    { _id: contactId },
    { $set: updatePayload },
  );

  if (!result.matchedCount) {
    return { ok: false, reason: "DRIVER_NOT_FOUND" };
  }

  return { ok: true, status: statusValue };
}

async function addContactTag(contact, node) {
  const phoneE164 = String(contact?.phoneE164 || "").trim();
  const tag = String(node?.config?.tag || "").trim();
  if (!phoneE164 || !tag) {
    return { ok: false, reason: "INVALID_TAG_TARGET" };
  }

  const result = await upsertContact({
    phoneE164,
    name: contact.name || contact.firstName || "",
    tags: [tag],
    source: "od_flow_studio",
  });

  return { ok: true, tag, contactId: result?.contact?.id || contact.id };
}

async function handoffToHuman(conversation, node) {
  await setInboxConversationFlowPaused(conversation.id, true);
  return {
    ok: true,
    paused: true,
    note: String(node?.config?.note || "").trim(),
  };
}

async function executeNode(context, node) {
  if (!node || typeof node !== "object") {
    return { ok: false, reason: "INVALID_NODE" };
  }

  const type = String(node.type || "").trim();
  if (type === "send_text") return sendFlowText({ ...context, node });
  if (type === "send_image") return sendFlowImage({ ...context, node });
  if (type === "send_buttons") return sendFlowButtons({ ...context, node });
  if (type === "send_template") return sendFlowTemplate({ ...context, node });
  if (type === "update_driver_status") return updateDriverFlowStatus(context.contact, node);
  if (type === "add_tag") return addContactTag(context.contact, node);
  if (type === "handoff_human") return handoffToHuman(context.conversation, node);
  if (type === "end") return { ok: true, ended: true };
  return { ok: false, reason: "UNSUPPORTED_NODE_TYPE" };
}

async function applyInboundBranchPolicy(branch, context) {
  if (branch?.meta?.globalOptOut !== true) {
    return { applied: false };
  }

  const driverId = String(
    context?.sourceTemplateMessage?.payload?.outreach?.driverId ||
    context?.contact?.id ||
    "",
  ).trim();

  if (!driverId) {
    return { applied: false, reason: "DRIVER_ID_NOT_FOUND" };
  }

  const policy = await applyDriverGlobalOptOut(driverId, {
    templateName: String(
      context?.sourceTemplateMessage?.templateName ||
      context?.flow?.templateName ||
      context?.sourceTemplateMessage?.payload?.templateSnapshot?.name ||
      "",
    ).trim(),
    branchLabel: String(branch?.label || "").trim(),
    clickedAt: String(context?.message?.createdAt || nowIso()).trim(),
    updatedBy: "system:flow-branch-opt-out",
  });

  return {
    applied: true,
    driverId,
    policy,
  };
}

export async function handleTemplateFlowInboundMessage(input = {}) {
  const message = input?.message && typeof input.message === "object" ? input.message : null;
  if (!message || String(message.direction || "").toLowerCase() !== "inbound") {
    console.log("[TEMPLATE_FLOW_RT] Skip: not inbound", { direction: message?.direction });
    return { ok: true, handled: false, reason: "NOT_INBOUND_MESSAGE" };
  }

  console.log("[TEMPLATE_FLOW_RT] Processing inbound message", {
    messageId: message.id,
    metaMessageId: message.metaMessageId,
    conversationId: message.conversationId,
    contactId: message.contactId || input.contactId,
    text: String(message.text || "").slice(0, 80),
    kind: message.kind,
  });

  const existingRunByMetaId = await findRunByInboundMetaMessageId(message.metaMessageId);
  if (existingRunByMetaId) {
    console.log("[TEMPLATE_FLOW_RT] Skip: already processed by metaId", { runId: existingRunByMetaId.id });
    return { ok: true, handled: false, reason: "INBOUND_ALREADY_PROCESSED", runId: existingRunByMetaId.id };
  }

  const existingRunByMessageId = await findRunByInboundMessageId(message.id);
  if (existingRunByMessageId) {
    console.log("[TEMPLATE_FLOW_RT] Skip: already processed by messageId", { runId: existingRunByMessageId.id });
    return { ok: true, handled: false, reason: "MESSAGE_ALREADY_PROCESSED", runId: existingRunByMessageId.id };
  }

  const conversation = await getInboxConversationById(message.conversationId);
  if (!conversation) {
    console.log("[TEMPLATE_FLOW_RT] Skip: conversation not found", { conversationId: message.conversationId });
    return { ok: true, handled: false, reason: "CONVERSATION_NOT_FOUND" };
  }
  if (conversation.flowPaused === true) {
    console.log("[TEMPLATE_FLOW_RT] Skip: flow paused", { conversationId: conversation.id });
    return { ok: true, handled: false, reason: "CONVERSATION_FLOW_PAUSED" };
  }

  const contactId = String(message.contactId || conversation.contactId || input.contactId || "").trim();
  const contact = contactId ? await getContactById(contactId) : null;
  if (!contact || !contact.phoneE164) {
    console.log("[TEMPLATE_FLOW_RT] Skip: contact not found", { contactId, hasContact: !!contact, hasPhone: !!contact?.phoneE164 });
    return { ok: true, handled: false, reason: "CONTACT_NOT_FOUND" };
  }

  // Try direct link via WhatsApp context.id first (button/interactive replies reference the original message)
  const contextMetaMessageId = String(message?.contextMetaMessageId || message?.payload?.contextMetaMessageId || "").trim();
  let sourceTemplateMessage = null;

  if (contextMetaMessageId) {
    console.log("[TEMPLATE_FLOW_RT] Looking for source template via context.id", { contextMetaMessageId });
    sourceTemplateMessage = await findOutboundTemplateByMetaMessageId(contextMetaMessageId);
    if (sourceTemplateMessage) {
      console.log("[TEMPLATE_FLOW_RT] Found source template via context.id (direct link)", {
        sourceMessageId: sourceTemplateMessage.id,
        sourceMetaMessageId: sourceTemplateMessage.metaMessageId,
        templateName: sourceTemplateMessage.templateName,
        sourceCreatedAt: sourceTemplateMessage.createdAt,
      });
    } else {
      // Button sub-flow replies: context.id points to the interactive buttons message
      sourceTemplateMessage = await findOutboundFlowMessageByMetaMessageId(contextMetaMessageId);
      if (sourceTemplateMessage) {
        console.log("[TEMPLATE_FLOW_RT] Found source flow message via context.id (interactive/buttons)", {
          sourceMessageId: sourceTemplateMessage.id,
          sourceMetaMessageId: sourceTemplateMessage.metaMessageId,
          templateId: sourceTemplateMessage.payload?.templateId,
          sourceCreatedAt: sourceTemplateMessage.createdAt,
        });
      } else {
        console.log("[TEMPLATE_FLOW_RT] context.id did not match any outbound message, falling back to timestamp lookup");
      }
    }
  }

  // Fallback: find the most recent outbound template before this inbound message
  if (!sourceTemplateMessage) {
    console.log("[TEMPLATE_FLOW_RT] Looking for source template message (timestamp fallback)", {
      conversationId: conversation.id,
      before: String(message.createdAt || ""),
    });
    sourceTemplateMessage = await findLatestOutboundTemplateMessage(conversation.id, String(message.createdAt || "").trim());
  }

  if (!sourceTemplateMessage) {
    console.log("[TEMPLATE_FLOW_RT] Skip: no outbound template found before this message");
    return { ok: true, handled: false, reason: "NO_TEMPLATE_CONTEXT" };
  }

  const sourceTemplateId = String(sourceTemplateMessage?.payload?.templateId || "").trim();
  console.log("[TEMPLATE_FLOW_RT] Found source template", {
    sourceMessageId: sourceTemplateMessage.id,
    sourceTemplateId,
    templateName: sourceTemplateMessage.templateName,
    sourceCreatedAt: sourceTemplateMessage.createdAt,
  });

  if (!sourceTemplateId) {
    console.log("[TEMPLATE_FLOW_RT] Skip: source template message has no templateId in payload", {
      payloadKeys: Object.keys(sourceTemplateMessage.payload || {}),
    });
    return { ok: true, handled: false, reason: "SOURCE_TEMPLATE_ID_MISSING" };
  }

  const alreadyHandled = await findHandledRunBySourceMessage(
    contact.id,
    sourceTemplateMessage.id,
    sourceTemplateMessage.metaMessageId,
  );
  if (alreadyHandled) {
    console.log("[TEMPLATE_FLOW_RT] Skip: source template already handled", { runId: alreadyHandled.id });
    return { ok: true, handled: false, reason: "SOURCE_TEMPLATE_ALREADY_HANDLED", runId: alreadyHandled.id };
  }

  const flow = await getPublishedTemplateFlow(sourceTemplateId);
  const snapshot = flow?.publishedSnapshot && typeof flow.publishedSnapshot === "object"
    ? deepClone(flow.publishedSnapshot)
    : null;

  console.log("[TEMPLATE_FLOW_RT] Flow lookup", {
    sourceTemplateId,
    flowFound: !!flow,
    hasPublishedSnapshot: !!snapshot,
    publishedVersion: flow?.publishedVersion || 0,
    enabled: snapshot?.settings?.enabled,
  });

  if (!flow || !snapshot || Number(flow.publishedVersion || 0) <= 0) {
    console.log("[TEMPLATE_FLOW_RT] Skip: no published flow for template", { sourceTemplateId });
    return { ok: true, handled: false, reason: "NO_PUBLISHED_TEMPLATE_FLOW" };
  }

  if (snapshot?.settings?.enabled === false) {
    console.log("[TEMPLATE_FLOW_RT] Skip: flow disabled");
    return { ok: true, handled: false, reason: "TEMPLATE_FLOW_DISABLED" };
  }

  const branch = findMatchingBranch(snapshot, message);
  console.log("[TEMPLATE_FLOW_RT] Branch matching", {
    branchFound: !!branch,
    branchId: branch?.id,
    branchLabel: branch?.label,
    totalBranches: snapshot.branches?.length || 0,
    inboundTokens: collectInboundTokens(message),
  });

  if (!branch) {
    console.log("[TEMPLATE_FLOW_RT] Skip: no matching branch");
    return { ok: true, handled: false, reason: "NO_MATCHING_BRANCH" };
  }

  const run = {
    id: randomUUID(),
    templateFlowId: String(flow.id || ""),
    templateId: String(flow.templateId || sourceTemplateId),
    templateName: String(flow.templateName || snapshot?.template?.name || ""),
    publishedVersion: Number(flow.publishedVersion || 0),
    conversationId: conversation.id,
    contactId: contact.id,
    phoneE164: contact.phoneE164,
    inboundMessageId: String(message.id || "").trim(),
    inboundMetaMessageId: String(message.metaMessageId || "").trim(),
    inboundText: String(message.text || "").trim(),
    sourceTemplateMessageId: String(sourceTemplateMessage.id || "").trim(),
    sourceTemplateMetaMessageId: String(sourceTemplateMessage.metaMessageId || "").trim(),
    matchedBranchId: String(branch.id || ""),
    matchedBranchLabel: String(branch.label || ""),
    status: "running",
    actions: [],
    startedAt: nowIso(),
    completedAt: null,
    error: null,
  };

  try {
    await insertRun(run);
  } catch (err) {
    if (err?.code === 11000) {
      return { ok: true, handled: false, reason: "RUN_ALREADY_INSERTED" };
    }
    throw err;
  }

  const context = {
    runId: run.id,
    flow,
    contact,
    conversation,
    message,
    conversationLabel: String(conversation.displayName || contact.name || contact.firstName || "").trim(),
    sourceTemplateMessage,
  };

  try {
    const branchPolicy = await applyInboundBranchPolicy(branch, context);
    if (branchPolicy.applied) {
      run.actions.push({
        nodeId: "policy:global_opt_out",
        nodeType: "driver_contact_policy",
        startedAt: nowIso(),
        completedAt: nowIso(),
        status: "completed",
        payload: {
          globalOptOut: true,
          driverId: branchPolicy.driverId,
        },
      });
    }

    const nodes = Array.isArray(branch.nodes) ? branch.nodes : [];
    for (const node of nodes) {
      const startedAt = nowIso();
      const action = {
        nodeId: String(node?.id || ""),
        nodeType: String(node?.type || ""),
        startedAt,
        completedAt: null,
        status: "running",
        payload: {},
      };
      run.actions.push(action);

      const result = await executeNode(context, node);
      action.completedAt = nowIso();
      action.payload = result && typeof result === "object" ? result : {};
      action.status = result?.ok ? "completed" : "failed";

      if (!result?.ok) {
        run.status = "failed";
        run.error = {
          nodeId: action.nodeId,
          reason: result?.reason || "ACTION_FAILED",
        };
        break;
      }

      if (node.type === "handoff_human") {
        run.status = "handoff";
        break;
      }

      if (node.type === "end") {
        run.status = "completed";
        break;
      }
    }

    if (run.status === "running") {
      run.status = "completed";
    }
  } catch (err) {
    run.status = "failed";
    run.error = {
      reason: err?.code || "RUNTIME_ERROR",
      message: err?.message || "Falha ao executar fluxo do template.",
    };
  } finally {
    run.completedAt = nowIso();
    await replaceRun(run);
    try {
      await syncDriverOutreachFlowRun({ sourceTemplateMessage, message, run, branch });
    } catch (err) {
      console.warn("[TEMPLATE_FLOW_RT] outreach sync warning:", err?.message || err);
    }
    try {
      const campaignId = String(sourceTemplateMessage?.payload?.dispatchRunId || sourceTemplateMessage?.payload?.campaignId || "").trim();
      if (campaignId) {
        const lastAction = Array.isArray(run.actions) && run.actions.length
          ? run.actions[run.actions.length - 1]
          : null;
        await recordCampaignRecipientReaction(campaignId, contact?.id || "", {
          templateFlowRunId: run.id,
          flowStatus: run.status,
          lastFlowStep: lastAction ? String(lastAction.nodeType || "") : "",
          buttonPressed: branch?.label || run.matchedBranchLabel || "",
          reactedAt: run.startedAt || nowIso(),
          // Fallback: use metaMessageId of the outbound template to find the recipient
          // even if contactId resolved at webhook differs from contactId at dispatch time
          sourceMetaMessageId: String(sourceTemplateMessage?.metaMessageId || "").trim(),
        });
      }
    } catch (err) {
      console.warn("[TEMPLATE_FLOW_RT] recipient reaction sync warning:", err?.message || err);
    }
  }

  return {
    ok: true,
    handled: true,
    runId: run.id,
    status: run.status,
    templateId: run.templateId,
    branchId: run.matchedBranchId,
  };
}
