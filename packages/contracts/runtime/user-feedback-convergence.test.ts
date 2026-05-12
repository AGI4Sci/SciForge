import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFailureSignature,
  createFailureSignatureRegistry,
  createTaskRunCard,
  mergeFailureSignaturesIntoRegistry,
} from './task-run-card';
import {
  USER_FEEDBACK_CONVERGENCE_CONTRACT_ID,
  USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION,
  createUserFeedbackConvergence,
  mergeUserFeedbackConvergence,
  normalizeUserFeedbackSignal,
  userFeedbackConvergenceHasActionableTodos,
  validateUserFeedbackConvergence,
} from './user-feedback-convergence';

test('user feedback convergence turns repeated complaints into generic TODO candidates with runtime evidence', () => {
  const timeoutSignature = createFailureSignature({
    kind: 'timeout',
    message: 'AgentServer generation request timed out after 30000ms.',
    refs: ['file:.sciforge/logs/run-timeout.stderr.log'],
  });
  const repairNoopSignature = createFailureSignature({
    kind: 'repair-no-op',
    message: 'Repair no-op: repeated same failure with no change.',
    refs: ['file:.sciforge/logs/repair.stderr.log'],
  });
  const taskRunCards = [
    createTaskRunCard({
      id: 'latency-card',
      goal: 'Finish long-running research without passive disconnect.',
      protocolStatus: 'protocol-failed',
      taskOutcome: 'needs-work',
      failureSignatures: [timeoutSignature],
      refs: [{ kind: 'run', ref: 'run:slow' }],
      genericAttributionLayer: 'runtime-server',
    }),
    createTaskRunCard({
      id: 'presentation-card',
      goal: 'Show a readable failed result.',
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-work',
      genericAttributionLayer: 'presentation',
      refs: [{ kind: 'artifact', ref: 'artifact:report' }],
    }),
    createTaskRunCard({
      id: 'duplicate-card',
      goal: 'Stop repeated no-op repairs.',
      protocolStatus: 'protocol-failed',
      taskOutcome: 'needs-work',
      failureSignatures: [repairNoopSignature],
      refs: [{ kind: 'run', ref: 'run:repeat' }],
      genericAttributionLayer: 'resume',
    }),
  ];
  const registry = mergeFailureSignaturesIntoRegistry(createFailureSignatureRegistry(), {
    runId: 'task-attempt:repeat:1',
    taskId: 'repeat',
    status: 'repair-needed',
    createdAt: '2026-05-13T00:00:00.000Z',
    refs: ['run:repeat'],
    failureSignatures: [timeoutSignature, repairNoopSignature],
  });

  const convergence = createUserFeedbackConvergence({
    source: 'feedback-inbox',
    createdAt: '2026-05-13T00:01:00.000Z',
    taskRunCards,
    failureSignatureRegistry: registry,
    signals: [{
      id: 'slow-1',
      text: '太慢了，一直转圈等很久。',
      priority: 'high',
      sessionId: 'session-1',
      activeRunId: 'slow',
    }, {
      id: 'slow-2',
      text: '卡住没反应，像 timeout。',
      priority: 'normal',
    }, {
      id: 'crash-1',
      text: '页面又崩了，只看到白屏。',
      priority: 'urgent',
    }, {
      id: 'unclear-1',
      text: '结果看不懂，raw trace 太多。',
      priority: 'normal',
    }, {
      id: 'citation-1',
      text: '这里引用不对，来源不可信。',
      priority: 'high',
    }, {
      id: 'duplicate-1',
      text: '别重复跑一遍，复用已有结果。',
      priority: 'high',
      activeRunId: 'repeat',
    }],
  });

  assert.equal(convergence.schemaVersion, USER_FEEDBACK_CONVERGENCE_SCHEMA_VERSION);
  assert.equal(convergence.contract, USER_FEEDBACK_CONVERGENCE_CONTRACT_ID);
  assert.equal(convergence.status, 'ready');
  assert.equal(userFeedbackConvergenceHasActionableTodos(convergence), true);
  assert.deepEqual(validateUserFeedbackConvergence(convergence), []);
  assert.deepEqual(convergence.unclassifiedSignalIds, []);
  assert.deepEqual(new Set(convergence.signals.map((signal) => signal.kind)), new Set([
    'latency',
    'crash',
    'unclear-result',
    'citation-mismatch',
    'duplicate-work',
  ]));
  const latency = convergence.todoCandidates.find((todo) => todo.signalKind === 'latency');
  assert.equal(latency?.occurrenceCount, 2);
  assert.equal(latency?.ownerLayer, 'runtime-server');
  assert.ok(latency?.taskRunCardRefs.some((ref) => ref.includes('latency-card')));
  assert.ok(latency?.failureSignatureRefs.some((ref) => ref.startsWith('failure:') || ref.startsWith('failure-registry:')));
  const duplicate = convergence.todoCandidates.find((todo) => todo.signalKind === 'duplicate-work');
  assert.equal(duplicate?.ownerLayer, 'resume');
  assert.ok(duplicate?.failureSignatureRefs.some((ref) => ref.includes('failure')));
  assert.ok(convergence.todoCandidates.every((todo) => todo.noHardcodeReview.status === 'pass'));
  assert.ok(convergence.todoCandidates.every((todo) => todo.noHardcodeReview.forbiddenSpecialCases.includes('backend-specific success path')));
  assert.ok(convergence.nextActions.every((action) => !/sorry|apolog/i.test(action)));
});

test('user feedback convergence normalizes synonyms and leaves unknown feedback for human triage', () => {
  assert.equal(normalizeUserFeedbackSignal({ id: 'a', text: '没反应，等太久' }).kind, 'latency');
  assert.equal(normalizeUserFeedbackSignal({ id: 'b', text: 'duplicate rerun again and again' }).kind, 'duplicate-work');
  assert.equal(normalizeUserFeedbackSignal({ id: 'c', text: 'citation unsupported by source' }).kind, 'citation-mismatch');

  const convergence = createUserFeedbackConvergence({
    signals: [{ id: 'unknown-1', text: '这个地方需要看看，但我还没想好。', priority: 'low' }],
  });

  assert.equal(convergence.status, 'ready');
  assert.deepEqual(convergence.unclassifiedSignalIds, ['unknown-1']);
  assert.equal(convergence.todoCandidates[0]?.signalKind, 'unknown');
  assert.match(convergence.nextActions.at(-1) ?? '', /Human-triage/);
});

test('user feedback convergence merges duplicate TODO candidates by signal kind and owner layer', () => {
  const first = createUserFeedbackConvergence({
    createdAt: '2026-05-13T00:00:00.000Z',
    signals: [{ id: 'slow-1', text: 'slow response', priority: 'normal' }],
  });
  const second = createUserFeedbackConvergence({
    createdAt: '2026-05-13T00:02:00.000Z',
    signals: [{ id: 'slow-2', text: '卡住等太久', priority: 'high' }],
  });

  const merged = mergeUserFeedbackConvergence(first, second);

  assert.equal(merged.createdAt, '2026-05-13T00:02:00.000Z');
  assert.equal(merged.todoCandidates.filter((todo) => todo.signalKind === 'latency').length, 1);
  const latency = merged.todoCandidates.find((todo) => todo.signalKind === 'latency');
  assert.deepEqual(latency?.sourceSignalIds, ['slow-1', 'slow-2']);
  assert.equal(latency?.severity, 'high');
});

test('user feedback convergence is empty without signals', () => {
  const convergence = createUserFeedbackConvergence({ signals: [] });
  assert.equal(convergence.status, 'empty');
  assert.equal(userFeedbackConvergenceHasActionableTodos(convergence), false);
  assert.match(convergence.diagnostics[0] ?? '', /No user feedback/);
});
