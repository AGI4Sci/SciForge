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
import {
  createTrustedDesktopAnnotationScreenRegionOverlayBridge,
  type DesktopAnnotationScreenRegionOverlayBridge,
} from './annotation-screen-region-overlay-bridge.js';
import {
  createDesktopAnnotationOverlayController,
  type DesktopAnnotationBeginSelectionInput,
  type DesktopAnnotationBounds,
  type DesktopAnnotationCaptureProvider,
  type DesktopAnnotationCaptureProviderInput,
  type DesktopAnnotationCoordinateSpace,
  type DesktopAnnotationDisplayMetadata,
  type DesktopAnnotationOverlayScreen,
  type DesktopAnnotationOverlayWindow,
  type DesktopAnnotationSourceKind,
} from './annotation-overlay.js';
import {
  createDesktopAnnotationWindowCaptureProvider,
} from './annotation-window-capture-provider.js';
import {
  createDesktopAnnotationMacosWindowInventoryProvider,
  type DesktopAnnotationMacosWindowInventoryProvider,
} from './macos-window-inventory.js';
import {
  createDesktopAnnotationAppWindowSelectionProvider,
} from './app-window-selection-provider.js';
import {
  createDesktopAnnotationAppWindowChooser,
} from './app-window-picker.js';
import type {
  DesktopWindowCaptureProvider,
} from './window-capture.js';

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
  screen?: DesktopAnnotationOverlayScreen;
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
  options: {
    sidecarCwd?: string;
    workspacePath?: string;
    command?: string;
    electronRunAsNode?: boolean;
    env?: Record<string, string>;
  } = {},
): ManagedRuntimeServiceSpec[] {
  const root = resolve(appRoot);
  const sidecarCwd = resolve(options.sidecarCwd ?? directoryCwdForAppRoot(root));
  const workspacePath = options.workspacePath ? resolve(options.workspacePath) : undefined;
  const command = options.command ?? process.execPath;
  const baseEnv = {
    ...(options.electronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...(options.env ?? {}),
  };
  const env = Object.keys(baseEnv).length ? baseEnv : undefined;
  const modelRouterArgs = [
    '--quiet',
    ...(workspacePath ? ['--workspace-root', workspacePath] : []),
  ];
  return [
    compiledJsService('workspace-server', 'workspace-writer', join(root, 'dist-desktop', 'src', 'runtime', 'workspace-server.js'), sidecarCwd, command, [], env),
    compiledJsService('provider-proxy', 'provider-proxy', join(root, 'dist-desktop', 'packages', 'workers', 'model-router', 'src', 'cli.js'), sidecarCwd, command, modelRouterArgs, env),
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
      ? await browserHostSurface.startServer({ url: process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL })
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
        workspacePath,
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
      desktopAnnotationScreenRegionOverlayBridge: createTrustedDesktopAnnotationScreenRegionOverlayBridge(),
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
  electron: Pick<ElectronDesktopModule, 'ipcMain' | 'BrowserWindow' | 'clipboard' | 'screen'>;
  launcher: Pick<ProductionRuntimeLauncher, 'health' | 'ready' | 'shutdown'>;
  launcherResult: RuntimeLauncherStartResult;
	  runtimeConfig: DesktopRuntimeConfig;
	  platformService: DesktopPlatformService;
	  browserHostSurface?: DesktopBrowserHostSurfaceController;
  desktopAnnotationInteractiveCapture?: {
    capture(input: unknown): Promise<unknown> | unknown;
  };
  desktopAnnotationCaptureProvider?: DesktopAnnotationCaptureProvider;
  desktopAnnotationWindowInventory?: DesktopAnnotationMacosWindowInventoryProvider;
  desktopAnnotationWindowCaptureProviders?: DesktopWindowCaptureProvider[];
  desktopAnnotationScreenRegionOverlayBridge?: DesktopAnnotationScreenRegionOverlayBridge;
  desktopAnnotationAppWindowSelection?: {
    select(input: unknown): Promise<unknown> | unknown;
  };
}): void {
  const nativeBrowser = createDesktopNativeBrowserController(input.electron);
  const virtualAppScreenSurface = createDesktopVirtualAppScreenSurfacePresenter();
  const annotationScreen = input.electron.screen ?? fallbackDesktopAnnotationScreen();
  const annotationWindowInventory = input.desktopAnnotationWindowInventory
    ?? createDesktopAnnotationMacosWindowInventoryProvider();
  const annotationCaptureProvider = input.desktopAnnotationCaptureProvider
    ?? createDesktopAnnotationWindowCaptureProvider({
      ...(input.desktopAnnotationWindowCaptureProviders ? { providers: input.desktopAnnotationWindowCaptureProviders } : {}),
      screenRegionBindingWindows: annotationWindowInventory.screenRegionBindingWindows,
      screenRegionBindingPermissionStatus: annotationWindowInventory.screenRegionBindingPermissionStatus,
    });
  const annotationAppWindowSelection = input.desktopAnnotationAppWindowSelection
    ?? createDesktopAnnotationAppWindowSelectionProvider({
      windowInventory: annotationWindowInventory,
      chooseWindow: createDesktopAnnotationAppWindowChooser(input.electron, {
        preloadPath: desktopAnnotationAppWindowPickerPreloadPath(input.runtimeConfig.appRoot),
      }),
    });
  const annotationOverlay = createDesktopAnnotationOverlayController({
    createBrowserWindow(options) {
      const BrowserWindow = input.electron.BrowserWindow as unknown as new(options: unknown) => DesktopAnnotationOverlayWindow;
      return new BrowserWindow(options);
    },
    screen: annotationScreen,
    captureProvider: annotationCaptureProvider,
  }, {
    overlayPreloadPath: desktopAnnotationOverlayPreloadPath(input.runtimeConfig.appRoot),
  });
  let activeTrustedOverlaySelection: {
    request: DesktopAnnotationStartRequest;
    owner: { workspaceId: string; sessionId: string };
    targetRef: string;
    resolve(result: unknown): void;
    reject(error: unknown): void;
  } | undefined;
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
  input.electron.ipcMain.handle('desktop:annotation-overlay:create', () => annotationOverlay.create());
  input.electron.ipcMain.handle('desktop:annotation-overlay:show', () => annotationOverlay.show());
  input.electron.ipcMain.handle('desktop:annotation-overlay:begin', (_event: unknown, value: unknown) => {
    annotationOverlay.create();
    annotationOverlay.show();
    return annotationOverlay.beginSelection(desktopAnnotationBeginSelectionRequest(value));
  });
  input.electron.ipcMain.handle('desktop:annotation-overlay:start', async (_event: unknown, value: unknown) => {
    const request = desktopAnnotationStartRequest(value);
    if (request.mode === 'app-window') {
      const trustedOverlayBridge = input.desktopAnnotationScreenRegionOverlayBridge?.trusted === true;
      if (trustedOverlayBridge && activeTrustedOverlaySelection) {
        return blockedDesktopAnnotationStartResult(
          request,
          activeTrustedOverlayBlockedReason(request.mode),
          annotationScreen,
        );
      }
      return startDesktopAnnotationAppWindowSelection(
        request,
        annotationOverlay,
        annotationAppWindowSelection,
        annotationScreen,
        trustedOverlayBridge
          ? ({ owner, targetRef }) => new Promise((resolveSelection, rejectSelection) => {
            activeTrustedOverlaySelection = {
              request,
              owner,
              targetRef,
              resolve: resolveSelection,
              reject: rejectSelection,
            };
          })
          : undefined,
      );
    }
    if (request.mode === 'screen-region' && input.desktopAnnotationScreenRegionOverlayBridge?.trusted === true) {
      if (activeTrustedOverlaySelection) {
        return blockedDesktopAnnotationStartResult(
          request,
          activeTrustedOverlayBlockedReason(request.mode),
          annotationScreen,
        );
      }
      const owner = annotationOwnerFromContext(request.context);
      const targetRef = blockedDesktopAnnotationTargetRef(request, owner);
      annotationOverlay.create();
      annotationOverlay.show();
      annotationOverlay.beginSelection({
        workspaceId: owner.workspaceId,
        sessionId: owner.sessionId,
        targetRef,
        sourceKind: 'screen-region',
        coordinateSpace: 'screen-global',
      });
      return new Promise((resolveSelection, rejectSelection) => {
        activeTrustedOverlaySelection = {
          request,
          owner,
          targetRef,
          resolve: resolveSelection,
          reject: rejectSelection,
        };
      });
    }
    if (input.desktopAnnotationInteractiveCapture) {
      const result = await input.desktopAnnotationInteractiveCapture.capture(request);
      return sanitizedDesktopAnnotationStartDelegateResult(result, request, annotationScreen);
    }
    return blockedDesktopAnnotationStartResult(
      request,
      blockedReasonForDesktopAnnotationMode(request.mode),
      annotationScreen,
    );
  });
  if (input.desktopAnnotationScreenRegionOverlayBridge?.trusted === true) {
    input.electron.ipcMain.handle('desktop:annotation-overlay:internal-event', async (_event: unknown, value: unknown) => {
      if (!activeTrustedOverlaySelection) {
        return {
          schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event-result.v1',
          ok: false,
          status: 'blocked',
          reason: 'desktop.annotation.overlay-selection-not-active',
          refs: [],
          diagnostics: [{
            code: 'desktop.annotation.overlay-selection-not-active',
            level: 'warning',
            refsOnly: true,
            message: 'No trusted annotation overlay selection is active.',
          }],
          metadata: {
            refsOnly: true,
            windowListPayloadReturned: false,
            screenshotPayloadReturned: false,
            providerPayloadReturned: false,
          },
        };
      }
      const active = activeTrustedOverlaySelection;
      try {
        const internalEvent = desktopAnnotationOverlayInternalEvent(value);
        if (internalEvent.event === 'screen-region-active-display-changed') {
          annotationOverlay.setActiveDisplay({ display: internalEvent.display });
          return {
            schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event-result.v1',
            ok: true,
            status: 'active-display-updated',
            refs: [],
            metadata: {
              refsOnly: true,
              windowListPayloadReturned: false,
              screenshotPayloadReturned: false,
              providerPayloadReturned: false,
            },
          };
        }
        if (internalEvent.event === 'screen-region-selection-drag-state-changed') {
          annotationOverlay.setDragState({
            active: internalEvent.active,
            display: internalEvent.display,
          });
          return {
            schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event-result.v1',
            ok: true,
            status: 'drag-state-updated',
            refs: [],
            metadata: {
              refsOnly: true,
              windowListPayloadReturned: false,
              screenshotPayloadReturned: false,
              providerPayloadReturned: false,
            },
          };
        }
        if (internalEvent.event === 'screen-region-selection-cancelled') {
          const cancelled = annotationOverlay.cancel();
          activeTrustedOverlaySelection = undefined;
          active.resolve(cancelled);
          return cancelled;
        }
        annotationOverlay.updateSelection({ bounds: internalEvent.bounds, display: internalEvent.display });
        annotationOverlay.submitComment({
          comment: internalEvent.comment,
          threadId: internalEvent.threadId,
          messageDraftId: internalEvent.messageDraftId,
        });
        const result = await captureDesktopAnnotationSelection(annotationOverlay);
        activeTrustedOverlaySelection = undefined;
        active.resolve(result);
        return result;
      } catch (error) {
        activeTrustedOverlaySelection = undefined;
        active.reject(error);
        throw error;
      }
    });
  }
  input.electron.ipcMain.handle('desktop:annotation-overlay:update', (_event: unknown, value: unknown) => {
    const record = requireRecord(value, 'desktop:annotation-overlay:update requires an object');
    return annotationOverlay.updateSelection({
      bounds: desktopAnnotationBounds(
        record.bounds,
        'bounds',
      ),
      display: desktopAnnotationOptionalDisplayMetadata(record.display),
    });
  });
  input.electron.ipcMain.handle('desktop:annotation-overlay:submit', (_event: unknown, value: unknown) => {
    const record = requireRecord(value, 'desktop:annotation-overlay:submit requires an object');
    return annotationOverlay.submitComment({
      comment: requireCommentString(record.comment, 'comment'),
      threadId: optionalString(record.threadId, 'threadId'),
      messageDraftId: optionalString(record.messageDraftId, 'messageDraftId'),
    });
  });
  input.electron.ipcMain.handle('desktop:annotation-overlay:capture', () => {
    return captureDesktopAnnotationSelection(annotationOverlay);
  });
  input.electron.ipcMain.handle('desktop:annotation-overlay:cancel', () => {
    const cancelled = annotationOverlay.cancel();
    activeTrustedOverlaySelection?.resolve(cancelled);
    activeTrustedOverlaySelection = undefined;
    return cancelled;
  });
  input.electron.ipcMain.handle('desktop:annotation-overlay:status', () => annotationOverlay.getState());
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

function sanitizedDesktopAnnotationStartDelegateResult(
  result: unknown,
  request: DesktopAnnotationStartRequest,
  screen: DesktopAnnotationOverlayScreen,
): unknown {
  const sanitized = sanitizeDesktopAnnotationRendererPayload(result);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized;
  }
  return blockedDesktopAnnotationStartResult(request, {
    code: 'desktop.annotation.interactive-capture-invalid-result',
    message: 'Desktop annotation interactive capture returned an invalid refs-only result.',
    nativeScreenCapture: request.mode !== 'sciforge-page',
    windowBindingStatus: 'blocked',
    sourceKind: request.mode === 'app-window' ? 'window' : request.mode === 'sciforge-page' ? 'browser' : 'screen-region',
    coordinateSpace: request.mode === 'app-window' ? 'window-local' : request.mode === 'sciforge-page' ? 'browser-viewport' : 'screen-global',
    explicitSelectionRequired: request.mode !== 'sciforge-page',
    ...(request.mode === 'app-window' ? { explicitAppWindowSelectionRequired: true } : {}),
  }, screen);
}

type DesktopAnnotationSelectedAppWindow = {
  windowRef: string;
  targetRef: string;
  windowBounds: DesktopAnnotationBounds;
  windowSummary?: DesktopAnnotationBeginSelectionInput['windowSummary'];
  displayId?: string;
  screenId?: string;
  scale?: number;
};

async function startDesktopAnnotationAppWindowSelection(
  request: DesktopAnnotationStartRequest,
  annotationOverlay: ReturnType<typeof createDesktopAnnotationOverlayController>,
  selectionProvider: { select(input: unknown): Promise<unknown> | unknown },
  screen: DesktopAnnotationOverlayScreen,
  waitForTrustedOverlaySelection?: (input: {
    owner: { workspaceId: string; sessionId: string };
    targetRef: string;
  }) => Promise<unknown>,
): Promise<unknown> {
  const owner = annotationOwnerFromContext(request.context);
  let providerResult: unknown;
  try {
    providerResult = await selectionProvider.select(desktopAnnotationAppWindowSelectionRequest(request, owner));
  } catch (error) {
    return blockedDesktopAnnotationStartResult(request, {
      ...blockedReasonForDesktopAnnotationMode('app-window'),
      code: 'desktop.annotation.app-window-selection-failed',
      message: `App window selection failed before native annotation could start: ${diagnosticMessageFromError(error)}`,
    }, screen);
  }
  const normalized = desktopAnnotationSelectedAppWindow(providerResult);
  if (normalized.status === 'blocked') {
    return blockedDesktopAnnotationStartResult(request, {
      ...blockedReasonForDesktopAnnotationMode('app-window'),
      code: normalized.code,
      message: normalized.message,
    }, screen);
  }
  const selected = normalized.window;
  annotationOverlay.create();
  annotationOverlay.show();
  const overlayState = annotationOverlay.beginSelection({
    workspaceId: owner.workspaceId,
    sessionId: owner.sessionId,
    windowRef: selected.windowRef,
    targetRef: selected.targetRef,
    windowBounds: selected.windowBounds,
    windowSummary: selected.windowSummary,
    sourceKind: 'window',
    coordinateSpace: 'window-local',
  });
  if (waitForTrustedOverlaySelection) {
    return waitForTrustedOverlaySelection({
      owner,
      targetRef: selected.targetRef,
    });
  }
  return desktopAnnotationSelectedAppWindowStartResult(request, owner, selected, overlayState);
}

function desktopAnnotationAppWindowSelectionRequest(
  request: DesktopAnnotationStartRequest,
  owner: { workspaceId: string; sessionId: string },
): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.desktop.annotation.app-window-selection-request.v1',
    mode: 'app-window',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    owner,
    refsOnly: true,
    explicitSelectionRequired: true,
    explicitAppWindowSelectionRequired: true,
    ...(request.source ? { source: request.source } : {}),
    ...(request.purpose ? { purpose: request.purpose } : {}),
    ...(request.createdAt ? { createdAt: request.createdAt } : {}),
    ...(request.locale !== undefined ? { locale: request.locale } : {}),
  };
}

function desktopAnnotationSelectedAppWindow(value: unknown): {
  status: 'selected';
  window: DesktopAnnotationSelectedAppWindow;
} | {
  status: 'blocked';
  code: string;
  message: string;
} {
  const record = requireOptionalRecord(value);
  if (!record) {
    return {
      status: 'blocked',
      code: 'desktop.annotation.app-window-selection-invalid',
      message: 'App window selection provider returned an invalid result.',
    };
  }
  const status = desktopAnnotationSelectionStatus(record.status);
  if (status === 'cancelled') {
    return {
      status: 'blocked',
      code: 'desktop.annotation.app-window-selection-cancelled',
      message: 'App window annotation was cancelled before a window was selected.',
    };
  }
  if (status === 'blocked') {
    return {
      status: 'blocked',
      code: desktopAnnotationSelectionText(record.code) ?? 'desktop.annotation.app-window-selection-blocked',
      message: desktopAnnotationSelectionText(record.message ?? record.reason)
        ?? 'App window selection was blocked before native annotation could start.',
    };
  }
  const selection = requireOptionalRecord(record.window)
    ?? requireOptionalRecord(record.selection)
    ?? record;
  const windowRef = desktopAnnotationSelectionRef(
    selection.windowRef
      ?? record.windowRef
      ?? selection.ref
      ?? selection.targetWindowRef,
  );
  const targetRef = desktopAnnotationSelectionRef(selection.targetRef ?? record.targetRef) ?? windowRef;
  const boundsValue = selection.windowBounds ?? record.windowBounds ?? selection.bounds;
  let windowBounds: DesktopAnnotationBounds | undefined;
  try {
    if (boundsValue !== undefined) windowBounds = desktopAnnotationBounds(boundsValue, 'windowBounds');
  } catch {
    windowBounds = undefined;
  }
  if (!windowRef || !targetRef || !windowBounds) {
    return {
      status: 'blocked',
      code: 'desktop.annotation.app-window-selection-invalid',
      message: 'App window selection requires a bounded windowRef, targetRef, and windowBounds.',
    };
  }
  return {
    status: 'selected',
    window: {
      windowRef,
      targetRef,
      windowBounds,
      windowSummary: desktopAnnotationSelectedWindowSummary(selection, record),
      displayId: desktopAnnotationSelectionText(selection.displayId ?? record.displayId),
      screenId: desktopAnnotationSelectionText(selection.screenId ?? record.screenId ?? selection.displayId ?? record.displayId),
      scale: positiveNumberOrUndefined(selection.scale ?? record.scale ?? selection.scaleFactor ?? record.scaleFactor),
    },
  };
}

function desktopAnnotationSelectionStatus(value: unknown): 'selected' | 'blocked' | 'cancelled' | undefined {
  if (value === 'selected' || value === 'captured' || value === 'ok') return 'selected';
  if (value === 'blocked') return 'blocked';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  return undefined;
}

function desktopAnnotationSelectedWindowSummary(
  selection: Record<string, unknown>,
  result: Record<string, unknown>,
): DesktopAnnotationBeginSelectionInput['windowSummary'] | undefined {
  const summary = requireOptionalRecord(selection.windowSummary)
    ?? requireOptionalRecord(result.windowSummary)
    ?? {};
  const appName = desktopAnnotationSelectionText(selection.appName ?? result.appName ?? summary.appName);
  const bundleId = desktopAnnotationSelectionText(
    selection.bundleId
      ?? result.bundleId
      ?? selection.bundleID
      ?? result.bundleID
      ?? selection.bundleIdentifier
      ?? result.bundleIdentifier
      ?? summary.bundleId
      ?? summary.bundleID
      ?? summary.bundleIdentifier,
  );
  const pid = integerOrUndefined(selection.pid ?? result.pid ?? selection.processId ?? result.processId ?? summary.pid ?? summary.processId);
  const title = desktopAnnotationSelectionText(
    selection.title
      ?? result.title
      ?? selection.windowTitle
      ?? result.windowTitle
      ?? summary.title
      ?? summary.windowTitle,
  );
  const output: NonNullable<DesktopAnnotationBeginSelectionInput['windowSummary']> = {};
  if (appName) output.appName = appName;
  if (bundleId) output.bundleId = bundleId;
  if (pid !== undefined) output.pid = pid;
  if (title) output.title = title;
  return Object.keys(output).length ? output : undefined;
}

function desktopAnnotationSelectionRef(value: unknown): string | undefined {
  const direct = desktopAnnotationSelectionText(value);
  if (direct) return direct;
  const record = requireOptionalRecord(value);
  return desktopAnnotationSelectionText(record?.ref ?? record?.id);
}

function desktopAnnotationSelectionText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = sanitizeDiagnosticText(value.trim());
  return text ? text : undefined;
}

function integerOrUndefined(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function diagnosticMessageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return sanitizeDiagnosticText(error.message);
  if (typeof error === 'string' && error.trim()) return sanitizeDiagnosticText(error);
  return 'unknown error';
}

function desktopAnnotationSelectedAppWindowStartResult(
  request: DesktopAnnotationStartRequest,
  owner: { workspaceId: string; sessionId: string },
  selected: DesktopAnnotationSelectedAppWindow,
  overlayState: ReturnType<ReturnType<typeof createDesktopAnnotationOverlayController>['beginSelection']>,
): Record<string, unknown> {
  const windowBinding = {
    status: 'manual-bound',
    reason: 'desktop.annotation.app-window-explicit-selection-ready',
    windowRef: selected.windowRef,
    targetRef: selected.targetRef,
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    windowBounds: { ...selected.windowBounds },
    ...selected.windowSummary,
    ...(selected.displayId ? { displayId: selected.displayId } : {}),
    ...(selected.screenId ? { screenId: selected.screenId } : {}),
    ...(selected.scale !== undefined ? { scale: selected.scale } : {}),
  };
  return {
    schemaVersion: 'sciforge.desktop.annotation.start-result.v1',
    ok: true,
    status: 'selecting',
    mode: request.mode,
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    owner: {
      ...owner,
      windowRef: selected.windowRef,
      targetRef: selected.targetRef,
    },
    windowRef: selected.windowRef,
    targetRef: selected.targetRef,
    refs: compactDesktopAnnotationRefs([selected.windowRef, selected.targetRef]),
    bounds: null,
    screenBounds: null,
    windowBounds: { ...selected.windowBounds },
    windowLocalBounds: null,
    bindingStatus: 'manual-bound',
    windowBinding,
    overlay: {
      created: overlayState.overlayCreated,
      visible: overlayState.visible,
      clickThrough: overlayState.clickThrough,
    },
    diagnostics: [{
      code: 'desktop.annotation.app-window-explicit-selection-ready',
      level: 'info',
      message: 'App window annotation is ready for a user-selected region inside the selected window.',
      refs: compactDesktopAnnotationRefs([selected.windowRef, selected.targetRef]),
      refsOnly: true,
      mode: request.mode,
      sourceKind: 'window',
      coordinateSpace: 'window-local',
      explicitSelectionRequired: true,
      explicitAppWindowSelectionRequired: true,
      explicitAppWindowSelectionFulfilled: true,
      captureProviderReady: true,
    }],
    metadata: {
      refsOnly: true,
      nativeScreenCapture: true,
      captureProviderReady: true,
      appWindowSelectionProviderReady: true,
      explicitSelectionRequired: true,
      explicitAppWindowSelectionRequired: true,
      explicitAppWindowSelectionFulfilled: true,
      interactiveSelectionAvailable: true,
      sourceKind: 'window',
      coordinateSpace: 'window-local',
      windowRef: selected.windowRef,
      targetRef: selected.targetRef,
      windowBounds: { ...selected.windowBounds },
      ...selected.windowSummary,
      ...(selected.displayId ? { displayId: selected.displayId } : {}),
      ...(selected.screenId ? { screenId: selected.screenId } : {}),
      ...(selected.scale !== undefined ? { scale: selected.scale } : {}),
      windowListPayloadReturned: false,
      screenshotPayloadReturned: false,
      providerPayloadReturned: false,
    },
  };
}

function compactDesktopAnnotationRefs(refs: Array<string | undefined>): string[] {
  return Array.from(new Set(refs.filter((ref): ref is string => Boolean(ref))));
}

function sanitizeDesktopAnnotationRendererPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    const sanitizedItems = value
      .map(sanitizeDesktopAnnotationRendererPayload)
      .filter((item) => item !== undefined);
    return sanitizedItems;
  }
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value) || /;base64,/i.test(value)) return undefined;
    return sanitizeDiagnosticText(value);
  }
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isRejectedDesktopAnnotationRendererPayloadKey(key)) continue;
    const sanitized = sanitizeDesktopAnnotationRendererPayload(nested);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function isRejectedDesktopAnnotationRendererPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.startsWith('raw')
    || normalized === 'dataurl'
    || normalized.includes('base64')
    || normalized.includes('bytes')
    || normalized.includes('buffer')
    || normalized.includes('payload')
    || normalized === 'windowactionsession'
    || normalized === 'windowactionsessionref'
    || normalized === 'actionref'
    || normalized === 'guiexecutable'
    || (normalized.includes('screenshot') && !normalized.endsWith('ref') && !normalized.endsWith('refs'));
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

const DESKTOP_ANNOTATION_CAPTURE_PROVIDER_UNAVAILABLE = 'desktop-annotation-capture-provider-unavailable';
type DesktopAnnotationMode = 'sciforge-page' | 'screen-region' | 'app-window';
type DesktopAnnotationStartRequest = {
  schemaVersion?: string;
  mode: DesktopAnnotationMode;
  source?: string;
  purpose?: string;
  context?: unknown;
  locale?: unknown;
  createdAt?: string;
};

function fallbackDesktopAnnotationScreen(): DesktopAnnotationOverlayScreen {
  return {
    getPrimaryDisplay() {
      return {
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        scaleFactor: 1,
      };
    },
  };
}

function unavailableDesktopAnnotationCaptureProvider() {
  return {
    async captureSelection(input: DesktopAnnotationCaptureProviderInput): Promise<never> {
      void input;
      const error = new Error(DESKTOP_ANNOTATION_CAPTURE_PROVIDER_UNAVAILABLE) as Error & { code?: string };
      error.code = DESKTOP_ANNOTATION_CAPTURE_PROVIDER_UNAVAILABLE;
      throw error;
    },
  };
}

function desktopAnnotationStartRequest(value: unknown): DesktopAnnotationStartRequest {
  const record = requireRecord(value, 'desktop:annotation-overlay:start requires an object');
  const mode = desktopAnnotationMode(record.mode);
  const request: DesktopAnnotationStartRequest = { mode };
  const schemaVersion = optionalString(record.schemaVersion, 'schemaVersion');
  if (schemaVersion) request.schemaVersion = schemaVersion;
  const source = optionalString(record.source, 'source');
  if (source) request.source = source;
  const purpose = optionalString(record.purpose, 'purpose');
  if (purpose) request.purpose = purpose;
  if (record.context !== undefined) request.context = boundedAnnotationContext(record.context);
  if (record.locale !== undefined) request.locale = boundedPrimitive(record.locale);
  const createdAt = optionalString(record.createdAt, 'createdAt');
  if (createdAt) request.createdAt = createdAt;
  return request;
}

function desktopAnnotationMode(value: unknown): DesktopAnnotationMode {
  if (value === 'sciforge-page' || value === 'screen-region' || value === 'app-window') return value;
  throw new Error('desktop:annotation-overlay:start requires mode sciforge-page, screen-region, or app-window');
}

function blockedReasonForDesktopAnnotationMode(mode: DesktopAnnotationMode): {
  code: string;
  message: string;
  nativeScreenCapture: boolean;
  windowBindingStatus: 'unbound' | 'blocked';
  sourceKind: DesktopAnnotationSourceKind;
  coordinateSpace: DesktopAnnotationCoordinateSpace;
  explicitSelectionRequired: boolean;
  explicitAppWindowSelectionRequired?: boolean;
} {
  if (mode === 'sciforge-page') {
    return {
      code: 'desktop.annotation.sciforge-page-dom-fallback',
      message: 'SciForge page annotation stays in the renderer DOM path; native screen capture was not started.',
      nativeScreenCapture: false,
      windowBindingStatus: 'unbound',
      sourceKind: 'browser',
      coordinateSpace: 'browser-viewport',
      explicitSelectionRequired: false,
    };
  }
  if (mode === 'app-window') {
    return {
      code: 'desktop.annotation.app-window-selection-required',
      message: 'App window annotation requires an explicit user-selected window before native capture can start.',
      nativeScreenCapture: false,
      windowBindingStatus: 'blocked',
      sourceKind: 'window',
      coordinateSpace: 'window-local',
      explicitSelectionRequired: true,
      explicitAppWindowSelectionRequired: true,
    };
  }
  return {
    code: 'desktop.annotation.screen-region-interactive-selection-unavailable',
    message: 'Screen region annotation requires an explicit interactive screen selection before native capture can start.',
    nativeScreenCapture: true,
    windowBindingStatus: 'blocked',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    explicitSelectionRequired: true,
  };
}

function activeTrustedOverlayBlockedReason(mode: DesktopAnnotationMode): ReturnType<typeof blockedReasonForDesktopAnnotationMode> {
  if (mode === 'app-window') {
    return {
      code: 'desktop.annotation.app-window-selection-active',
      message: 'A trusted app-window annotation overlay selection is already active.',
      nativeScreenCapture: true,
      windowBindingStatus: 'blocked',
      sourceKind: 'window',
      coordinateSpace: 'window-local',
      explicitSelectionRequired: true,
      explicitAppWindowSelectionRequired: true,
    };
  }
  return {
    code: 'desktop.annotation.screen-region-selection-active',
    message: 'A trusted screen-region annotation overlay selection is already active.',
    nativeScreenCapture: true,
    windowBindingStatus: 'blocked',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    explicitSelectionRequired: true,
  };
}

function blockedDesktopAnnotationStartResult(
  request: DesktopAnnotationStartRequest,
  reason: ReturnType<typeof blockedReasonForDesktopAnnotationMode>,
  screen: DesktopAnnotationOverlayScreen,
) {
  const owner = annotationOwnerFromContext(request.context);
  const display = request.mode === 'screen-region'
    ? desktopAnnotationStartDisplayMetadata(screen)
    : undefined;
  const targetRef = blockedDesktopAnnotationTargetRef(request, owner);
  return {
    schemaVersion: 'sciforge.desktop.annotation.start-result.v1',
    ok: false,
    status: 'blocked',
    mode: request.mode,
    sourceKind: reason.sourceKind,
    coordinateSpace: reason.coordinateSpace,
    targetRef,
    refs: [],
    owner,
    bounds: null,
    screenBounds: display?.bounds ?? null,
    windowBounds: null,
    bindingStatus: reason.windowBindingStatus,
    windowBinding: {
      status: reason.windowBindingStatus,
      reason: reason.code,
      targetRef,
      sourceKind: reason.sourceKind,
      coordinateSpace: reason.coordinateSpace,
      ...(display ? { screenBounds: { ...display.bounds } } : {}),
    },
    diagnostics: [{
      code: reason.code,
      level: 'warning',
      message: reason.message,
      refs: [],
      refsOnly: true,
      mode: request.mode,
      sourceKind: reason.sourceKind,
      coordinateSpace: reason.coordinateSpace,
      explicitSelectionRequired: reason.explicitSelectionRequired,
      captureProviderReady: false,
    }],
    metadata: {
      refsOnly: true,
      nativeScreenCapture: reason.nativeScreenCapture,
      captureProviderReady: false,
      explicitSelectionRequired: reason.explicitSelectionRequired,
      ...(reason.explicitAppWindowSelectionRequired ? { explicitAppWindowSelectionRequired: true } : {}),
      interactiveSelectionAvailable: false,
      sourceKind: reason.sourceKind,
      coordinateSpace: reason.coordinateSpace,
      targetRef,
      ...(display ? {
        displayId: display.displayId,
        screenId: display.screenId,
        ...(display.scale !== undefined ? { scale: display.scale } : {}),
        screenBounds: { ...display.bounds },
      } : {}),
      windowListPayloadReturned: false,
      screenshotPayloadReturned: false,
      providerPayloadReturned: false,
    },
  };
}

function blockedDesktopAnnotationTargetRef(
  request: DesktopAnnotationStartRequest,
  owner: { workspaceId: string; sessionId: string },
): string {
  const suffix = sanitizeRefSegment(request.createdAt ?? `${request.mode}-${Date.now().toString(36)}`);
  const workspaceId = sanitizeRefSegment(owner.workspaceId);
  const sessionId = sanitizeRefSegment(owner.sessionId);
  if (request.mode === 'app-window') return `desktop-window-selection:${workspaceId}:${sessionId}/${suffix}`;
  if (request.mode === 'screen-region') return `desktop-screen-region:${workspaceId}:${sessionId}/${suffix}`;
  return `sciforge-page-annotation:${workspaceId}:${sessionId}/${suffix}`;
}

function desktopAnnotationStartDisplayMetadata(screen: DesktopAnnotationOverlayScreen): {
  displayId?: string;
  screenId?: string;
  scale?: number;
  bounds: DesktopAnnotationBounds;
} {
  const display = screen.getPrimaryDisplay();
  const bounds = desktopAnnotationDisplayBounds(display.bounds);
  const displayId = display.id === undefined ? undefined : sanitizeDiagnosticText(String(display.id));
  const scale = Number.isFinite(display.scaleFactor) && display.scaleFactor && display.scaleFactor > 0
    ? display.scaleFactor
    : undefined;
  return {
    ...(displayId ? { displayId, screenId: displayId } : {}),
    ...(scale !== undefined ? { scale } : {}),
    bounds,
  };
}

function desktopAnnotationDisplayBounds(bounds: DesktopAnnotationBounds): DesktopAnnotationBounds {
  return {
    x: Number.isFinite(bounds.x) ? bounds.x : 0,
    y: Number.isFinite(bounds.y) ? bounds.y : 0,
    width: Number.isFinite(bounds.width) && bounds.width > 0 ? bounds.width : 1,
    height: Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : 1,
  };
}

function annotationOwnerFromContext(context: unknown): { workspaceId: string; sessionId: string } {
  const record = requireOptionalRecord(context);
  return {
    workspaceId: textOrFallback(record?.workspaceId, 'unknown-workspace'),
    sessionId: textOrFallback(record?.sessionId, 'unknown-session'),
  };
}

function boundedAnnotationContext(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 8).map(boundedAnnotationContext).filter((item) => item !== undefined);
  const record = requireOptionalRecord(value);
  if (!record) return undefined;
  const bounded: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record).slice(0, 16)) {
    if (/(?:apiKey|token|secret|password|raw|base64|dataUrl|screenshot|dom|payload)/i.test(key)) continue;
    const next = boundedAnnotationContext(entry);
    if (next !== undefined) bounded[key] = next;
  }
  return Object.keys(bounded).length ? bounded : undefined;
}

function boundedPrimitive(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

type DesktopAnnotationOverlayInternalEvent =
  | {
      event: 'screen-region-selection-submitted';
      bounds: DesktopAnnotationBounds;
      display?: DesktopAnnotationDisplayMetadata;
      comment: string;
      threadId?: string;
      messageDraftId?: string;
    }
  | {
      event: 'screen-region-selection-cancelled';
    }
  | {
      event: 'screen-region-active-display-changed';
      display: DesktopAnnotationDisplayMetadata;
    }
  | {
      event: 'screen-region-selection-drag-state-changed';
      active: boolean;
      display?: DesktopAnnotationDisplayMetadata;
    };

function desktopAnnotationOverlayInternalEvent(value: unknown): DesktopAnnotationOverlayInternalEvent {
  const record = requireRecord(value, 'desktop:annotation-overlay:internal-event requires an object');
  const schemaVersion = optionalString(record.schemaVersion, 'schemaVersion');
  if (schemaVersion && schemaVersion !== 'sciforge.desktop.annotation-overlay.internal-event.v1') {
    throw new Error('desktop:annotation-overlay:internal-event requires schemaVersion sciforge.desktop.annotation-overlay.internal-event.v1');
  }
  if (record.event === 'screen-region-selection-cancelled') {
    return { event: 'screen-region-selection-cancelled' };
  }
  if (record.event === 'screen-region-active-display-changed') {
    return {
      event: 'screen-region-active-display-changed',
      display: desktopAnnotationDisplayMetadata(record.display),
    };
  }
  if (record.event === 'screen-region-selection-drag-state-changed') {
    return {
      event: 'screen-region-selection-drag-state-changed',
      active: record.active === true,
      display: desktopAnnotationOptionalDisplayMetadata(record.display),
    };
  }
  if (record.event !== 'screen-region-selection-submitted') {
    throw new Error('desktop:annotation-overlay:internal-event requires a supported event');
  }
  return {
    event: 'screen-region-selection-submitted',
    bounds: desktopAnnotationBounds(record.bounds, 'bounds'),
    display: desktopAnnotationOptionalDisplayMetadata(record.display),
    comment: requireCommentString(record.comment, 'comment'),
    threadId: optionalString(record.threadId, 'threadId'),
    messageDraftId: optionalString(record.messageDraftId, 'messageDraftId'),
  };
}

function requireOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function sanitizeDiagnosticText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/data:image\/[^,\s]+,?[A-Za-z0-9+/=]*/gi, '[redacted-image]').slice(0, 240);
}

function sanitizeRefSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || 'ref';
}

async function captureDesktopAnnotationSelection(
  annotationOverlay: ReturnType<typeof createDesktopAnnotationOverlayController>,
): Promise<unknown> {
  try {
    return await annotationOverlay.captureSelectionToRefs();
  } catch (error) {
    if (!isDesktopAnnotationCaptureProviderUnavailable(error)) throw error;
    return {
      schemaVersion: 'sciforge.desktop.annotation-overlay.capture-blocked.v1',
      ok: false,
      status: 'blocked',
      reason: DESKTOP_ANNOTATION_CAPTURE_PROVIDER_UNAVAILABLE,
      diagnostic: {
        code: DESKTOP_ANNOTATION_CAPTURE_PROVIDER_UNAVAILABLE,
        level: 'warning',
        refsOnly: true,
        captureProviderReady: false,
        message: 'Desktop annotation capture provider is not configured; no image payload was returned.',
      },
    };
  }
}

function isDesktopAnnotationCaptureProviderUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown };
  return record.code === DESKTOP_ANNOTATION_CAPTURE_PROVIDER_UNAVAILABLE
    || record.message === DESKTOP_ANNOTATION_CAPTURE_PROVIDER_UNAVAILABLE;
}

function desktopAnnotationBeginSelectionRequest(value: unknown): DesktopAnnotationBeginSelectionInput {
  const record = requireRecord(value, 'desktop:annotation-overlay:begin requires an object');
  const request: DesktopAnnotationBeginSelectionInput = {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    sessionId: requireString(record.sessionId, 'sessionId'),
  };
  if (record.windowBounds !== undefined) request.windowBounds = desktopAnnotationBounds(record.windowBounds, 'windowBounds');
  const windowRef = optionalString(record.windowRef, 'windowRef');
  if (windowRef) request.windowRef = windowRef;
  const targetRef = optionalString(record.targetRef, 'targetRef');
  if (targetRef) request.targetRef = targetRef;
  const windowSummary = desktopAnnotationSelectedWindowSummary(record, record);
  if (windowSummary) request.windowSummary = windowSummary;
  const sourceKind = optionalDesktopAnnotationSourceKind(record.sourceKind);
  if (sourceKind) request.sourceKind = sourceKind;
  const coordinateSpace = optionalDesktopAnnotationCoordinateSpace(record.coordinateSpace);
  if (coordinateSpace) request.coordinateSpace = coordinateSpace;
  return request;
}

function desktopAnnotationBounds(value: unknown, label: string): DesktopAnnotationBounds {
  const record = requireRecord(value, `desktop:annotation-overlay requires ${label}`);
  return {
    x: annotationNumberField(record.x, `${label}.x`),
    y: annotationNumberField(record.y, `${label}.y`),
    width: annotationNumberField(record.width, `${label}.width`),
    height: annotationNumberField(record.height, `${label}.height`),
  };
}

function desktopAnnotationOptionalDisplayMetadata(value: unknown): DesktopAnnotationDisplayMetadata | undefined {
  if (value === undefined || value === null) return undefined;
  const record = requireRecord(value, 'desktop:annotation-overlay requires display');
  const display: DesktopAnnotationDisplayMetadata = {
    bounds: desktopAnnotationBounds(record.bounds, 'display.bounds'),
  };
  const id = optionalString(record.id ?? record.displayId ?? record.screenId, 'display.id');
  if (id) display.id = id;
  const displayId = optionalString(record.displayId, 'display.displayId');
  if (displayId) display.displayId = displayId;
  const screenId = optionalString(record.screenId ?? record.displayId ?? record.id, 'display.screenId');
  if (screenId) display.screenId = screenId;
  const scaleFactor = optionalAnnotationNumberField(record.scaleFactor ?? record.scale, 'display.scaleFactor');
  if (scaleFactor !== undefined) display.scaleFactor = scaleFactor;
  return display;
}

function desktopAnnotationDisplayMetadata(value: unknown): DesktopAnnotationDisplayMetadata {
  const display = desktopAnnotationOptionalDisplayMetadata(value);
  if (!display) throw new Error('desktop:annotation-overlay:internal-event requires display metadata');
  return display;
}

function optionalDesktopAnnotationSourceKind(value: unknown): DesktopAnnotationSourceKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'window' || value === 'screen-region' || value === 'browser' || value === 'image') return value;
  throw new Error('desktop:annotation-overlay:begin requires valid sourceKind');
}

function optionalDesktopAnnotationCoordinateSpace(value: unknown): DesktopAnnotationCoordinateSpace | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'window-local' || value === 'screen-global' || value === 'browser-viewport' || value === 'image-local') {
    return value;
  }
  throw new Error('desktop:annotation-overlay:begin requires valid coordinateSpace');
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error(message);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`desktop:annotation-overlay requires non-empty ${field}`);
  }
  return value.trim();
}

function requireCommentString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`desktop:annotation-overlay requires string ${field}`);
  }
  return value.replace(/\r\n?/g, '\n').slice(0, 1000);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field);
}

function annotationNumberField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`desktop:annotation-overlay requires numeric ${field}`);
  }
  return value;
}

function optionalAnnotationNumberField(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return annotationNumberField(value, field);
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

function desktopAnnotationOverlayPreloadPath(appRoot: string): string {
  return join(resolve(appRoot), 'dist-desktop', 'src', 'desktop', 'annotation-overlay-preload.cjs');
}

function desktopAnnotationAppWindowPickerPreloadPath(appRoot: string): string {
  return join(resolve(appRoot), 'dist-desktop', 'src', 'desktop', 'app-window-picker-preload.cjs');
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
