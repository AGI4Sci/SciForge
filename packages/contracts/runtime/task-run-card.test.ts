import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFailureSignature,
  createFailureSignatureRegistry,
  createTaskRunCard,
  mergeFailureSignaturesIntoRegistry,
  taskRunCardStatus,
  validateFailureSignatureRegistry,
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

test('classifies runtime timeout separately from provider transient timeout', () => {
  const runtime = createFailureSignature({
    message: 'AgentServer generation request timed out after 30000ms.',
  });
  const provider = createFailureSignature({
    message: 'External provider timed out after 30000ms.',
  });

  assert.equal(runtime.kind, 'timeout');
  assert.equal(runtime.layer, 'runtime-server');
  assert.equal(provider.kind, 'external-transient');
  assert.equal(provider.layer, 'external-provider');
});

test('merges tracked failure signatures into a run-level registry', () => {
  const first = mergeFailureSignaturesIntoRegistry(createFailureSignatureRegistry(), {
    runId: 'run:1',
    taskId: 'task-a',
    attempt: 1,
    status: 'repair-needed',
    createdAt: '2026-05-12T00:00:00.000Z',
    refs: ['stderr:1'],
    failureSignatures: [
      { kind: 'schema-drift', message: 'Missing required field artifacts[123].id', schemaPath: 'displayIntent.artifacts' },
      { message: 'AgentServer generation request timed out after 30000ms.' },
      { message: 'Repair no-op: repeated same failure with no change.' },
      { message: 'HTTP Error 429: rate limited for request 12345' },
      { message: 'A semantic verifier is uncertain.' },
    ],
  });
  const second = mergeFailureSignaturesIntoRegistry(first, {
    runId: 'run:2',
    taskId: 'task-b',
    attempt: 1,
    status: 'repair-needed',
    createdAt: '2026-05-12T00:01:00.000Z',
    refs: ['stderr:2'],
    failureSignatures: [
      { kind: 'schema-drift', message: 'Missing required field artifacts[987].id', schemaPath: 'displayIntent.artifacts' },
      { message: 'AgentServer generation request timed out after 45000ms.' },
      { message: 'Repair no-op: repeated same failure with no change.' },
      { message: 'HTTP Error 429: rate limited for request 67890' },
      { message: 'A semantic verifier is uncertain.' },
    ],
  });
  const idempotent = mergeFailureSignaturesIntoRegistry(second, {
    runId: 'run:2',
    taskId: 'task-b',
    attempt: 1,
    status: 'repair-needed',
    createdAt: '2026-05-12T00:01:00.000Z',
    refs: ['stderr:2'],
    failureSignatures: second.entries.flatMap((entry) => entry.kind === 'external-transient'
      ? [{ message: 'HTTP Error 429: rate limited for request 67890' }]
      : []),
  });

  assert.deepEqual(validateFailureSignatureRegistry(second), []);
  assert.equal(second.entries.length, 4);
  assert.ok(second.entries.every((entry) => entry.occurrenceCount === 2));
  assert.deepEqual(second.entries.map((entry) => entry.kind).sort(), [
    'external-transient',
    'repair-no-op',
    'schema-drift',
    'timeout',
  ]);
  assert.equal(idempotent.entries.find((entry) => entry.kind === 'external-transient')?.occurrenceCount, 2);
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
