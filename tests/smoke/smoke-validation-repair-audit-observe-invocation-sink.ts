import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildObserveInvocationPlan,
  runObserveInvocationPlan,
} from '../../src/runtime/observe/orchestration';
import { readValidationRepairAuditSinkObserveInvocationRecords } from '../../src/runtime/gateway/validation-repair-audit-sink';

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
});

assert.equal(records.length, 1);
assert.equal(records[0]?.status, 'failed');
assert.equal(records[0]?.diagnostics?.failureMode, 'provider-unavailable');

const artifacts = await readValidationRepairAuditSinkObserveInvocationRecords({ workspacePath: workspace });
assert.equal(artifacts.length, 1);

const artifact = artifacts[0];
assert.equal(artifact?.contract, 'sciforge.validation-repair-audit-observe-invocation.v1');
assert.equal(artifact?.sourceSinkRef, `observe-invocation:${records[0]?.callRef}`);
assert.equal(artifact?.observeInvocation?.callRef, records[0]?.callRef);
assert.equal(artifact?.observeInvocation?.providerId, 'local.vision-sense');
assert.equal(artifact?.observeInvocation?.status, 'failed');
assert.equal(artifact?.auditRecord.subject.kind, 'observe-result');
assert.equal(artifact?.auditRecord.failureKind, 'observe-trace');
assert.equal(artifact?.validationDecision?.findings[0]?.source, 'observe-response');
assert.equal(artifact?.repairDecision?.action, 'repair-rerun');
assert.ok(artifact?.relatedRefs.includes('artifact:screenshot-1'));
assert.ok(artifact?.sinkRefs.includes(`observe-invocation:${records[0]?.callRef}`));
assert.equal(artifact?.recordedAt, '2026-05-10T00:00:00.000Z');

console.log('[ok] validation/repair audit sink writes observe invocation records from the real observe runtime path and reads them back');
