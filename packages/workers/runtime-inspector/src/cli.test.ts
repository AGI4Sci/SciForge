import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveRuntimeInspectorCliOptions } from './cli.js'

test('resolves runtime inspector CLI options from env and argv', () => {
  const options = resolveRuntimeInspectorCliOptions([
    '--quiet',
    '--workspace-root',
    '/workspace/from-argv',
    '--model-router-base-url',
    'http://127.0.0.1:3999/v1',
    '--runtime-base-url',
    'http://127.0.0.1:8999',
    '--runtime-token',
    'token-from-argv',
    '--timeout-ms',
    '1234'
  ], {
    SCIFORGE_RUNTIME_INSPECTOR_WORKSPACE_ROOT: '/workspace/from-env',
    SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_TOKEN: 'token-from-env'
  })

  assert.equal(options.quiet, true)
  assert.equal(options.serviceOptions.workspaceRoot, '/workspace/from-argv')
  assert.equal(options.serviceOptions.modelRouterBaseUrl, 'http://127.0.0.1:3999/v1')
  assert.equal(options.serviceOptions.runtimeBaseUrl, 'http://127.0.0.1:8999')
  assert.equal(options.serviceOptions.runtimeToken, 'token-from-argv')
  assert.equal(options.serviceOptions.timeoutMs, 1234)
})
