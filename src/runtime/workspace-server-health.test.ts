import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildWorkspaceWriterHealth,
  WORKSPACE_WRITER_HEALTH_CAPABILITIES,
} from './workspace-server-health.js';

test('workspace writer health helper preserves the public health response shape', () => {
  const health = buildWorkspaceWriterHealth({
    pid: 1234,
    startedAt: '2026-05-29T00:00:00.000Z',
    instanceId: 'p2',
    lifecycleToken: 'lifecycle-token',
    browserHostNativeAdapterUrl: 'http://127.0.0.1:4999',
  });

  assert.deepEqual(health, {
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    pid: 1234,
    startedAt: '2026-05-29T00:00:00.000Z',
    instanceId: 'p2',
    lifecycleToken: 'lifecycle-token',
    capabilities: [...WORKSPACE_WRITER_HEALTH_CAPABILITIES],
    endpoints: {
      runtimeModuleDispatcher: '/api/sciforge/modules/{describe,query,read,invoke}',
      browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions}',
      browserHostNativeSurface: 'http://127.0.0.1:4999/{health,sessions/{sessionId}/{attach,state}}',
      browserHostDiagnostics: '/api/sciforge/browser-host/sessions/{frame,frame-stream}',
      browserHostSearch: '/api/sciforge/browser-host/search',
      runtimeCodex: '/api/sciforge/runtime/codex/{stream,realtime/ws}',
    },
  });
  assert.ok(health.capabilities.includes('workspace-files'));
  assert.ok(health.capabilities.includes('runtime-module-dispatcher'));
  assert.ok(health.capabilities.includes('workspace-terminal-websocket-pty'));
  assert.ok(health.capabilities.includes('browser-host-session'));
  assert.ok(health.capabilities.includes('browser-host-native-surface'));
  assert.ok(health.capabilities.includes('browser-host-search'));
  assert.ok(health.capabilities.includes('repair-handoff-runner'));
  assert.ok(health.capabilities.includes('stable-version-registry'));
});

test('workspace writer health does not claim native browser surface readiness without a loopback adapter', () => {
  const health = buildWorkspaceWriterHealth({
    pid: 1234,
    startedAt: '2026-05-29T00:00:00.000Z',
    instanceId: 'default',
    browserHostNativeAdapterUrl: '',
  });

  assert.equal(health.capabilities.includes('browser-host-native-surface'), false);
  assert.equal('browserHostNativeSurface' in health.endpoints, false);
  assert.equal(health.endpoints.browserHostDiagnostics, '/api/sciforge/browser-host/sessions/{frame,frame-stream}');
});

test('workspace writer health omits empty lifecycle tokens after JSON serialization', () => {
  const serialized = JSON.stringify(buildWorkspaceWriterHealth({
    pid: 1234,
    startedAt: '2026-05-29T00:00:00.000Z',
    instanceId: 'default',
    lifecycleToken: '',
    browserHostNativeAdapterUrl: '',
  }));

  assert.doesNotMatch(serialized, /lifecycleToken/);
});
