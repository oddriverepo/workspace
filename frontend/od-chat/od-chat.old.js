(function () {
  'use strict';

  const API = window.API_BASE || '';

  /* -- DOM refs -- */
  const conversationListEl = document.getElementById('conversationList');
  const convLoading = document.getElementById('convLoading');
  const filterDropdown = document.getElementById('filterDropdown');
  const btnNewChat = document.getElementById('btnNewChat');
  const newChatPanel = document.getElementById('newChatPanel');
  const btnCloseNewChat = document.getElementById('btnCloseNewChat');
  const searchContacts = document.getElementById('searchContacts');
  const contactListEl = document.getElementById('contactList');
  const chatEmpty = document.getElementById('chatEmpty');
  const chatActive = document.getElementById('chatActive');
  const chatAvatar = document.getElementById('chatAvatar');
  const chatName = document.getElementById('chatName');
  const chatPhone = document.getElementById('chatPhone');
  const messagesScroll = document.getElementById('messagesScroll');
  const composeInput = document.getElementById('composeInput');
  const btnSend = document.getElementById('btnSend');

  let conversations = [];
  let allDrivers = [];
  let phoneToMeta = {}; // digits -> { campaignId, campaignName }
  let campaignNameById = {}; // campaignId -> campaignName
  let dataLoaded = false;

  let activeConvId = null;
  let pollTimer = null;
  let convPollTimer = null;
  let logoutRequested = false;

  /* -- Helpers -- */
  function esc(s) { const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

  function normalizeCampaignId(value) {
    const raw = String(value || '').trim();
    return raw ? raw : '';
  }

  function notifySessionExpired() {
    if (logoutRequested) return;
    logoutRequested = true;
    try {
      window.parent.postMessage({ type: 'LOGOUT_REQUEST' }, '*');
    } catch (_) {}
  }

  function normalizeToE164(phone) {
    let digits = digitsOnly(phone);
    if (!digits) return '';
    if (digits.length === 11) digits = '55' + digits;
    if (!digits.startsWith('55') && digits.length === 10) digits = '55' + digits;
    return '+' + digits;
  }

  // Lê o token no momento da requisição (não no module load) para garantir
  // que o token já foi gravado pelo script inline do index.html.
  function getToken() {
    return localStorage.getItem('adminToken') || '';
  }

  // Mostra estado de reconexão silenciosamente na UI (sem logs de erro para o usuário)
  function showReconnecting(show) {
    if (!convLoading) return;
    if (show) {
      convLoading.style.display = '';
      convLoading.textContent = 'Reconectando ao servidor...';
    } else {
      convLoading.style.display = 'none';
    }
  }

  async function authFetch(url, opts) {
    opts = opts || {};
    // Até 6 tentativas com backoff exponencial (máx 10s entre tentativas)
    // Cobre cold start do Render (~15-30s): 0+2+4+6+8+10 = 30s de janela
    const maxRetries = 6;
    const originalBody = opts.body;
    const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 25000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let timeoutId = null;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;

      try {
        const token = getToken();
        if (!token) {
          notifySessionExpired();
          throw Object.assign(new Error('HTTP 401'), { status: 401 });
        }
        const headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
        let body = originalBody;
        if (body && typeof body === 'object' && !(body instanceof FormData)) {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(body);
        }

        const requestOptions = Object.assign({}, opts, { headers, body });
        delete requestOptions.timeoutMs;

        if (controller) {
          timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
          requestOptions.signal = controller.signal;
        }

        const endpoint = url.startsWith('http') ? url : API + url;
        const res = await fetch(endpoint, requestOptions);

        // Se chegou aqui, servidor respondeu — esconde indicador de reconexão
        if (attempt > 0) showReconnecting(false);

        if (res.status === 401) {
          notifySessionExpired();
          throw Object.assign(new Error('HTTP 401'), { status: 401 });
        }

        if (!res.ok) {
          throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
        }

        return res.json();
      } catch (err) {
        const isTimeout = err && err.name === 'AbortError';
        const isNetworkError =
          isTimeout ||
          err.message === 'Failed to fetch' ||
          err.message === 'NetworkError when attempting to fetch resource.';
        const is401 = err && err.status === 401;

        // Não tentar novamente em caso de 401 (sessão inválida)
        if (is401) throw err;

        if (isNetworkError && attempt < maxRetries) {
          // Mostra reconexão silenciosa na UI (sem console.error para não asustar)
          showReconnecting(true);
          const delayMs = Math.min(2000 * (attempt + 1), 10000);
          await new Promise(function (r) { setTimeout(r, delayMs); });
          continue;
        }

        throw err;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }

  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function fmtPhone(p) {
    if (!p) return '';
    const d = digitsOnly(p);
    if (d.length === 13) return '+' + d.slice(0, 2) + ' (' + d.slice(2, 4) + ') ' + d.slice(4, 9) + '-' + d.slice(9);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    return p;
  }

  function fmtTime(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function fmtMsgTime(dt) {
    if (!dt) return '';
    return new Date(dt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function deliveryIcon(status) {
    if (status === 'read') return '<span class="msg-check read">✓✓</span>';
    if (status === 'delivered') return '<span class="msg-check delivered">✓✓</span>';
    if (status === 'sent') return '<span class="msg-check sent">✓</span>';
    if (status === 'failed') return '<span class="msg-check failed">✕</span>';
    if (status === 'simulated') return '<span class="msg-check simulated">⏸</span>';
    return '';
  }

  function getDriverCampaignId(driver) {
    return normalizeCampaignId(driver && (driver.campaignId || (driver.campaignData && driver.campaignData.campaignId) || ''));
  }

  function getDriverCampaignName(driver) {
    const direct = String((driver && ((driver.campaignData && driver.campaignData.name) || driver.campaignName)) || '').trim();
    if (direct) return direct;
    const campaignId = getDriverCampaignId(driver);
    return campaignNameById[campaignId] || '';
  }

  function getPhoneMeta(phoneE164) {
    const digits = digitsOnly(phoneE164);
    if (!digits) return null;
    return phoneToMeta[digits] || phoneToMeta[digits.slice(-11)] || null;
  }

  function buildCampaignNameIndex(campaignsArray) {
    campaignNameById = {};
    (campaignsArray || []).forEach(function (camp) {
      const id = normalizeCampaignId(camp && (camp.id || camp._id || camp.campaignId));
      const name = String((camp && camp.name) || '').trim();
      if (id && name) campaignNameById[id] = name;
    });
  }

  function buildPhoneCampaignMetaIndex() {
    phoneToMeta = {};

    allDrivers.forEach(function (driver) {
      const digits = digitsOnly(driver && driver.phone);
      if (!digits) return;

      const campaignId = getDriverCampaignId(driver);
      const campaignName = getDriverCampaignName(driver);
      const entry = { campaignId: campaignId || null, campaignName: campaignName || '' };

      phoneToMeta[digits] = entry;
      if (digits.length > 11) phoneToMeta[digits.slice(-11)] = entry;
    });
  }

  function getCampaignArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.items)) return raw.items;
    if (raw && Array.isArray(raw.campaigns)) return raw.campaigns;
    return [];
  }

  function isActiveCampaign(campaign) {
    const status = norm(campaign && campaign.status);
    return status === 'ativa' || status === 'active';
  }

  function populateCampaignFilter(campaignsArray) {
    if (!filterDropdown) return;

    const campaigns = (campaignsArray || [])
      .filter(isActiveCampaign)
      .sort(function (a, b) {
        return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'pt-BR');
      });

    while (filterDropdown.options.length > 2) filterDropdown.remove(2);

    campaigns.forEach(function (camp) {
      const id = normalizeCampaignId(camp && (camp.id || camp._id || camp.campaignId));
      if (!id) return;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = String((camp && camp.name) || id);
      filterDropdown.appendChild(opt);
    });
  }

  /* -- Campaign + Driver data -- */
  async function loadCampaignsAndDrivers(forceRefresh) {
    if (!forceRefresh && dataLoaded) return;

    // Buscar sempre da API (MongoDB via backend)
    const results = await Promise.allSettled([
      authFetch('/api/drivers'),
      authFetch('/api/campaigns'),
    ]);

    const driversResult   = results[0];
    const campaignsResult = results[1];

    if (driversResult.status === 'fulfilled') {
      const items = Array.isArray(driversResult.value && driversResult.value.items)
        ? driversResult.value.items
        : [];

      allDrivers = items
        .filter(function (d) { return d && d.phone; })
        .sort(function (a, b) {
          return String(a && a.name || '').localeCompare(String(b && b.name || ''), 'pt-BR');
        });

      dataLoaded = true;
    } else {
      allDrivers = [];
      dataLoaded = false;
      console.error('[OD Chat] Erro ao carregar motoristas:', driversResult.reason);
    }

    let campaignsArray = [];
    if (campaignsResult.status === 'fulfilled') {
      campaignsArray = getCampaignArray(campaignsResult.value);
    } else {
      console.error('[OD Chat] Erro ao carregar campanhas:', campaignsResult.reason);
    }

    buildCampaignNameIndex(campaignsArray);
    buildPhoneCampaignMetaIndex();
    populateCampaignFilter(campaignsArray);

    console.debug('[OD Chat] API:', allDrivers.length, 'motoristas,', campaignsArray.length, 'campanhas');
    renderConversations();
  }

  /* -- Conversations -- */
  async function loadConversations() {
    try {
      const data = await authFetch('/api/disparador/inbox/conversations?limit=200');
      conversations = (data.items || []).sort(function (a, b) {
        const ta = new Date(a.lastMessageAt || a.updatedAt || 0).getTime();
        const tb = new Date(b.lastMessageAt || b.updatedAt || 0).getTime();
        return tb - ta;
      });
      showReconnecting(false);
      renderConversations();
    } catch (err) {
      // Só loga se for erro real (não rede/cold-start, já tratado no authFetch)
      if (err && err.status && err.status !== 401) {
        console.warn('[OD Chat] Falha ao carregar conversas:', err.message || err);
      }
      // Não exibe mensagem de erro para erros de rede — o authFetch já mostra "Reconectando"
      if (err && err.status) {
        convLoading.textContent = 'Erro ao carregar conversas.';
        if (convLoading) convLoading.style.display = '';
      }
      renderConversations();
    }
  }

  function getCurrentFilterValue() {
    return filterDropdown ? filterDropdown.value : 'all';
  }

  function matchesDriverFilter(driver, filterValue) {
    if (!driver) return false;

    const campaignId = getDriverCampaignId(driver);

    if (filterValue === 'all') return true;
    if (filterValue === 'no-campaign') return !campaignId;
    return campaignId === normalizeCampaignId(filterValue);
  }

  function matchesConversationFilter(conversation, filterValue) {
    if (!conversation) return false;

    const meta = getPhoneMeta(conversation.phoneE164);
    const campaignId = normalizeCampaignId(meta && meta.campaignId);

    if (filterValue === 'all') return true;
    if (filterValue === 'no-campaign') return !campaignId;
    return campaignId === normalizeCampaignId(filterValue);
  }

  function getFilteredConversations(filterValue) {
    return conversations.filter(function (conv) {
      return matchesConversationFilter(conv, filterValue);
    });
  }

  function buildConversationLookup(filteredConversations) {
    const map = new Map();

    (filteredConversations || []).forEach(function (conv) {
      const digits = digitsOnly(conv && conv.phoneE164);
      if (!digits) return;

      if (!map.has(digits)) map.set(digits, conv);
      const suffix = digits.slice(-11);
      if (suffix && !map.has(suffix)) map.set(suffix, conv);
    });

    return map;
  }

  function getConversationForDriver(driver, lookup) {
    const digits = digitsOnly(driver && driver.phone);
    if (!digits) return null;
    return lookup.get(digits) || lookup.get(digits.slice(-11)) || null;
  }

  function getConversationTimestamp(conversation) {
    return new Date((conversation && (conversation.lastMessageAt || conversation.updatedAt)) || 0).getTime();
  }

  function getDisplayNameForConversation(conversation, driver) {
    return (
      (conversation && conversation.displayName) ||
      (conversation && conversation.contact && conversation.contact.name) ||
      (driver && driver.name) ||
      fmtPhone(conversation && conversation.phoneE164) ||
      'Sem nome'
    );
  }

  function buildConversationRows() {
    const filterValue = getCurrentFilterValue();
    const filteredDrivers = allDrivers.filter(function (driver) {
      return matchesDriverFilter(driver, filterValue);
    });
    const filteredConversations = getFilteredConversations(filterValue);

    const conversationLookup = buildConversationLookup(filteredConversations);
    const usedConversationIds = new Set();
    const rows = [];

    filteredDrivers.forEach(function (driver) {
      const conv = getConversationForDriver(driver, conversationLookup);

      if (conv && !usedConversationIds.has(conv.id)) {
        usedConversationIds.add(conv.id);
        rows.push({ type: 'conversation', conversation: conv, driver });
      } else {
        rows.push({ type: 'driver', driver });
      }
    });

    filteredConversations.forEach(function (conv) {
      if (usedConversationIds.has(conv.id)) return;
      usedConversationIds.add(conv.id);
      rows.push({ type: 'conversation', conversation: conv, driver: null });
    });

    rows.sort(function (a, b) {
      const aIsConv = a.type === 'conversation';
      const bIsConv = b.type === 'conversation';

      if (aIsConv && !bIsConv) return -1;
      if (!aIsConv && bIsConv) return 1;

      if (aIsConv && bIsConv) {
        return getConversationTimestamp(b.conversation) - getConversationTimestamp(a.conversation);
      }

      return String((a.driver && a.driver.name) || '').localeCompare(String((b.driver && b.driver.name) || ''), 'pt-BR');
    });

    return rows;
  }

  function renderConversations() {
    convLoading.style.display = 'none';

    const filterValue = getCurrentFilterValue();

    // Se filtro está numa campanha específica e motoristas ainda não carregaram, mostrar loading
    if (filterValue !== 'all' && filterValue !== 'no-campaign' && !dataLoaded) {
      conversationListEl.innerHTML = '<div class="loading-hint">Carregando motoristas da campanha...</div>';
      return;
    }

    const rows = buildConversationRows();
    if (!rows.length) {
      const msg = (filterValue !== 'all' && filterValue !== 'no-campaign')
        ? 'Nenhum motorista encontrado nesta campanha'
        : 'Nenhuma conversa';
      conversationListEl.innerHTML = '<div class="loading-hint">' + msg + '</div>';
      return;
    }

    let html = '';

    rows.forEach(function (row) {
      if (row.type === 'conversation') {
        const c = row.conversation;
        const name = getDisplayNameForConversation(c, row.driver);
        const preview = c.lastMessagePreview || 'Conversa iniciada';
        const time = fmtTime(c.lastMessageAt || c.updatedAt);
        const unread = (c.unreadCount || 0) > 0
          ? '<span class="unread-badge">' + c.unreadCount + '</span>'
          : '';
        const active = c.id === activeConvId ? ' active' : '';

        html += '<div class="conv-item' + active + '" data-conv-id="' + esc(c.id) + '">'
          + '<div class="conv-avatar">' + esc(initials(name)) + '</div>'
          + '<div class="conv-body">'
          + '<div class="conv-top"><span class="conv-name">' + esc(name) + '</span><span class="conv-time">' + esc(time) + '</span></div>'
          + '<div class="conv-bottom"><span class="conv-preview">' + esc(preview.slice(0, 80)) + '</span>' + unread + '</div>'
          + '</div></div>';

        return;
      }

      const d = row.driver;
      const name = (d && d.name) || fmtPhone(d && d.phone) || 'Sem nome';
      const phone = fmtPhone((d && d.phone) || '');
      const campaignId = getDriverCampaignId(d);
      const campaignName = getDriverCampaignName(d) || (campaignId ? 'Com campanha' : 'Sem campanha');
      const preview = (phone ? phone + ' · ' : '') + campaignName;

      html += '<div class="conv-item driver-only" data-driver-phone="' + esc((d && d.phone) || '') + '" data-driver-name="' + esc(name) + '">'
        + '<div class="conv-avatar">' + esc(initials(name)) + '</div>'
        + '<div class="conv-body">'
        + '<div class="conv-top"><span class="conv-name">' + esc(name) + '</span><span class="conv-time">Novo</span></div>'
        + '<div class="conv-bottom"><span class="conv-preview">' + esc(preview.slice(0, 90)) + '</span></div>'
        + '</div></div>';
    });

    conversationListEl.innerHTML = html;
  }

  /* -- Contacts (new chat) -- */
  async function loadDriversForNewChat() {
    await loadCampaignsAndDrivers();
  }

  function renderContacts(query) {
    const q = norm(query || '');
    let pool = allDrivers;

    if (q) {
      pool = pool.filter(function (d) {
        const hay = norm([(d && d.name), (d && d.phone), (d && d.plate), (d && d.cpf), fmtPhone(d && d.phone)].join(' '));
        return hay.includes(q);
      });
    }

    if (!pool.length) {
      contactListEl.innerHTML = '<div class="loading-hint">Nenhum contato encontrado</div>';
      return;
    }

    let html = '';

    pool.forEach(function (d) {
      const name = (d && d.name) || 'Sem nome';
      const phone = (d && d.phone) || '';
      const campaignId = getDriverCampaignId(d);
      const campaign = getDriverCampaignName(d) || (campaignId ? 'Com campanha' : 'Sem campanha');

      html += '<div class="contact-item" data-phone="' + esc(phone) + '" data-name="' + esc(name) + '">'
        + '<div class="conv-avatar">' + esc(initials(name)) + '</div>'
        + '<div class="conv-body">'
        + '<div class="conv-top"><span class="conv-name">' + esc(name) + '</span></div>'
        + '<div class="conv-bottom"><span class="conv-preview">' + esc(fmtPhone(phone)) + ' · ' + esc(campaign) + '</span></div>'
        + '</div></div>';
    });

    contactListEl.innerHTML = html;
  }

  /* -- Messages -- */
  async function openConversation(convId) {
    activeConvId = convId;
    chatEmpty.classList.add('hidden');
    chatActive.classList.remove('hidden');

    const conv = conversations.find(function (c) { return c.id === convId; });
    const name = getDisplayNameForConversation(conv, null) || 'Chat';

    chatAvatar.textContent = initials(name);
    chatName.textContent = name;
    chatPhone.textContent = fmtPhone(conv && conv.phoneE164 || '');

    renderConversations(); // refresh active highlight

    messagesScroll.innerHTML = '<div class="loading-hint">Carregando...</div>';

    try {
      const data = await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(convId) + '/messages?limit=500');
      renderMessages(data.items || []);

      if (conv && conv.unreadCount > 0) {
        authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(convId) + '/read', { method: 'POST' }).catch(function () {});
        conv.unreadCount = 0;
        renderConversations();
      }
    } catch (err) {
      console.error('[OD Chat] Erro ao carregar mensagens:', err);
      messagesScroll.innerHTML = '<div class="loading-hint">Erro ao carregar mensagens.</div>';
    }

    composeInput.focus();
    startMessagePoll();
  }

  function renderMessages(messages) {
    if (!messages.length) {
      messagesScroll.innerHTML = '<div class="loading-hint msg-empty">Nenhuma mensagem ainda</div>';
      return;
    }

    const sorted = [].concat(messages).sort(function (a, b) {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    let html = '';
    let lastDate = '';

    sorted.forEach(function (m) {
      const d = new Date(m.createdAt);
      const dateStr = d.toLocaleDateString('pt-BR');

      if (dateStr !== lastDate) {
        lastDate = dateStr;
        html += '<div class="date-divider"><span>' + esc(dateStr) + '</span></div>';
      }

      const dir = m.direction === 'inbound' ? 'in' : 'out';
      const text = m.text || m.templateName || '[mensagem]';
      const time = fmtMsgTime(m.createdAt);
      const check = dir === 'out' ? deliveryIcon(m.deliveryStatus) : '';

      html += '<div class="msg msg-' + dir + '">'
        + '<div class="msg-bubble">'
        + '<span class="msg-text">' + esc(text) + '</span>'
        + '<span class="msg-meta">' + esc(time) + ' ' + check + '</span>'
        + '</div></div>';
    });

    messagesScroll.innerHTML = html;
    messagesScroll.scrollTop = messagesScroll.scrollHeight;
  }

  /* -- Send -- */
  async function sendMessage() {
    const text = composeInput.value.trim();
    if (!text || !activeConvId) return;

    composeInput.value = '';
    btnSend.disabled = true;

    const tempHtml = '<div class="msg msg-out"><div class="msg-bubble">'
      + '<span class="msg-text">' + esc(text) + '</span>'
      + '<span class="msg-meta">' + esc(fmtMsgTime(new Date().toISOString())) + ' <span class="msg-check sending">⏳</span></span>'
      + '</div></div>';

    messagesScroll.insertAdjacentHTML('beforeend', tempHtml);
    messagesScroll.scrollTop = messagesScroll.scrollHeight;

    try {
      await authFetch('/api/disparador/inbox/send', {
        method: 'POST',
        body: { conversationId: activeConvId, type: 'text', text },
      });

      const data = await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(activeConvId) + '/messages?limit=500');
      renderMessages(data.items || []);
      loadConversations();
    } catch (err) {
      console.error('[OD Chat] Erro ao enviar:', err);
      const lastBubble = messagesScroll.querySelector('.msg:last-child .msg-check');
      if (lastBubble) {
        lastBubble.className = 'msg-check failed';
        lastBubble.textContent = '✕';
      }
    }
  }

  /* -- New chat flow -- */
  async function startNewChat(phone, displayName) {
    const phoneE164 = normalizeToE164(phone);
    if (!phoneE164) return;

    newChatPanel.classList.add('hidden');
    chatEmpty.classList.add('hidden');
    chatActive.classList.remove('hidden');

    chatAvatar.textContent = initials(displayName);
    chatName.textContent = displayName;
    chatPhone.textContent = fmtPhone(phoneE164);
    messagesScroll.innerHTML = '<div class="loading-hint">Iniciando conversa...</div>';

    try {
      const data = await authFetch('/api/disparador/inbox/conversations', {
        method: 'POST',
        body: { phoneE164, displayName },
      });

      const conv = data.item;
      if (conv) {
        activeConvId = conv.id;
        await loadConversations();
        await openConversation(conv.id);
      }
    } catch (err) {
      console.error('[OD Chat] Erro ao criar conversa:', err);
      messagesScroll.innerHTML = '<div class="loading-hint">Erro ao iniciar conversa.</div>';
    }
  }

  /* -- Polling -- */
  function startMessagePoll() {
    stopMessagePoll();

    pollTimer = setInterval(async function () {
      if (!activeConvId) return;
      try {
        const data = await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(activeConvId) + '/messages?limit=500');
        renderMessages(data.items || []);
      } catch (_) {}
    }, 8000);
  }

  function stopMessagePoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startConversationPoll() {
    if (convPollTimer) clearInterval(convPollTimer);

    convPollTimer = setInterval(function () {
      loadConversations();
    }, 15000);
  }

  /* -- Events -- */
  conversationListEl.addEventListener('click', function (e) {
    const convItem = e.target.closest('[data-conv-id]');
    if (convItem) {
      openConversation(convItem.dataset.convId);
      return;
    }

    const driverItem = e.target.closest('[data-driver-phone]');
    if (!driverItem) return;

    const phone = driverItem.dataset.driverPhone;
    const name = driverItem.dataset.driverName || fmtPhone(phone) || 'Sem nome';
    startNewChat(phone, name);
  });

  contactListEl.addEventListener('click', function (e) {
    const item = e.target.closest('[data-phone]');
    if (!item) return;
    const phone = item.dataset.phone;
    const name = item.dataset.name;
    startNewChat(phone, name);
  });

  filterDropdown.addEventListener('change', async function () {
    // Garantir que os dados de motoristas/campanhas estão carregados antes de filtrar
    if (!dataLoaded) {
      convLoading.style.display = '';
      convLoading.textContent = 'Carregando motoristas...';
      await loadCampaignsAndDrivers();
    }
    renderConversations();
  });

  let contactSearchTimer;
  searchContacts.addEventListener('input', function () {
    clearTimeout(contactSearchTimer);
    contactSearchTimer = setTimeout(function () {
      renderContacts(searchContacts.value.trim());
    }, 200);
  });

  btnNewChat.addEventListener('click', async function () {
    newChatPanel.classList.remove('hidden');
    await loadDriversForNewChat();
    renderContacts('');
    searchContacts.value = '';
    searchContacts.focus();
  });

  btnCloseNewChat.addEventListener('click', function () {
    newChatPanel.classList.add('hidden');
  });

  composeInput.addEventListener('input', function () {
    btnSend.disabled = !composeInput.value.trim();
  });

  composeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  btnSend.addEventListener('click', sendMessage);

  /* -- Init -- */
  async function init() {
    if (!getToken()) {
      convLoading.textContent = 'Sessao expirada. Faca login novamente.';
      notifySessionExpired();
      return;
    }

    // Load in parallel so a drivers/campaign failure does not block conversations.
    loadConversations();
    loadCampaignsAndDrivers();
    startConversationPoll();
  }

  init();
})();
