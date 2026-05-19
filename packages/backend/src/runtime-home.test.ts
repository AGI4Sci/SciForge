import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  assertPathInside,
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
