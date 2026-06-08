import type { RuntimeLlmEndpointConfig } from './agent-backend-policy';

export interface ConfiguredBackendLlmEndpoint {
  modelProvider?: string;
  modelName?: string;
  llmEndpoint?: RuntimeLlmEndpointConfig;
  llmEndpointSource?: string;
}

const CURRENT_USER_REQUEST_MARKER = 'Current user request:';

export function extractBackendCurrentUserRequest(prompt: string) {
  const index = prompt.lastIndexOf(CURRENT_USER_REQUEST_MARKER);
  return index >= 0
    ? prompt.slice(index + CURRENT_USER_REQUEST_MARKER.length).trim()
    : prompt.trim();
}

export function normalizeConfiguredBackendLlmEndpoint(
  value: unknown,
  source: string,
): ConfiguredBackendLlmEndpoint | undefined {
  void value;
  void source;
  return undefined;
}
