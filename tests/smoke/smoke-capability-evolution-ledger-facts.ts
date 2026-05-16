import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
  type CapabilityEvolutionRecord,
  type CapabilityEvolutionRecordStatus,
} from '../../packages/contracts/runtime/capability-evolution.js';
import { normalizeToolPayloadShape } from '../../src/runtime/gateway/direct-answer-payload.js';
import {
  appendCapabilityEvolutionRecord,
  readCapabilityEvolutionLedgerFacts,
} from '../../src/runtime/capability-evolution-ledger.js';
import { recordCapabilityEvolutionRuntimeEvent } from '../../src/runtime/gateway/capability-evolution-events.js';
import { tryAgentServerSupplementMissingArtifacts } from '../../src/runtime/gateway/generated-task-runner-supplement-lifecycle.js';
import type { GeneratedTaskRunnerDeps } from '../../src/runtime/gateway/generated-task-runner.js';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capability-ledger-facts-'));
const recordedAt = '2026-05-10T02:00:00.000Z';

await appendCapabilityEvolutionRecord({ workspacePath: workspace }, record('success', 'succeeded'));
await appendCapabilityEvolutionRecord({
  workspacePath: workspace,
}, record('fallback-success', 'fallback-succeeded', {
  composedResult: {
    status: 'fallback-succeeded',
    failureCode: 'provider-unavailable',
    fallbackable: true,
    recoverActions: ['used atomic fallback'],
    atomicTrace: [{
      capabilityId: 'capability.atomic.search',
      providerId: 'provider:offline',
      status: 'succeeded',
      executionUnitRefs: ['unit:fallback-success:atomic'],
      artifactRefs: ['artifact:fallback-success:atomic.json'],
    }],
    relatedRefs: {
      executionUnitRefs: ['unit:fallback-success:atomic'],
      artifactRefs: ['artifact:fallback-success:atomic.json'],
    },
  },
}));
await appendCapabilityEvolutionRecord({
  workspacePath: workspace,
}, record('repair-failed', 'repair-failed', {
  failureCode: 'schema-invalid',
  repairAttempts: [{
    id: 'repair:repair-failed',
    status: 'attempted',
    reason: 'schema repair rerun did not produce required artifact',
    executionUnitRefs: ['unit:repair-failed:repair'],
    artifactRefs: ['artifact:repair-failed/report.json'],
    startedAt: recordedAt,
    completedAt: recordedAt,
  }],
  validationResult: {
    verdict: 'fail',
    validatorId: 'contract:report',
    failureCode: 'schema-invalid',
    summary: 'required field missing',
    resultRef: 'validation:repair-failed',
  },
}));
await appendCapabilityEvolutionRecord({ workspacePath: workspace }, record('needs-human', 'needs-human'));

const request: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Generate a compact report and complete missing matrix artifacts.',
  workspacePath: workspace,
  expectedArtifactTypes: ['research-report', 'evidence-matrix'],
  artifacts: [],
  uiState: { sessionId: 'session:ledger-facts' },
};
const skill: SkillAvailability = {
  id: 'agentserver.generation.literature',
  kind: 'installed',
  available: true,
  reason: 'ledger facts smoke',
  checkedAt: recordedAt,
  manifestPath: 'agentserver://literature',
  manifest: {
    id: 'agentserver.generation.literature',
    kind: 'installed',
    description: 'ledger facts smoke',
    skillDomains: ['literature'],
    inputContract: {},
    outputArtifactSchema: {},
    entrypoint: { type: 'agentserver-generation' },
    environment: {},
    validationSmoke: {},
    examplePrompts: [],
    promotionHistory: [],
  },
};

await recordCapabilityEvolutionRuntimeEvent({
  workspacePath: workspace,
  request,
  skill,
  taskId: 'generated-success-facts',
  runId: 'agentserver-run-success-facts',
  run: runResult('generated-success-facts'),
  payload: payload('generated-success-report', 'research-report', 'generated-success-unit'),
  taskRel: '.sciforge/tasks/generated-success-facts.py',
  inputRel: '.sciforge/task-inputs/generated-success-facts.json',
  outputRel: '.sciforge/task-results/generated-success-facts.json',
  stdoutRel: '.sciforge/logs/generated-success-facts.stdout.log',
  stderrRel: '.sciforge/logs/generated-success-facts.stderr.log',
  finalStatus: 'succeeded',
  recoverActions: ['record-successful-dynamic-glue', 'preserve-runtime-evidence-refs'],
  eventKind: 'dynamic-glue-execution',
  now: () => new Date('2026-05-10T02:01:00.000Z'),
});

const supplemented = await tryAgentServerSupplementMissingArtifacts({
  request,
  skill,
  skills: [skill],
  workspace,
  payload: payload('primary-report', 'research-report', 'primary-unit'),
  primaryTaskId: 'generated-fallback-facts',
  primaryRunId: 'agentserver-run-fallback-facts',
  primaryRun: runResult('generated-fallback-facts'),
  primaryRefs: {
    taskRel: '.sciforge/tasks/generated-fallback-facts.py',
    outputRel: '.sciforge/task-results/generated-fallback-facts.json',
    stdoutRel: '.sciforge/logs/generated-fallback-facts.stdout.log',
    stderrRel: '.sciforge/logs/generated-fallback-facts.stderr.log',
  },
  expectedArtifactTypes: ['research-report', 'evidence-matrix'],
  deps: { normalizeToolPayloadShape } as GeneratedTaskRunnerDeps,
  runGeneratedTask: async () => payload('supplement-matrix', 'evidence-matrix', 'supplement-unit'),
});
assert.ok(supplemented?.artifacts.some((artifact) => artifact.id === 'supplement-matrix'));

const facts = await readCapabilityEvolutionLedgerFacts({ workspacePath: workspace });
assert.equal(facts.length, 6);
assert.deepEqual(facts.map((fact) => fact.recordRef), [
  '.sciforge/capability-evolution-ledger/records.jsonl#L1',
  '.sciforge/capability-evolution-ledger/records.jsonl#L2',
  '.sciforge/capability-evolution-ledger/records.jsonl#L3',
  '.sciforge/capability-evolution-ledger/records.jsonl#L4',
  '.sciforge/capability-evolution-ledger/records.jsonl#L5',
  '.sciforge/capability-evolution-ledger/records.jsonl#L6',
]);

const success = facts.find((fact) => fact.recordId === 'success')!;
assert.deepEqual(success.factKinds, ['success']);
assert.deepEqual(success.selectedCapabilityIds, ['capability.primary.success']);

const fallback = facts.find((fact) => fact.recordId === 'fallback-success')!;
assert.deepEqual(fallback.factKinds, ['fallback', 'success']);
assert.equal(fallback.failureCode, 'provider-unavailable');
assert.equal(fallback.fallbackable, true);
assert.ok(fallback.executionUnitRefs.includes('unit:fallback-success:primary'));

const repair = facts.find((fact) => fact.recordId === 'repair-failed')!;
assert.deepEqual(repair.factKinds, ['failure', 'repair']);
assert.equal(repair.repairAttemptCount, 1);
assert.equal(repair.failureCode, 'schema-invalid');
assert.equal(repair.validationSummary, 'required field missing');

const human = facts.find((fact) => fact.recordId === 'needs-human')!;
assert.deepEqual(human.factKinds, ['failure', 'needs-human']);
assert.equal(human.finalStatus, 'needs-human');

const generatedSuccess = facts.find((fact) => fact.runId === 'agentserver-run-success-facts')!;
assert.deepEqual(generatedSuccess.factKinds, ['success']);
assert.equal(generatedSuccess.finalStatus, 'succeeded');
assert.ok(generatedSuccess.artifactRefs.includes('artifact:generated-success-report'));
assert.ok(generatedSuccess.executionUnitRefs.includes('execution-unit:generated-success-unit'));

const generatedFallback = facts.find((fact) => fact.runId === 'agentserver-run-fallback-facts')!;
assert.deepEqual(generatedFallback.factKinds, ['fallback', 'success']);
assert.equal(generatedFallback.finalStatus, 'fallback-succeeded');
assert.equal(generatedFallback.failureCode, 'missing-artifact');
assert.equal(generatedFallback.fallbackable, true);
assert.ok(generatedFallback.artifactRefs.includes('artifact:supplement-matrix'));
assert.ok(generatedFallback.executionUnitRefs.includes('execution-unit:supplement-unit'));

const limitedFacts = await readCapabilityEvolutionLedgerFacts({ workspacePath: workspace, limit: 2 });
assert.deepEqual(limitedFacts.map((fact) => fact.recordRef), [
  '.sciforge/capability-evolution-ledger/records.jsonl#L5',
  '.sciforge/capability-evolution-ledger/records.jsonl#L6',
]);
assert.deepEqual(limitedFacts.map((fact) => fact.factKinds), [
  ['success'],
  ['fallback', 'success'],
]);

console.log('[ok] capability evolution ledger projects success, failure, fallback, repair, and needs-human records into compact facts');

function record(
  id: string,
  finalStatus: CapabilityEvolutionRecordStatus,
  overrides: Partial<CapabilityEvolutionRecord> = {},
): CapabilityEvolutionRecord {
  return {
    schemaVersion: CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
    id,
    recordedAt,
    runId: `run:${id}`,
    sessionId: 'session:ledger-facts',
    goalSummary: `ledger fact ${id}`,
    selectedCapabilities: [{
      id: `capability.primary.${id}`,
      role: 'primary',
      providerId: 'provider:offline',
    }],
    providers: [{
      id: 'provider:offline',
      kind: 'local-runtime',
    }],
    inputSchemaRefs: ['schema:input'],
    outputSchemaRefs: ['schema:output'],
    executionUnitRefs: [`unit:${id}:primary`],
    artifactRefs: [`artifact:${id}/report.json`],
    recoverActions: [],
    repairAttempts: [],
    finalStatus,
    ...overrides,
  };
}

function payload(artifactId: string, artifactType: string, unitId: string): ToolPayload {
  return {
    message: `${artifactType} payload`,
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: `generated ${artifactType}`,
    claims: [{ text: `${artifactType} generated`, confidence: 0.9 }],
    uiManifest: [{ componentId: artifactType, artifactRef: artifactId }],
    executionUnits: [{ id: unitId, status: 'done', tool: 'python' }],
    artifacts: [{
      id: artifactId,
      type: artifactType,
      schema: { type: 'object' },
      data: {},
    }],
  };
}

function runResult(taskId: string): WorkspaceTaskRunResult {
  return {
    spec: {
      id: taskId,
      language: 'python',
      entrypoint: `.sciforge/tasks/${taskId}.py`,
      input: {},
      outputRel: `.sciforge/task-results/${taskId}.json`,
      stdoutRel: `.sciforge/logs/${taskId}.stdout.log`,
      stderrRel: `.sciforge/logs/${taskId}.stderr.log`,
      taskRel: `.sciforge/tasks/${taskId}.py`,
    },
    workspace,
    command: 'python',
    args: [],
    exitCode: 0,
    stdoutRef: `.sciforge/logs/${taskId}.stdout.log`,
    stderrRef: `.sciforge/logs/${taskId}.stderr.log`,
    outputRef: `.sciforge/task-results/${taskId}.json`,
    stdout: '',
    stderr: '',
    runtimeFingerprint: { runtime: 'python' },
  };
}
