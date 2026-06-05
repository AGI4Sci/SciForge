import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDesktopDevShellPlan } from '../../../tools/desktop-dev-shell.js';

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
