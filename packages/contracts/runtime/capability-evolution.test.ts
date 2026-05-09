import assert from 'node:assert/strict';
import {
  CAPABILITY_EVOLUTION_BROKER_DIGEST_CONTRACT_ID,
  CAPABILITY_EVOLUTION_COMPACT_SUMMARY_CONTRACT_ID,
  CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
  type CapabilityEvolutionBrokerDigest,
  type CapabilityEvolutionCompactSummary,
  type CapabilityEvolutionRecord,
} from './capability-evolution';

const fallbackRecord = {
  schemaVersion: CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
  id: 'cel-contract-fallback',
  recordedAt: '2026-05-09T00:00:00.000Z',
  runId: 'run-contract-fallback',
  goalSummary: 'Fallback from a composed capability to atomic runtime tasks.',
  selectedCapabilities: [{ id: 'capability.composed.report', kind: 'composed', providerId: 'agentserver.generation.literature', role: 'primary' }],
  providers: [{ id: 'sciforge.workspace-runtime', kind: 'local-runtime' }],
  inputSchemaRefs: ['capability-fallback:literature:expected-artifacts'],
  outputSchemaRefs: ['artifact-schema:research-report'],
  glueCodeRef: '.sciforge/tasks/generated/report.py',
  executionUnitRefs: ['execution-unit:primary', 'execution-unit:atomic'],
  artifactRefs: ['artifact:report'],
  validationResult: {
    verdict: 'fail',
    validatorId: 'sciforge.expected-artifact-contract',
    failureCode: 'missing-artifact',
    summary: 'Primary composed output missed an expected report artifact.',
    resultRef: '.sciforge/task-results/generated.json',
  },
  failureCode: 'missing-artifact',
  recoverActions: ['fallback-to-atomic', 'merge-supplemental-payload'],
  repairAttempts: [],
  fallbackPolicy: {
    atomicCapabilities: [{ id: 'runtime.python-task', kind: 'tool', providerId: 'sciforge.core.runtime.python-task', role: 'fallback' }],
    fallbackToAtomicWhen: ['missing-artifact'],
    doNotFallbackWhen: ['unsafe-side-effect', 'requires-human-approval'],
    retryBudget: { maxRetries: 1, maxFallbackAttempts: 1 },
    fallbackContext: {
      reason: 'Missing expected artifact types: research-report',
      preserveExecutionUnitRefs: ['execution-unit:primary'],
      preserveArtifactRefs: ['artifact:primary-output'],
      validationResultRefs: ['.sciforge/task-results/generated.json'],
    },
  },
  composedResult: {
    status: 'fallback-succeeded',
    failureCode: 'missing-artifact',
    fallbackable: true,
    recoverActions: ['fallback-to-atomic', 'merge-supplemental-payload'],
    atomicTrace: [{
      capabilityId: 'runtime.python-task',
      providerId: 'sciforge.core.runtime.python-task',
      status: 'succeeded',
      executionUnitRefs: ['execution-unit:atomic'],
      artifactRefs: ['artifact:report'],
      validationResult: { verdict: 'pass', validatorId: 'sciforge.expected-artifact-contract' },
    }],
    relatedRefs: {
      runId: 'run-contract-fallback',
      glueCodeRef: '.sciforge/tasks/generated/report.py',
      executionUnitRefs: ['execution-unit:primary', 'execution-unit:atomic'],
      artifactRefs: ['artifact:report'],
      validationResultRefs: ['.sciforge/task-results/generated.json'],
    },
  },
  finalStatus: 'fallback-succeeded',
} satisfies CapabilityEvolutionRecord;

assert.equal(fallbackRecord.schemaVersion, CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID);
assert.equal(fallbackRecord.fallbackPolicy?.fallbackContext?.reason, 'Missing expected artifact types: research-report');
assert.equal(fallbackRecord.composedResult?.atomicTrace[0]?.capabilityId, 'runtime.python-task');
assert.deepEqual(fallbackRecord.executionUnitRefs, ['execution-unit:primary', 'execution-unit:atomic']);
assert.deepEqual(fallbackRecord.artifactRefs, ['artifact:report']);

const compactSummary = {
  schemaVersion: CAPABILITY_EVOLUTION_COMPACT_SUMMARY_CONTRACT_ID,
  generatedAt: '2026-05-09T00:00:01.000Z',
  sourceRef: '.sciforge/capability-evolution-ledger/records.jsonl',
  totalRecords: 1,
  statusCounts: { 'fallback-succeeded': 1 },
  fallbackRecordCount: 1,
  repairRecordCount: 0,
  promotionCandidates: [],
  recentRecords: [{
    id: fallbackRecord.id,
    recordedAt: fallbackRecord.recordedAt,
    runId: fallbackRecord.runId,
    goalSummary: fallbackRecord.goalSummary,
    selectedCapabilityIds: ['capability.composed.report'],
    providerIds: ['sciforge.workspace-runtime'],
    finalStatus: fallbackRecord.finalStatus,
    failureCode: fallbackRecord.failureCode,
    fallbackable: true,
    fallbackDecision: {
      trigger: 'missing-artifact',
      reason: 'Missing expected artifact types: research-report',
      fallbackable: true,
      atomicCapabilityIds: ['runtime.python-task'],
      blockedBy: ['unsafe-side-effect', 'requires-human-approval'],
      recoverActions: ['fallback-to-atomic', 'merge-supplemental-payload'],
    },
    atomicTrace: [{
      capabilityId: 'runtime.python-task',
      providerId: 'sciforge.core.runtime.python-task',
      status: 'succeeded',
      executionUnitRefs: ['execution-unit:atomic'],
      artifactRefs: ['artifact:report'],
    }],
    recoverActions: ['fallback-to-atomic', 'merge-supplemental-payload'],
    repairAttemptCount: 0,
    artifactRefs: ['artifact:report'],
    executionUnitRefs: ['execution-unit:primary', 'execution-unit:atomic'],
    validationSummary: 'Primary composed output missed an expected report artifact.',
    recordRef: '.sciforge/capability-evolution-ledger/records.jsonl#L1',
  }],
} satisfies CapabilityEvolutionCompactSummary;

const brokerDigest = {
  schemaVersion: CAPABILITY_EVOLUTION_BROKER_DIGEST_CONTRACT_ID,
  generatedAt: compactSummary.generatedAt,
  sourceRef: compactSummary.sourceRef,
  totalRecords: compactSummary.totalRecords,
  consumedRecordRefs: ['.sciforge/capability-evolution-ledger/records.jsonl#L1'],
  selectedCapabilityIds: ['capability.composed.report', 'runtime.python-task'],
  failureCodes: ['missing-artifact'],
  recoverActions: ['fallback-to-atomic', 'merge-supplemental-payload'],
  promotionCandidateCount: 0,
} satisfies CapabilityEvolutionBrokerDigest;

assert.equal(compactSummary.schemaVersion, CAPABILITY_EVOLUTION_COMPACT_SUMMARY_CONTRACT_ID);
assert.equal(compactSummary.recentRecords[0]?.fallbackDecision?.trigger, 'missing-artifact');
assert.equal(brokerDigest.schemaVersion, CAPABILITY_EVOLUTION_BROKER_DIGEST_CONTRACT_ID);

console.log('[ok] capability evolution runtime contracts preserve fallback reason, atomic trace, run refs, execution units, and artifact refs');
