import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createDefaultCodexAgentHostBrowserActTimeStores,
  createDefaultCodexAgentHostRuntimeTruthResolver,
} from './agent-host-runtime-truth-resolver.js';
import type { BrowserHostSessionManager } from '../browser-host-session.js';
import { createActorCursor, createWindowActionSession } from '../window-action-session.js';
import type { WindowActionSessionStore } from '../window-action-session-store.js';
import {
  recordVirtualAppScreenNativeHostSession,
  resetVirtualAppScreenNativeHostSessionStoreForTests,
  type VirtualAppScreenNativeHostSessionRecord,
} from '../computer-use/virtual-app-screen-native-host-session-store.js';
import {
  recordVirtualAppScreenProviderSession,
  resetVirtualAppScreenProviderSessionStoreForTests,
} from '../computer-use/virtual-app-screen-provider-session-store.js';
import {
  resolveCodexAgentHostRuntimeTruth,
  type NormalizedCodexAgentHostInput,
} from './agent-host-turn-loop.js';
import type {
  NativeHostFrame,
  NativeHostLiveSurface,
  NativeHostReadinessRecord,
  NativeHostSession,
  NativeVirtualAppScreenHost,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

test('default Agent Host runtime truth resolver blocks UI-only readiness hints', async () => {
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({ env: {} });
  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      readiness: {
        browserHostSession: 'ready',
        nativeBridge: 'ready',
        nativeSurface: 'ready',
        windowActionSession: 'ready',
        computerUseAdapter: 'ready',
      },
      target: {
        bound: true,
        summary: 'UI projected target',
        refs: ['browser-host-session:ui-only'],
      },
      observation: {
        fresh: true,
        refs: ['browser-host-session:ui-only/frame.png'],
      },
      permissions: {
        refs: ['permission:ui-only'],
        stopCancelPath: true,
      },
    }),
    commandText: 'Click the current button.',
    workspacePath: '/tmp/workspace',
  });

  assert.equal(truth?.readiness?.browserHostSession, 'ready');
  assert.equal(truth?.readiness?.nativeBridge, 'blocked');
  assert.equal(truth?.readiness?.nativeSurface, 'blocked');
  assert.equal(truth?.readiness?.windowActionSession, 'blocked');
  assert.equal(truth?.readiness?.computerUseAdapter, 'blocked');
  assert.equal(truth?.target?.bound, false);
  assert.equal(truth?.observation?.fresh, false);
  assert.deepEqual(truth?.permissions?.refs, []);
  assert.equal(truth?.permissions?.stopCancelPath, false);
});

test('Agent Host runtime truth sanitizer rejects unsafe structured adapter strings and refs', async () => {
  const truth = await resolveCodexAgentHostRuntimeTruth({
    input: normalizedAgentHostInput({ refs: ['browser-host-session:structured-sanitizer'] }),
    commandText: 'Click the visible button.',
    workspacePath: '/tmp/workspace',
    runtimeTruthResolver: async () => ({
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      adapter: {
        providerId: 'https://provider.example/raw?token=secret-token',
        refs: [
          'adapter-registry:structured-sanitizer',
          'ui:projected-adapter',
          'data:image/png;base64,AAAA',
        ],
        capabilityRefs: [
          'runtime-truth:computer-use-capability/structured-sanitizer',
          'fixture:capability',
        ],
        inputIsolation: {
          mode: 'raw payload bearer token',
          refsOnly: true,
          sharedSystemInput: false,
          requiresFocusLease: false,
          refs: [
            'lease:structured-sanitizer/input',
            'https://provider.example/frame',
            'bearer:projected-token',
          ],
        },
      },
      refs: [
        'runtime-truth:structured-sanitizer',
        'ui:projected-truth',
        'Authorization: Bearer secret-token',
      ],
    }),
  });

  assert.equal(truth?.adapter?.providerId, undefined);
  assert.equal(truth?.adapter?.inputIsolation?.mode, undefined);
  assert.deepEqual(truth?.adapter?.refs, ['adapter-registry:structured-sanitizer']);
  assert.deepEqual(truth?.adapter?.capabilityRefs, ['runtime-truth:computer-use-capability/structured-sanitizer']);
  assert.deepEqual(truth?.adapter?.inputIsolation?.refs, ['lease:structured-sanitizer/input']);
  assert.deepEqual(truth?.refs, ['runtime-truth:structured-sanitizer']);
  assert.doesNotMatch(JSON.stringify(truth), /gui(?:\.|:)|ui:|fixture:|replay:|https?:\/\/|data:image|base64|raw\b|payload\b|secret|token|bearer/i);
});

test('default Agent Host runtime truth resolver verifies BrowserHostSession refs from runtime state', async () => {
  const nativeAdapterServer = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      status: 'ready',
      ready: true,
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
      passClaim: true,
    }));
  });
  nativeAdapterServer.listen(0, '127.0.0.1');
  await once(nativeAdapterServer, 'listening');
  const address = nativeAdapterServer.address();
  assert.ok(address && typeof address === 'object');
  const manager = {
    async sessionState(_workspacePath: string, sessionId: string) {
      assert.equal(sessionId, 'verified');
      return {
        id: 'verified',
        owner: 'host',
        providerId: 'sciforge.browser-host-session',
        status: 'ready',
        title: 'Verified browser page',
        liveSurfaceRef: 'browser-host-session:verified/live-surface',
        liveSurfaceTransport: 'native-embedded',
        singleInteractiveTruth: true,
        secondTruthSource: false,
        frameRef: 'browser-host-session:verified/frame.png',
        screenshotRef: 'browser-host-session:verified/screenshot.png',
        updatedAt: new Date().toISOString(),
      };
    },
  } as unknown as BrowserHostSessionManager;
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: `http://127.0.0.1:${(address as AddressInfo).port}` },
    browserHostSessionManager: manager,
  });
  try {
    const truth = await resolver({
      input: {},
      agentHostInput: normalizedAgentHostInput({
        refs: ['browser-host-session:verified'],
        target: {
          refs: ['browser-host-session:verified'],
        },
      }),
      commandText: 'Scroll the current browser page.',
      workspacePath: '/tmp/workspace',
    });

    assert.equal(truth?.readiness?.browserHostSession, 'ready');
    assert.equal(truth?.readiness?.nativeBridge, 'ready');
    assert.equal(truth?.readiness?.nativeSurface, 'ready');
    assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
    assert.equal(truth?.readiness?.windowActionSession, 'ready');
    assert.equal(truth?.target?.bound, true);
    assert.match(truth?.target?.summary ?? '', /Verified browser page/);
    assert.deepEqual(truth?.target?.refs, ['browser-host-session:verified', 'window-action-session:browser-host-session/verified']);
    assert.equal(truth?.observation?.fresh, true);
    assert.deepEqual(truth?.observation?.refs, [
      'browser-host-session:verified/frame.png',
      'browser-host-session:verified/screenshot.png',
    ]);
    assert.ok(truth?.permissions?.refs?.some((ref) => ref.startsWith('permission:turn/codex-command-agent-host/')));
    assert.equal(truth?.permissions?.stopCancelPath, true);
  } finally {
    await new Promise<void>((resolve) => nativeAdapterServer.close(() => resolve()));
  }
});

test('default Agent Host runtime truth resolver materializes BrowserHostSession Act-time truth from runtime owners', async () => {
  const nativeAdapterServer = createReadyNativeAdapterServer();
  nativeAdapterServer.listen(0, '127.0.0.1');
  await once(nativeAdapterServer, 'listening');
  const address = nativeAdapterServer.address();
  assert.ok(address && typeof address === 'object');
  const manager = browserHostSessionManager({
    id: 'verified',
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    title: 'Verified browser page',
    liveSurfaceRef: 'browser-host-session:verified/live-surface',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    frameRef: 'browser-host-session:verified/frame.png',
    screenshotRef: 'browser-host-session:verified/screenshot.png',
    updatedAt: new Date().toISOString(),
  });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: `http://127.0.0.1:${(address as AddressInfo).port}` },
    browserHostSessionManager: manager,
  });
  try {
    const truth = await resolver({
      input: {},
      agentHostInput: normalizedAgentHostInput({
        refs: ['browser-host-session:verified'],
        target: {
          refs: ['browser-host-session:verified'],
        },
      }),
      commandText: 'Scroll the current browser page.',
      workspacePath: '/tmp/workspace',
      commandId: 'codex-command-default-act-time',
      attemptId: 'codex-command-default-act-time-attempt-1',
    });

    assert.equal(truth?.readiness?.windowActionSession, 'ready');
    assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
    assert.equal(truth?.target?.bound, true);
    assert.ok(truth?.target?.refs?.includes('window-action-session:browser-host-session/verified'));
    assert.ok(truth?.refs?.includes('adapter-registry:browser-host-session/computer-use'));
    assert.ok(truth?.permissions?.refs?.some((ref) => ref.startsWith('permission:turn/codex-command-default-act-time/')));
    assert.equal(truth?.permissions?.stopCancelPath, true);
    assert.deepEqual(truth?.sessions?.sessionReadyRefs, [
      'browser-host-session:verified',
      'window-action-session:browser-host-session/verified',
    ]);
    assert.deepEqual(truth?.sessions?.targetRefs, [
      'browser-host-session:verified',
      'window-action-session:browser-host-session/verified',
    ]);
    assert.deepEqual(truth?.sessions?.observationRefs, [
      'browser-host-session:verified/frame.png',
      'browser-host-session:verified/screenshot.png',
    ]);
    assert.deepEqual(truth?.sessions?.inputLeaseRefs, ['lease:browser-host-session/verified/agent-host']);
    assert.equal(truth?.adapter?.providerId, 'sciforge.browser-host-session.computer-use-adapter');
    assert.ok(truth?.adapter?.refs?.includes('adapter-registry:browser-host-session/computer-use'));
    assert.ok(truth?.adapter?.capabilityRefs?.includes('runtime-truth:computer-use-capability/browser-host-session/verified'));
    assert.deepEqual(truth?.adapter?.inputIsolation, {
      mode: 'browser-host-native-surface',
      refsOnly: true,
      sharedSystemInput: false,
      requiresFocusLease: false,
      singleInteractiveTruth: true,
      secondTruthSource: false,
      refs: ['browser-host-session:verified/live-surface'],
    });
    assert.ok(truth?.permissions?.permissionRefs?.some((ref) => ref.startsWith('permission:turn/codex-command-default-act-time/')));
    assert.deepEqual(truth?.permissions?.appAllowlistRefs, ['runtime-truth:app-allowlist/browser-host-session/verified']);
    assert.deepEqual(truth?.permissions?.windowAllowlistRefs, ['runtime-truth:window-allowlist/browser-host-session/verified']);
    assert.deepEqual(truth?.permissions?.riskPreviewRefs, ['action-ledger:browser-host-session/verified/risk/ordinary-navigation']);
    assert.deepEqual(truth?.controlPath?.cancelRefs, ['cancel:runtime-codex/codex-command-default-act-time/codex-command-default-act-time-attempt-1']);
    assert.ok(truth?.refs?.includes('stop:browser-host-session/verified/stop'));
    assert.ok(truth?.refs?.includes('stop:browser-host-session/verified/close'));
    assert.ok(truth?.refs?.includes('cancel:runtime-codex/codex-command-default-act-time/codex-command-default-act-time-attempt-1'));
    assert.doesNotMatch(JSON.stringify(truth), /gui\.present|ui:|fixture:|replay:/);
  } finally {
    await new Promise<void>((resolve) => nativeAdapterServer.close(() => resolve()));
  }
});

test('default Agent Host runtime truth resolver accepts BrowserHostSession ids with scoped colon segments', async () => {
  const nativeAdapterServer = createReadyNativeAdapterServer();
  nativeAdapterServer.listen(0, '127.0.0.1');
  await once(nativeAdapterServer, 'listening');
  const address = nativeAdapterServer.address();
  assert.ok(address && typeof address === 'object');
  const sessionId = 'right-pane-base:browser-verified';
  const manager = browserHostSessionManager({
    id: sessionId,
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    title: 'Scoped browser page',
    liveSurfaceRef: `browser-host-session:${sessionId}/live-surface`,
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    frameRef: `browser-host-session:${sessionId}/frame.png`,
    screenshotRef: `browser-host-session:${sessionId}/screenshot.png`,
    updatedAt: new Date().toISOString(),
  });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: `http://127.0.0.1:${(address as AddressInfo).port}` },
    browserHostSessionManager: manager,
  });
  try {
    const truth = await resolver({
      input: {},
      agentHostInput: normalizedAgentHostInput({
        refs: [`browser-host-session:${sessionId}`],
        target: {
          refs: [`browser-host-session:${sessionId}/live-surface`],
        },
      }),
      commandText: 'Submit the registration form in the current browser window.',
      workspacePath: '/tmp/workspace',
      commandId: 'codex-command-scoped-browser',
      attemptId: 'codex-command-scoped-browser-attempt-1',
    });

    assert.equal(truth?.readiness?.browserHostSession, 'ready');
    assert.equal(truth?.readiness?.windowActionSession, 'ready');
    assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
    assert.ok(truth?.target?.refs?.includes(`browser-host-session:${sessionId}`));
    assert.ok(truth?.target?.refs?.includes('window-action-session:browser-host-session/right-pane-base-browser-verified'));
    assert.ok(truth?.refs?.includes(`runtime-truth:browser-host-session:${sessionId}`));
  } finally {
    await new Promise<void>((resolve) => nativeAdapterServer.close(() => resolve()));
  }
});

test('default Agent Host runtime truth resolver composes injected Act-time stores and sanitizes their refs', async () => {
  const nativeAdapterServer = createReadyNativeAdapterServer();
  nativeAdapterServer.listen(0, '127.0.0.1');
  await once(nativeAdapterServer, 'listening');
  const address = nativeAdapterServer.address();
  assert.ok(address && typeof address === 'object');
  const manager = browserHostSessionManager({
    id: 'verified',
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    title: 'Verified browser page',
    liveSurfaceRef: 'browser-host-session:verified/live-surface',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    frameRef: 'browser-host-session:verified/frame.png',
    updatedAt: new Date().toISOString(),
  });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: `http://127.0.0.1:${(address as AddressInfo).port}` },
    browserHostSessionManager: manager,
    actTimeStores: {
      windowActionSessionStore: {
        async materializeForBrowserHostSession() {
          return {
            status: 'ready',
            summary: 'Stored WindowActionSession',
            refs: ['window-action-session:stored-browser-window', 'gui.present:fake-window'],
            targetRefs: ['window-action-session:stored-browser-window'],
          };
        },
      },
      computerUseAdapterRegistry: {
        async materializeBrowserHostAdapter() {
          return {
            status: 'ready',
            providerId: 'sciforge.browser-host-session.computer-use-adapter',
            refs: ['adapter-registry:stored-browser-host', 'ui:adapter-ready'],
          };
        },
      },
      permissionLedger: {
        async materializeTurnPermission() {
          return {
            status: 'ready',
            refs: ['permission:turn/stored-low-risk', 'gui.ask_user:fake-approval'],
          };
        },
      },
      stopCancelTakeoverStore: {
        async materializeForBrowserHostSession() {
          return {
            status: 'ready',
            refs: ['cancel:runtime-turn/stored', 'browser-host-session:verified/stop', 'ui:cancel-ready'],
          };
        },
      },
    },
  });
  try {
    const truth = await resolver({
      input: {},
      agentHostInput: normalizedAgentHostInput({
        refs: ['browser-host-session:verified'],
        target: {
          refs: ['browser-host-session:verified'],
        },
      }),
      commandText: 'Scroll the current browser page.',
      workspacePath: '/tmp/workspace',
      commandId: 'codex-command-store-composed',
      attemptId: 'codex-command-store-composed-attempt-1',
    });

    assert.equal(truth?.readiness?.windowActionSession, 'ready');
    assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
    assert.deepEqual(truth?.permissions?.refs, ['permission:turn/stored-low-risk']);
    assert.equal(truth?.permissions?.stopCancelPath, true);
    assert.ok(truth?.refs?.includes('window-action-session:stored-browser-window'));
    assert.ok(truth?.refs?.includes('adapter-registry:stored-browser-host'));
    assert.ok(truth?.refs?.includes('cancel:runtime-turn/stored'));
    assert.doesNotMatch(JSON.stringify(truth), /gui\.present|gui\.ask_user|ui:/);
  } finally {
    await new Promise<void>((resolve) => nativeAdapterServer.close(() => resolve()));
  }
});

test('default Agent Host runtime truth resolver materializes active WindowActionSession refs from runtime owner store', async () => {
  const now = '2026-06-06T00:00:00.000Z';
  const actTimeStores = createDefaultCodexAgentHostBrowserActTimeStores({
    now: () => new Date(now),
  });
  const permissionLedger = actTimeStores.permissionLedger;
  const stopCancelTakeoverStore = actTimeStores.stopCancelTakeoverStore;
  assert.ok(permissionLedger);
  assert.ok(stopCancelTakeoverStore);
  const windowStore = actTimeStores.windowActionSessionStore as unknown as WindowActionSessionStore;
  const activeSession = createWindowActionSession({
    id: 'desktop-window-main',
    windowRef: 'desktop-native:window/main',
    app: { id: 'com.example.App', name: 'Example App', kind: 'ordinary-app' },
    evidenceRefs: [
      { kind: 'desktop-native', ref: 'desktop-native:window/main' },
      { kind: 'fake-ui', ref: 'ui:window-ready' },
    ],
    timestamp: now,
  });
  activeSession.actorCursor = createActorCursor({
    agentId: 'codex-agent-host',
    cursorId: 'main-cursor',
    color: '#2563eb',
    label: 'Codex',
    status: 'observing',
    evidenceRefs: [
      'window-action-session:desktop-window-main/actor-cursor/main-cursor',
      'ui:projected-cursor',
    ],
  });
  activeSession.scopedInputAdapters = [{
    schemaVersion: 'sciforge.scoped-input-adapter.v1',
    ref: 'window-action-session:desktop-window-main/scoped-input/main',
    agentId: 'codex-agent-host',
    actorCursorRef: 'window-action-session:desktop-window-main/actor-cursor/main-cursor',
    windowActionSessionRef: 'window-action-session:desktop-window-main',
    targetWindowRef: 'desktop-native:window/main',
    adapter: 'accessibility-ui-automation',
    focusMode: 'requires-focus',
    inputQueueRef: 'window-action-session:desktop-window-main/input-queue/main',
    focusLeaseRef: 'lease:window-action-session/desktop-window-main/focus/main',
    evidenceRefs: [
      { kind: 'window-action-session', ref: 'window-action-session:desktop-window-main/scoped-input/main' },
      { kind: 'lease', ref: 'lease:window-action-session/desktop-window-main/focus/main' },
      { kind: 'ui', ref: 'ui:projected-input' },
    ],
    createdAt: now,
    updatedAt: now,
  }];
  windowStore.upsert(activeSession, {
    targetRefs: ['desktop-native:window/main'],
    observationRefs: ['desktop-native:window/main/frame', 'ui:projected-frame'],
    refs: ['action-ledger:desktop-window-main/upsert', 'gui.present:fake-window'],
    timestamp: now,
  });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    actTimeStores,
    now: () => new Date(now),
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      refs: ['desktop-native:window/main', 'gui.present:fake-window'],
      target: {
        refs: ['desktop-native:window/main', 'ui:fake-target'],
      },
      observation: {
        refs: ['desktop-native:window/main/frame', 'replay:fake-frame'],
      },
    }),
    commandText: 'Click the visible export button in the current desktop window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-window-action',
    attemptId: 'codex-command-window-action-attempt-1',
  });

  assert.equal(truth?.readiness?.browserHostSession, 'ready');
  assert.equal(truth?.readiness?.nativeBridge, 'blocked');
  assert.equal(truth?.readiness?.nativeSurface, 'blocked');
  assert.equal(truth?.readiness?.windowActionSession, 'ready');
  assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
  assert.equal(truth?.target?.bound, true);
  assert.deepEqual(truth?.target?.refs, ['desktop-native:window/main', 'window-action-session:desktop-window-main']);
  assert.equal(truth?.observation?.fresh, true);
  assert.deepEqual(truth?.observation?.refs, ['desktop-native:window/main/frame']);
  assert.deepEqual(truth?.sessions?.sessionReadyRefs, [
    'window-action-session:desktop-window-main',
    'action-ledger:window-action-session/desktop-window-main/upsert',
    'lease:window-action-session/desktop-window-main/agent-host',
    'desktop-native:window/main',
    'action-ledger:desktop-window-main/upsert',
    'window-action-session:desktop-window-main/actor-cursor/main-cursor',
    'window-action-session:desktop-window-main/scoped-input/main',
    'lease:window-action-session/desktop-window-main/focus/main',
  ]);
  assert.deepEqual(truth?.sessions?.targetRefs, ['desktop-native:window/main', 'window-action-session:desktop-window-main']);
  assert.deepEqual(truth?.sessions?.actorCursorRefs, ['window-action-session:desktop-window-main/actor-cursor/main-cursor']);
  assert.deepEqual(truth?.sessions?.inputLeaseRefs, ['lease:window-action-session/desktop-window-main/agent-host']);
  assert.deepEqual(truth?.sessions?.focusLeaseRefs, ['lease:window-action-session/desktop-window-main/focus/main']);
  assert.deepEqual(truth?.sessions?.observationRefs, ['desktop-native:window/main/frame']);
  assert.ok(truth?.refs?.includes('adapter-registry:sciforge.window-action-session.computer-use-adapter'));
  assert.ok(truth?.refs?.includes('runtime-truth:computer-use-adapter/window-action-session/desktop-window-main'));
  assert.deepEqual(truth?.adapter?.inputIsolation, {
    mode: 'requires-focus',
    refsOnly: true,
    sharedSystemInput: false,
    requiresFocusLease: true,
    refs: [
      'window-action-session:desktop-window-main/scoped-input/main',
      'lease:window-action-session/desktop-window-main/focus/main',
    ],
  });
  assert.ok(truth?.permissions?.refs?.some((ref) => ref.startsWith('permission:turn/codex-command-window-action/')));
  assert.equal(truth?.permissions?.stopCancelPath, true);
  assert.ok(truth?.refs?.includes('stop:window-action-session/desktop-window-main/stop'));
  assert.ok(truth?.refs?.includes('stop:window-action-session/desktop-window-main/pause'));
  assert.ok(truth?.refs?.includes('stop:window-action-session/desktop-window-main/remove'));
  assert.doesNotMatch(JSON.stringify(truth), /gui\.present|ui:|fixture:|replay:/);
});

test('default Agent Host runtime truth resolver keeps WindowActionSession evidence bounded when unsafe refs are mixed in', async () => {
  const now = '2026-06-06T00:04:00.000Z';
  const actTimeStores = createDefaultCodexAgentHostBrowserActTimeStores({
    now: () => new Date(now),
  });
  const permissionLedger = actTimeStores.permissionLedger;
  const stopCancelTakeoverStore = actTimeStores.stopCancelTakeoverStore;
  assert.ok(permissionLedger);
  assert.ok(stopCancelTakeoverStore);
  const windowStore = actTimeStores.windowActionSessionStore as unknown as WindowActionSessionStore;
  windowStore.upsert(createWindowActionSession({
    id: 'desktop-window-unsafe-mix',
    windowRef: 'desktop-native:window/unsafe-mix',
    app: { id: 'com.example.App', name: 'Example App', kind: 'ordinary-app' },
    evidenceRefs: [
      { kind: 'desktop-native', ref: 'desktop-native:window/unsafe-mix' },
      { kind: 'fixture', ref: 'fixture:window-ready' },
    ],
    timestamp: now,
  }), {
    targetRefs: [
      'desktop-native:window/unsafe-mix',
      'https://example.invalid/projected-target',
      'ui:projected-target',
    ],
    observationRefs: [
      'desktop-native:window/unsafe-mix/frame',
      'data:image/png;base64,AAAA',
      'replay:projected-frame',
    ],
    refs: [
      'action-ledger:desktop-window-unsafe-mix/upsert',
      'gui.present:fake-window',
      'native-host:token/should-not-leak',
    ],
    timestamp: now,
  });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    actTimeStores: {
      ...actTimeStores,
      permissionLedger: {
        ...permissionLedger,
        materializeTurnPermission: permissionLedger.materializeTurnPermission,
        async materializeWindowActionTurnPermission() {
          return {
            status: 'ready',
            refs: [
              'permission:turn/window-action-bounded-evidence',
              'http://example.invalid/approval',
              'approval:token/should-not-leak',
              'gui.ask_user:fake-approval',
            ],
            permissionRefs: [
              'permission:turn/window-action-bounded-evidence-extra',
              'ui:permission-ready',
            ],
          };
        },
      },
      stopCancelTakeoverStore: {
        ...stopCancelTakeoverStore,
        materializeForBrowserHostSession: stopCancelTakeoverStore.materializeForBrowserHostSession,
        async materializeForWindowActionSession() {
          return {
            status: 'ready',
            refs: [
              'stop:window-action-session/desktop-window-unsafe-mix/stop',
              'cancel:runtime-turn/window-action-bounded-evidence',
              'fixture:cancel-ready',
              'native-host:cancel/token-should-not-leak',
            ],
          };
        },
      },
    },
    now: () => new Date(now),
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      refs: [
        'desktop-native:window/unsafe-mix',
        'https://example.invalid/input-ref',
        'fixture:input-ref',
      ],
      target: {
        refs: [
          'desktop-native:window/unsafe-mix',
          'ui:fake-target',
        ],
      },
      observation: {
        refs: [
          'desktop-native:window/unsafe-mix/frame',
          'data:image/png;base64,BBBB',
        ],
      },
      permissions: {
        refs: ['permission:ui-only', 'bearer:projected-token'],
        stopCancelPath: true,
      },
    }),
    commandText: 'Click the visible export button in the current desktop window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-window-action-bounded-evidence',
    attemptId: 'codex-command-window-action-bounded-evidence-attempt-1',
  });

  assert.equal(truth?.readiness?.windowActionSession, 'ready');
  assert.deepEqual(truth?.target?.refs, ['desktop-native:window/unsafe-mix', 'window-action-session:desktop-window-unsafe-mix']);
  assert.deepEqual(truth?.observation?.refs, ['desktop-native:window/unsafe-mix/frame']);
  assert.deepEqual(truth?.permissions?.refs, [
    'permission:turn/window-action-bounded-evidence',
    'permission:turn/window-action-bounded-evidence-extra',
  ]);
  assert.equal(truth?.permissions?.stopCancelPath, true);
  assert.doesNotMatch(JSON.stringify(truth), /gui(?:\.|:)|ui:|fixture:|replay:|https?:\/\/|data:image|base64|token|bearer/i);
});

test('default Agent Host runtime truth resolver fail-closes WindowActionSession adapter readiness without a registry handler', async () => {
  const now = '2026-06-06T00:04:30.000Z';
  const actTimeStores = createDefaultCodexAgentHostBrowserActTimeStores({
    now: () => new Date(now),
  });
  const windowStore = actTimeStores.windowActionSessionStore as unknown as WindowActionSessionStore;
  windowStore.upsert(createWindowActionSession({
    id: 'desktop-window-no-handler',
    windowRef: 'desktop-native:window/no-handler',
    app: { id: 'com.example.App', name: 'Example App', kind: 'ordinary-app' },
    evidenceRefs: [{ kind: 'desktop-native', ref: 'desktop-native:window/no-handler' }],
    timestamp: now,
  }), {
    targetRefs: ['desktop-native:window/no-handler'],
    observationRefs: ['desktop-native:window/no-handler/frame'],
    timestamp: now,
  });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    actTimeStores: {
      ...actTimeStores,
      computerUseAdapterRegistry: {
        async materializeBrowserHostAdapter() {
          return undefined;
        },
      },
    },
    now: () => new Date(now),
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      refs: ['desktop-native:window/no-handler'],
      target: { refs: ['desktop-native:window/no-handler'] },
      observation: { refs: ['desktop-native:window/no-handler/frame'] },
    }),
    commandText: 'Click the visible export button in the current desktop window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-window-action-no-handler',
    attemptId: 'codex-command-window-action-no-handler-attempt-1',
  });

  assert.equal(truth?.readiness?.windowActionSession, 'ready');
  assert.equal(truth?.readiness?.computerUseAdapter, 'blocked');
  assert.equal(truth?.target?.bound, true);
  assert.equal(truth?.permissions?.stopCancelPath, true);
  assert.ok(truth?.refs?.includes('window-action-session:desktop-window-no-handler'));
  assert.ok(!truth?.refs?.some((ref) => ref.includes('computer-use-adapter/window-action-session/desktop-window-no-handler')));
});

test('default Agent Host runtime truth resolver materializes VirtualAppScreen Native Host refs from runtime owner stores', async () => {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  resetVirtualAppScreenProviderSessionStoreForTests();
  const now = '2026-06-06T00:05:00.000Z';
  const record = recordProductVirtualAppScreenSession({ now, diagnosticOnly: false });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    now: () => new Date(now),
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      refs: [
        record.sessionRef,
        record.screenRef!,
        'gui.present:fake-virtual-screen',
      ],
      target: {
        refs: [
          record.targetWindowRef!,
          record.liveSurfaceRef!,
          'ui:fake-target',
        ],
      },
      observation: {
        refs: [
          record.currentFrameRef!,
          'data:image/png;base64,AAAA',
        ],
      },
    }),
    commandText: 'Click the visible Problems tab in the VirtualAppScreen VS Code window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-virtual-app-screen',
    attemptId: 'codex-command-virtual-app-screen-attempt-1',
  });

  assert.equal(truth?.readiness?.windowActionSession, 'ready');
  assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
  assert.equal(truth?.target?.bound, true);
  assert.ok(truth?.target?.refs?.includes(record.sessionRef));
  assert.ok(truth?.target?.refs?.includes(record.screenRef!));
  assert.ok(truth?.target?.refs?.includes(record.liveSurfaceRef!));
  assert.ok(truth?.target?.refs?.includes(record.targetWindowRef!));
  assert.equal(truth?.observation?.fresh, true);
  assert.ok(truth?.observation?.refs?.includes(record.currentFrameRef!));
  assert.ok(truth?.refs?.includes(record.currentRunPointerRef));
  assert.ok(truth?.refs?.includes(record.adapterReadinessRef));
  assert.ok(truth?.refs?.includes(record.actionAdapterRef!));
  assert.ok(truth?.refs?.includes(record.inputLeaseRef!));
  assert.ok(truth?.refs?.includes('permission:macos/screen-recording'));
  assert.ok(truth?.refs?.some((ref) => /^computer-use:provider-session\/.+\/owner\.json$/u.test(ref)));
  assert.equal(truth?.permissions?.stopCancelPath, true);
  assert.ok(truth?.refs?.includes('stop:computer-use/native-host/vas-product-session/stop'));
  assert.ok(truth?.refs?.includes('lease:computer-use/native-host/vas-product-session/pause'));
  assert.doesNotMatch(JSON.stringify(truth), /gui\.present|ui:|fixture:|replay:|data:image|base64/);

  resetVirtualAppScreenNativeHostSessionStoreForTests();
  resetVirtualAppScreenProviderSessionStoreForTests();
});

test('default Agent Host runtime truth resolver keeps VirtualAppScreen NativeHost evidence bounded when unsafe refs are mixed in', async () => {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  resetVirtualAppScreenProviderSessionStoreForTests();
  const now = '2026-06-06T00:05:30.000Z';
  const record = recordProductVirtualAppScreenSession({ now, diagnosticOnly: false });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    now: () => new Date(now),
    actTimeStores: {
      computerUseAdapterRegistry: {
        async materializeBrowserHostAdapter() {
          return undefined;
        },
        async materializeVirtualAppScreenNativeHostAdapter() {
          return {
            status: 'ready',
            providerId: 'sciforge.virtual-app-screen.native-host-window-action',
            refs: [
              record.actionAdapterRef!,
              record.adapterReadinessRef,
              'ui:adapter-ready',
              'http://example.invalid/adapter',
            ],
          };
        },
      },
      permissionLedger: {
        async materializeTurnPermission() {
          return undefined;
        },
        async materializeVirtualAppScreenNativeHostTurnPermission() {
          return {
            status: 'ready',
            refs: [
              'permission:macos/screen-recording',
              'approval:virtual-app-screen/granted',
              'approval:token/should-not-leak',
              'gui.ask_user:fake-approval',
            ],
            permissionRefs: [
              'permission:turn/virtual-app-screen-bounded-evidence',
              'ui:permission-ready',
            ],
          };
        },
      },
      stopCancelTakeoverStore: {
        async materializeForBrowserHostSession() {
          return undefined;
        },
        async materializeForVirtualAppScreenNativeHostSession() {
          return {
            status: 'ready',
            refs: [
              'stop:computer-use/native-host/vas-product-session/stop',
              'lease:computer-use/native-host/vas-product-session/pause',
              'fixture:cancel-ready',
              'native-host:cancel/token-should-not-leak',
            ],
          };
        },
      },
    },
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      refs: [
        record.sessionRef,
        record.screenRef!,
        'gui.present:fake-virtual-screen',
        'https://example.invalid/input-ref',
      ],
      target: {
        refs: [
          record.targetWindowRef!,
          record.liveSurfaceRef!,
          'ui:fake-target',
          'native-host:target/token-should-not-leak',
        ],
      },
      observation: {
        refs: [
          record.currentFrameRef!,
          'data:image/png;base64,CCCC',
          'replay:fake-frame',
        ],
      },
      permissions: {
        refs: ['permission:ui-only', 'bearer:projected-token'],
        stopCancelPath: true,
      },
    }),
    commandText: 'Click the visible Problems tab in the VirtualAppScreen VS Code window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-virtual-app-screen-bounded-evidence',
    attemptId: 'codex-command-virtual-app-screen-bounded-evidence-attempt-1',
  });

  assert.equal(truth?.readiness?.windowActionSession, 'ready');
  assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
  assert.ok(truth?.target?.refs?.includes(record.sessionRef));
  assert.ok(truth?.target?.refs?.includes(record.screenRef!));
  assert.ok(truth?.target?.refs?.includes(record.liveSurfaceRef!));
  assert.ok(truth?.target?.refs?.includes(record.targetWindowRef!));
  assert.ok(truth?.observation?.refs?.includes(record.currentFrameRef!));
  assert.deepEqual(truth?.permissions?.refs, [
    'permission:macos/screen-recording',
    'approval:virtual-app-screen/granted',
    'permission:turn/virtual-app-screen-bounded-evidence',
  ]);
  assert.equal(truth?.permissions?.stopCancelPath, true);
  assert.doesNotMatch(JSON.stringify(truth), /gui(?:\.|:)|ui:|fixture:|replay:|https?:\/\/|data:image|base64|token|bearer/i);

  resetVirtualAppScreenNativeHostSessionStoreForTests();
  resetVirtualAppScreenProviderSessionStoreForTests();
});

test('default Agent Host runtime truth resolver blocks diagnostic-only VirtualAppScreen Native Host records', async () => {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  resetVirtualAppScreenProviderSessionStoreForTests();
  const now = '2026-06-06T00:06:00.000Z';
  const record = recordProductVirtualAppScreenSession({ now, diagnosticOnly: true });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    now: () => new Date(now),
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      refs: [record.sessionRef, record.screenRef!],
      target: { refs: [record.liveSurfaceRef!] },
      observation: { refs: [record.currentFrameRef!] },
    }),
    commandText: 'Click the visible Problems tab in the VirtualAppScreen VS Code window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-virtual-app-screen-diagnostic',
    attemptId: 'codex-command-virtual-app-screen-diagnostic-attempt-1',
  });

  assert.equal(truth?.readiness?.windowActionSession, 'blocked');
  assert.equal(truth?.readiness?.computerUseAdapter, 'blocked');
  assert.equal(truth?.target?.bound, false);
  assert.equal(truth?.observation?.fresh, false);

  resetVirtualAppScreenNativeHostSessionStoreForTests();
  resetVirtualAppScreenProviderSessionStoreForTests();
});

test('default Agent Host runtime truth resolver merges injected runtime-owner Act-time truth', async () => {
  const nativeAdapterServer = createReadyNativeAdapterServer();
  nativeAdapterServer.listen(0, '127.0.0.1');
  await once(nativeAdapterServer, 'listening');
  const address = nativeAdapterServer.address();
  assert.ok(address && typeof address === 'object');
  const manager = browserHostSessionManager({
    id: 'verified',
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    title: 'Verified browser page',
    liveSurfaceRef: 'browser-host-session:verified/live-surface',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    frameRef: 'browser-host-session:verified/frame.png',
    screenshotRef: 'browser-host-session:verified/screenshot.png',
    updatedAt: new Date().toISOString(),
  });
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: `http://127.0.0.1:${(address as AddressInfo).port}` },
    browserHostSessionManager: manager,
    actTimeTruthSource: async ({ browserHostSession }) => {
      assert.equal(browserHostSession?.id, 'verified');
      return {
        schemaVersion: 'sciforge.agent-host.act-time-truth.v1',
        source: 'test-runtime-act-source',
        windowActionSession: {
          status: 'ready',
          summary: 'WindowActionSession for verified browser page',
          refs: ['window-action-session:verified-browser-window'],
        },
        computerUseAdapter: {
          status: 'ready',
          providerId: 'sciforge.browser-host-session.computer-use-adapter',
          refs: ['adapter-registry:browser-host-session/computer-use'],
        },
        permissions: {
          refs: ['permission:turn/low-risk-navigation'],
          stopCancelPath: true,
          stopCancelRefs: ['browser-host-session:verified/stop', 'cancel:runtime-turn/verified'],
        },
        refs: ['runtime-truth:act-source/verified'],
      };
    },
  });
  try {
    const truth = await resolver({
      input: {},
      agentHostInput: normalizedAgentHostInput({
        refs: ['browser-host-session:verified'],
        target: {
          refs: ['browser-host-session:verified'],
        },
      }),
      commandText: 'Scroll the current browser page.',
      workspacePath: '/tmp/workspace',
    });

    assert.equal(truth?.readiness?.browserHostSession, 'ready');
    assert.equal(truth?.readiness?.nativeBridge, 'ready');
    assert.equal(truth?.readiness?.nativeSurface, 'ready');
    assert.equal(truth?.readiness?.windowActionSession, 'ready');
    assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
    assert.deepEqual(truth?.permissions?.refs, ['permission:turn/low-risk-navigation']);
    assert.equal(truth?.permissions?.stopCancelPath, true);
    assert.ok(truth?.refs?.includes('window-action-session:verified-browser-window'));
    assert.ok(truth?.refs?.includes('adapter-registry:browser-host-session/computer-use'));
    assert.ok(truth?.refs?.includes('cancel:runtime-turn/verified'));
    assert.ok(truth?.refs?.includes('runtime-truth:act-source/verified'));
  } finally {
    await new Promise<void>((resolve) => nativeAdapterServer.close(() => resolve()));
  }
});

test('default Agent Host runtime truth resolver rejects UI projection Act-time truth refs', async () => {
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    actTimeTruthSource: async () => ({
      schemaVersion: 'sciforge.agent-host.act-time-truth.v1',
      source: 'test-ui-projection-source',
      windowActionSession: {
        status: 'ready',
        refs: ['gui.present:fake-window-action'],
      },
      computerUseAdapter: {
        status: 'ready',
        providerId: 'ui-projected-adapter',
        refs: ['ui:adapter-ready'],
      },
      permissions: {
        refs: ['gui.ask_user:approval-projection', 'ui:permission-ready'],
        stopCancelPath: true,
        stopCancelRefs: ['gui.cancel:fake'],
      },
      refs: ['gui.present:fake-window-action', 'ui:adapter-ready'],
    }),
  });
  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({
      readiness: {
        browserHostSession: 'ready',
        nativeBridge: 'ready',
        nativeSurface: 'ready',
        windowActionSession: 'ready',
        computerUseAdapter: 'ready',
      },
      permissions: {
        refs: ['permission:ui-only'],
        stopCancelPath: true,
      },
    }),
    commandText: 'Click the current button.',
    workspacePath: '/tmp/workspace',
  });

  assert.equal(truth?.readiness?.windowActionSession, 'blocked');
  assert.equal(truth?.readiness?.computerUseAdapter, 'blocked');
  assert.deepEqual(truth?.permissions?.refs, []);
  assert.equal(truth?.permissions?.stopCancelPath, false);
  assert.doesNotMatch(JSON.stringify(truth), /gui\.present|gui\.ask_user|ui:/);
});

test('default Agent Host runtime truth resolver exposes runtime-owned human takeover pause resume and stop controls', async () => {
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    actTimeTruthSource: async () => ({
      schemaVersion: 'sciforge.agent-host.act-time-truth.v1',
      source: 'test-human-takeover-act-source',
      windowActionSession: {
        status: 'ready',
        refs: ['window-action-session:human-takeover-control-window'],
      },
      computerUseAdapter: {
        status: 'ready',
        providerId: 'sciforge.runtime-control-only',
        refs: ['adapter-registry:runtime-control-only'],
      },
      permissions: {
        refs: ['permission:turn/human-takeover-control'],
        stopCancelPath: true,
        stopCancelRefs: [
          'cancel:runtime-codex/codex-command-human-control/attempt-1',
          'lease:human-takeover/lease-control-1',
          'lease:human-takeover/lease-control-1/pause',
          'lease:human-takeover/lease-control-1/resume',
          'lease:human-takeover/lease-control-1/stop',
          'gui.present:fake-takeover',
          'ui:fake-takeover',
          'fixture:fake-takeover',
          'replay:fake-takeover',
          'https://example.invalid/takeover',
          'data:image/png;base64,AAAA',
          'Authorization: Bearer secret-token',
        ],
        takeoverRefs: ['lease:human-takeover/lease-control-1', 'gui.present:fake-takeover'],
        pauseRefs: ['lease:human-takeover/lease-control-1/pause', 'ui:fake-pause'],
        resumeRefs: ['lease:human-takeover/lease-control-1/resume', 'fixture:fake-resume'],
        stopRefs: ['lease:human-takeover/lease-control-1/stop', 'replay:fake-stop'],
      },
      refs: ['runtime-truth:act-source/human-takeover-control'],
    }),
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({}),
    commandText: 'Hand control to me, pause automation, and let me resume or stop it.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-human-control',
    attemptId: 'attempt-1',
  });
  const controlPath = (truth?.permissions as Record<string, unknown> | undefined)?.controlPath as Record<string, string[] | boolean> | undefined;

  assert.equal(truth?.readiness?.windowActionSession, 'ready');
  assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
  assert.equal(truth?.permissions?.stopCancelPath, true);
  assert.deepEqual(controlPath, {
    ready: true,
    takeoverRefs: ['lease:human-takeover/lease-control-1'],
    pauseRefs: ['lease:human-takeover/lease-control-1/pause'],
    resumeRefs: ['lease:human-takeover/lease-control-1/resume'],
    stopRefs: ['lease:human-takeover/lease-control-1/stop'],
    cancelRefs: ['cancel:runtime-codex/codex-command-human-control/attempt-1'],
  });
  assert.ok(truth?.refs?.includes('lease:human-takeover/lease-control-1/resume'));
  assert.doesNotMatch(JSON.stringify(truth), /gui(?:\.|:)|ui:|fixture:|replay:|https?:\/\/|data:image|base64|token|bearer/i);
});

test('default Agent Host runtime truth resolver does not promote cancel-path evidence refs into controlPath', async () => {
  const resolver = createDefaultCodexAgentHostRuntimeTruthResolver({
    env: {},
    actTimeTruthSource: async () => ({
      schemaVersion: 'sciforge.agent-host.act-time-truth.v1',
      source: 'test-evidence-only-control-source',
      windowActionSession: {
        status: 'ready',
        refs: ['window-action-session:evidence-only-control-window'],
      },
      computerUseAdapter: {
        status: 'ready',
        providerId: 'sciforge.runtime-control-only',
        refs: ['adapter-registry:runtime-control-only'],
      },
      permissions: {
        refs: ['permission:turn/evidence-only-control'],
        stopCancelPath: true,
        stopCancelRefs: [
          'runtime-truth:cancel-path/window-action-session/evidence-only-control/stop',
          'runtime-truth:cancel-path/human-takeover/evidence-only-control/resume',
        ],
        controlRefs: {
          stop: ['runtime-truth:cancel-path/window-action-session/evidence-only-control/stop'],
          resume: ['runtime-truth:cancel-path/human-takeover/evidence-only-control/resume'],
        },
      },
      refs: ['runtime-truth:act-source/evidence-only-control'],
    }),
  });

  const truth = await resolver({
    input: {},
    agentHostInput: normalizedAgentHostInput({}),
    commandText: 'Let me take over this run.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-evidence-only-control',
    attemptId: 'attempt-1',
  });
  const controlPath = (truth?.permissions as Record<string, unknown> | undefined)?.controlPath;

  assert.equal(truth?.readiness?.windowActionSession, 'ready');
  assert.equal(truth?.readiness?.computerUseAdapter, 'ready');
  assert.equal(truth?.permissions?.stopCancelPath, false);
  assert.equal(controlPath, undefined);
  assert.ok(truth?.refs?.includes('runtime-truth:cancel-path/window-action-session/evidence-only-control/stop'));
  assert.doesNotMatch(JSON.stringify(truth), /gui(?:\.|:)|ui:|fixture:|replay:|https?:\/\/|data:image|base64|token|bearer/i);
});

function createReadyNativeAdapterServer() {
  return createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      status: 'ready',
      ready: true,
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
      passClaim: true,
    }));
  });
}

function browserHostSessionManager(state: Record<string, unknown>): BrowserHostSessionManager {
  return {
    async sessionState(_workspacePath: string, sessionId: string) {
      assert.equal(sessionId, state.id);
      return state;
    },
  } as unknown as BrowserHostSessionManager;
}

function recordProductVirtualAppScreenSession(options: {
  now: string;
  diagnosticOnly: boolean;
}): VirtualAppScreenNativeHostSessionRecord {
  const readiness: NativeHostReadinessRecord = {
    schemaVersion: 'sciforge.computer-use.native-virtual-app-screen-host.v1',
    status: 'ready',
    adapterKind: 'product-virtual-app-screen-adapter',
    platform: 'darwin',
    checkedAt: options.now,
    adapterReadinessRef: 'computer-use:native-host/readiness/vas-product-session/adapter.json',
    permissionRefs: ['permission:macos/screen-recording'],
    driverRefs: ['computer-use:native-host/drivers/vas-product-session/platform-driver.json'],
    providerRefs: ['computer-use:native-host/providers/vas-product-session/provider.json'],
    capabilities: {
      createDisplay: true,
      launchApp: true,
      attachWindow: true,
      captureFrame: true,
      streamFrames: true,
      sendHumanInput: true,
      executeAutomationIntent: true,
      validateGrant: true,
      writeEvidenceLedger: true,
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
    },
    diagnosticOnly: options.diagnosticOnly,
  };
  const session: NativeHostSession = {
    schemaVersion: 'sciforge.computer-use.native-virtual-app-screen-host.v1',
    sessionId: 'vas-product-session',
    sessionRef: 'computer-use:native-host/sessions/vas-product-session/session.json',
    hostId: 'native-virtual-app-screen-host.product',
    status: 'surface-attached',
    createdAt: options.now,
    updatedAt: options.now,
    profile: {
      profileId: 'vscode-editor',
      defaultSurfaceTransport: 'native-frame-stream',
    },
    permissions: {
      allowBackgroundRendering: true,
      allowSharedSystemInput: false,
    },
    evidenceContext: {
      currentRunRef: 'computer-use:native-host/runs/vas-product-session/current-run.json',
      evidenceRootRef: 'computer-use:native-host/evidence/vas-product-session',
      currentRunPointerRef: 'computer-use:native-host/runs/vas-product-session/current-run-pointer.json',
      guiPresentRef: 'gui.present:virtual-app-screen/product',
    },
    readiness,
    app: {
      appId: 'vscode',
      appRef: 'computer-use:native-host/apps/vas-product-session/vscode.json',
      title: 'VS Code',
    },
    ledgerRef: 'computer-use:native-host/ledgers/vas-product-session/evidence-ledger.json',
    currentRunPointerRef: 'computer-use:native-host/runs/vas-product-session/current-run-pointer.json',
  };
  const surface: NativeHostLiveSurface = {
    surfaceId: 'vas-product-surface',
    screenRef: 'virtual-app-screen:vas-product/screen',
    targetAppRef: 'computer-use:native-host/apps/vas-product-session/vscode.json',
    targetWindowRef: 'window:vas-product/vscode/main',
    sessionRef: session.sessionRef,
    liveSurfaceRef: 'computer-use:native-host/surfaces/vas-product-surface/live-surface.json',
    liveBindingAttachGrantRef: 'computer-use:native-host/grants/vas-product-surface/live-binding-attach-grant.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/vas-product-surface/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/vas-product-surface/display-owner.json',
    surfaceTransport: 'native-frame-stream',
    surfaceTransportRef: 'computer-use:native-host/surfaces/vas-product-surface/surface-transport.json',
    frameStreamRef: 'computer-use:native-host/surfaces/vas-product-surface/frame-stream.json',
    frameTransportContractRef: 'computer-use:native-host/surfaces/vas-product-surface/frame-transport-contract.json',
    frameTelemetryRef: 'computer-use:native-host/surfaces/vas-product-surface/frame-telemetry.json',
    currentFrameRef: 'computer-use:native-host/frames/vas-product-surface/current.png',
    currentFrameHash: 'sha256:frame',
    currentFrameSequence: 9,
  };
  const frame: NativeHostFrame = {
    frameRef: 'computer-use:native-host/frames/vas-product-surface/current.png',
    frameHash: 'sha256:frame',
    frameSequence: 9,
    liveSurfaceRef: surface.liveSurfaceRef,
    frameStreamRef: surface.frameStreamRef,
    readAt: options.now,
  };
  const record = recordVirtualAppScreenNativeHostSession({
    host: {} as NativeVirtualAppScreenHost,
    session,
    surface,
    frame,
    refs: {
      inputLeaseRef: 'computer-use:native-host/leases/vas-product-session/input.json',
      actionAdapterRef: 'computer-use:native-host/adapters/vas-product-session/input.json',
      adapterReadinessRef: readiness.adapterReadinessRef,
      evidenceLedgerRef: session.ledgerRef,
      currentRunPointerRef: session.currentRunPointerRef,
      grantValidationRef: 'computer-use:native-host/ledgers/vas-product-session/evidence-ledger.json/events/0004-grant.validated.json',
    },
  });
  recordVirtualAppScreenProviderSession({
    source: 'right-pane-screen',
    action: 'screen-attach',
    profile: 'vscode-editor',
    refs: {
      readinessRef: readiness.adapterReadinessRef,
      screenRef: surface.screenRef,
      targetAppRef: surface.targetAppRef,
      targetWindowRef: surface.targetWindowRef,
      evidenceLedgerRef: session.ledgerRef,
    },
  }, {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-session-manager.v1',
    status: 'attached',
    executorId: 'native-session-manager:vas-product',
    providerId: 'native-virtual-app-screen-host.product',
    refs: {
      currentRunRef: session.evidenceContext.currentRunRef,
      currentRunPointerRef: session.currentRunPointerRef,
      sessionRef: session.sessionRef,
      liveSurfaceRef: surface.liveSurfaceRef,
      surfaceTransportRef: surface.surfaceTransportRef,
      frameStreamRef: surface.frameStreamRef,
      currentFrameRef: frame.frameRef,
      frameTransportContractRef: surface.frameTransportContractRef,
      frameTelemetryRef: surface.frameTelemetryRef,
      liveBindingAttachGrantRef: surface.liveBindingAttachGrantRef,
      grantValidationRef: 'computer-use:native-host/ledgers/vas-product-session/evidence-ledger.json/events/0004-grant.validated.json',
      surfaceOwnerRef: surface.surfaceOwnerRef,
      displayOwnerRef: surface.displayOwnerRef,
      screenRef: surface.screenRef,
      targetAppRef: surface.targetAppRef,
      targetWindowRef: surface.targetWindowRef,
      inputLeaseRef: 'computer-use:native-host/leases/vas-product-session/input.json',
      actionAdapterRef: 'computer-use:native-host/adapters/vas-product-session/input.json',
      adapterReadinessRef: readiness.adapterReadinessRef,
      evidenceLedgerRef: session.ledgerRef,
      guiPresentRef: session.evidenceContext.guiPresentRef,
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      providerSessionGrantValidated: true,
      platformDriverReady: true,
      permissionRequired: true,
      permissionGranted: true,
      backgroundRenderable: true,
      diagnosticOnly: options.diagnosticOnly,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport: {
        schemaVersion: 'sciforge.virtual-display.surface-transport.v1',
        owner: 'VirtualDisplayProvider',
        providerId: 'native-virtual-app-screen-host.product',
        transport: 'native-frame-stream',
        liveSurfaceRef: surface.liveSurfaceRef,
        surfaceTransportRef: surface.surfaceTransportRef,
        frameStreamRef: surface.frameStreamRef,
        frameTransportContractRef: surface.frameTransportContractRef!,
        frameTelemetryRef: surface.frameTelemetryRef,
        currentFrameRef: frame.frameRef,
        currentFrameSequence: frame.frameSequence,
        diagnosticOnly: false,
        productFallback: false,
        singleInteractiveTruth: true,
      },
      evidenceRefs: [
        session.sessionRef,
        surface.liveSurfaceRef,
        frame.frameRef,
        session.ledgerRef,
        session.currentRunPointerRef,
        readiness.adapterReadinessRef,
      ],
    },
  });
  return record;
}

function normalizedAgentHostInput(
  input: Partial<Omit<NormalizedCodexAgentHostInput, 'schemaVersion' | 'singleTurnOverride'>>,
): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'test',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: input.refs ?? [],
    readiness: input.readiness ?? {},
    target: input.target ?? {},
    observation: input.observation ?? {},
    permissions: input.permissions ?? {},
  };
}
