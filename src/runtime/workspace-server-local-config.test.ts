import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanUrlString,
  configuredString,
  normalizeConfiguredPeerInstances,
  normalizePeerInstances,
  normalizeToolProviderRoutes,
  parseJsonEnv,
  preserveConfiguredSecretString,
  repairPeerInstancesFromCounterpartJson,
  stringArray,
} from './workspace-server-local-config.js';

test('preserveConfiguredSecretString keeps masked and blank secret values from overwriting configured secrets', () => {
  assert.equal(preserveConfiguredSecretString('\u2022\u2022\u2022\u2022 masked', 'live-secret'), 'live-secret');
  assert.equal(preserveConfiguredSecretString('   ', 'live-secret'), 'live-secret');
  assert.equal(preserveConfiguredSecretString(undefined, 'live-secret'), 'live-secret');
});

test('preserveConfiguredSecretString allows an intentionally empty secret when no current secret exists', () => {
  assert.equal(preserveConfiguredSecretString('', ''), '');
  assert.equal(preserveConfiguredSecretString('   ', ''), '   ');
  assert.equal(preserveConfiguredSecretString('', undefined), '');
  assert.equal(preserveConfiguredSecretString('new-secret', 'live-secret'), 'new-secret');
});

test('configuredString, parseJsonEnv, cleanUrlString, and stringArray mirror local config normalization helpers', () => {
  assert.equal(configuredString('  http://provider.example/v1  ', 'old'), 'http://provider.example/v1');
  assert.equal(configuredString(undefined, '  old  '), 'old');
  assert.deepEqual(parseJsonEnv(' {"workspaceWriterUrl":"http://127.0.0.1:3999"} '), { workspaceWriterUrl: 'http://127.0.0.1:3999' });
  assert.equal(parseJsonEnv('not-json'), 'not-json');
  assert.equal(parseJsonEnv('  '), undefined);
  assert.equal(cleanUrlString(' https://example.test/path/// '), 'https://example.test/path');
  assert.deepEqual(stringArray([' alpha ', '', 'beta', 'alpha', 42, ' beta ']), ['alpha', 'beta']);
});

test('normalizePeerInstances sanitizes peer records and defaults unsafe enum values', () => {
  assert.deepEqual(normalizePeerInstances([
    'ignored',
    {
      name: '  main ',
      appUrl: ' http://127.0.0.1:5173/// ',
      workspaceWriterUrl: ' http://127.0.0.1:3999/// ',
      workspacePath: ' /tmp/workspace/.sciforge/versions/// ',
      role: 'main',
      trustLevel: 'sync',
      enabled: false,
    },
    {
      name: ' repair ',
      appUrl: 42,
      workspaceWriterUrl: ' http://127.0.0.1:4000/ ',
      workspacePath: '',
      role: 'admin',
      trustLevel: 'owner',
    },
  ]), [
    {
      name: 'main',
      appUrl: 'http://127.0.0.1:5173',
      workspaceWriterUrl: 'http://127.0.0.1:3999',
      workspacePath: '/tmp/workspace',
      role: 'main',
      trustLevel: 'sync',
      enabled: false,
    },
    {
      name: 'repair',
      appUrl: '',
      workspaceWriterUrl: 'http://127.0.0.1:4000',
      workspacePath: '',
      role: 'peer',
      trustLevel: 'readonly',
      enabled: true,
    },
  ]);

  assert.deepEqual(normalizePeerInstances(undefined), []);
});

test('SCIFORGE_COUNTERPART_JSON repair fallback produces a repair peer without reading process env', () => {
  const counterpartJson = JSON.stringify({
    agentId: ' repair-agent ',
    name: 'fallback-name',
    appUrl: ' http://127.0.0.1:5174/// ',
    workspaceWriterUrl: ' http://127.0.0.1:4001/// ',
    workspacePath: ' /tmp/repair-workspace/.sciforge ',
  });

  assert.deepEqual(repairPeerInstancesFromCounterpartJson(counterpartJson), [{
    name: 'repair-agent',
    appUrl: 'http://127.0.0.1:5174',
    workspaceWriterUrl: 'http://127.0.0.1:4001',
    workspacePath: '/tmp/repair-workspace',
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
  }]);

  assert.deepEqual(normalizeConfiguredPeerInstances(undefined, counterpartJson), [{
    name: 'repair-agent',
    appUrl: 'http://127.0.0.1:5174',
    workspaceWriterUrl: 'http://127.0.0.1:4001',
    workspacePath: '/tmp/repair-workspace',
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
  }]);
  assert.deepEqual(repairPeerInstancesFromCounterpartJson('not-json'), []);
  assert.deepEqual(repairPeerInstancesFromCounterpartJson(JSON.stringify({ appUrl: 'http://127.0.0.1:5174' })), []);
});

test('normalizeConfiguredPeerInstances prefers explicit peer instances over counterpart fallback', () => {
  assert.deepEqual(normalizeConfiguredPeerInstances([
    {
      name: ' explicit ',
      workspaceWriterUrl: ' http://127.0.0.1:5000/ ',
      role: 'peer',
      trustLevel: 'readonly',
    },
  ], JSON.stringify({ agentId: 'repair', workspaceWriterUrl: 'http://127.0.0.1:4001' })), [{
    name: 'explicit',
    appUrl: '',
    workspaceWriterUrl: 'http://127.0.0.1:5000',
    workspacePath: '',
    role: 'peer',
    trustLevel: 'readonly',
    enabled: true,
  }]);
});

test('normalizeToolProviderRoutes trims route fields, filters enums, de-duplicates arrays, and clamps timeouts', () => {
  assert.deepEqual(normalizeToolProviderRoutes({
    ' package.tools ': {
      enabled: true,
      capabilityId: ' capability.invoke ',
      source: ' package ',
      primaryProviderId: ' provider-main ',
      fallbackProviderIds: [' provider-b ', 'provider-b', 'provider-c', '', 123],
      permissions: [' read ', 'write', 'read'],
      requiredConfig: [' apiKey ', 'baseUrl', 'apiKey'],
      health: ' ready ',
      endpoint: ' https://provider.example/endpoint/// ',
      baseUrl: ' https://provider.example/base/// ',
      url: '',
      invokeUrl: ' https://provider.example/invoke/// ',
      invokePath: ' /tools/invoke/// ',
      timeoutMs: 999.9,
      ignored: 'discard',
    },
    invalid: {
      source: 'root',
      health: 'broken',
      fallbackProviderIds: [''],
      timeoutMs: Number.POSITIVE_INFINITY,
    },
    ' ': {
      enabled: true,
    },
    scalar: 'ignored',
  }), {
    'package.tools': {
      enabled: true,
      capabilityId: 'capability.invoke',
      source: 'package',
      primaryProviderId: 'provider-main',
      fallbackProviderIds: ['provider-b', 'provider-c'],
      permissions: ['read', 'write'],
      requiredConfig: ['apiKey', 'baseUrl'],
      health: 'ready',
      endpoint: 'https://provider.example/endpoint',
      baseUrl: 'https://provider.example/base',
      invokeUrl: 'https://provider.example/invoke',
      invokePath: '/tools/invoke',
      timeoutMs: 1000,
    },
  });

  assert.equal(normalizeToolProviderRoutes(undefined), undefined);
  assert.equal(normalizeToolProviderRoutes({ empty: { source: 'root' } }), undefined);
});
