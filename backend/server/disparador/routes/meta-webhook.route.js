import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { env } from "../config.js";
import { authenticateAdmin } from "../../middleware/authenticate-admin.js";
import {
  addWebhookEvent,
  listWebhookEvents,
  upsertContact,
  getContactByPhone,
  findLatestActiveFlowRunByContact,
  appendFlowRunEvent,
  ensureInboxConversation,
  addInboxMessage,
  updateInboxMessageStatusByMetaId,
  listTemplates,
  updateTemplateStatus,
} from "../store/memory-store.js";
import { normalizePhone } from "../utils/phone.js";
import { enqueueFlowAutomation } from "../services/flow-automation.service.js";
import { handleTemplateFlowInboundMessage } from "../services/template-flow-runtime.service.js";
import { updateDeliveryStatusByMetaId as updateRecipientDeliveryStatusByMetaId } from "../services/mongo/campaign-recipients.repo.js";
import {
  syncDriverOutreachDeliveryStatus,
  syncDriverOutreachInboundMessage,
} from "../../services/driver-outreach.js";

const router = Router();
const isProduction = env.nodeEnv === "production";

function mapMetaStatusToFlowEvent(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "sent") return "message.sent";
  if (value === "delivered") return "message.delivered";
  if (value === "read") return "message.read";
  if (value === "failed") return "message.failed";
  return "";
}

function mapMetaInboundToFlowEvent(message = {}) {
  const type = String(message.type || "").trim().toLowerCase();
  if (type === "button") return "inbound.button";
  if (type === "interactive") return "inbound.list_reply";
  return "inbound.text";
}

function mapMetaInboundToInboxKind(message = {}) {
  const type = String(message.type || "").trim().toLowerCase();
  if (!type) return "unknown";
  if (type === "interactive") return "interactive";
  if (type === "button") return "interactive";
  if (type === "text") return "text";
  if (type === "reaction") return "reaction";
  if (type === "location") return "location";
  if (type === "contacts") return "contacts";
  if (type === "sticker") return "sticker";
  if (["image", "video", "audio", "document"].includes(type)) return type;
  return "unknown";
}

function extractContactsMapFromPayload(payload) {
  const map = new Map();
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  entries.forEach((entry) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    changes.forEach((change) => {
      const value = change?.value || {};
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      contacts.forEach((contactItem) => {
        const waId = normalizePhone(contactItem?.wa_id);
        const name = String(contactItem?.profile?.name || "").trim();
        if (waId && name) {
          map.set(waId, name);
        }
      });
    });
  });
  return map;
}

/**
 * Process template status updates from the webhook payload.
 * Meta sends these when a template is approved, rejected, or paused.
 * Field path: entry[].changes[].value (when field === "message_template_status_update").
 */
async function syncTemplateStatusFromWebhook(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  let updatedCount = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== "message_template_status_update") continue;
      const value = change?.value || {};
      const metaEvent = String(value.event || "").toLowerCase();
      const metaTemplateName = String(value.message_template_name || "").trim().toLowerCase();
      const reason = String(value.reason || "").trim();

      if (!metaTemplateName) continue;

      // Map Meta event to our internal status
      let newStatus = "";
      if (metaEvent === "approved") newStatus = "approved";
      else if (metaEvent === "rejected" || metaEvent === "disabled") newStatus = "rejected";
      else if (metaEvent === "pending_deletion") newStatus = "paused";
      else if (metaEvent === "flagged") newStatus = "paused";
      else continue;

      // Find our local template by name and update status
      try {
        const allTemplates = await listTemplates();
        const match = allTemplates.find((t) => String(t.name || "").toLowerCase() === metaTemplateName);
        if (match && match.status !== newStatus) {
          await updateTemplateStatus(match.id, newStatus);
          updatedCount += 1;
          console.log(`[WEBHOOK] Template "${match.name}" status: ${match.status} → ${newStatus}${reason ? ` (reason: ${reason})` : ""}`);
        }
      } catch (err) {
        console.warn(`[WEBHOOK] Falha ao atualizar status do template "${metaTemplateName}":`, err.message);
      }
    }
  }

  return updatedCount;
}

function extractInboundText(messageItem = {}) {
  const directText = String(messageItem?.text?.body || "").trim();
  if (directText) return directText;
  const buttonText = String(messageItem?.button?.text || "").trim();
  if (buttonText) return buttonText;
  const interactiveButtonTitle = String(messageItem?.interactive?.button_reply?.title || "").trim();
  if (interactiveButtonTitle) return interactiveButtonTitle;
  const interactiveListTitle = String(messageItem?.interactive?.list_reply?.title || "").trim();
  if (interactiveListTitle) return interactiveListTitle;

  // Reaction
  if (messageItem?.reaction) {
    const emoji = String(messageItem.reaction.emoji || "").trim();
    return emoji ? `${emoji} (reagiu a uma mensagem)` : "Reagiu a uma mensagem";
  }

  // Location
  if (messageItem?.location) {
    const loc = messageItem.location;
    const name = String(loc.name || "").trim();
    const address = String(loc.address || "").trim();
    const lat = loc.latitude;
    const lng = loc.longitude;
    const label = name || address || (lat != null && lng != null ? `${lat}, ${lng}` : "localizacao");
    return `\uD83D\uDCCD Localizacao: ${label}`;
  }

  // Sticker
  if (messageItem?.sticker) {
    return "Figurinha";
  }

  // Contacts (vCard)
  const contactList = Array.isArray(messageItem?.contacts) ? messageItem.contacts : null;
  if (contactList && contactList.length) {
    const first = contactList[0] || {};
    const name = String(first?.name?.formatted_name || first?.name?.first_name || "").trim();
    const phones = Array.isArray(first?.phones) ? first.phones : [];
    const phone = String(phones[0]?.phone || phones[0]?.wa_id || "").trim();
    const parts = [name, phone].filter(Boolean).join(" - ");
    const extra = contactList.length > 1 ? ` (+${contactList.length - 1})` : "";
    return `\uD83D\uDC64 Contato: ${parts || "sem nome"}${extra}`;
  }

  // Order (catalogo)
  if (messageItem?.order) {
    const items = Array.isArray(messageItem.order.product_items) ? messageItem.order.product_items : [];
    return `\uD83D\uDED2 Pedido recebido (${items.length} item${items.length === 1 ? "" : "s"})`;
  }

  // System (mudanca de numero, etc)
  if (messageItem?.system) {
    const body = String(messageItem.system.body || "").trim();
    return body || "Mensagem do sistema do WhatsApp";
  }

  // Erros reportados pela Meta dentro da mensagem
  const errors = Array.isArray(messageItem?.errors) ? messageItem.errors : [];
  if (errors.length) {
    const first = errors[0] || {};
    const title = String(first.title || first.message || "erro").trim();
    return `\u26A0\uFE0F Erro Meta: ${title}`;
  }

  // Midia: ja tinha cobertura
  const mediaText = buildInboundMediaText(messageItem);
  if (mediaText) return mediaText;

  // Fallback final: indica o tipo bruto para diagnostico
  const rawType = String(messageItem?.type || "").trim();
  if (rawType && rawType !== "text") {
    return `Mensagem do tipo "${rawType}" (sem texto)`;
  }
  return "";
}

function extractInboundMediaPayload(messageItem = {}) {
  const type = String(messageItem?.type || "").trim().toLowerCase();
  if (!["image", "document", "audio", "video", "sticker"].includes(type)) return null;
  const mediaNode = messageItem?.[type];
  if (!mediaNode || typeof mediaNode !== "object") return null;

  const payload = {
    kind: type,
    mediaId: String(mediaNode.id || "").trim(),
    mimeType: String(mediaNode.mime_type || "").trim(),
    sha256: String(mediaNode.sha256 || "").trim(),
    caption: String(mediaNode.caption || "").trim(),
    filename: String(mediaNode.filename || "").trim(),
    url: String(mediaNode.link || mediaNode.url || "").trim(),
    isVoiceNote: Boolean(mediaNode.voice),
    animated: Boolean(mediaNode.animated),
  };

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== "" && value !== false));
}

function buildInboundMediaText(messageItem = {}) {
  const media = extractInboundMediaPayload(messageItem);
  if (!media) return "";

  if (media.kind === "image") {
    return media.caption ? `Imagem: ${media.caption}` : "Imagem recebida";
  }
  if (media.kind === "video") {
    return media.caption ? `Video: ${media.caption}` : "Video recebido";
  }
  if (media.kind === "document") {
    const name = String(media.filename || "").trim();
    return name ? `Documento: ${name}` : "Documento recebido";
  }
  if (media.kind === "audio") {
    return media.isVoiceNote ? "Mensagem de voz" : "Audio recebido";
  }
  if (media.kind === "sticker") {
    return "Figurinha";
  }
  return "";
}

async function syncInboxFromWebhook(payload) {
  const contactsByPhone = extractContactsMapFromPayload(payload);
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const inboundMessages = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};

      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const statusItem of statuses) {
        const phoneE164 = normalizePhone(statusItem?.recipient_id);
        if (!phoneE164) continue;
        const profileName = contactsByPhone.get(phoneE164) || "";
        const { contact } = await upsertContact({ phoneE164, name: profileName, source: "meta_webhook_status" });
        await ensureInboxConversation({ contactId: contact?.id || "", phoneE164, displayName: profileName || contact?.name || "" });

        const statusValue = String(statusItem?.status || "").trim().toLowerCase();
        const updated = await updateInboxMessageStatusByMetaId(statusItem?.id, statusValue, statusItem);
        await syncDriverOutreachDeliveryStatus(statusItem?.id, statusValue, statusItem);
        try {
          await updateRecipientDeliveryStatusByMetaId(statusItem?.id, statusValue, statusItem);
        } catch (err) {
          console.warn("[WEBHOOK] recipient status update failed:", err?.message || err);
        }
        if (!updated) {
          await addInboxMessage({
            contactId: contact?.id || "",
            contactSnapshot: {
              id: String(contact?.id || "").trim(),
              name: String(profileName || contact?.name || "").trim(),
              phoneE164,
              avatar: String(contact?.avatar || "").trim(),
              optIn: contact?.optIn === true,
            },
            phoneE164,
            displayName: profileName || contact?.name || "",
            direction: "system",
            kind: "status",
            text: "",
            deliveryStatus: statusValue,
            metaMessageId: String(statusItem?.id || "").trim(),
            source: "meta.webhook",
            payload: { statusPayload: statusItem },
          });
        }
      }

      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const messageItem of messages) {
        const phoneE164 = normalizePhone(messageItem?.from);
        if (!phoneE164) continue;
        const profileName = contactsByPhone.get(phoneE164) || "";
        const { contact } = await upsertContact({ phoneE164, name: profileName, source: "meta_webhook_inbound", lastInboundAt: new Date().toISOString() });
        const media = extractInboundMediaPayload(messageItem);
        const renderedText = extractInboundText(messageItem);
        const rawType = String(messageItem?.type || "").trim();
        const extras = {};
        if (messageItem?.location && typeof messageItem.location === "object") extras.location = messageItem.location;
        if (Array.isArray(messageItem?.contacts) && messageItem.contacts.length) extras.contacts = messageItem.contacts;
        if (messageItem?.reaction && typeof messageItem.reaction === "object") extras.reaction = messageItem.reaction;
        if (messageItem?.order && typeof messageItem.order === "object") extras.order = messageItem.order;
        if (Array.isArray(messageItem?.errors) && messageItem.errors.length) extras.errors = messageItem.errors;
        if (rawType && !renderedText) {
          console.warn(`[WEBHOOK] Mensagem inbound do tipo "${rawType}" sem texto extraido. messageId=${messageItem?.id || ""}`);
        }

        const storedMessage = await addInboxMessage({
          id: String(messageItem?.id || "").trim() || undefined,
          contactId: contact?.id || "",
          contactSnapshot: {
            id: String(contact?.id || "").trim(),
            name: String(profileName || contact?.name || "").trim(),
            phoneE164,
            avatar: String(contact?.avatar || "").trim(),
            optIn: contact?.optIn === true,
          },
          phoneE164,
          displayName: profileName || contact?.name || "",
          direction: "inbound",
          kind: mapMetaInboundToInboxKind(messageItem),
          text: renderedText,
          metaMessageId: String(messageItem?.id || "").trim(),
          contextMetaMessageId: String(messageItem?.context?.id || "").trim(),
          source: "meta.webhook",
          payload: {
            messageType: rawType,
            renderedText,
            contextMetaMessageId: String(messageItem?.context?.id || "").trim(),
            raw: messageItem,
            ...(media ? { media } : {}),
            ...extras,
          },
        });
        if (storedMessage) {
          await syncDriverOutreachInboundMessage(storedMessage);
          inboundMessages.push({
            contactId: String(contact?.id || "").trim(),
            phoneE164,
            message: storedMessage,
          });
        }
      }
    }
  }

  console.log("[WEBHOOK] syncInboxFromWebhook done, inbound messages:", inboundMessages.length);
  return { inboundMessages };
}

function extractFlowEventsFromWebhook(payload) {
  const events = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  entries.forEach((entry) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    changes.forEach((change) => {
      const value = change?.value || {};
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      statuses.forEach((statusItem) => {
        const eventType = mapMetaStatusToFlowEvent(statusItem?.status);
        const phoneE164 = normalizePhone(statusItem?.recipient_id);
        if (!eventType || !phoneE164) return;
        events.push({ phoneE164, type: eventType, payload: { status: statusItem?.status || "", messageId: statusItem?.id || "" } });
      });

      const messages = Array.isArray(value?.messages) ? value.messages : [];
      messages.forEach((messageItem) => {
        const phoneE164 = normalizePhone(messageItem?.from);
        if (!phoneE164) return;
        const eventType = mapMetaInboundToFlowEvent(messageItem);
        const routeLabel =
          messageItem?.button?.payload ||
          messageItem?.button?.text ||
          messageItem?.interactive?.button_reply?.id ||
          messageItem?.interactive?.button_reply?.title ||
          messageItem?.interactive?.list_reply?.id ||
          messageItem?.interactive?.list_reply?.title ||
          "";
        events.push({
          phoneE164,
          type: eventType,
          payload: {
            messageId: messageItem?.id || "",
            routeLabel: String(routeLabel || "").trim(),
            text: String(messageItem?.text?.body || "").trim(),
            rawType: String(messageItem?.type || "").trim(),
          },
        });
      });
    });
  });

  return events;
}

router.get("/webhooks/meta/whatsapp", (req, res) => {
  const querySchema = z.object({
    "hub.mode": z.string().optional(),
    "hub.verify_token": z.string().optional(),
    "hub.challenge": z.string().optional(),
  });

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Query invalida." });
  }

  const mode = parsed.data["hub.mode"];
  const token = parsed.data["hub.verify_token"];
  const challenge = parsed.data["hub.challenge"] || "";

  if (!env.webhookVerifyToken) {
    return res.status(503).json({ ok: false, error: "Webhook verify token nao configurado." });
  }

  if (mode === "subscribe" && token === env.webhookVerifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ ok: false, error: "Falha na verificacao do webhook." });
});

router.post("/webhooks/meta/whatsapp", async (req, res) => {
  console.log("[WEBHOOK] POST received — processing payload");
  // Validate X-Hub-Signature-256 from Meta
  if (!env.metaAppSecret && isProduction) {
    console.error("[WEBHOOK] META_APP_SECRET ausente em producao. Payload rejeitado.");
    return res.status(503).json({ ok: false, error: "Webhook signature secret nao configurado." });
  }

  if (env.metaAppSecret) {
    const signature = req.headers["x-hub-signature-256"] || "";
    // Use the raw body buffer preserved by express.json({ verify }) for accurate HMAC.
    // Falls back to JSON.stringify only if rawBody is not available.
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const expected = "sha256=" + crypto.createHmac("sha256", env.metaAppSecret).update(rawBody).digest("hex");
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      console.warn("[WEBHOOK] Invalid signature — rejecting payload");
      return res.status(403).json({ ok: false, error: "Invalid signature." });
    }
  } else {
    console.warn("[WEBHOOK] META_APP_SECRET ausente. Aceitando payload apenas em ambiente nao-producao.");
  }
  const payload = req.body || {};
  await addWebhookEvent(payload);
  const inboxSync = await syncInboxFromWebhook(payload);
  const templateStatusUpdates = await syncTemplateStatusFromWebhook(payload);

  const flowEvents = extractFlowEventsFromWebhook(payload);
  let linkedRuns = 0;
  let processedEvents = 0;
  let queuedAutomations = 0;
  let templateFlowRuns = 0;

  const inboundMessages = inboxSync?.inboundMessages || [];
  console.log("[WEBHOOK] Inbound messages to process:", inboundMessages.length);
  for (const inboundItem of inboundMessages) {
    console.log("[WEBHOOK] Calling handleTemplateFlowInboundMessage", {
      contactId: inboundItem.contactId,
      phoneE164: inboundItem.phoneE164,
      messageId: inboundItem.message?.id,
      messageKind: inboundItem.message?.kind,
      messageText: String(inboundItem.message?.text || "").slice(0, 80),
    });
    try {
      const runtimeResult = await handleTemplateFlowInboundMessage(inboundItem);
      console.log("[WEBHOOK] Template flow result:", JSON.stringify(runtimeResult));
      if (runtimeResult?.handled) templateFlowRuns += 1;
    } catch (err) {
      console.error("[WEBHOOK] Template flow runtime error:", err);
    }
  }

  for (const event of flowEvents) {
    const contact = await getContactByPhone(event.phoneE164);
    if (!contact) continue;
    const run = await findLatestActiveFlowRunByContact(contact.id);
    if (!run) continue;
    const outcome = await appendFlowRunEvent(run.id, {
      type: event.type,
      source: "meta.webhook",
      payload: event.payload,
    });
    if (outcome) {
      linkedRuns += 1;
      processedEvents += 1;
      if (outcome.transition?.moved && String(outcome.run?.status) === "active") {
        const queued = await enqueueFlowAutomation({
          runId: outcome.run.id,
          reason: "WEBHOOK_TRANSITION_MOVED",
          source: "meta.webhook",
          force: false,
        });
        if (queued?.queued) queuedAutomations += 1;
      }
    }
  }

  return res.status(200).json({
    ok: true,
    received: true,
    flowEventsDetected: flowEvents.length,
    flowEventsProcessed: processedEvents,
    flowRunsLinked: linkedRuns,
    automationsQueued: queuedAutomations,
    templateFlowRuns,
    templateStatusUpdates,
  });
});

router.get("/webhooks/meta/whatsapp/events", authenticateAdmin, async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit || "50"), 10);
  const safeLimit = Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50;
  return res.json({ ok: true, items: await listWebhookEvents(safeLimit) });
});

export { router as metaWebhookRouter };
