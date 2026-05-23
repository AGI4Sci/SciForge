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
  assert.equal(options.forceNonStreamingUpstream, false);
});

test('proxy CLI treats llm settings as the primary user-facing provider config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sciforge-proxy-config-'));
  const configPath = join(dir, 'config.local.json');
  writeFileSync(configPath, JSON.stringify({
    llm: {
      baseUrl: 'http://provider-user.local:3888/v1',
      apiKey: 'user-secret',
      model: 'user-model',
    },
    codexProxy: {
      upstreamBaseUrl: 'http://stale-proxy.local:3888/v1',
      apiKey: 'stale-secret',
      defaultModel: 'stale-model',
    },
  }));

  const options = resolveProxyCliOptions(['--config', configPath], {});

  assert.equal(options.upstreamBaseUrl, 'http://provider-user.local:3888/v1');
  assert.equal(options.upstreamApiKey, 'user-secret');
  assert.equal(options.defaultModel, 'user-model');
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

test('proxy CLI enables non-streaming upstream compatibility mode from env or local config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sciforge-proxy-config-'));
  const configPath = join(dir, 'config.local.json');
  writeFileSync(configPath, JSON.stringify({
    codexProxy: {
      upstreamBaseUrl: 'http://provider.local:3888/v1',
      forceNonStreamingUpstream: true,
    },
  }));

  assert.equal(resolveProxyCliOptions(['--config', configPath], {}).forceNonStreamingUpstream, true);
  assert.equal(resolveProxyCliOptions(['--config', configPath], {
    SCIFORGE_PROXY_FORCE_NON_STREAMING_UPSTREAM: '1',
  }).forceNonStreamingUpstream, true);
  assert.equal(resolveProxyCliOptions(['--force-non-streaming-upstream'], {}).forceNonStreamingUpstream, true);
});
