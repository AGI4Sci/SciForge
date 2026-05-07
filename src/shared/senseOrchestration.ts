export type SenseModalityKind = 'text' | 'image' | 'screenshot' | 'audio' | 'video' | 'file' | string;

export interface SenseModalityRef {
  kind: SenseModalityKind;
  ref: string;
  mimeType?: string;
  summary?: string;
}

export interface SenseProviderContract {
  id: string;
  displayName?: string;
  acceptedModalities: SenseModalityKind[];
  outputKind: 'text';
  expectedMultipleCalls?: boolean;
  costClass?: 'low' | 'medium' | 'high';
  latencyClass?: 'low' | 'medium' | 'high';
}

export interface SenseObservationIntent {
  instruction: string;
  modalities: SenseModalityRef[];
  providerId?: string;
  reason?: string;
}

export interface SenseInvocation {
  callRef: string;
  providerId: string;
  instruction: string;
  modalities: SenseModalityRef[];
  reason?: string;
}

export interface SenseInvocationRecord extends SenseInvocation {
  status: 'ok' | 'failed';
  text?: string;
  artifactRefs: string[];
  traceRef?: string;
  compactSummary: string;
  diagnostics?: Record<string, unknown>;
}

export interface SenseInvocationPlan {
  goal: string;
  runRef: string;
  invocations: SenseInvocation[];
}

export interface SenseProviderRuntime {
  contract: SenseProviderContract;
  invoke(input: SenseInvocation): Promise<Omit<SenseInvocationRecord, keyof SenseInvocation | 'status'> & { status?: SenseInvocationRecord['status'] }>;
}

export function buildSenseInvocationPlan(params: {
  goal: string;
  runRef: string;
  intents: SenseObservationIntent[];
  providers: SenseProviderContract[];
}): SenseInvocationPlan {
  const invocations = params.intents.map((intent, index) => {
    const provider = selectSenseProvider(intent, params.providers);
    return {
      callRef: `${params.runRef}:sense:${String(index + 1).padStart(3, '0')}`,
      providerId: provider.id,
      instruction: intent.instruction,
      modalities: intent.modalities,
      reason: intent.reason,
    };
  });
  return { goal: params.goal, runRef: params.runRef, invocations };
}

export async function runSenseInvocationPlan(
  plan: SenseInvocationPlan,
  providers: SenseProviderRuntime[],
): Promise<SenseInvocationRecord[]> {
  const registry = new Map(providers.map((provider) => [provider.contract.id, provider]));
  const records: SenseInvocationRecord[] = [];
  for (const invocation of plan.invocations) {
    const provider = registry.get(invocation.providerId);
    if (!provider) {
      records.push({
        ...invocation,
        status: 'failed',
        artifactRefs: [],
        compactSummary: `Sense provider ${invocation.providerId} is unavailable.`,
        diagnostics: { code: 'sense-provider-unavailable' },
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

export function compactSenseTraceRefs(records: SenseInvocationRecord[]) {
  return records.map((record) => ({
    callRef: record.callRef,
    providerId: record.providerId,
    status: record.status,
    traceRef: record.traceRef,
    artifactRefs: record.artifactRefs,
    compactSummary: record.compactSummary,
  }));
}

function selectSenseProvider(intent: SenseObservationIntent, providers: SenseProviderContract[]) {
  const candidates = intent.providerId
    ? providers.filter((provider) => provider.id === intent.providerId)
    : providers;
  const provider = candidates.find((candidate) => supportsModalities(candidate, intent.modalities));
  if (!provider) {
    const requested = intent.modalities.map((modality) => modality.kind).join(', ') || 'none';
    throw new Error(`No sense provider can satisfy modalities: ${requested}`);
  }
  return provider;
}

function supportsModalities(provider: SenseProviderContract, modalities: SenseModalityRef[]) {
  return modalities.every((modality) => provider.acceptedModalities.includes(modality.kind));
}
