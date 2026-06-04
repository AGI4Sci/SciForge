import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  createDesktopDevShellPlan,
  DesktopDevShellController,
  type DesktopDevShellSpawn,
} from '../../tools/desktop-dev-shell.js';
import {
  buildDesktopNativeReadiness,
} from '../../src/desktop/native-readiness.js';
import {
  ProductionRuntimeLauncher,
  type ManagedRuntimeServiceSpec,
  type SpawnManagedProcess,
} from '../../src/runtime/desktop/runtime-launcher.js';

test('P1-DESK dev shell plans Vite, workspace/runtime sidecars, Electron, and sanitized native readiness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-shell-plan-'));
  const configPath = join(root, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      apiKey: 'sk-local-config-secret',
      baseUrl: 'https://provider.example.test/v1',
      model: 'bailian/deepseek-v4-flash',
    },
  }), 'utf8');

  const plan = createDesktopDevShellPlan({
    projectRoot: process.cwd(),
    workspacePath: join(root, 'workspace'),
    configPath,
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'env-secret-wins',
    },
    nativeAdapterUrl: 'http://127.0.0.1:61337/native?apiKey=sk-native-secret',
  });

  assert.equal(plan.schemaVersion, 'sciforge.desktop.dev-shell-plan.v1');
  assert.equal(plan.renderer.kind, 'vite-dev-server');
  assert.equal(plan.renderer.hotReload, true);
  assert.equal(plan.electron.rendererLoad, 'loadURL-vite-dev-server');
  assert.deepEqual(plan.processes.map((process) => process.id), [
    'vite',
    'workspace-writer',
    'provider-proxy',
    'runtime-codex',
    'electron',
  ]);

  const vite = plan.processes.find((process) => process.id === 'vite');
  const workspace = plan.processes.find((process) => process.id === 'workspace-writer');
  const providerProxy = plan.processes.find((process) => process.id === 'provider-proxy');
  const runtimeCodex = plan.processes.find((process) => process.id === 'runtime-codex');
  const electron = plan.processes.find((process) => process.id === 'electron');
  assert.ok(vite);
  assert.ok(workspace);
  assert.ok(providerProxy);
  assert.ok(runtimeCodex);
  assert.ok(electron);

  assert.equal(vite.env.VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL, 'http://127.0.0.1:5174');
  assert.equal(vite.env.SCIFORGE_RUNTIME_API_KEY, undefined);
  for (const process of [workspace, providerProxy, runtimeCodex]) {
    assert.equal(process.env.SCIFORGE_RUNTIME_API_KEY, 'env-secret-wins');
    assert.equal(process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL, 'https://provider.example.test/v1');
    assert.equal(process.env.SCIFORGE_RUNTIME_MODEL, 'bailian/deepseek-v4-flash');
    assert.equal(process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:61337');
  }
  assert.equal(electron.env.SCIFORGE_DESKTOP_RENDERER_URL, 'http://127.0.0.1:5173');
  assert.equal(electron.env.SCIFORGE_DESKTOP_APP_ROOT, process.cwd());
  assert.equal(electron.env.SCIFORGE_DESKTOP_WORKSPACE_PATH, join(root, 'workspace'));
  assert.equal(electron.env.SCIFORGE_WORKSPACE_PATH, join(root, 'workspace'));
  assert.equal(electron.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:61337');
  assert.equal(workspace.env.SCIFORGE_WORKSPACE_PORT, '5174');
  assert.equal(runtimeCodex.env.SCIFORGE_RUNTIME_CODEX_HOST, '127.0.0.1');
  assert.equal(runtimeCodex.env.SCIFORGE_RUNTIME_CODEX_PORT, '5176');
  assert.deepEqual(runtimeCodex.args, ['run', 'backend:codex-runtime:server']);
  assert.ok(electron.args.some((arg) => /dist-desktop\/src\/desktop\/main\.js$/.test(arg)));
  assert.ok(!electron.args.some((arg) => /src\/desktop\/main\.ts$/.test(arg)));

  const diagnosticsText = JSON.stringify(plan.diagnostics);
  assert.doesNotMatch(diagnosticsText, /env-secret-wins|sk-local-config-secret|sk-native-secret|apiKey/);
  assert.equal(plan.diagnostics.nativeReadiness.capabilities.browser.status, 'ready');
  assert.equal(plan.diagnostics.nativeReadiness.capabilities.browser.loopbackTrusted, true);
  assert.equal(plan.diagnostics.nativeReadiness.capabilities.annotation.status, 'unavailable');
  assert.equal(plan.diagnostics.nativeReadiness.capabilities.image.status, 'unavailable');
  assert.equal(plan.diagnostics.nativeReadiness.capabilities.windowAction.status, 'unavailable');
});

test('P1-DESK dev shell controller starts planned processes through injected spawn deps only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-shell-controller-'));
  const spawned: Array<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
  const children: FakeDevShellChild[] = [];
  const spawnProcess: DesktopDevShellSpawn = (command, args, options) => {
    const child = new FakeDevShellChild(4100 + children.length);
    children.push(child);
    spawned.push({ command, args, cwd: options.cwd, env: options.env });
    return child;
  };
  const controller = new DesktopDevShellController({
    projectRoot: process.cwd(),
    workspacePath: join(root, 'workspace'),
    nativeAdapterUrl: 'http://127.0.0.1:61338',
    spawnProcess,
  });

  const started = await controller.start();
  await controller.shutdown();

  assert.deepEqual(started.processes.map((process) => process.id), [
    'vite',
    'workspace-writer',
    'provider-proxy',
    'runtime-codex',
    'electron',
  ]);
  assert.deepEqual(spawned.map((process) => process.command), ['npm', 'npm', 'npm', 'npm', 'npx']);
  assert.equal(spawned[4]?.env.SCIFORGE_DESKTOP_RENDERER_URL, 'http://127.0.0.1:5173');
  assert.equal(spawned[4]?.env.SCIFORGE_DESKTOP_APP_ROOT, process.cwd());
  assert.equal(spawned[4]?.env.SCIFORGE_DESKTOP_WORKSPACE_PATH, join(root, 'workspace'));
  assert.equal(spawned[1]?.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:61338');
  assert.equal(children.every((child) => child.killed), true);
});

test('P1-DESK native readiness normalizes four native capabilities without raw payloads or secrets', () => {
  const readiness = buildDesktopNativeReadiness({
    adapterUrl: 'http://localhost:61339/adapter?token=sk-secret',
    refs: {
      browser: ['desktop-native:browser/readiness.json', 'https://unbounded.example/raw'],
      annotation: ['desktop-native:annotation/readiness.json'],
      image: ['desktop-native:image/readiness.json'],
      windowAction: ['desktop-native:window-action/readiness.json'],
    },
    capabilities: {
      browser: { available: true, ready: true },
      annotation: { available: true, ready: false, reason: 'permission blocked sk-secret data:image/png;base64,raw' },
      image: { available: false, reason: 'module missing with apiKey=sk-secret' },
      windowAction: { available: true, ready: true },
    },
  });

  assert.equal(readiness.schemaVersion, 'sciforge.desktop.native-readiness.v1');
  assert.deepEqual(Object.keys(readiness.capabilities).sort(), ['annotation', 'browser', 'image', 'windowAction']);
  assert.equal(readiness.capabilities.browser.status, 'ready');
  assert.equal(readiness.capabilities.browser.loopbackTrusted, true);
  assert.equal(readiness.capabilities.browser.adapterOrigin, 'http://127.0.0.1:61339');
  assert.deepEqual(readiness.capabilities.browser.diagnosticRefs, ['desktop-native:browser/readiness.json']);
  assert.equal(readiness.capabilities.annotation.status, 'blocked');
  assert.equal(readiness.capabilities.image.status, 'unavailable');
  assert.equal(readiness.capabilities.windowAction.status, 'ready');

  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /sk-secret|apiKey|data:image|base64|token=/);
  assert.ok(serialized.length < 5000);
});

test('P1-DESK runtime launcher injects config.local API settings into desktop sidecars without exposing secrets in health or copied config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-launcher-secret-fallback-'));
  const sourceConfig = join(root, 'config.local.json');
  await writeFile(sourceConfig, JSON.stringify({
    textLLM: {
      env: {
        SCIFORGE_RUNTIME_API_KEY: 'sk-config-fallback-secret',
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
      },
      model: 'bailian/deepseek-v4-flash',
    },
  }), 'utf8');
  const previousConfigPath = process.env.SCIFORGE_CONFIG_PATH;
  const previousApiKey = process.env.SCIFORGE_RUNTIME_API_KEY;
  delete process.env.SCIFORGE_RUNTIME_API_KEY;
  process.env.SCIFORGE_CONFIG_PATH = sourceConfig;

  const capturedEnv: NodeJS.ProcessEnv[] = [];
  const child = new FakeManagedChild(5200);
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    requestedProviderProxyPort: 0,
    services: [managedService('provider-proxy')],
    spawnProcess: ((_command, _args, options) => {
      capturedEnv.push(options.env);
      return child;
    }) as SpawnManagedProcess,
  });

  try {
    const started = await launcher.start();
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_API_KEY, 'sk-config-fallback-secret');
    assert.equal(capturedEnv[0]?.SCIFORGE_PROXY_UPSTREAM_BASE_URL, 'https://provider.example.test/v1');
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_MODEL, 'bailian/deepseek-v4-flash');
    assert.equal(capturedEnv[0]?.SCIFORGE_PROXY_DEFAULT_MODEL, 'bailian/deepseek-v4-flash');

    const health = await fetchJson(`${started.controlUrl}/health`);
    const copiedConfig = await readFile(join(root, 'app-data', 'config', 'config.local.json'), 'utf8');
    assert.doesNotMatch(JSON.stringify(health), /sk-config-fallback-secret|apiKey/);
    assert.doesNotMatch(copiedConfig, /sk-config-fallback-secret|apiKey/);
    assert.match(copiedConfig, /provider\.example\.test/);
  } finally {
    await launcher.shutdown();
    if (previousConfigPath === undefined) delete process.env.SCIFORGE_CONFIG_PATH;
    else process.env.SCIFORGE_CONFIG_PATH = previousConfigPath;
    if (previousApiKey === undefined) delete process.env.SCIFORGE_RUNTIME_API_KEY;
    else process.env.SCIFORGE_RUNTIME_API_KEY = previousApiKey;
  }
});

class FakeDevShellChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  constructor(readonly pid: number) {
    super();
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  }
}

class FakeManagedChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  constructor(readonly pid: number) {
    super();
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  }
}

function managedService(id: string): ManagedRuntimeServiceSpec {
  return {
    id,
    role: id === 'runtime-codex' ? 'runtime-codex' : id === 'provider-proxy' ? 'provider-proxy' : 'workspace-writer',
    command: 'node',
    args: ['service.js'],
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}
