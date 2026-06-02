import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA,
  RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES,
  rightPaneBrowserLoadingProgressLifecycle,
  rightPaneBrowserProjectionForUrl,
  type RightPaneBrowserHostSessionState,
  type RightPaneBrowserLoadingProgressReason,
  type RightPaneBrowserLoadingProgressState,
  type RightPaneBrowserProjectionStatus,
  type RightPaneBrowserProjectionTabStatus,
} from '../../src/ui/src/app/results/browserPaneModel';

const TARGET_URL = 'https://external.example/loading-progress-lifecycle';

const EXPECTED_REASONS: Record<RightPaneBrowserLoadingProgressState, RightPaneBrowserLoadingProgressReason> = {
  'navigation-start': 'navigation-requested',
  'navigation-committed': 'navigation-committed',
  interactive: 'page-interactive',
  load: 'page-load',
  'network-quiet': 'network-quiet',
  stalled: 'navigation-stalled',
  blocked: 'navigation-blocked',
  retry: 'navigation-retry',
  handoff: 'user-handoff-required',
};

const EXPECTED_SURFACE: Record<RightPaneBrowserLoadingProgressState, {
  status: RightPaneBrowserProjectionStatus;
  tabStatus: RightPaneBrowserProjectionTabStatus;
}> = {
  'navigation-start': { status: 'loading', tabStatus: 'loading' },
  'navigation-committed': { status: 'loading', tabStatus: 'loading' },
  interactive: { status: 'loading', tabStatus: 'loading' },
  load: { status: 'loading', tabStatus: 'loading' },
  'network-quiet': { status: 'ready', tabStatus: 'ready' },
  stalled: { status: 'loading', tabStatus: 'loading' },
  blocked: { status: 'blocked', tabStatus: 'failed' },
  retry: { status: 'loading', tabStatus: 'loading' },
  handoff: { status: 'blocked', tabStatus: 'failed' },
};

test('Browser pane loading/progress lifecycle contract covers navigation and recovery states', () => {
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

  const evidence = RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES.map((state) => {
    const hostSession = hostSessionForState(state);
    const lifecycle = rightPaneBrowserLoadingProgressLifecycle({
      targetUrl: TARGET_URL,
      hostBusy: state === 'navigation-start',
      hostSession,
    });
    assert.equal(lifecycle?.schemaVersion, RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA);
    assert.equal(lifecycle?.state, state);
    assert.equal(lifecycle?.reason, EXPECTED_REASONS[state]);
    assert.equal(lifecycle?.status, EXPECTED_SURFACE[state].status);
    assert.equal(lifecycle?.tabStatus, EXPECTED_SURFACE[state].tabStatus);
    assert.equal(lifecycle?.requestedUrl, TARGET_URL);
    assert.equal(lifecycle?.urlDigests?.requested?.length, TARGET_URL.length);
    assert.match(lifecycle?.urlDigests?.requested?.hash ?? '', /^[a-f0-9]{8}$/);

    const projection = rightPaneBrowserProjectionForUrl(TARGET_URL, {
      hostExternalBrowserAvailable: true,
      hostBusy: state === 'navigation-start',
      hostSession,
    });
    assert.equal(projection.loadingProgress?.state, state);
    assert.equal(projection.loadingProgress?.reason, EXPECTED_REASONS[state]);
    assert.equal(projection.status, EXPECTED_SURFACE[state].status);
    assert.equal(projection.tabStatus, EXPECTED_SURFACE[state].tabStatus);
    assert.equal(projection.hostSurface, 'browser-host-session');
    assert.equal(projection.canRenderFrame, false);
    assert.doesNotMatch(projection.loadingProgress?.reason ?? '', /raw|https?:\/\//i);
    assert.equal(projection.loadingProgress?.urlDigests?.requested?.length, TARGET_URL.length);

    return {
      state,
      reason: projection.loadingProgress?.reason,
      status: projection.status,
      tabStatus: projection.tabStatus,
      requestedUrlDigestLength: projection.loadingProgress?.urlDigests?.requested?.length,
      bounded: true,
    };
  });

  console.log(`[ok] Browser pane loading/progress lifecycle contract ${JSON.stringify({
    schemaVersion: RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA,
    evidence,
  })}`);
});

test('Browser pane loading/progress lifecycle mapping accepts generic host fields without fixture text', () => {
  const aliasCases: Array<{
    label: string;
    patch: Record<string, unknown>;
    expectedState: RightPaneBrowserLoadingProgressState;
    expectedReason: RightPaneBrowserLoadingProgressReason;
  }> = [
    {
      label: 'navigation-start alias',
      patch: { lifecycle: { stage: 'navigation.started' } },
      expectedState: 'navigation-start',
      expectedReason: 'navigation-requested',
    },
    {
      label: 'committed alias',
      patch: { navigation: { state: 'navigation.committed' } },
      expectedState: 'navigation-committed',
      expectedReason: 'navigation-committed',
    },
    {
      label: 'interactive alias',
      patch: { progress: { phase: 'DOMContentLoaded' } },
      expectedState: 'interactive',
      expectedReason: 'page-interactive',
    },
    {
      label: 'load alias',
      patch: { progress: { phase: 'load-event' } },
      expectedState: 'load',
      expectedReason: 'page-load',
    },
    {
      label: 'network quiet alias',
      patch: { progress: { phase: 'networkIdle' } },
      expectedState: 'network-quiet',
      expectedReason: 'network-quiet',
    },
    {
      label: 'stalled alias',
      patch: { loadingProgress: { state: 'first-paint-timeout' } },
      expectedState: 'stalled',
      expectedReason: 'navigation-stalled',
    },
    {
      label: 'blocked reason field',
      patch: { lastActionTiming: { blockedReason: 'raw native policy text stays out of bounded reason' } },
      expectedState: 'blocked',
      expectedReason: 'navigation-blocked',
    },
    {
      label: 'retry field',
      patch: { retrying: true },
      expectedState: 'retry',
      expectedReason: 'navigation-retry',
    },
    {
      label: 'handoff field',
      patch: { requiresHandoff: true },
      expectedState: 'handoff',
      expectedReason: 'user-handoff-required',
    },
  ];

  for (const item of aliasCases) {
    const lifecycle = rightPaneBrowserLoadingProgressLifecycle({
      targetUrl: TARGET_URL,
      hostSession: genericHostSession(item.patch),
    });
    assert.equal(lifecycle?.state, item.expectedState, item.label);
    assert.equal(lifecycle?.reason, item.expectedReason, item.label);
    assert.equal(lifecycle?.schemaVersion, RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA, item.label);
    assert.doesNotMatch(lifecycle?.reason ?? '', /raw native policy text/i, item.label);
  }
});

function hostSessionForState(state: RightPaneBrowserLoadingProgressState): RightPaneBrowserHostSessionState {
  return genericHostSession({
    status: state === 'network-quiet' ? 'ready' : state === 'blocked' || state === 'handoff' ? 'loading' : 'loading',
    url: state === 'navigation-start' ? 'about:blank' : TARGET_URL,
    progress: {
      state,
      reason: EXPECTED_REASONS[state],
    },
  });
}

function genericHostSession(patch: Record<string, unknown>): RightPaneBrowserHostSessionState {
  return {
    id: `browser-loading-progress-${String(patch.status ?? 'loading')}`,
    status: 'loading',
    requestedUrl: TARGET_URL,
    url: TARGET_URL,
    diagnostics: ['bounded smoke diagnostic'],
    ...patch,
  } as RightPaneBrowserHostSessionState;
}
