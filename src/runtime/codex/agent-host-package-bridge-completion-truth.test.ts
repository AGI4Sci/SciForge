import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completionTruthFromPackageBridgeWorkEvidence,
} from './agent-host-package-bridge-completion-truth.js';

test('package bridge completion adapter maps verified same-run workEvidence to workflow completionTruth', () => {
  const runDir = '.sciforge/vision-runs/package-bridge-complete';
  const truth = completionTruthFromPackageBridgeWorkEvidence({
    evidenceRefs: [
      `${runDir}/vision-trace.json`,
      `${runDir}/tui-host-run-task-chain.json`,
      'gui.present:fake-screen',
    ],
    workEvidence: [{
      kind: 'validate',
      provider: 'computer-use-package-bridge',
      status: 'verified',
      outputSummary: 'Computer Use completion-grade evidence',
      evidenceRefs: [
        `${runDir}/cu-user-acceptance-input.json`,
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
        'https://example.invalid/leak',
      ],
      recoverActions: [],
    }],
  });

  assert.deepEqual(truth, {
    schemaVersion: 'sciforge.computer-use.completion-truth.v1',
    scope: 'workflow',
    status: 'satisfied',
    validator: 'current-run-live-acceptance-bundle',
    evidenceRefs: [
      `${runDir}/vision-trace.json`,
      `${runDir}/tui-host-run-task-chain.json`,
      `${runDir}/cu-user-acceptance-manifest.json`,
      `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
    ],
  });
});

test('package bridge completion adapter keeps blocked workEvidence from satisfying completionTruth', () => {
  const runDir = '.sciforge/vision-runs/package-bridge-blocked';
  const truth = completionTruthFromPackageBridgeWorkEvidence({
    evidenceRefs: [
      `${runDir}/vision-trace.json`,
      `${runDir}/tui-host-run-task-chain.json`,
    ],
    workEvidence: [{
      kind: 'validate',
      provider: 'computer-use-package-bridge',
      status: 'blocked',
      outputSummary: 'Computer Use completion-grade evidence',
      failureReason: 'canonical L3 evidence is missing token=should-not-leak',
      evidenceRefs: [
        `${runDir}/completion-grade-diagnostics.json`,
        'gui.present:fake-completion',
      ],
      recoverActions: [`Produce canonical isolated-desktop-l3-workflow-evidence.json in ${runDir}`],
    }],
  });

  assert.equal(truth?.status, 'blocked');
  assert.equal(truth?.scope, 'workflow');
  assert.deepEqual(truth?.evidenceRefs, [
    `${runDir}/vision-trace.json`,
    `${runDir}/tui-host-run-task-chain.json`,
    `${runDir}/completion-grade-diagnostics.json`,
  ]);
  assert.doesNotMatch(JSON.stringify(truth), /token|gui\.present/);
});

test('package bridge completion adapter blocks verified workEvidence without same-run completion refs', () => {
  const runDir = '.sciforge/vision-runs/package-bridge-incomplete';
  const truth = completionTruthFromPackageBridgeWorkEvidence({
    evidenceRefs: [
      `${runDir}/vision-trace.json`,
      `${runDir}/tui-host-run-task-chain.json`,
    ],
    workEvidence: [{
      kind: 'validate',
      provider: 'computer-use-package-bridge',
      status: 'verified',
      outputSummary: 'Computer Use completion-grade evidence',
      evidenceRefs: [
        `${runDir}/cu-user-acceptance-manifest.json`,
        '.sciforge/vision-runs/other/isolated-desktop-l3-workflow-evidence.json',
      ],
      recoverActions: [],
    }],
  });

  assert.equal(truth?.status, 'blocked');
  assert.match(truth?.reason ?? '', /same current-run/i);
  assert.doesNotMatch(JSON.stringify(truth), /vision-runs\/other/);
});

test('package bridge completion adapter ignores non-package artifact workEvidence', () => {
  const runDir = '.sciforge/vision-runs/generated-task-artifact';
  const truth = completionTruthFromPackageBridgeWorkEvidence({
    evidenceRefs: [
      `${runDir}/vision-trace.json`,
      `${runDir}/tui-host-run-task-chain.json`,
    ],
    workEvidence: [{
      kind: 'generated-task-artifact',
      provider: 'generated-task-runner',
      status: 'success',
      outputSummary: 'Generated artifact completion candidate',
      evidenceRefs: [
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
        'artifact:final-report',
      ],
      artifactRefs: ['artifact:final-report'],
    }],
  });

  assert.equal(truth, undefined);
});
