import { Router } from "express";
import { z } from "zod";
import {
  createList,
  listLists,
  getListById,
  addContactsToList,
  getContactById,
  getContactByPhone,
} from "../store/memory-store.js";
import { normalizePhone } from "../utils/phone.js";

const router = Router();

const createListSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  source: z.string().optional(),
});

router.get("/lists", async (req, res) => {
  res.json({ ok: true, items: await listLists() });
});

router.post("/lists", async (req, res) => {
  const parsed = createListSchema.parse(req.body || {});
  const list = await createList(parsed);
  res.status(201).json({ ok: true, item: list });
});

const addToListSchema = z.object({
  contactIds: z.array(z.string()).optional(),
  phones: z.array(z.string()).optional(),
});

router.post("/lists/:id/contacts", async (req, res) => {
  const parsed = addToListSchema.parse(req.body || {});
  const list = await getListById(req.params.id);
  if (!list) {
    return res.status(404).json({ ok: false, error: { code: "LIST_NOT_FOUND", message: "Lista nao encontrada." } });
  }

  const idsFromBody = parsed.contactIds || [];
  const phonePromises = (parsed.phones || [])
    .map((phone) => normalizePhone(phone))
    .filter(Boolean)
    .map((phoneE164) => getContactByPhone(phoneE164));
  const phoneContacts = (await Promise.all(phonePromises)).filter(Boolean);
  const idsFromPhones = phoneContacts.map((contact) => contact.id);

  const candidateIds = [...new Set([...idsFromBody, ...idsFromPhones])];
  const existChecks = await Promise.all(candidateIds.map((id) => getContactById(id)));
  const existingIds = candidateIds.filter((_, i) => !!existChecks[i]);
  const missingIds = candidateIds.filter((_, i) => !existChecks[i]);

  const outcome = await addContactsToList(list.id, existingIds);
  return res.json({ ok: true, listId: list.id, added: outcome?.added || 0, missingIds });
});

export { router as listsRouter };
