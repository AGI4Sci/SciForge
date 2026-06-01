import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BrowserHostSessionManager,
  browserHostSessionDir,
  type BrowserHostMouseButton,
  type BrowserHostMousePoint,
  type BrowserHostSessionAction,
  type BrowserHostSessionActionInput,
  type BrowserHostSessionActionTiming,
  type BrowserHostSessionActionTimingSummary,
  type BrowserHostSessionDriver,
  type BrowserHostSessionDriverFactory,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
  0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
  0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
  0x03, 0x03, 0x02, 0x00, 0xef, 0xbf, 0xa7, 0xdb,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const LAB_ACTIONS: Array<BrowserHostSessionAction | 'open'> = ['open', 'navigate', 'click', 'type', 'press', 'scroll', 'drag'];
const PERF_LAB_SCHEMA = 'sciforge.browser-host-session.performance-lab-smoke.v1' as const;
const PERF_LAB_ARTIFACT_MODE = 'refs-first-bounded-performance-summary' as const;
const MAX_PERF_LAB_ARTIFACT_BYTES = 48_000;
const VERIFICATION_COMMAND = 'node --import tsx --test tests/smoke/smoke-browser-host-session-performance-lab.test.ts';
const artifactDir = join(process.cwd(), 'docs', 'test-artifacts', 'browser-host-session-performance-lab');
const manifestPath = join(artifactDir, 'manifest.json');
const PERF_LAB_SLOW_NETWORK_DELAY_MS = 12;
const PERF_LAB_CONTENTEDITABLE_TEXT = 'ce-fixture-token';
const PERF_LAB_FIXTURE_SCENARIOS = [{
  id: 'contenteditable',
  targetKind: 'editable-region',
  action: 'type',
  capture: 'none',
  actionId: 'perf-fixture-contenteditable-type',
}, {
  id: 'iframe',
  targetKind: 'nested-frame-target',
  action: 'click',
  capture: 'none',
  actionId: 'perf-fixture-iframe-click',
}, {
  id: 'shadow-dom',
  targetKind: 'shadow-root-control',
  action: 'press',
  capture: 'none',
  actionId: 'perf-fixture-shadow-dom-press',
}, {
  id: 'slow-network',
  targetKind: 'deterministic-delayed-navigation',
  action: 'navigate',
  capture: 'frame',
  actionId: 'perf-fixture-slow-network-navigate',
  simulatedDelayMs: PERF_LAB_SLOW_NETWORK_DELAY_MS,
}] as const satisfies readonly PerfLabFixtureScenario[];

type PerfLabFixtureCapabilityId = 'contenteditable' | 'iframe' | 'shadow-dom' | 'slow-network';
type PerfLabFixtureCapabilityStatus = 'timed' | 'skipped' | 'unsupported';
type PerfLabFixtureScenario = {
  id: PerfLabFixtureCapabilityId;
  targetKind: string;
  action: BrowserHostSessionAction;
  capture: BrowserHostSessionActionTiming['capture'];
  actionId: string;
  simulatedDelayMs?: number;
};
type PerfLabFixtureDriverRecord = {
  capability: PerfLabFixtureCapabilityId;
  targetKind: string;
  action: BrowserHostSessionAction;
  targetRef: string;
  simulatedDelayMs?: number;
};
type PerfLabFixtureCapabilityResult = {
  capability: PerfLabFixtureCapabilityId;
  targetKind: string;
  status: PerfLabFixtureCapabilityStatus;
  support: 'local-deterministic-timing';
  scenarioRef: string;
  targetRef: string;
  timingRef: string;
  sourceAction: BrowserHostSessionAction;
  capture: BrowserHostSessionActionTiming['capture'];
  timingStatus: BrowserHostSessionActionTiming['status'];
  paintAckSource: BrowserHostSessionActionTiming['paintAckSource'];
  totalMs: number;
  hostActionMs: number;
  simulatedDelayMs: number;
  refsFirst: true;
  localDeterministicOnly: true;
  publicNetworkUsed: false;
  realThirtyMinuteBenchmark: false;
  rawPayloadCaptured: false;
};

test('BrowserHostSession local performance lab summarizes navigation, input, scroll, and drag timing without raw payloads', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-perf-lab-'));
  const { factory, drivers } = deterministicPerfLabDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/perf-lab/start',
      sessionId: 'perf-lab-smoke',
      width: 960,
      height: 640,
      timeoutMs: 2_000,
    });
    assert.equal(opened.status, 'ready');
    assert.equal(opened.owner, 'host');
    assert.equal(opened.providerId, BROWSER_HOST_SESSION_PROVIDER_ID);
    assert.equal(opened.singleInteractiveTruth, true);
    assert.equal(opened.frameStreamRef, 'browser-host-session:perf-lab-smoke/frame-stream');

    const driver = drivers[0];
    assert.ok(driver, 'local deterministic performance lab driver should be created');
    const heavyCaptureCallsAfterOpen = {
      content: driver.contentCalls,
      ax: driver.axSnapshotCalls,
    };

    const navigated = await manager.act(workspacePath, opened.id, {
      action: 'navigate',
      url: 'http://localhost/perf-lab/results?case=navigation',
      capture: 'frame',
      actionId: 'perf-nav-1',
      adapterSentAt: recentAdapterTimestamp(),
    });
    const typed = await manager.act(workspacePath, opened.id, {
      action: 'type',
      text: 'deterministic input',
      capture: 'none',
      actionId: 'perf-input-1',
      adapterSentAt: recentAdapterTimestamp(),
    });
    const scrolled = await manager.act(workspacePath, opened.id, {
      action: 'scroll',
      deltaX: 0,
      deltaY: 640,
      capture: 'none',
      actionId: 'perf-scroll-1',
      adapterSentAt: recentAdapterTimestamp(),
    });
    const dragged = await manager.act(workspacePath, opened.id, {
      action: 'drag',
      path: [{ x: 24, y: 32 }, { x: 120, y: 96 }, { x: 224, y: 64 }],
      button: 'left',
      capture: 'frame',
      actionId: 'perf-drag-1',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertTiming(navigated.lastActionTiming, 'navigate', 'frame');
    assertTiming(typed.lastActionTiming, 'type', 'none');
    assertTiming(scrolled.lastActionTiming, 'scroll', 'none');
    assertTiming(dragged.lastActionTiming, 'drag', 'frame', 'none');

    const fixtureCapabilityResults = await exerciseFixtureCapabilities(manager, workspacePath, opened.id, driver);
    assert.equal(driver.contenteditableValueLength, PERF_LAB_CONTENTEDITABLE_TEXT.length);
    assert.equal(driver.iframeClickCount, 1);
    assert.equal(driver.shadowPressCount, 1);
    assert.deepEqual(driver.slowNetworkSimulatedDelaysMs, [PERF_LAB_SLOW_NETWORK_DELAY_MS]);

    const searchStartedAtMs = Date.now();
    const searched = await manager.search(workspacePath, {
      sessionId: opened.id,
      query: 'deterministic performance search',
      limit: 2,
      engine: 'bing',
      timeoutMs: 2_000,
    });
    const searchTotalMs = Date.now() - searchStartedAtMs;

    assert.equal(searched.session.id, opened.id);
    assert.equal(searched.results.length, 2);
    assert.match(searched.searchResultRef, /^browser-host-session:perf-lab-smoke\/search-results-/);

    const finalState = await manager.sessionState(workspacePath, opened.id);
    assert.ok(finalState, 'BrowserHostSession final state should be available');
    assert.match(finalState.url, /^https:\/\/www\.bing\.com\/search\?q=deterministic\+performance\+search/);
    assert.equal(driver.inputValue, 'deterministic input');
    assert.equal(driver.scrollY, 640);
    assert.deepEqual(driver.dragPath, [{ x: 24, y: 32 }, { x: 120, y: 96 }, { x: 224, y: 64 }]);
    assert.deepEqual(driver.actions, [
      'goto:http://localhost/perf-lab/start',
      'goto:http://localhost/perf-lab/results?case=navigation',
      'type:deterministic input',
      'scroll:0,640',
      'drag:left:24,32->120,96->224,64',
      `goto:${perfLabFixtureUrl('contenteditable')}`,
      `type:${PERF_LAB_CONTENTEDITABLE_TEXT}`,
      `goto:${perfLabFixtureUrl('iframe')}`,
      'click:left:336,180',
      `goto:${perfLabFixtureUrl('shadow-dom')}`,
      'press:Enter',
      `goto:${perfLabFixtureUrl('slow-network')}`,
      `goto:${finalState.url}`,
    ]);
    assert.equal(driver.contentCalls, heavyCaptureCallsAfterOpen.content, 'lab hot path should not capture raw DOM');
    assert.equal(driver.axSnapshotCalls, heavyCaptureCallsAfterOpen.ax, 'lab hot path should not capture AX snapshots');

    for (const action of LAB_ACTIONS) {
      const summary = requiredTimingSummary(finalState, action);
      assert.equal(summary.count, expectedLabTimingCount(action), `${action} should have the expected timing sample count`);
      assert.ok(summary.p95Ms >= summary.p50Ms, `${action} p95 should not be lower than p50`);
      assert.ok(Number.isFinite(summary.lastMs), `${action} lastMs should be finite`);
    }

    const report = boundedPerfLabReport(finalState, searched, {
      searchTotalMs,
      hotPathHeavyCapturesAfterOpen: (driver.contentCalls - heavyCaptureCallsAfterOpen.content)
        + (driver.axSnapshotCalls - heavyCaptureCallsAfterOpen.ax),
      fixtureCapabilityResults,
    });
    const reportText = JSON.stringify(report);
    assertNoRawPerfLabPayloads(reportText);
    assert.equal(report.timingSummary.navigation.sourceAction, 'navigate');
    assert.equal(report.timingSummary.input.sourceAction, 'type');
    assert.equal(report.timingSummary.scroll.sourceAction, 'scroll');
    assert.equal(report.timingSummary.drag.sourceAction, 'drag');
    assert.equal(report.timingSummary.search.sourceAction, 'search');
    assert.deepEqual(report.refsFirst, true);
    assert.deepEqual(report.publicNetworkUsed, false);
    assert.deepEqual(report.realThirtyMinuteBenchmark, false);
    assert.equal(report.fixtureCoverage.rows.length, PERF_LAB_FIXTURE_SCENARIOS.length);
    assert.deepEqual(report.fixtureCoverage.requiredTodoCapabilities, PERF_LAB_FIXTURE_SCENARIOS.map((scenario) => scenario.id));
    assert.deepEqual(report.capabilityMatrix.map((row) => row.capability), PERF_LAB_FIXTURE_SCENARIOS.map((scenario) => scenario.id));
    assert.ok(report.capabilityMatrix.every((row) => row.status === 'timed' && row.refsFirst && row.rawPayloadCaptured === false));
    assert.equal(report.search.resultCount, 2);
    assert.match(report.search.searchResultRef, /^browser-host-session:perf-lab-smoke\/search-results-/);
    assert.ok(report.beforeAfterBoundedSummary.some((row) => row.metric === 'hot-path-heavy-captures-after-open' && row.after === 0));
    await writePerfLabManifest(report);

    const sessionManifestText = await readFile(join(browserHostSessionDir(workspacePath, opened.id), 'session.json'), 'utf8');
    assert.doesNotMatch(sessionManifestText, /data:image|base64|<\s*(?:!doctype|html|body|input|canvas)\b/i);

    console.log(`[ok] BrowserHostSession performance lab manifest ${manifestPath}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function deterministicPerfLabDriverFactory(): { factory: BrowserHostSessionDriverFactory; drivers: DeterministicPerfLabDriver[] } {
  const drivers: DeterministicPerfLabDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
        const driver = new DeterministicPerfLabDriver();
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class DeterministicPerfLabDriver implements BrowserHostSessionDriver {
  currentUrl = 'about:blank';
  inputValue = '';
  contenteditableValueLength = 0;
  iframeClickCount = 0;
  shadowPressCount = 0;
  slowNetworkSimulatedDelaysMs: number[] = [];
  scrollY = 0;
  dragPath: BrowserHostMousePoint[] = [];
  actions: string[] = [];
  contentCalls = 0;
  axSnapshotCalls = 0;

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.actions.push(`goto:${url}`);
    if (url === perfLabFixtureUrl('slow-network')) {
      this.slowNetworkSimulatedDelaysMs.push(PERF_LAB_SLOW_NETWORK_DELAY_MS);
      await delay(PERF_LAB_SLOW_NETWORK_DELAY_MS);
    }
  }

  async title(): Promise<string> {
    return `BrowserHostSession perf lab ${new URL(this.currentUrl).pathname}`;
  }

  async content(): Promise<string> {
    this.contentCalls += 1;
    return '<!-- BrowserHostSession performance lab keeps DOM evidence behind refs. -->';
  }

  async text(): Promise<string> {
    return `url=${this.currentUrl} input=${this.inputValue.length} scrollY=${this.scrollY} dragPoints=${this.dragPath.length}`;
  }

  async screenshot(path: string): Promise<void> {
    await writeFile(path, PNG_1X1);
  }

  async axSnapshot(): Promise<unknown> {
    this.axSnapshotCalls += 1;
    return { role: 'document', name: 'BrowserHostSession performance lab fixture' };
  }

  async searchResults(limit: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
    return Array.from({ length: limit }, (_item, index) => ({
      title: `Performance result ${index + 1}`,
      url: `https://example.org/perf-result-${index + 1}`,
      snippet: `Bounded performance search result ${index + 1}`,
    }));
  }

  async canGoBack(): Promise<boolean> {
    return false;
  }

  async canGoForward(): Promise<boolean> {
    return false;
  }

  async back(): Promise<void> {}

  async forward(): Promise<void> {}

  async reload(): Promise<void> {}

  async stop(): Promise<void> {}

  async click(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    if (this.currentUrl === perfLabFixtureUrl('iframe')) this.iframeClickCount += 1;
    this.actions.push(`click:${button}:${x},${y}`);
  }

  async drag(path: BrowserHostMousePoint[], button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.dragPath = path;
    this.actions.push(`drag:${button}:${path.map((point) => `${point.x},${point.y}`).join('->')}`);
  }

  async type(text: string): Promise<void> {
    if (this.currentUrl === perfLabFixtureUrl('contenteditable')) {
      this.contenteditableValueLength += text.length;
    } else {
      this.inputValue += text;
    }
    this.actions.push(`type:${text}`);
  }

  async press(key: string): Promise<void> {
    if (this.currentUrl === perfLabFixtureUrl('shadow-dom')) this.shadowPressCount += 1;
    this.actions.push(`press:${key}`);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.scrollY += deltaY;
    this.actions.push(`scroll:${deltaX},${deltaY}`);
  }

  async close(): Promise<void> {}
}

function assertTiming(
  timing: BrowserHostSessionActionTiming | undefined,
  action: BrowserHostSessionAction,
  capture: BrowserHostSessionActionTiming['capture'],
  expectedPaintAckSource: BrowserHostSessionActionTiming['paintAckSource'] = capture === 'none' ? 'none' : 'host-stream-frame',
): void {
  assert.ok(timing, `${action} should produce lastActionTiming`);
  assert.equal(timing.action, action);
  assert.equal(timing.capture, capture);
  assert.equal(timing.status, 'ok');
  assert.ok(timing.totalMs >= 0);
  assert.ok(timing.hostActionMs >= 0);
  assert.ok(timing.queueMs >= 0);
  assert.equal(timing.paintAckSource, expectedPaintAckSource);
}

function requiredTimingSummary(
  state: BrowserHostSessionState,
  action: BrowserHostSessionAction | 'open',
): BrowserHostSessionActionTimingSummary {
  const summary = state.actionTimingSummary?.find((row) => row.action === action);
  assert.ok(summary, `missing timing summary for ${action}`);
  return summary;
}

async function exerciseFixtureCapabilities(
  manager: BrowserHostSessionManager,
  workspacePath: string,
  sessionId: string,
  driver: DeterministicPerfLabDriver,
): Promise<PerfLabFixtureCapabilityResult[]> {
  const results: PerfLabFixtureCapabilityResult[] = [];
  for (const scenario of PERF_LAB_FIXTURE_SCENARIOS) {
    const targetRef = `browser-host-session:${sessionId}/performance-lab/${scenario.id}`;
    const navigated = await manager.act(workspacePath, sessionId, {
      action: 'navigate',
      url: perfLabFixtureUrl(scenario.id),
      capture: 'frame',
      actionId: `${scenario.actionId}-navigate`,
      adapterSentAt: recentAdapterTimestamp(),
    });
    let state = navigated;
    if (scenario.id === 'contenteditable') {
      state = await manager.act(workspacePath, sessionId, {
        action: 'type',
        text: PERF_LAB_CONTENTEDITABLE_TEXT,
        capture: scenario.capture,
        actionId: scenario.actionId,
        adapterSentAt: recentAdapterTimestamp(),
      });
    } else if (scenario.id === 'iframe') {
      state = await manager.act(workspacePath, sessionId, {
        action: 'click',
        x: 336,
        y: 180,
        capture: scenario.capture,
        actionId: scenario.actionId,
        adapterSentAt: recentAdapterTimestamp(),
      });
    } else if (scenario.id === 'shadow-dom') {
      state = await manager.act(workspacePath, sessionId, {
        action: 'press',
        key: 'Enter',
        capture: scenario.capture,
        actionId: scenario.actionId,
        adapterSentAt: recentAdapterTimestamp(),
      });
    }
    const timing = state.lastActionTiming;
    assert.ok(timing, `${scenario.id} should produce timing evidence`);
    assert.equal(timing.action, scenario.action);
    assert.equal(timing.capture, scenario.capture);
    assert.equal(timing.status, 'ok');
    results.push({
      capability: scenario.id,
      targetKind: scenario.targetKind,
      status: 'timed',
      support: 'local-deterministic-timing',
      scenarioRef: `browser-performance-lab:${scenario.id}`,
      targetRef,
      timingRef: `${targetRef}/timing-summary`,
      sourceAction: scenario.action,
      capture: scenario.capture,
      timingStatus: timing.status,
      paintAckSource: timing.paintAckSource,
      totalMs: Math.max(0, Math.round(timing.totalMs)),
      hostActionMs: Math.max(0, Math.round(timing.hostActionMs)),
      simulatedDelayMs: 'simulatedDelayMs' in scenario ? scenario.simulatedDelayMs : 0,
      refsFirst: true,
      localDeterministicOnly: true,
      publicNetworkUsed: false,
      realThirtyMinuteBenchmark: false,
      rawPayloadCaptured: false,
    });
  }
  assert.equal(driver.contenteditableValueLength, PERF_LAB_CONTENTEDITABLE_TEXT.length);
  return results;
}

function perfLabFixtureUrl(capability: PerfLabFixtureCapabilityId): string {
  return `http://localhost/perf-lab/fixture/${capability}`;
}

function expectedLabTimingCount(action: BrowserHostSessionAction | 'open'): number {
  if (action === 'open') return 1;
  if (action === 'navigate') return 6;
  if (action === 'type') return 2;
  if (action === 'click') return 1;
  if (action === 'press') return 1;
  return 1;
}

function boundedPerfLabReport(
  state: BrowserHostSessionState,
  search: Awaited<ReturnType<BrowserHostSessionManager['search']>>,
  input: {
    searchTotalMs: number;
    hotPathHeavyCapturesAfterOpen: number;
    fixtureCapabilityResults: PerfLabFixtureCapabilityResult[];
  },
) {
  return {
    schemaVersion: PERF_LAB_SCHEMA,
    status: 'passed',
    source: 'local-deterministic-browser-host-session-fixture',
    benchmarkScope: 'local-deterministic-smoke-only',
    publicNetworkUsed: false,
    realThirtyMinuteBenchmark: false,
    refsFirst: true,
    artifactPayloadMode: PERF_LAB_ARTIFACT_MODE,
    verificationCommand: VERIFICATION_COMMAND,
    session: {
      id: state.id,
      status: state.status,
      owner: state.owner,
      providerId: state.providerId,
      liveSurfaceTransport: state.liveSurfaceTransport ?? 'host-stream',
      finalUrlHash: sha256(state.url),
      requestedUrlHash: sha256(state.requestedUrl),
    },
    refs: {
      hostSessionRef: `browser-host-session:${state.id}`,
      liveSurfaceRef: state.liveSurfaceRef,
      frameStreamRef: state.frameStreamRef,
      frameRef: state.frameRef,
      screenshotRef: state.screenshotRef,
      domSnapshotRef: state.domSnapshotRef,
      axSnapshotRef: state.axSnapshotRef,
      consoleLogRef: state.consoleLogRef,
      networkLogRef: state.networkLogRef,
      searchResultRef: search.searchResultRef,
    },
    search: {
      sessionId: search.session.id,
      engine: search.engine,
      resultCount: search.results.length,
      searchResultRef: search.searchResultRef,
      queryHash: sha256(search.query),
      finalUrlHash: sha256(search.finalUrl),
    },
    timingSummary: {
      navigation: boundedActionTimingSummary('navigation', requiredTimingSummary(state, 'navigate')),
      input: boundedActionTimingSummary('input', requiredTimingSummary(state, 'type')),
      scroll: boundedActionTimingSummary('scroll', requiredTimingSummary(state, 'scroll')),
      drag: boundedActionTimingSummary('drag', requiredTimingSummary(state, 'drag')),
      search: boundedSearchTimingSummary(input.searchTotalMs),
    },
    beforeAfterBoundedSummary: [{
      metric: 'hot-path-heavy-captures-after-open',
      before: 'full-capture-on-every-input',
      after: input.hotPathHeavyCapturesAfterOpen,
      unit: 'raw-dom-or-ax-captures',
    }, {
      metric: 'search-session-owner-count',
      before: 'isolated-search-session-allowed',
      after: 1,
      unit: 'BrowserHostSession owners',
    }],
    fixtureCoverage: {
      schemaVersion: 'sciforge.browser-host-session.performance-lab-fixture-coverage.v1',
      requiredTodoCapabilities: PERF_LAB_FIXTURE_SCENARIOS.map((scenario) => scenario.id),
      rows: input.fixtureCapabilityResults.map((result) => ({
        capability: result.capability,
        targetKind: result.targetKind,
        status: result.status,
        scenarioRef: result.scenarioRef,
        targetRef: result.targetRef,
        timingRef: result.timingRef,
        sourceAction: result.sourceAction,
        support: result.support,
      })),
      localDeterministicOnly: true,
      publicNetworkUsed: false,
      realThirtyMinuteBenchmark: false,
    },
    capabilityMatrix: input.fixtureCapabilityResults,
    boundedEvidence: {
      timingSummaryOnly: true,
      beforeAfterSummaryOnly: true,
      fixtureCoverageSummaryOnly: true,
      inlineDomCaptured: false,
      inlineScreenshotBytesCaptured: false,
      inlineProviderPayloadCaptured: false,
      inlineSearchResultsCaptured: false,
      maxTimingSummaryRows: 5,
    },
    forbiddenEvidence: {
      rawDom: false,
      base64: false,
      screenshotBytes: false,
      providerPayload: false,
      rawSearchResults: false,
      publicNetwork: false,
      realThirtyMinuteBenchmark: false,
    },
  };
}

type PerfLabTimingPhase = 'navigation' | 'input' | 'scroll' | 'drag' | 'search';

function boundedActionTimingSummary(
  phase: Exclude<PerfLabTimingPhase, 'search'>,
  summary: BrowserHostSessionActionTimingSummary,
) {
  return {
    phase,
    sourceAction: summary.action,
    count: summary.count,
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    lastMs: summary.lastMs,
  };
}

function boundedSearchTimingSummary(totalMs: number) {
  const rounded = Math.max(0, Math.round(totalMs));
  return {
    phase: 'search' as const,
    sourceAction: 'search' as const,
    count: 1,
    p50Ms: rounded,
    p95Ms: rounded,
    lastMs: rounded,
  };
}

async function writePerfLabManifest(manifest: ReturnType<typeof boundedPerfLabReport>): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  assertBoundedPerfLabManifest(manifest);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  assertNoRawPerfLabPayloads(text);
  await writeFile(manifestPath, text, 'utf8');

  const persistedText = await readFile(manifestPath, 'utf8');
  assertNoRawPerfLabPayloads(persistedText);
  const persisted = JSON.parse(persistedText) as ReturnType<typeof boundedPerfLabReport>;
  assertBoundedPerfLabManifest(persisted);
  assert.equal(persisted.verificationCommand, VERIFICATION_COMMAND);
  assert.equal(persisted.search.resultCount, 2);
  assert.equal(persisted.beforeAfterBoundedSummary[0]?.after, 0);
}

function assertBoundedPerfLabManifest(value: unknown): void {
  const record = objectRecord(value);
  assert.ok(record, 'performance lab manifest must be an object');
  assert.equal(record.schemaVersion, PERF_LAB_SCHEMA);
  assert.equal(record.status, 'passed');
  assert.equal(record.refsFirst, true);
  assert.equal(record.artifactPayloadMode, PERF_LAB_ARTIFACT_MODE);
  assert.equal(record.publicNetworkUsed, false);
  assert.equal(record.realThirtyMinuteBenchmark, false);
  assert.equal(record.verificationCommand, VERIFICATION_COMMAND);
  assert.equal(objectRecord(record.boundedEvidence)?.timingSummaryOnly, true);
  assert.equal(objectRecord(record.boundedEvidence)?.fixtureCoverageSummaryOnly, true);
  assert.equal(objectRecord(record.boundedEvidence)?.inlineDomCaptured, false);
  assert.equal(objectRecord(record.boundedEvidence)?.inlineScreenshotBytesCaptured, false);
  assert.equal(objectRecord(record.boundedEvidence)?.inlineProviderPayloadCaptured, false);
  assert.equal(objectRecord(record.boundedEvidence)?.inlineSearchResultsCaptured, false);

  const forbiddenEvidence = objectRecord(record.forbiddenEvidence);
  assert.ok(forbiddenEvidence, 'performance lab manifest must include forbidden evidence flags');
  for (const [key, flag] of Object.entries(forbiddenEvidence)) {
    assert.equal(flag, false, `forbiddenEvidence.${key} must be false`);
  }
  assertNoForbiddenInlinePerfLabFields(value, '$', new WeakSet<object>());
}

function assertNoRawPerfLabPayloads(text: string): void {
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_PERF_LAB_ARTIFACT_BYTES, 'performance lab artifact must stay bounded');
  assert.doesNotMatch(text, /<\s*(?:!doctype|html|body|input|canvas)\b/i);
  assert.doesNotMatch(text, /data:image|;base64,|iVBORw0KGgo/i);
  assert.doesNotMatch(text, /https?:\/\/|file:\/\//i);
  assert.doesNotMatch(text, /Performance result \d|Bounded performance search result|deterministic input|deterministic performance search/i);
}

function assertNoForbiddenInlinePerfLabFields(value: unknown, path: string, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    assertNoRawPerfLabPayloads(JSON.stringify(value));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    const normalizedKey = key.toLowerCase();
    if (isForbiddenInlinePerfLabKey(normalizedKey)) {
      assert.ok(
        child === false || child === 0 || child === undefined || child === '',
        `${childPath} must be false, empty, or represented by a bounded ref/hash`,
      );
    }
    assertNoForbiddenInlinePerfLabFields(child, childPath, seen);
  }
}

function isForbiddenInlinePerfLabKey(key: string): boolean {
  if (key.endsWith('ref') || key.endsWith('hash')) return false;
  return [
    'rawdom',
    'dom',
    'html',
    'base64',
    'dataurl',
    'screenshotbytes',
    'screenshotbase64',
    'rawscreenshot',
    'providerpayload',
    'rawproviderpayload',
    'searchresults',
    'rawsearchresults',
    'screenshotpath',
  ].includes(key);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function recentAdapterTimestamp(): string {
  return new Date(Date.now() - 1).toISOString();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
