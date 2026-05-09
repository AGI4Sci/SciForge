import type {
  ObserveIntent,
  ObserveInvocation,
  ObserveInvocationPlan,
  ObserveInvocationRecord,
  ObserveModalityRef,
  ObserveProviderContract,
} from '@sciforge-ui/runtime-contract/observe';

export type {
  ObserveIntent,
  ObserveInvocation,
  ObserveInvocationPlan,
  ObserveInvocationRecord,
  ObserveModalityKind,
  ObserveModalityRef,
  ObserveProviderContract,
} from '@sciforge-ui/runtime-contract/observe';

export interface ObserveProviderRuntime {
  contract: ObserveProviderContract;
  invoke(input: ObserveInvocation): Promise<Omit<ObserveInvocationRecord, keyof ObserveInvocation | 'status'> & { status?: ObserveInvocationRecord['status'] }>;
}

export function buildObserveInvocationPlan(params: {
  goal: string;
  runRef: string;
  intents: ObserveIntent[];
  providers: ObserveProviderContract[];
}): ObserveInvocationPlan {
  const invocations = params.intents.map((intent, index) => {
    const provider = selectObserveProvider(intent, params.providers);
    return {
      callRef: `${params.runRef}:observe:${String(index + 1).padStart(3, '0')}`,
      providerId: provider.id,
      instruction: intent.instruction,
      modalities: intent.modalities,
      reason: intent.reason,
    };
  });
  return { goal: params.goal, runRef: params.runRef, invocations };
}

export async function runObserveInvocationPlan(
  plan: ObserveInvocationPlan,
  providers: ObserveProviderRuntime[],
): Promise<ObserveInvocationRecord[]> {
  const registry = new Map(providers.map((provider) => [provider.contract.id, provider]));
  const records: ObserveInvocationRecord[] = [];
  for (const invocation of plan.invocations) {
    const provider = registry.get(invocation.providerId);
    if (!provider) {
      records.push({
        ...invocation,
        status: 'failed',
        artifactRefs: [],
        compactSummary: `Observe provider ${invocation.providerId} is unavailable.`,
        diagnostics: { code: 'observe-provider-unavailable' },
      });
      continue;
    }
    const result = await provider.invoke(invocation);
    records.push({
      ...invocation,
      status: result.status ?? 'ok',
      text: result.text,
      artifactRefs: result.artifactRefs ?? [],
      traceRef: result.traceRef,
      compactSummary: result.compactSummary,
      diagnostics: result.diagnostics,
    });
  }
  return records;
}

export function compactObserveTraceRefs(records: ObserveInvocationRecord[]) {
  return records.map((record) => ({
    callRef: record.callRef,
    providerId: record.providerId,
    status: record.status,
    traceRef: record.traceRef,
    artifactRefs: record.artifactRefs,
    compactSummary: record.compactSummary,
  }));
}

export function selectObserveProvider(intent: ObserveIntent, providers: ObserveProviderContract[]) {
  const candidates = intent.providerId
    ? providers.filter((provider) => provider.id === intent.providerId)
    : providers;
  const provider = candidates.find((candidate) => supportsModalities(candidate, intent.modalities));
  if (!provider) {
    const requested = intent.modalities.map((modality) => modality.kind).join(', ') || 'none';
    throw new Error(`No observe provider can satisfy modalities: ${requested}`);
  }
  return provider;
}

export type SenseProviderRuntime = ObserveProviderRuntime;
export const buildSenseInvocationPlan = buildObserveInvocationPlan;
export const runSenseInvocationPlan = runObserveInvocationPlan;
export const compactSenseTraceRefs = compactObserveTraceRefs;

function supportsModalities(provider: ObserveProviderContract, modalities: ObserveModalityRef[]) {
  return modalities.every((modality) => provider.acceptedModalities.includes(modality.kind));
}
