import { normalizeRuntimeLlmEndpoint, type RuntimeLlmEndpointConfig } from './agent-backend-policy';

export interface ConfiguredAgentServerLlmEndpoint {
  modelProvider?: string;
  modelName?: string;
  llmEndpoint?: RuntimeLlmEndpointConfig;
  llmEndpointSource?: string;
}

const CURRENT_USER_REQUEST_MARKER = 'Current user request:';

export function extractAgentServerCurrentUserRequest(prompt: string) {
  const index = prompt.lastIndexOf(CURRENT_USER_REQUEST_MARKER);
  return index >= 0
    ? prompt.slice(index + CURRENT_USER_REQUEST_MARKER.length).trim()
    : prompt.trim();
}

export function normalizeConfiguredAgentServerLlmEndpoint(
  value: unknown,
  source: string,
): ConfiguredAgentServerLlmEndpoint | undefined {
  if (!isRuntimePolicyRecord(value)) return undefined;
  const llm = isRuntimePolicyRecord(value.llm) ? value.llm : value;
  const provider = trimmedPolicyString(llm.provider);
  const modelName = trimmedPolicyString(llm.modelName) ?? trimmedPolicyString(llm.model);
  const endpoint = normalizeRuntimeLlmEndpoint({
    provider,
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    modelName,
  });
  if (!endpoint) return undefined;
  return {
    modelProvider: provider ?? endpoint.provider,
    modelName: modelName ?? endpoint.modelName,
    llmEndpoint: endpoint,
    llmEndpointSource: source,
  };
}

function isRuntimePolicyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedPolicyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
