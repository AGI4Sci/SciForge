import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  cleanUrlString,
  configuredString,
  createWorkspaceLocalConfigService,
  isSciForgeRuntimeProviderProxyHealth,
  normalizeConfiguredPeerInstances,
  normalizePeerInstances,
  normalizeToolProviderRoutes,
  parseJsonEnv,
  preserveConfiguredSecretString,
  repairPeerInstancesFromCounterpartJson,
  stringArray,
} from './workspace-server-local-config.js';

test('preserveConfiguredSecretString keeps masked and blank secret values from overwriting configured secrets', () => {
  assert.equal(preserveConfiguredSecretString('\u2022\u2022\u2022\u2022 masked', 'live-secret'), 'live-secret');
  assert.equal(preserveConfiguredSecretString('   ', 'live-secret'), 'live-secret');
  assert.equal(preserveConfiguredSecretString(undefined, 'live-secret'), 'live-secret');
});

test('preserveConfiguredSecretString allows an intentionally empty secret when no current secret exists', () => {
  assert.equal(preserveConfiguredSecretString('', ''), '');
  assert.equal(preserveConfiguredSecretString('   ', ''), '   ');
  assert.equal(preserveConfiguredSecretString('', undefined), '');
  assert.equal(preserveConfiguredSecretString('new-secret', 'live-secret'), 'new-secret');
});

test('configuredString, parseJsonEnv, cleanUrlString, and stringArray mirror local config normalization helpers', () => {
  assert.equal(configuredString('  http://provider.example/v1  ', 'old'), 'http://provider.example/v1');
  assert.equal(configuredString(undefined, '  old  '), 'old');
  assert.deepEqual(parseJsonEnv(' {"workspaceWriterUrl":"http://127.0.0.1:3999"} '), { workspaceWriterUrl: 'http://127.0.0.1:3999' });
  assert.equal(parseJsonEnv('not-json'), 'not-json');
  assert.equal(parseJsonEnv('  '), undefined);
  assert.equal(cleanUrlString(' https://example.test/path/// '), 'https://example.test/path');
  assert.deepEqual(stringArray([' alpha ', '', 'beta', 'alpha', 42, ' beta ']), ['alpha', 'beta']);
});

test('normalizePeerInstances sanitizes peer records and defaults unsafe enum values', () => {
  assert.deepEqual(normalizePeerInstances([
    'ignored',
    {
      name: '  main ',
      appUrl: ' http://127.0.0.1:5173/// ',
      workspaceWriterUrl: ' http://127.0.0.1:3999/// ',
      workspacePath: ' /tmp/workspace/.sciforge/versions/// ',
      role: 'main',
      trustLevel: 'sync',
      enabled: false,
    },
    {
      name: ' repair ',
      appUrl: 42,
      workspaceWriterUrl: ' http://127.0.0.1:4000/ ',
      workspacePath: '',
      role: 'admin',
      trustLevel: 'owner',
    },
  ]), [
    {
      name: 'main',
      appUrl: 'http://127.0.0.1:5173',
      workspaceWriterUrl: 'http://127.0.0.1:3999',
      workspacePath: '/tmp/workspace',
      role: 'main',
      trustLevel: 'sync',
      enabled: false,
    },
    {
      name: 'repair',
      appUrl: '',
      workspaceWriterUrl: 'http://127.0.0.1:4000',
      workspacePath: '',
      role: 'peer',
      trustLevel: 'readonly',
      enabled: true,
    },
  ]);

  assert.deepEqual(normalizePeerInstances(undefined), []);
});

test('SCIFORGE_COUNTERPART_JSON repair fallback produces a repair peer without reading process env', () => {
  const counterpartJson = JSON.stringify({
    agentId: ' repair-agent ',
    name: 'fallback-name',
    appUrl: ' http://127.0.0.1:5174/// ',
    workspaceWriterUrl: ' http://127.0.0.1:4001/// ',
    workspacePath: ' /tmp/repair-workspace/.sciforge ',
  });

  assert.deepEqual(repairPeerInstancesFromCounterpartJson(counterpartJson), [{
    name: 'repair-agent',
    appUrl: 'http://127.0.0.1:5174',
    workspaceWriterUrl: 'http://127.0.0.1:4001',
    workspacePath: '/tmp/repair-workspace',
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
  }]);

  assert.deepEqual(normalizeConfiguredPeerInstances(undefined, counterpartJson), [{
    name: 'repair-agent',
    appUrl: 'http://127.0.0.1:5174',
    workspaceWriterUrl: 'http://127.0.0.1:4001',
    workspacePath: '/tmp/repair-workspace',
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
  }]);
  assert.deepEqual(repairPeerInstancesFromCounterpartJson('not-json'), []);
  assert.deepEqual(repairPeerInstancesFromCounterpartJson(JSON.stringify({ appUrl: 'http://127.0.0.1:5174' })), []);
});

test('normalizeConfiguredPeerInstances prefers explicit peer instances over counterpart fallback', () => {
  assert.deepEqual(normalizeConfiguredPeerInstances([
    {
      name: ' explicit ',
      workspaceWriterUrl: ' http://127.0.0.1:5000/ ',
      role: 'peer',
      trustLevel: 'readonly',
    },
  ], JSON.stringify({ agentId: 'repair', workspaceWriterUrl: 'http://127.0.0.1:4001' })), [{
    name: 'explicit',
    appUrl: '',
    workspaceWriterUrl: 'http://127.0.0.1:5000',
    workspacePath: '',
    role: 'peer',
    trustLevel: 'readonly',
    enabled: true,
  }]);
});

test('normalizeToolProviderRoutes trims route fields, filters enums, de-duplicates arrays, and clamps timeouts', () => {
  assert.deepEqual(normalizeToolProviderRoutes({
    ' package.tools ': {
      enabled: true,
      capabilityId: ' capability.invoke ',
      source: ' package ',
      primaryProviderId: ' provider-main ',
      fallbackProviderIds: [' provider-b ', 'provider-b', 'provider-c', '', 123],
      permissions: [' read ', 'write', 'read'],
      requiredConfig: [' apiKey ', 'baseUrl', 'apiKey'],
      health: ' ready ',
      endpoint: ' https://provider.example/endpoint/// ',
      baseUrl: ' https://provider.example/base/// ',
      url: '',
      invokeUrl: ' https://provider.example/invoke/// ',
      invokePath: ' /tools/invoke/// ',
      timeoutMs: 999.9,
      ignored: 'discard',
    },
    invalid: {
      source: 'root',
      health: 'broken',
      fallbackProviderIds: [''],
      timeoutMs: Number.POSITIVE_INFINITY,
    },
    ' ': {
      enabled: true,
    },
    scalar: 'ignored',
  }), {
    'package.tools': {
      enabled: true,
      capabilityId: 'capability.invoke',
      source: 'package',
      primaryProviderId: 'provider-main',
      fallbackProviderIds: ['provider-b', 'provider-c'],
      permissions: ['read', 'write'],
      requiredConfig: ['apiKey', 'baseUrl'],
      health: 'ready',
      endpoint: 'https://provider.example/endpoint',
      baseUrl: 'https://provider.example/base',
      invokeUrl: 'https://provider.example/invoke',
      invokePath: '/tools/invoke',
      timeoutMs: 1000,
    },
  });

  assert.equal(normalizeToolProviderRoutes(undefined), undefined);
  assert.equal(normalizeToolProviderRoutes({ empty: { source: 'root' } }), undefined);
});

test('isSciForgeRuntimeProviderProxyHealth rejects stale legacy healthz payloads without service identity', () => {
  assert.equal(isSciForgeRuntimeProviderProxyHealth({
    ok: true,
    upstreamBaseUrl: 'https://stale-provider.example/v1',
  }), false);
  assert.equal(isSciForgeRuntimeProviderProxyHealth({
    ok: true,
    service: 'sciforge.codex-responses-proxy',
    upstreamBaseUrl: 'https://provider.example/v1',
  }), true);
  assert.equal(isSciForgeRuntimeProviderProxyHealth({
    ok: true,
    service: 'sciforge.model-router',
  }), true);
});

test('workspace Computer Use env keeps VirtualAppScreen native driver env diagnostic-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-computer-use-env-'));
  const service = createWorkspaceLocalConfigService({
    configLocalPath: join(root, 'workspace', 'parallel', 'p1', '.sciforge', 'config.local.json'),
    runtimeCodexPort: 18080,
    workspaceWriterPort: 5174,
    defaultWorkspacePath: join(root, 'workspace'),
    cwd: root,
    env: {
      HOME: join(root, 'home'),
    } as NodeJS.ProcessEnv,
  });

  const env = await service.runtimeCodexEnvFromLocalConfig({
    apiKey: 'root-key',
    baseUrl: 'https://provider.example/v1',
    model: 'root-model',
    computerUse: {
      virtualAppScreen: {
        env: {
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: true,
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND: 'powerpoint',
          SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS: true,
        },
      },
    },
  });

  assert.equal(env.SCIFORGE_RUNTIME_API_KEY, 'root-key');
  assert.equal(env.SCIFORGE_PROXY_UPSTREAM_BASE_URL, 'https://provider.example/v1');
  assert.equal(env.SCIFORGE_PROXY_DEFAULT_MODEL, 'root-model');
  assert.equal(env.SCIFORGE_CONFIG_PATH, join(root, 'config.local.json'));
  assert.equal(env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS, undefined);
  assert.equal(env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND, undefined);
  assert.equal(env.SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS, undefined);

  const diagnosticService = createWorkspaceLocalConfigService({
    configLocalPath: join(root, 'workspace', 'parallel', 'p1', '.sciforge', 'config.local.json'),
    runtimeCodexPort: 18080,
    workspaceWriterPort: 5174,
    defaultWorkspacePath: join(root, 'workspace'),
    cwd: root,
    env: {
      HOME: join(root, 'home'),
      SCIFORGE_VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC: '1',
    } as NodeJS.ProcessEnv,
  });
  const diagnosticEnv = await diagnosticService.runtimeCodexEnvFromLocalConfig({
    apiKey: 'root-key',
    baseUrl: 'https://provider.example/v1',
    model: 'root-model',
    computerUse: {
      virtualAppScreen: {
        env: {
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: true,
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND: 'powerpoint',
          SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS: true,
        },
      },
    },
  });
  assert.equal(diagnosticEnv.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS, '1');
  assert.equal(diagnosticEnv.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND, 'powerpoint');
  assert.equal(diagnosticEnv.SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS, undefined);
});

test('workspace runtime env uses config.local root fields over stale service env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-root-config-local-'));
  const configLocalPath = join(root, 'config.local.json');
  const parallelConfigLocalPath = join(root, 'workspace', 'parallel', 'p1', '.sciforge', 'config.local.json');
  await writeFile(configLocalPath, JSON.stringify({
    provider: 'openai-compatible',
    apiKey: 'root-local-secret',
    baseUrl: 'https://root-provider.example/v1/',
    model: 'root-local-model',
  }), 'utf8');
  await mkdir(dirname(parallelConfigLocalPath), { recursive: true });
  await writeFile(parallelConfigLocalPath, JSON.stringify({
    apiKey: 'parallel-secret-must-not-win',
    baseUrl: 'https://parallel-provider.example/v1',
    model: 'parallel-model',
  }), 'utf8');
  const service = createWorkspaceLocalConfigService({
    configLocalPath: parallelConfigLocalPath,
    runtimeCodexPort: 18080,
    workspaceWriterPort: 5174,
    defaultWorkspacePath: join(root, 'workspace'),
    cwd: root,
    env: {
      HOME: join(root, 'home'),
      SCIFORGE_TEXT_BASE_URL: 'https://stale-service.example/v1',
      SCIFORGE_TEXT_MODEL: 'stale-service-model',
      SCIFORGE_TEXT_API_KEY: 'stale-service-secret',
      SCIFORGE_PROXY_DEFAULT_MODEL: 'stale-proxy-model',
    } as NodeJS.ProcessEnv,
  });

  const env = await service.runtimeCodexEnvFromLocalConfig();

  assert.equal(env.SCIFORGE_CONFIG_PATH, configLocalPath);
  assert.equal(env.SCIFORGE_RUNTIME_API_KEY, 'root-local-secret');
  assert.equal(env.SCIFORGE_PROXY_UPSTREAM_BASE_URL, 'https://root-provider.example/v1');
  assert.equal(env.SCIFORGE_PROXY_DEFAULT_MODEL, 'root-local-model');
  assert.equal(env.SCIFORGE_TEXT_BASE_URL, 'https://root-provider.example/v1');
  assert.equal(env.SCIFORGE_TEXT_MODEL, 'root-local-model');
  assert.equal(env.SCIFORGE_TEXT_API_KEY, 'root-local-secret');
  assert.equal(env.SCIFORGE_VISION_BASE_URL, 'https://root-provider.example/v1');
  assert.equal(env.SCIFORGE_VISION_MODEL, 'root-local-model');
  assert.equal(env.SCIFORGE_VISION_API_KEY, 'root-local-secret');
  assert.equal(env.SCIFORGE_RUNTIME_PROVIDER, 'sciforge-model-router');
  assert.equal(env.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
});

test('workspace runtime env fails closed when config.local is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-missing-config-local-'));
  const configLocalPath = join(root, 'workspace', 'parallel', 'p1', '.sciforge', 'config.local.json');
  await mkdir(dirname(configLocalPath), { recursive: true });
  await writeFile(configLocalPath, JSON.stringify({
    apiKey: 'parallel-secret-must-not-win',
    baseUrl: 'https://parallel-provider.example/v1',
    model: 'parallel-model',
  }), 'utf8');
  const service = createWorkspaceLocalConfigService({
    configLocalPath,
    runtimeCodexPort: 18080,
    workspaceWriterPort: 5174,
    defaultWorkspacePath: join(root, 'workspace'),
    cwd: root,
    env: {
      HOME: join(root, 'home'),
      SCIFORGE_RUNTIME_API_KEY: 'stale-service-secret',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://stale-service.example/v1',
      SCIFORGE_PROXY_DEFAULT_MODEL: 'stale-service-model',
    } as NodeJS.ProcessEnv,
  });

  await assert.rejects(
    () => service.runtimeCodexEnvFromLocalConfig(),
    /config\.local\.json/,
  );
});

test('desktop sidecar runtime env can use provider settings injected by the launcher when appData config is non-secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-desktop-sidecar-config-local-'));
  const appData = join(root, 'appData');
  const configLocalPath = join(appData, 'config', 'config.local.json');
  await mkdir(dirname(configLocalPath), { recursive: true });
  await writeFile(configLocalPath, JSON.stringify({
    llm: {
      provider: 'native',
      baseUrl: '',
      apiKey: '',
      model: 'sciforge-router',
    },
    codexProxy: {
      upstreamBaseUrl: '',
      apiKey: '',
      defaultModel: '',
    },
    sciforge: {
      workspacePath: join(root, 'workspace'),
    },
  }), 'utf8');
  const service = createWorkspaceLocalConfigService({
    configLocalPath,
    runtimeCodexPort: 18080,
    workspaceWriterPort: 5174,
    defaultWorkspacePath: join(root, 'workspace'),
    env: {
      HOME: join(root, 'home'),
      SCIFORGE_CONFIG_PATH: configLocalPath,
      SCIFORGE_DESKTOP_SIDECAR: '1',
      SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: 'http://127.0.0.1:60284',
      SCIFORGE_RUNTIME_API_KEY: 'desktop-launcher-secret',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://desktop-provider.example/v1',
      SCIFORGE_PROXY_DEFAULT_MODEL: 'desktop-upstream-model',
      SCIFORGE_TEXT_BASE_URL: 'https://desktop-provider.example/v1',
      SCIFORGE_TEXT_MODEL: 'desktop-upstream-model',
      SCIFORGE_TEXT_API_KEY: 'desktop-launcher-secret',
      SCIFORGE_VISION_BASE_URL: 'https://desktop-provider.example/v1',
      SCIFORGE_VISION_MODEL: 'desktop-upstream-model',
      SCIFORGE_VISION_API_KEY: 'desktop-launcher-secret',
    } as NodeJS.ProcessEnv,
  });

  const env = await service.runtimeCodexEnvFromLocalConfig();

  assert.equal(env.SCIFORGE_CONFIG_PATH, configLocalPath);
  assert.equal(env.SCIFORGE_RUNTIME_API_KEY, 'desktop-launcher-secret');
  assert.equal(env.SCIFORGE_PROXY_UPSTREAM_BASE_URL, 'https://desktop-provider.example/v1');
  assert.equal(env.SCIFORGE_PROXY_DEFAULT_MODEL, 'desktop-upstream-model');
  assert.equal(env.SCIFORGE_TEXT_BASE_URL, 'https://desktop-provider.example/v1');
  assert.equal(env.SCIFORGE_TEXT_MODEL, 'desktop-upstream-model');
  assert.equal(env.SCIFORGE_TEXT_API_KEY, 'desktop-launcher-secret');
  assert.equal(env.SCIFORGE_VISION_BASE_URL, 'https://desktop-provider.example/v1');
  assert.equal(env.SCIFORGE_VISION_MODEL, 'desktop-upstream-model');
  assert.equal(env.SCIFORGE_VISION_API_KEY, 'desktop-launcher-secret');
  assert.equal(env.SCIFORGE_RUNTIME_PROVIDER, 'sciforge-model-router');
  assert.equal(env.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
  assert.equal(env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL, 'http://127.0.0.1:60284');
});

test('workspace runtime config uses public Model Router alias while preserving raw role env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-local-config-'));
  const runtimeRoot = join(root, 'runtime-codex');
  const codexHome = join(runtimeRoot, 'codex-home');
  const router = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'sciforge.model-router' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
  const address = router.address();
  assert.equal(typeof address, 'object');
  const routerUrl = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`;
  const service = createWorkspaceLocalConfigService({
    configLocalPath: join(root, 'config.local.json'),
    runtimeCodexPort: 18080,
    workspaceWriterPort: 5174,
    defaultWorkspacePath: join(root, 'workspace'),
    defaultProxyBaseUrl: routerUrl,
    env: {
      HOME: join(root, 'home'),
      SCIFORGE_RUNTIME_ROOT: runtimeRoot,
      SCIFORGE_RUNTIME_CODEX_HOME: codexHome,
      SCIFORGE_PROXY_BASE_URL: routerUrl,
    } as NodeJS.ProcessEnv,
  });

  try {
    const env = await service.prepareRuntimeCodexEnvFromLocalConfig({
      codexProxy: {
        provider: 'native',
        upstreamBaseUrl: 'http://provider.example/v1',
        apiKey: 'local-secret',
        defaultModel: 'bailian/deepseek-v4-flash',
      },
    });

    assert.equal(env.SCIFORGE_RUNTIME_PROVIDER, 'sciforge-model-router');
    assert.equal(env.SCIFORGE_RUNTIME_MODEL, 'sciforge-router');
    assert.equal(env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, 'sciforge-router');
    assert.equal(env.SCIFORGE_TEXT_BASE_URL, 'http://provider.example/v1');
    assert.equal(env.SCIFORGE_TEXT_MODEL, 'bailian/deepseek-v4-flash');
    assert.equal(env.SCIFORGE_TEXT_API_KEY, 'local-secret');
    assert.equal(env.SCIFORGE_VISION_API_KEY, 'local-secret');

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8');
    assert.match(config, /model = "sciforge-router"/);
    assert.match(config, /model_provider = "sciforge-model-router"/);
    assert.match(config, new RegExp(`base_url = "${routerUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/v1"`));
    assert.doesNotMatch(config, /model_provider = "native"|bailian\/deepseek-v4-flash|127\.0\.0\.1:3891/);
  } finally {
    await new Promise<void>((resolve, reject) => router.close((error) => error ? reject(error) : resolve()));
  }
});
