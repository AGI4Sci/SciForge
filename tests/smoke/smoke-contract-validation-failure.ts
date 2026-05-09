import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CONTRACT_VALIDATION_FAILURE_CONTRACT_ID,
  contractValidationFailureSchema,
  type ContractValidationFailure,
} from '@sciforge-ui/runtime-contract/validation-failure';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request.js';
import { validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation.js';
import type { SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-contract-validation-'));

try {
  const skill: SkillAvailability = {
    id: 'agentserver.generation.literature',
    kind: 'installed',
    available: true,
    reason: 'smoke',
    checkedAt: '2026-05-09T00:00:00.000Z',
    manifestPath: 'agentserver',
    manifest: {
      id: 'agentserver.generation.literature',
      kind: 'installed',
      description: 'smoke',
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
    taskRel: '.sciforge/tasks/contract-validation-smoke.py',
    outputRel: '.sciforge/task-results/contract-validation-smoke.json',
    stdoutRel: '.sciforge/logs/contract-validation-smoke.stdout.log',
    stderrRel: '.sciforge/logs/contract-validation-smoke.stderr.log',
    runtimeFingerprint: { runtime: 'smoke' },
  };
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: 'Validate failure contract serialization',
    workspacePath: workspace,
  });

  assert.equal(contractValidationFailureSchema.properties.contract.const, CONTRACT_VALIDATION_FAILURE_CONTRACT_ID);

  const missingFieldsPayload = await validateAndNormalizePayload({
    message: 'Schema missing fields smoke',
    confidence: 0.5,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'missing claims/ui contract',
    uiManifest: [],
    executionUnits: [],
    artifacts: [],
  } as unknown as ToolPayload, request, skill, refs);
  const schemaFailure = validationFailureFromUnit(missingFieldsPayload.executionUnits[0]);
  assert.equal(schemaFailure.contract, CONTRACT_VALIDATION_FAILURE_CONTRACT_ID);
  assert.equal(schemaFailure.failureKind, 'payload-schema');
  assert.equal(schemaFailure.contractId, 'sciforge.tool-payload.v1');
  assert.ok(schemaFailure.missingFields.includes('claims'));
  assert.ok(schemaFailure.relatedRefs.includes(refs.outputRel));
  assert.match(JSON.stringify(schemaFailure), /missing claims/);

  const artifactFailurePayload = await validateAndNormalizePayload({
    message: 'Artifact contract smoke',
    confidence: 0.5,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'artifact missing type',
    claims: [],
    uiManifest: [],
    executionUnits: [],
    artifacts: [{ id: '', type: '', data: { markdown: '# Report' } }],
  } as unknown as ToolPayload, request, skill, refs);
  const artifactFailure = validationFailureFromUnit(artifactFailurePayload.executionUnits[0]);
  assert.equal(artifactFailure.failureKind, 'artifact-schema');
  assert.equal(artifactFailure.contractId, 'sciforge.artifact.v1');
  assert.ok(artifactFailure.missingFields.includes('artifacts[0].type'));
  assert.ok(artifactFailure.issues.some((issue) => issue.path === 'artifacts[0].type' && issue.expected === 'non-empty string'));
  assert.ok(artifactFailure.recoverActions.some((action) => /artifacts/i.test(action)));
  assert.ok(artifactFailure.relatedRefs.includes(refs.outputRel));

  const uiManifestFailurePayload = await validateAndNormalizePayload({
    message: 'UI manifest contract smoke',
    confidence: 0.5,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'uiManifest missing componentId',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 42 }],
    executionUnits: [],
    artifacts: [],
  } as unknown as ToolPayload, request, skill, refs);
  const uiManifestFailure = validationFailureFromUnit(uiManifestFailurePayload.executionUnits[0]);
  assert.equal(uiManifestFailure.failureKind, 'ui-manifest');
  assert.equal(uiManifestFailure.contractId, 'sciforge.ui-manifest.v1');
  assert.ok(uiManifestFailure.missingFields.includes('uiManifest[0].artifactRef'));
  assert.ok(uiManifestFailure.recoverActions.some((action) => /uiManifest/i.test(action)));
  assert.ok(uiManifestFailure.relatedRefs.includes(refs.taskRel));

  const invalidRefRequest = normalizeGatewayRequest({
    ...request,
    uiState: {
      currentReferences: [{
        kind: 'file',
        title: 'current-input.pdf',
        ref: 'file:.sciforge/uploads/current-input.pdf',
        summary: 'Current turn uploaded file.',
      }],
    },
  });
  const invalidRefPayload = await validateAndNormalizePayload({
    message: 'Generated a report without citing the uploaded file.',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'runtime smoke',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
    executionUnits: [{ id: 'runtime-smoke', status: 'done', tool: 'smoke' }],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      data: { markdown: 'Report body with no current file token.' },
    }],
  }, invalidRefRequest, skill, refs);
  const refUnit = invalidRefPayload.executionUnits.find((unit) => unit.status === 'failed-with-reason');
  assert.ok(refUnit);
  const refFailure = validationFailureFromUnit(refUnit);
  assert.equal(refFailure.failureKind, 'reference');
  assert.deepEqual(refFailure.invalidRefs, ['file:.sciforge/uploads/current-input.pdf']);
  assert.ok(refFailure.relatedRefs.includes('file:.sciforge/uploads/current-input.pdf'));
  assert.match(JSON.stringify(refFailure), /Current-turn reference was not reflected/);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function validationFailureFromUnit(unit: Record<string, unknown> | undefined) {
  assert.ok(unit);
  const refs = unit.refs as { validationFailure?: ContractValidationFailure } | undefined;
  assert.ok(refs?.validationFailure);
  return refs.validationFailure;
}

console.log('[ok] contract validation failures serialize payload, artifact, uiManifest, and current-turn ref failures');
