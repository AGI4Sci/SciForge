import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
  type WebSocket as PlaywrightWebSocket,
} from 'playwright-core';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const PRODUCT_LONG_SESSION_SCHEMA = 'sciforge.browser-pane-product-long-session.v1';
const PRODUCT_LONG_SESSION_LOADING_PROGRESS_TRACE_SCHEMA = 'sciforge.browser-pane-product-long-session.loading-progress-trace.v1';
const FIXTURE_HOST = 'sciforge-browser-pane-product-long-session.test';
const DEFAULT_QUICK_ITERATIONS = 2;
const TRUE_LONG_SESSION_MINUTES = 30;
const MAX_PRODUCT_LONG_SESSION_MANIFEST_BYTES = 96_000;
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-product-long-session');
const manifestPath = join(artifactDir, 'manifest.json');
const PRODUCT_LONG_SESSION_CONFIG = productLongSessionConfig();

type JsonRecord = Record<string, unknown>;

type ProductLongSessionMode = 'quick-contract' | 'extended-product-long-session';
type ProductLongSessionMetricCategory =
  | 'navigation'
  | 'input-routing'
  | 'scroll-routing'
  | 'drag-routing'
  | 'history-reload'
  | 'right-pane-tab-switch'
  | 'frame-capture'
  | 'state-polling'
  | 'workspace-reconnect';

type ProductLongSessionConfig = {
  mode: ProductLongSessionMode;
  requestedMinutes?: number;
  requestedIterations?: number;
  iterations: number;
  runUntilDeadline: boolean;
  durationTargetMs: number;
  testTimeoutMs: number;
  defaultSmokeIsThirtyMinuteBenchmark: false;
};

type ProductFixtureEvent = {
  type: string;
  path: string;
  iteration?: number;
  valueLength?: number;
  valueHash?: string;
  count?: number;
  maxScrollY?: number;
  x?: number;
  y?: number;
};

type MetricSample = {
  category: ProductLongSessionMetricCategory;
  label: string;
  durationMs: number;
  iteration?: number;
};

type LatencySummary = {
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  labels: string[];
};

type BoundedCount = {
  value: string;
  count: number;
};

type BrowserPaneLoadingProgressLifecycleTraceSummary = {
  schemaVersion: typeof PRODUCT_LONG_SESSION_LOADING_PROGRESS_TRACE_SCHEMA;
  evidenceSource: 'right-pane-browser-workbench-viewer-and-host-session-status';
  bounded: true;
  sampleCounts: {
    ui: number;
    hostSession: number;
    lifecycle: number;
  };
  observedUiStates: BoundedCount[];
  observedHostStatuses: BoundedCount[];
  observedLifecycleStates: BoundedCount[];
  observedLifecycleReasons: BoundedCount[];
  observedLifecycleSources: BoundedCount[];
  observedTransitions: string[];
  urlEvidence: {
    requested: BoundedUrlDigestSummary;
    current: BoundedUrlDigestSummary;
    final: BoundedUrlDigestSummary;
  };
  completionEvidence: {
    uiLoadingToReady: boolean;
    lifecycleNavigationStartToNetworkQuiet: boolean;
    readyStateObserved: boolean;
    networkQuietObserved: boolean;
  };
};

type BrowserHostNetworkSample = {
  endpoint: 'start' | 'session-action' | 'computer-use-action' | 'state' | 'frame';
  status: number;
  durationMs: number;
  sessionRef?: string;
  sessionStatus?: string;
  action?: string;
  key?: string;
  textLength?: number;
  textHash?: string;
  capture?: string;
  paintAckSource?: string;
  loadingProgressState?: string;
  loadingProgressReason?: string;
  loadingProgressSource?: string;
  requestedUrlLength?: number;
  requestedUrlHash?: string;
  currentUrlLength?: number;
  currentUrlHash?: string;
  finalUrlLength?: number;
  finalUrlHash?: string;
};

type BoundedUrlDigestSummary = {
  sampleCount: number;
  uniqueHashCount: number;
  lengthRange: number[];
  hashes: string[];
};

type FrameStreamStats = {
  streamsOpened: number;
  framesReceived: number;
  binaryFramesReceived: number;
  firstFrameLatencyMs?: number;
  maxPayloadBytes: number;
};

type ObjectUrlBoundedStats = {
  createCount: number;
  revokeCount: number;
  liveEstimate: number;
  maxLiveEstimate: number;
  revokeDeficit: number;
};

type RightPaneBoundedEvidence = {
  state: string;
  mutationCount: number;
  attachChanges: number;
  detachChanges: number;
  maxHostFrames: number;
  sessionIds: string[];
  liveSurfaceRefs: string[];
  frameStreamRefs: string[];
  renderers: string[];
  browserStates: string[];
  browserStateCounts: Record<string, number>;
  browserStateTransitions: string[];
  browserStateSampleCount: number;
  hiddenKeyboardFocusKeys: string[];
  hostFrames: number;
  canvasSurfaces: number;
  imageSurfaces: number;
  nativeSurfaces: number;
  iframeSurfaces: number;
  proxySurfaces: number;
  webviewSurfaces: number;
  systemPopupSurfaces: number;
  dataImageSurfaces: number;
  base64Attributes: number;
  approxJsHeapUsed?: number;
  objectUrls: ObjectUrlBoundedStats;
};

type BrowserWorkbenchFailureSnapshot = {
  hasViewer: boolean;
  state: string;
  displayedUrlLength: number;
  displayedUrlHash?: string;
  addressDraftLength: number;
  addressDraftHash?: string;
  liveSurfaceRefs: string[];
  sessionRefs: string[];
  frameStreamRefs: string[];
  hostFrameCount: number;
  hiddenKeyboardActive: boolean;
  commandAvailability: {
    back: 'enabled' | 'disabled' | 'missing';
    forward: 'enabled' | 'disabled' | 'missing';
    reload: 'enabled' | 'disabled' | 'missing';
  };
};

type ProductLongSessionResourceEvidence = {
  bounded: true;
  sample: 'before-restart' | 'before-failure';
  approxJsHeapUsed?: number;
  approxJsHeapDeltaFromInitial?: number;
  objectUrls: ObjectUrlBoundedStats;
  surface: {
    attachChanges: number;
    detachChanges: number;
    maxHostFrames: number;
    sessionRefCount: number;
    surfaceReconnectObserved: boolean;
  };
};

type ProductLongSessionFailureClassification = {
  kind:
    | 'address-details-ready-timeout'
    | 'browser-workbench-url-timeout'
    | 'browser-host-session-url-timeout'
    | 'fixture-event-timeout'
    | 'browser-executable-missing'
    | 'sciforge-results-panel-timeout'
    | 'browser-host-session-continuity-break'
    | 'product-long-session-cleanup-blocked'
    | 'workspace-writer-health-timeout'
    | 'product-long-session-error';
  phaseCategory:
    | 'address-details-navigation'
    | 'browser-navigation'
    | 'fixture-readiness'
    | 'session-continuity'
    | 'cleanup'
    | 'environment'
    | 'workspace'
    | 'unknown';
  timedOut: boolean;
  retryable: boolean;
  expectedRoute: 'details' | 'session' | 'unknown';
  blockedEvidence: {
    bounded: true;
    noRawUrl: true;
    noRawDom: true;
    uiState?: string;
    displayedUrlLength?: number;
    displayedUrlHash?: string;
    addressDraftLength?: number;
    addressDraftHash?: string;
    hostFrameCount?: number;
    hiddenKeyboardActive?: boolean;
    sessionRefs: string[];
    liveSurfaceRefs: string[];
    frameStreamRefs: string[];
    recentHostStatuses: BoundedCount[];
    recentLoadingStates: BoundedCount[];
    recentLoadingReasons: BoundedCount[];
    observedUiStates: BoundedCount[];
    resourceHealth?: ProductLongSessionResourceEvidence;
  };
};

type AddressDetailsRecoveryEvidence = {
  iteration: number;
  attempted: boolean;
  status: 'not-needed' | 'succeeded' | 'blocked';
  actionSequence: Array<'open-url' | 'reload' | 'retry-open-url'>;
  reasonCode?: 'workbench-url-timeout' | 'browser-host-session-url-timeout' | 'fixture-event-timeout' | 'address-details-retry-timeout';
  reasonHash?: string;
  initialFailure?: {
    reasonCode: 'workbench-url-timeout' | 'browser-host-session-url-timeout' | 'fixture-event-timeout' | 'address-details-retry-timeout';
    reasonHash: string;
  };
  reloadAck?: {
    status: 'acked' | 'not-observed' | 'command-unavailable';
    action: 'reload';
    reasonHash?: string;
  };
  boundedRefs?: {
    bounded: true;
    noRawUrl: true;
    noRawDom: true;
    workbenchState?: string;
    displayedUrlLength?: number;
    displayedUrlHash?: string;
    addressDraftLength?: number;
    addressDraftHash?: string;
    hostFrameCount?: number;
    sessionRefs: string[];
    liveSurfaceRefs: string[];
    frameStreamRefs: string[];
    recentHostStatuses: BoundedCount[];
    recentLoadingStates: BoundedCount[];
    recentLoadingReasons: BoundedCount[];
  };
};

type BrowserHostSessionSummary = {
  id: string;
  owner: string;
  status: string;
  transport?: string;
  singleInteractiveTruth: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  urlHash?: string;
  requestedUrlHash?: string;
  liveSurfaceRef?: string;
  refs: {
    frameStreamRef?: string;
    frameRef?: string;
    screenshotRef?: string;
    domSnapshotRef?: string;
    axSnapshotRef?: string;
    consoleLogRef?: string;
    networkLogRef?: string;
  };
};

type WorkspaceWriterRestartEvidence = {
  status: 'reconnected' | 'blocked';
  attempted: true;
  healthDownObserved: boolean;
  healthUpObserved: boolean;
  durationMs: number;
  previousSessionRef: string;
  sessionAfterRestart?: BrowserHostSessionSummary;
  retry: {
    action: 'restart-workspace-writer-same-port-and-poll-existing-session';
    status: 'succeeded' | 'blocked';
    reasonCode?: string;
    reasonHash?: string;
  };
};

type ProductLongSessionManifest = {
  schemaVersion: typeof PRODUCT_LONG_SESSION_SCHEMA;
  status: 'passed';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  runner: {
    mode: ProductLongSessionMode;
    requestedMinutes?: number;
    requestedIterations?: number;
    iterationsCompleted: number;
    durationMs: number;
    defaultSmokeIsThirtyMinuteBenchmark: false;
    extensionEnv: {
      minutes: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES';
      iterations: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS';
    };
  };
  interactionCoverage: {
    classes: Array<
      | 'continuous-navigation'
      | 'continuous-input'
      | 'long-page-scroll'
      | 'drag-mouse-route'
      | 'history-back-forward-reload'
      | 'right-pane-tab-switch'
      | 'workspace-writer-restart-reconnect'
    >;
    fixtureEventTypes: string[];
    fixturePaths: string[];
    browserHostActions: string[];
    typedInput: {
      iterations: number;
      lengthRange: [number, number];
      hashes: string[];
    };
    scroll: {
      maxScrollY: number;
      eventCount: number;
    };
    drag: {
      fixturePointerEvents: number;
      browserHostRouteActions: string[];
    };
  };
  browserHostSession: {
    first: BrowserHostSessionSummary;
    beforeWorkspaceRestart: BrowserHostSessionSummary;
    afterWorkspaceRestart?: BrowserHostSessionSummary;
  };
  continuity: {
    sameSessionBeforeRestart: boolean;
    singleBrowserHostSessionBeforeRestart: boolean;
    tabSwitchSameSession: boolean;
    firstSessionRef: string;
    finalSessionRef: string;
    observedSessionRefs: string[];
    maxHostFrames: number;
    singleInteractiveTruth: boolean;
  };
  boundedMetrics: {
    latencySummary: Record<ProductLongSessionMetricCategory, LatencySummary>;
    networkSamples: BrowserHostNetworkSample[];
    frameStream: FrameStreamStats;
    memoryishCounts: {
      fixtureEventCount: number;
      networkSampleCount: number;
      frameStreamFrameCount: number;
      rightPaneMutationCountBeforeRestart: number;
      rightPaneMutationCountAfterRestart: number;
      rightPaneSessionRefCount: number;
      approxJsHeapUsedBeforeRestart?: number;
      approxJsHeapUsedAfterRestart?: number;
      approxJsHeapDeltaBeforeRestart?: number;
      objectUrlCreateCountBeforeRestart: number;
      objectUrlRevokeCountBeforeRestart: number;
      objectUrlLiveEstimateBeforeRestart: number;
      objectUrlMaxLiveEstimateBeforeRestart: number;
      objectUrlRevokeDeficitBeforeRestart: number;
    };
    loadingProgressLifecycle: BrowserPaneLoadingProgressLifecycleTraceSummary;
    rightPaneBeforeRestart: RightPaneBoundedEvidence;
    rightPaneAfterRestart?: RightPaneBoundedEvidence;
  };
  failureRetry: {
    addressDetailsRecovery: {
      attemptedIterations: number[];
      outcomeCount: number;
      outcomes: AddressDetailsRecoveryEvidence[];
    };
    workspaceWriterRestart: WorkspaceWriterRestartEvidence;
    pageDiagnostics: {
      pageErrorCount: number;
      consoleErrorCount: number;
      recentPageErrorHashes: string[];
      recentConsoleErrorHashes: string[];
    };
  };
  forbiddenEvidence: {
    rawDom: false;
    base64: false;
    rawScreenshot: false;
    iframe: false;
    proxy: false;
    webview: false;
    systemPopup: false;
    fixtureHostRaw: false;
    defaultSmokeClaimsThirtyMinutes: false;
  };
  verificationCommand: string;
};

type ProductLongSessionBlockedManifest = {
  schemaVersion: typeof PRODUCT_LONG_SESSION_SCHEMA;
  status: 'blocked';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  runner: ProductLongSessionManifest['runner'];
  failure: {
    phase: string;
    reasonCode: string;
    reasonHash: string;
    errorName: string;
    currentIteration: number;
    classification: ProductLongSessionFailureClassification;
    retrySemantics: 'typed-blocked-artifact-written-and-original-error-rethrown';
  };
  boundedMetrics: {
    latencySummary: Record<ProductLongSessionMetricCategory, LatencySummary>;
    networkSamples: BrowserHostNetworkSample[];
    frameStream: FrameStreamStats;
    memoryishCounts: {
      iterationsCompleted: number;
      metricSampleCount: number;
      networkSampleCount: number;
      frameStreamFrameCount: number;
      fixtureEventCount: number;
      rightPaneSessionRefCount: number;
      approxJsHeapUsedBeforeFailure?: number;
      approxJsHeapDeltaBeforeFailure?: number;
      objectUrlCreateCountBeforeFailure: number;
      objectUrlRevokeCountBeforeFailure: number;
      objectUrlLiveEstimateBeforeFailure: number;
      objectUrlMaxLiveEstimateBeforeFailure: number;
      objectUrlRevokeDeficitBeforeFailure: number;
    };
    loadingProgressLifecycle?: BrowserPaneLoadingProgressLifecycleTraceSummary;
    rightPaneBeforeFailure?: RightPaneBoundedEvidence;
    workbenchFailureSnapshot?: BrowserWorkbenchFailureSnapshot;
    fixtureEventTypes: string[];
    fixturePaths: string[];
  };
  diagnostics: {
    pageErrorCount: number;
    consoleErrorCount: number;
    recentPageErrorHashes: string[];
    recentConsoleErrorHashes: string[];
  };
  failureRetry: {
    addressDetailsRecovery: {
      attemptedIterations: number[];
      outcomeCount: number;
      outcomes: AddressDetailsRecoveryEvidence[];
    };
  };
  forbiddenEvidence: ProductLongSessionManifest['forbiddenEvidence'];
  verificationCommand: string;
};

type RightPaneProductObserverState = {
  mutationCount: number;
  attachChanges: number;
  detachChanges: number;
  maxHostFrames: number;
  lastHostFrameSignature: string;
  sessionIds: string[];
  liveSurfaceRefs: string[];
  frameStreamRefs: string[];
  renderers: string[];
  browserStates: string[];
  browserStateCounts: Record<string, number>;
  browserStateTransitions: string[];
  browserStateSampleCount: number;
  lastBrowserState: string;
  hiddenKeyboardFocusKeys: string[];
  objectUrlCreateCount: number;
  objectUrlRevokeCount: number;
  objectUrlLiveEstimate: number;
  objectUrlMaxLiveEstimate: number;
};

type RightPaneProductObserver = {
  state: RightPaneProductObserverState;
  observer: MutationObserver;
  collect: () => void;
};

declare global {
  interface Window {
    __sciforgeBrowserPaneProductLongSession?: RightPaneProductObserver;
  }
}

test('product long-session blocked diagnostics classify address-details ready timeout with bounded evidence', () => {
  const classification = classifyProductLongSessionFailure({
    phase: 'iteration-7-address-details',
    error: new Error('Timed out waiting for Browser workbench URL {"expectedPatternHash":"abc","causeHash":"def"}'),
    workbenchFailureSnapshot: {
      hasViewer: true,
      state: 'loading',
      displayedUrlLength: 54,
      displayedUrlHash: hashText('bounded displayed url placeholder'),
      addressDraftLength: 54,
      addressDraftHash: hashText('bounded address draft placeholder'),
      liveSurfaceRefs: ['browser-host-session:session-7/live-surface'],
      sessionRefs: ['browser-host-session:session-7'],
      frameStreamRefs: ['browser-host-session:session-7/frame-stream'],
      hostFrameCount: 1,
      hiddenKeyboardActive: true,
      commandAvailability: {
        back: 'enabled',
        forward: 'disabled',
        reload: 'enabled',
      },
    },
    rightPaneBeforeFailure: {
      state: 'loading',
      mutationCount: 8,
      attachChanges: 1,
      detachChanges: 0,
      maxHostFrames: 1,
      sessionIds: ['session-7'],
      liveSurfaceRefs: ['browser-host-session:session-7/live-surface'],
      frameStreamRefs: ['browser-host-session:session-7/frame-stream'],
      renderers: ['canvas-binary'],
      browserStates: ['loading'],
      browserStateCounts: { loading: 3 },
      browserStateTransitions: ['ready->loading'],
      browserStateSampleCount: 3,
      hiddenKeyboardFocusKeys: ['browser-host-session:session-7'],
      hostFrames: 1,
      canvasSurfaces: 1,
      imageSurfaces: 0,
      nativeSurfaces: 0,
      iframeSurfaces: 0,
      proxySurfaces: 0,
      webviewSurfaces: 0,
      systemPopupSurfaces: 0,
      dataImageSurfaces: 0,
      base64Attributes: 0,
      objectUrls: {
        createCount: 18,
        revokeCount: 16,
        liveEstimate: 2,
        maxLiveEstimate: 4,
        revokeDeficit: 2,
      },
    },
    initialRightPaneEvidence: {
      state: 'ready',
      mutationCount: 1,
      attachChanges: 1,
      detachChanges: 0,
      maxHostFrames: 1,
      sessionIds: ['session-7'],
      liveSurfaceRefs: ['browser-host-session:session-7/live-surface'],
      frameStreamRefs: ['browser-host-session:session-7/frame-stream'],
      renderers: ['canvas-binary'],
      browserStates: ['ready'],
      browserStateCounts: { ready: 1 },
      browserStateTransitions: [],
      browserStateSampleCount: 1,
      hiddenKeyboardFocusKeys: ['browser-host-session:session-7'],
      hostFrames: 1,
      canvasSurfaces: 1,
      imageSurfaces: 0,
      nativeSurfaces: 0,
      iframeSurfaces: 0,
      proxySurfaces: 0,
      webviewSurfaces: 0,
      systemPopupSurfaces: 0,
      dataImageSurfaces: 0,
      base64Attributes: 0,
      approxJsHeapUsed: 10_000_000,
      objectUrls: {
        createCount: 1,
        revokeCount: 1,
        liveEstimate: 0,
        maxLiveEstimate: 1,
        revokeDeficit: 0,
      },
    },
    networkSamples: [
      {
        endpoint: 'session-action',
        status: 200,
        durationMs: 123,
        sessionRef: 'browser-host-session:session-7',
        sessionStatus: 'loading',
        action: 'navigate',
        loadingProgressState: 'stalled',
        loadingProgressReason: 'host-navigation-timeout',
        loadingProgressSource: 'browser-host-session',
      },
    ],
  });

  assert.equal(classification.kind, 'address-details-ready-timeout');
  assert.equal(classification.phaseCategory, 'address-details-navigation');
  assert.equal(classification.expectedRoute, 'details');
  assert.equal(classification.timedOut, true);
  assert.equal(classification.retryable, true);
  assert.equal(classification.blockedEvidence.noRawUrl, true);
  assert.equal(classification.blockedEvidence.noRawDom, true);
  assert.deepEqual(classification.blockedEvidence.recentLoadingStates, [{ value: 'stalled', count: 1 }]);
  assert.deepEqual(classification.blockedEvidence.observedUiStates, [{ value: 'loading', count: 5 }]);
  assert.deepEqual(classification.blockedEvidence.resourceHealth?.objectUrls, {
    createCount: 18,
    revokeCount: 16,
    liveEstimate: 2,
    maxLiveEstimate: 4,
    revokeDeficit: 2,
  });
  assert.equal(classification.blockedEvidence.resourceHealth?.surface.detachChanges, 0);
  assert.equal(classification.blockedEvidence.resourceHealth?.approxJsHeapDeltaFromInitial, undefined);
});

test('product long-session blocked diagnostics fall back to right-pane refs when workbench snapshot is missing', () => {
  const classification = classifyProductLongSessionFailure({
    phase: 'iteration-3-address-details',
    error: new Error('Timed out waiting for Browser workbench URL'),
    rightPaneBeforeFailure: {
      state: 'loading',
      mutationCount: 6,
      attachChanges: 2,
      detachChanges: 1,
      maxHostFrames: 1,
      sessionIds: ['session-3'],
      liveSurfaceRefs: ['browser-host-session:session-3/live-surface'],
      frameStreamRefs: ['browser-host-session:session-3/frame-stream'],
      renderers: ['canvas-binary'],
      browserStates: ['loading'],
      browserStateCounts: { loading: 2 },
      browserStateTransitions: ['ready->loading'],
      browserStateSampleCount: 2,
      hiddenKeyboardFocusKeys: ['browser-host-session:session-3'],
      hostFrames: 1,
      canvasSurfaces: 1,
      imageSurfaces: 0,
      nativeSurfaces: 0,
      iframeSurfaces: 0,
      proxySurfaces: 0,
      webviewSurfaces: 0,
      systemPopupSurfaces: 0,
      dataImageSurfaces: 0,
      base64Attributes: 0,
      approxJsHeapUsed: 21_000_000,
      objectUrls: {
        createCount: 9,
        revokeCount: 7,
        liveEstimate: 2,
        maxLiveEstimate: 3,
        revokeDeficit: 2,
      },
    },
    initialRightPaneEvidence: {
      state: 'ready',
      mutationCount: 1,
      attachChanges: 1,
      detachChanges: 0,
      maxHostFrames: 1,
      sessionIds: ['session-3'],
      liveSurfaceRefs: ['browser-host-session:session-3/live-surface'],
      frameStreamRefs: ['browser-host-session:session-3/frame-stream'],
      renderers: ['canvas-binary'],
      browserStates: ['ready'],
      browserStateCounts: { ready: 1 },
      browserStateTransitions: [],
      browserStateSampleCount: 1,
      hiddenKeyboardFocusKeys: ['browser-host-session:session-3'],
      hostFrames: 1,
      canvasSurfaces: 1,
      imageSurfaces: 0,
      nativeSurfaces: 0,
      iframeSurfaces: 0,
      proxySurfaces: 0,
      webviewSurfaces: 0,
      systemPopupSurfaces: 0,
      dataImageSurfaces: 0,
      base64Attributes: 0,
      approxJsHeapUsed: 17_000_000,
      objectUrls: {
        createCount: 0,
        revokeCount: 0,
        liveEstimate: 0,
        maxLiveEstimate: 0,
        revokeDeficit: 0,
      },
    },
    networkSamples: [],
  });

  assert.equal(classification.kind, 'address-details-ready-timeout');
  assert.equal(classification.blockedEvidence.uiState, 'loading');
  assert.deepEqual(classification.blockedEvidence.sessionRefs, ['browser-host-session:session-3']);
  assert.deepEqual(classification.blockedEvidence.liveSurfaceRefs, ['browser-host-session:session-3/live-surface']);
  assert.deepEqual(classification.blockedEvidence.frameStreamRefs, ['browser-host-session:session-3/frame-stream']);
  assert.equal(classification.blockedEvidence.hostFrameCount, 1);
  assert.equal(classification.blockedEvidence.hiddenKeyboardActive, true);
  assert.equal(classification.blockedEvidence.resourceHealth?.approxJsHeapDeltaFromInitial, 4_000_000);
  assert.equal(classification.blockedEvidence.resourceHealth?.surface.surfaceReconnectObserved, true);
});

test('product long-session blocked diagnostics classify BrowserHostSession continuity breaks distinctly', () => {
  const classification = classifyProductLongSessionFailure({
    phase: 'iteration-1-results-browser-tab-switch',
    error: new assert.AssertionError({
      message: 'product long-session must keep the same BrowserHostSession before workspace restart',
      actual: false,
      expected: true,
      operator: 'strictEqual',
    }),
    rightPaneBeforeFailure: {
      state: 'ready',
      mutationCount: 4,
      attachChanges: 1,
      detachChanges: 0,
      maxHostFrames: 1,
      sessionIds: ['session-after-tab-switch'],
      liveSurfaceRefs: ['browser-host-session:session-after-tab-switch/live-surface'],
      frameStreamRefs: ['browser-host-session:session-after-tab-switch/frame-stream'],
      renderers: ['canvas-binary'],
      browserStates: ['ready'],
      browserStateCounts: { ready: 2 },
      browserStateTransitions: ['loading->ready'],
      browserStateSampleCount: 2,
      hiddenKeyboardFocusKeys: ['browser-host-session:session-after-tab-switch'],
      hostFrames: 1,
      canvasSurfaces: 1,
      imageSurfaces: 0,
      nativeSurfaces: 0,
      iframeSurfaces: 0,
      proxySurfaces: 0,
      webviewSurfaces: 0,
      systemPopupSurfaces: 0,
      dataImageSurfaces: 0,
      base64Attributes: 0,
      objectUrls: {
        createCount: 2,
        revokeCount: 2,
        liveEstimate: 0,
        maxLiveEstimate: 1,
        revokeDeficit: 0,
      },
    },
    networkSamples: [],
  });

  assert.equal(classification.kind, 'browser-host-session-continuity-break');
  assert.equal(classification.phaseCategory, 'session-continuity');
  assert.equal(classification.retryable, false);
  assert.deepEqual(classification.blockedEvidence.sessionRefs, ['browser-host-session:session-after-tab-switch']);
});

test('product long-session blocked diagnostics classify cleanup separately from product continuity flakes', () => {
  const classification = classifyProductLongSessionFailure({
    phase: 'cleanup-temp-root-rm',
    error: new Error('Timed out during temp-root-rm'),
    networkSamples: [],
  });

  assert.equal(classification.kind, 'product-long-session-cleanup-blocked');
  assert.equal(classification.phaseCategory, 'cleanup');
  assert.equal(classification.retryable, false);
  assert.equal(classification.expectedRoute, 'unknown');
  assert.deepEqual(classification.blockedEvidence.sessionRefs, []);
});

test('product long-session deadline mode cannot be truncated by requested iterations', () => {
  const config: ProductLongSessionConfig = {
    mode: 'extended-product-long-session',
    requestedMinutes: TRUE_LONG_SESSION_MINUTES,
    requestedIterations: 1,
    iterations: Number.MAX_SAFE_INTEGER,
    runUntilDeadline: true,
    durationTargetMs: TRUE_LONG_SESSION_MINUTES * 60_000,
    testTimeoutMs: TRUE_LONG_SESSION_MINUTES * 60_000 + 240_000,
    defaultSmokeIsThirtyMinuteBenchmark: false,
  };

  assert.equal(shouldContinueLongSession(config, 1, Date.now() - 1_000), true);
  assert.equal(shouldContinueLongSession(config, 1, Date.now() - config.durationTargetMs - 1), false);
  assert.equal(
    productLongSessionVerificationCommand(config),
    'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=30 SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS=1 node --import tsx --test tests/smoke/smoke-browser-pane-product-long-session.test.ts',
  );
});

test('product long-session runner contract rejects pass-shaped truncated thirty-minute artifacts', () => {
  const runner: ProductLongSessionManifest['runner'] = {
    mode: 'extended-product-long-session',
    requestedMinutes: TRUE_LONG_SESSION_MINUTES,
    requestedIterations: 1,
    iterationsCompleted: 1,
    durationMs: 1_200,
    defaultSmokeIsThirtyMinuteBenchmark: false,
    extensionEnv: {
      minutes: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES',
      iterations: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS',
    },
  };

  assert.throws(
    () => assertProductLongSessionRunnerContract(
      runner,
      'passed',
      'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=30 SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS=1 node --import tsx --test tests/smoke/smoke-browser-pane-product-long-session.test.ts',
    ),
    /requested 30\+ minute product long-session pass must run for the requested duration/,
  );
  assert.doesNotThrow(() => assertProductLongSessionRunnerContract(
    runner,
    'blocked',
    'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=30 SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS=1 node --import tsx --test tests/smoke/smoke-browser-pane-product-long-session.test.ts',
  ));
});

test('product long-session runner contract requires minutes env when artifact requests a deadline', () => {
  const runner: ProductLongSessionManifest['runner'] = {
    mode: 'extended-product-long-session',
    requestedMinutes: TRUE_LONG_SESSION_MINUTES,
    iterationsCompleted: 1,
    durationMs: TRUE_LONG_SESSION_MINUTES * 60_000,
    defaultSmokeIsThirtyMinuteBenchmark: false,
    extensionEnv: {
      minutes: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES',
      iterations: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS',
    },
  };

  assert.throws(
    () => assertProductLongSessionRunnerContract(
      runner,
      'passed',
      'node --import tsx --test tests/smoke/smoke-browser-pane-product-long-session.test.ts',
    ),
    /requested minutes artifact must include its minutes env in verificationCommand/,
  );
});

test('SciForge Browser pane product long-session harness emits bounded continuity and reconnect evidence', { timeout: PRODUCT_LONG_SESSION_CONFIG.testTimeoutMs }, async () => {
  const config = PRODUCT_LONG_SESSION_CONFIG;
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    throw new Error(`No browser executable found for Browser pane product long-session smoke: ${browserExecutable}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-browser-pane-product-long-session-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const fixturePort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const fixtureOrigin = `http://${FIXTURE_HOST}:${fixturePort}`;
  const runId = `browser-pane-product-long-session-${Date.now().toString(36)}`;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let browserPid: number | undefined;
  let workspaceWriter: ChildProcess | undefined;
  let uiServer: ChildProcess | undefined;
  let fixture: Awaited<ReturnType<typeof startProductLongSessionFixture>> | undefined;
  let page: Page | undefined;
  let pageDiagnostics: ReturnType<typeof recordPageDiagnostics> | undefined;
  let metrics: ProductLongSessionMetrics | undefined;
  let networkRecorder: ReturnType<typeof recordBrowserHostNetwork> | undefined;
  let frameStreamStats: FrameStreamStats | undefined;
  let rightPaneInitial: RightPaneBoundedEvidence | undefined;
  let loopStartedAt = Date.now();
  let firstSession: JsonRecord | undefined;
  let sessionBeforeWorkspaceRestart: JsonRecord | undefined;
  let iterationsCompleted = 0;
  const tabSwitchContinuity: boolean[] = [];
  const addressDetailsRecovery: AddressDetailsRecoveryEvidence[] = [];
  let currentPhase = 'setup';

  await mkdir(workspacePath);
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    workspaceWriterBaseUrl: writerUrl,
    workspacePath,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    theme: 'dark',
    modelProvider: 'product-long-session-local',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  }), 'utf8');

  try {
    fixture = await startProductLongSessionFixture(fixturePort);
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: runId,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH: browserExecutable,
      SCIFORGE_BROWSER_HOST_RESOLVER_RULES: `MAP ${FIXTURE_HOST} 127.0.0.1`,
      SCIFORGE_BROWSER_HOST_PROXY_SERVER: 'direct://',
      SCIFORGE_BROWSER_HOST_PROXY_BYPASS_LIST: '*',
      SCIFORGE_UI_PORT: String(uiPort),
      SCIFORGE_AGENT_SERVER_AUTOSTART: '0',
      SCIFORGE_AGENT_SERVER_URL: 'http://127.0.0.1:1',
    };
    workspaceWriter = spawnProcess('npm', ['run', 'workspace:server', '--silent'], commonEnv);
    await waitForHttp(`${writerUrl}/health`, 30_000);
    uiServer = spawnProcess('npm', ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], commonEnv);
    await waitForHttp(uiUrl, 45_000);

    browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    browserPid = browserProcessId(browser);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    pageDiagnostics = recordPageDiagnostics(page);
    metrics = new ProductLongSessionMetrics();
    networkRecorder = recordBrowserHostNetwork(page, metrics);
    const frameStream = recordFrameStreamStats(page, metrics);
    frameStreamStats = frameStream.stats;

    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await waitForResultsPanel(page, pageDiagnostics);
    await ensureBrowserPane(page);
    await installRightPaneObserver(page);
    const surface = page.locator('.right-pane-browser-surface');
    rightPaneInitial = await collectRightPaneEvidence(page);

    loopStartedAt = Date.now();

    while (shouldContinueLongSession(config, iterationsCompleted, loopStartedAt)) {
      currentPhase = `iteration-${iterationsCompleted}`;
      const result = await runProductLongSessionIteration({
        iteration: iterationsCompleted,
        page,
        surface,
        fixtureUrl: fixture.url,
        fixtureOrigin,
        writerUrl,
        workspacePath,
        metrics,
        networkRecorder,
        addressDetailsRecovery,
        onPhase: (phase) => {
          currentPhase = phase;
        },
      });
      tabSwitchContinuity.push(result.tabSwitchSameSession);
      firstSession ??= result.firstSession;
      sessionBeforeWorkspaceRestart = result.finalSession;
      iterationsCompleted += 1;
      if (config.runUntilDeadline && shouldContinueLongSession(config, iterationsCompleted, loopStartedAt)) {
        await delay(250);
      }
    }
    assert.ok(iterationsCompleted >= 1, 'product long-session runner must execute at least one iteration');
    assert.ok(firstSession, 'product long-session runner must capture the first BrowserHostSession');
    assert.ok(sessionBeforeWorkspaceRestart, 'product long-session runner must capture a final BrowserHostSession before restart');

    await networkRecorder.drain();
    const rightPaneBeforeRestart = await collectRightPaneEvidence(page);
    const restart = await attemptWorkspaceWriterRestart({
      workspaceWriter,
      commonEnv,
      writerUrl,
      workspacePath,
      sessionBeforeRestart: sessionBeforeWorkspaceRestart,
      metrics,
    });
    workspaceWriter = restart.child;
    const rightPaneAfterRestart = await collectRightPaneEvidence(page).catch(() => undefined);
    const events = await fetchFixtureEvents(fixture.url);
    const manifest = buildProductLongSessionManifest({
      config,
      runId,
      fixtureOrigin,
      durationMs: Date.now() - loopStartedAt,
      iterationsCompleted,
      firstSession,
      sessionBeforeWorkspaceRestart,
      sessionAfterWorkspaceRestart: restart.sessionAfterRestart,
      rightPaneBeforeRestart,
      rightPaneInitial,
      rightPaneAfterRestart,
      events,
      metrics: metrics.samples,
      networkSamples: networkRecorder.samples,
      frameStream: frameStream.stats,
      restartEvidence: restart.evidence,
      tabSwitchContinuity,
      addressDetailsRecovery,
      diagnostics: pageDiagnostics,
    });
    assertProductLongSessionManifest(manifest);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[ok] Browser pane product long-session ${JSON.stringify({
      mode: manifest.runner.mode,
      iterations: manifest.runner.iterationsCompleted,
      durationMs: manifest.runner.durationMs,
      restart: manifest.failureRetry.workspaceWriterRestart.status,
      sessions: manifest.continuity.observedSessionRefs.length,
      frameStreamFrames: manifest.boundedMetrics.frameStream.framesReceived,
    })}`);
  } catch (error) {
    await writeProductLongSessionBlockedManifest({
      config,
      runId,
      fixtureOrigin,
      durationMs: Date.now() - loopStartedAt,
      phase: currentPhase,
      currentIteration: iterationsCompleted,
      error,
      page,
      fixtureUrl: fixture?.url,
      metrics: metrics?.samples ?? [],
      networkRecorder,
      frameStream: frameStreamStats,
      diagnostics: pageDiagnostics,
      rightPaneInitial,
      addressDetailsRecovery,
    }).catch((artifactError) => {
      console.error(`[blocked-artifact-failed] Browser pane product long-session ${JSON.stringify({
        reasonHash: hashText(artifactError instanceof Error ? artifactError.message : String(artifactError)),
      })}`);
    });
    throw error;
  } finally {
    await boundedCleanup('page-close', () => page?.close({ runBeforeUnload: false }), 5_000);
    await boundedCleanup('browser-context-close', () => context?.close(), 5_000);
    await boundedCleanup('browser-close', () => closeBrowserWithProcessFallback(browser, browserPid), 10_000);
    await boundedCleanup('ui-server-stop', () => stopProcess(uiServer), 5_000);
    await boundedCleanup('workspace-writer-stop', () => stopProcess(workspaceWriter), 5_000);
    await boundedCleanup('fixture-close', () => fixture?.close(), 5_000);
    await boundedCleanup('temp-root-rm', () => rm(tempRoot, { recursive: true, force: true }), 5_000);
  }
});

async function runProductLongSessionIteration(input: {
  iteration: number;
  page: Page;
  surface: Locator;
  fixtureUrl: string;
  fixtureOrigin: string;
  writerUrl: string;
  workspacePath: string;
  metrics: ProductLongSessionMetrics;
  networkRecorder: ReturnType<typeof recordBrowserHostNetwork>;
  addressDetailsRecovery: AddressDetailsRecoveryEvidence[];
  onPhase?: (phase: string) => void;
}): Promise<{ firstSession: JsonRecord; finalSession: JsonRecord; tabSwitchSameSession: boolean }> {
  const sessionUrl = `${input.fixtureOrigin}/session?iteration=${input.iteration}`;
  const detailsUrl = `${input.fixtureOrigin}/details?iteration=${input.iteration}`;
  const fixtureHostPattern = escapeRegExp(FIXTURE_HOST);
  input.onPhase?.(`iteration-${input.iteration}-address-session`);
  await input.metrics.measure('navigation', `iteration-${input.iteration}-address-session`, async () => {
    await openBrowserPaneUrl(input.surface, sessionUrl);
    await waitForWorkbenchUrl(input.surface, new RegExp(`^http://${fixtureHostPattern}:\\d+/session\\?iteration=${input.iteration}`));
    await waitForFixtureEvent(
      input.fixtureUrl,
      (event) => event.type === 'page-load' && event.path === '/session' && event.iteration === input.iteration,
      30_000,
      `session page load ${input.iteration}`,
    );
  }, input.iteration);
  let host = await waitForKeyboardHostFrame(input.surface, `iteration-${input.iteration}-session-frame`, input.metrics, input.iteration);
  const firstSession = await currentBrowserHostSession(input.page, input.writerUrl, input.workspacePath, input.metrics, `iteration-${input.iteration}-state-open`);

  const text = productInputText(input.iteration);
  input.onPhase?.(`iteration-${input.iteration}-continuous-input`);
  await input.metrics.measure('input-routing', `iteration-${input.iteration}-continuous-input`, async () => {
    await clickHostPoint(input.page, host.visualFrame, 156, 70);
    await waitForFixtureEvent(
      input.fixtureUrl,
      (event) => event.type === 'product-focus' && event.iteration === input.iteration,
      15_000,
      `input focus ${input.iteration}`,
    );
    await input.page.keyboard.insertText(text);
    await waitForFixtureEvent(
      input.fixtureUrl,
      (event) => event.type === 'product-input' && event.iteration === input.iteration && event.valueHash === hashText(text),
      30_000,
      `input text ${input.iteration}`,
    );
  }, input.iteration);
  await waitForFrameCaptureReady(input.surface, `iteration-${input.iteration}-after-input-frame`, input.metrics, input.iteration);

  input.onPhase?.(`iteration-${input.iteration}-long-page-scroll`);
  await input.metrics.measure('scroll-routing', `iteration-${input.iteration}-long-page-scroll`, async () => {
    await host.visualFrame.hover();
    await input.page.mouse.wheel(0, 1800);
    await waitForFixtureEvent(
      input.fixtureUrl,
      (event) => event.type === 'product-scroll' && event.iteration === input.iteration && (event.maxScrollY ?? 0) >= 900,
      30_000,
      `long page scroll ${input.iteration}`,
    );
  }, input.iteration);
  await waitForFrameCaptureReady(input.surface, `iteration-${input.iteration}-after-scroll-frame`, input.metrics, input.iteration);

  input.onPhase?.(`iteration-${input.iteration}-drag-route`);
  await input.metrics.measure('drag-routing', `iteration-${input.iteration}-drag-route`, async () => {
    const cursor = input.networkRecorder.samples.length;
    const dragPoints = [
      { x: 180, y: 220 },
      { x: 232, y: 238 },
      { x: 292, y: 256 },
      { x: 350, y: 274 },
    ];
    await dragHostPoints(input.page, host.visualFrame, dragPoints);
    try {
      await waitForDragRouteEvidence(input.fixtureUrl, input.iteration, input.networkRecorder, cursor, 8_000);
    } catch {
      await dispatchHostPointerDrag(host.visualFrame, dragPoints);
      await waitForDragRouteEvidence(input.fixtureUrl, input.iteration, input.networkRecorder, cursor, 15_000);
    }
  }, input.iteration);
  await waitForFrameCaptureReady(input.surface, `iteration-${input.iteration}-after-drag-frame`, input.metrics, input.iteration);

  input.onPhase?.(`iteration-${input.iteration}-address-details`);
  await input.metrics.measure('navigation', `iteration-${input.iteration}-address-details`, async () => {
    await navigateToAddressDetailsWithRetry({
      ...input,
      detailsUrl,
      expectedWorkbenchUrl: new RegExp(`^http://${fixtureHostPattern}:\\d+/details\\?iteration=${input.iteration}`),
    });
  }, input.iteration);
  host = await waitForKeyboardHostFrame(input.surface, `iteration-${input.iteration}-details-frame`, input.metrics, input.iteration);

  input.onPhase?.(`iteration-${input.iteration}-toolbar-back`);
  await input.metrics.measure('history-reload', `iteration-${input.iteration}-toolbar-back`, async () => {
    const cursor = input.networkRecorder.samples.length;
    await clickBrowserCommand(input.surface, 'Back');
    await input.networkRecorder.waitForAction('back', cursor, 20_000, `back ${input.iteration}`);
    await waitForWorkbenchUrl(input.surface, new RegExp(`^http://${fixtureHostPattern}:\\d+/session\\?iteration=${input.iteration}`));
  }, input.iteration);
  input.onPhase?.(`iteration-${input.iteration}-toolbar-forward`);
  await input.metrics.measure('history-reload', `iteration-${input.iteration}-toolbar-forward`, async () => {
    const cursor = input.networkRecorder.samples.length;
    await clickBrowserCommand(input.surface, 'Forward');
    await input.networkRecorder.waitForAction('forward', cursor, 20_000, `forward ${input.iteration}`);
    await waitForWorkbenchUrl(input.surface, new RegExp(`^http://${fixtureHostPattern}:\\d+/details\\?iteration=${input.iteration}`));
  }, input.iteration);
  input.onPhase?.(`iteration-${input.iteration}-toolbar-reload`);
  await input.metrics.measure('history-reload', `iteration-${input.iteration}-toolbar-reload`, async () => {
    const cursor = input.networkRecorder.samples.length;
    await clickBrowserCommand(input.surface, 'Reload');
    await input.networkRecorder.waitForAction('reload', cursor, 20_000, `reload ${input.iteration}`);
    await waitForWorkbenchUrl(input.surface, new RegExp(`^http://${fixtureHostPattern}:\\d+/details\\?iteration=${input.iteration}`));
  }, input.iteration);
  await waitForFrameCaptureReady(input.surface, `iteration-${input.iteration}-after-history-frame`, input.metrics, input.iteration);

  const beforeTabSwitch = await currentBrowserHostSession(input.page, input.writerUrl, input.workspacePath, input.metrics, `iteration-${input.iteration}-state-before-tab`);
  input.onPhase?.(`iteration-${input.iteration}-results-browser-tab-switch`);
  await input.metrics.measure('right-pane-tab-switch', `iteration-${input.iteration}-results-browser-tab-switch`, async () => {
    await activateRightPaneTab(input.page, 'Results');
    await delay(150);
    await activateRightPaneTab(input.page, 'Browser');
    await input.page.getByTestId('right-pane-browser-tool').waitFor({ state: 'visible', timeout: 20_000 });
    await waitForKeyboardHostFrame(input.surface, `iteration-${input.iteration}-after-tab-return-frame`, input.metrics, input.iteration);
  }, input.iteration);
  const afterTabSwitch = await currentBrowserHostSession(input.page, input.writerUrl, input.workspacePath, input.metrics, `iteration-${input.iteration}-state-after-tab`);
  assert.equal(stringField(afterTabSwitch.id), stringField(beforeTabSwitch.id), 'right pane tab switch should preserve the visible BrowserHostSession');
  assert.equal(afterTabSwitch.singleInteractiveTruth, true);
  assert.ok(host.visualFrame, 'iteration must keep a visual host frame handle');
  return {
    firstSession,
    finalSession: afterTabSwitch,
    tabSwitchSameSession: stringField(afterTabSwitch.id) === stringField(beforeTabSwitch.id),
  };
}

async function navigateToAddressDetailsWithRetry(input: {
  iteration: number;
  page: Page;
  surface: Locator;
  fixtureUrl: string;
  detailsUrl: string;
  expectedWorkbenchUrl: RegExp;
  writerUrl: string;
  workspacePath: string;
  metrics: ProductLongSessionMetrics;
  networkRecorder: ReturnType<typeof recordBrowserHostNetwork>;
  addressDetailsRecovery: AddressDetailsRecoveryEvidence[];
}) {
  const actionSequence: AddressDetailsRecoveryEvidence['actionSequence'] = ['open-url'];
  const firstAttemptCursor = input.networkRecorder.samples.length;
  try {
    await verifyAddressDetailsNavigation({ ...input, shouldOpen: true });
    input.addressDetailsRecovery.push({
      iteration: input.iteration,
      attempted: false,
      status: 'not-needed',
      actionSequence,
      boundedRefs: await collectAddressDetailsRecoveryRefs(input.page, input.networkRecorder.samples.slice(firstAttemptCursor)),
    });
    return;
  } catch (firstError) {
    const firstReason = addressDetailsRecoveryReason(firstError);
    const firstReasonHash = hashText(firstError instanceof Error ? firstError.message : String(firstError));
    actionSequence.push('reload', 'retry-open-url');
    const reloadCursor = input.networkRecorder.samples.length;
    const reloadAck = await attemptAddressDetailsTypedReload(input, reloadCursor);
    const retryCursor = input.networkRecorder.samples.length;
    try {
      await openBrowserPaneUrl(input.surface, input.detailsUrl);
      await verifyAddressDetailsNavigation({ ...input, shouldOpen: false });
      input.addressDetailsRecovery.push({
        iteration: input.iteration,
        attempted: true,
        status: 'succeeded',
        actionSequence,
        reasonCode: firstReason,
        reasonHash: firstReasonHash,
        initialFailure: {
          reasonCode: firstReason,
          reasonHash: firstReasonHash,
        },
        reloadAck,
        boundedRefs: await collectAddressDetailsRecoveryRefs(input.page, input.networkRecorder.samples.slice(retryCursor)),
      });
      return;
    } catch (retryError) {
      const retryReason = addressDetailsRecoveryReason(retryError);
      const retryReasonHash = hashText(retryError instanceof Error ? retryError.message : String(retryError));
      input.addressDetailsRecovery.push({
        iteration: input.iteration,
        attempted: true,
        status: 'blocked',
        actionSequence,
        reasonCode: retryReason,
        reasonHash: retryReasonHash,
        initialFailure: {
          reasonCode: firstReason,
          reasonHash: firstReasonHash,
        },
        reloadAck,
        boundedRefs: await collectAddressDetailsRecoveryRefs(input.page, input.networkRecorder.samples.slice(retryCursor)),
      });
      throw retryError;
    }
  }
}

async function attemptAddressDetailsTypedReload(
  input: {
    iteration: number;
    surface: Locator;
    networkRecorder: ReturnType<typeof recordBrowserHostNetwork>;
  },
  fromIndex: number,
): Promise<NonNullable<AddressDetailsRecoveryEvidence['reloadAck']>> {
  try {
    await clickBrowserCommand(input.surface, 'Reload');
  } catch (error) {
    return {
      status: 'command-unavailable',
      action: 'reload',
      reasonHash: hashText(error instanceof Error ? error.message : String(error)),
    };
  }
  try {
    await input.networkRecorder.waitForAction('reload', fromIndex, 12_000, `address-details recovery reload ${input.iteration}`);
    return {
      status: 'acked',
      action: 'reload',
    };
  } catch (error) {
    return {
      status: 'not-observed',
      action: 'reload',
      reasonHash: hashText(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function collectAddressDetailsRecoveryRefs(
  page: Page,
  networkSamples: BrowserHostNetworkSample[],
): Promise<NonNullable<AddressDetailsRecoveryEvidence['boundedRefs']>> {
  const [snapshot, rightPane] = await Promise.all([
    collectBrowserWorkbenchFailureSnapshot(page).catch(() => undefined),
    collectRightPaneEvidence(page).catch(() => undefined),
  ]);
  const sessionRefs = boundedUnique([
    ...(snapshot?.sessionRefs ?? []),
    ...(rightPane?.sessionIds ?? []).map((id) => `browser-host-session:${id}`),
    ...networkSamples.map((sample) => sample.sessionRef ?? '').filter(Boolean),
  ], 12);
  const liveSurfaceRefs = boundedUnique([
    ...(snapshot?.liveSurfaceRefs ?? []),
    ...(rightPane?.liveSurfaceRefs ?? []),
  ], 12);
  const frameStreamRefs = boundedUnique([
    ...(snapshot?.frameStreamRefs ?? []),
    ...(rightPane?.frameStreamRefs ?? []),
  ], 12);
  return {
    bounded: true,
    noRawUrl: true,
    noRawDom: true,
    workbenchState: snapshot?.state ?? rightPane?.state,
    displayedUrlLength: snapshot?.displayedUrlLength,
    displayedUrlHash: snapshot?.displayedUrlHash,
    addressDraftLength: snapshot?.addressDraftLength,
    addressDraftHash: snapshot?.addressDraftHash,
    hostFrameCount: snapshot?.hostFrameCount ?? rightPane?.hostFrames,
    sessionRefs,
    liveSurfaceRefs,
    frameStreamRefs,
    recentHostStatuses: summarizeCounts(networkSamples.slice(-24).map((sample) => sample.sessionStatus ?? '').filter(Boolean), 12),
    recentLoadingStates: summarizeCounts(networkSamples.slice(-24).map((sample) => sample.loadingProgressState ?? '').filter(Boolean), 12),
    recentLoadingReasons: summarizeCounts(networkSamples.slice(-24).map((sample) => sample.loadingProgressReason ?? '').filter(Boolean), 12),
  };
}

async function verifyAddressDetailsNavigation(input: {
  iteration: number;
  surface: Locator;
  fixtureUrl: string;
  detailsUrl: string;
  expectedWorkbenchUrl: RegExp;
  page: Page;
  writerUrl: string;
  workspacePath: string;
  metrics: ProductLongSessionMetrics;
  shouldOpen: boolean;
}) {
  if (input.shouldOpen) {
    await openBrowserPaneUrl(input.surface, input.detailsUrl);
  }
  await waitForWorkbenchUrl(input.surface, input.expectedWorkbenchUrl);
  await waitForSessionUrl(input.page, input.writerUrl, input.workspacePath, /\/details\?iteration=/, input.metrics, `iteration-${input.iteration}-state-details`);
  await waitForFixtureEvent(
    input.fixtureUrl,
    (event) => event.type === 'page-load' && event.path === '/details' && event.iteration === input.iteration,
    30_000,
    `details page load ${input.iteration}`,
  );
}

function addressDetailsRecoveryReason(error: unknown): NonNullable<AddressDetailsRecoveryEvidence['reasonCode']> {
  const message = error instanceof Error ? error.message : String(error);
  if (/Browser workbench URL/i.test(message)) return 'workbench-url-timeout';
  if (/BrowserHostSession URL/i.test(message)) return 'browser-host-session-url-timeout';
  if (/fixture event/i.test(message)) return 'fixture-event-timeout';
  return 'address-details-retry-timeout';
}

class ProductLongSessionMetrics {
  readonly samples: MetricSample[] = [];

  async measure<T>(
    category: ProductLongSessionMetricCategory,
    label: string,
    task: () => Promise<T>,
    iteration?: number,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      this.add(category, label, Date.now() - startedAt, iteration);
    }
  }

  add(category: ProductLongSessionMetricCategory, label: string, durationMs: number, iteration?: number): void {
    this.samples.push({
      category,
      label,
      durationMs: Math.max(0, Math.round(durationMs)),
      iteration,
    });
  }
}

async function attemptWorkspaceWriterRestart(input: {
  workspaceWriter: ChildProcess | undefined;
  commonEnv: NodeJS.ProcessEnv;
  writerUrl: string;
  workspacePath: string;
  sessionBeforeRestart: JsonRecord;
  metrics: ProductLongSessionMetrics;
}): Promise<{
  child: ChildProcess;
  evidence: WorkspaceWriterRestartEvidence;
  sessionAfterRestart?: JsonRecord;
}> {
  const startedAt = Date.now();
  const previousSessionId = stringField(input.sessionBeforeRestart.id);
  const previousSessionRef = `browser-host-session:${previousSessionId}`;
  let healthDownObserved = false;
  let healthUpObserved = false;
  let child: ChildProcess | undefined;
  let sessionAfterRestart: JsonRecord | undefined;
  let reasonCode: string | undefined;
  let reasonHash: string | undefined;

  await input.metrics.measure('workspace-reconnect', 'workspace-writer-stop', async () => {
    await stopProcess(input.workspaceWriter);
    healthDownObserved = await waitForHttpDown(`${input.writerUrl}/health`, 5_000);
  });

  await input.metrics.measure('workspace-reconnect', 'workspace-writer-restart', async () => {
    child = spawnProcess('npm', ['run', 'workspace:server', '--silent'], input.commonEnv);
    try {
      await waitForHttp(`${input.writerUrl}/health`, 30_000);
      healthUpObserved = true;
    } catch (error) {
      reasonCode = 'workspace-health-timeout';
      reasonHash = hashText(error instanceof Error ? error.message : String(error));
    }
  });
  assert.ok(child, 'workspace writer restart should return a child process');

  if (healthUpObserved) {
    try {
      sessionAfterRestart = await pollBrowserHostSessionState(input.writerUrl, input.workspacePath, previousSessionId, 12_000);
    } catch (error) {
      reasonCode = 'browser-host-session-not-restored-after-writer-restart';
      reasonHash = hashText(error instanceof Error ? error.message : String(error));
    }
  }

  const reconnected = Boolean(sessionAfterRestart && stringField(sessionAfterRestart.id) === previousSessionId);
  return {
    child,
    sessionAfterRestart,
    evidence: {
      status: reconnected ? 'reconnected' : 'blocked',
      attempted: true,
      healthDownObserved,
      healthUpObserved,
      durationMs: Math.max(0, Date.now() - startedAt),
      previousSessionRef,
      sessionAfterRestart: sessionAfterRestart ? browserHostSessionSummary(sessionAfterRestart) : undefined,
      retry: {
        action: 'restart-workspace-writer-same-port-and-poll-existing-session',
        status: reconnected ? 'succeeded' : 'blocked',
        reasonCode: reconnected ? undefined : reasonCode ?? 'browser-host-session-reconnect-unavailable',
        reasonHash: reconnected ? undefined : reasonHash ?? hashText('browser-host-session-reconnect-unavailable'),
      },
    },
  };
}

async function ensureBrowserPane(page: Page) {
  const tab = page.locator('.result-page-tab', { hasText: 'Browser' }).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('.result-new-tab-button').click();
    await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
    await page.locator('.result-page-tab', { hasText: 'Browser' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.result-page-tab', { hasText: 'Browser' }).click();
  }
  await page.getByTestId('right-pane-browser-tool').waitFor({ state: 'visible', timeout: 20_000 });
}

async function activateRightPaneTab(page: Page, label: 'Browser' | 'Results') {
  const tab = page.locator('.result-page-tab', { hasText: label }).first();
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  await tab.click();
  await page.waitForFunction((expectedLabel) => {
    const selected = document.querySelector<HTMLElement>('.result-page-tab[aria-selected="true"]');
    return selected?.textContent?.includes(expectedLabel) === true;
  }, label, { timeout: 10_000 });
}

async function openBrowserPaneUrl(surface: Locator, url: string) {
  const address = surface.locator('input[aria-label="Browser URL"]');
  await address.fill(url);
  await address.press('Enter');
}

async function waitForKeyboardHostFrame(
  surface: Locator,
  label: string,
  metrics: ProductLongSessionMetrics,
  iteration?: number,
) {
  const frame = surface.locator('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]').first();
  await frame.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await frame.getAttribute('data-browser-host-keyboard-path'), 'hidden-input');
  assert.ok(await frame.getAttribute('data-browser-host-keyboard-focus-key'), 'host frame must expose a stable keyboard focus key');
  const hiddenInput = frame.locator('.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]').first();
  assert.ok(await hiddenInput.count(), 'BrowserHostSession host frame must include hidden keyboard input');
  let visualFrame = frame.locator('canvas[data-browser-host-surface="browser-host-session"]').first();
  if (!await visualFrame.count()) {
    visualFrame = frame.locator('img[data-browser-host-surface="browser-host-session"]').first();
  }
  await visualFrame.waitFor({ state: 'visible', timeout: 30_000 });
  await waitForFrameCaptureReady(surface, label, metrics, iteration);
  assert.equal(await visualFrame.getAttribute('data-browser-frame-transport'), 'websocket-binary');
  return { frame, visualFrame };
}

async function waitForFrameCaptureReady(
  surface: Locator,
  label: string,
  metrics: ProductLongSessionMetrics,
  iteration?: number,
) {
  await metrics.measure('frame-capture', label, async () => {
    await surface.page().waitForFunction(() => {
      const canvas = document.querySelector('.right-pane-browser-surface canvas[data-browser-host-surface="browser-host-session"]');
      if (canvas instanceof HTMLCanvasElement) return canvas.width > 0 && canvas.height > 0;
      const img = document.querySelector('.right-pane-browser-surface img[data-browser-host-surface="browser-host-session"]');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    }, undefined, { timeout: 30_000 });
  }, iteration);
}

async function waitForWorkbenchUrl(surface: Locator, expectedUrl: RegExp) {
  try {
    await surface.page().waitForFunction(({ source, flags }) => {
      const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
      const state = viewer?.getAttribute('data-browser-state');
      const url = viewer?.querySelector('header p')?.textContent ?? '';
      const hostFrame = document.querySelector<HTMLElement>('.right-pane-browser-surface .browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]');
      const liveSurfaceRef = hostFrame?.getAttribute('data-browser-live-surface-ref') ?? '';
      const frameStreamRef = hostFrame?.getAttribute('data-browser-frame-stream-ref') ?? '';
      const keyboardPath = hostFrame?.getAttribute('data-browser-host-keyboard-path') ?? '';
      const hostSurfaceReady = liveSurfaceRef.startsWith('browser-host-session:')
        && frameStreamRef.startsWith('browser-host-session:')
        && keyboardPath === 'hidden-input';
      return (state === 'ready' || state === 'loading' && hostSurfaceReady) && new RegExp(source, flags).test(url);
    }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 45_000 });
  } catch (error) {
    const snapshot = await collectBrowserWorkbenchFailureSnapshot(surface.page()).catch(() => undefined);
    throw new Error(`Timed out waiting for Browser workbench URL ${JSON.stringify({
      expectedPatternHash: hashText(expectedUrl.source),
      expectedFlags: expectedUrl.flags,
      snapshot,
      causeHash: hashText(error instanceof Error ? error.message : String(error)),
    })}`);
  }
}

async function clickHostPoint(page: Page, hostFrame: Locator, x: number, y: number) {
  const box = await hostFrame.boundingBox();
  assert.ok(box, 'BrowserHostSession frame must expose visible bounds');
  await page.mouse.click(Math.round(box.x + x), Math.round(box.y + y));
}

async function dragHostPoints(page: Page, hostFrame: Locator, points: Array<{ x: number; y: number }>) {
  assert.ok(points.length >= 2, 'drag needs at least two points');
  const box = await hostFrame.boundingBox();
  assert.ok(box, 'BrowserHostSession frame must expose visible bounds for drag');
  const [first, ...rest] = points;
  await page.mouse.move(Math.round(box.x + first.x), Math.round(box.y + first.y));
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(Math.round(box.x + point.x), Math.round(box.y + point.y));
    await delay(60);
  }
  await page.mouse.up();
}

async function dispatchHostPointerDrag(hostFrame: Locator, points: Array<{ x: number; y: number }>) {
  assert.ok(points.length >= 2, 'synthetic host drag needs at least two points');
  const box = await hostFrame.boundingBox();
  assert.ok(box, 'BrowserHostSession frame must expose visible bounds for fallback drag');
  const [first, ...rest] = points;
  const eventPoint = (point: { x: number; y: number }, buttons: number) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 7,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons,
    clientX: Math.round(box.x + point.x),
    clientY: Math.round(box.y + point.y),
  });
  await hostFrame.dispatchEvent('pointerdown', eventPoint(first, 1));
  for (const point of rest) {
    await hostFrame.dispatchEvent('pointermove', eventPoint(point, 1));
    await delay(30);
  }
  await hostFrame.dispatchEvent('pointerup', eventPoint(rest[rest.length - 1] ?? first, 0));
}

async function clickBrowserCommand(surface: Locator, label: 'Back' | 'Forward' | 'Reload') {
  const commandId = label.toLowerCase();
  const page = surface.page();
  await page.waitForFunction((id) => {
    const button = document.querySelector<HTMLButtonElement>(`.right-pane-browser-surface .browser-workbench-viewer-actions button[data-browser-command-id="${id}"]`);
    return Boolean(button && !button.disabled);
  }, commandId, { timeout: 20_000 });
  await page.evaluate((id) => {
    const button = document.querySelector<HTMLButtonElement>(`.right-pane-browser-surface .browser-workbench-viewer-actions button[data-browser-command-id="${id}"]`);
    if (!button || button.disabled) throw new Error(`Browser command is not available: ${id}`);
    button.click();
  }, commandId);
}

async function waitForDragRouteEvidence(
  fixtureUrl: string,
  iteration: number,
  networkRecorder: ReturnType<typeof recordBrowserHostNetwork>,
  fromIndex: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await networkRecorder.drain();
    const networkEvidence = networkRecorder.samples
      .slice(fromIndex)
      .some((sample) => ['mouse-up', 'drag', 'cursor', 'mouse-move'].includes(sample.action ?? '') && sample.status < 500);
    if (networkEvidence) return;
    const events = await fetchFixtureEvents(fixtureUrl);
    const fixtureEvidence = events.some((event) => (
      event.iteration === iteration
        && (event.type === 'product-drag-up' || event.type === 'product-pointer-move')
    ));
    if (fixtureEvidence) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for drag route evidence for iteration ${iteration}`);
}

async function currentBrowserHostSession(
  page: Page,
  writerUrl: string,
  workspacePath: string,
  metrics: ProductLongSessionMetrics,
  label: string,
): Promise<JsonRecord> {
  return metrics.measure('state-polling', label, async () => {
    const liveSurfaceRef = await page.locator('.right-pane-browser-surface [data-browser-live-surface-ref^="browser-host-session:"]').first().getAttribute('data-browser-live-surface-ref');
    const sessionId = /^browser-host-session:([^/]+)\//.exec(liveSurfaceRef ?? '')?.[1];
    assert.ok(sessionId, `Missing BrowserHostSession ref: ${String(liveSurfaceRef)}`);
    return fetchBrowserHostSessionState(writerUrl, workspacePath, sessionId);
  });
}

async function fetchBrowserHostSessionState(writerUrl: string, workspacePath: string, sessionId: string): Promise<JsonRecord> {
  const url = new URL(`${writerUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/state`);
  url.searchParams.set('workspacePath', workspacePath);
  const json = await fetchJson(url.href);
  const session = recordField(json.session);
  assert.ok(session, 'BrowserHostSession state response must include session');
  return session;
}

async function pollBrowserHostSessionState(
  writerUrl: string,
  workspacePath: string,
  sessionId: string,
  timeoutMs: number,
): Promise<JsonRecord> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const session = await fetchBrowserHostSessionState(writerUrl, workspacePath, sessionId);
      if (stringField(session.id) === sessionId) return session;
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Timed out polling restored BrowserHostSession: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForSessionUrl(
  page: Page,
  writerUrl: string,
  workspacePath: string,
  pattern: RegExp,
  metrics: ProductLongSessionMetrics,
  label: string,
): Promise<JsonRecord> {
  const deadline = Date.now() + 30_000;
  let lastHash = '';
  while (Date.now() < deadline) {
    const session = await currentBrowserHostSession(page, writerUrl, workspacePath, metrics, label);
    const url = stringField(session.url);
    lastHash = hashText(url);
    if (pattern.test(url)) return session;
    await delay(250);
  }
  throw new Error(`Timed out waiting for BrowserHostSession URL ${pattern}: lastHash=${lastHash}`);
}

async function installRightPaneObserver(page: Page) {
  await page.evaluate(`
  (() => {
    const surface = document.querySelector('.right-pane-browser-surface');
    if (!surface) throw new Error('Missing right-pane browser surface for product long-session observer');
    if (window.__sciforgeBrowserPaneProductLongSession && window.__sciforgeBrowserPaneProductLongSession.observer) {
      window.__sciforgeBrowserPaneProductLongSession.observer.disconnect();
    }
    const state = {
      mutationCount: 0,
      attachChanges: 0,
      detachChanges: 0,
      maxHostFrames: 0,
      lastHostFrameSignature: '',
      sessionIds: [],
      liveSurfaceRefs: [],
      frameStreamRefs: [],
      renderers: [],
      browserStates: [],
      browserStateCounts: {},
      browserStateTransitions: [],
      browserStateSampleCount: 0,
      lastBrowserState: '',
      hiddenKeyboardFocusKeys: [],
      objectUrlCreateCount: 0,
      objectUrlRevokeCount: 0,
      objectUrlLiveEstimate: 0,
      objectUrlMaxLiveEstimate: 0,
    };
    const urlCtor = window.URL || window.webkitURL;
    if (urlCtor && !urlCtor.__sciforgeBrowserPaneProductLongSessionWrapped) {
      const originalCreateObjectURL = urlCtor.createObjectURL && urlCtor.createObjectURL.bind(urlCtor);
      const originalRevokeObjectURL = urlCtor.revokeObjectURL && urlCtor.revokeObjectURL.bind(urlCtor);
      if (originalCreateObjectURL) {
        urlCtor.createObjectURL = function(value) {
          const objectUrl = originalCreateObjectURL(value);
          state.objectUrlCreateCount += 1;
          state.objectUrlLiveEstimate += 1;
          state.objectUrlMaxLiveEstimate = Math.max(state.objectUrlMaxLiveEstimate, state.objectUrlLiveEstimate);
          return objectUrl;
        };
      }
      if (originalRevokeObjectURL) {
        urlCtor.revokeObjectURL = function(value) {
          state.objectUrlRevokeCount += 1;
          state.objectUrlLiveEstimate = Math.max(0, state.objectUrlLiveEstimate - 1);
          return originalRevokeObjectURL(value);
        };
      }
      Object.defineProperty(urlCtor, '__sciforgeBrowserPaneProductLongSessionWrapped', {
        value: true,
        configurable: false,
        enumerable: false,
      });
    }
    function pushUnique(values, value) {
      if (value && !values.includes(value) && values.length < 48) values.push(value);
    }
    function collect() {
      const currentSurface = document.querySelector('.right-pane-browser-surface');
      if (!currentSurface) return;
      const frames = Array.from(currentSurface.querySelectorAll('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]'));
      const liveRefs = [];
      for (const frame of frames) {
        const liveRef = frame.getAttribute('data-browser-live-surface-ref') || '';
        if (liveRef) liveRefs.push(liveRef);
      }
      const signature = liveRefs.join('|');
      if (signature && signature !== state.lastHostFrameSignature) state.attachChanges += 1;
      if (!signature && state.lastHostFrameSignature) state.detachChanges += 1;
      state.lastHostFrameSignature = signature;
      state.maxHostFrames = Math.max(state.maxHostFrames, frames.length);
      for (const frame of frames) {
        const liveRef = frame.getAttribute('data-browser-live-surface-ref') || '';
        let sessionId = '';
        if (liveRef.indexOf('browser-host-session:') === 0) {
          const rest = liveRef.slice('browser-host-session:'.length);
          const slashIndex = rest.indexOf('/');
          sessionId = slashIndex >= 0 ? rest.slice(0, slashIndex) : rest;
        }
        pushUnique(state.sessionIds, sessionId);
        pushUnique(state.liveSurfaceRefs, liveRef);
        pushUnique(state.frameStreamRefs, frame.getAttribute('data-browser-frame-stream-ref') || '');
        pushUnique(state.renderers, frame.getAttribute('data-browser-frame-renderer') || 'image-blob');
        pushUnique(state.hiddenKeyboardFocusKeys, frame.getAttribute('data-browser-host-keyboard-focus-key') || '');
      }
      const viewer = currentSurface.querySelector('.browser-workbench-viewer');
      const browserState = viewer ? viewer.getAttribute('data-browser-state') || '' : '';
      pushUnique(state.browserStates, browserState);
      if (browserState) {
        state.browserStateCounts[browserState] = (state.browserStateCounts[browserState] || 0) + 1;
        state.browserStateSampleCount += 1;
        if (state.lastBrowserState && state.lastBrowserState !== browserState && state.browserStateTransitions.length < 24) {
          state.browserStateTransitions.push(state.lastBrowserState + '->' + browserState);
        }
        state.lastBrowserState = browserState;
      }
    }
    collect();
    const observer = new MutationObserver(() => {
      state.mutationCount += 1;
      collect();
    });
    observer.observe(surface, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-browser-live-surface-ref',
        'data-browser-frame-stream-ref',
        'data-browser-frame-renderer',
        'data-browser-host-keyboard-focus-key',
        'data-browser-state',
        'src',
      ],
    });
    window.__sciforgeBrowserPaneProductLongSession = { state, observer };
  })()
  `);
}

async function collectRightPaneEvidence(page: Page): Promise<RightPaneBoundedEvidence> {
  return page.evaluate(`
  (() => {
    const root = document.querySelector('.right-pane-browser-surface');
    const observerState = window.__sciforgeBrowserPaneProductLongSession && window.__sciforgeBrowserPaneProductLongSession.state;
    const attrs = [];
    for (const node of Array.from(root ? root.querySelectorAll('*') : [])) {
      for (const attribute of Array.from(node.attributes)) {
        attrs.push({ name: attribute.name, value: attribute.value });
      }
    }
    const attrValues = (name) => Array.from(new Set(attrs
      .filter((attr) => attr.name === name)
      .map((attr) => attr.value)
      .filter(Boolean))).sort();
    const count = (selector) => root ? root.querySelectorAll(selector).length : 0;
    const performanceWithMemory = performance;
    const liveSurfaceRefs = attrValues('data-browser-live-surface-ref');
    const frameStreamRefs = attrValues('data-browser-frame-stream-ref');
    const renderers = attrValues('data-browser-frame-renderer');
    const hiddenKeyboardFocusKeys = attrValues('data-browser-host-keyboard-focus-key');
    const sessionIds = Array.from(new Set(liveSurfaceRefs.flatMap((ref) => {
      if (ref.indexOf('browser-host-session:') !== 0) return [];
      const rest = ref.slice('browser-host-session:'.length);
      const slashIndex = rest.indexOf('/');
      return [slashIndex >= 0 ? rest.slice(0, slashIndex) : rest];
    }).filter(Boolean))).sort();
    return {
      state: (root && root.querySelector('.browser-workbench-viewer') && root.querySelector('.browser-workbench-viewer').getAttribute('data-browser-state')) || '',
      mutationCount: observerState ? observerState.mutationCount : 0,
      attachChanges: observerState ? observerState.attachChanges : 0,
      detachChanges: observerState ? observerState.detachChanges : 0,
      maxHostFrames: observerState ? observerState.maxHostFrames : count('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]'),
      sessionIds: sessionIds.length ? sessionIds : (observerState ? observerState.sessionIds : []),
      liveSurfaceRefs: liveSurfaceRefs.length ? liveSurfaceRefs : (observerState ? observerState.liveSurfaceRefs : []),
      frameStreamRefs: frameStreamRefs.length ? frameStreamRefs : (observerState ? observerState.frameStreamRefs : []),
      renderers: renderers.length ? renderers : (observerState ? observerState.renderers : []),
      browserStates: observerState ? observerState.browserStates : [],
      browserStateCounts: observerState ? observerState.browserStateCounts : {},
      browserStateTransitions: observerState ? observerState.browserStateTransitions : [],
      browserStateSampleCount: observerState ? observerState.browserStateSampleCount : 0,
      hiddenKeyboardFocusKeys: hiddenKeyboardFocusKeys.length ? hiddenKeyboardFocusKeys : (observerState ? observerState.hiddenKeyboardFocusKeys : []),
      hostFrames: count('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]'),
      canvasSurfaces: count('canvas[data-browser-host-surface="browser-host-session"]'),
      imageSurfaces: count('img[data-browser-host-surface="browser-host-session"]'),
      nativeSurfaces: count('[data-browser-native-surface="true"]'),
      iframeSurfaces: count('iframe'),
      proxySurfaces: count('iframe[src*="/api/sciforge/browser/proxy"], [data-browser-state-action="proxy-fallback"]'),
      webviewSurfaces: count('webview'),
      systemPopupSurfaces: count('[data-browser-host-surface="system-browser-window"], [data-browser-live-surface-transport="system-popup"]'),
      dataImageSurfaces: count('img[src^="data:"]'),
      base64Attributes: attrs.filter((attr) => /base64|;base64,/i.test(attr.value)).length,
      approxJsHeapUsed: performanceWithMemory.memory && typeof performanceWithMemory.memory.usedJSHeapSize === 'number'
        ? Math.round(performanceWithMemory.memory.usedJSHeapSize)
        : undefined,
      objectUrls: {
        createCount: observerState ? observerState.objectUrlCreateCount : 0,
        revokeCount: observerState ? observerState.objectUrlRevokeCount : 0,
        liveEstimate: observerState ? Math.max(0, observerState.objectUrlLiveEstimate) : 0,
        maxLiveEstimate: observerState ? Math.max(0, observerState.objectUrlMaxLiveEstimate) : 0,
        revokeDeficit: observerState ? Math.max(0, observerState.objectUrlCreateCount - observerState.objectUrlRevokeCount) : 0,
      },
    };
  })()
  `) as Promise<RightPaneBoundedEvidence>;
}

async function collectBrowserWorkbenchFailureSnapshot(page: Page): Promise<BrowserWorkbenchFailureSnapshot> {
  const snapshot = await page.evaluate(() => {
    const root = document.querySelector('.right-pane-browser-surface');
    const viewer = root?.querySelector('.browser-workbench-viewer');
    const headerUrl = viewer?.querySelector('header p')?.textContent ?? '';
    const address = root?.querySelector<HTMLInputElement>('input[aria-label="Browser URL"]')?.value ?? '';
    const liveSurfaceRefs = Array.from(root?.querySelectorAll('[data-browser-live-surface-ref]') ?? [])
      .map((element) => element.getAttribute('data-browser-live-surface-ref') ?? '')
      .filter(Boolean);
    const frameStreamRefs = Array.from(root?.querySelectorAll('[data-browser-frame-stream-ref]') ?? [])
      .map((element) => element.getAttribute('data-browser-frame-stream-ref') ?? '')
      .filter(Boolean);
    const availability = (id: string) => {
      const button = root?.querySelector<HTMLButtonElement>(`.browser-workbench-viewer-actions button[data-browser-command-id="${id}"]`);
      if (!button) return 'missing';
      return button.disabled ? 'disabled' : 'enabled';
    };
    return {
      hasViewer: Boolean(viewer),
      state: viewer?.getAttribute('data-browser-state') ?? '',
      headerUrl,
      address,
      liveSurfaceRefs: Array.from(new Set(liveSurfaceRefs)).slice(0, 12),
      frameStreamRefs: Array.from(new Set(frameStreamRefs)).slice(0, 12),
      hostFrameCount: root?.querySelectorAll('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]').length ?? 0,
      hiddenKeyboardActive: Boolean(root?.querySelector('.browser-workbench-host-keyboard-input[data-browser-host-keyboard-focus="active"]')),
      commandAvailability: {
        back: availability('back'),
        forward: availability('forward'),
        reload: availability('reload'),
      },
    };
  });
  const liveSurfaceRefs = boundedUnique(snapshot.liveSurfaceRefs, 12);
  return {
    hasViewer: snapshot.hasViewer,
    state: snapshot.state,
    displayedUrlLength: snapshot.headerUrl.length,
    displayedUrlHash: snapshot.headerUrl ? hashText(snapshot.headerUrl) : undefined,
    addressDraftLength: snapshot.address.length,
    addressDraftHash: snapshot.address ? hashText(snapshot.address) : undefined,
    liveSurfaceRefs,
    sessionRefs: boundedUnique(liveSurfaceRefs.flatMap((ref) => {
      const match = /^browser-host-session:([^/]+)/.exec(ref);
      return match ? [`browser-host-session:${match[1]}`] : [];
    }), 12),
    frameStreamRefs: boundedUnique(snapshot.frameStreamRefs, 12),
    hostFrameCount: snapshot.hostFrameCount,
    hiddenKeyboardActive: snapshot.hiddenKeyboardActive,
    commandAvailability: {
      back: snapshot.commandAvailability.back as BrowserWorkbenchFailureSnapshot['commandAvailability']['back'],
      forward: snapshot.commandAvailability.forward as BrowserWorkbenchFailureSnapshot['commandAvailability']['forward'],
      reload: snapshot.commandAvailability.reload as BrowserWorkbenchFailureSnapshot['commandAvailability']['reload'],
    },
  };
}

function recordBrowserHostNetwork(page: Page, metrics: ProductLongSessionMetrics): {
  samples: BrowserHostNetworkSample[];
  waitForAction(action: string, fromIndex: number, timeoutMs: number, label: string): Promise<BrowserHostNetworkSample>;
  drain(): Promise<void>;
} {
  const requestStartedAt = new WeakMap<Request, number>();
  const samples: BrowserHostNetworkSample[] = [];
  const pending = new Set<Promise<void>>();
  page.on('request', (request) => {
    if (browserHostEndpoint(request.url())) requestStartedAt.set(request, Date.now());
  });
  page.on('response', (response: Response) => {
    const endpoint = browserHostEndpoint(response.url());
    if (!endpoint) return;
    const startedAt = requestStartedAt.get(response.request());
    if (startedAt === undefined) return;
    const durationMs = Date.now() - startedAt;
    const task = response.text()
      .then((text) => {
        const json = parseJsonRecord(text);
        const sample = boundedBrowserHostNetworkSample(endpoint, response.status(), durationMs, json);
        samples.push(sample);
        const category = networkMetricCategory(sample);
        if (category) metrics.add(category, `${sample.endpoint}:${sample.action ?? 'request'}`, sample.durationMs);
      })
      .catch(() => {
        samples.push({ endpoint, status: response.status(), durationMs: Math.round(durationMs) });
      });
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  return {
    samples,
    async waitForAction(action: string, fromIndex: number, timeoutMs: number, label: string) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await Promise.allSettled([...pending]);
        const sample = samples.slice(fromIndex).find((entry) => entry.action === action && entry.status < 500);
        if (sample) return sample;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${label}; seen=${JSON.stringify(samples.slice(fromIndex).map((sample) => ({
        endpoint: sample.endpoint,
        action: sample.action,
        status: sample.status,
        durationMs: sample.durationMs,
      })).slice(-24))}`);
    },
    async drain() {
      await Promise.allSettled([...pending]);
    },
  };
}

function recordFrameStreamStats(page: Page, metrics: ProductLongSessionMetrics): { stats: FrameStreamStats } {
  const stats: FrameStreamStats = {
    streamsOpened: 0,
    framesReceived: 0,
    binaryFramesReceived: 0,
    maxPayloadBytes: 0,
  };
  page.on('websocket', (socket: PlaywrightWebSocket) => {
    if (!socket.url().includes('/api/sciforge/browser-host/sessions/') || !socket.url().includes('/frame-stream')) return;
    const openedAt = Date.now();
    stats.streamsOpened += 1;
    socket.on('framereceived', (event) => {
      const payload = event.payload;
      const bytes = typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
      stats.framesReceived += 1;
      stats.maxPayloadBytes = Math.max(stats.maxPayloadBytes, bytes);
      if (typeof payload !== 'string') stats.binaryFramesReceived += 1;
      if (stats.firstFrameLatencyMs === undefined) {
        stats.firstFrameLatencyMs = Date.now() - openedAt;
        metrics.add('frame-capture', 'websocket-first-frame', stats.firstFrameLatencyMs);
      }
    });
  });
  return { stats };
}

function browserHostEndpoint(url: string): BrowserHostNetworkSample['endpoint'] | undefined {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/sciforge/browser-host/sessions/start') return 'start';
  const match = /^\/api\/sciforge\/browser-host\/sessions\/[^/]+\/(state|actions|computer-use-actions|frame)$/.exec(parsed.pathname);
  if (!match) return undefined;
  if (match[1] === 'actions') return 'session-action';
  if (match[1] === 'computer-use-actions') return 'computer-use-action';
  if (match[1] === 'state') return 'state';
  return 'frame';
}

function boundedBrowserHostNetworkSample(
  endpoint: BrowserHostNetworkSample['endpoint'],
  status: number,
  durationMs: number,
  json: JsonRecord,
): BrowserHostNetworkSample {
  const result = recordField(json.result);
  const hostAction = recordField(result?.hostAction);
  const session = recordField(json.session) ?? recordField(result?.session);
  const timing = recordField(session?.lastActionTiming);
  const loadingProgress = recordField(session?.loadingProgress);
  const action = stringField(hostAction?.action) || stringField(timing?.action);
  const text = stringField(hostAction?.text);
  const sessionId = stringField(session?.id);
  const requestedUrl = stringField(session?.requestedUrl);
  const currentUrl = stringField(session?.url);
  const finalUrl = stringField(session?.finalUrl);
  return {
    endpoint,
    status,
    durationMs: Math.round(durationMs),
    sessionRef: sessionId ? `browser-host-session:${sessionId}` : undefined,
    sessionStatus: stringField(session?.status) || undefined,
    action: action || undefined,
    key: action === 'press' ? stringField(hostAction?.key) || undefined : undefined,
    textLength: action === 'type' ? text.length : undefined,
    textHash: action === 'type' ? hashText(text) : undefined,
    capture: stringField(timing?.capture) || undefined,
    paintAckSource: stringField(timing?.paintAckSource) || undefined,
    loadingProgressState: stringField(loadingProgress?.state) || undefined,
    loadingProgressReason: stringField(loadingProgress?.reason) || undefined,
    loadingProgressSource: stringField(loadingProgress?.source) || undefined,
    requestedUrlLength: requestedUrl?.length,
    requestedUrlHash: requestedUrl ? hashText(requestedUrl) : undefined,
    currentUrlLength: currentUrl?.length,
    currentUrlHash: currentUrl ? hashText(currentUrl) : undefined,
    finalUrlLength: finalUrl?.length,
    finalUrlHash: finalUrl ? hashText(finalUrl) : undefined,
  };
}

function networkMetricCategory(sample: BrowserHostNetworkSample): ProductLongSessionMetricCategory | undefined {
  if (sample.endpoint === 'start') return 'navigation';
  if (sample.endpoint === 'state') return 'state-polling';
  if (sample.endpoint === 'session-action' && ['navigate'].includes(sample.action ?? '')) return 'navigation';
  if (sample.endpoint === 'session-action' && ['back', 'forward', 'reload'].includes(sample.action ?? '')) return 'history-reload';
  if (sample.endpoint === 'computer-use-action' && ['type', 'press'].includes(sample.action ?? '')) return 'input-routing';
  if (sample.endpoint === 'computer-use-action' && sample.action === 'scroll') return 'scroll-routing';
  if (sample.endpoint === 'computer-use-action' && ['cursor', 'drag', 'mouse-down', 'mouse-move', 'mouse-up'].includes(sample.action ?? '')) return 'drag-routing';
  return undefined;
}

function buildProductLongSessionManifest(input: {
  config: ProductLongSessionConfig;
  runId: string;
  fixtureOrigin: string;
  durationMs: number;
  iterationsCompleted: number;
  firstSession: JsonRecord;
  sessionBeforeWorkspaceRestart: JsonRecord;
  sessionAfterWorkspaceRestart?: JsonRecord;
  rightPaneInitial?: RightPaneBoundedEvidence;
  rightPaneBeforeRestart: RightPaneBoundedEvidence;
  rightPaneAfterRestart?: RightPaneBoundedEvidence;
  events: ProductFixtureEvent[];
  metrics: MetricSample[];
  networkSamples: BrowserHostNetworkSample[];
  frameStream: FrameStreamStats;
  restartEvidence: WorkspaceWriterRestartEvidence;
  tabSwitchContinuity: boolean[];
  addressDetailsRecovery: AddressDetailsRecoveryEvidence[];
  diagnostics: ReturnType<typeof recordPageDiagnostics>;
}): ProductLongSessionManifest {
  const inputEvents = input.events.filter((event) => event.type === 'product-input');
  const inputLengths = inputEvents.map((event) => event.valueLength ?? 0).filter(Boolean);
  const scrollEvents = input.events.filter((event) => event.type === 'product-scroll');
  const dragEvents = input.events.filter((event) => event.type === 'product-pointer-move' || event.type === 'product-drag-up');
  const browserHostActions = boundedUnique(input.networkSamples.map((sample) => sample.action ?? '').filter(Boolean), 32);
  const browserHostRouteActions = boundedUnique(input.networkSamples
    .filter((sample) => sample.endpoint === 'computer-use-action')
    .map((sample) => sample.action ?? '')
    .filter(Boolean), 32);
  const first = browserHostSessionSummary(input.firstSession);
  const beforeRestart = browserHostSessionSummary(input.sessionBeforeWorkspaceRestart);
  const afterRestart = input.sessionAfterWorkspaceRestart ? browserHostSessionSummary(input.sessionAfterWorkspaceRestart) : undefined;
  const observedSessionRefs = boundedUnique([
    `browser-host-session:${first.id}`,
    `browser-host-session:${beforeRestart.id}`,
    ...(afterRestart ? [`browser-host-session:${afterRestart.id}`] : []),
    ...input.rightPaneBeforeRestart.sessionIds.map((id) => `browser-host-session:${id}`),
    ...input.networkSamples.map((sample) => sample.sessionRef ?? '').filter(Boolean),
  ].filter((value) => value !== 'browser-host-session:'));
  return {
    schemaVersion: PRODUCT_LONG_SESSION_SCHEMA,
    status: 'passed',
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    runner: {
      mode: input.config.mode,
      requestedMinutes: input.config.requestedMinutes,
      requestedIterations: input.config.requestedIterations,
      iterationsCompleted: input.iterationsCompleted,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      defaultSmokeIsThirtyMinuteBenchmark: false,
      extensionEnv: {
        minutes: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES',
        iterations: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS',
      },
    },
    interactionCoverage: {
      classes: [
        'continuous-navigation',
        'continuous-input',
        'long-page-scroll',
        'drag-mouse-route',
        'history-back-forward-reload',
        'right-pane-tab-switch',
        'workspace-writer-restart-reconnect',
      ],
      fixtureEventTypes: boundedUnique(input.events.map((event) => event.type), 32),
      fixturePaths: boundedUnique(input.events.map((event) => event.path), 12),
      browserHostActions,
      typedInput: {
        iterations: boundedUnique(inputEvents.map((event) => event.iteration ?? -1).filter((value) => value >= 0)).length,
        lengthRange: [
          Math.min(...inputLengths),
          Math.max(...inputLengths),
        ],
        hashes: boundedUnique(inputEvents.map((event) => event.valueHash ?? '').filter(Boolean), 24),
      },
      scroll: {
        maxScrollY: Math.max(0, ...scrollEvents.map((event) => event.maxScrollY ?? 0)),
        eventCount: scrollEvents.length,
      },
      drag: {
        fixturePointerEvents: dragEvents.length,
        browserHostRouteActions,
      },
    },
    browserHostSession: {
      first,
      beforeWorkspaceRestart: beforeRestart,
      afterWorkspaceRestart: afterRestart,
    },
    continuity: {
      sameSessionBeforeRestart: first.id === beforeRestart.id,
      singleBrowserHostSessionBeforeRestart: input.rightPaneBeforeRestart.sessionIds.length === 1,
      tabSwitchSameSession: input.tabSwitchContinuity.every(Boolean),
      firstSessionRef: `browser-host-session:${first.id}`,
      finalSessionRef: `browser-host-session:${beforeRestart.id}`,
      observedSessionRefs,
      maxHostFrames: input.rightPaneBeforeRestart.maxHostFrames,
      singleInteractiveTruth: beforeRestart.singleInteractiveTruth,
    },
    boundedMetrics: {
      latencySummary: summarizeLatency(input.metrics),
      networkSamples: boundedNetworkSamples(input.networkSamples, 24),
      frameStream: input.frameStream,
      loadingProgressLifecycle: summarizeLoadingProgressLifecycle(input.rightPaneBeforeRestart, input.rightPaneAfterRestart, input.networkSamples),
      memoryishCounts: {
        fixtureEventCount: input.events.length,
        networkSampleCount: input.networkSamples.length,
        frameStreamFrameCount: input.frameStream.framesReceived,
        rightPaneMutationCountBeforeRestart: input.rightPaneBeforeRestart.mutationCount,
        rightPaneMutationCountAfterRestart: input.rightPaneAfterRestart?.mutationCount ?? 0,
        rightPaneSessionRefCount: input.rightPaneBeforeRestart.sessionIds.length,
        approxJsHeapUsedBeforeRestart: input.rightPaneBeforeRestart.approxJsHeapUsed,
        approxJsHeapUsedAfterRestart: input.rightPaneAfterRestart?.approxJsHeapUsed,
        approxJsHeapDeltaBeforeRestart: heapDelta(input.rightPaneInitial, input.rightPaneBeforeRestart),
        objectUrlCreateCountBeforeRestart: input.rightPaneBeforeRestart.objectUrls.createCount,
        objectUrlRevokeCountBeforeRestart: input.rightPaneBeforeRestart.objectUrls.revokeCount,
        objectUrlLiveEstimateBeforeRestart: input.rightPaneBeforeRestart.objectUrls.liveEstimate,
        objectUrlMaxLiveEstimateBeforeRestart: input.rightPaneBeforeRestart.objectUrls.maxLiveEstimate,
        objectUrlRevokeDeficitBeforeRestart: input.rightPaneBeforeRestart.objectUrls.revokeDeficit,
      },
      rightPaneBeforeRestart: input.rightPaneBeforeRestart,
      rightPaneAfterRestart: input.rightPaneAfterRestart,
    },
    failureRetry: {
      addressDetailsRecovery: {
        attemptedIterations: input.addressDetailsRecovery
          .filter((entry) => entry.attempted)
          .map((entry) => entry.iteration)
          .slice(-24),
        outcomeCount: input.addressDetailsRecovery.length,
        outcomes: input.addressDetailsRecovery.slice(-12),
      },
      workspaceWriterRestart: input.restartEvidence,
      pageDiagnostics: {
        pageErrorCount: input.diagnostics.errors.length,
        consoleErrorCount: input.diagnostics.consoleErrors.length,
        recentPageErrorHashes: input.diagnostics.errors.slice(-6).map(hashText),
        recentConsoleErrorHashes: input.diagnostics.consoleErrors.slice(-6).map(hashText),
      },
    },
    forbiddenEvidence: {
      rawDom: false,
      base64: false,
      rawScreenshot: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      fixtureHostRaw: false,
      defaultSmokeClaimsThirtyMinutes: false,
    },
    verificationCommand: productLongSessionVerificationCommand(input.config),
  };
}

function boundedNetworkSamples(samples: BrowserHostNetworkSample[], limit: number): BrowserHostNetworkSample[] {
  return samples.slice(-Math.max(0, limit)).map((sample) => ({
    endpoint: sample.endpoint,
    status: sample.status,
    durationMs: Math.max(0, Math.round(sample.durationMs)),
    sessionRef: sample.sessionRef,
    sessionStatus: sample.sessionStatus,
    action: sample.action,
    key: sample.key,
    textLength: sample.textLength,
    textHash: sample.textHash,
    capture: sample.capture,
    paintAckSource: sample.paintAckSource,
    loadingProgressState: sample.loadingProgressState,
    loadingProgressReason: sample.loadingProgressReason,
    loadingProgressSource: sample.loadingProgressSource,
    requestedUrlLength: sample.requestedUrlLength,
    requestedUrlHash: sample.requestedUrlHash,
    currentUrlLength: sample.currentUrlLength,
    currentUrlHash: sample.currentUrlHash,
    finalUrlLength: sample.finalUrlLength,
    finalUrlHash: sample.finalUrlHash,
  }));
}

function assertProductLongSessionManifest(manifest: ProductLongSessionManifest) {
  assert.equal(manifest.schemaVersion, PRODUCT_LONG_SESSION_SCHEMA);
  assert.equal(manifest.status, 'passed');
  assertProductLongSessionManifestIsBounded(manifest);
  assert.equal(manifest.shell, 'web-right-pane');
  assert.ok(manifest.runner.iterationsCompleted >= 1);
  assertProductLongSessionRunnerContract(manifest.runner, manifest.status, manifest.verificationCommand);
  assert.deepEqual(manifest.interactionCoverage.classes, [
    'continuous-navigation',
    'continuous-input',
    'long-page-scroll',
    'drag-mouse-route',
    'history-back-forward-reload',
    'right-pane-tab-switch',
    'workspace-writer-restart-reconnect',
  ]);
  for (const eventType of ['page-load', 'product-focus', 'product-input', 'product-scroll']) {
    assert.ok(manifest.interactionCoverage.fixtureEventTypes.includes(eventType), `missing fixture event ${eventType}`);
  }
  for (const action of ['navigate', 'back', 'forward', 'reload']) {
    assert.ok(manifest.interactionCoverage.browserHostActions.includes(action), `missing browser host action ${action}`);
  }
  assert.ok(
    manifest.interactionCoverage.drag.fixturePointerEvents > 0
      || manifest.interactionCoverage.drag.browserHostRouteActions.includes('mouse-up'),
    'drag route must be backed by fixture pointer events or BrowserHostSession mouse-up ACK',
  );
  assert.equal(manifest.browserHostSession.first.owner, 'host');
  assert.equal(manifest.browserHostSession.beforeWorkspaceRestart.owner, 'host');
  assert.equal(manifest.browserHostSession.beforeWorkspaceRestart.transport, 'host-stream');
  assert.equal(manifest.browserHostSession.beforeWorkspaceRestart.singleInteractiveTruth, true);
  assert.match(manifest.browserHostSession.beforeWorkspaceRestart.refs.frameStreamRef ?? '', /^browser-host-session:[^/]+\/frame-stream$/);
  assert.equal(manifest.continuity.sameSessionBeforeRestart, true, 'product long-session must keep the same BrowserHostSession before workspace restart');
  assert.equal(manifest.continuity.singleBrowserHostSessionBeforeRestart, true, 'right pane must expose one BrowserHostSession before workspace restart');
  assert.equal(manifest.continuity.tabSwitchSameSession, true, 'right pane tab switch must preserve the BrowserHostSession');
  assert.equal(manifest.continuity.singleInteractiveTruth, true, 'BrowserHostSession must remain the single interactive truth');
  assert.equal(manifest.continuity.maxHostFrames, 1, 'right pane must not render multiple BrowserHostSession host frames');
  assert.ok(manifest.boundedMetrics.frameStream.streamsOpened >= 1);
  assert.ok(manifest.boundedMetrics.frameStream.framesReceived >= 1);
  assert.equal(manifest.boundedMetrics.loadingProgressLifecycle.schemaVersion, PRODUCT_LONG_SESSION_LOADING_PROGRESS_TRACE_SCHEMA);
  assert.equal(manifest.boundedMetrics.loadingProgressLifecycle.bounded, true);
  assert.equal(manifest.boundedMetrics.loadingProgressLifecycle.completionEvidence.readyStateObserved, true);
  assert.equal(manifest.boundedMetrics.loadingProgressLifecycle.completionEvidence.uiLoadingToReady, true);
  assert.ok(manifest.boundedMetrics.loadingProgressLifecycle.observedUiStates.some((entry) => entry.value === 'loading'));
  assert.ok(manifest.boundedMetrics.loadingProgressLifecycle.observedUiStates.some((entry) => entry.value === 'ready'));
  assert.equal(manifest.boundedMetrics.rightPaneBeforeRestart.hostFrames, 1);
  assert.equal(manifest.boundedMetrics.rightPaneBeforeRestart.iframeSurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPaneBeforeRestart.proxySurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPaneBeforeRestart.webviewSurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPaneBeforeRestart.systemPopupSurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPaneBeforeRestart.dataImageSurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPaneBeforeRestart.base64Attributes, 0);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlCreateCountBeforeRestart >= 0);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlRevokeCountBeforeRestart >= 0);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlLiveEstimateBeforeRestart >= 0);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlMaxLiveEstimateBeforeRestart >= manifest.boundedMetrics.memoryishCounts.objectUrlLiveEstimateBeforeRestart);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlRevokeDeficitBeforeRestart >= 0);
  assert.ok(['reconnected', 'blocked'].includes(manifest.failureRetry.workspaceWriterRestart.status));
  assert.equal(manifest.failureRetry.addressDetailsRecovery.outcomeCount, manifest.runner.iterationsCompleted);
  assert.ok(manifest.failureRetry.addressDetailsRecovery.outcomes.length > 0);
  assert.ok(manifest.failureRetry.addressDetailsRecovery.outcomes.length <= 12);
  for (const outcome of manifest.failureRetry.addressDetailsRecovery.outcomes) {
    assertAddressDetailsRecoveryOutcome(outcome);
  }
  assert.equal(manifest.failureRetry.workspaceWriterRestart.attempted, true);
  if (manifest.failureRetry.workspaceWriterRestart.status === 'blocked') {
    assert.equal(manifest.failureRetry.workspaceWriterRestart.retry.status, 'blocked');
    assert.ok(manifest.failureRetry.workspaceWriterRestart.retry.reasonCode);
    assert.ok(manifest.failureRetry.workspaceWriterRestart.retry.reasonHash);
  }
  for (const category of [
    'navigation',
    'input-routing',
    'scroll-routing',
    'drag-routing',
    'history-reload',
    'right-pane-tab-switch',
    'frame-capture',
    'state-polling',
    'workspace-reconnect',
  ] satisfies ProductLongSessionMetricCategory[]) {
    assert.ok(manifest.boundedMetrics.latencySummary[category].sampleCount > 0, `missing latency category ${category}`);
  }
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), [false, false, false, false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|base64(?:Data|Payload|Inline|Bytes)|iVBORw0KGgo|screenshot(?:Data|Base64|Inline|Bytes)/i);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(FIXTURE_HOST)));
  for (let iteration = 0; iteration < manifest.runner.iterationsCompleted; iteration += 1) {
    assertNoRawText(serialized, productInputText(iteration));
  }
}

async function writeProductLongSessionBlockedManifest(input: {
  config: ProductLongSessionConfig;
  runId: string;
  fixtureOrigin: string;
  durationMs: number;
  phase: string;
  currentIteration: number;
  error: unknown;
  page?: Page;
  fixtureUrl?: string;
  metrics: MetricSample[];
  networkRecorder?: ReturnType<typeof recordBrowserHostNetwork>;
  frameStream?: FrameStreamStats;
  diagnostics?: ReturnType<typeof recordPageDiagnostics>;
  rightPaneInitial?: RightPaneBoundedEvidence;
  addressDetailsRecovery?: AddressDetailsRecoveryEvidence[];
}): Promise<void> {
  await input.networkRecorder?.drain().catch(() => undefined);
  const rightPaneBeforeFailure = input.page
    ? await collectRightPaneEvidence(input.page).catch(() => undefined)
    : undefined;
  const workbenchFailureSnapshot = input.page
    ? await collectBrowserWorkbenchFailureSnapshot(input.page).catch(() => undefined)
    : undefined;
  const fixtureEvents = input.fixtureUrl
    ? await fetchFixtureEvents(input.fixtureUrl).catch(() => [])
    : [];
  const allNetworkSamples = input.networkRecorder?.samples ?? [];
  const networkSamples = boundedNetworkSamples(allNetworkSamples, 24);
  const failureClassification = classifyProductLongSessionFailure({
    phase: input.phase,
    error: input.error,
    workbenchFailureSnapshot,
    rightPaneBeforeFailure,
    initialRightPaneEvidence: input.rightPaneInitial,
    networkSamples,
  });
  const manifest: ProductLongSessionBlockedManifest = {
    schemaVersion: PRODUCT_LONG_SESSION_SCHEMA,
    status: 'blocked',
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    runner: {
      mode: input.config.mode,
      requestedMinutes: input.config.requestedMinutes,
      requestedIterations: input.config.requestedIterations,
      iterationsCompleted: input.currentIteration,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      defaultSmokeIsThirtyMinuteBenchmark: false,
      extensionEnv: {
        minutes: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES',
        iterations: 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS',
      },
    },
    failure: {
      phase: boundedFailurePhase(input.phase),
      reasonCode: failureClassification.kind,
      reasonHash: hashText(input.error instanceof Error ? input.error.message : String(input.error)),
      errorName: input.error instanceof Error && input.error.name ? input.error.name : 'Error',
      currentIteration: input.currentIteration,
      classification: failureClassification,
      retrySemantics: 'typed-blocked-artifact-written-and-original-error-rethrown',
    },
    failureRetry: {
      addressDetailsRecovery: {
        attemptedIterations: (input.addressDetailsRecovery ?? [])
          .filter((entry) => entry.attempted)
          .map((entry) => entry.iteration)
          .slice(-24),
        outcomeCount: input.addressDetailsRecovery?.length ?? 0,
        outcomes: input.addressDetailsRecovery?.slice(-12) ?? [],
      },
    },
    boundedMetrics: {
      latencySummary: summarizeLatency(input.metrics),
      networkSamples,
      frameStream: input.frameStream ?? emptyFrameStreamStats(),
      memoryishCounts: {
        iterationsCompleted: input.currentIteration,
        metricSampleCount: input.metrics.length,
        networkSampleCount: input.networkRecorder?.samples.length ?? 0,
        frameStreamFrameCount: input.frameStream?.framesReceived ?? 0,
        fixtureEventCount: fixtureEvents.length,
        rightPaneSessionRefCount: rightPaneBeforeFailure?.sessionIds.length ?? 0,
        approxJsHeapUsedBeforeFailure: rightPaneBeforeFailure?.approxJsHeapUsed,
        approxJsHeapDeltaBeforeFailure: heapDelta(input.rightPaneInitial, rightPaneBeforeFailure),
        objectUrlCreateCountBeforeFailure: rightPaneBeforeFailure?.objectUrls.createCount ?? 0,
        objectUrlRevokeCountBeforeFailure: rightPaneBeforeFailure?.objectUrls.revokeCount ?? 0,
        objectUrlLiveEstimateBeforeFailure: rightPaneBeforeFailure?.objectUrls.liveEstimate ?? 0,
        objectUrlMaxLiveEstimateBeforeFailure: rightPaneBeforeFailure?.objectUrls.maxLiveEstimate ?? 0,
        objectUrlRevokeDeficitBeforeFailure: rightPaneBeforeFailure?.objectUrls.revokeDeficit ?? 0,
      },
      loadingProgressLifecycle: rightPaneBeforeFailure
        ? summarizeLoadingProgressLifecycle(rightPaneBeforeFailure, undefined, allNetworkSamples)
        : undefined,
      rightPaneBeforeFailure,
      workbenchFailureSnapshot,
      fixtureEventTypes: boundedUnique(fixtureEvents.map((event) => event.type), 32),
      fixturePaths: boundedUnique(fixtureEvents.map((event) => event.path), 12),
    },
    diagnostics: {
      pageErrorCount: input.diagnostics?.errors.length ?? 0,
      consoleErrorCount: input.diagnostics?.consoleErrors.length ?? 0,
      recentPageErrorHashes: input.diagnostics?.errors.slice(-6).map(hashText) ?? [],
      recentConsoleErrorHashes: input.diagnostics?.consoleErrors.slice(-6).map(hashText) ?? [],
    },
    forbiddenEvidence: productLongSessionForbiddenEvidence(),
    verificationCommand: productLongSessionVerificationCommand(input.config),
  };
  assertProductLongSessionBlockedManifest(manifest);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[blocked] Browser pane product long-session ${JSON.stringify({
    mode: manifest.runner.mode,
    phase: manifest.failure.phase,
    reasonCode: manifest.failure.reasonCode,
    iterations: manifest.runner.iterationsCompleted,
    durationMs: manifest.runner.durationMs,
  })}`);
}

function assertProductLongSessionBlockedManifest(manifest: ProductLongSessionBlockedManifest) {
  assert.equal(manifest.schemaVersion, PRODUCT_LONG_SESSION_SCHEMA);
  assert.equal(manifest.status, 'blocked');
  assertProductLongSessionManifestIsBounded(manifest);
  assert.equal(manifest.shell, 'web-right-pane');
  assert.ok(manifest.failure.phase.length > 0);
  assert.match(manifest.failure.reasonHash, /^[a-f0-9]{16}$/);
  assertProductLongSessionRunnerContract(manifest.runner, manifest.status, manifest.verificationCommand);
  assert.equal(manifest.failure.retrySemantics, 'typed-blocked-artifact-written-and-original-error-rethrown');
  for (const outcome of manifest.failureRetry.addressDetailsRecovery.outcomes) {
    assert.ok(['not-needed', 'succeeded', 'blocked'].includes(outcome.status));
    if (outcome.attempted) assert.ok(outcome.actionSequence.includes('retry-open-url'));
  }
  assert.equal(manifest.failure.classification.blockedEvidence.bounded, true);
  assert.equal(manifest.failure.classification.blockedEvidence.noRawUrl, true);
  assert.equal(manifest.failure.classification.blockedEvidence.noRawDom, true);
  assert.ok(manifest.failure.classification.kind === manifest.failure.reasonCode);
  if (manifest.failure.phase.includes('address-details')) {
    assert.equal(manifest.failure.classification.phaseCategory, 'address-details-navigation');
    assert.equal(manifest.failure.classification.expectedRoute, 'details');
    if (manifest.failure.classification.timedOut) {
      assert.equal(manifest.failure.reasonCode, 'address-details-ready-timeout');
      assert.equal(manifest.failure.classification.retryable, true);
    }
    const currentOutcome = manifest.failureRetry.addressDetailsRecovery.outcomes
      .find((outcome) => outcome.iteration === manifest.failure.currentIteration);
    assert.ok(currentOutcome, 'address-details blocked manifest must include recovery outcome for the current iteration');
    assert.equal(currentOutcome.attempted, true);
    assert.equal(currentOutcome.status, 'blocked');
  }
  for (const outcome of manifest.failureRetry.addressDetailsRecovery.outcomes) {
    assertAddressDetailsRecoveryOutcome(outcome);
  }
  assert.ok(manifest.boundedMetrics.networkSamples.length <= 24);
  if (manifest.boundedMetrics.rightPaneBeforeFailure) {
    assert.equal(manifest.boundedMetrics.rightPaneBeforeFailure.iframeSurfaces, 0);
    assert.equal(manifest.boundedMetrics.rightPaneBeforeFailure.proxySurfaces, 0);
    assert.equal(manifest.boundedMetrics.rightPaneBeforeFailure.webviewSurfaces, 0);
    assert.equal(manifest.boundedMetrics.rightPaneBeforeFailure.systemPopupSurfaces, 0);
    assert.equal(manifest.boundedMetrics.rightPaneBeforeFailure.dataImageSurfaces, 0);
    assert.equal(manifest.boundedMetrics.rightPaneBeforeFailure.base64Attributes, 0);
  }
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlCreateCountBeforeFailure >= 0);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlRevokeCountBeforeFailure >= 0);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlLiveEstimateBeforeFailure >= 0);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlMaxLiveEstimateBeforeFailure >= manifest.boundedMetrics.memoryishCounts.objectUrlLiveEstimateBeforeFailure);
  assert.ok(manifest.boundedMetrics.memoryishCounts.objectUrlRevokeDeficitBeforeFailure >= 0);
  if (manifest.failure.classification.blockedEvidence.resourceHealth) {
    assert.equal(manifest.failure.classification.blockedEvidence.resourceHealth.bounded, true);
    assert.ok(manifest.failure.classification.blockedEvidence.resourceHealth.objectUrls.liveEstimate >= 0);
    assert.ok(manifest.failure.classification.blockedEvidence.resourceHealth.surface.maxHostFrames >= 0);
  }
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), [false, false, false, false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|base64(?:Data|Payload|Inline|Bytes)|iVBORw0KGgo|screenshot(?:Data|Base64|Inline|Bytes)/i);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(FIXTURE_HOST)));
  for (let iteration = 0; iteration <= manifest.failure.currentIteration; iteration += 1) {
    assertNoRawText(serialized, productInputText(iteration));
  }
}

function assertProductLongSessionManifestIsBounded(manifest: ProductLongSessionManifest | ProductLongSessionBlockedManifest) {
  const serialized = JSON.stringify(manifest);
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= MAX_PRODUCT_LONG_SESSION_MANIFEST_BYTES,
    'product long-session manifest must stay bounded',
  );
  assert.doesNotMatch(serialized, /data:image|;base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i);
  assert.doesNotMatch(serialized, /"(?:rawDom|domSnapshot|screenshotBase64|providerPayload|consoleLog|networkLog)"\s*:/i);
}

function assertAddressDetailsRecoveryOutcome(outcome: AddressDetailsRecoveryEvidence) {
  assert.ok(outcome.iteration >= 0);
  assert.ok(['not-needed', 'succeeded', 'blocked'].includes(outcome.status));
  assert.ok(outcome.actionSequence.includes('open-url'));
  assert.equal(outcome.boundedRefs?.bounded, true);
  assert.equal(outcome.boundedRefs?.noRawUrl, true);
  assert.equal(outcome.boundedRefs?.noRawDom, true);
  assert.ok((outcome.boundedRefs?.sessionRefs.length ?? 0) >= 1);
  assert.deepEqual(Object.values({
    rawUrl: false,
    rawDom: false,
  }), [false, false]);
  if (outcome.attempted) {
    assert.ok(outcome.actionSequence.includes('reload'));
    assert.ok(outcome.actionSequence.includes('retry-open-url'));
    assert.ok(outcome.reasonCode);
    assert.match(outcome.reasonHash ?? '', /^[a-f0-9]{16}$/);
    assert.ok(outcome.initialFailure);
    assert.match(outcome.initialFailure?.reasonHash ?? '', /^[a-f0-9]{16}$/);
    assert.ok(outcome.reloadAck);
    assert.equal(outcome.reloadAck?.action, 'reload');
    assert.ok(['acked', 'not-observed', 'command-unavailable'].includes(outcome.reloadAck?.status ?? ''));
    if (outcome.status === 'blocked') {
      assert.ok(outcome.reasonCode);
      assert.match(outcome.reasonHash ?? '', /^[a-f0-9]{16}$/);
    }
  }
}

function assertProductLongSessionRunnerContract(
  runner: ProductLongSessionManifest['runner'],
  status: ProductLongSessionManifest['status'] | ProductLongSessionBlockedManifest['status'],
  verificationCommand: string,
) {
  assert.equal(runner.defaultSmokeIsThirtyMinuteBenchmark, false);
  assert.equal(runner.extensionEnv.minutes, 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES');
  assert.equal(runner.extensionEnv.iterations, 'SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS');
  assert.ok(runner.iterationsCompleted >= 0);
  assert.ok(runner.durationMs >= 0);

  if (runner.mode === 'quick-contract') {
    assert.ok(
      (runner.requestedMinutes ?? 0) < TRUE_LONG_SESSION_MINUTES,
      'quick mode must not claim the 30 minute benchmark',
    );
  }

  if (runner.requestedMinutes !== undefined) {
    assert.ok(
      verificationCommand.includes(`SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=${runner.requestedMinutes}`),
      'requested minutes artifact must include its minutes env in verificationCommand',
    );
  } else {
    assert.doesNotMatch(
      verificationCommand,
      /SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=/,
      'default quick artifact must not imply a requested minutes deadline',
    );
  }

  if (runner.requestedIterations !== undefined) {
    assert.ok(
      verificationCommand.includes(`SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS=${runner.requestedIterations}`),
      'requested iterations artifact must include its iterations env in verificationCommand',
    );
  }

  if ((runner.requestedMinutes ?? 0) >= TRUE_LONG_SESSION_MINUTES) {
    assert.equal(runner.mode, 'extended-product-long-session');
    if (status === 'passed') {
      assert.ok(
        runner.durationMs >= Math.round((runner.requestedMinutes ?? 0) * 60_000),
        'requested 30+ minute product long-session pass must run for the requested duration',
      );
    } else {
      assert.equal(status, 'blocked', 'truncated requested 30+ minute product long-session artifacts must remain blocked');
    }
  }
}

function productLongSessionForbiddenEvidence(): ProductLongSessionManifest['forbiddenEvidence'] {
  return {
    rawDom: false,
    base64: false,
    rawScreenshot: false,
    iframe: false,
    proxy: false,
    webview: false,
    systemPopup: false,
    fixtureHostRaw: false,
    defaultSmokeClaimsThirtyMinutes: false,
  };
}

function emptyFrameStreamStats(): FrameStreamStats {
  return {
    streamsOpened: 0,
    framesReceived: 0,
    binaryFramesReceived: 0,
    maxPayloadBytes: 0,
  };
}

function boundedFailurePhase(value: string): string {
  return /^[a-z0-9-]+$/i.test(value) ? value.slice(0, 96) : 'unknown';
}

function classifyProductLongSessionFailure(input: {
  phase: string;
  error: unknown;
  workbenchFailureSnapshot?: BrowserWorkbenchFailureSnapshot;
  rightPaneBeforeFailure?: RightPaneBoundedEvidence;
  initialRightPaneEvidence?: RightPaneBoundedEvidence;
  networkSamples: BrowserHostNetworkSample[];
}): ProductLongSessionFailureClassification {
  const baseReasonCode = productLongSessionFailureReasonCode(input.error, input.phase);
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const phase = boundedFailurePhase(input.phase);
  const addressDetailsPhase = /(?:^|-)address-details$/.test(phase);
  const timedOut = /timed out|timeout|waitForFunction: Timeout|Browser workbench URL|BrowserHostSession URL|fixture event/i.test(message);
  const kind = addressDetailsPhase && timedOut ? 'address-details-ready-timeout' : baseReasonCode;
  const sessionRefs = boundedUnique([
    ...(input.workbenchFailureSnapshot?.sessionRefs ?? []),
    ...(input.rightPaneBeforeFailure?.sessionIds ?? []).map((id) => `browser-host-session:${id}`),
  ], 12);
  const liveSurfaceRefs = boundedUnique([
    ...(input.workbenchFailureSnapshot?.liveSurfaceRefs ?? []),
    ...(input.rightPaneBeforeFailure?.liveSurfaceRefs ?? []),
  ], 12);
  const frameStreamRefs = boundedUnique([
    ...(input.workbenchFailureSnapshot?.frameStreamRefs ?? []),
    ...(input.rightPaneBeforeFailure?.frameStreamRefs ?? []),
  ], 12);
  return {
    kind,
    phaseCategory: productLongSessionFailurePhaseCategory(kind, phase),
    timedOut,
    retryable: productLongSessionFailureRetryable(kind),
    expectedRoute: addressDetailsPhase ? 'details' : phase.includes('address-session') ? 'session' : 'unknown',
    blockedEvidence: {
      bounded: true,
      noRawUrl: true,
      noRawDom: true,
      uiState: input.workbenchFailureSnapshot?.state || input.rightPaneBeforeFailure?.state || undefined,
      displayedUrlLength: input.workbenchFailureSnapshot?.displayedUrlLength,
      displayedUrlHash: input.workbenchFailureSnapshot?.displayedUrlHash,
      addressDraftLength: input.workbenchFailureSnapshot?.addressDraftLength,
      addressDraftHash: input.workbenchFailureSnapshot?.addressDraftHash,
      hostFrameCount: input.workbenchFailureSnapshot?.hostFrameCount ?? input.rightPaneBeforeFailure?.hostFrames,
      hiddenKeyboardActive: input.workbenchFailureSnapshot?.hiddenKeyboardActive ?? Boolean(input.rightPaneBeforeFailure?.hiddenKeyboardFocusKeys.length),
      sessionRefs,
      liveSurfaceRefs,
      frameStreamRefs,
      recentHostStatuses: summarizeCounts(input.networkSamples.slice(-24).map((sample) => sample.sessionStatus ?? '').filter(Boolean), 12),
      recentLoadingStates: summarizeCounts(input.networkSamples.slice(-24).map((sample) => sample.loadingProgressState ?? '').filter(Boolean), 12),
      recentLoadingReasons: summarizeCounts(input.networkSamples.slice(-24).map((sample) => sample.loadingProgressReason ?? '').filter(Boolean), 12),
      observedUiStates: summarizeCounts([
        ...(input.rightPaneBeforeFailure ? expandCounts(input.rightPaneBeforeFailure.browserStateCounts) : []),
        ...(input.rightPaneBeforeFailure?.browserStates ?? []),
        input.workbenchFailureSnapshot?.state ?? '',
      ].filter(Boolean), 12),
      resourceHealth: input.rightPaneBeforeFailure
        ? buildResourceEvidence('before-failure', input.rightPaneBeforeFailure, input.initialRightPaneEvidence)
        : undefined,
    },
  };
}

function buildResourceEvidence(
  sample: ProductLongSessionResourceEvidence['sample'],
  evidence: RightPaneBoundedEvidence,
  initialEvidence?: RightPaneBoundedEvidence,
): ProductLongSessionResourceEvidence {
  return {
    bounded: true,
    sample,
    approxJsHeapUsed: evidence.approxJsHeapUsed,
    approxJsHeapDeltaFromInitial: heapDelta(initialEvidence, evidence),
    objectUrls: evidence.objectUrls,
    surface: {
      attachChanges: evidence.attachChanges,
      detachChanges: evidence.detachChanges,
      maxHostFrames: evidence.maxHostFrames,
      sessionRefCount: evidence.sessionIds.length,
      surfaceReconnectObserved: evidence.attachChanges > 1 || evidence.detachChanges > 0,
    },
  };
}

function heapDelta(
  initialEvidence: RightPaneBoundedEvidence | undefined,
  laterEvidence: RightPaneBoundedEvidence | undefined,
): number | undefined {
  if (
    initialEvidence?.approxJsHeapUsed === undefined
    || laterEvidence?.approxJsHeapUsed === undefined
  ) {
    return undefined;
  }
  return Math.round(laterEvidence.approxJsHeapUsed - initialEvidence.approxJsHeapUsed);
}

function productLongSessionFailureReasonCode(error: unknown, phase = ''): ProductLongSessionFailureClassification['kind'] {
  const message = error instanceof Error ? error.message : String(error);
  if (/cleanup|Timed out during (?:page-close|browser-context-close|browser-close|ui-server-stop|workspace-writer-stop|fixture-close|temp-root-rm)/i.test(`${phase} ${message}`)) {
    return 'product-long-session-cleanup-blocked';
  }
  if (/same BrowserHostSession|keep the same BrowserHostSession|BrowserHostSession.*continuity|session continuity|tab switch.*preserve|single interactive truth|maxHostFrames|host frames|live surface.*continuity|surface continuity/i.test(message)) {
    return 'browser-host-session-continuity-break';
  }
  if (/Browser workbench URL|waitForFunction: Timeout/i.test(message)) return 'browser-workbench-url-timeout';
  if (/fixture event/i.test(message)) return 'fixture-event-timeout';
  if (/BrowserHostSession URL/i.test(message)) return 'browser-host-session-url-timeout';
  if (/results panel/i.test(message)) return 'sciforge-results-panel-timeout';
  if (/No browser executable/i.test(message)) return 'browser-executable-missing';
  if (/workspace|health/i.test(message)) return 'workspace-writer-health-timeout';
  return 'product-long-session-error';
}

function productLongSessionFailurePhaseCategory(
  kind: ProductLongSessionFailureClassification['kind'],
  phase: string,
): ProductLongSessionFailureClassification['phaseCategory'] {
  if (kind === 'address-details-ready-timeout' || phase.includes('address-details')) return 'address-details-navigation';
  if (kind === 'browser-workbench-url-timeout' || kind === 'browser-host-session-url-timeout') return 'browser-navigation';
  if (kind === 'fixture-event-timeout') return 'fixture-readiness';
  if (kind === 'browser-host-session-continuity-break') return 'session-continuity';
  if (kind === 'product-long-session-cleanup-blocked') return 'cleanup';
  if (kind === 'browser-executable-missing') return 'environment';
  if (kind === 'workspace-writer-health-timeout') return 'workspace';
  return 'unknown';
}

function productLongSessionFailureRetryable(kind: ProductLongSessionFailureClassification['kind']): boolean {
  return [
    'address-details-ready-timeout',
    'browser-workbench-url-timeout',
    'browser-host-session-url-timeout',
    'fixture-event-timeout',
    'workspace-writer-health-timeout',
  ].includes(kind);
}

function browserHostSessionSummary(session: JsonRecord): BrowserHostSessionSummary {
  const url = stringField(session.url);
  const requestedUrl = stringField(session.requestedUrl);
  return {
    id: stringField(session.id),
    owner: stringField(session.owner),
    status: stringField(session.status),
    transport: stringField(session.liveSurfaceTransport),
    singleInteractiveTruth: session.singleInteractiveTruth === true,
    canGoBack: session.canGoBack === true,
    canGoForward: session.canGoForward === true,
    urlHash: url ? hashText(url) : undefined,
    requestedUrlHash: requestedUrl ? hashText(requestedUrl) : undefined,
    liveSurfaceRef: stringField(session.liveSurfaceRef),
    refs: {
      frameStreamRef: stringField(session.frameStreamRef),
      frameRef: stringField(session.frameRef),
      screenshotRef: stringField(session.screenshotRef),
      domSnapshotRef: stringField(session.domSnapshotRef),
      axSnapshotRef: stringField(session.axSnapshotRef),
      consoleLogRef: stringField(session.consoleLogRef),
      networkLogRef: stringField(session.networkLogRef),
    },
  };
}

function summarizeLatency(samples: MetricSample[]): Record<ProductLongSessionMetricCategory, LatencySummary> {
  const categories: ProductLongSessionMetricCategory[] = [
    'navigation',
    'input-routing',
    'scroll-routing',
    'drag-routing',
    'history-reload',
    'right-pane-tab-switch',
    'frame-capture',
    'state-polling',
    'workspace-reconnect',
  ];
  const summary = {} as Record<ProductLongSessionMetricCategory, LatencySummary>;
  for (const category of categories) {
    const categorySamples = samples.filter((sample) => sample.category === category);
    const durations = categorySamples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    summary[category] = {
      sampleCount: categorySamples.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: durations[durations.length - 1] ?? 0,
      labels: boundedUnique(categorySamples.map((sample) => sample.label), 16),
    };
  }
  return summary;
}

function summarizeLoadingProgressLifecycle(
  beforeRestart: RightPaneBoundedEvidence,
  afterRestart: RightPaneBoundedEvidence | undefined,
  networkSamples: BrowserHostNetworkSample[],
): BrowserPaneLoadingProgressLifecycleTraceSummary {
  const uiStates = [
    ...expandCounts(beforeRestart.browserStateCounts),
    ...(afterRestart ? expandCounts(afterRestart.browserStateCounts) : []),
    ...beforeRestart.browserStates,
    ...(afterRestart?.browserStates ?? []),
  ].filter(Boolean);
  const hostStatuses = networkSamples.map((sample) => sample.sessionStatus ?? '').filter(Boolean);
  const lifecycleStates = networkSamples.map((sample) => sample.loadingProgressState ?? '').filter(Boolean);
  const lifecycleReasons = networkSamples.map((sample) => sample.loadingProgressReason ?? '').filter(Boolean);
  const lifecycleSources = networkSamples.map((sample) => sample.loadingProgressSource ?? '').filter(Boolean);
  const observedTransitions = boundedUnique([
    ...beforeRestart.browserStateTransitions,
    ...(afterRestart?.browserStateTransitions ?? []),
  ], 24);
  return {
    schemaVersion: PRODUCT_LONG_SESSION_LOADING_PROGRESS_TRACE_SCHEMA,
    evidenceSource: 'right-pane-browser-workbench-viewer-and-host-session-status',
    bounded: true,
    sampleCounts: {
      ui: beforeRestart.browserStateSampleCount + (afterRestart?.browserStateSampleCount ?? 0),
      hostSession: hostStatuses.length,
      lifecycle: lifecycleStates.length,
    },
    observedUiStates: summarizeCounts(uiStates, 16),
    observedHostStatuses: summarizeCounts(hostStatuses, 16),
    observedLifecycleStates: summarizeCounts(lifecycleStates, 16),
    observedLifecycleReasons: summarizeCounts(lifecycleReasons, 16),
    observedLifecycleSources: summarizeCounts(lifecycleSources, 16),
    observedTransitions,
    urlEvidence: {
      requested: summarizeUrlDigests(networkSamples, 'requested'),
      current: summarizeUrlDigests(networkSamples, 'current'),
      final: summarizeUrlDigests(networkSamples, 'final'),
    },
    completionEvidence: {
      uiLoadingToReady: uiStates.includes('loading') && uiStates.includes('ready'),
      lifecycleNavigationStartToNetworkQuiet: lifecycleStates.includes('navigation-start') && lifecycleStates.includes('network-quiet'),
      readyStateObserved: uiStates.includes('ready') || hostStatuses.includes('ready'),
      networkQuietObserved: lifecycleStates.includes('network-quiet') || hostStatuses.includes('ready'),
    },
  };
}

function summarizeUrlDigests(
  samples: BrowserHostNetworkSample[],
  kind: 'requested' | 'current' | 'final',
): BoundedUrlDigestSummary {
  const lengthKey = `${kind}UrlLength` as const;
  const hashKey = `${kind}UrlHash` as const;
  const lengths = samples
    .map((sample) => sample[lengthKey])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const hashes = samples
    .map((sample) => sample[hashKey])
    .filter((value): value is string => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value));
  return {
    sampleCount: hashes.length,
    uniqueHashCount: new Set(hashes).size,
    lengthRange: lengths.length > 0 ? [Math.min(...lengths), Math.max(...lengths)] : [],
    hashes: boundedUnique(hashes, 12),
  };
}

function expandCounts(counts: Record<string, number>): string[] {
  return Object.entries(counts).flatMap(([value, count]) => Array.from({ length: Math.max(0, Math.min(32, count)) }, () => value));
}

function summarizeCounts(values: string[], limit: number): BoundedCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

async function startProductLongSessionFixture(port: number): Promise<{ url: string; close(): Promise<void> }> {
  const events: ProductFixtureEvent[] = [];
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${FIXTURE_HOST}:${port}`);
    if (url.pathname === '/__events') {
      if (req.method === 'POST') {
        const body = await readRequestBody(req);
        events.push(eventFromPayload(body, url.searchParams.get('path') || '/'));
        writeJson(res, 200, { ok: true });
        return;
      }
      writeJson(res, 200, { ok: true, events });
      return;
    }
    const iteration = boundedIteration(url.searchParams.get('iteration'));
    if (url.pathname === '/details') {
      writeHtml(res, pageShell('Product Long Session Details', detailsPageBody(iteration)));
      return;
    }
    writeHtml(res, pageShell('Product Long Session', sessionPageBody(iteration)));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => stopHttpServer(server),
  };
}

function sessionPageBody(iteration: number) {
  return `
    <main>
      <section class="hero">
        <h1>Product Long Session ${iteration}</h1>
        <input id="productInput" aria-label="Product long session input" autofocus />
      </section>
      <aside id="dragTarget" class="drag-target">Drag target ${iteration}</aside>
      <section class="long-page">
        ${Array.from({ length: 78 }, (_, index) => `<p>Product session row ${iteration}-${index + 1}: bounded interaction content.</p>`).join('')}
      </section>
    </main>
    <script>
      const iteration = Number(new URL(location.href).searchParams.get('iteration') || '0');
      let scrollCount = 0;
      let pointerMoveCount = 0;
      let dragging = false;
      function record(type, payload) {
        navigator.sendBeacon('/__events?path=' + encodeURIComponent(location.pathname), JSON.stringify(Object.assign({ type, iteration }, payload || {})));
      }
      function loadCount() {
        const key = 'product-long-session-load:' + location.pathname + ':' + iteration;
        const next = Number(sessionStorage.getItem(key) || '0') + 1;
        sessionStorage.setItem(key, String(next));
        return next;
      }
      record('page-load', { count: loadCount() });
      productInput.addEventListener('focus', () => record('product-focus', { value: productInput.value }));
      productInput.addEventListener('input', () => record('product-input', { value: productInput.value }));
      addEventListener('scroll', () => {
        scrollCount += 1;
        record('product-scroll', { count: scrollCount, maxScrollY: Math.round(scrollY) });
      }, { passive: true });
      document.addEventListener('mousedown', (event) => {
        if (event.clientY < 100) return;
        dragging = true;
        record('product-drag-down', { x: Math.round(event.clientX), y: Math.round(event.clientY) });
      });
      document.addEventListener('mousemove', (event) => {
        if (!dragging) return;
        pointerMoveCount += 1;
        record('product-pointer-move', { count: pointerMoveCount, x: Math.round(event.clientX), y: Math.round(event.clientY) });
      });
      document.addEventListener('mouseup', (event) => {
        if (!dragging) return;
        dragging = false;
        record('product-drag-up', { count: pointerMoveCount, x: Math.round(event.clientX), y: Math.round(event.clientY) });
      });
    </script>
  `;
}

function detailsPageBody(iteration: number) {
  return `
    <main>
      <section class="hero">
        <h1>Details ${iteration}</h1>
        <p>History, reload, frame-stream, and surface continuity target.</p>
      </section>
      <aside class="drag-target">Stable details surface ${iteration}</aside>
      <section class="long-page">
        ${Array.from({ length: 38 }, (_, index) => `<p>Details row ${iteration}-${index + 1}: bounded navigation content.</p>`).join('')}
      </section>
    </main>
    <script>
      const iteration = Number(new URL(location.href).searchParams.get('iteration') || '0');
      function record(type, payload) {
        navigator.sendBeacon('/__events?path=' + encodeURIComponent(location.pathname), JSON.stringify(Object.assign({ type, iteration }, payload || {})));
      }
      function loadCount() {
        const key = 'product-long-session-load:' + location.pathname + ':' + iteration;
        const next = Number(sessionStorage.getItem(key) || '0') + 1;
        sessionStorage.setItem(key, String(next));
        return next;
      }
      record('page-load', { count: loadCount() });
    </script>
  `;
}

function pageShell(title: string, body: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; color: #102024; background: #f7faf9; }
      main { min-height: 3400px; padding: 24px 32px; }
      .hero { position: relative; min-height: 128px; }
      h1 { margin: 0 0 16px; font-size: 26px; }
      input { box-sizing: border-box; width: 820px; height: 44px; padding: 9px 12px; font-size: 17px; border: 2px solid #174c4f; border-radius: 4px; background: white; color: #102024; }
      .drag-target { position: fixed; top: 96px; left: 72px; right: 72px; height: 240px; display: grid; place-items: center; border-radius: 6px; background: #174c4f; color: white; user-select: none; touch-action: none; }
      .long-page { padding-top: 28px; max-width: 720px; }
      p { margin: 0 0 18px; line-height: 1.55; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function eventFromPayload(raw: string, path: string): ProductFixtureEvent {
  const payload = parseJsonRecord(raw);
  const value = typeof payload.value === 'string' ? payload.value : undefined;
  return {
    type: typeof payload.type === 'string' ? payload.type : 'unknown',
    path,
    iteration: numberField(payload.iteration),
    valueLength: value === undefined ? undefined : value.length,
    valueHash: value === undefined ? undefined : hashText(value),
    count: numberField(payload.count),
    maxScrollY: numberField(payload.maxScrollY),
    x: numberField(payload.x),
    y: numberField(payload.y),
  };
}

async function waitForFixtureEvent(
  baseUrl: string,
  predicate: (event: ProductFixtureEvent) => boolean,
  timeoutMs: number,
  label: string,
): Promise<ProductFixtureEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await fetchFixtureEvents(baseUrl);
    const event = events.find(predicate);
    if (event) return event;
    await delay(250);
  }
  throw new Error(`Timed out waiting for fixture event: ${label}`);
}

async function fetchFixtureEvents(baseUrl: string): Promise<ProductFixtureEvent[]> {
  const json = await fetchJson(`${baseUrl}/__events`);
  return Array.isArray(json.events) ? json.events.filter(isProductFixtureEvent) : [];
}

function isProductFixtureEvent(value: unknown): value is ProductFixtureEvent {
  return Boolean(recordField(value) && typeof (value as ProductFixtureEvent).type === 'string' && typeof (value as ProductFixtureEvent).path === 'string');
}

function recordPageDiagnostics(page: Page): {
  errors: string[];
  consoleErrors: string[];
} {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message.slice(0, 500));
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleErrors.push(message.text().slice(0, 500));
  });
  return { errors, consoleErrors };
}

async function waitForResultsPanel(page: Page, diagnostics: { errors: string[]; consoleErrors: string[] }) {
  try {
    await page.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      urlHash: window.location.href ? window.location.href.length : 0,
      hasWorkbench: Boolean(document.querySelector('.workbench')),
      hasResultsPanel: Boolean(document.querySelector('.results-panel')),
      loadingTextHash: document.querySelector('.workspace-loading-panel')?.textContent
        ? document.querySelector('.workspace-loading-panel')?.textContent?.length
        : 0,
      crashTextHash: document.querySelector('.app-crash-shell pre')?.textContent
        ? document.querySelector('.app-crash-shell pre')?.textContent?.length
        : 0,
    })).catch(() => undefined);
    throw new Error(`Timed out waiting for SciForge results panel: ${JSON.stringify({
      state,
      pageErrorHashes: diagnostics.errors.slice(-3).map(hashText),
      consoleErrorHashes: diagnostics.consoleErrors.slice(-3).map(hashText),
      causeHash: hashText(error instanceof Error ? error.message : String(error)),
    })}`);
  }
}

function productLongSessionConfig(): ProductLongSessionConfig {
  const requestedMinutes = positiveNumberEnv('SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES');
  const requestedIterations = positiveIntegerEnv('SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS');
  const runUntilDeadline = requestedMinutes !== undefined;
  const durationTargetMs = requestedMinutes === undefined ? 0 : Math.round(requestedMinutes * 60_000);
  const iterations = runUntilDeadline ? Number.MAX_SAFE_INTEGER : requestedIterations ?? DEFAULT_QUICK_ITERATIONS;
  const mode: ProductLongSessionMode = (requestedMinutes ?? 0) >= TRUE_LONG_SESSION_MINUTES || (requestedIterations ?? 0) > DEFAULT_QUICK_ITERATIONS
    ? 'extended-product-long-session'
    : 'quick-contract';
  return {
    mode,
    requestedMinutes,
    requestedIterations,
    iterations,
    runUntilDeadline,
    durationTargetMs,
    testTimeoutMs: Math.max(180_000, durationTargetMs + 240_000),
    defaultSmokeIsThirtyMinuteBenchmark: false,
  };
}

function shouldContinueLongSession(config: ProductLongSessionConfig, iterationsCompleted: number, startedAt: number): boolean {
  if (config.runUntilDeadline) return Date.now() - startedAt < config.durationTargetMs;
  return iterationsCompleted < config.iterations;
}

function productLongSessionVerificationCommand(config: ProductLongSessionConfig): string {
  const env: string[] = [];
  if (config.requestedMinutes !== undefined) {
    env.push(`SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_MINUTES=${config.requestedMinutes}`);
  }
  if (config.requestedIterations !== undefined) {
    env.push(`SCIFORGE_BROWSER_PRODUCT_LONG_SESSION_ITERATIONS=${config.requestedIterations}`);
  }
  return [
    ...env,
    'node --import tsx --test tests/smoke/smoke-browser-pane-product-long-session.test.ts',
  ].join(' ');
}

function positiveNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function productInputText(iteration: number) {
  return [
    'SciForge product long-session Browser pane input route',
    `iteration ${iteration}`,
    'refs-first bounded continuity navigation scroll drag reload',
  ].join(' | ');
}

function boundedIteration(value: string | null): number {
  const parsed = Number(value ?? '0');
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, 100_000) : 0;
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  return child;
}

async function stopProcess(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  await waitForProcessExit(exited, 2000);
  if (child.exitCode !== null || child.signalCode) return;
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  } else {
    child.kill('SIGKILL');
  }
  await waitForProcessExit(exited, 1000);
}

async function closeBrowserWithProcessFallback(browser: Browser | undefined, browserPid: number | undefined): Promise<void> {
  if (!browser) return;
  try {
    await withTimeout(browser.close(), 8_000, 'browser-close-timeout');
    return;
  } catch {
    await disconnectBrowser(browser);
    if (browserPid) forceKillProcessTree(browserPid);
  }
}

async function disconnectBrowser(browser: Browser): Promise<void> {
  const disconnect = (browser as unknown as { disconnect?: () => Promise<void> | void }).disconnect;
  if (typeof disconnect !== 'function') return;
  await Promise.resolve(disconnect.call(browser)).catch(() => undefined);
}

function forceKillProcessTree(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The browser may already have exited after disconnect.
    }
  }
}

function browserProcessId(browser: Browser): number | undefined {
  const maybeProcess = (browser as unknown as { process?: () => ChildProcess | undefined }).process;
  if (typeof maybeProcess !== 'function') return undefined;
  return maybeProcess.call(browser)?.pid;
}

async function waitForProcessExit(exited: Promise<void>, timeoutMs: number): Promise<void> {
  await withTimeout(exited, timeoutMs, 'process-exit-timeout').catch(() => undefined);
}

async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForHttpDown(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (!response.ok) return true;
    } catch {
      return true;
    }
    await delay(200);
  }
  return false;
}

async function getFreePort() {
  const server = createNetServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!port) throw new Error('Could not allocate a free port');
  return port;
}

async function stopHttpServer(server: HttpServer | undefined) {
  if (!server) return;
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function boundedCleanup(label: string, cleanup: () => Promise<unknown> | undefined, timeoutMs: number): Promise<void> {
  try {
    await withTimeout(Promise.resolve(cleanup()), timeoutMs, `Timed out during ${label}`);
  } catch (error) {
    console.error(`[cleanup-blocked] Browser pane product long-session ${JSON.stringify({
      label,
      reasonHash: hashText(error instanceof Error ? error.message : String(error)),
    })}`);
  }
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function writeHtml(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, body: string) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function writeJson(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, status: number, body: JsonRecord) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readRequestBody(req: { on(event: 'data', listener: (chunk: Buffer) => void): void; on(event: 'end', listener: () => void): void; on(event: 'error', listener: (error: Error) => void): void }) {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolveRead, reject) => {
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolveRead());
    req.on('error', reject);
  });
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url);
  const text = await response.text();
  const json = text ? parseJsonRecord(text) : {};
  if (!response.ok || json.ok === false) throw new Error(`GET ${url} failed: ${response.status}`);
  return json;
}

function parseJsonRecord(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    return recordField(parsed) ?? {};
  } catch {
    return {};
  }
}

function recordField(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function percentile(sorted: number[], percentileValue: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index];
}

function boundedUnique<T>(values: T[], limit = 24): T[] {
  return [...new Set(values)].slice(0, limit);
}

function assertNoRawText(serialized: string, text: string) {
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(text)));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(encodeURIComponent(text))));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}
