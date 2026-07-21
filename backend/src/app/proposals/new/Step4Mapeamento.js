// Wizard - Etapa 4: Checagem de Mapeamento

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


function getQtdOrcamentos() {
  const qtd = proposalData?.comercial?.qtdOrcamentos || proposalData?.orcamentos?.length || 1;
  return Math.min(4, Math.max(1, parseInt(qtd, 10) || 1));
}

function hasPlanilhaUploads() {
  const uploads = proposalData?.uploads || {};
  const qtd = getQtdOrcamentos();
  if (proposalData.tipoPlanilha === 'editar') {
    return Boolean(uploads['planilha'] || uploads['planilha-1']);
  }
  if (qtd <= 1) {
    return Boolean(uploads['planilha'] || uploads['planilha-1']);
  }

  for (let i = 1; i <= qtd; i += 1) {
    const key = i === 1 ? (uploads['planilha-1'] ? 'planilha-1' : 'planilha') : `planilha-${i}`;
    if (!uploads[key]) {
      return false;
    }
  }
  return true;
}

// Requisitos de validação
const REQUIREMENTS = [
  { id: 'dados-cliente', label: 'Dados do Cliente', desc: 'Nome, empresa e praças', check: () => {
    return proposalData.cliente?.nomeAnunciante && 
           proposalData.cliente?.nomeEmpresa && 
           proposalData.cliente?.pracas;
  }},
  { id: 'dados-comerciais', label: 'Dados Comerciais', desc: 'Pagamento, carros e datas', check: () => {
    return proposalData.comercial?.pagamento && 
           proposalData.comercial?.numeroCarros > 0 &&
           proposalData.comercial?.dataInicio &&
           proposalData.comercial?.tempoCampanhaDias > 0;
  }},
  { id: 'produtos', label: 'Produtos Selecionados', desc: 'Pelo menos 1 produto escolhido', check: () => {
    const produtos = proposalData.produtosSelecionados;
    if (Array.isArray(produtos)) {
      return produtos.length > 0;
    }
    return Boolean(produtos);
  }},
  { id: 'logo', label: 'Logo do Anunciante', desc: 'Imagem do logo enviada', check: () => {
    return proposalData.uploads?.['logo'];
  }},
  { id: 'mock-lateral', label: 'Mock Lateral do Carro', desc: 'Imagem do carro enviada', check: () => {
    return proposalData.uploads?.['mock-lateral'];
  }},
  { id: 'mock-mapa', label: 'Mock Frontal', desc: 'Imagem do mock frontal enviada', check: () => {
    return proposalData.uploads?.['mock-mapa'];
  }},
  { id: 'odim', label: 'OD IN', desc: 'Imagem OD IN enviada', check: () => {
    return proposalData.uploads?.['odim'];
  }},
  { id: 'mock-traseiro', label: 'Mock Traseiro', desc: 'Imagem do mock traseiro enviada', check: () => {
    return proposalData.uploads?.['mock-traseiro'];
  }},
  { id: 'planilha', label: 'Planilha de Orçamento', desc: 'Screenshot ou editada no programa', check: () => {
    // Se foi editada no Step3B, já está salva em uploads['planilha']
    // Se escolheu upload de imagem, também deve estar em uploads['planilha']
    return hasPlanilhaUploads();
  }}
];

let validationResults = [];

function getDraftPayload() {
  if (window.uploadCache?.sanitizeProposalData) {
    return window.uploadCache.sanitizeProposalData(proposalData);
  }

  const clone = JSON.parse(JSON.stringify(proposalData || {}));
  if (clone.uploads) {
    Object.values(clone.uploads).forEach((upload) => {
      if (!upload) return;
      delete upload.data;
      delete upload.dataUrl;
      delete upload.previewUrl;
    });
  }
  return clone;
}

function persistDraft() {
  const payload = getDraftPayload();
  try {
    localStorage.setItem('wizard_draft', JSON.stringify(payload));
  } catch (error) {
    console.warn('[Step4Mapeamento] Falha ao salvar draft (quota). Tentando sem blobs pesados.', error);
    // Fallback: remove todos os blobs antes de salvar
    if (payload.uploads) {
      Object.values(payload.uploads).forEach((upload) => {
        if (!upload) return;
        delete upload.data;
        delete upload.dataUrl;
        delete upload.previewUrl;
      });
    }
    try {
      localStorage.setItem('wizard_draft', JSON.stringify(payload));
    } catch (err2) {
      console.error('[Step4Mapeamento] Falha ao salvar draft mesmo após limpar blobs', err2);
      notify?.warning?.('Limite de armazenamento', 'Não foi possível salvar o rascunho localmente. Continue gerando para não perder o progresso.');
    }
  }
}

// Carregar dados salvos
async function loadDraftData() {
  const draft = localStorage.getItem('wizard_draft');
  if (draft) {
    try {
      proposalData = JSON.parse(draft);
      proposalData.uploads = proposalData.uploads || {};
      if (window.uploadCache?.hydrateUploads) {
        await window.uploadCache.hydrateUploads(proposalData.uploads);
      }
      runValidation();
    } catch (error) {
      console.error('Erro ao carregar rascunho:', error);
      runValidation();
    }
  } else {
    runValidation();
  }
}

// Executar validação
function runValidation() {
  validationResults = REQUIREMENTS.map(req => ({
    ...req,
    valid: req.check()
  }));
  
  renderChecklist();
  updateStatus();
}

// Renderizar checklist
function renderChecklist() {
  const container = document.getElementById('checklist-items');
  container.innerHTML = '';
  
  validationResults.forEach(result => {
    const item = document.createElement('div');
    item.className = `checklist-item ${result.valid ? 'valid' : 'invalid'}`;
    item.innerHTML = `
      <div class="checklist-item-icon">${result.valid ? '✓' : '✕'}</div>
      <div class="checklist-item-content">
        <div class="checklist-item-label">${result.label}</div>
        <div class="checklist-item-desc">${result.desc}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

// Atualizar status geral
function updateStatus() {
  const allValid = validationResults.every(r => r.valid);
  const someInvalid = validationResults.some(r => !r.valid);
  
  const statusCard = document.getElementById('status-card');
  const statusIcon = document.getElementById('status-icon');
  const statusTitle = document.getElementById('status-title');
  const statusSubtitle = document.getElementById('status-subtitle');
  const btnNext = document.getElementById('btn-next');
  
  if (allValid) {
    statusCard.className = 'status-card success';
    statusIcon.textContent = '✓';
    statusTitle.textContent = 'Tudo pronto!';
    statusSubtitle.textContent = 'Todos os requisitos foram atendidos. Você pode prosseguir para a próxima etapa.';
    btnNext.disabled = false;
  } else if (someInvalid) {
    statusCard.className = 'status-card warning';
    statusIcon.textContent = '⚠️';
    statusTitle.textContent = 'Requisitos pendentes';
    const count = validationResults.filter(r => !r.valid).length;
    statusSubtitle.textContent = `${count} requisito(s) precisam ser atendidos antes de prosseguir. Volte e complete os dados faltantes.`;
    btnNext.disabled = true;
  } else {
    statusCard.className = 'status-card';
    statusIcon.textContent = '⏳';
    statusTitle.textContent = 'Verificando...';
    statusSubtitle.textContent = 'Aguarde enquanto validamos todos os requisitos';
    btnNext.disabled = true;
  }
}

// Salvar rascunho
function saveDraft() {
  persistDraft();
  notify.success('Rascunho salvo', 'Dados salvos com sucesso.');
}

// Próxima etapa
function nextStep() {
  const allValid = validationResults.every(r => r.valid);

  if (!allValid) {
    notify.warning('Requisitos pendentes', 'Complete todos os requisitos antes de prosseguir.');
    return;
  }

  persistDraft();
  window.location.href = 'Step6Gerar.html';
}

// Voltar
function goBack() {
  persistDraft();
  window.location.href = 'Step3Uploads.html';
}

// Atualizar barra de progresso
function updateProgressBar() {
  const progress = document.querySelector('.wizard-steps-progress');
  // Etapa 4 = 75% (4/5 concluídos)
  progress.style.width = '75%';
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    await loadDraftData();
    updateProgressBar();

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
