import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  contractValidationFailureFromErrors,
  validationScopeForToolPayloadSchemaErrors,
} from '@sciforge-ui/runtime-contract/validation-failure';
import { schemaErrors as toolPayloadSchemaErrors } from '../../src/runtime/gateway/tool-payload-contract.js';
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

const salvagedArtifacts = Object.values(record(rawPayload.artifacts, 'failedAttempt.rawPayload.artifacts')).map((artifact) =>
  record(artifact, 'failedAttempt.rawPayload.artifacts.*')
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
