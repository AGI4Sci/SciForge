import type { AgentBackendAdapter, BackendGenerationResponse, GatewayRequest, SkillAvailability, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { agentBackendAdapter } from './agent-backend-config.js';

export const DEFAULT_BACKEND_GENERATION_ADAPTER_MODE = 'owned-orchestrator-third-party-backend' as const;
export const EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE = 'explicit-third-party-adapter' as const;

export type BackendGenerationAdapterMode =
  | typeof DEFAULT_BACKEND_GENERATION_ADAPTER_MODE
  | 'third-party-adapter';

export interface BackendGenerationAdapterRequest {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  callbacks?: WorkspaceRuntimeCallbacks;
  strictTaskFilesReason?: string;
}

export type BackendGenerationAdapterResult =
  | { ok: true; runId?: string; response: BackendGenerationResponse }
  | { ok: true; runId?: string; directPayload: unknown }
  | { ok: false; error: string; diagnostics?: unknown };

export interface BackendGenerationAdapter {
  mode: BackendGenerationAdapterMode;
  decisionOwner: 'AgentHost';
  backendBoundary: 'third-party-backend' | 'third-party-adapter';
  generateTask(params: BackendGenerationAdapterRequest): Promise<BackendGenerationAdapterResult>;
  repairTask?(params: Record<string, unknown>): Promise<unknown>;
  readRunStatus?(params: { baseUrl: string; runId: string }): Promise<unknown>;
  readRunStream?(params: { baseUrl: string; runId: string }): Promise<unknown>;
}

export interface CreateBackendGenerationAdapterOptions {
  mode?: BackendGenerationAdapterMode;
  compatibilityMode?: typeof EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE;
  generateTask: (params: BackendGenerationAdapterRequest) => Promise<BackendGenerationAdapterResult>;
  repairTask?: BackendGenerationAdapter['repairTask'];
  readRunStatus?: BackendGenerationAdapter['readRunStatus'];
  readRunStream?: BackendGenerationAdapter['readRunStream'];
}

export function createBackendGenerationAdapter(options: CreateBackendGenerationAdapterOptions): BackendGenerationAdapter {
  const mode = options.mode ?? DEFAULT_BACKEND_GENERATION_ADAPTER_MODE;
  assertBackendGenerationAdapterMode(mode, options.compatibilityMode);
  return {
    mode,
    decisionOwner: 'AgentHost',
    backendBoundary: mode === 'third-party-adapter' ? 'third-party-adapter' : 'third-party-backend',
    generateTask: options.generateTask,
    repairTask: options.repairTask,
    readRunStatus: options.readRunStatus,
    readRunStream: options.readRunStream,
  };
}

export function createInlineBackendGenerationAdapter(
  generateTask: (params: BackendGenerationAdapterRequest) => Promise<BackendGenerationAdapterResult>,
  options: Omit<CreateBackendGenerationAdapterOptions, 'generateTask'> = {},
): BackendGenerationAdapter {
  return createBackendGenerationAdapter({ ...options, generateTask });
}

export function backendAdapterForGenerationAdapter(
  adapter: Pick<BackendGenerationAdapter, 'mode' | 'backendBoundary'>,
  backend: string,
): AgentBackendAdapter {
  if (adapter.mode === DEFAULT_BACKEND_GENERATION_ADAPTER_MODE && adapter.backendBoundary !== 'third-party-backend') {
    throw new Error('BackendGenerationAdapter owned orchestrator mode requires a third-party-backend boundary');
  }
  return agentBackendAdapter(backend);
}

export function assertBackendGenerationAdapterMode(
  mode: BackendGenerationAdapterMode,
  compatibilityMode?: typeof EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE,
): void {
  if (mode === 'third-party-adapter' && compatibilityMode !== EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE) {
    throw new Error('BackendGenerationAdapter third-party-adapter mode requires explicit compatibilityMode=explicit-third-party-adapter');
  }
}
