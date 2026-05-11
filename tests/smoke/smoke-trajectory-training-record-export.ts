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

const uiFailureFixture = JSON.parse(await readFile(
  new URL('../fixtures/scientific-reproduction/ui-attempt-failures/missing-envelope-nonarray-artifacts.json', import.meta.url),
  'utf8',
)) as {
  failedAttempt: {
    outputRef: string;
    stdoutRef: string;
    stderrRef: string;
    rawPayload: { artifacts: Record<string, unknown>; executionUnits?: unknown[] };
  };
};

await writeFileSafe(join(workspace, '.sciforge/artifacts/paper-claim-graph-real.json'), '{"artifactType":"paper-claim-graph"}\n');
await writeFileSafe(join(workspace, '.sciforge/artifacts/dataset-inventory-real.json'), '{"artifactType":"dataset-inventory"}\n');
await writeFileSafe(join(workspace, '.sciforge/artifacts/evidence-matrix-real.json'), '{"artifactType":"evidence-matrix"}\n');
await writeFileSafe(join(workspace, '.sciforge/artifacts/claim-verdict-real.json'), '{"artifactType":"claim-verdict"}\n');
await writeFileSafe(join(workspace, '.sciforge/artifacts/negative-result-real.json'), '{"artifactType":"negative-result-report"}\n');
await writeFileSafe(join(workspace, '.sciforge/task-results/scientific-reproduction-ui-attempt-001.json'), JSON.stringify(uiFailureFixture.failedAttempt.rawPayload, null, 2));
await writeFileSafe(join(workspace, '.sciforge/logs/scientific-reproduction-ui-attempt-001.stdout.log'), 'partial scientific stdout\n');
await writeFileSafe(join(workspace, '.sciforge/logs/scientific-reproduction-ui-attempt-001.stderr.log'), 'ToolPayload schema failure\n');

const realWebTaskResult = {
  ...uiFailureFixture.failedAttempt.rawPayload,
  artifacts: {
    ...uiFailureFixture.failedAttempt.rawPayload.artifacts,
    'paper-claim-graph-real': {
      id: 'paper-claim-graph-real',
      type: 'paper-claim-graph',
      dataRef: 'file:.sciforge/artifacts/paper-claim-graph-real.json',
      data: {
        artifactType: 'paper-claim-graph',
        sourceRefs: [{ ref: 'file:paper.pdf#page=3' }],
        paperRefs: [{ ref: 'file:paper.pdf#page=3' }],
        claims: [{
          id: 'claim-real-1',
          text: 'A real web attempt extracted a checkable claim.',
          locatorRefs: [{ ref: 'file:paper.pdf#page=3' }],
        }],
      },
    },
    'dataset-inventory-real': {
      id: 'dataset-inventory-real',
      type: 'dataset-inventory',
      dataRef: 'file:.sciforge/artifacts/dataset-inventory-real.json',
      data: {
        artifactType: 'dataset-inventory',
        sourceRefs: [{ ref: 'artifact:paper-claim-graph-real#claim-real-1' }],
        datasets: [{
          id: 'dataset-real-1',
          title: 'Processed table discovered during web attempt',
          sourceRefs: [{ ref: 'file:paper.pdf#data-availability' }],
          availability: 'partially-available',
        }],
      },
    },
    'evidence-matrix-real': {
      id: 'evidence-matrix-real',
      type: 'evidence-matrix',
      dataRef: 'file:.sciforge/artifacts/evidence-matrix-real.json',
      data: {
        artifactType: 'evidence-matrix',
        sourceRefs: [{ ref: 'artifact:dataset-inventory-real#dataset-real-1' }],
        rows: [{
          id: 'row-real-1',
          claimId: 'claim-real-1',
          evidenceRefs: [{ ref: 'file:.sciforge/artifacts/partial-figure-stats.json' }],
          dataRefs: [{ ref: 'artifact:dataset-inventory-real#dataset-real-1' }],
          codeRefs: [{ ref: 'file:.sciforge/tasks/mock-reproduce-figure.py' }],
          verdict: 'not-reproduced',
          rationale: 'The attempted computation preserved a negative scientific result as structured evidence.',
        }],
      },
    },
    'claim-verdict-real': {
      id: 'claim-verdict-real',
      type: 'claim-verdict',
      dataRef: 'file:.sciforge/artifacts/claim-verdict-real.json',
      data: {
        artifactType: 'claim-verdict',
        sourceRefs: [{ ref: 'artifact:evidence-matrix-real#row-real-1' }],
        claimId: 'claim-real-1',
        verdict: 'not-reproduced',
        rationale: 'Available evidence did not reproduce the claim under the recorded attempt.',
        supportingEvidenceRefs: [{ ref: 'artifact:evidence-matrix-real#row-real-1' }],
      },
    },
    'negative-result-real': {
      id: 'negative-result-real',
      type: 'negative-result-report',
      dataRef: 'file:.sciforge/artifacts/negative-result-real.json',
      data: {
        artifactType: 'negative-result-report',
        sourceRefs: [{ ref: 'artifact:claim-verdict-real' }],
        claimIds: ['claim-real-1'],
        motivation: 'Preserve a scientific non-reproduction separately from the product payload failure.',
        checks: [{
          id: 'check-real-1',
          question: 'Did the reproduced signal match the claim direction?',
          inputRefs: [{ ref: 'artifact:dataset-inventory-real#dataset-real-1' }],
          codeRefs: [{ ref: 'file:.sciforge/tasks/mock-reproduce-figure.py' }],
          outputRefs: [{ ref: 'file:.sciforge/artifacts/partial-figure-stats.json' }],
          result: 'not-reproduced',
          interpretation: 'The recorded attempt could not support the claim direction.',
        }],
        conclusionImpact: 'The next prompt should continue from the negative result and repair payload shape separately.',
      },
    },
    'payload-failure-real': {
      id: 'payload-failure-real',
      type: 'contract-validation-failure',
      data: {
        failureKind: 'payload-schema',
        relatedRefs: [
          uiFailureFixture.failedAttempt.outputRef,
          uiFailureFixture.failedAttempt.stdoutRef,
          uiFailureFixture.failedAttempt.stderrRef,
        ],
      },
    },
  },
};

const realWebResult = await exportTrajectoryTrainingRecordForAttempt({
  workspacePath: workspace,
  attempt: {
    id: 'scientific-reproduction-ui-attempt-001',
    prompt: 'Use the web UI to reproduce the selected paper and keep partial scientific artifacts if the product payload fails.',
    skillDomain: 'literature',
    skillId: 'scientific-reproduction.ui-attempt.mock',
    scenarioPackageRef: { id: 'scientific-reproduction-web', version: '1.0.0', source: 'workspace' },
    runtimeProfileId: 'workspace-python',
    attempt: 1,
    status: 'repair-needed',
    failureReason: 'ToolPayload validation failed while preserving partial scientific artifacts.',
    outputRef: '.sciforge/task-results/scientific-reproduction-ui-attempt-001.json',
    stdoutRef: '.sciforge/logs/scientific-reproduction-ui-attempt-001.stdout.log',
    stderrRef: '.sciforge/logs/scientific-reproduction-ui-attempt-001.stderr.log',
    schemaErrors: ['missing message', 'artifacts must be an array'],
    createdAt: '2026-05-11T00:10:00.000Z',
  },
  taskResult: realWebTaskResult,
  subject: {
    title: 'Real web scientific reproduction attempt with preserved partial artifacts',
    topic: 'Trajectory export must retain attempt, failure, claim, dataset, evidence, and verdict artifacts.',
    sourceRefs: [{ ref: 'artifact:paper-source-real-web', kind: 'artifact' }],
  },
  screenRefs: {
    before: [{ ref: 'screen:real-web-before', captureKind: 'screenshot', summary: 'SciForge web UI before submitting reproduction prompt.' }],
    after: [{ ref: 'screen:real-web-after', captureKind: 'screenshot', summary: 'SciForge web UI showing payload repair-needed state.' }],
  },
  validationEvents: [{
    kind: 'contract-validation-failure',
    ref: 'audit:validation:payload-failure-real',
    relatedRefs: [uiFailureFixture.failedAttempt.outputRef],
  }],
  now: () => new Date('2026-05-11T00:10:01.000Z'),
});

const realWebRefs = new Set(realWebResult.audit.replayRefs);
for (const expectedRef of [
  'artifact:paper-claim-graph-real',
  'artifact:dataset-inventory-real',
  'artifact:evidence-matrix-real',
  'artifact:claim-verdict-real',
  'artifact:negative-result-real',
  'artifact:payload-failure-real',
  'artifact:claim-verdict-partial',
  'artifact:figure-report-partial',
  '.sciforge/artifacts/paper-claim-graph-real.json',
  '.sciforge/artifacts/dataset-inventory-real.json',
  '.sciforge/artifacts/evidence-matrix-real.json',
  '.sciforge/artifacts/claim-verdict-real.json',
  '.sciforge/artifacts/negative-result-real.json',
  '.sciforge/logs/scientific-reproduction-ui-attempt-001.stdout.log',
  '.sciforge/logs/scientific-reproduction-ui-attempt-001.stderr.log',
]) {
  assert.ok(realWebRefs.has(expectedRef), `real web trajectory should include ${expectedRef}`);
}
assert.equal(realWebResult.record.finalVerdict, 'in-progress');
assert.equal(realWebResult.record.repairHistory[0]?.failureKind, 'product-capability-failure');
assert.ok(realWebResult.record.selfPromptRecommendations[0]?.requiredRefs.some((ref) => ref.ref === 'artifact:claim-verdict-real'));
assert.doesNotMatch(JSON.stringify(realWebResult.record), /file:\.sciforge/);

console.log('[ok] trajectory training record export assembles attempt/result/validation refs and preserves real web scientific artifacts without chat context');

async function writeFileSafe(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}
