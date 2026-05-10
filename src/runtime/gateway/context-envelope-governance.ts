import type { GatewayRequest } from '../runtime-types.js';
import { clipForAgentServerJson, isRecord, toStringList } from '../gateway-utils.js';

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
};

export function contextEnvelopeGovernanceForRequest(request: GatewayRequest): ContextEnvelopeGovernance | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (!contextEnvelopeGovernanceEnabled(uiState)) return undefined;
  const source = contextEnvelopeGovernanceSource(uiState);
  if (!source) return undefined;
  const contextBudget = contextEnvelopeGovernanceBudgetFromRecord(source.contract);
  const contextRefs = contextEnvelopeGovernanceRefsFromRecord(source.contract);
  if (!Object.values(contextBudget).some((value) => value !== undefined)
    && !contextRefs.allowed.length
    && !contextRefs.blocked.length
    && !contextRefs.required.length) {
    return undefined;
  }
  return {
    schemaVersion: 'sciforge.context-envelope.harness-governance.v1',
    source: source.source,
    contractRef: stringField(source.contract.contractRef)
      ?? stringField(source.contract.harnessContractRef)
      ?? stringField(source.summary?.contractRef),
    traceRef: stringField(source.contract.traceRef)
      ?? stringField(source.contract.harnessTraceRef)
      ?? stringField(source.summary?.traceRef),
    shadowMode: booleanField(source.contract.shadowMode),
    contextBudget,
    contextRefs,
    decisions: [],
  };
}

export function applyContextEnvelopeRecordGovernance(
  target: string,
  records: Array<Record<string, unknown>>,
  governance: ContextEnvelopeGovernance | undefined,
  budget?: { maxCount?: number; budgetField?: keyof ContextEnvelopeGovernanceBudget },
) {
  if (!governance) return records;
  const beforeRefs = records.map((record, index) => governanceRecordAuditRef(record, index));
  const filtered = records.filter((record) => governanceRecordAllowed(record, governance));
  const filteredRefs = filtered.map((record, index) => governanceRecordAuditRef(record, index));
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
  const slimmed = selectGovernanceBudgetedRecords(filtered, maxCount, governance.contextRefs.required);
  governance.decisions.push({
    id: `${target}:context-budget-${budget?.budgetField ?? 'maxCount'}`,
    target,
    reason: `contextBudget.${budget?.budgetField ?? 'maxCount'}`,
    source: `${governance.source}.contextBudget.${budget?.budgetField ?? 'maxCount'}`,
    beforeCount: filtered.length,
    afterCount: slimmed.length,
    omittedRefs: filtered
      .map((record, index) => governanceRecordAuditRef(record, index))
      .filter((ref) => !slimmed.map((record, index) => governanceRecordAuditRef(record, index)).includes(ref))
      .slice(0, 16),
    preservedRequiredRefs: slimmed
      .filter((record) => recordMatchesAnyRef(record, governance.contextRefs.required))
      .map((record, index) => governanceRecordAuditRef(record, index))
      .slice(0, 16),
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

function selectGovernanceBudgetedRecords(
  records: Array<Record<string, unknown>>,
  maxCount: number,
  requiredRefs: string[],
) {
  if (maxCount < 1) {
    return records.filter((record) => recordMatchesAnyRef(record, requiredRefs));
  }
  const selected = records.slice(0, maxCount);
  for (const required of records.filter((record) => recordMatchesAnyRef(record, requiredRefs))) {
    if (selected.includes(required)) continue;
    const replaceIndex = findLastNonRequiredRecordIndex(selected, requiredRefs);
    if (replaceIndex >= 0) selected[replaceIndex] = required;
    else selected.push(required);
  }
  return selected;
}

function findLastNonRequiredRecordIndex(records: Array<Record<string, unknown>>, requiredRefs: string[]) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (!recordMatchesAnyRef(records[index], requiredRefs)) return index;
  }
  return -1;
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
