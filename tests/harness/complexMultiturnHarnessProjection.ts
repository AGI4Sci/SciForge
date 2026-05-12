import type {
  CapabilityCostClass,
  CapabilityLatencyClass,
  CapabilitySideEffectClass,
  HarnessCandidate,
  HarnessEvaluation,
  HarnessInput,
  HarnessTrace,
  IntentMode,
  LatencyTier,
} from '../../packages/agent-harness/src/contracts';
import type {
  AllowedTool,
  ComplexMultiTurnFixture,
  ComplexTurnExpectation,
  ExpectedEscalation,
} from '../fixtures/complex-multiturn/contract';

export const COMPLEX_MULTITURN_HARNESS_PROJECTION_SCHEMA_VERSION = 'sciforge.complex-multiturn-harness-projection.v1' as const;

export interface ComplexMultiturnHarnessProjection {
  schemaVersion: typeof COMPLEX_MULTITURN_HARNESS_PROJECTION_SCHEMA_VERSION;
  id: string;
  fixtureId: string;
  turnId: string;
  sourceTaskId: string;
  turnCount: number;
  harnessInput: HarnessInput;
  refs: Record<string, unknown>;
  traceExpectation: {
    requiredTraceRefs: string[];
    requiredReplayEventRefs: string[];
    requiredMetricRefs: string[];
  };
  requiredTraceRefs: string[];
  requiredReplayEvents: string[];
  requiredMetrics: string[];
  expectedLatencyTiers: LatencyTier[];
  expectedEscalations: ExpectedEscalation[];
  auditSummary: string;
}

export interface ComplexMultiturnTraceCoverage {
  schemaVersion: typeof COMPLEX_MULTITURN_HARNESS_PROJECTION_SCHEMA_VERSION;
  fixtureId: string;
  traceId: string;
  coveredTraceRefs: string[];
  missingTraceRefs: string[];
  coveredReplayEvents: string[];
  missingReplayEvents: string[];
  coveredMetrics: string[];
  missingMetrics: string[];
  ok: boolean;
}

export function projectComplexMultiturnFixtureToHarnessInputs(fixture: ComplexMultiTurnFixture): ComplexMultiturnHarnessProjection[] {
  const base = projectComplexFixtureToHarnessInput(fixture);
  return fixture.turns.map((turn) => {
    const requiredReplayEventRefs = fixture.replayTrace.requiredEvents.map((event) => `replay-event:${event}`);
    const requiredMetricRefs = fixture.replayTrace.requiredMetrics.map((metric) => `replay-metric:${metric}`);
    const requiredTraceRefs = uniqueStrings([
      `fixture:${fixture.id}`,
      `source-task:${fixture.sourceTaskId}`,
      `turn:${turn.id}`,
      `latency-tier:${turn.expectedLatencyTier}`,
      `escalation:${turn.expectedEscalation}`,
      ...turn.referencedArtifacts,
      ...turn.referencedRuns,
      ...base.requiredTraceRefs,
    ]);
    const harnessInput: HarnessInput = {
      ...base.harnessInput,
      requestId: `${fixture.id}:${turn.id}`,
      prompt: [
        `${fixture.sourceTaskId}: turn ${turn.index}/${fixture.turns.length}`,
        `Fixture ref fixture:${fixture.id}`,
        `Turn ref turn:${turn.id}`,
        `Latency tier latency-tier:${turn.expectedLatencyTier}`,
        `Escalation escalation:${turn.expectedEscalation}`,
        `Replay events ${requiredReplayEventRefs.join(' ')}`,
        `Replay metrics ${requiredMetricRefs.join(' ')}`,
      ].join('\n'),
      contextRefs: uniqueStrings([...(base.harnessInput.contextRefs ?? []), ...requiredTraceRefs, ...requiredReplayEventRefs, ...requiredMetricRefs]),
      requiredContextRefs: uniqueStrings([...(base.harnessInput.requiredContextRefs ?? []), `turn:${turn.id}`, ...requiredReplayEventRefs, ...requiredMetricRefs]),
      conversationSignals: {
        ...(base.harnessInput.conversationSignals ?? {}),
        complexMultiturnTurn: summarizeComplexFixtureTurnForTrace(turn),
      },
      runtimeConfig: {
        ...(base.harnessInput.runtimeConfig ?? {}),
        complexMultiturnTraceExpectation: {
          requiredTraceRefs,
          requiredReplayEventRefs,
          requiredMetricRefs,
        },
      },
    };
    return {
      ...base,
      id: `${fixture.id}:turn-${turn.index}`,
      turnId: turn.id,
      harnessInput,
      refs: Object.fromEntries(requiredTraceRefs.map((ref) => [ref, true])),
      traceExpectation: {
        requiredTraceRefs,
        requiredReplayEventRefs,
        requiredMetricRefs,
      },
      requiredTraceRefs,
      auditSummary: `${fixture.id}:${turn.id}: trace projection covers ${requiredReplayEventRefs.length} event refs and ${requiredMetricRefs.length} metric refs.`,
    };
  });
}

export function assertComplexMultiturnHarnessTraceProjection(
  projection: ComplexMultiturnHarnessProjection,
  evaluationOrTrace: HarnessEvaluation | HarnessTrace,
): void {
  const trace = 'trace' in evaluationOrTrace ? evaluationOrTrace.trace : evaluationOrTrace;
  const combined = `${JSON.stringify(trace)}\n${JSON.stringify(projection.harnessInput)}`;
  const expectation = projection.traceExpectation ?? {
    requiredTraceRefs: projection.requiredTraceRefs,
    requiredReplayEventRefs: projection.requiredReplayEvents.map((event) => `replay-event:${event}`),
    requiredMetricRefs: projection.requiredMetrics.map((metric) => `replay-metric:${metric}`),
  };
  const missing = [
    ...expectation.requiredTraceRefs,
    ...expectation.requiredReplayEventRefs,
    ...expectation.requiredMetricRefs,
  ].filter((ref) => !combined.includes(ref));
  if (missing.length) {
    throw new Error(`${projection.id ?? projection.fixtureId}: harness trace projection missing ${missing.join(', ')}`);
  }
}

export function projectComplexFixtureToHarnessInput(fixture: ComplexMultiTurnFixture): ComplexMultiturnHarnessProjection {
  const requiredTraceRefs = uniqueStrings([
    `fixture:${fixture.id}`,
    `source-task:${fixture.sourceTaskId}`,
    ...fixture.expectedState.checkpointRefs,
    ...fixture.expectedState.reusableRefs,
    ...fixture.artifactExpectations.requiredObjectRefs,
    ...(fixture.lifecycle ? [
      `resume-source:${fixture.lifecycle.resumeSource}`,
      `state-authority:${fixture.lifecycle.stateAuthority}`,
      `side-effect-policy:${fixture.lifecycle.sideEffectPolicy}`,
      `history-mode:${fixture.lifecycle.historyMutationMode}`,
    ] : []),
  ]);
  const candidateCapabilities = fixture.allowedTools.map(toolCandidate);
  const expectedLatencyTiers = uniqueStrings(fixture.turns.map((turn) => turn.expectedLatencyTier)) as LatencyTier[];
  const expectedEscalations = uniqueStrings(fixture.turns.map((turn) => turn.expectedEscalation)) as ExpectedEscalation[];
  const harnessInput: HarnessInput = {
    requestId: fixture.id,
    profileId: profileForFixture(fixture),
    latencyTier: fixture.latencyBudget.tier,
    intentMode: intentModeForFixture(fixture),
    prompt: [
      `${fixture.sourceTaskId}: ${fixture.title}`,
      ...fixture.objectives,
      `Required replay events: ${fixture.replayTrace.requiredEvents.join(', ')}`,
      `Required metrics: ${fixture.replayTrace.requiredMetrics.join(', ')}`,
    ].join('\n'),
    contextRefs: uniqueStrings([...fixture.expectedState.reusableRefs, ...fixture.memoryExpectations.reusableRefs]),
    requiredContextRefs: uniqueStrings([...fixture.expectedState.checkpointRefs, ...fixture.artifactExpectations.requiredObjectRefs]),
    blockedContextRefs: uniqueStrings([...fixture.expectedState.staleRefs, ...fixture.memoryExpectations.forbiddenRepeatedWork.map((item) => `forbidden-work:${item}`)]),
    candidateCapabilities,
    conversationSignals: {
      complexMultiturnFixture: {
        schemaVersion: fixture.schemaVersion,
        fixtureId: fixture.id,
        sourceTaskId: fixture.sourceTaskId,
        tier: fixture.tier,
        scenarioKind: fixture.scenarioKind,
        turnCount: fixture.turns.length,
        requiredReplayEvents: fixture.replayTrace.requiredEvents,
        requiredMetrics: fixture.replayTrace.requiredMetrics,
        expectedLatencyTiers,
        expectedEscalations,
        historyMutationMode: fixture.historyMutation.mode,
        lifecycle: fixture.lifecycle,
      },
    },
    runtimeConfig: {
      complexMultiturnHarnessProjection: {
        schemaVersion: COMPLEX_MULTITURN_HARNESS_PROJECTION_SCHEMA_VERSION,
        requiredTraceRefs,
        presentationSnapshots: fixture.presentationSnapshots,
        latencySummary: fixture.latencySummary,
      },
    },
  };

  return {
    schemaVersion: COMPLEX_MULTITURN_HARNESS_PROJECTION_SCHEMA_VERSION,
    id: fixture.id,
    fixtureId: fixture.id,
    turnId: fixture.turns[0]?.id ?? fixture.id,
    sourceTaskId: fixture.sourceTaskId,
    turnCount: fixture.turns.length,
    harnessInput,
    refs: Object.fromEntries(requiredTraceRefs.map((ref) => [ref, true])),
    traceExpectation: {
      requiredTraceRefs,
      requiredReplayEventRefs: fixture.replayTrace.requiredEvents.map((event) => `replay-event:${event}`),
      requiredMetricRefs: fixture.replayTrace.requiredMetrics.map((metric) => `replay-metric:${metric}`),
    },
    requiredTraceRefs,
    requiredReplayEvents: [...fixture.replayTrace.requiredEvents],
    requiredMetrics: [...fixture.replayTrace.requiredMetrics],
    expectedLatencyTiers,
    expectedEscalations,
    auditSummary: `${fixture.id}: ${fixture.turns.length} turns, ${fixture.failureInjections.length} injected failure(s), ${fixture.artifactExpectations.requiredObjectRefs.length} object ref(s).`,
  };
}

export function summarizeComplexFixtureTurnForTrace(turn: ComplexTurnExpectation): Record<string, unknown> {
  return {
    turnId: turn.id,
    index: turn.index,
    latencyTier: turn.expectedLatencyTier,
    escalation: turn.expectedEscalation,
    firstResultDeadlineMs: turn.maxFirstResultTimeMs,
    maxRepeatedExploration: turn.maxRepeatedExploration,
    presentationStatus: turn.requiredPresentationStatus,
    expectedStateDelta: turn.expectedStateDelta,
    failureInjectionIds: turn.failureInjectionIds,
    artifactRefs: turn.referencedArtifacts,
    runRefs: turn.referencedRuns,
    markers: turn.markers,
  };
}

export function traceCoverageForComplexFixture(
  fixture: ComplexMultiTurnFixture,
  evaluationOrTrace: HarnessEvaluation | HarnessTrace,
): ComplexMultiturnTraceCoverage {
  const trace = 'trace' in evaluationOrTrace ? evaluationOrTrace.trace : evaluationOrTrace;
  const projection = projectComplexFixtureToHarnessInput(fixture);
  const text = JSON.stringify(trace);
  const inputText = JSON.stringify(projection.harnessInput);
  const combined = `${text}\n${inputText}`;
  const coveredTraceRefs = projection.requiredTraceRefs.filter((ref) => combined.includes(ref));
  const coveredReplayEvents = projection.requiredReplayEvents.filter((event) => combined.includes(event));
  const coveredMetrics = projection.requiredMetrics.filter((metric) => combined.includes(metric));
  const missingTraceRefs = projection.requiredTraceRefs.filter((ref) => !coveredTraceRefs.includes(ref));
  const missingReplayEvents = projection.requiredReplayEvents.filter((event) => !coveredReplayEvents.includes(event));
  const missingMetrics = projection.requiredMetrics.filter((metric) => !coveredMetrics.includes(metric));
  return {
    schemaVersion: COMPLEX_MULTITURN_HARNESS_PROJECTION_SCHEMA_VERSION,
    fixtureId: fixture.id,
    traceId: trace.traceId,
    coveredTraceRefs,
    missingTraceRefs,
    coveredReplayEvents,
    missingReplayEvents,
    coveredMetrics,
    missingMetrics,
    ok: missingTraceRefs.length === 0 && missingReplayEvents.length === 0 && missingMetrics.length === 0,
  };
}

function profileForFixture(fixture: ComplexMultiTurnFixture): HarnessInput['profileId'] {
  if (fixture.failureInjections.length > 0 || fixture.tier === 'lifecycle') return 'debug-repair';
  if (fixture.latencyBudget.tier === 'quick') return 'fast-answer';
  if (fixture.latencyBudget.tier === 'background' || fixture.latencyBudget.tier === 'deep') return 'research-grade';
  return 'balanced-default';
}

function intentModeForFixture(fixture: ComplexMultiTurnFixture): IntentMode {
  if (fixture.historyMutation.mode !== 'none') return 'continuation';
  if (fixture.failureInjections.length > 0) return 'repair';
  if (fixture.tier === 'lifecycle') return 'continuation';
  if (fixture.replayTrace.requiredEvents.includes('final-summary')) return 'audit';
  return 'fresh';
}

function toolCandidate(tool: AllowedTool, index: number): HarnessCandidate {
  const costClass: CapabilityCostClass = tool.includes('download') ? 'high' : tool.includes('search') ? 'medium' : 'low';
  const latencyClass: CapabilityLatencyClass = tool.includes('background') ? 'background' : tool.includes('download') ? 'long' : tool.includes('search') ? 'bounded' : 'short';
  const sideEffectClass: CapabilitySideEffectClass = tool.includes('write') ? 'write' : tool.includes('download') || tool.includes('search') ? 'network' : tool.includes('read') ? 'read' : 'none';
  return {
    kind: tool.includes('verifier') || tool === 'schema-validator' ? 'verifier' : tool.includes('background') ? 'runtime-adapter' : 'tool',
    id: `complex-multiturn.${tool}`,
    manifestRef: `capability:${tool}`,
    score: Math.max(0.1, 1 - index * 0.03),
    reasons: ['complex-multiturn fixture allowed tool', `tool=${tool}`],
    costClass,
    latencyClass,
    sideEffectClass,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
