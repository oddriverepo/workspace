import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { env } from "../config.js";
import {
  upsertContact,
  listContacts,
  getOrCreateListByName,
  addContactsToList,
  getIdempotentResult,
  saveIdempotentResult,
} from "../store/memory-store.js";
import { normalizePhone, parseBooleanLike } from "../utils/phone.js";
import { parseCsvBuffer, parseXlsxBuffer, pickField } from "../utils/spreadsheets.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
});

function splitTags(raw) {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  if (raw === null || raw === undefined) return [];
  return String(raw).split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

function toIsoDateOrNull(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString();
}

function mapRowToNormalizedContact(row, defaults = {}) {
  const phoneRaw = pickField(row, ["phone", "telefone", "celular", "whatsapp", "numero", "numero_whatsapp", "phone_number"]);
  const phoneE164 = normalizePhone(phoneRaw);
  const name = String(pickField(row, ["name", "nome", "contato", "full_name", "nome_completo"]) || "").trim();
  const firstName = String(pickField(row, ["first_name", "primeiro_nome"]) || "").trim();
  const externalId = String(pickField(row, ["external_id", "id_externo", "lead_id", "id"]) || "").trim();
  const tags = splitTags(pickField(row, ["tags", "tag", "etiquetas"]));
  const optInRaw = pickField(row, ["opt_in", "optin", "consentimento", "aceite"]);
  const sourceRaw = String(pickField(row, ["source", "origem", "canal"]) || "").trim();
  const optInAtRaw = pickField(row, ["opt_in_at", "optin_at", "consent_date", "data_optin"]);

  return {
    phoneE164, name, firstName, externalId, tags,
    source: sourceRaw || defaults.source || "import",
    optIn: parseBooleanLike(optInRaw, defaults.defaultOptIn),
    optInAt: toIsoDateOrNull(optInAtRaw),
  };
}

function mapPayloadContact(raw, defaults = {}) {
  return {
    phoneE164: normalizePhone(raw.phone || raw.phoneE164 || raw.whatsapp),
    name: String(raw.name || raw.nome || "").trim(),
    firstName: String(raw.firstName || raw.primeiroNome || "").trim(),
    externalId: String(raw.externalId || raw.leadId || "").trim(),
    tags: splitTags(raw.tags),
    source: String(raw.source || defaults.source || "api_push").trim(),
    optIn: parseBooleanLike(raw.optIn, defaults.defaultOptIn),
    optInAt: toIsoDateOrNull(raw.optInAt),
  };
}

async function processContactBatch(normalizedContacts, options = {}) {
  const result = { total: normalizedContacts.length, created: 0, updated: 0, invalid: 0, invalidItems: [] };

  let targetList = null;
  if (options.listName) {
    targetList = await getOrCreateListByName(options.listName, {
      description: options.listDescription || "Lista criada por importacao",
      source: options.source || "import",
    });
  }

  for (let index = 0; index < normalizedContacts.length; index++) {
    const contact = normalizedContacts[index];
    if (!contact.phoneE164) {
      result.invalid += 1;
      result.invalidItems.push({ index, reason: "Telefone invalido (formato E.164 esperado)." });
      continue;
    }
    if (contact.optIn !== true) {
      result.invalid += 1;
      result.invalidItems.push({ index, reason: "Contato sem opt-in valido.", phoneE164: contact.phoneE164 });
      continue;
    }
    const { contact: saved, created } = await upsertContact(contact);
    if (created) result.created += 1;
    else result.updated += 1;
    if (targetList) await addContactsToList(targetList.id, [saved.id]);
  }

  return { ...result, list: targetList ? { id: targetList.id, name: targetList.name } : null };
}

router.get("/contacts", async (req, res) => {
  const items = await listContacts();
  res.json({ ok: true, items, total: items.length });
});

router.post("/contacts/import/csv", upload.single("file"), async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: { code: "MISSING_FILE", message: "Envie um arquivo CSV no campo 'file'." } });
  }
  const source = String(req.body.source || "csv_import").trim();
  const listName = String(req.body.listName || "").trim();
  const defaultOptIn = parseBooleanLike(req.body.defaultOptIn, null);
  const rows = parseCsvBuffer(req.file.buffer);
  const normalized = rows.map((row) => mapRowToNormalizedContact(row, { source, defaultOptIn }));
  const report = await processContactBatch(normalized, { source, listName });
  return res.json({ ok: true, report });
});

router.post("/contacts/import/xlsx", upload.single("file"), async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: { code: "MISSING_FILE", message: "Envie um arquivo XLSX no campo 'file'." } });
  }
  const source = String(req.body.source || "xlsx_import").trim();
  const listName = String(req.body.listName || "").trim();
  const defaultOptIn = parseBooleanLike(req.body.defaultOptIn, null);
  const rows = await parseXlsxBuffer(req.file.buffer);
  const normalized = rows.map((row) => mapRowToNormalizedContact(row, { source, defaultOptIn }));
  const report = await processContactBatch(normalized, { source, listName });
  return res.json({ ok: true, report });
});

const pushSchema = z.object({
  integrationKey: z.string().optional(),
  idempotencyKey: z.string().optional(),
  source: z.string().optional(),
  listName: z.string().optional(),
  defaultOptIn: z.union([z.boolean(), z.string()]).optional(),
  contacts: z.array(
    z.object({
      phone: z.string().optional(),
      phoneE164: z.string().optional(),
      whatsapp: z.string().optional(),
      name: z.string().optional(),
      nome: z.string().optional(),
      firstName: z.string().optional(),
      externalId: z.string().optional(),
      leadId: z.string().optional(),
      tags: z.union([z.string(), z.array(z.string())]).optional(),
      optIn: z.union([z.boolean(), z.string()]).optional(),
      optInAt: z.string().optional(),
      source: z.string().optional(),
    })
  ).min(1),
});

router.post("/contacts/import/push", async (req, res) => {
  const parsed = pushSchema.parse(req.body || {});
  const headerIntegrationKey = String(req.header("x-integration-key") || "").trim();
  const bodyIntegrationKey = String(parsed.integrationKey || "").trim();
  const providedKey = headerIntegrationKey || bodyIntegrationKey;

  if (env.integrationIngestKey && providedKey !== env.integrationIngestKey) {
    return res.status(401).json({ ok: false, error: { code: "INVALID_INTEGRATION_KEY", message: "Chave de integracao invalida." } });
  }

  const idempotencyKey = String(req.header("x-idempotency-key") || parsed.idempotencyKey || "").trim();
  if (idempotencyKey) {
    const cached = await getIdempotentResult(idempotencyKey);
    if (cached) return res.json({ ok: true, idempotent: true, report: cached.report });
  }

  const source = String(parsed.source || "api_push").trim();
  const listName = String(parsed.listName || "").trim();
  const defaultOptIn = parseBooleanLike(parsed.defaultOptIn, null);

  const normalized = parsed.contacts.map((row) => mapPayloadContact(row, { source, defaultOptIn }));
  const report = await processContactBatch(normalized, { source, listName });

  if (idempotencyKey) await saveIdempotentResult(idempotencyKey, { report });

  return res.json({ ok: true, idempotent: false, report });
});

export { router as contactsRouter };
