import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createUserFeedbackConvergence,
  userFeedbackConvergenceHasActionableTodos,
  validateUserFeedbackConvergence,
} from '@sciforge-ui/runtime-contract/user-feedback-convergence';
import type { TaskRunCard } from '@sciforge-ui/runtime-contract/task-run-card';
import { appendTaskAttempt, readRecentTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import { readFailureSignatureRegistry } from '../../src/runtime/failure-signature-registry.js';
import type { TaskAttemptRecord } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-user-feedback-convergence-'));
try {
  await appendTaskAttempt(workspace, attempt({
    id: 'feedback-latency',
    prompt: 'Long research task should show progress instead of appearing stuck.',
    status: 'failed-with-reason',
    failureReason: 'AgentServer generation request timed out after 30000ms.',
    outputRef: '.sciforge/task-results/feedback-latency.json',
    stderrRef: '.sciforge/logs/feedback-latency.stderr.log',
    createdAt: '2026-05-13T00:00:00.000Z',
  }));
  await appendTaskAttempt(workspace, attempt({
    id: 'feedback-crash',
    prompt: 'Failed result should remain readable after malformed backend payload.',
    status: 'repair-needed',
    failureReason: 'Contract validation failed: missing message in backend payload envelope.',
    schemaErrors: ['missing message'],
    outputRef: '.sciforge/task-results/feedback-crash.json',
    stderrRef: '.sciforge/logs/feedback-crash.stderr.log',
    createdAt: '2026-05-13T00:01:00.000Z',
  }));
  await appendTaskAttempt(workspace, attempt({
    id: 'feedback-repeat',
    prompt: 'Stop repeated repair attempts when the same failure returns with no code change.',
    attempt: 1,
    status: 'repair-needed',
    failureReason: 'Repair no-op: repeated same failure with no change.',
    outputRef: '.sciforge/task-results/feedback-repeat.json',
    stderrRef: '.sciforge/logs/feedback-repeat.stderr.log',
    createdAt: '2026-05-13T00:02:00.000Z',
  }));
  await appendTaskAttempt(workspace, attempt({
    id: 'feedback-repeat',
    prompt: 'Stop repeated repair attempts when the same failure returns with no code change.',
    attempt: 2,
    status: 'repair-needed',
    failureReason: 'Repair no-op: repeated same failure with no change on the second attempt.',
    outputRef: '.sciforge/task-results/feedback-repeat.json',
    stderrRef: '.sciforge/logs/feedback-repeat.stderr.log',
    createdAt: '2026-05-13T00:03:00.000Z',
  }));

  const attempts = await readRecentTaskAttempts(workspace, undefined, 20);
  const taskRunCards = attempts.map((item) => item.taskRunCard).filter((card): card is TaskRunCard => Boolean(card));
  const registry = await readFailureSignatureRegistry(workspace);

  const convergence = createUserFeedbackConvergence({
    source: 'R-WF-07-smoke',
    createdAt: '2026-05-13T00:04:00.000Z',
    taskRunCards,
    failureSignatureRegistry: registry,
    signals: [{
      id: 'comment-slow',
      text: '太慢了，卡住没反应。',
      priority: 'high',
      sessionId: 'session-feedback',
      activeRunId: 'feedback-latency',
    }, {
      id: 'comment-crash',
      text: '又崩了，页面白屏。',
      priority: 'urgent',
      activeRunId: 'feedback-crash',
    }, {
      id: 'comment-unclear',
      text: '我看不懂结果，raw trace 太多。',
      priority: 'normal',
      sourceRefs: ['artifact:feedback-report'],
    }, {
      id: 'comment-citation',
      text: '引用不对，证据来源错了。',
      priority: 'high',
      sourceRefs: ['artifact:feedback-report#citation-2'],
    }, {
      id: 'comment-repeat-1',
      text: '不要重复跑一遍。',
      priority: 'high',
      activeRunId: 'feedback-repeat',
    }, {
      id: 'comment-repeat-2',
      text: '又重复执行了，应该复用已有结果。',
      priority: 'high',
      activeRunId: 'feedback-repeat',
    }],
  });

  assert.deepEqual(validateUserFeedbackConvergence(convergence), []);
  assert.equal(userFeedbackConvergenceHasActionableTodos(convergence), true);
  assert.deepEqual(new Set(convergence.todoCandidates.map((todo) => todo.signalKind)), new Set([
    'latency',
    'crash',
    'unclear-result',
    'citation-mismatch',
    'duplicate-work',
  ]));
  const duplicate = convergence.todoCandidates.find((todo) => todo.signalKind === 'duplicate-work');
  assert.equal(duplicate?.occurrenceCount, 2);
  assert.equal(duplicate?.ownerLayer, 'resume');
  assert.ok(duplicate?.failureSignatureRefs.some((ref) => ref.includes('failure')));
  const latency = convergence.todoCandidates.find((todo) => todo.signalKind === 'latency');
  assert.ok(latency?.taskRunCardRefs.some((ref) => ref.includes('feedback-latency')));
  assert.ok(convergence.todoCandidates.every((todo) => todo.noHardcodeReview.appliesGenerally));
  assert.ok(convergence.todoCandidates.every((todo) => todo.noHardcodeReview.forbiddenSpecialCases.includes('prompt-specific apology branch')));
  assert.ok(convergence.nextActions.every((action) => !/sorry|apolog|道歉/i.test(action)));
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('[ok] user feedback convergence folds slow/crash/unclear/citation/duplicate complaints into generic TODO candidates with TaskRunCard and FailureSignature evidence');

function attempt(overrides: Partial<TaskAttemptRecord> & { id: string; prompt: string; status: TaskAttemptRecord['status'] }): TaskAttemptRecord {
  return {
    skillDomain: 'knowledge',
    skillId: 'agentserver.generated-task',
    scenarioPackageRef: { id: 'feedback-convergence', version: '1.0.0', source: 'workspace' },
    attempt: 1,
    outputRef: '.sciforge/task-results/feedback.json',
    stdoutRef: '.sciforge/logs/feedback.stdout.log',
    stderrRef: '.sciforge/logs/feedback.stderr.log',
    createdAt: '2026-05-13T00:00:00.000Z',
    ...overrides,
  } as TaskAttemptRecord;
}
