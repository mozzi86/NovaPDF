const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts || {}),
  openImageDialog: (opts) => ipcRenderer.invoke('dialog:openImage', opts || {}),
  save: (payload) => ipcRenderer.invoke('dialog:save', payload),
  saveMany: (payload) => ipcRenderer.invoke('dialog:saveMany', payload),
  ocrPage: (payload) => ipcRenderer.invoke('ocr:page', payload),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  readRecent: (p) => ipcRenderer.invoke('recent:read', p),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onOpenFileData: (cb) => ipcRenderer.on('open-file-data', (_e, data) => cb(data))
});
