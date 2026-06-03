import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRoute,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const SCHEMA = 'sciforge.computer-use.virtual-app-screen-dogfood-product.v1' as const;
const NATIVE_HOST_SCHEMA = 'sciforge.computer-use.native-virtual-app-screen-host.v1' as const;
const DEFAULT_BOOTSTRAP_MS = 8_000;
const REAL_HOST_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST';

type DogfoodPhase =
  | 'open-sciforge'
  | 'enter-screen'
  | 'auto-provision-attach'
  | 'operate-vscode-input-intent'
  | 'human-takeover'
  | 'resume-agent'
  | 'manifest-output';

type ManifestStatus = 'passed' | 'blocked';

type DogfoodRefs = {
  hostSessionRef?: string;
  screenRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  grantValidationStatus?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  surfaceTransportRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  currentRunPointerRef?: string;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  inputLeaseRef?: string;
  activeLeaseOwnerRef?: string;
  userLeaseRef?: string;
  agentLeaseRef?: string;
  preflightRef?: string;
  preflightLedgerRef?: string;
  preflightLedgerEntryRef?: string;
  hostReadinessRef?: string;
  adapterReadinessRef?: string;
  permissionRef?: string;
  blockedRef?: string;
  handoffRef?: string;
  evidenceLedgerRef?: string;
  attachState?: string;
  status?: string;
  surfaceMode?: string;
  inputIntentReady?: boolean;
  leaseControlReady?: boolean;
  guiPresentRefs?: string[];
  inputIntentRefs?: string[];
  humanInputHotPathRefs?: string[];
  inputAcceptedRefs?: string[];
  executorEventRefs?: string[];
  beforeAfterFrameRefs?: string[];
  automationBarrierRefs?: string[];
  backgroundEvidenceRefs?: string[];
  minimalEvidenceReplayRefs?: string[];
  realAgentQueueEvidenceRefs?: string[];
  permissionRefs?: string[];
  takeoverRefs?: string[];
  pauseRefs?: string[];
  resumeRefs?: string[];
  lastCommandTexts?: string[];
  blockedReason?: string;
  diagnosticOnly?: boolean;
  realHostProviderSessionRef?: string;
  realOptInRunRef?: string;
  realPlatformEvidenceRefs?: string[];
};

type VirtualAppScreenDogfoodManifest = {
  schemaVersion: typeof SCHEMA;
  status: ManifestStatus;
  source: 'product-ui-right-pane';
  runId: string;
  observedAt: string;
  phase: DogfoodPhase;
  reason: string | null;
  nativeHost: {
    schemaVersion: typeof NATIVE_HOST_SCHEMA;
    required: true;
    status: 'ready' | 'blocked';
    failClosed: true;
    providerExecuted: false;
    hostSessionRef: string | null;
    surfaceOwnerRef: string | null;
    displayOwnerRef: string | null;
    liveSurfaceRef: string | null;
    liveBindingAttachGrantRef: string | null;
    grantValidationRef: string | null;
    surfaceTransportRef: string | null;
    frameStreamRef: string | null;
    currentFrameRef: string | null;
    currentRunPointerRef: string | null;
    evidenceLedgerRef: string | null;
    minimalEvidenceReplayRefs: string[];
    readinessRefs: string[];
    missingRequiredFields: string[];
  };
  nativeHostPreflight?: {
    status: 'ready' | 'blocked';
    preflightRef: string | null;
    preflightLedgerRef: string | null;
    preflightLedgerEntryRef: string | null;
    hostReadinessRef: string | null;
    adapterReadinessRef: string | null;
  };
  hostSessionRef: string | null;
  surfaceOwnerRef: string | null;
  displayOwnerRef: string | null;
  humanInputHotPath: {
    method: 'sendHumanInput';
    refsFirst: true;
    fireAndRelease: true;
    evidenceWillCatchUp: true;
    waitsForAutomationBarrier: false;
    waitsForAfterFrame: false;
    accepted: boolean;
    refs: string[];
  };
  inputAcceptedRefs: string[];
  automationBarrierRefs: string[];
  backgroundEvidenceRefs: string[];
  rightPane: {
    openedSciForge: boolean;
    enteredScreen: boolean;
    activationRequested: boolean;
    attachState: string | null;
    status: string | null;
    surfaceMode: string | null;
    screenRef: string | null;
    targetAppRef: string | null;
    targetWindowRef: string | null;
    sessionRef: string | null;
    guiPresentRefs: string[];
    activationCommandRefs: string[];
  };
  runtimeCommandAcceptance: {
    commandObserved: boolean;
    parsed: boolean;
    route: string | null;
    source: string | null;
    screenRef: string | null;
    targetAppRef: string | null;
    adapterReadinessRef: string | null;
    activationRef: string | null;
    targetRef: string | null;
    failClosed: true;
    providerExecuted: false;
    reason: string | null;
  };
  providerReadiness: {
    status: 'ready' | 'permission-missing' | 'adapter-unavailable' | 'blocked' | 'unknown';
    refs: string[];
  };
  permissionRefs: string[];
  lastFrameRefs: string[];
  lastInputRefs: string[];
  vscodeOperation: {
    attemptedViaInputIntent: boolean;
    commandRefs: string[];
    completed: boolean;
  };
  humanIntervention: {
    takeoverAttempted: boolean;
    resumeAttempted: boolean;
    takeoverRefs: string[];
    resumeRefs: string[];
    completed: boolean;
  };
  bounded: {
    refsFirst: true;
    rawPayloadsCaptured: false;
    providerInternalsUsed: false;
    hardcodedPageScreenshotOrUrl: false;
    sharedSystemInputUsed: false;
  };
};

test('VirtualAppScreen dogfood blocked manifest is refs-first and phase-specific', async () => {
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-blocked',
    phase: 'auto-provision-attach',
    reason: 'native VirtualDisplayProvider did not attach within the Screen bootstrap window',
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      attachState: 'blocked',
      status: 'blocked',
      surfaceMode: 'empty',
      screenRef: 'virtual-app-screen:contract/screen-request',
      targetAppRef: 'app:profile/vscode-editor',
      adapterReadinessRef: 'computer-use:screen-activation/contract/provider-readiness.json',
      handoffRef: 'computer-use:screen-activation/contract/attach-request.json',
      blockedRef: 'computer-use:screen-activation/contract/blocked/no-native-session.json',
      evidenceLedgerRef: 'ledger:computer-use/contract/screen-activation.json',
      guiPresentRefs: ['gui.present:contract/screen-pane-activation'],
      permissionRefs: ['computer-use:screen-activation/contract/permissions/accessibility.json'],
      lastCommandTexts: [[
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--profile "vscode-editor"',
        '--target-app-ref "app:profile/vscode-editor"',
        '--screen-ref "virtual-app-screen:contract/screen-request"',
        '--activation-ref "computer-use:screen-activation/contract/attach-request.json"',
        '--adapter-readiness-ref "computer-use:screen-activation/contract/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/contract/screen-activation.json"',
        '--gui-present-ref "gui.present:contract/screen-pane-activation"',
      ].join(' ')],
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.phase, 'auto-provision-attach');
  assert.equal(manifest.rightPane.activationRequested, true);
  assert.equal(manifest.runtimeCommandAcceptance.commandObserved, true);
  assert.equal(manifest.runtimeCommandAcceptance.parsed, true);
  assert.equal(manifest.runtimeCommandAcceptance.route, 'virtual-app-screen-screen-attach');
  assert.deepEqual(manifest.providerReadiness.refs, ['computer-use:screen-activation/contract/provider-readiness.json']);
  assert.deepEqual(manifest.permissionRefs, ['computer-use:screen-activation/contract/permissions/accessibility.json']);
  assert.deepEqual(manifest.lastFrameRefs, []);
  assert.deepEqual(manifest.lastInputRefs, []);
  assert.equal(manifest.nativeHost.status, 'blocked');
  assert.equal(manifest.hostSessionRef, null);
  assert.deepEqual(manifest.inputAcceptedRefs, []);
  assert.deepEqual(manifest.automationBarrierRefs, []);
  assert.deepEqual(manifest.backgroundEvidenceRefs, []);
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood manifest accepts generic permission handoff with readiness refs', () => {
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-generic-handoff',
    phase: 'auto-provision-attach',
    reason: 'generic target requires provider permission handoff before native session attach',
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      attachState: 'requires-handoff',
      status: 'requires-handoff',
      surfaceMode: 'empty',
      screenRef: 'virtual-app-screen:generic-workbench/screen-request',
      targetAppRef: 'app:profile/generic-workbench',
      adapterReadinessRef: 'computer-use:screen-activation/generic-workbench/provider-readiness.json',
      permissionRef: 'permission:macos/accessibility',
      handoffRef: 'computer-use:screen-activation/generic-workbench/permission-handoff.json',
      evidenceLedgerRef: 'ledger:computer-use/generic-workbench/screen-activation.json',
      guiPresentRefs: ['gui.present:generic-workbench/screen-pane-activation'],
      permissionRefs: ['permission:macos/accessibility'],
      lastCommandTexts: [[
        '/computer-use permission-handoff',
        '--source right-pane-screen',
        '--profile "generic-workbench"',
        '--target-app-ref "app:profile/generic-workbench"',
        '--screen-ref "virtual-app-screen:generic-workbench/screen-request"',
        '--permission-handoff-ref "computer-use:screen-activation/generic-workbench/permission-handoff.json"',
        '--permission-ref "permission:macos/accessibility"',
        '--adapter-readiness-ref "computer-use:screen-activation/generic-workbench/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/generic-workbench/screen-activation.json"',
        '--gui-present-ref "gui.present:generic-workbench/screen-pane-activation"',
      ].join(' ')],
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.runtimeCommandAcceptance.commandObserved, true);
  assert.equal(manifest.runtimeCommandAcceptance.route, 'virtual-app-screen-permission-handoff');
  assert.equal(manifest.runtimeCommandAcceptance.targetAppRef, 'app:profile/generic-workbench');
  assert.equal(manifest.runtimeCommandAcceptance.adapterReadinessRef, 'computer-use:screen-activation/generic-workbench/provider-readiness.json');
  assert.equal(manifest.runtimeCommandAcceptance.targetRef, 'computer-use:screen-activation/generic-workbench/permission-handoff.json');
  assert.deepEqual(manifest.providerReadiness.refs, ['computer-use:screen-activation/generic-workbench/provider-readiness.json']);
  assert.deepEqual(manifest.permissionRefs, ['permission:macos/accessibility']);
  assert.equal(manifest.rightPane.activationRequested, true);
  assert.equal(manifest.nativeHost.status, 'blocked');
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood blocked manifest preserves only Host-owned preflight refs as nativeHostPreflight evidence', () => {
  const placeholderManifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-placeholder-provider-readiness',
    phase: 'auto-provision-attach',
    reason: 'placeholder provider readiness is not a Host-owned preflight',
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      attachState: 'blocked',
      status: 'blocked',
      surfaceMode: 'empty',
      screenRef: 'virtual-app-screen:dogfood/screen-placeholder-preflight',
      targetAppRef: 'app:profile/vscode-editor',
      adapterReadinessRef: 'computer-use:screen-activation/dogfood/provider-readiness.json',
      preflightRef: 'computer-use:native-host/readiness/dogfood/preflight.json',
      preflightLedgerRef: 'computer-use:native-host/readiness/dogfood/preflight-ledger.json',
      preflightLedgerEntryRef: 'computer-use:native-host/readiness/dogfood/preflight-ledger.json/entries/0001-record-preflight.json',
      hostReadinessRef: 'computer-use:native-host/readiness/dogfood/host-readiness.json',
      blockedRef: 'computer-use:screen-activation/dogfood/blocked/no-native-session.json',
      evidenceLedgerRef: 'ledger:computer-use/dogfood/screen-activation.json',
      guiPresentRefs: ['gui.present:dogfood/screen-pane-activation'],
    },
  });

  assert.equal(placeholderManifest.status, 'blocked');
  assert.deepEqual(placeholderManifest.providerReadiness.refs, ['computer-use:screen-activation/dogfood/provider-readiness.json']);
  assert.equal(readNativeHostPreflight(placeholderManifest), undefined);

  const hostPreflightRefs = {
    preflightRef: 'computer-use:native-host/preflights/dogfood/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/dogfood/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/dogfood/preflight-ledger.json/entries/0001-record-preflight.json',
    hostReadinessRef: 'computer-use:native-host/preflights/dogfood/host-readiness.json',
    adapterReadinessRef: 'computer-use:native-host/preflights/dogfood/adapter-readiness.json',
  };
  const hostManifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-host-owned-preflight',
    phase: 'auto-provision-attach',
    reason: 'Host preflight completed but native session attach is still blocked',
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      attachState: 'blocked',
      status: 'blocked',
      surfaceMode: 'empty',
      screenRef: 'virtual-app-screen:dogfood/screen-host-preflight',
      targetAppRef: 'app:profile/vscode-editor',
      blockedRef: 'computer-use:native-host/preflights/dogfood/blocked/no-native-session.json',
      evidenceLedgerRef: 'computer-use:native-host/preflights/dogfood/evidence-ledger.json',
      guiPresentRefs: ['gui.present:dogfood/screen-pane-activation'],
      ...hostPreflightRefs,
    },
  });

  assert.equal(hostManifest.status, 'blocked');
  assert.deepEqual(hostManifest.providerReadiness.refs, [hostPreflightRefs.adapterReadinessRef]);
  assert.deepEqual(readNativeHostPreflight(hostManifest), {
    status: 'ready',
    preflightRef: hostPreflightRefs.preflightRef,
    preflightLedgerRef: hostPreflightRefs.preflightLedgerRef,
    preflightLedgerEntryRef: hostPreflightRefs.preflightLedgerEntryRef,
    hostReadinessRef: hostPreflightRefs.hostReadinessRef,
    adapterReadinessRef: hostPreflightRefs.adapterReadinessRef,
  });
  assertDogfoodManifest(hostManifest);
});

test('VirtualAppScreen dogfood attached manifest without Native Host refs remains blocked', () => {
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-attached-without-native-host',
    phase: 'operate-vscode-input-intent',
    reason: 'attached screen lacks Native Host owner/input/barrier/background evidence refs',
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      attachState: 'attached',
      status: 'ready',
      surfaceMode: 'live',
      screenRef: 'virtual-app-screen:dogfood/screen-without-native-host',
      targetAppRef: 'app:profile/vscode-editor',
      targetWindowRef: 'window:vscode-editor/main',
      sessionRef: 'computer-use:session/dogfood/session-without-native-host.json',
      liveSurfaceRef: 'computer-use:session/dogfood/live-surface.json',
      frameStreamRef: 'computer-use:session/dogfood/frame-stream.json',
      currentFrameRef: 'computer-use:session/dogfood/frames/after.json',
      inputLeaseRef: 'computer-use:session/dogfood/leases/active.json',
      adapterReadinessRef: 'computer-use:session/dogfood/readiness/native-app-window.json',
      evidenceLedgerRef: 'computer-use:session/dogfood/evidence-ledger.json',
      guiPresentRefs: ['gui.present:dogfood/screen-pane'],
      inputIntentRefs: ['computer-use:session/dogfood/input-intents/type-marker.json'],
      executorEventRefs: ['computer-use:session/dogfood/executor-events/type-marker.json'],
      beforeAfterFrameRefs: ['computer-use:session/dogfood/before-after/type-marker.json'],
      takeoverRefs: ['computer-use:session/dogfood/leases/takeover.json'],
      resumeRefs: ['computer-use:session/dogfood/leases/resume-agent.json'],
      inputIntentReady: true,
      leaseControlReady: true,
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.nativeHost.status, 'blocked');
  assert.equal(manifest.hostSessionRef, 'computer-use:session/dogfood/session-without-native-host.json');
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('surfaceOwnerRef'));
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('displayOwnerRef'));
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('inputAcceptedRefs'));
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('automationBarrierRefs'));
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('backgroundEvidenceRefs'));
  assert.deepEqual(manifest.inputAcceptedRefs, []);
  assert.deepEqual(manifest.automationBarrierRefs, []);
  assert.deepEqual(manifest.backgroundEvidenceRefs, []);
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood passed-looking manifest without Host ledger replay/current-run pointer remains blocked', () => {
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-passed-looking-without-replay-pointer',
    phase: 'manifest-output',
    reason: null,
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      hostSessionRef: 'computer-use:session/dogfood/session.json',
      attachState: 'attached',
      status: 'ready',
      surfaceMode: 'live',
      screenRef: 'virtual-app-screen:dogfood/screen-a',
      targetAppRef: 'app:profile/vscode-editor',
      targetWindowRef: 'window:vscode-editor/main',
      sessionRef: 'computer-use:session/dogfood/session.json',
      liveSurfaceRef: 'computer-use:session/dogfood/live-surface.json',
      liveBindingAttachGrantRef: 'computer-use:provider-session/dogfood/live-binding-attach-grant.json',
      grantValidationRef: 'computer-use:provider-session/dogfood/grant-validation.json',
      grantValidationStatus: 'validated',
      surfaceOwnerRef: 'computer-use:session/dogfood/surfaces/screen-a/surface-owner.json',
      displayOwnerRef: 'computer-use:session/dogfood/surfaces/screen-a/display-owner.json',
      surfaceTransportRef: 'computer-use:session/dogfood/surface-transport.json',
      frameStreamRef: 'computer-use:session/dogfood/frame-stream.json',
      currentFrameRef: 'computer-use:session/dogfood/frames/after.json',
      beforeFrameRef: 'computer-use:session/dogfood/frames/before.json',
      afterFrameRef: 'computer-use:session/dogfood/frames/after.json',
      inputLeaseRef: 'computer-use:session/dogfood/leases/active.json',
      userLeaseRef: 'computer-use:session/dogfood/leases/user.json',
      agentLeaseRef: 'computer-use:session/dogfood/leases/agent.json',
      activeLeaseOwnerRef: 'computer-use:session/dogfood/leases/agent.json',
      adapterReadinessRef: 'computer-use:session/dogfood/readiness/native-app-window.json',
      evidenceLedgerRef: 'computer-use:session/dogfood/evidence-ledger.json',
      guiPresentRefs: ['gui.present:dogfood/screen-pane'],
      inputIntentRefs: ['computer-use:session/dogfood/input-intents/type-marker.json'],
      humanInputHotPathRefs: ['computer-use:session/dogfood/input-hot-path/human-input.json'],
      inputAcceptedRefs: ['computer-use:session/dogfood/inputs/0001-type-text.json'],
      executorEventRefs: ['computer-use:session/dogfood/executor-events/type-marker.json'],
      beforeAfterFrameRefs: ['computer-use:session/dogfood/before-after/type-marker.json'],
      automationBarrierRefs: [
        'computer-use:session/dogfood/barriers/type-marker.json',
        'computer-use:session/dogfood/barriers/resume-agent.json',
      ],
      backgroundEvidenceRefs: ['computer-use:session/dogfood/background-rendering/native-frame-stream.json'],
      takeoverRefs: ['computer-use:session/dogfood/leases/takeover.json'],
      resumeRefs: ['computer-use:session/dogfood/leases/resume-agent.json'],
      inputIntentReady: true,
      leaseControlReady: true,
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.nativeHost.status, 'blocked');
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('currentRunPointerRef'));
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('minimalEvidenceReplayRefs'));
  assert.equal(manifest.nativeHost.currentRunPointerRef, null);
  assert.deepEqual(manifest.nativeHost.minimalEvidenceReplayRefs, []);
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood passed-looking manifest with legacy session/provider refs remains blocked', () => {
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-legacy-live-truth-refs',
    phase: 'manifest-output',
    reason: null,
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      hostSessionRef: 'computer-use:session/dogfood/session.json',
      attachState: 'attached',
      status: 'ready',
      surfaceMode: 'live',
      screenRef: 'virtual-app-screen:dogfood/screen-a',
      targetAppRef: 'app:profile/vscode-editor',
      targetWindowRef: 'window:vscode-editor/main',
      sessionRef: 'computer-use:session/dogfood/session.json',
      liveSurfaceRef: 'computer-use:session/dogfood/live-surface.json',
      liveBindingAttachGrantRef: 'computer-use:provider-session/dogfood/live-binding-attach-grant.json',
      grantValidationRef: 'computer-use:provider-session/dogfood/grant-validation.json',
      grantValidationStatus: 'validated',
      surfaceOwnerRef: 'computer-use:session/dogfood/surfaces/screen-a/surface-owner.json',
      displayOwnerRef: 'computer-use:session/dogfood/surfaces/screen-a/display-owner.json',
      surfaceTransportRef: 'computer-use:provider-session/dogfood/surface-transport.json',
      frameStreamRef: 'computer-use:session/dogfood/frame-stream.json',
      currentFrameRef: 'computer-use:session/dogfood/frames/after.json',
      currentRunPointerRef: 'computer-use:session/dogfood/current-run.json',
      beforeFrameRef: 'computer-use:session/dogfood/frames/before.json',
      afterFrameRef: 'computer-use:session/dogfood/frames/after.json',
      inputLeaseRef: 'computer-use:session/dogfood/leases/active.json',
      userLeaseRef: 'computer-use:session/dogfood/leases/user.json',
      agentLeaseRef: 'computer-use:session/dogfood/leases/agent.json',
      activeLeaseOwnerRef: 'computer-use:session/dogfood/leases/agent.json',
      adapterReadinessRef: 'computer-use:provider-session/dogfood/readiness/native-app-window.json',
      evidenceLedgerRef: 'computer-use:session/dogfood/evidence-ledger.json',
      guiPresentRefs: ['gui.present:dogfood/screen-pane'],
      inputIntentRefs: ['computer-use:session/dogfood/input-intents/type-marker.json'],
      humanInputHotPathRefs: ['computer-use:session/dogfood/input-hot-path/human-input.json'],
      inputAcceptedRefs: ['computer-use:session/dogfood/inputs/0001-type-text.json'],
      executorEventRefs: ['computer-use:provider-session/dogfood/executor-events/type-marker.json'],
      beforeAfterFrameRefs: ['computer-use:session/dogfood/before-after/type-marker.json'],
      automationBarrierRefs: [
        'computer-use:session/dogfood/barriers/type-marker.json',
        'computer-use:session/dogfood/barriers/resume-agent.json',
      ],
      backgroundEvidenceRefs: ['computer-use:provider-session/dogfood/background-rendering/native-frame-stream.json'],
      minimalEvidenceReplayRefs: [
        'computer-use:session/dogfood/evidence-ledger.json/events/0001-session.created.json',
        'computer-use:session/dogfood/evidence-ledger.json/events/0003-surface.attached.json',
        'computer-use:session/dogfood/evidence-ledger.json/events/0006-human-input.accepted.json',
        'computer-use:session/dogfood/evidence-ledger.json/events/0008-resume-agent.json',
      ],
      takeoverRefs: ['computer-use:session/dogfood/leases/takeover.json'],
      resumeRefs: ['computer-use:session/dogfood/leases/resume-agent.json'],
      inputIntentReady: true,
      leaseControlReady: true,
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.nativeHost.status, 'blocked');
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('hostSessionRef'));
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('liveBindingAttachGrantRef'));
  assert.ok(manifest.nativeHost.missingRequiredFields.includes('inputAcceptedRefs'));
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood contract fixture remains blocked without real opt-in Host evidence', () => {
  const refs: DogfoodRefs = {
    hostSessionRef: 'computer-use:native-host/dogfood/session.json',
    attachState: 'attached',
    status: 'ready',
    surfaceMode: 'live',
    screenRef: 'virtual-app-screen:dogfood/screen-a',
    targetAppRef: 'app:profile/vscode-editor',
    targetWindowRef: 'window:vscode-editor/main',
    sessionRef: 'computer-use:native-host/dogfood/session.json',
    liveSurfaceRef: 'computer-use:native-host/dogfood/live-surface.json',
    liveBindingAttachGrantRef: 'computer-use:native-host/dogfood/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:native-host/dogfood/grant-validation.json',
    grantValidationStatus: 'validated',
    surfaceOwnerRef: 'computer-use:native-host/dogfood/surfaces/screen-a/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/dogfood/surfaces/screen-a/display-owner.json',
    surfaceTransportRef: 'computer-use:native-host/dogfood/surface-transport.json',
    frameStreamRef: 'computer-use:native-host/dogfood/frame-stream.json',
    currentFrameRef: 'computer-use:native-host/dogfood/frames/after.json',
    currentRunPointerRef: 'computer-use:native-host/current-runs/dogfood/current-run.json',
    beforeFrameRef: 'computer-use:native-host/dogfood/frames/before.json',
    afterFrameRef: 'computer-use:native-host/dogfood/frames/after.json',
    inputLeaseRef: 'computer-use:native-host/dogfood/leases/active.json',
    userLeaseRef: 'computer-use:native-host/dogfood/leases/user.json',
    agentLeaseRef: 'computer-use:native-host/dogfood/leases/agent.json',
    activeLeaseOwnerRef: 'computer-use:native-host/dogfood/leases/agent.json',
    adapterReadinessRef: 'computer-use:native-host/dogfood/readiness/native-app-window.json',
    evidenceLedgerRef: 'computer-use:native-host/dogfood/evidence-ledger.json',
    guiPresentRefs: ['gui.present:dogfood/screen-pane'],
    inputIntentRefs: ['computer-use:native-host/dogfood/input-intents/type-marker.json'],
    humanInputHotPathRefs: ['computer-use:native-host/dogfood/input-hot-path/human-input.json'],
    inputAcceptedRefs: ['computer-use:native-host/dogfood/inputs/0001-type-text.json'],
    executorEventRefs: ['computer-use:native-host/dogfood/executor-events/type-marker.json'],
    beforeAfterFrameRefs: ['computer-use:native-host/dogfood/before-after/type-marker.json'],
    automationBarrierRefs: [
      'computer-use:native-host/dogfood/barriers/type-marker.json',
      'computer-use:native-host/dogfood/barriers/resume-agent.json',
    ],
    backgroundEvidenceRefs: ['computer-use:native-host/dogfood/background-rendering/native-frame-stream.json'],
    minimalEvidenceReplayRefs: [
      'computer-use:native-host/dogfood/evidence-ledger.json/events/0001-session.created.json',
      'computer-use:native-host/dogfood/evidence-ledger.json/events/0003-surface.attached.json',
      'computer-use:native-host/dogfood/evidence-ledger.json/events/0006-human-input.accepted.json',
      'computer-use:native-host/dogfood/evidence-ledger.json/events/0008-resume-agent.json',
    ],
    takeoverRefs: ['computer-use:native-host/dogfood/leases/takeover.json'],
    resumeRefs: ['computer-use:native-host/dogfood/leases/resume-agent.json'],
    inputIntentReady: true,
    leaseControlReady: true,
  };
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-fixture',
    phase: 'manifest-output',
    reason: null,
    openedSciForge: true,
    enteredScreen: true,
    refs,
  });

  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /real Host provider session/i);
  assert.equal(manifest.nativeHost.status, 'ready');
  assert.equal(manifest.hostSessionRef, 'computer-use:native-host/dogfood/session.json');
  assert.equal(manifest.surfaceOwnerRef, 'computer-use:native-host/dogfood/surfaces/screen-a/surface-owner.json');
  assert.equal(manifest.displayOwnerRef, 'computer-use:native-host/dogfood/surfaces/screen-a/display-owner.json');
  assert.equal(manifest.nativeHost.currentRunPointerRef, 'computer-use:native-host/current-runs/dogfood/current-run.json');
  assert.deepEqual(manifest.nativeHost.minimalEvidenceReplayRefs, [
    'computer-use:native-host/dogfood/evidence-ledger.json/events/0001-session.created.json',
    'computer-use:native-host/dogfood/evidence-ledger.json/events/0003-surface.attached.json',
    'computer-use:native-host/dogfood/evidence-ledger.json/events/0006-human-input.accepted.json',
    'computer-use:native-host/dogfood/evidence-ledger.json/events/0008-resume-agent.json',
  ]);
  assert.deepEqual(manifest.inputAcceptedRefs, ['computer-use:native-host/dogfood/inputs/0001-type-text.json']);
  assert.deepEqual(manifest.automationBarrierRefs, [
    'computer-use:native-host/dogfood/barriers/type-marker.json',
    'computer-use:native-host/dogfood/barriers/resume-agent.json',
  ]);
  assert.deepEqual(manifest.backgroundEvidenceRefs, ['computer-use:native-host/dogfood/background-rendering/native-frame-stream.json']);
  assert.equal(manifest.humanInputHotPath.accepted, true);
  assert.equal(manifest.vscodeOperation.attemptedViaInputIntent, true);
  assert.equal(manifest.humanIntervention.takeoverAttempted, true);
  assert.equal(manifest.humanIntervention.resumeAttempted, true);
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood manifest passes when real opt-in Host session evidence is ingested', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-vas-real-host-evidence-'));
  try {
    const evidencePath = join(tempRoot, 'real-host-evidence.json');
    await writeFile(evidencePath, JSON.stringify({
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1',
      status: 'passed',
      diagnosticOnly: false,
      dogfoodRefs: realDogfoodRefs({ includeQueueEvidence: true }),
    }, null, 2), 'utf8');

    const manifest = buildDogfoodManifest({
      runId: 'vas-dogfood-real-host-ingested',
      phase: 'manifest-output',
      reason: null,
      openedSciForge: true,
      enteredScreen: true,
      refs: await realHostEvidenceDogfoodRefs(evidencePath),
    });

    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.nativeHost.status, 'ready');
    assert.equal(manifest.nativeHost.currentRunPointerRef, 'computer-use:native-host/runs/real-dogfood/current-run-pointer.json');
    assertDogfoodManifest(manifest);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('VirtualAppScreen dogfood real opt-in evidence ingestion requires real agent queue refs', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-vas-real-host-queue-evidence-'));
  try {
    const evidencePath = join(tempRoot, 'real-host-evidence-without-queue.json');
    await writeFile(evidencePath, JSON.stringify({
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1',
      status: 'passed',
      diagnosticOnly: false,
      dogfoodRefs: realDogfoodRefs({ includeQueueEvidence: false }),
    }, null, 2), 'utf8');

    assert.deepEqual(await realHostEvidenceDogfoodRefs(evidencePath), {});
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('VirtualAppScreen dogfood product smoke opens SciForge Screen and writes bounded manifest', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  const runId = `vas-dogfood-${Date.now().toString(36)}`;
  const fallbackManifestPath = process.env.SCIFORGE_VAS_DOGFOOD_MANIFEST;

  if (!existsSync(browserExecutable)) {
    const manifest = buildDogfoodManifest({
      runId,
      phase: 'open-sciforge',
      reason: `browser executable unavailable for product UI smoke: ${browserExecutable}`,
      openedSciForge: false,
      enteredScreen: false,
      refs: {},
    });
    await maybeWriteManifest(fallbackManifestPath, manifest);
    assertDogfoodManifest(manifest);
    return;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-vas-dogfood-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;

  await mkdir(workspacePath);
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    workspaceWriterBaseUrl: writerUrl,
    workspacePath,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    theme: 'dark',
    modelProvider: 'dogfood-local',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  }), 'utf8');

  let manifest: VirtualAppScreenDogfoodManifest | undefined;
  try {
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: runId,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_UI_PORT: String(uiPort),
      SCIFORGE_AGENT_SERVER_AUTOSTART: '0',
      SCIFORGE_AGENT_SERVER_URL: 'http://127.0.0.1:1',
    };
    children.push(spawnProcess('npm', ['run', 'workspace:server', '--silent'], commonEnv));
    await waitForHttp(`${writerUrl}/health`, 30_000);
    children.push(spawnProcess('npm', ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], commonEnv));
    await waitForHttp(uiUrl, 45_000);

    browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });
    await ensureScreenPane(page);
    await page.locator('[data-component-id="virtual-screen-viewer"]').waitFor({ state: 'visible', timeout: 20_000 });

    const refs = await readScreenRefs(page);
    const afterBootstrap = await waitForScreenBootstrap(page, DEFAULT_BOOTSTRAP_MS);
    const current = { ...refs, ...afterBootstrap };

    if (current.attachState === 'attached' && current.inputIntentReady) {
      await page.locator('.virtual-screen-frame-image[data-event="virtual-screen-input-intent-request"]').first().click({ position: { x: 10, y: 10 } });
      await page.locator('.virtual-screen-keyboard-input').first().fill('sciforge vas dogfood marker');
      await page.keyboard.press('Enter');
    }
    const afterInput = await readScreenRefs(page);
    if (afterInput.leaseControlReady) {
      await clickOptionalControl(page, 'takeover');
      await clickOptionalControl(page, 'pause-agent');
      await clickOptionalControl(page, 'resume-agent');
    }
    const finalRefs = {
      ...current,
      ...afterInput,
      ...await readScreenRefs(page),
      ...await realHostEvidenceDogfoodRefs(process.env[REAL_HOST_EVIDENCE_MANIFEST_ENV]),
    };
    const blockedReason = finalRefs.attachState === 'attached'
      ? 'Screen attached, but current run lacks complete VSCode InputIntent and human takeover/resume evidence refs'
      : finalRefs.blockedReason || 'Screen pane did not attach a native VirtualAppScreen session within the bootstrap window';
    const phase = finalRefs.attachState === 'attached'
      ? missingInputOrLeasePhase(finalRefs)
      : 'auto-provision-attach';
    manifest = buildDogfoodManifest({
      runId,
      phase,
    reason: finalRefs.attachState === 'attached' && canPassRealHostSession(finalRefs) ? null : blockedReason,
      openedSciForge: true,
      enteredScreen: true,
      refs: finalRefs,
    });
    await maybeWriteManifest(fallbackManifestPath, manifest);
    assertDogfoodManifest(manifest);
  } catch (error) {
    manifest = buildDogfoodManifest({
      runId,
      phase: 'enter-screen',
      reason: boundedReason(error),
      openedSciForge: true,
      enteredScreen: false,
      refs: {},
    });
    await maybeWriteManifest(fallbackManifestPath, manifest);
    assertDogfoodManifest(manifest);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function realDogfoodRefs({ includeQueueEvidence }: { includeQueueEvidence: boolean }): DogfoodRefs {
  const queueRefs = [
    'computer-use:native-host/provider-adapter-control/real-dogfood/pause/agent-queue.json',
    'computer-use:native-host/provider-adapter-control/real-dogfood/resume/agent-queue.json',
    'computer-use:native-host/provider-adapter-control/real-dogfood/resume/current-frame-refresh.json',
  ];
  return {
    hostSessionRef: 'computer-use:native-host/sessions/real-dogfood/session.json',
    attachState: 'attached',
    status: 'ready',
    surfaceMode: 'live',
    screenRef: 'virtual-app-screen:real-dogfood/screen-a',
    targetAppRef: 'app:profile/vscode-editor',
    targetWindowRef: 'computer-use:native-host/windows/real-dogfood/main.json',
    sessionRef: 'computer-use:native-host/sessions/real-dogfood/session.json',
    liveSurfaceRef: 'computer-use:native-host/surfaces/real-dogfood/live-surface.json',
    liveBindingAttachGrantRef: 'computer-use:native-host/grants/real-dogfood/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0004-grant.validated.json',
    grantValidationStatus: 'validated',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/real-dogfood/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/real-dogfood/display-owner.json',
    surfaceTransportRef: 'computer-use:native-host/surfaces/real-dogfood/surface-transport.json',
    frameStreamRef: 'computer-use:native-host/surfaces/real-dogfood/frame-stream.json',
    currentFrameRef: 'computer-use:native-host/frames/real-dogfood/after-resume.json',
    currentRunPointerRef: 'computer-use:native-host/runs/real-dogfood/current-run-pointer.json',
    beforeFrameRef: 'computer-use:native-host/frames/real-dogfood/before-input.json',
    afterFrameRef: 'computer-use:native-host/frames/real-dogfood/after-resume.json',
    inputLeaseRef: 'computer-use:native-host/leases/real-dogfood/input.json',
    adapterReadinessRef: 'computer-use:native-host/readiness/real-dogfood/native-provider.json',
    evidenceLedgerRef: 'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json',
    guiPresentRefs: ['gui.present:real-dogfood/screen-pane'],
    inputIntentRefs: ['computer-use:native-host/input-runtime/real-dogfood/input-intents/type.json'],
    humanInputHotPathRefs: ['computer-use:native-host/input-runtime/real-dogfood/input-intents/type.json'],
    inputAcceptedRefs: ['computer-use:native-host/inputs/real-dogfood/0001-type-text.json'],
    executorEventRefs: ['computer-use:native-host/inputs/real-dogfood/0001-type-text.json'],
    beforeAfterFrameRefs: ['computer-use:native-host/input-runtime/real-dogfood/before-after/type.json'],
    automationBarrierRefs: queueRefs,
    ...(includeQueueEvidence ? { realAgentQueueEvidenceRefs: queueRefs } : {}),
    backgroundEvidenceRefs: ['computer-use:native-host/surfaces/real-dogfood/frame-stream.json'],
    minimalEvidenceReplayRefs: [
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0001-session.created.json',
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0003-surface.attached.json',
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0004-grant.validated.json',
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0005-frame.read.json',
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0006-human-input.accepted.json',
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0007-agent.paused.json',
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0008-agent.resumed.json',
      'computer-use:native-host/ledgers/real-dogfood/evidence-ledger.json/events/0009-frame.read.json',
    ],
    takeoverRefs: ['computer-use:native-host/provider-adapter-control/real-dogfood/pause/agent-queue.json'],
    resumeRefs: ['computer-use:native-host/provider-adapter-control/real-dogfood/resume/agent-queue.json'],
    inputIntentReady: true,
    leaseControlReady: true,
    diagnosticOnly: false,
    realHostProviderSessionRef: 'computer-use:native-host/real-provider-sessions/real-dogfood/session.json',
    realOptInRunRef: 'computer-use:native-host/real-opt-in-runs/real-dogfood/run.json',
    realPlatformEvidenceRefs: [
      'computer-use:native-host/real-opt-in-runs/real-dogfood/diagnostic-only-false.json',
      'computer-use:native-host/platform-drivers/linux-xpra/ready.json',
    ],
  };
}

function buildDogfoodManifest({
  runId,
  phase,
  reason,
  openedSciForge,
  enteredScreen,
  refs,
}: {
  runId: string;
  phase: DogfoodPhase;
  reason: string | null;
  openedSciForge: boolean;
  enteredScreen: boolean;
  refs: DogfoodRefs;
}): VirtualAppScreenDogfoodManifest {
  const nativeHost = nativeHostShape(refs);
  const nativeHostPreflight = nativeHostPreflightShape(refs);
  const inputAcceptedRefs = uniqueRefs(refs.inputAcceptedRefs ?? []);
  const automationBarrierRefs = uniqueRefs(refs.automationBarrierRefs ?? []);
  const backgroundEvidenceRefs = uniqueRefs(refs.backgroundEvidenceRefs ?? []);
  const humanInputHotPathRefs = uniqueRefs([...(refs.humanInputHotPathRefs ?? []), ...inputAcceptedRefs]);
  const status: ManifestStatus = canPassRealHostSession(refs) && openedSciForge && enteredScreen && reason === null ? 'passed' : 'blocked';
  const activationCommandRefs = uniqueRefs([
    refs.handoffRef,
    ...(refs.lastCommandTexts ?? []).flatMap(refsFromCommandText),
  ]);
  const runtimeCommandAcceptance = runtimeCommandAcceptanceFromTexts(refs.lastCommandTexts ?? []);
  const permissionRefs = uniqueRefs([refs.permissionRef, ...(refs.permissionRefs ?? [])]);
  const lastFrameRefs = uniqueRefs([
    refs.liveSurfaceRef,
    refs.frameStreamRef,
    refs.currentFrameRef,
    refs.beforeFrameRef,
    refs.afterFrameRef,
    ...(refs.beforeAfterFrameRefs ?? []),
  ]);
  const lastInputRefs = uniqueRefs([
    refs.inputLeaseRef,
    refs.activeLeaseOwnerRef,
    refs.userLeaseRef,
    refs.agentLeaseRef,
    ...(refs.inputIntentRefs ?? []),
    ...(refs.humanInputHotPathRefs ?? []),
    ...(refs.inputAcceptedRefs ?? []),
    ...(refs.executorEventRefs ?? []),
    ...(refs.automationBarrierRefs ?? []),
    ...(refs.takeoverRefs ?? []),
    ...(refs.pauseRefs ?? []),
    ...(refs.resumeRefs ?? []),
  ]);

  return {
    schemaVersion: SCHEMA,
    status,
    source: 'product-ui-right-pane',
    runId,
    observedAt: new Date().toISOString(),
    phase: status === 'passed' ? 'manifest-output' : phase,
    reason: status === 'passed' ? null : boundedReason(reason || blockedDogfoodReason(refs)),
    nativeHost,
    ...(nativeHostPreflight ? { nativeHostPreflight } : {}),
    hostSessionRef: nativeHost.hostSessionRef,
    surfaceOwnerRef: nativeHost.surfaceOwnerRef,
    displayOwnerRef: nativeHost.displayOwnerRef,
    humanInputHotPath: {
      method: 'sendHumanInput',
      refsFirst: true,
      fireAndRelease: true,
      evidenceWillCatchUp: true,
      waitsForAutomationBarrier: false,
      waitsForAfterFrame: false,
      accepted: inputAcceptedRefs.length > 0,
      refs: humanInputHotPathRefs,
    },
    inputAcceptedRefs,
    automationBarrierRefs,
    backgroundEvidenceRefs,
    rightPane: {
      openedSciForge,
      enteredScreen,
      activationRequested: Boolean(refs.handoffRef || refs.adapterReadinessRef || activationCommandRefs.length),
      attachState: refs.attachState ?? null,
      status: refs.status ?? null,
      surfaceMode: refs.surfaceMode ?? null,
      screenRef: refs.screenRef ?? null,
      targetAppRef: refs.targetAppRef ?? null,
      targetWindowRef: refs.targetWindowRef ?? null,
      sessionRef: refs.sessionRef ?? null,
      guiPresentRefs: uniqueRefs(refs.guiPresentRefs ?? []),
      activationCommandRefs,
    },
    runtimeCommandAcceptance,
    providerReadiness: {
      status: providerStatus(refs),
      refs: uniqueRefs([refs.adapterReadinessRef, runtimeCommandAcceptance.adapterReadinessRef ?? undefined]),
    },
    permissionRefs,
    lastFrameRefs,
    lastInputRefs,
    vscodeOperation: {
      attemptedViaInputIntent: Boolean(refs.inputIntentReady && refs.inputLeaseRef),
      commandRefs: uniqueRefs(refs.inputIntentRefs ?? []),
      completed: Boolean(refs.inputIntentRefs?.length && refs.executorEventRefs?.length && refs.beforeAfterFrameRefs?.length),
    },
    humanIntervention: {
      takeoverAttempted: Boolean(refs.leaseControlReady && (refs.takeoverRefs?.length || refs.userLeaseRef)),
      resumeAttempted: Boolean(refs.leaseControlReady && (refs.resumeRefs?.length || refs.agentLeaseRef)),
      takeoverRefs: uniqueRefs(refs.takeoverRefs ?? []),
      resumeRefs: uniqueRefs(refs.resumeRefs ?? []),
      completed: Boolean(refs.takeoverRefs?.length && refs.resumeRefs?.length),
    },
    bounded: {
      refsFirst: true,
      rawPayloadsCaptured: false,
      providerInternalsUsed: false,
      hardcodedPageScreenshotOrUrl: false,
      sharedSystemInputUsed: false,
    },
  };
}

function canPassContractGate(refs: DogfoodRefs) {
  return Boolean(
    refs.attachState === 'attached'
    && refs.surfaceMode === 'live'
    && nativeHostShape(refs).missingRequiredFields.length === 0
    && (refs.liveSurfaceRef || refs.frameStreamRef)
    && refs.currentFrameRef
    && refs.adapterReadinessRef
    && refs.inputLeaseRef
    && refs.inputIntentRefs?.length
    && refs.inputAcceptedRefs?.length
    && refs.executorEventRefs?.length
    && refs.beforeAfterFrameRefs?.length
    && refs.automationBarrierRefs?.length
    && refs.backgroundEvidenceRefs?.length
    && refs.takeoverRefs?.length
    && refs.resumeRefs?.length
    && refs.guiPresentRefs?.length
  );
}

function canPassRealHostSession(refs: DogfoodRefs) {
  return Boolean(
    canPassContractGate(refs)
    && refs.diagnosticOnly === false
    && nativeHostProductRef(refs.realHostProviderSessionRef)
    && nativeHostProductRef(refs.realOptInRunRef)
    && refs.realPlatformEvidenceRefs?.some((ref) => nativeHostProductRef(ref))
    && (refs.realAgentQueueEvidenceRefs?.length ?? 0) >= 3
    && nativeHostProductRefsReady(refs.realAgentQueueEvidenceRefs ?? [])
  );
}

function blockedDogfoodReason(refs: DogfoodRefs) {
  if (canPassContractGate(refs) && !canPassRealHostSession(refs)) {
    return 'dogfood contract fixture has Host-shaped refs but lacks real Host provider session opt-in evidence with diagnosticOnly=false and real agent queue evidence';
  }
  return 'dogfood product path is blocked';
}

function nativeHostPreflightShape(refs: DogfoodRefs): VirtualAppScreenDogfoodManifest['nativeHostPreflight'] {
  const preflightRef = nativeHostPreflightProductRef(refs.preflightRef);
  const preflightLedgerRef = nativeHostPreflightProductRef(refs.preflightLedgerRef);
  const preflightLedgerEntryRef = nativeHostPreflightProductRef(refs.preflightLedgerEntryRef);
  const hostReadinessRef = nativeHostPreflightProductRef(refs.hostReadinessRef);
  const adapterReadinessRef = nativeHostPreflightProductRef(refs.adapterReadinessRef);
  if (!preflightRef && !preflightLedgerRef && !preflightLedgerEntryRef && !hostReadinessRef && !adapterReadinessRef) return undefined;
  const ready = Boolean(preflightRef && preflightLedgerRef && preflightLedgerEntryRef && hostReadinessRef && adapterReadinessRef);
  return {
    status: ready ? 'ready' : 'blocked',
    preflightRef: preflightRef ?? null,
    preflightLedgerRef: preflightLedgerRef ?? null,
    preflightLedgerEntryRef: preflightLedgerEntryRef ?? null,
    hostReadinessRef: hostReadinessRef ?? null,
    adapterReadinessRef: adapterReadinessRef ?? null,
  };
}

function nativeHostShape(refs: DogfoodRefs): VirtualAppScreenDogfoodManifest['nativeHost'] {
  const hostSessionRef = refs.hostSessionRef ?? refs.sessionRef ?? null;
  const surfaceOwnerRef = refs.surfaceOwnerRef ?? null;
  const displayOwnerRef = refs.displayOwnerRef ?? null;
  const currentRunPointerRef = refs.currentRunPointerRef ?? null;
  const inputAcceptedRefs = uniqueRefs(refs.inputAcceptedRefs ?? []);
  const automationBarrierRefs = uniqueRefs(refs.automationBarrierRefs ?? []);
  const backgroundEvidenceRefs = uniqueRefs(refs.backgroundEvidenceRefs ?? []);
  const minimalEvidenceReplayRefs = uniqueRefs(refs.minimalEvidenceReplayRefs ?? []);
  const nativeEvidenceLedgerRef = nativeHostProductRef(refs.evidenceLedgerRef ?? undefined);
  const requiredFields: Array<[string, string | null | undefined]> = [
    ['hostSessionRef', nativeHostProductRef(hostSessionRef ?? undefined)],
    ['surfaceOwnerRef', nativeHostProductRef(surfaceOwnerRef ?? undefined)],
    ['displayOwnerRef', nativeHostProductRef(displayOwnerRef ?? undefined)],
    ['liveSurfaceRef', nativeHostProductRef(refs.liveSurfaceRef)],
    ['liveBindingAttachGrantRef', nativeHostProductRef(refs.liveBindingAttachGrantRef)],
    ['grantValidationRef', nativeHostProductRef(refs.grantValidationRef)],
    ['surfaceTransportRef', nativeHostProductRef(refs.surfaceTransportRef)],
    ['frameStreamRef', nativeHostProductRef(refs.frameStreamRef)],
    ['currentFrameRef', nativeHostProductRef(refs.currentFrameRef)],
    ['currentRunPointerRef', nativeHostProductRef(currentRunPointerRef ?? undefined)],
    ['evidenceLedgerRef', nativeEvidenceLedgerRef],
    ['minimalEvidenceReplayRefs', minimalEvidenceReplayRefsReady(nativeEvidenceLedgerRef, minimalEvidenceReplayRefs) ? 'present' : undefined],
    ['inputAcceptedRefs', nativeHostProductRefsReady(inputAcceptedRefs) ? 'present' : undefined],
    ['automationBarrierRefs', nativeHostProductRefsReady(automationBarrierRefs) ? 'present' : undefined],
    ['backgroundEvidenceRefs', nativeHostProductRefsReady(backgroundEvidenceRefs) ? 'present' : undefined],
  ];
  const missingRequiredFields = requiredFields.flatMap(([field, value]) => value ? [] : [field]);

  return {
    schemaVersion: NATIVE_HOST_SCHEMA,
    required: true,
    status: missingRequiredFields.length ? 'blocked' : 'ready',
    failClosed: true,
    providerExecuted: false,
    hostSessionRef,
    surfaceOwnerRef,
    displayOwnerRef,
    liveSurfaceRef: refs.liveSurfaceRef ?? null,
    liveBindingAttachGrantRef: refs.liveBindingAttachGrantRef ?? null,
    grantValidationRef: refs.grantValidationRef ?? null,
    surfaceTransportRef: refs.surfaceTransportRef ?? null,
    frameStreamRef: refs.frameStreamRef ?? null,
    currentFrameRef: refs.currentFrameRef ?? null,
    currentRunPointerRef,
    evidenceLedgerRef: refs.evidenceLedgerRef ?? null,
    minimalEvidenceReplayRefs,
    readinessRefs: uniqueRefs([refs.adapterReadinessRef]),
    missingRequiredFields,
  };
}

function assertDogfoodManifest(manifest: VirtualAppScreenDogfoodManifest) {
  assert.equal(manifest.schemaVersion, SCHEMA);
  assert.equal(manifest.source, 'product-ui-right-pane');
  assert.equal(manifest.nativeHost.schemaVersion, NATIVE_HOST_SCHEMA);
  assert.equal(manifest.nativeHost.required, true);
  assert.equal(manifest.nativeHost.failClosed, true);
  assert.equal(manifest.nativeHost.providerExecuted, false);
  assert.equal(manifest.hostSessionRef, manifest.nativeHost.hostSessionRef);
  assert.equal(manifest.surfaceOwnerRef, manifest.nativeHost.surfaceOwnerRef);
  assert.equal(manifest.displayOwnerRef, manifest.nativeHost.displayOwnerRef);
  assert.equal(manifest.nativeHost.currentRunPointerRef?.trim() || manifest.nativeHost.currentRunPointerRef, manifest.nativeHost.currentRunPointerRef);
  assert.ok(Array.isArray(manifest.nativeHost.readinessRefs));
  assert.ok(Array.isArray(manifest.nativeHost.missingRequiredFields));
  assert.ok(Array.isArray(manifest.nativeHost.minimalEvidenceReplayRefs));
  assert.ok(manifest.nativeHost.minimalEvidenceReplayRefs.length <= 8);
  assert.equal(uniqueRefs(manifest.nativeHost.minimalEvidenceReplayRefs).length, manifest.nativeHost.minimalEvidenceReplayRefs.length);
  assert.equal(manifest.nativeHost.minimalEvidenceReplayRefs.every(isSafeProductRef), true);
  assert.equal(manifest.nativeHost.minimalEvidenceReplayRefs.every(isNonFixtureEvidenceRef), true);
  if (manifest.nativeHost.evidenceLedgerRef && manifest.nativeHost.minimalEvidenceReplayRefs.length) {
    assert.equal(
      manifest.nativeHost.minimalEvidenceReplayRefs.every((ref) => ref.startsWith(`${manifest.nativeHost.evidenceLedgerRef}/events/`)),
      true,
    );
  }
  if (manifest.nativeHost.currentRunPointerRef) {
    assert.equal(isSafeProductRef(manifest.nativeHost.currentRunPointerRef), true);
    assert.equal(isNonFixtureEvidenceRef(manifest.nativeHost.currentRunPointerRef), true);
  }
  if (manifest.nativeHostPreflight) {
    assert.equal(['ready', 'blocked'].includes(manifest.nativeHostPreflight.status), true);
    for (const ref of [
      manifest.nativeHostPreflight.preflightRef,
      manifest.nativeHostPreflight.preflightLedgerRef,
      manifest.nativeHostPreflight.preflightLedgerEntryRef,
      manifest.nativeHostPreflight.hostReadinessRef,
      manifest.nativeHostPreflight.adapterReadinessRef,
    ]) {
      if (!ref) continue;
      assert.equal(isNativeHostProductRef(ref), true);
      assert.equal(isNonFixtureEvidenceRef(ref), true);
    }
  }
  assert.equal(manifest.humanInputHotPath.method, 'sendHumanInput');
  assert.equal(manifest.humanInputHotPath.refsFirst, true);
  assert.equal(manifest.humanInputHotPath.fireAndRelease, true);
  assert.equal(manifest.humanInputHotPath.evidenceWillCatchUp, true);
  assert.equal(manifest.humanInputHotPath.waitsForAutomationBarrier, false);
  assert.equal(manifest.humanInputHotPath.waitsForAfterFrame, false);
  assert.equal(manifest.humanInputHotPath.accepted, manifest.inputAcceptedRefs.length > 0);
  assert.ok(Array.isArray(manifest.humanInputHotPath.refs));
  assert.equal(manifest.humanInputHotPath.refs.every(isSafeProductRef), true);
  assert.ok(Array.isArray(manifest.inputAcceptedRefs));
  assert.ok(Array.isArray(manifest.automationBarrierRefs));
  assert.ok(Array.isArray(manifest.backgroundEvidenceRefs));
  assert.equal(manifest.bounded.refsFirst, true);
  assert.equal(manifest.bounded.rawPayloadsCaptured, false);
  assert.equal(manifest.bounded.providerInternalsUsed, false);
  assert.equal(manifest.bounded.hardcodedPageScreenshotOrUrl, false);
  assert.equal(manifest.bounded.sharedSystemInputUsed, false);
  assert.equal(manifest.runtimeCommandAcceptance.failClosed, true);
  assert.equal(manifest.runtimeCommandAcceptance.providerExecuted, false);
  if (manifest.runtimeCommandAcceptance.commandObserved) {
    assert.equal(manifest.runtimeCommandAcceptance.parsed, true);
    assert.ok(manifest.runtimeCommandAcceptance.route);
    assert.ok(manifest.runtimeCommandAcceptance.adapterReadinessRef);
    assert.ok(manifest.providerReadiness.refs.includes(manifest.runtimeCommandAcceptance.adapterReadinessRef));
  }
  if (manifest.runtimeCommandAcceptance.route?.startsWith('virtual-app-screen-permission-')) {
    assert.ok(manifest.runtimeCommandAcceptance.targetRef);
    assert.ok(manifest.permissionRefs.length);
  }
  if (manifest.status === 'blocked') {
    assert.ok(manifest.phase);
    assert.ok(manifest.reason);
    assert.ok(Array.isArray(manifest.providerReadiness.refs));
    assert.ok(Array.isArray(manifest.permissionRefs));
    assert.ok(Array.isArray(manifest.lastFrameRefs));
    assert.ok(Array.isArray(manifest.lastInputRefs));
  } else {
    assert.equal(manifest.nativeHost.status, 'ready');
    assert.equal(manifest.nativeHost.missingRequiredFields.length, 0);
    assert.ok(manifest.hostSessionRef);
    assert.ok(manifest.surfaceOwnerRef);
    assert.ok(manifest.displayOwnerRef);
    assert.ok(manifest.nativeHost.currentRunPointerRef);
    assert.ok(manifest.nativeHost.minimalEvidenceReplayRefs.length >= 4);
    assert.ok(manifest.inputAcceptedRefs.length);
    assert.ok(manifest.automationBarrierRefs.length);
    assert.ok(manifest.backgroundEvidenceRefs.length);
    assert.equal(liveTruthRefs(manifest).every(isLiveTruthProductRef), true);
  }
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /data:image|;base64,|rawScreenshot|screenshotBase64|providerUrl|providerRoute|Authorization|apiKey|password|secret|token/i);
  assert.doesNotMatch(text, /virtual-app-screen-vscode-smoke|vscode-virtual-app-screen-bridge|com\.microsoft\.VSCode|noVNC|RDP|QEMU|Playwright/i);
  assert.equal(allRefs(manifest).every(isSafeProductRef), true);
}

function readNativeHostPreflight(manifest: VirtualAppScreenDogfoodManifest) {
  return (manifest as VirtualAppScreenDogfoodManifest & {
    nativeHostPreflight?: {
      status: 'ready' | 'blocked';
      preflightRef: string | null;
      preflightLedgerRef: string | null;
      preflightLedgerEntryRef: string | null;
      hostReadinessRef: string | null;
      adapterReadinessRef: string | null;
    };
  }).nativeHostPreflight;
}

async function ensureScreenPane(page: Page) {
  const tab = page.locator('.result-page-tab', { hasText: 'Screen' }).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('.result-new-tab-button').click();
    await page.getByRole('menuitem', { name: 'Screen', exact: true }).click();
    await page.locator('.result-page-tab', { hasText: 'Screen' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.result-page-tab', { hasText: 'Screen' }).click();
  }
  await page.locator('[data-testid="right-pane-virtual-screen-tool"]').waitFor({ state: 'visible', timeout: 20_000 });
}

async function readScreenRefs(page: Page): Promise<DogfoodRefs> {
  return page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('[data-component-id="virtual-screen-viewer"]');
    const frame = document.querySelector<HTMLElement>('.virtual-screen-frame');
    const image = document.querySelector<HTMLElement>('.virtual-screen-frame-image[data-event="virtual-screen-input-intent-request"]');
    const blocked = document.querySelector<HTMLElement>('.virtual-screen-attach-state [data-blocked-reason]');
    const refsByKind = (kind: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-timeline-kind="${kind}"]`))
      .map((element) => element.querySelector('code')?.textContent || '')
      .map((value) => value.trim())
      .filter(Boolean);
    const refText = (label: string) => {
      const entries = Array.from(document.querySelectorAll<HTMLElement>('.virtual-screen-ref-chip'));
      const match = entries.find((entry) => entry.textContent?.toLowerCase().startsWith(label.toLowerCase()));
      return match?.querySelector('code')?.textContent?.trim();
    };
    const unique = (values: Array<string | undefined>) =>
      [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
    const refsFromOption = (commandText: string, option: string) => {
      const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [...commandText.matchAll(new RegExp(`--${escaped}\\s+"([^"]+)"`, 'g'))].map((match) => match[1]);
    };
    const commandTexts = Array.from(document.querySelectorAll<HTMLElement>('[data-event="virtual-screen-terminal-equivalent-text"]'))
      .map((element) => element.getAttribute('data-command-text') || element.textContent || '')
      .filter((value) => value.includes('/computer-use'));
    return {
      hostSessionRef: refText('host session') || frame?.getAttribute('data-host-session-ref') || image?.getAttribute('data-host-session-ref') || undefined,
      attachState: viewer?.getAttribute('data-attach-state') || undefined,
      status: viewer?.getAttribute('data-status') || undefined,
      surfaceMode: viewer?.getAttribute('data-screen-surface-mode') || undefined,
      screenRef: refText('screen'),
      targetAppRef: refText('target app') || image?.getAttribute('data-target-app-ref') || undefined,
      targetWindowRef: refText('target window') || image?.getAttribute('data-target-window-ref') || undefined,
      sessionRef: refText('session'),
      liveSurfaceRef: refText('live surface') || frame?.getAttribute('data-live-surface-ref') || image?.getAttribute('data-live-surface-ref') || undefined,
      liveBindingAttachGrantRef: refText('live binding attach grant') || image?.getAttribute('data-live-binding-attach-grant-ref') || undefined,
      grantValidationRef: refText('grant validation') || image?.getAttribute('data-grant-validation-ref') || undefined,
      grantValidationStatus: image?.getAttribute('data-grant-validation-status') || undefined,
      surfaceOwnerRef: refText('surface owner') || frame?.getAttribute('data-surface-owner-ref') || image?.getAttribute('data-surface-owner-ref') || undefined,
      displayOwnerRef: refText('display owner') || frame?.getAttribute('data-display-owner-ref') || image?.getAttribute('data-display-owner-ref') || undefined,
      surfaceTransportRef: refText('surface transport') || image?.getAttribute('data-surface-transport-ref') || undefined,
      frameStreamRef: refText('frame stream') || image?.getAttribute('data-frame-stream-ref') || undefined,
      currentFrameRef: refText('current frame') || image?.getAttribute('data-frame-ref') || undefined,
      currentRunPointerRef: refText('current run pointer')
        || frame?.getAttribute('data-current-run-pointer-ref')
        || image?.getAttribute('data-current-run-pointer-ref')
        || commandTexts.flatMap((text) => refsFromOption(text, 'current-run-pointer-ref'))[0]
        || undefined,
      beforeFrameRef: refText('before'),
      afterFrameRef: refText('after'),
      inputLeaseRef: refText('input lease') || frame?.getAttribute('data-input-lease-ref') || undefined,
      activeLeaseOwnerRef: refText('active lease owner') || frame?.getAttribute('data-active-lease-owner-ref') || undefined,
      userLeaseRef: refText('user lease') || frame?.getAttribute('data-user-lease-ref') || undefined,
      agentLeaseRef: refText('agent lease') || frame?.getAttribute('data-agent-lease-ref') || undefined,
      preflightRef: refText('preflight') || refsByKind('preflight')[0],
      preflightLedgerRef: refText('preflight ledger') || refsByKind('preflight-ledger')[0],
      preflightLedgerEntryRef: refText('preflight ledger entry') || refsByKind('preflight-ledger-entry')[0],
      hostReadinessRef: refText('host readiness') || refsByKind('host-readiness')[0],
      adapterReadinessRef: refText('adapter readiness'),
      permissionRef: refText('permission') || frame?.getAttribute('data-permission-ref') || image?.getAttribute('data-permission-ref') || undefined,
      blockedRef: refText('blocked'),
      handoffRef: refText('handoff'),
      evidenceLedgerRef: refText('evidence ledger'),
      inputIntentReady: frame?.getAttribute('data-input-intent-ready') === 'true',
      leaseControlReady: frame?.getAttribute('data-lease-control-ready') === 'true',
      guiPresentRefs: refsByKind('gui.present'),
      inputIntentRefs: refsByKind('input-intent'),
      humanInputHotPathRefs: unique([
        refText('human input hot path'),
        refText('input hot path'),
        frame?.getAttribute('data-input-hot-path-ref') || undefined,
        image?.getAttribute('data-input-hot-path-ref') || undefined,
        ...refsByKind('input-hot-path'),
      ]),
      inputAcceptedRefs: unique([
        refText('input accepted'),
        frame?.getAttribute('data-input-accepted-ref') || undefined,
        image?.getAttribute('data-input-accepted-ref') || undefined,
        ...refsByKind('input-accepted'),
        ...refsByKind('human-input.accepted'),
        ...commandTexts.flatMap((text) => refsFromOption(text, 'input-accepted-ref')),
      ]),
      executorEventRefs: refsByKind('executor-event'),
      beforeAfterFrameRefs: refsByKind('before-after'),
      automationBarrierRefs: unique([
        refText('automation barrier'),
        frame?.getAttribute('data-automation-barrier-ref') || undefined,
        image?.getAttribute('data-automation-barrier-ref') || undefined,
        ...refsByKind('automation-barrier'),
        ...refsByKind('automation.barrier-completed'),
        ...commandTexts.flatMap((text) => refsFromOption(text, 'automation-barrier-ref')),
      ]),
      backgroundEvidenceRefs: unique([
        refText('background evidence'),
        frame?.getAttribute('data-background-evidence-ref') || undefined,
        image?.getAttribute('data-background-evidence-ref') || undefined,
        ...refsByKind('background-evidence'),
        ...commandTexts.flatMap((text) => refsFromOption(text, 'background-evidence-ref')),
      ]),
      minimalEvidenceReplayRefs: unique([
        refText('minimal evidence replay'),
        refText('evidence replay'),
        ...refsByKind('evidence-replay'),
        ...refsByKind('evidence-ledger-replay'),
        ...commandTexts.flatMap((text) => refsFromOption(text, 'minimal-evidence-replay-ref')),
        ...commandTexts.flatMap((text) => refsFromOption(text, 'evidence-replay-ref')),
      ]),
      permissionRefs: [...refsByKind('permission'), ...refsByKind('permission-handoff'), ...refsByKind('permission-recheck')],
      takeoverRefs: refsByKind('takeover'),
      pauseRefs: refsByKind('pause-agent'),
      resumeRefs: refsByKind('resume-agent'),
      lastCommandTexts: commandTexts,
      blockedReason: blocked?.getAttribute('data-blocked-reason') || undefined,
    };
  });
}

async function waitForScreenBootstrap(page: Page, timeoutMs: number): Promise<DogfoodRefs> {
  const deadline = Date.now() + timeoutMs;
  let last = await readScreenRefs(page);
  while (Date.now() < deadline) {
    last = await readScreenRefs(page);
    if (last.attachState && last.attachState !== 'no-session') return last;
    await delay(250);
  }
  return last;
}

async function clickOptionalControl(page: Page, controlKind: string) {
  const control = page.locator(`[data-event="virtual-screen-terminal-equivalent-text"][data-control-kind="${controlKind}"][data-control-enabled="true"]`).first();
  if (await control.count()) await control.click();
}

function missingInputOrLeasePhase(refs: DogfoodRefs): DogfoodPhase {
  if (!refs.inputIntentRefs?.length || !refs.executorEventRefs?.length) return 'operate-vscode-input-intent';
  if (!refs.takeoverRefs?.length) return 'human-takeover';
  if (!refs.resumeRefs?.length) return 'resume-agent';
  return 'manifest-output';
}

function providerStatus(refs: DogfoodRefs): VirtualAppScreenDogfoodManifest['providerReadiness']['status'] {
  if (refs.attachState === 'attached') return 'ready';
  if (refs.attachState === 'adapter-unavailable') return 'adapter-unavailable';
  if (refs.attachState === 'requires-handoff' || refs.permissionRefs?.length || refs.permissionRef) return 'permission-missing';
  if (refs.attachState === 'blocked' || refs.blockedRef) return 'blocked';
  return 'unknown';
}

function refsFromCommandText(commandText: string) {
  return [...commandText.matchAll(/--[a-z-]*ref\s+"([^"]+)"/g)].map((match) => match[1]);
}

function refsFromCommandOption(commandText: string, option: string) {
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...commandText.matchAll(new RegExp(`--${escaped}\\s+"([^"]+)"`, 'g'))].map((match) => match[1]);
}

function runtimeCommandAcceptanceFromTexts(commandTexts: string[]): VirtualAppScreenDogfoodManifest['runtimeCommandAcceptance'] {
  const commandText = commandTexts.find((text) =>
    /^\/(?:computer-use|computer\s+use)\s+(?:screen\s+attach|permission-handoff|permission-recheck)\b/i.test(text.trim()));
  if (!commandText) {
    return {
      commandObserved: false,
      parsed: false,
      route: null,
      source: null,
      screenRef: null,
      targetAppRef: null,
      adapterReadinessRef: null,
      activationRef: null,
      targetRef: null,
      failClosed: true,
      providerExecuted: false,
      reason: null,
    };
  }

  const parsed = parseVirtualAppScreenRuntimeCommand(commandText);
  if (parsed.kind !== 'parsed') {
    return {
      commandObserved: true,
      parsed: false,
      route: null,
      source: null,
      screenRef: null,
      targetAppRef: null,
      adapterReadinessRef: null,
      activationRef: null,
      targetRef: null,
      failClosed: true,
      providerExecuted: false,
      reason: parsed.kind === 'invalid' ? parsed.reason : 'not a VirtualAppScreen runtime command',
    };
  }

  const command = parsed.command;
  return {
    commandObserved: true,
    parsed: true,
    route: virtualAppScreenRuntimeCommandRoute(command),
    source: command.source,
    screenRef: command.refs.screenRef ?? null,
    targetAppRef: command.refs.targetAppRef ?? null,
    adapterReadinessRef: command.refs.readinessRef,
    activationRef: command.refs.activationRef ?? null,
    targetRef: command.refs.permissionHandoffRef ?? command.refs.permissionRecheckRef ?? command.refs.activationRef ?? null,
    failClosed: true,
    providerExecuted: false,
    reason: null,
  };
}

function uniqueRefs(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function allRefs(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(allRefs);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (key.endsWith('Ref') && typeof item === 'string') return [item];
    if (key.endsWith('Refs') && Array.isArray(item)) return item.filter((ref): ref is string => typeof ref === 'string');
    return allRefs(item);
  });
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isSafeProductRef(ref: string) {
  return !/^(?:https?:|file:|data:|blob:|javascript:|\/)/i.test(ref)
    && !/[?&](?:token|secret|password|api[_-]?key|authorization)=/i.test(ref)
    && !/;base64,/i.test(ref);
}

function isNonFixtureEvidenceRef(ref: string) {
  return !/(?:^|[:/.-])(?:fixture|fixtures|replay-fixture|snapshot-fixture|mock)(?:[:/.-]|$)/i.test(ref);
}

function nativeHostProductRef(ref: string | undefined) {
  return ref && isNativeHostProductRef(ref) ? ref : undefined;
}

function nativeHostPreflightProductRef(ref: string | undefined) {
  return ref?.startsWith('computer-use:native-host/preflights/') && isNativeHostProductRef(ref) ? ref : undefined;
}

function nativeHostProductRefsReady(refs: string[]) {
  return refs.length > 0 && refs.every(isNativeHostProductRef);
}

function minimalEvidenceReplayRefsReady(evidenceLedgerRef: string | undefined, refs: string[]) {
  if (!evidenceLedgerRef || refs.length < 4) return false;
  if (!refs.every((ref) => isNativeHostProductRef(ref) && ref.startsWith(`${evidenceLedgerRef}/events/`))) return false;
  const eventTypes = refs.map(nativeHostEventTypeFromReplayRef);
  return Boolean(
    eventTypes.some((type) => type === 'session.created')
    && eventTypes.some((type) => type === 'surface.attached' || type === 'grant.validated' || type === 'frame.read')
    && eventTypes.some((type) => type === 'human-input.accepted')
    && eventTypes.some((type) => type === 'agent.resumed' || type === 'resume-agent'),
  );
}

function nativeHostEventTypeFromReplayRef(ref: string) {
  const leaf = ref.split('/events/')[1]?.split('/')[0] ?? '';
  return leaf.replace(/^\d+-/, '').replace(/\.json$/u, '');
}

function isNativeHostProductRef(ref: string) {
  return ref.startsWith('computer-use:native-host/')
    && isSafeProductRef(ref)
    && isNonFixtureEvidenceRef(ref)
    && !/^computer-use:native-host\/replay(?:[/:]|$)/i.test(ref);
}

function isLiveTruthProductRef(ref: string) {
  return isNativeHostProductRef(ref);
}

function liveTruthRefs(manifest: VirtualAppScreenDogfoodManifest) {
  return uniqueRefs([
    manifest.nativeHost.hostSessionRef ?? undefined,
    manifest.nativeHost.surfaceOwnerRef ?? undefined,
    manifest.nativeHost.displayOwnerRef ?? undefined,
    manifest.nativeHost.liveSurfaceRef ?? undefined,
    manifest.nativeHost.liveBindingAttachGrantRef ?? undefined,
    manifest.nativeHost.grantValidationRef ?? undefined,
    manifest.nativeHost.surfaceTransportRef ?? undefined,
    manifest.nativeHost.frameStreamRef ?? undefined,
    manifest.nativeHost.currentFrameRef ?? undefined,
    manifest.hostSessionRef ?? undefined,
    manifest.surfaceOwnerRef ?? undefined,
    manifest.displayOwnerRef ?? undefined,
  ]);
}

async function realHostEvidenceDogfoodRefs(path: string | undefined): Promise<DogfoodRefs> {
  if (!path?.trim()) return {};
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  if (parsed.schemaVersion !== 'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1') return {};
  if (parsed.status !== 'passed' || parsed.diagnosticOnly !== false) return {};
  const dogfoodRefs = recordValue(parsed.dogfoodRefs) as DogfoodRefs;
  if (!canPassRealHostSession(dogfoodRefs)) return {};
  if (!allRefs(dogfoodRefs).every((ref) => isSafeProductRef(ref) && isNonFixtureEvidenceRef(ref))) return {};
  return dogfoodRefs;
}

function boundedReason(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : String(reason ?? 'blocked');
  return raw.replace(/\s+/g, ' ').replace(/([?&](?:token|secret|password|api[_-]?key|authorization)=)[^&\s]+/gi, '$1[redacted]').slice(0, 240);
}

async function maybeWriteManifest(path: string | undefined, manifest: VirtualAppScreenDogfoodManifest) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode !== null || child.signalCode) return;
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  } else {
    child.kill('SIGKILL');
  }
}

async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${boundedReason(lastError)}`);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate TCP port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
