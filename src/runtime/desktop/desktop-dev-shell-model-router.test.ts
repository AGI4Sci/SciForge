import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDesktopDevShellPlan } from '../../../tools/desktop-dev-shell.js';

test('desktop dev shell wires a shared BrowserHost native adapter URL into every desktop sidecar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-browser-host-'));
  const plan = createDesktopDevShellPlan({
    projectRoot: root,
    workspacePath: join(root, 'workspace'),
    configPath: join(root, 'missing-config.local.json'),
    env: {},
  });

  assert.equal(plan.electron.nativeAdapterInjected, true);
  assert.equal(plan.diagnostics.nativeReadiness.capabilities.browser.ready, true);

  for (const processId of ['workspace-writer', 'runtime-codex', 'electron'] as const) {
    const process = plan.processes.find((candidate) => candidate.id === processId);
    assert.ok(process, `missing ${processId}`);
    assert.equal(process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:5177');
  }
});

test('desktop dev shell accepts configured BrowserHost native adapter URL overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-browser-host-config-'));
  const configPath = join(root, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    desktop: {
      browserHostNativeAdapterUrl: 'http://localhost:61234/native/',
    },
  }), 'utf8');

  const plan = createDesktopDevShellPlan({
    projectRoot: root,
    workspacePath: join(root, 'workspace'),
    configPath,
    env: {},
  });

  const electronProcess = plan.processes.find((process) => process.id === 'electron');
  const workspaceWriter = plan.processes.find((process) => process.id === 'workspace-writer');
  assert.equal(electronProcess?.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:61234');
  assert.equal(workspaceWriter?.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:61234');
});

test('desktop dev shell starts Model Router instead of the legacy responses proxy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-model-router-'));
  const configPath = join(root, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    textLLM: {
      baseUrl: 'https://provider.example.test/openai-compatible',
      model: 'private-vision-capable-model',
      apiKey: 'sk-local-dev-secret',
    },
    visionSense: {
      vlmModel: 'qwen3.7-plus',
    },
  }), 'utf8');

  const plan = createDesktopDevShellPlan({
    projectRoot: root,
    workspacePath: join(root, 'workspace'),
    configPath,
    modelRouterUrl: 'http://127.0.0.1:5175',
    env: {},
  });

  const modelRouter = plan.processes.find((process) => process.id === 'model-router');
  assert.ok(modelRouter);
  assert.deepEqual(modelRouter.args.slice(0, 2), ['run', 'backend:model-router']);
  assert.deepEqual(modelRouter.args.slice(-2), ['--workspace-root', join(root, 'workspace')]);
  assert.equal(modelRouter.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, 'sciforge-router');
  assert.equal(modelRouter.env.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:5175/v1');
  assert.equal(modelRouter.env.SCIFORGE_PROXY_BASE_URL, undefined);
  assert.equal(modelRouter.env.SCIFORGE_TEXT_BASE_URL, 'https://provider.example.test/openai-compatible');
  assert.equal(modelRouter.env.SCIFORGE_VISION_BASE_URL, 'https://provider.example.test/openai-compatible');
  assert.equal(modelRouter.env.SCIFORGE_TEXT_MODEL, 'private-vision-capable-model');
  assert.equal(modelRouter.env.SCIFORGE_VISION_MODEL, 'qwen3.7-plus');
  assert.equal(modelRouter.env.SCIFORGE_TEXT_API_KEY, 'sk-local-dev-secret');
  assert.equal(modelRouter.env.SCIFORGE_VISION_API_KEY, 'sk-local-dev-secret');

  const runtimeSidecar = plan.processes.find((process) => process.id === 'runtime-codex');
  assert.equal(runtimeSidecar?.env.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:5175/v1');
  assert.equal(runtimeSidecar?.env.SCIFORGE_PROXY_BASE_URL, undefined);
  assert.equal(runtimeSidecar?.env.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
});

test('desktop dev shell respects explicit Model Router base URL from launch env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-model-router-env-'));
  const configPath = join(root, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      baseUrl: 'https://provider.example.test/openai-compatible',
      model: 'bailian/deepseek-v4-flash',
      apiKey: 'sk-local-dev-secret',
    },
  }), 'utf8');

  const plan = createDesktopDevShellPlan({
    projectRoot: root,
    workspacePath: join(root, 'workspace'),
    configPath,
    env: {
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:61245/v1',
      SCIFORGE_PROXY_BASE_URL: 'http://127.0.0.1:61246',
      SCIFORGE_PROXY_PORT: '61246',
    },
  });

  const modelRouter = plan.processes.find((process) => process.id === 'model-router');
  const workspaceWriter = plan.processes.find((process) => process.id === 'workspace-writer');
  const runtimeSidecar = plan.processes.find((process) => process.id === 'runtime-codex');

  assert.equal(modelRouter?.args[modelRouter.args.indexOf('--port') + 1], '61245');
  assert.equal(modelRouter?.env.SCIFORGE_PROXY_BASE_URL, undefined);
  assert.equal(modelRouter?.env.SCIFORGE_PROXY_PORT, undefined);
  assert.equal(modelRouter?.env.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:61245/v1');
  assert.equal(workspaceWriter?.env.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:61245/v1');
  assert.equal(workspaceWriter?.env.SCIFORGE_PROXY_BASE_URL, undefined);
  assert.equal(workspaceWriter?.env.SCIFORGE_PROXY_PORT, undefined);
  assert.equal(runtimeSidecar?.env.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:61245/v1');
  assert.equal(runtimeSidecar?.env.SCIFORGE_PROXY_BASE_URL, undefined);
  assert.equal(runtimeSidecar?.env.SCIFORGE_PROXY_PORT, undefined);
});

test('desktop dev shell does not infer Model Router vision role from text-only config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-model-router-text-only-'));
  const configPath = join(root, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      baseUrl: 'https://provider.example.test/openai-compatible',
      model: 'bailian/deepseek-v4-flash',
      apiKey: 'sk-local-dev-secret',
    },
  }), 'utf8');

  const plan = createDesktopDevShellPlan({
    projectRoot: root,
    workspacePath: join(root, 'workspace'),
    configPath,
    modelRouterUrl: 'http://127.0.0.1:5175',
    env: {},
  });

  const modelRouter = plan.processes.find((process) => process.id === 'model-router');
  assert.ok(modelRouter);
  assert.equal(modelRouter.env.SCIFORGE_TEXT_MODEL, 'bailian/deepseek-v4-flash');
  assert.equal(modelRouter.env.SCIFORGE_VISION_MODEL, undefined);
  assert.equal(modelRouter.env.SCIFORGE_VISION_BASE_URL, undefined);
  assert.equal(modelRouter.env.SCIFORGE_VISION_API_KEY, undefined);
});

test('desktop dev shell uses explicit visionLLM qwen3.7-plus for Model Router vision role', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-dev-model-router-vision-'));
  const configPath = join(root, 'config.local.json');
  await writeFile(configPath, JSON.stringify({
    llm: {
      baseUrl: 'https://provider.example.test/openai-compatible',
      model: 'bailian/deepseek-v4-flash',
      apiKey: 'sk-local-dev-secret',
    },
    visionLLM: {
      baseUrl: 'https://vision.example.test/openai-compatible',
      model: 'qwen3.7-plus',
      apiKey: 'sk-local-vision-secret',
    },
  }), 'utf8');

  const plan = createDesktopDevShellPlan({
    projectRoot: root,
    workspacePath: join(root, 'workspace'),
    configPath,
    modelRouterUrl: 'http://127.0.0.1:5175',
    env: {},
  });

  const modelRouter = plan.processes.find((process) => process.id === 'model-router');
  assert.ok(modelRouter);
  assert.equal(modelRouter.env.SCIFORGE_TEXT_MODEL, 'bailian/deepseek-v4-flash');
  assert.equal(modelRouter.env.SCIFORGE_TEXT_API_KEY, 'sk-local-dev-secret');
  assert.equal(modelRouter.env.SCIFORGE_VISION_BASE_URL, 'https://vision.example.test/openai-compatible');
  assert.equal(modelRouter.env.SCIFORGE_VISION_MODEL, 'qwen3.7-plus');
  assert.equal(modelRouter.env.SCIFORGE_VISION_API_KEY, 'sk-local-vision-secret');
});
