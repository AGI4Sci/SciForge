import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createDefaultDesktopManagedServices,
  createDesktopBrowserHostSurfaceController,
  createDesktopBrowserWindowOptions,
  createDesktopNativeBrowserController,
  createElectronDesktopMainController,
  installSciForgeDesktopPreload,
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
	  assert.ok(services.some((service) => service.args?.some((arg) => /dist-desktop\/packages\/backend\/src\/cli\.js$/.test(arg))));
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
	    'desktop:browser-host-surface:attach',
	    'desktop:browser-host-surface:detach',
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
    'platform:reveal-path',
    'platform:pick-directory',
  ]);
	  assert.deepEqual(Object.keys(api).sort(), [
	    'attachBrowserHostSessionSurface',
	    'captureNativeBrowserScreenshot',
	    'detachBrowserHostSessionSurface',
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
    'revealPath',
  ]);
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

function fakeElectron(input: {
  appDataRoot: string;
  loadedFiles: string[];
  handledChannels: string[];
  events: string[];
  setPaths?: Array<[string, string]>;
}): ElectronDesktopModule {
  class FakeBrowserWindow {
    constructor(readonly options: ElectronBrowserWindowOptions) {}

    async loadFile(filePath: string): Promise<void> {
      input.loadedFiles.push(filePath);
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
