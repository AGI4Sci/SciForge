import assert from 'node:assert/strict';

import {
  SUPPORTED_RUNTIME_AGENT_BACKENDS,
  compactCapabilityForAgentBackend,
  runtimeAgentBackendCapabilities,
} from '@sciforge-ui/runtime-contract/agent-backend-policy';
import {
  backendComparisonHasBackendNeutralFix,
  buildBackendComparisonReport,
  validateBackendComparisonReport,
} from '@sciforge-ui/runtime-contract/backend-comparison';

const comparisonBackends = [...SUPPORTED_RUNTIME_AGENT_BACKENDS].slice(0, 2);
assert.equal(comparisonBackends.length, 2);
const [firstBackend, secondBackend] = comparisonBackends;

const consistency = buildBackendComparisonReport({
  taskId: 'r-code-09-same-direct-payload',
  runs: SUPPORTED_RUNTIME_AGENT_BACKENDS.map((backend) => ({
    backend,
    agentBackend: backend,
    runtimeBackend: backend,
    decisionBackend: backend,
    status: 'passed',
    handoff: { parsedToolPayload: true, runId: `direct-${backend}` },
    evidenceRefs: [`run:${backend}:direct-payload`],
  })),
  createdAt: '2026-05-13T00:00:00.000Z',
});

assert.deepEqual(validateBackendComparisonReport(consistency), []);
assert.equal(consistency.status, 'consistent');
for (const run of consistency.runs) {
  assert.deepEqual(run.capabilities, runtimeAgentBackendCapabilities(run.backend));
  assert.equal(run.compactCapability, compactCapabilityForAgentBackend(run.backend));
  assert.equal(run.handoff.kind, 'direct-tool-payload');
}

const sharedSchemaFailure = buildBackendComparisonReport({
  taskId: 'r-code-09-shared-schema-failure',
  runs: comparisonBackends.map((backend) => ({
    backend,
    agentBackend: backend,
    runtimeBackend: backend,
    decisionBackend: backend,
    status: 'failed',
    handoff: { text: '{"taskFiles": {"bad": true}}', runId: `schema-${backend}` },
    failureMessage: 'schema invalid: taskFiles must be an array before execution',
    evidenceRefs: [`artifact:${backend}:schema-debug`],
  })),
  createdAt: '2026-05-13T00:00:00.000Z',
});

assert.deepEqual(validateBackendComparisonReport(sharedSchemaFailure), []);
assert.equal(sharedSchemaFailure.status, 'needs-backend-neutral-fix');
assert.equal(backendComparisonHasBackendNeutralFix(sharedSchemaFailure), true);
assert.equal(sharedSchemaFailure.backendNeutralFixes[0]?.kind, 'schema-normalization');
assert.deepEqual(sharedSchemaFailure.backendNeutralFixes[0]?.affectedBackends, comparisonBackends);
assert.match(sharedSchemaFailure.nextActions.join('\n'), /backend-neutral parser|validator/);
assert.equal(sharedSchemaFailure.noHardcodeReview.status, 'pass');

const divergentHandoff = buildBackendComparisonReport({
  taskId: 'r-code-09-divergent-handoff',
  runs: [{
    backend: firstBackend,
    agentBackend: firstBackend,
    runtimeBackend: firstBackend,
    status: 'passed',
    handoff: { parsedGeneration: true, runId: `${firstBackend}-task-files` },
    evidenceRefs: [`run:${firstBackend}:task-files`],
  }, {
    backend: secondBackend,
    agentBackend: secondBackend,
    runtimeBackend: secondBackend,
    status: 'needs-retry',
    handoff: { text: '{"taskFiles": "malformed"}', runId: `${secondBackend}-malformed` },
    evidenceRefs: [`run:${secondBackend}:malformed`],
  }],
});

assert.equal(divergentHandoff.status, 'backend-drift');
assert.equal(divergentHandoff.backendNeutralFixes.length, 0);
assert.match(divergentHandoff.nextActions.join('\n'), /outcomes diverged/);

const blockedUnsupported = buildBackendComparisonReport({
  taskId: 'r-code-09-unsupported-backend',
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

assert.equal(blockedUnsupported.status, 'blocked');
assert.ok(blockedUnsupported.invariants.some((invariant) => invariant.id === 'supported-backend' && invariant.status === 'failed'));

console.log('[ok] backend comparison contract compares supported backend invariants, shared schema failures, and divergent handoff drift without real provider calls');
