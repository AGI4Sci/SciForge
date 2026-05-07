import { resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { genericBridgeBlockedPayload, runGenericVisionComputerUseLoop } from './vision-sense/computer-use-bridge.js';
import { visionSenseSafetyVerifierContract } from './vision-sense/safety-verifier.js';
import { loadVisionSenseConfig, looksLikeComputerUseRequest, rebindWindowTargetForPromptAppAlias, visionSenseSelected } from './vision-sense/sense-provider.js';
import { VISION_SENSE_RUNTIME_ID, VISION_TOOL_ID } from './vision-sense/trace-policy.js';
import { windowTargetTraceConfig } from './computer-use/window-target.js';

export async function tryRunVisionSenseRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!visionSenseSelected(request)) return undefined;
  if (!looksLikeComputerUseRequest(request.prompt)) return undefined;

  const workspace = resolve(request.workspacePath || process.cwd());
  const config = await loadVisionSenseConfig(workspace, request);
  rebindWindowTargetForPromptAppAlias(config, request.prompt);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'vision-sense-runtime-selected',
    source: 'workspace-runtime',
    toolName: VISION_TOOL_ID,
    status: 'running',
    message: 'Selected generic vision-sense Computer Use loop.',
    detail: JSON.stringify({
      dryRun: config.dryRun,
      captureDisplays: config.captureDisplays,
      windowTarget: windowTargetTraceConfig(config.windowTarget),
      plannedActions: config.plannedActions.length,
    }),
  });

  if (!config.desktopBridgeEnabled) {
    return genericBridgeBlockedPayload(
      request,
      workspace,
      'local.vision-sense is selected, but the generic desktop bridge is disabled. Enable SCIFORGE_VISION_DESKTOP_BRIDGE=1 or .sciforge/config.json visionSense.desktopBridgeEnabled=true.',
      {
        selectedRuntime: VISION_SENSE_RUNTIME_ID,
        selectedToolId: VISION_TOOL_ID,
        safetyVerifierContract: visionSenseSafetyVerifierContract,
      },
    );
  }

  return runGenericVisionComputerUseLoop(request, workspace, config, callbacks);
}
