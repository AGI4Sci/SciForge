import type {
  BudgetExhaustedPolicy,
  CapabilityBudget,
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
  HarnessTrace,
  ProgressDecision,
  PromptDirective,
  RepairContextPolicy,
  SideEffectAllowance,
  VerificationIntensity,
  VerificationPolicy,
} from './contracts';
import { getHarnessProfile } from './profiles';

export const HARNESS_EVALUATION_STAGES: readonly HarnessStage[] = [
  'classifyIntent',
  'selectContext',
  'setExplorationBudget',
  'selectCapabilities',
  'onToolPolicy',
  'onBudgetAllocate',
  'beforePromptRender',
  'beforeResultValidation',
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
      stages: [],
      conflicts: [],
      auditNotes: [stageCoverageAuditNote()],
    };
    contract = { ...contract, traceRef: trace.traceId };

    for (const stage of HARNESS_EVALUATION_STAGES) {
      const callbacks = profile.callbacks.filter((callback) => callback.stages.includes(stage));
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
        trace.conflicts.push(...result.conflicts);
        trace.auditNotes.push(...decision.auditNotes ?? []);
        trace.stages.push({
          stage,
          callbackId: callback.id,
          decision,
          contractSnapshot: cloneContract(contract),
        });
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
      `external-hooks=${HARNESS_EXTERNAL_HOOK_STAGES.join(',')}`,
    ].join('; '),
  };
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
    },
    toolBudget: { ...defaults.toolBudget, ...tightenToolBudget(defaults.toolBudget, input.budgetOverrides?.toolBudget) },
    verificationPolicy: { ...defaults.verificationPolicy },
    repairContextPolicy: { ...defaults.repairContextPolicy },
    progressPlan: cloneProgressPlan(defaults.progressPlan),
    promptDirectives: sortPromptDirectives(defaults.promptDirectives),
  };
  return normalizeContract(base);
}

function mergeDecision(contract: HarnessContract, decision: HarnessDecision, context: MergeContext): {
  contract: HarnessContract;
  conflicts: HarnessMergeConflict[];
} {
  let next = cloneContract(contract);
  const conflicts: HarnessMergeConflict[] = [];

  if (decision.intentSignals?.intentMode) next.intentMode = decision.intentSignals.intentMode;
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
      ...(selectedVerifierIds.length > 0 ? { selectedVerifierIds } : {}),
    }
    : undefined;

  return {
    ...left,
    ...right,
    ...(verification ? { verification } : {}),
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
    maxWallMs: minDefined(current.maxWallMs, incoming.maxWallMs),
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
  return {
    intensity,
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

function mergeSideEffect(current: SideEffectAllowance, incoming: SideEffectAllowance, context: MergeContext): SideEffectAllowance {
  const allowWidening = context.profile.mergePolicy.allowSideEffectWideningWithHumanApproval && context.humanApprovalSatisfied;
  if (allowWidening) return incoming;
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
    },
    verificationPolicy: {
      ...contract.verificationPolicy,
      ...(contract.verificationPolicy.selectedVerifierIds
        ? { selectedVerifierIds: sortedUnique(contract.verificationPolicy.selectedVerifierIds) }
        : {}),
    },
    promptDirectives: sortPromptDirectives(contract.promptDirectives),
    progressPlan: {
      ...contract.progressPlan,
      visibleMilestones: sortedUnique(contract.progressPlan.visibleMilestones),
      phaseNames: orderedUnique(contract.progressPlan.phaseNames ?? contract.progressPlan.visibleMilestones),
    },
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
    silencePolicy: progressPlan.silencePolicy ? { ...progressPlan.silencePolicy } : undefined,
    backgroundPolicy: progressPlan.backgroundPolicy ? { ...progressPlan.backgroundPolicy } : undefined,
    cancelPolicy: progressPlan.cancelPolicy ? { ...progressPlan.cancelPolicy } : undefined,
    interactionPolicy: progressPlan.interactionPolicy ? { ...progressPlan.interactionPolicy } : undefined,
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

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function orderedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function minDefined(current: number, incoming?: number): number {
  return typeof incoming === 'number' ? Math.min(current, incoming) : current;
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
