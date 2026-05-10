import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  contractValidationFailureFromErrors,
  validationScopeForToolPayloadSchemaErrors,
} from '@sciforge-ui/runtime-contract/validation-failure';
import { normalizeWorkspaceTaskPayloadBoundary } from '../../src/runtime/gateway/direct-answer-payload.js';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request.js';
import { schemaValidationRepairPayload } from '../../src/runtime/gateway/payload-validation.js';
import { schemaErrors as toolPayloadSchemaErrors } from '../../src/runtime/gateway/tool-payload-contract.js';
import type { SkillAvailability } from '../../src/runtime/runtime-types.js';
import { verifyScientificReproduction } from '../../packages/verifiers/scientific-reproduction/index.js';

const fixtureUrl = new URL('../fixtures/scientific-reproduction/ui-attempt-failures/missing-envelope-nonarray-artifacts.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as Record<string, unknown>;
const failedAttempt = record(fixture.failedAttempt, 'failedAttempt');
const rawPayload = record(failedAttempt.rawPayload, 'failedAttempt.rawPayload');
const expectedContractFailures = stringArray(fixture.expectedContractFailures, 'expectedContractFailures');

const contractErrors = toolPayloadSchemaErrors(rawPayload);
for (const expected of expectedContractFailures) {
  assert.ok(
    contractErrors.includes(expected),
    `expected ToolPayload schema error "${expected}" in ${JSON.stringify(contractErrors)}`,
  );
}

const scope = validationScopeForToolPayloadSchemaErrors(contractErrors);
const validationFailure = contractValidationFailureFromErrors(contractErrors, {
  capabilityId: 'scientific-reproduction.ui-attempt.mock',
  failureKind: scope.failureKind,
  schemaPath: scope.schemaPath,
  contractId: scope.contractId,
  expected: scope.expected,
  actual: {
    hasMessage: 'message' in rawPayload,
    hasClaimsArray: Array.isArray(rawPayload.claims),
    hasUiManifestArray: Array.isArray(rawPayload.uiManifest),
    hasArtifactsArray: Array.isArray(rawPayload.artifacts),
    artifactContainerType: Array.isArray(rawPayload.artifacts) ? 'array' : typeof rawPayload.artifacts,
  },
  relatedRefs: [
    stringField(failedAttempt, 'outputRef'),
    stringField(failedAttempt, 'stdoutRef'),
    stringField(failedAttempt, 'stderrRef'),
  ],
});

assert.equal(validationFailure.failureKind, 'payload-schema');
assert.equal(validationFailure.contractId, 'sciforge.tool-payload.v1');
assert.ok(validationFailure.missingFields.includes('message'));
assert.ok(validationFailure.missingFields.includes('claims'));
assert.ok(validationFailure.missingFields.includes('uiManifest'));
assert.ok(validationFailure.issues.some((issue) => issue.path === 'artifacts' && issue.message === 'artifacts must be an array'));
assert.ok(validationFailure.recoverActions.some((action) => /required contract fields/i.test(action)));
assert.ok(validationFailure.relatedRefs.includes(stringField(failedAttempt, 'outputRef')));

assert.equal(Array.isArray(rawPayload.artifacts), false, 'malformed artifact map must not be accepted as a ToolPayload artifacts array');

const normalizedBoundary = record(normalizeWorkspaceTaskPayloadBoundary(rawPayload), 'normalizedBoundary');
assert.equal(Array.isArray(normalizedBoundary.artifacts), true, 'parser boundary should normalize artifact maps into arrays for preservation');
assert.deepEqual(toolPayloadSchemaErrors(normalizedBoundary).filter((error) => error === 'artifacts must be an array'), []);
assert.ok(toolPayloadSchemaErrors(normalizedBoundary).includes('missing message'));
assert.ok(toolPayloadSchemaErrors(normalizedBoundary).includes('missing claims'));
assert.ok(toolPayloadSchemaErrors(normalizedBoundary).includes('missing uiManifest'));

const request = normalizeGatewayRequest({
  skillDomain: 'literature',
  prompt: 'Use SciForge to reproduce scientific paper claims from workspace PDFs.',
  workspacePath: '/tmp/sciforge-scientific-reproduction-ui-failure-smoke',
});
const skill: SkillAvailability = {
  id: 'scientific-reproduction.ui-attempt.mock',
  kind: 'installed',
  available: true,
  reason: 'smoke fixture',
  checkedAt: '2026-05-11T00:00:00.000Z',
  manifestPath: 'tests/fixtures/scientific-reproduction/ui-attempt-failures/missing-envelope-nonarray-artifacts.json',
  manifest: {
    id: 'scientific-reproduction.ui-attempt.mock',
    kind: 'installed',
    description: 'Mock scientific reproduction UI attempt',
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
const refs = {
  taskRel: 'file:.sciforge/tasks/scientific-reproduction-ui-attempt-001.py',
  outputRel: stringField(failedAttempt, 'outputRef'),
  stdoutRel: stringField(failedAttempt, 'stdoutRef'),
  stderrRel: stringField(failedAttempt, 'stderrRef'),
};
const repairPayload = schemaValidationRepairPayload({
  payload: normalizedBoundary,
  sourcePayload: rawPayload,
  errors: contractErrors,
  request,
  skill,
  refs,
});
assert.match(repairPayload.message, /needs repair/i);
assert.equal(repairPayload.executionUnits[0].status, 'repair-needed');
assert.equal(repairPayload.executionUnits.some((unit) => unit.status === 'done'), false, 'malformed payload must not be marked successful');
assert.deepEqual(repairPayload.artifacts.map((artifact) => stringField(artifact, 'id')), ['claim-verdict-partial', 'figure-report-partial']);
assert.ok(repairPayload.artifacts.every((artifact) => record(artifact.metadata, 'artifact.metadata').preservedFromMalformedPayload === true));
assert.ok(repairPayload.objectReferences?.some((reference) => reference.ref === 'artifact:claim-verdict-partial'));
assert.ok(repairPayload.objectReferences?.some((reference) => reference.ref === 'file:.sciforge/artifacts/partial-reproduced-figure.png'));
const runtimeValidationFailure = record(record(repairPayload.executionUnits[0], 'repairPayload.executionUnits[0]').refs, 'repairPayload.executionUnits[0].refs').validationFailure;
assert.equal(record(runtimeValidationFailure, 'runtimeValidationFailure').contractId, 'sciforge.tool-payload.v1');
assert.ok(stringArray(record(runtimeValidationFailure, 'runtimeValidationFailure').missingFields, 'runtimeValidationFailure.missingFields').includes('message'));

const salvagedArtifacts = (normalizedBoundary.artifacts as unknown[]).map((artifact) =>
  record(artifact, 'normalizedBoundary.artifacts.*')
);
const partialOutputs = record(fixture.partialScientificOutputs, 'partialScientificOutputs');
const expectedArtifactIds = stringArray(partialOutputs.artifactIds, 'partialScientificOutputs.artifactIds');
assert.deepEqual(salvagedArtifacts.map((artifact) => stringField(artifact, 'id')), expectedArtifactIds);

const diagnosticRefs = stringArray(partialOutputs.diagnosticRefs, 'partialScientificOutputs.diagnosticRefs');
const traceRefs = stringArray(partialOutputs.traceRefs, 'partialScientificOutputs.traceRefs');
const verifierResult = verifyScientificReproduction({
  goal: 'Preserve partial scientific reproduction outputs from a malformed UI attempt for repair diagnostics.',
  resultRefs: diagnosticRefs,
  artifactRefs: expectedArtifactIds.map((id) => `artifact:${id}`),
  traceRefs,
  artifacts: salvagedArtifacts,
  providerHints: {
    requireFigureReproduction: true,
  },
});

assert.equal(verifierResult.schemaVersion, 'sciforge.scientific-reproduction-verifier.v1');
assert.equal(verifierResult.diagnostics.artifactCount, salvagedArtifacts.length);
assert.equal(verifierResult.diagnostics.claimCount, 1);
assert.equal(verifierResult.diagnostics.figureReproductionCount, 1);
assert.ok(verifierResult.evidenceRefs.includes(diagnosticRefs[0]));
assert.ok(verifierResult.evidenceRefs.includes(traceRefs[0]));
assert.ok(verifierResult.evidenceRefs.includes('file:.sciforge/artifacts/partial-reproduced-figure.png'));
assert.ok(
  verifierResult.criterionResults.some((criterion) =>
    criterion.id === 'figure-reproduction-evidence'
    && !criterion.passed
    && /missing code, input data, parameters, logs, or statistics/i.test(criterion.message)
  ),
);

console.log('[ok] scientific reproduction UI failure fixture rejects malformed ToolPayload while preserving partial outputs as verifier refs/diagnostics');

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value) && value.every((item) => typeof item === 'string'), `${label} must be a string array`);
  return value;
}

function stringField(value: Record<string, unknown>, field: string): string {
  assert.equal(typeof value[field], 'string', `${field} must be a string`);
  return value[field] as string;
}
