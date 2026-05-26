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
} from './agentserver-context-window.js';

export const AGENTSERVER_BACKEND_SELECTION_DECISION_SCHEMA_VERSION = 'sciforge.agentserver-backend-selection-decision.v1' as const;
export const DEFAULT_AGENTSERVER_BASE_URL = DEFAULT_AGENT_SERVER_URL;
export const AGENTSERVER_BASE_URL_ENV_KEYS = [
  'SCIFORGE_AGENTSERVER_BASE_URL',
  'SCIFORGE_AGENT_SERVER_URL',
  'SCIFORGE_AGENT_SERVER_BASE_URL',
  'SCIFORGE_AGENT_SERVER_BASEURL',
] as const;
export const AGENTSERVER_ALLOW_DEFAULT_LLM_ENV = 'SCIFORGE_ALLOW_AGENTSERVER_DEFAULT_LLM' as const;

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

export type AgentServerBaseUrlEnvKey = typeof AGENTSERVER_BASE_URL_ENV_KEYS[number];
export type AgentServerBaseUrlSelectionSource =
  | 'request.agentServerBaseUrl'
  | `env.${AgentServerBaseUrlEnvKey}`
  | 'workspace-config.agentServerBaseUrl'
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

export interface AgentServerGenerationDispatchQuarantineDecision {
  schemaVersion: 'sciforge.agentserver-generation-dispatch-quarantine.v1';
  allowed: boolean;
  source?: AgentServerGenerationDispatchOptInSource;
  reason: string;
  backendSelectionDecision: AgentServerBackendSelectionDecision;
  explicitSignals: Record<string, boolean>;
}

export interface AgentServerBaseUrlSelectionDecision {
  baseUrl?: string;
  source?: AgentServerBaseUrlSelectionSource;
  defaultBaseUrl: string;
  trace: {
    envKeys: AgentServerBaseUrlEnvKey[];
    includeRuntimeDefault: boolean;
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

export function normalizeAgentServerBaseUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? cleanUrl(trimmed) : undefined;
}

export function agentServerBaseUrlSelectionDecision(
  input: {
    request?: Pick<GatewayRequest, 'agentServerBaseUrl'>;
    workspaceConfigBaseUrl?: string;
  } = {},
  options: { includeRuntimeDefault?: boolean } = {},
): AgentServerBaseUrlSelectionDecision {
  const ignoredSources: string[] = [];
  const requestBaseUrl = normalizeAgentServerBaseUrl(input.request?.agentServerBaseUrl);
  if (requestBaseUrl) {
    return baseUrlSelectionDecision(requestBaseUrl, 'request.agentServerBaseUrl', options, ignoredSources);
  }
  ignoredSources.push(`request.agentServerBaseUrl:${input.request?.agentServerBaseUrl ? 'invalid' : 'missing'}`);

  const envBaseUrl = configuredAgentServerEnvBaseUrl();
  if (envBaseUrl) {
    return baseUrlSelectionDecision(envBaseUrl.baseUrl, `env.${envBaseUrl.key}`, options, ignoredSources);
  }
  ignoredSources.push('env.agentServerBaseUrl:missing');

  const workspaceConfigBaseUrl = normalizeAgentServerBaseUrl(input.workspaceConfigBaseUrl);
  if (workspaceConfigBaseUrl) {
    return baseUrlSelectionDecision(workspaceConfigBaseUrl, 'workspace-config.agentServerBaseUrl', options, ignoredSources);
  }
  ignoredSources.push(`workspace-config.agentServerBaseUrl:${input.workspaceConfigBaseUrl ? 'invalid' : 'missing'}`);

  if (options.includeRuntimeDefault === true) {
    return baseUrlSelectionDecision(DEFAULT_AGENTSERVER_BASE_URL, 'runtime.default', options, ignoredSources);
  }
  return baseUrlSelectionDecision(undefined, undefined, options, ignoredSources);
}

export function configuredAgentServerBaseUrl(input: {
  request?: Pick<GatewayRequest, 'agentServerBaseUrl'>;
  workspaceConfigBaseUrl?: string;
} = {}) {
  return agentServerBaseUrlSelectionDecision(input).baseUrl;
}

export function effectiveAgentServerBaseUrl(input: {
  request?: Pick<GatewayRequest, 'agentServerBaseUrl'>;
  workspaceConfigBaseUrl?: string;
} = {}) {
  return agentServerBaseUrlSelectionDecision(input, { includeRuntimeDefault: true }).baseUrl ?? DEFAULT_AGENTSERVER_BASE_URL;
}

export function requiresUserLlmEndpointForAgentServerBaseUrl(
  agentServerBaseUrl: string,
  request?: Pick<GatewayRequest, 'agentServerBaseUrl'>,
) {
  if (process.env[AGENTSERVER_ALLOW_DEFAULT_LLM_ENV] === '1') return false;
  if (!isLoopbackAgentServerBaseUrl(agentServerBaseUrl)) return false;
  const target = canonicalAgentServerBaseUrlKey(agentServerBaseUrl);
  if (!target) return false;
  return target === canonicalAgentServerBaseUrlKey(effectiveAgentServerBaseUrl({ request }));
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

function configuredAgentServerEnvBaseUrl(): { key: AgentServerBaseUrlEnvKey; baseUrl: string } | undefined {
  for (const key of AGENTSERVER_BASE_URL_ENV_KEYS) {
    const baseUrl = normalizeAgentServerBaseUrl(process.env[key]);
    if (baseUrl) return { key, baseUrl };
  }
  return undefined;
}

function baseUrlSelectionDecision(
  baseUrl: string | undefined,
  source: AgentServerBaseUrlSelectionSource | undefined,
  options: { includeRuntimeDefault?: boolean },
  ignoredSources: string[],
): AgentServerBaseUrlSelectionDecision {
  return {
    baseUrl,
    source,
    defaultBaseUrl: DEFAULT_AGENTSERVER_BASE_URL,
    trace: {
      envKeys: [...AGENTSERVER_BASE_URL_ENV_KEYS],
      includeRuntimeDefault: options.includeRuntimeDefault === true,
      ignoredSources,
    },
  };
}

function isLoopbackAgentServerBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function canonicalAgentServerBaseUrlKey(value: string | undefined) {
  const normalized = normalizeAgentServerBaseUrl(value);
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
