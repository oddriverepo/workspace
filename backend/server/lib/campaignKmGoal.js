const KM_PER_DRIVER_PER_30_DAYS = 3000;
const DEFAULT_CAMPAIGN_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 100_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const date = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const brDate = text.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (brDate) {
    const year = brDate[3].length === 2 ? Number(`20${brDate[3]}`) : Number(brDate[3]);
    const date = new Date(Date.UTC(year, Number(brDate[2]) - 1, Number(brDate[1])));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function utcDayNumber(date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
}

function periodCandidates(campaign = {}) {
  const apiData = campaign.apiData || {};
  const candidates = [
    [apiData.periodStart, apiData.periodEnd],
    [campaign.periodStart, campaign.periodEnd],
    [campaign.startDate, campaign.endDate],
    [campaign.startAt, campaign.endAt],
  ];

  const period = String(campaign.period || '').trim();
  if (period) {
    const parts = period.split(/\s+(?:-|a|até|ate)\s+/i).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) candidates.push([parts[0], parts[1]]);
  }

  return candidates;
}

export function getCampaignKmGoalDays(campaign = {}) {
  for (const [startValue, endValue] of periodCandidates(campaign)) {
    const start = parseDate(startValue);
    const end = parseDate(endValue);
    if (!start || !end) continue;

    const days = utcDayNumber(end) - utcDayNumber(start) + 1;
    if (Number.isFinite(days) && days > 0) return days;
  }

  return DEFAULT_CAMPAIGN_DAYS;
}

export function getCampaignKmGoal(campaign = {}, driverCount = 0) {
  const days = getCampaignKmGoalDays(campaign);
  const perDriver = Math.max(0, Math.round((KM_PER_DRIVER_PER_30_DAYS * days) / DEFAULT_CAMPAIGN_DAYS));
  const drivers = Math.max(0, Math.round(Number(driverCount) || 0));

  return {
    days,
    perDriver,
    total: perDriver * drivers,
    driverCount: drivers,
    baseKm: KM_PER_DRIVER_PER_30_DAYS,
    baseDays: DEFAULT_CAMPAIGN_DAYS,
  };
}

export {
  KM_PER_DRIVER_PER_30_DAYS,
  DEFAULT_CAMPAIGN_DAYS,
};
