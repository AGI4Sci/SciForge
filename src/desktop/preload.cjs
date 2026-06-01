const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getRuntimeConfig: () => ipcRenderer.invoke('runtime:config'),
  getRuntimeHealth: () => ipcRenderer.invoke('runtime:health'),
  getRuntimeReady: () => ipcRenderer.invoke('runtime:ready'),
  requestShutdown: () => ipcRenderer.invoke('runtime:shutdown'),
  openExternal: (url) => ipcRenderer.invoke('platform:open-external', url),
  openNativeBrowser: (url) => ipcRenderer.invoke('desktop:native-browser:open', url),
  nativeBrowserBack: () => ipcRenderer.invoke('desktop:native-browser:back'),
  nativeBrowserForward: () => ipcRenderer.invoke('desktop:native-browser:forward'),
  nativeBrowserReload: () => ipcRenderer.invoke('desktop:native-browser:reload'),
  getNativeBrowserState: () => ipcRenderer.invoke('desktop:native-browser:state'),
  captureNativeBrowserScreenshot: () => ipcRenderer.invoke('desktop:native-browser:screenshot'),
  attachBrowserHostSessionSurface: (input) => ipcRenderer.invoke('desktop:browser-host-surface:attach', input),
  detachBrowserHostSessionSurface: (input) => ipcRenderer.invoke('desktop:browser-host-surface:detach', input),
  getBrowserHostSessionSurfaceState: (input) => ipcRenderer.invoke('desktop:browser-host-surface:state', input),
  revealPath: (path) => ipcRenderer.invoke('platform:reveal-path', path),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('platform:pick-directory', defaultPath),
};

contextBridge.exposeInMainWorld('sciforgeDesktop', api);
