import type { GatewayRequest } from '../runtime-types.js';
import { clipForAgentServerJson, hashJson, isRecord, toStringList } from '../gateway-utils.js';

export type ContextEnvelopeGovernanceBudget = {
  maxPromptTokens?: number;
  maxHistoryTurns?: number;
  maxReferenceDigests?: number;
  maxFullTextRefs?: number;
};

type ContextEnvelopeGovernanceDecision = {
  id: string;
  target: string;
  reason: string;
  source: string;
  beforeCount: number;
  afterCount: number;
  omittedRefs?: string[];
  preservedRequiredRefs?: string[];
  missingRequiredRefs?: string[];
  trace?: ContextEnvelopeSlimmingTrace;
};

type ContextEnvelopeSlimmingTrace = {
  schemaVersion: 'sciforge.context-envelope.slimming-trace.v1';
  decisionRef: string;
  target: string;
  reason: string;
  source: string;
  sourceRefs: {
    contractRef?: string;
    traceRef?: string;
    budgetField?: string;
  };
  deterministic: true;
  beforeCount: number;
  afterCount: number;
  maxCount?: number;
  exceededByCount?: number;
  inputRefs: string[];
  keptRefs: string[];
  omittedRefs: string[];
  requiredRefs: string[];
  preservedRequiredRefs: string[];
  missingRequiredRefs: string[];
  decisionDigest: string;
};

type ContextEnvelopeIgnoredLegacySource = {
  source: string;
  reason: 'contract-only-context-governance';
  refCount?: number;
  budgetFields?: string[];
  keys?: string[];
};

export type ContextEnvelopeGovernance = {
  schemaVersion: 'sciforge.context-envelope.harness-governance.v1';
  source: string;
  contractRef?: string;
  traceRef?: string;
  shadowMode?: boolean;
  contextBudget: ContextEnvelopeGovernanceBudget;
  contextRefs: {
    allowed: string[];
    blocked: string[];
    required: string[];
  };
  decisions: ContextEnvelopeGovernanceDecision[];
  ignoredLegacySources?: ContextEnvelopeIgnoredLegacySource[];
};

export function contextEnvelopeGovernanceForRequest(request: GatewayRequest): ContextEnvelopeGovernance | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (!contextEnvelopeGovernanceEnabled(uiState)) return undefined;
  const source = contextEnvelopeGovernanceSource(uiState);
  const ignoredLegacySources = contextEnvelopeIgnoredLegacySources(uiState);
  const contextBudget = source ? contextEnvelopeGovernanceBudgetFromRecord(source.contract) : {};
  const contextRefs = source ? contextEnvelopeGovernanceRefsFromRecord(source.contract) : emptyContextRefs();
  if (!Object.values(contextBudget).some((value) => value !== undefined)
    && !contextRefs.allowed.length
    && !contextRefs.blocked.length
    && !contextRefs.required.length
    && !ignoredLegacySources.length) {
    return undefined;
  }
  return {
    schemaVersion: 'sciforge.context-envelope.harness-governance.v1',
    source: source?.source ?? 'contract-only:no-harness-context',
    contractRef: source ? stringField(source.contract.contractRef)
      ?? stringField(source.contract.harnessContractRef)
      ?? stringField(source.summary?.contractRef) : undefined,
    traceRef: source ? stringField(source.contract.traceRef)
      ?? stringField(source.contract.harnessTraceRef)
      ?? stringField(source.summary?.traceRef) : undefined,
    shadowMode: source ? booleanField(source.contract.shadowMode) : undefined,
    contextBudget,
    contextRefs,
    decisions: [],
    ignoredLegacySources: ignoredLegacySources.length ? ignoredLegacySources : undefined,
  };
}

export function applyContextEnvelopeRecordGovernance(
  target: string,
  records: Array<Record<string, unknown>>,
  governance: ContextEnvelopeGovernance | undefined,
  budget?: { maxCount?: number; budgetField?: keyof ContextEnvelopeGovernanceBudget },
) {
  if (!governance) return records;
  const inputRecords = annotateGovernanceRecords(records);
  const beforeRefs = inputRecords.map((entry) => entry.auditRef);
  const filteredRecords = inputRecords.filter((entry) => governanceRecordAllowed(entry.record, governance));
  const filtered = filteredRecords.map((entry) => entry.record);
  const filteredRefs = filteredRecords.map((entry) => entry.auditRef);
  if (filtered.length !== records.length) {
    governance.decisions.push({
      id: `${target}:contract-ref-filter`,
      target,
      reason: 'allowedContextRefs/blockedContextRefs',
      source: `${governance.source}.contextRefs`,
      beforeCount: records.length,
      afterCount: filtered.length,
      omittedRefs: beforeRefs.filter((ref) => !filteredRefs.includes(ref)).slice(0, 16),
    });
  }
  const maxCount = budget?.maxCount;
  if (maxCount === undefined || filtered.length <= maxCount) return filtered;
  const slimmedRecords = selectGovernanceBudgetedRecords(filteredRecords, maxCount, governance.contextRefs.required);
  const slimmed = slimmedRecords.map((entry) => entry.record);
  const keptRefs = slimmedRecords.map((entry) => entry.auditRef);
  const omittedRefs = filteredRefs.filter((ref) => !keptRefs.includes(ref)).slice(0, 16);
  const preservedRequiredRefs = slimmedRecords
    .filter((entry) => recordMatchesAnyRef(entry.record, governance.contextRefs.required))
    .map((entry) => entry.auditRef)
    .slice(0, 16);
  const missingRequiredRefs = governance.contextRefs.required
    .filter((ref) => !slimmedRecords.some((entry) => governanceRecordRefs(entry.record).includes(ref)))
    .slice(0, 16);
  const budgetField = budget?.budgetField ?? 'maxCount';
  const trace = contextEnvelopeSlimmingTrace({
    governance,
    target,
    reason: `contextBudget.${budgetField}`,
    source: `${governance.source}.contextBudget.${budgetField}`,
    budgetField,
    beforeCount: filtered.length,
    afterCount: slimmed.length,
    maxCount,
    inputRefs: filteredRefs,
    keptRefs,
    omittedRefs,
    preservedRequiredRefs,
    missingRequiredRefs,
  });
  governance.decisions.push({
    id: `${target}:context-budget-${budgetField}`,
    target,
    reason: `contextBudget.${budgetField}`,
    source: `${governance.source}.contextBudget.${budgetField}`,
    beforeCount: filtered.length,
    afterCount: slimmed.length,
    omittedRefs,
    preservedRequiredRefs,
    missingRequiredRefs,
    trace,
  });
  return slimmed;
}

export function contextEnvelopeGovernanceAudit(governance: ContextEnvelopeGovernance) {
  return {
    schemaVersion: governance.schemaVersion,
    source: governance.source,
    contractRef: governance.contractRef,
    traceRef: governance.traceRef,
    shadowMode: governance.shadowMode,
    contextBudget: governance.contextBudget,
    contextRefs: governance.contextRefs,
    decisions: governance.decisions.map((decision) => clipForAgentServerJson(decision, 2)),
    ignoredLegacySources: governance.ignoredLegacySources?.map((source) => clipForAgentServerJson(source, 1)),
    slimmingTrace: governance.decisions
      .map((decision) => decision.trace)
      .filter((trace): trace is ContextEnvelopeSlimmingTrace => Boolean(trace))
      .map((trace) => clipForAgentServerJson(trace, 1)),
  };
}

function contextEnvelopeGovernanceSource(uiState: Record<string, unknown>):
  | { source: string; contract: Record<string, unknown>; summary?: Record<string, unknown> }
  | undefined {
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : undefined;
  if (isRecord(agentHarness?.contract)) {
    return {
      source: 'request.uiState.agentHarness.contract',
      contract: agentHarness.contract,
      summary: isRecord(agentHarness.summary) ? agentHarness.summary : undefined,
    };
  }
  const handoff = isRecord(uiState.agentHarnessHandoff)
    ? uiState.agentHarnessHandoff
    : undefined;
  if (handoff) {
    return {
      source: 'request.uiState.agentHarnessHandoff',
      contract: contextEnvelopeContractFromHandoff(handoff),
      summary: isRecord(handoff.summary) ? handoff.summary : undefined,
    };
  }
  return undefined;
}

function contextEnvelopeContractFromHandoff(handoff: Record<string, unknown>) {
  const contextRefs = isRecord(handoff.contextRefs) ? handoff.contextRefs : {};
  return {
    contractRef: handoff.harnessContractRef,
    traceRef: handoff.harnessTraceRef,
    shadowMode: handoff.shadowMode,
    allowedContextRefs: contextRefs.allowed,
    blockedContextRefs: contextRefs.blocked,
    requiredContextRefs: contextRefs.required,
    contextBudget: handoff.contextBudget ?? (isRecord(handoff.budgetSummary) && isRecord(handoff.budgetSummary.context)
      ? handoff.budgetSummary.context
      : undefined),
  };
}

function contextEnvelopeGovernanceEnabled(uiState: Record<string, unknown>) {
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const configured = [
    process.env.SCIFORGE_AGENT_HARNESS_CONTEXT_ENVELOPE,
    process.env.SCIFORGE_AGENT_HARNESS_CONSUME_CONTEXT,
    uiState.agentHarnessContextEnvelopeEnabled,
    uiState.harnessContextEnvelopeEnabled,
    agentHarness.contextEnvelopeEnabled,
    agentHarness.consumeContextEnvelope,
  ].find((value) => value !== undefined);
  if (configured === undefined) return false;
  return configured === true || ['1', 'true', 'on', 'enabled'].includes(String(configured).trim().toLowerCase());
}

function contextEnvelopeGovernanceBudgetFromRecord(contract: Record<string, unknown>): ContextEnvelopeGovernanceBudget {
  const source = isRecord(contract.contextBudget) ? contract.contextBudget : {};
  return {
    maxPromptTokens: positiveIntegerField(source.maxPromptTokens),
    maxHistoryTurns: nonNegativeIntegerField(source.maxHistoryTurns),
    maxReferenceDigests: nonNegativeIntegerField(source.maxReferenceDigests),
    maxFullTextRefs: nonNegativeIntegerField(source.maxFullTextRefs),
  };
}

function contextEnvelopeGovernanceRefsFromRecord(contract: Record<string, unknown>) {
  return {
    allowed: uniqueStrings(contract.allowedContextRefs),
    blocked: uniqueStrings(contract.blockedContextRefs),
    required: uniqueStrings(contract.requiredContextRefs),
  };
}

function emptyContextRefs() {
  return { allowed: [], blocked: [], required: [] };
}

function contextEnvelopeIgnoredLegacySources(uiState: Record<string, unknown>): ContextEnvelopeIgnoredLegacySource[] {
  return [
    ...legacyContextSourceFromRecord('request.uiState', uiState),
    ...legacyContextSourceFromRecord('request.uiState.contextPolicy', isRecord(uiState.contextPolicy) ? uiState.contextPolicy : {}),
    ...legacyContextSourceFromRecord('request.uiState.capabilityPolicy', isRecord(uiState.capabilityPolicy) ? uiState.capabilityPolicy : {}),
    ...legacyContextSourceFromRecord('request.uiState.capabilityBrokerPolicy', isRecord(uiState.capabilityBrokerPolicy) ? uiState.capabilityBrokerPolicy : {}),
  ];
}

function legacyContextSourceFromRecord(source: string, record: Record<string, unknown>): ContextEnvelopeIgnoredLegacySource[] {
  const refs = uniqueStrings([
    ...toStringList(record.allowedContextRefs),
    ...toStringList(record.blockedContextRefs),
    ...toStringList(record.requiredContextRefs),
    ...legacyContextRefsFromValue(record.contextRefs),
  ]);
  const budgetFields = legacyContextBudgetFields(record.contextBudget);
  const keys = [
    record.allowedContextRefs !== undefined ? 'allowedContextRefs' : undefined,
    record.blockedContextRefs !== undefined ? 'blockedContextRefs' : undefined,
    record.requiredContextRefs !== undefined ? 'requiredContextRefs' : undefined,
    record.contextRefs !== undefined ? 'contextRefs' : undefined,
    record.contextBudget !== undefined ? 'contextBudget' : undefined,
  ].filter((key): key is string => Boolean(key));
  if (!keys.length) return [];
  return [{
    source,
    reason: 'contract-only-context-governance',
    refCount: refs.length || undefined,
    budgetFields: budgetFields.length ? budgetFields : undefined,
    keys,
  }];
}

function legacyContextRefsFromValue(value: unknown) {
  if (!isRecord(value)) return toStringList(value);
  return [
    ...toStringList(value.allowed),
    ...toStringList(value.blocked),
    ...toStringList(value.required),
  ];
}

function legacyContextBudgetFields(value: unknown) {
  if (!isRecord(value)) return [];
  return ['maxPromptTokens', 'maxHistoryTurns', 'maxReferenceDigests', 'maxFullTextRefs']
    .filter((key) => value[key] !== undefined);
}

function selectGovernanceBudgetedRecords(
  records: AnnotatedGovernanceRecord[],
  maxCount: number,
  requiredRefs: string[],
) {
  if (maxCount < 1) {
    return records.filter((entry) => recordMatchesAnyRef(entry.record, requiredRefs));
  }
  const selected = records.slice(0, maxCount);
  for (const required of records.filter((entry) => recordMatchesAnyRef(entry.record, requiredRefs))) {
    if (selected.includes(required)) continue;
    const replaceIndex = findLastNonRequiredRecordIndex(selected, requiredRefs);
    if (replaceIndex >= 0) selected[replaceIndex] = required;
    else selected.push(required);
  }
  return selected;
}

function findLastNonRequiredRecordIndex(records: AnnotatedGovernanceRecord[], requiredRefs: string[]) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (!recordMatchesAnyRef(records[index].record, requiredRefs)) return index;
  }
  return -1;
}

type AnnotatedGovernanceRecord = {
  record: Record<string, unknown>;
  index: number;
  auditRef: string;
};

function annotateGovernanceRecords(records: Array<Record<string, unknown>>): AnnotatedGovernanceRecord[] {
  return records.map((record, index) => ({
    record,
    index,
    auditRef: governanceRecordAuditRef(record, index),
  }));
}

function contextEnvelopeSlimmingTrace(input: {
  governance: ContextEnvelopeGovernance;
  target: string;
  reason: string;
  source: string;
  budgetField: string;
  beforeCount: number;
  afterCount: number;
  maxCount: number;
  inputRefs: string[];
  keptRefs: string[];
  omittedRefs: string[];
  preservedRequiredRefs: string[];
  missingRequiredRefs: string[];
}): ContextEnvelopeSlimmingTrace {
  const base = {
    schemaVersion: 'sciforge.context-envelope.slimming-trace.v1' as const,
    decisionRef: '',
    target: input.target,
    reason: input.reason,
    source: input.source,
    sourceRefs: {
      contractRef: input.governance.contractRef,
      traceRef: input.governance.traceRef,
      budgetField: input.budgetField,
    },
    deterministic: true as const,
    beforeCount: input.beforeCount,
    afterCount: input.afterCount,
    maxCount: input.maxCount,
    exceededByCount: Math.max(0, input.beforeCount - input.maxCount),
    inputRefs: input.inputRefs.slice(0, 32),
    keptRefs: input.keptRefs.slice(0, 32),
    omittedRefs: input.omittedRefs.slice(0, 32),
    requiredRefs: input.governance.contextRefs.required.slice(0, 32),
    preservedRequiredRefs: input.preservedRequiredRefs.slice(0, 32),
    missingRequiredRefs: input.missingRequiredRefs.slice(0, 32),
  };
  const decisionDigest = `sha1:${hashJson(base)}`;
  return {
    ...base,
    decisionRef: `context-envelope-slimming:${hashJson({
      target: input.target,
      source: input.source,
      contractRef: input.governance.contractRef,
      traceRef: input.governance.traceRef,
      keptRefs: input.keptRefs,
      omittedRefs: input.omittedRefs,
    })}`,
    decisionDigest,
  };
}

function governanceRecordAllowed(record: Record<string, unknown>, governance: ContextEnvelopeGovernance) {
  if (recordMatchesAnyRef(record, governance.contextRefs.blocked)) return false;
  if (!governance.contextRefs.allowed.length) return true;
  return recordMatchesAnyRef(record, [...governance.contextRefs.allowed, ...governance.contextRefs.required]);
}

function recordMatchesAnyRef(record: Record<string, unknown> | undefined, refs: string[]) {
  if (!record || !refs.length) return false;
  const recordRefs = governanceRecordRefs(record);
  return refs.some((ref) => recordRefs.includes(ref));
}

function governanceRecordRefs(record: Record<string, unknown>) {
  return uniqueStrings([
    record.ref,
    record.artifactRef,
    record.dataRef,
    record.codeRef,
    record.inputRef,
    record.outputRef,
    record.stdoutRef,
    record.stderrRef,
    record.path,
    record.id,
  ]);
}

function governanceRecordAuditRef(record: Record<string, unknown>, index: number) {
  return governanceRecordRefs(record)[0] ?? `record:${index}`;
}

function uniqueStrings(values: unknown) {
  return [...new Set(toStringList(values))];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveIntegerField(value: unknown) {
  const numberValue = numberField(value);
  return numberValue !== undefined && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

function nonNegativeIntegerField(value: unknown) {
  const numberValue = numberField(value);
  return numberValue !== undefined && numberValue >= 0 ? Math.floor(numberValue) : undefined;
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}
