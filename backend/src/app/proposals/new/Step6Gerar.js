// Wizard - Etapa Final: geração da apresentação e PDF

const isElectron = window.electronAPI && window.electronAPI.isElectron;

if (!isElectron) {
  if (window.notify) {
    window.notify.warning('Ambiente inválido', 'Esta página deve ser executada dentro do aplicativo desktop.');
  }
}

let proposalData = {
  cliente: {},
  comercial: {},
  produtosSelecionados: [],
  impacto: {},
  uploads: {},
  status: 'draft'
};

let isGenerating = false;
let pdfGenerating = false;
let progressListenerAttached = false;

const ui = {
  icon: () => document.getElementById('generate-icon'),
  title: () => document.getElementById('generate-title'),
  subtitle: () => document.getElementById('generate-subtitle'),
  progressWrapper: () => document.getElementById('generate-progress'),
  progressBar: () => document.getElementById('progress-bar'),
  status: () => document.getElementById('generate-status'),
  presentationLinks: () => document.getElementById('presentation-links'),
  presentationViewLink: () => document.getElementById('presentation-view-link'),
  btnGenerate: () => document.getElementById('btn-generate'),
  btnGeneratePdf: () => document.getElementById('btn-generate-pdf'),
  pdfActions: () => document.getElementById('pdf-actions'),
  btnFinish: () => document.getElementById('btn-finish'),
  qualitySelector: () => document.getElementById('quality-selector')
};

function attachProgressListener() {
  if (progressListenerAttached) return;
  progressListenerAttached = true;
  window.electronAPI.slides.onProgress((data) => {
    if (!data) return;
    ui.progressBar().style.width = `${data.progress}%`;
    ui.status().textContent = data.message;
  });
}

async function loadDraftData() {
  const draft = localStorage.getItem('wizard_draft');
  if (draft) {
    try {
      proposalData = JSON.parse(draft);
      proposalData.uploads = proposalData.uploads || {};
      if (window.uploadCache?.hydrateUploads) {
        await window.uploadCache.hydrateUploads(proposalData.uploads);
      }
      updateImpactMetrics();
    } catch (error) {
      console.error('Erro ao carregar rascunho:', error);
    }
  }
}

function updateImpactMetrics() {
  const dias = proposalData?.comercial?.tempoCampanhaDias || 0;
  const carros = proposalData?.comercial?.numeroCarros || 0;

  if (window.impactMetrics && typeof window.impactMetrics.calculateImpactMetrics === 'function') {
    proposalData.impacto = window.impactMetrics.calculateImpactMetrics(dias, carros);
  }
}

async function generatePresentation() {
  if (isGenerating) return;

  if (!window.electronAPI?.slides?.generate) {
    notify.error('Integração indisponível', 'Reinicie o aplicativo para restabelecer a comunicação com o Google Slides.');
    return;
  }

  const produtosSelecionados = proposalData?.produtosSelecionados;
  const temProdutos = Array.isArray(produtosSelecionados)
    ? produtosSelecionados.length > 0
    : Boolean(produtosSelecionados);
  if (!proposalData || !temProdutos) {
    notify.warning('Dados incompletos', 'Finalize as etapas anteriores antes de gerar a apresentação.');
    return;
  }

  if (!proposalData.uploads || !Object.keys(proposalData.uploads).length) {
    notify.warning('Uploads obrigatórios', 'Envie as imagens na etapa de uploads antes de gerar.');
    return;
  }

  isGenerating = true;
  updateImpactMetrics();
  hidePdfActions();

  // Captura a qualidade selecionada ANTES de gerar
  const selectedQualityInput = document.querySelector('input[name="pdfQuality"]:checked');
  const selectedQuality = selectedQualityInput ? selectedQualityInput.value : 'optimized';

  const iconEl = ui.icon();
  const titleEl = ui.title();
  const subtitleEl = ui.subtitle();
  const progressWrapper = ui.progressWrapper();
  const btnGenerate = ui.btnGenerate();
  const btnGeneratePdf = ui.btnGeneratePdf();

  iconEl.textContent = '🚧';
  titleEl.textContent = 'Gerando apresentação...';
  subtitleEl.textContent = 'Duplicando o template e preenchendo os dados no Google Slides.';
  progressWrapper.style.display = 'block';
  btnGenerate.disabled = true;
  btnGeneratePdf.style.display = 'none';

  attachProgressListener();

  try {
    const result = await window.electronAPI.slides.generate(proposalData, null, { exportPdf: false, quality: selectedQuality });
    if (!result?.success) {
      throw new Error(result?.error || 'Erro ao gerar a apresentação.');
    }

    proposalData.status = 'slides-ready';
    proposalData.generatedAt = new Date().toISOString();
    proposalData.generatedPdfPath = null;
    proposalData.googlePresentationId = result.designId;
    proposalData.googlePresentationUrl = result.presentationUrl;

    await saveProposal({ silent: true });

    iconEl.textContent = '✅';
    titleEl.textContent = 'Apresentação criada com sucesso!';
    subtitleEl.textContent = 'Use o link abaixo para visualizar ou baixar diretamente do Google Slides.';
    showPresentationLink(result.presentationUrl);
    btnGeneratePdf.style.display = 'inline-flex';
    btnGeneratePdf.disabled = false;
    
    ui.btnFinish().style.display = 'inline-flex';
    notify.success('Apresentação criada', 'Agora você pode gerar o PDF final com a qualidade desejada.');
  } catch (error) {
    console.error('Erro ao gerar apresentação:', error);
    iconEl.textContent = '⚠️';
    titleEl.textContent = 'Falha ao gerar apresentação';
    subtitleEl.textContent = error.message || 'Tente novamente e verifique sua conexão.';
    btnGenerate.disabled = false;
    notify.error('Erro', error.message || 'Não foi possível gerar a apresentação.');
  } finally {
    isGenerating = false;
    ui.btnGenerate().disabled = false;
  }
}

function showPresentationLink(url) {
  const links = ui.presentationLinks();
  const linkEl = ui.presentationViewLink();
  if (!links || !linkEl) return;
  linkEl.href = url;
  links.style.display = url ? 'block' : 'none';
}

function hidePdfActions() {
  const pdfContainer = ui.pdfActions();
  if (pdfContainer) {
    pdfContainer.style.display = 'none';
  }
  // O seletor de qualidade agora fica sempre visível
}

function showPdfActions() {
  const pdfContainer = ui.pdfActions();
  if (pdfContainer) {
    pdfContainer.style.display = 'flex';
  }
  ui.btnFinish().style.display = 'inline-flex';
}

async function generateFinalPdf() {
  if (pdfGenerating) return;
  if (!proposalData.googlePresentationId) {
    notify.warning('Gere a apresentação primeiro', 'Crie a apresentação antes de exportar o PDF.');
    return;
  }

  const selectedQuality = document.querySelector('input[name="pdfQuality"]:checked')?.value || 'optimized';

  pdfGenerating = true;
  const btnGeneratePdf = ui.btnGeneratePdf();
  btnGeneratePdf.disabled = true;
  
  const qualityLabels = {
    'optimized': 'Otimizado',
    'high': 'Alta Qualidade',
    'maximum': 'Máxima Fidelidade'
  };
  
  ui.status().textContent = `Exportando PDF em modo ${qualityLabels[selectedQuality]}...`;

  try {
    const response = await window.electronAPI.slides.exportPdf(
      proposalData.googlePresentationId, 
      proposalData.id,
      selectedQuality
    );
    if (!response?.success) {
      throw new Error(response?.error || 'Falha ao exportar o PDF.');
    }

    await window.electronAPI.files.save({

      data: response.base64,

      fileName: response.fileName

    });



    proposalData.generatedPdfPath = null;

    proposalData.generatedPdfAvailable = true;

    proposalData.generatedPdfFileName = response.fileName;

    proposalData.status = 'completed';
    proposalData.generatedAt = new Date().toISOString();

    await saveProposal({ silent: true });
    showPdfActions();
    ui.status().textContent = 'PDF salvo com sucesso.';
    notify.success('PDF baixado', 'Arquivo salvo no seu dispositivo.');
  } catch (error) {
    console.error('Erro ao exportar PDF:', error);
    notify.error('Erro', error.message || 'Não foi possível exportar o PDF.');
  } finally {
    pdfGenerating = false;
    ui.btnGeneratePdf().disabled = false;
  }
}

async function saveProposal(options = {}) {
  const { silent = false } = options || {};
  if (!isElectron) return;

  try {
    // Preferir atualizar se estivermos editando ou já temos um `proposalData.id`.
    const storedEditId = localStorage.getItem('editing_proposal_id');
    const editId = storedEditId || proposalData.id || null;
    let saved;

    if (editId) {
      // Atualiza a proposta existente (quando entramos pelo fluxo de edição
      // ou quando já salvamos anteriormente e `proposalData.id` foi preenchido).
      saved = await window.electronAPI.proposals.update(editId, proposalData);
      // Limpar a flag de edição caso exista
      if (storedEditId) localStorage.removeItem('editing_proposal_id');
      if (!silent) {
        notify.success('Proposta atualizada', 'As alterações foram salvas com sucesso.');
      }
    } else {
        // Criar nova proposta quando ainda não houver identificador
        // Garantir um id no cliente para evitar criação duplicada em retries
        if (!proposalData.id) {
          proposalData.id = Date.now().toString();
        }
        saved = await window.electronAPI.proposals.create(proposalData);
      if (!silent) {
        notify.success('Proposta criada', 'Nova proposta registrada com sucesso.');
      }
    }

    if (saved) {
      if (saved.id) {
        proposalData.id = saved.id;
      }
      localStorage.removeItem('wizard_draft');
      if (window.uploadCache?.clearAll) {
        window.uploadCache.clearAll();
      }
    }

    return saved;
  } catch (error) {
    console.error('Erro ao salvar proposta:', error);
    throw error;
  }
}

async function openPDF() {

  try {

    if (!proposalData.googlePresentationId) {

      notify.warning('Link indisponível', 'Gere a apresentação e exporte o PDF primeiro.');

      return;

    }



    ui.status().textContent = 'Baixando PDF...';

    const response = await window.electronAPI.slides.exportPdf(proposalData.googlePresentationId, proposalData.id);

    if (!response?.success) {

      throw new Error(response?.error || 'Não foi possível baixar o PDF.');

    }



    await window.electronAPI.files.save({

      data: response.base64,

      fileName: response.fileName || proposalData.generatedPdfFileName || `proposta-${proposalData.id || Date.now()}.pdf`

    });



    notify.success('Download concluído', 'PDF baixado novamente.');

  } catch (error) {

    console.error('Erro ao baixar PDF:', error);

    notify.error('Erro', error.message || 'Não foi possível baixar o PDF.');

  } finally {

    ui.status().textContent = '';

  }

}



function openFolder() {

  try {

    if (proposalData.googlePresentationUrl) {

      window.open(proposalData.googlePresentationUrl, '_blank', 'noopener');

    } else {

      notify.warning('Link indisponível', 'Gere a apresentação primeiro.');

    }

  } catch (error) {

    console.error('Erro ao abrir apresentação:', error);

    notify.error('Erro', 'Não foi possível abrir o Google Slides.');

  }

}



function newProposal() {
  localStorage.removeItem('wizard_draft');
  if (window.uploadCache?.clearAll) {
    window.uploadCache.clearAll();
  }
  window.location.href = 'Step1Dados.html';
}

function finish() {
  localStorage.removeItem('wizard_draft');
  if (window.uploadCache?.clearAll) {
    window.uploadCache.clearAll();
  }
  window.location.href = '../../index.html';
}

function goBack() {
  window.location.href = 'Step4Mapeamento.html';
}

function updateProgressBar() {
  const progress = document.querySelector('.wizard-steps-progress');
  progress.style.width = '100%';
}

document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    await loadDraftData();
    updateProgressBar();
    attachProgressListener();

    document.getElementById('btn-generate').addEventListener('click', generatePresentation);
    document.getElementById('btn-generate-pdf').addEventListener('click', generateFinalPdf);
    document.getElementById('btn-open-pdf').addEventListener('click', openPDF);
    document.getElementById('btn-open-folder').addEventListener('click', openFolder);
    document.getElementById('btn-new-proposal').addEventListener('click', newProposal);

    document.getElementById('btn-back').addEventListener('click', goBack);
    document.getElementById('btn-finish').addEventListener('click', finish);

    document.querySelectorAll('.quality-option').forEach(option => {
      option.addEventListener('click', () => {
        document.querySelectorAll('.quality-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter' && !isGenerating) {
        generatePresentation();
      }
    });
  })();
});
