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

test('path guard rejects sibling traversal', () => {
  const paths = getRuntimeHomePaths();
  assert.throws(() => assertPathInside(join(paths.runtimeRoot, '..', 'outside'), paths.runtimeRoot, 'test'), /must stay inside/);
});
