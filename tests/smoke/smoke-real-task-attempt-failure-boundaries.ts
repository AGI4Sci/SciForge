import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation.js';
import { appendTaskAttempt, readTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import { readFailureSignatureRegistry } from '../../src/runtime/failure-signature-registry.js';
import type { GatewayRequest, SkillAvailability, TaskAttemptRecord, ToolPayload } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-real-task-attempt-boundaries-'));

const refs = {
  failedOutput: '.sciforge/task-results/r-run-01-timeout.json',
  failedStdout: '.sciforge/logs/r-run-01-timeout.stdout.log',
  failedStderr: '.sciforge/logs/r-run-01-timeout.stderr.log',
  codeDriftOutput: '.sciforge/task-results/r-code-02-malformed.json',
  codeDriftStdout: '.sciforge/logs/r-code-02-malformed.stdout.log',
  codeDriftStderr: '.sciforge/logs/r-code-02-malformed.stderr.log',
  repairOutput: '.sciforge/task-results/r-run-02-repair-noop.json',
  repairStdout: '.sciforge/logs/r-run-02-repair-noop.stdout.log',
  repairStderr: '.sciforge/logs/r-run-02-repair-noop.stderr.log',
  sessionBundle: '.sciforge/sessions/2026-05-12_r-run-07_restore-old-session',
};

await writeFixtureFiles();
await appendTaskAttempt(workspace, failedRunAttempt());

const allowedLoosePayload = await validateAndNormalizePayload(looseBackendPayload(), gatewayRequest(), skill(), {
  taskRel: '.sciforge/tasks/r-code-02-loose-backend.ts',
  outputRel: refs.codeDriftOutput,
  stdoutRel: refs.codeDriftStdout,
  stderrRel: refs.codeDriftStderr,
  runtimeFingerprint: { smoke: 'real-task-attempt-failure-boundaries' },
});
assert.equal(firstExecutionStatus(allowedLoosePayload), 'done');
assert.match(JSON.stringify(allowedLoosePayload.logs ?? []), /allowed-structural-drift/);

const missingEnvelopePayload = await validateAndNormalizePayload(missingEnvelopePayloadFixture(), gatewayRequest(), skill(), {
  taskRel: '.sciforge/tasks/r-code-02-malformed-backend.ts',
  outputRel: refs.codeDriftOutput,
  stdoutRel: refs.codeDriftStdout,
  stderrRel: refs.codeDriftStderr,
  runtimeFingerprint: { smoke: 'real-task-attempt-failure-boundaries' },
});
assert.equal(firstExecutionStatus(missingEnvelopePayload), 'repair-needed');
assert.match(JSON.stringify(missingEnvelopePayload), /fail closed|missing message|required envelope/i);
await writeFileSafe(join(workspace, refs.codeDriftOutput), JSON.stringify(missingEnvelopePayload, null, 2));
await appendTaskAttempt(workspace, malformedPayloadAttempt());

await appendTaskAttempt(workspace, repairNoopAttempt(1));
await appendTaskAttempt(workspace, repairNoopAttempt(2));

const failedAttempts = await readTaskAttempts(workspace, 'r-run-01-timeout');
assert.equal(failedAttempts.length, 1);
assert.equal(failedAttempts[0]?.sessionBundleRef, refs.sessionBundle);
assert.ok(failedAttempts[0]?.taskRunCard?.refs.some((ref) => ref.kind === 'bundle' && ref.ref === refs.sessionBundle));
assert.ok(failedAttempts[0]?.taskRunCard?.refs.some((ref) => ref.kind === 'execution-unit'));
assert.match(failedAttempts[0]?.taskRunCard?.nextStep ?? '', /refs|stdout|stderr|rerun|continue|inspect/i);

const repairAttempts = await readTaskAttempts(workspace, 'r-run-02-repair-noop');
assert.equal(repairAttempts.length, 2);
assert.ok(repairAttempts.every((attempt) => attempt.taskRunCard?.taskOutcome === 'needs-work'));
assert.ok(repairAttempts.every((attempt) => /Continue from preserved refs|Inspect failure signatures/.test(attempt.taskRunCard?.nextStep ?? '')));

const registry = await readFailureSignatureRegistry(workspace);
const timeout = registry.entries.find((entry) => entry.kind === 'timeout');
const schema = registry.entries.find((entry) => entry.kind === 'schema-drift');
const repair = registry.entries.find((entry) => entry.kind === 'repair-no-op');
assert.equal(registry.schemaVersion, 'sciforge.failure-signature-registry.v1');
assert.equal(timeout?.runRefs[0]?.sessionBundleRef, refs.sessionBundle);
assert.equal(schema?.occurrenceCount, 1);
assert.equal(repair?.occurrenceCount, 2);
assert.deepEqual(repair?.runRefs.map((ref) => ref.runId).sort(), [
  'task-attempt:r-run-02-repair-noop:1',
  'task-attempt:r-run-02-repair-noop:2',
]);

console.log(JSON.stringify({
  ok: true,
  workspace,
  refs,
  failureRegistry: '.sciforge/failure-signatures/registry.json',
  taskIds: failedAttempts.concat(repairAttempts).map((attempt) => attempt.id),
}, null, 2));

async function writeFixtureFiles() {
  await writeFileSafe(join(workspace, refs.failedOutput), JSON.stringify({
    message: 'Timeout run failed after preserving diagnostic refs.',
    executionUnits: [{
      id: 'r-run-01-timeout-eu',
      status: 'failed-with-reason',
      failureReason: 'AgentServer generation request timed out after 30000ms.',
      stdoutRef: refs.failedStdout,
      stderrRef: refs.failedStderr,
      outputRef: refs.failedOutput,
      recoverActions: ['Reuse cached refs and rerun after backend timeout budget is adjusted.'],
    }],
    artifacts: [{
      id: 'partial-timeout-diagnostic',
      type: 'runtime-diagnostic',
      data: { markdown: 'Partial diagnostic survived the failed run.' },
    }],
  }, null, 2));
  await writeFileSafe(join(workspace, refs.failedStdout), 'partial progress before timeout\n');
  await writeFileSafe(join(workspace, refs.failedStderr), 'AgentServer generation request timed out after 30000ms.\n');
  await writeFileSafe(join(workspace, refs.codeDriftStdout), 'backend returned malformed payload\n');
  await writeFileSafe(join(workspace, refs.codeDriftStderr), '');
  await writeFileSafe(join(workspace, refs.repairOutput), JSON.stringify({ message: 'repair no-op fixture' }, null, 2));
  await writeFileSafe(join(workspace, refs.repairStdout), 'repair attempted but produced no diff\n');
  await writeFileSafe(join(workspace, refs.repairStderr), 'Repair no-op: repeated same failure with no change.\n');
  await mkdir(join(workspace, refs.sessionBundle, 'records', 'task-attempts'), { recursive: true });
}

function failedRunAttempt(): TaskAttemptRecord {
  return {
    id: 'r-run-01-timeout',
    prompt: 'Diagnose the failed run without rerunning expensive work.',
    skillDomain: 'knowledge',
    skillId: 'agentserver.generated-task',
    scenarioPackageRef: { id: 'runtime-failure-boundary', version: '1.0.0', source: 'workspace' },
    attempt: 1,
    status: 'failed-with-reason',
    failureReason: 'AgentServer generation request timed out after 30000ms.',
    outputRef: refs.failedOutput,
    stdoutRef: refs.failedStdout,
    stderrRef: refs.failedStderr,
    sessionId: 'old-session-r-run-07',
    sessionBundleRef: refs.sessionBundle,
    createdAt: '2026-05-12T00:00:00.000Z',
  } as TaskAttemptRecord;
}

function malformedPayloadAttempt(): TaskAttemptRecord {
  return {
    id: 'r-code-02-malformed',
    prompt: 'Handle backend schema drift and malformed payload without entering an unbounded repair loop.',
    skillDomain: 'knowledge',
    skillId: 'agentserver.generated-task',
    scenarioPackageRef: { id: 'runtime-failure-boundary', version: '1.0.0', source: 'workspace' },
    attempt: 1,
    status: 'repair-needed',
    failureReason: 'Contract validation failed: missing message in backend payload envelope.',
    schemaErrors: ['missing message', 'uiManifest[0].artifactRef must be a non-empty string when present'],
    outputRef: refs.codeDriftOutput,
    stdoutRef: refs.codeDriftStdout,
    stderrRef: refs.codeDriftStderr,
    createdAt: '2026-05-12T00:01:00.000Z',
  } as TaskAttemptRecord;
}

function repairNoopAttempt(attempt: number): TaskAttemptRecord {
  return {
    id: 'r-run-02-repair-noop',
    prompt: 'Stop repeated repair attempts when the same failure returns with no code or payload change.',
    skillDomain: 'knowledge',
    skillId: 'agentserver.repair-loop',
    scenarioPackageRef: { id: 'runtime-failure-boundary', version: '1.0.0', source: 'workspace' },
    attempt,
    status: 'repair-needed',
    failureReason: `Repair no-op: repeated same failure with no change on attempt ${attempt}.`,
    outputRef: refs.repairOutput,
    stdoutRef: refs.repairStdout,
    stderrRef: refs.repairStderr,
    createdAt: `2026-05-12T00:0${attempt + 1}:00.000Z`,
  } as TaskAttemptRecord;
}

function looseBackendPayload(): ToolPayload {
  return {
    message: 'Loose backend payload should be structurally normalized.',
    confidence: 0.61,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: ['backend returned a trace array', 'normalization is structural only'],
    claims: [],
    uiManifest: [{
      component: 'report-viewer',
      artifactRef: '',
    }],
    executionUnits: [{ id: 'r-code-02-loose', status: 'done' }],
    artifacts: {
      report: {
        artifactType: 'research-report',
        data: { markdown: 'Normalized from an artifact map.' },
      },
    },
  } as unknown as ToolPayload;
}

function missingEnvelopePayloadFixture(): ToolPayload {
  return {
    confidence: 0.2,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'missing required envelope fields must fail closed',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: '' }],
    executionUnits: [{ id: 'r-code-02-malformed', status: 'done' }],
    artifacts: [{
      id: 'partial-malformed-report',
      type: 'runtime-diagnostic',
      data: { markdown: 'Partial artifact should be preserved for repair diagnostics.' },
    }],
  } as unknown as ToolPayload;
}

function gatewayRequest(): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt: 'R-CODE-02 schema drift runtime boundary smoke',
    workspacePath: workspace,
    scenarioPackageRef: { id: 'runtime-failure-boundary', version: '1.0.0', source: 'workspace' },
    artifacts: [],
    uiState: { sessionId: 'schema-drift-session' },
  } as GatewayRequest;
}

function skill(): SkillAvailability {
  return {
    id: 'agentserver.generated-task',
    kind: 'agentserver',
    available: true,
    checkedAt: '2026-05-12T00:00:00.000Z',
    reason: 'smoke fixture',
  } as unknown as SkillAvailability;
}

function firstExecutionStatus(payload: ToolPayload) {
  return payload.executionUnits[0]?.status;
}

async function writeFileSafe(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
