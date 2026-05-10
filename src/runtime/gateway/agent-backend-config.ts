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

export function agentBackendAdapter(backend: string): AgentBackendAdapter {
  const capabilities = agentBackendCapabilities(backend);
  return {
    backend,
    capabilities,
    readContextWindowState: async (sessionRef) => readBackendContextWindowState(sessionRef, backend, capabilities),
    compactContext: async (sessionRef, reason) => compactBackendContext(sessionRef, backend, capabilities, reason),
  };
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
