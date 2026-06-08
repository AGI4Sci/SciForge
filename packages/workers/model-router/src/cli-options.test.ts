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
  ], {
    SCIFORGE_MODEL_ROUTER_HOST: '0.0.0.0',
    SCIFORGE_MODEL_ROUTER_PORT: '59009',
    SCIFORGE_WORKSPACE_PATH: '/tmp/env-workspace',
  });

  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.port, 5175);
  assert.equal(options.workspaceRoot, '/tmp/explicit-workspace');
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
