import {
  evaluateWorkEvidencePolicy,
  type WorkEvidencePolicyFinding,
  type WorkEvidencePolicyPayload,
} from '@sciforge-ui/runtime-contract/work-evidence-policy';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { contractValidationFailureFromRepairReason } from './payload-validation.js';

export type WorkEvidenceGuardFinding = WorkEvidencePolicyFinding;

export function contractValidationFailureFromWorkEvidenceFinding(
  finding: WorkEvidenceGuardFinding,
  options: Parameters<typeof contractValidationFailureFromRepairReason>[1],
) {
  return contractValidationFailureFromRepairReason(finding.reason, options);
}

export function evaluateToolPayloadEvidence(payload: ToolPayload, request: GatewayRequest): WorkEvidenceGuardFinding | undefined {
  return evaluateWorkEvidencePolicy(payload as unknown as WorkEvidencePolicyPayload, { prompt: request.prompt });
}
