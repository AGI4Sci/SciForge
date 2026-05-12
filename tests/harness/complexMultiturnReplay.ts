import {
  aggregateComplexDialogueTimeline,
  buildComplexDialogueBenchmarkReport,
  type ComplexDialogueBenchmarkReport,
  type ComplexDialoguePerformanceGates,
  type ComplexDialogueTimelineEvent,
} from '../../src/runtime/gateway/complex-dialogue-metrics';
import { buildConversationStateDigest, type ConversationStateDigest } from '../../src/runtime/gateway/conversation-state-policy';
import type { ComplexMultiTurnFixture, ComplexTurnExpectation } from '../fixtures/complex-multiturn/contract';

export const COMPLEX_MULTITURN_REPLAY_SCHEMA_VERSION = 'sciforge.complex-multiturn-replay.v1' as const;
export const COMPLEX_MULTITURN_CONTRACT_REPLAY_SUMMARY_SCHEMA_VERSION = 'sciforge.complex-multiturn-contract-replay-summary.v1' as const;

export interface ComplexMultiturnReplayCheckpoint {
  turnId: string;
  turnIndex: number;
  digest: ConversationStateDigest;
}

export interface ComplexMultiturnReplayResult {
  schemaVersion: typeof COMPLEX_MULTITURN_REPLAY_SCHEMA_VERSION;
  fixtureId: string;
  sourceTaskId: string;
  tier: ComplexMultiTurnFixture['tier'];
  turnCount: number;
  events: ComplexDialogueTimelineEvent[];
  checkpoints: ComplexMultiturnReplayCheckpoint[];
  report: ComplexDialogueBenchmarkReport;
  benchmarkReport: ComplexDialogueBenchmarkReport;
  metrics: {
    recoverySuccess: boolean;
    artifactReferenceAccuracy: boolean;
    resumeCorrectness: boolean;
    historyMutationCorrectness: boolean;
    sideEffectDuplicationPrevented: boolean;
    verifyLatencyMs: number;
    blockingVerifyRate: number;
    backgroundVerifyFailureRecoveryRate: number;
  };
  coverage: {
    requiredEventCount: number;
    coveredRequiredEvents: string[];
    missingRequiredEvents: string[];
    requiredMetricCount: number;
    benchmarkQualityScore: number;
  };
}

export function replayComplexMultiturnFixture(
  fixture: ComplexMultiTurnFixture,
  gates: ComplexDialoguePerformanceGates = defaultGatesForFixture(fixture),
): ComplexMultiturnReplayResult {
  const events = buildComplexMultiturnTimelineEvents(fixture);
  const checkpoints = fixture.turns.map((turn) => ({
    turnId: turn.id,
    turnIndex: turn.index,
    digest: buildConversationStateDigest({
      prompt: turn.userPrompt,
      turnId: turn.id,
      taskState: {
        taskId: fixture.id,
        userGoal: fixture.title,
        completedEvidence: fixture.expectedState.reusableRefs.map((ref) => ({ ref, kind: 'fixture-ref', status: 'completed', stable: true })),
        pendingWork: fixture.expectedState.taskGraph.pending.map((title, index) => ({ id: `pending-${index + 1}`, title, status: 'pending', refs: fixture.expectedState.reusableRefs })),
        blockedWork: turn.failureInjectionIds.length ? [{ id: `blocked-${turn.index}`, title: 'Injected failure recovery', status: 'blocked', refs: turn.referencedRuns }] : [],
        artifactRefs: turn.referencedArtifacts,
        backgroundJobs: turn.markers.backgroundContinuation ? [{ id: `background-${turn.index}`, status: 'running', title: 'Background continuation', refs: turn.referencedArtifacts }] : [],
      },
      preflight: turn.markers.contextCompactionOrResume ? {
        workspace: { path: '/workspace', status: 'ready' },
        sessionStore: { ref: `session:${fixture.id}`, status: 'ready' },
        artifactRefs: turn.referencedArtifacts.map((ref) => ({ ref, status: 'ready' })),
        capabilityVersions: [{ id: 'complex-multiturn-replay', status: 'ready' }],
      } : undefined,
      historyMutation: turn.markers.historyMutation && turn.markers.historyMutation !== 'none' ? fixture.historyMutation : undefined,
    }),
  }));
  const report = buildComplexDialogueBenchmarkReport({
    benchmarkId: fixture.id,
    variant: 'candidate',
    generatedAt: '2026-05-12T00:00:00.000Z',
    events,
    gates,
    metadata: {
      sourceTaskId: fixture.sourceTaskId,
      tier: fixture.tier,
      fixtureSchemaVersion: fixture.schemaVersion,
    },
  });
  const eventTypes = new Set(events.map((event) => event.type));
  const coveredRequiredEvents = fixture.replayTrace.requiredEvents.filter((event) => eventTypes.has(event));
  return {
    schemaVersion: COMPLEX_MULTITURN_REPLAY_SCHEMA_VERSION,
    fixtureId: fixture.id,
    sourceTaskId: fixture.sourceTaskId,
    tier: fixture.tier,
    turnCount: fixture.turns.length,
    events,
    checkpoints,
    report,
    benchmarkReport: report,
    metrics: {
      recoverySuccess: fixture.failureInjections.length === 0 || events.some((event) => event.type === 'recovery-plan'),
      artifactReferenceAccuracy: fixture.turns.every((turn) => turn.referencedArtifacts.every((ref) => events.some((event) => event.refs?.includes(ref)))),
      resumeCorrectness: fixture.tier !== 'lifecycle' || events.some((event) => event.type === 'resume-preflight'),
      historyMutationCorrectness: fixture.historyMutation.mode === 'none' || events.some((event) => event.type === 'history-branch-record'),
      sideEffectDuplicationPrevented: fixture.failureInjections.every((failure) => failure.shouldAvoidDuplicateSideEffect),
      verifyLatencyMs: report.timeline.summary.verify.latencyMs,
      blockingVerifyRate: report.timeline.summary.verify.blockingRate,
      backgroundVerifyFailureRecoveryRate: report.timeline.summary.verify.backgroundFailureRecoveryRate,
    },
    coverage: {
      requiredEventCount: fixture.replayTrace.requiredEvents.length,
      coveredRequiredEvents,
      missingRequiredEvents: fixture.replayTrace.requiredEvents.filter((event) => !coveredRequiredEvents.includes(event)),
      requiredMetricCount: fixture.replayTrace.requiredMetrics.length,
      benchmarkQualityScore: report.timeline.summary.qualityScore,
    },
  };
}

export function buildComplexMultiturnTimelineEvents(fixture: ComplexMultiTurnFixture): ComplexDialogueTimelineEvent[] {
  const events: ComplexDialogueTimelineEvent[] = [];
  for (const turn of fixture.turns) {
    const base = turn.index * 10_000;
    events.push(eventForTurn(fixture, turn, 'turn-start', 'user', base, {
      message: turn.userPrompt,
      qualitySignals: { userVisible: true },
    }));
    events.push(eventForTurn(fixture, turn, 'state-digest', 'diagnostic', base + 100, {
      refs: [...fixture.expectedState.checkpointRefs, ...fixture.expectedState.reusableRefs],
      qualitySignals: { evidenceRefs: fixture.expectedState.reusableRefs.length },
    }));
    if (turn.markers.contextCompactionOrResume || fixture.tier === 'lifecycle') {
      events.push(eventForTurn(fixture, turn, 'resume-preflight', 'lifecycle', base + 150, {
        status: 'completed',
        refs: fixture.lifecycle ? [fixture.lifecycle.lastStableCheckpointRef, ...fixture.lifecycle.artifactLineageExpectation] : fixture.expectedState.checkpointRefs,
        qualitySignals: { userVisible: true, lifecycleKind: 'resume', artifactRefs: turn.referencedArtifacts.length },
      }));
    }
    events.push(eventForTurn(fixture, turn, 'first-readable-result', 'progress', base + Math.min(turn.maxFirstResultTimeMs, 1000), {
      message: `Partial status for ${turn.id}`,
      qualitySignals: { userVisible: true, partialResult: turn.requiredPresentationStatus !== 'complete' },
    }));
    events.push(eventForTurn(fixture, turn, 'tool-call', 'tool', base + 1500, {
      refs: [...turn.referencedArtifacts, ...turn.referencedRuns],
      qualitySignals: { artifactRefs: turn.referencedArtifacts.length },
    }));
    if (turn.failureInjectionIds.length > 0) {
      events.push(eventForTurn(fixture, turn, 'failure', 'failure', base + 1800, {
        status: 'failed',
        refs: turn.referencedRuns,
        qualitySignals: { failure: true, recoverable: true },
      }));
      events.push(eventForTurn(fixture, turn, 'recovery-plan', 'recovery', base + 1900, {
        status: 'completed',
        refs: fixture.failureInjections.filter((failure) => turn.failureInjectionIds.includes(failure.id)).flatMap((failure) => failure.reusableEvidence),
        qualitySignals: { userVisible: true, recoverable: true, evidenceRefs: 1 },
      }));
      events.push(eventForTurn(fixture, turn, 'background-work-verify-failure', 'background', base + 1950, {
        status: 'failed',
        phase: `verify-${turn.index}`,
        durationMs: 50,
        refs: turn.referencedRuns,
        raw: {
          schemaVersion: 'sciforge.intent-first-verification.v1',
          routing: { blockingPolicy: 'non-blocking' },
          verificationResults: [{ id: `verify-${turn.index}`, verdict: 'fail' }],
          recoverActions: ['Use recovered evidence and rerun background verification.'],
        },
        qualitySignals: { recoverable: true, evidenceRefs: 1 },
      }));
    }
    if (turn.markers.backgroundContinuation) {
      events.push(eventForTurn(fixture, turn, 'background-start', 'background', base + 2000, {
        status: 'running',
        qualitySignals: { userVisible: true },
      }));
      events.push(eventForTurn(fixture, turn, 'background-revision', 'background', base + 3000, {
        status: 'completed',
        refs: turn.referencedArtifacts,
        qualitySignals: { userVisible: true, artifactRefs: turn.referencedArtifacts.length },
      }));
      events.push(eventForTurn(fixture, turn, 'background-work-verify-pass', 'background', base + 3200, {
        status: 'completed',
        phase: `verify-${turn.index}`,
        durationMs: 40,
        refs: turn.referencedArtifacts,
        raw: {
          schemaVersion: 'sciforge.intent-first-verification.v1',
          routing: { blockingPolicy: 'non-blocking' },
          verificationResults: [{ id: `verify-${turn.index}`, verdict: 'pass' }],
        },
        qualitySignals: { evidenceRefs: 1 },
      }));
    }
    if (
      (turn.markers.historyMutation && turn.markers.historyMutation !== 'none')
      || (turn.index === fixture.turns.length && fixture.replayTrace.requiredEvents.includes('history-branch-record'))
    ) {
      events.push(eventForTurn(fixture, turn, 'history-branch-record', 'lifecycle', base + 2100, {
        status: 'completed',
        refs: [...fixture.historyMutation.retainedRefs, ...fixture.historyMutation.conflictRefs],
        qualitySignals: { userVisible: true, lifecycleKind: fixture.historyMutation.mode === 'merge' ? 'merge' : fixture.historyMutation.mode === 'revert' ? 'revert' : 'branch' },
      }));
    }
    if (turn.index === fixture.turns.length) {
      events.push(eventForTurn(fixture, turn, 'final-summary', 'assistant', base + 4000, {
        status: 'completed',
        refs: fixture.artifactExpectations.requiredObjectRefs,
        qualitySignals: { userVisible: true, finalResult: true, artifactRefs: fixture.artifactExpectations.requiredObjectRefs.length, evidenceRefs: fixture.expectedState.reusableRefs.length },
      }));
    }
  }
  return events.sort((left, right) => left.timeMs - right.timeMs);
}

export function summarizeComplexMultiturnReplayFixtures(fixtures: ComplexMultiTurnFixture[]): Record<string, unknown> {
  const results = fixtures.map((fixture) => replayComplexMultiturnFixture(fixture));
  const summaries = results.map((result) => result.report.timeline.summary);
  return {
    schemaVersion: COMPLEX_MULTITURN_REPLAY_SCHEMA_VERSION,
    fixtureCount: fixtures.length,
    missingRequiredEventFixtures: results.filter((result) => result.coverage.missingRequiredEvents.length > 0).map((result) => result.fixtureId),
    averageQualityScore: round(summaries.reduce((sum, summary) => sum + summary.qualityScore, 0) / Math.max(1, summaries.length)),
    totalEventCount: summaries.reduce((sum, summary) => sum + summary.eventCount, 0),
    totalFailureCount: summaries.reduce((sum, summary) => sum + summary.failureCount, 0),
    totalRecoveryEventCount: summaries.reduce((sum, summary) => sum + summary.recoveryEventCount, 0),
    aggregateTimeline: aggregateComplexDialogueTimeline(results.flatMap((result) => result.events)),
  };
}

export function summarizeComplexMultiturnReplayContracts(fixtures: ComplexMultiTurnFixture[]) {
  const countsByTier = fixtures.reduce((acc, fixture) => {
    acc[fixture.tier] = (acc[fixture.tier] ?? 0) + 1;
    return acc;
  }, {} as Record<ComplexMultiTurnFixture['tier'], number>);
  const fixtureSummaries = fixtures.map((fixture) => ({
    id: fixture.id,
    tier: fixture.tier,
    turnCount: fixture.turns.length,
    expectedEventTypes: fixture.replayTrace.requiredEvents,
    expectedMetricTypes: fixture.replayTrace.requiredMetrics,
    failureInjectionCount: fixture.failureInjections.length,
    lifecycleReplayRequired: fixture.tier === 'twenty-turn' || fixture.tier === 'lifecycle' || fixture.replayTrace.requiredEvents.includes('resume-preflight'),
  }));
  const totalFailureInjections = fixtures.reduce((sum, fixture) => sum + fixture.failureInjections.length, 0);
  return {
    schemaVersion: COMPLEX_MULTITURN_CONTRACT_REPLAY_SUMMARY_SCHEMA_VERSION,
    fixtureCount: fixtures.length,
    countsByTier,
    totalTurns: fixtures.reduce((sum, fixture) => sum + fixture.turns.length, 0),
    totalStateDigestCheckpoints: fixtures.reduce((sum, fixture) => sum + fixture.turns.length, 0),
    totalFailureInjections,
    totalExpectedRecoveryEvents: totalFailureInjections,
    fixtures: fixtureSummaries,
  };
}

export function assertComplexMultiturnReplayResult(
  fixture: ComplexMultiTurnFixture,
  result: ComplexMultiturnReplayResult,
): void {
  const issues: string[] = [];
  if (result.schemaVersion !== COMPLEX_MULTITURN_REPLAY_SCHEMA_VERSION) issues.push('schemaVersion');
  if (result.fixtureId !== fixture.id) issues.push('fixtureId');
  if (result.tier !== fixture.tier) issues.push('tier');
  if (result.turnCount !== fixture.turns.length) issues.push('turnCount');
  if (result.checkpoints.length !== fixture.turns.length) issues.push('checkpoint count');
  if (result.coverage.missingRequiredEvents.length) issues.push(`missing events ${result.coverage.missingRequiredEvents.join(',')}`);
  if (fixture.failureInjections.length > 0 && !result.metrics.recoverySuccess) issues.push('recoverySuccess');
  if (fixture.tier === 'lifecycle' && !result.metrics.resumeCorrectness) issues.push('resumeCorrectness');
  if (fixture.historyMutation.mode !== 'none' && !result.metrics.historyMutationCorrectness) issues.push('historyMutationCorrectness');
  if (!result.metrics.sideEffectDuplicationPrevented) issues.push('sideEffectDuplicationPrevented');
  if (issues.length) throw new Error(`${fixture.id}: invalid replay result: ${issues.join('; ')}`);
}

function eventForTurn(
  fixture: ComplexMultiTurnFixture,
  turn: ComplexTurnExpectation,
  type: string,
  category: ComplexDialogueTimelineEvent['category'],
  timeMs: number,
  overrides: Partial<ComplexDialogueTimelineEvent> = {},
): ComplexDialogueTimelineEvent {
  return {
    id: `${turn.id}:${type}`,
    type,
    category,
    timeMs,
    turnIndex: turn.index,
    runId: turn.referencedRuns[0] ?? `run:${fixture.id}:synthetic`,
    refs: uniqueStrings([...(overrides.refs ?? []), ...turn.referencedArtifacts, ...turn.referencedRuns]),
    ...overrides,
  };
}

function defaultGatesForFixture(fixture: ComplexMultiTurnFixture): ComplexDialoguePerformanceGates {
  return {
    maxFirstVisibleMs: fixture.latencyBudget.maxFirstReadableMs,
    maxRepeatedWorkCount: 0,
    minProgressEventCount: fixture.turns.length,
    minRecoveryEventCount: fixture.failureInjections.length > 0 ? 1 : undefined,
    minQualityScore: fixture.failureInjections.length > 3 ? 0.25 : 0.4,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
