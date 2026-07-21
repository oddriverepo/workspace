import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { normalizePhone } from "../utils/phone.js";
import { sendTemplateMessage, sendTextMessage } from "../services/meta-client.js";
import { downloadInboundMedia } from "../services/meta-client.js";
import { enqueueFlowAutomation } from "../services/flow-automation.service.js";
import { addClient, removeClient, clientCount } from "../services/inbox-events.js";
import { createAdminStreamTicket } from "../../services/streamTickets.js";
import { buildTemplateSnapshot, renderTemplateMessageText } from "../utils/template-render.js";
import {
  listInboxConversations,
  getInboxConversationById,
  listInboxMessages,
  markInboxConversationRead,
  setInboxConversationFlowPaused,
  ensureInboxConversation,
  addInboxMessage,
  getContactById,
  getContactByPhone,
  upsertContact,
  getTemplateById,
  listTemplates,
  findLatestActiveFlowRunByContact,
  appendFlowRunEvent,
} from "../store/memory-store.js";


const router = Router();

router.post("/inbox/stream-ticket", (req, res) => {
  const ticket = createAdminStreamTicket(req.adminUser);
  return res.json({ ok: true, ticket: ticket.ticket, expiresAt: ticket.expiresAt });
});

/* ── SSE stream for real-time OdChat updates ──────────────────── */
router.get("/inbox/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",          // Nginx/Render: disable response buffering
  });
  res.write(": connected\n\n");

  const id = addClient(res);
  res.write(`event: hello\ndata: ${JSON.stringify({ clientId: id, clients: clientCount() })}\n\n`);

  req.on("close", () => removeClient(res));
  req.on("error", () => removeClient(res));
});

function toLower(value) {
  return String(value || "").trim().toLowerCase();
}

function isMetaDispatchConfigured() {
  return Boolean(env.metaSystemUserToken && env.metaPhoneNumberId);
}

function extractMetaMessageId(metaResponse = {}) {
  const messages = Array.isArray(metaResponse?.messages) ? metaResponse.messages : [];
  const first = messages[0] || {};
  return String(first.id || "").trim();
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

async function resolveTemplateByRef(templateRef) {
  const raw = String(templateRef || "").trim();
  if (!raw) return null;
  const byId = await getTemplateById(raw);
  if (byId) return byId;
  const normalized = toLower(raw);
  const all = (await listTemplates()) || [];
  return all.find((item) => {
    return toLower(item.name) === normalized || toLower(item.metaTemplateId) === normalized;
  }) || null;
}

async function resolveConversationTarget(input = {}) {
  const conversationFromId = input.conversationId
    ? await getInboxConversationById(input.conversationId)
    : null;

  let contact = null;
  if (input.contactId) {
    contact = await getContactById(input.contactId);
  }
  if (!contact && conversationFromId?.contactId) {
    contact = await getContactById(conversationFromId.contactId);
  }

  const explicitPhone = normalizePhone(input.phoneE164 || input.phone || "");
  const phoneE164 =
    explicitPhone ||
    String(contact?.phoneE164 || "").trim() ||
    String(conversationFromId?.phoneE164 || "").trim();

  if (!phoneE164) return null;

  if (!contact) {
    contact = await getContactByPhone(phoneE164);
  }
  if (!contact) {
    const created = await upsertContact({
      phoneE164,
      name: String(input.displayName || "").trim(),
      source: "inbox_manual",
    });
    contact = created?.contact || null;
  }

  const conversation = await ensureInboxConversation({
    conversationId: conversationFromId?.id || input.conversationId || "",
    contactId: contact?.id || "",
    phoneE164,
    displayName: String(input.displayName || contact?.name || contact?.firstName || "").trim(),
  });

  return {
    conversation,
    contact,
    phoneE164,
    displayName: String(conversation?.displayName || contact?.name || contact?.firstName || "").trim(),
  };
}

const _convListCache = new Map();

router.get("/inbox/conversations", async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit || "200"), 10);
  const safeLimit = Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : 200;

  const search = String(req.query.search || "");
  const status = String(req.query.status || "");
  const operatorId = String(req.query.operatorId || "").trim();

  // Micro-cache 2s para amortecer rajadas (multi-tab, rapida sequencia de polls/SSE drop).
  // Chave inclui filtros para nao retornar resultado errado por busca.
  const cacheKey = `${safeLimit}|${search}|${status}|${operatorId}`;
  const now = Date.now();
  const cached = _convListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    res.set("Cache-Control", "private, max-age=2");
    return res.json({ ok: true, items: cached.items });
  }

  const items = await listInboxConversations({ search, status, operatorId, limit: safeLimit });
  _convListCache.set(cacheKey, { items, expiresAt: now + 2000 });
  // Limita tamanho do cache para nao crescer infinitamente.
  if (_convListCache.size > 32) {
    const firstKey = _convListCache.keys().next().value;
    if (firstKey) _convListCache.delete(firstKey);
  }
  res.set("Cache-Control", "private, max-age=2");
  return res.json({ ok: true, items });
});

// ── Proxy de midia inbound (Meta exige Bearer + URL temporaria de 5min) ──
// Cache em memoria curto para evitar bater na Meta a cada visualizacao.
const _inboundMediaCache = new Map(); // mediaId -> { buffer, mimeType, expiresAt }
const INBOUND_MEDIA_CACHE_TTL_MS = 10 * 60 * 1000; // 10min
const INBOUND_MEDIA_CACHE_MAX = 200;

function _evictOldInboundMedia() {
  if (_inboundMediaCache.size <= INBOUND_MEDIA_CACHE_MAX) return;
  const now = Date.now();
  for (const [k, v] of _inboundMediaCache) {
    if (v.expiresAt < now) _inboundMediaCache.delete(k);
  }
  // Se ainda estourar, remove os primeiros (FIFO).
  while (_inboundMediaCache.size > INBOUND_MEDIA_CACHE_MAX) {
    const firstKey = _inboundMediaCache.keys().next().value;
    if (!firstKey) break;
    _inboundMediaCache.delete(firstKey);
  }
}

router.get("/inbox/media/:mediaId", async (req, res) => {
  const mediaId = String(req.params.mediaId || "").trim();
  if (!mediaId || !/^[0-9A-Za-z_-]{6,}$/.test(mediaId)) {
    return res.status(400).json({ ok: false, error: { code: "INVALID_MEDIA_ID", message: "mediaId invalido." } });
  }

  try {
    const cached = _inboundMediaCache.get(mediaId);
    if (cached && cached.expiresAt > Date.now()) {
      res.set("Content-Type", cached.mimeType || "application/octet-stream");
      res.set("Cache-Control", "private, max-age=600");
      return res.send(cached.buffer);
    }

    const { buffer, mimeType } = await downloadInboundMedia(mediaId);
    _inboundMediaCache.set(mediaId, {
      buffer,
      mimeType,
      expiresAt: Date.now() + INBOUND_MEDIA_CACHE_TTL_MS,
    });
    _evictOldInboundMedia();

    res.set("Content-Type", mimeType || "application/octet-stream");
    res.set("Cache-Control", "private, max-age=600");
    return res.send(buffer);
  } catch (err) {
    const status = err?.statusCode || 500;
    console.error("[INBOX_MEDIA] Falha ao baixar mediaId=%s: %s", mediaId, err?.message || err);
    return res.status(status).json({
      ok: false,
      error: { code: err?.code || "MEDIA_FETCH_ERROR", message: err?.message || "Falha ao baixar midia." },
    });
  }
});

router.get("/inbox/conversations/:id/messages", async (req, res) => {
  const conversation = await getInboxConversationById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ ok: false, error: { code: "CONVERSATION_NOT_FOUND", message: "Conversa não encontrada." } });
  }
  const limit = Number.parseInt(String(req.query.limit || "100"), 10);
  const safeLimit = Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : 100;
  const before = String(req.query.before || "").trim();
  const page = await listInboxMessages(conversation.id, { limit: safeLimit, before });
  return res.json({ ok: true, conversation, ...page });
});

const createConversationSchema = z.object({
  contactId: z.string().optional(),
  phoneE164: z.string().optional(),
  displayName: z.string().optional(),
});

router.post("/inbox/conversations", async (req, res) => {
  const parsed = createConversationSchema.parse(req.body || {});
  const target = await resolveConversationTarget(parsed);
  if (!target) {
    return res.status(400).json({ ok: false, error: { code: "INVALID_TARGET", message: "Informe contato ou telefone válido para abrir a conversa." } });
  }
  return res.status(201).json({ ok: true, item: await getInboxConversationById(target.conversation.id) });
});

router.post("/inbox/conversations/:id/read", async (req, res) => {
  const updated = await markInboxConversationRead(req.params.id);
  if (!updated) {
    return res.status(404).json({ ok: false, error: { code: "CONVERSATION_NOT_FOUND", message: "Conversa não encontrada." } });
  }
  return res.json({ ok: true, item: updated });
});

router.post("/inbox/conversations/:id/pause-flow", async (req, res) => {
  const updated = await setInboxConversationFlowPaused(req.params.id, true);
  if (!updated) {
    return res.status(404).json({ ok: false, error: { code: "CONVERSATION_NOT_FOUND", message: "Conversa não encontrada." } });
  }
  let run = null;
  if (updated.contactId) {
    run = await findLatestActiveFlowRunByContact(updated.contactId);
  }
  if (run) {
    await appendFlowRunEvent(run.id, {
      type: "manual.pause",
      source: "inbox.ui",
      payload: { conversationId: updated.id, reason: "PAUSED_FROM_INBOX" },
    });
  }
  return res.json({ ok: true, item: updated, activeRunId: run?.id || "" });
});

router.post("/inbox/conversations/:id/resume-flow", async (req, res) => {
  const updated = await setInboxConversationFlowPaused(req.params.id, false);
  if (!updated) {
    return res.status(404).json({ ok: false, error: { code: "CONVERSATION_NOT_FOUND", message: "Conversa não encontrada." } });
  }
  let run = null;
  if (updated.contactId) {
    run = await findLatestActiveFlowRunByContact(updated.contactId);
  }
  if (run) {
    await appendFlowRunEvent(run.id, {
      type: "manual.resume",
      source: "inbox.ui",
      payload: { conversationId: updated.id, reason: "RESUMED_FROM_INBOX" },
    });
    await enqueueFlowAutomation({
      runId: run.id,
      reason: "INBOX_RESUME",
      source: "inbox.ui",
      force: true,
    });
  }
  return res.json({ ok: true, item: updated, activeRunId: run?.id || "" });
});

const sendInboxSchema = z.object({
  conversationId: z.string().optional(),
  contactId: z.string().optional(),
  phoneE164: z.string().optional(),
  displayName: z.string().optional(),
  type: z.enum(["text", "template"]),
  text: z.string().optional(),
  templateId: z.string().optional(),
  templateName: z.string().optional(),
  languageCode: z.string().optional(),
  parameters: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  simulate: z.coerce.boolean().optional(),
});

router.post("/inbox/send", async (req, res) => {
  const parsed = sendInboxSchema.parse(req.body || {});
  const target = await resolveConversationTarget(parsed);
  if (!target) {
    return res.status(400).json({ ok: false, error: { code: "INVALID_TARGET", message: "Informe conversa, contato ou telefone válido para envio." } });
  }

  const operatorId = String(req.adminUser?.id || "").trim();
  const operatorName = String(req.adminUser?.name || req.adminUser?.username || "").trim();

  const sendReal = isMetaDispatchConfigured() && parsed.simulate !== true;

  if (parsed.type === "text") {
    const text = String(parsed.text || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: { code: "INVALID_TEXT", message: "Texto não pode ser vazio." } });
    }

    let metaResponse = null;
    if (sendReal) {
      try {
        metaResponse = await sendTextMessage({ to: target.phoneE164, text });
      } catch (err) {
        await addInboxMessage({
          conversationId: target.conversation.id,
          contactId: target.contact?.id || "",
          contactSnapshot: toContactSnapshot(target.contact),
          phoneE164: target.phoneE164,
          displayName: target.displayName,
          direction: "outbound",
          kind: "text",
          text,
          deliveryStatus: "failed",
          source: "inbox.manual",
          operatorId,
          operatorName,
          payload: { dispatchMode: "meta_cloud_api", error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio manual de texto." } },
        });
        return res.status(502).json({ ok: false, error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio manual de texto.", meta: err.meta || null } });
      }
    }

    const message = await addInboxMessage({
      conversationId: target.conversation.id,
      contactId: target.contact?.id || "",
      contactSnapshot: toContactSnapshot(target.contact),
      phoneE164: target.phoneE164,
      displayName: target.displayName,
      direction: "outbound",
      kind: "text",
      text,
      deliveryStatus: sendReal ? "sent" : "simulated",
      metaMessageId: sendReal ? extractMetaMessageId(metaResponse) : "",
      source: "inbox.manual",
      operatorId,
      operatorName,
      payload: { dispatchMode: sendReal ? "meta_cloud_api" : "simulado" },
    });

    return res.json({
      ok: true,
      dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
      conversation: await getInboxConversationById(target.conversation.id),
      item: message,
    });
  }

  // type === "template"
  const templateRef = parsed.templateId || parsed.templateName || "";
  const template = await resolveTemplateByRef(templateRef);
  if (!template) {
    return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template não encontrado para envio manual." } });
  }
  if (sendReal && String(template.status || "").toLowerCase() !== "approved") {
    return res.status(400).json({ ok: false, error: { code: "TEMPLATE_NOT_APPROVED", message: "Template precisa estar aprovado para envio real." } });
  }

  const parameters = Array.isArray(parsed.parameters)
    ? parsed.parameters.map((item) => String(item))
    : [target.contact?.firstName || target.contact?.name || "cliente"];
  const renderedText = renderTemplateMessageText(template, parameters);
  const templateSnapshot = buildTemplateSnapshot(template);

  let metaResponse = null;
  if (sendReal) {
    try {
      metaResponse = await sendTemplateMessage({
        to: target.phoneE164,
        templateName: template.name,
        languageCode: parsed.languageCode || template.language || "pt_BR",
        parameters,
        bodyTemplateText: template.bodyText || "",
        headerType: template.headerType || "none",
        headerImageUrl: template.headerMediaUrl || "",
      });
    } catch (err) {
      console.error("[INBOX_SEND_FAIL]", {
        templateName: template.name,
        templateLanguage: parsed.languageCode || template.language || "pt_BR",
        to: target.phoneE164,
        parametersCount: parameters.length,
        parameters,
        bodyTextSnippet: String(template.bodyText || "").slice(0, 200),
        bodyTextHasNamed: /\{\{\s*[A-Za-z_]/.test(String(template.bodyText || "")),
        bodyTextHasPositional: /\{\{\s*\d+\s*\}\}/.test(String(template.bodyText || "")),
        errorCode: err?.code || null,
        statusCode: err?.statusCode || null,
        errorMessage: err?.message || null,
        meta: err?.meta ? JSON.stringify(err.meta) : null,
      });
      await addInboxMessage({
        conversationId: target.conversation.id,
        contactId: target.contact?.id || "",
        contactSnapshot: toContactSnapshot(target.contact),
        phoneE164: target.phoneE164,
        displayName: target.displayName,
        direction: "outbound",
        kind: "template",
        text: renderedText,
        templateName: template.name,
        templateLanguage: parsed.languageCode || template.language || "pt_BR",
        deliveryStatus: "failed",
        source: "inbox.manual",
        operatorId,
        operatorName,
        payload: {
          templateId: template.id,
          dispatchMode: "meta_cloud_api",
          parameters,
          renderedText,
          templateSnapshot,
          error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio manual do template." },
        },
      });
      return res.status(502).json({ ok: false, error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio manual do template.", meta: err.meta || null } });
    }
  }

  const message = await addInboxMessage({
    conversationId: target.conversation.id,
    contactId: target.contact?.id || "",
    contactSnapshot: toContactSnapshot(target.contact),
    phoneE164: target.phoneE164,
    displayName: target.displayName,
    direction: "outbound",
    kind: "template",
    text: renderedText,
    templateName: template.name,
    templateLanguage: parsed.languageCode || template.language || "pt_BR",
    deliveryStatus: sendReal ? "sent" : "simulated",
    metaMessageId: sendReal ? extractMetaMessageId(metaResponse) : "",
    source: "inbox.manual",
    operatorId,
    operatorName,
    payload: {
      templateId: template.id,
      dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
      parameters,
      renderedText,
      templateSnapshot,
    },
  });

  return res.json({
    ok: true,
    dispatchMode: sendReal ? "meta_cloud_api" : "simulado",
    conversation: await getInboxConversationById(target.conversation.id),
    item: message,
  });
});

export { router as inboxRouter };
