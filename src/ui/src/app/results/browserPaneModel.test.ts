import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, SciForgeSession } from '../../domain';
import { browserWorkbenchDefaultCommands } from '../../../../../packages/presentation/components';
import {
  RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA,
  RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES,
  browserAddressForFocusedObjectReference,
  browserHostSessionForFocusedObjectReference,
  normalizeRightPaneBrowserUrl,
  parseRightPaneBrowserUrl,
  rightPaneBrowserLoadingProgressLifecycle,
  rightPaneBrowserProjectionForUrl,
  rightPaneBrowserUrlsEquivalent,
  rightPaneBrowserUrlIsLocal,
} from './browserPaneModel';

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

test('browser pane model resolves BrowserRuntime refs from provenance without losing SciForge commands', () => {
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

  const commandIds = browserWorkbenchDefaultCommands('https://example.org/result', {
    canOpenExternal: true,
    canSnapshot: true,
    canState: true,
    canTakeover: true,
    canCopyUrl: true,
  }).map((command) => command.id);
  for (const id of ['snapshot', 'state', 'takeover', 'copy-url', 'open-external'] as const) {
    assert.ok(commandIds.includes(id), `keeps ${id} command`);
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

test('browser pane model keeps local pages direct and requires host-owned browser surfaces for external HTML', () => {
  assert.equal(normalizeRightPaneBrowserUrl('localhost:5173/app'), 'http://localhost:5173/app');
  assert.equal(normalizeRightPaneBrowserUrl('www.baidu.com'), 'https://www.baidu.com');
  assert.equal(normalizeRightPaneBrowserUrl('www.google.com'), 'https://www.google.com');

  const local = rightPaneBrowserProjectionForUrl('http://localhost:5173/app');
  assert.equal(local.status, 'ready');
  assert.equal(local.canRenderFrame, true);
  assert.equal(local.previewUrl, 'http://localhost:5173/app');

  const ipv6Local = rightPaneBrowserProjectionForUrl('http://[::1]:5173/app');
  assert.equal(ipv6Local.status, 'ready');
  assert.equal(ipv6Local.canRenderFrame, true);

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
