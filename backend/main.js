const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const Store = require('electron-store');
const { buildGoogleConfig } = require('./src/lib/google/config');

try {
  require('dotenv').config();
} catch (error) {
  console.warn('dotenv não carregado, prosseguindo com variáveis do sistema.');
}

try {
  app.disableHardwareAcceleration();
} catch (error) {
  console.warn('Não foi possível desabilitar aceleração de hardware:', error.message);
}

const store = new Store({
  name: 'od-drive-proposals',
  defaults: {
    proposals: [],
    settings: {
      developerLogo: null
    },
    googleConfig: {}
  }
});

const GoogleOAuthManager = require('./src/lib/google/oauth-manager.js');
const oauthManager = new GoogleOAuthManager(store, () => buildGoogleConfig(getStoredGoogleConfig()));

let mainWindow;

function toPublicTokenInfo(info) {
  if (!info) return null;
  return {
    connected: Boolean(info.refreshToken || info.accessToken),
    scope: info.scope || '',
    expiresAt: info.expiresAt || null,
    connectedAt: info.connectedAt || null,
  };
}

function stripSensitiveGoogleConfig(config = {}) {
  if (!config || typeof config !== 'object') return {};
  const { clientSecret, googleClientSecret, accessToken, refreshToken, ...safe } = config;
  return safe;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: true,
    icon: path.join(__dirname, 'public', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f8',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'app', 'index.html'));

  // DevTools disabled by default - uncomment only when debugging
  // if (process.env.NODE_ENV === 'development') {
  //   mainWindow.webContents.openDevTools();
  // }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function dedupeProposals(list = []) {
  // Mantém a última ocorrência de cada id (mais recente fica)
  const seen = new Set();
  const result = [];
  let changed = false;

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const proposal = list[i];
    if (!proposal || !proposal.id) {
      changed = true;
      continue;
    }

    if (seen.has(proposal.id)) {
      changed = true;
      continue;
    }

    seen.add(proposal.id);
    result.unshift(proposal);
  }

  return { list: result, changed };
}

// CRUD de propostas
ipcMain.handle('proposals:list', () => {
  const stored = store.get('proposals', []);
  const { list, changed } = dedupeProposals(stored);
  if (changed) {
    store.set('proposals', list);
  }
  return list;
});

ipcMain.handle('proposals:get', (event, id) => {
  const proposals = store.get('proposals', []);
  return proposals.find(p => p.id === id) || null;
});

ipcMain.handle('proposals:create', (event, proposal) => {
  const proposals = store.get('proposals', []);

  proposal.id = proposal.id || Date.now().toString();
  proposal.createdAt = proposal.createdAt || new Date().toISOString();
  proposal.updatedAt = new Date().toISOString();
  proposal.status = proposal.status || 'draft';

  // Evita duplicar caso o mesmo id já exista (mantém apenas a nova versão)
  const filtered = proposals.filter((p) => p && p.id !== proposal.id);
  filtered.push(proposal);

  store.set('proposals', filtered);
  return proposal;
});

ipcMain.handle('proposals:update', (event, id, updates) => {
  const proposals = store.get('proposals', []);
  const index = proposals.findIndex(p => p.id === id);
  if (index === -1) return null;

  proposals[index] = {
    ...proposals[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  store.set('proposals', proposals);
  return proposals[index];
});

ipcMain.handle('proposals:delete', (event, id) => {
  const proposals = store.get('proposals', []);
  const filtered = proposals.filter(p => p.id !== id);
  store.set('proposals', filtered);
  return true;
});

// Seletor de arquivos
ipcMain.handle('files:select', async (event, options = {}) => {
  const dialogOptions = {
    title: options.title || 'Selecionar arquivo',
    buttonLabel: options.buttonLabel || 'Selecionar',
    filters: options.filters || [
      { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg'] }
    ],
    properties: options.properties || ['openFile']
  };

  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  if (result.canceled || !result.filePaths.length) return null;

  const filePath = result.filePaths[0];
  const data = await fs.readFile(filePath);
  const base64 = data.toString('base64');

  return {
    path: filePath,
    name: path.basename(filePath),
    data: base64
  };
});

ipcMain.handle('files:save', async (event, { data, fileName = 'arquivo.bin', defaultPath }) => {
  const dialogOptions = {
    title: 'Salvar arquivo',
    defaultPath: defaultPath || path.join(app.getPath('documents'), fileName)
  };

  const result = await dialog.showSaveDialog(mainWindow, dialogOptions);
  if (result.canceled || !result.filePath) return null;

  const buffer = Buffer.from(data, 'base64');
  await fs.writeFile(result.filePath, buffer);
  return { success: true, path: result.filePath };
});

function getStoredGoogleConfig() {
  return store.get('googleConfig') || {};
}

function normalizeGoogleConfigPayload(payload = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(payload)) {
    if (['clientId', 'googleClientId', 'clientSecret', 'googleClientSecret', 'redirectUri', 'googleRedirectUri', 'accessToken', 'refreshToken'].includes(key)) {
      continue;
    }
    if (key === 'publicShare') {
      cleaned.publicShare = Boolean(value);
      continue;
    }
    if (value === undefined || value === null) continue;
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (trimmed === '') continue;
    cleaned[key] = trimmed;
  }
  return cleaned;
}

// Geração via Google Slides
ipcMain.handle('slides:generate', async (event, { proposalData, options }) => {
  const Generator = require('./src/lib/google/generator.js');

  try {
    const token = await oauthManager.getValidAccessToken();
    if (!token) {
      return { success: false, error: 'Token de acesso não disponível. Conecte-se ao Google primeiro.' };
    }

    const generator = new Generator(token, getStoredGoogleConfig());
    const onProgress = (progress, message) => {
      event.sender.send('slides:progress', { progress, message });
    };

    const result = await generator.generateProposal(proposalData, onProgress, options);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Slides] Erro na geração:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('slides:exportPdf', async (event, { presentationId, proposalId, quality }) => {
  const Generator = require('./src/lib/google/generator.js');

  try {
    const token = await oauthManager.getValidAccessToken();
    if (!token) {
      return { success: false, error: 'Token de acesso não disponível. Conecte-se ao Google primeiro.' };
    }

    const generator = new Generator(token, getStoredGoogleConfig());
    const buffer = await generator.exportExistingPdf(presentationId, quality || 'optimized');
    const fileName = `proposta-${proposalId || Date.now()}.pdf`;

    return { success: true, base64: buffer.toString('base64'), fileName };
  } catch (error) {
    console.error('[Slides] Erro ao exportar PDF:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('slides:startOAuth', async () => {
  try {
    const result = await oauthManager.startOAuthFlow();
    return { success: true, ...result };
  } catch (error) {
    console.error('[Slides] Erro no OAuth:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('slides:getTokenInfo', () => {
  try {
    return toPublicTokenInfo(oauthManager.getTokenInfo());
  } catch (error) {
    console.error('[Slides] Erro ao obter token:', error);
    return null;
  }
});

ipcMain.handle('slides:disconnect', () => {
  try {
    oauthManager.disconnect();
    return { success: true };
  } catch (error) {
    console.error('[Slides] Erro ao desconectar:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('slides:refreshToken', async () => {
  try {
    await oauthManager.refreshToken();
    return { success: true, token: toPublicTokenInfo(oauthManager.getTokenInfo()) };
  } catch (error) {
    console.error('[Slides] Erro ao renovar token:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:getGoogleConfig', () => {
  const stored = getStoredGoogleConfig();
  return {
    success: true,
    stored: stripSensitiveGoogleConfig(stored),
    effective: stripSensitiveGoogleConfig(buildGoogleConfig(stored)),
    defaults: stripSensitiveGoogleConfig(buildGoogleConfig({}))
  };
});

ipcMain.handle('settings:saveGoogleConfig', (event, payload = {}) => {
  const cleaned = normalizeGoogleConfigPayload(payload);
  store.set('googleConfig', cleaned);
  return {
    success: true,
    effective: stripSensitiveGoogleConfig(buildGoogleConfig(cleaned))
  };
});

// Abrir arquivo PDF
ipcMain.handle('shell:openFile', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('[Shell] Erro ao abrir arquivo:', error);
    return { success: false, error: error.message };
  }
});

// Abrir pasta no explorer
ipcMain.handle('shell:openFolder', async (event, folderPath) => {
  try {
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    console.error('[Shell] Erro ao abrir pasta:', error);
    return { success: false, error: error.message };
  }
});

// Mostrar arquivo no explorer
ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('[Shell] Erro ao mostrar arquivo:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
