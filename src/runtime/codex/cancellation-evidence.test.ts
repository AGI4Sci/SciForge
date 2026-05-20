import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCELLATION_EVIDENCE_SCHEMA_VERSION,
  planCancellationContinuation,
  validateCancellationEvidenceLedger,
  type CancellationEvidenceLedger,
} from './cancellation-evidence.js';

test('R-RUN-02 records user cancellation evidence and plans only safe remainder', () => {
  const ledger = cancellationLedger({
    cancellation: {
      kind: 'user-cancelled',
      reason: 'user pressed stop after partial notebook render',
      requestedBy: 'user',
      observedAt: '2026-05-20T08:00:00.000Z',
    },
    completedSteps: [
      {
        stepId: 'load-inputs',
        summary: 'Input manifest was read and hashed.',
        artifactRefs: ['artifact:input-manifest'],
        auditRefs: ['audit:load-inputs'],
      },
    ],
    partialArtifacts: [
      {
        ref: 'artifact:notebook.partial',
        status: 'partial',
        description: 'Notebook contains executed setup cells but no final analysis cells.',
        producerStepId: 'render-notebook',
        auditRefs: ['audit:partial-notebook'],
      },
    ],
    safeRemainder: [
      {
        stepId: 'validate-partial-notebook',
        action: 'Read the partial notebook and decide which cells are safe to continue.',
        effect: 'read-only',
        dependsOn: ['load-inputs'],
        requiredArtifactRefs: ['artifact:notebook.partial'],
        auditRefs: ['audit:validate-partial-notebook'],
      },
      {
        stepId: 'render-summary',
        action: 'Render an idempotent summary from validated cells.',
        effect: 'idempotent',
        dependsOn: ['validate-partial-notebook'],
      },
    ],
  });

  const validation = validateCancellationEvidenceLedger(ledger);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const plan = planCancellationContinuation(ledger, {
    sourceCancelledRunId: ledger.cancelledRunId,
    sourceAttemptId: ledger.attemptId,
    requestedStepIds: ['validate-partial-notebook'],
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.continuationScope, 'safe-remainder-only');
  assert.deepEqual(plan.executableSteps.map((step) => step.stepId), ['validate-partial-notebook']);
  assert.deepEqual(plan.completedStepIds, ['load-inputs']);
  assert.deepEqual(plan.partialArtifactRefs, ['artifact:notebook.partial']);
  assert.ok(plan.auditRefs.includes('audit:partial-notebook'));
  assert.ok(plan.auditRefs.includes('audit:validate-partial-notebook'));
});

test('R-RUN-02 blocks system abort from boundaryless cancelled-run resume', () => {
  const ledger = cancellationLedger({
    cancellation: {
      kind: 'system-abort',
      reason: 'runtime supervisor aborted after heartbeat timeout',
      requestedBy: 'runtime-supervisor',
      observedAt: '2026-05-20T08:03:00.000Z',
    },
    safeRemainder: [
      {
        stepId: 'refresh-status',
        action: 'Read durable status refs before deciding whether to continue.',
        effect: 'read-only',
      },
    ],
  });

  assert.equal(validateCancellationEvidenceLedger(ledger).ok, true);

  const blocked = planCancellationContinuation(ledger, {
    sourceCancelledRunId: ledger.cancelledRunId,
    sourceAttemptId: ledger.attemptId,
    mode: 'resume-cancelled-run',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'boundaryless-resume-blocked');
  assert.match(blocked.errors.join('\n'), /safeRemainder/);

  const safePlan = planCancellationContinuation(ledger, {
    sourceCancelledRunId: ledger.cancelledRunId,
    sourceAttemptId: ledger.attemptId,
  });
  assert.equal(safePlan.ok, true);
  assert.equal(safePlan.cancellationKind, 'system-abort');
  assert.deepEqual(safePlan.executableSteps.map((step) => step.stepId), ['refresh-status']);
});

test('R-RUN-02 blocks irreversible side effects from safe continuation', () => {
  const ledger = cancellationLedger({
    completedSteps: [
      {
        stepId: 'submit-external-job',
        summary: 'External batch job was submitted before cancellation.',
        auditRefs: ['audit:submit-external-job'],
      },
    ],
    irreversibleSideEffects: [
      {
        sideEffectId: 'side-effect:hpc-job-42',
        stepId: 'submit-external-job',
        description: 'An external HPC job was already queued and may still write outputs.',
        externalRef: 'hpc-job:42',
        auditRefs: ['audit:hpc-job-42'],
      },
    ],
    unsafeRemainder: [
      {
        stepId: 'resubmit-external-job',
        action: 'Submit the same external batch job again.',
        reason: 'Resubmission could duplicate irreversible external writes from hpc-job:42.',
        effect: 'irreversible-side-effect',
        blockedBySideEffectIds: ['side-effect:hpc-job-42'],
      },
    ],
    safeRemainder: [
      {
        stepId: 'inspect-external-job',
        action: 'Read external job status and collect audit refs.',
        effect: 'read-only',
        dependsOn: ['submit-external-job'],
      },
    ],
  });

  const validation = validateCancellationEvidenceLedger(ledger);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const blocked = planCancellationContinuation(ledger, {
    sourceCancelledRunId: ledger.cancelledRunId,
    sourceAttemptId: ledger.attemptId,
    requestedStepIds: ['resubmit-external-job'],
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'unsafe-remainder-blocked');
  assert.match(blocked.errors.join('\n'), /duplicate irreversible external writes/);
  assert.deepEqual(blocked.blockedSteps[0]?.blockedBySideEffectIds, ['side-effect:hpc-job-42']);

  const safePlan = planCancellationContinuation(ledger, {
    sourceCancelledRunId: ledger.cancelledRunId,
    sourceAttemptId: ledger.attemptId,
    requestedStepIds: ['inspect-external-job'],
  });
  assert.equal(safePlan.ok, true);
  assert.deepEqual(safePlan.executableSteps.map((step) => step.stepId), ['inspect-external-job']);
  assert.deepEqual(safePlan.irreversibleSideEffectIds, ['side-effect:hpc-job-42']);

  const invalidLedger = cancellationLedger({
    safeRemainder: [
      {
        stepId: 'unsafe-inline-resubmit',
        action: 'Submit external job again from safe list.',
        effect: 'irreversible-side-effect' as never,
      },
    ],
  });
  const invalid = validateCancellationEvidenceLedger(invalidLedger);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /safeRemainder\[0\]\.effect/);
});

function cancellationLedger(overrides: Partial<CancellationEvidenceLedger> = {}): CancellationEvidenceLedger {
  return {
    schemaVersion: CANCELLATION_EVIDENCE_SCHEMA_VERSION,
    cancelledRunId: 'run:cancelled-r-run-02',
    attemptId: 'attempt:cancelled-r-run-02:1',
    cancellation: {
      kind: 'user-cancelled',
      reason: 'fixture cancellation',
      requestedBy: 'user',
      observedAt: '2026-05-20T08:00:00.000Z',
    },
    completedSteps: [],
    partialArtifacts: [],
    irreversibleSideEffects: [],
    unsafeRemainder: [],
    safeRemainder: [],
    auditRefs: ['audit:cancellation-boundary'],
    ...overrides,
  };
}
