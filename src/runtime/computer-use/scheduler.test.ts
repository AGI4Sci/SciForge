import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computerUseStaleEvidenceInvalidationForAction,
  leaseScopesConflict,
  scheduleComputerUseActionProposals,
  validateComputerUseScopedAction,
} from './scheduler.js';
import type { ComputerUseLeaseScope, ComputerUseObserveBeforeMutateEvidence, GenericVisionAction, ResolvedWindowTarget } from './types.js';

test('scheduler orders actor proposals deterministically and serializes window-local lease conflicts', () => {
  const target = resolvedWindowTarget();
  const queue = scheduleComputerUseActionProposals([
    {
      id: 'proposal-b',
      action: {
        type: 'type_text',
        text: 'second',
        observeBeforeMutate: observeEvidence(),
        actorId: 'actor-b',
        cursorId: 'cursor-b',
      },
      targetResolution: target,
      submittedAt: '2026-05-31T10:00:00.000Z',
      sequence: 2,
    },
    {
      id: 'proposal-a',
      action: {
        type: 'click',
        x: 10,
        y: 20,
        targetDescription: 'Search field',
        grounding: { coordinateSpace: 'window-local' },
        observeBeforeMutate: observeEvidence(),
        actorId: 'actor-a',
        cursorId: 'cursor-a',
      },
      targetResolution: target,
      submittedAt: '2026-05-31T10:00:00.000Z',
      sequence: 1,
    },
  ], { now: '2026-05-31T10:00:01.000Z' });

  assert.deepEqual(queue.deterministicOrder, ['proposal-a', 'proposal-b']);
  assert.equal(queue.entries[0]?.status, 'ready');
  assert.equal(queue.entries[0]?.leaseScope?.kind, 'window-local');
  assert.equal(queue.entries[0]?.provenance.actorId, 'actor-a');
  assert.equal(queue.entries[0]?.provenance.cursorId, 'cursor-a');
  assert.equal(queue.entries[1]?.status, 'queued');
  assert.match(queue.entries[1]?.reason ?? '', /waiting-for-lease/);
});

test('scheduler stops high-risk actions for approval and does not create executor events', () => {
  const target = resolvedWindowTarget();
  const queue = scheduleComputerUseActionProposals([
    {
      id: 'send-click',
      action: {
        type: 'click',
        x: 30,
        y: 40,
        targetDescription: 'Send message button',
        grounding: { coordinateSpace: 'window-local' },
        observeBeforeMutate: observeEvidence(),
        riskLevel: 'high',
        requiresConfirmation: true,
      },
      targetResolution: target,
      submittedAt: '2026-05-31T10:00:00.000Z',
    },
    {
      id: 'follow-up-type',
      action: { type: 'type_text', text: 'should wait', observeBeforeMutate: observeEvidence() },
      targetResolution: target,
      submittedAt: '2026-05-31T10:00:01.000Z',
    },
  ], { now: '2026-05-31T10:00:02.000Z' });

  assert.equal(queue.entries[0]?.status, 'needs-confirmation');
  assert.equal(queue.entries[0]?.executorEventRef, undefined);
  assert.equal(queue.entries[0]?.blocksFollowingActions, true);
  assert.equal(queue.entries[1]?.status, 'queued');
  assert.match(queue.entries[1]?.reason ?? '', /approval-stop/);
});

test('scheduler records cancellation, timeout, denial, and bare-global-coordinate rejection reasons', () => {
  const target = resolvedWindowTarget();
  const displayTarget: ResolvedWindowTarget = {
    ...target,
    captureKind: 'display',
    windowId: undefined,
    virtualWindowId: undefined,
    coordinateSpace: 'screen',
    schedulerLockId: 'screen-1',
  };
  const explicitWindowScope: ComputerUseLeaseScope = {
    kind: 'window-local',
    displayGroupId: 'display-group-main',
    screenId: 'screen-main',
    windowId: 'window-101',
  };
  const queue = scheduleComputerUseActionProposals([
    {
      id: 'cancelled',
      action: { type: 'type_text', text: 'cancel me', observeBeforeMutate: observeEvidence() },
      targetResolution: target,
      cancelReason: 'user-cancelled',
    },
    {
      id: 'timed-out',
      action: { type: 'press_key', key: 'Enter', observeBeforeMutate: observeEvidence() },
      targetResolution: target,
      timeoutAt: '2026-05-31T09:59:00.000Z',
    },
    {
      id: 'denied',
      action: { type: 'click', targetDescription: 'Delete', riskLevel: 'high', observeBeforeMutate: observeEvidence() },
      targetResolution: target,
      approvalState: 'denied',
    },
    {
      id: 'bare-global',
      action: {
        type: 'click',
        x: 200,
        y: 100,
        displayGroupId: 'display-group-main',
        screenId: 'screen-main',
        windowId: 'window-101',
        leaseScope: explicitWindowScope,
        observeBeforeMutate: observeEvidence(),
      },
      targetResolution: displayTarget,
    },
  ], { now: '2026-05-31T10:00:00.000Z' });

  assert.equal(queue.entries.find((entry) => entry.proposalId === 'cancelled')?.status, 'cancelled');
  assert.match(queue.entries.find((entry) => entry.proposalId === 'cancelled')?.reason ?? '', /user-cancelled/);
  assert.equal(queue.entries.find((entry) => entry.proposalId === 'timed-out')?.status, 'timed-out');
  assert.match(queue.entries.find((entry) => entry.proposalId === 'timed-out')?.reason ?? '', /timeout/);
  assert.equal(queue.entries.find((entry) => entry.proposalId === 'denied')?.status, 'rejected');
  assert.match(queue.entries.find((entry) => entry.proposalId === 'denied')?.reason ?? '', /approval-denied/);
  assert.equal(queue.entries.find((entry) => entry.proposalId === 'bare-global')?.status, 'rejected');
  assert.match(queue.entries.find((entry) => entry.proposalId === 'bare-global')?.reason ?? '', /bare-global-coordinate-blocked/);

  const nakedGlobal = validateComputerUseScopedAction({
    action: { type: 'click', x: 1, y: 2 },
    targetResolution: displayTarget,
  });
  assert.equal(nakedGlobal.ok, false);
  assert.match(nakedGlobal.ok ? '' : nakedGlobal.reason, /bare-global-coordinate-blocked/);
});

test('scheduler invalidates only visible evidence for mutating scoped actions', () => {
  const target = resolvedWindowTarget();
  const action: GenericVisionAction = {
    type: 'click',
    x: 10,
    y: 20,
    targetDescription: 'Search field',
    grounding: { coordinateSpace: 'window-local' },
    observeBeforeMutate: observeEvidence(),
  };
  const decision = validateComputerUseScopedAction({
    action,
    targetResolution: target,
    now: '2026-05-31T10:00:01.000Z',
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.status, 'ready');
  assert.equal(decision.leaseScope.kind, 'window-local');
  assert.equal(decision.staleEvidenceInvalidation?.invalidatesVisibleState, true);
  assert.deepEqual(decision.staleEvidenceInvalidation?.staleEvidenceKinds, [
    'observation',
    'region',
    'text',
    'visual-object',
    'vlm-claim',
    'grounding',
  ]);
  assert.deepEqual(decision.staleEvidenceInvalidation?.preservedEvidenceKinds, [
    'artifact',
    'verification',
    'completion-claim',
  ]);

  const waitInvalidation = computerUseStaleEvidenceInvalidationForAction({ type: 'wait', ms: 50 }, decision.leaseScope);
  assert.equal(waitInvalidation, undefined);
});

test('lease conflict rules distinguish screen-global and window-local scopes', () => {
  const screen: ComputerUseLeaseScope = {
    kind: 'screen-global',
    displayGroupId: 'dg',
    screenId: 'screen-1',
  };
  const windowA: ComputerUseLeaseScope = {
    kind: 'window-local',
    displayGroupId: 'dg',
    screenId: 'screen-1',
    windowId: 'window-a',
  };
  const windowB: ComputerUseLeaseScope = {
    kind: 'window-local',
    displayGroupId: 'dg',
    screenId: 'screen-1',
    windowId: 'window-b',
  };

  assert.equal(leaseScopesConflict(screen, windowA), true);
  assert.equal(leaseScopesConflict(windowA, screen), true);
  assert.equal(leaseScopesConflict(windowA, windowA), true);
  assert.equal(leaseScopesConflict(windowA, windowB), false);
  assert.equal(leaseScopesConflict(windowA, windowB, { sameScreenWindowLocal: 'screen-serial' }), true);
});

test('scheduler defaults native executor leases to same-screen serial while allowing cross-screen lanes', () => {
  const windowA = resolvedWindowTarget();
  const windowB: ResolvedWindowTarget = {
    ...windowA,
    windowId: 202,
    virtualWindowId: 'window-202',
    schedulerLockId: 'remote-session-202',
    target: {
      ...windowA.target,
      windowId: 202,
      virtualWindowId: 'window-202',
    },
  };
  const screenB: ResolvedWindowTarget = {
    ...windowA,
    displayGroupId: 'display-group-main',
    screenId: 'screen-sidecar',
    displayId: 2,
    windowId: 303,
    virtualWindowId: 'window-303',
    schedulerLockId: 'remote-session-303',
    target: {
      ...windowA.target,
      displayGroupId: 'display-group-main',
      screenId: 'screen-sidecar',
      windowId: 303,
      virtualWindowId: 'window-303',
    },
  };
  const proposals = [
    {
      id: 'window-a-click',
      action: { type: 'click', x: 10, y: 10, observeBeforeMutate: observeEvidence(), actorId: 'actor-a', cursorId: 'cursor-a' } as GenericVisionAction,
      targetResolution: windowA,
      sequence: 1,
    },
    {
      id: 'window-b-click',
      action: {
        type: 'click',
        x: 20,
        y: 20,
        observeBeforeMutate: observeEvidence({ windowId: 'window-202' }),
        actorId: 'actor-b',
        cursorId: 'cursor-b',
      } as GenericVisionAction,
      targetResolution: windowB,
      sequence: 2,
    },
    {
      id: 'screen-b-click',
      action: {
        type: 'click',
        x: 30,
        y: 30,
        observeBeforeMutate: observeEvidence({ screenId: 'screen-sidecar', windowId: 'window-303' }),
        actorId: 'actor-c',
        cursorId: 'cursor-c',
      } as GenericVisionAction,
      targetResolution: screenB,
      sequence: 3,
    },
  ];

  const nativeQueue = scheduleComputerUseActionProposals(proposals, { now: '2026-05-31T10:00:01.000Z' });
  assert.equal(nativeQueue.entries.find((entry) => entry.proposalId === 'window-a-click')?.status, 'ready');
  assert.equal(nativeQueue.entries.find((entry) => entry.proposalId === 'window-b-click')?.status, 'queued');
  assert.match(nativeQueue.entries.find((entry) => entry.proposalId === 'window-b-click')?.reason ?? '', /waiting-for-lease/);
  assert.equal(nativeQueue.entries.find((entry) => entry.proposalId === 'screen-b-click')?.status, 'ready');

  const parallelQueue = scheduleComputerUseActionProposals(proposals, {
    now: '2026-05-31T10:00:01.000Z',
    executorLeaseConflictPolicy: 'window-local-parallel',
  });
  assert.equal(parallelQueue.entries.find((entry) => entry.proposalId === 'window-b-click')?.status, 'ready');
});

test('scheduler returns needs-observation when mutating action lacks current refs', () => {
  const target = resolvedWindowTarget();
  const decision = validateComputerUseScopedAction({
    action: {
      type: 'click',
      x: 10,
      y: 20,
      targetDescription: 'Search field',
      grounding: { coordinateSpace: 'window-local' },
    },
    targetResolution: target,
    now: '2026-05-31T10:00:00.000Z',
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.status, 'needs-observation');
  assert.match(decision.reason, /appStateRef/);
  assert.equal(decision.schedulerDecisionRefs?.mutatingActionExecuted, false);
  assert.match(decision.schedulerDecisionRefs?.blockedManifestRef ?? '', /scheduler-blocked-manifest/);
});

test('scheduler blocks observe-before-mutate scope mismatches and stale freshness checks', () => {
  const target = resolvedWindowTarget();
  const mismatch = validateComputerUseScopedAction({
    action: {
      type: 'type_text',
      text: 'wrong scope',
      observeBeforeMutate: {
        ...observeEvidence(),
        windowId: 'window-other',
      },
    },
    targetResolution: target,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 'blocked');
  assert.match(mismatch.reason, /scope mismatch/);

  const stale = validateComputerUseScopedAction({
    action: {
      type: 'scroll',
      direction: 'down',
      observeBeforeMutate: {
        ...observeEvidence(),
        observedAt: '2026-05-31T09:00:00.000Z',
        freshnessCheck: {
          status: 'stale',
          observedAt: '2026-05-31T09:00:00.000Z',
          checkedAt: '2026-05-31T09:00:00.000Z',
          reason: 'visible state was invalidated by prior executor event',
        },
      },
    },
    targetResolution: target,
    now: '2026-05-31T10:00:00.000Z',
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 'needs-observation');
  assert.match(stale.reason, /invalidated/);
});

test('scheduler stop signal cancels lease and blocks following same-screen proposals without executor mutation', () => {
  const target = resolvedWindowTarget();
  const queue = scheduleComputerUseActionProposals([
    {
      id: 'cancel-active',
      action: { type: 'type_text', text: 'do not type', observeBeforeMutate: observeEvidence() },
      targetResolution: target,
      submittedAt: '2026-05-31T10:00:00.000Z',
    },
    {
      id: 'after-cancel',
      action: { type: 'click', targetDescription: 'Still should not click', observeBeforeMutate: observeEvidence() },
      targetResolution: target,
      submittedAt: '2026-05-31T10:00:01.000Z',
    },
  ], {
    now: '2026-05-31T10:00:02.000Z',
    stopSignal: {
      aborted: true,
      reason: 'user pressed stop',
      proposalIds: ['cancel-active'],
      screenId: 'screen-main',
      displayGroupId: 'display-group-main',
    },
  });

  assert.equal(queue.entries[0]?.status, 'cancelled');
  assert.match(queue.entries[0]?.reason ?? '', /user pressed stop/);
  assert.match(queue.entries[0]?.executorEventRef ?? '', /aborted/);
  assert.equal(queue.entries[0]?.schedulerDecisionRefs?.mutatingActionExecuted, false);
  assert.equal(queue.entries[0]?.schedulerDecisionRefs?.status, 'aborted');
  assert.match(queue.entries[0]?.schedulerDecisionRefs?.blockedManifestRef ?? '', /scheduler-blocked-manifest/);
  assert.ok(queue.entries[0]?.schedulerDecisionRefs?.traceRefs.length);
  assert.ok(queue.entries[0]?.schedulerDecisionRefs?.replayRefs.length);
  assert.equal(queue.entries[1]?.status, 'cancelled');
  assert.match(queue.entries[1]?.reason ?? '', /queue execution is blocked/);
});

function resolvedWindowTarget(): ResolvedWindowTarget {
  return {
    ok: true,
    target: {
      enabled: true,
      required: true,
      mode: 'app-window',
      displayGroupId: 'display-group-main',
      screenId: 'screen-main',
      windowId: 101,
      virtualWindowId: 'window-101',
      appName: 'Remote Session',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    },
    captureKind: 'window',
    displayGroupId: 'display-group-main',
    screenId: 'screen-main',
    windowId: 101,
    virtualWindowId: 'window-101',
    appName: 'Remote Session',
    title: 'Independent session',
    displayId: 1,
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
    schedulerLockId: 'remote-session-101',
    source: 'config',
    diagnostics: [],
  };
}

function observeEvidence(overrides: Partial<ComputerUseObserveBeforeMutateEvidence> = {}): ComputerUseObserveBeforeMutateEvidence {
  return {
    appStateRef: '.sciforge/vision-runs/run-1/step-001-before-app-state.json',
    screenshotRef: '.sciforge/vision-runs/run-1/step-001-before-display-1.png',
    captureRef: '.sciforge/vision-runs/run-1/step-001-before-display-1.png',
    accessibilitySnapshotRef: '.sciforge/vision-runs/run-1/step-001-before-accessibility-state.json',
    stateSnapshotRef: '.sciforge/vision-runs/run-1/step-001-before-app-state.json',
    groundingRef: '.sciforge/vision-runs/run-1/step-001-grounding.json',
    sourceObservationRef: '.sciforge/vision-runs/run-1/step-001-before-display-1.png',
    displayGroupId: 'display-group-main',
    screenId: 'screen-main',
    windowId: 'window-101',
    observedAt: '2026-05-31T10:00:00.000Z',
    capturedAt: '2026-05-31T10:00:00.000Z',
    freshnessCheckedAt: '2026-05-31T10:00:00.000Z',
    freshnessCheck: {
      status: 'current',
      observedAt: '2026-05-31T10:00:00.000Z',
      checkedAt: '2026-05-31T10:00:00.000Z',
      maxAgeMs: 30_000,
    },
    ...overrides,
  };
}
