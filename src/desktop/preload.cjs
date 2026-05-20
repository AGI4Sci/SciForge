const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getRuntimeConfig: () => ipcRenderer.invoke('runtime:config'),
  getRuntimeHealth: () => ipcRenderer.invoke('runtime:health'),
  getRuntimeReady: () => ipcRenderer.invoke('runtime:ready'),
  requestShutdown: () => ipcRenderer.invoke('runtime:shutdown'),
  openExternal: (url) => ipcRenderer.invoke('platform:open-external', url),
  revealPath: (path) => ipcRenderer.invoke('platform:reveal-path', path),
};

contextBridge.exposeInMainWorld('sciforgeDesktop', api);
