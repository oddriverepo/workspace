const TOKEN_KEY = 'oddrive_driver_token';
const loginSection = document.getElementById('driverLogin');
const appSection = document.getElementById('driverApp');
const loginForm = document.getElementById('driverLoginForm');
const loginMessage = document.getElementById('driverLoginMessage');
const loginButton = document.getElementById('driverLoginSubmit');
const stepsContainer = document.getElementById('driverSteps');
const welcomeEl = document.getElementById('driverWelcome');
const campaignInfoEl = document.getElementById('driverCampaignInfo');
const logoutButton = document.getElementById('driverLogout');

(function bindGestureGuards() {
  document.addEventListener('gesturestart', event => event.preventDefault());
  document.addEventListener('dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });
})();

(function devPrefill() {
  var PREFILL = { enabled: false, name: 'Motorista Teste', phone: '51999999999' };
  if (!PREFILL.enabled) return;
  try {
    var nameInput = document.getElementById('driverName');
    var phoneInput = document.getElementById('driverPhone');
    if (nameInput && !nameInput.value && PREFILL.name) nameInput.value = PREFILL.name;
    if (phoneInput && !phoneInput.value && PREFILL.phone) phoneInput.value = PREFILL.phone;
  } catch (e) {
    // ignore
  }
})();

const stepData = new Map(); // stepId -> { photoData?, odometerValue? }
let currentStepIndex = 0;
let currentFlow = null;
let isRefazer = false;
let driverFlowCompleted = false;
let driverLockUntil = null;
let driverVerified = false;
const activeCameraStreams = new Set();
let cameraSessionVersion = 0;
let successOverlayTimeout = null;

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

function isPhotoStep(step = {}) {
  const type = String(step.type || '').toLowerCase();
  const id = String(step.id || '').toLowerCase();
  return type === 'photo' || type === 'foto' || id.includes('photo');
}
function isNumberStep(step = {}) {
  const type = String(step.type || '').toLowerCase();
  const id = String(step.id || '').toLowerCase();
  return type === 'number' || type === 'numero' || id.includes('odometer-value');
}
function hasPhotoForStep(stepId) {
  return Boolean(stepData.get(stepId)?.photoData);
}
function normalizeNumericValue(stepId) {
  const raw = stepData.get(stepId)?.odometerValue;
  return Number(String(raw || '').replace(/\D+/g, ''));
}
function isNumericValueValid(stepId) {
  const num = normalizeNumericValue(stepId);
  return Number.isFinite(num) && num > 0;
}
function isStepRequirementMet(step) {
  if (!step?.required) return true;
  if (isPhotoStep(step)) return hasPhotoForStep(step.id);
  if (isNumberStep(step)) return isNumericValueValid(step.id);
  return true;
}

function getToken() { return localStorage.getItem(TOKEN_KEY); }

function buildSimplePhotoUI(stepId, onStateChange = () => {}) {
  const container = document.createElement('div');
  container.style = 'display:flex;flex-direction:column;gap:10px;';

  const preview = document.createElement('img');
  preview.alt = 'Prévia';
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
    if (existing.length) existing.forEach(el => el.remove());
    const warn = document.createElement('div');
    warn.className = 'small camera-warning';
    warn.style = 'padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff6f0;color:#9a4b00;';
    const parts = [];
    if (customText) parts.push(customText);
    else parts.push('Tire uma foto bem visível com qualidade.');
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
        const compressed = canvas.toDataURL('image/jpeg', 0.8);
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
    // BLOQUEIA DESKTOP: Impede envio de fotos salvas - apenas câmera ao vivo no celular
    if (!isMobileDevice()) {
      showMobileOnlyWarning('⚠️ Esta função só está disponível no celular. Acesse pelo dispositivo móvel para tirar fotos em tempo real.');
      return;
    }
    
    try {
      const canMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      if (!canMedia || !isSecure()) {
        showMobileOnlyWarning('⚠️ Requer HTTPS para abrir a câmera. Verifique a conexão.');
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

  const existing = stepData.get(stepId);
  if (existing?.photoData) {
    preview.src = existing.photoData;
    preview.style.display = 'block';
    btnRetake.disabled = false;
    onStateChange(stepId);
  }

  return container;
}

function ensureGlobalMobileWarning() {
  if (isMobileDevice() || !stepsContainer) return;
  let warn = document.getElementById('driverMobileWarning');
  if (!warn) {
    warn = document.createElement('div');
    warn.id = 'driverMobileWarning';
    warn.className = 'small';
    warn.style = 'margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff6f0;color:#9a4b00;';
    warn.textContent = 'Use a área do motorista pelo celular. A câmera só funciona via HTTPS.';
    const parent = stepsContainer.parentNode;
    if (parent) parent.insertBefore(warn, stepsContainer);
  }
}


function isMobileDevice() {
  try {
    const ua = (navigator.userAgent || navigator.vendor || window.opera || "").toLowerCase();
    const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
    return /android|iphone|ipad|ipod|windows phone|mobile/.test(ua) || isTouch;
  } catch {
    return false;
  }
}


function setToken(value) {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

function revokeSession(token) {
  if (!token) return;
  const fullUrl = `${window.API_BASE || ''}/api/session/logout`;
  fetch(fullUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
  }).catch(err => console.warn('Falha ao encerrar sessao no servidor', err?.message || err));
}

async function authedFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const fullUrl = url.startsWith('http') ? url : `${window.API_BASE || ''}${url}`;
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
  resetDriverSchedule();
  loginSection.classList.remove('hidden');
  appSection.classList.add('hidden');
  if (message) loginMessage.textContent = message;
}

function showApp() {
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  loginMessage.textContent = '';
}

// Loading / success overlay
let overlayEl = null;
function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'overlay';
  overlayEl.innerHTML = `
    <div class="overlay-card" id="overlayCard">
      <div class="spinner"></div>
      <div id="overlayText" class="small">Enviando...</div>
    </div>`;
  document.body.appendChild(overlayEl);
  return overlayEl;
}
function showLoading(text='Enviando...') {
  ensureOverlay();
  clearSuccessOverlayTimeout();
  const card = overlayEl.querySelector('#overlayCard');
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  const label = document.createElement('div');
  label.id = 'overlayText';
  label.className = 'small';
  label.textContent = text;
  card.replaceChildren(spinner, label);
  overlayEl.classList.add('show');
}
function hideLoading() {
  if (overlayEl) overlayEl.classList.remove('show');
}
function showSuccess(message='Concluído com sucesso! Obrigado.') {
  ensureOverlay();
  clearSuccessOverlayTimeout();
  const card = overlayEl.querySelector('#overlayCard');
  const icon = document.createElement('div');
  icon.style.fontSize = '48px';
  icon.textContent = '\u2713';
  const title = document.createElement('h3');
  title.style.margin = '8px 0';
  title.textContent = String(message || '');
  card.replaceChildren(icon, title);
  overlayEl.classList.add('show');
  // Brief overlay, then insert a persistent in-app success panel (sem refazer)
  successOverlayTimeout = setTimeout(() => {
    successOverlayTimeout = null;
    try {
      overlayEl.classList.remove('show');
      if (typeof stepsContainer !== 'undefined' && stepsContainer) {
        stepsContainer.innerHTML = '';
        const done = document.createElement('article');
        done.id = 'persistentSuccessPanel';
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
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const payload = {
    name: formData.get('name')?.trim(),
    phone: formData.get('phone')?.trim(),
  };
  const phoneDigits = String(payload.phone || '').replace(/\D+/g, '');

  if (!payload.name || !payload.phone) {
    loginMessage.textContent = 'Informe seu nome e número de celular.';
    return;
  }
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    loginMessage.textContent = 'Informe um número de celular válido.';
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = 'Entrando...';
  loginMessage.textContent = '';

  try {
    const response = await fetch(`${window.API_BASE || ''}/api/session/driver`, {
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
    await loadSession();
  } catch (err) {
    console.error(err);
    loginMessage.textContent = err.message || 'Falha ao fazer login.';
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
}

function isSecure() {
  try { return window.isSecureContext; } catch { return false; }
}

function renderFlow(flow) {
  stopActiveCameraStreams();
  currentFlow = flow || currentFlow;
  const steps = Array.isArray(currentFlow?.steps) ? currentFlow.steps : [];
  if (!steps.length) {
    stepsContainer.innerHTML = '<p class="small">Nenhuma atividade pendente no momento.</p>';
    return;
  }
  if (driverFlowCompleted || (driverLockUntil && driverLockUntil > Date.now())) {
    renderCompletedState();
    return;
  }
  stepsContainer.innerHTML = '';
  requestAnimationFrame(() => {
    try {
      window.scrollTo({ top: 0, behavior: currentStepIndex === 0 ? 'auto' : 'smooth' });
    } catch {}
  });

  const step = steps[currentStepIndex];
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
      renderFlow(flow);
    }
  };

  const btnNext = document.createElement('button');
  btnNext.className = 'btn btn--primary';
  btnNext.type = 'button';
  btnNext.textContent = currentStepIndex === steps.length - 1 ? 'Concluir' : 'Avançar';
  const updateActionsVisibility = () => {
    const show = !(isPhotoStep(step) && !hasPhotoForStep(step.id));
    actions.style.display = show ? 'flex' : 'none';
  };

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
    if (isNumberStep(step)) {
      btnNext.disabled = !isNumericValueValid(step.id);
      updateActionsVisibility();
      return;
    }
    btnNext.disabled = false;
    updateActionsVisibility();
  };
  refreshNextButtonState();

  btnNext.onclick = async () => {
    if (navBusy) return;
    const s = steps[currentStepIndex];
    if (s.required && isPhotoStep(s) && !hasPhotoForStep(s.id)) {
      alert(`Capture ${s.label || 'a imagem'} antes de avançar.`);
      return;
    }
    if (s.required && isNumberStep(s) && !isNumericValueValid(s.id)) {
      alert('Informe a quilometragem válida antes de continuar.');
      return;
    }

    // upload per step
    try {
      navBusy = true;
      refreshNextButtonState();
      showLoading(currentStepIndex === steps.length - 1 ? 'Concluindo...' : 'Enviando...');
      const payload = stepData.get(s.id) || {};
      if (Object.keys(payload).length) {
        await uploadEvidence({ step: s.id, ...payload, refazer: Boolean(isRefazer) });
      }
    } catch (e) {
      console.error(e);
      alert('Falha ao enviar evidência. Tente novamente.');
      navBusy = false;
      hideLoading();
      refreshNextButtonState();
      return;
    }

    navBusy = false;
    if (currentStepIndex < steps.length - 1) {
      hideLoading();
      currentStepIndex += 1;
      ensureGlobalMobileWarning();
      renderFlow(flow);
    } else {
      hideLoading();
      showSuccess('Processo realizado com sucesso! Obrigado!');
    }
  };
  actions.appendChild(btnPrev);
  actions.appendChild(btnNext);
  head.appendChild(actions);

  // Body content (photo/odometer inputs)
  if (isPhotoStep(step)) {
    body.appendChild(buildSimplePhotoUI(step.id, () => refreshNextButtonState()));
  }
  if (isNumberStep(step)) {
    body.appendChild(
      buildNumberInputUI(step.id, 'Informe a quilometragem do odômetro', () => refreshNextButtonState()),
    );
  }
  refreshNextButtonState();

  // Body content below header/actions
  wrapper.appendChild(head);
  wrapper.appendChild(body);
  stepsContainer.appendChild(wrapper);
}

async function fetchCompletionStatus() {
  try {
    const res = await authedFetch('/api/session/status');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    driverFlowCompleted = Boolean(data?.locked);
    driverLockUntil = data?.cooldownUntil || null;
    driverVerified = Boolean(data?.verified);
    return true;
  } catch (err) {
    console.warn('Falha ao verificar status de conclusão', err?.message || err);
    return false;
  }
}

function renderDriverStatusError() {
  stepsContainer.innerHTML = '';
  const card = document.createElement('article');
  card.className = 'step-item';
  const title = document.createElement('h3');
  title.textContent = 'Não foi possível verificar o status';
  const message = document.createElement('p');
  message.className = 'small muted';
  message.textContent = 'Confira sua conexão e tente novamente antes de enviar as evidências.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn--primary';
  retry.textContent = 'Tentar novamente';
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    retry.textContent = 'Verificando...';
    await loadSession();
  });
  card.append(title, message, retry);
  stepsContainer.appendChild(card);
}

function renderCompletedState() {
  const unlockDate = driverLockUntil && driverLockUntil > Date.now()
    ? new Date(driverLockUntil).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;
  stepsContainer.innerHTML = `
    <article class="step-item" style="text-align:center;">
      <h3 style="margin:0 0 6px;">Envios registrados</h3>
      <p class="small muted" style="margin:0;">${unlockDate ? `Aguarde até ${unlockDate} ou até o admin liberar.` : 'Aguarde a revisão do administrador antes de enviar novamente.'}</p>
    </article>`;
}

function buildNumberInputUI(stepId, label, onStateChange = () => {}) {
  const c = document.createElement('div');
  c.innerHTML = `
    <label class="small" style="display:block;margin-bottom:6px;">${label}</label>
    <input type="tel" inputmode="numeric" pattern="[0-9]*" placeholder="Ex: 123456" class="driver-input" id="odometerInput" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;" />
  `;
  const input = c.querySelector('#odometerInput');
  input.value = stepData.get(stepId)?.odometerValue || '';
  input.addEventListener('input', () => {
    stepData.set(stepId, { odometerValue: input.value });
    onStateChange(stepId);
  });
  return c;
}


async function uploadEvidence({ step, photoData, odometerValue, refazer } = {}) {
  const res = await authedFetch('/api/session/evidence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, photoData, odometerValue, refazer })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json();
}

async function loadSession() {
  const token = getToken();
  if (!token) {
    showLogin();
    return;
  }

  try {
    driverFlowCompleted = false;
    driverLockUntil = null;
    driverVerified = false;
    const [profileRes, flowRes] = await Promise.all([
      authedFetch('/api/session/me'),
      authedFetch('/api/session/flow'),
    ]);

    if (!profileRes.ok) {
      const body = await profileRes.text().catch(() => '');
      throw new Error(body || `HTTP ${profileRes.status}`);
    }
    if (!flowRes.ok) {
      const body = await flowRes.text().catch(() => '');
      throw new Error(body || `HTTP ${flowRes.status}`);
    }

    const profile = await profileRes.json();
    const flow = await flowRes.json();
    currentFlow = flow;
    isRefazer = false;
    stepData.clear();
    currentStepIndex = 0;
    welcomeEl.textContent = profile?.driver?.name
      ? `Olá, ${profile.driver.name}`
      : 'Olá, motorista';

    campaignInfoEl.textContent = profile?.campaign?.name
      ? `Campanha: ${profile.campaign.name}`
      : '';

    const statusLoaded = await fetchCompletionStatus();
    if (!statusLoaded) {
      if (!getToken()) throw new Error('Sessão expirada. Faça login novamente.');
      renderDriverStatusError();
      showApp();
      return;
    }

    ensureGlobalMobileWarning();
    renderFlow(currentFlow);
    showApp();

    // Load scheduling section
    if (profile?.driver?.id && profile?.campaign?.id) {
      loadDriverSchedule(profile.campaign.id, profile.driver.id, profile.driver.name || '');
    }
  } catch (err) {
    console.error(err);
    setToken(null);
    showLogin(err.message || 'Sessão expirada. Faça login novamente.');
  }
}

function handleLogout() {
  const token = getToken();
  stopActiveCameraStreams();
  clearSuccessOverlayTimeout();
  hideLoading();
  setToken(null);
  revokeSession(token);
  driverFlowCompleted = false;
  driverLockUntil = null;
  driverVerified = false;
  showLogin('Você saiu da sessão.');
}

// ════════════════════════════════════════════════════════
//  SCHEDULING — Agendar horário (Driver Portal)
// ════════════════════════════════════════════════════════

const scheduleSection   = document.getElementById('driverScheduleSection');
const myBookingsEl      = document.getElementById('driverMyBookings');
const availableSlotsEl  = document.getElementById('driverAvailableSlots');

let _dCampaignId = null;
let _dDriverId   = null;
let _dDriverName = null;
let driverScheduleRequestVersion = 0;
let driverBookingPending = false;

function resetDriverSchedule() {
  driverScheduleRequestVersion += 1;
  _dCampaignId = null;
  _dDriverId = null;
  _dDriverName = null;
  driverBookingPending = false;
  scheduleSection?.classList.add('hidden');
  if (myBookingsEl) myBookingsEl.innerHTML = '';
  if (availableSlotsEl) availableSlotsEl.innerHTML = '';
}

async function loadDriverSchedule(campaignId, driverId, driverName) {
  const requestVersion = ++driverScheduleRequestVersion;
  _dCampaignId = campaignId;
  _dDriverId   = driverId;
  _dDriverName = driverName;
  if (!scheduleSection) return;

  try {
    const [bookingsRes, availableRes] = await Promise.all([
      authedFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/driver/${encodeURIComponent(driverId)}/bookings`),
      authedFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/available`),
    ]);

    if (!bookingsRes.ok || !availableRes.ok) {
      const failedResponse = !bookingsRes.ok ? bookingsRes : availableRes;
      const body = await failedResponse.json().catch(() => ({}));
      throw new Error(body.error || 'Nao foi possivel carregar os agendamentos.');
    }

    const bookingsData = await bookingsRes.json();
    const availableData = await availableRes.json();
    if (
      requestVersion !== driverScheduleRequestVersion ||
      _dCampaignId !== campaignId ||
      _dDriverId !== driverId
    ) return;

    const bookings = bookingsData.bookings || [];
    const graphics = availableData.graphics || [];
    const activeBookings = bookings.filter(b => b.status === 'confirmed');

    // Determine which types the driver still needs to book
    const hasInstallation = activeBookings.some(b => b.type === 'installation');
    const hasRemoval      = activeBookings.some(b => b.type === 'removal');

    // If no slots at all, hide the section
    if (!graphics.length && !activeBookings.length) {
      scheduleSection.classList.add('hidden');
      return;
    }

    scheduleSection.classList.remove('hidden');

    // Render current bookings
    renderDriverBookings(activeBookings);

    // Render available slots (filter out types already booked)
    renderDriverAvailableSlots(graphics, hasInstallation, hasRemoval);
  } catch (err) {
    if (requestVersion !== driverScheduleRequestVersion) return;
    if (!getToken()) {
      showLogin('Sessão expirada. Faça login novamente.');
      return;
    }
    console.warn('[scheduling] loadDriverSchedule error:', err);
    scheduleSection.classList.add('hidden');
  }
}

function formatDateBR(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Data não informada';
}

function renderDriverBookings(bookings) {
  if (!myBookingsEl) return;
  if (!bookings.length) {
    myBookingsEl.innerHTML = '';
    return;
  }
  myBookingsEl.innerHTML = '<h4 style="margin:0 0 6px;font-size:14px;">Meus agendamentos</h4>';
  for (const b of bookings) {
    const typeLabel = b.type === 'installation' ? 'Instalação' : 'Retirada';
    const card = document.createElement('div');
    card.className = 'driver-booking-card';
    card.innerHTML = `
      <div class="booking-info">
        <div class="booking-type"></div>
        <div class="booking-datetime"></div>
      </div>
      <button type="button" class="booking-cancel-btn">Cancelar</button>
    `;
    card.querySelector('.booking-type').textContent = typeLabel;
    card.querySelector('.booking-datetime').textContent = `${formatDateBR(b.date)} — ${b.startTime || '--:--'} às ${b.endTime || '--:--'}`;
    card.querySelector('.booking-cancel-btn').addEventListener('click', async (e) => {
      if (!confirm('Cancelar este agendamento?')) return;
      const btn = e.target;
      const campaignId = _dCampaignId;
      const driverId = _dDriverId;
      const driverName = _dDriverName;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const res = await authedFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/book/${encodeURIComponent(b._id)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Erro ao cancelar');
        }
        if (_dCampaignId !== campaignId || _dDriverId !== driverId) return;
        await loadDriverSchedule(campaignId, driverId, driverName);
      } catch (err) {
        if (!getToken()) {
          showLogin('Sessão expirada. Faça login novamente.');
          return;
        }
        if (_dCampaignId === campaignId && _dDriverId === driverId) {
          alert(err.message);
          btn.disabled = false;
          btn.textContent = 'Cancelar';
        }
      }
    });
    myBookingsEl.appendChild(card);
  }
}

function formatDatePillBR(dateStr) {
  // Returns { weekday: 'seg', day: '27', month: 'abr' } for compact pill display
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return {
    weekday: weekdays[dt.getDay()],
    day: String(d).padStart(2, '0'),
    month: months[m - 1],
  };
}

function compareSlots(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
}

function renderDriverAvailableSlots(graphics, hasInstallation, hasRemoval) {
  if (!availableSlotsEl) return;
  availableSlotsEl.innerHTML = '';

  // Filter out slots for types already booked
  const filteredGraphics = graphics.map(g => {
    const filteredSlots = g.slots.filter(s => {
      if (s.type === 'installation' && hasInstallation) return false;
      if (s.type === 'removal' && hasRemoval) return false;
      return true;
    });
    return { ...g, slots: filteredSlots };
  }).filter(g => g.slots.length > 0);

  if (!filteredGraphics.length) {
    if (hasInstallation && hasRemoval) {
      availableSlotsEl.innerHTML = '<p class="small" style="color:#43a047;font-weight:600;">Todos os horários já agendados.</p>';
    }
    return;
  }

  availableSlotsEl.innerHTML = '<h4>Horários disponíveis</h4>';

  // ── 1) "Próximo disponível" CTA — earliest slot across all graphics & types
  const allSlots = [];
  for (const g of filteredGraphics) {
    for (const s of g.slots) allSlots.push({ ...s, graphicName: g.graphicName });
  }
  allSlots.sort(compareSlots);
  const next = allSlots[0];
  if (next) {
    const nextTypeLabel = next.type === 'installation' ? 'Instalação' : 'Retirada';
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'next-slot-cta';
    cta.innerHTML = `
      <span class="next-slot-cta__label">Próximo disponível</span>
      <span class="next-slot-cta__when">${formatDateBR(next.date)} · ${next.startTime}</span>
      <span class="next-slot-cta__meta">${escapeHTML(nextTypeLabel)} — ${escapeHTML(next.graphicName)}</span>
      <span class="next-slot-cta__action">Reservar agora →</span>
    `;
    cta.addEventListener('click', () => bookSlot(next, next.graphicName));
    availableSlotsEl.appendChild(cta);
  }

  // ── 2) Date carousel + chips of selected date — per (graphic + type)
  for (const g of filteredGraphics) {
    // Split by type so each carousel shows one type at a time
    const byType = { installation: [], removal: [] };
    for (const s of g.slots) {
      if (byType[s.type]) byType[s.type].push(s);
    }

    for (const type of ['installation', 'removal']) {
      const slots = byType[type];
      if (!slots.length) continue;

      // Group by date
      const byDate = {};
      for (const s of slots) {
        if (!byDate[s.date]) byDate[s.date] = [];
        byDate[s.date].push(s);
      }
      const dates = Object.keys(byDate).sort();
      // Sort each day's slots by startTime
      for (const d of dates) byDate[d].sort((a, b) => a.startTime < b.startTime ? -1 : 1);

      const typeLabel = type === 'installation' ? 'Instalação' : 'Retirada';
      const group = document.createElement('div');
      group.className = 'graphic-slot-group';
      group.innerHTML = `
        <div class="graphic-slot-group-name">${escapeHTML(g.graphicName)} <span class="graphic-slot-type">${typeLabel}</span></div>
      `;

      // Date pills carousel
      const carousel = document.createElement('div');
      carousel.className = 'date-pills-carousel';
      carousel.setAttribute('role', 'tablist');

      // Chips container (updated when a date is selected)
      const chipsWrap = document.createElement('div');
      chipsWrap.className = 'slot-chips';

      const renderChipsForDate = (date) => {
        chipsWrap.innerHTML = '';
        for (const slot of byDate[date]) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'slot-chip';
          chip.textContent = `${slot.startTime}–${slot.endTime}`;
          chip.addEventListener('click', () => bookSlot(slot, g.graphicName));
          chipsWrap.appendChild(chip);
        }
      };

      dates.forEach((date, idx) => {
        const { weekday, day, month } = formatDatePillBR(date);
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'date-pill' + (idx === 0 ? ' is-active' : '');
        pill.setAttribute('role', 'tab');
        pill.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
        pill.dataset.date = date;
        pill.innerHTML = `
          <span class="date-pill__weekday">${weekday}</span>
          <span class="date-pill__day">${day}</span>
          <span class="date-pill__month">${month}</span>
          <span class="date-pill__count">${byDate[date].length}</span>
        `;
        pill.addEventListener('click', () => {
          carousel.querySelectorAll('.date-pill').forEach(p => {
            p.classList.remove('is-active');
            p.setAttribute('aria-selected', 'false');
          });
          pill.classList.add('is-active');
          pill.setAttribute('aria-selected', 'true');
          renderChipsForDate(date);
        });
        carousel.appendChild(pill);
      });

      // Initial render: first date
      renderChipsForDate(dates[0]);

      group.appendChild(carousel);
      group.appendChild(chipsWrap);
      availableSlotsEl.appendChild(group);
    }
  }
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

async function bookSlot(slot, graphicName) {
  const typeLabel = slot.type === 'installation' ? 'Instalação' : 'Retirada';
  const msg = `Confirmar agendamento?\n\n${typeLabel}\nGráfica: ${graphicName}\n${formatDateBR(slot.date)} — ${slot.startTime} às ${slot.endTime}`;
  if (!confirm(msg)) return;
  if (driverBookingPending) return;
  driverBookingPending = true;
  const campaignId = _dCampaignId;
  const driverId = _dDriverId;
  const driverName = _dDriverName;

  try {
    const res = await authedFetch(`/api/scheduling/${encodeURIComponent(campaignId)}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotId: slot._id,
        driverId,
        driverName,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao agendar');
    if (_dCampaignId !== campaignId || _dDriverId !== driverId) return;
    alert('Horário agendado com sucesso!');
    await loadDriverSchedule(campaignId, driverId, driverName);
  } catch (err) {
    if (!getToken()) {
      showLogin('Sessão expirada. Faça login novamente.');
      return;
    }
    if (_dCampaignId === campaignId && _dDriverId === driverId) {
      alert(err.message);
    }
  } finally {
    driverBookingPending = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loginForm?.addEventListener('submit', handleLogin);
  logoutButton?.addEventListener('click', handleLogout);
  loadSession();
});
window.addEventListener('pagehide', stopActiveCameraStreams);




