import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFailureSignature,
  createTaskRunCard,
  taskRunCardStatus,
  validateTaskRunCard,
} from './task-run-card';

test('dedupes failure signatures across noisy transient provider messages', () => {
  const first = createFailureSignature({
    message: 'HTTP Error 429: rate limit for request 12345 at 2026-05-12T01:02:03.000Z',
    providerId: 'arxiv',
    operation: 'paper-search',
    refs: ['log:stderr-a'],
  });
  const second = createFailureSignature({
    message: 'HTTP Error 429: rate limit for request 98765 at 2026-05-12T09:10:11.000Z',
    providerId: 'arxiv',
    operation: 'paper-search',
    refs: ['log:stderr-b'],
  });

  assert.equal(first.kind, 'external-transient');
  assert.equal(first.layer, 'external-provider');
  assert.equal(first.retryable, true);
  assert.equal(first.dedupeKey, second.dedupeKey);
});

test('classifies rate limited wording as provider-neutral transient failure', () => {
  const signature = createFailureSignature({
    message: 'HTTP Error 429: rate limited while fetching external issue metadata',
    providerId: 'issue-api',
    operation: 'metadata-fetch',
  });

  assert.equal(signature.kind, 'external-transient');
  assert.equal(signature.layer, 'external-provider');
  assert.equal(signature.retryable, true);
});

test('marks protocol success with unmet user goal as needs-work', () => {
  const card = createTaskRunCard({
    taskId: 'R-LIT-01',
    goal: 'Search papers, read PDFs, and export an audit bundle.',
    protocolStatus: 'protocol-success',
    taskOutcome: 'needs-work',
    refs: [{ kind: 'artifact', ref: 'artifact:partial-report' }],
    noHardcodeReview: {
      appliesGenerally: true,
      generalityStatement: 'The repair applies to any multi-round research task with preserved refs.',
      counterExamples: ['A one-shot answer with no artifacts should not use this card as completion evidence.'],
    },
  });

  assert.equal(card.status, 'needs-work');
  assert.equal(card.noHardcodeReview.status, 'pass');
  assert.deepEqual(validateTaskRunCard(card), []);
  assert.equal(taskRunCardStatus('protocol-success', 'needs-work'), 'needs-work');
});

test('builds a compact card from execution units and preserved refs', () => {
  const card = createTaskRunCard({
    goal: 'Continue from a failed run without repeating dangerous side effects.',
    executionUnits: [{
      id: 'unit-fetch',
      tool: 'workspace-task',
      params: '{}',
      status: 'needs-human',
      hash: 'abc',
      stdoutRef: '.sciforge/debug/stdout.log',
      stderrRef: '.sciforge/debug/stderr.log',
      failureReason: 'Service unavailable HTTP 503',
      recoverActions: ['Retry after provider backoff.'],
    }],
    failureSignatures: [{ message: 'Service unavailable HTTP 503', providerId: 'pubmed' }],
    verificationRefs: ['verification:v1'],
  });

  assert.equal(card.status, 'needs-human');
  assert.equal(card.genericAttributionLayer, 'external-provider');
  assert.ok(card.refs.some((ref) => ref.ref === 'execution-unit:unit-fetch'));
  assert.ok(card.refs.some((ref) => ref.ref === 'verification:v1'));
  assert.equal(card.failureSignatures[0]?.kind, 'external-transient');
  assert.deepEqual(validateTaskRunCard(card), []);
});
