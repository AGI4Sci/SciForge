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
  type Locator,
  type Page,
  type Request,
  type Response,
  type WebSocket as PlaywrightWebSocket,
} from 'playwright-core';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const AUDIT_SCHEMA = 'sciforge.browser-pane-bottleneck-audit.v1';
const FIXTURE_HOST = 'sciforge-browser-pane-bottleneck-audit.test';
const MAX_MANIFEST_BYTES = 64_000;
const MAX_NETWORK_SAMPLES = 40;
const MAX_SAMPLE_LABELS_PER_CATEGORY = 8;
const MAX_RIGHT_PANE_REF_COUNT = 24;
const ARTIFACT_DIR = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-bottleneck-audit');
const MANIFEST_PATH = join(ARTIFACT_DIR, 'manifest.json');
const VERIFICATION_COMMAND = 'npm run smoke:browser-pane-bottleneck-audit --silent';
const INPUT_TEXT = [
  'SciForge Browser pane bottleneck audit continuous input route',
  'refs-first no raw payloads bounded metrics long segment 001 002 003',
].join(' | ');
const BACKSPACE_COUNT = 9;
const RETYPE_SUFFIX = ' refined route tail';
const EXPECTED_AFTER_BACKSPACE = INPUT_TEXT.slice(0, -BACKSPACE_COUNT);
const EXPECTED_FINAL_INPUT = `${EXPECTED_AFTER_BACKSPACE}${RETYPE_SUFFIX}`;

type JsonRecord = Record<string, unknown>;
type BrowserPaneLiveAcceptance = {
  status: 'passed' | 'blocked';
  claimScope: 'right-pane-live-pass' | 'diagnostic-only';
  passClaim: boolean;
  required: {
    liveSurfaceTransport: 'native-embedded';
    frameTransport: 'native-embedded';
    singleInteractiveTruth: true;
    secondTruthSource: false;
    sameLiveSurfaceRef: true;
    rightPaneNativeEvidence: true;
    legacyFallbackObserved: false;
  };
  observed: {
    shell: 'web-right-pane';
    liveSurfaceTransport: string;
    frameTransport?: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
    sameLiveSurfaceRef: boolean;
    rightPaneNativeEvidence: boolean;
    legacyFallbackObserved: boolean;
  };
  handoff?: {
    state: 'needs-native-attach' | 'native-proof-incomplete';
    canRetry: true;
    legacyFallbackAllowed: false;
  };
  blockedReason?: string;
};
type BottleneckCategory =
  | 'input-routing'
  | 'surface-attach'
  | 'frame-capture'
  | 'state-polling'
  | 'navigation'
  | 'react-rerender';
const REQUIRED_BOTTLENECK_CATEGORIES: BottleneckCategory[] = [
  'input-routing',
  'surface-attach',
  'frame-capture',
  'state-polling',
  'navigation',
  'react-rerender',
];

type InteractionCoverageClass =
  | 'continuous-input'
  | 'searchbox-caret-selection'
  | 'long-page-scroll'
  | 'slider-drag'
  | 'text-selection-drag'
  | 'drag-mouse-move'
  | 'tab-switch-surface-continuity'
  | 'surface-resize-reload-continuity'
  | 'navigation-history-reload';
const REQUIRED_INTERACTION_COVERAGE: InteractionCoverageClass[] = [
  'continuous-input',
  'searchbox-caret-selection',
  'long-page-scroll',
  'slider-drag',
  'text-selection-drag',
  'drag-mouse-move',
  'tab-switch-surface-continuity',
  'surface-resize-reload-continuity',
  'navigation-history-reload',
];

type CoverageGapSummary = {
  status: 'complete' | 'blocked';
  blockedReason?: string;
  categories: Array<{
    category: BottleneckCategory;
    sampleCount: number;
    covered: boolean;
  }>;
  interactions: Array<{
    class: InteractionCoverageClass;
    covered: boolean;
    evidenceCount: number;
  }>;
  nativeEvidence: {
    liveSurfaceTransport: string;
    frameTransport?: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
    sameLiveSurfaceRef: boolean;
    rightPaneNativeEvidence: boolean;
    legacyFallbackObserved: boolean;
  };
};
type NativeRightPaneEvidence = CoverageGapSummary['nativeEvidence'];

type AuditFixtureEvent = {
  type: string;
  path: string;
  valueLength?: number;
  valueHash?: string;
  selectionStart?: number;
  selectionEnd?: number;
  selectionLength?: number;
  selectionHash?: string;
  sliderValue?: number;
  count?: number;
  maxScrollY?: number;
  x?: number;
  y?: number;
};

type MetricSample = {
  category: BottleneckCategory;
  label: string;
  durationMs: number;
};

type BottleneckRankingEntry = {
  rank: number;
  category: BottleneckCategory;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  sampleLabels: string[];
};

type TimingCategorySummary = {
  category: BottleneckCategory;
  sampleCount: number;
  totalMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  slowestLabel: string;
};

type TimingSummary = {
  totalSamples: number;
  totalMeasuredMs: number;
  categories: TimingCategorySummary[];
  slowestSample: {
    category: BottleneckCategory;
    label: string;
    durationMs: number;
  };
  network: {
    sampleCount: number;
    maxDurationMs: number;
    statusCodes: number[];
  };
  frameStream: {
    streamsOpened: number;
    framesReceived: number;
    binaryFramesReceived: number;
    firstFrameLatencyMs?: number;
    maxPayloadBytes: number;
  };
};

type BrowserHostNetworkSample = {
  endpoint: 'start' | 'session-action' | 'computer-use-action' | 'state' | 'frame';
  status: number;
  durationMs: number;
  action?: string;
  key?: string;
  textLength?: number;
  textHash?: string;
  capture?: string;
  paintAckSource?: string;
};

type FrameStreamStats = {
  streamsOpened: number;
  framesReceived: number;
  binaryFramesReceived: number;
  firstFrameLatencyMs?: number;
  maxPayloadBytes: number;
};

type RightPaneBoundedEvidence = {
  mutationCount: number;
  attachChanges: number;
  detachChanges: number;
  maxHostFrames: number;
  maxNativeSurfaces: number;
  sessionIds: string[];
  liveSurfaceRefs: string[];
  frameStreamRefs: string[];
  liveSurfaceTransports: string[];
  frameTransports: string[];
  renderers: string[];
  browserStates: string[];
  iframeSurfaces: number;
  proxySurfaces: number;
  dataImageSurfaces: number;
};

type BrowserPaneBottleneckAuditManifest = {
  schemaVersion: typeof AUDIT_SCHEMA;
  status: 'passed' | 'blocked';
  refsFirst: true;
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  targetEvidence: {
    mode: 'resolver-fixture' | 'blocked';
    hostRef: string;
    originRef: string;
    requestedUrlLength?: number;
    requestedUrlHash?: string;
    finalUrlLength?: number;
    finalUrlHash?: string;
    resolverRuleApplied: boolean;
    realExternalSiteClaim: false;
    hardcodedSitePassClaim: false;
    rawUrlCaptured: false;
    allowedUse: 'right-pane-product-path-contract-not-external-web-pass' | 'blocked-no-real-product-evidence';
  };
  blockedReason?: string;
  interactionCoverage: {
    classes: InteractionCoverageClass[];
    eventTypes: string[];
    eventPaths: string[];
    input: {
      initialLength: number;
      initialHash: string;
      afterBackspaceLength: number;
      afterBackspaceHash: string;
      finalLength: number;
      finalHash: string;
    };
    scroll: {
      maxScrollY: number;
      scrollEvents: number;
    };
    searchboxCaret: {
      focused: boolean;
      finalSelectionStart?: number;
      finalSelectionEnd?: number;
      finalSelectionLength?: number;
      selectedTextHash?: string;
      evidenceSource: 'fixture-selection-event';
    };
    slider: {
      inputEvents: number;
      maxValue?: number;
      evidenceSource: 'fixture-input-event';
    };
    textSelection: {
      selectionEvents: number;
      maxSelectionLength: number;
      selectionHash?: string;
      evidenceSource: 'fixture-selectionchange-event';
    };
    drag: {
      fixturePointerMoveEvents: number;
      browserHostRouteActions: string[];
      fixtureDragUpObserved: boolean;
      evidenceSource: 'browser-host-action';
    };
    surfaceContinuity: {
      sameSessionAcrossResize: boolean;
      sameLiveSurfaceAcrossResize: boolean;
      sameSessionAcrossTabSwitch: boolean;
      sameLiveSurfaceAcrossTabSwitch: boolean;
      sameLiveSurfaceAcrossReload: boolean;
      checkpointLabels: string[];
      hiddenKeyboardPathAfterTabReturn?: string;
      maxHostFrames: number;
      detachChanges: number;
      evidenceSource: 'right-pane-observer-and-browser-host-state';
    };
  };
  browserHostSession: {
    id: string;
    owner: string;
    status: string;
    transport?: string;
    liveSurfaceTransport?: string;
    frameTransport?: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
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
  liveAcceptance: BrowserPaneLiveAcceptance;
  coverageGaps: CoverageGapSummary;
  bottleneckRanking: BottleneckRankingEntry[];
  timingSummary: TimingSummary;
  boundedMetrics: {
    totalSamples: number;
    maxAllowedSampleMs: number;
    maxManifestBytes: number;
    maxNetworkSamples: number;
    maxSampleLabelsPerCategory: number;
    maxRightPaneRefCount: number;
    networkSamples: BrowserHostNetworkSample[];
    frameStream: FrameStreamStats;
    rightPane: RightPaneBoundedEvidence;
  };
  forbiddenEvidence: {
    rawDom: false;
    base64: false;
    rawScreenshot: false;
    fixtureDomRead: false;
    iframe: false;
    proxy: false;
    rawCurrentRunPayload: false;
    rawProviderPayload: false;
  };
  verificationCommand: string;
};

type RightPaneAuditObserverState = {
  mutationCount: number;
  attachChanges: number;
  detachChanges: number;
  maxHostFrames: number;
  maxNativeSurfaces: number;
  lastHostFrameSignature: string;
  sessionIds: string[];
  liveSurfaceRefs: string[];
  frameStreamRefs: string[];
  liveSurfaceTransports: string[];
  frameTransports: string[];
  renderers: string[];
  browserStates: string[];
  iframeSurfaces: number;
  proxySurfaces: number;
  dataImageSurfaces: number;
};

type RightPaneAuditObserver = {
  state: RightPaneAuditObserverState;
  observer: MutationObserver;
};

type SurfaceContinuityCheckpoint = {
  label: 'before-resize' | 'after-resize' | 'after-tab-return' | 'after-reload';
  sessionId: string;
  liveSurfaceRef: string;
  frameStreamRef?: string;
  hiddenKeyboardPath?: string;
  hostFrameCount: number;
  browserState?: string;
};

declare global {
  interface Window {
    __sciforgeBrowserPaneBottleneckAudit?: RightPaneAuditObserver;
  }
}

test('SciForge Browser pane dogfood emits a bounded bottleneck ranking for real right-pane interactions', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    const blockedReason = `missing-browser-executable:${hashText(browserExecutable)}`;
    await writeBlockedBottleneckManifest(blockedReason);
    console.log(`[blocked] Browser pane bottleneck audit ${JSON.stringify({
      reason: blockedReason,
      manifestPath: 'docs/test-artifacts/browser-pane-bottleneck-audit/manifest.json',
    })}`);
    return;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-browser-pane-bottleneck-audit-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const fixturePort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const fixtureOrigin = `http://${FIXTURE_HOST}:${fixturePort}`;
  const targetUrl = `${fixtureOrigin}/audit`;
  const runId = `browser-pane-bottleneck-audit-${Date.now().toString(36)}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;
  let page: Page = undefined as unknown as Page;
  let fixture: Awaited<ReturnType<typeof startBottleneckFixture>> | undefined;
  const metrics = new BottleneckMetrics();
  let networkRecorder: ReturnType<typeof recordBrowserHostNetwork> = undefined as unknown as ReturnType<typeof recordBrowserHostNetwork>;
  let frameStream: ReturnType<typeof recordFrameStreamStats> = undefined as unknown as ReturnType<typeof recordFrameStreamStats>;
  const surfaceCheckpoints: SurfaceContinuityCheckpoint[] = [];
  let latestSession: JsonRecord = {};

  await mkdir(workspacePath);
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    workspaceWriterBaseUrl: writerUrl,
    workspacePath,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    theme: 'dark',
    modelProvider: 'bottleneck-local',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  }), 'utf8');

  try {
    fixture = await startBottleneckFixture(fixturePort);
    const fixtureServer = fixture;
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
    children.push(spawnProcess('npm', ['run', 'workspace:server', '--silent'], commonEnv));
    await waitForHttp(`${writerUrl}/health`, 30_000);
    children.push(spawnProcess('npm', ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], commonEnv));
    await waitForHttp(uiUrl, 45_000);

    browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const activePage = await context.newPage();
    page = activePage;
    networkRecorder = recordBrowserHostNetwork(activePage, metrics);
    frameStream = recordFrameStreamStats(activePage, metrics);
    if (!networkRecorder || !frameStream) {
      throw new Error('Browser pane bottleneck audit failed to initialize browser instrumentation.');
    }

    await activePage.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await activePage.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });

    await ensureBrowserPane(activePage);
    await installRightPaneObserver(activePage);
    const surface = activePage.locator('.right-pane-browser-surface');

    await openBrowserPaneUrl(surface, targetUrl);
    await metrics.measure('surface-attach', 'open-audit-surface-ready', async () => {
      await waitForWorkbenchUrl(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/audit`));
    });
    let host = await waitForKeyboardHostFrame(surface, 'initial-audit-frame', metrics);
    const openedSession = await currentBrowserHostSession(activePage, writerUrl, workspacePath, metrics, 'state-after-open');
    latestSession = openedSession;
    assert.ok(stringField(openedSession.id), 'opened BrowserHostSession should expose an id');

    await metrics.measure('input-routing', 'focus-audit-input-through-host-frame', async () => {
      await clickHostPoint(activePage, host.visualFrame, 148, 72);
      await waitForFixtureEvent(fixtureServer.url, (event) => event.type === 'audit-focus', 15_000, 'audit input focus');
    });
    await waitForReactRerenderQuiet(activePage, metrics, 'after-focus');

    await metrics.measure('input-routing', 'continuous-input-insert-text', async () => {
      await activePage.keyboard.insertText(INPUT_TEXT);
      await waitForFixtureEvent(
        fixtureServer.url,
        (event) => event.type === 'audit-input' && event.valueLength === INPUT_TEXT.length && event.valueHash === hashText(INPUT_TEXT),
        30_000,
        'initial continuous input',
      );
    });
    await metrics.measure('input-routing', 'continuous-input-edit-retype-and-caret-selection', async () => {
      for (let index = 0; index < BACKSPACE_COUNT; index += 1) {
        await activePage.keyboard.press('Backspace');
      }
      await waitForFixtureEvent(
        fixtureServer.url,
        (event) => event.type === 'audit-input' && event.valueLength === EXPECTED_AFTER_BACKSPACE.length && event.valueHash === hashText(EXPECTED_AFTER_BACKSPACE),
        30_000,
        'backspace input update',
      );
      await activePage.keyboard.insertText(RETYPE_SUFFIX);
      await waitForFixtureEvent(
        fixtureServer.url,
        (event) => event.type === 'audit-input' && event.valueLength === EXPECTED_FINAL_INPUT.length && event.valueHash === hashText(EXPECTED_FINAL_INPUT),
        30_000,
        'final retyped input update',
      );
      await activePage.keyboard.press('Shift+ArrowLeft');
      await activePage.keyboard.press('Shift+ArrowLeft');
      await waitForFixtureEvent(
        fixtureServer.url,
        (event) => event.type === 'audit-selection' && event.selectionLength === 2,
        30_000,
        'searchbox caret selection',
      );
    });
    await waitForFrameCaptureReady(surface, 'after-continuous-input', metrics);
    await waitForReactRerenderQuiet(activePage, metrics, 'after-continuous-input');

    await metrics.measure('input-routing', 'slider-drag-route', async () => {
      await dragHostPoints(activePage, host.visualFrame, [
        { x: 120, y: 190 },
        { x: 220, y: 190 },
        { x: 330, y: 190 },
        { x: 450, y: 190 },
      ]);
      await waitForFixtureEvent(
        fixtureServer.url,
        (event) => event.type === 'audit-slider-input' && (event.sliderValue ?? 0) >= 60,
        30_000,
        'slider drag input',
      );
    });
    await waitForFrameCaptureReady(surface, 'after-slider-drag', metrics);
    await waitForReactRerenderQuiet(activePage, metrics, 'after-slider-drag');

    await metrics.measure('input-routing', 'text-selection-drag-route', async () => {
      await dragHostPoints(activePage, host.visualFrame, [
        { x: 118, y: 231 },
        { x: 178, y: 231 },
        { x: 250, y: 231 },
        { x: 330, y: 231 },
      ]);
      await waitForFixtureEvent(
        fixtureServer.url,
        (event) => event.type === 'audit-text-selection' && (event.selectionLength ?? 0) >= 4,
        30_000,
        'text selection drag',
      );
    });
    await waitForFrameCaptureReady(surface, 'after-text-selection-drag', metrics);
    await waitForReactRerenderQuiet(activePage, metrics, 'after-text-selection-drag');

    await metrics.measure('input-routing', 'long-page-wheel-scroll-route', async () => {
      await host.visualFrame.hover();
      await activePage.mouse.wheel(0, 1600);
      await waitForFixtureEvent(
        fixtureServer.url,
        (event) => event.type === 'audit-scroll' && (event.maxScrollY ?? 0) >= 900,
        30_000,
        'long page scroll',
      );
    });
    await waitForFrameCaptureReady(surface, 'after-long-scroll', metrics);
    await waitForReactRerenderQuiet(activePage, metrics, 'after-long-scroll');

    await metrics.measure('input-routing', 'drag-and-continuous-mouse-move-route', async () => {
      await dragHostPoints(activePage, host.visualFrame, [
        { x: 80, y: 100 },
        { x: 120, y: 114 },
        { x: 160, y: 128 },
        { x: 210, y: 142 },
      ]);
      await networkRecorder!.waitForAction('cursor', 10_000, 'drag mouse cursor BrowserHostSession ACK');
      await networkRecorder!.waitForAction('mouse-up', 10_000, 'drag mouse-up BrowserHostSession ACK');
    });
    await waitForFrameCaptureReady(surface, 'after-drag-route', metrics);
    await waitForReactRerenderQuiet(activePage, metrics, 'after-drag-route');

    const sessionBeforeResize = await currentBrowserHostSession(activePage, writerUrl, workspacePath, metrics, 'state-before-resize');
    latestSession = sessionBeforeResize;
    const liveSurfaceBeforeResize = stringField(sessionBeforeResize.liveSurfaceRef);
    surfaceCheckpoints.push(await collectSurfaceContinuityCheckpoint(activePage, surface, sessionBeforeResize, 'before-resize'));
    await metrics.measure('surface-attach', 'right-pane-resize-keeps-session-surface', async () => {
      await activePage.setViewportSize({ width: 1180, height: 900 });
      await waitForWorkbenchAttachedUrl(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/audit`));
      await waitForFrameCaptureReady(surface, 'after-right-pane-resize', metrics);
      const sessionAfterResize = await currentBrowserHostSession(activePage, writerUrl, workspacePath, metrics, 'state-after-resize');
      latestSession = sessionAfterResize;
      assert.equal(stringField(sessionAfterResize.id), stringField(sessionBeforeResize.id), 'resize must keep the BrowserHostSession owner');
      assert.equal(stringField(sessionAfterResize.liveSurfaceRef), liveSurfaceBeforeResize, 'resize must keep the same live surface ref');
      surfaceCheckpoints.push(await collectSurfaceContinuityCheckpoint(activePage, surface, sessionAfterResize, 'after-resize'));
    });

    await metrics.measure('surface-attach', 'right-pane-tab-switch-keeps-session-surface', async () => {
      await activateRightPaneTab(activePage, 'Results');
      await activateRightPaneTab(activePage, 'Browser');
      await activePage.getByTestId('right-pane-browser-tool').waitFor({ state: 'visible', timeout: 20_000 });
      await waitForWorkbenchAttachedUrl(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/audit`));
      host = await waitForKeyboardHostFrame(surface, 'after-right-pane-tab-return', metrics);
      const sessionAfterTabReturn = await currentBrowserHostSession(activePage, writerUrl, workspacePath, metrics, 'state-after-tab-return');
      latestSession = sessionAfterTabReturn;
      assert.equal(stringField(sessionAfterTabReturn.id), stringField(sessionBeforeResize.id), 'tab switch must keep the BrowserHostSession owner');
      assert.equal(stringField(sessionAfterTabReturn.liveSurfaceRef), liveSurfaceBeforeResize, 'tab switch must keep the same live surface ref');
      surfaceCheckpoints.push(await collectSurfaceContinuityCheckpoint(activePage, surface, sessionAfterTabReturn, 'after-tab-return'));
    });

    await openBrowserPaneUrl(surface, `${fixtureOrigin}/details`);
    await metrics.measure('navigation', 'address-navigation-details', async () => {
      await waitForWorkbenchUrl(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/details`));
      await waitForSessionUrl(activePage, writerUrl, workspacePath, /\/details$/, metrics, 'state-details-url');
      await waitForFixtureEvent(fixtureServer.url, (event) => event.type === 'page-load' && event.path === '/details', 30_000, 'details page load');
    });
    host = await waitForKeyboardHostFrame(surface, 'details-frame', metrics);
    await waitForReactRerenderQuiet(activePage, metrics, 'after-details-navigation');

    await metrics.measure('navigation', 'toolbar-back-to-audit', async () => {
      await clickBrowserCommand(surface, 'Back');
      await waitForWorkbenchUrl(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/audit`));
      await waitForSessionAction(activePage, writerUrl, workspacePath, 'back', metrics, 'state-after-back');
    });
    await metrics.measure('navigation', 'toolbar-forward-to-details', async () => {
      await clickBrowserCommand(surface, 'Forward');
      await waitForWorkbenchUrl(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/details`));
      await waitForSessionAction(activePage, writerUrl, workspacePath, 'forward', metrics, 'state-after-forward');
    });
    await metrics.measure('navigation', 'toolbar-reload-details', async () => {
      await clickBrowserCommand(surface, 'Reload');
      await waitForSessionAction(activePage, writerUrl, workspacePath, 'reload', metrics, 'state-after-reload');
      await waitForWorkbenchUrl(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/details`));
      const sessionAfterReload = await currentBrowserHostSession(activePage, writerUrl, workspacePath, metrics, 'state-after-reload-live-surface');
      latestSession = sessionAfterReload;
      assert.equal(stringField(sessionAfterReload.liveSurfaceRef), liveSurfaceBeforeResize, 'reload must keep the same live surface ref');
      surfaceCheckpoints.push(await collectSurfaceContinuityCheckpoint(activePage, surface, sessionAfterReload, 'after-reload'));
    });
    await waitForFrameCaptureReady(surface, 'after-history-and-reload', metrics);
    await waitForReactRerenderQuiet(activePage, metrics, 'after-history-and-reload');

    await networkRecorder!.drain();
    const finalSession = await currentBrowserHostSession(activePage, writerUrl, workspacePath, metrics, 'final-state');
    latestSession = finalSession;
    assert.ok(stringField(finalSession.id), 'final BrowserHostSession should expose an id');

    const events = await fetchFixtureEvents(fixtureServer.url);
    const manifest = buildManifest({
      runId,
      fixtureOrigin,
      targetUrl,
      session: finalSession,
      events,
      metrics: metrics.samples,
      networkSamples: networkRecorder!.samples,
      frameStream: frameStream!.stats,
      rightPane: await collectRightPaneEvidence(page),
      surfaceCheckpoints,
    });
    assertBrowserPaneBottleneckAuditManifest(manifest);
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[ok] Browser pane bottleneck ranking ${JSON.stringify({
      categories: manifest.bottleneckRanking.map((entry) => `${entry.rank}:${entry.category}:${entry.p95Ms}`),
      interactions: manifest.interactionCoverage.classes,
      frameStreamFrames: manifest.boundedMetrics.frameStream.framesReceived,
      manifestPath: 'docs/test-artifacts/browser-pane-bottleneck-audit/manifest.json',
    })}`);
  } catch (error) {
    const blockedReason = `run-blocked:${hashText(error instanceof Error ? error.message : String(error))}`;
    await networkRecorder?.drain().catch(() => undefined);
    const rightPane = page
      ? await collectRightPaneEvidence(page).catch(() => emptyRightPaneEvidence())
      : emptyRightPaneEvidence();
    const events = fixture
      ? await fetchFixtureEvents(fixture.url).catch(() => [])
      : [];
    await writeBlockedBottleneckManifest(blockedReason, {
      runId,
      targetUrl,
      targetOrigin: fixtureOrigin,
      resolverRuleApplied: Boolean(fixture),
      session: latestSession,
      events,
      metrics: metrics.samples,
      networkSamples: networkRecorder?.samples ?? [],
      frameStream: frameStream?.stats ?? emptyFrameStreamStats(),
      rightPane,
      surfaceCheckpoints,
    });
    console.log(`[blocked] Browser pane bottleneck audit ${JSON.stringify({
      reason: blockedReason,
      manifestPath: 'docs/test-artifacts/browser-pane-bottleneck-audit/manifest.json',
    })}`);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
    await fixture?.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

class BottleneckMetrics {
  readonly samples: MetricSample[] = [];

  async measure<T>(category: BottleneckCategory, label: string, task: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      this.add(category, label, Date.now() - startedAt);
    }
  }

  add(category: BottleneckCategory, label: string, durationMs: number): void {
    this.samples.push({
      category,
      label,
      durationMs: Math.max(0, Math.round(durationMs)),
    });
  }

  ranking(requiredCategories: BottleneckCategory[] = REQUIRED_BOTTLENECK_CATEGORIES): BottleneckRankingEntry[] {
    const groups = new Map<BottleneckCategory, MetricSample[]>();
    for (const sample of this.samples) {
      groups.set(sample.category, [...(groups.get(sample.category) ?? []), sample]);
    }
    for (const category of requiredCategories) {
      if (!groups.has(category)) groups.set(category, []);
    }
    return [...groups.entries()]
      .map(([category, samples]) => {
        const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
        const maxMs = durations[durations.length - 1] ?? 0;
        return {
          rank: 0,
          category,
          sampleCount: samples.length,
          p50Ms: percentile(durations, 0.5),
          p95Ms: percentile(durations, 0.95),
          maxMs,
          sampleLabels: boundedUnique(samples.map((sample) => sample.label), 8),
        };
      })
      .sort((left, right) => right.p95Ms - left.p95Ms || right.maxMs - left.maxMs || left.category.localeCompare(right.category))
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
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

async function waitForKeyboardHostFrame(surface: Locator, label: string, metrics: BottleneckMetrics) {
  const frame = surface.locator('.browser-workbench-host-frame[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"][data-browser-single-interactive-truth="true"]').first();
  await frame.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await frame.getAttribute('data-browser-host-surface'), 'browser-host-session');
  assert.equal(await frame.getAttribute('data-browser-frame-transport'), 'native-embedded');
  assert.match(await frame.getAttribute('data-browser-live-surface-ref') ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  await waitForFrameCaptureReady(surface, label, metrics);
  return { frame, visualFrame: frame };
}

async function waitForFrameCaptureReady(surface: Locator, label: string, metrics: BottleneckMetrics) {
  await metrics.measure('frame-capture', label, async () => {
    await surface.page().waitForFunction(() => {
      const root = document.querySelector('.right-pane-browser-surface');
      const nativeSurface = root?.querySelector<HTMLElement>('[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"][data-browser-single-interactive-truth="true"]');
      const liveSurfaceRef = nativeSurface?.getAttribute('data-browser-live-surface-ref') ?? '';
      return liveSurfaceRef.startsWith('browser-host-session:');
    }, undefined, { timeout: 30_000 });
  });
}

async function waitForWorkbenchUrl(surface: Locator, expectedUrl: RegExp) {
  await surface.page().waitForFunction(({ source, flags }) => {
    const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
    const state = viewer?.getAttribute('data-browser-state');
    const url = viewer?.querySelector('header p')?.textContent ?? '';
    return state === 'ready' && new RegExp(source, flags).test(url);
  }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 45_000 });
}

async function waitForWorkbenchAttachedUrl(surface: Locator, expectedUrl: RegExp) {
  await surface.page().waitForFunction(({ source, flags }) => {
    const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
    const state = viewer?.getAttribute('data-browser-state');
    const url = viewer?.querySelector('header p')?.textContent ?? '';
    return (state === 'ready' || state === 'loading') && new RegExp(source, flags).test(url);
  }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 45_000 });
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

async function currentBrowserHostSession(
  page: Page,
  writerUrl: string,
  workspacePath: string,
  metrics: BottleneckMetrics,
  label: string,
): Promise<JsonRecord> {
  return metrics.measure('state-polling', label, async () => {
    const liveSurfaceRef = await page.locator('.right-pane-browser-surface [data-browser-live-surface-ref^="browser-host-session:"]').first().getAttribute('data-browser-live-surface-ref');
    const sessionId = /^browser-host-session:([^/]+)\//.exec(liveSurfaceRef ?? '')?.[1];
    assert.ok(sessionId, `Missing BrowserHostSession ref: ${String(liveSurfaceRef)}`);
    const url = new URL(`${writerUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/state`);
    url.searchParams.set('workspacePath', workspacePath);
    const json = await fetchJson(url.href);
    const session = recordField(json.session);
    assert.ok(session, 'BrowserHostSession state response must include session');
    return session;
  });
}

async function waitForSessionUrl(
  page: Page,
  writerUrl: string,
  workspacePath: string,
  pattern: RegExp,
  metrics: BottleneckMetrics,
  label: string,
): Promise<JsonRecord> {
  const deadline = Date.now() + 30_000;
  let lastUrl = '';
  while (Date.now() < deadline) {
    const session = await currentBrowserHostSession(page, writerUrl, workspacePath, metrics, label);
    lastUrl = stringField(session.url);
    if (pattern.test(lastUrl)) return session;
    await delay(250);
  }
  throw new Error(`Timed out waiting for BrowserHostSession URL ${pattern}: lastHash=${hashText(lastUrl)}`);
}

async function waitForSessionAction(
  page: Page,
  writerUrl: string,
  workspacePath: string,
  action: string,
  metrics: BottleneckMetrics,
  label: string,
): Promise<JsonRecord> {
  const deadline = Date.now() + 30_000;
  let lastAction = '';
  while (Date.now() < deadline) {
    const session = await currentBrowserHostSession(page, writerUrl, workspacePath, metrics, label);
    lastAction = stringField(recordField(session.lastActionTiming)?.action);
    if (lastAction === action && session.status === 'ready') return session;
    await delay(250);
  }
  throw new Error(`Timed out waiting for BrowserHostSession action ${action}: last=${lastAction}`);
}

async function waitForReactRerenderQuiet(page: Page, metrics: BottleneckMetrics, label: string) {
  await metrics.measure('react-rerender', label, async () => {
    const deadline = Date.now() + 5_000;
    let previous = await rightPaneMutationCount(page);
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      await delay(50);
      const current = await rightPaneMutationCount(page);
      if (current !== previous) {
        previous = current;
        stableSince = Date.now();
      }
      if (Date.now() - stableSince >= 150) return;
    }
    throw new Error(`Right pane did not settle after ${label}`);
  });
}

async function installRightPaneObserver(page: Page) {
  await page.evaluate(`
  (() => {
    const surface = document.querySelector('.right-pane-browser-surface');
    if (!surface) throw new Error('Missing right-pane browser surface for bottleneck observer');
    if (window.__sciforgeBrowserPaneBottleneckAudit && window.__sciforgeBrowserPaneBottleneckAudit.observer) {
      window.__sciforgeBrowserPaneBottleneckAudit.observer.disconnect();
    }
    const state = {
      mutationCount: 0,
      attachChanges: 0,
      detachChanges: 0,
      maxHostFrames: 0,
      maxNativeSurfaces: 0,
      lastHostFrameSignature: '',
      sessionIds: [],
      liveSurfaceRefs: [],
      frameStreamRefs: [],
      liveSurfaceTransports: [],
      frameTransports: [],
      renderers: [],
      browserStates: [],
      iframeSurfaces: 0,
      proxySurfaces: 0,
      dataImageSurfaces: 0,
    };
    function pushUnique(values, value) {
      if (value && !values.includes(value) && values.length < 24) values.push(value);
    }
    function collect() {
      const currentSurface = document.querySelector('.right-pane-browser-surface');
      if (!currentSurface) return;
      const frames = Array.from(currentSurface.querySelectorAll('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]'));
      const nativeFrames = Array.from(currentSurface.querySelectorAll('.browser-workbench-host-frame[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"]'));
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
      state.maxNativeSurfaces = Math.max(state.maxNativeSurfaces, nativeFrames.length);
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
        pushUnique(state.liveSurfaceTransports, frame.getAttribute('data-browser-live-surface-transport') || '');
        pushUnique(state.frameTransports, frame.getAttribute('data-browser-frame-transport') || '');
        pushUnique(state.renderers, frame.getAttribute('data-browser-frame-renderer') || 'image-blob');
      }
      const viewer = currentSurface.querySelector('.browser-workbench-viewer');
      pushUnique(state.browserStates, viewer ? viewer.getAttribute('data-browser-state') || '' : '');
      state.iframeSurfaces = currentSurface.querySelectorAll('iframe').length;
      state.proxySurfaces = currentSurface.querySelectorAll('iframe[src^="/api/sciforge/browser/proxy"]').length;
      state.dataImageSurfaces = currentSurface.querySelectorAll('img[src^="data:"]').length;
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
        'data-browser-live-surface-transport',
        'data-browser-frame-stream-ref',
        'data-browser-frame-transport',
        'data-browser-frame-renderer',
        'data-browser-state',
        'src',
      ],
    });
    window.__sciforgeBrowserPaneBottleneckAudit = { state, observer };
  })()
  `);
}

async function rightPaneMutationCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__sciforgeBrowserPaneBottleneckAudit?.state.mutationCount ?? 0);
}

async function collectRightPaneEvidence(page: Page): Promise<RightPaneBoundedEvidence> {
  return page.evaluate(() => {
    const state = window.__sciforgeBrowserPaneBottleneckAudit?.state;
    if (!state) {
      return {
        mutationCount: 0,
        attachChanges: 0,
        detachChanges: 0,
        maxHostFrames: 0,
        maxNativeSurfaces: 0,
        sessionIds: [],
        liveSurfaceRefs: [],
        frameStreamRefs: [],
        liveSurfaceTransports: [],
        frameTransports: [],
        renderers: [],
        browserStates: [],
        iframeSurfaces: 0,
        proxySurfaces: 0,
        dataImageSurfaces: 0,
      };
    }
    return {
      mutationCount: state.mutationCount,
      attachChanges: state.attachChanges,
      detachChanges: state.detachChanges,
      maxHostFrames: state.maxHostFrames,
      maxNativeSurfaces: state.maxNativeSurfaces,
      sessionIds: state.sessionIds,
      liveSurfaceRefs: state.liveSurfaceRefs,
      frameStreamRefs: state.frameStreamRefs,
      liveSurfaceTransports: state.liveSurfaceTransports,
      frameTransports: state.frameTransports,
      renderers: state.renderers,
      browserStates: state.browserStates,
      iframeSurfaces: state.iframeSurfaces,
      proxySurfaces: state.proxySurfaces,
      dataImageSurfaces: state.dataImageSurfaces,
    };
  });
}

async function collectSurfaceContinuityCheckpoint(
  page: Page,
  surface: Locator,
  session: JsonRecord,
  label: SurfaceContinuityCheckpoint['label'],
): Promise<SurfaceContinuityCheckpoint> {
  const dom = await page.evaluate(() => {
    const currentSurface = document.querySelector('.right-pane-browser-surface');
    const frames = currentSurface
      ? Array.from(currentSurface.querySelectorAll<HTMLElement>('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]'))
      : [];
    const firstFrame = frames[0];
    const viewer = currentSurface?.querySelector<HTMLElement>('.browser-workbench-viewer');
    return {
      hostFrameCount: frames.length,
      liveSurfaceRef: firstFrame?.getAttribute('data-browser-live-surface-ref') || '',
      frameStreamRef: firstFrame?.getAttribute('data-browser-frame-stream-ref') || '',
      hiddenKeyboardPath: firstFrame?.getAttribute('data-browser-live-surface-transport') || '',
      browserState: viewer?.getAttribute('data-browser-state') || '',
    };
  });
  const sessionId = stringField(session.id);
  const liveSurfaceRef = stringField(session.liveSurfaceRef) || dom.liveSurfaceRef;
  assert.equal(dom.hostFrameCount, 1, `${label}: Browser pane must expose one host frame`);
  assert.equal(dom.liveSurfaceRef, liveSurfaceRef, `${label}: DOM live surface ref must match BrowserHostSession state`);
  await surface.locator('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]').first().waitFor({ state: 'visible', timeout: 10_000 });
  return {
    label,
    sessionId,
    liveSurfaceRef,
    frameStreamRef: dom.frameStreamRef || undefined,
    hiddenKeyboardPath: dom.hiddenKeyboardPath || undefined,
    hostFrameCount: dom.hostFrameCount,
    browserState: dom.browserState || undefined,
  };
}

function recordBrowserHostNetwork(page: Page, metrics: BottleneckMetrics): {
  samples: BrowserHostNetworkSample[];
  waitForAction(action: string, timeoutMs: number, label: string): Promise<void>;
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
    async waitForAction(action: string, timeoutMs: number, label: string) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await Promise.allSettled([...pending]);
        if (samples.some((sample) => sample.action === action)) return;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${label}; seen=${JSON.stringify(samples.map((sample) => ({
        endpoint: sample.endpoint,
        action: sample.action,
        status: sample.status,
        durationMs: sample.durationMs,
      })).slice(-20))}`);
    },
    async drain() {
      await Promise.allSettled([...pending]);
    },
  };
}

function recordFrameStreamStats(page: Page, metrics: BottleneckMetrics): { stats: FrameStreamStats } {
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
  const action = stringField(hostAction?.action) || stringField(timing?.action);
  const text = stringField(hostAction?.text);
  return {
    endpoint,
    status,
    durationMs: Math.round(durationMs),
    action: action || undefined,
    key: action === 'press' ? stringField(hostAction?.key) || undefined : undefined,
    textLength: action === 'type' ? text.length : undefined,
    textHash: action === 'type' ? hashText(text) : undefined,
    capture: stringField(timing?.capture) || undefined,
    paintAckSource: stringField(timing?.paintAckSource) || undefined,
  };
}

function networkMetricCategory(sample: BrowserHostNetworkSample): BottleneckCategory | undefined {
  if (sample.endpoint === 'start') return 'surface-attach';
  if (sample.endpoint === 'state') return 'state-polling';
  if (sample.endpoint === 'session-action' && ['navigate', 'back', 'forward', 'reload'].includes(sample.action ?? '')) return 'navigation';
  if (sample.endpoint === 'computer-use-action') return 'input-routing';
  return undefined;
}

function buildTimingSummary(
  samples: MetricSample[],
  networkSamples: BrowserHostNetworkSample[],
  frameStream: FrameStreamStats,
  requiredCategories: BottleneckCategory[] = REQUIRED_BOTTLENECK_CATEGORIES,
): TimingSummary {
  const groups = new Map<BottleneckCategory, MetricSample[]>();
  for (const sample of samples) {
    groups.set(sample.category, [...(groups.get(sample.category) ?? []), sample]);
  }
  for (const category of requiredCategories) {
    if (!groups.has(category)) groups.set(category, []);
  }
  const categories = [...groups.entries()]
    .map(([category, categorySamples]) => {
      const durations = categorySamples.map((sample) => sample.durationMs).sort((left, right) => left - right);
      const slowest = categorySamples.reduce<MetricSample | undefined>((current, next) => {
        if (!current || next.durationMs > current.durationMs) return next;
        return current;
      }, undefined);
      return {
        category,
        sampleCount: categorySamples.length,
        totalMs: durations.reduce((total, value) => total + value, 0),
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs: durations[durations.length - 1] ?? 0,
        slowestLabel: slowest?.label ?? 'none',
      };
    })
    .sort((left, right) => right.p95Ms - left.p95Ms || right.maxMs - left.maxMs || left.category.localeCompare(right.category));
  const slowestSample = samples.reduce<MetricSample | undefined>((current, next) => {
    if (!current || next.durationMs > current.durationMs) return next;
    return current;
  }, undefined);
  return {
    totalSamples: samples.length,
    totalMeasuredMs: samples.reduce((total, sample) => total + sample.durationMs, 0),
    categories,
    slowestSample: slowestSample ?? { category: 'input-routing', label: 'none', durationMs: 0 },
    network: {
      sampleCount: networkSamples.length,
      maxDurationMs: Math.max(0, ...networkSamples.map((sample) => sample.durationMs)),
      statusCodes: boundedUnique(networkSamples.map((sample) => sample.status).filter((status) => status > 0), 12).sort((left, right) => left - right),
    },
    frameStream: {
      streamsOpened: frameStream.streamsOpened,
      framesReceived: frameStream.framesReceived,
      binaryFramesReceived: frameStream.binaryFramesReceived,
      firstFrameLatencyMs: frameStream.firstFrameLatencyMs,
      maxPayloadBytes: frameStream.maxPayloadBytes,
    },
  };
}

function checkpointByLabel(
  checkpoints: SurfaceContinuityCheckpoint[],
  label: SurfaceContinuityCheckpoint['label'],
): SurfaceContinuityCheckpoint | undefined {
  return checkpoints.find((checkpoint) => checkpoint.label === label);
}

function sameCheckpointField<K extends keyof SurfaceContinuityCheckpoint>(
  before: SurfaceContinuityCheckpoint | undefined,
  after: SurfaceContinuityCheckpoint | undefined,
  field: K,
): boolean {
  return Boolean(before && after && before[field] && before[field] === after[field]);
}

function nativeRightPaneEvidence(
  session: JsonRecord,
  rightPane: RightPaneBoundedEvidence,
  surfaceCheckpoints: SurfaceContinuityCheckpoint[],
  frameTransport?: string,
): NativeRightPaneEvidence {
  const liveSurfaceRef = stringField(session.liveSurfaceRef);
  const liveSurfaceTransport = stringField(session.liveSurfaceTransport)
    || rightPane.liveSurfaceTransports.find((transport) => transport === 'native-embedded')
    || 'missing-native-attach';
  const observedFrameTransport = frameTransport
    || rightPane.frameTransports.find((transport) => transport === 'native-embedded')
    || rightPane.frameTransports[0]
    || undefined;
  const checkpointRefs = surfaceCheckpoints.map((checkpoint) => checkpoint.liveSurfaceRef).filter(Boolean);
  const sameCheckpointRef = checkpointRefs.length >= 4
    && new Set(checkpointRefs).size === 1
    && checkpointRefs[0] === liveSurfaceRef;
  const sessionRefObserved = Boolean(liveSurfaceRef) && rightPane.liveSurfaceRefs.includes(liveSurfaceRef);
  const legacyFallbackObserved = rightPane.iframeSurfaces > 0
    || rightPane.proxySurfaces > 0
    || rightPane.dataImageSurfaces > 0
    || rightPane.frameStreamRefs.length > 0
    || rightPane.liveSurfaceTransports.some(isLegacyLiveTransport)
    || rightPane.frameTransports.some(isLegacyLiveTransport);
  const rightPaneNativeEvidence = rightPane.maxHostFrames === 1
    && rightPane.maxNativeSurfaces === 1
    && sessionRefObserved
    && rightPane.liveSurfaceTransports.includes('native-embedded')
    && (rightPane.frameTransports.includes('native-embedded') || observedFrameTransport === 'native-embedded')
    && !legacyFallbackObserved;
  return {
    liveSurfaceTransport,
    frameTransport: observedFrameTransport,
    singleInteractiveTruth: session.singleInteractiveTruth === true,
    secondTruthSource: session.secondTruthSource === true,
    sameLiveSurfaceRef: sameCheckpointRef && sessionRefObserved,
    rightPaneNativeEvidence,
    legacyFallbackObserved,
  };
}

function isLegacyLiveTransport(value: string): boolean {
  return Boolean(value && value !== 'native-embedded');
}

function buildCoverageGaps(
  blockedReason: string | undefined,
  samples: MetricSample[],
  events: AuditFixtureEvent[],
  networkSamples: BrowserHostNetworkSample[],
  surfaceCheckpoints: SurfaceContinuityCheckpoint[],
  nativeEvidence: NativeRightPaneEvidence,
): CoverageGapSummary {
  const sampleCounts = new Map<BottleneckCategory, number>();
  for (const sample of samples) sampleCounts.set(sample.category, (sampleCounts.get(sample.category) ?? 0) + 1);
  const inputEvents = events.filter((event) => event.type === 'audit-input');
  const selectionEvents = events.filter((event) => event.type === 'audit-selection');
  const scrollEvents = events.filter((event) => event.type === 'audit-scroll');
  const sliderEvents = events.filter((event) => event.type === 'audit-slider-input');
  const textSelectionEvents = events.filter((event) => event.type === 'audit-text-selection');
  const dragMoveEvents = events.filter((event) => event.type === 'audit-pointer-move');
  const dragRouteEvents = networkSamples.filter((sample) => sample.endpoint === 'computer-use-action' && ['cursor', 'mouse-move', 'mouse-up'].includes(sample.action ?? ''));
  const checkpointLabels = new Set(surfaceCheckpoints.map((checkpoint) => checkpoint.label));
  const interactionCounts: Record<InteractionCoverageClass, number> = {
    'continuous-input': inputEvents.length,
    'searchbox-caret-selection': selectionEvents.length,
    'long-page-scroll': scrollEvents.filter((event) => (event.maxScrollY ?? 0) > 0).length,
    'slider-drag': sliderEvents.length,
    'text-selection-drag': textSelectionEvents.length,
    'drag-mouse-move': dragMoveEvents.length + dragRouteEvents.length,
    'tab-switch-surface-continuity': checkpointLabels.has('after-tab-return') ? 1 : 0,
    'surface-resize-reload-continuity': checkpointLabels.has('after-resize') && checkpointLabels.has('after-reload') ? 1 : 0,
    'navigation-history-reload': events.some((event) => event.type === 'page-load' && event.path === '/details') ? 1 : 0,
  };
  return {
    status: blockedReason ? 'blocked' : 'complete',
    blockedReason,
    categories: REQUIRED_BOTTLENECK_CATEGORIES.map((category) => {
      const sampleCount = sampleCounts.get(category) ?? 0;
      return { category, sampleCount, covered: sampleCount > 0 };
    }),
    interactions: REQUIRED_INTERACTION_COVERAGE.map((coverageClass) => {
      const evidenceCount = interactionCounts[coverageClass] ?? 0;
      return { class: coverageClass, covered: evidenceCount > 0, evidenceCount };
    }),
    nativeEvidence,
  };
}

function buildManifest(input: {
  runId: string;
  fixtureOrigin: string;
  targetUrl: string;
  session: JsonRecord;
  events: AuditFixtureEvent[];
  metrics: MetricSample[];
  networkSamples: BrowserHostNetworkSample[];
  frameStream: FrameStreamStats;
  rightPane: RightPaneBoundedEvidence;
  surfaceCheckpoints: SurfaceContinuityCheckpoint[];
}): BrowserPaneBottleneckAuditManifest {
  const metrics = new BottleneckMetrics();
  for (const sample of input.metrics) metrics.add(sample.category, sample.label, sample.durationMs);
  const bottleneckRanking = metrics.ranking();
  const timingSummary = buildTimingSummary(input.metrics, input.networkSamples, input.frameStream);
  const inputEvents = input.events.filter((event) => event.type === 'audit-input');
  const scrollEvents = input.events.filter((event) => event.type === 'audit-scroll');
  const selectionEvents = input.events.filter((event) => event.type === 'audit-selection');
  const sliderEvents = input.events.filter((event) => event.type === 'audit-slider-input');
  const textSelectionEvents = input.events.filter((event) => event.type === 'audit-text-selection');
  const dragMoveEvents = input.events.filter((event) => event.type === 'audit-pointer-move');
  const lastSelectionEvent = selectionEvents[selectionEvents.length - 1];
  const maxTextSelectionLength = Math.max(0, ...textSelectionEvents.map((event) => event.selectionLength ?? 0));
  const strongestTextSelection = textSelectionEvents.reduce<AuditFixtureEvent | undefined>((current, next) => {
    if (!current || (next.selectionLength ?? 0) > (current.selectionLength ?? 0)) return next;
    return current;
  }, undefined);
  const browserHostRouteActions = boundedUnique(input.networkSamples
    .filter((sample) => sample.endpoint === 'computer-use-action' && ['cursor', 'drag', 'mouse-down', 'mouse-move', 'mouse-up'].includes(sample.action ?? ''))
    .map((sample) => sample.action ?? 'unknown'), 8);
  const beforeResize = checkpointByLabel(input.surfaceCheckpoints, 'before-resize');
  const afterResize = checkpointByLabel(input.surfaceCheckpoints, 'after-resize');
  const afterTabReturn = checkpointByLabel(input.surfaceCheckpoints, 'after-tab-return');
  const afterReload = checkpointByLabel(input.surfaceCheckpoints, 'after-reload');
  const frameTransport = observedFrameTransport(input.session);
  const nativeEvidence = nativeRightPaneEvidence(input.session, input.rightPane, input.surfaceCheckpoints, frameTransport);
  const liveAcceptance = browserPaneLiveAcceptance(input.session, nativeEvidence);
  const targetUrlDigest = boundedUrlDigest(input.targetUrl);
  const finalUrl = stringField(input.session.url);
  const blockedReason = liveAcceptance.status === 'blocked' ? liveAcceptance.blockedReason : undefined;
  return {
    schemaVersion: AUDIT_SCHEMA,
    status: liveAcceptance.status,
    refsFirst: true,
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    targetEvidence: {
      mode: 'resolver-fixture',
      hostRef: `fixture-host:${hashText(FIXTURE_HOST)}`,
      originRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
      requestedUrlLength: targetUrlDigest.length,
      requestedUrlHash: targetUrlDigest.hash,
      finalUrlLength: finalUrl ? finalUrl.length : undefined,
      finalUrlHash: finalUrl ? hashText(finalUrl) : undefined,
      resolverRuleApplied: true,
      realExternalSiteClaim: false,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      allowedUse: 'right-pane-product-path-contract-not-external-web-pass',
    },
    blockedReason,
    interactionCoverage: {
      classes: REQUIRED_INTERACTION_COVERAGE,
      eventTypes: boundedUnique(input.events.map((event) => event.type), 24),
      eventPaths: boundedUnique(input.events.map((event) => event.path), 8),
      input: {
        initialLength: INPUT_TEXT.length,
        initialHash: hashText(INPUT_TEXT),
        afterBackspaceLength: EXPECTED_AFTER_BACKSPACE.length,
        afterBackspaceHash: hashText(EXPECTED_AFTER_BACKSPACE),
        finalLength: EXPECTED_FINAL_INPUT.length,
        finalHash: hashText(EXPECTED_FINAL_INPUT),
      },
      scroll: {
        maxScrollY: Math.max(0, ...scrollEvents.map((event) => event.maxScrollY ?? 0)),
        scrollEvents: scrollEvents.length,
      },
      searchboxCaret: {
        focused: input.events.some((event) => event.type === 'audit-focus'),
        finalSelectionStart: lastSelectionEvent?.selectionStart,
        finalSelectionEnd: lastSelectionEvent?.selectionEnd,
        finalSelectionLength: lastSelectionEvent?.selectionLength,
        selectedTextHash: lastSelectionEvent?.selectionHash,
        evidenceSource: 'fixture-selection-event',
      },
      slider: {
        inputEvents: sliderEvents.length,
        maxValue: Math.max(0, ...sliderEvents.map((event) => event.sliderValue ?? 0)),
        evidenceSource: 'fixture-input-event',
      },
      textSelection: {
        selectionEvents: textSelectionEvents.length,
        maxSelectionLength: maxTextSelectionLength,
        selectionHash: strongestTextSelection?.selectionHash,
        evidenceSource: 'fixture-selectionchange-event',
      },
      drag: {
        fixturePointerMoveEvents: dragMoveEvents.length,
        browserHostRouteActions,
        fixtureDragUpObserved: input.events.some((event) => event.type === 'audit-drag-up'),
        evidenceSource: 'browser-host-action',
      },
      surfaceContinuity: {
        sameSessionAcrossResize: sameCheckpointField(beforeResize, afterResize, 'sessionId'),
        sameLiveSurfaceAcrossResize: sameCheckpointField(beforeResize, afterResize, 'liveSurfaceRef'),
        sameSessionAcrossTabSwitch: sameCheckpointField(beforeResize, afterTabReturn, 'sessionId'),
        sameLiveSurfaceAcrossTabSwitch: sameCheckpointField(beforeResize, afterTabReturn, 'liveSurfaceRef'),
        sameLiveSurfaceAcrossReload: sameCheckpointField(beforeResize, afterReload, 'liveSurfaceRef'),
        checkpointLabels: input.surfaceCheckpoints.map((checkpoint) => checkpoint.label),
        hiddenKeyboardPathAfterTabReturn: afterTabReturn?.hiddenKeyboardPath,
        maxHostFrames: input.rightPane.maxHostFrames,
        detachChanges: input.rightPane.detachChanges,
        evidenceSource: 'right-pane-observer-and-browser-host-state',
      },
    },
    browserHostSession: {
      id: stringField(input.session.id),
      owner: stringField(input.session.owner),
      status: stringField(input.session.status),
      transport: stringField(input.session.liveSurfaceTransport),
      liveSurfaceTransport: stringField(input.session.liveSurfaceTransport),
      frameTransport,
      singleInteractiveTruth: input.session.singleInteractiveTruth === true,
      secondTruthSource: input.session.secondTruthSource === true,
      liveSurfaceRef: stringField(input.session.liveSurfaceRef),
      refs: {
        frameStreamRef: stringField(input.session.frameStreamRef),
        frameRef: stringField(input.session.frameRef),
        screenshotRef: stringField(input.session.screenshotRef),
        domSnapshotRef: stringField(input.session.domSnapshotRef),
        axSnapshotRef: stringField(input.session.axSnapshotRef),
        consoleLogRef: stringField(input.session.consoleLogRef),
        networkLogRef: stringField(input.session.networkLogRef),
      },
    },
    liveAcceptance,
    coverageGaps: buildCoverageGaps(blockedReason, input.metrics, input.events, input.networkSamples, input.surfaceCheckpoints, nativeEvidence),
    bottleneckRanking,
    timingSummary,
    boundedMetrics: {
      totalSamples: input.metrics.length,
      maxAllowedSampleMs: 60_000,
      maxManifestBytes: MAX_MANIFEST_BYTES,
      maxNetworkSamples: MAX_NETWORK_SAMPLES,
      maxSampleLabelsPerCategory: MAX_SAMPLE_LABELS_PER_CATEGORY,
      maxRightPaneRefCount: MAX_RIGHT_PANE_REF_COUNT,
      networkSamples: input.networkSamples.slice(-MAX_NETWORK_SAMPLES),
      frameStream: input.frameStream,
      rightPane: input.rightPane,
    },
    forbiddenEvidence: {
      rawDom: false,
      base64: false,
      rawScreenshot: false,
      fixtureDomRead: false,
      iframe: false,
      proxy: false,
      rawCurrentRunPayload: false,
      rawProviderPayload: false,
    },
    verificationCommand: VERIFICATION_COMMAND,
  };
}

function assertBrowserPaneBottleneckAuditManifest(manifest: BrowserPaneBottleneckAuditManifest) {
  assert.equal(manifest.schemaVersion, AUDIT_SCHEMA);
  assert.ok(manifest.status === 'passed' || manifest.status === 'blocked');
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.verificationCommand, VERIFICATION_COMMAND);
  assert.equal(manifest.targetOriginRef, manifest.targetEvidence.originRef);
  assert.equal(manifest.targetEvidence.mode, 'resolver-fixture');
  assert.equal(manifest.targetEvidence.resolverRuleApplied, true);
  assert.ok((manifest.targetEvidence.requestedUrlLength ?? 0) > 0, 'target URL evidence must include only length/hash');
  assert.match(manifest.targetEvidence.requestedUrlHash ?? '', /^[a-f0-9]{16}$/);
  assert.equal(manifest.targetEvidence.realExternalSiteClaim, false);
  assert.equal(manifest.targetEvidence.hardcodedSitePassClaim, false);
  assert.equal(manifest.targetEvidence.rawUrlCaptured, false);
  assert.equal(manifest.targetEvidence.allowedUse, 'right-pane-product-path-contract-not-external-web-pass');
  assert.equal(manifest.browserHostSession.owner, 'host');
  assert.equal(manifest.browserHostSession.status, 'ready');
  assert.equal(manifest.browserHostSession.transport, manifest.browserHostSession.liveSurfaceTransport);
  assert.equal(manifest.browserHostSession.singleInteractiveTruth, manifest.liveAcceptance.observed.singleInteractiveTruth);
  assertBrowserPaneLiveAcceptance(manifest.liveAcceptance, manifest.status);
  assert.deepEqual(manifest.coverageGaps.nativeEvidence, {
    liveSurfaceTransport: manifest.liveAcceptance.observed.liveSurfaceTransport,
    frameTransport: manifest.liveAcceptance.observed.frameTransport,
    singleInteractiveTruth: manifest.liveAcceptance.observed.singleInteractiveTruth,
    secondTruthSource: manifest.liveAcceptance.observed.secondTruthSource,
    sameLiveSurfaceRef: manifest.liveAcceptance.observed.sameLiveSurfaceRef,
    rightPaneNativeEvidence: manifest.liveAcceptance.observed.rightPaneNativeEvidence,
    legacyFallbackObserved: manifest.liveAcceptance.observed.legacyFallbackObserved,
  });
  if (manifest.status === 'passed') assert.equal(manifest.browserHostSession.secondTruthSource, false);
  if (manifest.status === 'blocked') assert.ok(manifest.blockedReason, 'diagnostic bottleneck manifest must include a blocked reason');
  assert.match(manifest.browserHostSession.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  if (manifest.browserHostSession.refs.frameStreamRef) {
    assert.match(manifest.browserHostSession.refs.frameStreamRef, /^browser-host-session:[^/]+\/frame-stream$/);
  }
  assert.deepEqual(manifest.interactionCoverage.classes, REQUIRED_INTERACTION_COVERAGE);
  assert.ok(manifest.interactionCoverage.eventTypes.includes('audit-focus'));
  assert.ok(manifest.interactionCoverage.eventTypes.includes('audit-input'));
  assert.ok(manifest.interactionCoverage.eventTypes.includes('audit-selection'));
  assert.ok(manifest.interactionCoverage.eventTypes.includes('audit-scroll'));
  assert.ok(manifest.interactionCoverage.eventTypes.includes('audit-slider-input'));
  assert.ok(manifest.interactionCoverage.eventTypes.includes('audit-text-selection'));
  assert.ok(
    manifest.interactionCoverage.eventTypes.includes('audit-pointer-move')
      || manifest.interactionCoverage.drag.browserHostRouteActions.length > 0,
    'drag/mouse move coverage must include fixture movement or BrowserHostSession input-route evidence',
  );
  assert.ok(manifest.interactionCoverage.eventTypes.includes('page-load'));
  assert.equal(manifest.interactionCoverage.searchboxCaret.focused, true);
  assert.equal(manifest.interactionCoverage.searchboxCaret.finalSelectionLength, 2);
  assert.ok(manifest.interactionCoverage.searchboxCaret.selectedTextHash, 'searchbox caret selection must be hash-only evidence');
  assert.ok(manifest.interactionCoverage.scroll.maxScrollY >= 900);
  assert.ok((manifest.interactionCoverage.slider.maxValue ?? 0) >= 60, 'slider drag must emit product input evidence');
  assert.ok(manifest.interactionCoverage.slider.inputEvents >= 1, 'slider drag must record fixture input events');
  assert.ok(manifest.interactionCoverage.textSelection.maxSelectionLength >= 4, 'text selection drag must record bounded selection length');
  assert.ok(manifest.interactionCoverage.textSelection.selectionHash, 'text selection evidence must be hash-only');
  assert.ok(
    manifest.interactionCoverage.drag.fixturePointerMoveEvents >= 1
      || manifest.interactionCoverage.drag.browserHostRouteActions.includes('mouse-move')
      || manifest.interactionCoverage.drag.browserHostRouteActions.includes('cursor'),
    'drag coverage must be backed by fixture pointer moves or BrowserHostSession route actions',
  );
  assert.ok(manifest.interactionCoverage.drag.browserHostRouteActions.includes('mouse-up'), 'drag coverage must include mouse-up route ACK');
  assert.equal(manifest.interactionCoverage.surfaceContinuity.sameSessionAcrossResize, true);
  assert.equal(manifest.interactionCoverage.surfaceContinuity.sameLiveSurfaceAcrossResize, true);
  assert.equal(manifest.interactionCoverage.surfaceContinuity.sameSessionAcrossTabSwitch, true);
  assert.equal(manifest.interactionCoverage.surfaceContinuity.sameLiveSurfaceAcrossTabSwitch, true);
  assert.equal(manifest.interactionCoverage.surfaceContinuity.sameLiveSurfaceAcrossReload, true);
  assert.deepEqual(manifest.interactionCoverage.surfaceContinuity.checkpointLabels, ['before-resize', 'after-resize', 'after-tab-return', 'after-reload']);
  assert.equal(manifest.interactionCoverage.surfaceContinuity.hiddenKeyboardPathAfterTabReturn, 'native-embedded');
  assert.equal(manifest.interactionCoverage.surfaceContinuity.maxHostFrames, 1);
  assert.equal(manifest.interactionCoverage.surfaceContinuity.detachChanges, 0);
  assert.ok(manifest.boundedMetrics.rightPane.maxHostFrames === 1);
  assert.ok(manifest.boundedMetrics.rightPane.maxNativeSurfaces === 1);
  assert.equal(manifest.boundedMetrics.rightPane.iframeSurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPane.proxySurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPane.dataImageSurfaces, 0);
  const rankedCategories = new Set(manifest.bottleneckRanking.map((entry) => entry.category));
  for (const category of REQUIRED_BOTTLENECK_CATEGORIES) {
    assert.ok(rankedCategories.has(category), `missing bottleneck category ${category}`);
  }
  assert.deepEqual(manifest.coverageGaps.categories.map((entry) => entry.category), REQUIRED_BOTTLENECK_CATEGORIES);
  assert.deepEqual(manifest.coverageGaps.interactions.map((entry) => entry.class), REQUIRED_INTERACTION_COVERAGE);
  for (let index = 1; index < manifest.bottleneckRanking.length; index += 1) {
    assert.ok(manifest.bottleneckRanking[index - 1].p95Ms >= manifest.bottleneckRanking[index].p95Ms, 'bottleneck ranking must be sorted by p95');
  }
  for (const entry of manifest.bottleneckRanking) {
    if (manifest.status === 'passed') assert.ok(entry.sampleCount > 0, `${entry.category} should include samples`);
    assert.ok(entry.maxMs <= manifest.boundedMetrics.maxAllowedSampleMs, `${entry.category} must stay bounded`);
    assert.ok(entry.sampleLabels.length <= MAX_SAMPLE_LABELS_PER_CATEGORY, `${entry.category} sample labels must stay bounded`);
  }
  assert.equal(manifest.timingSummary.totalSamples, manifest.boundedMetrics.totalSamples);
  assert.ok(manifest.timingSummary.totalMeasuredMs > 0);
  assert.ok(manifest.timingSummary.network.sampleCount >= manifest.boundedMetrics.networkSamples.length);
  assert.equal(manifest.timingSummary.frameStream.framesReceived, manifest.boundedMetrics.frameStream.framesReceived);
  const timingCategories = new Set(manifest.timingSummary.categories.map((entry) => entry.category));
  for (const category of rankedCategories) assert.ok(timingCategories.has(category), `missing timing summary category ${category}`);
  assert.ok(manifest.boundedMetrics.networkSamples.length <= MAX_NETWORK_SAMPLES);
  assert.ok(manifest.boundedMetrics.rightPane.sessionIds.length <= MAX_RIGHT_PANE_REF_COUNT);
  assert.ok(manifest.boundedMetrics.rightPane.liveSurfaceRefs.length <= MAX_RIGHT_PANE_REF_COUNT);
  assert.ok(manifest.boundedMetrics.rightPane.frameStreamRefs.length <= MAX_RIGHT_PANE_REF_COUNT);
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), [false, false, false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= MAX_MANIFEST_BYTES, 'manifest must stay bounded');
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|iVBORw0KGgo/i);
  assert.doesNotMatch(serialized, /"(?:screenshotData|screenshotBase64|screenshotInline|screenshotBytes|domSnapshotPayload|rawDomPayload|providerBody|providerRequest|providerResponse|rawProviderResponse|toolPayload|rawPayload)"\s*:/i);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(INPUT_TEXT)));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(EXPECTED_AFTER_BACKSPACE)));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(EXPECTED_FINAL_INPUT)));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(encodeURIComponent(INPUT_TEXT))));
}

type BlockedBottleneckManifestOptions = {
  runId?: string;
  targetUrl?: string;
  targetOrigin?: string;
  resolverRuleApplied?: boolean;
  session?: JsonRecord;
  events?: AuditFixtureEvent[];
  metrics?: MetricSample[];
  networkSamples?: BrowserHostNetworkSample[];
  frameStream?: FrameStreamStats;
  rightPane?: RightPaneBoundedEvidence;
  surfaceCheckpoints?: SurfaceContinuityCheckpoint[];
};

async function writeBlockedBottleneckManifest(blockedReason: string, options: BlockedBottleneckManifestOptions = {}): Promise<void> {
  const session = options.session ?? {};
  const events = options.events ?? [];
  const metrics = options.metrics ?? [];
  const networkSamples = options.networkSamples ?? [];
  const frameStream = options.frameStream ?? emptyFrameStreamStats();
  const rightPane = options.rightPane ?? emptyRightPaneEvidence();
  const surfaceCheckpoints = options.surfaceCheckpoints ?? [];
  const frameTransport = observedFrameTransport(session);
  const nativeEvidence = nativeRightPaneEvidence(session, rightPane, surfaceCheckpoints, frameTransport);
  const liveAcceptance = forceBlockedBrowserPaneLiveAcceptance(browserPaneLiveAcceptance(session, nativeEvidence), blockedReason);
  const targetUrlDigest = options.targetUrl ? boundedUrlDigest(options.targetUrl) : undefined;
  const targetOriginRef = options.targetOrigin ? `fixture-origin:${hashText(options.targetOrigin)}` : 'blocked:no-real-product-evidence';
  const targetHostRef = options.targetOrigin ? `fixture-host:${hashText(FIXTURE_HOST)}` : 'blocked:no-real-product-evidence';
  const inputEvents = events.filter((event) => event.type === 'audit-input');
  const scrollEvents = events.filter((event) => event.type === 'audit-scroll');
  const selectionEvents = events.filter((event) => event.type === 'audit-selection');
  const sliderEvents = events.filter((event) => event.type === 'audit-slider-input');
  const textSelectionEvents = events.filter((event) => event.type === 'audit-text-selection');
  const dragMoveEvents = events.filter((event) => event.type === 'audit-pointer-move');
  const lastSelectionEvent = selectionEvents[selectionEvents.length - 1];
  const maxTextSelectionLength = Math.max(0, ...textSelectionEvents.map((event) => event.selectionLength ?? 0));
  const strongestTextSelection = textSelectionEvents.reduce<AuditFixtureEvent | undefined>((current, next) => {
    if (!current || (next.selectionLength ?? 0) > (current.selectionLength ?? 0)) return next;
    return current;
  }, undefined);
  const beforeResize = checkpointByLabel(surfaceCheckpoints, 'before-resize');
  const afterResize = checkpointByLabel(surfaceCheckpoints, 'after-resize');
  const afterTabReturn = checkpointByLabel(surfaceCheckpoints, 'after-tab-return');
  const afterReload = checkpointByLabel(surfaceCheckpoints, 'after-reload');
  const summary = buildTimingSummary(metrics, networkSamples, frameStream);
  const ranking = new BottleneckMetrics();
  for (const sample of metrics) ranking.add(sample.category, sample.label, sample.durationMs);
  const manifest: BrowserPaneBottleneckAuditManifest = {
    schemaVersion: AUDIT_SCHEMA,
    status: 'blocked',
    refsFirst: true,
    runId: options.runId ?? `browser-pane-bottleneck-audit-blocked-${Date.now().toString(36)}`,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef,
    targetEvidence: {
      mode: options.targetUrl ? 'resolver-fixture' : 'blocked',
      hostRef: targetHostRef,
      originRef: targetOriginRef,
      requestedUrlLength: targetUrlDigest?.length,
      requestedUrlHash: targetUrlDigest?.hash,
      finalUrlLength: stringField(session.url) ? stringField(session.url).length : undefined,
      finalUrlHash: stringField(session.url) ? hashText(stringField(session.url)) : undefined,
      resolverRuleApplied: options.resolverRuleApplied === true,
      realExternalSiteClaim: false,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      allowedUse: options.targetUrl ? 'right-pane-product-path-contract-not-external-web-pass' : 'blocked-no-real-product-evidence',
    },
    blockedReason,
    interactionCoverage: {
      classes: REQUIRED_INTERACTION_COVERAGE,
      eventTypes: boundedUnique(events.map((event) => event.type), 24),
      eventPaths: boundedUnique(events.map((event) => event.path), 8),
      input: {
        initialLength: INPUT_TEXT.length,
        initialHash: hashText(INPUT_TEXT),
        afterBackspaceLength: EXPECTED_AFTER_BACKSPACE.length,
        afterBackspaceHash: hashText(EXPECTED_AFTER_BACKSPACE),
        finalLength: EXPECTED_FINAL_INPUT.length,
        finalHash: hashText(EXPECTED_FINAL_INPUT),
      },
      scroll: {
        maxScrollY: Math.max(0, ...scrollEvents.map((event) => event.maxScrollY ?? 0)),
        scrollEvents: scrollEvents.length,
      },
      searchboxCaret: {
        focused: events.some((event) => event.type === 'audit-focus'),
        finalSelectionStart: lastSelectionEvent?.selectionStart,
        finalSelectionEnd: lastSelectionEvent?.selectionEnd,
        finalSelectionLength: lastSelectionEvent?.selectionLength,
        selectedTextHash: lastSelectionEvent?.selectionHash,
        evidenceSource: 'fixture-selection-event',
      },
      slider: {
        inputEvents: sliderEvents.length,
        maxValue: Math.max(0, ...sliderEvents.map((event) => event.sliderValue ?? 0)),
        evidenceSource: 'fixture-input-event',
      },
      textSelection: {
        selectionEvents: textSelectionEvents.length,
        maxSelectionLength: maxTextSelectionLength,
        selectionHash: strongestTextSelection?.selectionHash,
        evidenceSource: 'fixture-selectionchange-event',
      },
      drag: {
        fixturePointerMoveEvents: dragMoveEvents.length,
        browserHostRouteActions: boundedUnique(networkSamples
          .filter((sample) => sample.endpoint === 'computer-use-action' && ['cursor', 'drag', 'mouse-down', 'mouse-move', 'mouse-up'].includes(sample.action ?? ''))
          .map((sample) => sample.action ?? 'unknown'), 8),
        fixtureDragUpObserved: events.some((event) => event.type === 'audit-drag-up'),
        evidenceSource: 'browser-host-action',
      },
      surfaceContinuity: {
        sameSessionAcrossResize: sameCheckpointField(beforeResize, afterResize, 'sessionId'),
        sameLiveSurfaceAcrossResize: sameCheckpointField(beforeResize, afterResize, 'liveSurfaceRef'),
        sameSessionAcrossTabSwitch: sameCheckpointField(beforeResize, afterTabReturn, 'sessionId'),
        sameLiveSurfaceAcrossTabSwitch: sameCheckpointField(beforeResize, afterTabReturn, 'liveSurfaceRef'),
        sameLiveSurfaceAcrossReload: sameCheckpointField(beforeResize, afterReload, 'liveSurfaceRef'),
        checkpointLabels: surfaceCheckpoints.map((checkpoint) => checkpoint.label),
        hiddenKeyboardPathAfterTabReturn: afterTabReturn?.hiddenKeyboardPath,
        maxHostFrames: rightPane.maxHostFrames,
        detachChanges: rightPane.detachChanges,
        evidenceSource: 'right-pane-observer-and-browser-host-state',
      },
    },
    browserHostSession: {
      id: stringField(session.id),
      owner: stringField(session.owner),
      status: stringField(session.status) || 'blocked',
      transport: stringField(session.liveSurfaceTransport),
      liveSurfaceTransport: stringField(session.liveSurfaceTransport),
      frameTransport,
      singleInteractiveTruth: session.singleInteractiveTruth === true,
      secondTruthSource: session.secondTruthSource === true,
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
    },
    liveAcceptance,
    coverageGaps: buildCoverageGaps(blockedReason, metrics, events, networkSamples, surfaceCheckpoints, nativeEvidence),
    bottleneckRanking: ranking.ranking(),
    timingSummary: summary,
    boundedMetrics: {
      totalSamples: metrics.length,
      maxAllowedSampleMs: 60_000,
      maxManifestBytes: MAX_MANIFEST_BYTES,
      maxNetworkSamples: MAX_NETWORK_SAMPLES,
      maxSampleLabelsPerCategory: MAX_SAMPLE_LABELS_PER_CATEGORY,
      maxRightPaneRefCount: MAX_RIGHT_PANE_REF_COUNT,
      networkSamples: networkSamples.slice(-MAX_NETWORK_SAMPLES),
      frameStream,
      rightPane,
    },
    forbiddenEvidence: {
      rawDom: false,
      base64: false,
      rawScreenshot: false,
      fixtureDomRead: false,
      iframe: false,
      proxy: false,
      rawCurrentRunPayload: false,
      rawProviderPayload: false,
    },
    verificationCommand: VERIFICATION_COMMAND,
  };
  assertBlockedBottleneckManifest(manifest);
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function assertBlockedBottleneckManifest(manifest: BrowserPaneBottleneckAuditManifest): void {
  assert.equal(manifest.schemaVersion, AUDIT_SCHEMA);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.refsFirst, true);
  assert.ok(manifest.blockedReason, 'blocked manifest must record bounded reason');
  assertBrowserPaneLiveAcceptance(manifest.liveAcceptance, 'blocked');
  assert.equal(manifest.liveAcceptance.passClaim, false);
  assert.equal(manifest.coverageGaps.status, 'blocked');
  assert.deepEqual(manifest.coverageGaps.categories.map((entry) => entry.category), REQUIRED_BOTTLENECK_CATEGORIES);
  assert.deepEqual(manifest.coverageGaps.interactions.map((entry) => entry.class), REQUIRED_INTERACTION_COVERAGE);
  assert.deepEqual(manifest.coverageGaps.nativeEvidence, {
    liveSurfaceTransport: manifest.liveAcceptance.observed.liveSurfaceTransport,
    frameTransport: manifest.liveAcceptance.observed.frameTransport,
    singleInteractiveTruth: manifest.liveAcceptance.observed.singleInteractiveTruth,
    secondTruthSource: manifest.liveAcceptance.observed.secondTruthSource,
    sameLiveSurfaceRef: manifest.liveAcceptance.observed.sameLiveSurfaceRef,
    rightPaneNativeEvidence: manifest.liveAcceptance.observed.rightPaneNativeEvidence,
    legacyFallbackObserved: manifest.liveAcceptance.observed.legacyFallbackObserved,
  });
  if (manifest.targetEvidence.requestedUrlLength !== undefined) {
    assert.ok(manifest.targetEvidence.requestedUrlLength > 0);
    assert.match(manifest.targetEvidence.requestedUrlHash ?? '', /^[a-f0-9]{16}$/);
  }
  assert.equal(manifest.targetEvidence.rawUrlCaptured, false);
  assert.equal(manifest.boundedMetrics.rightPane.iframeSurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPane.proxySurfaces, 0);
  assert.equal(manifest.boundedMetrics.rightPane.dataImageSurfaces, 0);
  assert.ok(manifest.bottleneckRanking.length >= REQUIRED_BOTTLENECK_CATEGORIES.length);
  assert.ok(manifest.timingSummary.categories.length >= REQUIRED_BOTTLENECK_CATEGORIES.length);
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), [false, false, false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= MAX_MANIFEST_BYTES, 'blocked manifest must stay bounded');
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|iVBORw0KGgo/i);
  assert.doesNotMatch(serialized, /"(?:screenshotData|screenshotBase64|screenshotInline|screenshotBytes|domSnapshotPayload|rawDomPayload|providerBody|providerRequest|providerResponse|rawProviderResponse|toolPayload|rawPayload)"\s*:/i);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(INPUT_TEXT)));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(EXPECTED_FINAL_INPUT)));
}

function forceBlockedBrowserPaneLiveAcceptance(liveAcceptance: BrowserPaneLiveAcceptance, reason: string): BrowserPaneLiveAcceptance {
  return {
    ...liveAcceptance,
    status: 'blocked',
    claimScope: 'diagnostic-only',
    passClaim: false,
    handoff: liveAcceptance.handoff ?? {
      state: 'native-proof-incomplete',
      canRetry: true,
      legacyFallbackAllowed: false,
    },
    blockedReason: reason.slice(0, 240) || 'blocked',
  };
}

function browserPaneLiveAcceptance(session: JsonRecord, nativeEvidence: NativeRightPaneEvidence): BrowserPaneLiveAcceptance {
  const passed = nativeEvidence.liveSurfaceTransport === 'native-embedded'
    && nativeEvidence.frameTransport === 'native-embedded'
    && nativeEvidence.singleInteractiveTruth
    && nativeEvidence.secondTruthSource === false
    && nativeEvidence.sameLiveSurfaceRef
    && nativeEvidence.rightPaneNativeEvidence
    && nativeEvidence.legacyFallbackObserved === false;
  return {
    status: passed ? 'passed' : 'blocked',
    claimScope: passed ? 'right-pane-live-pass' : 'diagnostic-only',
    passClaim: passed,
    required: {
      liveSurfaceTransport: 'native-embedded',
      frameTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
      sameLiveSurfaceRef: true,
      rightPaneNativeEvidence: true,
      legacyFallbackObserved: false,
    },
    observed: {
      shell: 'web-right-pane',
      liveSurfaceTransport: nativeEvidence.liveSurfaceTransport,
      frameTransport: nativeEvidence.frameTransport,
      singleInteractiveTruth: nativeEvidence.singleInteractiveTruth,
      secondTruthSource: nativeEvidence.secondTruthSource,
      sameLiveSurfaceRef: nativeEvidence.sameLiveSurfaceRef,
      rightPaneNativeEvidence: nativeEvidence.rightPaneNativeEvidence,
      legacyFallbackObserved: nativeEvidence.legacyFallbackObserved,
    },
    handoff: passed ? undefined : {
      state: nativeEvidence.liveSurfaceTransport === 'missing-native-attach' ? 'needs-native-attach' : 'native-proof-incomplete',
      canRetry: true,
      legacyFallbackAllowed: false,
    },
    blockedReason: passed
      ? undefined
      : boundedLiveAcceptanceBlocker(session, nativeEvidence),
  };
}

function observedFrameTransport(session: JsonRecord): string | undefined {
  return stringField(session.frameTransport) || undefined;
}

function boundedLiveAcceptanceBlocker(session: JsonRecord, nativeEvidence: NativeRightPaneEvidence): string {
  const missing: string[] = [];
  if (nativeEvidence.liveSurfaceTransport !== 'native-embedded') missing.push('native-embedded-live-surface');
  if (nativeEvidence.frameTransport !== 'native-embedded') missing.push('native-embedded-frame-transport');
  if (!nativeEvidence.singleInteractiveTruth) missing.push('single-interactive-truth');
  if (nativeEvidence.secondTruthSource !== false) missing.push('no-second-truth-source');
  if (!nativeEvidence.sameLiveSurfaceRef) missing.push('same-live-surface-ref');
  if (!nativeEvidence.rightPaneNativeEvidence) missing.push('right-pane-native-evidence');
  if (nativeEvidence.legacyFallbackObserved) missing.push('no-legacy-fallback');
  const sessionId = stringField(session.id);
  const sessionRef = sessionId ? ` sessionRef=${hashText(sessionId)}` : '';
  return `missing-native-right-pane-proof:${boundedUnique(missing, 8).join('|') || 'unknown'}; observed=${nativeEvidence.liveSurfaceTransport || 'missing-native-attach'}${sessionRef}`;
}

function blockedBrowserPaneLiveAcceptance(reason: string): BrowserPaneLiveAcceptance {
  return {
    status: 'blocked',
    claimScope: 'diagnostic-only',
    passClaim: false,
    required: {
      liveSurfaceTransport: 'native-embedded',
      frameTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
      sameLiveSurfaceRef: true,
      rightPaneNativeEvidence: true,
      legacyFallbackObserved: false,
    },
    observed: {
      shell: 'web-right-pane',
      liveSurfaceTransport: 'missing-native-attach',
      frameTransport: 'missing-native-attach',
      singleInteractiveTruth: false,
      secondTruthSource: false,
      sameLiveSurfaceRef: false,
      rightPaneNativeEvidence: false,
      legacyFallbackObserved: false,
    },
    handoff: {
      state: 'needs-native-attach',
      canRetry: true,
      legacyFallbackAllowed: false,
    },
    blockedReason: reason.slice(0, 240) || 'blocked',
  };
}

function assertBrowserPaneLiveAcceptance(liveAcceptance: BrowserPaneLiveAcceptance, manifestStatus: 'passed' | 'blocked'): void {
  assert.equal(liveAcceptance.status, manifestStatus);
  assert.equal(liveAcceptance.required.liveSurfaceTransport, 'native-embedded');
  assert.equal(liveAcceptance.required.frameTransport, 'native-embedded');
  assert.equal(liveAcceptance.required.singleInteractiveTruth, true);
  assert.equal(liveAcceptance.required.secondTruthSource, false);
  assert.equal(liveAcceptance.required.sameLiveSurfaceRef, true);
  assert.equal(liveAcceptance.required.rightPaneNativeEvidence, true);
  assert.equal(liveAcceptance.required.legacyFallbackObserved, false);
  assert.equal(liveAcceptance.observed.shell, 'web-right-pane');
  if (manifestStatus === 'passed') {
    assert.equal(liveAcceptance.claimScope, 'right-pane-live-pass');
    assert.equal(liveAcceptance.passClaim, true);
    assert.equal(liveAcceptance.observed.liveSurfaceTransport, 'native-embedded');
    assert.equal(liveAcceptance.observed.frameTransport, 'native-embedded');
    assert.equal(liveAcceptance.observed.singleInteractiveTruth, true);
    assert.equal(liveAcceptance.observed.secondTruthSource, false);
    assert.equal(liveAcceptance.observed.sameLiveSurfaceRef, true);
    assert.equal(liveAcceptance.observed.rightPaneNativeEvidence, true);
    assert.equal(liveAcceptance.observed.legacyFallbackObserved, false);
    assert.equal(liveAcceptance.handoff, undefined);
  } else {
    assert.equal(liveAcceptance.claimScope, 'diagnostic-only');
    assert.equal(liveAcceptance.passClaim, false);
    assert.ok(liveAcceptance.handoff, 'blocked live acceptance must include typed handoff');
    assert.equal(liveAcceptance.handoff?.canRetry, true);
    assert.equal(liveAcceptance.handoff?.legacyFallbackAllowed, false);
    assert.ok(liveAcceptance.blockedReason);
  }
}

async function startBottleneckFixture(port: number): Promise<{ url: string; close(): Promise<void> }> {
  const events: AuditFixtureEvent[] = [];
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
    if (url.pathname === '/details') {
      writeHtml(res, pageShell('Bottleneck Details', detailsPageBody()));
      return;
    }
    writeHtml(res, pageShell('Bottleneck Audit', auditPageBody()));
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

function auditPageBody() {
  return `
    <main>
      <section class="hero">
        <h1>Bottleneck Audit Fixture</h1>
        <input id="auditInput" aria-label="Audit input" autofocus />
      </section>
      <aside id="dragTarget" class="drag-target">Drag target</aside>
      <section class="product-controls" aria-label="Product interaction controls">
        <div>Audit slider</div>
        <div id="auditSlider" class="audit-slider" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="12" tabindex="0">
          <span id="auditSliderThumb"></span>
        </div>
        <p id="selectionText">Selectable audit paragraph for BrowserHostSession drag selection fidelity.</p>
      </section>
      <section class="long-page">
        ${Array.from({ length: 72 }, (_, index) => `<p>Audit section ${index + 1}: bounded right-pane BrowserHostSession scroll content.</p>`).join('')}
      </section>
    </main>
    <script>
      let scrollCount = 0;
      let pointerMoveCount = 0;
      let dragging = false;
      let sliderDragging = false;
      function record(path, payload) {
        navigator.sendBeacon('/__events?path=' + encodeURIComponent(path), JSON.stringify(payload));
      }
      function updateSlider(clientX) {
        const bounds = auditSlider.getBoundingClientRect();
        const value = Math.max(0, Math.min(100, Math.round(((clientX - bounds.left) / bounds.width) * 100)));
        auditSlider.setAttribute('aria-valuenow', String(value));
        auditSliderThumb.style.left = value + '%';
        record('/audit', { type: 'audit-slider-input', sliderValue: value });
      }
      function loadCount(path) {
        const key = 'bottleneck-load-count:' + path;
        const next = Number(sessionStorage.getItem(key) || '0') + 1;
        sessionStorage.setItem(key, String(next));
        return next;
      }
      record('/audit', { type: 'page-load', count: loadCount('/audit') });
      auditInput.addEventListener('focus', () => record('/audit', { type: 'audit-focus', value: auditInput.value }));
      auditInput.addEventListener('input', () => record('/audit', { type: 'audit-input', value: auditInput.value }));
      function recordAuditInputSelection() {
        const selected = auditInput.value.slice(auditInput.selectionStart || 0, auditInput.selectionEnd || 0);
        if (!selected) return;
        record('/audit', {
          type: 'audit-selection',
          selectionStart: auditInput.selectionStart || 0,
          selectionEnd: auditInput.selectionEnd || 0,
          selectionLength: selected.length,
          value: selected,
        });
      }
      auditInput.addEventListener('select', recordAuditInputSelection);
      auditInput.addEventListener('keyup', recordAuditInputSelection);
      auditSlider.addEventListener('mousedown', (event) => {
        sliderDragging = true;
        updateSlider(event.clientX);
      });
      document.addEventListener('selectionchange', () => {
        const selection = String(document.getSelection() || '');
        if (!selection) return;
        record('/audit', { type: 'audit-text-selection', selectionLength: selection.length, value: selection });
      });
      addEventListener('scroll', () => {
        scrollCount += 1;
        record('/audit', { type: 'audit-scroll', count: scrollCount, maxScrollY: Math.round(scrollY) });
      }, { passive: true });
      document.addEventListener('mousedown', (event) => {
        if (event.clientY < 120) return;
        dragging = true;
        record('/audit', { type: 'audit-drag-down', x: Math.round(event.clientX), y: Math.round(event.clientY) });
      });
      document.addEventListener('mousemove', (event) => {
        if (sliderDragging) updateSlider(event.clientX);
        if (!dragging) return;
        pointerMoveCount += 1;
        record('/audit', { type: 'audit-pointer-move', count: pointerMoveCount, x: Math.round(event.clientX), y: Math.round(event.clientY) });
      });
      document.addEventListener('mouseup', (event) => {
        sliderDragging = false;
        if (!dragging) return;
        dragging = false;
        record('/audit', { type: 'audit-drag-up', count: pointerMoveCount, x: Math.round(event.clientX), y: Math.round(event.clientY) });
      });
    </script>
  `;
}

function detailsPageBody() {
  return `
    <main>
      <section class="hero">
        <h1>Bottleneck Details</h1>
        <p>History, reload, and session continuity target.</p>
      </section>
      <aside id="dragTarget" class="drag-target">Stable surface</aside>
      <section class="long-page">
        ${Array.from({ length: 32 }, (_, index) => `<p>Details section ${index + 1}: bounded navigation audit content.</p>`).join('')}
      </section>
    </main>
    <script>
      function record(path, payload) {
        navigator.sendBeacon('/__events?path=' + encodeURIComponent(path), JSON.stringify(payload));
      }
      function loadCount(path) {
        const key = 'bottleneck-load-count:' + path;
        const next = Number(sessionStorage.getItem(key) || '0') + 1;
        sessionStorage.setItem(key, String(next));
        return next;
      }
      record('/details', { type: 'page-load', count: loadCount('/details') });
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
      main { min-height: 3200px; padding: 24px 32px; }
      .hero { position: relative; min-height: 128px; }
      h1 { margin: 0 0 16px; font-size: 26px; }
      input { box-sizing: border-box; width: 820px; height: 44px; padding: 9px 12px; font-size: 17px; border: 2px solid #174c4f; border-radius: 4px; background: white; color: #102024; }
      .drag-target { position: fixed; top: 300px; left: 72px; right: 72px; height: 160px; display: grid; place-items: center; border-radius: 6px; background: #174c4f; color: white; user-select: none; touch-action: none; }
      .product-controls { position: fixed; top: 141px; left: 72px; z-index: 3; display: grid; gap: 8px; max-width: 720px; padding: 8px 0 12px; background: #f7faf9; }
      .product-controls div:first-child { font-size: 14px; font-weight: 700; color: #174c4f; }
      .audit-slider { position: relative; width: 420px; height: 32px; border-radius: 16px; background: #d8e6e3; box-shadow: inset 0 0 0 2px #174c4f; }
      .audit-slider span { position: absolute; top: 50%; left: 12%; width: 28px; height: 28px; border-radius: 50%; background: #174c4f; transform: translate(-50%, -50%); }
      #selectionText { user-select: text; max-width: 620px; padding: 8px 0; }
      .long-page { padding-top: 460px; max-width: 720px; }
      p { margin: 0 0 18px; line-height: 1.55; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function eventFromPayload(raw: string, path: string): AuditFixtureEvent {
  const payload = parseJsonRecord(raw);
  const value = typeof payload.value === 'string' ? payload.value : undefined;
  return {
    type: typeof payload.type === 'string' ? payload.type : 'unknown',
    path,
    valueLength: value === undefined ? undefined : value.length,
    valueHash: value === undefined ? undefined : hashText(value),
    selectionStart: numberField(payload.selectionStart),
    selectionEnd: numberField(payload.selectionEnd),
    selectionLength: numberField(payload.selectionLength),
    selectionHash: value === undefined ? undefined : hashText(value),
    sliderValue: numberField(payload.sliderValue),
    count: numberField(payload.count),
    maxScrollY: numberField(payload.maxScrollY),
    x: numberField(payload.x),
    y: numberField(payload.y),
  };
}

async function waitForFixtureEvent(
  baseUrl: string,
  predicate: (event: AuditFixtureEvent) => boolean,
  timeoutMs: number,
  label: string,
): Promise<AuditFixtureEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await fetchFixtureEvents(baseUrl);
    const event = events.find(predicate);
    if (event) return event;
    await delay(250);
  }
  throw new Error(`Timed out waiting for fixture event: ${label}`);
}

async function fetchFixtureEvents(baseUrl: string): Promise<AuditFixtureEvent[]> {
  const json = await fetchJson(`${baseUrl}/__events`);
  return Array.isArray(json.events) ? json.events.filter(isAuditFixtureEvent) : [];
}

function isAuditFixtureEvent(value: unknown): value is AuditFixtureEvent {
  return Boolean(recordField(value) && typeof (value as AuditFixtureEvent).type === 'string' && typeof (value as AuditFixtureEvent).path === 'string');
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
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
  await Promise.race([exited, delay(2000)]);
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
  await Promise.race([exited, delay(1000)]);
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
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
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

function boundedUrlDigest(value: string): { length: number; hash: string } {
  return {
    length: value.length,
    hash: hashText(value),
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

function emptyRightPaneEvidence(): RightPaneBoundedEvidence {
  return {
    mutationCount: 0,
    attachChanges: 0,
    detachChanges: 0,
    maxHostFrames: 0,
    maxNativeSurfaces: 0,
    sessionIds: [],
    liveSurfaceRefs: [],
    frameStreamRefs: [],
    liveSurfaceTransports: [],
    frameTransports: [],
    renderers: [],
    browserStates: [],
    iframeSurfaces: 0,
    proxySurfaces: 0,
    dataImageSurfaces: 0,
  };
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}
