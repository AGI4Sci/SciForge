import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadVisionSenseConfig } from './sense-provider.js';
import type { GatewayRequest } from '../runtime-types.js';

test('Vision Sense planner config carries only the current Model Router env needed for nested planning', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-config-'));
  const previous = { ...process.env };
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1';
  process.env.SCIFORGE_PROXY_BASE_URL = 'http://127.0.0.1:5175/v1';
  process.env.SCIFORGE_PROXY_URL = 'http://127.0.0.1:5175/healthz';
  process.env.SCIFORGE_PROXY_HOST = '127.0.0.1';
  process.env.SCIFORGE_PROXY_PORT = '5175';
  process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:5175/v1';
  process.env.SCIFORGE_MODEL_ROUTER_HOST = '127.0.0.1';
  process.env.SCIFORGE_MODEL_ROUTER_PORT = '5175';
  process.env.SCIFORGE_CONFIG_PATH = join(workspace, 'config.local.json');
  process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL = 'https://provider.example.test/v1';
  process.env.SCIFORGE_RUNTIME_BASE_URL = 'https://runtime.example.test/v1';
  process.env.SCIFORGE_TEXT_PROVIDER = 'provider-text';
  process.env.SCIFORGE_VISION_PROVIDER = 'provider-vision';
  process.env.SCIFORGE_TEXT_BASE_URL = 'https://text.example.test/v1';
  process.env.SCIFORGE_VISION_BASE_URL = 'https://vision.example.test/v1';
  process.env.SCIFORGE_TEXT_MODEL = 'text-model';
  process.env.SCIFORGE_VISION_MODEL = 'vision-model';
  process.env.SCIFORGE_TEXT_API_KEY = 'test-text-key';
  process.env.SCIFORGE_VISION_API_KEY = 'test-vision-key';
  process.env.SCIFORGE_RUNTIME_API_KEY = 'test-runtime-key';
  process.env.SCIFORGE_RUNTIME_MODEL = 'sciforge-router';
  process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS = 'sciforge-router';
  process.env.SCIFORGE_RUNTIME_ROOT = '/tmp/sciforge-runtime-root';
  process.env.SCIFORGE_ALLOW_OPENAI_RUNTIME = '1';
  process.env.SCIFORGE_COMPUTER_USE_PLANNER_ALLOW_OPENAI_RUNTIME = '1';
  process.env.PATH = '/opt/homebrew/bin:/usr/bin:/bin';
  process.env.SCIFORGE_UNRELATED_SECRET = 'must-not-propagate';
  await mkdir(join(workspace, '.sciforge'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'config.json'), JSON.stringify({
    visionSense: {
      groundingTranslatorUploadStrategy: 'file-ref',
      plannerAllowOpenAiRuntime: true,
    },
  }), 'utf8');

  try {
    const config = await loadVisionSenseConfig(workspace, baseGatewayRequest());

    assert.equal(config.planner.env?.SCIFORGE_PROXY_BASE_URL, undefined);
    assert.equal(config.planner.env?.SCIFORGE_PROXY_URL, undefined);
    assert.equal(config.planner.env?.SCIFORGE_PROXY_HOST, undefined);
    assert.equal(config.planner.env?.SCIFORGE_PROXY_PORT, undefined);
    assert.equal(config.planner.env?.SCIFORGE_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:5175/v1');
    assert.equal(config.planner.env?.SCIFORGE_MODEL_ROUTER_HOST, '127.0.0.1');
    assert.equal(config.planner.env?.SCIFORGE_MODEL_ROUTER_PORT, '5175');
    assert.equal(config.planner.env?.SCIFORGE_CONFIG_PATH, join(workspace, 'config.local.json'));
    assert.equal(config.planner.env?.SCIFORGE_PROXY_UPSTREAM_BASE_URL, undefined);
    assert.equal(config.planner.env?.SCIFORGE_RUNTIME_BASE_URL, undefined);
    assert.equal(config.planner.env?.SCIFORGE_TEXT_PROVIDER, 'provider-text');
    assert.equal(config.planner.env?.SCIFORGE_VISION_PROVIDER, 'provider-vision');
    assert.equal(config.planner.env?.SCIFORGE_TEXT_BASE_URL, 'https://text.example.test/v1');
    assert.equal(config.planner.env?.SCIFORGE_VISION_BASE_URL, 'https://vision.example.test/v1');
    assert.equal(config.planner.env?.SCIFORGE_TEXT_MODEL, 'text-model');
    assert.equal(config.planner.env?.SCIFORGE_VISION_MODEL, 'vision-model');
    assert.equal(config.planner.env?.SCIFORGE_TEXT_API_KEY, 'test-text-key');
    assert.equal(config.planner.env?.SCIFORGE_VISION_API_KEY, 'test-vision-key');
    assert.equal(config.planner.env?.SCIFORGE_RUNTIME_API_KEY, 'test-runtime-key');
    assert.equal(config.planner.env?.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
    assert.equal(config.planner.env?.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, 'sciforge-router');
    assert.equal(config.planner.env?.SCIFORGE_RUNTIME_ROOT, '/tmp/sciforge-runtime-root');
    assert.equal(config.planner.env?.SCIFORGE_ALLOW_OPENAI_RUNTIME, undefined);
    assert.equal(config.planner.allowOpenAiRuntime, false);
    assert.equal(config.planner.env?.PATH, '/opt/homebrew/bin:/usr/bin:/bin');
    assert.equal(config.planner.env?.SCIFORGE_UNRELATED_SECRET, undefined);
    assert.equal(config.grounder.baseUrl, undefined);
  } finally {
    process.env = previous;
  }
});

test('Vision Sense ignores retired direct grounder URL aliases', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vision-config-retired-grounder-'));
  const previous = { ...process.env };
  process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS = '1';
  await mkdir(join(workspace, '.sciforge'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'config.json'), JSON.stringify({
    visionSense: {
      grounderBaseUrl: 'http://127.0.0.1:18081',
      grounderLegacyEnabled: true,
    },
  }), 'utf8');

  try {
    const config = await loadVisionSenseConfig(workspace, baseGatewayRequest());

    assert.equal(config.grounder.baseUrl, undefined);
  } finally {
    process.env = previous;
  }
});

function baseGatewayRequest(): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt: '/computer-use inspect the visible desktop',
    artifacts: [],
    selectedToolIds: [],
    uiState: {},
  };
}
