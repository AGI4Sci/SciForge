import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BrowserHostSessionManager,
  type BrowserHostSessionDriver,
  type BrowserHostSessionDriverFactory,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';
import { renderBrowserWorkbench } from '../../packages/presentation/components/browser-workbench/render.js';

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

test('Browser cursor and caret parity is host-owned, bounded, and does not create a second surface', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-cursor-caret-'));
  const { factory, drivers } = cursorParityDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/cursor-caret',
      sessionId: 'cursor-caret-parity',
    });
    const pointer = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: 12,
      y: 12,
      actionId: 'cursor-pointer',
    });
    const text = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: 24,
      y: 24,
      actionId: 'cursor-text',
    });
    const fallback = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: 36,
      y: 36,
      actionId: 'cursor-default',
    });
    const rightPaneLeave = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: -1,
      y: -1,
      actionId: 'cursor-right-pane-leave',
    });
    const rightPaneReenter = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: 12,
      y: 12,
      actionId: 'cursor-right-pane-reenter',
    });
    const windowBlur = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: -1,
      y: -1,
      actionId: 'cursor-window-blur',
    });
    const windowRestore = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: 24,
      y: 24,
      actionId: 'cursor-window-restore',
    });

    const driver = drivers[0];
    assert.ok(driver);
    assert.deepEqual(driver.cursorActions, ['12,12', '24,24', '36,36', '-1,-1', '12,12', '-1,-1', '24,24']);
    assert.equal(pointer.cursor, 'pointer');
    assert.equal(text.cursor, 'text');
    assert.equal(fallback.cursor, 'default');
    assert.equal(rightPaneLeave.cursor, 'default');
    assert.equal(rightPaneReenter.cursor, 'pointer');
    assert.equal(windowBlur.cursor, 'default');
    assert.equal(windowRestore.cursor, 'text');
    assert.equal(pointer.lastActionTiming?.capture, 'none');
    assert.equal(text.lastActionTiming?.capture, 'none');
    assert.equal(fallback.lastActionTiming?.capture, 'none');
    assert.equal(fallback.lastActionTiming?.paintAckSource, 'none');
    assert.equal(rightPaneLeave.lastActionTiming?.capture, 'none');
    assert.equal(rightPaneReenter.lastActionTiming?.capture, 'none');
    assert.equal(windowBlur.lastActionTiming?.capture, 'none');
    assert.equal(windowRestore.lastActionTiming?.capture, 'none');
    assertSingleHostOwner([
      pointer,
      text,
      fallback,
      rightPaneLeave,
      rightPaneReenter,
      windowBlur,
      windowRestore,
    ]);

    const hostStreamHtml = renderBrowserHost(pointer, {
      frameUrl: 'blob:http://127.0.0.1/cursor-caret-frame',
      frameTransport: 'websocket-binary',
    });
    assert.match(hostStreamHtml, /data-browser-object-type="host-browser"/);
    assert.match(hostStreamHtml, /style="cursor:pointer"/);
    assert.match(hostStreamHtml, /browser-workbench-host-keyboard-input/);
    assert.match(hostStreamHtml, /data-browser-host-keyboard-input="true"/);
    assert.match(hostStreamHtml, /data-browser-host-keyboard-path="hidden-input"/);
    assert.match(hostStreamHtml, /data-browser-host-keyboard-restore="session-storage"/);
    assert.doesNotMatch(hostStreamHtml, /<iframe|<webview|\/api\/sciforge\/browser\/proxy|system-browser-window|data:image|base64/i);

    const textCursorHtml = renderBrowserHost(text, {
      frameRenderer: 'canvas-binary',
      frameTransport: 'websocket-binary',
    });
    assert.match(textCursorHtml, /<canvas\b/);
    assert.match(textCursorHtml, /style="cursor:text"/);
    assert.match(textCursorHtml, /data-browser-frame-renderer="canvas-binary"/);
    assert.doesNotMatch(textCursorHtml, /<img\b|<iframe|<webview|data:image|base64/i);

    const leaveHtml = renderBrowserHost(rightPaneLeave, {
      frameUrl: 'blob:http://127.0.0.1/cursor-caret-frame',
      frameTransport: 'websocket-binary',
    });
    assert.match(leaveHtml, /style="cursor:default"/);
    assert.equal(extractAttribute(hostStreamHtml, 'data-browser-host-keyboard-focus-key'), extractAttribute(leaveHtml, 'data-browser-host-keyboard-focus-key'));

    const restoredHtml = renderBrowserHost(windowRestore, {
      frameUrl: 'blob:http://127.0.0.1/cursor-caret-frame',
      frameTransport: 'websocket-binary',
    });
    assert.match(restoredHtml, /style="cursor:text"/);
    assert.equal(extractAttribute(hostStreamHtml, 'data-browser-host-keyboard-focus-key'), extractAttribute(restoredHtml, 'data-browser-host-keyboard-focus-key'));
    assert.match(restoredHtml, /data-browser-host-keyboard-restore="session-storage"/);

    const nativeHtml = renderBrowserHost({
      ...text,
      liveSurfaceTransport: 'native-embedded',
      frameStreamRef: undefined,
      frameRef: undefined,
      frameUrl: undefined,
    }, {
      frameTransport: 'native-embedded',
    });
    assert.match(nativeHtml, /data-browser-native-surface="true"/);
    assert.match(nativeHtml, /data-browser-live-surface-transport="native-embedded"/);
    assert.doesNotMatch(nativeHtml, /style="cursor:text"|style="cursor:pointer"|<img\b|<canvas\b|<iframe|<webview|data:image|base64/i);

    const report = {
      schemaVersion: 'sciforge.browser.cursor-caret-parity-smoke.v1',
      owner: fallback.owner,
      liveSurfaceTransport: fallback.liveSurfaceTransport,
      singleInteractiveTruth: fallback.singleInteractiveTruth,
      cursorSequence: [pointer.cursor, text.cursor, fallback.cursor],
      captureModes: [
        pointer.lastActionTiming?.capture,
        text.lastActionTiming?.capture,
        fallback.lastActionTiming?.capture,
      ],
      edgeTransitions: [
        boundedCursorTransition('right-pane-mouseleave', rightPaneLeave),
        boundedCursorTransition('right-pane-mouseenter', rightPaneReenter),
        boundedCursorTransition('window-blur', windowBlur),
        boundedCursorTransition('window-focus-restore', windowRestore),
      ],
      focusLifecyclePolicy: {
        status: 'bounded-policy',
        realWindowManagerSignal: 'blocked',
        blockedReasonCode: 'node-smoke-no-real-window-focus-signal',
        caretOwner: 'browser-workbench-host-keyboard-input',
        restoreMechanism: 'session-storage-focus-key',
        selectionPayloadPolicy: 'not-recorded',
        expectedRecovery: [
          'cursor-reset-on-leave-or-blur',
          'cursor-refresh-on-reenter-or-restore',
          'hidden-input-focus-key-remains-session-scoped',
        ],
      },
      refs: {
        liveSurfaceRef: fallback.liveSurfaceRef,
        frameStreamRef: fallback.frameStreamRef,
      },
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    assertBoundedCursorCaretReport(report);
    console.log(`[ok] Browser cursor/caret parity ${JSON.stringify(report)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function cursorParityDriverFactory(): { factory: BrowserHostSessionDriverFactory; drivers: CursorParityDriver[] } {
  const drivers: CursorParityDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
        const driver = new CursorParityDriver();
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class CursorParityDriver implements BrowserHostSessionDriver {
  currentUrl = 'about:blank';
  cursorActions: string[] = [];

  readonly liveSurfaceTransport = 'host-stream' as const;

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

  async title(): Promise<string> {
    return 'Browser cursor caret parity';
  }

  async content(): Promise<string> {
    return '<!-- cursor caret fixture: bounded, no page payload in report -->';
  }

  async text(): Promise<string> {
    return 'cursor caret fixture';
  }

  async screenshot(path: string): Promise<void> {
    await writeFile(path, PNG_1X1);
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
  async click(): Promise<void> {}
  async type(): Promise<void> {}
  async press(): Promise<void> {}
  async scroll(): Promise<void> {}
  async close(): Promise<void> {}

  async cursor(x: number, y: number): Promise<string> {
    this.cursorActions.push(`${x},${y}`);
    if (x === -1 && y === -1) return 'default';
    if (x === 12 && y === 12) return 'pointer';
    if (x === 24 && y === 24) return 'text';
    return 'not-a-real-css-cursor';
  }
}

function assertSingleHostOwner(states: BrowserHostSessionState[]) {
  const sessionIds = new Set(states.map((state) => state.id));
  const liveSurfaceRefs = new Set(states.map((state) => state.liveSurfaceRef));
  assert.deepEqual([...sessionIds], ['cursor-caret-parity']);
  assert.equal(liveSurfaceRefs.size, 1);
  for (const state of states) {
    assert.equal(state.owner, 'host');
    assert.equal(state.singleInteractiveTruth, true);
    assert.equal(state.liveSurfaceTransport, 'host-stream');
    assert.doesNotMatch(state.liveSurfaceRef ?? '', /iframe|webview|proxy|system-window/i);
  }
}

function boundedCursorTransition(event: string, state: BrowserHostSessionState) {
  return {
    event,
    owner: state.owner,
    sessionRef: `browser-host-session:${state.id}`,
    liveSurfaceRef: state.liveSurfaceRef,
    cursor: state.cursor,
    capture: state.lastActionTiming?.capture,
    actionId: state.lastActionTiming?.actionId,
    evidence: 'bounded-action-state',
    secondTruthSource: false,
  };
}

function extractAttribute(html: string, name: string) {
  const match = html.match(new RegExp(`${name}="([^"]+)"`));
  assert.ok(match, `Expected ${name} in rendered browser host HTML`);
  return match[1];
}

function assertBoundedCursorCaretReport(report: unknown) {
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
  assert.doesNotMatch(serialized, /screenshot|rawDom|rawHtml|clipboardPayload|selectionText/i);
}

function renderBrowserHost(
  state: BrowserHostSessionState,
  input: {
    frameUrl?: string;
    frameTransport?: string;
    frameRenderer?: 'canvas-binary';
  },
) {
  return renderToStaticMarkup(renderBrowserWorkbench({
    slot: {
      componentId: 'browser-workbench',
      title: 'Browser',
      props: {
        title: 'Browser',
        status: state.status,
        state: {
          status: state.status,
          url: state.url,
          canRenderFrame: false,
          hostSurface: 'browser-host-session',
        },
        externalUrl: state.url,
        addressValue: state.url,
        frameUrl: input.frameUrl,
        frameTransport: input.frameTransport,
        frameRenderer: input.frameRenderer,
        hostSession: state,
      },
    },
    artifact: {
      id: 'browser-cursor-caret-parity',
      type: 'browser-runtime-projection',
      producerScenario: 'browser-runtime',
      schemaVersion: 'sciforge.browser-runtime.projection.v1',
      data: {},
    },
  }));
}
