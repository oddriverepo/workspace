import '../assets/config.js';

const API_BASE = (window.API_BASE || '').replace(/\/$/, '');

const SUPPLIER_COLUMNS = [
  { key: 'fornecedor', label: 'Fornecedor', width: 220 },
  { key: 'praca', label: 'Praça', width: 160 },
  { key: 'estado', label: 'UF', width: 80 },
  { key: 'ativado', label: 'Ativado', width: 110, type: 'select', options: ['Sim', 'Não'] },
  { key: 'classificacao', label: 'Classificação', width: 150 },
  { key: 'observacoes', label: 'Observações', width: 220 },
  { key: 'contato', label: 'Contato', width: 150 },
  { key: 'email', label: 'E-mail', width: 220 },
  { key: 'telefone', label: 'Telefone', width: 140 },
  { key: 'celular', label: 'Celular', width: 140 },
  { key: 'odInPar', label: 'OD In Par', width: 110 },
  { key: 'odVt', label: 'OD VT', width: 100 },
  { key: 'odInVt', label: 'OD In VT', width: 110 },
  { key: 'odDoor', label: 'OD Door', width: 110 },
  { key: 'odInDoor', label: 'OD In Door', width: 120 },
  { key: 'odPack', label: 'OD Pack', width: 110 },
  { key: 'odInPack', label: 'OD In Pack', width: 120 },
  { key: 'odFull', label: 'OD Full', width: 110 },
  { key: 'odInFull', label: 'OD In Full', width: 120 },
  { key: 'odLight', label: 'OD Light', width: 110 },
  { key: 'odInLight', label: 'OD In Light', width: 120 },
  { key: 'odDrop', label: 'OD Drop', width: 110 },
  { key: 'odInDrop', label: 'OD In Drop', width: 120 },
  { key: 'adesivoOd', label: 'Adesivo OD', width: 120 },
  { key: 'remocao', label: 'Remoção', width: 120 },
  { key: 'observacaoFinal', label: 'Obs. final', width: 220 },
  { key: 'endereco', label: 'Endereço', width: 260 },
];

const SERVICE_COLUMNS = [
  { key: 'odInPar', label: 'OD In Par' },
  { key: 'odVt', label: 'OD VT' },
  { key: 'odInVt', label: 'OD In VT' },
  { key: 'odDoor', label: 'OD Door' },
  { key: 'odInDoor', label: 'OD In Door' },
  { key: 'odPack', label: 'OD Pack' },
  { key: 'odInPack', label: 'OD In Pack' },
  { key: 'odFull', label: 'OD Full' },
  { key: 'odInFull', label: 'OD In Full' },
  { key: 'odLight', label: 'OD Light' },
  { key: 'odInLight', label: 'OD In Light' },
  { key: 'odDrop', label: 'OD Drop' },
  { key: 'odInDrop', label: 'OD In Drop' },
  { key: 'adesivoOd', label: 'Adesivo OD' },
  { key: 'remocao', label: 'Remoção' },
];

const state = {
  suppliers: [],
  saleValues: [],
  activeTab: 'suppliers',
  loading: false,
  metricsOpen: false,
  filters: {
    search: '',
    city: '',
    state: '',
    active: '',
    classification: '',
    service: '',
    contact: '',
  },
};

const els = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  bindEvents();
  loadData();
}

function cacheElements() {
  Object.assign(els, {
    status: document.getElementById('suppliersStatus'),
    metricsToggle: document.getElementById('metricsToggle'),
    metricsPanel: document.getElementById('metricsPanel'),
    refresh: document.getElementById('refreshSuppliers'),
    newSupplier: document.getElementById('newSupplier'),
    suppliersCount: document.getElementById('suppliersCount'),
    saleValuesCount: document.getElementById('saleValuesCount'),
    filtersRow: document.getElementById('filtersRow'),
    search: document.getElementById('searchInput'),
    cityFilter: document.getElementById('cityFilter'),
    stateFilter: document.getElementById('stateFilter'),
    activeFilter: document.getElementById('activeFilter'),
    classificationFilter: document.getElementById('classificationFilter'),
    serviceFilter: document.getElementById('serviceFilter'),
    contactFilter: document.getElementById('contactFilter'),
    clearFilters: document.getElementById('clearFilters'),
    tableSummary: document.getElementById('tableSummary'),
    lastUpdate: document.getElementById('lastUpdate'),
    table: document.getElementById('suppliersTable'),
    emptyState: document.getElementById('emptyState'),
    metricTotal: document.getElementById('metricTotal'),
    metricCities: document.getElementById('metricCities'),
    metricActive: document.getElementById('metricActive'),
    metricInactive: document.getElementById('metricInactive'),
    metricClassifications: document.getElementById('metricClassifications'),
    modal: document.getElementById('supplierModal'),
    form: document.getElementById('supplierForm'),
    closeModal: document.getElementById('closeSupplierModal'),
    cancelModal: document.getElementById('cancelSupplier'),
  });
}

function bindEvents() {
  els.metricsToggle.addEventListener('click', () => {
    state.metricsOpen = !state.metricsOpen;
    els.metricsPanel.classList.toggle('is-hidden', !state.metricsOpen);
  });

  els.refresh.addEventListener('click', () => loadData(true));
  els.newSupplier.addEventListener('click', openSupplierModal);
  els.closeModal.addEventListener('click', closeSupplierModal);
  els.cancelModal.addEventListener('click', closeSupplierModal);
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) closeSupplierModal();
  });
  els.form.addEventListener('submit', createSupplier);

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });

  els.search.addEventListener('input', () => {
    state.filters.search = els.search.value.trim();
    renderTable();
  });
  els.cityFilter.addEventListener('change', () => {
    state.filters.city = els.cityFilter.value;
    renderTable();
  });
  els.stateFilter.addEventListener('change', () => {
    state.filters.state = els.stateFilter.value;
    renderTable();
  });
  els.activeFilter.addEventListener('change', () => {
    state.filters.active = els.activeFilter.value;
    renderTable();
  });
  els.classificationFilter.addEventListener('change', () => {
    state.filters.classification = els.classificationFilter.value;
    renderTable();
  });
  els.serviceFilter.addEventListener('change', () => {
    state.filters.service = els.serviceFilter.value;
    renderTable();
  });
  els.contactFilter.addEventListener('change', () => {
    state.filters.contact = els.contactFilter.value;
    renderTable();
  });
  els.clearFilters.addEventListener('click', clearFilters);

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'SMART_REFRESH') {
      loadData(true);
    }
  });
}

async function loadData(force = false) {
  if (state.loading) return;
  state.loading = true;
  setLoading(true);

  try {
    const data = await apiFetch(`/api/suppliers/data${force ? '?force=1' : ''}`);
    state.suppliers = normalizeRows(extractApiRows(data, ['suppliers', 'graficas', 'fornecedores']));
    state.saleValues = normalizeRows(extractApiRows(data, ['saleValues', 'values', 'valoresVenda']));
    els.status.textContent = `Sincronizado às ${formatTime(new Date())}`;
    populateFilters();
    render();
  } catch (error) {
    console.error('[suppliers] load error:', error);
    els.status.textContent = error.status === 503
      ? 'Integração pendente'
      : 'Falha ao carregar a tabela';
    state.suppliers = [];
    state.saleValues = [];
    render();
    showEmpty(error.status === 503
      ? 'Configure o Web App da planilha no backend para carregar os dados.'
      : 'Não foi possível carregar os dados agora.');
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('adminToken');
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

function extractApiRows(payload, keys = []) {
  const candidates = [];

  for (const key of keys) {
    candidates.push(
      payload?.[key],
      payload?.[key]?.items,
      payload?.data?.[key],
      payload?.data?.[key]?.items,
    );
  }

  candidates.push(
    payload?.items,
    payload?.data?.items,
    payload?.rows,
    payload?.data?.rows,
  );

  return candidates.find(Array.isArray) || [];
}

function normalizeRows(rows) {
  return Array.isArray(rows)
    ? rows.map((row, index) => ({
      ...row,
      rowNumber: Number(row.rowNumber || row.row || row._row || index + 2),
    }))
    : [];
}

function render() {
  renderTabs();
  renderMetrics();
  renderTable();
}

function renderTabs() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tab === state.activeTab);
  });
  els.suppliersCount.textContent = state.suppliers.length;
  els.saleValuesCount.textContent = state.saleValues.length;
  els.filtersRow.classList.toggle('is-hidden', state.activeTab !== 'suppliers');
}

function populateFilters() {
  state.filters.city = fillSelect(els.cityFilter, 'Todas', uniqueValues(state.suppliers, 'praca'), state.filters.city);
  state.filters.state = fillSelect(els.stateFilter, 'Todos', uniqueValues(state.suppliers, 'estado'), state.filters.state);
  state.filters.classification = fillSelect(
    els.classificationFilter,
    'Todas',
    uniqueValues(state.suppliers, 'classificacao'),
    state.filters.classification,
  );
  state.filters.service = fillSelect(els.serviceFilter, 'Todos', getAvailableServices(), state.filters.service);
  state.filters.active = syncStaticSelect(els.activeFilter, state.filters.active);
  state.filters.contact = syncStaticSelect(els.contactFilter, state.filters.contact);
}

function fillSelect(select, firstLabel, values, selectedValue = '') {
  select.innerHTML = '';
  select.appendChild(new Option(firstLabel, ''));
  values.forEach((value) => select.appendChild(new Option(value, value)));
  const nextValue = values.includes(selectedValue) ? selectedValue : '';
  select.value = nextValue;
  return nextValue;
}

function syncStaticSelect(select, selectedValue = '') {
  const hasOption = Array.from(select.options).some((option) => option.value === selectedValue);
  const nextValue = hasOption ? selectedValue : '';
  select.value = nextValue;
  return nextValue;
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => String(row[key] || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function renderMetrics() {
  const total = state.suppliers.length;
  const active = state.suppliers.filter(isActiveSupplier).length;
  const inactive = Math.max(total - active, 0);
  const cities = new Set(state.suppliers.map((item) => normalizeText(item.praca)).filter(Boolean)).size;
  const classifications = countBy(state.suppliers, 'classificacao');

  els.metricTotal.textContent = total;
  els.metricCities.textContent = cities;
  els.metricActive.textContent = active;
  els.metricInactive.textContent = inactive;
  els.metricClassifications.textContent = Object.keys(classifications).length
    ? Object.entries(classifications)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, count]) => `${label}: ${count}`)
      .join(' · ')
    : '-';
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = String(row[key] || '').trim() || 'Não definido';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function renderTable() {
  const rows = getActiveRows();
  const columns = getActiveColumns(rows);
  renderHead(columns);
  renderBody(rows, columns);
  els.tableSummary.textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'}`;
  els.lastUpdate.textContent = `Atualizado às ${formatTime(new Date())}`;
  els.emptyState.classList.toggle('is-hidden', rows.length > 0);
}

function getActiveRows() {
  if (state.activeTab === 'saleValues') {
    return state.saleValues;
  }

  const search = normalizeText(state.filters.search);
  return state.suppliers.filter((row) => {
    if (state.filters.city && normalizeText(row.praca) !== normalizeText(state.filters.city)) return false;
    if (state.filters.state && normalizeText(row.estado) !== normalizeText(state.filters.state)) return false;
    if (state.filters.classification && normalizeText(row.classificacao) !== normalizeText(state.filters.classification)) return false;
    if (state.filters.active === 'active' && !isActiveSupplier(row)) return false;
    if (state.filters.active === 'inactive' && isActiveSupplier(row)) return false;
    if (state.filters.service && !hasService(row, state.filters.service)) return false;
    if (state.filters.contact && !matchesContactFilter(row, state.filters.contact)) return false;

    if (!search) return true;
    return buildSupplierSearchHaystack(row).includes(search);
  });
}

function buildSupplierSearchHaystack(row) {
  const serviceValues = SERVICE_COLUMNS.flatMap((service) => [
    service.label,
    row[service.key],
  ]);

  return [
    row.fornecedor,
    row.praca,
    row.estado,
    row.ativado,
    row.classificacao,
    row.observacoes,
    row.observacaoFinal,
    row.contato,
    row.email,
    row.telefone,
    row.celular,
    row.endereco,
    ...serviceValues,
  ].map(normalizeText).join(' ');
}

function rowMatchesGenericSearch(row, search) {
  return Object.entries(row || {})
    .filter(([key]) => !['rowNumber', 'row', '_row'].includes(key))
    .some(([, value]) => normalizeText(value).includes(search));
}

function clearFilters() {
  state.filters = {
    search: '',
    city: '',
    state: '',
    active: '',
    classification: '',
    service: '',
    contact: '',
  };
  els.search.value = '';
  els.cityFilter.value = '';
  els.stateFilter.value = '';
  els.activeFilter.value = '';
  els.classificationFilter.value = '';
  els.serviceFilter.value = '';
  els.contactFilter.value = '';
  renderTable();
}

function getAvailableServices() {
  return SERVICE_COLUMNS
    .filter((service) => state.suppliers.some((row) => hasService(row, service.key)))
    .map((service) => service.label);
}

function hasService(row, serviceValue) {
  const service = SERVICE_COLUMNS.find((item) => item.key === serviceValue || item.label === serviceValue);
  if (!service) return false;
  return hasUsefulValue(row[service.key]);
}

function hasUsefulValue(value) {
  const text = normalizeText(value);
  return Boolean(text && !['nao', 'não', 'n/a', 'na', '-', '0', 'false'].includes(text));
}

function matchesContactFilter(row, filter) {
  const hasPhone = hasUsefulValue(row.telefone) || hasUsefulValue(row.celular);
  const hasEmail = hasUsefulValue(row.email);

  if (filter === 'with_contact') return hasPhone;
  if (filter === 'missing_contact') return !hasPhone;
  if (filter === 'with_email') return hasEmail;
  if (filter === 'missing_email') return !hasEmail;
  return true;
}

function getActiveColumns(rows) {
  if (state.activeTab === 'suppliers') return SUPPLIER_COLUMNS;

  const ignored = new Set(['rowNumber', 'row', '_row']);
  const keys = [];
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!ignored.has(key) && !keys.includes(key)) keys.push(key);
    });
  });

  return keys.map((key) => ({
    key,
    label: humanizeKey(key),
    width: Math.max(130, Math.min(240, humanizeKey(key).length * 12)),
  }));
}

function renderHead(columns) {
  const thead = els.table.querySelector('thead');
  const tr = document.createElement('tr');
  columns.forEach((column) => {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (column.width) th.style.minWidth = `${column.width}px`;
    tr.appendChild(th);
  });
  thead.replaceChildren(tr);
}

function renderBody(rows, columns) {
  const tbody = els.table.querySelector('tbody');
  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    columns.forEach((column) => {
      const td = document.createElement('td');
      td.appendChild(createCellControl(row, column));
      tr.appendChild(td);
    });
    fragment.appendChild(tr);
  });

  tbody.replaceChildren(fragment);
}

function createCellControl(row, column) {
  if (column.key === 'ativado') {
    const wrapper = document.createElement('div');
    const select = document.createElement('select');
    select.className = 'cell-select';
    column.options.forEach((option) => select.appendChild(new Option(option, option)));
    select.value = valueToActiveLabel(row[column.key]);
    select.addEventListener('change', () => saveCell(row, column.key, select.value, select));

    const pill = document.createElement('span');
    pill.className = `status-pill ${isActiveSupplier({ ativado: select.value }) ? 'active' : 'inactive'}`;
    pill.textContent = select.value;

    select.addEventListener('change', () => {
      pill.className = `status-pill ${isActiveSupplier({ ativado: select.value }) ? 'active' : 'inactive'}`;
      pill.textContent = select.value;
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  const input = document.createElement('input');
  input.className = 'cell-input';
  input.value = row[column.key] ?? '';
  input.dataset.initialValue = input.value;
  input.addEventListener('blur', () => {
    if (input.value !== input.dataset.initialValue) {
      saveCell(row, column.key, input.value, input);
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      input.value = input.dataset.initialValue;
      input.blur();
    }
  });
  return input;
}

async function saveCell(row, key, value, control) {
  if (!row.rowNumber) return;

  const endpoint = state.activeTab === 'suppliers'
    ? `/api/suppliers/suppliers/${row.rowNumber}`
    : `/api/suppliers/sale-values/${row.rowNumber}`;

  control.classList.remove('cell-error');
  control.classList.add('cell-saving');

  try {
    await apiFetch(endpoint, {
      method: 'PATCH',
      body: JSON.stringify({ values: { [key]: value } }),
    });
    row[key] = value;
    control.dataset.initialValue = value;
    els.status.textContent = `Alteração salva às ${formatTime(new Date())}`;
    renderMetrics();
  } catch (error) {
    console.error('[suppliers] save error:', error);
    control.classList.add('cell-error');
    els.status.textContent = 'Falha ao salvar alteração';
  } finally {
    control.classList.remove('cell-saving');
  }
}

function openSupplierModal() {
  els.form.reset();
  els.modal.classList.remove('is-hidden');
  setTimeout(() => els.form.elements.fornecedor?.focus(), 0);
}

function closeSupplierModal() {
  els.modal.classList.add('is-hidden');
}

async function createSupplier(event) {
  event.preventDefault();
  const submitButton = els.form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  const values = Object.fromEntries(new FormData(els.form).entries());

  try {
    await apiFetch('/api/suppliers/suppliers', {
      method: 'POST',
      body: JSON.stringify({ values }),
    });
    closeSupplierModal();
    await loadData(true);
    els.status.textContent = `Nova gráfica criada às ${formatTime(new Date())}`;
  } catch (error) {
    console.error('[suppliers] create error:', error);
    els.status.textContent = 'Falha ao criar gráfica';
  } finally {
    submitButton.disabled = false;
  }
}

function setLoading(isLoading) {
  els.refresh.disabled = isLoading;
  els.newSupplier.disabled = isLoading;
  els.refresh.textContent = isLoading ? 'Atualizando...' : 'Atualizar';
}

function showEmpty(message) {
  els.emptyState.classList.remove('is-hidden');
  els.emptyState.querySelector('span').textContent = message;
}

function isActiveSupplier(row) {
  const value = normalizeText(row?.ativado);
  return ['sim', 'ativo', 'ativa', 'true', '1', 'yes', 'y'].includes(value);
}

function valueToActiveLabel(value) {
  return isActiveSupplier({ ativado: value }) ? 'Sim' : 'Não';
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function humanizeKey(key) {
  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(date) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
