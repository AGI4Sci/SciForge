import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlanGatewayCliArgs, resolvePlanGatewayCliOptions } from './cli-options';

test('uses simple loopback Codex defaults', () => {
  assert.deepEqual(resolvePlanGatewayCliOptions([], {}), {
    adapterId: 'codex',
    host: '127.0.0.1',
    port: 3893,
    mountPath: '/v1',
    instanceId: undefined,
    userDataDirectory: undefined,
    traceStorageDirectory: undefined,
    proxyRules: undefined,
    quiet: false,
  });
});

test('resolves CLI values before environment values', () => {
  assert.deepEqual(resolvePlanGatewayCliOptions([
    '--adapter', 'test-plan',
    '--host', '127.0.0.2',
    '--port', '4321',
    '--mount-path', '/gateway',
    '--instance-id', 'cli-instance',
    '--user-data-dir', '/tmp/sciforge-user-data',
    '--quiet',
  ], {
    SCIFORGE_PLAN_GATEWAY_ADAPTER: 'environment-plan',
    SCIFORGE_PLAN_GATEWAY_INSTANCE_ID: 'environment-instance',
  }), {
    adapterId: 'test-plan',
    host: '127.0.0.2',
    port: 4321,
    mountPath: '/gateway',
    instanceId: 'cli-instance',
    userDataDirectory: '/tmp/sciforge-user-data',
    traceStorageDirectory: undefined,
    proxyRules: undefined,
    quiet: true,
  });
});

test('rejects unknown and incomplete arguments', () => {
  assert.throws(() => parsePlanGatewayCliArgs(['--unknown']), /Unknown/);
  assert.throws(() => parsePlanGatewayCliArgs(['--adapter']), /Missing value/);
});
