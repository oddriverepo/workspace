// Wizard - Etapa 2: Seleção de Produtos

const isElectron = window.electronAPI && window.electronAPI.isElectron;

if (!isElectron) {
  if (window.notify) {
    window.notify.warning('Ambiente inválido', 'Esta página deve ser executada dentro do aplicativo desktop.');
  }
}

// Produtos disponíveis
const INTERNAL_PRODUCT_ID = 'od-in';
const EXTERNAL_PRODUCT_IDS = ['od-vt', 'od-drop', 'od-pack', 'od-full'];
const ALLOWED_PRODUCT_IDS = [INTERNAL_PRODUCT_ID, ...EXTERNAL_PRODUCT_IDS];

const PRODUCTS = [
  { id: 'od-in', name: 'OD IN', desc: 'Mídia interna instalada no interior do veículo' },
  { id: 'od-vt', name: 'OD VT', desc: 'Mídia externa no vidro traseiro do veículo' },
  { id: 'od-drop', name: 'OD DROP', desc: 'Aplicação nas quatro portas + vidro traseiro' },
  { id: 'od-pack', name: 'OD PACK', desc: 'Quatro portas + vidro traseiro + kits combinados' },
  { id: 'od-full', name: 'OD FULL', desc: 'Cobertura completa: portas, vidro traseiro e capô' }
];

// Estado do wizard
let proposalData = {
  cliente: {},
  comercial: {},
  produtosSelecionados: [],
  impacto: {},
  uploads: {},
  status: 'draft'
};

let selectedProducts = [];
let optionSelections = [];
let currentOptionIndex = 0;
let optionsCount = 1;

function getPersistableDraft() {
  if (window.uploadCache?.sanitizeProposalData) {
    return window.uploadCache.sanitizeProposalData(proposalData);
  }

  const clone = JSON.parse(JSON.stringify(proposalData || {}));
  if (clone.uploads) {
    Object.keys(clone.uploads).forEach((slotId) => {
      const entry = clone.uploads[slotId];
      if (!entry) return;
      delete entry.data;
      delete entry.dataUrl;
      delete entry.previewUrl;
    });
  }

  return clone;
}

// Carregar dados salvos
function loadDraftData() {
  const draft = localStorage.getItem('wizard_draft');
  if (draft) {
    try {
      proposalData = JSON.parse(draft);
      optionsCount = Math.min(4, Math.max(1, proposalData?.comercial?.qtdOrcamentos || 1));
      optionSelections = Array.from({ length: optionsCount }, () => []);
      
      // Restaurar seleÇõÇœes por orÇõamento, se existirem
      if (Array.isArray(proposalData.orcamentos) && proposalData.orcamentos.length) {
        proposalData.orcamentos.forEach((orc, idx) => {
          if (idx >= optionsCount) return;
          const saved = orc?.produtosSelecionados || [];
          optionSelections[idx] = normalizeSelection(saved.map(item => (typeof item === 'string') ? item : item.id).filter(Boolean));
        });
      }
      
      // Normalize saved produtosSelecionados: can be array of ids or array of objects
      const saved = proposalData.produtosSelecionados || [];
      const firstSelection = saved.map(item => {
        if (!item) return null;
        return (typeof item === 'string') ? item : (item.id || null);
      }).filter(Boolean);
      if (!optionSelections[0]?.length && firstSelection.length) {
        optionSelections[0] = normalizeSelection(firstSelection);
      }

      selectedProducts = optionSelections[currentOptionIndex] || [];
      renderOptionTabs();
      updateUI();
    } catch (error) {
      console.error('Erro ao carregar rascunho:', error);
    }
  } else {
    optionsCount = 1;
    optionSelections = [selectedProducts];
    renderOptionTabs();
  }
}

// Atualizar UI com seleções
function updateUI() {
  document.querySelectorAll('.product-card').forEach(card => {
    const productId = card.dataset.product;
    if (selectedProducts.includes(productId)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });

  renderOptionTabs();
  updateSelectionInfo();
}

function renderOptionTabs() {
  const tabs = document.getElementById('options-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';

  for (let i = 0; i < optionsCount; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `option-pill ${i === currentOptionIndex ? 'active' : ''}`;
    btn.dataset.index = i.toString();
    const count = optionSelections[i]?.length || 0;
    const label = count
      ? `${count} produto${count > 1 ? 's' : ''}`
      : 'Selecione produtos';
    btn.innerHTML = `<span class="label">Opção ${i + 1}</span> ${label}`;
    btn.addEventListener('click', () => switchOption(i));
    tabs.appendChild(btn);
  }
}

function switchOption(index) {
  if (index === currentOptionIndex) return;
  optionSelections[currentOptionIndex] = normalizeSelection(selectedProducts);
  currentOptionIndex = index;
  selectedProducts = optionSelections[currentOptionIndex] || [];
  updateUI();
}

// Atualizar informação de seleção
function updateSelectionInfo() {
  const count = selectedProducts.length;
  const infoEl = document.getElementById('selection-info');
  const btnNext = document.getElementById('btn-next');

  if (count === 0) {
    infoEl.innerHTML = `Opção ${currentOptionIndex + 1}/${optionsCount}: Selecione pelo menos 1 produto`;
    btnNext.disabled = true;
  } else {
    infoEl.innerHTML = `Opção ${currentOptionIndex + 1}/${optionsCount}: <strong>${count}</strong> produto${count > 1 ? 's' : ''} selecionado${count > 1 ? 's' : ''}`;
    btnNext.disabled = false;
  }
}

// Toggle de seleção de produto
function toggleProduct(productId) {
  if (!ALLOWED_PRODUCT_IDS.includes(productId)) {
    notify.warning('Produto indisponível', 'Seleção inválida. Atualize a lista e tente novamente.');
    return;
  }

  const index = selectedProducts.indexOf(productId);
  
  if (index > -1) {
    selectedProducts.splice(index, 1);
    optionSelections[currentOptionIndex] = normalizeSelection(selectedProducts);
    updateUI();
    return;
  }

  const nextSelection = [...selectedProducts, productId];
  const validation = validateSelection(nextSelection);

  if (!validation.valid) {
    notify.warning('Combinação não permitida', validation.message);
    return;
  }

  selectedProducts = nextSelection;
  optionSelections[currentOptionIndex] = normalizeSelection(selectedProducts);
  updateUI();
}

function validateSelection(selection) {
  if (selection.length > 2) {
    return { valid: false, message: 'Selecione no máximo dois produtos.' };
  }

  const scenario = getSelectionScenario(selection);
  if (scenario === 'invalid') {
    return {
      valid: false,
      message: 'Você pode escolher apenas OD IN sozinho, um produto externo sozinho ou OD IN + uma mídia externa.'
    };
  }

  return { valid: true };
}

function getSelectionScenario(selection) {
  if (!selection || !selection.length) return 'none';
  const hasInternal = selection.includes(INTERNAL_PRODUCT_ID);
  const externalCount = selection.filter(id => EXTERNAL_PRODUCT_IDS.includes(id)).length;

  if (hasInternal && selection.length === 1) return 'od-in-only';
  if (!hasInternal && selection.length === 1 && externalCount === 1) return 'external-only';
  if (hasInternal && externalCount === 1 && selection.length === 2) return 'combo';

  return 'invalid';
}

// Salvar seleção no proposalData
function saveSelection() {
  // Persist seleções por opção
  optionSelections[currentOptionIndex] = normalizeSelection(selectedProducts);

  const orcamentos = optionSelections.map((selection, idx) => {
    const normalized = normalizeSelection(selection);
    const produtosObjs = normalized.map(id => {
      const product = PRODUCTS.find(p => p.id === id);
      return product ? { id: product.id, name: product.name, desc: product.desc } : null;
    }).filter(Boolean);
    return {
      id: `opcao-${idx + 1}`,
      produtosSelecionados: produtosObjs
    };
  });

  proposalData.orcamentos = orcamentos;
  // compat: manter o primeiro conjunto em produtosSelecionados
  proposalData.produtosSelecionados = orcamentos[0]?.produtosSelecionados || [];
  const scenario = getSelectionScenario(proposalData.produtosSelecionados.map(p => p.id));
  proposalData.templateSelection = scenario;
}

function normalizeSelection(selection) {
  if (!Array.isArray(selection)) return [];
  const normalized = [];

  selection.forEach(id => {
    if (!ALLOWED_PRODUCT_IDS.includes(id)) return;
    if (normalized.includes(id)) return;
    if (normalized.length >= 2) return;
    normalized.push(id);
  });

  if (normalized.length === 2) {
    const hasInternal = normalized.includes(INTERNAL_PRODUCT_ID);
    if (!hasInternal) {
      normalized.pop();
    }
  }

  return normalized;
}

// Salvar rascunho
function saveDraft() {
  saveSelection();
  localStorage.setItem('wizard_draft', JSON.stringify(getPersistableDraft()));
  notify.success('Rascunho salvo', `${selectedProducts.length} produto(s) selecionado(s).`);
}

// Próxima etapa
function nextStep() {
  optionSelections[currentOptionIndex] = normalizeSelection(selectedProducts);
  const emptyIndex = optionSelections.findIndex(sel => !sel || sel.length === 0);
  if (emptyIndex !== -1) {
    notify.warning('Seleção obrigatória', `A opção ${emptyIndex + 1} precisa ter pelo menos 1 produto.`);
    return;
  }
  
  saveSelection();
  localStorage.setItem('wizard_draft', JSON.stringify(getPersistableDraft()));
  
  // Verificar tipo de planilha escolhido no Step1
  if (proposalData.tipoPlanilha === 'editar') {
    // Se escolheu editar, ir para Step3B (editor de planilha)
    window.location.href = 'Step3B-EditarPlanilha.html';
  } else {
    // Se escolheu imagem ou não especificou, ir para Step3 (uploads)
    window.location.href = 'Step3Uploads.html';
  }
}

// Voltar
function goBack() {
  saveSelection();
  localStorage.setItem('wizard_draft', JSON.stringify(getPersistableDraft()));
  window.location.href = 'Step1Dados.html';
}

// Atualizar barra de progresso
function updateProgressBar() {
  const progress = document.querySelector('.wizard-steps-progress');
  // Etapa 2 = 25% (2/5 concluído)
  progress.style.width = '25%';
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadDraftData();
  updateProgressBar();
  updateUI();

  // Click nos cards de produto
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => {
      const productId = card.dataset.product;
      toggleProduct(productId);
    });
  });

  // Botões de navegação
  document.getElementById('btn-next').addEventListener('click', nextStep);
  document.getElementById('btn-save-draft').addEventListener('click', saveDraft);
  document.getElementById('btn-back').addEventListener('click', goBack);

  // Atalhos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveDraft();
    }
  });
});
