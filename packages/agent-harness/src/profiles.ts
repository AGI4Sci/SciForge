import type {
  CapabilityBudget,
  ContextBudget,
  HarnessCallback,
  HarnessDefaults,
  HarnessProfile,
  HarnessProfileId,
  ProgressPlan,
  RepairContextPolicy,
  SideEffectPolicy,
  VerificationPolicy,
} from './contracts';

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
  requireCitations: false,
  requireCurrentRefs: true,
  requireArtifactRefs: true,
};

const baseRepair: RepairContextPolicy = {
  kind: 'supplement',
  maxAttempts: 1,
  includeStdoutSummary: false,
  includeStderrSummary: true,
};

const baseProgress: ProgressPlan = {
  initialStatus: 'Planning request',
  visibleMilestones: ['context', 'capabilities', 'verification'],
  phaseNames: ['context', 'capabilities', 'verification'],
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

const CONTEXT_AUDIT_HINT = /(?:什么|哪些|哪个|怎么|怎样|为什么|为何|原因|工具|日志|记录|引用|证据|验证|中断|失败|抽取|提取|how|why|what|which|tool|log|ref|reference|evidence|verify|extract|failed|stopped|interrupted)/i;
const FRESH_WORK_HINT = /(?:重新|重跑|再跑|再检索|检索一下|搜索|查找|下载并|阅读全文|最新|今天|过去一周|生成新的|继续执行|修复|rerun|run again|search|retrieve|fetch|download|latest|today|generate new|repair)/i;

function defaults(overrides: Partial<HarnessDefaults>): HarnessDefaults {
  return {
    intentMode: 'fresh',
    explorationMode: 'normal',
    allowedContextRefs: [],
    blockedContextRefs: [],
    requiredContextRefs: [],
    contextBudget: { ...baseContextBudget },
    capabilityPolicy: {
      candidates: [],
      preferredCapabilityIds: [],
      blockedCapabilities: [],
      sideEffects: { ...baseSideEffects },
    },
    toolBudget: { ...baseToolBudget },
    verificationPolicy: { ...baseVerification },
    repairContextPolicy: { ...baseRepair },
    progressPlan: { ...baseProgress },
    promptDirectives: [],
    ...overrides,
  };
}

function callback(id: string, decide: HarnessCallback['decide'], stages: HarnessCallback['stages'] = ['onPolicyDecision']): HarnessCallback {
  return { id, version: '0.1.0', stages, decide };
}

const profileCallbacks: Record<string, HarnessCallback[]> = {
  balancedDefault: [
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
    callbacks: profileCallbacks.balancedDefault,
    defaults: defaults({}),
    mergePolicy: {},
  },
  'fast-answer': {
    id: 'fast-answer',
    version: '0.1.0',
    callbacks: profileCallbacks.fastAnswer,
    defaults: defaults({ explorationMode: 'minimal', progressPlan: { ...baseProgress, initialStatus: 'Answering', silenceTimeoutMs: 10000 } }),
    mergePolicy: {},
  },
  'research-grade': {
    id: 'research-grade',
    version: '0.1.0',
    callbacks: profileCallbacks.researchGrade,
    defaults: defaults({ explorationMode: 'deep', verificationPolicy: { ...baseVerification, intensity: 'strict', requireCitations: true } }),
    mergePolicy: { allowBudgetWidening: true },
  },
  'debug-repair': {
    id: 'debug-repair',
    version: '0.1.0',
    callbacks: profileCallbacks.debugRepair,
    defaults: defaults({ intentMode: 'repair', repairContextPolicy: { ...baseRepair, kind: 'repair-rerun', maxAttempts: 2, includeStdoutSummary: true } }),
    mergePolicy: {},
  },
  'low-cost': {
    id: 'low-cost',
    version: '0.1.0',
    callbacks: profileCallbacks.lowCost,
    defaults: defaults({ explorationMode: 'minimal' }),
    mergePolicy: {},
  },
  'privacy-strict': {
    id: 'privacy-strict',
    version: '0.1.0',
    callbacks: profileCallbacks.privacyStrict,
    defaults: defaults({
      capabilityPolicy: {
        candidates: [],
        preferredCapabilityIds: [],
        blockedCapabilities: ['network', 'external-upload', 'workspace-write'],
        sideEffects: { network: 'block', workspaceWrite: 'block', externalMutation: 'block', codeExecution: 'block' },
      },
      toolBudget: { ...baseToolBudget, maxNetworkCalls: 0, maxDownloadBytes: 0, maxProviders: 0 },
      verificationPolicy: { ...baseVerification, intensity: 'strict' },
    }),
    mergePolicy: {},
  },
  'high-recall-literature': {
    id: 'high-recall-literature',
    version: '0.1.0',
    callbacks: profileCallbacks.highRecallLiterature,
    defaults: defaults({
      explorationMode: 'deep',
      capabilityPolicy: {
        candidates: [],
        preferredCapabilityIds: ['literature.retrieval', 'pdf.extraction', 'citation.verification'],
        blockedCapabilities: [],
        sideEffects: { ...baseSideEffects, network: 'allow' },
      },
      verificationPolicy: { ...baseVerification, intensity: 'strict', requireCitations: true },
    }),
    mergePolicy: { allowBudgetWidening: true },
  },
  'scientific-reproduction-research': {
    id: 'scientific-reproduction-research',
    version: '0.1.0',
    callbacks: profileCallbacks.scientificReproductionResearch,
    defaults: defaults({
      explorationMode: 'deep',
      capabilityPolicy: {
        candidates: [],
        preferredCapabilityIds: ['scientific-reproduction.research', 'scientific-reproduction.verifier'],
        blockedCapabilities: ['external-mutation'],
        sideEffects: {
          network: 'requires-approval',
          workspaceWrite: 'requires-approval',
          externalMutation: 'block',
          codeExecution: 'requires-approval',
        },
      },
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
        requireCitations: true,
        requireCurrentRefs: true,
        requireArtifactRefs: true,
        selectedVerifierIds: ['verifier.scientific-reproduction'],
      },
      repairContextPolicy: { ...baseRepair, kind: 'needs-human', includeStdoutSummary: true },
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
