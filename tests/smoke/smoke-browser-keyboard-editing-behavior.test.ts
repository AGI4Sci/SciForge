import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderBrowserWorkbench } from '../../packages/presentation/components/browser-workbench/render.js';
import {
  BrowserHostSessionManager,
  type BrowserHostMouseButton,
  type BrowserHostSessionDriver,
  type BrowserHostSessionDriverFactory,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';
import {
  executeBrowserHostComputerUseAction,
  type BrowserHostComputerUseAction,
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

const REQUIRED_EDIT_KEYS = [
  'Backspace',
  'Delete',
  'Enter',
  'Tab',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
] as const;

const CMD_OR_CTRL_SHORTCUTS = [
  'Meta+A',
  'Meta+C',
  'Meta+V',
  'Meta+X',
  'Control+A',
  'Control+C',
  'Control+V',
  'Control+X',
] as const;

const ORDINARY_TEXT_INITIAL = 'alpha beta gamma';
const ORDINARY_TEXT_DELTA = ' +delta';
const COMPOSITION_POLICY_EVENTS = ['compositionstart', 'compositionupdate', 'compositionend'] as const;
const ADDRESS_BAR_FOCUS_TEXT = 'http://localhost/browser-keyboard-address-focus-contract';
const ADDRESS_BAR_SHORTCUT_KEYS = ['Meta+A', 'Control+A', 'Enter'] as const;
const artifactPath = resolve(process.cwd(), 'docs/test-artifacts/browser-keyboard-editing-behavior/manifest.json');
const MAX_KEYBOARD_ARTIFACT_BYTES = 56 * 1024;

type KeyboardFocusTarget = 'page' | 'editor' | 'address-bar' | 'shell-composer';

test('Browser pane keyboard editing actions stay on BrowserHostSession without composer or system keyboard capture', async () => {
  assertBrowserPaneKeyboardSourceGuards();

  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-keyboard-editing-'));
  const { factory, drivers } = keyboardEditingDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/browser-keyboard-editing',
      sessionId: 'keyboard-editing-contract',
      width: 960,
      height: 640,
    });
    assert.equal(opened.owner, 'host');
    assert.equal(opened.singleInteractiveTruth, true);
    assert.equal(opened.liveSurfaceTransport, 'native-embedded');
    assert.equal(opened.frameStreamRef, undefined);
    assert.equal(opened.frameRef, undefined);

    const driver = requiredDriver(drivers);
    driver.focusAddressBar('address-input-focus');
    driver.typeAddressBarText(ADDRESS_BAR_FOCUS_TEXT);
    for (const shortcut of ADDRESS_BAR_SHORTCUT_KEYS) {
      driver.pressAddressBarShortcut(shortcut);
    }
    assert.equal(driver.focusTarget, 'address-bar');
    assert.equal(driver.addressBarSubmissions.length, 1);
    assert.equal(driver.addressBarSubmissions[0]?.submittedUrlHash, sha256(ADDRESS_BAR_FOCUS_TEXT));
    assert.equal(driver.shellComposerDraft, '');
    assert.deepEqual(driver.shellComposerKeys, []);

    const focus = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'click',
      x: 48,
      y: 56,
    }, {
      capture: 'none',
      actionId: 'keyboard-editor-focus',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertBrowserHostOnly(focus, 'click');
    assert.equal(driver.focusTarget, 'editor');
    assert.ok(driver.focusTransitions.some((event) => event.from === 'address-bar' && event.to === 'editor'));

    const initialType = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'type_text',
      text: ORDINARY_TEXT_INITIAL,
    }, {
      capture: 'none',
      actionId: 'keyboard-type-initial-delta',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertBrowserHostOnly(initialType, 'type');
    assert.equal(initialType.hostAction.text, ORDINARY_TEXT_INITIAL);
    assert.equal(driver.editorValue, ORDINARY_TEXT_INITIAL);

    const nextType = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'type_text',
      text: ORDINARY_TEXT_DELTA,
    }, {
      capture: 'none',
      actionId: 'keyboard-type-second-delta',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertBrowserHostOnly(nextType, 'type');
    assert.equal(nextType.hostAction.text, ORDINARY_TEXT_DELTA);
    assert.deepEqual(driver.typeDeltas, [ORDINARY_TEXT_INITIAL, ORDINARY_TEXT_DELTA]);

    for (const key of REQUIRED_EDIT_KEYS) {
      const result = await executePress(manager, workspacePath, opened.id, key);
      assertBrowserHostOnly(result, 'press');
      assert.equal(result.hostAction.key, key);
    }

    for (const shortcut of CMD_OR_CTRL_SHORTCUTS) {
      const result = await executePress(manager, workspacePath, opened.id, shortcut);
      assertBrowserHostOnly(result, 'press');
      assert.equal(result.hostAction.key, shortcut);
    }

    assert.deepEqual(driver.pressKeys, [...REQUIRED_EDIT_KEYS, ...CMD_OR_CTRL_SHORTCUTS]);
    assert.equal(driver.shellComposerDraft, '');
    assert.deepEqual(driver.shellComposerKeys, []);
    assert.equal(driver.systemKeyboardEventsSent, false);
    assert.equal(driver.pageSubmitCount, 1, 'Enter should be delivered to the BrowserHostSession-backed page fixture');
    assert.equal(driver.escapeCount, 1, 'Escape should be delivered to the BrowserHostSession-backed page fixture');
    assert.equal(driver.pageNavigationKeys.join(','), 'ArrowLeft,ArrowRight,ArrowUp,ArrowDown,Home,End,PageUp,PageDown');
    assert.equal(driver.clipboardPolicyEvents.length, 6);
    assert.deepEqual(driver.clipboardPolicyEvents.map((event) => event.shortcut), ['copy', 'paste', 'cut', 'copy', 'paste', 'cut']);
    assert.ok(driver.clipboardPolicyEvents.every((event) => event.owner === 'BrowserHostSession'));
    assert.ok(driver.clipboardPolicyEvents.every((event) => event.systemClipboardReadWrite === 'not-performed'));
    assert.ok(driver.clipboardPolicyEvents.every((event) => event.typedPayloadPolicy === 'blocked'));
    assert.ok(driver.clipboardPolicyEvents.every((event) => event.confirmationPolicy === 'required-before-system-clipboard'));
    assert.ok(driver.clipboardPolicyEvents.every((event) => event.editorValueLengthBefore === event.editorValueLengthAfter));
    assert.ok(driver.clipboardPolicyEvents.every((event) => event.selectedLength === driver.editorValue.length));
    assert.ok(driver.clipboardPolicyEvents.every((event) => isSha256(event.selectedHashSha256)));
    assert.ok(driver.clipboardPolicyEvents.every((event) => event.selectedHashSha256 === sha256(driver.editorValue)));
    const pastePolicyEvents = driver.clipboardPolicyEvents.filter((event) => event.shortcut === 'paste');
    assert.equal(pastePolicyEvents.length, 2);
    assert.ok(pastePolicyEvents.every((event) => event.owner === 'BrowserHostSession' || event.typedPayloadPolicy === 'blocked' || event.typedPayloadPolicy === 'confirmation-needed'));

    const finalState = await manager.sessionState(workspacePath, opened.id);
    assert.ok(finalState, 'final BrowserHostSession state should be available');
    assertTimingSummary(finalState, 'click');
    assertTimingSummary(finalState, 'type');
    assertTimingSummary(finalState, 'press');

    const report = boundedKeyboardEditingReport(finalState, driver);
    const reportText = JSON.stringify(report);
    assert.equal(report.status, 'blocked');
    assert.equal(report.canClaimRealKeyboardImeClipboardSelectionPass, false);
    assert.equal(report.inputChannel, 'browser-host-session');
    assert.equal(report.liveBrowserOwner, 'BrowserHostSession');
    assert.equal(report.liveSurfaceTransport, 'native-embedded');
    assert.equal(report.singleInteractiveTruth, true);
    assert.equal(report.secondTruthSource, false);
    assert.equal(report.systemKeyboardEvents, 'not-sent');
    assert.equal(report.shellComposerCapturedCharacters, 0);
    assert.equal(report.shellComposerCapturedKeys, 0);
    assert.equal(report.focusContract.addressBar.owner, 'browser-address-bar');
    assert.equal(report.focusContract.addressBar.ordinaryTextOwner, 'browser-address-bar');
    assert.equal(report.focusContract.addressBar.inputEventCount, 1);
    assert.equal(report.focusContract.addressBar.shortcutIntents.length, ADDRESS_BAR_SHORTCUT_KEYS.length);
    assert.equal(report.focusContract.addressBar.submissions.length, 1);
    assert.equal(report.focusContract.addressBar.shortcutOwnersBrowserOwned, true);
    assert.equal(report.focusContract.addressBar.systemClipboardReadWrite, 'not-performed');
    assert.equal(report.focusContract.addressBar.typedPastePayloadPolicy, 'blocked-or-confirmation-needed');
    assert.equal(report.focusContract.addressBar.rawClipboardPayloadRecorded, false);
    assert.equal(report.focusContract.addressBar.rawCompositionPayloadRecorded, false);
    assert.equal(report.focusContract.addressBar.rawPayloadRecorded, false);
    assert.equal(report.focusContract.addressBar.shellComposerCapturedCharacters, 0);
    assert.equal(report.focusContract.addressBar.shellComposerCapturedKeys, 0);
    assert.equal(report.focusContract.pageFocus.owner, 'BrowserHostSession');
    assert.equal(report.focusContract.pageFocus.focusRestoredBy, 'native-embedded-surface-click');
    assert.equal(report.focusContract.pageFocus.ordinaryInputOwner, 'BrowserHostSession');
    assert.equal(report.focusContract.pageFocus.shortcutOwner, 'BrowserHostSession');
    assert.equal(report.focusContract.addressToPageSwitchCovered, true);
    assert.equal(report.focusContract.ordinaryInputAvoidsComposer, true);
    assert.equal(report.focusContract.shortcutsAvoidComposer, true);
    assert.equal(report.clipboardPolicy.realClipboardRoundTripVerified, false);
    assert.equal(report.clipboardPolicy.systemClipboardReadWrite, 'not-performed');
    assert.equal(report.clipboardPolicy.highRiskPathsOwnedOrBlocked, true);
    assert.equal(report.clipboardPolicy.typedPastePayloadPolicy, 'blocked-or-confirmation-needed');
    assert.equal(report.clipboardPolicy.rawClipboardPayloadRecorded, false);
    assert.ok(report.clipboardPolicy.confirmationAuditRefs.length >= 3);
    assert.ok(report.clipboardPolicy.shortcutIntentsObserved.every((event) => isSha256(event.selectedHashSha256)));
    assert.equal(report.imePolicy.realImeCandidateWindowVerified, false);
    assert.equal(report.imePolicy.syntheticCompositionPassClaimed, false);
    assert.equal(report.imePolicy.compositionEventsRoutedByNativeInput, true);
    assert.equal(report.imePolicy.shellComposerCompositionCapture, 'not-observed');
    assert.equal(report.imePolicy.rawCompositionPayloadRecorded, false);
    assert.deepEqual(report.imePolicy.compositionEvents.map((event) => event.event), [...COMPOSITION_POLICY_EVENTS]);
    assert.ok(report.imePolicy.compositionEvents.every((event) => event.shellComposerTarget === 'not-targeted'));
    assert.equal(report.selectionRangePolicy.refsFirst, true);
    assert.equal(report.selectionRangePolicy.rawSelectionTextRecorded, false);
    assert.equal(report.selectionRangePolicy.rawDomRecorded, false);
    assert.ok(report.selectionRangePolicy.evidenceRefs.length >= 1);
    assert.equal(report.selectionRangePolicy.selectedHashSha256, sha256(driver.editorValue.slice(driver.selectionStart, driver.selectionEnd)));
    assert.ok(report.selectionRangePolicy.requiredProofs.every((proof) => proof.rangeRef.startsWith(`browser-host-session:${finalState.id}/`)));
    assert.equal(report.selectionRangePolicy.editingKeysCovered, true);
    assert.equal(report.productAcceptance.status, 'blocked');
    assert.equal(report.productAcceptance.blocker, 'real-product-native-os-ui-run-not-executed');
    assert.equal(report.realOsUiRunHandoff.status, 'blocked');
    assert.equal(report.realOsUiRunHandoff.passClaim, false);
    assert.ok(report.productAcceptance.requiredProofs.every((proof) => proof.proofRef.startsWith(`browser-host-session:${finalState.id}/`)));
    assert.doesNotMatch(reportText, /data:image|base64|<\s*(?:!doctype|html|body|textarea|input|iframe|webview)\b/i);
    assert.doesNotMatch(reportText, new RegExp(escapeRegExp(ORDINARY_TEXT_INITIAL)));
    assert.doesNotMatch(reportText, new RegExp(escapeRegExp(ORDINARY_TEXT_DELTA)));
    assert.doesNotMatch(reportText, new RegExp(escapeRegExp(ADDRESS_BAR_FOCUS_TEXT)));

    await writeBoundedKeyboardArtifact(report);
    const artifactText = await readFile(artifactPath, 'utf8');
    assertNoRawKeyboardArtifactPayload(artifactText, 'bounded keyboard artifact');
    assert.ok(Buffer.byteLength(artifactText, 'utf8') <= MAX_KEYBOARD_ARTIFACT_BYTES);

    console.log(`[ok] Browser keyboard editing behavior ${JSON.stringify(report)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function assertBrowserPaneKeyboardSourceGuards(): void {
  const workbenchSource = readFileSync(new URL('../../packages/presentation/components/browser-workbench/render.tsx', import.meta.url), 'utf8');
  const adapterSource = readFileSync(new URL('../../src/ui/src/app/results/browserPaneHostAdapter.tsx', import.meta.url), 'utf8');
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    slot: {
      componentId: 'browser-workbench',
      title: 'Browser keyboard editing',
      props: {
        title: 'Browser keyboard editing',
        status: 'ready',
        state: {
          status: 'ready',
          url: 'https://external.example/editor',
          hostSurface: 'browser-host-session',
        },
        externalUrl: 'https://external.example/editor',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'keyboard-source-guard',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          workspacePath: '/tmp/sciforge',
          requestedUrl: 'https://external.example/editor',
          url: 'https://external.example/editor',
          startedAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:01.000Z',
          viewport: { width: 960, height: 640 },
          canGoBack: false,
          canGoForward: false,
          liveSurfaceRef: 'browser-host-session:keyboard-source-guard/live-surface',
          liveSurfaceTransport: 'native-embedded',
          nativeAdapterUrl: 'http://127.0.0.1:39303',
          singleInteractiveTruth: true,
          diagnostics: [],
        } satisfies BrowserHostSessionState,
      },
    },
    artifact: {
      id: 'browser-keyboard-editing-source-guard',
      type: 'browser-runtime-projection',
      producerScenario: 'browser-runtime',
      schemaVersion: 'sciforge.browser-runtime.projection.v1',
      data: {},
    },
  }));

  assert.match(html, /class="browser-workbench-viewer-address"/);
  assert.match(html, /aria-label="Browser URL"/);
  assert.match(html, /data-browser-object-type="host-browser"/);
  assert.match(html, /data-browser-native-surface="true"/);
  assert.match(html, /data-browser-live-surface-transport="native-embedded"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.match(html, /data-browser-frame-transport="native-embedded"/);
  assert.doesNotMatch(html, /browser-workbench-host-keyboard-input|hidden-input|<canvas\b|<iframe|<webview|system-browser-window|\/api\/sciforge\/browser\/proxy|data:image|base64/i);

  assert.match(workbenchSource, /function canRenderHostBrowser\([\s\S]*hostSession\?\.liveSurfaceTransport === 'native-embedded'[\s\S]*hostSession\.singleInteractiveTruth === true[\s\S]*Boolean\(hostSession\.liveSurfaceRef\);/);
  assert.match(workbenchSource, /const hostFrameTransport = renderHostBrowser \? 'native-embedded' : undefined;/);
  assert.match(workbenchSource, /data-browser-native-surface="true"/);
  assert.match(workbenchSource, /data-browser-live-surface-transport=\{hostSession\?\.liveSurfaceTransport\}/);
  assert.doesNotMatch(workbenchSource, /browser-workbench-host-keyboard-input|hidden-input|canvas-binary|websocket-binary|<iframe|<webview|navigator\.clipboard\.(?:readText|writeText)/);
  assert.match(workbenchSource, /className="browser-workbench-viewer-address"[\s\S]*event\.preventDefault\(\);[\s\S]*const value = normalizeBrowserWorkbenchUrl[\s\S]*payload\.onAddressSubmit\?\.\(value\);/);
  assert.match(workbenchSource, /aria-label="Browser URL"[\s\S]*onChange=\{\(event\) => payload\.onAddressChange\?\.\(event\.currentTarget\.value\)\}/);
  assert.doesNotMatch(workbenchSource, /document\.querySelector\(['"][^'"]*(?:chat|composer)|window\.dispatchEvent\([\s\S]*KeyboardEvent/);

  assert.match(adapterSource, /if \(timedAction\.action === 'type' && timedAction\.text\) \{[\s\S]*bufferedTextRef\.current \+= timedAction\.text;[\s\S]*scheduleBufferedHostActionFlush\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(adapterSource, /if \(timedAction\.action === 'press'\) \{[\s\S]*flushBufferedHostActions\(\);[\s\S]*dispatchHostAction\(timedAction, 'none'\);[\s\S]*return;[\s\S]*\}/);
  assert.match(adapterSource, /if \(action\.action === 'type'\) return \{ type: 'type_text', text: action\.text \?\? '' \};/);
  assert.match(adapterSource, /if \(action\.action === 'press'\) return browserHostComputerUseKeyAction\(action\.key\);/);
  assert.match(adapterSource, /return keys\.length > 1 \? \{ type: 'hotkey', keys \} : \{ type: 'press_key', key: normalized \};/);
  assert.match(adapterSource, /sendBrowserHostComputerUseAction\([\s\S]*action: computerUseAction,[\s\S]*capture,[\s\S]*actionId: action\.actionId,[\s\S]*uiEventReceivedAt: action\.uiEventReceivedAt,[\s\S]*adapterSentAt/);
  assert.doesNotMatch(adapterSource, /document\.querySelector\(['"][^'"]*(?:chat|composer)|\.focus\(\)[\s\S]*composer|window\.dispatchEvent\([\s\S]*KeyboardEvent/);
}

async function executePress(
  manager: BrowserHostSessionManager,
  workspacePath: string,
  sessionId: string,
  key: string,
): Promise<BrowserHostComputerUseActionResult> {
  const action: BrowserHostComputerUseAction = key.includes('+')
    ? { type: 'hotkey', keys: key.split('+') }
    : { type: 'press_key', key };
  return executeBrowserHostComputerUseAction(manager, workspacePath, sessionId, action, {
    capture: 'none',
    actionId: `keyboard-press-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    adapterSentAt: recentAdapterTimestamp(),
  });
}

function keyboardEditingDriverFactory(): {
  factory: BrowserHostSessionDriverFactory;
  drivers: KeyboardEditingDriver[];
} {
  const drivers: KeyboardEditingDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
        const driver = new KeyboardEditingDriver();
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class KeyboardEditingDriver implements BrowserHostSessionDriver {
  currentUrl = 'about:blank';
  focusTarget: KeyboardFocusTarget = 'page';
  editorValue = '';
  selectionStart = 0;
  selectionEnd = 0;
  pageSubmitCount = 0;
  escapeCount = 0;
  pageOffset = 0;
  systemKeyboardEventsSent = false;
  shellComposerDraft = '';
  shellComposerKeys: string[] = [];
  pressKeys: string[] = [];
  typeDeltas: string[] = [];
  pageNavigationKeys: string[] = [];
  addressBarDraft = '';
  focusTransitions: Array<{
    from: KeyboardFocusTarget;
    to: KeyboardFocusTarget;
    source: 'browser-host-goto' | 'browser-host-click' | 'address-input-focus';
  }> = [];
  addressBarInputEvents: Array<{
    owner: 'browser-address-bar';
    textLength: number;
    textHash: string;
    rawPayloadRecorded: false;
    shellComposerTarget: 'not-targeted';
  }> = [];
  addressBarShortcutEvents: Array<{
    key: string;
    owner: 'browser-address-bar';
    action: 'select-address-draft' | 'submit-address';
    systemClipboardReadWrite: 'not-performed';
    rawPayloadRecorded: false;
    shellComposerTarget: 'not-targeted';
  }> = [];
  addressBarSubmissions: Array<{
    owner: 'browser-address-bar';
    submittedUrlHash: string;
    submittedUrlLength: number;
    rawPayloadRecorded: false;
    shellComposerTarget: 'not-targeted';
  }> = [];
  clipboardPolicyEvents: Array<{
    shortcut: 'copy' | 'paste' | 'cut';
    key: string;
    selectedLength: number;
    mode: 'bounded-policy-only';
    owner: 'BrowserHostSession';
    systemClipboardReadWrite: 'not-performed';
    typedPayloadPolicy: 'blocked' | 'confirmation-needed';
    confirmationPolicy: 'required-before-system-clipboard';
    editorValueLengthBefore: number;
    editorValueLengthAfter: number;
    selectedHashSha256: string;
  }> = [];
  readonly liveSurfaceTransport = 'native-embedded' as const;
  readonly nativeAdapterUrl = 'http://127.0.0.1:39303';

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.setFocusTarget('editor', 'browser-host-goto');
  }

  async title(): Promise<string> {
    return 'Browser keyboard editing contract';
  }

  async content(): Promise<string> {
    return '<!-- deterministic BrowserHostSession keyboard editing fixture; raw editor text stays out of smoke reports -->';
  }

  async text(): Promise<string> {
    return `editorLength=${this.editorValue.length} presses=${this.pressKeys.length}`;
  }

  async screenshot(path: string): Promise<void> {
    await writeFile(path, PNG_1X1);
  }

  async axSnapshot(): Promise<unknown> {
    return {
      role: 'textbox',
      name: 'Keyboard editing fixture',
      valueLength: this.editorValue.length,
      selectionLength: this.selectionLength(),
    };
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
    const nextFocus = button === 'left' && x >= 16 && x <= 860 && y >= 16 && y <= 420
      ? 'editor'
      : 'page';
    this.setFocusTarget(nextFocus, 'browser-host-click');
    this.collapseToEnd();
  }

  async type(text: string): Promise<void> {
    if (this.focusTarget !== 'editor') {
      this.shellComposerDraft += text;
      return;
    }
    this.typeDeltas.push(text);
    this.replaceSelection(text);
  }

  async press(key: string): Promise<void> {
    this.pressKeys.push(key);
    if (this.focusTarget !== 'editor') {
      this.shellComposerKeys.push(key);
      return;
    }

    const parsed = parsePressKey(key);
    if (parsed.cmdOrCtrl && parsed.base === 'A') {
      this.selectionStart = 0;
      this.selectionEnd = this.editorValue.length;
      return;
    }
    if (parsed.cmdOrCtrl && (parsed.base === 'C' || parsed.base === 'V' || parsed.base === 'X')) {
      const editorValueLengthBefore = this.editorValue.length;
      this.clipboardPolicyEvents.push({
        shortcut: parsed.base === 'C' ? 'copy' : parsed.base === 'V' ? 'paste' : 'cut',
        key,
        selectedLength: this.selectionLength(),
        mode: 'bounded-policy-only',
        owner: 'BrowserHostSession',
        systemClipboardReadWrite: 'not-performed',
        typedPayloadPolicy: 'blocked',
        confirmationPolicy: 'required-before-system-clipboard',
        editorValueLengthBefore,
        editorValueLengthAfter: this.editorValue.length,
        selectedHashSha256: this.selectedHashSha256(),
      });
      return;
    }

    if (key === 'Backspace') {
      this.backspace();
      return;
    }
    if (key === 'Delete') {
      this.deleteForward();
      return;
    }
    if (key === 'Enter') {
      this.pageSubmitCount += 1;
      this.replaceSelection('\n');
      return;
    }
    if (key === 'Tab') {
      this.replaceSelection('\t');
      return;
    }
    if (key === 'ArrowLeft') {
      this.pageNavigationKeys.push(key);
      const next = Math.max(0, Math.min(this.selectionStart, this.selectionEnd) - 1);
      this.setCaret(next);
      return;
    }
    if (key === 'ArrowRight') {
      this.pageNavigationKeys.push(key);
      const next = Math.min(this.editorValue.length, Math.max(this.selectionStart, this.selectionEnd) + 1);
      this.setCaret(next);
      return;
    }
    if (key === 'ArrowUp') {
      this.pageNavigationKeys.push(key);
      this.setCaret(0);
      return;
    }
    if (key === 'ArrowDown') {
      this.pageNavigationKeys.push(key);
      this.collapseToEnd();
      return;
    }
    if (key === 'Home') {
      this.pageNavigationKeys.push(key);
      this.setCaret(0);
      return;
    }
    if (key === 'End') {
      this.pageNavigationKeys.push(key);
      this.collapseToEnd();
      return;
    }
    if (key === 'PageUp') {
      this.pageNavigationKeys.push(key);
      this.pageOffset -= 1;
      return;
    }
    if (key === 'PageDown') {
      this.pageNavigationKeys.push(key);
      this.pageOffset += 1;
      return;
    }
    if (key === 'Escape') {
      this.escapeCount += 1;
      this.setCaret(this.selectionEnd);
    }
  }

  async scroll(): Promise<void> {}
  async close(): Promise<void> {}

  focusAddressBar(source: 'address-input-focus'): void {
    this.setFocusTarget('address-bar', source);
  }

  typeAddressBarText(text: string): void {
    if (this.focusTarget !== 'address-bar') {
      this.shellComposerDraft += text;
      return;
    }
    this.addressBarDraft += text;
    this.addressBarInputEvents.push({
      owner: 'browser-address-bar',
      textLength: text.length,
      textHash: sha256(text),
      rawPayloadRecorded: false,
      shellComposerTarget: 'not-targeted',
    });
  }

  pressAddressBarShortcut(key: typeof ADDRESS_BAR_SHORTCUT_KEYS[number]): void {
    if (this.focusTarget !== 'address-bar') {
      this.shellComposerKeys.push(key);
      return;
    }
    this.addressBarShortcutEvents.push({
      key,
      owner: 'browser-address-bar',
      action: key === 'Enter' ? 'submit-address' : 'select-address-draft',
      systemClipboardReadWrite: 'not-performed',
      rawPayloadRecorded: false,
      shellComposerTarget: 'not-targeted',
    });
    if (key === 'Enter') this.submitAddressBar();
  }

  private submitAddressBar(): void {
    this.addressBarSubmissions.push({
      owner: 'browser-address-bar',
      submittedUrlHash: sha256(this.addressBarDraft),
      submittedUrlLength: this.addressBarDraft.length,
      rawPayloadRecorded: false,
      shellComposerTarget: 'not-targeted',
    });
  }

  private replaceSelection(text: string): void {
    const start = Math.min(this.selectionStart, this.selectionEnd);
    const end = Math.max(this.selectionStart, this.selectionEnd);
    this.editorValue = `${this.editorValue.slice(0, start)}${text}${this.editorValue.slice(end)}`;
    this.setCaret(start + text.length);
  }

  private backspace(): void {
    if (this.selectionStart !== this.selectionEnd) {
      this.replaceSelection('');
      return;
    }
    if (this.selectionStart <= 0) return;
    this.selectionStart -= 1;
    this.replaceSelection('');
  }

  private deleteForward(): void {
    if (this.selectionStart !== this.selectionEnd) {
      this.replaceSelection('');
      return;
    }
    if (this.selectionStart >= this.editorValue.length) return;
    this.selectionEnd += 1;
    this.replaceSelection('');
  }

  private collapseToEnd(): void {
    this.setCaret(this.editorValue.length);
  }

  private setCaret(offset: number): void {
    const bounded = Math.max(0, Math.min(this.editorValue.length, offset));
    this.selectionStart = bounded;
    this.selectionEnd = bounded;
  }

  private selectionLength(): number {
    return Math.abs(this.selectionEnd - this.selectionStart);
  }

  selectedTextHashSha256(): string {
    return this.selectedHashSha256();
  }

  private selectedHashSha256(): string {
    const start = Math.min(this.selectionStart, this.selectionEnd);
    const end = Math.max(this.selectionStart, this.selectionEnd);
    return sha256(this.editorValue.slice(start, end));
  }

  private setFocusTarget(to: KeyboardFocusTarget, source: KeyboardEditingDriver['focusTransitions'][number]['source']): void {
    const from = this.focusTarget;
    this.focusTarget = to;
    if (from !== to) this.focusTransitions.push({ from, to, source });
  }
}

function assertBrowserHostOnly(result: BrowserHostComputerUseActionResult, expectedAction: 'click' | 'type' | 'press'): void {
  assert.equal(result.inputChannel, 'browser-host-session');
  assert.equal(result.userDeviceImpact, 'none');
  assert.equal(result.sharedSystemInputUsed, false);
  assert.equal(result.systemMouseEvents, 'not-sent');
  assert.equal(result.systemKeyboardEvents, 'not-sent');
  assert.equal(result.liveBrowserOwner, 'BrowserHostSession');
  assert.equal(result.singleInteractiveTruth, true);
  assert.equal(result.hostAction.action, expectedAction);
  assert.equal(result.hostAction.capture, 'none');
  assert.equal(result.session.singleInteractiveTruth, true);
  assert.equal(result.session.liveSurfaceTransport, 'native-embedded');
  assert.equal(result.session.frameStreamRef, undefined);
  assert.equal(result.session.frameRef, undefined);
  assert.equal(result.session.lastActionTiming?.liveSurfaceTransport, 'native-embedded');
  assert.equal(result.session.lastActionTiming?.paintAckSource, 'native-adapter-action-state');
}

function assertTimingSummary(state: BrowserHostSessionState, action: 'click' | 'type' | 'press'): void {
  const summary = state.actionTimingSummary?.find((row) => row.action === action);
  assert.ok(summary, `missing timing summary for ${action}`);
  assert.ok(summary.count >= 1, `${action} should have at least one timing sample`);
  assert.ok(Number.isFinite(summary.lastMs), `${action} lastMs should be finite`);
}

function boundedKeyboardEditingReport(state: BrowserHostSessionState, driver: KeyboardEditingDriver) {
  const sessionScope = `browser-host-session:${state.id}`;
  return {
    schemaVersion: 'sciforge.browser-keyboard-editing-behavior-smoke.v1',
    status: 'blocked',
    source: 'deterministic-native-browser-host-session-editor-no-real-os-ui-run',
    canClaimRealKeyboardImeClipboardSelectionPass: false,
    publicNetworkUsed: false,
    refsOnly: true,
    inputChannel: 'browser-host-session',
    liveBrowserOwner: 'BrowserHostSession',
    liveSurfaceTransport: state.liveSurfaceTransport,
    singleInteractiveTruth: state.singleInteractiveTruth,
    secondTruthSource: false,
    systemKeyboardEvents: 'not-sent',
    realOsUiRunHandoff: keyboardOsUiRunHandoff(state),
    focusContract: {
      refsFirst: true,
      evidenceRefs: [
        `browser-host-session:${state.id}/address-bar-focus-contract`,
        `browser-host-session:${state.id}/page-focus-return-contract`,
      ],
      addressBar: {
        owner: 'browser-address-bar',
        ordinaryTextOwner: driver.addressBarInputEvents.every((event) => event.owner === 'browser-address-bar')
          ? 'browser-address-bar'
          : 'unknown',
        typedInputPolicy: 'bounded-address-draft-only',
        inputEventCount: driver.addressBarInputEvents.length,
        inputLengths: driver.addressBarInputEvents.map((event) => event.textLength),
        inputHashes: driver.addressBarInputEvents.map((event) => event.textHash),
        shortcutIntents: driver.addressBarShortcutEvents.map((event) => ({
          key: event.key,
          action: event.action,
          owner: event.owner,
          systemClipboardReadWrite: event.systemClipboardReadWrite,
          rawPayloadRecorded: event.rawPayloadRecorded,
          shellComposerTarget: event.shellComposerTarget,
        })),
        shortcutOwnersBrowserOwned: driver.addressBarShortcutEvents.every((event) => event.owner === 'browser-address-bar'),
        submissions: driver.addressBarSubmissions.map((event) => ({
          owner: event.owner,
          submittedUrlLength: event.submittedUrlLength,
          submittedUrlHash: event.submittedUrlHash,
          rawPayloadRecorded: event.rawPayloadRecorded,
          shellComposerTarget: event.shellComposerTarget,
        })),
        systemClipboardReadWrite: 'not-performed',
        typedPastePayloadPolicy: 'blocked-or-confirmation-needed',
        realImeCandidateWindowVerified: false,
        rawClipboardPayloadRecorded: false,
        rawCompositionPayloadRecorded: false,
        rawPayloadRecorded: false,
        shellComposerCapturedCharacters: driver.shellComposerDraft.length,
        shellComposerCapturedKeys: driver.shellComposerKeys.length,
      },
      pageFocus: {
        owner: 'BrowserHostSession',
        focusRestoredBy: 'native-embedded-surface-click',
        focusTransitions: driver.focusTransitions.map((event) => ({
          from: event.from,
          to: event.to,
          source: event.source,
        })),
        ordinaryInputOwner: driver.typeDeltas.length >= 2 ? 'BrowserHostSession' : 'unknown',
        shortcutOwner: CMD_OR_CTRL_SHORTCUTS.every((key) => driver.pressKeys.includes(key)) ? 'BrowserHostSession' : 'unknown',
        keyboardInputPath: 'native-embedded-surface',
        systemKeyboardEvents: 'not-sent',
        shellComposerCapturedCharacters: driver.shellComposerDraft.length,
        shellComposerCapturedKeys: driver.shellComposerKeys.length,
      },
      addressToPageSwitchCovered: driver.focusTransitions.some((event) => event.from === 'address-bar' && event.to === 'editor'),
      ordinaryInputAvoidsComposer: driver.shellComposerDraft.length === 0 && driver.typeDeltas.length >= 2,
      shortcutsAvoidComposer: driver.shellComposerKeys.length === 0 && CMD_OR_CTRL_SHORTCUTS.every((key) => driver.pressKeys.includes(key)),
      rawPayloadRecorded: false,
    },
    ordinaryText: {
      deltaCount: driver.typeDeltas.length,
      lengths: driver.typeDeltas.map((text) => text.length),
      hashes: driver.typeDeltas.map((text) => sha256(text)),
    },
    pressActionKeys: driver.pressKeys,
    requiredEditKeysCovered: REQUIRED_EDIT_KEYS.every((key) => driver.pressKeys.includes(key)),
    cmdOrCtrlShortcutsCovered: CMD_OR_CTRL_SHORTCUTS.every((key) => driver.pressKeys.includes(key)),
    pageEffects: {
      editorValueLength: driver.editorValue.length,
      editorValueHash: sha256(driver.editorValue),
      submitCount: driver.pageSubmitCount,
      escapeCount: driver.escapeCount,
      pageOffset: driver.pageOffset,
      navigationKeys: driver.pageNavigationKeys,
    },
    shellComposerCapturedCharacters: driver.shellComposerDraft.length,
    shellComposerCapturedKeys: driver.shellComposerKeys.length,
    clipboardPolicy: {
      boundedPolicyOnly: true,
      shortcutIntentsObserved: driver.clipboardPolicyEvents.map((event) => ({
        shortcut: event.shortcut,
        selectedLength: event.selectedLength,
        selectedHashSha256: event.selectedHashSha256,
        mode: event.mode,
        owner: event.owner,
        systemClipboardReadWrite: event.systemClipboardReadWrite,
        typedPayloadPolicy: event.typedPayloadPolicy,
        confirmationPolicy: event.confirmationPolicy,
        confirmationAuditRef: `${sessionScope}/clipboard-audit/${event.shortcut}/${event.key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        editorValueLengthBefore: event.editorValueLengthBefore,
        editorValueLengthAfter: event.editorValueLengthAfter,
      })),
      confirmationAuditRefs: [
        `${sessionScope}/clipboard-audit/copy-confirmation-required`,
        `${sessionScope}/clipboard-audit/paste-confirmation-required`,
        `${sessionScope}/clipboard-audit/cut-confirmation-required`,
      ],
      requiredProofs: keyboardClipboardRequiredProofs(state),
      realClipboardRoundTripVerified: false,
      systemClipboardReadWrite: 'not-performed',
      highRiskPathsOwnedOrBlocked: driver.clipboardPolicyEvents.every((event) => (
        event.owner === 'BrowserHostSession'
          && event.systemClipboardReadWrite === 'not-performed'
          && (event.typedPayloadPolicy === 'blocked' || event.typedPayloadPolicy === 'confirmation-needed')
      )),
      typedPastePayloadPolicy: 'blocked-or-confirmation-needed',
      rawClipboardPayloadRecorded: false,
      assertion: 'Browser pane must route clipboard shortcuts as BrowserHostSession press intents; this smoke does not claim OS clipboard copy/paste works.',
    },
    imePolicy: {
      boundedPolicyOnly: true,
      compositionEventsRoutedByNativeInput: true,
      realImeCandidateWindowVerified: false,
      syntheticCompositionPassClaimed: false,
      shellComposerCompositionCapture: 'not-observed',
      rawCompositionPayloadRecorded: false,
      compositionEvents: COMPOSITION_POLICY_EVENTS.map((event) => ({
        event,
        owner: 'BrowserHostSession',
        nativeInputPolicy: 'composition-buffered-until-end',
        shellComposerTarget: 'not-targeted',
        rawPayloadRecorded: false,
      })),
      assertion: 'IME is guarded only as hidden-input composition routing; this smoke does not claim real IME candidate/selection behavior works.',
    },
    selectionRangePolicy: {
      refsFirst: true,
      evidenceRefs: [
        `${sessionScope}/ax-snapshot`,
        `${sessionScope}/keyboard-selection-policy`,
      ],
      selectedLength: Math.abs(driver.selectionEnd - driver.selectionStart),
      selectedHashSha256: driver.selectedTextHashSha256(),
      rawSelectionTextRecorded: false,
      rawDomRecorded: false,
      editingKeysCovered: REQUIRED_EDIT_KEYS.every((key) => driver.pressKeys.includes(key)),
      shortcutSelectionOwner: 'BrowserHostSession',
      requiredProofs: keyboardSelectionRequiredProofs(state),
    },
    session: {
      id: state.id,
      owner: state.owner,
      status: state.status,
      finalUrl: state.url,
      liveSurfaceTransport: state.liveSurfaceTransport,
      frameStreamRef: state.frameStreamRef,
      frameRef: state.frameRef,
      nativeAdapterUrl: state.nativeAdapterUrl,
    },
    productAcceptance: {
      status: 'blocked',
      blocker: 'real-product-native-os-ui-run-not-executed',
      handoffRef: `${sessionScope}/os-ui-handoff/keyboard-input-fidelity`,
      requiredRealProofs: [
        'right-pane-native-surface-keyboard-focus',
        'real-ime-candidate-window-and-composition',
        'system-clipboard-round-trip-with-confirmation-audit',
        'input-contenteditable-page-selection-range',
        'shell-composer-not-targeted',
      ],
      requiredProofs: keyboardRequiredProofs(state),
    },
    timingSummary: state.actionTimingSummary?.filter((row) => row.action === 'click' || row.action === 'type' || row.action === 'press') ?? [],
  };
}

function keyboardOsUiRunHandoff(state: BrowserHostSessionState) {
  const sessionScope = `browser-host-session:${state.id}`;
  return {
    status: 'blocked' as const,
    passClaim: false,
    blocker: 'real-product-native-os-ui-run-not-executed' as const,
    requiredRunner: 'right-pane-native-os-ui-run' as const,
    productSurface: 'right-pane-browser' as const,
    owner: 'BrowserHostSession' as const,
    inputChannel: 'browser-host-session' as const,
    liveSurfaceTransport: 'native-embedded' as const,
    browserHostSessionRef: `${sessionScope}/session`,
    liveSurfaceRef: state.liveSurfaceRef,
    handoffRef: `${sessionScope}/os-ui-handoff/keyboard-input-fidelity`,
    auditRefs: [
      `${sessionScope}/audit/window-focus-owner`,
      `${sessionScope}/audit/ime-candidate-window-owner`,
      `${sessionScope}/audit/system-clipboard-owner`,
      `${sessionScope}/audit/selection-range-owner`,
      `${sessionScope}/audit/shell-composer-not-targeted`,
    ],
    rawPayloadsCaptured: false,
    refsFirst: true,
  };
}

function keyboardRequiredProofs(state: BrowserHostSessionState) {
  return [
    keyboardRequiredProof('right-pane-native-surface-keyboard-focus', state),
    keyboardRequiredProof('real-ime-candidate-window-and-composition', state),
    keyboardRequiredProof('system-clipboard-round-trip-with-confirmation-audit', state),
    keyboardRequiredProof('input-contenteditable-page-selection-range', state, {
      selectionPayloadPolicy: 'length-and-hash-only',
    }),
    keyboardRequiredProof('shell-composer-not-targeted', state),
  ];
}

function keyboardClipboardRequiredProofs(state: BrowserHostSessionState) {
  return ['copy', 'paste', 'cut'].map((operation) => ({
    operation,
    status: 'blocked' as const,
    blocker: 'real-product-native-os-ui-run-not-executed' as const,
    owner: 'BrowserHostSession' as const,
    actionRef: `browser-host-session:${state.id}/clipboard/${operation}/action`,
    confirmationAuditRef: `browser-host-session:${state.id}/clipboard/${operation}/confirmation-audit`,
    roundTripRef: `browser-host-session:${state.id}/clipboard/${operation}/round-trip-required`,
    payloadPolicy: 'length-and-hash-only' as const,
    rawClipboardPayloadRecorded: false as const,
    shellComposerTarget: 'not-targeted' as const,
  }));
}

function keyboardSelectionRequiredProofs(state: BrowserHostSessionState) {
  return (['input', 'contenteditable', 'page-text'] as const).map((target) => ({
    target,
    status: 'blocked' as const,
    blocker: 'real-product-native-os-ui-run-not-executed' as const,
    owner: 'BrowserHostSession' as const,
    rangeRef: `browser-host-session:${state.id}/selection/${target}/range`,
    requiredFields: ['selectedLength', 'selectedHashSha256'] as const,
    rawSelectionTextRecorded: false as const,
    rawDomRecorded: false as const,
  }));
}

function keyboardRequiredProof(kind: string, state: BrowserHostSessionState, extra: Record<string, unknown> = {}) {
  return {
    kind,
    status: 'blocked' as const,
    blocker: 'real-product-native-os-ui-run-not-executed' as const,
    owner: 'BrowserHostSession' as const,
    productSurface: 'right-pane-browser' as const,
    browserHostSessionRef: `browser-host-session:${state.id}/session`,
    liveSurfaceRef: state.liveSurfaceRef,
    proofRef: `browser-host-session:${state.id}/required-proof/${kind}`,
    rawPayloadRecorded: false as const,
    secondTruthSource: false as const,
    ...extra,
  };
}

function parsePressKey(key: string): { base: string; cmdOrCtrl: boolean } {
  const parts = key.split('+').map((part) => part.trim()).filter(Boolean);
  const base = (parts.at(-1) ?? key).toUpperCase();
  const modifiers = new Set(parts.slice(0, -1));
  return {
    base,
    cmdOrCtrl: modifiers.has('Meta') || modifiers.has('Control'),
  };
}

function requiredDriver(drivers: KeyboardEditingDriver[]): KeyboardEditingDriver {
  const driver = drivers[0];
  assert.ok(driver, 'deterministic keyboard editing driver should be created');
  return driver;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writeBoundedKeyboardArtifact(report: unknown): Promise<void> {
  await mkdir(dirname(artifactPath), { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_KEYBOARD_ARTIFACT_BYTES);
  await writeFile(artifactPath, text, 'utf8');
}

function assertNoRawKeyboardArtifactPayload(text: string, label: string): void {
  assert.doesNotMatch(text, /data:image|base64|<\s*(?:!doctype|html|body|textarea|input|iframe|webview)\b/i, `${label} must not include raw DOM or base64`);
  assert.doesNotMatch(
    text,
    /"(?:clipboardText|clipboardPayload|selectionText|selectionPayload|compositionText|compositionPayload|typedText|typedPayload|rawDom|rawHtml|rawClipboard|rawSelection|rawComposition)"\s*:/i,
    `${label} must stay refs-first without raw input payload fields`,
  );
  assert.doesNotMatch(text, new RegExp(escapeRegExp(ORDINARY_TEXT_INITIAL)), `${label} must not include typed raw text`);
  assert.doesNotMatch(text, new RegExp(escapeRegExp(ORDINARY_TEXT_DELTA)), `${label} must not include typed raw text`);
  assert.doesNotMatch(text, new RegExp(escapeRegExp(ADDRESS_BAR_FOCUS_TEXT)), `${label} must not include raw address text`);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function recentAdapterTimestamp(): string {
  return new Date(Date.now() - 1).toISOString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
