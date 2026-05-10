import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { exportTrajectoryTrainingRecordForAttempt } from '../../src/runtime/trajectory-training-record-export';
import type { TaskAttemptRecord } from '../../src/runtime/runtime-types';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-trajectory-export-'));

await writeFileSafe(join(workspace, '.sciforge/tasks/generic-1.py'), 'print("run")\n');
await writeFileSafe(join(workspace, '.sciforge/task-inputs/generic-1.json'), '{"prompt":"generic reproduction"}\n');
await writeFileSafe(join(workspace, '.sciforge/logs/generic-1.stdout.log'), 'RAW_STDOUT_SHOULD_STAY_REFERENCED_ONLY\n');
await writeFileSafe(join(workspace, '.sciforge/logs/generic-1.stderr.log'), 'schema warning\n');
await writeFileSafe(join(workspace, '.sciforge/artifacts/analysis-plan.json'), '{"kind":"analysis-plan"}\n');
await writeFileSafe(join(workspace, '.sciforge/validation-repair-telemetry/spans.jsonl'), '{"spanId":"span-1"}\n');
await writeFileSafe(join(workspace, '.sciforge/validation-repair-audit/verification-artifacts/audit-1.json'), '{"auditId":"audit-1"}\n');
await writeFileSafe(join(workspace, '.sciforge/task-results/generic-1.json'), JSON.stringify({
  message: 'Partial result with validation metadata.',
  artifacts: [
    {
      type: 'analysis-plan',
      ref: '.sciforge/artifacts/analysis-plan.json',
      summary: 'Bounded plan artifact.',
    },
  ],
  workEvidence: [
    {
      kind: 'retrieval',
      status: 'failed',
      outputSummary: 'Provider returned a bounded failure.',
      evidenceRefs: ['trace:provider-call-1'],
      rawRef: '.sciforge/logs/provider-call-1.raw.json',
    },
  ],
  refs: {
    validationRepairTelemetry: [
      {
        kind: 'validation-repair-telemetry',
        ref: '.sciforge/validation-repair-telemetry/spans.jsonl',
        spanRefs: ['trace:validation-span-1'],
        recordRefs: ['trace:validation-record-1'],
        spanKinds: ['validation-decision'],
      },
    ],
  },
  rawBody: 'RAW_TASK_RESULT_BODY_SHOULD_NOT_BE_EMBEDDED',
}, null, 2));

const attempt: TaskAttemptRecord = {
  id: 'generic-1',
  prompt: 'Use the selected references to produce a replayable attempt record and classify any failure.',
  skillDomain: 'literature',
  skillId: 'literature.generic_reproduction',
  scenarioPackageRef: { id: 'generic-reproduction', version: '1.0.0', source: 'workspace' },
  skillPlanRef: 'skill-plan/generic-reproduction@1.0.0',
  uiPlanRef: 'ui-plan/generic-reproduction@1.0.0',
  runtimeProfileId: 'workspace-python',
  routeDecision: {
    selectedSkill: 'literature.generic_reproduction',
    selectedRuntime: 'workspace-python',
    fallbackReason: 'fixture route',
    selectedAt: '2026-05-11T00:00:00.000Z',
  },
  attempt: 1,
  status: 'repair-needed',
  failureReason: 'ToolPayload validation failed because artifacts was not an array.',
  codeRef: '.sciforge/tasks/generic-1.py',
  inputRef: '.sciforge/task-inputs/generic-1.json',
  stdoutRef: '.sciforge/logs/generic-1.stdout.log',
  stderrRef: '.sciforge/logs/generic-1.stderr.log',
  outputRef: '.sciforge/task-results/generic-1.json',
  exitCode: 0,
  schemaErrors: ['artifacts must be an array'],
  workEvidenceSummary: {
    count: 1,
    items: [{
      kind: 'retrieval',
      status: 'failed',
      evidenceRefs: ['trace:provider-call-1'],
      recoverActions: ['retry with bounded refs'],
      diagnostics: ['provider failure was bounded'],
      rawRef: '.sciforge/logs/provider-call-1.raw.json',
    }],
  },
  createdAt: '2026-05-11T00:00:01.000Z',
};

const result = await exportTrajectoryTrainingRecordForAttempt({
  workspacePath: workspace,
  attempt: {
    ...attempt,
    refs: {
      validationRepairAudit: [{
        kind: 'validation-repair-audit',
        ref: 'audit:validation:audit-1',
        auditId: 'audit-1',
        contractId: 'generic-output-contract.v1',
        failureKind: 'runtime-verification',
        outcome: 'needs-human',
        relatedRefs: ['.sciforge/task-results/generic-1.json'],
        sinkRefs: ['.sciforge/validation-repair-audit/verification-artifacts/audit-1.json'],
        telemetrySpanRefs: ['trace:validation-span-1'],
      }],
      validationRepairTelemetry: [{
        kind: 'validation-repair-telemetry',
        ref: '.sciforge/validation-repair-telemetry/spans.jsonl',
        spanRefs: ['trace:validation-span-1'],
        recordRefs: ['trace:validation-record-1'],
        spanKinds: ['validation-decision'],
      }],
    },
    validationRepairAuditRecords: [{
      auditId: 'audit-1',
      contractId: 'generic-output-contract.v1',
      failureKind: 'runtime-verification',
      outcome: 'needs-human',
      relatedRefs: ['.sciforge/task-results/generic-1.json'],
      sinkRefs: ['.sciforge/validation-repair-audit/verification-artifacts/audit-1.json'],
      telemetrySpanRefs: ['trace:validation-span-1'],
    }],
  },
  validationEvents: [{
    kind: 'validation-decision',
    ref: 'audit:validation:audit-1',
    relatedRefs: ['.sciforge/task-results/generic-1.json'],
    telemetrySpanRefs: ['trace:validation-span-1'],
  }],
  subject: {
    title: 'Generic attempt replay fixture',
    topic: 'Validate that a single stored attempt can export a self-contained trajectory record.',
    sourceRefs: [{ ref: 'artifact:fixture-source', kind: 'artifact', description: 'Generic fixture source ref.' }],
  },
  now: () => new Date('2026-05-11T00:00:02.000Z'),
});

const exported = JSON.parse(await readFile(result.path, 'utf8')) as typeof result;
const serialized = JSON.stringify(exported);

assert.equal(result.ref, '.sciforge/trajectory-training-records/generic-1-attempt-1.json');
assert.equal(exported.record.attemptRef, 'attempt:generic-1:1');
assert.equal(exported.record.finalVerdict, 'in-progress');
assert.ok(exported.record.steps.some((step) => step.prompt?.text.includes('selected references')));
assert.ok(exported.record.steps.some((step) => step.kind === 'repair'));
assert.ok(exported.record.repairHistory.length >= 1);
assert.ok(exported.record.selfPromptRecommendations.length >= 1);
assert.ok(exported.audit.ok);
assert.ok(exported.audit.replayRefs.includes('.sciforge/task-results/generic-1.json'));
assert.ok(exported.audit.validationRefs.some((ref) => ref.includes('validation-repair')));
assert.doesNotMatch(serialized, /RAW_STDOUT_SHOULD_STAY_REFERENCED_ONLY/);
assert.doesNotMatch(serialized, /RAW_TASK_RESULT_BODY_SHOULD_NOT_BE_EMBEDDED/);
assert.match(serialized, /\.sciforge\/logs\/generic-1\.stdout\.log/);
assert.match(serialized, /Replay steps in timestamp order/);

console.log('[ok] trajectory training record export assembles attempt/result/validation refs without chat context');

async function writeFileSafe(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}
