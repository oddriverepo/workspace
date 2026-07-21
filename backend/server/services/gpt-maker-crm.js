import crypto from 'crypto';
import { getDb } from './mongoClient.js';

const CHAT_COLLECTION = 'gptmaker_crm_chats';
const INTERACTION_COLLECTION = 'gptmaker_crm_interactions';
const SYNC_COLLECTION = 'gptmaker_crm_sync_state';
const LOCK_COLLECTION = 'gptmaker_crm_sync_locks';

const DEFAULT_API_BASE = 'https://api.gptmaker.ai/v2';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_CACHE_TTL_MS = 90000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;
const LOCK_TTL_MS = 90000;
const RECENT_OVERLAP_MS = 5 * 60 * 1000;
const FORCE_COOLDOWN_MS = 30000;
const MAX_CACHE_ENTRIES = 120;
const PROFILE_IDENTITY_VERSION = 1;
const MAX_IDENTITY_GROUPS = 10000;

const responseCache = new Map();
const inFlight = new Map();
const lastForcedRefresh = new Map();

function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseJsonArray(value, fallback) {
  try {
    const parsed = value ? JSON.parse(value) : fallback;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readConfig() {
  const token = String(process.env.GPTMAKER_API_TOKEN || '').trim();
  const workspaceId = String(process.env.GPTMAKER_WORKSPACE_ID || '').trim();
  const agentId = String(process.env.GPTMAKER_AGENT_ID || '').trim();
  const rawBase = String(process.env.GPTMAKER_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
  const apiBase = /^https:\/\/api\.gptmaker\.ai\/v2$/i.test(rawBase) ? rawBase : DEFAULT_API_BASE;
  const channelTypes = parseJsonArray(process.env.GPTMAKER_INSTAGRAM_TYPES_JSON, [
    'instagram',
    'instagram_business',
    'instagram-direct',
    'instagram direct',
  ]).map(normalizeChannelValue).filter(Boolean);

  return {
    token,
    workspaceId,
    agentId,
    apiBase,
    channelTypes: new Set(channelTypes),
    timeoutMs: positiveInt(process.env.GPTMAKER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60000),
    cacheTtlMs: positiveInt(process.env.GPTMAKER_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS, 10 * 60 * 1000),
    pageSize: positiveInt(process.env.GPTMAKER_PAGE_SIZE, DEFAULT_PAGE_SIZE, 250),
    maxPages: positiveInt(process.env.GPTMAKER_MAX_PAGES, DEFAULT_MAX_PAGES, 200),
    configured: Boolean(token && workspaceId),
  };
}

export class GptMakerCrmError extends Error {
  constructor(message, { status = 502, code = 'GPTMAKER_CRM_ERROR' } = {}) {
    super(message);
    this.name = 'GptMakerCrmError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeChannelValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function normalizeProfileName(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9\s._-]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  if (!normalized || normalized.length < 2 || !/[a-z]/.test(normalized)) return '';
  const generic = new Set([
    'instagram', 'instagram user', 'usuario', 'usuario instagram', 'user',
    'unknown', 'desconhecido', 'sem nome', 'nao informado', 'null', 'undefined',
  ]);
  return generic.has(normalized) ? '' : normalized;
}

export function extractGptMakerProfileName(chat) {
  const candidates = [
    ['userName', chat?.userName],
    ['username', chat?.username],
    ['messageUserName', chat?.messageUserName],
    ['message_user_name', chat?.message_user_name],
    ['recipientName', chat?.recipientName],
    ['recipient.name', chat?.recipient?.name],
    ['metadata.userName', chat?.metadata?.userName],
    ['metadata.name', chat?.metadata?.name],
    ['name', chat?.name],
    ['title', chat?.title],
  ];
  const aliases = [];
  let primary = null;
  for (const [source, value] of candidates) {
    const name = normalizeProfileName(value);
    if (!name) continue;
    if (!primary) primary = { name, source };
    if (!aliases.includes(name)) aliases.push(name);
  }
  return primary ? { ...primary, aliases } : { name: '', source: '', aliases: [] };
}

export function isInstagramChat(chat, configuredTypes = []) {
  const values = [chat?.type, chat?.conversationType]
    .map(normalizeChannelValue)
    .filter(Boolean);
  const allowed = configuredTypes instanceof Set
    ? configuredTypes
    : new Set((configuredTypes || []).map(normalizeChannelValue));

  return values.some((value) => (
    value.includes('instagram')
    || value === 'ig'
    || allowed.has(value)
  ));
}

export function parseGptMakerTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'number' || /^\d+$/.test(String(value || '').trim())) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function mergeCoverageStart({ previous, oldest, exhausted, requestedFrom }) {
  const candidates = [previous, exhausted ? requestedFrom : null, oldest]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()));
  return candidates.length
    ? new Date(Math.min(...candidates.map((date) => date.getTime())))
    : null;
}

export function hasCombinedCoverage(chatCoverageFrom, interactionCoverageFrom, requestedFrom) {
  const chatDate = new Date(chatCoverageFrom || '');
  const interactionDate = new Date(interactionCoverageFrom || '');
  const requestedDate = new Date(requestedFrom || '');
  return Number.isFinite(chatDate.getTime())
    && Number.isFinite(interactionDate.getTime())
    && Number.isFinite(requestedDate.getTime())
    && chatDate <= requestedDate
    && interactionDate <= requestedDate;
}

export function resolveIncrementalSyncStart({
  covered,
  identityBackfillPending,
  previousSyncAt,
  requestedFrom,
  overlapMs = RECENT_OVERLAP_MS,
}) {
  const requestedDate = new Date(requestedFrom || '');
  const previousDate = new Date(previousSyncAt || '');
  if (
    covered
    && !identityBackfillPending
    && Number.isFinite(requestedDate.getTime())
    && Number.isFinite(previousDate.getTime())
  ) {
    return new Date(Math.max(
      requestedDate.getTime(),
      previousDate.getTime() - Math.max(0, Number(overlapMs) || 0),
    ));
  }
  return Number.isFinite(requestedDate.getTime()) ? requestedDate : null;
}

export function isForceRefreshAllowed({ requested, lastForcedAt, now = Date.now(), cooldownMs = FORCE_COOLDOWN_MS }) {
  if (!requested) return false;
  const previous = Number(lastForcedAt || 0);
  return !Number.isFinite(previous)
    || previous <= 0
    || now - previous >= Math.max(0, Number(cooldownMs) || 0);
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [payload?.items, payload?.data, payload?.results];
  return candidates.find(Array.isArray) || [];
}

async function fetchPage(resource, page, config) {
  const url = new URL(`${config.apiBase}/workspace/${encodeURIComponent(config.workspaceId)}/${resource}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(config.pageSize));
  if (config.agentId) url.searchParams.set('agentId', config.agentId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new GptMakerCrmError('O GPT Maker retornou uma resposta inválida.', {
        code: 'GPTMAKER_INVALID_RESPONSE',
      });
    }
    if (!response.ok || payload?.error) {
      throw new GptMakerCrmError('O GPT Maker recusou a consulta de conversas.', {
        status: response.status === 401 || response.status === 403 ? 503 : 502,
        code: response.status === 401 || response.status === 403
          ? 'GPTMAKER_INVALID_CREDENTIALS'
          : 'GPTMAKER_UPSTREAM_ERROR',
      });
    }
    return extractItems(payload);
  } catch (error) {
    if (error instanceof GptMakerCrmError) throw error;
    if (error?.name === 'AbortError') {
      throw new GptMakerCrmError('O GPT Maker demorou demais para responder.', {
        status: 504,
        code: 'GPTMAKER_TIMEOUT',
      });
    }
    throw new GptMakerCrmError('Não foi possível conectar à API do GPT Maker.', {
      code: 'GPTMAKER_CONNECTION_ERROR',
    });
  } finally {
    clearTimeout(timeout);
  }
}

function chatTimestamp(chat) {
  return parseGptMakerTimestamp(chat?.time)
    || parseGptMakerTimestamp(chat?.createdAt);
}

function interactionTimestamp(interaction) {
  return parseGptMakerTimestamp(interaction?.startAt)
    || parseGptMakerTimestamp(interaction?.transferAt)
    || parseGptMakerTimestamp(interaction?.resolvedAt);
}

function normalizeChat(chat, config, now) {
  const chatId = String(chat?.id || '').trim();
  const occurredAt = chatTimestamp(chat);
  if (!chatId || !occurredAt) return null;
  const createdAtSource = parseGptMakerTimestamp(chat?.createdAt);
  // Keep only normalized aliases needed for matching; messages and contact data are not persisted here.
  const profile = extractGptMakerProfileName(chat);
  return {
    workspaceId: config.workspaceId,
    chatId,
    agentId: String(chat?.agentId || ''),
    type: String(chat?.type || '').trim().slice(0, 80),
    conversationType: String(chat?.conversationType || '').trim().slice(0, 80),
    isInstagram: isInstagramChat(chat, config.channelTypes),
    occurredAt,
    acquisitionAt: createdAtSource || occurredAt,
    createdAtSource,
    profileNameNormalized: profile.name || null,
    profileNameAliases: profile.aliases,
    profileNameSource: profile.source || null,
    identityVersion: PROFILE_IDENTITY_VERSION,
    lastSeenAt: now,
    updatedAt: now,
  };
}

function normalizeInteraction(interaction, config, now) {
  const interactionId = String(interaction?.id || '').trim();
  const chatId = String(interaction?.chatId || '').trim();
  const startAt = interactionTimestamp(interaction);
  if (!interactionId || !chatId || !startAt) return null;
  return {
    workspaceId: config.workspaceId,
    interactionId,
    chatId,
    agentId: String(interaction?.agentId || '').trim().slice(0, 160),
    status: String(interaction?.status || '').trim().slice(0, 80),
    startAt,
    transferAt: parseGptMakerTimestamp(interaction?.transferAt),
    resolvedAt: parseGptMakerTimestamp(interaction?.resolvedAt),
    lastSeenAt: now,
    updatedAt: now,
  };
}

async function upsertDocuments(collection, documents, idField) {
  if (!documents.length) return;
  await collection.bulkWrite(documents.map((document) => ({
    updateOne: {
      filter: { workspaceId: document.workspaceId, [idField]: document[idField] },
      update: {
        $set: document,
        $setOnInsert: { insertedAt: new Date() },
      },
      upsert: true,
    },
  })), { ordered: false });
}

async function acquireLock(db, workspaceId) {
  const owner = crypto.randomUUID();
  const now = new Date();
  try {
    const result = await db.collection(LOCK_COLLECTION).findOneAndUpdate(
      { _id: `gptmaker-crm:${workspaceId}`, $or: [{ expiresAt: { $lte: now } }, { owner }] },
      { $set: { owner, expiresAt: new Date(now.getTime() + LOCK_TTL_MS), updatedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    const document = result?.value || result;
    return document?.owner === owner ? owner : null;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function releaseLock(db, workspaceId, owner) {
  if (!owner) return;
  await db.collection(LOCK_COLLECTION)
    .deleteOne({ _id: `gptmaker-crm:${workspaceId}`, owner })
    .catch(() => {});
}

async function syncResource({ db, resource, config, stopBefore, normalize, collection, idField }) {
  let pages = 0;
  let imported = 0;
  let oldest = null;
  let newest = null;
  let exhausted = false;

  for (let page = 1; page <= config.maxPages; page += 1) {
    const items = await fetchPage(resource, page, config);
    pages += 1;
    const now = new Date();
    const documents = items.map((item) => normalize(item, config, now)).filter(Boolean);
    await upsertDocuments(collection, documents, idField);
    imported += documents.length;

    for (const document of documents) {
      const timestamp = document.startAt || document.occurredAt;
      if (!oldest || timestamp < oldest) oldest = timestamp;
      if (!newest || timestamp > newest) newest = timestamp;
    }

    // Some API plans cap pageSize below the requested value. Only an empty page
    // proves exhaustion; otherwise stopping here could silently undercount chats.
    if (items.length === 0) {
      exhausted = true;
      break;
    }
    if (oldest && oldest.getTime() <= stopBefore.getTime()) break;
  }

  return { pages, imported, oldest, newest, exhausted };
}

async function synchronize(db, config, fromDate, toDate, force) {
  const state = await db.collection(SYNC_COLLECTION).findOne({ workspaceId: config.workspaceId });
  const fresh = state?.lastSyncAt
    && Date.now() - new Date(state.lastSyncAt).getTime() < config.cacheTtlMs;
  const previousChatCoverage = state?.chatCoverageFrom || state?.coverageFrom || null;
  const previousInteractionCoverage = state?.interactionCoverageFrom || state?.coverageFrom || null;
  const covered = hasCombinedCoverage(previousChatCoverage, previousInteractionCoverage, fromDate);
  const endExclusive = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
  const identityBackfillPending = await db.collection(CHAT_COLLECTION).countDocuments({
    workspaceId: config.workspaceId,
    isInstagram: true,
    acquisitionAt: { $gte: fromDate, $lt: endExclusive },
    identityVersion: { $ne: PROFILE_IDENTITY_VERSION },
  }, { limit: 1 }) > 0;
  const periodIsHistorical = new Date(toDate.getTime() + 24 * 60 * 60 * 1000).getTime() <= Date.now();
  if (!force && !identityBackfillPending && covered && (fresh || periodIsHistorical)) {
    return { synchronized: false, apiCalls: 0, imported: 0 };
  }

  const owner = await acquireLock(db, config.workspaceId);
  if (!owner) return { synchronized: false, apiCalls: 0, imported: 0, sharedSync: true };

  try {
    const previousSyncAt = state?.lastSyncAt ? new Date(state.lastSyncAt) : null;
    const stopBefore = resolveIncrementalSyncStart({
      covered,
      identityBackfillPending,
      previousSyncAt,
      requestedFrom: fromDate,
    });
    const chats = await syncResource({
      db,
      resource: 'chats',
      config,
      stopBefore,
      normalize: normalizeChat,
      collection: db.collection(CHAT_COLLECTION),
      idField: 'chatId',
    });
    const interactions = await syncResource({
      db,
      resource: 'interactions',
      config,
      stopBefore,
      normalize: normalizeInteraction,
      collection: db.collection(INTERACTION_COLLECTION),
      idField: 'interactionId',
    });
    const chatCoverageFrom = mergeCoverageStart({
      previous: previousChatCoverage,
      oldest: chats.oldest,
      exhausted: chats.exhausted,
      requestedFrom: fromDate,
    });
    const interactionCoverageFrom = mergeCoverageStart({
      previous: previousInteractionCoverage,
      oldest: interactions.oldest,
      exhausted: interactions.exhausted,
      requestedFrom: fromDate,
    });
    const coverageFrom = chatCoverageFrom && interactionCoverageFrom
      ? new Date(Math.max(chatCoverageFrom.getTime(), interactionCoverageFrom.getTime()))
      : null;
    const coverageComplete = hasCombinedCoverage(chatCoverageFrom, interactionCoverageFrom, fromDate);
    const now = new Date();
    await db.collection(SYNC_COLLECTION).updateOne(
      { workspaceId: config.workspaceId },
      {
        $set: {
          workspaceId: config.workspaceId,
          lastSyncAt: now,
          coverageFrom,
          chatCoverageFrom,
          interactionCoverageFrom,
          lastApiCalls: chats.pages + interactions.pages,
          lastImported: chats.imported + interactions.imported,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    return {
      synchronized: true,
      apiCalls: chats.pages + interactions.pages,
      imported: chats.imported + interactions.imported,
      coverageComplete,
    };
  } finally {
    await releaseLock(db, config.workspaceId, owner);
  }
}

async function summarizeFromMongo(db, config, fromDate, toDate, syncResult) {
  const endExclusive = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
  const [chatRows, interactionRows, identityRows] = await Promise.all([
    db.collection(CHAT_COLLECTION).aggregate([
      {
        $match: {
          workspaceId: config.workspaceId,
          isInstagram: true,
          acquisitionAt: { $gte: fromDate, $lt: endExclusive },
        },
      },
      {
        $group: {
          _id: null,
          conversations: { $sum: 1 },
          firstConversationAt: { $min: '$acquisitionAt' },
          lastConversationAt: { $max: '$acquisitionAt' },
        },
      },
    ]).toArray(),
    db.collection(INTERACTION_COLLECTION).aggregate([
      { $match: { workspaceId: config.workspaceId, startAt: { $gte: fromDate, $lt: endExclusive } } },
      {
        $lookup: {
          from: CHAT_COLLECTION,
          let: { workspaceId: '$workspaceId', chatId: '$chatId' },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ['$workspaceId', '$$workspaceId'] },
              { $eq: ['$chatId', '$$chatId'] },
            ] } } },
            { $project: { _id: 0, isInstagram: 1 } },
          ],
          as: 'chat',
        },
      },
      { $unwind: '$chat' },
      { $match: { 'chat.isInstagram': true } },
      {
        $group: {
          _id: null,
          interactions: { $sum: 1 },
        },
      },
    ]).toArray(),
    db.collection(CHAT_COLLECTION).aggregate([
      {
        $match: {
          workspaceId: config.workspaceId,
          isInstagram: true,
          acquisitionAt: { $gte: fromDate, $lt: endExclusive },
          'profileNameAliases.0': { $exists: true },
        },
      },
      { $sort: { acquisitionAt: 1, chatId: 1 } },
      { $limit: MAX_IDENTITY_GROUPS + 1 },
      {
        $project: {
          _id: 0,
          profileName: '$profileNameNormalized',
          profileNames: '$profileNameAliases',
          firstContactAt: '$acquisitionAt',
          lastContactAt: '$occurredAt',
          chatCount: { $literal: 1 },
        },
      },
    ]).toArray(),
  ]);
  const chatSummary = chatRows[0] || {};
  const interactionSummary = interactionRows[0] || {};
  const syncState = await db.collection(SYNC_COLLECTION).findOne(
    { workspaceId: config.workspaceId },
    {
      projection: {
        _id: 0,
        lastSyncAt: 1,
        coverageFrom: 1,
        chatCoverageFrom: 1,
        interactionCoverageFrom: 1,
      },
    },
  );
  const chatCoverageFrom = syncState?.chatCoverageFrom || syncState?.coverageFrom || null;
  const interactionCoverageFrom = syncState?.interactionCoverageFrom || syncState?.coverageFrom || null;
  const coverageComplete = hasCombinedCoverage(chatCoverageFrom, interactionCoverageFrom, fromDate);
  const identitiesTruncated = identityRows.length > MAX_IDENTITY_GROUPS;
  const identities = identitiesTruncated ? identityRows.slice(0, MAX_IDENTITY_GROUPS) : identityRows;
  const namedChats = identities.reduce((total, item) => total + Number(item.chatCount || 0), 0);
  return {
    configured: true,
    available: true,
    provider: 'gptmaker',
    scope: config.agentId ? 'agent' : 'workspace',
    conversations: Number(chatSummary.conversations || 0),
    interactions: Number(interactionSummary.interactions || 0),
    firstConversationAt: chatSummary.firstConversationAt || null,
    lastConversationAt: chatSummary.lastConversationAt || null,
    identities,
    identityCoverage: {
      namedProfiles: identities.length,
      namedChats,
      unnamedChats: Math.max(0, Number(chatSummary.conversations || 0) - namedChats),
      truncated: identitiesTruncated,
    },
    freshness: {
      source: syncResult.synchronized ? 'gptmaker' : 'mongodb',
      synchronized: Boolean(syncResult.synchronized),
      sharedSync: Boolean(syncResult.sharedSync),
      apiCalls: Number(syncResult.apiCalls || 0),
      imported: Number(syncResult.imported || 0),
      refreshedAt: syncState?.lastSyncAt || null,
      coverageFrom: syncState?.coverageFrom || null,
      chatCoverageFrom,
      interactionCoverageFrom,
      coverageComplete,
      updateMode: 'on-demand',
    },
  };
}

function cacheGet(key, ttlMs) {
  const entry = responseCache.get(key);
  if (!entry || Date.now() - entry.createdAt >= ttlMs) {
    if (entry) responseCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  responseCache.set(key, { value, createdAt: Date.now() });
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

export function getGptMakerCrmStatus() {
  const config = readConfig();
  return {
    configured: config.configured,
    provider: 'gptmaker',
    scope: config.agentId ? 'agent' : 'workspace',
    updateMode: 'on-demand',
  };
}

export async function getGptMakerInstagramSummary({ from, to, force = false }) {
  const config = readConfig();
  if (!config.configured) {
    return {
      configured: false,
      available: false,
      provider: 'gptmaker',
      conversations: null,
      interactions: null,
      code: 'GPTMAKER_NOT_CONFIGURED',
    };
  }
  const fromDate = new Date(`${from}T00:00:00-03:00`);
  const toDate = new Date(`${to}T00:00:00-03:00`);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || fromDate > toDate) {
    throw new GptMakerCrmError('O período informado é inválido.', {
      status: 400,
      code: 'GPTMAKER_INVALID_PERIOD',
    });
  }

  const key = `${config.workspaceId}:${from}:${to}`;
  if (force) {
    const now = Date.now();
    const lastForcedAt = lastForcedRefresh.get(key) || 0;
    if (!isForceRefreshAllowed({ requested: true, lastForcedAt, now })) {
      force = false;
    } else {
      lastForcedRefresh.delete(key);
      lastForcedRefresh.set(key, now);
      while (lastForcedRefresh.size > MAX_CACHE_ENTRIES) {
        lastForcedRefresh.delete(lastForcedRefresh.keys().next().value);
      }
    }
  }
  if (!force) {
    const cached = cacheGet(key, config.cacheTtlMs);
    if (cached) return { ...cached, freshness: { ...cached.freshness, source: 'memory-cache', apiCalls: 0 } };
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const db = await getDb();
    const syncResult = await synchronize(db, config, fromDate, toDate, force);
    const result = await summarizeFromMongo(db, config, fromDate, toDate, syncResult);
    cacheSet(key, result);
    return result;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function ensureGptMakerCrmIndexes() {
  const db = await getDb();
  await Promise.all([
    db.collection(CHAT_COLLECTION).createIndex(
      { workspaceId: 1, chatId: 1 },
      { unique: true, background: true },
    ),
    db.collection(CHAT_COLLECTION).createIndex(
      { workspaceId: 1, isInstagram: 1, acquisitionAt: -1 },
      { background: true },
    ),
    db.collection(CHAT_COLLECTION).createIndex(
      { workspaceId: 1, isInstagram: 1, profileNameAliases: 1, acquisitionAt: 1 },
      { background: true },
    ),
    db.collection(INTERACTION_COLLECTION).createIndex(
      { workspaceId: 1, interactionId: 1 },
      { unique: true, background: true },
    ),
    db.collection(INTERACTION_COLLECTION).createIndex(
      { workspaceId: 1, startAt: -1, chatId: 1 },
      { background: true },
    ),
    db.collection(SYNC_COLLECTION).createIndex(
      { workspaceId: 1 },
      { unique: true, background: true },
    ),
    db.collection(LOCK_COLLECTION).createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true },
    ),
  ]);
}
