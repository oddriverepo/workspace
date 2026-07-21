import { Router } from "express";
import { z } from "zod";
import { createTemplate, listTemplates, updateTemplateStatus, getTemplateById } from "../store/memory-store.js";
import { createMetaTemplate, listMetaTemplates } from "../services/meta-client.js";

const router = Router();

const templateButtonSchema = z.object({
  type: z.enum(["quick_reply", "url", "phone_number", "opt_in", "opt_out"]).default("quick_reply"),
  text: z.string().min(1).max(25),
  url: z.string().url().optional(),
  phoneNumber: z.string().optional(),
});

const templateSchema = z.object({
  name: z.string().min(3).regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e underscore."),
  language: z.string().min(2),
  category: z.enum(["marketing", "utility", "authentication", "service"]),
  status: z.enum(["draft", "pending", "approved", "rejected", "paused"]).optional(),
  headerType: z.enum(["none", "text", "image"]).optional(),
  headerText: z.string().max(60).optional(),
  headerMediaHandle: z.string().optional(),
  headerMediaUrl: z.union([z.string().url(), z.literal("")]).optional(),
  footerText: z.string().max(60).optional(),
  buttons: z.array(templateButtonSchema).max(3).optional(),
  bodyText: z.string().min(3),
  metaTemplateId: z.string().optional(),
  submitToMeta: z.coerce.boolean().optional(),
});

function normalizeMetaButton(rawButton = {}) {
  const rawType = String(rawButton?.type || "QUICK_REPLY").trim().toUpperCase();
  const text = String(rawButton?.text || "").trim().slice(0, 25);
  if (!text) return null;
  if (rawType === "URL") {
    return {
      type: "url",
      text,
      url: String(rawButton?.url || "").trim(),
    };
  }
  if (rawType === "PHONE_NUMBER") {
    return {
      type: "phone_number",
      text,
      phoneNumber: String(rawButton?.phone_number || rawButton?.phoneNumber || "").trim(),
    };
  }
  return {
    type: "quick_reply",
    text,
  };
}

function extractTemplateFieldsFromMeta(metaTemplate = {}) {
  const components = Array.isArray(metaTemplate?.components) ? metaTemplate.components : [];
  const bodyComp = components.find((component) => String(component?.type || "").toUpperCase() === "BODY");
  const headerComp = components.find((component) => String(component?.type || "").toUpperCase() === "HEADER");
  const footerComp = components.find((component) => String(component?.type || "").toUpperCase() === "FOOTER");
  const buttonsComp = components.find((component) => String(component?.type || "").toUpperCase() === "BUTTONS");

  const headerFormat = String(headerComp?.format || "").trim().toUpperCase();
  const headerType = headerFormat === "TEXT"
    ? "text"
    : (headerFormat === "IMAGE" ? "image" : "none");

  const buttons = Array.isArray(buttonsComp?.buttons)
    ? buttonsComp.buttons.map(normalizeMetaButton).filter(Boolean).slice(0, 3)
    : [];

  return {
    bodyText: String(bodyComp?.text || metaTemplate?.name || "").trim(),
    headerType,
    headerText: headerType === "text" ? String(headerComp?.text || "").trim() : "",
    footerText: String(footerComp?.text || "").trim(),
    buttons,
  };
}

router.get("/templates", async (req, res) => {
  res.json({ ok: true, items: await listTemplates() });
});

router.get("/templates/:id", async (req, res) => {
  const item = await getTemplateById(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template nao encontrado." } });
  return res.json({ ok: true, item });
});

router.post("/templates", async (req, res) => {
  let parsed;
  try {
    parsed = templateSchema.parse(req.body || {});
  } catch (err) {
    if (err?.issues) {
      const msgs = err.issues.map((i) => i.message).join("; ");
      return res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: msgs } });
    }
    throw err;
  }

  // Always save to MongoDB first so the template is never lost
  const initialStatus = parsed.submitToMeta ? "pending" : (parsed.status || "draft");
  const item = await createTemplate({ ...parsed, status: initialStatus, metaTemplateId: parsed.metaTemplateId || "" });

  let metaResult = null;
  if (parsed.submitToMeta) {
    try {
      metaResult = await createMetaTemplate(parsed);
      const metaId = String(metaResult.id || "");
      const metaStatus = metaResult.status ? String(metaResult.status).toLowerCase() : "pending";
      await updateTemplateStatus(item.id, metaStatus, { metaTemplateId: metaId });
      item.status = metaStatus;
      item.metaTemplateId = metaId;
    } catch (metaErr) {
      console.warn("[TEMPLATE] Salvo localmente mas falha ao enviar para Meta:", metaErr.message);
      await updateTemplateStatus(item.id, "draft", { metaError: metaErr.message });
      item.status = "draft";
      item.metaError = metaErr.message;
    }
  }

  res.status(201).json({ ok: true, item, meta: metaResult });
});

const statusSchema = z.object({
  status: z.enum(["draft", "pending", "approved", "rejected", "paused"]),
});

router.patch("/templates/:id/status", async (req, res) => {
  let parsed;
  try {
    parsed = statusSchema.parse(req.body || {});
  } catch (err) {
    if (err?.issues) {
      const msgs = err.issues.map((i) => i.message).join("; ");
      return res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: msgs } });
    }
    throw err;
  }
  const updated = await updateTemplateStatus(req.params.id, parsed.status);
  if (!updated) return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template nao encontrado." } });
  return res.json({ ok: true, item: updated });
});

// PATCH /templates/by-name/:name/header-media — atualiza URL publica da imagem
// usada para envio. Necessario porque sync-from-meta nao recupera URLs.
router.patch("/templates/by-name/:name/header-media", async (req, res) => {
  const name = String(req.params.name || "").toLowerCase();
  if (!name) return res.status(400).json({ ok: false, error: { code: "INVALID_NAME", message: "Nome obrigatorio." } });
  const headerMediaUrl = String(req.body?.headerMediaUrl || "").trim();
  if (!headerMediaUrl) return res.status(400).json({ ok: false, error: { code: "INVALID_URL", message: "headerMediaUrl obrigatorio." } });
  const all = await listTemplates();
  const target = all.find((t) => String(t.name).toLowerCase() === name);
  if (!target) return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template nao encontrado." } });
  const updated = await updateTemplateStatus(target.id, target.status, { headerMediaUrl });
  return res.json({ ok: true, item: updated });
});

// Sync templates from Meta → MongoDB
// For each template returned by Meta, upsert: update status+metaTemplateId if name matches, or create new entry.
router.post("/templates/sync-from-meta", async (req, res) => {
  const metaData = await listMetaTemplates({ limit: 250, fields: "id,name,status,language,category,components" });
  const metaTemplates = Array.isArray(metaData?.data) ? metaData.data : [];
  const localTemplates = await listTemplates();
  const localByName = new Map(localTemplates.map((t) => [String(t.name).toLowerCase(), t]));

  let created = 0;
  let updated = 0;

  for (const mt of metaTemplates) {
    const name = String(mt.name || "").toLowerCase();
    const metaId = String(mt.id || "");
    const rawStatus = String(mt.status || "").toLowerCase();
    // Map Meta statuses to internal
    const status = ["approved", "rejected", "paused", "pending", "deleted"].includes(rawStatus) ? rawStatus : "pending";
    const language = String(mt.language || "pt_BR");
    const rawCategory = String(mt.category || "utility").toLowerCase();
    const category = ["marketing", "utility", "authentication", "service"].includes(rawCategory) ? rawCategory : "utility";
    const fieldsFromMeta = extractTemplateFieldsFromMeta(mt);

    const existing = localByName.get(name);
    if (existing) {
      await updateTemplateStatus(existing.id, status, {
        metaTemplateId: metaId,
        language,
        category,
        bodyText: fieldsFromMeta.bodyText,
        headerType: fieldsFromMeta.headerType,
        headerText: fieldsFromMeta.headerText,
        footerText: fieldsFromMeta.footerText,
        buttons: fieldsFromMeta.buttons,
      });
      updated++;
    } else {
      await createTemplate({
        name,
        language,
        category,
        bodyText: fieldsFromMeta.bodyText,
        headerType: fieldsFromMeta.headerType,
        headerText: fieldsFromMeta.headerText,
        footerText: fieldsFromMeta.footerText,
        buttons: fieldsFromMeta.buttons,
        status,
        metaTemplateId: metaId,
        submitToMeta: false,
      });
      created++;
    }
  }

  const items = await listTemplates();
  return res.json({ ok: true, synced: metaTemplates.length, created, updated, items });
});

export { router as templatesRouter };
