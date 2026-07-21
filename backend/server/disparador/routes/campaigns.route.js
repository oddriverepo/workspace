import { Router } from "express";
import { z } from "zod";
import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  getListById,
  getTemplateById,
  getContactById,
  startCampaign,
  completeCampaign,
  addInboxMessage,
} from "../store/memory-store.js";
import { sendTemplateMessage } from "../services/meta-client.js";
import {
  upsertRecipient as upsertCampaignRecipient,
  findRecipientsByCampaign,
  countRecipientsByCampaign,
} from "../services/mongo/campaign-recipients.repo.js";
import {
  listDispatchRuns,
  getDispatchRunById,
  listDispatchRunOperators,
} from "../services/mongo/dispatch-runs.repo.js";
import { listConversationOperators } from "../services/mongo/inbox.repo.js";
import { env } from "../config.js";
import { buildTemplateSnapshot, renderTemplateMessageText } from "../utils/template-render.js";

const router = Router();

// Throttle delay between Meta API sends (ms) to stay within rate limits.
// Meta allows ~80 template msgs/sec; 50ms ≈ 20/sec provides a safe margin.
const SEND_THROTTLE_MS = Number(process.env.META_SEND_THROTTLE_MS) || 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const campaignSchema = z.object({
  name: z.string().min(3),
  listId: z.string().min(1),
  templateId: z.string().min(1),
  scheduledAt: z.string().optional(),
});

router.get("/campaigns", async (req, res) => {
  res.json({ ok: true, items: await listCampaigns() });
});

router.post("/campaigns", async (req, res) => {
  const parsed = campaignSchema.parse(req.body || {});

  const list = await getListById(parsed.listId);
  if (!list) {
    return res.status(404).json({ ok: false, error: { code: "LIST_NOT_FOUND", message: "Lista nao encontrada para a campanha." } });
  }

  const template = await getTemplateById(parsed.templateId);
  if (!template) {
    return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template nao encontrado para a campanha." } });
  }

  const campaign = await createCampaign(parsed);
  return res.status(201).json({ ok: true, item: campaign });
});

async function evaluateCampaignReadiness(campaign) {
  const list = await getListById(campaign.listId);
  const template = await getTemplateById(campaign.templateId);

  if (!list) {
    return { ready: false, reason: "LIST_NOT_FOUND", message: "Lista da campanha nao encontrada." };
  }
  if (!template) {
    return { ready: false, reason: "TEMPLATE_NOT_FOUND", message: "Template da campanha nao encontrado." };
  }
  if (template.status !== "approved") {
    return { ready: false, reason: "TEMPLATE_NOT_APPROVED", message: "Template precisa estar aprovado para disparo." };
  }
  if (!list.contactIds.length) {
    return { ready: false, reason: "EMPTY_LIST", message: "Lista sem contatos para disparo." };
  }

  const contactPromises = list.contactIds.map((id) => getContactById(id));
  const contacts = (await Promise.all(contactPromises)).filter(Boolean);
  const blocked = contacts.filter((contact) => contact.optIn !== true || !!contact.optOutAt);
  const eligible = contacts.filter((contact) => contact.optIn === true && !contact.optOutAt);

  return { ready: true, list, template, contacts, blocked, eligible };
}

const startSchema = z.object({
  dryRun: z.coerce.boolean().optional(),
  simulate: z.coerce.boolean().optional(),
  sendLimit: z.coerce.number().int().min(1).max(5000).optional(),
});

const singleDispatchSchema = z.object({
  contactId: z.string().min(1),
  templateId: z.string().min(1),
  dryRun: z.coerce.boolean().optional(),
  simulate: z.coerce.boolean().optional(),
});

function isMetaDispatchConfigured() {
  return Boolean(env.metaSystemUserToken && env.metaPhoneNumberId);
}

function extractMetaMessageId(metaResponse = {}) {
  const list = Array.isArray(metaResponse?.messages) ? metaResponse.messages : [];
  const first = list[0] || {};
  return String(first.id || "").trim();
}

router.post("/campaigns/:id/start", async (req, res) => {
  const campaign = await getCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ ok: false, error: { code: "CAMPAIGN_NOT_FOUND", message: "Campanha nao encontrada." } });
  }

  const options = startSchema.parse(req.body || {});
  const readiness = await evaluateCampaignReadiness(campaign);
  if (!readiness.ready) {
    return res.status(400).json({ ok: false, error: { code: readiness.reason, message: readiness.message } });
  }

  const totalContacts = readiness.contacts.length;
  const blockedCount = readiness.blocked.length;
  const eligibleCount = readiness.eligible.length;
  const hardLimit = Math.min(options.sendLimit || env.campaignSendLimit, env.campaignSendLimit);
  const queue = readiness.eligible.slice(0, hardLimit);

  if (options.dryRun) {
    return res.json({
      ok: true,
      dryRun: true,
      summary: { totalContacts, blockedCount, eligibleCount, queuedCount: queue.length, limitApplied: hardLimit },
    });
  }

  await startCampaign(campaign.id, { queued: queue.length, sent: 0, failed: blockedCount, delivered: 0 });

  const shouldSendReal = isMetaDispatchConfigured() && !options.simulate;
  const failures = [];
  let sentCount = 0;

  if (shouldSendReal) {
    for (const contact of queue) {
      const parameters = [contact.firstName || contact.name || "cliente"];
      const renderedText = renderTemplateMessageText(readiness.template, parameters);
      const templateSnapshot = buildTemplateSnapshot(readiness.template);
      try {
        const response = await sendTemplateMessage({
          to: contact.phoneE164,
          templateName: readiness.template.name,
          languageCode: readiness.template.language || "pt_BR",
          parameters,
          bodyTemplateText: readiness.template.bodyText || "",
          headerType: readiness.template.headerType || "none",
          headerImageUrl: readiness.template.headerMediaUrl || "",
        });
        const inboxMsg = await addInboxMessage({
          contactId: contact.id,
          phoneE164: contact.phoneE164,
          displayName: contact.name || contact.firstName || "",
          direction: "outbound",
          kind: "template",
          templateName: readiness.template.name,
          templateLanguage: readiness.template.language || "pt_BR",
          text: renderedText,
          deliveryStatus: "sent",
          metaMessageId: extractMetaMessageId(response),
          source: "campaign.dispatch",
          payload: {
            campaignId: campaign.id,
            campaignName: campaign.name,
            templateId: readiness.template.id,
            dispatchMode: "meta_cloud_api",
            parameters,
            renderedText,
            templateSnapshot,
          },
        });
        await upsertCampaignRecipient({
          campaignId: campaign.id,
          contactId: contact.id,
          contactName: contact.name || contact.firstName || "",
          phoneE164: contact.phoneE164,
          metaMessageId: extractMetaMessageId(response),
          deliveryStatus: "sent",
          templateId: readiness.template.id,
          templateName: readiness.template.name,
          outboundMessageId: inboxMsg?.id || "",
        });
        sentCount += 1;
      } catch (err) {
        await addInboxMessage({
          contactId: contact.id,
          phoneE164: contact.phoneE164,
          displayName: contact.name || contact.firstName || "",
          direction: "outbound",
          kind: "template",
          templateName: readiness.template.name,
          templateLanguage: readiness.template.language || "pt_BR",
          text: renderedText,
          deliveryStatus: "failed",
          source: "campaign.dispatch",
          payload: {
            campaignId: campaign.id, campaignName: campaign.name, templateId: readiness.template.id,
            dispatchMode: "meta_cloud_api",
            parameters,
            renderedText,
            templateSnapshot,
            error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio." },
          },
        });
        await upsertCampaignRecipient({
          campaignId: campaign.id,
          contactId: contact.id,
          contactName: contact.name || contact.firstName || "",
          phoneE164: contact.phoneE164,
          deliveryStatus: "failed",
          deliveryError: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio." },
          templateId: readiness.template.id,
          templateName: readiness.template.name,
        });
        failures.push({ contactId: contact.id, phoneE164: contact.phoneE164, code: err.code || "SEND_ERROR", message: err.message || "Falha no envio." });
      }
      // Throttle between sends to respect Meta rate limits
      if (SEND_THROTTLE_MS > 0) await sleep(SEND_THROTTLE_MS);
    }
  } else {
    for (const contact of queue) {
      const parameters = [contact.firstName || contact.name || "cliente"];
      const renderedText = renderTemplateMessageText(readiness.template, parameters);
      const templateSnapshot = buildTemplateSnapshot(readiness.template);
      const inboxMsg = await addInboxMessage({
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        displayName: contact.name || contact.firstName || "",
        direction: "outbound",
        kind: "template",
        templateName: readiness.template.name,
        templateLanguage: readiness.template.language || "pt_BR",
        text: renderedText,
        deliveryStatus: "simulated",
        source: "campaign.dispatch",
        payload: {
          campaignId: campaign.id,
          campaignName: campaign.name,
          templateId: readiness.template.id,
          dispatchMode: "simulado",
          parameters,
          renderedText,
          templateSnapshot,
        },
      });
      await upsertCampaignRecipient({
        campaignId: campaign.id,
        contactId: contact.id,
        contactName: contact.name || contact.firstName || "",
        phoneE164: contact.phoneE164,
        deliveryStatus: "simulated",
        templateId: readiness.template.id,
        templateName: readiness.template.name,
        outboundMessageId: inboxMsg?.id || "",
      });
      sentCount += 1;
    }
  }

  const deliveredCount = sentCount;
  const failedCount = blockedCount + failures.length;
  const completed = await completeCampaign(campaign.id, { queued: queue.length, sent: sentCount, delivered: deliveredCount, failed: failedCount });

  return res.json({
    ok: true,
    item: completed,
    dispatchMode: shouldSendReal ? "meta_cloud_api" : "simulado",
    summary: { totalContacts, eligibleCount, blockedCount, queuedCount: queue.length, sentCount, failedCount, limitApplied: hardLimit },
    failures,
  });
});

router.post("/campaigns/send-single", async (req, res) => {
  const parsed = singleDispatchSchema.parse(req.body || {});
  const contact = await getContactById(parsed.contactId);
  if (!contact) {
    return res.status(404).json({ ok: false, error: { code: "CONTACT_NOT_FOUND", message: "Contato nao encontrado." } });
  }

  const template = await getTemplateById(parsed.templateId);
  if (!template) {
    return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template nao encontrado." } });
  }
  if (template.status !== "approved") {
    return res.status(400).json({ ok: false, error: { code: "TEMPLATE_NOT_APPROVED", message: "Template precisa estar aprovado para disparo." } });
  }
  if (contact.optIn !== true || contact.optOutAt) {
    return res.status(400).json({ ok: false, error: { code: "CONTACT_BLOCKED", message: "Contato sem opt-in ativo para envio." } });
  }

  const shouldSendReal = isMetaDispatchConfigured() && !parsed.simulate;
  if (parsed.dryRun) {
    return res.json({
      ok: true,
      dryRun: true,
      dispatchMode: shouldSendReal ? "meta_cloud_api" : "simulado",
      result: {
        status: "ready",
        contact: { id: contact.id, name: contact.name || contact.firstName || "", phoneE164: contact.phoneE164 },
        template: { id: template.id, name: template.name, status: template.status },
      },
    });
  }

  if (shouldSendReal) {
    const parameters = [contact.firstName || contact.name || "cliente"];
    const renderedText = renderTemplateMessageText(template, parameters);
    const templateSnapshot = buildTemplateSnapshot(template);
    try {
      const response = await sendTemplateMessage({
        to: contact.phoneE164,
        templateName: template.name,
        languageCode: template.language || "pt_BR",
        parameters,
        bodyTemplateText: template.bodyText || "",
        headerType: template.headerType || "none",
        headerImageUrl: template.headerMediaUrl || "",
      });
      await addInboxMessage({
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        displayName: contact.name || contact.firstName || "",
        direction: "outbound",
        kind: "template",
        templateName: template.name,
        templateLanguage: template.language || "pt_BR",
        text: renderedText,
        deliveryStatus: "sent",
        metaMessageId: extractMetaMessageId(response),
        source: "campaign.send_single",
        payload: { templateId: template.id, dispatchMode: "meta_cloud_api", parameters, renderedText, templateSnapshot },
      });
    } catch (err) {
      await addInboxMessage({
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        displayName: contact.name || contact.firstName || "",
        direction: "outbound",
        kind: "template",
        templateName: template.name,
        templateLanguage: template.language || "pt_BR",
        text: renderedText,
        deliveryStatus: "failed",
        source: "campaign.send_single",
        payload: {
          templateId: template.id,
          dispatchMode: "meta_cloud_api",
          parameters,
          renderedText,
          templateSnapshot,
          error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio individual." },
        },
      });
      return res.status(502).json({
        ok: false,
        error: { code: err.code || "SEND_ERROR", message: err.message || "Falha no envio individual.", meta: err.meta || null },
      });
    }
  } else {
    const parameters = [contact.firstName || contact.name || "cliente"];
    const renderedText = renderTemplateMessageText(template, parameters);
    const templateSnapshot = buildTemplateSnapshot(template);
    await addInboxMessage({
      contactId: contact.id,
      phoneE164: contact.phoneE164,
      displayName: contact.name || contact.firstName || "",
      direction: "outbound",
      kind: "template",
      templateName: template.name,
      templateLanguage: template.language || "pt_BR",
      text: renderedText,
      deliveryStatus: "simulated",
      source: "campaign.send_single",
      payload: { templateId: template.id, dispatchMode: "simulado", parameters, renderedText, templateSnapshot },
    });
  }

  return res.json({
    ok: true,
    dispatchMode: shouldSendReal ? "meta_cloud_api" : "simulado",
    result: {
      status: "sent",
      sentAt: new Date().toISOString(),
      contact: { id: contact.id, name: contact.name || contact.firstName || "", phoneE164: contact.phoneE164 },
      template: { id: template.id, name: template.name, status: template.status },
    },
  });
});

router.get("/campaigns/dispatches/list", async (req, res) => {
  const [campaigns, dispatchRuns] = await Promise.all([
    listCampaigns(),
    listDispatchRuns(),
  ]);

  const campaignItems = await Promise.all(
    campaigns.map(async (c) => {
      const totals = await countRecipientsByCampaign(c.id);
      return {
        id: c.id,
        name: c.name,
        templateId: c.templateId,
        source: "disparador_campaign",
        status: c.status,
        scheduledAt: c.scheduledAt,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
        createdAt: c.createdAt,
        metrics: c.metrics,
        totals,
      };
    })
  );

  const runItems = await Promise.all(
    dispatchRuns.map(async (r) => {
      const liveTotals = await countRecipientsByCampaign(r.id);
      return {
        id: r.id,
        name: r.sourceName || r.campaignName || r.source,
        templateId: r.templateId,
        templateName: r.templateName,
        source: r.source,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        status: r.status,
        operatorId: r.operatorId || "",
        operatorName: r.operatorName || "",
        startedAt: r.triggeredAt,
        finishedAt: r.finishedAt,
        totals: {
          total: r.totals?.targeted ?? liveTotals.total,
          sent: r.totals?.sent ?? (liveTotals.total - liveTotals.failed),
          failed: liveTotals.failed || r.totals?.failed || 0,
          blocked: r.totals?.blocked || 0,
          noPhone: r.totals?.noPhone || 0,
          delivered: liveTotals.delivered || 0,
          read: liveTotals.read || 0,
          reacted: liveTotals.reacted || 0,
          noReaction: liveTotals.noReaction || 0,
        },
      };
    })
  );

  const items = [...campaignItems, ...runItems].sort((a, b) => {
    const aDate = a.startedAt || a.createdAt || "";
    const bDate = b.startedAt || b.createdAt || "";
    return bDate.localeCompare(aDate);
  });

  return res.json({ ok: true, items });
});

router.get("/campaigns/dispatch-runs/:id", async (req, res) => {
  const run = await getDispatchRunById(req.params.id);
  if (!run) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Disparo nao encontrado." } });
  }
  return res.json({ ok: true, item: run });
});

// Distinct operators with activity (conversations OR dispatch runs).
router.get("/operators/active", async (req, res) => {
  try {
    const [convOps, runOps] = await Promise.all([
      listConversationOperators(),
      listDispatchRunOperators(),
    ]);
    const map = new Map();
    for (const op of [...convOps, ...runOps]) {
      const id = String(op?.operatorId || "").trim();
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, { operatorId: id, operatorName: String(op?.operatorName || "").trim() });
      } else if (!map.get(id).operatorName && op?.operatorName) {
        map.get(id).operatorName = String(op.operatorName).trim();
      }
    }
    const items = [...map.values()].sort((a, b) => a.operatorName.localeCompare(b.operatorName, "pt-BR"));
    return res.json({ ok: true, items });
  } catch (err) {
    console.error("[operators/active] erro:", err);
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Falha ao listar operadores." } });
  }
});

router.get("/campaigns/:id/metrics", async (req, res) => {
  const campaign = await getCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ ok: false, error: { code: "CAMPAIGN_NOT_FOUND", message: "Campanha nao encontrada." } });
  }
  return res.json({ ok: true, metrics: campaign.metrics, status: campaign.status, startedAt: campaign.startedAt, finishedAt: campaign.finishedAt });
});

router.get("/campaigns/:id/recipients", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const campaign = await getCampaignById(id);
  const filters = {};
  const ds = String(req.query.deliveryStatus || "").trim().toLowerCase();
  if (ds) filters.deliveryStatus = ds;
  const fs = String(req.query.flowStatus || "").trim().toLowerCase();
  if (fs) filters.flowStatus = fs;
  const reactedRaw = String(req.query.reacted || "").trim().toLowerCase();
  if (reactedRaw === "true" || reactedRaw === "1") filters.reacted = true;
  if (reactedRaw === "false" || reactedRaw === "0") filters.reacted = false;

  const [items, totals] = await Promise.all([
    findRecipientsByCampaign(id, filters),
    countRecipientsByCampaign(id),
  ]);
  return res.json({
    ok: true,
    campaign: campaign
      ? { id: campaign.id, name: campaign.name, templateId: campaign.templateId, status: campaign.status, startedAt: campaign.startedAt, finishedAt: campaign.finishedAt }
      : { id, name: "", templateId: "", status: "", startedAt: null, finishedAt: null },
    totals,
    items,
  });
});

export { router as campaignsRouter };
