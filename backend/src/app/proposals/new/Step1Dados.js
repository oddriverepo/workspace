// Wizard - Etapa 1: Dados do Anunciante

const isElectron = window.electronAPI && window.electronAPI.isElectron;

if (!isElectron) {
  // show warning using app notification system instead of native alert
  if (window.notify) {
    window.notify.warning('Ambiente inválido', 'Esta página deve ser executada dentro do aplicativo desktop.');
  }
}

// Estado do wizard
let proposalData = {
  cliente: {},
  comercial: {},
  produtosSelecionados: [],
  uploads: {},
  impacto: {},
  status: 'draft'
};

let isEditMode = false;
let editingProposalId = null;

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

// Carregar dados salvos (se existir)
async function loadDraftData() {
  // Verificar se está em modo de edição
  const urlParams = new URLSearchParams(window.location.search);
  const editId = urlParams.get('edit') || localStorage.getItem('editing_proposal_id');
  
  if (editId) {
    // Modo de edição - carregar proposta existente
    isEditMode = true;
    editingProposalId = editId;
    
    try {
      const proposal = await window.electronAPI.proposals.get(editId);
      if (proposal) {
        proposalData = proposal;
        populateForm();
        
        // Atualizar título da página
        const pageTitle = document.querySelector('.wizard-header h1');
        if (pageTitle) {
          pageTitle.textContent = 'Editar Proposta';
        }
        
        notify.info('Modo de edição', 'Você está editando uma proposta existente.');
      } else {
        notify.error('Erro', 'Proposta não encontrada');
        localStorage.removeItem('editing_proposal_id');
      }
    } catch (error) {
      console.error('Erro ao carregar proposta para edição:', error);
      notify.error('Erro', 'Não foi possível carregar a proposta');
    }
  } else {
    // Modo de criação - tentar carregar rascunho
    const draft = localStorage.getItem('wizard_draft');
    if (draft) {
      try {
        proposalData = JSON.parse(draft);
        populateForm();
      } catch (error) {
        console.error('Erro ao carregar rascunho:', error);
      }
    }
  }
}

// Popular formulário com dados salvos
function populateForm() {
  if (proposalData.cliente) {
    document.getElementById('nomeAnunciante').value = proposalData.cliente.nomeAnunciante || '';
    document.getElementById('nomeEmpresa').value = proposalData.cliente.nomeEmpresa || '';
    document.getElementById('pracas').value = proposalData.cliente.pracas || '';
  }
  
  if (proposalData.comercial) {
    document.getElementById('pagamento').value = proposalData.comercial.pagamento || '';
    document.getElementById('numeroCarros').value = proposalData.comercial.numeroCarros || '';
    document.getElementById('dataInicio').value = proposalData.comercial.dataInicio || '';
    document.getElementById('tempoCampanha').value = proposalData.comercial.tempoCampanhaDias || '';
    document.getElementById('validadeDias').value = proposalData.comercial.validadeDias || '';
    document.getElementById('qtdOrcamentos').value = proposalData.comercial.qtdOrcamentos || 1;

    // Recalcular data fim internamente se existir data início e tempo
    if (proposalData.comercial.dataInicio && proposalData.comercial.tempoCampanhaDias) {
      calculateEndDate();
    }
  }

  // Restaurar escolha de tipo de planilha
  if (proposalData.tipoPlanilha) {
    const radioToCheck = document.querySelector(`input[name="tipoPlanilha"][value="${proposalData.tipoPlanilha}"]`);
    if (radioToCheck) {
      radioToCheck.checked = true;
    }
  }
}

// Calcular data de término automaticamente
function calculateEndDate() {
  const dataInicioInput = document.getElementById('dataInicio');
  const tempoCampanhaInput = document.getElementById('tempoCampanha');

  const dataInicio = dataInicioInput.value;
  const tempoDias = parseInt(tempoCampanhaInput.value);

  if (dataInicio && tempoDias > 0) {
    const dataInicioObj = new Date(dataInicio + 'T00:00:00');
    const dataFimObj = new Date(dataInicioObj);
    dataFimObj.setDate(dataFimObj.getDate() + tempoDias);

    // Salvar no objeto (formato ISO) sem expor campo na UI
    proposalData.comercial = proposalData.comercial || {};
    proposalData.comercial.dataFim = dataFimObj.toISOString().split('T')[0];
  } else {
    proposalData.comercial = proposalData.comercial || {};
    proposalData.comercial.dataFim = null;
  }
}

// Coletar dados do formulário
function collectFormData() {
  const tempoDias = parseInt(document.getElementById('tempoCampanha').value) || 0;
  
  proposalData.cliente = {
    nomeAnunciante: document.getElementById('nomeAnunciante').value.trim(),
    nomeEmpresa: document.getElementById('nomeEmpresa').value.trim(),
    pracas: document.getElementById('pracas').value.trim()
  };
  
  proposalData.comercial = {
    pagamento: document.getElementById('pagamento').value.trim(),
    numeroCarros: parseInt(document.getElementById('numeroCarros').value) || 0,
    tempoCampanhaDias: tempoDias,
    tempoCampanha: `${tempoDias} dias`, // Formato texto para exibição
    dataInicio: document.getElementById('dataInicio').value,
    dataFim: proposalData.comercial?.dataFim || null,
    validadeDias: parseInt(document.getElementById('validadeDias').value) || 0,
    qtdOrcamentos: Math.min(4, Math.max(1, parseInt(document.getElementById('qtdOrcamentos').value) || 1))
  };

  // Salvar escolha do tipo de planilha
  const tipoPlanilhaRadio = document.querySelector('input[name="tipoPlanilha"]:checked');
  proposalData.tipoPlanilha = tipoPlanilhaRadio ? tipoPlanilhaRadio.value : 'imagem';

  updateImpactMetrics();
}

// Validar formulário
function validateForm() {
  const form = document.getElementById('wizard-form');
  const inputs = form.querySelectorAll('input[required]');
  let isValid = true;
  
  inputs.forEach(input => {
    if (!input.value.trim()) {
      input.classList.add('error');
      isValid = false;
    } else {
      input.classList.remove('error');
    }
  });
  
  // Validação de validade em dias
  const validadeDias = parseInt(document.getElementById('validadeDias').value) || 0;
  if (validadeDias <= 0) {
    notify.warning('Validade inválida', 'Informe a validade da proposta em dias.');
    document.getElementById('validadeDias').classList.add('error');
    isValid = false;
  }
  
  return isValid;
}

function updateImpactMetrics() {
  if (!proposalData.comercial) return;

  const dias = proposalData.comercial.tempoCampanhaDias || 0;
  const carros = proposalData.comercial.numeroCarros || 0;

  if (window.impactMetrics && typeof window.impactMetrics.calculateImpactMetrics === 'function') {
    proposalData.impacto = window.impactMetrics.calculateImpactMetrics(dias, carros);
  } else {
    proposalData.impacto = {
      corridas: 0,
      corridasFormatado: '0',
      passageirosTransportados: 0,
      passageirosTransportadosFormatado: '0',
      kmPercorridos: 0,
      kmPercorridosFormatado: '0',
      impactosPossiveis: 0,
      impactosPossiveisFormatado: '0',
      parametros: { dias, carros }
    };
  }
}

// Salvar rascunho
function saveDraft() {
  collectFormData();
  localStorage.setItem('wizard_draft', JSON.stringify(getPersistableDraft()));
  notify.success('Rascunho salvo', 'Seus dados foram salvos localmente.');
}

// Próxima etapa
function nextStep() {
  if (!validateForm()) {
    notify.error('Campos obrigatórios', 'Por favor, preencha todos os campos obrigatórios.');
    return;
  }
  
  collectFormData();
  localStorage.setItem('wizard_draft', JSON.stringify(getPersistableDraft()));
  
  // Navegar para próxima etapa
  window.location.href = 'Step2Produtos.html';
}

// Voltar (substitui o antigo Cancelar)
async function goBack() {
  const action = isEditMode ? 'voltar sem salvar' : 'descartar as alterações';
  const confirmed = await modal.confirm(
    'Sair',
    `Tem certeza que deseja ${action}? As alterações não salvas serão perdidas.`
  );

  if (!confirmed) {
    return;
  }

  // Limpar estado de edição
  localStorage.removeItem('editing_proposal_id');
  localStorage.removeItem('wizard_draft');
  
  // Voltar para workspace (lista)
  window.location.href = '../../index.html';
}

// Atualizar barra de progresso
function updateProgressBar() {
  const progress = document.querySelector('.wizard-steps-progress');
  // Etapa 1 = 0% (início)
  progress.style.width = '0%';
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Setup event listeners first to ensure form is immediately interactive
  updateProgressBar();
  
  document.getElementById('btn-next').addEventListener('click', nextStep);
  document.getElementById('btn-save-draft').addEventListener('click', saveDraft);
  document.getElementById('btn-back').addEventListener('click', goBack);
  
  // Calcular data fim quando data início ou tempo mudar
  document.getElementById('dataInicio').addEventListener('change', calculateEndDate);
  document.getElementById('tempoCampanha').addEventListener('input', calculateEndDate);
  
  // Remover classe error ao digitar
  const inputs = document.querySelectorAll('.form-input');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      input.classList.remove('error');
    });
  });
  
  // Atalhos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveDraft();
    }
  });
  
  // Load draft data asynchronously without blocking form interaction
  loadDraftData().catch(error => {
    console.error('Erro ao carregar dados:', error);
  });
});
