// Admin users management
const API_BASE = window.API_BASE || '';
let adminToken = localStorage.getItem('adminToken');

function authFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  return fetch(fullUrl, { ...options, headers });
}

async function api(url, options = {}) {
  const res = await authFetch(url, options);
  if (res.status === 401) { logout(); throw new Error('Sessão expirada'); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

function logout() {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  const workspaceUrl = window.WORKSPACE_CONFIG?.WORKSPACE_URL || window.location.origin.replace('backend', 'workspace');
  window.location.href = `${workspaceUrl}/login.html`;
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(value) {
  if (!value) return '—';
  try {
    const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
    if (isNaN(d.valueOf())) return String(value);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return String(value); }
}

const usersListEl = document.getElementById('usersList');
const rightTitleEl = document.getElementById('rightTitle');
const rightBodyEl = document.getElementById('rightBody');
const btnNew = document.getElementById('btnNew');
const btnBack = document.getElementById('btnBackDashboard');
const btnLogout = document.getElementById('btnLogout');
const adminNameEl = document.getElementById('adminUserName');

let users = [];
let selectedId = null;

btnLogout.addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (_) {}
  logout();
});
btnBack.addEventListener('click', () => {
  window.location.href = './index.html';
});
btnNew.addEventListener('click', () => renderForm(null));

async function loadMe() {
  try {
    const me = await api('/api/admin/me');
    adminNameEl.textContent = me.user?.name || me.user?.username || '';
  } catch (_) {}
}

async function loadUsers() {
  try {
    const data = await api('/api/admin/users');
    users = Array.isArray(data.items) ? data.items : [];
    renderUsersList();
  } catch (err) {
    usersListEl.innerHTML = `<div class="empty">Erro: ${esc(err.message)}</div>`;
  }
}

function renderUsersList() {
  if (!users.length) {
    usersListEl.innerHTML = '<div class="empty">Nenhum usuário cadastrado.</div>';
    return;
  }
  usersListEl.innerHTML = users.map(u => {
    const roleBadge = u.role === 'viewer'
      ? '<span class="badge badge--viewer">viewer</span>'
      : '<span class="badge badge--admin">admin</span>';
    const inactiveBadge = u.active ? '' : '<span class="badge badge--inactive">inativo</span>';
    const active = u.id === selectedId ? ' active' : '';
    return `<div class="user-row${active}" data-id="${esc(u.id)}">
      <div class="uname">${esc(u.name || u.username)}</div>
      <div class="umeta">@${esc(u.username)} ${roleBadge} ${inactiveBadge}</div>
    </div>`;
  }).join('');
  usersListEl.querySelectorAll('.user-row').forEach(el => {
    el.addEventListener('click', () => selectUser(el.dataset.id));
  });
}

async function selectUser(id) {
  selectedId = id;
  renderUsersList();
  const user = users.find(u => u.id === id);
  if (!user) return;
  rightTitleEl.innerHTML = `${esc(user.name)} <span style="font-weight:400;color:#5f6b7b;font-size:.8rem;">@${esc(user.username)}</span>`;
  rightBodyEl.innerHTML = '<div class="empty">Carregando atividade...</div>';
  try {
    const data = await api(`/api/admin/users/${encodeURIComponent(id)}/activity?limit=200`);
    renderUserDetail(data, user);
  } catch (err) {
    rightBodyEl.innerHTML = `<div class="empty">Erro ao carregar: ${esc(err.message)}</div>`;
  }
}

function renderUserDetail(data, user) {
  const stats = data.stats || {};
  const events = Array.isArray(data.events) ? data.events : [];
  const eventsHtml = events.length
    ? events.map(ev => {
        if (ev.type === 'dispatch') {
          const t = ev.totals || {};
          return `<div class="event event--dispatch">
            <div class="event-title">📤 Disparo: ${esc(ev.title || '(sem nome)')}</div>
            <div>${t.sent || 0} enviados · ${t.failed || 0} falhas · template: ${esc(ev.templateName || '—')}</div>
            <div class="when">${esc(fmtDate(ev.at))}</div>
          </div>`;
        }
        if (ev.type === 'conversation') {
          return `<div class="event event--conversation">
            <div class="event-title">💬 Iniciou conversa com ${esc(ev.contactName || ev.phoneE164 || '—')}</div>
            <div>${esc(ev.phoneE164 || '')}</div>
            <div class="when">${esc(fmtDate(ev.at))}</div>
          </div>`;
        }
        return `<div class="event event--audit">
          <div class="event-title">🔐 ${esc(ev.action || 'audit')} ${ev.success === false ? '(falha)' : ''}</div>
          <div class="when">${esc(fmtDate(ev.at))}</div>
        </div>`;
      }).join('')
    : '<div class="empty">Nenhuma atividade registrada.</div>';

  rightBodyEl.innerHTML = `
    <div class="form">
      <div class="form-actions" style="justify-content:flex-start;gap:8px;">
        <button class="btn" id="btnEdit">Editar</button>
        <button class="btn" id="btnToggle" style="background:${user.active ? '#c0392b' : '#10a37f'};color:#fff;border:none;">
          ${user.active ? 'Desativar' : 'Reativar'}
        </button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${stats.dispatches || 0}</div><div class="l">Disparos</div></div>
      <div class="stat"><div class="n">${stats.conversations || 0}</div><div class="l">Conversas</div></div>
      <div class="stat"><div class="n">${stats.auditEntries || 0}</div><div class="l">Logs</div></div>
    </div>
    <div class="events">${eventsHtml}</div>
  `;

  document.getElementById('btnEdit').addEventListener('click', () => renderForm(user));
  document.getElementById('btnToggle').addEventListener('click', async () => {
    if (!confirm(`${user.active ? 'Desativar' : 'Reativar'} ${user.name}?`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !user.active }),
      });
      await loadUsers();
      selectUser(user.id);
    } catch (err) { alert('Erro: ' + err.message); }
  });
}

function renderForm(user) {
  selectedId = user?.id || null;
  renderUsersList();
  const isNew = !user;
  rightTitleEl.textContent = isNew ? 'Novo operador' : `Editar @${user.username}`;
  rightBodyEl.innerHTML = `
    <form class="form" id="userForm">
      <label>Nome de exibição
        <input type="text" id="fName" required value="${esc(user?.name || '')}" />
      </label>
      <label>Username (login)
        <input type="text" id="fUsername" required ${isNew ? '' : 'disabled'} value="${esc(user?.username || '')}" />
      </label>
      <label>E-mail (opcional)
        <input type="email" id="fEmail" value="${esc(user?.email || '')}" />
      </label>
      <label>Papel
        <select id="fRole">
          <option value="admin" ${(!user || user.role === 'admin') ? 'selected' : ''}>Admin (acesso total)</option>
          <option value="viewer" ${user?.role === 'viewer' ? 'selected' : ''}>Viewer (somente leitura)</option>
        </select>
      </label>
      <label>${isNew ? 'Senha' : 'Nova senha (deixe em branco para manter)'}
        <input type="password" id="fPassword" ${isNew ? 'required' : ''} minlength="6" />
      </label>
      <div class="form-actions">
        <button type="button" class="btn" id="btnCancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">${isNew ? 'Criar' : 'Salvar'}</button>
      </div>
    </form>
  `;

  document.getElementById('btnCancel').addEventListener('click', () => {
    if (user) selectUser(user.id);
    else { selectedId = null; renderUsersList(); rightTitleEl.textContent = 'Selecione um operador'; rightBodyEl.innerHTML = '<div class="empty">Selecione um operador na lista.</div>'; }
  });

  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('fName').value.trim(),
      email: document.getElementById('fEmail').value.trim() || null,
      role: document.getElementById('fRole').value,
    };
    const password = document.getElementById('fPassword').value;
    if (password) payload.password = password;
    try {
      if (isNew) {
        payload.username = document.getElementById('fUsername').value.trim();
        const data = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
        await loadUsers();
        if (data?.item?.id) selectUser(data.item.id);
      } else {
        await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
        await loadUsers();
        selectUser(user.id);
      }
    } catch (err) { alert('Erro: ' + err.message); }
  });
}

if (!adminToken) { logout(); }
loadMe();
loadUsers();
