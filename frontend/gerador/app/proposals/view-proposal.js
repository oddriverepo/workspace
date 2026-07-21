// view-proposal.js - Script para visualizar detalhes de uma proposta

let currentProposal = null;
let proposalId = null;

// Inicializar
async function init() {
  // Obter ID da proposta da URL
  const params = new URLSearchParams(window.location.search);
  proposalId = params.get('id');
  
  if (!proposalId) {
    notify.error('Erro', 'ID da proposta não fornecido');
    setTimeout(() => goBack(), 2000);
    return;
  }
  
  // Carregar proposta
  await loadProposal();
  
  // Event listeners
  document.getElementById('btn-edit').addEventListener('click', editProposal);
  document.getElementById('btn-download').addEventListener('click', downloadProposal);
  document.getElementById('btn-delete').addEventListener('click', deleteProposal);
}

// Carregar dados da proposta
async function loadProposal() {
  try {
    currentProposal = await window.electronAPI.proposals.get(proposalId);
    
    if (!currentProposal) {
      notify.error('Erro', 'Proposta não encontrada');
      setTimeout(() => goBack(), 2000);
      return;
    }
    
    renderProposal();
  } catch (error) {
    console.error('Erro ao carregar proposta:', error);
    notify.error('Erro', 'Não foi possível carregar a proposta');
  }
}

// Renderizar dados da proposta
function renderProposal() {
  const proposal = currentProposal;
  
  // Header
  const isGenerated = proposal.status === 'generated' || proposal.status === 'completed';
  const statusText = isGenerated ? 'Gerado' : 'Rascunho';
  const statusClass = isGenerated ? 'status-generated' : 'status-draft';
  
  document.getElementById('proposal-title').textContent = 
    `Proposta — ${proposal.cliente?.nomeAnunciante || 'Sem nome'}`;
  
  const statusEl = document.getElementById('proposal-status');
  statusEl.textContent = statusText;
  statusEl.className = `proposal-status ${statusClass}`;
  
  const createdDate = new Date(proposal.createdAt).toLocaleString('pt-BR');
  const updatedDate = new Date(proposal.updatedAt).toLocaleString('pt-BR');
  
  document.getElementById('proposal-meta').textContent = 
    `Criado em: ${createdDate} • Última atualização: ${updatedDate}`;
  
  // Mostrar botão de download apenas se a proposta foi gerada
  if (isGenerated) {
    document.getElementById('btn-download').style.display = 'inline-flex';
  }
  
  // Dados do Cliente
  document.getElementById('nomeAnunciante').textContent = 
    proposal.cliente?.nomeAnunciante || '-';
  document.getElementById('nomeEmpresa').textContent = 
    proposal.cliente?.nomeEmpresa || '-';
  document.getElementById('pracas').textContent = 
    proposal.cliente?.pracas || '-';
  
  // Dados Comerciais
  document.getElementById('pagamento').textContent = 
    proposal.comercial?.pagamento || '-';
  document.getElementById('tempoCampanha').textContent = 
    proposal.comercial?.tempoCampanha || '-';
  document.getElementById('quantidadeCarros').textContent = 
    proposal.comercial?.quantidadeCarros || proposal.comercial?.numeroCarros || '-';
  
  if (proposal.comercial?.dataInicio) {
    const dataInicio = new Date(proposal.comercial.dataInicio).toLocaleDateString('pt-BR');
    document.getElementById('dataInicio').textContent = dataInicio;
  } else {
    document.getElementById('dataInicio').textContent = '-';
  }
  
  if (proposal.comercial?.validadeDias) {
    document.getElementById('validadeProposta').textContent = `${proposal.comercial.validadeDias} dias`;
  } else {
    document.getElementById('validadeProposta').textContent = '-';
  }
  
  // Produtos Selecionados (agregar de todos os orçamentos)
  const produtosList = document.getElementById('produtos-list');
  const productLabelMap = new Map();
  const allProducts = [];
  const seenIds = new Set();
  const orcamentos = proposal.orcamentos || [];
  for (const orc of orcamentos) {
    for (const p of (orc.produtosSelecionados || [])) {
      const pid = p?.id || p;
      if (!seenIds.has(pid)) {
        seenIds.add(pid);
        allProducts.push(p);
      }
    }
  }
  // fallback: usar produtosSelecionados da raiz se orcamentos vazio
  if (!allProducts.length && proposal.produtosSelecionados?.length) {
    proposal.produtosSelecionados.forEach(p => allProducts.push(p));
  }
  if (allProducts.length > 0) {
    produtosList.innerHTML = '';
    allProducts.forEach((produto) => {
      const label = resolveProductLabel(produto);
      if (produto?.id) {
        productLabelMap.set(produto.id, label);
      } else if (typeof produto === 'string') {
        productLabelMap.set(produto, label);
      }

      const chip = document.createElement('div');
      chip.className = 'produto-chip';
      chip.textContent = label;
      produtosList.appendChild(chip);
    });
  } else {
    produtosList.innerHTML = '<div class="data-value empty">Nenhum produto selecionado</div>';
  }

  // Uploads
  const uploadsGrid = document.getElementById('uploads-grid');
  if (proposal.uploads && Object.keys(proposal.uploads).length > 0) {
    uploadsGrid.innerHTML = '';

    for (const [key, file] of Object.entries(proposal.uploads)) {
      const uploadItem = document.createElement('div');
      uploadItem.className = 'upload-item';

      const label = getUploadLabel(key, productLabelMap);
      const driveUrl = proposal.uploadDriveUrls?.[key] || null;
      const previewSrc =
        driveUrl ||
        file?.previewUrl ||
        file?.dataUrl ||
        (file?.data ? `data:image/png;base64,${file.data}` : null);

      uploadItem.innerHTML = `
        <div class="upload-thumbnail">
          ${previewSrc ? `<img src="${previewSrc}" alt="${label}" />` : '🖼️'}
        </div>
        <div class="upload-name">${file?.name || 'arquivo'}</div>
        <div class="upload-label">${label}</div>
      `;

      uploadsGrid.appendChild(uploadItem);
    }
  } else {
    uploadsGrid.innerHTML = '<div class="data-value empty">Nenhum arquivo enviado</div>';
  }
}

// Obter label amigável para os uploads
function getUploadLabel(key, productLabelMap = new Map()) {
  const labels = {
    'logoMarcaAnunciante': 'Logo do Anunciante',
    'logo': 'Logo do Anunciante',
    'imagemRede': 'Imagem da Rede',
    'imagemEstabelecimento': 'Imagem do Estabelecimento',
    'imagemProduto1': 'Produto 1',
    'imagemProduto2': 'Produto 2',
    'imagemProduto3': 'Produto 3',
    'imagemProduto4': 'Produto 4',
    'imagemProduto5': 'Produto 5',
    'imagemProduto6': 'Produto 6',
    'mock-lateral': 'Mock Lateral',
    'mock-mapa': 'Mock Frontal',
    'mock-traseiro': 'Mock Traseiro',
    'odim': 'OD IN',
    'planilha': 'Planilha de Orçamento'
  };

  if (labels[key]) {
    return labels[key];
  }

  if (key?.startsWith('produto-')) {
    const productId = key.replace('produto-', '');
    return productLabelMap.get(productId) || `Mockup ${productId}`;
  }

  return labels[key] || key;
}

function resolveProductLabel(produto) {
  if (!produto) return '-';
  if (typeof produto === 'string') return produto;
  return produto.name || produto.label || produto.id || 'Produto';
}

// Editar proposta
function editProposal() {
  // Salvar ID no localStorage e redirecionar para wizard
  localStorage.setItem('editing_proposal_id', proposalId);
  window.location.href = 'new/Step1Dados.html?edit=' + proposalId;
}

// Baixar proposta (PDF)
async function downloadProposal() {
  if (!currentProposal?.googlePresentationId) {
    notify.warning('PDF indisponível', 'Gere a proposta no Google Slides antes de baixar.');
    return;
  }

  const btn = document.getElementById('btn-download');
  btn.disabled = true;
  btn.textContent = 'Baixando...';

  try {
    const response = await window.electronAPI.slides.exportPdf(currentProposal.googlePresentationId, currentProposal.id);
    if (!response?.success) {
      throw new Error(response?.error || 'Falha ao exportar o PDF.');
    }

    await window.electronAPI.files.save({
      data: response.base64,
      fileName: response.fileName || `proposta-${currentProposal.id || Date.now()}.pdf`
    });

    notify.success('Download concluído', 'PDF baixado com sucesso.');
  } catch (error) {
    console.error('Erro ao baixar PDF:', error);
    notify.error('Erro', error.message || 'Não foi possível baixar o PDF.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Baixar PDF';
  }
}

// Excluir proposta}

// Excluir proposta
async function deleteProposal() {
  const confirmed = await legacyModal.confirm(
    'Excluir Proposta',
    'Tem certeza que deseja excluir esta proposta? Esta ação não pode ser desfeita.'
  );
  
  if (confirmed) {
    try {
      await window.electronAPI.proposals.delete(proposalId);
      notify.success('Proposta excluída', 'A proposta foi removida com sucesso.');
      setTimeout(() => goBack(), 1500);
    } catch (error) {
      console.error('Erro ao deletar proposta:', error);
      notify.error('Erro', 'Não foi possível excluir a proposta.');
    }
  }
}

// Voltar para workspace
function goBack() {
  window.location.href = '../index.html';
}

// Modal helper (simples)
const legacyModal = {
  confirm: async (title, message) => {
    if (window.modal?.confirm) {
      return window.modal.confirm(title, message);
    }
    if (window.adminConfirm) {
      return window.adminConfirm(message, { title });
    }
    console.warn('[Modal] confirm indisponivel:', title, message);
    return false;
  }
};

// Inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.goBack = goBack;
