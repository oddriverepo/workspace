/**
 * score-engine.js
 *
 * Motor de pontuação de motoristas (0–5, histórico acumulado).
 * Funções puras — sem I/O, sem efeitos colaterais.
 *
 * Critérios por campanha:
 *  - km:           peso 0.35  — km rodados vs meta
 *  - instalacao:   peso 0.30  — instalado no prazo (penalidade por atraso)
 *  - evidencias:   peso 0.20  — evidências enviadas dentro da janela
 *  - engajamento:  peso 0.10  — rapidez para agendar após início da campanha
 *  - semProblemas: peso 0.05  — ausência de status "problema"
 */

const WEIGHTS = {
  km:           0.35,
  instalacao:   0.30,
  evidencias:   0.20,
  engajamento:  0.10,
  semProblemas: 0.05,
};

const DEFAULT_EVIDENCE_WINDOW_DAYS = 30;
const MAX_INSTALL_DELAY_PENALTY_DAYS = 30; // após 30 dias de atraso, nota zero
const FAST_SCHEDULE_DAYS = 3; // agendar em até 3 dias = nota máxima
const SLOW_SCHEDULE_DAYS = 30; // agendar em 30+ dias = nota zero

/**
 * Calcula a nota de um motorista em uma campanha específica.
 *
 * @param {object} driver - Documento do motorista (api_drivers)
 * @param {object} campaign - Documento da campanha (api_campaigns)
 * @param {object[]} bookings - Bookings do motorista nessa campanha (scheduling_bookings)
 * @param {object[]} evidenceEntries - Evidências do motorista nessa campanha
 * @param {object} settings - Configurações da campanha (campaign_settings)
 * @returns {{ components: object, weightedScore: number, skipped: boolean }}
 */
export function scoreDriverCampaign(driver, campaign, bookings = [], evidenceEntries = [], settings = {}) {
  const components = {};
  let totalWeight = 0;
  let weightedSum = 0;

  // ── KM ──────────────────────────────────────────────────────────
  const kmTravelled = Number(driver.kmTravelledValue || driver.campaignData?.totalKms || 0);
  const kmMeta = Number(campaign.kmMinimumPerDriver || settings.kmMinimumPerDriver || 0);
  let kmScore = null;
  if (kmMeta > 0) {
    kmScore = Math.min(5, (kmTravelled / kmMeta) * 5);
    kmScore = Math.max(0, kmScore);
  }
  components.km = { score: kmScore, kmTravelled, kmMeta };
  if (kmScore !== null) {
    weightedSum += kmScore * WEIGHTS.km;
    totalWeight += WEIGHTS.km;
  }

  // ── INSTALAÇÃO ───────────────────────────────────────────────────
  const isInstalled = (driver.status === 'instalado') || (driver.status === 'concluido');
  let installScore = null;
  if (isInstalled) {
    // Calcular atraso: dias entre início da campanha e data de instalação
    const campaignStart = campaign.startDate
      ? new Date(campaign.startDate).getTime()
      : null;
    const installAt = driver.adhesion_start_at
      || driver.schedule?.initialAt
      || null;

    if (campaignStart && installAt) {
      const delayDays = Math.max(0, (Number(installAt) - campaignStart) / 86400000);
      // Sem atraso = 5.0; cada dia reduz; máximo de atraso = nota 0
      installScore = Math.max(0, 5 - (5 * delayDays / MAX_INSTALL_DELAY_PENALTY_DAYS));
    } else {
      // Instalado mas sem data precisa — nota média
      installScore = 3.0;
    }
  } else if (driver.status === 'problema') {
    installScore = 0;
  }
  components.instalacao = { score: installScore, status: driver.status };
  if (installScore !== null) {
    weightedSum += installScore * WEIGHTS.instalacao;
    totalWeight += WEIGHTS.instalacao;
  }

  // ── EVIDÊNCIAS ───────────────────────────────────────────────────
  const evidenceWindowDays = Number(settings.evidenceWindowDays || DEFAULT_EVIDENCE_WINDOW_DAYS);
  const campaignStartMs = campaign.startDate ? new Date(campaign.startDate).getTime() : null;
  const windowMs = evidenceWindowDays * 86400000;
  let evidScore = null;

  if (campaignStartMs) {
    const windowEnd = campaignStartMs + windowMs;
    const entriesInWindow = evidenceEntries.filter(e => {
      const ts = Number(e.createdAt || 0);
      return ts >= campaignStartMs && ts <= windowEnd;
    });
    // Ideal: pelo menos 6 evidências (um conjunto completo de fotos); escala linear
    const idealCount = 6;
    const ratio = Math.min(1, entriesInWindow.length / idealCount);
    evidScore = ratio * 5;
  } else if (evidenceEntries.length > 0) {
    // Sem data de início — dá crédito proporcional
    evidScore = Math.min(5, (evidenceEntries.length / 6) * 5);
  }
  components.evidencias = { score: evidScore, count: evidenceEntries.length, windowDays: evidenceWindowDays };
  if (evidScore !== null) {
    weightedSum += evidScore * WEIGHTS.evidencias;
    totalWeight += WEIGHTS.evidencias;
  }

  // ── ENGAJAMENTO (rapidez para agendar) ───────────────────────────
  const installBooking = bookings.find(b => b.type === 'installation' && b.status === 'confirmed');
  let engScore = null;
  if (installBooking && campaignStartMs) {
    const bookedAt = Number(installBooking.createdAt || 0);
    const daysToBook = Math.max(0, (bookedAt - campaignStartMs) / 86400000);
    if (daysToBook <= FAST_SCHEDULE_DAYS) {
      engScore = 5;
    } else if (daysToBook >= SLOW_SCHEDULE_DAYS) {
      engScore = 0;
    } else {
      engScore = 5 * (1 - (daysToBook - FAST_SCHEDULE_DAYS) / (SLOW_SCHEDULE_DAYS - FAST_SCHEDULE_DAYS));
    }
  }
  components.engajamento = { score: engScore };
  if (engScore !== null) {
    weightedSum += engScore * WEIGHTS.engajamento;
    totalWeight += WEIGHTS.engajamento;
  }

  // ── SEM PROBLEMAS ────────────────────────────────────────────────
  const noProblemsScore = driver.status === 'problema' ? 0 : 5;
  components.semProblemas = { score: noProblemsScore };
  weightedSum += noProblemsScore * WEIGHTS.semProblemas;
  totalWeight += WEIGHTS.semProblemas;

  // semProblemas nunca é null — totalWeight sempre > 0 aqui
  // Normaliza pela soma dos pesos efetivamente usados → resultado sempre 0–5,
  // mesmo quando componentes são pulados (ex: km sem meta definida).
  const weightedScore = Math.min(5, Math.max(0, weightedSum / totalWeight));

  return { components, weightedScore, skipped: false };
}

/**
 * Agrega pontuações de múltiplas campanhas em uma nota final.
 *
 * @param {Array<{ components: object, weightedScore: number, skipped: boolean }>} campaignScores
 * @returns {{ final: number, count: number }}
 */
export function aggregateDriverScore(campaignScores) {
  const valid = campaignScores.filter(s => !s.skipped && s.weightedScore !== null);
  if (valid.length === 0) return { final: null, count: 0 };
  const avg = valid.reduce((sum, s) => sum + s.weightedScore, 0) / valid.length;
  return {
    final: Math.round(avg * 10) / 10,
    count: valid.length,
  };
}
