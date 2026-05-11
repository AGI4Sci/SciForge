import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConversationStateDigest,
  buildConversationTaskState,
  buildHistoryMutationPolicy,
  classifyInterruption,
  createHistoryBranchRecord,
  evaluateConflictOrderGuard,
  planRecoveryFromTaskState,
  runResumePreflight,
} from './conversation-state-policy.js';

test('task state and recovery plan reuse completed evidence and rerun unfinished work', () => {
  const task = buildConversationTaskState({
    taskId: 'task-1',
    goal: 'finish literature report',
    completedEvidence: [
      { id: 'ev-1', ref: 'artifact:matrix', kind: 'evidence-matrix', status: 'completed', stable: true },
    ],
    pendingWork: [{ id: 'write-report', title: 'Write report', status: 'pending', refs: ['artifact:matrix'] }],
    blockedWork: [{ id: 'verify-cites', title: 'Verify cites', status: 'blocked', refs: ['refs.bib'] }],
    lastFailure: { code: 'timeout', message: 'verification timed out', ref: 'trace:timeout' },
  });

  assert.equal(task.status, 'failed');
  assert.deepEqual(task.pendingWork.map((item) => item.id), ['write-report']);
  assert.deepEqual(task.blockedWork.map((item) => item.id), ['verify-cites']);
  assert.deepEqual(task.recoverableActions.map((item) => item.id), ['resume-pending-work', 'repair-last-failure']);

  const plan = planRecoveryFromTaskState({ taskState: task });
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.reusableEvidenceRefs, ['artifact:matrix']);
  assert.deepEqual(plan.rerunWorkIds, ['write-report', 'verify-cites']);
  assert.equal(plan.sideEffectPolicy, 'idempotent');
});

test('resume preflight marks changed files stale and deleted artifacts invalid', () => {
  const report = runResumePreflight({
    workspace: { path: '/workspace', status: 'ready' },
    sessionStore: { ref: 'session:s1', status: 'ready' },
    artifactRefs: [
      { ref: 'artifact:ok', status: 'ready' },
      { ref: 'artifact:deleted', exists: false },
    ],
    fileHashes: [{ path: 'data.csv', changed: true }],
    capabilityVersions: [{ id: 'search', status: 'ready' }],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(report.invalidatedRefs, ['artifact:deleted']);
  assert.deepEqual(report.staleRefs, ['data.csv']);
  assert.equal(report.sideEffectPolicy, 'needs-human');
  assert.ok(report.requiredActions.some((action) => action.includes('artifact-refs')));
});

test('state digest classifies continuation without carrying invalidated refs or raw history', () => {
  const digest = buildConversationStateDigest({
    prompt: '继续上一轮，但只保留新的范围。',
    taskState: {
      taskId: 'task-2',
      userGoal: 'compare artifacts',
      completedEvidence: [{ id: 'ev-a', ref: 'artifact:a', kind: 'report', status: 'completed', stable: true }],
      pendingWork: [{ id: 'merge', title: 'Merge notes', status: 'pending', refs: ['artifact:a', 'artifact:b'] }],
      artifactRefs: ['artifact:a', 'artifact:b'],
    },
    historyMutation: {
      mode: 'continue',
      conflictRefs: ['artifact:b'],
      affectedTurnIds: ['t3'],
    },
  });

  assert.equal(digest.relation, 'scope-change');
  assert.equal(digest.handoffPolicy, 'digest-and-refs-only');
  assert.deepEqual(digest.carryForwardRefs, ['artifact:a']);
  assert.deepEqual(digest.invalidatedRefs, ['artifact:b']);
  assert.deepEqual(digest.pendingWork, ['merge']);
});

test('history mutation policies distinguish revert from continue branch records', () => {
  const revert = buildHistoryMutationPolicy({
    mode: 'revert',
    affectedTurnIds: ['t2', 't3'],
    derivedRefs: ['artifact:old'],
    discardedRunRefs: ['run:old'],
  });
  assert.equal(revert.inheritState, false);
  assert.equal(revert.discardDerivedState, true);
  assert.deepEqual(revert.discardRefs, ['artifact:old', 'run:old']);
  assert.equal(revert.recommendedNext, 'rerun-from-edit');

  const branch = createHistoryBranchRecord({
    mode: 'continue',
    baseTurnId: 't2',
    beforeMessage: { id: 'm2', content: 'old goal' },
    afterMessage: { id: 'm2', content: 'new goal' },
    affectedTurnIds: ['t3'],
    preserveRefs: ['artifact:old'],
    conflictRefs: ['artifact:old'],
  });
  assert.equal(branch.mode, 'continue');
  assert.equal(branch.recommendedPolicy.inheritState, true);
  assert.deepEqual(branch.conflictRefs, ['artifact:old']);
  assert.deepEqual(branch.preservedRefs, ['artifact:old']);
});

test('interruption classification separates output, tool, repair, and background recovery', () => {
  assert.equal(classifyInterruption({ phase: 'stream output stopped' }).recoveryStrategy, 'continue-stream');
  assert.equal(classifyInterruption({ stage: 'tool call interrupted', traceRef: 'trace:tool' }).recoveryStrategy, 'poll-tool-result');
  assert.equal(classifyInterruption({ kind: 'repair patch interrupted' }).recoveryStrategy, 'resume-repair');
  assert.equal(classifyInterruption({ type: 'background continuation interrupted' }).recoveryStrategy, 'reconcile-background-job');
});

test('conflict order guard rejects stale revisions and serializes concurrent clients', () => {
  const stale = evaluateConflictOrderGuard({
    sessionId: 's1',
    threadId: 'th1',
    expectedRevision: 'r1',
    actualRevision: 'r2',
  });
  assert.equal(stale.decision, 'reject-stale');

  const concurrent = evaluateConflictOrderGuard({
    sessionId: 's1',
    threadId: 'th1',
    expectedRevision: 'r2',
    actualRevision: 'r2',
    activeWriterClientId: 'client-a',
    clientId: 'client-b',
  });
  assert.equal(concurrent.decision, 'serialize');

  const branch = evaluateConflictOrderGuard({
    sessionId: 's1',
    threadId: 'th1',
    expectedRevision: 'r2',
    actualRevision: 'r2',
    activeWriterClientId: 'client-a',
    clientId: 'client-b',
    mutationMode: 'branch',
  });
  assert.equal(branch.decision, 'branch');
});
