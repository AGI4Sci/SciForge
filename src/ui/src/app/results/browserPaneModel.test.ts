import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, SciForgeSession } from '../../domain';
import { browserWorkbenchDefaultCommands } from '../../../../../packages/presentation/components';
import {
  RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA,
  RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES,
  browserAnnotationComposerReferenceForHostSession,
  browserAddressForFocusedObjectReference,
  browserHostSessionForFocusedObjectReference,
  normalizeRightPaneBrowserUrl,
  parseRightPaneBrowserUrl,
  rightPaneBrowserLoadingProgressLifecycle,
  rightPaneBrowserProjectionForUrl,
  rightPaneBrowserUrlsEquivalent,
  rightPaneBrowserUrlIsLocal,
} from './browserPaneModel';

test('browser pane model builds refs-first annotation composer references from BrowserHostSession refs', () => {
  const reference = browserAnnotationComposerReferenceForHostSession({
    id: 'browser-host-annotation-1',
    status: 'ready',
    requestedUrl: 'https://example.org/paper',
    url: 'https://example.org/paper',
    title: 'Example paper',
    liveSurfaceRef: 'browser-host-session:browser-host-annotation-1/live-surface',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    frameRef: 'browser-host-session:browser-host-annotation-1/frame.png',
    screenshotRef: 'browser-host-session:browser-host-annotation-1/screenshot.png',
    domSnapshotRef: 'browser-host-session:browser-host-annotation-1/dom.json',
    axSnapshotRef: 'browser-host-session:browser-host-annotation-1/ax.json',
  }, {
    cropRef: 'browser-host-session:browser-host-annotation-1/crops/selection.json',
    bounds: { x: 12, y: 24, width: 320, height: 180 },
    comment: 'Explain why this paragraph matters.',
    threadId: 'thread-browser-annotation',
    messageDraftId: 'draft-browser-annotation',
    createdAt: '2026-06-03T00:00:00.000Z',
  });

  assert.ok(reference);
  const payload = reference.payload as Record<string, unknown>;
  assert.equal(reference.ref, 'annotation:browser-host-annotation-1');
  assert.equal(reference.kind, 'ui');
  assert.equal(reference.title, 'Browser annotation · Example paper');
  assert.equal(payload.annotationRef, 'annotation:browser-host-annotation-1');
  assert.equal(payload.targetRef, 'browser-host-session:browser-host-annotation-1/frame.png');
  assert.equal(payload.cropRef, 'browser-host-session:browser-host-annotation-1/crops/selection.json');
  assert.equal(payload.screenshotRef, 'browser-host-session:browser-host-annotation-1/screenshot.png');
  assert.equal(payload.sourceKind, 'browser');
  assert.equal(payload.coordinateSpace, 'browser-viewport');
  assert.equal(payload.browserSessionRef, 'browser-host-session:browser-host-annotation-1/session.json');
  assert.deepEqual(payload.bounds, { x: 12, y: 24, width: 320, height: 180 });
  assert.equal(payload.comment, 'Explain why this paragraph matters.');
  assert.equal(payload.threadId, 'thread-browser-annotation');
  assert.equal(payload.messageDraftId, 'draft-browser-annotation');
  assert.equal(payload.createdAt, '2026-06-03T00:00:00.000Z');
  assert.deepEqual(payload.refs, [
    'annotation:browser-host-annotation-1',
    'browser-host-session:browser-host-annotation-1/session.json',
    'browser-host-session:browser-host-annotation-1/frame.png',
    'browser-host-session:browser-host-annotation-1/crops/selection.json',
    'browser-host-session:browser-host-annotation-1/screenshot.png',
    'browser-host-session:browser-host-annotation-1/dom.json',
    'browser-host-session:browser-host-annotation-1/ax.json',
  ]);
  const serialized = JSON.stringify(reference);
  assert.doesNotMatch(serialized, /data:image|base64|rawDom|rawScreenshot|annotatedDataUrl/);
});

test('browser pane model creates viewport annotation refs from current BrowserHostSession without URL-specific data', () => {
  const reference = browserAnnotationComposerReferenceForHostSession({
    id: 'right-pane-tab-a-12345678',
    status: 'ready',
    requestedUrl: 'https://example.org/private?token=secret',
    url: 'https://example.org/private?token=secret',
    liveSurfaceRef: 'browser-host-session:right-pane-tab-a-12345678/live-surface',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    screenshotRef: 'browser-host-session:right-pane-tab-a-12345678/screenshot.png',
  }, {
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
  });

  assert.ok(reference);
  const payload = reference.payload as Record<string, unknown>;
  assert.equal(payload.annotationRef, 'annotation:right-pane-tab-a-12345678');
  assert.equal(payload.targetRef, 'browser-host-session:right-pane-tab-a-12345678/live-surface');
  assert.equal(payload.cropRef, 'browser-host-session:right-pane-tab-a-12345678/annotations/annotation-right-pane-tab-a-12345678/crop.json');
  assert.equal(payload.screenshotRef, 'browser-host-session:right-pane-tab-a-12345678/screenshot.png');
  assert.equal(payload.sourceKind, 'browser');
  assert.equal(payload.coordinateSpace, 'browser-viewport');
  assert.deepEqual(payload.bounds, { x: 0, y: 0, width: 1280, height: 720 });
  assert.equal(JSON.stringify(payload).includes('token=secret'), false);
});

test('browser pane model normalizes focused URL object refs into Browser targets', () => {
  const session = emptySession();
  const urlReference: ObjectReference = {
    id: 'url-1',
    kind: 'url',
    title: 'Paper',
    ref: 'url:example.org/paper',
  };

  assert.equal(browserAddressForFocusedObjectReference(urlReference, session), 'https://example.org/paper');
  assert.equal(browserAddressForFocusedObjectReference({ ...urlReference, ref: 'https://example.org/absolute' }, session), 'https://example.org/absolute');
  assert.equal(browserAddressForFocusedObjectReference({ ...urlReference, kind: 'file', ref: 'file:README.md' }, session), undefined);
});

test('browser pane model resolves BrowserRuntime refs from provenance while keeping toolbar navigation-only', () => {
  const session = emptySession();
  const browserRuntimeReference: ObjectReference = {
    id: 'browser-runtime-1',
    kind: 'artifact',
    title: 'Browser observation',
    ref: 'browser-runtime:session-1',
    provenance: {
      dataRef: 'http://127.0.0.1:4173/result',
    },
  };

  assert.equal(browserAddressForFocusedObjectReference(browserRuntimeReference, session), 'http://127.0.0.1:4173/result');

  const commandIds = new Set<string>(browserWorkbenchDefaultCommands('https://example.org/result', {
    canGoBack: true,
    canGoForward: true,
  }).map((command) => String(command.id)));
  for (const id of ['open', 'back', 'forward', 'reload'] as const) {
    assert.ok(commandIds.has(id), `keeps ${id} command`);
  }
  for (const id of ['snapshot', 'state', 'takeover', 'copy-url', 'open-external'] as const) {
    assert.equal(commandIds.has(id), false, `blocks ${id} command`);
  }
});

test('browser pane model keeps legacy host-stream projection refs without reusing live transport', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [{
      id: 'browser-host-projection-1',
      type: 'browser-runtime-projection',
      producerScenario: 'literature-evidence-review',
      schemaVersion: 'sciforge.browser-runtime.projection.v1',
      metadata: { finalUrl: 'https://example.org/search?q=host' },
      data: {
        hostSession: {
          id: 'browser-host-search-1',
          status: 'ready',
          requestedUrl: 'https://example.org/search?q=host',
          url: 'https://example.org/search?q=host',
          title: 'Search results',
          liveSurfaceRef: 'browser-host-session:browser-host-search-1/live',
          liveSurfaceTransport: 'host-stream',
          singleInteractiveTruth: true,
          frameStreamRef: 'browser-host-session:browser-host-search-1/frame-stream',
          frameRef: 'browser-host-session:browser-host-search-1/frame.png',
          searchResultRef: 'browser-host-session:browser-host-search-1/search-results.json',
          reason: 'search projection ready',
        },
      },
    }],
  };
  const reference: ObjectReference = {
    id: 'browser-projection-ref',
    kind: 'artifact',
    title: 'Browser search projection',
    ref: 'artifact:browser-host-projection-1',
    artifactType: 'browser-runtime-projection',
  };

  assert.equal(browserAddressForFocusedObjectReference(reference, session), 'https://example.org/search?q=host');
  const hostSession = browserHostSessionForFocusedObjectReference(reference, session);
  assert.equal(hostSession?.id, 'browser-host-search-1');
  assert.equal(hostSession?.liveSurfaceTransport, undefined);
  assert.equal(hostSession?.singleInteractiveTruth, true);
  assert.equal(hostSession?.frameStreamRef, 'browser-host-session:browser-host-search-1/frame-stream');
  assert.equal(hostSession?.searchResultRef, 'browser-host-session:browser-host-search-1/search-results.json');
  assert.equal(hostSession?.reason, 'search projection ready');
  assert.equal(hostSession?.loadingProgress?.state, 'network-quiet');
  assert.equal(hostSession?.loadingProgress?.reason, 'host-ready');
});

test('browser pane model reuses focused native embedded browser runtime projection host sessions', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [{
      id: 'browser-native-projection-1',
      type: 'browser-runtime-projection',
      producerScenario: 'literature-evidence-review',
      schemaVersion: 'sciforge.browser-runtime.projection.v1',
      metadata: { finalUrl: 'https://example.org/search?q=native' },
      data: {
        hostSession: {
          id: 'browser-host-native-1',
          status: 'ready',
          requestedUrl: 'https://example.org/search?q=native',
          url: 'https://example.org/search?q=native',
          title: 'Native search results',
          liveSurfaceRef: 'browser-host-session:browser-host-native-1/live-surface',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          secondTruthSource: false,
          searchResultRef: 'browser-host-session:browser-host-native-1/search-results.json',
          reason: 'native projection ready',
        },
      },
    }],
  };
  const reference: ObjectReference = {
    id: 'browser-native-ref',
    kind: 'artifact',
    title: 'Native browser search projection',
    ref: 'artifact:browser-native-projection-1',
    artifactType: 'browser-runtime-projection',
  };

  assert.equal(browserAddressForFocusedObjectReference(reference, session), 'https://example.org/search?q=native');
  const hostSession = browserHostSessionForFocusedObjectReference(reference, session);
  assert.equal(hostSession?.id, 'browser-host-native-1');
  assert.equal(hostSession?.liveSurfaceTransport, 'native-embedded');
  assert.equal(hostSession?.singleInteractiveTruth, true);
  assert.equal(hostSession?.secondTruthSource, false);
  assert.equal(hostSession?.liveSurfaceRef, 'browser-host-session:browser-host-native-1/live-surface');
  assert.equal(hostSession?.searchResultRef, 'browser-host-session:browser-host-native-1/search-results.json');
  assert.equal(hostSession?.reason, 'native projection ready');
  assert.equal(hostSession?.loadingProgress?.state, 'network-quiet');
});

test('browser pane model exposes bounded actor cursor identity from BrowserHostSession data', () => {
  const rawHostSession = {
    id: 'browser-host-window-action-1',
    status: 'ready' as const,
    requestedUrl: 'https://example.org/window-action',
    url: 'https://example.org/window-action',
    title: 'Window action page',
    liveSurfaceRef: 'browser-host-session:browser-host-window-action-1/live-surface',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    frameRef: 'browser-host-session:browser-host-window-action-1/frame.png',
    actorCursor: {
      agentId: 'agent-window-action',
      cursorId: 'cursor-shared-browser',
      color: '#22c55e',
      label: 'Window action',
      status: 'acting',
      target: {
        ref: 'browser-host-session:browser-host-window-action-1/targets/search-box.json',
        kind: 'input',
        label: 'Search box',
        selector: 'input[name="token"]',
        rawDom: '<input value="secret-token" />',
        screenshotDataUrl: 'data:image/png;base64,TARGET',
      },
      lastAction: {
        ref: 'browser-host-session:browser-host-window-action-1/visible-actions/cursor.json',
        payload: { selector: 'input[name="token"]', text: 'secret-token' },
        evidenceRefs: [
          'browser-host-session:browser-host-window-action-1/evidence/cursor.json',
          'data:image/png;base64,ACTION',
        ],
      },
      evidenceRefs: [
        'browser-host-session:browser-host-window-action-1/actor-cursors/cursor-shared-browser.json',
      ],
      rawDom: '<html>secret-token</html>',
      rawScreenshot: 'data:image/png;base64,SESSION',
      payload: { text: 'secret-token' },
    },
    actorCursors: [{
      actorId: 'agent-reviewer',
      id: 'cursor-reviewer',
      color: '#0ea5e9',
      label: 'Reviewer',
      state: 'idle',
      targetRef: 'browser-host-session:browser-host-window-action-1/targets/reviewer.json',
      lastActionRef: 'browser-host-session:browser-host-window-action-1/visible-actions/reviewer.json',
      evidenceRef: 'browser-host-session:browser-host-window-action-1/evidence/reviewer.json',
      rawPayload: 'secret-token',
    }],
    visibleAction: {
      actionId: 'cursor-action',
      action: 'cursor',
      riskType: 'click',
      actorCursorRef: 'browser-host-session:browser-host-window-action-1/actor-cursors/cursor-shared-browser.json',
    },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [{
      id: 'browser-host-window-action-projection',
      type: 'browser-runtime-projection',
      producerScenario: 'literature-evidence-review',
      schemaVersion: 'sciforge.browser-runtime.projection.v1',
      data: { hostSession: rawHostSession },
    }],
  };
  const reference: ObjectReference = {
    id: 'browser-window-action-ref',
    kind: 'artifact',
    title: 'Browser window action projection',
    ref: 'artifact:browser-host-window-action-projection',
    artifactType: 'browser-runtime-projection',
  };

  const hostSession = browserHostSessionForFocusedObjectReference(reference, session);

  assert.deepEqual(hostSession?.actorCursor, {
    agentId: 'agent-window-action',
    cursorId: 'cursor-shared-browser',
    color: '#22c55e',
    label: 'Window action',
    status: 'acting',
    target: {
      ref: 'browser-host-session:browser-host-window-action-1/targets/search-box.json',
      kind: 'input',
      label: 'Search box',
    },
    lastActionRef: 'browser-host-session:browser-host-window-action-1/visible-actions/cursor.json',
    evidenceRefs: [
      'browser-host-session:browser-host-window-action-1/actor-cursors/cursor-shared-browser.json',
      'browser-host-session:browser-host-window-action-1/evidence/cursor.json',
    ],
  });
  assert.deepEqual(hostSession?.actorCursors, [
    hostSession?.actorCursor,
    {
      agentId: 'agent-reviewer',
      cursorId: 'cursor-reviewer',
      color: '#0ea5e9',
      label: 'Reviewer',
      status: 'idle',
      target: {
        ref: 'browser-host-session:browser-host-window-action-1/targets/reviewer.json',
      },
      lastActionRef: 'browser-host-session:browser-host-window-action-1/visible-actions/reviewer.json',
      evidenceRefs: ['browser-host-session:browser-host-window-action-1/evidence/reviewer.json'],
    },
  ]);

  const rightPaneProjection = rightPaneBrowserProjectionForUrl('https://example.org/window-action', {
    hostExternalBrowserAvailable: true,
    hostSession: rawHostSession as unknown as NonNullable<Parameters<typeof rightPaneBrowserProjectionForUrl>[1]>['hostSession'],
  });
  assert.deepEqual(rightPaneProjection.actorCursor, hostSession?.actorCursor);
  assert.deepEqual(rightPaneProjection.actorCursors, hostSession?.actorCursors);

  const serialized = JSON.stringify({ hostSession, rightPaneProjection });
  assert.doesNotMatch(serialized, /rawDom|rawScreenshot|rawPayload|payload|selector|secret-token|data:image|base64/);
});

test('browser pane model accepts WindowActionSession actor cursor shape', () => {
  const rawHostSession = {
    id: 'browser-host-window-action-session-shape',
    status: 'ready' as const,
    requestedUrl: 'https://example.org/window-action-session-shape',
    url: 'https://example.org/window-action-session-shape',
    title: 'Window action session shape',
    liveSurfaceRef: 'browser-host-session:browser-host-window-action-session-shape/live-surface',
    liveSurfaceTransport: 'native-embedded',
    actorCursor: {
      agentId: 'agent-runtime-1',
      color: '#28a0f0',
      label: 'Runtime worker',
      status: 'clicking',
      target: {
        type: 'window-action-session',
        sessionId: 'window-action-window:chrome:main',
        windowRef: 'window:chrome:main',
      },
      lastAction: {
        action: 'click',
        status: 'completed',
        evidenceRefs: [
          { kind: 'screenshot', ref: 'window-action-ref:screenshot-1' },
          { kind: 'raw', ref: 'data:image/png;base64,NOPE' },
        ],
      },
      evidenceRefs: ['window-action-ref:actor-cursor-1'],
    },
  };

  const projection = rightPaneBrowserProjectionForUrl('https://example.org/window-action-session-shape', {
    hostExternalBrowserAvailable: true,
    hostSession: rawHostSession as unknown as NonNullable<Parameters<typeof rightPaneBrowserProjectionForUrl>[1]>['hostSession'],
  });

  assert.deepEqual(projection.actorCursor, {
    agentId: 'agent-runtime-1',
    cursorId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
    status: 'clicking',
    target: {
      ref: 'window:chrome:main',
      kind: 'window-action-session',
    },
    evidenceRefs: [
      'window-action-ref:actor-cursor-1',
      'window-action-ref:screenshot-1',
    ],
  });
  assert.doesNotMatch(JSON.stringify(projection), /data:image|base64|NOPE/);
});

test('browser pane model exposes a bounded loading/progress lifecycle contract', () => {
  assert.deepEqual([...RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES], [
    'navigation-start',
    'navigation-committed',
    'interactive',
    'load',
    'network-quiet',
    'stalled',
    'blocked',
    'retry',
    'handoff',
  ]);

  const committed = rightPaneBrowserLoadingProgressLifecycle({
    targetUrl: 'https://external.example/lifecycle',
    hostSession: {
      id: 'browser-host-lifecycle',
      status: 'loading',
      requestedUrl: 'https://external.example/lifecycle',
      url: 'https://external.example/lifecycle',
      lifecycle: { phase: 'navigation.committed' },
      diagnostics: ['raw host detail should not become the bounded lifecycle reason'],
    },
  });
  assert.equal(committed?.schemaVersion, RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA);
  assert.equal(committed?.state, 'navigation-committed');
  assert.equal(committed?.reason, 'navigation-committed');
  assert.equal(committed?.source, 'host-lifecycle');
  assert.equal(committed?.requestedUrl, 'https://external.example/lifecycle');
  assert.equal(committed?.currentUrl, 'https://external.example/lifecycle');
  assert.equal(committed?.urlDigests?.requested?.length, 'https://external.example/lifecycle'.length);
  assert.match(committed?.urlDigests?.requested?.hash ?? '', /^[a-f0-9]{8}$/);

  const runtimeLoadingProgress = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-runtime-progress',
      status: 'loading',
      requestedUrl: 'https://external.example/runtime-progress',
      url: 'https://external.example/runtime-progress',
      loadingProgress: {
        schemaVersion: 'sciforge.browser-host-session.loading-progress.lifecycle.v1',
        state: 'navigation-start',
        reason: 'navigation-requested',
        source: 'host-navigation',
        status: 'loading',
        action: 'navigate',
        updatedAt: '2026-06-01T00:00:00.000Z',
        refs: { session: 'browser-host-session:browser-host-runtime-progress/session.json' },
      },
    },
  });
  assert.equal(runtimeLoadingProgress?.state, 'navigation-start');
  assert.equal(runtimeLoadingProgress?.reason, 'navigation-requested');
  assert.equal(runtimeLoadingProgress?.source, 'host-navigation');

  const runtimeRedirectDigest = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-runtime-redirect',
      status: 'ready',
      requestedUrl: 'https://external.example/requested',
      url: 'https://external.example/current',
      loadingProgress: {
        schemaVersion: 'sciforge.browser-host-session.loading-progress.lifecycle.v1',
        state: 'network-quiet',
        reason: 'network-quiet',
        source: 'host-progress',
        status: 'ready',
        action: 'navigate',
        updatedAt: '2026-06-01T00:00:00.000Z',
        refs: { session: 'browser-host-session:browser-host-runtime-redirect/session.json' },
        urls: {
          requested: { length: 34, sha1: '1111111111111111111111111111111111111111' },
          current: { length: 32, sha1: '2222222222222222222222222222222222222222' },
          final: { length: 30, sha1: 'abcdef1234567890abcdef1234567890abcdef12' },
        },
      },
    },
  });
  assert.equal(runtimeRedirectDigest?.urlDigests?.requested?.length, 'https://external.example/requested'.length);
  assert.equal(runtimeRedirectDigest?.urlDigests?.current?.length, 'https://external.example/current'.length);
  assert.equal(runtimeRedirectDigest?.urlDigests?.final?.length, 30);
  assert.equal(runtimeRedirectDigest?.urlDigests?.final?.hash, 'abcdef12');

  const interactive = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-dom',
      status: 'loading',
      requestedUrl: 'https://external.example/dom',
      url: 'https://external.example/dom',
      progress: { phase: 'DOMContentLoaded', reason: 'dom-interactive' },
    },
  });
  assert.equal(interactive?.state, 'interactive');
  assert.equal(interactive?.reason, 'page-interactive');

  const blocked = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-blocked',
      status: 'loading',
      requestedUrl: 'https://external.example/blocked',
      url: 'https://external.example/blocked',
      lastActionTiming: { blockedReason: 'native adapter blocked by policy' },
    },
  });
  assert.equal(blocked?.state, 'blocked');
  assert.equal(blocked?.reason, 'navigation-blocked');
  assert.equal(blocked?.blocked, true);
  assert.doesNotMatch(blocked?.reason ?? '', /native adapter blocked by policy/);

  const retry = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-retry',
      status: 'loading',
      requestedUrl: 'https://external.example/retry',
      url: 'https://external.example/retry',
      retrying: true,
    },
  });
  assert.equal(retry?.state, 'retry');
  assert.equal(retry?.reason, 'navigation-retry');
  assert.equal(retry?.canRetry, true);

  const handoff = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-handoff',
      status: 'loading',
      requestedUrl: 'https://external.example/handoff',
      url: 'https://external.example/handoff',
      requiresHandoff: true,
    },
  });
  assert.equal(handoff?.state, 'handoff');
  assert.equal(handoff?.reason, 'user-handoff-required');
  assert.equal(handoff?.requiresHandoff, true);

  const nativeBridgeUnavailable = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-native-route',
      status: 'ready',
      requestedUrl: 'https://external.example/native-route',
      url: 'https://external.example/native-route',
      nativeSurfaceBridge: {
        routeStatus: 'reachable',
        capability: 'missing',
        rightPaneBridge: false,
        status: 'native-bridge-unavailable',
        healthPath: '/api/sciforge/browser-host/native-surface/health',
      },
    },
  });
  assert.equal(nativeBridgeUnavailable?.state, 'handoff');
  assert.equal(nativeBridgeUnavailable?.reason, 'native-bridge-unavailable');
  assert.equal(nativeBridgeUnavailable?.source, 'native-surface-route');
  assert.equal(nativeBridgeUnavailable?.status, 'blocked');
  assert.equal(nativeBridgeUnavailable?.requiresHandoff, true);

  const nativeBridgeUnavailableWithRuntimeStall = rightPaneBrowserProjectionForUrl('https://external.example/native-stalled', {
    hostExternalBrowserAvailable: true,
    hostSession: {
      id: 'browser-host-native-stalled',
      status: 'loading',
      requestedUrl: 'https://external.example/native-stalled',
      url: 'https://external.example/native-stalled',
      loadingProgress: {
        schemaVersion: 'sciforge.browser-host-session.loading-progress.lifecycle.v1',
        state: 'stalled',
        reason: 'navigation-stalled',
        source: 'host-progress',
        status: 'loading',
        action: 'navigate',
        updatedAt: '2026-06-01T00:00:00.000Z',
        canRetry: true,
        refs: { session: 'browser-host-session:browser-host-native-stalled/session.json' },
      },
      nativeSurfaceBridge: {
        routeStatus: 'reachable',
        capability: 'missing',
        rightPaneBridge: false,
        status: 'native-bridge-unavailable',
        healthPath: '/api/sciforge/browser-host/native-surface/health',
      },
    },
  });
  assert.equal(nativeBridgeUnavailableWithRuntimeStall.status, 'blocked');
  assert.equal(nativeBridgeUnavailableWithRuntimeStall.tabStatus, 'failed');
  assert.equal(nativeBridgeUnavailableWithRuntimeStall.loadingProgress?.state, 'handoff');
  assert.equal(nativeBridgeUnavailableWithRuntimeStall.loadingProgress?.reason, 'native-bridge-unavailable');
  assert.equal(nativeBridgeUnavailableWithRuntimeStall.loadingProgress?.source, 'native-surface-route');
  assert.equal(nativeBridgeUnavailableWithRuntimeStall.loadingProgress?.requiresHandoff, true);

  const redirected = rightPaneBrowserLoadingProgressLifecycle({
    hostSession: {
      id: 'browser-host-redirected',
      status: 'ready',
      requestedUrl: 'https://external.example/requested',
      url: 'https://external.example/current',
      finalUrl: 'https://external.example/final',
    },
  });
  assert.equal(redirected?.state, 'network-quiet');
  assert.equal(redirected?.urlDigests?.requested?.length, 'https://external.example/requested'.length);
  assert.equal(redirected?.urlDigests?.current?.length, 'https://external.example/current'.length);
  assert.equal(redirected?.urlDigests?.final?.length, 'https://external.example/final'.length);
  assert.match(redirected?.urlDigests?.final?.hash ?? '', /^[a-f0-9]{8}$/);
});

test('browser pane model requires host-owned browser surfaces for local and external HTTP', () => {
  assert.equal(normalizeRightPaneBrowserUrl('localhost:5173/app'), 'http://localhost:5173/app');
  assert.equal(normalizeRightPaneBrowserUrl('www.baidu.com'), 'https://www.baidu.com');
  assert.equal(normalizeRightPaneBrowserUrl('www.google.com'), 'https://www.google.com');

  const local = rightPaneBrowserProjectionForUrl('http://localhost:5173/app');
  assert.equal(local.status, 'blocked');
  assert.equal(local.canRenderFrame, false);
  assert.equal(local.previewUrl, undefined);
  assert.equal(local.externalUrl, 'http://localhost:5173/app');
  assert.equal(local.embedPolicy?.embeddable, false);

  const ipv6Local = rightPaneBrowserProjectionForUrl('http://[::1]:5173/app');
  assert.equal(ipv6Local.status, 'blocked');
  assert.equal(ipv6Local.canRenderFrame, false);

  for (const rawUrl of ['https://example.org/paper', 'https://external.example/search', 'https://docs.example/resource', 'www.baidu.com', 'www.google.com']) {
    const url = normalizeRightPaneBrowserUrl(rawUrl);
    const external = rightPaneBrowserProjectionForUrl(url);
    assert.equal(external.status, 'blocked');
    assert.equal(external.tabStatus, 'failed');
    assert.equal(external.canRenderFrame, false);
    assert.equal(external.externalUrl, url);
    assert.equal(external.previewUrl, undefined);
    assert.match(external.previewSandbox ?? '', /allow-same-origin/);
    assert.doesNotMatch(external.previewSandbox ?? '', /allow-scripts/);
    assert.equal(external.embedPolicy?.embeddable, false);
    assert.match(external.embedPolicy?.ref ?? '', /^browser:embed-policy\/right-pane\/external-html-host-required$/);
  }
});

test('browser pane model projects external pages to host-owned browser surfaces when available', () => {
  const external = rightPaneBrowserProjectionForUrl('https://external.example/search', {
    hostExternalBrowserAvailable: true,
    hostSurface: 'browser-host-session',
    hostState: {
      ok: true,
      url: 'https://external.example/search',
      surface: 'browser-host-session',
    },
  });

  assert.equal(external.status, 'ready');
  assert.equal(external.tabStatus, 'ready');
  assert.equal(external.canRenderFrame, false);
  assert.equal(external.hostSurface, 'browser-host-session');
  assert.equal(external.externalUrl, 'https://external.example/search');
  assert.equal(external.embedPolicy, undefined);

  const pending = rightPaneBrowserProjectionForUrl('https://external.example/loading', {
    hostExternalBrowserAvailable: true,
  });
  assert.equal(pending.status, 'idle');
  assert.equal(pending.tabStatus, 'new');
  assert.equal(pending.hostSurface, 'browser-host-session');

  const loading = rightPaneBrowserProjectionForUrl('https://external.example/loading', {
    hostExternalBrowserAvailable: true,
    hostBusy: true,
  });
  assert.equal(loading.status, 'loading');
  assert.equal(loading.tabStatus, 'loading');
  assert.equal(loading.hostSurface, 'browser-host-session');

  const failed = rightPaneBrowserProjectionForUrl('https://external.example/fail', {
    hostExternalBrowserAvailable: true,
    hostError: 'host unavailable',
  });
  assert.equal(failed.status, 'blocked');
  assert.equal(failed.tabStatus, 'failed');
  assert.equal(failed.detail, 'host unavailable');
  assert.equal(failed.loadingProgress?.state, 'blocked');

  const trailingSlash = rightPaneBrowserProjectionForUrl('https://external.example', {
    hostExternalBrowserAvailable: true,
    hostSession: {
      id: 'browser-host-1',
      status: 'ready',
      requestedUrl: 'https://external.example',
      url: 'https://external.example/',
    },
  });
  assert.equal(trailingSlash.status, 'ready');
  assert.equal(rightPaneBrowserUrlsEquivalent('https://external.example', 'https://external.example/'), true);
  assert.equal(rightPaneBrowserUrlsEquivalent('https://external.example/a', 'https://external.example/b'), false);

  const staleReadySession = rightPaneBrowserProjectionForUrl('https://external.example/new-target', {
    hostExternalBrowserAvailable: true,
    hostSession: {
      id: 'browser-host-stale',
      status: 'ready',
      requestedUrl: 'https://external.example/old-target',
      url: 'https://external.example/old-target',
    },
  });
  assert.equal(staleReadySession.status, 'idle');
  assert.equal(staleReadySession.tabStatus, 'new');

  const loadingWithDiagnostic = rightPaneBrowserProjectionForUrl('https://external.example/new-target', {
    hostExternalBrowserAvailable: true,
    hostBusy: true,
    hostSession: {
      id: 'browser-host-loading',
      status: 'loading',
      requestedUrl: 'https://external.example/new-target',
      url: 'https://external.example/old-target',
      reason: 'waiting for network quiet',
    },
  });
  assert.equal(loadingWithDiagnostic.status, 'loading');
  assert.equal(loadingWithDiagnostic.tabStatus, 'loading');
  assert.equal(loadingWithDiagnostic.detail, 'waiting for network quiet');

  const failedWithReason = rightPaneBrowserProjectionForUrl('https://external.example/fail-with-reason', {
    hostExternalBrowserAvailable: true,
    hostSession: {
      id: 'browser-host-failed',
      status: 'failed',
      requestedUrl: 'https://external.example/fail-with-reason',
      url: 'https://external.example/fail-with-reason',
      reason: 'navigation stalled before first paint',
    },
  });
  assert.equal(failedWithReason.status, 'blocked');
  assert.equal(failedWithReason.detail, 'navigation stalled before first paint');
  assert.equal(failedWithReason.loadingProgress?.state, 'blocked');
});

test('browser pane model still allows external PDFs through document viewer projection', () => {
  const pdf = rightPaneBrowserProjectionForUrl('https://arxiv.org/pdf/2605.00080v1');

  assert.equal(pdf.status, 'ready');
  assert.equal(pdf.tabStatus, 'ready');
  assert.equal(pdf.canRenderFrame, true);
  assert.match(pdf.previewUrl ?? '', /^\/api\/sciforge\/browser\/pdf-viewer\?/);
  assert.equal(pdf.embedPolicy?.embeddable, true);
});

test('browser pane model fails closed for unsupported or malformed targets', () => {
  const unsupported = rightPaneBrowserProjectionForUrl('file:///tmp/example.html');
  assert.equal(unsupported.status, 'blocked');
  assert.equal(unsupported.canRenderFrame, false);
  assert.equal(unsupported.embedPolicy?.embeddable, false);

  const malformed = rightPaneBrowserProjectionForUrl('https://%');
  assert.equal(malformed.status, 'error');
  assert.equal(malformed.canRenderFrame, false);

  const parsed = parseRightPaneBrowserUrl('http://127.0.0.1:8080/');
  assert.ok(parsed);
  assert.equal(rightPaneBrowserUrlIsLocal(parsed), true);
});

function emptySession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-empty',
    scenarioId: 'literature-evidence-review',
    title: 'empty',
    createdAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
