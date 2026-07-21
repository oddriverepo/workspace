(function () {
  'use strict';

  var API_BASE = window.API_BASE || '';
  var TOKEN = localStorage.getItem('adminToken') || '';
  var PAGE_SIZE = 50;
  var ACQUISITION_CACHE_TTL_MS = 90000;
  var ACQUISITION_CACHE_MAX_ENTRIES = 8;
  var METRICS_STORAGE_KEY = 'crm:metrics-collapsed';
  var FUNNEL_STORAGE_KEY = 'crm:funnel-collapsed';
  var FILTERS_STORAGE_KEY = 'crm:filters-collapsed';
  var OUTCOME_STATUSES = Object.freeze(['perdido', 'efetivado', 'cadastrado', 'nao responde']);

  var PRESET_OPTIONS = Object.freeze({
    leads: Object.freeze({
      status: ['Aguardando', 'Encaminhado', 'Perdido', 'Não tem interesse'],
      atendente: ['Julia', 'Nádia', 'Yumi', 'Krys'],
    }),
    forwarded: Object.freeze({
      atendente: ['Julia', 'Nádia', 'Yumi', 'Krys'],
      status: ['Perdido', 'Efetivado', 'Cadastrado', 'Não responde'],
      observacao: [
        'Quer participar',
        'Sem Retorno',
        'Não aceitou o valor',
        'Somente OD IN',
        'Somente IN + VT',
        'Veículo inelegível',
      ],
    }),
  });

  var refs = {
    syncState: document.getElementById('syncState'),
    btnTheme: document.getElementById('btnTheme'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnCreateLead: document.getElementById('btnCreateLead'),
    btnRetry: document.getElementById('btnRetry'),
    metricsPanel: document.getElementById('metricsPanel'),
    btnToggleMetrics: document.getElementById('btnToggleMetrics'),
    funnelPanel: document.getElementById('funnelPanel'),
    btnToggleFunnel: document.getElementById('btnToggleFunnel'),
    btnExportDesktop: document.getElementById('btnExportDesktop'),
    btnExportMobile: document.getElementById('btnExportMobile'),
    exportMenu: document.getElementById('exportMenu'),
    exportMenuTitle: document.getElementById('exportMenuTitle'),
    funnelExportArea: document.getElementById('funnelExportArea'),
    funnelHeaderSummary: document.getElementById('funnelHeaderSummary'),
    funnelAccountSelect: document.getElementById('funnelAccountSelect'),
    funnelPeriodPreset: document.getElementById('funnelPeriodPreset'),
    funnelDateFrom: document.getElementById('funnelDateFrom'),
    funnelDateTo: document.getElementById('funnelDateTo'),
    btnApplyFunnelPeriod: document.getElementById('btnApplyFunnelPeriod'),
    acquisitionSyncState: document.getElementById('acquisitionSyncState'),
    funnelPeriodLabel: document.getElementById('funnelPeriodLabel'),
    funnelAdClicks: document.getElementById('funnelAdClicks'),
    funnelClickCost: document.getElementById('funnelClickCost'),
    funnelAttributedConversations: document.getElementById('funnelAttributedConversations'),
    funnelAttributedRate: document.getElementById('funnelAttributedRate'),
    btnToggleAcquisitionBranches: document.getElementById('btnToggleAcquisitionBranches'),
    acquisitionBranches: document.getElementById('acquisitionBranches'),
    branchGptChats: document.getElementById('branchGptChats'),
    branchGptChatsRate: document.getElementById('branchGptChatsRate'),
    branchUnattributedChats: document.getElementById('branchUnattributedChats'),
    branchUnattributedChatsRate: document.getElementById('branchUnattributedChatsRate'),
    funnelRegistered: document.getElementById('funnelRegistered'),
    funnelRegisteredRate: document.getElementById('funnelRegisteredRate'),
    funnelForwarded: document.getElementById('funnelForwarded'),
    funnelForwardedRate: document.getElementById('funnelForwardedRate'),
    funnelResolved: document.getElementById('funnelResolved'),
    funnelResolvedRate: document.getElementById('funnelResolvedRate'),
    btnToggleAttendedBranches: document.getElementById('btnToggleAttendedBranches'),
    attendedBranches: document.getElementById('attendedBranches'),
    branchOutcomeEffective: document.getElementById('branchOutcomeEffective'),
    branchOutcomeEffectiveRate: document.getElementById('branchOutcomeEffectiveRate'),
    branchOutcomeRegistered: document.getElementById('branchOutcomeRegistered'),
    branchOutcomeRegisteredRate: document.getElementById('branchOutcomeRegisteredRate'),
    branchOutcomeLost: document.getElementById('branchOutcomeLost'),
    branchOutcomeLostRate: document.getElementById('branchOutcomeLostRate'),
    branchOutcomeNoAnswer: document.getElementById('branchOutcomeNoAnswer'),
    branchOutcomeNoAnswerRate: document.getElementById('branchOutcomeNoAnswerRate'),
    branchOutcomePending: document.getElementById('branchOutcomePending'),
    branchOutcomePendingRate: document.getElementById('branchOutcomePendingRate'),
    funnelAppConfirmed: document.getElementById('funnelAppConfirmed'),
    funnelAppRate: document.getElementById('funnelAppRate'),
    btnToggleAppBranches: document.getElementById('btnToggleAppBranches'),
    appBranches: document.getElementById('appBranches'),
    branchAppRegisteredAfter: document.getElementById('branchAppRegisteredAfter'),
    branchAppRegisteredAfterRate: document.getElementById('branchAppRegisteredAfterRate'),
    branchAppAlreadyRegistered: document.getElementById('branchAppAlreadyRegistered'),
    branchAppAlreadyRegisteredRate: document.getElementById('branchAppAlreadyRegisteredRate'),
    branchAppNoDate: document.getElementById('branchAppNoDate'),
    branchAppNoDateRate: document.getElementById('branchAppNoDateRate'),
    funnelInCampaign: document.getElementById('funnelInCampaign'),
    funnelCampaignRate: document.getElementById('funnelCampaignRate'),
    btnToggleCampaignBranches: document.getElementById('btnToggleCampaignBranches'),
    campaignBranches: document.getElementById('campaignBranches'),
    branchCampaignAlreadyRegistered: document.getElementById('branchCampaignAlreadyRegistered'),
    branchCampaignAlreadyRegisteredRate: document.getElementById('branchCampaignAlreadyRegisteredRate'),
    branchCampaignRegisteredAfter: document.getElementById('branchCampaignRegisteredAfter'),
    branchCampaignRegisteredAfterRate: document.getElementById('branchCampaignRegisteredAfterRate'),
    branchCampaignNoDate: document.getElementById('branchCampaignNoDate'),
    branchCampaignNoDateRate: document.getElementById('branchCampaignNoDateRate'),
    funnelMatchNotice: document.getElementById('funnelMatchNotice'),
    acquisitionDetailNotice: document.getElementById('acquisitionDetailNotice'),
    acquisitionSpend: document.getElementById('acquisitionSpend'),
    acquisitionCpc: document.getElementById('acquisitionCpc'),
    acquisitionMetaConversations: document.getElementById('acquisitionMetaConversations'),
    acquisitionMetaConversationCost: document.getElementById('acquisitionMetaConversationCost'),
    acquisitionGptConversations: document.getElementById('acquisitionGptConversations'),
    acquisitionGptInteractions: document.getElementById('acquisitionGptInteractions'),
    acquisitionUnattributedChats: document.getElementById('acquisitionUnattributedChats'),
    acquisitionUnattributedChatsNote: document.getElementById('acquisitionUnattributedChatsNote'),
    acquisitionAttributedShare: document.getElementById('acquisitionAttributedShare'),
    acquisitionAttributedShareNote: document.getElementById('acquisitionAttributedShareNote'),
    acquisitionClickToDirect: document.getElementById('acquisitionClickToDirect'),
    acquisitionDirectToRegistered: document.getElementById('acquisitionDirectToRegistered'),
    acquisitionCostPerDirect: document.getElementById('acquisitionCostPerDirect'),
    acquisitionCostPerCampaignLead: document.getElementById('acquisitionCostPerCampaignLead'),
    acquisitionCostPerCampaignLeadNote: document.getElementById('acquisitionCostPerCampaignLeadNote'),
    acquisitionNamedProfiles: document.getElementById('acquisitionNamedProfiles'),
    acquisitionDirectRegistrationTime: document.getElementById('acquisitionDirectRegistrationTime'),
    acquisitionDirectRegistrationTimeSample: document.getElementById('acquisitionDirectRegistrationTimeSample'),
    acquisitionReconciliationNote: document.getElementById('acquisitionReconciliationNote'),
    matchConfirmed: document.getElementById('matchConfirmed'),
    matchConfirmedRate: document.getElementById('matchConfirmedRate'),
    matchWithoutCampaign: document.getElementById('matchWithoutCampaign'),
    matchWithoutCampaignRate: document.getElementById('matchWithoutCampaignRate'),
    matchInCampaign: document.getElementById('matchInCampaign'),
    matchInCampaignRate: document.getElementById('matchInCampaignRate'),
    matchCampaignConversion: document.getElementById('matchCampaignConversion'),
    matchProbable: document.getElementById('matchProbable'),
    matchNotFound: document.getElementById('matchNotFound'),
    matchNotFoundRate: document.getElementById('matchNotFoundRate'),
    matchAlreadyRegistered: document.getElementById('matchAlreadyRegistered'),
    matchAlreadyRegisteredRate: document.getElementById('matchAlreadyRegisteredRate'),
    matchRegisteredAfter: document.getElementById('matchRegisteredAfter'),
    matchRegisteredAfterRate: document.getElementById('matchRegisteredAfterRate'),
    matchNoRegistrationDate: document.getElementById('matchNoRegistrationDate'),
    matchNoRegistrationDateRate: document.getElementById('matchNoRegistrationDateRate'),
    campaignHistoryNotice: document.getElementById('campaignHistoryNotice'),
    matchCampaignAlreadyRegistered: document.getElementById('matchCampaignAlreadyRegistered'),
    matchCampaignAlreadyRegisteredRate: document.getElementById('matchCampaignAlreadyRegisteredRate'),
    matchCampaignRegisteredAfter: document.getElementById('matchCampaignRegisteredAfter'),
    matchCampaignRegisteredAfterRate: document.getElementById('matchCampaignRegisteredAfterRate'),
    matchCampaignNoDate: document.getElementById('matchCampaignNoDate'),
    matchCampaignNoDateRate: document.getElementById('matchCampaignNoDateRate'),
    timingWait: document.getElementById('timingWait'),
    timingWaitSample: document.getElementById('timingWaitSample'),
    timingDirectRegistration: document.getElementById('timingDirectRegistration'),
    timingDirectRegistrationSample: document.getElementById('timingDirectRegistrationSample'),
    timingService: document.getElementById('timingService'),
    timingServiceSample: document.getElementById('timingServiceSample'),
    timingAppRegistration: document.getElementById('timingAppRegistration'),
    timingAppRegistrationSample: document.getElementById('timingAppRegistrationSample'),
    timingCampaignEntry: document.getElementById('timingCampaignEntry'),
    timingCampaignEntrySample: document.getElementById('timingCampaignEntrySample'),
    attendantTimingBody: document.getElementById('attendantTimingBody'),
    filterSearch: document.getElementById('filterSearch'),
    filterStatus: document.getElementById('filterStatus'),
    filterAttendant: document.getElementById('filterAttendant'),
    filterOrigin: document.getElementById('filterOrigin'),
    originFilterField: document.getElementById('originFilterField'),
    filtersPanel: document.getElementById('filtersPanel'),
    btnToggleFilters: document.getElementById('btnToggleFilters'),
    metricTotal: document.getElementById('metricTotal'),
    metricForwarded: document.getElementById('metricForwarded'),
    metricOpen: document.getElementById('metricOpen'),
    metricRate: document.getElementById('metricRate'),
    tabLeadsCount: document.getElementById('tabLeadsCount'),
    tabForwardedCount: document.getElementById('tabForwardedCount'),
    resultSummary: document.getElementById('resultSummary'),
    lastUpdated: document.getElementById('lastUpdated'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    errorTitle: document.getElementById('errorTitle'),
    errorMessage: document.getElementById('errorMessage'),
    emptyState: document.getElementById('emptyState'),
    tableWrap: document.getElementById('tableWrap'),
    tableHead: document.getElementById('tableHead'),
    tableBody: document.getElementById('tableBody'),
    pagination: document.getElementById('pagination'),
    pageInfo: document.getElementById('pageInfo'),
    btnPreviousPage: document.getElementById('btnPreviousPage'),
    btnNextPage: document.getElementById('btnNextPage'),
    leadDetailModal: document.getElementById('leadDetailModal'),
    detailTitle: document.getElementById('detailTitle'),
    leadDetailBody: document.getElementById('leadDetailBody'),
    btnDetailEdit: document.getElementById('btnDetailEdit'),
    leadModal: document.getElementById('leadModal'),
    modalEyebrow: document.getElementById('modalEyebrow'),
    modalTitle: document.getElementById('modalTitle'),
    leadForm: document.getElementById('leadForm'),
    formFields: document.getElementById('formFields'),
    formMessage: document.getElementById('formMessage'),
    btnSaveLead: document.getElementById('btnSaveLead'),
    attendantOptions: document.getElementById('attendantOptions'),
    statusOptions: document.getElementById('statusOptions'),
    originOptions: document.getElementById('originOptions'),
    crmToast: document.getElementById('crmToast'),
  };

  var state = {
    view: 'leads',
    leads: [],
    forwarded: [],
    drivers: [],
    driversLoadFailed: false,
    filtered: [],
    page: 1,
    loading: false,
    inlineSaving: false,
    exportFormat: null,
    acquisition: null,
    acquisitionLoading: false,
    acquisitionStatus: null,
    acquisitionCache: new Map(),
    funnelPeriod: {
      preset: '30',
      accountId: '',
      from: '',
      to: '',
    },
    detail: {
      view: 'leads',
      item: null,
    },
    modal: {
      mode: 'edit',
      view: 'leads',
      item: null,
    },
  };

  var schemas = {
    leads: {
      label: 'Leads Registrados',
      columns: [
        { key: 'nome', label: 'Nome', primary: true },
        { key: 'cidade', label: 'Cidade' },
        { key: 'campanha', label: 'Campanha' },
        { key: 'telefone', label: 'Contato', phone: true },
        { key: 'dataContato', label: 'Data de registro', readonly: true },
        { key: 'origem', label: 'Origem' },
        { key: 'status', label: 'Status', status: true },
        { key: 'atendente', label: 'Atendente' },
        { key: 'dataEncaminhamento', label: 'Data de encaminhamento', readonly: true },
        { key: 'tempoEncaminhamento', label: 'Tempo até encaminhar', readonly: true },
        { key: 'appSituation', label: 'Situação no app', readonly: true },
        { key: 'appRegistrationDate', label: 'Cadastro no app', readonly: true },
        { key: 'tempoCadastroApp', label: 'Tempo até cadastro', readonly: true },
        { key: 'motivoPerda', label: 'Motivo da perda' },
      ],
      fields: [
        { key: 'nome', label: 'Nome', autocomplete: 'name', maxLength: 180 },
        { key: 'cidade', label: 'Cidade', required: true, maxLength: 120 },
        { key: 'campanha', label: 'Campanha', maxLength: 180 },
        { key: 'telefone', label: 'Contato', required: true, inputMode: 'tel', maxLength: 30 },
        { key: 'dataContato', label: 'Data de registro', readonly: true },
        { key: 'origem', label: 'Origem', list: 'originOptions', maxLength: 80 },
        { key: 'status', label: 'Status', options: 'status', maxLength: 80 },
        { key: 'atendente', label: 'Atendente', options: 'atendente', maxLength: 120 },
        { key: 'dataEncaminhamento', label: 'Data de encaminhamento', readonly: true },
        { key: 'motivoPerda', label: 'Motivo da perda', type: 'textarea', full: true, maxLength: 500 },
      ],
    },
    forwarded: {
      label: 'Leads encaminhados',
      columns: [
        { key: 'data', label: 'Data', readonly: true },
        { key: 'nome', label: 'Nome', primary: true },
        { key: 'cidade', label: 'Cidade' },
        { key: 'telefone', label: 'Telefone', phone: true },
        { key: 'atendente', label: 'Atendente' },
        { key: 'status', label: 'Status', status: true },
        { key: 'observacao', label: 'Observação' },
        { key: 'dataFinal', label: 'Data final' },
        { key: 'tempoEspera', label: 'Espera para encaminhar', readonly: true },
        { key: 'tempoAtendimento', label: 'Tempo de atendimento', readonly: true },
        { key: 'tempoTotal', label: 'Tempo total', readonly: true },
      ],
      fields: [
        { key: 'data', label: 'Data', readonly: true },
        { key: 'nome', label: 'Nome', maxLength: 180 },
        { key: 'cidade', label: 'Cidade', maxLength: 120 },
        { key: 'telefone', label: 'Telefone', inputMode: 'tel', maxLength: 30 },
        { key: 'atendente', label: 'Atendente', options: 'atendente', maxLength: 120 },
        { key: 'status', label: 'Status', options: 'status', maxLength: 80 },
        { key: 'observacao', label: 'Observação', options: 'observacao', full: true, maxLength: 1000 },
        { key: 'dataFinal', label: 'Data final', maxLength: 40 },
      ],
    },
  };

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function digits(value) {
    return String(value == null ? '' : value).replace(/\D/g, '');
  }

  function pick(source, aliases) {
    for (var index = 0; index < aliases.length; index += 1) {
      var key = aliases[index];
      if (source && source[key] != null) return String(source[key]);
    }

    var normalizedAliases = aliases.map(normalizeText);
    var keys = Object.keys(source || {});
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (normalizedAliases.indexOf(normalizeText(keys[keyIndex])) >= 0) {
        return String(source[keys[keyIndex]] == null ? '' : source[keys[keyIndex]]);
      }
    }
    return '';
  }

  function getRowNumber(source, fallbackIndex) {
    var raw = source?.rowNumber ?? source?.row ?? source?._row ?? source?.linha;
    var row = Number.parseInt(String(raw || ''), 10);
    return Number.isInteger(row) && row >= 2 ? row : fallbackIndex + 2;
  }

  function normalizeLead(source, index) {
    return {
      rowNumber: getRowNumber(source, index),
      nome: pick(source, ['nome', 'NOME']),
      cidade: pick(source, ['cidade', 'CIDADE']),
      campanha: pick(source, ['campanha', 'CAMPANHA']),
      telefone: pick(source, ['telefone', 'contato', 'CONTATO']),
      dataContato: pick(source, ['dataContato', 'data_contato', 'DATA CONTATO', 'DATA DE REGISTRO', 'data de registro']),
      origem: pick(source, ['origem', 'ORIGEM']),
      status: pick(source, ['status', 'STATUS']),
      atendente: pick(source, ['atendente', 'ATENDENTE']),
      dataEncaminhamento: pick(source, ['dataEncaminhamento', 'data_encaminhamento', 'DATA DE ENCAMINHAMENTO']),
      motivoPerda: pick(source, ['motivoPerda', 'motivo_perda', 'MOTIVO DA PERDA']),
      tempoEncaminhamento: '',
      appSituation: '',
      appRegistrationDate: '',
      tempoCadastroApp: '',
    };
  }

  function normalizeForwarded(source, index) {
    return {
      rowNumber: getRowNumber(source, index),
      data: pick(source, ['data', 'DATA']),
      nome: pick(source, ['nome', 'NOME']),
      cidade: pick(source, ['cidade', 'CIDADE']),
      telefone: pick(source, ['telefone', 'TELEFONE']),
      atendente: pick(source, ['atendente', 'ATENDENTE']),
      status: pick(source, ['status', 'STATUS']),
      observacao: pick(source, ['observacao', 'observação', 'OBSERVAÇÃO']),
      dataFinal: pick(source, ['dataFinal', 'data_final', 'DATA FINAL']),
      tempoEspera: '',
      tempoAtendimento: '',
      tempoTotal: '',
    };
  }

  function canonicalPhone(value) {
    var phone = digits(value);
    if (phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2);
    if (phone.length > 11) phone = phone.slice(-11);
    return phone.length >= 10 ? phone : '';
  }

  function normalizePersonName(value) {
    return normalizeText(value)
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function meaningfulNameTokens(value) {
    var particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
    return normalizePersonName(value).split(' ').filter(function (token) {
      return token.length > 1 && !particles.has(token);
    });
  }

  function normalizeCity(value) {
    var city = normalizeText(value)
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return city.replace(/\s+(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)$/i, '').trim();
  }

  function contactIdentity(item, fallback) {
    var phone = canonicalPhone(item?.telefone || item?.phone);
    if (phone) return 'phone:' + phone;
    var name = normalizePersonName(item?.nome || item?.name);
    var city = normalizeCity(item?.cidade || item?.city || item?.address?.city);
    if (name) return 'name:' + name + '|city:' + city;
    var fallbackKey = fallback != null ? fallback : (item?.rowNumber || 'unknown');
    return 'row:' + String(fallbackKey);
  }

  function hasAssignedAttendant(item) {
    var attendant = normalizeText(item?.atendente);
    return Boolean(attendant) && !['nao definido', 'nao informado', 'sem atendente', 'a definir', 'null', 'undefined', '-', '—'].includes(attendant);
  }

  function belongsToInstagramAcquisition(item) {
    var origin = normalizeText(item?.origem);
    if (!origin) return true;
    return origin.includes('instagram') || origin.includes('direct') || origin.includes('meta');
  }

  function uniqueContacts(items) {
    var unique = new Map();
    (items || []).forEach(function (item, index) {
      var key = contactIdentity(item, index);
      var current = unique.get(key);
      if (!current) {
        unique.set(key, item);
        return;
      }
      var currentIsAttended = hasAssignedAttendant(current);
      var nextIsAttended = hasAssignedAttendant(item);
      var currentHasOutcome = OUTCOME_STATUSES.includes(normalizeText(current.status));
      var nextHasOutcome = OUTCOME_STATUSES.includes(normalizeText(item.status));
      var currentProgress = Number(currentIsAttended) * 2 + Number(currentHasOutcome);
      var nextProgress = Number(nextIsAttended) * 2 + Number(nextHasOutcome);
      var shouldReplace = nextProgress > currentProgress;
      if (nextProgress === currentProgress && Number(item.rowNumber || 0) >= Number(current.rowNumber || 0)) shouldReplace = true;
      if (shouldReplace) {
        unique.set(key, item);
      }
    });
    return Array.from(unique.values());
  }

  function parseCrmDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    var raw = String(value || '').trim();
    if (!raw) return null;

    var brazilian = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (brazilian) {
      var year = Number(brazilian[3]);
      if (year < 100) year += 2000;
      var month = Number(brazilian[2]) - 1;
      var day = Number(brazilian[1]);
      var hour = Number(brazilian[4] || 0);
      var minute = Number(brazilian[5] || 0);
      var second = Number(brazilian[6] || 0);
      var parsed = new Date(year, month, day, hour, minute, second);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month &&
        parsed.getDate() === day &&
        parsed.getHours() === hour &&
        parsed.getMinutes() === minute
      ) return parsed;
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}(?:T|\s)/.test(raw)) {
      var iso = new Date(raw);
      return Number.isNaN(iso.getTime()) ? null : iso;
    }
    return null;
  }

  function padDatePart(value) {
    return String(value).padStart(2, '0');
  }

  function toIsoDate(date) {
    return date.getFullYear() + '-' + padDatePart(date.getMonth() + 1) + '-' + padDatePart(date.getDate());
  }

  function addCalendarDays(date, amount) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + amount);
    return next;
  }

  function formatPeriodDate(value) {
    if (!value) return '';
    var parts = String(value).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value;
  }

  function applyFunnelPreset(value) {
    var today = new Date();
    var todayIso = toIsoDate(today);
    refs.funnelDateFrom.max = todayIso;
    refs.funnelDateTo.max = todayIso;
    var from = today;
    if (value === 'month') from = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (value !== 'custom') from = addCalendarDays(today, -(Math.max(1, Number(value) || 30) - 1));
    if (value !== 'custom') {
      refs.funnelDateFrom.value = toIsoDate(from);
      refs.funnelDateTo.value = todayIso;
    }
    var custom = value === 'custom';
    refs.funnelDateFrom.disabled = !custom;
    refs.funnelDateTo.disabled = !custom;
  }

  function dateInsideFunnelPeriod(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
    var iso = toIsoDate(date);
    return iso >= state.funnelPeriod.from && iso <= state.funnelPeriod.to;
  }

  function funnelPeriodLabel() {
    return formatPeriodDate(state.funnelPeriod.from) + ' a ' + formatPeriodDate(state.funnelPeriod.to);
  }

  function parseDriverCreatedAt(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      var timestamp = value < 100000000000 ? value * 1000 : value;
      var numericDate = new Date(timestamp);
      return Number.isNaN(numericDate.getTime()) ? null : numericDate;
    }
    var raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{10,13}$/.test(raw)) return parseDriverCreatedAt(Number(raw));
    var crmDate = parseCrmDate(raw);
    if (crmDate) return crmDate;
    var parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDateTime(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '—';
    return value.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).replace(',', '');
  }

  function durationBetween(start, end) {
    if (!start || !end) return null;
    var duration = end.getTime() - start.getTime();
    var maxDuration = 1000 * 60 * 60 * 24 * 365 * 5;
    return duration >= 0 && duration <= maxDuration ? duration : null;
  }

  function averageDuration(values) {
    var valid = (values || []).filter(function (value) { return Number.isFinite(value) && value >= 0; });
    if (!valid.length) return null;
    return valid.reduce(function (total, value) { return total + value; }, 0) / valid.length;
  }

  function formatDuration(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    var totalMinutes = Math.max(0, Math.round(value / 60000));
    if (totalMinutes < 60) return totalMinutes + ' min';
    var totalHours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    if (totalHours < 24) return totalHours + 'h' + (minutes ? ' ' + minutes + 'min' : '');
    var days = Math.floor(totalHours / 24);
    var hours = totalHours % 24;
    return days + 'd' + (hours ? ' ' + hours + 'h' : '');
  }

  function addToIndex(index, key, value) {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(value);
  }

  function driverCity(driver) {
    return driver?.city || driver?.address?.city || driver?._location?.city || '';
  }

  function driverName(driver) {
    return driver?.name || driver?.nome || '';
  }

  function chooseDriver(candidates) {
    if (!candidates?.length) return null;
    return candidates.slice().sort(function (left, right) {
      return Number(Boolean(right?.campaignId)) - Number(Boolean(left?.campaignId));
    })[0];
  }

  function buildDriverIndexes(drivers) {
    var indexes = {
      phone: new Map(),
      nameCity: new Map(),
      name: new Map(),
      fuzzyBucket: new Map(),
    };
    (drivers || []).forEach(function (driver) {
      var phone = canonicalPhone(driver?.phone || driver?.phoneDigits || driver?.telefone);
      var name = normalizePersonName(driverName(driver));
      var city = normalizeCity(driverCity(driver));
      var tokens = meaningfulNameTokens(name);
      addToIndex(indexes.phone, phone, driver);
      addToIndex(indexes.nameCity, name && city ? name + '|' + city : '', driver);
      addToIndex(indexes.name, name, driver);
      addToIndex(indexes.fuzzyBucket, tokens.length && city ? tokens[0].slice(0, 3) + '|' + city : '', driver);
    });
    return indexes;
  }

  function levenshteinRatio(left, right) {
    if (left === right) return 1;
    if (!left || !right) return 0;
    var previous = Array.from({ length: right.length + 1 }, function (_value, index) { return index; });
    for (var i = 1; i <= left.length; i += 1) {
      var current = [i];
      for (var j = 1; j <= right.length; j += 1) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
        );
      }
      previous = current;
    }
    return 1 - (previous[right.length] / Math.max(left.length, right.length));
  }

  function tokenSimilarity(left, right) {
    var leftTokens = new Set(meaningfulNameTokens(left));
    var rightTokens = new Set(meaningfulNameTokens(right));
    if (!leftTokens.size || !rightTokens.size) return 0;
    var shared = 0;
    leftTokens.forEach(function (token) { if (rightTokens.has(token)) shared += 1; });
    return (2 * shared) / (leftTokens.size + rightTokens.size);
  }

  function nameSimilarity(left, right) {
    var normalizedLeft = meaningfulNameTokens(left).join(' ');
    var normalizedRight = meaningfulNameTokens(right).join(' ');
    return Math.max(tokenSimilarity(normalizedLeft, normalizedRight), levenshteinRatio(normalizedLeft, normalizedRight));
  }

  function parseAcquisitionDate(value) {
    var date = value instanceof Date ? value : new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function directContactPrecedesRegistration(identity, lead) {
    var firstContactAt = parseAcquisitionDate(identity?.firstContactAt);
    var registrationAt = lead?._registrationDate;
    if (!firstContactAt || !registrationAt) return false;
    var hasTime = /\d{1,2}:\d{2}/.test(String(lead?.dataContato || ''));
    var latestAllowed = hasTime
      ? registrationAt.getTime() + (5 * 60 * 1000)
      : new Date(
        registrationAt.getFullYear(),
        registrationAt.getMonth(),
        registrationAt.getDate(),
        23, 59, 59, 999,
      ).getTime();
    return firstContactAt.getTime() <= latestAllowed;
  }

  function assignDirectContactMatch(lead, identity, confidence, reason, score, matchedName) {
    var firstContactAt = parseAcquisitionDate(identity.firstContactAt);
    var duration = durationBetween(firstContactAt, lead._registrationDate);
    lead._directContactMatch = {
      confidence: confidence,
      reason: reason,
      score: score,
      profileName: matchedName || identity.profileName,
      chatCount: Number(identity.chatCount || 1),
    };
    lead._firstDirectContactAt = firstContactAt;
    lead._directToRegistrationMs = duration;
  }

  function buildDirectIdentityModel(registered, direct) {
    state.leads.forEach(function (lead) {
      lead._directContactMatch = null;
      lead._firstDirectContactAt = null;
      lead._directToRegistrationMs = null;
    });

    var identities = Array.isArray(direct?.identities)
      ? direct.identities.map(function (identity, index) {
        var profileNames = Array.isArray(identity?.profileNames)
          ? identity.profileNames.map(normalizePersonName).filter(Boolean)
          : [];
        var primaryName = normalizePersonName(identity?.profileName);
        if (primaryName && !profileNames.includes(primaryName)) profileNames.unshift(primaryName);
        return {
          index: index,
          profileName: primaryName || profileNames[0] || '',
          profileNames: profileNames,
          firstContactAt: identity?.firstContactAt,
          lastContactAt: identity?.lastContactAt,
          chatCount: Math.max(1, Number(identity?.chatCount || 1)),
        };
      }).filter(function (identity) {
        return identity.profileNames.length && parseAcquisitionDate(identity.firstContactAt);
      })
      : [];
    var result = {
      available: direct?.available === true && Array.isArray(direct?.identities),
      namedProfiles: identities.length,
      namedChats: Number(direct?.identityCoverage?.namedChats || 0),
      unnamedChats: Number(direct?.identityCoverage?.unnamedChats || 0),
      exact: 0,
      probable: 0,
      linkedRegistrations: 0,
      unmatchedProfiles: identities.length,
      unmatchedRegistrations: registered.length,
      ambiguous: 0,
      durations: [],
      averageRegistration: null,
    };
    if (!result.available || !identities.length || !registered.length) return result;

    var leadsByName = new Map();
    registered.forEach(function (lead) {
      var name = normalizePersonName(lead.nome);
      if (!name) return;
      addToIndex(leadsByName, name, lead);
    });
    var identitiesByName = new Map();
    var identityFuzzyBuckets = new Map();
    identities.forEach(function (identity) {
      identity.profileNames.forEach(function (name) {
        addToIndex(identitiesByName, name, identity);
        var tokens = meaningfulNameTokens(name);
        if (tokens.length >= 2) {
          tokens.forEach(function (token) { addToIndex(identityFuzzyBuckets, token.slice(0, 3), identity); });
        }
      });
    });
    var usedIdentities = new Set();
    var usedLeads = new Set();
    var exactEdges = [];
    leadsByName.forEach(function (leads, name) {
      var eligibleIdentities = identitiesByName.get(name) || [];
      leads.forEach(function (lead) {
        eligibleIdentities.forEach(function (identity) {
          if (directContactPrecedesRegistration(identity, lead)) {
            exactEdges.push({ lead: lead, identity: identity, matchedName: name });
          }
        });
      });
    });
    var exactLeadDegree = new Map();
    var exactIdentityDegree = new Map();
    exactEdges.forEach(function (edge) {
      exactLeadDegree.set(edge.lead, (exactLeadDegree.get(edge.lead) || 0) + 1);
      exactIdentityDegree.set(edge.identity.index, (exactIdentityDegree.get(edge.identity.index) || 0) + 1);
    });
    var ambiguousIdentities = new Set();
    exactEdges.forEach(function (edge) {
      if (exactLeadDegree.get(edge.lead) !== 1 || exactIdentityDegree.get(edge.identity.index) !== 1) {
        ambiguousIdentities.add(edge.identity.index);
        return;
      }
      assignDirectContactMatch(
        edge.lead,
        edge.identity,
        'exact',
        'exact-name',
        1,
        edge.matchedName,
      );
      usedIdentities.add(edge.identity.index);
      usedLeads.add(edge.lead);
      result.exact += 1;
    });
    result.ambiguous = ambiguousIdentities.size;

    var edges = [];
    registered.forEach(function (lead) {
      if (usedLeads.has(lead)) return;
      var leadName = normalizePersonName(lead.nome);
      var leadTokens = meaningfulNameTokens(leadName);
      if (leadTokens.length < 2) return;
      var bucket = leadTokens.flatMap(function (token) {
        return identityFuzzyBuckets.get(token.slice(0, 3)) || [];
      });
      var uniqueBucket = Array.from(new Map(bucket.map(function (identity) {
        return [identity.index, identity];
      })).values());
      var ranked = uniqueBucket.filter(function (identity) {
        return !usedIdentities.has(identity.index)
          && !ambiguousIdentities.has(identity.index)
          && identity.profileNames.some(function (name) { return meaningfulNameTokens(name).length >= 2; })
          && directContactPrecedesRegistration(identity, lead);
      }).map(function (identity) {
        var candidates = identity.profileNames.map(function (name) {
          return { name: name, score: nameSimilarity(leadName, name) };
        }).sort(function (left, right) { return right.score - left.score; });
        return { identity: identity, score: candidates[0]?.score || 0, matchedName: candidates[0]?.name || identity.profileName };
      }).sort(function (left, right) { return right.score - left.score; });
      if (ranked[0]?.score >= 0.92 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.06)) {
        edges.push({ lead: lead, identity: ranked[0].identity, score: ranked[0].score, matchedName: ranked[0].matchedName });
      }
    });
    var fuzzyAmbiguousIdentities = new Set();
    edges.sort(function (left, right) { return right.score - left.score; }).forEach(function (edge) {
      if (usedLeads.has(edge.lead) || usedIdentities.has(edge.identity.index) || fuzzyAmbiguousIdentities.has(edge.identity.index)) return;
      var competing = edges.filter(function (candidate) {
        return candidate !== edge
          && candidate.identity.index === edge.identity.index
          && !usedLeads.has(candidate.lead);
      }).sort(function (left, right) { return right.score - left.score; });
      if (competing[0] && edge.score - competing[0].score < 0.06) {
        fuzzyAmbiguousIdentities.add(edge.identity.index);
        return;
      }
      assignDirectContactMatch(edge.lead, edge.identity, 'probable', 'similar-name', edge.score, edge.matchedName);
      usedIdentities.add(edge.identity.index);
      usedLeads.add(edge.lead);
      result.probable += 1;
    });
    result.ambiguous += fuzzyAmbiguousIdentities.size;

    result.linkedRegistrations = result.exact + result.probable;
    result.unmatchedProfiles = Math.max(0, identities.length - usedIdentities.size);
    result.unmatchedRegistrations = Math.max(0, registered.length - usedLeads.size);
    result.durations = registered.map(function (lead) {
      return lead._directToRegistrationMs;
    }).filter(Number.isFinite);
    result.averageRegistration = averageDuration(result.durations);
    return result;
  }

  function findDriverMatch(contact, indexes) {
    var phone = canonicalPhone(contact?.telefone);
    var name = normalizePersonName(contact?.nome);
    var city = normalizeCity(contact?.cidade);

    var phoneCandidates = phone ? indexes.phone.get(phone) || [] : [];
    if (phoneCandidates.length) {
      return { confidence: 'confirmed', reason: 'phone', driver: chooseDriver(phoneCandidates) };
    }

    var nameCityCandidates = name && city ? indexes.nameCity.get(name + '|' + city) || [] : [];
    if (nameCityCandidates.length === 1) {
      return { confidence: 'probable', reason: 'name-city', driver: nameCityCandidates[0] };
    }

    var exactNameCandidates = name ? indexes.name.get(name) || [] : [];
    if (exactNameCandidates.length === 1) {
      var exactDriver = exactNameCandidates[0];
      var exactDriverCity = normalizeCity(driverCity(exactDriver));
      if (!city || !exactDriverCity || city === exactDriverCity) {
        return { confidence: 'probable', reason: 'name', driver: exactDriver };
      }
    }

    var nameTokens = meaningfulNameTokens(name);
    if (nameTokens.length >= 2 && city) {
      var bucket = indexes.fuzzyBucket.get(nameTokens[0].slice(0, 3) + '|' + city) || [];
      var ranked = bucket.map(function (driver) {
        return { driver: driver, score: nameSimilarity(name, driverName(driver)) };
      }).sort(function (left, right) { return right.score - left.score; });
      if (ranked[0]?.score >= 0.9 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.04)) {
        return { confidence: 'probable', reason: 'similar-name-city', driver: ranked[0].driver };
      }
    }
    return { confidence: 'none', reason: '', driver: null };
  }

  function prepareTimingData() {
    var leadsByIdentity = new Map();
    state.leads.forEach(function (lead, index) {
      lead._registrationDate = parseCrmDate(lead.dataContato);
      lead._forwardedDate = parseCrmDate(lead.dataEncaminhamento);
      lead._waitMs = durationBetween(lead._registrationDate, lead._forwardedDate);
      lead.tempoEncaminhamento = formatDuration(lead._waitMs);
      leadsByIdentity.set(contactIdentity(lead, index), lead);
    });

    state.forwarded.forEach(function (item, index) {
      var sourceLead = leadsByIdentity.get(contactIdentity(item, index));
      item._sourceLead = sourceLead || null;
      if (sourceLead) sourceLead._forwardedRecord = item;
      item._registrationDate = sourceLead?._registrationDate || null;
      item._forwardedDate = parseCrmDate(item.data) || sourceLead?._forwardedDate || null;
      item._finalDate = parseCrmDate(item.dataFinal);
      item._waitMs = durationBetween(item._registrationDate, item._forwardedDate);
      item._serviceMs = durationBetween(item._forwardedDate, item._finalDate);
      item._totalMs = durationBetween(item._registrationDate, item._finalDate);
      item.tempoEspera = formatDuration(item._waitMs);
      item.tempoAtendimento = formatDuration(item._serviceMs);
      item.tempoTotal = formatDuration(item._totalMs);
    });
  }

  function prepareDriverMatchData() {
    var leadsByIdentity = new Map();
    var indexes = state.driversLoadFailed ? null : buildDriverIndexes(state.drivers);

    state.leads.forEach(function (lead, index) {
      lead._driverMatch = null;
      lead._appCreatedAt = null;
      lead._appRegistrationMs = null;
      lead._alreadyRegistered = false;
      lead._campaignJoinedAt = null;
      lead._campaignEntryMs = null;
      lead._alreadyInCampaign = false;
      lead.appRegistrationDate = '';
      lead.tempoCadastroApp = '';
      lead.campaignEntryDate = '';
      lead.tempoEntradaCampanha = '';

      if (!indexes) {
        lead.appSituation = 'Dados indisponíveis';
      } else {
        var match = findDriverMatch(lead, indexes);
        lead._driverMatch = match;
        if (match.confidence === 'probable') {
          lead.appSituation = 'Possível cadastro - revisar';
        } else if (match.confidence !== 'confirmed') {
          lead.appSituation = 'Não encontrado no app';
        } else {
          lead.appSituation = match.driver?.campaignId ? 'Em campanha' : 'Cadastrado sem campanha';
          lead._appCreatedAt = parseDriverCreatedAt(match.driver?.createdAt);
          lead.appRegistrationDate = formatDateTime(lead._appCreatedAt);
          lead._campaignJoinedAt = parseDriverCreatedAt(
            match.driver?.campaignData?.joinedAt ||
            match.driver?.campaignJoinedAt ||
            match.driver?.campaignCreatedAt
          );
          lead.campaignEntryDate = formatDateTime(lead._campaignJoinedAt);

          if (lead._registrationDate && lead._appCreatedAt) {
            var difference = lead._appCreatedAt.getTime() - lead._registrationDate.getTime();
            if (difference < 0) {
              lead._alreadyRegistered = true;
              lead.tempoCadastroApp = 'Já era cadastrado';
            } else {
              lead._appRegistrationMs = difference;
              lead.tempoCadastroApp = formatDuration(difference);
            }
          }

          if (lead._registrationDate && lead._campaignJoinedAt) {
            var campaignDifference = lead._campaignJoinedAt.getTime() - lead._registrationDate.getTime();
            if (campaignDifference < 0) {
              lead._alreadyInCampaign = true;
              lead.tempoEntradaCampanha = 'Já estava em campanha';
            } else {
              lead._campaignEntryMs = campaignDifference;
              lead.tempoEntradaCampanha = formatDuration(campaignDifference);
            }
          }
        }
      }
      leadsByIdentity.set(contactIdentity(lead, index), lead);
    });

    state.forwarded.forEach(function (item, index) {
      var sourceLead = leadsByIdentity.get(contactIdentity(item, index));
      item._driverMatch = sourceLead?._driverMatch || null;
      item._appCreatedAt = sourceLead?._appCreatedAt || null;
      item._appRegistrationMs = sourceLead?._appRegistrationMs ?? null;
      item._alreadyRegistered = Boolean(sourceLead?._alreadyRegistered);
      item._campaignJoinedAt = sourceLead?._campaignJoinedAt || null;
      item._campaignEntryMs = sourceLead?._campaignEntryMs ?? null;
      item._alreadyInCampaign = Boolean(sourceLead?._alreadyInCampaign);
    });
  }

  function buildFunnelModel() {
    var registered = uniqueContacts(state.leads.filter(function (item) {
      return dateInsideFunnelPeriod(item._registrationDate) && belongsToInstagramAcquisition(item);
    }));
    var directIdentity = buildDirectIdentityModel(registered, state.acquisition?.direct || null);
    var registeredIdentities = new Set(registered.map(function (item) {
      return contactIdentity(item);
    }));
    var forwarded = uniqueContacts(state.forwarded.filter(function (item) {
      var sourceLead = item._sourceLead;
      if (!sourceLead || !dateInsideFunnelPeriod(sourceLead._registrationDate)) return false;
      return registeredIdentities.has(contactIdentity(sourceLead));
    }));
    var attended = forwarded.filter(hasAssignedAttendant);
    var withOutcome = attended.filter(function (item) { return OUTCOME_STATUSES.includes(normalizeText(item.status)); });
    var outcomes = { efetivado: 0, cadastrado: 0, perdido: 0, 'nao responde': 0 };
    withOutcome.forEach(function (item) {
      var status = normalizeText(item.status);
      if (Object.hasOwn(outcomes, status)) outcomes[status] += 1;
    });

    var waitDurations = registered.map(function (item) { return item._waitMs; }).filter(Number.isFinite);
    var serviceDurations = withOutcome.map(function (item) { return item._serviceMs; }).filter(Number.isFinite);
    var attendants = new Map();
    attended.forEach(function (item) {
      var name = String(item.atendente || '').trim();
      var key = normalizeText(name);
      if (!attendants.has(key)) attendants.set(key, { name: name, total: 0, withOutcome: 0, waits: [], services: [], appRegistrations: [], campaignEntries: [] });
      var group = attendants.get(key);
      group.total += 1;
      if (OUTCOME_STATUSES.includes(normalizeText(item.status))) group.withOutcome += 1;
      if (Number.isFinite(item._waitMs)) group.waits.push(item._waitMs);
      if (Number.isFinite(item._serviceMs)) group.services.push(item._serviceMs);
      if (Number.isFinite(item._appRegistrationMs)) group.appRegistrations.push(item._appRegistrationMs);
      if (Number.isFinite(item._campaignEntryMs)) group.campaignEntries.push(item._campaignEntryMs);
    });

    var matches = {
      available: !state.driversLoadFailed,
      confirmed: 0,
      probable: 0,
      notFound: 0,
      inCampaign: 0,
      withoutCampaign: 0,
      registeredAfter: 0,
      alreadyRegistered: 0,
      alreadyInCampaign: 0,
      inCampaignAlreadyRegistered: 0,
      inCampaignRegisteredAfter: 0,
      inCampaignRegistrationDateUnavailable: 0,
      registrationDurations: [],
      campaignEntryDurations: [],
    };
    if (matches.available) {
      registered.forEach(function (contact) {
        var match = contact._driverMatch || { confidence: 'none', driver: null };
        if (match.confidence === 'confirmed') {
          matches.confirmed += 1;
          if (match.driver?.campaignId) {
            matches.inCampaign += 1;
            if (contact._alreadyRegistered) {
              matches.inCampaignAlreadyRegistered += 1;
            } else if (Number.isFinite(contact._appRegistrationMs)) {
              matches.inCampaignRegisteredAfter += 1;
            } else {
              matches.inCampaignRegistrationDateUnavailable += 1;
            }
          } else {
            matches.withoutCampaign += 1;
          }
          if (contact._alreadyRegistered) {
            matches.alreadyRegistered += 1;
          } else if (Number.isFinite(contact._appRegistrationMs)) {
            matches.registeredAfter += 1;
            matches.registrationDurations.push(contact._appRegistrationMs);
          }
          if (contact._alreadyInCampaign) {
            matches.alreadyInCampaign += 1;
          } else if (Number.isFinite(contact._campaignEntryMs)) {
            matches.campaignEntryDurations.push(contact._campaignEntryMs);
          }
        } else if (match.confidence === 'probable') {
          matches.probable += 1;
        } else {
          matches.notFound += 1;
        }
      });
    }
    matches.registrationDateUnavailable = Math.max(
      0,
      matches.confirmed - matches.registeredAfter - matches.alreadyRegistered,
    );

    return {
      acquisition: state.acquisition,
      registered: registered.length,
      forwarded: forwarded.length,
      attended: attended.length,
      outcomes: outcomes,
      pendingOutcome: Math.max(0, attended.length - withOutcome.length),
      timing: {
        directRegistration: directIdentity.averageRegistration,
        directRegistrationCount: directIdentity.durations.length,
        wait: averageDuration(waitDurations),
        waitCount: waitDurations.length,
        service: averageDuration(serviceDurations),
        serviceCount: serviceDurations.length,
        appRegistration: averageDuration(matches.registrationDurations),
        appRegistrationCount: matches.registrationDurations.length,
        campaignEntry: averageDuration(matches.campaignEntryDurations),
        campaignEntryCount: matches.campaignEntryDurations.length,
      },
      attendants: Array.from(attendants.values()).sort(function (left, right) { return right.total - left.total || left.name.localeCompare(right.name, 'pt-BR'); }),
      directIdentity: directIdentity,
      matches: matches,
    };
  }

  async function parseResponse(response) {
    var text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_error) {
      return {};
    }
  }

  async function requestJson(path, options) {
    var config = options || {};
    var headers = { Authorization: 'Bearer ' + TOKEN };
    var body = config.body;

    if (body != null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    var response = await fetch(API_BASE + path, {
      method: config.method || 'GET',
      headers: headers,
      body: body,
    });
    var payload = await parseResponse(response);

    if (response.status === 401) {
      localStorage.removeItem('adminToken');
      window.top.location.replace('/login.html');
      throw new Error('Sessão expirada.');
    }

    if (!response.ok) {
      var error = new Error(payload.error || ('HTTP ' + response.status));
      error.status = response.status;
      error.code = payload.code || '';
      throw error;
    }

    return payload;
  }

  function formatCurrency(value, currency) {
    if (!Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value));
  }

  function configureAcquisitionControls(acquisitionStatus) {
    state.acquisitionStatus = acquisitionStatus || {};
    var metaStatus = state.acquisitionStatus.metaAds || {};
    var previous = state.funnelPeriod.accountId || metaStatus.defaultAccountId || '';
    refs.funnelAccountSelect.replaceChildren();
    (metaStatus.accounts || []).forEach(function (account) {
      var option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.label || account.id;
      refs.funnelAccountSelect.appendChild(option);
    });
    if (previous && Array.from(refs.funnelAccountSelect.options).some(function (option) { return option.value === previous; })) {
      refs.funnelAccountSelect.value = previous;
    }
    state.funnelPeriod.accountId = refs.funnelAccountSelect.value || previous;
    refs.funnelAccountSelect.disabled = !metaStatus.configured || refs.funnelAccountSelect.options.length < 2;
  }

  function acquisitionRequestKey() {
    return [
      state.funnelPeriod.accountId || '',
      state.funnelPeriod.from || '',
      state.funnelPeriod.to || '',
    ].join(':');
  }

  function readAcquisitionCache(key) {
    var entry = state.acquisitionCache.get(key);
    if (!entry || Date.now() - entry.createdAt >= ACQUISITION_CACHE_TTL_MS) {
      if (entry) state.acquisitionCache.delete(key);
      return null;
    }
    state.acquisitionCache.delete(key);
    state.acquisitionCache.set(key, entry);
    return entry.value;
  }

  function writeAcquisitionCache(key, value) {
    state.acquisitionCache.delete(key);
    state.acquisitionCache.set(key, { value: value, createdAt: Date.now() });
    while (state.acquisitionCache.size > ACQUISITION_CACHE_MAX_ENTRIES) {
      state.acquisitionCache.delete(state.acquisitionCache.keys().next().value);
    }
  }

  function describeAcquisitionSources(acquisition, cached) {
    var sources = [];
    if (acquisition?.metaAds?.available) sources.push('Meta');
    if (acquisition?.direct?.available) sources.push('GPT Maker');
    if (!sources.length) return 'Fontes de aquisição ainda não configuradas';
    return (cached ? 'Dados em cache: ' : 'Dados atualizados: ') + sources.join(' + ');
  }

  async function loadAcquisition(force) {
    if (state.acquisitionLoading) return;
    var requestKey = acquisitionRequestKey();
    if (!force) {
      var cached = readAcquisitionCache(requestKey);
      if (cached) {
        state.acquisition = cached;
        refs.acquisitionSyncState.textContent = describeAcquisitionSources(cached, true);
        renderFunnel();
        return;
      }
    }
    state.acquisitionLoading = true;
    refs.btnApplyFunnelPeriod.disabled = true;
    refs.acquisitionSyncState.textContent = 'Consultando MongoDB e fontes integradas...';
    renderFunnel();

    try {
      var query = new URLSearchParams({
        from: state.funnelPeriod.from,
        to: state.funnelPeriod.to,
      });
      if (state.funnelPeriod.accountId) query.set('accountId', state.funnelPeriod.accountId);
      if (force) query.set('refresh', '1');
      state.acquisition = await requestJson('/api/crm/acquisition-funnel?' + query.toString());
      writeAcquisitionCache(requestKey, state.acquisition);
      refs.acquisitionSyncState.textContent = describeAcquisitionSources(state.acquisition, false);
    } catch (error) {
      console.warn('[crm] acquisition funnel unavailable:', error);
      state.acquisition = {
        metaAds: { available: false },
        direct: { available: false, conversations: null },
        error: error?.message || 'Aquisição indisponível',
      };
      refs.acquisitionSyncState.textContent = 'Não foi possível atualizar a aquisição';
    } finally {
      state.acquisitionLoading = false;
      refs.btnApplyFunnelPeriod.disabled = false;
      renderFunnel();
    }
  }

  function applySelectedFunnelPeriod() {
    var from = refs.funnelDateFrom.value;
    var to = refs.funnelDateTo.value;
    if (!from || !to || from > to) {
      showToast('Selecione um período válido para o funil.', true);
      return;
    }
    state.funnelPeriod = {
      preset: refs.funnelPeriodPreset.value,
      accountId: refs.funnelAccountSelect.value,
      from: from,
      to: to,
    };
    renderFunnel();
    loadAcquisition(false);
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    refs.btnRefresh.disabled = isLoading;
    refs.btnCreateLead.disabled = isLoading;
    refs.loadingState.classList.toggle('hidden', !isLoading);
    if (isLoading) {
      refs.errorState.classList.add('hidden');
      refs.emptyState.classList.add('hidden');
      refs.tableWrap.classList.add('hidden');
      refs.pagination.classList.add('hidden');
      refs.syncState.textContent = 'Sincronizando...';
    }
  }

  function showLoadError(error) {
    setLoading(false);
    refs.errorState.classList.remove('hidden');
    refs.tableWrap.classList.add('hidden');
    refs.emptyState.classList.add('hidden');
    refs.pagination.classList.add('hidden');

    if (error?.code === 'CRM_NOT_CONFIGURED' || error?.code === 'CRM_INVALID_URL') {
      refs.errorTitle.textContent = 'Integração pendente';
      refs.errorMessage.textContent = 'O módulo está pronto. Falta conectar o Web App do Apps Script no servidor.';
      refs.syncState.textContent = 'Integração pendente';
      return;
    }

    refs.errorTitle.textContent = 'Não foi possível carregar o CRM';
    refs.errorMessage.textContent = error?.message === 'Failed to fetch'
      ? 'Não foi possível conectar ao servidor.'
      : (error?.message || 'Verifique a conexão e tente novamente.');
    refs.syncState.textContent = 'Falha na sincronização';
  }

  async function loadData(options) {
    if (state.loading) return;
    setLoading(true);

    try {
      var status = await requestJson('/api/crm/status');
      if (!status.configured) {
        var pendingError = new Error('Integração não configurada.');
        pendingError.code = 'CRM_NOT_CONFIGURED';
        throw pendingError;
      }
      configureAcquisitionControls(status.acquisition);

      var results = await Promise.all([
        requestJson('/api/crm/leads'),
        requestJson('/api/crm/forwarded'),
        requestJson('/api/drivers').catch(function (error) {
          console.warn('[crm] driver matching unavailable:', error);
          return { items: [], _loadFailed: true };
        }),
      ]);

      state.leads = (results[0].items || []).map(normalizeLead);
      state.forwarded = (results[1].items || []).map(normalizeForwarded);
      state.drivers = results[2].items || [];
      state.driversLoadFailed = Boolean(results[2]._loadFailed);
      prepareTimingData();
      prepareDriverMatchData();
      setLoading(false);
      refs.errorState.classList.add('hidden');
      refs.lastUpdated.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      refs.syncState.textContent = 'Sincronizado';
      renderAll();
      if (!state.acquisition || options?.refreshAcquisition) {
        loadAcquisition(Boolean(options?.refreshAcquisition));
      }
    } catch (error) {
      console.error('[crm] load error:', error);
      showLoadError(error);
    }
  }

  function uniqueValues(items, key, requiredValues) {
    var values = new Map();
    (requiredValues || []).concat(items.map(function (item) { return item[key]; })).forEach(function (value) {
      var clean = String(value || '').trim();
      if (!clean) return;
      var normalized = normalizeText(clean);
      if (!values.has(normalized)) values.set(normalized, clean);
    });
    return Array.from(values.values()).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  function presetValues(view, key) {
    return PRESET_OPTIONS[view]?.[key] || [];
  }

  function optionValues(view, key) {
    var items = view === 'leads' ? state.leads : state.forwarded;
    var required = presetValues(view, key);

    if (key === 'atendente') {
      items = state.leads.concat(state.forwarded);
      required = presetValues('leads', key).concat(presetValues('forwarded', key));
    }

    return uniqueValues(items, key, required);
  }

  function replaceOptions(select, values, allLabel) {
    var previous = select.value;
    select.replaceChildren();
    var all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    if (values.indexOf(previous) >= 0) select.value = previous;
  }

  function replaceDatalist(list, values) {
    list.replaceChildren();
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
  }

  function updateFilterOptions() {
    var statuses = optionValues(state.view, 'status');
    var attendants = optionValues(state.view, 'atendente');
    var origins = uniqueValues(state.leads, 'origem');

    replaceOptions(refs.filterStatus, statuses, 'Todos');
    replaceOptions(refs.filterAttendant, attendants, 'Todos');
    replaceOptions(refs.filterOrigin, origins, 'Todas');
    replaceDatalist(refs.statusOptions, statuses);
    replaceDatalist(refs.attendantOptions, attendants);
    replaceDatalist(refs.originOptions, origins);
    refs.originFilterField.classList.toggle('hidden', state.view !== 'leads');
  }

  function applyFilters(resetPage) {
    var items = state.view === 'leads' ? state.leads : state.forwarded;
    var query = normalizeText(refs.filterSearch.value);
    var status = normalizeText(refs.filterStatus.value);
    var attendant = normalizeText(refs.filterAttendant.value);
    var origin = normalizeText(refs.filterOrigin.value);

    state.filtered = items.filter(function (item) {
      if (status && normalizeText(item.status) !== status) return false;
      if (attendant && normalizeText(item.atendente) !== attendant) return false;
      if (state.view === 'leads' && origin && normalizeText(item.origem) !== origin) return false;
      if (!query) return true;
      return Object.keys(item).some(function (key) {
        return key !== 'rowNumber' && normalizeText(item[key]).includes(query);
      });
    });

    if (resetPage) state.page = 1;
    var totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    renderTable();
  }

  function statusClass(value) {
    var normalized = normalizeText(value);
    if (normalized === 'encaminhado' || normalized === 'efetivado') return 'status-badge status-badge--forwarded';
    if (normalized.includes('perd') || normalized.includes('cancel') || normalized === 'nao tem interesse') return 'status-badge status-badge--lost';
    if (normalized === 'aguardando' || normalized === 'nao responde') return 'status-badge status-badge--open';
    if (normalized) return 'status-badge status-badge--open';
    return 'status-badge';
  }

  function formatPhone(value) {
    var phone = digits(value);
    if (phone.length === 13 && phone.startsWith('55')) phone = phone.slice(2);
    if (phone.length === 11) return '(' + phone.slice(0, 2) + ') ' + phone.slice(2, 7) + '-' + phone.slice(7);
    if (phone.length === 10) return '(' + phone.slice(0, 2) + ') ' + phone.slice(2, 6) + '-' + phone.slice(6);
    return String(value || '');
  }

  function fieldDefinition(view, key) {
    return schemas[view].fields.find(function (field) { return field.key === key; }) || null;
  }

  function renderCellValue(cell, value, column) {
    var cleanValue = String(value || '').trim();
    cell.replaceChildren();
    cell.title = cleanValue || (column.readonly ? '' : 'Clique para editar');

    if (column.status) {
      var badge = document.createElement('span');
      badge.className = statusClass(cleanValue);
      badge.textContent = cleanValue || 'Não definido';
      cell.appendChild(badge);
      return;
    }

    var display = document.createElement('span');
    if (column.primary) display.className = 'cell-primary';
    display.textContent = column.phone ? formatPhone(cleanValue) : (cleanValue || '—');
    cell.appendChild(display);
  }

  var toastTimer = null;
  function showToast(message, isError) {
    window.clearTimeout(toastTimer);
    refs.crmToast.textContent = message;
    refs.crmToast.classList.toggle('toast--error', Boolean(isError));
    refs.crmToast.classList.remove('hidden');
    toastTimer = window.setTimeout(function () {
      refs.crmToast.classList.add('hidden');
    }, isError ? 5000 : 2600);
  }

  async function saveInlineValue(cell, item, column, value) {
    var cleanValue = String(value == null ? '' : value).trim();
    var currentValue = String(item[column.key] || '').trim();
    if (cleanValue === currentValue) {
      renderCellValue(cell, currentValue, column);
      cell.classList.remove('is-editing');
      return;
    }

    state.inlineSaving = true;
    cell.classList.add('is-saving');
    refs.syncState.textContent = 'Salvando alteração...';

    try {
      var endpoint = state.view === 'leads' ? '/api/crm/leads/' : '/api/crm/forwarded/';
      var values = {};
      values[column.key] = cleanValue;
      await requestJson(endpoint + encodeURIComponent(item.rowNumber), {
        method: 'PATCH',
        body: {
          keyPhone: digits(item.telefone),
          values: values,
        },
      });

      item[column.key] = column.phone ? digits(cleanValue) : cleanValue;
      showToast(column.label + ' atualizado.');
      await loadData();
    } catch (error) {
      console.error('[crm] inline save error:', error);
      renderCellValue(cell, currentValue, column);
      cell.classList.remove('is-editing', 'is-saving');
      refs.syncState.textContent = 'Erro ao salvar';
      showToast(error?.message || 'Não foi possível salvar a alteração.', true);
    } finally {
      state.inlineSaving = false;
    }
  }

  function startInlineEdit(cell, item, column) {
    if (state.loading || state.inlineSaving || column.readonly || cell.classList.contains('is-editing')) return;

    var field = fieldDefinition(state.view, column.key);
    if (!field || field.readonly) return;

    var currentValue = String(item[column.key] || '').trim();
    var control;

    if (field.options) {
      control = document.createElement('select');
      var emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Não definido';
      control.appendChild(emptyOption);
      optionValues(state.view, field.options).forEach(function (optionValue) {
        var option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        control.appendChild(option);
      });
    } else {
      control = document.createElement('input');
      control.type = 'text';
      if (field.maxLength) control.maxLength = field.maxLength;
      if (field.inputMode) control.inputMode = field.inputMode;
      if (field.list) control.setAttribute('list', field.list);
    }

    control.className = 'inline-editor';
    control.value = currentValue;
    control.setAttribute('aria-label', 'Editar ' + column.label);
    cell.classList.add('is-editing');
    cell.replaceChildren(control);

    var settled = false;
    function finish(shouldSave) {
      if (settled) return;
      settled = true;
      if (shouldSave) {
        saveInlineValue(cell, item, column, control.value);
      } else {
        cell.classList.remove('is-editing');
        renderCellValue(cell, currentValue, column);
      }
    }

    control.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
    });
    if (control.tagName === 'SELECT') {
      control.addEventListener('change', function () { finish(true); });
    } else {
      control.addEventListener('blur', function () { finish(true); });
    }

    control.focus();
    if (control.select) control.select();
  }

  function createTextCell(value, column, item) {
    var cell = document.createElement('td');
    renderCellValue(cell, value, column);

    if (column.primary) {
      var detailButton = document.createElement('button');
      detailButton.type = 'button';
      detailButton.className = 'lead-detail-link';
      detailButton.textContent = String(value || '').trim() || 'Sem nome';
      detailButton.title = 'Ver detalhes do lead';
      detailButton.setAttribute('aria-label', 'Ver detalhes de ' + detailButton.textContent);
      detailButton.addEventListener('click', function () { openLeadDetail(state.view, item); });
      cell.replaceChildren(detailButton);
      return cell;
    }

    var field = fieldDefinition(state.view, column.key);
    if (!column.readonly && field && !field.readonly) {
      cell.classList.add('editable-cell');
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', 'Editar ' + column.label);
      cell.addEventListener('click', function () { startInlineEdit(cell, item, column); });
      cell.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          startInlineEdit(cell, item, column);
        }
      });
    }
    return cell;
  }

  function createActionCell(item) {
    var cell = document.createElement('td');
    cell.className = 'column-actions';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-action';
    button.title = 'Editar';
    button.setAttribute('aria-label', 'Editar lead');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg>';
    button.addEventListener('click', function () { openEditModal(item); });
    cell.appendChild(button);
    return cell;
  }

  function renderTable() {
    var schema = schemas[state.view];
    refs.tableHead.replaceChildren();
    refs.tableBody.replaceChildren();

    var headerRow = document.createElement('tr');
    schema.columns.forEach(function (column) {
      var header = document.createElement('th');
      header.scope = 'col';
      header.textContent = column.label;
      headerRow.appendChild(header);
    });
    var actionHeader = document.createElement('th');
    actionHeader.scope = 'col';
    actionHeader.className = 'column-actions';
    actionHeader.textContent = 'Ações';
    headerRow.appendChild(actionHeader);
    refs.tableHead.appendChild(headerRow);

    var total = state.filtered.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = state.filtered.slice(start, start + PAGE_SIZE);

    pageItems.forEach(function (item) {
      var row = document.createElement('tr');
      schema.columns.forEach(function (column) {
        row.appendChild(createTextCell(item[column.key], column, item));
      });
      row.appendChild(createActionCell(item));
      refs.tableBody.appendChild(row);
    });

    refs.resultSummary.textContent = total === 1 ? '1 registro' : total.toLocaleString('pt-BR') + ' registros';
    refs.loadingState.classList.add('hidden');
    refs.errorState.classList.add('hidden');
    refs.emptyState.classList.toggle('hidden', total > 0);
    refs.tableWrap.classList.toggle('hidden', total === 0);
    refs.pagination.classList.toggle('hidden', total === 0);
    refs.pageInfo.textContent = 'Página ' + state.page + ' de ' + totalPages;
    refs.btnPreviousPage.disabled = state.page <= 1;
    refs.btnNextPage.disabled = state.page >= totalPages;
  }

  function renderMetrics() {
    var total = state.leads.length;
    var forwarded = state.leads.filter(function (item) {
      return normalizeText(item.status) === 'encaminhado';
    }).length;
    var open = state.leads.filter(function (item) {
      var status = normalizeText(item.status);
      return !status || status === 'aguardando';
    }).length;
    var rate = total ? Math.round((forwarded / total) * 100) : 0;

    refs.metricTotal.textContent = total.toLocaleString('pt-BR');
    refs.metricForwarded.textContent = forwarded.toLocaleString('pt-BR');
    refs.metricOpen.textContent = open.toLocaleString('pt-BR');
    refs.metricRate.textContent = rate + '%';
    refs.tabLeadsCount.textContent = total.toLocaleString('pt-BR');
    refs.tabForwardedCount.textContent = state.forwarded.length.toLocaleString('pt-BR');
  }

  function percentage(part, total) {
    return total ? Math.round((part / total) * 100) : 0;
  }

  function sampleLabel(count) {
    return count === 1 ? '1 registro calculado' : count.toLocaleString('pt-BR') + ' registros calculados';
  }

  function appRegistrationSampleLabel(calculated, alreadyRegistered) {
    var calculatedText = calculated === 1 ? '1 cadastro calculado' : calculated.toLocaleString('pt-BR') + ' cadastros calculados';
    var previousText = alreadyRegistered === 1 ? '1 já era cadastrado' : alreadyRegistered.toLocaleString('pt-BR') + ' já eram cadastrados';
    return calculatedText + ' · ' + previousText;
  }

  function appendAttendantCell(row, value) {
    var cell = document.createElement('td');
    cell.textContent = String(value);
    row.appendChild(cell);
  }

  function renderAttendantTiming(groups) {
    refs.attendantTimingBody.replaceChildren();
    if (!groups.length) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 7;
      emptyCell.className = 'attendant-table__empty';
      emptyCell.textContent = 'Nenhum lead com atendente definido para calcular.';
      emptyRow.appendChild(emptyCell);
      refs.attendantTimingBody.appendChild(emptyRow);
      return;
    }

    groups.forEach(function (group) {
      var row = document.createElement('tr');
      appendAttendantCell(row, group.name);
      appendAttendantCell(row, group.total.toLocaleString('pt-BR'));
      appendAttendantCell(row, group.withOutcome.toLocaleString('pt-BR'));
      appendAttendantCell(row, formatDuration(averageDuration(group.waits)));
      appendAttendantCell(row, formatDuration(averageDuration(group.services)));
      appendAttendantCell(row, formatDuration(averageDuration(group.appRegistrations)));
      appendAttendantCell(row, formatDuration(averageDuration(group.campaignEntries)));
      refs.attendantTimingBody.appendChild(row);
    });
  }

  function renderFunnel() {
    var model = buildFunnelModel();
    var number = function (value) { return value.toLocaleString('pt-BR'); };
    var acquisition = model.acquisition || {};
    var meta = acquisition.metaAds || {};
    var direct = acquisition.direct || {};
    var reconciliation = acquisition.reconciliation || {};
    var metaAvailable = meta.available === true;
    var directAvailable = direct.available === true && Number.isFinite(Number(direct.conversations));
    var reconciliationAvailable = reconciliation.available === true;
    var directIdentity = model.directIdentity;
    var clicks = metaAvailable ? Number(meta.clicks || 0) : null;
    var attributedConversations = metaAvailable ? Number(meta.attributedConversations || 0) : null;
    var directConversations = directAvailable ? Number(direct.conversations || 0) : null;
    var unattributedChats = reconciliationAvailable ? Number(reconciliation.unattributedChats || 0) : null;
    var attributionShare = reconciliationAvailable
      && reconciliation.attributedShare !== null
      && reconciliation.attributedShare !== undefined
      && Number.isFinite(Number(reconciliation.attributedShare))
      ? Number(reconciliation.attributedShare)
      : null;
    var unattributedShare = reconciliationAvailable
      && reconciliation.unattributedShare !== null
      && reconciliation.unattributedShare !== undefined
      && Number.isFinite(Number(reconciliation.unattributedShare))
      ? Number(reconciliation.unattributedShare)
      : null;
    var sourcesNotReconciled = reconciliation.status === 'sources-not-reconciled';
    var currency = meta.account?.currency || 'BRL';
    var percentNumber = function (value) {
      return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '%';
    };

    refs.funnelPeriodLabel.textContent = 'Período: ' + funnelPeriodLabel() + '.';
    refs.funnelAdClicks.textContent = metaAvailable ? number(clicks) : '—';
    refs.funnelClickCost.textContent = metaAvailable
      ? 'CPC ' + formatCurrency(meta.cpc, currency)
      : 'META ADS indisponível';
    refs.funnelAttributedConversations.textContent = metaAvailable ? number(attributedConversations) : '—';
    refs.funnelAttributedRate.textContent = metaAvailable && clicks > 0
      ? percentage(attributedConversations, clicks) + '% dos cliques'
      : 'atribuição agregada da Meta';
    refs.branchGptChats.textContent = directAvailable ? number(directConversations) : '—';
    refs.branchGptChatsRate.textContent = directAvailable
      ? '100% dos chats observados no período'
      : 'GPT Maker indisponível';
    refs.branchUnattributedChats.textContent = reconciliationAvailable ? number(unattributedChats) : '—';
    refs.branchUnattributedChatsRate.textContent = reconciliationAvailable
      ? (sourcesNotReconciled
        ? 'fontes não conciliadas'
        : (unattributedShare !== null ? percentNumber(unattributedShare) + ' dos chats observados' : 'sem chats no período'))
      : 'aguardando as duas fontes';

    refs.funnelRegistered.textContent = number(model.registered);
    refs.funnelRegisteredRate.textContent = directIdentity.available
      ? number(directIdentity.linkedRegistrations) + ' vínculo(s) por nome com o Direct'
      : (directAvailable ? 'nenhum chat novo no período' : 'no período selecionado');
    refs.funnelForwarded.textContent = number(model.forwarded);
    refs.funnelForwardedRate.textContent = percentage(model.forwarded, model.registered) + '% dos registrados';
    refs.funnelResolved.textContent = number(model.attended);
    refs.funnelResolvedRate.textContent = percentage(model.attended, model.forwarded) + '% dos encaminhados';
    refs.branchOutcomeEffective.textContent = number(model.outcomes.efetivado);
    refs.branchOutcomeEffectiveRate.textContent = percentage(model.outcomes.efetivado, model.attended) + '% dos atendidos';
    refs.branchOutcomeRegistered.textContent = number(model.outcomes.cadastrado);
    refs.branchOutcomeRegisteredRate.textContent = percentage(model.outcomes.cadastrado, model.attended) + '% dos atendidos';
    refs.branchOutcomeLost.textContent = number(model.outcomes.perdido);
    refs.branchOutcomeLostRate.textContent = percentage(model.outcomes.perdido, model.attended) + '% dos atendidos';
    refs.branchOutcomeNoAnswer.textContent = number(model.outcomes['nao responde']);
    refs.branchOutcomeNoAnswerRate.textContent = percentage(model.outcomes['nao responde'], model.attended) + '% dos atendidos';
    refs.branchOutcomePending.textContent = number(model.pendingOutcome);
    refs.branchOutcomePendingRate.textContent = percentage(model.pendingOutcome, model.attended) + '% dos atendidos';

    refs.acquisitionSpend.textContent = metaAvailable ? formatCurrency(meta.spend, currency) : '—';
    refs.acquisitionCpc.textContent = metaAvailable ? 'CPC ' + formatCurrency(meta.cpc, currency) : 'META ADS indisponível';
    refs.acquisitionMetaConversations.textContent = metaAvailable ? number(attributedConversations) : '—';
    refs.acquisitionMetaConversationCost.textContent = metaAvailable
      ? 'Custo ' + formatCurrency(meta.costPerAttributedConversation, currency)
      : 'Custo indisponível';
    refs.acquisitionGptConversations.textContent = directAvailable ? number(directConversations) : '—';
    refs.acquisitionGptInteractions.textContent = directAvailable
      ? number(Number(direct.interactions || 0)) + ' atendimento(s) no período'
      : (direct.configured === false ? 'Configure a API do GPT Maker' : 'Fonte indisponível');
    refs.acquisitionUnattributedChats.textContent = reconciliationAvailable ? number(unattributedChats) : '—';
    refs.acquisitionUnattributedChatsNote.textContent = reconciliationAvailable
      ? (sourcesNotReconciled
        ? number(Number(reconciliation.excessAttributedConversations || 0)) + ' atribuição(ões) da Meta excedem os chats observados'
        : (unattributedShare !== null
          ? percentNumber(unattributedShare) + ' dos chats observados; não confirma origem orgânica'
          : 'Nenhum chat observado no período'))
      : 'Disponível quando Meta e GPT Maker responderem';
    refs.acquisitionAttributedShare.textContent = attributionShare !== null ? percentNumber(attributionShare) : '—';
    refs.acquisitionAttributedShareNote.textContent = reconciliationAvailable
      ? (sourcesNotReconciled ? 'Fontes não conciliadas no período' : 'Parcela conciliada com atribuição da Meta')
      : 'Sobre os chats observados no GPT Maker';
    refs.acquisitionClickToDirect.textContent = metaAvailable && clicks > 0
      ? percentage(attributedConversations, clicks) + '%'
      : '—';
    refs.acquisitionDirectToRegistered.textContent = directAvailable && directConversations > 0
      ? percentage(directIdentity.linkedRegistrations, directConversations) + '%'
      : '—';
    refs.acquisitionCostPerDirect.textContent = metaAvailable && attributedConversations > 0
      ? formatCurrency(reconciliation.costPerAttributedConversation ?? meta.costPerAttributedConversation, currency)
      : '—';
    var campaignLeadCount = model.matches.available ? model.matches.inCampaign : null;
    refs.acquisitionCostPerCampaignLead.textContent = metaAvailable && campaignLeadCount > 0
      ? formatCurrency(meta.spend / campaignLeadCount, currency)
      : '—';
    refs.acquisitionCostPerCampaignLeadNote.textContent = !metaAvailable
      ? 'Investimento da Meta indisponível'
      : (campaignLeadCount === null
        ? 'Dados dos motoristas indisponíveis nesta atualização'
        : (campaignLeadCount > 0
          ? 'Investimento ÷ ' + number(campaignLeadCount) + ' lead(s) do período atualmente em campanha'
          : 'Nenhum lead do período está atualmente em campanha'));
    refs.acquisitionNamedProfiles.textContent = directIdentity.available
      ? number(directIdentity.namedProfiles)
      : '—';
    refs.acquisitionDirectRegistrationTime.textContent = directIdentity.available
      ? formatDuration(directIdentity.averageRegistration)
      : '—';
    refs.acquisitionDirectRegistrationTimeSample.textContent = directIdentity.available
      ? sampleLabel(directIdentity.durations.length)
      : 'Primeiro contato no Direct até a data de registro';
    var directCoverageComplete = direct.freshness?.coverageComplete !== false;
    refs.acquisitionReconciliationNote.textContent = sourcesNotReconciled
      ? 'A Meta registrou mais conversas atribuídas do que o GPT Maker observou. As fontes usam critérios diferentes e não foram conciliadas neste período.'
      : 'Chats sem atribuição publicitária são a diferença entre os chats observados no GPT Maker e as conversas atribuídas pela Meta. Esse valor não confirma, isoladamente, origem orgânica.';
    refs.acquisitionDetailNotice.textContent = state.acquisitionLoading
      ? 'Atualizando dados sob demanda'
      : (metaAvailable && directAvailable
        ? (directCoverageComplete
          ? 'Meta selecionada + chats Instagram do GPT Maker; origens conciliadas de forma agregada'
          : 'GPT Maker com cobertura parcial para o período')
        : (metaAvailable ? 'Meta ativa · GPT Maker pendente' : 'Fontes de aquisição indisponíveis'));

    if (model.matches.available) {
      refs.funnelAppConfirmed.textContent = number(model.matches.confirmed);
      refs.funnelAppRate.textContent = percentage(model.matches.confirmed, model.registered) + '% dos registrados';
      refs.funnelInCampaign.textContent = number(model.matches.inCampaign);
      refs.funnelCampaignRate.textContent = percentage(model.matches.inCampaign, model.matches.confirmed) + '% dos cadastros confirmados';
      refs.matchConfirmed.textContent = number(model.matches.confirmed);
      refs.matchConfirmedRate.textContent = percentage(model.matches.confirmed, model.registered) + '% dos registrados';
      refs.matchWithoutCampaign.textContent = number(model.matches.withoutCampaign);
      refs.matchWithoutCampaignRate.textContent = percentage(model.matches.withoutCampaign, model.matches.confirmed) + '% dos confirmados';
      refs.matchInCampaign.textContent = number(model.matches.inCampaign);
      refs.matchInCampaignRate.textContent = percentage(model.matches.inCampaign, model.matches.confirmed) + '% dos confirmados';
      refs.matchCampaignConversion.textContent = percentage(model.matches.inCampaign, model.matches.confirmed) + '%';
      refs.matchProbable.textContent = number(model.matches.probable);
      refs.matchNotFound.textContent = number(model.matches.notFound);
      refs.matchNotFoundRate.textContent = percentage(model.matches.notFound, model.registered) + '% dos registrados';
      refs.matchAlreadyRegistered.textContent = number(model.matches.alreadyRegistered);
      refs.matchAlreadyRegisteredRate.textContent = percentage(model.matches.alreadyRegistered, model.matches.confirmed) + '% dos confirmados';
      refs.matchRegisteredAfter.textContent = number(model.matches.registeredAfter);
      refs.matchRegisteredAfterRate.textContent = percentage(model.matches.registeredAfter, model.matches.confirmed) + '% dos confirmados';
      refs.matchNoRegistrationDate.textContent = number(model.matches.registrationDateUnavailable);
      refs.matchNoRegistrationDateRate.textContent = percentage(model.matches.registrationDateUnavailable, model.matches.confirmed) + '% dos confirmados';
      refs.campaignHistoryNotice.textContent = number(model.matches.inCampaign) + ' motorista(s) em campanha';
      refs.matchCampaignAlreadyRegistered.textContent = number(model.matches.inCampaignAlreadyRegistered);
      refs.matchCampaignAlreadyRegisteredRate.textContent = percentage(model.matches.inCampaignAlreadyRegistered, model.matches.inCampaign) + '% dos que estão em campanha';
      refs.matchCampaignRegisteredAfter.textContent = number(model.matches.inCampaignRegisteredAfter);
      refs.matchCampaignRegisteredAfterRate.textContent = percentage(model.matches.inCampaignRegisteredAfter, model.matches.inCampaign) + '% dos que estão em campanha';
      refs.matchCampaignNoDate.textContent = number(model.matches.inCampaignRegistrationDateUnavailable);
      refs.matchCampaignNoDateRate.textContent = percentage(model.matches.inCampaignRegistrationDateUnavailable, model.matches.inCampaign) + '% dos que estão em campanha';
      refs.branchAppRegisteredAfter.textContent = number(model.matches.registeredAfter);
      refs.branchAppRegisteredAfterRate.textContent = percentage(model.matches.registeredAfter, model.matches.confirmed) + '% dos confirmados';
      refs.branchAppAlreadyRegistered.textContent = number(model.matches.alreadyRegistered);
      refs.branchAppAlreadyRegisteredRate.textContent = percentage(model.matches.alreadyRegistered, model.matches.confirmed) + '% dos confirmados';
      refs.branchAppNoDate.textContent = number(model.matches.registrationDateUnavailable);
      refs.branchAppNoDateRate.textContent = percentage(model.matches.registrationDateUnavailable, model.matches.confirmed) + '% dos confirmados';
      refs.branchCampaignAlreadyRegistered.textContent = number(model.matches.inCampaignAlreadyRegistered);
      refs.branchCampaignAlreadyRegisteredRate.textContent = percentage(model.matches.inCampaignAlreadyRegistered, model.matches.inCampaign) + '% dos que estão em campanha';
      refs.branchCampaignRegisteredAfter.textContent = number(model.matches.inCampaignRegisteredAfter);
      refs.branchCampaignRegisteredAfterRate.textContent = percentage(model.matches.inCampaignRegisteredAfter, model.matches.inCampaign) + '% dos que estão em campanha';
      refs.branchCampaignNoDate.textContent = number(model.matches.inCampaignRegistrationDateUnavailable);
      refs.branchCampaignNoDateRate.textContent = percentage(model.matches.inCampaignRegistrationDateUnavailable, model.matches.inCampaign) + '% dos que estão em campanha';
      refs.funnelMatchNotice.textContent = number(model.registered) + ' leads analisados';
      refs.funnelHeaderSummary.textContent = (metaAvailable ? number(clicks) + ' cliques · ' : '')
        + (metaAvailable ? number(attributedConversations) + ' conversas atribuídas · ' : '')
        + (reconciliationAvailable ? number(unattributedChats) + ' sem atribuição · ' : '')
        + number(model.registered) + ' registrados · ' + number(model.forwarded) + ' encaminhados · '
        + number(model.attended) + ' atendidos · ' + number(model.matches.inCampaign) + ' em campanha';
    } else {
      refs.funnelAppConfirmed.textContent = '—';
      refs.funnelAppRate.textContent = 'motoristas indisponíveis';
      refs.funnelInCampaign.textContent = '—';
      refs.funnelCampaignRate.textContent = 'motoristas indisponíveis';
      refs.matchConfirmed.textContent = '—';
      refs.matchConfirmedRate.textContent = 'dados indisponíveis';
      refs.matchWithoutCampaign.textContent = '—';
      refs.matchWithoutCampaignRate.textContent = 'dados indisponíveis';
      refs.matchInCampaign.textContent = '—';
      refs.matchInCampaignRate.textContent = 'dados indisponíveis';
      refs.matchCampaignConversion.textContent = '—';
      refs.matchProbable.textContent = '—';
      refs.matchNotFound.textContent = '—';
      refs.matchNotFoundRate.textContent = 'dados indisponíveis';
      refs.matchAlreadyRegistered.textContent = '—';
      refs.matchAlreadyRegisteredRate.textContent = 'dados indisponíveis';
      refs.matchRegisteredAfter.textContent = '—';
      refs.matchRegisteredAfterRate.textContent = 'dados indisponíveis';
      refs.matchNoRegistrationDate.textContent = '—';
      refs.matchNoRegistrationDateRate.textContent = 'dados indisponíveis';
      refs.campaignHistoryNotice.textContent = 'Dados indisponíveis';
      refs.matchCampaignAlreadyRegistered.textContent = '—';
      refs.matchCampaignAlreadyRegisteredRate.textContent = 'dados indisponíveis';
      refs.matchCampaignRegisteredAfter.textContent = '—';
      refs.matchCampaignRegisteredAfterRate.textContent = 'dados indisponíveis';
      refs.matchCampaignNoDate.textContent = '—';
      refs.matchCampaignNoDateRate.textContent = 'dados indisponíveis';
      refs.branchAppRegisteredAfter.textContent = '—';
      refs.branchAppRegisteredAfterRate.textContent = 'dados indisponíveis';
      refs.branchAppAlreadyRegistered.textContent = '—';
      refs.branchAppAlreadyRegisteredRate.textContent = 'dados indisponíveis';
      refs.branchAppNoDate.textContent = '—';
      refs.branchAppNoDateRate.textContent = 'dados indisponíveis';
      refs.branchCampaignAlreadyRegistered.textContent = '—';
      refs.branchCampaignAlreadyRegisteredRate.textContent = 'dados indisponíveis';
      refs.branchCampaignRegisteredAfter.textContent = '—';
      refs.branchCampaignRegisteredAfterRate.textContent = 'dados indisponíveis';
      refs.branchCampaignNoDate.textContent = '—';
      refs.branchCampaignNoDateRate.textContent = 'dados indisponíveis';
      refs.funnelMatchNotice.textContent = 'Dados dos motoristas indisponíveis nesta atualização';
      refs.funnelHeaderSummary.textContent = (metaAvailable ? number(clicks) + ' cliques · ' : '')
        + (metaAvailable ? number(attributedConversations) + ' conversas atribuídas · ' : '')
        + (reconciliationAvailable ? number(unattributedChats) + ' sem atribuição · ' : '')
        + number(model.registered) + ' registrados · ' + number(model.forwarded) + ' encaminhados · ' + number(model.attended) + ' atendidos';
    }

    refs.timingDirectRegistration.textContent = formatDuration(model.timing.directRegistration);
    refs.timingDirectRegistrationSample.textContent = sampleLabel(model.timing.directRegistrationCount);
    refs.timingWait.textContent = formatDuration(model.timing.wait);
    refs.timingWaitSample.textContent = sampleLabel(model.timing.waitCount);
    refs.timingService.textContent = formatDuration(model.timing.service);
    refs.timingServiceSample.textContent = sampleLabel(model.timing.serviceCount);
    refs.timingAppRegistration.textContent = formatDuration(model.timing.appRegistration);
    refs.timingAppRegistrationSample.textContent = appRegistrationSampleLabel(model.timing.appRegistrationCount, model.matches.alreadyRegistered);
    refs.timingCampaignEntry.textContent = formatDuration(model.timing.campaignEntry);
    refs.timingCampaignEntrySample.textContent = model.timing.campaignEntryCount.toLocaleString('pt-BR') + ' vínculo(s) calculado(s) · ' + model.matches.alreadyInCampaign.toLocaleString('pt-BR') + ' já estavam em campanha';
    renderAttendantTiming(model.attendants);
  }

  function renderTabs() {
    document.querySelectorAll('[data-view]').forEach(function (tab) {
      var active = tab.dataset.view === state.view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderAll() {
    renderMetrics();
    renderFunnel();
    renderTabs();
    updateFilterOptions();
    applyFilters(true);
  }

  function setView(view) {
    if (!schemas[view] || state.view === view) return;
    state.view = view;
    state.page = 1;
    refs.filterSearch.value = '';
    refs.filterStatus.value = '';
    refs.filterAttendant.value = '';
    refs.filterOrigin.value = '';
    renderTabs();
    updateFilterOptions();
    applyFilters(true);
  }

  function detailDate(rawValue, parsedValue) {
    if (parsedValue instanceof Date && !Number.isNaN(parsedValue.getTime())) return formatDateTime(parsedValue);
    return String(rawValue || '').trim() || 'Não informado';
  }

  function matchReasonLabel(reason) {
    var labels = {
      phone: 'Telefone / WhatsApp',
      'name-city': 'Nome e cidade',
      name: 'Nome',
      'similar-name-city': 'Nome semelhante e cidade',
    };
    return labels[reason] || 'Sem correspondência';
  }

  function directMatchLabel(match) {
    if (match?.confidence === 'exact') return 'Correspondência exata pelo nome';
    if (match?.confidence === 'probable') return 'Correspondência provável pelo nome';
    return 'Sem vínculo individual com o Direct';
  }

  function appendDetailSection(title, items) {
    var section = document.createElement('section');
    section.className = 'lead-detail__section';
    var heading = document.createElement('h3');
    heading.textContent = title;
    section.appendChild(heading);

    var grid = document.createElement('div');
    grid.className = 'lead-detail__grid';
    items.forEach(function (entry) {
      var item = document.createElement('div');
      item.className = 'lead-detail__item' + (entry.full ? ' lead-detail__item--full' : '');
      var label = document.createElement('span');
      label.textContent = entry.label;
      var value = document.createElement('strong');
      value.textContent = String(entry.value || '').trim() || 'Não informado';
      if (entry.tone) value.classList.add('lead-detail__value--' + entry.tone);
      item.append(label, value);
      grid.appendChild(item);
    });
    section.appendChild(grid);
    refs.leadDetailBody.appendChild(section);
  }

  function renderLeadDetail(view, item) {
    var sourceLead = view === 'forwarded' ? item._sourceLead : item;
    var forwardedItem = view === 'forwarded' ? item : sourceLead?._forwardedRecord;
    var journeyItem = forwardedItem || item;
    var match = journeyItem._driverMatch || sourceLead?._driverMatch || null;
    var directMatch = sourceLead?._directContactMatch || null;
    var driver = match?.driver || null;
    var confidence = match?.confidence || 'none';
    var currentStatus = journeyItem.status || sourceLead?.status || 'Não definido';
    var inCampaign = Boolean(driver?.campaignId);
    var bankValue = confidence === 'confirmed'
      ? 'Sim, cadastro confirmado'
      : (confidence === 'probable' ? 'Possível correspondência' : 'Não encontrado');
    var bankTone = confidence === 'confirmed' ? 'success' : (confidence === 'probable' ? 'warning' : 'muted');
    var campaignValue = confidence === 'confirmed' ? (inCampaign ? 'Sim' : 'Não') : 'Não confirmado';
    var campaignTone = inCampaign ? 'success' : 'muted';
    var directTone = directMatch?.confidence === 'exact'
      ? 'success'
      : (directMatch?.confidence === 'probable' ? 'warning' : 'muted');
    var registrationTime = sourceLead?._alreadyRegistered
      ? 'Já estava cadastrado'
      : formatDuration(sourceLead?._appRegistrationMs);
    var campaignTime = sourceLead?._alreadyInCampaign
      ? 'Já estava em campanha'
      : formatDuration(sourceLead?._campaignEntryMs);

    refs.detailTitle.textContent = journeyItem.nome || sourceLead?.nome || 'Detalhes do lead';
    refs.leadDetailBody.replaceChildren();

    appendDetailSection('Dados da planilha', [
      { label: 'Nome', value: journeyItem.nome || sourceLead?.nome },
      { label: 'Telefone', value: formatPhone(journeyItem.telefone || sourceLead?.telefone) },
      { label: 'Cidade', value: journeyItem.cidade || sourceLead?.cidade },
      { label: 'Atendente', value: journeyItem.atendente || sourceLead?.atendente },
      { label: 'Status atual', value: currentStatus },
      { label: 'Origem', value: sourceLead?.origem },
      { label: 'Campanha de origem', value: sourceLead?.campanha },
      { label: 'Observações', value: journeyItem.observacao || sourceLead?.motivoPerda, full: true },
    ]);

    appendDetailSection('Datas importantes', [
      { label: 'Primeiro contato no Direct', value: detailDate('', sourceLead?._firstDirectContactAt) },
      { label: 'Registro do lead', value: detailDate(sourceLead?.dataContato, sourceLead?._registrationDate) },
      { label: 'Encaminhamento', value: detailDate(sourceLead?.dataEncaminhamento || journeyItem.data, journeyItem._forwardedDate || sourceLead?._forwardedDate) },
      { label: 'Resolução / data final', value: detailDate(journeyItem.dataFinal, journeyItem._finalDate) },
      { label: 'Cadastro no app', value: detailDate(sourceLead?.appRegistrationDate, sourceLead?._appCreatedAt) },
      { label: 'Entrada em campanha', value: detailDate(sourceLead?.campaignEntryDate, sourceLead?._campaignJoinedAt) },
      { label: 'Tempo do Direct até o registro', value: formatDuration(sourceLead?._directToRegistrationMs) },
      { label: 'Tempo até encaminhar', value: formatDuration(sourceLead?._waitMs) },
      { label: 'Tempo de atendimento', value: formatDuration(journeyItem._serviceMs) },
      { label: 'Tempo até cadastro no app', value: registrationTime },
      { label: 'Tempo até entrar em campanha', value: campaignTime },
    ]);

    appendDetailSection('Origem no Direct', [
      { label: 'Vínculo com o GPT Maker', value: directMatchLabel(directMatch), tone: directTone },
      { label: 'Nome normalizado comparado', value: directMatch?.profileName || 'Não vinculado' },
      { label: 'Conversas agrupadas nesse nome', value: directMatch ? String(directMatch.chatCount || 1) : 'Não aplicável' },
      { label: 'Confiabilidade', value: directMatch?.confidence === 'exact' ? 'Alta' : (directMatch?.confidence === 'probable' ? 'Requer conferência' : 'Não calculada'), tone: directTone },
    ]);

    appendDetailSection('Aplicativo e campanha', [
      { label: 'Está no banco de motoristas', value: bankValue, tone: bankTone },
      { label: 'Situação no aplicativo', value: sourceLead?.appSituation || 'Não identificado' },
      { label: 'Está em campanha', value: campaignValue, tone: campaignTone },
      { label: 'Campanha vinculada', value: driver?.campaignId || 'Nenhuma' },
      { label: 'Status na campanha', value: driver?.campaignData?.currentStatus || 'Não informado' },
      { label: 'Critério da correspondência', value: matchReasonLabel(match?.reason) },
    ]);
  }

  function openLeadDetail(view, item) {
    state.detail = { view: view, item: item };
    renderLeadDetail(view, item);
    refs.leadDetailModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeLeadDetail() {
    refs.leadDetailModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function editLeadFromDetail() {
    var detail = state.detail;
    if (!detail.item) return;
    closeLeadDetail();
    openModal('edit', detail.view, detail.item);
  }

  function createField(field, item, isCreate) {
    var label = document.createElement('label');
    label.className = 'field' + (field.full ? ' field--full' : '');
    var caption = document.createElement('span');
    caption.textContent = field.label;
    label.appendChild(caption);

    var input;
    if (field.options) {
      input = document.createElement('select');
      var emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Não definido';
      input.appendChild(emptyOption);
      optionValues(state.modal.view, field.options).forEach(function (optionValue) {
        var option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        input.appendChild(option);
      });
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }

    input.name = field.key;
    input.value = item?.[field.key] || '';
    if (field.required) input.required = true;
    if (field.readonly) input.readOnly = true;
    if (field.maxLength) input.maxLength = field.maxLength;
    if (field.inputMode) input.inputMode = field.inputMode;
    if (field.autocomplete) input.autocomplete = field.autocomplete;
    if (field.list) input.setAttribute('list', field.list);
    if (isCreate && field.readonly) label.classList.add('hidden');
    label.appendChild(input);
    return label;
  }

  function openModal(mode, view, item) {
    state.modal = { mode: mode, view: view, item: item || null };
    var schema = schemas[view];
    var isCreate = mode === 'create';
    refs.modalEyebrow.textContent = schema.label;
    refs.modalTitle.textContent = isCreate ? 'Novo lead' : 'Editar lead';
    refs.btnSaveLead.textContent = isCreate ? 'Adicionar lead' : 'Salvar alterações';
    refs.formMessage.classList.add('hidden');
    refs.formMessage.textContent = '';
    refs.formFields.replaceChildren();
    schema.fields.forEach(function (field) {
      refs.formFields.appendChild(createField(field, item, isCreate));
    });
    refs.leadModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      refs.formFields.querySelector('input:not([readonly]), textarea:not([readonly])')?.focus();
    }, 0);
  }

  function openEditModal(item) {
    openModal('edit', state.view, item);
  }

  function closeModal() {
    if (refs.btnSaveLead.disabled) return;
    refs.leadModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function formValues() {
    var schema = schemas[state.modal.view];
    var data = new FormData(refs.leadForm);
    var values = {};
    schema.fields.forEach(function (field) {
      if (field.readonly) return;
      values[field.key] = String(data.get(field.key) || '').trim();
    });
    return values;
  }

  function showFormError(message) {
    refs.formMessage.textContent = message;
    refs.formMessage.classList.remove('hidden');
  }

  async function submitForm(event) {
    event.preventDefault();
    if (!refs.leadForm.reportValidity()) return;

    var values = formValues();
    var modal = state.modal;
    var originalLabel = refs.btnSaveLead.textContent;
    refs.btnSaveLead.disabled = true;
    refs.btnSaveLead.textContent = 'Salvando...';
    refs.formMessage.classList.add('hidden');

    try {
      if (modal.mode === 'create') {
        await requestJson('/api/crm/leads', { method: 'POST', body: { values: values } });
      } else {
        var item = modal.item;
        var endpoint = modal.view === 'leads' ? '/api/crm/leads/' : '/api/crm/forwarded/';
        await requestJson(endpoint + encodeURIComponent(item.rowNumber), {
          method: 'PATCH',
          body: {
            keyPhone: digits(item.telefone),
            values: values,
          },
        });
      }

      refs.leadModal.classList.add('hidden');
      document.body.style.overflow = '';
      await loadData();
    } catch (error) {
      console.error('[crm] save error:', error);
      showFormError(error?.message || 'Não foi possível salvar as alterações.');
    } finally {
      refs.btnSaveLead.disabled = false;
      refs.btnSaveLead.textContent = originalLabel;
    }
  }

  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('crm:theme', next);
    localStorage.setItem('motoristas:theme', next);
  }

  function closeExportMenu() {
    refs.exportMenu.classList.add('hidden');
    refs.btnExportDesktop.setAttribute('aria-expanded', 'false');
    refs.btnExportMobile.setAttribute('aria-expanded', 'false');
    state.exportFormat = null;
  }

  function positionExportMenu(trigger) {
    var triggerRect = trigger.getBoundingClientRect();
    var menuRect = refs.exportMenu.getBoundingClientRect();
    var left = Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - 10);
    left = Math.max(10, left);
    var top = triggerRect.bottom + 7;
    if (top + menuRect.height > window.innerHeight - 10) {
      top = Math.max(10, triggerRect.top - menuRect.height - 7);
    }
    refs.exportMenu.style.left = Math.round(left) + 'px';
    refs.exportMenu.style.top = Math.round(top) + 'px';
  }

  function openExportMenu(format, trigger) {
    if (state.exportFormat === format && !refs.exportMenu.classList.contains('hidden')) {
      closeExportMenu();
      return;
    }

    state.exportFormat = format;
    refs.exportMenuTitle.textContent = format === 'desktop' ? 'PNG para desktop' : 'PNG para celular';
    refs.exportMenu.classList.remove('hidden');
    refs.btnExportDesktop.setAttribute('aria-expanded', format === 'desktop' ? 'true' : 'false');
    refs.btnExportMobile.setAttribute('aria-expanded', format === 'mobile' ? 'true' : 'false');
    positionExportMenu(trigger);
    refs.exportMenu.querySelector('.export-menu__option')?.focus();
  }

  function exportTimestamp() {
    return new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function exportFilename(format, detail) {
    var now = new Date();
    var pad = function (value) { return String(value).padStart(2, '0'); };
    var stamp = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-')
      + '-' + pad(now.getHours()) + pad(now.getMinutes());
    return 'od-drive-funil-crm-' + format + '-' + detail + '-' + stamp + '.png';
  }

  function buildExportStage(format, detail) {
    var stage = document.createElement('div');
    stage.className = 'crm-export-stage crm-export-stage--' + format + ' crm-export-stage--' + detail;
    stage.setAttribute('aria-hidden', 'true');

    var card = document.createElement('div');
    card.className = 'crm-export-card';

    var header = document.createElement('header');
    header.className = 'crm-export-header';
    header.innerHTML = '<div class="crm-export-brand"><span>OD Drive CRM</span><strong>Funil de leads</strong></div>'
      + '<div class="crm-export-meta">' + (detail === 'expanded' ? 'Visão completa com ramificações e análises' : 'Visão resumida das etapas principais')
      + '<br>Período: ' + funnelPeriodLabel()
      + '<br>Gerado em ' + exportTimestamp() + '</div>';

    var content = refs.funnelExportArea.cloneNode(true);
    content.removeAttribute('id');
    content.querySelectorAll('[id]').forEach(function (element) { element.removeAttribute('id'); });
    content.querySelectorAll('[aria-controls]').forEach(function (element) { element.removeAttribute('aria-controls'); });

    if (detail === 'expanded') {
      content.querySelectorAll('.funnel-branches').forEach(function (branches) {
        branches.classList.add('is-open');
        branches.setAttribute('aria-hidden', 'false');
      });
      content.querySelectorAll('.funnel-stage--interactive').forEach(function (button) {
        button.setAttribute('aria-expanded', 'true');
        button.tabIndex = -1;
      });
    } else {
      content.querySelectorAll('.funnel-branches, .funnel-details').forEach(function (element) { element.remove(); });
      content.querySelectorAll('.funnel-stage--interactive').forEach(function (button) { button.tabIndex = -1; });
    }

    card.appendChild(header);
    card.appendChild(content);
    stage.appendChild(card);
    document.body.appendChild(stage);
    return stage;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function exportFunnel(format, detail) {
    closeExportMenu();
    if (typeof window.domtoimage?.toBlob !== 'function') {
      showToast('O gerador de PNG não carregou. Atualize a página e tente novamente.', true);
      return;
    }

    var stage = null;
    refs.btnExportDesktop.disabled = true;
    refs.btnExportMobile.disabled = true;
    refs.btnExportDesktop.setAttribute('aria-busy', 'true');
    refs.btnExportMobile.setAttribute('aria-busy', 'true');
    showToast('Gerando PNG em alta resolução...');

    try {
      stage = buildExportStage(format, detail);
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });

      var width = Math.ceil(stage.scrollWidth);
      var height = Math.ceil(stage.scrollHeight);
      var blob = await window.domtoimage.toBlob(stage, {
        bgcolor: '#f4f7fb',
        width: width * 2,
        height: height * 2,
        style: {
          transform: 'scale(2)',
          transformOrigin: 'top left',
          width: width + 'px',
          height: height + 'px',
        },
      });
      downloadBlob(blob, exportFilename(format, detail));
      showToast('PNG gerado com sucesso.');
    } catch (error) {
      console.error('[crm] funnel export error:', error);
      showToast('Não foi possível exportar o funil. Tente novamente.', true);
    } finally {
      stage?.remove();
      refs.btnExportDesktop.disabled = false;
      refs.btnExportMobile.disabled = false;
      refs.btnExportDesktop.removeAttribute('aria-busy');
      refs.btnExportMobile.removeAttribute('aria-busy');
    }
  }

  function setMetricsCollapsed(collapsed) {
    refs.metricsPanel.classList.toggle('is-collapsed', collapsed);
    refs.btnToggleMetrics.classList.toggle('is-active', !collapsed);
    refs.btnToggleMetrics.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    refs.btnToggleMetrics.title = collapsed ? 'Exibir métricas' : 'Recolher métricas';
    localStorage.setItem(METRICS_STORAGE_KEY, collapsed ? '1' : '0');
  }

  function toggleMetrics() {
    setMetricsCollapsed(!refs.metricsPanel.classList.contains('is-collapsed'));
  }

  function setFunnelCollapsed(collapsed) {
    refs.funnelPanel.classList.toggle('is-collapsed', collapsed);
    refs.btnToggleFunnel.classList.toggle('is-active', !collapsed);
    refs.btnToggleFunnel.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    refs.btnToggleFunnel.title = collapsed ? 'Exibir funil' : 'Recolher funil';
    localStorage.setItem(FUNNEL_STORAGE_KEY, collapsed ? '1' : '0');
  }

  function toggleFunnel() {
    setFunnelCollapsed(!refs.funnelPanel.classList.contains('is-collapsed'));
  }

  function toggleStageBranches(button, panel) {
    var expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.title = expanded ? 'Recolher ramificações' : 'Exibir ramificações';
    panel.classList.toggle('is-open', expanded);
    panel.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  }

  function setFiltersCollapsed(collapsed) {
    refs.filtersPanel.classList.toggle('is-collapsed', collapsed);
    refs.btnToggleFilters.classList.toggle('is-active', !collapsed);
    refs.btnToggleFilters.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    refs.btnToggleFilters.title = collapsed ? 'Exibir filtros' : 'Recolher filtros';
    localStorage.setItem(FILTERS_STORAGE_KEY, collapsed ? '1' : '0');
  }

  function toggleFilters() {
    setFiltersCollapsed(!refs.filtersPanel.classList.contains('is-collapsed'));
  }

  document.querySelectorAll('[data-view]').forEach(function (tab) {
    tab.addEventListener('click', function () { setView(tab.dataset.view); });
  });
  document.querySelectorAll('[data-close-modal]').forEach(function (button) {
    button.addEventListener('click', closeModal);
  });
  document.querySelectorAll('[data-close-detail]').forEach(function (button) {
    button.addEventListener('click', closeLeadDetail);
  });

  refs.btnTheme.addEventListener('click', toggleTheme);
  refs.btnToggleMetrics.addEventListener('click', toggleMetrics);
  refs.btnToggleFunnel.addEventListener('click', toggleFunnel);
  refs.btnExportDesktop.addEventListener('click', function () { openExportMenu('desktop', refs.btnExportDesktop); });
  refs.btnExportMobile.addEventListener('click', function () { openExportMenu('mobile', refs.btnExportMobile); });
  refs.exportMenu.querySelectorAll('[data-export-detail]').forEach(function (button) {
    button.addEventListener('click', function () {
      var format = state.exportFormat;
      if (format) exportFunnel(format, button.dataset.exportDetail);
    });
  });
  refs.btnToggleAcquisitionBranches.addEventListener('click', function () {
    toggleStageBranches(refs.btnToggleAcquisitionBranches, refs.acquisitionBranches);
  });
  refs.btnToggleAttendedBranches.addEventListener('click', function () {
    toggleStageBranches(refs.btnToggleAttendedBranches, refs.attendedBranches);
  });
  refs.btnToggleAppBranches.addEventListener('click', function () {
    toggleStageBranches(refs.btnToggleAppBranches, refs.appBranches);
  });
  refs.btnToggleCampaignBranches.addEventListener('click', function () {
    toggleStageBranches(refs.btnToggleCampaignBranches, refs.campaignBranches);
  });
  refs.funnelPeriodPreset.addEventListener('change', function () {
    applyFunnelPreset(refs.funnelPeriodPreset.value);
  });
  refs.btnApplyFunnelPeriod.addEventListener('click', applySelectedFunnelPeriod);
  refs.btnToggleFilters.addEventListener('click', toggleFilters);
  refs.btnRefresh.addEventListener('click', function () { loadData({ refreshAcquisition: true }); });
  refs.btnRetry.addEventListener('click', function () { loadData({ refreshAcquisition: true }); });
  refs.btnCreateLead.addEventListener('click', function () { openModal('create', 'leads', null); });
  refs.btnDetailEdit.addEventListener('click', editLeadFromDetail);
  refs.leadForm.addEventListener('submit', submitForm);
  refs.filterSearch.addEventListener('input', function () { applyFilters(true); });
  refs.filterStatus.addEventListener('change', function () { applyFilters(true); });
  refs.filterAttendant.addEventListener('change', function () { applyFilters(true); });
  refs.filterOrigin.addEventListener('change', function () { applyFilters(true); });
  refs.btnPreviousPage.addEventListener('click', function () {
    if (state.page > 1) {
      state.page -= 1;
      renderTable();
    }
  });
  refs.btnNextPage.addEventListener('click', function () {
    var totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    if (state.page < totalPages) {
      state.page += 1;
      renderTable();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!refs.exportMenu.classList.contains('hidden')) {
      closeExportMenu();
      return;
    }
    if (!refs.leadModal.classList.contains('hidden')) closeModal();
    else if (!refs.leadDetailModal.classList.contains('hidden')) closeLeadDetail();
  });

  document.addEventListener('click', function (event) {
    if (refs.exportMenu.classList.contains('hidden')) return;
    if (refs.exportMenu.contains(event.target) || refs.btnExportDesktop.contains(event.target) || refs.btnExportMobile.contains(event.target)) return;
    closeExportMenu();
  });
  window.addEventListener('resize', closeExportMenu);
  window.addEventListener('scroll', closeExportMenu, true);

  window.addEventListener('message', function (event) {
    if (event.data?.type === 'SMART_REFRESH') loadData();
  });

  setMetricsCollapsed(localStorage.getItem(METRICS_STORAGE_KEY) !== '0');
  setFunnelCollapsed(localStorage.getItem(FUNNEL_STORAGE_KEY) !== '0');
  setFiltersCollapsed(localStorage.getItem(FILTERS_STORAGE_KEY) !== '0');
  applyFunnelPreset(refs.funnelPeriodPreset.value);
  state.funnelPeriod.from = refs.funnelDateFrom.value;
  state.funnelPeriod.to = refs.funnelDateTo.value;
  loadData();
})();
