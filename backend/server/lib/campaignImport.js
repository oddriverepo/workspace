import { nanoid } from 'nanoid';
import { STATUS, normalizeStatus, normalizeName } from './normalize.js';

function sanitizeDigits(value) {
  return value ? String(value).replace(/\D+/g, '') : '';
}

function sanitizePlate(value) {
  return value ? String(value).replace(/[^a-z0-9]/gi, '').toUpperCase() : '';
}

function sanitizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : '';
}

function parseDateTimeMs(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = String(value).trim();
  if (!text) return null;

  const isoLike = text.replace(/\s+/, 'T');
  const fromIso = new Date(isoLike);
  if (Number.isFinite(fromIso.getTime())) return fromIso.getTime();

  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})$/);
  if (dmy) {
    const year = dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3]);
    const month = Number(dmy[2]) - 1;
    const day = Number(dmy[1]);
    const hour = Number(dmy[4]);
    const minute = Number(dmy[5]);
    const date = new Date(year, month, day, hour, minute, 0, 0);
    if (Number.isFinite(date.getTime())) return date.getTime();
  }

  return null;
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

function readFirst(row = {}, keys = []) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function extractAdhesionSchedule(row = {}) {
  const initialRaw = readFirst(row, [
    'Adesivagem Inicial',
    'ADESIVAGEM INICIAL',
    'Horario Adesivagem Inicial',
    'HORARIO ADESIVAGEM INICIAL',
  ]);
  const removalRaw = readFirst(row, [
    'Retirada Adesivo',
    'RETIRADA ADESIVO',
    'Horario Retirada Adesivo',
    'HORARIO RETIRADA ADESIVO',
  ]);
  const statusRaw = readFirst(row, [
    'Status Adesivagem',
    'STATUS ADESIVAGEM',
    'Situacao Adesivagem',
    'SITUACAO ADESIVAGEM',
  ]);

  const initialAt = parseDateTimeMs(initialRaw);
  const removalAt = parseDateTimeMs(removalRaw);
  const status = normalizeAdhesionStatus(statusRaw);

  if (!Number.isFinite(initialAt) && !Number.isFinite(removalAt) && !status) return null;

  return {
    initialAt: Number.isFinite(initialAt) ? initialAt : null,
    initialAtRaw: formatDateTimeInput(initialRaw),
    removalAt: Number.isFinite(removalAt) ? removalAt : null,
    removalAtRaw: formatDateTimeInput(removalRaw),
    status,
  };
}

export function createStatusCounter() {
  return STATUS.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});
}

export function resolveSheetName(name, fallback) {
  const base = (name || fallback || '').trim();
  if (!base) return fallback || '';
  const lower = base.toLowerCase();
  if (lower === 'pagina1' || lower === 'p\u00E1gina1') return 'P\u00E1gina1';
  return base;
}

export function buildDriversFromRows(rows, { campaignId, now, previousDrivers = [] }) {
  const result = {
    drivers: [],
    counts: createStatusCounter(),
    imported: 0,
    review: 0,
    reviewEntries: [],
  };

  const previousMap = new Map(
    previousDrivers.map(driver => [
      driver.nameKey || normalizeName(driver.name),
      driver,
    ]),
  );

  rows.forEach((row, index) => {
    const name =
      row['Nome'] ||
      row['NOME'] ||
      row['name'] ||
      row['nome'] ||
      row['Motorista'] ||
      '';

    if (!name) return;

    const nameKey = normalizeName(name);
    const previous = previousMap.get(nameKey);

    const rowNumber =
      row.__rowNumber ||
      previous?.rowNumber ||
      index + 2; // inclui cabecalho
    const raw = { ...row };
    delete raw.__rowNumber;

    const city = row['Cidade'] || row['CIDADE'] || row['cidade'] || '';
    const pix = row['PIX'] || row['Pix'] || row['pix'] || '';
    const statusRaw = row['Status'] || row['STATUS'] || row['status'] || '';
    const status = normalizeStatus(statusRaw);
    const phoneValue =
      row['Numero'] ||
      row['Numero '] ||
      row['Número'] ||
      row['N\u00FAmero'] ||
      row['numero'] ||
      row['número'] ||
      row['NUMERO'] ||
      row['NÚMERO'] ||
      row['telefone'] ||
      row['Telefone'] ||
      row['TELEFONE'] ||
      row['CELULAR'] ||
      row['Celular'] ||
      row['celular'] ||
      row['WhatsApp'] ||
      row['Whatsapp'] ||
      row['whatsapp'] ||
      row['Fone'] ||
      row['fone'] ||
      row['FONE'] ||
      '';
    const cpfValue = row['CPF'] || row['Cpf'] || row['cpf'] || '';
    const plateValue = row['Placa'] || row['placa'] || row['PLACA'] || '';
    const emailValue = row['Email'] || row['EMAIL'] || row['email'] || '';

    const driverId = previous?.id || nanoid();

    const driver = {
      id: driverId,
      campaignId,
      name,
      nameKey,
      city,
      pix,
      status,
      statusRaw,
      phone: phoneValue || '',
      phoneDigits: sanitizeDigits(phoneValue),
      cpf: sanitizeDigits(cpfValue),
      plate: sanitizePlate(plateValue),
      email: sanitizeEmail(emailValue),
      rowNumber,
      raw,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };

    const importedSchedule = extractAdhesionSchedule(raw);
    if (importedSchedule) {
      driver.schedule = importedSchedule;
    } else if (previous?.schedule && typeof previous.schedule === 'object') {
      driver.schedule = { ...previous.schedule };
    }

    if (previous?.km) driver.km = previous.km;
    if (previous?.adh) driver.adh = previous.adh;
    if (previous?._CPF_HASH) driver._CPF_HASH = previous._CPF_HASH;
    if (previous?._InviteLink) driver._InviteLink = previous._InviteLink;

    result.drivers.push(driver);
    result.counts[status] = (result.counts[status] || 0) + 1;

    if (status === 'revisar') {
      result.review += 1;
      result.reviewEntries.push({
        id: nanoid(),
        type: 'STATUS_INVALIDO',
        campaignId,
        driverId,
        driverName: name,
        column: 'Status',
        value: statusRaw || '',
        rowNumber,
        createdAt: now,
        note: statusRaw
          ? `Status "${statusRaw}" fora do padrao`
          : 'Status vazio ou invalido',
      });
    } else {
      result.imported += 1;
    }

    previousMap.delete(nameKey);
  });

  result.review = result.reviewEntries.length;
  return result;
}

