(function () {
  'use strict';

  const API = window.API_BASE || '';

  /* ═══════════════════════════════════════════════════════════════
     DOM refs
     ═══════════════════════════════════════════════════════════════ */
  const conversationListEl = document.getElementById('conversationList');
  const convLoading        = document.getElementById('convLoading');
  const filterDropdown     = document.getElementById('filterDropdown');
  const sidebarSearch      = document.getElementById('sidebarSearch');
  const sseIndicator       = document.getElementById('sseIndicator');
  // Estado inicial: "conectando" para evitar bolinha vermelha fantasma no carregamento.
  if (sseIndicator) { sseIndicator.className = 'sse-indicator connecting'; sseIndicator.title = 'Conectando\u2026'; }
  const btnNewChat         = document.getElementById('btnNewChat');
  const newChatPanel       = document.getElementById('newChatPanel');
  const btnCloseNewChat    = document.getElementById('btnCloseNewChat');
  const searchContacts     = document.getElementById('searchContacts');
  const contactListEl      = document.getElementById('contactList');
  const chatEmpty          = document.getElementById('chatEmpty');
  const chatActive         = document.getElementById('chatActive');
  const chatAvatar         = document.getElementById('chatAvatar');
  const chatName           = document.getElementById('chatName');
  const chatPhone          = document.getElementById('chatPhone');
  const messagesScroll     = document.getElementById('messagesScroll');
  const messagesAreaEl     = document.getElementById('messagesArea');
  const composeInput       = document.getElementById('composeInput');
  const btnSend            = document.getElementById('btnSend');
  const btnPauseFlow       = document.getElementById('btnPauseFlow');
  const btnResumeFlow      = document.getElementById('btnResumeFlow');
  const btnTemplate        = document.getElementById('btnTemplate');
  const templatePicker     = document.getElementById('templatePicker');
  const templateList       = document.getElementById('templateList');
  const btnCloseTemplate   = document.getElementById('btnCloseTemplate');
  const ctxMenu            = document.getElementById('ctxMenu');
  const driverInfoPanel    = document.getElementById('driverInfoPanel');
  const driverInfoBody     = document.getElementById('driverInfoBody');
  const btnCloseDriverInfo = document.getElementById('btnCloseDriverInfo');
  const notifSound         = document.getElementById('notifSound');

  /* ═══════════════════════════════════════════════════════════════
     State
     ═══════════════════════════════════════════════════════════════ */
  let conversations   = [];          // sorted by lastMessageAt
  let convById        = new Map();   // quick lookup
  let allDrivers      = [];
  let phoneToMeta     = {};
  let campaignNameById = {};
  let dataLoaded      = false;
  let campaignsLoaded = false;
  let activeConvId    = null;
  let activeMessages  = [];          // messages for open conversation
  let msgIdSet        = new Set();   // dedup
  let convMsgCache    = new Map();   // conversationId -> { items, hasMore, nextBefore }
  let loadMsgCtrl     = null;
  let loadMsgSeq      = 0;
  let loadingOlder    = false;
  let hasOlderMessages = false;
  let nextBeforeCursor = '';
  let logoutRequested = false;
  let sseSource       = null;        // EventSource
  let convPollTimer   = null;
  let ctxTargetConvId = null;
  let ctxTargetPhone  = null;
  let totalUnread     = 0;
  let templates       = [];
  let sidebarRowsCache = [];
  let sidebarRowsDirty = true;
  let sidebarRenderRaf = 0;
  let sidebarRowHeight = 68;
  let campaignDriverLoadPromise = null;

  var INITIAL_MESSAGES_LIMIT = 100;
  var POLL_MESSAGES_LIMIT = 40;
  var SIDEBAR_VIRTUAL_THRESHOLD = 100;
  var SIDEBAR_VIRTUAL_OVERSCAN = 8;

  /* ═══════════════════════════════════════════════════════════════
     Helpers
     ═══════════════════════════════════════════════════════════════ */
  function esc(s) { const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }
  function normalizeCampaignId(v) { return String(v || '').trim(); }

  function notifySessionExpired() {
    if (logoutRequested) return;
    logoutRequested = true;
    try { window.parent.postMessage({ type: 'LOGOUT_REQUEST' }, '*'); } catch (_) {}
  }

  function normalizeToE164(phone) {
    let digits = digitsOnly(phone);
    if (!digits) return '';
    if (digits.length === 11) digits = '55' + digits;
    if (!digits.startsWith('55') && digits.length === 10) digits = '55' + digits;
    return '+' + digits;
  }

  function getToken() { return localStorage.getItem('adminToken') || ''; }

  function perfNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function logPerf(op, startedAt, meta) {
    var elapsed = Math.max(0, perfNow() - startedAt).toFixed(1);
    if (meta) console.debug('[ODChat][perf]', op, elapsed + 'ms', meta);
    else console.debug('[ODChat][perf]', op, elapsed + 'ms');
  }

  function invalidateConversationRows() {
    sidebarRowsDirty = true;
  }

  function getConversationRows() {
    if (sidebarRowsDirty) {
      sidebarRowsCache = buildConversationRows();
      sidebarRowsDirty = false;
    }
    return sidebarRowsCache;
  }

  function scheduleConversationRender() {
    if (!conversationListEl || sidebarRenderRaf) return;
    sidebarRenderRaf = window.requestAnimationFrame(function () {
      sidebarRenderRaf = 0;
      renderConversations();
    });
  }

  function shouldVirtualizeConversationRows(rows) {
    return !!(conversationListEl && Array.isArray(rows) && rows.length >= SIDEBAR_VIRTUAL_THRESHOLD && conversationListEl.clientHeight > 0);
  }

  function syncSidebarRowHeight() {
    if (!conversationListEl) return;
    var rowEl = conversationListEl.querySelector('.conv-item');
    if (!rowEl) return;
    var measured = Math.round(rowEl.getBoundingClientRect().height || rowEl.offsetHeight || 0);
    if (measured >= 60 && Math.abs(measured - sidebarRowHeight) > 1) {
      sidebarRowHeight = measured;
      if (conversationListEl.dataset.virtualized === '1') scheduleConversationRender();
    }
  }

  /* ── Compact formatters ── */
  function initials(name) {
    if (!name) return '?';
    const p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
  }

  // Gradiente colorido deterministico baseado no nome (igual telegram/whatsapp).
  // 12 paletas suaves que combinam com tema dark/light.
  var AVATAR_GRADIENTS = [
    ['#6e8efb', '#a777e3'],
    ['#f857a6', '#ff5858'],
    ['#56ab2f', '#a8e063'],
    ['#ff9966', '#ff5e62'],
    ['#36d1dc', '#5b86e5'],
    ['#f7971e', '#ffd200'],
    ['#11998e', '#38ef7d'],
    ['#fc466b', '#3f5efb'],
    ['#1fa2ff', '#12d8fa'],
    ['#cc2b5e', '#753a88'],
    ['#ee9ca7', '#ffdde1'],
    ['#4568dc', '#b06ab3'],
  ];
  function avatarGradient(name) {
    var s = String(name || '?');
    var hash = 0;
    for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    var idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
    var g = AVATAR_GRADIENTS[idx];
    return 'linear-gradient(135deg, ' + g[0] + ' 0%, ' + g[1] + ' 100%)';
  }

  function safeAvatarUrl(rawUrl) {
    var raw = String(rawUrl || '').trim();
    if (!raw) return '';
    if (/^data:image\//i.test(raw)) return raw;
    try {
      var parsed = new URL(raw, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch (_) {}
    return '';
  }

  const AVATAR_ONERROR = "var p=this.parentNode;if(p){p.classList.remove('has-image');}this.remove();";

  function getDriverByPhone(phone) {
    var digits = digitsOnly(phone);
    if (!digits) return null;
    return allDrivers.find(function (d) {
      var dd = digitsOnly(d && d.phone);
      return dd && (dd === digits || dd.slice(-11) === digits.slice(-11));
    }) || null;
  }

  function getConversationDriver(conv, fallbackDriver) {
    if (fallbackDriver) return fallbackDriver;
    if (conv && conv.driverData) return conv.driverData;
    return getDriverByPhone(conv && conv.phoneE164);
  }

  function getAvatarUrl(driver, conv) {
    var fromDriver = safeAvatarUrl(driver && driver.avatar);
    if (fromDriver) return fromDriver;
    return safeAvatarUrl(conv && conv.contact && conv.contact.avatar);
  }

  function renderAvatarHTML(name, avatarUrl, className) {
    var classes = String(className || 'conv-avatar');
    var safeUrl = safeAvatarUrl(avatarUrl);
    var img = safeUrl
      ? '<img class="avatar-img" src="' + esc(safeUrl) + '" alt="' + esc(name || 'Avatar') + '" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="' + AVATAR_ONERROR + '">'
      : '';
    var styleAttr = safeUrl ? '' : ' style="--avatar-bg:' + avatarGradient(name) + '"';
    return '<div class="' + classes + (safeUrl ? ' has-image' : '') + '"' + styleAttr + '>'
      + img
      + '<span class="avatar-fallback">' + esc(initials(name)) + '</span>'
      + '</div>';
  }

  function setAvatarElement(el, name, avatarUrl) {
    if (!el) return;
    var safeUrl = safeAvatarUrl(avatarUrl);
    el.classList.toggle('has-image', !!safeUrl);
    if (safeUrl) {
      el.style.removeProperty('--avatar-bg');
    } else {
      el.style.setProperty('--avatar-bg', avatarGradient(name));
    }
    el.innerHTML = (safeUrl
      ? '<img class="avatar-img" src="' + esc(safeUrl) + '" alt="' + esc(name || 'Avatar') + '" decoding="async" referrerpolicy="no-referrer" onerror="' + AVATAR_ONERROR + '">'
      : '')
      + '<span class="avatar-fallback">' + esc(initials(name)) + '</span>';
  }

  function fmtPhone(p) {
    if (!p) return '';
    const d = digitsOnly(p);
    if (d.length === 13) return '+' + d.slice(0,2) + ' (' + d.slice(2,4) + ') ' + d.slice(4,9) + '-' + d.slice(9);
    if (d.length === 11) return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7);
    return p;
  }

  function fmtTime(dt) {
    if (!dt) return '';
    const d = new Date(dt), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function fmtMsgTime(dt) {
    if (!dt) return '';
    return new Date(dt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function deliveryIcon(status) {
    if (status === 'read')      return '<span class="msg-check read">\u2713\u2713</span>';
    if (status === 'delivered') return '<span class="msg-check delivered">\u2713\u2713</span>';
    if (status === 'sent')      return '<span class="msg-check sent">\u2713</span>';
    if (status === 'failed')    return '<span class="msg-check failed">\u2715</span>';
    if (status === 'simulated') return '<span class="msg-check simulated">\u23F8</span>';
    return '';
  }

  /* ── Driver / campaign helpers ── */
  function getDriverCampaignId(d) {
    return normalizeCampaignId(d && (d.campaignId || (d.campaignData && d.campaignData.campaignId) || ''));
  }
  function getDriverCampaignName(d) {
    const direct = String((d && ((d.campaignData && d.campaignData.name) || d.campaignName)) || '').trim();
    if (direct) return direct;
    return campaignNameById[getDriverCampaignId(d)] || '';
  }
  function getPhoneMeta(phoneE164) {
    const digits = digitsOnly(phoneE164);
    return phoneToMeta[digits] || phoneToMeta[digits.slice(-11)] || null;
  }

  /* ═══════════════════════════════════════════════════════════════
     authFetch — with retry / cold-start resilience
     ═══════════════════════════════════════════════════════════════ */
  function showReconnecting(show) {
    if (!convLoading) return;
    if (show) {
      convLoading.style.display = '';
      convLoading.innerHTML = '<div class="loading-hint">Reconectando\u2026</div>';
    } else {
      convLoading.style.display = 'none';
    }
  }

  async function authFetch(url, opts) {
    opts = opts || {};
    const maxRetries = 6;
    const originalBody = opts.body;
    const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 25000;
    const externalSignal = opts.signal || null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let tid = null;
      let abortHook = null;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        const token = getToken();
        if (!token) { notifySessionExpired(); throw Object.assign(new Error('HTTP 401'), { status: 401 }); }
        const headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
        let body = originalBody;
        if (body && typeof body === 'object' && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
        const ro = Object.assign({}, opts, { headers, body }); delete ro.timeoutMs; delete ro.signal;

        if (ctrl) {
          tid = setTimeout(function () { ctrl.abort(); }, timeoutMs);
          ro.signal = ctrl.signal;
          if (externalSignal) {
            if (externalSignal.aborted) {
              ctrl.abort();
            } else {
              abortHook = function () { ctrl.abort(); };
              externalSignal.addEventListener('abort', abortHook, { once: true });
            }
          }
        } else if (externalSignal) {
          if (externalSignal.aborted) throw Object.assign(new Error('AbortError'), { name: 'AbortError' });
          ro.signal = externalSignal;
        }

        const endpoint = url.startsWith('http') ? url : API + url;
        const res = await fetch(endpoint, ro);
        if (attempt > 0) showReconnecting(false);
        if (res.status === 401) { notifySessionExpired(); throw Object.assign(new Error('HTTP 401'), { status: 401 }); }
        if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
        return res.json();
      } catch (err) {
        if (err && err.status === 401) throw err;
        if (err && err.name === 'AbortError' && externalSignal && externalSignal.aborted) throw err;
        const isNetwork = (err && err.name === 'AbortError') || err.message === 'Failed to fetch' || (err.message || '').includes('NetworkError');
        if (isNetwork && attempt < maxRetries) { showReconnecting(true); await new Promise(function (r) { setTimeout(r, Math.min(2000 * (attempt + 1), 10000)); }); continue; }
        throw err;
      } finally {
        if (tid) clearTimeout(tid);
        if (externalSignal && abortHook) externalSignal.removeEventListener('abort', abortHook);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     SSE — real-time event stream
     ═══════════════════════════════════════════════════════════════ */
  async function connectSSE() {
    if (sseSource) { try { sseSource.close(); } catch (_) {} }
    const token = getToken();
    if (!token) {
      sseIndicator.className = 'sse-indicator disconnected';
      sseIndicator.title = 'Desconectado';
      return;
    }

    const url = (API || '') + '/api/disparador/inbox/stream';
    sseIndicator.className = 'sse-indicator connecting';
    sseIndicator.title = 'Conectando em tempo real...';
    let streamTicket = '';
    try {
      const ticketPayload = await api('/api/disparador/inbox/stream-ticket', { method: 'POST' });
      streamTicket = ticketPayload && ticketPayload.ticket ? String(ticketPayload.ticket) : '';
    } catch (err) {
      sseIndicator.className = 'sse-indicator disconnected';
      sseIndicator.title = 'Falha ao iniciar tempo real';
      return;
    }
    if (!streamTicket) {
      sseIndicator.className = 'sse-indicator disconnected';
      sseIndicator.title = 'Falha ao iniciar tempo real';
      return;
    }
    sseSource = new EventSource(url + '?streamTicket=' + encodeURIComponent(streamTicket));

    sseSource.addEventListener('hello', function () {
      sseIndicator.className = 'sse-indicator connected';
      sseIndicator.title = 'Conectado em tempo real';
    });

    sseSource.addEventListener('message.new', function (e) {
      try { handleSSEMessageNew(JSON.parse(e.data)); } catch (_) {}
    });

    sseSource.addEventListener('message.status', function (e) {
      try { handleSSEMessageStatus(JSON.parse(e.data)); } catch (_) {}
    });

    sseSource.addEventListener('conversation.updated', function (e) {
      try { handleSSEConversationUpdated(JSON.parse(e.data)); } catch (_) {}
    });

    sseSource.onerror = function () {
      sseIndicator.className = 'sse-indicator disconnected';
      sseIndicator.title = 'Reconectando\u2026';
    };

    sseSource.onopen = function () {
      sseIndicator.className = 'sse-indicator connected';
      sseIndicator.title = 'Conectado em tempo real';
    };
  }

  function renderTemplateTextFromSnapshot(snapshot, parameters) {
    var params = Array.isArray(parameters) ? parameters : [];
    function inject(text) {
      return String(text || '').replace(/\{\{\s*(\d+)\s*\}\}/g, function (match, rawIndex) {
        var index = Number(rawIndex) - 1;
        var value = params[index];
        return value === undefined || value === null || value === '' ? match : String(value);
      });
    }

    var parts = [];
    var headerType = String(snapshot && snapshot.headerType || 'none').toLowerCase();
    if (headerType === 'text' && snapshot && snapshot.headerText) parts.push(inject(snapshot.headerText));
    else if (headerType === 'image') parts.push('[imagem]');
    if (snapshot && snapshot.bodyText) parts.push(inject(snapshot.bodyText));
    if (snapshot && snapshot.footerText) parts.push(inject(snapshot.footerText));
    var buttonLabels = Array.isArray(snapshot && snapshot.buttons)
      ? snapshot.buttons.map(function (item) { return String(item && item.text || '').trim(); }).filter(Boolean)
      : [];
    if (buttonLabels.length) parts.push('Bot\u00f5es: ' + buttonLabels.join(' | '));
    return parts.filter(Boolean).join('\n').trim();
  }

  function safeMediaUrl(rawUrl) {
    var raw = String(rawUrl || '').trim();
    if (!raw) return '';
    if (/^blob:/i.test(raw)) return raw;
    if (/^data:(image|audio|video|application)\//i.test(raw)) return raw;
    try {
      var parsed = new URL(raw, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch (_) {}
    return '';
  }

  function getMessagePayload(m) {
    return m && m.payload && typeof m.payload === 'object' ? m.payload : {};
  }

  function buildMediaSummary(kind, media) {
    if (kind === 'image') return media.caption ? 'Imagem: ' + media.caption : 'Imagem recebida';
    if (kind === 'video') return media.caption ? 'Video: ' + media.caption : 'Video recebido';
    if (kind === 'document') return media.filename ? 'Documento: ' + media.filename : 'Documento recebido';
    if (kind === 'audio') return media.isVoiceNote ? 'Mensagem de voz' : 'Audio recebido';
    if (kind === 'sticker') return 'Figurinha';
    return '';
  }

  function getMessageMedia(m) {
    var payload = getMessagePayload(m);
    var kind = String(m && m.kind || payload.messageType || payload.kind || '').trim().toLowerCase();
    if (!['image', 'document', 'audio', 'video', 'sticker'].includes(kind)) return null;

    var raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : {};
    var rawNode = raw && raw[kind] && typeof raw[kind] === 'object' ? raw[kind] : {};
    var stored = payload.media && typeof payload.media === 'object' ? payload.media : {};
    var media = {
      kind: kind,
      caption: String(stored.caption || rawNode.caption || '').trim(),
      filename: String(stored.filename || rawNode.filename || '').trim(),
      mimeType: String(stored.mimeType || rawNode.mime_type || '').trim(),
      mediaId: String(stored.mediaId || rawNode.id || '').trim(),
      sha256: String(stored.sha256 || rawNode.sha256 || '').trim(),
      isVoiceNote: Boolean(stored.isVoiceNote || rawNode.voice),
      animated: Boolean(stored.animated || rawNode.animated),
      url: safeMediaUrl(stored.url || rawNode.link || rawNode.url || ''),
    };
    // Fallback: se nao temos URL direta mas temos mediaId, usar proxy autenticado do backend
    if (!media.url && media.mediaId) {
      media.url = '/api/disparador/inbox/media/' + encodeURIComponent(media.mediaId);
    }
    media.summary = buildMediaSummary(kind, media);
    return media;
  }

  function getMessageTextWithoutMediaSummary(m, media) {
    var payload = getMessagePayload(m);
    var candidates = [
      String(m && m.text || '').trim(),
      String(payload.renderedText || '').trim(),
    ].filter(Boolean);
    for (var i = 0; i < candidates.length; i += 1) {
      var value = candidates[i];
      if (value && value !== media.summary) return value;
    }
    return '';
  }

  function getMediaKindLabel(media) {
    if (!media) return '';
    if (media.kind === 'image') return 'Imagem';
    if (media.kind === 'video') return 'Video';
    if (media.kind === 'document') return 'Documento';
    if (media.kind === 'audio') return media.isVoiceNote ? 'Mensagem de voz' : 'Audio';
    if (media.kind === 'sticker') return 'Figurinha';
    return 'Midia';
  }

  function getMediaKindTag(media) {
    if (!media) return '';
    if (media.kind === 'image') return 'IMG';
    if (media.kind === 'video') return 'VID';
    if (media.kind === 'document') return 'DOC';
    if (media.kind === 'audio') return media.isVoiceNote ? 'VOZ' : 'AUD';
    if (media.kind === 'sticker') return 'STK';
    return 'MID';
  }

  function renderMessageMediaHTML(m, mediaInput) {
    var media = mediaInput || getMessageMedia(m);
    if (!media) return '';

    var details = [];
    if (media.filename) details.push(media.filename);
    if (media.mimeType) details.push(media.mimeType);
    var detailText = details.join(' | ');
    var label = getMediaKindLabel(media);
    var tag = getMediaKindTag(media);
    var caption = media.caption
      ? '<div class="msg-media-caption">' + esc(media.caption) + '</div>'
      : '';
    var extraText = getMessageTextWithoutMediaSummary(m, media);
    var extra = extraText
      ? '<div class="msg-media-caption">' + esc(extraText) + '</div>'
      : '';

    if (media.kind === 'image' && media.url) {
      return '<div class="msg-media-block">'
        + '<div class="msg-media-visual" onclick="window._odLightbox(this.querySelector(\'img\')&&this.querySelector(\'img\').src)"><img class="msg-media-image" src="' + esc(media.url) + '" alt="' + esc(label) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\'media-error\');this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'msg-media-fallback\',textContent:\'Imagem indispon\u00EDvel\'}))"></div>'
        + caption
        + extra
        + '</div>';
    }

    if (media.kind === 'sticker' && media.url) {
      return '<div class="msg-media-block msg-media-sticker">'
        + '<img class="msg-media-sticker-img" src="' + esc(media.url) + '" alt="Figurinha" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'msg-media-fallback\',textContent:\'Figurinha indispon\u00EDvel\'}))">'
        + extra
        + '</div>';
    }

    if (media.kind === 'video' && media.url) {
      return '<div class="msg-media-block">'
        + '<div class="msg-media-visual"><video class="msg-media-video" controls preload="metadata" src="' + esc(media.url) + '"></video></div>'
        + caption
        + extra
        + '</div>';
    }

    if (media.kind === 'audio' && media.url) {
      return '<div class="msg-media-block">'
        + '<div class="msg-media-card msg-media-card-audio">'
        + '<div class="msg-media-icon">' + esc(tag) + '</div>'
        + '<div class="msg-media-copy"><div class="msg-media-title">' + esc(label) + '</div>'
        + (detailText ? '<div class="msg-media-detail">' + esc(detailText) + '</div>' : '')
        + '</div></div>'
        + '<audio class="msg-media-audio" controls preload="none" src="' + esc(media.url) + '"></audio>'
        + caption
        + extra
        + '</div>';
    }

    var content = media.kind === 'document' && media.url
      ? '<a class="msg-media-link" href="' + esc(media.url) + '" target="_blank" rel="noopener noreferrer">Abrir arquivo</a>'
      : '<div class="msg-media-detail">' + esc(detailText || media.summary || label) + '</div>';

    return '<div class="msg-media-block">'
      + '<div class="msg-media-card msg-media-card-' + esc(media.kind) + '">'
      + '<div class="msg-media-icon">' + esc(tag) + '</div>'
      + '<div class="msg-media-copy"><div class="msg-media-title">' + esc(label) + '</div>'
      + content
      + '</div></div>'
      + caption
      + extra
      + '</div>';
  }

  function resolveMessageText(m) {
    var direct = String(m && m.text || '').trim();
    if (direct) return direct;
    var payload = m && m.payload && typeof m.payload === 'object' ? m.payload : {};
    var rendered = String(payload.renderedText || '').trim();
    if (rendered) return rendered;
    var media = getMessageMedia(m);
    if (media && media.summary) return media.summary;

    // Location
    if (payload.location && typeof payload.location === 'object') {
      var loc = payload.location;
      var locLabel = String(loc.name || loc.address || '').trim();
      if (!locLabel && loc.latitude != null && loc.longitude != null) locLabel = loc.latitude + ', ' + loc.longitude;
      return '\uD83D\uDCCD Localiza\u00E7\u00E3o: ' + (locLabel || 'sem detalhes');
    }

    // Reaction
    if (payload.reaction && typeof payload.reaction === 'object') {
      var emoji = String(payload.reaction.emoji || '').trim();
      return emoji ? emoji + ' (rea\u00E7\u00E3o)' : 'Rea\u00E7\u00E3o';
    }

    // Contacts vCard
    if (Array.isArray(payload.contacts) && payload.contacts.length) {
      var first = payload.contacts[0] || {};
      var contactName = String((first.name && (first.name.formatted_name || first.name.first_name)) || '').trim();
      var phones = Array.isArray(first.phones) ? first.phones : [];
      var phone = String((phones[0] && (phones[0].phone || phones[0].wa_id)) || '').trim();
      var parts = [contactName, phone].filter(Boolean).join(' \u00B7 ');
      var extraN = payload.contacts.length > 1 ? ' (+' + (payload.contacts.length - 1) + ')' : '';
      return '\uD83D\uDC64 Contato: ' + (parts || 'sem nome') + extraN;
    }

    if (m && m.kind === 'template') {
      var snapshot = payload.templateSnapshot && typeof payload.templateSnapshot === 'object' ? payload.templateSnapshot : null;
      var params = Array.isArray(payload.parameters) ? payload.parameters : [];
      if (snapshot) {
        var snapshotText = renderTemplateTextFromSnapshot(snapshot, params);
        if (snapshotText) return snapshotText;
      }
      if (payload.templateId) {
        var template = templates.find(function (item) { return item && item.id === payload.templateId; });
        if (template) {
          var templateText = renderTemplateTextFromSnapshot(template, params);
          if (templateText) return templateText;
        }
      }
    }
    var name = String(m && m.templateName || '').trim();
    if (name) return name;
    var tipo = String((payload && payload.messageType) || (m && m.kind) || '').trim();
    if (tipo && tipo !== 'text') return 'Mensagem (' + tipo + ') sem texto';
    return 'Mensagem sem conte\u00FAdo';
  }

  function storeConversationCache(conversationId) {
    if (!conversationId) return;
    convMsgCache.set(conversationId, {
      items: activeMessages.slice(),
      hasMore: hasOlderMessages,
      nextBefore: nextBeforeCursor || '',
    });
  }

  function syncConversationFromMessage(message) {
    if (!message || !message.conversationId) return;
    var existing = convById.get(message.conversationId);
    var timestamp = message.createdAt || new Date().toISOString();
    var preview = resolveMessageText(message);
    var conversation = existing ? Object.assign({}, existing) : {
      id: message.conversationId,
      phoneE164: message.phoneE164 || '',
      displayName: message.displayName || '',
      unreadCount: 0,
      status: 'open',
      flowPaused: false,
      createdAt: timestamp,
    };

    conversation.phoneE164 = message.phoneE164 || conversation.phoneE164 || '';
    if (!conversation.displayName && message.displayName) conversation.displayName = message.displayName;
    conversation.updatedAt = timestamp;
    conversation.lastMessageAt = timestamp;
    conversation.lastMessagePreview = preview || conversation.lastMessagePreview || 'Mensagem';
    if (message.direction === 'inbound' && message.conversationId !== activeConvId) {
      conversation.unreadCount = Number(conversation.unreadCount || 0) + 1;
    }

    mergeConversationState(conversation);
    patchConversationRow(conversation.id);
    updateTitleBadge();
  }

  function handleSSEMessageNew(data) {
    const msg = data.message;
    if (!msg) return;

    const convId = msg.conversationId || data.conversationId;
    if (convId && convId === activeConvId) {
      if (msgIdSet.has(msg.id)) {
        // Ja conhecemos esse id (sendMessage ja substituiu temp pelo real). Ignora.
      } else if (msg.direction === 'outbound') {
        // Tenta casar com uma temp message pendente (mesmo texto).
        var tempIdx = activeMessages.findIndex(function (m) {
          return typeof m.id === 'string' && m.id.indexOf('temp-') === 0
            && m.deliveryStatus === 'sending'
            && (m.text || '') === (msg.text || '');
        });
        if (tempIdx !== -1) {
          var tempId = activeMessages[tempIdx].id;
          activeMessages[tempIdx] = msg;
          msgIdSet.delete(tempId);
          msgIdSet.add(msg.id);
          var tempEl = messagesScroll.querySelector('[data-msg-id="' + CSS.escape(tempId) + '"]');
          if (tempEl) tempEl.outerHTML = buildMessageHTML(msg);
        } else {
          msgIdSet.add(msg.id);
          activeMessages.push(msg);
          appendMessageToDOM(msg);
          scrollToBottom();
        }
        storeConversationCache(activeConvId);
      } else {
        msgIdSet.add(msg.id);
        activeMessages.push(msg);
        appendMessageToDOM(msg);
        scrollToBottom();
        storeConversationCache(activeConvId);
      }
    }

    syncConversationFromMessage(msg);

    if (msg.direction === 'inbound') {
      playNotificationSound();
    }
  }

  function handleSSEMessageStatus(data) {
    if (!data.messageId || !data.status) return;

    if (data.conversationId === activeConvId) {
      const el = messagesScroll.querySelector('[data-msg-id="' + CSS.escape(data.messageId) + '"] .msg-check');
      if (el) {
        el.className = 'msg-check ' + data.status;
        el.textContent = data.status === 'read' || data.status === 'delivered' ? '\u2713\u2713' : data.status === 'sent' ? '\u2713' : data.status === 'failed' ? '\u2715' : '';
      }
      const msg = activeMessages.find(function (m) { return m.id === data.messageId; });
      if (msg) msg.deliveryStatus = data.status;
    }
  }

  function handleSSEConversationUpdated(data) {
    const conv = data.conversation;
    if (!conv) return;
    var merged = mergeConversationState(conv);
    patchConversationRow(conv.id);
    if (activeConvId === conv.id) updateFlowButtons(merged || conv);
    updateTitleBadge();
  }

  /* ═══════════════════════════════════════════════════════════════
     Notification sound + title badge
     ═══════════════════════════════════════════════════════════════ */
  function playNotificationSound() {
    try {
      if (notifSound) { notifSound.currentTime = 0; notifSound.play().catch(function () {}); }
    } catch (_) {}
  }

  function updateTitleBadge() {
    totalUnread = conversations.reduce(function (sum, c) { return sum + (c.unreadCount || 0); }, 0);
    document.title = totalUnread > 0 ? '(' + totalUnread + ') OD Chat' : 'OD Chat';
  }

  /* ═══════════════════════════════════════════════════════════════
     Campaign + Driver data
     ═══════════════════════════════════════════════════════════════ */
  function getCampaignArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.items)) return raw.items;
    if (raw && Array.isArray(raw.campaigns)) return raw.campaigns;
    return [];
  }
  function isActiveCampaign(c) { var s = norm(c && c.status); return s === 'ativa' || s === 'active'; }

  function buildCampaignNameIndex(arr) {
    campaignNameById = {};
    (arr || []).forEach(function (c) {
      var id = normalizeCampaignId(c && (c.id || c._id || c.campaignId));
      var name = String((c && c.name) || '').trim();
      if (id && name) campaignNameById[id] = name;
    });
  }

  function buildPhoneCampaignMetaIndex() {
    phoneToMeta = {};
    allDrivers.forEach(function (d) {
      var digits = digitsOnly(d && d.phone);
      if (!digits) return;
      var entry = { campaignId: getDriverCampaignId(d) || null, campaignName: getDriverCampaignName(d) || '' };
      phoneToMeta[digits] = entry;
      if (digits.length > 11) phoneToMeta[digits.slice(-11)] = entry;
    });
  }

  function populateCampaignFilter(arr) {
    if (!filterDropdown) return;
    var campaigns = (arr || []).filter(isActiveCampaign).sort(function (a, b) {
      return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'pt-BR');
    });
    while (filterDropdown.options.length > 2) filterDropdown.remove(2);
    campaigns.forEach(function (c) {
      var id = normalizeCampaignId(c && (c.id || c._id || c.campaignId));
      if (!id) return;
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = String((c && c.name) || id);
      filterDropdown.appendChild(opt);
    });
    // Re-append operators group if already loaded
    if (operatorsLoaded) populateOperatorOptions();
  }

  /* ── Operators (Phase 3) ── */
  var operatorsCache = [];
  var operatorsLoaded = false;
  var operatorNameById = {};

  function populateOperatorOptions() {
    if (!filterDropdown) return;
    // Remove previous operator entries (group + options)
    var existingGroup = filterDropdown.querySelector('optgroup[data-operators]');
    if (existingGroup) existingGroup.remove();
    if (!operatorsCache.length) return;
    var group = document.createElement('optgroup');
    group.setAttribute('data-operators', '1');
    group.label = 'Operadores';
    operatorsCache.forEach(function (op) {
      var opt = document.createElement('option');
      opt.value = 'op:' + op.operatorId;
      opt.textContent = op.operatorName || op.operatorId;
      group.appendChild(opt);
    });
    filterDropdown.appendChild(group);
  }

  async function loadOperators() {
    try {
      var data = await authFetch('/api/disparador/operators/active');
      operatorsCache = Array.isArray(data && data.items) ? data.items : [];
      operatorNameById = {};
      operatorsCache.forEach(function (op) {
        if (op && op.operatorId) operatorNameById[op.operatorId] = op.operatorName || '';
      });
      operatorsLoaded = true;
      populateOperatorOptions();
    } catch (_) { /* best-effort */ }
  }

  async function loadCampaignsAndDrivers(forceRefresh) {
    if (!forceRefresh && dataLoaded && campaignsLoaded) return;
    if (!forceRefresh && campaignDriverLoadPromise) return campaignDriverLoadPromise;

    var loadPromise = (async function () {
      var results = await Promise.allSettled([authFetch('/api/drivers'), authFetch('/api/campaigns')]);
      if (results[0].status === 'fulfilled') {
        var items = Array.isArray(results[0].value && results[0].value.items) ? results[0].value.items : [];
        allDrivers = items.filter(function (d) { return d && d.phone; }).sort(function (a, b) { return String(a && a.name || '').localeCompare(String(b && b.name || ''), 'pt-BR'); });
        dataLoaded = true;
      } else {
        allDrivers = [];
        dataLoaded = false;
      }
      var campaignsArray = [];
      if (results[1].status === 'fulfilled') {
        campaignsArray = getCampaignArray(results[1].value);
        campaignsLoaded = true;
      } else {
        campaignsLoaded = false;
      }
      buildCampaignNameIndex(campaignsArray);
      buildPhoneCampaignMetaIndex();
      populateCampaignFilter(campaignsArray);
      invalidateConversationRows();
      if (getCurrentFilterValue() !== 'all') renderConversations();
    })();

    campaignDriverLoadPromise = loadPromise;
    try {
      await loadPromise;
    } finally {
      if (campaignDriverLoadPromise === loadPromise) campaignDriverLoadPromise = null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     Templates
     ═══════════════════════════════════════════════════════════════ */
  async function loadTemplates() {
    try {
      var data = await authFetch('/api/disparador/templates');
      templates = Array.isArray(data.items) ? data.items : [];
    } catch (_) { templates = []; }
  }

  function renderTemplates() {
    var approvedTemplates = templates.filter(function (t) {
      return String(t && t.status || '').toLowerCase() === 'approved';
    });
    if (!approvedTemplates.length) {
      templateList.innerHTML = '<div class="loading-hint">Nenhum template aprovado</div>';
      return;
    }
    var html = '';
    approvedTemplates.forEach(function (t) {
      html += '<div class="template-item" data-template-id="' + esc(t.id) + '" data-template-name="' + esc(t.name) + '">'
        + '<div class="template-name">' + esc(t.name) + '</div>'
        + '<div class="template-category">' + esc(t.category || '') + ' \u00B7 ' + esc(t.language || 'pt_BR') + '</div>'
        + '</div>';
    });
    templateList.innerHTML = html;
  }

  /* ═══════════════════════════════════════════════════════════════
     Conversations
     ═══════════════════════════════════════════════════════════════ */
  var _loadConvLastAt = 0;
  var _loadConvInflight = null;
  async function loadConversations() {
    // Throttle: se a ultima chamada terminou ha menos de 2s, devolve a promise inflight
    // (ou ignora silenciosamente). Evita avalanches de GET quando rajadas de SSE/visibility/erro
    // disparam o poll varias vezes em sequencia.
    var now = Date.now();
    if (_loadConvInflight) return _loadConvInflight;
    if (now - _loadConvLastAt < 2000) return;
    var t0 = perfNow();
    _loadConvInflight = (async function () {
      try {
        var data = await authFetch('/api/disparador/inbox/conversations?limit=120');
        conversations = (data.items || []);
        sortConversationsInPlace();
        convById = new Map();
        conversations.forEach(function (c) { convById.set(c.id, c); });
        showReconnecting(false);
        renderConversations();
        updateTitleBadge();
        logPerf('loadConversations', t0, { count: conversations.length });
      } catch (err) {
        if (err && err.status && err.status !== 401) {
          if (convLoading) {
            convLoading.innerHTML = '<div class="loading-hint">Erro ao carregar conversas.</div>';
            convLoading.style.display = '';
          }
        }
        renderConversations();
      } finally {
        _loadConvLastAt = Date.now();
        _loadConvInflight = null;
      }
    })();
    return _loadConvInflight;
  }

  function getCurrentFilterValue() { return filterDropdown ? filterDropdown.value : 'all'; }
  function getSidebarSearchQuery() { return norm(sidebarSearch ? sidebarSearch.value : ''); }
  function isSidebarDefaultView() { return getCurrentFilterValue() === 'all' && !getSidebarSearchQuery(); }

  function conversationSortValue(conv) {
    return new Date(conv && (conv.lastMessageAt || conv.updatedAt || 0)).getTime();
  }

  function sortConversationsInPlace() {
    invalidateConversationRows();
    conversations.sort(function (a, b) {
      return conversationSortValue(b) - conversationSortValue(a);
    });
  }

  function matchesConvFilter(conv, filterVal) {
    if (!conv) return false;
    if (filterVal === 'all') return true;
    if (typeof filterVal === 'string' && filterVal.indexOf('op:') === 0) {
      var opId = filterVal.slice(3);
      // Owner OR uncontacted (no operator yet)
      return String(conv.operatorId || '') === opId || !conv.operatorId;
    }
    var meta = getPhoneMeta(conv.phoneE164);
    var cid = normalizeCampaignId(meta && meta.campaignId);
    if (filterVal === 'no-campaign') return !cid;
    return cid === normalizeCampaignId(filterVal);
  }

  function matchesDriverFilter(driver, filterVal) {
    if (!driver) return false;
    if (filterVal === 'all') return true;
    // Operator filter: drivers without conversation count as "uncontacted" → include
    if (typeof filterVal === 'string' && filterVal.indexOf('op:') === 0) return true;
    var cid = getDriverCampaignId(driver);
    if (filterVal === 'no-campaign') return !cid;
    return cid === normalizeCampaignId(filterVal);
  }

  function buildConversationLookup(filteredConversations) {
    var map = new Map();
    (filteredConversations || []).forEach(function (conv) {
      var digits = digitsOnly(conv && conv.phoneE164);
      if (!digits) return;
      if (!map.has(digits)) map.set(digits, conv);
      var suffix = digits.slice(-11);
      if (suffix && !map.has(suffix)) map.set(suffix, conv);
    });
    return map;
  }

  function getConversationForDriver(driver, lookup) {
    var digits = digitsOnly(driver && driver.phone);
    if (!digits) return null;
    return lookup.get(digits) || lookup.get(digits.slice(-11)) || null;
  }

  function buildDriverOnlyRow(driver) {
    var phoneE164 = normalizeToE164((driver && driver.phone) || '');
    var phoneLabel = fmtPhone(phoneE164 || (driver && driver.phone) || '');
    var campaignId = getDriverCampaignId(driver);
    var campaignName = getDriverCampaignName(driver) || (campaignId ? 'Com campanha' : 'Sem campanha');
    return {
      id: 'driver:' + digitsOnly(phoneE164 || (driver && driver.phone) || ''),
      phoneE164: phoneE164,
      displayName: (driver && driver.name) || phoneLabel || 'Sem nome',
      lastMessagePreview: (phoneLabel ? phoneLabel + ' - ' : '') + campaignName,
      unreadCount: 0,
      isDriverOnly: true,
      driverData: driver,
    };
  }

  function getDisplayName(conv, driver) {
    return (conv && conv.displayName) || (conv && conv.contact && conv.contact.name) || (driver && driver.name) || fmtPhone(conv && conv.phoneE164) || 'Sem nome';
  }

  function buildConversationRows() {
    var filterVal = getCurrentFilterValue();
    var searchQ = getSidebarSearchQuery();
    var rows;

    if (filterVal === 'all') {
      rows = conversations.filter(function (c) { return matchesConvFilter(c, filterVal); });
      rows.sort(function (a, b) { return conversationSortValue(b) - conversationSortValue(a); });
    } else {
      var filteredConversations = conversations.filter(function (c) { return matchesConvFilter(c, filterVal); });
      var conversationLookup = buildConversationLookup(filteredConversations);
      var usedConversationIds = new Set();
      rows = [];

      if (dataLoaded) {
        allDrivers.forEach(function (driver) {
          if (!matchesDriverFilter(driver, filterVal)) return;
          var conv = getConversationForDriver(driver, conversationLookup);
          if (conv && !usedConversationIds.has(conv.id)) {
            usedConversationIds.add(conv.id);
            rows.push(conv);
            return;
          }
          rows.push(buildDriverOnlyRow(driver));
        });
      }

      filteredConversations.forEach(function (conv) {
        if (usedConversationIds.has(conv.id)) return;
        usedConversationIds.add(conv.id);
        rows.push(conv);
      });

      rows.sort(function (a, b) {
        var aDriverOnly = a && a.isDriverOnly === true;
        var bDriverOnly = b && b.isDriverOnly === true;
        if (aDriverOnly !== bDriverOnly) return aDriverOnly ? 1 : -1;
        if (!aDriverOnly && !bDriverOnly) return conversationSortValue(b) - conversationSortValue(a);
        return String(getDisplayName(a, getConversationDriver(a, null))).localeCompare(String(getDisplayName(b, getConversationDriver(b, null))), 'pt-BR');
      });
    }

    if (searchQ) {
      rows = rows.filter(function (r) {
        var driver = getConversationDriver(r, null);
        var name = getDisplayName(r, driver);
        var phone = r.phoneE164 || '';
        var preview = r.lastMessagePreview || '';
        var hay = norm([name, phone, fmtPhone(phone), preview].join(' '));
        return hay.includes(searchQ);
      });
    }

    return rows;
  }

  /* ── Conversation rendering ── */
  function buildConversationItemHTML(conv) {
    var driver = getConversationDriver(conv, null);
    var name = getDisplayName(conv, driver);
    var avatarUrl = getAvatarUrl(driver, conv);
    var preview = conv.lastMessagePreview || 'Conversa iniciada';
    var isDriverOnly = conv && conv.isDriverOnly === true;
    var time = isDriverOnly ? 'Novo' : fmtTime(conv.lastMessageAt || conv.updatedAt);
    var unread = !isDriverOnly && (conv.unreadCount || 0) > 0 ? '<span class="unread-badge">' + conv.unreadCount + '</span>' : '';
    var active = !isDriverOnly && conv.id === activeConvId ? ' active' : '';
    var operatorName = !isDriverOnly && conv.operatorId
      ? (operatorNameById[conv.operatorId] || conv.operatorName || '')
      : '';
    var operatorBadge = operatorName
      ? '<span class="conv-operator" title="Operador responsável">● ' + esc(operatorName) + '</span>'
      : '';
    var attrs = isDriverOnly
      ? ' data-driver-phone="' + esc(conv.phoneE164 || '') + '" data-driver-name="' + esc(name) + '"'
      : ' data-conv-id="' + esc(conv.id) + '" data-phone="' + esc(conv.phoneE164 || '') + '"';
    return '<div class="conv-item' + (isDriverOnly ? ' driver-only' : '') + active + '"' + attrs + '>'
      + renderAvatarHTML(name, avatarUrl, 'conv-avatar')
      + '<div class="conv-body">'
      + '<div class="conv-top"><span class="conv-name">' + esc(name) + '</span><span class="conv-time">' + esc(time) + '</span></div>'
      + '<div class="conv-bottom"><span class="conv-preview">' + esc(preview.slice(0, 80)) + '</span>' + operatorBadge + unread + '</div>'
      + '</div></div>';
  }

  // Fingerprint usado pelo diff incremental: muda quando algo visivel muda.
  function conversationFingerprint(conv) {
    if (!conv) return '';
    var driver = getConversationDriver(conv, null);
    return [
      conv.id,
      conv.lastMessagePreview || '',
      conv.lastMessageAt || conv.updatedAt || '',
      conv.unreadCount || 0,
      conv.displayName || '',
      conv.phoneE164 || '',
      conv.isDriverOnly ? '1' : '0',
      conv.id === activeConvId ? 'A' : '-',
      driver && driver.avatar ? driver.avatar : '',
      driver && driver.name ? driver.name : '',
      conv.operatorId || ''
    ].join('|');
  }

  function mergeConversationState(nextConv) {
    if (!nextConv || !nextConv.id) return null;
    var existing = convById.get(nextConv.id);
    if (existing) {
      Object.assign(existing, nextConv);
      sortConversationsInPlace();
      return existing;
    }
    conversations.push(nextConv);
    convById.set(nextConv.id, nextConv);
    sortConversationsInPlace();
    return nextConv;
  }

  function patchConversationRow(convId) {
    if (!convId || !conversationListEl) return;
    var rows = getConversationRows();
    if (!isSidebarDefaultView()) {
      scheduleConversationRender();
      return;
    }
    if (shouldVirtualizeConversationRows(rows)) {
      scheduleConversationRender();
      return;
    }
    var targetIndex = rows.findIndex(function (item) { return item.id === convId; });
    var selector = '[data-conv-id="' + CSS.escape(convId) + '"]';
    var oldEl = conversationListEl.querySelector(selector);

    if (targetIndex < 0) {
      if (oldEl) oldEl.remove();
      if (!conversationListEl.querySelector('[data-conv-id]')) {
        conversationListEl.innerHTML = '<div class="loading-hint">Nenhuma conversa</div>';
      }
      return;
    }

    var row = rows[targetIndex];
    var holder = document.createElement('div');
    holder.innerHTML = buildConversationItemHTML(row);
    var nextEl = holder.firstChild;
    if (!nextEl) return;

    if (oldEl) oldEl.replaceWith(nextEl);
    else {
      var emptyHint = conversationListEl.querySelector('.loading-hint');
      if (emptyHint) emptyHint.remove();
      conversationListEl.appendChild(nextEl);
    }

    var siblings = Array.from(conversationListEl.querySelectorAll('[data-conv-id]')).filter(function (el) {
      return el.dataset.convId !== String(convId);
    });
    var beforeNode = siblings[targetIndex] || null;
    conversationListEl.insertBefore(nextEl, beforeNode);
    syncSidebarRowHeight();
  }

  // Diff incremental: reusa nodes existentes baseado em data-conv-id e fingerprint.
  // Evita o "innerHTML = fullHtml" full re-render que causava jank quando uma mensagem
  // chegava em producao ativa (rebuild de N elementos a cada mensagem nova).
  function renderConversationsDiff(rows) {
    if (!conversationListEl) return;
    var existingMap = new Map();
    var existingNodes = conversationListEl.querySelectorAll('[data-conv-id], [data-driver-phone]');
    for (var i = 0; i < existingNodes.length; i++) {
      var node = existingNodes[i];
      var key = node.dataset.convId || ('drv:' + (node.dataset.driverPhone || ''));
      existingMap.set(key, node);
    }

    // Limpa hints de loading/empty antes do diff.
    var hints = conversationListEl.querySelectorAll('.loading-hint, .conv-spacer');
    for (var h = 0; h < hints.length; h++) hints[h].remove();

    var seenKeys = new Set();
    var prevSibling = null;

    rows.forEach(function (conv) {
      var key = conv && conv.isDriverOnly === true
        ? ('drv:' + (conv.phoneE164 || ''))
        : String(conv.id);
      seenKeys.add(key);
      var fp = conversationFingerprint(conv);
      var el = existingMap.get(key);

      if (!el) {
        var tmp = document.createElement('div');
        tmp.innerHTML = buildConversationItemHTML(conv);
        el = tmp.firstChild;
        if (!el) return;
        el.dataset.fp = fp;
      } else if (el.dataset.fp !== fp) {
        var tmp2 = document.createElement('div');
        tmp2.innerHTML = buildConversationItemHTML(conv);
        var newEl = tmp2.firstChild;
        if (newEl) {
          newEl.dataset.fp = fp;
          el.replaceWith(newEl);
          el = newEl;
        }
      }

      // Reordena somente se necessario.
      var expectedNext = prevSibling ? prevSibling.nextSibling : conversationListEl.firstChild;
      if (el !== expectedNext) {
        if (prevSibling) prevSibling.after(el);
        else conversationListEl.prepend(el);
      }
      prevSibling = el;
    });

    // Remove orphans nao listados.
    existingMap.forEach(function (node, key) {
      if (!seenKeys.has(key)) node.remove();
    });
  }

  function renderConversations() {
    if (convLoading) convLoading.style.display = 'none';
    var filterVal = getCurrentFilterValue();
    var needsCampaignCatalog = filterVal !== 'all' && filterVal !== 'no-campaign';

    if ((filterVal === 'no-campaign' && !dataLoaded) || (needsCampaignCatalog && (!dataLoaded || !campaignsLoaded))) {
      delete conversationListEl.dataset.virtualized;
      conversationListEl.innerHTML = '<div class="loading-hint">Carregando motoristas da campanha...</div>';
      return;
    }

    var rows = getConversationRows();

    if (!rows.length) {
      var msg = 'Nenhuma conversa';
      if (filterVal !== 'all') msg = 'Nenhum motorista encontrado neste filtro';
      if (getSidebarSearchQuery()) msg = 'Nenhum resultado para a busca';
      delete conversationListEl.dataset.virtualized;
      conversationListEl.innerHTML = '<div class="loading-hint">' + msg + '</div>';
      return;
    }

    if (!shouldVirtualizeConversationRows(rows)) {
      delete conversationListEl.dataset.virtualized;
      renderConversationsDiff(rows);
      syncSidebarRowHeight();
      return;
    }

    conversationListEl.dataset.virtualized = '1';
    var viewportHeight = Math.max(conversationListEl.clientHeight || 0, sidebarRowHeight);
    var rowHeight = Math.max(60, sidebarRowHeight || 68);
    var scrollTop = Math.max(0, conversationListEl.scrollTop || 0);
    var startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - SIDEBAR_VIRTUAL_OVERSCAN);
    var visibleCount = Math.ceil(viewportHeight / rowHeight) + (SIDEBAR_VIRTUAL_OVERSCAN * 2);
    var endIndex = Math.min(rows.length, startIndex + visibleCount);
    var topSpacer = startIndex * rowHeight;
    var bottomSpacer = Math.max(0, (rows.length - endIndex) * rowHeight);
    var html = '<div class="conv-spacer" aria-hidden="true" style="height:' + topSpacer + 'px"></div>';
    rows.slice(startIndex, endIndex).forEach(function (conv) {
      html += buildConversationItemHTML(conv);
    });
    html += '<div class="conv-spacer" aria-hidden="true" style="height:' + bottomSpacer + 'px"></div>';
    conversationListEl.innerHTML = html;
    syncSidebarRowHeight();
  }

  /* ═══════════════════════════════════════════════════════════════
     Contacts (new chat panel)
     ═══════════════════════════════════════════════════════════════ */
  function renderContacts(query) {
    var q = norm(query || '');
    var pool = q ? allDrivers.filter(function (d) {
      return norm([(d && d.name), (d && d.phone), (d && d.plate), (d && d.cpf), fmtPhone(d && d.phone)].join(' ')).includes(q);
    }) : allDrivers;

    if (!pool.length) { contactListEl.innerHTML = '<div class="loading-hint">Nenhum contato encontrado</div>'; return; }

    var html = '';
    pool.forEach(function (d) {
      var name = (d && d.name) || 'Sem nome';
      var phone = (d && d.phone) || '';
      var campaign = getDriverCampaignName(d) || 'Sem campanha';
      html += '<div class="contact-item" data-phone="' + esc(phone) + '" data-name="' + esc(name) + '">'
        + renderAvatarHTML(name, d && d.avatar, 'conv-avatar')
        + '<div class="conv-body">'
        + '<div class="conv-top"><span class="conv-name">' + esc(name) + '</span></div>'
        + '<div class="conv-bottom"><span class="conv-preview">' + esc(fmtPhone(phone)) + ' \u00B7 ' + esc(campaign) + '</span></div>'
        + '</div></div>';
    });
    contactListEl.innerHTML = html;
  }

  /* ═══════════════════════════════════════════════════════════════
     Messages
     ═══════════════════════════════════════════════════════════════ */
  async function openConversation(convId, options) {
    options = options || {};
    var forceReload = options.forceReload === true;
    var t0 = perfNow();

    if (loadMsgCtrl) {
      try { loadMsgCtrl.abort(); } catch (_) {}
    }
    loadMsgCtrl = typeof AbortController === 'function' ? new AbortController() : null;
    var currentSeq = ++loadMsgSeq;

    activeConvId = convId;
    activeMessages = [];
    msgIdSet = new Set();
    hasOlderMessages = false;
    nextBeforeCursor = '';
    loadingOlder = false;

    // Garante que apenas a conversa atual tem .active no DOM (caso openConversation
    // tenha sido chamado por uma rota que nao passou pelo handler de click).
    if (conversationListEl) {
      var stale = conversationListEl.querySelectorAll('.conv-item.active');
      stale.forEach(function (el) {
        if (el.dataset.convId !== String(convId)) el.classList.remove('active');
      });
      var nowActive = conversationListEl.querySelector('[data-conv-id="' + CSS.escape(String(convId)) + '"]');
      if (nowActive) nowActive.classList.add('active');
    }

    chatEmpty.classList.add('hidden');
    chatActive.classList.remove('hidden');
    templatePicker.classList.add('hidden');
    driverInfoPanel.classList.add('hidden');

    var conv = convById.get(convId) || conversations.find(function (c) { return c.id === convId; });
    var driver = getConversationDriver(conv, null);
    var name = getDisplayName(conv, driver) || 'Chat';

    setAvatarElement(chatAvatar, name, getAvatarUrl(driver, conv));
    chatName.textContent = name;
    chatPhone.textContent = fmtPhone(conv && conv.phoneE164 || '');

    updateFlowButtons(conv);
    patchConversationRow(convId);

    var cached = convMsgCache.get(convId);
    var hadCached = cached && Array.isArray(cached.items) && cached.items.length && !forceReload;
    if (hadCached) {
      activeMessages = cached.items.slice();
      msgIdSet = new Set(activeMessages.map(function (m) { return m.id; }));
      hasOlderMessages = cached.hasMore === true;
      nextBeforeCursor = String(cached.nextBefore || '').trim();
      renderMessages(activeMessages);
      logPerf('openConversation(cache)', t0, { conversationId: convId, count: activeMessages.length });
    } else {
      messagesScroll.innerHTML = '<div class="loading-hint">Carregando\u2026</div>';
    }

    try {
      var data = await authFetch(
        '/api/disparador/inbox/conversations/' + encodeURIComponent(convId) + '/messages?limit=' + INITIAL_MESSAGES_LIMIT,
        { signal: loadMsgCtrl && loadMsgCtrl.signal }
      );
      if (currentSeq !== loadMsgSeq || convId !== activeConvId) return;
      activeMessages = Array.isArray(data.items) ? data.items : [];
      msgIdSet = new Set(activeMessages.map(function (m) { return m.id; }));
      hasOlderMessages = data.hasMore === true;
      nextBeforeCursor = String(data.nextBefore || '').trim();
      storeConversationCache(convId);
      renderMessages(activeMessages);
      logPerf('openConversation(network)', t0, { conversationId: convId, count: activeMessages.length, hasMore: hasOlderMessages });

      if (conv && conv.unreadCount > 0) {
        authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(convId) + '/read', { method: 'POST' }).catch(function () {});
        conv.unreadCount = 0;
        patchConversationRow(convId);
        updateTitleBadge();
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (!hadCached) {
        messagesScroll.innerHTML = '<div class="loading-hint">Erro ao carregar mensagens.</div>';
      }
    }

    composeInput.focus();
  }

  function updateFlowButtons(conv) {
    if (!conv) return;
    if (conv.flowPaused) {
      btnPauseFlow.style.display = 'none';
      btnResumeFlow.style.display = '';
    } else {
      btnPauseFlow.style.display = '';
      btnResumeFlow.style.display = 'none';
    }
  }

  function renderMessages(messages, options) {
    options = options || {};
    // Filtra eventos de status/system: nao sao baloes de chat, sao apenas atualizacoes de delivery (✓✓).
    var visible = (messages || []).filter(function (m) {
      if (!m) return false;
      if (m.direction === 'system') return false;
      if (m.kind === 'status') return false;
      return true;
    });
    if (!visible.length) {
      messagesScroll.innerHTML = '<div class="loading-hint msg-empty">Nenhuma mensagem ainda</div>';
      return;
    }

    var html = '';
    var lastDate = '';

    visible.forEach(function (m) {
      var d = new Date(m.createdAt);
      var dateStr = d.toLocaleDateString('pt-BR');
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        html += '<div class="date-divider"><span>' + esc(dateStr) + '</span></div>';
      }
      html += buildMessageHTML(m);
    });

    messagesScroll.innerHTML = html;
    if (options.keepOffset === true) {
      var top = Number(options.previousTop || 0);
      var height = Number(options.previousHeight || 0);
      var scrollEl = messagesAreaEl || messagesScroll;
      requestAnimationFrame(function () {
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - height + top);
      });
      return;
    }
    scrollToBottom();
  }

  function buildMessageHTML(m) {
    var dir = m.direction === 'inbound' ? 'in' : 'out';
    var media = getMessageMedia(m);
    var mediaHtml = media ? renderMessageMediaHTML(m, media) : '';
    var text = media ? getMessageTextWithoutMediaSummary(m, media) : resolveMessageText(m);
    var time = fmtMsgTime(m.createdAt);
    var check = dir === 'out' ? deliveryIcon(m.deliveryStatus) : '';
    var source = '';
    if (m.source && m.source !== 'inbox.manual' && m.direction !== 'inbound') {
      var label = m.source === 'campaign.dispatch' ? 'Campanha' : m.source === 'flow.automation' ? 'Automa\u00E7\u00E3o' : m.source === 'od-flow-studio' ? 'OD Flow Studio' : m.source === 'meta.webhook' ? '' : m.source;
      if (label) source = '<span class="msg-source">' + esc(label) + '</span>';
    }
    if (m.templateName && m.kind === 'template') {
      source += '<span class="msg-template-badge">Template: ' + esc(m.templateName) + '</span>';
    }

    return '<div class="msg msg-' + dir + '" data-msg-id="' + esc(m.id) + '">'
      + '<div class="msg-bubble">'
      + (source ? '<div class="msg-source-row">' + source + '</div>' : '')
      + mediaHtml
      + (text ? '<span class="msg-text">' + esc(text) + '</span>' : '')
      + '<span class="msg-meta">' + esc(time) + ' ' + check + '</span>'
      + '</div></div>';
  }

  function appendMessageToDOM(m) {
    if (!m || m.direction === 'system' || m.kind === 'status') return;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = buildMessageHTML(m);
    var el = wrapper.firstChild;
    messagesScroll.appendChild(el);
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
      var el = messagesAreaEl || messagesScroll;
      el.scrollTop = el.scrollHeight;
    });
  }

  async function loadOlderMessages() {
    if (!activeConvId || !hasOlderMessages || loadingOlder || !nextBeforeCursor) return;
    loadingOlder = true;
    var convId = activeConvId;
    var before = nextBeforeCursor;
    var scrollEl = messagesAreaEl || messagesScroll;
    var previousTop = scrollEl.scrollTop;
    var previousHeight = scrollEl.scrollHeight;
    var t0 = perfNow();

    try {
      var data = await authFetch(
        '/api/disparador/inbox/conversations/' + encodeURIComponent(convId) + '/messages?limit=' + INITIAL_MESSAGES_LIMIT + '&before=' + encodeURIComponent(before)
      );
      if (activeConvId !== convId) return;

      var incoming = Array.isArray(data.items) ? data.items : [];
      var prepend = [];
      incoming.forEach(function (m) {
        if (!msgIdSet.has(m.id)) {
          msgIdSet.add(m.id);
          prepend.push(m);
        }
      });
      if (prepend.length) {
        activeMessages = prepend.concat(activeMessages);
      }
      hasOlderMessages = data.hasMore === true;
      nextBeforeCursor = String(data.nextBefore || '').trim();
      storeConversationCache(convId);
      if (prepend.length) {
        renderMessages(activeMessages, { keepOffset: true, previousTop: previousTop, previousHeight: previousHeight });
      }
      logPerf('loadOlderMessages', t0, { conversationId: convId, added: prepend.length, hasMore: hasOlderMessages });
    } catch (_) {
      // best-effort background load; ignore transient failures
    } finally {
      loadingOlder = false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     Send message
     ═══════════════════════════════════════════════════════════════ */
  async function sendMessage() {
    var text = composeInput.value.trim();
    if (!text || !activeConvId) return;
    composeInput.value = '';
    composeInput.style.height = '';
    btnSend.disabled = true;

    var tempMsg = {
      id: 'temp-' + Date.now(),
      conversationId: activeConvId,
      direction: 'outbound',
      kind: 'text',
      text: text,
      deliveryStatus: 'sending',
      createdAt: new Date().toISOString(),
    };
    activeMessages.push(tempMsg);
    msgIdSet.add(tempMsg.id);
    appendMessageToDOM(tempMsg);
    scrollToBottom();

    try {
      var result = await authFetch('/api/disparador/inbox/send', {
        method: 'POST',
        body: { conversationId: activeConvId, type: 'text', text: text },
      });

      var realMsg = result.item;
      if (realMsg) {
        var tempEl = messagesScroll.querySelector('[data-msg-id="' + CSS.escape(tempMsg.id) + '"]');
        // Se SSE ja chegou e adicionou a real (race), apenas remove o temp.
        if (msgIdSet.has(realMsg.id)) {
          activeMessages = activeMessages.filter(function (m) { return m.id !== tempMsg.id; });
          msgIdSet.delete(tempMsg.id);
          if (tempEl) tempEl.remove();
        } else {
          var idx = activeMessages.findIndex(function (m) { return m.id === tempMsg.id; });
          if (idx !== -1) activeMessages[idx] = realMsg;
          msgIdSet.delete(tempMsg.id);
          msgIdSet.add(realMsg.id);
          if (tempEl) { tempEl.outerHTML = buildMessageHTML(realMsg); }
        }
        syncConversationFromMessage(realMsg);
        storeConversationCache(activeConvId);
      }
    } catch (err) {
      var failEl = messagesScroll.querySelector('[data-msg-id="' + CSS.escape(tempMsg.id) + '"] .msg-check');
      if (failEl) { failEl.className = 'msg-check failed'; failEl.textContent = '\u2715'; }
      else {
        var bubble = messagesScroll.querySelector('[data-msg-id="' + CSS.escape(tempMsg.id) + '"] .msg-meta');
        if (bubble) bubble.insertAdjacentHTML('beforeend', ' <span class="msg-check failed">\u2715</span>');
      }
    }
  }

  async function sendTemplate(templateId, templateName) {
    if (!activeConvId) return;
    templatePicker.classList.add('hidden');

    try {
      var result = await authFetch('/api/disparador/inbox/send', {
        method: 'POST',
        body: { conversationId: activeConvId, type: 'template', templateId: templateId },
      });
      if (result.item) {
        if (!msgIdSet.has(result.item.id)) {
          msgIdSet.add(result.item.id);
          activeMessages.push(result.item);
          appendMessageToDOM(result.item);
          scrollToBottom();
          storeConversationCache(activeConvId);
        }
        syncConversationFromMessage(result.item);
      }
    } catch (err) {
      alert('Erro ao enviar template: ' + (err.message || err));
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     New chat flow
     ═══════════════════════════════════════════════════════════════ */
  async function startNewChat(phone, displayName) {
    var phoneE164 = normalizeToE164(phone);
    if (!phoneE164) return;
    var driver = getDriverByPhone(phoneE164);
    newChatPanel.classList.add('hidden');
    chatEmpty.classList.add('hidden');
    chatActive.classList.remove('hidden');

    setAvatarElement(chatAvatar, displayName, driver && driver.avatar);
    chatName.textContent = displayName;
    chatPhone.textContent = fmtPhone(phoneE164);
    messagesScroll.innerHTML = '<div class="loading-hint">Iniciando conversa\u2026</div>';

    try {
      var data = await authFetch('/api/disparador/inbox/conversations', { method: 'POST', body: { phoneE164: phoneE164, displayName: displayName } });
      var conv = data.item;
      if (conv) {
        mergeConversationState(conv);
        patchConversationRow(conv.id);
        await openConversation(conv.id, { forceReload: true });
      }
    } catch (err) {
      messagesScroll.innerHTML = '<div class="loading-hint">Erro ao iniciar conversa.</div>';
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     Right-click context menu
     ═══════════════════════════════════════════════════════════════ */
  function showContextMenu(e, convId, phone) {
    e.preventDefault();
    ctxTargetConvId = convId;
    ctxTargetPhone = phone;

    var conv = convById.get(convId);

    // Reset all items visible
    ctxMenu.querySelectorAll('[data-action]').forEach(function (el) { el.style.display = ''; });
    ctxMenu.querySelectorAll('.ctx-separator').forEach(function (el) { el.style.display = ''; });

    var markRead = ctxMenu.querySelector('[data-action="mark-read"]');
    var markUnread = ctxMenu.querySelector('[data-action="mark-unread"]');
    var pauseItem = ctxMenu.querySelector('[data-action="pause-flow"]');
    var resumeItem = ctxMenu.querySelector('[data-action="resume-flow"]');

    if (conv && conv.unreadCount > 0) {
      markRead.style.display = '';
      markUnread.style.display = 'none';
    } else {
      markRead.style.display = 'none';
      markUnread.style.display = '';
    }

    if (conv && conv.flowPaused) {
      pauseItem.style.display = 'none';
      resumeItem.style.display = '';
    } else {
      pauseItem.style.display = '';
      resumeItem.style.display = 'none';
    }

    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 260) + 'px';
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    ctxMenu.classList.remove('hidden');
  }

  function hideContextMenu() { ctxMenu.classList.add('hidden'); }

  async function handleContextAction(action) {
    hideContextMenu();
    if (!ctxTargetConvId && action !== 'copy-phone' && action !== 'driver-info') return;

    if (action === 'mark-read') {
      await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(ctxTargetConvId) + '/read', { method: 'POST' }).catch(function () {});
      var cr = convById.get(ctxTargetConvId);
      if (cr) cr.unreadCount = 0;
      patchConversationRow(ctxTargetConvId);
      updateTitleBadge();
    }
    if (action === 'mark-unread') {
      var cu = convById.get(ctxTargetConvId);
      if (cu) cu.unreadCount = Math.max(1, cu.unreadCount || 0);
      patchConversationRow(ctxTargetConvId);
      updateTitleBadge();
    }
    if (action === 'pause-flow') {
      await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(ctxTargetConvId) + '/pause-flow', { method: 'POST' }).catch(function () {});
      var cp = convById.get(ctxTargetConvId);
      if (cp) cp.flowPaused = true;
      if (activeConvId === ctxTargetConvId) updateFlowButtons(cp);
    }
    if (action === 'resume-flow') {
      await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(ctxTargetConvId) + '/resume-flow', { method: 'POST' }).catch(function () {});
      var crf = convById.get(ctxTargetConvId);
      if (crf) crf.flowPaused = false;
      if (activeConvId === ctxTargetConvId) updateFlowButtons(crf);
    }
    if (action === 'copy-phone') {
      var phone = ctxTargetPhone || '';
      if (phone) { try { navigator.clipboard.writeText(phone); } catch (_) {} }
    }
    if (action === 'driver-info') {
      showDriverInfo(ctxTargetConvId, ctxTargetPhone);
    }
  }

  function showDriverInfo(convId, phone) {
    var driver = getDriverByPhone(phone);

    var conv = convById.get(convId);
    var html = '<div class="info-grid">';

    if (driver) {
      html += '<div class="info-row"><span class="info-label">Nome</span><span class="info-value">' + esc(driver.name || 'N/A') + '</span></div>';
      html += '<div class="info-row"><span class="info-label">Telefone</span><span class="info-value">' + esc(fmtPhone(driver.phone)) + '</span></div>';
      if (driver.plate) html += '<div class="info-row"><span class="info-label">Placa</span><span class="info-value">' + esc(driver.plate) + '</span></div>';
      if (driver.cpf) html += '<div class="info-row"><span class="info-label">CPF</span><span class="info-value">' + esc(driver.cpf) + '</span></div>';
      if (driver.city) html += '<div class="info-row"><span class="info-label">Cidade</span><span class="info-value">' + esc(driver.city) + '</span></div>';
      if (driver.state) html += '<div class="info-row"><span class="info-label">Estado</span><span class="info-value">' + esc(driver.state) + '</span></div>';
      var campName = getDriverCampaignName(driver);
      if (campName) html += '<div class="info-row"><span class="info-label">Campanha</span><span class="info-value">' + esc(campName) + '</span></div>';
    } else {
      html += '<div class="info-row"><span class="info-label">Telefone</span><span class="info-value">' + esc(fmtPhone(phone)) + '</span></div>';
      html += '<div class="info-row"><span class="info-label">Motorista</span><span class="info-value">N\u00E3o encontrado na base</span></div>';
    }

    if (conv) {
      html += '<div class="info-row"><span class="info-label">Status</span><span class="info-value">' + esc(conv.status || 'open') + '</span></div>';
      html += '<div class="info-row"><span class="info-label">Automa\u00E7\u00E3o</span><span class="info-value">' + (conv.flowPaused ? 'Pausada' : 'Ativa') + '</span></div>';
      if (conv.createdAt) html += '<div class="info-row"><span class="info-label">Criado em</span><span class="info-value">' + esc(new Date(conv.createdAt).toLocaleString('pt-BR')) + '</span></div>';
    }

    html += '</div>';
    driverInfoBody.innerHTML = html;
    driverInfoPanel.classList.remove('hidden');
  }

  /* ═══════════════════════════════════════════════════════════════
     Auto-resize textarea
     ═══════════════════════════════════════════════════════════════ */
  function autoResize() {
    composeInput.style.height = '';
    composeInput.style.height = Math.min(composeInput.scrollHeight, 120) + 'px';
  }

  /* ═══════════════════════════════════════════════════════════════
     Fallback polling (if SSE disconnects)
     ═══════════════════════════════════════════════════════════════ */
  function startConversationPoll() {
    if (convPollTimer) clearInterval(convPollTimer);
    convPollTimer = setInterval(function () {
      // Pausa polling quando aba esta oculta — economiza CPU/rede e elimina
      // travadinhas ao voltar para a aba (sem fila de updates pendentes).
      if (typeof document !== 'undefined' && document.hidden) return;
      var sseOpen = sseSource && sseSource.readyState === EventSource.OPEN;
      // Quando SSE esta aberto, nao precisamos pollar conversas.
      if (sseOpen) return;
      loadConversations();
      if ((!sseSource || sseSource.readyState === EventSource.CLOSED) && activeConvId) {
        authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(activeConvId) + '/messages?limit=' + POLL_MESSAGES_LIMIT)
          .then(function (data) {
            var items = data.items || [];
            var hasNew = false;
            items.forEach(function (m) {
              if (!msgIdSet.has(m.id)) { msgIdSet.add(m.id); activeMessages.push(m); hasNew = true; }
            });
            if (hasNew) {
              renderMessages(activeMessages);
              storeConversationCache(activeConvId);
            }
          })
          .catch(function () {});
      }
    }, 15000);

    // Quando aba volta a ficar visivel, faz um refresh imediato (caso SSE tenha caido enquanto oculta).
    if (typeof document !== 'undefined' && !document.__odChatVisHooked) {
      document.__odChatVisHooked = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        var sseOpen = sseSource && sseSource.readyState === EventSource.OPEN;
        if (!sseOpen) loadConversations();
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     Event listeners
     ═══════════════════════════════════════════════════════════════ */

  conversationListEl.addEventListener('click', function (e) {
    var convItem = e.target.closest('[data-conv-id]');
    if (convItem) {
      var clickedId = convItem.dataset.convId;
      if (clickedId === activeConvId) return; // mesmo ja ativo, ignora
      // Toggle visual instantaneo: remove .active do anterior, adiciona no novo.
      // Isso elimina a sensacao de "dois selecionados" enquanto a requisicao carrega.
      var prevActive = conversationListEl.querySelector('.conv-item.active');
      if (prevActive && prevActive !== convItem) prevActive.classList.remove('active');
      convItem.classList.add('active');
      openConversation(clickedId);
      return;
    }
    var driverItem = e.target.closest('[data-driver-phone]');
    if (driverItem) { startNewChat(driverItem.dataset.driverPhone, driverItem.dataset.driverName || ''); return; }
  });

  conversationListEl.addEventListener('scroll', function () {
    if (conversationListEl.dataset.virtualized === '1') scheduleConversationRender();
  });

  conversationListEl.addEventListener('contextmenu', function (e) {
    var convItem = e.target.closest('[data-conv-id]');
    if (convItem) {
      showContextMenu(e, convItem.dataset.convId, convItem.dataset.phone || '');
      return;
    }
  });

  ctxMenu.addEventListener('click', function (e) {
    var item = e.target.closest('[data-action]');
    if (item) handleContextAction(item.dataset.action);
  });

  document.addEventListener('click', function (e) {
    if (!ctxMenu.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      hideContextMenu();
      templatePicker.classList.add('hidden');
      driverInfoPanel.classList.add('hidden');
    }
  });

  contactListEl.addEventListener('click', function (e) {
    var item = e.target.closest('[data-phone]');
    if (item) startNewChat(item.dataset.phone, item.dataset.name);
  });

  filterDropdown.addEventListener('change', async function () {
    var filterVal = getCurrentFilterValue();
    var needsCampaignCatalog = filterVal !== 'all' && filterVal !== 'no-campaign';
    if (!dataLoaded || (needsCampaignCatalog && !campaignsLoaded)) {
      convLoading.style.display = '';
      convLoading.textContent = 'Carregando motoristas\u2026';
      await loadCampaignsAndDrivers();
    }
    invalidateConversationRows();
    conversationListEl.scrollTop = 0;
    renderConversations();
  });

  var sidebarSearchTimer;
  sidebarSearch.addEventListener('input', function () {
    clearTimeout(sidebarSearchTimer);
    sidebarSearchTimer = setTimeout(function () {
      invalidateConversationRows();
      conversationListEl.scrollTop = 0;
      renderConversations();
    }, 150);
  });

  var contactSearchTimer;
  searchContacts.addEventListener('input', function () {
    clearTimeout(contactSearchTimer);
    contactSearchTimer = setTimeout(function () { renderContacts(searchContacts.value.trim()); }, 200);
  });

  btnNewChat.addEventListener('click', async function () {
    newChatPanel.classList.remove('hidden');
    await loadCampaignsAndDrivers();
    renderContacts('');
    searchContacts.value = '';
    searchContacts.focus();
  });
  btnCloseNewChat.addEventListener('click', function () { newChatPanel.classList.add('hidden'); });

  // Theme toggle (dark <-> light) com persistencia em localStorage.
  var btnThemeToggle = document.getElementById('btnThemeToggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || 'dark';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('odchat:theme', next); } catch (_) {}
      btnThemeToggle.title = next === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    });
    var initTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    btnThemeToggle.title = initTheme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  }

  composeInput.addEventListener('input', function () {
    btnSend.disabled = !composeInput.value.trim();
    autoResize();
  });
  composeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  btnSend.addEventListener('click', sendMessage);

  (messagesAreaEl || messagesScroll).addEventListener('scroll', function () {
    if (this.scrollTop <= 96) loadOlderMessages();
  });

  window.addEventListener('resize', scheduleConversationRender);

  btnPauseFlow.addEventListener('click', async function () {
    if (!activeConvId) return;
    await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(activeConvId) + '/pause-flow', { method: 'POST' }).catch(function () {});
    var c = convById.get(activeConvId);
    if (c) { c.flowPaused = true; updateFlowButtons(c); }
  });
  btnResumeFlow.addEventListener('click', async function () {
    if (!activeConvId) return;
    await authFetch('/api/disparador/inbox/conversations/' + encodeURIComponent(activeConvId) + '/resume-flow', { method: 'POST' }).catch(function () {});
    var c = convById.get(activeConvId);
    if (c) { c.flowPaused = false; updateFlowButtons(c); }
  });

  btnTemplate.addEventListener('click', async function () {
    if (templatePicker.classList.contains('hidden')) {
      templatePicker.classList.remove('hidden');
      if (!templates.length) await loadTemplates();
      renderTemplates();
    } else {
      templatePicker.classList.add('hidden');
    }
  });
  btnCloseTemplate.addEventListener('click', function () { templatePicker.classList.add('hidden'); });
  templateList.addEventListener('click', function (e) {
    var item = e.target.closest('[data-template-id]');
    if (item) sendTemplate(item.dataset.templateId, item.dataset.templateName || '');
  });

  btnCloseDriverInfo.addEventListener('click', function () { driverInfoPanel.classList.add('hidden'); });

  /* ═══════════════════════════════════════════════════════════════
     Init
     ═══════════════════════════════════════════════════════════════ */
  async function init() {
    if (!getToken()) {
      if (convLoading) convLoading.textContent = 'Sess\u00E3o expirada. Fa\u00E7a login novamente.';
      notifySessionExpired();
      return;
    }

    loadConversations();
    loadCampaignsAndDrivers().catch(function () {});
    loadOperators().catch(function () {});
    connectSSE();
    startConversationPoll();
  }

  /* ═══════════════════════════════════════════════════════════════
     Image lightbox — click thumbnail to view full size
     ═══════════════════════════════════════════════════════════════ */
  window._odLightbox = function (src) {
    if (!src) return;
    var overlay = document.createElement('div');
    overlay.className = 'od-lightbox-overlay';
    overlay.innerHTML = '<img src="' + esc(src) + '" alt="Imagem">';
    overlay.addEventListener('click', function () { overlay.remove(); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
    });
    document.body.appendChild(overlay);
  };

  init();
})();
