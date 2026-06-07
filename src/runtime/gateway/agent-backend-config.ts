import type { AgentBackendAdapter, AgentBackendCapabilities, GatewayRequest, LlmEndpointConfig } from '../runtime-types.js';
import { DEFAULT_AGENT_SERVER_URL } from '@sciforge-ui/runtime-contract/handoff';
import {
  runtimeAgentBackendCapabilities,
  runtimeAgentBackendConfigurationFailureIsBlocking,
  runtimeAgentBackendProvider,
  runtimeAgentBackendSupported,
} from '@sciforge-ui/runtime-contract/agent-backend-policy';
import { cleanUrl } from '../gateway-utils.js';
import {
  compactBackendContext,
  readBackendContextWindowState,
} from './backend-context-window.js';

export const BACKEND_SELECTION_DECISION_SCHEMA_VERSION = 'sciforge.backend-selection-decision.v1' as const;
export const DEFAULT_BACKEND_BASE_URL = DEFAULT_AGENT_SERVER_URL;
export const BACKEND_BASE_URL_ENV_KEYS = [
  'SCIFORGE_AGENTSERVER_BASE_URL',
  'SCIFORGE_AGENT_SERVER_URL',
  'SCIFORGE_AGENT_SERVER_BASE_URL',
  'SCIFORGE_AGENT_SERVER_BASEURL',
] as const;
export const BACKEND_ALLOW_DEFAULT_LLM_ENV = 'SCIFORGE_ALLOW_AGENTSERVER_DEFAULT_LLM' as const;

export type BackendSelectionSource =
  | 'request.agentBackend'
  | 'env.SCIFORGE_AGENTSERVER_BACKEND'
  | 'llmEndpoint.baseUrl'
  | 'runtime.default';

export type BackendGenerationDispatchOptInSource =
  | 'request.agentBackend'
  | 'request.forceAgentServerGeneration'
  | 'request.agentServerBaseUrl'
  | 'request.llmEndpoint'
  | 'env.SCIFORGE_AGENTSERVER_BACKEND'
  | 'env.SCIFORGE_LEGACY_AGENTSERVER_DEFAULT_DISPATCH';

export type BackendBaseUrlEnvKey = typeof BACKEND_BASE_URL_ENV_KEYS[number];
export type BackendBaseUrlSelectionSource =
  | 'request.agentServerBaseUrl'
  | `env.${BackendBaseUrlEnvKey}`
  | 'workspace-config.agentServerBaseUrl'
  | 'runtime.default';

export interface BackendSelectionDecision {
  schemaVersion: typeof BACKEND_SELECTION_DECISION_SCHEMA_VERSION;
  shadowMode: true;
  decisionOwner: 'AgentHost';
  harnessStage: 'beforeAgentDispatch';
  decision: string;
  backend: string;
  provider?: string;
  source: BackendSelectionSource;
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
    selectionOrder: BackendSelectionSource[];
    ignoredSources: string[];
  };
}

export interface BackendGenerationDispatchQuarantineDecision {
  schemaVersion: 'sciforge.backend-generation-dispatch-quarantine.v1';
  allowed: boolean;
  source?: BackendGenerationDispatchOptInSource;
  reason: string;
  backendSelectionDecision: BackendSelectionDecision;
  explicitSignals: Record<string, boolean>;
}

export interface BackendBaseUrlSelectionDecision {
  baseUrl?: string;
  source?: BackendBaseUrlSelectionSource;
  defaultBaseUrl: string;
  trace: {
    envKeys: BackendBaseUrlEnvKey[];
    includeRuntimeDefault: boolean;
    ignoredSources: string[];
  };
}

export function isBlockingBackendConfigurationFailure(reason: string) {
  return runtimeAgentBackendConfigurationFailureIsBlocking(reason);
}

export function providerForBackend(backend: string) {
  return runtimeAgentBackendProvider(backend);
}

export function selectedAgentBackend(request?: GatewayRequest, llmEndpoint?: LlmEndpointConfig) {
  return backendSelectionDecisionForRequest(request, llmEndpoint).backend;
}

export function normalizeBackendBaseUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? cleanUrl(trimmed) : undefined;
}

export function backendBaseUrlSelectionDecision(
  input: {
    request?: Pick<GatewayRequest, 'agentServerBaseUrl'>;
    workspaceConfigBaseUrl?: string;
  } = {},
  options: { includeRuntimeDefault?: boolean } = {},
): BackendBaseUrlSelectionDecision {
  const ignoredSources: string[] = [];
  const requestBaseUrl = normalizeBackendBaseUrl(input.request?.agentServerBaseUrl);
  if (requestBaseUrl) {
    return baseUrlSelectionDecision(requestBaseUrl, 'request.agentServerBaseUrl', options, ignoredSources);
  }
  ignoredSources.push(`request.agentServerBaseUrl:${input.request?.agentServerBaseUrl ? 'invalid' : 'missing'}`);

  const envBaseUrl = configuredBackendEnvBaseUrl();
  if (envBaseUrl) {
    return baseUrlSelectionDecision(envBaseUrl.baseUrl, `env.${envBaseUrl.key}`, options, ignoredSources);
  }
  ignoredSources.push('env.agentServerBaseUrl:missing');

  const workspaceConfigBaseUrl = normalizeBackendBaseUrl(input.workspaceConfigBaseUrl);
  if (workspaceConfigBaseUrl) {
    return baseUrlSelectionDecision(workspaceConfigBaseUrl, 'workspace-config.agentServerBaseUrl', options, ignoredSources);
  }
  ignoredSources.push(`workspace-config.agentServerBaseUrl:${input.workspaceConfigBaseUrl ? 'invalid' : 'missing'}`);

  if (options.includeRuntimeDefault === true) {
    return baseUrlSelectionDecision(DEFAULT_BACKEND_BASE_URL, 'runtime.default', options, ignoredSources);
  }
  return baseUrlSelectionDecision(undefined, undefined, options, ignoredSources);
}

export function configuredBackendBaseUrl(input: {
  request?: Pick<GatewayRequest, 'agentServerBaseUrl'>;
  workspaceConfigBaseUrl?: string;
} = {}) {
  return backendBaseUrlSelectionDecision(input).baseUrl;
}

export function effectiveBackendBaseUrl(input: {
  request?: Pick<GatewayRequest, 'agentServerBaseUrl'>;
  workspaceConfigBaseUrl?: string;
} = {}) {
  return backendBaseUrlSelectionDecision(input, { includeRuntimeDefault: true }).baseUrl ?? DEFAULT_BACKEND_BASE_URL;
}

export function requiresUserLlmEndpointForBackendBaseUrl(
  agentServerBaseUrl: string,
  request?: Pick<GatewayRequest, 'agentServerBaseUrl'>,
) {
  if (process.env[BACKEND_ALLOW_DEFAULT_LLM_ENV] === '1') return false;
  if (!isLoopbackBackendBaseUrl(agentServerBaseUrl)) return false;
  const target = canonicalBackendBaseUrlKey(agentServerBaseUrl);
  if (!target) return false;
  return target === canonicalBackendBaseUrlKey(effectiveBackendBaseUrl({ request }));
}

export function backendSelectionDecisionForRequest(
  request?: GatewayRequest,
  llmEndpoint?: LlmEndpointConfig,
): BackendSelectionDecision {
  const requestBackend = request?.agentBackend?.trim();
  const envBackend = process.env.SCIFORGE_AGENTSERVER_BACKEND?.trim();
  const endpoint = llmEndpoint ?? request?.llmEndpoint;
  const endpointConfigured = Boolean(endpoint?.baseUrl?.trim());
  const ignoredSources: BackendSelectionDecision['trace']['ignoredSources'] = [];
  if (runtimeAgentBackendSupported(requestBackend)) {
    return backendSelectionDecision(requestBackend, 'request.agentBackend', 'request selected a supported agent backend', {
      requestBackend,
      envBackend,
      endpointConfigured,
      ignoredSources,
    });
  }
  ignoredSources.push(`request.agentBackend:${requestBackend ? 'unsupported' : 'missing'}`);
  if (runtimeAgentBackendSupported(envBackend)) {
    return backendSelectionDecision(envBackend, 'env.SCIFORGE_AGENTSERVER_BACKEND', 'environment selected a supported agent backend', {
      requestBackend,
      envBackend,
      endpointConfigured,
      ignoredSources,
    });
  }
  ignoredSources.push(`env.SCIFORGE_AGENTSERVER_BACKEND:${envBackend ? 'unsupported' : 'missing'}`);
  if (endpointConfigured) {
    return backendSelectionDecision('openteam_agent', 'llmEndpoint.baseUrl', 'configured LLM endpoint routes through the OpenTeam agent backend', {
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

export function backendGenerationDispatchQuarantineDecision(
  request?: GatewayRequest,
  llmEndpoint?: LlmEndpointConfig,
  llmEndpointSource?: string,
): BackendGenerationDispatchQuarantineDecision {
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
  const backendSelectionDecision = backendSelectionDecisionForRequest(request, llmEndpoint);
  if (source) {
    return {
      schemaVersion: 'sciforge.backend-generation-dispatch-quarantine.v1',
      allowed: true,
      source,
      reason: `Backend generation dispatch is explicitly opted in by ${source}.`,
      backendSelectionDecision,
      explicitSignals,
    };
  }
  return {
    schemaVersion: 'sciforge.backend-generation-dispatch-quarantine.v1',
    allowed: false,
    reason: 'Backend generation dispatch is quarantined: no request, environment, or legacy compatibility opt-in was present.',
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

function dispatchOptInSource(signals: BackendGenerationDispatchQuarantineDecision['explicitSignals']): BackendGenerationDispatchOptInSource | undefined {
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
  source: BackendSelectionSource,
  reason: string,
  input: {
    requestBackend?: string;
    envBackend?: string;
    endpointConfigured: boolean;
    ignoredSources: BackendSelectionDecision['trace']['ignoredSources'];
  },
): BackendSelectionDecision {
  return {
    schemaVersion: BACKEND_SELECTION_DECISION_SCHEMA_VERSION,
    shadowMode: true,
    decisionOwner: 'AgentHost',
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

function configuredBackendEnvBaseUrl(): { key: BackendBaseUrlEnvKey; baseUrl: string } | undefined {
  for (const key of BACKEND_BASE_URL_ENV_KEYS) {
    const baseUrl = normalizeBackendBaseUrl(process.env[key]);
    if (baseUrl) return { key, baseUrl };
  }
  return undefined;
}

function baseUrlSelectionDecision(
  baseUrl: string | undefined,
  source: BackendBaseUrlSelectionSource | undefined,
  options: { includeRuntimeDefault?: boolean },
  ignoredSources: string[],
): BackendBaseUrlSelectionDecision {
  return {
    baseUrl,
    source,
    defaultBaseUrl: DEFAULT_BACKEND_BASE_URL,
    trace: {
      envKeys: [...BACKEND_BASE_URL_ENV_KEYS],
      includeRuntimeDefault: options.includeRuntimeDefault === true,
      ignoredSources,
    },
  };
}

function isLoopbackBackendBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function canonicalBackendBaseUrlKey(value: string | undefined) {
  const normalized = normalizeBackendBaseUrl(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    const protocol = url.protocol.toLowerCase();
    const hostname = isLoopbackHostname(url.hostname) ? 'localhost' : url.hostname.toLowerCase();
    const port = url.port || defaultPortForProtocol(protocol);
    const pathname = cleanUrl(url.pathname === '/' ? '' : url.pathname);
    return `${protocol}//${hostname}${port ? `:${port}` : ''}${pathname}${url.search}`;
  } catch {
    return normalized.toLowerCase();
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function defaultPortForProtocol(protocol: string) {
  if (protocol === 'http:') return '80';
  if (protocol === 'https:') return '443';
  return '';
}
