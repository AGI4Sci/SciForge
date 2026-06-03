import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';

import {
  RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS,
  RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV,
  RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES,
  missingBrowserHostActionChannel,
  validateRightPaneNativeOsUiRunManifest,
  type RightPaneNativeOsUiRunManifest,
} from '../../src/desktop/right-pane-native-os-ui-run-contract.js';
import {
  runRightPaneNativeOsUiMacosObserver,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE,
} from '../../tools/right-pane-native-os-ui-macos-observer.js';

const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_CURSOR_CARET_ACTION_PLAN_JSON =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON' as const;

test('macOS native OS UI observer is opt-in and returns missing-os-observer blocked evidence by default', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {},
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'missing-os-observer');
  assert.equal(manifest.source, 'blocked-skeleton-no-os-observer');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.boundedEvidenceOnly, true);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('macOS native OS UI observer records bounded built-in diagnostic refs without claiming pass', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assertBuiltInObserverDiagnosticProofGroups(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /missing-env|screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
  assert.ok(validation.blockReasons.includes('all-proof-groups-must-pass'));
});

test('macOS native OS UI observer rejects env-provided screenshot DOM clipboard substitutes', async () => {
  const forged = realProductManifest({
    capturePolicy: {
      screenshotUsedAsProof: true,
      frameStreamUsedAsProof: true,
      rawDomUsedAsProof: true,
      rawClipboardPayloadUsedAsProof: true,
      rawSelectionTextRecorded: false,
      rawImePayloadRecorded: false,
      rawContextMenuPayloadRecorded: false,
    } as unknown as RightPaneNativeOsUiRunManifest['capturePolicy'],
    proofGroups: {
      cursorCaret: {
        status: 'passed',
        proofRefs: ['screenshot:cursor'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/cursor'],
      },
      mouseContextMenu: {
        status: 'passed',
        proofRefs: ['frame-stream:menu'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/menu'],
      },
      keyboardImeClipboardSelection: {
        status: 'passed',
        proofRefs: ['raw-dom:selection'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/selection'],
      },
      rerenderFocus: {
        status: 'passed',
        proofRefs: ['raw-clipboard:focus'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/focus'],
      },
    },
  });

  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON]: JSON.stringify(forged),
    },
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'missing-os-observer');
  assert.equal(manifest.source, 'blocked-skeleton-no-os-observer');
  assert.equal(manifest.capturePolicy.screenshotUsedAsProof, false);
  assert.equal(manifest.capturePolicy.frameStreamUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawDomUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawClipboardPayloadUsedAsProof, false);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:/);
});

test('macOS native OS UI observer refuses env JSON accessibility observations as pass-grade proof', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_EVIDENCE_JSON]: JSON.stringify({
        source: 'macos-accessibility-observer',
        runId: 'm1-native-live',
        proofGroups: RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES,
      }),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.notEqual(manifest.source, 'real-product-os-ui-run');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('macOS native OS UI observer refuses command-backed accessibility JSON as pass-grade proof without real observer provenance', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        '-e',
        `process.stdout.write(JSON.stringify({
          source: 'macos-accessibility-observer',
          runId: 'm1-native-live',
          proofGroups: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)}
        }))`,
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.notEqual(manifest.source, 'real-product-os-ui-run');
  assert.equal(manifest.osObserver.status, 'missing');
  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('macOS native OS UI observer records trusted helper provenance missing refs for pass-shaped non-helper stdout', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        '-e',
        `process.stdout.write(JSON.stringify({
          source: 'macos-accessibility-observer',
          runId: 'm1-native-live',
          proofGroups: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)}
        }))`,
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assertTrustedHelperProvenanceMissingProofGroups(manifest);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
  assert.ok(validation.blockReasons.includes('all-proof-groups-must-pass'));
});

test('macOS native OS UI observer does not trust helper basename passed as a normal argv entry', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        '-e',
        `process.stdout.write(JSON.stringify({
          source: 'macos-accessibility-observer',
          runId: 'm1-native-live',
          proofGroups: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)}
        }))`,
        'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assertTrustedHelperProvenanceMissingProofGroups(manifest);
});

test('macOS native OS UI observer rejects fake tmp tsx helper command provenance for pass-shaped stdout', async () => {
  const fakeBinDir = await mkdtemp(join(tmpdir(), 'sciforge-fake-tsx-'));
  const fakeTsxCommand = join(fakeBinDir, 'tsx');
  await writeFile(fakeTsxCommand, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  source: 'macos-accessibility-observer',
  runId: 'm1-native-live',
  proofGroups: {
    cursorCaret: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)},
    mouseContextMenu: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)},
    keyboardImeClipboardSelection: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)},
    rerenderFocus: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)}
  }
}));
`);
  await chmod(fakeTsxCommand, 0o755);

  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: fakeTsxCommand,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assertTrustedHelperProvenanceMissingProofGroups(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('trusted macOS OS UI helper remains diagnostic blocked until complete real proof exists', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      ...trustedHelperCommandEnv(),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);
});

test('trusted macOS OS UI helper partial caret proof remains blocked and bounded', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      ...trustedHelperCommandEnv([
        '--run-id',
        'm1-native-live',
        '--probe-mode',
        'bounded-partial-caret-fixture',
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assert.equal(manifest.proofGroups.cursorCaret.status, 'blocked');
  assert.ok(manifest.proofGroups.cursorCaret.proofRefs.includes(
    'real-product-os-ui-run:m1-native-live/cursor-caret/input-caret-visible',
  ));
  assert.ok(manifest.proofGroups.cursorCaret.auditRefs.includes(
    'real-product-os-ui-audit:m1-native-live/cursor-caret/input-caret-visible',
  ));
  assertTrustedHelperProofIncompleteProofGroups(manifest);
  assertNoForbiddenRawKeys(manifest);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/,
  );

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('manifest-status-pass-claim-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('complete-m1-native-os-ui-proof-refs-required'));
});

test('trusted macOS OS UI helper partial proof ledger preserves bounded multi-group refs while blocked', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      ...trustedHelperCommandEnv([
        '--run-id',
        'm1-native-live',
        '--probe-mode',
        'bounded-partial-proof-ledger-fixture',
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assert.ok(manifest.proofGroups.cursorCaret.proofRefs.includes(
    'real-product-os-ui-run:m1-native-live/cursor-caret/focus-blur-restore',
  ));
  assert.ok(manifest.proofGroups.rerenderFocus.proofRefs.includes(
    'real-product-os-ui-run:m1-native-live/rerender-focus/native-surface-not-detached',
  ));
  assert.equal(manifest.partialProofLedger?.cursorCaret.status, 'partial');
  assert.deepEqual(manifest.partialProofLedger?.cursorCaret.observedProofNames, [
    'input-caret-visible',
    'focus-blur-restore',
  ]);
  assert.equal(manifest.partialProofLedger?.rerenderFocus.status, 'partial');
  assert.deepEqual(manifest.partialProofLedger?.rerenderFocus.observedProofNames, [
    'native-surface-not-detached',
    'focus-retained-after-rerender',
  ]);
  assert.equal(manifest.partialProofLedger?.mouseContextMenu.status, 'not-observed');
  assert.equal(manifest.partialProofLedger?.keyboardImeClipboardSelection.status, 'not-observed');
  assert.ok(manifest.actionLedger, 'trusted helper partial run should preserve bounded action ledger');
  assert.ok(manifest.actionLedger?.entries.some((entry) => (
    entry.proofGroup === 'cursorCaret'
    && entry.actionId === 'focus-input-caret'
    && entry.status === 'partial'
    && entry.actionRef === 'real-product-os-ui-action:m1-native-live/cursor-caret/focus-input-caret'
    && entry.targetSurfaceRef === 'browser-host-session:m1-native-live/live-surface'
    && entry.expectedProofNames.includes('input-caret-visible')
    && entry.observedProofNames.includes('input-caret-visible')
  )));
  assert.ok(manifest.actionLedger?.entries.some((entry) => (
    entry.proofGroup === 'keyboardImeClipboardSelection'
    && entry.actionId === 'verify-ime-clipboard-selection'
    && entry.status === 'blocked'
    && entry.observedProofNames.length === 0
  )));
  assertTrustedHelperProofIncompleteProofGroups(manifest);
  assertNoForbiddenRawKeys(manifest);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('manifest-status-pass-claim-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('complete-m1-native-os-ui-proof-refs-required'));
});

test('trusted macOS OS UI helper partial mouse action ledger preserves bounded owner proofs while blocked', async () => {
  const expectedMouseProofs = [
    'left-click-owner',
    'middle-click-owner',
    'double-click-owner',
    'mouse-down-up-owner',
    'continuous-move-owner',
    'wheel-vertical-owner',
    'wheel-horizontal-owner',
  ];
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      ...trustedHelperCommandEnv([
        '--run-id',
        'm1-native-live',
        '--probe-mode',
        'bounded-partial-mouse-action-fixture',
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.proofGroups.mouseContextMenu.status, 'blocked');
  for (const proofName of expectedMouseProofs) {
    assert.ok(manifest.proofGroups.mouseContextMenu.proofRefs.includes(
      `real-product-os-ui-run:m1-native-live/mouse-context-menu/${proofName}`,
    ));
    assert.ok(manifest.proofGroups.mouseContextMenu.auditRefs.includes(
      `real-product-os-ui-audit:m1-native-live/mouse-context-menu/${proofName}`,
    ));
  }
  assert.equal(manifest.partialProofLedger?.mouseContextMenu.status, 'partial');
  assert.deepEqual(manifest.partialProofLedger?.mouseContextMenu.observedProofNames, expectedMouseProofs);

  const mouseAction = manifest.actionLedger?.entries.find((entry) => (
    entry.proofGroup === 'mouseContextMenu'
    && entry.actionId === 'verify-mouse-context-menu'
  ));
  assert.ok(mouseAction, 'mouse action ledger entry should be preserved');
  assert.equal(mouseAction.status, 'partial');
  assert.equal(mouseAction.rawPayloadRecorded, false);
  assert.equal(mouseAction.targetSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.deepEqual(mouseAction.observedProofNames, expectedMouseProofs);
  assert.deepEqual(mouseAction.expectedProofNames, RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.mouseContextMenu);

  assertTrustedHelperProofIncompleteProofGroups(manifest);
  assertNoForbiddenRawKeys(manifest);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/,
  );

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('manifest-status-pass-claim-required'));
  assert.ok(validation.blockReasons.includes('all-proof-groups-must-pass'));
  assert.ok(validation.blockReasons.includes('complete-m1-native-os-ui-proof-refs-required'));
});

test('trusted macOS OS UI helper complete cursorCaret action ledger can pass while manifest remains blocked', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      ...trustedHelperCommandEnv([
        '--run-id',
        'm1-native-live',
        '--probe-mode',
        'bounded-complete-cursor-caret-action-fixture',
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.proofGroups.cursorCaret.status, 'blocked');
  for (const proofName of RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.cursorCaret) {
    assert.ok(manifest.proofGroups.cursorCaret.proofRefs.includes(
      `real-product-os-ui-run:m1-native-live/cursor-caret/${proofName}`,
    ));
    assert.ok(manifest.proofGroups.cursorCaret.auditRefs.includes(
      `real-product-os-ui-audit:m1-native-live/cursor-caret/${proofName}`,
    ));
  }

  assert.equal(manifest.partialProofLedger?.cursorCaret.status, 'partial');
  assert.deepEqual(
    manifest.partialProofLedger?.cursorCaret.observedProofNames,
    RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.cursorCaret,
  );

  const cursorCaretAction = manifest.actionLedger?.entries.find((entry) => (
    entry.proofGroup === 'cursorCaret'
    && entry.actionId === 'focus-input-caret'
  ));
  assert.ok(cursorCaretAction, 'cursorCaret action ledger entry should be preserved');
  assert.equal(cursorCaretAction.status, 'passed');
  assert.equal(cursorCaretAction.rawPayloadRecorded, false);
  assert.equal(cursorCaretAction.targetSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.equal(cursorCaretAction.evidenceTokenRef, 'macos-accessibility-observer/m1-native-live/cursor-caret/focus-input-caret/bounded-action-ledger');
  assert.deepEqual(cursorCaretAction.expectedProofNames, RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.cursorCaret);
  assert.deepEqual(cursorCaretAction.observedProofNames, RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.cursorCaret);

  assertTrustedHelperProofIncompleteProofGroups(manifest);
  assertNoForbiddenRawKeys(manifest);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/,
  );

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('manifest-status-pass-claim-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('all-proof-groups-must-pass'));
});

test('trusted macOS OS UI helper cursorCaret action plan records bounded cursor proofs while blocked', async (t) => {
  const actionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const cursor = cursorForProbe(body);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          cursor,
          diagnostics: [`cursor:${cursor}`],
        },
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const expectedProofs = [
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
  ];

  try {
    const manifest = await runRightPaneNativeOsUiMacosObserver({
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_CURSOR_CARET_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'cursorCaret',
          mode: 'bounded-cursor-caret',
          actions: expectedProofs,
        }),
        ...trustedHelperCommandEnv([
          '--run-id',
          'm1-native-live',
        ]),
      },
      platform: 'darwin',
      now: '2026-06-02T00:00:00.000Z',
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    });

    assert.equal(actionBodies.length, 3);
    assert.ok(actionBodies.every((body) => body.action === 'cursor'));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.source, 'contract-fixture');
    assert.equal(manifest.proofGroups.cursorCaret.status, 'blocked');
    for (const proofName of expectedProofs) {
      assert.ok(manifest.proofGroups.cursorCaret.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/cursor-caret/${proofName}`,
      ));
      assert.ok(manifest.proofGroups.cursorCaret.auditRefs.includes(
        `real-product-os-ui-audit:m1-native-live/cursor-caret/${proofName}`,
      ));
    }
    assert.deepEqual(
      manifest.partialProofLedger?.cursorCaret.observedProofNames.filter((name) => expectedProofs.includes(name)),
      expectedProofs,
    );
    const cursorCaretAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'cursorCaret'
      && entry.actionId === 'focus-input-caret'
    ));
    assert.ok(cursorCaretAction, 'cursorCaret action ledger entry should be preserved');
    assert.equal(cursorCaretAction.status, 'partial');
    assert.equal(cursorCaretAction.rawPayloadRecorded, false);
    assert.ok(expectedProofs.every((proofName) => cursorCaretAction.observedProofNames.includes(proofName)));
    assertNoForbiddenRawKeys(manifest);
    assert.doesNotMatch(
      JSON.stringify(manifest),
      /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions|endpoint|coords|payload|"x"|"y"|screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('trusted macOS OS UI helper cursorCaret action plan records nativeOsUiProof caret and focus proofs while blocked', async (t) => {
  const requestedProofs: string[] = [];
  const actionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const expectedProofNames = Array.isArray(body.expectedProofNames)
        ? body.expectedProofNames.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const requestedProofName = expectedProofNames[0] ?? String(body.action ?? '');
      requestedProofs.push(requestedProofName);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          nativeOsUiProof: {
            schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
            boundedEvidenceOnly: true,
            rawDomRecorded: false,
            rawTextRecorded: false,
            rawUrlRecorded: false,
            rawTitleRecorded: false,
            rawSelectorRecorded: false,
            rawCoordsRecorded: false,
            rawPayloadRecorded: false,
            source: 'native-embedded-action-state',
            proofGroup: 'cursorCaret',
            actionId: 'focus-input-caret',
            observedProofNames: [requestedProofName],
            evidenceTokens: [`proof:${requestedProofName}:observed`],
            diagnostics: [`proof:${requestedProofName}:observed`],
          },
        },
        nativeOsUiProof: {
          schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
          boundedEvidenceOnly: true,
          rawDomRecorded: false,
          rawTextRecorded: false,
          rawUrlRecorded: false,
          rawTitleRecorded: false,
          rawSelectorRecorded: false,
          rawCoordsRecorded: false,
          rawPayloadRecorded: false,
          source: 'native-embedded-action-state',
          proofGroup: 'cursorCaret',
          actionId: 'focus-input-caret',
          observedProofNames: [requestedProofName],
          evidenceTokens: [`proof:${requestedProofName}:observed`],
          diagnostics: [`proof:${requestedProofName}:observed`],
          rawEndpoint: 'http://127.0.0.1:9999/api/sciforge/browser-host/sessions/m1-native-live/actions',
          url: 'https://example.invalid/private',
          title: 'private title',
          dom: '<input value="secret">',
          text: 'raw visible text',
          coords: { x: 11, y: 12 },
          payload: { secret: 'do-not-record' },
        },
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const expectedProofs = [
    'input-caret-visible',
    'focus-blur-restore',
  ];

  try {
    const manifest = await runRightPaneNativeOsUiMacosObserver({
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_CURSOR_CARET_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'cursorCaret',
          mode: 'bounded-cursor-caret',
          actions: expectedProofs,
        }),
        ...trustedHelperCommandEnv([
          '--run-id',
          'm1-native-live',
        ]),
      },
      platform: 'darwin',
      now: '2026-06-02T00:00:00.000Z',
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    });

    assert.equal(actionBodies.length, 2);
    assert.deepEqual(requestedProofs, expectedProofs);
    assert.deepEqual(actionBodies.map((body) => body.action), ['native-os-ui-proof', 'native-os-ui-proof']);
    assert.deepEqual(actionBodies.map((body) => body.proofGroup), ['cursorCaret', 'cursorCaret']);
    assert.deepEqual(actionBodies.map((body) => body.actionId), ['focus-input-caret', 'focus-input-caret']);
    assert.deepEqual(actionBodies.map((body) => body.capture), ['none', 'none']);
    assert.deepEqual(
      actionBodies.map((body) => Array.isArray(body.expectedProofNames) ? body.expectedProofNames : []),
      [['input-caret-visible'], ['focus-blur-restore']],
    );
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.source, 'contract-fixture');
    assert.equal(manifest.proofGroups.cursorCaret.status, 'blocked');
    for (const proofName of expectedProofs) {
      assert.ok(manifest.proofGroups.cursorCaret.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/cursor-caret/${proofName}`,
      ));
      assert.ok(manifest.proofGroups.cursorCaret.auditRefs.includes(
        `real-product-os-ui-audit:m1-native-live/cursor-caret/${proofName}`,
      ));
    }
    assert.deepEqual(
      manifest.partialProofLedger?.cursorCaret.observedProofNames.filter((name) => expectedProofs.includes(name)),
      expectedProofs,
    );
    const cursorCaretAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'cursorCaret'
      && entry.actionId === 'focus-input-caret'
    ));
    assert.ok(cursorCaretAction, 'cursorCaret action ledger entry should be preserved');
    assert.equal(cursorCaretAction.status, 'partial');
    assert.equal(cursorCaretAction.rawPayloadRecorded, false);
    assert.ok(expectedProofs.every((proofName) => cursorCaretAction.observedProofNames.includes(proofName)));
    assertNoForbiddenRawKeys(manifest);
    assert.doesNotMatch(
      JSON.stringify(manifest),
      /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions|endpoint|"url"|"title"|"dom"|"text"|coords|payload|secret|"x"|"y"|screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|<html|data:image/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('trusted macOS OS UI helper keyboard action plan records bounded nativeOsUiProof names while blocked', async (t) => {
  const requestedProofs: string[] = [];
  const actionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const expectedProofNames = Array.isArray(body.expectedProofNames)
        ? body.expectedProofNames.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const requestedProofName = expectedProofNames[0] ?? String(body.action ?? '');
      requestedProofs.push(requestedProofName);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          nativeOsUiProof: {
            schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
            boundedEvidenceOnly: true,
            rawDomRecorded: false,
            rawTextRecorded: false,
            rawUrlRecorded: false,
            rawTitleRecorded: false,
            rawSelectorRecorded: false,
            rawCoordsRecorded: false,
            rawPayloadRecorded: false,
            source: 'native-embedded-action-state',
            proofGroup: 'keyboardImeClipboardSelection',
            actionId: 'verify-ime-clipboard-selection',
            observedProofNames: [requestedProofName],
            evidenceTokens: [`proof:${requestedProofName}:observed`],
            diagnostics: [`proof:${requestedProofName}:observed`],
          },
        },
        nativeOsUiProof: {
          schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
          boundedEvidenceOnly: true,
          rawDomRecorded: false,
          rawTextRecorded: false,
          rawUrlRecorded: false,
          rawTitleRecorded: false,
          rawSelectorRecorded: false,
          rawCoordsRecorded: false,
          rawPayloadRecorded: false,
          source: 'native-embedded-action-state',
          proofGroup: 'keyboardImeClipboardSelection',
          actionId: 'verify-ime-clipboard-selection',
          observedProofNames: [requestedProofName, 'cursor-foreign-proof'],
          evidenceTokens: [`proof:${requestedProofName}:observed`],
          diagnostics: [`proof:${requestedProofName}:observed`, 'clipboard-payload:secret'],
          clipboardPayload: 'secret clipboard text',
          imePayload: 'secret composition',
          selectionText: 'raw selected text',
          url: 'https://example.invalid/private',
          dom: '<textarea>secret</textarea>',
        },
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const expectedProofs = [
    'keyboard-enter-owner',
    'system-clipboard-round-trip-owner',
    'selection-range-owner',
  ];

  try {
    const manifest = await runRightPaneNativeOsUiMacosObserver({
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_CURSOR_CARET_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'keyboardImeClipboardSelection',
          mode: 'bounded-keyboard-ime-clipboard-selection',
          actions: expectedProofs,
        }),
        ...trustedHelperCommandEnv([
          '--run-id',
          'm1-native-live',
        ]),
      },
      platform: 'darwin',
      now: '2026-06-02T00:00:00.000Z',
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    });

    assert.equal(actionBodies.length, expectedProofs.length);
    assert.deepEqual(requestedProofs, expectedProofs);
    assert.deepEqual(actionBodies.map((body) => body.action), expectedProofs.map(() => 'native-os-ui-proof'));
    assert.deepEqual(actionBodies.map((body) => body.proofGroup), expectedProofs.map(() => 'keyboardImeClipboardSelection'));
    assert.deepEqual(actionBodies.map((body) => body.actionId), expectedProofs.map(() => 'verify-ime-clipboard-selection'));
    assert.ok(actionBodies.every((body) => body.capture === 'none'));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.source, 'contract-fixture');
    assert.equal(manifest.proofGroups.keyboardImeClipboardSelection.status, 'blocked');
    assert.deepEqual(
      manifest.partialProofLedger?.keyboardImeClipboardSelection.observedProofNames.filter((name) => expectedProofs.includes(name)),
      expectedProofs,
    );
    const keyboardAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'keyboardImeClipboardSelection'
      && entry.actionId === 'verify-ime-clipboard-selection'
    ));
    assert.ok(keyboardAction, 'keyboard action ledger entry should be preserved');
    assert.equal(keyboardAction.status, 'partial');
    assert.equal(keyboardAction.rawPayloadRecorded, false);
    assert.ok(expectedProofs.every((proofName) => keyboardAction.observedProofNames.includes(proofName)));
    assertNoForbiddenRawKeys(manifest);
    assert.doesNotMatch(
      JSON.stringify(manifest),
      /clipboard-payload|clipboardPayload|imePayload|selectionText|secret clipboard|secret composition|raw selected|endpoint|"url"|"dom"|"text"|payload|<textarea|https?:|data:image/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('trusted macOS OS UI helper mouse action plan accepts only bounded matching nativeOsUiProof while blocked', async (t) => {
  const requestedProofs: string[] = [];
  const actionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const requestedProofName = firstExpectedProofName(body);
      requestedProofs.push(requestedProofName);
      const canonicalActionId = RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.mouseContextMenu;
      let nativeOsUiProof: Record<string, unknown>;
      if (requestedProofName === 'right-click-context-menu-owner') {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'mouseContextMenu',
          actionId: canonicalActionId,
          observedProofNames: [requestedProofName, 'keyboard-enter-owner', 'unbounded-mouse-proof'],
          evidenceTokens: ['proof:unbounded-mouse-proof:observed'],
          includeRawArtifacts: true,
        });
      } else if (requestedProofName === 'drag-drop-owner') {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'mouseContextMenu',
          actionId: canonicalActionId,
          observedProofNames: [],
          evidenceTokens: [`proof:${requestedProofName}:observed`, 'proof:keyboard-enter-owner:observed'],
          diagnostics: [`proof:${requestedProofName}:observed`, 'full-capture-artifact:opaque'],
          includeRawArtifacts: true,
        });
      } else if (requestedProofName === 'scrollbar-thumb-owner') {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'rerenderFocus',
          actionId: RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.rerenderFocus,
          observedProofNames: [requestedProofName],
          evidenceTokens: [`proof:${requestedProofName}:observed`],
        });
      } else {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'mouseContextMenu',
          actionId: canonicalActionId,
          observedProofNames: [requestedProofName],
          evidenceTokens: [`proof:${requestedProofName}:observed`],
          overrides: {
            boundedEvidenceOnly: false,
            rawPayloadRecorded: true,
          },
        });
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          nativeOsUiProof,
        },
        nativeOsUiProof,
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const plannedProofs = [
    'right-click-context-menu-owner',
    'drag-drop-owner',
    'scrollbar-thumb-owner',
    'text-selection-range-owner',
  ];
  const expectedAcceptedProofs = [
    'right-click-context-menu-owner',
    'drag-drop-owner',
  ];

  try {
    const manifest = await runRightPaneNativeOsUiMacosObserver({
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_CURSOR_CARET_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'mouseContextMenu',
          mode: 'bounded-mouse-context-menu',
          actions: plannedProofs,
        }),
        ...trustedHelperCommandEnv([
          '--run-id',
          'm1-native-live',
        ]),
      },
      platform: 'darwin',
      now: '2026-06-02T00:00:00.000Z',
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    });

    assert.equal(actionBodies.length, plannedProofs.length);
    assert.deepEqual(requestedProofs, plannedProofs);
    assert.deepEqual(actionBodies.map((body) => body.action), plannedProofs.map(() => 'native-os-ui-proof'));
    assert.deepEqual(actionBodies.map((body) => body.proofGroup), plannedProofs.map(() => 'mouseContextMenu'));
    assert.deepEqual(actionBodies.map((body) => body.actionId), plannedProofs.map(() => RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.mouseContextMenu));
    assert.deepEqual(actionBodies.map((body) => body.probe), plannedProofs.map(() => 'mouse-context-menu-owner'));
    assert.ok(actionBodies.every((body) => body.capture === 'none'));
    assert.deepEqual(
      actionBodies.map((body) => Array.isArray(body.expectedProofNames) ? body.expectedProofNames : []),
      plannedProofs.map((proofName) => [proofName]),
    );
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.source, 'contract-fixture');
    assert.deepEqual(manifest.partialProofLedger?.mouseContextMenu.observedProofNames, expectedAcceptedProofs);
    for (const proofName of expectedAcceptedProofs) {
      assert.ok(manifest.proofGroups.mouseContextMenu.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/mouse-context-menu/${proofName}`,
      ));
      assert.ok(manifest.proofGroups.mouseContextMenu.auditRefs.includes(
        `real-product-os-ui-audit:m1-native-live/mouse-context-menu/${proofName}`,
      ));
    }
    for (const proofName of plannedProofs.filter((entry) => !expectedAcceptedProofs.includes(entry))) {
      assert.ok(!manifest.partialProofLedger?.mouseContextMenu.observedProofNames.includes(proofName));
      assert.ok(!manifest.proofGroups.mouseContextMenu.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/mouse-context-menu/${proofName}`,
      ));
    }
    const mouseAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'mouseContextMenu'
      && entry.actionId === RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.mouseContextMenu
    ));
    assert.ok(mouseAction, 'mouse action ledger entry should be preserved');
    assert.equal(mouseAction.status, 'partial');
    assert.equal(mouseAction.rawPayloadRecorded, false);
    assert.deepEqual(mouseAction.observedProofNames, expectedAcceptedProofs);
    assert.deepEqual(mouseAction.expectedProofNames, RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.mouseContextMenu);
    assertNoForbiddenRawKeys(manifest);
    assert.doesNotMatch(
      JSON.stringify(manifest),
      /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions|rawEndpoint|"url"|"title"|"dom"|"text"|"coords"|"payload"|"fullCaptureArtifact"|"captureArtifact"|full-capture-artifact|endpoint|screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|<section|data:image/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('trusted macOS OS UI helper rerender action plan accepts only bounded matching nativeOsUiProof while blocked', async (t) => {
  const requestedProofs: string[] = [];
  const actionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const requestedProofName = firstExpectedProofName(body);
      requestedProofs.push(requestedProofName);
      const canonicalActionId = RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.rerenderFocus;
      let nativeOsUiProof: Record<string, unknown>;
      if (requestedProofName === 'native-surface-not-detached') {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'rerenderFocus',
          actionId: canonicalActionId,
          observedProofNames: [requestedProofName, 'left-click-owner', 'unbounded-rerender-proof'],
          evidenceTokens: ['proof:unbounded-rerender-proof:observed'],
          includeRawArtifacts: true,
        });
      } else if (requestedProofName === 'focus-retained-after-rerender') {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'rerenderFocus',
          actionId: canonicalActionId,
          observedProofNames: [],
          evidenceTokens: [`proof:${requestedProofName}:observed`, 'proof:left-click-owner:observed'],
          diagnostics: [`proof:${requestedProofName}:observed`, 'full-capture-artifact:opaque'],
          includeRawArtifacts: true,
        });
      } else if (requestedProofName === 'address-bar-rerender-stable') {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'rerenderFocus',
          actionId: RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.mouseContextMenu,
          observedProofNames: [requestedProofName],
          evidenceTokens: [`proof:${requestedProofName}:observed`],
        });
      } else {
        nativeOsUiProof = boundedNativeOsUiProofFixture({
          proofGroup: 'rerenderFocus',
          actionId: canonicalActionId,
          observedProofNames: [requestedProofName],
          evidenceTokens: [`proof:${requestedProofName}:observed`],
          overrides: {
            boundedEvidenceOnly: false,
            rawTextRecorded: true,
          },
        });
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          nativeOsUiProof,
        },
        nativeOsUiProof,
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const plannedProofs = [
    'native-surface-not-detached',
    'focus-retained-after-rerender',
    'address-bar-rerender-stable',
    'tab-state-rerender-stable',
  ];
  const expectedAcceptedProofs = [
    'native-surface-not-detached',
    'focus-retained-after-rerender',
  ];

  try {
    const manifest = await runRightPaneNativeOsUiMacosObserver({
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_CURSOR_CARET_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'rerenderFocus',
          mode: 'bounded-rerender-focus',
          actions: plannedProofs,
        }),
        ...trustedHelperCommandEnv([
          '--run-id',
          'm1-native-live',
        ]),
      },
      platform: 'darwin',
      now: '2026-06-02T00:00:00.000Z',
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    });

    assert.equal(actionBodies.length, plannedProofs.length);
    assert.deepEqual(requestedProofs, plannedProofs);
    assert.deepEqual(actionBodies.map((body) => body.action), plannedProofs.map(() => 'native-os-ui-proof'));
    assert.deepEqual(actionBodies.map((body) => body.proofGroup), plannedProofs.map(() => 'rerenderFocus'));
    assert.deepEqual(actionBodies.map((body) => body.actionId), plannedProofs.map(() => RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.rerenderFocus));
    assert.deepEqual(actionBodies.map((body) => body.probe), plannedProofs.map(() => 'bounded-rerender-focus'));
    assert.ok(actionBodies.every((body) => body.capture === 'none'));
    assert.deepEqual(
      actionBodies.map((body) => Array.isArray(body.expectedProofNames) ? body.expectedProofNames : []),
      plannedProofs.map((proofName) => [proofName]),
    );
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.source, 'contract-fixture');
    assert.deepEqual(manifest.partialProofLedger?.rerenderFocus.observedProofNames, expectedAcceptedProofs);
    for (const proofName of expectedAcceptedProofs) {
      assert.ok(manifest.proofGroups.rerenderFocus.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/rerender-focus/${proofName}`,
      ));
      assert.ok(manifest.proofGroups.rerenderFocus.auditRefs.includes(
        `real-product-os-ui-audit:m1-native-live/rerender-focus/${proofName}`,
      ));
    }
    for (const proofName of plannedProofs.filter((entry) => !expectedAcceptedProofs.includes(entry))) {
      assert.ok(!manifest.partialProofLedger?.rerenderFocus.observedProofNames.includes(proofName));
      assert.ok(!manifest.proofGroups.rerenderFocus.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/rerender-focus/${proofName}`,
      ));
    }
    const rerenderAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'rerenderFocus'
      && entry.actionId === RIGHT_PANE_NATIVE_OS_UI_ACTION_IDS.rerenderFocus
    ));
    assert.ok(rerenderAction, 'rerender action ledger entry should be preserved');
    assert.equal(rerenderAction.status, 'partial');
    assert.equal(rerenderAction.rawPayloadRecorded, false);
    assert.deepEqual(rerenderAction.observedProofNames, expectedAcceptedProofs);
    assert.deepEqual(rerenderAction.expectedProofNames, RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES.rerenderFocus);
    assertNoForbiddenRawKeys(manifest);
    assert.doesNotMatch(
      JSON.stringify(manifest),
      /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions|rawEndpoint|"url"|"title"|"dom"|"text"|"coords"|"payload"|"fullCaptureArtifact"|"captureArtifact"|full-capture-artifact|endpoint|screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|<section|data:image/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('trusted macOS OS UI helper ignores nativeOsUiProof names with mismatched proof group or action id', async (t) => {
  const actionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const requestedProofName = Array.isArray(body.expectedProofNames)
        ? body.expectedProofNames.find((entry): entry is string => typeof entry === 'string') ?? ''
        : '';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          nativeOsUiProof: {
            schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
            boundedEvidenceOnly: true,
            rawDomRecorded: false,
            rawTextRecorded: false,
            rawUrlRecorded: false,
            rawTitleRecorded: false,
            rawSelectorRecorded: false,
            rawCoordsRecorded: false,
            rawPayloadRecorded: false,
            source: 'native-embedded-action-state',
            proofGroup: 'cursorCaret',
            actionId: 'focus-input-caret',
            observedProofNames: [requestedProofName],
            evidenceTokens: [`proof:${requestedProofName}:observed`],
            diagnostics: [`proof:${requestedProofName}:observed`],
          },
        },
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;

  try {
    const manifest = await runRightPaneNativeOsUiMacosObserver({
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_CURSOR_CARET_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'keyboardImeClipboardSelection',
          mode: 'bounded-keyboard-ime-clipboard-selection',
          actions: ['keyboard-enter-owner'],
        }),
        ...trustedHelperCommandEnv([
          '--run-id',
          'm1-native-live',
        ]),
      },
      platform: 'darwin',
      now: '2026-06-02T00:00:00.000Z',
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    });

    const nativeProofBodies = actionBodies.filter((body) => body.action === 'native-os-ui-proof');
    assert.equal(nativeProofBodies.length, 1);
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.partialProofLedger?.keyboardImeClipboardSelection.status, 'not-observed');
    assert.ok(!manifest.partialProofLedger?.keyboardImeClipboardSelection.observedProofNames.includes('keyboard-enter-owner'));
    const keyboardAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'keyboardImeClipboardSelection'
      && entry.actionId === 'verify-ime-clipboard-selection'
    ));
    assert.ok(keyboardAction, 'keyboard action ledger entry should be present');
    assert.equal(keyboardAction.status, 'blocked');
    assert.ok(!keyboardAction.observedProofNames.includes('keyboard-enter-owner'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('trusted macOS OS UI helper via process execPath import tsx remains proof incomplete until complete real proof exists', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        '--import',
        'tsx',
        'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assertTrustedHelperProofIncompleteProofGroups(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);
});

async function tryListenOnLoopback(server: ReturnType<typeof createServer>): Promise<boolean> {
  return new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => resolve(true));
  });
}

function cursorForProbe(body: Record<string, unknown>): 'pointer' | 'default' | 'text' {
  if (body.x === 11) return 'pointer';
  if (body.x === 31) return 'text';
  return 'default';
}

function firstExpectedProofName(body: Record<string, unknown>): string {
  return Array.isArray(body.expectedProofNames)
    ? body.expectedProofNames.find((entry): entry is string => typeof entry === 'string') ?? ''
    : '';
}

function boundedNativeOsUiProofFixture(input: {
  proofGroup: keyof typeof RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES;
  actionId: string;
  observedProofNames?: string[];
  evidenceTokens?: string[];
  diagnostics?: string[];
  includeRawArtifacts?: boolean;
  overrides?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
    boundedEvidenceOnly: true,
    rawDomRecorded: false,
    rawTextRecorded: false,
    rawUrlRecorded: false,
    rawTitleRecorded: false,
    rawSelectorRecorded: false,
    rawCoordsRecorded: false,
    rawPayloadRecorded: false,
    source: 'native-embedded-action-state',
    proofGroup: input.proofGroup,
    actionId: input.actionId,
    observedProofNames: input.observedProofNames ?? [],
    evidenceTokens: input.evidenceTokens ?? [],
    diagnostics: input.diagnostics ?? [],
    ...(input.includeRawArtifacts ? rawNativeOsUiArtifactFixtureFields() : {}),
    ...(input.overrides ?? {}),
  };
}

function rawNativeOsUiArtifactFixtureFields(): Record<string, unknown> {
  return {
    rawEndpoint: 'http://127.0.0.1:9999/api/sciforge/browser-host/sessions/m1-native-live/actions',
    url: 'https://example.invalid/private',
    title: 'private fixture title',
    dom: '<section data-private="opaque">raw fixture markup</section>',
    text: 'raw fixture visible text',
    coords: { x: 11, y: 12 },
    payload: { artifact: 'opaque-private-data' },
    fullCaptureArtifact: 'data:image/png;base64,opaque',
    captureArtifact: 'screenshot:opaque-capture',
  };
}

test('macOS native OS UI observer keeps metadata probe diagnostic blocked without real OS UI proof', async () => {
  const manifest = await runRightPaneNativeOsUiMacosObserver({
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        '-e',
        `process.stdout.write(JSON.stringify({
          source: 'macos-accessibility-metadata-probe',
          runId: 'm1-native-live',
          accessibilityTrusted: true,
          frontmostApplicationCount: 1,
          windowCount: 2,
          focusedElementPresent: true,
          caretCandidateCount: 1,
          contextMenuCandidateCount: 1,
          keyboardFocusCandidateCount: 1,
          rerenderFocusCandidateCount: 1
        }))`,
      ]),
    },
    platform: 'darwin',
    now: '2026-06-02T00:00:00.000Z',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assert.ok(manifest.proofGroups.cursorCaret.proofRefs.every((ref) => ref.startsWith('browser-host-session:m1-native-live/')));
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

function trustedHelperCommandEnv(extraArgs: string[] = []): Record<string, string> {
  return {
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
      '--import',
      'tsx',
      'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
      ...extraArgs,
    ]),
  };
}

function realProductManifest(overrides: Partial<RightPaneNativeOsUiRunManifest>): RightPaneNativeOsUiRunManifest {
  const base: RightPaneNativeOsUiRunManifest = {
    schemaVersion: 'sciforge.browser.right-pane-native-os-ui-run.v1',
    status: 'passed',
    passClaim: true,
    runner: 'right-pane-native-os-ui-run',
    source: 'real-product-os-ui-run',
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    observedAt: '2026-06-02T00:00:00.000Z',
    refsFirst: true,
    boundedEvidenceOnly: true,
    osObserver: {
      status: 'available',
      observerRef: 'real-product-os-ui-run:m1-native-live/macos-accessibility',
      observerKind: 'macos-accessibility',
    },
    browserHostActionChannel: missingBrowserHostActionChannel(),
    proofGroups: {
      cursorCaret: passedGroup('cursor'),
      mouseContextMenu: passedGroup('menu'),
      keyboardImeClipboardSelection: passedGroup('selection'),
      rerenderFocus: passedGroup('focus'),
    },
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
    osUiRun: {
      runRef: 'real-product-os-ui-run:m1-native-live/run',
      auditRefs: ['real-product-os-ui-audit:m1-native-live/audit'],
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
    },
  };
  return { ...base, ...overrides };
}

function passedGroup(area: string): RightPaneNativeOsUiRunManifest['proofGroups']['cursorCaret'] {
  return {
    status: 'passed',
    proofRefs: [`real-product-os-ui-run:m1-native-live/${area}`],
    auditRefs: [`real-product-os-ui-audit:m1-native-live/${area}`],
  };
}

function assertBuiltInObserverDiagnosticProofGroups(manifest: RightPaneNativeOsUiRunManifest): void {
  for (const group of Object.values(manifest.proofGroups)) {
    assert.equal(group.status, 'blocked');
    assert.ok(group.proofRefs.some((ref) => ref.includes('/macos-accessibility-observer/diagnostic-probe/')));
    assert.ok(group.auditRefs.some((ref) => ref.includes('/macos-accessibility-observer/diagnostic-probe/')));
  }
}

function assertTrustedHelperProvenanceMissingProofGroups(manifest: RightPaneNativeOsUiRunManifest): void {
  for (const group of Object.values(manifest.proofGroups)) {
    assert.equal(group.status, 'blocked');
    assert.ok(group.proofRefs.some((ref) => ref.includes('/macos-accessibility-observer/trusted-helper-provenance-missing')));
    assert.ok(group.auditRefs.some((ref) => ref.includes('/macos-accessibility-observer/trusted-helper-provenance-missing/audit')));
  }
}

function assertTrustedHelperProofIncompleteProofGroups(manifest: RightPaneNativeOsUiRunManifest): void {
  for (const group of Object.values(manifest.proofGroups)) {
    assert.equal(group.status, 'blocked');
    assert.ok(group.proofRefs.some((ref) => ref.includes('/macos-accessibility-observer/trusted-helper-proof-incomplete')));
    assert.ok(group.auditRefs.some((ref) => ref.includes('/macos-accessibility-observer/trusted-helper-proof-incomplete/audit')));
  }
}

function assertNoForbiddenRawKeys(value: unknown, path: string[] = []): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenRawKeys(entry, [...path, String(index)]));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== false && entry !== undefined && entry !== null) {
      const normalized = key.toLowerCase();
      assert.ok(
        ![
          'title',
          'text',
          'url',
          'dom',
          'screenshot',
          'clipboard',
          'menulabel',
          'selectiontext',
          'providerpayload',
          'secret',
        ].includes(normalized),
        `forbidden raw key ${[...path, key].join('.')}`,
      );
    }
    assertNoForbiddenRawKeys(entry, [...path, key]);
  }
}
