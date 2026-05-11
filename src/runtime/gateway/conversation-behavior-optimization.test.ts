import assert from 'node:assert/strict';
import test from 'node:test';

import { optimizeConversationBehavior } from './conversation-behavior-optimization.js';

test('classifies generic long report research and speed-first signals', () => {
  const decision = optimizeConversationBehavior({
    prompt: '先给 quick partial summary，然后继续做 comprehensive research report with citations.',
    executionModePlan: { signals: ['research', 'artifact-output', 'long-or-uncertain'] },
    latencyPolicy: { allowBackgroundCompletion: true, firstVisibleResponseMs: 1200 },
    evidence: [{ status: 'success', evidenceRefs: ['trace:seed'] }],
    partial: { summary: 'Seed answer' },
  });

  assert.equal(decision.latencyTier, 'quick');
  assert.ok(decision.intent.signals.includes('long'));
  assert.ok(decision.intent.signals.includes('report'));
  assert.ok(decision.intent.signals.includes('research'));
  assert.ok(decision.intent.signals.includes('speed-first'));
  assert.equal(decision.evidenceSufficiency.enoughForCurrentTurn, true);
});

test('stops foreground escalation when partial evidence answers the speed-first turn', () => {
  const decision = optimizeConversationBehavior({
    prompt: '先给结论，剩下的后台继续',
    speedFirst: true,
    evidence: [{ status: 'success', evidenceRefs: ['file:.sciforge/evidence/current.json'] }],
    partial: { summary: 'Current answer', evidenceRefs: ['file:.sciforge/evidence/current.json'] },
    pendingWork: [{ id: 'deep-verification' }, { id: 'extra-fetch' }],
  });

  assert.equal(decision.escalation.action, 'background');
  assert.equal(decision.escalation.stopForegroundExpansion, true);
  assert.deepEqual(decision.escalation.optionalContinuationItems, ['deep-verification', 'extra-fetch']);
  assert.equal(decision.partialReportPlan.finalReportDeferred, false);
});

test('requires more evidence for report granularity without table-like support', () => {
  const decision = optimizeConversationBehavior({
    prompt: '生成 report',
    evidence: [{ status: 'success', evidenceRefs: ['trace:one'] }],
  });

  assert.equal(decision.evidenceSufficiency.requiredGranularity, 'report');
  assert.equal(decision.evidenceSufficiency.level, 'partial');
  assert.equal(decision.evidenceSufficiency.enoughForCurrentTurn, false);
  assert.ok(decision.evidenceSufficiency.missing.includes('evidence:multiple-independent-items'));
  assert.ok(decision.evidenceSufficiency.missing.includes('evidence:table-or-matrix'));
});

test('reuses repeated query ref failure signature and verifier result by default', () => {
  const decision = optimizeConversationBehavior({
    previousWork: [
      { query: 'topic A', status: 'done', stable: true },
      { ref: 'file:input.csv', status: 'done', stable: true },
      { failureSignature: 'provider-timeout', status: 'failed' },
      { verifierResult: 'schema-pass:artifact-1', status: 'verified', stable: true },
    ],
    toolCandidates: [
      { id: 'search-again', query: 'topic A', kind: 'search' },
      { id: 'read-again', ref: 'file:input.csv', kind: 'read' },
      { id: 'same-failure', failureSignature: 'provider-timeout', kind: 'retry' },
      { id: 'same-verifier', verifierResult: 'schema-pass:artifact-1', kind: 'verify' },
    ],
  });

  assert.deepEqual(decision.repeatedWorkGuard.skipKeys.sort(), [
    'failure:provider-timeout',
    'query:topic a',
    'ref:file:input.csv',
    'verifier:schema-pass:artifact-1',
  ]);
  assert.equal(decision.parallelWorkPlan.tasks.every((task) => task.state === 'skipped'), true);
});

test('plans independent reads in parallel and serializes write conflicts', () => {
  const decision = optimizeConversationBehavior({
    latencyTier: 'bounded',
    toolCandidates: [
      { id: 'scan-a', kind: 'artifact-scan', readSet: ['artifact:a'], writeSet: [], sideEffectClass: 'read', criticalPath: true },
      { id: 'scan-b', kind: 'reference-check', readSet: ['artifact:b'], writeSet: [], sideEffectClass: 'read', criticalPath: true },
      { id: 'write-1', kind: 'materialize', readSet: ['draft'], writeSet: ['artifact:out'], sideEffectClass: 'workspace-write' },
      { id: 'write-2', kind: 'annotate', readSet: ['draft'], writeSet: ['artifact:out'], sideEffectClass: 'workspace-write' },
      { id: 'sidecar', kind: 'verification', readSet: ['artifact:out'], writeSet: [], sideEffectClass: 'read', sidecar: true },
    ],
  });

  const critical = decision.parallelWorkPlan.batches.find((batch) => batch.id === 'batch-critical-read');
  assert.deepEqual(critical?.taskIds, ['scan-a', 'scan-b']);
  assert.equal(critical?.mode, 'parallel');
  assert.ok(decision.parallelWorkPlan.conflicts.some((conflict) => conflict.resource === 'artifact:out'));
  assert.ok(decision.parallelWorkPlan.batches.some((batch) => batch.id === 'batch-serial-write-1'));
  assert.ok(decision.parallelWorkPlan.batches.some((batch) => batch.id === 'batch-serial-write-2'));
  assert.equal(decision.parallelWorkPlan.batches.find((batch) => batch.id === 'batch-sidecar-read')?.blocksFirstResult, false);
});

test('downgrades budget and emits structured backend handoff directive codes', () => {
  const decision = optimizeConversationBehavior({
    prompt: '继续生成报告',
    budget: { remainingToolCalls: 1, maxToolCalls: 12, remainingMs: 500, maxMs: 10_000 },
    currentReferenceDigests: [{ ref: 'file:input-digest.json' }],
    artifacts: [{ artifactRef: 'artifact:report-draft' }],
    evidence: [{ status: 'success', evidenceRefs: ['trace:e1'], evidenceTable: true }],
    partial: { summary: 'Draft' },
    pendingWork: [{ id: 'download-more' }],
  });

  assert.equal(decision.budgetDowngrade.active, true);
  assert.equal(decision.budgetDowngrade.level, 'strong');
  assert.ok(decision.budgetDowngrade.disabledWork.includes('deep-verification'));
  assert.ok(decision.backendHandoffDirective.directiveCodes.includes('handoff:structured-contract'));
  assert.ok(decision.backendHandoffDirective.directiveCodes.includes('handoff:budget-downgraded'));
  assert.equal(decision.backendHandoffDirective.structuredOnly, true);
  assert.deepEqual(decision.backendHandoffDirective.stateRefs.sort(), [
    'artifact:report-draft',
    'file:input-digest.json',
    'trace:e1',
  ]);
});

test('detects recovery followup and scope-change from state facts', () => {
  const decision = optimizeConversationBehavior({
    prompt: '调整一下范围，继续上一轮',
    contextPolicy: { mode: 'continue' },
    artifacts: [{ id: 'prior-output', status: 'done' }],
    recentFailures: [{ status: 'timeout', failureReason: 'deadline' }],
    userGuidanceQueue: [{ id: 'narrow-scope' }],
  });

  assert.ok(decision.intent.signals.includes('recovery'));
  assert.ok(decision.intent.signals.includes('followup'));
  assert.ok(decision.intent.signals.includes('scope-change'));
  assert.equal(decision.evidenceSufficiency.requiredGranularity, 'audit');
});
