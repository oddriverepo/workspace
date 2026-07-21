(function () {
  'use strict';

  var API_BASE = window.API_BASE || '';
  var TOKEN = localStorage.getItem('adminToken') || '';
  var SESSION_CACHE_TTL_MS = 90000;
  var CACHE_PREFIX = 'meta-ads:dashboard:';
  var state = {
    data: null,
    status: null,
    chartMetric: 'spend',
    loading: false,
  };

  var refs = {
    syncState: document.getElementById('syncState'),
    btnCopyReport: document.getElementById('btnCopyReport'),
    btnTheme: document.getElementById('btnTheme'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnApply: document.getElementById('btnApply'),
    btnRetry: document.getElementById('btnRetry'),
    accountSelect: document.getElementById('accountSelect'),
    periodPreset: document.getElementById('periodPreset'),
    dateFrom: document.getElementById('dateFrom'),
    dateTo: document.getElementById('dateTo'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    errorTitle: document.getElementById('errorTitle'),
    errorMessage: document.getElementById('errorMessage'),
    dashboardContent: document.getElementById('dashboardContent'),
    chartMetric: document.getElementById('chartMetric'),
    chartLegend: document.getElementById('chartLegend'),
    trendChart: document.getElementById('trendChart'),
    cityTableBody: document.getElementById('cityTableBody'),
    cityCount: document.getElementById('cityCount'),
    insightList: document.getElementById('insightList'),
    campaignSearch: document.getElementById('campaignSearch'),
    cityFilter: document.getElementById('cityFilter'),
    campaignTableBody: document.getElementById('campaignTableBody'),
    campaignEmpty: document.getElementById('campaignEmpty'),
    dataSource: document.getElementById('dataSource'),
    lastUpdated: document.getElementById('lastUpdated'),
    toast: document.getElementById('toast'),
  };

  var kpis = {
    spend: document.getElementById('kpiSpend'),
    period: document.getElementById('kpiPeriod'),
    leads: document.getElementById('kpiLeads'),
    cpl: document.getElementById('kpiCpl'),
    reach: document.getElementById('kpiReach'),
    impressions: document.getElementById('kpiImpressions'),
    frequency: document.getElementById('kpiFrequency'),
    clicks: document.getElementById('kpiClicks'),
    ctr: document.getElementById('kpiCtr'),
    cpc: document.getElementById('kpiCpc'),
    cpm: document.getElementById('kpiCpm'),
    replies: document.getElementById('kpiReplies'),
    replyRate: document.getElementById('kpiReplyRate'),
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function pad(value) { return String(value).padStart(2, '0'); }

  function toIsoDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function addDays(date, amount) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + amount);
    return next;
  }

  function applyPreset(value) {
    var today = new Date();
    var todayIso = toIsoDate(today);
    refs.dateFrom.max = todayIso;
    refs.dateTo.max = todayIso;
    var from = today;
    if (value === 'month') from = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (value !== 'custom') from = addDays(today, -(Math.max(1, Number(value) || 30) - 1));
    if (value !== 'custom') {
      refs.dateFrom.value = toIsoDate(from);
      refs.dateTo.value = toIsoDate(today);
    }
    var custom = value === 'custom';
    refs.dateFrom.disabled = !custom;
    refs.dateTo.disabled = !custom;
  }

  function formatCurrency(value, currency) {
    var numeric = Number(value) || 0;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function formatDecimal(value, digits) {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits,
    }).format(Number(value) || 0);
  }

  function formatPercent(value) { return formatDecimal(value, 2) + '%'; }

  var CITY_LABELS = Object.freeze({
    'sao paulo': 'São Paulo',
    'goiania': 'Goiânia',
    'florianopolis': 'Florianópolis',
    'brasilia': 'Brasília',
    'nao identificada': 'Não identificada',
  });

  function displayCityName(value) {
    var text = String(value || 'Não identificada').trim();
    var key = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    return CITY_LABELS[key] || text;
  }

  function formatDate(value) {
    if (!value) return '-';
    var date = new Date(String(value).slice(0, 10) + 'T12:00:00');
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
      : '-';
  }

  function formatShortDate(value) {
    if (!value) return '';
    var date = new Date(String(value).slice(0, 10) + 'T12:00:00');
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  }

  function formatDateTime(value) {
    var date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '-';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  async function parseResponse(response) {
    var text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch (_error) { return {}; }
  }

  async function requestJson(path) {
    var response = await fetch(API_BASE + path, {
      headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' },
    });
    var payload = await parseResponse(response);
    if (response.status === 401) {
      localStorage.removeItem('adminToken');
      window.top.location.replace('/login.html');
      throw new Error('Sessão expirada.');
    }
    if (!response.ok) {
      var error = new Error(payload.error || ('HTTP ' + response.status));
      error.code = payload.code || '';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function cacheKey() {
    return CACHE_PREFIX + [refs.accountSelect.value, refs.dateFrom.value, refs.dateTo.value].join(':');
  }

  function readSessionCache() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(cacheKey()) || 'null');
      if (!cached || Date.now() - cached.savedAt >= SESSION_CACHE_TTL_MS) return null;
      return cached.data;
    } catch (_error) { return null; }
  }

  function writeSessionCache(data) {
    try { sessionStorage.setItem(cacheKey(), JSON.stringify({ savedAt: Date.now(), data: data })); } catch (_error) {}
  }

  function setLoading(value) {
    state.loading = value;
    refs.btnApply.disabled = value;
    refs.btnRefresh.disabled = value;
    refs.loadingState.classList.toggle('hidden', !value);
    if (value) {
      refs.errorState.classList.add('hidden');
      refs.dashboardContent.classList.add('hidden');
      refs.syncState.textContent = 'Verificando dados...';
    }
  }

  function showError(error) {
    setLoading(false);
    refs.dashboardContent.classList.add('hidden');
    refs.errorState.classList.remove('hidden');
    if (error && error.code === 'META_ADS_NOT_CONFIGURED') {
      refs.errorTitle.textContent = 'Integração pendente';
      refs.errorMessage.textContent = 'Configure o token ads_read e a conta de anúncios no backend.';
      refs.syncState.textContent = 'Integração pendente';
    } else {
      refs.errorTitle.textContent = 'Não foi possível carregar o META ADS';
      refs.errorMessage.textContent = error && error.message ? error.message : 'Tente novamente em instantes.';
      refs.syncState.textContent = 'Falha na leitura';
    }
  }

  function showToast(message, isError) {
    refs.toast.textContent = message;
    refs.toast.classList.toggle('toast--error', Boolean(isError));
    refs.toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { refs.toast.classList.add('hidden'); }, 3200);
  }

  function renderKpis(data) {
    var summary = data.summary || {};
    var currency = data.account && data.account.currency || 'BRL';
    kpis.spend.textContent = formatCurrency(summary.spend, currency);
    kpis.period.textContent = formatDate(data.period.from) + ' a ' + formatDate(data.period.to);
    kpis.leads.textContent = formatNumber(summary.leadsStarted);
    kpis.cpl.textContent = summary.cpl == null ? '-' : formatCurrency(summary.cpl, currency);
    kpis.reach.textContent = formatNumber(summary.reach);
    kpis.impressions.textContent = formatNumber(summary.impressions);
    kpis.frequency.textContent = 'Frequência ' + formatDecimal(summary.frequency, 2);
    kpis.clicks.textContent = formatNumber(summary.clicks);
    kpis.ctr.textContent = 'CTR ' + formatPercent(summary.ctr);
    kpis.cpc.textContent = formatCurrency(summary.cpc, currency);
    kpis.cpm.textContent = 'CPM ' + formatCurrency(summary.cpm, currency);
    kpis.replies.textContent = formatNumber(summary.conversationsReplied);
    var replyRate = summary.leadsStarted > 0 ? (summary.conversationsReplied / summary.leadsStarted) * 100 : 0;
    kpis.replyRate.textContent = formatDecimal(replyRate, 0) + '% dos leads';
  }

  function chartValue(item, metric) {
    if (metric === 'leads') return Number(item.leadsStarted) || 0;
    if (metric === 'cpl') return item.cpl == null ? 0 : Number(item.cpl) || 0;
    return Number(item.spend) || 0;
  }

  function chartValueLabel(value, metric, currency) {
    if (metric === 'leads') return formatNumber(value);
    return formatCurrency(value, currency);
  }

  function chartSeries(currency) {
    return [
      { metric: 'spend', label: 'Investimento', color: 'spend', format: function (value) { return formatCurrency(value, currency); } },
      { metric: 'leads', label: 'Leads', color: 'leads', format: function (value) { return formatNumber(value); } },
      { metric: 'cpl', label: 'CPL', color: 'cpl', format: function (value) { return formatCurrency(value, currency); } },
    ];
  }

  function chartDateLabels(trend, width, height, left, chartWidth) {
    var labelStep = Math.max(1, Math.ceil(trend.length / 6));
    return trend.map(function (item, index) {
      var x = trend.length === 1 ? left + chartWidth / 2 : left + (index / (trend.length - 1)) * chartWidth;
      return { item: item, index: index, x: x };
    }).filter(function (point) {
      return point.index % labelStep === 0 || point.index === trend.length - 1;
    }).map(function (point) {
      return '<text class="chart-axis-text" x="' + point.x + '" y="' + (height - 10) + '" text-anchor="middle">'
        + escapeHtml(formatShortDate(point.item.date)) + '</text>';
    }).join('');
  }

  function renderComparisonChart(trend, currency) {
    var width = 1000;
    var height = 250;
    var left = 58;
    var right = 22;
    var top = 20;
    var bottom = 38;
    var chartWidth = width - left - right;
    var chartHeight = height - top - bottom;
    var series = chartSeries(currency).map(function (definition) {
      var values = trend.map(function (item) { return chartValue(item, definition.metric); });
      return Object.assign({}, definition, { values: values, max: Math.max.apply(Math, values.concat([0])) });
    }).filter(function (definition) { return definition.max > 0; });

    if (!trend.length || !series.length) {
      refs.chartLegend.classList.add('hidden');
      refs.trendChart.innerHTML = '<div class="chart-empty">Não houve movimento para estas métricas no período.</div>';
      return;
    }

    var grid = '';
    for (var tick = 0; tick <= 4; tick += 1) {
      var ratio = tick / 4;
      var gridY = top + chartHeight - ratio * chartHeight;
      grid += '<line class="chart-grid" x1="' + left + '" y1="' + gridY + '" x2="' + (width - right) + '" y2="' + gridY + '"></line>';
      grid += '<text class="chart-axis-text" x="' + (left - 10) + '" y="' + (gridY + 4) + '" text-anchor="end">' + Math.round(ratio * 100) + '%</text>';
    }

    var paths = series.map(function (definition) {
      var points = trend.map(function (item, index) {
        var x = trend.length === 1 ? left + chartWidth / 2 : left + (index / (trend.length - 1)) * chartWidth;
        var y = top + chartHeight - (definition.values[index] / definition.max) * chartHeight;
        return { x: x, y: y, item: item, value: definition.values[index] };
      });
      var line = points.map(function (point, index) {
        return (index ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
      }).join(' ');
      var dots = points.map(function (point) {
        return '<circle class="chart-dot chart-dot--' + definition.color + '" cx="' + point.x + '" cy="' + point.y + '" r="3.5"><title>'
          + escapeHtml(formatDate(point.item.date) + ' · ' + definition.label + ': ' + definition.format(point.value))
          + '</title></circle>';
      }).join('');
      return '<path class="chart-line chart-line--' + definition.color + '" d="' + line + '"></path>' + dots;
    }).join('');

    refs.chartLegend.innerHTML = '<span class="chart-legend__note">Escala relativa por série; 100% representa o maior valor diário de cada métrica.</span>'
      + series.map(function (definition) {
        return '<span class="chart-legend__item"><i class="chart-legend__swatch chart-legend__swatch--' + definition.color + '"></i>'
          + '<strong>' + definition.label + '</strong><small>máx. ' + escapeHtml(definition.format(definition.max)) + '</small></span>';
      }).join('');
    refs.chartLegend.classList.remove('hidden');
    refs.trendChart.setAttribute('aria-label', 'Comparação diária entre investimento, leads e custo por lead');
    refs.trendChart.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
      + grid + paths + chartDateLabels(trend, width, height, left, chartWidth) + '</svg>';
  }

  function renderChart() {
    var data = state.data;
    if (!data) return;
    var trend = Array.isArray(data.trend) ? data.trend : [];
    var metric = state.chartMetric;
    var currency = data.account && data.account.currency || 'BRL';
    if (metric === 'compare') {
      renderComparisonChart(trend, currency);
      return;
    }
    refs.chartLegend.classList.add('hidden');
    refs.chartLegend.innerHTML = '';
    refs.trendChart.setAttribute('aria-label', 'Gráfico de desempenho diário de ' + (metric === 'spend' ? 'investimento' : metric === 'leads' ? 'leads' : 'custo por lead'));
    var values = trend.map(function (item) { return chartValue(item, metric); });
    var max = Math.max.apply(Math, values.concat([0]));
    if (!trend.length || max <= 0) {
      refs.trendChart.innerHTML = '<div class="chart-empty">Não houve movimento para esta métrica no período.</div>';
      return;
    }

    var width = 1000;
    var height = 250;
    var left = 58;
    var right = 22;
    var top = 20;
    var bottom = 38;
    var chartWidth = width - left - right;
    var chartHeight = height - top - bottom;
    var points = trend.map(function (item, index) {
      var x = trend.length === 1 ? left + chartWidth / 2 : left + (index / (trend.length - 1)) * chartWidth;
      var y = top + chartHeight - (values[index] / max) * chartHeight;
      return { x: x, y: y, item: item, value: values[index], index: index };
    });
    var line = points.map(function (point, index) { return (index ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1); }).join(' ');
    var area = line + ' L' + points[points.length - 1].x.toFixed(1) + ' ' + (top + chartHeight) + ' L' + points[0].x.toFixed(1) + ' ' + (top + chartHeight) + ' Z';
    var grid = '';
    for (var tick = 0; tick <= 4; tick += 1) {
      var ratio = tick / 4;
      var y = top + chartHeight - ratio * chartHeight;
      grid += '<line class="chart-grid" x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '"></line>';
      grid += '<text class="chart-axis-text" x="' + (left - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + escapeHtml(chartValueLabel(max * ratio, metric, currency)) + '</text>';
    }
    var labels = chartDateLabels(trend, width, height, left, chartWidth);
    var dots = points.map(function (point) {
      return '<circle class="chart-dot chart-dot--' + metric + '" cx="' + point.x + '" cy="' + point.y + '" r="3.5"><title>'
        + escapeHtml(formatDate(point.item.date) + ': ' + chartValueLabel(point.value, metric, currency)) + '</title></circle>';
    }).join('');
    refs.trendChart.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
      + grid + '<path class="chart-area chart-area--' + metric + '" d="' + area + '"></path><path class="chart-line chart-line--' + metric + '" d="' + line + '"></path>' + dots + labels + '</svg>';
  }

  function renderCities(data) {
    var currency = data.account && data.account.currency || 'BRL';
    var cities = Array.isArray(data.cities) ? data.cities : [];
    refs.cityCount.textContent = cities.length + (cities.length === 1 ? ' cidade' : ' cidades');
    refs.cityTableBody.innerHTML = cities.length ? cities.map(function (item) {
      var note = item.reachMode === 'campaign-sum'
        ? '<span class="reach-note" title="Soma do alcance das campanhas; pode haver pessoas repetidas entre campanhas.">*</span>'
        : '';
      return '<tr><td><span class="city-name">' + escapeHtml(displayCityName(item.city)) + '</span></td>'
        + '<td class="metric-positive">' + formatNumber(item.leadsStarted) + '</td>'
        + '<td>' + (item.cpl == null ? '-' : formatCurrency(item.cpl, currency)) + '</td>'
        + '<td>' + formatNumber(item.reach) + note + '</td>'
        + '<td>' + formatCurrency(item.spend, currency) + '</td></tr>';
    }).join('') : '<tr><td colspan="5">Nenhuma cidade com dados no período.</td></tr>';
  }

  function formatInsightValue(item, currency) {
    if (item.valueType === 'currency') return formatCurrency(item.value, currency);
    if (item.valueType === 'decimal') return formatDecimal(item.value, 2);
    return formatNumber(item.value);
  }

  function renderInsights(data) {
    var insights = Array.isArray(data.insights) ? data.insights : [];
    var currency = data.account && data.account.currency || 'BRL';
    refs.insightList.innerHTML = insights.length ? insights.map(function (item) {
      return '<article class="insight insight--' + escapeHtml(item.type || 'info') + '"><span class="insight__marker"></span>'
        + '<div><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.message) + '</p></div>'
        + '<span class="insight__value">' + escapeHtml(formatInsightValue(item, currency)) + '</span></article>';
    }).join('') : '<div class="insight-empty">Não há alertas relevantes neste período.</div>';
  }

  function populateCityFilter(data) {
    var previous = refs.cityFilter.value;
    var cities = Array.from(new Set((data.campaigns || []).map(function (item) { return item.city; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    refs.cityFilter.innerHTML = '<option value="">Todas as cidades</option>' + cities.map(function (city) { return '<option value="' + escapeHtml(city) + '">' + escapeHtml(displayCityName(city)) + '</option>'; }).join('');
    if (cities.indexOf(previous) >= 0) refs.cityFilter.value = previous;
  }

  function renderCampaigns() {
    if (!state.data) return;
    var currency = state.data.account && state.data.account.currency || 'BRL';
    var query = String(refs.campaignSearch.value || '').trim().toLocaleLowerCase('pt-BR');
    var city = refs.cityFilter.value;
    var campaigns = (state.data.campaigns || []).filter(function (item) {
      var matchesQuery = !query || String(item.campaignName || '').toLocaleLowerCase('pt-BR').includes(query);
      return matchesQuery && (!city || item.city === city);
    });
    refs.campaignTableBody.innerHTML = campaigns.map(function (item) {
      return '<tr><td><span class="campaign-name" title="' + escapeHtml(item.campaignName) + '">' + escapeHtml(item.campaignName) + '</span></td>'
        + '<td>' + escapeHtml(displayCityName(item.city || '-')) + '</td>'
        + '<td class="metric-positive">' + formatNumber(item.leadsStarted) + '</td>'
        + '<td>' + formatNumber(item.conversationsReplied) + '</td>'
        + '<td>' + (item.cpl == null ? '-' : formatCurrency(item.cpl, currency)) + '</td>'
        + '<td>' + formatNumber(item.reach) + '</td>'
        + '<td>' + formatNumber(item.impressions) + '</td>'
        + '<td>' + formatNumber(item.clicks) + '</td>'
        + '<td>' + formatPercent(item.ctr) + '</td>'
        + '<td>' + formatCurrency(item.spend, currency) + '</td></tr>';
    }).join('');
    refs.campaignEmpty.classList.toggle('hidden', campaigns.length > 0);
  }

  function renderFreshness(data, overrideSource) {
    var freshness = data.freshness || {};
    var source = overrideSource || freshness.source;
    var labels = {
      meta: 'Meta consultada e salva no MongoDB',
      mongodb: 'Carregado do MongoDB',
      'memory-cache': 'Cache do backend',
      'session-cache': 'Cache desta sessão',
    };
    refs.dataSource.textContent = 'Fonte: ' + (labels[source] || 'MongoDB');
    refs.lastUpdated.textContent = 'Atualizado em ' + formatDateTime(freshness.refreshedAt);
    refs.syncState.textContent = source === 'meta' ? 'Sincronizado agora' : (source === 'session-cache' || source === 'memory-cache' ? 'Cache válido' : 'MongoDB atualizado');
  }

  function renderDashboard(data, overrideSource) {
    state.data = data;
    refs.errorState.classList.add('hidden');
    refs.loadingState.classList.add('hidden');
    refs.dashboardContent.classList.remove('hidden');
    renderKpis(data);
    renderChart();
    renderCities(data);
    renderInsights(data);
    populateCityFilter(data);
    renderCampaigns();
    renderFreshness(data, overrideSource);
  }

  async function loadDashboard(force) {
    if (!refs.accountSelect.value || !refs.dateFrom.value || !refs.dateTo.value) return;
    if (refs.dateFrom.value > refs.dateTo.value) {
      showToast('A data inicial não pode ser posterior à data final.', true);
      return;
    }

    if (!force) {
      var cached = readSessionCache();
      if (cached) {
        renderDashboard(cached, 'session-cache');
        return;
      }
    }

    setLoading(true);
    try {
      var query = new URLSearchParams({
        accountId: refs.accountSelect.value,
        from: refs.dateFrom.value,
        to: refs.dateTo.value,
      });
      if (force) query.set('refresh', '1');
      var data = await requestJson('/api/meta-ads/dashboard?' + query.toString());
      writeSessionCache(data);
      renderDashboard(data);
    } catch (error) {
      showError(error);
    } finally {
      state.loading = false;
      refs.btnApply.disabled = false;
      refs.btnRefresh.disabled = false;
      refs.loadingState.classList.add('hidden');
    }
  }

  function buildReport() {
    var data = state.data;
    if (!data) return '';
    var currency = data.account && data.account.currency || 'BRL';
    var lines = [
      'Relatório META ADS - ' + (data.account.name || data.account.id),
      'Período: ' + formatDate(data.period.from) + ' a ' + formatDate(data.period.to),
      '',
      'Resumo geral',
      'Leads Meta: ' + formatNumber(data.summary.leadsStarted),
      'Conversas respondidas: ' + formatNumber(data.summary.conversationsReplied),
      'CPL: ' + (data.summary.cpl == null ? '-' : formatCurrency(data.summary.cpl, currency)),
      'Alcance: ' + formatNumber(data.summary.reach),
      'Investimento: ' + formatCurrency(data.summary.spend, currency),
    ];
    (data.cities || []).forEach(function (city) {
      lines.push('', displayCityName(city.city), 'Leads: ' + formatNumber(city.leadsStarted), 'CPL: ' + (city.cpl == null ? '-' : formatCurrency(city.cpl, currency)), 'Alcance: ' + formatNumber(city.reach), 'Investimento: ' + formatCurrency(city.spend, currency));
    });
    return lines.join('\n');
  }

  async function copyReport() {
    var report = buildReport();
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      showToast('Relatório copiado.');
    } catch (_error) {
      var textarea = document.createElement('textarea');
      textarea.value = report;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast('Relatório copiado.');
    }
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'light';
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('meta-ads:theme', next);
    renderChart();
  }

  async function initialize() {
    if (!TOKEN) {
      window.top.location.replace('/login.html');
      return;
    }
    applyPreset(refs.periodPreset.value);
    setLoading(true);
    try {
      var status = await requestJson('/api/meta-ads/status');
      state.status = status;
      if (!status.configured) {
        var configError = new Error('A integração ainda não foi configurada.');
        configError.code = 'META_ADS_NOT_CONFIGURED';
        throw configError;
      }
      refs.accountSelect.innerHTML = (status.accounts || []).map(function (account) {
        return '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(account.label) + '</option>';
      }).join('');
      refs.accountSelect.value = status.defaultAccountId || refs.accountSelect.options[0].value;
      await loadDashboard(false);
    } catch (error) {
      showError(error);
    }
  }

  refs.periodPreset.addEventListener('change', function () { applyPreset(refs.periodPreset.value); });
  refs.btnApply.addEventListener('click', function () { loadDashboard(false); });
  refs.btnRefresh.addEventListener('click', function () { loadDashboard(true); });
  refs.btnRetry.addEventListener('click', function () { loadDashboard(false); });
  refs.btnCopyReport.addEventListener('click', copyReport);
  refs.btnTheme.addEventListener('click', toggleTheme);
  refs.campaignSearch.addEventListener('input', renderCampaigns);
  refs.cityFilter.addEventListener('change', renderCampaigns);
  refs.chartMetric.addEventListener('click', function (event) {
    var button = event.target.closest('[data-metric]');
    if (!button) return;
    state.chartMetric = button.dataset.metric;
    refs.chartMetric.querySelectorAll('button').forEach(function (item) { item.classList.toggle('is-active', item === button); });
    renderChart();
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SMART_REFRESH') loadDashboard(true);
  });

  initialize();
})();
