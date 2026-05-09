import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CapabilityEvolutionRecord } from '../../packages/contracts/runtime/capability-evolution.js';
import {
  appendCapabilityEvolutionRecord,
  buildCapabilityEvolutionCompactSummary,
  CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH,
  readCapabilityEvolutionRecords,
} from '../../src/runtime/capability-evolution-ledger.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capability-ledger-'));

try {
  const record: CapabilityEvolutionRecord = {
    schemaVersion: 'sciforge.capability-evolution-record.v1',
    id: 'cel-smoke-1',
    recordedAt: '2026-05-09T00:00:00.000Z',
    runId: 'run-smoke-1',
    goalSummary: 'Compose a general capability and recover through atomic fallback after validation fails.',
    selectedCapabilities: [
      { id: 'capability.compose.generic', kind: 'composed', providerId: 'provider-runtime', role: 'primary' },
      { id: 'capability.atomic.extract', kind: 'skill', providerId: 'provider-runtime', role: 'fallback' },
      { id: 'capability.atomic.render', kind: 'tool', providerId: 'provider-runtime', role: 'fallback' },
    ],
    providers: [{ id: 'provider-runtime', kind: 'local-runtime' }],
    inputSchemaRefs: ['schema:input.generic.v1'],
    outputSchemaRefs: ['schema:artifact.generic.v1'],
    glueCodeRef: '.sciforge/tasks/composed-smoke.py',
    executionUnitRefs: ['execution-unit:composed-1', 'execution-unit:atomic-1', 'execution-unit:repair-1'],
    artifactRefs: ['artifact:summary-1'],
    validationResult: {
      verdict: 'fail',
      validatorId: 'validator.schema',
      failureCode: 'schema-invalid',
      summary: 'Composed output missed a required artifact field.',
      resultRef: '.sciforge/verifications/composed-smoke.json',
    },
    failureCode: 'schema-invalid',
    recoverActions: ['fallback-to-atomic', 'repair-output-schema'],
    repairAttempts: [
      {
        id: 'repair-1',
        status: 'succeeded',
        reason: 'Normalized atomic outputs into the expected artifact contract.',
        executionUnitRefs: ['execution-unit:repair-1'],
        artifactRefs: ['artifact:summary-1'],
        validationResult: { verdict: 'pass', validatorId: 'validator.schema' },
      },
    ],
    fallbackPolicy: {
      atomicCapabilities: [
        { id: 'capability.atomic.extract', kind: 'skill', providerId: 'provider-runtime', role: 'fallback' },
        { id: 'capability.atomic.render', kind: 'tool', providerId: 'provider-runtime', role: 'fallback' },
      ],
      fallbackToAtomicWhen: ['schema-invalid', 'validation-failed'],
      doNotFallbackWhen: ['unsafe-side-effect', 'requires-human-approval'],
      retryBudget: { maxRetries: 2, maxRepairAttempts: 1, maxFallbackAttempts: 1 },
      fallbackContext: {
        validationResultRefs: ['.sciforge/verifications/composed-smoke.json'],
        reason: 'Schema validation failed before user-visible delivery.',
      },
    },
    composedResult: {
      status: 'repair-succeeded',
      failureCode: 'schema-invalid',
      fallbackable: true,
      confidence: 0.82,
      coverage: 0.9,
      recoverActions: ['fallback-to-atomic', 'repair-output-schema'],
      atomicTrace: [
        {
          capabilityId: 'capability.atomic.extract',
          providerId: 'provider-runtime',
          status: 'succeeded',
          executionUnitRefs: ['execution-unit:atomic-1'],
          artifactRefs: ['artifact:intermediate-1'],
        },
        {
          capabilityId: 'capability.atomic.render',
          providerId: 'provider-runtime',
          status: 'succeeded',
          executionUnitRefs: ['execution-unit:repair-1'],
          artifactRefs: ['artifact:summary-1'],
        },
      ],
      relatedRefs: {
        runId: 'run-smoke-1',
        glueCodeRef: '.sciforge/tasks/composed-smoke.py',
        executionUnitRefs: ['execution-unit:composed-1', 'execution-unit:atomic-1', 'execution-unit:repair-1'],
        artifactRefs: ['artifact:summary-1'],
        validationResultRefs: ['.sciforge/verifications/composed-smoke.json'],
      },
    },
    finalStatus: 'repair-succeeded',
    latencyCostSummary: { latencyMs: 42, executionCount: 3 },
    promotionCandidate: { eligible: false, reason: 'single smoke record is not enough for promotion' },
    metadata: { glueCodePreview: 'print("compact summary should not inline this")' },
  };

  const appendResult = await appendCapabilityEvolutionRecord({ workspacePath: workspace }, record);
  assert.equal(appendResult.ref, CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH);

  const rawLedger = await readFile(appendResult.path, 'utf8');
  assert.match(rawLedger, /"id":"cel-smoke-1"/);
  assert.match(rawLedger, /glueCodePreview/);

  const records = await readCapabilityEvolutionRecords({ workspacePath: workspace });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.composedResult?.atomicTrace.length, 2);

  const summary = await buildCapabilityEvolutionCompactSummary({
    workspacePath: workspace,
    now: () => new Date('2026-05-09T00:01:00.000Z'),
  });
  assert.equal(summary.schemaVersion, 'sciforge.capability-evolution-compact-summary.v1');
  assert.equal(summary.totalRecords, 1);
  assert.equal(summary.fallbackRecordCount, 1);
  assert.equal(summary.repairRecordCount, 1);
  assert.equal(summary.recentRecords[0]?.failureCode, 'schema-invalid');
  assert.deepEqual(summary.recentRecords[0]?.artifactRefs, ['artifact:summary-1']);
  assert.deepEqual(summary.recentRecords[0]?.executionUnitRefs, [
    'execution-unit:composed-1',
    'execution-unit:atomic-1',
    'execution-unit:repair-1',
  ]);
  assert.equal(JSON.stringify(summary).includes('print('), false, 'compact summary must not expand glue code content');
  assert.equal(summary.recentRecords[0]?.recordRef, `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L1`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('[ok] capability evolution ledger writes JSONL fallback/repair records and builds compact ref-only summaries');
