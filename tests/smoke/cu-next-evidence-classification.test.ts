import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCuNextEvidence,
  validateCuNextEvidenceForProjectCompletion,
} from './cu-next-evidence-classification';
import {
  cuNextCompletionClassificationInput,
} from '../../tools/computer-use-next/completion-grade.js';

test('CU-NEXT classification keeps fixture and package-local evidence out of PROJECT completion', () => {
  const fixture = classifyCuNextEvidence({
    kind: 'fixture',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
  });
  const packageLocal = classifyCuNextEvidence({
    kind: 'package-local',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
  });

  assert.equal(fixture.canCompleteBackend, false);
  assert.equal(fixture.canCompleteL3Workflow, false);
  assert.equal(packageLocal.canCompleteBackend, false);
  assert.equal(packageLocal.canCompleteL3Workflow, false);
  assert.ok(fixture.blockedReasons.some((reason) => reason.includes('fixture evidence')));
  assert.ok(packageLocal.blockedReasons.some((reason) => reason.includes('package-local evidence')));
});

test('CU-NEXT classification does not promote target-bound real evidence to isolated L3', () => {
  const classification = classifyCuNextEvidence({
    kind: 'target-bound-real',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: true,
    sourceToWriterToPreviewCausality: true,
  });

  assert.equal(classification.canCompleteBackend, false);
  assert.equal(classification.canCompleteL3Workflow, false);
  assert.ok(classification.blockedReasons.some((reason) => reason.includes('target-bound-real evidence')));
});

test('CU-NEXT completion classification projects gui-present artifact claims without completionEvidenceRef', () => {
  const input = cuNextCompletionClassificationInput({
    kind: 'target-bound-real',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    finalArtifactRef: 'dense-grounding-export.csv',
    guiPresent: {
      status: 'present',
      recordRef: 'gui-present.json',
      payloadRef: 'tool-payload.json',
      displayedRefs: ['dense-grounding-export.csv'],
    },
    evidenceClaims: [{ kind: 'real-computer-use' }],
  });

  assert.equal(input.completionEvidenceRef, undefined);
  assert.ok(input.evidenceClaims?.some((claim) => claim.kind === 'gui-present-record'));
  const result = validateCuNextEvidenceForProjectCompletion(input, 'l3-workflow');
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes('target-bound-real evidence')));
});

test('CU-NEXT classification lets isolated L1 complete backend but not L3', () => {
  const input = {
    kind: 'isolated-L1',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
  } as const;
  const classification = classifyCuNextEvidence(input);

  assert.equal(classification.canCompleteBackend, true);
  assert.equal(classification.canCompleteL3Workflow, false);
  assert.equal(validateCuNextEvidenceForProjectCompletion(input, 'backend').ok, true);
  assert.equal(validateCuNextEvidenceForProjectCompletion(input, 'l3-workflow').ok, false);
});

test('CU-NEXT classification rejects isolated L3 without same-session causality', () => {
  const missingSession = validateCuNextEvidenceForProjectCompletion({
    kind: 'isolated-L3',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: false,
    sourceToWriterToPreviewCausality: true,
  }, 'l3-workflow');
  const missingCausality = validateCuNextEvidenceForProjectCompletion({
    kind: 'isolated-L3',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: true,
    sourceToWriterToPreviewCausality: false,
  }, 'l3-workflow');

  assert.equal(missingSession.ok, false);
  assert.equal(missingCausality.ok, false);
  assert.ok(missingSession.reasons.some((reason) => reason.includes('same session')));
  assert.ok(missingCausality.reasons.some((reason) => reason.includes('source -> writer -> file-preview')));
});

test('CU-NEXT classification does not infer isolated L3 from acceptance tier without isolated environment proof', () => {
  const result = validateCuNextEvidenceForProjectCompletion({
    acceptanceTier: 'l3-multi-app-workflow',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: true,
    sourceToWriterToPreviewCausality: true,
    completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
    validatorAcceptedL3: true,
    l3Workflow: {
      completed: true,
      sameSession: true,
      sourceToWriterToPreviewCausality: true,
    },
  }, 'l3-workflow');

  assert.equal(result.ok, false);
  assert.notEqual(result.classification.kind, 'isolated-L3');
});

test('CU-NEXT classification accepts valid isolated L3 for L3 completion only', () => {
  const input = {
    kind: 'isolated-L3',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: true,
    sourceToWriterToPreviewCausality: true,
    completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
    validatorAcceptedL3: true,
    l3Workflow: {
      completed: true,
      sameSession: true,
      sourceToWriterToPreviewCausality: true,
    },
  } as const;
  const classification = classifyCuNextEvidence(input);

  assert.equal(classification.canCompleteBackend, false);
  assert.equal(classification.canCompleteL3Workflow, true);
  assert.equal(validateCuNextEvidenceForProjectCompletion(input, 'l3-workflow').ok, true);
});

test('CU-NEXT classification rejects non-canonical completionEvidenceRef strings for isolated L3 completion', () => {
  for (const completionEvidenceRef of [
    '../previous-round/isolated-desktop-l3-workflow-evidence.json',
    'cu-user-acceptance-manifest.json',
    'missing/isolated-desktop-l3-workflow-evidence.json',
    'artifact:isolated-desktop-l3-workflow-evidence.json',
  ]) {
    const result = validateCuNextEvidenceForProjectCompletion(
      validIsolatedL3ClassificationInput(completionEvidenceRef),
      'l3-workflow',
    );

    assert.equal(result.ok, false, `${completionEvidenceRef} must not satisfy isolated L3 completion`);
    assert.ok(
      result.reasons.some((reason) => reason.includes('completionEvidenceRef')),
      `${completionEvidenceRef} should produce a completionEvidenceRef rejection reason`,
    );
  }
});

test('CU-NEXT classification requires explicit completed L3 workflow metadata', () => {
  const result = validateCuNextEvidenceForProjectCompletion({
    kind: 'isolated-L3',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: true,
    sourceToWriterToPreviewCausality: true,
    completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
    validatorAcceptedL3: true,
    l3Workflow: {
      sameSession: true,
      sourceToWriterToPreviewCausality: true,
    },
  }, 'l3-workflow');

  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes('isolated-L3 evidence must be completed')));
});

test('CU-NEXT classification rejects shortcuts, shared input, and shell artifact writes', () => {
  const classification = classifyCuNextEvidence({
    kind: 'isolated-L3',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: true,
    sourceToWriterToPreviewCausality: true,
    sharedSystemInputUsed: true,
    shellDirectArtifactWrite: true,
    evidenceClaims: [
      { kind: 'dom' },
      { kind: 'playwright' },
      { kind: 'accessibility' },
      { kind: 'generated-file-only' },
    ],
  });

  assert.equal(classification.canCompleteL3Workflow, false);
  assert.deepEqual(classification.rejectedShortcuts, ['dom', 'playwright', 'accessibility', 'generated-file-only']);
  assert.ok(classification.blockedReasons.some((reason) => reason.includes('shared system input')));
  assert.ok(classification.blockedReasons.some((reason) => reason.includes('shell direct artifact write')));
});

test('CU-NEXT classification does not let L3 tier override package-local or target-bound evidence kind', () => {
  for (const input of [
    {
      acceptanceTier: 'l3-multi-app-workflow',
      targetEnvironmentKind: 'package-owned-target-bound-window',
    },
    {
      acceptanceTier: 'l3-multi-app-workflow',
      targetEnvironmentKind: 'package-local-virtual-desktop',
    },
    {
      acceptanceTier: 'l3-multi-app-workflow',
      evidenceKind: 'fixture',
    },
  ] as const) {
    const classification = classifyCuNextEvidence({
      ...input,
      status: 'completed',
      userAcceptanceEligible: true,
      diagnosticOnly: false,
      realWindowEvidence: true,
      sameSession: true,
      sourceToWriterToPreviewCausality: true,
      completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
      validatorAcceptedL3: true,
      l3Workflow: {
        completed: true,
        sameSession: true,
        sourceToWriterToPreviewCausality: true,
      },
    });

    assert.equal(classification.canCompleteL3Workflow, false);
    assert.notEqual(classification.kind, 'isolated-L3');
  }
});

function validIsolatedL3ClassificationInput(completionEvidenceRef: string) {
  return {
    kind: 'isolated-L3',
    status: 'completed',
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    realWindowEvidence: true,
    sameSession: true,
    sourceToWriterToPreviewCausality: true,
    completionEvidenceRef,
    validatorAcceptedL3: true,
    l3Workflow: {
      completed: true,
      sameSession: true,
      sourceToWriterToPreviewCausality: true,
    },
  } as const;
}
