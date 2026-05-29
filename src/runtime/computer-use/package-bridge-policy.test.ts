import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPackageBridgeFinalVisibleArtifactPolicy,
  normalizePackageBridgeBlockedReason,
} from './package-bridge-policy.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';

function visibleArtifact(ref: string): VirtualRemoteVisibleArtifact {
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
    status: 'visible-and-saved',
    visibleTexts: ['Final report'],
    sourceActionIds: ['action-1'],
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
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
