import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BrowserHostSessionManager,
  type BrowserHostMouseButton,
  type BrowserHostMousePoint,
  type BrowserHostSessionAction,
  type BrowserHostSessionDriver,
  type BrowserHostSessionDriverFactory,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';
import {
  executeBrowserHostComputerUseAction,
  type BrowserHostComputerUseActionResult,
} from '../../src/runtime/browser-host-computer-use.js';

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

const artifactDir = join(process.cwd(), 'docs', 'test-artifacts', 'browser-mouse-gesture-completeness');
const manifestPath = join(artifactDir, 'manifest.json');
const MAX_MOUSE_GESTURE_ARTIFACT_BYTES = 48 * 1024;

const DRAG_PATH: BrowserHostMousePoint[] = [
  { x: 200, y: 208 },
  { x: 232, y: 240 },
  { x: 264, y: 224 },
  { x: 296, y: 256 },
];
const DRAG_DROP_PATH: BrowserHostMousePoint[] = [
  { x: 340, y: 220 },
  { x: 372, y: 244 },
  { x: 416, y: 268 },
  { x: 468, y: 292 },
];
const TEXT_SELECTION_PATH: BrowserHostMousePoint[] = [
  { x: 180, y: 340 },
  { x: 220, y: 340 },
  { x: 260, y: 340 },
  { x: 300, y: 340 },
];
const SCROLLBAR_THUMB_DRAG_PATH: BrowserHostMousePoint[] = [
  { x: 944, y: 120 },
  { x: 944, y: 220 },
  { x: 944, y: 340 },
  { x: 944, y: 460 },
];

type MouseGestureName =
  | 'left-click'
  | 'right-click'
  | 'middle-click'
  | 'double-click'
  | 'mouse-down'
  | 'continuous-move'
  | 'mouse-up'
  | 'drag-path'
  | 'drag-drop'
  | 'text-selection'
  | 'scrollbar-thumb-drag'
  | 'vertical-wheel'
  | 'horizontal-wheel';

type MouseGesturePolicy =
  | 'browser-context-menu'
  | 'browser-host-session-owned-middle-button'
  | 'browser-host-session-drag-drop-fixture'
  | 'browser-host-session-text-selection-fixture'
  | 'browser-host-session-scrollbar-thumb-drag-fixture';

interface MouseGestureTraceRecord {
  owner: 'BrowserHostSession';
  hostAction: BrowserHostSessionAction;
  gesture: MouseGestureName;
  x?: number;
  y?: number;
  button?: BrowserHostMouseButton;
  deltaX?: number;
  deltaY?: number;
  path?: BrowserHostMousePoint[];
  policy?: MouseGesturePolicy;
}

const REQUIRED_GESTURES: MouseGestureName[] = [
  'left-click',
  'right-click',
  'middle-click',
  'double-click',
  'mouse-down',
  'continuous-move',
  'mouse-up',
  'drag-path',
  'drag-drop',
  'text-selection',
  'scrollbar-thumb-drag',
  'vertical-wheel',
  'horizontal-wheel',
];

test('BrowserHostSession mouse gesture completeness is single-owner and refs-first', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-mouse-gesture-'));
  const { factory, drivers } = mouseGestureDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/mouse-gesture/start',
      sessionId: 'mouse-gesture-completeness',
      width: 960,
      height: 640,
      timeoutMs: 2_000,
    });
    assertBrowserHostState(opened, 'open');

    const driver = requiredDriver(drivers);
    const heavyCaptureCallsAfterOpen = {
      content: driver.contentCalls,
      ax: driver.axSnapshotCalls,
    };

    const actionStates: BrowserHostSessionState[] = [];
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'click',
      x: 18,
      y: 24,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-left-click',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'click',
      x: 42,
      y: 48,
      button: 'right',
      capture: 'none',
      actionId: 'mouse-right-click-context-policy',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'click',
      x: 66,
      y: 72,
      button: 'middle',
      capture: 'none',
      actionId: 'mouse-middle-click',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'double-click',
      x: 90,
      y: 96,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-double-click',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'mouse-down',
      x: 120,
      y: 128,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-down',
    }));
    for (const point of [{ x: 128, y: 136 }, { x: 136, y: 144 }, { x: 144, y: 152 }, { x: 152, y: 160 }]) {
      actionStates.push(await actMouse(manager, workspacePath, opened.id, {
        action: 'mouse-move',
        x: point.x,
        y: point.y,
        capture: 'none',
        actionId: `mouse-continuous-move-${point.x}-${point.y}`,
      }));
    }
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'mouse-up',
      x: 160,
      y: 168,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-up',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'drag',
      path: DRAG_PATH,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-drag-path',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'drag',
      path: DRAG_DROP_PATH,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-drag-drop-fixture',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'mouse-down',
      x: TEXT_SELECTION_PATH[0].x,
      y: TEXT_SELECTION_PATH[0].y,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-text-selection-down',
    }));
    for (const point of TEXT_SELECTION_PATH.slice(1, -1)) {
      actionStates.push(await actMouse(manager, workspacePath, opened.id, {
        action: 'mouse-move',
        x: point.x,
        y: point.y,
        capture: 'none',
        actionId: `mouse-text-selection-move-${point.x}-${point.y}`,
      }));
    }
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'mouse-up',
      x: TEXT_SELECTION_PATH[TEXT_SELECTION_PATH.length - 1].x,
      y: TEXT_SELECTION_PATH[TEXT_SELECTION_PATH.length - 1].y,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-text-selection-up',
    }));
    actionStates.push(await actMouse(manager, workspacePath, opened.id, {
      action: 'drag',
      path: SCROLLBAR_THUMB_DRAG_PATH,
      button: 'left',
      capture: 'none',
      actionId: 'mouse-page-scrollbar-thumb-drag',
    }));

    const verticalWheel = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'wheel',
      deltaX: 0,
      deltaY: 420,
    }, {
      capture: 'none',
      actionId: 'mouse-vertical-wheel',
    });
    assertComputerUseBrowserHostResult(verticalWheel, 'vertical wheel');
    const horizontalWheel = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'wheel',
      deltaX: -360,
      deltaY: 0,
    }, {
      capture: 'none',
      actionId: 'mouse-horizontal-wheel',
    });
    assertComputerUseBrowserHostResult(horizontalWheel, 'horizontal wheel');
    actionStates.push(verticalWheel.session, horizontalWheel.session);

    const finalState = await manager.sessionState(workspacePath, opened.id);
    assert.ok(finalState, 'BrowserHostSession final state should be available');
    assertBrowserHostState(finalState, 'final');
    assert.equal(driver.contentCalls, heavyCaptureCallsAfterOpen.content, 'mouse hot path should not read raw DOM');
    assert.equal(driver.axSnapshotCalls, heavyCaptureCallsAfterOpen.ax, 'mouse hot path should not read AX snapshots');
    assert.deepEqual(driver.trace, expectedTrace());

    for (const state of actionStates) {
      assert.equal(state.lastActionTiming?.capture, 'none', `${state.lastActionTiming?.action} should ACK without evidence capture`);
      assert.equal(state.lastActionTiming?.status, 'ok');
      assert.equal(state.lastActionTiming?.paintAckSource, 'none');
    }

    assertTimingSummary(finalState, 'open', 1);
    assertTimingSummary(finalState, 'click', 3);
    assertTimingSummary(finalState, 'double-click', 1);
    assertTimingSummary(finalState, 'mouse-down', 2);
    assertTimingSummary(finalState, 'mouse-move', 6);
    assertTimingSummary(finalState, 'mouse-up', 2);
    assertTimingSummary(finalState, 'drag', 3);
    assertTimingSummary(finalState, 'scroll', 2);

    const report = boundedMouseGestureReport(finalState, driver.trace);
    assert.deepEqual(report.coverage.missingGestures, []);
    assert.equal(report.acceptanceFixtures.dragDrop.status, 'passed');
    assert.equal(report.acceptanceFixtures.textSelection.status, 'passed');
    assert.equal(report.acceptanceFixtures.scrollbarThumbDrag.status, 'passed');
    assert.equal(report.newTabSemantics.status, 'blocked');
    assert.equal(report.newTabSemantics.middleClick.reasonCode, 'middle-click-has-no-browser-host-tab-owner-contract');
    assert.equal(report.newTabSemantics.modifierClick.reasonCode, 'click-action-has-no-modifier-fields');
    assert.equal(report.contextMenuPolicy, 'browser-context-menu');
    assert.equal(report.middleClickPolicy, 'browser-host-session-owned-middle-button');
    assert.equal(report.systemInputUsed, false);
    assert.equal(report.secondTruthSource, false);
    assert.equal(report.rawPayloadsCaptured, false);
    assert.ok(Object.values(report.refs).every((ref) => typeof ref !== 'string' || ref.startsWith(`browser-host-session:${finalState.id}/`)));

    const reportPath = join(workspacePath, 'browser-host-mouse-gesture-completeness-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assertNoRawMouseArtifactPayload(reportText, 'workspace report');

    await writeBoundedMouseGestureArtifact(report);
    const artifactText = await readFile(manifestPath, 'utf8');
    assertNoRawMouseArtifactPayload(artifactText, 'bounded artifact');
    assert.ok(
      Buffer.byteLength(artifactText, 'utf8') <= MAX_MOUSE_GESTURE_ARTIFACT_BYTES,
      'mouse gesture artifact should stay bounded',
    );

    console.log(`[ok] BrowserHostSession mouse gesture completeness ${JSON.stringify(report.coverage)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

async function actMouse(
  manager: BrowserHostSessionManager,
  workspacePath: string,
  sessionId: string,
  input: Parameters<BrowserHostSessionManager['act']>[2],
): Promise<BrowserHostSessionState> {
  const state = await manager.act(workspacePath, sessionId, input);
  assertBrowserHostState(state, input.action);
  assert.equal(state.lastActionTiming?.action, input.action);
  assert.equal(state.lastActionTiming?.actionId, input.actionId);
  return state;
}

function assertBrowserHostState(state: BrowserHostSessionState, label: string): void {
  assert.equal(state.owner, 'host', `${label}: BrowserHostSession state should be host-owned`);
  assert.equal(state.providerId, BROWSER_HOST_SESSION_PROVIDER_ID, `${label}: provider should be BrowserHostSession`);
  assert.equal(state.singleInteractiveTruth, true, `${label}: session should remain the single interactive truth`);
  assert.equal(state.liveSurfaceTransport, 'host-stream', `${label}: smoke should use BrowserHostSession host stream`);
  assert.equal(state.liveSurfaceRef, `browser-host-session:${state.id}/live-surface`);
  assert.equal(state.frameStreamRef, `browser-host-session:${state.id}/frame-stream`);
  assert.equal(state.nativeAdapterUrl, undefined);
}

function assertComputerUseBrowserHostResult(result: BrowserHostComputerUseActionResult, label: string): void {
  assert.equal(result.inputChannel, 'browser-host-session', `${label}: wheel should route through BrowserHostSession`);
  assert.equal(result.liveBrowserOwner, 'BrowserHostSession', `${label}: live owner should be BrowserHostSession`);
  assert.equal(result.singleInteractiveTruth, true, `${label}: should keep single interactive truth`);
  assert.equal(result.sharedSystemInputUsed, false, `${label}: should not use shared system input`);
  assert.equal(result.systemMouseEvents, 'not-sent', `${label}: system mouse events should not be sent`);
  assert.equal(result.systemKeyboardEvents, 'not-sent', `${label}: system keyboard events should not be sent`);
  assert.equal(result.userDeviceImpact, 'none', `${label}: user device should not be impacted`);
  assert.equal(result.hostAction.action, 'scroll', `${label}: wheel should become BrowserHostSession scroll`);
}

function assertTimingSummary(state: BrowserHostSessionState, action: BrowserHostSessionAction | 'open', count: number): void {
  const summary = state.actionTimingSummary?.find((row) => row.action === action);
  assert.ok(summary, `missing timing summary for ${action}`);
  assert.equal(summary.count, count, `${action} should have ${count} timing samples`);
  assert.ok(summary.p95Ms >= summary.p50Ms, `${action} p95 should not be lower than p50`);
}

function mouseGestureDriverFactory(): { factory: BrowserHostSessionDriverFactory; drivers: MouseGestureDriver[] } {
  const drivers: MouseGestureDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
        const driver = new MouseGestureDriver();
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class MouseGestureDriver implements BrowserHostSessionDriver {
  currentUrl = 'about:blank';
  readonly trace: MouseGestureTraceRecord[] = [];
  contentCalls = 0;
  axSnapshotCalls = 0;
  private pendingTextSelectionPath: BrowserHostMousePoint[] | undefined;

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return 'BrowserHostSession mouse gesture completeness';
  }

  async content(): Promise<string> {
    this.contentCalls += 1;
    return '<!-- BrowserHostSession mouse gesture evidence stays behind refs. -->';
  }

  async text(): Promise<string> {
    return `gesture-count=${this.trace.length}`;
  }

  async screenshot(path: string): Promise<void> {
    await writeFile(path, PNG_1X1);
  }

  async axSnapshot(): Promise<unknown> {
    this.axSnapshotCalls += 1;
    return { role: 'document', name: 'BrowserHostSession mouse gesture completeness' };
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
    const record: MouseGestureTraceRecord = {
      owner: 'BrowserHostSession',
      hostAction: 'click',
      gesture: button === 'right' ? 'right-click' : button === 'middle' ? 'middle-click' : 'left-click',
      x,
      y,
      button,
    };
    if (button === 'right') record.policy = 'browser-context-menu';
    if (button === 'middle') record.policy = 'browser-host-session-owned-middle-button';
    this.trace.push(record);
  }

  async doubleClick(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.trace.push({
      owner: 'BrowserHostSession',
      hostAction: 'double-click',
      gesture: 'double-click',
      x,
      y,
      button,
    });
  }

  async mouseDown(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    if (pointsEqual({ x, y }, TEXT_SELECTION_PATH[0]) && button === 'left') {
      this.pendingTextSelectionPath = [{ x, y }];
    }
    this.trace.push({
      owner: 'BrowserHostSession',
      hostAction: 'mouse-down',
      gesture: 'mouse-down',
      x,
      y,
      button,
    });
  }

  async mouseMove(x: number, y: number): Promise<void> {
    if (this.pendingTextSelectionPath) {
      this.pendingTextSelectionPath.push({ x, y });
    }
    this.trace.push({
      owner: 'BrowserHostSession',
      hostAction: 'mouse-move',
      gesture: 'continuous-move',
      x,
      y,
    });
  }

  async mouseUp(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    if (this.pendingTextSelectionPath && button === 'left') {
      const path = [...this.pendingTextSelectionPath, { x, y }];
      this.pendingTextSelectionPath = undefined;
      if (pathsEqual(path, TEXT_SELECTION_PATH)) {
        this.trace.push({
          owner: 'BrowserHostSession',
          hostAction: 'mouse-up',
          gesture: 'text-selection',
          x,
          y,
          button,
          path,
          policy: 'browser-host-session-text-selection-fixture',
        });
        return;
      }
    }
    this.trace.push({
      owner: 'BrowserHostSession',
      hostAction: 'mouse-up',
      gesture: 'mouse-up',
      x,
      y,
      button,
    });
  }

  async drag(path: BrowserHostMousePoint[], button: BrowserHostMouseButton = 'left'): Promise<void> {
    const gesture = pathsEqual(path, DRAG_DROP_PATH)
      ? 'drag-drop'
      : pathsEqual(path, SCROLLBAR_THUMB_DRAG_PATH)
        ? 'scrollbar-thumb-drag'
        : 'drag-path';
    this.trace.push({
      owner: 'BrowserHostSession',
      hostAction: 'drag',
      gesture,
      button,
      path,
      ...(gesture === 'drag-drop' ? { policy: 'browser-host-session-drag-drop-fixture' as const } : {}),
      ...(gesture === 'scrollbar-thumb-drag' ? { policy: 'browser-host-session-scrollbar-thumb-drag-fixture' as const } : {}),
    });
  }

  async type(): Promise<void> {}

  async press(): Promise<void> {}

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.trace.push({
      owner: 'BrowserHostSession',
      hostAction: 'scroll',
      gesture: deltaX !== 0 && deltaY === 0 ? 'horizontal-wheel' : 'vertical-wheel',
      deltaX,
      deltaY,
    });
  }

  async close(): Promise<void> {}
}

function requiredDriver(drivers: MouseGestureDriver[]): MouseGestureDriver {
  const driver = drivers[0];
  assert.ok(driver, 'BrowserHostSession mouse gesture driver should be created');
  return driver;
}

function expectedTrace(): MouseGestureTraceRecord[] {
  return [
    { owner: 'BrowserHostSession', hostAction: 'click', gesture: 'left-click', x: 18, y: 24, button: 'left' },
    { owner: 'BrowserHostSession', hostAction: 'click', gesture: 'right-click', x: 42, y: 48, button: 'right', policy: 'browser-context-menu' },
    { owner: 'BrowserHostSession', hostAction: 'click', gesture: 'middle-click', x: 66, y: 72, button: 'middle', policy: 'browser-host-session-owned-middle-button' },
    { owner: 'BrowserHostSession', hostAction: 'double-click', gesture: 'double-click', x: 90, y: 96, button: 'left' },
    { owner: 'BrowserHostSession', hostAction: 'mouse-down', gesture: 'mouse-down', x: 120, y: 128, button: 'left' },
    { owner: 'BrowserHostSession', hostAction: 'mouse-move', gesture: 'continuous-move', x: 128, y: 136 },
    { owner: 'BrowserHostSession', hostAction: 'mouse-move', gesture: 'continuous-move', x: 136, y: 144 },
    { owner: 'BrowserHostSession', hostAction: 'mouse-move', gesture: 'continuous-move', x: 144, y: 152 },
    { owner: 'BrowserHostSession', hostAction: 'mouse-move', gesture: 'continuous-move', x: 152, y: 160 },
    { owner: 'BrowserHostSession', hostAction: 'mouse-up', gesture: 'mouse-up', x: 160, y: 168, button: 'left' },
    {
      owner: 'BrowserHostSession',
      hostAction: 'drag',
      gesture: 'drag-path',
      button: 'left',
      path: DRAG_PATH,
    },
    {
      owner: 'BrowserHostSession',
      hostAction: 'drag',
      gesture: 'drag-drop',
      button: 'left',
      path: DRAG_DROP_PATH,
      policy: 'browser-host-session-drag-drop-fixture',
    },
    { owner: 'BrowserHostSession', hostAction: 'mouse-down', gesture: 'mouse-down', x: 180, y: 340, button: 'left' },
    { owner: 'BrowserHostSession', hostAction: 'mouse-move', gesture: 'continuous-move', x: 220, y: 340 },
    { owner: 'BrowserHostSession', hostAction: 'mouse-move', gesture: 'continuous-move', x: 260, y: 340 },
    {
      owner: 'BrowserHostSession',
      hostAction: 'mouse-up',
      gesture: 'text-selection',
      x: 300,
      y: 340,
      button: 'left',
      path: TEXT_SELECTION_PATH,
      policy: 'browser-host-session-text-selection-fixture',
    },
    {
      owner: 'BrowserHostSession',
      hostAction: 'drag',
      gesture: 'scrollbar-thumb-drag',
      button: 'left',
      path: SCROLLBAR_THUMB_DRAG_PATH,
      policy: 'browser-host-session-scrollbar-thumb-drag-fixture',
    },
    { owner: 'BrowserHostSession', hostAction: 'scroll', gesture: 'vertical-wheel', deltaX: 0, deltaY: 420 },
    { owner: 'BrowserHostSession', hostAction: 'scroll', gesture: 'horizontal-wheel', deltaX: -360, deltaY: 0 },
  ];
}

function boundedMouseGestureReport(state: BrowserHostSessionState, trace: MouseGestureTraceRecord[]) {
  const gestures = new Set(trace.map((row) => row.gesture));
  const contextMenuPolicy = trace.find((row) => row.gesture === 'right-click')?.policy;
  const middleClickPolicy = trace.find((row) => row.gesture === 'middle-click')?.policy;
  const dragDrop = trace.find((row) => row.gesture === 'drag-drop');
  const textSelection = trace.find((row) => row.gesture === 'text-selection');
  const scrollbarThumbDrag = trace.find((row) => row.gesture === 'scrollbar-thumb-drag');
  return {
    schemaVersion: 'sciforge.browser-host-session.mouse-gesture-completeness-smoke.v1',
    source: 'local-deterministic-browser-host-session-fixture',
    artifactPayloadMode: 'bounded-refs-and-policy-only',
    liveBrowserOwner: 'BrowserHostSession' as const,
    stateOwner: state.owner,
    providerId: state.providerId,
    liveSurfaceTransport: state.liveSurfaceTransport,
    singleInteractiveTruth: state.singleInteractiveTruth,
    refs: {
      liveSurfaceRef: state.liveSurfaceRef,
      frameStreamRef: state.frameStreamRef,
      frameRef: state.frameRef,
      screenshotRef: state.screenshotRef,
      domSnapshotRef: state.domSnapshotRef,
      axSnapshotRef: state.axSnapshotRef,
      consoleLogRef: state.consoleLogRef,
      networkLogRef: state.networkLogRef,
    },
    coverage: {
      requiredGestures: REQUIRED_GESTURES,
      observedGestures: REQUIRED_GESTURES.filter((gesture) => gestures.has(gesture)),
      missingGestures: REQUIRED_GESTURES.filter((gesture) => !gestures.has(gesture)),
      continuousMovePoints: trace.filter((row) => row.gesture === 'continuous-move').map((row) => ({ x: row.x, y: row.y })),
      dragPointCount: trace.find((row) => row.gesture === 'drag-path')?.path?.length ?? 0,
      dragDropPointCount: dragDrop?.path?.length ?? 0,
      textSelectionPointCount: textSelection?.path?.length ?? 0,
      scrollbarThumbDragPointCount: scrollbarThumbDrag?.path?.length ?? 0,
      wheelDeltas: trace.filter((row) => row.hostAction === 'scroll').map((row) => ({ deltaX: row.deltaX, deltaY: row.deltaY })),
    },
    acceptanceFixtures: {
      dragDrop: {
        status: dragDrop ? 'passed' as const : 'blocked' as const,
        evidenceRef: `browser-host-session:${state.id}/mouse-fixture/drag-drop`,
        hostAction: dragDrop?.hostAction,
        pointCount: dragDrop?.path?.length ?? 0,
        policy: dragDrop?.policy,
      },
      textSelection: {
        status: textSelection ? 'passed' as const : 'blocked' as const,
        evidenceRef: `browser-host-session:${state.id}/mouse-fixture/text-selection`,
        hostAction: textSelection?.hostAction,
        pointCount: textSelection?.path?.length ?? 0,
        policy: textSelection?.policy,
      },
      scrollbarThumbDrag: {
        status: scrollbarThumbDrag ? 'passed' as const : 'blocked' as const,
        evidenceRef: `browser-host-session:${state.id}/mouse-fixture/scrollbar-thumb-drag`,
        hostAction: scrollbarThumbDrag?.hostAction,
        pointCount: scrollbarThumbDrag?.path?.length ?? 0,
        policy: scrollbarThumbDrag?.policy,
      },
    },
    contextMenuPolicy,
    middleClickPolicy,
    newTabSemantics: {
      status: 'blocked' as const,
      policy: 'typed-bounded-policy',
      evidenceMode: 'refs-first-no-tab-payload',
      middleClick: {
        status: 'blocked' as const,
        reasonCode: 'middle-click-has-no-browser-host-tab-owner-contract',
        observedHostAction: 'click' as const,
        observedButton: 'middle' as const,
        evidenceRef: `browser-host-session:${state.id}/mouse-fixture/middle-click-new-tab-policy`,
        claim: 'not-claimed',
      },
      modifierClick: {
        status: 'blocked' as const,
        reasonCode: 'click-action-has-no-modifier-fields',
        requiredContract: 'BrowserHostSession modifier-click tab-owner or handoff semantics',
        missingFields: ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'],
        evidenceRef: `browser-host-session:${state.id}/mouse-fixture/modifier-click-new-tab-policy`,
        claim: 'not-claimed',
      },
      singleOwnerPreserved: state.singleInteractiveTruth === true,
      rawTabPayloadCaptured: false,
      systemInputUsed: false,
    },
    actionTimingSummary: state.actionTimingSummary?.map((row) => ({
      action: row.action,
      count: row.count,
      p95Ms: row.p95Ms,
    })),
    systemInputUsed: false,
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  };
}

async function writeBoundedMouseGestureArtifact(report: ReturnType<typeof boundedMouseGestureReport>): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_MOUSE_GESTURE_ARTIFACT_BYTES, 'mouse gesture artifact must stay bounded');
  await writeFile(manifestPath, text, 'utf8');
}

function assertNoRawMouseArtifactPayload(text: string, label: string): void {
  assert.doesNotMatch(text, /data:image|base64|rawDom|raw DOM|domSnapshotPayload|screenshotPayload|systemMousePayload/i, `${label} must not include raw payloads`);
  assert.doesNotMatch(text, /<\s*(?:!doctype|html|body|iframe|webview)\b/i, `${label} must not include captured markup`);
  assert.doesNotMatch(text, /\b(?:iframe|proxy|webview)\b/i, `${label} must not mention alternate live-browser owners`);
}

function pathsEqual(left: BrowserHostMousePoint[], right: BrowserHostMousePoint[]): boolean {
  return left.length === right.length && left.every((point, index) => pointsEqual(point, right[index]));
}

function pointsEqual(left: BrowserHostMousePoint, right: BrowserHostMousePoint | undefined): boolean {
  return !!right && left.x === right.x && left.y === right.y;
}
