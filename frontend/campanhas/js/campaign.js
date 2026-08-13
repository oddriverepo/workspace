// Token já foi capturado no index.html inline script
let adminToken = localStorage.getItem('adminToken');
console.log('[AUTH] Token carregado em campaign.js:', adminToken ? 'PRESENTE' : 'AUSENTE');

function authFetch(url, options, _retries) {
  if (!options) options = {};
  if (_retries === undefined) _retries = 3;
  const headers = options.headers || {};
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  const fullUrl = url.startsWith('http') ? url : `${window.API_BASE || ''}${url}`;
  return fetch(fullUrl, { ...options, headers }).catch(function (err) {
    var isNetworkError = err.message === 'Failed to fetch' || err.message === 'NetworkError when attempting to fetch resource.';
    if (isNetworkError && _retries > 0) {
      return new Promise(function (r) { setTimeout(r, 2000 * (4 - _retries)); })
        .then(function () { return authFetch(url, options, _retries - 1); });
    }
    throw err;
  });
}

let _acompanheMode = 'driver';
function getAcompanheMode() {
  return _acompanheMode;
}

function logout() {
  console.log('[AUTH] Logout chamado de campaign');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  const workspaceUrl = window.WORKSPACE_CONFIG?.WORKSPACE_URL || window.location.origin.replace('backend', 'workspace');
  window.location.href = `${workspaceUrl}/login.html`;
}

// Dialog/feedback helpers (admin-wide)
const confirmDialog = (message, options = {}) => {
  if (typeof window.adminConfirm === 'function') return window.adminConfirm(message, options);
  if (window.modal?.confirm) return window.modal.confirm(options.title || 'Confirmar', message);
  console.warn('[Dialog] confirm indisponivel:', message);
  return Promise.resolve(false);
};
const alertDialog = (message, options = {}) => {
  if (typeof window.adminAlert === 'function') return window.adminAlert(message, options);
  if (window.modal?.alert) return window.modal.alert(options.title || 'Aviso', String(message));
  console.warn('[Dialog] alert indisponivel:', message);
  return Promise.resolve();
};
const toast = (msg, type = 'info', opts = {}) => {
  if (typeof window.adminToast === 'function') return window.adminToast(msg, type, opts);
  console.warn(`[Toast:${type}] ${String(msg)}`);
};
window.alert = msg => alertDialog(String(msg));

const urlParams = new URLSearchParams(window.location.search);
// Sanitiza o ID: remove sufixos inválidos como ":20" que podem aparecer
// quando o usuário copia um link a partir do console do DevTools.
const campaignId = (urlParams.get('id') || '').replace(/:[0-9]+$/, '') || null;

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const btnDelete = document.getElementById('btnDelete');
const btnAddDriver = document.getElementById('btnAddDriver');
const btnSaveDrivers = document.getElementById('btnSaveDrivers');
const btnImportDrivers = document.getElementById('btnImportDrivers');
const btnExportDrivers = document.getElementById('btnExportDrivers');
const btnReport = document.getElementById('btnReport');
const importDriversFile = document.getElementById('importDriversFile');
const btnImportKm = document.getElementById("btnImportKm");
const btnSaveKm = document.getElementById('btnSaveKm');
const btnCreateKm = document.getElementById('btnCreateKm');
const importKmModal = document.getElementById('importKmModal');
const importKmForm = document.getElementById('importKmForm');
const importKmSheetId = document.getElementById('importKmSheetId');
const importKmSheetName = document.getElementById('importKmSheetName');
const importKmSubmit = document.getElementById('importKmSubmit');
const importKmMessage = document.getElementById('importKmMessage');
const tblDrivers = document.getElementById('tblDrivers');
const driversTable = document.getElementById('driversTable');
const btnDriversCols = document.getElementById('btnDriversCols');
const driversColsPanel = document.getElementById('driversColsPanel');
const chkHideBlocked = document.getElementById('chkHideBlocked');
const driverBlockModal = document.getElementById('driverBlockModal');
const driverBlockModalTitle = document.getElementById('driverBlockModalTitle');
const driverBlockReasonGroup = document.getElementById('driverBlockReasonGroup');
const driverBlockReasonInput = document.getElementById('driverBlockReasonInput');
const btnDriverBlockSave = document.getElementById('btnDriverBlockSave');
const driverBlockModalError = document.getElementById('driverBlockModalError');
const btnAddGraphic = document.getElementById('btnAddGraphic');
const tblGraphics = document.getElementById('tblGraphics');
const driverDetailModal = document.getElementById('driverDetailModal');
const driverModalTitle = document.getElementById('driverModalTitle');
const driverDetailForm = document.getElementById('driverDetailForm');
const driverDetailFields = document.getElementById('driverDetailFields');
const driverDetailSubmit = document.getElementById('driverDetailSubmit');
const driverDetailHint = document.getElementById('driverDetailHint');
const driverFormModal = document.getElementById('driverFormModal');
const driverForm = document.getElementById('driverForm');
const driverFormFields = document.getElementById('driverFormFields');
const driverFormSubmit = document.getElementById('driverFormSubmit');
const driverFormHint = document.getElementById('driverFormHint');
const partialReportModal = document.getElementById('partialReportModal');
const btnPartialReportDesktop = document.getElementById('btnPartialReportDesktop');
const btnPartialReportMobile = document.getElementById('btnPartialReportMobile');
const graphicFormModal = document.getElementById('graphicFormModal');
const graphicForm = document.getElementById('graphicForm');
const graphicFormMessage = document.getElementById('graphicFormMessage');
const graphicFormSubmit = document.getElementById('graphicFormSubmit');
const graphicModalTitle = document.getElementById('graphicModalTitle');
const graphicFormHint = document.getElementById('graphicFormHint');
const graphicIdField = document.getElementById('graphicIdField');
const graphicCountBadge = document.getElementById('graphicCountBadge');
const graphicFieldName = document.getElementById('graphicFieldName');
const graphicFieldEmail = document.getElementById('graphicFieldEmail');
const graphicFieldPhone = document.getElementById('graphicFieldPhone');
const graphicFieldResp1Name = document.getElementById('graphicFieldResp1Name');
const graphicFieldResp1Phone = document.getElementById('graphicFieldResp1Phone');
const graphicFieldResp2Name = document.getElementById('graphicFieldResp2Name');
const graphicFieldResp2Phone = document.getElementById('graphicFieldResp2Phone');
const graphicFieldNotes = document.getElementById('graphicFieldNotes');
// Acompanhe (admin) elements
const acompanheDrivers = document.getElementById('acompanheDrivers');
const acompanheGalleryGrid = document.getElementById('acompanheGalleryGrid');
const acompanheStatusPanel = document.getElementById('acompanheStatusPanel');
const acompanheStatusHint = document.getElementById('acompanheStatusHint');
const driverStatusChip = document.getElementById('driverStatusChip');
const driverStatusNote = document.getElementById('driverStatusNote');
const graphicStatusChip = document.getElementById('graphicStatusChip');
const graphicStatusNote = document.getElementById('graphicStatusNote');
const btnVerifyDriver = document.getElementById('btnVerifyDriver');
const btnVerifyGraphic = document.getElementById('btnVerifyGraphic');
const cooldownDriverInput = document.getElementById('cooldownDriver');
const cooldownGraphicInput = document.getElementById('cooldownGraphic');
const btnSaveCooldown = document.getElementById('btnSaveCooldown');
const cooldownMessage = document.getElementById('cooldownMessage');
const evidenceWindowInput = document.getElementById('evidenceWindowDays');
const evidenceWindowMessage = document.getElementById('evidenceWindowMessage');
const btnSaveEvidenceWindow = document.getElementById('btnSaveEvidenceWindow');
const btnSetDriverTarget = document.getElementById('btnSetDriverTarget');
const driverTargetLabel = document.getElementById('driverTargetLabel');
const campaignStatusSelect = document.getElementById('campaignStatus');
const campaignCodeValue = document.getElementById('campaignCodeValue');
const copyCampaignCodeMessage = document.getElementById('copyCampaignCodeMessage');
const btnCopyCampaignCode = document.getElementById('btnCopyCampaignCode');
const graphicAccessHint = document.getElementById('graphicAccessHint');
const summaryPriorityAttention = document.getElementById('summaryPriorityAttention');
const summaryPriorityAttentionCard = document.getElementById('summaryPriorityAttentionCard');
const summaryAttentionPopover = document.getElementById('summaryAttentionPopover');
const summaryAttentionPopoverBody = document.getElementById('summaryAttentionPopoverBody');
const summaryKmSource = document.getElementById('summaryKmSource');
const summaryKmProgressLabel = document.getElementById('summaryKmProgressLabel');
const summaryKmGapLabel = document.getElementById('summaryKmGapLabel');
const summaryKmProgressFill = document.getElementById('summaryKmProgressFill');
const summaryKmRuleLabel = document.getElementById('summaryKmRuleLabel');
const summaryKanbanToday = document.getElementById('summaryKanbanToday');
const summaryKanbanWeek = document.getElementById('summaryKanbanWeek');
const summaryKanbanWatch = document.getElementById('summaryKanbanWatch');
const kanbanTodayCount = document.getElementById('kanbanTodayCount');
const kanbanWeekCount = document.getElementById('kanbanWeekCount');
const kanbanWatchCount = document.getElementById('kanbanWatchCount');
const unifiedActionsCount = document.getElementById('unifiedActionsCount');
const nextStepsCount = document.getElementById('nextStepsCount');
const smartAlertsCount = document.getElementById('smartAlertsCount');
const summaryStageStatus = document.getElementById('summaryStageStatus'); // kept for compat (may be null now)
const schedListOk = document.getElementById('schedListOk');
const schedListPending = document.getElementById('schedListPending');
const schedCountOk = document.getElementById('schedCountOk');
const schedCountPending = document.getElementById('schedCountPending');
const schedulingStatusBadge = document.getElementById('schedulingStatusBadge');
const schedDispatchBar = document.getElementById('schedDispatchBar');
const btnDispatchSchedule = document.getElementById('btnDispatchSchedule');
const schedDispatchCount = document.getElementById('schedDispatchCount');
const summarySmartAlerts = document.getElementById('summarySmartAlerts');
const summaryWorstDrivers = document.getElementById('summaryWorstDrivers');
const summaryBestDrivers = document.getElementById('summaryBestDrivers');
const summaryRiskDrivers = document.getElementById('summaryRiskDrivers');
const summaryInactivityCard = document.getElementById('summaryInactivityCard');
const summaryInactivityCount = document.getElementById('summaryInactivityCount');
const summaryInactivityRows = document.getElementById('summaryInactivityRows');
const btnInactivityDispatch = document.getElementById('btnInactivityDispatch');
const btnInactivityRefresh = document.getElementById('btnInactivityRefresh');
const summaryHeatmapCard = document.getElementById('summaryHeatmapCard');
const summaryHeatmapTotal = document.getElementById('summaryHeatmapTotal');
const summaryHeatmapHint = document.getElementById('summaryHeatmapHint');
const summaryHeatmapWrap = document.getElementById('summaryHeatmapWrap');
const summaryHeatmapGrid = document.getElementById('summaryHeatmapGrid');
const summaryHeatmapPeak = document.getElementById('summaryHeatmapPeak');
const summaryHeatmapEmpty = document.getElementById('summaryHeatmapEmpty');
const historyTotalPill = document.getElementById('historyTotalPill');
const historyTimeline = document.getElementById('historyTimeline');
const historyEmpty = document.getElementById('historyEmpty');
const historyError = document.getElementById('historyError');
const btnHistoryRefresh = document.getElementById('btnHistoryRefresh');
const btnHistoryLoadMore = document.getElementById('btnHistoryLoadMore');
const historyLoading = document.getElementById('historyLoading');
const summaryKmForm = document.getElementById('summaryKmForm');
const summaryKmDriver = document.getElementById('summaryKmDriver');
const summaryKmInitial = document.getElementById('summaryKmInitial');
const summaryKmCurrent = document.getElementById('summaryKmCurrent');
const summaryKmDelta = document.getElementById('summaryKmDelta');
const summaryKmMessage = document.getElementById('summaryKmMessage');
const summaryKmEditorCard = document.getElementById('summaryKmEditorCard');
const summaryDrilldownModal = document.getElementById('summaryDrilldownModal');
const summaryDrilldownTitle = document.getElementById('summaryDrilldownTitle');
const summaryDrilldownHint = document.getElementById('summaryDrilldownHint');
const summaryDrilldownList = document.getElementById('summaryDrilldownList');
const driverFormKmInitial = document.getElementById('driverFormKmInitial');
const driverFormKmCurrent = document.getElementById('driverFormKmCurrent');

// ── Dispatch elements ──
const dispatchBar = document.getElementById('dispatchBar');
const btnDispatchAll = document.getElementById('btnDispatchAll');
const dispatchCount = document.getElementById('dispatchCount');
const dispatchModal = document.getElementById('dispatchModal');
const dispatchTemplateSelect = document.getElementById('dispatchTemplateSelect');
const dispatchTemplatePreview = document.getElementById('dispatchTemplatePreview');
const dispatchFreeText = document.getElementById('dispatchFreeText');
const dispatchDriverList = document.getElementById('dispatchDriverList');
const dispatchSelectAll = document.getElementById('dispatchSelectAll');
const dispatchSelectedCount = document.getElementById('dispatchSelectedCount');
const btnDispatchSend = document.getElementById('btnDispatchSend');
const dispatchResult = document.getElementById('dispatchResult');
const dispatchTemplateSection = document.getElementById('dispatchTemplateSection');
const dispatchTextSection = document.getElementById('dispatchTextSection');
const btnSendDriver = document.getElementById('btnSendDriver');

const el = selector => document.querySelector(selector);

// Regras locais para status de evidência (mesmas etapas obrigatórias do backend)
const DRIVER_REQUIRED_STEPS_UI = ['odometer-photo','odometer-value','photo-left','photo-right','photo-rear','photo-front'];
const GRAPHIC_REQUIRED_STEPS_UI = ['photo-left','photo-right','photo-rear','photo-front'];

// Controle de blob URLs usados na galeria (para manter o clique abrindo em nova aba)
const galleryObjectUrls = new Set();
function registerGalleryObjectUrl(url) { if (url) galleryObjectUrls.add(url); }
function revokeGalleryObjectUrl(url) {
  if (!url) return;
  try { URL.revokeObjectURL(url); } catch (e) {}
  galleryObjectUrls.delete(url);
}
function cleanupGalleryObjectUrls() {
  for (const url of Array.from(galleryObjectUrls)) {
    revokeGalleryObjectUrl(url);
  }
}

function computeFlowFromItems(items = [], required = []) {
  const stepSet = new Set();
  let lastUploadAt = null;
  let lastRequiredAt = null;
  for (const it of Array.isArray(items) ? items : []) {
    const stepId = typeof it?.step === 'string' ? it.step.trim() : '';
    if (stepId) {
      stepSet.add(stepId);
      if (required.includes(stepId)) {
        const ts = Number(it.createdAt || it.uploadedAt);
        if (Number.isFinite(ts) && (!lastRequiredAt || ts > lastRequiredAt)) lastRequiredAt = ts;
      }
    }
    const ts = Number(it?.createdAt || it?.uploadedAt);
    if (Number.isFinite(ts)) lastUploadAt = lastUploadAt ? Math.max(lastUploadAt, ts) : ts;
  }
  const completed = required.every(stepId => stepSet.has(stepId));
  return {
    hasUploads: Array.isArray(items) && items.length > 0,
    totalUploads: Array.isArray(items) ? items.length : 0,
    lastUploadAt: lastUploadAt || null,
    completed: Array.isArray(items) && items.length > 0,
    completedAt: Array.isArray(items) && items.length > 0 ? (lastRequiredAt || lastUploadAt || null) : null,
    pendingSteps: Array.isArray(items) && items.length > 0 ? [] : required,
  };
}

function flattenStorageFiles(tree = {}) {
  const folders = Array.isArray(tree.folders) ? tree.folders : [];
  return folders.flatMap(f => Array.isArray(f.files) ? f.files : []);
}

function updateDriverEvidenceFromItems(driver, items = [], type = 'driver') {
  if (!driver) return;
  const required = type === 'graphic' ? GRAPHIC_REQUIRED_STEPS_UI : DRIVER_REQUIRED_STEPS_UI;
  const computed = computeFlowFromItems(items, required);
  const status = driver.evidenceStatus || {};
  const targetKey = type === 'graphic' ? 'graphicFlow' : 'driverFlow';
  const baseFlow = status[targetKey] || {};
  const mergedFlow = {
    ...computed,
    verifiedAt: computed.completed ? (baseFlow.verifiedAt || null) : null,
    verifiedBy: computed.completed ? (baseFlow.verifiedBy || null) : null,
    verifiedByName: computed.completed ? (baseFlow.verifiedByName || null) : null,
  };
  driver.evidenceStatus = {
    ...status,
    [targetKey]: mergedFlow,
  };
  selectedDriverData = driver;
  updateDriverListItemStatus(driver);
  setSelectedDriver(driver);
}
 
// globals that were accidentally removed
let currentCampaign = null;
let openModalCount = 0;
const STATUS_OPTIONS = ['agendado','confirmado','instalado','aguardando','cadastrando','problema','revisar'];
const ADHESION_STATUS_OPTIONS = ['agendado', 'concluido', 'faltou', 'reagendado'];
const CAMPAIGN_STATUS_OPTIONS = ['ativa','pausada','encerrada','inativa'];
// Local KM cache still exists as fallback, but primary persistence is backend + Mongo.
const KM_LOCAL_STORAGE_VERSION = 'v3'; // v3: odometer != km percorrido; stale data cleared
const KM_GOAL_PER_DRIVER_MONTH = 3000;
const KM_GOAL_DEFAULT_MONTHS = 1;
const KM_DEFAULT_MIN_PER_DRIVER = KM_GOAL_PER_DRIVER_MONTH;

// ── Cache localStorage removido (dados grandes demais para localStorage) ──
function saveCampaignToStorage(_id, _data) { /* noop */ }
function loadCampaignFromStorage(_id) { return null; }
const KM_CRITICAL_THRESHOLD = 70;
const KM_STALE_DAYS = 7;
// Quanto o ritmo necessário precisa exceder o ritmo atual para o motorista ser flagado "em risco"
// Multiplicador 1.2 = ritmo necessário 20% acima do ritmo atual.
const KM_PACE_RISK_MULTIPLIER = 1.2;
const pendingDriverChanges = new Map();
const IMPORTED_DRIVER_TEMP_PREFIX = '__import__';
let pendingImportedDrivers = [];
// Bloqueio de motoristas
let driverBlockedMap = new Map(); // driverId → { contactBlocked, contactBlockReason }
let hideBlockedDrivers = false;
let _blockModalState = { driverId: '', blocking: true };
let selectedDriverId = null;
let selectedDriverData = null;
let summaryKmLocalState = null;
let summaryAnalytics = null;

const DEFAULT_DRIVER_COLUMNS = [
  'Nome',
  'Cidade',
  'Status',
  'PIX',
  'CPF',
  'Email',
  'Número',
  'Placa',
  'Modelo',
  'Convite',
  'Adesivagem Inicial',
  'Retirada Adesivo',
  'Status Adesivagem',
  'Observações',
  'Comentários',
];

const DRIVER_FORM_HIDDEN_COLUMNS = new Set([
  'plotagem',
  'horario plotagem',
  'data de instalacao',
  'data final 90 dias',
  'status adesivagem',
]);

const DRIVER_DETAIL_HIDDEN_COLUMNS = new Set([
  'plotagem',
  'horario plotagem',
  'data de instalacao',
  'data final 90 dias',
  'status adesivagem',
]);

const DRIVER_IMPORT_ALIASES = {
  Nome: ['nome', 'motorista'],
  Cidade: ['cidade'],
  Status: ['status'],
  PIX: ['pix'],
  CPF: ['cpf'],
  Email: ['email', 'e-mail'],
  Numero: ['numero', 'número', 'telefone', 'celular', 'whatsapp'],
  Placa: ['placa'],
  Modelo: ['modelo'],
  Convite: ['convite'],
  Observacoes: ['observacoes', 'observações', 'comentarios', 'comentários'],
};
const STEP_LABELS = {
  'odometer-photo': 'Foto do odômetro',
  'odometer-value': 'Valor do odômetro',
  'photo-left': 'Foto lateral esquerda',
  'photo-right': 'Foto lateral direita',
  'photo-rear': 'Foto traseira',
  'photo-front': 'Foto frontal',
  receipt: 'Comprovante',
  other: 'Outra evidência',
  notes: 'Observações',
};

const FLOW_CLASSNAMES = ['is-pending', 'is-completed', 'is-verified', 'is-progress'];

function getStepLabel(stepId) {
  return STEP_LABELS[stepId] || stepId || '-';
}

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

const DRIVER_DOCUMENT_FIELDS = [
  { key: 'driverDocument', label: 'Documento do motorista' },
  { key: 'driverLicense', label: 'CNH' },
  { key: 'proofOfAddress', label: 'Comprovante de endereço' },
  { key: 'vehicleRegistration', label: 'Documento do veículo' },
  { key: 'appRating', label: 'Avaliação do app' },
];

const DRIVER_DOCUMENT_STATUS_LABELS = {
  approved: 'Aprovado',
  pending: 'Pendente',
  rejected: 'Reprovado',
  refused: 'Reprovado',
  review: 'Em análise',
  reviewing: 'Em análise',
  awaiting: 'Aguardando',
  uploaded: 'Enviado',
};

function normalizeDriverDocumentStatus(value) {
  const normalized = normalizeKey(value || '');
  if (!normalized) return '';
  if (normalized.includes('approv') || normalized.includes('aprov')) return 'approved';
  if (normalized.includes('reject') || normalized.includes('reprov') || normalized.includes('recus')) return 'rejected';
  if (normalized.includes('pend') || normalized.includes('aguard')) return 'pending';
  if (normalized.includes('anal') || normalized.includes('review')) return 'review';
  if (normalized.includes('upload') || normalized.includes('envi')) return 'uploaded';
  return normalized.replace(/\s+/g, '-');
}

function getDriverDocumentsData(driver) {
  const docs = driver?.documentsData || driver?.documents || driver?.raw?.documentsData || null;
  if (!docs || typeof docs !== 'object') return {};
  return docs.items && typeof docs.items === 'object' ? docs.items : docs;
}

function getDriverDocumentSummary(driver) {
  const docs = getDriverDocumentsData(driver);
  let sent = 0;
  let approved = 0;

  for (const field of DRIVER_DOCUMENT_FIELDS) {
    const item = docs[field.key];
    if (!item || typeof item !== 'object') continue;
    if (item.link || item.status || item.createdAt || item.created_at) sent += 1;
    if (normalizeDriverDocumentStatus(item.status) === 'approved') approved += 1;
  }

  return {
    total: DRIVER_DOCUMENT_FIELDS.length,
    sent,
    approved,
    complete: sent === DRIVER_DOCUMENT_FIELDS.length,
  };
}

function renderDriverDocumentsSection(driver) {
  const docs = getDriverDocumentsData(driver);
  const summary = getDriverDocumentSummary(driver);
  const section = document.createElement('div');
  section.className = 'dd-section dd-documents-section';

  const titleRow = document.createElement('div');
  titleRow.className = 'dd-section-title dd-section-title--with-meta';

  const title = document.createElement('span');
  title.textContent = 'Documentos do motorista';
  titleRow.appendChild(title);

  const summaryBadge = document.createElement('span');
  summaryBadge.className = `dd-docs-summary ${summary.complete ? 'is-complete' : summary.sent ? 'is-partial' : 'is-empty'}`;
  summaryBadge.textContent = `${summary.sent}/${summary.total} enviados`;
  titleRow.appendChild(summaryBadge);

  section.appendChild(titleRow);

  const grid = document.createElement('div');
  grid.className = 'dd-documents-grid';

  for (const field of DRIVER_DOCUMENT_FIELDS) {
    const item = docs[field.key] && typeof docs[field.key] === 'object' ? docs[field.key] : null;
    const link = item?.link || '';
    const statusKey = normalizeDriverDocumentStatus(item?.status);
    const statusLabel = item
      ? (DRIVER_DOCUMENT_STATUS_LABELS[statusKey] || item.status || 'Enviado')
      : 'Não enviado';
    const dateValue = item?.createdAt || item?.created_at || item?.updatedAt || '';
    const dateLabel = formatDateTime(dateValue);

    const card = document.createElement('article');
    card.className = `dd-document-card ${item ? 'has-document' : 'dd-document-card--missing'} ${statusKey ? `status-${statusKey}` : ''}`;

    const head = document.createElement('div');
    head.className = 'dd-document-head';

    const name = document.createElement('div');
    name.className = 'dd-document-name';
    name.textContent = field.label;
    head.appendChild(name);

    const badge = document.createElement('span');
    badge.className = `dd-document-status ${item ? `status-${statusKey || 'uploaded'}` : 'status-missing'}`;
    badge.textContent = statusLabel;
    head.appendChild(badge);

    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'dd-document-meta';
    meta.textContent = dateLabel ? `Enviado em ${dateLabel}` : (item ? 'Sem data de envio' : 'Documento ainda não encontrado');
    card.appendChild(meta);

    if (link) {
      const action = document.createElement('a');
      action.className = 'dd-document-link';
      action.href = link;
      action.target = '_blank';
      action.rel = 'noopener noreferrer';
      action.textContent = 'Abrir imagem';
      card.appendChild(action);
    }

    grid.appendChild(card);
  }

  section.appendChild(grid);
  return section;
}

function describeFlowState(flowStatus) {
  if (!flowStatus || (!flowStatus.hasUploads && !flowStatus.verifiedAt)) {
    return { className: 'is-pending', text: 'Sem envio' };
  }
  if (flowStatus.verifiedAt) return { className: 'is-verified', text: 'Verificado' };
  if (flowStatus.hasUploads) return { className: 'is-completed', text: 'Envio ok' };
  return { className: 'is-pending', text: 'Sem envio' };
}

function updateStatusChip(el, flowStatus, label) {
  if (!el) return;
  const state = describeFlowState(flowStatus);
  FLOW_CLASSNAMES.forEach(cls => el.classList.remove(cls));
  el.classList.add(state.className);
  el.textContent = `${label}: ${state.text}`;
}

function applyStatusVisibility(mode = 'driver') {
  const driverCard = document.querySelector('.status-card[data-role="driver"]');
  const graphicCard = document.querySelector('.status-card[data-role="graphic"]');
  if (mode === 'graphic') {
    if (driverCard) driverCard.style.display = 'none';
    if (graphicCard) graphicCard.style.display = 'flex';
    if (btnVerifyDriver) btnVerifyDriver.style.display = 'none';
    if (btnVerifyGraphic) btnVerifyGraphic.style.display = '';
  } else {
    if (driverCard) driverCard.style.display = 'flex';
    if (graphicCard) graphicCard.style.display = 'none';
    if (btnVerifyDriver) btnVerifyDriver.style.display = '';
    if (btnVerifyGraphic) btnVerifyGraphic.style.display = 'none';
  }
}

function formatPendingSteps(pending = []) {
  if (!Array.isArray(pending) || pending.length === 0) return '';
  return pending.map(step => getStepLabel(step)).join(', ');
}

function buildStatusNote(flowStatus) {
  if (!flowStatus || (!flowStatus.hasUploads && !flowStatus.verifiedAt)) return 'Nenhum envio registrado.';
  if (flowStatus.verifiedAt) {
    const when = formatDateTime(flowStatus.verifiedAt);
    const reviewer = flowStatus.verifiedByName || flowStatus.verifiedBy || 'admin';
    const cooldown = flowStatus.cooldownUntil && Number(flowStatus.cooldownUntil) > Date.now()
      ? ` Libera em ${formatDateTime(flowStatus.cooldownUntil)}.`
      : '';
    return when ? `Verificado em ${when} por ${reviewer}.${cooldown}` : `Verificado por ${reviewer}.${cooldown}`;
  }
  if (flowStatus.hasUploads) {
    const when = formatDateTime(flowStatus.lastUploadAt);
    return when ? `Envio registrado em ${when}.` : 'Envio registrado.';
  }
  return 'Nenhum envio registrado.';
}

function resetStatusPanel(message = 'Selecione um motorista para revisar os envios.') {
  selectedDriverId = null;
  selectedDriverData = null;
  if (acompanheStatusHint) acompanheStatusHint.textContent = message;
  updateStatusChip(driverStatusChip, null, 'Motorista');
  if (driverStatusNote) driverStatusNote.textContent = '';
  updateStatusChip(graphicStatusChip, null, 'Gráfica');
  if (graphicStatusNote) graphicStatusNote.textContent = '';
  if (btnVerifyDriver) {
    btnVerifyDriver.disabled = true;
    btnVerifyDriver.textContent = 'Marcar como verificado';
  }
  if (btnVerifyGraphic) {
    btnVerifyGraphic.disabled = true;
    btnVerifyGraphic.textContent = 'Marcar como verificado';
  }
  applyStatusVisibility(getAcompanheMode());
}

function setSelectedDriver(driver) {
  if (!driver) {
    resetStatusPanel();
    return;
  }
  const mode = getAcompanheMode();
  selectedDriverId = driver.id || null;
  selectedDriverData = driver;
  if (acompanheStatusHint) {
    acompanheStatusHint.textContent = driver.name
      ? `Revisando ${driver.name}`
      : 'Revisando motorista selecionado.';
  }
  const statuses = driver.evidenceStatus || {};
  const driverFlow = statuses.driverFlow || null;
  const graphicFlow = statuses.graphicFlow || null;
  updateStatusChip(driverStatusChip, driverFlow, 'Motorista');
  if (driverStatusNote) driverStatusNote.textContent = buildStatusNote(driverFlow);
  updateStatusChip(graphicStatusChip, graphicFlow, 'Gráfica');
  if (graphicStatusNote) graphicStatusNote.textContent = buildStatusNote(graphicFlow);

  if (btnVerifyDriver) {
    const completed = Boolean(driverFlow?.completed);
    const verified = Boolean(driverFlow?.verifiedAt);
    btnVerifyDriver.disabled = mode !== 'driver' || !completed;
    btnVerifyDriver.textContent = verified ? 'Liberar agora' : 'Marcar como verificado';
  }
  if (btnVerifyGraphic) {
    const completed = Boolean(graphicFlow?.completed);
    const verified = Boolean(graphicFlow?.verifiedAt);
    btnVerifyGraphic.disabled = mode !== 'graphic' || !completed;
    btnVerifyGraphic.textContent = verified ? 'Liberar agora' : 'Marcar como verificado';
  }
  applyStatusVisibility(mode);
}

function updateDriverStatusChips(container, driver, mode = 'driver') {
  if (!container) return;
  const statuses = driver?.evidenceStatus || {};
  const driverFlowState = describeFlowState(statuses.driverFlow);
  const graphicFlowState = describeFlowState(statuses.graphicFlow);
  container.innerHTML = '';
  if (mode === 'driver') {
    const driverChip = document.createElement('span');
    driverChip.className = `chip ${driverFlowState.className}`;
    driverChip.textContent = `Motorista: ${driverFlowState.text}`;
    container.appendChild(driverChip);
  } else {
    const graphicChip = document.createElement('span');
    graphicChip.className = `chip ${graphicFlowState.className}`;
    graphicChip.textContent = `Gráfica: ${graphicFlowState.text}`;
    container.appendChild(graphicChip);
  }
}

function updateDriverListItemStatus(driver) {
  if (!driver?.id || !acompanheDrivers) return;
  const li = acompanheDrivers.querySelector(`[data-driver-id="${driver.id}"]`);
  if (!li) return;
  const chips = li.querySelector('.driver-status-chips');
  if (chips) updateDriverStatusChips(chips, driver, getAcompanheMode());
}

function syncDriverInState(updatedDriver) {
  if (!updatedDriver || !currentCampaign?.drivers) return null;
  const idx = currentCampaign.drivers.findIndex(d => d.id === updatedDriver.id);
  if (idx === -1) return null;
  const target = currentCampaign.drivers[idx];
  Object.assign(target, updatedDriver);
  return target;
}

async function handleVerificationAction(target) {
  if (!campaignId) {
    alert('Campanha não carregada.');
    return;
  }
  if (!selectedDriverId) {
    alert('Selecione um motorista na lista ao lado.');
    return;
  }
  const driver =
    selectedDriverData ||
    (Array.isArray(currentCampaign?.drivers)
      ? currentCampaign.drivers.find(d => d.id === selectedDriverId)
      : null);
  if (!driver) {
    alert('Motorista não encontrado na campanha.');
    return;
  }
  const flowStatus = target === 'graphic'
    ? driver.evidenceStatus?.graphicFlow
    : driver.evidenceStatus?.driverFlow;
  if (!flowStatus) {
    alert('Status de envio indisponível para este perfil.');
    return;
  }
  const desired = !flowStatus.verifiedAt;
  if (desired && !flowStatus.completed) {
    alert('O envio ainda não foi concluído para este perfil.');
    return;
  }
  const btn = target === 'graphic' ? btnVerifyGraphic : btnVerifyDriver;
  if (btn) {
    btn.disabled = true;
    btn.textContent = desired ? 'Verificando...' : 'Removendo...';
  }
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/drivers/${encodeURIComponent(selectedDriverId)}/evidence-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, verified: desired }),
    });
    if (!res.ok) {
      let message = '';
      try { message = await res.text(); } catch (e) {}
      throw new Error(message || `HTTP ${res.status}`);
    }
    const payload = await res.json();
    const updatedDriver = payload?.driver;
    if (updatedDriver) {
      let activeDriver = syncDriverInState(updatedDriver);
      if (!activeDriver) {
        if (!Array.isArray(currentCampaign?.drivers)) currentCampaign.drivers = [];
        const idx = currentCampaign.drivers.findIndex(d => d.id === updatedDriver.id);
        if (idx === -1) {
          currentCampaign.drivers.push(updatedDriver);
          activeDriver = currentCampaign.drivers[currentCampaign.drivers.length - 1];
        } else {
          currentCampaign.drivers[idx] = updatedDriver;
          activeDriver = currentCampaign.drivers[idx];
        }
      }
      selectedDriverData = activeDriver;
      updateDriverListItemStatus(activeDriver);
    }
  } catch (err) {
    console.error(err);
    alert(err.message || 'Falha ao atualizar verificação.');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (selectedDriverData) setSelectedDriver(selectedDriverData);
      else resetStatusPanel();
    }
  }
}
let editingGraphicId = null;
// Development/testing preset: fills the Add Driver form automatically.
// Temporary - remove when no longer needed.
const DEV_DRIVER_PRESET = {
  enabled: false,
  fullName: 'Thiago dos Santos Rodrigues',
  phone: '(51) 9 9133-5320',
  // When true, the phone will be placed into the Nome field to allow quick "login" tests
  injectPhoneIntoName: true,
};
// pending KM edits buffered in the KM tab: Map<driverId, { columnKey: value }>
const pendingKmChanges = new Map();
let currentStorageTree = null;

function updateSaveKmButtonState() {
  if (!btnSaveKm) return;
  btnSaveKm.disabled = pendingKmChanges.size === 0;
}

function setCopyCampaignMessage(text = '', tone = 'muted') {
  if (!copyCampaignCodeMessage) return;
  copyCampaignCodeMessage.textContent = text;
  copyCampaignCodeMessage.classList.remove('text-success');
  copyCampaignCodeMessage.classList.add('muted');
  if (tone === 'success') {
    copyCampaignCodeMessage.classList.remove('muted');
    copyCampaignCodeMessage.classList.add('text-success');
  }
}

function bufferKmChange(driverId, column, value, originalValue = '') {
  if (!driverId || !column) return;
  const current = pendingKmChanges.get(driverId) || {};
  const trimmed = value;
  if (trimmed === (originalValue ?? '')) {
    delete current[column];
    if (Object.keys(current).length === 0) {
      pendingKmChanges.delete(driverId);
    } else {
      pendingKmChanges.set(driverId, current);
    }
  } else {
    current[column] = trimmed;
    pendingKmChanges.set(driverId, current);
  }
  updateSaveKmButtonState();
}

async function saveKmChanges() {
  if (!btnSaveKm) return;
  if (pendingKmChanges.size === 0) return alert('Nenhuma alteração de KM pendente.');
  const originalLabel = btnSaveKm.textContent;
  btnSaveKm.disabled = true;
  btnSaveKm.textContent = 'Salvando...';
  try {
    for (const [driverId, fields] of Array.from(pendingKmChanges.entries())) {
      const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/km/${encodeURIComponent(driverId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      pendingKmChanges.delete(driverId);
    }
    await init();
    alert('KM salvo com sucesso.');
  } catch (err) {
    console.error(err);
    alert('Falha ao salvar KM. Veja o console para detalhes.');
  } finally {
    btnSaveKm.textContent = originalLabel || 'Salvar KM';
    updateSaveKmButtonState();
  }
}

function normalizeKey(key) {
  return String(key || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeSelector(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/([:\.\[\]\,=\$\#\s])/g, '\\$1');
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isImportedDraftId(id) {
  return String(id || '').startsWith(IMPORTED_DRIVER_TEMP_PREFIX);
}

function makeImportedDriverTempId(index = 0) {
  return `${IMPORTED_DRIVER_TEMP_PREFIX}${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeImportColumnKey(key) {
  return normalizeKey(key).replace(/[^a-z0-9]/g, '');
}

function readImportValue(normalizedRow = {}, aliases = []) {
  for (const alias of aliases) {
    const key = normalizeImportColumnKey(alias);
    const value = normalizedRow[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function normalizeImportedStatus(rawStatus) {
  const normalized = normalizeKey(rawStatus).replace(/\s+/g, ' ').trim();
  const map = {
    'ok so agendar': 'agendado',
    'nao enviado': 'revisar',
  };
  const candidate = map[normalized] || normalizeDriverStatus(rawStatus || '');
  return STATUS_OPTIONS.includes(candidate) ? candidate : 'revisar';
}

function mapSpreadsheetRowToDriverFields(row = {}) {
  const normalizedRow = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeImportColumnKey(key);
    if (!normalizedKey) return;
    normalizedRow[normalizedKey] = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  });

  const nome = readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Nome);
  const cidade = readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Cidade);
  if (!nome || !cidade) return null;

  const statusRaw = readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Status);
  const status = normalizeImportedStatus(statusRaw || 'agendado');
  const fields = {
    Nome: nome,
    Cidade: cidade,
    Status: status,
    PIX: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.PIX),
    CPF: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.CPF),
    Email: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Email),
    Numero: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Numero),
    Placa: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Placa),
    Modelo: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Modelo),
    Convite: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Convite),
    Observacoes: readImportValue(normalizedRow, DRIVER_IMPORT_ALIASES.Observacoes),
  };

  if (fields.Numero && !fields['Número']) fields['Número'] = fields.Numero;
  if (fields.Observacoes && !fields['Observações']) fields['Observações'] = fields.Observacoes;
  return fields;
}

function buildImportedDraftDriver(fields = {}, index = 0) {
  const tempId = makeImportedDriverTempId(index);
  const safeStatus = normalizeImportedStatus(fields.Status || 'agendado');
  const normalizedFields = {
    ...fields,
    Status: safeStatus,
  };

  const driverView = {
    id: tempId,
    name: normalizedFields.Nome || '',
    city: normalizedFields.Cidade || '',
    status: safeStatus,
    statusRaw: safeStatus,
    raw: { ...normalizedFields },
    _isDraftImport: true,
  };

  return {
    tempId,
    fields: { ...normalizedFields },
    driver: driverView,
  };
}

function getDriversForRender(drivers = []) {
  const persisted = Array.isArray(drivers) ? drivers : [];
  const imported = pendingImportedDrivers.map(entry => entry.driver).filter(Boolean);
  return [...persisted, ...imported];
}

function updateImportedDraftStatus(tempId, value) {
  const draft = pendingImportedDrivers.find(entry => entry.tempId === tempId);
  if (!draft) return;
  const safeStatus = normalizeImportedStatus(value || draft.fields.Status || 'agendado');
  draft.fields.Status = safeStatus;
  draft.driver.status = safeStatus;
  draft.driver.statusRaw = safeStatus;
  draft.driver.raw = draft.driver.raw || {};
  draft.driver.raw.Status = safeStatus;
}

function removePendingImportedDriver(tempId) {
  const before = pendingImportedDrivers.length;
  pendingImportedDrivers = pendingImportedDrivers.filter(entry => entry.tempId !== tempId);
  pendingDriverChanges.delete(tempId);
  return pendingImportedDrivers.length !== before;
}

// ===========================================================================
//  BLOQUEIO DE MOTORISTAS
// ===========================================================================

async function loadDriverBlockedPolicies(drivers) {
  const ids = (drivers || []).map(d => d.id || d._id || '').filter(Boolean);
  if (!ids.length) return;
  try {
    const params = new URLSearchParams({ ids: ids.join(',') });
    const res = await authFetch(`/api/drivers/contact-policies?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.policies && typeof data.policies === 'object') {
      for (const [id, policy] of Object.entries(data.policies)) {
        driverBlockedMap.set(id, policy);
      }
      updateBlockButtonsInTable();
    }
  } catch (err) {
    console.warn('[block] failed to load policies:', err);
  }
}

function updateBlockButtonsInTable() {
  if (!tblDrivers) return;
  tblDrivers.querySelectorAll('.driver-action-block').forEach(btn => {
    const driverId = btn.dataset.driverId;
    if (!driverId) return;
    const isBlocked = driverBlockedMap.get(driverId)?.contactBlocked === true;
    btn.textContent = isBlocked ? 'Desbloquear' : 'Bloquear';
    btn.dataset.blocked = isBlocked ? '1' : '0';
    btn.classList.toggle('is-blocked', isBlocked);
  });
}

function openDriverBlockModal(driverId, isBlocked) {
  if (!driverBlockModal) return;
  const driver = (currentCampaign?.drivers || []).find(d => d.id === driverId);
  const driverName = driver?.name || 'este motorista';
  _blockModalState = { driverId, blocking: !isBlocked };
  if (driverBlockModalTitle) {
    driverBlockModalTitle.textContent = isBlocked
      ? `Desbloquear ${driverName}?`
      : `Bloquear ${driverName}?`;
  }
  if (driverBlockReasonGroup) driverBlockReasonGroup.style.display = isBlocked ? 'none' : '';
  if (driverBlockReasonInput) driverBlockReasonInput.value = '';
  if (driverBlockModalError) driverBlockModalError.textContent = '';
  driverBlockModal.classList.remove('hidden');
  driverBlockModal.setAttribute('aria-hidden', 'false');
  if (!isBlocked && driverBlockReasonInput) setTimeout(() => driverBlockReasonInput.focus(), 50);
}

function closeDriverBlockModal() {
  if (!driverBlockModal) return;
  driverBlockModal.classList.add('hidden');
  driverBlockModal.setAttribute('aria-hidden', 'true');
}

async function saveDriverBlockState() {
  const { driverId, blocking } = _blockModalState;
  if (!driverId) return;
  const reason = driverBlockReasonInput?.value.trim() || '';
  if (btnDriverBlockSave) {
    btnDriverBlockSave.disabled = true;
    btnDriverBlockSave.textContent = blocking ? 'Bloqueando...' : 'Desbloqueando...';
  }
  if (driverBlockModalError) driverBlockModalError.textContent = '';
  try {
    const payload = { contactBlocked: blocking };
    if (blocking && reason) payload.contactBlockReason = reason;
    if (!blocking) payload.contactBlockReason = '';
    const res = await authFetch(`/api/drivers/${encodeURIComponent(driverId)}/contact-policy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    driverBlockedMap.set(driverId, {
      contactBlocked: data.policy?.contactBlocked ?? blocking,
      contactBlockReason: data.policy?.contactBlockReason ?? reason,
    });
    updateBlockButtonsInTable();
    if (hideBlockedDrivers && blocking) {
      renderDrivers(currentCampaign?.drivers || [], { preservePending: true });
    }
    closeDriverBlockModal();
  } catch (err) {
    console.error('[block] error:', err);
    if (driverBlockModalError) driverBlockModalError.textContent = err.message || 'Falha ao atualizar bloqueio.';
  } finally {
    if (btnDriverBlockSave) {
      btnDriverBlockSave.disabled = false;
      btnDriverBlockSave.textContent = 'Confirmar';
    }
  }
}

/**
 * Exporta motoristas da campanha atual em Excel ou CSV via rota do backend.
 * Pergunta o formato e dispara download autenticado (com token Bearer).
 */
async function exportDriversFile() {
  if (!currentCampaign?.id) {
    toast('Carregue a campanha antes de exportar.', 'error');
    return;
  }
  if (!btnExportDrivers) return;

  // Escolha simples de formato (sem modal extra para manter minimal)
  let format = 'xlsx';
  try {
    const choice = window.prompt('Formato do export: digite "xlsx" (Excel) ou "csv". Cancelar para abortar.', 'xlsx');
    if (choice == null) return;
    const normalized = String(choice).trim().toLowerCase();
    if (normalized === 'csv') format = 'csv';
    else if (normalized === 'xlsx' || normalized === '') format = 'xlsx';
    else {
      toast('Formato invalido. Use xlsx ou csv.', 'error');
      return;
    }
  } catch (_) { /* fallback xlsx */ }

  const originalLabel = btnExportDrivers.textContent;
  btnExportDrivers.disabled = true;
  btnExportDrivers.textContent = 'Exportando...';

  try {
    const url = `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/export/drivers?format=${format}&status=all`;
    const response = await authFetch(url);
    if (!response.ok) {
      let msg = `Falha ao exportar (HTTP ${response.status}).`;
      try {
        const errBody = await response.json();
        if (errBody?.error) msg = errBody.error;
      } catch (_) { /* ignore */ }
      toast(msg, 'error');
      return;
    }
    const blob = await response.blob();
    // Extrair filename do Content-Disposition se disponivel
    const disposition = response.headers.get('Content-Disposition') || '';
    let filename = '';
    const m = disposition.match(/filename="?([^"]+)"?/i);
    if (m && m[1]) filename = m[1];
    if (!filename) {
      const safeName = (currentCampaign.name || 'campanha').replace(/[^a-zA-Z0-9._-]+/g, '_');
      filename = `motoristas_${safeName}_${new Date().toISOString().slice(0, 10)}.${format}`;
    }
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    toast('Export gerado com sucesso.', 'success');
  } catch (err) {
    console.error('[exportDriversFile]', err);
    toast('Erro ao exportar motoristas.', 'error');
  } finally {
    btnExportDrivers.disabled = false;
    btnExportDrivers.textContent = originalLabel;
  }
}

async function handleDriversSpreadsheetSelected(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  try {
    if (!window.XLSX || !window.XLSX.utils) {
      throw new Error('Leitor de planilha indisponível no navegador.');
    }

    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', raw: false, cellDates: false });
    const firstSheetName = Array.isArray(workbook.SheetNames) ? workbook.SheetNames[0] : '';
    if (!firstSheetName) {
      throw new Error('Arquivo sem aba válida.');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, {
      defval: '',
      raw: false,
      blankrows: false,
    });

    const mapped = [];
    for (const row of rows) {
      const fields = mapSpreadsheetRowToDriverFields(row);
      if (fields) mapped.push(fields);
    }

    if (!mapped.length) {
      alert('Nenhum motorista válido foi encontrado. Verifique se a planilha possui as colunas Nome e Cidade preenchidas.');
      return;
    }

    const drafts = mapped.map((fields, index) => buildImportedDraftDriver(fields, index));
    pendingImportedDrivers.push(...drafts);
    renderDrivers(currentCampaign?.drivers || [], { preservePending: true });
    updateSaveButtonState();

    const ignored = Math.max(0, rows.length - mapped.length);
    const ignoredMsg = ignored > 0 ? ` (${ignored} linha(s) ignorada(s))` : '';
    toast(`${drafts.length} motorista(s) preparado(s) para inclusão${ignoredMsg}. Clique em "Salvar alterações".`, 'success');
  } catch (err) {
    console.error('Import driver spreadsheet error', err);
    alert(`Não foi possível processar a planilha: ${err?.message || err}`);
  } finally {
    if (importDriversFile) importDriversFile.value = '';
  }
}

function findColumnKey(targets) {
  const header = getCampaignHeader();
  if (!Array.isArray(header) || header.length === 0) return null;
  const list = Array.isArray(targets) ? targets : [targets];
  const normalizedTargets = list.map(normalizeKey);
  return header.find(col => normalizedTargets.includes(normalizeKey(col))) || null;
}

const ADHESION_INITIAL_COLUMN_ALIASES = [
  'adesivagem inicial',
  'horario adesivagem inicial',
  'horário adesivagem inicial',
];
const ADHESION_REMOVAL_COLUMN_ALIASES = [
  'retirada adesivo',
  'horario retirada adesivo',
  'horário retirada adesivo',
];
const ADHESION_STATUS_COLUMN_ALIASES = [
  'status adesivagem',
  'situacao adesivagem',
  'situação adesivagem',
];

function getDriverRawValueByAliases(driver, aliases = []) {
  const raw = driver?.raw && typeof driver.raw === 'object' ? driver.raw : {};
  const entries = Object.entries(raw);
  if (!entries.length) return '';
  const normalizedAliases = aliases.map(normalizeKey);
  const match = entries.find(([key]) => normalizedAliases.includes(normalizeKey(key)));
  return match ? String(match[1] ?? '').trim() : '';
}

function parseAdhesionDateTimeMs(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = String(value).trim();
  if (!text) return null;

  const parsedIso = new Date(text.replace(/\s+/, 'T'));
  if (Number.isFinite(parsedIso.getTime())) return parsedIso.getTime();

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

function formatAdhesionDateTimeInput(value) {
  const timestamp = parseAdhesionDateTimeMs(value);
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

function getDriverAdhesionField(driver, mode = 'initial') {
  const schedule = driver?.schedule && typeof driver.schedule === 'object' ? driver.schedule : {};
  if (mode === 'status') {
    return normalizeAdhesionStatus(
      schedule.status ||
      getDriverRawValueByAliases(driver, ADHESION_STATUS_COLUMN_ALIASES),
    );
  }
  if (mode === 'initial') {
    return formatAdhesionDateTimeInput(
      schedule.initialAtRaw ??
      schedule.initialAt ??
      getDriverRawValueByAliases(driver, ADHESION_INITIAL_COLUMN_ALIASES),
    );
  }
  return formatAdhesionDateTimeInput(
    schedule.removalAtRaw ??
    schedule.removalAt ??
    getDriverRawValueByAliases(driver, ADHESION_REMOVAL_COLUMN_ALIASES),
  );
}

const kmNumberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentNumberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function formatKmValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number' && Number.isFinite(value)) return kmNumberFormatter.format(value);
  const parsed = Number(String(value).replace(/\./g, '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? kmNumberFormatter.format(parsed) : String(value);
}

function formatPercentValue(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  return `${percentNumberFormatter.format(Number(value))}%`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('pt-BR');
  const parsed = Number(String(value).replace(/\./g, '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR') : String(value);
}

function formatGoalMonths(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  const rounded = Math.round(parsed);
  if (Math.abs(parsed - rounded) < 0.0001) return rounded.toLocaleString('pt-BR');
  return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseDateMillis(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

function parseCampaignDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 100000000000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? Number(`20${br[3]}`) : Number(br[3]);
    const date = new Date(Date.UTC(year, Number(br[2]) - 1, Number(br[1])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function campaignUtcDayNumber(date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

function getCampaignGoalPeriodCandidates(campaign = {}) {
  const apiData = campaign?.apiData || {};
  const candidates = [
    [apiData.periodStart, apiData.periodEnd],
    [campaign?.periodStart, campaign?.periodEnd],
    [campaign?.startDate, campaign?.endDate],
    [campaign?.startAt, campaign?.endAt],
  ];
  const period = String(campaign?.period || '').trim();
  if (period) {
    const parts = period.split(/\s+(?:-|a|até|ate)\s+/i).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) candidates.push([parts[0], parts[1]]);
  }
  return candidates;
}

function getCampaignKmGoalDays(campaign = {}) {
  for (const [startValue, endValue] of getCampaignGoalPeriodCandidates(campaign)) {
    const start = parseCampaignDate(startValue);
    const end = parseCampaignDate(endValue);
    if (!start || !end) continue;
    const days = campaignUtcDayNumber(end) - campaignUtcDayNumber(start) + 1;
    if (Number.isFinite(days) && days > 0) return days;
  }
  return null;
}

function daysInUtcMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUtcMonthsFromAnchor(date, months) {
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function isExactMonthAnchor(start, end) {
  const startDay = campaignUtcDayNumber(start);
  const endDay = campaignUtcDayNumber(end);
  if (endDay <= startDay) return false;

  const roughMonthSpan = Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1,
  );

  for (let offset = 1; offset <= roughMonthSpan + 1; offset += 1) {
    const anchorDay = campaignUtcDayNumber(addUtcMonthsFromAnchor(start, offset));
    if (anchorDay === endDay) return true;
    if (anchorDay > endDay) return false;
  }

  return false;
}

function calculateCampaignMonthUnits(start, end) {
  const startDay = campaignUtcDayNumber(start);
  const endDay = campaignUtcDayNumber(end);
  if (endDay < startDay) return 0;

  const exclusiveEndDay = isExactMonthAnchor(start, end) ? endDay : endDay + 1;
  let wholeMonths = 0;

  while (campaignUtcDayNumber(addUtcMonthsFromAnchor(start, wholeMonths + 1)) <= exclusiveEndDay) {
    wholeMonths += 1;
  }

  const cursorDay = campaignUtcDayNumber(addUtcMonthsFromAnchor(start, wholeMonths));
  const nextCursorDay = campaignUtcDayNumber(addUtcMonthsFromAnchor(start, wholeMonths + 1));
  const cycleDays = Math.max(1, nextCursorDay - cursorDay);
  const remainingDays = Math.max(0, exclusiveEndDay - cursorDay);
  return wholeMonths + (remainingDays / cycleDays);
}

function getCampaignKmGoalPeriod(campaign = {}) {
  for (const [startValue, endValue] of getCampaignGoalPeriodCandidates(campaign)) {
    const start = parseCampaignDate(startValue);
    const end = parseCampaignDate(endValue);
    if (!start || !end) continue;

    const days = campaignUtcDayNumber(end) - campaignUtcDayNumber(start) + 1;
    if (!Number.isFinite(days) || days <= 0) continue;

    const months = calculateCampaignMonthUnits(start, end);
    if (Number.isFinite(months) && months > 0) {
      return { days, months, hasPeriod: true };
    }
  }

  return { days: null, months: KM_GOAL_DEFAULT_MONTHS, hasPeriod: false };
}

function getCampaignKmGoal(campaign = {}, driverCount = 0) {
  const period = getCampaignKmGoalPeriod(campaign);
  const perDriver = Math.max(0, Math.round(KM_GOAL_PER_DRIVER_MONTH * period.months));
  const totalDrivers = Math.max(0, Math.round(Number(driverCount) || 0));
  return {
    days: period.days,
    months: period.months,
    hasPeriod: period.hasPeriod,
    perDriver,
    total: perDriver * totalDrivers,
    driverCount: totalDrivers,
    baseKm: KM_GOAL_PER_DRIVER_MONTH,
    baseMonths: KM_GOAL_DEFAULT_MONTHS,
  };
}

function getKmLocalStorageKey() {
  return `oddrive:campaign:${campaignId}:km-local:${KM_LOCAL_STORAGE_VERSION}`;
}

function createDefaultKmState() {
  return {
    settings: {
      minKmPerDriver: KM_DEFAULT_MIN_PER_DRIVER,
    },
    drivers: {},
  };
}

function readKmLocalState() {
  try {
    const raw = localStorage.getItem(getKmLocalStorageKey());
    if (!raw) return createDefaultKmState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return createDefaultKmState();
    return {
      settings: {
        minKmPerDriver: Number(parsed?.settings?.minKmPerDriver) || KM_DEFAULT_MIN_PER_DRIVER,
      },
      drivers: parsed?.drivers && typeof parsed.drivers === 'object' ? parsed.drivers : {},
    };
  } catch (_) {
    return createDefaultKmState();
  }
}

function persistKmLocalState() {
  if (!summaryKmLocalState) return;
  try {
    localStorage.setItem(getKmLocalStorageKey(), JSON.stringify(summaryKmLocalState));
  } catch (_) {}
}

function getDriverRawNumericByAliases(driver, aliases = []) {
  const raw = driver?.raw || {};
  const rawKeys = Object.keys(raw);
  if (!rawKeys.length) return null;
  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    const match = rawKeys.find(key => normalizeKey(key).includes(normalizedAlias));
    if (!match) continue;
    const parsed = parseNumeric(raw[match]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function getDriverOdometerFromApi(driver) {
  const fromEvidence = parseNumeric(driver?.odometerEvidence?.driverLatestValue);
  if (Number.isFinite(fromEvidence) && fromEvidence > 0) return fromEvidence;

  // Do not include km.total.kmRodado here: it is travelled KM, not an odometer reading.
  const fromSummary = parseNumeric(driver?.km?.summary?.currentKm ?? driver?.km?.odometerCurrentKm);
  if (Number.isFinite(fromSummary) && fromSummary > 0) return fromSummary;

  const fromRaw = getDriverRawNumericByAliases(driver, [
    'odometro atual',
    'odômetro atual',
    'drv odometro valor inst',
    'drv odômetro valor inst',
    'odometro',
    'odômetro',
  ]);
  if (Number.isFinite(fromRaw) && fromRaw > 0) return fromRaw;

  return null;
}

function getDriverGraphicOdometerFromApi(driver) {
  const fromEvidence = parseNumeric(driver?.odometerEvidence?.graphicInitialValue);
  if (Number.isFinite(fromEvidence) && fromEvidence > 0) return fromEvidence;

  // Graphic odometer = first reading submitted by the graphic at installation.
  const fromGraphic = parseNumeric(driver?.km?.graphicOdometer?.value);
  if (Number.isFinite(fromGraphic) && fromGraphic > 0) return fromGraphic;

  const fromRaw = getDriverRawNumericByAliases(driver, [
    'gfx odometro valor inst',
    'gfx odômetro valor inst',
  ]);
  if (Number.isFinite(fromRaw) && fromRaw > 0) return fromRaw;

  return null;
}

function getDriverOdometerDistance(driver) {
  const driverOdometer = getDriverOdometerFromApi(driver);
  const graphicOdometer = getDriverGraphicOdometerFromApi(driver);
  if (!Number.isFinite(driverOdometer) || !Number.isFinite(graphicOdometer)) {
    return { value: null, inconsistent: false, driverOdometer, graphicOdometer };
  }
  if (driverOdometer < graphicOdometer) {
    return { value: null, inconsistent: true, driverOdometer, graphicOdometer };
  }
  return {
    value: driverOdometer - graphicOdometer,
    inconsistent: false,
    driverOdometer,
    graphicOdometer,
  };
}

function getDriverInitialKmFromData(driver) {
  const fromSummary = parseNumeric(driver?.km?.summary?.initialKm ?? driver?.km?.initialKm);
  if (Number.isFinite(fromSummary) && fromSummary > 0) return fromSummary;

  const direct = getDriverRawNumericByAliases(driver, [
    'km inicial',
    'odometro inicial',
    'hodometro inicial',
    'odo inicial',
  ]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return null;
}

function ensureSummaryKmLocalState(campaign) {
  const drivers = Array.isArray(campaign?.drivers) ? campaign.drivers : [];
  const state = readKmLocalState();
  const existing = state.drivers && typeof state.drivers === 'object' ? state.drivers : {};
  const nextDrivers = {};

  for (const driver of drivers) {
    const id = String(driver?.id || '').trim();
    if (!id) continue;

    const currentStored = existing[id] && typeof existing[id] === 'object' ? existing[id] : {};
    const odometerFromApi = getDriverOdometerFromApi(driver);
    const graphicOdometerFromApi = getDriverGraphicOdometerFromApi(driver);
    // Prefer graphic odometer (submitted by gráfica at install) as the authoritative odometer source
    const bestOdometerFromApi = graphicOdometerFromApi ?? odometerFromApi;
    const initialFromData = getDriverInitialKmFromData(driver);

    const storedInitialSource = String(currentStored.initialSource || '').trim().toLowerCase();
    const storedCurrentSource = String(currentStored.currentSource || '').trim().toLowerCase();
    const storedInitialValue = parseStoredKmValue(currentStored.initialKm);
    const storedCurrentValue = parseStoredKmValue(currentStored.currentKm);
    const hasManualInitial = storedInitialSource === 'manual';
    const hasManualCurrent = storedCurrentSource === 'manual';

    // initialKm = odômetro na instalação: auto-populated from graphic/driver flow odometer reading
    let initialKm = null;
    let initialSource = storedInitialSource || '';
    if (hasManualInitial && Number.isFinite(storedInitialValue) && storedInitialValue >= 0) {
      initialKm = storedInitialValue;
      initialSource = 'manual';
    } else if (Number.isFinite(bestOdometerFromApi) && bestOdometerFromApi >= 0) {
      initialKm = bestOdometerFromApi;
      initialSource = 'odometer';
    } else if (Number.isFinite(initialFromData) && initialFromData >= 0) {
      initialKm = initialFromData;
      initialSource = 'data';
    } else if (Number.isFinite(storedInitialValue) && storedInitialValue >= 0) {
      initialKm = storedInitialValue;
      initialSource = initialSource || 'stored';
    }

    // currentKm = KM percorrido na campanha: ONLY from explicit manual entry
    // Values previously stored with source 'api-odometer' are odometer snapshots, NOT km percorrido
    let currentKm = null;
    let currentSource = storedCurrentSource || '';
    if (hasManualCurrent && Number.isFinite(storedCurrentValue) && storedCurrentValue >= 0) {
      currentKm = storedCurrentValue;
      currentSource = 'manual';
    }
    // If source is not 'manual' (e.g. old 'api-odometer' data), discard - it was the odometer snapshot

    const updatedAt =
      parseDateMillis(currentStored.updatedAt) ||
      parseDateMillis(driver?.km?.summary?.updatedAt) ||
      parseDateMillis(driver?.km?.odometerUpdatedAt) ||
      parseDateMillis(driver?.updatedAt) ||
      null;

    nextDrivers[id] = {
      initialKm: Number.isFinite(initialKm) ? Math.round(initialKm) : null,
      currentKm: Number.isFinite(currentKm) ? Math.round(currentKm) : null,
      updatedAt,
      initialSource: initialSource || 'unknown',
      currentSource: currentSource || 'unknown',
    };
  }

  state.drivers = nextDrivers;
  state.settings.minKmPerDriver = getSummaryMinKmPerDriver(campaign);
  if (!Number.isFinite(Number(state.settings?.minKmPerDriver))) {
    state.settings.minKmPerDriver = KM_DEFAULT_MIN_PER_DRIVER;
  }

  summaryKmLocalState = state;
  persistKmLocalState();
  return state;
}

function getSummaryMinKmPerDriver(campaign) {
  const totalDrivers = Array.isArray(campaign?.drivers) ? campaign.drivers.length : 0;
  return getCampaignKmGoal(campaign, totalDrivers).perDriver;
}

// Calcula risco de não bater meta de KM com base no ritmo atual vs ritmo necessário.
// Retorna { state, kmFalt, daysRemaining, ritmoAtual, ritmoNecessario, percentComplete }
// Estados: 'at-risk' | 'on-track' | 'goal-reached' | 'no-time-left' |
//          'no-data' | 'invalid-dates' | 'campaign-ended' | 'no-goal'
function calculateKmPaceRisk(kmCtx, campaign, minKmPerDriver) {
  const periodStart = campaign?.apiData?.periodStart;
  const periodEnd = campaign?.apiData?.periodEnd;
  if (!periodStart || !periodEnd) return { state: 'no-data' };

  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return { state: 'invalid-dates' };

  const now = Date.now();
  if (end.getTime() < now) return { state: 'campaign-ended' };

  const meta = Number(minKmPerDriver) || 0;
  if (meta <= 0) return { state: 'no-goal' };

  const current = Number(kmCtx?.travelledKm);
  if (!Number.isFinite(current) || !kmCtx?.hasKmData) return { state: 'no-data' };

  const percentComplete = (current / meta) * 100;
  if (current >= meta) return { state: 'goal-reached', percentComplete: 100 };

  const daysElapsed = Math.max(1, (now - start.getTime()) / 86400000);
  const daysRemaining = (end.getTime() - now) / 86400000;
  const kmFalt = meta - current;

  if (daysRemaining < 1) {
    return {
      state: 'no-time-left',
      kmFalt: Math.round(kmFalt),
      daysRemaining: 0,
      percentComplete: Math.round(percentComplete),
    };
  }

  const ritmoAtual = current / daysElapsed;
  const ritmoNecessario = kmFalt / daysRemaining;
  const atRisk = ritmoNecessario > ritmoAtual * KM_PACE_RISK_MULTIPLIER;

  return {
    state: atRisk ? 'at-risk' : 'on-track',
    kmFalt: Math.round(kmFalt),
    daysRemaining: Math.ceil(daysRemaining),
    ritmoAtual: Math.round(ritmoAtual),
    ritmoNecessario: Math.round(ritmoNecessario),
    percentComplete: Math.round(percentComplete),
  };
}

// Conveniência para uso fora de buildSummaryAnalytics — calcula risco para um motorista
// usando o currentCampaign global.
function getDriverPaceRisk(driver) {
  if (!driver || !currentCampaign) return null;
  const minKm = getSummaryMinKmPerDriver(currentCampaign);
  const kmCtx = getDriverKmContext(driver);
  return calculateKmPaceRisk(kmCtx, currentCampaign, minKm);
}

function getDriverKmContext(driver) {
  const driverId = String(driver?.id || '').trim();
  const stored = summaryKmLocalState?.drivers?.[driverId] || {};
  const storedInitial = parseStoredKmValue(stored.initialKm);
  const storedCurrent = parseStoredKmValue(stored.currentKm);
  const odometerFromApi = getDriverOdometerFromApi(driver);
  const graphicOdometerFromApi = getDriverGraphicOdometerFromApi(driver);
  // Prefer graphic odometer (submitted by gráfica) as the authoritative source for the installation snapshot
  const bestOdometerFromApi = graphicOdometerFromApi ?? odometerFromApi;

  // Odômetro na instalação (snapshot): prefer graphic source, fallback to driver, then stored initial
  const odometerKm = Number.isFinite(bestOdometerFromApi)
    ? Number(bestOdometerFromApi)
    : (Number.isFinite(storedInitial) ? storedInitial : null);

  // KM percorrido na campanha:
  // 1. Manual override (source === 'manual') takes precedence
  // 2. API kmTravelledValue / campaignData.totalKms como fonte primária
  // 3. Fallback: null (sem dados)
  const travelledKmSource = String(stored.currentSource || '').trim().toLowerCase();
  let travelledKm = null;
  let source = 'no-km-data';

  if (travelledKmSource === 'manual' && Number.isFinite(storedCurrent) && storedCurrent >= 0) {
    travelledKm = storedCurrent;
    source = 'manual';
  } else {
    // Tentar API: kmTravelledValue ou campaignData.totalKms
    const apiKm = Number(driver?.kmTravelledValue);
    const apiTotalKms = Number(driver?.campaignData?.totalKms);
    if (Number.isFinite(apiKm) && apiKm > 0) {
      travelledKm = apiKm;
      source = 'api';
    } else if (Number.isFinite(apiTotalKms) && apiTotalKms > 0) {
      travelledKm = apiTotalKms;
      source = 'api';
    }
  }

  if (source === 'no-km-data' && Number.isFinite(bestOdometerFromApi)) {
    source = 'api-odometer';
  }

  const hasKmData = Number.isFinite(travelledKm);

  const updatedAt = parseDateMillis(stored.updatedAt)
    || parseDateMillis(driver?.km?.summary?.updatedAt)
    || parseDateMillis(driver?.km?.odometerUpdatedAt)
    || parseDateMillis(driver?.updatedAt)
    || null;

  return {
    driverId,
    initialKm: odometerKm,   // odômetro na instalação (snapshot do fluxo do motorista)
    currentKm: odometerKm,   // same reference kept for backward compatibility
    travelledKm,             // KM percorrido na campanha (API ou manual)
    hasKmData,
    updatedAt,
    source,
  };
}

function setDriverLocalKm(driverId, initialKm, currentKm) {
  if (!summaryKmLocalState || !driverId) return;
  const safeInitial = Math.max(0, Math.round(Number(initialKm) || 0));
  // safeCurrent = KM percorrido na campanha (independent of odometer snapshot)
  const safeCurrent = Math.max(0, Math.round(Number(currentKm) || 0));
  summaryKmLocalState.drivers[driverId] = {
    initialKm: safeInitial,
    currentKm: safeCurrent,
    updatedAt: Date.now(),
    initialSource: 'manual',
    currentSource: 'manual',
  };
  persistKmLocalState();
}

function formatKmCompact(value) {
  return `${formatNumber(Math.round(Number(value) || 0))} KM`;
}

function formatPercentCompact(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function formatStorageDateFolder(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  // Expecting folder in YYYY-MM-DD format. Parse manually as UTC to avoid timezone shifts.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      const dt = new Date(Date.UTC(year, month - 1, day));
      return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatStorageTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function detectKmPeriodsFromHeader(header) {
  if (!Array.isArray(header) || header.length === 0) return null;
  let maxIdx = 0;
  const re = /(?:KM RODADO|META KM|KM|STATUS)\s*(\d+)/i;
  for (const h of header) {
    const m = String(h || '').match(re);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxIdx) maxIdx = n;
    }
  }
  return maxIdx || null;
}

// KM periods control wiring (number input in KM toolbar)
let kmPeriodsDebounce = null;
function setupKmPeriodsControl() {
  const input = el('#kmPeriodsInput');
  if (!input) return;
  // derive initial value: campaign.kmPeriods or based on kmSheetHeader or default 3
  const header = Array.isArray(currentCampaign?.kmSheetHeader) && currentCampaign.kmSheetHeader.length
    ? currentCampaign.kmSheetHeader
    : (Array.isArray(currentCampaign?.sheetHeader) && currentCampaign.sheetHeader.length ? currentCampaign.sheetHeader : []);
  const detected = currentCampaign?.kmPeriods ?? detectKmPeriodsFromHeader(header) ?? 3;
  input.value = detected;

  input.addEventListener('change', () => {
    const val = Number(input.value);
    if (!Number.isFinite(val) || val < 1) {
      alert('Informe um número válido de períodos (min 1).');
      input.value = currentCampaign?.kmPeriods ?? 3;
      return;
    }
    // debounce and send PATCH to update campaign
    if (kmPeriodsDebounce) clearTimeout(kmPeriodsDebounce);
    kmPeriodsDebounce = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kmPeriods: Math.max(1, Math.min(12, Math.round(val))) }),
        });
        if (!res.ok) { const txt = await res.text(); throw new Error(txt || `HTTP ${res.status}`); }
        const data = await res.json();
        // update currentCampaign and re-render KM table
        currentCampaign = data.campaign;
        await init();
      } catch (err) {
        console.error(err);
        alert('Não foi possível atualizar o número de períodos');
      }
    }, 400);
  });
}

async function saveCooldownSettings() {
  if (!currentCampaign || !btnSaveCooldown) return;
  const driverDays = Number(cooldownDriverInput?.value ?? 0);
  const graphicDays = Number(cooldownGraphicInput?.value ?? 0);
  if (!Number.isFinite(driverDays) || driverDays < 0 || driverDays > 365) {
    alert('Dias para motorista inválido (0-365).');
    return;
  }
  if (!Number.isFinite(graphicDays) || graphicDays < 0 || graphicDays > 365) {
    alert('Dias para gráfica inválido (0-365).');
    return;
  }
  const original = btnSaveCooldown.textContent;
  btnSaveCooldown.disabled = true;
  btnSaveCooldown.textContent = 'Salvando...';
  if (cooldownMessage) {
    cooldownMessage.textContent = '';
    cooldownMessage.classList.remove('text-success', 'text-danger');
  }
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverCooldownDays: driverDays, graphicCooldownDays: graphicDays }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    const data = await res.json();
    currentCampaign.driverCooldownDays = data?.campaign?.driverCooldownDays ?? driverDays;
    currentCampaign.graphicCooldownDays = data?.campaign?.graphicCooldownDays ?? graphicDays;
    if (cooldownMessage) {
      cooldownMessage.textContent = 'Cooldown atualizado com sucesso.';
      cooldownMessage.classList.add('text-success');
    }
  } catch (err) {
    console.error(err);
    if (cooldownMessage) {
      cooldownMessage.textContent = 'Não foi possível salvar o cooldown.';
      cooldownMessage.classList.add('text-danger');
    }
  } finally {
    btnSaveCooldown.disabled = false;
    btnSaveCooldown.textContent = original || 'Salvar';
  }
}

async function saveEvidenceWindowSettings() {
  if (!currentCampaign || !btnSaveEvidenceWindow) return;
  const days = Number(evidenceWindowInput?.value ?? 30);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    alert('Janela de evidencias invalida (1-365).');
    return;
  }
  const original = btnSaveEvidenceWindow.textContent;
  btnSaveEvidenceWindow.disabled = true;
  btnSaveEvidenceWindow.textContent = 'Salvando...';
  if (evidenceWindowMessage) {
    evidenceWindowMessage.textContent = '';
    evidenceWindowMessage.classList.remove('text-success', 'text-danger');
  }
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidenceWindowDays: days }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    currentCampaign.evidenceWindowDays = days;
    if (evidenceWindowMessage) {
      evidenceWindowMessage.textContent = 'Configuracao salva com sucesso.';
      evidenceWindowMessage.classList.add('text-success');
    }
  } catch (err) {
    console.error(err);
    if (evidenceWindowMessage) {
      evidenceWindowMessage.textContent = 'Nao foi possivel salvar.';
      evidenceWindowMessage.classList.add('text-danger');
    }
  } finally {
    btnSaveEvidenceWindow.disabled = false;
    btnSaveEvidenceWindow.textContent = original || 'Salvar';
  }
}

async function openDriverTargetPrompt() {

  const modal = document.getElementById('driverTargetModal');
  const card = modal?.querySelector('.modal-card--prompt');
  const input = document.getElementById('driverTargetModalInput');
  const desc = document.getElementById('driverTargetModalDesc');
  const errEl = document.getElementById('driverTargetModalError');
  const saveBtn = document.getElementById('btnDriverTargetSave');
  if (!modal || !input) return;

  // Preencher
  input.value = current > 0 ? String(current) : '';
  if (desc) desc.textContent = `Campanha: ${currentCampaign.name || ''}`;
  if (errEl) errEl.textContent = '';

  // Abrir
  modal.classList.remove('hidden');
  modal.removeAttribute('aria-hidden');
  card?.classList.add('is-visible');
  setTimeout(() => input.focus(), 80);

  function closeModal() {
    card?.classList.remove('is-visible');
    card?.classList.add('is-leaving');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      card?.classList.remove('is-leaving');
    }, 220);
  }

  // Dismiss via backdrop / Cancelar
  function onDismiss(e) {
    if (e.target.closest('[data-modal-dismiss]')) {
      closeModal();
      cleanup();
    }
  }

  // Enter no input confirma
  function onKeydown(e) {
    if (e.key === 'Escape') { closeModal(); cleanup(); }
  }

  async function onSave() {
    if (errEl) errEl.textContent = '';
    const raw = input.value.trim();
    const target = raw === '' ? 0 : parseInt(raw, 10);
    if (!Number.isFinite(target) || target < 0 || target > 100000) {
      if (errEl) errEl.textContent = 'Valor inválido. Use um número entre 0 e 100.000.';
      input.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando…';
    try {
      const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverTarget: target }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const saved = data?.campaign?.driverTarget ?? target;
      currentCampaign.driverTarget = saved;
      updateDriverTargetLabel(saved);
      closeModal();
      cleanup();
    } catch (err) {
      console.error(err);
      if (errEl) errEl.textContent = 'Não foi possível salvar. Tente novamente.';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar meta';
    }
  }

  function cleanup() {
    modal.removeEventListener('click', onDismiss);
    document.removeEventListener('keydown', onKeydown);
    saveBtn.removeEventListener('click', onSave);
    input.removeEventListener('keydown', onInputEnter);
  }

  function onInputEnter(e) { if (e.key === 'Enter') onSave(); }

  modal.addEventListener('click', onDismiss);
  document.addEventListener('keydown', onKeydown);
  saveBtn.addEventListener('click', onSave);
  input.addEventListener('keydown', onInputEnter);
}

function updateDriverTargetLabel(value) {
  if (!driverTargetLabel) return;
  driverTargetLabel.textContent = (value > 0) ? String(value) : '—';
}

function parseLocalNumber(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim();
  if (!s) return null;
  const cleaned = s.replace(/\./g, '').replace(/,/g, '.').replace('%', '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function updateDriverTotals(driverId) {
  try {
    const tbody = el('#tblKm');
    if (!tbody) return;
    const trTotal = tbody.querySelector(`tr[data-driver-id="${driverId}"][data-is-total="1"]`);
    if (!trTotal) return;

    // Sum KM and Meta from period rows
    // collect only period inputs (exclude TOTAL inputs to avoid double-counting)
    const allKmInputs = Array.from(tbody.querySelectorAll(`input[data-driver-id="${driverId}"][data-column^="KM RODADO "]`));
    const kmInputs = allKmInputs.filter(i => /^KM RODADO \d+$/.test(String(i.dataset.column || '').trim()));
    const allMetaInputs = Array.from(tbody.querySelectorAll(`input[data-driver-id="${driverId}"][data-column^="META KM "]`));
    const metaInputs = allMetaInputs.filter(i => /^META KM \d+$/.test(String(i.dataset.column || '').trim()));

    let kmSum = 0; let kmCount = 0;
    kmInputs.forEach(i => {
      const v = parseLocalNumber(i.value);
      if (Number.isFinite(v)) { kmSum += v; kmCount++; }
    });
    let metaSum = 0; let metaCount = 0;
    metaInputs.forEach(i => {
      const v = parseLocalNumber(i.value);
      if (Number.isFinite(v)) { metaSum += v; metaCount++; }
    });

    // Update total km input (if exists)
    const totalKmInput = trTotal.querySelector('input[data-column="KM RODADO TOTAL"]');
    if (totalKmInput) {
      totalKmInput.value = kmSum || '';
      totalKmInput.dataset.originalValue = totalKmInput.value;
    }
    const totalMetaInput = trTotal.querySelector('input[data-column="META KM TOTAL"]');
    if (totalMetaInput) {
      totalMetaInput.value = metaSum || '';
      totalMetaInput.dataset.originalValue = totalMetaInput.value;
    }

    // Update percent cell
    const percentCell = trTotal.querySelector('[data-column^="PERCENT"]');
    const percentVal = (metaSum && metaSum !== 0) ? (kmSum / metaSum) * 100 : null;
    if (percentCell) percentCell.textContent = formatPercentValue(percentVal);

    // Update status cell (simple derivation)
    const statusCell = trTotal.querySelector('input[data-column="STATUS TOTAL"]');
    if (statusCell) {
      // derive status from percent
      let status = '';
      if (percentVal === null) status = '';
      else if (percentVal >= 100) status = 'OK';
      else if (percentVal >= 80) status = 'Atenção';
      else status = 'Crítico';
      statusCell.value = status;
      statusCell.dataset.originalValue = status;
    }
  } catch (err) {
    console.error('updateDriverTotals error', err);
  }
}
 
function normalizeDriverStatus(value) {
  const status = normalizeKey(value);
  if (!status) return '';
  const map = {
    agendada: 'agendado',
    confirmada: 'confirmado',
    instalada: 'instalado',
    pendente: 'aguardando',
    'em cadastro': 'cadastrando',
  };
  const normalized = map[status] || status;
  return STATUS_OPTIONS.includes(normalized) ? normalized : status;
}

function showModal(modal) {
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  openModalCount += 1;
  document.body.style.overflow = 'hidden';
}

function hideModal(modal) {
  if (!modal) return;
  if (!modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount === 0) document.body.style.overflow = '';
  }
  if (modal === driverFormModal && driverForm) {
    driverForm.reset();
  }
  if (modal === driverDetailModal && driverDetailForm) {
    driverDetailForm.reset();
  }
  if (modal === graphicFormModal && graphicForm) {
    graphicForm.reset();
    editingGraphicId = null;
    if (graphicFormMessage) graphicFormMessage.textContent = '';
  }
  if (modal === importKmModal) resetImportKmFormState();
}

function resetImportKmFormState() {
  if (importKmForm) importKmForm.reset();
  clearImportKmMessage();
}

function clearImportKmMessage() {
  if (!importKmMessage) return;
  importKmMessage.textContent = '';
  if (importKmMessage.classList) importKmMessage.classList.remove('text-success', 'text-danger');
}

function formatStatusPill(value) {
  const status = String(value || '').toLowerCase();
  if (!status) return { label: '-', className: '' };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return { label, className: status };
}

async function confirmCampaignStatusChange(nextStatus) {
  const { label } = formatStatusPill(nextStatus);
  const prettyLabel = label || nextStatus || '-';
  if (typeof openAdminPrompt === 'function') {
    const result = await openAdminPrompt({
      title: 'Atualizar status da campanha',
      description: `Deseja confirmar a mudanca do status para "${prettyLabel}"?`,
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
      fields: [],
    });
    return result !== null;
  }
  return confirmDialog(`Deseja confirmar a mudanca do status para "${prettyLabel}"?`, {
    title: 'Confirmar atualização',
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar',
  });
}

function ensureTableState(table) {
  if (!table) return;
  const body = table.querySelector('tbody');
  const emptyMessage = table.dataset.empty || 'Sem registros.';
  if (!body) return;

  if (body.children.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    const headerRow = table.querySelector('thead tr');
    const columnCount = headerRow
      ? Array.from(headerRow.children).reduce((count, th) => {
          const span = Number(th.getAttribute('colspan'));
          return count + (Number.isFinite(span) && span > 0 ? span : 1);
        }, 0)
      : table.querySelectorAll('th').length;
    cell.colSpan = columnCount || 1;
    cell.className = 'empty-row';
    cell.textContent = emptyMessage;
    row.appendChild(cell);
    body.appendChild(row);
  }
}

function markDriverRowDirty(driverId, dirty) {
  if (!tblDrivers || !driverId) return;
  const row = tblDrivers.querySelector(
    `tr[data-driver-id="${escapeSelector(driverId)}"]`,
  );
  if (row) row.classList.toggle('pending-row', dirty);
}

function updateSaveButtonState() {
  if (!btnSaveDrivers) return;
  btnSaveDrivers.disabled = pendingDriverChanges.size === 0 && pendingImportedDrivers.length === 0;
}

function bufferDriverChange(driverId, column, value, originalValue = '') {
  if (!driverId || !column) return;
  const trimmed = value;
  const current = pendingDriverChanges.get(driverId) || {};

  if (trimmed === (originalValue ?? '')) {
    delete current[column];
    if (Object.keys(current).length === 0) {
      pendingDriverChanges.delete(driverId);
      markDriverRowDirty(driverId, false);
    } else {
      pendingDriverChanges.set(driverId, current);
    }
  } else {
    current[column] = trimmed;
    pendingDriverChanges.set(driverId, current);
    markDriverRowDirty(driverId, true);
  }

  updateSaveButtonState();
}

async function fetchCampaign(id) {
  const url = `/api/campaigns/${encodeURIComponent(id)}`;
  console.debug('fetchCampaign url=', url);
  const res = await authFetch(url);
  if (!res.ok) {
    let message = '';
    try { message = await res.text(); } catch (e) { message = String(e); }
    const err = new Error(message || `HTTP ${res.status}`);
    err.status = res.status;
    err.responseText = message;
    throw err;
  }
  return res.json();
}

function renderCounts(counts = {}) {
  el('#cAg').textContent = counts.agendado || 0;
  el('#cCf').textContent = counts.confirmado || 0;
  el('#cIn').textContent = counts.instalado || 0;
  el('#cPb').textContent = counts.problema || 0;
  el('#cRv').textContent = counts.revisar || 0;
}

function renderDrivers(drivers = [], options = {}) {
  const { preservePending = false } = options;
  const tbody = tblDrivers;
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!preservePending) pendingDriverChanges.clear();
  updateSaveButtonState();

  // sort drivers alphabetically (pt-BR) by name for consistent UI
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  let driversToRender = getDriversForRender(drivers);
  if (hideBlockedDrivers) {
    driversToRender = driversToRender.filter(d => !driverBlockedMap.get(d.id)?.contactBlocked);
  }
  const sortedDrivers = driversToRender.sort((a, b) => collator.compare((a.name || ''), (b.name || '')));

  const columnStatus = findColumnKey(['status']);
  const columnAdhesionInitial = findColumnKey(ADHESION_INITIAL_COLUMN_ALIASES) || 'Adesivagem Inicial';
  const columnAdhesionRemoval = findColumnKey(ADHESION_REMOVAL_COLUMN_ALIASES) || 'Retirada Adesivo';
  for (const driver of sortedDrivers) {
    const isDraftImport = Boolean(driver?._isDraftImport);
    const row = document.createElement('tr');
    row.dataset.driverId = driver.id || '';
    if (isDraftImport) row.classList.add('pending-row');

    // Nome
    const nameCell = document.createElement('td');
    nameCell.dataset.col = 'name';
    if (isDraftImport) {
      const nameText = document.createElement('span');
      nameText.textContent = driver.name || '-';
      nameCell.appendChild(nameText);
    } else {
      const nameButton = document.createElement('button');
      nameButton.type = 'button';
      nameButton.className = 'link-button driver-name';
      nameButton.dataset.driverId = driver.id || '';
      nameButton.textContent = driver.name || '-';
      nameCell.appendChild(nameButton);
      // Bolinha de risco de prazo — sempre renderiza (invisible quando sem risco) para manter alinhamento vertical
      const paceRisk = getDriverPaceRisk(driver);
      const riskDot = document.createElement('span');
      riskDot.className = 'pace-risk-dot';
      if (paceRisk?.state === 'at-risk') {
        riskDot.classList.add('pace-risk-dot--warning');
        riskDot.title = `Ritmo atual: ${paceRisk.ritmoAtual} km/dia. Necessário: ${paceRisk.ritmoNecessario} km/dia (faltam ${paceRisk.kmFalt} km em ${paceRisk.daysRemaining} dias)`;
      } else if (paceRisk?.state === 'no-time-left') {
        riskDot.classList.add('pace-risk-dot--critical');
        riskDot.title = 'Campanha encerra em menos de 1 dia';
      }
      nameCell.appendChild(riskDot);

    }
    row.appendChild(nameCell);

    // Cidade (da API)
    const cityCell = document.createElement('td');
    cityCell.dataset.col = 'city';
    cityCell.textContent = driver.city || driver.address?.city || '-';
    row.appendChild(cityCell);

    // Status
    const statusCell = document.createElement('td');
    statusCell.dataset.col = 'status';
    const rawStatus =
      (driver.raw && columnStatus ? driver.raw[columnStatus] : null) ||
      driver.status ||
      '';
    if (columnStatus) {
      const select = document.createElement('select');
      select.className = 'driver-input';
      STATUS_OPTIONS.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        select.appendChild(option);
      });
      const normalizedStatus = normalizeDriverStatus(rawStatus);
      const originalStatus = String(
        (STATUS_OPTIONS.includes(normalizedStatus) && normalizedStatus) ||
        rawStatus ||
        'agendado'
      );
      if (!STATUS_OPTIONS.includes(originalStatus)) {
        const option = document.createElement('option');
        option.value = originalStatus;
        option.textContent =
          originalStatus.charAt(0).toUpperCase() + originalStatus.slice(1);
        select.appendChild(option);
      }
      select.value = originalStatus;
      select.dataset.originalValue = originalStatus;
      if (isDraftImport) {
        select.addEventListener('change', () => {
          updateImportedDraftStatus(driver.id, select.value);
          row.classList.add('pending-row');
          updateSaveButtonState();
        });
      } else {
        select.addEventListener('change', () =>
          bufferDriverChange(
            driver.id,
            columnStatus,
            select.value,
            select.dataset.originalValue,
          ),
        );
      }
      statusCell.appendChild(select);
    } else {
      const pill = document.createElement('span');
      const statusInfo = formatStatusPill(rawStatus);
      pill.className = `status ${statusInfo.className}`;
      pill.textContent = statusInfo.label;
      statusCell.appendChild(pill);
    }
    row.appendChild(statusCell);

    // KM total (da API)
    const kmTotalCell = document.createElement('td');
    kmTotalCell.dataset.col = 'km';
    const apiKm = Number(driver.kmTravelledValue) || (driver.campaignData?.totalKms ?? null);
    kmTotalCell.textContent = Number.isFinite(apiKm) && apiKm > 0
      ? formatNumber(Math.round(apiKm)) + ' km'
      : '-';
    row.appendChild(kmTotalCell);

    // Odômetro motorista
    const kmCell = document.createElement('td');
    kmCell.dataset.col = 'odoDriver';
    const odometerValue = getDriverOdometerFromApi(driver);
    kmCell.textContent = formatKmValue(odometerValue ?? null);
    row.appendChild(kmCell);

    // Odômetro gráfica
    const kmGfxCell = document.createElement('td');
    kmGfxCell.dataset.col = 'odoGraphic';
    const graphicOdometerValue = getDriverGraphicOdometerFromApi(driver);
    kmGfxCell.textContent = formatKmValue(graphicOdometerValue ?? null);
    row.appendChild(kmGfxCell);

    // Distancia comprovada pelas evidencias: leitura atual do motorista - leitura inicial da grafica.
    const odometerDistanceCell = document.createElement('td');
    odometerDistanceCell.dataset.col = 'odoDistance';
    const odometerDistance = getDriverOdometerDistance(driver);
    if (odometerDistance.inconsistent) {
      odometerDistanceCell.textContent = 'Revisar';
      odometerDistanceCell.title = 'O odometro do motorista e menor que o odometro inicial da grafica.';
    } else if (Number.isFinite(odometerDistance.value)) {
      odometerDistanceCell.textContent = `${formatKmValue(odometerDistance.value)} km`;
      odometerDistanceCell.title = `${formatKmValue(odometerDistance.driverOdometer)} - ${formatKmValue(odometerDistance.graphicOdometer)}`;
    } else {
      odometerDistanceCell.textContent = '-';
      odometerDistanceCell.title = 'Aguardando os dois odometros para calcular.';
    }
    row.appendChild(odometerDistanceCell);

    // Horario adesivagem - inicio
    const adhesionInitialCell = document.createElement('td');
    adhesionInitialCell.dataset.col = 'adhesionStart';
    const initialInput = document.createElement('input');
    initialInput.type = 'datetime-local';
    initialInput.className = 'driver-input';
    const initialValue = getDriverAdhesionField(driver, 'initial');
    initialInput.value = initialValue;
    initialInput.dataset.originalValue = initialValue;
    if (isDraftImport) {
      initialInput.disabled = true;
    } else {
      initialInput.addEventListener('change', () =>
        bufferDriverChange(
          driver.id,
          columnAdhesionInitial,
          initialInput.value,
          initialInput.dataset.originalValue,
        ),
      );
    }
    adhesionInitialCell.appendChild(initialInput);
    row.appendChild(adhesionInitialCell);

    // Horario adesivagem - retirada
    const adhesionRemovalCell = document.createElement('td');
    adhesionRemovalCell.dataset.col = 'adhesionEnd';
    const removalInput = document.createElement('input');
    removalInput.type = 'datetime-local';
    removalInput.className = 'driver-input';
    const removalValue = getDriverAdhesionField(driver, 'removal');
    removalInput.value = removalValue;
    removalInput.dataset.originalValue = removalValue;
    if (isDraftImport) {
      removalInput.disabled = true;
    } else {
      removalInput.addEventListener('change', () =>
        bufferDriverChange(
          driver.id,
          columnAdhesionRemoval,
          removalInput.value,
          removalInput.dataset.originalValue,
        ),
      );
    }
    adhesionRemovalCell.appendChild(removalInput);
    row.appendChild(adhesionRemovalCell);

    // Acoes
    const actionsCell = document.createElement('td');
    actionsCell.dataset.col = 'actions';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--ghost driver-action-delete';
    deleteButton.dataset.driverId = driver.id || '';
    deleteButton.textContent = 'Excluir';
    actionsCell.appendChild(deleteButton);
    row.appendChild(actionsCell);

    // Bloquear
    const blockCell = document.createElement('td');
    blockCell.dataset.col = 'block';
    if (!isDraftImport && driver.id) {
      const isBlocked = driverBlockedMap.get(driver.id)?.contactBlocked === true;
      const blockBtn = document.createElement('button');
      blockBtn.type = 'button';
      blockBtn.className = 'btn btn--ghost btn--sm driver-action-block' + (isBlocked ? ' is-blocked' : '');
      blockBtn.dataset.driverId = driver.id;
      blockBtn.dataset.blocked = isBlocked ? '1' : '0';
      blockBtn.textContent = isBlocked ? 'Desbloquear' : 'Bloquear';
      blockCell.appendChild(blockBtn);
    }
    row.appendChild(blockCell);

    tbody.appendChild(row);
  }

  ensureTableState(tbody.closest('table'));
  renderDriversStatusBar(sortedDrivers);
  if (driversCurrentView === 'pipeline') {
    renderDriversPipeline(sortedDrivers.filter(driver => !driver?._isDraftImport));
  }
}

// --- Driver Pipeline / Kanban ------------------------------------------------
let driversCurrentView = 'table';

const PIPELINE_COLUMNS = [
  { key: 'agendado',    label: 'Agendado' },
  { key: 'confirmado',  label: 'Confirmado' },
  { key: 'instalado',   label: 'Instalado' },
  { key: 'aguardando',  label: 'Aguardando' },
  { key: 'cadastrando', label: 'Cadastrando' },
  { key: 'problema',    label: 'Problema' },
  { key: 'revisar',     label: 'Revisar' },
];

const PIPELINE_PAN_BLOCKED_SELECTORS = 'button, a, input, select, textarea, label, [contenteditable="true"]';

function shouldStartPipelinePan(container, target) {
  if (!container || !target) return false;
  const el = target instanceof Element ? target : target.parentElement;
  if (!el) return false;
  if (container.scrollWidth <= container.clientWidth + 4) return false;
  if (el.closest('.pipeline-card')) return false;
  if (el.closest(PIPELINE_PAN_BLOCKED_SELECTORS)) return false;
  return true;
}

function setupPipelineMousePan(container) {
  if (!container || container.dataset.mousePanReady === '1') return;
  container.dataset.mousePanReady = '1';

  const state = {
    active: false,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  };

  const onMouseMove = event => {
    if (!state.active) return;
    const deltaX = event.clientX - state.startX;
    if (Math.abs(deltaX) > 2) state.moved = true;
    container.scrollLeft = state.startScrollLeft - deltaX;
    if (state.moved) event.preventDefault();
  };

  const stopPan = () => {
    if (!state.active) return;
    state.active = false;
    container.classList.remove('is-pointer-dragging');
    document.body.classList.remove('pipeline-pan-active');
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', stopPan);
  };

  container.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    if (!shouldStartPipelinePan(container, event.target)) return;

    state.active = true;
    state.moved = false;
    state.startX = event.clientX;
    state.startScrollLeft = container.scrollLeft;
    container.classList.add('is-pointer-dragging');
    document.body.classList.add('pipeline-pan-active');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopPan);
  });

  window.addEventListener('blur', stopPan);
}

function renderDriversStatusBar(drivers = []) {
  const bar = document.getElementById('driversStatusBar');
  if (!bar) return;
  bar.innerHTML = '';

  const counts = {};
  for (const { key } of PIPELINE_COLUMNS) counts[key] = 0;
  for (const driver of drivers) {
    const s = normalizeDriverStatus(
      driver?.status || (driver?.raw && findColumnKey(['status']) ? driver.raw[findColumnKey(['status'])] : null) || ''
    );
    if (s in counts) counts[s]++;
  }

  // Total chip
  const totalChip = document.createElement('span');
  totalChip.className = 'status-count-chip';
  totalChip.title = 'Total de motoristas';
  totalChip.innerHTML = `<span>Total</span><span class="chip-count">${drivers.length}</span>`;
  bar.appendChild(totalChip);

  for (const { key, label } of PIPELINE_COLUMNS) {
    const count = counts[key] || 0;
    if (!count) continue;
    const chip = document.createElement('span');
    chip.className = `status-count-chip status-${key}`;
    chip.title = `${count} motorista${count !== 1 ? 's' : ''} com status "${label}"`;
    chip.dataset.filterStatus = key;
    chip.innerHTML = `<span>${escapeHTML(label)}</span><span class="chip-count">${count}</span>`;
    bar.appendChild(chip);
  }
}

function renderDriversPipeline(drivers = []) {
  const container = document.getElementById('driversPipelineView');
  if (!container) return;
  setupPipelineMousePan(container);
  container.innerHTML = '';

  const grouped = {};
  for (const { key } of PIPELINE_COLUMNS) grouped[key] = [];

  for (const driver of drivers) {
    const s = normalizeDriverStatus(
      driver?.status || (driver?.raw && findColumnKey(['status']) ? driver.raw[findColumnKey(['status'])] : null) || ''
    );
    if (s in grouped) grouped[s].push(driver);
    else grouped['agendado'].push(driver); // fallback for unknown status
  }

  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });

  for (const { key, label } of PIPELINE_COLUMNS) {
    const cards = [...(grouped[key] || [])].sort((a, b) =>
      collator.compare(a.name || '', b.name || '')
    );

    const col = document.createElement('div');
    col.className = `pipeline-column col-${key}`;
    col.dataset.status = key;

    const head = document.createElement('div');
    head.className = 'pipeline-column-head';
    head.innerHTML = `
      <span class="pipeline-column-title">${escapeHTML(label)}</span>
      <span class="pipeline-column-count">${cards.length}</span>
    `;
    col.appendChild(head);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'pipeline-cards';
    cardsContainer.dataset.status = key;

    // Drop zone events
    cardsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardsContainer.classList.add('drag-over');
    });
    cardsContainer.addEventListener('dragleave', (e) => {
      if (!cardsContainer.contains(e.relatedTarget)) {
        cardsContainer.classList.remove('drag-over');
      }
    });
    cardsContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      cardsContainer.classList.remove('drag-over');
      const driverId = e.dataTransfer.getData('text/plain');
      if (!driverId) return;
      const newStatus = cardsContainer.dataset.status;
      const driver = (currentCampaign?.drivers || []).find(d => d.id === driverId);
      if (!driver) return;
      const colKey = findColumnKey(['status']);
      const originalStatus = normalizeDriverStatus(
        driver.status || (driver.raw && colKey ? driver.raw[colKey] : null) || ''
      );
      if (originalStatus === newStatus) return;
      // Update in memory so the re-render is immediate
      driver.status = newStatus;
      if (colKey) {
        driver.raw = driver.raw || {};
        driver.raw[colKey] = newStatus;
      }
      bufferDriverChange(driverId, colKey, newStatus, originalStatus);
      renderDriversPipeline(currentCampaign.drivers);
    });

    if (!cards.length) {
      const empty = document.createElement('span');
      empty.className = 'pipeline-column-empty';
      empty.textContent = 'Sem motoristas';
      cardsContainer.appendChild(empty);
    } else {
      for (const driver of cards) {
        cardsContainer.appendChild(buildPipelineCard(driver));
      }
    }

    col.appendChild(cardsContainer);
    container.appendChild(col);
  }
}

function buildPipelineCard(driver) {
  const card = document.createElement('div');
  card.className = 'pipeline-card';
  card.dataset.driverId = driver.id || '';
  card.title = 'Arraste para mudar o status ou clique para ver detalhes';
  card.draggable = true;

  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', driver.id || '');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  const odometerValue = getDriverOdometerFromApi(driver);
  const kmText = formatKmValue(odometerValue ?? null);

  const adhColumnKey = findColumnKey(['aderencia', 'aderência']);
  const rawAdh = (driver.raw && adhColumnKey ? driver.raw[adhColumnKey] : null) || driver.adh || '';
  const adhNum = parseNumeric(rawAdh);
  let adhClass = '';
  let adhText = rawAdh ? String(rawAdh) : '';
  if (adhNum > 0) {
    adhClass = adhNum >= 80 ? 'adh-ok' : adhNum >= 50 ? 'adh-warn' : 'adh-bad';
    adhText = `${Math.round(adhNum)}%`;
  }

  const initialVal = getDriverAdhesionField(driver, 'initial');
  const schedText = initialVal
    ? `Data: ${new Date(initialVal).toLocaleDateString('pt-BR')}`
    : '';

  const metaParts = [];
  if (driver.city) metaParts.push(escapeHTML(driver.city));
  if (driver.plate) metaParts.push(escapeHTML(driver.plate));
  if (driver.ratingApp) metaParts.push(`★ ${driver.ratingApp}`);

  // KM total da API (priorizar sobre odômetro)
  const apiKm = Number(driver.kmTravelledValue) || (driver.campaignData?.totalKms ?? 0);
  const kmDisplay = apiKm > 0
    ? `${formatNumber(Math.round(apiKm))} km`
    : (kmText && kmText !== '-' ? kmText : '');

  let html = `<div class="pipeline-card-name">${escapeHTML(driver.name || '-')}</div>`;
  if (metaParts.length) {
    html += `<div class="pipeline-card-meta">${metaParts.join(' · ')}</div>`;
  }
  if (kmDisplay) {
    html += `<div class="pipeline-card-km">KM: ${escapeHTML(kmDisplay)}</div>`;
  }
  if (adhText) {
    html += `<div class="pipeline-card-adh ${adhClass}">Aderência: ${escapeHTML(adhText)}</div>`;
  }
  if (schedText) {
    html += `<div class="pipeline-card-sched">${escapeHTML(schedText)}</div>`;
  }

  card.innerHTML = html;
  card.addEventListener('click', () => {
    if (driver.id) openDriverDetail(driver.id);
  });
  return card;
}

function setDriversView(view) {
  driversCurrentView = view;
  const tableView = document.getElementById('driversTableView');
  const pipelineView = document.getElementById('driversPipelineView');
  const toggleBtns = document.querySelectorAll('#driversViewToggle .view-toggle-btn');

  if (tableView) tableView.style.display = view === 'table' ? '' : 'none';
  if (pipelineView) pipelineView.style.display = view === 'pipeline' ? '' : 'none';
  if (view !== 'pipeline') document.body.classList.remove('pipeline-pan-active');
  toggleBtns.forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === view));

  if (view === 'pipeline' && currentCampaign?.drivers) {
    renderDriversPipeline(currentCampaign.drivers);
  }
}

function updateGraphicCountBadge(count) {
  if (!graphicCountBadge) return;
  const total = Number(count) || 0;
  graphicCountBadge.textContent = total === 1 ? '1 gráfica' : `${total} gráficas`;
}

function formatGraphicContact(name, phone) {
  const parts = [];
  if (trim(name)) parts.push(`<div>${escapeHTML(trim(name))}</div>`);
  if (trim(phone)) parts.push(`<div class="small muted">${escapeHTML(trim(phone))}</div>`);
  return parts.length ? parts.join('') : '-';
}

function renderGraphics(graphics = []) {
  if (!tblGraphics) return;
  const table = tblGraphics.closest('table');
  tblGraphics.innerHTML = '';

  const list = Array.isArray(graphics) ? [...graphics] : [];
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  list.sort((a, b) => collator.compare(a?.name || '', b?.name || ''));

  currentCampaign = currentCampaign || {};
  currentCampaign.graphics = list;

  for (const graphic of list) {
    const row = document.createElement('tr');
    row.dataset.graphicId = graphic.id || '';
    const notesHtml = trim(graphic.notes)
      ? `<p class="small muted">${escapeHTML(graphic.notes)}</p>`
      : '';
    const emailHtml = trim(graphic.email)
      ? `<a href="mailto:${escapeHTML(graphic.email)}">${escapeHTML(graphic.email)}</a>`
      : '-';
    const phoneHtml = trim(graphic.phone) ? escapeHTML(graphic.phone) : '-';

    row.innerHTML = `
      <td>
        <div class="strong graphic-name-link" data-graphic-id="${escapeHTML(graphic.id || '')}" title="Clique para configurar a agenda">${escapeHTML(graphic.name || '')}</div>
        ${notesHtml}
      </td>
      <td>${emailHtml}</td>
      <td>${phoneHtml}</td>
      <td>${formatGraphicContact(graphic.responsible1Name, graphic.responsible1Phone)}</td>
      <td>${formatGraphicContact(graphic.responsible2Name, graphic.responsible2Phone)}</td>
      <td class="actions">
        <button type="button" class="btn btn--small graphic-edit" data-graphic-id="${escapeHTML(graphic.id || '')}">Editar</button>
        <button type="button" class="btn btn--small btn--danger graphic-delete" data-graphic-id="${escapeHTML(graphic.id || '')}">Remover</button>
      </td>
    `;
    tblGraphics.appendChild(row);
  }

  // Make graphic names clickable → open scheduling modal
  tblGraphics.querySelectorAll('.graphic-name-link').forEach(el => {
    el.addEventListener('click', () => {
      const gId = el.dataset.graphicId;
      const graphic = list.find(g => g.id === gId);
      if (graphic) openScheduleModal(graphic);
    });
  });

  ensureTableState(table);
  updateGraphicCountBadge(list.length);
}

// ════════════════════════════════════════════════════════
//  SCHEDULING — Agenda da Gráfica (modal no Gerenciador)
// ════════════════════════════════════════════════════════

const scheduleModal       = document.getElementById('graphicScheduleModal');
const scheduleModalTitle  = document.getElementById('scheduleModalTitle');
const scheduleModalClose  = document.getElementById('scheduleModalClose');
const scheduleModalDone   = document.getElementById('scheduleModalDone');
const scheduleTimeRanges  = document.getElementById('scheduleTimeRanges');
const scheduleAddRange    = document.getElementById('scheduleAddRange');
const scheduleGenerate    = document.getElementById('scheduleGenerateSlots');
const scheduleGenStatus   = document.getElementById('scheduleGenerateStatus');
const btnNotifySchedule   = document.getElementById('btnNotifyScheduleCreated');
const scheduleConfigsList = document.getElementById('scheduleConfigsList');
const scheduleSlotsGrid   = document.getElementById('scheduleSlotsGrid');
const scheduleSlotsMeta   = document.getElementById('scheduleSlotsMeta');
const scheduleViewType    = document.getElementById('scheduleViewType');
const scheduleViewDate    = document.getElementById('scheduleViewDate');
const scheduleViewAllDates = document.getElementById('scheduleViewAllDates');
const scheduleViewRefresh = document.getElementById('scheduleViewRefresh');

let _scheduleGraphic = null;

function formatScheduleDateBR(dateISO, withWeekday = false) {
  const value = String(dateISO || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value || '-';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value || '-';
  const base = date.toLocaleDateString('pt-BR');
  if (!withWeekday) return base;
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${weekday}, ${base}`;
}

function getScheduleTypeLabel(type) {
  return type === 'installation' ? 'Instalação' : 'Retirada';
}

function getScheduleStatusLabel(status) {
  if (status === 'available') return 'Disponível';
  if (status === 'booked') return 'Reservado';
  return 'Cancelado';
}

function syncScheduleDateFilterState() {
  if (!scheduleViewDate) return;
  const allDates = Boolean(scheduleViewAllDates?.checked);
  scheduleViewDate.disabled = allDates;
}

function renderScheduleSlotsMeta(slots, opts = {}) {
  if (!scheduleSlotsMeta) return;
  const total = slots.length;
  if (!total) {
    scheduleSlotsMeta.innerHTML = '';
    return;
  }

  const available = slots.filter(s => s.status === 'available').length;
  const booked = slots.filter(s => s.status === 'booked').length;
  const cancelled = total - available - booked;
  const scopeLabel = opts.allDates
    ? 'Período completo'
    : (opts.date ? `Data: ${formatScheduleDateBR(opts.date)}` : 'Sem filtro de data');

  scheduleSlotsMeta.innerHTML = `
    <span class="schedule-meta-pill schedule-meta-pill--total">${escapeHTML(scopeLabel)} - ${total} horário(s)</span>
    <span class="schedule-meta-pill schedule-meta-pill--available">Disponíveis: ${available}</span>
    <span class="schedule-meta-pill schedule-meta-pill--booked">Reservados: ${booked}</span>
    <span class="schedule-meta-pill schedule-meta-pill--cancelled">Cancelados: ${cancelled}</span>
  `;
}

function renderScheduleSlotsGrouped(slots = []) {
  if (!scheduleSlotsGrid) return;
  scheduleSlotsGrid.innerHTML = '';

  const grouped = new Map();
  for (const slot of slots) {
    const key = String(slot.date || '').trim() || 'sem-data';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(slot);
  }

  const fragment = document.createDocumentFragment();
  for (const [dateKey, daySlots] of grouped.entries()) {
    const available = daySlots.filter(s => s.status === 'available').length;
    const booked = daySlots.filter(s => s.status === 'booked').length;
    const cancelled = daySlots.length - available - booked;
    const dayLabel = dateKey === 'sem-data' ? 'Data não informada' : formatScheduleDateBR(dateKey, true);

    const dayCard = document.createElement('section');
    dayCard.className = 'schedule-slots-day';
    dayCard.innerHTML = `
      <header class="schedule-slots-day-head">
        <div class="schedule-slots-day-title">${escapeHTML(dayLabel)}</div>
        <div class="schedule-slots-meta">
          <span class="schedule-meta-pill schedule-meta-pill--available">${available} disponível(is)</span>
          <span class="schedule-meta-pill schedule-meta-pill--booked">${booked} reservado(s)</span>
          <span class="schedule-meta-pill schedule-meta-pill--cancelled">${cancelled} cancelado(s)</span>
        </div>
      </header>
    `;

    const list = document.createElement('div');
    list.className = 'schedule-slots-day-list';
    for (const slot of daySlots) {
      const cls = slot.status === 'available' ? 'is-available'
        : slot.status === 'booked' ? 'is-booked'
        : 'is-cancelled';
      const driverText = slot.bookedByName
        ? escapeHTML(slot.bookedByName)
        : (slot.status === 'available' ? 'Livre para reserva' : 'Sem motorista');
      const statusText = getScheduleStatusLabel(slot.status);

      const item = document.createElement('article');
      item.className = `schedule-slot ${cls}`;
      item.innerHTML = `
        <div class="slot-time">${escapeHTML(slot.startTime)}-${escapeHTML(slot.endTime)}</div>
        <div class="slot-driver">${driverText}</div>
        <div class="slot-status">${statusText}</div>
      `;
      list.appendChild(item);
    }

    dayCard.appendChild(list);
    fragment.appendChild(dayCard);
  }

  scheduleSlotsGrid.appendChild(fragment);
}

function openScheduleModal(graphic) {
  if (!scheduleModal || !graphic) return;
  _scheduleGraphic = graphic;
  scheduleModalTitle.textContent = `Agenda — ${graphic.name || 'Gráfica'}`;
  // Set default date to today
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('scheduleDateStart').value = today;
  document.getElementById('scheduleDateEnd').value = today;
  scheduleViewDate.value = today;
  if (scheduleViewAllDates) scheduleViewAllDates.checked = true;
  syncScheduleDateFilterState();
  if (scheduleGenStatus) scheduleGenStatus.textContent = '';
  if (scheduleSlotsMeta) scheduleSlotsMeta.innerHTML = '';
  if (btnNotifySchedule) btnNotifySchedule.style.display = 'none';
  loadScheduleConfigs();
  loadScheduleSlots();
  scheduleModal.showModal();
}

function closeScheduleModal() {
  if (scheduleModal) scheduleModal.close();
  _scheduleGraphic = null;
}

if (scheduleModalClose) scheduleModalClose.addEventListener('click', closeScheduleModal);
if (scheduleModalDone) scheduleModalDone.addEventListener('click', closeScheduleModal);

// -- Add/remove time ranges --
if (scheduleAddRange) {
  scheduleAddRange.addEventListener('click', () => {
    const div = document.createElement('div');
    div.className = 'schedule-time-range';
    div.innerHTML = `
      <input type="time" class="input range-start" value="14:00">
      <span class="schedule-range-separator">até</span>
      <input type="time" class="input range-end" value="18:00">
      <button type="button" class="btn btn--small btn--danger schedule-remove-range" title="Remover faixa">&times;</button>
    `;
    scheduleTimeRanges.appendChild(div);
  });
}
if (scheduleTimeRanges) {
  scheduleTimeRanges.addEventListener('click', (e) => {
    if (e.target.classList.contains('schedule-remove-range')) {
      const row = e.target.closest('.schedule-time-range');
      if (scheduleTimeRanges.children.length > 1) row.remove();
    }
  });
}

// -- Generate slots --
if (scheduleGenerate) {
  scheduleGenerate.addEventListener('click', async () => {
    if (!_scheduleGraphic || !campaignId) return;
    const type = document.getElementById('scheduleType').value;
    const dateStart = document.getElementById('scheduleDateStart').value;
    const dateEnd = document.getElementById('scheduleDateEnd').value;
    const slotDurationMinutes = Number(document.getElementById('scheduleSlotDuration').value);
    const timeRanges = [];

    scheduleTimeRanges.querySelectorAll('.schedule-time-range').forEach(row => {
      const start = row.querySelector('.range-start')?.value;
      const end = row.querySelector('.range-end')?.value;
      if (start && end) timeRanges.push({ start, end });
    });

    if (!dateStart || !dateEnd || !timeRanges.length) {
      if (scheduleGenStatus) scheduleGenStatus.textContent = 'Preencha as datas e pelo menos uma faixa de horário.';
      return;
    }

    scheduleGenerate.disabled = true;
    if (scheduleGenStatus) scheduleGenStatus.textContent = 'Gerando...';

    try {
      const res = await authFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/graphics/${encodeURIComponent(_scheduleGraphic.id)}/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, dateStart, dateEnd, slotDurationMinutes, timeRanges }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar horários');
      if (scheduleGenStatus) scheduleGenStatus.textContent = `✅ ${data.slotsGenerated} horários gerados!`;
      if (btnNotifySchedule) btnNotifySchedule.style.display = '';
      loadScheduleConfigs();
      loadScheduleSlots();
    } catch (err) {
      if (scheduleGenStatus) scheduleGenStatus.textContent = `❌ ${err.message}`;
    } finally {
      scheduleGenerate.disabled = false;
    }
  });
}

// -- Notify drivers after schedule creation --
if (btnNotifySchedule) {
  btnNotifySchedule.addEventListener('click', () => {
    const drivers = (currentCampaign?.drivers || [])
      .filter(d => d.phone && String(d.phone).replace(/\D/g, '').length >= 10)
      .map(d => ({
        id: d.id,
        name: d.name || 'Motorista',
        phone: d.phone,
        reasons: ['Horários disponíveis para adesivagem'],
      }));
    if (!drivers.length) return alert('Nenhum motorista com telefone cadastrado nesta campanha.');
    closeScheduleModal();
    openDispatchModal(drivers);
  });
}

// -- Load existing configs --
async function loadScheduleConfigs() {
  if (!scheduleConfigsList || !_scheduleGraphic || !campaignId) return;
  scheduleConfigsList.innerHTML = '<p class="small muted">Carregando...</p>';

  try {
    const res = await authFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/graphics/${encodeURIComponent(_scheduleGraphic.id)}/configs`);
    const data = await res.json();
    const configs = data.configs || [];

    if (!configs.length) {
      scheduleConfigsList.innerHTML = '<p class="small muted">Nenhum bloco de horário configurado.</p>';
      return;
    }

    scheduleConfigsList.innerHTML = '';
    for (const cfg of configs) {
      const card = document.createElement('div');
      card.className = 'schedule-config-card';
      const typeLabel = getScheduleTypeLabel(cfg.type);
      const rangesStr = (cfg.timeRanges || []).map(r => `${r.start}-${r.end}`).join(', ') || '-';
      const dateStartBR = formatScheduleDateBR(cfg.dateStart);
      const dateEndBR = formatScheduleDateBR(cfg.dateEnd);
      card.innerHTML = `
        <div class="config-info">
          <div class="config-title">${typeLabel}</div>
          <div class="config-sub">${dateStartBR} a ${dateEndBR}</div>
          <div class="config-sub">Intervalo: ${cfg.slotDurationMinutes} min | Faixas: ${rangesStr}</div>
        </div>
        <div class="config-actions">
          <button type="button" class="btn btn--small btn--danger" data-config-id="${cfg._id}">Excluir</button>
        </div>
      `;
      card.querySelector('[data-config-id]').addEventListener('click', async (e) => {
        if (!confirm('Excluir este bloco e todos os horários livres? Reservas existentes serão canceladas.')) return;
        const btn = e.target;
        btn.disabled = true;
        try {
          await authFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/graphics/${encodeURIComponent(_scheduleGraphic.id)}/configs/${cfg._id}`, { method: 'DELETE' });
          loadScheduleConfigs();
          loadScheduleSlots();
        } catch (err) {
          alert('Erro ao excluir: ' + err.message);
        } finally {
          btn.disabled = false;
        }
      });
      scheduleConfigsList.appendChild(card);
    }
  } catch (err) {
    scheduleConfigsList.innerHTML = `<p class="small muted">Erro ao carregar: ${escapeHTML(err.message)}</p>`;
  }
}

// -- Load slots grid --
async function loadScheduleSlots() {
  if (!scheduleSlotsGrid || !_scheduleGraphic || !campaignId) return;
  scheduleSlotsGrid.innerHTML = '<p class="small muted">Carregando...</p>';
  if (scheduleSlotsMeta) scheduleSlotsMeta.innerHTML = '';

  const type = scheduleViewType?.value || 'installation';
  const date = scheduleViewDate?.value || '';
  const allDates = Boolean(scheduleViewAllDates?.checked);

  try {
    let url = `/api/scheduling/${encodeURIComponent(campaignId)}/graphics/${encodeURIComponent(_scheduleGraphic.id)}/slots?type=${type}`;
    if (!allDates && date) url += `&date=${date}`;
    const res = await authFetch(url);
    const data = await res.json();
    const slots = data.slots || [];

    if (!slots.length) {
      scheduleSlotsGrid.innerHTML = allDates
        ? '<p class="small muted">Nenhum horário encontrado para o período selecionado.</p>'
        : '<p class="small muted">Nenhum horário encontrado para a data selecionada.</p>';
      return;
    }

    renderScheduleSlotsMeta(slots, { allDates, date });
    renderScheduleSlotsGrouped(slots);
  } catch (err) {
    scheduleSlotsGrid.innerHTML = `<p class="small muted">Erro: ${escapeHTML(err.message)}</p>`;
  }
}

if (scheduleViewRefresh) {
  scheduleViewRefresh.addEventListener('click', loadScheduleSlots);
}
if (scheduleViewType) {
  scheduleViewType.addEventListener('change', loadScheduleSlots);
}
if (scheduleViewDate) {
  scheduleViewDate.addEventListener('change', loadScheduleSlots);
}
if (scheduleViewAllDates) {
  scheduleViewAllDates.addEventListener('change', () => {
    syncScheduleDateFilterState();
    loadScheduleSlots();
  });
}

// ---------------- Acompanhe (admin) ----------------
async function fetchCampaignEvidence(campaignId) {
  if (!campaignId) return [];
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/evidence`);
    if (!res.ok) throw new Error('Falha ao buscar evidencias');
    const data = await res.json();
    return Array.isArray(data.evidence) ? data.evidence : [];
  } catch (err) {
    console.warn('fetchCampaignEvidence error', err);
    return [];
  }
}

async function fetchDriverEvidence(campaignId, driverId) {
  if (!campaignId || !driverId) return [];
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/evidence/driver/${encodeURIComponent(driverId)}`);
    if (!res.ok) throw new Error('Falha ao buscar evidencias do motorista');
    const data = await res.json();
    return Array.isArray(data.evidence) ? data.evidence : [];
  } catch (err) {
    console.warn('fetchDriverEvidence error', err);
    return [];
  }
}

async function fetchGraphicEvidence(campaignId, graphicId) {
  if (!campaignId || !graphicId) return [];
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/evidence/graphic/${encodeURIComponent(graphicId)}`);
    if (!res.ok) throw new Error('Falha ao buscar evidencias da gráfica');
    const data = await res.json();
    return Array.isArray(data.evidence) ? data.evidence : [];
  } catch (err) {
    console.warn('fetchGraphicEvidence error', err);
    return [];
  }
}

async function fetchGraphicDriverEvidence(campaignId, graphicId, driverId) {
  if (!campaignId || !graphicId || !driverId) return [];
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/evidence/graphic/${encodeURIComponent(graphicId)}/driver/${encodeURIComponent(driverId)}`);
    if (!res.ok) throw new Error('Falha ao buscar evidencias da gráfica para o motorista');
    const data = await res.json();
    return Array.isArray(data.evidence) ? data.evidence : [];
  } catch (err) {
    console.warn('fetchGraphicDriverEvidence error', err);
    return [];
  }
}

async function fetchGraphicStorageTree(campaignIdValue, driverIdValue, graphicIdValue = null) {
  if (!campaignIdValue || !driverIdValue) return null;
  try {
    const qs = graphicIdValue ? `?graphicId=${encodeURIComponent(graphicIdValue)}` : '';
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignIdValue)}/storage/graphic/${encodeURIComponent(driverIdValue)}${qs}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data?.storage || null;
  } catch (err) {
    console.warn('fetchGraphicStorageTree error', err);
    return null;
  }
}
async function fetchDriverStorageTree(campaignIdValue, driverIdValue) {
  if (!campaignIdValue || !driverIdValue) return null;
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignIdValue)}/storage/driver/${encodeURIComponent(driverIdValue)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data?.storage || null;
  } catch (err) {
    console.warn('fetchDriverStorageTree error', err);
    return null;
  }
}

async function collectEvidenceSnapshot({ driverId, graphicId = null, driverTree = null, graphicTree = null } = {}) {
  const snapshot = { driverItems: [], graphicItems: [] };
  if (!driverId) return snapshot;

  try {
    const tree = driverTree || await fetchDriverStorageTree(campaignId, driverId);
    if (tree && Array.isArray(tree.folders) && tree.folders.length) {
      snapshot.driverItems = flattenStorageFiles(tree);
    }
  } catch (err) { console.warn('collectEvidenceSnapshot driver tree', err); }
  if (!snapshot.driverItems.length) {
    try {
      const legacy = await fetchDriverEvidence(campaignId, driverId);
      if (legacy?.length) snapshot.driverItems = legacy;
    } catch (err) { console.warn('collectEvidenceSnapshot driver evidence', err); }
  }

  try {
    // Pass graphicId so the tree is scoped to the specific graphic's uploads
    const gTree = graphicTree || await fetchGraphicStorageTree(campaignId, driverId, graphicId);
    if (gTree && Array.isArray(gTree.folders) && gTree.folders.length) {
      snapshot.graphicItems = flattenStorageFiles(gTree);
    }
  } catch (err) { console.warn('collectEvidenceSnapshot graphic tree', err); }
  if (!snapshot.graphicItems.length && graphicId) {
    try {
      const legacyG = await fetchGraphicDriverEvidence(campaignId, graphicId, driverId);
      if (legacyG?.length) snapshot.graphicItems = legacyG;
    } catch (err) { console.warn('collectEvidenceSnapshot graphic evidence', err); }
  }

  return snapshot;
}

function clearAcompanheGallery() {
  if (!acompanheGalleryGrid) return;
  cleanupGalleryObjectUrls();
  acompanheGalleryGrid.classList.remove('is-explorer');
  acompanheGalleryGrid.innerHTML = '';
  currentStorageTree = null;
}

function renderGalleryItems(items = [], { type = 'driver', driver = null } = {}) {
  if (!acompanheGalleryGrid) return;
  cleanupGalleryObjectUrls();
  acompanheGalleryGrid.classList.remove('is-explorer');
  acompanheGalleryGrid.innerHTML = '';
  
  // Filter out items without renderable images
  const list = Array.isArray(items) ? items.filter(it => it && (it.url || it.photoData)) : [];
  
  if (list.length === 0) {
    acompanheGalleryGrid.classList.add('is-explorer');
    acompanheGalleryGrid.innerHTML = '<div class="storage-empty">Nenhuma evidência encontrada para este motorista.</div>';
    return;
  }

  // Show loading overlay while images load
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'gallery-loading-overlay';
  loadingOverlay.innerHTML = '<div class="spinner" style="width:24px;height:24px;border-width:3px;"></div><span>Carregando imagens...</span>';
  acompanheGalleryGrid.appendChild(loadingOverlay);

  const cardContainer = document.createElement('div');
  cardContainer.className = 'gallery-grid';
  cardContainer.style.display = 'none';
  acompanheGalleryGrid.classList.add('is-explorer');
  acompanheGalleryGrid.appendChild(cardContainer);

  let totalImages = list.length;
  let loadedCount = 0;
  let failedCount = 0;

  function checkAllLoaded() {
    if (loadedCount + failedCount >= totalImages) {
      loadingOverlay.remove();
      acompanheGalleryGrid.classList.remove('is-explorer');
      cardContainer.style.display = '';
      cardContainer.className = '';
      // Move children into parent grid
      while (cardContainer.firstChild) {
        acompanheGalleryGrid.appendChild(cardContainer.firstChild);
      }
      cardContainer.remove();
    }
  }

  // Safety timeout: remove loading overlay after 30s even if images didn't finish
  setTimeout(() => {
    if (loadingOverlay.parentNode) {
      console.warn('[gallery] Safety timeout: forcing loading overlay removal');
      loadingOverlay.remove();
      acompanheGalleryGrid.classList.remove('is-explorer');
      cardContainer.style.display = '';
      cardContainer.className = '';
      while (cardContainer.firstChild) {
        acompanheGalleryGrid.appendChild(cardContainer.firstChild);
      }
      cardContainer.remove();
    }
  }, 30000);

  for (const it of list) {
    const card = document.createElement('div');
    card.className = 'thumb-card';
    card.style.position = 'relative';
    
    const link = document.createElement('a');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'block';

    const img = document.createElement('img');
    img.alt = it.step || '';
    img.style.width = '100%';
    img.style.height = '120px';
    img.style.objectFit = 'cover';
    link.appendChild(img);
    card.appendChild(link);

    (async () => {
      try {
        if (it.photoData && typeof it.photoData === 'string' && it.photoData.startsWith('data:image')) {
          img.src = it.photoData;
          link.href = it.photoData;
          img.onload = () => { loadedCount++; checkAllLoaded(); };
          img.onerror = () => { failedCount++; card.remove(); checkAllLoaded(); };
          return;
        }

        const src = it.url || '';
        if (!src) {
          failedCount++; card.remove(); checkAllLoaded();
          return;
        }

        if (typeof src === 'string' && src.startsWith('/api/storage/')) {
          const res = await authFetch(src);
          if (!res.ok) throw new Error('Imagem não autorizada ou indisponível');
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          registerGalleryObjectUrl(blobUrl);
          img.src = blobUrl;
          link.href = blobUrl;
          img.dataset.blobUrl = blobUrl;
          link.dataset.blobUrl = blobUrl;
          img.onload = () => { loadedCount++; checkAllLoaded(); };
          img.onerror = () => { revokeGalleryObjectUrl(blobUrl); failedCount++; card.remove(); checkAllLoaded(); };
          return;
        }

        img.src = src;
        link.href = src;
        img.onload = () => { loadedCount++; checkAllLoaded(); };
        img.onerror = () => { failedCount++; card.remove(); checkAllLoaded(); };
      } catch (err) {
        console.warn('Erro ao carregar imagem protegida', err);
        if (img?.dataset?.blobUrl) revokeGalleryObjectUrl(img.dataset.blobUrl);
        failedCount++; card.remove(); checkAllLoaded();
      }
    })();
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'evidence-delete-btn';
    deleteBtn.innerHTML = 'Excluir';
    deleteBtn.title = 'Deletar imagem';
    deleteBtn.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(255,0,0,0.8);color:white;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;z-index:10;';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog('Tem certeza que deseja deletar esta imagem? Esta ação não pode ser desfeita.', {
          title: 'Deletar imagem',
          confirmLabel: 'Deletar',
          cancelLabel: 'Cancelar',
          tone: 'danger',
        });
        if (!ok) return;
        try {
          deleteBtn.disabled = true;
        deleteBtn.textContent = '...';
        // Use correct endpoint based on source: mongo (storage_files) or local (evidence)
        const endpoint = it.source === 'mongo'
          ? `/api/campaigns/${encodeURIComponent(campaignId)}/storage/${encodeURIComponent(it.id)}`
          : `/api/campaigns/${encodeURIComponent(campaignId)}/evidence/${encodeURIComponent(it.id)}`;
        const res = await authFetch(endpoint, {
          method: 'DELETE'
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        if (img?.dataset?.blobUrl) revokeGalleryObjectUrl(img.dataset.blobUrl);
        card.remove();
        // Atualiza status do driver/gráfica após deletar
        const currentDriver = driver || selectedDriverData || null;
        if (currentDriver) {
          const idx = list.indexOf(it);
          if (idx >= 0) list.splice(idx, 1);
          updateDriverEvidenceFromItems(currentDriver, list, type === 'graphic' ? 'graphic' : 'driver');
        }
        // Check if gallery is now empty after delete
        setTimeout(() => {
          if (acompanheGalleryGrid && acompanheGalleryGrid.children.length === 0) {
            acompanheGalleryGrid.classList.add('is-explorer');
            acompanheGalleryGrid.innerHTML = '<div class="storage-empty">Nenhuma evidência encontrada para este motorista.</div>';
          }
        }, 50);
        alert('Imagem deletada com sucesso.');
      } catch (err) {
        console.error('Erro ao deletar imagem:', err);
        alert('Não foi possível deletar a imagem.');
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = 'Excluir';
      }
    });
    
    const meta = document.createElement('div');
    meta.className = 'thumb-meta small muted';
    const when = it.createdAt ? new Date(it.createdAt).toLocaleString() : '';
    meta.textContent = `${it.step || ''} ${when ? ' · ' + when : ''}`;
    card.appendChild(img);
    card.appendChild(deleteBtn);
    card.appendChild(meta);
    cardContainer.appendChild(card);
  }
}

function renderGraphicStorageLoading(message = 'Carregando galeria...') {
  if (!acompanheGalleryGrid) return;
  acompanheGalleryGrid.classList.add('is-explorer');
  acompanheGalleryGrid.innerHTML = `
    <div class="storage-loading">
      <div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>
      <span>${escapeHTML(message)}</span>
    </div>`;
}

function renderGraphicStorageExplorer(
  tree = {},
  { driver, headingText = "Arquivos enviados pela gr&aacute;fica", emptyMessage, uploaderType = null, graphicId = null } = {}
) {
  if (!acompanheGalleryGrid) return;
  cleanupGalleryObjectUrls();
  acompanheGalleryGrid.classList.add('is-explorer');
  acompanheGalleryGrid.innerHTML = '';

  const mode = getAcompanheMode();

  const folders = Array.isArray(tree.folders) ? tree.folders : [];
  const driverName = driver?.name || tree.driverName || '';
  const normalizedHeading = String(headingText || '')
    .replace(/&[aA]acute;/g, 'a')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const resolvedUploaderType = (uploaderType || tree.uploaderType || '')
    .toString()
    .trim()
    .toLowerCase();
  const type = mode === 'graphic'
    ? 'graphic'
    : (resolvedUploaderType === 'graphic'
      ? 'graphic'
      : (normalizedHeading.includes('grafica') ? 'graphic' : 'driver'));
  const noDataMessage = emptyMessage || (type === 'graphic'
    ? 'Nenhuma imagem enviada pela gr&aacute;fica para este motorista.'
    : 'Nenhuma imagem enviada para este motorista.');
  if (!folders.length) {
    acompanheGalleryGrid.innerHTML = `<div class="storage-empty">${noDataMessage}</div>`;
    currentStorageTree = { ...tree, uploaderType: type, folders: [] };
    return;
  }

  const selectedName = folders.some(f => f.name === tree.selectedDate)
    ? tree.selectedDate
    : folders[0].name;
  const selectedFolder = folders.find(f => f.name === selectedName) || folders[0];
  currentStorageTree = { ...tree, selectedDate: selectedName, driverName, uploaderType: type };

  const explorer = document.createElement('div');
  explorer.className = 'storage-explorer';

  const heading = document.createElement('div');
  heading.className = 'storage-heading';
  heading.innerHTML = `
    <h3 class="m0">${headingText}</h3>
    ${driverName ? `<p class="small muted">Motorista: ${escapeHTML(driverName)}</p>` : ''}
  `;
  explorer.appendChild(heading);

  const folderList = document.createElement('div');
  folderList.className = 'storage-folder-list';
    folders.forEach(folder => {
      const folderItem = document.createElement('div');
      folderItem.style.cssText = 'display:flex;align-items:center;gap:4px;';
      
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `storage-folder-button${folder.name === selectedName ? ' active' : ''}`;
      button.style.flex = '1';
      button.innerHTML = `<span class="folder-icon">&#128193;</span>${escapeHTML(formatStorageDateFolder(folder.name))}`;
      button.addEventListener('click', () => {
        renderGraphicStorageExplorer(
          { ...tree, selectedDate: folder.name },
          { driver, headingText, uploaderType: type, graphicId }
        );
      });
    
    // Add delete folder button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Excluir';
    deleteBtn.title = 'Deletar toda a pasta';
    deleteBtn.style.cssText = 'background:rgba(255,0,0,0.8);color:white;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fileCount = folder.files?.length || 0;
      const ok = await confirmDialog(`Deletar toda a pasta "${formatStorageDateFolder(folder.name)}" com ${fileCount} arquivo(s)? Esta ação não pode ser desfeita.`, {
        title: 'Deletar pasta',
        confirmLabel: 'Deletar',
        cancelLabel: 'Cancelar',
        tone: 'danger',
      });
      if (!ok) return;
      
      deleteBtn.disabled = true;
      deleteBtn.textContent = '...';
      
      try {
        const uploaderType = type;
        const response = await authFetch(
          `/api/campaigns/${campaignId}/storage/folder/${driver.id}/${encodeURIComponent(folder.name)}?uploaderType=${uploaderType}`,
          { method: 'DELETE' }
        );
        
        if (response.ok) {
          const result = await response.json();
          alert(`${result.deletedCount} arquivo(s) deletado(s) com sucesso!`);
          // Reload storage tree and atualizar status
          const updatedTree = uploaderType === 'graphic'
            ? await fetchGraphicStorageTree(campaignId, driver.id, graphicId)
            : await fetchDriverStorageTree(campaignId, driver.id);
          if (updatedTree) {
            renderGraphicStorageExplorer(updatedTree, { driver, headingText, uploaderType, graphicId });
            let itemsForStatus = flattenStorageFiles(updatedTree);
            if (uploaderType !== 'graphic') {
              try {
                const legacy = await fetchDriverEvidence(campaignId, driver.id);
                if (legacy?.length) itemsForStatus = itemsForStatus.concat(legacy);
              } catch (err) {
                console.warn('fetchDriverEvidence merge (folder delete)', err);
              }
            }
            updateDriverEvidenceFromItems(driver, itemsForStatus, uploaderType === 'graphic' ? 'graphic' : 'driver');
          }
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Erro ao deletar pasta');
        }
      } catch (err) {
        console.error('Delete folder error:', err);
        alert('Erro ao deletar pasta: ' + err.message);
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Excluir';
      }
    });
    
    folderItem.appendChild(button);
    folderItem.appendChild(deleteBtn);
    folderList.appendChild(folderItem);
  });
  explorer.appendChild(folderList);

  const fileGrid = document.createElement('div');
  fileGrid.className = 'storage-file-grid';
  const files = Array.isArray(selectedFolder?.files) ? selectedFolder.files : [];
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'storage-empty';
    empty.textContent = 'Nenhuma imagem enviada nesta data.';
    fileGrid.appendChild(empty);
  } else {
    // Loading overlay for storage explorer images
    const storageLoadingOverlay = document.createElement('div');
    storageLoadingOverlay.className = 'gallery-loading-overlay';
    storageLoadingOverlay.innerHTML = '<div class="spinner" style="width:24px;height:24px;border-width:3px;"></div><span>Carregando imagens...</span>';
    fileGrid.appendChild(storageLoadingOverlay);

    let storageTotal = files.length;
    let storageLoaded = 0;
    let storageFailed = 0;

    function checkStorageLoaded() {
      if (storageLoaded + storageFailed >= storageTotal) {
        storageLoadingOverlay.remove();
        // Show all cards at once
        fileGrid.querySelectorAll('.storage-file-card').forEach(c => c.style.display = '');
      }
    }

    // Safety timeout: remove loading overlay after 30s even if images didn't finish
    setTimeout(() => {
      if (storageLoadingOverlay.parentNode) {
        console.warn('[storage] Safety timeout: forcing loading overlay removal');
        storageLoadingOverlay.remove();
        fileGrid.querySelectorAll('.storage-file-card').forEach(c => c.style.display = '');
      }
    }, 30000);

    files.forEach(file => {
      const card = document.createElement('div');
      card.className = 'storage-file-card';
      card.style.position = 'relative';
      card.style.display = 'none'; // hidden until all loaded
      
      const link = document.createElement('a');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const img = document.createElement('img');
      img.alt = file.name || '';

      (async () => {
        try {
          const src = file.url || '';
          if (!src) {
            storageFailed++; card.remove(); checkStorageLoaded();
            return;
          }
          if (typeof src === 'string' && src.startsWith('/api/storage/')) {
            const res = await authFetch(src);
            if (!res.ok) throw new Error('Não autorizado');
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            registerGalleryObjectUrl(blobUrl);
            img.src = blobUrl;
            link.href = blobUrl;
            img.dataset.blobUrl = blobUrl;
            link.dataset.blobUrl = blobUrl;
            img.onload = () => { storageLoaded++; checkStorageLoaded(); };
            img.onerror = () => { revokeGalleryObjectUrl(blobUrl); storageFailed++; card.remove(); checkStorageLoaded(); };
          } else {
            img.src = src;
            link.href = src;
            img.onload = () => { storageLoaded++; checkStorageLoaded(); };
            img.onerror = () => { storageFailed++; card.remove(); checkStorageLoaded(); };
          }
        } catch (err) {
          console.warn('Erro ao carregar arquivo de storage:', err);
          if (img?.dataset?.blobUrl) revokeGalleryObjectUrl(img.dataset.blobUrl);
          storageFailed++; card.remove(); checkStorageLoaded();
        }
      })();

      link.appendChild(img);
      card.appendChild(link);
      
      // Add delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Excluir';
      deleteBtn.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(255,0,0,0.8);color:white;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;z-index:10;';
      deleteBtn.title = 'Deletar arquivo';
      deleteBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const ok = await confirmDialog(`Deletar o arquivo "${file.name}"?`, {
          title: 'Deletar arquivo',
          confirmLabel: 'Deletar',
          cancelLabel: 'Cancelar',
          tone: 'danger',
        });
        if (!ok) return;
        
        deleteBtn.disabled = true;
        deleteBtn.textContent = '...';
        
        try {
          const storageId = file.id || file._id || file.storageFileId || null;
          if (!storageId) {
            throw new Error('ID do arquivo indisponível para exclusão.');
          }
          const response = await authFetch(`/api/campaigns/${campaignId}/storage/${encodeURIComponent(storageId)}`, {
            method: 'DELETE'
          });
          
          if (response.ok) {
            // Recarrega a árvore para refletir status e UI
            const updatedTree = type === 'graphic'
              ? await fetchGraphicStorageTree(campaignId, driver.id, graphicId)
              : await fetchDriverStorageTree(campaignId, driver.id);
            if (updatedTree) {
              renderGraphicStorageExplorer(
                { ...updatedTree, driverId: driver.id, driverName: driver.name },
                { driver, headingText, uploaderType: type, graphicId }
              );
              let itemsForStatus = flattenStorageFiles(updatedTree);
              if (type !== 'graphic') {
                try {
                  const legacy = await fetchDriverEvidence(campaignId, driver.id);
                  if (legacy?.length) itemsForStatus = itemsForStatus.concat(legacy);
                } catch (err) {
                  console.warn('fetchDriverEvidence merge (file delete)', err);
                }
              }
              updateDriverEvidenceFromItems(driver, itemsForStatus, type === 'graphic' ? 'graphic' : 'driver');
            } else {
              if (img?.dataset?.blobUrl) revokeGalleryObjectUrl(img.dataset.blobUrl);
              card.remove();
            }
            alert('Arquivo deletado com sucesso!');
          } else {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao deletar arquivo');
          }
        } catch (err) {
          console.error('Delete storage file error:', err);
          alert('Erro ao deletar arquivo: ' + err.message);
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Excluir';
        }
      };
      card.appendChild(deleteBtn);
      
      const caption = document.createElement('div');
      caption.className = 'storage-file-caption small';
      const title = document.createElement('div');
      title.textContent = file.name || '(arquivo)';
      caption.appendChild(title);
      const timestamp = formatStorageTimestamp(file.updatedAt || file.createdAt);
      if (timestamp) {
        const meta = document.createElement('span');
        meta.className = 'muted';
        meta.textContent = timestamp;
        caption.appendChild(meta);
      }
      card.appendChild(caption);
      fileGrid.appendChild(card);
    });
  }
  explorer.appendChild(fileGrid);

  acompanheGalleryGrid.appendChild(explorer);
}

function renderDriverList(drivers = [], options = {}) {
  // options: { checkedDriverIds: Set<string>, onDriverClick: function(driver) }
  if (!acompanheDrivers) return;
  const mode = getAcompanheMode();
  // ensure the left list header shows 'Motoristas' when rendering drivers
  try { const h = document.querySelector('#acompanhe-list h3'); if (h) h.textContent = 'Motoristas'; } catch (e) {}
  const { checkedDriverIds = new Set(), onDriverClick = null } = options || {};
  acompanheDrivers.innerHTML = '';
  const list = Array.isArray(drivers) ? [...drivers] : [];
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  list.sort((a, b) => collator.compare((a.name||''), (b.name||'')));
  for (const d of list) {
    const li = document.createElement('li');
    li.style.padding = '8px 6px';
    li.style.borderBottom = '1px solid var(--line)';
    li.dataset.driverId = d.id || '';
    li.setAttribute('role','button');
    li.tabIndex = 0;
    const nameEl = document.createElement('div');
    nameEl.className = 'strong';
    nameEl.textContent = d.name || '-';
    const cityEl = document.createElement('div');
    cityEl.className = 'small muted';
    cityEl.textContent = d.city || '';
    li.appendChild(nameEl);
    li.appendChild(cityEl);

    const chips = document.createElement('div');
    chips.className = 'driver-status-chips';
    updateDriverStatusChips(chips, d, mode);
    li.appendChild(chips);

    // Indica quando a grafica selecionada ja enviou arquivos para este motorista
    if (checkedDriverIds && typeof checkedDriverIds.has === 'function' && checkedDriverIds.has(d.id)) {
      const info = document.createElement('div');
      info.className = 'small muted';
      info.style.marginTop = '4px';
      info.textContent = 'Esta gráfica registrou envios para este motorista.';
      li.appendChild(info);
      li.classList.add('checked-by-graphic');
    }

    li.addEventListener('click', async () => {
      // highlight selection
      Array.from(acompanheDrivers.children).forEach(c => c.classList.remove('selected'));
      li.classList.add('selected');
      setSelectedDriver(d);
      clearAcompanheGallery();
      let storageTree = null;
      let itemsForStatus = [];
      if (typeof onDriverClick === 'function') {
        try {
          const maybe = onDriverClick(d);
          if (maybe && typeof maybe.then === 'function') {
            maybe.catch(err => console.error('onDriverClick error', err));
          }
        } catch (err) {
          console.error('onDriverClick error', err);
        }
      } else {
        renderGraphicStorageLoading('Carregando imagens do motorista...');
        let storageTree = null;
        try {
          storageTree = await fetchDriverStorageTree(campaignId, d.id);
        } catch (err) {
          console.warn('fetchDriverStorageTree fallback', err);
        }
        if (storageTree && Array.isArray(storageTree.folders) && storageTree.folders.length) {
      renderGraphicStorageExplorer(
        { ...storageTree, driverId: d.id, driverName: d.name },
        {
          driver: d,
          headingText: 'Arquivos enviados pelo motorista',
          uploaderType: 'driver',
          emptyMessage: 'Nenhuma imagem enviada pelo motorista para esta campanha.',
        },
      );
          itemsForStatus = flattenStorageFiles(storageTree);
          try {
            const legacyEvidence = await fetchDriverEvidence(campaignId, d.id);
            if (legacyEvidence?.length) {
              itemsForStatus = itemsForStatus.concat(legacyEvidence);
            }
          } catch (err) {
            console.warn('fetchDriverEvidence merge error', err);
          }
        } else {
          const items = await fetchDriverEvidence(campaignId, d.id);
          if (items && items.length) {
            renderGalleryItems(items, { type: 'driver', driver: d });
            itemsForStatus = items;
          } else {
            acompanheGalleryGrid.classList.add('is-explorer');
            acompanheGalleryGrid.innerHTML = '<div class="storage-empty">Nenhuma evidência encontrada para este motorista.</div>';
            currentStorageTree = { driverId: d.id, driverName: d.name, folders: [] };
          }
        }
      }
      if (typeof onDriverClick !== 'function') {
        const snapshot = await collectEvidenceSnapshot({ driverId: d.id, driverTree: storageTree });
        updateDriverEvidenceFromItems(d, snapshot.graphicItems, 'graphic');
        updateDriverEvidenceFromItems(d, snapshot.driverItems, 'driver');
      }
    });
    // keyboard accessibility: Enter / Space triggers click
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        li.click();
      }
    });
    acompanheDrivers.appendChild(li);
  }

  if (!onDriverClick && acompanheGalleryGrid) {
    acompanheGalleryGrid.classList.add('is-explorer');
    acompanheGalleryGrid.innerHTML = '<div class="storage-empty">Selecione um motorista para visualizar os arquivos enviados pelo motorista.</div>';
    currentStorageTree = null;
  }
}

function renderGraphicList(graphics = []) {
  if (!acompanheDrivers) return;
  const mode = getAcompanheMode();
  // ensure the left list header shows 'Gráficas' when rendering graphics
  try { const h = document.querySelector('#acompanhe-list h3'); if (h) h.textContent = 'Gráficas'; } catch (e) {}
  acompanheDrivers.innerHTML = '';
  const list = Array.isArray(graphics) ? [...graphics] : [];
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  list.sort((a, b) => collator.compare((a.name||''), (b.name||'')));
  for (const g of list) {
    const li = document.createElement('li');
    li.style.padding = '8px 6px';
    li.style.borderBottom = '1px solid var(--line)';
    li.dataset.graphicId = g.id || '';
    li.setAttribute('role','button');
    li.tabIndex = 0;
    li.innerHTML = `<div class="strong">${escapeHTML(g.name || '-')}</div><div class="small muted">${escapeHTML(g.email || g.phone || '')}</div>`;
    li.addEventListener('click', async () => {
      Array.from(acompanheDrivers.children).forEach(c => c.classList.remove('selected'));
      li.classList.add('selected');
      clearAcompanheGallery();
      resetStatusPanel('Selecione um motorista para revisar os envios desta gráfica.');

      // Fetch all evidence uploaded by this gráfica for the campaign
      const items = await fetchGraphicEvidence(campaignId, g.id);

      // Build a map driverId -> items[] so we can render driver-specific galleries quickly
      // Normalize keys to strings to avoid type mismatches between numeric/text ids
      const driverMap = new Map();
      for (const it of Array.isArray(items) ? items : []) {
        const drv = it.driverId || (it.driver && it.driver.id) || null;
        if (!drv) continue;
        const key = String(drv);
        if (!driverMap.has(key)) driverMap.set(key, []);
        driverMap.get(key).push(it);
      }

      // Render the campaign drivers list, marking which drivers were checked by this gráfica
      const drivers = Array.isArray(currentCampaign?.drivers) ? currentCampaign.drivers : [];
        const selectedGraphicId = String(g.id || '');
        const checkedDriverIds = new Set(Array.from(driverMap.keys()).map(String));
        renderDriverList(drivers, {
          checkedDriverIds,
          onDriverClick: async (driver) => {
            Array.from(acompanheDrivers.children).forEach(c => c.classList.remove('selected'));
            const sel = Array.from(acompanheDrivers.children).find(ch => String(ch.dataset.driverId) === String(driver.id));
            if (sel) sel.classList.add('selected');
            renderGraphicStorageLoading();
            let itemsForStatus = [];
            let driverTreeForStatus = null;
            let itemsForDriver = driverMap.get(String(driver.id)) || driverMap.get(driver.id) || [];
            if ((!itemsForDriver || itemsForDriver.length === 0) && typeof fetchGraphicDriverEvidence === 'function') {
              try {
                const fetched = await fetchGraphicDriverEvidence(campaignId, selectedGraphicId, driver.id);
                if (Array.isArray(fetched) && fetched.length) itemsForDriver = fetched;
            } catch (e) {
              console.warn('fallback fetchGraphicDriverEvidence failed', e);
            }
          }
            let storageTree = null;
            try {
              storageTree = await fetchGraphicStorageTree(campaignId, driver.id, selectedGraphicId);
            } catch (err) {
              console.warn('fetchGraphicStorageTree failed', err);
            }
            if (storageTree && Array.isArray(storageTree.folders) && storageTree.folders.length) {
              renderGraphicStorageExplorer(
                { ...storageTree, driverId: driver.id, driverName: driver.name },
                { driver, uploaderType: 'graphic', graphicId: selectedGraphicId }
              );
              itemsForStatus = flattenStorageFiles(storageTree);
              if (itemsForDriver && itemsForDriver.length) {
                itemsForStatus = itemsForStatus.concat(itemsForDriver);
              }
              driverTreeForStatus = await fetchDriverStorageTree(campaignId, driver.id);
            } else if (itemsForDriver && itemsForDriver.length) {
              renderGalleryItems(itemsForDriver, { type: 'graphic', driver });
              itemsForStatus = itemsForDriver;
              driverTreeForStatus = await fetchDriverStorageTree(campaignId, driver.id);
            } else {
              acompanheGalleryGrid.classList.add('is-explorer');
              acompanheGalleryGrid.innerHTML = '<div class="storage-empty">Nenhum arquivo encontrado para este motorista.</div>';
              currentStorageTree = { driverId: driver.id, driverName: driver.name, folders: [] };
            }
            const snapshot = await collectEvidenceSnapshot({
              driverId: driver.id,
              graphicId: selectedGraphicId,
              graphicTree: storageTree,
              driverTree: driverTreeForStatus,
            });
            updateDriverEvidenceFromItems(driver, snapshot.graphicItems, 'graphic');
            updateDriverEvidenceFromItems(driver, snapshot.driverItems, 'driver');
          }
        });
      if (acompanheGalleryGrid) {
        acompanheGalleryGrid.classList.add('is-explorer');
        acompanheGalleryGrid.innerHTML = '<div class="storage-empty">Selecione um motorista para visualizar os arquivos enviados pela gr&aacute;fica.</div>';
        currentStorageTree = null;
      }
    });
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); li.click(); }
    });
    acompanheDrivers.appendChild(li);
  }
}

async function renderAcompanhe(data) {
  resetStatusPanel();
  applyStatusVisibility(getAcompanheMode());
  clearAcompanheGallery();
  // Render driver or graphic list depending on selected mode
  const mode = getAcompanheMode();
  if (mode === 'graphic') {
    const graphics = Array.isArray(data?.graphics) ? data.graphics : (Array.isArray(currentCampaign?.graphics) ? currentCampaign.graphics : []);
    renderGraphicList(graphics);
  } else {
    const drivers = Array.isArray(data?.drivers) ? data.drivers : (Array.isArray(currentCampaign?.drivers) ? currentCampaign.drivers : []);
    renderDriverList(drivers);
    // hide graphic status placeholders when in driver mode
  }
}

function setupAcompanheUI() {
  // Toggle buttons for mode selection
  const toggleBtns = document.querySelectorAll('.acompanhe-mode-btn');
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode || 'driver';
      _acompanheMode = mode;
      toggleBtns.forEach(b => b.classList.toggle('active', b === btn));
      resetStatusPanel();
      applyStatusVisibility(mode);
      try { renderAcompanhe(currentCampaign); } catch (err) {}
      if (mode === 'graphic') {
        if (acompanheGalleryGrid && (!acompanheGalleryGrid.children || acompanheGalleryGrid.children.length === 0)) {
          acompanheGalleryGrid.innerHTML = '<div class="small muted">Selecione uma gráfica à esquerda para ver as evidências.</div>';
        }
      } else {
        clearAcompanheGallery();
      }
    });
  });
  
  // Setup cleanup button
  const btnCleanup = document.getElementById('btnCleanupOrphaned');
  if (btnCleanup) {
    btnCleanup.addEventListener('click', async () => {
      if (!currentCampaign) return;
      const ok = await confirmDialog('Limpar evidências órfãs (referências a arquivos deletados)? Esta ação removerá registros que apontam para imagens que não existem mais.', {
        title: 'Limpar evidências',
        confirmLabel: 'Limpar',
        cancelLabel: 'Cancelar',
        tone: 'danger',
      });
      if (!ok) return;
      
      btnCleanup.disabled = true;
      btnCleanup.textContent = '...';
      
      try {
        const response = await authFetch(`/api/campaigns/${currentCampaign.id}/cleanup-orphaned-evidence`, {
          method: 'POST'
        });
        
        if (response.ok) {
          const result = await response.json();
          alert(`${result.removedCount} evidência(s) órfã(s) removida(s) com sucesso!`);
          // Reload the current campaign
          try {
            const data = await fetchCampaign(currentCampaign.id);
            currentCampaign = data;
            renderAcompanhe(data);
          } catch (err) {
            console.error('Failed to reload campaign after cleanup:', err);
            location.reload(); // Fallback: reload entire page
          }
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Erro ao limpar evidências');
        }
      } catch (err) {
        console.error('Cleanup error:', err);
        alert('Erro ao limpar evidências: ' + err.message);
      } finally {
        btnCleanup.disabled = false;
        btnCleanup.textContent = 'Limpar';
      }
    });
  }
}


function openGraphicModal(graphic = null) {
  if (!graphicFormModal || !graphicForm) return;
  graphicForm.reset();
  editingGraphicId = graphic?.id || null;
  if (graphicIdField) graphicIdField.value = editingGraphicId || '';
  if (graphicFormMessage) graphicFormMessage.textContent = '';

  if (graphic) {
    if (graphicModalTitle) graphicModalTitle.textContent = 'Editar gráfica';
    if (graphicFormSubmit) graphicFormSubmit.textContent = 'Salvar';
    if (graphicFormHint) graphicFormHint.textContent = 'Atualize os dados de contato da gráfica.';
    if (graphicFieldName) graphicFieldName.value = trim(graphic.name);
    if (graphicFieldEmail) graphicFieldEmail.value = trim(graphic.email);
    if (graphicFieldPhone) graphicFieldPhone.value = trim(graphic.phone);
    if (graphicFieldResp1Name) graphicFieldResp1Name.value = trim(graphic.responsible1Name);
    if (graphicFieldResp1Phone) graphicFieldResp1Phone.value = trim(graphic.responsible1Phone);
    if (graphicFieldResp2Name) graphicFieldResp2Name.value = trim(graphic.responsible2Name);
    if (graphicFieldResp2Phone) graphicFieldResp2Phone.value = trim(graphic.responsible2Phone);
    if (graphicFieldNotes) graphicFieldNotes.value = trim(graphic.notes);
  } else {
    if (graphicModalTitle) graphicModalTitle.textContent = 'Adicionar gráfica';
    if (graphicFormSubmit) graphicFormSubmit.textContent = 'Adicionar';
    if (graphicFormHint) graphicFormHint.textContent = 'Preencha os dados para liberar o acesso da gráfica a esta campanha.';
  }

  showModal(graphicFormModal);
  if (graphicFieldName) {
    graphicFieldName.focus();
    graphicFieldName.select();
  }
}

async function submitGraphicForm(event) {
  event.preventDefault();
  if (!graphicForm || !campaignId) return;

  const payload = {
    name: trim(graphicFieldName?.value),
    email: trim(graphicFieldEmail?.value),
    phone: trim(graphicFieldPhone?.value),
    responsible1Name: trim(graphicFieldResp1Name?.value),
    responsible1Phone: trim(graphicFieldResp1Phone?.value),
    responsible2Name: trim(graphicFieldResp2Name?.value),
    responsible2Phone: trim(graphicFieldResp2Phone?.value),
    notes: trim(graphicFieldNotes?.value),
  };

  if (!payload.name) {
    if (graphicFormMessage) graphicFormMessage.textContent = 'Informe o nome da gráfica.';
    if (graphicFieldName) graphicFieldName.focus();
    return;
  }
  if (!payload.responsible1Name) {
    if (graphicFormMessage) graphicFormMessage.textContent = 'Informe o nome do responsável principal.';
    if (graphicFieldResp1Name) graphicFieldResp1Name.focus();
    return;
  }

  const method = editingGraphicId ? 'PATCH' : 'POST';
  const url = editingGraphicId
    ? `/api/campaigns/${encodeURIComponent(campaignId)}/graphics/${encodeURIComponent(editingGraphicId)}`
    : `/api/campaigns/${encodeURIComponent(campaignId)}/graphics`;

  if (graphicFormMessage) graphicFormMessage.textContent = '';
  const previousLabel = graphicFormSubmit ? graphicFormSubmit.textContent : '';
  if (graphicFormSubmit) {
    graphicFormSubmit.disabled = true;
    graphicFormSubmit.textContent = editingGraphicId ? 'Salvando...' : 'Adicionando...';
  }

  try {
    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let message = 'Falha ao salvar a gráfica.';
      try { message = (await res.json()).error || message; } catch (e) {
        try { message = await res.text(); } catch {}
      }
      throw new Error(message);
    }
    hideModal(graphicFormModal);
    await init();
  } catch (err) {
    console.error(err);
    if (graphicFormMessage) graphicFormMessage.textContent = err.message || 'Não foi possível salvar a gráfica.';
  } finally {
    if (graphicFormSubmit) {
      graphicFormSubmit.disabled = false;
      graphicFormSubmit.textContent = previousLabel || (editingGraphicId ? 'Salvar' : 'Adicionar');
    }
  }
}

function openImportKmModal() {
  if (!importKmModal || !importKmForm) return;
  resetImportKmFormState();

  const defaultSheetId = trim(currentCampaign?.kmSheetId || currentCampaign?.sheetId || '');
  const defaultSheetName = trim(currentCampaign?.kmSheetName || currentCampaign?.sheetName || '') || 'Planilha1';

  if (importKmSheetId) importKmSheetId.value = defaultSheetId;
  if (importKmSheetName) importKmSheetName.value = defaultSheetName;

  showModal(importKmModal);
  if (importKmSheetId) {
    importKmSheetId.focus();
    importKmSheetId.select();
  }
}

async function submitImportKmForm(event) {
  event.preventDefault();
  if (!importKmForm || !campaignId) return;

  const spreadsheetId = trim(importKmSheetId?.value);
  const sheetNameValue = trim(importKmSheetName?.value);
  const sheetName = sheetNameValue || 'Planilha1';

  clearImportKmMessage();

  if (!spreadsheetId) {
    if (importKmMessage) importKmMessage.textContent = 'Informe o ID da planilha.';
    if (importKmSheetId) importKmSheetId.focus();
    return;
  }

  const payload = { spreadsheetId, sheetName, campaignId };

  const previousSubmitLabel = importKmSubmit ? importKmSubmit.textContent : '';
  const previousTriggerLabel = btnImportKm ? btnImportKm.textContent : '';

  if (importKmSubmit) {
    importKmSubmit.disabled = true;
    importKmSubmit.textContent = 'Importando...';
  }
  if (btnImportKm) {
    btnImportKm.disabled = true;
    btnImportKm.textContent = 'Importando...';
  }

  try {
    const res = await authFetch('/api/imports/km', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let body;
      try {
        body = await res.json();
      } catch (e) {
        body = await res.text();
      }
      const msg = body && typeof body === 'object'
        ? `${body.error || 'Erro'}${body.detail ? '\n' + body.detail : ''}${body.hint ? '\n' + body.hint : ''}`
        : String(body || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    const result = await res.json();
    hideModal(importKmModal);
    await init();
    alert(`Importação concluída.\nVinculados: ${result.linked}\nItens para revisar: ${result.review}`);
  } catch (err) {
    console.error(err);
    if (importKmMessage) importKmMessage.textContent = err.message || 'Não foi possível importar a planilha.';
  } finally {
    if (importKmSubmit) {
      importKmSubmit.disabled = false;
      importKmSubmit.textContent = previousSubmitLabel || 'Importar';
    }
    if (btnImportKm) {
      btnImportKm.disabled = false;
      btnImportKm.textContent = previousTriggerLabel || 'Importar KM';
    }
  }
}

function renderKm(drivers = []) {
  const tbody = el('#tblKm');
  if (!tbody) return;
  tbody.innerHTML = '';
  const header = Array.isArray(currentCampaign?.kmSheetHeader) && currentCampaign.kmSheetHeader.length
    ? currentCampaign.kmSheetHeader
    : (Array.isArray(currentCampaign?.sheetHeader) && currentCampaign.sheetHeader.length ? currentCampaign.sheetHeader : []);

  // sort drivers alphabetically (pt-BR) by name for consistent UI
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  const sortedDrivers = Array.isArray(drivers) ? [...drivers].sort((a, b) => collator.compare((a.name||''), (b.name||''))) : [];

  for (const driver of sortedDrivers) {
    // Ensure we render every driver even if they don't have KM data yet
    let kmData = driver.km;
    if (!kmData) {
      kmData = {
        periods: [],
        total: { kmRodado: '', metaKm: '', percent: null, status: '', label: 'Total', isTotal: true },
        checkIn: '',
        comentarios: '',
        observacoes: '',
      };
    }

    // Determine how many periods to render: campaign.kmPeriods (explicit), or derived from header, or default 3
    const headerForPeriods = Array.isArray(currentCampaign?.kmSheetHeader) && currentCampaign.kmSheetHeader.length
      ? currentCampaign.kmSheetHeader
      : (Array.isArray(currentCampaign?.sheetHeader) && currentCampaign.sheetHeader.length ? currentCampaign.sheetHeader : []);
    const totalPeriods = Number.isFinite(Number(currentCampaign?.kmPeriods))
      ? Number(currentCampaign.kmPeriods)
      : (detectKmPeriodsFromHeader(headerForPeriods) || 3);

    const periods = [];
    for (let i = 1; i <= totalPeriods; i += 1) {
      let p = null;
      if (Array.isArray(kmData.periods)) {
        p = kmData.periods.find(x => Number(x.index) === i) || null;
      }
      if (p) {
        periods.push({ ...p, label: `Período ${i}` });
      } else {
        periods.push({ index: i, kmRodado: '', metaKm: '', percent: null, status: '', label: `Período ${i}` });
      }
    }

    const totalObj = kmData.total || { kmRodado: '', metaKm: '', percent: null, status: '', label: 'Total', isTotal: true };
    const totalRows = [{ ...totalObj, label: 'Total', isTotal: true, checkIn: kmData.checkIn || '', comentarios: kmData.comentarios || '', observacoes: kmData.observacoes || '' }];

    const rows = [...periods, ...totalRows];

    rows.forEach((period, index) => {
      const tr = document.createElement('tr');
      // tag the row with driver id and whether it's the total row for easier DOM updates
      if (driver.id) tr.dataset.driverId = driver.id;
      if (period.isTotal) tr.dataset.isTotal = '1';
      else tr.dataset.periodIndex = period.index;

      if (index === 0) {
        const nameCell = document.createElement('td');
        nameCell.rowSpan = rows.length;
        const nameButton = document.createElement('button');
        nameButton.type = 'button';
        nameButton.className = 'link-button km-name';
        nameButton.dataset.driverId = driver.id || '';
        nameButton.textContent = driver.name || '-';
        nameCell.appendChild(nameButton);
        tr.appendChild(nameCell);
      }

  const periodCell = document.createElement('td');
  // keep period label and number on the same line to avoid vertical stacking
  periodCell.className = 'period-cell';
  periodCell.textContent = period.label || `Período ${period.index || ''}`;
      tr.appendChild(periodCell);

      // KM (editable)
      const kmCell = document.createElement('td');
      const kmInput = document.createElement('input');
      kmInput.type = 'text';
      kmInput.className = 'driver-input';
      kmInput.value = period.kmRodado ?? '';
      kmInput.dataset.driverId = driver.id;
      // Determine dataset.column: prefer campaign.kmColumns mapping when available
      if (currentCampaign?.kmColumns && currentCampaign.kmColumns.periods && currentCampaign.kmColumns.periods[period.index]) {
        const mapped = currentCampaign.kmColumns.periods[period.index].kmRodado;
        kmInput.dataset.column = mapped && mapped.key ? mapped.key : `KM RODADO ${period.index}`;
      } else if (period.isTotal && currentCampaign?.kmColumns?.totals?.kmRodadoTotal) {
        kmInput.dataset.column = currentCampaign.kmColumns.totals.kmRodadoTotal.key || 'KM RODADO TOTAL';
      } else {
        kmInput.dataset.column = `KM RODADO ${period.index || (period.label === 'Total' ? 'TOTAL' : '')}`;
      }
      kmInput.dataset.originalValue = kmInput.value;
      kmInput.addEventListener('change', (e) => {
        const value = e.target.value;
        const driverId = e.target.dataset.driverId;
        const col = e.target.dataset.column;
        const prior = e.target.dataset.originalValue ?? '';
        bufferKmChange(driverId, col, value, prior);
        updateDriverTotals(driverId);
      });
      kmCell.appendChild(kmInput);
      tr.appendChild(kmCell);

      // Meta (editable)
      const metaCell = document.createElement('td');
      const metaInput = document.createElement('input');
      metaInput.type = 'text';
      metaInput.className = 'driver-input';
      metaInput.value = period.metaKm ?? '';
      metaInput.dataset.driverId = driver.id;
      if (currentCampaign?.kmColumns && currentCampaign.kmColumns.periods && currentCampaign.kmColumns.periods[period.index]) {
        const mapped = currentCampaign.kmColumns.periods[period.index].metaKm;
        metaInput.dataset.column = mapped && mapped.key ? mapped.key : `META KM ${period.index}`;
      } else if (period.isTotal && currentCampaign?.kmColumns?.totals?.metaKmTotal) {
        metaInput.dataset.column = currentCampaign.kmColumns.totals.metaKmTotal.key || 'META KM TOTAL';
      } else {
        metaInput.dataset.column = `META KM ${period.index || (period.label === 'Total' ? 'TOTAL' : '')}`;
      }
      metaInput.dataset.originalValue = metaInput.value;
      metaInput.addEventListener('change', (e) => {
        const value = e.target.value;
        const driverId = e.target.dataset.driverId;
        const col = e.target.dataset.column;
        const prior = e.target.dataset.originalValue ?? '';
        bufferKmChange(driverId, col, value, prior);
        updateDriverTotals(driverId);
      });
      metaCell.appendChild(metaInput);
      tr.appendChild(metaCell);

      const percentCell = document.createElement('td');
  percentCell.textContent = formatPercentValue(period.percent ?? null);
  percentCell.dataset.column = period.isTotal ? 'PERCENT TOTAL' : `PERCENT ${period.index || ''}`;
      tr.appendChild(percentCell);

      const statusCell = document.createElement('td');
      const statusInput = document.createElement('input');
      statusInput.type = 'text';
      statusInput.className = 'driver-input';
      statusInput.value = period.status ?? '';
      statusInput.dataset.driverId = driver.id;
      if (currentCampaign?.kmColumns && currentCampaign.kmColumns.periods && currentCampaign.kmColumns.periods[period.index]) {
        const mapped = currentCampaign.kmColumns.periods[period.index].status;
        statusInput.dataset.column = mapped && mapped.key ? mapped.key : (period.isTotal ? 'STATUS TOTAL' : `STATUS ${period.index}`);
      } else if (period.isTotal && currentCampaign?.kmColumns?.totals?.statusTotal) {
        statusInput.dataset.column = currentCampaign.kmColumns.totals.statusTotal.key || 'STATUS TOTAL';
      } else {
        statusInput.dataset.column = period.isTotal ? 'STATUS TOTAL' : `STATUS ${period.index || ''}`;
      }
      statusInput.dataset.originalValue = statusInput.value;
      statusInput.addEventListener('change', (e) => {
        const value = e.target.value;
        const driverId = e.target.dataset.driverId;
        const col = e.target.dataset.column;
        const prior = e.target.dataset.originalValue ?? '';
        bufferKmChange(driverId, col, value, prior);
        updateDriverTotals(driverId);
      });
      statusCell.appendChild(statusInput);
      tr.appendChild(statusCell);

      const checkCell = document.createElement('td');
      if (period.isTotal) {
        const checkInput = document.createElement('input');
        checkInput.type = 'text';
        checkInput.className = 'driver-input';
        checkInput.value = kmData.checkIn || '';
        checkInput.dataset.driverId = driver.id;
        // map CHECK IN to kmColumns extras if present
        if (currentCampaign?.kmColumns?.extras?.checkIn) checkInput.dataset.column = currentCampaign.kmColumns.extras.checkIn.key || 'CHECK IN';
        else checkInput.dataset.column = 'CHECK IN';
        checkInput.dataset.originalValue = checkInput.value;
        checkInput.addEventListener('change', (e) => {
          const value = e.target.value;
          const driverId = e.target.dataset.driverId;
          const col = e.target.dataset.column;
          const prior = e.target.dataset.originalValue ?? '';
          bufferKmChange(driverId, col, value, prior);
          updateDriverTotals(driverId);
        });
        checkCell.appendChild(checkInput);
      } else {
        checkCell.textContent = '';
      }
      tr.appendChild(checkCell);

      const notesCell = document.createElement('td');
      if (period.isTotal) {
        const notesInput = document.createElement('textarea');
        notesInput.className = 'driver-input';
        notesInput.value = [kmData.comentarios, kmData.observacoes].filter(v => v).join('\n') || '';
        notesInput.dataset.driverId = driver.id;
        // map comments/observacoes to detected extras key if present
        if (currentCampaign?.kmColumns?.extras?.comentarios) notesInput.dataset.column = currentCampaign.kmColumns.extras.comentarios.key || 'COMENTÁRIOS';
        else notesInput.dataset.column = 'COMENTÁRIOS';
        notesInput.dataset.originalValue = notesInput.value;
        notesInput.addEventListener('change', (e) => {
          const value = e.target.value;
          const driverId = e.target.dataset.driverId;
          const col = e.target.dataset.column;
          const prior = e.target.dataset.originalValue ?? '';
          bufferKmChange(driverId, col, value, prior);
          updateDriverTotals(driverId);
        });
        notesCell.appendChild(notesInput);
      } else {
        notesCell.textContent = '';
      }
      tr.appendChild(notesCell);

      tbody.appendChild(tr);
    });

    // After rendering driver rows, compute totals from current inputs so totals show correctly
    if (driver.id) updateDriverTotals(driver.id);
  }

  ensureTableState(tbody.closest('table'));
}

// renderKmCards removed; using table layout but with editable inputs instead

function renderKmEditForm(driver) {
  const form = document.getElementById('kmEditForm');
  const container = document.getElementById('kmEditFields');
  const hint = document.getElementById('kmEditHint');
  if (!form || !container) return;
  container.innerHTML = '';

  const header = Array.isArray(currentCampaign?.kmSheetHeader) && currentCampaign.kmSheetHeader.length
    ? currentCampaign.kmSheetHeader
    : Array.isArray(currentCampaign?.sheetHeader) && currentCampaign.sheetHeader.length
    ? currentCampaign.sheetHeader
    : Object.keys(driver?.km?.raw || {}).filter(k => !String(k).startsWith('_'));

  const raw = driver?.km?.raw || {};
  if (hint) {
    hint.textContent = driver.rowNumber ? `Linha ${driver.rowNumber} da planilha.` : 'Edite os campos abaixo e salve para atualizar a planilha.';
  }

  if (!header || !header.length) {
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Sem colunas definidas para esta planilha.';
    container.appendChild(p);
    return;
  }

  header.forEach((column, index) => {
    if (!column) return;
    const normalized = normalizeKey(column);
    if (DRIVER_FORM_HIDDEN_COLUMNS.has(normalized)) return;
    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.setAttribute('for', `km-field-${index}`);
    label.textContent = column;

    const field = createInputForColumn(column, index, 'km-field');
    const currentValue = raw[column] ?? '';
    field.value = currentValue;
    field.dataset.originalValue = currentValue;
    group.append(label, field);
    container.appendChild(group);
  });

  form.dataset.driverId = driver.id || '';
}

function openKmEdit(driverId) {
  const driver = getDriverById(driverId);
  if (!driver) {
    alert('Motorista não encontrado.');
    return;
  }
  renderKmEditForm(driver);
  showModal(document.getElementById('kmEditModal'));
}

function renderReview(items = []) {
  const tbody = el('#tblReview');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const item of items) {
    const row = document.createElement('tr');
    row.dataset.reviewId = item.id || '';
    row.dataset.reviewType = item.type || '';
    if (item.driverId) row.dataset.driverId = item.driverId;

    const typeCell = document.createElement('td');
    typeCell.textContent = item.type || '-';
    row.appendChild(typeCell);

    const descCell = document.createElement('td');
    const lines = [];
    if (item.driverName) {
      lines.push(`<strong>${escapeHTML(item.driverName)}</strong>`);
    }
    if (item.column) {
      const value = item.value ? escapeHTML(item.value) : '<i>(vazio)</i>';
      lines.push(`${escapeHTML(item.column)}: ${value}`);
    }
    if (item.rowNumber) {
      lines.push(`Linha ${item.rowNumber}`);
    }
    if (item.note) {
      lines.push(escapeHTML(item.note));
    }
    if (item.payload && item.type === 'KM_MATCH') {
      const nome = item.payload.raw?.Nome || item.payload.raw?.NOME || '';
      const kmTotal = item.payload.kmTotal || '';
      lines.push(`Nome informado: ${escapeHTML(nome)}`);
      if (kmTotal) lines.push(`Odômetro atual: ${escapeHTML(kmTotal)}`);
    }
    descCell.innerHTML = lines.length ? lines.join('<br/>') : 'Sem detalhes';
    row.appendChild(descCell);

    const actionCell = document.createElement('td');
    actionCell.className = 'review-actions';
    const canApplyStatus = item.type === 'STATUS_INVALIDO' && item.driverId;
    if (canApplyStatus) {
      const select = document.createElement('select');
      select.className = 'driver-input review-status-select';
      STATUS_OPTIONS.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        select.appendChild(option);
      });
      const normalized = normalizeDriverStatus(item.value);
      select.value = STATUS_OPTIONS.includes(normalized) ? normalized : 'agendado';
      actionCell.appendChild(select);

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn--primary review-action';
      applyBtn.textContent = 'Aplicar';
      applyBtn.dataset.reviewAction = 'apply-status';
      applyBtn.dataset.reviewId = item.id || '';
      actionCell.appendChild(applyBtn);
    }

    const ignoreBtn = document.createElement('button');
    ignoreBtn.type = 'button';
    ignoreBtn.className = 'btn btn--ghost review-action';
    ignoreBtn.textContent = 'Ignorar';
    ignoreBtn.dataset.reviewAction = 'ignore';
    ignoreBtn.dataset.reviewId = item.id || '';
    actionCell.appendChild(ignoreBtn);

    row.appendChild(actionCell);
    tbody.appendChild(row);
  }

  ensureTableState(tbody.closest('table'));
}

function getDriverById(id) {
  if (!currentCampaign || !Array.isArray(currentCampaign.drivers)) return null;
  return currentCampaign.drivers.find(d => d.id === id);
}

function toUniqueDriverIds(drivers = [], limit = 12) {
  const ids = [];
  const seen = new Set();
  for (const item of Array.isArray(drivers) ? drivers : []) {
    const id = String(item?.id || '').trim();
    if (!id || seen.has(id)) continue;
    ids.push(id);
    seen.add(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function createSummaryActionItem(label, drivers = [], options = {}) {
  const driverIds = toUniqueDriverIds(drivers, options.limit || 12);
  return {
    label: String(label || '').trim(),
    driverIds,
    title: String(options.title || '').trim(),
    emptyText: String(options.emptyText || '').trim(),
  };
}

function getDriverNamesByIds(driverIds = []) {
  const names = [];
  for (const id of Array.isArray(driverIds) ? driverIds : []) {
    const driver = getDriverById(id);
    if (!driver?.name) continue;
    names.push(driver.name);
  }
  return names;
}

function buildSummaryDrilldownTooltip(item) {
  const names = getDriverNamesByIds(item?.driverIds || []);
  if (!names.length) return '';
  const maxNames = 6;
  const preview = names.slice(0, maxNames).join(', ');
  const suffix = names.length > maxNames ? ` +${names.length - maxNames}` : '';
  return `Motoristas: ${preview}${suffix}`;
}

function openSummaryDrilldown(title, driverIds = [], emptyText = '') {
  if (!summaryDrilldownModal || !summaryDrilldownList || !summaryDrilldownTitle) return;
  const ids = Array.isArray(driverIds) ? driverIds.filter(Boolean) : [];
  const emptyMessage = emptyText || 'Nenhum motorista relacionado para este item.';
  summaryDrilldownTitle.textContent = title || 'Motoristas relacionados';
  if (summaryDrilldownHint) {
    summaryDrilldownHint.textContent = ids.length
      ? 'Clique no motorista para abrir os detalhes.'
      : emptyMessage;
  }

  if (!ids.length) {
    summaryDrilldownList.innerHTML = `<li class="summary-drilldown-empty">${escapeHTML(emptyMessage)}</li>`;
    showModal(summaryDrilldownModal);
    return;
  }

  const rows = [];
  ids.forEach(id => {
    const driver = getDriverById(id);
    if (!driver) return;
    const kmCtx = getDriverKmContext(driver);
    const kmLabel = Number.isFinite(kmCtx.travelledKm) ? `${formatNumber(Math.round(kmCtx.travelledKm))} KM` : 'KM pendente';
    const status = normalizeDriverStatus(driver?.status || driver?.statusRaw || driver?.raw?.Status || '') || 'sem status';
    const hasPhone = Boolean(driver?.phone);
    rows.push(`
      <li>
        <div class="summary-drilldown-row">
          <button type="button" class="summary-driver-link" data-summary-open-driver="${escapeHTML(id)}">
            <span class="summary-driver-name">${escapeHTML(driver.name || 'Motorista sem nome')}</span>
            <span class="summary-driver-meta">${escapeHTML(status)} · ${escapeHTML(kmLabel)}</span>
          </button>
          ${hasPhone ? `<button type="button" class="btn-drilldown-send" data-drilldown-send-driver="${escapeHTML(id)}" title="Enviar mensagem WhatsApp">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
            Enviar
          </button>` : ''}
        </div>
      </li>
    `);
  });

  summaryDrilldownList.innerHTML = rows.length
    ? rows.join('')
    : `<li class="summary-drilldown-empty">${escapeHTML(emptyMessage)}</li>`;
  showModal(summaryDrilldownModal);
}

function renderDriverDetails(driver) {
  if (!driverModalTitle || !driverDetailFields || !driverDetailForm) return;
  driverModalTitle.textContent = driver.name || 'Motorista';
  driverDetailForm.dataset.driverId = driver.id || '';
  driverDetailFields.innerHTML = '';

  // ── Hero: avatar + nome + status badge ──────────────────────────────
  const currentStatus = driver.status || driver.raw?.STATUS || driver.raw?.status || 'agendado';
  const statusNorm = typeof normalizeStatus === 'function' ? normalizeStatus(currentStatus) : currentStatus;
  const STATUS_LABEL = {
    agendado: 'Agendado', confirmado: 'Confirmado', instalado: 'Instalado',
    aguardando: 'Aguardando', cadastrando: 'Cadastrando', problema: 'Problema',
    revisar: 'Revisar',
  };

  const heroRow = document.createElement('div');
  heroRow.className = 'dd-hero';

  if (driver.avatar) {
    const img = document.createElement('img');
    img.src = driver.avatar;
    img.alt = driver.name || '';
    img.className = 'dd-avatar';
    img.width = 64;
    img.height = 64;
    heroRow.appendChild(img);
  } else {
    const initEl = document.createElement('div');
    initEl.className = 'dd-avatar dd-avatar--initials';
    const words = (driver.name || '?').split(' ');
    initEl.textContent = words.length >= 2
      ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
      : (words[0][0] || '?').toUpperCase();
    heroRow.appendChild(initEl);
  }

  const heroInfo = document.createElement('div');
  heroInfo.className = 'dd-hero-info';

  const heroName = document.createElement('div');
  heroName.className = 'dd-hero-name';
  heroName.textContent = driver.name || '';

  // Score: buscar de forma assíncrona e exibir inline (ex: ★ 4.3)
  const scoreEl = document.createElement('span');
  scoreEl.className = 'dd-driver-score';
  scoreEl.textContent = '';
  heroName.appendChild(scoreEl);

  const _scorePhone = (driver.phone || driver.phoneDigits || '').replace(/\D/g, '');
  if (_scorePhone) {
    authFetch(`/api/driver-scores/${encodeURIComponent(_scorePhone)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.score) {
          const val = data.score.override != null ? data.score.override : data.score.final;
          if (val != null) scoreEl.textContent = ' \u2605 ' + Number(val).toFixed(1);
        }
      })
      .catch(() => {});
  }

  heroInfo.appendChild(heroName);

  // Status pill (visual only - not the editable select)
  const statusPill = document.createElement('span');
  statusPill.className = `dd-status-badge dd-status-${statusNorm}`;
  statusPill.textContent = STATUS_LABEL[statusNorm] || statusNorm;
  heroInfo.appendChild(statusPill);

  // Identifiers row (phone + plate)
  const heroMeta = document.createElement('div');
  heroMeta.className = 'dd-hero-meta';
  // Resolve fields from top-level or raw aliases
  const raw = driver.raw || {};
  const resolvedPhone = driver.phone || raw['Número'] || raw['Numero'] || raw['numero'] || raw['telefone'] || raw['Telefone'] || '';
  const resolvedPlate = driver.plate || raw['Placa'] || raw['placa'] || '';
  const resolvedEmail = driver.email || raw['Email'] || raw['email'] || raw['E-mail'] || '';
  const resolvedCpf = driver.cpf || raw['CPF'] || raw['cpf'] || '';
  const resolvedModel = driver.model || raw['Modelo'] || raw['modelo'] || '';

  if (resolvedPhone) {
    const phoneSpan = document.createElement('span');
    phoneSpan.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 12 19.79 19.79 0 0 1 1.07 3.4 2 2 0 0 1 3.05 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.09 8.91A16 16 0 0 0 15 16.91l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${escapeHTML(resolvedPhone)}`;
    heroMeta.appendChild(phoneSpan);
  }
  if (resolvedPlate) {
    const plateSpan = document.createElement('span');
    plateSpan.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="22" height="18" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="15" x2="17" y2="15"/></svg> ${escapeHTML(resolvedPlate)}`;
    heroMeta.appendChild(plateSpan);
  }
  if (heroMeta.children.length) heroInfo.appendChild(heroMeta);

  heroRow.appendChild(heroInfo);
  driverDetailFields.appendChild(heroRow);

  // ── Info grid: dados da API ──────────────────────────────────────────
  const infoItems = [];

  if (driver.city || driver.address?.city) {
    const addr = driver.address || {};
    const parts = [addr.street, addr.neighborhood, addr.city, addr.state].filter(Boolean);
    infoItems.push({ icon: '📍', label: 'Endereço', value: parts.join(', ') || driver.city, full: true });
  }
  if (resolvedEmail) infoItems.push({ icon: '✉', label: 'E-mail', value: resolvedEmail });
  if (resolvedCpf) infoItems.push({ icon: '🪪', label: 'CPF', value: resolvedCpf });
  if (driver.pix) infoItems.push({ icon: '💸', label: 'PIX', value: driver.pix });
  if (resolvedModel) infoItems.push({ icon: '🚗', label: 'Modelo', value: resolvedModel });

  const apiKm = Number(driver.kmTravelledValue) || (driver.campaignData?.totalKms ?? null);
  if (Number.isFinite(apiKm) && apiKm > 0) {
    infoItems.push({ icon: '🛣', label: 'KM Total', value: formatNumber(Math.round(apiKm)) + ' km' });
  }
  if (driver.ratingApp) infoItems.push({ icon: '⭐', label: 'Rating App', value: String(driver.ratingApp) });
  if (driver.mainApp || (Array.isArray(driver.appsRegistered) && driver.appsRegistered.length)) {
    const apps = Array.isArray(driver.appsRegistered) && driver.appsRegistered.length
      ? driver.appsRegistered.join(', ')
      : driver.mainApp;
    infoItems.push({ icon: '📱', label: 'Aplicativos', value: apps });
  }
  if (driver.operationPeriod) infoItems.push({ icon: '🕐', label: 'Período de Operação', value: driver.operationPeriod });
  if (driver.operationNeighborhood) infoItems.push({ icon: '📍', label: 'Área de Operação', value: String(driver.operationNeighborhood).slice(0, 120) });
  if (driver.campaignData?.totalScans > 0) infoItems.push({ icon: '📊', label: 'Scans', value: String(driver.campaignData.totalScans) });

  if (infoItems.length) {
    const section = document.createElement('div');
    section.className = 'dd-section';

    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'dd-section-title';
    sectionTitle.textContent = 'Dados do Motorista';
    section.appendChild(sectionTitle);

    const grid = document.createElement('dl');
    grid.className = 'dd-info-grid';

    for (const item of infoItems) {
      const dt = document.createElement('dt');
      dt.textContent = item.label;

      const dd = document.createElement('dd');
      dd.textContent = item.value;

      const wrapper = document.createElement('div');
      wrapper.className = 'dd-info-cell' + (item.full ? ' dd-info-cell--full' : '');
      wrapper.append(dt, dd);
      grid.appendChild(wrapper);
    }

    section.appendChild(grid);
    driverDetailFields.appendChild(section);
  }

  // ── Seção editável: Status + Observações ────────────────────────────
  driverDetailFields.appendChild(renderDriverDocumentsSection(driver));

  const header = getCampaignHeader();
  const driverRaw = driver.raw || {};
  const EDITABLE_KEYS = new Set(['status', 'observacoes', 'obs', 'observacao']);

  const entries = header.length
    ? header
        .filter(col => EDITABLE_KEYS.has(normalizeKey(col)))
        .map(col => [col, driverRaw[col] ?? ''])
    : Object
        .entries(driverRaw)
        .filter(([key]) => key && !String(key).startsWith('_') && EDITABLE_KEYS.has(normalizeKey(key)));

  if (!entries.length) {
    const msg = document.createElement('p');
    msg.className = 'small muted';
    msg.style.marginTop = '12px';
    msg.textContent = 'Sem dados editáveis para este motorista.';
    driverDetailFields.appendChild(msg);
    return;
  }

  if (driverDetailHint) driverDetailHint.textContent = '';

  const editSection = document.createElement('div');
  editSection.className = 'dd-section';

  const editTitle = document.createElement('div');
  editTitle.className = 'dd-section-title';
  editTitle.textContent = 'Configurações';
  editSection.appendChild(editTitle);

  entries.forEach(([column, value], index) => {
    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.setAttribute('for', `driver-detail-field-${index}`);
    label.textContent = column;

    const field = createInputForColumn(column, index, 'driver-detail-field');
    const currentValue = formatValueForColumnInput(column, value);
    field.value = currentValue;
    field.dataset.originalValue = currentValue;

    if (field.tagName === 'TEXTAREA') group.classList.add('form-group--full');

    if (field.tagName === 'SELECT') {
      const exists = Array.from(field.options).some(opt => opt.value === field.value);
      if (!exists && field.value) {
        const option = document.createElement('option');
        option.value = field.value;
        option.textContent = field.value;
        field.appendChild(option);
      }
      if (normalizeKey(column) === 'status') {
        // Use the API-sourced status when raw value is empty
        const resolvedStatus = currentValue || statusNorm || 'agendado';
        field.value = resolvedStatus;
        field.dataset.originalValue = resolvedStatus;
        field.className = 'pill-select dd-status-select';
      }
    }

    group.append(label, field);
    editSection.appendChild(group);
  });

  driverDetailFields.appendChild(editSection);
}

function openDriverDetail(driverId) {
  const driver = getDriverById(driverId);
  if (!driver) {
    alert('Motorista não encontrado.');
    return;
  }
  renderDriverDetails(driver);
  showModal(driverDetailModal);
}

function getCampaignHeader() {
  if (
    currentCampaign &&
    Array.isArray(currentCampaign.sheetHeader) &&
    currentCampaign.sheetHeader.length
  ) {
    return currentCampaign.sheetHeader;
  }

  if (currentCampaign?.drivers?.length) {
    const raw = currentCampaign.drivers[0].raw || {};
    const keys = Object.keys(raw).filter(key => key && !String(key).startsWith('_'));
    if (keys.length) {
      // Merge missing DEFAULT_DRIVER_COLUMNS so the form always shows all standard fields
      const normalizedExisting = new Set(keys.map(k => normalizeKey(k)));
      for (const col of DEFAULT_DRIVER_COLUMNS) {
        if (!normalizedExisting.has(normalizeKey(col))) {
          keys.push(col);
        }
      }
      return keys;
    }
  }

  return [...DEFAULT_DRIVER_COLUMNS];
}

function createInputForColumn(column, index, prefix = 'driver-field') {
  const lower = column.toLowerCase();
  const normalized = normalizeKey(column);
  const id = `${prefix}-${index}`;
  let field;

  if (normalized === 'status') {
    field = document.createElement('select');
    STATUS_OPTIONS.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      field.appendChild(option);
    });
    field.value = 'agendado';
  } else if (ADHESION_STATUS_COLUMN_ALIASES.includes(normalized)) {
    field = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Não informado';
    field.appendChild(empty);
    ADHESION_STATUS_OPTIONS.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      field.appendChild(option);
    });
  } else if (
    ADHESION_INITIAL_COLUMN_ALIASES.includes(normalized) ||
    ADHESION_REMOVAL_COLUMN_ALIASES.includes(normalized)
  ) {
    field = document.createElement('input');
    field.type = 'datetime-local';
  } else if (lower.includes('observ') || lower.includes('coment')) {
    field = document.createElement('textarea');
    field.rows = 3;
  } else {
    field = document.createElement('input');
    field.type = 'text';
  }

  field.id = id;
  field.dataset.column = column;
  if (lower === 'nome') {
    field.required = true;
  }
  return field;
}

function formatValueForColumnInput(column, value) {
  const normalized = normalizeKey(column);
  if (
    ADHESION_INITIAL_COLUMN_ALIASES.includes(normalized) ||
    ADHESION_REMOVAL_COLUMN_ALIASES.includes(normalized)
  ) {
    return formatAdhesionDateTimeInput(value);
  }
  if (ADHESION_STATUS_COLUMN_ALIASES.includes(normalized)) {
    return normalizeAdhesionStatus(value);
  }
  return value ?? '';
}

function renderDriverFormFields() {
  if (!driverFormFields) return;
  driverFormFields.innerHTML = '';
  const header = getCampaignHeader();

  header.forEach((column, index) => {
    if (!column) return;
    const normalized = normalizeKey(column);
    if (DRIVER_FORM_HIDDEN_COLUMNS.has(normalized)) return;
    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.setAttribute('for', `driver-field-${index}`);
    label.textContent = column;

    const field = createInputForColumn(column, index);
    if (field.tagName === 'TEXTAREA') {
      group.classList.add('form-group--full');
    }

    group.append(label, field);
    driverFormFields.appendChild(group);
  });

  if (driverFormHint) {
    driverFormHint.textContent = 'Campos vazios serão gravados em branco. Nome é obrigatório.';
  }
}

function parseNumeric(value) {
  if (value == null) return 0;
  const normalized = String(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStoredKmValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateMetrics(drivers = []) {
  let totalKm = 0;
  let adSum = 0;
  let adCount = 0;

  for (const driver of drivers) {
    const kmCtx = getDriverKmContext(driver);
    totalKm += Number(kmCtx.travelledKm) || 0;

    const adherenceCandidate =
      getDriverRawNumericByAliases(driver, ['aderencia', 'aderência']) ??
      parseNumeric(driver?.adherence ?? driver?.adh ?? '');
    if (Number.isFinite(adherenceCandidate) && adherenceCandidate > 0) {
      adSum += adherenceCandidate;
      adCount += 1;
    }
  }

  return {
    totalKm,
    averageAdherence: adCount ? Math.round(adSum / adCount) : null,
  };
}

function openPartialReportModal() {
  if (!currentCampaign) {
    alert('Carregue uma campanha antes de gerar o relatório parcial.');
    return;
  }
  showModal(partialReportModal);
}

function partialReportText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function partialReportNumber(value) {
  const parsed = parseNumeric(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function partialReportField(driver, aliases = [], directKeys = []) {
  for (const key of directKeys) {
    const value = key.split('.').reduce((acc, part) => acc?.[part], driver);
    const text = partialReportText(value);
    if (text) return text;
  }
  return getDriverRawValueByAliases(driver, aliases);
}

function partialReportStatusLabel(driver) {
  const normalized = normalizeDriverStatus(driver?.status || driver?.statusRaw || driver?.raw?.Status || '');
  const labels = {
    agendado: 'Agendado',
    confirmado: 'Confirmado',
    instalado: 'Instalado',
    aguardando: 'Aguardando',
    cadastrando: 'Cadastrando',
    problema: 'Problema',
    revisar: 'Revisar',
  };
  return labels[normalized] || (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '-');
}

function partialReportDriverRows(drivers = []) {
  return drivers.map(driver => {
    const kmCtx = getDriverKmContext(driver);
    const odometer = getDriverOdometerDistance(driver);
    const driverOdometer = Number.isFinite(odometer.driverOdometer) ? `${formatNumber(odometer.driverOdometer)} km` : '-';
    const graphicOdometer = Number.isFinite(odometer.graphicOdometer) ? `${formatNumber(odometer.graphicOdometer)} km` : '-';
    const odometerKm = Number.isFinite(odometer.value) ? `${formatNumber(odometer.value)} km` : (odometer.inconsistent ? 'Inconsistente' : '-');
    return {
      id: String(driver?.id || ''),
      name: partialReportText(driver?.name, partialReportField(driver, ['nome'], []), 'Motorista sem nome'),
      city: partialReportText(driver?.city, driver?.address?.city, partialReportField(driver, ['cidade'], []), '-'),
      phone: partialReportText(driver?.phone, driver?.phoneDigits, partialReportField(driver, ['numero', 'número', 'telefone'], []), '-'),
      plate: partialReportText(driver?.plate, partialReportField(driver, ['placa'], []), '-'),
      model: partialReportText(driver?.model, partialReportField(driver, ['modelo'], []), '-'),
      status: partialReportStatusLabel(driver),
      km: Number.isFinite(kmCtx.travelledKm) ? `${formatNumber(Math.round(kmCtx.travelledKm))} km` : '-',
      driverOdometer,
      graphicOdometer,
      odometerKm,
    };
  });
}

function partialReportBuildData(campaign = {}) {
  const drivers = Array.isArray(campaign.drivers) ? campaign.drivers : [];
  const metrics = calculateMetrics(drivers);
  const api = campaign.apiData || {};
  const installed = drivers.filter(driver => normalizeDriverStatus(driver?.status || driver?.statusRaw || driver?.raw?.Status || '') === 'instalado').length;
  const scheduled = drivers.filter(driver => normalizeDriverStatus(driver?.status || driver?.statusRaw || driver?.raw?.Status || '') === 'agendado').length;
  const review = drivers.filter(driver => {
    const status = normalizeDriverStatus(driver?.status || driver?.statusRaw || driver?.raw?.Status || '');
    return status === 'problema' || status === 'revisar';
  }).length;
  const goal = getCampaignKmGoal(campaign, drivers.length);
  const progress = goal.total > 0 ? Math.min(100, Math.round((metrics.totalKm / goal.total) * 100)) : null;
  const missingKm = goal.total > 0 ? Math.max(0, Math.round(goal.total - metrics.totalKm)) : null;
  const evidenceCount = drivers.filter(driver => {
    const driverFlow = driver?.driverFlow || driver?.evidenceStatus?.driver || driver?.driverEvidenceStatus;
    const graphicFlow = driver?.graphicFlow || driver?.evidenceStatus?.graphic || driver?.graphicEvidenceStatus;
    return Boolean(driverFlow?.hasUploads || driverFlow?.completed || graphicFlow?.hasUploads || graphicFlow?.completed);
  }).length;

  return {
    campaignName: partialReportText(campaign.name, campaign.title, 'Campanha'),
    period: partialReportText(campaign.period, '-'),
    location: [api.city || campaign.city, api.state || campaign.state].filter(Boolean).join(' / ') || '-',
    description: partialReportText(api.description, campaign.description, '-'),
    monthlyValue: partialReportNumber(api.monthlyValue || campaign.monthlyValue),
    metaKms: partialReportNumber(api.metaKms || campaign.metaKms),
    status: formatStatusPill(campaign.currentStatus || campaign.status || '').label,
    generatedAt: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
    totalDrivers: drivers.length,
    installed,
    scheduled,
    review,
    evidenceCount,
    totalKm: Math.round(metrics.totalKm || 0),
    averageAdherence: metrics.averageAdherence,
    goal,
    progress,
    missingKm,
    rows: partialReportDriverRows(drivers),
  };
}

function partialReportAssetUrl(path) {
  try {
    return new URL(path, window.location.href).href;
  } catch (_) {
    return path;
  }
}

function partialReportCss(mode) {
  const isMobile = mode === 'mobile';
  return `
    @page { size: ${isMobile ? '420px 1188px' : 'A4 landscape'}; margin: ${isMobile ? '12px' : '10mm'}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #eaf0f8;
      color: #111827;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.42;
    }
    .print-toolbar {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 16px;
      background: rgba(255,255,255,.92);
      border-bottom: 1px solid #dbe4ee;
      backdrop-filter: blur(8px);
    }
    .print-toolbar button {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      background: #fff;
      color: #111827;
      padding: 9px 13px;
      font-weight: 800;
      cursor: pointer;
    }
    .report-shell {
      width: ${isMobile ? '390px' : 'min(1120px, calc(100% - 32px))'};
      margin: ${isMobile ? '12px auto' : '18px auto'};
      overflow: hidden;
      border: 1px solid #dbe4ee;
      border-radius: ${isMobile ? '18px' : '20px'};
      background: #fff;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.10);
    }
    .hero {
      display: grid;
      grid-template-columns: ${isMobile ? '1fr' : '1fr auto'};
      gap: 16px;
      padding: ${isMobile ? '22px 20px' : '26px 30px'};
      background: linear-gradient(135deg, #07111f 0%, #123b78 56%, #0b8f7f 100%);
      color: #fff;
    }
    .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .brand img { width: 48px; height: 48px; object-fit: contain; border-radius: 12px; background: #fff; padding: 6px; }
    .eyebrow { margin: 0 0 4px; font-size: 11px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; opacity: .78; }
    h1 { margin: 0; font-size: ${isMobile ? '22px' : '30px'}; line-height: 1.15; }
    .hero-meta { display: flex; flex-direction: column; justify-content: center; gap: 4px; text-align: ${isMobile ? 'left' : 'right'}; color: #dbeafe; font-size: 13px; }
    .section { padding: ${isMobile ? '18px 20px' : '22px 30px'}; border-bottom: 1px solid #e2e8f0; }
    .section:last-child { border-bottom: 0; }
    .kpis { display: grid; grid-template-columns: ${isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))'}; border: 1px solid #dbe4ee; border-radius: 16px; overflow: hidden; }
    .kpi { min-height: 92px; padding: 14px; border-right: 1px solid #e2e8f0; border-bottom: ${isMobile ? '1px solid #e2e8f0' : '0'}; background: #f8fafc; }
    .kpi:nth-child(${isMobile ? '2n' : '6n'}) { border-right: 0; }
    .kpi small { display: block; color: #64748b; font-size: 10px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; }
    .kpi strong { display: block; margin-top: 8px; font-size: ${isMobile ? '22px' : '26px'}; line-height: 1; color: #0f172a; }
    .kpi .blue { color: #1267d8; }
    .kpi .green { color: #079669; }
    .kpi .amber { color: #b77905; }
    .kpi span { display: block; margin-top: 6px; color: #64748b; font-size: 12px; }
    .summary-grid { display: grid; grid-template-columns: ${isMobile ? '1fr' : '1fr 1.35fr'}; gap: 16px; align-items: stretch; }
    .panel { border: 1px solid #dbe4ee; border-radius: 16px; padding: 16px; background: #fff; }
    h2 { margin: 0 0 12px; font-size: ${isMobile ? '17px' : '20px'}; }
    .facts { display: grid; gap: 9px; color: #334155; font-size: 13px; }
    .facts b { color: #111827; }
    .km-progress { margin-top: 10px; height: 10px; overflow: hidden; border-radius: 999px; background: #e2e8f0; }
    .km-progress span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #f59e0b, #10b981); }
    .muted { color: #64748b; }
    .driver-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .driver-table th {
      padding: 10px 8px;
      background: #f1f5f9;
      color: #64748b;
      font-size: 10px;
      letter-spacing: .07em;
      text-transform: uppercase;
      text-align: left;
      border-bottom: 1px solid #dbe4ee;
    }
    .driver-table td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .driver-table tr:last-child td { border-bottom: 0; }
    .driver-name { font-weight: 800; color: #0f172a; }
    .status-pill { display: inline-flex; border-radius: 999px; background: #eef6ff; color: #1267d8; padding: 4px 8px; font-size: 11px; font-weight: 800; }
    .mobile-list { display: grid; gap: 10px; }
    .driver-card { border: 1px solid #dbe4ee; border-radius: 14px; padding: 13px; background: #f8fafc; }
    .driver-card-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
    .driver-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin-top: 12px; font-size: 12px; }
    .driver-card-grid small { display: block; color: #64748b; font-size: 10px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
    .driver-card-grid span { display: block; margin-top: 2px; color: #111827; font-weight: 700; word-break: break-word; }
    .footer-note { color: #64748b; font-size: 11px; text-align: center; padding: 14px 20px 18px; }
    @media print {
      body { background: #fff; }
      .print-toolbar { display: none; }
      .report-shell { width: 100%; margin: 0; border-radius: 0; box-shadow: none; }
      .section { break-inside: avoid; }
      .driver-table tr, .driver-card { break-inside: avoid; }
    }
  `;
}

function buildPartialReportDesktopHtml(data) {
  const progressWidth = Number.isFinite(data.progress) ? `${data.progress}%` : '0%';
  const rows = data.rows.map(row => `
    <tr>
      <td><span class="driver-name">${escapeHTML(row.name)}</span><br><span class="muted">${escapeHTML(row.phone)}</span></td>
      <td>${escapeHTML(row.city)}</td>
      <td><span class="status-pill">${escapeHTML(row.status)}</span></td>
      <td>${escapeHTML(row.km)}</td>
      <td>${escapeHTML(row.driverOdometer)}</td>
      <td>${escapeHTML(row.graphicOdometer)}</td>
      <td>${escapeHTML(row.odometerKm)}</td>
    </tr>
  `).join('');

  return `
    <section class="section">
      <div class="kpis">
        <div class="kpi"><small>Motoristas</small><strong class="blue">${formatNumber(data.totalDrivers)}</strong><span>Total na campanha</span></div>
        <div class="kpi"><small>Instalados</small><strong class="green">${formatNumber(data.installed)}</strong><span>Veículos adesivados</span></div>
        <div class="kpi"><small>Agendados</small><strong>${formatNumber(data.scheduled)}</strong><span>Na fila de adesivagem</span></div>
        <div class="kpi"><small>KM rodado</small><strong class="blue">${formatNumber(data.totalKm)}</strong><span>Base API OD Drive</span></div>
        <div class="kpi"><small>Progresso</small><strong class="amber">${data.progress == null ? '-' : `${data.progress}%`}</strong><span>Meta estimada</span></div>
        <div class="kpi"><small>Evidências</small><strong>${formatNumber(data.evidenceCount)}</strong><span>Com envio registrado</span></div>
      </div>
    </section>
    <section class="section">
      <div class="summary-grid">
        <div class="panel">
          <h2>Status da campanha</h2>
          <div class="facts">
            <div><b>Período:</b> ${escapeHTML(data.period)}</div>
            <div><b>Local:</b> ${escapeHTML(data.location)}</div>
            <div><b>Modelo:</b> ${escapeHTML(data.description)}</div>
            <div><b>Status:</b> ${escapeHTML(data.status || '-')}</div>
            <div><b>Valor mensal:</b> ${data.monthlyValue > 0 ? `R$ ${formatNumber(data.monthlyValue)}` : '-'}</div>
          </div>
        </div>
        <div class="panel">
          <h2>Visão de KM</h2>
          <div class="facts">
            <div><b>${data.progress == null ? '-' : `${data.progress}% da meta`}</b></div>
            <div class="km-progress"><span style="width:${progressWidth}"></span></div>
            <div>KM rodado: <b>${formatNumber(data.totalKm)} km</b></div>
            <div>Meta estimada: <b>${data.goal?.total ? `${formatNumber(data.goal.total)} km` : '-'}</b></div>
            <div>Faltam: <b>${data.missingKm == null ? '-' : `${formatNumber(data.missingKm)} km`}</b></div>
          </div>
        </div>
      </div>
    </section>
    <section class="section">
      <h2>Motoristas da campanha</h2>
      <table class="driver-table">
        <thead>
          <tr>
            <th>Motorista</th>
            <th>Cidade</th>
            <th>Status</th>
            <th>KM</th>
            <th>Odômetro motorista</th>
            <th>Odômetro gráfica</th>
            <th>KM por odômetros</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7">Nenhum motorista encontrado.</td></tr>'}</tbody>
      </table>
    </section>
  `;
}

function buildPartialReportMobileHtml(data) {
  const progressWidth = Number.isFinite(data.progress) ? `${data.progress}%` : '0%';
  const rows = data.rows.map(row => `
    <article class="driver-card">
      <div class="driver-card-head">
        <div>
          <div class="driver-name">${escapeHTML(row.name)}</div>
          <div class="muted">${escapeHTML(row.city)}</div>
        </div>
        <span class="status-pill">${escapeHTML(row.status)}</span>
      </div>
      <div class="driver-card-grid">
        <div><small>Telefone</small><span>${escapeHTML(row.phone)}</span></div>
        <div><small>Placa</small><span>${escapeHTML(row.plate)}</span></div>
        <div><small>KM rodado</small><span>${escapeHTML(row.km)}</span></div>
        <div><small>KM por odômetros</small><span>${escapeHTML(row.odometerKm)}</span></div>
      </div>
    </article>
  `).join('');

  return `
    <section class="section">
      <div class="kpis">
        <div class="kpi"><small>Motoristas</small><strong class="blue">${formatNumber(data.totalDrivers)}</strong><span>Total</span></div>
        <div class="kpi"><small>Instalados</small><strong class="green">${formatNumber(data.installed)}</strong><span>Concluídos</span></div>
        <div class="kpi"><small>KM rodado</small><strong class="blue">${formatNumber(data.totalKm)}</strong><span>API OD Drive</span></div>
        <div class="kpi"><small>Progresso</small><strong class="amber">${data.progress == null ? '-' : `${data.progress}%`}</strong><span>Meta estimada</span></div>
      </div>
    </section>
    <section class="section">
      <div class="panel">
        <h2>Resumo</h2>
        <div class="facts">
          <div><b>Período:</b> ${escapeHTML(data.period)}</div>
          <div><b>Local:</b> ${escapeHTML(data.location)}</div>
          <div><b>Modelo:</b> ${escapeHTML(data.description)}</div>
          <div><b>Agendados:</b> ${formatNumber(data.scheduled)}</div>
          <div><b>Evidências recebidas:</b> ${formatNumber(data.evidenceCount)}</div>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="panel">
        <h2>Visão de KM</h2>
        <div class="facts">
          <div><b>${data.progress == null ? '-' : `${data.progress}% da meta`}</b></div>
          <div class="km-progress"><span style="width:${progressWidth}"></span></div>
          <div>KM rodado: <b>${formatNumber(data.totalKm)} km</b></div>
          <div>Faltam: <b>${data.missingKm == null ? '-' : `${formatNumber(data.missingKm)} km`}</b></div>
        </div>
      </div>
    </section>
    <section class="section">
      <h2>Motoristas</h2>
      <div class="mobile-list">${rows || '<div class="driver-card">Nenhum motorista encontrado.</div>'}</div>
    </section>
  `;
}

function buildPartialReportHtml(mode, campaign) {
  const data = partialReportBuildData(campaign);
  const logoUrl = partialReportAssetUrl('./assets/images/logo-oddrive.png');
  const isMobile = mode === 'mobile';
  const body = isMobile ? buildPartialReportMobileHtml(data) : buildPartialReportDesktopHtml(data);
  const title = `Relatório parcial - ${data.campaignName}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(title)}</title>
  <style>${partialReportCss(mode)}</style>
</head>
<body>
  <div class="print-toolbar">
    <button type="button" onclick="window.print()">Salvar como PDF</button>
    <button type="button" onclick="window.close()">Fechar</button>
  </div>
  <main class="report-shell">
    <header class="hero">
      <div class="brand">
        <img src="${escapeHTML(logoUrl)}" alt="OD Drive">
        <div>
          <p class="eyebrow">Relatório parcial</p>
          <h1>${escapeHTML(data.campaignName)}</h1>
        </div>
      </div>
      <div class="hero-meta">
        <span>${escapeHTML(isMobile ? 'PDF mobile' : 'PDF desktop')}</span>
        <span>Gerado em ${escapeHTML(data.generatedAt)}</span>
      </div>
    </header>
    ${body}
    <p class="footer-note">OD Drive - relatório parcial gerado a partir dos dados carregados no Workspace.</p>
  </main>
  <script>
    (function() {
      function waitForImages() {
        var images = Array.prototype.slice.call(document.images || []);
        if (!images.length) return Promise.resolve();
        return Promise.all(images.map(function(img) {
          if (img.complete) return Promise.resolve();
          return new Promise(function(resolve) {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        }));
      }
      window.addEventListener('load', function() {
        waitForImages().then(function() {
          setTimeout(function() { window.print(); }, 250);
        });
      });
    })();
  </script>
</body>
</html>`;
}

function generatePartialReportPdf(mode = 'desktop') {
  if (!currentCampaign) {
    alert('Carregue uma campanha antes de gerar o relatório parcial.');
    return;
  }
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) {
    alert('O navegador bloqueou a abertura do relatório. Permita pop-ups para gerar o PDF.');
    return;
  }
  const html = buildPartialReportHtml(mode === 'mobile' ? 'mobile' : 'desktop', currentCampaign);
  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
  hideModal(partialReportModal);
}

function asSummaryDriverItem(driver, minKmPerDriver, campaign) {
  const kmCtx = getDriverKmContext(driver);
  const progressPct = (kmCtx.hasKmData && minKmPerDriver > 0)
    ? (kmCtx.travelledKm / minKmPerDriver) * 100
    : null;
  const status = normalizeDriverStatus(driver?.status || driver?.statusRaw || driver?.raw?.Status || '');
  const staleDays = (kmCtx.hasKmData && kmCtx.updatedAt)
    ? Math.floor((Date.now() - kmCtx.updatedAt) / (24 * 60 * 60 * 1000))
    : null;
  const stale = Number.isFinite(staleDays) && staleDays >= KM_STALE_DAYS;

  let risk = 'ok';
  if (status === 'problema' || status === 'revisar') {
    risk = 'critical';
  } else if (!kmCtx.hasKmData) {
    risk = 'attention';
  } else if (progressPct < KM_CRITICAL_THRESHOLD) {
    risk = 'critical';
  } else if (progressPct < 100) {
    risk = 'attention';
  }

  if (stale && risk === 'ok') risk = 'attention';

  const paceRisk = calculateKmPaceRisk(kmCtx, campaign, minKmPerDriver);

  return {
    id: driver?.id || '',
    name: driver?.name || '-',
    city: driver?.city || '-',
    status,
    risk,
    stale,
    staleDays,
    hasKmData: kmCtx.hasKmData,
    travelledKm: kmCtx.travelledKm,
    progressPct,
    initialKm: kmCtx.initialKm,
    currentKm: kmCtx.currentKm,
    source: kmCtx.source,
    paceRisk,
  };
}

function buildAttentionBreakdown(attentionDrivers = [], staleDrivers = [], noKmDrivers = []) {
  const map = new Map();

  function ensureEntry(item) {
    const id = String(item?.id || '').trim();
    if (!id) return null;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: String(item?.name || 'Motorista sem nome').trim() || 'Motorista sem nome',
        reasons: new Set(),
      });
    }
    return map.get(id);
  }

  attentionDrivers.forEach(item => {
    const entry = ensureEntry(item);
    if (!entry) return;

    if (!item?.hasKmData) {
      entry.reasons.add('Sem dados de KM (inicial/atual)');
      return;
    }

    if (Number.isFinite(item?.progressPct)) {
      entry.reasons.add(`Abaixo da meta (${formatPercentCompact(item.progressPct)})`);
      return;
    }

    entry.reasons.add('Abaixo da meta');
  });

  staleDrivers.forEach(item => {
    const entry = ensureEntry(item);
    if (!entry) return;
    entry.reasons.add(`KM sem atualização há ${KM_STALE_DAYS}+ dias`);
  });

  noKmDrivers.forEach(item => {
    const entry = ensureEntry(item);
    if (!entry) return;
    entry.reasons.add('Sem dados de KM (inicial/atual)');
  });

  return Array.from(map.values())
    .map(item => ({
      ...item,
      reasons: Array.from(item.reasons),
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
}

function renderSummaryAttentionPopover(data = {}) {
  if (!summaryPriorityAttentionCard || !summaryAttentionPopover || !summaryAttentionPopoverBody) return;

  const components = data?.attentionComponents || {};
  const total = Number(components.total || 0);
  const attentionCount = Number(components.attentionDrivers || 0);
  const staleCount = Number(components.staleDrivers || 0);
  const noKmCount = Number(components.noKmDrivers || 0);
  const rows = Array.isArray(data?.attentionBreakdown) ? data.attentionBreakdown : [];

  if (total <= 0) {
    summaryAttentionPopoverBody.innerHTML = '<p class="small m0">Sem itens de atenção no momento.</p>';
    summaryPriorityAttentionCard.classList.remove('is-popover-open');
    summaryAttentionPopover.setAttribute('aria-hidden', 'true');
    return;
  }

  const componentListHtml = `
    <ul class="summary-attention-component-list">
      <li>Risco atenção: <b>${escapeHTML(String(attentionCount))}</b></li>
      <li>KM desatualizado (${escapeHTML(String(KM_STALE_DAYS))}+ dias): <b>${escapeHTML(String(staleCount))}</b></li>
      <li>Sem dados de KM: <b>${escapeHTML(String(noKmCount))}</b></li>
    </ul>
  `;

  const maxDrivers = 8;
  const visibleRows = rows.slice(0, maxDrivers);
  const driversListHtml = visibleRows.length
    ? `
      <ul class="summary-attention-driver-list">
        ${visibleRows.map(item => `
          <li>
            <strong>${escapeHTML(item.name)}</strong>
            <span>${escapeHTML(item.reasons.join(' | ') || 'Sem motivo informado')}</span>
          </li>
        `).join('')}
      </ul>
    `
    : '<p class="small m0">Sem motoristas identificados.</p>';

  const moreDriversHtml = rows.length > maxDrivers
    ? `<p class="small muted m0">+${escapeHTML(String(rows.length - maxDrivers))} motorista(s) adicional(is).</p>`
    : '';

  summaryAttentionPopoverBody.innerHTML = `
    <p class="small m0"><b>${escapeHTML(String(total))}</b> ocorrência(s) em <b>${escapeHTML(String(rows.length))}</b> motorista(s).</p>
    ${componentListHtml}
    ${driversListHtml}
    ${moreDriversHtml}
    <p class="small muted m0">Obs.: o mesmo motorista pode aparecer em mais de um critério.</p>
  `;
}

function setupSummaryAttentionPopover() {
  if (!summaryPriorityAttentionCard || !summaryAttentionPopover) return;
  summaryPriorityAttentionCard.tabIndex = 0;
  summaryPriorityAttentionCard.setAttribute('aria-describedby', 'summaryAttentionPopover');

  const open = () => {
    summaryPriorityAttentionCard.classList.add('is-popover-open');
    summaryAttentionPopover.setAttribute('aria-hidden', 'false');
  };
  const close = () => {
    summaryPriorityAttentionCard.classList.remove('is-popover-open');
    summaryAttentionPopover.setAttribute('aria-hidden', 'true');
  };

  summaryPriorityAttentionCard.addEventListener('mouseenter', open);
  summaryPriorityAttentionCard.addEventListener('mouseleave', close);
  summaryPriorityAttentionCard.addEventListener('focus', open);
  summaryPriorityAttentionCard.addEventListener('blur', close);
}

function buildSummaryAnalytics(campaign, metrics = {}) {
  const drivers = Array.isArray(campaign?.drivers) ? campaign.drivers : [];
  const totalDrivers = drivers.length;
  const counts = campaign?.counts || {};
  const reviewCount = Number(campaign?.reviewCount || counts?.revisar || 0);
  const kmGoal = getCampaignKmGoal(campaign, totalDrivers);
  const minKmPerDriver = kmGoal.perDriver;
  const driverItems = drivers.map(driver => asSummaryDriverItem(driver, minKmPerDriver, campaign));

  const criticalDrivers = driverItems.filter(item => item.risk === 'critical');
  const attentionDrivers = driverItems.filter(item => item.risk === 'attention');
  const okDrivers = driverItems.filter(item => item.risk === 'ok');
  const riskyDrivers = driverItems.filter(item => item.risk !== 'ok');
  const staleDrivers = driverItems.filter(item => item.stale);
  const noKmDrivers = driverItems.filter(item => !item.hasKmData);
  const reviewDrivers = driverItems.filter(item => item.status === 'revisar');
  const problemDrivers = driverItems.filter(item => item.status === 'problema');
  // Pace risk: motoristas que pelo ritmo atual não vão bater a meta no prazo
  const paceRiskDrivers = driverItems.filter(item => item.paceRisk?.state === 'at-risk');
  const noTimeLeftDrivers = driverItems.filter(item => item.paceRisk?.state === 'no-time-left');

  const totalKm = Number(metrics?.totalKm || 0);
  const kmMetaTotal = kmGoal.total;
  const kmGap = Math.max(0, kmMetaTotal - totalKm);
  const kmProgressPct = kmMetaTotal > 0 ? (totalKm / kmMetaTotal) * 100 : 0;
  const problemCount = Number(counts?.problema || 0);

  const priorityCritical = criticalDrivers.length + reviewCount + problemCount;
  const priorityAttention = attentionDrivers.length + staleDrivers.length + noKmDrivers.length;
  const priorityOk = okDrivers.length;
  const attentionBreakdown = buildAttentionBreakdown(attentionDrivers, staleDrivers, noKmDrivers);

  const stageEntries = [
    { key: 'agendado', label: 'Agendado', value: Number(counts?.agendado || 0) },
    { key: 'confirmado', label: 'Confirmado', value: Number(counts?.confirmado || 0) },
    { key: 'instalado', label: 'Instalado', value: Number(counts?.instalado || 0) },
    { key: 'problema', label: 'Problema', value: Number(counts?.problema || 0) },
    { key: 'revisar', label: 'Revisar', value: Number(counts?.revisar || 0) },
  ].map(entry => ({
    ...entry,
    pct: totalDrivers > 0 ? (entry.value / totalDrivers) * 100 : 0,
  }));

  const riskRank = { critical: 0, attention: 1, ok: 2 };
  const sortedRisk = [...riskyDrivers].sort((a, b) => {
    const byRisk = (riskRank[a.risk] ?? 9) - (riskRank[b.risk] ?? 9);
    if (byRisk !== 0) return byRisk;
    const ap = Number.isFinite(a.progressPct) ? a.progressPct : Number.POSITIVE_INFINITY;
    const bp = Number.isFinite(b.progressPct) ? b.progressPct : Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    const ak = Number.isFinite(a.travelledKm) ? a.travelledKm : Number.POSITIVE_INFINITY;
    const bk = Number.isFinite(b.travelledKm) ? b.travelledKm : Number.POSITIVE_INFINITY;
    if (ak !== bk) return ak - bk;
    return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
  });

  const worstDrivers = sortedRisk.slice(0, 5);
  const bestDrivers = [...driverItems]
    .filter(item => item.hasKmData && Number.isFinite(item.progressPct))
    .sort((a, b) => {
      if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
      return (b.travelledKm || 0) - (a.travelledKm || 0);
    })
    .slice(0, 5);

  const lowestProgressDrivers = [...driverItems]
    .filter(item => item.hasKmData && Number.isFinite(item.progressPct))
    .sort((a, b) => a.progressPct - b.progressPct)
    .slice(0, 5);

  // Alertas inteligentes: somente alertas ESTRATEGICOS (de prazo) que NAO estao
  // duplicados em "Resolver hoje" / "Esta semana". Itens operacionais
  // (criticos, atencao, sem KM, stale, revisar, problema) ja aparecem nesses
  // outros grupos -- nao replicar aqui para evitar redundancia.
  const alerts = [];
  if (paceRiskDrivers.length > 0) {
    alerts.push(createSummaryActionItem(
      `${paceRiskDrivers.length} motorista(s) em risco de não bater a meta no prazo da campanha.`,
      paceRiskDrivers,
      { title: 'Motoristas em risco pelo prazo', emptyText: 'Nenhum motorista em risco pelo prazo.' },
    ));
  }
  if (noTimeLeftDrivers.length > 0) {
    alerts.push(createSummaryActionItem(
      `${noTimeLeftDrivers.length} motorista(s) sem tempo restante para bater a meta (campanha encerra em <1 dia).`,
      noTimeLeftDrivers,
      { title: 'Motoristas sem tempo restante', emptyText: 'Sem motoristas nessa condição.' },
    ));
  }
  if (!alerts.length) {
    alerts.push('Operação estável: sem alertas estratégicos de prazo no momento.');
  }

  const kanbanToday = [];
  if (criticalDrivers.length) {
    kanbanToday.push(createSummaryActionItem(
      `Priorizar ${criticalDrivers.length} motorista(s) críticos de KM.`,
      criticalDrivers,
      { title: 'Prioridade crítica de hoje', emptyText: 'Nenhum motorista crítico para hoje.' },
    ));
  }
  if (reviewCount) {
    kanbanToday.push(createSummaryActionItem(
      `Resolver ${reviewCount} pendência(s) na fila Revisar.`,
      reviewDrivers,
      { title: 'Pendências em Revisar', emptyText: 'Sem motoristas vinculados em Revisar.' },
    ));
  }
  if (problemCount) {
    kanbanToday.push(createSummaryActionItem(
      `Atacar ${problemCount} caso(s) com status Problema.`,
      problemDrivers,
      { title: 'Casos com status Problema', emptyText: 'Sem motoristas com status Problema.' },
    ));
  }
  if (noKmDrivers.length) {
    kanbanToday.push(createSummaryActionItem(
      `Preencher KM inicial/atual de ${noKmDrivers.length} motorista(s).`,
      noKmDrivers,
      { title: 'Motoristas sem KM completo', emptyText: 'Todos os motoristas têm KM inicial/atual.' },
    ));
  }
  if (!kanbanToday.length) kanbanToday.push('Nenhuma urgência para hoje.');

  const kanbanWeek = [];
  if (attentionDrivers.length) {
    kanbanWeek.push(createSummaryActionItem(
      `Reforcar acompanhamento de ${attentionDrivers.length} motorista(s) abaixo da meta.`,
      attentionDrivers,
      { title: 'Acompanhamento semanal (abaixo da meta)', emptyText: 'Sem motoristas abaixo da meta para esta semana.' },
    ));
  }
  if (staleDrivers.length) {
    kanbanWeek.push(createSummaryActionItem(
      `Atualizar KM atrasado de ${staleDrivers.length} motorista(s).`,
      staleDrivers,
      { title: 'Motoristas com KM desatualizado', emptyText: 'Sem motoristas com KM atrasado.' },
    ));
  }
  if (kmGap > 0 && totalDrivers > 0) {
    kanbanWeek.push(createSummaryActionItem(
      `Reduzir gap de ${formatKmCompact(kmGap)} para atingir a meta geral.`,
      lowestProgressDrivers,
      { title: 'Piores motoristas para reduzir gap', emptyText: 'Sem base de motoristas para reduzir gap.' },
    ));
  }
  if (!kanbanWeek.length) kanbanWeek.push('Semana em dia. Manter monitoramento.');

  const kanbanWatch = [];
  if (okDrivers.length) {
    kanbanWatch.push(createSummaryActionItem(
      `${okDrivers.length} motorista(s) com indicador de KM saudavel.`,
      okDrivers,
      { title: 'Motoristas com KM saudável', emptyText: 'Nenhum motorista com indicador saudável no momento.' },
    ));
  }
  if (totalDrivers > 0 && noKmDrivers.length === 0) {
    kanbanWatch.push('Todos os motoristas possuem dados de KM para acompanhamento.');
  }
  if (kmProgressPct >= 100 && totalDrivers > 0) {
    kanbanWatch.push('Meta geral de KM da campanha atingida no período.');
  }
  if (!kanbanWatch.length) kanbanWatch.push('Monitoramento regular sem observações adicionais.');

  const nextActions = [];
  if (criticalDrivers.length > 0) {
    nextActions.push(createSummaryActionItem(
      `Priorizar ${criticalDrivers.length} motorista(s) críticos de KM.`,
      criticalDrivers,
      { title: 'Próxima ação: críticos de KM', emptyText: 'Sem motoristas críticos para priorizar.' },
    ));
  }
  if (reviewCount > 0) {
    nextActions.push(createSummaryActionItem(
      `Resolver ${reviewCount} pendência(s) em Revisar.`,
      reviewDrivers,
      { title: 'Próxima ação: revisar pendências', emptyText: 'Sem motoristas vinculados em Revisar.' },
    ));
  }
  if (noKmDrivers.length > 0) {
    nextActions.push(createSummaryActionItem(
      `Completar dados de KM para ${noKmDrivers.length} motorista(s).`,
      noKmDrivers,
      { title: 'Próxima ação: completar dados de KM', emptyText: 'Todos os motoristas têm dados de KM completos.' },
    ));
  }
  if (kmGap > 0 && totalDrivers > 0) {
    nextActions.push(createSummaryActionItem(
      `Recuperar ${formatKmCompact(kmGap)} para fechar a meta da campanha.`,
      lowestProgressDrivers,
      { title: 'Próxima ação: reduzir gap da campanha', emptyText: 'Sem motoristas com dados para reduzir gap.' },
    ));
  }
  if (!nextActions.length) nextActions.push('Sem bloqueios prioritários no momento.');

  return {
    totalDrivers,
    minKmPerDriver,
    kmGoal,
    totalKm,
    kmMetaTotal,
    kmGap,
    kmProgressPct,
    riskyCount: riskyDrivers.length,
    noKmDataCount: noKmDrivers.length,
    alertCount: alerts.length,
    priority: {
      critical: priorityCritical,
      attention: priorityAttention,
      ok: priorityOk,
    },
    attentionComponents: {
      attentionDrivers: attentionDrivers.length,
      staleDrivers: staleDrivers.length,
      noKmDrivers: noKmDrivers.length,
      total: priorityAttention,
    },
    attentionBreakdown,
    stageEntries,
    alerts,
    kanban: {
      today: kanbanToday,
      week: kanbanWeek,
      watch: kanbanWatch,
    },
    nextActions,
    worstDrivers,
    bestDrivers,
    riskDrivers: sortedRisk.slice(0, 12),
    paceRiskDrivers,
    noTimeLeftDrivers,
    hasApiKmData: driverItems.some(item => item.source === 'api' || item.source === 'api-odometer'),
    hasKmData: driverItems.some(item => item.hasKmData),
  };
}

function renderSummaryList(listElement, items = []) {
  if (!listElement) return;
  const data = Array.isArray(items) ? items : [];
  if (!data.length) {
    listElement.innerHTML = '<li>Sem itens pendentes.</li>';
    return;
  }
  listElement.innerHTML = data.map(item => {
    if (!item || typeof item !== 'object') {
      return `<li>${escapeHTML(item)}</li>`;
    }

    const label = String(item.label || '').trim() || '-';
    const driverIds = Array.isArray(item.driverIds) ? item.driverIds.filter(Boolean) : [];
    const hasDrivers = driverIds.length > 0;
    const title = String(item.title || label).trim();
    const emptyText = String(item.emptyText || '').trim();
    const tooltip = buildSummaryDrilldownTooltip(item);
    const idsPayload = hasDrivers ? driverIds.join(',') : '';

    if (!hasDrivers && !emptyText) {
      return `<li>${escapeHTML(label)}</li>`;
    }

    return `
      <li class="summary-list-item">
        <button
          type="button"
          class="summary-list-action"
          data-summary-drilldown="1"
          data-summary-title="${escapeHTML(title)}"
          data-summary-empty="${escapeHTML(emptyText)}"
          data-summary-driver-ids="${escapeHTML(idsPayload)}"
          title="${escapeHTML(tooltip || title)}"
        >
          <span class="summary-list-label">${escapeHTML(label)}</span>
          ${hasDrivers ? `<span class="summary-list-count">${escapeHTML(String(driverIds.length))}</span>` : '<span class="summary-list-count is-empty">?</span>'}
        </button>
      </li>
    `;
  }).join('');
}

function renderSummaryRankingRows(target, items = []) {
  if (!target) return;
  const data = Array.isArray(items) ? items : [];
  if (!data.length) {
    target.innerHTML = '<tr><td colspan="3" class="empty-row">Sem dados para classificar.</td></tr>';
    return;
  }
  target.innerHTML = data.map(item => `
    <tr>
      <td>${item.id ? `<button type="button" class="summary-driver-link" data-driver-detail="${escapeHTML(item.id)}">${escapeHTML(item.name)}</button>` : escapeHTML(item.name)}</td>
      <td>${escapeHTML(Number.isFinite(item.travelledKm) ? formatNumber(Math.round(item.travelledKm)) : '-')}</td>
      <td>${escapeHTML(Number.isFinite(item.progressPct) ? formatPercentCompact(item.progressPct) : '-')}</td>
    </tr>
  `).join('');
}

function renderSummaryRiskRows(target, items = []) {
  if (!target) return;
  const data = Array.isArray(items) ? items : [];
  if (!data.length) {
    target.innerHTML = '<tr><td colspan="4" class="empty-row">Nenhum motorista em risco no momento.</td></tr>';
    return;
  }
  target.innerHTML = data.map(item => {
    const pace = item.paceRisk;
    const isCritical = item.risk === 'critical' || pace?.state === 'no-time-left';
    const isWarning  = !isCritical && (item.risk === 'attention' || pace?.state === 'at-risk');
    const dotClass = isCritical
      ? 'pace-risk-dot pace-risk-dot--critical'
      : isWarning
      ? 'pace-risk-dot pace-risk-dot--warning'
      : 'pace-risk-dot pace-risk-dot--ok';
    const dotParts = [];
    if (item.risk === 'critical') dotParts.push('Prioridade: Crítico');
    else if (item.risk === 'attention') dotParts.push('Prioridade: Atenção');
    else dotParts.push('Prioridade: OK');
    if (pace?.state === 'at-risk') {
      dotParts.push(`Ritmo: ${pace.ritmoAtual} km/dia (necessário ${pace.ritmoNecessario} km/dia, faltam ${pace.kmFalt} km em ${pace.daysRemaining} dias)`);
    } else if (pace?.state === 'no-time-left') {
      dotParts.push('Ritmo: campanha encerra em menos de 1 dia');
    }
    const dotTitle = dotParts.join(' | ');
    return `
      <tr>
        <td>${item.id ? `<button type="button" class="summary-driver-link" data-driver-detail="${escapeHTML(item.id)}">${escapeHTML(item.name)}</button>` : escapeHTML(item.name)}</td>
        <td>${escapeHTML(Number.isFinite(item.travelledKm) ? formatKmCompact(item.travelledKm) : '-')}</td>
        <td>${escapeHTML(Number.isFinite(item.progressPct) ? formatPercentCompact(item.progressPct) : '-')}</td>
        <td><span class="${dotClass}" title="${escapeHTML(dotTitle)}"></span></td>
      </tr>
    `;
  }).join('');
}

function buildCardCounterTooltip(items = []) {
  const data = Array.isArray(items) ? items : [];
  const ids = getDriverIdsFromSummaryItems(data);
  const names = getDriverNamesByIds(ids);
  if (!names.length) return '';
  const max = 8;
  const preview = names.slice(0, max).join(', ');
  return names.length > max ? `${preview} +${names.length - max}` : preview;
}

function getDriverIdsFromSummaryItems(items = []) {
  const data = Array.isArray(items) ? items : [];
  const ids = [];
  const seen = new Set();
  data.forEach(item => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.driverIds)) return;
    item.driverIds.forEach(id => {
      const value = String(id || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      ids.push(value);
    });
  });
  return ids;
}

function bindCounterDrilldown(element, title, items = [], emptyText = 'Nenhum motorista relacionado.') {
  if (!element) return;
  const ids = getDriverIdsFromSummaryItems(items);
  element.dataset.summaryDrilldown = '1';
  element.dataset.summaryTitle = title || 'Motoristas relacionados';
  element.dataset.summaryEmpty = emptyText;
  element.dataset.summaryDriverIds = ids.join(',');
  element.classList.add('summary-counter-action');
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
}

function renderSummaryStageStatus() {
  // Legacy stub — replaced by scheduling status card
}

// ════════════════════════════════════════════════════════
//  SCHEDULING STATUS CARD (Resumo — Agendamentos)
// ════════════════════════════════════════════════════════

let _unscheduledDrivers = []; // cached for dispatch

async function loadSchedulingStatus() {
  if (!schedListOk || !schedListPending) return;
  try {
    const res = await authFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/status`);
    if (!res.ok) return;
    const data = await res.json();
    renderSchedulingStatus(data);
  } catch (err) {
    console.warn('[scheduling-status]', err);
  }
}

function renderSchedulingStatus(data) {
  const { scheduled = [], unscheduled = [], totalDrivers = 0 } = data;

  // Badge
  if (schedulingStatusBadge) {
    schedulingStatusBadge.textContent = `${scheduled.length} / ${totalDrivers} agendados`;
  }

  // Counts
  if (schedCountOk) schedCountOk.textContent = `(${scheduled.length})`;
  if (schedCountPending) schedCountPending.textContent = `(${unscheduled.length})`;

  // Scheduled list
  if (schedListOk) {
    if (!scheduled.length) {
      schedListOk.innerHTML = '<li class="small muted">Nenhum motorista agendou ainda.</li>';
    } else {
      schedListOk.innerHTML = scheduled.map(d => {
        const bookingInfo = (d.bookings || []).map(b => {
          const typeLabel = b.type === 'installation' ? 'Adesivagem' : 'Retirada';
          const [y, m, day] = (b.date || '').split('-');
          return `${typeLabel} ${day}/${m} ${b.startTime}–${b.endTime} (${escapeHTML(b.graphicName)})`;
        }).join('<br>');
        return `<li class="sched-driver-item sched-driver-item--ok">
          <span class="sched-driver-name">${escapeHTML(d.name)}</span>
          <span class="sched-driver-detail small muted">${bookingInfo}</span>
        </li>`;
      }).join('');
    }
  }

  // Unscheduled list
  _unscheduledDrivers = unscheduled;
  if (schedListPending) {
    if (!unscheduled.length && scheduled.length) {
      schedListPending.innerHTML = '<li class="small muted">Todos os motoristas já agendaram! ✅</li>';
    } else if (!unscheduled.length) {
      schedListPending.innerHTML = '<li class="small muted">Nenhum motorista na campanha.</li>';
    } else {
      schedListPending.innerHTML = unscheduled.map(d => {
        return `<li class="sched-driver-item sched-driver-item--pending">
          <span class="sched-driver-name">${escapeHTML(d.name)}</span>
          <span class="sched-driver-phone small muted">${escapeHTML(d.phone || 'sem tel.')}</span>
        </li>`;
      }).join('');
    }
  }

  // Dispatch bar
  const pendingWithPhone = unscheduled.filter(d => d.phone && d.phone.replace(/\D/g, '').length >= 10);
  if (schedDispatchBar) {
    schedDispatchBar.style.display = pendingWithPhone.length ? '' : 'none';
  }
  if (schedDispatchCount) schedDispatchCount.textContent = String(pendingWithPhone.length);
}

// Dispatch to unscheduled drivers — reuse the existing dispatch modal
if (btnDispatchSchedule) {
  btnDispatchSchedule.addEventListener('click', () => {
    const drivers = _unscheduledDrivers
      .filter(d => d.phone && d.phone.replace(/\D/g, '').length >= 10)
      .map(d => ({ id: d.id, name: d.name, phone: d.phone, reasons: ['Não agendou horário'] }));
    if (!drivers.length) return alert('Nenhum motorista pendente com telefone cadastrado.');
    openDispatchModal(drivers);
  });
}

function renderSummaryDriverSelector(campaign) {
  if (!summaryKmDriver) return;
  const drivers = Array.isArray(campaign?.drivers) ? campaign.drivers : [];
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  const sorted = [...drivers].sort((a, b) => collator.compare((a.name || ''), (b.name || '')));
  const currentValue = summaryKmDriver.value;
  summaryKmDriver.innerHTML = sorted
    .map(driver => `<option value="${escapeHTML(driver.id || '')}">${escapeHTML(driver.name || 'Motorista sem nome')}</option>`)
    .join('');

  if (!summaryKmDriver.options.length) {
    summaryKmDriver.innerHTML = '<option value="">Sem motoristas</option>';
    return;
  }
  const hasCurrent = Array.from(summaryKmDriver.options).some(option => option.value === currentValue);
  summaryKmDriver.value = hasCurrent ? currentValue : summaryKmDriver.options[0].value;
}

function refreshSummaryKmEditorFields() {
  if (!summaryKmDriver || !summaryKmInitial || !summaryKmCurrent) return;
  const driverId = summaryKmDriver.value;
  const entry = summaryKmLocalState?.drivers?.[driverId] || {};
  const storedInitial = parseStoredKmValue(entry.initialKm);
  const storedCurrent = parseStoredKmValue(entry.currentKm);

  // Odômetro na instalação: prefer live odometer from driver API data, fallback to stored
  const driver = Array.isArray(currentCampaign?.drivers)
    ? currentCampaign.drivers.find(d => String(d?.id) === String(driverId))
    : null;
  const odometerFromApi = driver ? getDriverOdometerFromApi(driver) : null;
  const graphicOdometerFromApi = driver ? getDriverGraphicOdometerFromApi(driver) : null;
  // Prefer graphic odometer for the installation display (more reliable than driver self-report)
  const bestOdometer = graphicOdometerFromApi ?? odometerFromApi;
  const odometerDisplay = Number.isFinite(bestOdometer) ? bestOdometer
    : (Number.isFinite(storedInitial) ? storedInitial : null);

  summaryKmInitial.value = Number.isFinite(odometerDisplay) ? Math.round(odometerDisplay) : '';
  // KM percorrido na campanha: only from manual/stored entry
  summaryKmCurrent.value = Number.isFinite(storedCurrent) ? Math.round(storedCurrent) : '';
  updateSummaryKmDeltaPreview();
}

function updateSummaryKmDeltaPreview() {
  if (!summaryKmDelta) return;
  const current = parseNumeric(summaryKmCurrent?.value);
  // KM percorrido is the direct value entered - no subtraction needed
  const delta = Number.isFinite(current) ? Math.max(0, current) : 0;
  summaryKmDelta.textContent = `${formatNumber(Math.round(delta))} KM`;
}

function setSummaryKmMessage(message, type = 'muted') {
  if (!summaryKmMessage) return;
  summaryKmMessage.classList.remove('text-success', 'text-danger');
  if (type === 'success') summaryKmMessage.classList.add('text-success');
  if (type === 'danger') summaryKmMessage.classList.add('text-danger');
  summaryKmMessage.textContent = message || '';
}

// ══════════════════════════════════════════
//  INATIVIDADE — drivers sem upload recente
// ══════════════════════════════════════════
let _inactivityState = { drivers: [], byDriverId: new Map(), thresholds: null };

function formatRelativeDays(days) {
  if (days <= 0) return 'hoje';
  if (days === 1) return '1 dia';
  return `${days} dias`;
}

function formatDateShort(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

async function loadInactivity(campaignIdArg) {
  const cid = campaignIdArg || (currentCampaign?.id) || (typeof campaignId !== 'undefined' ? campaignId : null);
  if (!cid) return;
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(cid)}/inactivity`);
    if (!res.ok) {
      console.warn('[inactivity] HTTP', res.status);
      _inactivityState = { drivers: [], byDriverId: new Map(), thresholds: null };
      renderInactivityCard();
      return;
    }
    const data = await res.json();
    const list = Array.isArray(data?.drivers) ? data.drivers : [];
    const map = new Map();
    for (const d of list) map.set(String(d.id), d);
    _inactivityState = { drivers: list, byDriverId: map, thresholds: data?.thresholds || null };
    renderInactivityCard();
    // Re-renderizar lista de motoristas para aplicar badges (se ja renderizada)
    if (typeof renderDrivers === 'function' && Array.isArray(currentCampaign?.drivers) && currentCampaign.drivers.length) {
      try { renderDrivers(currentCampaign.drivers, { preservePending: true }); } catch (_) {}
    }
  } catch (err) {
    console.error('[inactivity] load', err);
  }
}

function renderInactivityCard() {
  if (!summaryInactivityCard) return;
  const { drivers, thresholds } = _inactivityState;
  const count = drivers.length;

  if (summaryInactivityCount) summaryInactivityCount.textContent = String(count);

  // Mostra o card sempre que houver dados validos da rota; se 0 inativos,
  // ainda mostra para o usuario saber que nao ha inatividade (estado positivo).
  summaryInactivityCard.hidden = !thresholds;

  if (summaryInactivityRows) {
    summaryInactivityRows.innerHTML = '';
    for (const d of drivers) {
      const tr = document.createElement('tr');
      tr.dataset.driverId = d.id;
      tr.appendChild(createInactivityCell(d.name || '-'));
      tr.appendChild(createInactivityCell(d.status || '-'));
      tr.appendChild(createInactivityCell(formatDateShort(d.firstActivityAt || d.lastActivityAt)));
      tr.appendChild(createInactivityCell(formatRelativeDays(d.daysInactive)));
      const sevCell = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `pill inactivity-pill is-${d.severity}`;
      pill.textContent = inactivitySeverityLabel(d.severity);
      sevCell.appendChild(pill);
      tr.appendChild(sevCell);
      summaryInactivityRows.appendChild(tr);
    }
  }

  if (btnInactivityDispatch) {
    const targetable = drivers.filter((d) => d.hasPhone);
    btnInactivityDispatch.disabled = targetable.length === 0;
    btnInactivityDispatch.textContent = targetable.length > 0
      ? `Avisar ${targetable.length} com telefone`
      : 'Nenhum motorista com telefone';
  }
}

function createInactivityCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function inactivitySeverityLabel(sev) {
  if (sev === 'critical') return 'Critico';
  if (sev === 'attention') return 'Atencao';
  if (sev === 'warning') return 'Alerta';
  return sev || '-';
}

function getInactivityForDriver(driverId) {
  if (!driverId) return null;
  return _inactivityState.byDriverId.get(String(driverId)) || null;
}

async function dispatchToInactiveDrivers() {
  const targetable = _inactivityState.drivers.filter((d) => d.hasPhone);
  if (!targetable.length) return;
  // Mapeia para os objetos completos do currentCampaign (openDispatchModal espera drivers)
  const fullDrivers = (currentCampaign?.drivers || []).filter((d) =>
    targetable.some((t) => String(t.id) === String(d.id)),
  );
  if (!fullDrivers.length) {
    toast('Nao foi possivel localizar os motoristas inativos.', 'error');
    return;
  }
  await openDispatchModal(fullDrivers);
}

// ===========================================================================
//  HEATMAP DE UPLOADS (slots dia x hora)
// ===========================================================================

let _heatmapState = { matrix: null, max: 0, total: 0, peaks: [], firstAt: null, lastAt: null };

const HEATMAP_DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
const HEATMAP_DAY_LABELS_FULL = ['Domingo', 'Segunda-feira', 'Terca-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sabado'];

/**
 * Calcula nivel discreto (0..4) baseado na intensidade relativa ao maximo.
 * 0 = vazio; 1..4 = quartis crescentes.
 */
function heatmapLevel(value, max) {
  if (!value || !max) return 0;
  const ratio = value / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

async function loadHeatmap(campaignIdArg) {
  const campaignId = campaignIdArg || (currentCampaign && currentCampaign.id);
  if (!campaignId || !summaryHeatmapCard) return;
  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/heatmap`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || 'Falha ao carregar heatmap');
    _heatmapState = {
      matrix: Array.isArray(data.matrix) ? data.matrix : null,
      max: Number(data.max) || 0,
      total: Number(data.total) || 0,
      peaks: Array.isArray(data.peaks) ? data.peaks : [],
      firstAt: data.firstAt || null,
      lastAt: data.lastAt || null,
    };
    renderHeatmapCard();
  } catch (err) {
    console.warn('[heatmap] load falhou:', err);
    if (summaryHeatmapCard) summaryHeatmapCard.hidden = true;
  }
}

function renderHeatmapCard() {
  if (!summaryHeatmapCard) return;
  const state = _heatmapState;
  summaryHeatmapCard.hidden = false;

  if (summaryHeatmapTotal) {
    summaryHeatmapTotal.textContent = `${state.total} upload${state.total === 1 ? '' : 's'}`;
  }

  if (!state.matrix || !state.total) {
    if (summaryHeatmapWrap) summaryHeatmapWrap.hidden = true;
    if (summaryHeatmapEmpty) summaryHeatmapEmpty.hidden = false;
    return;
  }

  if (summaryHeatmapWrap) summaryHeatmapWrap.hidden = false;
  if (summaryHeatmapEmpty) summaryHeatmapEmpty.hidden = true;

  if (summaryHeatmapGrid) {
    const cells = [];
    // Linha de cabecalho de horas (1 celula vazia + 24 horas)
    cells.push('<div class="heatmap-corner"></div>');
    for (let h = 0; h < 24; h++) {
      const label = (h % 3 === 0) ? String(h).padStart(2, '0') : '';
      cells.push(`<div class="heatmap-hour-label">${label}</div>`);
    }
    // 7 linhas (dia + 24 horas)
    for (let d = 0; d < 7; d++) {
      cells.push(`<div class="heatmap-day-label">${HEATMAP_DAY_LABELS[d]}</div>`);
      for (let h = 0; h < 24; h++) {
        const v = state.matrix[d]?.[h] || 0;
        const level = heatmapLevel(v, state.max);
        const tip = v
          ? `${HEATMAP_DAY_LABELS_FULL[d]} ${String(h).padStart(2, '0')}h: ${v} upload${v === 1 ? '' : 's'}`
          : `${HEATMAP_DAY_LABELS_FULL[d]} ${String(h).padStart(2, '0')}h: sem uploads`;
        cells.push(`<div class="heatmap-cell" data-level="${level}" title="${tip}"></div>`);
      }
    }
    summaryHeatmapGrid.innerHTML = cells.join('');
  }

  if (summaryHeatmapPeak) {
    if (state.peaks.length) {
      const p = state.peaks[0];
      const dayLbl = HEATMAP_DAY_LABELS_FULL[p.day] || '';
      const hourLbl = String(p.hour).padStart(2, '0');
      const others = state.peaks.length > 1 ? ` (+${state.peaks.length - 1} outro${state.peaks.length === 2 ? '' : 's'} pico${state.peaks.length === 2 ? '' : 's'} empatado${state.peaks.length === 2 ? '' : 's'})` : '';
      summaryHeatmapPeak.textContent = `Pico: ${dayLbl} ${hourLbl}h com ${p.count} upload${p.count === 1 ? '' : 's'}${others}.`;
    } else {
      summaryHeatmapPeak.textContent = '';
    }
  }
}

// ===========================================================================
//  HISTORICO / TIMELINE DA CAMPANHA
// ===========================================================================

const _historyState = {
  items: [],
  nextCursor: null,
  loading: false,
  loadedFor: null,  // campaignId carregado
};

const HISTORY_PAGE_SIZE = 30;

const HISTORY_ACTION_LABELS = {
  campaign_create: 'Campanha criada',
  campaign_update: 'Campanha atualizada',
  campaign_delete: 'Campanha removida',
  campaign_import: 'Campanha importada',
  driver_create: 'Motorista cadastrado',
  driver_update: 'Motorista atualizado',
  driver_delete: 'Motorista removido',
  driver_detach: 'Motorista desvinculado',
  'driver:detach': 'Motorista desvinculado',
  evidence_upload: 'Upload de evidencia',
  evidence_delete: 'Evidencia removida',
  config_update: 'Configuracao alterada',
  km_update: 'Atualizacao de KM',
  dispatch_send: 'Disparo enviado',
  proposal_create: 'Proposta criada',
  proposal_update: 'Proposta atualizada',
};

function historyActionLabel(action) {
  if (!action) return 'Evento';
  if (HISTORY_ACTION_LABELS[action]) return HISTORY_ACTION_LABELS[action];
  return String(action).replace(/_/g, ' ');
}

function historyActionTone(action, success) {
  if (success === false) return 'error';
  const a = String(action || '').toLowerCase();
  if (a.includes('delete') || a.includes('remove')) return 'danger';
  if (a.includes('create') || a.includes('upload') || a.includes('import')) return 'success';
  if (a.includes('update') || a.includes('change')) return 'info';
  if (a.includes('dispatch') || a.includes('send')) return 'info';
  return 'neutral';
}

function formatHistoryDate(ts) {
  if (!ts || !Number.isFinite(ts)) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) { return ''; }
}

function summarizeHistoryDetails(item) {
  const det = item?.details || {};
  const parts = [];
  if (det.campaignName && item.entityType !== 'campaign') parts.push(`Campanha: ${det.campaignName}`);
  if (det.driverName) parts.push(`Motorista: ${det.driverName}`);
  if (det.graphicName) parts.push(`Grafica: ${det.graphicName}`);
  if (det.fileName) parts.push(`Arquivo: ${det.fileName}`);
  if (det.configKey && (det.oldValue !== undefined || det.newValue !== undefined)) {
    const ov = det.oldValue == null ? '-' : String(det.oldValue);
    const nv = det.newValue == null ? '-' : String(det.newValue);
    parts.push(`${det.configKey}: ${ov} -> ${nv}`);
  }
  if (det.template || det.templateId) parts.push(`Template: ${det.template || det.templateId}`);
  if (det.recipients) parts.push(`Destinatarios: ${det.recipients}`);
  if (det.reason) parts.push(`Motivo: ${det.reason}`);
  return parts.join(' | ');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderHistoryTimeline() {
  if (!historyTimeline) return;
  const items = _historyState.items;

  if (historyTotalPill) {
    historyTotalPill.hidden = !items.length;
    historyTotalPill.textContent = `${items.length} evento${items.length === 1 ? '' : 's'}${_historyState.nextCursor ? '+' : ''}`;
  }

  if (!items.length) {
    historyTimeline.innerHTML = '';
    if (historyEmpty) historyEmpty.hidden = false;
    if (btnHistoryLoadMore) btnHistoryLoadMore.hidden = true;
    return;
  }
  if (historyEmpty) historyEmpty.hidden = true;

  const html = items.map((it) => {
    const tone = historyActionTone(it.action, it.success);
    const label = historyActionLabel(it.action);
    const when = formatHistoryDate(it.timestamp);
    const who = it.name || it.username || 'sistema';
    const summary = summarizeHistoryDetails(it);
    const successBadge = it.success === false ? '<span class="history-badge is-error">falhou</span>' : '';
    return [
      '<li class="history-item" data-tone="', escapeHtml(tone), '">',
      '<div class="history-item-marker"></div>',
      '<div class="history-item-body">',
      '<div class="history-item-head">',
      '<strong class="history-item-action">', escapeHtml(label), '</strong>',
      successBadge,
      '<span class="history-item-when small muted">', escapeHtml(when), '</span>',
      '</div>',
      '<div class="history-item-meta small muted">por ', escapeHtml(who),
      it.entityType ? ` &middot; ${escapeHtml(it.entityType)}` : '',
      '</div>',
      summary ? `<div class="history-item-summary small">${escapeHtml(summary)}</div>` : '',
      '</div>',
      '</li>',
    ].join('');
  }).join('');

  historyTimeline.innerHTML = html;
  if (btnHistoryLoadMore) btnHistoryLoadMore.hidden = !_historyState.nextCursor;
}

async function loadCampaignHistory(opts = {}) {
  const { reset = false } = opts;
  const campaignId = currentCampaign?.id;
  if (!campaignId || _historyState.loading) return;

  if (reset || _historyState.loadedFor !== campaignId) {
    _historyState.items = [];
    _historyState.nextCursor = null;
    _historyState.loadedFor = campaignId;
    if (historyTimeline) historyTimeline.innerHTML = '';
  }

  _historyState.loading = true;
  if (historyLoading) historyLoading.hidden = false;
  if (historyError) historyError.hidden = true;
  if (btnHistoryLoadMore) btnHistoryLoadMore.disabled = true;

  try {
    const params = new URLSearchParams();
    params.set('limit', String(HISTORY_PAGE_SIZE));
    if (_historyState.nextCursor) params.set('cursor', String(_historyState.nextCursor));
    const url = `/api/campaigns/${encodeURIComponent(campaignId)}/history?${params.toString()}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || 'Falha ao carregar historico');

    const incoming = Array.isArray(data.items) ? data.items : [];
    _historyState.items = _historyState.items.concat(incoming);
    _historyState.nextCursor = data.nextCursor || null;
    renderHistoryTimeline();
  } catch (err) {
    console.warn('[history] load falhou:', err);
    if (historyError) {
      historyError.hidden = false;
      historyError.textContent = `Nao foi possivel carregar o historico: ${err?.message || err}`;
    }
  } finally {
    _historyState.loading = false;
    if (historyLoading) historyLoading.hidden = true;
    if (btnHistoryLoadMore) btnHistoryLoadMore.disabled = false;
  }
}

function renderSummaryDashboard(campaign, metrics = {}) {
  summaryAnalytics = buildSummaryAnalytics(campaign, metrics);
  const data = summaryAnalytics;
  if (summaryPriorityAttention) summaryPriorityAttention.textContent = String(data.priority.attention);
  renderSummaryAttentionPopover(data);

  if (summaryKmSource) {
    if (!data.hasKmData) {
      summaryKmSource.textContent = 'Fonte: sem dados de KM suficientes';
    } else {
      summaryKmSource.textContent = data.hasApiKmData
        ? 'Fonte: API OdDrive'
        : 'Fonte: Mongo + fallback local';
    }
  }
  if (summaryKmProgressLabel) summaryKmProgressLabel.textContent = `${formatPercentCompact(data.kmProgressPct)} da meta`;
  if (summaryKmGapLabel) summaryKmGapLabel.textContent = `Faltam ${formatKmCompact(data.kmGap)}`;
  if (summaryKmProgressFill) summaryKmProgressFill.style.width = `${clamp(data.kmProgressPct, 0, 100)}%`;
  if (summaryKmRuleLabel) {
    const goal = data.kmGoal || getCampaignKmGoal(currentCampaign, data.totalDrivers);
    const periodText = goal.hasPeriod
      ? `${formatGoalMonths(goal.months)} mês(es) de campanha (${formatNumber(goal.days)} dias)`
      : `${formatNumber(goal.baseMonths)} mês de campanha padrão`;
    summaryKmRuleLabel.textContent = `Regra: ${formatNumber(goal.baseKm)} KM por motorista por mês. Período considerado: ${periodText}. Meta: ${formatNumber(goal.perDriver)} KM por motorista × ${goal.driverCount} motoristas = ${formatNumber(goal.total)} KM.`;
  }

  renderSummaryList(summaryKanbanToday, data.kanban.today);
  renderSummaryList(summaryKanbanWeek, data.kanban.week);
  renderSummaryList(summaryKanbanWatch, data.kanban.watch);
  if (kanbanTodayCount) kanbanTodayCount.textContent = String(data.kanban.today.length);
  if (kanbanWeekCount) kanbanWeekCount.textContent = String(data.kanban.week.length);
  if (kanbanWatchCount) kanbanWatchCount.textContent = String(data.kanban.watch.length);
  if (kanbanTodayCount) kanbanTodayCount.title = buildCardCounterTooltip(data.kanban.today) || 'Sem motoristas vinculados.';
  if (kanbanWeekCount) kanbanWeekCount.title = buildCardCounterTooltip(data.kanban.week) || 'Sem motoristas vinculados.';
  if (kanbanWatchCount) kanbanWatchCount.title = buildCardCounterTooltip(data.kanban.watch) || 'Sem motoristas vinculados.';
  bindCounterDrilldown(kanbanTodayCount, 'Resolver hoje', data.kanban.today, 'Nenhum motorista vinculado para o card Resolver hoje.');
  bindCounterDrilldown(kanbanWeekCount, 'Esta semana', data.kanban.week, 'Nenhum motorista vinculado para o card Esta semana.');
  bindCounterDrilldown(kanbanWatchCount, 'Acompanhando', data.kanban.watch, 'Nenhum motorista vinculado para o card Acompanhando.');

  renderSummaryStageStatus(data.stageEntries, data.totalDrivers);
  loadSchedulingStatus(); // populate the scheduling status card
  renderSummaryList(summarySmartAlerts, data.alerts);
  if (smartAlertsCount) smartAlertsCount.textContent = String(data.alerts.length);

  // Unified actions total count
  const totalActions = data.kanban.today.length + data.kanban.week.length + data.kanban.watch.length + data.alerts.length;
  if (unifiedActionsCount) unifiedActionsCount.textContent = String(totalActions);

  renderSummaryRankingRows(summaryWorstDrivers, data.worstDrivers);
  renderSummaryRankingRows(summaryBestDrivers, data.bestDrivers);
  renderSummaryRiskRows(summaryRiskDrivers, data.riskDrivers);

  // Carrega/atualiza card de inatividade (cache 60s no servidor)
  loadInactivity(campaign?.id).catch(() => {});
  loadHeatmap(campaign?.id).catch(() => {});

  // Update dispatch bar visibility
  updateDispatchBar(data);
}

// ══════════════════════════════════════════
//  DISPATCH — WhatsApp messaging
// ══════════════════════════════════════════

let _dispatchTemplates = null;
let _dispatchMode = 'template'; // 'template' | 'text'

function getAttentionDriversForDispatch() {
  if (!summaryAnalytics) return [];
  const breakdown = summaryAnalytics.attentionBreakdown || [];
  const drivers = currentCampaign?.drivers || [];
  return breakdown.map(item => {
    const driver = drivers.find(d => String(d.id) === String(item.id));
    return {
      id: item.id,
      name: item.name,
      reasons: item.reasons,
      phone: driver?.phone || '',
    };
  }).filter(d => d.phone);
}

function updateDispatchBar(data) {
  if (!dispatchBar) return;
  const count = data?.priority?.attention || 0;
  if (count > 0) {
    dispatchBar.style.display = '';
    if (dispatchCount) dispatchCount.textContent = String(count);
  } else {
    dispatchBar.style.display = 'none';
  }
}

async function loadDispatchTemplates() {
  if (_dispatchTemplates) return _dispatchTemplates;
  try {
    const res = await authFetch(`/api/campaigns/dispatch/templates`);
    if (!res.ok) throw new Error('Falha ao carregar templates');
    const data = await res.json();
    _dispatchTemplates = data.items || [];
  } catch (err) {
    console.error('[dispatch] templates load error', err);
    _dispatchTemplates = [];
  }
  return _dispatchTemplates;
}

function renderDispatchTemplateSelect(templates) {
  if (!dispatchTemplateSelect) return;
  dispatchTemplateSelect.innerHTML = '';
  if (!templates.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Nenhum template aprovado disponível';
    dispatchTemplateSelect.appendChild(opt);
    return;
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Selecione um template --';
  dispatchTemplateSelect.appendChild(placeholder);
  for (const t of templates) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.language || 'pt_BR'})`;
    opt.dataset.body = t.bodyText || '';
    dispatchTemplateSelect.appendChild(opt);
  }
}

function renderDispatchDriverList(drivers) {
  if (!dispatchDriverList) return;
  dispatchDriverList.innerHTML = '';
  for (const d of drivers) {
    const li = document.createElement('li');
    li.className = 'dispatch-driver-item';
    li.innerHTML = `
      <label>
        <input type="checkbox" class="dispatch-driver-check" value="${escapeHTML(d.id)}" checked>
        <span class="dispatch-driver-name">${escapeHTML(d.name)}</span>
        <span class="dispatch-driver-phone">${escapeHTML(d.phone)}</span>
      </label>
      <span class="dispatch-driver-reason small muted">${escapeHTML((d.reasons || []).join(' · '))}</span>
    `;
    dispatchDriverList.appendChild(li);
  }
  updateDispatchSelectedCount();
}

function updateDispatchSelectedCount() {
  const checks = dispatchDriverList ? dispatchDriverList.querySelectorAll('.dispatch-driver-check:checked') : [];
  if (dispatchSelectedCount) dispatchSelectedCount.textContent = String(checks.length);
  if (btnDispatchSend) btnDispatchSend.disabled = checks.length === 0;
}

function getSelectedDispatchDriverIds() {
  if (!dispatchDriverList) return [];
  return Array.from(dispatchDriverList.querySelectorAll('.dispatch-driver-check:checked')).map(cb => cb.value);
}

async function openDispatchModal(targetDrivers) {
  if (!dispatchModal) return;
  _dispatchMode = 'template';
  if (dispatchTemplateSection) dispatchTemplateSection.classList.remove('hidden');
  if (dispatchTextSection) dispatchTextSection.classList.add('hidden');
  if (dispatchResult) { dispatchResult.classList.add('hidden'); dispatchResult.innerHTML = ''; }
  if (btnDispatchSend) { btnDispatchSend.disabled = false; btnDispatchSend.querySelector('span')?.remove(); }

  // Update mode tabs
  const modeBtns = dispatchModal.querySelectorAll('.dispatch-mode-btn');
  modeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === 'template'));

  // Load templates
  const templates = await loadDispatchTemplates();
  renderDispatchTemplateSelect(templates);
  if (dispatchTemplatePreview) dispatchTemplatePreview.textContent = '';

  // Render driver list
  renderDispatchDriverList(targetDrivers);

  showModal(dispatchModal);
}

async function executeDispatch() {
  const driverIds = getSelectedDispatchDriverIds();
  if (!driverIds.length) return alert('Nenhum motorista selecionado.');

  let templateId = null;
  let message = null;

  if (_dispatchMode === 'template') {
    templateId = dispatchTemplateSelect?.value;
    if (!templateId) return alert('Selecione um template.');
  } else {
    message = dispatchFreeText?.value?.trim();
    if (!message) return alert('Digite uma mensagem.');
  }

  if (btnDispatchSend) { btnDispatchSend.disabled = true; btnDispatchSend.textContent = 'Enviando...'; }

  try {
    const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, driverIds, message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha no disparo');

    // Show results
    if (dispatchResult) {
      const s = data.summary || {};
      let html = `<div class="dispatch-result-summary">
        <p><b>Enviadas:</b> ${s.sent || 0} &nbsp; <b>Bloqueados:</b> ${s.blocked || 0} &nbsp; <b>Falhas:</b> ${s.failed || 0} &nbsp; <b>Sem telefone:</b> ${s.noPhone || 0}</p>
      </div>`;
      if (data.results?.length) {
        html += '<ul class="dispatch-result-list">';
        for (const r of data.results) {
          const icon = r.status === 'sent' ? '✓' : (r.status === 'blocked' ? '⊘' : '✗');
          const cls = r.status === 'sent' ? 'success' : (r.status === 'blocked' ? 'warning' : 'danger');
          const errorLabel = r.code === 'CONTACT_BLOCKED' ? 'Motorista bloqueado' : (r.error || '');
          html += `<li class="${cls}"><span>${icon}</span> ${escapeHTML(r.name)} — ${escapeHTML(r.phone)} ${errorLabel ? '(' + escapeHTML(errorLabel) + ')' : ''}</li>`;
        }
        html += '</ul>';
      }
      dispatchResult.innerHTML = html;
      dispatchResult.classList.remove('hidden');
    }
  } catch (err) {
    console.error('[dispatch] error:', err);
    alert(err.message || 'Falha no disparo de mensagens.');
  } finally {
    if (btnDispatchSend) {
      btnDispatchSend.disabled = false;
      btnDispatchSend.textContent = `Enviar para ${getSelectedDispatchDriverIds().length} motoristas`;
    }
  }
}

async function openSingleDriverDispatch(driver) {
  const raw = driver?.raw || {};
  const resolvedPhone = driver?.phone || raw['Número'] || raw['Numero'] || raw['numero'] || raw['telefone'] || raw['Telefone'] || '';
  if (!resolvedPhone) return alert('Este motorista não possui telefone cadastrado.');
  const item = {
    id: driver.id,
    name: driver.name || 'Motorista',
    phone: resolvedPhone,
    reasons: [],
  };
  await openDispatchModal([item]);
}

function setupDispatchEvents() {
  // Mass dispatch button
  if (btnDispatchAll) {
    btnDispatchAll.addEventListener('click', () => {
      const drivers = getAttentionDriversForDispatch();
      if (!drivers.length) return alert('Nenhum motorista em atenção com telefone cadastrado.');
      openDispatchModal(drivers);
    });
  }

  // Mode tabs
  if (dispatchModal) {
    dispatchModal.addEventListener('click', (e) => {
      const btn = e.target.closest('.dispatch-mode-btn');
      if (!btn) return;
      _dispatchMode = btn.dataset.mode;
      dispatchModal.querySelectorAll('.dispatch-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (dispatchTemplateSection) dispatchTemplateSection.classList.toggle('hidden', _dispatchMode !== 'template');
      if (dispatchTextSection) dispatchTextSection.classList.toggle('hidden', _dispatchMode !== 'text');
    });
  }

  // Template select preview
  if (dispatchTemplateSelect) {
    dispatchTemplateSelect.addEventListener('change', () => {
      const opt = dispatchTemplateSelect.selectedOptions[0];
      if (dispatchTemplatePreview) {
        dispatchTemplatePreview.textContent = opt?.dataset?.body || '';
      }
    });
  }

  // Select all checkbox
  if (dispatchSelectAll) {
    dispatchSelectAll.addEventListener('change', () => {
      const checks = dispatchDriverList?.querySelectorAll('.dispatch-driver-check') || [];
      checks.forEach(cb => { cb.checked = dispatchSelectAll.checked; });
      updateDispatchSelectedCount();
    });
  }

  // Individual checkboxes
  if (dispatchDriverList) {
    dispatchDriverList.addEventListener('change', (e) => {
      if (e.target.classList.contains('dispatch-driver-check')) {
        updateDispatchSelectedCount();
      }
    });
  }

  // Send button
  if (btnDispatchSend) {
    btnDispatchSend.addEventListener('click', executeDispatch);
  }

  // Individual driver send button
  if (btnSendDriver) {
    btnSendDriver.addEventListener('click', () => {
      const driverId = driverDetailForm?.dataset?.driverId;
      const driver = getDriverById(driverId);
      if (!driver) return;
      hideModal(driverDetailModal);
      openSingleDriverDispatch(driver);
    });
  }
}

async function savePendingDriverChanges() {
  if (!btnSaveDrivers) return;
  if (pendingDriverChanges.size === 0 && pendingImportedDrivers.length === 0) {
    alert('Nenhuma alteração pendente.');
    return;
  }

  const originalLabel = btnSaveDrivers.textContent;
  btnSaveDrivers.disabled = true;
  btnSaveDrivers.textContent = 'Salvando...';

  try {
    let updatedCount = 0;
    let createdCount = 0;

    const entries = Array.from(pendingDriverChanges.entries()).filter(
      ([driverId]) => !isImportedDraftId(driverId),
    );
    for (const [driverId, fields] of entries) {
      const res = await authFetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/drivers/${encodeURIComponent(driverId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      pendingDriverChanges.delete(driverId);
      markDriverRowDirty(driverId, false);
      updatedCount += 1;
    }

    const importedQueue = [...pendingImportedDrivers];
    for (const entry of importedQueue) {
      const fields = {};
      Object.entries(entry?.fields || {}).forEach(([key, value]) => {
        const stringValue = String(value ?? '').trim();
        if (stringValue !== '') fields[key] = stringValue;
      });
      if (!fields.Nome) continue;

      fields.Status = normalizeImportedStatus(fields.Status || 'agendado');
      if (fields.Numero && !fields['Número']) fields['Número'] = fields.Numero;
      if (fields.Observacoes && !fields['Observações']) fields['Observações'] = fields.Observacoes;

      const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/drivers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      createdCount += 1;
      removePendingImportedDriver(entry.tempId);
    }

    pendingImportedDrivers = [];
    await init();
    alert(`Alterações salvas com sucesso. Atualizados: ${updatedCount}. Criados: ${createdCount}.`);
  } catch (err) {
    console.error(err);
    alert('Não foi possível salvar as alterações.');
  } finally {
    btnSaveDrivers.textContent = originalLabel;
    updateSaveButtonState();
  }
}
function populateSummary(campaign, metrics = {}) {
  currentCampaign = campaign;
  ensureSummaryKmLocalState(campaign);
  el('#campTitle').textContent = campaign.name || 'Campanha';
  el('#campPeriod').textContent = campaign.period || '-';

  // Preencher campos da API (city, state, description, monthlyValue, metaKms)
  const api = campaign.apiData || {};
  const locationParts = [api.city, api.state].filter(Boolean);
  if (locationParts.length) {
    el('#campLocation').textContent = locationParts.join(' / ');
    const line = document.getElementById('campLocationLine');
    if (line) line.style.display = '';
  }
  if (api.description) {
    el('#campDescription').textContent = api.description;
    const line = document.getElementById('campDescriptionLine');
    if (line) line.style.display = '';
  }
  if (Number(api.monthlyValue) > 0 || api.metaKms > 0) {
    el('#campMonthlyValue').textContent = Number(api.monthlyValue) > 0
      ? `R$ ${Number(api.monthlyValue).toLocaleString('pt-BR')}`
      : '-';
    el('#campMetaKms').textContent = api.metaKms > 0
      ? api.metaKms.toLocaleString('pt-BR')
      : '-';
    const line = document.getElementById('campValueLine');
    if (line) line.style.display = '';
  }

  const code = String(campaign?.campaignCode || '').trim().toUpperCase();
  const hasCode = Boolean(code);
  if (campaignCodeValue) {
    campaignCodeValue.textContent = hasCode ? code : '---';
    if (hasCode) campaignCodeValue.dataset.code = code;
    else delete campaignCodeValue.dataset.code;
    campaignCodeValue.classList.toggle('is-empty', !hasCode);
  }
  if (btnCopyCampaignCode) {
    btnCopyCampaignCode.disabled = !hasCode;
    if (hasCode) btnCopyCampaignCode.removeAttribute('aria-disabled');
    else btnCopyCampaignCode.setAttribute('aria-disabled', 'true');
  }
  if (graphicAccessHint) {
    graphicAccessHint.textContent = hasCode
      ? 'Compartilhe com a gráfica o nome do responsável cadastrado e o código abaixo. Esses dois campos são usados para acessar a área da gráfica.'
      : 'Esta campanha ainda não possui código. Gere um novo login ou salve a campanha novamente para criar o código automaticamente.';
  }
  setCopyCampaignMessage(
    hasCode
      ? 'Clique em copiar para compartilhar o código com a gráfica.'
      : 'Código ainda não definido para esta campanha.',
    hasCode ? 'muted' : 'muted',
  );

  if (campaignStatusSelect) {
    if (!campaignStatusSelect.options.length) {
      CAMPAIGN_STATUS_OPTIONS.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        campaignStatusSelect.appendChild(option);
      });
    }
    const normalizedStatus = normalizeKey(campaign.status || 'ativa');
    const selected = CAMPAIGN_STATUS_OPTIONS.includes(normalizedStatus)
      ? normalizedStatus
      : CAMPAIGN_STATUS_OPTIONS[0];
    campaignStatusSelect.value = selected;
    campaignStatusSelect.dataset.currentValue = selected;
  }

  renderCounts(campaign.counts);

  el('#kpiKm').textContent = formatNumber(Math.round(metrics.totalKm || 0));

  renderSummaryDashboard(campaign, metrics);

  const configInfo = el('#configInfo');
  if (configInfo) {
    const infos = [
      campaign.sheetId && `Sheet ID: ${campaign.sheetId}`,
      campaign.sheetName && `Aba: ${campaign.sheetName}`,
      summaryAnalytics && `Regra KM/motorista: ${formatNumber(summaryAnalytics.minKmPerDriver)}`,
    ].filter(Boolean);
    configInfo.textContent = infos.length ? infos.join(' | ') : configInfo.textContent;
  }
  if (cooldownDriverInput) cooldownDriverInput.value = Number(campaign.driverCooldownDays ?? 10);
  if (cooldownGraphicInput) cooldownGraphicInput.value = Number(campaign.graphicCooldownDays ?? 10);
  if (evidenceWindowInput) evidenceWindowInput.value = Number(campaign.evidenceWindowDays ?? 30);
  updateDriverTargetLabel(campaign.driverTarget ?? 0);

  renderSummaryDriverSelector(campaign);
  refreshSummaryKmEditorFields();

  if (summaryAnalytics?.nextActions) {
    renderSummaryList(el('#nextSteps'), summaryAnalytics.nextActions);
  }

  // Setup KM periods control (if present in DOM)
  try { setupKmPeriodsControl(); } catch (e) { /* ignore */ }
}

function handleSummaryQuickAction(action) {
  if (!action) return;
  if (action.startsWith('tab-')) {
    activateTab(action.replace('tab-', ''));
    return;
  }
  if (action === 'scroll-km-editor' && summaryKmEditorCard) {
    summaryKmEditorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function persistDriverSummaryKm(driverId, initialKm, currentKm) {
  const roundedInitialKm = Math.max(0, Math.round(Number(initialKm) || 0));
  // currentKm = KM percorrido na campanha (independent of odometer snapshot)
  const roundedCurrentKm = Math.max(0, Math.round(Number(currentKm) || 0));

  const summaryEndpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/drivers/${encodeURIComponent(driverId)}/summary-km`;
  const fallbackEndpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/drivers/${encodeURIComponent(driverId)}`;

  let primaryError = null;
  try {
    const res = await authFetch(summaryEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initialKm: roundedInitialKm,
        currentKm: roundedCurrentKm,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(text || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const payload = await res.json();
    return { payload, usedFallback: false };
  } catch (err) {
    primaryError = err;
  }

  const fallbackFields = {
    'KM INICIAL': roundedInitialKm,
    'ODOMETRO ATUAL': roundedCurrentKm,
    'DRV ODOMETRO VALOR INST': String(roundedCurrentKm),
  };
  const fallbackRes = await authFetch(fallbackEndpoint, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fallbackFields }),
  });
  if (!fallbackRes.ok) {
    const fallbackText = await fallbackRes.text();
    const error = new Error(fallbackText || `HTTP ${fallbackRes.status}`);
    error.status = fallbackRes.status;
    error.primaryError = primaryError;
    throw error;
  }
  const fallbackPayload = await fallbackRes.json();
  return { payload: fallbackPayload, usedFallback: true };
}

async function saveSummaryKmEntry(event) {
  if (event) event.preventDefault();
  if (!summaryKmDriver || !currentCampaign) return;
  const driverId = summaryKmDriver.value;
  if (!driverId) {
    setSummaryKmMessage('Selecione um motorista para salvar os valores.', 'danger');
    return;
  }
  // initialKm = odômetro na instalação (read-only, sourced from driver flow)
  const initialKm = parseNumeric(summaryKmInitial?.value);
  // currentKm = KM percorrido na campanha (manual / futuro via API)
  const currentKm = parseNumeric(summaryKmCurrent?.value);
  if (!Number.isFinite(currentKm) || currentKm < 0) {
    setSummaryKmMessage('Informe um valor válido de KM percorrido.', 'danger');
    return;
  }

  try {
    setSummaryKmMessage('Salvando KM no servidor...', 'muted');
    const { payload, usedFallback } = await persistDriverSummaryKm(driverId, initialKm, currentKm);

    if (payload?.driver && Array.isArray(currentCampaign?.drivers)) {
      currentCampaign.drivers = currentCampaign.drivers.map(driver => (
        String(driver?.id) === String(driverId) ? { ...driver, ...payload.driver } : driver
      ));
    }

    setDriverLocalKm(driverId, initialKm, currentKm);
    setSummaryKmMessage(
      usedFallback
        ? 'KM salvo no servidor (modo compatibilidade). Resumo atualizado.'
        : 'KM salvo no servidor. Resumo atualizado.',
      'success',
    );
    const metrics = calculateMetrics(currentCampaign?.drivers || []);
    populateSummary(currentCampaign, metrics);
  } catch (err) {
    console.error(err);
    setSummaryKmMessage('Falha ao salvar KM no servidor.', 'danger');
  }
}

async function seedLocalKmForNewDriver(driverId) {
  if (!driverId) return;
  const hasInitial = driverFormKmInitial && driverFormKmInitial.value !== '';
  const hasCurrent = driverFormKmCurrent && driverFormKmCurrent.value !== '';
  if (!hasInitial && !hasCurrent) return;
  const initialKm = parseNumeric(driverFormKmInitial?.value);
  const currentInput = parseNumeric(driverFormKmCurrent?.value);
  const safeInitialKm = Number.isFinite(initialKm) ? initialKm : 0;
  // currentKm = KM percorrido na campanha; default 0 (not the odometer snapshot)
  const safeCurrentKm = hasCurrent && Number.isFinite(currentInput) ? currentInput : 0;
  setDriverLocalKm(driverId, safeInitialKm, safeCurrentKm);
  try {
    await persistDriverSummaryKm(driverId, safeInitialKm, safeCurrentKm);
  } catch (err) {
    console.warn('Falha ao persistir KM inicial do motorista no backend:', err?.message || err);
  }
}

async function copyCampaignCodeToClipboard() {
  const code = campaignCodeValue?.dataset?.code || '';
  const value = String(code || '').trim();
  if (!value) {
    setCopyCampaignMessage('Código ainda não definido para esta campanha.', 'muted');
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const temp = document.createElement('input');
      temp.value = value;
      temp.setAttribute('readonly', 'true');
      temp.style.position = 'absolute';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      temp.setSelectionRange(0, value.length);
      const ok = document.execCommand ? document.execCommand('copy') : false;
      document.body.removeChild(temp);
      if (!ok) throw new Error('Clipboard API indisponível');
    }
    setCopyCampaignMessage('Código copiado para a área de transferência.', 'success');
  } catch (err) {
    console.error(err);
    setCopyCampaignMessage('Não foi possível copiar automaticamente. Copie manualmente.', 'muted');
  }
}

async function init() {
  if (!campaignId) {
    alert('Campanha não encontrada (ID ausente).');
    window.location.href = 'index.html';
    return;
  }
  console.debug('init campaignId=', campaignId);

  // Buscar dados frescos do backend (MongoDB)
  try {
    const data = await fetchCampaign(campaignId);
    renderCampaignData(data);
  } catch (err) {
    console.error('init: failed to load campaign', err);
    const details = [];
    if (err && err.status) details.push(`status=${err.status}`);
    if (err && err.responseText) details.push(err.responseText);
    const msg = `Erro ao carregar detalhes da campanha. ${details.join('\n')}`;
    alert(msg);
  }
}

let _cwCampaignInitialized = false;
function renderCampaignData(data) {
  currentCampaign = data;
  ensureSummaryKmLocalState(data);
  const metrics = calculateMetrics(data.drivers);
  populateSummary(data, metrics);
  renderDrivers(data.drivers);
  loadDriverBlockedPolicies(data.drivers).catch(() => {});
  renderGraphics(data.graphics || []);
  renderKm(data.drivers);
  renderReview(data.review);
  try { renderAcompanhe(data); } catch (e) { /* non-fatal */ }
  // Widgets: init na 1ª carga (dados prontos), refresh nas seguintes
  if (!_cwCampaignInitialized) {
    initCampaignCustomWidgets();
    _cwCampaignInitialized = true;
  } else if (window.CustomWidgets) {
    const _minKm = getSummaryMinKmPerDriver(currentCampaign);
    const _drvs = Array.isArray(currentCampaign.drivers) ? currentCampaign.drivers : [];
    if (_drvs.length && _minKm > 0) window.CustomWidgets.enrichDrivers(_drvs, _minKm);
    window.CustomWidgets.refresh('campaigns');
  }
}

function setupTabs() {
  tabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
}

function activateTab(tabName) {
  if (!tabName) return;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  panels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tabName}`));
  // Carrega historico sob demanda na primeira ativacao da aba
  if (tabName === 'historico' && currentCampaign?.id && _historyState.loadedFor !== currentCampaign.id) {
    loadCampaignHistory({ reset: true }).catch(() => {});
  }
}

// ===========================================================================
//  COLUNAS PERSONALIZAVEIS (drivers table)
// ===========================================================================

const COLS_STORAGE_KEY = 'campaign-drivers-cols-v1';
const COLS_TOGGLEABLE = ['city', 'status', 'km', 'odoDriver', 'odoGraphic', 'odoDistance', 'adhesion'];

function loadDriverColsState() {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch (_) { return null; }
}

function saveDriverColsState(state) {
  try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

function applyDriverColsClasses(state) {
  if (!driversTable) return;
  for (const col of COLS_TOGGLEABLE) {
    const visible = state[col] !== false;
    driversTable.classList.toggle(`tbl-hide-${col}`, !visible);
  }
}

function setupDriverColsMenu() {
  if (!btnDriversCols || !driversColsPanel || !driversTable) return;

  // Estado inicial: tudo visivel se nao houver storage
  const stored = loadDriverColsState() || {};
  for (const col of COLS_TOGGLEABLE) {
    if (typeof stored[col] !== 'boolean') stored[col] = true;
  }
  applyDriverColsClasses(stored);

  // Reflete estado nos checkboxes
  const checkboxes = driversColsPanel.querySelectorAll('input[type="checkbox"][data-col-toggle]');
  checkboxes.forEach((cb) => {
    const col = cb.getAttribute('data-col-toggle');
    if (!col) return;
    cb.checked = stored[col] !== false;
    cb.addEventListener('change', () => {
      stored[col] = !!cb.checked;
      applyDriverColsClasses(stored);
      saveDriverColsState(stored);
    });
  });

  // Toggle do menu
  btnDriversCols.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const isOpen = !driversColsPanel.hidden;
    driversColsPanel.hidden = isOpen;
    btnDriversCols.setAttribute('aria-expanded', String(!isOpen));
  });
  // Fecha clicando fora
  document.addEventListener('click', (ev) => {
    if (driversColsPanel.hidden) return;
    if (driversColsPanel.contains(ev.target) || ev.target === btnDriversCols) return;
    driversColsPanel.hidden = true;
    btnDriversCols.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  try { setupDriverColsMenu(); } catch (_) {}

  // Bloquear modal
  if (driverBlockModal) {
    driverBlockModal.addEventListener('click', ev => {
      if (ev.target.closest('[data-modal-dismiss]')) closeDriverBlockModal();
    });
  }
  if (btnDriverBlockSave) {
    btnDriverBlockSave.addEventListener('click', () => saveDriverBlockState());
  }
  if (driverBlockReasonInput) {
    driverBlockReasonInput.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); saveDriverBlockState(); }
    });
  }

  // Filtro ocultar bloqueados
  if (chkHideBlocked) {
    chkHideBlocked.addEventListener('change', () => {
      hideBlockedDrivers = chkHideBlocked.checked;
      if (currentCampaign?.drivers) {
        renderDrivers(currentCampaign.drivers, { preservePending: true });
      }
    });
  }
  // Activate tab from URL param (e.g., ?tab=acompanhe from notification shortcuts)
  const initialTab = urlParams.get('tab');
  if (initialTab) activateTab(initialTab);
  setupSummaryAttentionPopover();
  init();
  // Acompanhe UI setup
  try { setupAcompanheUI(); } catch (e) {}
  resetStatusPanel();

  // Smart F5: workspace parent sends SMART_REFRESH via postMessage
  window.addEventListener('message', async event => {
    if (event.data && event.data.type === 'SMART_REFRESH' && campaignId) {
      try {
        const data = await fetchCampaign(campaignId);
        renderCampaignData(data);
      } catch (err) {
        console.warn('[SmartRefresh] Falha ao atualizar campanha:', err.message);
      }
    }
  });

  // Intercept F5/Ctrl+R inside iframe — refresh data without reloading
  document.addEventListener('keydown', async event => {
    const isRefreshKey = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key === 'r');
    if (isRefreshKey && campaignId) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const data = await fetchCampaign(campaignId);
        renderCampaignData(data);
      } catch (err) {
        console.warn('[SmartRefresh] Falha ao atualizar campanha:', err.message);
      }
    }
  });

  // View toggle: Tabela / Pipeline
  const driversViewToggle = document.getElementById('driversViewToggle');
  if (driversViewToggle) {
    driversViewToggle.addEventListener('click', event => {
      const btn = event.target.closest('.view-toggle-btn');
      if (!btn) return;
      const view = btn.dataset.view;
      if (view) setDriversView(view);
    });
  }

  document.querySelectorAll('[data-summary-action]').forEach(button => {
    button.addEventListener('click', () => handleSummaryQuickAction(button.dataset.summaryAction));
  });

  if (summaryKmDriver) {
    summaryKmDriver.addEventListener('change', () => {
      refreshSummaryKmEditorFields();
      setSummaryKmMessage('');
    });
  }
  // summaryKmInitial is readonly (odômetro snapshot) - no input listener needed
  if (summaryKmCurrent) summaryKmCurrent.addEventListener('input', updateSummaryKmDeltaPreview);
  if (summaryKmForm) summaryKmForm.addEventListener('submit', saveSummaryKmEntry);

  if (btnVerifyDriver) {
    btnVerifyDriver.addEventListener('click', () => handleVerificationAction('driver'));
  }
  if (btnVerifyGraphic) {
    btnVerifyGraphic.addEventListener('click', () => handleVerificationAction('graphic'));
  }

  if (btnCopyCampaignCode) {
    btnCopyCampaignCode.addEventListener('click', event => {
      event.preventDefault();
      copyCampaignCodeToClipboard();
    });
  }

  document.addEventListener('click', event => {
    const drilldown = event.target.closest('[data-summary-drilldown]');
    if (drilldown) {
      const title = String(drilldown.dataset.summaryTitle || 'Motoristas relacionados').trim();
      const emptyText = String(drilldown.dataset.summaryEmpty || 'Nenhum motorista relacionado.').trim();
      const ids = String(drilldown.dataset.summaryDriverIds || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
      openSummaryDrilldown(title, ids, emptyText);
      return;
    }

    const openDriver = event.target.closest('[data-summary-open-driver]');
    if (openDriver) {
      const driverId = String(openDriver.dataset.summaryOpenDriver || '').trim();
      if (driverId) {
        if (summaryDrilldownModal) hideModal(summaryDrilldownModal);
        activateTab('motoristas');
        openDriverDetail(driverId);
      }
      return;
    }

    const driverDetail = event.target.closest('[data-driver-detail]');
    if (driverDetail) {
      const driverId = String(driverDetail.dataset.driverDetail || '').trim();
      if (driverId) openDriverDetail(driverId);
      return;
    }

    const sendDriver = event.target.closest('[data-drilldown-send-driver]');
    if (sendDriver) {
      const driverId = String(sendDriver.dataset.drilldownSendDriver || '').trim();
      if (driverId) {
        const driver = getDriverById(driverId);
        if (driver) {
          if (summaryDrilldownModal) hideModal(summaryDrilldownModal);
          openSingleDriverDispatch(driver);
        }
      }
      return;
    }

    const dismiss = event.target.closest('[data-modal-dismiss]');
    if (dismiss) {
      const modal = dismiss.closest('.modal');
      if (modal) hideModal(modal);
    }
  });

  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.classList?.contains('summary-counter-action')) {
      event.preventDefault();
      event.target.click();
      return;
    }
    if (event.key === 'Escape') {
      const open = Array.from(document.querySelectorAll('.modal:not(.hidden)'));
      const last = open[open.length - 1];
      if (last) hideModal(last);
    }
  });

  if (btnSaveDrivers) {
    btnSaveDrivers.addEventListener('click', savePendingDriverChanges);
    updateSaveButtonState();
  }

  if (btnImportDrivers && importDriversFile) {
    btnImportDrivers.addEventListener('click', () => {
      importDriversFile.click();
    });
    importDriversFile.addEventListener('change', handleDriversSpreadsheetSelected);
  }

  if (btnExportDrivers) {
    btnExportDrivers.addEventListener('click', () => exportDriversFile());
  }

  if (btnReport) {
    btnReport.addEventListener('click', openPartialReportModal);
  }

  if (btnPartialReportDesktop) {
    btnPartialReportDesktop.addEventListener('click', () => generatePartialReportPdf('desktop'));
  }

  if (btnPartialReportMobile) {
    btnPartialReportMobile.addEventListener('click', () => generatePartialReportPdf('mobile'));
  }

  if (btnInactivityRefresh) {
    btnInactivityRefresh.addEventListener('click', () => loadInactivity());
  }
  if (btnInactivityDispatch) {
    btnInactivityDispatch.addEventListener('click', () => dispatchToInactiveDrivers());
  }

  if (btnHistoryRefresh) {
    btnHistoryRefresh.addEventListener('click', () => loadCampaignHistory({ reset: true }));
  }
  if (btnHistoryLoadMore) {
    btnHistoryLoadMore.addEventListener('click', () => loadCampaignHistory());
  }

  if (btnAddGraphic) {
    btnAddGraphic.addEventListener('click', () => openGraphicModal());
  }

  if (graphicForm) {
    graphicForm.addEventListener('submit', submitGraphicForm);
  }

  if (tblGraphics) {
    tblGraphics.addEventListener('click', async event => {
      const editButton = event.target.closest('.graphic-edit');
      if (editButton) {
        const graphicId = editButton.dataset.graphicId;
        const record = currentCampaign?.graphics?.find(g => g.id === graphicId);
        if (record) openGraphicModal(record);
        return;
      }

      const deleteButton = event.target.closest('.graphic-delete');
      if (deleteButton) {
        const graphicId = deleteButton.dataset.graphicId;
        if (!graphicId) return;
        const ok = await confirmDialog('Deseja remover esta gráfica?', {
          title: 'Remover gráfica',
          confirmLabel: 'Remover',
          cancelLabel: 'Cancelar',
          tone: 'danger',
        });
        if (!ok) return;
        const originalText = deleteButton.textContent;
        try {
          deleteButton.disabled = true;
          deleteButton.textContent = 'Removendo...';
          const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/graphics/${encodeURIComponent(graphicId)}`, { method: 'DELETE' });
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || `HTTP ${res.status}`);
          }
          await init();
        } catch (err) {
          console.error(err);
          alert('Não foi possível remover a gráfica.');
        } finally {
          deleteButton.disabled = false;
          deleteButton.textContent = originalText;
        }
      }
    });
  }

  if (tblDrivers) {
    tblDrivers.addEventListener('click', async event => {
      const nameButton = event.target.closest('.driver-name');
      if (nameButton) {
        const driverId = nameButton.dataset.driverId;
        if (driverId) openDriverDetail(driverId);
        return;
      }

      const blockButton = event.target.closest('.driver-action-block');
      if (blockButton) {
        const driverId = blockButton.dataset.driverId;
        if (!driverId) return;
        openDriverBlockModal(driverId, blockButton.dataset.blocked === '1');
        return;
      }

      const deleteButton = event.target.closest('.driver-action-delete');
      if (deleteButton) {
        const driverId = deleteButton.dataset.driverId;
        if (!driverId) return;

        if (isImportedDraftId(driverId)) {
          const okDraft = await confirmDialog('Remover este motorista importado da fila?', {
            title: 'Remover da fila',
            confirmLabel: 'Remover',
            cancelLabel: 'Cancelar',
            tone: 'danger',
          });
          if (!okDraft) return;
          removePendingImportedDriver(driverId);
          renderDrivers(currentCampaign?.drivers || [], { preservePending: true });
          updateSaveButtonState();
          return;
        }

        const ok = await confirmDialog('Deseja retirar este motorista da campanha? O cadastro, as evidencias e o historico serao mantidos.', {
          title: 'Desvincular motorista',
          confirmLabel: 'Desvincular',
          cancelLabel: 'Cancelar',
          tone: 'danger',
        });
        if (!ok) return;

        const original = deleteButton.textContent;
        try {
          deleteButton.disabled = true;
          deleteButton.textContent = 'Desvinculando...';
          const res = await authFetch(
            `/api/campaigns/${encodeURIComponent(campaignId)}/drivers/${encodeURIComponent(driverId)}`,
            { method: 'DELETE' },
          );
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
          }
          await init();
        } catch (err) {
          console.error(err);
          alert('Nao foi possivel desvincular o motorista da campanha.');
        } finally {
          if (document.body.contains(deleteButton)) {
            deleteButton.disabled = false;
            deleteButton.textContent = original;
          }
        }
      }
    });
  }

  // KM table click handling (open edit modal)
  const tblKm = document.getElementById('tblKm');
  if (tblKm) {
    tblKm.addEventListener('click', event => {
      const nameButton = event.target.closest('.km-name');
      if (nameButton) {
        const driverId = nameButton.dataset.driverId;
        if (driverId) openKmEdit(driverId);
      }
    });
  }

  if (btnImportKm) {
    btnImportKm.addEventListener('click', openImportKmModal);
  }

  if (importKmForm) {
    importKmForm.addEventListener('submit', submitImportKmForm);
  }

  const btnSyncKm = document.getElementById('btnSyncKm');
  if (btnSyncKm) {
    btnSyncKm.addEventListener('click', async () => {
      if (!currentCampaign?.kmSheetId && !currentCampaign?.sheetId) {
        alert('Campanha não possui planilha vinculada para sincronização de KM. Primeiro importe a planilha de KM.');
        return;
      }
      const spreadsheetId = currentCampaign.kmSheetId || currentCampaign.sheetId;
      const sheetName = currentCampaign.kmSheetName || currentCampaign.sheetName || 'Planilha1';
      try {
        btnSyncKm.disabled = true;
        btnSyncKm.textContent = 'Sincronizando KM...';
        const res = await authFetch('/api/imports/km', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spreadsheetId, sheetName, campaignId }),
        });
        if (!res.ok) {
          let body;
          try { body = await res.json(); } catch (e) { body = await res.text(); }
          const msg = body && typeof body === 'object' ? `${body.error || ''}\n${body.detail || ''}\n${body.hint || ''}` : String(body || 'Erro');
          throw new Error(msg);
        }
        const result = await res.json();
        alert(`Sincronização de KM concluída. Vinculados: ${result.linked} | Revisar: ${result.review}`);
        await init();
      } catch (err) {
        console.error(err);
        alert(String(err.message || err));
      } finally {
        btnSyncKm.disabled = false;
        btnSyncKm.textContent = 'Sincronizar KM';
      }
    });
  }

  const reviewTable = document.getElementById('tblReview');
  if (reviewTable) {
    reviewTable.addEventListener('click', async event => {
      const actionBtn = event.target.closest('[data-review-action]');
      if (!actionBtn) return;
      const reviewId = actionBtn.dataset.reviewId;
      const action = actionBtn.dataset.reviewAction;
      if (!reviewId || !action) return;
      const row = actionBtn.closest('tr');
      if (!row) return;

      if (action === 'apply-status') {
        const select = row.querySelector('.review-status-select');
        if (!select) return;
        const newStatus = select.value;
        if (!newStatus) {
          alert('Selecione um status válido.');
          return;
        }
        const ignoreBtn = row.querySelector('[data-review-action="ignore"]');
        const originalText = actionBtn.textContent;
        actionBtn.disabled = true;
        actionBtn.textContent = 'Aplicando...';
        if (ignoreBtn) ignoreBtn.disabled = true;
        try {
          const res = await authFetch(
            `/api/campaigns/${encodeURIComponent(campaignId)}/review/${encodeURIComponent(reviewId)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: newStatus }),
            },
          );
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
          }
          await init();
        } catch (err) {
          console.error(err);
          alert('Não foi possível aplicar o status.');
          actionBtn.disabled = false;
          actionBtn.textContent = originalText;
          if (ignoreBtn) ignoreBtn.disabled = false;
          return;
        }
        return;
      }

      if (action === 'ignore') {
        const ok = await confirmDialog('Deseja ignorar este item?', {
          title: 'Ignorar item',
          confirmLabel: 'Ignorar',
          cancelLabel: 'Cancelar',
          tone: 'danger',
        });
        if (!ok) return;
        actionBtn.disabled = true;
        try {
          const res = await authFetch(
            `/api/campaigns/${encodeURIComponent(campaignId)}/review/${encodeURIComponent(reviewId)}`,
            { method: 'DELETE' },
          );
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
          }
          await init();
        } catch (err) {
          console.error(err);
          alert('Não foi possível ignorar o item.');
          actionBtn.disabled = false;
        }
      }
    });
  }
  if (btnSaveKm) {
    btnSaveKm.addEventListener('click', saveKmChanges);
    updateSaveKmButtonState();
  }

  if (btnAddDriver) {
    btnAddDriver.addEventListener('click', () => {
      if (driverForm) driverForm.reset();
      renderDriverFormFields();

      // If a development preset is enabled, prefill some fields to speed testing
      try {
        if (DEV_DRIVER_PRESET && DEV_DRIVER_PRESET.enabled) {
          // Wait a tick so renderDriverFormFields has created inputs
          setTimeout(() => {
            const inputs = driverFormFields ? Array.from(driverFormFields.querySelectorAll('[data-column]')) : [];
            for (const input of inputs) {
              const col = String(input.dataset.column || '').toLowerCase();
              // Place phone into the Nome field if requested
              if (DEV_DRIVER_PRESET.injectPhoneIntoName && col === 'nome') {
                input.value = DEV_DRIVER_PRESET.phone || '';
                input.dataset.originalValue = input.value;
              }
              // Populate any phone/celular/telefone field if present
              if (/(telefone|celular|phone|mobile)/i.test(col)) {
                input.value = DEV_DRIVER_PRESET.phone || '';
                input.dataset.originalValue = input.value;
              }
              // Also populate a full name field if present (so DB stores the real name if needed)
              if (col === 'nome completo' || col === 'nome_completo' || (col === 'nome' && !DEV_DRIVER_PRESET.injectPhoneIntoName)) {
                input.value = DEV_DRIVER_PRESET.fullName || '';
                input.dataset.originalValue = input.value;
              }
            }
          }, 10);
        }
      } catch (err) {
        console.error('DEV preset applied failed', err);
      }

      showModal(driverFormModal);
    });
  }

  if (driverForm) {
    driverForm.addEventListener('submit', async event => {
      event.preventDefault();
      const inputs = driverFormFields
        ? Array.from(driverFormFields.querySelectorAll('[data-column]'))
        : [];
      const fields = {};
      let hasName = false;

      inputs.forEach(input => {
        const column = input.dataset.column;
        if (!column) return;
        const value = input.value.trim();
        if (!hasName && column.toLowerCase() === 'nome' && value) hasName = true;
        if (value) fields[column] = value;
      });

      if (!hasName) {
        alert('Informe o campo Nome.');
        return;
      }

      const originalText = driverFormSubmit ? driverFormSubmit.textContent : '';
      if (driverFormSubmit) {
        driverFormSubmit.disabled = true;
        driverFormSubmit.textContent = 'Salvando...';
      }

      try {
        const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/drivers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const payload = await res.json();
        const createdDriverId = payload?.driver?.id || null;
        if (createdDriverId) {
          await seedLocalKmForNewDriver(createdDriverId);
        }
        hideModal(driverFormModal);
        if (driverForm) driverForm.reset();
        if (driverFormKmInitial) driverFormKmInitial.value = '';
        if (driverFormKmCurrent) driverFormKmCurrent.value = '';
        await init();
        alert('Motorista adicionado com sucesso.');
      } catch (err) {
        console.error(err);
        alert('Não foi possível adicionar o motorista.');
      } finally {
        if (driverFormSubmit) {
          driverFormSubmit.disabled = false;
          driverFormSubmit.textContent = originalText || 'Salvar';
        }
      }

      // Create KM manual flow
      const createKmModal = document.getElementById('createKmModal');
      const createKmForm = document.getElementById('createKmForm');
      const createKmDriver = document.getElementById('createKmDriver');
      const createKmNote = document.getElementById('createKmNote');
      const btnSyncKm = document.getElementById('btnSyncKm');

      if (btnCreateKm && createKmModal) {
        btnCreateKm.addEventListener('click', () => {
          // populate driver select with drivers that belong to this campaign
          if (createKmDriver) {
            createKmDriver.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '-- selecione --';
            createKmDriver.appendChild(placeholder);
            if (Array.isArray(currentCampaign?.drivers)) {
              const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
              const sorted = [...currentCampaign.drivers].sort((a,b) => collator.compare(a.name||'', b.name||''));
              for (const d of sorted) {
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.textContent = d.name || d.raw?.Nome || d.raw?.nome || d.id;
                createKmDriver.appendChild(opt);
              }
            }
          }
          if (createKmNote) createKmNote.value = '';
          console.debug('Opening create KM modal');
          showModal(createKmModal);
        });
      }

      if (createKmForm) {
        createKmForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const driverId = createKmDriver ? createKmDriver.value : null;
          if (!driverId) return alert('Selecione um motorista.');
          const note = createKmNote ? createKmNote.value.trim() : '';

          try {
            const payload = { fields: {} };
            if (note) payload.fields['COMENTÁRIOS'] = note;

            console.debug('Creating manual KM for driver', driverId, payload);

            const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/km/${encodeURIComponent(driverId)}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });

            if (!res.ok) {
              let body;
              try { body = await res.json(); } catch (e) { body = await res.text(); }
              console.error('Create KM failed', res.status, body);
              const msg = body && typeof body === 'object' ? `${body.error || ''}\n${body.detail || ''}\n${body.hint || ''}` : String(body || `HTTP ${res.status}`);
              return alert('Falha ao criar KM manual:\n' + msg);
            }

            hideModal(createKmModal);
            await init();
            // open km edit modal for the driver so user can fill remaining fields
            openKmEdit(driverId);
            alert('KM criado (local) com sucesso. Preencha os campos na modal.');
          } catch (err) {
            console.error('Create KM error', err);
            alert('Não foi possível criar KM manual. Veja o console para detalhes.');
          }
        });
      } else {
        console.debug('createKmForm not found in DOM');
      }
    });
  }

  if (driverDetailForm) {
    driverDetailForm.addEventListener('submit', async event => {
      event.preventDefault();
      const driverId = driverDetailForm.dataset.driverId;
      const driver = getDriverById(driverId);
      if (!driver) {
        alert('Motorista não encontrado.');
        return;
      }

      const inputs = driverDetailFields
        ? Array.from(driverDetailFields.querySelectorAll('[data-column]'))
        : [];
      const fields = {};
      inputs.forEach(input => {
        const column = input.dataset.column;
        if (!column) return;
        const value = input.value.trim();
        const original = driver.raw?.[column] ?? '';
        if (value !== original) fields[column] = value;
      });

      if (!Object.keys(fields).length) {
        alert('Nenhuma alteração realizada.');
        return;
      }

      const originalLabel = driverDetailSubmit ? driverDetailSubmit.textContent : '';
      if (driverDetailSubmit) {
        driverDetailSubmit.disabled = true;
        driverDetailSubmit.textContent = 'Salvando...';
      }

      try {
        const res = await authFetch(
          `/api/campaigns/${encodeURIComponent(campaignId)}/drivers/${encodeURIComponent(driverId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields }),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        pendingDriverChanges.delete(driverId);
        markDriverRowDirty(driverId, false);
        hideModal(driverDetailModal);
        await init();
        alert('Motorista atualizado com sucesso.');
      } catch (err) {
        console.error(err);
        alert('Não foi possível atualizar o motorista.');
      } finally {
        if (driverDetailSubmit) {
          driverDetailSubmit.disabled = false;
          driverDetailSubmit.textContent = originalLabel || 'Salvar';
        }
      }
    });
  }

  // KM Edit form submit
  const kmEditForm = document.getElementById('kmEditForm');
  const kmEditSubmit = document.getElementById('kmEditSubmit');
  if (kmEditForm) {
    kmEditForm.addEventListener('submit', async event => {
      event.preventDefault();
      const driverId = kmEditForm.dataset.driverId;
      if (!driverId) return alert('Motorista não identificado.');

      const inputs = Array.from(kmEditForm.querySelectorAll('[data-column]'));
      const fields = {};
      inputs.forEach(input => {
        const col = input.dataset.column;
        if (!col) return;
        const value = input.value.trim();
        const original = input.dataset.originalValue ?? '';
        if (value !== original) fields[col] = value;
      });

      if (!Object.keys(fields).length) {
        alert('Nenhuma alteração realizada.');
        return;
      }

      const originalLabel = kmEditSubmit ? kmEditSubmit.textContent : '';
      if (kmEditSubmit) {
        kmEditSubmit.disabled = true;
        kmEditSubmit.textContent = 'Salvando...';
      }

      try {
        const res = await authFetch(
          `/api/campaigns/${encodeURIComponent(campaignId)}/km/${encodeURIComponent(driverId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields }),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        hideModal(document.getElementById('kmEditModal'));
        await init();
        alert('KM atualizado com sucesso.');
      } catch (err) {
        console.error(err);
        alert('Não foi possível salvar o KM.');
      } finally {
        if (kmEditSubmit) {
          kmEditSubmit.disabled = false;
          kmEditSubmit.textContent = originalLabel || 'Salvar KM';
        }
      }
    });
  }

  if (campaignStatusSelect) {
    campaignStatusSelect.addEventListener('change', async () => {
      const selected = campaignStatusSelect.value;
      const original = campaignStatusSelect.dataset.currentValue;
      if (selected === original) return;

      const confirmed = await confirmCampaignStatusChange(selected);
      if (!confirmed) {
        campaignStatusSelect.value = original;
        return;
      }

      campaignStatusSelect.disabled = true;
      try {
        const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: selected }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        campaignStatusSelect.dataset.currentValue = selected;
        if (currentCampaign) currentCampaign.status = selected;
        await init();
        toast('Status da campanha atualizado.', 'success');
      } catch (err) {
        console.error(err);
        toast('Não foi possível atualizar o status.', 'error');
        campaignStatusSelect.value = original;
      } finally {
        campaignStatusSelect.disabled = false;
      }
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      const ok = await confirmDialog('Tem certeza que deseja excluir esta campanha? Essa ação não pode ser desfeita.', {
        title: 'Excluir campanha',
        confirmLabel: 'Excluir',
        cancelLabel: 'Cancelar',
        tone: 'danger',
      });
      if (!ok) {
        return;
      }
      const original = btnDelete.textContent;
      try {
        btnDelete.disabled = true;
        btnDelete.textContent = 'Excluindo...';
        const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        alert('Campanha excluída.');
        window.location.href = 'index.html';
      } catch (err) {
        console.error(err);
        alert('Não foi possível excluir a campanha.');
        btnDelete.disabled = false;
        btnDelete.textContent = original;
      }
    });
  }

  if (btnSaveCooldown) {
    btnSaveCooldown.addEventListener('click', saveCooldownSettings);
  }

  if (btnSaveEvidenceWindow) {
    btnSaveEvidenceWindow.addEventListener('click', saveEvidenceWindowSettings);
  }

  if (btnSetDriverTarget) {
    btnSetDriverTarget.addEventListener('click', openDriverTargetPrompt);
  }

  setupDispatchEvents();
  initSummaryDnD();

});

// ── Custom widgets no Resumo da campanha ──────────────────────────────────
function initCampaignCustomWidgets() {
  const host = document.getElementById('campaignCustomWidgetsHost');
  if (!host || !window.CustomWidgets) return;
  const minKm = getSummaryMinKmPerDriver(currentCampaign);
  const drivers = Array.isArray(currentCampaign?.drivers) ? currentCampaign.drivers : [];
  if (drivers.length && minKm > 0) {
    window.CustomWidgets.enrichDrivers(drivers, minKm);
  }
  window.CustomWidgets.init({
    context: 'campaigns',
    container: host,
    getCampaigns: () => (currentCampaign ? [currentCampaign] : []),
    getDrivers: () => (Array.isArray(currentCampaign?.drivers) ? currentCampaign.drivers : []),
    addBtnEl: document.getElementById('btnAddWidget'),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  DnD — Seções do Resumo de Campanha
// ═══════════════════════════════════════════════════════════════════════════

const SUMMARY_DND_ORDER_KEY = 'oddrive_layout_campaign_summary_order';
const SUMMARY_DND_HIDDEN_KEY = 'oddrive_hidden_summary_panels';
const SUMMARY_SECTIONS = [
  'summaryTopRow', 'summaryTwoCol', 'summaryRankingsGrid',
  'summaryInactivityCard', 'summaryHeatmapCard', 'summaryKmEditorCard'
];
const SUMMARY_GRIP_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="3" cy="2.5" r="1.2"/><circle cx="9" cy="2.5" r="1.2"/><circle cx="3" cy="6" r="1.2"/><circle cx="9" cy="6" r="1.2"/><circle cx="3" cy="9.5" r="1.2"/><circle cx="9" cy="9.5" r="1.2"/></svg>`;
const SUMMARY_CLOSE_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>`;

function getSummaryHiddenList() {
  try { return JSON.parse(localStorage.getItem(SUMMARY_DND_HIDDEN_KEY) || '[]'); } catch (_) { return []; }
}

function setSummaryHiddenList(list) {
  try { localStorage.setItem(SUMMARY_DND_HIDDEN_KEY, JSON.stringify(list)); } catch (_) {}
}

function getSummaryLayout() {
  try {
    const raw = localStorage.getItem(SUMMARY_DND_ORDER_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    const merged = [...saved.filter(id => SUMMARY_SECTIONS.includes(id))];
    for (const id of SUMMARY_SECTIONS) { if (!merged.includes(id)) merged.push(id); }
    return merged;
  } catch (_) { return [...SUMMARY_SECTIONS]; }
}

function saveSummaryLayout() {
  const tabResumo = document.getElementById('tab-resumo');
  if (!tabResumo) return;
  const ids = [...tabResumo.querySelectorAll('.dnd-section[id]')].map(el => el.id);
  try { localStorage.setItem(SUMMARY_DND_ORDER_KEY, JSON.stringify(ids)); } catch (_) {}
}

function applySummaryOrder(orderedIds) {
  const tabResumo = document.getElementById('tab-resumo');
  if (!tabResumo) return;
  for (const id of orderedIds) {
    const el = document.getElementById(id);
    if (el && el.parentElement === tabResumo) tabResumo.appendChild(el);
  }
  const restoreBar = document.getElementById('summaryRestoreBar');
  if (restoreBar) tabResumo.appendChild(restoreBar);
}

function renderSummaryRestoreBar() {
  const tabResumo = document.getElementById('tab-resumo');
  if (!tabResumo) return;
  const existing = document.getElementById('summaryRestoreBar');
  if (existing) existing.remove();
  const hidden = getSummaryHiddenList();
  if (hidden.length === 0) return;
  const bar = document.createElement('div');
  bar.id = 'summaryRestoreBar';
  bar.className = 'summary-restore-bar';
  bar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Restaurar ${hidden.length} seç${hidden.length > 1 ? 'ões' : 'ão'} oculta${hidden.length > 1 ? 's' : ''}`;
  bar.addEventListener('click', () => {
    const list = getSummaryHiddenList();
    for (const id of list) {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    }
    setSummaryHiddenList([]);
    bar.remove();
  });
  tabResumo.appendChild(bar);
}

function injectSummaryDndControls(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.classList.add('dnd-section');
  if (el.querySelector(':scope > .dnd-controls')) return;
  const controls = document.createElement('div');
  controls.className = 'dnd-controls';
  controls.innerHTML =
    `<button class="dnd-btn dnd-handle" title="Mover seção" aria-label="Arrastar seção">${SUMMARY_GRIP_SVG}</button>` +
    `<button class="dnd-btn dnd-close-btn" data-hide-summary="${sectionId}" title="Ocultar seção" aria-label="Ocultar seção">${SUMMARY_CLOSE_SVG}</button>`;
  el.prepend(controls);
}

let _summarySortable = null;

function initSummaryDnD() {
  if (!window.Sortable) return;
  const tabResumo = document.getElementById('tab-resumo');
  if (!tabResumo) return;

  // Inject controls and apply hidden state
  const hidden = getSummaryHiddenList();
  for (const id of SUMMARY_SECTIONS) {
    const el = document.getElementById(id);
    if (!el) continue;
    injectSummaryDndControls(id);
    if (hidden.includes(id)) el.style.display = 'none';
  }

  // Apply saved order
  applySummaryOrder(getSummaryLayout());
  renderSummaryRestoreBar();

  // Delegate hide-button clicks
  tabResumo.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-hide-summary]');
    if (!btn) return;
    const id = btn.dataset.hideSummary;
    const el = document.getElementById(id);
    if (!el) return;
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.97)';
    setTimeout(() => {
      el.style.display = 'none';
      el.style.opacity = '';
      el.style.transform = '';
      el.style.transition = '';
      const list = getSummaryHiddenList();
      if (!list.includes(id)) list.push(id);
      setSummaryHiddenList(list);
      renderSummaryRestoreBar();
    }, 250);
  });

  // Init Sortable on tab-resumo container
  if (_summarySortable) { try { _summarySortable.destroy(); } catch (_) {} }
  _summarySortable = new window.Sortable(tabResumo, {
    animation: 150,
    handle: '.dnd-handle',
    filter: '.summary-restore-bar',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: () => saveSummaryLayout(),
  });
}















