import {
  evaluateWorkEvidencePolicy,
  type WorkEvidencePolicyFinding,
  type WorkEvidencePolicyPayload,
} from '@sciforge-ui/runtime-contract/work-evidence-policy';
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
  return evaluateWorkEvidencePolicy(payload as unknown as WorkEvidencePolicyPayload, { prompt: request.prompt });
}

function relatedRefsFromRepairRefs(refs: RepairPolicyRefs) {
  return [refs.taskRel, refs.outputRel, refs.stdoutRel, refs.stderrRel].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}
