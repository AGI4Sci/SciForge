import type { GatewayRequest, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { clipForAgentServerJson, errorMessage, hashJson, isRecord } from '../gateway-utils.js';

const AGENT_HARNESS_CONTRACT_EVENT_TYPE = 'agent-harness-contract';
const AGENT_HARNESS_SHADOW_SCHEMA_VERSION = 'sciforge.agent-harness-shadow.v1';
const AGENT_HARNESS_HANDOFF_SCHEMA_VERSION = 'sciforge.agent-harness-handoff.v1';
const DEFAULT_AGENT_HARNESS_PROFILE_ID = 'balanced-default';

interface AgentHarnessEvaluation {
  contract: Record<string, unknown>;
  trace: Record<string, unknown>;
}

export async function requestWithAgentHarnessShadow(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks,
  policyApplication: { status: string; response?: unknown; error?: string },
): Promise<GatewayRequest> {
  const profileId = agentHarnessProfileId(request);
  if (agentHarnessDisabled(request)) {
    emitAgentHarnessContractEvent(callbacks, {
      status: 'skipped',
      profileId,
      reason: 'agent harness disabled',
    });
    return request;
  }

  const evaluation = await evaluateAgentHarnessShadow(request, profileId, policyApplication);
  if (!evaluation.ok) {
    emitAgentHarnessContractEvent(callbacks, {
      status: evaluation.reason === 'missing' ? 'skipped' : 'failed',
      profileId,
      reason: evaluation.reason,
      error: evaluation.error,
    });
    return request;
  }

  const contractRef = agentHarnessContractRef(evaluation.evaluation.contract, profileId);
  const traceRef = agentHarnessTraceRef(evaluation.evaluation.trace, contractRef);
  const summary = agentHarnessSummary(evaluation.evaluation.contract, evaluation.evaluation.trace, {
    profileId,
    contractRef,
    traceRef,
  });
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const agentHarness = {
    schemaVersion: AGENT_HARNESS_SHADOW_SCHEMA_VERSION,
    shadowMode: true,
    profileId,
    contractRef,
    traceRef,
    summary,
    contract: evaluation.evaluation.contract,
    trace: evaluation.evaluation.trace,
  };
  emitAgentHarnessContractEvent(callbacks, {
    status: 'completed',
    profileId,
    contractRef,
    traceRef,
    summary,
    contract: evaluation.evaluation.contract,
    trace: evaluation.evaluation.trace,
  });
  return {
    ...request,
    uiState: {
      ...uiState,
      harnessProfileId: profileId,
      agentHarness,
    },
  };
}

export function agentHarnessMetadata(request: GatewayRequest) {
  return agentHarnessHandoffMetadata(request);
}

export function agentHarnessHandoffMetadata(request: GatewayRequest) {
  const agentHarness = isRecord(request.uiState?.agentHarness) ? request.uiState.agentHarness : undefined;
  const summary = isRecord(agentHarness?.summary) ? agentHarness.summary : undefined;
  const profileId = stringField(agentHarness?.profileId) ?? stringField(request.uiState?.harnessProfileId);
  if (!profileId && !summary) return {};
  const contract = isRecord(agentHarness?.contract) ? agentHarness.contract : undefined;
  const contractRef = stringField(agentHarness?.contractRef) ?? stringField(summary?.contractRef);
  const traceRef = stringField(agentHarness?.traceRef) ?? stringField(summary?.traceRef);
  const budgetSummary = agentHarnessBudgetSummary(contract, summary);
  const contextRefs = agentHarnessContextRefs(contract);
  const repairContextPolicy = isRecord(contract?.repairContextPolicy) ? contract.repairContextPolicy : undefined;
  const promptDirectives = agentHarnessPromptDirectiveRefs(contract);
  const decisionOwner = 'AgentServer';
  const harnessSummary = agentHarnessMetadataSummary({
    summary,
    profileId,
    contractRef,
    traceRef,
    budgetSummary,
    decisionOwner,
  });
  return {
    harnessProfileId: profileId,
    harnessContractRef: contractRef,
    harnessTraceRef: traceRef,
    harnessBudgetSummary: budgetSummary,
    harnessDecisionOwner: decisionOwner,
    harnessSummary,
    agentHarnessHandoff: {
      schemaVersion: AGENT_HARNESS_HANDOFF_SCHEMA_VERSION,
      shadowMode: true,
      decisionOwner,
      harnessProfileId: profileId,
      harnessContractRef: contractRef,
      harnessTraceRef: traceRef,
      intentMode: stringField(contract?.intentMode) ?? stringField(harnessSummary.intentMode),
      explorationMode: stringField(contract?.explorationMode) ?? stringField(harnessSummary.explorationMode),
      contextRefs,
      repairContextPolicy,
      promptDirectives,
      budgetSummary,
      summary: harnessSummary,
    },
  };
}

export function requestWithoutInlineAgentHarness(request: GatewayRequest): GatewayRequest {
  if (!isRecord(request.uiState?.agentHarness) && !request.uiState?.harnessProfileId) return request;
  const uiState = isRecord(request.uiState) ? { ...request.uiState } : {};
  delete uiState.agentHarness;
  delete uiState.harnessProfileId;
  return {
    ...request,
    uiState,
  };
}

function agentHarnessDisabled(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const harness = isRecord(uiState.agentHarness) ? uiState.agentHarness : isRecord(uiState.harness) ? uiState.harness : {};
  const configured = [
    process.env.SCIFORGE_AGENT_HARNESS,
    process.env.SCIFORGE_ENABLE_AGENT_HARNESS,
    uiState.agentHarnessEnabled,
    harness.enabled,
  ].find((value) => value !== undefined);
  return configured === false || ['0', 'false', 'off', 'disabled'].includes(String(configured).trim().toLowerCase());
}

function agentHarnessProfileId(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const harness = isRecord(uiState.agentHarness) ? uiState.agentHarness : isRecord(uiState.harness) ? uiState.harness : {};
  const profile = isRecord(uiState.harnessProfile) ? uiState.harnessProfile : isRecord(harness.profile) ? harness.profile : {};
  return stringField(uiState.harnessProfileId)
    ?? stringField(uiState.agentHarnessProfileId)
    ?? stringField(harness.profileId)
    ?? stringField(profile.id)
    ?? DEFAULT_AGENT_HARNESS_PROFILE_ID;
}

function agentHarnessInputFromRequest(request: GatewayRequest): Record<string, unknown> {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const harness = isRecord(uiState.agentHarnessInput)
    ? uiState.agentHarnessInput
    : isRecord(uiState.harnessInput)
      ? uiState.harnessInput
      : isRecord(uiState.harness)
        ? uiState.harness
        : {};
  const input: Record<string, unknown> = {};
  const intentMode = stringField(harness.intentMode) ?? stringField(uiState.harnessIntentMode);
  if (intentMode && ['fresh', 'continuation', 'repair', 'audit', 'file-grounded', 'interactive'].includes(intentMode)) {
    input.intentMode = intentMode;
  }
  const contextRefs = stringListField(harness.contextRefs);
  input.contextRefs = contextRefs.length ? contextRefs : requestContextRefs(request);
  const requiredContextRefs = stringListField(harness.requiredContextRefs);
  if (requiredContextRefs.length) input.requiredContextRefs = requiredContextRefs;
  const blockedContextRefs = stringListField(harness.blockedContextRefs);
  if (blockedContextRefs.length) input.blockedContextRefs = blockedContextRefs;
  if (isRecord(harness.budgetOverrides)) input.budgetOverrides = harness.budgetOverrides;
  if (isRecord(harness.conversationSignals)) input.conversationSignals = harness.conversationSignals;
  return input;
}

function requestContextRefs(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return sortedUnique([
    ...refsFromRecords(Array.isArray(request.references) ? request.references : []),
    ...refsFromRecords(Array.isArray(request.artifacts) ? request.artifacts : []),
    ...refsFromRecords(Array.isArray(uiState.currentReferences) ? uiState.currentReferences : []),
    ...refsFromRecords(Array.isArray(uiState.recentExecutionRefs) ? uiState.recentExecutionRefs : []),
  ]);
}

function refsFromRecords(records: unknown[]) {
  const refs: string[] = [];
  for (const record of records) {
    if (!isRecord(record)) continue;
    for (const key of ['ref', 'artifactRef', 'dataRef', 'codeRef', 'outputRef', 'stdoutRef', 'stderrRef', 'id']) {
      const value = stringField(record[key]);
      if (value) refs.push(value);
    }
  }
  return refs;
}

async function evaluateAgentHarnessShadow(
  request: GatewayRequest,
  profileId: string,
  policyApplication: { status: string; response?: unknown; error?: string },
): Promise<
  | { ok: true; evaluation: AgentHarnessEvaluation }
  | { ok: false; reason: 'missing' | 'invalid' | 'error'; error?: string }
> {
  const runtime = await loadAgentHarnessRuntime();
  if (!runtime) return { ok: false, reason: 'missing' };
  try {
    const result = await runtime.evaluate({
      ...agentHarnessInputFromRequest(request),
      profileId,
      requestId: hashJson({ prompt: request.prompt, skillDomain: request.skillDomain }).slice(0, 12),
      prompt: request.prompt,
      request,
      workspace: request.workspacePath,
      stage: 'gateway-shadow',
      shadowMode: true,
      conversationPolicy: {
        status: policyApplication.status,
        response: policyApplication.response,
        error: policyApplication.error,
      },
      runtime: {
        source: 'runWorkspaceRuntimeGateway',
        schemaVersion: AGENT_HARNESS_SHADOW_SCHEMA_VERSION,
      },
    });
    if (!isRecord(result) || !isRecord(result.contract) || !isRecord(result.trace)) {
      return { ok: false, reason: 'invalid', error: 'HarnessRuntime.evaluate() did not return { contract, trace } records.' };
    }
    return { ok: true, evaluation: { contract: result.contract, trace: result.trace } };
  } catch (error) {
    return { ok: false, reason: 'error', error: errorMessage(error) };
  }
}

async function loadAgentHarnessRuntime(): Promise<{ evaluate(input: Record<string, unknown>): Promise<unknown> } | undefined> {
  const candidates = [
    new URL('../../../packages/agent-harness/src/runtime.ts', import.meta.url).href,
    new URL('../../../packages/agent-harness/src/index.ts', import.meta.url).href,
    '@sciforge/agent-harness',
  ];
  for (const candidate of candidates) {
    const loaded = await importAgentHarnessModule(candidate);
    const runtime = loaded ? agentHarnessRuntimeFromModule(loaded) : undefined;
    if (runtime) return runtime;
  }
  return undefined;
}

async function importAgentHarnessModule(specifier: string): Promise<Record<string, unknown> | undefined> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    const loaded = await dynamicImport(specifier);
    return isRecord(loaded) ? loaded : undefined;
  } catch {
    return undefined;
  }
}

function agentHarnessRuntimeFromModule(moduleExports: Record<string, unknown>) {
  const candidates = [
    moduleExports.HarnessRuntime,
    moduleExports.createHarnessRuntime,
    moduleExports.createDefaultHarnessRuntime,
    moduleExports.default,
    moduleExports,
  ];
  for (const candidate of candidates) {
    const runtime = agentHarnessRuntimeFromCandidate(candidate);
    if (runtime) return runtime;
  }
  return undefined;
}

function agentHarnessRuntimeFromCandidate(candidate: unknown): { evaluate(input: Record<string, unknown>): Promise<unknown> } | undefined {
  if (isRecord(candidate) && typeof candidate.evaluate === 'function') {
    const evaluate = candidate.evaluate as (input: Record<string, unknown>) => unknown;
    return { evaluate: (input) => Promise.resolve(evaluate.call(candidate, input)) };
  }
  if (typeof candidate !== 'function') return undefined;
  try {
    const callable = candidate as ((input?: unknown) => unknown) & { evaluate?: (input: Record<string, unknown>) => unknown };
    if (typeof callable.evaluate === 'function') {
      return { evaluate: (input) => Promise.resolve(callable.evaluate?.call(callable, input)) };
    }
    const created = callable();
    if (isRecord(created) && typeof created.evaluate === 'function') {
      const evaluate = created.evaluate as (input: Record<string, unknown>) => unknown;
      return { evaluate: (input) => Promise.resolve(evaluate.call(created, input)) };
    }
  } catch {
    try {
      const Constructor = candidate as new () => unknown;
      const created = new Constructor();
      if (isRecord(created) && typeof created.evaluate === 'function') {
        const evaluate = created.evaluate as (input: Record<string, unknown>) => unknown;
        return { evaluate: (input) => Promise.resolve(evaluate.call(created, input)) };
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function agentHarnessContractRef(contract: Record<string, unknown>, profileId: string) {
  return stringField(contract.contractRef)
    ?? stringField(contract.id)
    ?? `runtime://agent-harness/contracts/${profileId}/${hashJson(contract).slice(0, 12)}`;
}

function agentHarnessTraceRef(trace: Record<string, unknown>, contractRef: string) {
  return stringField(trace.traceRef)
    ?? stringField(trace.id)
    ?? stringField(trace.ref)
    ?? `${contractRef}/trace`;
}

function agentHarnessSummary(
  contract: Record<string, unknown>,
  trace: Record<string, unknown>,
  refs: { profileId: string; contractRef: string; traceRef: string },
) {
  return {
    schemaVersion: stringField(contract.schemaVersion) ?? 'sciforge.agent-harness-contract.v1',
    profileId: stringField(contract.profileId) ?? refs.profileId,
    contractRef: refs.contractRef,
    traceRef: refs.traceRef,
    intentMode: stringField(contract.intentMode),
    explorationMode: stringField(contract.explorationMode),
    allowedContextRefCount: Array.isArray(contract.allowedContextRefs) ? contract.allowedContextRefs.length : undefined,
    blockedContextRefCount: Array.isArray(contract.blockedContextRefs) ? contract.blockedContextRefs.length : undefined,
    requiredContextRefCount: Array.isArray(contract.requiredContextRefs) ? contract.requiredContextRefs.length : undefined,
    promptDirectiveCount: Array.isArray(contract.promptDirectives) ? contract.promptDirectives.length : undefined,
    budgetSummary: agentHarnessBudgetSummary(contract),
    decisionOwner: 'AgentServer',
    traceStageCount: Array.isArray(trace.stages) ? trace.stages.length : Array.isArray(trace.events) ? trace.events.length : undefined,
  };
}

function agentHarnessMetadataSummary(input: {
  summary?: Record<string, unknown>;
  profileId?: string;
  contractRef?: string;
  traceRef?: string;
  budgetSummary: Record<string, unknown>;
  decisionOwner: string;
}) {
  const summary = input.summary ?? {};
  return {
    schemaVersion: stringField(summary.schemaVersion) ?? 'sciforge.agent-harness-contract.v1',
    profileId: stringField(summary.profileId) ?? input.profileId,
    contractRef: input.contractRef ?? stringField(summary.contractRef),
    traceRef: input.traceRef ?? stringField(summary.traceRef),
    intentMode: stringField(summary.intentMode),
    explorationMode: stringField(summary.explorationMode),
    allowedContextRefCount: numberField(summary.allowedContextRefCount),
    blockedContextRefCount: numberField(summary.blockedContextRefCount),
    requiredContextRefCount: numberField(summary.requiredContextRefCount),
    promptDirectiveCount: numberField(summary.promptDirectiveCount),
    traceStageCount: numberField(summary.traceStageCount),
    budgetSummary: input.budgetSummary,
    decisionOwner: input.decisionOwner,
  };
}

function agentHarnessBudgetSummary(contract?: Record<string, unknown>, summary?: Record<string, unknown>) {
  const summaryBudget = isRecord(summary?.budgetSummary) ? summary.budgetSummary : undefined;
  if (!contract) return summaryBudget ?? {};
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

function agentHarnessContextRefs(contract?: Record<string, unknown>) {
  return {
    allowed: stringListField(contract?.allowedContextRefs),
    blocked: stringListField(contract?.blockedContextRefs),
    required: stringListField(contract?.requiredContextRefs),
  };
}

function agentHarnessPromptDirectiveRefs(contract?: Record<string, unknown>) {
  if (!Array.isArray(contract?.promptDirectives)) return [];
  return contract.promptDirectives
    .filter(isRecord)
    .map((directive) => ({
      id: stringField(directive.id),
      sourceCallbackId: stringField(directive.sourceCallbackId),
      priority: numberField(directive.priority),
    }))
    .filter((directive) => directive.id && directive.sourceCallbackId);
}

function emitAgentHarnessContractEvent(
  callbacks: WorkspaceRuntimeCallbacks,
  input: {
    status: 'completed' | 'skipped' | 'failed';
    profileId: string;
    reason?: string;
    error?: string;
    contractRef?: string;
    traceRef?: string;
    summary?: Record<string, unknown>;
    contract?: Record<string, unknown>;
    trace?: Record<string, unknown>;
  },
) {
  emitWorkspaceRuntimeEvent(callbacks, {
    type: AGENT_HARNESS_CONTRACT_EVENT_TYPE,
    source: 'workspace-runtime',
    status: input.status,
    message: input.status === 'completed'
      ? `Agent harness shadow contract evaluated for ${input.profileId}.`
      : input.status === 'skipped'
        ? `Agent harness shadow evaluation skipped for ${input.profileId}.`
        : `Agent harness shadow evaluation failed for ${input.profileId}; continuing without behavior changes.`,
    detail: input.error ?? input.reason,
    raw: {
      schemaVersion: AGENT_HARNESS_SHADOW_SCHEMA_VERSION,
      shadowMode: true,
      profileId: input.profileId,
      contractRef: input.contractRef,
      traceRef: input.traceRef,
      summary: input.summary,
      contract: input.contract ? clipForAgentServerJson(input.contract) : undefined,
      trace: input.trace ? clipForAgentServerJson(input.trace) : undefined,
    },
  });
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringListField(value: unknown) {
  return Array.isArray(value)
    ? sortedUnique(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))
    : [];
}

function sortedUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
