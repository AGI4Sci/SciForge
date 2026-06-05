import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROXY_BASE_URL,
  getRuntimeHomePaths,
  RUNTIME_KEY_ENV,
  RUNTIME_MODEL,
  RUNTIME_PROFILE,
  RUNTIME_PROVIDER,
} from '../../../packages/backend/src/runtime-home.js';
import { assertCodexRuntimeConfig, codexRuntimeEnv } from './codex-runtime-config.js';

test('runtime config guard accepts isolated Model Router profile without exposing private endpoint settings', async () => {
  const workspace = await tempWorkspace();
  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    configText: runtimeConfig(),
  });

  assert.equal(config.profile, RUNTIME_PROFILE);
  assert.equal(config.provider, RUNTIME_PROVIDER);
  assert.equal(config.model, RUNTIME_MODEL);
  assert.equal('proxyBaseUrl' in config, false);
  assert.equal('runtimeKeyEnv' in config, false);
  assert.deepEqual(config.capabilities, ['text', 'vision']);
  assert.deepEqual(config.roleCoverage, {
    textReasoner: 'configured',
    visionTranslator: 'configured',
  });
  assert.match(config.codexHome, /packages\/backend\/\.codex-runtime\/codex-home$/);
});

test('runtime config guard normalizes private raw provider and model slugs out of runtime metadata', async () => {
  const workspace = await tempWorkspace();
  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    configText: runtimeConfig({
      provider: 'sciforge-deepseek-proxy',
      model: 'deepseek-chat',
    }),
  });

  assert.equal(config.provider, RUNTIME_PROVIDER);
  assert.equal(config.model, RUNTIME_MODEL);
  assert.doesNotMatch(JSON.stringify(config), /sciforge-deepseek-proxy|deepseek-chat/);
});

test('runtime config guard normalizes private raw slugs hidden behind public router prefixes', async () => {
  const workspace = await tempWorkspace();
  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    configText: runtimeConfig({
      provider: 'sciforge-model-router-deepseek-proxy',
      model: 'sciforge-router-deepseek-chat',
    }),
  });

  assert.equal(config.provider, RUNTIME_PROVIDER);
  assert.equal(config.model, RUNTIME_MODEL);
  assert.doesNotMatch(JSON.stringify(config), /deepseek|proxy|chat/);
});

test('runtime config guard accepts a public router alias override without returning raw provider settings', async () => {
  const workspace = await tempWorkspace();
  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    configText: runtimeConfig({
      provider: 'sciforge-model-router-preview',
      model: 'sciforge-router-preview',
      proxyBaseUrl: 'http://127.0.0.1:3891/v1',
    }),
  });

  assert.equal(config.provider, 'sciforge-model-router-preview');
  assert.equal(config.model, 'sciforge-router-preview');
  assert.equal('proxyBaseUrl' in config, false);
});

test('runtime config guard reads CODEX_HOME from the supplied runtime env', async () => {
  const workspace = await tempWorkspace();
  const root = await mkdtemp(join(tmpdir(), 'sciforge-runtime-env-root-'));
  const codexHome = join(root, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(codexHome, 'config.toml'), runtimeConfig({ proxyBaseUrl: 'http://127.0.0.1:3892/v1' }), 'utf8');

  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: {
      SCIFORGE_RUNTIME_ROOT: root,
      SCIFORGE_RUNTIME_CODEX_HOME: codexHome,
      [RUNTIME_KEY_ENV]: 'test-key',
    },
  });

  assert.equal(config.codexHome, codexHome);
  assert.equal(config.provider, RUNTIME_PROVIDER);
  assert.equal(config.model, RUNTIME_MODEL);
});

test('runtime config guard heals stale on-disk provider config before app-server launch', async () => {
  const workspace = await tempWorkspace();
  const root = await mkdtemp(join(tmpdir(), 'sciforge-runtime-heal-root-'));
  const codexHome = join(root, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(codexHome, 'config.toml'), runtimeConfig({
    provider: 'native',
    model: 'bailian/deepseek-v4-flash',
    proxyBaseUrl: 'http://127.0.0.1:3891/v1',
  }), 'utf8');

  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: {
      SCIFORGE_RUNTIME_ROOT: root,
      SCIFORGE_RUNTIME_CODEX_HOME: codexHome,
      SCIFORGE_PROXY_BASE_URL: 'http://127.0.0.1:5175',
      [RUNTIME_KEY_ENV]: 'test-key',
    },
  });

  assert.equal(config.provider, RUNTIME_PROVIDER);
  assert.equal(config.model, RUNTIME_MODEL);
  const healedConfig = await readFile(join(codexHome, 'config.toml'), 'utf8');
  assert.match(healedConfig, /\[model_providers\.sciforge-model-router\]/);
  assert.match(healedConfig, /model_provider = "sciforge-model-router"/);
  assert.match(healedConfig, /model = "sciforge-router"/);
  assert.match(healedConfig, /base_url = "http:\/\/127\.0\.0\.1:5175\/v1"/);
  assert.doesNotMatch(healedConfig, /model_provider = "native"|bailian\/deepseek-v4-flash|127\.0\.0\.1:3891/);
});

test('runtime config guard fails closed when workspace is missing', async () => {
  await assert.rejects(
    () => assertCodexRuntimeConfig({
      workspacePath: join(tmpdir(), `missing-sciforge-${Date.now()}`),
      env: { [RUNTIME_KEY_ENV]: 'test-key' },
      configText: runtimeConfig(),
    }),
    /workspace does not exist/,
  );
});

test('runtime config guard fails closed when Model Router provider key is missing', async () => {
  const workspace = await tempWorkspace();
  await assert.rejects(
    () => assertCodexRuntimeConfig({
      workspacePath: workspace,
      env: {},
      configText: runtimeConfig(),
    }),
    new RegExp(`Missing ${RUNTIME_KEY_ENV}`),
  );
});

test('runtime config guard fails closed when runtime profile is missing', async () => {
  const workspace = await tempWorkspace();
  await assert.rejects(
    () => assertCodexRuntimeConfig({
      workspacePath: workspace,
      env: { [RUNTIME_KEY_ENV]: 'test-key' },
      configText: `model = "${RUNTIME_MODEL}"\n`,
    }),
    new RegExp(`missing profile ${RUNTIME_PROFILE}`),
  );
});

test('runtime config guard rejects Developer Codex profiles instead of inheriting them', async () => {
  const workspace = await tempWorkspace();
  await assert.rejects(
    () => assertCodexRuntimeConfig({
      workspacePath: workspace,
      profile: 'developer',
      env: { [RUNTIME_KEY_ENV]: 'test-key' },
      configText: runtimeConfig(),
    }),
    new RegExp(`Unsupported Runtime Codex profile: developer. Expected ${RUNTIME_PROFILE}`),
  );
});

test('runtime config guard fails closed when proxy base_url is missing', async () => {
  const workspace = await tempWorkspace();
  await assert.rejects(
    () => assertCodexRuntimeConfig({
      workspacePath: workspace,
      env: { [RUNTIME_KEY_ENV]: 'test-key' },
      configText: runtimeConfig({ proxyBaseUrl: '' }),
    }),
    /missing proxy base_url/,
  );
});

test('OpenAI-looking runtime endpoint is blocked unless explicitly opted in', async () => {
  const workspace = await tempWorkspace();
  const configText = runtimeConfig({ proxyBaseUrl: 'https://api.openai.com/v1' });
  await assert.rejects(
    () => assertCodexRuntimeConfig({
      workspacePath: workspace,
      env: { [RUNTIME_KEY_ENV]: 'test-key' },
      configText,
    }),
    /allowOpenAiRuntime=true/,
  );

  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    configText,
    allowOpenAiRuntime: true,
  });
  assert.equal(config.provider, RUNTIME_PROVIDER);
  assert.equal(config.model, RUNTIME_MODEL);
});

test('runtime environment forces isolated CODEX_HOME over inherited values', () => {
  const env = codexRuntimeEnv({ CODEX_HOME: '/Users/example/.codex', CODEX_USER_HOME: 'legacy' }, '/isolated/codex-home');

  assert.equal(env.CODEX_HOME, '/isolated/codex-home');
  assert.equal(env.CODEX_USER_HOME, undefined);
});

async function tempWorkspace() {
  await mkdir(getRuntimeHomePaths().codexHome, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-codex-runtime-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

function runtimeConfig(options: { proxyBaseUrl?: string; provider?: string; model?: string } = {}) {
  const provider = options.provider ?? RUNTIME_PROVIDER;
  const model = options.model ?? RUNTIME_MODEL;
  const baseUrlLine = options.proxyBaseUrl === undefined ? `base_url = "${DEFAULT_PROXY_BASE_URL}"` : options.proxyBaseUrl ? `base_url = "${options.proxyBaseUrl}"` : '';
  return `model = "${model}"
profile = "${RUNTIME_PROFILE}"

[profiles.${RUNTIME_PROFILE}]
model = "${model}"
model_provider = "${provider}"

[model_providers.${provider}]
name = "SciForge Runtime Provider"
${baseUrlLine}
env_key = "${RUNTIME_KEY_ENV}"
wire_api = "responses"
`;
}
