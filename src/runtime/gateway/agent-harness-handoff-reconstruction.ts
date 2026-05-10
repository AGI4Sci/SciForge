import { clipForAgentServerJson, clipForAgentServerPrompt, isRecord } from '../gateway-utils.js';
import { buildAgentHarnessPromptRenderPlan } from './agent-harness-shadow.js';

export interface AgentHarnessHandoffRefs {
  harnessContractRef?: string;
  harnessTraceRef?: string;
  agentHarnessHandoffSchemaVersion?: string;
}

export interface AgentHarnessHandoffRefSource extends AgentHarnessHandoffRefs {
  source: string;
}

export function agentHarnessHandoffRefsFromPayload(
  payload: unknown,
  options: { auditRecords?: unknown[] } = {},
): { refs: AgentHarnessHandoffRefs; sources: AgentHarnessHandoffRefSource[] } {
  const sources: AgentHarnessHandoffRefSource[] = [];
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: 'payload.metadata', value: recordPath(payload, ['metadata']) },
    { source: 'payload.input.metadata', value: recordPath(payload, ['input', 'metadata']) },
    { source: 'payload.runtime.metadata', value: recordPath(payload, ['runtime', 'metadata']) },
    { source: 'payload.metadata.agentHarnessHandoff', value: recordPath(payload, ['metadata', 'agentHarnessHandoff']) },
    { source: 'payload.input.metadata.agentHarnessHandoff', value: recordPath(payload, ['input', 'metadata', 'agentHarnessHandoff']) },
    { source: 'payload.runtime.metadata.agentHarnessHandoff', value: recordPath(payload, ['runtime', 'metadata', 'agentHarnessHandoff']) },
    { source: 'payload._sciforgeHandoffManifest.sourceRefs', value: recordPath(payload, ['_sciforgeHandoffManifest', 'sourceRefs']) },
  ];
  for (const [index, record] of (options.auditRecords ?? []).entries()) {
    candidates.push(
      { source: `auditRecords[${index}].sourceRefs`, value: recordPath(record, ['sourceRefs']) },
      { source: `auditRecords[${index}].agentHarnessHandoff`, value: recordPath(record, ['agentHarnessHandoff']) },
    );
  }
  for (const candidate of candidates) {
    const refs = refsFromCandidate(candidate.value);
    if (refs.harnessContractRef || refs.harnessTraceRef) {
      sources.push({ source: candidate.source, ...refs });
    }
  }
  return { refs: mergeRefs(sources), sources };
}

export function reconstructAgentHarnessHandoffPayloadFromContract(input: {
  contract: Record<string, unknown>;
  trace?: Record<string, unknown>;
  payload?: unknown;
  auditRecords?: unknown[];
  refs?: AgentHarnessHandoffRefs;
  summarySource?: string;
}) {
  const extracted = agentHarnessHandoffRefsFromPayload(input.payload, { auditRecords: input.auditRecords });
  const refs = mergeRefs([
    ...extracted.sources,
    { source: 'input.refs', ...input.refs },
    {
      source: 'contract',
      harnessContractRef: stringField(input.contract.contractRef),
      harnessTraceRef: stringField(input.contract.traceRef),
    },
    {
      source: 'trace',
      harnessTraceRef: stringField(input.trace?.traceRef) ?? stringField(input.trace?.ref) ?? stringField(input.trace?.id),
    },
  ]);
  const profileId = stringField(input.contract.profileId);
  const budgetSummary = agentHarnessBudgetSummary(input.contract);
  const summary = {
    schemaVersion: stringField(input.contract.schemaVersion) ?? 'sciforge.agent-harness-contract.v1',
    profileId,
    contractRef: refs.harnessContractRef,
    traceRef: refs.harnessTraceRef,
    intentMode: stringField(input.contract.intentMode),
    explorationMode: stringField(input.contract.explorationMode),
    allowedContextRefCount: stringList(input.contract.allowedContextRefs).length,
    blockedContextRefCount: stringList(input.contract.blockedContextRefs).length,
    requiredContextRefCount: stringList(input.contract.requiredContextRefs).length,
    promptDirectiveCount: Array.isArray(input.contract.promptDirectives) ? input.contract.promptDirectives.length : undefined,
    traceStageCount: Array.isArray(input.trace?.stages) ? input.trace?.stages.length : undefined,
    budgetSummary,
    decisionOwner: 'AgentServer',
  };
  const promptRenderPlan = buildAgentHarnessPromptRenderPlan({
    contract: input.contract,
    trace: input.trace,
    summary,
  });
  const promptRenderPlanSummary = agentHarnessPromptRenderPlanSummaryFromPlan(
    promptRenderPlan,
    input.summarySource ?? 'reconstructed.agentHarnessHandoff',
  );
  const contextRefs = {
    allowed: stringList(input.contract.allowedContextRefs),
    blocked: stringList(input.contract.blockedContextRefs),
    required: stringList(input.contract.requiredContextRefs),
  };
  const handoff = {
    schemaVersion: refs.agentHarnessHandoffSchemaVersion ?? 'sciforge.agent-harness-handoff.v1',
    shadowMode: true,
    decisionOwner: 'AgentServer',
    harnessProfileId: profileId,
    harnessContractRef: refs.harnessContractRef,
    harnessTraceRef: refs.harnessTraceRef,
    intentMode: stringField(input.contract.intentMode),
    explorationMode: stringField(input.contract.explorationMode),
    contextRefs,
    contextBudget: isRecord(budgetSummary.context) ? budgetSummary.context : undefined,
    repairContextPolicy: isRecord(input.contract.repairContextPolicy) ? input.contract.repairContextPolicy : undefined,
    promptDirectives: promptRenderPlan.directiveRefs,
    promptRenderPlan,
    budgetSummary,
    summary,
  };
  return {
    refs,
    refSources: extracted.sources,
    handoff,
    metadata: {
      harnessProfileId: profileId,
      harnessContractRef: refs.harnessContractRef,
      harnessTraceRef: refs.harnessTraceRef,
      harnessBudgetSummary: budgetSummary,
      harnessDecisionOwner: 'AgentServer',
      harnessSummary: summary,
      agentHarnessHandoff: handoff,
    },
    promptRenderPlan,
    promptRenderPlanSummary,
  };
}

export function agentHarnessPromptRenderPlanSummaryFromPlan(plan: Record<string, unknown>, source: string) {
  const renderedEntries = Array.isArray(plan.renderedEntries)
    ? plan.renderedEntries.filter(isRecord).slice(0, 32).map(promptRenderPlanEntrySummary).filter(isRecord)
    : [];
  const sourceRefs = isRecord(plan.sourceRefs) ? clipForAgentServerJson(plan.sourceRefs, 2) : undefined;
  const renderDigest = stringField(plan.renderDigest);
  if (!renderDigest && !sourceRefs && !renderedEntries.length) return undefined;
  return {
    schemaVersion: 'sciforge.agentserver.prompt-render-plan-summary.v1',
    source,
    renderPlanSchemaVersion: stringField(plan.schemaVersion),
    renderMode: stringField(plan.renderMode),
    deterministic: plan.deterministic === true,
    renderDigest,
    sourceRefs,
    renderedEntries,
  };
}

function promptRenderPlanEntrySummary(entry: Record<string, unknown>) {
  const id = stringField(entry.id);
  const sourceCallbackId = stringField(entry.sourceCallbackId);
  if (!id || !sourceCallbackId) return undefined;
  const out: Record<string, unknown> = {
    kind: stringField(entry.kind) ?? 'strategy',
    id,
    sourceCallbackId,
  };
  const text = stringField(entry.text);
  if (text) out.text = clipForAgentServerPrompt(text, 800);
  if (typeof entry.priority === 'number' && Number.isFinite(entry.priority)) out.priority = entry.priority;
  return out;
}

function refsFromCandidate(value: unknown): AgentHarnessHandoffRefs {
  if (!isRecord(value)) return {};
  const handoff = isRecord(value.agentHarnessHandoff) ? value.agentHarnessHandoff : value;
  return {
    harnessContractRef: stringField(handoff.harnessContractRef) ?? stringField(value.harnessContractRef),
    harnessTraceRef: stringField(handoff.harnessTraceRef) ?? stringField(value.harnessTraceRef),
    agentHarnessHandoffSchemaVersion: stringField(handoff.schemaVersion) ?? stringField(value.agentHarnessHandoffSchemaVersion),
  };
}

function mergeRefs(sources: Array<AgentHarnessHandoffRefs | undefined>): AgentHarnessHandoffRefs {
  const out: AgentHarnessHandoffRefs = {};
  for (const source of sources) {
    if (!source) continue;
    out.harnessContractRef ??= stringField(source.harnessContractRef);
    out.harnessTraceRef ??= stringField(source.harnessTraceRef);
    out.agentHarnessHandoffSchemaVersion ??= stringField(source.agentHarnessHandoffSchemaVersion);
  }
  return out;
}

function agentHarnessBudgetSummary(contract: Record<string, unknown>) {
  const contextBudget = isRecord(contract.contextBudget) ? contract.contextBudget : {};
  const toolBudget = isRecord(contract.toolBudget) ? contract.toolBudget : {};
  return {
    context: {
      maxPromptTokens: numberField(contextBudget.maxPromptTokens),
      maxHistoryTurns: numberField(contextBudget.maxHistoryTurns),
      maxReferenceDigests: numberField(contextBudget.maxReferenceDigests),
      maxFullTextRefs: numberField(contextBudget.maxFullTextRefs),
    },
    tool: {
      maxWallMs: numberField(toolBudget.maxWallMs),
      maxToolCalls: numberField(toolBudget.maxToolCalls),
      maxObserveCalls: numberField(toolBudget.maxObserveCalls),
      maxActionSteps: numberField(toolBudget.maxActionSteps),
      maxNetworkCalls: numberField(toolBudget.maxNetworkCalls),
      maxDownloadBytes: numberField(toolBudget.maxDownloadBytes),
      maxResultItems: numberField(toolBudget.maxResultItems),
      maxProviders: numberField(toolBudget.maxProviders),
      maxRetries: numberField(toolBudget.maxRetries),
      perProviderTimeoutMs: numberField(toolBudget.perProviderTimeoutMs),
      costUnits: numberField(toolBudget.costUnits),
      exhaustedPolicy: stringField(toolBudget.exhaustedPolicy),
    },
  };
}

function recordPath(value: unknown, path: string[]) {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}
