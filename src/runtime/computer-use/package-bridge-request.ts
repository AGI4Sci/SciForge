import type { GatewayRequest } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import type { ComputerUseConfig } from './types.js';
import {
  type ComputerUseActionProviderRequest,
  computerUseHostPortsContract,
  gatewayRequestToComputerUseRequest,
} from './host-adapter.js';
import { normalizePackageBridgeApprovalRequest } from './package-bridge-approval.js';
import {
  completionEvidenceProducerEnabled,
  EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
  sanitizeCompletionEvidencePolicy,
} from './completion-evidence-policy.js';

export const PACKAGE_BRIDGE_RUN_TASK_BOUNDARY = 'computer_use.runTask(request, hostPorts)';

export type PackageBridgeRunTaskInvocation = {
  boundary: typeof PACKAGE_BRIDGE_RUN_TASK_BOUNDARY;
  request: ComputerUseActionProviderRequest;
  hostPorts: ReturnType<typeof computerUseHostPortsContract>;
  completionProducerOptIn: boolean;
};

export type PackageBridgeRuntimeSelectionDetailInput = {
  runId: string;
  testActionFixtureMode: boolean;
  testOnlyPlannedActions: number;
  planner: string;
};

export function materializePackageBridgeRunTaskInvocation(
  request: GatewayRequest,
  config: ComputerUseConfig,
  workspace: string,
): PackageBridgeRunTaskInvocation {
  return {
    boundary: PACKAGE_BRIDGE_RUN_TASK_BOUNDARY,
    request: materializePackageBridgeActionProviderRequest(request, config, workspace),
    hostPorts: computerUseHostPortsContract(config),
    completionProducerOptIn: packageBridgeCompletionProducerRequestOptIn(request),
  };
}

export function materializePackageBridgeRuntimeSelectionDetail(
  invocation: PackageBridgeRunTaskInvocation,
  detail: PackageBridgeRuntimeSelectionDetailInput,
) {
  return {
    actionProviderRequest: invocation.request,
    hostPorts: invocation.hostPorts,
    bridge: 'ts-package-host-port-loop',
    boundary: invocation.boundary,
    completionProducerOptIn: invocation.completionProducerOptIn,
    runId: detail.runId,
    testActionFixtureMode: detail.testActionFixtureMode,
    testOnlyPlannedActions: detail.testOnlyPlannedActions,
    planner: detail.planner,
  };
}

export function materializePackageBridgeActionProviderRequest(
  request: GatewayRequest,
  config: ComputerUseConfig,
  workspace: string,
): ComputerUseActionProviderRequest {
  return normalizePackageBridgeApprovalRequest(
    gatewayRequestToComputerUseRequest(request, config, workspace),
  );
}

export function materializePackageBridgeTraceRequest(
  request: GatewayRequest,
  actionProviderRequest: ComputerUseActionProviderRequest,
) {
  const computerUseLong = recordAt(request.uiState, 'computerUseLong');
  const cuNextTaskId = stringAt(computerUseLong, 'cuNextTaskId')
    ?? stringAt(recordAt(request.uiState, 'computerUseNext'), 'taskId')
    ?? stringAt(request.uiState, 'cuNextTaskId');
  return {
    text: request.prompt,
    selectedToolIds: request.selectedToolIds,
    taskId: cuNextTaskId,
    cuNextTaskId,
    computerUseLong,
    computerUseRequest: actionProviderRequest,
  };
}

export function packageBridgeCompletionProducerRequestOptIn(request: GatewayRequest): boolean {
  return completionEvidenceProducerEnabled(
    sanitizeCompletionEvidencePolicy(recordAt(request.uiState, 'completionEvidencePolicy')),
    EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
  );
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}
