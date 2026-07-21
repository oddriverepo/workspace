// ===== WIZARD STATE =====
let proposalData = {};
let ultimaEdicaoVeiculacao = {};
let valorCarroEditadoManual = {};
let orcamentos = [];
let orcamentoAtual = 0;
let totalOrcamentos = 1;
let indicatorEl = null;

function normalizarProdutos(produtos = []) {
  if (!produtos) return [];
  const lista = Array.isArray(produtos) ? produtos : [produtos];
  return lista.map((produto) => {
    if (!produto) return null;
    if (typeof produto === 'string') {
      return { id: produto };
    }
    const cloned = { ...produto };
    if (!cloned.id && cloned.name) {
      cloned.id = cloned.name.toLowerCase().replace(/\s+/g, '-');
    }
    if (!cloned.nome && cloned.name) {
      cloned.nome = cloned.name;
    }
    return cloned;
  }).filter(Boolean);
}

function getPersistableDraft() {
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


// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
  loadDraftData();
  indicatorEl = document.getElementById('orcamento-indicador');
  inicializarOrcamentos();
  preencherDadosOrcamento();
  configurarEventListeners();
  calcularTudo();
});

// ===== CARREGAR RASCUNHO =====
function loadDraftData() {
  try {
    const savedData = localStorage.getItem('wizard_draft');
    if (savedData) {
      proposalData = JSON.parse(savedData);
      
      // Limpar qualquer upload de planilha anterior — quando entramos no Step3B
      // significa que o usuário escolheu criar/editar, então qualquer imagem
      // carregada previamente deve ser descartada.
      if (proposalData.uploads && proposalData.uploads['planilha']) {
        delete proposalData.uploads['planilha'];
        
        // Limpar também do uploadCache (IndexedDB)
        if (window.uploadCache?.remove) {
          window.uploadCache.remove('planilha').catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error('❌ Erro ao carregar rascunho:', error);
  }
}

// ===== PRÉ-PREENCHER DADOS DO STEP 1 =====
function preencherDadosStep1() {
  preencherDadosOrcamento();
}

// ===== ORÇAMENTOS =====
function inicializarOrcamentos() {
  totalOrcamentos = Math.min(4, Math.max(1, proposalData?.comercial?.qtdOrcamentos || proposalData?.orcamentos?.length || 1));
  const existentes = Array.isArray(proposalData.orcamentos) ? proposalData.orcamentos.slice(0, totalOrcamentos) : [];

  if (existentes.length) {
    orcamentos = existentes.map((orc, idx) => ({
      id: orc?.id || `opcao-${idx + 1}`,
      produtosSelecionados: normalizarProdutos(orc?.produtosSelecionados || [])
    }));
  } else {
    const produtos = proposalData?.produtosSelecionados || [];
    orcamentos = Array.from({ length: totalOrcamentos }, (_, idx) => ({
      id: `opcao-${idx + 1}`,
      produtosSelecionados: idx === 0 ? normalizarProdutos(produtos) : []
    }));
  }

  if (orcamentos.length < totalOrcamentos) {
    for (let i = orcamentos.length; i < totalOrcamentos; i++) {
      orcamentos.push({ id: `opcao-${i + 1}`, produtosSelecionados: [] });
    }
  }

  // Fallback: se alguma opção estiver vazia, usa a seleção principal (compat)
  const fallbackProdutos = proposalData?.produtosSelecionados || [];
  orcamentos = orcamentos.map((orc, idx) => {
    if (!orc.produtosSelecionados || !orc.produtosSelecionados.length) {
      if (fallbackProdutos.length && idx === 0) {
        return { ...orc, produtosSelecionados: fallbackProdutos };
      }
    }
    return orc;
  });

  // Fallback forte: se ainda estiver vazio, recria a opÇ~ao 1 com produtosSelecionados
  if (!orcamentos.length && fallbackProdutos.length) {
    orcamentos = [{
      id: 'opcao-1',
      produtosSelecionados: normalizarProdutos(fallbackProdutos)
    }];
    totalOrcamentos = 1;
    orcamentoAtual = 0;
  }
}

function preencherDadosOrcamento() {
  const produtos = obterProdutosDaOpcao(orcamentoAtual);
  const numeroCarros = proposalData?.comercial?.numeroCarros || 40;
  const prazoMeses = 1;
  const pracas = proposalData?.cliente?.pracas || '';
  
  gerarTabelaVeiculacao(produtos, numeroCarros, prazoMeses);
  gerarTabelaProducao(produtos, numeroCarros);
  gerarTabelaPracas(pracas, numeroCarros);
  atualizarIndicadorOrcamento();

  if (!produtos.length) {
    showNotification(`Atenção: a opção ${orcamentoAtual + 1} está sem produtos selecionados. Volte e escolha produtos.`, 'error');
  }
}

function obterProdutosDaOpcao(index) {
  if (!Array.isArray(orcamentos) || !orcamentos.length) {
    const fallbackProdutos = normalizarProdutos(proposalData?.produtosSelecionados || []);
    if (fallbackProdutos.length) {
      orcamentos = [{ id: 'opcao-1', produtosSelecionados: fallbackProdutos }];
      totalOrcamentos = 1;
      orcamentoAtual = 0;
    }
  }

  let produtos = normalizarProdutos(orcamentos[index]?.produtosSelecionados || []);

  // Se vazio, tenta qualquer outra opção preenchida (fallback suave)
  if (!produtos.length && Array.isArray(orcamentos)) {
    const preenchido = orcamentos.find(o => Array.isArray(o?.produtosSelecionados) && o.produtosSelecionados.length);
    if (preenchido) {
      produtos = normalizarProdutos(preenchido.produtosSelecionados);
    }
  }

  // Se ainda vazio, usa produtosSelecionados principal (compat)
  if (!produtos.length && Array.isArray(proposalData?.produtosSelecionados) && proposalData.produtosSelecionados.length) {
    produtos = normalizarProdutos(proposalData.produtosSelecionados);
  }

  return produtos || [];
}

function atualizarIndicadorOrcamento() {
  const indicador = document.getElementById('orcamento-indicador');
  if (!indicador) return;
  indicador.textContent = totalOrcamentos > 1
    ? `Orçamento ${orcamentoAtual + 1} de ${totalOrcamentos}`
    : 'Orçamento único';
}

// ===== GERAR TABELA VEICULAÇÃO DINÂMICA =====
function gerarTabelaVeiculacao(produtos, numeroCarros, prazoMeses) {
  const tbody = document.getElementById('veiculacao-body');
  tbody.innerHTML = '';
  ultimaEdicaoVeiculacao = {};
  
  // Mapear nomes de produtos
  const produtosNomes = {
    'od-drop': 'OD DROP',
    'od-vt': 'OD VT',
    'od-pack': 'OD PACK',
    'od-full': 'OD FULL',
    'od-in': 'OD IN',
    'od-light': 'OD LIGHT'
  };
  
  // Criar linha para cada produto (preço inicial ZERO)
  produtos.forEach((produto, index) => {
    const produtoId = typeof produto === 'string' ? produto : produto.id;
    const produtoNome = produtosNomes[produtoId] || produto.nome || produto.name || (produtoId ? produtoId.toUpperCase() : 'PRODUTO');
    ultimaEdicaoVeiculacao[index] = 'desconto';
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="cell-input" type="text" id="tipo-anuncio-${index}" value="${produtoNome}" readonly></td>
      <td><input class="cell-input" type="number" id="prazo-${index}" value="${prazoMeses}" style="text-align: center;"></td>
      <td>R$</td>
      <td><input class="cell-input" type="number" id="preco-unit-${index}" value="0" step="0.01" style="text-align: center;"></td>
      <td><input class="cell-input" type="number" id="qtde-carros-${index}" value="${numeroCarros}" readonly style="text-align: center;"></td>
      <td>R$</td>
      <td><input class="cell-input" type="text" id="valor-tabela-${index}" readonly style="text-align: center;"></td>
      <td><input class="cell-input destaque-vermelho" type="text" id="desconto-${index}" value="0%" style="text-align: center;"></td>
      <td>R$</td>
      <td><input class="cell-input destaque-vermelho" type="text" id="veic-negociado-${index}" style="text-align: center;"></td>
    `;
    tbody.appendChild(tr);
  });
  
  // Linha de totais
  const trTotal = document.createElement('tr');
  trTotal.className = 'total-row';
  trTotal.innerHTML = `
    <td colspan="2"></td>
    <td>R$</td>
    <td><input class="cell-input" type="text" id="preco-unit-total" readonly style="text-align: center; font-weight: bold;"></td>
    <td></td>
    <td>R$</td>
    <td><input class="cell-input" type="text" id="valor-tabela-total" readonly style="text-align: center; font-weight: bold;"></td>
    <td><input class="cell-input destaque-vermelho" type="text" id="desconto-total" readonly style="text-align: center; font-weight: bold;"></td>
    <td>R$</td>
    <td><input class="cell-input" type="text" id="veic-negociado-total" readonly style="text-align: center; font-weight: bold;"></td>
  `;
  tbody.appendChild(trTotal);
}

// ===== GERAR TABELA PRODUÇÃO DINÂMICA =====
function gerarTabelaProducao(produtos, numeroCarros) {
  const tbody = document.getElementById('producao-body');
  tbody.innerHTML = '';
  valorCarroEditadoManual = {};
  
  const produtosNomes = {
    'od-drop': 'OD DROP',
    'od-vt': 'OD VT',
    'od-pack': 'OD PACK',
    'od-full': 'OD FULL',
    'od-in': 'OD IN',
    'od-light': 'OD LIGHT'
  };
  
  produtos.forEach((produto, index) => {
    const produtoId = typeof produto === 'string' ? produto : produto.id;
    const produtoNome = produtosNomes[produtoId] || produto.nome || produto.name || (produtoId ? produtoId.toUpperCase() : 'PRODUTO');
    valorCarroEditadoManual[index] = false;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="cell-input" type="text" id="tipo-plotagem-${index}" value="${produtoNome}" readonly></td>
      <td>R$</td>
      <td><input class="cell-input" type="text" id="valor-carro-${index}" style="text-align: center;"></td>
      <td><input class="cell-input" type="number" id="qtde-prod-${index}" value="${numeroCarros}" readonly style="text-align: center;"></td>
      <td>R$</td>
      <td><input class="cell-input" type="text" id="total-prod-${index}" readonly style="text-align: center;"></td>
    `;
    tbody.appendChild(tr);
  });
  
  // Linha de totais
  const trTotal = document.createElement('tr');
  trTotal.className = 'total-row';
  trTotal.innerHTML = `
    <td></td>
    <td>R$</td>
    <td><input class="cell-input" type="text" id="valor-carro-total" readonly style="text-align: center; font-weight: bold;"></td>
    <td></td>
    <td>R$</td>
    <td><input class="cell-input" type="text" id="total-prod-total" readonly style="text-align: center; font-weight: bold;"></td>
  `;
  tbody.appendChild(trTotal);
}

// ===== GERAR TABELA PRAÇAS DINÂMICA =====
function gerarTabelaPracas(pracasString, numeroCarros) {
  const tbody = document.getElementById('estados-body');
  tbody.innerHTML = '';
  
  const pracasArray = pracasString ? pracasString.split(',').map(p => p.trim()).filter(p => p) : ['Cidade 1'];
  const qtdePorPraca = Math.floor(numeroCarros / pracasArray.length);
  
  pracasArray.forEach((praca, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="cell-input" type="text" id="estado-${index}" value="" placeholder="UF" style="text-align: center;"></td>
      <td><textarea class="cell-input praca-input" id="praca-${index}" readonly rows="2">${praca}</textarea></td>
      <td><input class="cell-input" type="number" id="qtde-estado-${index}" value="${qtdePorPraca}" style="text-align: center;"></td>
    `;
    tbody.appendChild(tr);
  });
  
  // Linha de totais
  const trTotal = document.createElement('tr');
  trTotal.className = 'total-row';
  trTotal.innerHTML = `
    <td colspan="2" style="text-align: center; font-weight: bold;">TOTAL</td>
    <td><input class="cell-input" type="text" id="qtde-estado-total" readonly style="text-align: center; font-weight: bold;"></td>
  `;
  tbody.appendChild(trTotal);
}

// ===== CONFIGURAR EVENT LISTENERS =====
function configurarEventListeners() {
  // Event delegation para inputs dinâmicos
  document.getElementById('planilha-container').addEventListener('input', (e) => {
    if (e.target.classList.contains('cell-input')) {
      registrarUltimaEdicao(e.target.id);
      calcularTudo();
    }
  });

  document.getElementById('planilha-container').addEventListener('focusout', (e) => {
    if (e.target.classList.contains('cell-input')) {
      calcularTudo();
    }
  });
  
  // Botões de navegação
  document.getElementById('btn-back').addEventListener('click', voltar);
  document.getElementById('btn-save-draft').addEventListener('click', salvarRascunho);
  document.getElementById('btn-next').addEventListener('click', capturarEContinuar);
}

function registrarUltimaEdicao(elementId) {
  if (!elementId) return;
  
  const veicMatch = elementId.match(/^veic-negociado-(\d+)/);
  if (veicMatch) {
    ultimaEdicaoVeiculacao[veicMatch[1]] = 'veic-negociado';
    return;
  }
  
  const descontoMatch = elementId.match(/^desconto-(\d+)/);
  if (descontoMatch) {
    ultimaEdicaoVeiculacao[descontoMatch[1]] = 'desconto';
    return;
  }
  
  const valorCarroMatch = elementId.match(/^valor-carro-(\d+)/);
  if (valorCarroMatch) {
    valorCarroEditadoManual[valorCarroMatch[1]] = true;
  }
}

// ===== FUNÇÕES DE CÁLCULO =====
function calcularTudo() {
  calcularVeiculacao();
  calcularProducao();
  calcularEstados();
  calcularResumo();
  calcularUnitarios();
}

function calcularVeiculacao() {
  const produtos = obterProdutosDaOpcao(orcamentoAtual);
  let somaPrecos = 0;
  let somaValorTabela = 0;
  let somaVeicNegociado = 0;
  const inputFocadoId = document.activeElement?.id;
  
  produtos.forEach((produto, index) => {
    const preco = parseFloat(document.getElementById(`preco-unit-${index}`)?.value) || 0;
    const qtde = parseFloat(document.getElementById(`qtde-carros-${index}`)?.value) || 0;
    const descontoEl = document.getElementById(`desconto-${index}`);
    const veicNegociadoEl = document.getElementById(`veic-negociado-${index}`);
    const valorTabelaEl = document.getElementById(`valor-tabela-${index}`);
    
    const valorTabela = preco * qtde;
    let descontoPercentual = parseDesconto(descontoEl?.value);
    const veicNegociadoRaw = veicNegociadoEl ? veicNegociadoEl.value : '';
    let veicNegociado = veicNegociadoEl ? parseMoeda(veicNegociadoRaw) : 0;
    const ultimaEdicao = ultimaEdicaoVeiculacao[index] || 'desconto';
    
    if (ultimaEdicao === 'veic-negociado') {
      descontoPercentual = valorTabela > 0 ? ((valorTabela - veicNegociado) / valorTabela) * 100 : 0;
    } else {
      descontoPercentual = isFinite(descontoPercentual) ? descontoPercentual : 0;
      veicNegociado = valorTabela - (valorTabela * (descontoPercentual / 100));
    }
    
    // Atualizar campos calculados
    if (valorTabelaEl) valorTabelaEl.value = formatarMoeda(valorTabela);
    const editandoDesconto = ultimaEdicao === 'desconto' && inputFocadoId === `desconto-${index}`;
    if (descontoEl && !editandoDesconto) {
      descontoEl.value = `${(isFinite(descontoPercentual) ? descontoPercentual : 0).toFixed(2)}%`;
    }
    const deveAtualizarVeic = ultimaEdicao !== 'veic-negociado' || inputFocadoId !== `veic-negociado-${index}`;
    if (veicNegociadoEl && deveAtualizarVeic) {
      veicNegociadoEl.value = formatarMoeda(veicNegociado);
    }
    
    somaPrecos += preco;
    somaValorTabela += valorTabela;
    somaVeicNegociado += veicNegociado;
  });
  
  // Calcular desconto total percentual
  const descontoPercentualTotal = somaValorTabela > 0 ? ((somaValorTabela - somaVeicNegociado) / somaValorTabela) * 100 : 0;
  
  // Atualizar totais
  const precoTotalEl = document.getElementById('preco-unit-total');
  const valorTabelaTotalEl = document.getElementById('valor-tabela-total');
  const descontoTotalEl = document.getElementById('desconto-total');
  const veicNegociadoTotalEl = document.getElementById('veic-negociado-total');
  
  if (precoTotalEl) precoTotalEl.value = formatarMoeda(somaPrecos);
  if (valorTabelaTotalEl) valorTabelaTotalEl.value = formatarMoeda(somaValorTabela);
  if (descontoTotalEl) descontoTotalEl.value = `${descontoPercentualTotal.toFixed(2)}%`;
  if (veicNegociadoTotalEl) veicNegociadoTotalEl.value = formatarMoeda(somaVeicNegociado);
}

function calcularProducao() {
  const produtos = obterProdutosDaOpcao(orcamentoAtual);
  let somaValorCarro = 0;
  let somaTotalProd = 0;
  const inputFocadoId = document.activeElement?.id;
  
  produtos.forEach((produto, index) => {
    const veicNegociadoEl = document.getElementById(`veic-negociado-${index}`);
    const qtdeProdEl = document.getElementById(`qtde-prod-${index}`);
    const valorCarroEl = document.getElementById(`valor-carro-${index}`);
    const totalProdEl = document.getElementById(`total-prod-${index}`);
    
    const qtde = qtdeProdEl ? parseFloat(qtdeProdEl.value) : 0;
    const valorCarroTexto = valorCarroEl ? valorCarroEl.value : '';
    
    if (valorCarroEditadoManual[index] && valorCarroTexto.trim() === '') {
      valorCarroEditadoManual[index] = false;
    }
    
    let valorCarro = 0;
    if (valorCarroEditadoManual[index]) {
      valorCarro = parseMoeda(valorCarroTexto);
    } else {
      const veicNegociado = veicNegociadoEl ? parseMoeda(veicNegociadoEl.value) : 0;
      valorCarro = qtde > 0 ? veicNegociado / qtde : 0;
    }
    
    const totalProd = valorCarro * qtde;
    
    const editandoValorCarro = valorCarroEditadoManual[index] && inputFocadoId === `valor-carro-${index}`;
    if (valorCarroEl && !editandoValorCarro) {
      valorCarroEl.value = formatarMoeda(valorCarro);
    }
    if (totalProdEl) totalProdEl.value = formatarMoeda(totalProd);
    
    somaValorCarro += valorCarro;
    somaTotalProd += totalProd;
  });
  
  // Atualizar totais
  const valorCarroTotalEl = document.getElementById('valor-carro-total');
  const totalProdTotalEl = document.getElementById('total-prod-total');
  
  if (valorCarroTotalEl) valorCarroTotalEl.value = formatarMoeda(somaValorCarro);
  if (totalProdTotalEl) totalProdTotalEl.value = formatarMoeda(somaTotalProd);
}

function calcularEstados() {
  const pracas = proposalData?.cliente?.pracas || '';
  const pracasArray = pracas ? pracas.split(',').map(p => p.trim()).filter(p => p) : ['Cidade 1'];
  let somaQtde = 0;
  
  pracasArray.forEach((praca, index) => {
    const qtde = parseFloat(document.getElementById(`qtde-estado-${index}`)?.value) || 0;
    somaQtde += qtde;
  });
  
  const qtdeTotalEl = document.getElementById('qtde-estado-total');
  if (qtdeTotalEl) qtdeTotalEl.value = somaQtde;
}

function calcularResumo() {
  const veiculacaoEl = document.getElementById('veic-negociado-total');
  const producaoEl = document.getElementById('total-prod-total');
  
  const veiculacao = veiculacaoEl ? parseMoeda(veiculacaoEl.value) : 0;
  const producao = producaoEl ? parseMoeda(producaoEl.value) : 0;
  const total = veiculacao + producao;
  
  const resumoVeicEl = document.getElementById('resumo-veiculacao');
  const resumoProdEl = document.getElementById('resumo-producao');
  const resumoTotalEl = document.getElementById('resumo-total');
  
  if (resumoVeicEl) resumoVeicEl.value = formatarMoeda(veiculacao);
  if (resumoProdEl) resumoProdEl.value = formatarMoeda(producao);
  if (resumoTotalEl) resumoTotalEl.value = formatarMoeda(total);
}

function calcularUnitarios() {
  const qtdeTotalEl = document.getElementById('qtde-estado-total');
  const qtdeCarros = qtdeTotalEl ? parseFloat(qtdeTotalEl.value) : 1;
  
  if (qtdeCarros === 0) return; // Evitar divisão por zero
  
  const resumoVeicEl = document.getElementById('resumo-veiculacao');
  const resumoProdEl = document.getElementById('resumo-producao');
  
  const veiculacao = resumoVeicEl ? parseMoeda(resumoVeicEl.value) : 0;
  const producao = resumoProdEl ? parseMoeda(resumoProdEl.value) : 0;
  const total = veiculacao + producao;
  
  const unitVeiculacao = veiculacao / qtdeCarros;
  const unitProducao = producao / qtdeCarros;
  const unitTotal = total / qtdeCarros;
  
  const unitVeicEl = document.getElementById('unit-veiculacao');
  const unitProdEl = document.getElementById('unit-producao');
  const unitTotalEl = document.getElementById('unit-total');
  
  if (unitVeicEl) unitVeicEl.value = formatarMoeda(unitVeiculacao);
  if (unitProdEl) unitProdEl.value = formatarMoeda(unitProducao);
  if (unitTotalEl) unitTotalEl.value = formatarMoeda(unitTotal);
}

// ===== FUNÇÕES AUXILIARES DE FORMATAÇÃO =====
function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoeda(texto) {
  if (!texto) return 0;
  const bruto = texto.toString().trim();
  if (!bruto) return 0;
  
  const negativo = bruto.startsWith('-');
  const somenteNumeros = bruto.replace(/[^\d,\.]/g, '');
  const partes = somenteNumeros.split(',');
  let inteiro = partes[0] || '0';
  const decimal = partes.slice(1).join('');
  
  inteiro = inteiro.replace(/\./g, '');
  
  const numeroTexto = decimal ? `${inteiro}.${decimal}` : inteiro;
  const valor = parseFloat(numeroTexto);
  
  if (!isFinite(valor)) return 0;
  return negativo ? -valor : valor;
}

function parseDesconto(texto) {
  if (!texto) return 0;
  const limpo = texto.toString().replace('%', '').replace(',', '.');
  return parseFloat(limpo) || 0;
}

// ===== CAPTURAR PLANILHA COMO IMAGEM =====
async function capturarEContinuar() {
  try {
    showNotification('Capturando planilha...', 'info');
    
    const container = document.getElementById('planilha-container');
    
    const imagemBase64 = await gerarImagemPlanilha(container);
    
    // Extrair apenas os dados base64 (sem o prefixo data:image/png;base64,)
    const base64Data = imagemBase64.split(',')[1];
    
    console.log('[Step3B] Planilha capturada:', {
      hasDataUrl: !!imagemBase64,
      dataUrlLength: imagemBase64?.length || 0,
      hasBase64Data: !!base64Data,
      base64Length: base64Data?.length || 0,
      sample: base64Data?.substring(0, 50)
    });
    
    // Salvar no proposalData como se fosse upload, no formato esperado pelo generator
    if (!proposalData.uploads) {
      proposalData.uploads = {};
    }
    
    const uploadKey = totalOrcamentos > 1 ? `planilha-${orcamentoAtual + 1}` : 'planilha';
    
    proposalData.uploads[uploadKey] = {
      data: base64Data,
      name: 'planilha-orcamento.png',
      type: 'image/png',
      size: base64Data.length,
      timestamp: new Date().toISOString(),
      dataUrl: imagemBase64
    };
    if (uploadKey !== 'planilha' && orcamentoAtual === 0) {
      proposalData.uploads['planilha'] = { ...proposalData.uploads[uploadKey] };
    }

    // Persistir no uploadCache (IndexedDB) para que a Step3Uploads recupere
    try {
      const cacheSupported = Boolean(window.uploadCache?.isSupported);
      if (base64Data && window.uploadCache?.save) {
        console.log('[Step3B] Salvando planilha no uploadCache...');
        await window.uploadCache.save(uploadKey, { data: base64Data, dataUrl: imagemBase64 });
        // Marca que este upload já foi persistido no cache para que os sanitizers
        // não removam o blob do rascunho salvo em localStorage.
        if (cacheSupported) {
          if (!proposalData.uploads) proposalData.uploads = {};
          if (!proposalData.uploads[uploadKey]) proposalData.uploads[uploadKey] = {};
          proposalData.uploads[uploadKey]._cached = true;
          if (uploadKey !== 'planilha' && orcamentoAtual === 0) {
            proposalData.uploads['planilha']._cached = true;
          }
        }
        console.log('[Step3B] Planilha salva no uploadCache com sucesso');
      } else {
        console.warn('[Step3B] Não foi possível salvar: base64Data ou uploadCache não disponível');
      }
    } catch (err) {
      console.warn('[Step3B] Falha ao salvar planilha no uploadCache', err);
    }

    // Salvar todo o estado (sem os dados pesados, conforme sanitize)
    localStorage.setItem('wizard_draft', JSON.stringify(getPersistableDraft()));
    
    showNotification('Planilha capturada com sucesso!', 'success');
    
    if (orcamentoAtual < totalOrcamentos - 1) {
      orcamentoAtual += 1;
      preencherDadosOrcamento();
      calcularTudo();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    
    // Navegar para Step3 (Uploads) para completar envio de imagens
    setTimeout(() => {
      window.location.href = 'Step3Uploads.html';
    }, 500);
    
  } catch (error) {
    console.error('Erro ao capturar planilha:', error);
    showNotification('Erro ao capturar planilha', 'error');
  }
}

// ===== SALVAR RASCUNHO =====
function salvarRascunho() {
  try {
    // Já salvamos proposalData no localStorage automaticamente
    localStorage.setItem('wizard_draft', JSON.stringify(getPersistableDraft()));
    showNotification('💾 Rascunho salvo com sucesso!', 'success');
  } catch (error) {
    console.error('❌ Erro ao salvar rascunho:', error);
    showNotification('❌ Erro ao salvar rascunho', 'error');
  }
}

// ===== NAVEGAÇÃO =====
function voltar() {
  window.location.href = 'Step2Produtos.html';
}

// ===== NOTIFICAÇÕES =====
function showNotification(message, type = 'info') {
  const safeMessage = String(message || '');
  const toastType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
  const titleMap = {
    success: 'Sucesso',
    error: 'Erro',
    warning: 'Atencao',
    info: 'Informacao'
  };

  if (window.notify && typeof window.notify[toastType] === 'function') {
    window.notify[toastType](titleMap[toastType], safeMessage);
    return;
  }

  if (window.modal?.alert) {
    window.modal.alert(titleMap[toastType], safeMessage);
    return;
  }

  console.warn(`[${titleMap[toastType]}] ${safeMessage}`);
}

async function gerarImagemPlanilha(container) {
  // Captura em altíssima resolução para melhor nitidez no Slides
  const scale = 6;
  const rect = container.getBoundingClientRect();
  
  if (window.domtoimage) {
    return domtoimage.toPng(container, {
      cacheBust: true,
      bgcolor: '#ffffff',
      width: rect.width * scale,
      height: rect.height * scale,
      style: {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        fontFamily: "'Arial', sans-serif",
        WebkitFontSmoothing: 'antialiased',
        fontSmooth: 'always',
        imageRendering: 'optimizeQuality'
      }
    });
  }

  const canvas = await html2canvas(container, {
    // Usa escala alta (teto 6) para máxima definição
    scale: Math.min(6, Math.max(4, (window.devicePixelRatio || 1) * 4)),
    backgroundColor: '#ffffff',
    logging: false,
    useCORS: true,
    allowTaint: true,
    imageTimeout: 0,
    removeContainer: false
  });

  return canvas.toDataURL('image/png');
}
