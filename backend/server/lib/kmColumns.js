// Heurística para detectar colunas relacionadas a períodos KM a partir do header
export function detectKmColumns(header = []) {
  const normalize = (s) => String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const result = {
    periods: {}, // periods[n] = { dataInicio, dataAtual, qtdeDias, kmRodado, metaKm, status }
    totals: {}, // kmRodadoTotal, metaKmTotal, statusTotal
    extras: {}, // checkIn, comentarios, observacoes
    nameColumn: null,
    driverIdColumn: null,
  };

  const periodFieldPatterns = [
    { key: 'dataInicio', re: /DATA\s*INICIO\s*(\d+)$/i },
    { key: 'dataAtual', re: /DATA\s*ATUAL\s*(\d+)$/i },
    { key: 'qtdeDias', re: /QTDE\s*DIAS\s*(\d+)$/i },
    { key: 'kmRodado', re: /KM\s*RODADO\s*(\d+)$/i },
    { key: 'metaKm', re: /META\s*KM\s*(\d+)$/i },
    { key: 'status', re: /STATUS\s*(\d+)$/i },
    // fallback patterns where number may be concatenated
    { key: 'kmRodado', re: /\bKM\s*(\d+)$/i },
  ];

  header.forEach((orig, idx) => {
    const h = normalize(orig);

    // detect name / driver id
    if (!result.nameColumn && /\bNOME\b|\bNAME\b/.test(h)) {
      result.nameColumn = { index: idx, key: orig };
    }
    if (!result.driverIdColumn && /DRIVER\s*ID|DRIVERID|\bID\b/.test(h) && /DRIVER/i.test(orig)) {
      result.driverIdColumn = { index: idx, key: orig };
    }

    // detect total columns
    if (!result.totals.kmRodadoTotal && /(KM\s*RODADO\s*TOTAL|KM\s*TOTAL)\b/.test(h)) {
      result.totals.kmRodadoTotal = { index: idx, key: orig };
    }
    if (!result.totals.metaKmTotal && /(META\s*KM\s*TOTAL|META\s*TOTAL)\b/.test(h)) {
      result.totals.metaKmTotal = { index: idx, key: orig };
    }
    if (!result.totals.statusTotal && /STATUS\s*TOTAL\b/.test(h)) {
      result.totals.statusTotal = { index: idx, key: orig };
    }

    // extras
    if (!result.extras.checkIn && /CHECK[-\s]?IN\b/.test(h)) {
      result.extras.checkIn = { index: idx, key: orig };
    }
    if (!result.extras.comentarios && /COMENTARIOS|COMENTARIOS|COMENTARIO|COMENTÁRIOS/.test(h)) {
      result.extras.comentarios = { index: idx, key: orig };
    }
    if (!result.extras.observacoes && /OBSERVACOES|OBSERVAÇÕES|OBSERVACAO/.test(h)) {
      result.extras.observacoes = { index: idx, key: orig };
    }

    // detect period-specific fields
    for (const p of periodFieldPatterns) {
      const m = String(orig || '').replace(/\s+/g, ' ').match(p.re);
      if (m && m[1]) {
        const n = Number(m[1]);
        if (!Number.isFinite(n)) continue;
        result.periods[n] = result.periods[n] || {};
        // store the original header label and index for this field
        result.periods[n][p.key] = { index: idx, key: orig };
      }
    }
  });

  // Derive periodCount from detected periods
  const periodNumbers = Object.keys(result.periods).map(k => Number(k)).filter(n => Number.isFinite(n));
  if (periodNumbers.length) {
    result.periodCount = Math.max(...periodNumbers);
  } else {
    result.periodCount = 0;
  }

  return result;
}

export default detectKmColumns;
