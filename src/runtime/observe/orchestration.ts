import {
  buildObserveProviderUnavailableRecord,
  normalizeObserveInvocationDiagnostics,
} from '@sciforge-ui/runtime-contract/observe';
import type {
  ObserveFailureMode,
  ObserveIntent,
  ObserveInvocation,
  ObserveInvocationPlan,
  ObserveInvocationRecord,
  ObserveModalityRef,
  ObserveProviderContract,
  ObserveResponse,
} from '@sciforge-ui/runtime-contract/observe';
import { createValidationRepairAuditChain } from '../gateway/validation-repair-audit-bridge.js';
import {
  writeValidationRepairAuditSinkObserveInvocationRecords,
  type ValidationRepairAuditObserveInvocationWriteResult,
} from '../gateway/validation-repair-audit-sink.js';

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

export interface ObserveInvocationAuditSinkOptions {
  workspacePath: string;
  invocationDir?: string;
  now?: () => Date;
}

export interface RunObserveInvocationPlanOptions {
  validationRepairAuditSink?: ObserveInvocationAuditSinkOptions;
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
  options: RunObserveInvocationPlanOptions = {},
): Promise<ObserveInvocationRecord[]> {
  const registry = new Map(providers.map((provider) => [provider.contract.id, provider]));
  const records: ObserveInvocationRecord[] = [];
  for (const invocation of plan.invocations) {
    const provider = registry.get(invocation.providerId);
    if (!provider) {
      const record = buildObserveProviderUnavailableRecord(invocation);
      records.push(record);
      await writeObserveInvocationAuditSinkRecord(record, plan, options.validationRepairAuditSink);
      continue;
    }
    const result = await provider.invoke(invocation);
    const record: ObserveInvocationRecord = {
      ...invocation,
      status: result.status ?? 'ok',
      text: result.text,
      artifactRefs: result.artifactRefs ?? [],
      traceRef: result.traceRef,
      compactSummary: result.compactSummary,
      diagnostics: normalizeObserveInvocationDiagnostics(result.diagnostics),
    };
    records.push(record);
    await writeObserveInvocationAuditSinkRecord(record, plan, options.validationRepairAuditSink);
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

async function writeObserveInvocationAuditSinkRecord(
  record: ObserveInvocationRecord,
  plan: ObserveInvocationPlan,
  options: ObserveInvocationAuditSinkOptions | undefined,
): Promise<ValidationRepairAuditObserveInvocationWriteResult[] | undefined> {
  if (!options || record.status !== 'failed') return undefined;
  const createdAt = options.now?.().toISOString();
  const response = observeResponseFromInvocationRecord(record);
  const relatedRefs = observeInvocationRelatedRefs(record, plan);
  const chain = createValidationRepairAuditChain({
    chainId: `observe-invocation:${safeObserveInvocationChainId(record.callRef)}`,
    subject: {
      kind: 'observe-result',
      id: record.callRef,
      capabilityId: record.providerId,
      contractId: 'sciforge.observe-response.v1',
      observeTraceRef: record.traceRef,
      artifactRefs: record.artifactRefs,
      currentRefs: record.modalities.map((modality) => modality.ref),
    },
    observeResponse: response,
    relatedRefs,
    sinkRefs: [`observe-invocation:${record.callRef}`],
    telemetrySpanRefs: [`observe-invocation:${record.callRef}:validation-repair-telemetry`],
    repairBudget: {
      maxAttempts: 1,
      remainingAttempts: 1,
      maxSupplementAttempts: 0,
      remainingSupplementAttempts: 0,
    },
    createdAt,
  });
  return writeValidationRepairAuditSinkObserveInvocationRecords(chain, {
    workspacePath: options.workspacePath,
    invocationDir: options.invocationDir,
    now: options.now,
    observeInvocationRecords: [record],
  });
}

function observeResponseFromInvocationRecord(record: ObserveInvocationRecord): ObserveResponse {
  const failureMode = record.diagnostics?.failureMode as ObserveFailureMode | undefined;
  return {
    schemaVersion: 1,
    providerId: record.providerId,
    status: record.status,
    textResponse: record.text ?? record.compactSummary ?? '',
    failureMode,
    artifactRefs: record.artifactRefs,
    traceRef: record.traceRef,
    diagnostics: observeInvocationDiagnosticMessages(record),
  };
}

function observeInvocationDiagnosticMessages(record: ObserveInvocationRecord) {
  return uniqueStrings([
    record.diagnostics?.message,
    record.diagnostics?.code,
    record.diagnostics?.failureMode,
    record.compactSummary,
  ]);
}

function observeInvocationRelatedRefs(record: ObserveInvocationRecord, plan: ObserveInvocationPlan) {
  return uniqueStrings([
    plan.runRef,
    record.callRef,
    record.traceRef,
    ...record.artifactRefs,
    ...record.modalities.map((modality) => modality.ref),
  ]);
}

function safeObserveInvocationChainId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'observe';
}

function supportsModalities(provider: ObserveProviderContract, modalities: ObserveModalityRef[]) {
  return modalities.every((modality) => provider.acceptedModalities.includes(modality.kind));
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
