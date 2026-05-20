import type { AgentBackendAdapter, AgentBackendCapabilities, GatewayRequest, LlmEndpointConfig } from '../runtime-types.js';
import {
  runtimeAgentBackendCapabilities,
  runtimeAgentBackendConfigurationFailureIsBlocking,
  runtimeAgentBackendProvider,
  runtimeAgentBackendSupported,
} from '@sciforge-ui/runtime-contract/agent-backend-policy';
import {
  compactBackendContext,
  readBackendContextWindowState,
} from './agentserver-context-window.js';

export const AGENTSERVER_BACKEND_SELECTION_DECISION_SCHEMA_VERSION = 'sciforge.agentserver-backend-selection-decision.v1' as const;

export type AgentServerBackendSelectionSource =
  | 'request.agentBackend'
  | 'env.SCIFORGE_AGENTSERVER_BACKEND'
  | 'llmEndpoint.baseUrl'
  | 'runtime.default';

export type AgentServerGenerationDispatchOptInSource =
  | 'request.agentBackend'
  | 'request.forceAgentServerGeneration'
  | 'request.agentServerBaseUrl'
  | 'request.llmEndpoint'
  | 'env.SCIFORGE_AGENTSERVER_BACKEND'
  | 'env.SCIFORGE_LEGACY_AGENTSERVER_DEFAULT_DISPATCH';

export interface AgentServerBackendSelectionDecision {
  schemaVersion: typeof AGENTSERVER_BACKEND_SELECTION_DECISION_SCHEMA_VERSION;
  shadowMode: true;
  decisionOwner: 'AgentServer';
  harnessStage: 'beforeAgentDispatch';
  decision: string;
  backend: string;
  provider?: string;
  source: AgentServerBackendSelectionSource;
  reason: string;
  runtimeSignals: {
    requestBackendPresent: boolean;
    requestBackendSupported: boolean;
    envBackendPresent: boolean;
    envBackendSupported: boolean;
    llmEndpointConfigured: boolean;
    fallbackBackend: 'codex';
  };
  trace: {
    selectionOrder: AgentServerBackendSelectionSource[];
    ignoredSources: string[];
  };
}

export interface AgentServerGenerationDispatchQuarantineDecision {
  schemaVersion: 'sciforge.agentserver-generation-dispatch-quarantine.v1';
  allowed: boolean;
  source?: AgentServerGenerationDispatchOptInSource;
  reason: string;
  backendSelectionDecision: AgentServerBackendSelectionDecision;
  explicitSignals: Record<string, boolean>;
}

export function isBlockingAgentServerConfigurationFailure(reason: string) {
  return runtimeAgentBackendConfigurationFailureIsBlocking(reason);
}

export function providerForBackend(backend: string) {
  return runtimeAgentBackendProvider(backend);
}

export function agentServerBackend(request?: GatewayRequest, llmEndpoint?: LlmEndpointConfig) {
  return agentServerBackendSelectionDecision(request, llmEndpoint).backend;
}

export function agentServerBackendSelectionDecision(
  request?: GatewayRequest,
  llmEndpoint?: LlmEndpointConfig,
): AgentServerBackendSelectionDecision {
  const requestBackend = request?.agentBackend?.trim();
  const envBackend = process.env.SCIFORGE_AGENTSERVER_BACKEND?.trim();
  const endpoint = llmEndpoint ?? request?.llmEndpoint;
  const endpointConfigured = Boolean(endpoint?.baseUrl?.trim());
  const ignoredSources: AgentServerBackendSelectionDecision['trace']['ignoredSources'] = [];
  if (runtimeAgentBackendSupported(requestBackend)) {
    return backendSelectionDecision(requestBackend, 'request.agentBackend', 'request selected a supported AgentServer backend', {
      requestBackend,
      envBackend,
      endpointConfigured,
      ignoredSources,
    });
  }
  ignoredSources.push(`request.agentBackend:${requestBackend ? 'unsupported' : 'missing'}`);
  if (runtimeAgentBackendSupported(envBackend)) {
    return backendSelectionDecision(envBackend, 'env.SCIFORGE_AGENTSERVER_BACKEND', 'environment selected a supported AgentServer backend', {
      requestBackend,
      envBackend,
      endpointConfigured,
      ignoredSources,
    });
  }
  ignoredSources.push(`env.SCIFORGE_AGENTSERVER_BACKEND:${envBackend ? 'unsupported' : 'missing'}`);
  if (endpointConfigured) {
    return backendSelectionDecision('openteam_agent', 'llmEndpoint.baseUrl', 'configured LLM endpoint routes through the OpenTeam AgentServer backend', {
      requestBackend,
      envBackend,
      endpointConfigured,
      ignoredSources,
    });
  }
  return backendSelectionDecision('codex', 'runtime.default', 'no supported backend override or LLM endpoint was configured; using default backend', {
    requestBackend,
    envBackend,
    endpointConfigured,
    ignoredSources,
  });
}

export function agentServerGenerationDispatchQuarantineDecision(
  request?: GatewayRequest,
  llmEndpoint?: LlmEndpointConfig,
  llmEndpointSource?: string,
): AgentServerGenerationDispatchQuarantineDecision {
  const uiState = isRecord(request?.uiState) ? request.uiState : {};
  const requestBackend = request?.agentBackend?.trim();
  const envBackend = process.env.SCIFORGE_AGENTSERVER_BACKEND?.trim();
	  const explicitSignals = {
	    requestBackendSupported: runtimeAgentBackendSupported(requestBackend) && requestBackend !== 'codex',
	    requestForceGeneration: uiState.forceAgentServerGeneration === true,
	    requestAgentServerBaseUrl: Boolean(request?.agentServerBaseUrl?.trim()),
	    requestLlmEndpoint: false,
	    envBackendSupported: runtimeAgentBackendSupported(envBackend),
    legacyCompatEnv: process.env.SCIFORGE_LEGACY_AGENTSERVER_DEFAULT_DISPATCH === '1',
  };
  const source = dispatchOptInSource(explicitSignals);
  const backendSelectionDecision = agentServerBackendSelectionDecision(request, llmEndpoint);
  if (source) {
    return {
      schemaVersion: 'sciforge.agentserver-generation-dispatch-quarantine.v1',
      allowed: true,
      source,
      reason: `AgentServer generation dispatch is explicitly opted in by ${source}.`,
      backendSelectionDecision,
      explicitSignals,
    };
  }
  return {
    schemaVersion: 'sciforge.agentserver-generation-dispatch-quarantine.v1',
    allowed: false,
    reason: 'AgentServer generation dispatch is quarantined: no request, environment, or legacy compatibility opt-in was present.',
    backendSelectionDecision,
    explicitSignals,
  };
}

export function agentBackendAdapter(backend: string): AgentBackendAdapter {
  const capabilities = agentBackendCapabilities(backend);
  return {
    backend,
    capabilities,
    readContextWindowState: async (sessionRef) => readBackendContextWindowState(sessionRef, backend, capabilities),
    compactContext: async (sessionRef, reason) => compactBackendContext(sessionRef, backend, capabilities, reason),
  };
}

function dispatchOptInSource(signals: AgentServerGenerationDispatchQuarantineDecision['explicitSignals']): AgentServerGenerationDispatchOptInSource | undefined {
  if (signals.requestBackendSupported) return 'request.agentBackend';
  if (signals.requestForceGeneration) return 'request.forceAgentServerGeneration';
  if (signals.requestAgentServerBaseUrl) return 'request.agentServerBaseUrl';
  if (signals.requestLlmEndpoint) return 'request.llmEndpoint';
  if (signals.envBackendSupported) return 'env.SCIFORGE_AGENTSERVER_BACKEND';
  if (signals.legacyCompatEnv) return 'env.SCIFORGE_LEGACY_AGENTSERVER_DEFAULT_DISPATCH';
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function agentBackendCapabilities(backend: string): AgentBackendCapabilities {
  return runtimeAgentBackendCapabilities(backend);
}

function backendSelectionDecision(
  backend: string,
  source: AgentServerBackendSelectionSource,
  reason: string,
  input: {
    requestBackend?: string;
    envBackend?: string;
    endpointConfigured: boolean;
    ignoredSources: AgentServerBackendSelectionDecision['trace']['ignoredSources'];
  },
): AgentServerBackendSelectionDecision {
  return {
    schemaVersion: AGENTSERVER_BACKEND_SELECTION_DECISION_SCHEMA_VERSION,
    shadowMode: true,
    decisionOwner: 'AgentServer',
    harnessStage: 'beforeAgentDispatch',
    decision: backend,
    backend,
    provider: providerForBackend(backend),
    source,
    reason,
    runtimeSignals: {
      requestBackendPresent: Boolean(input.requestBackend),
      requestBackendSupported: runtimeAgentBackendSupported(input.requestBackend),
      envBackendPresent: Boolean(input.envBackend),
      envBackendSupported: runtimeAgentBackendSupported(input.envBackend),
      llmEndpointConfigured: input.endpointConfigured,
      fallbackBackend: 'codex',
    },
    trace: {
      selectionOrder: ['request.agentBackend', 'env.SCIFORGE_AGENTSERVER_BACKEND', 'llmEndpoint.baseUrl', 'runtime.default'],
      ignoredSources: input.ignoredSources,
    },
  };
}
