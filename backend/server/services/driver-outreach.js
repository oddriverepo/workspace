import { randomUUID } from 'crypto';

import { env as disparadorEnv } from '../disparador/config.js';
import { findMessageByMetaId } from '../disparador/services/mongo/inbox.repo.js';
import { sendTemplateMessage, sendTextMessage } from '../disparador/services/meta-client.js';
import { addInboxMessage, getTemplateById } from '../disparador/store/memory-store.js';
import { buildTemplateSnapshot, renderTemplateMessageText } from '../disparador/utils/template-render.js';
import { normalizePhone } from '../disparador/utils/phone.js';
import { fetchCampaignById, fetchDriverById, findDriverByPhone } from './db.js';
import { getDb } from './mongo.js';

const COL = 'driver_campaign_outreach';
const POLICY_COL = 'driver_contact_policy';
const WORKSPACE_OUTREACH_CAMPAIGN_ID = '__motoristas__';
const WORKSPACE_OUTREACH_CAMPAIGN_NAME = 'Motoristas / Sem campanha';
const SERVICE_WINDOW_HOURS = 24;
const AUTO_COOLDOWN_HOURS = {
  '130429': 2,
  '80007': 2,
  '131048': 12,
  '131056': 6,
  '131049': 24,
};

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function collection() {
  const db = await getDb();
  return db.collection(COL);
}

async function policyCollection() {
  const db = await getDb();
  return db.collection(POLICY_COL);
}

function withId(row) {
  if (!row) return null;
  return { ...row, id: row._id };
}

function resolveDriverId(driver) {
  return String(driver?.id || driver?._id || '').trim();
}

function resolveCampaignId(campaign) {
  return String(campaign?.id || campaign?._id || '').trim();
}

function isWorkspaceOutreachCampaignId(campaignId) {
  return String(campaignId || '').trim() === WORKSPACE_OUTREACH_CAMPAIGN_ID;
}

function resolveOutreachCampaignName(campaignId, name = '') {
  const resolvedCampaignId = String(campaignId || '').trim();
  const resolvedName = String(name || '').trim();
  if (isWorkspaceOutreachCampaignId(resolvedCampaignId)) {
    return WORKSPACE_OUTREACH_CAMPAIGN_NAME;
  }
  return resolvedName || resolvedCampaignId;
}

function toDateMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function pickLatestIso(current, candidate) {
  const normalizedCandidate = String(candidate || '').trim();
  if (!normalizedCandidate) return String(current || '').trim();

  const normalizedCurrent = String(current || '').trim();
  if (!normalizedCurrent) return normalizedCandidate;

  return toDateMs(normalizedCandidate) > toDateMs(normalizedCurrent)
    ? normalizedCandidate
    : normalizedCurrent;
}

function pickEarliestIso(current, candidate) {
  const normalizedCandidate = String(candidate || '').trim();
  if (!normalizedCandidate) return String(current || '').trim();

  const normalizedCurrent = String(current || '').trim();
  if (!normalizedCurrent) return normalizedCandidate;

  return toDateMs(normalizedCandidate) < toDateMs(normalizedCurrent)
    ? normalizedCandidate
    : normalizedCurrent;
}

function addHoursIso(value, hours) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.valueOf())) return '';
  date.setHours(date.getHours() + Number(hours || 0));
  return date.toISOString();
}

function asBooleanFlag(value) {
  if (typeof value === 'string') {
    return ['1', 'true', 'sim', 'yes', 'on'].includes(normalizeText(value));
  }
  return value === true || value === 1;
}

function normalizeIsoDateTime(value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.valueOf())) return '';
  return date.toISOString();
}

function normalizeOptInStatus(value) {
  const normalizedValue = normalizeText(value);
  if (normalizedValue === 'granted' || normalizedValue === 'confirmado' || normalizedValue === 'confirmed') {
    return 'granted';
  }
  if (normalizedValue === 'revoked' || normalizedValue === 'revogado' || normalizedValue === 'opt-out' || normalizedValue === 'optout') {
    return 'revoked';
  }
  return 'unknown';
}

export function createEmptyDriverContactPolicy(driverId = '') {
  return {
    driverId: String(driverId || '').trim(),
    optInStatus: 'unknown',
    optInSource: '',
    optInCapturedAt: '',
    optInNotes: '',
    contactBlocked: false,
    contactBlockReason: '',
    marketingOptOut: false,
    marketingOptOutReason: '',
    cooldownUntil: '',
    cooldownReason: '',
    updatedAt: '',
    updatedBy: '',
  };
}

function normalizeDriverContactPolicy(policy = {}, fallback = {}) {
  const normalizedDriverId = String(policy.driverId || policy._id || fallback.driverId || '').trim();
  const normalized = createEmptyDriverContactPolicy(normalizedDriverId);

  normalized.optInStatus = normalizeOptInStatus(policy.optInStatus ?? fallback.optInStatus);
  normalized.optInSource = String(policy.optInSource ?? fallback.optInSource ?? '').trim();
  normalized.optInCapturedAt = normalizeIsoDateTime(policy.optInCapturedAt ?? fallback.optInCapturedAt);
  normalized.optInNotes = String(policy.optInNotes ?? fallback.optInNotes ?? '').trim();
  normalized.contactBlocked = asBooleanFlag(policy.contactBlocked ?? fallback.contactBlocked);
  normalized.contactBlockReason = String(policy.contactBlockReason ?? fallback.contactBlockReason ?? '').trim();
  normalized.marketingOptOut = asBooleanFlag(policy.marketingOptOut ?? fallback.marketingOptOut);
  normalized.marketingOptOutReason = String(policy.marketingOptOutReason ?? fallback.marketingOptOutReason ?? '').trim();
  normalized.cooldownUntil = normalizeIsoDateTime(policy.cooldownUntil ?? fallback.cooldownUntil);
  normalized.cooldownReason = String(policy.cooldownReason ?? fallback.cooldownReason ?? '').trim();
  normalized.updatedAt = normalizeIsoDateTime(policy.updatedAt ?? fallback.updatedAt);
  normalized.updatedBy = String(policy.updatedBy ?? fallback.updatedBy ?? '').trim();

  if (!normalized.contactBlocked) {
    normalized.contactBlockReason = '';
  }
  if (!normalized.marketingOptOut) {
    normalized.marketingOptOutReason = '';
  }
  if (!normalized.cooldownUntil) {
    normalized.cooldownReason = '';
  }

  return normalized;
}

function isPolicyCooldownActive(policy = {}) {
  const cooldownUntil = normalizeIsoDateTime(policy.cooldownUntil);
  return Boolean(cooldownUntil && toDateMs(cooldownUntil) > Date.now());
}

export async function listDriverContactPolicies(driverIds = []) {
  const normalizedIds = [...new Set(driverIds.map((item) => String(item || '').trim()).filter(Boolean))];
  if (!normalizedIds.length) return new Map();

  const policy = await policyCollection();
  const rows = await policy.find({ driverId: { $in: normalizedIds } }).toArray();
  const map = new Map(normalizedIds.map((driverId) => [driverId, createEmptyDriverContactPolicy(driverId)]));

  rows.forEach((row) => {
    const normalized = normalizeDriverContactPolicy(row, { driverId: row.driverId || row._id });
    if (normalized.driverId) {
      map.set(normalized.driverId, normalized);
    }
  });

  return map;
}

export async function getDriverContactPolicy(driverId) {
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedDriverId) {
    return createEmptyDriverContactPolicy();
  }

  const policy = await policyCollection();
  const row = await policy.findOne({ driverId: normalizedDriverId }) || await policy.findOne({ _id: normalizedDriverId });
  if (!row) {
    return createEmptyDriverContactPolicy(normalizedDriverId);
  }

  return normalizeDriverContactPolicy(row, { driverId: normalizedDriverId });
}

export async function updateDriverContactPolicy(driverId, updates = {}, meta = {}) {
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedDriverId) {
    throw new Error('Driver ID is required to update contact policy.');
  }

  const current = await getDriverContactPolicy(normalizedDriverId);
  const timestamp = nowIso();
  const next = normalizeDriverContactPolicy({
    ...current,
    ...updates,
    driverId: normalizedDriverId,
    updatedAt: timestamp,
    updatedBy: String(meta.updatedBy || current.updatedBy || '').trim(),
  }, current);

  const policy = await policyCollection();
  await policy.updateOne(
    { driverId: normalizedDriverId },
    {
      $set: {
        ...next,
        driverId: normalizedDriverId,
      },
      $setOnInsert: {
        _id: normalizedDriverId,
      },
    },
    { upsert: true },
  );

  return next;
}

export async function applyDriverGlobalOptOut(driverId, details = {}) {
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedDriverId) return null;

  const templateName = String(details.templateName || '').trim();
  const branchLabel = String(details.branchLabel || '').trim();
  const clickedAt = normalizeIsoDateTime(details.clickedAt) || nowIso();
  const reason = [
    'Opt-out automatico do motorista.',
    templateName ? `Template: ${templateName}.` : '',
    branchLabel ? `Opcao: ${branchLabel}.` : '',
    details.reason ? String(details.reason).trim() : '',
  ].filter(Boolean).join(' ');

  return updateDriverContactPolicy(normalizedDriverId, {
    marketingOptOut: true,
    marketingOptOutReason: reason,
    updatedAt: clickedAt,
  }, {
    updatedBy: String(details.updatedBy || 'system:template-opt-out').trim() || 'system:template-opt-out',
  });
}

async function applyAutomaticPolicyEffects(driverId, errorCode, errorMessage) {
  const normalizedDriverId = String(driverId || '').trim();
  const normalizedCode = String(errorCode || '').trim();
  if (!normalizedDriverId || !normalizedCode) return null;

  const cooldownHours = AUTO_COOLDOWN_HOURS[normalizedCode];
  if (!cooldownHours) return null;

  return updateDriverContactPolicy(normalizedDriverId, {
    cooldownUntil: addHoursIso(nowIso(), cooldownHours),
    cooldownReason: String(errorMessage || '').trim() || `Cooldown automatico apos erro ${normalizedCode}.`,
  }, {
    updatedBy: 'system:auto-policy',
  });
}

function buildDocId(driverId, campaignId) {
  return `${String(driverId || '').trim()}:${String(campaignId || '').trim()}`;
}

function resolveDriverPhone(driver = {}) {
  const raw = driver.raw || {};
  const candidate =
    driver.phone ||
    raw['Numero'] ||
    raw['Numero '] ||
    raw['Número'] ||
    raw.numero ||
    raw.número ||
    raw.telefone ||
    raw.Telefone ||
    raw.whatsapp ||
    raw.WhatsApp ||
    raw.Whatsapp ||
    '';
  return normalizePhone(candidate);
}

function buildDriverSnapshot(driver = {}, fallback = {}) {
  return {
    id: resolveDriverId(driver) || String(fallback.id || '').trim(),
    name: String(driver.name || fallback.name || '').trim(),
    phone: resolveDriverPhone(driver) || String(fallback.phone || '').trim(),
    city: String(driver.address?.city || driver.city || fallback.city || '').trim(),
    state: String(driver.address?.state || driver.state || fallback.state || '').trim(),
    plate: String(driver.plate || fallback.plate || '').trim(),
    model: String(driver.model || driver.campaignData?.vehicleModel || driver.raw?.['Modelo'] || fallback.model || '').trim(),
    email: String(driver.email || fallback.email || '').trim(),
  };
}

function buildCampaignSnapshot(campaign = {}, fallback = {}) {
  const resolvedCampaignId = resolveCampaignId(campaign) || String(fallback.id || '').trim();
  return {
    id: resolvedCampaignId,
    name: resolveOutreachCampaignName(resolvedCampaignId, campaign.name || fallback.name || ''),
    city: String(campaign.apiData?.city || campaign.city || fallback.city || '').trim(),
    state: String(campaign.apiData?.state || campaign.state || fallback.state || '').trim(),
    status: String(campaign.status || fallback.status || '').trim(),
    period: String(campaign.period || fallback.period || '').trim(),
  };
}

function createBaseDoc({ driver, campaign, driverId, campaignId }) {
  const timestamp = nowIso();
  const resolvedDriverId = String(driverId || resolveDriverId(driver)).trim();
  const resolvedCampaignId = String(campaignId || resolveCampaignId(campaign)).trim();
  return {
    id: buildDocId(resolvedDriverId, resolvedCampaignId),
    driverId: resolvedDriverId,
    campaignId: resolvedCampaignId,
    driverSnapshot: buildDriverSnapshot(driver, { id: resolvedDriverId }),
    campaignSnapshot: buildCampaignSnapshot(campaign, { id: resolvedCampaignId }),
    invitation: {
      status: 'not_sent',
      decision: '',
      lastInviteAt: '',
      lastInviteMessageId: '',
      lastInviteMetaMessageId: '',
      lastInviteKind: '',
      lastDeliveryStatus: '',
      responseAt: '',
      responseText: '',
      responseMessageId: '',
      responseMetaMessageId: '',
      lastFlowStatus: '',
      lastFlowBranchLabel: '',
      lastFlowStatusValue: '',
    },
    communication: {
      totalEvents: 0,
      totalOutbound: 0,
      totalInbound: 0,
      totalInvites: 0,
      lastOutboundAt: '',
      lastInboundAt: '',
      lastMessageAt: '',
      lastMessageText: '',
      lastMessageDirection: '',
      lastMessageType: '',
    },
    latestActivityAt: timestamp,
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function extractMetaMessageId(metaResponse = {}) {
  const messages = Array.isArray(metaResponse?.messages) ? metaResponse.messages : [];
  return String(messages[0]?.id || '').trim();
}

function isMetaConfigured() {
  return Boolean(disparadorEnv.metaSystemUserToken && disparadorEnv.metaPhoneNumberId);
}

function getOutreachPayload(outreach) {
  if (!outreach || typeof outreach !== 'object') return null;
  const driverId = String(outreach.driverId || '').trim();
  const campaignId = String(outreach.campaignId || '').trim();
  if (!driverId || !campaignId) return null;

  return {
    driverId,
    campaignId,
    isInvite: outreach.isInvite === true,
    trackAsInvite: outreach.trackAsInvite === true,
    dispatchScope: String(outreach.dispatchScope || '').trim() || 'manual',
  };
}

export function buildForwardedOutreachPayload(sourceMessage) {
  const outreach = getOutreachPayload(sourceMessage?.payload?.outreach);
  if (!outreach) return null;
  return {
    ...outreach,
    trackAsInvite: false,
    dispatchScope: 'od_flow',
  };
}

function flattenCandidates(values) {
  const list = [];
  values.forEach((value) => {
    if (Array.isArray(value)) {
      list.push(...flattenCandidates(value));
      return;
    }
    if (value === null || value === undefined) return;
    list.push(String(value));
  });
  return list;
}

function classifyInviteDecision(...candidates) {
  const tokens = flattenCandidates(candidates)
    .map((value) => normalizeText(value))
    .filter(Boolean);

  if (!tokens.length) return '';

  const acceptedPatterns = [
    'aceit',
    'quero participar',
    'tenho interesse',
    'interesse',
    'confirm',
    'sim',
    'topo',
  ];
  const declinedPatterns = [
    'nao quero',
    'não quero',
    'nao tenho interesse',
    'não tenho interesse',
    'sem interesse',
    'recus',
    'cancel',
    'nao posso',
    'não posso',
    'desist',
  ];

  if (tokens.some((token) => declinedPatterns.some((pattern) => token.includes(normalizeText(pattern))))) {
    return 'declined';
  }
  if (tokens.some((token) => acceptedPatterns.some((pattern) => token.includes(normalizeText(pattern))))) {
    return 'accepted';
  }
  return 'responded';
}

function decisionToInvitationStatus(decision) {
  if (decision === 'accepted') return 'accepted';
  if (decision === 'declined') return 'declined';
  if (decision === 'responded') return 'responded';
  return '';
}

function mapDeliveryToInvitationStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'sent') return 'sent';
  if (value === 'delivered') return 'delivered';
  if (value === 'read') return 'read';
  if (value === 'failed') return 'failed';
  if (value === 'simulated') return 'simulated';
  return '';
}

function isPendingInvitationStatus(status) {
  return ['sent', 'delivered', 'read', 'simulated'].includes(String(status || '').trim().toLowerCase());
}

function subtractDaysIso(value, days) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.valueOf())) return '';
  date.setDate(date.getDate() - Number(days || 0));
  return date.toISOString();
}

function isTerminalInvitationStatus(status) {
  return status === 'accepted' || status === 'declined';
}

function sortEvents(events) {
  return events.sort((left, right) => {
    const leftAt = String(left?.at || '');
    const rightAt = String(right?.at || '');
    if (leftAt === rightAt) {
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    }
    return leftAt.localeCompare(rightAt);
  });
}

function rebuildDocState(doc) {
  const events = sortEvents(Array.isArray(doc.events) ? [...doc.events] : []);
  const invitation = {
    status: 'not_sent',
    decision: '',
    lastInviteAt: '',
    lastInviteMessageId: '',
    lastInviteMetaMessageId: '',
    lastInviteKind: '',
    lastDeliveryStatus: '',
    responseAt: '',
    responseText: '',
    responseMessageId: '',
    responseMetaMessageId: '',
    lastFlowStatus: '',
    lastFlowBranchLabel: '',
    lastFlowStatusValue: '',
  };
  const communication = {
    totalEvents: events.length,
    totalOutbound: 0,
    totalInbound: 0,
    totalInvites: 0,
    lastOutboundAt: '',
    lastInboundAt: '',
    lastMessageAt: '',
    lastMessageText: '',
    lastMessageDirection: '',
    lastMessageType: '',
  };

  let latestActivityAt = String(doc.latestActivityAt || doc.updatedAt || doc.createdAt || nowIso());

  events.forEach((event) => {
    const eventAt = String(event.at || '').trim() || latestActivityAt;
    if (!latestActivityAt || eventAt > latestActivityAt) {
      latestActivityAt = eventAt;
    }

    if (event.direction === 'outbound') {
      communication.totalOutbound += 1;
      communication.lastOutboundAt = eventAt;
    }
    if (event.direction === 'inbound') {
      communication.totalInbound += 1;
      communication.lastInboundAt = eventAt;
    }
    if (event.direction === 'outbound' || event.direction === 'inbound') {
      communication.lastMessageAt = eventAt;
      communication.lastMessageText = String(event.text || '').trim();
      communication.lastMessageDirection = String(event.direction || '').trim();
      communication.lastMessageType = String(event.type || '').trim();
    }

    if (event.type === 'invite.sent' && event.tracksInvitation === true) {
      communication.totalInvites += 1;
      invitation.status = mapDeliveryToInvitationStatus(event.deliveryStatus || 'sent') || 'sent';
      invitation.decision = '';
      invitation.lastInviteAt = eventAt;
      invitation.lastInviteMessageId = String(event.messageId || '').trim();
      invitation.lastInviteMetaMessageId = String(event.metaMessageId || '').trim();
      invitation.lastInviteKind = String(event.kind || '').trim();
      invitation.lastDeliveryStatus = String(event.deliveryStatus || '').trim();
      invitation.responseAt = '';
      invitation.responseText = '';
      invitation.responseMessageId = '';
      invitation.responseMetaMessageId = '';
      invitation.lastFlowStatus = '';
      invitation.lastFlowBranchLabel = '';
      invitation.lastFlowStatusValue = '';
      return;
    }

    if (event.type === 'message.status' && event.tracksInvitation === true) {
      const mappedStatus = mapDeliveryToInvitationStatus(event.deliveryStatus || event.status || '');
      invitation.lastDeliveryStatus = String(event.deliveryStatus || event.status || '').trim();
      if (mappedStatus && !invitation.decision && !isTerminalInvitationStatus(invitation.status)) {
        invitation.status = mappedStatus;
      }
      return;
    }

    if (event.type === 'invite.response' && event.tracksInvitation === true) {
      const decision = String(event.decision || '').trim() || 'responded';
      invitation.decision = decision;
      invitation.status = decisionToInvitationStatus(decision) || invitation.status;
      invitation.responseAt = eventAt;
      invitation.responseText = String(event.text || '').trim();
      invitation.responseMessageId = String(event.messageId || '').trim();
      invitation.responseMetaMessageId = String(event.metaMessageId || '').trim();
      return;
    }

    if (event.type === 'flow.run') {
      invitation.lastFlowStatus = String(event.runStatus || '').trim();
      invitation.lastFlowBranchLabel = String(event.branchLabel || '').trim();
      invitation.lastFlowStatusValue = String(event.statusValue || '').trim();
      if (event.tracksInvitation === true) {
        const decision = String(event.decision || '').trim();
        if (decision) {
          invitation.decision = decision;
          invitation.status = decisionToInvitationStatus(decision) || invitation.status;
        }
      }
    }
  });

  return {
    ...doc,
    events,
    invitation,
    communication,
    latestActivityAt,
  };
}

async function findDoc(driverId, campaignId) {
  const c = await collection();
  return withId(await c.findOne({ _id: buildDocId(driverId, campaignId) }));
}

async function replaceDoc(doc) {
  const c = await collection();
  await c.replaceOne({ _id: doc.id }, { _id: doc.id, ...doc }, { upsert: true });
  return doc;
}

async function loadOrCreateDoc({ driver, campaign, driverId, campaignId }) {
  const resolvedDriverId = String(driverId || resolveDriverId(driver)).trim();
  const resolvedCampaignId = String(campaignId || resolveCampaignId(campaign)).trim();
  let doc = await findDoc(resolvedDriverId, resolvedCampaignId);

  if (!doc) {
    doc = createBaseDoc({ driver, campaign, driverId: resolvedDriverId, campaignId: resolvedCampaignId });
    await replaceDoc(doc);
    return doc;
  }

  doc.driverSnapshot = buildDriverSnapshot(driver, doc.driverSnapshot || { id: resolvedDriverId });
  doc.campaignSnapshot = buildCampaignSnapshot(campaign, doc.campaignSnapshot || { id: resolvedCampaignId });
  return doc;
}

async function appendEvent({ driver, campaign, driverId, campaignId, event }) {
  const doc = await loadOrCreateDoc({ driver, campaign, driverId, campaignId });
  const dedupeKey = String(event?.dedupeKey || '').trim();
  if (dedupeKey && Array.isArray(doc.events) && doc.events.some((item) => item?.dedupeKey === dedupeKey)) {
    return doc;
  }

  doc.events = Array.isArray(doc.events) ? [...doc.events] : [];
  doc.events.push({
    id: String(event?.id || randomUUID()).trim(),
    at: String(event?.at || nowIso()).trim(),
    ...event,
  });

  const rebuilt = rebuildDocState(doc);
  rebuilt.updatedAt = nowIso();
  await replaceDoc(rebuilt);
  return rebuilt;
}

async function findDocByMetaMessageId(metaMessageId) {
  const normalizedMetaMessageId = String(metaMessageId || '').trim();
  if (!normalizedMetaMessageId) return null;
  const c = await collection();
  const row = await c.findOne({ 'events.metaMessageId': normalizedMetaMessageId });
  return withId(row);
}

async function findLatestPendingInviteByDriverId(driverId, beforeAt = '') {
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedDriverId) return null;

  const c = await collection();
  const query = {
    driverId: normalizedDriverId,
    'invitation.status': { $in: ['sent', 'delivered', 'read', 'simulated'] },
    'invitation.lastInviteAt': { $ne: '' },
    $or: [
      { 'invitation.responseAt': '' },
      { 'invitation.responseAt': null },
      { 'invitation.responseAt': { $exists: false } },
    ],
  };

  const normalizedBeforeAt = String(beforeAt || '').trim();
  if (normalizedBeforeAt) {
    query['invitation.lastInviteAt'] = {
      $lte: normalizedBeforeAt,
      $gte: subtractDaysIso(normalizedBeforeAt, 14) || '1970-01-01T00:00:00.000Z',
    };
  }

  const row = await c
    .find(query)
    .sort({ 'invitation.lastInviteAt': -1, latestActivityAt: -1 })
    .limit(1)
    .next();

  return withId(row);
}

async function resolveFallbackInviteForInbound(message) {
  let driverId = String(message?.contactId || '').trim();
  if (!driverId) {
    const driver = await findDriverByPhone(String(message?.phoneE164 || '').trim());
    driverId = resolveDriverId(driver);
  }
  if (!driverId) return null;
  return findLatestPendingInviteByDriverId(driverId, message?.createdAt);
}

async function resolveDriverAndCampaign({ driverId, campaignId, driver, campaign, message }) {
  const resolvedDriver = driver || (driverId ? await fetchDriverById(driverId) : null);
  const resolvedCampaign = campaign || (campaignId ? await fetchCampaignById(campaignId) : null);
  const resolvedCampaignId = String(campaignId || '').trim() || WORKSPACE_OUTREACH_CAMPAIGN_ID;
  return {
    driver: resolvedDriver || {
      id: String(driverId || '').trim(),
      name: String(message?.displayName || '').trim(),
      phone: String(message?.phoneE164 || '').trim(),
    },
    campaign: resolvedCampaign || {
      id: resolvedCampaignId,
      name: resolveOutreachCampaignName(resolvedCampaignId, message?.payload?.campaignName || ''),
    },
  };
}

function buildSummaryFromDoc(doc) {
  const events = Array.isArray(doc.events) ? doc.events : [];
  let totalTemplateMessages = 0;
  let totalTextMessages = 0;
  let firstOutboundAt = '';
  let lastTemplateAt = '';
  let lastTemplateName = '';
  let failedCount = 0;
  let lastErrorAt = '';
  let lastErrorCode = '';
  let lastErrorMessage = '';

  events.forEach((event) => {
    const eventAt = String(event?.at || '').trim();
    const eventErrorCode = String(
      event?.errorCode || event?.payload?.error?.code || event?.payload?.code || '',
    ).trim();
    const eventErrorMessage = String(
      event?.errorMessage || event?.payload?.error?.message || event?.payload?.message || '',
    ).trim();
    const failedDelivery = String(event?.deliveryStatus || event?.status || '').trim().toLowerCase() === 'failed';
    const derivedErrorCode = eventErrorCode || (failedDelivery ? 'DELIVERY_FAILED' : '');
    const derivedErrorMessage = eventErrorMessage || (failedDelivery ? 'Falha no envio ou na entrega.' : '');

    if (derivedErrorCode || derivedErrorMessage) {
      failedCount += 1;
      if (!lastErrorAt || toDateMs(eventAt) >= toDateMs(lastErrorAt)) {
        lastErrorAt = eventAt;
        lastErrorCode = derivedErrorCode;
        lastErrorMessage = derivedErrorMessage;
      }
    }

    if (String(event?.direction || '').trim() !== 'outbound') return;

    firstOutboundAt = pickEarliestIso(firstOutboundAt, eventAt);

    if (String(event?.kind || '').trim() === 'template') {
      totalTemplateMessages += 1;
      if (!lastTemplateAt || toDateMs(eventAt) >= toDateMs(lastTemplateAt)) {
        lastTemplateAt = eventAt;
        lastTemplateName = String(event?.templateName || '').trim();
      }
      return;
    }

    if (String(event?.kind || '').trim() === 'text') {
      totalTextMessages += 1;
    }
  });

  return {
    campaignId: String(doc.campaignId || '').trim(),
    campaignName: resolveOutreachCampaignName(doc.campaignId, doc.campaignSnapshot?.name || ''),
    status: String(doc.invitation?.status || 'not_sent').trim() || 'not_sent',
    decision: String(doc.invitation?.decision || '').trim(),
    hasInvite: Boolean(doc.invitation?.lastInviteAt),
    lastInviteAt: String(doc.invitation?.lastInviteAt || '').trim(),
    responseAt: String(doc.invitation?.responseAt || '').trim(),
    latestActivityAt: String(doc.latestActivityAt || doc.updatedAt || '').trim(),
    lastFlowStatus: String(doc.invitation?.lastFlowStatus || '').trim(),
    lastFlowBranchLabel: String(doc.invitation?.lastFlowBranchLabel || '').trim(),
    totalOutbound: Number(doc.communication?.totalOutbound || 0),
    totalInbound: Number(doc.communication?.totalInbound || 0),
    totalInvites: Number(doc.communication?.totalInvites || 0),
    totalTemplateMessages,
    totalTextMessages,
    firstOutboundAt,
    lastOutboundAt: String(doc.communication?.lastOutboundAt || '').trim(),
    lastInboundAt: String(doc.communication?.lastInboundAt || '').trim(),
    lastMessageAt: String(doc.communication?.lastMessageAt || '').trim(),
    lastDeliveryStatus: String(doc.invitation?.lastDeliveryStatus || '').trim(),
    lastTemplateName,
    failedCount,
    lastErrorAt,
    lastErrorCode,
    lastErrorMessage,
  };
}

function createEmptyDriverOperationalSummary() {
  return {
    neverContacted: true,
    firstOutboundPending: true,
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    totalInvitesSent: 0,
    totalTemplateMessagesSent: 0,
    totalTextMessagesSent: 0,
    totalCampaignsWithHistory: 0,
    totalCampaignsResponded: 0,
    firstOutboundAt: '',
    lastOutboundAt: '',
    lastInboundAt: '',
    lastResponseAt: '',
    lastInviteAt: '',
    latestActivityAt: '',
    latestCampaignId: '',
    latestCampaignName: '',
    lastTemplateName: '',
    totalFailures: 0,
    lastErrorAt: '',
    lastErrorCode: '',
    lastErrorMessage: '',
    lastErrorCampaignId: '',
    lastErrorCampaignName: '',
    optInStatus: 'unknown',
    optInSource: '',
    optInCapturedAt: '',
    optInNotes: '',
    contactBlocked: false,
    contactBlockReason: '',
    marketingOptOut: false,
    marketingOptOutReason: '',
    cooldownUntil: '',
    cooldownReason: '',
    cooldownActive: false,
    serviceWindowOpenedAt: '',
    serviceWindowClosesAt: '',
    serviceWindowOpen: false,
    allowsTemplate: true,
    allowsText: false,
    hardBlock: false,
    hardBlockCode: '',
    hardBlockLabel: '',
    hardBlockMessage: '',
    currentPhase: 'first_contact',
    statusKey: 'first-contact',
    statusLabel: 'Primeiro contato',
    modeLabel: 'Somente template aprovado',
    ruleReason: 'Nenhum disparo anterior registrado para este motorista.',
    restrictionCode: 'FIRST_CONTACT_TEMPLATE_REQUIRED',
    restrictionLabel: 'Primeiro contato exige template',
    restrictionMessage: 'Nenhum disparo anterior registrado para este motorista.',
  };
}

function applyHardBlockToOperational(operational, block) {
  operational.allowsTemplate = false;
  operational.allowsText = false;
  operational.hardBlock = true;
  operational.hardBlockCode = String(block?.code || 'DISPATCH_BLOCKED').trim();
  operational.hardBlockLabel = String(block?.label || 'Envio bloqueado').trim();
  operational.hardBlockMessage = String(block?.message || 'Envio bloqueado para este motorista.').trim();
  operational.currentPhase = String(block?.phase || 'blocked').trim() || 'blocked';
  operational.statusKey = String(block?.statusKey || 'contact-blocked').trim() || 'contact-blocked';
  operational.statusLabel = String(block?.statusLabel || operational.hardBlockLabel).trim() || operational.hardBlockLabel;
  operational.modeLabel = String(block?.modeLabel || 'Envio bloqueado').trim() || 'Envio bloqueado';
  operational.ruleReason = operational.hardBlockMessage;
  operational.restrictionCode = operational.hardBlockCode;
  operational.restrictionLabel = operational.hardBlockLabel;
  operational.restrictionMessage = operational.hardBlockMessage;
  return operational;
}

function buildDriverOperationalSummary(campaignSummaries = [], policy = createEmptyDriverContactPolicy()) {
  const operational = createEmptyDriverOperationalSummary();
  operational.totalCampaignsWithHistory = campaignSummaries.length;
  operational.optInStatus = normalizeOptInStatus(policy.optInStatus);
  operational.optInSource = String(policy.optInSource || '').trim();
  operational.optInCapturedAt = normalizeIsoDateTime(policy.optInCapturedAt);
  operational.optInNotes = String(policy.optInNotes || '').trim();
  operational.contactBlocked = asBooleanFlag(policy.contactBlocked);
  operational.contactBlockReason = String(policy.contactBlockReason || '').trim();
  operational.marketingOptOut = asBooleanFlag(policy.marketingOptOut);
  operational.marketingOptOutReason = String(policy.marketingOptOutReason || '').trim();
  operational.cooldownUntil = normalizeIsoDateTime(policy.cooldownUntil);
  operational.cooldownReason = String(policy.cooldownReason || '').trim();
  operational.cooldownActive = isPolicyCooldownActive(policy);

  campaignSummaries.forEach((campaignSummary) => {
    operational.totalMessagesSent += Number(campaignSummary.totalOutbound || 0);
    operational.totalMessagesReceived += Number(campaignSummary.totalInbound || 0);
    operational.totalInvitesSent += Number(campaignSummary.totalInvites || 0);
    operational.totalTemplateMessagesSent += Number(campaignSummary.totalTemplateMessages || 0);
    operational.totalTextMessagesSent += Number(campaignSummary.totalTextMessages || 0);
    operational.totalFailures += Number(campaignSummary.failedCount || 0);

    if (campaignSummary.responseAt) {
      operational.totalCampaignsResponded += 1;
    }

    operational.firstOutboundAt = pickEarliestIso(operational.firstOutboundAt, campaignSummary.firstOutboundAt);
    operational.lastOutboundAt = pickLatestIso(operational.lastOutboundAt, campaignSummary.lastOutboundAt);
    operational.lastInboundAt = pickLatestIso(operational.lastInboundAt, campaignSummary.lastInboundAt);
    operational.lastInviteAt = pickLatestIso(operational.lastInviteAt, campaignSummary.lastInviteAt);
    operational.latestActivityAt = pickLatestIso(operational.latestActivityAt, campaignSummary.latestActivityAt);

    if (campaignSummary.lastTemplateName) {
      const shouldUseTemplate = !operational.lastTemplateName
        || toDateMs(campaignSummary.lastOutboundAt) >= toDateMs(operational.lastOutboundAt);
      if (shouldUseTemplate) {
        operational.lastTemplateName = campaignSummary.lastTemplateName;
      }
    }

    if (campaignSummary.latestActivityAt && campaignSummary.latestActivityAt === operational.latestActivityAt) {
      operational.latestCampaignId = campaignSummary.campaignId;
      operational.latestCampaignName = campaignSummary.campaignName;
    }

    if (campaignSummary.lastErrorAt && (!operational.lastErrorAt || toDateMs(campaignSummary.lastErrorAt) >= toDateMs(operational.lastErrorAt))) {
      operational.lastErrorAt = campaignSummary.lastErrorAt;
      operational.lastErrorCode = String(campaignSummary.lastErrorCode || '').trim();
      operational.lastErrorMessage = String(campaignSummary.lastErrorMessage || '').trim();
      operational.lastErrorCampaignId = campaignSummary.campaignId;
      operational.lastErrorCampaignName = campaignSummary.campaignName;
    }
  });

  operational.lastResponseAt = operational.lastInboundAt;
  operational.neverContacted = operational.totalMessagesSent === 0 && operational.totalMessagesReceived === 0;
  operational.firstOutboundPending = operational.totalMessagesSent === 0;
  operational.serviceWindowOpenedAt = operational.lastInboundAt;
  operational.serviceWindowClosesAt = addHoursIso(operational.lastInboundAt, SERVICE_WINDOW_HOURS);
  operational.serviceWindowOpen = Boolean(
    operational.serviceWindowClosesAt && toDateMs(operational.serviceWindowClosesAt) > Date.now(),
  );

  if (operational.contactBlocked) {
    return applyHardBlockToOperational(operational, {
      code: 'CONTACT_BLOCKED',
      label: 'Contato bloqueado',
      message: operational.contactBlockReason || 'Contato bloqueado manualmente para este motorista.',
      phase: 'blocked_contact',
      statusKey: 'contact-blocked',
      statusLabel: 'Contato bloqueado',
      modeLabel: 'Envio bloqueado',
    });
  }

  if (operational.optInStatus === 'revoked') {
    return applyHardBlockToOperational(operational, {
      code: 'OPT_OUT_ACTIVE',
      label: 'Opt-out registrado',
      message: 'O consentimento foi revogado para este motorista.',
      phase: 'blocked_opt_out',
      statusKey: 'opted-out',
      statusLabel: 'Opt-out ativo',
      modeLabel: 'Envio bloqueado',
    });
  }

  if (operational.cooldownActive) {
    return applyHardBlockToOperational(operational, {
      code: 'COOLDOWN_ACTIVE',
      label: 'Cooldown ativo',
      message: operational.cooldownUntil
        ? `Envio pausado ate ${operational.cooldownUntil}.${operational.cooldownReason ? ` ${operational.cooldownReason}` : ''}`
        : (operational.cooldownReason || 'Envio pausado temporariamente para este motorista.'),
      phase: 'cooldown',
      statusKey: 'cooldown',
      statusLabel: 'Cooldown ativo',
      modeLabel: 'Envio pausado',
    });
  }

  if (operational.serviceWindowOpen) {
    operational.allowsText = true;
    operational.allowsTemplate = !operational.marketingOptOut;
    operational.currentPhase = operational.marketingOptOut ? 'service_window_text_only' : 'service_window_open';
    operational.statusKey = operational.marketingOptOut ? 'text-only' : 'window-open';
    operational.statusLabel = operational.marketingOptOut ? 'Somente texto livre' : 'Janela 24h aberta';
    operational.modeLabel = operational.marketingOptOut ? 'Somente texto livre' : 'Texto livre ou template';
    operational.ruleReason = operational.serviceWindowClosesAt
      ? `Ultima resposta abre a janela de 24h ate ${operational.serviceWindowClosesAt}.`
      : 'Janela de 24h aberta para este motorista.';
    operational.restrictionCode = operational.marketingOptOut ? 'MARKETING_OPT_OUT' : '';
    operational.restrictionLabel = operational.marketingOptOut ? 'Template bloqueado por opt-out' : 'Texto liberado';
    operational.restrictionMessage = operational.marketingOptOut
      ? (operational.marketingOptOutReason || 'Existe opt-out para novos templates; use apenas texto livre dentro da janela aberta.')
      : operational.ruleReason;
    return operational;
  }

  if (operational.marketingOptOut) {
    return applyHardBlockToOperational(operational, {
      code: 'MARKETING_OPT_OUT',
      label: 'Opt-out para template',
      message: operational.marketingOptOutReason || 'Existe opt-out para novos templates deste motorista.',
      phase: 'blocked_marketing_opt_out',
      statusKey: 'marketing-opt-out',
      statusLabel: 'Template bloqueado',
      modeLabel: 'Envio bloqueado',
    });
  }

  if (operational.totalMessagesSent > 0) {
    operational.neverContacted = false;
    operational.currentPhase = 'outside_window';
    operational.statusKey = 'template-only';
    operational.statusLabel = 'Fora da janela';
    operational.modeLabel = 'Somente template aprovado';
    operational.ruleReason = operational.lastResponseAt
      ? 'A janela de 24h expirou; texto livre esta bloqueado ate nova resposta do motorista.'
      : 'Sem resposta registrada nas ultimas 24h; use apenas template aprovado.';
    operational.restrictionCode = 'OUTSIDE_SERVICE_WINDOW';
    operational.restrictionLabel = 'Texto livre bloqueado';
    operational.restrictionMessage = operational.ruleReason;
    return operational;
  }

  if (!operational.neverContacted) {
    operational.statusKey = 'template-only';
    operational.statusLabel = 'Sem janela ativa';
    operational.ruleReason = 'Ainda nao existe janela de 24h aberta para liberar texto livre.';
    operational.restrictionCode = 'OUTSIDE_SERVICE_WINDOW';
    operational.restrictionLabel = 'Texto livre bloqueado';
    operational.restrictionMessage = operational.ruleReason;
  }

  return operational;
}

export function createEmptyDriverOutreachSummary() {
  return {
    totalCampaigns: 0,
    hasInvite: false,
    acceptedCampaignIds: [],
    declinedCampaignIds: [],
    invitedCampaignIds: [],
    respondedCampaignIds: [],
    latestActivityAt: '',
    latest: null,
    byCampaign: [],
    policy: createEmptyDriverContactPolicy(),
    operational: createEmptyDriverOperationalSummary(),
  };
}

export async function ensureDriverOutreachIndexes() {
  const c = await collection();
  await c.createIndex({ driverId: 1, campaignId: 1 }, { unique: true, background: true });
  await c.createIndex({ driverId: 1, latestActivityAt: -1 }, { background: true });
  await c.createIndex({ driverId: 1, 'invitation.status': 1, 'invitation.lastInviteAt': -1 }, { background: true });
  await c.createIndex({ campaignId: 1, 'invitation.status': 1, latestActivityAt: -1 }, { background: true });
  await c.createIndex({ 'events.metaMessageId': 1 }, { sparse: true, background: true });
  await c.createIndex({ 'events.messageId': 1 }, { sparse: true, background: true });

  const policy = await policyCollection();
  await policy.createIndex({ driverId: 1 }, { unique: true, background: true });
  await policy.createIndex({ optInStatus: 1, contactBlocked: 1, marketingOptOut: 1 }, { background: true });
  await policy.createIndex({ cooldownUntil: 1 }, { background: true });
}

export async function listDriverOutreachSummaries(driverIds = []) {
  const normalizedIds = [...new Set(driverIds.map((item) => String(item || '').trim()).filter(Boolean))];
  if (!normalizedIds.length) return new Map();

  const c = await collection();
  const rows = await c.find({ driverId: { $in: normalizedIds } }).sort({ latestActivityAt: -1 }).toArray();
  const policyMap = await listDriverContactPolicies(normalizedIds);
  const map = new Map(normalizedIds.map((driverId) => [driverId, createEmptyDriverOutreachSummary()]));

  rows.forEach((row) => {
    const doc = withId(row);
    const driverId = String(doc.driverId || '').trim();
    if (!driverId) return;

    const current = map.get(driverId) || createEmptyDriverOutreachSummary();
    const campaignSummary = buildSummaryFromDoc(doc);
    current.byCampaign.push(campaignSummary);
    current.totalCampaigns += 1;
    if (campaignSummary.hasInvite) current.hasInvite = true;
    if (campaignSummary.hasInvite) current.invitedCampaignIds.push(campaignSummary.campaignId);
    if (campaignSummary.status === 'accepted') current.acceptedCampaignIds.push(campaignSummary.campaignId);
    if (campaignSummary.status === 'declined') current.declinedCampaignIds.push(campaignSummary.campaignId);
    if (campaignSummary.status === 'responded') current.respondedCampaignIds.push(campaignSummary.campaignId);
    if (!current.latestActivityAt || campaignSummary.latestActivityAt > current.latestActivityAt) {
      current.latestActivityAt = campaignSummary.latestActivityAt;
      current.latest = campaignSummary;
    }
    map.set(driverId, current);
  });

  for (const [driverId, summary] of map.entries()) {
    summary.policy = policyMap.get(driverId) || createEmptyDriverContactPolicy(driverId);
    summary.byCampaign.sort((left, right) => String(right.latestActivityAt || '').localeCompare(String(left.latestActivityAt || '')));
    summary.operational = buildDriverOperationalSummary(summary.byCampaign, summary.policy);
    map.set(driverId, summary);
  }

  return map;
}

export async function getDriverOutreachSummary(driverId) {
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedDriverId) return createEmptyDriverOutreachSummary();

  const map = await listDriverOutreachSummaries([normalizedDriverId]);
  return map.get(normalizedDriverId) || createEmptyDriverOutreachSummary();
}

export async function getDriverOutreachHistory(driverId) {
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedDriverId) return [];
  const c = await collection();
  const rows = await c.find({ driverId: normalizedDriverId }).sort({ latestActivityAt: -1 }).toArray();
  return rows.map((row) => {
    const doc = withId(row);
    return {
      ...doc,
      events: sortEvents(Array.isArray(doc.events) ? [...doc.events] : []).reverse(),
    };
  });
}

export async function syncDriverOutreachOutboundMessage({ message, driver, campaign }) {
  const outreach = getOutreachPayload(message?.payload?.outreach);
  if (!outreach) return null;

  const resolved = await resolveDriverAndCampaign({
    driverId: outreach.driverId,
    campaignId: outreach.campaignId,
    driver,
    campaign,
    message,
  });

  return appendEvent({
    driver: resolved.driver,
    campaign: resolved.campaign,
    driverId: outreach.driverId,
    campaignId: outreach.campaignId,
    event: {
      dedupeKey: `outbound:${String(message?.id || '').trim()}`,
      type: outreach.trackAsInvite ? 'invite.sent' : 'message.sent',
      direction: 'outbound',
      invite: outreach.isInvite,
      tracksInvitation: outreach.trackAsInvite,
      at: String(message?.createdAt || nowIso()).trim(),
      source: String(message?.source || 'system').trim(),
      messageId: String(message?.id || '').trim(),
      metaMessageId: String(message?.metaMessageId || '').trim(),
      deliveryStatus: String(message?.deliveryStatus || '').trim(),
      kind: String(message?.kind || '').trim(),
      text: String(message?.text || '').trim(),
      templateName: String(message?.templateName || '').trim(),
      templateLanguage: String(message?.templateLanguage || '').trim(),
      dispatchScope: outreach.dispatchScope,
      payload: {
        templateId: String(message?.payload?.templateId || '').trim(),
        dispatchMode: String(message?.payload?.dispatchMode || '').trim(),
        ...(message?.payload?.error
          ? {
            error: {
              code: String(message?.payload?.error?.code || '').trim(),
              message: String(message?.payload?.error?.message || '').trim(),
            },
          }
          : {}),
      },
      errorCode: String(message?.payload?.error?.code || '').trim(),
      errorMessage: String(message?.payload?.error?.message || '').trim(),
    },
  });
}

export async function syncDriverOutreachDeliveryStatus(metaMessageId, status, payload = null) {
  const normalizedMetaMessageId = String(metaMessageId || '').trim();
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!normalizedMetaMessageId || !normalizedStatus) return null;

  const doc = await findDocByMetaMessageId(normalizedMetaMessageId);
  if (!doc) return null;

  const sourceEvent = [...(doc.events || [])]
    .reverse()
    .find((event) => String(event?.metaMessageId || '').trim() === normalizedMetaMessageId);

  return appendEvent({
    driverId: doc.driverId,
    campaignId: doc.campaignId,
    driver: doc.driverSnapshot,
    campaign: doc.campaignSnapshot,
    event: {
      dedupeKey: `status:${normalizedMetaMessageId}:${normalizedStatus}`,
      type: 'message.status',
      direction: 'system',
      invite: sourceEvent?.invite === true,
      tracksInvitation: sourceEvent?.tracksInvitation === true,
      at: nowIso(),
      source: 'meta.webhook',
      messageId: String(sourceEvent?.messageId || '').trim(),
      metaMessageId: normalizedMetaMessageId,
      deliveryStatus: normalizedStatus,
      status: normalizedStatus,
      errorCode: String(payload?.error?.code || payload?.code || '').trim(),
      errorMessage: String(payload?.error?.message || payload?.message || '').trim(),
      text: '',
      payload: payload && typeof payload === 'object' ? deepClone(payload) : null,
    },
  });
}

export async function syncDriverOutreachInboundMessage(message) {
  const contextMetaMessageId = String(
    message?.contextMetaMessageId || message?.payload?.contextMetaMessageId || '',
  ).trim();
  let outreach = null;
  let resolution = 'context_meta_message_id';

  if (contextMetaMessageId) {
    const sourceMessage = await findMessageByMetaId(contextMetaMessageId);
    outreach = getOutreachPayload(sourceMessage?.payload?.outreach);
    if (!outreach) return null;
  } else {
    const pendingInvite = await resolveFallbackInviteForInbound(message);
    if (!pendingInvite || !isPendingInvitationStatus(pendingInvite?.invitation?.status)) {
      return null;
    }
    outreach = {
      driverId: String(pendingInvite.driverId || '').trim(),
      campaignId: String(pendingInvite.campaignId || '').trim(),
      isInvite: true,
      trackAsInvite: true,
      dispatchScope: 'latest_pending_invite',
    };
    resolution = 'latest_pending_invite';
  }

  const resolved = await resolveDriverAndCampaign({
    driverId: outreach.driverId,
    campaignId: outreach.campaignId,
    message,
  });
  const raw = message?.payload?.raw || {};
  const decision = outreach.trackAsInvite
    ? classifyInviteDecision(
      message?.text,
      raw?.button?.payload,
      raw?.button?.text,
      raw?.interactive?.button_reply?.id,
      raw?.interactive?.button_reply?.title,
      raw?.interactive?.list_reply?.id,
      raw?.interactive?.list_reply?.title,
    )
    : '';

  return appendEvent({
    driver: resolved.driver,
    campaign: resolved.campaign,
    driverId: outreach.driverId,
    campaignId: outreach.campaignId,
    event: {
      dedupeKey: `inbound:${String(message?.id || message?.metaMessageId || '').trim()}`,
      type: outreach.trackAsInvite ? 'invite.response' : 'message.inbound',
      direction: 'inbound',
      invite: outreach.isInvite,
      tracksInvitation: outreach.trackAsInvite,
      at: String(message?.createdAt || nowIso()).trim(),
      source: String(message?.source || 'meta.webhook').trim(),
      messageId: String(message?.id || '').trim(),
      metaMessageId: String(message?.metaMessageId || '').trim(),
      contextMetaMessageId,
      decision,
      kind: String(message?.kind || '').trim(),
      text: String(message?.text || '').trim(),
      payload: {
        messageType: String(message?.payload?.messageType || '').trim(),
        resolution,
      },
    },
  });
}

export async function syncDriverOutreachFlowRun({ sourceTemplateMessage, message, run, branch }) {
  const outreach = getOutreachPayload(sourceTemplateMessage?.payload?.outreach);
  if (!outreach || !run?.id) return null;

  const resolved = await resolveDriverAndCampaign({
    driverId: outreach.driverId,
    campaignId: outreach.campaignId,
    message,
  });
  const statusAction = [...(Array.isArray(run.actions) ? run.actions : [])]
    .reverse()
    .find((action) => action?.nodeType === 'update_driver_status' && action?.payload?.status);
  const decision = outreach.trackAsInvite
    ? classifyInviteDecision(
      statusAction?.payload?.status,
      run?.matchedBranchLabel,
      branch?.label,
      message?.text,
    )
    : '';

  return appendEvent({
    driver: resolved.driver,
    campaign: resolved.campaign,
    driverId: outreach.driverId,
    campaignId: outreach.campaignId,
    event: {
      dedupeKey: `flow:${String(run.id || '').trim()}`,
      type: 'flow.run',
      direction: 'system',
      invite: outreach.isInvite,
      tracksInvitation: outreach.trackAsInvite,
      at: String(run?.completedAt || nowIso()).trim(),
      source: 'od-flow-studio',
      runId: String(run?.id || '').trim(),
      runStatus: String(run?.status || '').trim(),
      branchId: String(run?.matchedBranchId || branch?.id || '').trim(),
      branchLabel: String(run?.matchedBranchLabel || branch?.label || '').trim(),
      statusValue: String(statusAction?.payload?.status || '').trim(),
      decision,
      text: String(message?.text || '').trim(),
      payload: {
        actions: (Array.isArray(run.actions) ? run.actions : []).map((action) => ({
          nodeId: String(action?.nodeId || '').trim(),
          nodeType: String(action?.nodeType || '').trim(),
          status: String(action?.status || '').trim(),
          statusValue: String(action?.payload?.status || '').trim(),
        })),
      },
    },
  });
}

function buildDispatchBlockedError(operational, type) {
  if (operational.hardBlock) {
    return {
      code: String(operational.hardBlockCode || 'DISPATCH_BLOCKED').trim() || 'DISPATCH_BLOCKED',
      message: String(operational.hardBlockMessage || operational.ruleReason || 'Envio bloqueado para este motorista.').trim(),
    };
  }

  if (type === 'text') {
    return {
      code: 'TEXT_OUTSIDE_WINDOW',
      message: String(operational.ruleReason || 'Texto livre so pode ser enviado com janela de 24h aberta.').trim(),
    };
  }

  return {
    code: String(operational.restrictionCode || 'TEMPLATE_NOT_ALLOWED').trim() || 'TEMPLATE_NOT_ALLOWED',
    message: String(operational.restrictionMessage || operational.ruleReason || 'Template bloqueado para este motorista.').trim(),
  };
}

export async function dispatchDriverCampaignMessage(input = {}) {
  const driver = input.driver || (input.driverId ? await fetchDriverById(String(input.driverId || '').trim()) : null);
  if (!driver) {
    return { ok: false, error: { code: 'DRIVER_NOT_FOUND', message: 'Motorista nao encontrado.' } };
  }

  const explicitCampaignId = String(input.campaignId || '').trim();
  const fallbackCampaignId = String(driver?.campaignId || '').trim();
  const campaignId = explicitCampaignId || fallbackCampaignId;
  const campaign = campaignId ? await fetchCampaignById(campaignId) : null;
  if (explicitCampaignId && !campaign) {
    return { ok: false, error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.' } };
  }

  const phoneE164 = resolveDriverPhone(driver);
  if (!phoneE164) {
    return { ok: false, error: { code: 'PHONE_NOT_FOUND', message: 'Motorista sem telefone valido.' } };
  }

  const type = String(input.type || '').trim();
  const isInvite = input.isInvite === true;
  const resolvedDriverId = resolveDriverId(driver);
  const resolvedCampaignId = resolveCampaignId(campaign);
  const trackingCampaignId = resolvedCampaignId || explicitCampaignId || fallbackCampaignId || WORKSPACE_OUTREACH_CAMPAIGN_ID;
  const trackingCampaignName = resolveOutreachCampaignName(trackingCampaignId, campaign?.name || '');
  const outreachPayload = {
    driverId: resolvedDriverId,
    campaignId: trackingCampaignId,
    isInvite,
    trackAsInvite: isInvite,
    dispatchScope: String(input.dispatchScope || 'individual').trim() || 'individual',
  };
  const sendReal = isMetaConfigured() && input.simulate !== true;
  const displayName = String(driver.name || '').trim();
  const summary = await getDriverOutreachSummary(resolvedDriverId);
  const operational = summary.operational || createEmptyDriverOperationalSummary();

  if (operational.hardBlock) {
    return {
      ok: false,
      error: buildDispatchBlockedError(operational, type),
      summary,
    };
  }

  if (type === 'text') {
    const text = String(input.text || '').trim();
    if (!text) {
      return { ok: false, error: { code: 'INVALID_TEXT', message: 'Texto nao pode ser vazio.' } };
    }
    if (!operational.allowsText) {
      return {
        ok: false,
        error: buildDispatchBlockedError(operational, 'text'),
        summary,
      };
    }

    let metaResponse = null;
    let deliveryStatus = sendReal ? 'sent' : 'simulated';
    let sendError = null;

    if (sendReal) {
      try {
        metaResponse = await sendTextMessage({ to: phoneE164, text });
      } catch (err) {
        console.error('[CAMPAIGN_DISPATCH_FAIL][text]', {
          to: phoneE164,
          driverId: resolvedDriverId,
          campaignId: trackingCampaignId,
          textLength: text.length,
          errorCode: err?.code || null,
          statusCode: err?.statusCode || null,
          errorMessage: err?.message || null,
          meta: err?.meta || null,
        });
        deliveryStatus = 'failed';
        sendError = err;
      }
    }

    const message = await addInboxMessage({
      phoneE164,
      displayName,
      direction: 'outbound',
      kind: 'text',
      text,
      deliveryStatus,
      metaMessageId: sendReal && metaResponse ? extractMetaMessageId(metaResponse) : '',
      source: 'drivers.outreach',
      payload: {
        campaignId: trackingCampaignId,
        campaignName: trackingCampaignName,
        dispatchRunId: String(input.dispatchRunId || '').trim(),
        dispatchMode: sendReal ? 'meta_cloud_api' : 'simulado',
        outreach: outreachPayload,
        ...(sendError
          ? { error: { code: sendError.code || 'SEND_ERROR', message: sendError.message || 'Falha no envio.' } }
          : {}),
      },
    });

    const outreach = await syncDriverOutreachOutboundMessage({
      message,
      driver,
      campaign: campaign || { id: trackingCampaignId, name: trackingCampaignName },
    });
    if (sendError) {
      await applyAutomaticPolicyEffects(resolvedDriverId, sendError.code || 'SEND_ERROR', sendError.message || 'Falha no envio.');
      return {
        ok: false,
        error: { code: sendError.code || 'SEND_ERROR', message: sendError.message || 'Falha no envio.' },
        dispatchMode: sendReal ? 'meta_cloud_api' : 'simulado',
        item: message,
        outreach,
        summary: await getDriverOutreachSummary(resolvedDriverId),
      };
    }

    return {
      ok: true,
      dispatchMode: sendReal ? 'meta_cloud_api' : 'simulado',
      item: message,
      outreach,
    };
  }

  if (type !== 'template') {
    return { ok: false, error: { code: 'INVALID_TYPE', message: 'Tipo de envio invalido.' } };
  }

  if (!operational.allowsTemplate) {
    return {
      ok: false,
      error: buildDispatchBlockedError(operational, 'template'),
      summary,
    };
  }

  const template = await getTemplateById(String(input.templateId || '').trim());
  if (!template) {
    return { ok: false, error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template nao encontrado.' } };
  }
  if (sendReal && normalizeText(template.status) !== 'approved') {
    return { ok: false, error: { code: 'TEMPLATE_NOT_APPROVED', message: 'Template precisa estar aprovado para envio real.' } };
  }

  const parameters = [String(driver.name || 'Motorista').trim().split(' ')[0] || 'Motorista'];
  const renderedText = renderTemplateMessageText(template, parameters);
  const templateSnapshot = buildTemplateSnapshot(template);
  let metaResponse = null;
  let deliveryStatus = sendReal ? 'sent' : 'simulated';
  let sendError = null;

  if (sendReal) {
    try {
      metaResponse = await sendTemplateMessage({
        to: phoneE164,
        templateName: template.name,
        languageCode: template.language || 'pt_BR',
        parameters,
        bodyTemplateText: template.bodyText || '',
        headerType: template.headerType || 'none',
        headerImageUrl: template.headerMediaUrl || '',
      });
    } catch (err) {
      console.error('[CAMPAIGN_DISPATCH_FAIL]', {
        templateName: template.name,
        templateLanguage: template.language || 'pt_BR',
        to: phoneE164,
        driverId: resolvedDriverId,
        campaignId: trackingCampaignId,
        parametersCount: parameters.length,
        errorCode: err?.code || null,
        statusCode: err?.statusCode || null,
        errorMessage: err?.message || null,
        meta: err?.meta || null,
      });
      deliveryStatus = 'failed';
      sendError = err;
    }
  }

  const message = await addInboxMessage({
    phoneE164,
    displayName,
    direction: 'outbound',
    kind: 'template',
    text: renderedText,
    templateName: template.name,
    templateLanguage: template.language || 'pt_BR',
    deliveryStatus,
    metaMessageId: sendReal && metaResponse ? extractMetaMessageId(metaResponse) : '',
    source: 'drivers.outreach',
    payload: {
      campaignId: trackingCampaignId,
      campaignName: trackingCampaignName,
      dispatchRunId: String(input.dispatchRunId || '').trim(),
      templateId: template.id,
      dispatchMode: sendReal ? 'meta_cloud_api' : 'simulado',
      parameters,
      renderedText,
      templateSnapshot,
      outreach: outreachPayload,
      ...(sendError
        ? { error: { code: sendError.code || 'SEND_ERROR', message: sendError.message || 'Falha no envio.' } }
        : {}),
    },
  });

  const outreach = await syncDriverOutreachOutboundMessage({
    message,
    driver,
    campaign: campaign || { id: trackingCampaignId, name: trackingCampaignName },
  });
  if (sendError) {
    await applyAutomaticPolicyEffects(resolvedDriverId, sendError.code || 'SEND_ERROR', sendError.message || 'Falha no envio.');
    return {
      ok: false,
      error: { code: sendError.code || 'SEND_ERROR', message: sendError.message || 'Falha no envio.' },
      dispatchMode: sendReal ? 'meta_cloud_api' : 'simulado',
      item: message,
      outreach,
      summary: await getDriverOutreachSummary(resolvedDriverId),
    };
  }

  return {
    ok: true,
    dispatchMode: sendReal ? 'meta_cloud_api' : 'simulado',
    item: message,
    outreach,
  };
}
