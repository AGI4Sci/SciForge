import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computerUseExecutorBoundary,
  computerUseInputChannelContract,
  computerUseInputChannelDescription,
  computerUseRealInputBlockReason,
  computerUseSchedulerLockIdForTarget,
  computerUseSchedulerRunMetadata,
  computerUseSchedulerStepMetadata,
  computerUseSystemEventsResultLine,
  normalizeComputerUseCoordinateSpace,
  normalizeComputerUseIndependentInputAdapter,
  normalizeComputerUseInputIsolation,
  normalizeComputerUseWindowTargetMode,
} from './runtime-policy.js';

test('computer use runtime policy owns executor and adapter taxonomy', () => {
  assert.equal(computerUseExecutorBoundary('darwin'), 'darwin-system-events-generic-gui-executor');
  assert.equal(computerUseExecutorBoundary('linux desktop'), 'linux-desktop-generic-gui-executor');
  assert.equal(normalizeComputerUseIndependentInputAdapter('remote_desktop_session'), 'remote-desktop');
  assert.equal(normalizeComputerUseIndependentInputAdapter('virtual-hid-device'), 'virtual-hid');
  assert.equal(normalizeComputerUseIndependentInputAdapter('unknown'), undefined);
  assert.equal(computerUseSystemEventsResultLine('click', true), 'system-events click visualCursor=not-shown-system-events-primary');
});

test('computer use window target normalization lives in the package policy', () => {
  assert.equal(normalizeComputerUseWindowTargetMode('frontmost', {}), 'active-window');
  assert.equal(normalizeComputerUseWindowTargetMode(undefined, { windowId: 42 }), 'window-id');
  assert.equal(normalizeComputerUseWindowTargetMode(undefined, { appName: 'Finder' }), 'app-window');
  assert.equal(normalizeComputerUseCoordinateSpace(undefined, 'display'), 'screen');
  assert.equal(normalizeComputerUseCoordinateSpace('target-window', 'app-window'), 'window');
  assert.equal(normalizeComputerUseInputIsolation(undefined, true), 'require-focused-target');
  assert.equal(normalizeComputerUseInputIsolation('off', true), 'best-effort');
  assert.equal(
    computerUseSchedulerLockIdForTarget({ mode: 'app-window', appName: 'Example App', title: 'Draft' }, 42),
    'vision-window-app-window-42-example-app-draft',
  );
});

test('computer use input channel contract keeps policy strings package-owned', () => {
  const dryRun = computerUseInputChannelContract({
    desktopPlatform: 'darwin',
    dryRun: true,
    targetResolved: true,
    targetBound: true,
    isolation: 'require-focused-target',
    executorLockId: 'window-42',
  });
  assert.equal(dryRun.type, 'generic-mouse-keyboard');
  assert.equal(dryRun.pointerKeyboardOwnership, 'virtual-dry-run-channel');
  assert.equal(dryRun.userDeviceImpact, 'none');
  assert.equal(
    computerUseInputChannelDescription({
      contract: dryRun,
      targetResolved: true,
      captureKind: 'window',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    }),
    'generic-mouse-keyboard:dry-run:target-window:window-relative-grounding:require-focused-target',
  );

  const independent = computerUseInputChannelContract({
    desktopPlatform: 'darwin',
    inputAdapter: 'remote-desktop',
    targetResolved: true,
    targetBound: true,
    isolation: 'require-focused-target',
    executorLockId: 'window-42',
  });
  assert.equal(independent.currentIndependentAdapter, 'remote-desktop');
  assert.equal(independent.independentAdapterStatus, 'configured-unimplemented');
  assert.equal(independent.userDeviceImpact, 'fail-closed-unimplemented-independent-adapter');
  assert.equal(independent.failClosed, true);

  const shared = computerUseInputChannelContract({
    desktopPlatform: 'darwin',
    allowSharedSystemInput: true,
    showVisualCursor: true,
    targetResolved: true,
    targetBound: true,
    isolation: 'require-focused-target',
    executorLockId: 'shared-system-input',
  });
  assert.equal(shared.pointerKeyboardOwnership, 'shared-system-pointer-keyboard');
  assert.equal(shared.visualPointerShape, 'cyan-diamond-magenta-outline-white-crosshair');
  assert.equal(shared.executorLockScope, 'global-shared-system-input');
  assert.equal(shared.failClosed, false);
});

test('computer use scheduler and real input policies are package-owned', () => {
  const step = computerUseSchedulerStepMetadata({
    targetResolved: true,
    stepId: 'step-1',
    lockId: 'window-42',
    lockScope: 'target-window',
    captureKind: 'window',
    inputIsolation: 'require-focused-target',
    targetBound: true,
    strictFocus: true,
  });
  assert.equal(step.mode, 'serialized-window-actions');
  assert.equal(step.actionConcurrency, 'one-real-gui-action-at-a-time-per-window');
  assert.equal(step.interferenceRisk, 'low-when-focused-target-verified');

  const run = computerUseSchedulerRunMetadata({
    targetResolved: true,
    lockId: 'shared-system-input',
    lockScope: 'shared-system-input',
    sharedSystemInput: true,
    targetBound: true,
    strictFocus: true,
  });
  assert.equal(run.actionConcurrency, 'one-real-gui-action-at-a-time-globally-for-shared-system-input');

  assert.match(
    computerUseRealInputBlockReason({ actionType: 'click', desktopPlatform: 'darwin' }),
    /shared system mouse\/keyboard input was not explicitly allowed/,
  );
  assert.equal(computerUseRealInputBlockReason({ actionType: 'open_app', desktopPlatform: 'darwin' }), '');
});
