import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPackageBridgeFinalVisibleArtifactPolicy,
  classifyPackageBridgeAcceptanceEvidence,
  normalizePackageBridgeBlockedReason,
  packageBridgeEvidenceSatisfiesProductSmoke,
} from './package-bridge-policy.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';

function visibleArtifact(
  ref: string,
  status: VirtualRemoteVisibleArtifact['status'] = 'visible-and-saved',
): VirtualRemoteVisibleArtifact {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-remote-artifact.v1',
    id: 'artifact-1',
    kind: 'virtual-document',
    title: 'report.md',
    artifactRef: ref,
    path: ref,
    dataRef: ref,
    appId: 'computer-use-package-bridge',
    delivery: 'virtual-remote-session-artifact',
    status,
    visibleTexts: ['Final report'],
    sourceActionIds: ['action-1'],
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
  };
}

function productSmokeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    productPathClassification: {
      tier: 'product-smoke',
      currentBundleOnly: true,
      diagnosticOnly: false,
      packageDiagnosticOnly: false,
      currentBundleRef: '.sciforge/vision-runs/current-run',
      appServerRunRef: '.sciforge/vision-runs/current-run/app-server-run.json',
      nativePluginInvocationRef: '.sciforge/vision-runs/current-run/native-plugin-invocation.json',
      sciforgeComputerUseRunTaskRef: '.sciforge/vision-runs/current-run/run-task.json',
      platformSidecarIsolationReportRef: '.sciforge/vision-runs/current-run/platform-sidecar-isolation.json',
      hops: [
        'codex-app-server',
        'codex-native-plugin',
        'sciforge-computer-use',
        'native-platform-sidecar',
      ],
    },
    virtualDisplayGroup: {
      displayGroupId: 'display-group-1',
      ref: '.sciforge/vision-runs/current-run/display-group.json',
      screens: [{
        screenId: 'screen-1',
        ref: '.sciforge/vision-runs/current-run/screen-1.json',
        targetWindowId: 'window-1',
        targetWindowRef: '.sciforge/vision-runs/current-run/window-1.json',
      }],
    },
    targetWindowRef: '.sciforge/vision-runs/current-run/window-1.json',
    actorCursorProvenance: [{
      actorId: 'actor-1',
      cursorId: 'cursor-1',
      screenId: 'screen-1',
      actorCursorLogRef: '.sciforge/vision-runs/current-run/actor-cursor-log.jsonl',
    }],
    userControlPlane: {
      sessionPermissionRef: '.sciforge/vision-runs/current-run/session-permission.json',
      allowedAppRefs: ['.sciforge/vision-runs/current-run/allowed-apps.json'],
      allowedWindowRefs: ['.sciforge/vision-runs/current-run/allowed-windows.json'],
      forbiddenAppRefs: ['.sciforge/vision-runs/current-run/forbidden-apps.json'],
      inputModalityPolicyRef: '.sciforge/vision-runs/current-run/input-modality-policy.json',
      riskPreviewRef: '.sciforge/vision-runs/current-run/risk-preview.json',
      dataVisibilityRef: '.sciforge/vision-runs/current-run/data-visibility.json',
      stopRef: '.sciforge/vision-runs/current-run/stop.json',
      approvalMode: 'preapproved',
    },
    platformSidecarIsolationReport: {
      status: 'passed',
      backendKind: 'native-platform-sidecar',
      reportRef: '.sciforge/vision-runs/current-run/platform-sidecar-isolation.json',
      captureRef: '.sciforge/vision-runs/current-run/platform-capture.json',
      stateRef: '.sciforge/vision-runs/current-run/platform-state.json',
      preflightRef: '.sciforge/vision-runs/current-run/platform-preflight.json',
      executorAdapterRef: '.sciforge/vision-runs/current-run/executor-adapter.json',
    },
    actionLedgerRef: '.sciforge/vision-runs/current-run/action-ledger.json',
    evidenceIndexRef: '.sciforge/vision-runs/current-run/evidence-index.json',
    evidenceLedger: {
      ref: '.sciforge/vision-runs/current-run/action-ledger.json',
      actionRecords: [{
        executorEventRef: '.sciforge/vision-runs/current-run/action-1-executor.json',
        beforeEvidenceRefs: ['.sciforge/vision-runs/current-run/action-1-before.json'],
        afterEvidenceRefs: ['.sciforge/vision-runs/current-run/action-1-after.json'],
        verificationRefs: ['.sciforge/vision-runs/current-run/action-1-verification.json'],
      }],
    },
    replayBundle: {
      ref: '.sciforge/vision-runs/current-run/replay.json',
      frames: [{
        screenId: 'screen-1',
        screenshotRef: '.sciforge/vision-runs/current-run/frame-1.png',
        cursorOverlayRefs: ['.sciforge/vision-runs/current-run/cursor-overlay-1.json'],
      }],
      cursorOverlayRefs: ['.sciforge/vision-runs/current-run/cursor-overlay-1.json'],
      leaseOwnerRefs: ['.sciforge/vision-runs/current-run/lease-owner-1.json'],
      beforeEvidenceRefs: ['.sciforge/vision-runs/current-run/action-1-before.json'],
      afterEvidenceRefs: ['.sciforge/vision-runs/current-run/action-1-after.json'],
    },
    ...overrides,
  };
}

test('package bridge policy normalizes high-risk confirmation and max steps reasons', () => {
  const highRisk = normalizePackageBridgeBlockedReason({
    status: 'needs-confirmation',
    reason: 'confirmation required for high-risk submit action',
  }, 'needs-confirmation');
  assert.equal(
    highRisk,
    'High-risk Computer Use action blocked: confirmation required for high-risk submit action',
  );

  const maxSteps = normalizePackageBridgeBlockedReason({
    status: 'max-steps',
    reason: 'Stopped after max_steps=3 before completion.',
  }, 'max-steps');
  assert.equal(maxSteps, 'Stopped after maxSteps=3 before completion.');
});

test('package bridge policy fail-closes completed visible-artifact tasks without final artifact', () => {
  const guarded = applyPackageBridgeFinalVisibleArtifactPolicy({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [],
  });

  assert.equal(guarded.status, 'failed-with-reason');
  assert.match(String(guarded.reason), /Visible artifact task did not satisfy completion acceptance/i);
  assert.equal(
    (guarded.failureDiagnostics as Record<string, unknown>).failedStage,
    'visible-artifact-final-guard',
  );
});

test('package bridge policy preserves completed visible-artifact tasks with final artifact', () => {
  const packageResult = {
    schemaVersion: 'sciforge.computer-use.result.v1',
    status: 'completed',
  };
  const guarded = applyPackageBridgeFinalVisibleArtifactPolicy({
    packageResult,
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [visibleArtifact('.sciforge/vision-runs/run-1/report.md')],
  });

  assert.equal(guarded, packageResult);
});

test('package bridge policy preserves completed visible-artifact tasks with draft-visible report artifact', () => {
  const packageResult = {
    schemaVersion: 'sciforge.computer-use.result.v1',
    status: 'completed',
  };
  const guarded = applyPackageBridgeFinalVisibleArtifactPolicy({
    packageResult,
    task: 'Create a short local visible report artifact in the editor body.',
    executedActions: [{ type: 'type_text', text: 'Visible report body' }],
    visibleArtifacts: [visibleArtifact('.sciforge/vision-runs/run-1/report.md', 'draft-visible')],
  });

  assert.equal(guarded, packageResult);
});

test('package bridge policy classifies package-only L3 bundle as package diagnostic', () => {
  const classification = classifyPackageBridgeAcceptanceEvidence({
    acceptanceTier: 'l3-multi-app-workflow',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    productPathClassification: {
      tier: 'package-diagnostic',
      packageDiagnosticOnly: true,
      currentBundleOnly: true,
      currentBundleRef: '.sciforge/vision-runs/run-1',
      entrypoint: 'runtime-codex-native-route/package-bridge',
    },
  });

  assert.equal(classification.tier, 'package-diagnostic');
  assert.equal(classification.canSatisfyProductSmoke, false);
  assert.ok(classification.reasons.includes('package-diagnostic-evidence-cannot-satisfy-product-smoke'));
});

test('package bridge policy rejects diagnostic evidence for product smoke even with completed user-eligible flags', () => {
  const diagnosticEvidence = {
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    evidenceTier: 'package-diagnostic',
    packageDiagnosticOnly: true,
    currentBundleOnly: true,
  } as const;

  assert.equal(packageBridgeEvidenceSatisfiesProductSmoke(diagnosticEvidence), false);
  assert.equal(
    classifyPackageBridgeAcceptanceEvidence(diagnosticEvidence).canSatisfyProductSmoke,
    false,
  );
});

test('package bridge policy accepts product smoke only when current bundle refs are present', () => {
  const classification = classifyPackageBridgeAcceptanceEvidence(productSmokeEvidence());

  assert.equal(classification.tier, 'product-smoke');
  assert.equal(classification.canSatisfyProductSmoke, true);
  assert.equal(classification.reasons.includes('current-bundle-only-package-bridge-evidence'), false);
});

test('package bridge policy rejects native-looking product smoke claims without required refs', () => {
  const classification = classifyPackageBridgeAcceptanceEvidence({
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    taskId: 'native-product-smoke-task',
    scenarioId: 'desktop-native-smoke-scenario',
    packageBundleRef: '.sciforge/vision-runs/current-run',
    marker: 'product-smoke',
    productPathClassification: {
      tier: 'product-smoke',
      currentBundleOnly: true,
      diagnosticOnly: false,
      packageDiagnosticOnly: false,
      entrypoint: 'runtime-codex-native-route/package-bridge',
      hops: [
        'codex-app-server',
        'codex-native-plugin',
        'sciforge-computer-use',
        'native-platform-sidecar',
      ],
    },
  });

  assert.equal(classification.tier, 'package-diagnostic');
  assert.equal(classification.canSatisfyProductSmoke, false);
  assert.ok(classification.reasons.includes('missing-native-plugin-invocation-ref'));
  assert.ok(classification.reasons.includes('missing-display-group-ref'));
  assert.ok(classification.reasons.includes('missing-user-control-ref'));
  assert.ok(classification.reasons.includes('missing-independent-action-ledger-ref'));
  assert.ok(classification.reasons.includes('missing-replay-bundle-ref'));
  assert.equal(classification.reasons.includes('current-bundle-only-package-bridge-evidence'), false);
});
