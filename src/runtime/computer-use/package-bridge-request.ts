import type { GatewayRequest } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import type { ComputerUseConfig } from './types.js';
import {
  type ComputerUseActionProviderRequest,
  computerUseHostPortsContract,
  gatewayRequestToComputerUseRequest,
} from './host-adapter.js';
import { normalizePackageBridgeApprovalRequest } from './package-bridge-approval.js';

export const PACKAGE_BRIDGE_PRIMITIVE_BOUNDARY = 'computer_use.primitiveBridge(request, hostPorts)';

export type PackageBridgePrimitiveInvocation = {
  boundary: typeof PACKAGE_BRIDGE_PRIMITIVE_BOUNDARY;
  request: ComputerUseActionProviderRequest;
  hostPorts: ReturnType<typeof computerUseHostPortsContract>;
};

export type PackageBridgeRuntimeSelectionDetailInput = {
  runId: string;
  testActionFixtureMode: boolean;
  testOnlyPlannedActions: number;
  planner: string;
};

export function materializePackageBridgePrimitiveInvocation(
  request: GatewayRequest,
  config: ComputerUseConfig,
  workspace: string,
): PackageBridgePrimitiveInvocation {
  return {
    boundary: PACKAGE_BRIDGE_PRIMITIVE_BOUNDARY,
    request: materializePackageBridgeActionProviderRequest(request, config, workspace),
    hostPorts: computerUseHostPortsContract(config),
  };
}

export function materializePackageBridgeRuntimeSelectionDetail(
  invocation: PackageBridgePrimitiveInvocation,
  detail: PackageBridgeRuntimeSelectionDetailInput,
) {
  return {
    actionProviderRequest: invocation.request,
    hostPorts: invocation.hostPorts,
    bridge: 'ts-package-host-port-loop',
    boundary: invocation.boundary,
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
