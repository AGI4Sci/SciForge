import type {
  CapabilityBudget,
  ContextBudget,
  HarnessCallback,
  HarnessDefaults,
  HarnessProfile,
  HarnessProfileId,
  LatencyTier,
  LatencyTierPolicy,
  PresentationPlan,
  ProgressPlan,
  RepairContextPolicy,
  SideEffectPolicy,
  VerificationPolicy,
} from './contracts';
import type { ContractFn } from './contract-fns';
import type { HookFn } from './hook-fns';
import { evaluateThinWaist, stableHarnessDigest, type ThinWaistEvaluation } from './trace';

const baseContextBudget: ContextBudget = {
  maxPromptTokens: 6000,
  maxHistoryTurns: 2,
  maxReferenceDigests: 8,
  maxFullTextRefs: 0,
};

const baseToolBudget: CapabilityBudget = {
  maxWallMs: 120000,
  maxContextTokens: 8000,
  maxToolCalls: 8,
  maxObserveCalls: 2,
  maxActionSteps: 0,
  maxNetworkCalls: 4,
  maxDownloadBytes: 20_000_000,
  maxResultItems: 20,
  maxProviders: 2,
  maxRetries: 1,
  perProviderTimeoutMs: 30000,
  costUnits: 10,
  exhaustedPolicy: 'partial-payload',
};

const baseSideEffects: SideEffectPolicy = {
  network: 'requires-approval',
  workspaceWrite: 'block',
  externalMutation: 'block',
  codeExecution: 'block',
};

const baseVerification: VerificationPolicy = {
  intensity: 'standard',
  verificationLayers: ['shape', 'reference', 'claim'],
  requireCitations: false,
  requireCurrentRefs: true,
  requireArtifactRefs: true,
};

const baseRepair: RepairContextPolicy = {
  kind: 'supplement',
  maxAttempts: 1,
  includeStdoutSummary: false,
  includeStderrSummary: true,
  maxWallMs: 15000,
  cheapOnly: true,
  partialFirst: true,
  materializePartialOnFailure: true,
  checkpointArtifacts: false,
  stopOnRepeatedFailure: true,
  tierBudgets: {
    instant: { maxAttempts: 0, maxWallMs: 0 },
    quick: { maxAttempts: 0, maxWallMs: 5000, maxContextTokens: 1000, maxToolCalls: 0 },
    bounded: { maxAttempts: 1, maxWallMs: 15000, maxContextTokens: 3000, maxToolCalls: 1 },
    deep: { maxAttempts: 2, maxWallMs: 60000, maxContextTokens: 6000, maxToolCalls: 2 },
    background: { maxAttempts: 3, maxWallMs: 180000, maxContextTokens: 10000, maxToolCalls: 4 },
  },
  stopConditions: ['repeated-failure', 'no-code-change', 'no-new-evidence', 'budget-exhausted'],
};

const baseProgress: ProgressPlan = {
  initialStatus: 'Planning request',
  visibleMilestones: ['context', 'capabilities', 'verification'],
  phaseNames: ['context', 'capabilities', 'verification'],
  firstResultDeadlineMs: 30000,
  phaseDeadlines: {
    context: 3000,
    capabilities: 5000,
    verification: 30000,
  },
  backgroundAfterMs: 180000,
  silenceTimeoutMs: 30000,
  backgroundContinuation: false,
  silencePolicy: {
    timeoutMs: 30000,
    decision: 'visible-status',
    status: 'Still working',
    maxRetries: 0,
    auditRequired: true,
  },
  backgroundPolicy: {
    enabled: false,
    status: 'Continuing in background',
    notifyOnCompletion: true,
  },
  cancelPolicy: {
    allowUserCancel: true,
    userCancellation: 'user-cancelled',
    systemAbort: 'system-aborted',
    timeout: 'timeout',
    backendError: 'backend-error',
  },
  interactionPolicy: {
    clarification: 'allow',
    humanApproval: 'allow',
    guidanceQueue: 'allow',
  },
};

const basePresentation: PresentationPlan = {
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

function cheapFirstCapabilityPolicy(overrides: Partial<LatencyTierPolicy['capabilityPolicy']> = {}): LatencyTierPolicy['capabilityPolicy'] {
  const preferredCapabilityIds = overrides.preferredCapabilityIds ?? [];
  return {
    candidates: overrides.candidates ?? [],
    preferredCapabilityIds,
    blockedCapabilities: overrides.blockedCapabilities ?? [],
    sideEffects: overrides.sideEffects ?? { ...baseSideEffects },
    escalationPlan: overrides.escalationPlan ?? [
      {
        tier: 'direct-context',
        candidateIds: preferredCapabilityIds.includes('runtime.direct-context-answer') ? ['runtime.direct-context-answer'] : [],
        benefit: 'answer from current context without external work',
        cost: 'free/instant/no side effects',
        expectedBenefit: 'fastest acceptable answer when existing context is sufficient',
        costClass: 'free',
        latencyClass: 'instant',
        sideEffectClass: 'none',
        stopCondition: 'stop when answerable from current context with shape/reference checks',
      },
      {
        tier: 'metadata-summary',
        candidateIds: ['runtime.artifact-list', 'runtime.artifact-resolve'],
        benefit: 'read bounded metadata, summaries, and refs before heavier execution',
        cost: 'low/short/workspace read',
        expectedBenefit: 'ground answer in cheap refs before tool execution',
        costClass: 'low',
        latencyClass: 'short',
        sideEffectClass: 'read',
        stopCondition: 'stop when metadata or summary evidence is sufficient',
      },
      {
        tier: 'single-tool',
        candidateIds: [],
        benefit: 'run one precise capability only when direct evidence is insufficient',
        cost: 'low-to-medium/bounded',
        expectedBenefit: 'resolve a narrow missing fact or artifact',
        costClass: 'low',
        latencyClass: 'bounded',
        sideEffectClass: 'read',
        stopCondition: 'stop after one successful precise result or materialize partial',
      },
      {
        tier: 'tool-composition',
        candidateIds: [],
        benefit: 'combine a small number of tools when one tool cannot satisfy the request',
        cost: 'medium/bounded',
        expectedBenefit: 'cover multi-step but still interactive tasks',
        costClass: 'medium',
        latencyClass: 'bounded',
        sideEffectClass: 'read',
        stopCondition: 'stop when marginal evidence gain is unclear or budget is near exhaustion',
      },
      {
        tier: 'workspace-task',
        candidateIds: ['skill.agentserver-generation'],
        benefit: 'use generated workspace task only after cheap candidates fail',
        cost: 'medium-to-high/long/workspace write',
        expectedBenefit: 'produce or repair durable artifacts',
        costClass: 'medium',
        latencyClass: 'long',
        sideEffectClass: 'write',
        stopCondition: 'checkpoint artifact after every attempt and return partial on failure',
      },
      {
        tier: 'deep-agent-project',
        candidateIds: [],
        benefit: 'reserve deep project execution for explicit deep/background needs',
        cost: 'high/background',
        expectedBenefit: 'maximize recall, verification, or reproduction depth',
        costClass: 'high',
        latencyClass: 'background',
        sideEffectClass: 'write',
        stopCondition: 'background or request human guidance when interactive budget is exhausted',
      },
      {
        tier: 'repair-or-background',
        candidateIds: [],
        benefit: 'continue only if repair has new evidence or a bounded checkpoint',
        cost: 'tier-budgeted/background-capable',
        expectedBenefit: 'recover failures without blocking first result',
        costClass: 'medium',
        latencyClass: 'background',
        sideEffectClass: 'write',
        stopCondition: 'stop on repeated failure, no code change, no new evidence, or repair budget exhaustion',
      },
    ],
    candidateTiers: overrides.candidateTiers ?? {
      'direct-context': preferredCapabilityIds.includes('runtime.direct-context-answer') ? ['runtime.direct-context-answer'] : [],
      'metadata-summary': ['runtime.artifact-list', 'runtime.artifact-resolve'],
      'workspace-task': ['skill.agentserver-generation'],
    },
  };
}

const latencyTierPolicies: Record<LatencyTier, LatencyTierPolicy> = {
  instant: {
    latencyTier: 'instant',
    explorationMode: 'minimal',
    contextBudget: { maxPromptTokens: 2000, maxHistoryTurns: 1, maxReferenceDigests: 2, maxFullTextRefs: 0 },
    capabilityPolicy: cheapFirstCapabilityPolicy({
      preferredCapabilityIds: ['runtime.direct-context-answer'],
      blockedCapabilities: ['network', 'workspace-write', 'code-execution', 'external-mutation'],
      sideEffects: { network: 'block', workspaceWrite: 'block', externalMutation: 'block', codeExecution: 'block' },
    }),
    toolBudget: {
      maxWallMs: 5000,
      maxContextTokens: 2000,
      maxToolCalls: 0,
      maxObserveCalls: 0,
      maxActionSteps: 0,
      maxNetworkCalls: 0,
      maxDownloadBytes: 0,
      maxResultItems: 4,
      maxProviders: 0,
      maxRetries: 0,
      perProviderTimeoutMs: 2000,
      costUnits: 0,
      exhaustedPolicy: 'partial-payload',
    },
    verificationPolicy: { intensity: 'light', verificationLayers: ['shape', 'reference'], requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: false },
    repairContextPolicy: { ...baseRepair, kind: 'none', maxAttempts: 0, includeStdoutSummary: false, includeStderrSummary: false, maxWallMs: 0, cheapOnly: true, checkpointArtifacts: false },
    progressPlan: {
      ...baseProgress,
      initialStatus: 'Answering from available context',
      visibleMilestones: ['answer'],
      phaseNames: ['answer'],
      firstResultDeadlineMs: 5000,
      phaseDeadlines: { answer: 3000 },
      backgroundAfterMs: 15000,
      silenceTimeoutMs: 5000,
      silencePolicy: { ...baseProgress.silencePolicy!, timeoutMs: 5000, status: 'Preparing answer', auditRequired: false },
    },
    presentationPlan: {
      ...clonePresentationPlan(basePresentation),
      defaultExpandedSections: ['answer', 'key-findings', 'next-actions'],
      citationPolicy: { requireCitationOrUncertainty: false, maxInlineCitationsPerFinding: 1, showVerificationState: false },
    },
  },
  quick: {
    latencyTier: 'quick',
    explorationMode: 'minimal',
    contextBudget: { maxPromptTokens: 3000, maxHistoryTurns: 1, maxReferenceDigests: 4, maxFullTextRefs: 0 },
    capabilityPolicy: cheapFirstCapabilityPolicy(),
    toolBudget: {
      maxWallMs: 30000,
      maxContextTokens: 3000,
      maxToolCalls: 2,
      maxObserveCalls: 0,
      maxActionSteps: 0,
      maxNetworkCalls: 1,
      maxDownloadBytes: 2_000_000,
      maxResultItems: 6,
      maxProviders: 1,
      maxRetries: 0,
      perProviderTimeoutMs: 10000,
      costUnits: 2,
      exhaustedPolicy: 'partial-payload',
    },
    verificationPolicy: { intensity: 'light', verificationLayers: ['shape', 'reference'], requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: true },
    repairContextPolicy: { ...baseRepair, kind: 'supplement', maxAttempts: 0, maxWallMs: 5000, cheapOnly: true, checkpointArtifacts: false },
    progressPlan: {
      ...baseProgress,
      initialStatus: 'Answering',
      visibleMilestones: ['context', 'answer'],
      phaseNames: ['context', 'answer'],
      firstResultDeadlineMs: 15000,
      phaseDeadlines: { context: 3000, answer: 15000 },
      backgroundAfterMs: 30000,
      silenceTimeoutMs: 10000,
      silencePolicy: { ...baseProgress.silencePolicy!, timeoutMs: 10000, status: 'Preparing a concise answer', maxRetries: 0 },
    },
    presentationPlan: {
      ...clonePresentationPlan(basePresentation),
      defaultExpandedSections: ['answer', 'key-findings', 'evidence', 'next-actions'],
      citationPolicy: { requireCitationOrUncertainty: true, maxInlineCitationsPerFinding: 2, showVerificationState: true },
    },
  },
  bounded: {
    latencyTier: 'bounded',
    explorationMode: 'normal',
    contextBudget: { maxPromptTokens: 6000, maxHistoryTurns: 2, maxReferenceDigests: 8, maxFullTextRefs: 1 },
    capabilityPolicy: cheapFirstCapabilityPolicy(),
    toolBudget: { ...baseToolBudget, maxWallMs: 90000, maxToolCalls: 6, maxNetworkCalls: 3, maxResultItems: 16, maxRetries: 1 },
    verificationPolicy: { ...baseVerification, intensity: 'standard', verificationLayers: ['shape', 'reference', 'claim'], requireCurrentRefs: true, requireArtifactRefs: true },
    repairContextPolicy: { ...baseRepair, kind: 'supplement', maxAttempts: 1, maxWallMs: 15000, cheapOnly: true, checkpointArtifacts: true },
    progressPlan: {
      ...baseProgress,
      initialStatus: 'Working within a bounded plan',
      visibleMilestones: ['context', 'capabilities', 'answer', 'verification'],
      phaseNames: ['context', 'capabilities', 'answer', 'verification'],
      firstResultDeadlineMs: 30000,
      phaseDeadlines: { context: 3000, capabilities: 5000, answer: 30000, verification: 90000 },
      backgroundAfterMs: 180000,
      silenceTimeoutMs: 20000,
      silencePolicy: { ...baseProgress.silencePolicy!, timeoutMs: 20000, status: 'Still within the bounded plan' },
    },
    presentationPlan: clonePresentationPlan(basePresentation),
  },
  deep: {
    latencyTier: 'deep',
    explorationMode: 'deep',
    contextBudget: { maxPromptTokens: 10000, maxHistoryTurns: 3, maxReferenceDigests: 16, maxFullTextRefs: 3 },
    capabilityPolicy: cheapFirstCapabilityPolicy(),
    toolBudget: {
      ...baseToolBudget,
      maxWallMs: 240000,
      maxContextTokens: 14000,
      maxToolCalls: 12,
      maxObserveCalls: 3,
      maxNetworkCalls: 8,
      maxDownloadBytes: 60_000_000,
      maxResultItems: 50,
      maxProviders: 4,
      maxRetries: 2,
      perProviderTimeoutMs: 45000,
      costUnits: 20,
    },
    verificationPolicy: { ...baseVerification, intensity: 'strict', verificationLayers: ['shape', 'reference', 'claim', 'recompute'], requireCitations: true, requireCurrentRefs: true, requireArtifactRefs: true },
    repairContextPolicy: { ...baseRepair, kind: 'repair-rerun', maxAttempts: 2, maxWallMs: 60000, cheapOnly: false, includeStdoutSummary: true, includeStderrSummary: true, checkpointArtifacts: true },
    progressPlan: {
      ...baseProgress,
      initialStatus: 'Researching deeply',
      visibleMilestones: ['context', 'capabilities', 'evidence', 'synthesis', 'verification'],
      phaseNames: ['context', 'capabilities', 'evidence', 'synthesis', 'verification'],
      firstResultDeadlineMs: 30000,
      phaseDeadlines: { context: 3000, capabilities: 5000, evidence: 60000, synthesis: 120000, verification: 180000 },
      backgroundAfterMs: 180000,
      silenceTimeoutMs: 45000,
      silencePolicy: { ...baseProgress.silencePolicy!, timeoutMs: 45000, status: 'Researching and verifying' },
    },
    presentationPlan: clonePresentationPlan(basePresentation),
  },
  background: {
    latencyTier: 'background',
    explorationMode: 'deep',
    contextBudget: { maxPromptTokens: 12000, maxHistoryTurns: 3, maxReferenceDigests: 20, maxFullTextRefs: 4 },
    capabilityPolicy: cheapFirstCapabilityPolicy(),
    toolBudget: {
      ...baseToolBudget,
      maxWallMs: 600000,
      maxContextTokens: 18000,
      maxToolCalls: 20,
      maxObserveCalls: 4,
      maxActionSteps: 8,
      maxNetworkCalls: 12,
      maxDownloadBytes: 120_000_000,
      maxResultItems: 100,
      maxProviders: 5,
      maxRetries: 2,
      perProviderTimeoutMs: 60000,
      costUnits: 35,
      exhaustedPolicy: 'needs-human',
    },
    verificationPolicy: { ...baseVerification, intensity: 'audit', verificationLayers: ['shape', 'reference', 'claim', 'recompute', 'audit'], requireCitations: true, requireCurrentRefs: true, requireArtifactRefs: true },
    repairContextPolicy: { ...baseRepair, kind: 'repair-rerun', maxAttempts: 3, maxWallMs: 180000, cheapOnly: false, includeStdoutSummary: true, includeStderrSummary: true, checkpointArtifacts: true },
    progressPlan: {
      ...baseProgress,
      initialStatus: 'Starting background-capable work',
      visibleMilestones: ['partial', 'background', 'verification', 'completion'],
      phaseNames: ['partial', 'background', 'verification', 'completion'],
      firstResultDeadlineMs: 30000,
      phaseDeadlines: { partial: 30000, background: 60000, verification: 240000, completion: 600000 },
      backgroundAfterMs: 30000,
      silenceTimeoutMs: 30000,
      backgroundContinuation: true,
      silencePolicy: { ...baseProgress.silencePolicy!, timeoutMs: 30000, decision: 'background', status: 'Continuing in background' },
      backgroundPolicy: { enabled: true, status: 'Continuing in background', notifyOnCompletion: true },
    },
    presentationPlan: {
      ...clonePresentationPlan(basePresentation),
      primaryMode: 'answer-first',
      status: 'background-running',
      defaultExpandedSections: ['answer', 'key-findings', 'next-actions'],
      defaultCollapsedSections: ['process', 'diagnostics', 'raw-payload', 'evidence', 'artifacts'],
    },
  },
};

const CONTEXT_AUDIT_HINT = /(?:什么|哪些|哪个|怎么|怎样|为什么|为何|原因|工具|日志|记录|引用|证据|验证|中断|失败|抽取|提取|how|why|what|which|tool|log|ref|reference|evidence|verify|extract|failed|stopped|interrupted)/i;
const FRESH_WORK_HINT = /(?:重新|重跑|再跑|再检索|检索一下|搜索|查找|下载并|阅读全文|最新|今天|过去一周|生成新的|继续执行|修复|rerun|run again|search|retrieve|fetch|download|latest|today|generate new|repair)/i;
const BACKGROUND_TIER_HINT = /(?:后台|不用等|稍后通知|继续跑|background|later|notify me|keep working)/i;
const DEEP_TIER_HINT = /(?:深入|全面|严格|审计|复现|长报告|系统性|deep|thorough|comprehensive|strict|audit|reproduce|reproduction|long report|research grade)/i;
const BOUNDED_TIER_HINT = /(?:运行|执行|生成|修复|下载|检索|搜索|读取文件|workspace|run|execute|generate|repair|download|retrieve|search|file|code)/i;

function defaults(overrides: Partial<HarnessDefaults>): HarnessDefaults {
  const latencyTier = overrides.latencyTier ?? 'quick';
  const tierPolicy = getLatencyTierPolicy(latencyTier);
  return {
    latencyTier,
    intentMode: 'fresh',
    explorationMode: tierPolicy.explorationMode,
    allowedContextRefs: [],
    blockedContextRefs: [],
    requiredContextRefs: [],
    contextBudget: { ...tierPolicy.contextBudget },
    capabilityPolicy: cloneCapabilityPolicy(tierPolicy.capabilityPolicy),
    toolBudget: { ...tierPolicy.toolBudget },
    verificationPolicy: {
      ...tierPolicy.verificationPolicy,
      verificationLayers: [...(tierPolicy.verificationPolicy.verificationLayers ?? [])],
      selectedVerifierIds: tierPolicy.verificationPolicy.selectedVerifierIds ? [...tierPolicy.verificationPolicy.selectedVerifierIds] : undefined,
    },
    repairContextPolicy: cloneRepairPolicy(tierPolicy.repairContextPolicy),
    progressPlan: cloneProgressPlan(tierPolicy.progressPlan),
    presentationPlan: clonePresentationPlan(tierPolicy.presentationPlan),
    promptDirectives: [],
    ...overrides,
  };
}

export function getLatencyTierPolicy(latencyTier: LatencyTier): LatencyTierPolicy {
  const policy = latencyTierPolicies[latencyTier] ?? latencyTierPolicies.quick;
  return {
    ...policy,
    contextBudget: { ...policy.contextBudget },
    capabilityPolicy: cloneCapabilityPolicy(policy.capabilityPolicy),
    toolBudget: { ...policy.toolBudget },
    verificationPolicy: {
      ...policy.verificationPolicy,
      verificationLayers: [...(policy.verificationPolicy.verificationLayers ?? [])],
      selectedVerifierIds: policy.verificationPolicy.selectedVerifierIds ? [...policy.verificationPolicy.selectedVerifierIds] : undefined,
    },
    repairContextPolicy: cloneRepairPolicy(policy.repairContextPolicy),
    progressPlan: cloneProgressPlan(policy.progressPlan),
    presentationPlan: clonePresentationPlan(policy.presentationPlan),
  };
}

function cloneCapabilityPolicy(policy: LatencyTierPolicy['capabilityPolicy']) {
  return {
    candidates: [...policy.candidates],
    preferredCapabilityIds: [...policy.preferredCapabilityIds],
    blockedCapabilities: [...policy.blockedCapabilities],
    sideEffects: { ...policy.sideEffects },
    escalationPlan: (policy.escalationPlan ?? []).map((step) => ({ ...step, candidateIds: [...step.candidateIds] })),
    candidateTiers: Object.fromEntries(Object.entries(policy.candidateTiers ?? {}).map(([tier, candidateIds]) => [tier, [...candidateIds ?? []]])),
  };
}

function cloneRepairPolicy(policy: RepairContextPolicy): RepairContextPolicy {
  return {
    ...policy,
    tierBudgets: Object.fromEntries(Object.entries(policy.tierBudgets ?? {}).map(([tier, budget]) => [tier, budget ? { ...budget } : budget])),
    stopConditions: [...(policy.stopConditions ?? [])],
  };
}

function cloneProgressPlan(plan: ProgressPlan): ProgressPlan {
  return {
    ...plan,
    visibleMilestones: [...plan.visibleMilestones],
    phaseNames: plan.phaseNames ? [...plan.phaseNames] : undefined,
    phaseDeadlines: plan.phaseDeadlines ? { ...plan.phaseDeadlines } : undefined,
    silencePolicy: plan.silencePolicy ? { ...plan.silencePolicy } : undefined,
    backgroundPolicy: plan.backgroundPolicy ? { ...plan.backgroundPolicy } : undefined,
    cancelPolicy: plan.cancelPolicy ? { ...plan.cancelPolicy } : undefined,
    interactionPolicy: plan.interactionPolicy ? { ...plan.interactionPolicy } : undefined,
  };
}

function clonePresentationPlan(plan: PresentationPlan): PresentationPlan {
  return {
    ...plan,
    defaultExpandedSections: [...plan.defaultExpandedSections],
    defaultCollapsedSections: [...plan.defaultCollapsedSections],
    citationPolicy: { ...plan.citationPolicy },
    artifactActionPolicy: {
      ...plan.artifactActionPolicy,
      primaryActions: [...plan.artifactActionPolicy.primaryActions],
      secondaryActions: [...plan.artifactActionPolicy.secondaryActions],
    },
  };
}

function callback(id: string, decide: HarnessCallback['decide'], stages: HarnessCallback['stages'] = ['onPolicyDecision']): HarnessCallback {
  return { id, version: '0.1.0', stages, decide };
}

const profileCallbacks: Record<string, HarnessCallback[]> = {
  balancedDefault: [
    callback('balanced-default.latency-tier-classifier', (context) => {
      if (context.input.latencyTier) return {};
      const latencyTier = classifyLatencyTier(context.input);
      return {
        latencyTier,
        auditNotes: [{
          sourceCallbackId: 'balanced-default.latency-tier-classifier',
          severity: 'info',
          message: `Selected ${latencyTier} latency tier from request-level cost and depth signals.`,
        }],
      };
    }, ['classifyIntent']),
    callback('balanced-default.context-audit-intent', (context) => {
      if (!isContextAuditFollowup(context.input)) return {};
      return {
        intentSignals: {
          intentMode: 'audit',
          explorationMode: 'minimal',
          confidence: 0.82,
          reasons: ['current turn asks for audit/context facts from existing session state'],
        },
        capabilityHints: {
          candidates: [{
            kind: 'runtime-adapter',
            id: 'runtime.direct-context-answer',
            manifestRef: 'runtime://direct-context-answer',
            score: 0.9,
            reasons: ['answer can be produced from existing artifacts, runs, and execution refs'],
          }],
          preferredCapabilityIds: ['runtime.direct-context-answer'],
          sideEffects: {
            network: 'block',
            workspaceWrite: 'block',
            externalMutation: 'block',
            codeExecution: 'block',
          },
        },
        budgets: {
          contextBudget: { maxPromptTokens: 3000, maxHistoryTurns: 2, maxReferenceDigests: 8, maxFullTextRefs: 0 },
          toolBudget: {
            maxWallMs: 10000,
            maxContextTokens: 3000,
            maxToolCalls: 0,
            maxObserveCalls: 0,
            maxActionSteps: 0,
            maxNetworkCalls: 0,
            maxDownloadBytes: 0,
            maxResultItems: 12,
            maxProviders: 0,
            maxRetries: 0,
            perProviderTimeoutMs: 5000,
            costUnits: 0,
            exhaustedPolicy: 'partial-payload',
          },
        },
        verification: { intensity: 'light', requireCurrentRefs: true, requireArtifactRefs: true },
        progress: { initialStatus: 'Answering from current context', visibleMilestones: ['context', 'answer'], silenceTimeoutMs: 10000 },
        promptDirectives: [{
          id: 'direct-context-audit-answer',
          priority: 90,
          text: 'Answer this audit follow-up from existing session context only. Do not start new retrieval, downloads, reruns, repairs, or workspace side effects.',
          sourceCallbackId: 'balanced-default.context-audit-intent',
        }],
        auditNotes: [{
          sourceCallbackId: 'balanced-default.context-audit-intent',
          severity: 'info',
          message: 'Selected audit intent and direct-context runtime adapter for a low-risk context follow-up.',
        }],
      };
    }, ['classifyIntent', 'selectCapabilities', 'onToolPolicy', 'onBudgetAllocate', 'beforePromptRender', 'beforeUserProgressEvent']),
    callback('balanced-default.context', (context) => ({
      auditNotes: [{
        sourceCallbackId: 'balanced-default.context',
        severity: 'info',
        message: `balanced-default evaluated ${context.input.requestId ?? 'anonymous-request'}`,
      }],
    }), ['selectContext']),
  ],
  fastAnswer: [
    callback('fast-answer.budget', () => ({
      intentSignals: { explorationMode: 'minimal', reasons: ['fast-answer minimizes exploration'] },
      budgets: {
        contextBudget: { maxPromptTokens: 3000, maxHistoryTurns: 0, maxReferenceDigests: 3, maxFullTextRefs: 0 },
        toolBudget: {
          maxWallMs: 30000,
          maxContextTokens: 3000,
          maxToolCalls: 2,
          maxObserveCalls: 0,
          maxNetworkCalls: 1,
          maxResultItems: 5,
          maxProviders: 1,
          maxRetries: 0,
          perProviderTimeoutMs: 10000,
          costUnits: 2,
          maxActionSteps: 0,
          maxDownloadBytes: 2_000_000,
          exhaustedPolicy: 'partial-payload',
        },
      },
      progress: { initialStatus: 'Answering', visibleMilestones: ['answer'], silenceTimeoutMs: 10000 },
    }), ['setExplorationBudget', 'onBudgetAllocate', 'beforeUserProgressEvent']),
  ],
  researchGrade: [
    callback('research-grade.verification', () => ({
      intentSignals: { explorationMode: 'deep', reasons: ['research-grade requires deeper evidence'] },
      budgets: {
        contextBudget: { maxPromptTokens: 10000, maxHistoryTurns: 2, maxReferenceDigests: 16, maxFullTextRefs: 2 },
        toolBudget: {
          maxWallMs: 240000,
          maxContextTokens: 14000,
          maxToolCalls: 12,
          maxObserveCalls: 3,
          maxNetworkCalls: 8,
          maxDownloadBytes: 60_000_000,
          maxResultItems: 50,
          maxProviders: 4,
          maxRetries: 2,
          perProviderTimeoutMs: 45000,
          costUnits: 20,
        },
      },
      verification: { intensity: 'strict', requireCitations: true, requireCurrentRefs: true, requireArtifactRefs: true },
      progress: { initialStatus: 'Researching', visibleMilestones: ['search', 'evidence', 'synthesis', 'verification'], silenceTimeoutMs: 45000 },
    }), ['setExplorationBudget', 'onBudgetAllocate', 'beforeResultValidation']),
  ],
  debugRepair: [
    callback('debug-repair.policy', () => ({
      intentSignals: { intentMode: 'repair', explorationMode: 'normal', reasons: ['debug-repair focuses repair context'] },
      repair: { kind: 'repair-rerun', maxAttempts: 2, includeStdoutSummary: true, includeStderrSummary: true },
      budgets: {
        toolBudget: { maxRetries: 2, maxActionSteps: 4, maxWallMs: 180000 },
      },
      progress: { initialStatus: 'Repairing', visibleMilestones: ['failure', 'patch', 'validate'] },
    }), ['classifyIntent', 'onRepairRequired', 'beforeRepairDispatch']),
  ],
  lowCost: [
    callback('low-cost.budget', () => ({
      intentSignals: { explorationMode: 'minimal', reasons: ['low-cost tightens provider and download budgets'] },
      budgets: {
        contextBudget: { maxPromptTokens: 3500, maxHistoryTurns: 1, maxReferenceDigests: 4, maxFullTextRefs: 0 },
        toolBudget: {
          maxWallMs: 45000,
          maxContextTokens: 4000,
          maxToolCalls: 3,
          maxObserveCalls: 1,
          maxNetworkCalls: 2,
          maxDownloadBytes: 1_000_000,
          maxResultItems: 8,
          maxProviders: 1,
          maxRetries: 0,
          perProviderTimeoutMs: 15000,
          costUnits: 1,
        },
      },
    }), ['setExplorationBudget', 'onBudgetAllocate']),
  ],
  privacyStrict: [
    callback('privacy-strict.safety', () => ({
      blockedCapabilities: ['network', 'external-upload', 'workspace-write'],
      capabilityHints: {
        sideEffects: {
          network: 'block',
          workspaceWrite: 'block',
          externalMutation: 'block',
          codeExecution: 'block',
        },
      },
      budgets: {
        toolBudget: { maxNetworkCalls: 0, maxDownloadBytes: 0, maxProviders: 0 },
      },
      verification: { intensity: 'strict', requireCurrentRefs: true },
      auditNotes: [{
        sourceCallbackId: 'privacy-strict.safety',
        severity: 'info',
        message: 'Network and external side effects blocked by privacy-strict profile.',
      }],
    }), ['onToolPolicy', 'onBudgetAllocate', 'beforeResultValidation']),
  ],
  highRecallLiterature: [
    callback('high-recall-literature.recall', () => ({
      intentSignals: { explorationMode: 'deep', reasons: ['high-recall-literature broadens discovery before merge tightening'] },
      capabilityHints: {
        preferredCapabilityIds: ['literature.retrieval', 'pdf.extraction', 'citation.verification'],
        sideEffects: { network: 'allow' },
      },
      budgets: {
        contextBudget: { maxPromptTokens: 12000, maxHistoryTurns: 1, maxReferenceDigests: 24, maxFullTextRefs: 4 },
        toolBudget: {
          maxWallMs: 300000,
          maxContextTokens: 18000,
          maxToolCalls: 16,
          maxObserveCalls: 2,
          maxNetworkCalls: 12,
          maxDownloadBytes: 120_000_000,
          maxResultItems: 100,
          maxProviders: 5,
          maxRetries: 2,
          perProviderTimeoutMs: 60000,
          costUnits: 30,
        },
      },
      verification: { intensity: 'strict', requireCitations: true, requireCurrentRefs: true },
    }), ['selectCapabilities', 'onBudgetAllocate', 'beforeResultValidation']),
  ],
  scientificReproductionResearch: [
    callback('scientific-reproduction-research.policy', (context) => ({
      intentSignals: {
        intentMode: 'fresh',
        explorationMode: 'deep',
        reasons: ['scientific reproduction requires complete refs, reproducible artifacts, and strict verification'],
      },
      contextHints: {
        requiredContextRefs: context.input.requiredContextRefs ?? [],
        contextBudget: { maxPromptTokens: 12000, maxHistoryTurns: 1, maxReferenceDigests: 20, maxFullTextRefs: 4 },
      },
      capabilityHints: {
        candidates: [
          {
            kind: 'skill',
            id: 'scientific-reproduction.research',
            manifestRef: 'capability:scientific-reproduction.research@profile',
            score: 0.94,
            reasons: ['plans and executes minimal scientific reproduction from required refs'],
          },
          {
            kind: 'verifier',
            id: 'scientific-reproduction.verifier',
            manifestRef: 'capability:scientific-reproduction.verifier@profile',
            score: 0.92,
            reasons: ['checks reproduction artifacts, citations, and failure boundaries before handoff'],
          },
        ],
        preferredCapabilityIds: [
          'scientific-reproduction.research',
          'scientific-reproduction.verifier',
          'citation.verification',
          'artifact.reference-check',
        ],
        sideEffects: {
          network: 'requires-approval',
          workspaceWrite: 'requires-approval',
          externalMutation: 'block',
          codeExecution: 'requires-approval',
        },
      },
      budgets: {
        toolBudget: {
          maxWallMs: 360000,
          maxContextTokens: 20000,
          maxToolCalls: 18,
          maxObserveCalls: 4,
          maxActionSteps: 6,
          maxNetworkCalls: 8,
          maxDownloadBytes: 120_000_000,
          maxResultItems: 80,
          maxProviders: 4,
          maxRetries: 1,
          perProviderTimeoutMs: 60000,
          costUnits: 35,
          exhaustedPolicy: 'needs-human',
        },
      },
      verification: {
        intensity: 'strict',
        requireCitations: true,
        requireCurrentRefs: true,
        requireArtifactRefs: true,
        selectedVerifierIds: ['verifier.scientific-reproduction'],
      },
      repair: { kind: 'needs-human', maxAttempts: 1, includeStdoutSummary: true, includeStderrSummary: true },
      progress: {
        initialStatus: 'Preparing reproduction',
        visibleMilestones: ['refs', 'capabilities', 'reproduction', 'verification', 'handoff'],
        phaseNames: ['refs', 'capabilities', 'reproduction', 'verification', 'handoff'],
        silenceTimeoutMs: 60000,
        interactionPolicy: { clarification: 'allow', humanApproval: 'allow', guidanceQueue: 'allow' },
      },
      promptDirectives: [
        {
          id: 'partial-needs-human-on-budget-exhaustion',
          priority: 80,
          text: 'If reproduction budget is exhausted, return the verified partial result with missing refs/artifacts and request human guidance.',
          sourceCallbackId: 'scientific-reproduction-research.policy',
        },
      ],
      auditNotes: [{
        sourceCallbackId: 'scientific-reproduction-research.policy',
        severity: 'info',
        message: 'Scientific reproduction profile requires refs, safe side effects, strict verification, and human handoff on exhausted budget.',
      }],
    }), ['selectContext', 'selectCapabilities', 'onToolPolicy', 'onBudgetAllocate', 'beforePromptRender', 'beforeResultValidation', 'beforeUserProgressEvent']),
  ],
};

function isContextAuditFollowup(input: { prompt?: string; request?: unknown }) {
  const prompt = input.prompt?.trim() ?? '';
  if (!prompt || FRESH_WORK_HINT.test(prompt) || !CONTEXT_AUDIT_HINT.test(prompt)) return false;
  return hasPriorContext(input.request);
}

function classifyLatencyTier(input: { prompt?: string; request?: unknown; candidateCapabilities?: unknown[] }) {
  const prompt = input.prompt?.trim() ?? '';
  if (BACKGROUND_TIER_HINT.test(prompt)) return 'background' satisfies LatencyTier;
  if (DEEP_TIER_HINT.test(prompt)) return 'deep' satisfies LatencyTier;
  if (BOUNDED_TIER_HINT.test(prompt) || nonEmptyArray(input.candidateCapabilities)) return 'bounded' satisfies LatencyTier;
  if (prompt.length > 0 && prompt.length <= 180 && !hasPriorContext(input.request)) return 'instant' satisfies LatencyTier;
  return 'quick' satisfies LatencyTier;
}

function hasPriorContext(request: unknown) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const record = request as Record<string, unknown>;
  const uiState = record.uiState && typeof record.uiState === 'object' && !Array.isArray(record.uiState)
    ? record.uiState as Record<string, unknown>
    : {};
  return nonEmptyArray(record.artifacts)
    || nonEmptyArray(record.references)
    || nonEmptyArray(uiState.currentReferences)
    || nonEmptyArray(uiState.recentExecutionRefs)
    || nonEmptyArray(uiState.recentRuns)
    || nonEmptyArray(uiState.artifacts);
}

function nonEmptyArray(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

export const harnessProfiles: Record<string, HarnessProfile> = {
  'balanced-default': {
    id: 'balanced-default',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'verification', 'repair', 'progress', 'presentation', 'audit'],
    callbacks: profileCallbacks.balancedDefault,
    defaults: defaults({}),
    mergePolicy: {},
  },
  'fast-answer': {
    id: 'fast-answer',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'progress', 'presentation'],
    callbacks: profileCallbacks.fastAnswer,
    defaults: defaults({ latencyTier: 'quick', explorationMode: 'minimal', progressPlan: { ...baseProgress, initialStatus: 'Answering', silenceTimeoutMs: 10000 } }),
    mergePolicy: {},
  },
  'research-grade': {
    id: 'research-grade',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'verification', 'repair', 'progress', 'presentation', 'audit'],
    callbacks: profileCallbacks.researchGrade,
    defaults: defaults({ latencyTier: 'deep', explorationMode: 'deep', verificationPolicy: { ...baseVerification, intensity: 'strict', verificationLayers: ['shape', 'reference', 'claim', 'recompute'], requireCitations: true } }),
    mergePolicy: { allowBudgetWidening: true },
  },
  'debug-repair': {
    id: 'debug-repair',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'verification', 'repair', 'progress', 'presentation', 'audit'],
    callbacks: profileCallbacks.debugRepair,
    defaults: defaults({ latencyTier: 'bounded', intentMode: 'repair', repairContextPolicy: { ...baseRepair, kind: 'repair-rerun', maxAttempts: 2, includeStdoutSummary: true } }),
    mergePolicy: {},
  },
  'low-cost': {
    id: 'low-cost',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'progress', 'presentation'],
    callbacks: profileCallbacks.lowCost,
    defaults: defaults({ explorationMode: 'minimal' }),
    mergePolicy: {},
  },
  'privacy-strict': {
    id: 'privacy-strict',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'verification', 'progress', 'presentation', 'audit'],
    callbacks: profileCallbacks.privacyStrict,
    defaults: defaults({
      latencyTier: 'quick',
      capabilityPolicy: cheapFirstCapabilityPolicy({
        blockedCapabilities: ['network', 'external-upload', 'workspace-write'],
        sideEffects: { network: 'block', workspaceWrite: 'block', externalMutation: 'block', codeExecution: 'block' },
      }),
      toolBudget: { ...baseToolBudget, maxNetworkCalls: 0, maxDownloadBytes: 0, maxProviders: 0 },
      verificationPolicy: { ...baseVerification, intensity: 'strict', verificationLayers: ['shape', 'reference', 'claim', 'recompute'] },
    }),
    mergePolicy: {},
  },
  'high-recall-literature': {
    id: 'high-recall-literature',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'verification', 'repair', 'progress', 'presentation', 'audit'],
    callbacks: profileCallbacks.highRecallLiterature,
    defaults: defaults({
      latencyTier: 'deep',
      explorationMode: 'deep',
      capabilityPolicy: cheapFirstCapabilityPolicy({
        preferredCapabilityIds: ['literature.retrieval', 'pdf.extraction', 'citation.verification'],
        sideEffects: { ...baseSideEffects, network: 'allow' },
        candidateTiers: {
          'metadata-summary': ['runtime.artifact-list', 'runtime.artifact-resolve'],
          'tool-composition': ['literature.retrieval', 'pdf.extraction'],
          'deep-agent-project': ['citation.verification'],
        },
      }),
      verificationPolicy: { ...baseVerification, intensity: 'strict', verificationLayers: ['shape', 'reference', 'claim', 'recompute'], requireCitations: true },
    }),
    mergePolicy: { allowBudgetWidening: true },
  },
  'scientific-reproduction-research': {
    id: 'scientific-reproduction-research',
    version: '0.1.0',
    moduleStack: ['intent', 'latency', 'context', 'capability', 'budget', 'verification', 'repair', 'progress', 'presentation', 'audit'],
    callbacks: profileCallbacks.scientificReproductionResearch,
    defaults: defaults({
      latencyTier: 'deep',
      explorationMode: 'deep',
      capabilityPolicy: cheapFirstCapabilityPolicy({
        preferredCapabilityIds: ['scientific-reproduction.research', 'scientific-reproduction.verifier'],
        blockedCapabilities: ['external-mutation'],
        sideEffects: {
          network: 'requires-approval',
          workspaceWrite: 'requires-approval',
          externalMutation: 'block',
          codeExecution: 'requires-approval',
        },
        candidateTiers: {
          'metadata-summary': ['runtime.artifact-list', 'runtime.artifact-resolve', 'runtime.artifact-read'],
          'workspace-task': ['scientific-reproduction.research'],
          'deep-agent-project': ['scientific-reproduction.verifier'],
        },
      }),
      toolBudget: {
        ...baseToolBudget,
        maxWallMs: 360000,
        maxContextTokens: 20000,
        maxToolCalls: 18,
        maxObserveCalls: 4,
        maxActionSteps: 6,
        maxNetworkCalls: 8,
        maxDownloadBytes: 120_000_000,
        maxResultItems: 80,
        maxProviders: 4,
        maxRetries: 1,
        perProviderTimeoutMs: 60000,
        costUnits: 35,
        exhaustedPolicy: 'needs-human',
      },
      verificationPolicy: {
        ...baseVerification,
        intensity: 'strict',
        verificationLayers: ['shape', 'reference', 'claim', 'recompute'],
        requireCitations: true,
        requireCurrentRefs: true,
        requireArtifactRefs: true,
        selectedVerifierIds: ['verifier.scientific-reproduction'],
      },
      repairContextPolicy: { ...baseRepair, kind: 'needs-human', includeStdoutSummary: true, cheapOnly: false, checkpointArtifacts: true },
      progressPlan: {
        ...baseProgress,
        initialStatus: 'Preparing reproduction',
        visibleMilestones: ['refs', 'capabilities', 'reproduction', 'verification', 'handoff'],
        phaseNames: ['refs', 'capabilities', 'reproduction', 'verification', 'handoff'],
        silenceTimeoutMs: 60000,
      },
    }),
    mergePolicy: { allowBudgetWidening: true },
  },
};

export function getHarnessProfile(profileId: HarnessProfileId = 'balanced-default'): HarnessProfile {
  return harnessProfiles[profileId] ?? harnessProfiles['balanced-default'];
}

export interface DeterministicProfileFixture<Input = unknown, Facts = unknown, Decision = unknown> {
  schemaVersion: 'sciforge.agent-harness-deterministic-profile-fixture.v1';
  fixtureId: string;
  profileId: HarnessProfileId;
  input: Readonly<Input>;
  facts: Readonly<Facts>;
  contracts: readonly ContractFn<Input, unknown>[];
  hooks: readonly HookFn<Facts, Decision>[];
  materializedRefs: readonly string[];
  eventLog: readonly unknown[];
}

export function createDeterministicProfileFixture<Input = unknown, Facts = unknown, Decision = unknown>(options: {
  profileId?: HarnessProfileId;
  fixtureId?: string;
  input: Readonly<Input>;
  facts: Readonly<Facts>;
  contracts?: readonly ContractFn<Input, unknown>[];
  hooks?: readonly HookFn<Facts, Decision>[];
  materializedRefs?: readonly string[];
  eventLog?: readonly unknown[];
}): DeterministicProfileFixture<Input, Facts, Decision> {
  const profileId = options.profileId ?? 'balanced-default';
  const materializedRefs = sortedUnique(options.materializedRefs ?? []);
  const eventLog = [...(options.eventLog ?? [])];
  const fixtureSeed = {
    profileId,
    input: options.input,
    facts: options.facts,
    materializedRefs,
    eventLog,
  };
  return {
    schemaVersion: 'sciforge.agent-harness-deterministic-profile-fixture.v1',
    fixtureId: options.fixtureId ?? `profile-fixture-${stableHarnessDigest(fixtureSeed).slice(0, 12)}`,
    profileId,
    input: options.input,
    facts: options.facts,
    contracts: options.contracts ?? [],
    hooks: options.hooks ?? [],
    materializedRefs,
    eventLog,
  };
}

export function evaluateDeterministicProfileFixture<Input = unknown, Facts = unknown, Decision = unknown>(
  fixture: DeterministicProfileFixture<Input, Facts, Decision>,
): ThinWaistEvaluation<Input, Facts, Decision> & {
  profile: HarnessProfile;
  fixtureId: string;
  materializedRefs: readonly string[];
  eventLogDigest: string;
} {
  const profile = getHarnessProfile(fixture.profileId);
  const evaluation = evaluateThinWaist<Input, Facts, Decision>({
    input: fixture.input,
    facts: fixture.facts,
    contracts: fixture.contracts,
    hooks: fixture.hooks,
    traceId: `fixture-${stableHarnessDigest({
      fixtureId: fixture.fixtureId,
      profileId: fixture.profileId,
      eventLog: fixture.eventLog,
      materializedRefs: fixture.materializedRefs,
    }).slice(0, 12)}`,
  });
  return {
    ...evaluation,
    profile,
    fixtureId: fixture.fixtureId,
    materializedRefs: fixture.materializedRefs,
    eventLogDigest: stableHarnessDigest(fixture.eventLog),
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
