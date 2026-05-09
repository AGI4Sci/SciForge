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
import { repairNeededPayload, validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation.js';
import { repairNeededPayload as repairPolicyRepairNeededPayload } from '../../src/runtime/gateway/repair-policy.js';
import { contractValidationFailureFromVerificationResults } from '../../src/runtime/gateway/verification-results.js';
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

  const planOnlyPayload = await validateAndNormalizePayload({
    message: 'I will retrieve the latest papers and analyze the results.',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'backend completed without doing the retrieval',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'backend-plan-only', status: 'done', tool: 'agentserver.direct' }],
    artifacts: [],
  }, request, skill, refs);
  const planUnit = planOnlyPayload.executionUnits[0] as Record<string, unknown>;
  assert.equal(planUnit.status, 'repair-needed');
  assert.ok(recoverActionsFromUnit(planUnit).some((action) => /Run the promised retrieval\/analysis work/.test(action)));
  const planFailure = validationFailureFromUnit(planUnit);
  assert.equal(planFailure.failureKind, 'work-evidence');
  assert.equal(planFailure.contractId, 'sciforge.completed-payload.v1');
  assert.match(planFailure.failureReason, /only plan\/promise text/);
  assert.ok(planFailure.recoverActions.some((action) => /failed-with-reason|repair-needed/.test(action)));

  const workEvidenceRepair = repairNeededPayload(
    request,
    skill,
    'A command reports a non-zero exitCode while the payload is marked as successful or high confidence.',
    refs,
  );
  const workEvidenceFailure = validationFailureFromUnit(workEvidenceRepair.executionUnits[0]);
  assert.equal(workEvidenceFailure.failureKind, 'work-evidence');
  assert.equal(workEvidenceFailure.contractId, 'sciforge.work-evidence.v1');
  assert.equal(workEvidenceFailure.issues[0]?.path, 'executionUnits[].exitCode');
  assert.ok(workEvidenceFailure.relatedRefs.includes(refs.outputRel));
  assert.ok(recoverActionsFromUnit(workEvidenceRepair.executionUnits[0]).some((action) => /WorkEvidence/i.test(action)));

  const rawScatteredReason = 'RAW_SCATTERED_REASON_SHOULD_NOT_APPEAR_IN_STRUCTURED_REPAIR';
  const structuredRepair = repairPolicyRepairNeededPayload(request, skill, rawScatteredReason, {
    ...refs,
    validationFailure: workEvidenceFailure,
  });
  const structuredRepairUnit = structuredRepair.executionUnits[0] as Record<string, unknown>;
  const structuredRepairText = JSON.stringify(structuredRepair);
  assert.doesNotMatch(structuredRepairText, new RegExp(rawScatteredReason));
  assert.match(structuredRepair.message, /ContractValidationFailure work-evidence/);
  assert.match(String(structuredRepairUnit.reasoningTrace ?? structuredRepair.reasoningTrace), /structuredValidationFailure=ContractValidationFailure/);
  assert.equal(structuredRepairUnit.failureReason, structuredRepair.message.replace(/^SciForge runtime gateway needs repair or AgentServer task generation: /, ''));
  assert.deepEqual(recoverActionsFromUnit(structuredRepairUnit), workEvidenceFailure.recoverActions);
  assert.equal(structuredRepairUnit.nextStep, workEvidenceFailure.nextStep);
  assert.ok(requiredInputsFromUnit(structuredRepairUnit).includes(`contract:${workEvidenceFailure.contractId}`));
  const repairParams = JSON.parse(String(structuredRepairUnit.params)) as Record<string, unknown>;
  assert.ok(!('reason' in repairParams));
  assert.deepEqual((repairParams.validationFailure as Record<string, unknown> | undefined)?.invalidRefs, workEvidenceFailure.invalidRefs);

  const verifierFailure = contractValidationFailureFromVerificationResults({
    id: 'schema.verifier',
    verdict: 'fail',
    confidence: 0.96,
    critique: 'Artifact schema verifier failed.',
    evidenceRefs: ['file:.sciforge/verifications/schema.verifier.json'],
    repairHints: ['Regenerate the report artifact with the required schema.'],
  }, {
    capabilityId: skill.id,
    relatedRefs: ['file:.sciforge/verifications/schema.verifier.json'],
  });
  assert.ok(verifierFailure);
  assert.equal(verifierFailure.failureKind, 'verifier');
  assert.equal(verifierFailure.contractId, 'sciforge.verification-result.v1');
  assert.ok(verifierFailure.relatedRefs.includes('file:.sciforge/verifications/schema.verifier.json'));
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function validationFailureFromUnit(unit: Record<string, unknown> | undefined) {
  assert.ok(unit);
  const refs = unit.refs as { validationFailure?: ContractValidationFailure } | undefined;
  assert.ok(refs?.validationFailure);
  return refs.validationFailure;
}

function recoverActionsFromUnit(unit: unknown) {
  assert.ok(unit && typeof unit === 'object' && !Array.isArray(unit));
  const actions = (unit as Record<string, unknown>).recoverActions;
  assert.ok(Array.isArray(actions));
  return actions.filter((action): action is string => typeof action === 'string');
}

function requiredInputsFromUnit(unit: unknown) {
  assert.ok(unit && typeof unit === 'object' && !Array.isArray(unit));
  const inputs = (unit as Record<string, unknown>).requiredInputs;
  assert.ok(Array.isArray(inputs));
  return inputs.filter((input): input is string => typeof input === 'string');
}

console.log('[ok] contract validation failures serialize payload, artifact, uiManifest, ref, completed-plan, WorkEvidence, structured repair, and verifier failures');
