import {
  buildObserveProviderUnavailableRecord,
  normalizeObserveInvocationDiagnostics,
} from '@sciforge-ui/runtime-contract/observe';
import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';
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
import type { WorkEvidence } from '../gateway/work-evidence-types.js';
import { createValidationRepairAuditChain } from '../gateway/validation-repair-audit-bridge.js';
import {
  writeValidationRepairAuditSinkObserveInvocationRecords,
  type ValidationRepairAuditObserveInvocationWriteResult,
} from '../gateway/validation-repair-audit-sink.js';
import {
  writeValidationRepairTelemetrySpans,
  type ValidationRepairTelemetryAttemptRef,
  type ValidationRepairTelemetrySummary,
  type ValidationRepairTelemetryWriteResult,
} from '../gateway/validation-repair-telemetry-sink.js';
import { attachValidationRepairTelemetryWriteResult } from '../gateway/validation-repair-telemetry-runtime.js';

const OBSERVE_PROVIDER_INVOCATION_BUDGET_AUDIT_PREFIX = 'audit:observe-provider-invocation';

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

export interface ObserveInvocationTelemetrySinkOptions {
  workspacePath: string;
  telemetryPath?: string;
  now?: () => Date;
  readSummary?: boolean;
}

export interface ObserveInvocationRuntimeRecord extends ObserveInvocationRecord {
  budgetDebitRefs: string[];
  budgetDebits: CapabilityInvocationBudgetDebitRecord[];
  executionUnit: Record<string, unknown> & {
    id: string;
    tool: string;
    status: ObserveInvocationRecord['status'];
    budgetDebitRefs: string[];
  };
  workEvidence: WorkEvidence & {
    id: string;
    budgetDebitRefs: string[];
  };
  audit: {
    kind: 'capability-budget-debit-audit';
    ref: string;
    callRef: string;
    providerId: string;
    status: ObserveInvocationRecord['status'];
    budgetDebitRefs: string[];
    sinkRefs: CapabilityInvocationBudgetDebitRecord['sinkRefs'];
  };
  refs?: {
    validationRepairTelemetry?: ValidationRepairTelemetryAttemptRef[];
  };
  validationRepairTelemetrySummary?: ValidationRepairTelemetrySummary;
}

export interface RunObserveInvocationPlanOptions {
  validationRepairAuditSink?: ObserveInvocationAuditSinkOptions;
  validationRepairTelemetrySink?: ObserveInvocationTelemetrySinkOptions;
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
): Promise<ObserveInvocationRuntimeRecord[]> {
  const registry = new Map(providers.map((provider) => [provider.contract.id, provider]));
  const records: ObserveInvocationRuntimeRecord[] = [];
  for (const invocation of plan.invocations) {
    const provider = registry.get(invocation.providerId);
    if (!provider) {
      const record = withObserveInvocationBudgetDebit(buildObserveProviderUnavailableRecord(invocation), plan);
      records.push(record);
      await writeObserveInvocationAuditSinkRecord(record, plan, options.validationRepairAuditSink);
      await writeObserveInvocationTelemetrySinkRecord(record, plan, options.validationRepairTelemetrySink);
      continue;
    }
    const result = await provider.invoke(invocation);
    const record = withObserveInvocationBudgetDebit({
      ...invocation,
      status: result.status ?? 'ok',
      text: result.text,
      artifactRefs: result.artifactRefs ?? [],
      traceRef: result.traceRef,
      compactSummary: result.compactSummary,
      diagnostics: normalizeObserveInvocationDiagnostics(result.diagnostics),
    }, plan);
    records.push(record);
    await writeObserveInvocationAuditSinkRecord(record, plan, options.validationRepairAuditSink);
    await writeObserveInvocationTelemetrySinkRecord(record, plan, options.validationRepairTelemetrySink);
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
    budgetDebitRefs: observeRecordBudgetDebitRefs(record),
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
  const chain = createObserveInvocationValidationRepairAuditChain(record, plan, options.now);
  return writeValidationRepairAuditSinkObserveInvocationRecords(chain, {
    workspacePath: options.workspacePath,
    invocationDir: options.invocationDir,
    now: options.now,
    observeInvocationRecords: [record],
  });
}

async function writeObserveInvocationTelemetrySinkRecord(
  record: ObserveInvocationRuntimeRecord,
  plan: ObserveInvocationPlan,
  options: ObserveInvocationTelemetrySinkOptions | undefined,
): Promise<ValidationRepairTelemetryWriteResult | undefined> {
  if (!options) return undefined;
  try {
    const chain = createObserveInvocationValidationRepairAuditChain(record, plan, options.now);
    const writeResult = await writeValidationRepairTelemetrySpans(chain, {
      workspacePath: options.workspacePath,
      telemetryPath: options.telemetryPath,
      now: options.now,
    }, {
      spanKinds: ['observe-invocation'],
    });
    if (!writeResult.records.length) return writeResult;
    Object.assign(record, await attachValidationRepairTelemetryWriteResult(record, writeResult, {
      workspacePath: options.workspacePath,
      telemetryPath: options.telemetryPath,
      now: options.now,
      readSummary: options.readSummary,
    }));
    return writeResult;
  } catch {
    return undefined;
  }
}

function createObserveInvocationValidationRepairAuditChain(
  record: ObserveInvocationRecord,
  plan: ObserveInvocationPlan,
  now: (() => Date) | undefined,
) {
  const createdAt = now?.().toISOString();
  const response = observeResponseFromInvocationRecord(record);
  const relatedRefs = observeInvocationRelatedRefs(record, plan);
  return createValidationRepairAuditChain({
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
      remainingAttempts: record.status === 'failed' ? 1 : 0,
      maxSupplementAttempts: 0,
      remainingSupplementAttempts: 0,
    },
    createdAt,
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

function withObserveInvocationBudgetDebit(
  record: ObserveInvocationRecord,
  plan: ObserveInvocationPlan,
): ObserveInvocationRuntimeRecord {
  const safeCallRef = safeObserveInvocationChainId(record.callRef);
  const executionUnitRef = `executionUnit:observe:${safeCallRef}`;
  const workEvidenceRef = `workEvidence:observe:${safeCallRef}`;
  const auditRef = `${OBSERVE_PROVIDER_INVOCATION_BUDGET_AUDIT_PREFIX}:${safeCallRef}`;
  const budgetDebitRecord = createObserveInvocationBudgetDebitRecord({
    record,
    plan,
    executionUnitRef,
    workEvidenceRef,
    auditRef,
  });
  const budgetDebitRefs = [budgetDebitRecord.debitId];
  const executionUnit = {
    id: executionUnitRef,
    tool: record.providerId,
    status: record.status,
    params: JSON.stringify({
      callRef: record.callRef,
      instruction: record.instruction,
      modalityRefs: record.modalities.map((modality) => modality.ref),
    }),
    inputData: record.modalities.map((modality) => modality.ref),
    outputArtifacts: record.artifactRefs,
    artifacts: record.artifactRefs,
    outputRef: record.traceRef,
    failureReason: record.status === 'failed' ? record.compactSummary : undefined,
    budgetDebitRefs,
  };
  const workEvidence = {
    id: workEvidenceRef,
    kind: 'observe',
    status: record.status === 'ok' ? 'success' : 'failed-with-reason',
    provider: record.providerId,
    input: {
      callRef: record.callRef,
      instruction: record.instruction,
      modalities: record.modalities,
      reason: record.reason,
    },
    resultCount: record.artifactRefs.length,
    outputSummary: record.compactSummary,
    evidenceRefs: uniqueStrings([record.traceRef, ...record.artifactRefs, ...record.modalities.map((modality) => modality.ref)]),
    failureReason: record.status === 'failed' ? record.compactSummary : undefined,
    recoverActions: record.status === 'failed' ? ['rerun with an available observe provider or compatible modality'] : [],
    nextStep: record.status === 'failed' ? 'Select an observe provider that supports the requested modality refs.' : undefined,
    diagnostics: observeInvocationDiagnosticMessages(record),
    rawRef: record.traceRef,
    budgetDebitRefs,
  };
  const audit = {
    kind: 'capability-budget-debit-audit' as const,
    ref: auditRef,
    callRef: record.callRef,
    providerId: record.providerId,
    status: record.status,
    budgetDebitRefs,
    sinkRefs: budgetDebitRecord.sinkRefs,
  };
  return {
    ...record,
    budgetDebitRefs,
    budgetDebits: [budgetDebitRecord],
    executionUnit,
    workEvidence,
    audit,
  };
}

function createObserveInvocationBudgetDebitRecord(input: {
  record: ObserveInvocationRecord;
  plan: ObserveInvocationPlan;
  executionUnitRef: string;
  workEvidenceRef: string;
  auditRef: string;
}): CapabilityInvocationBudgetDebitRecord {
  const safeCallRef = safeObserveInvocationChainId(input.record.callRef);
  const debitLines: CapabilityBudgetDebitLine[] = [
    {
      dimension: 'observeCalls',
      amount: 1,
      reason: 'observe provider invocation consumed one observe call',
      sourceRef: input.record.callRef,
    },
    {
      dimension: 'resultItems',
      amount: input.record.artifactRefs.length,
      reason: 'observe provider emitted artifact refs',
      sourceRef: input.record.traceRef ?? input.record.callRef,
    },
  ];

  return createCapabilityBudgetDebitRecord({
    debitId: `budgetDebit:observe:${safeCallRef}`,
    invocationId: `capabilityInvocation:observe:${safeCallRef}`,
    capabilityId: input.record.providerId,
    candidateId: input.record.providerId,
    manifestRef: `capability:${input.record.providerId}`,
    subjectRefs: uniqueStrings([
      input.plan.runRef,
      input.record.callRef,
      ...(input.record.traceRef ? [input.record.traceRef] : []),
      ...input.record.modalities.map((modality) => modality.ref),
      ...input.record.artifactRefs,
    ]),
    debitLines,
    sinkRefs: {
      executionUnitRef: input.executionUnitRef,
      workEvidenceRefs: [input.workEvidenceRef],
      auditRefs: [input.auditRef, `observe-invocation:${input.record.callRef}`],
    },
    metadata: {
      goal: input.plan.goal,
      providerId: input.record.providerId,
      status: input.record.status,
      failureMode: input.record.diagnostics?.failureMode,
      modalityKinds: input.record.modalities.map((modality) => modality.kind),
      outputArtifactCount: input.record.artifactRefs.length,
    },
  });
}

function observeRecordBudgetDebitRefs(record: ObserveInvocationRecord): string[] | undefined {
  const budgetDebitRefs = (record as { budgetDebitRefs?: unknown }).budgetDebitRefs;
  return Array.isArray(budgetDebitRefs)
    ? budgetDebitRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined;
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
