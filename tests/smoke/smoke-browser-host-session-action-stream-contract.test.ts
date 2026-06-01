import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BrowserHostSessionManager,
  type BrowserHostMouseButton,
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

test('BrowserHostSession action stream ACKs capture:none input while deferred frame capture is still pending', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-action-stream-'));
  const { factory, drivers } = actionStreamDriverFactory({ holdDeferredScreenshots: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/action-stream/start',
      sessionId: 'action-stream-contract',
    });
    const driver = requiredDriver(drivers);
    const screenshotCallsAfterOpen = driver.screenshotCalls;

    const clicked = await manager.act(workspacePath, opened.id, {
      action: 'click',
      x: 24,
      y: 32,
      actionId: 'stream-click-1',
    });
    assert.equal(clicked.owner, 'host');
    assert.equal(clicked.providerId, BROWSER_HOST_SESSION_PROVIDER_ID);
    assert.equal(clicked.singleInteractiveTruth, true);
    assert.equal(clicked.lastActionTiming?.action, 'click');
    assert.equal(clicked.lastActionTiming?.capture, 'frame');
    assert.equal(clicked.lastActionTiming?.paintAckSource, 'none');
    assert.equal(clicked.lastActionTiming?.evidenceCaptureStartedAt, undefined);

    await waitFor(() => driver.screenshotCalls === screenshotCallsAfterOpen + 1);

    const typed = await withTimeout(manager.act(workspacePath, opened.id, {
      action: 'type',
      text: 'stream input',
      capture: 'none',
      actionId: 'stream-type-1',
    }), 100, 'type action stream ACK');
    const scrolled = await withTimeout(manager.act(workspacePath, opened.id, {
      action: 'scroll',
      deltaX: 0,
      deltaY: 360,
      capture: 'none',
      actionId: 'stream-scroll-1',
    }), 100, 'scroll action stream ACK');
    const cursor = await withTimeout(manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: 8,
      y: 12,
      capture: 'none',
      actionId: 'stream-cursor-1',
    }), 100, 'cursor action stream ACK');
    const pressed = await withTimeout(manager.act(workspacePath, opened.id, {
      action: 'press',
      key: 'Enter',
      capture: 'none',
      actionId: 'stream-press-1',
    }), 100, 'press action stream ACK');

    assert.equal(typed.lastActionTiming?.capture, 'none');
    assert.equal(scrolled.lastActionTiming?.capture, 'none');
    assert.equal(cursor.lastActionTiming?.capture, 'none');
    assert.equal(pressed.lastActionTiming?.capture, 'none');
    assert.equal(driver.inputValue, 'stream input');
    assert.equal(driver.scrollY, 360);
    assert.equal(cursor.cursor, 'pointer');
    assert.deepEqual(driver.actions, [
      'goto:http://localhost/action-stream/start',
      'click:left:24,32',
      'type:stream input',
      'scroll:0,360',
      'cursor:8,12',
      'press:Enter',
    ]);

    const report = actionStreamReport(pressed, driver, screenshotCallsAfterOpen);
    assert.equal(report.secondTruthSource, false);
    assert.equal(report.rawPayloadsCaptured, false);
    assert.equal(report.refs.liveSurfaceRef, 'browser-host-session:action-stream-contract/live-surface');
    assert.equal(report.capture.blockedInputActionCount, 0);
    assert.doesNotMatch(JSON.stringify(report), /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);

    driver.releaseDeferredScreenshot();
    await waitFor(() => driver.deferredScreenshotReleased);
  } finally {
    drivers[0]?.releaseDeferredScreenshot();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession action stream skips stale frame capture when scroll and mousemove arrive before capture starts', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-action-stream-skip-'));
  const { factory, drivers } = actionStreamDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/action-stream/backpressure',
      sessionId: 'action-stream-backpressure',
    });
    const driver = requiredDriver(drivers);
    const screenshotCallsAfterOpen = driver.screenshotCalls;

    await manager.act(workspacePath, opened.id, { action: 'click', x: 10, y: 20 });
    await manager.act(workspacePath, opened.id, { action: 'scroll', deltaY: 480, capture: 'none' });
    await manager.act(workspacePath, opened.id, { action: 'mouse-move', x: 20, y: 40, capture: 'none' });
    await sleep(120);

    assert.equal(driver.screenshotCalls, screenshotCallsAfterOpen);
    assert.deepEqual(driver.actions, [
      'goto:http://localhost/action-stream/backpressure',
      'click:left:10,20',
      'scroll:0,480',
      'mouse-move:20,40',
    ]);

    const state = await manager.sessionState(workspacePath, opened.id);
    assert.ok(state);
    const report = {
      schemaVersion: 'sciforge.browser-host-session.action-stream-backpressure-smoke.v1',
      owner: state.owner,
      liveSurfaceTransport: state.liveSurfaceTransport,
      singleInteractiveTruth: state.singleInteractiveTruth,
      refs: {
        liveSurfaceRef: state.liveSurfaceRef,
        frameStreamRef: state.frameStreamRef,
      },
      capture: {
        screenshotCallsAfterOpen,
        screenshotCallsAfterBurst: driver.screenshotCalls,
        staleCaptureSkipped: driver.screenshotCalls === screenshotCallsAfterOpen,
      },
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    const reportPath = join(workspacePath, 'action-stream-backpressure-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assert.doesNotMatch(reportText, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
    assert.equal(report.capture.staleCaptureSkipped, true);

    console.log(`[ok] BrowserHostSession action stream backpressure ${JSON.stringify(report.capture)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession input channel serializes one session while coalescing type, scroll, and mousemove bursts', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-input-channel-'));
  const { factory, drivers } = actionStreamDriverFactory({ holdType: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/action-stream/input-channel',
      sessionId: 'input-channel-contract',
    });
    const driver = requiredDriver(drivers);

    const typeA = manager.act(workspacePath, opened.id, {
      action: 'type',
      text: 'com',
      capture: 'none',
      actionId: 'input-type-a',
    });
    const typeB = manager.act(workspacePath, opened.id, {
      action: 'type',
      text: 'posed',
      capture: 'none',
      actionId: 'input-type-b',
    });
    await waitFor(() => driver.actions.includes('type:composed'));

    const scrollA = manager.act(workspacePath, opened.id, {
      action: 'scroll',
      deltaX: 2,
      deltaY: 120,
      capture: 'none',
      actionId: 'input-scroll-a',
    });
    const scrollB = manager.act(workspacePath, opened.id, {
      action: 'scroll',
      deltaX: 3,
      deltaY: 30,
      capture: 'none',
      actionId: 'input-scroll-b',
    });
    const moveA = manager.act(workspacePath, opened.id, {
      action: 'mouse-move',
      x: 10,
      y: 20,
      capture: 'none',
      actionId: 'input-move-stale',
    });
    const moveB = manager.act(workspacePath, opened.id, {
      action: 'mouse-move',
      x: 30,
      y: 40,
      capture: 'none',
      actionId: 'input-move-latest',
    });

    await sleep(20);
    assert.deepEqual(driver.actions, [
      'goto:http://localhost/action-stream/input-channel',
      'type:composed',
    ]);

    driver.releaseHeldType();
    const states = await Promise.all([
      withTimeout(typeA, 100, 'coalesced type A ACK'),
      withTimeout(typeB, 100, 'coalesced type B ACK'),
      withTimeout(scrollA, 100, 'coalesced scroll A ACK'),
      withTimeout(scrollB, 100, 'coalesced scroll B ACK'),
      withTimeout(moveA, 100, 'stale mousemove ACK'),
      withTimeout(moveB, 100, 'latest mousemove ACK'),
    ]);

    assert.equal(states[0]?.lastActionTiming?.action, 'type');
    assert.equal(states[1]?.lastActionTiming?.action, 'type');
    assert.equal(states[2]?.lastActionTiming?.action, 'scroll');
    assert.equal(states[3]?.lastActionTiming?.action, 'scroll');
    assert.equal(states[4]?.lastActionTiming?.action, 'mouse-move');
    assert.equal(states[5]?.lastActionTiming?.actionId, 'input-move-latest');
    assert.equal(driver.inputValue, 'composed');
    assert.equal(driver.scrollX, 5);
    assert.equal(driver.scrollY, 150);
    assert.deepEqual(driver.actions, [
      'goto:http://localhost/action-stream/input-channel',
      'type:composed',
      'scroll:5,150',
      'mouse-move:30,40',
    ]);

    const report = {
      schemaVersion: 'sciforge.browser-host-session.input-channel-contract-smoke.v1',
      sessionId: opened.id,
      serialSameSession: true,
      coalescing: {
        typeDeltasMerged: true,
        scrollBurstMerged: true,
        staleMouseMoveDropped: true,
        driverInputActionCount: driver.actions.filter((action) => /^(?:type|scroll|mouse-move):/.test(action)).length,
      },
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    const reportPath = join(workspacePath, 'input-channel-contract-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assert.doesNotMatch(reportText, /composed|data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);

    console.log(`[ok] BrowserHostSession input channel ${JSON.stringify(report.coalescing)}`);
  } finally {
    drivers[0]?.releaseHeldType();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession composition text deltas coalesce without per-character evidence refresh', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-composition-delta-'));
  const { factory, drivers } = actionStreamDriverFactory({ holdType: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/action-stream/composition-delta',
      sessionId: 'composition-delta-contract',
    });
    const driver = requiredDriver(drivers);
    const screenshotCallsAfterOpen = driver.screenshotCalls;
    const contentCallsAfterOpen = driver.contentCalls;
    const axSnapshotCallsAfterOpen = driver.axSnapshotCalls;
    const deltas = ['raw-alpha-', 'raw-beta-', 'raw-gamma'];
    const expectedText = deltas.join('');

    const deltaActions = deltas.map((text, index) => manager.act(workspacePath, opened.id, {
      action: 'type',
      text,
      capture: 'none',
      actionId: `composition-delta-${index + 1}`,
    }));
    await waitFor(() => driver.actions.includes(`type:${expectedText}`));
    await sleep(20);

    assert.equal(driver.actions.filter((action) => action.startsWith('type:')).length, 1);
    assert.equal(driver.inputValue, expectedText);
    assert.equal(driver.screenshotCalls, screenshotCallsAfterOpen);
    assert.equal(driver.contentCalls, contentCallsAfterOpen);
    assert.equal(driver.axSnapshotCalls, axSnapshotCallsAfterOpen);

    driver.releaseHeldType();
    const states = await Promise.all(deltaActions.map((action, index) => (
      withTimeout(action, 100, `composition delta ${index + 1} ACK`)
    )));

    assert.equal(states.every((state) => state.owner === 'host'), true);
    assert.equal(states.every((state) => state.providerId === BROWSER_HOST_SESSION_PROVIDER_ID), true);
    assert.equal(states.every((state) => state.singleInteractiveTruth === true), true);
    assert.equal(states.every((state) => state.lastActionTiming?.action === 'type'), true);
    assert.equal(states.every((state) => state.lastActionTiming?.capture === 'none'), true);

    const report = {
      schemaVersion: 'sciforge.browser-host-session.composition-delta-contract-smoke.v1',
      sessionId: opened.id,
      refs: {
        liveSurfaceRef: states.at(-1)?.liveSurfaceRef,
        frameStreamRef: states.at(-1)?.frameStreamRef,
      },
      compositionDelta: {
        inputOwner: 'BrowserHostSession',
        deltaCount: deltas.length,
        driverTypeActionCount: driver.actions.filter((action) => action.startsWith('type:')).length,
        typedPayloadPolicy: 'length-and-count-only',
        rawTextRecorded: false,
      },
      capture: {
        captureMode: states.at(-1)?.lastActionTiming?.capture,
        screenshotCallsAfterOpen,
        screenshotCallsAfterDeltasAck: driver.screenshotCalls,
        contentCallsAfterOpen,
        contentCallsAfterDeltasAck: driver.contentCalls,
        axSnapshotCallsAfterOpen,
        axSnapshotCallsAfterDeltasAck: driver.axSnapshotCalls,
      },
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    const reportPath = join(workspacePath, 'composition-delta-contract-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assert.doesNotMatch(reportText, /raw-alpha|raw-beta|raw-gamma|data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
    assert.equal(report.compositionDelta.driverTypeActionCount, 1);
    assert.equal(report.capture.screenshotCallsAfterDeltasAck, screenshotCallsAfterOpen);
    assert.equal(report.capture.contentCallsAfterDeltasAck, contentCallsAfterOpen);
    assert.equal(report.capture.axSnapshotCallsAfterDeltasAck, axSnapshotCallsAfterOpen);

    console.log(`[ok] BrowserHostSession composition delta ${JSON.stringify(report.compositionDelta)}`);
  } finally {
    drivers[0]?.releaseHeldType();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession drag streams pointerdown/move/up path without one-shot drag evidence', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-drag-stream-'));
  const { factory, drivers } = actionStreamDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/action-stream/drag-stream',
      sessionId: 'drag-stream-contract',
    });
    const driver = requiredDriver(drivers);
    const screenshotCallsAfterOpen = driver.screenshotCalls;

    const dragged = await withTimeout(manager.act(workspacePath, opened.id, {
      action: 'drag',
      path: [
        { x: 12, y: 18 },
        { x: 18, y: 24 },
        { x: 26, y: 36 },
        { x: 40, y: 50 },
      ],
      button: 'left',
      actionId: 'drag-stream-path-1',
    }), 100, 'drag pointer stream ACK');

    assert.equal(dragged.owner, 'host');
    assert.equal(dragged.singleInteractiveTruth, true);
    assert.equal(dragged.lastActionTiming?.action, 'drag');
    assert.equal(dragged.lastActionTiming?.capture, 'frame');
    assert.equal(dragged.lastActionTiming?.evidenceCaptureStartedAt, undefined);
    assert.equal(driver.dragOneShotCalls, 0);
    assert.deepEqual(driver.actions, [
      'goto:http://localhost/action-stream/drag-stream',
      'mouse-down:left:12,18',
      'mouse-move:18,24',
      'mouse-move:26,36',
      'mouse-move:40,50',
      'mouse-up:left:40,50',
    ]);

    const report = {
      schemaVersion: 'sciforge.browser-host-session.drag-stream-contract-smoke.v1',
      sessionId: opened.id,
      refs: {
        liveSurfaceRef: dragged.liveSurfaceRef,
        frameStreamRef: dragged.frameStreamRef,
      },
      pointerStream: {
        inputOwner: 'BrowserHostSession',
        pointerDownCount: driver.actions.filter((action) => action.startsWith('mouse-down:')).length,
        pointerMoveCount: driver.actions.filter((action) => action.startsWith('mouse-move:')).length,
        pointerUpCount: driver.actions.filter((action) => action.startsWith('mouse-up:')).length,
        pathPointCount: 4,
        oneShotDragUsed: driver.dragOneShotCalls > 0,
      },
      capture: {
        ackBeforeEvidenceCapture: dragged.lastActionTiming?.evidenceCaptureStartedAt === undefined,
        screenshotCallsAfterOpen,
        screenshotCallsAtAck: driver.screenshotCalls,
      },
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    const reportPath = join(workspacePath, 'drag-stream-contract-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assert.doesNotMatch(reportText, /12,18|18,24|26,36|40,50|data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
    assert.equal(report.pointerStream.pointerDownCount, 1);
    assert.equal(report.pointerStream.pointerMoveCount, 3);
    assert.equal(report.pointerStream.pointerUpCount, 1);
    assert.equal(report.pointerStream.oneShotDragUsed, false);
    assert.equal(report.capture.ackBeforeEvidenceCapture, true);

    await manager.act(workspacePath, opened.id, { action: 'close', capture: 'none' });
    console.log(`[ok] BrowserHostSession drag stream ${JSON.stringify(report.pointerStream)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession rejects input after close and defers capture-full evidence until after input ACK', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-input-channel-close-'));
  const { factory, drivers } = actionStreamDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/action-stream/close',
      sessionId: 'input-channel-close-contract',
    });
    const driver = requiredDriver(drivers);
    const screenshotCallsAfterOpen = driver.screenshotCalls;
    const contentCallsAfterOpen = driver.contentCalls;
    const axSnapshotCallsAfterOpen = driver.axSnapshotCalls;

    const fullCaptureInput = await withTimeout(manager.act(workspacePath, opened.id, {
      action: 'type',
      text: 'deferred evidence',
      capture: 'full',
      actionId: 'input-capture-full',
    }), 100, 'capture-full input ACK');
    assert.equal(fullCaptureInput.lastActionTiming?.capture, 'full');
    assert.equal(fullCaptureInput.lastActionTiming?.evidenceCaptureStartedAt, undefined);
    assert.equal(fullCaptureInput.lastActionTiming?.evidenceCaptureEndedAt, undefined);
    assert.equal(driver.screenshotCalls, screenshotCallsAfterOpen);
    assert.equal(driver.contentCalls, contentCallsAfterOpen);
    assert.equal(driver.axSnapshotCalls, axSnapshotCallsAfterOpen);

    await waitFor(() => driver.screenshotCalls === screenshotCallsAfterOpen + 1);
    await waitFor(() => driver.contentCalls === contentCallsAfterOpen + 1);
    await waitFor(() => driver.axSnapshotCalls === axSnapshotCallsAfterOpen + 1);

    const closed = await manager.act(workspacePath, opened.id, {
      action: 'close',
      actionId: 'input-channel-close',
    });
    assert.equal(closed.status, 'closed');
    await assert.rejects(
      () => manager.act(workspacePath, opened.id, {
        action: 'type',
        text: 'must not type after close',
        capture: 'none',
        actionId: 'input-after-close',
      }),
      /BrowserHostSession is closed: input-channel-close-contract/,
    );
    assert.equal(driver.inputValue, 'deferred evidence');

    const report = {
      schemaVersion: 'sciforge.browser-host-session.input-channel-close-contract-smoke.v1',
      sessionId: opened.id,
      captureFullAckBeforeEvidence: true,
      closeRejectsInput: true,
      evidenceCounters: {
        screenshotCallsAfterOpen,
        screenshotCallsAfterAck: screenshotCallsAfterOpen,
        screenshotCallsAfterDeferredCapture: driver.screenshotCalls,
      },
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    const reportPath = join(workspacePath, 'input-channel-close-contract-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assert.doesNotMatch(reportText, /deferred evidence|must not type|data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);

    console.log(`[ok] BrowserHostSession input channel close/capture ${JSON.stringify(report.evidenceCounters)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function actionStreamDriverFactory(options: { holdDeferredScreenshots?: boolean; holdType?: boolean } = {}): {
  factory: BrowserHostSessionDriverFactory;
  drivers: ActionStreamDriver[];
} {
  const drivers: ActionStreamDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
        const driver = new ActionStreamDriver(options);
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class ActionStreamDriver implements BrowserHostSessionDriver {
  currentUrl = 'about:blank';
  inputValue = '';
  scrollX = 0;
  scrollY = 0;
  actions: string[] = [];
  screenshotCalls = 0;
  contentCalls = 0;
  axSnapshotCalls = 0;
  dragOneShotCalls = 0;
  deferredScreenshotReleased = false;
  private releaseDeferredScreenshotCallback?: () => void;
  private releaseHeldTypeCallback?: () => void;
  private heldTypeReleased = false;

  constructor(private readonly options: { holdDeferredScreenshots?: boolean; holdType?: boolean } = {}) {}

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.actions.push(`goto:${url}`);
  }

  async title(): Promise<string> {
    return 'BrowserHostSession action stream contract';
  }

  async content(): Promise<string> {
    this.contentCalls += 1;
    return '<!-- refs-first action stream fixture -->';
  }

  async text(): Promise<string> {
    return `inputLength=${this.inputValue.length} scrollY=${this.scrollY}`;
  }

  async screenshot(path: string): Promise<void> {
    this.screenshotCalls += 1;
    if (this.options.holdDeferredScreenshots && this.screenshotCalls > 1) {
      await new Promise<void>((resolve) => {
        this.releaseDeferredScreenshotCallback = () => {
          this.deferredScreenshotReleased = true;
          resolve();
        };
      });
    }
    await writeFile(path, PNG_1X1);
  }

  async axSnapshot(): Promise<unknown> {
    this.axSnapshotCalls += 1;
    return { role: 'document', name: 'BrowserHostSession action stream contract' };
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
    this.actions.push(`click:${button}:${x},${y}`);
  }

  async mouseMove(x: number, y: number): Promise<void> {
    this.actions.push(`mouse-move:${x},${y}`);
  }

  async mouseDown(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(`mouse-down:${button}:${x},${y}`);
  }

  async mouseUp(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(`mouse-up:${button}:${x},${y}`);
  }

  async drag(path: Array<{ x: number; y: number }>, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.dragOneShotCalls += 1;
    this.actions.push(`drag:${button}:${path.map((point) => `${point.x},${point.y}`).join('->')}`);
  }

  async type(text: string): Promise<void> {
    this.inputValue += text;
    this.actions.push(`type:${text}`);
    if (this.options.holdType && !this.heldTypeReleased) {
      await new Promise<void>((resolve) => {
        this.releaseHeldTypeCallback = resolve;
      });
    }
  }

  async press(key: string): Promise<void> {
    this.actions.push(`press:${key}`);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.scrollX += deltaX;
    this.scrollY += deltaY;
    this.actions.push(`scroll:${deltaX},${deltaY}`);
  }

  async cursor(x: number, y: number): Promise<string> {
    this.actions.push(`cursor:${x},${y}`);
    return 'pointer';
  }

  async close(): Promise<void> {}

  releaseDeferredScreenshot(): void {
    this.releaseDeferredScreenshotCallback?.();
    this.releaseDeferredScreenshotCallback = undefined;
    this.deferredScreenshotReleased = true;
  }

  releaseHeldType(): void {
    this.heldTypeReleased = true;
    this.releaseHeldTypeCallback?.();
    this.releaseHeldTypeCallback = undefined;
  }
}

function actionStreamReport(state: BrowserHostSessionState, driver: ActionStreamDriver, screenshotCallsAfterOpen: number) {
  return {
    schemaVersion: 'sciforge.browser-host-session.action-stream-contract-smoke.v1',
    owner: state.owner,
    liveSurfaceTransport: state.liveSurfaceTransport,
    singleInteractiveTruth: state.singleInteractiveTruth,
    refs: {
      liveSurfaceRef: state.liveSurfaceRef,
      frameStreamRef: state.frameStreamRef,
      frameRef: state.frameRef,
    },
    capture: {
      screenshotCallsAfterOpen,
      screenshotCallsDuringInputAck: driver.screenshotCalls,
      blockedInputActionCount: 0,
    },
    actionTimingSummary: state.actionTimingSummary?.map((row) => ({
      action: row.action,
      count: row.count,
      p95Ms: row.p95Ms,
    })),
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  };
}

function requiredDriver(drivers: ActionStreamDriver[]): ActionStreamDriver {
  const driver = drivers[0];
  assert.ok(driver, 'BrowserHostSession action stream driver should be created');
  return driver;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) throw new Error('Timed out waiting for BrowserHostSession action stream condition.');
    await sleep(5);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
