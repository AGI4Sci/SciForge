import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
  buildBlockedRightPaneNativeOsUiRunSkeleton,
  validateRightPaneNativeOsUiRunManifest,
  type RightPaneNativeOsUiRunManifest,
} from './right-pane-native-os-ui-run-contract.js';

test('right-pane native OS UI skeleton is typed blocked when no OS observer is available', () => {
  const manifest = buildBlockedRightPaneNativeOsUiRunSkeleton({
    browserHostSessionRef: 'browser-host-session:m1-os-ui/session',
    liveSurfaceRef: 'browser-host-session:m1-os-ui/live-surface',
    observedAt: '2026-06-02T00:00:00.000Z',
  });

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(manifest.schemaVersion, RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.runner, 'right-pane-native-os-ui-run');
  assert.equal(manifest.blocker, 'missing-os-observer');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.source, 'blocked-skeleton-no-os-observer');
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
  assert.ok(validation.blockReasons.includes('all-proof-groups-must-pass'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-ref-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-audit-ref-required'));
  assert.equal(manifest.capturePolicy.screenshotUsedAsProof, false);
  assert.equal(manifest.capturePolicy.frameStreamUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawDomUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawClipboardPayloadUsedAsProof, false);
  assert.deepEqual(manifest.forbiddenSubstitutes, {
    screenshot: false,
    frameStream: false,
    rawDom: false,
    rawClipboardPayload: false,
    systemPopup: false,
    secondBrowserOwner: false,
  });
});

test('right-pane native OS UI validator rejects forged pass without real run and audit refs', () => {
  const forged: RightPaneNativeOsUiRunManifest = {
    ...buildBlockedRightPaneNativeOsUiRunSkeleton({
      browserHostSessionRef: 'browser-host-session:m1-os-ui/session',
      liveSurfaceRef: 'browser-host-session:m1-os-ui/live-surface',
      observedAt: '2026-06-02T00:00:00.000Z',
    }),
    status: 'passed',
    passClaim: true,
    source: 'contract-fixture',
    osObserver: {
      status: 'available',
      observerRef: 'os-observer:macos-accessibility/m1-os-ui',
      observerKind: 'macos-accessibility',
    },
    proofGroups: {
      cursorCaret: {
        status: 'passed',
        proofRefs: ['browser-host-session:m1-os-ui/caret-visible'],
        auditRefs: [],
      },
      mouseContextMenu: {
        status: 'passed',
        proofRefs: ['browser-host-session:m1-os-ui/context-menu'],
        auditRefs: [],
      },
      keyboardImeClipboardSelection: {
        status: 'passed',
        proofRefs: ['browser-host-session:m1-os-ui/keyboard-ime-clipboard-selection'],
        auditRefs: [],
      },
      rerenderFocus: {
        status: 'passed',
        proofRefs: ['browser-host-session:m1-os-ui/rerender-focus'],
        auditRefs: [],
      },
    },
    osUiRun: {
      runRef: 'browser-host-session:m1-os-ui/not-a-real-os-ui-run',
      auditRefs: [],
      browserHostSessionRef: 'browser-host-session:m1-os-ui/session',
      liveSurfaceRef: 'browser-host-session:m1-os-ui/live-surface',
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
    },
  };

  const validation = validateRightPaneNativeOsUiRunManifest(forged);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-ref-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-audit-ref-required'));
  assert.ok(validation.blockReasons.includes('proof-group-audit-refs-required'));
});

test('right-pane native OS UI validator accepts bounded real product run refs for all M1 proof groups', () => {
  const manifest = validRealProductOsUiRunManifest();

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(validation.canClaimPass, true);
  assert.deepEqual(validation.blockReasons, []);
});

test('right-pane native OS UI validator rejects metadata probes as pass-grade real OS UI proof', () => {
  const manifest = validRealProductOsUiRunManifest();
  manifest.osObserver = {
    status: 'available',
    observerRef: 'real-product-os-ui-run:m1-os-ui/macos-accessibility-metadata-probe',
    observerKind: 'macos-accessibility',
  };
  manifest.osUiRun = {
    ...manifest.osUiRun!,
    auditRefs: ['real-product-os-ui-audit:m1-os-ui/cursor-caret/metadata-probe/window-count'],
  };
  manifest.proofGroups.cursorCaret = {
    status: 'passed',
    proofRefs: ['real-product-os-ui-run:m1-os-ui/cursor-caret/metadata-probe/window-count'],
    auditRefs: ['real-product-os-ui-audit:m1-os-ui/cursor-caret/metadata-probe/window-count'],
  };

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-proof-not-metadata-probe'));
});

test('right-pane native OS UI validator rejects screenshot, frame-stream, DOM, and clipboard substitutes as proof', () => {
  const manifest = validRealProductOsUiRunManifest();
  const forged = manifest as unknown as {
    capturePolicy: Record<string, boolean>;
    proofGroups: RightPaneNativeOsUiRunManifest['proofGroups'];
  };
  forged.capturePolicy.screenshotUsedAsProof = true;
  forged.capturePolicy.frameStreamUsedAsProof = true;
  forged.capturePolicy.rawDomUsedAsProof = true;
  forged.capturePolicy.rawClipboardPayloadUsedAsProof = true;
  forged.proofGroups.cursorCaret.proofRefs.push('screenshot:cursor-caret-proof');
  forged.proofGroups.mouseContextMenu.proofRefs.push('frame-stream:context-menu-proof');

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('screenshot-frame-stream-raw-dom-clipboard-cannot-substitute-os-ui-proof'));
  assert.ok(validation.blockReasons.includes('proof-refs-must-not-use-forbidden-substitutes'));
});

test('right-pane native OS UI validator rejects available observers without real product OS UI run refs', () => {
  const manifest = validRealProductOsUiRunManifest();
  manifest.osObserver = {
    status: 'available',
    observerRef: 'os-observer:macos-accessibility/m1-os-ui',
    observerKind: 'macos-accessibility',
  };

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-observer-ref-required'));
});

test('right-pane native OS UI validator rejects proof refs split across real OS UI run ids', () => {
  const manifest = validRealProductOsUiRunManifest();
  manifest.proofGroups.cursorCaret = passedProofGroup('cursor-caret', [
    'input-caret-visible',
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
    'focus-blur-restore',
  ], 'other-os-ui-run');
  manifest.osUiRun = {
    ...manifest.osUiRun!,
    auditRefs: Object.values(manifest.proofGroups).flatMap((group) => group.auditRefs),
  };

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-scope-cohesion-required'));
});

test('right-pane native OS UI validator requires BrowserHostSession action channel for pass claims', () => {
  const missingChannel = validRealProductOsUiRunManifest();
  missingChannel.browserHostActionChannel = {
    status: 'missing',
    blocker: 'missing-browser-host-action-channel',
    requiredEnv: 'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL',
  };

  const missingValidation = validateRightPaneNativeOsUiRunManifest(missingChannel);

  assert.equal(missingValidation.canClaimPass, false);
  assert.ok(missingValidation.blockReasons.includes('browser-host-action-channel-required'));

  const wrongSurface = validRealProductOsUiRunManifest();
  wrongSurface.browserHostActionChannel = {
    ...wrongSurface.browserHostActionChannel!,
    liveSurfaceRef: 'browser-host-session:other/live-surface',
  };

  const wrongSurfaceValidation = validateRightPaneNativeOsUiRunManifest(wrongSurface);

  assert.equal(wrongSurfaceValidation.canClaimPass, false);
  assert.ok(wrongSurfaceValidation.blockReasons.includes('browser-host-action-channel-required'));
});

test('right-pane native OS UI validator requires pass-grade action ledger for every M1 proof group', () => {
  const missingLedger = validRealProductOsUiRunManifest();
  delete missingLedger.actionLedger;

  const missingLedgerValidation = validateRightPaneNativeOsUiRunManifest(missingLedger);

  assert.equal(missingLedgerValidation.canClaimPass, false);
  assert.ok(missingLedgerValidation.blockReasons.includes('pass-grade-action-ledger-required'));

  const wrongSurface = validRealProductOsUiRunManifest();
  wrongSurface.actionLedger!.entries[0] = {
    ...wrongSurface.actionLedger!.entries[0],
    targetSurfaceRef: 'browser-host-session:other/live-surface',
  };

  const wrongSurfaceValidation = validateRightPaneNativeOsUiRunManifest(wrongSurface);

  assert.equal(wrongSurfaceValidation.canClaimPass, false);
  assert.ok(wrongSurfaceValidation.blockReasons.includes('pass-grade-action-ledger-required'));
});

test('right-pane native OS UI validator requires canonical pass-grade action ids', () => {
  const wrongActionId = validRealProductOsUiRunManifest();
  wrongActionId.actionLedger!.entries[0] = {
    ...wrongActionId.actionLedger!.entries[0],
    actionId: 'verify-cursor-caret',
    actionRef: 'real-product-os-ui-action:m1-os-ui/cursor-caret/verify-cursor-caret',
    evidenceTokenRef: 'real-product-os-ui-run:m1-os-ui/cursor-caret/verify-cursor-caret/bounded-action-ledger',
  };

  const validation = validateRightPaneNativeOsUiRunManifest(wrongActionId);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('pass-grade-action-ledger-required'));
});

test('right-pane native OS UI validator requires complete M1 capability proof refs', () => {
  const manifest = validRealProductOsUiRunManifest();
  manifest.proofGroups.cursorCaret = passedProofGroup('cursor-caret', [
    'input-caret-visible',
    'focus-blur-restore',
  ]);
  manifest.proofGroups.mouseContextMenu = passedProofGroup('mouse-context-menu', [
    'right-click-context-menu-owner',
    'text-selection-range-owner',
  ]);
  manifest.proofGroups.keyboardImeClipboardSelection = passedProofGroup('keyboard-ime-clipboard-selection', [
    'keyboard-backspace-delete-owner',
    'system-clipboard-round-trip-owner',
  ]);
  manifest.proofGroups.rerenderFocus = passedProofGroup('rerender-focus', [
    'native-surface-not-detached',
    'focus-retained-after-rerender',
  ]);
  manifest.osUiRun = {
    ...manifest.osUiRun!,
    auditRefs: Object.values(manifest.proofGroups).flatMap((group) => group.auditRefs),
  };

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('complete-m1-native-os-ui-proof-refs-required'));
});

test('right-pane native OS UI validator requires proof refs to match their proof group area', () => {
  const manifest = validRealProductOsUiRunManifest();
  manifest.proofGroups.cursorCaret = passedProofGroup('wrong-area', [
    'input-caret-visible',
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
    'focus-blur-restore',
  ]);
  manifest.osUiRun = {
    ...manifest.osUiRun!,
    auditRefs: Object.values(manifest.proofGroups).flatMap((group) => group.auditRefs),
  };

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('complete-m1-native-os-ui-proof-refs-required'));
});

function validRealProductOsUiRunManifest(): RightPaneNativeOsUiRunManifest {
  const browserHostSessionRef = 'browser-host-session:m1-os-ui/session';
  const liveSurfaceRef = 'browser-host-session:m1-os-ui/live-surface';
  const runId = 'm1-os-ui';

  return {
    schemaVersion: RIGHT_PANE_NATIVE_OS_UI_RUN_SCHEMA,
    status: 'passed',
    passClaim: true,
    runner: 'right-pane-native-os-ui-run',
    source: 'real-product-os-ui-run',
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef,
    liveSurfaceRef,
    observedAt: '2026-06-02T00:00:00.000Z',
    refsFirst: true,
    boundedEvidenceOnly: true,
    osObserver: {
      status: 'available',
      observerRef: 'real-product-os-ui-run:m1-os-ui/macos-accessibility-observer',
      observerKind: 'macos-accessibility',
    },
    osUiRun: {
      runRef: 'real-product-os-ui-run:m1-os-ui/run',
      auditRefs: [
        'real-product-os-ui-audit:m1-os-ui/window-focus',
        'real-product-os-ui-audit:m1-os-ui/context-menu',
        'real-product-os-ui-audit:m1-os-ui/ime-clipboard-selection',
        'real-product-os-ui-audit:m1-os-ui/rerender-focus',
      ],
      browserHostSessionRef,
      liveSurfaceRef,
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
    },
    browserHostActionChannel: {
      status: 'available',
      channelRef: 'browser-host-session:m1-os-ui/session/right-pane-native-os-ui-run/action-channel/hash-0123456789ab',
      browserHostSessionRef,
      liveSurfaceRef,
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
      inputChannel: 'browser-host-session',
      rawEndpointRecorded: false,
      loopbackOnly: true,
    },
    proofGroups: {
      cursorCaret: passedProofGroup('cursor-caret', [
        'input-caret-visible',
        'pointer-button-link',
        'pointer-default-area',
        'text-cursor-area',
        'focus-blur-restore',
      ]),
      mouseContextMenu: passedProofGroup('mouse-context-menu', [
        'left-click-owner',
        'right-click-context-menu-owner',
        'middle-click-owner',
        'double-click-owner',
        'mouse-down-up-owner',
        'continuous-move-owner',
        'drag-drop-owner',
        'text-selection-range-owner',
        'wheel-vertical-owner',
        'wheel-horizontal-owner',
        'scrollbar-thumb-owner',
      ]),
      keyboardImeClipboardSelection: passedProofGroup('keyboard-ime-clipboard-selection', [
        'keyboard-backspace-delete-owner',
        'keyboard-enter-owner',
        'keyboard-tab-owner',
        'keyboard-arrow-home-end-page-owner',
        'keyboard-shortcuts-select-copy-paste-cut-owner',
        'keyboard-escape-owner',
        'ime-candidate-window-owner',
        'system-clipboard-round-trip-owner',
        'selection-range-owner',
      ]),
      rerenderFocus: passedProofGroup('rerender-focus', [
        'native-surface-not-detached',
        'address-bar-rerender-stable',
        'tab-state-rerender-stable',
        'diagnostic-expand-stable',
        'focus-retained-after-rerender',
        'tab-switch-resize-minimize-restore',
      ]),
    },
    actionLedger: passedActionLedger(runId, liveSurfaceRef),
    capturePolicy: {
      screenshotUsedAsProof: false,
      frameStreamUsedAsProof: false,
      rawDomUsedAsProof: false,
      rawClipboardPayloadUsedAsProof: false,
      rawSelectionTextRecorded: false,
      rawImePayloadRecorded: false,
      rawContextMenuPayloadRecorded: false,
    },
    forbiddenSubstitutes: {
      screenshot: false,
      frameStream: false,
      rawDom: false,
      rawClipboardPayload: false,
      systemPopup: false,
      secondBrowserOwner: false,
    },
  };
}

function passedProofGroup(area: string, proofNames: string[], runId = 'm1-os-ui') {
  return {
    status: 'passed' as const,
    proofRefs: proofNames.map((name) => `real-product-os-ui-run:${runId}/${area}/${name}`),
    auditRefs: proofNames.map((name) => `real-product-os-ui-audit:${runId}/${area}/${name}`),
  };
}

function passedActionLedger(runId: string, liveSurfaceRef: string) {
  return {
    entries: [
      passedActionLedgerEntry(runId, liveSurfaceRef, 'cursorCaret', 'cursor-caret', 'focus-input-caret', [
        'input-caret-visible',
        'pointer-button-link',
        'pointer-default-area',
        'text-cursor-area',
        'focus-blur-restore',
      ]),
      passedActionLedgerEntry(runId, liveSurfaceRef, 'mouseContextMenu', 'mouse-context-menu', 'verify-mouse-context-menu', [
        'left-click-owner',
        'right-click-context-menu-owner',
        'middle-click-owner',
        'double-click-owner',
        'mouse-down-up-owner',
        'continuous-move-owner',
        'drag-drop-owner',
        'text-selection-range-owner',
        'wheel-vertical-owner',
        'wheel-horizontal-owner',
        'scrollbar-thumb-owner',
      ]),
      passedActionLedgerEntry(
        runId,
        liveSurfaceRef,
        'keyboardImeClipboardSelection',
        'keyboard-ime-clipboard-selection',
        'verify-ime-clipboard-selection',
        [
          'keyboard-backspace-delete-owner',
          'keyboard-enter-owner',
          'keyboard-tab-owner',
          'keyboard-arrow-home-end-page-owner',
          'keyboard-shortcuts-select-copy-paste-cut-owner',
          'keyboard-escape-owner',
          'ime-candidate-window-owner',
          'system-clipboard-round-trip-owner',
          'selection-range-owner',
        ],
      ),
      passedActionLedgerEntry(runId, liveSurfaceRef, 'rerenderFocus', 'rerender-focus', 'verify-rerender-focus', [
        'native-surface-not-detached',
        'address-bar-rerender-stable',
        'tab-state-rerender-stable',
        'diagnostic-expand-stable',
        'focus-retained-after-rerender',
        'tab-switch-resize-minimize-restore',
      ]),
    ],
  };
}

function passedActionLedgerEntry(
  runId: string,
  liveSurfaceRef: string,
  proofGroup: keyof RightPaneNativeOsUiRunManifest['proofGroups'],
  area: string,
  actionId: string,
  proofNames: string[],
) {
  return {
    status: 'passed' as const,
    proofGroup,
    actionId,
    actionRef: `real-product-os-ui-action:${runId}/${area}/${actionId}`,
    targetSurfaceRef: liveSurfaceRef,
    productSurface: 'right-pane-browser' as const,
    owner: 'BrowserHostSession' as const,
    inputChannel: 'browser-host-session' as const,
    expectedProofNames: proofNames,
    observedProofNames: proofNames,
    evidenceTokenRef: `real-product-os-ui-run:${runId}/${area}/${actionId}/bounded-action-ledger`,
    rawPayloadRecorded: false as const,
  };
}
