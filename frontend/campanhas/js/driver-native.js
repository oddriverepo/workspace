// driver-native.js - Versão nativa usando Capacitor
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { SplashScreen } from '@capacitor/splash-screen';
import { API_BASE } from './config.js';

function escapeHTML(s) { const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }

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

// Secure storage com Capacitor Preferences
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
  overlayEl.querySelector('#overlayText').textContent = text;
  overlayEl.classList.add('show');
}

function hideLoading() {
  if (overlayEl) overlayEl.classList.remove('show');
}

function showSuccess(message='Concluído com sucesso! Obrigado.') {
  ensureOverlay();
  const card = overlayEl.querySelector('#overlayCard');
  card.innerHTML = `<div style="font-size:48px;">&#10003;</div><h3 style="margin:8px 0;">${escapeHTML(message)}</h3>`;
  overlayEl.classList.add('show');
  // show overlay briefly and then show a persistent success panel in the app (sem refazer)
  setTimeout(() => {
    try { overlayEl.classList.remove('show'); } catch (e) {}
    try {
      const prev = document.getElementById('successPanel'); if (prev) prev.remove();
      const panel = document.createElement('div');
      panel.id = 'successPanel';
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
      // ensure refazer flag stays false after conclusão
      isRefazer = false;
    } catch (e) { console.error(e); }
  }, 1100);
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const payload = {
    name: formData.get('name')?.trim(),
    phone: formData.get('phone')?.trim(),
  };

  if (!payload.name || !payload.phone) {
    loginMessage.textContent = 'Informe seu nome e número de celular.';
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = 'Entrando...';
  loginMessage.textContent = '';

  try {
    const response = await fetch(`${API_BASE}/api/session/driver`, {
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
    await loadSession();
  } catch (err) {
    console.error(err);
    loginMessage.textContent = err.message || 'Falha ao fazer login.';
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
}

let currentStepIndex = 0;
const stepData = new Map();
let currentFlow = null;
let isRefazer = false;

function isMobileDevice() {
  return true; // Em Capacitor, sempre é mobile
}

function isSecure() {
  return true; // Em Capacitor, sempre é contexto seguro
}

// Função para capturar foto usando plugin nativo Camera
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
  preview.alt = 'Prévia';
  preview.style = 'max-width:100%;border:1px solid var(--line);border-radius:10px;display:none;';
  container.appendChild(preview);

  const controls = document.createElement('div');
  controls.style = 'display:flex;gap:10px;flex-wrap:wrap;';
  container.appendChild(controls);

  const btnSnap = document.createElement('button');
  btnSnap.className = 'btn btn--primary';
  btnSnap.textContent = '📷 Abrir câmera';
  
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
    try {
      showLoading('Abrindo câmera...');
      const dataUrl = await takePictureNative();
      hideLoading();
      
      preview.src = dataUrl;
      preview.style.display = 'block';
      btnRetake.disabled = false;
      stepData.set(stepId, { ...(stepData.get(stepId) || {}), photoData: dataUrl });
      hint.textContent = '✓ Foto capturada com sucesso!';
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
    hint.textContent = '✓ Foto capturada com sucesso!';
    hint.style.color = 'var(--success)';
  }

  return container;
}

function buildNumberInputUI(stepId, label) {
  const c = document.createElement('div');
  c.innerHTML = `
    <label class="small" style="display:block;margin-bottom:6px;">${label}</label>
    <input type="tel" inputmode="numeric" pattern="[0-9]*" placeholder="Ex: 123456" class="driver-input" id="odometerInput" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;" />
  `;
  const input = c.querySelector('#odometerInput');
  const saved = stepData.get(stepId);
  if (saved?.odometerValue) input.value = saved.odometerValue;
  
  input.addEventListener('input', () => {
    stepData.set(stepId, { odometerValue: input.value });
  });
  return c;
}

function renderFlow(flow) {
  const steps = Array.isArray(flow?.steps) ? flow.steps : [];
  if (!steps.length) {
    stepsContainer.innerHTML = '<p class="small">Nenhuma atividade pendente no momento.</p>';
    return;
  }
  stepsContainer.innerHTML = '';

  const step = steps[currentStepIndex];
  const wrapper = document.createElement('div');
  wrapper.className = 'step-item';

  const head = document.createElement('div');
  head.className = 'step-head';
  head.innerHTML = `<h3>${escapeHTML(step.label)}</h3><span class="pill ${step.required ? 'pill-required' : ''}">${escapeHTML(step.type)}</span>`;
  wrapper.appendChild(head);

  const body = document.createElement('div');
  body.className = 'step-body';

  const stepType = String(step.type || '').toLowerCase();
  if (step.id === 'odometer-photo' || stepType === 'photo' || stepType === 'foto') {
    body.appendChild(buildNativePhotoUI(step.id));
  }
  if (step.id === 'odometer-value' || step.type === 'number') {
    body.appendChild(buildNumberInputUI(step.id, 'Informe a quilometragem do odômetro'));
  }

  const actions = document.createElement('div');
  actions.style = 'display:flex;gap:12px;margin-top:12px;justify-content:flex-end';
  
  const btnPrev = document.createElement('button');
  btnPrev.className = 'btn';
  btnPrev.textContent = 'Voltar';
  btnPrev.disabled = currentStepIndex === 0;
  btnPrev.onclick = () => { 
    if (currentStepIndex > 0) { 
      currentStepIndex -= 1; 
      renderFlow(flow); 
    } 
  };

  const btnNext = document.createElement('button');
  btnNext.className = 'btn btn--primary';
  btnNext.textContent = currentStepIndex === steps.length - 1 ? 'Concluir' : 'Avançar';
  btnNext.onclick = async () => {
    const s = steps[currentStepIndex];
    if (s.id === 'odometer-photo' && !stepData.get('odometer-photo')?.photoData) {
      alert('Tire a foto do odômetro para avançar.');
      return;
    }
    if (s.id === 'odometer-value') {
      const v = stepData.get('odometer-value')?.odometerValue;
      const num = Number(String(v).replace(/\D+/g, ''));
      if (!Number.isFinite(num) || num <= 0) { 
        alert('Informe a quilometragem válida.'); 
        return; 
      }
    }

    try {
      showLoading(currentStepIndex === steps.length - 1 ? 'Concluindo...' : 'Enviando...');
      const payload = stepData.get(s.id) || {};
      if (Object.keys(payload).length) {
        await uploadEvidence({ step: s.id, ...payload });
      }
    } catch (e) {
      console.error(e);
      alert('Falha ao enviar evidência. Tente novamente.');
      hideLoading();
      return;
    }

    if (currentStepIndex < steps.length - 1) {
      currentStepIndex += 1;
      hideLoading();
      renderFlow(flow);
    } else {
      showSuccess('Fluxo concluído com sucesso! Obrigado.');
    }
  };
  
  actions.appendChild(btnPrev);
  actions.appendChild(btnNext);

  wrapper.appendChild(body);
  wrapper.appendChild(actions);
  stepsContainer.appendChild(wrapper);
}

async function uploadEvidence({ step, photoData, odometerValue }) {
  const res = await authedFetch('/api/session/evidence', {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, photoData, odometerValue, refazer: Boolean(isRefazer) })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json();
}

async function loadSession() {
  const token = await getToken();
  if (!token) {
    showLogin();
    return;
  }

  try {
    const [profileRes, flowRes] = await Promise.all([
      authedFetch('/api/session/me'),
      authedFetch('/api/session/flow'),
    ]);

    const profile = await profileRes.json();
    const flow = await flowRes.json();

    welcomeEl.textContent = profile?.driver?.name
      ? `Olá, ${profile.driver.name}!`
      : 'Olá, motorista!';

    campaignInfoEl.textContent = profile?.campaign?.name
      ? `Campanha: ${profile.campaign.name}`
      : '';

    currentFlow = flow;
    isRefazer = false;
    renderFlow(flow);
    showApp();
  } catch (err) {
    console.error(err);
    await setToken(null);
    showLogin(err.message || 'Sessão expirada. Faça login novamente.');
  }
}

async function handleLogout() {
  await setToken(null);
  showLogin('Você saiu da sessão.');
}

document.addEventListener('DOMContentLoaded', async () => {
  // Esconder splash screen depois que o app estiver pronto
  try {
    await SplashScreen.hide();
  } catch (e) {
    console.log('SplashScreen não disponível (modo web)');
  }

  loginForm?.addEventListener('submit', handleLogin);
  logoutButton?.addEventListener('click', handleLogout);
  await loadSession();
});
