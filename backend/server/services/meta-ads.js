import crypto from 'crypto';
import { getDb } from './mongoClient.js';
import { recordCacheEvent, recordExternalCall } from './runtime-telemetry.js';
import { runWorkload } from './workload-manager.js';
import {
  META_ADS_METRIC_VERSION,
  META_ADS_TIME_ZONE,
  buildDateList,
  daysBetween,
  deriveMetrics,
  formatIsoDateInTimeZone,
  groupContiguousDates,
  inferCampaignCity,
  isFreshForDate,
  isIsoDate,
  normalizeAccountId,
  normalizeInsightRow,
} from './meta-ads-utils.js';

const DAILY_COLLECTION = 'meta_ads_daily_insights';
const COVERAGE_COLLECTION = 'meta_ads_coverage';
const SNAPSHOT_COLLECTION = 'meta_ads_period_snapshots';
const LOCK_COLLECTION = 'meta_ads_sync_locks';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_CACHE_TTL_MS = 90000;
const MAX_CACHE_ENTRIES = 120;
const MAX_RANGE_DAYS = 366;
const FORCE_COOLDOWN_MS = 30000;
const LOCK_TTL_MS = 90000;
const WAIT_FOR_LOCK_MS = 20000;
const GRAPH_PAGE_LIMIT = 500;
const MAX_GRAPH_PAGES = 50;

const responseCache = new Map();
const inFlightDashboards = new Map();
const lastForcedRefresh = new Map();

export class MetaAdsError extends Error {
  constructor(message, { status = 502, code = 'META_ADS_ERROR', details = null } = {}) {
    super(message);
    this.name = 'MetaAdsError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function readConfig() {
  const accessToken = String(process.env.META_ADS_ACCESS_TOKEN || '').trim();
  const accountIds = String(process.env.META_ADS_ACCOUNT_IDS || process.env.META_ADS_DEFAULT_ACCOUNT_ID || '')
    .split(',')
    .map(normalizeAccountId)
    .filter(Boolean);
  const uniqueAccounts = Array.from(new Set(accountIds));
  const requestedDefault = normalizeAccountId(process.env.META_ADS_DEFAULT_ACCOUNT_ID);
  const apiVersion = /^v\d+\.\d+$/.test(String(process.env.META_ADS_API_VERSION || '').trim())
    ? String(process.env.META_ADS_API_VERSION).trim()
    : 'v25.0';
  const labels = parseJson(process.env.META_ADS_ACCOUNT_LABELS_JSON, {});
  const aliasObject = parseJson(process.env.META_ADS_CITY_ALIASES_JSON, {});
  const customCityAliases = Object.entries(aliasObject || {}).map(([match, label]) => [match, label]);

  return {
    accessToken,
    accountIds: uniqueAccounts,
    defaultAccountId: uniqueAccounts.includes(requestedDefault) ? requestedDefault : uniqueAccounts[0] || '',
    apiVersion,
    labels,
    customCityAliases,
    timeoutMs: parsePositiveInt(process.env.META_ADS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60000),
    cacheTtlMs: parsePositiveInt(process.env.META_ADS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS, 10 * 60 * 1000),
    configured: Boolean(accessToken && uniqueAccounts.length),
  };
}

export function getMetaAdsStatus() {
  const config = readConfig();
  return {
    configured: config.configured,
    provider: 'meta-marketing-api',
    apiVersion: config.apiVersion,
    defaultAccountId: config.defaultAccountId,
    accounts: config.accountIds.map((id) => ({ id, label: String(config.labels[id] || id) })),
    updateMode: 'on-demand',
  };
}

export function validateDashboardRequest({ accountId, from, to }) {
  const config = readConfig();
  if (!config.configured) {
    throw new MetaAdsError('A integração META ADS ainda não foi configurada no servidor.', {
      status: 503,
      code: 'META_ADS_NOT_CONFIGURED',
    });
  }

  const normalizedAccountId = normalizeAccountId(accountId || config.defaultAccountId);
  if (!normalizedAccountId || !config.accountIds.includes(normalizedAccountId)) {
    throw new MetaAdsError('A conta de anúncios informada não está autorizada.', {
      status: 400,
      code: 'META_ADS_INVALID_ACCOUNT',
    });
  }
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw new MetaAdsError('O período informado é inválido.', {
      status: 400,
      code: 'META_ADS_INVALID_PERIOD',
    });
  }
  const today = formatIsoDateInTimeZone(new Date(), META_ADS_TIME_ZONE);
  if (to > today) {
    throw new MetaAdsError('O período não pode terminar em uma data futura.', {
      status: 400,
      code: 'META_ADS_FUTURE_PERIOD',
    });
  }
  const rangeDays = daysBetween(from, to) + 1;
  if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) {
    throw new MetaAdsError(`O período deve ter no máximo ${MAX_RANGE_DAYS} dias.`, {
      status: 400,
      code: 'META_ADS_PERIOD_TOO_LARGE',
    });
  }
  return { config, accountId: normalizedAccountId, from, to, rangeDays };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseUsageHeader(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function fetchGraphUrl(url, config, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  let ok = false;
  try {
    const response = await runWorkload('external', 'meta-graph', () => fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }));
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new MetaAdsError('A Meta retornou uma resposta em formato inesperado.', {
        code: 'META_ADS_INVALID_RESPONSE',
      });
    }

    if (!response.ok || payload?.error) {
      const status = response.status || 502;
      const retryable = status === 429 || status >= 500;
      if (retryable && attempt < 2) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
        const delay = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 5000)
          : (500 * (2 ** attempt)) + Math.floor(Math.random() * 250);
        await sleep(delay);
        return fetchGraphUrl(url, config, attempt + 1);
      }
      throw new MetaAdsError('A Meta não conseguiu processar a consulta de anúncios.', {
        status: status === 401 || status === 403 ? 503 : 502,
        code: status === 429 ? 'META_ADS_RATE_LIMIT' : 'META_ADS_UPSTREAM_ERROR',
        details: {
          upstreamStatus: status,
          upstreamCode: payload?.error?.code || null,
          upstreamSubcode: payload?.error?.error_subcode || null,
        },
      });
    }

    ok = true;
    return {
      payload,
      usage: {
        app: parseUsageHeader(response.headers.get('x-app-usage')),
        account: parseUsageHeader(response.headers.get('x-ad-account-usage')),
        insights: parseUsageHeader(response.headers.get('x-fb-ads-insights-throttle')),
      },
    };
  } catch (error) {
    if (error instanceof MetaAdsError) throw error;
    if (error?.name === 'AbortError') {
      throw new MetaAdsError('A consulta à Meta excedeu o tempo limite.', {
        status: 504,
        code: 'META_ADS_TIMEOUT',
      });
    }
    throw new MetaAdsError('Não foi possível conectar à API da Meta.', {
      code: 'META_ADS_CONNECTION_ERROR',
    });
  } finally {
    clearTimeout(timeout);
    recordExternalCall('Meta Graph API', { durationMs: Date.now() - startedAt, ok });
  }
}

async function graphGetAll(path, params, config) {
  const url = new URL(`https://graph.facebook.com/${config.apiVersion}/${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('access_token', config.accessToken);

  const items = [];
  let nextUrl = url.toString();
  let pages = 0;
  let latestUsage = null;
  while (nextUrl) {
    if (pages >= MAX_GRAPH_PAGES) {
      throw new MetaAdsError('A consulta da Meta excedeu o limite seguro de paginação.', {
        code: 'META_ADS_PAGINATION_LIMIT',
      });
    }
    const result = await fetchGraphUrl(nextUrl, config);
    const data = Array.isArray(result.payload?.data) ? result.payload.data : [];
    items.push(...data);
    latestUsage = result.usage;
    nextUrl = String(result.payload?.paging?.next || '');
    pages += 1;
  }
  return { items, pages, usage: latestUsage };
}

function insightFields(level) {
  const identity = level === 'campaign'
    ? 'account_id,account_name,account_currency,campaign_id,campaign_name'
    : 'account_id,account_name,account_currency';
  return `${identity},spend,reach,impressions,clicks,actions,date_start,date_stop`;
}

async function fetchInsights({ accountId, from, to, level, daily, config }) {
  return graphGetAll(`${accountId}/insights`, {
    fields: insightFields(level),
    level,
    time_range: JSON.stringify({ since: from, until: to }),
    time_increment: daily ? 1 : undefined,
    use_account_attribution_setting: 'true',
    limit: GRAPH_PAGE_LIMIT,
  }, config);
}

function cacheGet(key, ttlMs) {
  const entry = responseCache.get(key);
  if (!entry || Date.now() - entry.createdAt >= ttlMs) {
    if (entry) responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.value;
}

function cacheSet(key, value) {
  responseCache.set(key, { value, createdAt: Date.now() });
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

function invalidateAccountCache(accountId) {
  for (const key of responseCache.keys()) {
    if (key.startsWith(`${accountId}:`)) responseCache.delete(key);
  }
}

async function acquireAccountLock(db, accountId) {
  const owner = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  try {
    const result = await db.collection(LOCK_COLLECTION).findOneAndUpdate(
      {
        _id: `meta-ads:${accountId}`,
        $or: [{ expiresAt: { $lte: now } }, { owner }],
      },
      { $set: { owner, expiresAt, updatedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    const document = result?.value || result;
    return document?.owner === owner ? owner : null;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function releaseAccountLock(db, accountId, owner) {
  if (!owner) return;
  await db.collection(LOCK_COLLECTION).deleteOne({ _id: `meta-ads:${accountId}`, owner }).catch(() => {});
}

async function readSyncNeeds(db, { accountId, from, to, force }) {
  const now = new Date();
  const today = formatIsoDateInTimeZone(now, META_ADS_TIME_ZONE);
  const dates = buildDateList(from, to);
  const coverageDocs = await db.collection(COVERAGE_COLLECTION)
    .find({ accountId, level: 'campaign', date: { $in: dates }, metricVersion: META_ADS_METRIC_VERSION })
    .project({ date: 1, refreshedAt: 1 })
    .toArray();
  const coverage = new Map(coverageDocs.map((doc) => [doc.date, doc]));
  const staleDates = dates.filter((date) => {
    if (force) return true;
    const doc = coverage.get(date);
    return !doc || !isFreshForDate(date, doc.refreshedAt, now, today);
  });

  const accountSnapshot = await db.collection(SNAPSHOT_COLLECTION).findOne({
    accountId,
    from,
    to,
    level: 'account',
    entityId: accountId,
    metricVersion: META_ADS_METRIC_VERSION,
    complete: true,
  });
  const snapshotFresh = !force
    && accountSnapshot
    && isFreshForDate(to, accountSnapshot.refreshedAt, now, today);

  return {
    staleDates,
    staleRanges: groupContiguousDates(staleDates),
    snapshotNeeded: !snapshotFresh,
  };
}

async function storeDailyRange(db, { accountId, range, rows, config, usage }) {
  const now = new Date();
  const syncRunId = crypto.randomUUID();
  const normalized = rows
    .map((row) => normalizeInsightRow(row, {
      accountId,
      level: 'campaign',
      customCityAliases: config.customCityAliases,
    }))
    .filter((row) => row.entityId && isIsoDate(row.dateStart));
  const daily = db.collection(DAILY_COLLECTION);
  const rowsByDate = new Map();
  for (const row of normalized) rowsByDate.set(row.dateStart, (rowsByDate.get(row.dateStart) || 0) + 1);

  if (normalized.length) {
    await daily.bulkWrite(normalized.map((row) => ({
      updateOne: {
        filter: {
          accountId,
          level: 'campaign',
          date: row.dateStart,
          entityId: row.entityId,
          metricVersion: META_ADS_METRIC_VERSION,
        },
        update: {
          $set: {
            ...row,
            accountId,
            date: row.dateStart,
            metricVersion: META_ADS_METRIC_VERSION,
            syncRunId,
            refreshedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    })), { ordered: false });
  }

  await daily.deleteMany({
    accountId,
    level: 'campaign',
    date: { $gte: range.from, $lte: range.to },
    metricVersion: META_ADS_METRIC_VERSION,
    syncRunId: { $ne: syncRunId },
  });

  const coverageDates = buildDateList(range.from, range.to);
  if (coverageDates.length) {
    await db.collection(COVERAGE_COLLECTION).bulkWrite(coverageDates.map((date) => ({
      updateOne: {
        filter: { accountId, level: 'campaign', date, metricVersion: META_ADS_METRIC_VERSION },
        update: {
          $set: { refreshedAt: now, rowCount: rowsByDate.get(date) || 0 },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    })), { ordered: false });
  }

  return { rows: normalized.length, usage };
}

async function storePeriodSnapshot(db, { accountId, from, to, accountRows, campaignRows, config, usage }) {
  const now = new Date();
  const syncRunId = crypto.randomUUID();
  const accountNormalized = accountRows[0]
    ? normalizeInsightRow(accountRows[0], { accountId, level: 'account' })
    : {
        accountId,
        accountName: String(config.labels[accountId] || ''),
        currency: '',
        level: 'account',
        entityId: accountId,
        entityName: String(config.labels[accountId] || accountId),
        dateStart: from,
        dateStop: to,
        spendCents: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        leadsStarted: 0,
        conversationsReplied: 0,
      };
  const campaigns = campaignRows
    .map((row) => normalizeInsightRow(row, {
      accountId,
      level: 'campaign',
      customCityAliases: config.customCityAliases,
    }))
    .filter((row) => row.entityId);
  const snapshots = db.collection(SNAPSHOT_COLLECTION);

  if (campaigns.length) {
    await snapshots.bulkWrite(campaigns.map((row) => ({
      updateOne: {
        filter: {
          accountId,
          from,
          to,
          level: 'campaign',
          entityId: row.entityId,
          metricVersion: META_ADS_METRIC_VERSION,
        },
        update: {
          $set: {
            ...row,
            accountId,
            from,
            to,
            metricVersion: META_ADS_METRIC_VERSION,
            syncRunId,
            refreshedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    })), { ordered: false });
  }
  await snapshots.deleteMany({
    accountId,
    from,
    to,
    level: 'campaign',
    metricVersion: META_ADS_METRIC_VERSION,
    syncRunId: { $ne: syncRunId },
  });
  await snapshots.updateOne(
    {
      accountId,
      from,
      to,
      level: 'account',
      entityId: accountId,
      metricVersion: META_ADS_METRIC_VERSION,
    },
    {
      $set: {
        ...accountNormalized,
        accountId,
        entityId: accountId,
        from,
        to,
        complete: true,
        campaignCount: campaigns.length,
        metricVersion: META_ADS_METRIC_VERSION,
        refreshedAt: now,
        usage,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  return campaigns.length;
}

async function synchronizeNeededData(db, request, needs) {
  const { accountId, from, to, config } = request;
  let metaCalls = 0;
  let importedRows = 0;

  for (const range of needs.staleRanges) {
    const result = await fetchInsights({
      accountId,
      from: range.from,
      to: range.to,
      level: 'campaign',
      daily: true,
      config,
    });
    metaCalls += result.pages;
    const stored = await storeDailyRange(db, {
      accountId,
      range,
      rows: result.items,
      config,
      usage: result.usage,
    });
    importedRows += stored.rows;
  }

  if (needs.snapshotNeeded) {
    const [accountResult, campaignResult] = await Promise.all([
      fetchInsights({ accountId, from, to, level: 'account', daily: false, config }),
      fetchInsights({ accountId, from, to, level: 'campaign', daily: false, config }),
    ]);
    metaCalls += accountResult.pages + campaignResult.pages;
    importedRows += await storePeriodSnapshot(db, {
      accountId,
      from,
      to,
      accountRows: accountResult.items,
      campaignRows: campaignResult.items,
      config,
      usage: accountResult.usage || campaignResult.usage,
    });
  }

  return { synchronized: metaCalls > 0, metaCalls, importedRows };
}

async function ensureStoredData(db, request, force) {
  let needs = await readSyncNeeds(db, { ...request, force });
  if (!needs.staleDates.length && !needs.snapshotNeeded) {
    return { synchronized: false, metaCalls: 0, importedRows: 0 };
  }

  let owner = await acquireAccountLock(db, request.accountId);
  let effectiveForce = force;
  if (!owner) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < WAIT_FOR_LOCK_MS) {
      await sleep(400);
      needs = await readSyncNeeds(db, { ...request, force: false });
      if (!needs.staleDates.length && !needs.snapshotNeeded) {
        return { synchronized: false, metaCalls: 0, importedRows: 0, sharedSync: true };
      }
      owner = await acquireAccountLock(db, request.accountId);
      if (owner) {
        effectiveForce = false;
        break;
      }
    }
  }
  if (!owner) {
    throw new MetaAdsError('Uma atualização META ADS ainda está em andamento. Tente novamente em instantes.', {
      status: 503,
      code: 'META_ADS_SYNC_BUSY',
    });
  }

  try {
    needs = await readSyncNeeds(db, { ...request, force: effectiveForce });
    return await synchronizeNeededData(db, request, needs);
  } finally {
    await releaseAccountLock(db, request.accountId, owner);
  }
}

function mergeMetricTotals(target, source) {
  target.spendCents += source.spendCents || 0;
  target.reach += source.reach || 0;
  target.impressions += source.impressions || 0;
  target.clicks += source.clicks || 0;
  target.leadsStarted += source.leadsStarted || 0;
  target.conversationsReplied += source.conversationsReplied || 0;
  return target;
}

function emptyTotals() {
  return { spendCents: 0, reach: 0, impressions: 0, clicks: 0, leadsStarted: 0, conversationsReplied: 0 };
}

function buildInsights(campaigns, summary) {
  const insights = [];
  const withLeads = campaigns.filter((item) => item.leadsStarted > 0 && item.spendCents > 0);
  const sortedByCpl = [...withLeads].sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
  if (sortedByCpl[0]) {
    insights.push({
      type: 'positive',
      title: 'Melhor custo por lead',
      message: `${sortedByCpl[0].campaignName} apresenta o menor CPL do período.`,
      campaignId: sortedByCpl[0].campaignId,
      value: sortedByCpl[0].cpl,
      valueType: 'currency',
    });
  }
  const topVolume = [...campaigns].sort((a, b) => b.leadsStarted - a.leadsStarted)[0];
  if (topVolume?.leadsStarted > 0) {
    insights.push({
      type: 'info',
      title: 'Maior volume de leads',
      message: `${topVolume.campaignName} concentra o maior volume do período.`,
      campaignId: topVolume.campaignId,
      value: topVolume.leadsStarted,
      valueType: 'integer',
    });
  }
  const noLeadSpend = campaigns.filter((item) => item.spendCents > 0 && item.leadsStarted === 0);
  if (noLeadSpend.length) {
    insights.push({
      type: 'warning',
      title: 'Investimento sem lead atribuido',
      message: `${noLeadSpend.length} campanha(s) tiveram investimento e nenhum lead iniciado.`,
      value: noLeadSpend.reduce((sum, item) => sum + item.spendCents, 0) / 100,
      valueType: 'currency',
    });
  }
  if (summary.frequency >= 3) {
    insights.push({
      type: 'warning',
      title: 'Frequência elevada',
      message: 'A frequência geral merece acompanhamento para evitar saturação do público.',
      value: summary.frequency,
      valueType: 'decimal',
    });
  }
  return insights.slice(0, 4);
}

async function buildDashboardFromMongo(db, request, syncResult) {
  const { accountId, from, to, config } = request;
  const snapshots = await db.collection(SNAPSHOT_COLLECTION)
    .find({ accountId, from, to, metricVersion: META_ADS_METRIC_VERSION })
    .project({ _id: 0, syncRunId: 0, usage: 0 })
    .toArray();
  const accountSnapshot = snapshots.find((item) => item.level === 'account' && item.entityId === accountId);
  if (!accountSnapshot?.complete) {
    throw new MetaAdsError('Os dados exatos do período ainda não foram consolidados.', {
      status: 503,
      code: 'META_ADS_SNAPSHOT_PENDING',
    });
  }
  const campaignSnapshots = snapshots.filter((item) => item.level === 'campaign');
  const dailyRows = await db.collection(DAILY_COLLECTION)
    .find({
      accountId,
      level: 'campaign',
      date: { $gte: from, $lte: to },
      metricVersion: META_ADS_METRIC_VERSION,
    })
    .project({
      _id: 0,
      date: 1,
      spendCents: 1,
      impressions: 1,
      clicks: 1,
      leadsStarted: 1,
      conversationsReplied: 1,
    })
    .toArray();

  const periodDates = buildDateList(from, to);
  const trendMap = new Map(periodDates.map((date) => [date, { ...emptyTotals(), reach: 0 }]));
  for (const row of dailyRows) mergeMetricTotals(trendMap.get(row.date) || emptyTotals(), row);
  const trend = Array.from(trendMap.entries()).map(([date, totals]) => {
    const metrics = deriveMetrics(totals);
    delete metrics.reach;
    delete metrics.frequency;
    return { date, ...metrics };
  });

  const campaigns = campaignSnapshots.map((item) => ({
    campaignId: item.entityId,
    campaignName: item.entityName,
    city: item.city || inferCampaignCity(item.entityName, config.customCityAliases),
    ...deriveMetrics(item),
  })).sort((a, b) => b.spendCents - a.spendCents || b.leadsStarted - a.leadsStarted);

  const cityMap = new Map();
  for (const campaign of campaigns) {
    const city = campaign.city || 'Nao identificada';
    if (!cityMap.has(city)) cityMap.set(city, { city, campaigns: 0, ...emptyTotals() });
    const target = cityMap.get(city);
    target.campaigns += 1;
    mergeMetricTotals(target, campaign);
  }
  const cities = Array.from(cityMap.values()).map((item) => ({
    city: item.city,
    campaigns: item.campaigns,
    reachMode: item.campaigns > 1 ? 'campaign-sum' : 'exact',
    ...deriveMetrics(item),
  })).sort((a, b) => b.leadsStarted - a.leadsStarted || b.spendCents - a.spendCents);
  const summary = deriveMetrics(accountSnapshot);
  const coverageCount = await db.collection(COVERAGE_COLLECTION).countDocuments({
    accountId,
    level: 'campaign',
    date: { $gte: from, $lte: to },
    metricVersion: META_ADS_METRIC_VERSION,
  });

  return {
    ok: true,
    account: {
      id: accountId,
      name: accountSnapshot.accountName || config.labels[accountId] || accountId,
      currency: accountSnapshot.currency || 'BRL',
    },
    period: { from, to, days: request.rangeDays },
    summary,
    trend,
    cities,
    campaigns,
    insights: buildInsights(campaigns, summary),
    freshness: {
      source: syncResult.synchronized ? 'meta' : 'mongodb',
      synchronized: syncResult.synchronized,
      sharedSync: Boolean(syncResult.sharedSync),
      metaCalls: syncResult.metaCalls,
      importedRows: syncResult.importedRows,
      exactReach: true,
      coverageDays: coverageCount,
      refreshedAt: accountSnapshot.refreshedAt,
      updateMode: 'on-demand',
    },
  };
}

async function loadDashboard(request, force) {
  const db = await getDb();
  const syncResult = await ensureStoredData(db, request, force);
  if (syncResult.synchronized) invalidateAccountCache(request.accountId);
  return buildDashboardFromMongo(db, request, syncResult);
}

export async function getMetaAdsDashboard(input) {
  const request = validateDashboardRequest(input);
  const key = `${request.accountId}:${request.from}:${request.to}:v${META_ADS_METRIC_VERSION}`;
  let force = Boolean(input.force);
  if (force) {
    const lastForcedAt = lastForcedRefresh.get(key) || 0;
    if (Date.now() - lastForcedAt < FORCE_COOLDOWN_MS) force = false;
    else lastForcedRefresh.set(key, Date.now());
  }

  if (!force) {
    const cached = cacheGet(key, request.config.cacheTtlMs);
    if (cached) {
      recordCacheEvent('Meta Ads - painel', true);
      return {
        ...cached,
        freshness: { ...cached.freshness, source: 'memory-cache', synchronized: false, metaCalls: 0 },
      };
    }
    recordCacheEvent('Meta Ads - painel', false);
  }

  if (inFlightDashboards.has(key)) {
    recordCacheEvent('Meta Ads - requisicao compartilhada', true);
    return inFlightDashboards.get(key);
  }
  const promise = loadDashboard(request, force)
    .then((result) => {
      cacheSet(key, result);
      return result;
    })
    .finally(() => inFlightDashboards.delete(key));
  inFlightDashboards.set(key, promise);
  return promise;
}

export async function ensureMetaAdsIndexes() {
  const db = await getDb();
  await Promise.all([
    db.collection(DAILY_COLLECTION).createIndex(
      { accountId: 1, level: 1, date: 1, entityId: 1, metricVersion: 1 },
      { unique: true, background: true },
    ),
    db.collection(DAILY_COLLECTION).createIndex(
      { accountId: 1, date: 1, city: 1 },
      { background: true },
    ),
    db.collection(COVERAGE_COLLECTION).createIndex(
      { accountId: 1, level: 1, date: 1, metricVersion: 1 },
      { unique: true, background: true },
    ),
    db.collection(SNAPSHOT_COLLECTION).createIndex(
      { accountId: 1, from: 1, to: 1, level: 1, entityId: 1, metricVersion: 1 },
      { unique: true, background: true },
    ),
    db.collection(SNAPSHOT_COLLECTION).createIndex(
      { accountId: 1, refreshedAt: -1 },
      { background: true },
    ),
    db.collection(LOCK_COLLECTION).createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true },
    ),
  ]);
}
