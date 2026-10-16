const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fluxTab', {
  search: text => ipcRenderer.invoke('flux:home-search', String(text || '')),
  bookmarks: () => ipcRenderer.invoke('flux:home-bookmarks'),
  action: name => ipcRenderer.invoke('flux:home-action', String(name || ''))
});
