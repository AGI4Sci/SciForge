import type {
  CapabilityEscalationTier,
  ExplorationActivityKind,
  ExplorationDedupKeyKind,
  ExplorationEarlyStopReason,
  ExplorationPolicy,
  ExplorationTopKPolicy,
  LatencyTier,
} from './contracts';

export const DEFAULT_EXPLORATION_POLICIES: Readonly<Record<LatencyTier, ExplorationPolicy>> = Object.freeze({
  instant: explorationPolicy({
    latencyTier: 'instant',
    topK: { retrieval: 0, download: 0, artifactScan: 2, verifier: 0, repair: 0 },
    earlyStop: {
      reasons: ['answer-sufficient', 'user-goal-satisfied', 'duplicate-exploration', 'human-required'],
      budgetRemainingRatioThreshold: 0.35,
      diminishingReturnMinNewEvidence: 1,
      stopAfterFirstResultForSidecars: true,
      remainingUpgradePaths: ['metadata-summary', 'single-tool'],
      requireStopReason: true,
    },
    dedup: dedupPolicy('request', 15 * 60 * 1000, ['ref', 'artifact-hash']),
    auditReasonRequired: true,
  }),
  quick: explorationPolicy({
    latencyTier: 'quick',
    topK: { retrieval: 3, download: 1, artifactScan: 4, verifier: 1, repair: 0 },
    earlyStop: {
      reasons: ['answer-sufficient', 'evidence-sufficient', 'budget-near-exhaustion', 'duplicate-exploration', 'first-result-ready', 'human-required'],
      budgetRemainingRatioThreshold: 0.25,
      diminishingReturnMinNewEvidence: 1,
      stopAfterFirstResultForSidecars: true,
      remainingUpgradePaths: ['single-tool', 'tool-composition', 'workspace-task'],
      requireStopReason: true,
    },
    dedup: dedupPolicy('run', 30 * 60 * 1000, ['ref', 'query-provider', 'artifact-hash', 'verifier-result']),
    auditReasonRequired: true,
  }),
  bounded: explorationPolicy({
    latencyTier: 'bounded',
    topK: { retrieval: 8, download: 3, artifactScan: 12, verifier: 2, repair: 1 },
    earlyStop: {
      reasons: ['answer-sufficient', 'evidence-sufficient', 'diminishing-returns', 'budget-near-exhaustion', 'user-goal-satisfied', 'duplicate-exploration', 'first-result-ready'],
      budgetRemainingRatioThreshold: 0.2,
      diminishingReturnMinNewEvidence: 1,
      stopAfterFirstResultForSidecars: true,
      remainingUpgradePaths: ['tool-composition', 'workspace-task', 'deep-agent-project', 'repair-or-background'],
      requireStopReason: true,
    },
    dedup: dedupPolicy('workspace', 60 * 60 * 1000, ['ref', 'query-provider', 'artifact-hash', 'verifier-result', 'download-url', 'repair-signature']),
    auditReasonRequired: true,
  }),
  deep: explorationPolicy({
    latencyTier: 'deep',
    topK: { retrieval: 20, download: 8, artifactScan: 24, verifier: 4, repair: 2 },
    earlyStop: {
      reasons: ['answer-sufficient', 'evidence-sufficient', 'diminishing-returns', 'budget-near-exhaustion', 'user-goal-satisfied', 'duplicate-exploration'],
      budgetRemainingRatioThreshold: 0.15,
      diminishingReturnMinNewEvidence: 2,
      stopAfterFirstResultForSidecars: false,
      remainingUpgradePaths: ['deep-agent-project', 'repair-or-background'],
      requireStopReason: true,
    },
    dedup: dedupPolicy('workspace', 2 * 60 * 60 * 1000, ['ref', 'query-provider', 'artifact-hash', 'verifier-result', 'download-url', 'repair-signature']),
    auditReasonRequired: true,
  }),
  background: explorationPolicy({
    latencyTier: 'background',
    topK: { retrieval: 50, download: 16, artifactScan: 50, verifier: 6, repair: 3 },
    earlyStop: {
      reasons: ['evidence-sufficient', 'diminishing-returns', 'budget-near-exhaustion', 'user-goal-satisfied', 'duplicate-exploration', 'human-required'],
      budgetRemainingRatioThreshold: 0.1,
      diminishingReturnMinNewEvidence: 2,
      stopAfterFirstResultForSidecars: false,
      remainingUpgradePaths: ['repair-or-background'],
      requireStopReason: true,
    },
    dedup: dedupPolicy('workspace', 4 * 60 * 60 * 1000, ['ref', 'query-provider', 'artifact-hash', 'verifier-result', 'download-url', 'repair-signature']),
    auditReasonRequired: true,
  }),
});

export interface ExplorationEarlyStopInput {
  reason?: ExplorationEarlyStopReason;
  answerSufficient?: boolean;
  evidenceSufficient?: boolean;
  userGoalSatisfied?: boolean;
  duplicate?: boolean;
  firstResultReady?: boolean;
  humanRequired?: boolean;
  budgetRemainingRatio?: number;
  newEvidenceCount?: number;
}

export interface ExplorationEarlyStopDecision {
  stop: boolean;
  reason?: ExplorationEarlyStopReason;
  remainingUpgradePaths: CapabilityEscalationTier[];
}

export interface ExplorationDedupInput {
  kind: ExplorationDedupKeyKind;
  ref?: string;
  query?: string;
  providerId?: string;
  artifactHash?: string;
  verifierId?: string;
  verifierResultHash?: string;
  url?: string;
  repairSignature?: string;
}

export function getExplorationPolicy(latencyTier: LatencyTier): ExplorationPolicy {
  return clonePolicy(DEFAULT_EXPLORATION_POLICIES[latencyTier] ?? DEFAULT_EXPLORATION_POLICIES.quick);
}

export function topKForActivity(policy: Pick<ExplorationPolicy, 'topK'>, activity: ExplorationActivityKind): number {
  if (activity === 'artifact-scan') return policy.topK.artifactScan;
  return policy.topK[activity];
}

export function shouldEarlyStopExploration(policy: ExplorationPolicy, input: ExplorationEarlyStopInput): ExplorationEarlyStopDecision {
  const reason = input.reason
    ?? (input.answerSufficient ? 'answer-sufficient' : undefined)
    ?? (input.evidenceSufficient ? 'evidence-sufficient' : undefined)
    ?? (input.userGoalSatisfied ? 'user-goal-satisfied' : undefined)
    ?? (input.duplicate ? 'duplicate-exploration' : undefined)
    ?? (input.firstResultReady && policy.earlyStop.stopAfterFirstResultForSidecars ? 'first-result-ready' : undefined)
    ?? (input.humanRequired ? 'human-required' : undefined)
    ?? (typeof input.budgetRemainingRatio === 'number' && input.budgetRemainingRatio <= policy.earlyStop.budgetRemainingRatioThreshold ? 'budget-near-exhaustion' : undefined)
    ?? (typeof input.newEvidenceCount === 'number' && input.newEvidenceCount < policy.earlyStop.diminishingReturnMinNewEvidence ? 'diminishing-returns' : undefined);
  return {
    stop: Boolean(reason && policy.earlyStop.reasons.includes(reason)),
    reason,
    remainingUpgradePaths: [...policy.earlyStop.remainingUpgradePaths],
  };
}

export function buildExplorationDedupKey(input: ExplorationDedupInput): string | undefined {
  if (input.kind === 'ref' && input.ref) return `ref:${input.ref}`;
  if (input.kind === 'query-provider' && input.query && input.providerId) return `query-provider:${normalizeText(input.providerId)}:${normalizeText(input.query)}`;
  if (input.kind === 'artifact-hash' && input.artifactHash) return `artifact-hash:${input.artifactHash}`;
  if (input.kind === 'verifier-result' && input.verifierId && input.verifierResultHash) return `verifier-result:${normalizeText(input.verifierId)}:${input.verifierResultHash}`;
  if (input.kind === 'download-url' && input.url) return `download-url:${normalizeText(input.url)}`;
  if (input.kind === 'repair-signature' && input.repairSignature) return `repair-signature:${normalizeText(input.repairSignature)}`;
  return undefined;
}

export function isDuplicateExploration(policy: ExplorationPolicy, input: ExplorationDedupInput, seenKeys: ReadonlySet<string>): boolean {
  if (!policy.dedup.enabled || !policy.dedup.keyKinds.includes(input.kind)) return false;
  const key = buildExplorationDedupKey(input);
  return Boolean(key && seenKeys.has(key));
}

function explorationPolicy(policy: ExplorationPolicy): ExplorationPolicy {
  return clonePolicy(policy);
}

function dedupPolicy(scope: ExplorationPolicy['dedup']['scope'], ttlMs: number, keyKinds: ExplorationDedupKeyKind[]): ExplorationPolicy['dedup'] {
  return {
    enabled: true,
    keyKinds,
    scope,
    ttlMs,
    skipDuplicateByDefault: true,
  };
}

function clonePolicy(policy: ExplorationPolicy): ExplorationPolicy {
  return {
    ...policy,
    topK: { ...policy.topK },
    earlyStop: {
      ...policy.earlyStop,
      reasons: [...policy.earlyStop.reasons],
      remainingUpgradePaths: [...policy.earlyStop.remainingUpgradePaths],
    },
    dedup: {
      ...policy.dedup,
      keyKinds: [...policy.dedup.keyKinds],
    },
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
