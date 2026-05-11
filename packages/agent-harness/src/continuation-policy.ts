import type {
  BackgroundContinuationRecord,
  BackgroundContinuationRevision,
  BackgroundContinuationStatus,
  BackgroundContinuationTrigger,
  ContinuationPolicy,
  ContinuationRevisionKind,
  FirstResultKind,
  FirstResultRecord,
  FirstResultStatus,
  LatencyTier,
  ProgressPlan,
  ResultPresentationStatus,
} from './contracts';

type ContinuationPolicyInput = Omit<ContinuationPolicy, 'revisionRequired' | 'provenanceRequired'> & {
  revisionRequired?: boolean;
  provenanceRequired?: boolean;
};

export const DEFAULT_CONTINUATION_POLICIES: Readonly<Record<LatencyTier, ContinuationPolicy>> = Object.freeze({
  instant: continuationPolicy({
    latencyTier: 'instant',
    firstResultDeadlineMs: 5000,
    backgroundAfterMs: 15000,
    firstResultKinds: ['answer', 'failure-reason', 'needs-human'],
    backgroundEnabled: false,
    foregroundStatus: 'complete',
    backgroundStatus: 'partial',
    allowedTriggers: [],
  }),
  quick: continuationPolicy({
    latencyTier: 'quick',
    firstResultDeadlineMs: 15000,
    backgroundAfterMs: 30000,
    firstResultKinds: ['answer', 'candidate-list', 'failure-reason', 'needs-human'],
    backgroundEnabled: false,
    foregroundStatus: 'complete',
    backgroundStatus: 'partial',
    allowedTriggers: ['foreground-budget-exhausted', 'first-result-deadline'],
  }),
  bounded: continuationPolicy({
    latencyTier: 'bounded',
    firstResultDeadlineMs: 30000,
    backgroundAfterMs: 180000,
    firstResultKinds: ['answer', 'candidate-list', 'partial-artifact', 'failure-reason', 'needs-human'],
    backgroundEnabled: true,
    foregroundStatus: 'partial',
    backgroundStatus: 'background-running',
    allowedTriggers: ['foreground-budget-exhausted', 'first-result-deadline', 'repair-continuation'],
  }),
  deep: continuationPolicy({
    latencyTier: 'deep',
    firstResultDeadlineMs: 30000,
    backgroundAfterMs: 180000,
    firstResultKinds: ['answer', 'candidate-list', 'partial-artifact', 'failure-reason', 'needs-human'],
    backgroundEnabled: true,
    foregroundStatus: 'partial',
    backgroundStatus: 'background-running',
    allowedTriggers: ['foreground-budget-exhausted', 'first-result-deadline', 'deep-verification', 'repair-continuation'],
  }),
  background: continuationPolicy({
    latencyTier: 'background',
    firstResultDeadlineMs: 30000,
    backgroundAfterMs: 30000,
    firstResultKinds: ['answer', 'candidate-list', 'partial-artifact', 'failure-reason', 'needs-human'],
    backgroundEnabled: true,
    foregroundStatus: 'background-running',
    backgroundStatus: 'background-running',
    allowedTriggers: ['foreground-budget-exhausted', 'first-result-deadline', 'user-requested-background', 'deep-verification', 'repair-continuation'],
  }),
});

export function getContinuationPolicy(latencyTier: LatencyTier, progressPlan?: Pick<ProgressPlan, 'firstResultDeadlineMs' | 'backgroundAfterMs' | 'backgroundContinuation'>): ContinuationPolicy {
  const policy = DEFAULT_CONTINUATION_POLICIES[latencyTier] ?? DEFAULT_CONTINUATION_POLICIES.quick;
  return continuationPolicy({
    ...policy,
    firstResultDeadlineMs: progressPlan?.firstResultDeadlineMs ?? policy.firstResultDeadlineMs,
    backgroundAfterMs: progressPlan?.backgroundAfterMs ?? policy.backgroundAfterMs,
    backgroundEnabled: progressPlan?.backgroundContinuation ?? policy.backgroundEnabled,
    firstResultKinds: [...policy.firstResultKinds],
    allowedTriggers: [...policy.allowedTriggers],
  });
}

export function createFirstResultRecord(input: {
  id: string;
  latencyTier: LatencyTier;
  kind: FirstResultKind;
  status?: FirstResultStatus;
  createdAtMs: number;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  deadlineMs?: number;
  elapsedMs?: number;
  presentationRef?: string;
  artifactRefs?: string[];
  evidenceRefs?: string[];
  failureReason?: string;
  needsHumanReason?: string;
  backgroundContinuationId?: string;
}): FirstResultRecord {
  const policy = getContinuationPolicy(input.latencyTier);
  return {
    schemaVersion: 'sciforge.first-result-record.v1',
    id: input.id,
    requestId: input.requestId,
    runId: input.runId,
    traceRef: input.traceRef,
    latencyTier: input.latencyTier,
    kind: input.kind,
    status: input.status ?? firstResultStatusForKind(input.kind),
    createdAtMs: input.createdAtMs,
    deadlineMs: input.deadlineMs ?? policy.firstResultDeadlineMs,
    elapsedMs: input.elapsedMs,
    presentationRef: input.presentationRef,
    artifactRefs: sortedUnique(input.artifactRefs ?? []),
    evidenceRefs: sortedUnique(input.evidenceRefs ?? []),
    failureReason: input.failureReason,
    needsHumanReason: input.needsHumanReason,
    backgroundContinuationId: input.backgroundContinuationId,
  };
}

export function createBackgroundContinuationRecord(input: {
  id: string;
  latencyTier: LatencyTier;
  foregroundResultId: string;
  createdAtMs: number;
  reason: string;
  trigger?: BackgroundContinuationTrigger;
  status?: BackgroundContinuationStatus;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  provenanceRefs?: string[];
  revisions?: BackgroundContinuationRevision[];
}): BackgroundContinuationRecord {
  const policy = getContinuationPolicy(input.latencyTier);
  const trigger = input.trigger ?? policy.allowedTriggers[0] ?? 'foreground-budget-exhausted';
  return {
    schemaVersion: 'sciforge.background-continuation-record.v1',
    id: input.id,
    requestId: input.requestId,
    runId: input.runId,
    traceRef: input.traceRef,
    latencyTier: input.latencyTier,
    trigger,
    status: input.status ?? 'queued',
    createdAtMs: input.createdAtMs,
    foregroundResultId: input.foregroundResultId,
    reason: input.reason,
    provenanceRefs: sortedUnique(input.provenanceRefs ?? []),
    revisions: [...(input.revisions ?? [])],
  };
}

export function createBackgroundContinuationRevision(input: {
  id: string;
  revision: number;
  kind: ContinuationRevisionKind;
  createdAtMs: number;
  summary: string;
  supersedesRevisionId?: string;
  presentationRef?: string;
  artifactRefs?: string[];
  evidenceRefs?: string[];
  verificationRefs?: string[];
  provenanceRefs?: string[];
}): BackgroundContinuationRevision {
  return {
    id: input.id,
    revision: input.revision,
    kind: input.kind,
    createdAtMs: input.createdAtMs,
    summary: input.summary,
    supersedesRevisionId: input.supersedesRevisionId,
    presentationRef: input.presentationRef,
    artifactRefs: sortedUnique(input.artifactRefs ?? []),
    evidenceRefs: sortedUnique(input.evidenceRefs ?? []),
    verificationRefs: sortedUnique(input.verificationRefs ?? []),
    provenanceRefs: sortedUnique(input.provenanceRefs ?? []),
  };
}

export function presentationStatusForFirstResult(kind: FirstResultKind, latencyTier: LatencyTier): ResultPresentationStatus {
  if (kind === 'failure-reason') return 'failed';
  if (kind === 'needs-human') return 'needs-human';
  if (kind === 'candidate-list' || kind === 'partial-artifact') return 'partial';
  return getContinuationPolicy(latencyTier).foregroundStatus;
}

function continuationPolicy(policy: ContinuationPolicyInput): ContinuationPolicy {
  return {
    ...policy,
    revisionRequired: policy.revisionRequired ?? true,
    provenanceRequired: policy.provenanceRequired ?? true,
    firstResultKinds: [...policy.firstResultKinds],
    allowedTriggers: [...policy.allowedTriggers],
  };
}

function firstResultStatusForKind(kind: FirstResultKind): FirstResultStatus {
  if (kind === 'failure-reason') return 'failed';
  if (kind === 'needs-human') return 'needs-human';
  if (kind === 'candidate-list' || kind === 'partial-artifact') return 'partial';
  return 'ready';
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
