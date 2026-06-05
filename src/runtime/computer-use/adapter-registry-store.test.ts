import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BROWSER_HOST_COMPUTER_USE_PROVIDER_ID } from '../browser-host-computer-use.js';
import { BROWSER_HOST_SESSION_PROVIDER_ID, type BrowserHostSessionState } from '../browser-host-session.js';
import {
  createDefaultComputerUseAdapterRegistry,
  createInMemoryComputerUseAdapterRegistry,
} from './adapter-registry-store.js';

test('default registry blocks BrowserHost adapter until a runtime probe proves the native surface', () => {
  const registry = createDefaultComputerUseAdapterRegistry({ now: () => new Date('2026-06-06T01:00:00.000Z') });

  const beforeProbe = registry.getReady(BROWSER_HOST_COMPUTER_USE_PROVIDER_ID);
  assert.equal(beforeProbe.status, 'blocked');
  assert.equal(beforeProbe.ready, false);
  assert.match(beforeProbe.blockedReason ?? '', /runtime probe/i);
  assert.deepEqual(beforeProbe.refs, ['adapter-registry:browser-host-session/computer-use']);

  const ready = registry.probe({
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    browserHostSession: readyBrowserHostSession(),
    evidenceRefs: [
      'runtime-truth:native-surface-health',
      'browser-host-session:session-1/computer-use-adapter',
    ],
  });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.ready, true);
  assert.equal(ready.providerId, BROWSER_HOST_COMPUTER_USE_PROVIDER_ID);
  assert.deepEqual(ready.refs, [
    'adapter-registry:browser-host-session/computer-use',
    'browser-host-session:session-1',
    'browser-host-session:session-1/live-surface',
    'browser-host-session:session-1/computer-use-adapter',
    'runtime-truth:computer-use-adapter/browser-host-session/session-1',
    'runtime-truth:native-surface-health',
  ]);

  assert.deepEqual(registry.getReady(BROWSER_HOST_COMPUTER_USE_PROVIDER_ID), ready);
});

test('BrowserHost adapter probe is blocked unless BrowserHostSession and native surface are runtime ready', () => {
  const registry = createDefaultComputerUseAdapterRegistry();

  for (const input of [
    {
      label: 'missing session',
      probe: { browserHostSession: undefined, nativeBridgeReady: true, nativeSurfaceReady: true },
      reason: /BrowserHostSession/i,
    },
    {
      label: 'loading session',
      probe: { browserHostSession: readyBrowserHostSession({ status: 'loading' }), nativeBridgeReady: true, nativeSurfaceReady: true },
      reason: /session.*ready/i,
    },
    {
      label: 'host stream surface',
      probe: { browserHostSession: readyBrowserHostSession({ liveSurfaceTransport: 'host-stream' }), nativeBridgeReady: true, nativeSurfaceReady: true },
      reason: /native surface/i,
    },
    {
      label: 'missing bridge',
      probe: { browserHostSession: readyBrowserHostSession(), nativeBridgeReady: false, nativeSurfaceReady: true },
      reason: /native bridge/i,
    },
    {
      label: 'missing native surface',
      probe: { browserHostSession: readyBrowserHostSession(), nativeBridgeReady: true, nativeSurfaceReady: false },
      reason: /native surface/i,
    },
  ] as const) {
    const result = registry.probe({
      providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
      probeSource: 'runtime-probe',
      evidenceRefs: ['runtime-truth:native-surface-health'],
      ...input.probe,
    });

    assert.equal(result.status, 'blocked', input.label);
    assert.equal(result.ready, false, input.label);
    assert.match(result.blockedReason ?? '', input.reason, input.label);
  }
});

test('manifest-only provider-url-only and unknown providers cannot become ready', () => {
  const registry = createInMemoryComputerUseAdapterRegistry();

  const manifestOnly = registry.register({
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    kind: 'browser-host-session',
    source: 'manifest',
    evidenceRefs: ['adapter-registry:browser-host-session/computer-use'],
  });
  assert.equal(manifestOnly.status, 'blocked');
  assert.match(manifestOnly.blockedReason ?? '', /manifest-only/i);

  const providerUrlOnly = registry.register({
    providerId: 'example.provider-url-only',
    kind: 'browser-host-session',
    source: 'provider-url',
    providerUrl: 'http://127.0.0.1:4123/provider',
  });
  assert.equal(providerUrlOnly.status, 'blocked');
  assert.match(providerUrlOnly.blockedReason ?? '', /provider-url-only/i);
  assert.doesNotMatch(JSON.stringify(providerUrlOnly), /127\.0\.0\.1|http:\/\//i);

  const unknown = registry.probe({
    providerId: 'example.unknown',
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    browserHostSession: readyBrowserHostSession(),
  });
  assert.equal(unknown.status, 'blocked');
  assert.match(unknown.blockedReason ?? '', /unknown provider/i);
});

test('non-browser Computer Use adapters are runtime-probe-only and readiness refs are runtime-owned', () => {
  const registry = createInMemoryComputerUseAdapterRegistry({ now: () => new Date('2026-06-06T02:00:00.000Z') });

  const registered = registry.register({
    providerId: 'sciforge.window-action',
    kind: 'window-action-session',
    source: 'runtime',
    evidenceRefs: ['window-action-session:session-1/adapter-registration'],
  });
  assert.equal(registered.status, 'blocked');
  assert.match(registered.blockedReason ?? '', /runtime probe/i);

  const withoutRuntimeProbe = registry.probe({
    providerId: 'sciforge.window-action',
    probeSource: 'manifest',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    evidenceRefs: [
      'window-action-session:session-1',
      'runtime-truth:computer-use-adapter/window-action-session/session-1',
    ],
  });
  assert.equal(withoutRuntimeProbe.status, 'blocked');
  assert.match(withoutRuntimeProbe.blockedReason ?? '', /runtime probe/i);

  const ready = registry.probe({
    providerId: 'sciforge.window-action',
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    evidenceRefs: [
      'window-action-session:session-1',
      'computer-use:native-host/sessions/session-1/session.json',
      'runtime-truth:computer-use-adapter/window-action-session/session-1',
    ],
  });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.ready, true);
  assert.equal(ready.kind, 'window-action-session');
  assert.deepEqual(ready.refs, [
    'adapter-registry:sciforge.window-action',
    'window-action-session:session-1',
    'computer-use:native-host/sessions/session-1/session.json',
    'runtime-truth:computer-use-adapter/window-action-session/session-1',
  ]);
  assert.match(ready.summary ?? '', /runtime probe/i);
  assert.doesNotMatch(JSON.stringify(ready), /action executed|executed action|execution result/i);
});

test('non-browser adapter readiness blocks unsafe refs and manifest or provider-url masquerading', () => {
  const registry = createInMemoryComputerUseAdapterRegistry();

  registry.register({
    providerId: 'sciforge.native-host-window-action',
    kind: 'native-host-window-action',
    source: 'runtime',
  });

  const unsafe = registry.probe({
    providerId: 'sciforge.native-host-window-action',
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    evidenceRefs: [
      'runtime-truth:computer-use-adapter/native-host-window-action/session-1',
      'gui.present:native-host-window-action',
      'ui:adapter-ready',
      'fixture:ready',
      'replay:ready',
      'https://example.test/provider-ready.json',
      'data:image/png;base64,ZmFrZQ==',
      'computer-use:native-host/secret-token',
    ],
  });
  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.ready, false);
  assert.match(unsafe.blockedReason ?? '', /unsafe evidence/i);
  assert.deepEqual(unsafe.refs, ['adapter-registry:sciforge.native-host-window-action']);
  assert.doesNotMatch(JSON.stringify(unsafe), /gui\.present|ui:|fixture:|replay:|example\.test|base64|secret-token/i);

  registry.register({
    providerId: 'sciforge.manifest-window-action',
    kind: 'window-action-session',
    source: 'manifest',
    evidenceRefs: ['window-action-session:manifest-registration'],
  });
  const manifestMasquerade = registry.probe({
    providerId: 'sciforge.manifest-window-action',
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    evidenceRefs: ['runtime-truth:computer-use-adapter/window-action-session/manifest'],
  });
  assert.equal(manifestMasquerade.status, 'blocked');
  assert.match(manifestMasquerade.blockedReason ?? '', /manifest-only/i);

  registry.register({
    providerId: 'sciforge.provider-url-window-action',
    kind: 'native-host-window-action',
    source: 'provider-url',
    providerUrl: 'http://127.0.0.1:4123/provider',
  });
  const providerUrlMasquerade = registry.probe({
    providerId: 'sciforge.provider-url-window-action',
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    evidenceRefs: ['runtime-truth:computer-use-adapter/native-host-window-action/provider-url'],
  });
  assert.equal(providerUrlMasquerade.status, 'blocked');
  assert.match(providerUrlMasquerade.blockedReason ?? '', /provider-url-only/i);
  assert.doesNotMatch(JSON.stringify(providerUrlMasquerade), /127\.0\.0\.1|http:\/\//i);
});

test('registry rejects unsafe evidence refs and keeps returned refs bounded to runtime-owned values', () => {
  const registry = createDefaultComputerUseAdapterRegistry();

  const unsafe = registry.probe({
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    browserHostSession: readyBrowserHostSession(),
    evidenceRefs: [
      'runtime-truth:native-surface-health',
      'gui.present:fake',
      'ui:button-ready',
      'fixture:adapter-ready',
      'replay:old-run',
      'https://example.test/raw.png',
      'data:image/png;base64,ZmFrZQ==',
      'computer-use:adapter/secret-token',
    ],
  });

  assert.equal(unsafe.status, 'blocked');
  assert.match(unsafe.blockedReason ?? '', /unsafe evidence/i);
  assert.ok(unsafe.refs.length <= 16);
  assert.deepEqual(unsafe.refs, ['adapter-registry:browser-host-session/computer-use']);
  assert.doesNotMatch(JSON.stringify(unsafe), /gui\.present|ui:|fixture:|replay:|example\.test|base64|secret-token/i);

  const manyRefs = registry.probe({
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    probeSource: 'runtime-probe',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
    browserHostSession: readyBrowserHostSession(),
    evidenceRefs: Array.from({ length: 40 }, (_, index) => `runtime-truth:computer-use-adapter/ref-${index}`),
  });

  assert.equal(manyRefs.status, 'ready');
  assert.equal(manyRefs.ready, true);
  assert.ok(manyRefs.refs.length <= 16);
  for (const ref of manyRefs.refs) {
    assert.match(ref, /^(adapter-registry:|browser-host-session:|runtime-truth:)/);
  }
});

test('materializeBrowserHostAdapter returns resolver-compatible ready or blocked records', () => {
  const registry = createDefaultComputerUseAdapterRegistry();
  const agentHostInput = {
    schemaVersion: 'sciforge.agent-host.input.v1',
    intentText: 'click search',
    authorizationProfileId: 'high',
    refs: ['browser-host-session:session-1'],
    target: {},
    observation: {},
    runtimeHealth: {},
  };
  const ready = registry.materializeBrowserHostAdapter({
    agentHostInput,
    browserHostSession: readyBrowserHostSession(),
    sessionId: 'session-1',
    sessionRef: 'browser-host-session:session-1',
    commandText: 'click search',
    commandId: 'command-1',
    attemptId: 'attempt-1',
    riskCategory: 'low',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
  });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.ready, true);
  assert.equal(ready.providerId, BROWSER_HOST_COMPUTER_USE_PROVIDER_ID);
  assert.match(ready.summary ?? '', /BrowserHostSession/i);

  const blocked = registry.materializeBrowserHostAdapter({
    agentHostInput,
    browserHostSession: readyBrowserHostSession({ liveSurfaceRef: 'ui:fake-live-surface' }),
    sessionId: 'session-1',
    sessionRef: 'browser-host-session:session-1',
    commandText: 'click search',
    commandId: 'command-1',
    attemptId: 'attempt-1',
    riskCategory: 'low',
    nativeBridgeReady: true,
    nativeSurfaceReady: true,
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.ready, false);
  assert.match(blocked.summary ?? '', /blocked/i);
});

function readyBrowserHostSession(overrides: Partial<BrowserHostSessionState> = {}): BrowserHostSessionState {
  return {
    schemaVersion: 'sciforge.browser-host-session.state.v1',
    id: 'session-1',
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    workspacePath: '/workspace',
    requestedUrl: 'about:blank',
    url: 'about:blank',
    title: 'Ready page',
    startedAt: '2026-06-06T00:59:00.000Z',
    updatedAt: '2026-06-06T01:00:00.000Z',
    viewport: { width: 1280, height: 720 },
    canGoBack: false,
    canGoForward: false,
    liveSurfaceRef: 'browser-host-session:session-1/live-surface',
    liveSurfaceTransport: 'native-embedded',
    nativeAdapterUrl: 'http://127.0.0.1:4123',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    diagnostics: [],
    ...overrides,
  };
}
