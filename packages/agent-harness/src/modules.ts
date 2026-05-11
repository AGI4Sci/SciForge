import type { HarnessModule } from './contracts';

export const harnessModules: Record<string, HarnessModule> = {
  intent: {
    id: 'intent',
    version: '0.1.0',
    ownedStages: ['classifyIntent', 'selectProfile'],
    inputs: ['prompt', 'conversationSignals', 'runtimeConfig'],
    outputs: ['intentMode', 'explorationMode', 'riskSignals'],
    cost: 'free',
    defaultTierApplicability: ['instant', 'quick', 'bounded', 'deep', 'background'],
  },
  latency: {
    id: 'latency',
    version: '0.1.0',
    ownedStages: ['classifyIntent', 'setExplorationBudget'],
    inputs: ['prompt', 'latencyTier', 'riskSignals', 'sideEffects', 'contextAvailability'],
    outputs: ['latencyTier', 'firstResultDeadlineMs', 'backgroundAfterMs'],
    cost: 'free',
    defaultTierApplicability: ['instant', 'quick', 'bounded', 'deep', 'background'],
  },
  context: {
    id: 'context',
    version: '0.1.0',
    ownedStages: ['selectContext'],
    inputs: ['latencyTier', 'contextRefs', 'requiredContextRefs', 'blockedContextRefs'],
    outputs: ['allowedContextRefs', 'requiredContextRefs', 'contextBudget'],
    cost: 'cheap',
    defaultTierApplicability: ['instant', 'quick', 'bounded', 'deep', 'background'],
  },
  capability: {
    id: 'capability',
    version: '0.1.0',
    ownedStages: ['selectCapabilities', 'onBeforeCapabilityBroker', 'onAfterCapabilityBroker'],
    inputs: ['latencyTier', 'candidateCapabilities', 'capabilityManifests', 'failureHistory'],
    outputs: ['candidateTiers', 'escalationPlan', 'preferredCapabilityIds'],
    cost: 'cheap',
    defaultTierApplicability: ['quick', 'bounded', 'deep', 'background'],
  },
  budget: {
    id: 'budget',
    version: '0.1.0',
    ownedStages: ['onToolPolicy', 'onBudgetAllocate', 'onBudgetDebit'],
    inputs: ['latencyTier', 'capabilityPolicy', 'budgetOverrides'],
    outputs: ['contextBudget', 'toolBudget', 'sideEffectPolicy'],
    cost: 'free',
    defaultTierApplicability: ['instant', 'quick', 'bounded', 'deep', 'background'],
  },
  verification: {
    id: 'verification',
    version: '0.1.0',
    ownedStages: ['beforeResultValidation', 'afterResultValidation', 'onVerifierVerdict'],
    inputs: ['latencyTier', 'riskSignals', 'artifactRefs', 'claims'],
    outputs: ['verificationLayers', 'selectedVerifierIds', 'validationResult'],
    cost: 'bounded',
    defaultTierApplicability: ['quick', 'bounded', 'deep', 'background'],
  },
  repair: {
    id: 'repair',
    version: '0.1.0',
    ownedStages: ['onRepairRequired', 'beforeRepairDispatch', 'afterRepairAttempt'],
    inputs: ['latencyTier', 'validationFailure', 'repairHistory', 'toolBudget'],
    outputs: ['repairContextPolicy', 'checkpointArtifacts', 'partialFailurePresentation'],
    cost: 'bounded',
    defaultTierApplicability: ['bounded', 'deep', 'background'],
  },
  progress: {
    id: 'progress',
    version: '0.1.0',
    ownedStages: ['beforeUserProgressEvent', 'onInteractionRequested', 'onBackgroundContinuation', 'onCancelRequested'],
    inputs: ['latencyTier', 'phaseState', 'elapsedMs'],
    outputs: ['progressPlan', 'partialResultDeadline', 'backgroundPolicy'],
    cost: 'free',
    defaultTierApplicability: ['instant', 'quick', 'bounded', 'deep', 'background'],
  },
  presentation: {
    id: 'presentation',
    version: '0.1.0',
    ownedStages: ['beforeResultPresentation'],
    inputs: ['latencyTier', 'resultPayload', 'verificationResult', 'repairResult'],
    outputs: ['presentationPlan', 'resultPresentationContract'],
    cost: 'cheap',
    defaultTierApplicability: ['instant', 'quick', 'bounded', 'deep', 'background'],
  },
  audit: {
    id: 'audit',
    version: '0.1.0',
    ownedStages: ['onAuditRecord', 'onRunCompleted', 'onRunFailed', 'onRunCancelled'],
    inputs: ['trace', 'budgetLedger', 'repairTelemetry', 'provenance'],
    outputs: ['auditRecord', 'replayMetadata', 'trainingRecord'],
    cost: 'bounded',
    defaultTierApplicability: ['bounded', 'deep', 'background'],
  },
};

export function getHarnessModule(moduleId: string): HarnessModule | undefined {
  return harnessModules[moduleId];
}

export function moduleStackForTier(latencyTier: HarnessModule['defaultTierApplicability'][number]): HarnessModule[] {
  return Object.values(harnessModules).filter((module) => module.defaultTierApplicability.includes(latencyTier));
}
