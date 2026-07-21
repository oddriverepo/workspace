const isElectron = window.electronAPI && window.electronAPI.isElectron;

if (!isElectron) {
  if (window.notify?.warning) {
    notify.warning('Ambiente inválido', 'Este aplicativo precisa ser executado em modo desktop.');
  } else if (window.modal?.alert) {
    window.modal.alert('Ambiente inválido', 'Este aplicativo precisa ser executado em modo desktop.');
  } else {
    console.warn('Este aplicativo precisa ser executado em modo desktop.');
  }
}

let proposals = [];

const proposalsContainer = document.getElementById('proposals-container');
const btnNewProposal = document.getElementById('btn-new-proposal');
const btnGoogleConnect = document.getElementById('btn-google-connect');
const btnBackup = document.getElementById('btn-backup-proposals');
const btnSettings = document.getElementById('btn-settings');
const btnRepAdmin = document.getElementById('btn-rep-admin');
const btnRepPortal = document.getElementById('btn-rep-portal');

const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1000;
const GOOGLE_CONNECT_BUTTON_LABEL_CONNECTED = 'Google Slides conectado';
const GOOGLE_CONNECT_BUTTON_LABEL_DISCONNECTED = 'Conectar Google Slides';

async function init() {
  await loadProposals();
  renderWorkspace();
  await refreshGoogleConnectStatus();
  btnNewProposal.addEventListener('click', handleNewProposalClick);
  btnGoogleConnect?.addEventListener('click', connectGoogleFromWorkspace);
  btnSettings.addEventListener('click', openSettings);
  if (btnBackup) {
    btnBackup.addEventListener('click', exportProposals);
  }
  btnRepAdmin?.addEventListener('click', () => window.open('/representantes/admin.html', '_blank'));
  btnRepPortal?.addEventListener('click', () => window.open('/representantes/portal.html', '_blank'));
}

function isGoogleConnected(tokenInfo) {
  return Boolean(tokenInfo?.connected);
}

function shouldRefreshGoogleToken(tokenInfo) {
  if (!tokenInfo?.expiresAt) return false;
  const expiresAt = new Date(tokenInfo.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt - Date.now() <= TOKEN_REFRESH_THRESHOLD_MS;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getGoogleTokenInfoSafe() {
  if (!window.electronAPI?.slides?.getTokenInfo) {
    return null;
  }

  try {
    return await window.electronAPI.slides.getTokenInfo();
  } catch (error) {
    console.error('[Workspace] Erro ao verificar token do Google:', error);
    return null;
  }
}

function updateGoogleConnectButton(tokenInfo) {
  if (!btnGoogleConnect) return;

  const connected = isGoogleConnected(tokenInfo);
  btnGoogleConnect.disabled = connected;
  btnGoogleConnect.textContent = connected
    ? GOOGLE_CONNECT_BUTTON_LABEL_CONNECTED
    : GOOGLE_CONNECT_BUTTON_LABEL_DISCONNECTED;
  btnGoogleConnect.title = connected
    ? 'Conexão com Google Slides ativa.'
    : 'Conecte sua conta Google Slides para gerar apresentações.';
}

async function refreshGoogleConnectStatus() {
  const tokenInfo = await getGoogleTokenInfoSafe();
  updateGoogleConnectButton(tokenInfo);
  return tokenInfo;
}

async function waitForGoogleConnection(timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await delay(2000);
    const tokenInfo = await refreshGoogleConnectStatus();
    if (isGoogleConnected(tokenInfo)) {
      return true;
    }
  }
  return false;
}

async function connectGoogleFromWorkspace() {
  if (!window.electronAPI?.slides?.startOAuth) {
    notify.error('Integração indisponível', 'Não foi possível iniciar a conexão com Google Slides.');
    return;
  }

  if (btnGoogleConnect?.disabled) return;

  try {
    if (btnGoogleConnect) {
      btnGoogleConnect.disabled = true;
      btnGoogleConnect.textContent = 'Conectando...';
    }

    const result = await window.electronAPI.slides.startOAuth();
    if (!result?.authUrl) {
      throw new Error(result?.error || 'Não foi possível iniciar o fluxo de autorização.');
    }

    window.open(result.authUrl, '_blank', 'noopener');
    notify.info('Conexão Google', 'Autorize no navegador e volte para continuar.');

    const connected = await waitForGoogleConnection();
    if (connected) {
      notify.success('Google conectado', 'Integração pronta para gerar novos orçamentos.');
    } else {
      notify.warning('Conexão pendente', 'Finalize a autorização no navegador para continuar.');
    }
  } catch (error) {
    console.error('[Workspace] Erro ao conectar Google Slides:', error);
    notify.error('Erro', `Não foi possível conectar ao Google Slides: ${error.message}`);
  } finally {
    await refreshGoogleConnectStatus();
  }
}

async function handleNewProposalClick() {
  if (!window.electronAPI?.slides) {
    notify.error('Integração indisponível', 'Não foi possível validar a conexão com Google Slides.');
    return;
  }

  const originalText = btnNewProposal.textContent;
  btnNewProposal.disabled = true;

  try {
    btnNewProposal.textContent = 'Validando Google...';
    let tokenInfo = await refreshGoogleConnectStatus();

    if (!isGoogleConnected(tokenInfo)) {
      notify.warning('Conexão necessária', 'Para gerar uma nova apresentação, você precisa conectar.');
      return;
    }

    if (shouldRefreshGoogleToken(tokenInfo)) {
      btnNewProposal.textContent = 'Renovando token...';
      const refreshResult = await window.electronAPI.slides.refreshToken();

      if (!refreshResult?.success) {
        const refreshMessage = refreshResult?.error || 'Não foi possível renovar o token automaticamente.';
        notify.warning('Renovação necessária', `${refreshMessage} Conecte novamente no Google Slides.`);
        await refreshGoogleConnectStatus();
        return;
      }

      notify.success('Token renovado', 'Conexão atualizada para iniciar um novo orçamento.');
      tokenInfo = await refreshGoogleConnectStatus();

      if (!isGoogleConnected(tokenInfo)) {
        notify.warning('Conexão necessária', 'Para gerar uma nova apresentação, você precisa conectar.');
        return;
      }
    }

    openWizard();
  } catch (error) {
    console.error('[Workspace] Erro ao validar conexão Google:', error);
    notify.error('Erro', 'Não foi possível validar a conexão com Google Slides.');
  } finally {
    btnNewProposal.disabled = false;
    btnNewProposal.textContent = originalText;
  }
}

async function loadProposals() {
  try {
    proposals = await window.electronAPI.proposals.list();
  } catch (error) {
    console.error('[Workspace] Erro ao carregar propostas:', error);
    proposals = [];
  }
}

function renderWorkspace() {
  if (!proposals.length) {
    proposalsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <h2>Nenhuma proposta ainda</h2>
        <p>Use o botão acima para iniciar um novo orçamento.</p>
      </div>
    `;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'proposals-grid';

  proposals.forEach((proposal) => grid.appendChild(createProposalCard(proposal)));

  proposalsContainer.innerHTML = '';
  proposalsContainer.appendChild(grid);
}

function createProposalCard(proposal) {
  const card = document.createElement('div');
  card.className = 'proposal-card';

  const isCompleted = proposal.status === 'completed' || proposal.status === 'generated';
  const statusBadge = isCompleted ? '✔️' : '🕒';
  const statusText = isCompleted ? 'Gerado' : 'Rascunho';
  const date = proposal.createdAt ? new Date(proposal.createdAt).toLocaleDateString('pt-BR') : '--';

  card.innerHTML = `
    <div class="proposal-thumbnail">🖼️</div>
    <div class="proposal-title">${statusBadge} ${proposal.cliente?.nomeAnunciante || 'Sem nome'}</div>
    <div class="proposal-meta">Criado em ${date} • ${statusText}</div>
    <div class="proposal-actions">
      <button class="btn btn-small btn-secondary" onclick="viewProposal('${proposal.id}')">👁️ Ver</button>
      ${isCompleted ? `
        <button class="btn btn-small btn-primary" onclick="downloadProposal('${proposal.id}')">⬇️ Baixar</button>
      ` : `
        <button class="btn btn-small btn-primary" onclick="editProposal('${proposal.id}')">✏️ Editar</button>
      `}
      <button class="btn btn-small btn-secondary" onclick="deleteProposal('${proposal.id}')">🗑️ Remover</button>
    </div>
  `;

  return card;
}

function openWizard() {
  localStorage.removeItem('wizard_draft');
  window.location.href = 'proposals/new/Step1Dados.html';
}

function openSettings() {
  window.location.href = 'settings/index.html';
}

async function viewProposal(id) {
  window.location.href = `proposals/view-proposal.html?id=${id}`;
}

function editProposal(id) {
  localStorage.setItem('editing_proposal_id', id);
  window.location.href = 'proposals/new/Step1Dados.html';
}

async function downloadProposal(id) {
  notify.info('Em desenvolvimento', 'Exportar direto do aplicativo ainda será implementado.');
}

function sanitizeProposalData(data) {
  if (!data) return {};
  let clone;
  if (typeof structuredClone === 'function') {
    clone = structuredClone(data);
  } else {
    clone = JSON.parse(JSON.stringify(data));
  }

  if (clone.uploads) {
    Object.keys(clone.uploads).forEach((slotId) => {
      const entry = clone.uploads[slotId];
      if (!entry) return;
      delete entry.data;
      delete entry.dataUrl;
      delete entry.previewUrl;
    });
  }

  return clone;
}

function encodeBase64(text) {
  try {
    return window.btoa(unescape(encodeURIComponent(text)));
  } catch (error) {
    if (window.Buffer) {
      return Buffer.from(text, 'utf-8').toString('base64');
    }
    throw error;
  }
}

async function exportProposals() {
  try {
    await loadProposals();

    const payload = {
      exportedAt: new Date().toISOString(),
      total: proposals.length,
      proposals: proposals.map((proposal) => sanitizeProposalData(proposal))
    };

    const jsonString = JSON.stringify(payload, null, 2);
    const data = encodeBase64(jsonString);
    const fileName = `propostas-od-drive-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)}.json`;

    await window.electronAPI.files.save({
      data,
      fileName
    });

    if (window.notify?.success) {
      notify.success('Backup salvo', 'Arquivo exportado para o seu computador.');
    }
  } catch (error) {
    console.error('[Workspace] Erro ao exportar backup:', error);
    if (window.notify?.error) {
      notify.error('Erro', 'Não foi possível salvar o backup local.');
    }
  }
}

async function deleteProposal(id) {
  const confirmed = await modal.confirm(
    'Excluir proposta',
    'Tem certeza que deseja excluir esta proposta?'
  );

  if (!confirmed) return;

  try {
    await window.electronAPI.proposals.delete(id);
    await loadProposals();
    renderWorkspace();
    notify.success('Proposta removida', 'A proposta foi excluída com sucesso.');
  } catch (error) {
    console.error('[Workspace] Erro ao excluir proposta:', error);
    notify.error('Erro', 'Não foi possível excluir a proposta.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.viewProposal = viewProposal;
window.editProposal = editProposal;
window.downloadProposal = downloadProposal;
window.deleteProposal = deleteProposal;
