(() => {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  window.addEventListener('message', event => {
    if (event.data && event.data.type === 'LOGOUT_REQUEST') {
      console.log('[WORKSPACE] Logout solicitado por iframe');
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      window.location.href = '/login.html';
    }
  });

  const apiBase = window.API_BASE || '';

  // Warmup: acorda o backend (Render free tier dorme após inatividade)
  if (apiBase) {
    fetch(apiBase + '/health').catch(() => {});
  }

  /* ═══════════════════════════════════════════════
     CARREGAMENTO CENTRALIZADO — direto da API (MongoDB)
     Dados são lidos do backend a cada carregamento.
     localStorage NÃO é usado para armazenar motoristas/campanhas
     (volume > 11MB excede o limite de 5MB do localStorage).
  ═══════════════════════════════════════════════ */

  /* ── Splash Screen ────────────────── */
  const splashOverlay    = document.getElementById('splashOverlay');
  const splashStepCamp   = document.getElementById('splashStepCampaigns');
  const splashStepDrv    = document.getElementById('splashStepDrivers');
  const splashStepReady  = document.getElementById('splashStepReady');
  const splashProgressBar = document.getElementById('splashProgressBar');
  const splashHint       = document.getElementById('splashHint');

  function setSplashStep(el, state, text) {
    if (!el) return;
    el.classList.remove('active', 'done', 'error');
    if (state) el.classList.add(state);
    if (text) el.querySelector('span:last-child').textContent = text;
  }

  function setSplashProgress(pct) {
    if (splashProgressBar) splashProgressBar.style.width = pct + '%';
  }

  function hideSplash() {
    if (!splashOverlay) return;
    splashOverlay.classList.add('hidden');
    setTimeout(() => { splashOverlay.style.display = 'none'; }, 500);
  }

  function showSplash() {
    if (!splashOverlay) return;
    splashOverlay.style.display = 'flex';
    splashOverlay.classList.remove('hidden');
    setSplashStep(splashStepCamp, '', 'Carregando campanhas...');
    setSplashStep(splashStepDrv, '', 'Carregando motoristas...');
    setSplashStep(splashStepReady, '', 'Preparando workspace...');
    setSplashProgress(0);
    if (splashHint) splashHint.textContent = '';
  }

  async function loadGlobalData(showSplashScreen) {
    if (showSplashScreen) showSplash();

    let campaigns = [];
    let drivers = [];
    let errors = [];

    // Buscar campanhas e motoristas em paralelo
    if (showSplashScreen) {
      setSplashStep(splashStepCamp, 'active');
      setSplashStep(splashStepDrv, 'active');
    }
    setSplashProgress(20);

    const [campResult, drvResult] = await Promise.allSettled([
      fetchJSON('/api/campaigns/summary'),
      fetchJSON('/api/drivers'),
    ]);

    if (campResult.status === 'fulfilled') {
      const r = campResult.value;
      campaigns = Array.isArray(r) ? r : (r?.items || r?.campaigns || []);
      if (showSplashScreen) setSplashStep(splashStepCamp, 'done', campaigns.length + ' campanhas carregadas');
    } else {
      console.error('[Workspace] Erro campanhas:', campResult.reason);
      errors.push('campanhas');
      if (showSplashScreen) setSplashStep(splashStepCamp, 'error', 'Erro ao carregar campanhas');
    }

    if (drvResult.status === 'fulfilled') {
      const items = drvResult.value?.items || drvResult.value?.drivers || [];
      drivers = items.filter(d => d && d.phone).sort((a, b) =>
        String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR')
      );
      if (showSplashScreen) setSplashStep(splashStepDrv, 'done', drivers.length + ' motoristas carregados');
    } else {
      console.error('[Workspace] Erro motoristas:', drvResult.reason);
      errors.push('motoristas');
      if (showSplashScreen) setSplashStep(splashStepDrv, 'error', 'Erro ao carregar motoristas');
    }
    setSplashProgress(80);

    // Step 3: Pronto
    if (showSplashScreen) setSplashStep(splashStepReady, 'active');
    if (!campaigns.length && !drivers.length) {
      console.warn('[Workspace] Nenhum dado retornado (campanhas:', campaigns.length, ', motoristas:', drivers.length, ')');
    }
    setSplashProgress(100);
    if (showSplashScreen) {
      if (errors.length === 0) {
        setSplashStep(splashStepReady, 'done', 'Workspace pronto!');
      } else {
        setSplashStep(splashStepReady, 'error', 'Carregado com ' + errors.length + ' erro(s)');
        if (splashHint) splashHint.textContent = 'Dados parciais carregados. Use "Automação API" para sincronizar.';
      }
      setTimeout(hideSplash, errors.length ? 2000 : 800);
    }

    return { campaigns, drivers, errors };
  }

  const grid = document.getElementById('apps-grid');
  const overviewEl = document.getElementById('workspaceOverview');

  const apps = [
    {
      name: 'Gerenciador de Campanhas',
      description: '',
      backgroundImage: 'assets/images/bg-gerenciador.jpg',
      links: [
        {
          label: 'Abrir gerenciador de campanhas',
          href: '/campanhas/index.html',
          primary: true,
        },
      ],
    },
    {
      name: 'Gerador de Orçamentos',
      description: '',
      backgroundImage: 'assets/images/bg-gerador.jpg',
      links: [
        { label: 'Abrir gerador de orçamentos', href: '/gerador/app/index.html', primary: true },
      ],
    },
    {
      name: 'Solicitações',
      description: '',
      backgroundImage: 'assets/images/bg-novo-modulo.jpg',
      links: [{ label: 'Abrir solicitações', href: '/gerador/representantes/admin.html', primary: true }],
    },
    {
      name: 'Configurações',
      description: '',
      backgroundImage: 'assets/images/bg-novo-modulo.jpg',
      links: [{ label: 'Abrir configurações', href: '/gerador/app/settings/index.html', primary: true }],
    },
  ];

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toCount(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
  }

  function parseTimestamp(value) {
    if (!value) return 0;
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDate(value) {
    const timestamp = parseTimestamp(value);
    if (!timestamp) return '--';
    return new Date(timestamp).toLocaleDateString('pt-BR');
  }

  function buildApiUrl(path) {
    if (String(path || '').startsWith('http')) return path;
    return `${apiBase}${path}`;
  }

  async function fetchJSON(path, options = {}, _retries) {
    if (_retries === undefined) _retries = 3;
    const headers = { ...(options.headers || {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(buildApiUrl(path), { ...options, headers });

      if (response.status === 401) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/login.html';
        throw new Error('Sessão expirada');
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `HTTP ${response.status}`);
      }
      return response.json();
    } catch (err) {
      var isNetworkError = err.message === 'Failed to fetch' || err.message === 'NetworkError when attempting to fetch resource.';
      if (isNetworkError && _retries > 0) {
        await new Promise(r => setTimeout(r, 2000 * (4 - _retries)));
        return fetchJSON(path, options, _retries - 1);
      }
      throw err;
    }
  }

  function getCampaignSummary(campaign) {
    const counts = campaign?.counts || {};
    const agendado = toCount(counts.agendado);
    const confirmado = toCount(counts.confirmado);
    const instalado = toCount(counts.instalado);
    const aguardando = toCount(counts.aguardando);
    const cadastrando = toCount(counts.cadastrando);
    const problema = toCount(counts.problema);
    const review = toCount(counts.revisar || campaign?.reviewCount);
    const totalDrivers = agendado + confirmado + instalado + aguardando + cadastrando + problema + review;
    const pending = review + problema;
    const installedPct = totalDrivers > 0 ? Math.round((instalado / totalDrivers) * 100) : 0;

    return {
      instalado,
      problema,
      review,
      pending,
      totalDrivers,
      installedPct,
    };
  }

  function getCampaignBucket(campaign, summary) {
    const status = String(campaign?.status || '').trim().toLowerCase();
    if (status === 'pausada' || status === 'encerrada' || status === 'inativa') return 'paused';
    if (summary.totalDrivers === 0) return 'attention';

    const pendingRate = summary.totalDrivers > 0 ? summary.pending / summary.totalDrivers : 0;
    if (summary.problema > 0 || summary.review >= 3 || pendingRate >= 0.25) return 'critical';
    if (summary.installedPct >= 70 && summary.pending === 0) return 'ok';
    return 'attention';
  }

  function buildCampaignOverview(campaigns = []) {
    const enriched = campaigns.map(campaign => {
      const summary = getCampaignSummary(campaign);
      return {
        campaign,
        summary,
        bucket: getCampaignBucket(campaign, summary),
      };
    });

    const activeCount = campaigns.filter(c => String(c?.status || '').toLowerCase() === 'ativa').length;
    const criticalEntries = enriched.filter(item => item.bucket === 'critical');
    const attentionEntries = enriched.filter(item => item.bucket === 'attention');
    const okEntries = enriched.filter(item => item.bucket === 'ok');
    const pausedEntries = enriched.filter(item => item.bucket === 'paused');
    const activeEntries = enriched.filter(item => String(item.campaign?.status || '').toLowerCase() === 'ativa');
    const totalPending = enriched.reduce((acc, item) => acc + item.summary.pending, 0);
    const totalInstalled = enriched.reduce((acc, item) => acc + item.summary.instalado, 0);
    const totalDrivers = enriched.reduce((acc, item) => acc + item.summary.totalDrivers, 0);
    const installedAvgPct = totalDrivers > 0 ? Math.round((totalInstalled / totalDrivers) * 100) : 0;
    const healthyRate = campaigns.length > 0 ? Math.round((okEntries.length / campaigns.length) * 100) : 0;

    const topCritical = [...criticalEntries]
      .sort((a, b) => {
        if (b.summary.pending !== a.summary.pending) return b.summary.pending - a.summary.pending;
        if (a.summary.installedPct !== b.summary.installedPct) return a.summary.installedPct - b.summary.installedPct;
        return String(a.campaign?.name || '').localeCompare(String(b.campaign?.name || ''), 'pt-BR');
      })
      .slice(0, 5);

    const pendingEntries = enriched
      .filter(item => item.summary.pending > 0)
      .sort((a, b) => b.summary.pending - a.summary.pending);

    return {
      total: campaigns.length,
      activeCount,
      criticalCount: criticalEntries.length,
      attentionCount: attentionEntries.length,
      okCount: okEntries.length,
      pausedCount: pausedEntries.length,
      totalPending,
      installedAvgPct,
      healthyRate,
      topCritical,
      activeEntries,
      pendingEntries,
      criticalEntries,
      attentionEntries,
      okEntries,
      pausedEntries,
    };
  }

  function isCompletedProposal(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return (
      normalized === 'generated' ||
      normalized === 'completed' ||
      normalized === 'concluido' ||
      normalized === 'concluida' ||
      normalized === 'gerado' ||
      normalized === 'finalizado' ||
      normalized === 'finalizada'
    );
  }

  function getProposalName(proposal) {
    return (
      proposal?.cliente?.nomeAnunciante ||
      proposal?.cliente?.nomeEmpresa ||
      proposal?.nome ||
      proposal?.title ||
      `Proposta ${proposal?.id || ''}`.trim() ||
      'Sem nome'
    );
  }

  function buildProposalOverview(proposals = []) {
    const sorted = [...proposals].sort((a, b) => parseTimestamp(b?.createdAt) - parseTimestamp(a?.createdAt));
    const completedCount = sorted.filter(p => isCompletedProposal(p?.status)).length;
    const draftCount = Math.max(sorted.length - completedCount, 0);
    const completionRate = sorted.length > 0 ? Math.round((completedCount / sorted.length) * 100) : 0;
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const last7DaysCount = sorted.filter(p => {
      const createdAt = parseTimestamp(p?.createdAt);
      return createdAt > 0 && now - createdAt <= sevenDaysMs;
    }).length;

    return {
      total: sorted.length,
      completedCount,
      draftCount,
      completionRate,
      last7DaysCount,
      latest: sorted.slice(0, 8),
      sorted,
    };
  }

  function getCurrentGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function getAdminFirstName() {
    try {
      const raw = localStorage.getItem('adminUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      const name = String(parsed?.name || parsed?.username || '').trim();
      if (!name) return '';
      return name.split(/\s+/)[0];
    } catch (_) {
      return '';
    }
  }

  function updateTopbarGreeting(updatedAt) {
    const el = document.getElementById('topbarGreeting');
    if (!el) return;
    const greeting = getCurrentGreeting();
    const name = getAdminFirstName();
    const nameEl = el.querySelector('.topbar-greeting-name');
    const timeEl = el.querySelector('.topbar-greeting-time');
    if (nameEl) nameEl.textContent = name ? greeting + ', ' + name : greeting;
    if (timeEl) timeEl.textContent = updatedAt ? 'Atualizado às ' + updatedAt : '';
  }

  function formatInteger(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Math.round(num).toLocaleString('pt-BR');
  }

  function getOperationalHealth(campaignOverview) {
    if (campaignOverview.criticalCount > 0) {
      return {
        tone: 'critical',
        label: 'Crítico',
        detail: `${campaignOverview.criticalCount} campanha(s) em nível crítico`,
      };
    }
    if (campaignOverview.attentionCount > 0) {
      return {
        tone: 'attention',
        label: 'Atenção',
        detail: `${campaignOverview.attentionCount} campanha(s) exigem acompanhamento`,
      };
    }
    return {
      tone: 'ok',
      label: 'Estável',
      detail: 'Operação estável nas campanhas',
    };
  }

  function animateCountTargets(scope) {
    if (!scope) return;
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targets = Array.from(scope.querySelectorAll('[data-count-target]'));
    targets.forEach(el => {
      const raw = String(el.getAttribute('data-count-target') || '').trim();
      if (!raw) return;
      const hasPct = raw.endsWith('%');
      const numeric = Number(raw.replace('%', '').replace(',', '.'));
      if (!Number.isFinite(numeric)) {
        el.textContent = raw;
        return;
      }
      if (prefersReduced) {
        el.textContent = hasPct ? `${Math.round(numeric)}%` : formatInteger(numeric);
        return;
      }

      const duration = 520;
      const start = performance.now();
      const initial = 0;
      const end = numeric;

      const step = now => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = initial + (end - initial) * eased;
        const rounded = Math.round(value);
        el.textContent = hasPct ? `${rounded}%` : formatInteger(rounded);
        if (progress < 1) {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }

  function renderOverviewLoading() {
    if (!overviewEl) return;
    updateTopbarGreeting();
    overviewEl.innerHTML = `
      <div class="overview-panels">
        <section class="overview-panel is-loading">
          <div class="skeleton skeleton-line md"></div>
          <div class="skeleton-grid">
            <div class="skeleton skeleton-box"></div>
            <div class="skeleton skeleton-box"></div>
            <div class="skeleton skeleton-box"></div>
            <div class="skeleton skeleton-box"></div>
          </div>
          <div class="skeleton skeleton-list"></div>
        </section>
        <section class="overview-panel is-loading">
          <div class="skeleton skeleton-line md"></div>
          <div class="skeleton-grid">
            <div class="skeleton skeleton-box"></div>
            <div class="skeleton skeleton-box"></div>
            <div class="skeleton skeleton-box"></div>
            <div class="skeleton skeleton-box"></div>
          </div>
          <div class="skeleton skeleton-list"></div>
        </section>
      </div>
    `;
  }

  function renderOverviewError(error) {
    if (!overviewEl) return;
    console.error('[WORKSPACE] Erro ao carregar painel:', error);
    updateTopbarGreeting();
    overviewEl.innerHTML = `
      <section class="overview-panel">
        <div class="overview-panel-head">
          <h2 class="overview-title">Sem dados para exibir</h2>
        </div>
        <p class="overview-empty">Verifique a conexão com o backend e atualize novamente.</p>
      </section>
    `;
  }

  function renderOverview(campaignOverview, proposalOverview) {
    if (!overviewEl) return;

    const updatedAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const greeting = getCurrentGreeting();
    const adminName = getAdminFirstName();
    const health = getOperationalHealth(campaignOverview);
    const riskToneClass = `tone-${health.tone}`;
    const riskText = health.detail;

    const campaignDistribution = [
      { label: 'Críticas', value: campaignOverview.criticalCount, tone: 'critical' },
      { label: 'Atenção', value: campaignOverview.attentionCount, tone: 'attention' },
      { label: 'Estáveis', value: campaignOverview.okCount, tone: 'ok' },
      { label: 'Pausadas', value: campaignOverview.pausedCount, tone: 'paused' },
    ]
      .map(item => `
        <article class="status-block tone-${item.tone}" data-tooltip="${escapeHTML(`${item.label}: ${item.value} campanha(s)`)}">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </article>
      `)
      .join('');

    const criticalItemsHtml = campaignOverview.topCritical.length
      ? campaignOverview.topCritical.map(item => `
          <li class="overview-list-item overview-list-item-issue">
            <div class="overview-list-main">
              <div class="overview-issue-head">
                <span class="overview-issue-badge">Crítica</span>
                <strong title="${escapeHTML(item.campaign?.name || 'Campanha sem nome')}">${escapeHTML(item.campaign?.name || 'Campanha sem nome')}</strong>
              </div>
              <small>${item.summary.pending} pendência(s) · instalação ${item.summary.installedPct}%</small>
              <div class="overview-issue-meter"><i style="width:${Math.max(0, Math.min(100, item.summary.installedPct))}%"></i></div>
            </div>
            <button type="button" class="btn secondary btn-mini" data-action="open-campaign" data-id="${escapeHTML(item.campaign?.id || '')}">Abrir</button>
          </li>
        `).join('')
      : `<li class="overview-list-item is-empty"><span>Nenhuma campanha crítica no momento.</span></li>`;

    const proposalItemsHtml = proposalOverview.latest.length
      ? proposalOverview.latest.map(proposal => {
        const completed = isCompletedProposal(proposal?.status);
        return `
            <li class="overview-list-item">
              <div class="overview-list-main">
                <strong title="${escapeHTML(getProposalName(proposal))}">${escapeHTML(getProposalName(proposal))}</strong>
                <small>${formatDate(proposal?.createdAt)}</small>
              </div>
              <span class="status-pill ${completed ? 'is-success' : 'is-warn'}">${completed ? 'Concluído' : 'Rascunho'}</span>
            </li>
          `;
      }).join('')
      : '';

    const activeNames = campaignOverview.activeEntries
      .slice(0, 5)
      .map(item => String(item.campaign?.name || '').trim())
      .filter(Boolean)
      .join(', ');
    const criticalNames = campaignOverview.criticalEntries
      .slice(0, 5)
      .map(item => String(item.campaign?.name || '').trim())
      .filter(Boolean)
      .join(', ');
    const pendingNames = campaignOverview.pendingEntries
      .slice(0, 5)
      .map(item => `${String(item.campaign?.name || 'Sem nome').trim()} (${item.summary.pending})`)
      .join(', ');
    const latestProposalNames = proposalOverview.latest
      .slice(0, 5)
      .map(item => getProposalName(item))
      .join(', ');
    const completedProposalNames = proposalOverview.sorted
      .filter(item => isCompletedProposal(item?.status))
      .slice(0, 5)
      .map(item => getProposalName(item))
      .join(', ');
    const draftProposalNames = proposalOverview.sorted
      .filter(item => !isCompletedProposal(item?.status))
      .slice(0, 5)
      .map(item => getProposalName(item))
      .join(', ');

    const campaignsActiveTooltip = `${campaignOverview.activeCount} campanha(s) ativa(s). ${activeNames ? `Ex.: ${activeNames}` : 'Sem campanhas ativas.'}`;
    const campaignsCriticalTooltip = `${campaignOverview.criticalCount} campanha(s) crítica(s). ${criticalNames ? `Ex.: ${criticalNames}` : 'Sem campanhas críticas.'}`;
    const campaignsPendingTooltip = `${campaignOverview.totalPending} pendência(s). ${pendingNames ? `Pendências por campanha: ${pendingNames}` : 'Sem pendências no momento.'}`;
    const campaignsInstalledTooltip = `Instalação média de ${campaignOverview.installedAvgPct}% nas campanhas monitoradas.`;
    const proposalsTotalTooltip = `${proposalOverview.total} orçamento(s). ${latestProposalNames ? `Últimos: ${latestProposalNames}` : 'Nenhum orçamento registrado.'}`;
    const proposalsCompletedTooltip = `${proposalOverview.completedCount} concluído(s). ${completedProposalNames ? `Ex.: ${completedProposalNames}` : 'Nenhum concluído.'}`;
    const proposalsDraftTooltip = `${proposalOverview.draftCount} rascunho(s). ${draftProposalNames ? `Ex.: ${draftProposalNames}` : 'Nenhum rascunho.'}`;
    const proposalsRateTooltip = `Taxa de conclusão: ${proposalOverview.completionRate}% (${proposalOverview.completedCount}/${proposalOverview.total || 0}).`;

    const proposalsBodyHtml = proposalOverview.total > 0
      ? `<ul class="overview-list">${proposalItemsHtml}</ul>`
      : `
        <div class="overview-empty-cta">
          <div class="overview-empty-cta-main">
            <strong>Nenhum orçamento cadastrado</strong>
            <span>Comece criando o primeiro orçamento para liberar os indicadores desta área.</span>
          </div>
          <button type="button" class="btn primary btn-mini" data-action="open-gerador">Criar primeiro orçamento</button>
        </div>
      `;

    updateTopbarGreeting(updatedAt);

    overviewEl.innerHTML = `
      <div id="customWidgetsHost" class="overview-custom-widgets-host"></div>

      <div class="overview-panels">
        <section class="overview-panel" id="campanhasPanel">
          <div class="overview-panel-head">
            <h2 class="overview-title">Campanhas</h2>
            <div style="display:flex;gap:8px;align-items:center;">
              <button type="button" class="btn secondary btn-mini" id="btnExportarDados" data-action="exportar-dados">Exportar dados</button>
              <button type="button" class="btn secondary btn-mini" data-action="open-campaigns">Abrir gerenciador</button>
            </div>
          </div>

          <div class="campanhas-action-stats" data-tooltip="${escapeHTML(`${campaignOverview.activeCount} ativas · ${campaignOverview.criticalCount} críticas · instalação média ${campaignOverview.installedAvgPct}%`)}">
            <span><strong>${campaignOverview.activeCount}</strong> ativas</span>
            <span class="dot">·</span>
            <span class="warn"><strong>${campaignOverview.criticalCount}</strong> críticas</span>
            <span class="dot">·</span>
            <span><strong>${campaignOverview.installedAvgPct}%</strong> instalação</span>
          </div>

          <div class="campanhas-action-columns" id="campanhasColumns">
            ${renderActionColumnsSkeleton()}
          </div>
        </section>

        <section class="overview-panel overview-panel--targets" id="targetsPanel">
          <div class="overview-panel-head">
            <h2 class="overview-title">Metas de motoristas</h2>
            <button type="button" class="btn secondary btn-mini" data-action="open-campaigns">Ver campanhas</button>
          </div>
          <div id="targetsSection" class="overview-targets-wrap">
            <div class="overview-notif-loading">
              <div class="skeleton skeleton-line lg"></div>
              <div class="skeleton skeleton-line lg"></div>
              <div class="skeleton skeleton-line md"></div>
            </div>
          </div>
        </section>
      </div>

      <div class="overview-bottom-panels">
        <section class="overview-notif-section" id="notifSection">
          <div class="overview-notif-header">
            <span class="overview-notif-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            </span>
            <h2 class="overview-title">Imagens recebidas</h2>
            <span class="overview-notif-badge" id="notifBadge" style="display:none"></span>
          </div>
          <div id="notifContent" class="overview-notif-list">
            <div class="overview-notif-loading">
              <div class="skeleton skeleton-line lg"></div>
              <div class="skeleton skeleton-line lg"></div>
              <div class="skeleton skeleton-line md"></div>
            </div>
          </div>
        </section>

        <section class="overview-bookings-section" id="bookingsSection">
          <div class="overview-bookings-header">
            <span class="overview-bookings-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            <h2 class="overview-title">Reservas de adesivagem</h2>
          </div>
          <div id="bookingsContent" class="overview-bookings-list">
            <div class="overview-notif-loading">
              <div class="skeleton skeleton-line lg"></div>
              <div class="skeleton skeleton-line lg"></div>
              <div class="skeleton skeleton-line md"></div>
            </div>
          </div>
        </section>

        <section class="overview-proposals-section" id="proposalsSection">
          <div class="overview-proposals-header">
            <span class="overview-proposals-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </span>
            <h2 class="overview-title">Orçamentos</h2>
            <button type="button" class="btn secondary btn-mini overview-proposals-btn" data-action="open-gerador">Abrir gerador</button>
          </div>

          <div class="overview-kpis">
            <div class="kpi-tooltip-wrap" data-tooltip="${escapeHTML(proposalsTotalTooltip)}">
              <article class="kpi-card">
                <span>Total</span>
                <strong>${proposalOverview.total}</strong>
              </article>
            </div>
            <div class="kpi-tooltip-wrap" data-tooltip="${escapeHTML(proposalsCompletedTooltip)}">
              <article class="kpi-card kpi-ok">
                <span>Concluídos</span>
                <strong>${proposalOverview.completedCount}</strong>
              </article>
            </div>
            <div class="kpi-tooltip-wrap" data-tooltip="${escapeHTML(proposalsDraftTooltip)}">
              <article class="kpi-card kpi-attention">
                <span>Rascunhos</span>
                <strong>${proposalOverview.draftCount}</strong>
              </article>
            </div>
            <div class="kpi-tooltip-wrap" data-tooltip="${escapeHTML(proposalsRateTooltip)}">
              <article class="kpi-card">
                <span>Taxa de conclusão</span>
                <strong>${proposalOverview.completionRate}%</strong>
                <div class="kpi-meter"><i style="width:${Math.max(0, Math.min(100, proposalOverview.completionRate))}%"></i></div>
              </article>
            </div>
          </div>

          <div class="overview-list-wrap">
            <div class="overview-list-head">
              <h3>Últimos orçamentos (7 dias: ${proposalOverview.last7DaysCount})</h3>
            </div>
            ${proposalsBodyHtml}
          </div>
        </section>
      </div>
    `;

    animateCountTargets(overviewEl);
    // Carregar notificações e reservas de forma independente (não bloqueia o overview)
    loadNotifications();
    loadRecentBookings();
    loadCampanhasActionColumns();
    loadCampaignTargets();
    syncTargetsPanelHeight();
    initOverviewDnD();
    initOverviewCustomWidgets();
  }

  // ── Custom widgets (gráficos personalizados) ───────────────────────────
  function initOverviewCustomWidgets() {
    const host = document.getElementById('customWidgetsHost');
    if (!host || !window.CustomWidgets) return;
    window.CustomWidgets.init({
      context: 'overview',
      container: host,
      addBtnEl: document.getElementById('btnAddWidgetHome'),
      // Os dados são buscados pelo módulo se não houver fonte local
    });
  }

  // Sincroniza altura do painel "Metas de motoristas" com o painel "Campanhas"
  let targetsPanelObserver = null;
  function syncTargetsPanelHeight() {
    const src = document.getElementById('campanhasPanel');
    const dst = document.getElementById('targetsPanel');
    if (!src || !dst) return;
    const apply = () => {
      dst.style.height = src.offsetHeight + 'px';
    };
    apply();
    if (targetsPanelObserver) targetsPanelObserver.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      targetsPanelObserver = new ResizeObserver(apply);
      targetsPanelObserver.observe(src);
    } else {
      window.addEventListener('resize', apply);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  EXPORTAR DADOS — gera .xlsx com dados operacionais das campanhas
  // ══════════════════════════════════════════════════════════════════

  async function exportarDadosExcel() {
    const btn = document.getElementById('btnExportarDados');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }

    try {
      // Carrega SheetJS dinamicamente
      await loadSheetJS();

      const [lowKmData, noBookingData, targetsData] = await Promise.all([
        fetchJSON('/api/overview/drivers-low-km?limit=500'),
        fetchJSON('/api/overview/drivers-without-booking?limit=500'),
        fetchJSON('/api/overview/campaign-targets'),
      ]);

      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();

      // ── Aba 1: Metas de Campanhas ──────────────────────────────
      const targetsItems = Array.isArray(targetsData?.items) ? targetsData.items : [];
      const targetsRows = [
        ['Campanha', 'Meta', 'Cadastrados', 'Falta Captar', 'Instalados', 'Falta Instalar'],
        ...targetsItems.map(it => [
          it.campaignName || '',
          it.meta > 0 ? it.meta : '',
          it.total ?? '',
          it.faltaCaptar ?? '',
          it.instalados ?? '',
          it.faltaInstalar ?? '',
        ]),
      ];
      const wsTargets = XLSX.utils.aoa_to_sheet(targetsRows);
      wsTargets['!cols'] = [{ wch: 36 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsTargets, 'Metas de Campanhas');

      // ── Aba 2: KM Baixa ────────────────────────────────────────
      const lowKmItems = Array.isArray(lowKmData?.items) ? lowKmData.items : [];
      const lowKmRows = [
        ['Motorista', 'Campanha', 'Cidade', 'KM Atual', 'KM Mínimo', '% da Meta', 'Déficit KM'],
        ...lowKmItems.map(it => [
          it.name || '',
          it.campaignName || '',
          it.city || '',
          it.km ?? '',
          it.kmMinimum ?? '',
          it.kmPct != null ? `${it.kmPct}%` : '',
          it.kmDeficit ?? '',
        ]),
      ];
      const wsLowKm = XLSX.utils.aoa_to_sheet(lowKmRows);
      wsLowKm['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsLowKm, 'KM Baixa');

      // ── Aba 3: Sem Reserva de Adesivagem ───────────────────────
      const noBookingItems = Array.isArray(noBookingData?.items) ? noBookingData.items : [];
      const noBookingRows = [
        ['Motorista', 'Campanha', 'Cidade', 'Status', 'Dias na Campanha'],
        ...noBookingItems.map(it => [
          it.name || '',
          it.campaignName || '',
          it.city || '',
          it.status || '',
          it.daysInCampaign ?? '',
        ]),
      ];
      const wsNoBooking = XLSX.utils.aoa_to_sheet(noBookingRows);
      wsNoBooking['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 20 }, { wch: 14 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsNoBooking, 'Sem Reserva de Adesivagem');

      // ── Download ───────────────────────────────────────────────
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `oddrive_operacional_${date}.xlsx`);
    } catch (err) {
      console.error('[exportarDados]', err);
      alert('Não foi possível gerar a planilha. Tente novamente.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Exportar dados'; }
    }
  }

  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Falha ao carregar SheetJS'));
      document.head.appendChild(s);
    });
  }

  let overviewRequestId = 0;

  /* ── Notificações de imagens ─────────────────────────────── */
  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 2) return 'agora mesmo';
    if (m < 60) return `há ${m} min`;
    if (h < 24) return `há ${h}h`;
    if (d === 1) return 'ontem';
    return `há ${d} dias`;
  }

  function renderNotifications() {
    const notifContent = document.getElementById('notifContent');
    const notifBadge = document.getElementById('notifBadge');
    if (!notifContent) return;

    const raw = (() => {
      try { return JSON.parse(localStorage.getItem('oddrive:notifications') || '{}'); } catch { return {}; }
    })();
    const items = raw.notifications || [];
    const pending = items.filter(n => n.requiresVerification !== false && !n.verified);

    if (notifBadge) {
      if (pending.length > 0) {
        notifBadge.textContent = pending.length;
        notifBadge.style.display = '';
      } else {
        notifBadge.style.display = 'none';
      }
    }

    if (!items.length) {
      notifContent.innerHTML = '<p class="overview-notif-empty">Nenhum envio de imagem nos últimos 30 dias.</p>';
      return;
    }

    const rows = items.map(n => {
      const isFlowItem = n.type === 'od-flow-studio';
      const typeLabel = isFlowItem ? 'OD Flow' : (n.type === 'graphic' ? 'Gráfica' : 'Motorista');
      const typeClass = isFlowItem ? 'notif-type-flow' : (n.type === 'graphic' ? 'notif-type-graphic' : 'notif-type-driver');
      const verifiedBadge = n.requiresVerification === false
        ? '<span class="notif-verified-badge">Mídia do fluxo</span>'
        : (n.verified
          ? `<span class="notif-verified-badge">✓ Verificado${n.verifiedByName ? ' por ' + escapeHTML(n.verifiedByName) : ''}</span>`
          : '<span class="notif-pending-badge">Aguardando verificação</span>');
      const photoLabel = isFlowItem
        ? (n.uploadCount === 1 ? '1 mídia enviada' : `${n.uploadCount} mídias enviadas`)
        : (n.uploadCount === 1 ? '1 foto enviada' : `${n.uploadCount} fotos enviadas`);
      const actionKind = n.actionKind || 'open-campaign';
      const actionId = String(n.actionId || (actionKind === 'open-campaign' ? n.campaignId || '' : n.templateId || ''));
      const actionLabel = n.actionLabel || 'Ver agora';
      const actionTitle = actionKind === 'open-od-flow'
        ? (n.templateId ? 'Abrir OD Flow Studio neste template' : 'Abrir OD Flow Studio')
        : 'Abrir campanha e verificar fotos';
      const tabAttr = actionKind === 'open-campaign' ? ' data-tab="acompanhe"' : '';

      return `
        <div class="overview-notif-item${n.verified ? ' is-verified' : ''}">
          <span class="notif-type-badge ${typeClass}">${typeLabel}</span>
          <div class="notif-info">
            <strong class="notif-driver-name">${escapeHTML(n.driverName)}</strong>
            <span class="notif-campaign-name">${escapeHTML(n.campaignName)}</span>
          </div>
          <div class="notif-meta">
            <span class="notif-count">${photoLabel}</span>
            <span class="notif-time">${timeAgo(n.lastUploadAt)}</span>
          </div>
          <div class="notif-status">${verifiedBadge}</div>
          <button type="button" class="btn secondary btn-mini notif-action-btn"
            data-action="${escapeHTML(actionKind)}"
            data-id="${escapeHTML(actionId)}"${tabAttr}
            title="${escapeHTML(actionTitle)}">${escapeHTML(actionLabel)}</button>
        </div>`;
    }).join('');

    notifContent.innerHTML = rows;
  }

  async function loadNotifications() {
    try {
      const data = await fetchJSON('/api/notifications');
      if (data && Array.isArray(data.notifications)) {
        try {
          localStorage.setItem('oddrive:notifications', JSON.stringify(data));
        } catch (_) {}
        renderNotifications();
      }
    } catch (err) {
      console.warn('[Workspace] Notificações indisponíveis:', err.message);
      // Tentar usar cache local
      const cached = (() => {
        try { return JSON.parse(localStorage.getItem('oddrive:notifications') || 'null'); } catch { return null; }
      })();
      if (cached) {
        renderNotifications();
      } else {
        const notifContent = document.getElementById('notifContent');
        if (notifContent) notifContent.innerHTML = '<p class="overview-notif-empty">Não foi possível carregar notificações.</p>';
      }
    }
  }

  /* ── Reservas recentes de adesivagem ─────────────────────── */
  function renderRecentBookings() {
    const container = document.getElementById('bookingsContent');
    if (!container) return;

    const raw = (() => {
      try { return JSON.parse(localStorage.getItem('oddrive:recentBookings') || '{}'); } catch { return {}; }
    })();
    const items = raw.bookings || [];

    if (!items.length) {
      container.innerHTML = '<p class="overview-notif-empty">Nenhuma reserva de adesivagem registrada.</p>';
      return;
    }

    const rows = items.map(b => {
      const typeLabel = b.type === 'installation' ? 'Instalação' : 'Retirada';
      const typeClass = b.type === 'installation' ? 'booking-type-install' : 'booking-type-removal';

      return `
        <div class="overview-booking-item">
          <span class="booking-type-badge ${typeClass}">${typeLabel}</span>
          <div class="booking-info">
            <strong class="booking-driver-name">${escapeHTML(b.driverName)}</strong>
            <span class="booking-campaign-name">${escapeHTML(b.campaignName)}</span>
          </div>
          <div class="booking-schedule">
            <span class="booking-date">${escapeHTML(b.dateBR)}</span>
            <span class="booking-time">${escapeHTML(b.startTime)} – ${escapeHTML(b.endTime)}</span>
          </div>
          <div class="booking-graphic">
            <span class="booking-graphic-name">${escapeHTML(b.graphicName)}</span>
          </div>
          <button type="button" class="btn secondary btn-mini booking-action-btn"
            data-action="open-campaign"
            data-id="${escapeHTML(b.campaignId)}"
            title="Abrir campanha">Ver campanha</button>
        </div>`;
    }).join('');

    container.innerHTML = rows;
  }

  async function loadRecentBookings() {
    try {
      const data = await fetchJSON('/api/scheduling/overview/recent-bookings');
      if (data && Array.isArray(data.bookings)) {
        try {
          localStorage.setItem('oddrive:recentBookings', JSON.stringify(data));
        } catch (_) {}
        renderRecentBookings();
      }
    } catch (err) {
      console.warn('[Workspace] Reservas recentes indisponíveis:', err.message);
      const cached = (() => {
        try { return JSON.parse(localStorage.getItem('oddrive:recentBookings') || 'null'); } catch { return null; }
      })();
      if (cached) {
        renderRecentBookings();
      } else {
        const container = document.getElementById('bookingsContent');
        if (container) container.innerHTML = '<p class="overview-notif-empty">Não foi possível carregar reservas.</p>';
      }
    }
  }

  /* ── localStorage cache removido (dados grandes demais) ── */
  function saveOverviewToStorage() { /* noop */ }
  function loadOverviewFromStorage() { return null; }

  // ══════════════════════════════════════════════════════════════════
  //  CAMPANHAS — Ações em 3 colunas (KM baixa / Sem reserva / Aceitaram convite)
  // ══════════════════════════════════════════════════════════════════

  function formatKm(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    if (Number.isInteger(n)) return String(n);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  const ACTION_COLUMNS = [
    {
      id: 'low-km',
      title: 'KM baixa',
      hint: 'Motoristas em campanha ativa que estão rodando abaixo do KM mínimo exigido pela campanha. Esses motoristas precisam de atenção imediata para não comprometer o resultado — entre em contato e incentive-os a aumentar a quilometragem.',
      endpoint: '/api/overview/drivers-low-km',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22V8"/><path d="M5 15l7-7 7 7"/></svg>',
      tone: 'attention',
      metric: it => `${formatKm(it.km)}/${formatKm(it.kmMinimum)} km · <strong>${it.kmPct}%</strong>`,
      contextField: 'campaignName',
      enableBulk: true,
    },
    {
      id: 'no-booking',
      title: 'Sem reserva',
      hint: 'Motoristas já aprovados em campanha ativa que ainda não agendaram a instalação da adesivagem. Cada dia sem reserva é um dia de veículo parado sem anunciar — entre em contato e oriente-os a reservar pelo app do motorista.',
      endpoint: '/api/overview/drivers-without-booking',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      tone: 'warn',
      metric: it => it.daysInCampaign != null ? `<strong>${it.daysInCampaign}</strong>d sem agendar` : 'Sem agendamento',
      contextField: 'campaignName',
      enableBulk: true,
    },
    {
      id: 'accepted-invite',
      title: 'Aceitaram convite',
      hint: 'Motoristas que já aceitaram o convite da plataforma (optIn ativado) mas ainda não foram vinculados a nenhuma campanha ativa. São leads quentes prontos para serem aproveitados — avalie incluí-los em campanhas com vagas disponíveis.',
      endpoint: '/api/overview/drivers-accepted-invite',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
      tone: 'ok',
      metric: it => it.optInDays != null ? `Aceitou há <strong>${it.optInDays}</strong>d` : 'Aceitou convite',
      contextField: 'city',
      enableBulk: false, // contatos sem driverId ainda não suportados pelo bulk
    },
  ];

  const actionColumnsState = {
    data: { 'low-km': null, 'no-booking': null, 'accepted-invite': null },
    selected: { 'low-km': new Set(), 'no-booking': new Set(), 'accepted-invite': new Set() },
    filterCampaignId: { 'low-km': '', 'no-booking': '' },
    templates: null,
  };

  function renderActionColumnsSkeleton() {
    return ACTION_COLUMNS.map(col => `
      <article class="action-column" data-col="${col.id}">
        <header class="action-col-header">
          <span class="action-col-icon tone-${col.tone}">${col.icon}</span>
          <div class="action-col-titles">
            <h3>${col.title}</h3>
          </div>
          <button type="button" class="action-col-info" aria-label="Sobre ${col.title}" data-tooltip="${col.hint.replace(/"/g, '&quot;')}">ⓘ</button>
          <span class="action-col-count" data-loading>—</span>
        </header>
        <div class="action-col-list">
          <div class="overview-notif-loading">
            <div class="skeleton skeleton-line lg"></div>
            <div class="skeleton skeleton-line lg"></div>
            <div class="skeleton skeleton-line md"></div>
          </div>
        </div>
        <footer class="action-col-footer">
          <span class="muted">Carregando…</span>
        </footer>
      </article>
    `).join('');
  }

  async function loadCampanhasActionColumns() {
    const root = document.getElementById('campanhasColumns');
    if (!root) return;

    const results = await Promise.allSettled(
      ACTION_COLUMNS.map(c => fetchJSON(c.endpoint))
    );

    ACTION_COLUMNS.forEach((col, idx) => {
      const r = results[idx];
      if (r.status === 'fulfilled') {
        actionColumnsState.data[col.id] = r.value;
      } else {
        console.warn(`[Workspace] Falha ${col.endpoint}:`, r.reason?.message);
        actionColumnsState.data[col.id] = { items: [], total: 0, error: true };
      }
      actionColumnsState.selected[col.id] = new Set();
    });

    renderActionColumns();
    bindActionColumnEvents(root);
  }

  async function loadCampaignTargets() {
    const wrap = document.getElementById('targetsSection');
    if (!wrap) return;
    try {
      const data = await fetchJSON('/api/overview/campaign-targets');
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        wrap.innerHTML = '<p class="overview-targets-empty">Nenhuma campanha ativa com dados de motoristas.</p>';
        return;
      }
      const _totalMeta = items.reduce((s, it) => s + (it.meta > 0 ? it.meta : 0), 0);
      const _totalCad  = items.reduce((s, it) => s + (it.total || 0), 0);
      const _allFCNull = items.every(it => it.faltaCaptar === null);
      const _totalFC   = items.reduce((s, it) => s + (it.faltaCaptar !== null ? it.faltaCaptar : 0), 0);
      const _totalInst = items.reduce((s, it) => s + (it.instalados || 0), 0);
      const _totalFI   = items.reduce((s, it) => s + (it.faltaInstalar || 0), 0);
      wrap.innerHTML = `
        <table class="overview-targets-table">
          <thead>
            <tr>
              <th>Campanha</th>
              <th class="num">Meta</th>
              <th class="num">Cadastrados</th>
              <th class="num">Falta Captar</th>
              <th class="num">Instalados</th>
              <th class="num">Falta Instalar</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(it => {
              const faltaInstalarClass = it.faltaInstalar > 10 ? 'targets-urgent' : it.faltaInstalar > 0 ? 'targets-warn' : 'targets-ok';
              const faltaCaptarText = it.faltaCaptar === null ? '—' : it.faltaCaptar;
              const faltaCaptarClass = it.faltaCaptar === null ? '' : it.faltaCaptar > 5 ? 'targets-urgent' : it.faltaCaptar > 0 ? 'targets-warn' : 'targets-ok';
              const metaText = it.meta > 0 ? it.meta : '—';
              return `<tr>
                <td class="targets-name" title="${escapeHTML(it.campaignName)}">${escapeHTML(it.campaignName)}</td>
                <td class="num">${metaText}</td>
                <td class="num">${it.total}</td>
                <td class="num ${faltaCaptarClass}">${faltaCaptarText}</td>
                <td class="num">${it.instalados}</td>
                <td class="num ${faltaInstalarClass}">${it.faltaInstalar}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="targets-total-row">
              <td class="targets-name targets-total-label">Total</td>
              <td class="num targets-total">${_totalMeta > 0 ? _totalMeta : '—'}</td>
              <td class="num targets-total">${_totalCad}</td>
              <td class="num targets-total">${_allFCNull ? '—' : _totalFC}</td>
              <td class="num targets-total">${_totalInst}</td>
              <td class="num targets-total">${_totalFI}</td>
            </tr>
          </tfoot>
        </table>
      `;
    } catch (err) {
      console.warn('[Workspace] loadCampaignTargets:', err?.message);
      wrap.innerHTML = '<p class="overview-targets-empty">Falha ao carregar metas.</p>';
    }
  }

  function renderActionColumns() {
    const root = document.getElementById('campanhasColumns');
    if (!root) return;

    root.innerHTML = ACTION_COLUMNS.map(col => renderActionColumn(col)).join('');
  }

  function renderActionColumn(col) {
    const data = actionColumnsState.data[col.id] || { items: [], total: 0 };
    const items = Array.isArray(data.items) ? data.items : [];
    const selected = actionColumnsState.selected[col.id];
    const filterCampaignId = actionColumnsState.filterCampaignId[col.id] || '';
    const visible = filterCampaignId
      ? items.filter(it => it.campaignId === filterCampaignId)
      : items;

    const filterHtml = (col.id === 'low-km' || col.id === 'no-booking') && Array.isArray(data.campaignOptions) && data.campaignOptions.length > 1
      ? `
        <select class="action-col-filter" data-col-filter="${col.id}" aria-label="Filtrar por campanha">
          <option value="">Todas as campanhas</option>
          ${data.campaignOptions.map(c => `<option value="${escapeHTML(c.id)}" ${c.id === filterCampaignId ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
        </select>
      `
      : '';

    const errorBanner = data.error ? `<div class="action-col-error">Falha ao carregar.</div>` : '';

    const listHtml = visible.length
      ? visible.slice(0, 50).map(it => renderActionColumnItem(col, it, selected)).join('')
      : `<div class="action-col-empty">${data.error ? 'Sem dados disponíveis.' : 'Nada por aqui — tudo em ordem.'}</div>`;

    const selectedCount = [...selected].filter(id => visible.some(it => (it.driverId || it.contactId) === id)).length;
    const allSelectableIds = visible.map(it => it.driverId || it.contactId).filter(Boolean);
    const allSelected = allSelectableIds.length > 0 && allSelectableIds.every(id => selected.has(id));

    const actionBarHtml = col.enableBulk
      ? `
        <div class="action-col-actionbar">
          <label class="action-col-checkall" title="${allSelected ? 'Desmarcar todos' : 'Selecionar todos'}">
            <input type="checkbox" data-col-checkall="${col.id}" ${allSelected ? 'checked' : ''} ${visible.length === 0 ? 'disabled' : ''} />
            <span>${selectedCount > 0 ? `${selectedCount} de ${visible.length}` : `Selecionar todos (${visible.length})`}</span>
          </label>
          <button type="button" class="btn primary btn-mini action-col-bulkbtn" data-col-bulk="${col.id}" ${selectedCount === 0 ? 'disabled' : ''}>
            Disparar${selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
        </div>
      `
      : '';

    return `
      <article class="action-column" data-col="${col.id}">
        <header class="action-col-header">
          <span class="action-col-icon tone-${col.tone}">${col.icon}</span>
          <div class="action-col-titles">
            <h3>${col.title}</h3>
          </div>
          <button type="button" class="action-col-info" aria-label="Sobre ${col.title}" data-tooltip="${col.hint.replace(/"/g, '&quot;')}">ⓘ</button>
          <span class="action-col-count">${visible.length}${data.total != null && data.total > visible.length ? `/${data.total}` : ''}</span>
        </header>
        ${filterHtml ? `<div class="action-col-toolbar">${filterHtml}</div>` : ''}
        ${actionBarHtml}
        ${errorBanner}
        <div class="action-col-list">${listHtml}</div>
      </article>
    `;
  }

  function renderActionColumnItem(col, item, selected) {
    const id = item.driverId || item.contactId || '';
    const checked = id && selected.has(id);
    const initials = String(item.name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() || '?';
    const avatar = item.avatar
      ? `<img src="${escapeHTML(item.avatar)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'action-col-avatar-fallback',textContent:'${initials}'}))" />`
      : `<span class="action-col-avatar-fallback">${escapeHTML(initials)}</span>`;
    const ctx = item[col.contextField] || '';
    const metric = col.metric ? col.metric(item) : '';

    const checkboxHtml = col.enableBulk && id
      ? `<input type="checkbox" class="action-col-check" data-col-pick="${col.id}" data-id="${escapeHTML(id)}" ${checked ? 'checked' : ''} />`
      : '<span class="action-col-check-placeholder"></span>';

    return `
      <div class="action-col-item ${checked ? 'is-selected' : ''}" data-id="${escapeHTML(id)}">
        ${checkboxHtml}
        <div class="action-col-avatar">${avatar}</div>
        <div class="action-col-main">
          <strong class="action-col-name" title="${escapeHTML(item.name || '')}">${escapeHTML(item.name || 'Sem nome')}</strong>
          <div class="action-col-subline">
            <span class="action-col-ctx" title="${escapeHTML(ctx)}">${escapeHTML(ctx || '—')}</span>
            <span class="action-col-metric">${metric}</span>
          </div>
        </div>
      </div>
    `;
  }

  function bindActionColumnEvents(root) {
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    root.addEventListener('change', (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;

      const filterCol = target.getAttribute('data-col-filter');
      if (filterCol) {
        actionColumnsState.filterCampaignId[filterCol] = target.value || '';
        actionColumnsState.selected[filterCol] = new Set();
        renderActionColumns();
        return;
      }

      const checkAllCol = target.getAttribute('data-col-checkall');
      if (checkAllCol) {
        const data = actionColumnsState.data[checkAllCol] || { items: [] };
        const filterCampaignId = actionColumnsState.filterCampaignId[checkAllCol] || '';
        const visible = filterCampaignId
          ? (data.items || []).filter(it => it.campaignId === filterCampaignId)
          : (data.items || []);
        const set = actionColumnsState.selected[checkAllCol];
        if (target.checked) {
          visible.slice(0, 50).forEach(it => {
            const id = it.driverId || it.contactId;
            if (id) set.add(id);
          });
        } else {
          set.clear();
        }
        renderActionColumns();
        return;
      }

      const pickCol = target.getAttribute('data-col-pick');
      if (pickCol) {
        const id = target.getAttribute('data-id') || '';
        if (!id) return;
        const set = actionColumnsState.selected[pickCol];
        if (target.checked) set.add(id); else set.delete(id);
        renderActionColumns();
        return;
      }
    });

    root.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;

      const bulkCol = target.closest('[data-col-bulk]')?.getAttribute('data-col-bulk');
      if (bulkCol) {
        ev.preventDefault();
        openBulkMessageModal(bulkCol);
      }
    });
  }

  // ── Modal de disparo em lote ────────────────────────────────

  async function openBulkMessageModal(colId) {
    const set = actionColumnsState.selected[colId];
    if (!set || set.size === 0) {
      alert('Selecione ao menos um motorista.');
      return;
    }
    const driverIds = [...set];

    // Carrega templates (uma vez)
    if (!actionColumnsState.templates) {
      try {
        const data = await fetchJSON('/api/disparador/templates');
        actionColumnsState.templates = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      } catch (err) {
        alert('Falha ao carregar templates: ' + err.message);
        return;
      }
    }
    const approved = (actionColumnsState.templates || []).filter(t => String(t.status || '').toLowerCase() === 'approved');
    if (!approved.length) {
      alert('Nenhum template aprovado disponível.');
      return;
    }

    let backdrop = document.getElementById('bulkMessageModal');
    if (backdrop) backdrop.remove();
    backdrop = document.createElement('div');
    backdrop.id = 'bulkMessageModal';
    backdrop.className = 'bulk-modal-backdrop';
    backdrop.innerHTML = `
      <div class="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulkModalTitle">
        <header class="bulk-modal-head">
          <h3 id="bulkModalTitle">Disparar mensagem</h3>
          <button type="button" class="bulk-modal-close" data-bulk-close aria-label="Fechar">×</button>
        </header>
        <div class="bulk-modal-body">
          <p class="bulk-modal-info"><strong>${driverIds.length}</strong> motorista(s) selecionado(s).</p>
          <label class="bulk-modal-field">
            <span>Template aprovado</span>
            <select id="bulkTemplateSelect">
              ${approved.map(t => `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)} · ${escapeHTML(t.language || 'pt_BR')}</option>`).join('')}
            </select>
          </label>
          <label class="bulk-modal-field bulk-modal-checkbox">
            <input type="checkbox" id="bulkSimulate" />
            <span>Simular envio (não dispara via Meta)</span>
          </label>
        </div>
        <footer class="bulk-modal-foot">
          <button type="button" class="btn secondary btn-mini" data-bulk-close>Cancelar</button>
          <button type="button" class="btn primary btn-mini" id="bulkConfirmBtn">Confirmar disparo</button>
        </footer>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-bulk-close]').forEach(b => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    backdrop.querySelector('#bulkConfirmBtn').addEventListener('click', async () => {
      const select = backdrop.querySelector('#bulkTemplateSelect');
      const simulate = backdrop.querySelector('#bulkSimulate').checked;
      const templateId = select.value;
      const confirmBtn = backdrop.querySelector('#bulkConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Enviando…';
      try {
        const resp = await fetchJSON('/api/overview/bulk-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverIds, templateId, simulate }),
        });
        const summary = resp?.summary || { ok: 0, fail: 0, total: driverIds.length };
        alert(`Disparo concluído: ${summary.ok} enviados, ${summary.fail} falhas (${summary.total} total).${simulate ? '\n(Modo simulação)' : ''}`);
        actionColumnsState.selected[colId] = new Set();
        renderActionColumns();
        close();
        // Recarrega a coluna
        loadCampanhasActionColumns();
      } catch (err) {
        alert('Falha no disparo: ' + err.message);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar disparo';
      }
    });
  }

  function closeOverviewNotifications() {
    if (!overviewEl) return;
    overviewEl.querySelectorAll('.overview-notify-wrap.is-open').forEach(wrap => {
      wrap.classList.remove('is-open');
      const trigger = wrap.querySelector('[data-action="toggle-overview-notifications"]');
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  async function loadOverview(force = false) {
    if (!overviewEl) return;
    const currentRequestId = ++overviewRequestId;

    if (!force && overviewEl.dataset.loaded === '1') return;
    overviewEl.dataset.loaded = '0';

    /* ── 1) Render from cache instantly ─────────────────────── */
    const cached = loadOverviewFromStorage();
    if (cached) {
      const cachedCampaignOv = buildCampaignOverview(cached.campaigns || []);
      const cachedProposalOv = buildProposalOverview(cached.proposals || []);
      renderOverview(cachedCampaignOv, cachedProposalOv);
      overviewEl.dataset.loaded = '1';
    } else {
      renderOverviewLoading();
    }

    /* ── 2) Fetch fresh data in background ──────────────────── */
    try {
      // Buscar campanhas sempre da API (MongoDB)
      const campaignsPromise = fetchJSON('/api/campaigns/summary');

      const [campaignsResult, proposalsResult] = await Promise.allSettled([
        campaignsPromise,
        fetchJSON('/api/proposals'),
      ]);

      if (currentRequestId !== overviewRequestId) return;

      const campaigns = campaignsResult.status === 'fulfilled' && Array.isArray(campaignsResult.value)
        ? campaignsResult.value
        : [];
      const proposals = proposalsResult.status === 'fulfilled' && Array.isArray(proposalsResult.value)
        ? proposalsResult.value
        : [];

      if (campaignsResult.status === 'rejected') {
        console.warn('[WORKSPACE] Falha ao carregar campanhas para o painel:', campaignsResult.reason);
      }
      if (proposalsResult.status === 'rejected') {
        console.warn('[WORKSPACE] Falha ao carregar propostas para o painel:', proposalsResult.reason);
      }

      if (campaignsResult.status === 'rejected' && proposalsResult.status === 'rejected') {
        if (!cached) throw new Error('Nenhum dado disponível para a visão operacional.');
        return;
      }

      saveOverviewToStorage(campaigns, proposals);

      const campaignOverview = buildCampaignOverview(campaigns);
      const proposalOverview = buildProposalOverview(proposals);

      renderOverview(campaignOverview, proposalOverview);
      overviewEl.dataset.loaded = '1';
    } catch (error) {
      if (currentRequestId !== overviewRequestId) return;
      if (!cached) renderOverviewError(error);
    }
  }

  if (grid) {
    apps.forEach(app => {
      if (app.hidden) return;

      const card = document.createElement('article');
      card.className = 'card';

      if (app.backgroundImage) {
        card.style.backgroundImage = `url('${app.backgroundImage}')`;
        card.style.backgroundSize = 'cover';
        card.style.backgroundPosition = 'center';
        card.style.backgroundRepeat = 'no-repeat';
      }

      if (app.comingSoon) {
        const soon = document.createElement('div');
        soon.className = 'soon';
        soon.textContent = 'Em breve';
        card.appendChild(soon);
      }

      if (app.description) {
        const desc = document.createElement('p');
        desc.className = 'desc';
        desc.textContent = app.description;
        card.appendChild(desc);
      }

      const actions = document.createElement('div');
      actions.className = 'actions';

      if (app.links && app.links.length) {
        app.links.forEach(link => {
          const btn = document.createElement('button');
          btn.className = `btn ${link.primary ? 'primary' : 'secondary'}`;
          btn.textContent = link.label;
          btn.addEventListener('click', () => {
            loadModule(link.href);
          });
          actions.appendChild(btn);
        });
      } else {
        const disabled = document.createElement('span');
        disabled.className = 'btn secondary';
        disabled.setAttribute('aria-disabled', 'true');
        disabled.textContent = 'Aguardando link';
        actions.appendChild(disabled);
      }

      card.appendChild(actions);
      grid.appendChild(card);
    });
  }

  if (overviewEl) {
    overviewEl.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      if (action === 'toggle-overview-notifications') {
        const wrap = button.closest('.overview-notify-wrap');
        if (!wrap) return;
        const willOpen = !wrap.classList.contains('is-open');
        closeOverviewNotifications();
        if (willOpen) {
          wrap.classList.add('is-open');
          button.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (action === 'refresh-overview') {
        closeOverviewNotifications();
        loadOverview(true);
        return;
      }

      if (action === 'hide-panel') {
        const panelId = button.dataset.panelId;
        if (!panelId) return;
        const el = document.getElementById(panelId);
        if (!el) return;
        el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.97)';
        setTimeout(() => {
          el.style.display = 'none';
          const hidden = getDndHiddenPanels();
          if (!hidden.includes(panelId)) {
            hidden.push(panelId);
            setDndHiddenPanels(hidden);
          }
          renderOverviewRestoreBar();
        }, 250);
        return;
      }

      if (action === 'exportar-dados') {
        exportarDadosExcel();
        return;
      }

      if (action === 'open-campaigns') {
        loadModule('/campanhas/index.html');
        return;
      }

      if (action === 'open-gerador') {
        loadModule('/gerador/app/index.html');
        return;
      }

      if (action === 'quick-new-campaign') {
        loadModule('/campanhas/index.html');
        return;
      }

      if (action === 'quick-new-budget') {
        loadModule('/gerador/app/index.html');
        return;
      }

      if (action === 'quick-solicitacoes') {
        loadModule('/gerador/representantes/admin.html');
        return;
      }

      if (action === 'quick-motorista') {
        loadModule('/campanhas/driver.html');
        return;
      }

      if (action === 'quick-grafica') {
        loadModule('/campanhas/graphic.html');
        return;
      }

      if (action === 'open-od-flow') {
        const templateId = button.dataset.id;
        loadModule(buildOdFlowStudioUrl({ templateId }), 'od-chat');
        return;
      }

      if (action === 'open-campaign') {
        const campaignId = button.dataset.id;
        if (!campaignId) return;
        const tab = button.dataset.tab || '';
        const tabParam = tab ? `&tab=${encodeURIComponent(tab)}` : '';
        loadModule(`/campanhas/campaign.html?id=${encodeURIComponent(campaignId)}${tabParam}`);
      }
    });

    // ── Global floating tooltip for .action-col-info buttons ──
    const wsTooltipEl = document.createElement('div');
    wsTooltipEl.id = 'wsTooltip';
    wsTooltipEl.setAttribute('role', 'tooltip');
    wsTooltipEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(wsTooltipEl);
    let wsTooltipTimer = null;

    document.addEventListener('mouseenter', ev => {
      const btn = ev.target.closest('.action-col-info[data-tooltip]');
      if (!btn) return;
      clearTimeout(wsTooltipTimer);
      wsTooltipEl.textContent = btn.dataset.tooltip;
      wsTooltipEl.classList.remove('is-visible');
      const rect = btn.getBoundingClientRect();
      const tipW = 260;
      let left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      wsTooltipEl.style.width = tipW + 'px';
      wsTooltipEl.style.left = left + 'px';
      wsTooltipEl.style.top = (rect.top - 8) + 'px'; // temp to measure height
      wsTooltipEl.style.visibility = 'hidden';
      wsTooltipEl.classList.add('is-visible');
      const tipH = wsTooltipEl.offsetHeight;
      wsTooltipEl.style.top = (rect.top - tipH - 10) + 'px';
      wsTooltipEl.style.visibility = '';
    }, true);

    document.addEventListener('mouseleave', ev => {
      const btn = ev.target.closest('.action-col-info[data-tooltip]');
      if (!btn) return;
      wsTooltipEl.classList.remove('is-visible');
    }, true);

    document.addEventListener('click', event => {
      if (!event.target.closest('#workspaceOverview .overview-notify-wrap')) {
        closeOverviewNotifications();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeOverviewNotifications();
      }

      // ── Smart F5 / Ctrl+R: refresh data without full page reload ──
      const isRefreshKey = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key === 'r');
      if (isRefreshKey) {
        if (currentWorkspaceView === 'detached') return;
        event.preventDefault();
        event.stopPropagation();
        triggerSmartRefresh();
      }
    });
  }

  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const navItems = document.querySelectorAll('.nav-item');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const moduleFrame = document.getElementById('moduleFrame');
  let currentWorkspaceView = 'home';

  sidebarToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
  });

  const btnSmartRefresh = document.getElementById('btnSmartRefresh');

  function setActiveModule(module) {
    if (!module) return;
    navItems.forEach(item => item.classList.remove('active'));
    document.querySelector('[data-module="' + module + '"]')?.classList.add('active');
  }

  function loadModule(url, module) {
    currentWorkspaceView = 'module';
    if (module) setActiveModule(module);
    welcomeScreen.style.display = 'none';
    moduleFrame.style.display = 'block';
    if (btnSmartRefresh) btnSmartRefresh.style.display = '';
    // Cache-busting: garantir que o browser busque HTML/JS frescos
    const separator = url.includes('?') ? '&' : '?';
    moduleFrame.src = url + separator + '_cb=' + Date.now();
  }

  function showDetachedModuleArea(module) {
    currentWorkspaceView = 'detached';
    if (module) setActiveModule(module);
    welcomeScreen.style.display = 'none';
    moduleFrame.style.display = 'none';
    moduleFrame.src = '';
    if (btnSmartRefresh) btnSmartRefresh.style.display = 'none';
  }

  function buildOdFlowStudioUrl(options) {
    const opts = options || {};
    const params = new URLSearchParams();
    const templateId = String(opts.templateId || '').trim();
    if (templateId) params.set('templateId', templateId);
    const query = params.toString();
    return '/od-chat-studio/index.html' + (query ? '?' + query : '');
  }

  function openOdFlowStudio() {
    loadModule(buildOdFlowStudioUrl(), 'od-chat');
  }

  function showHome() {
    currentWorkspaceView = 'home';
    welcomeScreen.style.display = 'block';
    moduleFrame.style.display = 'none';
    moduleFrame.src = '';
    if (btnSmartRefresh) btnSmartRefresh.style.display = 'none';
    setActiveModule('home');

    loadOverview(true);
  }

  // ── Smart Refresh: single function used by both the button and F5 ──
  function triggerSmartRefresh() {
    if (currentWorkspaceView === 'home') {
      loadOverview(true);
    } else if (currentWorkspaceView === 'module' && moduleFrame && moduleFrame.contentWindow) {
      try {
        moduleFrame.contentWindow.postMessage({ type: 'SMART_REFRESH' }, '*');
      } catch (_) {}
    }

    // Visual feedback: spin the icon briefly
    if (btnSmartRefresh) {
      btnSmartRefresh.classList.add('refreshing');
      setTimeout(() => btnSmartRefresh.classList.remove('refreshing'), 900);
    }
  }

  if (btnSmartRefresh) {
    btnSmartRefresh.addEventListener('click', triggerSmartRefresh);
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const module = item.dataset.module;

      switch (module) {
        case 'home':
          showHome();
          break;
        case 'campanhas':
          loadModule('/campanhas/index.html', 'campanhas');
          break;
        case 'motoristas':
          loadModule('/motoristas/index.html', 'motoristas');
          break;
        case 'crm':
          loadModule('/crm/index.html', 'crm');
          break;
        case 'meta-ads':
          loadModule('/meta-ads/index.html', 'meta-ads');
          break;
        case 'gerador':
          loadModule('/gerador/app/index.html', 'gerador');
          break;
        case 'fluxo-operacional':
          window.open('https://operacionalfluxo.lovable.app/', '_blank', 'noopener,noreferrer');
          break;
        case 'od-chat':
          openOdFlowStudio();
          break;
        case 'solicitacoes':
          loadModule('/gerador/representantes/admin.html', 'solicitacoes');
          break;
        case 'portal-rep':
          loadModule('/gerador/representantes/portal.html', 'portal-rep');
          break;
        case 'motorista':
          loadModule('/campanhas/driver.html', 'motorista');
          break;
        case 'grafica':
          loadModule('/campanhas/graphic.html', 'grafica');
          break;
        case 'configuracoes':
          loadModule('/gerador/app/settings/index.html', 'configuracoes');
          break;
      }
    });
  });

  setActiveModule('home');

  /* ── Botão "Automação API" na sidebar ── removido (módulo desativado) ── */

  /* ── STARTUP: carregar dados centralizados ── */
  // Limpar chaves antigas do localStorage (de versões anteriores)
  try {
    localStorage.removeItem('motoristas_cache');
    localStorage.removeItem('odchat_drivers_cache');
    localStorage.removeItem('odchat_campaigns_cache');
    localStorage.removeItem('oddrive:drivers');
    localStorage.removeItem('oddrive:campaigns');
    localStorage.removeItem('oddrive:data:updatedAt');
    localStorage.removeItem('oddrive:overview:data');
  } catch (_) {}

  (async () => {
    // Sempre carregar da API (MongoDB) com splash visível
    await loadGlobalData(true);
    loadOverview(true);
  })();

  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/login.html';
  });

  // ══════════════════════════════════════════════════════════════════
  //  DRAG & DROP — Visão Operacional
  // ══════════════════════════════════════════════════════════════════

  const DND_PANELS_TOP    = ['campanhasPanel', 'targetsPanel'];
  const DND_PANELS_BOTTOM = ['notifSection', 'bookingsSection', 'proposalsSection'];
  const DND_LAYOUT_KEY_TOP    = 'oddrive_layout_overview_top';
  const DND_LAYOUT_KEY_BOTTOM = 'oddrive_layout_overview_bottom';
  const DND_HIDDEN_KEY = 'oddrive_hidden_panels';

  const DND_GRIP_SVG  = `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.4"/><circle cx="10.5" cy="3.5" r="1.4"/><circle cx="5.5" cy="8" r="1.4"/><circle cx="10.5" cy="8" r="1.4"/><circle cx="5.5" cy="12.5" r="1.4"/><circle cx="10.5" cy="12.5" r="1.4"/></svg>`;
  const DND_CLOSE_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" width="12" height="12" aria-hidden="true"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>`;

  function getDndHiddenPanels() {
    try { return JSON.parse(localStorage.getItem(DND_HIDDEN_KEY) || '[]'); } catch { return []; }
  }

  function setDndHiddenPanels(list) {
    try { localStorage.setItem(DND_HIDDEN_KEY, JSON.stringify(list)); } catch {}
  }

  function getDndLayout(key, defaultOrder) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(saved) && saved.length) {
        const filtered = saved.filter(id => defaultOrder.includes(id));
        defaultOrder.forEach(id => { if (!filtered.includes(id)) filtered.push(id); });
        return filtered;
      }
    } catch {}
    return [...defaultOrder];
  }

  function saveDndLayout(key, container) {
    const order = Array.from(container.children)
      .map(el => el.id || el.dataset.panelId)
      .filter(Boolean);
    try { localStorage.setItem(key, JSON.stringify(order)); } catch {}
  }

  function applyDndOrder(container, orderedIds) {
    const items = {};
    Array.from(container.children).forEach(el => {
      const id = el.id || el.dataset.panelId;
      if (id) items[id] = el;
    });
    orderedIds.forEach(id => {
      if (items[id]) container.appendChild(items[id]);
    });
  }

  function injectOverviewDndControls(panelId) {
    const el = document.getElementById(panelId);
    if (!el || el.querySelector('.dnd-controls')) return;
    el.classList.add('dnd-section');
    const controls = document.createElement('div');
    controls.className = 'dnd-controls';
    controls.innerHTML = `
      <button type="button" class="dnd-btn dnd-handle" title="Arrastar painel" aria-label="Arrastar painel">${DND_GRIP_SVG}</button>
      <button type="button" class="dnd-btn dnd-close-btn" data-action="hide-panel" data-panel-id="${panelId}" title="Ocultar painel" aria-label="Ocultar painel">${DND_CLOSE_SVG}</button>
    `;
    el.prepend(controls);
  }

  function renderOverviewRestoreBar() {
    const hidden = getDndHiddenPanels();
    document.getElementById('overviewRestoreBar')?.remove();
    if (!hidden.length || !overviewEl) return;
    const bar = document.createElement('div');
    bar.id = 'overviewRestoreBar';
    bar.className = 'overview-restore-bar';
    bar.setAttribute('role', 'button');
    bar.setAttribute('tabindex', '0');
    bar.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      ${hidden.length} painel(is) oculto(s) &mdash; Restaurar tudo
    `;
    bar.addEventListener('click', () => {
      setDndHiddenPanels([]);
      loadOverview(true);
    });
    bar.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') bar.click(); });
    overviewEl.appendChild(bar);
  }

  let overviewSortableTop    = null;
  let overviewSortableBottom = null;

  function initOverviewDnD() {
    if (typeof Sortable === 'undefined') return;

    const allPanels = [...DND_PANELS_TOP, ...DND_PANELS_BOTTOM];
    const hidden    = getDndHiddenPanels();

    // Injetar controles e aplicar estado de oculto
    allPanels.forEach(id => {
      injectOverviewDndControls(id);
      const el = document.getElementById(id);
      if (el) el.style.display = hidden.includes(id) ? 'none' : '';
    });

    // Restaurar ordem salva
    const containerTop    = overviewEl?.querySelector('.overview-panels');
    const containerBottom = overviewEl?.querySelector('.overview-bottom-panels');

    if (containerTop) {
      applyDndOrder(containerTop, getDndLayout(DND_LAYOUT_KEY_TOP, DND_PANELS_TOP));
    }
    if (containerBottom) {
      applyDndOrder(containerBottom, getDndLayout(DND_LAYOUT_KEY_BOTTOM, DND_PANELS_BOTTOM));
    }

    // Inicializar SortableJS
    if (containerTop) {
      if (overviewSortableTop) overviewSortableTop.destroy();
      overviewSortableTop = new Sortable(containerTop, {
        animation: 200,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        handle: '.dnd-handle',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onEnd: () => saveDndLayout(DND_LAYOUT_KEY_TOP, containerTop),
      });
    }

    if (containerBottom) {
      if (overviewSortableBottom) overviewSortableBottom.destroy();
      overviewSortableBottom = new Sortable(containerBottom, {
        animation: 200,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        handle: '.dnd-handle',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onEnd: () => saveDndLayout(DND_LAYOUT_KEY_BOTTOM, containerBottom),
      });
    }

    renderOverviewRestoreBar();
  }

})();
