const TOKEN_KEY = 'oddrive_graphic_token';

const loginSection = document.getElementById('graphicLogin');
const appSection = document.getElementById('graphicApp');
const loginForm = document.getElementById('graphicLoginForm');
const loginMessage = document.getElementById('graphicLoginMessage');
const loginButton = document.getElementById('graphicLoginSubmit');
const stepsContainer = document.getElementById('graphicSteps');
const welcomeEl = document.getElementById('graphicWelcome');
const campaignInfoEl = document.getElementById('graphicCampaignInfo');
const logoutButton = document.getElementById('graphicLogout');
const driverSelect = document.getElementById('graphicDriverSelect');
const driverHint = document.getElementById('graphicDriverHint');
const graphicAgendaCount = document.getElementById('graphicAgendaCount');
const graphicAgendaHint = document.getElementById('graphicAgendaHint');
const graphicAgendaToday = document.getElementById('graphicAgendaToday');
const graphicAgendaWeek = document.getElementById('graphicAgendaWeek');
const graphicAgendaToggle = document.getElementById('graphicAgendaToggle');
const graphicAgendaClose = document.getElementById('graphicAgendaClose');
const graphicAgendaOverlay = document.getElementById('graphicAgendaOverlay');
const graphicAgendaSidebar = document.getElementById('graphicAgendaSidebar');

(function bindGestureGuards() {
  document.addEventListener('gesturestart', event => event.preventDefault());
  document.addEventListener('dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });
})();

let drivers = [];
let selectedDriverId = '';
let currentProfile = null;
let currentFlow = null;
const driverCompletion = new Map();
const driverCompletionPending = new Set();

let currentStepIndex = 0;
const stepData = new Map();
let isRefazer = false;
let overlayEl = null;
let tempDriverData = null; // holds new driver info when creating from graphic UI
let isAgendaOpen = false;
let agendaRenderVersion = 0;
const activeCameraStreams = new Set();
let cameraSessionVersion = 0;
let successOverlayTimeout = null;
let driverSelectionVersion = 0;

function stopCameraStream(stream) {
  if (!stream) return;
  try { stream.getTracks().forEach(track => track.stop()); } catch {}
  activeCameraStreams.delete(stream);
}

function stopActiveCameraStreams() {
  cameraSessionVersion += 1;
  activeCameraStreams.forEach(stopCameraStream);
  activeCameraStreams.clear();
}

function clearSuccessOverlayTimeout() {
  if (successOverlayTimeout === null) return;
  clearTimeout(successOverlayTimeout);
  successOverlayTimeout = null;
}

function setAgendaOpen(open) {
  const next = Boolean(open);
  isAgendaOpen = next;
  if (graphicAgendaSidebar) {
    graphicAgendaSidebar.classList.toggle('hidden', !next);
    graphicAgendaSidebar.setAttribute('aria-hidden', next ? 'false' : 'true');
  }
  if (graphicAgendaOverlay) {
    graphicAgendaOverlay.classList.toggle('hidden', !next);
  }
  if (graphicAgendaToggle) {
    graphicAgendaToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
  }
  document.body.classList.toggle('is-agenda-open', next);
}

function closeAgenda() {
  setAgendaOpen(false);
}

function toggleAgenda() {
  setAgendaOpen(!isAgendaOpen);
}

function isPhotoStep(step = {}) {
  const type = String(step.type || '').toLowerCase();
  const id = String(step.id || '').toLowerCase();
  return type === 'photo' || type === 'foto' || id.includes('photo');
}

function isTextStep(step = {}) {
  const type = String(step.type || '').toLowerCase();
  return type === 'text' || type === 'nota' || type === 'notes';
}

function isNumberStep(step = {}) {
  const type = String(step.type || '').toLowerCase();
  return type === 'number' || type === 'numero';
}

function hasNumberValueForStep(stepId) {
  const val = stepData.get(stepId)?.odometerValue;
  if (val == null) return false;
  const n = parseFloat(String(val).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0;
}

function buildNumberInputUI(stepId, labelText, onChangeCallback) {
  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '8px';
  const label = document.createElement('label');
  label.className = 'small';
  label.style = 'display:block;margin-bottom:6px;';
  label.textContent = labelText || 'Informe o valor';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.placeholder = 'Ex: 123456';
  input.style = 'width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;font-size:1rem;';
  const saved = stepData.get(stepId);
  if (saved?.odometerValue != null) input.value = saved.odometerValue;
  input.addEventListener('input', () => {
    stepData.set(stepId, { ...(stepData.get(stepId) || {}), odometerValue: input.value });
    if (typeof onChangeCallback === 'function') onChangeCallback();
  });
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

function hasPhotoForStep(stepId) {
  return Boolean(stepData.get(stepId)?.photoData);
}

function isStepRequirementMet(step) {
  if (!step?.required) return true;
  if (isPhotoStep(step)) return hasPhotoForStep(step.id);
  if (isTextStep(step)) {
    const raw = stepData.get(step.id)?.notes;
    return typeof raw === 'string' && raw.trim().length > 0;
  }
  if (isNumberStep(step)) return hasNumberValueForStep(step.id);
  return true;
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(value) {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

function revokeSession(token) {
  if (!token) return;
  const fullUrl = `${getApiBase()}/api/session/logout`;
  fetch(fullUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
  }).catch(err => console.warn('Falha ao encerrar sessao no servidor', err?.message || err));
}

function getApiBase() {
  return window.API_BASE || '';
}

async function authedFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  
  // Garante que a URL seja absoluta
  const apiBase = getApiBase();
  const fullUrl = url.startsWith('http') ? url : `${apiBase}${url}`;
  
  const response = await fetch(fullUrl, { ...options, headers });
  if (response.status === 401) {
    setToken(null);
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  return response;
}

function showLogin(message = '') {
  stopActiveCameraStreams();
  clearSuccessOverlayTimeout();
  hideLoading();
  agendaRenderVersion += 1;
  loginSection.classList.remove('hidden');
  appSection.classList.add('hidden');
  closeAgenda();
  if (message) loginMessage.textContent = message;
  renderAgendaList(graphicAgendaToday, [], 'Faça login para ver a agenda.');
  renderAgendaList(graphicAgendaWeek, [], 'Faça login para ver a agenda.');
  if (graphicAgendaCount) graphicAgendaCount.textContent = '0 agendamentos';
  if (graphicAgendaHint) graphicAgendaHint.textContent = 'Veja os horários de adesivagem e retirada da campanha.';
}

function showApp() {
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  loginMessage.textContent = '';
}

function updateDriverHint() {
  if (!driverHint) return;
  if (!selectedDriverId) {
    driverHint.textContent = 'Selecione um motorista para enviar as imagens.';
  } else {
    if (selectedDriverId === '__new__' && tempDriverData) {
      driverHint.textContent = `Criando e enviando para: ${tempDriverData.name}`;
    } else {
      const driver = drivers.find(d => d.id === selectedDriverId);
      driverHint.textContent = driver ? `Enviando para: ${driver.name}` : 'Selecione um motorista para enviar as imagens.';
    }
  }
}

function ensureDriverSelected() {
  if (!selectedDriverId) {
    updateDriverHint();
    return false;
  }
  return true;
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

function normalizeAgendaStatus(value) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (!normalized) return 'agendado';
  if (normalized === 'agendada') return 'agendado';
  if (normalized === 'confirmada') return 'confirmado';
  if (normalized === 'instalada') return 'concluido';
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
  if (normalized === 'confirmado') return 'confirmado';
  if (normalized === 'problema') return 'problema';
  if (normalized === 'revisar') return 'revisar';
  return 'agendado';
}

function formatAgendaDateTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '-';
  return new Date(timestamp).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function startOfDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(timestamp = Date.now()) {
  return startOfDay(timestamp) + (24 * 60 * 60 * 1000) - 1;
}

function getAgendaStatusMeta(status) {
  const normalized = normalizeAgendaStatus(status);
  if (normalized === 'concluido') return { label: 'Concluído', className: 'is-concluido' };
  if (normalized === 'confirmado') return { label: 'Confirmado', className: 'is-confirmado' };
  if (normalized === 'faltou') return { label: 'Faltou', className: 'is-faltou' };
  if (normalized === 'reagendado') return { label: 'Reagendado', className: 'is-reagendado' };
  if (normalized === 'problema') return { label: 'Problema', className: 'is-problema' };
  if (normalized === 'revisar') return { label: 'Revisar', className: 'is-revisar' };
  return { label: 'Agendado', className: 'is-agendado' };
}

function buildAgendaEvents(list = []) {
  const events = [];
  const driversList = Array.isArray(list) ? list : [];

  for (const driver of driversList) {
    const adhesion = driver?.adhesion || {};
    const status = normalizeAgendaStatus(adhesion.status || driver?.status);
    const initialAt = parseAdhesionDateTimeMs(adhesion.initialAt ?? adhesion.initialAtRaw);
    const removalAt = parseAdhesionDateTimeMs(adhesion.removalAt ?? adhesion.removalAtRaw);

    if (Number.isFinite(initialAt)) {
      events.push({
        id: `${driver.id}:initial`,
        driverId: driver.id || '',
        driverName: driver.name || 'Motorista sem nome',
        plate: driver.plate || '-',
        type: 'Adesivagem',
        at: initialAt,
        status,
      });
    }

    if (Number.isFinite(removalAt)) {
      events.push({
        id: `${driver.id}:removal`,
        driverId: driver.id || '',
        driverName: driver.name || 'Motorista sem nome',
        plate: driver.plate || '-',
        type: 'Retirada',
        at: removalAt,
        status,
      });
    }
  }

  return events.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    return String(a.driverName || '').localeCompare(String(b.driverName || ''), 'pt-BR');
  });
}

function getAgendaEventKey(event = {}) {
  const driverKey = String(event.driverId || event.driverName || '').trim().toLowerCase();
  const typeKey = String(event.type || '').trim().toLowerCase();
  const minuteKey = Math.floor(Number(event.at) / 60000);
  return `${driverKey}|${typeKey}|${minuteKey}`;
}

function mergeAgendaEvents(legacyEvents = [], bookingEvents = []) {
  const byKey = new Map();
  [...legacyEvents, ...bookingEvents].forEach(event => {
    if (!Number.isFinite(event?.at)) return;
    const key = getAgendaEventKey(event);
    const existing = byKey.get(key);
    const merged = existing ? { ...existing, ...event } : event;
    if (existing && normalizeAgendaStatus(existing.status) !== 'agendado') {
      merged.status = existing.status;
    }
    byKey.set(key, merged);
  });
  return [...byKey.values()].sort((a, b) => a.at - b.at);
}

function buildAgendaItem(event) {
  const li = document.createElement('li');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'graphic-agenda-item';
  if (event.driverId && event.driverId === selectedDriverId) {
    button.classList.add('is-selected');
  }

  const head = document.createElement('div');
  head.className = 'graphic-agenda-item-head';
  const date = document.createElement('span');
  date.className = 'graphic-agenda-datetime';
  date.textContent = formatAgendaDateTime(event.at);
  const type = document.createElement('span');
  const normalizedType = String(event.type || '').trim().toLowerCase();
  let typeClass = 'is-default';
  if (normalizedType === 'adesivagem') typeClass = 'is-adesivagem';
  if (normalizedType === 'retirada') typeClass = 'is-retirada';
  type.className = `graphic-agenda-type ${typeClass}`;
  type.textContent = event.type;
  head.append(date, type);

  const body = document.createElement('div');
  body.className = 'graphic-agenda-item-body';
  const name = document.createElement('strong');
  name.textContent = event.driverName;
  const plate = document.createElement('span');
  plate.className = 'small muted';
  plate.textContent = `Placa: ${event.plate || '-'}`;
  body.append(name, plate);

  const statusMeta = getAgendaStatusMeta(event.status);
  const status = document.createElement('span');
  status.className = `graphic-agenda-status ${statusMeta.className}`;
  status.textContent = statusMeta.label;

  button.append(head, body, status);
  button.addEventListener('click', async () => {
    closeAgenda();
    await applySelectedDriver(event.driverId);
  });
  li.appendChild(button);
  return li;
}

function renderAgendaList(container, events = [], emptyMessage = 'Sem agendamentos.') {
  if (!container) return;
  container.innerHTML = '';
  if (!events.length) {
    const empty = document.createElement('li');
    empty.className = 'graphic-agenda-empty';
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }
  events.forEach(event => container.appendChild(buildAgendaItem(event)));
}

function renderAgendaSnapshot(events, hasAdhesionPayload) {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekEnd = todayStart + (7 * 24 * 60 * 60 * 1000);

  const horizonEvents = events.filter(event => event.at >= todayStart && event.at < weekEnd);
  const todayEvents = horizonEvents.filter(event => event.at <= todayEnd);
  const weekEvents = horizonEvents.filter(event => event.at > todayEnd);
  const futureEvents = events.filter(event => event.at >= weekEnd);
  const pastEvents = events.filter(event => event.at < todayStart);

  renderAgendaList(graphicAgendaToday, todayEvents, 'Nenhum agendamento para hoje.');
  renderAgendaList(graphicAgendaWeek, weekEvents, 'Nenhum agendamento para os próximos 7 dias.');

  if (graphicAgendaCount) {
    const total = horizonEvents.length;
    graphicAgendaCount.textContent = total === 1 ? '1 agendamento' : `${total} agendamentos`;
  }
  if (graphicAgendaHint) {
    if (!horizonEvents.length) {
      if (futureEvents.length > 0) {
        graphicAgendaHint.textContent = `Existem ${futureEvents.length} agendamento(s) após os próximos 7 dias.`;
      } else if (pastEvents.length > 0) {
        graphicAgendaHint.textContent = `Existem ${pastEvents.length} agendamento(s) em datas passadas.`;
      } else if (drivers.length > 0 && !hasAdhesionPayload) {
        graphicAgendaHint.textContent = 'A API atual não retornou os campos de adesivagem para os motoristas desta campanha.';
      } else {
        graphicAgendaHint.textContent = 'Sem horários de adesivagem/retirada cadastrados na campanha.';
      }
    } else {
      const nextEvent = horizonEvents[0];
      graphicAgendaHint.textContent = `Próximo horário: ${nextEvent.driverName} em ${formatAgendaDateTime(nextEvent.at)}.`;
    }
  }
}

function renderGraphicAgenda() {
  const requestVersion = ++agendaRenderVersion;
  const legacyEvents = buildAgendaEvents(drivers);
  const hasAdhesionPayload = (Array.isArray(drivers) ? drivers : []).some(driver => {
    const adhesion = driver?.adhesion || {};
    return Boolean(
      adhesion.initialAt ||
      adhesion.initialAtRaw ||
      adhesion.removalAt ||
      adhesion.removalAtRaw,
    );
  });

  renderAgendaSnapshot(legacyEvents, hasAdhesionPayload);

  fetchSchedulingBookings().then(bookingEvents => {
    if (requestVersion !== agendaRenderVersion) return;
    renderAgendaSnapshot(
      mergeAgendaEvents(legacyEvents, bookingEvents),
      hasAdhesionPayload || bookingEvents.length > 0,
    );
  });
}

/**
 * Fetch bookings from the scheduling system and convert to agenda events.
 */
async function fetchSchedulingBookings() {
  try {
    const campaignId = currentProfile?.campaign?.id;
    const graphicId  = currentProfile?.graphic?.id;
    if (!campaignId || !graphicId) return [];

    const res = await authedFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/graphic/${encodeURIComponent(graphicId)}/bookings`);
    if (!res.ok) return [];
    const data = await res.json();
    const bookings = data.bookings || [];

    return bookings.map(b => {
      const [y, m, d] = (b.date || '').split('-').map(Number);
      const [hh, mm] = (b.startTime || '0:0').split(':').map(Number);
      const at = new Date(y, m - 1, d, hh, mm).getTime();
      return {
        id: `booking:${b._id}`,
        driverId: b.driverId || '',
        driverName: b.driverName || 'Motorista',
        plate: b.driverPlate || '-',
        type: b.type === 'installation' ? 'Adesivagem' : 'Retirada',
        at,
        status: 'agendado',
      };
    });
  } catch (err) {
    console.warn('[scheduling] fetchSchedulingBookings error:', err);
    if (!getToken()) showLogin('Sessão expirada. Faça login novamente.');
    return [];
  }
}
function resetFlowProgress() {
  currentStepIndex = 0;
  stepData.clear();
}

function isMobileDevice() {
  try {
    const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    return /android|iphone|ipad|ipod|windows phone|mobile/.test(ua) || isTouch;
  } catch {
    return false;
  }
}

function isSecure() {
  try {
    return window.isSecureContext;
  } catch {
    return false;
  }
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'overlay';
  overlayEl.innerHTML = `
    <div class="overlay-card" id="graphicOverlayCard">
      <div class="spinner"></div>
      <div id="graphicOverlayText" class="small">Enviando...</div>
    </div>`;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function showLoading(text = 'Enviando...') {
  ensureOverlay();
  clearSuccessOverlayTimeout();
  const card = overlayEl.querySelector('#graphicOverlayCard');
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  const label = document.createElement('div');
  label.id = 'graphicOverlayText';
  label.className = 'small';
  label.textContent = text;
  card.replaceChildren(spinner, label);
  overlayEl.classList.add('show');
}

function hideLoading() {
  if (overlayEl) overlayEl.classList.remove('show');
}

function showSuccess(message = 'Envio concluído!') {
  ensureOverlay();
  clearSuccessOverlayTimeout();
  const card = overlayEl.querySelector('#graphicOverlayCard');
  const icon = document.createElement('div');
  icon.style.fontSize = '32px';
  icon.style.fontWeight = '700';
  icon.textContent = 'OK';
  const title = document.createElement('h3');
  title.style.margin = '8px 0';
  title.textContent = String(message || '');
  card.replaceChildren(icon, title);
  overlayEl.classList.add('show');
  successOverlayTimeout = setTimeout(() => {
    successOverlayTimeout = null;
    try {
      overlayEl.classList.remove('show');
      // insert persistent panel (sem refazer)
      if (typeof stepsContainer !== 'undefined' && stepsContainer) {
        stepsContainer.innerHTML = '';
        const done = document.createElement('article');
        done.id = 'graphicPersistentSuccess';
        done.innerHTML = `
          <div class="step-head">
            <h3>Processo realizado com sucesso!</h3>
            <span class="pill">ok</span>
          </div>
          <div class="step-body">
            <p class="small">Obrigado! Suas fotos foram enviadas com sucesso.</p>
          </div>`;
        stepsContainer.appendChild(done);
      }
    } catch (err) { console.error(err); }
    isRefazer = false;
  }, 1100);

  // If we created a new driver, refresh session to get the updated drivers list
  if (tempDriverData) {
    setTimeout(() => {
      try { loadSession(); tempDriverData = null; } catch {};
    }, 1200);
  }
}

function ensureGlobalMobileWarning() {
  if (isMobileDevice() || !stepsContainer) return;
  let warn = document.getElementById('graphicMobileWarning');
  if (!warn) {
    warn = document.createElement('div');
    warn.id = 'graphicMobileWarning';
    warn.className = 'small';
    warn.style = 'margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff6f0;color:#9a4b00;';
    warn.textContent = 'Use a área da gráfica pelo celular. A câmera só funciona via HTTPS.';
    const parent = stepsContainer.parentNode;
    if (parent) parent.insertBefore(warn, stepsContainer);
  }
}

function buildSimplePhotoUI(stepId, onStateChange = () => {}) {
  const container = document.createElement('div');
  container.style = 'display:flex;flex-direction:column;gap:10px;';

  const preview = document.createElement('img');
  preview.alt = 'Previa da imagem';
  preview.style = 'max-width:100%;border:1px solid var(--line);border-radius:10px;display:none;';
  container.appendChild(preview);

  const controls = document.createElement('div');
  controls.style = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;';
  container.appendChild(controls);

  const btnSnap = document.createElement('button');
  btnSnap.className = 'btn btn--primary';
  btnSnap.type = 'button';
  btnSnap.textContent = 'Abrir câmera';
  const btnRetake = document.createElement('button');
  btnRetake.className = 'btn';
  btnRetake.type = 'button';
  btnRetake.textContent = 'Refazer';
  btnRetake.disabled = true;
  controls.append(btnSnap, btnRetake);

  // REMOVIDO input[type=file]: Proíbe upload de fotos salvas
  // Apenas câmera ao vivo é permitida para garantir autenticidade

  const videoWrap = document.createElement('div');
  videoWrap.style = 'position:relative;';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style = 'width:100%;border:1px solid var(--line);border-radius:10px;display:none;';
  videoWrap.appendChild(video);
  container.appendChild(videoWrap);

  function showMobileOnlyWarning(customText) {
    const existing = container.querySelectorAll('.camera-warning');
    existing.forEach(el => el.remove());
    const warn = document.createElement('div');
    warn.className = 'small camera-warning';
    warn.style = 'padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff6f0;color:#9a4b00;';
    const parts = [];
    if (customText) parts.push(customText);
    else parts.push('Tire uma foto bem visivel com qualidade.');
    if (!isMobileDevice()) parts.push('Acesse pelo celular.');
    if (!isSecure()) parts.push('Requer HTTPS para abrir a câmera (ex.: https://seu-endereco).');
    warn.textContent = parts.join(' ');
    container.appendChild(warn);
  }

  function clearWarning() {
    container.querySelectorAll('.camera-warning').forEach(el => el.remove());
  }

  function compressAndPreview(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1280;
        const scale = Math.min(1, maxW / (img.width || maxW));
        const w = Math.round((img.width || maxW) * scale);
        const h = Math.round((img.height || (maxW * 0.75)) * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        preview.src = compressed;
        preview.style.display = 'block';
        btnRetake.disabled = false;
        stepData.set(stepId, { ...(stepData.get(stepId) || {}), photoData: compressed });
        onStateChange(stepId);
        resolve();
      };
      img.src = dataUrl;
    });
  }

  const resetCaptureState = () => {
    preview.style.display = 'none';
    preview.src = '';
    btnRetake.disabled = true;
    stepData.delete(stepId);
    onStateChange(stepId);
  };

  async function openCamera() {
    if (!ensureDriverSelected()) {
      showMobileOnlyWarning('Selecione um motorista antes de capturar a foto.');
      return;
    }
    
    // BLOQUEIA DESKTOP: Impede envio de fotos salvas - apenas câmera ao vivo no celular
    if (!isMobileDevice()) {
      showMobileOnlyWarning('Atenção: Esta função só está disponível no celular. Acesse pelo dispositivo móvel para tirar fotos em tempo real.');
      return;
    }
    
    try {
      const canMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      if (!canMedia || !isSecure()) {
        showMobileOnlyWarning('Atenção: Requer HTTPS para abrir a câmera. Verifique a conexão.');
        return;
      }
      clearWarning();
      stopActiveCameraStreams();
      const requestVersion = cameraSessionVersion;
      btnSnap.disabled = true;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      btnSnap.disabled = false;
      if (requestVersion !== cameraSessionVersion || !container.isConnected) {
        stopCameraStream(stream);
        return;
      }
      activeCameraStreams.add(stream);
      video.srcObject = stream;
      video.style.display = 'block';
      preview.style.display = 'none';
      btnRetake.disabled = false;

      btnSnap.textContent = 'Capturar';
      btnSnap.onclick = async () => {
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings ? track.getSettings() : {};
        const w = settings.width || video.videoWidth || 1280;
        const h = settings.height || video.videoHeight || 720;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        stopCameraStream(stream);
        video.srcObject = null;
        video.style.display = 'none';
        await compressAndPreview(dataUrl);
        btnSnap.textContent = 'Reabrir câmera';
        btnSnap.onclick = () => openCamera();
      };

      btnRetake.onclick = () => {
        stopCameraStream(stream);
        video.srcObject = null;
        resetCaptureState();
        btnSnap.textContent = 'Abrir câmera';
        btnSnap.onclick = () => openCamera();
        openCamera();
      };
    } catch (err) {
      btnSnap.disabled = false;
      console.warn('Falha ao acessar câmera', err);
      showMobileOnlyWarning('Não foi possível abrir a câmera. Verifique permissões e tente novamente.');
    }
  }

  btnSnap.onclick = () => openCamera();
  btnRetake.onclick = () => {
    resetCaptureState();
    openCamera();
  };
  if (!isMobileDevice() || !isSecure()) showMobileOnlyWarning();

  const saved = stepData.get(stepId);
  if (saved?.photoData) {
    preview.src = saved.photoData;
    preview.style.display = 'block';
    btnRetake.disabled = false;
    onStateChange(stepId);
  }

  return container;
}

function buildNotesUI(stepId, onStateChange = () => {}) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <label class="small" style="display:block;margin-bottom:6px;">Observações da gráfica (opcional)</label>
    <textarea id="graphicNotesField" rows="4" placeholder="Registre orientações importantes para o motorista" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;"></textarea>
  `;
  const textarea = wrapper.querySelector('#graphicNotesField');
  const saved = stepData.get(stepId);
  if (saved?.notes) textarea.value = saved.notes;
  textarea.addEventListener('input', () => {
    stepData.set(stepId, { notes: textarea.value });
    onStateChange(stepId);
  });
  return wrapper;
}

async function uploadEvidence({ step, photoData, notes, odometerValue }) {
  if (!ensureDriverSelected()) throw new Error('Selecione um motorista.');
  const payload = { step };
  if (selectedDriverId && selectedDriverId !== '__new__') payload.driverId = selectedDriverId;
  if (selectedDriverId === '__new__' && tempDriverData) payload.driver = tempDriverData; // send driver data for creation
  if (photoData) payload.photoData = photoData;
  if (typeof notes === 'string') payload.notes = notes;
  if (odometerValue != null) payload.odometerValue = odometerValue;

  if (typeof isRefazer !== 'undefined') payload.refazer = Boolean(isRefazer);

  const res = await authedFetch('/api/session/evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Falha ao registrar (${res.status})`);
  }
  return res.json();
}

function renderFlow(flow = currentFlow) {
  stopActiveCameraStreams();
  currentFlow = flow;
  const steps = Array.isArray(flow?.steps) ? flow.steps : [];

  if (!stepsContainer) return;

  if (!steps.length) {
    stepsContainer.innerHTML = '<p class="small muted">Nenhum fluxo configurado para a área da gráfica.</p>';
    return;
  }

  if (!drivers.length) {
    stepsContainer.innerHTML = '<p class="small muted">Cadastre motoristas na campanha para liberar o envio.</p>';
    return;
  }

  if (!ensureDriverSelected()) {
    stepsContainer.innerHTML = '<p class="small muted">Selecione um motorista para iniciar o envio das fotos.</p>';
    return;
  }

  if (currentStepIndex >= steps.length) currentStepIndex = steps.length - 1;
  const step = steps[currentStepIndex];

  stepsContainer.innerHTML = '';
  requestAnimationFrame(() => {
    try { window.scrollTo({ top: 0, behavior: currentStepIndex === 0 ? 'auto' : 'smooth' }); } catch {}
  });
  const completedState = driverCompletion.get(selectedDriverId);
  if (completedState?.error) {
    stepsContainer.innerHTML = '';
    const card = document.createElement('article');
    card.className = 'step-item';
    const title = document.createElement('h3');
    title.textContent = 'Não foi possível verificar o motorista';
    const message = document.createElement('p');
    message.className = 'small muted';
    message.textContent = 'Confira sua conexão e tente novamente antes de enviar as evidências.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn--primary';
    retry.textContent = 'Tentar novamente';
    const driverId = selectedDriverId;
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      retry.textContent = 'Verificando...';
      driverCompletion.delete(driverId);
      await applySelectedDriver(driverId);
    });
    card.append(title, message, retry);
    stepsContainer.appendChild(card);
    return;
  }
  
  // Só bloqueia se completed E (verified OU locked)
  // Quando admin clica "Liberar agora", verified fica false, permitindo novo envio
  const lockUntil = completedState?.cooldownUntil && Number(completedState.cooldownUntil) > Date.now()
    ? Number(completedState.cooldownUntil)
    : null;
  const shouldBlock = completedState?.completed && (completedState?.verified || completedState?.locked || lockUntil);
  
  if (shouldBlock) {
    const unlockText = lockUntil 
      ? new Date(lockUntil).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : null;
    stepsContainer.innerHTML = `
      <article class="step-item" style="text-align:center;">
        <h3 style="margin:0 0 6px;">Envios já registrados</h3>
        <p class="small muted" style="margin:0;">${unlockText ? `Aguarde até ${unlockText} ou até o admin liberar.` : 'Aguarde a revisão do administrador para este motorista.'}</p>
      </article>`;
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'step-item';

  const head = document.createElement('div');
  head.className = 'step-head';
  const title = document.createElement('h3');
  title.textContent = step.label;
  head.appendChild(title);

  const body = document.createElement('div');
  body.className = 'step-body';
  let navBusy = false;
  let refreshNextButtonState = () => {};
  const updateActionsVisibility = () => {
    const show = !(isPhotoStep(step) && !hasPhotoForStep(step.id));
    actions.style.display = show ? 'flex' : 'none';
  };

  const driverInfo = document.createElement('p');
  driverInfo.className = 'small muted';
  const driver = drivers.find(d => d.id === selectedDriverId);
  driverInfo.textContent = driver ? `Motorista selecionado: ${driver.name}` : '';
  body.appendChild(driverInfo);

  if (isPhotoStep(step)) {
    body.appendChild(buildSimplePhotoUI(step.id, () => refreshNextButtonState()));
  } else if (isTextStep(step)) {
    body.appendChild(buildNotesUI(step.id, () => refreshNextButtonState()));
  } else if (isNumberStep(step)) {
    body.appendChild(buildNumberInputUI(step.id, 'Informe a quilometragem do odômetro', () => refreshNextButtonState()));
  }

  const actions = document.createElement('div');
  actions.className = 'step-actions';

  const btnPrev = document.createElement('button');
  btnPrev.className = 'btn';
  btnPrev.type = 'button';
  btnPrev.textContent = 'Voltar';
  btnPrev.disabled = currentStepIndex === 0;
  btnPrev.onclick = () => {
    if (navBusy) return;
    if (currentStepIndex > 0) {
      currentStepIndex -= 1;
      renderFlow(currentFlow);
      ensureGlobalMobileWarning();
    }
  };

  const btnNext = document.createElement('button');
  btnNext.className = 'btn btn--primary';
  btnNext.type = 'button';
  btnNext.textContent = currentStepIndex === steps.length - 1 ? 'Concluir' : 'Avançar';
  refreshNextButtonState = () => {
    btnPrev.disabled = navBusy || currentStepIndex === 0;
    if (navBusy) {
      btnNext.disabled = true;
      updateActionsVisibility();
      return;
    }
    if (!step.required) {
      btnNext.disabled = false;
      updateActionsVisibility();
      return;
    }
    if (isPhotoStep(step)) {
      btnNext.disabled = !hasPhotoForStep(step.id);
      updateActionsVisibility();
      return;
    }
    if (isTextStep(step)) {
      const raw = stepData.get(step.id)?.notes;
      btnNext.disabled = !(typeof raw === 'string' && raw.trim().length > 0);
      updateActionsVisibility();
      return;
    }
    if (isNumberStep(step)) {
      btnNext.disabled = !hasNumberValueForStep(step.id);
      updateActionsVisibility();
      return;
    }
    btnNext.disabled = false;
    updateActionsVisibility();
  };
  refreshNextButtonState();
  btnNext.onclick = async () => {
    if (navBusy) return;
    if (!ensureDriverSelected()) {
      alert('Selecione um motorista para continuar.');
      return;
    }
    if (step.required && isPhotoStep(step) && !hasPhotoForStep(step.id)) {
      alert('Capture a foto antes de avançar.');
      return;
    }
    if (step.required && isTextStep(step)) {
      const raw = stepData.get(step.id)?.notes;
      if (!(typeof raw === 'string' && raw.trim().length > 0)) {
        alert('Digite as observações antes de avançar.');
        return;
      }
    }
    if (step.required && isNumberStep(step) && !hasNumberValueForStep(step.id)) {
      alert('Informe a quilometragem do odômetro antes de avançar.');
      return;
    }

    const data = stepData.get(step.id) || {};
    try {
      navBusy = true;
      refreshNextButtonState();
      showLoading(currentStepIndex === steps.length - 1 ? 'Concluindo...' : 'Enviando...');
      const hasPayload =
        (isPhotoStep(step) && data.photoData) ||
        (isTextStep(step) && typeof data.notes === 'string' && data.notes.trim().length) ||
        (isNumberStep(step) && data.odometerValue != null);
      if (hasPayload) {
        await uploadEvidence({ step: step.id, ...data });
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Falha ao enviar. Tente novamente.');
      navBusy = false;
      hideLoading();
      refreshNextButtonState();
      return;
    }

    navBusy = false;
    if (currentStepIndex < steps.length - 1) {
      currentStepIndex += 1;
      hideLoading();
      renderFlow(currentFlow);
      ensureGlobalMobileWarning();
    } else {
      hideLoading();
      showSuccess('Registro finalizado com sucesso!');
    }
  };

  actions.append(btnPrev, btnNext);
  head.appendChild(actions);
  wrapper.appendChild(head);
  wrapper.appendChild(body);
  stepsContainer.appendChild(wrapper);
}

function renderDriverOptions(list = []) {
  driverSelectionVersion += 1;
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true });
  drivers = Array.isArray(list) ? [...list].sort((a, b) => collator.compare(a?.name || '', b?.name || '')) : [];

  driverSelect.innerHTML = '';
  if (!drivers.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Nenhum motorista disponível';
    driverSelect.appendChild(option);
    driverSelect.disabled = true;
    selectedDriverId = '';
    updateDriverHint();
    stepsContainer.innerHTML = '<p class="small muted">Cadastre motoristas na campanha para liberar o envio.</p>';
    renderGraphicAgenda();
    return;
  }

  driverSelect.disabled = false;
  drivers.forEach(driver => {
    const option = document.createElement('option');
    option.value = driver.id;
    option.textContent = driver.name || '(sem nome)';
    driverSelect.appendChild(option);
  });

  if (!drivers.some(d => d.id === selectedDriverId)) {
    selectedDriverId = drivers[0]?.id || '';
  }

  driverSelect.value = selectedDriverId;
  updateDriverHint();
  resetFlowProgress();
  renderGraphicAgenda();
}

async function applySelectedDriver(driverId) {
  const selectionVersion = ++driverSelectionVersion;
  const nextId = String(driverId || '').trim();
  if (!nextId) {
    selectedDriverId = '';
    updateDriverHint();
    renderGraphicAgenda();
    renderFlow(currentFlow);
    return;
  }

  if (!drivers.some(driver => driver.id === nextId)) return;

  selectedDriverId = nextId;
  if (driverSelect && driverSelect.value !== nextId) {
    driverSelect.value = nextId;
  }
  driverCompletion.delete(nextId);

  updateDriverHint();
  resetFlowProgress();
  renderGraphicAgenda();

  stepsContainer.innerHTML = '<p class="small muted">Verificando status do motorista...</p>';
  await fetchDriverCompletion(nextId);
  if (!getToken()) {
    showLogin('Sessão expirada. Faça login novamente.');
    return;
  }
  if (selectionVersion !== driverSelectionVersion || selectedDriverId !== nextId) return;
  renderFlow(currentFlow);
  ensureGlobalMobileWarning();
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const payload = {
    campaignCode: formData.get('campaignCode')?.trim(),
    name: formData.get('name')?.trim(),
  };

  if (!payload.campaignCode || !payload.name) {
    loginMessage.textContent = 'Informe o código da campanha e o nome do responsável.';
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = 'Entrando...';
  loginMessage.textContent = '';

  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/session/graphic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Não foi possível fazer login.');
    }
    const data = await response.json();
    setToken(data.token);
    currentProfile = data;
    await loadSession();
  } catch (err) {
    console.error(err);
    loginMessage.textContent = err.message || 'Falha ao fazer login.';
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
}

async function loadSession() {
  const token = getToken();
  if (!token) {
    showLogin();
    return;
  }

  try {
    driverCompletion.clear();
    driverCompletionPending.clear();
    stepsContainer.innerHTML = '<p class="small">Carregando dados da campanha...</p>';
    const [profileRes, driversRes, flowRes] = await Promise.all([
      authedFetch('/api/session/me'),
      authedFetch('/api/session/graphic/drivers'),
      authedFetch('/api/session/flow'),
    ]);

    if (!profileRes.ok) {
      const body = await profileRes.text().catch(() => '');
      throw new Error(body || `HTTP ${profileRes.status}`);
    }
    if (!driversRes.ok) {
      const body = await driversRes.text().catch(() => '');
      throw new Error(body || `HTTP ${driversRes.status}`);
    }
    if (!flowRes.ok) {
      const body = await flowRes.text().catch(() => '');
      throw new Error(body || `HTTP ${flowRes.status}`);
    }

    const profile = await profileRes.json();
    const driversData = await driversRes.json();
    const flowData = await flowRes.json();
    currentProfile = profile;
    currentFlow = flowData;
    isRefazer = false;
    resetFlowProgress();

    welcomeEl.textContent = profile?.graphic?.responsible
      ? `Olá, ${profile.graphic.responsible}`
      : 'Gráfica conectada';
    campaignInfoEl.textContent = profile?.campaign?.name
      ? `Campanha: ${profile.campaign.name}`
      : '';

    renderDriverOptions(driversData?.drivers || []);
    ensureGlobalMobileWarning();
    if (selectedDriverId) {
      stepsContainer.innerHTML = '<p class="small muted">Verificando status do motorista...</p>';
      await fetchDriverCompletion(selectedDriverId);
      if (!getToken()) throw new Error('Sessão expirada. Faça login novamente.');
    }
    renderFlow(currentFlow);
    showApp();
  } catch (err) {
    console.error(err);
    setToken(null);
    showLogin(err.message || 'Sessão expirada. Faça login novamente.');
  }
}

function handleLogout() {
  const token = getToken();
  driverSelectionVersion += 1;
  stopActiveCameraStreams();
  clearSuccessOverlayTimeout();
  hideLoading();
  closeAgenda();
  setToken(null);
  revokeSession(token);
  drivers = [];
  selectedDriverId = '';
  currentProfile = null;
  currentFlow = null;
  driverCompletion.clear();
  driverCompletionPending.clear();
  resetFlowProgress();
  if (stepsContainer) stepsContainer.innerHTML = '<p class="small">Faça login para iniciar.</p>';
  renderGraphicAgenda();
  showLogin('Você saiu da sessão.');
}

async function fetchDriverCompletion(driverId) {
  if (!driverId) return null;
  if (driverCompletion.has(driverId)) return driverCompletion.get(driverId);
  if (driverCompletionPending.has(driverId)) return null;
  driverCompletionPending.add(driverId);
  try {
    const res = await authedFetch(`/api/session/status?driverId=${encodeURIComponent(driverId)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    driverCompletion.set(driverId, {
      completed: Boolean(data?.completed),
      pendingSteps: data?.pendingSteps || [],
      verified: Boolean(data?.verified),
      cooldownUntil: data?.cooldownUntil || null,
      locked: Boolean(data?.locked),
    });
    return driverCompletion.get(driverId);
  } catch (err) {
    console.warn('Falha ao verificar status de conclusão (gráfica)', err?.message || err);
    driverCompletion.set(driverId, { completed: false, pendingSteps: [], error: true });
    return null;
  } finally {
    driverCompletionPending.delete(driverId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loginForm?.addEventListener('submit', handleLogin);
  logoutButton?.addEventListener('click', handleLogout);
  graphicAgendaToggle?.addEventListener('click', toggleAgenda);
  graphicAgendaClose?.addEventListener('click', closeAgenda);
  graphicAgendaOverlay?.addEventListener('click', closeAgenda);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isAgendaOpen) {
      closeAgenda();
    }
  });
  driverSelect?.addEventListener('change', async event => {
    await applySelectedDriver(event.target.value || '');
  });
  loadSession();
});
window.addEventListener('pagehide', stopActiveCameraStreams);
