import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildObserveInvocationPlan,
  runObserveInvocationPlan,
  type ObserveProviderRuntime,
} from '../../src/runtime/observe/orchestration';
import {
  buildValidationRepairAuditSinkObserveInvocationSummary,
  readValidationRepairAuditSinkObserveInvocationRecords,
  VALIDATION_REPAIR_AUDIT_OBSERVE_INVOCATIONS_RELATIVE_DIR,
} from '../../src/runtime/gateway/validation-repair-audit-sink';
import { readValidationRepairTelemetrySpanRecords } from '../../src/runtime/gateway/validation-repair-telemetry-sink';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-validation-repair-observe-invocation-sink-'));
const now = () => new Date('2026-05-10T00:00:00.000Z');

const plan = buildObserveInvocationPlan({
  goal: 'Audit failed observe provider invocation',
  runRef: 'run:observe-audit-smoke',
  providers: [{ id: 'local.vision-sense', acceptedModalities: ['screenshot'], outputKind: 'text' }],
  intents: [{
    instruction: 'Read the visible window title',
    modalities: [{ kind: 'screenshot', ref: 'artifact:screenshot-1', mimeType: 'image/png' }],
  }],
});

const records = await runObserveInvocationPlan(plan, [], {
  validationRepairAuditSink: {
    workspacePath: workspace,
    now,
  },
  validationRepairTelemetrySink: {
    workspacePath: workspace,
    now,
    readSummary: true,
  },
});

assert.equal(records.length, 1);
assert.equal(records[0]?.status, 'failed');
assert.equal(records[0]?.diagnostics?.failureMode, 'provider-unavailable');
const budgetDebit = records[0]?.budgetDebits[0];
assert.ok(budgetDebit, 'observe provider unavailable invocation should emit a budget debit record');
assert.equal(budgetDebit.capabilityId, 'local.vision-sense');
assert.equal(budgetDebit.sinkRefs.executionUnitRef, records[0]?.executionUnit.id);
assert.deepEqual(budgetDebit.sinkRefs.workEvidenceRefs, [records[0]?.workEvidence.id]);
assert.ok(budgetDebit.sinkRefs.auditRefs.includes(records[0]?.audit.ref));
assert.deepEqual(records[0]?.executionUnit.budgetDebitRefs, [budgetDebit.debitId]);
assert.deepEqual(records[0]?.workEvidence.budgetDebitRefs, [budgetDebit.debitId]);
assert.deepEqual(records[0]?.audit.budgetDebitRefs, [budgetDebit.debitId]);
assert.ok(budgetDebit.debitLines.some((line) => line.dimension === 'observeCalls' && line.amount === 1));
assert.equal(records[0]?.refs?.validationRepairTelemetry?.[0]?.ref, '.sciforge/validation-repair-telemetry/spans.jsonl');
assert.ok(records[0]?.refs?.validationRepairTelemetry?.[0]?.spanKinds.includes('observe-invocation'));
assert.equal(records[0]?.validationRepairTelemetrySummary?.spanKindCounts['observe-invocation'], 1);

const artifacts = await readValidationRepairAuditSinkObserveInvocationRecords({ workspacePath: workspace });
assert.equal(artifacts.length, 1);

const artifact = artifacts[0];
assert.equal(artifact?.contract, 'sciforge.validation-repair-audit-observe-invocation.v1');
assert.equal(artifact?.sourceSinkRef, `observe-invocation:${records[0]?.callRef}`);
assert.equal(artifact?.observeInvocation?.callRef, records[0]?.callRef);
assert.equal(artifact?.observeInvocation?.providerId, 'local.vision-sense');
assert.equal(artifact?.observeInvocation?.status, 'failed');
assert.deepEqual((artifact?.observeInvocation as { budgetDebitRefs?: string[] } | undefined)?.budgetDebitRefs, [budgetDebit.debitId]);
assert.equal(artifact?.auditRecord.subject.kind, 'observe-result');
assert.equal(artifact?.auditRecord.failureKind, 'observe-trace');
assert.equal(artifact?.validationDecision?.findings[0]?.source, 'observe-response');
assert.equal(artifact?.repairDecision?.action, 'repair-rerun');
assert.ok(artifact?.relatedRefs.includes('artifact:screenshot-1'));
assert.ok(artifact?.sinkRefs.includes(`observe-invocation:${records[0]?.callRef}`));
assert.equal(artifact?.recordedAt, '2026-05-10T00:00:00.000Z');

const summary = await buildValidationRepairAuditSinkObserveInvocationSummary({ workspacePath: workspace, now });
assert.equal(summary.kind, 'validation-repair-audit-sink-artifact-summary');
assert.equal(summary.target, 'observe-invocation');
assert.equal(summary.sourceRef, VALIDATION_REPAIR_AUDIT_OBSERVE_INVOCATIONS_RELATIVE_DIR);
assert.equal(summary.totalArtifacts, 1);
assert.deepEqual(summary.auditIds, [artifact?.auditId]);
assert.equal(summary.failureKindCounts['observe-trace'], 1);
assert.equal(summary.statusCounts.failed, 1);
assert.ok(summary.sourceSinkRefs.includes(`observe-invocation:${records[0]?.callRef}`));
assert.ok(summary.sinkRefs.includes(`observe-invocation:${records[0]?.callRef}`));

const telemetryRecords = await readValidationRepairTelemetrySpanRecords({ workspacePath: workspace });
assert.equal(telemetryRecords.length, 1);
assert.equal(telemetryRecords[0]?.spanKind, 'observe-invocation');
assert.equal(telemetryRecords[0]?.span.status, 'repair-requested');
assert.ok(telemetryRecords[0]?.sourceRefs.includes(`observe-invocation:${records[0]?.callRef}`));
assert.ok(telemetryRecords[0]?.auditRefs.includes(artifact?.auditId ?? ''));

const providerFailureWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-validation-repair-observe-provider-failure-sink-'));
const failingProvider: ObserveProviderRuntime = {
  contract: {
    id: 'local.vision-sense',
    acceptedModalities: ['screenshot'],
    outputKind: 'text',
  },
  async invoke(input) {
    if (input.callRef.endsWith(':001')) {
      return {
        status: 'failed',
        artifactRefs: ['artifact:provider-failure-diagnostic'],
        traceRef: `${input.callRef}:trace`,
        compactSummary: 'Provider could not read the requested title with enough confidence.',
        diagnostics: {
          code: 'observe-low-confidence',
          failureMode: 'low-confidence',
          providerId: input.providerId,
          message: 'OCR confidence below threshold.',
        },
      };
    }
    throw new Error('provider process exited before returning a result');
  },
};

const providerFailurePlan = buildObserveInvocationPlan({
  goal: 'Audit real observe provider failure and thrown provider error',
  runRef: 'run:observe-provider-failure-smoke',
  providers: [failingProvider.contract],
  intents: [
    {
      instruction: 'Read the title with a provider-level failed result',
      modalities: [{ kind: 'screenshot', ref: 'artifact:screenshot-2', mimeType: 'image/png' }],
    },
    {
      instruction: 'Read the title when provider throws',
      modalities: [{ kind: 'screenshot', ref: 'artifact:screenshot-3', mimeType: 'image/png' }],
    },
  ],
});

const providerFailureRecords = await runObserveInvocationPlan(providerFailurePlan, [failingProvider], {
  validationRepairAuditSink: {
    workspacePath: providerFailureWorkspace,
    now,
  },
  validationRepairTelemetrySink: {
    workspacePath: providerFailureWorkspace,
    now,
    readSummary: true,
  },
});

assert.deepEqual(providerFailureRecords.map((record) => record.status), ['failed', 'failed']);
assert.equal(providerFailureRecords[0]?.diagnostics?.failureMode, 'low-confidence');
assert.equal(providerFailureRecords[1]?.diagnostics?.code, 'observe-provider-error');
assert.equal(providerFailureRecords[1]?.diagnostics?.failureMode, 'internal-error');
assert.equal(providerFailureRecords[1]?.traceRef, `${providerFailureRecords[1]?.callRef}:provider-error`);

const providerFailureArtifacts = await readValidationRepairAuditSinkObserveInvocationRecords({
  workspacePath: providerFailureWorkspace,
});
assert.equal(providerFailureArtifacts.length, 2);
assert.deepEqual(
  providerFailureArtifacts.map((entry) => entry.validationDecision?.findings[0]?.source),
  ['observe-response', 'observe-response'],
);
assert.deepEqual(
  providerFailureArtifacts.map((entry) => entry.repairDecision?.action),
  ['repair-rerun', 'repair-rerun'],
);
assert.deepEqual(
  providerFailureArtifacts.map((entry) => entry.auditRecord.outcome),
  ['repair-requested', 'repair-requested'],
);
assert.equal(providerFailureArtifacts[0]?.observeInvocation?.diagnostics?.failureMode, 'low-confidence');
assert.equal(providerFailureArtifacts[1]?.observeInvocation?.diagnostics?.failureMode, 'internal-error');
assert.ok(providerFailureArtifacts[1]?.relatedRefs.includes('artifact:screenshot-3'));
assert.ok(providerFailureArtifacts[1]?.relatedRefs.includes(`${providerFailureRecords[1]?.callRef}:provider-error`));

const providerFailureSummary = await buildValidationRepairAuditSinkObserveInvocationSummary({
  workspacePath: providerFailureWorkspace,
  now,
});
assert.equal(providerFailureSummary.totalArtifacts, 2);
assert.equal(providerFailureSummary.failureKindCounts['observe-trace'], 2);
assert.equal(providerFailureSummary.statusCounts.failed, 2);

const providerFailureTelemetryRecords = await readValidationRepairTelemetrySpanRecords({
  workspacePath: providerFailureWorkspace,
});
assert.equal(providerFailureTelemetryRecords.length, 2);
assert.deepEqual(
  providerFailureTelemetryRecords.map((record) => record.span.status),
  ['repair-requested', 'repair-requested'],
);

console.log('[ok] validation/repair audit and telemetry sinks write observe unavailable, failed, and provider-error records from the real observe runtime path and read them back');
