import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROXY_BASE_URL,
  ensureRuntimeHome,
  RUNTIME_KEY_ENV,
  RUNTIME_MODEL,
  RUNTIME_PROFILE,
  RUNTIME_PROVIDER,
} from '../../../packages/backend/src/runtime-home.js';
import { assertCodexRuntimeConfig, codexRuntimeEnv } from './codex-runtime-config.js';

test('runtime config guard accepts isolated DeepSeek proxy profile', async () => {
  const workspace = await tempWorkspace();
  const config = await assertCodexRuntimeConfig({
    workspacePath: workspace,
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    configText: runtimeConfig(),
  });

  assert.equal(config.profile, RUNTIME_PROFILE);
  assert.equal(config.provider, RUNTIME_PROVIDER);
  assert.equal(config.model, RUNTIME_MODEL);
  assert.equal(config.proxyBaseUrl, DEFAULT_PROXY_BASE_URL);
  assert.match(config.codexHome, /packages\/backend\/\.codex-runtime\/codex-home$/);
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
  assert.equal(config.proxyBaseUrl, 'http://127.0.0.1:3892/v1');
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

test('runtime config guard fails closed when DeepSeek proxy key is missing', async () => {
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
  assert.equal(config.proxyBaseUrl, 'https://api.openai.com/v1');
});

test('runtime environment forces isolated CODEX_HOME over inherited values', () => {
  const env = codexRuntimeEnv({ CODEX_HOME: '/Users/example/.codex', CODEX_USER_HOME: 'legacy' }, '/isolated/codex-home');

  assert.equal(env.CODEX_HOME, '/isolated/codex-home');
  assert.equal(env.CODEX_USER_HOME, undefined);
});

async function tempWorkspace() {
  await ensureRuntimeHome();
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-codex-runtime-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

function runtimeConfig(options: { proxyBaseUrl?: string } = {}) {
  const baseUrlLine = options.proxyBaseUrl === undefined ? `base_url = "${DEFAULT_PROXY_BASE_URL}"` : options.proxyBaseUrl ? `base_url = "${options.proxyBaseUrl}"` : '';
  return `model = "${RUNTIME_MODEL}"
profile = "${RUNTIME_PROFILE}"

[profiles.${RUNTIME_PROFILE}]
model = "${RUNTIME_MODEL}"
model_provider = "${RUNTIME_PROVIDER}"

[model_providers.${RUNTIME_PROVIDER}]
name = "SciForge DeepSeek Proxy"
${baseUrlLine}
env_key = "${RUNTIME_KEY_ENV}"
wire_api = "responses"
`;
}
