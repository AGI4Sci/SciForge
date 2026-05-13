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
    code: 'rate-limit',
    httpStatus: 429,
    providerId: 'arxiv',
    operation: 'paper-search',
    refs: ['log:stderr-a'],
  });
  const second = createFailureSignature({
    message: 'HTTP Error 429: rate limit for request 98765 at 2026-05-12T09:10:11.000Z',
    code: 'rate-limit',
    httpStatus: 429,
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
    code: 'rate-limit',
    httpStatus: 429,
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
    code: 'timeout',
  });
  const provider = createFailureSignature({
    message: 'External provider timed out after 30000ms.',
    code: 'external-transient',
    httpStatus: 504,
  });

  assert.equal(runtime.kind, 'timeout');
  assert.equal(runtime.layer, 'runtime-server');
  assert.equal(provider.kind, 'external-transient');
  assert.equal(provider.layer, 'external-provider');
});

test('classifies partial PDF retrieval boundaries as external provider failures', () => {
  const forbidden = createFailureSignature({
    message: 'PDF download failed with HTTP 403 forbidden.',
    code: 'external-transient',
    httpStatus: 403,
    operation: 'pdf-download',
  });
  const tooLarge = createFailureSignature({
    message: 'PDF content-length exceeds max download bytes.',
    code: 'external-transient',
    httpStatus: 413,
    operation: 'pdf-download',
  });
  const registry = mergeFailureSignaturesIntoRegistry(createFailureSignatureRegistry(), {
    runId: 'run-pdf-boundary',
    taskId: 'task-pdf-boundary',
    status: 'needs-human',
    refs: ['stderr:pdf-download'],
    failureSignatures: [forbidden, tooLarge],
  });

  assert.equal(forbidden.kind, 'external-transient');
  assert.equal(forbidden.layer, 'external-provider');
  assert.equal(tooLarge.kind, 'external-transient');
  assert.equal(tooLarge.layer, 'external-provider');
  assert.deepEqual(registry.entries.map((entry) => entry.kind), ['external-transient', 'external-transient']);
  assert.equal(registry.entries.length, 2);
  assert.ok(registry.entries.some((entry) => /403 forbidden/i.test(entry.message)));
  assert.ok(registry.entries.some((entry) => /content-length exceeds max download bytes/i.test(entry.message)));
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
      { code: 'timeout', message: 'AgentServer generation request timed out after 30000ms.' },
      { code: 'repair-no-op', message: 'Repair no-op: repeated same failure with no change.' },
      { code: 'rate-limit', httpStatus: 429, message: 'HTTP Error 429: rate limited for request 12345' },
      { code: 'validation-failure', message: 'A semantic verifier is uncertain.' },
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
      { code: 'timeout', message: 'AgentServer generation request timed out after 45000ms.' },
      { code: 'repair-no-op', message: 'Repair no-op: repeated same failure with no change.' },
      { code: 'rate-limit', httpStatus: 429, message: 'HTTP Error 429: rate limited for request 67890' },
      { code: 'validation-failure', message: 'A semantic verifier is uncertain.' },
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
      ? [{ code: 'rate-limit', httpStatus: 429, message: 'HTTP Error 429: rate limited for request 67890' }]
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
    failureSignatures: [{ code: 'service-unavailable', httpStatus: 503, message: 'Service unavailable HTTP 503', providerId: 'pubmed' }],
    verificationRefs: ['verification:v1'],
  });

  assert.equal(card.status, 'needs-human');
  assert.equal(card.genericAttributionLayer, 'external-provider');
  assert.ok(card.refs.some((ref) => ref.ref === 'execution-unit:unit-fetch'));
  assert.ok(card.refs.some((ref) => ref.ref === 'verification:v1'));
  assert.equal(card.failureSignatures[0]?.kind, 'external-transient');
  assert.deepEqual(validateTaskRunCard(card), []);
});

test('auto-suggests generic ownership layers from runtime contract signals', () => {
  const card = createTaskRunCard({
    goal: 'Finish a reusable task after validation failed.',
    protocolStatus: 'protocol-failed',
    taskOutcome: 'needs-work',
    refs: [
      { kind: 'artifact', ref: '.sciforge/task-results/task.json' },
      { kind: 'verification', ref: 'verification:payload-validation' },
    ],
    failureSignatures: [
      { kind: 'schema-drift', message: 'Missing required field artifacts[0].id', schemaPath: 'artifacts.0.id' },
      { kind: 'validation-failure', message: 'Verifier could not confirm required evidence.' },
    ],
  });

  const layers = card.ownershipLayerSuggestions.map((suggestion) => suggestion.layer);
  const payload = card.ownershipLayerSuggestions.find((suggestion) => suggestion.layer === 'payload-normalization');
  const verification = card.ownershipLayerSuggestions.find((suggestion) => suggestion.layer === 'verification');

  assert.ok(layers.includes('payload-normalization'));
  assert.ok(layers.includes('verification'));
  assert.equal(payload?.confidence, 'high');
  assert.ok(payload?.signals.includes('failure:schema-drift'));
  assert.match(payload?.nextStep ?? '', /contract-approved normalization|validation diagnostics/i);
  assert.match(verification?.reason ?? '', /verifier verdicts|evidence checks/i);
  assert.deepEqual(validateTaskRunCard(card), []);
});

test('carries conversation projection refs and compact kernel summaries', () => {
  const card = createTaskRunCard({
    goal: 'Recover a failed run from its kernel projection.',
    protocolStatus: 'protocol-failed',
    taskOutcome: 'needs-work',
    conversationProjectionRef: '.sciforge/task-results/run.json#displayIntent.conversationProjection',
    conversationProjectionSummary: {
      schemaVersion: 'sciforge.task-run-card.conversation-projection-summary.v1',
      conversationId: 'conversation:run-1',
      status: 'repair-needed',
      failureOwner: {
        ownerLayer: 'runtime-runner',
        reason: 'Workspace task exited with code 1.',
        evidenceRefs: ['.sciforge/debug/stderr.log'],
        nextStep: 'Repair runtime execution inputs, argv, sandbox, or output path and rerun.',
      },
      recoverActions: ['Repair runtime execution inputs, argv, sandbox, or output path and rerun.'],
      verificationState: { status: 'failed', verifierRef: 'verification:v1', verdict: 'failed' },
      backgroundState: { status: 'running', checkpointRefs: ['checkpoint:run-1'] },
    },
  });

  assert.equal(card.conversationProjectionRef, '.sciforge/task-results/run.json#displayIntent.conversationProjection');
  assert.equal(card.conversationProjectionSummary?.failureOwner?.ownerLayer, 'runtime-runner');
  assert.deepEqual(card.conversationProjectionSummary?.recoverActions, ['Repair runtime execution inputs, argv, sandbox, or output path and rerun.']);
  assert.ok(card.refs.some((ref) => ref.ref === '.sciforge/task-results/run.json#displayIntent.conversationProjection'));
  assert.deepEqual(validateTaskRunCard(card), []);
});
