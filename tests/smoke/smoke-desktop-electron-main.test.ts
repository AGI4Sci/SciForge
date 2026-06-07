import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
	  createDefaultDesktopManagedServices,
	  DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL,
	  DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA,
	  createDesktopBrowserHostSurfaceController,
  createDesktopBrowserWindowOptions,
  createDesktopNativeBrowserController,
  createElectronDesktopMainController,
  installSciForgeDesktopPreload,
  registerDesktopIpcHandlers,
  resolveDesktopAppPaths,
  type DesktopContextBridge,
  type DesktopIpcRenderer,
  type ElectronBrowserWindowOptions,
  type ElectronDesktopModule,
} from '../../src/desktop/index.js';
import { createDesktopProductionShellPlan } from '../../src/desktop/production-shell-planner.js';
import { ProductionRuntimeLauncher } from '../../src/runtime/desktop/runtime-launcher.js';
import { DesktopPlatformService } from '../../src/runtime/desktop/platform-service.js';

test('R-DESK Electron window options load dist-ui with isolated preload only', () => {
  const plan = createDesktopProductionShellPlan({
    projectRoot: process.cwd(),
    runtimeControlUrl: 'http://127.0.0.1:62000',
  });
  const options = createDesktopBrowserWindowOptions(plan);

  assert.equal(options.webPreferences.preload, plan.main.preloadScript.compiledPath);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webviewTag, false);
  assert.equal(plan.renderer.loadStrategy.filePath, join(process.cwd(), 'dist-ui', 'index.html'));
  assert.doesNotMatch(plan.renderer.loadStrategy.fileUrl, /localhost:517/);
});

test('R-DESK default production sidecars include workspace, provider proxy, and Runtime Codex commands', () => {
  const services = createDefaultDesktopManagedServices(process.cwd());

	  assert.deepEqual(services.map((service) => service.id), ['workspace-server', 'provider-proxy', 'runtime-codex']);
	  assert.deepEqual(services.map((service) => service.role), ['workspace-writer', 'provider-proxy', 'runtime-codex']);
	  assert.ok(services.every((service) => service.command === process.execPath));
	  assert.ok(services.some((service) => service.args?.some((arg) => /dist-desktop\/src\/runtime\/workspace-server\.js$/.test(arg))));
		  assert.ok(services.some((service) => service.args?.some((arg) => /dist-desktop\/packages\/workers\/model-router\/src\/cli\.js$/.test(arg))));
	  assert.ok(services.some((service) => service.args?.some((arg) => /dist-desktop\/src\/runtime\/codex\/codex-runtime-standalone-server\.js$/.test(arg))));
	  assert.ok(services.every((service) => !(service.args ?? []).includes('--import')));
	  assert.ok(services.every((service) => !(service.args ?? []).includes('tsx')));
	});

test('R-DESK resolves production-script appPath back to the project root', () => {
  const appPaths = resolveDesktopAppPaths({
    getAppPath: () => join(process.cwd(), 'dist-desktop', 'src', 'desktop'),
  });

  assert.equal(appPaths.appRoot, process.cwd());
  assert.equal(appPaths.sidecarCwd, process.cwd());
});

test('R-DESK main controller starts launcher before loading dist-ui and wires IPC allowlist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-electron-main-test-'));
  const loadedFiles: string[] = [];
  const handledChannels: string[] = [];
  const events: string[] = [];
  const electron = fakeElectron({
    appDataRoot: join(root, 'userData'),
    loadedFiles,
    handledChannels,
    events,
  });
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'appData'),
    requestedControlPort: 0,
  });
  const controller = createElectronDesktopMainController(electron, {
    projectRoot: process.cwd(),
    workspacePath: join(root, 'workspace'),
    launcher,
    platformService: new DesktopPlatformService(),
  });

  const started = await controller.start();
  await controller.shutdown();

  assert.equal(started.plan.fullElectronEntrypointImplemented, true);
	  assert.equal(loadedFiles[0], join(process.cwd(), 'dist-ui', 'index.html'));
	  assert.deepEqual(handledChannels.sort(), [
	    'desktop:annotation-app-window-picker:internal-event',
	    'desktop:annotation-overlay:begin',
	    'desktop:annotation-overlay:cancel',
	    'desktop:annotation-overlay:capture',
	    'desktop:annotation-overlay:create',
	    'desktop:annotation-overlay:internal-event',
	    'desktop:annotation-overlay:show',
	    'desktop:annotation-overlay:start',
	    'desktop:annotation-overlay:status',
    'desktop:annotation-overlay:submit',
    'desktop:annotation-overlay:update',
    'desktop:browser-host-surface:attach',
    'desktop:browser-host-surface:detach',
    'desktop:browser-host-surface:resize',
    'desktop:browser-host-surface:state',
	    'desktop:native-browser:back',
	    'desktop:native-browser:forward',
	    'desktop:native-browser:open',
	    'desktop:native-browser:reload',
	    'desktop:native-browser:screenshot',
    'desktop:native-browser:state',
		    'platform:open-external',
	    'platform:pick-directory',
	    'platform:reveal-path',
	    'runtime:config',
	    'runtime:health',
	    'runtime:ready',
    'runtime:shutdown',
  ]);
  assert.deepEqual(events, ['app:before-quit', 'app:window-all-closed']);
});

test('P1-DESK main controller can load the Vite dev URL while preserving the isolated preload bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-electron-main-dev-url-test-'));
  const loadedFiles: string[] = [];
  const loadedUrls: string[] = [];
  const handledChannels: string[] = [];
  const electron = fakeElectron({
    appDataRoot: join(root, 'userData'),
    loadedFiles,
    loadedUrls,
    handledChannels,
    events: [],
  });
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'appData'),
    requestedControlPort: 0,
  });
  const controller = createElectronDesktopMainController(electron, {
    projectRoot: process.cwd(),
    workspacePath: join(root, 'workspace'),
    rendererDevServerUrl: 'http://127.0.0.1:5173',
    launcher,
    platformService: new DesktopPlatformService(),
  });

  const started = await controller.start();
  await controller.shutdown();

  assert.deepEqual(loadedFiles, []);
  assert.deepEqual(loadedUrls, ['http://127.0.0.1:5173']);
  assert.equal(started.plan.fullElectronEntrypointImplemented, true);
  const startedWindow = started.window as typeof started.window & { options: ElectronBrowserWindowOptions };
  assert.equal(startedWindow.options.webPreferences.preload, join(process.cwd(), 'dist-desktop', 'src', 'desktop', 'preload.cjs'));
  assert.equal(startedWindow.options.webPreferences.contextIsolation, true);
  assert.equal(startedWindow.options.webPreferences.nodeIntegration, false);
  assert.ok(handledChannels.includes('runtime:config'));
  assert.ok(handledChannels.includes('desktop:browser-host-surface:attach'));
  assert.equal(handledChannels.some((channel) => channel.includes('virtual-app-screen-surface')), false);
  assert.doesNotMatch(JSON.stringify(started.runtimeConfig), /SCIFORGE_RUNTIME_API_KEY|apiKey|sk-/);
});

test('R-DESK main controller honors isolated desktop userData and workspace env overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-electron-main-env-test-'));
  const previousUserData = process.env.SCIFORGE_DESKTOP_USER_DATA_DIR;
  const previousWorkspace = process.env.SCIFORGE_DESKTOP_WORKSPACE_PATH;
  process.env.SCIFORGE_DESKTOP_USER_DATA_DIR = join(root, 'isolated-userData');
  process.env.SCIFORGE_DESKTOP_WORKSPACE_PATH = join(root, 'isolated-workspace');
  const setPaths: Array<[string, string]> = [];
  const electron = fakeElectron({
    appDataRoot: join(root, 'default-userData'),
    loadedFiles: [],
    handledChannels: [],
    events: [],
    setPaths,
  });
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'unused-workspace'),
    appDataRoot: join(root, 'unused-appData'),
    requestedControlPort: 0,
  });
  const controller = createElectronDesktopMainController(electron, {
    projectRoot: process.cwd(),
    launcher,
    platformService: new DesktopPlatformService(),
  });

  try {
    const started = await controller.start();
    await controller.shutdown();

    assert.deepEqual(setPaths, [['userData', join(root, 'isolated-userData')]]);
    assert.equal(started.runtimeConfig.appDataRoot, join(root, 'isolated-userData'));
    assert.equal(started.runtimeConfig.workspacePath, join(root, 'isolated-workspace'));
  } finally {
    if (previousUserData === undefined) delete process.env.SCIFORGE_DESKTOP_USER_DATA_DIR;
    else process.env.SCIFORGE_DESKTOP_USER_DATA_DIR = previousUserData;
    if (previousWorkspace === undefined) delete process.env.SCIFORGE_DESKTOP_WORKSPACE_PATH;
    else process.env.SCIFORGE_DESKTOP_WORKSPACE_PATH = previousWorkspace;
  }
});

test('R-DESK preload exposes only the narrow desktop bridge API', async () => {
  const exposed: Record<string, unknown> = {};
  const invoked: string[] = [];
  const contextBridge: DesktopContextBridge = {
    exposeInMainWorld(apiKey, api) {
      exposed[apiKey] = api;
    },
  };
  const ipcRenderer: DesktopIpcRenderer = {
    async invoke(channel) {
      invoked.push(channel);
      return { ok: true, channel };
    },
  };

  const api = installSciForgeDesktopPreload({ contextBridge, ipcRenderer });
	  await api.getRuntimeHealth();
	  await api.getRuntimeReady();
	  await api.getRuntimeConfig();
	  await api.requestShutdown();
  await api.openExternal('https://example.com');
  await api.openNativeBrowser('https://www.bing.com');
  await api.nativeBrowserBack();
  await api.nativeBrowserForward();
  await api.nativeBrowserReload();
  await api.getNativeBrowserState();
  await api.captureNativeBrowserScreenshot();
  await api.attachBrowserHostSessionSurface({ sessionId: 'browser-host-1', bounds: { x: 1, y: 2, width: 300, height: 200 } });
  await api.getBrowserHostSessionSurfaceState({ sessionId: 'browser-host-1' });
  await api.detachBrowserHostSessionSurface({ sessionId: 'browser-host-1' });
  await api.startAnnotation(validOneClickDesktopAnnotationRequest());
  await api.startDesktopAnnotation(validOneClickDesktopAnnotationRequest());
  await api.getAnnotationState();
  await api.cancelAnnotation();
  await api.revealPath('/tmp/example');
  await api.pickDirectory('/tmp/workspace');

  assert.equal(exposed.sciforgeDesktop, api);
  assert.deepEqual(invoked, [
	    'runtime:health',
	    'runtime:ready',
	    'runtime:config',
	    'runtime:shutdown',
    'platform:open-external',
    'desktop:native-browser:open',
    'desktop:native-browser:back',
    'desktop:native-browser:forward',
    'desktop:native-browser:reload',
    'desktop:native-browser:state',
    'desktop:native-browser:screenshot',
    'desktop:browser-host-surface:attach',
    'desktop:browser-host-surface:state',
    'desktop:browser-host-surface:detach',
    'desktop:annotation-overlay:start',
    'desktop:annotation-overlay:start',
    'desktop:annotation-overlay:status',
    'desktop:annotation-overlay:cancel',
    'platform:reveal-path',
    'platform:pick-directory',
  ]);
		  assert.deepEqual(Object.keys(api).sort(), [
		    'attachBrowserHostSessionSurface',
      'cancelAnnotation',
		    'captureNativeBrowserScreenshot',
		    'detachBrowserHostSessionSurface',
      'getAnnotationState',
	    'getBrowserHostSessionSurfaceState',
	    'getNativeBrowserState',
	    'getRuntimeConfig',
	    'getRuntimeHealth',
    'getRuntimeReady',
    'nativeBrowserBack',
    'nativeBrowserForward',
    'nativeBrowserReload',
    'openExternal',
	    'openNativeBrowser',
	    'pickDirectory',
	    'requestShutdown',
    'resizeBrowserHostSessionSurface',
    'revealPath',
    'startAnnotation',
    'startDesktopAnnotation',
  ]);
});

test('P1-DESK copied CommonJS preload stays in parity with the TypeScript preload bridge', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'desktop', 'preload.cjs'), 'utf8');
  const exposed: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  const invoked: string[] = [];

  runInNewContext(source, {
    require(name: string) {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(apiKey: string, api: Record<string, (...args: unknown[]) => Promise<unknown>>) {
            exposed[apiKey] = api;
          },
        },
        ipcRenderer: {
          async invoke(channel: string) {
            invoked.push(channel);
            return { ok: true, channel };
          },
        },
      };
    },
  }, { filename: 'src/desktop/preload.cjs' });

  const api = exposed.sciforgeDesktop;
  assert.ok(api);
  await api.startAnnotation(validOneClickDesktopAnnotationRequest());
  await api.startDesktopAnnotation(validOneClickDesktopAnnotationRequest());
  await api.getAnnotationState();
  await api.cancelAnnotation();

  assert.deepEqual(invoked, [
    'desktop:annotation-overlay:start',
    'desktop:annotation-overlay:start',
    'desktop:annotation-overlay:status',
    'desktop:annotation-overlay:cancel',
  ]);
  assert.deepEqual(Object.keys(api).sort(), [
    'attachBrowserHostSessionSurface',
    'cancelAnnotation',
    'captureNativeBrowserScreenshot',
    'detachBrowserHostSessionSurface',
    'getAnnotationState',
    'getBrowserHostSessionSurfaceState',
    'getNativeBrowserState',
    'getRuntimeConfig',
    'getRuntimeHealth',
    'getRuntimeReady',
    'nativeBrowserBack',
    'nativeBrowserForward',
    'nativeBrowserReload',
    'openExternal',
    'openNativeBrowser',
    'pickDirectory',
    'requestShutdown',
    'resizeBrowserHostSessionSurface',
    'revealPath',
    'startAnnotation',
    'startDesktopAnnotation',
  ]);
});

test('P0-DESK annotation overlay preload exposes only trusted internal selection events', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'desktop', 'annotation-overlay-preload.cjs'), 'utf8');
  const exposed: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  const invoked: Array<{ channel: string; payload: Record<string, unknown> }> = [];
  const listeners = new Map<string, Array<(event: unknown, payload: unknown) => void>>();

  runInNewContext(source, {
    require(name: string) {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(apiKey: string, api: Record<string, (...args: unknown[]) => Promise<unknown>>) {
            exposed[apiKey] = api;
          },
        },
        ipcRenderer: {
          async invoke(channel: string, payload: Record<string, unknown>) {
            invoked.push({ channel, payload });
            return { ok: true, channel };
          },
          on(channel: string, listener: (event: unknown, payload: unknown) => void) {
            listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
          },
          removeListener(channel: string, listener: (event: unknown, payload: unknown) => void) {
            listeners.set(channel, (listeners.get(channel) ?? []).filter((candidate) => candidate !== listener));
          },
        },
      };
    },
  }, { filename: 'src/desktop/annotation-overlay-preload.cjs' });

  const api = exposed.sciforgeAnnotationOverlay;
  assert.ok(api);
  assert.deepEqual(Object.keys(api).sort(), [
    'cancelSelection',
    'onActiveDisplayChanged',
    'setActiveDisplay',
    'setDragState',
    'submitSelection',
  ]);
  await api.setActiveDisplay({
    id: 'display-right',
    bounds: { x: 0.2, y: 159.6, width: 1440.1, height: 900.4 },
    scaleFactor: 1.25,
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
    providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
  });
  await api.setDragState({
    active: true,
    display: {
      id: 'display-right',
      bounds: { x: 0.2, y: 159.6, width: 1440.1, height: 900.4 },
      scaleFactor: 1.25,
      rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
      providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
    },
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
    providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
  });
  await api.submitSelection({
    bounds: { x: 10.4, y: -20.6, width: 240.2, height: 160.8 },
    comment: '  Please   inspect\nthis crop.  ',
    display: {
      id: 'display-right',
      bounds: { x: 0.2, y: 159.6, width: 1440.1, height: 900.4 },
      scaleFactor: 1.25,
      rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
      providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
    },
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
    providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
  });
  await api.submitSelection({
    bounds: { x: 12, y: 34, width: 56, height: 78 },
    comment: '',
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
  });
  await api.cancelSelection();
  const activeDisplayPayloads: unknown[] = [];
  const unsubscribe = await api.onActiveDisplayChanged((payload: unknown) => {
    activeDisplayPayloads.push(payload);
  });
  for (const listener of listeners.get('desktop:annotation-overlay:active-display') ?? []) {
    listener({}, {
      id: 'display-left',
      bounds: { x: -1280.2, y: 0.4, width: 1024.2, height: 768.2 },
      scaleFactor: 2,
      rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
      providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
    });
  }
  if (typeof unsubscribe === 'function') unsubscribe();

  assert.deepEqual(invoked.map((item) => item.channel), [
    'desktop:annotation-overlay:internal-event',
    'desktop:annotation-overlay:internal-event',
    'desktop:annotation-overlay:internal-event',
    'desktop:annotation-overlay:internal-event',
    'desktop:annotation-overlay:internal-event',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(invoked[0].payload)), {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-active-display-changed',
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(invoked[1].payload)), {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-drag-state-changed',
    active: true,
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(invoked[2].payload)), {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-submitted',
    bounds: { x: 10, y: -21, width: 240, height: 161 },
    comment: 'Please inspect\nthis crop.',
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(invoked[3].payload)), {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-submitted',
    bounds: { x: 12, y: 34, width: 56, height: 78 },
    comment: '',
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(invoked[4].payload)), {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-cancelled',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(activeDisplayPayloads)), [{
    id: 'display-left',
    bounds: { x: -1280, y: 0, width: 1024, height: 768 },
    scaleFactor: 2,
  }]);
  assertNoRawImagePayload(invoked);
  assertNoRawProviderPayload(invoked);
});

test('P0.2 desktop annotation overlay IPC drives global refs-only annotation lifecycle', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const windows: FakeAnnotationOverlayWindow[] = [];
  class FakeAnnotationOverlayWindow {
    visible = false;
    ignoreMouseEvents = false;
    readonly calls: string[] = [];

    constructor(readonly options: Record<string, any>) {
      windows.push(this);
    }

    async loadFile(): Promise<void> {}
    on(): void {}
    show(): void {
      this.visible = true;
      this.calls.push('show');
    }
    hide(): void {
      this.visible = false;
      this.calls.push('hide');
    }
    isVisible(): boolean {
      return this.visible;
    }
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.calls.push(`setBounds:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`);
    }
    setAlwaysOnTop(flag: boolean, level?: string): void {
      this.calls.push(`setAlwaysOnTop:${flag}:${level ?? 'none'}`);
    }
    setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
      this.ignoreMouseEvents = ignore;
      this.calls.push(`setIgnoreMouseEvents:${ignore}:${options?.forward ? 'forward' : 'none'}`);
    }
  }

  registerDesktopIpcHandlers({
    electron: {
      BrowserWindow: FakeAnnotationOverlayWindow,
      screen: {
        getPrimaryDisplay() {
          return {
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            scaleFactor: 2,
          };
        },
      },
      ipcMain: {
        handle(channel: string, listener: (...args: unknown[]) => unknown) {
          handlers.set(channel, listener);
        },
      },
    } as unknown as ElectronDesktopModule,
    launcher: {
      health: () => ({
        ok: true,
        ready: true,
        schemaVersion: 'sciforge.desktop.launcher-health.v1',
        appData: dummyDesktopAppData(),
        ports: [],
        services: [],
        auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
        productionContract: {
          rendererLoadsBuildArtifact: true,
          startsViteDevServer: false,
          rendererTransport: 'stable-ipc-or-loopback',
          rawProcessOutputSurface: 'folded-audit',
          fixedDevPortsAreContract: false,
        },
      }),
      ready: () => true,
      shutdown: async () => undefined,
    },
    launcherResult: {
      controlUrl: 'http://127.0.0.1:61111',
      auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
      appData: dummyDesktopAppData(),
      ports: [],
    },
    runtimeConfig: {
      schemaVersion: 'sciforge.desktop.runtime-config.v1',
      runtimeControlUrl: 'http://127.0.0.1:61111',
      workspaceWriterBaseUrl: '',
      modelBaseUrl: '',
      runtimeCodexBaseUrl: '',
      workspacePath: '/tmp/workspace',
      appDataRoot: '/tmp/app-data',
      appRoot: process.cwd(),
      sidecarCwd: process.cwd(),
      ports: [],
    },
    platformService: new DesktopPlatformService(),
  });

  const create = handlers.get('desktop:annotation-overlay:create');
  const show = handlers.get('desktop:annotation-overlay:show');
  const begin = handlers.get('desktop:annotation-overlay:begin');
  const update = handlers.get('desktop:annotation-overlay:update');
  const submit = handlers.get('desktop:annotation-overlay:submit');
  const capture = handlers.get('desktop:annotation-overlay:capture');
  const status = handlers.get('desktop:annotation-overlay:status');
  const cancel = handlers.get('desktop:annotation-overlay:cancel');
  assert.equal(typeof create, 'function');
  assert.equal(typeof show, 'function');
  assert.equal(typeof begin, 'function');
  assert.equal(typeof update, 'function');
  assert.equal(typeof submit, 'function');
  assert.equal(typeof capture, 'function');
  assert.equal(typeof status, 'function');
  assert.equal(typeof cancel, 'function');

  assert.equal(asRecord(await create?.({})).overlayCreated, true);
  assert.equal(asRecord(await show?.({})).visible, true);
  const begun = asRecord(await begin?.({}, validDesktopAnnotationStartRequest()));
  assert.equal(begun.overlayCreated, true);
  assert.equal(begun.visible, true);
  assert.equal(begun.clickThrough, false);

  const selection = asRecord(await update?.({}, { bounds: { x: 120, y: 140, width: 160, height: 90 } }));
  assert.equal(selection.status, 'selecting');
  assert.deepEqual(selection.bounds, { x: 20, y: 60, width: 160, height: 90 });
  assert.deepEqual(selection.normalizedBounds, { x: 0.05, y: 0.2, width: 0.4, height: 0.3 });

  const submitted = asRecord(await submit?.({}, {
    comment: 'Comment on the real desktop app.',
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
  }));
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.comment, 'Comment on the real desktop app.');

  const captureResult = asRecord(await capture?.({}));
  assert.equal(captureResult.status, 'blocked');
  assert.equal(captureResult.annotationRef.startsWith('desktop-annotation:workspace/workspace-a/session/session-a/annotation/'), true);
  assert.equal(captureResult.screenshotRef.startsWith('desktop-annotation:workspace/workspace-a/session/session-a/screenshot/'), true);
  assert.equal(captureResult.cropRef.startsWith('desktop-annotation:workspace/workspace-a/session/session-a/crop/'), true);
  assert.equal(asRecord(captureResult.metadata).refsOnly, true);
  assert.match(JSON.stringify(captureResult.metadata), /desktop\.window-capture\.(provider-(unavailable|capture-failed)|window-id-required)/);
  assertNoRawImagePayload(captureResult);

  const afterCapture = asRecord(await status?.({}));
  assert.equal(afterCapture.status, 'idle');
  assert.equal(afterCapture.visible, false);
  assert.equal(afterCapture.clickThrough, true);
  assert.equal(asRecord(await cancel?.({})).status, 'cancelled');
  const idle = asRecord(await status?.({}));
  assert.equal(idle.status, 'idle');
  assert.equal(idle.clickThrough, true);

  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.options.transparent, true);
  assert.equal(windows[0]?.options.alwaysOnTop, true);
  assert.ok(windows[0]?.calls.includes('setAlwaysOnTop:true:screen-saver'));
});

test('P0 desktop annotation capture wires bounded window inventory into screen-region auto-binding', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const captureSelections: Array<Record<string, any>> = [];
  registerDesktopIpcHandlers({
    electron: {
      BrowserWindow: class {
        readonly calls: string[] = [];
        readonly options: Record<string, unknown>;
        visible = false;
        ignoreMouseEvents = false;

        constructor(options: Record<string, unknown>) {
          this.options = options;
        }

        async loadFile(): Promise<void> {}
        on(): void {}
        show(): void { this.visible = true; }
        hide(): void { this.visible = false; }
        isVisible(): boolean { return this.visible; }
        setAlwaysOnTop(flag: boolean, level?: string): void {
          this.calls.push(`setAlwaysOnTop:${flag}:${level ?? 'none'}`);
        }
        setIgnoreMouseEvents(ignore: boolean): void {
          this.ignoreMouseEvents = ignore;
        }
        setBounds(): void {}
      },
      ipcMain: {
        handle(channel: string, listener: (...args: unknown[]) => unknown) {
          handlers.set(channel, listener);
        },
      },
      screen: {
        getPrimaryDisplay() {
          return {
            id: 'display-1',
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            scaleFactor: 2,
          };
        },
      },
    },
    launcher: {
      health: () => ({
        ok: true,
        ready: true,
        schemaVersion: 'sciforge.desktop.launcher-health.v1',
        appData: dummyDesktopAppData(),
        ports: [],
        services: [],
        auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
        productionContract: {
          rendererLoadsBuildArtifact: true,
          startsViteDevServer: false,
          rendererTransport: 'stable-ipc-or-loopback',
          rawProcessOutputSurface: 'folded-audit',
          fixedDevPortsAreContract: false,
        },
      }),
      ready: () => true,
      shutdown: async () => undefined,
    },
    launcherResult: {
      controlUrl: 'http://127.0.0.1:61111',
      auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
      appData: dummyDesktopAppData(),
      ports: [],
    },
    runtimeConfig: {
      schemaVersion: 'sciforge.desktop.runtime-config.v1',
      runtimeControlUrl: 'http://127.0.0.1:61111',
      workspaceWriterBaseUrl: '',
      modelBaseUrl: '',
      runtimeCodexBaseUrl: '',
      workspacePath: '/tmp/workspace',
      appDataRoot: '/tmp/app-data',
      appRoot: process.cwd(),
      sidecarCwd: process.cwd(),
      ports: [],
    },
    platformService: new DesktopPlatformService(),
    desktopAnnotationWindowInventory: {
      screenRegionBindingPermissionStatus: () => 'granted',
      screenRegionBindingWindows: () => [{
        windowRef: 'desktop-window:macos-cg-window-id:78123:pid:777',
        appName: 'Plotter',
        title: 'Plotter - Figure 2',
        pid: 777,
        cgWindowId: 78123,
        bounds: { x: 300, y: 100, width: 700, height: 500 },
        screenId: 'display-1',
        scale: 2,
        rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      }],
    },
    desktopAnnotationWindowCaptureProviders: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async (request: Record<string, unknown>) => {
        captureSelections.push(asRecord(request.selection));
        return {
          captureRef: 'capture:test-window-capture-provider:region',
          imageRef: 'image:test-window-capture-provider:region',
          hash: 'sha256:' + 'f'.repeat(64),
          capturedAt: '2026-06-04T00:00:00.000Z',
        };
      },
    }],
  } as unknown as Parameters<typeof registerDesktopIpcHandlers>[0]);

  const begin = handlers.get('desktop:annotation-overlay:begin');
  const update = handlers.get('desktop:annotation-overlay:update');
  const submit = handlers.get('desktop:annotation-overlay:submit');
  const capture = handlers.get('desktop:annotation-overlay:capture');
  assert.equal(typeof begin, 'function');
  assert.equal(typeof update, 'function');
  assert.equal(typeof submit, 'function');
  assert.equal(typeof capture, 'function');

  await begin?.({}, {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'screen-region:workspace-a/session-a/region-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
  });
  await update?.({}, { bounds: { x: 320, y: 180, width: 360, height: 240 } });
  await submit?.({}, { comment: 'Comment on selected region.' });
  const output = asRecord(await capture?.({}));
  const metadata = asRecord(output.metadata);
  const windowBinding = asRecord(metadata.windowBinding);

  assert.equal(output.status, 'captured');
  assert.equal(windowBinding.status, 'auto-bound');
  assert.equal(windowBinding.windowRef, 'desktop-window:macos-cg-window-id:78123:pid:777');
  assert.deepEqual(windowBinding.windowLocalBounds, { x: 20, y: 80, width: 360, height: 240 });
  assert.equal(metadata.windowRef, 'desktop-window:macos-cg-window-id:78123:pid:777');
  assert.deepEqual(captureSelections.map((selection) => ({
    kind: selection.kind,
    regionRef: selection.regionRef,
    windowRef: selection.windowRef,
    bounds: selection.bounds,
  })), [{
    kind: 'region',
    regionRef: 'screen-region:workspace-a/session-a/region-1',
    windowRef: undefined,
    bounds: { x: 320, y: 180, width: 360, height: 240 },
  }]);
  assertNoRawImagePayload(output);
  assertNoRawProviderPayload(output);
});

test('P0.2 desktop annotation one-click start returns refs-only result without renderer window bounds', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const captureRequests: unknown[] = [];
  registerDesktopIpcHandlers({
	    electron: {
	      BrowserWindow: class {
	        visible = false;
	        async loadFile(): Promise<void> {}
	        on(): void {}
	        show(): void { this.visible = true; }
	        hide(): void { this.visible = false; }
	        isVisible(): boolean { return this.visible; }
	        setBounds(): void {}
	        setAlwaysOnTop(): void {}
	        setIgnoreMouseEvents(): void {}
	      },
      ipcMain: {
        handle(channel: string, listener: (...args: unknown[]) => unknown) {
          handlers.set(channel, listener);
        },
      },
    },
    launcher: {
      health: () => ({
        ok: true,
        ready: true,
        schemaVersion: 'sciforge.desktop.launcher-health.v1',
        appData: dummyDesktopAppData(),
        ports: [],
        services: [],
        auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
        productionContract: {
          rendererLoadsBuildArtifact: true,
          startsViteDevServer: false,
          rendererTransport: 'stable-ipc-or-loopback',
          rawProcessOutputSurface: 'folded-audit',
          fixedDevPortsAreContract: false,
        },
      }),
      ready: () => true,
      shutdown: async () => undefined,
    },
    launcherResult: {
      controlUrl: 'http://127.0.0.1:61111',
      auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
      appData: dummyDesktopAppData(),
      ports: [],
    },
    runtimeConfig: {
      schemaVersion: 'sciforge.desktop.runtime-config.v1',
      runtimeControlUrl: 'http://127.0.0.1:61111',
      workspaceWriterBaseUrl: '',
      modelBaseUrl: '',
      runtimeCodexBaseUrl: '',
      workspacePath: '/tmp/workspace',
      appDataRoot: '/tmp/app-data',
      appRoot: process.cwd(),
      sidecarCwd: process.cwd(),
      ports: [],
    },
    platformService: new DesktopPlatformService(),
    desktopAnnotationInteractiveCapture: {
      async capture(input: unknown) {
        captureRequests.push(input);
        return {
          schemaVersion: 'sciforge.desktop.annotation-overlay.interactive-capture.v1',
          status: 'captured',
          annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed',
          screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed',
          cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed',
          imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed',
          bounds: { x: 0, y: 0, width: 640, height: 480 },
          diagnostics: [{ code: 'desktop.annotation.interactive-capture.captured', refsOnly: true }],
          metadata: { refsOnly: true },
        };
      },
    },
  } as unknown as Parameters<typeof registerDesktopIpcHandlers>[0]);

  const start = handlers.get('desktop:annotation-overlay:start');
  assert.equal(typeof start, 'function');

  const result = asRecord(await start?.({}, validOneClickDesktopAnnotationRequest()));
  assert.equal(result.status, 'captured');
  assert.equal(result.annotationRef, 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed');
  assert.equal(result.screenshotRef, 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed');
  assert.equal(result.cropRef, 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed');
  assert.equal(result.imageRef, 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed');
  assert.deepEqual(result.bounds, { x: 0, y: 0, width: 640, height: 480 });
  assert.equal(asRecord(result.metadata).refsOnly, true);
  assertNoRawImagePayload(result);
  assert.deepEqual(captureRequests, [validOneClickDesktopAnnotationRequest()]);
});

test('P0.2 desktop annotation one-click start strips raw delegate payload fields before returning to renderer', async () => {
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    desktopAnnotationInteractiveCapture: {
      async capture() {
        return {
          schemaVersion: 'sciforge.desktop.annotation-overlay.interactive-capture.v1',
          status: 'captured',
          annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-raw-delegate',
          screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-raw-delegate',
          cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-raw-delegate',
          imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-raw-delegate',
          dataUrl: 'data:image/png;base64,RAW_DELEGATE_IMAGE',
          screenshotBase64: 'RAW_DELEGATE_BASE64',
          rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
          metadata: {
            refsOnly: true,
            providerPayload: { token: 'RAW_DELEGATE_TOKEN_SHOULD_NOT_LEAK' },
            windowBindingCandidates: [{
              windowRef: 'desktop-window:candidate:safe',
              rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
            }],
          },
          diagnostics: [{
            code: 'desktop.annotation.raw-delegate',
            level: 'warning',
            screenshotBase64: 'RAW_DIAGNOSTIC_BASE64',
            providerPayload: { token: 'RAW_DIAGNOSTIC_TOKEN_SHOULD_NOT_LEAK' },
          }],
        };
      },
    },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  assert.equal(typeof start, 'function');

  const result = asRecord(await start?.({}, validOneClickDesktopAnnotationRequest()));
  assert.equal(result.status, 'captured');
  assert.equal(result.annotationRef, 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-raw-delegate');
  assertNoRawImagePayload(result);
  assertNoRawProviderPayload(result);
});

test('P0 desktop annotation blocked screen-region start returns display-scoped diagnostics without phantom evidence refs', async () => {
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    screen: {
      getPrimaryDisplay: () => ({
        id: 'display-main',
        bounds: { x: 10, y: 20, width: 1440, height: 900 },
        scaleFactor: 2,
      }),
    },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  assert.equal(typeof start, 'function');

  const result = asRecord(await start?.({}, validOneClickDesktopAnnotationRequest()));
  const diagnostic = asRecord(result.diagnostics[0]);
  const metadata = asRecord(result.metadata);
  const windowBinding = asRecord(result.windowBinding);

  assert.equal(result.schemaVersion, 'sciforge.desktop.annotation.start-result.v1');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.mode, 'screen-region');
  assert.equal(result.sourceKind, 'screen-region');
  assert.equal(result.coordinateSpace, 'screen-global');
  assert.equal(result.targetRef.startsWith('desktop-screen-region:workspace-a:session-a/'), true);
  assert.equal(result.annotationRef, undefined);
  assert.equal(result.screenshotRef, undefined);
  assert.equal(result.cropRef, undefined);
  assert.equal(result.imageRef, undefined);
  assert.deepEqual(result.refs, []);
  assert.equal(result.bounds, null);
  assert.deepEqual(result.screenBounds, { x: 10, y: 20, width: 1440, height: 900 });
  assert.equal(result.windowBounds, null);
  assert.equal(windowBinding.status, 'blocked');
  assert.equal(windowBinding.reason, 'desktop.annotation.screen-region-interactive-selection-unavailable');
  assert.equal(diagnostic.code, 'desktop.annotation.screen-region-interactive-selection-unavailable');
  assert.equal(diagnostic.refsOnly, true);
  assert.equal(metadata.refsOnly, true);
  assert.equal(metadata.nativeScreenCapture, true);
  assert.equal(metadata.captureProviderReady, false);
  assert.equal(metadata.explicitSelectionRequired, true);
  assert.equal(metadata.interactiveSelectionAvailable, false);
  assert.equal(metadata.windowListPayloadReturned, false);
  assert.equal(metadata.screenshotPayloadReturned, false);
  assert.equal(metadata.providerPayloadReturned, false);
  assert.equal(metadata.displayId, 'display-main');
  assert.equal(metadata.screenId, 'display-main');
  assert.equal(metadata.scale, 2);
  assert.deepEqual(metadata.screenBounds, { x: 10, y: 20, width: 1440, height: 900 });
  assertNoRawImagePayload(result);
});

test('P0 desktop annotation screen-region start can complete through trusted internal overlay events with refs only', async () => {
  const captureInputs: Array<Record<string, any>> = [];
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    screen: {
      getAllDisplays: () => [
        {
          id: 'display-left',
          bounds: { x: -1280, y: 0, width: 1024, height: 768 },
          scaleFactor: 2,
        },
        {
          id: 'display-right',
          bounds: { x: 0, y: 160, width: 1440, height: 900 },
          scaleFactor: 1.25,
        },
      ],
      getPrimaryDisplay: () => ({
        id: 'display-left',
        bounds: { x: -1280, y: 0, width: 1024, height: 768 },
        scaleFactor: 2,
      }),
    },
    desktopAnnotationCaptureProvider: {
      async captureSelection(input: Record<string, any>) {
        captureInputs.push(input);
        const prefix = `desktop-annotation:workspace/${input.workspaceId}/session/${input.sessionId}/`;
        return {
          status: 'captured',
          screenshotRef: `${prefix}screenshot/${input.captureId}`,
          cropRef: `${prefix}crop/${input.captureId}`,
          imageRef: `${prefix}image/${input.captureId}`,
          hash: 'sha256:screen-region-internal-bridge',
          capturedAt: '2026-06-04T00:00:01.000Z',
          metadata: {
            refsOnly: true,
            windowBinding: {
              status: 'unbound',
              reason: 'desktop.screen-region-binding.desktop-region',
              targetRef: input.targetRef,
              sourceKind: 'screen-region',
              coordinateSpace: 'screen-global',
              screenBounds: input.screenBounds,
              displayId: input.displayId,
              screenId: input.screenId,
              scale: input.scale,
            },
          },
        };
      },
    },
    desktopAnnotationScreenRegionOverlayBridge: { trusted: true },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  const internalEvent = handlers.get('desktop:annotation-overlay:internal-event');
  assert.equal(typeof start, 'function');
  assert.equal(typeof internalEvent, 'function');

  const pendingResult = start?.({}, validOneClickDesktopAnnotationRequest());
  const dragResult = asRecord(await internalEvent?.({}, {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-drag-state-changed',
    active: true,
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
  }));
  const eventResult = asRecord(await internalEvent?.({}, {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-submitted',
    bounds: { x: -500, y: 100, width: 620, height: 120 },
    display: {
      id: 'display-right',
      bounds: { x: 0, y: 160, width: 1440, height: 900 },
      scaleFactor: 1.25,
    },
    comment: 'Please inspect this region.',
    threadId: 'thread-1',
    messageDraftId: 'draft-1',
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
  }));
  const result = asRecord(await pendingResult);

  assert.equal(dragResult.status, 'drag-state-updated');
  assertNoRawImagePayload(dragResult);
  assertNoRawProviderPayload(dragResult);
  assert.equal(eventResult.status, 'captured');
  assert.equal(result.status, 'captured');
  assert.equal(result.schemaVersion, 'sciforge.desktop.annotation-overlay.capture.v1');
  assert.equal(result.sourceKind, 'screen-region');
  assert.equal(result.coordinateSpace, 'screen-global');
  assert.equal(result.workspaceId, 'workspace-a');
  assert.equal(result.sessionId, 'session-a');
  assert.equal(result.windowRef, undefined);
  assert.equal(result.targetRef.startsWith('desktop-screen-region:workspace-a:session-a/'), true);
  assert.deepEqual(result.screenBounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.deepEqual(result.bounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.equal(result.metadata.displayId, 'display-right');
  assert.equal(result.metadata.screenId, 'display-right');
  assert.equal(result.metadata.scale, 1.25);
  assert.deepEqual(result.metadata.windowBinding.screenBounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.equal(result.metadata.windowBinding.displayId, 'display-right');
  assert.equal(result.metadata.windowBinding.screenId, 'display-right');
  assert.equal(result.metadata.windowBinding.scale, 1.25);
  assert.equal(result.comment, 'Please inspect this region.');
  assert.equal(result.threadId, 'thread-1');
  assert.equal(result.messageDraftId, 'draft-1');
  assert.equal(result.annotationRef.startsWith('desktop-annotation:workspace/workspace-a/session/session-a/annotation/'), true);
  assert.equal(result.screenshotRef.startsWith('desktop-annotation:workspace/workspace-a/session/session-a/screenshot/'), true);
  assert.equal(result.cropRef.startsWith('desktop-annotation:workspace/workspace-a/session/session-a/crop/'), true);
  assert.equal(result.imageRef.startsWith('desktop-annotation:workspace/workspace-a/session/session-a/image/'), true);
  assert.deepEqual(result.refs, [
    result.annotationRef,
    result.screenshotRef,
    result.cropRef,
    result.imageRef,
  ]);
  assert.equal(captureInputs.length, 1);
  assert.deepEqual(captureInputs[0].screenBounds, { x: 0, y: 160, width: 120, height: 60 });
  assert.equal(captureInputs[0].sourceKind, 'screen-region');
  assert.equal(captureInputs[0].coordinateSpace, 'screen-global');
  assert.equal(captureInputs[0].windowRef, undefined);
  assert.equal(captureInputs[0].displayId, 'display-right');
  assert.equal(captureInputs[0].screenId, 'display-right');
  assert.equal(captureInputs[0].scale, 1.25);
  assertNoRawImagePayload(result);
  assertNoRawProviderPayload(result);
  assertNoRawImagePayload(eventResult);
  assertNoRawProviderPayload(eventResult);
});

test('P0 desktop annotation app-window start completes through trusted internal overlay events', async () => {
  const captureInputs: Array<Record<string, any>> = [];
  const selectedWindow = {
    windowRef: 'desktop-window:paper-reader:window-42',
    targetRef: 'desktop-window:paper-reader:window-42',
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Paper Reader - Figure 1',
    windowBounds: { x: 80, y: 40, width: 900, height: 640 },
  };
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    desktopAnnotationAppWindowSelection: {
      async select() {
        return {
          schemaVersion: 'sciforge.desktop.annotation.app-window-selection-result.v1',
          status: 'selected',
          ...selectedWindow,
        };
      },
    },
    desktopAnnotationCaptureProvider: {
      async captureSelection(input: Record<string, any>) {
        captureInputs.push(input);
        const prefix = `desktop-annotation:workspace/${input.workspaceId}/session/${input.sessionId}/`;
        return {
          status: 'captured',
          screenshotRef: `${prefix}screenshot/app-window-internal-event`,
          cropRef: `${prefix}crop/app-window-internal-event`,
          imageRef: `${prefix}image/app-window-internal-event`,
          hash: 'sha256:app-window-internal-event',
          capturedAt: '2026-06-04T00:00:01.000Z',
          metadata: {
            refsOnly: true,
            windowBinding: {
              status: 'manual-bound',
              reason: 'App window annotation was explicitly selected by the user.',
              windowRef: input.windowRef,
              targetRef: input.targetRef,
              sourceKind: input.sourceKind,
              coordinateSpace: input.coordinateSpace,
              windowBounds: input.windowBounds,
              windowLocalBounds: input.windowLocalBounds,
            },
          },
        };
      },
    },
    desktopAnnotationScreenRegionOverlayBridge: { trusted: true },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  const internalEvent = handlers.get('desktop:annotation-overlay:internal-event');
  const status = handlers.get('desktop:annotation-overlay:status');
  assert.equal(typeof start, 'function');
  assert.equal(typeof internalEvent, 'function');
  assert.equal(typeof status, 'function');

  const pendingResult = start?.({}, {
    ...validOneClickDesktopAnnotationRequest(),
    mode: 'app-window',
    purpose: 'comment-explicit-app-window',
  });
  await Promise.resolve();
  assert.equal(asRecord(await status?.({})).status, 'selecting');
  assert.equal(asRecord(await status?.({})).visible, true);

  const eventResult = asRecord(await internalEvent?.({}, {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-submitted',
    bounds: { x: 120, y: 160, width: 240, height: 120 },
    comment: '',
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_SCREENSHOT_BASE64_SHOULD_NOT_LEAK',
    providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
  }));
  const result = asRecord(await pendingResult);

  assert.equal(eventResult.status, 'captured');
  assert.equal(result.status, 'captured');
  assert.equal(result.sourceKind, 'window');
  assert.equal(result.coordinateSpace, 'window-local');
  assert.equal(result.windowRef, selectedWindow.windowRef);
  assert.equal(result.targetRef, selectedWindow.targetRef);
  assert.equal(result.comment, '');
  assert.deepEqual(result.windowBounds, selectedWindow.windowBounds);
  assert.deepEqual(result.windowLocalBounds, { x: 40, y: 120, width: 240, height: 120 });
  assert.equal(asRecord(await status?.({})).status, 'idle');
  assert.equal(asRecord(await status?.({})).visible, false);
  assert.equal(captureInputs.length, 1);
  assert.equal(captureInputs[0].sourceKind, 'window');
  assert.equal(captureInputs[0].coordinateSpace, 'window-local');
  assert.equal(captureInputs[0].windowRef, selectedWindow.windowRef);
  assert.deepEqual(captureInputs[0].windowLocalBounds, { x: 40, y: 120, width: 240, height: 120 });
  assertNoRawImagePayload(result);
  assertNoRawProviderPayload(result);
  assertNoRawImagePayload(eventResult);
  assertNoRawProviderPayload(eventResult);

  const cancelPendingResult = start?.({}, {
    ...validOneClickDesktopAnnotationRequest(),
    mode: 'app-window',
    purpose: 'comment-explicit-app-window',
  });
  await Promise.resolve();
  assert.equal(asRecord(await status?.({})).status, 'selecting');
  const cancelResult = asRecord(await internalEvent?.({}, {
    schemaVersion: 'sciforge.desktop.annotation-overlay.internal-event.v1',
    event: 'screen-region-selection-cancelled',
  }));
  const cancelled = asRecord(await cancelPendingResult);
  assert.equal(cancelResult.status, 'cancelled');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(asRecord(await status?.({})).status, 'idle');
  assert.equal(asRecord(await status?.({})).visible, false);
});

test('P0 desktop annotation blocked app-window start separates explicit selection diagnostics from screen capture unavailability', async () => {
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    desktopAnnotationWindowInventory: {
      screenRegionBindingPermissionStatus: () => 'unavailable',
      screenRegionBindingWindows: () => [],
    },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  assert.equal(typeof start, 'function');

  const appWindowResult = asRecord(await start?.({}, {
    ...validOneClickDesktopAnnotationRequest(),
    mode: 'app-window',
    purpose: 'comment-explicit-app-window',
  }));
  const screenRegionResult = asRecord(await start?.({}, validOneClickDesktopAnnotationRequest()));
  const appDiagnostic = asRecord(appWindowResult.diagnostics[0]);
  const screenDiagnostic = asRecord(screenRegionResult.diagnostics[0]);
  const appMetadata = asRecord(appWindowResult.metadata);

  assert.equal(appWindowResult.ok, false);
  assert.equal(appWindowResult.status, 'blocked');
  assert.equal(appWindowResult.mode, 'app-window');
  assert.equal(appWindowResult.sourceKind, 'window');
  assert.equal(appWindowResult.coordinateSpace, 'window-local');
  assert.equal(appWindowResult.targetRef.startsWith('desktop-window-selection:workspace-a:session-a/'), true);
  assert.equal(appWindowResult.annotationRef, undefined);
  assert.equal(appWindowResult.screenshotRef, undefined);
  assert.equal(appWindowResult.cropRef, undefined);
  assert.equal(appWindowResult.imageRef, undefined);
  assert.deepEqual(appWindowResult.refs, []);
  assert.equal(appWindowResult.bounds, null);
  assert.equal(appWindowResult.screenBounds, null);
  assert.equal(appWindowResult.windowBounds, null);
  assert.equal(appDiagnostic.code, 'desktop.annotation.app-window-selection-permission-failure');
  assert.equal(appDiagnostic.refsOnly, true);
  assert.equal(appMetadata.refsOnly, true);
  assert.equal(appMetadata.nativeScreenCapture, false);
  assert.equal(appMetadata.captureProviderReady, false);
  assert.equal(appMetadata.explicitSelectionRequired, true);
  assert.equal(appMetadata.explicitAppWindowSelectionRequired, true);
  assert.equal(appMetadata.interactiveSelectionAvailable, false);
  assert.equal(appMetadata.windowListPayloadReturned, false);
  assert.equal(appMetadata.screenshotPayloadReturned, false);
  assert.equal(appMetadata.providerPayloadReturned, false);
  assert.notEqual(appDiagnostic.code, screenDiagnostic.code);
  assert.equal(screenDiagnostic.code, 'desktop.annotation.screen-region-interactive-selection-unavailable');
  assertNoRawImagePayload(appWindowResult);
  assertNoRawImagePayload(screenRegionResult);
});

test('P0 desktop annotation app-window start uses the default refs-only picker provider', async () => {
  const loadedUrls: string[] = [];
  const candidateWindowRef = 'desktop-window:macos-cg-window-id:92817:pid:4242';
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    loadedUrls,
    desktopAnnotationWindowInventory: {
      screenRegionBindingPermissionStatus: () => 'granted',
      screenRegionBindingWindows: () => [{
        windowRef: candidateWindowRef,
        id: 92817,
        pid: 4242,
        appName: 'Paper Reader',
        bundleId: 'com.example.paper-reader',
        title: 'Paper Reader - Figure 1',
        bounds: { x: 80, y: 40, width: 900, height: 640 },
        rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
        screenshotBase64: 'RAW_WINDOW_BASE64_SHOULD_NOT_LEAK',
        providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
      }],
    },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  const pickerEvent = handlers.get(DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL);
  assert.equal(typeof start, 'function');
  assert.equal(typeof pickerEvent, 'function');

  const pendingResult = start?.({}, {
    ...validOneClickDesktopAnnotationRequest(),
    mode: 'app-window',
    purpose: 'comment-explicit-app-window',
  });
  await Promise.resolve();
  await Promise.resolve();
  const pickerUrl = loadedUrls.find((url) => /^data:text\/html;charset=utf-8,/.test(url));
  assert.ok(pickerUrl);
  const pickerHtml = decodeURIComponent(pickerUrl.replace(/^data:text\/html;charset=utf-8,/, ''));
  assert.match(pickerHtml, /sciforgeAppWindowPicker/);
  assert.match(pickerHtml, /desktop-window:macos-cg-window-id:92817:pid:4242/);
  assertNoRawProviderPayload(pickerHtml);
  assertNoRawImagePayload(pickerHtml);
  const pickerId = /const pickerId = "([^"]+)"/.exec(pickerHtml)?.[1];
  assert.ok(pickerId);

  const eventResult = asRecord(await pickerEvent?.({}, {
    schemaVersion: DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA,
    event: 'app-window-selection-selected',
    pickerId,
    windowRef: candidateWindowRef,
    rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    screenshotBase64: 'RAW_WINDOW_BASE64_SHOULD_NOT_LEAK',
  }));
  const result = asRecord(await pendingResult);
  const metadata = asRecord(result.metadata);

  assert.equal(eventResult.status, 'selected');
  assert.equal(result.schemaVersion, 'sciforge.desktop.annotation.start-result.v1');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'selecting');
  assert.equal(result.mode, 'app-window');
  assert.equal(result.sourceKind, 'window');
  assert.equal(result.coordinateSpace, 'window-local');
  assert.equal(result.windowRef, candidateWindowRef);
  assert.equal(result.targetRef, candidateWindowRef);
  assert.deepEqual(result.windowBounds, { x: 80, y: 40, width: 900, height: 640 });
  assert.equal(metadata.appWindowSelectionProviderReady, true);
  assert.equal(metadata.explicitAppWindowSelectionFulfilled, true);
  assert.equal(metadata.windowListPayloadReturned, false);
  assert.equal(metadata.screenshotPayloadReturned, false);
  assert.equal(metadata.providerPayloadReturned, false);
  assertNoRawProviderPayload(result);
  assertNoRawImagePayload(result);
});

test('P0 desktop annotation app-window start uses injected explicit window metadata without raw payloads', async () => {
  const selectionRequests: unknown[] = [];
  const selectedWindow = {
    windowRef: 'desktop-window:paper-reader:window-42',
    targetRef: 'desktop-window:paper-reader:window-42',
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Paper Reader - Figure 1',
    windowBounds: { x: 80, y: 40, width: 900, height: 640 },
  };
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    desktopAnnotationAppWindowSelection: {
      async select(input: unknown) {
        selectionRequests.push(input);
        return {
          schemaVersion: 'sciforge.desktop.annotation.app-window-selection-result.v1',
          status: 'selected',
          ...selectedWindow,
          rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
          screenshotDataUrl: 'data:image/png;base64,RAW_WINDOW_SCREENSHOT',
          screenshotBase64: 'RAW_WINDOW_BASE64',
          providerPayload: { token: 'RAW_PROVIDER_TOKEN_SHOULD_NOT_LEAK' },
        };
      },
    },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  const update = handlers.get('desktop:annotation-overlay:update');
  const status = handlers.get('desktop:annotation-overlay:status');
  assert.equal(typeof start, 'function');
  assert.equal(typeof update, 'function');
  assert.equal(typeof status, 'function');

  const result = asRecord(await start?.({}, {
    ...validOneClickDesktopAnnotationRequest(),
    mode: 'app-window',
    purpose: 'comment-explicit-app-window',
  }));
  const metadata = asRecord(result.metadata);
  const windowBinding = asRecord(result.windowBinding);
  const owner = asRecord(result.owner);
  const selectorRequest = asRecord(selectionRequests[0]);

  assert.equal(selectionRequests.length, 1);
  assert.equal(selectorRequest.schemaVersion, 'sciforge.desktop.annotation.app-window-selection-request.v1');
  assert.equal(selectorRequest.mode, 'app-window');
  assert.equal(selectorRequest.source, 'smoke-test');
  assert.equal(selectorRequest.purpose, 'comment-explicit-app-window');
  assert.equal(selectorRequest.refsOnly, true);
  assert.equal(selectorRequest.explicitSelectionRequired, true);
  assert.deepEqual(asRecord(selectorRequest.owner), { workspaceId: 'workspace-a', sessionId: 'session-a' });

  assert.equal(result.schemaVersion, 'sciforge.desktop.annotation.start-result.v1');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'selecting');
  assert.equal(result.mode, 'app-window');
  assert.equal(result.sourceKind, 'window');
  assert.equal(result.coordinateSpace, 'window-local');
  assert.equal(result.windowRef, selectedWindow.windowRef);
  assert.equal(result.targetRef, selectedWindow.targetRef);
  assert.deepEqual(result.refs, [selectedWindow.windowRef]);
  assert.deepEqual(result.windowBounds, selectedWindow.windowBounds);
  assert.equal(result.windowLocalBounds, null);
  assert.deepEqual(owner, {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: selectedWindow.windowRef,
    targetRef: selectedWindow.targetRef,
  });

  assert.equal(windowBinding.status, 'manual-bound');
  assert.equal(windowBinding.windowRef, selectedWindow.windowRef);
  assert.equal(windowBinding.targetRef, selectedWindow.targetRef);
  assert.equal(windowBinding.appName, selectedWindow.appName);
  assert.equal(windowBinding.bundleId, selectedWindow.bundleId);
  assert.equal(windowBinding.pid, selectedWindow.pid);
  assert.equal(windowBinding.title, selectedWindow.title);
  assert.deepEqual(windowBinding.windowBounds, selectedWindow.windowBounds);

  assert.equal(metadata.refsOnly, true);
  assert.equal(metadata.explicitSelectionRequired, true);
  assert.equal(metadata.explicitAppWindowSelectionRequired, true);
  assert.equal(metadata.interactiveSelectionAvailable, true);
  assert.equal(metadata.windowListPayloadReturned, false);
  assert.equal(metadata.screenshotPayloadReturned, false);
  assert.equal(metadata.providerPayloadReturned, false);
  assert.equal(metadata.windowRef, selectedWindow.windowRef);
  assert.equal(metadata.targetRef, selectedWindow.targetRef);
  assert.equal(metadata.appName, selectedWindow.appName);
  assert.equal(metadata.bundleId, selectedWindow.bundleId);
  assert.equal(metadata.pid, selectedWindow.pid);
  assert.equal(metadata.title, selectedWindow.title);
  assert.deepEqual(metadata.windowBounds, selectedWindow.windowBounds);

  assert.equal(asRecord(await status?.({})).status, 'selecting');
  const selection = asRecord(await update?.({}, { bounds: { x: 110, y: 120, width: 180, height: 90 } }));
  assert.equal(selection.status, 'selecting');
  assert.equal(selection.windowRef, selectedWindow.windowRef);
  assert.equal(selection.targetRef, selectedWindow.targetRef);
  assert.equal(selection.sourceKind, 'window');
  assert.equal(selection.coordinateSpace, 'window-local');
  assert.equal(selection.windowBinding, 'manual-bound');
  assert.deepEqual(selection.windowBounds, selectedWindow.windowBounds);
  assert.deepEqual(selection.windowLocalBounds, { x: 30, y: 80, width: 180, height: 90 });
  assert.deepEqual(selection.windowSummary, {
    appName: selectedWindow.appName,
    bundleId: selectedWindow.bundleId,
    pid: selectedWindow.pid,
    title: selectedWindow.title,
  });

  assertNoRawImagePayload(result);
  assertNoRawProviderPayload(result);
  assertNoRawImagePayload(selection);
  assertNoRawProviderPayload(selection);
});

test('P0 desktop annotation app-window confirm saves empty comments and cancel exits overlay mode', async () => {
  const selectedWindow = {
    windowRef: 'desktop-window:paper-reader:window-42',
    targetRef: 'desktop-window:paper-reader:window-42',
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Paper Reader - Figure 1',
    windowBounds: { x: 80, y: 40, width: 900, height: 640 },
  };
  const handlers = registerDesktopAnnotationStartSmokeHandlers({
    desktopAnnotationAppWindowSelection: {
      async select() {
        return {
          schemaVersion: 'sciforge.desktop.annotation.app-window-selection-result.v1',
          status: 'selected',
          ...selectedWindow,
        };
      },
    },
    desktopAnnotationCaptureProvider: {
      async captureSelection() {
        const prefix = 'desktop-annotation:workspace/workspace-a/session/session-a/';
        return {
          status: 'captured',
          screenshotRef: `${prefix}screenshot/app-window-empty-comment`,
          cropRef: `${prefix}crop/app-window-empty-comment`,
          imageRef: `${prefix}image/app-window-empty-comment`,
          hash: 'sha256-app-window-empty-comment',
          capturedAt: '2026-06-04T00:00:01.000Z',
        };
      },
    },
  });
  const start = handlers.get('desktop:annotation-overlay:start');
  const update = handlers.get('desktop:annotation-overlay:update');
  const submit = handlers.get('desktop:annotation-overlay:submit');
  const capture = handlers.get('desktop:annotation-overlay:capture');
  const cancel = handlers.get('desktop:annotation-overlay:cancel');
  const status = handlers.get('desktop:annotation-overlay:status');
  assert.equal(typeof start, 'function');
  assert.equal(typeof update, 'function');
  assert.equal(typeof submit, 'function');
  assert.equal(typeof capture, 'function');
  assert.equal(typeof cancel, 'function');
  assert.equal(typeof status, 'function');

  const startResult = asRecord(await start?.({}, {
    ...validOneClickDesktopAnnotationRequest(),
    mode: 'app-window',
    purpose: 'comment-explicit-app-window',
  }));
  assert.equal(startResult.status, 'selecting');
  assert.equal(asRecord(await status?.({})).visible, true);

  await update?.({}, { bounds: { x: 120, y: 160, width: 240, height: 120 } });
  const submitted = asRecord(await submit?.({}, { comment: '' }));
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.comment, '');
  const captured = asRecord(await capture?.({}));
  assert.equal(captured.status, 'captured');
  assert.equal(captured.comment, '');
  assert.equal(asRecord(await status?.({})).status, 'idle');
  assert.equal(asRecord(await status?.({})).visible, false);
  assertNoRawImagePayload(captured);
  assertNoRawProviderPayload(captured);

  await start?.({}, {
    ...validOneClickDesktopAnnotationRequest(),
    mode: 'app-window',
    purpose: 'comment-explicit-app-window',
  });
  assert.equal(asRecord(await status?.({})).visible, true);
  const cancelled = asRecord(await cancel?.({}));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(asRecord(await status?.({})).status, 'idle');
  assert.equal(asRecord(await status?.({})).visible, false);
});

test('P0 desktop annotation begin accepts screen-region selections without window bounds', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerDesktopIpcHandlers({
    electron: {
      BrowserWindow: class {
        readonly calls: string[] = [];
        readonly options: Record<string, unknown>;
        visible = false;
        ignoreMouseEvents = false;

        constructor(options: Record<string, unknown>) {
          this.options = options;
        }

        async loadFile(): Promise<void> {}
        on(): void {}
        show(): void { this.visible = true; }
        hide(): void { this.visible = false; }
        isVisible(): boolean { return this.visible; }
        setAlwaysOnTop(flag: boolean, level?: string): void {
          this.calls.push(`setAlwaysOnTop:${flag}:${level ?? 'none'}`);
        }
        setIgnoreMouseEvents(ignore: boolean): void {
          this.ignoreMouseEvents = ignore;
        }
        setBounds(): void {}
      },
      ipcMain: {
        handle(channel: string, listener: (...args: unknown[]) => unknown) {
          handlers.set(channel, listener);
        },
      },
      screen: {
        getPrimaryDisplay() {
          return {
            id: 'display:left-retina',
            bounds: { x: -1440, y: 0, width: 2880, height: 900 },
            scaleFactor: 2,
          };
        },
      },
    },
    launcher: {
      health: () => ({
        ok: true,
        ready: true,
        schemaVersion: 'sciforge.desktop.launcher-health.v1',
        appData: dummyDesktopAppData(),
        ports: [],
        services: [],
        auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
        productionContract: {
          rendererLoadsBuildArtifact: true,
          startsViteDevServer: false,
          rendererTransport: 'stable-ipc-or-loopback',
          rawProcessOutputSurface: 'folded-audit',
          fixedDevPortsAreContract: false,
        },
      }),
      ready: () => true,
      shutdown: async () => undefined,
    },
    launcherResult: {
      controlUrl: 'http://127.0.0.1:61111',
      auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
      appData: dummyDesktopAppData(),
      ports: [],
    },
    runtimeConfig: {
      schemaVersion: 'sciforge.desktop.runtime-config.v1',
      runtimeControlUrl: 'http://127.0.0.1:61111',
      workspaceWriterBaseUrl: '',
      modelBaseUrl: '',
      runtimeCodexBaseUrl: '',
      workspacePath: '/tmp/workspace',
      appDataRoot: '/tmp/app-data',
      appRoot: process.cwd(),
      sidecarCwd: process.cwd(),
      ports: [],
    },
    platformService: new DesktopPlatformService(),
  } as unknown as Parameters<typeof registerDesktopIpcHandlers>[0]);

  const begin = handlers.get('desktop:annotation-overlay:begin');
  const update = handlers.get('desktop:annotation-overlay:update');
  assert.equal(typeof begin, 'function');
  assert.equal(typeof update, 'function');

  const begun = asRecord(await begin?.({}, {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'screen-region:workspace-a/session-a/region-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
  }));
  assert.equal(begun.overlayCreated, true);
  assert.equal(begun.clickThrough, false);

  const selection = asRecord(await update?.({}, { bounds: { x: -100, y: 50, width: 200, height: 100 } }));
  assert.equal(selection.windowRef, undefined);
  assert.equal(selection.windowBinding, 'unbound');
  assert.equal(selection.sourceKind, 'screen-region');
  assert.equal(selection.coordinateSpace, 'screen-global');
  assert.deepEqual(selection.screenBounds, { x: -100, y: 50, width: 200, height: 100 });
  assert.deepEqual(selection.bounds, { x: -100, y: 50, width: 200, height: 100 });
  assert.deepEqual(selection.display, {
    id: 'display:left-retina',
    bounds: { x: -1440, y: 0, width: 2880, height: 900 },
    scaleFactor: 2,
  });
});

test('P0.2 desktop main does not expose VirtualAppScreenSurface IPC on the product preload bridge', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerDesktopIpcHandlers({
	    electron: {
	      BrowserWindow: class {
	        visible = false;
	        async loadFile(): Promise<void> {}
	        on(): void {}
	        show(): void { this.visible = true; }
	        hide(): void { this.visible = false; }
	        isVisible(): boolean { return this.visible; }
	        setBounds(): void {}
	        setAlwaysOnTop(): void {}
	        setIgnoreMouseEvents(): void {}
	      },
      ipcMain: {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
    },
    launcher: {
      health: () => ({
        ok: true,
        ready: true,
        schemaVersion: 'sciforge.desktop.launcher-health.v1',
        appData: dummyDesktopAppData(),
        ports: [],
        services: [],
        auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
        productionContract: {
          rendererLoadsBuildArtifact: true,
          startsViteDevServer: false,
          rendererTransport: 'stable-ipc-or-loopback',
          rawProcessOutputSurface: 'folded-audit',
          fixedDevPortsAreContract: false,
        },
      }),
      ready: () => true,
      shutdown: async () => undefined,
    },
    launcherResult: {
      controlUrl: 'http://127.0.0.1:61111',
      auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
      appData: dummyDesktopAppData(),
      ports: [],
    },
    runtimeConfig: {
      schemaVersion: 'sciforge.desktop.runtime-config.v1',
      runtimeControlUrl: 'http://127.0.0.1:61111',
      workspaceWriterBaseUrl: '',
      modelBaseUrl: '',
      runtimeCodexBaseUrl: '',
      workspacePath: '/tmp/workspace',
      appDataRoot: '/tmp/app-data',
      appRoot: process.cwd(),
      sidecarCwd: process.cwd(),
      ports: [],
    },
    platformService: new DesktopPlatformService(),
  });

  assert.equal(handlers.has('desktop:virtual-app-screen-surface:attach'), false);
  assert.equal(handlers.has('desktop:virtual-app-screen-surface:present'), false);
  assert.equal(handlers.has('desktop:virtual-app-screen-surface:detach'), false);
});

test('R-DESK native browser controller opens frame-blocked sites in an Electron-owned top-level window', async () => {
  const events: string[] = [];
  const clipboardImages: unknown[] = [];
  class FakeNativeBrowserWindow {
    webContents = {
      currentUrl: '',
      getURL: () => this.webContents.currentUrl,
      canGoBack: () => true,
      canGoForward: () => false,
      goBack: () => events.push('goBack'),
      goForward: () => events.push('goForward'),
      reload: () => events.push('reload'),
      async capturePage() {
        return { toDataURL: () => 'data:image/png;base64,test' };
      },
    };

    constructor(readonly options: ElectronBrowserWindowOptions) {}

    async loadFile(): Promise<void> {}

    async loadURL(url: string): Promise<void> {
      this.webContents.currentUrl = url;
      events.push(`loadURL:${url}`);
    }

    on(): void {}
    setMenuBarVisibility(visible: boolean): void { events.push(`menu:${visible}`); }
    show(): void { events.push('show'); }
    focus(): void { events.push('focus'); }
    isDestroyed(): boolean { return false; }
  }

  const controller = createDesktopNativeBrowserController({
    BrowserWindow: FakeNativeBrowserWindow,
    clipboard: {
      writeImage(image) {
        clipboardImages.push(image);
        events.push('clipboard.writeImage');
      },
    },
  });
  const opened = await controller.open('www.bing.com');
  const screenshot = await controller.screenshot();
  const back = controller.back();
  const forward = controller.forward();
  const reload = controller.reload();

  assert.equal(opened.ok, true);
  assert.equal(opened.url, 'https://www.bing.com');
  assert.equal(opened.surface, 'electron-browser-window');
  assert.equal(screenshot.dataUrl, 'data:image/png;base64,test');
  assert.equal(screenshot.clipboardWritten, true);
  assert.equal(clipboardImages.length, 1);
  assert.equal(back.canGoBack, true);
  assert.equal(forward.canGoForward, false);
  assert.equal(reload.ok, true);
  assert.deepEqual(events, [
    'menu:false',
    'loadURL:https://www.bing.com',
    'show',
    'focus',
    'clipboard.writeImage',
    'goBack',
    'focus',
    'focus',
    'reload',
    'focus',
  ]);
});

test('R-DESK BrowserHostSession native surface controller attaches an embedded WebContentsView', async () => {
  const events: string[] = [];
  const inputEvents: Record<string, unknown>[] = [];
  const executedJavaScript: string[] = [];
  class FakeWebContentsView {
    bounds = { x: 0, y: 0, width: 1, height: 1 };
    visible = false;
    webContents = {
      currentUrl: '',
      title: 'Native embedded page',
      async loadURL(url: string) {
        this.currentUrl = url;
        events.push(`loadURL:${url}`);
      },
      getURL() {
        return this.currentUrl;
      },
      getTitle() {
        return this.title;
      },
      canGoBack() {
        return false;
      },
      canGoForward() {
        return false;
      },
      sendInputEvent(event: Record<string, unknown>) {
        inputEvents.push(event);
      },
      async insertText(text: string) {
        events.push(`insertText:${text}`);
      },
      focus() {
        events.push('webContents.focus');
      },
      async executeJavaScript<T = unknown>(code: string) {
        executedJavaScript.push(code);
        return (code.includes('document.elementFromPoint') ? 'pointer' : 'default') as T;
      },
      async capturePage() {
        return { toDataURL: () => 'data:image/png;base64,test' };
      },
    };

    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.bounds = bounds;
      events.push(`bounds:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`);
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
      events.push(`visible:${visible}`);
    }
  }

  const addedViews: unknown[] = [];
  const controller = createDesktopBrowserHostSurfaceController({
    WebContentsView: FakeWebContentsView,
  });
  controller.setMainWindow({
    contentView: {
      addChildView(view) {
        addedViews.push(view);
        events.push('addChildView');
      },
      removeChildView() {
        events.push('removeChildView');
      },
    },
    focus() {
      events.push('window.focus');
    },
  });

  const started = controller.startSession({ sessionId: 'browser-host-native-1', width: 800, height: 600 });
  const navigated = await controller.navigate('browser-host-native-1', { url: 'example.com' });
  const attached = controller.attach({
    sessionId: 'browser-host-native-1',
    bounds: { x: 640, y: 96, width: 720, height: 620 },
    visible: true,
    focus: true,
  });
  await controller.action('browser-host-native-1', { action: 'click', x: 24, y: 32 });
  await controller.action('browser-host-native-1', { action: 'scroll', deltaX: 4, deltaY: -160 });
  await controller.action('browser-host-native-1', { action: 'type', text: 'native input' });
  await controller.action('browser-host-native-1', { action: 'press', key: 'Control+Enter' });
  const cursorState = await controller.action('browser-host-native-1', { action: 'cursor', x: 40, y: 44 });
  const liveState = controller.state('browser-host-native-1');
  const screenshot = await controller.screenshot('browser-host-native-1');
  const detached = controller.detach('browser-host-native-1');

  assert.equal(started.liveSurfaceTransport, 'native-embedded');
  assert.equal(started.owner, 'BrowserHostSession');
  assert.equal(started.adapterRole, 'display-input-adapter');
  assert.equal(navigated.url, 'https://example.com');
  assert.equal(attached.embedded, true);
  assert.equal(attached.secondTruthSource, false);
  assert.deepEqual(attached.bounds, { x: 640, y: 96, width: 720, height: 620 });
  assert.equal(liveState.owner, 'BrowserHostSession');
  assert.equal(liveState.liveSurfaceTransport, 'native-embedded');
  assert.equal(liveState.secondTruthSource, false);
  assert.equal(liveState.embedded, true);
  assert.equal(liveState.visible, true);
  assert.deepEqual(cursorState.diagnostics, ['cursor:pointer']);
  assert.equal(screenshot.dataUrl, 'data:image/png;base64,test');
  assert.equal(detached.visible, false);
  assert.equal(addedViews.length, 1);
  assert.deepEqual(inputEvents, [
    { type: 'mouseDown', x: 24, y: 32, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x: 24, y: 32, button: 'left', clickCount: 1 },
    { type: 'mouseWheel', x: 24, y: 32, deltaX: 4, deltaY: -160 },
    { type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] },
  ]);
  assert.equal(executedJavaScript.length, 1);
  assert.match(executedJavaScript[0], /document\.elementFromPoint\(40, 44\)/);
  assert.deepEqual(events, [
    'visible:false',
    'loadURL:https://example.com',
    'addChildView',
    'bounds:640,96,720,620',
    'visible:true',
    'window.focus',
    'webContents.focus',
    'insertText:native input',
    'visible:false',
    'removeChildView',
  ]);
});

function validVirtualAppScreenSurfaceRequest() {
  return {
    kind: 'right-pane-virtual-app-screen-surface',
    sessionRef: 'computer-use:native-host/run-live/session.json',
    liveSurfaceRef: 'computer-use:native-host/run-live/live-surface.json',
    frameStreamRef: 'computer-use:native-host/run-live/frame-stream.json',
    currentFrameRef: 'computer-use:native-host/run-live/frames/current.png',
    liveBindingAttachGrantRef: 'computer-use:native-host/run-live/live-binding-attach-grant.json',
    liveBindingAttachGrantStatus: 'validated',
    grantValidationRef: 'computer-use:native-host/run-live/grant-validation.json',
    grantValidationStatus: 'validated',
    surfaceTransportRef: 'computer-use:native-host/run-live/surface-transport.json',
    surfaceTransport: 'native-frame-stream',
    platformDriverRef: 'computer-use:native-host/run-live/platform-driver.json',
    platformDriverStatus: 'ready',
    evidenceLedgerRef: 'computer-use:native-host/run-live/evidence-ledger.json',
    currentFrameSequence: {
      ref: 'computer-use:native-host/run-live/frame-sequence.json',
      sequence: 23,
    },
    surfaceTransportDescriptor: {
      owner: 'VirtualDisplayProvider',
      providerId: 'provider:run-live',
      transport: 'native-frame-stream',
      surfaceTransportRef: 'computer-use:native-host/run-live/surface-transport.json',
      liveSurfaceRef: 'computer-use:native-host/run-live/live-surface.json',
      frameStreamRef: 'computer-use:native-host/run-live/frame-stream.json',
      currentFrameRef: 'computer-use:native-host/run-live/frames/current.png',
      frameTransportContractRef: 'computer-use:native-host/run-live/frame-contract.json',
      frameTelemetryRef: 'computer-use:native-host/run-live/frame-telemetry.json',
      mediaChannelRef: 'computer-use:native-host/run-live/media-channel.json',
      dataChannelRef: 'computer-use:native-host/run-live/data-channel.json',
      currentFrameSequence: 23,
      diagnosticOnly: false,
      productFallback: false,
      singleInteractiveTruth: true,
    },
    bounds: { x: 10, y: 20, width: 640, height: 480 },
    visible: true,
    focus: false,
  };
}

function dummyDesktopAppData() {
  return {
    schemaVersion: 'sciforge.desktop.app-data.v1',
    appName: 'SciForge',
    appDataRoot: '/tmp/app-data',
    configDir: '/tmp/app-data/config',
    runtimeCodexRoot: '/tmp/app-data/runtime-codex',
    runtimeCodexHome: '/tmp/app-data/runtime-codex/codex-home',
    logDir: '/tmp/app-data/logs',
    cacheDir: '/tmp/app-data/cache',
    globalStateDir: '/tmp/app-data/state',
    userWorkspaceStateDir: '/tmp/workspace/.sciforge',
  } as const;
}

function registerDesktopAnnotationStartSmokeHandlers(input: {
  screen?: ElectronDesktopModule['screen'];
  desktopAnnotationInteractiveCapture?: { capture(input: unknown): Promise<unknown> | unknown };
  desktopAnnotationCaptureProvider?: { captureSelection(input: any): Promise<unknown> | unknown };
  desktopAnnotationWindowInventory?: {
    screenRegionBindingPermissionStatus(): 'granted' | 'denied' | 'unavailable';
    screenRegionBindingWindows(): Array<Record<string, unknown>>;
  };
  desktopAnnotationScreenRegionOverlayBridge?: { trusted: true };
  desktopAnnotationAppWindowSelection?: { select(input: unknown): Promise<unknown> | unknown };
  loadedUrls?: string[];
} = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerDesktopIpcHandlers({
	    electron: {
		      BrowserWindow: class {
		        visible = false;
		        async loadFile(): Promise<void> {}
		        async loadURL(url: string): Promise<void> { input.loadedUrls?.push(url); }
		        on(): void {}
		        show(): void { this.visible = true; }
		        focus(): void {}
		        close(): void { this.visible = false; }
		        hide(): void { this.visible = false; }
		        isVisible(): boolean { return this.visible; }
	        setBounds(): void {}
	        setAlwaysOnTop(): void {}
	        setIgnoreMouseEvents(): void {}
	      },
      ipcMain: {
        handle(channel: string, listener: (...args: unknown[]) => unknown) {
          handlers.set(channel, listener);
        },
      },
      ...(input.screen ? { screen: input.screen } : {}),
    },
    launcher: {
      health: () => ({
        ok: true,
        ready: true,
        schemaVersion: 'sciforge.desktop.launcher-health.v1',
        appData: dummyDesktopAppData(),
        ports: [],
        services: [],
        auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
        productionContract: {
          rendererLoadsBuildArtifact: true,
          startsViteDevServer: false,
          rendererTransport: 'stable-ipc-or-loopback',
          rawProcessOutputSurface: 'folded-audit',
          fixedDevPortsAreContract: false,
        },
      }),
      ready: () => true,
      shutdown: async () => undefined,
    },
    launcherResult: {
      controlUrl: 'http://127.0.0.1:61111',
      auditLogPath: '/tmp/sciforge-runtime-audit.ndjson',
      appData: dummyDesktopAppData(),
      ports: [],
    },
    runtimeConfig: {
      schemaVersion: 'sciforge.desktop.runtime-config.v1',
      runtimeControlUrl: 'http://127.0.0.1:61111',
      workspaceWriterBaseUrl: '',
      modelBaseUrl: '',
      runtimeCodexBaseUrl: '',
      workspacePath: '/tmp/workspace',
      appDataRoot: '/tmp/app-data',
      appRoot: process.cwd(),
      sidecarCwd: process.cwd(),
      ports: [],
    },
    platformService: new DesktopPlatformService(),
    ...(input.desktopAnnotationInteractiveCapture ? { desktopAnnotationInteractiveCapture: input.desktopAnnotationInteractiveCapture } : {}),
    ...(input.desktopAnnotationCaptureProvider ? { desktopAnnotationCaptureProvider: input.desktopAnnotationCaptureProvider } : {}),
    ...(input.desktopAnnotationWindowInventory ? { desktopAnnotationWindowInventory: input.desktopAnnotationWindowInventory } : {}),
    ...(input.desktopAnnotationScreenRegionOverlayBridge ? { desktopAnnotationScreenRegionOverlayBridge: input.desktopAnnotationScreenRegionOverlayBridge } : {}),
    ...(input.desktopAnnotationAppWindowSelection ? { desktopAnnotationAppWindowSelection: input.desktopAnnotationAppWindowSelection } : {}),
  } as unknown as Parameters<typeof registerDesktopIpcHandlers>[0]);
  return handlers;
}

function validVirtualAppScreenSurfaceDetachRequest() {
  return {
    ...validVirtualAppScreenSurfaceRequest(),
    bounds: undefined,
    visible: false,
    focus: undefined,
  };
}

function validDesktopAnnotationStartRequest() {
  return {
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'window:alpha',
    targetRef: 'window-target:alpha',
    windowBounds: { x: 100, y: 80, width: 400, height: 300 },
    sourceKind: 'window',
    coordinateSpace: 'window-local',
  };
}

function validOneClickDesktopAnnotationRequest() {
  return {
    schemaVersion: 'sciforge.desktop.annotation.start.v1',
    mode: 'screen-region',
    source: 'smoke-test',
    purpose: 'comment-any-visible-app',
    locale: 'en-US',
    context: {
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      threadId: 'thread-1',
      messageDraftId: 'draft-1',
    },
    createdAt: '2026-06-04T00:00:00.000Z',
  };
}

function asRecord(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === 'object');
  return value as Record<string, any>;
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertNoRawImagePayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /data:image\//i);
  assert.doesNotMatch(text, /base64/i);
  assert.doesNotMatch(text, /rawScreenshot/i);
  assert.doesNotMatch(text, /screenshotBytes/i);
}

function assertNoRawProviderPayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /"providerPayload"\s*:/i);
  assert.doesNotMatch(text, /"rawWindowList"\s*:/i);
  assert.doesNotMatch(text, /SECRET_WINDOW/i);
  assert.doesNotMatch(text, /RAW_WINDOW/i);
  assert.doesNotMatch(text, /RAW_PROVIDER/i);
  assert.doesNotMatch(text, /RAW_DELEGATE/i);
  assert.doesNotMatch(text, /RAW_DIAGNOSTIC/i);
}

function fakeElectron(input: {
  appDataRoot: string;
  loadedFiles: string[];
  loadedUrls?: string[];
  handledChannels: string[];
  events: string[];
  setPaths?: Array<[string, string]>;
}): ElectronDesktopModule {
  class FakeBrowserWindow {
    constructor(readonly options: ElectronBrowserWindowOptions) {}

    async loadFile(filePath: string): Promise<void> {
      input.loadedFiles.push(filePath);
    }

    async loadURL(url: string): Promise<void> {
      input.loadedUrls?.push(url);
    }

    on(): void {}
  }

  return {
    app: {
      async whenReady() {},
      getPath(name) {
        assert.equal(name, 'userData');
        return input.appDataRoot;
      },
      setPath(name, value) {
        assert.equal(name, 'userData');
        input.appDataRoot = value;
        input.setPaths?.push([name, value]);
      },
      on(event) {
        input.events.push(`app:${event}`);
      },
      quit() {},
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      handle(channel) {
        input.handledChannels.push(channel);
      },
    },
  };
}
