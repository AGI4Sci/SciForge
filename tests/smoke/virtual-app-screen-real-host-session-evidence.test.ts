import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVirtualAppScreenUserAcceptanceManifest,
} from '../../tools/virtual-app-screen-user-acceptance-manifest.js';
import {
  buildVirtualAppScreenRealHostSessionEvidenceManifest,
  VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
} from '../../tools/virtual-app-screen-real-host-session-evidence.js';
import type {
  VirtualAppScreenInputRuntimeProjection,
} from '../../src/runtime/computer-use/virtual-app-screen-input-runtime.js';
import type {
  VirtualAppScreenSessionManagerAttachResult,
} from '../../src/runtime/computer-use/virtual-app-screen-session-manager.js';

test('real Host session evidence projects opt-in attach/input/control into dogfood and user-acceptance refs', () => {
  const manifest = buildVirtualAppScreenRealHostSessionEvidenceManifest({
    runId: 'linux-xpra-real-session',
    platformProvider: 'linux-xpra',
    targetAppProfile: 'vscode-editor',
    userIntent: 'Open a real app session, type a marker, pause automation, and resume after a fresh frame.',
    createdAt: '2026-06-03T00:00:00.000Z',
    attach: attachedResult(),
    input: inputResult(),
    takeover: takeoverResult(),
    resume: resumeResult(),
    stop: stopSessionResult(),
  });

  assert.equal(manifest.schemaVersion, VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.diagnosticOnly, false);
  assert.equal(manifest.dogfoodRefs.diagnosticOnly, false);
  assert.equal(manifest.dogfoodRefs.realHostProviderSessionRef, 'computer-use:native-host/real-provider-sessions/linux-xpra-real-session/session.json');
  assert.equal(manifest.dogfoodRefs.realOptInRunRef, 'computer-use:native-host/real-opt-in-runs/linux-xpra-real-session/run.json');
  assert.ok(manifest.dogfoodRefs.realPlatformEvidenceRefs?.some((ref) => ref.endsWith('/diagnostic-only-false.json')));
  assert.ok(manifest.dogfoodRefs.inputAcceptedRefs?.includes('computer-use:native-host/inputs/session-1/0001-type-text.json'));
  assert.ok(manifest.dogfoodRefs.automationBarrierRefs?.includes('computer-use:native-host/provider-adapter-control/session-1/pause/agent-queue.json'));
  assert.deepEqual(manifest.dogfoodRefs.closeSessionRefs, [
    'computer-use:native-host/provider-adapter-control/session-1/close/agent-queue.json',
    'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0010-session.closed.json',
  ]);
  assert.deepEqual(manifest.dogfoodRefs.safeStopRefs, [
    'computer-use:native-host/provider-adapter-control/session-1/close/safe-stop.json',
  ]);
  assert.deepEqual(manifest.dogfoodRefs.realAgentQueueEvidenceRefs, [
    'computer-use:native-host/provider-adapter-control/session-1/pause/agent-queue.json',
    'computer-use:native-host/provider-adapter-control/session-1/resume/agent-queue.json',
    'computer-use:native-host/provider-adapter-control/session-1/resume/current-frame-refresh.json',
  ]);
  assert.ok(manifest.dogfoodRefs.backgroundEvidenceRefs?.includes('computer-use:native-host/surfaces/surface-1/frame-stream.json'));
  assert.ok((manifest.dogfoodRefs.minimalEvidenceReplayRefs ?? []).some((ref) => ref.includes('agent.resumed')));
  assert.ok((manifest.dogfoodRefs.minimalEvidenceReplayRefs ?? []).some((ref) => ref.includes('session.closed')));

  const acceptance = buildVirtualAppScreenUserAcceptanceManifest(manifest.userAcceptanceInput);
  assert.equal(acceptance.status, 'passed');
  assert.equal(acceptance.userAcceptanceEligible, true);
  assert.equal(acceptance.diagnosticOnly, false);
  assert.ok(acceptance.evidenceClaims?.[0]?.evidenceRefs?.includes('computer-use:native-host/provider-adapter-control/session-1/close/safe-stop.json'));
});

test('real Host session evidence blocks missing resume proof instead of fabricating a dogfood pass', () => {
  const manifest = buildVirtualAppScreenRealHostSessionEvidenceManifest({
    runId: 'linux-xpra-real-session-no-resume',
    platformProvider: 'linux-xpra',
    createdAt: '2026-06-03T00:00:00.000Z',
    attach: attachedResult(),
    input: inputResult(),
    takeover: takeoverResult(),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.dogfoodRefs.diagnosticOnly, false);
  assert.match(manifest.blockedReason ?? '', /resume proof is required/);
  assert.match(manifest.blockedReason ?? '', /real agent queue evidence is required/);
  const acceptance = buildVirtualAppScreenUserAcceptanceManifest(manifest.userAcceptanceInput);
  assert.equal(acceptance.status, 'blocked');
});

function attachedResult(): VirtualAppScreenSessionManagerAttachResult {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-session-manager.v1',
    status: 'attached',
    executorId: 'native-session-manager:linux-xpra-real-human-input-opt-in-smoke',
    providerId: 'virtual-display.linux.xpra',
    refs: {
      currentRunRef: '.sciforge/vision-runs/linux-xpra-real-session/current-run.json',
      currentRunPointerRef: 'computer-use:native-host/runs/session-1/current-run-pointer.json',
      sessionRef: 'computer-use:native-host/sessions/session-1/session.json',
      liveSurfaceRef: 'computer-use:native-host/surfaces/surface-1/live-surface.json',
      surfaceTransportRef: 'computer-use:native-host/surfaces/surface-1/surface-transport.json',
      frameStreamRef: 'computer-use:native-host/surfaces/surface-1/frame-stream.json',
      currentFrameRef: 'computer-use:native-host/frames/session-1/current.json',
      frameTransportContractRef: 'computer-use:native-host/surfaces/surface-1/frame-transport-contract.json',
      frameTelemetryRef: 'computer-use:native-host/surfaces/surface-1/frame-telemetry.json',
      providerLifecycleSessionRef: '.sciforge/vision-runs/linux-xpra-real-session/virtual-display-provider/session.json',
      liveBindingAttachGrantRef: 'computer-use:native-host/grants/session-1/live-binding-attach-grant.json',
      grantValidationRef: 'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0004-grant.validated.json',
      surfaceOwnerRef: 'computer-use:native-host/surfaces/surface-1/surface-owner.json',
      displayOwnerRef: 'computer-use:native-host/surfaces/surface-1/display-owner.json',
      screenRef: 'virtual-app-screen:linux-xpra-real-session/screen',
      targetAppRef: 'app:profile/vscode-editor',
      targetWindowRef: 'computer-use:native-host/windows/linux-xpra-real-session/main.json',
      inputLeaseRef: 'computer-use:native-host/leases/session-1/input.json',
      actionAdapterRef: 'computer-use:native-host/action-adapters/session-1/input.json',
      adapterReadinessRef: 'computer-use:native-host/readiness/linux-xpra-real-session/provider.json',
      platformDriverRef: 'computer-use:native-host/platform-drivers/linux-xpra/ready.json',
      evidenceLedgerRef: 'computer-use:native-host/ledgers/session-1/evidence-ledger.json',
      minimalEvidenceReplayRefs: [
        'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0001-session.created.json',
        'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0003-surface.attached.json',
        'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0004-grant.validated.json',
        'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0005-frame.read.json',
      ],
      guiPresentRef: 'gui.present:linux-xpra-real-session/screen-pane',
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      platformDriverReady: true,
      backgroundRenderable: true,
      diagnosticOnly: false,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      evidenceRefs: [
        'computer-use:native-host/platform-drivers/linux-xpra/ready.json',
        'computer-use:native-host/ledgers/session-1/evidence-ledger.json',
      ],
    },
  };
}

function inputResult(): VirtualAppScreenInputRuntimeProjection {
  return executedInputResult({
    runId: 'input',
    providerOperations: ['sendInputIntent', 'readFrame'],
    inputIntentRefs: ['computer-use:native-host/input-runtime/session-1/input-intents/type.json'],
    executorEventRefs: ['computer-use:native-host/inputs/session-1/0001-type-text.json'],
    beforeAfterFrameRefs: ['computer-use:native-host/input-runtime/session-1/before-after/type.json'],
    verificationRefs: ['computer-use:native-host/input-runtime/session-1/verification/type.json'],
    evidenceRefs: [
      'computer-use:native-host/inputs/session-1/0001-type-text.json',
      'computer-use:native-host/input-runtime/session-1/verification/type.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0006-human-input.accepted.json',
    ],
    currentFrameRef: 'computer-use:native-host/frames/session-1/after-input.json',
    minimalEvidenceReplayRefs: [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0001-session.created.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0003-surface.attached.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0006-human-input.accepted.json',
    ],
  });
}

function takeoverResult(): VirtualAppScreenInputRuntimeProjection {
  return executedInputResult({
    runId: 'takeover',
    providerOperations: ['pause'],
    inputIntentRefs: ['computer-use:native-host/input-runtime/session-1/input-intents/takeover.json'],
    executorEventRefs: ['computer-use:native-host/input-runtime/session-1/control-events/takeover.json'],
    beforeAfterFrameRefs: ['computer-use:native-host/input-runtime/session-1/before-after/takeover.json'],
    verificationRefs: ['computer-use:native-host/input-runtime/session-1/verification/takeover.json'],
    evidenceRefs: ['computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0007-agent.paused.json'],
    currentFrameRef: 'computer-use:native-host/frames/session-1/after-input.json',
    agentQueueRef: 'computer-use:native-host/provider-adapter-control/session-1/pause/agent-queue.json',
    minimalEvidenceReplayRefs: [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0007-agent.paused.json',
    ],
  });
}

function resumeResult(): VirtualAppScreenInputRuntimeProjection {
  return executedInputResult({
    runId: 'resume',
    providerOperations: ['resume', 'readFrame'],
    inputIntentRefs: ['computer-use:native-host/input-runtime/session-1/input-intents/resume.json'],
    executorEventRefs: ['computer-use:native-host/input-runtime/session-1/control-events/resume.json'],
    beforeAfterFrameRefs: ['computer-use:native-host/input-runtime/session-1/before-after/resume.json'],
    verificationRefs: ['computer-use:native-host/input-runtime/session-1/verification/resume.json'],
    evidenceRefs: [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0008-agent.resumed.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0009-frame.read.json',
    ],
    currentFrameRef: 'computer-use:native-host/frames/session-1/after-resume.json',
    agentQueueRef: 'computer-use:native-host/provider-adapter-control/session-1/resume/agent-queue.json',
    currentFrameRefreshRef: 'computer-use:native-host/provider-adapter-control/session-1/resume/current-frame-refresh.json',
    minimalEvidenceReplayRefs: [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0008-agent.resumed.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0009-frame.read.json',
    ],
  });
}

function stopSessionResult(): VirtualAppScreenInputRuntimeProjection {
  return executedInputResult({
    runId: 'stop-session',
    providerOperations: ['closeSession'],
    inputIntentRefs: ['computer-use:native-host/input-runtime/session-1/input-intents/stop-session.json'],
    executorEventRefs: ['computer-use:native-host/input-runtime/session-1/control-events/stop-session.json'],
    beforeAfterFrameRefs: ['computer-use:native-host/input-runtime/session-1/before-after/stop-session.json'],
    verificationRefs: ['computer-use:native-host/input-runtime/session-1/verification/stop-session.json'],
    evidenceRefs: [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0010-session.closed.json',
    ],
    currentFrameRef: 'computer-use:native-host/frames/session-1/after-resume.json',
    agentQueueRef: 'computer-use:native-host/provider-adapter-control/session-1/close/agent-queue.json',
    safeStopRef: 'computer-use:native-host/provider-adapter-control/session-1/close/safe-stop.json',
    minimalEvidenceReplayRefs: [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0010-session.closed.json',
    ],
  });
}

function executedInputResult(input: {
  runId: string;
  providerOperations: string[];
  inputIntentRefs: string[];
  executorEventRefs: string[];
  beforeAfterFrameRefs: string[];
  verificationRefs: string[];
  evidenceRefs: string[];
  currentFrameRef: string;
  agentQueueRef?: string;
  currentFrameRefreshRef?: string;
  safeStopRef?: string;
  minimalEvidenceReplayRefs: string[];
}): VirtualAppScreenInputRuntimeProjection {
  return {
    runId: input.runId,
    status: 'executed',
    message: `${input.runId} executed`,
    executorId: 'input-runtime:linux-xpra-real-human-input-opt-in-smoke',
    providerId: 'native-virtual-app-screen-host',
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: true,
      inputIntentRecorded: true,
      executorEventRecorded: true,
      beforeAfterFrameMaterialized: true,
      verificationRecorded: true,
      evidenceLedgerRecorded: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      evidenceRefs: input.evidenceRefs,
    },
    routeDecision: {
      status: 'executed',
      providerOperations: input.providerOperations,
      inputIntentRefs: input.inputIntentRefs,
      executorEventRefs: input.executorEventRefs,
      beforeAfterFrameRefs: input.beforeAfterFrameRefs,
      verificationRefs: input.verificationRefs,
      currentFrameRef: input.currentFrameRef,
      frameRef: input.currentFrameRef,
      adapterReadinessRef: 'computer-use:native-host/readiness/linux-xpra-real-session/provider.json',
      actionAdapterRef: 'computer-use:native-host/action-adapters/session-1/input.json',
      evidenceLedgerRef: 'computer-use:native-host/ledgers/session-1/evidence-ledger.json',
      inputLeaseRef: 'computer-use:native-host/leases/session-1/input.json',
      agentQueueRef: input.agentQueueRef,
      currentFrameRefreshRef: input.currentFrameRefreshRef,
      safeStopRef: input.safeStopRef,
      currentRunPointerRef: 'computer-use:native-host/runs/session-1/current-run-pointer.json',
      minimalEvidenceReplayRefs: input.minimalEvidenceReplayRefs,
    },
    virtualScreenData: {},
  };
}
