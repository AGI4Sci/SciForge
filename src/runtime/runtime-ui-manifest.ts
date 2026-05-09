import { composeRuntimeUiManifestSlots } from '../../packages/presentation/interactive-views';
import { selectedComponentIdsForRequest } from './gateway/gateway-request.js';
import type { GatewayRequest } from './runtime-types.js';

export function composeRuntimeUiManifest(
  incoming: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  request: Pick<GatewayRequest, 'prompt' | 'skillDomain' | 'uiState' | 'selectedComponentIds'>,
): Array<Record<string, unknown>> {
  const override = isRecord(request.uiState?.scenarioOverride) ? request.uiState.scenarioOverride : undefined;
  return composeRuntimeUiManifestSlots(incoming, artifacts, {
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    scenarioDefaultComponents: toStringList(override?.defaultComponents),
    selectedComponentIds: selectedComponentIdsForRequest(request),
  });
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
