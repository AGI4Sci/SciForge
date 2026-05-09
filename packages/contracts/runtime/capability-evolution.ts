import type { CapabilityKind } from './capabilities';

export const CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID = 'sciforge.capability-evolution-record.v1' as const;
export const CAPABILITY_EVOLUTION_COMPACT_SUMMARY_CONTRACT_ID = 'sciforge.capability-evolution-compact-summary.v1' as const;
export const CAPABILITY_EVOLUTION_BROKER_DIGEST_CONTRACT_ID = 'sciforge.capability-evolution-broker-digest.v1' as const;
export const CAPABILITY_EVOLUTION_CANDIDATE_SET_CONTRACT_ID = 'sciforge.capability-evolution-candidate-set.v1' as const;

export type CapabilityEvolutionRecordStatus =
  | 'succeeded'
  | 'failed'
  | 'fallback-succeeded'
  | 'fallback-failed'
  | 'repair-succeeded'
  | 'repair-failed'
  | 'needs-human';

export type ComposedCapabilityResultStatus =
  | 'succeeded'
  | 'failed'
  | 'fallback-succeeded'
  | 'fallback-failed'
  | 'repair-needed'
  | 'repair-succeeded'
  | 'needs-human';

export type CapabilityFallbackTrigger =
  | 'schema-invalid'
  | 'validation-failed'
  | 'provider-unavailable'
  | 'timeout'
  | 'missing-artifact'
  | 'execution-failed'
  | 'low-confidence'
  | 'policy';

export type CapabilityFallbackBlocker =
  | 'unsafe-side-effect'
  | 'requires-human-approval'
  | 'atomic-capability-unavailable'
  | 'data-loss-risk'
  | 'privacy-risk'
  | 'budget-exhausted'
  | 'policy';

export interface CapabilityProviderRef {
  id: string;
  kind?: 'local-runtime' | 'backend-tool' | 'agent' | 'package' | 'human' | 'external';
  version?: string;
  detailRef?: string;
}

export interface SelectedCapabilityRef {
  id: string;
  kind?: CapabilityKind | 'composed';
  providerId?: string;
  role?: 'primary' | 'fallback' | 'repair' | 'validator' | 'observer';
  contractRef?: string;
}

export interface CapabilityValidationResultRef {
  verdict: 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';
  validatorId?: string;
  failureCode?: string;
  summary?: string;
  resultRef?: string;
}

export interface CapabilityRepairAttemptRef {
  id: string;
  status: 'attempted' | 'succeeded' | 'failed' | 'skipped';
  reason?: string;
  patchRef?: string;
  executionUnitRefs?: string[];
  artifactRefs?: string[];
  validationResult?: CapabilityValidationResultRef;
  startedAt?: string;
  completedAt?: string;
}

export interface CapabilityLatencyCostSummary {
  latencyMs?: number;
  estimatedCostUsd?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  executionCount?: number;
}

export type CapabilityPromotionProposalKind =
  | 'composed-capability'
  | 'validator-update'
  | 'fallback-policy-update'
  | 'repair-hint-update';

export interface CapabilityEvolutionSuggestedUpdates {
  capabilityIds?: string[];
  validatorIds?: string[];
  failureCodes?: string[];
  fallbackTriggers?: CapabilityFallbackTrigger[];
  repairHints?: string[];
}

export interface CapabilityPromotionCandidate {
  eligible: boolean;
  reason?: string;
  candidateId?: string;
  suggestedCapabilityId?: string;
  supportingRecordRefs?: string[];
  proposalKind?: CapabilityPromotionProposalKind;
  supportCount?: number;
  confidence?: number;
  observedPattern?: string;
  suggestedUpdates?: CapabilityEvolutionSuggestedUpdates;
}

export type CapabilityEvolutionCandidateKind =
  | 'promotion'
  | 'repair-hint-improvement';

export interface CapabilityEvolutionCandidate {
  id: string;
  kind: CapabilityEvolutionCandidateKind;
  proposalKind: CapabilityPromotionProposalKind;
  sourceRef?: string;
  supportingRecordRefs: string[];
  supportCount: number;
  confidence?: number;
  reason?: string;
  observedPattern?: string;
  suggestedCapabilityId?: string;
  suggestedUpdates?: CapabilityEvolutionSuggestedUpdates;
}

export interface CapabilityEvolutionCandidateSet {
  schemaVersion: typeof CAPABILITY_EVOLUTION_CANDIDATE_SET_CONTRACT_ID;
  generatedAt: string;
  sourceRef?: string;
  totalCandidates: number;
  promotionCandidates: CapabilityEvolutionCandidate[];
  repairHintImprovementCandidates: CapabilityEvolutionCandidate[];
}

export interface ComposedCapabilityFallbackPolicy {
  atomicCapabilities: SelectedCapabilityRef[];
  fallbackToAtomicWhen: CapabilityFallbackTrigger[];
  doNotFallbackWhen: CapabilityFallbackBlocker[];
  retryBudget: {
    maxRetries: number;
    maxRepairAttempts?: number;
    maxFallbackAttempts?: number;
    timeoutMs?: number;
  };
  fallbackContext?: {
    preserveArtifactRefs?: string[];
    preserveExecutionUnitRefs?: string[];
    validationResultRefs?: string[];
    reason?: string;
    notes?: string[];
  };
}

export interface ComposedCapabilityAtomicTrace {
  capabilityId: string;
  providerId?: string;
  status: 'planned' | 'running' | 'succeeded' | 'failed' | 'skipped';
  failureCode?: string;
  executionUnitRefs?: string[];
  artifactRefs?: string[];
  validationResult?: CapabilityValidationResultRef;
}

export interface ComposedCapabilityResult {
  status: ComposedCapabilityResultStatus;
  failureCode?: string;
  fallbackable: boolean;
  confidence?: number;
  coverage?: number;
  recoverActions: string[];
  atomicTrace: ComposedCapabilityAtomicTrace[];
  relatedRefs: {
    runId?: string;
    glueCodeRef?: string;
    inputSchemaRefs?: string[];
    outputSchemaRefs?: string[];
    executionUnitRefs?: string[];
    artifactRefs?: string[];
    validationResultRefs?: string[];
    ledgerRecordRef?: string;
  };
}

export interface CapabilityFallbackDecisionSummary {
  trigger?: CapabilityFallbackTrigger;
  reason?: string;
  fallbackable: boolean;
  atomicCapabilityIds: string[];
  blockedBy: CapabilityFallbackBlocker[];
  recoverActions: string[];
}

export interface CapabilityAtomicTraceSummary {
  capabilityId: string;
  providerId?: string;
  status: ComposedCapabilityAtomicTrace['status'];
  failureCode?: string;
  executionUnitRefs: string[];
  artifactRefs: string[];
  validationSummary?: string;
}

export interface CapabilityEvolutionRecord {
  schemaVersion: typeof CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID;
  id: string;
  recordedAt: string;
  runId?: string;
  sessionId?: string;
  goalSummary: string;
  selectedCapabilities: SelectedCapabilityRef[];
  providers: CapabilityProviderRef[];
  inputSchemaRefs: string[];
  outputSchemaRefs: string[];
  glueCodeRef?: string;
  executionUnitRefs: string[];
  artifactRefs: string[];
  validationResult?: CapabilityValidationResultRef;
  failureCode?: string;
  recoverActions: string[];
  repairAttempts: CapabilityRepairAttemptRef[];
  fallbackPolicy?: ComposedCapabilityFallbackPolicy;
  composedResult?: ComposedCapabilityResult;
  finalStatus: CapabilityEvolutionRecordStatus;
  latencyCostSummary?: CapabilityLatencyCostSummary;
  promotionCandidate?: CapabilityPromotionCandidate;
  metadata?: Record<string, unknown>;
}

export interface CapabilityEvolutionCompactRecord {
  id: string;
  recordedAt: string;
  runId?: string;
  goalSummary: string;
  selectedCapabilityIds: string[];
  providerIds: string[];
  finalStatus: CapabilityEvolutionRecordStatus;
  failureCode?: string;
  fallbackable?: boolean;
  fallbackDecision?: CapabilityFallbackDecisionSummary;
  atomicTrace?: CapabilityAtomicTraceSummary[];
  recoverActions: string[];
  repairAttemptCount: number;
  artifactRefs: string[];
  executionUnitRefs: string[];
  validationSummary?: string;
  promotionCandidate?: CapabilityPromotionCandidate;
  recordRef?: string;
}

export interface CapabilityEvolutionCompactSummary {
  schemaVersion: typeof CAPABILITY_EVOLUTION_COMPACT_SUMMARY_CONTRACT_ID;
  generatedAt: string;
  sourceRef?: string;
  totalRecords: number;
  statusCounts: Partial<Record<CapabilityEvolutionRecordStatus, number>>;
  fallbackRecordCount: number;
  repairRecordCount: number;
  promotionCandidates: CapabilityEvolutionCompactRecord[];
  recentRecords: CapabilityEvolutionCompactRecord[];
}

export interface CapabilityEvolutionBrokerDigest {
  schemaVersion: typeof CAPABILITY_EVOLUTION_BROKER_DIGEST_CONTRACT_ID;
  generatedAt: string;
  sourceRef?: string;
  totalRecords: number;
  consumedRecordRefs: string[];
  selectedCapabilityIds: string[];
  failureCodes: string[];
  recoverActions: string[];
  promotionCandidateCount: number;
  repairHintImprovementCandidateCount: number;
}
