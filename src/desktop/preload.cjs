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
  resizeBrowserHostSessionSurface: (input) => ipcRenderer.invoke('desktop:browser-host-surface:resize', input),
  getBrowserHostSessionSurfaceState: (input) => ipcRenderer.invoke('desktop:browser-host-surface:state', input),
  attachVirtualAppScreenSurface: (input) => ipcRenderer.invoke('desktop:virtual-app-screen-surface:attach', input),
  presentVirtualAppScreenSurface: (input) => ipcRenderer.invoke('desktop:virtual-app-screen-surface:present', input),
  detachVirtualAppScreenSurface: (input) => ipcRenderer.invoke('desktop:virtual-app-screen-surface:detach', input),
  startAnnotation: (input) => ipcRenderer.invoke('desktop:annotation-overlay:start', input),
  startDesktopAnnotation: (input) => ipcRenderer.invoke('desktop:annotation-overlay:start', input),
  getAnnotationState: () => ipcRenderer.invoke('desktop:annotation-overlay:status'),
  cancelAnnotation: () => ipcRenderer.invoke('desktop:annotation-overlay:cancel'),
  revealPath: (path) => ipcRenderer.invoke('platform:reveal-path', path),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('platform:pick-directory', defaultPath),
};

contextBridge.exposeInMainWorld('sciforgeDesktop', api);
