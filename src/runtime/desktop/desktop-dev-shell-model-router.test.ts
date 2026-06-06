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
    providerProxyUrl: 'http://127.0.0.1:5175',
    env: {},
  });

  const providerSidecar = plan.processes.find((process) => process.id === 'provider-proxy');
  assert.ok(providerSidecar);
  assert.deepEqual(providerSidecar.args.slice(0, 2), ['run', 'backend:model-router']);
  assert.deepEqual(providerSidecar.args.slice(-2), ['--workspace-root', join(root, 'workspace')]);
  assert.equal(providerSidecar.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, 'sciforge-router');
  assert.equal(providerSidecar.env.SCIFORGE_TEXT_BASE_URL, 'https://provider.example.test/openai-compatible');
  assert.equal(providerSidecar.env.SCIFORGE_VISION_BASE_URL, 'https://provider.example.test/openai-compatible');
  assert.equal(providerSidecar.env.SCIFORGE_TEXT_MODEL, 'private-vision-capable-model');
  assert.equal(providerSidecar.env.SCIFORGE_VISION_MODEL, 'qwen3.7-plus');
  assert.equal(providerSidecar.env.SCIFORGE_TEXT_API_KEY, 'sk-local-dev-secret');
  assert.equal(providerSidecar.env.SCIFORGE_VISION_API_KEY, 'sk-local-dev-secret');

  const runtimeSidecar = plan.processes.find((process) => process.id === 'runtime-codex');
  assert.equal(runtimeSidecar?.env.SCIFORGE_PROXY_BASE_URL, 'http://127.0.0.1:5175');
  assert.equal(runtimeSidecar?.env.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
});
