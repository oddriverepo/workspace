const API_BASE = window.API_BASE || '';

let adminToken = localStorage.getItem('adminToken');
console.log('[AUTH] Token carregado em audit-logs.js:', adminToken ? 'PRESENTE' : 'AUSENTE');

function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  return fetch(fullUrl, { ...options, headers });
}

function logout() {
  console.log('[AUTH] Logout chamado de audit-logs');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  const workspaceUrl =
    window.WORKSPACE_CONFIG?.WORKSPACE_URL ||
    window.location.origin.replace('backend', 'workspace');
  window.location.href = `${workspaceUrl}/login.html`;
}

const filterUsername = document.getElementById('filterUsername');
const filterAction = document.getElementById('filterAction');
const filterEntityType = document.getElementById('filterEntityType');
const btnFilter = document.getElementById('btnFilter');
const btnClearFilters = document.getElementById('btnClearFilters');
const btnLogout = document.getElementById('btnLogout');
const auditTableBody = document.getElementById('auditTableBody');
const loadMoreContainer = document.getElementById('loadMoreContainer');
const btnLoadMore = document.getElementById('btnLoadMore');
const adminUserName = document.getElementById('adminUserName');
const btnBackDashboard = document.getElementById('btnBackDashboard');
const btnClearAll = document.getElementById('btnClearAll');

let currentFilters = {};
let currentSkip = 0;
const LIMIT = 50;

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getActionBadgeClass(action) {
  const key = String(action || '').toLowerCase();
  if (key.includes('login') || key.includes('logout') || key.includes('unauthorized')) return 'action-auth';
  if (key.includes('create')) return 'action-create';
  if (key.includes('update') || key.includes('patch')) return 'action-update';
  if (key.includes('delete') || key.includes('remove')) return 'action-delete';
  if (key.includes('verify')) return 'action-verify';
  if (key.includes('sync') || key.includes('import')) return 'action-sync';
  return '';
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function normalizeActionLabel(action) {
  const actionMap = {
    'campaign:create': 'Criar Campanha',
    'campaign:update': 'Atualizar Campanha',
    'campaign:delete': 'Deletar Campanha',
    'campaign:sync': 'Sincronizar Campanha',
    'driver:create': 'Criar Motorista',
    'driver:update': 'Atualizar Motorista',
    'driver:delete': 'Deletar Motorista',
    'driver:detach': 'Desvincular Motorista',
    'driver:km-update': 'Atualizar KM Motorista',
    'graphic:create': 'Criar Grafica',
    'graphic:update': 'Atualizar Grafica',
    'graphic:delete': 'Deletar Grafica',
    'review:update': 'Aplicar Revisao',
    'review:delete': 'Descartar Revisao',
    'evidence:verify': 'Verificar Evidencia',
    'evidence:delete': 'Deletar Evidencia',
    'evidence:cleanup': 'Limpar Evidencias',
    'storage:delete': 'Deletar Arquivo',
    'storage:delete-folder': 'Deletar Pasta',
    'audit:clear-all': 'Limpar Historico',
    LOGIN_SUCCESS: 'Login (Sucesso)',
    LOGIN_FAILURE: 'Login (Falha)',
    LOGOUT: 'Logout',
    UNAUTHORIZED_ACCESS: 'Acesso Nao Autorizado',
    INVALID_INPUT: 'Entrada Invalida',
  };
  if (actionMap[action]) return actionMap[action];
  return String(action || '-')
    .replace(/[_:]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeEntityLabel(entityType) {
  const map = {
    campaign: 'Campaign',
    driver: 'Driver',
    graphic: 'Graphic',
    evidence: 'Evidence',
    storage_file: 'Storage File',
    storage_folder: 'Storage Folder',
    admin: 'Admin',
    session: 'Session',
  };
  const key = String(entityType || '').trim();
  return map[key] || key || '-';
}

function formatDetails(log) {
  const details = log?.details && typeof log.details === 'object' ? log.details : {};
  const parts = [];

  const addField = (label, key) => {
    const value = details[key];
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (!text) return;
    parts.push(`${label}: ${text}`);
  };

  addField('Campanha', 'campaignName');
  addField('Motorista', 'driverName');
  addField('Grafica', 'graphicName');
  addField('Fluxo', 'flowType');
  addField('Verificado', 'verified');
  addField('Removidos', 'deletedCount');
  addField('Motivo', 'reason');
  addField('Metodo', 'method');
  addField('Rota', 'path');
  if (Array.isArray(details.fields) && details.fields.length) {
    parts.push(`Campos: ${details.fields.join(', ')}`);
  }

  if (!parts.length) {
    const extras = Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${String(value)}`);
    if (extras.length) return escapeHTML(extras.join(' | '));
    return '-';
  }

  return escapeHTML(parts.join(' | '));
}

function renderLogs(logs, append = false) {
  if (!append) auditTableBody.innerHTML = '';

  if ((!logs || logs.length === 0) && !append) {
    auditTableBody.innerHTML =
      '<tr><td colspan="6" class="no-logs">Nenhum registro encontrado</td></tr>';
    loadMoreContainer.style.display = 'none';
    return;
  }

  (Array.isArray(logs) ? logs : []).forEach(log => {
    const row = document.createElement('tr');
    const success = log?.success !== false;
    const userLabel = log?.name || log?.username || 'Unknown';

    row.innerHTML = `
      <td class="timestamp">${escapeHTML(formatTimestamp(log?.timestamp))}</td>
      <td class="user-name">${escapeHTML(userLabel)}</td>
      <td>
        <span class="action-badge ${getActionBadgeClass(log?.action)}">
          ${escapeHTML(normalizeActionLabel(log?.action))}
        </span>
      </td>
      <td><span class="entity-chip">${escapeHTML(normalizeEntityLabel(log?.entityType))}</span></td>
      <td>
        <span class="status-badge ${success ? 'status-success' : 'status-failure'}">
          ${success ? 'Sucesso' : 'Falha'}
        </span>
      </td>
      <td class="details-cell">${formatDetails(log)}</td>
    `;
    auditTableBody.appendChild(row);
  });

  loadMoreContainer.style.display = logs.length >= LIMIT ? 'block' : 'none';
}

async function loadLogs(append = false) {
  try {
    const params = new URLSearchParams();
    params.set('limit', String(LIMIT));
    params.set('skip', String(append ? currentSkip : 0));
    Object.entries(currentFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        params.set(key, String(value));
      }
    });

    const response = await authFetch(`/api/admin/audit-logs?${params.toString()}`);
    if (response.status === 401) {
      logout();
      return;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const logs = Array.isArray(data?.logs) ? data.logs : [];
    renderLogs(logs, append);
    currentSkip = append ? currentSkip + logs.length : logs.length;
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
    auditTableBody.innerHTML =
      '<tr><td colspan="6" class="no-logs">Erro ao carregar logs</td></tr>';
    loadMoreContainer.style.display = 'none';
  }
}

function applyFilters() {
  currentFilters = {};
  if (filterUsername?.value?.trim()) currentFilters.username = filterUsername.value.trim();
  if (filterAction?.value) currentFilters.action = filterAction.value;
  if (filterEntityType?.value) currentFilters.entityType = filterEntityType.value;
  currentSkip = 0;
  loadLogs(false);
}

function clearFilters() {
  if (filterUsername) filterUsername.value = '';
  if (filterAction) filterAction.value = '';
  if (filterEntityType) filterEntityType.value = '';
  applyFilters();
}

if (btnFilter) btnFilter.addEventListener('click', applyFilters);
if (btnClearFilters) btnClearFilters.addEventListener('click', clearFilters);
if (btnLoadMore) btnLoadMore.addEventListener('click', () => loadLogs(true));

if (filterUsername) {
  filterUsername.addEventListener('keydown', event => {
    if (event.key === 'Enter') applyFilters();
  });
}

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

if (btnBackDashboard) {
  btnBackDashboard.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
}

if (btnClearAll) {
  btnClearAll.addEventListener('click', async () => {
    const confirm1 = window.prompt(
      'Esta acao APAGA TODO o historico de auditoria do MongoDB e nao pode ser desfeita.\n\nDigite "LIMPAR" para confirmar:',
    );
    if (confirm1 !== 'LIMPAR') return;
    btnClearAll.disabled = true;
    btnClearAll.textContent = 'Limpando...';
    try {
      const response = await authFetch('/api/admin/audit-logs', { method: 'DELETE' });
      if (response.status === 401) {
        logout();
        return;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `HTTP ${response.status}`);
      }
      const data = await response.json().catch(() => ({}));
      alert(`Historico apagado. Removidos: ${data.deletedCount || 0}`);
      currentSkip = 0;
      await loadLogs(false);
    } catch (err) {
      console.error('Erro ao limpar historico:', err);
      alert('Falha ao limpar historico: ' + (err?.message || err));
    } finally {
      btnClearAll.disabled = false;
      btnClearAll.textContent = 'Limpar historico (apaga TUDO)';
    }
  });
}

const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
if (adminUserName && adminUser?.name) {
  adminUserName.textContent = adminUser.name;
}

loadLogs(false);
