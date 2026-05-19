import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  assertPathInside,
  assertRuntimeReady,
  DEFAULT_PROXY_BASE_URL,
  getRuntimeHomePaths,
  resolveRuntimeWorkspace,
  RUNTIME_KEY_ENV,
  RUNTIME_MODEL,
  RUNTIME_PROFILE,
  RUNTIME_PROVIDER,
  runtimeConfigToml,
} from './runtime-home';

test('runtime config pins the DeepSeek profile to the local Responses proxy', () => {
  const config = runtimeConfigToml();
  assert.match(config, new RegExp(`profile = "${RUNTIME_PROFILE}"`));
  assert.match(config, new RegExp(`model = "${RUNTIME_MODEL}"`));
  assert.match(config, new RegExp(`model_provider = "${RUNTIME_PROVIDER}"`));
  assert.match(config, new RegExp(`env_key = "${RUNTIME_KEY_ENV}"`));
  assert.match(config, /wire_api = "responses"/);
  assert.match(config, new RegExp(DEFAULT_PROXY_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('runtime CODEX_HOME and default workspace stay under packages/backend', () => {
  const paths = getRuntimeHomePaths();
  assertPathInside(paths.codexHome, paths.runtimeRoot, 'runtime CODEX_HOME');
  assertPathInside(paths.defaultWorkspace, paths.runtimeRoot, 'runtime workspace');
  assert.equal(resolveRuntimeWorkspace(), paths.defaultWorkspace);
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

test('path guard rejects sibling traversal', () => {
  const paths = getRuntimeHomePaths();
  assert.throws(() => assertPathInside(join(paths.runtimeRoot, '..', 'outside'), paths.runtimeRoot, 'test'), /must stay inside/);
});

test('runtime readiness rejects OpenAI-looking proxy without explicit opt-in', async () => {
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
  await writeFile(paths.configPath, runtimeConfigToml('https://api.openai.com/v1'), 'utf8');
  const previousKey = process.env[RUNTIME_KEY_ENV];
  const previousAllow = process.env.SCIFORGE_ALLOW_OPENAI_RUNTIME;
  process.env[RUNTIME_KEY_ENV] = 'test-key';
  delete process.env.SCIFORGE_ALLOW_OPENAI_RUNTIME;
  try {
    await assert.rejects(() => assertRuntimeReady(paths), /OpenAI Runtime Codex provider\/model is disabled/);
    process.env.SCIFORGE_ALLOW_OPENAI_RUNTIME = '1';
    await assert.doesNotReject(() => assertRuntimeReady(paths));
  } finally {
    if (previousKey === undefined) delete process.env[RUNTIME_KEY_ENV];
    else process.env[RUNTIME_KEY_ENV] = previousKey;
    if (previousAllow === undefined) delete process.env.SCIFORGE_ALLOW_OPENAI_RUNTIME;
    else process.env.SCIFORGE_ALLOW_OPENAI_RUNTIME = previousAllow;
  }
});
