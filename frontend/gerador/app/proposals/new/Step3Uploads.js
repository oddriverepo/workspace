// Wizard - Etapa 3: Upload de Imagens

const isElectron = window.electronAPI && window.electronAPI.isElectron;

if (!isElectron) {
  if (window.notify) {
    window.notify.warning('Ambiente inválido', 'Esta página deve ser executada dentro do aplicativo desktop.');
  }
}

// Estado do wizard
let proposalData = {
  cliente: {},
  comercial: {},
  produtosSelecionados: [],
  impacto: {},
  uploads: {},
  status: 'draft'
};

// Slots de upload base
const BASE_SLOTS = [
  { id: 'logo', label: 'Logo do Anunciante', icon: '?Y??', required: true },
  { id: 'mock-lateral', label: 'Mock Lateral (Carro)', icon: '?Ys-', required: true },
  { id: 'mock-mapa', label: 'Mock Frontal', icon: '?Y-????', required: true },
  { id: 'odim', label: 'OD IN', icon: '?Y-????', required: true },
  { id: 'mock-traseiro', label: 'Mock Traseiro', icon: '?Ys-', required: true },
  { id: 'planilha', label: 'Planilha de Or?amento', icon: '?Y"S', required: false } // Opcional se modo editar
];

const EXTERNAL_PRODUCT_IDS = ['od-vt', 'od-drop', 'od-pack', 'od-full'];

const PLACEHOLDER_IMAGES = {
  logo: '../../../assets/upload-placeholders/logo-placeholder.png',
  'mock-lateral': '../../../assets/upload-placeholders/mock-lateral-placeholder.png',
  'mock-mapa': '../../../assets/upload-placeholders/mock-frontal-placeholder.png',
  'mock-traseiro': '../../../assets/upload-placeholders/mock-traseiro-placeholder.png',
  odim: '../../../assets/upload-placeholders/od-in-placeholder.png',
  planilha: '../../../assets/upload-placeholders/planilha-placeholder.png',
  productDefault: '../../../assets/upload-placeholders/product-placeholder.svg'
};

let totalSlots = BASE_SLOTS.length;

function getQtdOrcamentos() {
  const qtd = proposalData?.comercial?.qtdOrcamentos || proposalData?.orcamentos?.length || 1;
  return Math.min(4, Math.max(1, parseInt(qtd, 10) || 1));
}

function getPlanilhaSlotsCount() {
  if (proposalData.tipoPlanilha === 'editar') return 0;
  const qtd = getQtdOrcamentos();
  return qtd > 1 ? qtd : 1;
}

function syncPlanilhaSlots() {
  const baseCard = document.querySelector('[data-slot="planilha"]');
  if (!baseCard) return;

  const qtd = getQtdOrcamentos();
  const usarMultiplas = proposalData.tipoPlanilha !== 'editar' && qtd > 1;

  document.querySelectorAll('[data-slot^="planilha-"]').forEach((card) => card.remove());

  const labelBase = baseCard.querySelector('.upload-card-label');
  if (labelBase) {
    labelBase.textContent = usarMultiplas ? 'Planilha de Orçamento 1' : 'Planilha de Orçamento';
  }

  if (!usarMultiplas) return;

  const parent = baseCard.parentElement;
  let insertAfter = baseCard;

  for (let i = 2; i <= qtd; i += 1) {
    const clone = baseCard.cloneNode(true);
    clone.dataset.slot = `planilha-${i}`;
    clone.classList.remove('has-file', 'from-editor');
    clone.style.display = '';
    const filename = clone.querySelector('.upload-card-filename');
    if (filename) filename.textContent = '';
    const label = clone.querySelector('.upload-card-label');
    if (label) label.textContent = `Planilha de Orçamento ${i}`;
    const badge = clone.querySelector('.editor-badge');
    if (badge) badge.remove();
    parent.insertBefore(clone, insertAfter.nextSibling);
    insertAfter = clone;
  }
}

function getPlaceholderForSlot(slotId) {
  if (slotId && slotId.startsWith('planilha')) {
    return PLACEHOLDER_IMAGES.planilha;
  }
  return PLACEHOLDER_IMAGES[slotId] || PLACEHOLDER_IMAGES.productDefault;
}

function setPlaceholderImage(card) {
  if (!card) return;
  if (!card.dataset.placeholder) {
    card.dataset.placeholder = getPlaceholderForSlot(card.dataset.slot);
  }
  const preview = card.querySelector('.upload-card-preview');
  if (preview) {
    preview.src = card.dataset.placeholder;
    preview.classList.add('placeholder');
  }
  card.classList.remove('has-file');
  card.classList.add('using-placeholder');
  const filename = card.querySelector('.upload-card-filename');
  if (filename && !card.classList.contains('from-editor')) {
    filename.textContent = '';
  }
}

function clearPlaceholderImage(card) {
  if (!card) return;
  card.classList.remove('using-placeholder');
  const preview = card.querySelector('.upload-card-preview');
  if (preview) {
    preview.classList.remove('placeholder');
  }
}

function initializePlaceholders() {
  document.querySelectorAll('.upload-card').forEach((card) => {
    if (!card.dataset.placeholder) {
      card.dataset.placeholder = getPlaceholderForSlot(card.dataset.slot);
    }
    setPlaceholderImage(card);
  });
}

function getDraftPayload() {
  if (window.uploadCache?.sanitizeProposalData) {
    return window.uploadCache.sanitizeProposalData(proposalData);
  }

  const clone = JSON.parse(JSON.stringify(proposalData || {}));
  if (clone.uploads) {
    Object.keys(clone.uploads).forEach((slotId) => {
      const entry = clone.uploads[slotId];
      if (!entry) return;
      const hasIndexedDb = Boolean(window.uploadCache?.isSupported);
      if (hasIndexedDb) {
        delete entry.data;
        delete entry.dataUrl;
        delete entry.previewUrl;
      }
    });
  }
  return clone;
}

function persistDraft() {
  const payload = getDraftPayload();
  try {
    localStorage.setItem('wizard_draft', JSON.stringify(payload));
  } catch (error) {
    console.warn('[Step3Uploads] Falha ao salvar draft, tentando sem blobs pesados', error);
    // Fallback: limpa todos os blobs e tenta de novo
    if (payload.uploads) {
      Object.values(payload.uploads).forEach((entry) => {
        if (!entry) return;
        delete entry.data;
        delete entry.dataUrl;
        delete entry.previewUrl;
      });
    }
    localStorage.setItem('wizard_draft', JSON.stringify(payload));
  }
}

// Carregar dados salvos
async function loadDraftData() {
  const draft = localStorage.getItem('wizard_draft');
  if (draft) {
    try {
      proposalData = JSON.parse(draft);
      proposalData.produtosSelecionados = proposalData.produtosSelecionados || [];

      // Verificar se planilha já foi editada no Step3B
      if (proposalData.tipoPlanilha === 'editar' && proposalData.uploads?.['planilha']) {
        marcarPlanilhaCompleta();
      }
      
    } catch (error) {
      console.error('Erro ao carregar rascunho:', error);
    }
  }

  proposalData.produtosSelecionados = proposalData.produtosSelecionados || [];
  proposalData.uploads = proposalData.uploads || {};

  // Log antes de hidratar
  console.log('[Step3Uploads] ANTES hydrateUploads - planilha:', {
    exists: !!proposalData.uploads['planilha'],
    hasData: !!(proposalData.uploads['planilha']?.data),
    dataLength: proposalData.uploads['planilha']?.data?.length || 0,
    hasDataUrl: !!(proposalData.uploads['planilha']?.dataUrl),
    dataUrlLength: proposalData.uploads['planilha']?.dataUrl?.length || 0
  });

  if (window.uploadCache?.hydrateUploads) {
    await window.uploadCache.hydrateUploads(proposalData.uploads);
  }

  // Log DEPOIS de hidratar
  console.log('[Step3Uploads] DEPOIS hydrateUploads - planilha:', {
    exists: !!proposalData.uploads['planilha'],
    hasData: !!(proposalData.uploads['planilha']?.data),
    dataLength: proposalData.uploads['planilha']?.data?.length || 0,
    hasDataUrl: !!(proposalData.uploads['planilha']?.dataUrl),
    dataUrlLength: proposalData.uploads['planilha']?.dataUrl?.length || 0
  });

  // CRÍTICO: Se planilha não tem data mas tem dataUrl, recuperar
  if (proposalData.uploads['planilha']) {
    const planilha = proposalData.uploads['planilha'];
    if ((!planilha.data || planilha.data.length === 0) && planilha.dataUrl) {
      console.warn('[Step3Uploads] planilha.data vazio - recuperando de dataUrl');
      const parts = planilha.dataUrl.split(',');
      if (parts.length === 2) {
        planilha.data = parts[1];
        planilha.size = planilha.data.length;
        console.log('[Step3Uploads] planilha.data recuperado - novo length:', planilha.data.length);
      }
    }
  }
}

// Marcar card de planilha como completa (já editada no Step3B)
function marcarPlanilhaCompleta() {
  const cardPlanilha = document.querySelector('[data-slot="planilha"]');
  if (cardPlanilha) {
    clearPlaceholderImage(cardPlanilha);
    cardPlanilha.classList.add('has-file', 'from-editor');
    
    const filename = cardPlanilha.querySelector('.upload-card-filename');
    if (filename) {
      filename.textContent = '✅ Editada no programa';
    }
    
    // Desabilitar clique para alterar (opcional)
    cardPlanilha.style.cursor = 'default';
    cardPlanilha.style.opacity = '0.8';
    
    // Adicionar badge
    const badge = document.createElement('div');
    badge.className = 'editor-badge';
    badge.textContent = 'Editada';
    badge.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: #4caf50;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    `;
    cardPlanilha.appendChild(badge);
  }
}

// Gerar slots para produtos selecionados
function generateProductSlots() {
  const grid = document.getElementById('uploads-grid');
  if (!grid) return;

  grid.querySelectorAll('.upload-card[data-product-slot="true"]').forEach((card) => card.remove());

  const produtos = Array.isArray(proposalData.produtosSelecionados)
    ? proposalData.produtosSelecionados
    : [];

  const uniqueProducts = [];

  produtos.forEach((produto) => {
    const productId =
      typeof produto === 'string'
        ? produto
        : (produto && produto.id) || null;

    if (!productId) return;
    if (productId === 'od-in' || EXTERNAL_PRODUCT_IDS.includes(productId)) return;
    if (uniqueProducts.includes(productId)) return;

    uniqueProducts.push(productId);

    const slotId = `produto-${productId}`;
    const label =
      (typeof produto === 'object' && produto?.name)
        ? `Mock ${produto.name}`
        : `Mock ${productId.toUpperCase()}`;

    const card = document.createElement('div');
    card.className = 'upload-card';
    card.dataset.slot = slotId;
    card.dataset.productSlot = 'true';
    card.dataset.placeholder = PLACEHOLDER_IMAGES.productDefault;
    card.innerHTML = `
      <div class="upload-card-remove" title="Remover">&times;</div>
      <img class="upload-card-preview" alt="Preview">
      <div class="upload-card-icon"></div>
      <div class="upload-card-label">${label}</div>
      <div class="upload-card-hint">PNG ou JPG</div>
      <div class="upload-card-filename"></div>
    `;

    setPlaceholderImage(card);
    grid.appendChild(card);
  });

  const planilhaSlotsCount = getPlanilhaSlotsCount();
  totalSlots = (BASE_SLOTS.length - 1) + planilhaSlotsCount + uniqueProducts.length;
  updateUploadInfo();
}

// Popular uploads salvos
function populateUploads() {
  if (!proposalData.uploads) return;
  
  Object.keys(proposalData.uploads).forEach(slotId => {
    const upload = proposalData.uploads[slotId];
    const card = document.querySelector(`[data-slot="${slotId}"]`);
    
    if (card && upload) {
      displayUpload(card, upload);
    }
  });
}

// Exibir upload em um card
function displayUpload(card, upload) {
  clearPlaceholderImage(card);
  card.classList.add('has-file');
  
  const preview = card.querySelector('.upload-card-preview');
  const filename = card.querySelector('.upload-card-filename');
  
  // Prefer dataUrl (constructed from base64 data) for img.src
  if (preview) {
    const previewSource =
      upload.previewUrl ||
      upload.dataUrl ||
      (upload.base64 ? `data:image/png;base64,${upload.base64}` : null) ||
      (upload.data ? `data:image/png;base64,${upload.data}` : null);
    if (previewSource) {
      preview.src = previewSource;
      preview.classList.remove('placeholder');
    }
  }
  
  if (filename) {
    filename.textContent = upload.name;
  }
}

// Selecionar arquivo
async function selectFile(slotId) {
  if (!isElectron) {
    notify.error('Erro', 'Funcionalidade disponível apenas no app desktop.');
    return;
  }
  
  try {
    const result = await window.electronAPI.files.select({
      filters: [
        { name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'svg'] }
      ],
      properties: ['openFile']
    });
    
    if (!result || result.canceled || !result.path) {
      return;
    }

    const fileName = result.name || '';
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', svg: 'svg+xml' };
    const mime = mimeMap[ext] || 'png';
    const dataBase64 = result.data || result.base64 || null;
    const dataUrl =
      dataBase64 ? `data:image/${mime};base64,${dataBase64}` : result.dataUrl || null;

    // Salvar upload
    proposalData.uploads[slotId] = {
      name: fileName,
      path: result.path,
      size: result.size || 0,
      data: dataBase64,
      dataUrl,
      previewUrl: dataUrl
    };

    if (dataBase64 && window.uploadCache?.save) {
      await window.uploadCache.save(slotId, { data: dataBase64, dataUrl });
    }

    // Atualizar UI
    const card = document.querySelector(`[data-slot="${slotId}"]`);
    if (card) {
      displayUpload(card, proposalData.uploads[slotId]);
    }

    updateUploadInfo();
    notify.success('Upload realizado', `${fileName} enviado com sucesso.`);
  } catch (error) {
    console.error('Erro ao selecionar arquivo:', error);
    notify.error('Erro', 'Não foi possível selecionar o arquivo.');
  }
}

// Remover upload
async function removeUpload(slotId) {
  if (proposalData.uploads[slotId]) {
    delete proposalData.uploads[slotId];

    if (window.uploadCache?.remove) {
      await window.uploadCache.remove(slotId);
    }

    const card = document.querySelector(`[data-slot="${slotId}"]`);
    if (card) {
      const preview = card.querySelector('.upload-card-preview');
      const filename = card.querySelector('.upload-card-filename');

      if (preview) {
        preview.removeAttribute('src');
      }
      if (filename && !card.classList.contains('from-editor')) {
        filename.textContent = '';
      }

      setPlaceholderImage(card);
    }

    updateUploadInfo();
    notify.info('Upload removido', 'Imagem removida com sucesso.');
  }
}

// Atualizar informação de uploads
function updateUploadInfo() {
  let count = Object.keys(proposalData.uploads || {}).length;
  if (proposalData.tipoPlanilha === 'editar') {
    const planilhaKeys = Object.keys(proposalData.uploads || {}).filter((key) => key.startsWith('planilha'));
    count = Math.max(0, count - planilhaKeys.length);
  }
  const infoEl = document.getElementById('upload-info');
  
  if (infoEl) {
    infoEl.innerHTML = `<strong>${count}</strong> / ${totalSlots} imagens enviadas`;
  }
}

// Configurar eventos de um card
function setupCardEvents(card) {
  const slotId = card.dataset.slot;
  
  // Click no card
  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('upload-card-remove')) {
      e.stopPropagation();
      removeUpload(slotId);
    } else {
      selectFile(slotId);
    }
  });
}

// Salvar rascunho
function saveDraft() {
  persistDraft();
  const count = Object.keys(proposalData.uploads || {}).length;
  notify.success('Rascunho salvo', `${count} imagem(ns) salva(s).`);
}

// Próxima etapa
function nextStep() {
  persistDraft();
  
  // Sempre ir para Step4 (Checagem)
  // A edição da planilha já aconteceu antes (Step2 → Step3B → Step3)
  window.location.href = 'Step4Mapeamento.html';
}

// Voltar
function goBack() {
  persistDraft();
  window.location.href = 'Step2Produtos.html';
}

// Atualizar barra de progresso
function updateProgressBar() {
  const progress = document.querySelector('.wizard-steps-progress');
  // Etapa 3 = 50% (3/5 concluídos)
  progress.style.width = '50%';
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    await loadDraftData();
    syncPlanilhaSlots();
    initializePlaceholders();
    generateProductSlots();
    populateUploads();
    updateProgressBar();

    // Ocultar card de planilha se modo for "editar"
    if (proposalData.tipoPlanilha === 'editar') {
      document.querySelectorAll('[data-slot^="planilha"]').forEach((card) => {
        card.style.display = 'none';
      });
    }
    const planilhaSlotsCount = getPlanilhaSlotsCount();
    if (proposalData.tipoPlanilha === 'editar' && planilhaSlotsCount) {
      totalSlots = Math.max(0, totalSlots - planilhaSlotsCount);
    }

    // Configurar cards base
    document.querySelectorAll('.upload-card').forEach(card => {
      setupCardEvents(card);
    });
    updateUploadInfo();

    // Logo variant selector
    document.querySelectorAll('input[name="logoVariant"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        proposalData.logoVariant = e.target.value;
        persistDraft();
      });
    });
    if (proposalData.logoVariant) {
      const radio = document.querySelector(`input[name="logoVariant"][value="${proposalData.logoVariant}"]`);
      if (radio) radio.checked = true;
    }

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
  })();
});
