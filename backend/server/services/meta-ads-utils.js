export const META_ADS_METRIC_VERSION = 2;
export const META_ADS_TIME_ZONE = 'America/Sao_Paulo';

const CITY_ALIASES = [
  ['sao paulo', 'Sao Paulo'],
  ['campinas', 'Campinas'],
  ['londrina', 'Londrina'],
  ['dourados', 'Dourados'],
  ['goiania', 'Goiania'],
  ['curitiba', 'Curitiba'],
  ['fortaleza', 'Fortaleza'],
  ['rio de janeiro', 'Rio de Janeiro'],
  ['belo horizonte', 'Belo Horizonte'],
  ['porto alegre', 'Porto Alegre'],
  ['florianopolis', 'Florianopolis'],
  ['brasilia', 'Brasilia'],
];

const STARTED_ACTIONS = new Set([
  'onsite_conversion.messaging_conversation_started_7d',
  'messaging_conversation_started_7d',
]);

const REPLIED_ACTIONS = new Set([
  'onsite_conversion.messaging_conversation_replied_7d',
  'messaging_conversation_replied_7d',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMetric(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round((toFiniteNumber(value) + Number.EPSILON) * factor) / factor;
}

export function toInteger(value) {
  return Math.max(0, Math.round(toFiniteNumber(value)));
}

export function toMoneyCents(value) {
  return Math.max(0, Math.round((toFiniteNumber(value) + Number.EPSILON) * 100));
}

export function formatIsoDateInTimeZone(date = new Date(), timeZone = META_ADS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function dateToEpochDay(value) {
  if (!isIsoDate(value)) return NaN;
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86400000);
}

export function daysBetween(from, to) {
  return dateToEpochDay(to) - dateToEpochDay(from);
}

export function buildDateList(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const start = dateToEpochDay(from);
  const end = dateToEpochDay(to);
  const dates = [];
  for (let day = start; day <= end; day += 1) {
    dates.push(new Date(day * 86400000).toISOString().slice(0, 10));
  }
  return dates;
}

export function groupContiguousDates(dates) {
  const sorted = Array.from(new Set((dates || []).filter(isIsoDate))).sort();
  const ranges = [];
  for (const date of sorted) {
    const previous = ranges[ranges.length - 1];
    if (!previous || daysBetween(previous.to, date) !== 1) {
      ranges.push({ from: date, to: date });
    } else {
      previous.to = date;
    }
  }
  return ranges;
}

export function freshnessWindowMs(date, today) {
  const ageDays = daysBetween(date, today);
  if (!Number.isFinite(ageDays) || ageDays < 0) return 5 * 60 * 1000;
  if (ageDays === 0) return 5 * 60 * 1000;
  if (ageDays <= 7) return 6 * 60 * 60 * 1000;
  if (ageDays <= 28) return 24 * 60 * 60 * 1000;
  return Number.POSITIVE_INFINITY;
}

export function isFreshForDate(date, refreshedAt, now = new Date(), today = formatIsoDateInTimeZone(now)) {
  const refreshedMs = new Date(refreshedAt || 0).getTime();
  if (!Number.isFinite(refreshedMs) || refreshedMs <= 0) return false;
  const maxAge = freshnessWindowMs(date, today);
  return maxAge === Number.POSITIVE_INFINITY || now.getTime() - refreshedMs < maxAge;
}

export function inferCampaignCity(campaignName, customAliases = []) {
  const normalized = normalizeText(campaignName);
  const aliases = [...customAliases, ...CITY_ALIASES];
  for (const entry of aliases) {
    const needle = normalizeText(Array.isArray(entry) ? entry[0] : entry?.match);
    const label = String(Array.isArray(entry) ? entry[1] : entry?.label || '').trim();
    if (needle && label && normalized.includes(needle)) return label;
  }

  const afterChannel = String(campaignName || '').match(/\((?:uber|99|indrive)[^)]*\)\s*([^\-|\[]+)/i);
  if (afterChannel?.[1]) return afterChannel[1].trim();
  return 'Nao identificada';
}

export function getActionValue(actions, acceptedTypes) {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const action of actions) {
    if (acceptedTypes.has(String(action?.action_type || ''))) {
      total += toFiniteNumber(action?.value);
    }
  }
  return Math.max(0, Math.round(total));
}

export function normalizeInsightRow(row, {
  accountId,
  level,
  customCityAliases = [],
} = {}) {
  const configuredAccountId = normalizeAccountId(accountId);
  const rawAccountId = String(row?.account_id || '').trim();
  const upstreamAccountId = normalizeAccountId(rawAccountId)
    || (/^\d+$/.test(rawAccountId) ? `act_${rawAccountId}` : '');
  const effectiveAccountId = configuredAccountId || upstreamAccountId;
  const entityId = level === 'account'
    ? effectiveAccountId
    : String(row?.campaign_id || '').trim();
  const entityName = level === 'account'
    ? String(row?.account_name || effectiveAccountId).trim()
    : String(row?.campaign_name || entityId).trim();

  return {
    accountId: effectiveAccountId,
    accountName: String(row?.account_name || '').trim(),
    currency: String(row?.account_currency || '').trim(),
    level,
    entityId,
    entityName,
    campaignId: level === 'campaign' ? entityId : '',
    campaignName: level === 'campaign' ? entityName : '',
    city: level === 'campaign' ? inferCampaignCity(entityName, customCityAliases) : '',
    dateStart: String(row?.date_start || '').slice(0, 10),
    dateStop: String(row?.date_stop || '').slice(0, 10),
    spendCents: toMoneyCents(row?.spend),
    reach: toInteger(row?.reach),
    impressions: toInteger(row?.impressions),
    clicks: toInteger(row?.clicks),
    leadsStarted: getActionValue(row?.actions, STARTED_ACTIONS),
    conversationsReplied: getActionValue(row?.actions, REPLIED_ACTIONS),
  };
}

export function deriveMetrics(input = {}) {
  const spendCents = toInteger(input.spendCents);
  const reach = toInteger(input.reach);
  const impressions = toInteger(input.impressions);
  const clicks = toInteger(input.clicks);
  const leadsStarted = toInteger(input.leadsStarted);
  const conversationsReplied = toInteger(input.conversationsReplied);
  const spend = spendCents / 100;

  return {
    spendCents,
    spend,
    reach,
    impressions,
    clicks,
    leadsStarted,
    conversationsReplied,
    ctr: impressions > 0 ? roundMetric((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? roundMetric(spend / clicks) : 0,
    cpm: impressions > 0 ? roundMetric((spend / impressions) * 1000) : 0,
    cpl: leadsStarted > 0 ? roundMetric(spend / leadsStarted) : null,
    frequency: reach > 0 ? roundMetric(impressions / reach) : 0,
  };
}

export function normalizeAccountId(value) {
  const text = String(value || '').trim();
  return /^act_\d+$/.test(text) ? text : '';
}
