import { normalizeMasterKey } from './masterHeader.js';

function parseDateTimeMs(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text.replace(/\s+/, 'T'));
  if (Number.isFinite(parsed.getTime())) return parsed.getTime();
  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})$/);
  if (!dmy) return null;
  const year = dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3]);
  const month = Number(dmy[2]) - 1;
  const day = Number(dmy[1]);
  const hour = Number(dmy[4]);
  const minute = Number(dmy[5]);
  const date = new Date(year, month, day, hour, minute, 0, 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function formatDateTimeInput(value) {
  const timestamp = parseDateTimeMs(value);
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function normalizeAdhesionStatus(value) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (!normalized) return '';
  if (normalized === 'agendado' || normalized === 'agendada') return 'agendado';
  if (
    normalized === 'concluido' ||
    normalized === 'concluida' ||
    normalized === 'instalado' ||
    normalized === 'instalada' ||
    normalized === 'finalizado'
  ) {
    return 'concluido';
  }
  if (normalized === 'faltou' || normalized === 'ausente' || normalized === 'nao compareceu') {
    return 'faltou';
  }
  if (normalized === 'reagendado' || normalized === 'reagendada') return 'reagendado';
  return normalized;
}

export function mergeDriverRawSources(driver) {
  const raw = { ...(driver?.raw || {}) };
  if (driver?.km && driver.km.raw && typeof driver.km.raw === 'object') {
    for (const [key, value] of Object.entries(driver.km.raw)) {
      if (raw[key] === undefined || raw[key] === null || String(raw[key]).trim() === '') {
        raw[key] = value;
      }
    }
  }
  return raw;
}

export function applyCanonicalRaw(driver) {
  if (!driver) return {};
  const raw = mergeDriverRawSources(driver);

  const set = (key, value, { overwrite = false } = {}) => {
    if (value === undefined || value === null) return;
    if (!overwrite) {
      const current = raw[key];
      if (current !== undefined && current !== null && String(current).trim() !== '') return;
    }
    raw[key] = value;
  };

  set('DRIVER ID', driver.id, { overwrite: true });
  set('Nome', driver.name || '', { overwrite: true });
  set('Cidade', driver.city || '');
  set('Status', driver.statusRaw || driver.status || '');
  set('PIX', driver.pix || '');
  if (driver.email) set('Email', driver.email, { overwrite: true });
  if (driver.cpf) set('CPF', driver.cpf, { overwrite: true });
  if (driver.plate) set('Placa', driver.plate, { overwrite: true });
  if (driver.phone) {
    set('Numero', driver.phone, { overwrite: true });
    set('Telefone', driver.phone, { overwrite: true });
  }

  if (driver.schedule && typeof driver.schedule === 'object') {
    const initialRaw = formatDateTimeInput(
      driver.schedule.initialAtRaw ?? driver.schedule.initialAt,
    );
    const removalRaw = formatDateTimeInput(
      driver.schedule.removalAtRaw ?? driver.schedule.removalAt,
    );
    const status = normalizeAdhesionStatus(driver.schedule.status);

    if (initialRaw) set('Adesivagem Inicial', initialRaw, { overwrite: true });
    if (removalRaw) set('Retirada Adesivo', removalRaw, { overwrite: true });
    if (status) set('Status Adesivagem', status, { overwrite: true });
  }

  if (driver.km && driver.km.total) {
    const total = driver.km.total;
    if (total.kmRodado !== undefined && total.kmRodado !== null) {
      set('KM RODADO TOTAL', total.kmRodado, { overwrite: true });
    }
    if (total.metaKm !== undefined && total.metaKm !== null) {
      set('META KM TOTAL', total.metaKm, { overwrite: true });
    }
    if (total.status !== undefined && total.status !== null) {
      set('STATUS TOTAL', total.status, { overwrite: true });
    }
    if (total.percent !== undefined && total.percent !== null && total.metaKm) {
      const percent = Number.isFinite(total.percent) ? Math.round(total.percent) : total.percent;
      set('PERCENT TOTAL', percent, { overwrite: true });
    }
  }

  raw['_ATUALIZADO EM'] = new Date().toISOString();
  raw['_ORIGEM'] = driver._origin || 'ADMIN';

  driver.raw = raw;
  if (driver.km) {
    driver.km.raw = { ...(driver.km.raw || {}), ...raw };
  }
  return raw;
}

export function buildSheetRowValues(header = [], driver) {
  const raw = applyCanonicalRaw(driver);
  const normalized = new Map();
  Object.entries(raw).forEach(([key, value]) => {
    normalized.set(normalizeMasterKey(key), value);
  });

  return header.map(col => {
    const value = raw[col];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    const alt = normalized.get(normalizeMasterKey(col));
    if (alt !== undefined && alt !== null) return alt;
    return '';
  });
}

export default {
  applyCanonicalRaw,
  buildSheetRowValues,
  mergeDriverRawSources,
};
