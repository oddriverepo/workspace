function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return num;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export function parseKmNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^0-9.\-]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRawByAliases(raw, aliases = []) {
  if (!raw || typeof raw !== 'object') return null;
  const keys = Object.keys(raw);
  if (!keys.length) return null;
  const normalizedMap = new Map(keys.map(key => [normalizeKey(key), key]));
  for (const alias of aliases) {
    const direct = normalizedMap.get(normalizeKey(alias));
    if (direct) return raw[direct];
  }
  return null;
}

function getRawNumericByAliases(raw, aliases = []) {
  const value = getRawByAliases(raw, aliases);
  return parseKmNumber(value);
}

function normalizeSource(value) {
  const source = String(value || '').trim();
  return source || null;
}

const INITIAL_ALIASES = [
  'KM INICIAL',
  'ODOMETRO INICIAL',
  'ODÔMETRO INICIAL',
  'HODOMETRO INICIAL',
  'ODO INICIAL',
];

const CURRENT_ALIASES = [
  'ODOMETRO ATUAL',
  'ODÔMETRO ATUAL',
  'ODOMETRO',
  'ODÔMETRO',
  'DRV ODOMETRO VALOR INST',
];

const SOURCE_ALIASES = [
  'ODOMETRO FONTE',
  'ODÔMETRO FONTE',
  'KM FONTE',
];

const UPDATED_AT_ALIASES = [
  'ODOMETRO ATUALIZADO EM',
  'ODÔMETRO ATUALIZADO EM',
  'ODOMETRO UPDATED AT',
];

export function extractDriverKmSummary(driver) {
  const raw = driver?.raw && typeof driver.raw === 'object' ? driver.raw : {};
  const km = driver?.km && typeof driver.km === 'object' ? driver.km : {};
  const total = km.total && typeof km.total === 'object' ? km.total : {};
  const summary = km.summary && typeof km.summary === 'object' ? km.summary : {};

  let initialKm = parseKmNumber(summary.initialKm);
  if (!Number.isFinite(initialKm)) initialKm = parseKmNumber(km.initialKm);
  if (!Number.isFinite(initialKm)) initialKm = getRawNumericByAliases(raw, INITIAL_ALIASES);

  let currentKm = parseKmNumber(summary.currentKm);
  if (!Number.isFinite(currentKm)) currentKm = parseKmNumber(km.odometerCurrentKm);
  if (!Number.isFinite(currentKm)) currentKm = getRawNumericByAliases(raw, CURRENT_ALIASES);
  if (!Number.isFinite(currentKm)) {
    const totalSource = normalizeSource(total.source);
    const canUseTotalAsOdometer = totalSource
      ? !String(totalSource).toLowerCase().startsWith('km-sheet')
      : false;
    if (canUseTotalAsOdometer) {
      currentKm = parseKmNumber(total.kmRodado);
    }
  }

  let source = normalizeSource(summary.source);
  if (!source) source = normalizeSource(getRawByAliases(raw, SOURCE_ALIASES));
  if (!source) source = normalizeSource(total.source);

  let updatedAt = parseTimestamp(summary.updatedAt);
  if (!Number.isFinite(updatedAt)) updatedAt = parseTimestamp(km.odometerUpdatedAt);
  if (!Number.isFinite(updatedAt)) updatedAt = parseTimestamp(total.updatedAt);
  if (!Number.isFinite(updatedAt)) updatedAt = parseTimestamp(getRawByAliases(raw, UPDATED_AT_ALIASES));
  if (!Number.isFinite(updatedAt)) updatedAt = parseTimestamp(driver?.updatedAt);

  if (Number.isFinite(initialKm)) initialKm = Math.max(0, Math.round(initialKm));
  else initialKm = null;

  if (Number.isFinite(currentKm)) currentKm = Math.max(0, Math.round(currentKm));
  else currentKm = null;

  if (Number.isFinite(initialKm) && Number.isFinite(currentKm) && currentKm < initialKm) {
    currentKm = initialKm;
  }

  const travelledKm = Number.isFinite(initialKm) && Number.isFinite(currentKm)
    ? Math.max(0, currentKm - initialKm)
    : null;

  return {
    initialKm,
    currentKm,
    travelledKm,
    source,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
  };
}

export function applyDriverKmSummary(
  driver,
  {
    initialKm,
    currentKm,
    source = null,
    updatedAt = Date.now(),
    syncTotalKmRodado = false,
  } = {},
) {
  if (!driver || typeof driver !== 'object') return extractDriverKmSummary(driver);
  if (!driver.raw || typeof driver.raw !== 'object') driver.raw = {};
  if (!driver.km || typeof driver.km !== 'object') driver.km = {};

  const current = extractDriverKmSummary(driver);
  let nextInitial = Number.isFinite(parseKmNumber(initialKm)) ? Math.round(parseKmNumber(initialKm)) : current.initialKm;
  let nextCurrent = Number.isFinite(parseKmNumber(currentKm)) ? Math.round(parseKmNumber(currentKm)) : current.currentKm;

  if (Number.isFinite(nextInitial)) nextInitial = Math.max(0, nextInitial);
  if (Number.isFinite(nextCurrent)) nextCurrent = Math.max(0, nextCurrent);

  if (Number.isFinite(nextInitial) && Number.isFinite(nextCurrent) && nextCurrent < nextInitial) {
    nextCurrent = nextInitial;
  }

  const hasKmValues = Number.isFinite(nextInitial) || Number.isFinite(nextCurrent);
  if (!hasKmValues) return current;

  const nextSource = normalizeSource(source) || current.source || 'admin-manual';
  const nextUpdatedAt = Number.isFinite(parseTimestamp(updatedAt)) ? parseTimestamp(updatedAt) : Date.now();
  const nextTravelled = Number.isFinite(nextInitial) && Number.isFinite(nextCurrent)
    ? Math.max(0, nextCurrent - nextInitial)
    : null;

  if (Number.isFinite(nextInitial)) {
    driver.raw['KM INICIAL'] = nextInitial;
    driver.km.initialKm = nextInitial;
  }
  if (Number.isFinite(nextCurrent)) {
    driver.raw['ODOMETRO ATUAL'] = nextCurrent;
    driver.raw['DRV ODOMETRO VALOR INST'] = String(nextCurrent);
    driver.km.odometerCurrentKm = nextCurrent;
    driver.km.odometerUpdatedAt = nextUpdatedAt;
    if (syncTotalKmRodado) {
      driver.km.total = driver.km.total && typeof driver.km.total === 'object' ? driver.km.total : {};
      driver.km.total.kmRodado = nextCurrent;
      driver.km.total.source = nextSource;
      driver.km.total.updatedAt = nextUpdatedAt;
    }
  }
  if (Number.isFinite(nextTravelled)) {
    driver.raw['KM RODADO CAMPANHA'] = nextTravelled;
    driver.km.travelledKm = nextTravelled;
  }
  driver.raw['ODOMETRO FONTE'] = nextSource;
  driver.raw['ODOMETRO ATUALIZADO EM'] = new Date(nextUpdatedAt).toISOString();
  driver.km.summary = {
    initialKm: Number.isFinite(nextInitial) ? nextInitial : null,
    currentKm: Number.isFinite(nextCurrent) ? nextCurrent : null,
    travelledKm: Number.isFinite(nextTravelled) ? nextTravelled : null,
    source: nextSource,
    updatedAt: nextUpdatedAt,
  };

  return driver.km.summary;
}

export default {
  parseKmNumber,
  extractDriverKmSummary,
  applyDriverKmSummary,
};
