import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

const artifactPath = resolve(process.cwd(), 'docs/test-artifacts/browser-cursor-caret-parity/manifest.json');
const MAX_CURSOR_CARET_ARTIFACT_BYTES = 32 * 1024;

test('Browser cursor and caret parity is native-host-owned, bounded, and does not create a second surface', async () => {
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
    assert.equal(rightPaneLeave.lastActionTiming?.capture, 'none');
    assert.equal(rightPaneReenter.lastActionTiming?.capture, 'none');
    assert.equal(windowBlur.lastActionTiming?.capture, 'none');
    assert.equal(windowRestore.lastActionTiming?.capture, 'none');
    for (const state of [
      pointer,
      text,
      fallback,
      rightPaneLeave,
      rightPaneReenter,
      windowBlur,
      windowRestore,
    ]) {
      assert.equal(state.lastActionTiming?.liveSurfaceTransport, 'native-embedded');
      assert.equal(state.lastActionTiming?.paintAckSource, 'native-adapter-action-state');
    }
    assertSingleHostOwner([
      pointer,
      text,
      fallback,
      rightPaneLeave,
      rightPaneReenter,
      windowBlur,
      windowRestore,
    ]);

    const nativeHtml = renderBrowserHost(text, {
      frameTransport: 'native-embedded',
    });
    assert.match(nativeHtml, /data-browser-object-type="host-browser"/);
    assert.match(nativeHtml, /data-browser-native-surface="true"/);
    assert.match(nativeHtml, /data-browser-live-surface-transport="native-embedded"/);
    assert.match(nativeHtml, /data-browser-single-interactive-truth="true"/);
    assert.match(nativeHtml, /data-browser-frame-transport="native-embedded"/);
    assert.doesNotMatch(nativeHtml, /style="cursor:text"|style="cursor:pointer"|browser-workbench-host-keyboard-input|hidden-input|<img\b|<canvas\b|<iframe|<webview|data:image|base64/i);

    const legacyDiagnosticState: BrowserHostSessionState = {
      ...pointer,
      liveSurfaceTransport: undefined,
      frameStreamRef: 'browser-host-session:cursor-caret-parity/diagnostic-frame-stream',
      frameRef: 'browser-host-session:cursor-caret-parity/diagnostic-frame',
    };
    const legacyDiagnosticHtml = renderBrowserHost(legacyDiagnosticState, {
      frameUrl: 'blob:http://127.0.0.1/cursor-caret-frame',
      frameTransport: 'websocket-binary',
    });
    assert.match(legacyDiagnosticHtml, /data-browser-object-type="browser-state"/);
    assert.doesNotMatch(legacyDiagnosticHtml, /data-browser-object-type="host-browser"|data-browser-native-surface="true"|<canvas\b|<iframe|<webview|data:image|base64/i);

    const report = {
      schemaVersion: 'sciforge.browser.cursor-caret-parity-smoke.v1',
      status: 'blocked',
      source: 'deterministic-native-contract-no-real-os-ui-run',
      canClaimRealCursorCaretParityPass: false,
      liveBrowserOwner: 'BrowserHostSession',
      inputChannel: 'browser-host-session',
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
        caretOwner: 'BrowserHostSession-native-embedded-surface',
        restoreMechanism: 'native-surface-focus-restore-required',
        selectionPayloadPolicy: 'not-recorded',
        expectedRecovery: [
          'cursor-reset-on-leave-or-blur',
          'cursor-refresh-on-reenter-or-restore',
          'native-surface-focus-remains-session-scoped',
        ],
      },
      productAcceptance: {
        status: 'blocked',
        blocker: 'real-product-native-os-ui-run-not-executed',
        handoffRef: `browser-host-session:${fallback.id}/os-ui-handoff/cursor-caret`,
        requiredRealProofs: [
          'right-pane-native-surface-focus-blur-restore',
          'input-caret-visible',
          'contenteditable-caret-visible',
          'page-text-selection-caret-visible',
          'pointer-default-text-cursor-parity',
        ],
        requiredProofs: cursorCaretRequiredProofs(fallback),
      },
      realOsUiRunHandoff: cursorCaretOsUiHandoff(fallback),
      refs: {
        liveSurfaceRef: fallback.liveSurfaceRef,
        frameStreamRef: fallback.frameStreamRef,
      },
      refsFirst: true,
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    assertBoundedCursorCaretReport(report);
    assert.equal(report.status, 'blocked');
    assert.equal(report.source, 'deterministic-native-contract-no-real-os-ui-run');
    assert.equal(report.canClaimRealCursorCaretParityPass, false);
    assert.equal(report.liveBrowserOwner, 'BrowserHostSession');
    assert.equal(report.inputChannel, 'browser-host-session');
    assert.equal(report.liveSurfaceTransport, 'native-embedded');
    assert.equal(report.singleInteractiveTruth, true);
    assert.equal(report.secondTruthSource, false);
    assert.equal(report.productAcceptance.status, 'blocked');
    assert.equal(report.refsFirst, true);
    assert.equal(report.realOsUiRunHandoff.status, 'blocked');
    assert.equal(report.realOsUiRunHandoff.passClaim, false);
    assert.equal(report.realOsUiRunHandoff.requiredProofs.length, report.productAcceptance.requiredProofs.length);
    assert.ok(report.realOsUiRunHandoff.requiredProofs.every((proof) => proof.owner === 'BrowserHostSession'));
    assert.ok(report.realOsUiRunHandoff.requiredProofs.every((proof) => proof.liveSurfaceRef === fallback.liveSurfaceRef));
    assert.ok(report.productAcceptance.requiredProofs.every((proof) => proof.proofRef.startsWith(`browser-host-session:${fallback.id}/`)));
    await writeBoundedCursorCaretArtifact(report);
    const artifactText = await readFile(artifactPath, 'utf8');
    assertBoundedCursorCaretReport(artifactText);
    assert.ok(Buffer.byteLength(artifactText, 'utf8') <= MAX_CURSOR_CARET_ARTIFACT_BYTES);
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

  readonly liveSurfaceTransport = 'native-embedded' as const;
  readonly nativeAdapterUrl = 'http://127.0.0.1:39301';

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
    assert.equal(state.liveSurfaceTransport, 'native-embedded');
    assert.equal(state.nativeAdapterUrl, 'http://127.0.0.1:39301');
    assert.equal(state.frameStreamRef, undefined);
    assert.equal(state.frameRef, undefined);
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

function cursorCaretRequiredProofs(state: BrowserHostSessionState) {
  const sessionRef = `browser-host-session:${state.id}/session`;
  const liveSurfaceRef = state.liveSurfaceRef ?? `browser-host-session:${state.id}/live-surface`;
  return [
    cursorCaretRequiredProof('right-pane-native-surface-focus-blur-restore', state, sessionRef, liveSurfaceRef),
    cursorCaretRequiredProof('input-caret-visible', state, sessionRef, liveSurfaceRef),
    cursorCaretRequiredProof('contenteditable-caret-visible', state, sessionRef, liveSurfaceRef),
    cursorCaretRequiredProof('page-text-selection-caret-visible', state, sessionRef, liveSurfaceRef, {
      selectionPayloadPolicy: 'length-and-hash-only',
    }),
    cursorCaretRequiredProof('pointer-default-text-cursor-parity', state, sessionRef, liveSurfaceRef),
  ];
}

function cursorCaretRequiredProof(
  kind: string,
  state: BrowserHostSessionState,
  browserHostSessionRef: string,
  liveSurfaceRef: string,
  extra: Record<string, unknown> = {},
) {
  return {
    kind,
    status: 'blocked' as const,
    blocker: 'real-product-native-os-ui-run-not-executed' as const,
    owner: 'BrowserHostSession' as const,
    productSurface: 'right-pane-browser' as const,
    browserHostSessionRef,
    liveSurfaceRef,
    proofRef: `browser-host-session:${state.id}/required-proof/${kind}`,
    auditRef: `browser-host-session:${state.id}/audit/${kind}`,
    rawPayloadRecorded: false as const,
    shellComposerTarget: 'not-targeted' as const,
    secondTruthSource: false as const,
    ...extra,
  };
}

function cursorCaretOsUiHandoff(state: BrowserHostSessionState) {
  return {
    status: 'blocked' as const,
    passClaim: false,
    blocker: 'real-product-native-os-ui-run-not-executed' as const,
    requiredRunner: 'right-pane-native-os-ui-run' as const,
    productSurface: 'right-pane-browser' as const,
    owner: 'BrowserHostSession' as const,
    inputChannel: 'browser-host-session' as const,
    liveSurfaceTransport: 'native-embedded' as const,
    browserHostSessionRef: `browser-host-session:${state.id}/session`,
    liveSurfaceRef: state.liveSurfaceRef,
    handoffRef: `browser-host-session:${state.id}/os-ui-handoff/cursor-caret`,
    auditRefs: [
      `browser-host-session:${state.id}/audit/window-focus-owner`,
      `browser-host-session:${state.id}/audit/caret-owner`,
      `browser-host-session:${state.id}/audit/selection-range-owner`,
    ],
    requiredProofs: cursorCaretRequiredProofs(state),
    rawPayloadsCaptured: false,
    refsFirst: true,
  };
}

async function writeBoundedCursorCaretArtifact(report: unknown): Promise<void> {
  await mkdir(dirname(artifactPath), { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_CURSOR_CARET_ARTIFACT_BYTES);
  await writeFile(artifactPath, text, 'utf8');
}

function assertBoundedCursorCaretReport(report: unknown) {
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
  assert.doesNotMatch(serialized, /screenshot|rawDom|rawHtml|clipboardPayload|selectionText|rawSelection|rawClipboard/i);
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
