// Build a master header for campaign tabs (profile + KM/Metas + evidence)

function uniqPush(arr, value, seenSet) {
  const norm = normalizeMasterKey(value);
  if (!seenSet.has(norm)) {
    arr.push(value);
    seenSet.add(norm);
  }
}

export function normalizeMasterKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function buildMasterHeader({ periods = 3, baseHeader = [] } = {}) {
  const requiredStart = [
    'DRIVER ID',
    'Nome',
    'Cidade',
    'Status',
    'PIX',
    'CPF',
    'Email',
    'Placa',
    'Modelo',
    'Numero',
    'Convite',
    'Data de Instalacao',
    'Horario Plotagem',
    'Adesivagem Inicial',
    'Retirada Adesivo',
    'Status Adesivagem',
  ];

  const requiredTotals = [
    'KM RODADO TOTAL',
    'META KM TOTAL',
    'STATUS TOTAL',
    'PERCENT TOTAL',
    'CHECK IN',
    'COMENTARIOS',
    'OBSERVACOES',
  ];

  const evidenceInstall = [
    'DRV FOTO ODOMETRO INST',
    'DRV ODOMETRO VALOR INST',
    'GFX FOTO ODOMETRO INST',
    'GFX ODOMETRO VALOR INST',
    'DRV FOTO LATERAL ESQ INST',
    'DRV FOTO LATERAL DIR INST',
    'DRV FOTO TRASEIRA INST',
    'DRV FOTO FRENTE INST',
    'GFX FOTO LATERAL ESQ INST',
    'GFX FOTO LATERAL DIR INST',
    'GFX FOTO TRASEIRA INST',
    'GFX FOTO FRENTE INST',
  ];

  const evidenceCheckins = [
    'FOTOS CHECKIN 1',
    'FOTOS CHECKIN 2',
    'FOTOS CHECKIN 3',
    'FOTOS CHECKOUT',
    'PASTA DRIVE',
  ];

  const systemCols = [
    '_ATUALIZADO EM',
    '_ORIGEM',
  ];

  // Start with base header if provided
  const out = [];
  const seen = new Set();

  const pushList = (list) => list.forEach(col => uniqPush(out, col, seen));

  // Base (from existing sheet or defaults)
  if (Array.isArray(baseHeader) && baseHeader.length) {
    baseHeader.forEach(col => uniqPush(out, col, seen));
  }

  pushList(requiredStart);

  // KM/Metas periods
  const p = Math.max(1, Math.min(12, Number.isFinite(Number(periods)) ? Number(periods) : 3));
  for (let i = 1; i <= p; i += 1) {
    pushList([
      `DATA INICIO ${i}`,
      `DATA ATUAL ${i}`,
      `QTDE DIAS ${i}`,
      `KM RODADO ${i}`,
      `META KM ${i}`,
      `STATUS ${i}`,
    ]);
  }

  pushList(requiredTotals);
  pushList(evidenceInstall);
  pushList(evidenceCheckins);
  pushList(systemCols);

  return out;
}

export default buildMasterHeader;
