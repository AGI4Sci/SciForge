export const COMPLEX_MULTI_TURN_FIXTURE_SCHEMA_VERSION = 'sciforge.complex-multiturn-fixture.v1' as const;

export type ComplexFixtureTier = 'five-turn' | 'ten-turn' | 'twenty-turn' | 'lifecycle';

export type ComplexScenarioKind =
  | 'research'
  | 'code'
  | 'runtime-diagnostic'
  | 'artifact-analysis'
  | 'data-analysis'
  | 'report-editing'
  | 'cross-capability'
  | 'lifecycle';

export type LatencyTier = 'instant' | 'quick' | 'bounded' | 'deep' | 'background';

export type PresentationStatus =
  | 'partial'
  | 'complete'
  | 'failed'
  | 'needs-human'
  | 'background-running'
  | 'background-revision';

export type ExpectedEscalation =
  | 'none'
  | 'ask-clarifying-question'
  | 'bounded-tool-use'
  | 'deep-verification'
  | 'repair-or-recover'
  | 'background-continuation'
  | 'human-approval';

export type AllowedTool =
  | 'agentserver-generation'
  | 'artifact-resolver'
  | 'artifact-reader'
  | 'artifact-writer'
  | 'workspace-read'
  | 'workspace-write'
  | 'command-runner'
  | 'python-task'
  | 'literature-search'
  | 'metadata-fetch'
  | 'pdf-download'
  | 'schema-validator'
  | 'runtime-state'
  | 'execution-unit-reader'
  | 'verifier'
  | 'background-continuation'
  | 'browser-session-state';

export type FailureInjectionMode =
  | 'timeout'
  | 'empty_search_result'
  | 'download_unavailable'
  | 'schema_validation_failure'
  | 'backend_delay'
  | 'tool_stderr'
  | 'artifact_missing'
  | 'verification_failure'
  | 'network_failure'
  | 'permission_denied'
  | 'state_conflict'
  | 'cancelled'
  | 'history_branch_conflict'
  | 'stale_state';

export type ResumeSource =
  | 'runtime-restart'
  | 'background-job-store'
  | 'browser-refresh'
  | 'closed-tab-session-store'
  | 'history-session'
  | 'failed-run-ledger'
  | 'completed-run-artifact'
  | 'cancelled-run-record'
  | 'interrupted-output-buffer'
  | 'interrupted-tool-state'
  | 'interrupted-repair-state'
  | 'edited-user-message'
  | 'edited-assistant-message'
  | 'history-branch'
  | 'branch-merge'
  | 'remote-client-session'
  | 'concurrent-tab-ordering'
  | 'versioned-run-registry'
  | 'runtime-config'
  | 'permission-profile'
  | 'workspace-file-index'
  | 'compressed-history-digest'
  | 'stale-history-summary'
  | 'unknown-state';

export type StateAuthority =
  | 'durable-checkpoint'
  | 'background-job-ledger'
  | 'workspace-session-store'
  | 'history-summary'
  | 'task-attempt-ledger'
  | 'artifact-index'
  | 'execution-unit-ledger'
  | 'client-event-log'
  | 'capability-version-registry'
  | 'runtime-config'
  | 'permission-boundary'
  | 'file-hash-index'
  | 'human-confirmation'
  | 'conflict-detector';

export type SideEffectPolicy =
  | 'read-only'
  | 'resume-idempotent-only'
  | 'require-human-confirmation'
  | 'block-unknown-side-effects'
  | 'fork-before-write'
  | 'serial-ordering-required';

export type HistoryMutationMode = 'none' | 'revert' | 'continue' | 'branch' | 'merge';

export type SuccessOutcome =
  | 'success'
  | 'partial'
  | 'failure'
  | 'recovery'
  | 'background-revision'
  | 'revert'
  | 'continue'
  | 'branch'
  | 'merge';

export interface ComplexTurnExpectation {
  id: string;
  index: number;
  userPrompt: string;
  expectedLatencyTier: LatencyTier;
  expectedEscalation: ExpectedEscalation;
  maxFirstResultTimeMs: number;
  maxRepeatedExploration: number;
  requiredPresentationStatus: PresentationStatus;
  expectedStateDelta: string[];
  expectedToolUse: AllowedTool[];
  referencedArtifacts: string[];
  referencedRuns: string[];
  failureInjectionIds: string[];
  markers: {
    scopeChange?: boolean;
    artifactReferenceFollowup?: boolean;
    recoveryAction?: boolean;
    backgroundContinuation?: boolean;
    artifactIdentityCheck?: boolean;
    contextCompactionOrResume?: boolean;
    lifecycleEvent?: boolean;
    historyMutation?: HistoryMutationMode;
  };
}

export interface ExpectedConversationState {
  taskGraph: {
    currentGoal: string;
    completed: string[];
    pending: string[];
    blocked: string[];
  };
  checkpointRefs: string[];
  reusableRefs: string[];
  staleRefs: string[];
  backgroundJobs: string[];
  requiredStateExplanation: string[];
}

export interface LatencyBudget {
  tier: LatencyTier;
  maxFirstReadableMs: number;
  maxTurnCompletionMs: number;
  maxBackgroundDelayMs: number;
  maxRepeatedExploration: number;
  mustReturnReadablePartialBeforeToolsComplete: boolean;
}

export interface MemoryExpectation {
  stateDigestRequired: boolean;
  reusableRefs: string[];
  forbiddenRepeatedWork: string[];
  compactionBehavior: 'none' | 'state-digest-only' | 'refs-first' | 'history-summary-only';
  staleCheckRequired: boolean;
}

export interface ArtifactExpectation {
  expectedArtifacts: string[];
  artifactLineage: string[];
  requiredObjectRefs: string[];
  identityAssertions: string[];
  mutationPolicy: 'append-revision' | 'modify-target-only' | 'read-only' | 'fork-before-write' | 'merge-with-provenance';
}

export interface FailureInjection {
  id: string;
  mode: FailureInjectionMode;
  turnIndex: number;
  target: string;
  expectedRecovery: string;
  reusableEvidence: string[];
  shouldAvoidDuplicateSideEffect: boolean;
}

export interface SuccessCriterion {
  id: string;
  outcome: SuccessOutcome;
  assertion: string;
  metric: 'state' | 'latency' | 'artifact' | 'memory' | 'recovery' | 'presentation' | 'history' | 'side-effect';
}

export interface LifecycleResumeMetadata {
  resumeSource: ResumeSource;
  stateAuthority: StateAuthority;
  sideEffectPolicy: SideEffectPolicy;
  historyMutationMode: HistoryMutationMode;
  lastDurableTurn: number;
  lastStableCheckpointRef: string;
  pendingRunRefs: string[];
  backgroundJobRefs: string[];
  artifactLineageExpectation: string[];
  freshnessChecks: string[];
  conflictResolution: 'not-needed' | 'ask-user' | 'fork-branch' | 'serialize' | 'needs-human' | 'merge-summary';
}

export interface HistoryMutationExpectation {
  mode: HistoryMutationMode;
  editedTurn?: number;
  affectedTurns: number[];
  discardedRefs: string[];
  retainedRefs: string[];
  conflictRefs: string[];
  expectedBoundaryExplanation: string;
}

export interface ReplayTraceExpectation {
  requiredEvents: Array<'turn-start' | 'state-digest' | 'first-readable-result' | 'tool-call' | 'failure' | 'recovery-plan' | 'background-start' | 'background-revision' | 'resume-preflight' | 'history-branch-record' | 'final-summary'>;
  requiredArtifacts: string[];
  requiredMetrics: Array<'firstReadableMs' | 'turnCompletionMs' | 'redundantWorkRate' | 'recoverySuccess' | 'artifactReferenceAccuracy' | 'resumeCorrectness' | 'historyMutationCorrectness' | 'sideEffectDuplicationRate'>;
}

export interface PresentationSnapshotExpectation {
  turnIndex: number;
  status: PresentationStatus;
  requiredSections: string[];
  forbiddenSectionsExpanded: string[];
}

export interface LatencySummaryExpectation {
  firstReadableMs: number;
  turnCompletionMs: number;
  backgroundRevisionMs?: number;
  redundantWorkRateMax: number;
}

export interface ComplexMultiTurnFixture {
  schemaVersion: typeof COMPLEX_MULTI_TURN_FIXTURE_SCHEMA_VERSION;
  id: string;
  sourceTaskId: string;
  tier: ComplexFixtureTier;
  title: string;
  scenarioKind: ComplexScenarioKind;
  objectives: string[];
  turns: ComplexTurnExpectation[];
  expectedState: ExpectedConversationState;
  allowedTools: AllowedTool[];
  latencyBudget: LatencyBudget;
  memoryExpectations: MemoryExpectation;
  artifactExpectations: ArtifactExpectation;
  failureInjections: FailureInjection[];
  successCriteria: SuccessCriterion[];
  lifecycle?: LifecycleResumeMetadata;
  historyMutation: HistoryMutationExpectation;
  replayTrace: ReplayTraceExpectation;
  presentationSnapshots: PresentationSnapshotExpectation[];
  latencySummary: LatencySummaryExpectation;
  behaviorNotes: string[];
  tags: string[];
}
