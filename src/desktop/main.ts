import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  ProductionRuntimeLauncher,
  type ManagedRuntimeServiceSpec,
  type RuntimeLauncherStartResult,
} from '../runtime/desktop/runtime-launcher.js';
import { DesktopPlatformService } from '../runtime/desktop/platform-service.js';
import {
  createDesktopProductionShellPlan,
  type DesktopProductionShellPlan,
} from './production-shell-planner.js';
import {
  createDesktopBrowserHostSurfaceController,
  type DesktopBrowserHostSurfaceController,
  type DesktopBrowserHostSurfaceElectron,
  type DesktopBrowserHostSurfaceViewContainer,
} from './browser-host-surface.js';
import {
  createDesktopVirtualAppScreenSurfacePresenter,
} from './virtual-app-screen-surface.js';

type ElectronAppLike = {
  whenReady(): Promise<void>;
  getPath(name: 'userData'): string;
  setPath?(name: 'userData', path: string): void;
  getAppPath?(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
  quit(): void;
};

type ElectronIpcMainLike = {
  handle(channel: string, listener: (...args: unknown[]) => unknown): void;
};

type ElectronNativeBrowserWebContentsLike = {
  loadURL?(url: string, options?: unknown): Promise<void>;
  getURL?(): string;
  getTitle?(): string;
  canGoBack?(): boolean;
  canGoForward?(): boolean;
  goBack?(): void;
  goForward?(): void;
  reload?(): void;
  capturePage?(): Promise<{ toDataURL?(): string; toPNG?(): Uint8Array }>;
};

type ElectronClipboardLike = {
  writeImage?(image: unknown): void;
};

type ElectronBrowserWindowLike = {
  loadFile(filePath: string): Promise<void>;
  loadURL?(url: string): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  show?(): void;
  focus?(): void;
  close?(): void;
  isDestroyed?(): boolean;
  setMenuBarVisibility?(visible: boolean): void;
  webContents?: ElectronNativeBrowserWebContentsLike;
  contentView?: DesktopBrowserHostSurfaceViewContainer;
};

type ElectronBrowserWindowConstructor = new(options: ElectronBrowserWindowOptions) => ElectronBrowserWindowLike;

export type ElectronBrowserWindowOptions = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  title?: string;
  webPreferences: {
    preload?: string;
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
    webviewTag?: boolean;
  };
};

export type ElectronDesktopModule = DesktopBrowserHostSurfaceElectron & {
  app: ElectronAppLike;
  BrowserWindow: ElectronBrowserWindowConstructor;
  ipcMain: ElectronIpcMainLike;
  clipboard?: ElectronClipboardLike;
};

export type DesktopMainStartResult = {
  plan: DesktopProductionShellPlan;
  launcher: RuntimeLauncherStartResult;
  runtimeConfig: DesktopRuntimeConfig;
  window: ElectronBrowserWindowLike;
};

export type DesktopMainOptions = {
  projectRoot?: string;
  packagedRoot?: string;
  sidecarCwd?: string;
  workspacePath?: string;
  rendererDevServerUrl?: string;
  launcher?: ProductionRuntimeLauncher;
  platformService?: DesktopPlatformService;
};

export type DesktopRuntimeConfig = {
  schemaVersion: 'sciforge.desktop.runtime-config.v1';
  runtimeControlUrl: string;
  workspaceWriterBaseUrl: string;
  modelBaseUrl: string;
  runtimeCodexBaseUrl: string;
  workspacePath: string;
  appDataRoot: string;
  appRoot: string;
  sidecarCwd: string;
  ports: RuntimeLauncherStartResult['ports'];
};

export type DesktopNativeBrowserState = {
  ok: boolean;
  surface: 'electron-browser-window';
  embedded?: false;
  handoffOnly?: true;
  url?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  clipboardWritten?: boolean;
  reason?: string;
};

export type DesktopAppPaths = {
  appRoot: string;
  sidecarCwd: string;
};

export function createDefaultDesktopManagedServices(
  appRoot: string,
  options: { sidecarCwd?: string; command?: string; electronRunAsNode?: boolean; env?: Record<string, string> } = {},
): ManagedRuntimeServiceSpec[] {
  const root = resolve(appRoot);
  const sidecarCwd = resolve(options.sidecarCwd ?? directoryCwdForAppRoot(root));
  const command = options.command ?? process.execPath;
  const baseEnv = {
    ...(options.electronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...(options.env ?? {}),
  };
  const env = Object.keys(baseEnv).length ? baseEnv : undefined;
  return [
    compiledJsService('workspace-server', 'workspace-writer', join(root, 'dist-desktop', 'src', 'runtime', 'workspace-server.js'), sidecarCwd, command, [], env),
    compiledJsService('provider-proxy', 'provider-proxy', join(root, 'dist-desktop', 'packages', 'backend', 'src', 'cli.js'), sidecarCwd, command, ['--quiet'], env),
    compiledJsService('runtime-codex', 'runtime-codex', join(root, 'dist-desktop', 'src', 'runtime', 'codex', 'codex-runtime-standalone-server.js'), sidecarCwd, command, [], env),
  ];
}

export function createDesktopBrowserWindowOptions(plan: DesktopProductionShellPlan): ElectronBrowserWindowOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: true,
    webPreferences: {
      preload: plan.main.preloadScript.compiledPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  };
}

export function createElectronDesktopMainController(
  electron: ElectronDesktopModule,
  options: DesktopMainOptions = {},
) {
  const appPaths = resolveDesktopAppPaths(electron.app, options);
  const userDataOverride = desktopUserDataPathFromEnv();
  if (userDataOverride && electron.app.setPath) electron.app.setPath('userData', userDataOverride);
  const appDataRoot = electron.app.getPath('userData');
  const workspacePath = resolve(options.workspacePath ?? desktopWorkspacePathFromEnv() ?? join(appDataRoot, 'workspace'));
  let started: DesktopMainStartResult | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let activeLauncher: ProductionRuntimeLauncher | undefined;
  let browserHostSurface: DesktopBrowserHostSurfaceController | undefined;

  async function start(): Promise<DesktopMainStartResult> {
    if (started) return started;
    logDesktopStartupDebug('waiting-for-app-ready', { appRoot: appPaths.appRoot, appDataRoot, workspacePath });
    await electron.app.whenReady();
    logDesktopStartupDebug('app-ready', { appRoot: appPaths.appRoot, appDataRoot, workspacePath });
    browserHostSurface = electron.WebContentsView
      ? createDesktopBrowserHostSurfaceController(electron)
      : undefined;
    const browserHostSurfaceStart = browserHostSurface
      ? await browserHostSurface.startServer()
      : undefined;
    const launcher = options.launcher ?? new ProductionRuntimeLauncher({
      appDataRoot: electron.app.getPath('userData'),
      workspacePath,
      requestedControlPort: 0,
      requestedUiPort: 0,
      requestedWorkspacePort: 0,
      requestedProviderProxyPort: 0,
      requestedRuntimeCodexPort: 0,
      services: createDefaultDesktopManagedServices(appPaths.appRoot, {
        sidecarCwd: appPaths.sidecarCwd,
        electronRunAsNode: isElectronRuntimeProcess(),
        env: browserHostSurfaceStart?.url
          ? { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: browserHostSurfaceStart.url }
          : undefined,
      }),
    });
    const launcherResult = await launcher.start();
    logDesktopStartupDebug('launcher-started', { controlUrl: launcherResult.controlUrl, ports: launcherResult.ports });
    activeLauncher = launcher;
    const plan = createDesktopProductionShellPlan({
      projectRoot: appPaths.appRoot,
      runtimeControlUrl: launcherResult.controlUrl,
      requireExistingRenderer: true,
    });
    const runtimeConfig = createDesktopRuntimeConfig({
      launcherResult,
      appDataRoot,
      workspacePath,
      appPaths,
    });
    registerDesktopIpcHandlers({
      electron,
      launcher,
      launcherResult,
      runtimeConfig,
      platformService: options.platformService ?? new DesktopPlatformService(),
      browserHostSurface,
    });
    const window = new electron.BrowserWindow(createDesktopBrowserWindowOptions(plan));
    browserHostSurface?.setMainWindow(window);
    const desktopRendererUrl = desktopRendererUrlFromOption(options.rendererDevServerUrl) ?? desktopRendererUrlFromEnv();
    logDesktopStartupDebug('browser-window-created', { rendererFile: plan.renderer.loadStrategy.filePath, desktopRendererUrl });
    if (desktopRendererUrl && window.loadURL) {
      await window.loadURL(desktopRendererUrl);
      logDesktopStartupDebug('renderer-loaded', { rendererUrl: desktopRendererUrl });
    } else {
      await window.loadFile(plan.renderer.loadStrategy.filePath);
      logDesktopStartupDebug('renderer-loaded', { rendererFile: plan.renderer.loadStrategy.filePath });
    }
    started = { plan, launcher: launcherResult, runtimeConfig, window };
    return started;
  }

  async function shutdown(): Promise<void> {
	    if (!shutdownPromise) {
	      shutdownPromise = Promise.all([
	        activeLauncher ? activeLauncher.shutdown() : Promise.resolve(),
	        browserHostSurface ? browserHostSurface.stopServer() : Promise.resolve(),
	      ]).then(() => undefined);
	    }
    await shutdownPromise;
  }

  electron.app.on('before-quit', () => {
    void shutdown();
  });
  electron.app.on('window-all-closed', () => {
    void shutdown().finally(() => electron.app.quit());
  });

  return { start, shutdown };
}

export function registerDesktopIpcHandlers(input: {
  electron: Pick<ElectronDesktopModule, 'ipcMain' | 'BrowserWindow' | 'clipboard'>;
  launcher: Pick<ProductionRuntimeLauncher, 'health' | 'ready' | 'shutdown'>;
  launcherResult: RuntimeLauncherStartResult;
  runtimeConfig: DesktopRuntimeConfig;
  platformService: DesktopPlatformService;
  browserHostSurface?: DesktopBrowserHostSurfaceController;
}): void {
  const nativeBrowser = createDesktopNativeBrowserController(input.electron);
  const virtualAppScreenSurface = createDesktopVirtualAppScreenSurfacePresenter();
  input.electron.ipcMain.handle('runtime:health', () => input.launcher.health());
  input.electron.ipcMain.handle('runtime:ready', () => ({ ok: input.launcher.ready(), ready: input.launcher.ready() }));
  input.electron.ipcMain.handle('runtime:config', () => input.runtimeConfig);
  input.electron.ipcMain.handle('runtime:shutdown', async () => {
    await input.launcher.shutdown();
    return { ok: true };
  });
  input.electron.ipcMain.handle('platform:open-external', async (_event: unknown, url: unknown) => {
    if (typeof url !== 'string') throw new Error('platform:open-external requires a URL string');
    await input.platformService.openExternal(url);
    return { ok: true };
  });
  input.electron.ipcMain.handle('desktop:native-browser:open', async (_event: unknown, url: unknown) => {
    if (typeof url !== 'string') throw new Error('desktop:native-browser:open requires a URL string');
    return nativeBrowser.open(url);
  });
  input.electron.ipcMain.handle('desktop:native-browser:back', () => nativeBrowser.back());
  input.electron.ipcMain.handle('desktop:native-browser:forward', () => nativeBrowser.forward());
  input.electron.ipcMain.handle('desktop:native-browser:reload', () => nativeBrowser.reload());
  input.electron.ipcMain.handle('desktop:native-browser:state', () => nativeBrowser.state());
  input.electron.ipcMain.handle('desktop:native-browser:screenshot', () => nativeBrowser.screenshot());
  input.electron.ipcMain.handle('desktop:browser-host-surface:attach', async (_event: unknown, value: unknown) => {
    if (!input.browserHostSurface) return { ok: false, reason: 'native-embedded-browser-host-surface-unavailable' };
    const request = browserHostSurfaceAttachRequest(value);
    return input.browserHostSurface.attach(request);
  });
  input.electron.ipcMain.handle('desktop:browser-host-surface:detach', async (_event: unknown, value: unknown) => {
    if (!input.browserHostSurface) return { ok: false, reason: 'native-embedded-browser-host-surface-unavailable' };
    return input.browserHostSurface.detach(browserHostSurfaceSessionId(value));
  });
  input.electron.ipcMain.handle('desktop:browser-host-surface:resize', async (_event: unknown, value: unknown) => {
    if (!input.browserHostSurface) return { ok: false, reason: 'native-embedded-browser-host-surface-unavailable' };
    return input.browserHostSurface.resize(browserHostSurfaceAttachRequest(value));
  });
  input.electron.ipcMain.handle('desktop:browser-host-surface:state', async (_event: unknown, value: unknown) => {
    if (!input.browserHostSurface) return { ok: false, reason: 'native-embedded-browser-host-surface-unavailable' };
    return input.browserHostSurface.state(browserHostSurfaceSessionId(value));
  });
  input.electron.ipcMain.handle('desktop:virtual-app-screen-surface:attach', async (_event: unknown, value: unknown) => {
    return virtualAppScreenSurface.attach(value);
  });
  input.electron.ipcMain.handle('desktop:virtual-app-screen-surface:present', async (_event: unknown, value: unknown) => {
    return virtualAppScreenSurface.present(value);
  });
  input.electron.ipcMain.handle('desktop:virtual-app-screen-surface:detach', async (_event: unknown, value: unknown) => {
    return virtualAppScreenSurface.detach(value);
  });
  input.electron.ipcMain.handle('platform:reveal-path', async (_event: unknown, path: unknown) => {
    if (typeof path !== 'string') throw new Error('platform:reveal-path requires a path string');
    await input.platformService.revealInFolder(path);
    return { ok: true };
  });
  input.electron.ipcMain.handle('platform:pick-directory', async (_event: unknown, defaultPath: unknown) => {
    const electron = loadElectronRuntime() as ElectronDesktopModule & {
      dialog?: {
        showOpenDialog(options: {
          title?: string;
          defaultPath?: string;
          properties: Array<'openDirectory' | 'createDirectory'>;
        }): Promise<{ canceled: boolean; filePaths: string[] }>;
      };
    };
    if (!electron.dialog) throw new Error('platform:pick-directory requires Electron dialog support');
    const result = await electron.dialog.showOpenDialog({
      title: '选择 SciForge 项目文件夹',
      defaultPath: typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath.trim() : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });
	}

export function createDesktopNativeBrowserWindowOptions(): ElectronBrowserWindowOptions {
  return {
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: true,
    title: 'SciForge 原生浏览器',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

export function createDesktopNativeBrowserController(
  electron: Pick<ElectronDesktopModule, 'BrowserWindow' | 'clipboard'>,
) {
  let window: ElectronBrowserWindowLike | undefined;

  function currentWindow(): ElectronBrowserWindowLike | undefined {
    if (window?.isDestroyed?.() === true) window = undefined;
    return window;
  }

  function state(reason?: string): DesktopNativeBrowserState {
    const active = currentWindow();
    if (!active) return { ok: false, surface: 'electron-browser-window', embedded: false, handoffOnly: true, reason: reason ?? 'native-browser-not-open' };
    return {
      ok: true,
      surface: 'electron-browser-window',
      embedded: false,
      handoffOnly: true,
      url: active.webContents?.getURL?.() ?? undefined,
      canGoBack: active.webContents?.canGoBack?.() ?? false,
      canGoForward: active.webContents?.canGoForward?.() ?? false,
      reason,
    };
  }

  async function open(url: string): Promise<DesktopNativeBrowserState> {
    const normalized = normalizeDesktopNativeBrowserUrl(url);
    const active = currentWindow() ?? new electron.BrowserWindow(createDesktopNativeBrowserWindowOptions());
    if (!window) {
      window = active;
      active.setMenuBarVisibility?.(false);
      active.on('closed', () => {
        window = undefined;
      });
    }
    if (!active.loadURL) return { ok: false, surface: 'electron-browser-window', embedded: false, handoffOnly: true, reason: 'native-browser-load-url-unavailable' };
    await active.loadURL(normalized);
    active.show?.();
    active.focus?.();
    return state();
  }

  return {
    open,
    state,
    back(): DesktopNativeBrowserState {
      const active = currentWindow();
      if (active?.webContents?.canGoBack?.()) active.webContents.goBack?.();
      active?.focus?.();
      return state();
    },
    forward(): DesktopNativeBrowserState {
      const active = currentWindow();
      if (active?.webContents?.canGoForward?.()) active.webContents.goForward?.();
      active?.focus?.();
      return state();
    },
    reload(): DesktopNativeBrowserState {
      const active = currentWindow();
      active?.webContents?.reload?.();
      active?.focus?.();
      return state();
    },
    async screenshot(): Promise<DesktopNativeBrowserState & { mimeType?: 'image/png'; dataUrl?: string }> {
      const active = currentWindow();
      const image = await active?.webContents?.capturePage?.();
      const dataUrl = image?.toDataURL?.();
      let clipboardWritten = false;
      if (image && electron.clipboard?.writeImage) {
        electron.clipboard.writeImage(image);
        clipboardWritten = true;
      }
      if (!dataUrl) return { ...state('native-browser-screenshot-unavailable') };
      return { ...state(), mimeType: 'image/png', dataUrl, clipboardWritten };
    },
  };
}

function normalizeDesktopNativeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';
  if (/^(?:https?:|file:|about:)/i.test(trimmed)) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function browserHostSurfaceSessionId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { sessionId?: unknown }).sessionId === 'string') {
    return (value as { sessionId: string }).sessionId;
  }
  throw new Error('desktop:browser-host-surface requires sessionId');
}

function browserHostSurfaceAttachRequest(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('desktop:browser-host-surface:attach requires an object');
  const record = value as {
    sessionId?: unknown;
    bounds?: unknown;
    visible?: unknown;
    focus?: unknown;
  };
  if (!record.bounds || typeof record.bounds !== 'object') throw new Error('desktop:browser-host-surface:attach requires bounds');
  const bounds = record.bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  return {
    sessionId: browserHostSurfaceSessionId(record.sessionId),
    bounds: {
      x: numberField(bounds.x, 'bounds.x'),
      y: numberField(bounds.y, 'bounds.y'),
      width: numberField(bounds.width, 'bounds.width'),
      height: numberField(bounds.height, 'bounds.height'),
    },
    visible: record.visible === false ? false : undefined,
    focus: record.focus === true,
  };
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`desktop:browser-host-surface:attach requires numeric ${field}`);
  return value;
}

function loadElectronRuntime(): ElectronDesktopModule {
  const require = createRequire(import.meta.url);
  return require('electron') as ElectronDesktopModule;
}

export function resolveDesktopAppPaths(
  app: Pick<ElectronAppLike, 'getAppPath'>,
  options: Pick<DesktopMainOptions, 'projectRoot' | 'packagedRoot' | 'sidecarCwd'> = {},
): DesktopAppPaths {
  const appPath = app.getAppPath?.();
  const appRoot = resolve(
    options.packagedRoot ??
      options.projectRoot ??
      desktopAppRootFromEnv() ??
      inferDesktopAppRoot(appPath) ??
      appPath ??
      process.cwd(),
  );
  return {
    appRoot,
    sidecarCwd: resolve(options.sidecarCwd ?? directoryCwdForAppRoot(appRoot)),
  };
}

function createDesktopRuntimeConfig(input: {
  launcherResult: RuntimeLauncherStartResult;
  appDataRoot: string;
  workspacePath: string;
  appPaths: DesktopAppPaths;
}): DesktopRuntimeConfig {
	return {
	  schemaVersion: 'sciforge.desktop.runtime-config.v1',
	  runtimeControlUrl: input.launcherResult.controlUrl,
	  workspaceWriterBaseUrl: portUrl(input.launcherResult, 'workspace-writer'),
	  modelBaseUrl: `${portUrl(input.launcherResult, 'provider-proxy')}/v1`,
	  runtimeCodexBaseUrl: portUrl(input.launcherResult, 'runtime-codex'),
	  workspacePath: input.workspacePath,
	  appDataRoot: input.appDataRoot,
    appRoot: input.appPaths.appRoot,
    sidecarCwd: input.appPaths.sidecarCwd,
    ports: input.launcherResult.ports,
	};
}

function portUrl(result: RuntimeLauncherStartResult, name: RuntimeLauncherStartResult['ports'][number]['name']): string {
  return result.ports.find((binding) => binding.name === name)?.url ?? '';
}

function compiledJsService(
  id: string,
  role: ManagedRuntimeServiceSpec['role'],
  entryPath: string,
  cwd: string,
  command: string,
  extraArgs: string[] = [],
  env?: Record<string, string>,
): ManagedRuntimeServiceSpec {
  return {
    id,
    role,
    command,
    args: [entryPath, ...extraArgs],
    cwd,
    env,
  };
}

function directoryCwdForAppRoot(appRoot: string): string {
  return appRoot.endsWith('.asar') ? dirname(appRoot) : appRoot;
}

function isElectronRuntimeProcess(): boolean {
  return Boolean((process.versions as NodeJS.ProcessVersions & { electron?: string }).electron);
}

function desktopUserDataPathFromEnv(): string | undefined {
  const value = process.env.SCIFORGE_DESKTOP_USER_DATA_DIR;
  return value?.trim() ? resolve(value) : undefined;
}

function desktopWorkspacePathFromEnv(): string | undefined {
  const value = process.env.SCIFORGE_DESKTOP_WORKSPACE_PATH;
  return value?.trim() ? resolve(value) : undefined;
}

function desktopAppRootFromEnv(): string | undefined {
  const value = process.env.SCIFORGE_DESKTOP_APP_ROOT;
  return value?.trim() ? resolve(value) : undefined;
}

function desktopRendererUrlFromEnv(): string | undefined {
  return desktopRendererUrlFromOption(process.env.SCIFORGE_DESKTOP_RENDERER_URL);
}

function desktopRendererUrlFromOption(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1') return undefined;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function inferDesktopAppRoot(appPath: string | undefined): string | undefined {
  if (!appPath) return undefined;
  const resolved = resolve(appPath);
  if (resolved.endsWith('/dist-desktop/src/desktop')) return resolve(resolved, '..', '..', '..');
  return undefined;
}

function isDirectEntrypoint(): boolean {
  const currentModuleUrl = import.meta.url;
  const electronProcess = process as NodeJS.Process & { defaultApp?: boolean };
  if (isElectronRuntimeProcess() && electronProcess.defaultApp !== true) return true;
  return process.argv
    .filter((arg) => arg && !arg.startsWith('-'))
    .some((arg) => currentModuleUrl === pathToFileURL(resolve(arg)).href);
}

if (isDirectEntrypoint()) {
  logDesktopStartupDebug('direct-entrypoint', {
    argv: process.argv,
    defaultApp: (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp,
    importMetaUrl: import.meta.url,
  });
  const electron = loadElectronRuntime();
  const controller = createElectronDesktopMainController(electron);
  void controller.start().catch((error) => {
    console.error(`[sciforge-desktop] failed to start: ${error instanceof Error ? error.message : String(error)}`);
    electron.app.quit();
  });
}

function logDesktopStartupDebug(event: string, payload: Record<string, unknown>): void {
  if (process.env.SCIFORGE_DESKTOP_STARTUP_DEBUG !== '1') return;
  console.error(`[sciforge-desktop] ${JSON.stringify({ event, ...payload })}`);
}
