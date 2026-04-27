import { runWorkspaceRuntimeGateway } from './workspace-runtime-gateway.js';
import type { ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';

export async function runBioAgentTool(body: Record<string, unknown>, callbacks: WorkspaceRuntimeCallbacks = {}): Promise<ToolPayload> {
  return runWorkspaceRuntimeGateway(body, callbacks);
}
