import assert from 'node:assert/strict';
import test from 'node:test';

import { buildComplexDialogueBenchmarkReport } from './complex-dialogue-metrics.js';
import { buildComplexMultiturnPresentation } from './complex-multiturn-presentation.js';
import { buildConversationStateDigest, planRecoveryFromTaskState } from './conversation-state-policy.js';

test('projects digest refs into answer-first presentation with raw diagnostics folded', () => {
  const digest = buildConversationStateDigest({
    taskState: {
      taskId: 'fixture-a',
      userGoal: 'finish report',
      completedEvidence: [{ ref: 'artifact:report-draft', kind: 'report', status: 'completed', stable: true }],
      pendingWork: [{ id: 'verify-cites', title: 'Verify citations', status: 'pending', refs: ['artifact:report-draft'] }],
      artifactRefs: ['artifact:report-draft'],
    },
  });

  const presentation = buildComplexMultiturnPresentation({
    id: 'presentation-a',
    title: 'M14 state',
    stateDigest: digest,
    artifactRefs: ['artifact:report-draft'],
    stateAuthority: 'durable-checkpoint',
    rawDiagnosticRefs: ['trace:raw-backend'],
  });

  assert.equal(presentation.status, 'partial');
  assert.ok(presentation.answerBlocks.some((block) => block.id === 'completed-work'));
  assert.equal(presentation.artifactActions[0]?.ref, 'artifact:report-draft');
  assert.equal(presentation.diagnosticsRefs[0]?.foldedByDefault, true);
  assert.equal(presentation.diagnosticsRefs[0]?.defaultVisible, false);
  assert.ok(!presentation.defaultExpandedSections.includes('diagnostics'));
});

test('projects recovery plan as user-visible next action instead of raw trace', () => {
  const recovery = planRecoveryFromTaskState({
    taskState: {
      taskId: 'fixture-b',
      userGoal: 'recover failed run',
      completedEvidence: [{ ref: 'artifact:evidence', kind: 'matrix', status: 'completed', stable: true }],
      blockedWork: [{ id: 'rerun-stage', title: 'Rerun stage', status: 'failed', refs: ['run:failed'] }],
      lastFailure: { code: 'timeout', message: 'stage timed out', ref: 'trace:timeout' },
    },
  });

  const presentation = buildComplexMultiturnPresentation({
    id: 'presentation-b',
    recoveryPlan: recovery,
    stateAuthority: 'task-attempt-ledger',
    rawDiagnosticRefs: ['trace:timeout'],
  });

  assert.equal(presentation.status, 'partial');
  assert.ok(presentation.keyFindings.some((finding) => finding.id === 'recovery-plan'));
  assert.equal(presentation.nextActions[0]?.kind, 'recover');
  assert.ok(presentation.answerBlocks.some((block) => block.id === 'continuation-options' && block.items?.some((item) => item.includes('Rerun'))));
});

test('projects ComplexMultiTurnFixture failure state with artifact refs and folded failure diagnostics', () => {
  const presentation = buildComplexMultiturnPresentation({
    id: 'presentation-failure-fixture',
    fixture: {
      id: 'fixture-failure',
      title: 'Failed lifecycle recovery fixture',
      expectedState: {
        taskGraph: {
          currentGoal: 'recover failed verification',
          completed: ['draft report produced'],
          pending: [],
          blocked: ['verify-citations'],
        },
        checkpointRefs: ['checkpoint:failed-run'],
        reusableRefs: ['artifact:draft-report'],
        staleRefs: [],
        backgroundJobs: [],
        requiredStateExplanation: ['failed verifier must expose recovery, not raw trace only'],
      },
      artifactExpectations: {
        expectedArtifacts: ['artifact:draft-report'],
        requiredObjectRefs: ['artifact:draft-report'],
        artifactLineage: ['artifact:draft-report:v1'],
        identityAssertions: ['draft report ref remains stable'],
        mutationPolicy: 'append-revision',
      },
      failureInjections: [{
        id: 'timeout-1',
        mode: 'timeout',
        target: 'verify-citations',
        expectedRecovery: 'Resume verifier from checkpoint without redownloading evidence.',
        reusableEvidence: ['artifact:draft-report'],
        shouldAvoidDuplicateSideEffect: true,
      }],
      presentationSnapshots: [{ status: 'failed' }],
    },
  });

  assert.equal(presentation.status, 'failed');
  assert.ok(presentation.answerBlocks.some((block) => block.id === 'completed-work' && block.items?.includes('draft report produced')));
  assert.ok(presentation.answerBlocks.some((block) => block.id === 'continuation-options' && block.items?.some((item) => item.includes('Resume verifier'))));
  assert.ok(presentation.artifactActions.some((action) => action.ref === 'artifact:draft-report'));
  assert.ok(presentation.diagnosticsRefs.some((diagnostic) => diagnostic.id === 'failure-timeout-1'));
  assert.ok(!presentation.defaultExpandedSections.includes('diagnostics'));
});

test('projects lifecycle/history mutation boundaries and benchmark evidence', () => {
  const digest = buildConversationStateDigest({
    prompt: 'continue after branch merge',
    taskState: {
      taskId: 'fixture-c',
      userGoal: 'merge branches',
      completedEvidence: [{ ref: 'artifact:branch-a', kind: 'report', status: 'completed', stable: true }],
      backgroundJobs: [{ id: 'bg-1', status: 'running', title: 'Background verification', refs: ['artifact:branch-a'] }],
    },
    historyMutation: { mode: 'merge', conflictRefs: ['artifact:branch-b'], affectedTurnIds: ['t2'] },
  });
  const benchmarkReport = buildComplexDialogueBenchmarkReport({
    benchmarkId: 'fixture-c',
    events: [
      { id: 'u', type: 'turn-start', category: 'user', timeMs: 0 },
      { id: 'p', type: 'first-readable-result', category: 'progress', timeMs: 10, qualitySignals: { userVisible: true, partialResult: true } },
      { id: 'f', type: 'final-summary', category: 'assistant', timeMs: 20, qualitySignals: { userVisible: true, finalResult: true, evidenceRefs: 1, artifactRefs: 1 } },
    ],
  });

  const presentation = buildComplexMultiturnPresentation({
    id: 'presentation-c',
    stateDigest: digest,
    benchmarkReport,
    stateAuthority: 'history-summary',
    historyMutationMode: 'merge',
  });

  assert.equal(presentation.status, 'background-running');
  assert.ok(presentation.answerBlocks.some((block) => block.items?.some((item) => item.includes('merge'))));
  assert.ok(presentation.inlineCitations.some((citation) => citation.id === 'benchmark-report'));
  assert.ok(presentation.confidenceExplanation?.summary?.includes('Benchmark quality'));
});
