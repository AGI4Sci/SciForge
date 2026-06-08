import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

test('P1-DESK dev shell plans Model Router sidecar env without legacy Runtime provider injection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-shell-plan-'));
  const configPath = join(root, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      apiKey: 'sk-local-config-secret',
      baseUrl: 'https://provider.example.test/v1',
      model: 'bailian/deepseek-v4-flash',
    },
    codexProxy: {
      apiKey: 'sk-codex-member-secret',
      upstreamBaseUrl: 'https://codex-member.example.test/v1',
      defaultModel: 'codex/member-model',
    },
    visionLLM: {
      apiKey: 'sk-local-vision-secret',
      baseUrl: 'https://vision-provider.example.test/v1',
      model: 'qwen3.7-plus',
    },
  }), 'utf8');

  const plan = createDesktopDevShellPlan({
    projectRoot: process.cwd(),
    workspacePath: join(root, 'workspace'),
    configPath,
    env: {
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://legacy-env.example.test/v1',
      SCIFORGE_RUNTIME_BASE_URL: 'https://legacy-runtime.example.test/v1',
      SCIFORGE_PROXY_DEFAULT_MODEL: 'legacy-direct-model',
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
    'model-router',
    'runtime-codex',
    'electron',
  ]);

  const vite = plan.processes.find((process) => process.id === 'vite');
  const workspace = plan.processes.find((process) => process.id === 'workspace-writer');
  const modelRouter = plan.processes.find((process) => process.id === 'model-router');
  const runtimeCodex = plan.processes.find((process) => process.id === 'runtime-codex');
  const electron = plan.processes.find((process) => process.id === 'electron');
  assert.ok(vite);
  assert.ok(workspace);
  assert.ok(modelRouter);
  assert.ok(runtimeCodex);
  assert.ok(electron);

  assert.equal(vite.env.VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL, 'http://127.0.0.1:5174');
  assert.equal(vite.env.SCIFORGE_RUNTIME_API_KEY, undefined);
  for (const process of [workspace, modelRouter, runtimeCodex]) {
    assert.equal(process.env.SCIFORGE_RUNTIME_API_KEY, 'sciforge-local-model-router');
    assert.equal(process.env.SCIFORGE_MODEL_ROUTER_API_KEY, 'sciforge-local-model-router');
    assert.equal(process.env.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:5175/v1');
    assert.equal(process.env.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
    assert.equal(process.env.SCIFORGE_PROXY_BASE_URL, undefined);
    assert.equal(process.env.SCIFORGE_PROXY_PORT, undefined);
    assert.equal(process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL, undefined);
    assert.equal(process.env.SCIFORGE_RUNTIME_BASE_URL, undefined);
    assert.equal(process.env.SCIFORGE_PROXY_DEFAULT_MODEL, undefined);
    assert.equal(process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:61337');
  }
  assert.equal(modelRouter.env.SCIFORGE_TEXT_API_KEY, 'sk-local-config-secret');
  assert.equal(modelRouter.env.SCIFORGE_TEXT_BASE_URL, 'https://provider.example.test/v1');
  assert.equal(modelRouter.env.SCIFORGE_TEXT_MODEL, 'bailian/deepseek-v4-flash');
  assert.equal(modelRouter.env.SCIFORGE_VISION_API_KEY, 'sk-local-vision-secret');
  assert.equal(modelRouter.env.SCIFORGE_VISION_BASE_URL, 'https://vision-provider.example.test/v1');
  assert.equal(modelRouter.env.SCIFORGE_VISION_MODEL, 'qwen3.7-plus');
  for (const process of [workspace, runtimeCodex]) {
    assert.equal(process.env.SCIFORGE_TEXT_API_KEY, undefined);
    assert.equal(process.env.SCIFORGE_TEXT_BASE_URL, undefined);
    assert.equal(process.env.SCIFORGE_TEXT_MODEL, undefined);
    assert.equal(process.env.SCIFORGE_VISION_API_KEY, undefined);
    assert.equal(process.env.SCIFORGE_VISION_BASE_URL, undefined);
    assert.equal(process.env.SCIFORGE_VISION_MODEL, undefined);
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
  assert.doesNotMatch(diagnosticsText, /sk-local-config-secret|sk-codex-member-secret|sk-local-vision-secret|sk-native-secret|apiKey/);
  assert.equal(plan.diagnostics.config.memberCredentialSource, 'config');
  assert.equal(plan.diagnostics.config.textBaseUrlConfigured, true);
  assert.equal(plan.diagnostics.config.textModelConfigured, true);
  assert.equal(plan.diagnostics.config.visionModelConfigured, true);
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
  const legacyEnvKeys = [
    'SCIFORGE_PROXY_API_KEY_ENV',
    'SCIFORGE_PROXY_HOST',
    'SCIFORGE_PROXY_QUIET',
    'SCIFORGE_PROXY_URL',
    'SCIFORGE_PROXY_UPSTREAM_BASE_URL',
    'SCIFORGE_RUNTIME_BASE_URL',
    'SCIFORGE_PROXY_DEFAULT_MODEL',
    'SCIFORGE_RUNTIME_MODEL',
    'SCIFORGE_TEXT_API_KEY',
  ];
  const previousEnv = new Map(legacyEnvKeys.map((key) => [key, process.env[key]]));
  process.env.SCIFORGE_PROXY_API_KEY_ENV = 'SCIFORGE_STALE_PROXY_KEY';
  process.env.SCIFORGE_PROXY_HOST = '0.0.0.0';
  process.env.SCIFORGE_PROXY_QUIET = '1';
  process.env.SCIFORGE_PROXY_URL = 'http://127.0.0.1:3891/healthz';
  process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL = 'https://inherited-legacy.example.test/v1';
  process.env.SCIFORGE_RUNTIME_BASE_URL = 'https://inherited-runtime.example.test/v1';
  process.env.SCIFORGE_PROXY_DEFAULT_MODEL = 'inherited-direct-model';
  process.env.SCIFORGE_RUNTIME_MODEL = 'inherited-private-model';
  process.env.SCIFORGE_TEXT_API_KEY = 'sk-inherited-member-secret';
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
    env: {
      SCIFORGE_TEXT_BASE_URL: 'https://router-member.example.test/v1',
      SCIFORGE_TEXT_MODEL: 'router-member-model',
      SCIFORGE_TEXT_API_KEY: 'sk-router-member-secret',
    },
    spawnProcess,
  });

  try {
    const started = await controller.start();
    await controller.shutdown();

    assert.deepEqual(started.processes.map((process) => process.id), [
      'vite',
      'workspace-writer',
      'model-router',
      'runtime-codex',
      'electron',
    ]);
    assert.deepEqual(spawned.map((process) => process.command), ['npm', 'npm', 'npm', 'npm', 'npx']);
    for (const process of spawned) {
      assert.equal(process.env.SCIFORGE_PROXY_API_KEY_ENV, undefined);
      assert.equal(process.env.SCIFORGE_PROXY_HOST, undefined);
      assert.equal(process.env.SCIFORGE_PROXY_QUIET, undefined);
      assert.equal(process.env.SCIFORGE_PROXY_URL, undefined);
      assert.equal(process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL, undefined);
      assert.equal(process.env.SCIFORGE_RUNTIME_BASE_URL, undefined);
      assert.equal(process.env.SCIFORGE_PROXY_DEFAULT_MODEL, undefined);
    }
    assert.equal(spawned[4]?.env.SCIFORGE_DESKTOP_RENDERER_URL, 'http://127.0.0.1:5173');
    assert.equal(spawned[4]?.env.SCIFORGE_DESKTOP_APP_ROOT, process.cwd());
    assert.equal(spawned[4]?.env.SCIFORGE_DESKTOP_WORKSPACE_PATH, join(root, 'workspace'));
    assert.equal(spawned[1]?.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:61338');
    assert.equal(spawned[3]?.env.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
    assert.equal(spawned[3]?.env.SCIFORGE_RUNTIME_API_KEY, 'sciforge-local-model-router');
    assert.equal(spawned[3]?.env.SCIFORGE_TEXT_API_KEY, undefined);
    assert.equal(spawned[2]?.env.SCIFORGE_TEXT_API_KEY, 'sk-router-member-secret');
    assert.equal(spawned[2]?.env.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:5175/v1');
    assert.equal(spawned[2]?.env.SCIFORGE_PROXY_BASE_URL, undefined);
    assert.equal(spawned[2]?.env.SCIFORGE_PROXY_PORT, undefined);
    assert.equal(children.every((child) => child.killed), true);
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
