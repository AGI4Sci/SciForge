import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CONTRACT_VALIDATION_FAILURE_CONTRACT_ID,
  contractValidationFailureSchema,
  type ContractValidationFailure,
} from '@sciforge-ui/runtime-contract/validation-failure';
import { CAPABILITY_BUDGET_DEBIT_CONTRACT_ID } from '@sciforge-ui/runtime-contract/capability-budget';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request.js';
import { repairNeededPayload, validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation.js';
import { repairNeededPayload as repairPolicyRepairNeededPayload } from '../../src/runtime/gateway/repair-policy.js';
import { contractValidationFailureFromVerificationResults } from '../../src/runtime/gateway/verification-results.js';
import {
  contractValidationFailureFromWorkEvidenceFinding,
  evaluateToolPayloadEvidence,
} from '../../src/runtime/gateway/work-evidence-guard.js';
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
  assertSerializableContractFailure(schemaFailure);
  assert.equal(schemaFailure.contract, CONTRACT_VALIDATION_FAILURE_CONTRACT_ID);
  assert.equal(schemaFailure.failureKind, 'payload-schema');
  assert.equal(schemaFailure.contractId, 'sciforge.tool-payload.v1');
  assert.ok(schemaFailure.missingFields.includes('claims'));
  assert.ok(schemaFailure.relatedRefs.includes(refs.outputRel));
  assert.match(JSON.stringify(schemaFailure), /missing claims/);
  const missingFieldsToolPayload = missingFieldsPayload as ToolPayload;
  const schemaDebit = missingFieldsToolPayload.budgetDebits?.[0];
  assert.ok(schemaDebit, 'payload schema validation failure should emit a capability budget debit');
  assert.equal(schemaDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
  assert.equal(schemaDebit.capabilityId, 'sciforge.payload-validation');
  assert.equal(schemaDebit.sinkRefs.executionUnitRef, stringField(missingFieldsToolPayload.executionUnits[0], 'id'));
  assert.ok(schemaDebit.sinkRefs.auditRefs.some((ref: string) => ref.startsWith('audit:payload-validation:')));
  assert.ok(schemaDebit.sinkRefs.auditRefs.some((ref: string) => ref.startsWith('appendTaskAttempt:payload-validation:')));
  assert.ok(schemaDebit.debitLines.some((line) => line.dimension === 'costUnits' && line.amount === 1));
  assert.ok(schemaDebit.debitLines.some((line) => line.dimension === 'resultItems' && line.amount >= 1));
  assert.ok(hasBudgetDebitRef(missingFieldsToolPayload.executionUnits[0], schemaDebit.debitId));
  assert.ok(missingFieldsToolPayload.logs?.some((entry) => entry.kind === 'capability-budget-debit-audit' && hasBudgetDebitRef(entry, schemaDebit.debitId)));

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
  assertSerializableContractFailure(artifactFailure);
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
  assertSerializableContractFailure(refFailure);
  assert.equal(refFailure.failureKind, 'reference');
  assert.deepEqual(refFailure.invalidRefs, ['file:.sciforge/uploads/current-input.pdf']);
  assert.ok(refFailure.relatedRefs.includes('file:.sciforge/uploads/current-input.pdf'));
  assert.match(JSON.stringify(refFailure), /Current-turn reference was not reflected/);

  const structureRefRequest = normalizeGatewayRequest({
    ...request,
    uiState: {
      currentReferences: [{
        kind: 'file',
        title: '1crn.cif',
        ref: 'file:.sciforge/uploads/1crn.cif',
        summary: 'Current turn uploaded structure file.',
      }],
    },
  });
  const structureRefPayload = await validateAndNormalizePayload({
    message: 'Analyzed 1crn structure and extracted the key contact summary.',
    confidence: 0.82,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'runtime smoke',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'structure-ref-smoke', status: 'done', tool: 'smoke' }],
    artifacts: [],
  }, structureRefRequest, skill, refs);
  assert.equal(structureRefPayload.executionUnits.some((unit) => unit.status === 'failed-with-reason'), false);

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
  assertSerializableContractFailure(planFailure);
  assert.equal(planFailure.failureKind, 'work-evidence');
  assert.equal(planFailure.contractId, 'sciforge.completed-payload.v1');
  assert.match(planFailure.failureReason, /only plan\/promise text/);
  assert.ok(planFailure.recoverActions.some((action) => /failed-with-reason|repair-needed/.test(action)));

  const planWithPreviewDeliverablePayload = await validateAndNormalizePayload({
    message: 'I will retrieve the latest papers and analyze the results.',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'backend completed with a stable table artifact ref',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'backend-stable-preview-ref', status: 'done', tool: 'agentserver.direct' }],
    artifacts: [{
      id: 'paper-table',
      type: 'table',
      dataRef: 'outputs/paper-table.csv?download=1',
    }],
  }, request, skill, refs);
  assert.equal(planWithPreviewDeliverablePayload.executionUnits[0]?.status, 'done');

  const workEvidenceRepair = repairNeededPayload(
    request,
    skill,
    'A command reports a non-zero exitCode while the payload is marked as successful or high confidence.',
    refs,
  );
  const workEvidenceFailure = validationFailureFromUnit(workEvidenceRepair.executionUnits[0]);
  assertSerializableContractFailure(workEvidenceFailure);
  assert.equal(workEvidenceFailure.failureKind, 'work-evidence');
  assert.equal(workEvidenceFailure.contractId, 'sciforge.work-evidence.v1');
  assert.equal(workEvidenceFailure.issues[0]?.path, 'executionUnits[].exitCode');
  assert.ok(workEvidenceFailure.relatedRefs.includes(refs.outputRel));
  assert.ok(recoverActionsFromUnit(workEvidenceRepair.executionUnits[0]).some((action) => /WorkEvidence/i.test(action)));
  assertRepairEvidenceRefs(workEvidenceRepair, refs.stdoutRel, refs.stderrRel);

  const emptyRetrievalRequest = normalizeGatewayRequest({
    ...request,
    prompt: 'Retrieve the latest papers about contract-aware scientific agents.',
  });
  const emptyRetrievalPayload: ToolPayload = {
    message: 'Completed literature retrieval. Web search retrieved 0 papers for the requested query.',
    confidence: 0.92,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'Search task completed successfully with 0 records.',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'empty-results' }],
    executionUnits: [{ id: 'empty-retrieval', status: 'done', tool: 'literature.search' }],
    artifacts: [{
      id: 'empty-results',
      type: 'search-results',
      data: { query: 'contract-aware scientific agents', results: [] },
      dataRef: 'file:.sciforge/task-results/empty-retrieval.json',
    }],
    workEvidence: [{
      kind: 'retrieval',
      status: 'success',
      input: { query: 'contract-aware scientific agents' },
      resultCount: 0,
      outputSummary: 'retrieved 0 papers',
      evidenceRefs: ['file:.sciforge/task-results/empty-retrieval.json'],
      recoverActions: [],
    }],
  };
  const emptyRetrievalFinding = evaluateToolPayloadEvidence(emptyRetrievalPayload, emptyRetrievalRequest);
  assert.equal(emptyRetrievalFinding?.kind, 'external-empty-result-without-diagnostics');
  const emptyRetrievalFailure = contractValidationFailureFromWorkEvidenceFinding(emptyRetrievalFinding, {
    capabilityId: skill.id,
    refs,
  });
  assert.ok(emptyRetrievalFailure);
  assertSerializableContractFailure(emptyRetrievalFailure);
  assert.equal(emptyRetrievalFailure.failureKind, 'work-evidence');
  assert.match(emptyRetrievalFailure.issues[0]?.message ?? '', /External retrieval returned zero results/);
  assert.ok(emptyRetrievalFailure.relatedRefs.includes(refs.stdoutRel));
  const emptyRetrievalRepair = repairPolicyRepairNeededPayload(request, skill, 'RAW_EMPTY_RESULT_REASON_SHOULD_NOT_APPEAR', {
    ...refs,
    validationFailure: emptyRetrievalFailure,
  });
  assert.match(emptyRetrievalRepair.message, /ContractValidationFailure work-evidence/);
  assert.doesNotMatch(JSON.stringify(emptyRetrievalRepair), /RAW_EMPTY_RESULT_REASON_SHOULD_NOT_APPEAR/);
  assertRepairEvidenceRefs(emptyRetrievalRepair, refs.stdoutRel, refs.stderrRel);

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
  assertRepairEvidenceRefs(structuredRepair, refs.stdoutRel, refs.stderrRel);
  const repairParams = JSON.parse(String(structuredRepairUnit.params)) as Record<string, unknown>;
  assert.ok(!('reason' in repairParams));
  assert.deepEqual((repairParams.validationFailure as Record<string, unknown> | undefined)?.invalidRefs, workEvidenceFailure.invalidRefs);

  const stderrDrivenRepair = repairPolicyRepairNeededPayload(
    request,
    skill,
    'Task output parsed validation failed; stderr contains a JSON parse error and stdout has partial output.',
    refs,
  );
  const stderrDrivenUnit = stderrDrivenRepair.executionUnits[0] as Record<string, unknown>;
  assert.equal(stderrDrivenUnit.stdoutRef, refs.stdoutRel);
  assert.equal(stderrDrivenUnit.stderrRef, refs.stderrRel);
  assertRepairEvidenceRefs(stderrDrivenRepair, refs.stdoutRel, refs.stderrRel);
  assert.ok(recoverActionsFromUnit(stderrDrivenUnit).some((action) => /stdoutRef.*stderrRef.*outputRef|stdoutRef|stderrRef/i.test(action)));
  const stderrDrivenParams = JSON.parse(String(stderrDrivenUnit.params)) as Record<string, unknown>;
  assert.ok(!('reason' in stderrDrivenParams));
  assert.equal((stderrDrivenParams.backendFailure as Record<string, unknown> | undefined)?.contract, 'sciforge.backend-repair-failure.v1');
  assert.equal(((stderrDrivenUnit.refs as Record<string, unknown>).backendFailure as Record<string, unknown> | undefined)?.failureKind, 'backend-diagnostic');

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
  assertSerializableContractFailure(verifierFailure);
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

function hasBudgetDebitRef(record: unknown, debitId: string) {
  return Boolean(
    record
    && typeof record === 'object'
    && !Array.isArray(record)
    && Array.isArray((record as { budgetDebitRefs?: unknown }).budgetDebitRefs)
    && ((record as { budgetDebitRefs: unknown[] }).budgetDebitRefs).includes(debitId),
  );
}

function stringField(record: unknown, field: string) {
  return record
    && typeof record === 'object'
    && !Array.isArray(record)
    && typeof (record as Record<string, unknown>)[field] === 'string'
    ? (record as Record<string, string>)[field]
    : undefined;
}

function assertSerializableContractFailure(failure: ContractValidationFailure) {
  const serialized = JSON.parse(JSON.stringify(failure)) as Record<string, unknown>;
  for (const key of contractValidationFailureSchema.required) {
    assert.ok(key in serialized, `serialized ContractValidationFailure missing ${key}`);
  }
  assert.equal(serialized.contract, CONTRACT_VALIDATION_FAILURE_CONTRACT_ID);
  assert.equal(typeof serialized.schemaPath, 'string');
  assert.equal(typeof serialized.contractId, 'string');
  assert.equal(typeof serialized.failureReason, 'string');
  assert.ok(Array.isArray(serialized.missingFields));
  assert.ok(Array.isArray(serialized.invalidRefs));
  assert.ok(Array.isArray(serialized.unresolvedUris));
  assert.ok(Array.isArray(serialized.recoverActions));
  assert.ok(Array.isArray(serialized.relatedRefs));
  assert.ok(Array.isArray(serialized.issues));
}

function assertRepairEvidenceRefs(payload: ToolPayload, stdoutRel: string, stderrRel: string) {
  const unit = payload.executionUnits[0] as Record<string, unknown> | undefined;
  assert.ok(unit);
  assert.equal(unit.stdoutRef, stdoutRel);
  assert.equal(unit.stderrRef, stderrRel);
  const diagnostic = (unit.refs as { diagnostic?: { evidenceRefs?: string[] } } | undefined)?.diagnostic;
  const evidenceRefs = diagnostic?.evidenceRefs;
  assert.ok(Array.isArray(evidenceRefs));
  assert.ok(evidenceRefs.includes(stdoutRel));
  assert.ok(evidenceRefs.includes(stderrRel));
  const objectRefs = Array.isArray(payload.objectReferences) ? payload.objectReferences : [];
  assert.ok(objectRefs.some((ref) => isRecordWithRef(ref, stdoutRel)));
  assert.ok(objectRefs.some((ref) => isRecordWithRef(ref, stderrRel)));
}

function isRecordWithRef(value: unknown, ref: string) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).ref === `file:${ref}`);
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

console.log('[ok] contract validation failures serialize payload, artifact, uiManifest, ref, completed-plan, preview extension refs, WorkEvidence, empty-result, stdout/stderr repair, structured repair, and verifier failures');
