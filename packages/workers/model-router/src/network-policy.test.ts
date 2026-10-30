import assert from 'node:assert/strict';
import test from 'node:test';

import { assertLoopbackBinding, isLoopbackHost, normalizeLoopbackHost } from './network-policy.js';
import { startModelRouterServer, type ModelRouterConfig } from './router.js';

const config: ModelRouterConfig = {
  defaultProfile: 'default',
  profiles: {
    default: {
      textReasoner: {
        baseUrl: 'https://provider.example/v1',
        apiKeyEnv: 'MODEL_ROUTER_TEST_KEY',
        model: 'test-model',
      },
      translators: {},
    },
  },
};

test('recognizes IPv4 and IPv6 loopback literals only', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.255.255.254'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('localhost'), false);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('::'), false);
  assert.equal(isLoopbackHost('192.168.1.10'), false);
  assert.equal(isLoopbackHost('2001:db8::1'), false);
});

test('fails closed before a server can bind a non-loopback address', () => {
  assert.throws(() => assertLoopbackBinding('0.0.0.0'), /loopback/);
  assert.throws(() => assertLoopbackBinding('::'), /loopback/);
  assert.throws(() => assertLoopbackBinding('10.0.0.8'), /loopback/);
  assert.doesNotThrow(() => assertLoopbackBinding('127.0.0.1'));
  assert.doesNotThrow(() => assertLoopbackBinding('::1'));
  assert.equal(normalizeLoopbackHost('[::1]'), '::1');
});

test('standalone server rejects public binding and formats IPv6 loopback URLs', async (t) => {
  await assert.rejects(
    startModelRouterServer({ host: '0.0.0.0', port: 0, config }),
    /loopback/,
  );

  let started;
  try {
    started = await startModelRouterServer({ host: '::1', port: 0, config });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRNOTAVAIL') {
      t.skip('IPv6 loopback is unavailable in this environment.');
      return;
    }
    throw error;
  }
  try {
    assert.match(started.url, /^http:\/\/\[::1\]:\d+$/);
    assert.equal(new URL(started.url).hostname, '[::1]');
  } finally {
    await started.close();
  }
});
