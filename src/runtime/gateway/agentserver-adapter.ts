import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, WorkspaceRuntimeCallbacks } from '../runtime-types.js';

export const DEFAULT_AGENTSERVER_ADAPTER_MODE = 'owned-orchestrator-third-party-backend' as const;
export const EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE = 'explicit-third-party-adapter' as const;

export type AgentServerAdapterMode =
  | typeof DEFAULT_AGENTSERVER_ADAPTER_MODE
  | 'third-party-adapter';

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
  mode: AgentServerAdapterMode;
  decisionOwner: 'AgentServer';
  backendBoundary: 'third-party-backend' | 'third-party-adapter';
  generateTask(params: AgentServerGenerationAdapterRequest): Promise<AgentServerGenerationAdapterResult>;
  repairTask?(params: Record<string, unknown>): Promise<unknown>;
  readRunStatus?(params: { baseUrl: string; runId: string }): Promise<unknown>;
  readRunStream?(params: { baseUrl: string; runId: string }): Promise<unknown>;
}

export interface CreateAgentServerAdapterOptions {
  mode?: AgentServerAdapterMode;
  compatibilityMode?: typeof EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE;
  generateTask: (params: AgentServerGenerationAdapterRequest) => Promise<AgentServerGenerationAdapterResult>;
  repairTask?: AgentServerAdapter['repairTask'];
  readRunStatus?: AgentServerAdapter['readRunStatus'];
  readRunStream?: AgentServerAdapter['readRunStream'];
}

export function createAgentServerAdapter(options: CreateAgentServerAdapterOptions): AgentServerAdapter {
  const mode = options.mode ?? DEFAULT_AGENTSERVER_ADAPTER_MODE;
  assertAgentServerAdapterMode(mode, options.compatibilityMode);
  return {
    mode,
    decisionOwner: 'AgentServer',
    backendBoundary: mode === 'third-party-adapter' ? 'third-party-adapter' : 'third-party-backend',
    generateTask: options.generateTask,
    repairTask: options.repairTask,
    readRunStatus: options.readRunStatus,
    readRunStream: options.readRunStream,
  };
}

export function createInlineAgentServerAdapter(
  generateTask: (params: AgentServerGenerationAdapterRequest) => Promise<AgentServerGenerationAdapterResult>,
  options: Omit<CreateAgentServerAdapterOptions, 'generateTask'> = {},
): AgentServerAdapter {
  return createAgentServerAdapter({ ...options, generateTask });
}

export function assertAgentServerAdapterMode(
  mode: AgentServerAdapterMode,
  compatibilityMode?: typeof EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE,
): void {
  if (mode === 'third-party-adapter' && compatibilityMode !== EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE) {
    throw new Error('AgentServerAdapter third-party-adapter mode requires explicit compatibilityMode=explicit-third-party-adapter');
  }
}
