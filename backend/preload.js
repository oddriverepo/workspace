const { contextBridge, ipcRenderer } = require('electron');

// Expor APIs seguras para o frontend
contextBridge.exposeInMainWorld('electronAPI', {
  // Propostas
  proposals: {
    list: () => ipcRenderer.invoke('proposals:list'),
    get: (id) => ipcRenderer.invoke('proposals:get', id),
    create: (proposal) => ipcRenderer.invoke('proposals:create', proposal),
    update: (id, updates) => ipcRenderer.invoke('proposals:update', id, updates),
    delete: (id) => ipcRenderer.invoke('proposals:delete', id)
  },
  
  // Arquivos
  files: {
    select: (options) => ipcRenderer.invoke('files:select', options),
    save: (data) => ipcRenderer.invoke('files:save', data)
  },
  
  // Google Slides API
  slides: {
    generate: (proposalData, accessToken, options) => ipcRenderer.invoke('slides:generate', { proposalData, accessToken, options }),
    onProgress: (callback) => ipcRenderer.on('slides:progress', (event, data) => callback(data)),
    startOAuth: () => ipcRenderer.invoke('slides:startOAuth'),
    getTokenInfo: () => ipcRenderer.invoke('slides:getTokenInfo'),
    disconnect: () => ipcRenderer.invoke('slides:disconnect'),
    refreshToken: () => ipcRenderer.invoke('slides:refreshToken'),
    exportPdf: (presentationId, proposalId, quality) => ipcRenderer.invoke('slides:exportPdf', { presentationId, proposalId, quality })
  },
  settings: {
    getGoogleConfig: () => ipcRenderer.invoke('settings:getGoogleConfig'),
    saveGoogleConfig: (config) => ipcRenderer.invoke('settings:saveGoogleConfig', config)
  },
  
  // Plataforma
  platform: process.platform,
  isElectron: true,
  
  // Shell operations
  shell: {
    openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
    openFolder: (folderPath) => ipcRenderer.invoke('shell:openFolder', folderPath),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath)
  }
});
