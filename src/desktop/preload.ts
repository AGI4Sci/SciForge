export type DesktopIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
};

export type DesktopContextBridge = {
  exposeInMainWorld(apiKey: string, api: unknown): void;
};

export type SciForgeDesktopPreloadApi = {
  getRuntimeConfig(): Promise<unknown>;
  getRuntimeHealth(): Promise<unknown>;
  getRuntimeReady(): Promise<unknown>;
  requestShutdown(): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
  revealPath(path: string): Promise<unknown>;
  pickDirectory(defaultPath?: string): Promise<{ ok: boolean; path?: string }>;
};

export const SCIFORGE_DESKTOP_API_NAME = 'sciforgeDesktop';

export function createSciForgeDesktopPreloadApi(ipcRenderer: DesktopIpcRenderer): SciForgeDesktopPreloadApi {
  return {
    getRuntimeConfig: () => ipcRenderer.invoke('runtime:config'),
    getRuntimeHealth: () => ipcRenderer.invoke('runtime:health'),
    getRuntimeReady: () => ipcRenderer.invoke('runtime:ready'),
    requestShutdown: () => ipcRenderer.invoke('runtime:shutdown'),
    openExternal: (url: string) => ipcRenderer.invoke('platform:open-external', url),
    revealPath: (path: string) => ipcRenderer.invoke('platform:reveal-path', path),
    pickDirectory: async (defaultPath?: string) => normalizePickDirectoryResult(
      await ipcRenderer.invoke('platform:pick-directory', defaultPath),
    ),
  };
}

function normalizePickDirectoryResult(value: unknown): { ok: boolean; path?: string } {
  if (!value || typeof value !== 'object') return { ok: false };
  const record = value as Record<string, unknown>;
  return {
    ok: Boolean(record.ok),
    path: typeof record.path === 'string' ? record.path : undefined,
  };
}

export function installSciForgeDesktopPreload(input: {
  contextBridge: DesktopContextBridge;
  ipcRenderer: DesktopIpcRenderer;
}): SciForgeDesktopPreloadApi {
  const api = createSciForgeDesktopPreloadApi(input.ipcRenderer);
  input.contextBridge.exposeInMainWorld(SCIFORGE_DESKTOP_API_NAME, api);
  return api;
}

export async function installFromElectronRuntime(): Promise<void> {
  const electronModuleName = 'electron';
  const electron = await import(electronModuleName) as {
    contextBridge?: DesktopContextBridge;
    ipcRenderer?: DesktopIpcRenderer;
  };
  if (!electron.contextBridge || !electron.ipcRenderer) return;
  installSciForgeDesktopPreload({
    contextBridge: electron.contextBridge,
    ipcRenderer: electron.ipcRenderer,
  });
}

const electronProcess = process as NodeJS.Process & {
  type?: string;
  versions: NodeJS.ProcessVersions & { electron?: string };
};

if (electronProcess.versions.electron && electronProcess.type === 'renderer') {
  void installFromElectronRuntime();
}
