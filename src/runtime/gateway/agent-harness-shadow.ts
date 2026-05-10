import type { GatewayRequest, LlmEndpointConfig, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { clipForAgentServerJson, errorMessage, hashJson, isRecord, toRecordList } from '../gateway-utils.js';
import { projectInteractionProgressEvent } from './interaction-progress-harness.js';
import type { ProgressPlan } from '../../../packages/agent-harness/src/contracts.js';
import {
  agentServerBackendSelectionDecision,
  type AgentServerBackendSelectionDecision,
} from './agent-backend-config.js';

const AGENT_HARNESS_CONTRACT_EVENT_TYPE = 'agent-harness-contract';
const AGENT_HARNESS_SHADOW_SCHEMA_VERSION = 'sciforge.agent-harness-shadow.v1';
const AGENT_HARNESS_HANDOFF_SCHEMA_VERSION = 'sciforge.agent-harness-handoff.v1';
const AGENT_HARNESS_PROMPT_RENDER_SCHEMA_VERSION = 'sciforge.agent-harness-prompt-render.v1';
const AGENT_HARNESS_PROGRESS_PLAN_PROJECTION_SCHEMA_VERSION = 'sciforge.agent-harness-progress-plan-projection.v1';
const AGENT_HARNESS_CONTINUITY_DECISION_SCHEMA_VERSION = 'sciforge.agent-harness-continuity-decision.v1';
const DEFAULT_AGENT_HARNESS_PROFILE_ID = 'balanced-default';

interface AgentHarnessEvaluation {
  contract: Record<string, unknown>;
  trace: Record<string, unknown>;
}

interface AgentHarnessPromptRenderEntry {
  kind: 'strategy' | 'directive';
  id: string;
  sourceCallbackId: string;
  text: string;
  priority?: number;
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
  const verificationProjection = agentHarnessVerificationPolicyProjection(
    evaluation.evaluation.contract,
    request.verificationPolicy,
    { uiState, contractRef, profileId },
  );
  const progressProjection = agentHarnessProgressPlanProjection(
    evaluation.evaluation.contract,
    { uiState, contractRef, traceRef, profileId },
  );
  if (progressProjection) emitWorkspaceRuntimeEvent(callbacks, progressProjection.event);
  return {
    ...request,
    ...(verificationProjection ? { verificationPolicy: verificationProjection.policy } : {}),
    uiState: {
      ...uiState,
      harnessProfileId: profileId,
      agentHarness,
      ...(verificationProjection ? { agentHarnessVerificationPolicy: verificationProjection.audit } : {}),
      ...(progressProjection ? { agentHarnessProgressPlan: progressProjection.audit } : {}),
    },
  };
}

export function agentHarnessMetadata(request: GatewayRequest, runtime: {
  backendSelectionDecision?: AgentServerBackendSelectionDecision;
  llmEndpoint?: LlmEndpointConfig;
} = {}) {
  return agentHarnessHandoffMetadata(request, runtime);
}

export function agentHarnessHandoffMetadata(request: GatewayRequest, runtime: {
  backendSelectionDecision?: AgentServerBackendSelectionDecision;
  llmEndpoint?: LlmEndpointConfig;
} = {}) {
  const agentHarness = isRecord(request.uiState?.agentHarness) ? request.uiState.agentHarness : undefined;
  const summary = isRecord(agentHarness?.summary) ? agentHarness.summary : undefined;
  const profileId = stringField(agentHarness?.profileId) ?? stringField(request.uiState?.harnessProfileId);
  if (!profileId && !summary) return {};
  const contract = isRecord(agentHarness?.contract) ? agentHarness.contract : undefined;
  const trace = isRecord(agentHarness?.trace) ? agentHarness.trace : undefined;
  const contractRef = stringField(agentHarness?.contractRef) ?? stringField(summary?.contractRef);
  const traceRef = stringField(agentHarness?.traceRef) ?? stringField(summary?.traceRef);
  const budgetSummary = agentHarnessBudgetSummary(contract, summary);
  const contextBudget = isRecord(budgetSummary.context) ? budgetSummary.context : undefined;
  const contextRefs = agentHarnessContextRefs(contract);
  const repairContextPolicy = isRecord(contract?.repairContextPolicy) ? contract.repairContextPolicy : undefined;
  const continuityDecision = agentHarnessContinuityDecision(request);
  const includeContinuityAudit = agentHarnessContinuityDecisionAuditEnabled(request);
  const includeBackendSelectionAudit = agentHarnessBackendSelectionDecisionAuditEnabled(request);
  const backendSelectionDecision = includeBackendSelectionAudit
    ? agentHarnessBackendSelectionDecision(request, { ...runtime, agentHarness, summary, trace })
    : undefined;
  const decisionOwner = 'AgentServer';
  const harnessSummary = agentHarnessMetadataSummary({
    summary,
    profileId,
    contractRef,
    traceRef,
    budgetSummary,
    decisionOwner,
  });
  const promptRenderPlan = buildAgentHarnessPromptRenderPlan({ contract, trace, summary: harnessSummary });
  return {
    harnessProfileId: profileId,
    harnessContractRef: contractRef,
    harnessTraceRef: traceRef,
    harnessBudgetSummary: budgetSummary,
    harnessDecisionOwner: decisionOwner,
    harnessSummary,
    ...(includeContinuityAudit ? { agentHarnessContinuityDecision: continuityDecision } : {}),
    ...(backendSelectionDecision ? { agentHarnessBackendSelectionDecision: backendSelectionDecision } : {}),
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
      contextBudget,
      repairContextPolicy,
      promptDirectives: promptRenderPlan.directiveRefs,
      promptRenderPlan,
      budgetSummary,
      summary: harnessSummary,
      ...(includeContinuityAudit ? { continuityDecision } : {}),
      ...(backendSelectionDecision ? { backendSelectionDecision } : {}),
    },
  };
}

export function agentHarnessContinuityDecision(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const policy = isRecord(uiState.contextReusePolicy)
    ? uiState.contextReusePolicy
    : isRecord(uiState.contextIsolation)
      ? uiState.contextIsolation
      : undefined;
  const policyMode = typeof policy?.mode === 'string' ? policy.mode : '';
  const historyReuse = isRecord(policy?.historyReuse) ? policy.historyReuse : {};
  const policyAllowsReuse = historyReuse.allowed === true || policyMode === 'continue' || policyMode === 'repair';
  const recentRefCount = toRecordList(uiState.recentExecutionRefs).length;
  const artifactCount = Array.isArray(request.artifacts) ? request.artifacts.length : 0;
  const useContinuity = policyAllowsReuse || recentRefCount > 0 || artifactCount > 0;
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const contract = isRecord(agentHarness.contract) ? agentHarness.contract : undefined;
  const summary = isRecord(agentHarness.summary) ? agentHarness.summary : undefined;
  const trace = isRecord(agentHarness.trace) ? agentHarness.trace : undefined;
  const intentMode = stringField(contract?.intentMode) ?? stringField(summary?.intentMode);
  const intentUseContinuity = intentMode === 'continuation' || intentMode === 'repair' || intentMode === 'audit';
  const reasons = [
    policyAllowsReuse ? 'reuse-policy' : undefined,
    recentRefCount > 0 ? 'recent-execution-ref' : undefined,
    artifactCount > 0 ? 'artifact-input' : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    schemaVersion: AGENT_HARNESS_CONTINUITY_DECISION_SCHEMA_VERSION,
    shadowMode: true,
    decisionOwner: 'AgentServer',
    decision: useContinuity ? 'continuity' : 'fresh',
    useContinuity,
    reasons,
    runtimeSignals: {
      policyMode: policyMode || undefined,
      policyAllowsReuse,
      recentExecutionRefCount: recentRefCount,
      artifactCount,
    },
    harnessSignals: {
      profileId: stringField(agentHarness.profileId) ?? stringField(summary?.profileId) ?? stringField(uiState.harnessProfileId),
      contractRef: stringField(agentHarness.contractRef) ?? stringField(summary?.contractRef),
      traceRef: stringField(agentHarness.traceRef) ?? stringField(summary?.traceRef),
      intentMode,
      intentUseContinuity: intentMode ? intentUseContinuity : undefined,
      sourceCallbackId: sourceCallbackIdForTraceField(trace, 'intentMode') ?? (intentMode ? 'harness.defaults.intentMode' : undefined),
    },
    trace: {
      policy: policy ? {
        source: isRecord(uiState.contextReusePolicy) ? 'request.uiState.contextReusePolicy' : 'request.uiState.contextIsolation',
        mode: policyMode || undefined,
        historyReuseAllowed: historyReuse.allowed === true,
      } : undefined,
      recentExecutionRefs: recentRefCount,
      artifacts: artifactCount,
    },
  };
}

export function buildAgentHarnessPromptRenderPlan(input: {
  contract?: Record<string, unknown>;
  trace?: Record<string, unknown>;
  summary?: Record<string, unknown>;
}) {
  const contract = input.contract;
  const summary = input.summary ?? {};
  const intentMode = stringField(contract?.intentMode) ?? stringField(summary.intentMode);
  const explorationMode = stringField(contract?.explorationMode) ?? stringField(summary.explorationMode);
  const contextRefs = agentHarnessContextRefs(contract);
  const directiveRefs = agentHarnessPromptDirectiveRefs(contract);
  const strategyRefs: AgentHarnessPromptRenderEntry[] = [];
  if (intentMode) {
    strategyRefs.push(agentHarnessPromptRenderEntry({
      id: 'intent-mode',
      sourceCallbackId: sourceCallbackIdForTraceField(input.trace, 'intentMode') ?? 'harness.defaults.intentMode',
      text: `intentMode=${intentMode}`,
    }));
  }
  if (explorationMode) {
    strategyRefs.push(agentHarnessPromptRenderEntry({
      id: 'exploration-mode',
      sourceCallbackId: sourceCallbackIdForTraceField(input.trace, 'explorationMode') ?? 'harness.defaults.explorationMode',
      text: `explorationMode=${explorationMode}`,
    }));
  }
  if (contextRefs.allowed.length || contextRefs.blocked.length || contextRefs.required.length) {
    strategyRefs.push(agentHarnessPromptRenderEntry({
      id: 'selected-context-refs',
      sourceCallbackId: sourceCallbackIdForTraceField(input.trace, 'contextRefs') ?? 'harness.input.contextRefs',
      text: [
        contextRefs.allowed.length ? `allowed=${contextRefs.allowed.join(',')}` : undefined,
        contextRefs.required.length ? `required=${contextRefs.required.join(',')}` : undefined,
        contextRefs.blocked.length ? `blocked=${contextRefs.blocked.join(',')}` : undefined,
      ].filter(Boolean).join(' '),
    }));
  }
  if (isRecord(contract?.repairContextPolicy)) {
    strategyRefs.push(agentHarnessPromptRenderEntry({
      id: 'repair-context-policy',
      sourceCallbackId: sourceCallbackIdForTraceField(input.trace, 'repairContextPolicy') ?? 'harness.defaults.repairContextPolicy',
      text: renderRepairContextPolicy(contract.repairContextPolicy),
    }));
  }
  const selectedContextRefs = [
    ...contextRefs.allowed.map((ref) => agentHarnessSelectedContextRef('allowed', ref, input.trace)),
    ...contextRefs.required.map((ref) => agentHarnessSelectedContextRef('required', ref, input.trace)),
    ...contextRefs.blocked.map((ref) => agentHarnessSelectedContextRef('blocked', ref, input.trace)),
  ];
  const renderedEntries = [
    ...strategyRefs,
    ...directiveRefs.map((directive): AgentHarnessPromptRenderEntry => ({ ...directive, kind: 'directive' })),
  ];
  const renderedLines = renderedEntries
    .map((entry) => `[${entry.sourceCallbackId}] ${entry.id}: ${entry.text ?? ''}`.trim())
    .filter(Boolean);
  const sourceRefs = {
    contractRef: stringField(summary.contractRef),
    traceRef: stringField(summary.traceRef),
  };
  return {
    schemaVersion: AGENT_HARNESS_PROMPT_RENDER_SCHEMA_VERSION,
    renderMode: 'metadata-scaffold',
    deterministic: true,
    sourceRefs,
    strategyRefs,
    directiveRefs,
    renderedEntries,
    selectedContextRefs,
    renderedText: renderedLines.join('\n'),
    renderDigest: hashJson({
      sourceRefs,
      strategyRefs,
      directiveRefs,
      renderedEntries,
      selectedContextRefs,
      renderedLines,
    }),
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

function agentHarnessContinuityDecisionAuditEnabled(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const harness = isRecord(uiState.agentHarness) ? uiState.agentHarness : isRecord(uiState.harness) ? uiState.harness : {};
  return [
    uiState.agentHarnessContinuityDecisionEnabled,
    uiState.agentHarnessContinuityAuditEnabled,
    uiState.agentHarnessTraceContinuityDecision,
    harness.continuityDecisionEnabled,
    harness.continuityAuditEnabled,
    harness.traceContinuityDecision,
  ].some(isEnabledFlag);
}

function agentHarnessBackendSelectionDecisionAuditEnabled(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const harness = isRecord(uiState.agentHarness) ? uiState.agentHarness : isRecord(uiState.harness) ? uiState.harness : {};
  return [
    uiState.agentHarnessBackendSelectionDecisionEnabled,
    uiState.agentHarnessBackendSelectionAuditEnabled,
    uiState.agentHarnessTraceBackendSelectionDecision,
    harness.backendSelectionDecisionEnabled,
    harness.backendSelectionAuditEnabled,
    harness.traceBackendSelectionDecision,
  ].some(isEnabledFlag);
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

function agentHarnessBackendSelectionDecision(
  request: GatewayRequest,
  input: {
    backendSelectionDecision?: AgentServerBackendSelectionDecision;
    llmEndpoint?: LlmEndpointConfig;
    agentHarness?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    trace?: Record<string, unknown>;
  },
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const agentHarness = input.agentHarness ?? (isRecord(uiState.agentHarness) ? uiState.agentHarness : {});
  const summary = input.summary ?? (isRecord(agentHarness.summary) ? agentHarness.summary : {});
  const trace = input.trace ?? (isRecord(agentHarness.trace) ? agentHarness.trace : undefined);
  const decision = input.backendSelectionDecision ?? agentServerBackendSelectionDecision(request, input.llmEndpoint);
  const contractRef = stringField(agentHarness.contractRef) ?? stringField(summary.contractRef);
  const traceRef = stringField(agentHarness.traceRef) ?? stringField(summary.traceRef);
  return {
    ...decision,
    harnessSignals: {
      profileId: stringField(agentHarness.profileId) ?? stringField(summary.profileId) ?? stringField(uiState.harnessProfileId),
      contractRef,
      traceRef,
      harnessStage: decision.harnessStage,
      sourceCallbackId: sourceCallbackIdForTraceStage(trace, decision.harnessStage) ?? 'harness.runtime.beforeAgentDispatch',
    },
    trace: {
      ...decision.trace,
      harness: {
        stage: decision.harnessStage,
        contractRef,
        traceRef,
      },
    },
  };
}

function agentHarnessVerificationPolicyProjection(
  contract: Record<string, unknown>,
  current: GatewayRequest['verificationPolicy'],
  input: {
    uiState: Record<string, unknown>;
    contractRef: string;
    profileId: string;
  },
): { policy: NonNullable<GatewayRequest['verificationPolicy']>; audit: Record<string, unknown> } | undefined {
  const agentHarness = isRecord(input.uiState.agentHarness) ? input.uiState.agentHarness : {};
  const enabled = [
    input.uiState.agentHarnessVerificationPolicyEnabled,
    input.uiState.agentHarnessConsumeVerificationPolicy,
    agentHarness.verificationPolicyEnabled,
    agentHarness.consumeVerificationPolicy,
  ].some(isEnabledFlag);
  if (!enabled) return undefined;
  const verificationPolicy = isRecord(contract.verificationPolicy) ? contract.verificationPolicy : undefined;
  if (!verificationPolicy) return undefined;
  const projected = runtimeVerificationPolicyFromHarness(verificationPolicy, input);
  const merged = mergeRuntimeVerificationPolicy(current, projected);
  return {
    policy: merged,
    audit: {
      schemaVersion: 'sciforge.runtime-verification-policy-projection.v1',
      source: 'request.uiState.agentHarness.contract.verificationPolicy',
      contractRef: input.contractRef,
      profileId: input.profileId,
      harnessIntensity: stringField(verificationPolicy.intensity),
      requireCitations: booleanField(verificationPolicy.requireCitations),
      requireCurrentRefs: booleanField(verificationPolicy.requireCurrentRefs),
      requireArtifactRefs: booleanField(verificationPolicy.requireArtifactRefs),
      mode: merged.mode,
      riskLevel: merged.riskLevel,
      required: merged.required,
    },
  };
}

function agentHarnessProgressPlanProjection(
  contract: Record<string, unknown>,
  input: {
    uiState: Record<string, unknown>;
    contractRef: string;
    traceRef: string;
    profileId: string;
  },
) {
  const agentHarness = isRecord(input.uiState.agentHarness) ? input.uiState.agentHarness : {};
  const enabled = [
    input.uiState.agentHarnessProgressPlanEnabled,
    input.uiState.agentHarnessConsumeProgressPlan,
    agentHarness.progressPlanEnabled,
    agentHarness.consumeProgressPlan,
  ].some(isEnabledFlag);
  if (!enabled) return undefined;
  const progressPlan = progressPlanFromContract(contract.progressPlan);
  if (!progressPlan) return undefined;
  const toolBudget = isRecord(contract.toolBudget) ? contract.toolBudget : {};
  const event = projectInteractionProgressEvent({
    progressPlan,
    type: 'process-progress',
    traceRef: input.traceRef,
    reason: 'progress-plan-projection',
    status: 'running',
    budget: {
      maxRetries: progressPlan.silencePolicy?.maxRetries,
      maxWallMs: numberField(toolBudget.maxWallMs),
    },
  });
  const audit = {
    schemaVersion: AGENT_HARNESS_PROGRESS_PLAN_PROJECTION_SCHEMA_VERSION,
    source: 'request.uiState.agentHarness.contract.progressPlan',
    contractRef: input.contractRef,
    traceRef: input.traceRef,
    profileId: input.profileId,
    eventType: event.type,
    phase: event.phase,
    status: event.status,
    initialStatus: progressPlan.initialStatus,
    visibleMilestones: progressPlan.visibleMilestones,
    phaseNames: progressPlan.phaseNames,
    silenceTimeoutMs: progressPlan.silenceTimeoutMs,
    silenceDecision: progressPlan.silencePolicy?.decision,
    backgroundContinuation: progressPlan.backgroundContinuation,
  };
  return {
    event: {
      type: event.type,
      source: 'workspace-runtime',
      status: event.status,
      message: progressPlan.initialStatus,
      detail: event.phase,
      raw: {
        ...event,
        progressPlan,
        agentHarnessProgressPlan: audit,
      },
    },
    audit,
  };
}

function runtimeVerificationPolicyFromHarness(
  policy: Record<string, unknown>,
  input: { contractRef: string; profileId: string },
): NonNullable<GatewayRequest['verificationPolicy']> {
  const intensity = stringField(policy.intensity);
  const requireCurrentRefs = booleanField(policy.requireCurrentRefs) ?? false;
  const requireArtifactRefs = booleanField(policy.requireArtifactRefs) ?? false;
  const requireCitations = booleanField(policy.requireCitations) ?? false;
  const strictEvidence = requireCurrentRefs || requireArtifactRefs || requireCitations;
  const mapped = verificationModeForHarnessIntensity(intensity, strictEvidence);
  return {
    required: mapped.mode !== 'none',
    mode: mapped.mode,
    riskLevel: mapped.riskLevel,
    reason: `contractRef=${input.contractRef}; profileId=${input.profileId}; intensity=${intensity ?? 'standard'}`,
  };
}

function mergeRuntimeVerificationPolicy(
  current: GatewayRequest['verificationPolicy'],
  projected: NonNullable<GatewayRequest['verificationPolicy']>,
): NonNullable<GatewayRequest['verificationPolicy']> {
  if (!current) return projected;
  const mode = stricterVerificationMode(current.mode, projected.mode);
  const riskLevel = stricterRiskLevel(current.riskLevel, projected.riskLevel);
  return {
    ...current,
    required: current.required || projected.required,
    mode,
    riskLevel,
    reason: current.reason
      ? `${current.reason} Harness policy consumed: ${projected.reason}`
      : projected.reason,
    selectedVerifierIds: sortedUnique([
      ...(current.selectedVerifierIds ?? []),
      ...(projected.selectedVerifierIds ?? []),
    ]),
    humanApprovalPolicy: current.humanApprovalPolicy ?? projected.humanApprovalPolicy,
    unverifiedReason: current.unverifiedReason ?? projected.unverifiedReason,
  };
}

function verificationModeForHarnessIntensity(
  intensity: string | undefined,
  strictEvidence: boolean,
): Pick<NonNullable<GatewayRequest['verificationPolicy']>, 'mode' | 'riskLevel'> {
  if (intensity === 'none') return { mode: 'none', riskLevel: 'low' };
  if (intensity === 'light') return { mode: 'lightweight', riskLevel: strictEvidence ? 'medium' : 'low' };
  if (intensity === 'strict' || intensity === 'audit') return { mode: 'hybrid', riskLevel: 'high' };
  return { mode: 'automatic', riskLevel: strictEvidence ? 'high' : 'medium' };
}

function stricterVerificationMode(
  left: NonNullable<GatewayRequest['verificationPolicy']>['mode'],
  right: NonNullable<GatewayRequest['verificationPolicy']>['mode'],
) {
  const rank = { none: 0, unverified: 1, lightweight: 2, automatic: 3, human: 4, hybrid: 5 } as const;
  return rank[right] > rank[left] ? right : left;
}

function stricterRiskLevel(
  left: NonNullable<GatewayRequest['verificationPolicy']>['riskLevel'],
  right: NonNullable<GatewayRequest['verificationPolicy']>['riskLevel'],
) {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[right] > rank[left] ? right : left;
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
    .flatMap((directive) => {
      const id = stringField(directive.id);
      const sourceCallbackId = stringField(directive.sourceCallbackId);
      const text = stringField(directive.text);
      if (!id || !sourceCallbackId || !text) return [];
      return [{
        id,
        sourceCallbackId,
        priority: numberField(directive.priority),
        text,
      }];
    });
}

function agentHarnessPromptRenderEntry(input: {
  id: string;
  sourceCallbackId: string;
  text: string;
}): AgentHarnessPromptRenderEntry {
  return {
    kind: 'strategy',
    id: input.id,
    sourceCallbackId: input.sourceCallbackId,
    text: input.text,
  };
}

function agentHarnessSelectedContextRef(kind: 'allowed' | 'blocked' | 'required', ref: string, trace?: Record<string, unknown>) {
  const field = kind === 'blocked' ? 'blockedContextRefs' : kind === 'required' ? 'requiredContextRefs' : 'allowedContextRefs';
  return {
    kind,
    ref,
    sourceCallbackId: sourceCallbackIdForTraceField(trace, field) ?? `harness.input.${field}`,
  };
}

function renderRepairContextPolicy(policy: Record<string, unknown>) {
  return [
    stringField(policy.kind) ? `kind=${stringField(policy.kind)}` : undefined,
    typeof policy.maxAttempts === 'number' ? `maxAttempts=${policy.maxAttempts}` : undefined,
    typeof policy.includeStdoutSummary === 'boolean' ? `includeStdoutSummary=${policy.includeStdoutSummary}` : undefined,
    typeof policy.includeStderrSummary === 'boolean' ? `includeStderrSummary=${policy.includeStderrSummary}` : undefined,
  ].filter(Boolean).join(' ');
}

function sourceCallbackIdForTraceField(trace: Record<string, unknown> | undefined, field: string) {
  const stages = Array.isArray(trace?.stages) ? trace.stages.filter(isRecord) : [];
  for (const stage of [...stages].reverse()) {
    const callbackId = stringField(stage.callbackId);
    if (!callbackId) continue;
    const decision = isRecord(stage.decision) ? stage.decision : {};
    const intentSignals = isRecord(decision.intentSignals) ? decision.intentSignals : {};
    const contextHints = isRecord(decision.contextHints) ? decision.contextHints : {};
    const repair = isRecord(decision.repair) ? decision.repair : {};
    if (field === 'intentMode' && stringField(intentSignals.intentMode)) return callbackId;
    if (field === 'explorationMode' && stringField(intentSignals.explorationMode)) return callbackId;
    if (field === 'repairContextPolicy' && Object.keys(repair).length) return callbackId;
    if ((field === 'contextRefs' || field === 'allowedContextRefs') && Array.isArray(contextHints.allowedContextRefs)) return callbackId;
    if ((field === 'contextRefs' || field === 'requiredContextRefs') && Array.isArray(contextHints.requiredContextRefs)) return callbackId;
    if ((field === 'contextRefs' || field === 'blockedContextRefs') && (Array.isArray(contextHints.blockedContextRefs) || Array.isArray(decision.blockedRefs))) {
      return callbackId;
    }
  }
  return undefined;
}

function sourceCallbackIdForTraceStage(trace: Record<string, unknown> | undefined, expectedStage: string) {
  const stages = Array.isArray(trace?.stages) ? trace.stages.filter(isRecord) : [];
  for (const stage of [...stages].reverse()) {
    if (stringField(stage.stage) !== expectedStage) continue;
    const callbackId = stringField(stage.callbackId);
    if (callbackId) return callbackId;
  }
  return undefined;
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

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function progressPlanFromContract(value: unknown): ProgressPlan | undefined {
  if (!isRecord(value)) return undefined;
  const initialStatus = stringField(value.initialStatus);
  const silenceTimeoutMs = numberField(value.silenceTimeoutMs);
  const backgroundContinuation = booleanField(value.backgroundContinuation);
  if (!initialStatus || silenceTimeoutMs === undefined || backgroundContinuation === undefined) return undefined;
  const phaseNames = orderedStringListField(value.phaseNames);
  return {
    initialStatus,
    visibleMilestones: orderedStringListField(value.visibleMilestones),
    phaseNames: phaseNames.length ? phaseNames : undefined,
    silenceTimeoutMs,
    backgroundContinuation,
    silencePolicy: isRecord(value.silencePolicy) ? value.silencePolicy as unknown as ProgressPlan['silencePolicy'] : undefined,
    backgroundPolicy: isRecord(value.backgroundPolicy) ? value.backgroundPolicy as unknown as ProgressPlan['backgroundPolicy'] : undefined,
    cancelPolicy: isRecord(value.cancelPolicy) ? value.cancelPolicy as unknown as ProgressPlan['cancelPolicy'] : undefined,
    interactionPolicy: isRecord(value.interactionPolicy) ? value.interactionPolicy as unknown as ProgressPlan['interactionPolicy'] : undefined,
  };
}

function isEnabledFlag(value: unknown) {
  return value === true || ['1', 'true', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}

function stringListField(value: unknown) {
  return Array.isArray(value)
    ? sortedUnique(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))
    : [];
}

function orderedStringListField(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sortedUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
