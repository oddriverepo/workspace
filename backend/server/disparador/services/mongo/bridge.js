/**
 * Bridge: adapts existing `drivers` → contacts and `campaigns` → lists.
 * Falls back to `disparador_contacts` / `disparador_lists` for orphan records.
 *
 * Fase 5: API OdDrive como fonte primária de motoristas/campanhas.
 * MongoDB mantido para WhatsApp metadata (optIn, tags, etc.) e orphan contacts.
 */
import { getDb } from "../../../services/mongo.js";
import {
  fetchDrivers,
  fetchDriverById,
  findDriverByPhone,
  fetchCampaigns,
  fetchDriversByCampaign,
  filterDetachedCampaignDrivers,
} from "../../../services/db.js";

const CONTACTS_COL = "disparador_contacts";
const LISTS_COL = "disparador_lists";
const WA_OVERLAY_COL = "disparador_driver_wa_metadata";

async function db() {
  return getDb();
}

// ── Helpers ────────────────────────────────────────────────────

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function activeDriverDocIds(campaignId, driverDocs = []) {
  const normalizedCampaignId = String(campaignId || "");
  const drivers = driverDocs.map(doc => ({
    id: String(doc?._id || "").trim(),
    campaignId: normalizedCampaignId,
    driverCampaignId: doc?.driver_campaign_id ? String(doc.driver_campaign_id) : "",
  }));
  const activeDrivers = await filterDetachedCampaignDrivers(normalizedCampaignId, drivers);
  return activeDrivers.map(driver => driver.id).filter(Boolean);
}

/**
 * Extract a phone value from the driver's raw spreadsheet columns when the
 * top-level `phone` field is empty/null.  The `raw` object preserves every
 * original column exactly as it appeared in the imported spreadsheet.
 */
function extractPhoneFromDriver(driver) {
  // 1 – top-level phone (set by upsertDriverRecord)
  if (driver.phone) return driver.phone;

  // 2 – digits-only field (may exist even when display phone is missing)
  if (driver.phone_digits) return driver.phone_digits;

  // 3 – raw spreadsheet columns (case-sensitive lookup, same names as campaignImport)
  const raw = driver.raw;
  if (raw && typeof raw === "object") {
    const candidates = [
      "Numero", "Numero ", "Número", "numero", "número",
      "NUMERO", "NÚMERO",
      "telefone", "Telefone", "TELEFONE",
      "CELULAR", "Celular", "celular",
      "WhatsApp", "Whatsapp", "whatsapp",
      "Fone", "fone", "FONE",
      "Tel", "tel", "TEL",
    ];
    for (const key of candidates) {
      if (raw[key]) return String(raw[key]);
    }
  }

  return "";
}

function driverToContact(driver) {
  if (!driver) return null;
  const name = String(driver.name || "");
  return {
    id: String(driver._id),
    phoneE164: extractPhoneFromDriver(driver),
    avatar: String(driver.avatar || "").trim(),
    name,
    firstName: name.split(" ")[0] || "",
    source: driver.whatsapp_source || "campaign",
    externalId: driver.whatsapp_external_id || "",
    tags: Array.isArray(driver.whatsapp_tags) ? driver.whatsapp_tags : [],
    optIn: driver.whatsapp_opt_in === true,
    optInAt: toIso(driver.whatsapp_opt_in_at),
    optOutAt: toIso(driver.whatsapp_opt_out_at),
    lastInboundAt: toIso(driver.whatsapp_last_inbound_at),
    createdAt: toIso(driver.created_at) || nowIso(),
    updatedAt: toIso(driver.updated_at) || nowIso(),
    _isDriver: true,
    _campaignId: driver.campaign_id || null,
  };
}

/**
 * Converte motorista da API OdDrive para o formato de contato do disparador.
 * Mescla WhatsApp metadata de overlay MongoDB quando disponível.
 */
function apiDriverToContact(apiDriver, waOverlay = null) {
  if (!apiDriver) return null;
  const name = String(apiDriver.name || "");
  const wa = waOverlay || {};
  return {
    id: String(apiDriver.id),
    phoneE164: apiDriver.phone || "",
    avatar: String(apiDriver.avatar || "").trim(),
    name,
    firstName: name.split(" ")[0] || "",
    source: wa.whatsapp_source || "oddrive_api",
    externalId: wa.whatsapp_external_id || "",
    tags: Array.isArray(wa.whatsapp_tags) ? wa.whatsapp_tags : [],
    optIn: wa.whatsapp_opt_in === true,
    optInAt: toIso(wa.whatsapp_opt_in_at),
    optOutAt: toIso(wa.whatsapp_opt_out_at),
    lastInboundAt: toIso(wa.whatsapp_last_inbound_at),
    createdAt: toIso(apiDriver.createdAt) || nowIso(),
    updatedAt: toIso(apiDriver.updatedAt) || nowIso(),
    _isDriver: true,
    _campaignId: apiDriver.campaignId || null,
  };
}

/**
 * Busca overlay de WhatsApp metadata do MongoDB para um driver ID.
 */
async function getWaOverlay(driverId) {
  try {
    const d = await db();
    return await d.collection(WA_OVERLAY_COL).findOne({ _id: driverId });
  } catch {
    return null;
  }
}

/**
 * Busca overlays de WhatsApp metadata do MongoDB para múltiplos driver IDs.
 */
async function getWaOverlays(driverIds) {
  if (!driverIds.length) return new Map();
  try {
    const d = await db();
    const docs = await d.collection(WA_OVERLAY_COL).find({ _id: { $in: driverIds } }).toArray();
    return new Map(docs.map(doc => [doc._id, doc]));
  } catch {
    return new Map();
  }
}

function orphanDocToContact(doc) {
  if (!doc) return null;
  return { ...doc, id: doc._id || doc.id, _isDriver: false, _campaignId: null };
}

// ── Contact read ───────────────────────────────────────────────

export async function getContactById(id) {
  // 1) API OdDrive (fonte primária)
  try {
    const apiDriver = await fetchDriverById(id);
    if (apiDriver) {
      const overlay = await getWaOverlay(id);
      return apiDriverToContact(apiDriver, overlay);
    }
  } catch (err) {
    console.warn("[bridge] Falha ao buscar motorista na API por ID", err?.message || err);
  }

  // 2) Fallback: MongoDB drivers
  try {
    const d = await db();
    const driver = await d.collection("drivers").findOne({ _id: id });
    if (driver) return driverToContact(driver);
  } catch {}

  // 3) Orphan contacts
  try {
    const d = await db();
    const orphan = await d.collection(CONTACTS_COL).findOne({ _id: id });
    return orphan ? orphanDocToContact(orphan) : null;
  } catch {
    return null;
  }
}

export async function getContactByPhone(phoneE164) {
  const digits = sanitizeDigits(phoneE164);
  if (!digits) return null;

  // 1) API OdDrive (fonte primária)
  try {
    const apiDriver = await findDriverByPhone(phoneE164);
    if (apiDriver) {
      const overlay = await getWaOverlay(apiDriver.id);
      return apiDriverToContact(apiDriver, overlay);
    }
  } catch (err) {
    console.warn("[bridge] Falha ao buscar motorista na API por telefone", err?.message || err);
  }

  // 2) Fallback: MongoDB drivers
  try {
    const d = await db();
    const suffix = digits.slice(-9);
    const driver = await d.collection("drivers").findOne({
      $or: [
        { phone: phoneE164 },
        { phone_digits: digits },
        { phone_suffix: suffix },
      ],
    });
    if (driver) return driverToContact(driver);
  } catch {}

  // 3) Orphan contacts
  try {
    const d = await db();
    const orphan = await d.collection(CONTACTS_COL).findOne({
      $or: [{ phoneE164 }, { phoneDigits: digits }],
    });
    return orphan ? orphanDocToContact(orphan) : null;
  } catch {
    return null;
  }
}

export async function listContacts() {
  const contacts = [];
  const seenIds = new Set();

  // 1) API OdDrive (fonte primária)
  try {
    const apiDrivers = await fetchDrivers();
    const driverIds = apiDrivers.map(d => d.id);
    const overlays = await getWaOverlays(driverIds);
    for (const apiDriver of apiDrivers) {
      const overlay = overlays.get(apiDriver.id) || null;
      const contact = apiDriverToContact(apiDriver, overlay);
      if (contact) {
        contacts.push(contact);
        seenIds.add(contact.id);
      }
    }
  } catch (err) {
    console.warn("[bridge] Falha ao listar motoristas via API", err?.message || err);
  }

  // 2) Fallback: MongoDB drivers (apenas IDs que não vieram da API)
  try {
    const d = await db();
    const mongoDrivers = await d.collection("drivers").find({}).toArray();
    for (const driver of mongoDrivers) {
      const id = String(driver._id);
      if (seenIds.has(id)) continue;
      const contact = driverToContact(driver);
      if (contact) {
        contacts.push(contact);
        seenIds.add(id);
      }
    }
  } catch {}

  // 3) Orphan contacts
  try {
    const d = await db();
    const orphans = await d.collection(CONTACTS_COL).find({}).toArray();
    for (const orphan of orphans) {
      contacts.push(orphanDocToContact(orphan));
    }
  } catch {}

  return contacts;
}

// ── Contact write ──────────────────────────────────────────────

/**
 * Upsert a contact. If the phone matches an existing driver, update WhatsApp
 * metadata on the driver doc. Otherwise, upsert into disparador_contacts.
 * Returns { contact, created }.
 */
export async function upsertContact(input) {
  const phoneE164 = input.phoneE164;
  if (!phoneE164) return { contact: null, created: false };

  const digits = sanitizeDigits(phoneE164);
  const suffix = digits.slice(-9);

  // 1) Check if phone matches an API driver
  let apiDriver = null;
  try {
    apiDriver = await findDriverByPhone(phoneE164);
  } catch {}

  if (apiDriver) {
    // Save WhatsApp metadata to overlay collection (API is read-only)
    const d = await db();
    const waFields = {};
    if (input.source) waFields.whatsapp_source = input.source;
    if (input.externalId) waFields.whatsapp_external_id = input.externalId;

    if (Array.isArray(input.tags) && input.tags.length) {
      const existing = await getWaOverlay(apiDriver.id);
      const prev = Array.isArray(existing?.whatsapp_tags) ? existing.whatsapp_tags : [];
      waFields.whatsapp_tags = [...new Set([...prev, ...input.tags])];
    }

    if (typeof input.optIn === "boolean") {
      waFields.whatsapp_opt_in = input.optIn;
      if (input.optIn) {
        waFields.whatsapp_opt_in_at = input.optInAt || nowIso();
        waFields.whatsapp_opt_out_at = null;
      } else {
        waFields.whatsapp_opt_out_at = input.optOutAt || nowIso();
      }
    }

    if (input.lastInboundAt) {
      waFields.whatsapp_last_inbound_at = input.lastInboundAt;
    }

    waFields.updated_at = new Date();

    if (Object.keys(waFields).length) {
      await d.collection(WA_OVERLAY_COL).updateOne(
        { _id: apiDriver.id },
        { $set: waFields },
        { upsert: true },
      );
    }

    const overlay = await getWaOverlay(apiDriver.id);
    return { contact: apiDriverToContact(apiDriver, overlay), created: false };
  }

  // 2) Check if phone matches a MongoDB driver
  try {
    const d = await db();
    const driver = await d.collection("drivers").findOne({
      $or: [
        { phone: phoneE164 },
        { phone_digits: digits },
        { phone_suffix: suffix },
      ],
    });

    if (driver) {
      const waFields = {};
      if (input.source) waFields.whatsapp_source = input.source;
      if (input.externalId) waFields.whatsapp_external_id = input.externalId;
      if (input.name && !driver.name) waFields.name = input.name;

      if (Array.isArray(input.tags) && input.tags.length) {
        const merged = [...new Set([...(driver.whatsapp_tags || []), ...input.tags])];
        waFields.whatsapp_tags = merged;
      }

      if (typeof input.optIn === "boolean") {
        waFields.whatsapp_opt_in = input.optIn;
        if (input.optIn) {
          waFields.whatsapp_opt_in_at = input.optInAt || toIso(driver.whatsapp_opt_in_at) || nowIso();
          waFields.whatsapp_opt_out_at = null;
        } else {
          waFields.whatsapp_opt_out_at = input.optOutAt || nowIso();
        }
      }

      if (input.lastInboundAt) {
        waFields.whatsapp_last_inbound_at = input.lastInboundAt;
      }

      waFields.updated_at = new Date();

      if (Object.keys(waFields).length) {
        await d.collection("drivers").updateOne({ _id: driver._id }, { $set: waFields });
      }

      const merged = { ...driver, ...waFields };
      return { contact: driverToContact(merged), created: false };
    }
  } catch {}

  // 3) No matching driver → upsert into disparador_contacts
  const d = await db();
  const existing = await d.collection(CONTACTS_COL).findOne({
    $or: [{ phoneE164 }, { phoneDigits: digits }],
  });

  const timestamp = nowIso();

  if (existing) {
    const updates = {
      name: input.name || existing.name,
      firstName: input.firstName || existing.firstName,
      source: input.source || existing.source,
      externalId: input.externalId || existing.externalId,
      tags: [...new Set([...(existing.tags || []), ...(input.tags || [])])],
      updatedAt: timestamp,
    };
    if (typeof input.optIn === "boolean") {
      updates.optIn = input.optIn;
      if (input.optIn) {
        updates.optInAt = input.optInAt || existing.optInAt || timestamp;
        updates.optOutAt = null;
      } else {
        updates.optOutAt = input.optOutAt || timestamp;
      }
    }
    if (input.lastInboundAt) updates.lastInboundAt = input.lastInboundAt;

    await d.collection(CONTACTS_COL).updateOne({ _id: existing._id }, { $set: updates });
    const merged = { ...existing, ...updates };
    return { contact: orphanDocToContact(merged), created: false };
  }

  // Brand new orphan contact
  const { randomUUID } = await import("crypto");
  const id = randomUUID();
  const contact = {
    _id: id,
    id,
    phoneE164,
    phoneDigits: digits,
    name: input.name || "",
    firstName: input.firstName || "",
    source: input.source || "manual",
    externalId: input.externalId || "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    optIn: typeof input.optIn === "boolean" ? input.optIn : false,
    optInAt: input.optIn ? (input.optInAt || timestamp) : null,
    optOutAt: input.optIn === false ? (input.optOutAt || timestamp) : null,
    lastInboundAt: input.lastInboundAt || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await d.collection(CONTACTS_COL).insertOne(contact);
  return { contact: orphanDocToContact(contact), created: true };
}

// ── List read (campaigns → lists) ──────────────────────────────

function campaignToListBase(campaign) {
  return {
    id: String(campaign._id),
    name: campaign.name || "",
    description: [campaign.client, campaign.period].filter(Boolean).join(" - "),
    source: "campaign",
    createdAt: toIso(campaign.created_at) || nowIso(),
    updatedAt: toIso(campaign.updated_at) || nowIso(),
  };
}

function apiCampaignToListBase(apiCampaign) {
  const city = apiCampaign.apiData?.city || "";
  const state = apiCampaign.apiData?.state || "";
  const location = [city, state].filter(Boolean).join("/");
  return {
    id: String(apiCampaign.id),
    name: apiCampaign.name || "",
    description: [apiCampaign.client, apiCampaign.period, location].filter(Boolean).join(" - "),
    source: "campaign",
    createdAt: toIso(apiCampaign.createdAt) || nowIso(),
    updatedAt: toIso(apiCampaign.updatedAt) || nowIso(),
  };
}

export async function listLists() {
  const results = [];
  const seenCampaignIds = new Set();

  // 1) API OdDrive (fonte primária)
  try {
    const apiCampaigns = await fetchCampaigns();
    const apiDrivers = await fetchDrivers();
    const driversByCampaign = new Map();
    for (const d of apiDrivers) {
      if (!d.campaignId) continue;
      if (!driversByCampaign.has(d.campaignId)) driversByCampaign.set(d.campaignId, []);
      driversByCampaign.get(d.campaignId).push(d);
    }
    for (const campaign of apiCampaigns) {
      const drivers = driversByCampaign.get(campaign.id) || [];
      const contactIds = drivers.map(d => d.id);
      results.push({ ...apiCampaignToListBase(campaign), contactIds, contactsCount: contactIds.length });
      seenCampaignIds.add(campaign.id);
    }
  } catch (err) {
    console.warn("[bridge] Falha ao listar campanhas via API", err?.message || err);
  }

  // 2) Fallback: MongoDB campaigns (apenas IDs que não vieram da API)
  try {
    const d = await db();
    const campaigns = await d.collection("campaigns").find({}).toArray();
    for (const campaign of campaigns) {
      const cid = String(campaign._id);
      if (seenCampaignIds.has(cid)) continue;
      const driverDocs = await d
        .collection("drivers")
        .find({ campaign_id: campaign._id }, { projection: { _id: 1, driver_campaign_id: 1 } })
        .toArray();
      const contactIds = await activeDriverDocIds(cid, driverDocs);
      results.push({ ...campaignToListBase(campaign), contactIds, contactsCount: contactIds.length });
    }
  } catch {}

  // 3) Custom lists
  try {
    const d = await db();
    const customLists = await d.collection(LISTS_COL).find({}).toArray();
    for (const list of customLists) {
      const contactIds = Array.isArray(list.contactIds) ? list.contactIds : [];
      results.push({
        id: list._id || list.id,
        name: list.name || "",
        description: list.description || "",
        source: list.source || "custom",
        contactIds,
        contactsCount: contactIds.length,
        createdAt: list.createdAt || nowIso(),
        updatedAt: list.updatedAt || nowIso(),
      });
    }
  } catch {}

  return results;
}

export async function getListById(id) {
  // 1) API OdDrive (fonte primária)
  try {
    const apiCampaigns = await fetchCampaigns();
    const apiCampaign = apiCampaigns.find(c => c.id === id);
    if (apiCampaign) {
      const drivers = await fetchDriversByCampaign(id);
      return {
        ...apiCampaignToListBase(apiCampaign),
        contactIds: drivers.map(d => d.id),
        contactsCount: drivers.length,
      };
    }
  } catch (err) {
    console.warn("[bridge] Falha ao buscar campanha via API por ID", err?.message || err);
  }

  // 2) Fallback: MongoDB campaign
  try {
    const d = await db();
    const campaign = await d.collection("campaigns").findOne({ _id: id });
    if (campaign) {
      const driverDocs = await d
        .collection("drivers")
        .find({ campaign_id: campaign._id }, { projection: { _id: 1, driver_campaign_id: 1 } })
        .toArray();
      const contactIds = await activeDriverDocIds(campaign._id, driverDocs);
      return {
        ...campaignToListBase(campaign),
        contactIds,
        contactsCount: contactIds.length,
      };
    }
  } catch {}

  // 3) Custom list
  try {
    const d = await db();
    const custom = await d.collection(LISTS_COL).findOne({ _id: id });
    if (!custom) return null;
    const contactIds = Array.isArray(custom.contactIds) ? custom.contactIds : [];
    return {
      id: custom._id || custom.id,
      name: custom.name || "",
      description: custom.description || "",
      source: custom.source || "custom",
      contactIds,
      contactsCount: contactIds.length,
      createdAt: custom.createdAt || nowIso(),
      updatedAt: custom.updatedAt || nowIso(),
    };
  } catch {
    return null;
  }
}

export async function getListByName(name) {
  const normalizedName = String(name || "").trim().toLowerCase();
  if (!normalizedName) return null;

  // 1) API OdDrive (fonte primária — busca por nome)
  try {
    const apiCampaigns = await fetchCampaigns();
    const match = apiCampaigns.find(c =>
      (c.name || "").trim().toLowerCase() === normalizedName
    );
    if (match) {
      const drivers = await fetchDriversByCampaign(match.id);
      return {
        ...apiCampaignToListBase(match),
        contactIds: drivers.map(d => d.id),
        contactsCount: drivers.length,
      };
    }
  } catch (err) {
    console.warn("[bridge] Falha ao buscar campanha via API por nome", err?.message || err);
  }

  // 2) Fallback: MongoDB campaign by name
  try {
    const d = await db();
    const campaign = await d
      .collection("campaigns")
      .findOne({ name: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
    if (campaign) {
      const driverDocs = await d
        .collection("drivers")
        .find({ campaign_id: campaign._id }, { projection: { _id: 1, driver_campaign_id: 1 } })
        .toArray();
      const contactIds = await activeDriverDocIds(campaign._id, driverDocs);
      return {
        ...campaignToListBase(campaign),
        contactIds,
        contactsCount: contactIds.length,
      };
    }
  } catch {}

  // 3) Custom list by name
  try {
    const d = await db();
    const custom = await d
      .collection(LISTS_COL)
      .findOne({ name: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
    if (!custom) return null;
    const contactIds = Array.isArray(custom.contactIds) ? custom.contactIds : [];
    return {
      id: custom._id || custom.id,
      name: custom.name || "",
      description: custom.description || "",
      source: custom.source || "custom",
      contactIds,
      contactsCount: contactIds.length,
      createdAt: custom.createdAt || nowIso(),
      updatedAt: custom.updatedAt || nowIso(),
    };
  } catch {
    return null;
  }
}

// ── List write ─────────────────────────────────────────────────

export async function createList(input) {
  const { randomUUID } = await import("crypto");
  const id = randomUUID();
  const timestamp = nowIso();
  const doc = {
    _id: id,
    id,
    name: input.name,
    description: input.description || "",
    source: input.source || "manual",
    contactIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const d = await db();
  await d.collection(LISTS_COL).insertOne(doc);
  return { ...doc, contactsCount: 0 };
}

export async function addContactsToList(listId, contactIds) {
  const d = await db();

  // Only works on custom lists (campaign lists are read-only)
  const custom = await d.collection(LISTS_COL).findOne({ _id: listId });
  if (!custom) return null;

  const currentIds = new Set(Array.isArray(custom.contactIds) ? custom.contactIds : []);
  let added = 0;
  for (const cid of contactIds) {
    if (cid && !currentIds.has(cid)) {
      currentIds.add(cid);
      added += 1;
    }
  }
  const nextIds = [...currentIds];
  await d.collection(LISTS_COL).updateOne(
    { _id: listId },
    { $set: { contactIds: nextIds, updatedAt: nowIso() } },
  );
  return { list: { ...custom, contactIds: nextIds, id: custom._id }, added };
}

// ── Indexes ────────────────────────────────────────────────────

export async function ensureIndexes() {
  try {
    const d = await db();
    await d.collection(CONTACTS_COL).createIndex({ phoneE164: 1 });
    await d.collection(CONTACTS_COL).createIndex({ phoneDigits: 1 });
    await d.collection(LISTS_COL).createIndex({ name: 1 });
  } catch (_) {}
}
