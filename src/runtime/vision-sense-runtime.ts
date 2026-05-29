import { resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { visionSenseSafetyVerifierContract } from './vision-sense/safety-verifier.js';
import { loadVisionSenseConfig, looksLikeComputerUseRequest, rebindWindowTargetForPromptAppAlias, visionSenseSelected } from './vision-sense/sense-provider.js';
import { VISION_SENSE_RUNTIME_ID, VISION_TOOL_ID } from './vision-sense/trace-policy.js';
import { windowTargetTraceConfig } from './computer-use/window-target.js';
import { visionSenseRuntimeEventTypes } from '../../packages/observe/vision/computer-use-runtime-policy.js';
import { COMPUTER_USE_ACTION_PROVIDER_ID, computerUseHostPortsContract, gatewayRequestToComputerUseRequest } from './computer-use/host-adapter.js';
import { runComputerUsePackageBridge } from './computer-use/package-bridge.js';
import { genericBridgeBlockedPayload } from './vision-sense/computer-use-trace-output.js';
import { isRecord, toStringList, uniqueStrings } from './gateway-utils.js';

export async function tryRunVisionSenseRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!visionSenseSelected(request)) return undefined;
  if (looksLikePlaywrightEdgeMcpBrowserRequest(request.prompt)) return undefined;
  if (!computerUseActionProviderSelected(request) && !looksLikeComputerUseRequest(request.prompt)) return undefined;

  const workspace = resolve(request.workspacePath || process.cwd());
  const config = await loadVisionSenseConfig(workspace, request);
  rebindWindowTargetForPromptAppAlias(config, request.prompt);
  const computerUseRequest = gatewayRequestToComputerUseRequest(request, config, workspace);
  const hostPorts = computerUseHostPortsContract(config);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: visionSenseRuntimeEventTypes.runtimeSelected,
    source: 'workspace-runtime',
    toolName: VISION_TOOL_ID,
    status: 'running',
    message: 'Selected Computer Use action provider with local.vision-sense host adapter.',
    detail: JSON.stringify({
      actionProviderRequest: computerUseRequest,
      hostPorts,
      dryRun: config.dryRun,
      captureDisplays: config.captureDisplays,
      windowTarget: windowTargetTraceConfig(config.windowTarget),
      testActionFixtureMode: config.testActionFixtureMode,
      testOnlyPlannedActions: config.testActionFixtureMode ? config.testOnlyPlannedActions.length : 0,
    }),
  });

  if (!config.desktopBridgeEnabled) {
    return genericBridgeBlockedPayload(
      request,
      workspace,
      'Computer Use action provider host adapter is selected, but desktop bridge is disabled at preflight. Enable SCIFORGE_VISION_DESKTOP_BRIDGE=1 or .sciforge/config.json visionSense.desktopBridgeEnabled=true.',
      {
        selectedRuntime: VISION_SENSE_RUNTIME_ID,
        selectedToolId: VISION_TOOL_ID,
        safetyVerifierContract: visionSenseSafetyVerifierContract,
      },
    );
  }

  return runComputerUsePackageBridge(request, workspace, config, callbacks);
}

function looksLikePlaywrightEdgeMcpBrowserRequest(prompt: string) {
  const text = prompt.toLowerCase();
  return /\bplaywright_edge_browser\b/.test(text)
    || /sciforge\.observe\.playwright-edge-mcp/.test(text)
    || (/\bplaywright\s+mcp\b/.test(text) && /\b(edge|msedge|microsoft\s+edge)\b/.test(text));
}

function computerUseActionProviderSelected(request: GatewayRequest) {
  if (/^\/(?:computer-use|computer\s+use)\b/i.test(request.prompt.trim())) return true;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const selectedActionIds = uniqueStrings([
    ...(request.selectedActionIds ?? []),
    ...toStringList(uiState.selectedActionIds),
  ]);
  return selectedActionIds.includes(COMPUTER_USE_ACTION_PROVIDER_ID);
}
