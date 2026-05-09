import type { AgentBackendAdapter, AgentBackendCapabilities, GatewayRequest, LlmEndpointConfig } from '../runtime-types.js';
import {
  compactBackendContext,
  readBackendContextWindowState,
} from './agentserver-context-window.js';

const SUPPORTED_AGENT_BACKENDS = ['openteam_agent', 'claude-code', 'codex', 'hermes-agent', 'openclaw', 'gemini'];

export function isBlockingAgentServerConfigurationFailure(reason: string) {
  return /User-side model configuration|llmEndpoint|openteam\.json defaults|Model Provider|Model Base URL|Model Name/i.test(reason);
}

export function providerForBackend(backend: string) {
  if (backend === 'openteam_agent') return 'self-hosted';
  if (backend === 'hermes-agent') return 'hermes';
  return backend || undefined;
}

export function agentServerBackend(request?: GatewayRequest, llmEndpoint?: LlmEndpointConfig) {
  const requestBackend = request?.agentBackend?.trim();
  if (requestBackend && SUPPORTED_AGENT_BACKENDS.includes(requestBackend)) {
    return requestBackend;
  }
  const requested = process.env.SCIFORGE_AGENTSERVER_BACKEND?.trim();
  if (requested && SUPPORTED_AGENT_BACKENDS.includes(requested)) {
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
  if (backend === 'codex') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: true,
      compactionDuringTurn: true,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'hermes-agent') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: true,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'gemini') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: false,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'openteam_agent') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: false,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'claude-code') {
    return {
      contextWindowTelemetry: false,
      nativeCompaction: false,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  return {
    contextWindowTelemetry: false,
    nativeCompaction: false,
    compactionDuringTurn: false,
    rateLimitTelemetry: false,
    sessionRotationSafe: true,
  };
}
