(function () {
  'use strict';

  const API_BASE = window.API_BASE || '';
  const TOKEN = localStorage.getItem('adminToken') || '';

  const refs = {
    filterState: document.getElementById('filterState'),
    filterCity: document.getElementById('filterCity'),
    filterCampaign: document.getElementById('filterCampaign'),
    filterSearch: document.getElementById('filterSearch'),
    filterResult: document.getElementById('filterResult'),
    totalCount: document.getElementById('totalCount'),
    crmBody: document.getElementById('crmBody'),
    crmTable: document.getElementById('crmTable'),
    tableWrap: document.getElementById('tableWrap'),
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnExportDrivers: document.getElementById('btnExportDrivers'),
    bulkTargetInfo: document.getElementById('bulkTargetInfo'),
    bulkMessageMode: document.getElementById('bulkMessageMode'),
    bulkIsInvite: document.getElementById('bulkIsInvite'),
    bulkTemplateSelect: document.getElementById('bulkTemplateSelect'),
    bulkText: document.getElementById('bulkText'),
    bulkTemplateWrap: document.getElementById('bulkTemplateWrap'),
    bulkTextWrap: document.getElementById('bulkTextWrap'),
    bulkFeedback: document.getElementById('bulkFeedback'),
    btnBulkSend: document.getElementById('btnBulkSend'),
    driverModal: document.getElementById('driverModal'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    btnCloseModal: document.getElementById('btnCloseModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalComposerContext: document.getElementById('modalComposerContext'),
    modalCampaignSelect: document.getElementById('modalCampaignSelect'),
    modalMessageMode: document.getElementById('modalMessageMode'),
    modalIsInvite: document.getElementById('modalIsInvite'),
    modalTemplateSelect: document.getElementById('modalTemplateSelect'),
    modalText: document.getElementById('modalText'),
    modalTemplateWrap: document.getElementById('modalTemplateWrap'),
    modalTextWrap: document.getElementById('modalTextWrap'),
    modalFeedback: document.getElementById('modalFeedback'),
    btnSendSingle: document.getElementById('btnSendSingle'),
    modalOverview: document.getElementById('modalOverview'),
    modalCampaignList: document.getElementById('modalCampaignList'),
    modalHistoryTitle: document.getElementById('modalHistoryTitle'),
    modalHistoryStatus: document.getElementById('modalHistoryStatus'),
    modalTimeline: document.getElementById('modalTimeline'),
    btnBlockDriver: document.getElementById('btnBlockDriver'),
    blockReasonSection: document.getElementById('blockReasonSection'),
    blockReasonInput: document.getElementById('blockReasonInput'),
    btnConfirmBlock: document.getElementById('btnConfirmBlock'),
    btnCancelBlock: document.getElementById('btnCancelBlock'),
    blockReasonError: document.getElementById('blockReasonError'),
  };

  const state = {
    allDrivers: [],
    filtered: [],
    driversById: new Map(),
    allCampaigns: [],
    campaignsById: new Map(),
    templates: [],
    cachedStates: [],
    cachedCitiesByState: new Map(),
    cachedCitiesAll: [],
    cityFilterKeyAliases: new Map(),
    historyCache: new Map(),
    renderToken: 0,
    modal: {
      open: false,
      driverId: '',
      selectedCampaignId: '',
      history: [],
      summary: createEmptySummary(),
    },
  };

  const ROW_INITIAL_BATCH = 120;
  const ROW_CHUNK_SIZE = 200;
  const VIRTUAL_ROW_HEIGHT = 44;
  const VIRTUAL_BUFFER_ROWS = 8;
  const TABLE_COLUMN_COUNT = 14;
  const EXPORT_COLUMNS = [
    { key: 'nome', header: 'Nome' },
    { key: 'telefone', header: 'Telefone' },
    { key: 'cidade', header: 'Cidade' },
    { key: 'uf', header: 'UF' },
    { key: 'campanhaAtual', header: 'Campanha atual' },
    { key: 'placa', header: 'Placa' },
    { key: 'modelo', header: 'Modelo' },
    { key: 'cpf', header: 'CPF' },
    { key: 'pix', header: 'PIX' },
    { key: 'email', header: 'Email' },
    { key: 'apps', header: 'Apps' },
    { key: 'rating', header: 'Rating' },
    { key: 'periodo', header: 'Periodo' },
    { key: 'cadastro', header: 'Cadastro' },
  ];

  let virtualScrollRaf = 0;

  const WORKSPACE_OUTREACH_CAMPAIGN_ID = '__motoristas__';
  const WORKSPACE_OUTREACH_CAMPAIGN_NAME = 'Motoristas / Sem campanha';
  const DRIVER_DOCUMENT_FIELDS = [
    { key: 'driverDocument', label: 'Documento' },
    { key: 'driverLicense', label: 'CNH' },
    { key: 'proofOfAddress', label: 'Comprovante' },
    { key: 'vehicleRegistration', label: 'Documento do veiculo' },
    { key: 'appRating', label: 'Avaliacao do app' },
  ];
  const DRIVER_DOCUMENT_STATUS_LABELS = {
    approved: 'Aprovado',
    pending: 'Pendente',
    rejected: 'Reprovado',
    refused: 'Reprovado',
    review: 'Em analise',
    reviewing: 'Em analise',
    awaiting: 'Aguardando',
    uploaded: 'Enviado',
  };

  const bulkComposer = {
    modeSelect: refs.bulkMessageMode,
    inviteToggle: refs.bulkIsInvite,
    templateSelect: refs.bulkTemplateSelect,
    textInput: refs.bulkText,
    templateWrap: refs.bulkTemplateWrap,
    textWrap: refs.bulkTextWrap,
    feedback: refs.bulkFeedback,
  };

  const modalComposer = {
    modeSelect: refs.modalMessageMode,
    inviteToggle: refs.modalIsInvite,
    templateSelect: refs.modalTemplateSelect,
    textInput: refs.modalText,
    templateWrap: refs.modalTemplateWrap,
    textWrap: refs.modalTextWrap,
    feedback: refs.modalFeedback,
    resolveCampaignId: getModalDispatchCampaignId,
  };

  async function parseResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_err) {
      return { raw: text };
    }
  }

  async function requestJson(url, options) {
    const config = options || {};
    const method = String(config.method || 'GET').toUpperCase();
    const retries = method === 'GET' ? 3 : 0;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const headers = { Authorization: 'Bearer ' + TOKEN };
        let body = config.body;

        if (body && !(body instanceof FormData)) {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(body);
        }

        const response = await fetch(url, {
          method,
          headers,
          body,
        });
        const payload = await parseResponse(response);

        if (!response.ok) {
          const error = new Error(
            payload?.error?.message || payload?.error || ('HTTP ' + response.status),
          );
          error.status = response.status;
          error.payload = payload;
          throw error;
        }

        return payload;
      } catch (err) {
        const isNetworkError = !err.status && (
          err.message === 'Failed to fetch' ||
          err.message === 'NetworkError when attempting to fetch resource.'
        );
        if (isNetworkError && attempt < retries) {
          refs.loadingState.textContent = 'Aguardando servidor... (' + (attempt + 1) + '/' + retries + ')';
          await new Promise(function (resolve) { setTimeout(resolve, 1500 * (attempt + 1)); });
          continue;
        }
        throw err;
      }
    }

    return {};
  }

  async function loadData(forceRefresh) {
    refs.loadingState.style.display = '';
    refs.crmTable.style.display = 'none';
    refs.emptyState.classList.add('hidden');
    refs.loadingState.textContent = forceRefresh
      ? 'Atualizando lista do servidor...'
      : 'Carregando motoristas...';

    try {
      state.historyCache.clear();

      const results = await Promise.all([
        requestJson(API_BASE + '/api/drivers'),
        requestJson(API_BASE + '/api/campaigns/summary').catch(function () { return []; }),
        requestJson(API_BASE + '/api/campaigns/dispatch/templates').catch(function () { return { ok: true, items: [] }; }),
      ]);

      const driverData = results[0] || {};
      const campaignData = results[1] || [];
      const templateData = results[2] || {};
      const campaigns = Array.isArray(campaignData)
        ? campaignData
        : (campaignData.items || campaignData.campaigns || []);
      const templates = Array.isArray(templateData.items) ? templateData.items : [];

      state.allDrivers = (driverData.items || []).slice().sort(function (left, right) {
        return String(left.name || '').localeCompare(String(right.name || ''));
      });
      indexDrivers();
      state.allCampaigns = campaigns
        .map(function (campaign) {
          return {
            id: String(campaign.id || campaign._id || '').trim(),
            name: campaign.name || campaign.id || '',
          };
        })
        .filter(function (campaign) { return campaign.id; })
        .sort(function (left, right) {
          return String(left.name || '').localeCompare(String(right.name || ''));
        });
      state.campaignsById = new Map(state.allCampaigns.map(function (campaign) {
        return [campaign.id, campaign];
      }));
      state.templates = templates.slice().sort(function (left, right) {
        return String(left.name || '').localeCompare(String(right.name || ''));
      });

      populateFilters();
      populateComposerOptions();
      applyFilters();

      if (state.modal.open) {
        renderModalShell();
        loadDriverHistory(state.modal.driverId, true);
      }
    } catch (err) {
      console.error('Erro ao carregar motoristas:', err);
      refs.loadingState.textContent = 'Erro ao carregar. Tente novamente.';
    }
  }

  function setSelectOptions(select, items, emptyLabel, selectedValue) {
    const options = ['<option value="">' + esc(emptyLabel || 'Todos') + '</option>'];
    items.forEach(function (item) {
      options.push('<option value="' + esc(item.value) + '">' + esc(item.label) + '</option>');
    });
    select.innerHTML = options.join('');
    if (selectedValue && items.some(function (item) { return item.value === selectedValue; })) {
      select.value = selectedValue;
    }
  }

  function populateFilters() {
    const previousState = refs.filterState.value;
    const previousCity = refs.filterCity.value;
    const previousCampaign = refs.filterCampaign.value;

    setSelectOptions(refs.filterState, state.cachedStates.map(function (entry) {
      return { value: entry[0], label: entry[1] };
    }), 'Todos', previousState);

    const campaignOptions = state.allCampaigns.map(function (campaign) {
      return { value: campaign.id, label: campaign.name };
    });
    refs.filterCampaign.innerHTML = '<option value="">Todas</option>' +
      '<option value="__none__">Sem campanha</option>' +
      '<option value="__none_incomplete__">Sem campanha - cadastro incompleto</option>' +
      '<option value="__partner_leads__">Leads dos representantes</option>' +
      campaignOptions.map(function (campaign) {
        return '<option value="' + esc(campaign.value) + '">' + esc(campaign.label) + '</option>';
      }).join('');
    refs.filterCampaign.value = campaignOptions.some(function (item) { return item.value === previousCampaign; })
      || previousCampaign === '__none__'
      || previousCampaign === '__none_incomplete__'
      || previousCampaign === '__partner_leads__'
      ? previousCampaign
      : '';

    updateCityOptions(previousCity);
  }

  function populateComposerOptions() {
    const templateOptions = state.templates.map(function (template) {
      return '<option value="' + esc(String(template.id || '')) + '">' + esc(template.name || template.id || '') + '</option>';
    }).join('');

    populateModalCampaignOptions();

    const templateSelects = [refs.bulkTemplateSelect, refs.modalTemplateSelect];
    templateSelects.forEach(function (select) {
      const current = select.value;
      select.innerHTML = '<option value="">Selecione</option>' + templateOptions;
      if (current && state.templates.some(function (item) { return String(item.id || '') === current; })) {
        select.value = current;
      }
    });

    toggleComposerMode(bulkComposer);
    toggleComposerMode(modalComposer);
  }

  function updateCityOptions(previousCity) {
    const selectedState = refs.filterState.value;
    // selectedState agora é sigla UF (ex: "SP"); citiesByState usa a mesma chave
    const cities = selectedState
      ? (state.cachedCitiesByState.get(selectedState) || [])
      : state.cachedCitiesAll;
    setSelectOptions(refs.filterCity, cities.map(function (entry) {
      return { value: entry[0], label: entry[1] };
    }), 'Todas', previousCity);
  }

  function applyFilters() {
    const selectedState = refs.filterState.value;
    const selectedCity = refs.filterCity.value;
    const selectedCampaign = getDriverCampaignFilterId();
    const query = normalize(refs.filterSearch.value);

    // Modo especial: leads de parceiros
    if (selectedCampaign === '__partner_leads__') {
      loadAndRenderLeads(query);
      return;
    }

    state.filtered = state.allDrivers.filter(function (driver) {
      if (driver._isLead) return false; // garante que leads não vazam no modo normal
      if (selectedState && getDriverFilterState(driver) !== selectedState) return false;
      if (selectedCity && getCityFilterKey(driver) !== selectedCity) return false;
      if (selectedCampaign === '__none__' && getCurrentCampaignId(driver)) return false;
      if (selectedCampaign === '__none_incomplete__') {
        if (getCurrentCampaignId(driver)) return false;
        if (isDriverRegistrationComplete(driver)) return false;
      }
      if (
        selectedCampaign &&
        selectedCampaign !== '__none__' &&
        selectedCampaign !== '__none_incomplete__' &&
        getCurrentCampaignId(driver) !== selectedCampaign
      ) return false;
      if (query && !matchesSearch(driver, query)) return false;
      return true;
    });

    renderTable();
    renderBulkState();
  }

  async function loadAndRenderLeads(searchQuery) {
    refs.loadingState.style.display = '';
    refs.crmTable.style.display = 'none';
    refs.emptyState.classList.add('hidden');
    refs.loadingState.textContent = 'Carregando leads dos representantes...';
    try {
      var data = await requestJson(API_BASE + '/api/partner-leads');
      var leads = (data.items || []).map(function (lead) {
        return {
          _id: lead.id,
          _isLead: true,
          name:    lead.nome    || '',
          phone:   lead.telefone|| '',
          email:   lead.email   || '',
          cpf:     lead.cpf     || '',
          pix:     '',
          plate:   lead.veiculo_placa || '',
          ratingApp: lead.status || '',
          operationPeriod: lead.origem || '',
          createdAt: lead.created_at || null,
          campaignData: { vehicleId: (lead.veiculo_marca ? lead.veiculo_marca + ' ' + (lead.veiculo_modelo || '') : '').trim() },
          _location: { city: lead.cidade || '', state: lead.estado || '' },
          _lead_ref_code:    lead.ref_code    || '',
          _lead_partner_name: lead.partner_name || '',
          _lead_source: lead.source || '',
          outreachSummary: createEmptySummary(),
        };
      });
      // Filtro de busca local
      var q = normalize(searchQuery || '');
      if (q) {
        leads = leads.filter(function (d) { return matchesSearch(d, q); });
      }
      state.filtered = leads;
      refs.loadingState.style.display = 'none';
      refs.crmTable.style.display = '';
      renderTable();
      renderBulkState();
    } catch (err) {
      console.error('[motoristas] loadAndRenderLeads error:', err);
      refs.loadingState.textContent = 'Erro ao carregar leads. Tente novamente.';
    }
  }

  function matchesOperationalFilter(driver, selectedStatus) {
    if (!selectedStatus) {
      return true;
    }

    var operational = getOperationalSummary(driver);
    if (selectedStatus === 'never_contacted') {
      return operational.neverContacted;
    }
    if (selectedStatus === 'first_contact') {
      return operational.firstOutboundPending;
    }
    if (selectedStatus === 'window_open') {
      return operational.serviceWindowOpen;
    }
    if (selectedStatus === 'template_only') {
      return operational.allowsTemplate && !operational.allowsText;
    }
    if (selectedStatus === 'contact_blocked') {
      return operational.hardBlockCode === 'CONTACT_BLOCKED' || operational.hardBlockCode === 'OPT_OUT_ACTIVE';
    }
    if (selectedStatus === 'cooldown_active') {
      return operational.hardBlockCode === 'COOLDOWN_ACTIVE';
    }
    if (selectedStatus === 'marketing_opt_out') {
      return operational.marketingOptOut === true;
    }
    if (selectedStatus === 'responded') {
      return Number(operational.totalMessagesReceived || 0) > 0;
    }
    if (selectedStatus === 'history') {
      return Number(operational.totalMessagesSent || 0) > 0 || Number(operational.totalMessagesReceived || 0) > 0;
    }
    return true;
  }

  function matchesInviteFilter(driver, selectedCampaignId, selectedStatus) {
    const summary = driver.outreachSummary || createEmptySummary();
    const relevant = selectedCampaignId
      ? summary.byCampaign.filter(function (item) { return item.campaignId === selectedCampaignId; })
      : summary.byCampaign;

    if (!selectedStatus) {
      return true;
    }

    if (selectedStatus === 'invited') {
      return relevant.some(function (item) { return item.hasInvite; });
    }
    if (selectedStatus === 'awaiting') {
      return relevant.some(function (item) {
        return ['sent', 'delivered', 'read', 'simulated'].indexOf(item.status) >= 0;
      });
    }
    return relevant.some(function (item) { return item.status === selectedStatus; });
  }

  function matchesSearch(driver, query) {
    if (!query) return true;
    const idx = driver._searchIndex;
    if (typeof idx === 'string') {
      return idx.indexOf(query) >= 0;
    }
    return buildDriverSearchIndex(driver).indexOf(query) >= 0;
  }

  function buildDriverSearchIndex(driver) {
    const parts = [
      driver.name,
      driver.phone,
      driver.plate,
      driver.cpf,
      driver.pix,
      driver.email,
      driver.campaignData?.vehicleId || '',
      getCity(driver),
      getState(driver),
      getCampaignName(getCurrentCampaignId(driver)),
    ];
    const value = normalize(parts.join(' '));
    try {
      Object.defineProperty(driver, '_searchIndex', {
        value: value,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch (_err) {
      driver._searchIndex = value;
    }
    return value;
  }

  function indexDrivers() {
    state.driversById = new Map();
    // statesMap: key = sigla UF canônica → label = sigla UF
    // citiesAllMap/citiesByState: key = normalizePlace(canonical) → label = canonical
    const statesMap = new Map();
    const citiesAllMap = new Map();
    const citiesByState = new Map(); // key = sigla UF → Map<cityKey, cityLabel>
    const cityEntries = [];
    for (let i = 0; i < state.allDrivers.length; i += 1) {
      const driver = state.allDrivers[i];
      const id = getDriverId(driver);
      if (id) state.driversById.set(id, driver);
      const uf = getDriverFilterState(driver);   // sempre sigla (ex: "RJ")
      const cityEntry = getCityFilterEntry(driver);
      if (uf) {
        if (!statesMap.has(uf)) statesMap.set(uf, uf);
      }
      if (cityEntry.rawKey) {
        cityEntries.push(cityEntry);
      }
    }
    state.cityFilterKeyAliases = buildCityFilterAliases(cityEntries);
    for (let i = 0; i < cityEntries.length; i += 1) {
      const entry = cityEntries[i];
      const cityKey = resolveCityFilterKey(entry.rawKey, entry.uf);
      const cityLabel = getPreferredCityLabel(cityKey, entry.label);
      if (!cityKey) continue;
      citiesAllMap.set(cityKey, chooseCityFilterLabel(citiesAllMap.get(cityKey), cityLabel));
      if (entry.uf) {
        let bucket = citiesByState.get(entry.uf);
        if (!bucket) { bucket = new Map(); citiesByState.set(entry.uf, bucket); }
        bucket.set(cityKey, chooseCityFilterLabel(bucket.get(cityKey), cityLabel));
      }
    }
    const sortEntries = function (map) {
      return Array.from(map.entries()).sort(function (a, b) { return a[1].localeCompare(b[1]); });
    };
    state.cachedStates = sortEntries(statesMap);
    state.cachedCitiesAll = sortEntries(citiesAllMap);
    const citiesByStateSorted = new Map();
    citiesByState.forEach(function (map, uf) {
      citiesByStateSorted.set(uf, sortEntries(map));
    });
    state.cachedCitiesByState = citiesByStateSorted;
  }

  function renderTable() {
    refs.loadingState.style.display = 'none';
    refs.totalCount.textContent = state.allDrivers.length + ' motoristas';
    refs.filterResult.textContent = state.filtered.length !== state.allDrivers.length
      ? state.filtered.length + ' resultado(s)'
      : '';

    state.renderToken = (state.renderToken + 1) >>> 0;

    if (!state.filtered.length) {
      refs.crmTable.style.display = 'none';
      refs.emptyState.classList.remove('hidden');
      refs.crmBody.innerHTML = '';
      return;
    }

    refs.emptyState.classList.add('hidden');
    refs.crmTable.style.display = '';
    refs.tableWrap.scrollTop = 0;
    renderVirtualWindow();
  }

  function renderVirtualWindow() {
    const total = state.filtered.length;
    if (!total) return;
    const wrap = refs.tableWrap;
    const viewportH = wrap.clientHeight || 600;
    const scrollTop = wrap.scrollTop;
    const visibleCount = Math.ceil(viewportH / VIRTUAL_ROW_HEIGHT);
    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_BUFFER_ROWS);
    const end = Math.min(total, start + visibleCount + VIRTUAL_BUFFER_ROWS * 2);

    const topPad = start * VIRTUAL_ROW_HEIGHT;
    const bottomPad = (total - end) * VIRTUAL_ROW_HEIGHT;

    let html = '';
    if (topPad > 0) {
      html += '<tr class="virt-spacer" aria-hidden="true"><td colspan="' + TABLE_COLUMN_COUNT + '" style="height:' + topPad + 'px"></td></tr>';
    }
    html += buildRowsHtml(start, end);
    if (bottomPad > 0) {
      html += '<tr class="virt-spacer" aria-hidden="true"><td colspan="' + TABLE_COLUMN_COUNT + '" style="height:' + bottomPad + 'px"></td></tr>';
    }
    refs.crmBody.innerHTML = html;
  }

  function onTableScroll() {
    if (virtualScrollRaf) return;
    virtualScrollRaf = (window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(function () {
      virtualScrollRaf = 0;
      renderVirtualWindow();
    });
  }

  function buildRowsHtml(start, end) {
    const parts = new Array(end - start);
    for (let i = start; i < end; i += 1) {
      parts[i - start] = buildDriverRowHtml(state.filtered[i]);
    }
    return parts.join('');
  }

  function buildDriverRowHtml(driver) {
    var rowClass = driver._isLead ? 'driver-row driver-row--lead' : 'driver-row';
    return '<tr class="' + rowClass + '" data-driver-id="' + esc(getDriverId(driver)) + '">' +
      td(driver.name) +
      td(formatPhone(driver.phone)) +
      td(getCity(driver)) +
      td(getState(driver)) +
      tdHtml(renderCurrentCampaignCell(driver), 'cell-campaign') +
      td(driver.plate) +
      td(driver.model || '') +
      td(driver.cpf) +
      td(driver.pix) +
      td(driver.email, 'cell-email') +
      td(formatApps(driver)) +
      td(driver.ratingApp || '') +
      td(driver.operationPeriod || '') +
      td(formatDate(driver.createdAt)) +
      '</tr>';
  }

  function renderCurrentCampaignCell(driver) {
    if (driver._isLead) {
      var label = driver._lead_partner_name || driver._lead_ref_code || 'Lead';
      var sub   = driver._lead_ref_code && driver._lead_partner_name
        ? driver._lead_ref_code
        : (driver._lead_source === 'whatsapp' ? 'WhatsApp' : 'Site');
      return '<div class="status-stack">' +
        '<span class="status-pill status-pill--info">Lead</span>' +
        '<div class="row-subtext">' + esc(label) + (sub ? ' · ' + esc(sub) : '') + '</div>' +
        '</div>';
    }
    const campaignId = getCurrentCampaignId(driver);
    const detachedCampaignId = getDetachedCampaignId(driver);
    if (!campaignId && detachedCampaignId) {
      return '<span class="table-note table-note--warning">Removido manualmente</span>' +
        '<div class="row-subtext">' + esc(getCampaignName(detachedCampaignId) || detachedCampaignId) + '</div>';
    }
    if (!campaignId) {
      return '<span class="table-note">Sem campanha</span>';
    }
    return '<div class="status-stack">' +
      '<span class="status-pill status-pill--neutral">Ativo</span>' +
      '<div class="row-subtext">' + esc(getCampaignName(campaignId) || campaignId) + '</div>' +
      '</div>';
  }

  function renderOutreachCell(driver) {
    const summary = driver.outreachSummary || createEmptySummary();
    const selectedCampaign = getSelectedOperationalCampaignId();
    const operational = summary.operational || createEmptyOperationalSummary();
    const restriction = getDriverRestriction(driver, operational);
    let campaign = null;

    if (selectedCampaign && selectedCampaign !== '__none__') {
      campaign = summary.byCampaign.find(function (item) {
        return item.campaignId === selectedCampaign;
      }) || {
        campaignId: selectedCampaign,
        campaignName: getCampaignName(selectedCampaign),
        status: 'not_sent',
      };
    }
    if (!campaign) {
      return '<div class="status-stack">' +
        renderOperationalPill(operational) +
        '<div class="row-subtext">' + esc(buildOperationalRowText(driver, operational, restriction)) + '</div>' +
        '</div>';
    }

    return '<div class="status-stack">' +
      statusPill(campaign.status || 'not_sent', inviteStatusLabel(campaign.status || 'not_sent')) +
      '<div class="row-subtext">' + esc(campaign.campaignName || campaign.campaignId || '') + '</div>' +
      '</div>';
  }

  function renderBulkState() {
    const filteredCount = state.filtered.length;
    refs.bulkTargetInfo.textContent = filteredCount > 0
      ? filteredCount + ' motorista(s) filtrado(s) | a elegibilidade e checada motorista a motorista no envio'
      : '0 motoristas filtrados';
    refs.btnBulkSend.disabled = filteredCount === 0;
  }

  function setBulkSummaryOpen() { /* removido: painel de resumo não existe mais */ }

  function getDriverCampaignFilterId() {
    const selectedCampaign = String(refs.filterCampaign.value || '').trim();
    if (selectedCampaign === '__none__') return '__none__';
    if (selectedCampaign === '__none_incomplete__') return '__none_incomplete__';
    if (selectedCampaign === '__partner_leads__') return '__partner_leads__';
    if (selectedCampaign) return selectedCampaign;
    return '';
  }

  function getSelectedOperationalCampaignId() {
    const selectedCampaign = getDriverCampaignFilterId();
    return selectedCampaign.startsWith('__') ? '' : selectedCampaign;
  }

  function toggleComposerMode(composer) {
    const mode = composer.modeSelect.value;
    composer.templateWrap.classList.toggle('hidden', mode !== 'template');
    composer.textWrap.classList.toggle('hidden', mode !== 'text');
  }

  function getComposerPayload(composer) {
    const campaignId = String(
      composer.campaignSelect?.value
      || (typeof composer.resolveCampaignId === 'function' ? composer.resolveCampaignId() : '')
      || ''
    ).trim();
    return {
      campaignId: campaignId,
      type: composer.modeSelect.value,
      templateId: composer.templateSelect.value,
      text: String(composer.textInput.value || '').trim(),
      isInvite: composer.inviteToggle.checked,
    };
  }

  function validateComposerPayload(payload, composer) {
    if (composer.requireCampaign === true && !payload.campaignId) {
      return composer.campaignRequiredMessage || 'Selecione a campanha alvo.';
    }
    if (payload.type === 'template' && !payload.templateId) return 'Selecione o template.';
    if (payload.type === 'text' && !payload.text) return 'Escreva a mensagem.';
    return '';
  }

  function setFeedback(element, message, tone) {
    element.textContent = message || '';
    element.classList.remove('is-success', 'is-error');
    if (tone === 'success') element.classList.add('is-success');
    if (tone === 'error') element.classList.add('is-error');
  }

  function formatBulkFeedback(summary, preflight) {
    const totalRequested = Number(summary?.totalRequested || state.filtered.length || 0);
    const queuedCount = Number(summary?.queuedCount || totalRequested || 0);
    const sent = Number(summary?.sent || 0);
    const failed = Number(summary?.failed || 0);
    const skippedByLimit = Number(summary?.skippedByLimit || 0);
    const limitApplied = Number(summary?.limitApplied || queuedCount || 0);
    let message = sent + ' envio(s) concluido(s)';

    if (failed > 0) {
      message += ', ' + failed + ' falha(s)';
    }
    if (skippedByLimit > 0) {
      message += ' de ' + totalRequested + ' selecionados (limite aplicado: ' + limitApplied + ')';
    } else if (queuedCount > 0 && queuedCount !== totalRequested) {
      message += ' de ' + totalRequested + ' selecionados';
    }

    if (Number(preflight?.blockedCount || 0) > 0) {
      message += '; ' + preflight.blockedCount + ' ficaram de fora na revisao do envio';
    }

    return message + '.';
  }

  async function handleBulkSend() {
    const payload = getComposerPayload(bulkComposer);
    const validationError = validateComposerPayload(payload, bulkComposer);
    if (validationError) {
      setFeedback(refs.bulkFeedback, validationError, 'error');
      return;
    }
    if (!state.filtered.length) {
      setFeedback(refs.bulkFeedback, 'Nenhum motorista filtrado para disparo.', 'error');
      return;
    }

    const driverIds = state.filtered
      .map(getDriverId)
      .filter(function (id) { return id; });

    if (!driverIds.length) {
      setFeedback(refs.bulkFeedback, 'Nenhum motorista válido na seleção atual.', 'error');
      return;
    }

    const confirmMessage = 'Enviar agora para ' + driverIds.length + ' motorista(s)?'
      + '\n\nA elegibilidade (telefone, opt-out, janela de conversa) e revalidada motorista a motorista no servidor.';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    refs.btnBulkSend.disabled = true;
    setFeedback(refs.bulkFeedback, 'Enviando mensagens...', '');

    try {
      const response = await requestJson(API_BASE + '/api/drivers/outreach/bulk-send', {
        method: 'POST',
        body: {
          campaignId: getSelectedOperationalCampaignId(),
          type: payload.type,
          templateId: payload.templateId,
          text: payload.text,
          isInvite: payload.isInvite,
          driverIds: driverIds,
        },
      });

      setFeedback(
        refs.bulkFeedback,
        formatBulkFeedback(response.summary, { eligibleCount: driverIds.length, blockedCount: 0 }),
        response.ok ? 'success' : 'error',
      );
      await loadData(true);
    } catch (err) {
      console.error('Erro no disparo em massa:', err);
      setFeedback(refs.bulkFeedback, extractErrorMessage(err), 'error');
    } finally {
      renderBulkState();
    }
  }

  function getCampaignExportLabel(driver) {
    if (driver._isLead) {
      var label = driver._lead_partner_name || driver._lead_ref_code || 'Lead';
      var source = driver._lead_ref_code && driver._lead_partner_name
        ? driver._lead_ref_code
        : (driver._lead_source === 'whatsapp' ? 'WhatsApp' : 'Site');
      return source ? ('Lead - ' + label + ' - ' + source) : ('Lead - ' + label);
    }

    const campaignId = getCurrentCampaignId(driver);
    if (!campaignId) return 'Sem campanha';
    return getCampaignName(campaignId) || campaignId;
  }

  function buildDriverExportRow(driver) {
    return {
      nome: driver.name || '',
      telefone: formatPhone(driver.phone),
      cidade: getCity(driver),
      uf: getState(driver),
      campanhaAtual: getCampaignExportLabel(driver),
      placa: driver.plate || '',
      modelo: driver.model || '',
      cpf: driver.cpf || '',
      pix: driver.pix || '',
      email: driver.email || '',
      apps: formatApps(driver),
      rating: driver.ratingApp == null ? '' : String(driver.ratingApp),
      periodo: driver.operationPeriod || '',
      cadastro: formatDate(driver.createdAt),
    };
  }

  function getDownloadFilename(response) {
    var fallbackDate = new Date().toISOString().slice(0, 10);
    var fallback = 'motoristas_oddrive_' + fallbackDate + '.xlsx';
    var disposition = response.headers.get('Content-Disposition') || response.headers.get('content-disposition') || '';
    var utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch && utfMatch[1]) {
      try { return decodeURIComponent(utfMatch[1].replace(/"/g, '')); } catch (_err) {}
    }
    var match = disposition.match(/filename="?([^"]+)"?/i);
    return match && match[1] ? match[1] : fallback;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function extractExportError(response) {
    try {
      var payload = await response.json();
      return payload?.error?.message || payload?.error || ('HTTP ' + response.status);
    } catch (_err) {
      return 'HTTP ' + response.status;
    }
  }

  async function handleExportDrivers() {
    if (!state.filtered.length) {
      window.alert('Nenhum motorista filtrado para exportar.');
      return;
    }

    var button = refs.btnExportDrivers;
    var originalText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Exportando...';
    }

    try {
      var rows = state.filtered.map(buildDriverExportRow);
      var response = await fetch(API_BASE + '/api/drivers/export', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columns: EXPORT_COLUMNS,
          rows: rows,
          totalAvailable: state.allDrivers.length,
          filteredCount: state.filtered.length,
        }),
      });

      if (!response.ok) {
        throw new Error(await extractExportError(response));
      }

      var blob = await response.blob();
      downloadBlob(blob, getDownloadFilename(response));
    } catch (err) {
      console.error('[motoristas] export error:', err);
      window.alert(err?.message || 'Nao foi possivel exportar a planilha.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText || 'Exportar';
      }
    }
  }

  function calculateBulkPreflight() {
    var mode = refs.bulkMessageMode.value;
    var preflight = {
      mode: mode,
      filteredCount: state.filtered.length,
      eligibleCount: 0,
      blockedCount: 0,
      blockedByWindowCount: 0,
      blockedByPhoneCount: 0,
      blockedByContactCount: 0,
      blockedByCooldownCount: 0,
      blockedByMarketingOptOutCount: 0,
      firstContactCount: 0,
      windowOpenCount: 0,
      templateOnlyCount: 0,
      withoutPhoneCount: 0,
      eligibleDriverIds: [],
    };

    state.filtered.forEach(function (driver) {
      var operational = getOperationalSummary(driver);
      var hasPhone = hasValidDriverPhone(driver);

      if (operational.firstOutboundPending) {
        preflight.firstContactCount += 1;
      }
      if (operational.serviceWindowOpen) {
        preflight.windowOpenCount += 1;
      }
      if (operational.allowsTemplate && !operational.allowsText) {
        preflight.templateOnlyCount += 1;
      }
      if (!hasPhone) {
        preflight.withoutPhoneCount += 1;
      }

      if (!hasPhone) {
        preflight.blockedCount += 1;
        preflight.blockedByPhoneCount += 1;
        return;
      }

      if (operational.hardBlock) {
        preflight.blockedCount += 1;
        if (operational.hardBlockCode === 'COOLDOWN_ACTIVE') {
          preflight.blockedByCooldownCount += 1;
        } else if (operational.hardBlockCode === 'MARKETING_OPT_OUT') {
          preflight.blockedByMarketingOptOutCount += 1;
        } else {
          preflight.blockedByContactCount += 1;
        }
        return;
      }

      if (mode === 'text' && !operational.allowsText) {
        preflight.blockedCount += 1;
        preflight.blockedByWindowCount += 1;
        return;
      }

      if (mode === 'template' && !operational.allowsTemplate) {
        preflight.blockedCount += 1;
        preflight.blockedByMarketingOptOutCount += 1;
        return;
      }

      preflight.eligibleCount += 1;
      preflight.eligibleDriverIds.push(getDriverId(driver));
    });

    return preflight;
  }

  function hasValidDriverPhone(driver) {
    var digits = String(driver?.phone || '').replace(/\D/g, '');
    return digits.length >= 10;
  }

  function renderBulkPreflight(preflight) {
    if (!preflight.filteredCount) {
      refs.bulkPreflight.innerHTML = '<div class="timeline-empty">Ajuste os filtros e o tipo de mensagem para ver quem entra no envio.</div>';
      return;
    }

    var intro = preflight.mode === 'text'
      ? 'Hoje o envio esta em mensagem livre. So entram motoristas com conversa aberta e sem bloqueios.'
      : 'Hoje o envio esta em mensagem aprovada. So entram motoristas liberados para novo envio.';
    var note = 'Os numeros mudam automaticamente quando voce troca os filtros ou o tipo de mensagem.';

    refs.bulkPreflight.innerHTML = '<p class="bulk-preflight__copy">' + esc(intro) + '</p>' +
      '<div class="bulk-preflight__grid">' +
      renderBulkPreflightCard('Entram agora', String(preflight.eligibleCount), preflight.mode === 'text' ? 'Podem receber texto livre neste envio.' : 'Podem receber a mensagem aprovada neste envio.') +
      renderBulkPreflightCard('Ficam de fora', String(preflight.blockedCount), buildBulkBlockedHint(preflight)) +
      renderBulkPreflightCard('Primeiro envio', String(preflight.firstContactCount), 'Ainda nao tiveram contato anterior.') +
      renderBulkPreflightCard('Conversa aberta', String(preflight.windowOpenCount), 'Ja podem receber texto livre agora.') +
      renderBulkPreflightCard('Sem conversa aberta', String(preflight.templateOnlyCount), 'Hoje so entram com mensagem aprovada.') +
      renderBulkPreflightCard('Sem telefone', String(preflight.withoutPhoneCount), 'Precisam de número válido.') +
      renderBulkPreflightCard('Contato pausado', String(getPausedContactCount(preflight)), buildPausedContactHint(preflight)) +
      renderBulkPreflightCard('Não receber campanhas', String(preflight.blockedByMarketingOptOutCount), 'Pediram para não receber novos envios de campanha.') +
      '</div>' +
      '<p class="bulk-preflight__note">' + esc(note) + '</p>';
  }

  function renderBulkPreflightCard(label, value, hint) {
    return '<article class="bulk-preflight__card">' +
      '<span class="bulk-preflight__label">' + esc(label) + '</span>' +
      '<strong class="bulk-preflight__value">' + esc(value) + '</strong>' +
      '<span class="bulk-preflight__hint">' + esc(hint) + '</span>' +
      '</article>';
  }

  function buildBulkBlockedHint(preflight) {
    var parts = [];
    if (preflight.blockedByWindowCount) parts.push(preflight.blockedByWindowCount + ' sem conversa aberta');
    if (preflight.blockedByPhoneCount) parts.push(preflight.blockedByPhoneCount + ' sem telefone');
    if (preflight.blockedByContactCount) parts.push(preflight.blockedByContactCount + ' com contato bloqueado');
    if (preflight.blockedByCooldownCount) parts.push(preflight.blockedByCooldownCount + ' com pausa ativa');
    if (preflight.blockedByMarketingOptOutCount) parts.push(preflight.blockedByMarketingOptOutCount + ' sem novas campanhas');
    return parts.join(' | ') || 'Nenhum impedimento detectado';
  }

  function getPausedContactCount(preflight) {
    return Number(preflight.blockedByContactCount || 0) + Number(preflight.blockedByCooldownCount || 0);
  }

  function buildPausedContactHint(preflight) {
    var parts = [];
    if (preflight.blockedByContactCount) parts.push(preflight.blockedByContactCount + ' com bloqueio manual');
    if (preflight.blockedByCooldownCount) parts.push(preflight.blockedByCooldownCount + ' em pausa temporaria');
    return parts.join(' | ') || 'Nenhum contato pausado neste grupo';
  }

  async function handleSingleSend() {
    const driver = getDriverById(state.modal.driverId);
    if (!driver) return;

    const payload = getComposerPayload(modalComposer);
    const operational = getModalOperationalSummary();
    const restriction = getDriverRestriction(driver, operational);
    const validationError = validateComposerPayload(payload, modalComposer);
    if (validationError) {
      setFeedback(refs.modalFeedback, validationError, 'error');
      return;
    }
    if (restriction.hardBlock) {
      setFeedback(refs.modalFeedback, restriction.message, 'error');
      return;
    }
    if (payload.type === 'text' && !operational.allowsText) {
      setFeedback(refs.modalFeedback, operational.ruleReason || 'Texto livre indisponivel para este motorista.', 'error');
      return;
    }
    if (payload.type === 'template' && !operational.allowsTemplate) {
      setFeedback(refs.modalFeedback, restriction.message, 'error');
      return;
    }

    refs.btnSendSingle.disabled = true;
    setFeedback(refs.modalFeedback, 'Enviando mensagem...', '');

    try {
      await requestJson(API_BASE + '/api/drivers/' + encodeURIComponent(getDriverId(driver)) + '/outreach/send', {
        method: 'POST',
        body: payload,
      });

      setFeedback(refs.modalFeedback, 'Mensagem registrada com sucesso.', 'success');
      if (payload.type === 'text') {
        refs.modalText.value = '';
      }
      await loadData(true);
      await loadDriverHistory(getDriverId(driver), true);
    } catch (err) {
      console.error('Erro no disparo individual:', err);
      setFeedback(refs.modalFeedback, extractErrorMessage(err), 'error');
    } finally {
      refs.btnSendSingle.disabled = false;
    }
  }

  function openDriverModal(driverId) {
    const driver = getDriverById(driverId);
    state.modal.open = true;
    state.modal.driverId = driverId;
    state.modal.history = [];
    state.modal.summary = driver ? (driver.outreachSummary || createEmptySummary()) : createEmptySummary();
    state.modal.selectedCampaignId = getSelectedOperationalCampaignId();
    refs.modalCampaignSelect.value = '';
    setFeedback(refs.modalFeedback, '', '');

    renderModalShell();
    refs.driverModal.classList.remove('hidden');
    refs.driverModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    loadDriverHistory(driverId, false);
  }

  function closeDriverModal() {
    state.modal.open = false;
    state.modal.driverId = '';
    state.modal.selectedCampaignId = '';
    state.modal.history = [];
    state.modal.summary = createEmptySummary();
    refs.modalComposerContext.textContent = 'Contexto do envio';
    refs.driverModal.classList.add('hidden');
    refs.driverModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    hideBlockReasonSection();
  }

  function syncBlockButton() {
    if (!refs.btnBlockDriver) return;
    var policy = (state.modal.summary && state.modal.summary.policy) || {};
    var isBlocked = policy.contactBlocked === true;
    refs.btnBlockDriver.textContent = isBlocked ? 'Desbloquear' : 'Bloquear';
    refs.btnBlockDriver.classList.toggle('is-blocked', isBlocked);
    refs.btnBlockDriver.dataset.blocked = isBlocked ? '1' : '0';
  }

  function hideBlockReasonSection() {
    if (refs.blockReasonSection) refs.blockReasonSection.style.display = 'none';
    if (refs.blockReasonInput) refs.blockReasonInput.value = '';
    if (refs.blockReasonError) refs.blockReasonError.textContent = '';
  }

  async function handleBlockDriverClick() {
    var driverId = state.modal.driverId;
    if (!driverId) return;
    var isBlocked = refs.btnBlockDriver.dataset.blocked === '1';

    if (isBlocked) {
      // Desbloquear direto
      await applyDriverBlock(driverId, false, '');
    } else {
      // Mostrar campo de motivo
      if (refs.blockReasonSection) refs.blockReasonSection.style.display = '';
      if (refs.blockReasonInput) refs.blockReasonInput.focus();
    }
  }

  async function applyDriverBlock(driverId, blocking, reason) {
    if (refs.btnBlockDriver) refs.btnBlockDriver.disabled = true;
    if (refs.btnConfirmBlock) refs.btnConfirmBlock.disabled = true;
    if (refs.blockReasonError) refs.blockReasonError.textContent = '';
    try {
      var payload = { contactBlocked: blocking };
      if (blocking && reason) payload.contactBlockReason = reason;
      if (!blocking) payload.contactBlockReason = '';
      var data = await requestJson(API_BASE + '/api/drivers/' + encodeURIComponent(driverId) + '/contact-policy', {
        method: 'PATCH',
        body: payload,
      });
      // Update local state
      if (data.summary) {
        state.modal.summary = data.summary;
      } else if (data.policy) {
        if (!state.modal.summary) state.modal.summary = createEmptySummary();
        state.modal.summary.policy = data.policy;
      }
      // Invalidate history cache so next open fetches fresh
      state.historyCache.delete(driverId);
      hideBlockReasonSection();
      syncBlockButton();
      renderModalOverview();
      syncModalComposerAvailability();
    } catch (err) {
      console.error('[block] error:', err);
      if (refs.blockReasonError) refs.blockReasonError.textContent = extractErrorMessage(err);
    } finally {
      if (refs.btnBlockDriver) refs.btnBlockDriver.disabled = false;
      if (refs.btnConfirmBlock) refs.btnConfirmBlock.disabled = false;
    }
  }

  function renderModalShell() {
    const driver = getDriverById(state.modal.driverId);
    refs.modalTitle.textContent = driver ? (driver.name || 'Motorista') : 'Motorista';
    state.modal.summary = driver ? (driver.outreachSummary || state.modal.summary || createEmptySummary()) : createEmptySummary();
    if (driver) {
      const preferredCampaignId = state.modal.selectedCampaignId || getSelectedOperationalCampaignId() || getCurrentCampaignId(driver) || '';
      state.modal.selectedCampaignId = preferredCampaignId;
    }
    populateModalCampaignOptions();
    refs.modalCampaignSelect.value = state.modal.selectedCampaignId;
    renderModalOverview();
    renderModalComposerContext();
    syncModalComposerAvailability();
    renderModalHistory();
    syncBlockButton();
  }

  async function loadDriverHistory(driverId, forceRefresh) {
    const normalizedId = String(driverId || '').trim();
    if (!normalizedId) return;

    if (!forceRefresh && state.historyCache.has(normalizedId)) {
      state.modal.history = state.historyCache.get(normalizedId) || [];
      syncModalCampaignSelection();
      renderModalOverview();
      renderModalComposerContext();
      renderModalHistory();
      return;
    }

    refs.modalTimeline.innerHTML = '<div class="timeline-empty">Carregando histórico...</div>';
    try {
      const data = await requestJson(API_BASE + '/api/drivers/' + encodeURIComponent(normalizedId) + '/outreach');
      state.modal.history = Array.isArray(data.items) ? data.items : [];
      state.modal.summary = data.summary || state.modal.summary || createEmptySummary();
      state.historyCache.set(normalizedId, state.modal.history);
      syncModalCampaignSelection();
      renderModalOverview();
      renderModalComposerContext();
      syncModalComposerAvailability();
      renderModalHistory();
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
      refs.modalTimeline.innerHTML = '<div class="timeline-empty">Falha ao carregar histórico.</div>';
    }
  }

  function syncModalCampaignSelection() {
    const driver = getDriverById(state.modal.driverId);
    const availableHistoryIds = state.modal.history.map(function (item) {
      return String(item.campaignId || '').trim();
    }).filter(Boolean);
    const preferredCandidate = [
      refs.modalCampaignSelect.value,
      state.modal.selectedCampaignId,
      getSelectedOperationalCampaignId(),
      getCurrentCampaignId(driver),
    ].find(Boolean) || '';

    let preferred = '';
    if (preferredCandidate && availableHistoryIds.indexOf(preferredCandidate) >= 0) {
      preferred = preferredCandidate;
    } else if (availableHistoryIds.length) {
      preferred = availableHistoryIds[0];
    } else {
      preferred = preferredCandidate || getCurrentCampaignId(driver) || WORKSPACE_OUTREACH_CAMPAIGN_ID;
    }

    state.modal.selectedCampaignId = preferred;
    populateModalCampaignOptions();
    refs.modalCampaignSelect.value = preferred;
  }

  function getModalDispatchCampaignId() {
    var driver = getDriverById(state.modal.driverId);
    return String(
      state.modal.selectedCampaignId
      || refs.modalCampaignSelect.value
      || getCurrentCampaignId(driver)
      || WORKSPACE_OUTREACH_CAMPAIGN_ID
    ).trim();
  }

  function renderModalComposerContext() {
    var campaignId = getModalDispatchCampaignId();
    var label = getCampaignName(campaignId) || campaignId || WORKSPACE_OUTREACH_CAMPAIGN_NAME;
    refs.modalComposerContext.textContent = 'Contexto do envio: ' + label;
  }

  function populateModalCampaignOptions() {
    var driver = getDriverById(state.modal.driverId);
    var options = new Map();

    state.modal.history.forEach(function (doc) {
      var campaignId = String(doc.campaignId || '').trim();
      if (!campaignId) return;
      options.set(campaignId, doc.campaignSnapshot?.name || getCampaignName(campaignId) || campaignId);
    });

    state.allCampaigns.forEach(function (campaign) {
      options.set(campaign.id, campaign.name);
    });

    if (driver && !getCurrentCampaignId(driver)) {
      options.set(WORKSPACE_OUTREACH_CAMPAIGN_ID, WORKSPACE_OUTREACH_CAMPAIGN_NAME);
    }

    var ordered = Array.from(options.entries()).map(function (entry) {
      return { value: entry[0], label: entry[1] };
    }).sort(function (left, right) {
      return String(left.label || '').localeCompare(String(right.label || ''));
    });

    refs.modalCampaignSelect.innerHTML = '<option value="">Automatico</option>' + ordered.map(function (item) {
      return '<option value="' + esc(item.value) + '">' + esc(item.label) + '</option>';
    }).join('');
  }

  function renderModalOverview() {
    if (!state.modal.open) return;

    var driver = getDriverById(state.modal.driverId);
    var summary = state.modal.summary || (driver ? driver.outreachSummary : null) || createEmptySummary();
    var operational = summary.operational || createEmptyOperationalSummary();
    var policy = summary.policy || createEmptyPolicy();
    var restriction = getDriverRestriction(driver, operational);
    var lastError = getDriverLastError(operational);
    var operationalDisplayLabel = getOperationalDisplayLabel(operational);
    var shouldShowRestrictionBadge = normalize(restriction.badgeLabel || '') !== normalize(operationalDisplayLabel);
    var shouldShowDispatchCountBadge = Number(operational.totalMessagesSent || 0) > 0;
    var location = [getCity(driver), getState(driver)].filter(Boolean).join(' / ');
    var currentCampaignId = getCurrentCampaignId(driver);
    var identityParts = [
      formatPhone(driver?.phone),
      location,
      currentCampaignId ? getCampaignName(currentCampaignId) : 'Sem campanha atual',
    ].filter(Boolean);

    refs.modalOverview.innerHTML = '<div class="overview-hero">' +
      '<div class="overview-hero__copy">' +
      '<span class="panel-eyebrow">Estado operacional</span>' +
      '<h3 class="overview-title">' + esc(getOperationalModeTitle(operational)) + '</h3>' +
      '<p class="overview-copy">' + esc(restriction.message || 'Nenhum contato anterior registrado para este motorista.') + '</p>' +
      (identityParts.length
        ? '<p class="overview-meta">' + esc(identityParts.join(' | ')) + '</p>'
        : '') +
      '</div>' +
      '<div class="overview-badges">' +
      renderOperationalPill(operational) +
      (shouldShowRestrictionBadge ? statusPill(restriction.pillTone, restriction.badgeLabel, true) : '') +
      (shouldShowDispatchCountBadge ? statusPill('neutral', operational.totalMessagesSent + ' disparo(s)', true) : '') +
      (lastError.exists ? statusPill('failed', 'Ultimo erro', true) : '') +
      '</div>' +
      '</div>' +
      renderDetachedCampaignRestorePanel(driver) +
      '<div class="overview-grid">' +
      renderOverviewCard('Disparos', String(operational.totalMessagesSent || 0), (operational.totalTemplateMessagesSent || 0) + ' aprovada(s) | ' + (operational.totalTextMessagesSent || 0) + ' texto(s)') +
      renderOverviewCard('Respostas', String(operational.totalMessagesReceived || 0), operational.lastResponseAt ? ('Ultima em ' + formatDateTime(operational.lastResponseAt)) : 'Nenhuma ate agora') +
      renderOverviewCard('Janela 24h', operational.serviceWindowOpen ? 'Aberta' : 'Fechada', buildOperationalWindowHint(operational)) +
      renderOverviewCard('Primeiro disparo', operational.firstOutboundAt ? formatDateTime(operational.firstOutboundAt) : 'Não houve', operational.neverContacted ? 'Sem contato anterior.' : 'Contato inicial já feito.') +
      renderOverviewCard('Ultimo disparo', operational.lastOutboundAt ? formatDateTime(operational.lastOutboundAt) : 'Não houve', operational.latestCampaignName || 'Sem campanha vinculada') +
      renderOverviewCard('Politica de contato', policyOptInLabel(policy), buildPolicyLine(policy), policyCardTone(policy)) +
      renderOverviewCard('Cooldown', operational.cooldownActive ? 'Ativo' : 'Livre', buildCooldownLine(operational), operational.cooldownActive ? 'danger' : 'success') +
      renderOverviewCard('Ultima resposta', operational.lastResponseAt ? formatDateTime(operational.lastResponseAt) : 'Nenhuma', operational.serviceWindowOpen ? ('Texto liberado ate ' + formatDateTime(operational.serviceWindowClosesAt)) : 'Aguardando novo retorno') +
      renderOverviewCard('Restrição atual', restriction.label, restriction.message, restriction.cardTone) +
      renderOverviewCard('Ultimo erro', lastError.title, lastError.message, lastError.cardTone) +
      '</div>' +
      renderDriverDocumentsOverview(driver);
  }

  function normalizeDriverDocumentStatus(value) {
    var normalized = normalize(value || '');
    if (!normalized) return '';
    if (normalized.indexOf('approv') >= 0 || normalized.indexOf('aprov') >= 0) return 'approved';
    if (normalized.indexOf('reject') >= 0 || normalized.indexOf('reprov') >= 0 || normalized.indexOf('recus') >= 0) return 'rejected';
    if (normalized.indexOf('pend') >= 0 || normalized.indexOf('aguard') >= 0) return 'pending';
    if (normalized.indexOf('anal') >= 0 || normalized.indexOf('review') >= 0) return 'review';
    if (normalized.indexOf('upload') >= 0 || normalized.indexOf('envi') >= 0) return 'uploaded';
    return normalized.replace(/\s+/g, '-');
  }

  function getDriverDocumentsData(driver) {
    var docs = driver && (driver.documentsData || driver.documents || (driver.raw && driver.raw.documentsData));
    return docs && typeof docs === 'object' ? docs : {};
  }

  function getDriverDocumentSummary(driver) {
    var docs = getDriverDocumentsData(driver);
    var sent = 0;
    var approved = 0;

    DRIVER_DOCUMENT_FIELDS.forEach(function (field) {
      var item = docs[field.key];
      if (!item || typeof item !== 'object') return;
      if (item.link || item.status || item.createdAt || item.created_at) sent += 1;
      if (normalizeDriverDocumentStatus(item.status) === 'approved') approved += 1;
    });

    return {
      total: DRIVER_DOCUMENT_FIELDS.length,
      sent: sent,
      approved: approved,
      complete: sent === DRIVER_DOCUMENT_FIELDS.length,
    };
  }

  function renderDriverDocumentsOverview(driver) {
    var docs = getDriverDocumentsData(driver);
    var summary = getDriverDocumentSummary(driver);

    var cards = DRIVER_DOCUMENT_FIELDS.map(function (field) {
      var item = docs[field.key] && typeof docs[field.key] === 'object' ? docs[field.key] : null;
      var link = item && item.link ? String(item.link) : '';
      var statusKey = normalizeDriverDocumentStatus(item && item.status);
      var statusLabel = item
        ? (DRIVER_DOCUMENT_STATUS_LABELS[statusKey] || item.status || 'Enviado')
        : 'Nao enviado';
      var dateValue = item && (item.createdAt || item.created_at || item.updatedAt);
      var dateLabel = formatDateTime(dateValue);

      return '<article class="driver-doc-card ' + (item ? 'has-document' : 'is-missing') + ' status-' + esc(statusKey || 'missing') + '">' +
        '<div class="driver-doc-card__head">' +
        '<strong>' + esc(field.label) + '</strong>' +
        '<span class="driver-doc-card__status">' + esc(statusLabel) + '</span>' +
        '</div>' +
        '<p>' + esc(dateLabel ? ('Enviado em ' + dateLabel) : (item ? 'Sem data de envio' : 'Documento ainda nao encontrado')) + '</p>' +
        (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Abrir documento</a>' : '') +
        '</article>';
    }).join('');

    return '<section class="driver-documents-overview">' +
      '<div class="driver-documents-overview__head">' +
      '<span class="panel-eyebrow">Documentos</span>' +
      '<strong>' + esc(summary.sent + '/' + summary.total + ' enviados') + '</strong>' +
      '</div>' +
      '<div class="driver-documents-overview__grid">' + cards + '</div>' +
      '</section>';
  }

  function renderDetachedCampaignRestorePanel(driver) {
    var campaignId = getDetachedCampaignId(driver);
    if (!campaignId) return '';

    var campaignName = getCampaignName(campaignId) || campaignId;
    return '<div class="restore-campaign-panel">' +
      '<div class="restore-campaign-panel__copy">' +
      '<span class="restore-campaign-panel__label">Removido de campanha</span>' +
      '<strong>' + esc(campaignName) + '</strong>' +
      '<p>Este motorista foi desvinculado manualmente. Restaurar remove essa regra local e permite que ele volte se o espelhamento ainda mantiver o vinculo.</p>' +
      '</div>' +
      '<button type="button" class="btn btn--sm btn--primary" data-restore-campaign="' + esc(campaignId) + '">Vincular novamente</button>' +
      '</div>';
  }

  function syncModalComposerAvailability() {
    var operational = getModalOperationalSummary();
    var driver = getDriverById(state.modal.driverId);
    var restriction = getDriverRestriction(driver, operational);
    var templateOption = refs.modalMessageMode.querySelector('option[value="template"]');
    var textOption = refs.modalMessageMode.querySelector('option[value="text"]');
    if (templateOption) {
      templateOption.disabled = !operational.allowsTemplate;
    }
    if (textOption) {
      textOption.disabled = !operational.allowsText;
    }
    if (refs.modalMessageMode.value === 'text' && !operational.allowsText) {
      refs.modalMessageMode.value = operational.allowsTemplate ? 'template' : 'text';
    }
    if (refs.modalMessageMode.value === 'template' && !operational.allowsTemplate) {
      refs.modalMessageMode.value = operational.allowsText ? 'text' : 'template';
    }
    var selectedMode = refs.modalMessageMode.value;
    var modeBlocked = (selectedMode === 'template' && !operational.allowsTemplate)
      || (selectedMode === 'text' && !operational.allowsText);
    refs.btnSendSingle.disabled = restriction.hardBlock === true || modeBlocked;
    if (restriction.hardBlock === true || modeBlocked) {
      setFeedback(refs.modalFeedback, restriction.message, 'error');
    } else if (refs.modalFeedback.classList.contains('is-error') && refs.modalFeedback.textContent === restriction.message) {
      setFeedback(refs.modalFeedback, '', '');
    }
    toggleComposerMode(modalComposer);
  }

  function renderModalHistory() {
    if (!state.modal.open) return;

    const selectedCampaignId = state.modal.selectedCampaignId || refs.modalCampaignSelect.value;
    const selectedDoc = state.modal.history.find(function (item) {
      return String(item.campaignId || '').trim() === selectedCampaignId;
    }) || null;
    const sidebarDocs = state.modal.history.slice();

    if (selectedCampaignId && !sidebarDocs.some(function (item) {
      return String(item.campaignId || '').trim() === selectedCampaignId;
    })) {
      sidebarDocs.unshift({
        campaignId: selectedCampaignId,
        campaignSnapshot: { name: getCampaignName(selectedCampaignId) },
        invitation: { status: 'not_sent' },
        events: [],
      });
    }

    refs.modalCampaignList.innerHTML = sidebarDocs.length
      ? sidebarDocs.map(renderHistoryCard).join('')
      : '<div class="timeline-empty">Nenhum contato registrado.</div>';

    refs.modalHistoryTitle.textContent = selectedCampaignId
      ? (getCampaignName(selectedCampaignId) || selectedCampaignId)
      : 'Selecione uma campanha';
    renderModalComposerContext();
    refs.modalHistoryStatus.innerHTML = selectedDoc
      ? statusPill(selectedDoc.invitation?.status || 'not_sent', inviteStatusLabel(selectedDoc.invitation?.status || 'not_sent'))
      : statusPill('not_sent', 'Sem histórico');

    if (!selectedDoc || !Array.isArray(selectedDoc.events) || !selectedDoc.events.length) {
      refs.modalTimeline.innerHTML = '<div class="timeline-empty">Nenhuma interação registrada nesta campanha.</div>';
      return;
    }

    refs.modalTimeline.innerHTML = selectedDoc.events.map(renderTimelineEvent).join('');
  }

  function renderHistoryCard(doc) {
    const campaignId = String(doc.campaignId || '').trim();
    const active = campaignId === state.modal.selectedCampaignId;
    const campaignName = doc.campaignSnapshot?.name || getCampaignName(campaignId) || campaignId || 'Campanha';
    const status = doc.invitation?.status || 'not_sent';
    return '<button type="button" class="history-card' + (active ? ' is-active' : '') + '" data-campaign-id="' + esc(campaignId) + '">' +
      '<span class="history-card__name">' + esc(campaignName) + '</span>' +
      statusPill(status, inviteStatusLabel(status)) +
      '<span class="history-card__meta">' + esc((doc.events || []).length + ' evento(s)') + '</span>' +
      '</button>';
  }

  function renderTimelineEvent(event) {
    const title = eventTitle(event);
    const meta = buildEventMeta(event);
    const notes = buildEventNotes(event);
    const tone = event.direction === 'outbound'
      ? 'outbound'
      : (event.direction === 'inbound' ? 'inbound' : 'system');

    return '<article class="timeline-item timeline-item--' + tone + '">' +
      '<div class="timeline-item__head">' +
      '<div>' +
      '<h4 class="timeline-item__title">' + esc(title) + '</h4>' +
      '<div class="timeline-item__meta">' + esc(formatDateTime(event.at)) + '</div>' +
      '</div>' +
      '<div class="timeline-item__badges">' + meta + '</div>' +
      '</div>' +
      notes +
      '</article>';
  }

  function eventTitle(event) {
    if (event.type === 'invite.sent') return 'Convite enviado';
    if (event.type === 'message.sent') return 'Mensagem enviada';
    if (event.type === 'message.status') return 'Status de entrega';
    if (event.type === 'invite.response') {
      if (event.decision === 'accepted') return 'Convite aceito';
      if (event.decision === 'declined') return 'Convite recusado';
      return 'Resposta recebida';
    }
    if (event.type === 'message.inbound') return 'Mensagem recebida';
    if (event.type === 'flow.run') return 'OD Flow executado';
    return 'Evento';
  }

  function buildEventMeta(event) {
    const badges = [];
    if (event.deliveryStatus) {
      badges.push(statusPill(event.deliveryStatus, deliveryStatusLabel(event.deliveryStatus), true));
    }
    if (event.decision) {
      badges.push(statusPill(event.decision, inviteStatusLabel(event.decision), true));
    }
    if (event.runStatus) {
      badges.push(statusPill(event.runStatus, flowStatusLabel(event.runStatus), true));
    }
    if (event.kind) {
      badges.push(statusPill('neutral', event.kind, true));
    }
    return badges.join('');
  }

  function buildEventNotes(event) {
    const notes = [];
    if (event.text) {
      notes.push('<p class="timeline-item__text">' + esc(event.text) + '</p>');
    }
    if (event.templateName) {
      notes.push('<p class="timeline-item__note">Template: ' + esc(event.templateName) + '</p>');
    }
    if (event.branchLabel) {
      notes.push('<p class="timeline-item__note">Branch: ' + esc(event.branchLabel) + '</p>');
    }
    if (event.statusValue) {
      notes.push('<p class="timeline-item__note">Status do flow: ' + esc(event.statusValue) + '</p>');
    }
    return notes.join('');
  }

  function handleTableClick(event) {
    const row = event.target.closest('[data-driver-id]');
    if (!row) return;
    openDriverModal(row.getAttribute('data-driver-id'));
  }

  function handleModalCampaignClick(event) {
    const button = event.target.closest('[data-campaign-id]');
    if (!button) return;
    state.modal.selectedCampaignId = button.getAttribute('data-campaign-id') || '';
    refs.modalCampaignSelect.value = state.modal.selectedCampaignId;
    renderModalComposerContext();
    renderModalHistory();
  }

  async function handleRestoreCampaignClick(event) {
    const button = event.target.closest('[data-restore-campaign]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const driver = getDriverById(state.modal.driverId);
    const driverId = getDriverId(driver);
    const campaignId = button.getAttribute('data-restore-campaign') || getDetachedCampaignId(driver);
    if (!driverId || !campaignId) return;

    const campaignName = getCampaignName(campaignId) || campaignId;
    const confirmed = window.confirm('Vincular novamente este motorista a "' + campaignName + '"?');
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = 'Vinculando...';
    setFeedback(refs.modalFeedback, '', '');

    try {
      await requestJson(API_BASE + '/api/drivers/' + encodeURIComponent(driverId) + '/restore-campaign', {
        method: 'POST',
        body: { campaignId: campaignId },
      });
      await loadData(true);
      if (state.modal.open) {
        state.modal.driverId = driverId;
        state.modal.selectedCampaignId = campaignId;
        refs.modalCampaignSelect.value = campaignId;
        renderModalComposerContext();
        renderModalHistory();
        setFeedback(refs.modalFeedback, 'Motorista vinculado novamente.', 'success');
      }
    } catch (err) {
      setFeedback(refs.modalFeedback, extractErrorMessage(err), 'error');
      button.disabled = false;
      button.textContent = 'Vincular novamente';
    }
  }

  function getDriverId(driver) {
    return String(driver?.id || driver?._id || '').trim();
  }

  function getDriverById(driverId) {
    const normalizedId = String(driverId || '').trim();
    if (!normalizedId) return null;
    const mapped = state.driversById.get(normalizedId);
    if (mapped) return mapped;
    return state.allDrivers.find(function (driver) {
      return getDriverId(driver) === normalizedId;
    }) || null;
  }

  function getCurrentCampaignId(driver) {
    return String(driver?.campaignId || '').trim();
  }

  function getDetachedCampaignId(driver) {
    return String(
      driver?.detachedFromCampaignId
      || driver?.campaignData?.detachedFromCampaignId
      || '',
    ).trim();
  }

  function getCampaignName(campaignId) {
    var normalizedId = String(campaignId || '').trim();
    if (normalizedId === WORKSPACE_OUTREACH_CAMPAIGN_ID) {
      return WORKSPACE_OUTREACH_CAMPAIGN_NAME;
    }
    return state.campaignsById.get(normalizedId)?.name || '';
  }

  function getState(driver) {
    return driver._location?.state || driver.address?.state || driver.state || '';
  }

  function getCity(driver) {
    return driver._location?.city || driver.address?.city || driver.city || '';
  }

  function getDriverRegistrationMissingFields(driver) {
    const missing = [];
    const phoneDigits = String(driver?.phoneDigits || driver?.phone || '').replace(/\D/g, '');
    const cpfDigits = String(driver?.cpf || '').replace(/\D/g, '');
    const stateCode = canonicalState(getState(driver));
    const plate = driver?.plate || driver?.campaignData?.vehiclePlate || '';
    const model = driver?.model || driver?.campaignData?.vehicleModel || '';

    if (!String(driver?.name || '').trim()) missing.push('Nome');
    if (phoneDigits.length < 10) missing.push('Telefone');
    if (!String(getCity(driver) || '').trim()) missing.push('Cidade');
    if (!BR_UF_TO_CAPITAL[String(stateCode || '').toUpperCase()]) missing.push('UF');
    if (cpfDigits.length !== 11) missing.push('CPF');
    if (!String(driver?.pix || '').trim()) missing.push('PIX');
    if (!String(plate || '').trim()) missing.push('Placa');
    if (!String(model || '').trim()) missing.push('Modelo');
    return missing;
  }

  function isDriverRegistrationComplete(driver) {
    return getDriverRegistrationMissingFields(driver).length === 0;
  }

  function normalizePlace(str) {
    return String(str || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function titleCasePlace(str) {
    var s = String(str || '').trim();
    if (!s) return s;
    if (s.length <= 2) return s.toUpperCase();
    return s.toLowerCase().replace(/(?:^|[\s-])\S/g, function (c) { return c.toUpperCase(); });
  }

  // Tabela: nome normalizado do estado → sigla UF
  var BR_NAME_TO_UF = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF',
    'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA',
    'mato grosso do sul': 'MS', 'mato grosso': 'MT', 'minas gerais': 'MG',
    'para': 'PA', 'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE',
    'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
    'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR',
    'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
  };

  // Tabela: sigla UF → nome da capital
  var BR_UF_TO_CAPITAL = {
    'AC': 'Rio Branco', 'AL': 'Maceió', 'AP': 'Macapá', 'AM': 'Manaus',
    'BA': 'Salvador', 'CE': 'Fortaleza', 'DF': 'Brasília', 'ES': 'Vitória',
    'GO': 'Goiânia', 'MA': 'São Luís', 'MT': 'Cuiabá', 'MS': 'Campo Grande',
    'MG': 'Belo Horizonte', 'PA': 'Belém', 'PB': 'João Pessoa', 'PR': 'Curitiba',
    'PE': 'Recife', 'PI': 'Teresina', 'RJ': 'Rio de Janeiro', 'RN': 'Natal',
    'RS': 'Porto Alegre', 'RO': 'Porto Velho', 'RR': 'Boa Vista',
    'SC': 'Florianópolis', 'SP': 'São Paulo', 'SE': 'Aracaju', 'TO': 'Palmas'
  };

  // Retorna sempre a sigla UF canônica (ex: "Rio de Janeiro" → "RJ", "rj" → "RJ")
  function canonicalState(raw) {
    var s = String(raw || '').trim().replace(/[.,]+$/, '').trim();
    if (!s) return '';
    var upper = s.toUpperCase();
    if (BR_UF_TO_CAPITAL[upper]) return upper;          // já é sigla válida
    var uf = BR_NAME_TO_UF[normalizePlace(s)];
    if (uf) return uf;                                   // nome completo → sigla
    return titleCasePlace(s);                            // desconhecido: title case
  }

  // Retorna nome canônico da cidade (ex: "RJ" → "Rio de Janeiro", "rio de janeiro." → "Rio de Janeiro")
  function canonicalCity(raw) {
    var s = String(raw || '').trim().replace(/[.,]+$/, '').trim();
    if (!s) return '';
    var upper = s.toUpperCase();
    if (BR_UF_TO_CAPITAL[upper]) return BR_UF_TO_CAPITAL[upper]; // sigla UF → capital
    return titleCasePlace(s);
  }

  var CITY_LABEL_OVERRIDES = {
    'florianopolis': 'Florian\u00f3polis',
    'sao paulo': 'S\u00e3o Paulo',
    'ribeirao preto': 'Ribeir\u00e3o Preto',
    'sao jose': 'S\u00e3o Jos\u00e9',
    'sao jose dos campos': 'S\u00e3o Jos\u00e9 dos Campos',
    'sao jose do rio preto': 'S\u00e3o Jos\u00e9 do Rio Preto',
    'belem': 'Bel\u00e9m',
    'maceio': 'Macei\u00f3',
    'goiania': 'Goi\u00e2nia',
    'brasilia': 'Bras\u00edlia',
    'vitoria': 'Vit\u00f3ria',
    'sao luis': 'S\u00e3o Lu\u00eds',
  };

  var CITY_KEY_ALIASES = {
    'florianopomis': 'florianopolis',
    'florianopolis': 'florianopolis',
  };

  function getCityFilterEntry(driver) {
    var uf = getDriverFilterState(driver);
    var rawKey = getRawCityFilterKey(getCity(driver));
    return {
      uf: uf,
      rawKey: rawKey,
      label: buildCityFilterLabel(rawKey),
    };
  }

  function getCityFilterKey(driver) {
    var uf = getDriverFilterState(driver);
    var rawKey = getRawCityFilterKey(getCity(driver));
    return resolveCityFilterKey(rawKey, uf);
  }

  function getDriverFilterState(driver) {
    var uf = canonicalState(getState(driver));
    return BR_UF_TO_CAPITAL[uf] ? uf : getCitySuffixUf(getCity(driver));
  }

  function getRawCityFilterKey(raw) {
    var cleaned = normalizePlace(raw)
      .replace(/[^a-z0-9\s-]+/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '';
    if (cleaned === 'nao informado' || cleaned === 'nao informada') return '';

    var upper = cleaned.toUpperCase();
    if (BR_UF_TO_CAPITAL[upper]) {
      return normalizePlace(BR_UF_TO_CAPITAL[upper]);
    }

    var parts = cleaned.split(' ');
    if (parts.length > 1) {
      var first = parts[0].toUpperCase();
      if (BR_UF_TO_CAPITAL[first]) {
        parts.shift();
        cleaned = parts.join(' ').trim();
      }
    }

    parts = cleaned.split(' ');
    if (parts.length > 1) {
      var last = parts[parts.length - 1].toUpperCase();
      if (BR_UF_TO_CAPITAL[last]) {
        parts.pop();
        cleaned = parts.join(' ').trim();
      }
    }

    return CITY_KEY_ALIASES[cleaned] || cleaned;
  }

  function getCitySuffixUf(raw) {
    var cleaned = normalizePlace(raw)
      .replace(/[^a-z0-9\s-]+/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var parts = cleaned ? cleaned.split(' ') : [];
    var first = parts.length > 1 ? parts[0].toUpperCase() : '';
    var last = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
    if (BR_UF_TO_CAPITAL[first]) return first;
    return BR_UF_TO_CAPITAL[last] ? last : '';
  }

  function buildCityFilterLabel(cityKey) {
    if (!cityKey) return '';
    return CITY_LABEL_OVERRIDES[cityKey] || titleCasePlace(cityKey);
  }

  function getPreferredCityLabel(cityKey, fallback) {
    return CITY_LABEL_OVERRIDES[cityKey] || fallback || titleCasePlace(cityKey);
  }

  function resolveCityFilterKey(rawKey, uf) {
    if (!rawKey) return '';
    var scoped = String(uf || '') + '|' + rawKey;
    return state.cityFilterKeyAliases.get(scoped)
      || state.cityFilterKeyAliases.get('|' + rawKey)
      || CITY_KEY_ALIASES[rawKey]
      || rawKey;
  }

  function buildCityFilterAliases(entries) {
    var aliases = new Map();
    var buckets = new Map();
    entries.forEach(function (entry) {
      var bucketKey = entry.uf || '';
      var bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = new Map();
        buckets.set(bucketKey, bucket);
      }
      if (entry.rawKey) {
        bucket.set(entry.rawKey, (bucket.get(entry.rawKey) || 0) + 1);
      }
    });

    buckets.forEach(function (counts, uf) {
      var keys = Array.from(counts.keys());
      var parent = new Map(keys.map(function (key) { return [key, key]; }));

      function find(key) {
        var root = parent.get(key) || key;
        while (parent.get(root) && parent.get(root) !== root) root = parent.get(root);
        var current = key;
        while (parent.get(current) && parent.get(current) !== root) {
          var next = parent.get(current);
          parent.set(current, root);
          current = next;
        }
        return root;
      }

      function union(a, b) {
        var rootA = find(a);
        var rootB = find(b);
        if (rootA !== rootB) parent.set(rootB, rootA);
      }

      if (uf) {
        for (var i = 0; i < keys.length; i += 1) {
          for (var j = i + 1; j < keys.length; j += 1) {
            if (areProbablySameCity(keys[i], keys[j])) {
              union(keys[i], keys[j]);
            }
          }
        }
      }

      var groups = new Map();
      keys.forEach(function (key) {
        var root = find(key);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(key);
      });

      groups.forEach(function (groupKeys) {
        var preferred = groupKeys.slice().sort(function (a, b) {
          return cityKeyScore(b, counts.get(b) || 0) - cityKeyScore(a, counts.get(a) || 0)
            || a.localeCompare(b);
        })[0];
        groupKeys.forEach(function (key) {
          aliases.set(uf + '|' + key, preferred);
          if (!uf) aliases.set('|' + key, preferred);
        });
      });
    });

    return aliases;
  }

  function cityKeyScore(key, count) {
    var score = count * 10;
    if (CITY_LABEL_OVERRIDES[key]) score += 1000;
    if (CITY_KEY_ALIASES[key] && CITY_KEY_ALIASES[key] === key) score += 2000;
    score += Math.min(String(key || '').length, 40);
    return score;
  }

  function areProbablySameCity(left, right) {
    if (!left || !right || left === right) return false;
    if (left[0] !== right[0]) return false;
    var minLength = Math.min(left.length, right.length);
    if (minLength < 7) return false;
    if (Math.abs(left.length - right.length) > 2) return false;
    return levenshteinDistanceLimited(left, right, 2) <= 2;
  }

  function levenshteinDistanceLimited(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return limit + 1;
    var previous = new Array(right.length + 1);
    var current = new Array(right.length + 1);
    for (var j = 0; j <= right.length; j += 1) previous[j] = j;

    for (var i = 1; i <= left.length; i += 1) {
      current[0] = i;
      var best = current[0];
      for (j = 1; j <= right.length; j += 1) {
        var cost = left[i - 1] === right[j - 1] ? 0 : 1;
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + cost
        );
        if (current[j] < best) best = current[j];
      }
      if (best > limit) return limit + 1;
      var tmp = previous;
      previous = current;
      current = tmp;
    }

    return previous[right.length];
  }

  function chooseCityFilterLabel(current, candidate) {
    if (!current) return candidate || '';
    if (!candidate) return current;
    if (candidate.length < current.length) return candidate;
    return current;
  }

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function uniqueSorted(items) {
    return Array.from(new Set(items)).sort(function (left, right) {
      return String(left || '').localeCompare(String(right || ''));
    });
  }

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const ESC_RE = /[&<>"']/g;
  function esc(value) {
    if (value == null) return '';
    return String(value).replace(ESC_RE, function (c) { return ESC_MAP[c]; });
  }

  function td(value, className) {
    const classes = className ? ' class="' + className + '"' : '';
    return '<td' + classes + '>' + esc(value || '') + '</td>';
  }

  function tdHtml(html, className) {
    const classes = className ? ' class="' + className + '"' : '';
    return '<td' + classes + '>' + html + '</td>';
  }

  function statusPill(status, label, compact) {
    const normalized = normalize(status || 'neutral').replace(/[^a-z0-9]+/g, '-') || 'neutral';
    return '<span class="status-pill status-pill--' + normalized + (compact ? ' status-pill--compact' : '') + '">' + esc(label) + '</span>';
  }

  function inviteStatusLabel(status) {
    if (status === 'sent') return 'Convite enviado';
    if (status === 'delivered') return 'Entregue';
    if (status === 'read') return 'Lido';
    if (status === 'responded') return 'Respondeu';
    if (status === 'accepted') return 'Aceitou';
    if (status === 'declined') return 'Recusou';
    if (status === 'failed') return 'Falhou';
    if (status === 'simulated') return 'Simulado';
    return 'Sem histórico';
  }

  function deliveryStatusLabel(status) {
    if (status === 'sent') return 'Enviado';
    if (status === 'delivered') return 'Entregue';
    if (status === 'read') return 'Lido';
    if (status === 'failed') return 'Falhou';
    if (status === 'simulated') return 'Simulado';
    return status || 'Status';
  }

  function flowStatusLabel(status) {
    if (status === 'completed') return 'Flow concluido';
    if (status === 'handoff') return 'Encaminhado';
    if (status === 'failed') return 'Flow falhou';
    return status || 'Flow';
  }

  function createEmptySummary() {
    return {
      totalCampaigns: 0,
      hasInvite: false,
      acceptedCampaignIds: [],
      declinedCampaignIds: [],
      invitedCampaignIds: [],
      respondedCampaignIds: [],
      latestActivityAt: '',
      latest: null,
      byCampaign: [],
      policy: createEmptyPolicy(),
      operational: createEmptyOperationalSummary(),
    };
  }

  function createEmptyPolicy() {
    return {
      optInStatus: 'unknown',
      optInSource: '',
      optInCapturedAt: '',
      optInNotes: '',
      contactBlocked: false,
      contactBlockReason: '',
      marketingOptOut: false,
      marketingOptOutReason: '',
      cooldownUntil: '',
      cooldownReason: '',
      updatedAt: '',
    };
  }

  function createEmptyOperationalSummary() {
    return {
      neverContacted: true,
      firstOutboundPending: true,
      totalMessagesSent: 0,
      totalMessagesReceived: 0,
      totalInvitesSent: 0,
      totalTemplateMessagesSent: 0,
      totalTextMessagesSent: 0,
      totalCampaignsWithHistory: 0,
      totalCampaignsResponded: 0,
      firstOutboundAt: '',
      lastOutboundAt: '',
      lastInboundAt: '',
      lastResponseAt: '',
      lastInviteAt: '',
      latestActivityAt: '',
      latestCampaignId: '',
      latestCampaignName: '',
      lastTemplateName: '',
      totalFailures: 0,
      lastErrorAt: '',
      lastErrorCode: '',
      lastErrorMessage: '',
      lastErrorCampaignId: '',
      lastErrorCampaignName: '',
      optInStatus: 'unknown',
      optInSource: '',
      optInCapturedAt: '',
      optInNotes: '',
      contactBlocked: false,
      contactBlockReason: '',
      marketingOptOut: false,
      marketingOptOutReason: '',
      cooldownUntil: '',
      cooldownReason: '',
      cooldownActive: false,
      serviceWindowOpenedAt: '',
      serviceWindowClosesAt: '',
      serviceWindowOpen: false,
      allowsTemplate: true,
      allowsText: false,
      hardBlock: false,
      hardBlockCode: '',
      hardBlockLabel: '',
      hardBlockMessage: '',
      currentPhase: 'first_contact',
      statusKey: 'first-contact',
      statusLabel: 'Primeiro contato',
      modeLabel: 'Somente template aprovado',
      ruleReason: 'Nenhum disparo anterior registrado para este motorista.',
      restrictionCode: 'FIRST_CONTACT_TEMPLATE_REQUIRED',
      restrictionLabel: 'Primeiro contato exige template',
      restrictionMessage: 'Nenhum disparo anterior registrado para este motorista.',
    };
  }

  function getOperationalSummary(driver) {
    var summary = driver?.outreachSummary || createEmptySummary();
    return summary.operational || createEmptyOperationalSummary();
  }

  function getDriverPolicy(driver) {
    var summary = driver?.outreachSummary || createEmptySummary();
    return summary.policy || createEmptyPolicy();
  }

  function getModalOperationalSummary() {
    var summary = state.modal.summary || createEmptySummary();
    return summary.operational || createEmptyOperationalSummary();
  }

  function getModalPolicy() {
    var summary = state.modal.summary || createEmptySummary();
    return summary.policy || createEmptyPolicy();
  }

  function renderOperationalPill(operational) {
    return statusPill(operational.statusKey || 'first-contact', getOperationalDisplayLabel(operational));
  }

  function getOperationalDisplayLabel(operational) {
    var blockCode = String(operational?.hardBlockCode || '').trim();
    if (blockCode === 'CONTACT_BLOCKED' || blockCode === 'OPT_OUT_ACTIVE') return 'Contato bloqueado';
    if (blockCode === 'COOLDOWN_ACTIVE') return 'Pausa ativa';
    if (blockCode === 'MARKETING_OPT_OUT') return 'Não receber campanhas';

    var statusKey = String(operational?.statusKey || '').trim();
    if (statusKey === 'window-open') return 'Pode falar agora';
    if (statusKey === 'text-only') return 'Só conversa atual';
    if (statusKey === 'template-only') return 'Mensagem aprovada';
    if (statusKey === 'first-contact') return 'Primeiro envio';
    if (statusKey === 'never-contacted') return 'Sem contato';
    if (statusKey === 'marketing-opt-out') return 'Não receber campanhas';
    if (statusKey === 'contact-blocked') return 'Contato bloqueado';
    if (statusKey === 'cooldown') return 'Pausa ativa';
    return operational?.statusLabel || 'Situação do contato';
  }

  function getOperationalModeTitle(operational) {
    var blockCode = String(operational?.hardBlockCode || '').trim();
    if (blockCode === 'CONTACT_BLOCKED' || blockCode === 'OPT_OUT_ACTIVE') return 'Contato pausado para novos envios';
    if (blockCode === 'COOLDOWN_ACTIVE') return 'Contato em pausa temporária';
    if (blockCode === 'MARKETING_OPT_OUT') return 'Esse motorista não quer novas campanhas';
    if (operational.serviceWindowOpen && operational.allowsText) return 'Pode continuar a conversa por texto';
    if (operational.firstOutboundPending) return 'Comece com uma mensagem aprovada';
    if (operational.allowsTemplate && !operational.allowsText) return 'Fora da conversa atual, use mensagem aprovada';
    return operational?.modeLabel || 'Situação do contato';
  }

  function buildOperationalRowText(driver, operational, restriction) {
    if (restriction.code === 'MARKETING_OPT_OUT') {
      return restriction.message;
    }
    if (restriction.hardBlock) {
      return restriction.message;
    }
    if (operational.totalMessagesSent > 0) {
      var base = operational.totalMessagesSent + ' disparo(s) registrado(s) | ' + (operational.allowsText ? 'pode continuar por texto agora' : 'próximo contato com mensagem aprovada');
      if (operational.lastErrorCode) {
        return base + ' | ultimo problema: ' + buildLastErrorTitle(operational);
      }
      return base;
    }
    if (operational.totalMessagesReceived > 0) {
      return operational.totalMessagesReceived + ' resposta(s) recebida(s) | conversa aberta por texto';
    }
    return restriction.message;
  }

  function renderOverviewCard(label, value, hint, tone) {
    return '<article class="overview-card' + (tone ? ' overview-card--' + esc(tone) : '') + '">' +
      '<span class="overview-card__label">' + esc(label) + '</span>' +
      '<strong class="overview-card__value">' + esc(value) + '</strong>' +
      '<span class="overview-card__hint">' + esc(hint) + '</span>' +
      '</article>';
  }

  function buildOperationalWindowHint(operational) {
    if (operational.serviceWindowOpen && operational.serviceWindowClosesAt) {
      return 'Aberta ate ' + formatDateTime(operational.serviceWindowClosesAt);
    }
    if (operational.serviceWindowClosesAt) {
      return 'Fechou em ' + formatDateTime(operational.serviceWindowClosesAt);
    }
    if (operational.lastResponseAt) {
      return 'Ultima resposta em ' + formatDateTime(operational.lastResponseAt);
    }
    return 'Aguardando primeira resposta do motorista';
  }

  function policyOptInLabel(policy) {
    if (policy?.marketingOptOut === true) return 'Não receber campanhas';
    var status = String(policy?.optInStatus || '').trim();
    if (policy?.contactBlocked === true || status === 'revoked') return 'Contato pausado';
    return 'Pode receber campanhas';
  }

  function getDriverRestriction(driver, operational) {
    if (!hasValidDriverPhone(driver)) {
      return {
        code: 'PHONE_NOT_FOUND',
        label: 'Telefone pendente',
        message: 'Cadastre um telefone válido para liberar os envios.',
        badgeLabel: 'Telefone pendente',
        pillTone: 'failed',
        cardTone: 'danger',
        hardBlock: true,
      };
    }

    if (operational.hardBlock) {
      if (operational.hardBlockCode === 'CONTACT_BLOCKED' || operational.hardBlockCode === 'OPT_OUT_ACTIVE') {
        return {
          code: operational.hardBlockCode,
          label: 'Contato bloqueado',
          message: 'Esse contato esta pausado para novos envios.',
          badgeLabel: 'Contato bloqueado',
          pillTone: 'contact-blocked',
          cardTone: 'danger',
          hardBlock: true,
        };
      }
      if (operational.hardBlockCode === 'COOLDOWN_ACTIVE') {
        return {
          code: 'COOLDOWN_ACTIVE',
          label: 'Pausa ativa',
          message: 'Esse contato esta em pausa temporaria para novos envios.',
          badgeLabel: 'Pausa ativa',
          pillTone: 'cooldown',
          cardTone: 'warning',
          hardBlock: true,
        };
      }
      if (operational.hardBlockCode === 'MARKETING_OPT_OUT') {
        return {
          code: 'MARKETING_OPT_OUT',
          label: 'Não receber campanhas',
          message: 'Esse motorista pediu para não receber novos envios de campanha.',
          badgeLabel: 'Não receber campanhas',
          pillTone: 'marketing-opt-out',
          cardTone: 'warning',
          hardBlock: true,
        };
      }
      return {
        code: operational.hardBlockCode || 'DISPATCH_BLOCKED',
        label: 'Envio bloqueado',
        message: operational.hardBlockMessage || operational.ruleReason || 'Envio bloqueado para este motorista.',
        badgeLabel: 'Envio bloqueado',
        pillTone: operational.statusKey || 'failed',
        cardTone: 'danger',
        hardBlock: true,
      };
    }

    if (!operational.allowsTemplate && operational.allowsText) {
      return {
        code: operational.restrictionCode || 'MARKETING_OPT_OUT',
        label: 'So conversa atual',
        message: 'Pode continuar por texto na conversa atual, mas não em novo disparo de campanha.',
        badgeLabel: 'So conversa atual',
        pillTone: 'text-only',
        cardTone: 'warning',
        hardBlock: false,
      };
    }

    if (operational.serviceWindowOpen) {
      return {
        code: '',
        label: 'Pode falar agora',
        message: 'Ja existe conversa aberta com esse motorista.',
        badgeLabel: 'Conversa aberta',
        pillTone: 'window-open',
        cardTone: 'success',
        hardBlock: false,
      };
    }

    if (operational.firstOutboundPending) {
      return {
        code: operational.restrictionCode || 'FIRST_CONTACT_TEMPLATE_REQUIRED',
        label: 'Primeiro envio',
        message: 'Ainda nao houve contato. Comece com uma mensagem aprovada.',
        badgeLabel: 'Primeiro envio',
        pillTone: 'first-contact',
        cardTone: 'warning',
        hardBlock: false,
      };
    }

    return {
      code: operational.restrictionCode || 'OUTSIDE_SERVICE_WINDOW',
      label: 'Mensagem aprovada',
      message: 'Sem conversa aberta no momento. O próximo contato precisa usar mensagem aprovada.',
      badgeLabel: 'Mensagem aprovada',
      pillTone: 'template-only',
      cardTone: 'warning',
      hardBlock: false,
    };
  }

  function getDriverLastError(operational) {
    if (!operational.lastErrorCode && !operational.lastErrorMessage) {
      return {
        exists: false,
        title: 'Sem erro recente',
        message: 'Nenhuma falha operacional registrada no histórico atual.',
        cardTone: 'success',
      };
    }

    return {
      exists: true,
      title: buildLastErrorTitle(operational),
      message: operational.lastErrorAt
        ? (operational.lastErrorMessage || 'Falha registrada') + ' | ' + formatDateTime(operational.lastErrorAt)
        : (operational.lastErrorMessage || 'Falha registrada'),
      cardTone: 'danger',
    };
  }

  function buildLastErrorTitle(operational) {
    var code = String(operational.lastErrorCode || '').trim();
    if (!code) {
      return 'Falha operacional';
    }
    if (code === 'DELIVERY_FAILED') {
      return 'Falha na entrega';
    }
    if (code === 'TEXT_OUTSIDE_WINDOW') {
      return 'Texto fora da janela';
    }
    if (code === 'PHONE_NOT_FOUND') {
      return 'Telefone inválido';
    }
    if (code === 'CONTACT_BLOCKED' || code === 'OPT_OUT_ACTIVE') {
      return 'Contato bloqueado';
    }
    if (code === 'COOLDOWN_ACTIVE') {
      return 'Pausa ativa';
    }
    if (code === 'MARKETING_OPT_OUT') {
      return 'Não receber campanhas';
    }
    return code;
  }

  function buildPolicyLine(policy) {
    if (policy.marketingOptOut) {
      return policy.marketingOptOutReason || 'Motorista pediu para não receber novos envios de campanha.';
    }
    if (policy.contactBlocked || policy.optInStatus === 'revoked') {
      return policy.contactBlockReason || 'Esse contato está pausado para novos envios.';
    }
    return 'Sem bloqueio de campanha registrado para este motorista.';
  }

  function policyCardTone(policy) {
    if (policy.marketingOptOut || policy.contactBlocked || policy.optInStatus === 'revoked') return 'danger';
    return 'success';
  }

  function buildCooldownLine(operational) {
    if (operational.cooldownActive) {
      return (operational.cooldownUntil ? ('Ate ' + formatDateTime(operational.cooldownUntil)) : 'Pausa ativa') +
        (operational.cooldownReason ? (' | ' + operational.cooldownReason) : '');
    }
    return 'Nenhuma pausa operacional ativa.';
  }

  function formatPhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 11) {
      return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
    }
    if (digits.length === 13) {
      return '+' + digits.slice(0, 2) + ' (' + digits.slice(2, 4) + ') ' + digits.slice(4, 9) + '-' + digits.slice(9);
    }
    return String(phone);
  }

  function formatApps(driver) {
    if (Array.isArray(driver.appsRegistered) && driver.appsRegistered.length) {
      return driver.appsRegistered.join(', ');
    }
    return driver.mainApp || '';
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleDateString('pt-BR');
    } catch (_err) {
      return '';
    }
  }

  function formatDateTime(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('pt-BR');
    } catch (_err) {
      return '';
    }
  }

  function extractErrorMessage(err) {
    return err?.payload?.error?.message || err?.payload?.error || err?.message || 'Falha na requisicao.';
  }

  let searchTimer = null;

  refs.filterState.addEventListener('change', function () {
    updateCityOptions(refs.filterCity.value);
    applyFilters();
  });
  refs.filterCity.addEventListener('change', applyFilters);
  refs.filterCampaign.addEventListener('change', applyFilters);
  refs.filterSearch.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 200);
  });
  refs.btnExportDrivers && refs.btnExportDrivers.addEventListener('click', handleExportDrivers);
  refs.btnRefresh && refs.btnRefresh.addEventListener('click', function () { loadData(true); });
  var btnThemeToggle = document.getElementById('btnThemeToggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('motoristas:theme', next); } catch (_) {}
    });
  }
  refs.bulkMessageMode.addEventListener('change', function () {
    toggleComposerMode(bulkComposer);
    renderBulkState();
  });
  refs.modalMessageMode.addEventListener('change', syncModalComposerAvailability);
  refs.btnBulkSend.addEventListener('click', handleBulkSend);
  refs.btnSendSingle.addEventListener('click', handleSingleSend);
  refs.crmBody.addEventListener('click', handleTableClick);
  refs.driverModal.addEventListener('click', handleRestoreCampaignClick);
  refs.modalBackdrop.addEventListener('click', closeDriverModal);
  refs.btnCloseModal.addEventListener('click', closeDriverModal);

  if (refs.btnBlockDriver) {
    refs.btnBlockDriver.addEventListener('click', handleBlockDriverClick);
  }
  if (refs.btnConfirmBlock) {
    refs.btnConfirmBlock.addEventListener('click', function () {
      var driverId = state.modal.driverId;
      if (!driverId) return;
      applyDriverBlock(driverId, true, refs.blockReasonInput ? refs.blockReasonInput.value.trim() : '');
    });
  }
  if (refs.btnCancelBlock) {
    refs.btnCancelBlock.addEventListener('click', hideBlockReasonSection);
  }

  refs.tableWrap.addEventListener('scroll', onTableScroll, { passive: true });
  window.addEventListener('resize', function () {
    if (state.filtered.length) renderVirtualWindow();
  });

  // Arrastar tabela com o mouse (qualquer ponto) -> permite navegar horizontalmente sem buscar a barra
  let dragState = null;
  refs.tableWrap.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest('input, button, a, select, textarea, label')) return;
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollX: refs.tableWrap.scrollLeft,
      startScrollY: refs.tableWrap.scrollTop,
      moved: false,
    };
  });
  window.addEventListener('mousemove', function (e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      dragState.moved = true;
      refs.tableWrap.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }
    if (dragState.moved) {
      refs.tableWrap.scrollLeft = dragState.startScrollX - dx;
      refs.tableWrap.scrollTop = dragState.startScrollY - dy;
      e.preventDefault();
    }
  });
  window.addEventListener('mouseup', function () {
    if (!dragState) return;
    refs.tableWrap.style.cursor = '';
    document.body.style.userSelect = '';
    const wasMoved = dragState.moved;
    dragState = null;
    if (wasMoved) {
      const suppress = function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener('click', suppress, true);
      };
      window.addEventListener('click', suppress, true);
    }
  });
  refs.modalCampaignList.addEventListener('click', handleModalCampaignClick);
  refs.modalCampaignSelect.addEventListener('change', function () {
    state.modal.selectedCampaignId = refs.modalCampaignSelect.value;
    renderModalHistory();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.modal.open) {
      closeDriverModal();
    }
  });

  loadData(false);
})();
