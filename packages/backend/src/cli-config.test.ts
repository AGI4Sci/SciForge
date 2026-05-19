import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveProxyCliOptions } from './cli-config';

test('proxy CLI reads upstream credentials from ignored local config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sciforge-proxy-config-'));
  const configPath = join(dir, 'config.local.json');
  writeFileSync(configPath, JSON.stringify({
    codexProxy: {
      upstreamBaseUrl: 'http://provider.local:3888',
      apiKey: 'local-secret',
      defaultModel: 'deepseek-local',
    },
  }));

  const options = resolveProxyCliOptions(['--config', configPath], {});

  assert.equal(options.upstreamBaseUrl, 'http://provider.local:3888/v1');
  assert.equal(options.upstreamApiKey, 'local-secret');
  assert.equal(options.upstreamKeySource, `${configPath}:codexProxy.apiKey`);
  assert.equal(options.defaultModel, 'deepseek-local');
});

test('proxy CLI lets env override local upstream credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sciforge-proxy-config-'));
  const configPath = join(dir, 'config.local.json');
  writeFileSync(configPath, JSON.stringify({
    codexProxy: {
      upstreamBaseUrl: 'http://provider.local:3888/v1',
      apiKey: 'local-secret',
      defaultModel: 'deepseek-local',
    },
  }));

  const options = resolveProxyCliOptions(['--config', configPath], {
    SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://provider-env.local:3888/v1',
    SCIFORGE_RUNTIME_API_KEY: 'env-secret',
    SCIFORGE_PROXY_DEFAULT_MODEL: 'env-model',
  });

  assert.equal(options.upstreamBaseUrl, 'http://provider-env.local:3888/v1');
  assert.equal(options.upstreamApiKey, 'env-secret');
  assert.equal(options.upstreamKeySource, 'SCIFORGE_RUNTIME_API_KEY');
  assert.equal(options.defaultModel, 'env-model');
});
