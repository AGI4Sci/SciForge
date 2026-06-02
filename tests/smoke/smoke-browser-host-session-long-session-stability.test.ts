import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS,
  buildBrowserNativeAdapterComparisonManifest,
  validateBrowserNativeAdapterComparisonManifest,
} from '../../src/desktop/browser-native-adapter-comparison.js';
import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BrowserHostSessionManager,
  browserHostSessionDir,
  type BrowserHostMouseButton,
  type BrowserHostMousePoint,
  type BrowserHostSessionAction,
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
  0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f,
  0x00, 0x03, 0x03, 0x02, 0x00, 0xef, 0xbf, 0xa7,
  0xdb, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

const LOOP_ACTIONS: Array<BrowserHostSessionAction | 'open'> = [
  'open',
  'navigate',
  'type',
  'scroll',
  'drag',
  'back',
  'forward',
  'reload',
  'close',
];

test('BrowserHostSession long-session stability smoke keeps deterministic refs-first evidence bounded', async () => {
  const config = longSessionSmokeConfig();
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-long-session-'));
  const { factory, drivers } = deterministicLongSessionDriverFactory({ liveSurfaceTransport: 'native-embedded' });
  const resourceGuard = new LongSessionSurfaceResourceGuard();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/long-session/start',
      sessionId: 'long-session-stability',
      width: 1024,
      height: 720,
      timeoutMs: 2_000,
    });

    assert.equal(opened.status, 'ready');
    assert.equal(opened.owner, 'host');
    assert.equal(opened.providerId, BROWSER_HOST_SESSION_PROVIDER_ID);
    assert.equal(opened.singleInteractiveTruth, true);
    assert.equal(opened.liveSurfaceTransport, 'native-embedded');
    assert.equal(opened.frameStreamRef, undefined);
    resourceGuard.attachSurface(opened, 'tab-open');
    resourceGuard.replaceObjectUrlFromFrame(opened, 'open-capture');

    const driver = requiredDriver(drivers, 0);
    const heavyCaptureCallsAfterOpen = {
      content: driver.contentCalls,
      ax: driver.axSnapshotCalls,
    };

    for (let index = 0; index < config.iterations; index += 1) {
      const navigated = await manager.act(workspacePath, opened.id, {
        action: 'navigate',
        url: `http://localhost/long-session/page-${index}?iteration=${index}`,
        capture: 'frame',
        actionId: actionId('navigate', index),
        adapterSentAt: recentAdapterTimestamp(),
      });
      resourceGuard.replaceObjectUrlFromFrame(navigated, 'navigate-frame');
      await manager.act(workspacePath, opened.id, {
        action: 'type',
        text: ` stable-input-${index}`,
        capture: 'none',
        actionId: actionId('type', index),
        adapterSentAt: recentAdapterTimestamp(),
      });
      await manager.act(workspacePath, opened.id, {
        action: 'scroll',
        deltaX: index % 2 === 0 ? 0 : 12,
        deltaY: 180 + index,
        capture: 'none',
        actionId: actionId('scroll', index),
        adapterSentAt: recentAdapterTimestamp(),
      });
      await manager.act(workspacePath, opened.id, {
        action: 'drag',
        path: dragPath(index),
        button: 'left',
        capture: 'none',
        actionId: actionId('drag', index),
        adapterSentAt: recentAdapterTimestamp(),
      });
      const backState = await manager.act(workspacePath, opened.id, {
        action: 'back',
        capture: 'frame',
        actionId: actionId('back', index),
        adapterSentAt: recentAdapterTimestamp(),
      });
      resourceGuard.replaceObjectUrlFromFrame(backState, 'back-frame');
      const forwardState = await manager.act(workspacePath, opened.id, {
        action: 'forward',
        capture: 'frame',
        actionId: actionId('forward', index),
        adapterSentAt: recentAdapterTimestamp(),
      });
      resourceGuard.replaceObjectUrlFromFrame(forwardState, 'forward-frame');
      const reloaded = await manager.act(workspacePath, opened.id, {
        action: 'reload',
        capture: 'frame',
        actionId: actionId('reload', index),
        adapterSentAt: recentAdapterTimestamp(),
      });
      resourceGuard.replaceObjectUrlFromFrame(reloaded, 'reload-frame');
    }

    const beforeClose = await manager.sessionState(workspacePath, opened.id);
    assert.ok(beforeClose, 'long-session state should exist before close');
    assert.equal(beforeClose.url, `http://localhost/long-session/page-${config.iterations - 1}?iteration=${config.iterations - 1}`);
    assert.equal(driver.reloads, config.iterations);
    assert.equal(driver.typedTextLength, typedTextLength(config.iterations));
    assert.equal(driver.dragPaths.length, config.iterations);
    assert.equal(driver.consoleListenerCount, 1, 'console listener should be registered once for the session');
    assert.equal(driver.networkListenerCount, 1, 'network listener should be registered once for the session');
    assert.equal(driver.contentCalls, heavyCaptureCallsAfterOpen.content, 'loop should not capture raw DOM after open');
    assert.equal(driver.axSnapshotCalls, heavyCaptureCallsAfterOpen.ax, 'loop should not capture AX after open');
    assertTimingCounts(beforeClose, config.iterations);

    const closed = await manager.act(workspacePath, opened.id, {
      action: 'close',
      capture: 'none',
      actionId: 'long-session-close',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assert.equal(closed.status, 'closed');
    assert.equal(driver.closed, true);
    const primaryTabCloseRelease = resourceGuard.closeTab(closed, driver, 'tab-close');
    await assert.rejects(
      () => manager.act(workspacePath, opened.id, {
        action: 'type',
        text: 'must not route to closed session',
        capture: 'none',
        actionId: 'long-session-closed-type',
      }),
      /no active browser driver|not active|session is closed/i,
    );

    const reopened = await manager.openSession(workspacePath, {
      url: 'http://localhost/long-session/reopened',
      sessionId: 'long-session-stability-reopened',
      width: 800,
      height: 600,
      timeoutMs: 2_000,
    });
    resourceGuard.attachSurface(reopened, 'tab-open');
    resourceGuard.replaceObjectUrlFromFrame(reopened, 'open-capture');
    const reopenedDriver = requiredDriver(drivers, 1);
    await manager.act(workspacePath, reopened.id, {
      action: 'type',
      text: 'reopened input remains isolated',
      capture: 'none',
      actionId: 'long-session-reopened-type',
      adapterSentAt: recentAdapterTimestamp(),
    });
    const reopenedClosed = await manager.act(workspacePath, reopened.id, {
      action: 'close',
      capture: 'none',
      actionId: 'long-session-reopened-close',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assert.equal(reopenedClosed.status, 'closed');
    assert.equal(reopenedDriver.typedTextLength, 'reopened input remains isolated'.length);
    assert.equal(reopenedDriver.consoleListenerCount, 1);
    assert.equal(reopenedDriver.networkListenerCount, 1);
    const reopenedTabCloseRelease = resourceGuard.closeTab(reopenedClosed, reopenedDriver, 'tab-close');
    assert.deepEqual(drivers.map((entry) => entry.closed), [true, true]);

    const nativeTabCloseRelease = await nativeTabCloseReleaseContract(workspacePath);
    const resourceSnapshot = resourceGuard.snapshot();
    const report = await boundedLongSessionReport(workspacePath, beforeClose, closed, reopenedClosed, config, {
      driverCount: drivers.length,
      closedDriverCount: drivers.filter((entry) => entry.closed).length,
      listenerRegistrations: drivers.map((entry) => ({
        console: entry.consoleListenerCount,
        network: entry.networkListenerCount,
      })),
      closedSessionRejectsInput: true,
      tabCloseReleases: [primaryTabCloseRelease, reopenedTabCloseRelease, nativeTabCloseRelease],
      objectUrlRevoke: resourceSnapshot.objectUrlRevoke,
      surfaceDetach: resourceSnapshot.surfaceDetach,
    });
    const reportText = JSON.stringify(report);
    assert.equal(report.refsOnly, true);
    assert.equal(report.publicNetworkUsed, false);
    assert.ok(report.primary.timingSummary.every((row) => LOOP_ACTIONS.includes(row.action)));
    assert.doesNotMatch(reportText, /<\s*(?:!doctype|html|body|input|canvas)\b/i);
    assert.doesNotMatch(reportText, /blob:|data:image|base64|iVBORw0KGgo/i);
    assert.ok(report.primary.evidenceRefs.every((entry) => entry.ref.startsWith('browser-host-session:')));
    assert.ok(report.primary.evidenceRefs.some((entry) => entry.sha256 && entry.bytes !== undefined));
    assertResourceGuards(report.resourceGuards);
    assertProductLongSessionPlatformContract(report);

    const manifestText = await readFile(join(browserHostSessionDir(workspacePath, opened.id), 'session.json'), 'utf8');
    assert.doesNotMatch(manifestText, /data:image|base64|<\s*(?:!doctype|html|body|input|canvas)\b/i);

    console.log(`[ok] BrowserHostSession long-session stability refs-first report ${JSON.stringify(report)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function deterministicLongSessionDriverFactory(
  options: { liveSurfaceTransport?: LongSessionSurfaceTransport } = { liveSurfaceTransport: 'native-embedded' },
): { factory: BrowserHostSessionDriverFactory; drivers: DeterministicLongSessionDriver[] } {
  const drivers: DeterministicLongSessionDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
        const driver = new DeterministicLongSessionDriver(options);
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class DeterministicLongSessionDriver implements BrowserHostSessionDriver {
  readonly liveSurfaceTransport?: LongSessionSurfaceTransport;
  readonly nativeAdapterUrl?: string;
  currentUrl = 'about:blank';
  history: string[] = [];
  historyIndex = -1;
  typedTextLength = 0;
  scrollX = 0;
  scrollY = 0;
  reloads = 0;
  dragPaths: BrowserHostMousePoint[][] = [];
  actions: string[] = [];
  contentCalls = 0;
  axSnapshotCalls = 0;
  consoleListenerCount = 0;
  networkListenerCount = 0;
  closed = false;

  constructor(options: { liveSurfaceTransport?: LongSessionSurfaceTransport } = { liveSurfaceTransport: 'native-embedded' }) {
    const liveSurfaceTransport = options.liveSurfaceTransport ?? 'native-embedded';
    this.liveSurfaceTransport = liveSurfaceTransport;
    this.nativeAdapterUrl = liveSurfaceTransport === 'native-embedded'
      ? 'http://127.0.0.1:65535'
      : undefined;
  }

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(url);
    this.historyIndex = this.history.length - 1;
    this.actions.push(`goto:${stablePath(url)}`);
  }

  async title(): Promise<string> {
    return `BrowserHostSession long session ${stablePath(this.currentUrl)}`;
  }

  async content(): Promise<string> {
    this.contentCalls += 1;
    return '<html><body><main>raw deterministic DOM is stored only behind BrowserHostSession refs.</main></body></html>';
  }

  async text(): Promise<string> {
    return [
      `url=${stablePath(this.currentUrl)}`,
      `typedLength=${this.typedTextLength}`,
      `scroll=${this.scrollX},${this.scrollY}`,
      `dragCount=${this.dragPaths.length}`,
      `reloads=${this.reloads}`,
    ].join(' ');
  }

  async screenshot(path: string): Promise<void> {
    await writeFile(path, PNG_1X1);
  }

  async axSnapshot(): Promise<unknown> {
    this.axSnapshotCalls += 1;
    return { role: 'document', name: 'BrowserHostSession long-session deterministic fixture' };
  }

  async canGoBack(): Promise<boolean> {
    return this.historyIndex > 0;
  }

  async canGoForward(): Promise<boolean> {
    return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
  }

  async back(): Promise<void> {
    if (this.historyIndex > 0) {
      this.historyIndex -= 1;
      this.currentUrl = this.history[this.historyIndex] ?? this.currentUrl;
    }
    this.actions.push(`back:${stablePath(this.currentUrl)}`);
  }

  async forward(): Promise<void> {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.currentUrl = this.history[this.historyIndex] ?? this.currentUrl;
    }
    this.actions.push(`forward:${stablePath(this.currentUrl)}`);
  }

  async reload(): Promise<void> {
    this.reloads += 1;
    this.actions.push(`reload:${stablePath(this.currentUrl)}`);
  }

  async stop(): Promise<void> {
    this.actions.push('stop');
  }

  async click(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(`click:${button}:${x},${y}`);
  }

  async drag(path: BrowserHostMousePoint[], button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.dragPaths.push(path);
    this.actions.push(`drag:${button}:${path.map((point) => `${point.x},${point.y}`).join('->')}`);
  }

  async type(text: string): Promise<void> {
    this.typedTextLength += text.length;
    this.actions.push(`type:length=${text.length}`);
  }

  async press(key: string): Promise<void> {
    this.actions.push(`press:${key}`);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.scrollX += deltaX;
    this.scrollY += deltaY;
    this.actions.push(`scroll:${deltaX},${deltaY}`);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.actions.push('close');
  }

  onConsole(): void {
    this.consoleListenerCount += 1;
  }

  onNetwork(): void {
    this.networkListenerCount += 1;
  }
}

class LongSessionSurfaceResourceGuard {
  private readonly activeObjectUrlBySession = new Map<string, { frameRef: string; objectUrlRef: string }>();
  private readonly objectUrlStatsBySession = new Map<string, { created: number; revoked: number }>();
  private readonly attachedSurfaceBySession = new Map<string, {
    sessionRef: string;
    liveSurfaceRef: string;
    liveSurfaceTransport: LongSessionSurfaceTransport;
  }>();
  private objectUrlsCreated = 0;
  private objectUrlsRevoked = 0;
  private surfaceAttachCount = 0;
  private surfaceDetachCount = 0;
  private maxOutstandingObjectUrls = 0;
  private maxOutstandingSurfaces = 0;
  private readonly events: string[] = [];

  attachSurface(state: BrowserHostSessionState, reason: string): void {
    assert.equal(state.owner, 'host');
    assert.equal(state.singleInteractiveTruth, true);
    const liveSurfaceRef = state.liveSurfaceRef ?? browserHostLiveSurfaceRef(state.id);
    assert.equal(liveSurfaceRef, browserHostLiveSurfaceRef(state.id));
    assert.equal(this.attachedSurfaceBySession.has(state.id), false, `${state.id} surface should not attach twice without detach`);
    const liveSurfaceTransport = state.liveSurfaceTransport;
    assert.equal(liveSurfaceTransport, 'native-embedded');
    this.attachedSurfaceBySession.set(state.id, {
      sessionRef: browserHostSessionRef(state.id),
      liveSurfaceRef,
      liveSurfaceTransport,
    });
    this.surfaceAttachCount += 1;
    this.maxOutstandingSurfaces = Math.max(this.maxOutstandingSurfaces, this.attachedSurfaceBySession.size);
    this.record('surface-attach', state.id, liveSurfaceRef, reason);
  }

  replaceObjectUrlFromFrame(state: BrowserHostSessionState, reason: string): void {
    if (state.liveSurfaceTransport === 'native-embedded') return;
    if (!state.frameRef) return;
    assert.equal(state.frameStreamRef, `browser-host-session:${state.id}/frame-stream`);
    assert.equal(state.frameRef.startsWith(`browser-host-session:${state.id}/`), true);
    this.revokeObjectUrl(state.id, 'superseded-frame');
    const objectUrlRef = `browser-host-session:${state.id}/object-url/${shortHash(state.frameRef)}`;
    this.activeObjectUrlBySession.set(state.id, { frameRef: state.frameRef, objectUrlRef });
    this.objectUrlsCreated += 1;
    this.sessionObjectUrlStats(state.id).created += 1;
    this.maxOutstandingObjectUrls = Math.max(this.maxOutstandingObjectUrls, this.activeObjectUrlBySession.size);
    this.record('object-url-create', state.id, objectUrlRef, reason);
  }

  closeTab(state: BrowserHostSessionState, driver: DeterministicLongSessionDriver, reason: string): BoundedTabCloseRelease {
    assert.equal(state.status, 'closed');
    const objectUrlStats = this.sessionObjectUrlStats(state.id);
    this.revokeObjectUrl(state.id, reason);
    const detached = this.detachSurface(state.id, reason);
    const liveSurfaceRef = detached?.liveSurfaceRef ?? state.liveSurfaceRef ?? browserHostLiveSurfaceRef(state.id);
    const liveSurfaceTransport = detached?.liveSurfaceTransport ?? state.liveSurfaceTransport;
    assert.equal(liveSurfaceTransport, 'native-embedded');
    const release = {
      sessionRef: browserHostSessionRef(state.id),
      finalStatus: state.status,
      liveSurfaceRef,
      liveSurfaceTransport: liveSurfaceTransport as LongSessionSurfaceTransport,
      driverClosed: driver.closed,
      surfaceDetached: Boolean(detached),
      nativeSurfaceDetached: liveSurfaceTransport === 'native-embedded' ? Boolean(detached) : true,
      objectUrlsCreated: objectUrlStats.created,
      objectUrlsRevoked: objectUrlStats.revoked,
      outstandingObjectUrls: this.activeObjectUrlBySession.has(state.id) ? 1 : 0,
      outstandingSurfaces: this.attachedSurfaceBySession.has(state.id) ? 1 : 0,
    } satisfies BoundedTabCloseRelease;
    this.record('tab-close-release', state.id, liveSurfaceRef, reason);
    return release;
  }

  snapshot(): { objectUrlRevoke: LongSessionResourceCounter; surfaceDetach: LongSessionResourceCounter } {
    return {
      objectUrlRevoke: {
        created: this.objectUrlsCreated,
        released: this.objectUrlsRevoked,
        outstanding: this.activeObjectUrlBySession.size,
        maxOutstanding: this.maxOutstandingObjectUrls,
        eventRef: this.eventRef('object-url-revoke'),
      },
      surfaceDetach: {
        created: this.surfaceAttachCount,
        released: this.surfaceDetachCount,
        outstanding: this.attachedSurfaceBySession.size,
        maxOutstanding: this.maxOutstandingSurfaces,
        eventRef: this.eventRef('surface-detach'),
      },
    };
  }

  private revokeObjectUrl(sessionId: string, reason: string): void {
    const active = this.activeObjectUrlBySession.get(sessionId);
    if (!active) return;
    this.activeObjectUrlBySession.delete(sessionId);
    this.objectUrlsRevoked += 1;
    this.sessionObjectUrlStats(sessionId).revoked += 1;
    this.record('object-url-revoke', sessionId, active.objectUrlRef, reason);
  }

  private detachSurface(sessionId: string, reason: string): { sessionRef: string; liveSurfaceRef: string; liveSurfaceTransport: LongSessionSurfaceTransport } | undefined {
    const attached = this.attachedSurfaceBySession.get(sessionId);
    if (!attached) return undefined;
    this.attachedSurfaceBySession.delete(sessionId);
    this.surfaceDetachCount += 1;
    this.record('surface-detach', sessionId, attached.liveSurfaceRef, reason);
    return attached;
  }

  private sessionObjectUrlStats(sessionId: string): { created: number; revoked: number } {
    const existing = this.objectUrlStatsBySession.get(sessionId);
    if (existing) return existing;
    const stats = { created: 0, revoked: 0 };
    this.objectUrlStatsBySession.set(sessionId, stats);
    return stats;
  }

  private record(kind: string, sessionId: string, ref: string, reason: string): void {
    assert.doesNotMatch(ref, /blob:|data:image|base64|<\s*(?:!doctype|html|body|input|canvas)\b/i);
    this.events.push(`${kind}:${browserHostSessionRef(sessionId)}:${shortHash(ref)}:${reason}`);
  }

  private eventRef(kind: string): string {
    return `browser-host-session:long-session-stability/resource-guard/${kind}/${shortHash(this.events.join('|'))}`;
  }
}

interface LongSessionSmokeConfig {
  requestedMinutes?: number;
  iterations: number;
  source: 'default' | 'minutes-env' | 'iterations-env';
}

interface EvidenceRefSummary {
  ref: string;
  bytes?: number;
  sha256?: string;
  missing?: true;
}

type LongSessionSurfaceTransport = NonNullable<BrowserHostSessionState['liveSurfaceTransport']>;

interface LongSessionResourceCounter {
  created: number;
  released: number;
  outstanding: number;
  maxOutstanding: number;
  eventRef: string;
}

interface BoundedTabCloseRelease {
  sessionRef: string;
  finalStatus: BrowserHostSessionState['status'];
  liveSurfaceRef: string;
  liveSurfaceTransport: LongSessionSurfaceTransport;
  driverClosed: boolean;
  surfaceDetached: boolean;
  nativeSurfaceDetached: boolean;
  objectUrlsCreated: number;
  objectUrlsRevoked: number;
  outstandingObjectUrls: number;
  outstandingSurfaces: number;
}

interface LongSessionResourceGuards {
  driverCount: number;
  closedDriverCount: number;
  listenerRegistrations: Array<{ console: number; network: number }>;
  closedSessionRejectsInput: boolean;
  tabCloseReleases: BoundedTabCloseRelease[];
  objectUrlRevoke: LongSessionResourceCounter;
  surfaceDetach: LongSessionResourceCounter;
}

function longSessionSmokeConfig(): LongSessionSmokeConfig {
  const iterationsFromEnv = positiveInteger(process.env.SCIFORGE_BROWSER_LONG_SESSION_ITERATIONS);
  if (iterationsFromEnv) {
    return { iterations: iterationsFromEnv, source: 'iterations-env' };
  }
  const requestedMinutes = positiveNumber(process.env.SCIFORGE_BROWSER_LONG_SESSION_MINUTES);
  if (requestedMinutes) {
    return {
      requestedMinutes,
      iterations: Math.max(4, Math.ceil(requestedMinutes * 12)),
      source: 'minutes-env',
    };
  }
  return { iterations: 4, source: 'default' };
}

async function boundedLongSessionReport(
  workspacePath: string,
  primary: BrowserHostSessionState,
  closed: BrowserHostSessionState,
  reopenedClosed: BrowserHostSessionState,
  config: LongSessionSmokeConfig,
  resourceGuards: LongSessionResourceGuards,
) {
  return {
    schemaVersion: 'sciforge.browser-host-session.long-session-stability-smoke.v1',
    source: 'local-deterministic-browser-host-session-fixture',
    publicNetworkUsed: false,
    refsOnly: true,
    config,
    primary: {
      id: primary.id,
      statusBeforeClose: primary.status,
      finalStatus: closed.status,
      owner: primary.owner,
      providerId: primary.providerId,
      finalUrlHash: sha256Text(primary.url),
      liveSurfaceTransport: primary.liveSurfaceTransport,
      frameStreamRef: primary.frameStreamRef,
      actionsCovered: LOOP_ACTIONS,
      evidenceRefs: await evidenceRefSummaries(workspacePath, primary),
      timingSummary: LOOP_ACTIONS.map((action) => requiredTimingSummary(action === 'close' ? closed : primary, action)),
    },
    reopen: {
      id: reopenedClosed.id,
      status: reopenedClosed.status,
      liveSurfaceTransport: reopenedClosed.liveSurfaceTransport,
      frameStreamRef: reopenedClosed.frameStreamRef,
      timingSummary: ['open', 'type', 'close'].map((action) => requiredTimingSummary(reopenedClosed, action as BrowserHostSessionAction | 'open')),
    },
    resourceGuards,
  };
}

async function nativeTabCloseReleaseContract(workspacePath: string): Promise<BoundedTabCloseRelease> {
  const nativeResourceGuard = new LongSessionSurfaceResourceGuard();
  const { factory, drivers } = deterministicLongSessionDriverFactory({ liveSurfaceTransport: 'native-embedded' });
  const manager = new BrowserHostSessionManager({ driverFactory: factory });
  const opened = await manager.openSession(workspacePath, {
    url: 'http://localhost/long-session/native-tab',
    sessionId: 'long-session-native-tab-close',
    width: 960,
    height: 640,
    timeoutMs: 2_000,
  });
  assert.equal(opened.status, 'ready');
  assert.equal(opened.owner, 'host');
  assert.equal(opened.singleInteractiveTruth, true);
  assert.equal(opened.liveSurfaceTransport, 'native-embedded');
  assert.equal(opened.frameStreamRef, undefined);
  nativeResourceGuard.attachSurface(opened, 'native-tab-open');

  const driver = requiredDriver(drivers, 0);
  const closed = await manager.act(workspacePath, opened.id, {
    action: 'close',
    capture: 'none',
    actionId: 'long-session-native-tab-close',
    adapterSentAt: recentAdapterTimestamp(),
  });
  assert.equal(closed.status, 'closed');
  assert.equal(driver.closed, true);
  await assert.rejects(
    () => manager.act(workspacePath, opened.id, {
      action: 'type',
      text: 'must not route to closed native surface',
      capture: 'none',
      actionId: 'long-session-native-closed-type',
    }),
    /no active browser driver|not active|session is closed/i,
  );

  const release = nativeResourceGuard.closeTab(closed, driver, 'tab-close');
  const snapshot = nativeResourceGuard.snapshot();
  assert.equal(snapshot.objectUrlRevoke.created, 0, 'native embedded surface must not allocate host-stream object URLs');
  assert.equal(snapshot.objectUrlRevoke.released, 0);
  assert.equal(snapshot.surfaceDetach.created, 1);
  assert.equal(snapshot.surfaceDetach.released, 1);
  assert.equal(snapshot.surfaceDetach.outstanding, 0);
  assert.equal(release.liveSurfaceTransport, 'native-embedded');
  assert.equal(release.nativeSurfaceDetached, true);
  assert.equal(release.surfaceDetached, true);
  return release;
}

async function evidenceRefSummaries(workspacePath: string, state: BrowserHostSessionState): Promise<EvidenceRefSummary[]> {
  const refs = [
    state.frameStreamRef,
    state.frameRef,
    state.screenshotRef,
    state.domSnapshotRef,
    state.axSnapshotRef,
    state.consoleLogRef,
    state.networkLogRef,
  ].filter((ref): ref is string => Boolean(ref));
  const sessionDir = browserHostSessionDir(workspacePath, state.id);
  return Promise.all(refs.map(async (ref) => {
    const prefix = `browser-host-session:${state.id}/`;
    if (!ref.startsWith(prefix)) return { ref, missing: true };
    const relativePath = ref.slice(prefix.length);
    const filePath = join(sessionDir, relativePath);
    try {
      const fileStat = await stat(filePath);
      const bytes = await readFile(filePath);
      return {
        ref,
        bytes: fileStat.size,
        sha256: sha256Buffer(bytes),
      };
    } catch {
      return { ref, missing: true };
    }
  }));
}

function assertProductLongSessionPlatformContract(report: Awaited<ReturnType<typeof boundedLongSessionReport>>): void {
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-host-session-product-long-session-platform-contract',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: [
      'browser-native-adapter-comparison:product-long-session-contract',
      ...report.primary.evidenceRefs.map((entry) => entry.ref),
    ],
    decision: {
      status: 'undecided',
      rationaleRefs: ['browser-native-adapter-comparison:product-long-session-metrics-schema'],
      followUpRefs: ['browser-native-adapter-comparison:future-real-30min-platform-benchmark'],
    },
  });

  assert.deepEqual(validateBrowserNativeAdapterComparisonManifest(comparisonManifest), []);
  assert.equal(comparisonManifest.productLongSession.durationMinutes, 30);
  assert.equal(comparisonManifest.productLongSession.benchmarkClaim, false);
  assert.equal(comparisonManifest.productLongSession.mode, 'schema-only-no-real-platform-benchmark');
  assert.deepEqual(comparisonManifest.productLongSession.candidateIds, [...REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES]);
  assert.deepEqual(comparisonManifest.productLongSession.requiredMetricSections, [...REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS]);
  for (const candidate of comparisonManifest.candidates) {
    assert.equal(candidate.secondTruthSource, false);
    assert.equal(candidate.metrics.secondTruthSource.value, false);
    for (const section of REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS) {
      assert.equal(candidate.metrics[section].evidenceMode, 'bounded-summary-ref');
      assert.equal(candidate.metrics[section].inlineEvidence, 'forbidden');
      assert.ok(candidate.metrics[section].fields.length > 0);
    }
  }
  assert.doesNotMatch(
    JSON.stringify(comparisonManifest),
    /data:image|base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|input|canvas|iframe)\b/i,
  );
}

function assertResourceGuards(resourceGuards: LongSessionResourceGuards): void {
  assert.equal(resourceGuards.driverCount, resourceGuards.closedDriverCount);
  assert.equal(resourceGuards.closedSessionRejectsInput, true);
  assert.ok(resourceGuards.listenerRegistrations.every((entry) => entry.console === 1 && entry.network === 1));
  assert.equal(resourceGuards.objectUrlRevoke.created, resourceGuards.objectUrlRevoke.released);
  assert.equal(resourceGuards.objectUrlRevoke.outstanding, 0);
  assert.equal(resourceGuards.objectUrlRevoke.created, 0, 'native embedded product loop must not allocate host-stream object URLs');
  assert.equal(resourceGuards.objectUrlRevoke.maxOutstanding, 0);
  assert.equal(resourceGuards.surfaceDetach.created, resourceGuards.surfaceDetach.released);
  assert.equal(resourceGuards.surfaceDetach.outstanding, 0);
  assert.ok(resourceGuards.surfaceDetach.created >= 2, 'tab lifecycle should attach and detach each deterministic surface');
  assert.match(resourceGuards.objectUrlRevoke.eventRef, /^browser-host-session:/);
  assert.match(resourceGuards.surfaceDetach.eventRef, /^browser-host-session:/);
  assert.ok(resourceGuards.tabCloseReleases.some((entry) => entry.liveSurfaceTransport === 'native-embedded'));
  for (const release of resourceGuards.tabCloseReleases) {
    assert.match(release.sessionRef, /^browser-host-session:/);
    assert.match(release.liveSurfaceRef, /^browser-host-session:[^/]+\/live-surface$/);
    assert.equal(release.finalStatus, 'closed');
    assert.equal(release.driverClosed, true);
    assert.equal(release.surfaceDetached, true);
    assert.equal(release.objectUrlsCreated, release.objectUrlsRevoked);
    assert.equal(release.objectUrlsCreated, 0, 'native embedded release should not depend on host-stream object URLs');
    assert.equal(release.outstandingObjectUrls, 0);
    assert.equal(release.outstandingSurfaces, 0);
    if (release.liveSurfaceTransport === 'native-embedded') {
      assert.equal(release.nativeSurfaceDetached, true);
    }
  }
}

function assertTimingCounts(state: BrowserHostSessionState, iterations: number): void {
  assert.equal(requiredTimingSummary(state, 'open').count, 1);
  for (const action of ['navigate', 'type', 'scroll', 'drag', 'back', 'forward', 'reload'] as const) {
    const summary = requiredTimingSummary(state, action);
    assert.equal(summary.count, iterations, `${action} should have one timing sample per loop`);
    assert.ok(summary.p95Ms >= summary.p50Ms, `${action} p95 should not be lower than p50`);
    assert.ok(Number.isFinite(summary.lastMs), `${action} lastMs should be finite`);
  }
}

function requiredTimingSummary(
  state: BrowserHostSessionState,
  action: BrowserHostSessionAction | 'open',
): BrowserHostSessionActionTimingSummary {
  const summary = state.actionTimingSummary?.find((row) => row.action === action);
  assert.ok(summary, `missing timing summary for ${state.id}:${action}`);
  return summary;
}

function requiredDriver(drivers: DeterministicLongSessionDriver[], index: number): DeterministicLongSessionDriver {
  const driver = drivers[index];
  assert.ok(driver, `deterministic long-session driver ${index} should exist`);
  return driver;
}

function dragPath(index: number): BrowserHostMousePoint[] {
  return [
    { x: 24 + index, y: 32 },
    { x: 120 + index, y: 96 + index },
    { x: 224 + index, y: 64 },
  ];
}

function typedTextLength(iterations: number): number {
  let total = 0;
  for (let index = 0; index < iterations; index += 1) total += ` stable-input-${index}`.length;
  return total;
}

function actionId(action: BrowserHostSessionAction, index: number): string {
  return `long-session-${action}-${index}`;
}

function recentAdapterTimestamp(): string {
  return new Date(Date.now() - 1).toISOString();
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stablePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function browserHostSessionRef(sessionId: string): string {
  return `browser-host-session:${sessionId}`;
}

function browserHostLiveSurfaceRef(sessionId: string): string {
  return `${browserHostSessionRef(sessionId)}/live-surface`;
}

function shortHash(value: string): string {
  return sha256Text(value).slice(0, 16);
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
