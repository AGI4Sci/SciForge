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

export function isBlockingAgentServerConfigurationFailure(reason: string) {
  return runtimeAgentBackendConfigurationFailureIsBlocking(reason);
}

export function providerForBackend(backend: string) {
  return runtimeAgentBackendProvider(backend);
}

export function agentServerBackend(request?: GatewayRequest, llmEndpoint?: LlmEndpointConfig) {
  const requestBackend = request?.agentBackend?.trim();
  if (runtimeAgentBackendSupported(requestBackend)) {
    return requestBackend;
  }
  const requested = process.env.SCIFORGE_AGENTSERVER_BACKEND?.trim();
  if (runtimeAgentBackendSupported(requested)) {
    return requested;
  }
  const endpoint = llmEndpoint ?? request?.llmEndpoint;
  if (endpoint?.baseUrl?.trim()) return 'openteam_agent';
  return 'codex';
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
