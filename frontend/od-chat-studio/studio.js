(function () {
  "use strict";

  const API = window.API_BASE || "";
  const NODE_TYPE_OPTIONS = [
    { type: "send_text", label: "Mensagem" },
    { type: "send_image", label: "Imagem" },
    { type: "send_template", label: "Template" },
    { type: "send_buttons", label: "Botões de resposta" },
    { type: "update_driver_status", label: "Atualizar status" },
    { type: "add_tag", label: "Adicionar tag" },
    { type: "handoff_human", label: "Encaminhar operador" },
    { type: "end", label: "Encerrar" },
  ];

  const state = {
    templates: [],
    flowSummaries: new Map(),
    selectedTemplateId: "",
    currentItem: null,
    draft: null,
    dirty: false,
    loadingTemplates: false,
    loadingFlow: false,
    saving: false,
    publishing: false,
    syncingMetaTemplates: false,
    selectedBranchId: "",
    flowRequestSeq: 0,
    dragNode: null,
    openDrawer: "",
    collapsedBranches: new Set(),
    expandedActionSections: new Set(),
    branchPositions: new Map(),
    currentGraphEdges: [],
  };

  const templateStatsEl = document.getElementById("templateStats");
  const templateDropdownEl = document.getElementById("templateDropdown");
  const canvasTopEl = document.getElementById("canvasTop");
  const branchBoardEl = document.getElementById("branchBoard");
  const inspectorPanelEl = document.getElementById("inspectorPanel");
  const simulationPanelEl = document.getElementById("simulationPanel");
  const sideRailEl = document.getElementById("sideRail");
  const statusMessageEl = document.getElementById("statusMessage");
  const selectionMetaEl = document.getElementById("selectionMeta");
  const btnReloadTemplates = document.getElementById("btnReloadTemplates");
  const btnSaveDraft = document.getElementById("btnSaveDraft");
  const btnPublish = document.getElementById("btnPublish");

  function esc(value) {
    const span = document.createElement("span");
    span.textContent = String(value == null ? "" : value);
    return span.innerHTML;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getToken() {
    return localStorage.getItem("adminToken") || "";
  }

  function makeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function notifySessionExpired() {
    try {
      window.parent.postMessage({ type: "LOGOUT_REQUEST" }, "*");
    } catch (_) {}
  }

  function setStatus(message, tone) {
    statusMessageEl.textContent = message || "Pronto";
    statusMessageEl.dataset.tone = tone || "muted";
  }

  function buildUrl(path) {
    return path.startsWith("http") ? path : API + path;
  }

  function getSearchParams() {
    return new URLSearchParams(window.location.search || "");
  }

  function getRequestedTemplateId() {
    return String(getSearchParams().get("templateId") || "").trim();
  }

  function syncTemplateQuery(templateId) {
    const params = getSearchParams();
    const normalized = String(templateId || "").trim();
    if (normalized) params.set("templateId", normalized);
    else params.delete("templateId");
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }

  async function authFetch(path, options) {
    const token = getToken();
    if (!token) {
      notifySessionExpired();
      throw new Error("Sessao expirada.");
    }

    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {}, {
      Authorization: `Bearer ${token}`,
    });
    let body = opts.body;
    if (body && typeof body === "object" && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }

    const response = await fetch(buildUrl(path), {
      method: opts.method || "GET",
      headers,
      body,
      signal: opts.signal,
    });

    if (response.status === 401) {
      notifySessionExpired();
      throw new Error("Sessao expirada.");
    }

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }

    if (!response.ok || !data || data.ok === false) {
      const message = data?.error?.message || `Falha na requisicao (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function normalizeSlug(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24);
  }

  function summarizeText(value, maxLength) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function formatDate(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "--";
    return date.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function getTemplateStatusBadge(status) {
    const normalized = String(status || "draft").toLowerCase();
    return `<span class="badge status-${esc(normalized)}">${esc(normalized || "draft")}</span>`;
  }

  function getFlowBadge(summary) {
    if (!summary) return '<span class="badge">Sem fluxo</span>';
    if (summary.publishedVersion > 0 && summary.hasDraftChanges) {
      return '<span class="badge flow-unsaved">Publicado + rascunho</span>';
    }
    if (summary.publishedVersion > 0) {
      return '<span class="badge flow-published">Publicado</span>';
    }
    return '<span class="badge flow-draft">Rascunho</span>';
  }

  function getNodeTypeLabel(type) {
    const match = NODE_TYPE_OPTIONS.find((item) => item.type === type);
    return match ? match.label : "Etapa";
  }

  function getNodeDefault(type) {
    switch (type) {
      case "send_text":
        return { title: "Mensagem", config: { text: "" } };
      case "send_image":
        return { title: "Imagem", config: { imageUrl: "", caption: "" } };
      case "send_template":
        return { title: "Template", config: { templateId: "" } };
      case "update_driver_status":
        return { title: "Atualizar status", config: { status: "" } };
      case "add_tag":
        return { title: "Adicionar tag", config: { tag: "" } };
      case "send_buttons":
        return { title: "Botões de resposta", config: { buttons: [] } };
      case "handoff_human":
        return { title: "Encaminhar operador", config: { note: "Continuar atendimento no OD Chat." } };
      case "end":
        return { title: "Encerrar", config: { summary: "Fluxo encerrado." } };
      default:
        return { title: "Etapa", config: {} };
    }
  }

  function buildNode(type) {
    const defaults = getNodeDefault(type);
    return {
      id: makeId("node"),
      type,
      title: defaults.title,
      config: defaults.config,
    };
  }

  function getFlowSummary(templateId) {
    return state.flowSummaries.get(String(templateId || "")) || null;
  }

  function getTemplateById(templateId) {
    return state.templates.find((item) => item.id === templateId) || null;
  }

  function getBranchById(branchId) {
    if (!state.draft || !Array.isArray(state.draft.branches)) return null;
    return findBranchRecursive(state.draft.branches, branchId);
  }

  function findBranchRecursive(branches, branchId) {
    for (const branch of branches) {
      if (branch.id === branchId) return branch;
      if (Array.isArray(branch.children)) {
        const found = findBranchRecursive(branch.children, branchId);
        if (found) return found;
      }
    }
    return null;
  }

  function getSelectedBranch() {
    return getBranchById(state.selectedBranchId);
  }

  function getNodeLocation(nodeId) {
    if (!state.draft || !Array.isArray(state.draft.branches)) return null;
    return findNodeRecursive(state.draft.branches, nodeId);
  }

  function findNodeRecursive(branches, nodeId) {
    for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
      const branch = branches[branchIndex];
      const nodeIndex = branch.nodes.findIndex((node) => node.id === nodeId);
      if (nodeIndex >= 0) {
        return { branch, branchIndex, nodeIndex, node: branch.nodes[nodeIndex] };
      }
      if (Array.isArray(branch.children)) {
        const found = findNodeRecursive(branch.children, nodeId);
        if (found) return found;
      }
    }
    return null;
  }

  function hasTemplateButtons(template) {
    return Array.isArray(template?.buttons) && template.buttons.length > 0;
  }

  function getBranchSource(branch) {
    return String(branch?.meta?.source || "").toLowerCase();
  }

  function isFallbackBranch(branch) {
    return String(branch?.match?.type || "").toLowerCase() === "fallback" || String(branch?.id || "") === "fallback";
  }

  function isDefaultBranch(branch) {
    return String(branch?.id || "") === "default";
  }

  function isCustomBranch(branch) {
    const branchId = String(branch?.id || "");
    const source = getBranchSource(branch);
    return branchId.startsWith("custom:") || branchId.startsWith("manual:") || source === "manual_choice";
  }

  function isTemplateButtonBranch(branch) {
    const type = String(branch?.match?.type || "").toLowerCase();
    return type === "button" || type === "list";
  }

  function isTemplateTextChoiceBranch(branch) {
    return getBranchSource(branch) === "template_text_option";
  }

  function isCatchAllBranch(branch) {
    return isFallbackBranch(branch) || isDefaultBranch(branch);
  }

  function isGlobalOptOutBranch(branch) {
    return branch?.meta?.globalOptOut === true;
  }

  function supportsGlobalOptOut(branch) {
    if (!branch) return false;
    if (String(branch.id || "").startsWith("sub:")) return false;
    return !isCatchAllBranch(branch);
  }

  function getChoiceBranches() {
    if (!state.draft || !Array.isArray(state.draft.branches)) return [];
    return state.draft.branches.filter((branch) => !isCatchAllBranch(branch));
  }

  function getBranchAliases(branch) {
    const branchAliases = [];
    const metaAliases = Array.isArray(branch?.meta?.aliases) ? branch.meta.aliases : [];
    metaAliases.forEach((alias) => {
      const text = String(alias || "").trim();
      if (text) branchAliases.push(text);
    });
    String(branch?.match?.value || "")
      .split(/[\n,;|]+/g)
      .map((item) => String(item || "").trim())
      .filter((item) => item && item !== "*")
      .forEach((alias) => branchAliases.push(alias));
    return [...new Set(branchAliases)];
  }

  function getBranchPrimaryTrigger(branch) {
    if (isTemplateButtonBranch(branch)) {
      return branch?.label || branch?.match?.value || "Botão do template";
    }
    const aliases = getBranchAliases(branch);
    if (aliases.length) return aliases[0];
    return branch?.label || "Qualquer resposta";
  }

  function ensureSelection() {
    if (!state.draft || !Array.isArray(state.draft.branches) || !state.draft.branches.length) {
      state.selectedBranchId = "";
      return;
    }
    if (!getSelectedBranch()) {
      state.selectedBranchId = state.draft.branches[0].id;
    }
  }

  function markDirty(message) {
    state.dirty = true;
    renderCanvasTop();
    renderTemplateList();
    renderStatusMeta();
    if (message) setStatus(message, "warn");
  }

  function buildTemplateStats() {
    const total = state.templates.length;
    const withFlow = state.templates.filter((template) => getFlowSummary(template.id)).length;
    const published = state.templates.filter((template) => {
      const summary = getFlowSummary(template.id);
      return summary && summary.publishedVersion > 0;
    }).length;
    return [
      `${total} templates`,
      `${withFlow} com fluxo`,
      `${published} publicados`,
    ];
  }

  function getFilteredTemplates() {
    return state.templates.slice().sort((left, right) => {
      const leftApproved = String(left.status || "").toLowerCase() === "approved" ? 0 : 1;
      const rightApproved = String(right.status || "").toLowerCase() === "approved" ? 0 : 1;
      if (leftApproved !== rightApproved) return leftApproved - rightApproved;
      return String(left.name || "").localeCompare(String(right.name || ""), "pt-BR");
    });
  }

  function renderTemplateList() {
    const stats = buildTemplateStats();
    templateStatsEl.innerHTML = stats.map((line) => `<span>${esc(line)}</span>`).join(" · ");

    if (state.loadingTemplates) {
      templateDropdownEl.innerHTML = '<option value="">Carregando...</option>';
      templateDropdownEl.disabled = true;
      return;
    }

    const templates = getFilteredTemplates();
    templateDropdownEl.disabled = false;
    templateDropdownEl.innerHTML = '<option value="">Selecione um template</option>' +
      templates.map((template) => {
        const summary = getFlowSummary(template.id);
        const status = String(template.status || "draft").toLowerCase();
        const flowTag = summary && summary.publishedVersion > 0 ? " [Publicado]" : (summary ? " [Rascunho]" : "");
        return `<option value="${esc(template.id)}"${template.id === state.selectedTemplateId ? " selected" : ""}>${esc(template.name || "Template sem nome")} (${esc(status)})${flowTag}</option>`;
      }).join("");
  }

  function renderMetricPill(label, value) {
    return `<span class="metric-pill">${esc(label)} <strong>${esc(value)}</strong></span>`;
  }

  function needsMetaTemplateBackfill(items) {
    return (Array.isArray(items) ? items : []).some((template) => {
      const status = String(template?.status || "").toLowerCase();
      const hasMetaId = Boolean(String(template?.metaTemplateId || "").trim());
      const hasButtons = Array.isArray(template?.buttons) && template.buttons.length > 0;
      return status === "approved" && hasMetaId && !hasButtons;
    });
  }

  function renderTemplatePhonePreview(template) {
    const buttons = Array.isArray(template?.buttons) ? template.buttons : [];
    return `
      <div class="template-phone-card">
        <div class="template-phone-head">
          <span class="template-phone-campaign">${esc(template.name || "Template WhatsApp")}</span>
          <span class="template-phone-time">Agora</span>
        </div>
        <div class="template-phone-bubble">
          ${esc(template.bodyText || "Sem mensagem base configurada neste template.")}
        </div>
        ${buttons.length ? `
          <div class="template-phone-buttons">
            ${buttons.map((button) => `<div class="template-phone-button">${esc(button.text || "Botão")}</div>`).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  function getStartingPathTitle(branch, template) {
    if (isTemplateButtonBranch(branch)) return "Fluxo do botão";
    if (isTemplateTextChoiceBranch(branch)) return "Fluxo da opção";
    if (isFallbackBranch(branch)) return "Resposta fora do fluxo";
    if (isDefaultBranch(branch)) return hasTemplateButtons(template) ? "Resposta fora dos botões" : "Qualquer resposta";
    return "Fluxo da resposta";
  }

  function getStartingPathLabel(branch) {
    if (isFallbackBranch(branch) || isDefaultBranch(branch)) {
      return branch.label || "Qualquer outra resposta";
    }
    return branch.label || getBranchPrimaryTrigger(branch) || "Resposta";
  }

  function getStartingPathDescription(branch, template) {
    if (isTemplateButtonBranch(branch)) {
      return "Quando o motorista tocar neste botão, o sistema executa a sequência abaixo.";
    }
    if (isTemplateTextChoiceBranch(branch)) {
      return "Quando o motorista responder com esta opção, o sistema segue por este caminho.";
    }
    if (isFallbackBranch(branch)) {
      return "Use este caminho para qualquer resposta que não combine com os botões do template.";
    }
    if (isDefaultBranch(branch) && !hasTemplateButtons(template)) {
      return "Use este caminho para qualquer resposta que não entrar nas opções configuradas.";
    }
    if (isCustomBranch(branch)) {
      return "Use quando precisar criar uma resposta extra manualmente.";
    }
    return "";
  }

  function renderDrawerState() {
    if (!sideRailEl) return;
    const active = state.openDrawer || "";
    sideRailEl.dataset.openDrawer = active;
    sideRailEl.querySelectorAll("[data-panel-drawer]").forEach((section) => {
      const panelName = section.dataset.panelDrawer || "";
      const isOpen = panelName === active;
      section.classList.toggle("is-open", isOpen);
      section.classList.toggle("is-collapsed", !isOpen);
      const toggle = section.querySelector("[data-toggle-panel]");
      if (toggle) {
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      }
    });
  }

  function toggleDrawer(panelName) {
    state.openDrawer = state.openDrawer === panelName ? "" : panelName;
    renderDrawerState();
  }

  function renderCanvasTop() {
    btnSaveDraft.disabled = !state.draft || state.loadingFlow || state.saving || state.publishing;
    btnPublish.disabled = !state.draft || state.loadingFlow || state.saving || state.publishing;

    if (state.loadingFlow) {
      canvasTopEl.innerHTML = '<div class="empty-card">Carregando fluxo do template...</div>';
      return;
    }

    if (!state.draft || !state.currentItem) {
      canvasTopEl.innerHTML = '<div class="empty-card">Selecione um template para configurar o fluxo.</div>';
      return;
    }

    const template = state.draft.template || {};
    const summary = getFlowSummary(template.id) || {
      revision: Number(state.currentItem.revision || 0),
      publishedVersion: Number(state.currentItem.publishedVersion || 0),
      hasDraftChanges: state.dirty,
      publishedAt: state.currentItem.publishedAt,
    };
    const choiceBranches = getChoiceBranches();
    const totalNodes = (state.draft.branches || []).reduce((sum, branch) => sum + (Array.isArray(branch.nodes) ? branch.nodes.length : 0), 0);
    const showManualAdd = !hasTemplateButtons(template);
    const catchAllBranch = (state.draft.branches || []).find(isCatchAllBranch);
    const initialPaths = choiceBranches.slice();
    const shouldWarnMissingButtons = !hasTemplateButtons(template)
      && String(template?.status || "").toLowerCase() === "approved"
      && Boolean(String(template?.metaTemplateId || "").trim());
    if (catchAllBranch) initialPaths.push(catchAllBranch);

    canvasTopEl.innerHTML = `
      <div class="canvas-template-compact">
        <div class="canvas-compact-left">
          <h2 class="canvas-template-name">${esc(template.name || "Template sem nome")}</h2>
          <div class="canvas-template-badges">
            ${getTemplateStatusBadge(template.status)}
            ${getFlowBadge({
              publishedVersion: summary.publishedVersion,
              hasDraftChanges: state.dirty || summary.hasDraftChanges,
            })}
            ${renderMetricPill("Caminhos", initialPaths.length)}
            ${renderMetricPill("Etapas", totalNodes)}
            ${renderMetricPill("Revisao", `r${summary.revision || 0}`)}
            ${summary.publishedVersion > 0 ? renderMetricPill("Publicado", `v${summary.publishedVersion}`) : ""}
            ${showManualAdd ? '<button type="button" class="tool-button btn-sm" id="btnAddManualBranch">+ Opção manual</button>' : ""}
          </div>
        </div>
      </div>
      ${shouldWarnMissingButtons ? '<div class="empty-card">Este template foi aprovado na Meta, mas os botões ainda não apareceram localmente. Clique em Atualizar para forçar uma nova sincronização.</div>' : ""}
    `;
  }

  function getBranchKindLabel(branch, template) {
    if (isTemplateButtonBranch(branch)) return "Botão do template";
    if (isTemplateTextChoiceBranch(branch)) return "Opção detectada no template";
    if (isCustomBranch(branch)) return "Escolha manual";
    if (isFallbackBranch(branch)) return "Resposta fora do previsto";
    if (isDefaultBranch(branch)) {
      return hasTemplateButtons(template) ? "Fora dos botões" : "Qualquer resposta";
    }
    return "Resposta";
  }

  function getBranchDescription(branch, template) {
    if (isTemplateButtonBranch(branch)) {
      return "Este caminho roda quando o motorista tocar neste botão aprovado pela Meta.";
    }
    if (isTemplateTextChoiceBranch(branch)) {
      return "Este caminho roda quando o motorista responder com a opção detectada no texto do template.";
    }
    if (isCustomBranch(branch)) {
      return "Use esta escolha extra quando quiser mapear respostas livres que não vieram prontas no template.";
    }
    if (isFallbackBranch(branch)) {
      return "Usado quando a resposta do motorista não encaixar nas escolhas previstas.";
    }
    if (isDefaultBranch(branch) && !hasTemplateButtons(template)) {
      return "Captura qualquer mensagem que não entrar nas escolhas configuradas acima.";
    }
    return "";
  }

  function renderTemplateOptions(selectedTemplateId) {
    const options = ['<option value="">Selecione</option>'];
    state.templates.forEach((template) => {
      options.push(`<option value="${esc(template.id)}"${template.id === selectedTemplateId ? " selected" : ""}>${esc(template.name || template.id)}</option>`);
    });
    return options.join("");
  }

  function renderBranchBoard() {
    if (state.loadingFlow) {
      branchBoardEl.innerHTML = '<div class="empty-card">Carregando fluxo...</div>';
      return;
    }

    if (!state.draft || !Array.isArray(state.draft.branches) || !state.draft.branches.length) {
      branchBoardEl.innerHTML = '<div class="empty-card">Nenhum branch disponível para este template.</div>';
      return;
    }

    const template = state.draft.template || {};
    const branches = state.draft.branches;
    const activeTabId = getTopLevelParentId(state.selectedBranchId) || branches[0]?.id || "";
    const activeBranch = branches.find((b) => b.id === activeTabId) || branches[0];

    const tabsHtml = branches.map((branch) => {
      const label = branch.label || getBranchPrimaryTrigger(branch) || getBranchKindLabel(branch, template);
      const isActive = branch.id === activeTabId;
      return `<button type="button" class="branch-tab${isActive ? " is-active" : ""}" data-tab-branch-id="${esc(branch.id)}">${esc(label)}</button>`;
    }).join("");

    const graph = activeBranch ? renderFlowGraph(activeBranch, template) : { columnsHtml: "", edges: [] };
    state.currentGraphEdges = graph.edges;

    branchBoardEl.innerHTML = `
      <div class="branch-tabs-bar">${tabsHtml}</div>
      <div class="flow-canvas" id="flowCanvas">
        <div class="flow-graph" id="flowGraph">
          <svg class="flow-links" id="flowLinks" aria-hidden="true"></svg>
          <div class="flow-columns">${graph.columnsHtml}</div>
        </div>
      </div>
    `;
    initCanvasPan();
    initBranchDragging();
    // Defer link rendering so the browser has completed layout before we read getBoundingClientRect()
    requestAnimationFrame(() => { renderFlowLinks(); });
  }

  function getTopLevelParentId(branchId) {
    if (!state.draft || !Array.isArray(state.draft.branches)) return "";
    for (const branch of state.draft.branches) {
      if (branch.id === branchId) return branch.id;
      if (containsBranchId(branch, branchId)) return branch.id;
    }
    return state.draft.branches[0]?.id || "";
  }

  function containsBranchId(parent, branchId) {
    if (!Array.isArray(parent.children)) return false;
    for (const child of parent.children) {
      if (child.id === branchId) return true;
      if (containsBranchId(child, branchId)) return true;
    }
    return false;
  }

  function collectFlowGraphItems(branch, depth, parentId, items, edges) {
    if (!branch) return;
    items.push({ branch, depth, parentId });
    if (parentId) {
      edges.push({ from: parentId, to: branch.id });
    }
    const children = Array.isArray(branch.children) ? branch.children : [];
    children.forEach((child) => collectFlowGraphItems(child, depth + 1, branch.id, items, edges));
  }

  function renderFlowGraph(rootBranch, template) {
    const items = [];
    const edges = [];
    collectFlowGraphItems(rootBranch, 0, "", items, edges);

    const groupedByDepth = new Map();
    let maxDepth = 0;
    items.forEach((item) => {
      if (!groupedByDepth.has(item.depth)) groupedByDepth.set(item.depth, []);
      groupedByDepth.get(item.depth).push(item);
      if (item.depth > maxDepth) maxDepth = item.depth;
    });

    const columns = [];
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const bucket = groupedByDepth.get(depth) || [];
      columns.push(`
        <div class="flow-column" data-depth="${depth}">
          ${bucket.map((item) => `<div class="flow-branch-slot">${renderBranchComposer(item.branch, template)}</div>`).join("")}
        </div>
      `);
    }

    return {
      columnsHtml: columns.join(""),
      edges,
    };
  }

  function renderBranchComposer(branch, template) {
    const canDeleteBranch = isCustomBranch(branch);
    const branchTitle = branch.label || getBranchPrimaryTrigger(branch) || getBranchKindLabel(branch, template);
    const isActive = state.selectedBranchId === branch.id;
    const isSubBranch = String(branch.id || "").startsWith("sub:");
    const kindLabel = isSubBranch ? "" : getStartingPathTitle(branch, template);
    const isActionsCollapsed = !state.expandedActionSections.has(branch.id);
    const cardPos = state.branchPositions.get(branch.id) || { x: 0, y: 0 };
    const cardTransform = cardPos.x || cardPos.y
      ? ` style="transform: translate(${Number(cardPos.x) || 0}px, ${Number(cardPos.y) || 0}px);"`
      : "";

    // Extract nodes by type for unified layout
    const textNode = branch.nodes.find((n) => n.type === "send_text");
    const imageNode = branch.nodes.find((n) => n.type === "send_image");
    const buttonsNode = branch.nodes.find((n) => n.type === "send_buttons");
    const tagNodes = branch.nodes.filter((n) => n.type === "add_tag");
    const statusNode = branch.nodes.find((n) => n.type === "update_driver_status");
    const handoffNode = branch.nodes.find((n) => n.type === "handoff_human");
    const endNode = branch.nodes.find((n) => n.type === "end");
    const templateNode = branch.nodes.find((n) => n.type === "send_template");

    // Custom branch editable fields
    const customFields = isCustomBranch(branch) ? `
      <div class="composer-custom-fields">
        <input type="text" class="composer-input" data-branch-id="${esc(branch.id)}" data-branch-field="label" value="${esc(branch.label || "")}" placeholder="Titulo do caminho">
        <input type="text" class="composer-input" data-branch-id="${esc(branch.id)}" data-branch-field="match.value" value="${esc(branch.match?.value || "")}" placeholder="Respostas aceitas: sim | quero | 1">
      </div>
    ` : "";

    // Message + Image side by side
    const textConfig = textNode ? textNode.config || {} : {};
    const imageConfig = imageNode ? imageNode.config || {} : {};
    const hasText = !!textNode;
    const hasImage = !!imageNode;

    // Buttons section
    const buttonsConfig = buttonsNode ? (buttonsNode.config || {}) : {};
    const buttonsList = Array.isArray(buttonsConfig.buttons) ? buttonsConfig.buttons : [];

    // Action chips (toggleable quick actions)
    const actionChips = [];
    if (tagNodes.length) tagNodes.forEach((n) => actionChips.push({ type: "tag", node: n }));
    if (statusNode) actionChips.push({ type: "status", node: statusNode });
    if (handoffNode) actionChips.push({ type: "handoff", node: handoffNode });
    if (endNode) actionChips.push({ type: "end", node: endNode });
    if (templateNode) actionChips.push({ type: "template", node: templateNode });

    const isCollapsed = state.collapsedBranches.has(branch.id);
    const collapseIcon = isCollapsed ? '&#9654;' : '&#9660;';
    const summaryChips = [];
    if (textConfig.text) summaryChips.push('Msg');
    if (imageConfig.imageUrl) summaryChips.push('Img');
    if (buttonsList.length) summaryChips.push(buttonsList.length + ' btn');
    if (tagNodes.length) summaryChips.push('Tag');
    if (statusNode) summaryChips.push('Status');
    if (handoffNode) summaryChips.push('Operador');
    if (endNode) summaryChips.push('Fim');
    if (templateNode) summaryChips.push('Template');
    if (isGlobalOptOutBranch(branch)) summaryChips.push('Opt-out');

    const headerHtml = `
        <div class="composer-header">
          <div class="composer-header-left">
            <button type="button" class="composer-collapse-btn" data-collapse-branch-id="${esc(branch.id)}" title="${isCollapsed ? 'Expandir' : 'Recolher'}">${collapseIcon}</button>
            ${kindLabel ? `<span class="composer-kind">${esc(kindLabel)}</span>` : ''}
            <h3 class="composer-title">${esc(branchTitle)}</h3>
          </div>
          <div class="composer-header-right">
            <span class="composer-count">${esc(branch.nodes.length)} a&ccedil;&otilde;es</span>
            ${isCollapsed ? `<span class="composer-chips">${summaryChips.map(c => `<span class="composer-chip">${esc(c)}</span>`).join('')}</span>` : ''}
            ${canDeleteBranch ? `<button type="button" class="composer-btn-icon remove-branch-btn" data-branch-id="${esc(branch.id)}" title="Excluir caminho">&times;</button>` : ""}
          </div>
        </div>`;

    if (isCollapsed) {
      return `
        <section class="branch-composer is-collapsed${isActive ? " is-active" : ""}${isSubBranch ? " branch-nested" : ""}"${cardTransform} data-branch-id="${esc(branch.id)}">
          ${headerHtml}
        </section>
      `;
    }

    return `
      <section class="branch-composer${isActive ? " is-active" : ""}${isSubBranch ? " branch-nested" : ""}${isSubBranch ? " branch-floating-expanded" : ""}"${cardTransform} data-branch-id="${esc(branch.id)}">
        ${headerHtml}

        ${customFields}

        <div class="composer-body">
          <div class="composer-content-row">
            <div class="composer-message-col">
              <label class="composer-section-label">Mensagem</label>
              <textarea class="composer-textarea" data-branch-id="${esc(branch.id)}" data-composer-field="text" placeholder="Digite a mensagem de resposta...">${esc(textConfig.text || "")}</textarea>
            </div>
            <div class="composer-image-col">
              <label class="composer-section-label">Imagem</label>
              <div class="composer-image-area" data-branch-id="${esc(branch.id)}">
                ${imageConfig.imageUrl
                  ? `<img class="composer-image-preview" src="${esc(imageConfig.imageUrl)}" alt="Preview">`
                  : `<div class="composer-image-placeholder">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                      <span>Arraste ou clique</span>
                    </div>`
                }
                <input type="file" class="composer-image-input" accept="image/jpeg,image/png,image/webp,image/gif" data-branch-id="${esc(branch.id)}" data-composer-upload="image">
                ${imageConfig.imageUrl ? `<button type="button" class="composer-image-remove" data-branch-id="${esc(branch.id)}" data-composer-action="remove-image" title="Remover imagem">&times;</button>` : ""}
              </div>
              ${hasImage ? `<input type="text" class="composer-input composer-caption" data-branch-id="${esc(branch.id)}" data-composer-field="caption" value="${esc(imageConfig.caption || "")}" placeholder="Legenda da imagem">` : ""}
            </div>
          </div>

          <div class="composer-buttons-section">
            <label class="composer-section-label">Bot&otilde;es de resposta <span class="composer-hint">(at&eacute; 3 bot&otilde;es)</span></label>
            <div class="composer-buttons-list" data-branch-id="${esc(branch.id)}">
              ${buttonsList.map((btn, i) => `
                <div class="composer-button-row">
                  <input type="text" class="composer-input composer-button-input" data-branch-id="${esc(branch.id)}" data-composer-button-index="${i}" value="${esc(btn.text || "")}" placeholder="Texto do botão ${i + 1}" maxlength="20">
                  <button type="button" class="composer-btn-icon composer-remove-button" data-branch-id="${esc(branch.id)}" data-remove-button-index="${i}" title="Remover botão">&times;</button>
                </div>
              `).join("")}
              ${buttonsList.length < 3 ? `<button type="button" class="composer-add-button" data-branch-id="${esc(branch.id)}" data-composer-action="add-button">+ Adicionar botão</button>` : ""}
            </div>
          </div>

          <div class="composer-actions-section">
            <div class="composer-actions-head">
              <label class="composer-section-label">A&ccedil;&otilde;es autom&aacute;ticas</label>
              <button type="button" class="composer-actions-toggle" data-actions-collapse-branch-id="${esc(branch.id)}" title="${isActionsCollapsed ? "Expandir" : "Recolher"}">${isActionsCollapsed ? "Expandir" : "Recolher"}</button>
            </div>
            ${isActionsCollapsed ? "" : `<div class="composer-actions-grid">
              <div class="composer-action-item">
                <div class="composer-action-head">
                  <label class="composer-toggle">
                    <input type="checkbox" data-branch-id="${esc(branch.id)}" data-composer-toggle="tag" ${tagNodes.length ? "checked" : ""}>
                    <span>Tag</span>
                  </label>
                </div>
                ${tagNodes.length ? `<input type="text" class="composer-input" data-branch-id="${esc(branch.id)}" data-composer-field="tag" value="${esc(tagNodes[0]?.config?.tag || "")}" placeholder="Ex.: campanha_sp">` : ""}
              </div>
              <div class="composer-action-item">
                <div class="composer-action-head">
                  <label class="composer-toggle">
                    <input type="checkbox" data-branch-id="${esc(branch.id)}" data-composer-toggle="status" ${statusNode ? "checked" : ""}>
                    <span>Status</span>
                  </label>
                </div>
                ${statusNode ? `<input type="text" class="composer-input" data-branch-id="${esc(branch.id)}" data-composer-field="status" value="${esc(statusNode.config?.status || "")}" placeholder="Ex.: interessado">` : ""}
              </div>
              <div class="composer-action-item">
                <div class="composer-action-head">
                  <label class="composer-toggle">
                    <input type="checkbox" data-branch-id="${esc(branch.id)}" data-composer-toggle="handoff" ${handoffNode ? "checked" : ""}>
                    <span>Encaminhar operador</span>
                  </label>
                </div>
              </div>
              <div class="composer-action-item">
                <div class="composer-action-head">
                  <label class="composer-toggle">
                    <input type="checkbox" data-branch-id="${esc(branch.id)}" data-composer-toggle="end" ${endNode ? "checked" : ""}>
                    <span>Encerrar fluxo</span>
                  </label>
                </div>
              </div>
              <div class="composer-action-item">
                <div class="composer-action-head">
                  <label class="composer-toggle">
                    <input type="checkbox" data-branch-id="${esc(branch.id)}" data-composer-toggle="template" ${templateNode ? "checked" : ""}>
                    <span>Enviar template</span>
                  </label>
                </div>
                ${templateNode ? `
                  <select class="composer-select" data-branch-id="${esc(branch.id)}" data-composer-field="templateId">
                    ${renderTemplateOptions(templateNode.config?.templateId || "")}
                  </select>
                ` : ""}
              </div>
              ${supportsGlobalOptOut(branch) ? `
                <div class="composer-action-item">
                  <div class="composer-action-head">
                    <label class="composer-toggle">
                      <input type="checkbox" data-branch-id="${esc(branch.id)}" data-branch-field="meta.globalOptOut" ${isGlobalOptOutBranch(branch) ? "checked" : ""}>
                      <span>Opt-out global</span>
                    </label>
                  </div>
                  <span class="composer-hint">Se o motorista cair neste caminho, ele sai automaticamente dos próximos disparos.</span>
                </div>
              ` : ""}
            </div>`}
          </div>
        </div>
      </section>
    `;
    // Note: when collapsed, section is already closed above
  }

  function initCanvasPan() {
    const canvas = document.getElementById('flowCanvas');
    if (!canvas) return;

    const PAN_THRESHOLD = 4;
    let pending = null;  // pointerdown before threshold
    let pan = null;      // active pan state

    function onPointerDown(e) {
      // Middle button always pans; left button only when NOT on a card
      const isMiddle = e.button === 1;
      const isLeft = e.button === 0;
      if (!isMiddle && !isLeft) return;
      if (isLeft && e.target.closest('.branch-composer')) return;
      if (isLeft && isInteractiveTarget(e.target)) return;

      pending = {
        pointerId: e.pointerId,
        button: e.button,
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: canvas.scrollLeft,
        scrollTop: canvas.scrollTop,
      };
      if (isMiddle) e.preventDefault();
    }

    function onPointerMove(e) {
      if (!pending && !pan) return;

      if (pending && !pan) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;

        // Promote to active pan
        pan = { ...pending };
        pending = null;
        try { canvas.setPointerCapture(pan.pointerId); } catch (_) {}
        canvas.classList.add('is-panning');
      }

      if (!pan) return;
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      canvas.scrollLeft = pan.scrollLeft - dx;
      canvas.scrollTop = pan.scrollTop - dy;
      // Links updated via the 'scroll' event listener below
    }

    function onPointerUp(e) {
      if (pan) {
        try { canvas.releasePointerCapture(pan.pointerId); } catch (_) {}
        canvas.classList.remove('is-panning');
      }
      pending = null;
      pan = null;
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('scroll', renderFlowLinks);
  }

  function getBranchComposerById(branchId) {
    const cards = branchBoardEl.querySelectorAll('.branch-composer');
    for (const card of cards) {
      if (card.dataset.branchId === branchId) return card;
    }
    return null;
  }

  function renderFlowLinks() {
    const graph = document.getElementById('flowGraph');
    const svg = document.getElementById('flowLinks');
    if (!graph || !svg) return;

    // Do NOT set width/height/viewBox attributes — let CSS (inset:0; width:100%; height:100%)
    // define the SVG size. Without a viewBox the SVG coordinate system is 1 CSS-pixel = 1 user-unit,
    // with origin at the top-left of .flow-graph. Setting a viewBox would introduce scaling artifacts.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.removeAttribute('viewBox');

    const graphRect = graph.getBoundingClientRect();

    // Coordinates are computed as (viewportPos - graphRect.origin).
    // The SVG and the cards are inside the same scrolling container (.flow-canvas), so they scroll
    // together. Subtracting graphRect already yields correct graph-local coordinates; adding
    // canvas.scrollLeft would double-count the scroll offset and displace the paths.

    const paths = [];
    const edges = Array.isArray(state.currentGraphEdges) ? state.currentGraphEdges : [];
    edges.forEach((edge) => {
      const fromEl = getBranchComposerById(edge.from);
      const toEl = getBranchComposerById(edge.to);
      if (!fromEl || !toEl) return;

      // Anchor connector to the vertical centre of the header, not the card centre.
      // This keeps the line stable regardless of whether the card is expanded or collapsed.
      const fromHeader = fromEl.querySelector('.composer-header');
      const toHeader = toEl.querySelector('.composer-header');
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const fromAnchor = fromHeader ? fromHeader.getBoundingClientRect() : fromRect;
      const toAnchor = toHeader ? toHeader.getBoundingClientRect() : toRect;

      const startX = fromRect.right - graphRect.left;
      const startY = fromAnchor.top + fromAnchor.height / 2 - graphRect.top;
      const endX = toRect.left - graphRect.left;
      const endY = toAnchor.top + toAnchor.height / 2 - graphRect.top;
      const bend = Math.max(24, (endX - startX) * 0.45);
      const d = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
      paths.push(`<path class="flow-link-path" d="${d}"/>`);
    });

    svg.innerHTML = paths.join('');
  }

  function initBranchDragging() {
    // Threshold in pixels before we consider it a drag (not a click)
    const DRAG_THRESHOLD = 4;

    const headers = branchBoardEl.querySelectorAll('.branch-composer .composer-header');
    headers.forEach((header) => {
      // pending = collected on pointerdown, before threshold crossed
      let pending = null;
      // active drag state (set once threshold is crossed)
      let drag = null;

      header.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (isInteractiveTarget(event.target)) return;
        const card = header.closest('.branch-composer');
        if (!card) return;
        const bid = card.dataset.branchId || '';
        if (!bid) return;

        const initial = state.branchPositions.get(bid) || { x: 0, y: 0 };
        pending = {
          pointerId: event.pointerId,
          branchId: bid,
          startX: event.clientX,
          startY: event.clientY,
          originX: Number(initial.x) || 0,
          originY: Number(initial.y) || 0,
        };
        // Do NOT call preventDefault here — that would block click events on child buttons
      });

      header.addEventListener('pointermove', (event) => {
        if (!pending && !drag) return;

        if (pending && !drag) {
          // Check if we have crossed the threshold to start dragging
          const dx = event.clientX - pending.startX;
          const dy = event.clientY - pending.startY;
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

          // Threshold crossed — promote pending to active drag
          drag = { ...pending };
          pending = null;
          // Capture pointer now so we receive move/up even if cursor leaves the header
          try { header.setPointerCapture(drag.pointerId); } catch (_) {}
          // Suppress the click that would fire after pointerup
          header.addEventListener('click', suppressNextClick, { capture: true, once: true });
        }

        if (!drag) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        const nextX = drag.originX + dx;
        const nextY = drag.originY + dy;
        state.branchPositions.set(drag.branchId, { x: nextX, y: nextY });
        const card = getBranchComposerById(drag.branchId);
        if (card) {
          card.style.transform = `translate(${nextX}px, ${nextY}px)`;
        }
        renderFlowLinks();
      });

      function suppressNextClick(e) {
        e.stopPropagation();
        e.preventDefault();
      }

      const finishDrag = (event) => {
        if (drag) {
          try { header.releasePointerCapture(drag.pointerId); } catch (_) {}
        }
        pending = null;
        drag = null;
      };

      header.addEventListener('pointerup', finishDrag);
      header.addEventListener('pointercancel', finishDrag);
    });
  }

  function renderInspector() {
    if (!state.draft) {
      inspectorPanelEl.innerHTML = '<div class="empty-card">Selecione um template para configurar.</div>';
      return;
    }

    const template = state.draft.template || {};

    inspectorPanelEl.innerHTML = `
      <div class="inspector-stack">
        <div class="field-grid">
          <label class="checkbox-row">
            <input type="checkbox" name="settings.enabled"${state.draft.settings?.enabled !== false ? " checked" : ""}>
            <span>Fluxo ativo para este template</span>
          </label>
          ${hasTemplateButtons(template) ? `
            <label class="field">
              <span>Quando a resposta não combinar com os botões</span>
              <select name="settings.fallbackMode">
                <option value="handoff"${state.draft.settings?.fallbackMode === "handoff" ? " selected" : ""}>Encaminhar operador</option>
                <option value="ignore"${state.draft.settings?.fallbackMode === "ignore" ? " selected" : ""}>Ignorar resposta fora do fluxo</option>
              </select>
            </label>
          ` : ""}
          <label class="field">
            <span>Observações internas</span>
            <textarea name="notes" placeholder="Recados para a equipe">${esc(state.draft.notes || "")}</textarea>
          </label>
          <div class="field-grid panel-meta-grid">
            <div>
              <p class="mini-label">Última atualização</p>
              <strong>${esc(formatDate(state.currentItem?.updatedAt))}</strong>
            </div>
            <div>
              <p class="mini-label">Última publicação</p>
              <strong>${esc(formatDate(state.currentItem?.publishedAt))}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSimulation() {
    if (!state.draft) {
      simulationPanelEl.innerHTML = '<div class="empty-card">A simulação aparece aqui quando um template for carregado.</div>';
      return;
    }

    const template = state.draft.template || {};
    const branch = getSelectedBranch() || state.draft.branches[0];
    if (!branch) {
      simulationPanelEl.innerHTML = '<div class="empty-card">Nenhum fluxo disponível.</div>';
      return;
    }

    const templateButtons = Array.isArray(template.buttons) ? template.buttons : [];
    const items = [];

    items.push(`
      <div class="sim-bubble bot">
        <strong>${esc(template.name || "Template")}</strong><br>
        ${esc(template.bodyText || "Sem texto base configurado.")}
        ${templateButtons.length ? `<div class="sim-btn-row">${templateButtons.map((button) => `<span class="sim-btn">${esc(button.text)}</span>`).join("")}</div>` : ""}
      </div>
    `);

    items.push(`<div class="sim-bubble user">${esc(getBranchPrimaryTrigger(branch) || branch.label || "Resposta do motorista")}</div>`);

    branch.nodes.forEach((node) => {
      const config = node.config && typeof node.config === "object" ? node.config : {};
      if (node.type === "send_text") {
        items.push(`<div class="sim-bubble bot">${esc(config.text || "(mensagem vazia)")}</div>`);
        return;
      }
      if (node.type === "send_image") {
        items.push(`
          <div class="sim-bubble bot">
            ${config.imageUrl ? `<img class="sim-image" src="${esc(config.imageUrl)}" alt="Preview da imagem">` : ""}
            ${esc(config.caption || (config.imageUrl ? "Imagem enviada." : "Imagem sem URL configurada."))}
          </div>
        `);
        return;
      }
      if (node.type === "send_template") {
        const templateName = getTemplateById(config.templateId)?.name || config.templateId || "Template não definido";
        items.push(`<div class="sim-bubble bot">Template de saida: ${esc(templateName)}</div>`);
        return;
      }
      if (node.type === "update_driver_status") {
        items.push(`<div class="sim-bubble system">Status: ${esc(config.status || "não definido")}</div>`);
        return;
      }
      if (node.type === "add_tag") {
        items.push(`<div class="sim-bubble system">Tag: ${esc(config.tag || "não definida")}</div>`);
        return;
      }
      if (node.type === "handoff_human") {
        items.push(`<div class="sim-bubble system">Encaminhar operador: ${esc(config.note || "sem observação")}</div>`);
        return;
      }
      if (node.type === "send_buttons") {
        const btns = Array.isArray(config.buttons) ? config.buttons : [];
        if (btns.length) {
          items.push(`<div class="sim-bubble bot">
            ${items.length > 2 ? "" : "(Resposta com botões)"}
            <div class="sim-btn-row">${btns.map((b) => `<span class="sim-btn">${esc(b.text || "...")}</span>`).join("")}</div>
          </div>`);
        }
        return;
      }
      if (node.type === "end") {
        items.push(`<div class="sim-bubble system">Fim: ${esc(config.summary || "encerrado")}</div>`);
      }
    });

    if (!branch.nodes.length) {
      items.push('<div class="sim-bubble system">Nenhuma etapa configurada.</div>');
    }

    simulationPanelEl.innerHTML = `
      <div class="phone-mockup">
        <div class="phone-notch"></div>
        <div class="phone-header">
          <div class="phone-header-avatar">OD</div>
          <div class="phone-header-info">
            <span class="phone-header-name">OD Drive</span>
            <span class="phone-header-status">online</span>
          </div>
        </div>
        <div class="phone-chat-area">
          <div class="simulator-stack">
            ${items.join("")}
          </div>
        </div>
        <div class="phone-input-bar">
          <span class="phone-input-placeholder">Mensagem</span>
        </div>
      </div>
    `;
    // Garante que a primeira mensagem fique visivel ao renderizar
    const chatArea = simulationPanelEl.querySelector('.phone-chat-area');
    if (chatArea) chatArea.scrollTop = 0;
  }

  function renderStatusMeta() {
    if (!state.draft) {
      selectionMetaEl.textContent = "";
      return;
    }

    const template = state.draft.template || {};
    const branch = getSelectedBranch();
    const parts = [template.name || "Template"];
    if (branch) parts.push(branch.label || "Fluxo");
    if (state.dirty) parts.push("alterações pendentes");
    selectionMetaEl.textContent = parts.join(" / ");
  }

  function renderAll() {
    ensureSelection();
    renderTemplateList();
    renderCanvasTop();
    renderBranchBoard();
    renderInspector();
    renderSimulation();
    renderDrawerState();
    renderStatusMeta();
  }

  function createManualBranch() {
    const currentCount = (state.draft?.branches || []).filter(isCustomBranch).length;
    const nextNumber = currentCount + 1;
    return {
      id: `manual:${makeId(normalizeSlug(`escolha-${nextNumber}`) || "escolha")}`,
      label: `Nova escolha ${nextNumber}`,
      match: {
        type: "free_text",
        value: String(nextNumber),
      },
      meta: {
        source: "manual_choice",
        aliases: [String(nextNumber)],
      },
      nodes: [],
    };
  }

  function addManualBranch() {
    if (!state.draft || hasTemplateButtons(state.draft.template)) return;
    const branch = createManualBranch();
    const defaultIndex = state.draft.branches.findIndex(isDefaultBranch);
    const fallbackIndex = state.draft.branches.findIndex(isFallbackBranch);
    const insertIndex = defaultIndex >= 0
      ? defaultIndex
      : (fallbackIndex >= 0 ? fallbackIndex : state.draft.branches.length);
    state.draft.branches.splice(insertIndex, 0, branch);
    state.selectedBranchId = branch.id;
    markDirty("Escolha manual adicionada.");
    renderCanvasTop();
    renderBranchBoard();
    renderSimulation();
    renderStatusMeta();
  }

  function removeManualBranch(branchId) {
    if (!state.draft) return;
    if (removeBranchRecursive(state.draft.branches, branchId)) {
      if (state.selectedBranchId === branchId) {
        state.selectedBranchId = state.draft.branches[0]?.id || "";
      }
      markDirty("Escolha manual removida.");
      renderCanvasTop();
      renderBranchBoard();
      renderSimulation();
      renderStatusMeta();
    }
  }

  function removeBranchRecursive(branches, branchId) {
    const idx = branches.findIndex((b) => b.id === branchId);
    if (idx >= 0) {
      branches.splice(idx, 1);
      return true;
    }
    for (const branch of branches) {
      if (Array.isArray(branch.children) && removeBranchRecursive(branch.children, branchId)) {
        return true;
      }
    }
    return false;
  }

  function setDeepValue(target, path, value) {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) return;
    let ref = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const key = parts[index];
      if (!ref[key] || typeof ref[key] !== "object") ref[key] = {};
      ref = ref[key];
    }
    ref[parts[parts.length - 1]] = value;
  }

  function updateSettingsField(path, rawValue, inputType) {
    if (!state.draft) return;
    if (path === "notes") {
      state.draft.notes = rawValue;
    } else if (path.startsWith("settings.")) {
      const key = path.replace("settings.", "");
      if (!state.draft.settings || typeof state.draft.settings !== "object") {
        state.draft.settings = {};
      }
      state.draft.settings[key] = inputType === "checkbox" ? !!rawValue : rawValue;
    }
    markDirty();
    renderStatusMeta();
  }

  function updateBranchField(branchId, fieldPath, rawValue, inputType) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    if (fieldPath === "label") {
      branch.label = String(rawValue || "").slice(0, 120);
    } else {
      setDeepValue(branch, fieldPath, inputType === "checkbox" ? !!rawValue : rawValue);
    }
    markDirty();
    renderCanvasTop();
    renderSimulation();
    renderStatusMeta();
  }

  /* ── Composer helpers: map unified form fields to node model ── */

  function ensureNodeOfType(branch, type) {
    let node = branch.nodes.find((n) => n.type === type);
    if (!node) {
      node = buildNode(type);
      branch.nodes.push(node);
    }
    return node;
  }

  function removeNodesOfType(branch, type) {
    branch.nodes = branch.nodes.filter((n) => n.type !== type);
  }

  function handleComposerFieldChange(branchId, field, value) {
    const branch = getBranchById(branchId);
    if (!branch) return;

    switch (field) {
      case "text": {
        if (value) {
          const node = ensureNodeOfType(branch, "send_text");
          node.config.text = value;
        }
        break;
      }
      case "caption": {
        const imgNode = branch.nodes.find((n) => n.type === "send_image");
        if (imgNode) imgNode.config.caption = value;
        break;
      }
      case "tag": {
        const tagNode = branch.nodes.find((n) => n.type === "add_tag");
        if (tagNode) tagNode.config.tag = value;
        break;
      }
      case "status": {
        const statusNode = branch.nodes.find((n) => n.type === "update_driver_status");
        if (statusNode) statusNode.config.status = value;
        break;
      }
      case "templateId": {
        const tplNode = branch.nodes.find((n) => n.type === "send_template");
        if (tplNode) tplNode.config.templateId = value;
        break;
      }
    }
    markDirty();
    renderSimulation();
    renderStatusMeta();
  }

  function handleComposerToggle(branchId, actionType, checked) {
    const branch = getBranchById(branchId);
    if (!branch) return;

    const typeMap = {
      tag: "add_tag",
      status: "update_driver_status",
      handoff: "handoff_human",
      end: "end",
      template: "send_template",
    };
    const nodeType = typeMap[actionType];
    if (!nodeType) return;

    if (checked) {
      ensureNodeOfType(branch, nodeType);
    } else {
      removeNodesOfType(branch, nodeType);
    }
    markDirty();
    renderBranchBoard();
    renderSimulation();
    renderStatusMeta();
  }

  function handleComposerAddButton(branchId) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    let buttonsNode = branch.nodes.find((n) => n.type === "send_buttons");
    if (!buttonsNode) {
      buttonsNode = buildNode("send_buttons");
      buttonsNode.config.buttons = [];
      branch.nodes.push(buttonsNode);
    }
    if (!Array.isArray(buttonsNode.config.buttons)) buttonsNode.config.buttons = [];
    if (buttonsNode.config.buttons.length >= 3) return;

    const btnId = makeId("btn");
    buttonsNode.config.buttons.push({ id: btnId, text: "" });

    // Create a child branch for this button
    if (!Array.isArray(branch.children)) branch.children = [];
    branch.children.push({
      id: "sub:" + branch.id + ":" + btnId,
      label: "",
      parentNodeId: buttonsNode.id,
      match: { type: "button", value: "", buttonId: btnId },
      meta: { source: "sub_button" },
      nodes: [],
      children: [],
    });

    markDirty();
    renderBranchBoard();
    renderSimulation();
    renderStatusMeta();
  }

  function handleComposerRemoveButton(branchId, buttonIndex) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    const buttonsNode = branch.nodes.find((n) => n.type === "send_buttons");
    if (!buttonsNode || !Array.isArray(buttonsNode.config.buttons)) return;

    const removed = buttonsNode.config.buttons.splice(buttonIndex, 1);
    if (removed.length && Array.isArray(branch.children)) {
      const removedId = removed[0].id;
      branch.children = branch.children.filter((c) => !c.id.endsWith(":" + removedId));
    }

    if (!buttonsNode.config.buttons.length) {
      removeNodesOfType(branch, "send_buttons");
      branch.children = [];
    }

    markDirty();
    renderBranchBoard();
    renderSimulation();
    renderStatusMeta();
  }

  function handleComposerButtonText(branchId, buttonIndex, value) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    const buttonsNode = branch.nodes.find((n) => n.type === "send_buttons");
    if (!buttonsNode || !Array.isArray(buttonsNode.config.buttons)) return;
    const btn = buttonsNode.config.buttons[buttonIndex];
    if (!btn) return;
    btn.text = String(value || "").slice(0, 20);

    // Update child branch label
    if (Array.isArray(branch.children)) {
      const child = branch.children.find((c) => c.id.endsWith(":" + btn.id));
      if (child) {
        child.label = btn.text;
        if (child.match) child.match.value = btn.text;
      }
    }
    markDirty();
    renderSimulation();
    renderStatusMeta();
  }

  function handleComposerRemoveImage(branchId) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    removeNodesOfType(branch, "send_image");
    markDirty();
    renderBranchBoard();
    renderSimulation();
  }

  async function handleComposerImageUpload(branchId, file) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    if (!file) return;

    const maxMb = 10;
    if (file.size > maxMb * 1024 * 1024) {
      setStatus(`Imagem muito grande. Maximo ${maxMb}MB.`, "danger");
      return;
    }

    setStatus("Enviando imagem...", "info");
    try {
      const formData = new FormData();
      const selectedTemplate = getTemplateById(state.selectedTemplateId);
      formData.append("image", file);
      if (state.selectedTemplateId) formData.append("templateId", state.selectedTemplateId);
      if (selectedTemplate?.name) formData.append("templateName", selectedTemplate.name);
      if (state.currentItem?.id) formData.append("flowId", state.currentItem.id);
      const data = await authFetch("/api/disparador/media/upload", {
        method: "POST",
        body: formData,
      });
      if (!data.file || !data.file.url) throw new Error(data.error?.message || "Falha no upload.");

      const fullUrl = (window.API_BASE || "") + data.file.url;
      const imgNode = ensureNodeOfType(branch, "send_image");
      imgNode.config.imageUrl = fullUrl;
      markDirty();
      renderBranchBoard();
      renderSimulation();
      setStatus("Imagem carregada!", "success");
    } catch (err) {
      setStatus("Erro ao carregar imagem: " + (err.message || "tente novamente"), "danger");
    }
  }

  function updateNodeField(nodeId, fieldPath, rawValue, inputType) {
    const location = getNodeLocation(nodeId);
    if (!location || !location.node) return;
    const node = location.node;

    if (fieldPath === "type") {
      const nextType = String(rawValue || "");
      if (!nextType || nextType === node.type) return;
      const defaults = getNodeDefault(nextType);
      node.type = nextType;
      node.title = defaults.title;
      node.config = defaults.config;
      markDirty();
      renderBranchBoard();
      renderSimulation();
      renderStatusMeta();
      return;
    }

    setDeepValue(node, fieldPath, inputType === "checkbox" ? !!rawValue : rawValue);
    markDirty();
    renderSimulation();
    renderStatusMeta();
  }

  async function loadTemplatesAndSummaries() {
    state.loadingTemplates = true;
    renderTemplateList();

    try {
      const [templatesResponse, flowResponse] = await Promise.all([
        authFetch("/api/disparador/templates"),
        authFetch("/api/disparador/template-flows"),
      ]);

      let templates = Array.isArray(templatesResponse.items) ? templatesResponse.items : [];
      if (!state.syncingMetaTemplates && needsMetaTemplateBackfill(templates)) {
        state.syncingMetaTemplates = true;
        try {
          const syncResponse = await authFetch("/api/disparador/templates/sync-from-meta", { method: "POST" });
          templates = Array.isArray(syncResponse.items) ? syncResponse.items : templates;
          setStatus("Templates sincronizados com a Meta.", "info");
        } catch (_) {
          // Fail soft: the local list still renders, but may keep templates without buttons.
        } finally {
          state.syncingMetaTemplates = false;
        }
      }

      state.templates = templates;
      state.flowSummaries = new Map(
        (Array.isArray(flowResponse.items) ? flowResponse.items : []).map((item) => [item.templateId, item]),
      );
      setStatus("Templates carregados.", "success");
    } catch (err) {
      setStatus(err.message || "Falha ao carregar templates.", "danger");
      templateDropdownEl.innerHTML = `<option value="">${esc(err.message || "Falha ao carregar templates.")}</option>`;
    } finally {
      state.loadingTemplates = false;
      renderTemplateList();
    }
  }

  async function selectTemplate(templateId, options) {
    const opts = options || {};
    if (!templateId) return;
    if (state.selectedTemplateId === templateId && state.draft && !opts.force) return;

    if (state.dirty && !opts.skipDirtyConfirm) {
      const proceed = await window.OdUi.uiConfirm("Existem alterações não salvas. Deseja descartar e trocar de template?", { title: "Descartar alterações?", okLabel: "Descartar" });
      if (!proceed) return;
    }

    state.selectedTemplateId = templateId;
  syncTemplateQuery(templateId);
    state.loadingFlow = true;
    state.currentItem = null;
    state.draft = null;
    renderAll();

    const requestSeq = state.flowRequestSeq + 1;
    state.flowRequestSeq = requestSeq;

    try {
      const response = await authFetch(`/api/disparador/template-flows/by-template/${encodeURIComponent(templateId)}`);
      if (requestSeq !== state.flowRequestSeq) return;

      state.currentItem = response.item;
      state.draft = clone(response.item.currentDraft);
      state.dirty = false;
      state.selectedBranchId = state.draft.branches[0]?.id || "";
      setStatus("Fluxo carregado.", "success");
    } catch (err) {
      if (requestSeq !== state.flowRequestSeq) return;
      setStatus(err.message || "Falha ao carregar fluxo.", "danger");
    } finally {
      if (requestSeq === state.flowRequestSeq) {
        state.loadingFlow = false;
        renderAll();
      }
    }
  }

  function addNodeToBranch(branchId, type) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    branch.nodes.push(buildNode(type));
    state.selectedBranchId = branchId;
    markDirty("Etapa adicionada ao fluxo.");
    renderBranchBoard();
    renderSimulation();
    renderStatusMeta();
  }

  function removeNode(branchId, nodeId) {
    const branch = getBranchById(branchId);
    if (!branch) return;
    const nextNodes = branch.nodes.filter((node) => node.id !== nodeId);
    if (nextNodes.length === branch.nodes.length) return;
    branch.nodes = nextNodes;
    state.selectedBranchId = branchId;
    markDirty("Etapa removida do fluxo.");
    renderBranchBoard();
    renderSimulation();
    renderStatusMeta();
  }

  function moveNode(sourceBranchId, nodeId, targetBranchId, targetIndex) {
    const source = getBranchById(sourceBranchId);
    const target = getBranchById(targetBranchId);
    if (!source || !target) return;

    const sourceIndex = source.nodes.findIndex((node) => node.id === nodeId);
    if (sourceIndex < 0) return;

    const movingNode = source.nodes[sourceIndex];
    source.nodes.splice(sourceIndex, 1);

    let insertIndex = Math.max(0, Math.min(target.nodes.length, Number(targetIndex || 0)));
    if (sourceBranchId === targetBranchId && sourceIndex < insertIndex) {
      insertIndex -= 1;
    }

    target.nodes.splice(insertIndex, 0, movingNode);
    state.selectedBranchId = targetBranchId;
    markDirty("Etapa reordenada.");
    renderBranchBoard();
    renderSimulation();
    renderStatusMeta();
  }

  function handleTemplateDropdownChange() {
    const templateId = templateDropdownEl.value;
    if (templateId) {
      selectTemplate(templateId);
    }
  }

  function isInteractiveTarget(target) {
    return Boolean(target.closest("button, input, select, textarea, option, label"));
  }

  function handleCanvasTopClick(event) {
    if (event.target.id === "btnAddManualBranch") {
      addManualBranch();
      return;
    }
    const selector = event.target.closest("[data-select-branch-id]");
    if (selector) {
      state.selectedBranchId = selector.dataset.selectBranchId || "";
      renderCanvasTop();
      renderBranchBoard();
      renderSimulation();
      renderStatusMeta();
    }
  }

  function handleSideRailClick(event) {
    const toggle = event.target.closest("[data-toggle-panel]");
    if (!toggle) return;
    toggleDrawer(toggle.dataset.togglePanel || "");
  }

  function handleBranchBoardClick(event) {
        const actionsToggle = event.target.closest(".composer-actions-toggle");
        if (actionsToggle) {
          const bid = actionsToggle.dataset.actionsCollapseBranchId;
          if (bid) {
            if (state.expandedActionSections.has(bid)) {
              state.expandedActionSections.delete(bid);
            } else {
              state.expandedActionSections.add(bid);
            }
            renderBranchBoard();
          }
          return;
        }

    // Tab click
    const tabBtn = event.target.closest(".branch-tab");
    if (tabBtn) {
      state.selectedBranchId = tabBtn.dataset.tabBranchId || "";
      renderBranchBoard();
      renderSimulation();
      renderStatusMeta();
      return;
    }

    // Collapse/expand card
    const collapseBtn = event.target.closest(".composer-collapse-btn");
    if (collapseBtn) {
      const bid = collapseBtn.dataset.collapseBranchId;
      if (bid) {
        if (state.collapsedBranches.has(bid)) {
          state.collapsedBranches.delete(bid);
        } else {
          state.collapsedBranches.add(bid);
        }
        renderBranchBoard();
      }
      return;
    }

    // Composer: add button
    const addBtnEl = event.target.closest("[data-composer-action='add-button']");
    if (addBtnEl) {
      handleComposerAddButton(addBtnEl.dataset.branchId);
      return;
    }

    // Composer: remove button
    const removeBtnEl = event.target.closest(".composer-remove-button");
    if (removeBtnEl) {
      handleComposerRemoveButton(removeBtnEl.dataset.branchId, parseInt(removeBtnEl.dataset.removeButtonIndex, 10));
      return;
    }

    // Composer: remove image
    const removeImgEl = event.target.closest("[data-composer-action='remove-image']");
    if (removeImgEl) {
      handleComposerRemoveImage(removeImgEl.dataset.branchId);
      return;
    }

    // Composer: click on image area to trigger file input
    const imgArea = event.target.closest(".composer-image-area");
    if (imgArea && !event.target.closest(".composer-image-remove") && !event.target.closest("input[type='file']")) {
      const fileInput = imgArea.querySelector(".composer-image-input");
      if (fileInput) fileInput.click();
      return;
    }

    // Legacy: add node button
    const addButton = event.target.closest(".add-node-btn");
    if (addButton) {
      const branchId = addButton.dataset.branchId || "";
      const select = Array.from(branchBoardEl.querySelectorAll(".add-node-select"))
        .find((element) => element.dataset.branchId === branchId);
      addNodeToBranch(branchId, select ? select.value : "send_text");
      return;
    }

    const deleteNodeButton = event.target.closest(".delete-node-btn");
    if (deleteNodeButton) {
      removeNode(deleteNodeButton.dataset.branchId || "", deleteNodeButton.dataset.nodeId || "");
      return;
    }

    const deleteBranchButton = event.target.closest(".remove-branch-btn");
    if (deleteBranchButton) {
      removeManualBranch(deleteBranchButton.dataset.branchId || "");
      return;
    }

    if (isInteractiveTarget(event.target)) return;

    const branchComposer = event.target.closest(".branch-composer");
    if (branchComposer) {
      state.selectedBranchId = branchComposer.dataset.branchId || "";
      renderBranchBoard();
      renderSimulation();
      renderStatusMeta();
    }
  }

  function handleBranchBoardInput(event) {
    const target = event.target;
    if (!target) return;
    if (target.tagName === "SELECT" || target.type === "checkbox") return;

    const value = target.value;

    // Composer field inputs
    if (target.dataset.branchId && target.dataset.composerField) {
      handleComposerFieldChange(target.dataset.branchId, target.dataset.composerField, value);
      return;
    }
    // Composer button text inputs
    if (target.dataset.branchId && target.dataset.composerButtonIndex !== undefined) {
      handleComposerButtonText(target.dataset.branchId, parseInt(target.dataset.composerButtonIndex, 10), value);
      return;
    }
    // Legacy branch field inputs
    if (target.dataset.branchId && target.dataset.branchField) {
      updateBranchField(target.dataset.branchId, target.dataset.branchField, value, target.type);
      return;
    }
    if (target.dataset.nodeId && target.dataset.nodeField) {
      updateNodeField(target.dataset.nodeId, target.dataset.nodeField, value, target.type);
    }
  }

  function handleBranchBoardChange(event) {
    const target = event.target;
    if (!target) return;

    // Composer image upload
    if (target.type === "file" && target.dataset.composerUpload === "image") {
      const branchId = target.dataset.branchId;
      const file = target.files && target.files[0];
      if (branchId && file) handleComposerImageUpload(branchId, file);
      target.value = "";
      return;
    }
    if (target.type === "file") return;

    // Composer toggles
    if (target.type === "checkbox" && target.dataset.composerToggle) {
      handleComposerToggle(target.dataset.branchId, target.dataset.composerToggle, target.checked);
      return;
    }

    // Composer select fields
    if (target.dataset.composerField && target.dataset.branchId) {
      handleComposerFieldChange(target.dataset.branchId, target.dataset.composerField, target.value);
      return;
    }

    const value = target.type === "checkbox" ? target.checked : target.value;

    if (target.dataset.branchId && target.dataset.branchField) {
      updateBranchField(target.dataset.branchId, target.dataset.branchField, value, target.type);
      renderBranchBoard();
      return;
    }
    if (target.dataset.nodeId && target.dataset.nodeField) {
      updateNodeField(target.dataset.nodeId, target.dataset.nodeField, value, target.type);
      if (target.dataset.nodeField !== "type") {
        renderSimulation();
      }
    }
  }

  function handleSettingsInput(event) {
    const target = event.target;
    if (!target || !target.name) return;
    if (target.tagName === "SELECT" || target.type === "checkbox") return;
    updateSettingsField(target.name, target.value, target.type);
  }

  function handleSettingsChange(event) {
    const target = event.target;
    if (!target || !target.name) return;
    const value = target.type === "checkbox" ? target.checked : target.value;
    updateSettingsField(target.name, value, target.type);
  }

  function clearDropIndicators() {
    branchBoardEl.querySelectorAll(".is-over").forEach((element) => {
      element.classList.remove("is-over");
    });
  }

  function handleDragStart(event) {
    const handle = event.target.closest(".drag-node-handle");
    if (!handle) return;
    const branchId = handle.dataset.branchId || "";
    const nodeId = handle.dataset.nodeId || "";
    const card = Array.from(branchBoardEl.querySelectorAll(".flow-node"))
      .find((element) => element.dataset.nodeId === nodeId);
    if (!branchId || !nodeId || !card) return;

    state.dragNode = { branchId, nodeId };
    card.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", nodeId);
    }
  }

  function handleDragOver(event) {
    if (!state.dragNode) return;

    const dropNode = event.target.closest(".flow-node");
    const dropList = event.target.closest(".node-list");
    if (!dropNode && !dropList) return;

    event.preventDefault();
    clearDropIndicators();

    if (dropNode) {
      dropNode.classList.add("is-over");
    } else if (dropList) {
      dropList.classList.add("is-over");
    }
  }

  function handleDrop(event) {
    if (!state.dragNode) return;

    const dropNode = event.target.closest(".flow-node");
    const dropList = event.target.closest(".node-list");
    if (!dropNode && !dropList) return;

    event.preventDefault();
    clearDropIndicators();

    const targetBranchId = dropNode ? dropNode.dataset.branchId : dropList.dataset.branchId;
    const targetIndex = dropNode
      ? Number(dropNode.dataset.nodeIndex || 0)
      : (getBranchById(targetBranchId)?.nodes.length || 0);

    moveNode(state.dragNode.branchId, state.dragNode.nodeId, targetBranchId, targetIndex);
  }

  function handleDragEnd() {
    state.dragNode = null;
    clearDropIndicators();
    branchBoardEl.querySelectorAll(".flow-node.is-dragging").forEach((element) => {
      element.classList.remove("is-dragging");
    });
  }

  function buildSnapshotSavePayload() {
    const draft = state.draft && typeof state.draft === "object" ? state.draft : {};
    const payload = {
      branches: Array.isArray(draft.branches) ? draft.branches : [],
      settings: draft.settings && typeof draft.settings === "object" ? draft.settings : {},
      notes: String(draft.notes || ""),
    };
    // Force a plain JSON-safe payload and strip derived/template-only fields.
    return JSON.parse(JSON.stringify(payload));
  }

  async function saveDraft(options) {
    if (!state.selectedTemplateId || !state.draft || state.saving) return false;

    state.saving = true;
    renderCanvasTop();
    setStatus("Salvando rascunho...", "info");

    try {
      const response = await authFetch(`/api/disparador/template-flows/by-template/${encodeURIComponent(state.selectedTemplateId)}`, {
        method: "PUT",
        body: { snapshot: buildSnapshotSavePayload() },
      });

      state.currentItem = response.item;
      state.draft = clone(response.item.currentDraft);
      state.dirty = false;
      state.flowSummaries.set(state.selectedTemplateId, response.summary);
      renderAll();
      if (!options || options.silent !== true) {
        setStatus("Rascunho salvo.", "success");
      }
      return true;
    } catch (err) {
      setStatus(err.message || "Falha ao salvar rascunho.", "danger");
      return false;
    } finally {
      state.saving = false;
      renderCanvasTop();
    }
  }

  async function publishFlow() {
    if (!state.selectedTemplateId || state.publishing) return;

    if (state.dirty) {
      const saved = await saveDraft({ silent: true });
      if (!saved) return;
    }

    state.publishing = true;
    renderCanvasTop();
    setStatus("Publicando fluxo...", "info");

    try {
      const response = await authFetch(`/api/disparador/template-flows/by-template/${encodeURIComponent(state.selectedTemplateId)}/publish`, {
        method: "POST",
      });

      state.currentItem = response.item;
      state.draft = clone(response.item.currentDraft);
      state.dirty = false;
      state.flowSummaries.set(state.selectedTemplateId, response.summary);
      renderAll();
      setStatus("Fluxo publicado.", "success");
    } catch (err) {
      setStatus(err.message || "Falha ao publicar fluxo.", "danger");
    } finally {
      state.publishing = false;
      renderCanvasTop();
    }
  }

  async function refreshStudio(options) {
    const opts = options || {};
    if (state.dirty && !opts.skipDirtyConfirm) {
      const proceed = await window.OdUi.uiConfirm("Existem alterações não salvas. Deseja atualizar mesmo assim?", { title: "Atualizar mesmo assim?", okLabel: "Atualizar" });
      if (!proceed) return;
    }

    // Forca sincronizacao com Meta antes de recarregar — garante que templates
    // recem-aprovados aparecam no dropdown sem precisar atualizar a pagina.
    try {
      await authFetch("/api/disparador/templates/sync-from-meta", { method: "POST" });
    } catch (syncErr) {
      console.warn("Sync com Meta falhou:", syncErr.message);
    }

    await loadTemplatesAndSummaries();
    if (state.selectedTemplateId) {
      await selectTemplate(state.selectedTemplateId, { force: true, skipDirtyConfirm: true });
      return;
    }

    if (state.templates.length) {
      await selectTemplate(state.templates[0].id, { force: true, skipDirtyConfirm: true });
    } else {
      renderAll();
    }
  }

  async function init() {
    btnReloadTemplates.addEventListener("click", refreshStudio);
    // Permite que outros modulos (ex: painel de templates Meta) disparem reload do dropdown
    window.addEventListener("od-flow-studio:reload-templates", () => {
      refreshStudio({ skipDirtyConfirm: true }).catch(() => {});
    });
    btnSaveDraft.addEventListener("click", () => { saveDraft(); });
    btnPublish.addEventListener("click", publishFlow);
    templateDropdownEl.addEventListener("change", handleTemplateDropdownChange);
    canvasTopEl.addEventListener("click", handleCanvasTopClick);
    branchBoardEl.addEventListener("click", handleBranchBoardClick);
    branchBoardEl.addEventListener("input", handleBranchBoardInput);
    branchBoardEl.addEventListener("change", handleBranchBoardChange);
    branchBoardEl.addEventListener("dragstart", handleDragStart);
    branchBoardEl.addEventListener("dragover", handleDragOver);
    branchBoardEl.addEventListener("drop", handleDrop);
    branchBoardEl.addEventListener("dragend", handleDragEnd);
    inspectorPanelEl.addEventListener("input", handleSettingsInput);
    inspectorPanelEl.addEventListener("change", handleSettingsChange);
    sideRailEl.addEventListener("click", handleSideRailClick);

    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "SMART_REFRESH") {
        refreshStudio();
      }
    });

    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveDraft();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });

    setStatus("Carregando OD Flow Studio...", "info");
    await loadTemplatesAndSummaries();
    if (state.templates.length) {
      const requestedTemplateId = getRequestedTemplateId();
      const initialTemplateId = state.templates.some(item => item.id === requestedTemplateId)
        ? requestedTemplateId
        : state.templates[0].id;
      await selectTemplate(initialTemplateId, { force: true, skipDirtyConfirm: true });
    } else {
      renderAll();
      setStatus("Nenhum template disponível para configurar.", "warn");
    }
  }

  init().catch((err) => {
    setStatus(err.message || "Falha ao iniciar o OD Flow Studio.", "danger");
  });
})();

// ═══════════════════════════════════════════════════════════════════
//  Painel de Criação de Templates (Meta WhatsApp)
//  Independente do estado principal do Flow Studio.
// ═══════════════════════════════════════════════════════════════════
(function initMetaTemplatesPanel() {
  "use strict";

  const API = window.API_BASE || "";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const panel = $("#templatesPanel");
  const overlay = $("#templatesOverlay");
  const btnOpen = $("#btnTemplatesPanel");
  const btnClose = $("#btnCloseTemplates");
  if (!panel || !btnOpen) return;

  const tabs = $$("[data-tpl-tab]", panel);
  const views = $$("[data-tpl-view]", panel);
  const listContainer = $("#tplListContainer");
  const tplSearch = $("#tplSearch");
  const tplStatusFilter = $("#tplStatusFilter");
  const btnReload = $("#btnReloadMetaTemplates");
  const form = $("#tplCreateForm");
  const headerTypeSel = $("#tplHeaderType");
  const headerFile = $("#tplHeaderFile");
  const headerHandleInput = form?.elements?.headerMediaHandle;
  const headerUrlInput = form?.elements?.headerMediaUrl;
  const uploadStatus = $("#tplHeaderUploadStatus");
  const bodyInput = $("#tplBody");
  const bodyCounter = $("#tplBodyCounter");
  const bodyExamplesBox = $("#tplBodyExamples");
  const btnInsertVar = $("#btnInsertVar");
  const buttonsList = $("#tplButtonsList");
  const btnCancelTpl = $("#btnCancelTpl");
  const previewBubble = $("#tplPreviewBubble");
  const previewHeader = $("#tplPreviewHeader");
  const previewBody = $("#tplPreviewBody");
  const previewFooter = $("#tplPreviewFooter");
  const previewButtons = $("#tplPreviewButtons");

  let cachedTemplates = [];
  let openState = false;
  let headerMediaPreviewUrl = null; // ObjectURL para limpar quando trocar arquivo

  function setOpen(open) {
    openState = !!open;
    panel.hidden = !openState;
    overlay.hidden = !openState;
    panel.setAttribute("aria-hidden", openState ? "false" : "true");
    btnOpen.setAttribute("aria-expanded", openState ? "true" : "false");
    document.body.classList.toggle("has-templates-panel", openState);
    if (openState) loadTemplates();
  }

  function setActiveTab(tabName) {
    tabs.forEach((t) => {
      const active = t.dataset.tplTab === tabName;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    views.forEach((v) => {
      v.classList.toggle("is-active", v.dataset.tplView === tabName);
    });
  }

  async function apiFetch(url, options = {}) {
    const token = localStorage.getItem("adminToken") || "";
    const headers = Object.assign({}, options.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${url}`, {
      ...options,
      headers,
      credentials: "include",
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401) {
      try { window.parent.postMessage({ type: "LOGOUT_REQUEST" }, "*"); } catch (_) {}
      throw new Error("Sessao expirada. Faca login novamente.");
    }
    if (!res.ok) {
      // Surface real Meta Graph API sub-error when present
      const metaErr = data && data.meta && data.meta.error;
      const metaMsg = metaErr && (metaErr.error_user_msg || metaErr.message);
      const metaSub = metaErr && (metaErr.error_user_title || metaErr.type);
      const base = (data && (data.error || data.message)) || `Erro ${res.status}`;
      const msg = metaMsg ? `${base} — ${metaSub ? `[${metaSub}] ` : ""}${metaMsg}` : base;
      throw new Error(msg);
    }
    return data;
  }

  async function loadTemplates({ force = false } = {}) {
    listContainer.innerHTML = '<div class="empty-card">Carregando templates...</div>';
    try {
      const url = force ? "/api/meta/templates?force=1" : "/api/meta/templates";
      const res = await apiFetch(url);
      cachedTemplates = Array.isArray(res?.data) ? res.data : [];
      renderList();
      updateRateLimitBadge(res);
    } catch (err) {
      listContainer.innerHTML = `<div class="empty-card error">Falha ao carregar: ${escapeHtml(err.message)}</div>`;
    }
  }

  function updateRateLimitBadge(res) {
    const badge = document.getElementById("tplCacheBadge");
    if (!badge) return;
    if (res && res.cached) {
      const ageS = Math.round((res.ageMs || 0) / 1000);
      badge.textContent = `cache ${ageS}s`;
      badge.title = "Lista veio do cache do servidor (TTL 30s). Clique em Atualizar para forcar refresh.";
      badge.hidden = false;
    } else if (res) {
      badge.textContent = "ao vivo";
      badge.title = "Dados recem-buscados na Meta.";
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ──────────────────────────────────────────────────────────────
  // UI Notification system (replaces native alert/confirm)
  // ──────────────────────────────────────────────────────────────
  function ensureNotifyRoot() {
    let root = document.getElementById("odNotifyRoot");
    if (root) return root;
    root = document.createElement("div");
    root.id = "odNotifyRoot";
    document.body.appendChild(root);
    return root;
  }

  /** Toast leve no canto (auto-dismiss). */
  function showToast(message, { type = "info", duration = 4000 } = {}) {
    const root = ensureNotifyRoot();
    let stack = root.querySelector(".od-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "od-toast-stack";
      root.appendChild(stack);
    }
    const toast = document.createElement("div");
    toast.className = `od-toast od-toast--${type}`;
    toast.innerHTML = `<span class="od-toast__msg">${escapeHtml(message)}</span><button class="od-toast__close" aria-label="Fechar">&times;</button>`;
    stack.appendChild(toast);
    const close = () => { toast.classList.add("is-leaving"); setTimeout(() => toast.remove(), 200); };
    toast.querySelector(".od-toast__close").addEventListener("click", close);
    if (duration > 0) setTimeout(close, duration);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
  }

  /**
   * Modal centralizado tipo alert/confirm.
   * @returns Promise<boolean> true se OK, false se cancelar.
   */
  function showDialog({ title = "Aviso", message = "", okLabel = "OK", cancelLabel = null, type = "info" } = {}) {
    return new Promise((resolve) => {
      const root = ensureNotifyRoot();
      const backdrop = document.createElement("div");
      backdrop.className = "od-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="od-dialog od-dialog--${type}" role="dialog" aria-modal="true">
          <header class="od-dialog__head"><h3>${escapeHtml(title)}</h3></header>
          <div class="od-dialog__body">${escapeHtml(message)}</div>
          <footer class="od-dialog__foot">
            ${cancelLabel ? `<button type="button" class="od-dialog__btn od-dialog__btn--ghost" data-act="cancel">${escapeHtml(cancelLabel)}</button>` : ""}
            <button type="button" class="od-dialog__btn od-dialog__btn--primary" data-act="ok">${escapeHtml(okLabel)}</button>
          </footer>
        </div>`;
      root.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add("is-visible"));
      const close = (val) => {
        backdrop.classList.remove("is-visible");
        setTimeout(() => backdrop.remove(), 180);
        resolve(val);
      };
      backdrop.addEventListener("click", (ev) => {
        if (ev.target === backdrop && cancelLabel) close(false);
        const btn = ev.target.closest("[data-act]");
        if (!btn) return;
        close(btn.dataset.act === "ok");
      });
      const okBtn = backdrop.querySelector("[data-act='ok']");
      okBtn && okBtn.focus();
      const keyHandler = (ev) => {
        if (ev.key === "Escape" && cancelLabel) { close(false); document.removeEventListener("keydown", keyHandler); }
        if (ev.key === "Enter") { close(true); document.removeEventListener("keydown", keyHandler); }
      };
      document.addEventListener("keydown", keyHandler);
    });
  }

  function uiAlert(message, opts = {}) {
    return showDialog({ title: opts.title || "Aviso", message, okLabel: "OK", type: opts.type || "info" });
  }
  function uiConfirm(message, opts = {}) {
    return showDialog({
      title: opts.title || "Confirmar",
      message,
      okLabel: opts.okLabel || "Confirmar",
      cancelLabel: opts.cancelLabel || "Cancelar",
      type: opts.type || "warn",
    });
  }
  // Expose globally so the second IIFE (template builder) can use them too
  window.OdUi = { showToast, showDialog, uiAlert, uiConfirm };

  function statusTone(status) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED") return "approved";
    if (s === "REJECTED") return "rejected";
    if (s === "PAUSED" || s === "DISABLED") return "paused";
    return "pending";
  }

  function renderList() {
    const term = (tplSearch.value || "").toLowerCase().trim();
    const statusF = tplStatusFilter.value || "";
    const filtered = cachedTemplates.filter((t) => {
      if (term && !String(t.name || "").toLowerCase().includes(term)) return false;
      if (statusF && String(t.status || "").toUpperCase() !== statusF) return false;
      return true;
    });
    if (!filtered.length) {
      listContainer.innerHTML = '<div class="empty-card">Nenhum template encontrado.</div>';
      return;
    }
    listContainer.innerHTML = filtered.map((t) => {
      const tone = statusTone(t.status);
      const lang = escapeHtml(t.language || "");
      const cat = escapeHtml(t.category || "");
      const name = escapeHtml(t.name || "");
      const reason = t.rejected_reason ? `<small class="muted-small">Motivo: ${escapeHtml(t.rejected_reason)}</small>` : "";
      return `
        <article class="template-card" data-tpl-id="${escapeHtml(t.id)}" data-tpl-name="${name}">
          <header class="template-card-head">
            <h3>${name}</h3>
            <span class="template-status-pill is-${tone}">${escapeHtml(t.status || "—")}</span>
          </header>
          <p class="template-card-meta">${cat} · ${lang}</p>
          ${reason}
          <footer class="template-card-foot">
            <button type="button" class="btn btn-ghost btn-small" data-tpl-action="delete">Remover</button>
          </footer>
        </article>
      `;
    }).join("");
  }

  listContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-tpl-action='delete']");
    if (!btn) return;
    const card = btn.closest(".template-card");
    const name = card?.dataset.tplName;
    if (!name) return;
    const ok = await window.OdUi.uiConfirm(`Remover o template "${name}" da Meta? Esta ação não pode ser desfeita.`, { title: "Remover template", okLabel: "Remover", type: "danger" });
    if (!ok) return;
    btn.disabled = true;
    try {
      await apiFetch(`/api/meta/templates/${encodeURIComponent(name)}`, { method: "DELETE" });
      window.OdUi.showToast(`Template "${name}" removido.`, { type: "success" });
      await loadTemplates({ force: true });
    } catch (err) {
      window.OdUi.uiAlert(err.message, { title: "Falha ao remover", type: "danger" });
      btn.disabled = false;
    }
  });

  tplSearch.addEventListener("input", renderList);
  tplStatusFilter.addEventListener("change", renderList);
  btnReload.addEventListener("click", () => loadTemplates({ force: true }));

  // ── Tabs
  tabs.forEach((t) => t.addEventListener("click", () => setActiveTab(t.dataset.tplTab)));

  // ── Header type toggle
  function syncHeaderFields() {
    const type = headerTypeSel.value;
    $$(".header-field", panel).forEach((el) => { el.hidden = true; });
    if (type === "text") {
      $('[data-header-when="text"]', panel).hidden = false;
    } else if (type === "image" || type === "video" || type === "document") {
      $('[data-header-when="media"]', panel).hidden = false;
      const accept = type === "image" ? "image/jpeg,image/png"
        : type === "video" ? "video/mp4,video/3gpp"
        : ".pdf,application/pdf";
      headerFile.setAttribute("accept", accept);
    }
    updatePreview();
  }
  headerTypeSel.addEventListener("change", () => {
    headerHandleInput.value = "";
    headerFile.value = "";
    uploadStatus.hidden = true;
    if (headerMediaPreviewUrl) {
      try { URL.revokeObjectURL(headerMediaPreviewUrl); } catch (_) {}
      headerMediaPreviewUrl = null;
    }
    syncHeaderFields();
  });

  headerFile.addEventListener("change", async () => {
    const file = headerFile.files && headerFile.files[0];
    if (!file) return;
    // libera URL anterior
    if (headerMediaPreviewUrl) {
      try { URL.revokeObjectURL(headerMediaPreviewUrl); } catch (_) {}
      headerMediaPreviewUrl = null;
    }
    // gera preview local imediato
    headerMediaPreviewUrl = URL.createObjectURL(file);
    updatePreview();
    uploadStatus.hidden = false;
    uploadStatus.textContent = "Enviando arquivo para a Meta...";
    uploadStatus.className = "upload-status is-info";
    try {
      // Upload duplo: 1) Resumable Upload Meta (handle p/ aprovacao) 2) Storage publico (URL p/ envio).
      const fd1 = new FormData(); fd1.append("file", file);
      const fd2 = new FormData(); fd2.append("image", file);
      const token = localStorage.getItem("adminToken") || "";
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      const [resMeta, resPublic] = await Promise.all([
        fetch(`${API}/api/meta/templates/upload-media`, {
          method: "POST", credentials: "include", headers: authHeaders, body: fd1,
        }),
        fetch(`${API}/api/disparador/media/upload`, {
          method: "POST", credentials: "include", headers: authHeaders, body: fd2,
        }),
      ]);
      const dataMeta = await resMeta.json().catch(() => ({}));
      const dataPublic = await resPublic.json().catch(() => ({}));
      if (!resMeta.ok || !dataMeta?.data?.handle) {
        throw new Error(dataMeta?.error || `Erro Meta upload ${resMeta.status}`);
      }
      if (!resPublic.ok || !dataPublic?.file?.url) {
        throw new Error(dataPublic?.error?.message || dataPublic?.error || `Erro storage upload ${resPublic.status}`);
      }
      headerHandleInput.value = dataMeta.data.handle;
      // URL absoluta para a Meta conseguir baixar a imagem ao enviar.
      const publicPath = dataPublic.file.url;
      const absoluteUrl = publicPath.startsWith("http") ? publicPath : `${API}${publicPath}`;
      if (headerUrlInput) headerUrlInput.value = absoluteUrl;
      uploadStatus.textContent = `Arquivo enviado. Pronto para aprovacao e envio.`;
      uploadStatus.className = "upload-status is-ok";
    } catch (err) {
      uploadStatus.textContent = `Falha no upload: ${err.message}`;
      uploadStatus.className = "upload-status is-error";
      headerHandleInput.value = "";
      if (headerUrlInput) headerUrlInput.value = "";
    }
  });

  // ── Body counter + variable insertion (formato Meta posicional {{1}} - universalmente aceito)
  // Mantemos um mapa local de label amigavel -> indice ({{1}}=nome, {{2}}=cidade) so para UI.
  const positionalLabels = []; // ['nome', 'cidade', ...]
  function variableNames(text) {
    // Detecta named ({{nome}}) - ainda suportado para edicao de templates legados nomeados.
    const names = [];
    const seen = new Set();
    String(text || "").replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => {
      if (!seen.has(name)) { seen.add(name); names.push(name); }
      return _;
    });
    return names;
  }
  function legacyPositionalCount(text) {
    const matches = String(text || "").match(/\{\{\s*\d+\s*\}\}/g) || [];
    const nums = new Set(matches.map((m) => Number(m.replace(/[^\d]/g, ""))));
    return nums.size ? Math.max(...nums) : 0;
  }
  function syncBodyExamples() {
    const names = variableNames(bodyInput.value);
    const positionalCount = legacyPositionalCount(bodyInput.value);
    if (!names.length && !positionalCount) {
      bodyExamplesBox.hidden = true;
      bodyExamplesBox.innerHTML = '<p class="examples-title">Exemplo para cada variável (obrigatório):</p>';
      return;
    }
    bodyExamplesBox.hidden = false;
    const existing = {};
    $$("input[name='bodyExample']", bodyExamplesBox).forEach((i) => {
      const k = i.dataset.varName || i.dataset.varIndex;
      if (k) existing[k] = i.value;
    });
    let html = '<p class="examples-title">Exemplo para cada variável (obrigatório):</p>';
    if (names.length) {
      // Template legado nomeado em edicao
      for (const name of names) {
        html += `<label class="form-label"><span>{{${escapeHtml(name)}}}</span><input type="text" name="bodyExample" data-var-name="${escapeHtml(name)}" value="${escapeHtml(existing[name] || "")}" required /></label>`;
      }
    } else {
      // Padrao novo: posicional {{1}}, {{2}}, mostrando label amigavel quando houver
      for (let i = 1; i <= positionalCount; i++) {
        const friendly = positionalLabels[i - 1] || "";
        const labelText = friendly ? `{{${i}}} — ${friendly}` : `{{${i}}}`;
        html += `<label class="form-label"><span>${escapeHtml(labelText)}</span><input type="text" name="bodyExample" data-var-index="${i}" value="${escapeHtml(existing[i] || "")}" required /></label>`;
      }
    }
    bodyExamplesBox.innerHTML = html;
  }
  bodyInput.addEventListener("input", () => {
    bodyCounter.textContent = `${bodyInput.value.length} / 1024`;
    syncBodyExamples();
    updatePreview();
  });
  btnInsertVar.addEventListener("click", () => {
    // Pergunta um label amigavel (so para identificar visualmente) mas insere {{N}} no body.
    const raw = window.prompt("Como quer chamar essa variável? (apenas para identificar. Ex.: nome, cidade)\n\nO sistema vai inserir {{1}}, {{2}}, ... no padrão da Meta.");
    if (raw === null) return;
    const friendly = String(raw || "").trim().slice(0, 20);
    const next = legacyPositionalCount(bodyInput.value) + 1;
    positionalLabels[next - 1] = friendly || `var${next}`;
    const pos = bodyInput.selectionStart || bodyInput.value.length;
    const before = bodyInput.value.slice(0, pos);
    const after = bodyInput.value.slice(pos);
    bodyInput.value = `${before}{{${next}}}${after}`;
    bodyInput.dispatchEvent(new Event("input"));
    bodyInput.focus();
  });

  form.elements.footerText.addEventListener("input", updatePreview);
  form.elements.headerText?.addEventListener?.("input", updatePreview);

  // ── Buttons repeater
  function buttonsCount() { return $$(".tpl-button-row", buttonsList).length; }
  function addButton(type) {
    if (buttonsCount() >= 10) return;
    const idx = Date.now() + Math.random();
    const row = document.createElement("div");
    row.className = "tpl-button-row";
    row.dataset.btnType = type;
    row.dataset.btnId = String(idx);
    let extras = "";
    if (type === "url") {
      extras = `<label class="form-label"><span>URL</span><input type="url" data-btn-field="url" required placeholder="https://exemplo.com/{{1}}" /></label>
        <label class="form-label"><span>Exemplo de URL completa (obrigatorio se a URL tem variavel)</span><input type="url" data-btn-field="urlExample" placeholder="https://exemplo.com/abc123" /></label>`;
    } else if (type === "phone_number") {
      extras = `<label class="form-label"><span>Telefone (E.164: +5511...)</span><input type="tel" data-btn-field="phoneNumber" required /></label>`;
    } else if (type === "copy_code") {
      extras = `<label class="form-label"><span>Código de exemplo</span><input type="text" data-btn-field="code" required /></label>`;
    }
    const optOutBlock = type === "quick_reply"
      ? `<label class="form-label form-label--inline opt-out-toggle"><input type="checkbox" data-btn-field="isOptOut" /><span>Marcar como botão de saída (opt-out)</span></label>
         <small class="muted-small">A Meta detecta opt-out pelo texto. Ao marcar, sugerimos "Parar promoções". Recomendado para Marketing.</small>`
      : "";
    row.innerHTML = `
      <div class="tpl-button-row-head">
        <strong>${labelForType(type)}</strong>
        <button type="button" class="btn btn-ghost btn-small" data-btn-remove>Remover</button>
      </div>
      ${type !== "copy_code" ? `<label class="form-label"><span>Texto do botão (até 25)</span><input type="text" data-btn-field="text" maxlength="25" required /></label>` : ""}
      ${extras}
      ${optOutBlock}
    `;
    buttonsList.appendChild(row);
    if (type === "quick_reply") {
      const cb = row.querySelector('[data-btn-field="isOptOut"]');
      const txt = row.querySelector('[data-btn-field="text"]');
      cb?.addEventListener("change", () => {
        row.classList.toggle("is-opt-out", cb.checked);
        if (cb.checked && !txt.value.trim()) {
          txt.value = "Parar promoções";
          txt.dispatchEvent(new Event("input", { bubbles: true }));
        }
        updatePreview();
      });
    }
    updatePreview();
  }
  function labelForType(type) {
    return type === "url" ? "Link (URL)"
      : type === "phone_number" ? "Ligar"
      : type === "copy_code" ? "Copiar código"
      : "Resposta rápida";
  }
  $$("[data-add-btn]", panel).forEach((b) => {
    b.addEventListener("click", () => addButton(b.dataset.addBtn));
  });
  buttonsList.addEventListener("click", (e) => {
    if (e.target.matches("[data-btn-remove]")) {
      e.target.closest(".tpl-button-row")?.remove();
      updatePreview();
    }
  });
  buttonsList.addEventListener("input", updatePreview);

  // ── Preview
  function updatePreview() {
    const headerType = headerTypeSel.value;
    const headerText = form.elements.headerText?.value || "";
    if (headerType === "text" && headerText) {
      previewHeader.hidden = false;
      previewHeader.innerHTML = "";
      previewHeader.textContent = headerText;
      previewHeader.className = "tpl-preview-header is-text";
    } else if (headerType === "image" && headerMediaPreviewUrl) {
      previewHeader.hidden = false;
      previewHeader.className = "tpl-preview-header is-media-real";
      previewHeader.innerHTML = `<img src="${headerMediaPreviewUrl}" alt="" />`;
    } else if (headerType === "video" && headerMediaPreviewUrl) {
      previewHeader.hidden = false;
      previewHeader.className = "tpl-preview-header is-media-real";
      previewHeader.innerHTML = `<video src="${headerMediaPreviewUrl}" muted playsinline controls></video>`;
    } else if (headerType === "document" && headerMediaPreviewUrl) {
      previewHeader.hidden = false;
      previewHeader.className = "tpl-preview-header is-media-doc";
      previewHeader.innerHTML = `<div class="doc-thumb">PDF<br/><small>Documento anexado</small></div>`;
    } else if (headerType === "image" || headerType === "video" || headerType === "document") {
      previewHeader.hidden = false;
      previewHeader.innerHTML = "";
      previewHeader.textContent = headerType === "image" ? "[Imagem]"
        : headerType === "video" ? "[Vídeo]" : "[Documento]";
      previewHeader.className = `tpl-preview-header is-media is-${headerType}`;
    } else if (headerType === "location") {
      previewHeader.hidden = false;
      previewHeader.innerHTML = "";
      previewHeader.textContent = "[Localização]";
      previewHeader.className = "tpl-preview-header is-media";
    } else {
      previewHeader.hidden = true;
    }

    const body = bodyInput.value || "Comece a escrever para visualizar...";
    previewBody.textContent = body;

    const footer = form.elements.footerText.value || "";
    if (footer) {
      previewFooter.hidden = false;
      previewFooter.textContent = footer;
    } else {
      previewFooter.hidden = true;
    }

    const btns = collectButtons();
    if (!btns.length) {
      previewButtons.innerHTML = "";
    } else {
      previewButtons.innerHTML = btns.map((b) => {
        const t = escapeHtml(b.text || (b.type === "copy_code" ? "Copiar código" : ""));
        const optOutTag = b.isOptOut ? '<span class="opt-out-tag">opt-out</span>' : "";
        return `<div class="tpl-preview-btn">${t}${optOutTag}</div>`;
      }).join("");
    }
  }

  function collectButtons() {
    return $$(".tpl-button-row", buttonsList).map((row) => {
      const type = row.dataset.btnType;
      const get = (f) => row.querySelector(`[data-btn-field='${f}']`)?.value?.trim() || "";
      const isOptOut = row.querySelector("[data-btn-field='isOptOut']")?.checked === true;
      const obj = { type, text: get("text"), isOptOut };
      if (type === "url") {
        obj.url = get("url");
        const ex = get("urlExample");
        if (ex) obj.urlExamples = [ex];
      }
      if (type === "phone_number") obj.phoneNumber = get("phoneNumber");
      if (type === "copy_code") { obj.code = get("code"); obj.text = "Copiar código"; }
      return obj;
    });
  }

  // ── Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const headerType = headerTypeSel.value;
    const isMedia = headerType === "image" || headerType === "video" || headerType === "document";
    if (isMedia && !headerHandleInput.value) {
      window.OdUi.uiAlert("Envie o arquivo de exemplo do cabeçalho antes de enviar para aprovação.", { title: "Cabeçalho obrigatório", type: "warn" });
      return;
    }
    const exampleInputs = $$("input[name='bodyExample']", bodyExamplesBox);
    const examples = exampleInputs.map((i) => {
      const name = i.dataset.varName || "";
      return name
        ? { name, example: i.value.trim() }
        : i.value.trim();
    });
    const namedVars = variableNames(bodyInput.value);
    const positionalVars = legacyPositionalCount(bodyInput.value);
    const expectedVars = namedVars.length || positionalVars;
    if (expectedVars && exampleInputs.some((i) => !i.value.trim())) {
      window.OdUi.uiAlert("Preencha um exemplo para cada variável do corpo.", { title: "Exemplos obrigatórios", type: "warn" });
      return;
    }
    const payload = {
      name: form.elements.name.value.trim().toLowerCase(),
      language: form.elements.language.value,
      category: form.elements.category.value,
      allowCategoryChange: form.elements.allowCategoryChange.checked,
      headerType,
      headerText: form.elements.headerText?.value || "",
      headerMediaHandle: headerHandleInput.value || "",
      headerMediaUrl: headerUrlInput?.value || "",
      bodyText: bodyInput.value,
      bodyExamples: examples,
      footerText: form.elements.footerText.value || "",
      buttons: collectButtons(),
    };
    const submitBtn = $("#btnSubmitTpl");
    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";
    try {
      await apiFetch("/api/meta/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // Sincroniza com MongoDB para o template aparecer no dropdown principal do Flow Studio
      try {
        await apiFetch("/api/disparador/templates/sync-from-meta", { method: "POST" });
      } catch (syncErr) {
        console.warn("Sync apos criar template falhou:", syncErr.message);
      }
      // Persiste a URL publica da imagem do header (usada no envio de cada mensagem).
      // O sync-from-meta nao traz URL, entao precisamos gravar aqui.
      if (payload.headerType === "image" && payload.headerMediaUrl) {
        try {
          await apiFetch(`/api/disparador/templates/by-name/${encodeURIComponent(payload.name)}/header-media`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ headerMediaUrl: payload.headerMediaUrl }),
          });
        } catch (mediaErr) {
          console.warn("Falha ao persistir URL da imagem do header:", mediaErr.message);
        }
      }
      // Notifica o Flow Studio principal para recarregar o dropdown de templates
      try {
        window.dispatchEvent(new CustomEvent("od-flow-studio:reload-templates"));
      } catch (_) {}
      window.OdUi.showToast("Template enviado para aprovação da Meta.", { type: "success" });
      form.reset();
      headerHandleInput.value = "";
      if (headerMediaPreviewUrl) {
        try { URL.revokeObjectURL(headerMediaPreviewUrl); } catch (_) {}
        headerMediaPreviewUrl = null;
      }
      uploadStatus.hidden = true;
      buttonsList.innerHTML = "";
      bodyExamplesBox.hidden = true;
      bodyCounter.textContent = "0 / 1024";
      syncHeaderFields();
      updatePreview();
      setActiveTab("list");
      await loadTemplates({ force: true });
    } catch (err) {
      window.OdUi.uiAlert(err.message, { title: "Falha ao criar template", type: "danger" });
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar para aprovação";
    }
  });

  btnCancelTpl.addEventListener("click", async () => {
    const okDiscard = await window.OdUi.uiConfirm("Descartar este template?", { title: "Descartar", okLabel: "Descartar" });
    if (!okDiscard) return;
    form.reset();
    headerHandleInput.value = "";
    uploadStatus.hidden = true;
    buttonsList.innerHTML = "";
    bodyExamplesBox.hidden = true;
    bodyCounter.textContent = "0 / 1024";
    syncHeaderFields();
    updatePreview();
    setActiveTab("list");
  });

  // ── Open/close
  btnOpen.addEventListener("click", () => setOpen(!openState));
  btnClose.addEventListener("click", () => setOpen(false));
  overlay.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openState) setOpen(false);
  });

  syncHeaderFields();
  updatePreview();
})();

(function initDispatchesPanel() {
  "use strict";

  const API = window.API_BASE || "";
  const $ = (sel, root = document) => root.querySelector(sel);

  const panel = $("#dispatchesPanel");
  const overlay = $("#dispatchesOverlay");
  const btnOpen = $("#btnDispatchesPanel");
  const btnClose = $("#btnCloseDispatches");
  const btnReload = $("#btnReloadDispatches");
  const btnReloadRecipients = $("#btnReloadRecipients");
  const btnBack = $("#btnDispatchesBack");
  const breadcrumb = $("#dispatchesBreadcrumb");
  const titleEl = $("#dispatchesPanelTitle");
  const listContainer = $("#dispatchesListContainer");
  const recipientsContainer = $("#dispatchesRecipientsContainer");
  const detailHeader = $("#dispatchesDetailHeader");
  const filterStatus = $("#dispatchesFilterStatus");
  const filterReaction = $("#dispatchesFilterReaction");
  const countBadge = $("#dispatchesCount");
  const tplPanel = $("#templatesPanel");
  const tplOverlay = $("#templatesOverlay");
  const btnTplOpen = $("#btnTemplatesPanel");
  if (!panel || !btnOpen) return;

  let openState = false;
  let currentView = "list";
  let currentCampaign = null;

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.valueOf())) return "—";
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function statusLabel(s) {
    const v = String(s || "").toLowerCase();
    if (v === "sent") return "Enviado";
    if (v === "delivered") return "Entregue";
    if (v === "read") return "Lido";
    if (v === "failed") return "Falhou";
    if (v === "simulated") return "Simulado";
    if (v === "done") return "Concluído";
    if (v === "running") return "Em andamento";
    if (v === "pending") return "Pendente";
    return s || "—";
  }

  function statusBadge(s) {
    const v = String(s || "").toLowerCase();
    return `<span class="disp-badge disp-badge--${v}">${escHtml(statusLabel(v))}</span>`;
  }

  function sourceBadge(s) {
    const labels = {
      disparador_campaign: "OD Flow",
      campaign_attention: "Gerenciador",
      drivers_bulk: "Motoristas (Bulk)",
      drivers_individual: "Motoristas",
      overview_bulk: "Overview",
      odchat_manual: "OD Chat",
    };
    const label = labels[s] || s || "";
    return `<span class="disp-badge disp-badge--src">${escHtml(label)}</span>`;
  }

  function setView(view) {
    currentView = view;
    panel.querySelectorAll("[data-disp-view]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.dispView === view);
    });
    breadcrumb.hidden = view !== "detail";
    titleEl.textContent = view === "detail" && currentCampaign
      ? `Disparo: ${currentCampaign.name || ""}`
      : "Lista de Disparos";
  }

  function closeTemplatesPanel() {
    if (tplPanel && !tplPanel.hidden) {
      tplPanel.hidden = true;
      if (tplOverlay) tplOverlay.hidden = true;
      tplPanel.setAttribute("aria-hidden", "true");
      if (btnTplOpen) btnTplOpen.setAttribute("aria-expanded", "false");
      document.body.classList.remove("has-templates-panel");
    }
  }

  function setOpen(open) {
    openState = !!open;
    panel.hidden = !openState;
    overlay.hidden = !openState;
    panel.setAttribute("aria-hidden", openState ? "false" : "true");
    btnOpen.setAttribute("aria-expanded", openState ? "true" : "false");
    document.body.classList.toggle("has-templates-panel", openState);
    if (openState) {
      closeTemplatesPanel();
      setView("list");
      loadDispatches();
    }
  }

  async function apiFetch(url, options = {}) {
    const token = localStorage.getItem("adminToken") || "";
    const headers = Object.assign({}, options.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${url}`, { ...options, headers, credentials: "include" });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401) {
      try { window.parent.postMessage({ type: "LOGOUT_REQUEST" }, "*"); } catch (_) {}
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    if (!res.ok) {
      const msg = (data && (data.error?.message || data.error || data.message)) || `Erro ${res.status}`;
      throw new Error(typeof msg === "string" ? msg : `Erro ${res.status}`);
    }
    return data;
  }

  async function loadDispatches() {
    listContainer.innerHTML = '<div class="empty-card">Carregando disparos...</div>';
    try {
      const res = await apiFetch("/api/disparador/campaigns/dispatches/list");
      const items = Array.isArray(res?.items) ? res.items : [];
      if (countBadge) countBadge.textContent = `${items.length} disparo(s)`;
      renderDispatchesList(items);
    } catch (err) {
      listContainer.innerHTML = `<div class="empty-card">Erro: ${escHtml(err.message)}</div>`;
    }
  }

  function renderDispatchesList(items) {
    if (!items.length) {
      listContainer.innerHTML = '<div class="empty-card">Nenhum disparo encontrado.</div>';
      return;
    }
    const rows = items.map((it) => {
      const t = it.totals || {};
      const launched = it.startedAt || it.scheduledAt || it.createdAt;
      const operator = it.operatorName || (it.operatorId ? "?" : "—");
      return `
        <tr data-disp-id="${escHtml(it.id)}" data-disp-source="${escHtml(it.source || "")}" class="disp-row">
          <td><strong>${escHtml(it.name || "(sem nome)")}</strong></td>
          <td>${sourceBadge(it.source)}</td>
          <td>${statusBadge(it.status)}</td>
          <td>${escHtml(fmtDate(launched))}</td>
          <td>${escHtml(operator)}</td>
          <td class="disp-num">${t.total || 0}</td>
          <td class="disp-num">${t.delivered || 0}</td>
          <td class="disp-num">${t.read || 0}</td>
          <td class="disp-num disp-num--ok">${t.reacted || 0}</td>
          <td class="disp-num disp-num--muted">${t.noReaction || 0}</td>
          <td class="disp-num disp-num--bad">${t.failed || 0}</td>
        </tr>`;
    }).join("");
    listContainer.innerHTML = `
      <table class="disp-table">
        <thead><tr>
          <th>Disparo</th><th>Origem</th><th>Status</th><th>Data</th><th>Por</th>
          <th class="disp-num">Enviados</th><th class="disp-num">Entregues</th><th class="disp-num">Lidos</th>
          <th class="disp-num">Reagiram</th><th class="disp-num">Não reagiram</th><th class="disp-num">Falhas</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    listContainer.querySelectorAll(".disp-row").forEach((row) => {
      row.addEventListener("click", () => openDetail(row.dataset.dispId, items.find((i) => i.id === row.dataset.dispId)));
    });
  }

  async function openDetail(campaignId, campaignSummary) {
    currentCampaign = campaignSummary || { id: campaignId, name: "", source: "" };
    setView("detail");
    detailHeader.innerHTML = '<div class="muted">Carregando...</div>';
    recipientsContainer.innerHTML = '<div class="empty-card">Carregando motoristas...</div>';
    await loadRecipients();
  }

  async function loadRecipients() {
    if (!currentCampaign?.id) return;
    const params = new URLSearchParams();
    if (filterStatus?.value) params.set("deliveryStatus", filterStatus.value);
    if (filterReaction?.value) params.set("reacted", filterReaction.value);
    const qs = params.toString() ? `?${params.toString()}` : "";
    try {
      const res = await apiFetch(`/api/disparador/campaigns/${encodeURIComponent(currentCampaign.id)}/recipients${qs}`);
      renderDetail(res);
    } catch (err) {
      recipientsContainer.innerHTML = `<div class="empty-card">Erro: ${escHtml(err.message)}</div>`;
    }
  }

  function renderDetail(payload) {
    const totals = payload?.totals || {};
    const items = Array.isArray(payload?.items) ? payload.items : [];
    detailHeader.innerHTML = `
      <div class="disp-summary">
        <div><span class="disp-summary-num">${totals.total || 0}</span><span class="disp-summary-label">Total</span></div>
        <div><span class="disp-summary-num">${totals.delivered || 0}</span><span class="disp-summary-label">Entregues</span></div>
        <div><span class="disp-summary-num">${totals.read || 0}</span><span class="disp-summary-label">Lidos</span></div>
        <div><span class="disp-summary-num disp-num--ok">${totals.reacted || 0}</span><span class="disp-summary-label">Reagiram</span></div>
        <div><span class="disp-summary-num disp-num--muted">${totals.noReaction || 0}</span><span class="disp-summary-label">Não reagiram</span></div>
        <div><span class="disp-summary-num disp-num--bad">${totals.failed || 0}</span><span class="disp-summary-label">Falhas</span></div>
      </div>`;
    if (!items.length) {
      recipientsContainer.innerHTML = '<div class="empty-card">Nenhum motorista nesta seleção.</div>';
      return;
    }
    const rows = items.map((r) => {
      const reacted = r.reactedAt ? `<span class="disp-badge disp-badge--ok">Reagiu</span>` : `<span class="disp-badge disp-badge--muted">Sem reação</span>`;
      const button = r.buttonPressed ? escHtml(r.buttonPressed) : "—";
      const step = r.lastFlowStep ? escHtml(r.lastFlowStep) : "—";
      return `
        <tr>
          <td><strong>${escHtml(r.contactName || "—")}</strong></td>
          <td>${escHtml(r.phoneE164 || "—")}</td>
          <td>${statusBadge(r.deliveryStatus)}</td>
          <td>${reacted}</td>
          <td>${button}</td>
          <td>${step}</td>
          <td>${escHtml(fmtDate(r.reactedAt))}</td>
        </tr>`;
    }).join("");
    recipientsContainer.innerHTML = `
      <table class="disp-table">
        <thead><tr>
          <th>Motorista</th><th>Telefone</th><th>Entrega</th>
          <th>Reação</th><th>Botão apertado</th><th>Última etapa</th><th>Reagiu em</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  btnOpen.addEventListener("click", () => setOpen(!openState));
  btnClose.addEventListener("click", () => setOpen(false));
  overlay.addEventListener("click", () => setOpen(false));
  btnReload?.addEventListener("click", loadDispatches);
  btnReloadRecipients?.addEventListener("click", loadRecipients);
  btnBack?.addEventListener("click", () => {
    setView("list"); loadDispatches();
  });
  filterStatus?.addEventListener("change", loadRecipients);
  filterReaction?.addEventListener("change", loadRecipients);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openState) setOpen(false);
  });

  // Quando templates panel abre, fecha o de disparos
  if (btnTplOpen) {
    btnTplOpen.addEventListener("click", () => {
      if (openState) setOpen(false);
    });
  }
})();


