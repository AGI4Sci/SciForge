import {
  COMPLEX_MULTI_TURN_FIXTURE_SCHEMA_VERSION,
  type AllowedTool,
  type ComplexFixtureTier,
  type ComplexMultiTurnFixture,
  type ComplexScenarioKind,
  type ExpectedEscalation,
  type FailureInjection,
  type FailureInjectionMode,
  type HistoryMutationMode,
  type LatencyTier,
  type LifecycleResumeMetadata,
  type PresentationStatus,
  type ResumeSource,
  type SideEffectPolicy,
  type StateAuthority,
  type SuccessOutcome,
} from './contract';

interface FixtureDefinition {
  sourceTaskId: string;
  title: string;
  scenarioKind: ComplexScenarioKind;
  tools: AllowedTool[];
  outcomes: SuccessOutcome[];
  failureModes?: FailureInjectionMode[];
}

interface LifecycleDefinition {
  sourceTaskId: string;
  title: string;
  resumeSource: ResumeSource;
  stateAuthority: StateAuthority;
  sideEffectPolicy: SideEffectPolicy;
  historyMutationMode: HistoryMutationMode;
  conflictResolution: LifecycleResumeMetadata['conflictResolution'];
  failureMode: FailureInjectionMode;
  outcome: SuccessOutcome;
}

const researchTools: AllowedTool[] = ['agentserver-generation', 'literature-search', 'metadata-fetch', 'artifact-writer', 'artifact-resolver', 'verifier', 'background-continuation'];
const codeTools: AllowedTool[] = ['agentserver-generation', 'workspace-read', 'workspace-write', 'command-runner', 'schema-validator', 'artifact-writer', 'verifier'];
const runtimeTools: AllowedTool[] = ['agentserver-generation', 'runtime-state', 'execution-unit-reader', 'artifact-resolver', 'schema-validator', 'verifier', 'background-continuation'];
const artifactTools: AllowedTool[] = ['agentserver-generation', 'artifact-resolver', 'artifact-reader', 'artifact-writer', 'schema-validator', 'verifier'];
const dataTools: AllowedTool[] = ['agentserver-generation', 'workspace-read', 'python-task', 'artifact-writer', 'schema-validator', 'verifier'];
const lifecycleTools: AllowedTool[] = ['agentserver-generation', 'runtime-state', 'execution-unit-reader', 'artifact-resolver', 'browser-session-state', 'schema-validator', 'verifier'];

const fiveTurnDefinitions: FixtureDefinition[] = [
  { sourceTaskId: 'T5-01', title: 'Quick research to markdown report', scenarioKind: 'research', tools: researchTools, outcomes: ['partial', 'success'], failureModes: ['download_unavailable'] },
  { sourceTaskId: 'T5-02', title: 'Continue after timeout', scenarioKind: 'runtime-diagnostic', tools: runtimeTools, outcomes: ['failure', 'recovery'], failureModes: ['timeout'] },
  { sourceTaskId: 'T5-03', title: 'Progressively tightened constraints', scenarioKind: 'research', tools: researchTools, outcomes: ['success'], failureModes: ['empty_search_result'] },
  { sourceTaskId: 'T5-04', title: 'Multiple artifact follow-up', scenarioKind: 'artifact-analysis', tools: artifactTools, outcomes: ['success'], failureModes: ['artifact_missing'] },
  { sourceTaskId: 'T5-05', title: 'Code task with failing test recovery', scenarioKind: 'code', tools: codeTools, outcomes: ['failure', 'recovery'], failureModes: ['tool_stderr'] },
  { sourceTaskId: 'T5-06', title: 'Data analysis regrouping follow-up', scenarioKind: 'data-analysis', tools: dataTools, outcomes: ['success'], failureModes: ['schema_validation_failure'] },
  { sourceTaskId: 'T5-07', title: 'Runtime diagnostic follow-up', scenarioKind: 'runtime-diagnostic', tools: runtimeTools, outcomes: ['recovery'], failureModes: ['backend_delay'] },
  { sourceTaskId: 'T5-08', title: 'Speed-first partial then background merge', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['partial', 'background-revision'], failureModes: ['backend_delay'] },
  { sourceTaskId: 'T5-09', title: 'Privacy constraint switch', scenarioKind: 'research', tools: researchTools, outcomes: ['partial', 'success'], failureModes: ['permission_denied'] },
  { sourceTaskId: 'T5-10', title: 'Empty result recovery', scenarioKind: 'research', tools: researchTools, outcomes: ['partial', 'recovery'], failureModes: ['empty_search_result'] },
];

const tenTurnDefinitions: FixtureDefinition[] = [
  { sourceTaskId: 'T10-01', title: 'Deep literature research with citation repair', scenarioKind: 'research', tools: researchTools, outcomes: ['partial', 'success'], failureModes: ['download_unavailable'] },
  { sourceTaskId: 'T10-02', title: 'Failed run to deliverable with schema repair', scenarioKind: 'runtime-diagnostic', tools: runtimeTools, outcomes: ['failure', 'recovery'], failureModes: ['timeout', 'schema_validation_failure'] },
  { sourceTaskId: 'T10-03', title: 'Code repair iteration with changed request', scenarioKind: 'code', tools: codeTools, outcomes: ['failure', 'recovery'], failureModes: ['tool_stderr'] },
  { sourceTaskId: 'T10-04', title: 'Multi-source data analysis with field mapping', scenarioKind: 'data-analysis', tools: dataTools, outcomes: ['partial', 'success'], failureModes: ['schema_validation_failure'] },
  { sourceTaskId: 'T10-05', title: 'Runtime and artifact mixed diagnostic', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['recovery', 'success'], failureModes: ['artifact_missing'] },
  { sourceTaskId: 'T10-06', title: 'Long report editing with audience shift', scenarioKind: 'report-editing', tools: artifactTools, outcomes: ['partial', 'success'], failureModes: ['backend_delay'] },
  { sourceTaskId: 'T10-07', title: 'Backend comparison with provenance', scenarioKind: 'runtime-diagnostic', tools: runtimeTools, outcomes: ['failure', 'recovery'], failureModes: ['backend_delay'] },
  { sourceTaskId: 'T10-08', title: 'Budget exhaustion downgrade', scenarioKind: 'research', tools: researchTools, outcomes: ['partial', 'background-revision'], failureModes: ['timeout'] },
  { sourceTaskId: 'T10-09', title: 'Repeated scope changes with audit', scenarioKind: 'research', tools: researchTools, outcomes: ['success'], failureModes: ['empty_search_result'] },
  { sourceTaskId: 'T10-10', title: 'Complex recovery across repeated failures', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['failure', 'recovery'], failureModes: ['network_failure', 'download_unavailable', 'verification_failure'] },
  { sourceTaskId: 'T10-11', title: 'Memory reuse over one indexed object', scenarioKind: 'artifact-analysis', tools: artifactTools, outcomes: ['success'], failureModes: ['artifact_missing'] },
  { sourceTaskId: 'T10-12', title: 'Mutually conflicting speed and quality constraints', scenarioKind: 'cross-capability', tools: researchTools, outcomes: ['partial', 'success'], failureModes: ['backend_delay'] },
];

const twentyTurnDefinitions: FixtureDefinition[] = [
  { sourceTaskId: 'T20-01', title: 'End-to-end research project', scenarioKind: 'research', tools: researchTools, outcomes: ['partial', 'background-revision', 'success'], failureModes: ['timeout', 'download_unavailable', 'verification_failure'] },
  { sourceTaskId: 'T20-02', title: 'Continuous failure resilience', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['failure', 'recovery'], failureModes: ['timeout', 'empty_search_result', 'tool_stderr', 'backend_delay', 'schema_validation_failure', 'artifact_missing', 'verification_failure'] },
  { sourceTaskId: 'T20-03', title: 'Large code refactor dialogue', scenarioKind: 'code', tools: codeTools, outcomes: ['partial', 'recovery', 'success'], failureModes: ['tool_stderr', 'schema_validation_failure', 'timeout'] },
  { sourceTaskId: 'T20-04', title: 'Multi-artifact lifecycle', scenarioKind: 'artifact-analysis', tools: artifactTools, outcomes: ['partial', 'background-revision', 'success'], failureModes: ['artifact_missing', 'schema_validation_failure', 'verification_failure'] },
  { sourceTaskId: 'T20-05', title: 'Long data analysis project', scenarioKind: 'data-analysis', tools: dataTools, outcomes: ['partial', 'success'], failureModes: ['schema_validation_failure', 'tool_stderr', 'timeout'] },
  { sourceTaskId: 'T20-06', title: 'Runtime long flow with presentation alignment', scenarioKind: 'runtime-diagnostic', tools: runtimeTools, outcomes: ['failure', 'recovery', 'success'], failureModes: ['backend_delay', 'artifact_missing', 'verification_failure'] },
  { sourceTaskId: 'T20-07', title: 'Background task revisit and merge', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['partial', 'background-revision', 'merge'], failureModes: ['backend_delay', 'timeout', 'artifact_missing'] },
  { sourceTaskId: 'T20-08', title: 'Conflicting multi-goal queue', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['partial', 'recovery', 'success'], failureModes: ['state_conflict', 'schema_validation_failure', 'backend_delay'] },
  { sourceTaskId: 'T20-09', title: 'Extended report collaboration', scenarioKind: 'report-editing', tools: artifactTools, outcomes: ['partial', 'success'], failureModes: ['verification_failure', 'backend_delay', 'schema_validation_failure'] },
  { sourceTaskId: 'T20-10', title: 'Context compaction resistance', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['continue', 'success'], failureModes: ['stale_state', 'artifact_missing', 'timeout'] },
  { sourceTaskId: 'T20-11', title: 'Parallel sidecar orchestration', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['partial', 'background-revision'], failureModes: ['backend_delay', 'tool_stderr', 'verification_failure'] },
  { sourceTaskId: 'T20-12', title: 'User feedback driven repair', scenarioKind: 'cross-capability', tools: runtimeTools, outcomes: ['failure', 'recovery'], failureModes: ['verification_failure', 'schema_validation_failure', 'tool_stderr'] },
  { sourceTaskId: 'T20-13', title: 'Cross-session continuation', scenarioKind: 'lifecycle', tools: lifecycleTools, outcomes: ['continue', 'recovery'], failureModes: ['stale_state', 'backend_delay', 'artifact_missing'] },
  { sourceTaskId: 'T20-14', title: 'Quality and speed tension', scenarioKind: 'cross-capability', tools: researchTools, outcomes: ['partial', 'background-revision', 'success'], failureModes: ['timeout', 'backend_delay', 'verification_failure'] },
  { sourceTaskId: 'T20-15', title: 'Audit package generation', scenarioKind: 'runtime-diagnostic', tools: runtimeTools, outcomes: ['success'], failureModes: ['artifact_missing', 'schema_validation_failure', 'verification_failure'] },
];

const lifecycleDefinitions: LifecycleDefinition[] = [
  lifecycle('TS-01', 'Continue current conversation after service restart', 'runtime-restart', 'durable-checkpoint', 'resume-idempotent-only', 'none', 'not-needed', 'backend_delay', 'continue'),
  lifecycle('TS-02', 'Revisit background job after service restart', 'background-job-store', 'background-job-ledger', 'resume-idempotent-only', 'none', 'not-needed', 'backend_delay', 'background-revision'),
  lifecycle('TS-03', 'Continue after browser refresh', 'browser-refresh', 'workspace-session-store', 'resume-idempotent-only', 'none', 'not-needed', 'stale_state', 'continue'),
  lifecycle('TS-04', 'Continue after closing and reopening tab', 'closed-tab-session-store', 'workspace-session-store', 'resume-idempotent-only', 'none', 'not-needed', 'stale_state', 'continue'),
  lifecycle('TS-05', 'Resume older historical session', 'history-session', 'history-summary', 'read-only', 'none', 'ask-user', 'stale_state', 'partial'),
  lifecycle('TS-06', 'Resume historical failed task', 'failed-run-ledger', 'task-attempt-ledger', 'resume-idempotent-only', 'none', 'not-needed', 'timeout', 'recovery'),
  lifecycle('TS-07', 'Append follow-up to completed historical task', 'completed-run-artifact', 'artifact-index', 'read-only', 'none', 'not-needed', 'artifact_missing', 'continue'),
  lifecycle('TS-08', 'Resume cancelled task with boundary confirmation', 'cancelled-run-record', 'execution-unit-ledger', 'require-human-confirmation', 'none', 'ask-user', 'cancelled', 'failure'),
  lifecycle('TS-09', 'Continue interrupted streaming output', 'interrupted-output-buffer', 'client-event-log', 'resume-idempotent-only', 'none', 'not-needed', 'backend_delay', 'continue'),
  lifecycle('TS-10', 'Continue interrupted tool call', 'interrupted-tool-state', 'execution-unit-ledger', 'block-unknown-side-effects', 'none', 'needs-human', 'state_conflict', 'recovery'),
  lifecycle('TS-11', 'Continue interrupted repair', 'interrupted-repair-state', 'task-attempt-ledger', 'resume-idempotent-only', 'none', 'not-needed', 'tool_stderr', 'recovery'),
  lifecycle('TS-12', 'Edit recent user message and revert', 'edited-user-message', 'history-summary', 'fork-before-write', 'revert', 'fork-branch', 'history_branch_conflict', 'revert'),
  lifecycle('TS-13', 'Edit recent user message and continue', 'edited-user-message', 'history-summary', 'read-only', 'continue', 'not-needed', 'history_branch_conflict', 'continue'),
  lifecycle('TS-14', 'Edit earlier user message and revert', 'edited-user-message', 'history-summary', 'fork-before-write', 'revert', 'fork-branch', 'history_branch_conflict', 'revert'),
  lifecycle('TS-15', 'Edit earlier user message and continue current branch', 'edited-user-message', 'history-summary', 'fork-before-write', 'continue', 'fork-branch', 'history_branch_conflict', 'branch'),
  lifecycle('TS-16', 'Edit assistant history answer then continue', 'edited-assistant-message', 'human-confirmation', 'read-only', 'continue', 'ask-user', 'history_branch_conflict', 'continue'),
  lifecycle('TS-17', 'Continue two branches from same history point', 'history-branch', 'history-summary', 'fork-before-write', 'branch', 'fork-branch', 'history_branch_conflict', 'branch'),
  lifecycle('TS-18', 'Merge two historical branches', 'branch-merge', 'history-summary', 'read-only', 'merge', 'merge-summary', 'history_branch_conflict', 'merge'),
  lifecycle('TS-19', 'Continue from another device', 'remote-client-session', 'workspace-session-store', 'resume-idempotent-only', 'none', 'not-needed', 'stale_state', 'continue'),
  lifecycle('TS-20', 'Concurrent tabs continue same session', 'concurrent-tab-ordering', 'conflict-detector', 'serial-ordering-required', 'branch', 'serialize', 'state_conflict', 'branch'),
  lifecycle('TS-21', 'Continue after capability version upgrade', 'versioned-run-registry', 'capability-version-registry', 'resume-idempotent-only', 'none', 'ask-user', 'stale_state', 'partial'),
  lifecycle('TS-22', 'Continue after backend or config changes', 'runtime-config', 'runtime-config', 'read-only', 'none', 'ask-user', 'backend_delay', 'partial'),
  lifecycle('TS-23', 'Continue after permissions become stricter', 'permission-profile', 'permission-boundary', 'block-unknown-side-effects', 'none', 'needs-human', 'permission_denied', 'partial'),
  lifecycle('TS-24', 'Continue after filesystem changes', 'workspace-file-index', 'file-hash-index', 'read-only', 'none', 'ask-user', 'stale_state', 'partial'),
  lifecycle('TS-25', 'Continue after history compaction', 'compressed-history-digest', 'history-summary', 'resume-idempotent-only', 'none', 'not-needed', 'stale_state', 'continue'),
  lifecycle('TS-26', 'Continue after long offline gap', 'stale-history-summary', 'history-summary', 'read-only', 'none', 'ask-user', 'stale_state', 'partial'),
  lifecycle('TS-27', 'Resume then immediately change goal', 'history-session', 'history-summary', 'fork-before-write', 'continue', 'fork-branch', 'state_conflict', 'continue'),
  lifecycle('TS-28', 'Resume failed task for diagnosis only', 'failed-run-ledger', 'task-attempt-ledger', 'read-only', 'none', 'not-needed', 'timeout', 'failure'),
  lifecycle('TS-29', 'Resume only to export audit', 'history-session', 'task-attempt-ledger', 'read-only', 'none', 'not-needed', 'artifact_missing', 'success'),
  lifecycle('TS-30', 'Recover unknown inconsistent state', 'unknown-state', 'conflict-detector', 'block-unknown-side-effects', 'none', 'needs-human', 'state_conflict', 'failure'),
];

export const complexMultiTurnFixtures: ComplexMultiTurnFixture[] = [
  ...fiveTurnDefinitions.map((definition) => makeStandardFixture(definition, 'five-turn', 5)),
  ...tenTurnDefinitions.map((definition) => makeStandardFixture(definition, 'ten-turn', 10)),
  ...twentyTurnDefinitions.map((definition) => makeStandardFixture(definition, 'twenty-turn', 20)),
  ...lifecycleDefinitions.map(makeLifecycleFixture),
];

function lifecycle(
  sourceTaskId: string,
  title: string,
  resumeSource: ResumeSource,
  stateAuthority: StateAuthority,
  sideEffectPolicy: SideEffectPolicy,
  historyMutationMode: HistoryMutationMode,
  conflictResolution: LifecycleResumeMetadata['conflictResolution'],
  failureMode: FailureInjectionMode,
  outcome: SuccessOutcome,
): LifecycleDefinition {
  return { sourceTaskId, title, resumeSource, stateAuthority, sideEffectPolicy, historyMutationMode, conflictResolution, failureMode, outcome };
}

function makeStandardFixture(definition: FixtureDefinition, tier: Exclude<ComplexFixtureTier, 'lifecycle'>, turnCount: 5 | 10 | 20): ComplexMultiTurnFixture {
  const fixtureId = fixtureIdFor(definition.sourceTaskId, definition.title);
  const failureInjections = makeFailureInjections(fixtureId, definition.failureModes ?? [], tier);
  return {
    schemaVersion: COMPLEX_MULTI_TURN_FIXTURE_SCHEMA_VERSION,
    id: fixtureId,
    sourceTaskId: definition.sourceTaskId,
    tier,
    title: definition.title,
    scenarioKind: definition.scenarioKind,
    objectives: [
      `Stress ${definition.sourceTaskId} without depending on a fixed domain prompt.`,
      'Preserve task state, refs, latency budget, and recovery boundaries across turns.',
    ],
    turns: makeTurns({
      fixtureId,
      sourceTaskId: definition.sourceTaskId,
      title: definition.title,
      tier,
      turnCount,
      tools: definition.tools,
      failureInjections,
      historyMutationMode: 'none',
    }),
    expectedState: expectedState(fixtureId, definition.title, tier),
    allowedTools: definition.tools,
    latencyBudget: latencyBudget(tier),
    memoryExpectations: memoryExpectations(fixtureId, tier),
    artifactExpectations: artifactExpectations(fixtureId, tier, definition.outcomes.includes('merge') ? 'merge-with-provenance' : 'append-revision'),
    failureInjections,
    successCriteria: successCriteria(fixtureId, definition.outcomes),
    historyMutation: historyMutation('none', fixtureId),
    replayTrace: replayTrace(fixtureId, tier, definition.outcomes),
    presentationSnapshots: presentationSnapshots(turnCount, definition.outcomes),
    latencySummary: latencySummary(tier),
    behaviorNotes: [
      'Fixture text is domain-substitutable; assertions target harness behavior rather than prompt wording.',
      'Stable refs must be reused unless the user explicitly asks for refresh or a stale check invalidates them.',
    ],
    tags: [definition.sourceTaskId, tier, definition.scenarioKind],
  };
}

function makeLifecycleFixture(definition: LifecycleDefinition): ComplexMultiTurnFixture {
  const fixtureId = fixtureIdFor(definition.sourceTaskId, definition.title);
  const failureInjections = makeFailureInjections(fixtureId, [definition.failureMode], 'lifecycle');
  const lifecycleMetadata: LifecycleResumeMetadata = {
    resumeSource: definition.resumeSource,
    stateAuthority: definition.stateAuthority,
    sideEffectPolicy: definition.sideEffectPolicy,
    historyMutationMode: definition.historyMutationMode,
    lastDurableTurn: 2,
    lastStableCheckpointRef: `checkpoint:${fixtureId}:turn-2`,
    pendingRunRefs: definition.outcome === 'failure' ? [`run:${fixtureId}:pending-or-failed`] : [],
    backgroundJobRefs: definition.outcome === 'background-revision' ? [`background:${fixtureId}:job-1`] : [],
    artifactLineageExpectation: [`artifact:${fixtureId}:original`, `artifact:${fixtureId}:resumed-revision`],
    freshnessChecks: ['workspace path', 'artifact refs', 'execution units', 'capability versions', 'permissions'],
    conflictResolution: definition.conflictResolution,
  };
  return {
    schemaVersion: COMPLEX_MULTI_TURN_FIXTURE_SCHEMA_VERSION,
    id: fixtureId,
    sourceTaskId: definition.sourceTaskId,
    tier: 'lifecycle',
    title: definition.title,
    scenarioKind: 'lifecycle',
    objectives: [
      'Recover a real product lifecycle boundary from durable state rather than ephemeral chat memory.',
      'Explain state authority, stale risk, artifact lineage, and side-effect policy before continuing.',
    ],
    turns: makeLifecycleTurns(fixtureId, definition, failureInjections),
    expectedState: expectedState(fixtureId, definition.title, 'lifecycle'),
    allowedTools: lifecycleTools,
    latencyBudget: latencyBudget('lifecycle'),
    memoryExpectations: {
      ...memoryExpectations(fixtureId, 'lifecycle'),
      compactionBehavior: definition.resumeSource === 'compressed-history-digest' ? 'state-digest-only' : 'refs-first',
      staleCheckRequired: true,
    },
    artifactExpectations: artifactExpectations(fixtureId, 'lifecycle', definition.historyMutationMode === 'merge' ? 'merge-with-provenance' : definition.historyMutationMode === 'branch' ? 'fork-before-write' : 'append-revision'),
    failureInjections,
    successCriteria: successCriteria(fixtureId, [definition.outcome, definition.historyMutationMode === 'none' ? 'recovery' : definition.historyMutationMode]),
    lifecycle: lifecycleMetadata,
    historyMutation: historyMutation(definition.historyMutationMode, fixtureId),
    replayTrace: replayTrace(fixtureId, 'lifecycle', [definition.outcome]),
    presentationSnapshots: presentationSnapshots(5, [definition.outcome]),
    latencySummary: latencySummary('lifecycle'),
    behaviorNotes: [
      'Lifecycle fixture requires resume preflight before any side effect.',
      'State authority must be named in the user-visible recovery or continuation response.',
    ],
    tags: [definition.sourceTaskId, 'lifecycle', definition.resumeSource, definition.historyMutationMode],
  };
}

function makeTurns(input: {
  fixtureId: string;
  sourceTaskId: string;
  title: string;
  tier: Exclude<ComplexFixtureTier, 'lifecycle'>;
  turnCount: 5 | 10 | 20;
  tools: AllowedTool[];
  failureInjections: FailureInjection[];
  historyMutationMode: HistoryMutationMode;
}) {
  return Array.from({ length: input.turnCount }, (_, offset) => {
    const index = offset + 1;
    const markers = markersFor(input.tier, index, input.historyMutationMode);
    const failureIds = input.failureInjections.filter((failure) => failure.turnIndex === index).map((failure) => failure.id);
    const requiredStatus = presentationStatusFor(input.tier, index, failureIds.length > 0, markers.backgroundContinuation);
    return {
      id: `${input.fixtureId}:turn-${index}`,
      index,
      userPrompt: standardPrompt(input.sourceTaskId, input.title, input.turnCount, index),
      expectedLatencyTier: latencyTierFor(input.tier, index, failureIds.length > 0, markers.backgroundContinuation),
      expectedEscalation: escalationFor(failureIds.length > 0, markers.backgroundContinuation, markers.scopeChange),
      maxFirstResultTimeMs: firstResultMsFor(input.tier, markers.backgroundContinuation),
      maxRepeatedExploration: input.tier === 'twenty-turn' ? 1 : 2,
      requiredPresentationStatus: requiredStatus,
      expectedStateDelta: stateDeltaFor(index, markers, failureIds),
      expectedToolUse: toolsForTurn(input.tools, markers, failureIds.length > 0),
      referencedArtifacts: markers.artifactReferenceFollowup || markers.artifactIdentityCheck ? [`artifact:${input.fixtureId}:primary`, `artifact:${input.fixtureId}:revision`] : [],
      referencedRuns: failureIds.length > 0 || markers.recoveryAction ? [`run:${input.fixtureId}:active`] : [],
      failureInjectionIds: failureIds,
      markers,
    };
  });
}

function makeLifecycleTurns(fixtureId: string, definition: LifecycleDefinition, failureInjections: FailureInjection[]) {
  const mode = definition.historyMutationMode;
  const failureIds = failureInjections.map((failure) => failure.id);
  return [
    {
      id: `${fixtureId}:turn-1`,
      index: 1,
      userPrompt: `${definition.sourceTaskId}: Start or inspect the existing task until a durable partial is available.`,
      expectedLatencyTier: 'bounded' as LatencyTier,
      expectedEscalation: 'bounded-tool-use' as ExpectedEscalation,
      maxFirstResultTimeMs: 30_000,
      maxRepeatedExploration: 1,
      requiredPresentationStatus: 'partial' as PresentationStatus,
      expectedStateDelta: ['create stable checkpoint', 'record artifact refs'],
      expectedToolUse: ['runtime-state', 'artifact-resolver'] as AllowedTool[],
      referencedArtifacts: [`artifact:${fixtureId}:original`],
      referencedRuns: [`run:${fixtureId}:initial`],
      failureInjectionIds: [],
      markers: {},
    },
    {
      id: `${fixtureId}:turn-2`,
      index: 2,
      userPrompt: `${definition.sourceTaskId}: Simulate lifecycle event ${definition.resumeSource} before the next user request.`,
      expectedLatencyTier: 'quick' as LatencyTier,
      expectedEscalation: 'none' as ExpectedEscalation,
      maxFirstResultTimeMs: 15_000,
      maxRepeatedExploration: 0,
      requiredPresentationStatus: 'partial' as PresentationStatus,
      expectedStateDelta: ['persist lifecycle boundary', 'stop relying on transient UI state'],
      expectedToolUse: ['runtime-state'] as AllowedTool[],
      referencedArtifacts: [`artifact:${fixtureId}:original`],
      referencedRuns: [`run:${fixtureId}:initial`],
      failureInjectionIds: [],
      markers: { lifecycleEvent: true, contextCompactionOrResume: true },
    },
    {
      id: `${fixtureId}:turn-3`,
      index: 3,
      userPrompt: `${definition.sourceTaskId}: Continue from the recovered state, but explain source authority and stale risks first.`,
      expectedLatencyTier: 'bounded' as LatencyTier,
      expectedEscalation: 'repair-or-recover' as ExpectedEscalation,
      maxFirstResultTimeMs: 30_000,
      maxRepeatedExploration: 1,
      requiredPresentationStatus: definition.outcome === 'failure' ? 'failed' as PresentationStatus : 'partial' as PresentationStatus,
      expectedStateDelta: ['run resume preflight', 'separate reusable refs from stale refs'],
      expectedToolUse: ['runtime-state', 'execution-unit-reader', 'artifact-resolver'] as AllowedTool[],
      referencedArtifacts: [`artifact:${fixtureId}:original`],
      referencedRuns: [`run:${fixtureId}:initial`],
      failureInjectionIds: failureIds,
      markers: { recoveryAction: true, contextCompactionOrResume: true, historyMutation: mode === 'none' ? undefined : mode },
    },
    {
      id: `${fixtureId}:turn-4`,
      index: 4,
      userPrompt: `${definition.sourceTaskId}: Apply the requested lifecycle policy without duplicating side effects.`,
      expectedLatencyTier: definition.outcome === 'background-revision' ? 'background' as LatencyTier : 'bounded' as LatencyTier,
      expectedEscalation: definition.outcome === 'background-revision' ? 'background-continuation' as ExpectedEscalation : 'bounded-tool-use' as ExpectedEscalation,
      maxFirstResultTimeMs: 30_000,
      maxRepeatedExploration: 1,
      requiredPresentationStatus: definition.outcome === 'background-revision' ? 'background-running' as PresentationStatus : 'partial' as PresentationStatus,
      expectedStateDelta: ['apply side-effect policy', 'preserve artifact lineage'],
      expectedToolUse: ['runtime-state', 'artifact-resolver', 'schema-validator'] as AllowedTool[],
      referencedArtifacts: [`artifact:${fixtureId}:original`, `artifact:${fixtureId}:resumed-revision`],
      referencedRuns: [`run:${fixtureId}:resume`],
      failureInjectionIds: [],
      markers: { artifactIdentityCheck: true, backgroundContinuation: definition.outcome === 'background-revision', historyMutation: mode === 'none' ? undefined : mode },
    },
    {
      id: `${fixtureId}:turn-5`,
      index: 5,
      userPrompt: `${definition.sourceTaskId}: Produce the final resume summary, lineage notes, and next safe action.`,
      expectedLatencyTier: 'quick' as LatencyTier,
      expectedEscalation: 'none' as ExpectedEscalation,
      maxFirstResultTimeMs: 15_000,
      maxRepeatedExploration: 0,
      requiredPresentationStatus: finalStatus(definition.outcome),
      expectedStateDelta: ['emit resume summary', 'record history boundary'],
      expectedToolUse: ['artifact-resolver', 'verifier'] as AllowedTool[],
      referencedArtifacts: [`artifact:${fixtureId}:original`, `artifact:${fixtureId}:resumed-revision`],
      referencedRuns: [`run:${fixtureId}:resume`],
      failureInjectionIds: [],
      markers: { artifactReferenceFollowup: true, artifactIdentityCheck: true, historyMutation: mode === 'none' ? undefined : mode },
    },
  ];
}

function markersFor(tier: Exclude<ComplexFixtureTier, 'lifecycle'>, index: number, historyMutationMode: HistoryMutationMode) {
  const markers: ReturnType<typeof makeMarker> = {};
  if (tier === 'five-turn') {
    markers.scopeChange = index === 2 || index === 4;
    markers.artifactReferenceFollowup = index === 3 || index === 5;
    markers.recoveryAction = index === 4;
    markers.backgroundContinuation = index === 2;
    markers.artifactIdentityCheck = index === 5;
  } else if (tier === 'ten-turn') {
    markers.scopeChange = [3, 7].includes(index);
    markers.artifactReferenceFollowup = [5, 9].includes(index);
    markers.recoveryAction = [4, 6].includes(index);
    markers.backgroundContinuation = index === 8;
    markers.artifactIdentityCheck = index === 9;
  } else {
    markers.scopeChange = [3, 7, 12, 16].includes(index);
    markers.artifactReferenceFollowup = [5, 10, 15, 19].includes(index);
    markers.recoveryAction = [6, 11, 17].includes(index);
    markers.backgroundContinuation = [4, 14].includes(index);
    markers.artifactIdentityCheck = [8, 18].includes(index);
    markers.contextCompactionOrResume = index === 13;
  }
  if (historyMutationMode !== 'none') markers.historyMutation = historyMutationMode;
  return markers;
}

function makeMarker(): NonNullable<ComplexMultiTurnFixture['turns'][number]['markers']> {
  return {};
}

function makeFailureInjections(fixtureId: string, modes: FailureInjectionMode[], tier: ComplexFixtureTier): FailureInjection[] {
  const defaultTurnByTier: Record<ComplexFixtureTier, number[]> = {
    'five-turn': [2, 3, 4],
    'ten-turn': [4, 7, 8],
    'twenty-turn': [6, 11, 17, 4, 14, 19, 8],
    lifecycle: [3],
  };
  return modes.map((mode, offset) => {
    const turnIndex = defaultTurnByTier[tier][offset % defaultTurnByTier[tier].length] ?? 3;
    return {
      id: `${fixtureId}:failure-${offset + 1}`,
      mode,
      turnIndex,
      target: targetForFailure(mode),
      expectedRecovery: recoveryForFailure(mode),
      reusableEvidence: [`checkpoint:${fixtureId}:before-${turnIndex}`, `artifact:${fixtureId}:primary`],
      shouldAvoidDuplicateSideEffect: true,
    };
  });
}

function standardPrompt(sourceTaskId: string, title: string, turnCount: number, index: number): string {
  const phases = [
    'define the goal and first readable result',
    'collect or inspect candidate refs with a bounded budget',
    'tighten scope and update the state digest',
    'handle injected failure with a recovery path',
    'answer a follow-up against the correct artifact',
    'continue from reusable evidence',
    'change output format or verification depth',
    'send slow work to background if needed',
    'check artifact/run identity before editing',
    'produce an audit summary',
    'reconcile a second failure without repeating work',
    'apply another scope change',
    'resume from compacted state digest and refs',
    'merge background progress into the visible answer',
    'compare artifacts without drifting refs',
    'adjust budget or privacy constraints',
    'repair the latest failure checkpoint',
    'verify artifact lineage',
    'prepare final report and remaining gaps',
    'emit task graph, latency, and recovery summary',
  ];
  return `${sourceTaskId}: ${title}; turn ${index}/${turnCount} should ${phases[index - 1] ?? 'continue the task'} while preserving prior state.`;
}

function expectedState(fixtureId: string, title: string, tier: ComplexFixtureTier) {
  return {
    taskGraph: {
      currentGoal: title,
      completed: ['first readable result', 'stable state digest', 'artifact index update'],
      pending: tier === 'twenty-turn' ? ['background verification', 'final audit package'] : ['final audit summary'],
      blocked: [],
    },
    checkpointRefs: [`checkpoint:${fixtureId}:latest`],
    reusableRefs: [`artifact:${fixtureId}:primary`, `run:${fixtureId}:latest`],
    staleRefs: tier === 'lifecycle' ? [`artifact:${fixtureId}:pre-resume-stale-candidate`] : [],
    backgroundJobs: tier === 'twenty-turn' ? [`background:${fixtureId}:verification`] : [],
    requiredStateExplanation: ['state source', 'reused refs', 'pending work', 'failure or stale risk', 'next safe action'],
  };
}

function latencyBudget(tier: ComplexFixtureTier) {
  const budgetByTier = {
    'five-turn': { tier: 'quick' as LatencyTier, first: 15_000, complete: 45_000, background: 90_000, repeated: 2, partial: true },
    'ten-turn': { tier: 'bounded' as LatencyTier, first: 30_000, complete: 90_000, background: 180_000, repeated: 2, partial: true },
    'twenty-turn': { tier: 'background' as LatencyTier, first: 30_000, complete: 180_000, background: 300_000, repeated: 1, partial: true },
    lifecycle: { tier: 'bounded' as LatencyTier, first: 30_000, complete: 90_000, background: 180_000, repeated: 1, partial: true },
  }[tier];
  return {
    tier: budgetByTier.tier,
    maxFirstReadableMs: budgetByTier.first,
    maxTurnCompletionMs: budgetByTier.complete,
    maxBackgroundDelayMs: budgetByTier.background,
    maxRepeatedExploration: budgetByTier.repeated,
    mustReturnReadablePartialBeforeToolsComplete: budgetByTier.partial,
  };
}

function memoryExpectations(fixtureId: string, tier: ComplexFixtureTier) {
  return {
    stateDigestRequired: true,
    reusableRefs: [`artifact:${fixtureId}:primary`, `run:${fixtureId}:latest`, `checkpoint:${fixtureId}:latest`],
    forbiddenRepeatedWork: ['repeat identical search query', 'redownload stable ref', 'revalidate unchanged artifact hash', 'rerun non-idempotent side effect'],
    compactionBehavior: tier === 'twenty-turn' ? 'state-digest-only' as const : 'refs-first' as const,
    staleCheckRequired: tier === 'lifecycle',
  };
}

function artifactExpectations(fixtureId: string, tier: ComplexFixtureTier, mutationPolicy: ComplexMultiTurnFixture['artifactExpectations']['mutationPolicy']) {
  return {
    expectedArtifacts: [`artifact:${fixtureId}:primary`, `artifact:${fixtureId}:revision`, `artifact:${fixtureId}:audit-summary`],
    artifactLineage: [`artifact:${fixtureId}:primary -> artifact:${fixtureId}:revision`, `run:${fixtureId}:latest -> artifact:${fixtureId}:audit-summary`],
    requiredObjectRefs: [`artifact:${fixtureId}:primary`, `run:${fixtureId}:latest`, `execution:${fixtureId}:main`],
    identityAssertions: [
      'follow-up references resolve to the requested artifact, not the most recent unrelated artifact',
      tier === 'lifecycle' ? 'resume output names the pre-resume and post-resume lineage' : 'revision keeps provenance to the source artifact',
    ],
    mutationPolicy,
  };
}

function successCriteria(fixtureId: string, outcomes: SuccessOutcome[]) {
  const uniqueOutcomes = [...new Set(outcomes)];
  return uniqueOutcomes.map((outcome, index) => ({
    id: `${fixtureId}:success-${index + 1}`,
    outcome,
    assertion: assertionForOutcome(outcome),
    metric: metricForOutcome(outcome),
  }));
}

function historyMutation(mode: HistoryMutationMode, fixtureId: string) {
  return {
    mode,
    editedTurn: mode === 'none' ? undefined : 2,
    affectedTurns: mode === 'none' ? [] : [2, 3, 4, 5],
    discardedRefs: mode === 'revert' ? [`run:${fixtureId}:after-edit`, `artifact:${fixtureId}:derived-after-edit`] : [],
    retainedRefs: mode === 'continue' || mode === 'branch' || mode === 'merge' ? [`artifact:${fixtureId}:primary`, `checkpoint:${fixtureId}:before-edit`] : [],
    conflictRefs: mode === 'continue' || mode === 'merge' ? [`artifact:${fixtureId}:conflicting-revision`] : [],
    expectedBoundaryExplanation: boundaryExplanationForMode(mode),
  };
}

function replayTrace(fixtureId: string, tier: ComplexFixtureTier, outcomes: SuccessOutcome[]): ComplexMultiTurnFixture['replayTrace'] {
  const events: ComplexMultiTurnFixture['replayTrace']['requiredEvents'] = ['turn-start', 'state-digest', 'first-readable-result', 'tool-call', 'final-summary'];
  if (outcomes.includes('recovery') || outcomes.includes('failure')) events.push('failure', 'recovery-plan');
  if (outcomes.includes('background-revision') || tier === 'twenty-turn') events.push('background-start', 'background-revision');
  if (tier === 'lifecycle' || tier === 'twenty-turn') events.push('resume-preflight');
  if (outcomes.some((outcome) => ['revert', 'continue', 'branch', 'merge'].includes(outcome))) events.push('history-branch-record');
  const metrics: ComplexMultiTurnFixture['replayTrace']['requiredMetrics'] = ['firstReadableMs', 'turnCompletionMs', 'redundantWorkRate', 'recoverySuccess', 'artifactReferenceAccuracy', 'resumeCorrectness', 'historyMutationCorrectness', 'sideEffectDuplicationRate'];
  return {
    requiredEvents: [...new Set(events)],
    requiredArtifacts: [`artifact:${fixtureId}:primary`, `artifact:${fixtureId}:audit-summary`],
    requiredMetrics: metrics,
  };
}

function presentationSnapshots(turnCount: number, outcomes: SuccessOutcome[]) {
  const final = finalStatus(outcomes.includes('failure') ? 'failure' : outcomes.includes('background-revision') ? 'background-revision' : 'success');
  return [
    {
      turnIndex: 1,
      status: 'partial' as PresentationStatus,
      requiredSections: ['answer', 'progress', 'next safe action'],
      forbiddenSectionsExpanded: ['raw trace', 'full stdout', 'full artifact body'],
    },
    {
      turnIndex: Math.max(2, Math.ceil(turnCount / 2)),
      status: outcomes.includes('failure') ? 'failed' as PresentationStatus : 'partial' as PresentationStatus,
      requiredSections: ['state source', 'reused refs', 'pending work'],
      forbiddenSectionsExpanded: ['raw trace'],
    },
    {
      turnIndex: turnCount,
      status: final,
      requiredSections: ['summary', 'artifact refs', 'latency summary', 'behavior notes'],
      forbiddenSectionsExpanded: ['raw trace'],
    },
  ];
}

function latencySummary(tier: ComplexFixtureTier) {
  const budget = latencyBudget(tier);
  return {
    firstReadableMs: budget.maxFirstReadableMs,
    turnCompletionMs: budget.maxTurnCompletionMs,
    backgroundRevisionMs: budget.maxBackgroundDelayMs,
    redundantWorkRateMax: tier === 'twenty-turn' ? 0.08 : 0.12,
  };
}

function latencyTierFor(tier: Exclude<ComplexFixtureTier, 'lifecycle'>, index: number, failed: boolean, background?: boolean): LatencyTier {
  if (background) return 'background';
  if (failed) return 'bounded';
  if (index === 1) return tier === 'twenty-turn' ? 'bounded' : 'quick';
  if (tier === 'twenty-turn' && [5, 10, 15, 20].includes(index)) return 'deep';
  return tier === 'five-turn' ? 'quick' : 'bounded';
}

function escalationFor(failed: boolean, background?: boolean, scopeChange?: boolean): ExpectedEscalation {
  if (failed) return 'repair-or-recover';
  if (background) return 'background-continuation';
  if (scopeChange) return 'bounded-tool-use';
  return 'none';
}

function presentationStatusFor(tier: Exclude<ComplexFixtureTier, 'lifecycle'>, index: number, failed: boolean, background?: boolean): PresentationStatus {
  if (background) return 'background-running';
  if (failed) return 'failed';
  if ((tier === 'five-turn' && index === 5) || (tier === 'ten-turn' && index === 10) || (tier === 'twenty-turn' && index === 20)) return 'complete';
  return 'partial';
}

function firstResultMsFor(tier: Exclude<ComplexFixtureTier, 'lifecycle'>, background?: boolean): number {
  if (background) return tier === 'five-turn' ? 15_000 : 30_000;
  return tier === 'five-turn' ? 15_000 : 30_000;
}

function stateDeltaFor(index: number, markers: ReturnType<typeof makeMarker>, failureIds: string[]) {
  const deltas = ['update state digest'];
  if (index === 1) deltas.push('create task graph');
  if (markers.scopeChange) deltas.push('record scope change and invalidate affected pending work');
  if (markers.artifactReferenceFollowup) deltas.push('resolve explicit artifact refs before answering');
  if (markers.recoveryAction || failureIds.length > 0) deltas.push('create recovery plan with reusable evidence');
  if (markers.backgroundContinuation) deltas.push('start or merge background continuation');
  if (markers.contextCompactionOrResume) deltas.push('restore from compact state digest and refs');
  if (markers.artifactIdentityCheck) deltas.push('assert artifact identity and lineage');
  return deltas;
}

function toolsForTurn(tools: AllowedTool[], markers: ReturnType<typeof makeMarker>, failed: boolean): AllowedTool[] {
  const required = new Set<AllowedTool>(['agentserver-generation']);
  if (markers.artifactReferenceFollowup || markers.artifactIdentityCheck) required.add('artifact-resolver');
  if (markers.recoveryAction || failed) required.add('schema-validator');
  if (markers.backgroundContinuation) required.add('background-continuation');
  for (const tool of tools.slice(0, 4)) required.add(tool);
  return [...required].filter((tool) => tools.includes(tool) || tool === 'agentserver-generation');
}

function targetForFailure(mode: FailureInjectionMode): string {
  const targets: Record<FailureInjectionMode, string> = {
    timeout: 'long-running execution unit',
    empty_search_result: 'retrieval candidate set',
    download_unavailable: 'source download step',
    schema_validation_failure: 'artifact schema validator',
    backend_delay: 'agent backend stream',
    tool_stderr: 'workspace command stderr',
    artifact_missing: 'artifact resolver',
    verification_failure: 'verifier result',
    network_failure: 'metadata provider',
    permission_denied: 'privacy or permission boundary',
    state_conflict: 'session state authority',
    cancelled: 'cancelled execution unit',
    history_branch_conflict: 'history branch record',
    stale_state: 'resume preflight freshness check',
  };
  return targets[mode];
}

function recoveryForFailure(mode: FailureInjectionMode): string {
  const recoveries: Record<FailureInjectionMode, string> = {
    timeout: 'return readable partial, checkpoint completed work, and continue only unfinished steps',
    empty_search_result: 'propose alternate query or narrower scope while preserving failed query evidence',
    download_unavailable: 'use metadata-only evidence and list the unavailable source as a gap',
    schema_validation_failure: 'repair payload shape without discarding valid artifact content',
    backend_delay: 'surface progress and move non-critical work to background',
    tool_stderr: 'summarize stderr and rerun only the failed idempotent step',
    artifact_missing: 'stale-check artifact refs and ask or recover from lineage when missing',
    verification_failure: 'mark unsupported claims and request targeted verification repair',
    network_failure: 'reuse cached refs and retry with bounded alternate provider',
    permission_denied: 'downgrade to local or read-only path and explain skipped steps',
    state_conflict: 'enter conflict resolution instead of guessing the winning state',
    cancelled: 'confirm cancel boundary before any continuation',
    history_branch_conflict: 'create auditable branch record and isolate derived refs',
    stale_state: 'run resume preflight and refresh only invalidated refs',
  };
  return recoveries[mode];
}

function assertionForOutcome(outcome: SuccessOutcome): string {
  const assertions: Record<SuccessOutcome, string> = {
    success: 'final answer includes task state summary, artifact refs, evidence gaps, and next steps',
    partial: 'first readable result is useful before deep tools finish',
    failure: 'failure is user-readable with reason, reusable evidence, and next safe action',
    recovery: 'next turn continues from checkpoint without repeating stable side effects',
    'background-revision': 'background result lands as a revision with provenance rather than overwriting the partial',
    revert: 'derived state after the edited turn is discarded and explained',
    continue: 'prior derived state is retained as context with conflicts and uncertainty marked',
    branch: 'branch state isolates artifacts, runs, verification, and background jobs',
    merge: 'merge summary detects conflicts, duplicates, and artifact lineage',
  };
  return assertions[outcome];
}

function metricForOutcome(outcome: SuccessOutcome): ComplexMultiTurnFixture['successCriteria'][number]['metric'] {
  if (outcome === 'partial' || outcome === 'background-revision') return 'presentation';
  if (outcome === 'failure' || outcome === 'recovery') return 'recovery';
  if (['revert', 'continue', 'branch', 'merge'].includes(outcome)) return 'history';
  return 'state';
}

function boundaryExplanationForMode(mode: HistoryMutationMode): string {
  const explanations: Record<HistoryMutationMode, string> = {
    none: 'No history mutation; continue from the latest durable turn and current refs.',
    revert: 'Discard turns, runs, artifacts, and background jobs derived after the edited node.',
    continue: 'Keep existing derived results as context, but mark which conclusions conflict with the edit.',
    branch: 'Fork task state from the selected history point and isolate branch-local refs.',
    merge: 'Compare branch lineage, resolve conflicts, and produce a merge summary without silent overwrites.',
  };
  return explanations[mode];
}

function finalStatus(outcome: SuccessOutcome): PresentationStatus {
  if (outcome === 'failure') return 'failed';
  if (outcome === 'partial') return 'partial';
  if (outcome === 'background-revision') return 'background-revision';
  return 'complete';
}

function fixtureIdFor(sourceTaskId: string, title: string): string {
  return `${sourceTaskId.toLowerCase()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}
