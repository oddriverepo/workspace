/* ════════════════════════════════════════════════════════════════════════════
 * CUSTOM WIDGETS — widgets customizáveis (gráficos)
 * Self-contained vanilla JS module. Usa Chart.js (CDN) e SortableJS (já carregado).
 * Persistência via /api/user-widgets (MongoDB). Escopo por usuário autenticado.
 *
 * Uso:
 *   window.CustomWidgets.init({
 *     context: 'overview' | 'campaigns',
 *     container: HTMLElement,
 *     getCampaigns: () => Array,   // opcional (fallback: fetch /api/campaigns)
 *     getDrivers:   () => Array,   // opcional (fallback: fetch /api/drivers)
 *     // Para context='campaigns', passar getDrivers retornando apenas os drivers da campanha atual
 *   });
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Dependências / utilidades ────────────────────────────────────────────
  const API_BASE = () => (window.API_BASE || '');
  const getToken = () => localStorage.getItem('adminToken') || '';

  async function apiFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const tk = getToken();
    if (tk) headers.Authorization = `Bearer ${tk}`;
    const resp = await fetch(`${API_BASE()}${path}`, { ...opts, headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(body || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // ── Chart.js loader ──────────────────────────────────────────────────────
  let _chartJsPromise = null;
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (_chartJsPromise) return _chartJsPromise;
    _chartJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      s.async = true;
      s.onload = () => resolve(window.Chart);
      s.onerror = () => reject(new Error('Falha ao carregar Chart.js'));
      document.head.appendChild(s);
    });
    return _chartJsPromise;
  }

  // ── Paleta de cores ──────────────────────────────────────────────────────
  const PALETTE = [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9',
    '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#f97316',
    '#3b82f6', '#a855f7', '#22c55e', '#eab308', '#06b6d4',
  ];
  // Paleta semântica para status de risco
  const RISK_COLORS = { 'Crítico': '#ef4444', 'Atenção': '#f59e0b', 'OK': '#10b981', 'Sem KM': '#94a3b8', 'Desatualizado': '#f97316' };
  const STATUS_COLORS = {
    'instalado': '#10b981', 'confirmado': '#6366f1', 'agendado': '#0ea5e9',
    'aguardando': '#f59e0b', 'cadastrando': '#84cc16', 'problema': '#ef4444',
    'revisar': '#f97316', 'ativa': '#10b981', 'pausada': '#f59e0b', 'encerrada': '#94a3b8',
  };

  const colorAt = (i) => PALETTE[i % PALETTE.length];
  const colorsFor = (labels) => labels.map(l => STATUS_COLORS[l?.toLowerCase()] || RISK_COLORS[l] || colorAt(Object.keys(STATUS_COLORS).length));

  // ── Acesso seguro a campos ───────────────────────────────────────────────
  function pick(obj, ...keys) {
    for (const k of keys) {
      const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), obj);
      if (v != null && v !== '') return v;
    }
    return null;
  }

  // ── Helpers de normalização (compatíveis com campaign.js) ────────────────
  const STATUS_NORM = {
    'instalado': 'Instalado', 'instalada': 'Instalado',
    'confirmado': 'Confirmado', 'confirmada': 'Confirmado',
    'agendado': 'Agendado', 'agendada': 'Agendado',
    'aguardando': 'Aguardando',
    'cadastrando': 'Cadastrando',
    'problema': 'Problema',
    'revisar': 'Revisar',
  };
  function normalizeStatus(v) {
    const s = String(v || '').trim().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return STATUS_NORM[s] || (v ? String(v).trim() : 'Sem status');
  }

  function normalizeAdhesion(v) {
    const s = String(v || '').trim().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (!s) return 'Sem status';
    if (s === 'agendado' || s === 'agendada') return 'Agendado';
    if (['concluido','concluida','instalado','instalada','finalizado'].includes(s)) return 'Concluído';
    if (['faltou','ausente','nao compareceu'].includes(s)) return 'Faltou';
    if (s === 'reagendado' || s === 'reagendada') return 'Reagendado';
    return String(v).trim() || 'Sem status';
  }

  function getDriverKmTravelled(d) {
    return Number(
      pick(d, 'kmTravelledValue', 'km_travelled_value', 'campaignData.totalKms', 'kmTravelled', 'kmTotal', 'km')
    ) || 0;
  }

  function getDriverKmHistorical(d) {
    return Number(
      pick(d, 'kmHistoricalTotal', 'km_historical_total', 'kmAllCampaignsValue', 'totalKmsAllCampaigns')
    ) || getDriverKmTravelled(d);
  }

  function getDriverRisk(d) {
    // Tenta usar _cwRisk pré-computado (injetado pelo campaign.js via enrichDrivers)
    if (d._cwRisk) return d._cwRisk;
    const st = normalizeStatus(pick(d, 'status', 'statusRaw')).toLowerCase();
    if (st === 'problema' || st === 'revisar') return 'Crítico';
    const km = getDriverKmTravelled(d);
    if (!km) return 'Sem KM';
    return 'OK'; // sem meta disponível neste contexto
  }

  function getDriverAdhesion(d) {
    const schedule = d?.schedule || {};
    const rawStatus = schedule.status || '';
    const rawFromSheet = Object.entries(d?.raw || {}).find(([k]) =>
      ['status adesivagem', 'situacao adesivagem', 'situação adesivagem']
        .includes(k.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''))
    );
    return normalizeAdhesion(rawStatus || rawFromSheet?.[1] || '');
  }

  function getDriverMainApp(d) {
    if (d.mainApp) return String(d.mainApp).trim();
    if (Array.isArray(d.appsRegistered) && d.appsRegistered.length) {
      return String(d.appsRegistered[0]).trim();
    }
    return 'Não informado';
  }

  function getDriverPhotos(d) {
    // fotos enviadas pelo motorista (flow driver)
    const count = Number(pick(d, 'photosCount', 'photos_count', 'evidences_count', 'evidencesCount')) || 0;
    return count > 0 ? 'Com fotos' : 'Sem fotos';
  }

  // ── Definições de parâmetros ─────────────────────────────────────────────
  // type: 'chart' — produz distribuição (labels + valores) → renderizado como gráfico
  //       'kpi'   — produz um único número → renderizado como card de métrica
  // group: agrupa nos <optgroup> do select
  // context: undefined = ambos, 'overview' = só visão geral, 'campaigns' = só campanha detalhe
  const PARAMS = {
    // ══════════════════════════════════════════════════════════════════════
    // KPIs — métricas simples (número único, sem eixo X)
    // ══════════════════════════════════════════════════════════════════════
    kpi_total_drivers: {
      type: 'kpi',
      label: 'Total de motoristas',
      group: 'KPIs — Motoristas',
      source: 'drivers',
      unit: 'motoristas',
      accent: '#6366f1',
      compute: (items) => items.length,
    },
    kpi_active_drivers: {
      type: 'kpi',
      label: 'Motoristas instalados / ativos',
      group: 'KPIs — Motoristas',
      source: 'drivers',
      unit: 'motoristas',
      accent: '#10b981',
      compute: (items) => items.filter(d => {
        const s = normalizeStatus(pick(d, 'status', 'statusRaw') || '').toLowerCase();
        return s === 'instalado' || s === 'confirmado';
      }).length,
    },
    kpi_critical_drivers: {
      type: 'kpi',
      label: 'Motoristas em risco crítico',
      group: 'KPIs — Motoristas',
      source: 'drivers',
      unit: 'motoristas',
      accent: '#ef4444',
      compute: (items) => items.filter(d => {
        const r = typeof d._cwRisk === 'string' ? d._cwRisk : getDriverRisk(d);
        return r === 'Crítico';
      }).length,
    },
    kpi_total_km: {
      type: 'kpi',
      label: 'KM total rodado',
      group: 'KPIs — KM',
      source: 'drivers',
      unit: 'km',
      accent: '#0ea5e9',
      compute: (items) => Math.round(items.reduce((s, d) => s + getDriverKmTravelled(d), 0)),
    },
    kpi_historical_total_km: {
      type: 'kpi',
      label: 'KM histórico total rodado',
      group: 'KPIs â€” KM',
      source: 'drivers',
      context: 'overview',
      unit: 'km',
      accent: '#0284c7',
      compute: (items) => Math.round(items.reduce((s, d) => s + getDriverKmHistorical(d), 0)),
    },
    kpi_avg_km_progress: {
      type: 'kpi',
      label: '% média de meta KM atingida',
      group: 'KPIs — KM',
      source: 'drivers',
      unit: '%',
      accent: '#8b5cf6',
      compute: (items) => {
        const withKm = items.filter(d => typeof d._cwProgressPct === 'number' && d._cwProgressPct > 0);
        if (!withKm.length) return 0;
        return Math.round(withKm.reduce((s, d) => s + d._cwProgressPct, 0) / withKm.length);
      },
    },
    kpi_drivers_with_km: {
      type: 'kpi',
      label: 'Motoristas com KM registrado',
      group: 'KPIs — KM',
      source: 'drivers',
      unit: 'motoristas',
      accent: '#14b8a6',
      compute: (items) => items.filter(d => getDriverKmTravelled(d) > 0).length,
    },
    kpi_total_campaigns: {
      type: 'kpi',
      label: 'Total de campanhas',
      group: 'KPIs — Campanhas',
      source: 'campaigns',
      context: 'overview',
      unit: 'campanhas',
      accent: '#f59e0b',
      compute: (items) => items.length,
    },
    kpi_active_campaigns: {
      type: 'kpi',
      label: 'Campanhas ativas',
      group: 'KPIs — Campanhas',
      source: 'campaigns',
      context: 'overview',
      unit: 'campanhas',
      accent: '#10b981',
      compute: (items) => items.filter(c => {
        const s = String(pick(c, 'status', 'apiData.status') || '').toLowerCase();
        return s === 'ativa' || s === 'ativo' || s === 'active';
      }).length,
    },

    // ══════════════════════════════════════════════════════════════════════
    // GRÁFICOS — distribuições (eixo X + valores)
    // ══════════════════════════════════════════════════════════════════════

    // ── Campanhas ──────────────────────────────────────────────────────────
    campaigns_by_status: {
      type: 'chart',
      label: 'Campanhas por status',
      group: 'Campanhas',
      source: 'campaigns',
      context: 'overview',
      group_fn: (c) => normalizeStatus(pick(c, 'status', 'apiData.status') || 'Sem status'),
      agg: 'count',
    },
    campaigns_by_client: {
      type: 'chart',
      label: 'Campanhas (por nome)',
      group: 'Campanhas',
      source: 'campaigns',
      context: 'overview',
      group_fn: (c) => (c.name || '').trim() || 'Sem nome',
      agg: 'count',
    },
    campaigns_by_city: {
      type: 'chart',
      label: 'Campanhas por cidade/estado',
      group: 'Campanhas',
      source: 'campaigns',
      context: 'overview',
      group_fn: (c) => String(
        pick(c, 'apiData.city', 'city', 'apiData.state', 'state') || 'Sem localização'
      ).trim() || 'Sem localização',
      agg: 'count',
    },
    // ── Motoristas — Status ────────────────────────────────────────────────
    drivers_by_status: {
      type: 'chart',
      label: 'Motoristas por status',
      group: 'Motoristas — Status',
      source: 'drivers',
      group_fn: (d) => normalizeStatus(pick(d, 'status', 'statusRaw', 'raw.Status') || 'Sem status'),
      agg: 'count',
    },
    drivers_by_adhesion: {
      type: 'chart',
      label: 'Motoristas por status de adesivagem',
      group: 'Motoristas — Status',
      source: 'drivers',
      group_fn: (d) => getDriverAdhesion(d),
      agg: 'count',
    },
    drivers_by_app: {
      type: 'chart',
      label: 'Motoristas por aplicativo principal',
      group: 'Motoristas — Status',
      source: 'drivers',
      group_fn: (d) => getDriverMainApp(d),
      agg: 'count',
    },
    drivers_by_photos: {
      type: 'chart',
      label: 'Motoristas com / sem fotos enviadas',
      group: 'Evidências',
      source: 'drivers',
      group_fn: (d) => getDriverPhotos(d),
      agg: 'count',
    },
    // ── Motoristas — Localização ───────────────────────────────────────────
    drivers_by_city: {
      type: 'chart',
      label: 'Motoristas por cidade',
      group: 'Motoristas — Localização',
      source: 'drivers',
      group_fn: (d) => String(pick(d, 'city', 'address.city', 'apiData.city') || 'Sem cidade').trim() || 'Sem cidade',
      agg: 'count',
    },
    drivers_by_campaign: {
      type: 'chart',
      label: 'Motoristas por campanha',
      group: 'Motoristas — Localização',
      source: 'drivers',
      context: 'overview',
      group_fn: (d, ctx) => {
        const cid = pick(d, 'campaignId', 'campaign_id', 'campaign.id');
        if (!cid) return 'Sem campanha';
        const c = ctx.campaignsById.get(String(cid));
        return c ? (c.name || c.title || String(cid)) : String(cid);
      },
      agg: 'count',
    },
    // ── Motoristas — KM ───────────────────────────────────────────────────
    km_total_by_campaign: {
      type: 'chart',
      label: 'KM total por campanha',
      group: 'Motoristas — KM',
      source: 'drivers',
      context: 'overview',
      group_fn: (d, ctx) => {
        const cid = pick(d, 'campaignId', 'campaign_id', 'campaign.id');
        if (!cid) return 'Sem campanha';
        const c = ctx.campaignsById.get(String(cid));
        return c ? (c.name || c.title || String(cid)) : String(cid);
      },
      agg: 'sum',
      value: (d) => getDriverKmTravelled(d),
      unit: 'km',
    },
    km_by_driver: {
      type: 'chart',
      label: 'KM rodado por motorista',
      group: 'Motoristas — KM',
      source: 'drivers',
      group_fn: (d) => String(d?.name || d?.id || 'Motorista').trim(),
      agg: 'sum',
      value: (d) => getDriverKmTravelled(d),
      unit: 'km',
    },
    km_progress_pct_by_driver: {
      type: 'chart',
      label: '% progresso de KM por motorista',
      group: 'Motoristas — KM',
      source: 'drivers',
      group_fn: (d) => String(d?.name || d?.id || 'Motorista').trim(),
      agg: 'sum',
      value: (d) => (typeof d._cwProgressPct === 'number' ? Math.round(d._cwProgressPct) : 0),
      unit: '%',
    },
    // ── Motoristas — Risco ─────────────────────────────────────────────────
    drivers_by_risk: {
      type: 'chart',
      label: 'Motoristas por nível de risco de KM',
      group: 'Motoristas — Risco',
      source: 'drivers',
      group_fn: (d) => (typeof d._cwRisk === 'string' ? d._cwRisk : getDriverRisk(d)),
      agg: 'count',
    },
    drivers_by_stale: {
      type: 'chart',
      label: 'KM atualizado vs. desatualizado',
      group: 'Motoristas — Risco',
      source: 'drivers',
      group_fn: (d) => (d._cwStale ? 'KM desatualizado' : 'KM atualizado'),
      agg: 'count',
    },
    drivers_by_km_data: {
      type: 'chart',
      label: 'Motoristas com / sem KM registrado',
      group: 'Motoristas — Risco',
      source: 'drivers',
      group_fn: (d) => (getDriverKmTravelled(d) > 0 ? 'Com KM' : 'Sem KM'),
      agg: 'count',
    },
    drivers_by_km_range: {
      type: 'chart',
      label: 'Motoristas por faixa de progresso KM',
      group: 'Motoristas — Risco',
      source: 'drivers',
      group_fn: (d) => {
        const km = getDriverKmTravelled(d);
        if (!km) return 'Sem KM';
        const pct = typeof d._cwProgressPct === 'number' ? d._cwProgressPct : 0;
        if (pct === 0) return 'Sem KM';
        if (pct < 50)  return '1 – 49%';
        if (pct < 100) return '50 – 99%';
        return '100%+';
      },
      agg: 'count',
    },
  };

  // ── Cruzamentos válidos por parâmetro ────────────────────────────────────────────
  // Apenas combinações que geram insight real são listadas
  const CROSSWITH = {
    campaigns_by_status:        ['campaigns_by_client', 'campaigns_by_city'],
    campaigns_by_client:        ['campaigns_by_status', 'campaigns_by_city'],
    campaigns_by_city:          ['campaigns_by_status', 'campaigns_by_client'],
    // drivers: cruzamentos por status incluem todas as dimensões binárias de risco
    drivers_by_status:          ['drivers_by_city', 'drivers_by_app', 'drivers_by_risk', 'drivers_by_adhesion', 'drivers_by_photos', 'drivers_by_km_range', 'drivers_by_km_data', 'drivers_by_stale'],
    drivers_by_adhesion:        ['drivers_by_status', 'drivers_by_risk', 'drivers_by_city', 'drivers_by_app', 'drivers_by_km_data', 'drivers_by_stale'],
    drivers_by_app:             ['drivers_by_status', 'drivers_by_risk', 'drivers_by_city', 'drivers_by_km_data'],
    drivers_by_photos:          ['drivers_by_status', 'drivers_by_risk'],
    drivers_by_city:            ['drivers_by_status', 'drivers_by_risk', 'drivers_by_app', 'drivers_by_adhesion', 'drivers_by_km_range'],
    drivers_by_campaign:        ['drivers_by_status', 'drivers_by_risk'],
    // km por campanha é útil cruzado com risco/status dos motoristas
    km_total_by_campaign:       ['drivers_by_risk', 'drivers_by_status', 'drivers_by_adhesion'],
    km_by_driver:               ['drivers_by_risk'],
    km_progress_pct_by_driver:  ['drivers_by_risk'],
    drivers_by_risk:            ['drivers_by_status', 'drivers_by_city', 'drivers_by_app', 'drivers_by_adhesion', 'drivers_by_photos', 'drivers_by_km_range', 'drivers_by_km_data', 'drivers_by_stale'],
    drivers_by_stale:           ['drivers_by_status', 'drivers_by_risk'],
    drivers_by_km_data:         ['drivers_by_status', 'drivers_by_risk'],
    drivers_by_km_range:        ['drivers_by_status', 'drivers_by_city', 'drivers_by_app', 'drivers_by_risk'],
  };

  // Parâmetros que NÃO devem aparecer como eixo B (não fazem sentido como dimensão secundária)
  const NO_CROSS_AXIS = new Set([
    'km_by_driver', 'km_progress_pct_by_driver', 'km_total_by_campaign', 'drivers_by_campaign',
  ]);

  // Ordem dos grupos nos <optgroup>
  const PARAM_GROUPS = [
    'KPIs — Campanhas',
    'KPIs — Motoristas',
    'KPIs — KM',
    'Campanhas',
    'Motoristas — Status',
    'Motoristas — Localização',
    'Motoristas — KM',
    'Motoristas — Risco',
    'Evidências',
  ];

  const CHART_TYPES = [
    { value: 'bar',      label: 'Barras' },
    { value: 'line',     label: 'Linha' },
    { value: 'pie',      label: 'Pizza' },
    { value: 'doughnut', label: 'Donut' },
  ];

  // ── Filtro de parâmetros por contexto ────────────────────────────────────
  function paramsForContext(context) {
    return Object.fromEntries(
      Object.entries(PARAMS).filter(([, def]) =>
        !def.context || def.context === context
      )
    );
  }

  // ── Build do contexto de dados ───────────────────────────────────────────
  function buildContext(campaigns, drivers) {
    const campaignsById = new Map();
    (campaigns || []).forEach(c => {
      const id = c?.id ?? c?._id;
      if (id != null) campaignsById.set(String(id), c);
    });
    return { campaigns: campaigns || [], drivers: drivers || [], campaignsById };
  }

  // ── Cálculo dos dados ────────────────────────────────────────────────────
  function computeWidgetData(config, ctx) {
    const a = PARAMS[config.paramA];
    if (!a) return { labels: [], values: [], colors: [] };

    // ── KPI: retorna objeto com type:'kpi' e value numérico ─────────────────
    if (a.type === 'kpi') {
      const items = ctx[a.source] || [];
      const value = a.compute(items);
      return { type: 'kpi', value, unit: a.unit || '', accent: a.accent || '#6366f1' };
    }

    // ── Chart: distribuição ─────────────────────────────────────────────────
    const items = ctx[a.source] || [];

    // Sem cruzamento
    if (!config.paramB) {
      const buckets = new Map();
      for (const it of items) {
        const k = a.group_fn(it, ctx);
        const v = a.agg === 'sum' ? (a.value ? a.value(it) : 0) : 1;
        if (!k) continue;
        buckets.set(k, (buckets.get(k) || 0) + v);
      }
      const entries = Array.from(buckets.entries())
        .sort((x, y) => y[1] - x[1])
        .slice(0, 15);
      const labels = entries.map(e => e[0]);
      const values = entries.map(e => Math.round(e[1] * 10) / 10);
      return { type: 'chart', labels, values, colors: colorsFor(labels), unit: a.unit };
    }

    // Com cruzamento
    const b = PARAMS[config.paramB];
    if (!b || b.source !== a.source || b.type === 'kpi') {
      return computeWidgetData({ ...config, paramB: null }, ctx);
    }
    const matrix = new Map();
    const labelsBSet = new Set();
    for (const it of items) {
      const ka = a.group_fn(it, ctx);
      const kb = b.group_fn(it, ctx);
      if (!ka || !kb) continue;
      labelsBSet.add(kb);
      if (!matrix.has(ka)) matrix.set(ka, new Map());
      const inner = matrix.get(ka);
      const v = a.agg === 'sum' ? (a.value ? a.value(it) : 0) : 1;
      inner.set(kb, (inner.get(kb) || 0) + v);
    }
    const labelsA = Array.from(matrix.entries())
      .map(([k, m]) => [k, Array.from(m.values()).reduce((s, v) => s + v, 0)])
      .sort((x, y) => y[1] - x[1]).slice(0, 12).map(e => e[0]);
    const labelsB = Array.from(labelsBSet)
      .map(kb => [kb, Array.from(matrix.values()).reduce((s, m) => s + (m.get(kb) || 0), 0)])
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(e => e[0]);
    const datasets = labelsB.map((kb, idx) => ({
      label: kb,
      data: labelsA.map(ka => Math.round((matrix.get(ka)?.get(kb) || 0) * 10) / 10),
      color: colorAt(idx),
    }));
    return { type: 'chart', labels: labelsA, datasets, isCross: true };
  }

  // ── Render do gráfico via Chart.js ───────────────────────────────────────
  async function renderChart(canvas, config, data, fastRender = false) {
    const Chart = await ensureChartJs();
    if (canvas._cwChart) { canvas._cwChart.destroy(); canvas._cwChart = null; }
    const isCircular = config.chartType === 'pie' || config.chartType === 'doughnut';
    const unit = data.unit || '';

    let chartConfig;
    if (data.isCross) {
      chartConfig = {
        type: isCircular ? 'bar' : config.chartType,
        data: {
          labels: data.labels,
          datasets: data.datasets.map(ds => ({
            label: ds.label,
            data: ds.data,
            backgroundColor: ds.color + 'cc',
            borderColor: ds.color,
            borderWidth: 1.5,
            tension: 0.35,
            fill: false,
            pointRadius: config.chartType === 'line' ? 3 : 0,
          })),
        },
        options: baseChartOptions(true, unit, fastRender),
      };
    } else {
      chartConfig = {
        type: config.chartType,
        data: {
          labels: data.labels,
          datasets: [{
            label: unit ? `Total (${unit})` : 'Total',
            data: data.values,
            backgroundColor: isCircular ? data.colors : data.colors.map(c => c + 'cc'),
            borderColor: isCircular ? '#fff' : data.colors,
            borderWidth: isCircular ? 2 : 1.5,
            tension: 0.35,
            fill: false,
            pointRadius: config.chartType === 'line' ? 3 : 0,
          }],
        },
        options: baseChartOptions(isCircular || data.labels.length <= 8, unit, fastRender),
      };
    }
    canvas._cwChart = new Chart(canvas.getContext('2d'), chartConfig);
  }

  function baseChartOptions(showLegend, unit, fastRender = false) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: fastRender ? false : { duration: 150, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: !!showLegend,
          position: 'bottom',
          labels: { boxWidth: 10, boxHeight: 10, padding: 8, font: { size: 11 }, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          padding: 10,
          cornerRadius: 8,
          titleFont: { size: 12, weight: '600' },
          bodyFont: { size: 12 },
          callbacks: unit ? {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.formattedValue}${unit}`,
          } : undefined,
        },
      },
    };
  }

  // ── Render de KPI (card e preview) ───────────────────────────────────────
  function renderKpiCard(container, data, title) {
    const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('pt-BR') : '—';
    container.innerHTML = `
      <div class="cw-kpi-body">
        <div class="cw-kpi-number" style="color:${escapeHTML(data.accent)}">${fmt(data.value)}</div>
        <div class="cw-kpi-unit">${escapeHTML(data.unit)}</div>
      </div>
    `;
  }

  // ── Populate selects (usando optgroup por categoria) ─────────────────────
  function populateParamSelect(sel, context, includeNone, onlyCharts, crossWithKey) {
    sel.innerHTML = '';
    if (includeNone) {
      const none = document.createElement('option');
      none.value = ''; none.textContent = '— Nenhum —';
      sel.appendChild(none);
    }
    const filtered = paramsForContext(context);
    // Se crossWithKey fornecido: filtra B pelos cruzamentos válidos do A selecionado
    const isForB = crossWithKey !== undefined;
    const validSet = (isForB && CROSSWITH[crossWithKey]) ? new Set(CROSSWITH[crossWithKey]) : null;
    PARAM_GROUPS.forEach(groupName => {
      const entries = Object.entries(filtered).filter(([key, d]) => {
        if (d.group !== groupName) return false;
        if (onlyCharts && d.type !== 'chart') return false;
        if (isForB) {
          if (NO_CROSS_AXIS.has(key)) return false;          // sem lista explícita: aceita todos os chart do mesmo source
          if (validSet && !validSet.has(key)) return false;
        }
        return true;
      });
      if (!entries.length) return;
      const og = document.createElement('optgroup');
      og.label = groupName;
      entries.forEach(([key, def]) => {
        const o = document.createElement('option');
        o.value = key; o.textContent = def.label;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }

  // Mostra/esconde seções do modal conforme o tipo do parâmetro selecionado
  function updateModalMode(paramKey) {
    if (!_modalRoot) return;
    const def = PARAMS[paramKey];
    const isKpi = def?.type === 'kpi';
    // Seção de tipo de gráfico
    const chartSection = _modalRoot.querySelector('#cwChartTypes')?.closest('.cw-field');
    // Seção de cruzamento
    const crossSection = _modalRoot.querySelector('#cwParamB')?.closest('.cw-field');
    if (chartSection) chartSection.style.display = isKpi ? 'none' : '';
    if (crossSection) crossSection.style.display = isKpi ? 'none' : '';
  }

  // ── Modal de criação/edição ──────────────────────────────────────────────
  let _modalRoot = null;
  function ensureModal() {
    if (_modalRoot) return _modalRoot;
    _modalRoot = document.createElement('div');
    _modalRoot.className = 'cw-modal-root';
    _modalRoot.innerHTML = `
      <div class="cw-modal-backdrop" data-cw-dismiss></div>
      <div class="cw-modal-card" role="dialog" aria-modal="true" aria-labelledby="cwModalTitle">
        <button type="button" class="cw-modal-close" data-cw-dismiss aria-label="Fechar">&times;</button>
        <header class="cw-modal-head">
          <h2 id="cwModalTitle">Novo widget</h2>
          <p class="cw-modal-sub">Personalize um indicador gráfico para acompanhar suas métricas.</p>
        </header>
        <form class="cw-modal-form" id="cwModalForm" novalidate>
          <div class="cw-field">
            <label for="cwTitle">Título</label>
            <input type="text" id="cwTitle" name="title" maxlength="80" placeholder="Ex.: Motoristas críticos de KM" required />
          </div>

          <div class="cw-field-row">
            <div class="cw-field">
              <label for="cwParamA">Indicador</label>
              <select id="cwParamA" name="paramA" required></select>
            </div>
            <div class="cw-field">
              <label for="cwParamB">Cruzar com <span class="cw-muted">(opcional)</span></label>
              <select id="cwParamB" name="paramB"></select>
            </div>
          </div>

          <div class="cw-field">
            <label>Tipo de visualização</label>
            <div class="cw-chart-types" id="cwChartTypes"></div>
          </div>

          <div class="cw-preview" id="cwPreview">
            <div class="cw-preview-head"><span>Pré-visualização</span></div>
            <div class="cw-preview-body"><canvas id="cwPreviewCanvas"></canvas></div>
          </div>

          <div class="cw-modal-actions">
            <button type="button" class="cw-btn cw-btn-ghost" data-cw-dismiss>Cancelar</button>
            <button type="submit" class="cw-btn cw-btn-primary" id="cwSubmitBtn">Salvar widget</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(_modalRoot);

    // Tipos de gráfico (radio cards) — populados uma vez
    const typesWrap = _modalRoot.querySelector('#cwChartTypes');
    CHART_TYPES.forEach((t, idx) => {
      const id = `cwType_${t.value}`;
      const label = document.createElement('label');
      label.className = 'cw-chart-type';
      label.innerHTML = `
        <input type="radio" name="chartType" value="${t.value}" id="${id}" ${idx === 0 ? 'checked' : ''} />
        <span class="cw-chart-type-inner">
          ${chartTypeIcon(t.value)}
          <span>${t.label}</span>
        </span>
      `;
      typesWrap.appendChild(label);
    });

    _modalRoot.querySelectorAll('[data-cw-dismiss]').forEach(el =>
      el.addEventListener('click', () => closeModal())
    );
    _modalRoot.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    return _modalRoot;
  }

  function chartTypeIcon(type) {
    if (type === 'bar') return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="9"/><rect x="11" y="6" width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>`;
    if (type === 'line') return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 9 11 13 15 21 6"/></svg>`;
    if (type === 'pie') return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M21 12H12V3a9 9 0 0 1 9 9z"/></svg>`;
    return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>`;
  }

  let _activeModalState = null;

  function openModal({ context, editing, ctx, onSave }) {
    ensureModal();
    _activeModalState = { context, editing: editing || null, onSave, ctx };

    const root = _modalRoot;
    root.classList.add('is-open');
    document.body.classList.add('cw-modal-open');

    const form = root.querySelector('#cwModalForm');
    const title = root.querySelector('#cwModalTitle');
    const submitBtn = root.querySelector('#cwSubmitBtn');

    title.textContent = editing ? 'Editar widget' : 'Novo widget';
    submitBtn.textContent = editing ? 'Salvar alterações' : 'Salvar widget';
    submitBtn.disabled = false;

    // Popular selects filtrados pelo contexto
    const selA = form.querySelector('#cwParamA');
    const selB = form.querySelector('#cwParamB');
    populateParamSelect(selA, context, false, false);

    // Pre-fill paramA primeiro para poder filtrar as opções válidas de cruzamento
    form.title.value = editing?.title || '';
    selA.value = editing?.paramA || selA.options[0]?.value || '';
    const chartType = editing?.chartType || 'bar';
    form.querySelectorAll('input[name="chartType"]').forEach(r => { r.checked = (r.value === chartType); });

    // Popula B com filtro de cruzamentos válidos baseado no A já selecionado
    populateParamSelect(selB, context, true, true, selA.value);
    selB.value = editing?.paramB || '';

    // Modo inicial (KPI vs chart)
    updateModalMode(selA.value);

    // Quando muda o indicador A: re-filtra opções de B, atualiza modo e preview
    selA.onchange = () => {
      updateModalMode(selA.value);
      const prevB = selB.value;
      populateParamSelect(selB, context, true, true, selA.value);
      selB.value = prevB; // tenta manter seleção anterior se ainda válida
      updatePreview();
    };

    setTimeout(() => form.title.focus(), 30);

    const updatePreview = debounce(() => renderModalPreview(), 100);
    form.removeEventListener('input', form._cwInputHandler || (() => {}));
    form.removeEventListener('change', form._cwChangeHandler || (() => {}));
    form._cwInputHandler = updatePreview;
    form._cwChangeHandler = updatePreview;
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);

    form.onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        title: form.title.value.trim(),
        paramA: selA.value,
        paramB: selB.value || null,
        chartType: form.querySelector('input[name="chartType"]:checked')?.value || 'bar',
        context,
      };
      if (!payload.title) { form.title.focus(); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Salvando…';
      try {
        const result = editing
          ? await apiFetch(`/api/user-widgets/${encodeURIComponent(editing.id)}`, {
              method: 'PUT', body: JSON.stringify(payload),
            })
          : await apiFetch('/api/user-widgets', {
              method: 'POST', body: JSON.stringify(payload),
            });
        closeModal();
        if (typeof onSave === 'function') onSave(result.item);
      } catch (err) {
        console.error('[CustomWidgets] Erro ao salvar:', err);
        alert('Não foi possível salvar o widget. Tente novamente.');
        submitBtn.disabled = false;
        submitBtn.textContent = editing ? 'Salvar alterações' : 'Salvar widget';
      }
    };

    renderModalPreview();
  }

  function closeModal() {
    if (!_modalRoot) return;
    _modalRoot.classList.remove('is-open');
    document.body.classList.remove('cw-modal-open');
    const c = _modalRoot.querySelector('#cwPreviewCanvas');
    if (c && c._cwChart) { c._cwChart.destroy(); c._cwChart = null; }
    _activeModalState = null;
  }

  async function renderModalPreview() {
    if (!_activeModalState) return;
    const form = _modalRoot.querySelector('#cwModalForm');
    const selA = form.querySelector('#cwParamA');
    const config = {
      paramA: selA.value,
      paramB: form.querySelector('#cwParamB').value || null,
      chartType: form.querySelector('input[name="chartType"]:checked')?.value || 'bar',
    };
    const data = computeWidgetData(config, _activeModalState.ctx);
    const cardBody = _modalRoot.querySelector('.cw-preview-body');

    // ── KPI preview ─────────────────────────────────────────────────────────
    if (data.type === 'kpi') {
      const c = cardBody.querySelector('canvas');
      if (c?._cwChart) { c._cwChart.destroy(); c._cwChart = null; }
      renderKpiCard(cardBody, data);
      return;
    }

    // ── Chart preview ───────────────────────────────────────────────────────
    if (!data.labels?.length) {
      const c = cardBody.querySelector('canvas');
      if (c?._cwChart) { c._cwChart.destroy(); c._cwChart = null; }
      cardBody.innerHTML = '<div class="cw-empty">Sem dados para a combinação selecionada.</div>';
      return;
    }
    if (!cardBody.querySelector('canvas')) {
      cardBody.innerHTML = '<canvas id="cwPreviewCanvas"></canvas>';
    }
    const canvas = cardBody.querySelector('canvas');
    try { await renderChart(canvas, config, data, true); } // fastRender: sem animação no preview
    catch (err) { console.warn('[CustomWidgets] preview falhou', err); }
  }

  // ── Widget card HTML ─────────────────────────────────────────────────────
  function buildWidgetCardHTML(widget) {
    const a = PARAMS[widget.paramA];
    const b = PARAMS[widget.paramB];
    const isKpi = a?.type === 'kpi';
    const subtitle = a ? ((!isKpi && b) ? `${a.label} × ${b.label}` : a.label) : '';
    const w = (typeof widget.w === 'number' && widget.w >= 1) ? widget.w : 1;
    const h = (typeof widget.h === 'number' && widget.h >= 1) ? widget.h : 1;
    const widthPx = typeof widget.widthPx === 'number' ? widget.widthPx : null;
    const heightPx = typeof widget.heightPx === 'number' ? widget.heightPx : null;
    const inlineStyle = widthPx
      ? `width: ${widthPx}px; height: ${heightPx || 270}px; flex: 0 0 auto;`
      : heightPx ? `height: ${heightPx}px;` : '';
    const bodyInner = isKpi
      ? `<div class="cw-kpi-body cw-kpi-body--loading">
           <div class="cw-kpi-number">—</div>
           <div class="cw-kpi-unit">${escapeHTML(a?.unit || '')}</div>
         </div>`
      : `<canvas></canvas>`;
    return `
      <article class="cw-card${isKpi ? ' cw-card--kpi' : ''}" data-widget-id="${escapeHTML(widget.id)}"
               style="${inlineStyle}">
        <div class="cw-card-controls">
          <button type="button" class="cw-ctrl cw-ctrl-grip" title="Arrastar" aria-label="Arrastar">
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.4"/><circle cx="10.5" cy="3.5" r="1.4"/><circle cx="5.5" cy="8" r="1.4"/><circle cx="10.5" cy="8" r="1.4"/><circle cx="5.5" cy="12.5" r="1.4"/><circle cx="10.5" cy="12.5" r="1.4"/></svg>
          </button>
          <button type="button" class="cw-ctrl cw-ctrl-edit" data-cw-action="edit" title="Editar" aria-label="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button type="button" class="cw-ctrl cw-ctrl-close" data-cw-action="delete" title="Remover" aria-label="Remover">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="13" height="13" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </div>
        <header class="cw-card-head">
          <h3 class="cw-card-title">${escapeHTML(widget.title)}</h3>
          <p class="cw-card-sub">${escapeHTML(subtitle)}</p>
        </header>
        <div class="cw-card-body">${bodyInner}</div>
        <button type="button" class="cw-resize-handle" title="Arrastar para redimensionar" aria-label="Redimensionar"><svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><polyline points="3,9 9,9 9,3"/><line x1="4" y1="6" x2="9" y2="1"/></svg></button>
      </article>
    `;
  }

  // ── Instâncias ───────────────────────────────────────────────────────────
  const _instances = new Map();

  async function fetchDataCtx(opts) {
    let campaigns = [];
    let drivers = [];
    // Quando callbacks são fornecidos o contexto é isolado — NUNCA cai no fetch global
    try {
      if (typeof opts.getCampaigns === 'function') {
        campaigns = opts.getCampaigns() || [];
      } else {
        const r = await apiFetch('/api/campaigns');
        campaigns = Array.isArray(r) ? r : (r?.items || r?.campaigns || []);
      }
    } catch (e) { console.warn('[CustomWidgets] campanhas:', e); }
    try {
      if (typeof opts.getDrivers === 'function') {
        drivers = opts.getDrivers() || [];
      } else {
        const r = await apiFetch('/api/drivers');
        drivers = r?.items || r?.drivers || (Array.isArray(r) ? r : []);
      }
    } catch (e) { console.warn('[CustomWidgets] motoristas:', e); }
    return buildContext(campaigns, drivers);
  }

  async function loadAndRender(context) {
    const inst = _instances.get(context);
    if (!inst) return;
    try {
      const [{ items }, dataCtx] = await Promise.all([
        apiFetch(`/api/user-widgets?context=${encodeURIComponent(context)}`),
        fetchDataCtx(inst.options),
      ]);
      inst.widgets = items || [];
      inst.dataCtx = dataCtx;
      renderGrid(context);
    } catch (err) {
      console.error('[CustomWidgets] falha ao carregar:', err);
      renderEmptyState(inst, 'Não foi possível carregar seus widgets.');
    }
  }

  function renderEmptyState(inst, msg) {
    const grid = inst.container.querySelector('.cw-grid');
    if (!grid) return;
    inst.container.classList.add('cw-host--empty');
    grid.innerHTML = '';
    if (msg) {
      // Apenas erros mostram mensagem; sem widgets é silencioso
      grid.innerHTML = `<div class="cw-grid-empty">${escapeHTML(msg)}</div>`;
      inst.container.classList.remove('cw-host--empty');
    }
  }

  function renderGrid(context) {
    const inst = _instances.get(context);
    if (!inst) return;
    const grid = inst.container.querySelector('.cw-grid');
    if (!grid) return;

    if (!inst.widgets.length) { renderEmptyState(inst); return; }

    inst.container.classList.remove('cw-host--empty');
    grid.innerHTML = inst.widgets.map(buildWidgetCardHTML).join('');

    inst.widgets.forEach(w => {
      const card = grid.querySelector(`[data-widget-id="${CSS.escape(w.id)}"]`);
      if (!card) return;
      const data = computeWidgetData(w, inst.dataCtx);

      // ── KPI ──────────────────────────────────────────────────────────────
      if (data.type === 'kpi') {
        const body = card.querySelector('.cw-card-body');
        renderKpiCard(body, data);
        return;
      }

      // ── Chart ─────────────────────────────────────────────────────────────
      const canvas = card.querySelector('canvas');
      if (!canvas) return;
      if (!data.labels?.length) {
        canvas.replaceWith(Object.assign(document.createElement('div'), {
          className: 'cw-empty', textContent: 'Sem dados disponíveis.'
        }));
        return;
      }
      renderChart(canvas, w, data).catch(err => console.warn('[CustomWidgets] chart', err));
    });

    grid.querySelectorAll('.cw-card').forEach(card => {
      card.querySelector('[data-cw-action="edit"]').onclick = (e) => {
        e.stopPropagation();
        const w = inst.widgets.find(x => x.id === card.getAttribute('data-widget-id'));
        if (!w) return;
        openModal({ context, editing: w, ctx: inst.dataCtx, onSave: () => loadAndRender(context) });
      };
      card.querySelector('[data-cw-action="delete"]').onclick = async (e) => {
        e.stopPropagation();
        const id = card.getAttribute('data-widget-id');
        const w = inst.widgets.find(x => x.id === id);
        if (!w || !confirm(`Remover o widget "${w.title}"?`)) return;
        try {
          await apiFetch(`/api/user-widgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
          inst.widgets = inst.widgets.filter(x => x.id !== id);
          renderGrid(context);
        } catch (err) { alert('Não foi possível remover o widget.'); }
      };
    });

    if (typeof Sortable !== 'undefined') {
      if (grid._cwSortable) grid._cwSortable.destroy();
      grid._cwSortable = new Sortable(grid, {
        animation: 200,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        handle: '.cw-ctrl-grip',
        ghostClass: 'cw-ghost',
        chosenClass: 'cw-chosen',
        dragClass: 'cw-drag',
        onEnd: async () => {
          const ids = Array.from(grid.children).map(el => el.getAttribute('data-widget-id')).filter(Boolean);
          try {
            await apiFetch('/api/user-widgets/order', { method: 'PATCH', body: JSON.stringify({ context, ids }) });
            inst.widgets.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
          } catch (err) { console.warn('[CustomWidgets] reorder', err); }
        },
      });
    }

    initResizeHandles(context);
  }

  // ── Resize de widgets (drag no canto inferior direito) ───────────────────
  // ── Resize fluido (pixel a pixel, sem snapping) ─────────────────────────

  function initResizeHandles(context) {
    const inst = _instances.get(context);
    if (!inst) return;
    const grid = inst.container.querySelector('.cw-grid');
    if (!grid) return;

    const MIN_W = 180;
    const MIN_H = 100;

    grid.querySelectorAll('.cw-resize-handle').forEach(handle => {
      const fresh = handle.cloneNode(true);
      handle.parentNode.replaceChild(fresh, handle);
      fresh.addEventListener('mousedown', onResizeStart);
      fresh.addEventListener('touchstart', onResizeStart, { passive: false });
    });

    function onResizeStart(e) {
      e.preventDefault();
      e.stopPropagation();

      const card = e.currentTarget.closest('[data-widget-id]');
      if (!card) return;
      const widgetId = card.dataset.widgetId;
      const wObj = inst.widgets.find(x => x.id === widgetId);
      if (!wObj) return;

      const touch = e.touches ? e.touches[0] : e;
      const startX = touch.clientX;
      const startY = touch.clientY;
      // Usa offsetWidth/Height para capturar o tamanho real atual
      const startW = card.offsetWidth;
      const startH = card.offsetHeight;

      // Fixa o tamanho imediatamente para evitar refluxo durante drag
      card.style.flex = '0 0 auto';
      card.style.width = startW + 'px';
      card.style.height = startH + 'px';
      card.classList.add('cw-card--resizing');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'se-resize';

      const maxW = grid.offsetWidth;

      function onMove(ev) {
        if (ev.cancelable) ev.preventDefault();
        const t = ev.touches ? ev.touches[0] : ev;
        const newW = Math.max(MIN_W, Math.min(maxW, startW + (t.clientX - startX)));
        const newH = Math.max(MIN_H, startH + (t.clientY - startY));
        card.style.width = newW + 'px';
        card.style.height = newH + 'px';
      }

      async function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);

        card.classList.remove('cw-card--resizing');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        const finalW = card.offsetWidth;
        const finalH = card.offsetHeight;

        wObj.widthPx = finalW;
        wObj.heightPx = finalH;

        // Redesenha chart
        const canvas = card.querySelector('canvas');
        if (canvas && canvas._cwChart) {
          canvas._cwChart.resize();
        } else if (canvas && inst.dataCtx) {
          const chartData = computeWidgetData(wObj, inst.dataCtx);
          if (chartData.labels && chartData.labels.length) {
            renderChart(canvas, wObj, chartData)
              .catch(err => console.warn('[CustomWidgets] chart resize redraw', err));
          }
        }

        // Salva no backend
        try {
          await apiFetch(`/api/user-widgets/${encodeURIComponent(widgetId)}/size`, {
            method: 'PATCH',
            body: JSON.stringify({ widthPx: finalW, heightPx: finalH }),
          });
        } catch (err) {
          console.warn('[CustomWidgets] resize save failed', err);
        }
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    }
  }


  // ── API pública ──────────────────────────────────────────────────────────
  function init(opts = {}) {
    const context = String(opts.context || '').trim();
    if (!context || (context !== 'overview' && context !== 'campaigns')) {
      console.warn('[CustomWidgets] init: context inválido'); return;
    }
    if (!opts.container || !(opts.container instanceof HTMLElement)) {
      console.warn('[CustomWidgets] init: container ausente'); return;
    }

    const host = opts.container;
    host.classList.add('cw-host');
    host.innerHTML = `
      <header class="cw-host-head">
        <div class="cw-host-title">
          <span class="cw-host-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
          </span>
          <h2>Meus indicadores</h2>
        </div>
        <button type="button" class="cw-add-btn" data-cw-add>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Adicionar widget</span>
        </button>
      </header>
      <div class="cw-grid"></div>
    `;

    _instances.set(context, { container: host, widgets: [], dataCtx: buildContext([], []), options: opts });

    const _openAdd = () => {
      const inst = _instances.get(context);
      // dataCtx já populado pelo loadAndRender inicial — zero latência no clique
      openModal({ context, ctx: inst.dataCtx, onSave: () => loadAndRender(context) });
    };

    host.querySelector('[data-cw-add]').addEventListener('click', _openAdd);

    // Botão externo (no header secundário) — se fornecido, esconde o interno
    if (opts.addBtnEl) {
      opts.addBtnEl.addEventListener('click', _openAdd);
      const internalBtn = host.querySelector('[data-cw-add]');
      if (internalBtn) internalBtn.style.display = 'none';
    }

    loadAndRender(context);

    // Pré-aquece: Chart.js (CDN) e modal DOM durante tempo ocioso do browser
    // Garante que o primeiro clique em "Adicionar widget" seja instantâneo
    ensureChartJs().catch(() => {});
    const _warmModal = () => ensureModal();
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(_warmModal, { timeout: 3000 })
      : setTimeout(_warmModal, 800);
  }

  /**
   * Enriquece um array de drivers com campos _cwRisk, _cwProgressPct, _cwStale
   * para que os parâmetros de risco/KM funcionem corretamente dentro de uma campanha.
   * Chamado pelo campaign.js antes de passar os drivers.
   *
   * @param {Array} drivers - array dos drivers
   * @param {number} minKmPerDriver - meta de KM por motorista
   * @param {number} [staleThresholdDays=7]
   */
  function enrichDrivers(drivers, minKmPerDriver, staleThresholdDays = 7) {
    const now = Date.now();
    (drivers || []).forEach(d => {
      const km = getDriverKmTravelled(d);
      const st = normalizeStatus(pick(d, 'status', 'statusRaw', 'raw.Status') || '').toLowerCase();

      // % progresso
      const pct = (km > 0 && minKmPerDriver > 0) ? (km / minKmPerDriver) * 100 : 0;
      d._cwProgressPct = pct;

      // Risco
      if (st === 'problema' || st === 'revisar') { d._cwRisk = 'Crítico'; }
      else if (!km) { d._cwRisk = 'Sem KM'; }
      else if (pct < 70) { d._cwRisk = 'Crítico'; }
      else if (pct < 100) { d._cwRisk = 'Atenção'; }
      else { d._cwRisk = 'OK'; }

      // Desatualizado
      const updatedAt = d?.km?.summary?.updatedAt || d?.km?.odometerUpdatedAt || d?.updatedAt;
      if (updatedAt) {
        const ts = typeof updatedAt === 'number' ? updatedAt : new Date(updatedAt).getTime();
        const daysDiff = (now - ts) / 86400000;
        if (km > 0 && daysDiff >= staleThresholdDays) {
          d._cwStale = true;
          if (d._cwRisk === 'OK') d._cwRisk = 'Atenção';
        } else {
          d._cwStale = false;
        }
      } else {
        d._cwStale = false;
      }
    });
    return drivers;
  }

  function refresh(context) {
    if (!_instances.has(context)) return;
    loadAndRender(context);
  }

  window.CustomWidgets = { init, refresh, enrichDrivers, PARAMS, CHART_TYPES };
})();
