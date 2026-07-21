const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const GoogleSlidesClient = require('./client.cjs');
const { textPlaceholders, imagePlaceholders } = require('./placeholders.cjs');
const { calculateImpactMetrics } = require('../impactMetrics.cjs');
const {
  INTERNAL_PRODUCT_ID,
  EXTERNAL_PRODUCT_IDS,
  ALLOWED_PRODUCT_IDS,
  buildGoogleConfig
} = require('./config.cjs');

const PRODUCT_PLACEHOLDERS = [
  { id: 'od-in',   token: '{{produto1}}' },
  { id: 'od-vt',   token: '{{produto2}}' },
  { id: 'od-drop', token: '{{produto3}}' },
  { id: 'od-pack', token: '{{produto4}}' },
  { id: 'od-full', token: '{{produto5}}' }
];

const STATIC_IMAGE_PATHS = {
  productHighlight: path.join(__dirname, '..', '..', 'assets', 'static', 'produto-destaque.png'),
  productTransparent: path.join(__dirname, '..', '..', 'assets', 'static', 'produto-transparente.png')
};

const PLANILHA_TOKEN = '{{planilha}}';

class GoogleSlidesGenerator {
  constructor(accessToken, configOverrides = {}, { tokenRefresher } = {}) {
    this.client = new GoogleSlidesClient(accessToken, { tokenRefresher });
    this.staticAssetCache = {};
    this.config = buildGoogleConfig(configOverrides);
  }

  async generateProposal(proposalData, onProgress = null, options = {}) {
    const { exportPdf = true } = options || {};
    const report = (progress, message) => {
      if (onProgress) onProgress(progress, message);
    };

    const templateId = this.resolveTemplateId(proposalData);
    if (!templateId) {
      throw new Error('Nenhum template do Google Slides foi configurado para esta seleção de produtos.');
    }

    // Validação prévia para multi-orçamento
    const preQtd = proposalData?.comercial?.qtdOrcamentos || proposalData?.orcamentos?.length || 1;
    if (preQtd > 1) {
      const uploads = proposalData?.uploads || {};
      let planilhaCount = 0;
      for (let i = 1; i <= preQtd; i++) {
        const indexedKey = `planilha-${i}`;
        const key = uploads[indexedKey] ? indexedKey : (i === 1 && uploads['planilha'] ? 'planilha' : null);
        if (key && uploads[key]?.data) planilhaCount++;
      }
      if (planilhaCount < preQtd) {
        console.warn(
          `[Google Slides] Multi-orçamento: encontradas ${planilhaCount} planilha(s) de ${preQtd} esperadas. ` +
          'Verifique se todas as planilhas foram capturadas/enviadas.'
        );
      }
    }

    try {
      report(5, 'Iniciando geração no Google Slides...');

      // 1. Copiar apresentação base
      report(15, 'Criando cópia da apresentação base...');
      const title = this.buildTitle(proposalData);
      const copy = await this.client.copyPresentation(
        templateId,
        title,
        this.config.presentationsFolderId
      );
      const presentationId = copy.id;

      if (!presentationId) {
        throw new Error('Falha ao criar cópia da apresentação template.');
      }

      if (this.config.publicShare) {
        await this.client.shareFilePublicly(presentationId);
      }

      report(25, 'Preparando placeholders...');
      this.ensureImpactMetrics(proposalData);
      this.ensureCurrentDateMetadata(proposalData);

      // 2. Construir requests de texto
      const requests = [];
      textPlaceholders.forEach((placeholder) => {
        const value = this.resolveTextValue(placeholder.source, proposalData);
        if (!value) return;
        requests.push({
          replaceAllText: {
            containsText: {
              text: placeholder.token,
              matchCase: false
            },
            replaceText: value
          }
        });
      });

      // 3. Upload de imagens
      const imageUploads = proposalData.uploads || {};
      console.log('[Google Slides] Debug - uploads keys:', Object.keys(imageUploads || {}));
      if (imagePlaceholders.length) {
        report(40, 'Enviando imagens para o Google Drive...');
      }

      // Captura a qualidade das options (padrão: optimized)
      const quality = options?.quality || 'optimized';
      console.log(`[Google Slides] Processando imagens com qualidade: ${quality}`);

      const uploadDriveUrls = {};
      const chosenLogoVariant = proposalData?.logoVariant || 'quadrada';
      for (const placeholder of imagePlaceholders) {
        // Skip logo variants that are NOT the chosen format
        if (placeholder.logoVariant && placeholder.logoVariant !== chosenLogoVariant) continue;

        const uploadData = imageUploads[placeholder.uploadKey];
          if (!uploadData || !uploadData.data) {
            console.warn(`[Google Slides] Upload não encontrado para ${placeholder.uploadKey}`);
            continue;
          }

          // Debug: report short fingerprint to help trace which image was provided
          try {
            const sample = uploadData.data.slice(0, 40);
            console.log(`[Google Slides] Found upload for ${placeholder.uploadKey} — data length=${uploadData.data.length}, sample=${sample}`);
          } catch (err) {
            console.warn('[Google Slides] Falha ao inspecionar uploadData for', placeholder.uploadKey, err && err.message);
          }

        try {
          let buffer = Buffer.from(uploadData.data, 'base64');

          if (placeholder.opacity !== undefined && placeholder.opacity < 1) {
            buffer = await this.applyOpacity(buffer, placeholder.opacity, quality);
          }

          if (placeholder.uploadKey === 'planilha') {
            buffer = await this.ensureImageBounds(buffer, { maxWidth: 4096, maxHeight: 2304, quality: quality });
          } else {
            buffer = await this.ensureImageBounds(buffer, { maxWidth: 3840, maxHeight: 2160, quality: quality });
          }

          const filename = this.buildImageFilename(uploadData.name, placeholder);
            const driveFile = await this.client.uploadImage(
              buffer,
              filename,
              this.config.assetsFolderId
            );
          await this.client.shareFilePublicly(driveFile.id);
          const imageUrl = `https://lh3.googleusercontent.com/d/${driveFile.id}`;

          uploadDriveUrls[placeholder.uploadKey] = imageUrl;

          requests.push({
            replaceAllShapesWithImage: {
              containsText: {
                text: placeholder.token,
                matchCase: false
              },
              imageUrl,
              imageReplaceMethod: 'CENTER_INSIDE'
            }
          });
        } catch (error) {
          console.error(`[Google Slides] Erro ao processar ${placeholder.uploadKey}:`, error.message);
        }
      }

      await this.applyLogoVariantPlaceholders(proposalData, requests);
      await this.applyProductPlaceholders(proposalData, requests);
      await this.applyPlanilhaPlaceholders(presentationId, proposalData, requests, options);
      
      // Só remove slides não usados quando usar template genérico (2+ orçamentos)
      const qtdOrcamentos = proposalData?.comercial?.qtdOrcamentos || proposalData?.orcamentos?.length || 1;
      if (qtdOrcamentos > 1) {
        await this.removeUnusedProductSlides(presentationId, proposalData, requests);
      }

      // 4. Aplicar atualizações
      report(55, 'Aplicando placeholders no Slides...');
      try {
        console.log('[Google Slides] batchUpdate requests count:', requests.length);
        try {
          // print a small sample (no binary data expected here)
          const sample = JSON.stringify(requests.slice(0, 6));
          console.log('[Google Slides] batchUpdate sample:', sample.substring(0, 5000));
        } catch (e) {
          // ignore stringify errors
        }
        await this.client.batchUpdate(presentationId, requests);
      } catch (err) {
        // rethrow with context
        console.error('[Google Slides] batchUpdate failed with error:', err.message || err);
        throw err;
      }

      let localPdfPath = null;
      if (exportPdf) {
        report(80, 'Exportando PDF...');
        const pdfBuffer = await this.client.exportPresentationPdf(presentationId);
        localPdfPath = await this.savePdf(pdfBuffer, proposalData.id);
      } else {
        report(80, 'Apresentação pronta no Google Slides.');
      }

      report(95, 'Finalizando geração...');

      const presentationUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
      const result = {
        designId: presentationId,
        pdfUrl: null,
        localPdfPath,
        title,
        presentationUrl,
        uploadDriveUrls
      };

      report(100, 'Proposta gerada com sucesso!');
      return result;
    } catch (error) {
      const status = error?.response?.status;
      const apiMessage =
        error?.response?.data?.error?.message ||
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'Erro desconhecido ao gerar proposta';
      const enriched = status ? `Google API ${status}: ${apiMessage}` : apiMessage;
      console.error('[Google Slides] Erro ao gerar proposta:', enriched, error?.response?.data || error);
      const err = new Error(enriched);
      err.original = error;
      err.details = error?.response?.data || null;
      throw err;
    }
  }

  buildTitle(proposalData) {
    const cliente = proposalData?.cliente?.nomeAnunciante || 'Cliente';
    const date = new Date().toISOString().split('T')[0];
    return `Proposta - ${cliente} - ${date}`;
  }

  resolveTextValue(source, proposalData) {
    if (!source) return null;
    const parts = source.split('.');
    let value = proposalData;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined || value === null) {
        return null;
      }
    }
    return value.toString();
  }

  async savePdf(buffer, proposalId) {
    const outputDir = path.join(__dirname, '../../../tmp/exports');
    await fs.mkdir(outputDir, { recursive: true });
    const filename = `proposta-${proposalId || Date.now()}.pdf`;
    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, buffer);
    return outputPath;
  }

  resolveTemplateId(proposalData) {
    const qtdOrcamentos = proposalData?.comercial?.qtdOrcamentos || proposalData?.orcamentos?.length || 1;
    if (qtdOrcamentos > 1) {
      const genericId = this.config.templatePresentationId;
      const isRealGenericTemplate = genericId &&
        genericId !== (this.config.templateProductIds?.[INTERNAL_PRODUCT_ID] || '');
      if (!isRealGenericTemplate) {
        throw new Error(
          'Para gerar um orçamento com mais de 1 opção, configure o "Template Multi-Orçamento (Genérico)" ' +
          'nas Configurações. Este template deve conter slides para todos os produtos e múltiplos placeholders {{planilha}}.'
        );
      }
      return genericId;
    }

    const selection = this.normalizeProductSelection(proposalData?.produtosSelecionados || []);
    const scenario = proposalData?.templateSelection || this.determineSelectionScenario(proposalData?.produtosSelecionados);
    const specificTemplate = this.resolveProductSpecificTemplate(selection);
    if (specificTemplate) {
      return specificTemplate;
    }

    if (scenario === 'external-only' && this.config.templateExternalFallbackId) {
      return this.config.templateExternalFallbackId;
    }

    if (scenario === 'combo' && this.config.templateComboFallbackId) {
      return this.config.templateComboFallbackId;
    }

    if (scenario === 'od-in-only') {
      const odinTemplate = this.config.templateProductIds?.[INTERNAL_PRODUCT_ID];
      if (odinTemplate) {
        return odinTemplate;
      }
    }

    return this.config.templatePresentationId;
  }

  resolveProductSpecificTemplate(selection) {
    if (!selection || !selection.length) return null;
    const templateMap = this.config.templateProductIds || {};
    const externalSelected = selection.find((id) => EXTERNAL_PRODUCT_IDS.includes(id));

    if (externalSelected && templateMap[externalSelected]) {
      return templateMap[externalSelected];
    }

    if (selection.length === 1 && selection[0] === INTERNAL_PRODUCT_ID) {
      return templateMap[INTERNAL_PRODUCT_ID] || null;
    }

    return null;
  }

  determineSelectionScenario(produtosSelecionados) {
    const ids = this.normalizeProductSelection(produtosSelecionados);
    if (!ids.length) return 'default';
    const hasInternal = ids.includes(INTERNAL_PRODUCT_ID);
    const externalCount = ids.filter(id => EXTERNAL_PRODUCT_IDS.includes(id)).length;

    if (hasInternal && ids.length === 1) return 'od-in-only';
    if (!hasInternal && ids.length === 1 && externalCount === 1) return 'external-only';
    if (hasInternal && externalCount === 1 && ids.length === 2) return 'combo';
    if (!hasInternal && externalCount >= 1) return 'external-only';

    return 'default';
  }

  normalizeProductSelection(produtosSelecionados) {
    if (!produtosSelecionados) return [];
    const lista = Array.isArray(produtosSelecionados) ? produtosSelecionados : [produtosSelecionados];
    const normalized = [];

    lista.forEach(item => {
      if (!item) return;
      const id = typeof item === 'string' ? item : item.id;
      if (!id || !ALLOWED_PRODUCT_IDS.includes(id)) return;
      if (normalized.includes(id)) return;
      if (normalized.length >= 2) return;
      normalized.push(id);
    });

    return normalized;
  }

  collectAllProductIds(proposalData) {
    const ids = [];
    const pushIds = (list) => {
      if (!list) return;
      const normalized = this.normalizeProductSelection(list);
      normalized.forEach((id) => {
        if (!ids.includes(id)) ids.push(id);
      });
    };

    pushIds(proposalData?.produtosSelecionados);

    if (Array.isArray(proposalData?.orcamentos)) {
      proposalData.orcamentos.forEach((orc) => pushIds(orc?.produtosSelecionados));
    }

    return ids;
  }

  async applyLogoVariantPlaceholders(proposalData, requests) {
    if (!Array.isArray(requests)) return;
    const chosen = proposalData?.logoVariant || 'quadrada';
    const transparentUrl = await this.getStaticAssetUrl('productTransparent', STATIC_IMAGE_PATHS.productTransparent);
    if (!transparentUrl) return;

    const logoVariants = imagePlaceholders.filter(p => p.logoVariant);
    for (const variant of logoVariants) {
      if (variant.logoVariant === chosen) continue;
      requests.push({
        replaceAllShapesWithImage: {
          containsText: { text: variant.token, matchCase: false },
          imageUrl: transparentUrl,
          imageReplaceMethod: 'CENTER_INSIDE'
        }
      });
    }
  }

  async applyProductPlaceholders(proposalData, requests) {
    if (!Array.isArray(requests)) return;
    const selection = this.collectAllProductIds(proposalData);
    const selectedSet = new Set(selection);
    const transparentUrl = await this.getStaticAssetUrl('productTransparent', STATIC_IMAGE_PATHS.productTransparent);
    let highlightUrl = null;

    if (selectedSet.size) {
      highlightUrl = await this.getStaticAssetUrl('productHighlight', STATIC_IMAGE_PATHS.productHighlight);
    }

    if (!transparentUrl) return;

    for (const mapping of PRODUCT_PLACEHOLDERS) {
      const imageUrl = (selectedSet.has(mapping.id) && highlightUrl) ? highlightUrl : transparentUrl;
      requests.push({
        replaceAllShapesWithImage: {
          containsText: {
            text: mapping.token,
            matchCase: false
          },
          imageUrl,
          imageReplaceMethod: 'CENTER_INSIDE'
        }
      });
    }
  }

  async removeUnusedProductSlides(presentationId, proposalData, requests) {
    if (!presentationId || !Array.isArray(requests)) return;

    const selectedIds = this.collectAllProductIds(proposalData);
    const PRODUCT_IDS = [INTERNAL_PRODUCT_ID, ...EXTERNAL_PRODUCT_IDS];
    const unselected = PRODUCT_IDS.filter((id) => !selectedIds.includes(id));
    if (!unselected.length) return;

    const keywordsById = {
      [INTERNAL_PRODUCT_ID]: ['od in', '01', 'in'],
      'od-vt': ['od vt', '02', 'vt'],
      'od-drop': ['od drop', '03', 'drop'],
      'od-pack': ['od pack', '04', 'pack'],
      'od-full': ['od full', '05', '5', 'full', '05 od full', '05 odfull']
    };

    let presentation = null;
    try {
      presentation = await this.client.getPresentation(presentationId);
    } catch (error) {
      console.warn('[Google Slides] Falha ao ler apresentacao para remover slides de produto', error?.message || error);
      return;
    }

    const slidesOrdered = presentation?.slides || [];
    const deleteIds = new Set();

    const fallbackIndex = {
      [INTERNAL_PRODUCT_ID]: 3, // slide 4 no template cru
      'od-vt': 4,   // slide 5
      'od-drop': 5, // slide 6
      'od-pack': 6, // slide 7
      'od-full': 7  // slide 8
    };

    unselected.forEach((id) => {
      const keywords = (keywordsById[id] || []).map((k) => k.toLowerCase());
      const matches = this.findSlidesWithKeywords(presentation, keywords, { mustContainActivated: true });
      if (matches.length) {
        matches.forEach((objId) => deleteIds.add(objId));
        return;
      }

      // Fallback por posicao conhecida no template multi
      const idx = fallbackIndex[id];
      if (idx !== undefined && slidesOrdered[idx]?.objectId) {
        deleteIds.add(slidesOrdered[idx].objectId);
      }
    });

    deleteIds.forEach((objectId) => {
      requests.push({ deleteObject: { objectId } });
    });
  }

  async applyPlanilhaPlaceholders(presentationId, proposalData, requests, options = {}) {
    if (!presentationId || !Array.isArray(requests)) return;

    const uploads = proposalData?.uploads || {};
    const qtdOrcamentos = Math.min(
      4,
      Math.max(1, proposalData?.comercial?.qtdOrcamentos || proposalData?.orcamentos?.length || 1)
    );

    const planilhas = [];
    let hasAnyPlanilha = false;

    for (let i = 1; i <= qtdOrcamentos; i += 1) {
      const indexedKey = `planilha-${i}`;
      const key = uploads[indexedKey] ? indexedKey : (i === 1 && uploads['planilha'] ? 'planilha' : null);
      const upload = key ? uploads[key] : null;
      if (upload && (!upload.data || upload.data.length === 0) && upload.dataUrl) {
        try {
          const parts = upload.dataUrl.split(',');
          if (parts.length === 2 && parts[1]) {
            upload.data = parts[1];
            upload.size = upload.data.length;
          }
        } catch (error) {
          console.warn('[Google Slides] Falha ao recuperar planilha.data via dataUrl', error?.message || error);
        }
      }
      planilhas.push({ key, upload });
      if (upload?.data) {
        hasAnyPlanilha = true;
      }
    }

    if (!hasAnyPlanilha) {
      console.warn('[Google Slides] Nenhuma planilha encontrada para substituir');
      return;
    }

    const needsSlideMapping = qtdOrcamentos > 1 || planilhas.length > 1;
    let planilhaSlideIds = [];

    if (needsSlideMapping) {
      try {
        const presentation = await this.client.getPresentation(presentationId);
        planilhaSlideIds = this.findSlidesWithToken(presentation, PLANILHA_TOKEN);
      } catch (error) {
        console.warn('[Google Slides] Falha ao ler apresentacao para mapear planilhas', error?.message || error);
        planilhaSlideIds = [];
      }
    }

    const quality = options?.quality || 'optimized';
    const deleteAfter = [];

    if (planilhaSlideIds.length > qtdOrcamentos) {
      deleteAfter.push(...planilhaSlideIds.slice(qtdOrcamentos));
    }

    for (let i = 0; i < planilhas.length; i += 1) {
      const entry = planilhas[i];
      if (!entry?.upload?.data) continue;

      if (needsSlideMapping && !planilhaSlideIds[i]) {
        console.warn('[Google Slides] Slide de planilha nao encontrado para indice', i + 1);
        continue;
      }

      try {
        let buffer = Buffer.from(entry.upload.data, 'base64');
        buffer = await this.ensureImageBounds(buffer, {
          maxWidth: 4096,
          maxHeight: 2304,
          quality
        });

        const filename = this.buildImageFilename(entry.upload.name, { uploadKey: entry.key || 'planilha' });
        const driveFile = await this.client.uploadImage(buffer, filename, this.config.assetsFolderId);
        await this.client.shareFilePublicly(driveFile.id);
        const imageUrl = `https://lh3.googleusercontent.com/d/${driveFile.id}`;

        const replaceRequest = {
          replaceAllShapesWithImage: {
            containsText: {
              text: PLANILHA_TOKEN,
              matchCase: false
            },
            imageUrl,
            imageReplaceMethod: 'CENTER_INSIDE'
          }
        };

        if (needsSlideMapping) {
          replaceRequest.replaceAllShapesWithImage.pageObjectIds = [planilhaSlideIds[i]];
        }

        requests.push(replaceRequest);
      } catch (error) {
        console.error('[Google Slides] Erro ao processar planilha', entry.key, error?.message || error);
      }
    }

    deleteAfter.forEach((objectId) => {
      requests.push({
        deleteObject: { objectId }
      });
    });
  }

  findSlidesWithToken(presentation, token) {
    const slides = presentation?.slides || [];
    const matches = [];

    slides.forEach((slide) => {
      let found = false;
      (slide.pageElements || []).forEach((element) => {
        const textElements = element?.shape?.text?.textElements || [];
        textElements.forEach((textEl) => {
          if (textEl?.textRun?.content && textEl.textRun.content.includes(token)) {
            found = true;
          }
        });
      });
      if (found && slide.objectId) {
        matches.push(slide.objectId);
      }
    });

    return matches;
  }

  findSlidesWithKeywords(presentation, keywords = [], { mustContainActivated = false } = {}) {
    if (!keywords || !keywords.length) return [];
    const slides = presentation?.slides || [];
    const matches = [];
    const lowerKeywords = keywords.map((k) => k.toLowerCase()).filter(Boolean);

    slides.forEach((slide) => {
      const allText = [];
      (slide.pageElements || []).forEach((element) => {
        const textElements = element?.shape?.text?.textElements || [];
        textElements.forEach((textEl) => {
          const content = textEl?.textRun?.content;
          if (content) {
            allText.push(content.toLowerCase());
          }
        });
      });
      const combined = allText.join(' ');
      const hasKeywords = lowerKeywords.some((kw) => combined.includes(kw));
      const hasProdutosAtivados = !mustContainActivated || combined.includes('produtos ativados');
      if (hasKeywords && hasProdutosAtivados && slide.objectId) {
        matches.push(slide.objectId);
      }
    });

    return matches;
  }

  async getStaticAssetUrl(cacheKey, filePath) {
    if (this.staticAssetCache[cacheKey]) {
      return this.staticAssetCache[cacheKey];
    }

    try {
      const buffer = await fs.readFile(filePath);
      const filename = path.basename(filePath);
      const driveFile = await this.client.uploadImage(
        buffer,
        filename,
        this.config.assetsFolderId
      );
      await this.client.shareFilePublicly(driveFile.id);
      const imageUrl = `https://lh3.googleusercontent.com/d/${driveFile.id}`;
      this.staticAssetCache[cacheKey] = imageUrl;
      return imageUrl;
    } catch (error) {
      console.error(`[Google Slides] Falha ao enviar ativo estático (${cacheKey}):`, error.message);
      return null;
    }
  }

  buildImageFilename(originalName, placeholder) {
    const parsed = originalName ? path.parse(originalName) : null;
    const baseName = parsed?.name || placeholder.uploadKey || 'imagem';
    const suffix = (placeholder.opacity !== undefined && placeholder.opacity < 1) ? '-transparente' : '';
    return `${baseName}${suffix}.png`;
  }

  async applyOpacity(buffer, opacityValue, quality = 'optimized') {
    const opacity = Math.max(0, Math.min(1, opacityValue));
    if (opacity >= 0.999) {
      return buffer;
    }

    const qualitySettings = this.getImageQualitySettings(quality);

    return sharp(buffer)
      .ensureAlpha()
      .linear([1, 1, 1, opacity], [0, 0, 0, 0])
      .png(qualitySettings)
      .toBuffer();
  }

  async ensureImageBounds(buffer, { maxWidth = 1920, maxHeight = 1080, quality = 'optimized' } = {}) {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();
      const needsResize =
        (metadata.width && metadata.width > maxWidth) ||
        (metadata.height && metadata.height > maxHeight);

      const qualitySettings = this.getImageQualitySettings(quality);
      const isJpeg = metadata.format === 'jpeg';
      const hasAlpha = metadata.hasAlpha;

      // Preserve JPEG for photos without transparency
      const encode = (pipeline) => {
        if (isJpeg && !hasAlpha) {
          return pipeline.jpeg({ quality: qualitySettings.quality || 100, mozjpeg: true }).toBuffer();
        }
        return pipeline.png(qualitySettings).toBuffer();
      };

      if (needsResize) {
        return encode(
          image.resize({
            width: maxWidth,
            height: maxHeight,
            fit: 'inside',
            withoutEnlargement: true
          })
        );
      }

      return encode(sharp(buffer));
    } catch (error) {
      console.error('[Google Slides] Erro ao ajustar bounds da imagem:', error);
      return buffer;
    }
  }

  getImageQualitySettings(quality) {
    switch (quality) {
      case 'maximum':
        return {
          compressionLevel: 0,
          quality: 100,
          effort: 10,
          adaptiveFiltering: false
        };
      case 'high':
        return {
          compressionLevel: 4,
          quality: 92,
          effort: 8
        };
      case 'optimized':
      default:
        return {
          compressionLevel: 6,
          quality: 85,
          effort: 6
        };
    }
  }
  
  ensureImpactMetrics(proposalData) {
    const dias = proposalData?.comercial?.tempoCampanhaDias || 0;
    const carros = proposalData?.comercial?.numeroCarros || 0;
    proposalData.impacto = calculateImpactMetrics(dias, carros);
  }

  async exportExistingPdf(presentationId) {
    if (!presentationId) {
      throw new Error('ID da apresentação não informado.');
    }
    return this.client.exportPresentationPdf(presentationId);
  }

  ensureCurrentDateMetadata(proposalData) {
    if (!proposalData) return;
    const months = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
    ];
    const today = new Date();
    const dia = today.getDate();
    const mes = months[today.getMonth()] || '';
    proposalData.metadata = proposalData.metadata || {};
    proposalData.metadata.dataHojeFormatada = `${dia} de ${mes}`;
  }
}

module.exports = GoogleSlidesGenerator;
