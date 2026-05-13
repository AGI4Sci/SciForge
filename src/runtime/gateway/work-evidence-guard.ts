import {
  evaluateWorkEvidencePolicy,
  WORK_EVIDENCE_POLICY_CONTRACT_ID,
  WORK_EVIDENCE_POLICY_SCHEMA_PATH,
  type WorkEvidencePolicyFinding,
  type WorkEvidencePolicyPayload,
} from '@sciforge-ui/runtime-contract/work-evidence-policy';
import type { ValidationFindingProjectionInput } from '@sciforge-ui/runtime-contract/validation-repair-audit';
import { contractValidationFailureFromRepairReason } from '@sciforge-ui/runtime-contract/validation-failure';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import type { RepairPolicyRefs } from './repair-policy.js';

export type WorkEvidenceGuardFinding = WorkEvidencePolicyFinding;

export function contractValidationFailureFromWorkEvidenceFinding(
  finding: WorkEvidenceGuardFinding,
  options: {
    capabilityId: string;
    refs?: RepairPolicyRefs;
  },
) {
  return contractValidationFailureFromRepairReason(finding.reason, {
    capabilityId: options.capabilityId,
    relatedRefs: relatedRefsFromRepairRefs(options.refs ?? {}),
  });
}

export function evaluateToolPayloadEvidence(payload: ToolPayload, request: GatewayRequest): WorkEvidenceGuardFinding | undefined {
  return evaluateWorkEvidencePolicy(payload as unknown as WorkEvidencePolicyPayload, {
    skillDomain: request.skillDomain,
    expectedArtifactTypes: request.expectedArtifactTypes,
    selectedComponentIds: request.selectedComponentIds,
    expectedEvidenceKinds: request.expectedEvidenceKinds,
    externalIoRequired: request.externalIoRequired,
    selectedCapabilityIds: [
      ...stringList(request.selectedToolIds),
      ...stringList(request.selectedSenseIds),
      ...stringList(request.selectedVerifierIds),
    ],
  });
}

export function validationFindingProjectionFromWorkEvidenceGuardFinding(
  finding: WorkEvidenceGuardFinding,
  options: {
    id?: string;
    capabilityId?: string;
    relatedRefs?: string[];
  } = {},
): ValidationFindingProjectionInput {
  return {
    id: options.id,
    source: 'work-evidence',
    kind: 'work-evidence',
    status: finding.severity,
    failureMode: finding.kind,
    severity: finding.severity === 'failed-with-reason' ? 'error' : 'blocking',
    message: finding.reason,
    contractId: WORK_EVIDENCE_POLICY_CONTRACT_ID,
    schemaPath: WORK_EVIDENCE_POLICY_SCHEMA_PATH,
    capabilityId: options.capabilityId ?? 'sciforge.validation-guard',
    relatedRefs: options.relatedRefs,
    recoverActions: [
      'Regenerate the payload with durable WorkEvidence refs, provider diagnostics, or an explicit failed-with-reason status.',
      'Preserve the guard finding and output refs in validation-repair-audit before retrying.',
    ],
    diagnostics: {
      guard: 'work-evidence',
      guardKind: finding.kind,
      severity: finding.severity,
    },
    isFailure: true,
  };
}

function relatedRefsFromRepairRefs(refs: RepairPolicyRefs) {
  return [refs.taskRel, refs.outputRel, refs.stdoutRel, refs.stderrRel].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}
