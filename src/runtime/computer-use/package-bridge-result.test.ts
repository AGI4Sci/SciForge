import assert from 'node:assert/strict';
import { test } from 'node:test';

import { materializePackageBridgeResult } from './package-bridge-result.js';
import type { GenericVisionAction, ScreenshotRef } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';

function screenshot(id: string): ScreenshotRef {
  return {
    id,
    path: `.sciforge/vision-runs/run-1/${id}.png`,
    absPath: `/tmp/sciforge-test/${id}.png`,
    bytes: 10,
    sha256: 'abc123',
    width: 800,
    height: 600,
    captureScope: 'display',
    displayId: 1,
  };
}

function visibleArtifact(ref: string, status: VirtualRemoteVisibleArtifact['status'] = 'visible-and-saved'): VirtualRemoteVisibleArtifact {
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

test('package bridge result materializer fail-closes completed visible-artifact tasks without final artifact refs', () => {
  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-after')],
  });

  assert.equal(materialized.succeeded, false);
  assert.equal(materialized.payloadStatus, 'failed-with-reason');
  assert.equal(materialized.packageResult.status, 'failed-with-reason');
  assert.equal(
    (materialized.packageResult.failureDiagnostics as Record<string, unknown>).failedStage,
    'visible-artifact-final-guard',
  );
  assert.match(materialized.failureReason, /Visible artifact task did not satisfy completion acceptance/i);
  assert.equal(materialized.finalVisibleScreenshotRef, '.sciforge/vision-runs/run-1/step-001-after.png');
});

test('package bridge result materializer preserves completed result with current final artifact refs', () => {
  const artifactRef = '.sciforge/vision-runs/run-1/report.md';
  const materialized = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'completed',
      metrics: { actionCount: 1 },
    },
    task: 'Create a final report artifact for the visible results.',
    executedActions: [{ type: 'click', targetDescription: 'export report' }],
    visibleArtifacts: [visibleArtifact(artifactRef)],
    screenshotLedger: [screenshot('step-001-before'), screenshot('step-001-focus-after')],
  });

  assert.equal(materialized.succeeded, true);
  assert.equal(materialized.payloadStatus, 'done');
  assert.equal(materialized.packageResult.status, 'completed');
  assert.equal(materialized.failureReason, '');
  assert.equal(materialized.finalArtifactRef, artifactRef);
  assert.deepEqual(materialized.finalArtifactRefs, [artifactRef]);
  assert.equal(materialized.finalVisibleScreenshotRef, '.sciforge/vision-runs/run-1/step-001-before.png');
});

test('package bridge result materializer normalizes package diagnostic failure reasons', () => {
  const maxSteps = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'max-steps',
      reason: 'Stopped after max_steps=3 before completion.',
    },
    task: 'Click the visible button.',
    executedActions: [],
    visibleArtifacts: [],
    screenshotLedger: [],
  });
  assert.equal(maxSteps.failureReason, 'Stopped after maxSteps=3 before completion.');

  const highRisk = materializePackageBridgeResult({
    packageResult: {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'needs-confirmation',
      reason: 'high-risk confirmation is required',
    },
    task: 'Submit the form.',
    executedActions: [],
    visibleArtifacts: [],
    screenshotLedger: [],
  });
  assert.equal(highRisk.failureReason, 'High-risk Computer Use action blocked: high-risk confirmation is required');
});
