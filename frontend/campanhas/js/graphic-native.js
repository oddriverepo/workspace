// graphic-native.js - Versão nativa usando Capacitor
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { SplashScreen } from '@capacitor/splash-screen';
import { API_BASE } from './config.js';

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

let drivers = [];
let selectedDriverId = '';
let currentProfile = null;
let currentFlow = null;
let currentStepIndex = 0;
const stepData = new Map();
let isRefazer = false;
let overlayEl = null;
let tempDriverData = null;

async function promptDialog(message, options = {}) {
  if (typeof window.adminPrompt === 'function') {
    return window.adminPrompt(message, options);
  }
  console.warn('[Prompt] adminPrompt indisponível:', message);
  return null;
}

async function getToken() {
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  return value;
}

async function setToken(value) {
  if (value) {
    await Preferences.set({ key: TOKEN_KEY, value });
  } else {
    await Preferences.remove({ key: TOKEN_KEY });
  }
}

async function authedFetch(url, options = {}) {
  const token = await getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const response = await fetch(fullUrl, { ...options, headers });
  
  if (response.status === 401) {
    await setToken(null);
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  return response;
}

function showLogin(message = '') {
  loginSection.classList.remove('hidden');
  appSection.classList.add('hidden');
  if (message) loginMessage.textContent = message;
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

function resetFlowProgress() {
  currentStepIndex = 0;
  stepData.clear();
}

function isMobileDevice() {
  return true;
}

function isSecure() {
  return true;
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
  overlayEl.querySelector('#graphicOverlayText').textContent = text;
  overlayEl.classList.add('show');
}

function hideLoading() {
  if (overlayEl) overlayEl.classList.remove('show');
}

function showSuccess(message = 'Envio concluído!') {
  ensureOverlay();
  const card = overlayEl.querySelector('#graphicOverlayCard');
  card.innerHTML = `<div style="font-size:32px;font-weight:700;">&#10003;</div><h3 style="margin:8px 0;">${message}</h3>`;
  overlayEl.classList.add('show');
  setTimeout(() => {
    try { overlayEl.classList.remove('show'); } catch (e) {}
    try {
      const prev = document.getElementById('graphicSuccessPanel'); if (prev) prev.remove();
      const panel = document.createElement('div');
      panel.id = 'graphicSuccessPanel';
      panel.style = 'background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:16px;box-shadow:var(--shadow);';
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div>
            <h3 style="margin:0 0 6px;">Processo realizado com sucesso! Obrigado!</h3>
            <p class="small" style="margin:0;color:var(--muted);">Suas imagens foram enviadas.</p>
          </div>
        </div>`;
      if (stepsContainer && stepsContainer.parentNode) {
        stepsContainer.parentNode.insertBefore(panel, stepsContainer);
      } else {
        document.body.appendChild(panel);
      }
      // clear refazer flag after showing success panel so future cycles are normal
      isRefazer = false;
      // if temp driver flow was used, refresh session shortly after
      if (tempDriverData) {
        setTimeout(async () => {
          try { await loadSession(); tempDriverData = null; } catch {};
        }, 1200);
      }
    } catch (e) { console.error(e); }
  }, 1100);
}

async function takePictureNative() {
  try {
    const image = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      saveToGallery: false,
      correctOrientation: true,
      width: 1280,
      height: 720,
      preserveAspectRatio: true
    });
    
    return image.dataUrl;
  } catch (error) {
    console.error('Erro ao capturar foto:', error);
    throw new Error('Não foi possível capturar a foto. Verifique as permissões.');
  }
}

function buildNativePhotoUI(stepId) {
  const container = document.createElement('div');
  container.style = 'display:flex;flex-direction:column;gap:10px;';

  const preview = document.createElement('img');
  preview.alt = 'Prévia da imagem';
  preview.style = 'max-width:100%;border:1px solid var(--line);border-radius:10px;display:none;';
  container.appendChild(preview);

  const controls = document.createElement('div');
  controls.style = 'display:flex;gap:10px;flex-wrap:wrap;';
  container.appendChild(controls);

  const btnSnap = document.createElement('button');
  btnSnap.className = 'btn btn--primary';
  btnSnap.textContent = 'Abrir câmera';
  
  const btnRetake = document.createElement('button');
  btnRetake.className = 'btn';
  btnRetake.textContent = 'Refazer';
  btnRetake.disabled = true;
  
  controls.append(btnSnap, btnRetake);

  const hint = document.createElement('p');
  hint.className = 'small';
  hint.style = 'color:var(--muted);margin-top:8px;';
  hint.textContent = 'Tire uma foto bem visível com boa iluminação.';
  container.appendChild(hint);

  btnSnap.onclick = async () => {
    if (!ensureDriverSelected()) {
      alert('Selecione um motorista antes de capturar a foto.');
      return;
    }
    try {
      showLoading('Abrindo câmera...');
      const dataUrl = await takePictureNative();
      hideLoading();
      
      preview.src = dataUrl;
      preview.style.display = 'block';
      btnRetake.disabled = false;
      stepData.set(stepId, { ...(stepData.get(stepId) || {}), photoData: dataUrl });
      hint.textContent = 'Foto capturada com sucesso!';
      hint.style.color = 'var(--success)';
    } catch (err) {
      hideLoading();
      alert(err.message || 'Erro ao capturar foto');
    }
  };

  btnRetake.onclick = async () => {
    try {
      showLoading('Abrindo câmera...');
      const dataUrl = await takePictureNative();
      hideLoading();
      
      preview.src = dataUrl;
      preview.style.display = 'block';
      stepData.set(stepId, { ...(stepData.get(stepId) || {}), photoData: dataUrl });
    } catch (err) {
      hideLoading();
      alert(err.message || 'Erro ao capturar foto');
    }
  };

  const saved = stepData.get(stepId);
  if (saved?.photoData) {
    preview.src = saved.photoData;
    preview.style.display = 'block';
    btnRetake.disabled = false;
    hint.textContent = 'Foto capturada com sucesso!';
    hint.style.color = 'var(--success)';
  }

  return container;
}

function buildNotesUI(stepId) {
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
  });
  return wrapper;
}

function buildNumberInputUI(stepId, labelText) {
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
  });
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

async function uploadEvidence({ step, photoData, notes, odometerValue }) {
  if (!ensureDriverSelected()) throw new Error('Selecione um motorista.');
  const payload = { step };
  if (selectedDriverId && selectedDriverId !== '__new__') payload.driverId = selectedDriverId;
  if (selectedDriverId === '__new__' && tempDriverData) payload.driver = tempDriverData;
  if (photoData) payload.photoData = photoData;
  if (typeof notes === 'string') payload.notes = notes;
  if (odometerValue != null) payload.odometerValue = odometerValue;
  // include refazer flag so backend can append suffix to file names
  payload.refazer = Boolean(isRefazer);

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
  const wrapper = document.createElement('div');
  wrapper.className = 'step-item';

  const head = document.createElement('div');
  head.className = 'step-head';
  head.innerHTML = `<h3>${step.label}</h3><span class="pill">${step.type}</span>`;
  wrapper.appendChild(head);

  const body = document.createElement('div');
  body.className = 'step-body';

  const driverInfo = document.createElement('p');
  driverInfo.className = 'small muted';
  const driver = drivers.find(d => d.id === selectedDriverId);
  driverInfo.textContent = driver ? `Motorista selecionado: ${driver.name}` : '';
  body.appendChild(driverInfo);

  if (step.type === 'photo') {
    body.appendChild(buildNativePhotoUI(step.id));
  } else if (step.type === 'text') {
    body.appendChild(buildNotesUI(step.id));
  } else if (step.type === 'number') {
    body.appendChild(buildNumberInputUI(step.id, 'Informe a quilometragem do odômetro'));
  }

  const actions = document.createElement('div');
  actions.style = 'display:flex;gap:12px;margin-top:12px;justify-content:flex-end;';

  const btnPrev = document.createElement('button');
  btnPrev.className = 'btn';
  btnPrev.textContent = 'Voltar';
  btnPrev.disabled = currentStepIndex === 0;
  btnPrev.onclick = () => {
    if (currentStepIndex > 0) {
      currentStepIndex -= 1;
      renderFlow(currentFlow);
    }
  };

  const btnNext = document.createElement('button');
  btnNext.className = 'btn btn--primary';
  btnNext.textContent = currentStepIndex === steps.length - 1 ? 'Concluir' : 'Avançar';
  btnNext.onclick = async () => {
    if (!ensureDriverSelected()) {
      alert('Selecione um motorista para continuar.');
      return;
    }
    const data = stepData.get(step.id) || {};

    if (step.type === 'photo' && !data.photoData) {
      alert('Capture a foto antes de avançar.');
      return;
    }

    if (step.type === 'text') {
      const raw = typeof data.notes === 'string' ? data.notes.trim() : '';
      if (!raw) {
        stepData.set(step.id, { notes: '' });
      }
    }

    if (step.type === 'number' && step.required) {
      const val = data.odometerValue;
      const n = val != null ? parseFloat(String(val).replace(/[^\d.]/g, '')) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        alert('Informe a quilometragem do odômetro antes de avançar.');
        return;
      }
    }

    try {
      showLoading(currentStepIndex === steps.length - 1 ? 'Concluindo...' : 'Enviando...');
      const hasPayload =
        (step.type === 'photo' && data.photoData) ||
        (step.type === 'text' && typeof data.notes === 'string' && data.notes.trim().length) ||
        (step.type === 'number' && data.odometerValue != null);
      if (hasPayload) {
        await uploadEvidence({ step: step.id, ...data });
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Falha ao enviar. Tente novamente.');
      hideLoading();
      return;
    }

    if (currentStepIndex < steps.length - 1) {
      currentStepIndex += 1;
      hideLoading();
      renderFlow(currentFlow);
    } else {
      showSuccess('Registro finalizado com sucesso!');
    }
  };

  actions.append(btnPrev, btnNext);
  wrapper.appendChild(body);
  wrapper.appendChild(actions);
  stepsContainer.appendChild(wrapper);
}

function renderDriverOptions(list = []) {
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
    return;
  }

  driverSelect.disabled = false;
  drivers.forEach(driver => {
    const option = document.createElement('option');
    option.value = driver.id;
    option.textContent = driver.name || '(sem nome)';
    driverSelect.appendChild(option);
  });

  const addOpt = document.createElement('option');
  addOpt.value = '__new__';
  addOpt.textContent = 'Adicionar novo motorista...';
  driverSelect.appendChild(addOpt);

  if (!drivers.some(d => d.id === selectedDriverId)) {
    selectedDriverId = drivers[0]?.id || '';
  }

  driverSelect.value = selectedDriverId;
  updateDriverHint();
  resetFlowProgress();
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
    const response = await fetch(`${API_BASE}/api/session/graphic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Não foi possível fazer login.');
    }
    const data = await response.json();
    await setToken(data.token);
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
  const token = await getToken();
  if (!token) {
    showLogin();
    return;
  }

  try {
    stepsContainer.innerHTML = '<p class="small">Carregando dados da campanha...</p>';
    const [profileRes, driversRes, flowRes] = await Promise.all([
      authedFetch('/api/session/me'),
      authedFetch('/api/session/graphic/drivers'),
      authedFetch('/api/session/flow'),
    ]);

    const profile = await profileRes.json();
    const driversData = await driversRes.json();
    const flowData = await flowRes.json();
    currentProfile = profile;
    currentFlow = flowData;

    welcomeEl.textContent = profile?.graphic?.responsible
      ? `Olá, ${profile.graphic.responsible}`
      : 'Gráfica conectada';
    campaignInfoEl.textContent = profile?.campaign?.name
      ? `Campanha: ${profile.campaign.name}`
      : '';

    renderDriverOptions(driversData?.drivers || []);
    isRefazer = false; // reset refazer on session load
    renderFlow(currentFlow);
    showApp();
  } catch (err) {
    console.error(err);
    await setToken(null);
    showLogin(err.message || 'Sessão expirada. Faça login novamente.');
  }
}

async function handleLogout() {
  await setToken(null);
  drivers = [];
  selectedDriverId = '';
  currentProfile = null;
  currentFlow = null;
  resetFlowProgress();
  if (stepsContainer) stepsContainer.innerHTML = '<p class="small">Faça login para iniciar.</p>';
  showLogin('Você saiu da sessão.');
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await SplashScreen.hide();
  } catch (e) {
    console.log('SplashScreen não disponível (modo web)');
  }

  loginForm?.addEventListener('submit', handleLogin);
  logoutButton?.addEventListener('click', handleLogout);
  driverSelect?.addEventListener('change', async event => {
    const prev = selectedDriverId;
    selectedDriverId = event.target.value || '';
    if (selectedDriverId === '__new__') {
      const name = await promptDialog('Nome do motorista (obrigatório):', {
        title: 'Novo motorista',
        confirmLabel: 'Continuar',
        cancelLabel: 'Cancelar',
        required: true,
      });
      if (!name || !String(name).trim()) {
        selectedDriverId = prev || '';
        driverSelect.value = selectedDriverId;
        updateDriverHint();
        return;
      }
      const phone = await promptDialog('Telefone do motorista (opcional):', {
        title: 'Novo motorista',
        confirmLabel: 'Continuar',
        cancelLabel: 'Pular',
      });
      const cpf = await promptDialog('CPF do motorista (opcional):', {
        title: 'Novo motorista',
        confirmLabel: 'Continuar',
        cancelLabel: 'Pular',
      });
      const plate = await promptDialog('Placa do veículo (opcional):', {
        title: 'Novo motorista',
        confirmLabel: 'Continuar',
        cancelLabel: 'Pular',
      });
      const email = await promptDialog('Email do motorista (opcional):', {
        title: 'Novo motorista',
        confirmLabel: 'Salvar',
        cancelLabel: 'Pular',
      });
      tempDriverData = {
        name: String(name).trim(),
        phone: String(phone || '').trim(),
        cpf: String(cpf || '').trim(),
        plate: String(plate || '').trim(),
        email: String(email || '').trim(),
      };
      updateDriverHint();
      resetFlowProgress();
      renderFlow(currentFlow);
      return;
    }
    updateDriverHint();
    resetFlowProgress();
    renderFlow(currentFlow);
  });
  await loadSession();
});

