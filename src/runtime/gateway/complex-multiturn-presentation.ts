import {
  createResultPresentationContract,
  validateResultPresentationContract,
  type ResultPresentationContract,
  type ResultPresentationStatus,
} from '@sciforge-ui/runtime-contract/result-presentation';
import type { ComplexDialogueBenchmarkReport } from './complex-dialogue-metrics.js';
import type { ConversationStateDigest, RecoveryPlan } from './conversation-state-policy.js';

type JsonMap = Record<string, unknown>;

export const COMPLEX_MULTITURN_PRESENTATION_SCHEMA_VERSION = 'sciforge.complex-multiturn-presentation.v1' as const;

export interface ComplexMultiTurnPresentationFixture {
  id: string;
  title?: string;
  tier?: string;
  scenarioKind?: string;
  expectedState?: {
    taskGraph?: {
      currentGoal?: string;
      completed?: string[];
      pending?: string[];
      blocked?: string[];
    };
    checkpointRefs?: string[];
    reusableRefs?: string[];
    staleRefs?: string[];
    backgroundJobs?: string[];
    requiredStateExplanation?: string[];
  };
  artifactExpectations?: {
    expectedArtifacts?: string[];
    artifactLineage?: string[];
    requiredObjectRefs?: string[];
    identityAssertions?: string[];
    mutationPolicy?: string;
  };
  failureInjections?: Array<{
    id: string;
    mode?: string;
    target?: string;
    expectedRecovery?: string;
    reusableEvidence?: string[];
    shouldAvoidDuplicateSideEffect?: boolean;
  }>;
  lifecycle?: {
    resumeSource?: string;
    stateAuthority?: string;
    sideEffectPolicy?: string;
    historyMutationMode?: string;
    lastStableCheckpointRef?: string;
    pendingRunRefs?: string[];
    backgroundJobRefs?: string[];
    artifactLineageExpectation?: string[];
    conflictResolution?: string;
  };
  historyMutation?: {
    mode?: string;
    discardedRefs?: string[];
    retainedRefs?: string[];
    conflictRefs?: string[];
    expectedBoundaryExplanation?: string;
  };
  presentationSnapshots?: Array<{ status: string }>;
  behaviorNotes?: string[];
}

export interface ComplexMultiturnPresentationInput {
  id?: string;
  title?: string;
  status?: ResultPresentationStatus;
  fixture?: ComplexMultiTurnPresentationFixture;
  stateDigest?: ConversationStateDigest;
  recoveryPlan?: RecoveryPlan;
  benchmarkReport?: ComplexDialogueBenchmarkReport;
  artifactRefs?: string[];
  runRefs?: string[];
  stateAuthority?: string;
  historyMutationMode?: string;
  rawDiagnosticRefs?: string[];
  needsUserChoice?: boolean;
}

export function buildComplexMultiturnPresentation(input: ComplexMultiturnPresentationInput): ResultPresentationContract {
  const fixtureState = input.fixture?.expectedState;
  const completedRefs = uniqueStrings([
    ...(input.stateDigest?.completedRefs ?? []),
    ...(input.stateDigest?.carryForwardRefs ?? []),
    ...(input.recoveryPlan?.reusableEvidenceRefs ?? []),
    ...(fixtureState?.reusableRefs ?? []),
    ...(fixtureState?.checkpointRefs ?? []),
  ]);
  const artifactRefs = uniqueStrings([
    ...(input.artifactRefs ?? []),
    ...(input.fixture?.artifactExpectations?.expectedArtifacts ?? []),
    ...(input.fixture?.artifactExpectations?.requiredObjectRefs ?? []),
    ...(input.fixture?.artifactExpectations?.artifactLineage ?? []),
    ...(input.fixture?.lifecycle?.artifactLineageExpectation ?? []),
    ...completedRefs.filter((ref) => ref.includes('artifact:') || ref.includes('/artifacts/')),
  ]);
  const pending = uniqueStrings([
    ...(input.stateDigest?.pendingWork ?? []),
    ...(fixtureState?.taskGraph?.pending ?? []),
  ]);
  const blocked = uniqueStrings([
    ...(input.stateDigest?.blockedWork ?? []),
    ...(input.recoveryPlan?.rerunWorkIds ?? []),
    ...(fixtureState?.taskGraph?.blocked ?? []),
  ]);
  const status = input.status ?? statusFromInput(input, blocked);
  const citations = [
    ...completedRefs.map((ref, index) => ({
      id: `state-ref-${index + 1}`,
      label: ref,
      ref,
      kind: ref.includes('artifact') ? 'artifact' as const : ref.includes('run') ? 'execution-unit' as const : 'unknown' as const,
      source: 'complex-multiturn-state',
      verificationState: 'not-applicable' as const,
    })),
    ...(input.benchmarkReport ? [{
      id: 'benchmark-report',
      label: input.benchmarkReport.benchmarkId,
      ref: `benchmark:${input.benchmarkReport.benchmarkId}`,
      kind: 'verification' as const,
      source: 'complex-dialogue-benchmark',
      verificationState: input.benchmarkReport.gateEvaluation?.passed === false ? 'failed' as const : 'verified' as const,
    }] : []),
  ];
  const contract = createResultPresentationContract({
    id: input.id ?? `complex-multiturn-${hashText(JSON.stringify(input)).slice(0, 10)}`,
    status,
    answerBlocks: [
      {
        id: 'state-summary',
        kind: 'status',
    title: input.title ?? input.fixture?.title ?? 'Conversation state',
    text: input.stateDigest?.summary ?? 'Complex multi-turn state is available from structured refs.',
        tone: status === 'failed' ? 'danger' : status === 'needs-human' ? 'warning' : status === 'complete' ? 'success' : 'neutral',
        citationIds: citations.slice(0, 3).map((citation) => citation.id),
      },
      {
        id: 'completed-work',
        kind: 'bullets',
        title: 'Completed',
        items: completedWorkItems(input, completedRefs),
      },
      {
        id: 'continuation-options',
        kind: 'bullets',
        title: input.needsUserChoice || status === 'needs-human' ? 'Needs user choice' : 'Can continue',
        items: continuationItems(input, pending, blocked),
        tone: input.needsUserChoice || status === 'needs-human' ? 'warning' : 'neutral',
      },
    ],
    keyFindings: [
      {
        id: 'state-authority',
        kind: 'summary',
        statement: `State authority: ${input.stateAuthority ?? input.fixture?.lifecycle?.stateAuthority ?? 'state digest and durable refs'}.`,
        citationIds: citations[0] ? [citations[0].id] : undefined,
        verificationState: 'partial',
        uncertainty: stateAuthorityUncertainty(input, citations.length),
      },
      ...(input.recoveryPlan ? [{
        id: 'recovery-plan',
        kind: 'failure' as const,
        statement: input.recoveryPlan.recommendedNext,
        citationIds: citations.slice(0, 2).map((citation) => citation.id),
        verificationState: input.recoveryPlan.status === 'ready' ? 'partial' : 'failed',
        uncertainty: citations.length ? undefined : { state: 'partial' as const, reason: input.recoveryPlan.reason },
      }] : []),
      ...(input.fixture?.failureInjections?.length ? [{
        id: 'failure-boundary',
        kind: 'failure' as const,
        statement: `${input.fixture.failureInjections.length} failure injection(s) require structured recovery instead of raw trace display.`,
        citationIds: citations.slice(0, 2).map((citation) => citation.id),
        verificationState: 'partial',
        uncertainty: citations.length ? undefined : { state: 'partial' as const, reason: 'Failure fixture did not attach a durable state ref.' },
      }] : []),
    ],
    inlineCitations: citations,
    artifactActions: artifactRefs.map((ref, index) => ({
      id: `artifact-action-${index + 1}`,
      label: `Open ${ref}`,
      ref,
      action: 'inspect',
      primary: index === 0,
    })),
    confidenceExplanation: {
      level: input.recoveryPlan?.status === 'not-recoverable' ? 'low' : input.benchmarkReport?.gateEvaluation?.passed === false ? 'medium' : 'high',
      summary: confidenceSummary(input),
      citationIds: citations.map((citation) => citation.id).slice(0, 4),
    },
    nextActions: nextActions(input, pending, blocked),
    processSummary: {
      status: status === 'background-running' ? 'running' : status === 'failed' ? 'failed' : status === 'needs-human' ? 'needs-human' : status === 'partial' ? 'partial' : 'completed',
      summary: processSummary(input),
      foldedByDefault: true,
      refs: uniqueStrings([
        ...(input.runRefs ?? []),
        ...(input.stateDigest?.stateRefs ?? []),
        ...(input.fixture?.lifecycle?.pendingRunRefs ?? []),
        ...(input.fixture?.lifecycle?.backgroundJobRefs ?? []),
      ]),
      items: [
        { id: 'pending', label: `${pending.length} pending work item(s)`, status: pending.length ? 'pending' : 'completed', refs: pending },
        { id: 'blocked', label: `${blocked.length} blocked/recoverable item(s)`, status: blocked.length ? 'blocked' : 'completed', refs: blocked },
        {
          id: 'state-authority',
          label: `State authority: ${input.stateAuthority ?? input.fixture?.lifecycle?.stateAuthority ?? 'digest'}`,
          status: input.fixture?.lifecycle?.resumeSource ?? input.stateDigest?.relation ?? 'available',
          refs: uniqueStrings([
            ...(input.stateDigest?.stateRefs ?? []),
            input.fixture?.lifecycle?.lastStableCheckpointRef,
          ].filter((ref): ref is string => Boolean(ref))),
        },
        {
          id: 'history-mutation',
          label: input.fixture?.historyMutation?.expectedBoundaryExplanation ?? `History mutation: ${input.historyMutationMode ?? input.fixture?.historyMutation?.mode ?? 'none'}`,
          status: input.historyMutationMode ?? input.fixture?.historyMutation?.mode ?? 'none',
          refs: uniqueStrings([
            ...(input.fixture?.historyMutation?.discardedRefs ?? []),
            ...(input.fixture?.historyMutation?.retainedRefs ?? []),
            ...(input.fixture?.historyMutation?.conflictRefs ?? []),
          ]),
        },
      ],
    },
    diagnosticsRefs: [
      ...uniqueStrings(input.rawDiagnosticRefs ?? []).map((ref, index) => ({
        id: `raw-diagnostic-${index + 1}`,
        label: ref,
        kind: 'trace' as const,
        ref,
        summary: 'Folded raw diagnostic ref for audit.',
        primary: false,
        defaultVisible: false,
        foldedByDefault: true as const,
      })),
      ...(input.benchmarkReport ? [{
        id: 'benchmark-diagnostics',
        label: 'Complex dialogue benchmark summary',
        kind: 'verification' as const,
        ref: `benchmark:${input.benchmarkReport.benchmarkId}`,
        summary: `quality=${input.benchmarkReport.timeline.summary.qualityScore}; firstVisible=${input.benchmarkReport.timeline.summary.firstVisibleResponseMs ?? 'n/a'}ms`,
        primary: false,
        defaultVisible: false,
        foldedByDefault: true as const,
      }] : []),
      ...(input.fixture?.failureInjections ?? []).map((failure) => ({
        id: `failure-${failure.id}`,
        label: `Failure injection ${failure.id}`,
        kind: 'trace' as const,
        summary: [failure.mode, failure.target, failure.expectedRecovery].filter(Boolean).join('; '),
        primary: false,
        defaultVisible: false,
        foldedByDefault: true as const,
      })),
    ],
    defaultExpandedSections: ['answer', 'evidence', 'artifacts', 'next-actions'],
    fieldOrigins: {
      answerBlocks: 'harness-presentation-policy',
      keyFindings: 'harness-presentation-policy',
      inlineCitations: 'runtime-adapter',
      artifactActions: 'runtime-adapter',
      nextActions: 'harness-presentation-policy',
      processSummary: 'harness-presentation-policy',
      diagnosticsRefs: 'validator',
    },
    generatedBy: 'harness-presentation-policy',
  });
  const validation = validateResultPresentationContract(contract);
  if (!validation.ok) {
    throw new Error(`Invalid complex multiturn presentation: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }
  return contract;
}

export const projectComplexMultiTurnPresentation = buildComplexMultiturnPresentation;
export const projectComplexMultiTurnPresentationSections = buildComplexMultiturnPresentation;

function statusFromInput(input: ComplexMultiturnPresentationInput, blocked: string[]): ResultPresentationStatus {
  const snapshotStatus = input.fixture?.presentationSnapshots?.at(-1)?.status;
  if (input.needsUserChoice || input.recoveryPlan?.status === 'needs-human' || input.fixture?.lifecycle?.conflictResolution === 'needs-human') return 'needs-human';
  if (input.recoveryPlan?.status === 'not-recoverable') return 'failed';
  if (input.recoveryPlan?.status === 'ready') return 'partial';
  if (snapshotStatus === 'failed') return 'failed';
  if (snapshotStatus === 'partial') return 'partial';
  if (snapshotStatus === 'background-running' || snapshotStatus === 'background-revision') return 'background-running';
  if (input.stateDigest?.backgroundJobs.length || input.fixture?.expectedState?.backgroundJobs?.length) return 'background-running';
  if (input.fixture?.failureInjections?.length && blocked.length) return 'failed';
  if (blocked.length || input.stateDigest?.pendingWork.length) return 'partial';
  return 'complete';
}

function continuationItems(input: ComplexMultiturnPresentationInput, pending: string[], blocked: string[]): string[] {
  const items = [
    ...pending.map((id) => `Continue pending work: ${id}`),
    ...blocked.map((id) => `Rerun or recover: ${id}`),
    ...(input.recoveryPlan?.userOptions ?? []).map((action) => action.label),
    ...(input.fixture?.failureInjections ?? []).map((failure) => failure.expectedRecovery).filter((item): item is string => Boolean(item)),
  ];
  const historyMutationMode = input.historyMutationMode ?? input.fixture?.historyMutation?.mode;
  if (historyMutationMode && historyMutationMode !== 'none') items.push(`Respect history mutation boundary: ${historyMutationMode}`);
  return uniqueStrings(items.length ? items : ['No foreground continuation is required.']);
}

function nextActions(input: ComplexMultiturnPresentationInput, pending: string[], blocked: string[]) {
  const actions = [];
  if (input.needsUserChoice || input.recoveryPlan?.status === 'needs-human') {
    actions.push({ id: 'choose-recovery', label: 'Choose recovery path', kind: 'ask-user' as const, primary: true });
  }
  if (blocked.length || input.recoveryPlan?.status === 'ready') {
    actions.push({ id: 'recover', label: input.recoveryPlan?.recommendedNext ?? 'Recover blocked work', kind: 'recover' as const, primary: actions.length === 0 });
  }
  if (pending.length) {
    actions.push({ id: 'continue', label: 'Continue pending work', kind: 'continue' as const, primary: actions.length === 0 });
  }
  if (!actions.length) actions.push({ id: 'stop', label: 'No further action required', kind: 'stop' as const, primary: true });
  return actions;
}

function completedWorkItems(input: ComplexMultiturnPresentationInput, completedRefs: string[]): string[] {
  const items = [
    ...(input.fixture?.expectedState?.taskGraph?.completed ?? []),
    ...completedRefs,
  ];
  return uniqueStrings(items.length ? items : ['No durable completed refs are available yet.']);
}

function stateAuthorityUncertainty(input: ComplexMultiturnPresentationInput, citationCount: number) {
  if (input.stateDigest?.uncertainty.length) return { state: 'partial' as const, reason: input.stateDigest.uncertainty.join('; ') };
  if (!citationCount) return { state: 'unverified' as const, reason: 'No durable state ref was attached to this authority summary.' };
  return undefined;
}

function confidenceSummary(input: ComplexMultiturnPresentationInput): string {
  if (input.benchmarkReport) {
    const summary = input.benchmarkReport.timeline.summary;
    return `Benchmark quality ${summary.qualityScore}; failures ${summary.failureCount}; recovery events ${summary.recoveryEventCount}.`;
  }
  if (input.recoveryPlan) return `Recovery status ${input.recoveryPlan.status}; side effect policy ${input.recoveryPlan.sideEffectPolicy}.`;
  return 'State is projected from structured digest, refs, and presentation policy.';
}

function processSummary(input: ComplexMultiturnPresentationInput): string {
  const relation = input.stateDigest?.relation ? `relation=${input.stateDigest.relation}` : 'relation=unknown';
  const authority = `authority=${input.stateAuthority ?? input.fixture?.lifecycle?.stateAuthority ?? 'digest'}`;
  const historyMode = input.historyMutationMode ?? input.fixture?.historyMutation?.mode;
  const history = historyMode ? `history=${historyMode}` : 'history=none';
  return [relation, authority, history].join('; ');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
