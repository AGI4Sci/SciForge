import type { RuntimeVerificationPolicy } from '@sciforge-ui/runtime-contract/verification-policy';
import type { RuntimeVerificationResult } from '@sciforge-ui/runtime-contract/verification-result';
import {
  scientificReproductionRuntimeVerifier,
  type PackageRuntimeVerifierAdapter,
} from '../../../packages/verifiers/scientific-reproduction/runtime-adapter.js';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { toStringList, uniqueStrings } from '../gateway-utils.js';

const packageRuntimeVerifiers: PackageRuntimeVerifierAdapter[] = [
  scientificReproductionRuntimeVerifier,
];

export interface RuntimeVerifierRegistryInput {
  payload: ToolPayload;
  request: GatewayRequest;
  policy: RuntimeVerificationPolicy;
  providedResults?: RuntimeVerificationResult[];
}

export async function runSelectedRuntimeVerifiers(input: RuntimeVerifierRegistryInput): Promise<RuntimeVerificationResult[]> {
  const selectedIds = selectedRuntimeVerifierIds(input);
  if (!selectedIds.length) return [];
  const alreadyProvided = new Set(
    (input.providedResults ?? [])
      .map((result) => result.id)
      .filter((id): id is string => Boolean(id)),
  );
  const results: RuntimeVerificationResult[] = [];
  for (const verifier of packageRuntimeVerifiers) {
    if (!verifier.acceptedVerifierIds.some((id) => selectedIds.includes(id))) continue;
    if (alreadyProvided.has(verifier.id)) continue;
    const verifierResults = await verifier.verify({
      goal: input.request.prompt,
      request: input.request,
      payload: input.payload,
      policy: input.policy,
    });
    results.push(...verifierResults);
  }
  return results;
}

function selectedRuntimeVerifierIds(input: RuntimeVerifierRegistryInput) {
  return uniqueStrings([
    ...(input.policy.selectedVerifierIds ?? []),
    ...(input.request.selectedVerifierIds ?? []),
    ...toStringList(input.request.uiState?.selectedVerifierIds),
  ]);
}
