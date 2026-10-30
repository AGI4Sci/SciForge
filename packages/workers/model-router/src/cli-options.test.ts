import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveModelRouterCliOptions } from './cli-options.js';

test('Model Router CLI binds launcher-provided Model Router port when args omit --port', () => {
  const options = resolveModelRouterCliOptions(['--quiet'], {
    SCIFORGE_MODEL_ROUTER_PORT: '59009',
    SCIFORGE_WORKSPACE_PATH: '/tmp/sciforge-workspace',
  });

  assert.equal(options.port, 59009);
  assert.equal(options.workspaceRoot, '/tmp/sciforge-workspace');
  assert.equal(options.quiet, true);
});

test('Model Router CLI explicit args override launcher env defaults', () => {
  const options = resolveModelRouterCliOptions([
    '--host',
    '127.0.0.1',
    '--port',
    '5175',
    '--workspace-root',
    '/tmp/explicit-workspace',
    '--user-data-dir',
    '/tmp/explicit-user-data',
  ], {
    SCIFORGE_MODEL_ROUTER_HOST: '0.0.0.0',
    SCIFORGE_MODEL_ROUTER_PORT: '59009',
    SCIFORGE_WORKSPACE_PATH: '/tmp/env-workspace',
    SCIFORGE_MODEL_ROUTER_USER_DATA_DIR: '/tmp/env-user-data',
  });

  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.port, 5175);
  assert.equal(options.workspaceRoot, '/tmp/explicit-workspace');
  assert.equal(options.userDataDir, '/tmp/explicit-user-data');
});

test('Model Router CLI accepts launcher-provided user data root', () => {
  const options = resolveModelRouterCliOptions([], {
    SCIFORGE_MODEL_ROUTER_USER_DATA_DIR: '/tmp/sciforge-user-data',
  });

  assert.equal(options.userDataDir, '/tmp/sciforge-user-data');
});

test('Model Router CLI ignores legacy proxy env aliases', () => {
  const options = resolveModelRouterCliOptions(['--quiet'], {
    SCIFORGE_PROXY_HOST: '0.0.0.0',
    SCIFORGE_PROXY_PORT: '59009',
    SCIFORGE_WORKSPACE_PATH: '/tmp/sciforge-workspace',
  });

  assert.equal(options.host, undefined);
  assert.equal(options.port, undefined);
  assert.equal(options.workspaceRoot, '/tmp/sciforge-workspace');
});

test('Model Router CLI accepts configuration only through --config', () => {
  const options = resolveModelRouterCliOptions([
    '--config',
    '/tmp/explicit-config.json',
  ], {
    SCIFORGE_MODEL_ROUTER_CONFIG: '/tmp/parallel-env-config.json',
  });

  assert.equal(options.configPath, '/tmp/explicit-config.json');
  assert.equal(resolveModelRouterCliOptions([], {
    SCIFORGE_MODEL_ROUTER_CONFIG: '/tmp/parallel-env-config.json',
  }).configPath, undefined);
});
