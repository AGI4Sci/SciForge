import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUPPORTED_RUNTIME_AGENT_BACKENDS,
  compactCapabilityForAgentBackend,
  runtimeAgentBackendCapabilities,
} from './agent-backend-policy';
import {
  BACKEND_COMPARISON_CONTRACT_ID,
  backendComparisonHasBackendNeutralFix,
  buildBackendComparisonReport,
  validateBackendComparisonReport,
} from './backend-comparison';

const comparisonBackends = [...SUPPORTED_RUNTIME_AGENT_BACKENDS].slice(0, 2);
assert.equal(comparisonBackends.length, 2);
const [firstBackend, secondBackend] = comparisonBackends;

test('backend comparison validates every supported backend without copying backend lists', () => {
  const report = buildBackendComparisonReport({
    taskId: 'same-direct-tool-payload',
    runs: SUPPORTED_RUNTIME_AGENT_BACKENDS.map((backend) => ({
      backend,
      agentBackend: backend,
      runtimeBackend: backend,
      decisionBackend: backend,
      status: 'passed',
      handoff: { parsedToolPayload: true, runId: `run-${backend}` },
      evidenceRefs: [`run:${backend}`],
    })),
  });

  assert.equal(report.contract, BACKEND_COMPARISON_CONTRACT_ID);
  assert.equal(report.status, 'consistent');
  assert.deepEqual(report.comparedBackends, [...SUPPORTED_RUNTIME_AGENT_BACKENDS]);
  assert.deepEqual(validateBackendComparisonReport(report), []);
  for (const run of report.runs) {
    assert.deepEqual(run.capabilities, runtimeAgentBackendCapabilities(run.backend));
    assert.equal(run.compactCapability, compactCapabilityForAgentBackend(run.backend));
    assert.equal(run.handoff.kind, 'direct-tool-payload');
  }
});

test('same schema failure across backends yields a backend-neutral schema normalization fix', () => {
  const report = buildBackendComparisonReport({
    taskId: 'schema-failure-shared',
    runs: comparisonBackends.map((backend) => ({
      backend,
      agentBackend: backend,
      runtimeBackend: backend,
      status: 'failed',
      handoff: {
        text: '{"taskFiles": "not an array"}',
      },
      failureMessage: 'schema invalid: taskFiles must be an array',
      evidenceRefs: [`artifact:${backend}:handoff-debug`],
    })),
  });

  assert.equal(report.status, 'needs-backend-neutral-fix');
  assert.equal(backendComparisonHasBackendNeutralFix(report), true);
  assert.equal(report.backendNeutralFixes[0]?.kind, 'schema-normalization');
  assert.deepEqual(report.backendNeutralFixes[0]?.affectedBackends, comparisonBackends);
  assert.match(report.nextActions.join('\n'), /backend-neutral parser/);
  assert.equal(report.noHardcodeReview.status, 'pass');
});

test('different output shapes across supported backends are classified as backend drift', () => {
  const report = buildBackendComparisonReport({
    taskId: 'handoff-drift-diverged',
    runs: [{
      backend: firstBackend,
      agentBackend: firstBackend,
      runtimeBackend: firstBackend,
      status: 'passed',
      handoff: { parsedGeneration: true },
      evidenceRefs: [`run:${firstBackend}:task-files`],
    }, {
      backend: secondBackend,
      agentBackend: secondBackend,
      runtimeBackend: secondBackend,
      status: 'needs-retry',
      handoff: { text: '{"taskFiles": "malformed"}' },
      evidenceRefs: [`run:${secondBackend}:malformed`],
    }],
  });

  assert.equal(report.status, 'backend-drift');
  assert.equal(report.runs[0]?.handoff.kind, 'task-files');
  assert.equal(report.runs[1]?.handoff.kind, 'malformed-generation-response');
  assert.match(report.nextActions.join('\n'), /outcomes diverged/i);
});

test('metadata backend mismatch blocks repair inference', () => {
  const report = buildBackendComparisonReport({
    taskId: 'metadata-mismatch',
    runs: [{
      backend: firstBackend,
      agentBackend: secondBackend,
      runtimeBackend: firstBackend,
      status: 'passed',
      handoff: { parsedToolPayload: true },
    }, {
      backend: secondBackend,
      agentBackend: secondBackend,
      runtimeBackend: secondBackend,
      status: 'passed',
      handoff: { parsedToolPayload: true },
    }],
  });

  assert.equal(report.status, 'blocked');
  assert.ok(report.invariants.some((invariant) => invariant.id === 'metadata-backend-consistency' && invariant.status === 'failed'));
  assert.ok(report.invariants.some((invariant) => invariant.id === 'metadata-backend-consistency' && invariant.backendRefs.includes(firstBackend)));
  assert.match(report.nextActions.join('\n'), /metadata/);
});

test('unsupported backend blocks comparison before repair inference', () => {
  const report = buildBackendComparisonReport({
    taskId: 'unsupported-backend',
    runs: [{
      backend: 'fixture-unsupported-backend',
      agentBackend: 'fixture-unsupported-backend',
      runtimeBackend: 'fixture-unsupported-backend',
      status: 'passed',
      handoff: { parsedToolPayload: true },
    }, {
      backend: firstBackend,
      agentBackend: firstBackend,
      runtimeBackend: firstBackend,
      status: 'passed',
      handoff: { parsedToolPayload: true },
    }],
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.runs[0]?.supported, false);
  assert.equal(report.runs[0]?.provider, undefined);
  assert.ok(report.invariants.some((invariant) => invariant.id === 'supported-backend' && invariant.status === 'failed'));
});
