import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, WorkspaceRuntimeCallbacks } from '../runtime-types.js';

export interface AgentServerGenerationAdapterRequest {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  callbacks?: WorkspaceRuntimeCallbacks;
  strictTaskFilesReason?: string;
}

export type AgentServerGenerationAdapterResult =
  | { ok: true; runId?: string; response: AgentServerGenerationResponse }
  | { ok: true; runId?: string; directPayload: unknown }
  | { ok: false; error: string; diagnostics?: unknown };

export interface AgentServerAdapter {
  generateTask(params: AgentServerGenerationAdapterRequest): Promise<AgentServerGenerationAdapterResult>;
  repairTask?(params: Record<string, unknown>): Promise<unknown>;
  readRunStatus?(params: { baseUrl: string; runId: string }): Promise<unknown>;
  readRunStream?(params: { baseUrl: string; runId: string }): Promise<unknown>;
}

export function createInlineAgentServerAdapter(
  generateTask: (params: AgentServerGenerationAdapterRequest) => Promise<AgentServerGenerationAdapterResult>,
): AgentServerAdapter {
  return { generateTask };
}
