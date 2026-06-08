import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  assertPathInside,
  assertRuntimeReady,
  DEFAULT_PROXY_BASE_URL,
  ensureRuntimeHome,
  getRuntimeHomePaths,
  resolveRuntimeWorkspace,
  RUNTIME_KEY_ENV,
  RUNTIME_MODEL,
  RUNTIME_PROFILE,
  RUNTIME_PROVIDER,
  resolveRuntimeCodexSandbox,
  RUNTIME_CODEX_DISABLE_PLUGIN_ARGS,
  RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS,
  runtimeProviderForEnv,
  runtimeConfigToml,
  assertRuntimeModelRouterBaseUrl,
} from './runtime-home';

test('runtime config writes the selected router alias/profile to the local Model Router provider', () => {
  const config = runtimeConfigToml({
    provider: 'sciforge-model-router',
    model: 'sciforge-router',
    proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
  });
  assert.match(config, new RegExp(`profile = "${RUNTIME_PROFILE}"`));
  assert.match(config, /model = "sciforge-router"/);
  assert.match(config, /model_provider = "sciforge-model-router"/);
  assert.match(config, /\[model_providers\.sciforge-model-router\]/);
  assert.match(config, new RegExp(`env_key = "${RUNTIME_KEY_ENV}"`));
  assert.match(config, /wire_api = "responses"/);
  assert.match(config, /\[features\]\s+memories = true\s+prevent_idle_sleep = true\s+plugins = false\s+remote_plugin = false/);
  assert.match(config, /\[sandbox_workspace_write\]\s+network_access = true/);
  assert.deepEqual(RUNTIME_CODEX_DISABLE_PLUGIN_ARGS, [
    '--disable',
    'plugins',
    '--disable',
    'remote_plugin',
  ]);
  assert.deepEqual(RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS, [
    '--config',
    'sandbox_workspace_write.network_access=true',
  ]);
  assert.match(config, new RegExp(DEFAULT_PROXY_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('runtime config falls back to public Model Router defaults when no user model is configured', () => {
  const config = runtimeConfigToml();
  assert.match(config, new RegExp(`model = "${RUNTIME_MODEL}"`));
  assert.match(config, new RegExp(`model_provider = "${RUNTIME_PROVIDER}"`));
  assert.doesNotMatch(config, new RegExp(['deep' + 'seek', 'q' + 'wen', 'bai' + 'lian'].join('|'), 'i'));
});

test('ensureRuntimeHome rewrites stale non-router config to the managed Model Router target', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-runtime-stale-config-'));
  const codexHome = join(runtimeRoot, 'codex-home');
  const paths = getRuntimeHomePaths({
    runtimeRoot,
    codexHome,
    env: {},
  });
  await mkdir(codexHome, { recursive: true });
  await writeFile(paths.configPath, runtimeConfigToml({
    provider: 'native',
    model: 'bailian/deepseek-v4-flash',
    proxyBaseUrl: 'http://127.0.0.1:5175/v1',
  }), 'utf8');

  await ensureRuntimeHome({
    proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
    paths: {
      runtimeRoot,
      codexHome,
      env: {},
    },
  });

  const config = await readFile(paths.configPath, 'utf8');
  assert.match(config, /model = "sciforge-router"/);
  assert.match(config, /model_provider = "sciforge-model-router"/);
  assert.match(config, /\[model_providers\.sciforge-model-router\]/);
  assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:3892\/v1"/);
  assert.doesNotMatch(config, /model_provider = "native"|bailian\/deepseek-v4-flash|127\.0\.0\.1:5175/);
});

test('ensureRuntimeHome rewrites managed config missing Runtime Codex plugin disables', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-runtime-stale-feature-config-'));
  const codexHome = join(runtimeRoot, 'codex-home');
  const paths = getRuntimeHomePaths({
    runtimeRoot,
    codexHome,
    env: {},
  });
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    paths.configPath,
    runtimeConfigToml().replace(/\nplugins = false\nremote_plugin = false\n/, '\n'),
    'utf8',
  );

  await ensureRuntimeHome({
    proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
    paths: {
      runtimeRoot,
      codexHome,
      env: {},
    },
  });

  const config = await readFile(paths.configPath, 'utf8');
  assert.match(config, /\[features\]\s+memories = true\s+prevent_idle_sleep = true\s+plugins = false\s+remote_plugin = false/);
});

test('runtime provider env ignores legacy user-facing native provider id', () => {
  assert.equal(runtimeProviderForEnv({ SCIFORGE_RUNTIME_PROVIDER: 'native' }), RUNTIME_PROVIDER);
  assert.throws(
    () => runtimeProviderForEnv({ SCIFORGE_RUNTIME_PROVIDER: 'sciforge-custom-runtime' }),
    /cannot override Runtime Codex provider/,
  );
});

test('runtime Model Router base URL rejects remote raw provider endpoints', () => {
  assert.equal(assertRuntimeModelRouterBaseUrl('http://127.0.0.1:5175/healthz'), 'http://127.0.0.1:5175/v1');
  assert.equal(assertRuntimeModelRouterBaseUrl('http://localhost:5175/v1/responses'), 'http://localhost:5175/v1');
  assert.throws(
    () => assertRuntimeModelRouterBaseUrl('https://provider.example.test/v1'),
    /local SciForge Model Router loopback/,
  );
  assert.throws(
    () => assertRuntimeModelRouterBaseUrl('http://127.0.0.1:5175/chat/completions'),
    /Model Router \/v1 endpoint/,
  );
});

test('runtime CODEX_HOME and default workspace stay under packages/backend', () => {
  const paths = getRuntimeHomePaths();
  assertPathInside(paths.codexHome, paths.runtimeRoot, 'runtime CODEX_HOME');
  assertPathInside(paths.defaultWorkspace, paths.runtimeRoot, 'runtime workspace');
  assert.equal(resolveRuntimeWorkspace(), paths.defaultWorkspace);
});

test('runtime CODEX_HOME can move to desktop AppData through explicit launcher env', () => {
  const paths = getRuntimeHomePaths({
    env: {
      SCIFORGE_RUNTIME_ROOT: '/Users/example/Library/Application Support/SciForge/runtime',
      SCIFORGE_RUNTIME_CODEX_HOME: '/Users/example/Library/Application Support/SciForge/runtime/codex-home',
      SCIFORGE_RUNTIME_DEFAULT_WORKSPACE: '/Users/example/Library/Application Support/SciForge/runtime/workspaces/default',
    },
  });

  assert.equal(paths.runtimeRoot, '/Users/example/Library/Application Support/SciForge/runtime');
  assert.equal(paths.codexHome, '/Users/example/Library/Application Support/SciForge/runtime/codex-home');
  assert.equal(paths.defaultWorkspace, '/Users/example/Library/Application Support/SciForge/runtime/workspaces/default');
  assertPathInside(paths.codexHome, paths.runtimeRoot, 'runtime CODEX_HOME');
  assertPathInside(paths.defaultWorkspace, paths.runtimeRoot, 'runtime workspace');
});

test('workspace outside runtime root is opt-in', () => {
  assert.throws(() => resolveRuntimeWorkspace({ workspace: '/tmp/sciforge-external-workspace' }), /must stay inside/);
  assert.equal(
    resolveRuntimeWorkspace({
      workspace: '/tmp/sciforge-external-workspace',
      allowWorkspaceOutsideRuntimeRoot: true,
    }),
    '/tmp/sciforge-external-workspace',
  );
});

test('runtime sandbox defaults to workspace-write and rejects invalid env overrides', () => {
  assert.equal(resolveRuntimeCodexSandbox({}), 'workspace-write');
  assert.equal(resolveRuntimeCodexSandbox({ SCIFORGE_RUNTIME_CODEX_SANDBOX: 'danger-full-access' }), 'danger-full-access');
  assert.throws(
    () => resolveRuntimeCodexSandbox({ SCIFORGE_RUNTIME_CODEX_SANDBOX: 'network-only' }),
    /SCIFORGE_RUNTIME_CODEX_SANDBOX must be one of/,
  );
});

test('path guard rejects sibling traversal', () => {
  const paths = getRuntimeHomePaths();
  assert.throws(() => assertPathInside(join(paths.runtimeRoot, '..', 'outside'), paths.runtimeRoot, 'test'), /must stay inside/);
});

test('runtime readiness rejects non-router providers and remote raw endpoints', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-runtime-ready-'));
  const codexHome = join(runtimeRoot, 'codex-home');
  const paths = {
    backendRoot: runtimeRoot,
    runtimeRoot,
    codexHome,
    configPath: join(codexHome, 'config.toml'),
    memoriesDir: join(codexHome, 'memories'),
    sessionsDir: join(codexHome, 'sessions'),
    logsDir: join(runtimeRoot, 'logs'),
    defaultWorkspace: join(runtimeRoot, 'workspaces', 'default'),
  };
  await mkdir(codexHome, { recursive: true });
  await writeFile(paths.configPath, runtimeConfigToml({ proxyBaseUrl: 'https://api.openai.com/v1', provider: 'openai-compatible', model: 'gpt-test' }), 'utf8');
  const configLocalPath = join(runtimeRoot, 'config.local.json');
  await writeFile(configLocalPath, JSON.stringify({
    llm: {
      baseUrl: 'https://provider.example/v1',
      apiKey: 'test-key',
      model: 'test-model',
    },
  }), 'utf8');
  const env = {
    SCIFORGE_CONFIG_PATH: configLocalPath,
    [RUNTIME_KEY_ENV]: 'service-runtime-key',
  } as NodeJS.ProcessEnv;

  await assert.rejects(() => assertRuntimeReady(paths, { env }), /must be sciforge-model-router|local SciForge Model Router/);
  env.SCIFORGE_ALLOW_OPENAI_RUNTIME = '1';
  await assert.rejects(() => assertRuntimeReady(paths, { env }), /must be sciforge-model-router|local SciForge Model Router/);
});

test('runtime readiness rejects OpenAI-looking router aliases without an opt-in bypass', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-runtime-openai-alias-'));
  const codexHome = join(runtimeRoot, 'codex-home');
  const paths = {
    backendRoot: runtimeRoot,
    runtimeRoot,
    codexHome,
    configPath: join(codexHome, 'config.toml'),
    memoriesDir: join(codexHome, 'memories'),
    sessionsDir: join(codexHome, 'sessions'),
    logsDir: join(runtimeRoot, 'logs'),
    defaultWorkspace: join(runtimeRoot, 'workspaces', 'default'),
  };
  await mkdir(codexHome, { recursive: true });
  await writeFile(paths.configPath, runtimeConfigToml({
    proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
    provider: RUNTIME_PROVIDER,
    model: 'openai-direct-model',
  }), 'utf8');
  const env = {
    [RUNTIME_KEY_ENV]: 'service-runtime-key',
    SCIFORGE_ALLOW_OPENAI_RUNTIME: '1',
  } as NodeJS.ProcessEnv;

  await assert.rejects(
    () => assertRuntimeReady(paths, { env }),
    /OpenAI-looking Runtime Codex provider\/model is disabled/,
  );
});

test('runtime readiness requires service env Runtime API key and rejects config.local member-model secrets', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-runtime-config-local-ready-'));
  const codexHome = join(runtimeRoot, 'codex-home');
  const configLocalPath = join(runtimeRoot, 'config.local.json');
  const paths = {
    backendRoot: runtimeRoot,
    runtimeRoot,
    codexHome,
    configPath: join(codexHome, 'config.toml'),
    memoriesDir: join(codexHome, 'memories'),
    sessionsDir: join(codexHome, 'sessions'),
    logsDir: join(runtimeRoot, 'logs'),
    defaultWorkspace: join(runtimeRoot, 'workspaces', 'default'),
  };
  await mkdir(codexHome, { recursive: true });
  await writeFile(configLocalPath, JSON.stringify({
    llm: {
      baseUrl: 'https://provider.example/v1',
      apiKey: 'config-local-secret',
      model: 'config-local-model',
    },
  }), 'utf8');
  await writeFile(paths.configPath, runtimeConfigToml({ proxyBaseUrl: DEFAULT_PROXY_BASE_URL }), 'utf8');

  const env = {
    SCIFORGE_CONFIG_PATH: configLocalPath,
  } as NodeJS.ProcessEnv;

  await assert.rejects(
    () => assertRuntimeReady(paths, { env }),
    /Missing SCIFORGE_RUNTIME_API_KEY/,
  );
  assert.equal(env[RUNTIME_KEY_ENV], undefined);

  env[RUNTIME_KEY_ENV] = 'service-runtime-key';
  await assert.doesNotReject(() => assertRuntimeReady(paths, { env }));

  const config = await readFile(paths.configPath, 'utf8');
  assert.doesNotMatch(config, /config-local-secret/);
  assert.doesNotMatch(config, /service-runtime-key/);
  assert.match(config, new RegExp(`env_key = "${RUNTIME_KEY_ENV}"`));
});

test('runtime readiness does not require config.local when Runtime API key is in service env', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-runtime-missing-config-local-'));
  const codexHome = join(runtimeRoot, 'codex-home');
  const paths = {
    backendRoot: runtimeRoot,
    runtimeRoot,
    codexHome,
    configPath: join(codexHome, 'config.toml'),
    memoriesDir: join(codexHome, 'memories'),
    sessionsDir: join(codexHome, 'sessions'),
    logsDir: join(runtimeRoot, 'logs'),
    defaultWorkspace: join(runtimeRoot, 'workspaces', 'default'),
  };
  await mkdir(codexHome, { recursive: true });
  await writeFile(paths.configPath, runtimeConfigToml({ proxyBaseUrl: DEFAULT_PROXY_BASE_URL }), 'utf8');

  await assert.doesNotReject(() => assertRuntimeReady(paths, {
    env: {
      SCIFORGE_CONFIG_PATH: join(runtimeRoot, 'missing-config.local.json'),
      [RUNTIME_KEY_ENV]: 'service-runtime-key',
    } as NodeJS.ProcessEnv,
  }));
});
