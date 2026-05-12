import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';
import {
  downgradeTransientExternalFailures,
  isTransientExternalFailure,
  payloadHasOnlyTransientExternalDependencyFailures,
  transientExternalDependencyPayload,
  transientExternalFailureReasonFromRun,
} from './transient-external-failure.js';

function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'partial result',
    confidence: 0.2,
    claimType: 'research-survey',
    evidenceLevel: 'abstract-only',
    reasoningTrace: 'generated partial artifact',
    claims: [],
    uiManifest: [],
    executionUnits: [],
    artifacts: [],
    ...overrides,
  };
}

test('detects provider rate limits and network timeouts as transient external failures', () => {
  assert.equal(isTransientExternalFailure('HTTP Error 429: Unknown Error'), true);
  assert.equal(isTransientExternalFailure('HTTP Error 429: rate limited by provider'), true);
  assert.equal(isTransientExternalFailure('provider timed out after 30s'), true);
  assert.equal(isTransientExternalFailure('schema validation failed'), false);
});

test('downgrades transient external unit failures when readable artifacts exist', () => {
  const next = downgradeTransientExternalFailures(payload({
    executionUnits: [{
      id: 'fetch-primary',
      status: 'failed-with-reason',
      failureReason: 'HTTP Error 429: Unknown Error',
    }],
    artifacts: [{
      id: 'report',
      type: 'research-report',
      content: '# Partial report with explicit provider warning',
    }],
  }));

  assert.equal(next.executionUnits[0]?.status, 'needs-human');
  assert.equal(next.executionUnits[0]?.externalDependencyStatus, 'transient-unavailable');
  assert.equal(payloadHasOnlyTransientExternalDependencyFailures(next), true);
  assert.match(String(next.executionUnits[0]?.recoverActions), /Retry after provider backoff/);
  assert.equal(next.workEvidence?.[0]?.status, 'failed-with-reason');
  assert.equal(next.workEvidence?.[0]?.failureReason, 'HTTP Error 429: Unknown Error');
  assert.deepEqual(next.workEvidence?.[0]?.recoverActions.includes('Retry after provider backoff or rate-limit reset.'), true);
  const artifactData = next.artifacts[0]?.data as Record<string, unknown>;
  assert.equal((artifactData.transientPolicy as Record<string, unknown>).status, 'transient-unavailable');
  assert.match(next.reasoningTrace, /Transient external dependency failure/);
});

test('keeps non-transient generated task failures blocking', () => {
  const next = downgradeTransientExternalFailures(payload({
    executionUnits: [{
      id: 'schema',
      status: 'failed-with-reason',
      failureReason: 'schema validation failed',
    }],
    artifacts: [{
      id: 'report',
      type: 'research-report',
      content: '# Partial report',
    }],
  }));

  assert.equal(next.executionUnits[0]?.status, 'failed-with-reason');
  assert.equal(payloadHasOnlyTransientExternalDependencyFailures(next), false);
});

test('builds a diagnostic payload for pre-output transient external failures', () => {
  const run: WorkspaceTaskRunResult = {
    spec: {
      id: 'task-1',
      language: 'python',
      entrypoint: 'python',
      input: {},
      outputRel: '.sciforge/task-results/task-1.json',
      stdoutRel: '.sciforge/debug/task-1/stdout.log',
      stderrRel: '.sciforge/debug/task-1/stderr.log',
      taskRel: '.sciforge/generated-tasks/task-1.py',
    },
    workspace: '/tmp/workspace',
    command: 'python',
    args: ['task.py'],
    exitCode: 1,
    stdoutRef: '.sciforge/debug/task-1/stdout.log',
    stderrRef: '.sciforge/debug/task-1/stderr.log',
    outputRef: '.sciforge/task-results/task-1.json',
    stdout: 'HTTP 429 (rate limited), retry 1/5 after 5s\nNetwork error: The read operation timed out',
    stderr: '',
    runtimeFingerprint: {},
  };
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'research current papers',
    artifacts: [],
  } as GatewayRequest;
  const skill: SkillAvailability = {
    id: 'literature-evidence-review',
    kind: 'workspace',
    available: true,
    reason: 'ok',
    checkedAt: '2026-05-12T00:00:00.000Z',
    manifestPath: 'skill.json',
    manifest: {} as SkillAvailability['manifest'],
  };

  const reason = transientExternalFailureReasonFromRun(run);
  assert.match(reason ?? '', /429/);

  const diagnostic = transientExternalDependencyPayload({ request, skill, run, reason: reason ?? '' });
  assert.equal(diagnostic.claimType, 'runtime-diagnostic');
  assert.equal(diagnostic.executionUnits[0]?.status, 'needs-human');
  assert.equal(diagnostic.executionUnits[0]?.externalDependencyStatus, 'transient-unavailable');
  assert.equal(diagnostic.workEvidence?.[0]?.kind, 'retrieval');
  assert.equal(diagnostic.workEvidence?.[0]?.status, 'failed-with-reason');
  assert.deepEqual(diagnostic.workEvidence?.[0]?.evidenceRefs, [
    '.sciforge/debug/task-1/stdout.log',
    '.sciforge/debug/task-1/stderr.log',
  ]);
  const artifactData = diagnostic.artifacts[0]?.data as Record<string, unknown>;
  assert.equal((artifactData.transientPolicy as Record<string, unknown>).status, 'transient-unavailable');
  assert.ok(Array.isArray(artifactData.providerAttemptRefs));
  assert.ok(Array.isArray(artifactData.preservedRefs));
  assert.match(String(diagnostic.artifacts[0]?.content), /标准输出/);
  assert.equal(payloadHasOnlyTransientExternalDependencyFailures(diagnostic), true);
});
