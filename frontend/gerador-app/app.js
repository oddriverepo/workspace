const PRODUCT_CATALOG = [
  { id: 'od-in', name: 'OD IN', desc: 'Mídia interna instalada no interior do veículo.', badge: 'IN' },
  { id: 'od-vt', name: 'OD VT', desc: 'Aplicação externa no vidro traseiro.', badge: 'VT' },
  { id: 'od-drop', name: 'OD DROP', desc: 'Quatro portas e vidro traseiro.', badge: 'DR' },
  { id: 'od-pack', name: 'OD PACK', desc: 'Portas, vidro traseiro e kits combinados.', badge: 'PK' },
  { id: 'od-full', name: 'OD FULL', desc: 'Cobertura completa: portas, vidro traseiro e capô.', badge: 'FL' }
];

const INTERNAL_PRODUCT_ID = 'od-in';
const EXTERNAL_PRODUCT_IDS = ['od-vt', 'od-drop', 'od-pack', 'od-full'];
const MAX_BUDGET_OPTIONS = 4;
const WIZARD_STEPS = ['Dados', 'Produtos', 'Planilha', 'Uploads', 'Revisão'];
const STORAGE_KEYS = {
  token: 'adminToken',
  user: 'adminUser',
  draft: 'gerador_app_draft_v1'
};
const GOOGLE_FIELDS = [
  'templatePresentationId',
  'templateOdInId',
  'templateOdVtId',
  'templateOdDropId',
  'templateOdFullId',
  'templateOdPackId',
  'presentationsFolderId',
  'assetsFolderId'
];
const PLACEHOLDERS = {
  logo: '../gerador/assets/upload-placeholders/logo-placeholder.png',
  'mock-lateral': '../gerador/assets/upload-placeholders/mock-lateral-placeholder.png',
  'mock-mapa': '../gerador/assets/upload-placeholders/mock-frontal-placeholder.png',
  'mock-traseiro': '../gerador/assets/upload-placeholders/mock-traseiro-placeholder.png',
  odim: '../gerador/assets/upload-placeholders/od-in-placeholder.png',
  planilha: '../gerador/assets/upload-placeholders/planilha-placeholder.png'
};
const CREATIVE_UPLOAD_SLOTS = [
  { id: 'logo', label: 'Logo do anunciante', help: 'PNG ou JPG. O app otimiza a imagem antes de enviar.' },
  { id: 'mock-lateral', label: 'Mock lateral', help: 'Imagem do mockup lateral do carro.' },
  { id: 'mock-mapa', label: 'Mock frontal', help: 'Imagem frontal do veículo para a apresentação.' },
  { id: 'odim', label: 'OD IN', help: 'Criativo interno que será exibido no template.' },
  { id: 'mock-traseiro', label: 'Mock traseiro', help: 'Mock traseiro do veículo com a mídia aplicada.' }
];

const app = document.getElementById('app');
const draftUploadStore = createUploadStore('geradorAppDraftUploads', 'uploads');

const state = {
  booting: true,
  session: {
    token: readStorage(STORAGE_KEYS.token),
    user: readJsonStorage(STORAGE_KEYS.user)
  },
  route: parseRoute(),
  proposals: [],
  proposalsLoading: false,
  proposalsLoaded: false,
  activeProposal: null,
  activeProposalLoading: false,
  draft: null,
  wizardStep: 0,
  currentOptionIndex: 0,
  tokenInfo: null,
  tokenInfoLoading: false,
  googleConfig: null,
  googleConfigLoading: false,
  installPromptEvent: null,
  isInstalled: window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true,
  generation: {
    busy: false,
    pdfBusy: false,
    progress: 0,
    message: '',
    error: ''
  }
};

boot().catch((error) => {
  console.error('[Gerador App] Falha ao iniciar:', error);
  toast('error', 'Falha ao iniciar', error.message || 'Não foi possível carregar o app.');
});

function isGoogleConnected() {
  return Boolean(state.tokenInfo?.connected);
}

async function boot() {
  await restoreDraftFromStorage();
  attachGlobalListeners();
  attachSlidesProgressListener();
  await restoreSessionIfAvailable();
  state.booting = false;
  render();
  if (state.session.token) {
    void ensureTokenInfo(false);
  }
}

function attachGlobalListeners() {
  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('online', () => {
    toast('success', 'Conexão retomada', 'Você voltou a ficar online.');
    render();
  });
  window.addEventListener('offline', () => {
    toast('warning', 'Modo offline', 'O app continua disponível, mas a API exige conexão.');
    render();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    state.isInstalled = true;
    state.installPromptEvent = null;
    toast('success', 'App instalado', 'O Gerador App agora pode ser aberto como aplicativo.');
    render();
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js?v=7', { updateViaCache: 'none' })
      .then((registration) => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[Gerador App] Falha ao registrar service worker:', error);
      });
  }
}

function attachSlidesProgressListener() {
  if (!window.electronAPI?.slides?.onProgress) return;
  window.electronAPI.slides.onProgress((payload) => {
    state.generation.progress = Number(payload?.progress) || 0;
    state.generation.message = payload?.message || '';
    updateGenerationStatusDom();
  });
}

async function restoreSessionIfAvailable() {
  if (!state.session.token) {
    state.route = { name: 'login' };
    return;
  }
  try {
    const response = await apiRequest('/admin/me');
    state.session.user = response.user;
    persistSession();
    if (state.route.name === 'login') {
      state.route = { name: 'home' };
      updateHash('home', true);
    }
  } catch (error) {
    clearSession();
    state.route = { name: 'login' };
  }
}

function handleHashChange() {
  state.route = parseRoute();
  if (!state.session.token && state.route.name !== 'login') {
    state.route = { name: 'login' };
    updateHash('login', true);
  }
  if (state.session.token && state.route.name === 'login') {
    state.route = { name: 'home' };
    updateHash('home', true);
  }
  render();
}

function render() {
  if (state.booting) {
    app.innerHTML = renderSplash();
    return;
  }

  if (!state.session.token || state.route.name === 'login') {
    app.innerHTML = renderLoginScreen();
    bindLoginScreen();
    ensureToastStack();
    return;
  }

  const title = resolveTopbarTitle();
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-brand">
          <div class="topbar-logo">
            <img src="../assets/images/logo-oddrive.png" alt="OD Drive">
          </div>
          <div class="topbar-title">
            <strong>${escapeHtml(title.title)}</strong>
            ${title.subtitle ? `<span>${escapeHtml(title.subtitle)}</span>` : ''}
          </div>
        </div>
        <div class="topbar-actions">
          <button class="topbar-status-button ${isGoogleConnected() ? 'online' : 'offline'}" id="googleStatusBtn" type="button" aria-label="${isGoogleConnected() ? 'Google conectado. Abrir integrações.' : 'Google pendente. Abrir integrações.'}" title="${isGoogleConnected() ? 'Google conectado' : 'Google pendente'}">
            <span class="topbar-status" aria-hidden="true"></span>
          </button>
          ${state.installPromptEvent && !state.isInstalled ? '<button class="topbar-install" id="installAppBtn" type="button">Instalar app</button>' : ''}
        </div>
      </header>
      <main class="screen">
        ${renderOfflineBanner()}
        ${renderCurrentView()}
      </main>
      ${renderBottomNav()}
    </div>
    <div class="toast-stack" id="toastStack"></div>
  `;

  bindShellActions();
  bindCurrentView();
}

function renderSplash() {
  return renderBootScreen();
  return `
    <div class="login-shell login-shell-splash">
      <section class="login-card login-card-splash">
        <div class="brand-mark brand-mark-large">
            <img src="../assets/images/logo-oddrive.png" alt="OD Drive">
          </div>
          <div class="stack">
            <p class="eyebrow">OD Drive</p>
            <h1 class="display-title">Abrindo o Gerador App</h1>
            <p class="display-subtitle">Preparando rascunho local e integrações do app.</p>
          </div>
        </div>
        <div class="progress-track">
          <div class="progress-bar" style="width: 45%;"></div>
        </div>
      </section>
    </div>
  `;
}

function renderBootScreen() {
  return `
    <div class="login-shell login-shell-splash">
      <section class="login-card login-card-splash">
        <div class="brand-mark brand-mark-large">
          <img src="../assets/images/logo-oddrive.png" alt="OD Drive">
        </div>
        <div class="progress-track">
          <div class="progress-bar" style="width: 45%;"></div>
        </div>
      </section>
    </div>
  `;
}

function renderLoginScreen() {
  return `
    <div class="login-shell">
      <section class="login-card login-card-minimal">
        <div class="brand-mark brand-mark-large">
          <img src="../assets/images/logo-oddrive.png" alt="OD Drive">
        </div>
        <form class="login-form login-form-minimal" id="loginForm">
          <input class="input" id="loginUsername" name="username" type="text" autocomplete="username" placeholder="Usuário" aria-label="Usuário" required>
          <input class="input" id="loginPassword" name="password" type="password" autocomplete="current-password" placeholder="Senha" aria-label="Senha" required>
          <button class="btn btn-primary btn-block" id="loginSubmitBtn" type="submit">Entrar</button>
        </form>
      </section>
      <div class="toast-stack" id="toastStack"></div>
    </div>
  `;
}

function renderCurrentView() {
  switch (state.route.name) {
    case 'proposal':
      return renderProposalDetail();
    case 'proposals':
      return renderProposalsView();
    case 'settings':
      return renderSettingsView();
    case 'wizard':
      return renderWizardView();
    case 'home':
    default:
      return renderHomeDashboardView();
  }
}

function renderHomeView() {
  return renderHomeCompactView();
  const meaningfulDraft = hasMeaningfulDraft(state.draft);
  const proposalCards = state.proposalsLoading
    ? new Array(3).fill(0).map(() => renderProposalSkeleton()).join('')
    : state.proposals.length
      ? state.proposals.map(renderProposalCard).join('')
      : `
        <div class="card empty-state">
          <h3>Nenhuma proposta salva ainda</h3>
          <p>Você pode começar uma nova proposta agora e gerar a apresentação quando tudo estiver pronto.</p>
        </div>
      `;

  return `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow" style="color: rgba(255,255,255,0.72);">Mobile-first</p>
        <h1 style="margin:12px 0 10px; font-family:'Sora','Manrope',sans-serif; font-size:clamp(1.5rem, 6vw, 2.3rem); line-height:1.08; letter-spacing:-0.05em;">Gerencie orçamentos e gere apresentações sem abrir o workspace.</h1>
        <p style="margin:0; color: rgba(255,255,255,0.78); line-height:1.55;">Fluxo adaptado para celular, usando o mesmo backend e o mesmo Google Slides do gerador principal.</p>
        <div class="button-row" style="margin-top:16px;">
          ${state.installPromptEvent && !state.isInstalled ? '<button class="btn btn-secondary btn-sm" type="button" id="installAppBtn">Instalar app</button>' : ''}
          ${state.isInstalled ? '<span class="pill" style="background: rgba(255,255,255,0.18); color: #fff;">Instalado</span>' : ''}
        </div>
      </div>

      <div class="stats-grid">
        ${renderStatCard('Propostas', String(state.proposals.length), 'Sincronizadas com o backend')}
        ${renderStatCard('Concluídas', String(state.proposals.filter((item) => item.status === 'completed').length), 'Com PDF já exportado')}
        ${renderStatCard('Rascunhos', String(state.proposals.filter((item) => item.status === 'draft').length), 'Salvos no backend')}
        ${renderStatCard('Google', isGoogleConnected() ? 'Conectado' : 'Pendente', isGoogleConnected() ? 'Pronto para gerar' : 'Conecte para gerar')}
      </div>

      ${meaningfulDraft ? renderLocalDraftCard() : ''}

      <div class="section-heading">
        <div>
          <h2>Suas propostas</h2>
          <p>Toque em uma proposta para abrir, editar ou baixar o PDF.</p>
        </div>
        <button class="btn btn-primary btn-sm" type="button" id="startProposalBtn">Nova</button>
      </div>

      <div class="proposal-list">
        ${proposalCards}
      </div>
    </section>
  `;
}

function renderHomeCompactView() {
  const meaningfulDraft = hasMeaningfulDraft(state.draft);
  const proposalCards = state.proposalsLoading
    ? new Array(3).fill(0).map(() => renderProposalSkeleton()).join('')
    : state.proposals.length
      ? state.proposals.map(renderProposalCard).join('')
      : `
        <div class="card empty-state">
          <h3>Nenhuma proposta</h3>
        </div>
      `;

  return `
    <section class="stack">
      <div class="stats-grid">
        ${renderStatCard('Propostas', String(state.proposals.length))}
        ${renderStatCard('Concluídas', String(state.proposals.filter((item) => item.status === 'completed').length))}
        ${renderStatCard('Rascunhos', String(state.proposals.filter((item) => item.status === 'draft').length))}
        ${renderStatCard('Google', isGoogleConnected() ? 'Conectado' : 'Pendente')}
      </div>

      ${meaningfulDraft ? renderLocalDraftCardCompact() : ''}

      <div class="section-heading section-heading-tight">
        <div>
          <h2>Propostas</h2>
        </div>
        <button class="btn btn-primary btn-sm" type="button" id="startProposalBtn">Nova</button>
      </div>

      <div class="proposal-list">
        ${proposalCards}
      </div>
    </section>
  `;
}

function renderHomeDashboardView() {
  const meaningfulDraft = hasMeaningfulDraft(state.draft);

  return `
    <section class="stack">
      <div class="stats-grid stats-grid-home">
        ${renderStatCard('Propostas', String(state.proposals.length))}
        ${renderStatCard('Concluídas', String(state.proposals.filter((item) => item.status === 'completed').length))}
        ${renderStatCard('Rascunhos', String(state.proposals.filter((item) => item.status === 'draft').length))}
      </div>

      ${meaningfulDraft ? renderLocalDraftCardCompact() : ''}
    </section>
  `;
}

function renderProposalsView() {
  const proposalCards = state.proposalsLoading
    ? new Array(3).fill(0).map(() => renderProposalSkeleton()).join('')
    : state.proposals.length
      ? state.proposals.map(renderProposalCard).join('')
      : `
        <div class="card empty-state">
          <h3>Nenhuma proposta</h3>
        </div>
      `;

  return `
    <section class="stack">
      <div class="section-heading section-heading-tight">
        <div>
          <h2>Propostas</h2>
        </div>
        <button class="btn btn-primary btn-sm" type="button" id="startProposalBtn">Nova</button>
      </div>

      <div class="proposal-list">
        ${proposalCards}
      </div>
    </section>
  `;
}

function renderProposalDetail() {
  if (state.activeProposalLoading || (state.activeProposal && state.activeProposal.id !== state.route.id)) {
    return renderDetailLoading();
  }

  const proposal = state.activeProposal;
  if (!proposal || proposal.id !== state.route.id) {
    void loadProposalDetail(state.route.id);
    return renderDetailLoading();
  }

  const products = collectProducts(proposal);
  const uploadEntries = Object.entries(proposal.uploads || {});
  const created = proposal.createdAt ? formatDateTime(proposal.createdAt) : '---';
  const updated = proposal.updatedAt ? formatDateTime(proposal.updatedAt) : '---';

  return `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow" style="color: rgba(255,255,255,0.72);">Proposta</p>
        <h1 style="margin:12px 0 10px; font-family:'Sora','Manrope',sans-serif; font-size:clamp(1.45rem, 6vw, 2rem); line-height:1.1; letter-spacing:-0.05em;">
          ${escapeHtml(proposal.cliente?.nomeAnunciante || 'Sem anunciante')}
        </h1>
        <p style="margin:0; color: rgba(255,255,255,0.78);">
          ${escapeHtml(proposal.cliente?.nomeEmpresa || 'Empresa não informada')}
        </p>
      </div>

      <div class="button-row">
        <button class="btn btn-primary btn-sm" type="button" id="editProposalBtn">Editar</button>
        <button class="btn btn-secondary btn-sm" type="button" id="openSlidesBtn" ${proposal.googlePresentationUrl ? '' : 'disabled'}>Abrir Slides</button>
        <button class="btn btn-secondary btn-sm" type="button" id="downloadProposalPdfBtn" ${proposal.googlePresentationId ? '' : 'disabled'}>Baixar PDF</button>
        <button class="btn btn-danger btn-sm" type="button" id="deleteProposalBtn">Excluir</button>
      </div>

      <div class="detail-grid">
        <article class="detail-card">
          <h3>Dados do cliente</h3>
          <div class="detail-list">
            ${renderDetailRow('Anunciante', proposal.cliente?.nomeAnunciante || '---')}
            ${renderDetailRow('Empresa', proposal.cliente?.nomeEmpresa || '---')}
            ${renderDetailRow('Praças', proposal.cliente?.pracas || '---')}
          </div>
        </article>

        <article class="detail-card">
          <h3>Dados comerciais</h3>
          <div class="detail-list">
            ${renderDetailRow('Pagamento', proposal.comercial?.pagamento || '---')}
            ${renderDetailRow('Início', proposal.comercial?.dataInicio ? formatDate(proposal.comercial.dataInicio) : '---')}
            ${renderDetailRow('Período', proposal.comercial?.tempoCampanha || `${proposal.comercial?.tempoCampanhaDias || 0} dias`)}
            ${renderDetailRow('Carros', String(proposal.comercial?.numeroCarros || proposal.comercial?.quantidadeCarros || 0))}
            ${renderDetailRow('Validade', proposal.comercial?.validadeDias ? `${proposal.comercial.validadeDias} dias` : '---')}
          </div>
        </article>
      </div>

      <article class="detail-card">
        <div class="section-heading">
          <div>
            <h3>Produtos e status</h3>
            <p>Resumo do que já foi selecionado para esta proposta.</p>
          </div>
          <span class="status-pill ${resolveStatusTone(proposal.status)}">${escapeHtml(resolveStatusLabel(proposal.status))}</span>
        </div>
        <div class="chip-row" style="margin-top:14px;">
          ${products.length ? products.map((product) => `<span class="chip">${escapeHtml(resolveProductLabel(product))}</span>`).join('') : '<span class="muted">Nenhum produto selecionado.</span>'}
        </div>
        <div class="meta-row" style="margin-top:16px;">
          <span>Criado em ${escapeHtml(created)}</span>
          <span>Atualizado em ${escapeHtml(updated)}</span>
        </div>
      </article>

      <article class="detail-card">
        <div class="section-heading">
          <div>
            <h3>Uploads</h3>
            <p>Pré-visualização das imagens enviadas e dos arquivos gerados.</p>
          </div>
        </div>
        ${
          uploadEntries.length
            ? `
              <div class="upload-thumbs-grid" style="margin-top:14px;">
                ${uploadEntries.map(([slotId, upload]) => renderUploadThumbCard(slotId, upload, proposal.uploadDriveUrls?.[slotId])).join('')}
              </div>
            `
            : '<p class="muted" style="margin:16px 0 0;">Nenhum upload disponível.</p>'
        }
      </article>
    </section>
  `;
}

function renderSettingsView() {
  return renderSettingsCompactView();
  const sessionReady = !!state.session.token;
  const connected = isGoogleConnected();
  const tokenStatus = !sessionReady
    ? 'Sessão administrativa não detectada neste navegador.'
    : state.tokenInfoLoading
    ? 'Consultando status do Google...'
    : connected
      ? 'Conta Google pronta para gerar apresentações.'
      : 'Ainda não existe conexão ativa com o Google Slides.';

  const advancedFields = GOOGLE_FIELDS.map((field) => {
    const label = prettifyFieldLabel(field);
    const value = resolveGoogleConfigFieldValue(field);
    return `
      <div class="input-group">
        <label class="input-label" for="cfg-${field}">${escapeHtml(label)}</label>
        <input class="input" id="cfg-${field}" data-config-field="${field}" value="${escapeHtml(value)}" placeholder="${escapeHtml(label)}" ${sessionReady ? '' : 'disabled'}>
      </div>
    `;
  }).join('');

  return `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow" style="color: rgba(255,255,255,0.72);">Integrações</p>
        <h1 style="margin:12px 0 10px; font-family:'Sora','Manrope',sans-serif; font-size:clamp(1.4rem, 6vw, 2rem); line-height:1.08; letter-spacing:-0.05em;">Google Slides e configuração do gerador</h1>
        <p style="margin:0; color: rgba(255,255,255,0.78);">${escapeHtml(tokenStatus)}</p>
      </div>

      <article class="status-card">
        <div class="section-heading">
          <div>
            <h2>Status do Google</h2>
            <p>O backend continua sendo o mesmo. Aqui você só controla a autorização no celular.</p>
          </div>
          <span class="status-pill ${connected ? 'success' : 'warning'}">${connected ? 'Conectado' : 'Pendente'}</span>
        </div>
        <div class="detail-list" style="margin-top:16px;">
          ${renderDetailRow('Conectado em', state.tokenInfo?.connectedAt ? formatDateTime(state.tokenInfo.connectedAt) : '---')}
          ${renderDetailRow('Expira em', state.tokenInfo?.expiresAt ? formatDateTime(state.tokenInfo.expiresAt) : '---')}
        </div>
        <div class="button-row" style="margin-top:16px;">
          <button class="btn btn-primary btn-sm" type="button" id="connectGoogleBtn" ${sessionReady ? '' : 'disabled'}>${connected ? 'Reconectar' : 'Conectar'}</button>
          <button class="btn btn-secondary btn-sm" type="button" id="refreshGoogleBtn" ${sessionReady && connected ? '' : 'disabled'}>Renovar token</button>
          <button class="btn btn-danger btn-sm" type="button" id="disconnectGoogleBtn" ${sessionReady && connected ? '' : 'disabled'}>Desconectar</button>
        </div>
      </article>

      <article class="card" style="padding:18px;">
        <div class="section-heading">
          <div>
            <h2>IDs avançados</h2>
            <p>Use apenas se precisar revisar templates, pastas ou IDs do Google sem sair do app.</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" id="reloadGoogleConfigBtn" ${sessionReady ? '' : 'disabled'}>Recarregar</button>
        </div>
        <div class="stack" style="margin-top:16px;">
          ${advancedFields}
          <div class="button-row">
            <button class="btn btn-primary btn-sm" type="button" id="saveGoogleConfigBtn" ${sessionReady ? '' : 'disabled'}>Salvar IDs</button>
            <button class="btn btn-secondary btn-sm" type="button" id="resetGoogleConfigBtn" ${sessionReady ? '' : 'disabled'}>Restaurar padrão</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderSettingsCompactView() {
  const sessionReady = !!state.session.token;
  const connected = isGoogleConnected();

  const advancedFields = GOOGLE_FIELDS.map((field) => {
    const label = prettifyFieldLabel(field);
    const value = resolveGoogleConfigFieldValue(field);
    return `
      <div class="input-group">
        <label class="input-label" for="cfg-${field}">${escapeHtml(label)}</label>
        <input class="input" id="cfg-${field}" data-config-field="${field}" value="${escapeHtml(value)}" placeholder="${escapeHtml(label)}" ${sessionReady ? '' : 'disabled'}>
      </div>
    `;
  }).join('');

  return `
    <section class="stack">
      <article class="status-card">
        <div class="section-heading section-heading-tight">
          <div>
            <h2>Google</h2>
          </div>
          <span class="status-pill ${connected ? 'success' : 'warning'}">${connected ? 'Conectado' : 'Pendente'}</span>
        </div>
        <div class="button-row" style="margin-top:16px;">
          <button class="btn btn-primary btn-sm" type="button" id="connectGoogleBtn" ${sessionReady ? '' : 'disabled'}>${connected ? 'Reconectar' : 'Conectar'}</button>
          <button class="btn btn-secondary btn-sm" type="button" id="refreshGoogleBtn" ${sessionReady && connected ? '' : 'disabled'}>Renovar</button>
          <button class="btn btn-danger btn-sm" type="button" id="disconnectGoogleBtn" ${sessionReady && connected ? '' : 'disabled'}>Desconectar</button>
        </div>
      </article>

      <article class="card" style="padding:18px;">
        <div class="section-heading section-heading-tight">
          <div>
            <h2>IDs</h2>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" id="reloadGoogleConfigBtn" ${sessionReady ? '' : 'disabled'}>Recarregar</button>
        </div>
        <div class="stack" style="margin-top:16px;">
          ${advancedFields}
          <div class="button-row">
            <button class="btn btn-primary btn-sm" type="button" id="saveGoogleConfigBtn" ${sessionReady ? '' : 'disabled'}>Salvar</button>
            <button class="btn btn-secondary btn-sm" type="button" id="resetGoogleConfigBtn" ${sessionReady ? '' : 'disabled'}>Restaurar</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderWizardView() {
  ensureDraftShape(state.draft);
  return renderWizardCompactView();
  const draft = state.draft;
  const summaryLabel = draft.id ? 'Editando proposta' : 'Nova proposta';
  const localStamp = readDraftStamp();

  return `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow" style="color: rgba(255,255,255,0.72);">${escapeHtml(summaryLabel)}</p>
        <h1 style="margin:12px 0 10px; font-family:'Sora','Manrope',sans-serif; font-size:clamp(1.4rem, 6vw, 2.1rem); line-height:1.08; letter-spacing:-0.05em;">
          ${escapeHtml(draft.cliente?.nomeAnunciante || 'Preencha a proposta')}
        </h1>
        <p style="margin:0; color: rgba(255,255,255,0.78);">
          ${localStamp ? `Rascunho local salvo às ${formatTime(localStamp)}` : 'Autosave local ativo a cada alteração.'}
        </p>
      </div>

      <div class="wizard-stepper">
        ${WIZARD_STEPS.map((step, index) => {
          const classes = [
            'wizard-step',
            index === state.wizardStep ? 'active' : '',
            index < state.wizardStep ? 'completed' : ''
          ].filter(Boolean).join(' ');
          return `
            <div class="${classes}">
              <strong>${index + 1}</strong>
              <span>${escapeHtml(step)}</span>
            </div>
          `;
        }).join('')}
      </div>

      ${renderWizardStepContent()}
    </section>
  `;
}

function renderWizardCompactView() {
  const progress = WIZARD_STEPS.length > 1
    ? (state.wizardStep / (WIZARD_STEPS.length - 1)) * 100
    : 0;

  return `
    <section class="stack">
      <div class="wizard-stepper-sticky">
        <div class="wizard-stepper-shell">
        <div class="wizard-progress-track" aria-hidden="true">
          <div class="wizard-progress-fill" style="width:${progress}%;"></div>
        </div>
        <div class="wizard-stepper" role="list" aria-label="Etapas do orçamento">
        ${WIZARD_STEPS.map((step, index) => {
          const classes = [
            'wizard-step',
            index === state.wizardStep ? 'active' : '',
            index < state.wizardStep ? 'completed' : ''
          ].filter(Boolean).join(' ');
          const marker = index < state.wizardStep
            ? '✓'
            : String(index + 1).padStart(2, '0');
          return `
            <div class="${classes}" role="listitem" ${index === state.wizardStep ? 'aria-current="step"' : ''}>
              <div class="wizard-step-node">
                <strong>${marker}</strong>
              </div>
              <span class="wizard-step-label">${escapeHtml(step)}</span>
            </div>
          `;
        }).join('')}
        </div>
        </div>
      </div>

      ${renderWizardStepContent()}
    </section>
  `;
}

function renderBottomNav() {
  const navItems = [
    { route: 'home', label: 'Início', icon: '⌂' },
    { route: 'proposals', label: 'Propostas', icon: '≡' },
    { route: 'wizard', label: 'Novo', icon: '+' },
    { route: 'settings', label: 'Google', icon: '◔' }
  ];

  return `
    <nav class="bottom-nav" aria-label="Navegação principal">
      ${navItems.map((item) => `
        <button class="nav-btn ${resolveNavActive(item.route) ? 'active' : ''}" type="button" data-nav-route="${item.route}">
          <span class="icon">${item.icon}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function renderWizardStepContent() {
  switch (state.wizardStep) {
    case 0:
      return renderWizardDataStep();
    case 1:
      return renderWizardProductsStep();
    case 2:
      return renderWizardSheetStep();
    case 3:
      return renderWizardUploadsStep();
    case 4:
    default:
      return renderWizardReviewStep();
  }
}

function renderWizardDataStep() {
  const draft = state.draft;
  const metrics = draft.impacto || {};
  return `
    <article class="form-card" style="padding:18px;">
      <div class="section-heading">
        <div>
          <h2>Dados da proposta</h2>
          <p>Preencha tudo em um fluxo enxuto para celular. O impacto é calculado automaticamente.</p>
        </div>
      </div>

      <div class="stack" style="margin-top:18px;">
        <div class="input-group">
          <label class="input-label" for="draft-nomeAnunciante">Nome do anunciante</label>
          <input class="input" id="draft-nomeAnunciante" data-field="cliente.nomeAnunciante" value="${escapeHtml(draft.cliente?.nomeAnunciante || '')}" placeholder="Ex.: Marca X">
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-nomeEmpresa">Nome da empresa</label>
          <input class="input" id="draft-nomeEmpresa" data-field="cliente.nomeEmpresa" value="${escapeHtml(draft.cliente?.nomeEmpresa || '')}" placeholder="Razão social ou nome fantasia">
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-pracas">Praças</label>
          <textarea class="textarea" id="draft-pracas" data-field="cliente.pracas" placeholder="Ex.: Recife, Jaboatão, Olinda">${escapeHtml(draft.cliente?.pracas || '')}</textarea>
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-pagamento">Condição de pagamento</label>
          <input class="input" id="draft-pagamento" data-field="comercial.pagamento" value="${escapeHtml(draft.comercial?.pagamento || '')}" placeholder="Ex.: 50% na assinatura, 50% no início">
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-numeroCarros">Número de carros</label>
          <input class="input" id="draft-numeroCarros" data-field="comercial.numeroCarros" inputmode="numeric" type="number" min="1" value="${escapeHtml(String(draft.comercial?.numeroCarros || ''))}" placeholder="0">
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-dataInicio">Data de início</label>
          <input class="input" id="draft-dataInicio" data-field="comercial.dataInicio" type="date" value="${escapeHtml(draft.comercial?.dataInicio || '')}">
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-tempoCampanhaDias">Tempo de campanha</label>
          <input class="input" id="draft-tempoCampanhaDias" data-field="comercial.tempoCampanhaDias" inputmode="numeric" type="number" min="1" value="${escapeHtml(String(draft.comercial?.tempoCampanhaDias || ''))}" placeholder="Dias">
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-validadeDias">Validade da proposta</label>
          <input class="input" id="draft-validadeDias" data-field="comercial.validadeDias" inputmode="numeric" type="number" min="1" value="${escapeHtml(String(draft.comercial?.validadeDias || ''))}" placeholder="Dias">
        </div>
        <div class="input-group">
          <label class="input-label" for="draft-qtdOrcamentos">Quantidade de orçamentos</label>
          <select class="select" id="draft-qtdOrcamentos" data-field="comercial.qtdOrcamentos">
            ${new Array(MAX_BUDGET_OPTIONS).fill(0).map((_, index) => {
              const value = index + 1;
              return `<option value="${value}" ${Number(draft.comercial?.qtdOrcamentos || 1) === value ? 'selected' : ''}>${value} opção${value > 1 ? 's' : ''}</option>`;
            }).join('')}
          </select>
        </div>

        <div class="input-group">
          <span class="input-label">Como você vai trabalhar a planilha?</span>
          <div class="segmented" style="--segments: 2;">
            <button type="button" class="${draft.tipoPlanilha === 'imagem' ? 'active' : ''}" data-plan-mode="imagem">Enviar imagem</button>
            <button type="button" class="${draft.tipoPlanilha === 'editar' ? 'active' : ''}" data-plan-mode="editar">Montar no app</button>
          </div>
        </div>
      </div>

      <div class="metric-grid" style="margin-top:18px;">
        ${renderStatCard('Corridas', metrics.corridasFormatado || '0', 'Estimativa do período', 'data-metric-key=\"corridas\"')}
        ${renderStatCard('Passageiros', metrics.passageirosTransportadosFormatado || '0', 'Com base na frota', 'data-metric-key=\"passageiros\"')}
        ${renderStatCard('KM', metrics.kmPercorridosFormatado || '0', 'Percurso potencial', 'data-metric-key=\"km\"')}
        ${renderStatCard('Impactos', metrics.impactosPossiveisFormatado || '0', 'Oportunidades estimadas', 'data-metric-key=\"impactos\"')}
      </div>

      <div class="wizard-actions" style="margin-top:18px;">
        <button class="btn btn-secondary" type="button" id="wizardExitBtn">Sair</button>
        <button class="btn btn-primary" type="button" id="wizardNextBtn">Produtos</button>
      </div>
    </article>
  `;
}

function renderWizardProductsStep() {
  const budgets = state.draft.orcamentos || [];
  const budget = budgets[state.currentOptionIndex] || budgets[0];
  const selectedIds = (budget?.produtosSelecionados || []).map((item) => item?.id || item).filter(Boolean);
  const selectionInfo = selectedIds.length
    ? `${selectedIds.length} produto${selectedIds.length > 1 ? 's' : ''} selecionado${selectedIds.length > 1 ? 's' : ''} nesta opção.`
    : 'Selecione pelo menos um produto para continuar.';

  return `
    <article class="form-card" style="padding:18px;">
      <div class="section-heading">
        <div>
          <h2>Produtos por opção</h2>
          <p>As regras continuam as mesmas: OD IN sozinho, um produto externo sozinho ou OD IN + um externo.</p>
        </div>
      </div>

      ${renderBudgetOptionPills()}

      <div class="product-grid" style="margin-top:18px;">
        ${PRODUCT_CATALOG.map((product) => `
          <button class="product-card ${selectedIds.includes(product.id) ? 'active' : ''}" type="button" data-product-id="${product.id}">
            <div>
              <h3>${escapeHtml(product.name)}</h3>
              <p>${escapeHtml(product.desc)}</p>
            </div>
            <div class="product-mark">${escapeHtml(product.badge)}</div>
          </button>
        `).join('')}
      </div>

      <div class="card" style="padding:16px; margin-top:18px;">
        <strong style="display:block; margin-bottom:6px;">Status da opção ${state.currentOptionIndex + 1}</strong>
        <p class="muted" style="margin:0;">${escapeHtml(selectionInfo)}</p>
      </div>

      <div class="wizard-actions" style="margin-top:18px;">
        <button class="btn btn-secondary" type="button" id="wizardPrevBtn">Voltar</button>
        <button class="btn btn-primary" type="button" id="wizardNextBtn">Planilha</button>
      </div>
    </article>
  `;
}

function renderWizardSheetStep() {
  const draft = state.draft;
  const budgets = draft.orcamentos || [];
  const currentBudget = budgets[state.currentOptionIndex] || budgets[0];
  const builder = ensureSheetBuilder(state.currentOptionIndex);
  const planilhaKey = getPlanilhaSlotId(state.currentOptionIndex);
  const planilhaEntry = draft.uploads?.[planilhaKey] || (state.currentOptionIndex === 0 ? draft.uploads?.planilha : null);

  if (draft.tipoPlanilha === 'imagem') {
    return `
      <article class="form-card" style="padding:18px;">
        <div class="section-heading">
          <div>
            <h2>Planilha como imagem</h2>
            <p>Envie uma imagem por opção de orçamento. O app mantém tudo em cache local para você continuar depois.</p>
          </div>
        </div>
        ${renderBudgetOptionPills()}
        <div class="upload-grid" style="margin-top:18px;">
          ${budgets.map((_, index) => renderUploadCard({
            slotId: getPlanilhaSlotId(index),
            label: `Planilha da opção ${index + 1}`,
            help: 'PNG, JPG ou captura da planilha pronta.',
            upload: draft.uploads?.[getPlanilhaSlotId(index)] || (index === 0 ? draft.uploads?.planilha : null),
            previewFallback: PLACEHOLDERS.planilha
          })).join('')}
        </div>
        <div class="wizard-actions" style="margin-top:18px;">
          <button class="btn btn-secondary" type="button" id="wizardPrevBtn">Voltar</button>
          <button class="btn btn-primary" type="button" id="wizardNextBtn">Uploads</button>
        </div>
      </article>
    `;
  }

  const previewCanvasId = `sheet-preview-${state.currentOptionIndex}`;
  const resumo = calculateSheetTotals(builder, draft.comercial?.tempoCampanhaDias || 0);
  const productLabels = (currentBudget?.produtosSelecionados || []).map(resolveProductLabel).join(' + ') || 'Sem produto';

  return `
    <article class="form-card" style="padding:18px;">
      <div class="section-heading">
        <div>
          <h2>Planilha montada no app</h2>
          <p>Preencha os principais valores e o app gera uma imagem pronta para o template do Google Slides.</p>
        </div>
      </div>

      ${renderBudgetOptionPills()}

      <div class="card" style="padding:16px; margin-top:18px;">
        <strong style="display:block;">Opção ${state.currentOptionIndex + 1}</strong>
        <p class="muted" style="margin:6px 0 0;">Produtos desta opção: ${escapeHtml(productLabels)}</p>
      </div>

      <div class="stack" style="margin-top:18px;">
        <div class="input-group">
          <label class="input-label" for="sheet-praca">Praça principal</label>
          <input class="input" id="sheet-praca" data-sheet-field="praca" value="${escapeHtml(builder.praca || state.draft.cliente?.pracas || '')}" placeholder="Onde a campanha vai rodar">
        </div>
        <div class="input-group">
          <label class="input-label" for="sheet-veiculos">Quantidade de veículos</label>
          <input class="input" id="sheet-veiculos" data-sheet-field="veiculos" type="number" min="1" value="${escapeHtml(String(builder.veiculos || state.draft.comercial?.numeroCarros || ''))}" placeholder="0">
        </div>
        <div class="input-group">
          <label class="input-label" for="sheet-valorTabela">Valor de tabela (R$)</label>
          <input class="input" id="sheet-valorTabela" data-sheet-field="valorTabela" type="number" min="0" step="0.01" value="${escapeHtml(String(builder.valorTabela || ''))}" placeholder="0,00">
        </div>
        <div class="input-group">
          <label class="input-label" for="sheet-valorNegociado">Valor negociado (R$)</label>
          <input class="input" id="sheet-valorNegociado" data-sheet-field="valorNegociado" type="number" min="0" step="0.01" value="${escapeHtml(String(builder.valorNegociado || ''))}" placeholder="0,00">
        </div>
        <div class="input-group">
          <label class="input-label" for="sheet-custoProducao">Custo de produção (R$)</label>
          <input class="input" id="sheet-custoProducao" data-sheet-field="custoProducao" type="number" min="0" step="0.01" value="${escapeHtml(String(builder.custoProducao || ''))}" placeholder="0,00">
        </div>
        <div class="input-group">
          <label class="input-label" for="sheet-observacoes">Observações da planilha</label>
          <textarea class="textarea" id="sheet-observacoes" data-sheet-field="observacoes" placeholder="Informações extras para aparecer na imagem da planilha">${escapeHtml(builder.observacoes || '')}</textarea>
        </div>
      </div>

      <div class="metric-grid" style="margin-top:18px;">
        ${renderStatCard('Desconto', resumo.descontoPercentual, 'Comparando tabela e negociado')}
        ${renderStatCard('Investimento', formatCurrency(resumo.investimentoTotal), 'Negociado + produção')}
        ${renderStatCard('Mensal', formatCurrency(resumo.valorMensal), 'Estimativa por mês')}
        ${renderStatCard('Duração', `${state.draft.comercial?.tempoCampanhaDias || 0} dias`, 'Período da campanha')}
      </div>

      <article class="sheet-preview-card" style="padding:16px; margin-top:18px;">
        <div class="section-heading">
          <div>
            <h3>Prévia da planilha</h3>
            <p>A imagem abaixo é a que será usada pelo backend na apresentação.</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" id="saveSheetImageBtn">Salvar imagem</button>
        </div>
        <div style="margin-top:14px;">
          <canvas id="${previewCanvasId}" width="1400" height="860"></canvas>
        </div>
        ${planilhaEntry ? `<p class="support-text" style="margin:12px 0 0;">Imagem pronta para a opção ${state.currentOptionIndex + 1}.</p>` : ''}
      </article>

      <div class="wizard-actions" style="margin-top:18px;">
        <button class="btn btn-secondary" type="button" id="wizardPrevBtn">Voltar</button>
        <button class="btn btn-primary" type="button" id="wizardNextBtn">Uploads</button>
      </div>
    </article>
  `;
}

function renderWizardUploadsStep() {
  return `
    <article class="form-card" style="padding:18px;">
      <div class="section-heading">
        <div>
          <h2>Uploads criativos</h2>
          <p>Os arquivos abaixo são os mesmos que o backend já usa no gerador atual. O fluxo aqui só foi reorganizado para o celular.</p>
        </div>
      </div>

      <div class="input-group" style="margin-top:18px;">
        <span class="input-label">Variação do logo</span>
        <div class="segmented" style="--segments: 3;">
          ${['quadrada', 'retangular', 'big'].map((variant) => `
            <button type="button" data-logo-variant="${variant}" class="${(state.draft.logoVariant || 'quadrada') === variant ? 'active' : ''}">${capitalize(variant)}</button>
          `).join('')}
        </div>
      </div>

      <div class="upload-grid" style="margin-top:18px;">
        ${CREATIVE_UPLOAD_SLOTS.map((slot) => renderUploadCard({
          slotId: slot.id,
          label: slot.label,
          help: slot.help,
          upload: state.draft.uploads?.[slot.id],
          previewFallback: PLACEHOLDERS[slot.id]
        })).join('')}
      </div>

      <div class="wizard-actions" style="margin-top:18px;">
        <button class="btn btn-secondary" type="button" id="wizardPrevBtn">Voltar</button>
        <button class="btn btn-primary" type="button" id="wizardNextBtn">Revisão</button>
      </div>
    </article>
  `;
}

function renderWizardReviewStep() {
  const checks = buildReviewChecklist(state.draft);
  const missing = checks.filter((item) => !item.ok);
  const canGenerate = missing.length === 0 && !state.generation.busy;
  const connected = isGoogleConnected();

  return `
    <article class="form-card" style="padding:18px;">
      <div class="section-heading">
        <div>
          <h2>Revisão e geração</h2>
          <p>Confira se está tudo certo antes de acionar o Google Slides.</p>
        </div>
      </div>

      <div class="review-list" style="margin-top:18px;">
        ${checks.map((item) => `
          <div class="review-item">
            <div>
              <strong>${escapeHtml(item.label)}</strong>
              <span>${escapeHtml(item.description)}</span>
            </div>
            <span class="review-badge ${item.ok ? 'ok' : 'missing'}">${item.ok ? 'OK' : 'Pendente'}</span>
          </div>
        `).join('')}
      </div>

      <article class="status-card" style="margin-top:18px;">
        <div class="section-heading">
          <div>
            <h3>Google Slides</h3>
            <p>${connected ? 'Conexão pronta para gerar.' : 'Conecte sua conta antes de gerar a apresentação.'}</p>
          </div>
          <span class="status-pill ${connected ? 'success' : 'warning'}">${connected ? 'Conectado' : 'Pendente'}</span>
        </div>
        <div class="button-row" style="margin-top:16px;">
          <button class="btn btn-secondary btn-sm" type="button" id="reviewConnectGoogleBtn">${connected ? 'Ver integrações' : 'Conectar Google'}</button>
          <button class="btn btn-primary btn-sm" type="button" id="saveProposalDraftBtn">Salvar rascunho</button>
        </div>
      </article>

      <article class="status-card" style="margin-top:18px;">
        <div class="section-heading">
          <div>
            <h3>Geração da apresentação</h3>
            <p id="generationMessage">${escapeHtml(state.generation.message || (missing.length ? 'Complete os itens pendentes para liberar a geração.' : 'Pronto para gerar.'))}</p>
          </div>
          <span class="status-pill ${state.generation.error ? 'danger' : (missing.length ? 'warning' : 'success')}">
            ${state.generation.busy ? 'Gerando' : (missing.length ? 'Revisar' : 'Pronto')}
          </span>
        </div>
        <div class="progress-track" style="margin-top:16px;">
          <div class="progress-bar" id="generationProgressBar" style="width:${state.generation.progress || 0}%;"></div>
        </div>
        ${state.draft.googlePresentationUrl ? `
          <div class="button-row" style="margin-top:16px;">
            <a class="btn btn-secondary btn-sm" href="${escapeHtml(state.draft.googlePresentationUrl)}" target="_blank" rel="noopener">Abrir apresentação</a>
            <button class="btn btn-secondary btn-sm" type="button" id="generatePdfBtn" ${state.generation.pdfBusy ? 'disabled' : ''}>Baixar PDF</button>
          </div>
        ` : ''}
        <div class="button-row" style="margin-top:16px;">
          <button class="btn btn-primary btn-sm" type="button" id="generateSlidesBtn" ${canGenerate && connected ? '' : 'disabled'}>${state.generation.busy ? 'Gerando...' : 'Gerar apresentação'}</button>
          <button class="btn btn-secondary btn-sm" type="button" id="wizardResetBtn">Novo fluxo</button>
        </div>
      </article>

      <div class="wizard-actions" style="margin-top:18px;">
        <button class="btn btn-secondary" type="button" id="wizardPrevBtn">Voltar</button>
        <button class="btn btn-primary" type="button" id="wizardHomeBtn">Ir para a lista</button>
      </div>
    </article>
  `;
}

function bindShellActions() {
  const googleStatusBtn = document.getElementById('googleStatusBtn');
  googleStatusBtn?.addEventListener('click', () => navigate('settings'));
  document.getElementById('installAppBtn')?.addEventListener('click', async () => {
    await promptInstallApp();
  });

  document.querySelectorAll('[data-nav-route]').forEach((button) => {
    button.addEventListener('click', async () => {
      const route = button.getAttribute('data-nav-route');
      if (route === 'wizard' && !hasMeaningfulDraft(state.draft)) {
        startNewDraft();
      }
      navigate(route);
    });
  });
}

function bindCurrentView() {
  switch (state.route.name) {
    case 'proposal':
      bindProposalView();
      break;
    case 'proposals':
      bindProposalsView();
      break;
    case 'settings':
      bindSettingsView();
      break;
    case 'wizard':
      bindWizardView();
      break;
    case 'home':
    default:
      bindHomeView();
      break;
  }
}

function bindLoginScreen() {
  const form = document.getElementById('loginForm');
  const submitBtn = document.getElementById('loginSubmitBtn');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '');

    if (!username || !password) {
      toast('warning', 'Dados incompletos', 'Informe usuário e senha.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';

    try {
      const response = await apiRequest('/admin/login', {
        method: 'POST',
        auth: false,
        body: { username, password }
      });

      state.session.token = response.token;
      state.session.user = response.user;
      persistSession();
      state.route = { name: 'home' };
      updateHash('home', true);
      render();
      void ensureTokenInfo(false);
    } catch (error) {
      toast('error', 'Falha no login', error.message || 'Não foi possível autenticar.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
    }
  });
}

function bindHomeView() {
  document.getElementById('continueLocalDraftBtn')?.addEventListener('click', () => {
    navigate('wizard');
  });

  document.getElementById('discardLocalDraftBtn')?.addEventListener('click', async () => {
    const confirmed = window.confirm('Descartar o rascunho local atual?');
    if (!confirmed) return;
    await clearDraftState();
    render();
    toast('success', 'Rascunho descartado', 'Você pode começar outro quando quiser.');
  });

  if (state.session.token && !state.proposalsLoaded && !state.proposalsLoading) {
    void loadProposals();
  }
}

function bindProposalsView() {
  document.getElementById('startProposalBtn')?.addEventListener('click', () => {
    if (!hasMeaningfulDraft(state.draft)) {
      startNewDraft();
    }
    navigate('wizard');
  });

  bindProposalListActions();

  if (state.session.token && !state.proposalsLoaded && !state.proposalsLoading) {
    void loadProposals();
  }
}

function bindProposalListActions() {
  document.querySelectorAll('[data-open-proposal]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-open-proposal');
      if (id) navigate(`proposal/${id}`);
    });
  });

  document.querySelectorAll('[data-open-edit]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-open-edit');
      if (!id) return;
      await beginEditingProposal(id);
    });
  });
}

function bindProposalView() {
  if (!state.activeProposal || state.activeProposal.id !== state.route.id) {
    void loadProposalDetail(state.route.id);
    return;
  }

  document.getElementById('editProposalBtn')?.addEventListener('click', async () => {
    await beginEditingProposal(state.activeProposal.id);
  });

  document.getElementById('openSlidesBtn')?.addEventListener('click', () => {
    if (state.activeProposal?.googlePresentationUrl) {
      window.open(state.activeProposal.googlePresentationUrl, '_blank', 'noopener');
    }
  });

  document.getElementById('downloadProposalPdfBtn')?.addEventListener('click', async () => {
    await downloadProposalPdf(state.activeProposal);
  });

  document.getElementById('deleteProposalBtn')?.addEventListener('click', async () => {
    const confirmed = window.confirm('Excluir esta proposta? Esta ação não pode ser desfeita.');
    if (!confirmed) return;
    try {
      await window.electronAPI.proposals.delete(state.activeProposal.id);
      toast('success', 'Proposta excluída', 'A proposta foi removida do backend.');
      state.activeProposal = null;
      state.proposalsLoaded = false;
      navigate('home');
    } catch (error) {
      toast('error', 'Erro ao excluir', error.message || 'Não foi possível excluir a proposta.');
    }
  });
}

function bindSettingsView() {
  document.getElementById('connectGoogleBtn')?.addEventListener('click', () => {
    void connectGoogleSlides();
  });
  document.getElementById('refreshGoogleBtn')?.addEventListener('click', () => {
    void refreshGoogleToken();
  });
  document.getElementById('disconnectGoogleBtn')?.addEventListener('click', () => {
    void disconnectGoogleSlides();
  });
  document.getElementById('reloadGoogleConfigBtn')?.addEventListener('click', () => {
    void ensureGoogleConfig(true);
  });
  document.getElementById('saveGoogleConfigBtn')?.addEventListener('click', () => {
    void saveGoogleConfigFromForm();
  });
  document.getElementById('resetGoogleConfigBtn')?.addEventListener('click', () => {
    void resetGoogleConfig();
  });
  if (state.session.token && !state.tokenInfo && !state.tokenInfoLoading) {
    void ensureTokenInfo(true);
  }
  if (state.session.token && !state.googleConfig && !state.googleConfigLoading) {
    void ensureGoogleConfig(true);
  }
}

function bindWizardView() {
  switch (state.wizardStep) {
    case 0:
      bindWizardDataStep();
      break;
    case 1:
      bindWizardProductsStep();
      break;
    case 2:
      bindWizardSheetStep();
      break;
    case 3:
      bindWizardUploadsStep();
      break;
    case 4:
      bindWizardReviewStep();
      break;
    default:
      break;
  }
}

function bindWizardDataStep() {
  const syncFieldState = (input) => {
    const path = input.getAttribute('data-field');
    const value = coerceInputValue(input);
    setDraftValue(path, value);
    syncDraftDerivedFields();
    refreshWizardDataStepMetrics();
    persistLocalDraft().catch(() => null);
  };

  document.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      syncFieldState(input);
    });
    input.addEventListener('change', () => {
      syncFieldState(input);
    });
  });

  document.querySelectorAll('[data-plan-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.draft.tipoPlanilha = button.getAttribute('data-plan-mode') || 'imagem';
      persistLocalDraft().catch(() => null);
      render();
    });
  });

  document.getElementById('wizardExitBtn')?.addEventListener('click', () => {
    navigate('home');
  });
  document.getElementById('wizardNextBtn')?.addEventListener('click', () => {
    if (!validateDataStep()) return;
    state.wizardStep = 1;
    persistLocalDraft().catch(() => null);
    render();
  });
}

function refreshWizardDataStepMetrics() {
  const metrics = state.draft?.impacto || {};
  const metricValues = {
    corridas: metrics.corridasFormatado || '0',
    passageiros: metrics.passageirosTransportadosFormatado || '0',
    km: metrics.kmPercorridosFormatado || '0',
    impactos: metrics.impactosPossiveisFormatado || '0'
  };

  Object.entries(metricValues).forEach(([key, value]) => {
    const card = document.querySelector(`[data-metric-key="${key}"]`);
    if (!card) return;
    const valueNode = card.querySelector('.metric-value');
    if (valueNode) {
      valueNode.textContent = value;
    }
  });
}

function bindWizardProductsStep() {
  bindBudgetOptionSwitchers();

  document.querySelectorAll('[data-product-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const productId = button.getAttribute('data-product-id');
      if (!productId) return;
      const selection = getCurrentBudgetSelection();
      const nextSelection = selection.includes(productId)
        ? selection.filter((id) => id !== productId)
        : [...selection, productId];
      const validation = validateSelection(nextSelection);
      if (!validation.valid) {
        toast('warning', 'Combinação inválida', validation.message);
        return;
      }
      setCurrentBudgetSelection(nextSelection);
      persistLocalDraft().catch(() => null);
      render();
    });
  });

  document.getElementById('wizardPrevBtn')?.addEventListener('click', () => {
    state.wizardStep = 0;
    render();
  });
  document.getElementById('wizardNextBtn')?.addEventListener('click', () => {
    const emptyBudget = (state.draft.orcamentos || []).findIndex((budget) => !(budget.produtosSelecionados || []).length);
    if (emptyBudget !== -1) {
      toast('warning', 'Seleção incompleta', `A opção ${emptyBudget + 1} precisa ter pelo menos um produto.`);
      return;
    }
    state.wizardStep = 2;
    persistLocalDraft().catch(() => null);
    render();
  });
}

function bindWizardSheetStep() {
  bindBudgetOptionSwitchers();

  if (state.draft.tipoPlanilha === 'imagem') {
    bindUploadCards();
  } else {
    document.querySelectorAll('[data-sheet-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.getAttribute('data-sheet-field');
        const builder = ensureSheetBuilder(state.currentOptionIndex);
        builder[field] = coerceSheetValue(field, input.value);
        persistLocalDraft().catch(() => null);
        updateSheetPreviewDom();
      });
    });

    document.getElementById('saveSheetImageBtn')?.addEventListener('click', async () => {
      try {
        await persistSheetImage(state.currentOptionIndex);
        toast('success', 'Planilha salva', `Imagem da opção ${state.currentOptionIndex + 1} pronta para o template.`);
      } catch (error) {
        toast('error', 'Erro ao gerar planilha', error.message || 'Não foi possível criar a imagem.');
      }
    });

    updateSheetPreviewDom();
  }

  document.getElementById('wizardPrevBtn')?.addEventListener('click', () => {
    state.wizardStep = 1;
    render();
  });

  document.getElementById('wizardNextBtn')?.addEventListener('click', async () => {
    try {
      if (state.draft.tipoPlanilha === 'editar') {
        await buildAllSheetUploads();
      }
      if (!hasPlanilhaUploads(state.draft)) {
        toast('warning', 'Planilha pendente', 'Você precisa gerar ou enviar a planilha antes de continuar.');
        return;
      }
      state.wizardStep = 3;
      persistLocalDraft().catch(() => null);
      render();
    } catch (error) {
      toast('error', 'Erro ao preparar planilha', error.message || 'Não foi possível avançar.');
    }
  });
}

function bindWizardUploadsStep() {
  document.querySelectorAll('[data-logo-variant]').forEach((button) => {
    button.addEventListener('click', () => {
      state.draft.logoVariant = button.getAttribute('data-logo-variant') || 'quadrada';
      persistLocalDraft().catch(() => null);
      render();
    });
  });
  bindUploadCards();
  document.getElementById('wizardPrevBtn')?.addEventListener('click', () => {
    state.wizardStep = 2;
    render();
  });
  document.getElementById('wizardNextBtn')?.addEventListener('click', () => {
    state.wizardStep = 4;
    persistLocalDraft().catch(() => null);
    render();
  });
}

function bindWizardReviewStep() {
  document.getElementById('wizardPrevBtn')?.addEventListener('click', () => {
    state.wizardStep = 3;
    render();
  });
  document.getElementById('wizardHomeBtn')?.addEventListener('click', () => {
    navigate('home');
  });
  document.getElementById('wizardResetBtn')?.addEventListener('click', async () => {
    const confirmed = window.confirm('Começar um novo fluxo agora? O rascunho local atual será substituído.');
    if (!confirmed) return;
    await clearDraftState();
    startNewDraft();
    render();
  });
  document.getElementById('reviewConnectGoogleBtn')?.addEventListener('click', () => {
    navigate('settings');
  });
  document.getElementById('saveProposalDraftBtn')?.addEventListener('click', async () => {
    try {
      await saveDraftToBackend();
      toast('success', 'Rascunho salvo', 'A proposta agora também está registrada no backend.');
      state.proposalsLoaded = false;
    } catch (error) {
      toast('error', 'Erro ao salvar', error.message || 'Não foi possível salvar a proposta.');
    }
  });
  document.getElementById('generateSlidesBtn')?.addEventListener('click', async () => {
    try {
      await generatePresentation();
    } catch (error) {
      toast('error', 'Erro ao gerar', error.message || 'Não foi possível gerar a apresentação.');
    }
  });
  document.getElementById('generatePdfBtn')?.addEventListener('click', async () => {
    try {
      await downloadCurrentDraftPdf();
    } catch (error) {
      toast('error', 'Erro ao baixar PDF', error.message || 'Não foi possível exportar o PDF.');
    }
  });
}

function bindBudgetOptionSwitchers() {
  document.querySelectorAll('[data-budget-option]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentOptionIndex = Number(button.getAttribute('data-budget-option')) || 0;
      render();
    });
  });
}

function bindUploadCards() {
  document.querySelectorAll('[data-upload-source]').forEach((button) => {
    button.addEventListener('click', async () => {
      const slotId = button.getAttribute('data-upload-slot');
      const mode = button.getAttribute('data-upload-source');
      if (!slotId || !mode) return;
      try {
        await pickAndStoreUpload(slotId, mode);
        render();
      } catch (error) {
        if (error?.message === 'cancelled') return;
        toast('error', 'Erro no upload', error.message || 'Não foi possível processar o arquivo.');
      }
    });
  });

  document.querySelectorAll('[data-upload-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      const slotId = button.getAttribute('data-upload-remove');
      if (!slotId) return;
      await removeUpload(slotId);
      render();
    });
  });
}

async function loadProposals() {
  state.proposalsLoading = true;
  render();
  try {
    const proposals = await window.electronAPI.proposals.list();
    state.proposals = Array.isArray(proposals)
      ? [...proposals].sort((left, right) => {
          const leftTime = parseTimestamp(left?.updatedAt || left?.createdAt);
          const rightTime = parseTimestamp(right?.updatedAt || right?.createdAt);
          return rightTime - leftTime;
        })
      : [];
    state.proposalsLoaded = true;
  } catch (error) {
    toast('error', 'Erro ao carregar propostas', error.message || 'Não foi possível sincronizar as propostas.');
  } finally {
    state.proposalsLoading = false;
    render();
  }
}

async function loadProposalDetail(id) {
  if (!id) return;
  state.activeProposalLoading = true;
  render();
  try {
    state.activeProposal = await window.electronAPI.proposals.get(id);
    if (!state.activeProposal) {
      toast('warning', 'Proposta não encontrada', 'O item pode ter sido removido.');
      navigate('home');
      return;
    }
  } catch (error) {
    toast('error', 'Erro ao abrir proposta', error.message || 'Não foi possível abrir a proposta.');
    navigate('home');
  } finally {
    state.activeProposalLoading = false;
    render();
  }
}

async function beginEditingProposal(id) {
  try {
    const proposal = await window.electronAPI.proposals.get(id);
    if (!proposal) {
      toast('warning', 'Proposta não encontrada', 'O item não está mais disponível.');
      return;
    }
    state.draft = clone(proposal);
    ensureDraftShape(state.draft);
    state.wizardStep = 0;
    state.currentOptionIndex = 0;
    hydrateDraftWithRemotePreviews(state.draft);
    await persistLocalDraft();
    navigate('wizard');
  } catch (error) {
    toast('error', 'Erro ao editar', error.message || 'Não foi possível abrir a proposta para edição.');
  }
}

function startNewDraft() {
  state.draft = createEmptyDraft();
  state.wizardStep = 0;
  state.currentOptionIndex = 0;
  void persistLocalDraft();
}

async function clearDraftState() {
  state.draft = createEmptyDraft();
  state.wizardStep = 0;
  state.currentOptionIndex = 0;
  localStorage.removeItem(STORAGE_KEYS.draft);
  await draftUploadStore.clear();
}

async function restoreDraftFromStorage() {
  const saved = readJsonStorage(STORAGE_KEYS.draft);
  if (saved?.draft) {
    state.draft = saved.draft;
    state.wizardStep = Number(saved.wizardStep) || 0;
    state.currentOptionIndex = Number(saved.currentOptionIndex) || 0;
    ensureDraftShape(state.draft);
    await hydrateDraftUploads(state.draft);
    return;
  }
  state.draft = createEmptyDraft();
}

async function persistLocalDraft() {
  ensureDraftShape(state.draft);
  const sanitized = sanitizeDraftForLocalStorage(state.draft);
  localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({
    draft: sanitized,
    wizardStep: state.wizardStep,
    currentOptionIndex: state.currentOptionIndex,
    updatedAt: new Date().toISOString()
  }));
}

function readDraftStamp() {
  const saved = readJsonStorage(STORAGE_KEYS.draft);
  return saved?.updatedAt || null;
}

async function hydrateDraftUploads(draft) {
  const uploads = draft.uploads || {};
  for (const [slotId, upload] of Object.entries(uploads)) {
    if (!upload) continue;
    if (upload._cached) {
      const cached = await draftUploadStore.get(slotId);
      if (cached) {
        Object.assign(upload, cached);
      }
    }
  }
}

function hydrateDraftWithRemotePreviews(draft) {
  const uploadDriveUrls = draft.uploadDriveUrls || {};
  draft.uploads = draft.uploads || {};
  Object.entries(draft.uploads).forEach(([slotId, upload]) => {
    if (!upload) return;
    if (!upload.previewUrl && uploadDriveUrls[slotId]) {
      upload.previewUrl = uploadDriveUrls[slotId];
    }
  });
}

function sanitizeDraftForLocalStorage(draft) {
  const cloneDraft = clone(draft);
  Object.keys(cloneDraft.uploads || {}).forEach((slotId) => {
    const upload = cloneDraft.uploads[slotId];
    if (!upload) return;
    delete upload.data;
    delete upload.dataUrl;
    if (upload.previewUrl?.startsWith('data:')) {
      delete upload.previewUrl;
    }
    upload._cached = true;
  });
  return cloneDraft;
}

async function pickAndStoreUpload(slotId, mode) {
  const file = await openFilePicker(mode);
  if (!file) {
    throw new Error('cancelled');
  }
  const upload = await buildUploadEntry(file, slotId.startsWith('planilha') ? { maxWidth: 2200, maxHeight: 2200 } : undefined);
  state.draft.uploads[slotId] = upload;
  await draftUploadStore.put(slotId, {
    data: upload.data,
    dataUrl: upload.dataUrl,
    previewUrl: upload.previewUrl
  });
  state.draft.uploads[slotId]._cached = true;
  if (slotId === 'planilha-1') {
    state.draft.uploads.planilha = clone(state.draft.uploads[slotId]);
  }
  syncDraftDerivedFields();
  await persistLocalDraft();
  toast('success', 'Upload concluído', `${upload.name} pronto para a proposta.`);
}

async function removeUpload(slotId) {
  delete state.draft.uploads[slotId];
  await draftUploadStore.delete(slotId);
  if (slotId === 'planilha-1' || slotId === 'planilha') {
    delete state.draft.uploads.planilha;
  }
  await persistLocalDraft();
}

async function persistSheetImage(optionIndex) {
  const budget = state.draft.orcamentos?.[optionIndex];
  if (!budget) {
    throw new Error('Opção de orçamento não encontrada.');
  }
  const builder = ensureSheetBuilder(optionIndex);
  const dataUrl = renderSheetDataUrl(optionIndex, builder);
  const base64 = extractBase64FromDataUrl(dataUrl);
  const slotId = getPlanilhaSlotId(optionIndex);
  const entry = {
    name: `planilha-opcao-${optionIndex + 1}.png`,
    path: `planilha-opcao-${optionIndex + 1}.png`,
    size: base64.length,
    data: base64,
    dataUrl,
    previewUrl: dataUrl,
    type: 'image/png',
    _cached: true
  };
  state.draft.uploads[slotId] = entry;
  if (optionIndex === 0) {
    state.draft.uploads.planilha = clone(entry);
  }
  await draftUploadStore.put(slotId, {
    data: entry.data,
    dataUrl: entry.dataUrl,
    previewUrl: entry.previewUrl
  });
  if (optionIndex === 0) {
    await draftUploadStore.put('planilha', {
      data: entry.data,
      dataUrl: entry.dataUrl,
      previewUrl: entry.previewUrl
    });
  }
  await persistLocalDraft();
}

async function buildAllSheetUploads() {
  const budgets = state.draft.orcamentos || [];
  for (let index = 0; index < budgets.length; index += 1) {
    await persistSheetImage(index);
  }
}

async function saveDraftToBackend() {
  syncDraftDerivedFields();
  ensureDraftShape(state.draft);
  const payload = serializeDraftForCrud(state.draft);
  if (state.draft.id) {
    const updated = await window.electronAPI.proposals.update(state.draft.id, payload);
    state.draft.id = updated?.id || state.draft.id;
  } else {
    state.draft.id = String(Date.now());
    payload.id = state.draft.id;
    const created = await window.electronAPI.proposals.create(payload);
    state.draft.id = created?.id || state.draft.id;
  }
  await persistLocalDraft();
  state.proposalsLoaded = false;
}

async function generatePresentation() {
  const review = buildReviewChecklist(state.draft);
  const missing = review.filter((item) => !item.ok);
  if (missing.length) {
    throw new Error('Ainda existem itens pendentes na revisão.');
  }
  if (!isGoogleConnected()) {
    throw new Error('Conecte o Google Slides antes de gerar.');
  }

  state.generation.busy = true;
  state.generation.error = '';
  state.generation.progress = 2;
  state.generation.message = 'Preparando arquivos para envio...';
  render();

  const slidesPayload = await buildSlidesPayload(state.draft);

  try {
    const response = await window.electronAPI.slides.generate(slidesPayload, null, {
      exportPdf: false,
      quality: 'maximum'
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Falha ao gerar a apresentação.');
    }

    state.draft.status = 'slides-ready';
    state.draft.googlePresentationId = response.designId;
    state.draft.googlePresentationUrl = response.presentationUrl;
    state.draft.generatedAt = new Date().toISOString();
    if (response.uploadDriveUrls) {
      state.draft.uploadDriveUrls = response.uploadDriveUrls;
      hydrateDraftWithRemotePreviews(state.draft);
    }
    await saveDraftToBackend();
    await persistLocalDraft();
    state.generation.progress = 100;
    state.generation.message = 'Apresentação gerada com sucesso.';
    render();
    toast('success', 'Apresentação criada', 'O link do Google Slides já está disponível.');
  } catch (error) {
    state.generation.error = error.message || 'Erro desconhecido ao gerar.';
    state.generation.message = state.generation.error;
    updateGenerationStatusDom();
    throw error;
  } finally {
    state.generation.busy = false;
    render();
  }
}

async function downloadCurrentDraftPdf() {
  if (!state.draft.googlePresentationId) {
    throw new Error('A apresentação ainda não foi gerada.');
  }
  state.generation.pdfBusy = true;
  render();
  try {
    const response = await window.electronAPI.slides.exportPdf(state.draft.googlePresentationId, state.draft.id);
    if (!response?.success) {
      throw new Error(response?.error || 'Falha ao exportar o PDF.');
    }
    await window.electronAPI.files.save({
      data: response.base64,
      fileName: response.fileName || `proposta-${state.draft.id || Date.now()}.pdf`
    });
    state.draft.status = 'completed';
    state.draft.generatedPdfAvailable = true;
    state.draft.generatedPdfFileName = response.fileName;
    await saveDraftToBackend();
    await persistLocalDraft();
    toast('success', 'PDF baixado', 'O arquivo foi salvo no seu dispositivo.');
    render();
  } finally {
    state.generation.pdfBusy = false;
    render();
  }
}

async function downloadProposalPdf(proposal) {
  if (!proposal?.googlePresentationId) {
    throw new Error('A proposta ainda não possui apresentação gerada.');
  }
  const response = await window.electronAPI.slides.exportPdf(proposal.googlePresentationId, proposal.id);
  if (!response?.success) {
    throw new Error(response?.error || 'Falha ao exportar o PDF.');
  }
  await window.electronAPI.files.save({
    data: response.base64,
    fileName: response.fileName || `proposta-${proposal.id || Date.now()}.pdf`
  });
  toast('success', 'PDF baixado', 'O arquivo foi salvo no seu dispositivo.');
}

async function buildSlidesPayload(draft) {
  const payload = clone(draft);
  payload.uploads = payload.uploads || {};

  const requiredSlotIds = getRequiredUploadSlotIds(payload);
  for (const slotId of requiredSlotIds) {
    const upload = payload.uploads[slotId];
    if (!upload) {
      throw new Error(`Upload obrigatório ausente: ${resolveUploadLabel(slotId)}.`);
    }

    if (!upload.data) {
      const cached = await draftUploadStore.get(slotId);
      if (cached?.data) {
        upload.data = cached.data;
        upload.dataUrl = upload.dataUrl || cached.dataUrl;
        upload.previewUrl = upload.previewUrl || cached.previewUrl;
      }
    }

    if (!upload.data && upload.dataUrl) {
      upload.data = extractBase64FromDataUrl(upload.dataUrl);
    }

    if (!upload.data && payload.uploadDriveUrls?.[slotId]) {
      const recovered = await recoverUploadFromRemote(payload.uploadDriveUrls[slotId], slotId);
      if (recovered?.data) {
        Object.assign(upload, recovered);
      }
    }

    if (!upload.data) {
      throw new Error(`Reenvie o arquivo ${resolveUploadLabel(slotId)} para concluir a geração.`);
    }
  }

  syncDraftDerivedFields(payload);
  return payload;
}

async function recoverUploadFromRemote(url, slotId) {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    const entry = {
      name: `${slotId}.png`,
      path: `${slotId}.png`,
      size: blob.size,
      type: blob.type || 'image/png',
      data: extractBase64FromDataUrl(dataUrl),
      dataUrl,
      previewUrl: dataUrl,
      _cached: true
    };
    await draftUploadStore.put(slotId, {
      data: entry.data,
      dataUrl: entry.dataUrl,
      previewUrl: entry.previewUrl
    });
    return entry;
  } catch (error) {
    console.warn('[Gerador App] Não foi possível recuperar upload remoto:', slotId, error);
    return null;
  }
}

async function ensureTokenInfo(reRender = false) {
  state.tokenInfoLoading = true;
  if (reRender) render();
  try {
    state.tokenInfo = await window.electronAPI.slides.getTokenInfo();
  } catch (error) {
    console.warn('[Gerador App] Falha ao consultar token do Google:', error);
    state.tokenInfo = null;
  } finally {
    state.tokenInfoLoading = false;
    const shouldRenderAfterLoad =
      reRender ||
      (!state.booting && state.route.name !== 'wizard') ||
      (!state.booting && state.route.name === 'wizard' && state.wizardStep === 4);
    if (shouldRenderAfterLoad) render();
  }
}

async function connectGoogleSlides() {
  const response = await window.electronAPI.slides.startOAuth();
  if (!response?.authUrl) {
    throw new Error(response?.error || 'Não foi possível iniciar o OAuth do Google.');
  }
  window.open(response.authUrl, '_blank', 'noopener');
  toast('info', 'Autorização aberta', 'Finalize a autorização no navegador. O app vai checar o status automaticamente.');
  const connected = await waitForGoogleAuthorization();
  if (connected) {
    toast('success', 'Google conectado', 'A conta está pronta para gerar apresentações.');
  } else {
    toast('warning', 'Aguardando autorização', 'Conclua o login do Google e tente atualizar o status.');
  }
}

async function waitForGoogleAuthorization(timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await delay(2000);
    await ensureTokenInfo(false);
    if (isGoogleConnected()) {
      render();
      return true;
    }
  }
  render();
  return false;
}

async function disconnectGoogleSlides() {
  const confirmed = window.confirm('Desconectar a conta do Google Slides deste backend?');
  if (!confirmed) return;
  await window.electronAPI.slides.disconnect();
  await ensureTokenInfo(true);
  toast('success', 'Google desconectado', 'A conexão foi removida.');
}

async function refreshGoogleToken() {
  const response = await window.electronAPI.slides.refreshToken();
  if (!response?.success) {
    throw new Error(response?.error || 'Não foi possível renovar o token.');
  }
  await ensureTokenInfo(true);
  toast('success', 'Token renovado', 'A sessão do Google foi atualizada.');
}

async function ensureGoogleConfig(reRender = false) {
  state.googleConfigLoading = true;
  if (reRender) render();
  try {
    state.googleConfig = await window.electronAPI.settings.getGoogleConfig();
  } catch (error) {
    console.warn('[Gerador App] Falha ao carregar configuração do Google:', error);
  } finally {
    state.googleConfigLoading = false;
    if (reRender) render();
  }
}

async function saveGoogleConfigFromForm() {
  const payload = {};
  document.querySelectorAll('[data-config-field]').forEach((input) => {
    const key = input.getAttribute('data-config-field');
    const value = String(input.value || '').trim();
    if (key && value) {
      payload[key] = value;
    }
  });
  await window.electronAPI.settings.saveGoogleConfig(payload);
  await ensureGoogleConfig(true);
  toast('success', 'Configuração salva', 'Os IDs do Google foram atualizados.');
}

async function resetGoogleConfig() {
  const confirmed = window.confirm('Restaurar a configuração do Google para o padrão do backend?');
  if (!confirmed) return;
  await window.electronAPI.settings.saveGoogleConfig({});
  await ensureGoogleConfig(true);
  toast('success', 'Configuração restaurada', 'Os valores voltaram ao padrão do backend.');
}

async function promptInstallApp() {
  const promptEvent = state.installPromptEvent;
  if (!promptEvent) {
    toast('info', 'Instalação indisponível', 'Seu navegador não disponibilizou o prompt de instalação agora.');
    return;
  }
  promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  if (choice?.outcome === 'accepted') {
    state.installPromptEvent = null;
    toast('success', 'Instalação iniciada', 'Conclua a instalação pelo navegador.');
  } else {
    toast('warning', 'Instalação cancelada', 'Você pode instalar o app depois, quando quiser.');
  }
  render();
}

function updateGenerationStatusDom() {
  const bar = document.getElementById('generationProgressBar');
  if (bar) {
    bar.style.width = `${state.generation.progress || 0}%`;
  }
  const message = document.getElementById('generationMessage');
  if (message) {
    message.textContent = state.generation.message || '';
  }
}

function validateDataStep() {
  syncDraftDerivedFields();
  const draft = state.draft;
  if (!draft.cliente?.nomeAnunciante?.trim()) {
    toast('warning', 'Dados incompletos', 'Informe o nome do anunciante.');
    return false;
  }
  if (!draft.cliente?.nomeEmpresa?.trim()) {
    toast('warning', 'Dados incompletos', 'Informe o nome da empresa.');
    return false;
  }
  if (!draft.comercial?.pagamento?.trim()) {
    toast('warning', 'Dados incompletos', 'Informe a condição de pagamento.');
    return false;
  }
  if (!draft.comercial?.dataInicio) {
    toast('warning', 'Dados incompletos', 'Informe a data de início.');
    return false;
  }
  if (!(Number(draft.comercial?.numeroCarros) > 0)) {
    toast('warning', 'Dados incompletos', 'Informe a quantidade de carros.');
    return false;
  }
  if (!(Number(draft.comercial?.tempoCampanhaDias) > 0)) {
    toast('warning', 'Dados incompletos', 'Informe o tempo de campanha em dias.');
    return false;
  }
  if (!(Number(draft.comercial?.validadeDias) > 0)) {
    toast('warning', 'Dados incompletos', 'Informe a validade da proposta.');
    return false;
  }
  return true;
}

function syncDraftDerivedFields(targetDraft = state.draft) {
  ensureDraftShape(targetDraft);
  const quantidade = clamp(Number(targetDraft.comercial?.qtdOrcamentos || 1), 1, MAX_BUDGET_OPTIONS);
  targetDraft.comercial.qtdOrcamentos = quantidade;
  targetDraft.comercial.numeroCarros = Number(targetDraft.comercial.numeroCarros || 0);
  targetDraft.comercial.tempoCampanhaDias = Number(targetDraft.comercial.tempoCampanhaDias || 0);
  targetDraft.comercial.validadeDias = Number(targetDraft.comercial.validadeDias || 0);
  targetDraft.comercial.tempoCampanha = `${targetDraft.comercial.tempoCampanhaDias || 0} dias`;
  targetDraft.logoVariant = targetDraft.logoVariant || 'quadrada';

  if (targetDraft.comercial?.dataInicio && targetDraft.comercial?.tempoCampanhaDias > 0) {
    const start = new Date(`${targetDraft.comercial.dataInicio}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + Number(targetDraft.comercial.tempoCampanhaDias || 0));
    targetDraft.comercial.dataFim = end.toISOString().split('T')[0];
  } else {
    targetDraft.comercial.dataFim = null;
  }

  ensureOrcamentos(targetDraft);
  targetDraft.produtosSelecionados = targetDraft.orcamentos?.[0]?.produtosSelecionados || [];

  if (window.impactMetrics?.calculateImpactMetrics) {
    targetDraft.impacto = window.impactMetrics.calculateImpactMetrics(
      Number(targetDraft.comercial?.tempoCampanhaDias || 0),
      Number(targetDraft.comercial?.numeroCarros || 0)
    );
  }
}

function ensureDraftShape(draft) {
  if (!draft) {
    state.draft = createEmptyDraft();
    return;
  }
  draft.cliente = draft.cliente || {};
  draft.comercial = draft.comercial || {};
  draft.uploads = draft.uploads || {};
  draft.impacto = draft.impacto || {};
  draft.sheetBuilder = draft.sheetBuilder || {};
  draft.status = draft.status || 'draft';
  draft.tipoPlanilha = draft.tipoPlanilha || 'imagem';
  draft.logoVariant = draft.logoVariant || 'quadrada';
  ensureOrcamentos(draft);
}

function ensureOrcamentos(draft) {
  const count = clamp(Number(draft.comercial?.qtdOrcamentos || 1), 1, MAX_BUDGET_OPTIONS);
  const existing = Array.isArray(draft.orcamentos) ? draft.orcamentos : [];
  draft.orcamentos = Array.from({ length: count }, (_, index) => {
    const fallbackSelection = index === 0 && Array.isArray(draft.produtosSelecionados)
      ? draft.produtosSelecionados
      : [];
    const current = existing[index] || { id: `opcao-${index + 1}`, produtosSelecionados: fallbackSelection };
    current.id = current.id || `opcao-${index + 1}`;
    current.produtosSelecionados = normalizeProductObjects(current.produtosSelecionados || fallbackSelection);
    return current;
  });
  if (state.currentOptionIndex > count - 1) {
    state.currentOptionIndex = 0;
  }
}

function ensureSheetBuilder(optionIndex) {
  ensureDraftShape(state.draft);
  const budget = state.draft.orcamentos?.[optionIndex];
  if (!budget) return {};
  if (!state.draft.sheetBuilder[budget.id]) {
    state.draft.sheetBuilder[budget.id] = {};
  }
  return state.draft.sheetBuilder[budget.id];
}

function setDraftValue(path, value) {
  const segments = path.split('.');
  let cursor = state.draft;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
}

function getCurrentBudgetSelection() {
  const budget = state.draft.orcamentos?.[state.currentOptionIndex];
  return normalizeSelection((budget?.produtosSelecionados || []).map((item) => item?.id || item).filter(Boolean));
}

function setCurrentBudgetSelection(selection) {
  const budget = state.draft.orcamentos?.[state.currentOptionIndex];
  if (!budget) return;
  budget.produtosSelecionados = normalizeSelection(selection).map((id) => {
    const product = PRODUCT_CATALOG.find((item) => item.id === id);
    return {
      id,
      name: product?.name || id,
      desc: product?.desc || ''
    };
  });
  state.draft.produtosSelecionados = state.draft.orcamentos?.[0]?.produtosSelecionados || [];
  state.draft.templateSelection = getSelectionScenario((state.draft.produtosSelecionados || []).map((item) => item.id));
}

function validateSelection(selection) {
  if (selection.length > 2) {
    return { valid: false, message: 'Selecione no máximo dois produtos por opção.' };
  }
  const scenario = getSelectionScenario(selection);
  if (scenario === 'invalid') {
    return {
      valid: false,
      message: 'Use apenas OD IN sozinho, um externo sozinho ou OD IN + um externo.'
    };
  }
  return { valid: true, scenario };
}

function getSelectionScenario(selection) {
  if (!selection?.length) return 'none';
  const hasInternal = selection.includes(INTERNAL_PRODUCT_ID);
  const externalCount = selection.filter((id) => EXTERNAL_PRODUCT_IDS.includes(id)).length;
  if (hasInternal && selection.length === 1) return 'od-in-only';
  if (!hasInternal && selection.length === 1 && externalCount === 1) return 'external-only';
  if (hasInternal && externalCount === 1 && selection.length === 2) return 'combo';
  return 'invalid';
}

function normalizeSelection(selection) {
  const normalized = [];
  selection.forEach((id) => {
    if (!PRODUCT_CATALOG.some((product) => product.id === id)) return;
    if (normalized.includes(id)) return;
    if (normalized.length >= 2) return;
    normalized.push(id);
  });
  if (normalized.length === 2 && !normalized.includes(INTERNAL_PRODUCT_ID)) {
    normalized.pop();
  }
  return normalized;
}

function normalizeProductObjects(products) {
  return normalizeSelection(products.map((item) => item?.id || item)).map((id) => {
    const product = PRODUCT_CATALOG.find((item) => item.id === id);
    return {
      id,
      name: product?.name || id,
      desc: product?.desc || ''
    };
  });
}

function buildReviewChecklist(draft) {
  syncDraftDerivedFields(draft);
  return [
    {
      label: 'Dados do anunciante',
      description: draft.cliente?.nomeAnunciante && draft.cliente?.nomeEmpresa ? 'Cliente e empresa preenchidos.' : 'Preencha anunciante e empresa.',
      ok: !!(draft.cliente?.nomeAnunciante && draft.cliente?.nomeEmpresa)
    },
    {
      label: 'Dados comerciais',
      description: draft.comercial?.pagamento && draft.comercial?.dataInicio && draft.comercial?.tempoCampanhaDias ? 'Condição, período e início definidos.' : 'Ainda faltam campos comerciais.',
      ok: !!(draft.comercial?.pagamento && draft.comercial?.dataInicio && Number(draft.comercial?.tempoCampanhaDias) > 0 && Number(draft.comercial?.numeroCarros) > 0)
    },
    {
      label: 'Produtos',
      description: (draft.orcamentos || []).every((budget) => (budget.produtosSelecionados || []).length) ? 'Todas as opções têm produtos válidos.' : 'Uma ou mais opções estão sem produto.',
      ok: (draft.orcamentos || []).every((budget) => (budget.produtosSelecionados || []).length)
    },
    {
      label: 'Planilha',
      description: hasPlanilhaUploads(draft) ? 'Imagem da planilha pronta para todas as opções.' : 'Falta enviar ou gerar a planilha.',
      ok: hasPlanilhaUploads(draft)
    },
    {
      label: 'Criativos obrigatórios',
      description: hasCreativeUploads(draft) ? 'Logo, mocks e OD IN já estão no rascunho.' : 'Ainda faltam uploads obrigatórios.',
      ok: hasCreativeUploads(draft)
    }
  ];
}

function hasCreativeUploads(draft) {
  return CREATIVE_UPLOAD_SLOTS.every((slot) => !!draft.uploads?.[slot.id]);
}

function hasPlanilhaUploads(draft) {
  const required = getRequiredPlanilhaSlotIds(draft);
  return required.every((slotId) => !!draft.uploads?.[slotId] || (slotId === 'planilha' && !!draft.uploads?.planilha));
}

function getRequiredPlanilhaSlotIds(draft) {
  const count = clamp(Number(draft.comercial?.qtdOrcamentos || 1), 1, MAX_BUDGET_OPTIONS);
  if (count <= 1) {
    return ['planilha'];
  }
  return Array.from({ length: count }, (_, index) => `planilha-${index + 1}`);
}

function getRequiredUploadSlotIds(draft) {
  return [
    ...CREATIVE_UPLOAD_SLOTS.map((slot) => slot.id),
    ...getRequiredPlanilhaSlotIds(draft)
  ];
}

function serializeDraftForCrud(draft) {
  const payload = clone(draft);
  payload.uploads = payload.uploads || {};
  Object.keys(payload.uploads).forEach((slotId) => {
    const upload = payload.uploads[slotId];
    if (!upload) return;
    payload.uploads[slotId] = {
      name: upload.name,
      path: upload.path,
      size: upload.size,
      type: upload.type,
      lastModified: upload.lastModified
    };
  });
  return payload;
}

function createEmptyDraft() {
  const draft = {
    status: 'draft',
    cliente: {},
    comercial: {
      qtdOrcamentos: 1
    },
    produtosSelecionados: [],
    orcamentos: [
      {
        id: 'opcao-1',
        produtosSelecionados: []
      }
    ],
    uploads: {},
    impacto: {},
    logoVariant: 'quadrada',
    tipoPlanilha: 'imagem',
    sheetBuilder: {}
  };
  syncDraftDerivedFields(draft);
  return draft;
}

function renderStatCard(label, value, support, extraAttributes = '') {
  const attributes = extraAttributes ? ` ${extraAttributes}` : '';
  return `
    <div class="metric-card"${attributes}>
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${support ? `<div class="support-text" style="margin-top:8px;">${escapeHtml(support)}</div>` : ''}
    </div>
  `;
}

function renderLocalDraftCard() {
  const draft = state.draft;
  return `
    <article class="proposal-card">
      <div class="section-heading">
        <div>
          <h3>Rascunho local em andamento</h3>
          <p>Seu progresso fica salvo no navegador deste aparelho.</p>
        </div>
        <span class="pill">Autosave</span>
      </div>
      <div class="meta-row">
        <span>${escapeHtml(draft.cliente?.nomeAnunciante || 'Sem anunciante')}</span>
        <span>${escapeHtml(draft.comercial?.tempoCampanha || 'Sem duração')}</span>
      </div>
      <div class="button-row">
        <button class="btn btn-primary btn-sm" type="button" id="continueLocalDraftBtn">Continuar</button>
        <button class="btn btn-danger btn-sm" type="button" id="discardLocalDraftBtn">Descartar</button>
      </div>
    </article>
  `;
}

function renderLocalDraftCardCompact() {
  const draft = state.draft;
  return `
    <article class="proposal-card">
      <div class="section-heading section-heading-tight">
        <div>
          <h3>Rascunho</h3>
        </div>
        <span class="pill">Autosave</span>
      </div>
      <div class="meta-row">
        <span>${escapeHtml(draft.cliente?.nomeAnunciante || 'Sem anunciante')}</span>
        <span>${escapeHtml(draft.comercial?.tempoCampanha || 'Sem duração')}</span>
      </div>
      <div class="button-row">
        <button class="btn btn-primary btn-sm" type="button" id="continueLocalDraftBtn">Continuar</button>
        <button class="btn btn-danger btn-sm" type="button" id="discardLocalDraftBtn">Descartar</button>
      </div>
    </article>
  `;
}

function renderProposalCard(proposal) {
  const products = collectProducts(proposal).map(resolveProductLabel);
  const thumb = proposal.uploadDriveUrls?.logo || proposal.uploads?.logo?.previewUrl || '';
  return `
    <article class="proposal-card">
      <div class="proposal-thumb">
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(proposal.cliente?.nomeAnunciante || 'Proposta')}">` : escapeHtml((proposal.cliente?.nomeAnunciante || 'OD').slice(0, 2).toUpperCase())}
      </div>
      <div class="stack" style="gap:10px;">
        <div>
          <h3>${escapeHtml(proposal.cliente?.nomeAnunciante || 'Sem anunciante')}</h3>
          <p class="support-text" style="margin:6px 0 0;">${escapeHtml(proposal.cliente?.nomeEmpresa || 'Empresa não informada')}</p>
        </div>
        <div class="meta-row">
          <span>${escapeHtml(resolveStatusLabel(proposal.status))}</span>
          <span>${escapeHtml(formatDateTime(proposal.updatedAt || proposal.createdAt || new Date().toISOString()))}</span>
        </div>
        <div class="proposal-products">
          ${products.length ? products.slice(0, 3).map((product) => `<span class="chip">${escapeHtml(product)}</span>`).join('') : '<span class="muted">Sem produtos</span>'}
        </div>
      </div>
      <div class="button-row">
        <button class="btn btn-primary btn-sm" type="button" data-open-proposal="${escapeHtml(String(proposal.id || ''))}">Abrir</button>
        <button class="btn btn-secondary btn-sm" type="button" data-open-edit="${escapeHtml(String(proposal.id || ''))}">Editar</button>
      </div>
    </article>
  `;
}

function renderProposalSkeleton() {
  return `
    <article class="proposal-card">
      <div class="proposal-thumb skeleton"></div>
      <div class="skeleton" style="height:18px; border-radius:10px;"></div>
      <div class="skeleton" style="height:14px; width:70%; border-radius:10px;"></div>
      <div class="button-row">
        <div class="skeleton" style="height:42px; flex:1; border-radius:14px;"></div>
        <div class="skeleton" style="height:42px; flex:1; border-radius:14px;"></div>
      </div>
    </article>
  `;
}

function renderDetailLoading() {
  return `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow" style="color: rgba(255,255,255,0.72);">Carregando</p>
        <h1 style="margin:12px 0 10px; font-family:'Sora','Manrope',sans-serif;">Abrindo proposta...</h1>
      </div>
      <div class="detail-card">
        <div class="skeleton" style="height:22px; border-radius:12px;"></div>
        <div class="skeleton" style="height:16px; width:75%; margin-top:14px; border-radius:12px;"></div>
        <div class="skeleton" style="height:16px; width:55%; margin-top:10px; border-radius:12px;"></div>
      </div>
    </section>
  `;
}

function renderDetailRow(label, value) {
  return `
    <div class="detail-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderUploadThumbCard(slotId, upload, driveUrl) {
  const preview = getUploadPreview(upload, driveUrl, slotId);
  return `
    <article class="upload-thumb-card">
      <div class="upload-preview">
        <img src="${escapeHtml(preview?.src || PLACEHOLDERS.planilha)}" alt="${escapeHtml(resolveUploadLabel(slotId))}">
      </div>
      <div class="stack" style="gap:6px; margin-top:10px;">
        <strong style="font-size:0.9rem;">${escapeHtml(resolveUploadLabel(slotId))}</strong>
        <span class="support-text">${escapeHtml(upload?.name || 'Arquivo')}</span>
      </div>
    </article>
  `;
}

function renderUploadCard({ slotId, label, help, upload, previewFallback }) {
  const preview = getUploadPreview(upload, upload?.previewUrl, slotId);
  return `
    <article class="upload-card">
      <div class="upload-preview">
        <img src="${escapeHtml(preview?.src || previewFallback)}" alt="${escapeHtml(label)}">
      </div>
      <div class="upload-meta" style="margin-top:14px;">
        <h3>${escapeHtml(label)}</h3>
        <p>${escapeHtml(help)}</p>
      </div>
      <div class="meta-row" style="margin-top:10px;">
        <span>${upload?.name ? escapeHtml(upload.name) : 'Nenhum arquivo enviado'}</span>
        ${upload?.size ? `<span>${escapeHtml(formatBytes(upload.size))}</span>` : ''}
      </div>
      <div class="button-row" style="margin-top:14px;">
        <button class="btn btn-secondary btn-sm" type="button" data-upload-source="camera" data-upload-slot="${escapeHtml(slotId)}">Câmera</button>
        <button class="btn btn-secondary btn-sm" type="button" data-upload-source="gallery" data-upload-slot="${escapeHtml(slotId)}">Galeria</button>
        <button class="btn btn-secondary btn-sm" type="button" data-upload-source="file" data-upload-slot="${escapeHtml(slotId)}">Arquivo</button>
        ${upload ? `<button class="btn btn-danger btn-sm" type="button" data-upload-remove="${escapeHtml(slotId)}">Remover</button>` : ''}
      </div>
    </article>
  `;
}

function renderBudgetOptionPills() {
  const budgets = state.draft.orcamentos || [];
  if (budgets.length <= 1) return '';
  return `
    <div class="option-pills" style="margin-top:18px;">
      ${budgets.map((budget, index) => {
        const count = (budget.produtosSelecionados || []).length;
        return `
          <button class="option-pill ${index === state.currentOptionIndex ? 'active' : ''}" type="button" data-budget-option="${index}">
            <strong>Opção ${index + 1}</strong>
            <span>${count ? `${count} produto${count > 1 ? 's' : ''}` : 'Sem seleção'}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderOfflineBanner() {
  if (navigator.onLine) return '';
  return `<div class="offline-banner">Você está offline. O rascunho local continua salvo, mas gerar apresentações e sincronizar propostas depende da API.</div>`;
}

function resolveRouteTitle() {
  switch (state.route.name) {
    case 'proposal':
      return {
        title: state.activeProposal?.cliente?.nomeAnunciante || 'Detalhe da proposta',
        subtitle: state.activeProposal?.cliente?.nomeEmpresa || 'Visualização completa'
      };
    case 'settings':
      return { title: 'Integrações', subtitle: 'Google Slides e configuração' };
    case 'wizard':
      return { title: `Etapa ${state.wizardStep + 1} de ${WIZARD_STEPS.length}`, subtitle: WIZARD_STEPS[state.wizardStep] };
    case 'home':
    default:
      return { title: 'Gerador App', subtitle: 'Propostas e geração mobile' };
  }
}

function resolveTopbarTitle() {
  switch (state.route.name) {
    case 'proposal':
      return {
        title: state.activeProposal?.cliente?.nomeAnunciante || 'Proposta',
        subtitle: state.activeProposal?.cliente?.nomeEmpresa || ''
      };
    case 'proposals':
      return { title: 'Gerador App', subtitle: '' };
    case 'settings':
      return { title: 'Google', subtitle: '' };
    case 'wizard':
      return { title: `Etapa ${state.wizardStep + 1}`, subtitle: WIZARD_STEPS[state.wizardStep] };
    case 'home':
    default:
      return { title: 'Gerador App', subtitle: '' };
  }
}

function resolveNavActive(route) {
  if (route === 'wizard') return state.route.name === 'wizard';
  if (route === 'proposals') return state.route.name === 'proposals' || state.route.name === 'proposal';
  return state.route.name === route;
}

function resolveStatusLabel(status) {
  switch (status) {
    case 'completed':
      return 'Concluída';
    case 'slides-ready':
      return 'Slides prontos';
    case 'generated':
      return 'Gerada';
    case 'draft':
    default:
      return 'Rascunho';
  }
}

function resolveStatusTone(status) {
  switch (status) {
    case 'completed':
      return 'success';
    case 'slides-ready':
      return 'warning';
    case 'draft':
    default:
      return 'warning';
  }
}

function resolveUploadLabel(slotId) {
  const labelMap = {
    logo: 'Logo do anunciante',
    'mock-lateral': 'Mock lateral',
    'mock-mapa': 'Mock frontal',
    'mock-traseiro': 'Mock traseiro',
    odim: 'OD IN',
    planilha: 'Planilha'
  };
  if (labelMap[slotId]) return labelMap[slotId];
  if (slotId.startsWith('planilha-')) {
    return `Planilha ${slotId.replace('planilha-', 'opção ')}`;
  }
  return slotId;
}

function getUploadPreview(upload, driveUrl, slotId) {
  if (upload?.dataUrl) return { src: upload.dataUrl };
  if (upload?.previewUrl) return { src: upload.previewUrl };
  if (driveUrl) return { src: driveUrl };
  if (slotId?.startsWith('planilha')) return { src: PLACEHOLDERS.planilha };
  return { src: PLACEHOLDERS[slotId] || '../assets/images/logo-oddrive.png' };
}

function updateSheetPreviewDom() {
  const canvas = document.querySelector(`#sheet-preview-${state.currentOptionIndex}`);
  if (!canvas) return;
  drawSheetCanvas(canvas, state.currentOptionIndex, ensureSheetBuilder(state.currentOptionIndex));
}

function renderSheetDataUrl(optionIndex, builder) {
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 860;
  drawSheetCanvas(canvas, optionIndex, builder);
  return canvas.toDataURL('image/png');
}

function drawSheetCanvas(canvas, optionIndex, builder) {
  const draft = state.draft;
  const budget = draft.orcamentos?.[optionIndex];
  const ctx = canvas.getContext('2d');
  const summary = calculateSheetTotals(builder, draft.comercial?.tempoCampanhaDias || 0);
  const productLabel = (budget?.produtosSelecionados || []).map(resolveProductLabel).join(' + ') || 'Sem produto';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f4f8fb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f5ea8';
  ctx.fillRect(0, 0, canvas.width, 160);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 54px Sora, Manrope, sans-serif';
  ctx.fillText('OD DRIVE', 72, 84);
  ctx.font = '600 30px Manrope, sans-serif';
  ctx.fillText(`Planilha de orçamento • Opção ${optionIndex + 1}`, 72, 128);

  const cardX = 56;
  const cardY = 196;
  const cardWidth = canvas.width - 112;
  const sectionHeight = 186;

  drawCanvasSection(ctx, cardX, cardY, cardWidth, sectionHeight, 'Cliente', [
    ['Anunciante', draft.cliente?.nomeAnunciante || '---'],
    ['Empresa', draft.cliente?.nomeEmpresa || '---'],
    ['Praças', builder.praca || draft.cliente?.pracas || '---'],
    ['Produtos', productLabel]
  ]);

  drawCanvasSection(ctx, cardX, cardY + 214, cardWidth, sectionHeight, 'Campanha', [
    ['Início', draft.comercial?.dataInicio ? formatDate(draft.comercial.dataInicio) : '---'],
    ['Duração', `${draft.comercial?.tempoCampanhaDias || 0} dias`],
    ['Veículos', String(builder.veiculos || draft.comercial?.numeroCarros || 0)],
    ['Pagamento', draft.comercial?.pagamento || '---']
  ]);

  drawCanvasSection(ctx, cardX, cardY + 428, cardWidth, 220, 'Resumo financeiro', [
    ['Valor de tabela', formatCurrency(Number(builder.valorTabela || 0))],
    ['Valor negociado', formatCurrency(Number(builder.valorNegociado || 0))],
    ['Custo de produção', formatCurrency(Number(builder.custoProducao || 0))],
    ['Investimento total', formatCurrency(summary.investimentoTotal)],
    ['Mensal', formatCurrency(summary.valorMensal)],
    ['Desconto', summary.descontoPercentual]
  ], 2);

  ctx.fillStyle = '#102336';
  ctx.font = '700 28px Sora, Manrope, sans-serif';
  ctx.fillText('Observações', cardX, 774);
  ctx.font = '500 24px Manrope, sans-serif';
  wrapCanvasText(ctx, builder.observacoes || 'Sem observações adicionais.', cardX, 814, cardWidth, 34);
}

function drawCanvasSection(ctx, x, y, width, height, title, rows, columns = 1) {
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, width, height, 30);
  ctx.fill();
  ctx.fillStyle = '#102336';
  ctx.font = '700 28px Sora, Manrope, sans-serif';
  ctx.fillText(title, x + 30, y + 42);

  const columnWidth = (width - 60) / columns;
  rows.forEach((row, index) => {
    const column = index % columns;
    const rowIndex = Math.floor(index / columns);
    const offsetX = x + 30 + columnWidth * column;
    const offsetY = y + 86 + rowIndex * 54;
    ctx.fillStyle = '#567085';
    ctx.font = '700 18px Manrope, sans-serif';
    ctx.fillText(row[0].toUpperCase(), offsetX, offsetY);
    ctx.fillStyle = '#102336';
    ctx.font = '600 24px Manrope, sans-serif';
    wrapCanvasText(ctx, row[1], offsetX, offsetY + 30, columnWidth - 20, 28, 2);
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const safeText = String(text || '');
  const words = safeText.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const testLine = current ? `${current} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = testLine;
    }
  });
  if (current) {
    lines.push(current);
  }
  lines.slice(0, maxLines).forEach((line, index) => {
    const isLastVisible = index === maxLines - 1 && lines.length > maxLines;
    const output = isLastVisible ? `${line}...` : line;
    ctx.fillText(output, x, y + index * lineHeight);
  });
}

function calculateSheetTotals(builder, durationDays) {
  const valorTabela = Number(builder.valorTabela || 0);
  const valorNegociado = Number(builder.valorNegociado || 0);
  const custoProducao = Number(builder.custoProducao || 0);
  const investimentoTotal = valorNegociado + custoProducao;
  const months = Math.max(1, Math.ceil(Number(durationDays || 0) / 30));
  const valorMensal = investimentoTotal / months;
  const desconto = valorTabela > 0 ? ((valorTabela - valorNegociado) / valorTabela) * 100 : 0;
  return {
    investimentoTotal,
    valorMensal,
    descontoPercentual: `${desconto.toFixed(1)}%`
  };
}

function collectProducts(proposal) {
  const unique = new Map();
  (proposal.orcamentos || []).forEach((budget) => {
    (budget.produtosSelecionados || []).forEach((product) => {
      const productId = product?.id || product;
      if (productId && !unique.has(productId)) {
        unique.set(productId, product);
      }
    });
  });
  if (!unique.size && Array.isArray(proposal.produtosSelecionados)) {
    proposal.produtosSelecionados.forEach((product) => {
      const productId = product?.id || product;
      if (productId && !unique.has(productId)) {
        unique.set(productId, product);
      }
    });
  }
  return [...unique.values()];
}

function resolveProductLabel(product) {
  if (!product) return 'Produto';
  if (typeof product === 'string') {
    return PRODUCT_CATALOG.find((item) => item.id === product)?.name || product;
  }
  return product.name || PRODUCT_CATALOG.find((item) => item.id === product.id)?.name || product.id || 'Produto';
}

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!hash) return { name: 'home' };
  const [path] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'proposals') return { name: 'proposals' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'wizard') return { name: 'wizard' };
  if (parts[0] === 'proposal' && parts[1]) return { name: 'proposal', id: decodeURIComponent(parts[1]) };
  return { name: 'home' };
}

function navigate(path) {
  updateHash(path, false);
}

function updateHash(path, replace = false) {
  const nextHash = `#/${path.replace(/^#?\/?/, '')}`;
  if (replace) {
    window.history.replaceState(null, '', nextHash);
  } else {
    window.location.hash = nextHash;
  }
  state.route = parseRoute();
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (options.auth !== false && state.session.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }

  const response = await fetch(`${window.API_BASE || ''}/api${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    // sem corpo json
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Erro HTTP ${response.status}`);
  }
  return data;
}

function persistSession() {
  if (state.session.token) {
    localStorage.setItem(STORAGE_KEYS.token, state.session.token);
  }
  if (state.session.user) {
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(state.session.user));
  }
}

function clearSession() {
  state.session.token = '';
  state.session.user = null;
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
}

function createUploadStore(dbName, storeName) {
  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function withStore(mode, executor) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = executor(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    put(key, value) {
      return withStore('readwrite', (store) => store.put(value, key));
    },
    get(key) {
      return withStore('readonly', (store) => store.get(key));
    },
    delete(key) {
      return withStore('readwrite', (store) => store.delete(key));
    },
    clear() {
      return withStore('readwrite', (store) => store.clear());
    }
  };
}

async function openFilePicker(mode = 'gallery') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (mode === 'camera') {
      input.setAttribute('capture', 'environment');
    }
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0] || null;
      document.body.removeChild(input);
      resolve(file);
    }, { once: true });
    input.click();
  });
}

async function buildUploadEntry(file, options = {}) {
  const processed = await fileToDataUrl(file, options);
  const base64 = extractBase64FromDataUrl(processed.dataUrl);
  return {
    name: file.name,
    path: file.name,
    size: base64.length,
    type: processed.type,
    lastModified: file.lastModified,
    data: base64,
    dataUrl: processed.dataUrl,
    previewUrl: processed.dataUrl,
    _cached: true
  };
}

async function fileToDataUrl(file, options = {}) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const needsResize = file.type.startsWith('image/') && file.size > 1.5 * 1024 * 1024;
  if (!needsResize) {
    return {
      dataUrl: originalDataUrl,
      type: file.type || 'image/png'
    };
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = options.maxWidth || 1920;
      const maxHeight = options.maxHeight || 1440;
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      resolve({
        dataUrl: canvas.toDataURL(outputType, outputType === 'image/png' ? 0.92 : 0.84),
        type: outputType
      });
    };
    image.onerror = () => resolve({ dataUrl: originalDataUrl, type: file.type || 'image/png' });
    image.src = originalDataUrl;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function coerceInputValue(input) {
  if (input.type === 'number') {
    return Number(input.value || 0);
  }
  if (input.tagName === 'SELECT' && input.getAttribute('data-field') === 'comercial.qtdOrcamentos') {
    return Number(input.value || 1);
  }
  return input.value;
}

function coerceSheetValue(field, rawValue) {
  if (['veiculos', 'valorTabela', 'valorNegociado', 'custoProducao'].includes(field)) {
    return Number(rawValue || 0);
  }
  return rawValue;
}

function readStorage(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize(value) {
  const text = String(value || '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function prettifyFieldLabel(field) {
  const map = {
    templatePresentationId: 'Template padrão',
    templateOdInId: 'Template OD IN',
    templateOdVtId: 'Template OD VT',
    templateOdDropId: 'Template OD DROP',
    templateOdFullId: 'Template OD FULL',
    templateOdPackId: 'Template OD PACK',
    presentationsFolderId: 'Pasta de apresentações',
    assetsFolderId: 'Pasta de assets'
  };
  return map[field] || field;
}

function resolveGoogleConfigFieldValue(field) {
  const stored = state.googleConfig?.stored || {};
  const effective = state.googleConfig?.effective || {};
  if (Object.prototype.hasOwnProperty.call(stored, field)) {
    return stored[field] || '';
  }
  const nestedProductMap = {
    templateOdInId: effective.templateProductIds?.['od-in'],
    templateOdVtId: effective.templateProductIds?.['od-vt'],
    templateOdDropId: effective.templateProductIds?.['od-drop'],
    templateOdFullId: effective.templateProductIds?.['od-full'],
    templateOdPackId: effective.templateProductIds?.['od-pack']
  };
  return nestedProductMap[field] ?? effective[field] ?? '';
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR');
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('pt-BR');
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function parseTimestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function getInitials(value) {
  return String(value || 'OD')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasMeaningfulDraft(draft) {
  if (!draft) return false;
  return Boolean(
    draft.cliente?.nomeAnunciante ||
    draft.cliente?.nomeEmpresa ||
    draft.comercial?.pagamento ||
    Object.keys(draft.uploads || {}).length ||
    collectProducts(draft).length
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractBase64FromDataUrl(dataUrl) {
  if (!dataUrl || !String(dataUrl).includes(',')) return '';
  return String(dataUrl).split(',')[1] || '';
}

function toast(type, title, message) {
  const stack = ensureToastStack();
  const toastEl = document.createElement('div');
  toastEl.className = `toast ${type}`;
  toastEl.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  stack.appendChild(toastEl);
  window.setTimeout(() => {
    toastEl.remove();
  }, 3800);
}

function ensureToastStack() {
  let stack = document.getElementById('toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function getPlanilhaSlotId(index) {
  return index === 0 && Number(state.draft?.comercial?.qtdOrcamentos || 1) <= 1
    ? 'planilha'
    : `planilha-${index + 1}`;
}
