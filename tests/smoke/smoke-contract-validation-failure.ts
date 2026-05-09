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

console.log('[ok] contract validation failures serialize schema missing fields and invalid current-turn refs');
