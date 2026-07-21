const cardsEl = document.getElementById('cards');
const chipsEl = document.getElementById('chips');
const campaignsViewToggle = document.getElementById('campaignsViewToggle');
const adminPromptModal = document.getElementById('adminPromptModal');
const adminPromptForm = document.getElementById('adminPromptForm');
const adminPromptTitle = document.getElementById('adminPromptTitle');
const adminPromptDescription = document.getElementById('adminPromptDescription');
const adminPromptFields = document.getElementById('adminPromptFields');
const adminPromptConfirm = document.getElementById('adminPromptConfirm');
const adminPromptCancel = document.getElementById('adminPromptCancel');

// ─── Drag & Drop — Gerenciador de Campanhas ───────────────────────────────
const DND_CAMPS_ORDER_KEY  = 'oddrive_layout_campaigns_order';
const DND_GRIP_SVG_CAMPS   = `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.4"/><circle cx="10.5" cy="3.5" r="1.4"/><circle cx="5.5" cy="8" r="1.4"/><circle cx="10.5" cy="8" r="1.4"/><circle cx="5.5" cy="12.5" r="1.4"/><circle cx="10.5" cy="12.5" r="1.4"/></svg>`;

function getCampsCardOrder() {
  try { return JSON.parse(localStorage.getItem(DND_CAMPS_ORDER_KEY) || '[]'); } catch { return []; }
}
function saveCampsCardOrder() {
  if (!cardsEl) return;
  const order = Array.from(cardsEl.children)
    .map(el => el.getAttribute('data-campaign-id'))
    .filter(Boolean);
  try { localStorage.setItem(DND_CAMPS_ORDER_KEY, JSON.stringify(order)); } catch {}
}

let campaignCardsSortable = null;

function initCampaignCardsDnD() {
  if (typeof Sortable === 'undefined' || !cardsEl) return;

  const savedOrder = getCampsCardOrder();

  // Aplicar ordem salva (reordenar DOM)
  if (savedOrder.length) {
    const wrappers = {};
    Array.from(cardsEl.children).forEach(el => {
      const id = el.getAttribute('data-campaign-id');
      if (id) wrappers[id] = el;
    });
    savedOrder.forEach(id => { if (wrappers[id]) cardsEl.appendChild(wrappers[id]); });
    // Novas campanhas (não salvas) vão para o final
    Object.keys(wrappers).forEach(id => {
      if (!savedOrder.includes(id)) cardsEl.appendChild(wrappers[id]);
    });
  }

  // Inicializar SortableJS
  if (campaignCardsSortable) campaignCardsSortable.destroy();
  campaignCardsSortable = new Sortable(cardsEl, {
    animation: 200,
    easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
    handle: '.dnd-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: saveCampsCardOrder,
  });
}
// ─────────────────────────────────────────────────────────────────────────

// Token já foi capturado no index.html inline script
let adminToken = localStorage.getItem('adminToken');
console.log('[AUTH] Token carregado no app.js:', adminToken ? 'PRESENTE' : 'AUSENTE');

// Autenticação é gerenciada pelo workspace - não força login aqui

// Função para fazer fetch com token (prepend API_BASE para chamadas cross-origin)
function authFetch(url, options = {}, _retries) {
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

// Função para logout
function logout() {
  console.log('[AUTH] Logout chamado - limpando tokens e redirecionando');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  
  // Detecta se está dentro de um iframe
  const isInIframe = window.self !== window.top;
  
  if (isInIframe) {
    // Se estiver em iframe, tenta comunicar com o parent para fazer logout
    try {
      window.parent.postMessage({ type: 'LOGOUT_REQUEST' }, '*');
      console.log('[AUTH] Solicitação de logout enviada para parent (workspace)');
    } catch (e) {
      console.error('[AUTH] Não foi possível comunicar com parent:', e);
    }
  } else {
    // Se não estiver em iframe, redireciona normalmente
    const workspaceUrl = window.WORKSPACE_CONFIG?.WORKSPACE_URL || window.location.origin.replace('backend', 'workspace');
    window.location.href = `${workspaceUrl}/login.html`;
  }
}

// Feedback helpers (shared)
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
const toast = (msg, type = 'info') => {
  if (typeof window.adminToast === 'function') return window.adminToast(msg, type);
  console.warn(`[Toast:${type}] ${String(msg)}`);
};
window.alert = msg => alertDialog(String(msg));


// Motion/feedback utilities
function setBusy(el, busy=true){
  try {
    if(!el) return;
    el.classList.toggle('is-busy', !!busy);
    el.setAttribute('aria-busy', busy ? 'true' : 'false');
    if(busy){
      if(!el.querySelector('.dot-loader')){
        const l = document.createElement('span');
        l.className = 'dot-loader';
        el.appendChild(l);
      }
      el.disabled = true;
    } else {
      const l = el.querySelector('.dot-loader'); if(l) l.remove();
      el.disabled = false;
    }
  } catch {}
}
function showOverlayBusy(){
  let o = document.querySelector('.overlay-busy');
  if(!o){
    o = document.createElement('div');
    o.className = 'overlay-busy';
    const spinner = document.createElement('div'); spinner.className = 'spinner';
    o.appendChild(spinner);
    document.body.appendChild(o);
  }
  o.classList.add('show');
}
function hideOverlayBusy(){
  const o = document.querySelector('.overlay-busy');
  if(o) o.classList.remove('show');
}
// Reusable admin modal prompt with animated card
const __promptState = { cleanup: null };
function openAdminPrompt(opts = {}) {
  if (!adminPromptModal || !adminPromptForm) return Promise.resolve(null);
  if (__promptState.cleanup) { try { __promptState.cleanup(null, true); } catch {} }
  const {
    title='configurações', description='', confirmLabel='Confirmar', cancelLabel='Cancelar', fields=[]
  } = opts;
  return new Promise(resolve => {
    const card = adminPromptModal.querySelector('.modal-card');
    const dismissEls = Array.from(adminPromptModal.querySelectorAll('[data-admin-prompt-dismiss]'));
    adminPromptTitle.textContent = title;
    if (adminPromptDescription) {
      adminPromptDescription.textContent = description;
      adminPromptDescription.style.display = description ? '' : 'none';
    }
    if (adminPromptConfirm) adminPromptConfirm.textContent = confirmLabel;
    if (adminPromptCancel) adminPromptCancel.textContent = cancelLabel;
    adminPromptFields.innerHTML=''; adminPromptForm.reset();
    fields.forEach(f => {
      const group = document.createElement('div'); group.className='form-group';
      const label = document.createElement('label'); label.textContent = f.label || f.name || ''; label.setAttribute('for', `admin-prompt-${f.name}`);
      let input; const type = String(f.type||'text').toLowerCase();
      if (type==='textarea'){ input=document.createElement('textarea'); input.rows=f.rows||3; }
      else if (type==='select' && Array.isArray(f.options)) {
        input=document.createElement('select');
        if (f.placeholder){ const ph=document.createElement('option'); ph.value=''; ph.textContent=f.placeholder; ph.disabled=true; ph.selected=!f.value; input.appendChild(ph); }
        f.options.forEach(opt=>{ const o=document.createElement('option'); o.value=opt.value; o.textContent=opt.label??opt.value; input.appendChild(o); });
      } else if (type==='checkbox'){ input=document.createElement('input'); input.type='checkbox'; input.checked=!!f.value; }
      else { input=document.createElement('input'); input.type=f.inputType||'text'; if (f.placeholder) input.placeholder=f.placeholder; input.value=f.value??''; }
      input.id=`admin-prompt-${f.name}`; input.name=f.name||''; if (f.required) input.required=true; if (type==='checkbox'){} else { input.value=f.value??''; }
      group.append(label,input); adminPromptFields.appendChild(group);
    });
    let closed=false; const finish=(result)=>{
      if (closed) return; closed=true;
      document.removeEventListener('keydown',onKey); adminPromptForm.removeEventListener('submit',onSubmit); dismissEls.forEach(el=>el.removeEventListener('click',onDismiss)); __promptState.cleanup=null;
      if (!card){ adminPromptModal.classList.add('hidden'); adminPromptModal.setAttribute('aria-hidden','true'); document.body.style.overflow=''; return resolve(result); }
      card.classList.remove('is-visible'); card.classList.add('is-leaving'); card.addEventListener('animationend',()=>{ card.classList.remove('is-leaving'); adminPromptModal.classList.add('hidden'); adminPromptModal.setAttribute('aria-hidden','true'); document.body.style.overflow=''; resolve(result); },{once:true});
    };
    const onSubmit=(e)=>{ e.preventDefault(); const data={}; (fields||[]).forEach(f=>{ const el=adminPromptForm.elements[f.name]; if(!el) return; data[f.name]= el.type==='checkbox' ? el.checked : String(el.value||'').trim(); }); finish(data); };
    const onDismiss=()=>finish(null); const onKey=(e)=>{ if(e.key==='Escape'){ e.preventDefault(); onDismiss(); } };
    adminPromptForm.addEventListener('submit',onSubmit); dismissEls.forEach(el=>el.addEventListener('click',onDismiss)); document.addEventListener('keydown',onKey);
    __promptState.cleanup=(r=null,skip=false)=>{ if(skip){ closed=true; document.removeEventListener('keydown',onKey); adminPromptForm.removeEventListener('submit',onSubmit); dismissEls.forEach(el=>el.removeEventListener('click',onDismiss)); adminPromptModal.classList.add('hidden'); adminPromptModal.setAttribute('aria-hidden','true'); document.body.style.overflow=''; resolve(r); return;} finish(r); };
    adminPromptModal.classList.remove('hidden'); adminPromptModal.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; if(card){ card.classList.remove('is-leaving'); requestAnimationFrame(()=>card.classList.add('is-visible')); }
  });
}
let campaignsCache = [];
let activeFilter = 'ativa';
const CAMPAIGNS_VIEW_STORAGE_KEY = 'oddrive:campaigns:view';
const LIST_SORT_STORAGE_KEY = 'oddrive:campaigns:listSort';
const VALID_VIEWS = ['default', 'pipeline', 'list'];
const storedView = localStorage.getItem(CAMPAIGNS_VIEW_STORAGE_KEY);
let currentView = VALID_VIEWS.includes(storedView) ? storedView : 'default';
let listSort = localStorage.getItem(LIST_SORT_STORAGE_KEY) || 'recent';
let listSearch = '';

// ── Cache localStorage removido (dados grandes demais para localStorage) ──
function saveCampaignsToStorage(_data) { /* noop */ }
function loadCampaignsFromStorage() { return null; }

function getCacheTimestamp() {
  return null;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}

function updateCacheIndicator() {
  const el = document.getElementById('cacheTimestamp');
  if (!el) return;
  const ts = getCacheTimestamp();
  if (!ts) { el.textContent = ''; return; }
  el.textContent = `Última atualização: ${formatRelativeTime(ts)}`;
  el.title = new Date(ts).toLocaleString('pt-BR');
}

const CAMPAIGN_PIPELINE_COLUMNS = [
  { key: 'critical', label: 'Ação imediata', helper: 'Prioridade alta' },
  { key: 'attention', label: 'Atenção', helper: 'Acompanhar de perto' },
  { key: 'ok', label: 'Estável', helper: 'Operação saudável' },
  { key: 'paused', label: 'Pausadas', helper: 'Sem ação imediata' },
];

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJSON(url, opts) {
  const res = await authFetch(url, opts);
  if (!res.ok) {
    if (res.status === 401) {
      console.warn('[AUTH] Recebeu 401 em', url, '- Token presente:', !!adminToken);
      // Só faz logout se havia um token (token inválido/expirado)
      // Se nunca teve token, não redireciona (deixa tentar novamente)
      if (adminToken) {
        logout();
      }
      return;
    }
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatStatus(status) {
  const value = String(status || '').toLowerCase();
  if (!value) return '-';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

function getFilteredCampaigns() {
  return activeFilter === '*'
    ? campaignsCache
    : campaignsCache.filter(
        campaign => String(campaign.status || '').toLowerCase() === activeFilter,
      );
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
  const engagedPct = totalDrivers > 0 ? Math.round(((instalado + confirmado) / totalDrivers) * 100) : 0;

  return {
    agendado,
    confirmado,
    instalado,
    aguardando,
    cadastrando,
    problema,
    review,
    pending,
    totalDrivers,
    installedPct,
    engagedPct,
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

function getStatusPillClass(campaign, summary) {
  const status = String(campaign?.status || '').trim().toLowerCase();
  if (status === 'encerrada' || status === 'inativa') return 'danger';
  if (status === 'pausada') return 'warn';
  return summary.pending > 0 ? 'warn' : 'success';
}

function sortColumnEntries(entries = [], bucket = 'attention') {
  return [...entries].sort((a, b) => {
    if (bucket === 'critical' || bucket === 'attention') {
      if (b.summary.pending !== a.summary.pending) return b.summary.pending - a.summary.pending;
      if (a.summary.installedPct !== b.summary.installedPct) return a.summary.installedPct - b.summary.installedPct;
    } else if (bucket === 'ok') {
      if (b.summary.installedPct !== a.summary.installedPct) return b.summary.installedPct - a.summary.installedPct;
    }
    return String(a.campaign?.name || '').localeCompare(String(b.campaign?.name || ''), 'pt-BR');
  });
}

function renderDefaultCards(filtered = []) {
  for (const campaign of filtered) {
    const summary = getCampaignSummary(campaign);
    const statusClass = getStatusPillClass(campaign, summary);
    const campaignHref = `campaign.html?id=${encodeURIComponent(campaign.id)}`;
    const card = document.createElement('article');
    card.className = 'card card-v2 card-clickable';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('title', 'Abrir campanha');
    card.addEventListener('click', () => { window.location.href = campaignHref; });
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') window.location.href = campaignHref; });

    const api = campaign.apiData || {};
    const locationParts = [api.city, api.state].filter(Boolean);
    const locationText = locationParts.length ? escapeHTML(locationParts.join(' / ')) : '';

    const infoRows = [];
    if (campaign.period) {
      infoRows.push(`<div class="card-info-row"><span class="card-label">Período</span><span class="card-value">${escapeHTML(campaign.period)}</span></div>`);
    }
    if (locationText) {
      infoRows.push(`<div class="card-info-row"><span class="card-label">Local</span><span class="card-value">${locationText}</span></div>`);
    }
    if (api.metaKms > 0) {
      infoRows.push(`<div class="card-info-row"><span class="card-label">Meta KM</span><span class="card-value">${api.metaKms.toLocaleString('pt-BR')} km</span></div>`);
    }

    const progressBar = summary.totalDrivers > 0
      ? `<div class="card-progress">
           <div class="card-progress-header">
             <span>Instalação</span>
             <span>${summary.instalado}/${summary.totalDrivers} (${summary.installedPct}%)</span>
           </div>
           <div class="card-progress-bar"><div class="card-progress-fill" style="width:${summary.installedPct}%"></div></div>
         </div>`
      : '';

    card.innerHTML = `
      <div class="card-head">
        <h3 class="m0">${escapeHTML(campaign.name)}</h3>
        <span class="pill ${statusClass}">${formatStatus(campaign.status)}</span>
      </div>
      ${infoRows.length ? `<div class="card-info">${infoRows.join('')}</div>` : '<div class="card-info"><div class="card-info-row card-info-empty">Sem informações cadastradas</div></div>'}
      ${progressBar}
    `;

    const dndWrapper = document.createElement('div');
    dndWrapper.className = 'dnd-wrapper';
    dndWrapper.setAttribute('data-campaign-id', String(campaign.id || ''));
    const dndControls = document.createElement('div');
    dndControls.className = 'dnd-controls';
    dndControls.innerHTML = `
      <button type="button" class="dnd-btn dnd-handle" title="Arrastar" aria-label="Arrastar">${DND_GRIP_SVG_CAMPS}</button>
    `;
    dndWrapper.appendChild(dndControls);
    dndWrapper.appendChild(card);
    cardsEl.appendChild(dndWrapper);
  }
}

function renderPipelineBoard(filtered = []) {
  const grouped = {
    critical: [],
    attention: [],
    ok: [],
    paused: [],
  };

  filtered.forEach(campaign => {
    const summary = getCampaignSummary(campaign);
    const bucket = getCampaignBucket(campaign, summary);
    grouped[bucket].push({ campaign, summary });
  });

  const board = document.createElement('div');
  board.className = 'campaigns-pipeline';

  CAMPAIGN_PIPELINE_COLUMNS.forEach(column => {
    const columnEntries = sortColumnEntries(grouped[column.key] || [], column.key);
    const columnEl = document.createElement('section');
    columnEl.className = `campaign-pipeline-column col-${column.key}`;
    columnEl.innerHTML = `
      <header class="campaign-pipeline-column-head">
        <div>
          <div class="campaign-pipeline-column-title">${escapeHTML(column.label)}</div>
          <div class="campaign-pipeline-column-helper">${escapeHTML(column.helper)}</div>
        </div>
        <span class="campaign-pipeline-column-count">${columnEntries.length}</span>
      </header>
    `;

    const list = document.createElement('div');
    list.className = 'campaign-pipeline-list';

    if (!columnEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'campaign-pipeline-empty';
      empty.textContent = 'Sem campanhas neste grupo.';
      list.appendChild(empty);
    } else {
      columnEntries.forEach(({ campaign, summary }) => {
        const campaignHref = `campaign.html?id=${encodeURIComponent(campaign.id)}`;
        const card = document.createElement('article');
        card.className = 'campaign-pipeline-card card-clickable';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('title', 'Abrir campanha');
        card.addEventListener('click', () => { window.location.href = campaignHref; });
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') window.location.href = campaignHref; });

        const statusClass = getStatusPillClass(campaign, summary);
        const api = campaign.apiData || {};
        const locationParts = [api.city, api.state].filter(Boolean);
        const locationText = locationParts.length ? escapeHTML(locationParts.join(' / ')) : '';

        const detailLines = [];
        if (campaign.period) detailLines.push(`<div class="pipeline-detail"><span class="pipeline-detail-label">Período</span> ${escapeHTML(campaign.period)}</div>`);
        if (locationText) detailLines.push(`<div class="pipeline-detail"><span class="pipeline-detail-label">Local</span> ${locationText}</div>`);
        if (api.metaKms > 0) detailLines.push(`<div class="pipeline-detail"><span class="pipeline-detail-label">Meta</span> ${api.metaKms.toLocaleString('pt-BR')} km</div>`);

        const focusText = summary.pending > 0
          ? `${summary.pending} pendência(s) para tratar`
          : summary.totalDrivers > 0
          ? 'Fluxo estável'
          : 'Aguardando motoristas';
        const focusClass = summary.pending > 0 ? 'focus-warn' : summary.totalDrivers > 0 ? 'focus-ok' : 'focus-neutral';

        card.innerHTML = `
          <div class="campaign-pipeline-card-head">
            <h3 class="m0">${escapeHTML(campaign.name)}</h3>
            <span class="pill ${statusClass}">${formatStatus(campaign.status)}</span>
          </div>
          ${detailLines.length ? `<div class="pipeline-details">${detailLines.join('')}</div>` : ''}
          ${summary.totalDrivers > 0
            ? `<div class="card-progress">
                 <div class="card-progress-header">
                   <span>Instalação</span>
                   <span>${summary.instalado}/${summary.totalDrivers} (${summary.installedPct}%)</span>
                 </div>
                 <div class="card-progress-bar"><div class="card-progress-fill" style="width:${summary.installedPct}%"></div></div>
               </div>`
            : ''}
          <div class="campaign-pipeline-focus ${focusClass}">${escapeHTML(focusText)}</div>
        `;
        list.appendChild(card);
      });
    }

    columnEl.appendChild(list);
    board.appendChild(columnEl);
  });

  cardsEl.appendChild(board);
}

function renderListView(filtered = []) {
  const term = String(listSearch || '').trim().toLowerCase();
  let items = filtered.map(campaign => ({ campaign, summary: getCampaignSummary(campaign) }));

  if (term) {
    items = items.filter(({ campaign }) => {
      const api = campaign.apiData || {};
      const haystack = [
        campaign.name,
        api.city,
        api.state,
        campaign.period,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }

  const cmpName = (a, b) => String(a.campaign?.name || '').localeCompare(String(b.campaign?.name || ''), 'pt-BR');
  const tsOf = (c) => Number(c?.updatedAt) || Number(c?.createdAt) || 0;

  switch (listSort) {
    case 'alpha': items.sort(cmpName); break;
    case 'alpha-desc': items.sort((a, b) => -cmpName(a, b)); break;
    case 'installed-desc': items.sort((a, b) => b.summary.installedPct - a.summary.installedPct || cmpName(a, b)); break;
    case 'installed-asc': items.sort((a, b) => a.summary.installedPct - b.summary.installedPct || cmpName(a, b)); break;
    case 'recent':
    default: items.sort((a, b) => tsOf(b.campaign) - tsOf(a.campaign) || cmpName(a, b)); break;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'campaigns-list-wrap';

  if (!items.length) {
    wrapper.innerHTML = '<div class="campaigns-list-empty">Nenhuma campanha encontrada.</div>';
    cardsEl.appendChild(wrapper);
    return;
  }

  const rowsHtml = items.map(({ campaign, summary }) => {
    const api = campaign.apiData || {};
    const locationParts = [api.city, api.state].filter(Boolean);
    const locationText = locationParts.length ? escapeHTML(locationParts.join(' / ')) : '<span class="muted">—</span>';
    const period = campaign.period ? escapeHTML(campaign.period) : '<span class="muted">—</span>';
    const statusClass = getStatusPillClass(campaign, summary);
    const pct = summary.totalDrivers > 0
      ? `<div class="campaigns-list-pct"><div class="campaigns-list-pct-bar"><div class="campaigns-list-pct-fill" style="width:${summary.installedPct}%"></div></div><span>${summary.installedPct}%</span></div>`
      : '<span class="muted">—</span>';
    const href = `campaign.html?id=${encodeURIComponent(campaign.id)}`;
    const targetVal = Number(campaign.driverTarget ?? 0);
    const targetDisplay = targetVal > 0 ? String(targetVal) : '';
    return `
      <tr class="campaigns-list-row" data-href="${escapeHTML(href)}" tabindex="0" data-campaign-id="${escapeHTML(campaign.id)}">
        <td class="campaigns-list-name">${escapeHTML(campaign.name)}</td>
        <td>${locationText}</td>
        <td>${period}</td>
        <td>${pct}</td>
        <td class="campaigns-list-meta-cell" data-meta-cell>
          <input type="number" class="campaigns-list-meta-input" min="0" max="100000"
            value="${escapeHTML(targetDisplay)}" placeholder="—"
            title="Meta de motoristas"
            data-campaign-id="${escapeHTML(campaign.id)}"
            data-original="${escapeHTML(targetDisplay)}" />
        </td>
        <td><span class="pill ${statusClass}">${formatStatus(campaign.status)}</span></td>
      </tr>
    `;
  }).join('');

  wrapper.innerHTML = `
    <table class="campaigns-list-table">
      <thead>
        <tr>
          <th>Campanha</th>
          <th>Cidade</th>
          <th>Período</th>
          <th>Instalação</th>
          <th>Meta</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  wrapper.querySelectorAll('.campaigns-list-row').forEach(row => {
    const href = row.dataset.href;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-meta-cell]')) return;
      window.location.href = href;
    });
    row.addEventListener('keydown', (e) => {
      if (e.target.closest('[data-meta-cell]')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = href; }
    });
  });

  // Wire meta inputs
  wrapper.querySelectorAll('.campaigns-list-meta-input').forEach(input => {
    async function saveMetaInput() {
      const campaignId = input.dataset.campaignId;
      const raw = input.value.trim();
      const target = raw === '' ? 0 : parseInt(raw, 10);
      if (!Number.isFinite(target) || target < 0 || target > 100000) {
        input.value = input.dataset.original;
        return;
      }
      input.disabled = true;
      try {
        const res = await authFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverTarget: target }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const saved = data?.campaign?.driverTarget ?? target;
        // Update local cache
        const cam = campaignsCache.find(c => c.id === campaignId);
        if (cam) cam.driverTarget = saved;
        input.value = saved > 0 ? String(saved) : '';
        input.dataset.original = input.value;
        input.classList.add('is-saved');
        setTimeout(() => input.classList.remove('is-saved'), 1200);
      } catch (err) {
        console.error('[meta] save error:', err);
        input.value = input.dataset.original;
        input.classList.add('is-error');
        setTimeout(() => input.classList.remove('is-error'), 1500);
      } finally {
        input.disabled = false;
      }
    }
    input.addEventListener('blur', saveMetaInput);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = input.dataset.original; input.blur(); }
    });
  });

  cardsEl.appendChild(wrapper);
}

function renderEmptyState() {
  if (currentView === 'pipeline') {
    const empty = document.createElement('article');
    empty.className = 'campaign-pipeline-empty-state';
    empty.innerHTML = `
      <h3 class="m0">Sem campanhas para este filtro.</h3>
      <p class="small m0">Altere os filtros para ver outras campanhas.</p>
    `;
    cardsEl.appendChild(empty);
    return;
  }

  const placeholder = document.createElement('article');
  placeholder.className = 'card placeholder';
  placeholder.innerHTML = `
    <div class="card-head">
      <h3 class="m0">Sem campanhas encontradas</h3>
      <span class="pill">API OdDrive</span>
    </div>
    <p class="small m0">Altere o filtro para ver campanhas de outro período.</p>
  `;
  cardsEl.appendChild(placeholder);
}

function renderCampaigns() {
  if (!cardsEl) return;
  const filtered = getFilteredCampaigns();

  cardsEl.innerHTML = '';
  cardsEl.classList.toggle('grid-cards', currentView === 'default');
  cardsEl.classList.toggle('campaigns-pipeline-board', currentView === 'pipeline');
  cardsEl.classList.toggle('campaigns-list-board', currentView === 'list');

  const sortToolbar = document.getElementById('listSortToolbar');
  if (sortToolbar) sortToolbar.style.display = currentView === 'list' ? 'flex' : 'none';

  if (!filtered.length) {
    renderEmptyState();
    return;
  }

  if (currentView === 'pipeline') {
    renderPipelineBoard(filtered);
    return;
  }

  if (currentView === 'list') {
    renderListView(filtered);
    return;
  }

  renderDefaultCards(filtered);
  initCampaignCardsDnD();
}

function updateCampaignViewToggleUI() {
  if (!campaignsViewToggle) return;
  campaignsViewToggle.querySelectorAll('.view-toggle-btn').forEach(button => {
    button.classList.toggle('is-active', button.dataset.view === currentView);
  });
}

function setCampaignView(view) {
  const next = VALID_VIEWS.includes(view) ? view : 'default';
  if (next === currentView) return;
  currentView = next;
  localStorage.setItem(CAMPAIGNS_VIEW_STORAGE_KEY, currentView);
  updateCampaignViewToggleUI();
  renderCampaigns();
}

function setupViewToggle() {
  if (!campaignsViewToggle) return;
  updateCampaignViewToggleUI();
  campaignsViewToggle.addEventListener('click', event => {
    const button = event.target.closest('.view-toggle-btn');
    if (!button) return;
    setCampaignView(button.dataset.view || 'default');
  });

  const sortSelect = document.getElementById('listSortSelect');
  if (sortSelect) {
    sortSelect.value = listSort;
    sortSelect.addEventListener('change', () => {
      listSort = sortSelect.value;
      localStorage.setItem(LIST_SORT_STORAGE_KEY, listSort);
      renderCampaigns();
    });
  }
  const searchInput = document.getElementById('listSearchInput');
  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        listSearch = searchInput.value || '';
        renderCampaigns();
      }, 150);
    });
  }
}

async function loadCampaigns(forceRefresh = false) {
  // 1. Tentar cache local primeiro (exibição instantânea)
  if (!forceRefresh) {
    const cached = loadCampaignsFromStorage();
    if (cached && cached.length > 0) {
      campaignsCache = cached;
      renderCampaigns();
      updateCacheIndicator();
      return;
    }
  }

  // 2. Sem cache ou refresh forçado → buscar do backend
  try {
    const data = await fetchJSON('/api/campaigns');
    campaignsCache = Array.isArray(data) ? data : [];
    saveCampaignsToStorage(campaignsCache);
    renderCampaigns();
    updateCacheIndicator();
  } catch (err) {
    console.error(err);
    // Se falhou mas tem cache antigo, usar ele
    const cached = loadCampaignsFromStorage();
    if (cached && cached.length > 0) {
      campaignsCache = cached;
      renderCampaigns();
      updateCacheIndicator();
      toast('Usando dados em cache (falha ao conectar com servidor).', 'warning');
    } else {
      alert('Não foi possível carregar as campanhas.');
    }
  }
}

function setActiveFilter(filter) {
  activeFilter = filter;
  renderCampaigns();
}

function setupFilters() {
  if (!chipsEl) return;
  chipsEl.addEventListener('click', event => {
    const button = event.target.closest('.chip');
    if (!button) return;

    chipsEl.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
    button.classList.add('active');

    setActiveFilter(button.dataset.filter || '*');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupViewToggle();
  setupFilters();
  loadCampaigns();
  // opcional: buscar configuracao atual
  try { fetchJSON('/api/config').then(cfg => { console.debug('Config:', cfg); }).catch(() => {}); } catch (e) {}

  // Smart F5: workspace parent sends SMART_REFRESH via postMessage
  window.addEventListener('message', event => {
    if (event.data && event.data.type === 'SMART_REFRESH') {
      loadCampaigns(true);
    }
  });

  // Intercept F5/Ctrl+R inside iframe — refresh data without reloading
  document.addEventListener('keydown', event => {
    const isRefreshKey = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key === 'r');
    if (isRefreshKey) {
      event.preventDefault();
      event.stopPropagation();
      loadCampaigns(true);
    }
  });
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await authFetch('/api/admin/logout', { method: 'POST' });
      } catch (err) {
        console.error('Erro no logout:', err);
      }
      logout();
    });
  }

  // Histórico de auditoria
  const btnAuditLogs = document.getElementById('btnAuditLogs');
  if (btnAuditLogs) {
    btnAuditLogs.addEventListener('click', () => {
      window.location.href = 'audit-logs.html';
    });
  }

  // Gerenciamento de operadores
  const btnAdminUsers = document.getElementById('btnAdminUsers');
  if (btnAdminUsers) {
    btnAdminUsers.addEventListener('click', () => {
      window.location.href = 'admin-users.html';
    });
  }

  // Exibe nome do usuário logado
  const adminUserName = document.getElementById('adminUserName');
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  if (adminUserName && adminUser.name) {
    adminUserName.textContent = adminUser.name;
  }

});












