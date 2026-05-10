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
  silenceTimeoutMs: 30000,
  backgroundContinuation: false,
};

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
};

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
};

export function getHarnessProfile(profileId: HarnessProfileId = 'balanced-default'): HarnessProfile {
  return harnessProfiles[profileId] ?? harnessProfiles['balanced-default'];
}
