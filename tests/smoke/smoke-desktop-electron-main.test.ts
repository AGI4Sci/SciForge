import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createDefaultDesktopManagedServices,
  createDesktopBrowserWindowOptions,
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
  await api.revealPath('/tmp/example');
  await api.pickDirectory('/tmp/workspace');

  assert.equal(exposed.sciforgeDesktop, api);
  assert.deepEqual(invoked, [
	    'runtime:health',
	    'runtime:ready',
	    'runtime:config',
	    'runtime:shutdown',
    'platform:open-external',
    'platform:reveal-path',
    'platform:pick-directory',
  ]);
	  assert.deepEqual(Object.keys(api).sort(), [
	    'getRuntimeConfig',
	    'getRuntimeHealth',
    'getRuntimeReady',
    'openExternal',
    'pickDirectory',
    'requestShutdown',
    'revealPath',
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
