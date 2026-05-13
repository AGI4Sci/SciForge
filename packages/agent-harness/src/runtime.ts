import type {
  BudgetExhaustedPolicy,
  CapabilityBudget,
  CapabilityEscalationStep,
  CapabilityEscalationTier,
  ConversationAuditHydration,
  ConversationEvidenceMode,
  ConversationPlan,
  HarnessCallback,
  HarnessContract,
  HarnessContext,
  HarnessDecision,
  HarnessEvaluation,
  HarnessInput,
  HarnessMergeConflict,
  HarnessProfile,
  HarnessRuntime,
  HarnessStage,
  HarnessStagePathKind,
  HarnessTrace,
  LatencyTier,
  PresentationPlan,
  ProgressDecision,
  PromptDirective,
  RepairContextPolicy,
  RepairStopCondition,
  SideEffectAllowance,
  VerificationIntensity,
  VerificationLayer,
  VerificationPolicy,
} from './contracts';
import { getHarnessProfile, getLatencyTierPolicy } from './profiles';

export const HARNESS_CRITICAL_PATH_STAGES: readonly HarnessStage[] = [
  'classifyIntent',
  'selectContext',
  'setExplorationBudget',
  'selectCapabilities',
  'onToolPolicy',
  'onBudgetAllocate',
  'beforePromptRender',
  'beforeResultPresentation',
  'beforeUserProgressEvent',
];

export const HARNESS_AUDIT_PATH_STAGES: readonly HarnessStage[] = [
  'beforeResultValidation',
  'onRepairRequired',
];

export const HARNESS_EVALUATION_STAGES: readonly HarnessStage[] = [
  'classifyIntent',
  'selectContext',
  'setExplorationBudget',
  'selectCapabilities',
  'onToolPolicy',
  'onBudgetAllocate',
  'beforePromptRender',
  'beforeResultValidation',
  'beforeResultPresentation',
  'onRepairRequired',
  'beforeUserProgressEvent',
];

export const HARNESS_EXTERNAL_HOOK_STAGES: readonly HarnessStage[] = [
  'onRequestReceived',
  'onRequestNormalized',
  'selectProfile',
  'onRegistryBuild',
  'onBeforeCapabilityBroker',
  'onAfterCapabilityBroker',
  'beforeAgentDispatch',
  'onAgentDispatched',
  'onAgentStreamEvent',
  'onStreamGuardTrip',
  'beforeToolCall',
  'afterToolCall',
  'onObserveStart',
  'onActionStepEnd',
  'afterResultValidation',
  'beforeRepairDispatch',
  'afterRepairAttempt',
  'onInteractionRequested',
  'onBackgroundContinuation',
  'onCancelRequested',
  'onPolicyDecision',
  'onBudgetDebit',
  'onVerifierVerdict',
  'onAuditRecord',
  'onRunCompleted',
  'onRunFailed',
  'onRunCancelled',
];

export const HARNESS_ALL_STAGES: readonly HarnessStage[] = [
  ...HARNESS_EVALUATION_STAGES,
  ...HARNESS_EXTERNAL_HOOK_STAGES,
];

export const HARNESS_STAGE_PATH_KIND: Readonly<Record<HarnessStage, HarnessStagePathKind>> = Object.freeze(
  Object.fromEntries([
    ...HARNESS_CRITICAL_PATH_STAGES.map((stage) => [stage, 'critical'] as const),
    ...HARNESS_AUDIT_PATH_STAGES.map((stage) => [stage, 'audit'] as const),
    ...HARNESS_EXTERNAL_HOOK_STAGES.map((stage) => [stage, 'external'] as const),
  ]),
) as Readonly<Record<HarnessStage, HarnessStagePathKind>>;

export function getHarnessStagePathKind(stage: HarnessStage): HarnessStagePathKind {
  return HARNESS_STAGE_PATH_KIND[stage];
}

export interface CreateHarnessRuntimeOptions {
  profiles?: Record<string, HarnessProfile>;
  defaultProfileId?: string;
  traceIdFactory?: (input: HarnessInput) => string;
}

export function createHarnessRuntime(options: CreateHarnessRuntimeOptions = {}): HarnessRuntime {
  return new DefaultHarnessRuntime(options);
}

export async function evaluateHarness(input: HarnessInput, options?: CreateHarnessRuntimeOptions): Promise<HarnessEvaluation> {
  return createHarnessRuntime(options).evaluate(input);
}

class DefaultHarnessRuntime implements HarnessRuntime {
  constructor(private readonly options: CreateHarnessRuntimeOptions) {}

  async evaluate(input: HarnessInput): Promise<HarnessEvaluation> {
    const profile = this.resolveProfile(input.profileId);
    let contract = contractFromDefaults(profile, input);
    const trace: HarnessTrace = {
      schemaVersion: 'sciforge.agent-harness-trace.v1',
      traceId: this.options.traceIdFactory?.(input) ?? stableTraceId(input, profile.id),
      requestId: input.requestId,
      profileId: profile.id,
      latencyTier: contract.latencyTier,
      stages: [],
      auditHooks: [],
      conflicts: [],
      auditNotes: [stageCoverageAuditNote(), profileSelectionAuditNote(profile, contract)],
    };
    contract = { ...contract, traceRef: trace.traceId };
    const evaluationMode = resolveEvaluationMode(input);

    for (const stage of HARNESS_EVALUATION_STAGES) {
      const pathKind = getHarnessStagePathKind(stage);
      const callbacks = profile.callbacks.filter((callback) => callback.stages.includes(stage));
      if (evaluationMode === 'criticalPathOnly' && pathKind === 'audit') {
        if (callbacks.length === 0) {
          trace.auditHooks.push({
            stage,
            status: 'skipped',
            reason: 'criticalPathOnly mode omits audit stage with no registered callbacks',
          });
        } else {
          for (const callback of callbacks) {
            trace.auditHooks.push({
              stage,
              callbackId: callback.id,
              status: 'deferred',
              reason: 'criticalPathOnly mode defers audit hook until post-result materialization',
            });
          }
        }
        continue;
      }
      if (pathKind === 'audit' && callbacks.length === 0) {
        trace.auditHooks.push({
          stage,
          status: 'skipped',
          reason: 'full evaluation had no registered audit callbacks for this stage',
        });
      }
      for (const callback of callbacks) {
        const context: HarnessContext = { input, profile, stage, contract, trace };
        const decision = normalizeDecision(await callback.decide(context), callback.id);
        const result = mergeDecision(contract, decision, {
          profile,
          stage,
          callbackId: callback.id,
          humanApprovalSatisfied: input.humanApprovalSatisfied === true,
        });
        contract = result.contract;
        trace.latencyTier = contract.latencyTier;
        trace.conflicts.push(...result.conflicts);
        trace.auditNotes.push(...decision.auditNotes ?? []);
        trace.stages.push({
          stage,
          pathKind,
          callbackId: callback.id,
          ...(pathKind === 'audit' ? { auditStatus: 'completed' as const } : {}),
          decision,
          contractSnapshot: cloneContract(contract),
        });
        if (pathKind === 'audit') {
          trace.auditHooks.push({
            stage,
            callbackId: callback.id,
            status: 'completed',
            reason: 'audit hook completed during full evaluation',
          });
        }
      }
    }

    return { contract: normalizeContract(contract), trace };
  }

  async dispatchHook(stage: HarnessStage, context: HarnessContext): Promise<HarnessDecision> {
    const callbacks = context.profile.callbacks.filter((callback) => callback.stages.includes(stage));
    let merged: HarnessDecision = {};
    for (const callback of callbacks) {
      merged = mergeRawDecision(merged, normalizeDecision(await callback.decide(context), callback.id));
    }
    return merged;
  }

  private resolveProfile(profileId?: string): HarnessProfile {
    if (profileId && this.options.profiles?.[profileId]) return this.options.profiles[profileId];
    if (this.options.defaultProfileId && this.options.profiles?.[this.options.defaultProfileId]) {
      return this.options.profiles[this.options.defaultProfileId];
    }
    return getHarnessProfile(profileId ?? this.options.defaultProfileId ?? 'balanced-default');
  }
}

function stageCoverageAuditNote() {
  return {
    sourceCallbackId: 'harness-runtime.stage-coverage',
    severity: 'info' as const,
    message: [
      `evaluate=${HARNESS_EVALUATION_STAGES.join(',')}`,
      `critical=${HARNESS_CRITICAL_PATH_STAGES.join(',')}`,
      `audit=${HARNESS_AUDIT_PATH_STAGES.join(',')}`,
      `external-hooks=${HARNESS_EXTERNAL_HOOK_STAGES.join(',')}`,
    ].join('; '),
  };
}

function profileSelectionAuditNote(profile: HarnessProfile, contract: HarnessContract) {
  const deeperProfileReason = contract.latencyTier === 'deep' || contract.latencyTier === 'background'
    ? 'deep-capable profile/tier is active because the request or profile explicitly requires depth'
    : 'deeper profiles were not selected by default; the current tier favors fast-first response with explicit upgrade paths';
  return {
    sourceCallbackId: 'harness-runtime.profile-selection',
    severity: 'info' as const,
    message: `profile=${profile.id}; latencyTier=${contract.latencyTier}; moduleStack=${profile.moduleStack?.join(',') ?? 'callbacks-only'}; ${deeperProfileReason}`,
  };
}

function resolveEvaluationMode(input: HarnessInput): NonNullable<HarnessInput['evaluationMode']> {
  if (input.evaluationMode) return input.evaluationMode;
  const runtimeEvaluationMode = input.runtimeConfig?.evaluationMode;
  if (runtimeEvaluationMode === 'full' || runtimeEvaluationMode === 'criticalPathOnly') return runtimeEvaluationMode;
  const latencyTier = input.latencyTier ?? input.runtimeConfig?.latencyTier;
  if (latencyTier === 'instant' || latencyTier === 'quick') return 'criticalPathOnly';
  return 'full';
}

type MergeContext = {
  profile: HarnessProfile;
  stage: HarnessStage;
  callbackId: string;
  humanApprovalSatisfied: boolean;
};

function contractFromDefaults(profile: HarnessProfile, input: HarnessInput): HarnessContract {
  const defaults = profile.defaults;
  const base: HarnessContract = {
    schemaVersion: 'sciforge.agent-harness-contract.v1',
    profileId: profile.id,
    latencyTier: input.latencyTier ?? defaults.latencyTier ?? 'quick',
    intentMode: input.intentMode ?? defaults.intentMode,
    explorationMode: defaults.explorationMode,
    allowedContextRefs: sortedUnique([...(input.contextRefs ?? []), ...defaults.allowedContextRefs]),
    blockedContextRefs: sortedUnique([...(input.blockedContextRefs ?? []), ...defaults.blockedContextRefs]),
    requiredContextRefs: sortedUnique([...(input.requiredContextRefs ?? []), ...defaults.requiredContextRefs]),
    contextBudget: { ...defaults.contextBudget, ...tightenContextBudget(defaults.contextBudget, input.budgetOverrides?.contextBudget) },
    capabilityPolicy: {
      candidates: sortCandidates([...(input.candidateCapabilities ?? []), ...defaults.capabilityPolicy.candidates]),
      preferredCapabilityIds: sortedUnique(defaults.capabilityPolicy.preferredCapabilityIds),
      blockedCapabilities: sortedUnique(defaults.capabilityPolicy.blockedCapabilities),
      sideEffects: { ...defaults.capabilityPolicy.sideEffects },
      escalationPlan: sortEscalationPlan(defaults.capabilityPolicy.escalationPlan),
      candidateTiers: normalizeCandidateTiers(defaults.capabilityPolicy.candidateTiers),
    },
    toolBudget: { ...defaults.toolBudget, ...tightenToolBudget(defaults.toolBudget, input.budgetOverrides?.toolBudget) },
    verificationPolicy: { ...defaults.verificationPolicy },
    repairContextPolicy: { ...defaults.repairContextPolicy },
    progressPlan: cloneProgressPlan(defaults.progressPlan),
    conversationPlan: cloneConversationPlan(defaults.conversationPlan ?? baseConversationPlan()),
    presentationPlan: clonePresentationPlan(defaults.presentationPlan ?? basePresentationPlan()),
    promptDirectives: sortPromptDirectives(defaults.promptDirectives),
  };
  return normalizeContract(input.latencyTier ? applyLatencyTierPolicy(base, input.latencyTier) : base);
}

function mergeDecision(contract: HarnessContract, decision: HarnessDecision, context: MergeContext): {
  contract: HarnessContract;
  conflicts: HarnessMergeConflict[];
} {
  let next = cloneContract(contract);
  const conflicts: HarnessMergeConflict[] = [];

  if (decision.intentSignals?.intentMode) next.intentMode = decision.intentSignals.intentMode;
  if (decision.latencyTier || decision.intentSignals?.latencyTier) {
    next = applyLatencyTierPolicy(next, decision.latencyTier ?? decision.intentSignals?.latencyTier ?? next.latencyTier);
  }
  if (decision.intentSignals?.explorationMode) {
    const chosen = escalateExploration(next.explorationMode, decision.intentSignals.explorationMode);
    if (chosen !== decision.intentSignals.explorationMode) {
      conflicts.push(conflict('explorationMode', next.explorationMode, decision.intentSignals.explorationMode, chosen, 'exploration only escalates', context));
    }
    next.explorationMode = chosen;
  }

  next.allowedContextRefs = sortedUnique([...next.allowedContextRefs, ...(decision.contextHints?.allowedContextRefs ?? [])]);
  next.blockedContextRefs = sortedUnique([...next.blockedContextRefs, ...(decision.blockedRefs ?? []), ...(decision.contextHints?.blockedContextRefs ?? [])]);
  next.requiredContextRefs = sortedUnique([...next.requiredContextRefs, ...(decision.contextHints?.requiredContextRefs ?? [])]);

  if (decision.contextHints?.contextBudget) {
    next.contextBudget = tightenContextBudget(next.contextBudget, decision.contextHints.contextBudget);
  }
  if (decision.budgets?.contextBudget) {
    next.contextBudget = context.profile.mergePolicy.allowBudgetWidening
      ? mergeContextBudget(next.contextBudget, decision.budgets.contextBudget)
      : tightenContextBudget(next.contextBudget, decision.budgets.contextBudget);
  }
  if (decision.budgets?.toolBudget) {
    next.toolBudget = context.profile.mergePolicy.allowBudgetWidening
      ? mergeToolBudget(next.toolBudget, decision.budgets.toolBudget)
      : tightenToolBudget(next.toolBudget, decision.budgets.toolBudget);
  }

  next.capabilityPolicy.blockedCapabilities = sortedUnique([
    ...next.capabilityPolicy.blockedCapabilities,
    ...(decision.blockedCapabilities ?? []),
    ...(decision.capabilityHints?.blockedCapabilities ?? []),
  ]);
  next.capabilityPolicy.preferredCapabilityIds = sortedUnique([
    ...next.capabilityPolicy.preferredCapabilityIds,
    ...(decision.capabilityHints?.preferredCapabilityIds ?? []),
  ]);
  next.capabilityPolicy.candidates = sortCandidates([
    ...next.capabilityPolicy.candidates,
    ...(decision.capabilityHints?.candidates ?? []),
  ]);
  if (decision.capabilityHints?.escalationPlan) {
    next.capabilityPolicy.escalationPlan = sortEscalationPlan([
      ...(next.capabilityPolicy.escalationPlan ?? []),
      ...decision.capabilityHints.escalationPlan,
    ]);
  }
  if (decision.capabilityHints?.candidateTiers) {
    next.capabilityPolicy.candidateTiers = mergeCandidateTiers(
      next.capabilityPolicy.candidateTiers,
      decision.capabilityHints.candidateTiers,
    );
  }

  if (decision.capabilityHints?.sideEffects) {
    for (const key of Object.keys(decision.capabilityHints.sideEffects) as Array<keyof typeof decision.capabilityHints.sideEffects>) {
      const incoming = decision.capabilityHints.sideEffects[key];
      if (!incoming) continue;
      const previous = next.capabilityPolicy.sideEffects[key];
      const chosen = mergeSideEffect(previous, incoming, context);
      if (chosen !== incoming) {
        conflicts.push(conflict(`capabilityPolicy.sideEffects.${key}`, previous, incoming, chosen, 'side effects fail closed', context));
      }
      next.capabilityPolicy.sideEffects[key] = chosen;
    }
  }

  if (decision.verification) {
    next.verificationPolicy = mergeVerification(next.verificationPolicy, decision.verification, context, conflicts);
  }
  if (decision.repair) next.repairContextPolicy = mergeRepair(next.repairContextPolicy, decision.repair);
  if (decision.progress) next.progressPlan = mergeProgress(next.progressPlan, decision.progress);
  if (decision.conversationPlan) next.conversationPlan = mergeConversationPlan(next.conversationPlan, decision.conversationPlan, context, conflicts);
  if (decision.presentation) next.presentationPlan = mergePresentation(next.presentationPlan, decision.presentation);
  if (decision.promptDirectives) {
    next.promptDirectives = sortPromptDirectives([...next.promptDirectives, ...decision.promptDirectives]);
  }

  next = normalizeContract(next);
  return { contract: next, conflicts };
}

function normalizeDecision(decision: HarnessDecision, callbackId: string): HarnessDecision {
  return {
    ...decision,
    promptDirectives: decision.promptDirectives?.map((directive) => ({
      ...directive,
      sourceCallbackId: directive.sourceCallbackId || callbackId,
    })),
    auditNotes: decision.auditNotes?.map((note) => ({
      ...note,
      sourceCallbackId: note.sourceCallbackId || callbackId,
    })),
  };
}

function mergeRawDecision(left: HarnessDecision, right: HarnessDecision): HarnessDecision {
  const selectedVerifierIds = sortedUnique([
    ...(left.verification?.selectedVerifierIds ?? []),
    ...(right.verification?.selectedVerifierIds ?? []),
  ]);
  const verification = left.verification || right.verification
    ? {
      ...left.verification,
      ...right.verification,
      verificationLayers: orderedVerificationLayers([
        ...(left.verification?.verificationLayers ?? []),
        ...(right.verification?.verificationLayers ?? []),
      ]),
      ...(selectedVerifierIds.length > 0 ? { selectedVerifierIds } : {}),
    }
    : undefined;
  const conversationPlan = left.conversationPlan || right.conversationPlan
    ? mergeConversationPlan(
      left.conversationPlan ? mergeConversationPlan(baseConversationPlan(), left.conversationPlan) : baseConversationPlan(),
      right.conversationPlan ?? {},
    )
    : undefined;

  return {
    ...left,
    ...right,
    ...(verification ? { verification } : {}),
    ...(conversationPlan ? { conversationPlan } : {}),
    presentation: left.presentation || right.presentation
      ? mergePresentation(basePresentationPlan(), { ...left.presentation, ...right.presentation })
      : undefined,
    blockedRefs: sortedUnique([...(left.blockedRefs ?? []), ...(right.blockedRefs ?? [])]),
    blockedCapabilities: sortedUnique([...(left.blockedCapabilities ?? []), ...(right.blockedCapabilities ?? [])]),
    promptDirectives: sortPromptDirectives([...(left.promptDirectives ?? []), ...(right.promptDirectives ?? [])]),
    auditNotes: [...(left.auditNotes ?? []), ...(right.auditNotes ?? [])],
  };
}

function tightenContextBudget(current: HarnessContract['contextBudget'], incoming?: Partial<HarnessContract['contextBudget']>) {
  if (!incoming) return { ...current };
  return {
    maxPromptTokens: minDefined(current.maxPromptTokens, incoming.maxPromptTokens),
    maxHistoryTurns: minDefined(current.maxHistoryTurns, incoming.maxHistoryTurns),
    maxReferenceDigests: minDefined(current.maxReferenceDigests, incoming.maxReferenceDigests),
    maxFullTextRefs: minDefined(current.maxFullTextRefs, incoming.maxFullTextRefs),
  };
}

function mergeContextBudget(current: HarnessContract['contextBudget'], incoming: Partial<HarnessContract['contextBudget']>) {
  return {
    maxPromptTokens: incoming.maxPromptTokens ?? current.maxPromptTokens,
    maxHistoryTurns: incoming.maxHistoryTurns ?? current.maxHistoryTurns,
    maxReferenceDigests: incoming.maxReferenceDigests ?? current.maxReferenceDigests,
    maxFullTextRefs: incoming.maxFullTextRefs ?? current.maxFullTextRefs,
  };
}

function tightenToolBudget(current: CapabilityBudget, incoming?: Partial<CapabilityBudget>) {
  if (!incoming) return { ...current };
  return {
    maxWallMs: minDefined(current.maxWallMs ?? Number.MAX_SAFE_INTEGER, incoming.maxWallMs),
    maxContextTokens: minDefined(current.maxContextTokens, incoming.maxContextTokens),
    maxToolCalls: minDefined(current.maxToolCalls, incoming.maxToolCalls),
    maxObserveCalls: minDefined(current.maxObserveCalls, incoming.maxObserveCalls),
    maxActionSteps: minDefined(current.maxActionSteps, incoming.maxActionSteps),
    maxNetworkCalls: minDefined(current.maxNetworkCalls, incoming.maxNetworkCalls),
    maxDownloadBytes: minDefined(current.maxDownloadBytes, incoming.maxDownloadBytes),
    maxResultItems: minDefined(current.maxResultItems, incoming.maxResultItems),
    maxProviders: minDefined(current.maxProviders, incoming.maxProviders),
    maxRetries: minDefined(current.maxRetries, incoming.maxRetries),
    perProviderTimeoutMs: minDefined(current.perProviderTimeoutMs, incoming.perProviderTimeoutMs),
    costUnits: minDefined(current.costUnits, incoming.costUnits),
    exhaustedPolicy: conservativeExhaustedPolicy(current.exhaustedPolicy, incoming.exhaustedPolicy),
  };
}

function mergeToolBudget(current: CapabilityBudget, incoming: Partial<CapabilityBudget>) {
  return { ...current, ...incoming, exhaustedPolicy: incoming.exhaustedPolicy ?? current.exhaustedPolicy };
}

function mergeVerification(
  current: VerificationPolicy,
  incoming: Partial<VerificationPolicy>,
  context: MergeContext,
  conflicts: HarnessMergeConflict[],
): VerificationPolicy {
  const allowDowngrade = context.profile.mergePolicy.allowVerificationDowngradeWithHumanApproval && context.humanApprovalSatisfied;
  const intensity = incoming.intensity
    ? (allowDowngrade ? incoming.intensity : escalateVerification(current.intensity, incoming.intensity))
    : current.intensity;
  if (incoming.intensity && intensity !== incoming.intensity) {
    conflicts.push(conflict('verificationPolicy.intensity', current.intensity, incoming.intensity, intensity, 'verification only escalates without human approval', context));
  }
  const selectedVerifierIds = sortedUnique([
    ...(current.selectedVerifierIds ?? []),
    ...(incoming.selectedVerifierIds ?? []),
  ]);
  const incomingLayers = incoming.verificationLayers ?? (incoming.intensity ? verificationLayersForIntensity(incoming.intensity) : undefined);
  const currentLayers = current.verificationLayers ?? verificationLayersForIntensity(current.intensity);
  const verificationLayers = incomingLayers
    ? (allowDowngrade ? orderedVerificationLayers(incomingLayers) : orderedVerificationLayers([...currentLayers, ...incomingLayers]))
    : orderedVerificationLayers(currentLayers);
  if (incomingLayers && !allowDowngrade) {
    const missing = currentLayers.filter((layer) => !verificationLayers.includes(layer));
    if (missing.length > 0) {
      conflicts.push(conflict('verificationPolicy.verificationLayers', currentLayers, incomingLayers, verificationLayers, 'verification layers only escalate without human approval', context));
    }
  }
  return {
    intensity,
    verificationLayers,
    requireCitations: current.requireCitations || incoming.requireCitations === true,
    requireCurrentRefs: current.requireCurrentRefs || incoming.requireCurrentRefs === true,
    requireArtifactRefs: current.requireArtifactRefs || incoming.requireArtifactRefs === true,
    ...(selectedVerifierIds.length > 0 ? { selectedVerifierIds } : {}),
  };
}

function mergeRepair(current: RepairContextPolicy, incoming: Partial<RepairContextPolicy>): RepairContextPolicy {
  return {
    kind: incoming.kind ?? current.kind,
    maxAttempts: Math.max(current.maxAttempts, incoming.maxAttempts ?? current.maxAttempts),
    includeStdoutSummary: current.includeStdoutSummary || incoming.includeStdoutSummary === true,
    includeStderrSummary: current.includeStderrSummary || incoming.includeStderrSummary === true,
    maxWallMs: minDefined(current.maxWallMs ?? Number.MAX_SAFE_INTEGER, incoming.maxWallMs),
    cheapOnly: current.cheapOnly && incoming.cheapOnly !== false,
    partialFirst: current.partialFirst || incoming.partialFirst === true,
    materializePartialOnFailure: current.materializePartialOnFailure || incoming.materializePartialOnFailure === true,
    checkpointArtifacts: current.checkpointArtifacts || incoming.checkpointArtifacts === true,
    stopOnRepeatedFailure: current.stopOnRepeatedFailure || incoming.stopOnRepeatedFailure === true,
    tierBudgets: mergeRepairTierBudgets(current.tierBudgets ?? {}, incoming.tierBudgets ?? {}),
    stopConditions: orderedRepairStopConditions([...(current.stopConditions ?? []), ...(incoming.stopConditions ?? [])]),
  };
}

function mergeProgress(current: HarnessContract['progressPlan'], incoming: ProgressDecision): HarnessContract['progressPlan'] {
  const baseSilencePolicy = current.silencePolicy ?? {
    timeoutMs: current.silenceTimeoutMs,
    decision: 'visible-status' as const,
    status: current.initialStatus,
    maxRetries: 0,
    auditRequired: true,
  };
  const baseBackgroundPolicy = current.backgroundPolicy ?? {
    enabled: current.backgroundContinuation,
    status: 'Continuing in background',
    notifyOnCompletion: true,
  };
  const baseCancelPolicy = current.cancelPolicy ?? {
    allowUserCancel: true,
    userCancellation: 'user-cancelled' as const,
    systemAbort: 'system-aborted' as const,
    timeout: 'timeout' as const,
    backendError: 'backend-error' as const,
  };
  const baseInteractionPolicy = current.interactionPolicy ?? {
    clarification: 'allow' as const,
    humanApproval: 'allow' as const,
    guidanceQueue: 'allow' as const,
  };
  const incomingSilencePolicy = incoming.silencePolicy ?? {};
  const incomingBackgroundPolicy = incoming.backgroundPolicy ?? {};
  const incomingCancelPolicy = incoming.cancelPolicy ?? {};
  const incomingInteractionPolicy = incoming.interactionPolicy ?? {};

  return {
    initialStatus: incoming.initialStatus ?? current.initialStatus,
    visibleMilestones: sortedUnique([...current.visibleMilestones, ...(incoming.visibleMilestones ?? [])]),
    phaseNames: orderedUnique([...(current.phaseNames ?? current.visibleMilestones), ...(incoming.phaseNames ?? incoming.visibleMilestones ?? [])]),
    firstResultDeadlineMs: minDefined(current.firstResultDeadlineMs ?? current.silenceTimeoutMs, incoming.firstResultDeadlineMs),
    phaseDeadlines: mergePhaseDeadlines(current.phaseDeadlines, incoming.phaseDeadlines),
    backgroundAfterMs: minDefined(current.backgroundAfterMs ?? current.silenceTimeoutMs, incoming.backgroundAfterMs),
    silenceTimeoutMs: minDefined(current.silenceTimeoutMs, incoming.silenceTimeoutMs),
    backgroundContinuation: current.backgroundContinuation || incoming.backgroundContinuation === true,
    silencePolicy: {
      timeoutMs: minDefined(baseSilencePolicy.timeoutMs, incoming.silencePolicy?.timeoutMs),
      decision: incomingSilencePolicy.decision ?? baseSilencePolicy.decision,
      status: incomingSilencePolicy.status ?? baseSilencePolicy.status,
      maxRetries: incomingSilencePolicy.maxRetries ?? baseSilencePolicy.maxRetries,
      auditRequired: incomingSilencePolicy.auditRequired ?? baseSilencePolicy.auditRequired,
    },
    backgroundPolicy: {
      enabled: incomingBackgroundPolicy.enabled ?? baseBackgroundPolicy.enabled,
      status: incomingBackgroundPolicy.status ?? baseBackgroundPolicy.status,
      notifyOnCompletion: incomingBackgroundPolicy.notifyOnCompletion ?? baseBackgroundPolicy.notifyOnCompletion,
    },
    cancelPolicy: {
      allowUserCancel: incomingCancelPolicy.allowUserCancel ?? baseCancelPolicy.allowUserCancel,
      userCancellation: incomingCancelPolicy.userCancellation ?? baseCancelPolicy.userCancellation,
      systemAbort: incomingCancelPolicy.systemAbort ?? baseCancelPolicy.systemAbort,
      timeout: incomingCancelPolicy.timeout ?? baseCancelPolicy.timeout,
      backendError: incomingCancelPolicy.backendError ?? baseCancelPolicy.backendError,
    },
    interactionPolicy: {
      clarification: incomingInteractionPolicy.clarification ?? baseInteractionPolicy.clarification,
      humanApproval: incomingInteractionPolicy.humanApproval ?? baseInteractionPolicy.humanApproval,
      guidanceQueue: incomingInteractionPolicy.guidanceQueue ?? baseInteractionPolicy.guidanceQueue,
    },
  };
}

function mergeConversationPlan(
  current: HarnessContract['conversationPlan'],
  incoming: Partial<ConversationPlan>,
  context?: MergeContext,
  conflicts: HarnessMergeConflict[] = [],
): HarnessContract['conversationPlan'] {
  const base = normalizeConversationPlan(current);
  const evidenceMode = incoming.evidenceMode
    ? strictestEvidenceMode(base.evidenceMode, incoming.evidenceMode)
    : base.evidenceMode;
  if (incoming.evidenceMode && evidenceMode !== incoming.evidenceMode && context) {
    conflicts.push(conflict('conversationPlan.evidenceMode', base.evidenceMode, incoming.evidenceMode, evidenceMode, 'evidence disclosure only escalates', context));
  }
  const auditHydration = incoming.auditHydration
    ? strictestAuditHydration(base.auditHydration, incoming.auditHydration)
    : base.auditHydration;
  if (incoming.auditHydration && auditHydration !== incoming.auditHydration && context) {
    conflicts.push(conflict('conversationPlan.auditHydration', base.auditHydration, incoming.auditHydration, auditHydration, 'audit hydration only escalates', context));
  }
  const refsFirst = base.refsFirst || incoming.refsFirst === true;
  if (incoming.refsFirst === false && base.refsFirst && context) {
    conflicts.push(conflict('conversationPlan.refsFirst', base.refsFirst, incoming.refsFirst, refsFirst, 'refs-first stays enabled once required', context));
  }
  const exposeAuditDrawer = base.exposeAuditDrawer || incoming.exposeAuditDrawer === true;
  if (incoming.exposeAuditDrawer === false && base.exposeAuditDrawer && context) {
    conflicts.push(conflict('conversationPlan.exposeAuditDrawer', base.exposeAuditDrawer, incoming.exposeAuditDrawer, exposeAuditDrawer, 'audit drawer stays available once required', context));
  }
  return normalizeConversationPlan({
    answerStrategy: incoming.answerStrategy ?? base.answerStrategy,
    evidenceMode,
    refsFirst,
    auditHydration,
    maxInlineEvidenceRefs: minDefined(base.maxInlineEvidenceRefs, incoming.maxInlineEvidenceRefs),
    maxInlineAuditNotes: minDefined(base.maxInlineAuditNotes, incoming.maxInlineAuditNotes),
    exposeAuditDrawer,
  });
}

function mergePresentation(current: HarnessContract['presentationPlan'], incoming: Partial<PresentationPlan>): HarnessContract['presentationPlan'] {
  const expanded = orderedUnique([
    ...current.defaultExpandedSections,
    ...(incoming.defaultExpandedSections ?? []),
  ]).filter((section) => !['process', 'diagnostics', 'raw-payload'].includes(section));
  return {
    primaryMode: incoming.primaryMode ?? current.primaryMode,
    status: incoming.status ?? current.status ?? 'complete',
    defaultExpandedSections: expanded as HarnessContract['presentationPlan']['defaultExpandedSections'],
    defaultCollapsedSections: orderedUnique([
      ...current.defaultCollapsedSections,
      ...(incoming.defaultCollapsedSections ?? []),
      'process',
      'diagnostics',
      'raw-payload',
    ]) as HarnessContract['presentationPlan']['defaultCollapsedSections'],
    citationPolicy: {
      ...current.citationPolicy,
      ...incoming.citationPolicy,
    },
    artifactActionPolicy: {
      ...current.artifactActionPolicy,
      ...incoming.artifactActionPolicy,
      primaryActions: orderedUnique([
        ...current.artifactActionPolicy.primaryActions,
        ...(incoming.artifactActionPolicy?.primaryActions ?? []),
      ]),
      secondaryActions: orderedUnique([
        ...current.artifactActionPolicy.secondaryActions,
        ...(incoming.artifactActionPolicy?.secondaryActions ?? []),
      ]),
    },
    diagnosticsVisibility: incoming.diagnosticsVisibility === 'expanded' ? current.diagnosticsVisibility : incoming.diagnosticsVisibility ?? current.diagnosticsVisibility,
    processVisibility: incoming.processVisibility === 'expanded' ? current.processVisibility : incoming.processVisibility ?? current.processVisibility,
    roleMode: incoming.roleMode ?? current.roleMode,
  };
}

function normalizeConversationPlan(plan?: Partial<ConversationPlan>): ConversationPlan {
  const base = baseConversationPlan();
  return {
    answerStrategy: plan?.answerStrategy ?? base.answerStrategy,
    evidenceMode: plan?.evidenceMode ?? base.evidenceMode,
    refsFirst: plan?.refsFirst ?? base.refsFirst,
    auditHydration: plan?.auditHydration ?? base.auditHydration,
    maxInlineEvidenceRefs: Math.max(0, Math.floor(plan?.maxInlineEvidenceRefs ?? base.maxInlineEvidenceRefs)),
    maxInlineAuditNotes: Math.max(0, Math.floor(plan?.maxInlineAuditNotes ?? base.maxInlineAuditNotes)),
    exposeAuditDrawer: plan?.exposeAuditDrawer ?? base.exposeAuditDrawer,
  };
}

function strictestEvidenceMode(current: ConversationEvidenceMode, incoming: ConversationEvidenceMode): ConversationEvidenceMode {
  const order: ConversationEvidenceMode[] = ['minimal-inline', 'refs-first', 'expanded'];
  return order[Math.max(order.indexOf(current), order.indexOf(incoming))];
}

function strictestAuditHydration(current: ConversationAuditHydration, incoming: ConversationAuditHydration): ConversationAuditHydration {
  const order: ConversationAuditHydration[] = ['none', 'on-demand', 'background', 'required'];
  return order[Math.max(order.indexOf(current), order.indexOf(incoming))];
}

function mergeSideEffect(current: SideEffectAllowance, incoming: SideEffectAllowance, context: MergeContext): SideEffectAllowance {
  const allowWidening = context.profile.mergePolicy.allowSideEffectWideningWithHumanApproval && context.humanApprovalSatisfied;
  if (allowWidening) return incoming;
  return strictestSideEffect(current, incoming);
}

function strictestSideEffect(current: SideEffectAllowance, incoming: SideEffectAllowance): SideEffectAllowance {
  const order: SideEffectAllowance[] = ['block', 'requires-approval', 'allow'];
  return order[Math.min(order.indexOf(current), order.indexOf(incoming))];
}

function normalizeContract(contract: HarnessContract): HarnessContract {
  return {
    ...contract,
    allowedContextRefs: sortedUnique(contract.allowedContextRefs.filter((ref) => !contract.blockedContextRefs.includes(ref))),
    blockedContextRefs: sortedUnique(contract.blockedContextRefs),
    requiredContextRefs: sortedUnique(contract.requiredContextRefs),
    capabilityPolicy: {
      ...contract.capabilityPolicy,
      candidates: sortCandidates(contract.capabilityPolicy.candidates),
      preferredCapabilityIds: sortedUnique(contract.capabilityPolicy.preferredCapabilityIds),
      blockedCapabilities: sortedUnique(contract.capabilityPolicy.blockedCapabilities),
      escalationPlan: sortEscalationPlan(contract.capabilityPolicy.escalationPlan ?? []),
      candidateTiers: normalizeCandidateTiers(contract.capabilityPolicy.candidateTiers ?? {}),
    },
    verificationPolicy: {
      ...contract.verificationPolicy,
      verificationLayers: orderedVerificationLayers(
        contract.verificationPolicy.verificationLayers ?? verificationLayersForIntensity(contract.verificationPolicy.intensity),
      ),
      ...(contract.verificationPolicy.selectedVerifierIds
        ? { selectedVerifierIds: sortedUnique(contract.verificationPolicy.selectedVerifierIds) }
        : {}),
    },
    promptDirectives: sortPromptDirectives(contract.promptDirectives),
    progressPlan: {
      ...contract.progressPlan,
      visibleMilestones: sortedUnique(contract.progressPlan.visibleMilestones),
      phaseNames: orderedUnique(contract.progressPlan.phaseNames ?? contract.progressPlan.visibleMilestones),
      firstResultDeadlineMs: contract.progressPlan.firstResultDeadlineMs ?? contract.progressPlan.silenceTimeoutMs,
      phaseDeadlines: normalizePhaseDeadlines(contract.progressPlan.phaseDeadlines, contract.progressPlan.phaseNames ?? contract.progressPlan.visibleMilestones),
      backgroundAfterMs: contract.progressPlan.backgroundAfterMs ?? contract.toolBudget.maxWallMs,
    },
    conversationPlan: normalizeConversationPlan(contract.conversationPlan),
    presentationPlan: mergePresentation(basePresentationPlan(), contract.presentationPlan ?? basePresentationPlan()),
  };
}

function applyLatencyTierPolicy(contract: HarnessContract, latencyTier: LatencyTier): HarnessContract {
  const policy = getLatencyTierPolicy(latencyTier);
  return {
    ...contract,
    latencyTier,
    explorationMode: policy.explorationMode,
    contextBudget: { ...policy.contextBudget },
    capabilityPolicy: {
      candidates: sortCandidates([...contract.capabilityPolicy.candidates, ...policy.capabilityPolicy.candidates]),
      preferredCapabilityIds: sortedUnique([
        ...contract.capabilityPolicy.preferredCapabilityIds,
        ...policy.capabilityPolicy.preferredCapabilityIds,
      ]),
      blockedCapabilities: sortedUnique([
        ...contract.capabilityPolicy.blockedCapabilities,
        ...policy.capabilityPolicy.blockedCapabilities,
      ]),
      sideEffects: {
        network: strictestSideEffect(contract.capabilityPolicy.sideEffects.network, policy.capabilityPolicy.sideEffects.network),
        workspaceWrite: strictestSideEffect(contract.capabilityPolicy.sideEffects.workspaceWrite, policy.capabilityPolicy.sideEffects.workspaceWrite),
        externalMutation: strictestSideEffect(contract.capabilityPolicy.sideEffects.externalMutation, policy.capabilityPolicy.sideEffects.externalMutation),
        codeExecution: strictestSideEffect(contract.capabilityPolicy.sideEffects.codeExecution, policy.capabilityPolicy.sideEffects.codeExecution),
      },
      escalationPlan: sortEscalationPlan([
        ...(contract.capabilityPolicy.escalationPlan ?? []),
        ...(policy.capabilityPolicy.escalationPlan ?? []),
      ]),
      candidateTiers: mergeCandidateTiers(contract.capabilityPolicy.candidateTiers ?? {}, policy.capabilityPolicy.candidateTiers ?? {}),
    },
    toolBudget: { ...policy.toolBudget },
    verificationPolicy: { ...policy.verificationPolicy },
    repairContextPolicy: { ...policy.repairContextPolicy },
    progressPlan: cloneProgressPlan(policy.progressPlan),
    conversationPlan: cloneConversationPlan(policy.conversationPlan),
    presentationPlan: clonePresentationPlan(policy.presentationPlan),
  };
}

function cloneContract(contract: HarnessContract): HarnessContract {
  return JSON.parse(JSON.stringify(contract)) as HarnessContract;
}

function cloneProgressPlan(progressPlan: HarnessContract['progressPlan']): HarnessContract['progressPlan'] {
  return {
    ...progressPlan,
    visibleMilestones: [...progressPlan.visibleMilestones],
    phaseNames: progressPlan.phaseNames ? [...progressPlan.phaseNames] : undefined,
    phaseDeadlines: progressPlan.phaseDeadlines ? { ...progressPlan.phaseDeadlines } : undefined,
    silencePolicy: progressPlan.silencePolicy ? { ...progressPlan.silencePolicy } : undefined,
    backgroundPolicy: progressPlan.backgroundPolicy ? { ...progressPlan.backgroundPolicy } : undefined,
    cancelPolicy: progressPlan.cancelPolicy ? { ...progressPlan.cancelPolicy } : undefined,
    interactionPolicy: progressPlan.interactionPolicy ? { ...progressPlan.interactionPolicy } : undefined,
  };
}

function cloneConversationPlan(conversationPlan: HarnessContract['conversationPlan']): HarnessContract['conversationPlan'] {
  return { ...conversationPlan };
}

function clonePresentationPlan(presentationPlan: HarnessContract['presentationPlan']): HarnessContract['presentationPlan'] {
  return {
    ...presentationPlan,
    defaultExpandedSections: [...presentationPlan.defaultExpandedSections],
    defaultCollapsedSections: [...presentationPlan.defaultCollapsedSections],
    citationPolicy: { ...presentationPlan.citationPolicy },
    artifactActionPolicy: {
      ...presentationPlan.artifactActionPolicy,
      primaryActions: [...presentationPlan.artifactActionPolicy.primaryActions],
      secondaryActions: [...presentationPlan.artifactActionPolicy.secondaryActions],
    },
  };
}

function baseConversationPlan(): ConversationPlan {
  return {
    answerStrategy: 'answer-first',
    evidenceMode: 'refs-first',
    refsFirst: true,
    auditHydration: 'on-demand',
    maxInlineEvidenceRefs: 2,
    maxInlineAuditNotes: 1,
    exposeAuditDrawer: true,
  };
}

function basePresentationPlan(): PresentationPlan {
  return {
    primaryMode: 'answer-first',
    status: 'complete',
    defaultExpandedSections: ['answer', 'key-findings', 'evidence', 'artifacts', 'next-actions'],
    defaultCollapsedSections: ['process', 'diagnostics', 'raw-payload'],
    citationPolicy: {
      requireCitationOrUncertainty: true,
      maxInlineCitationsPerFinding: 4,
      showVerificationState: true,
    },
    artifactActionPolicy: {
      primaryActions: ['inspect', 'focus-right-pane'],
      secondaryActions: ['export', 'copy-ref'],
      preferRightPane: true,
    },
    diagnosticsVisibility: 'collapsed',
    processVisibility: 'collapsed',
    roleMode: 'standard',
  };
}

function sortCandidates<T extends { id: string; kind: string; score: number }>(candidates: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.id}`;
    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score) byKey.set(key, candidate);
  }
  return Array.from(byKey.values()).sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

function sortPromptDirectives(directives: PromptDirective[]): PromptDirective[] {
  const byKey = new Map<string, PromptDirective>();
  for (const directive of directives) byKey.set(`${directive.sourceCallbackId}:${directive.id}`, directive);
  return Array.from(byKey.values()).sort((a, b) => b.priority - a.priority || a.sourceCallbackId.localeCompare(b.sourceCallbackId) || a.id.localeCompare(b.id));
}

function sortEscalationPlan(plan: HarnessContract['capabilityPolicy']['escalationPlan'] = []): NonNullable<HarnessContract['capabilityPolicy']['escalationPlan']> {
  const order: CapabilityEscalationTier[] = ['direct-context', 'metadata-summary', 'single-tool', 'tool-composition', 'workspace-task', 'deep-agent-project', 'repair-or-background'];
  const byTier = new Map<CapabilityEscalationTier, CapabilityEscalationStep>();
  for (const step of plan) {
    const existing = byTier.get(step.tier);
    byTier.set(step.tier, {
      ...existing,
      ...step,
      candidateIds: sortedUnique([...(existing?.candidateIds ?? []), ...step.candidateIds]),
      expectedBenefit: step.expectedBenefit ?? step.benefit ?? existing?.expectedBenefit,
      benefit: step.benefit ?? step.expectedBenefit ?? existing?.benefit ?? '',
      cost: step.cost ?? existing?.cost ?? step.costClass ?? 'unspecified',
      stopCondition: step.stopCondition ?? existing?.stopCondition ?? 'evidence sufficient or budget exhausted',
    });
  }
  return Array.from(byTier.values()).sort((left, right) => order.indexOf(left.tier) - order.indexOf(right.tier));
}

function mergeCandidateTiers(
  current: HarnessContract['capabilityPolicy']['candidateTiers'] = {},
  incoming: HarnessContract['capabilityPolicy']['candidateTiers'] = {},
): NonNullable<HarnessContract['capabilityPolicy']['candidateTiers']> {
  const next = normalizeCandidateTiers(current);
  for (const [tier, candidateIds] of Object.entries(incoming) as Array<[CapabilityEscalationTier, string[] | undefined]>) {
    next[tier] = sortedUnique([...(next[tier] ?? []), ...(candidateIds ?? [])]);
  }
  return normalizeCandidateTiers(next);
}

function normalizeCandidateTiers(
  candidateTiers: HarnessContract['capabilityPolicy']['candidateTiers'] = {},
): NonNullable<HarnessContract['capabilityPolicy']['candidateTiers']> {
  return Object.fromEntries(
    Object.entries(candidateTiers)
      .map(([tier, candidateIds]) => [tier, sortedUnique(candidateIds ?? [])])
      .filter(([, candidateIds]) => (candidateIds as string[]).length > 0),
  ) as NonNullable<HarnessContract['capabilityPolicy']['candidateTiers']>;
}

function verificationLayersForIntensity(intensity: VerificationIntensity): VerificationLayer[] {
  if (intensity === 'none') return [];
  if (intensity === 'light') return ['shape', 'reference'];
  if (intensity === 'standard') return ['shape', 'reference', 'claim'];
  if (intensity === 'strict') return ['shape', 'reference', 'claim', 'recompute'];
  return ['shape', 'reference', 'claim', 'recompute', 'audit'];
}

function orderedVerificationLayers(layers: VerificationLayer[]): VerificationLayer[] {
  const order: VerificationLayer[] = ['shape', 'reference', 'claim', 'recompute', 'audit'];
  const selected = new Set(layers);
  return order.filter((layer) => selected.has(layer));
}

function mergeRepairTierBudgets(
  current: RepairContextPolicy['tierBudgets'],
  incoming?: RepairContextPolicy['tierBudgets'],
): RepairContextPolicy['tierBudgets'] {
  const next: Record<string, { maxAttempts: number; maxWallMs: number; maxContextTokens?: number; maxToolCalls?: number }> = { ...(current ?? {}) };
  for (const [tier, budget] of Object.entries(incoming ?? {})) {
    const previous = next[tier];
    next[tier] = previous
      ? {
        maxAttempts: minDefined(previous.maxAttempts, budget.maxAttempts),
        maxWallMs: minDefined(previous.maxWallMs, budget.maxWallMs),
        maxContextTokens: minOptionalDefined(previous.maxContextTokens, budget.maxContextTokens),
        maxToolCalls: minOptionalDefined(previous.maxToolCalls, budget.maxToolCalls),
      }
      : { ...budget };
  }
  return next as RepairContextPolicy['tierBudgets'];
}

function orderedRepairStopConditions(values: NonNullable<RepairContextPolicy['stopConditions']>): RepairContextPolicy['stopConditions'] {
  const order: RepairContextPolicy['stopConditions'] = ['repeated-failure', 'no-code-change', 'no-new-evidence', 'budget-exhausted', 'human-required'];
  const selected = new Set(values);
  return order.filter((item) => selected.has(item));
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function orderedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function minDefined(current: number, incoming?: number): number {
  return typeof incoming === 'number' ? Math.min(current, incoming) : current;
}

function minOptionalDefined(current: number | undefined, incoming?: number): number | undefined {
  if (typeof current === 'number' && typeof incoming === 'number') return Math.min(current, incoming);
  return current ?? incoming;
}

function mergePhaseDeadlines(
  current?: Record<string, number>,
  incoming?: Partial<Record<string, number>>,
): Record<string, number> {
  const merged: Record<string, number> = { ...(current ?? {}) };
  for (const [phase, deadline] of Object.entries(incoming ?? {})) {
    if (typeof deadline !== 'number') continue;
    merged[phase] = typeof merged[phase] === 'number' ? Math.min(merged[phase], deadline) : deadline;
  }
  return merged;
}

function normalizePhaseDeadlines(
  phaseDeadlines: Record<string, number> | undefined,
  phaseNames: readonly string[],
): Record<string, number> {
  const normalized: Record<string, number> = {};
  let fallbackDeadlineMs = 3000;
  for (const phase of phaseNames) {
    normalized[phase] = phaseDeadlines?.[phase] ?? fallbackDeadlineMs;
    fallbackDeadlineMs = Math.min(30000, fallbackDeadlineMs + 5000);
  }
  for (const [phase, deadline] of Object.entries(phaseDeadlines ?? {})) {
    if (!(phase in normalized) && typeof deadline === 'number') normalized[phase] = deadline;
  }
  return normalized;
}

function escalateExploration(current: HarnessContract['explorationMode'], incoming: HarnessContract['explorationMode']) {
  const order = ['minimal', 'normal', 'deep'] as const;
  return order[Math.max(order.indexOf(current), order.indexOf(incoming))];
}

function escalateVerification(current: VerificationIntensity, incoming: VerificationIntensity): VerificationIntensity {
  const order: VerificationIntensity[] = ['none', 'light', 'standard', 'strict', 'audit'];
  return order[Math.max(order.indexOf(current), order.indexOf(incoming))];
}

function conservativeExhaustedPolicy(current: BudgetExhaustedPolicy, incoming?: BudgetExhaustedPolicy): BudgetExhaustedPolicy {
  if (!incoming) return current;
  const order: BudgetExhaustedPolicy[] = ['partial-payload', 'needs-human', 'fail-with-reason'];
  return order[Math.max(order.indexOf(current), order.indexOf(incoming))];
}

function conflict(
  field: string,
  previous: unknown,
  incoming: unknown,
  chosen: unknown,
  reason: string,
  context: MergeContext,
): HarnessMergeConflict {
  return {
    field,
    previous,
    incoming,
    chosen,
    reason,
    sourceCallbackId: context.callbackId,
    stage: context.stage,
  };
}

function stableTraceId(input: HarnessInput, profileId: string): string {
  const text = JSON.stringify({
    requestId: input.requestId,
    prompt: input.prompt,
    profileId,
    latencyTier: input.latencyTier,
    intentMode: input.intentMode,
    refs: input.contextRefs,
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `htrace-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export const harnessRuntimeInternals = {
  mergeDecision,
};
