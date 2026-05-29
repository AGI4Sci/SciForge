import type { ComputerUseActionProviderRequest } from './host-adapter.js';

const VISION_SENSE_DRY_RUN_SMOKE_APPROVAL_REF = 'approval:vision-sense-dry-run-smoke';

export function normalizePackageBridgeApprovalRequest(
  request: ComputerUseActionProviderRequest,
): ComputerUseActionProviderRequest {
  if (request.approvalRef !== VISION_SENSE_DRY_RUN_SMOKE_APPROVAL_REF) return request;
  return {
    ...request,
    riskPolicy: 'fail-closed',
    approvalRef: undefined,
    metadata: {
      ...request.metadata,
      ignoredApprovalRef: request.approvalRef,
      ignoredApprovalReason: 'vision-sense dry-run smoke approval does not authorize high-risk Computer Use actions',
    },
  };
}
