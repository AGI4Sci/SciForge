export type HarnessStage =
  | 'onRequestReceived'
  | 'onRequestNormalized'
  | 'classifyIntent'
  | 'selectProfile'
  | 'selectContext'
  | 'setExplorationBudget'
  | 'onRegistryBuild'
  | 'selectCapabilities'
  | 'onBeforeCapabilityBroker'
  | 'onAfterCapabilityBroker'
  | 'onToolPolicy'
  | 'onBudgetAllocate'
  | 'beforePromptRender'
  | 'beforeAgentDispatch'
  | 'onAgentDispatched'
  | 'onAgentStreamEvent'
  | 'onStreamGuardTrip'
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'onObserveStart'
  | 'onActionStepEnd'
  | 'beforeResultValidation'
  | 'afterResultValidation'
  | 'beforeResultPresentation'
  | 'onRepairRequired'
  | 'beforeRepairDispatch'
  | 'afterRepairAttempt'
  | 'beforeUserProgressEvent'
  | 'onInteractionRequested'
  | 'onBackgroundContinuation'
  | 'onCancelRequested'
  | 'onPolicyDecision'
  | 'onBudgetDebit'
  | 'onVerifierVerdict'
  | 'onAuditRecord'
  | 'onRunCompleted'
  | 'onRunFailed'
  | 'onRunCancelled';

export type IntentMode = 'fresh' | 'continuation' | 'repair' | 'audit' | 'file-grounded' | 'interactive';
export type ExplorationMode = 'minimal' | 'normal' | 'deep';
export type LatencyTier = 'instant' | 'quick' | 'bounded' | 'deep' | 'background';
export type VerificationIntensity = 'none' | 'light' | 'standard' | 'strict' | 'audit';
export type SideEffectAllowance = 'block' | 'requires-approval' | 'allow';
export type BudgetExhaustedPolicy = 'partial-payload' | 'needs-human' | 'fail-with-reason';
export type HarnessEvaluationMode = 'full' | 'criticalPathOnly';
export type HarnessStagePathKind = 'critical' | 'audit' | 'external';
export type HarnessAuditHookStatus = 'deferred' | 'skipped' | 'completed';
export type VerificationLayer = 'shape' | 'reference' | 'claim' | 'recompute' | 'audit';
export type CapabilityEscalationTier =
  | 'direct-context'
  | 'metadata-summary'
  | 'single-tool'
  | 'tool-composition'
  | 'workspace-task'
  | 'deep-agent-project'
  | 'repair-or-background';
export type CapabilityCostClass = 'free' | 'low' | 'medium' | 'high';
export type CapabilityLatencyClass = 'instant' | 'short' | 'bounded' | 'long' | 'background';
export type CapabilitySideEffectClass = 'none' | 'read' | 'write' | 'network' | 'desktop' | 'external';
export type RepairBudgetTier = LatencyTier;
export type RepairStopCondition =
  | 'repeated-failure'
  | 'no-code-change'
  | 'no-new-evidence'
  | 'budget-exhausted'
  | 'human-required';
export type ResultPresentationStatus = 'complete' | 'partial' | 'needs-human' | 'background-running' | 'failed';
export type ConversationAnswerStrategy =
  | 'direct'
  | 'answer-first'
  | 'artifact-first'
  | 'evidence-first'
  | 'defer-until-verified';
export type ConversationEvidenceMode = 'minimal-inline' | 'refs-first' | 'expanded';
export type ConversationAuditHydration = 'none' | 'on-demand' | 'background' | 'required';
export type HarnessInteractionProgressEventType =
  | 'process-progress'
  | 'partial-result'
  | 'interaction-request'
  | 'clarification-needed'
  | 'human-approval-required'
  | 'guidance-queued'
  | 'result-presentation'
  | 'run-cancelled';
export type HarnessProgressEventImportance = 'low' | 'normal' | 'high' | 'blocking';
export type HarnessProgressPhaseStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type HarnessRunCancellationReason = 'user-cancelled' | 'system-aborted' | 'timeout' | 'backend-error';
export type HarnessRunState =
  | 'running'
  | 'awaiting-interaction'
  | 'guidance-queued'
  | 'backgrounded'
  | 'cancelled'
  | 'failed'
  | 'completed';
export type WorkspaceMemoryEntryKind =
  | 'artifact-ref'
  | 'recent-run'
  | 'known-failure'
  | 'downloaded-ref'
  | 'verified-claim'
  | 'opened-file'
  | 'capability-outcome';
export type WorkspaceMemoryValidity = 'valid' | 'stale' | 'expired' | 'invalid' | 'unknown';
export type WorkspaceMemoryReuseAction = 'reuse' | 'skip-duplicate' | 'refresh' | 'rerun' | 'ignore';
export type WorkspaceMemoryStaleReason =
  | 'file-changed'
  | 'capability-version-changed'
  | 'user-requested-rerun'
  | 'expired'
  | 'invalidated'
  | 'source-run-failed'
  | 'missing-provenance'
  | 'low-confidence';
export type ParallelWorkOwnerKind = 'main-agent' | 'subagent' | 'script' | 'verifier' | 'runtime';
export type ParallelWorkExecutionKind = 'critical-path' | 'sidecar' | 'parallel-script' | 'verifier' | 'subagent';
export type ParallelWorkStatus =
  | 'planned'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'deferred'
  | 'merged';
export type ParallelWorkConflictKind =
  | 'shared-write'
  | 'external-mutation'
  | 'expensive-download'
  | 'dependency-cycle'
  | 'budget-exhausted'
  | 'owner-scope-missing';
export type ParallelWorkEarlyStopReason =
  | 'first-result-ready'
  | 'deadline-exceeded'
  | 'low-value-sidecar'
  | 'dependency-failed'
  | 'budget-exhausted'
  | 'cancel-requested'
  | 'conflict-guard';
export type FirstResultKind = 'answer' | 'candidate-list' | 'partial-artifact' | 'failure-reason' | 'needs-human';
export type FirstResultStatus = 'ready' | 'partial' | 'failed' | 'needs-human';
export type BackgroundContinuationTrigger =
  | 'foreground-budget-exhausted'
  | 'first-result-deadline'
  | 'user-requested-background'
  | 'deep-verification'
  | 'repair-continuation';
export type BackgroundContinuationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ContinuationRevisionKind = 'evidence-added' | 'artifact-added' | 'verification-added' | 'repair-added' | 'finalization';
export type ExplorationActivityKind = 'retrieval' | 'download' | 'artifact-scan' | 'verifier' | 'repair';
export type ExplorationEarlyStopReason =
  | 'answer-sufficient'
  | 'evidence-sufficient'
  | 'diminishing-returns'
  | 'budget-near-exhaustion'
  | 'user-goal-satisfied'
  | 'duplicate-exploration'
  | 'first-result-ready'
  | 'human-required';
export type ExplorationDedupKeyKind = 'ref' | 'query-provider' | 'artifact-hash' | 'verifier-result' | 'download-url' | 'repair-signature';
export type StartupContextSectionKind =
  | 'always-on'
  | 'capability-brief-index'
  | 'workspace-memory'
  | 'artifact-index'
  | 'recent-runs'
  | 'policy-reminders';
export type StartupContextInvalidationReason =
  | 'workspace-changed'
  | 'capability-registry-changed'
  | 'session-changed'
  | 'run-changed'
  | 'ttl-expired'
  | 'source-ref-changed';
export type StartupContextExpansionKind = 'capability-manifest' | 'view-manifest' | 'verifier-manifest' | 'policy-doc' | 'artifact-index' | 'run-record';

export interface HarnessInput {
  requestId?: string;
  prompt?: string;
  request?: unknown;
  profileId?: HarnessProfileId;
  latencyTier?: LatencyTier;
  stage?: HarnessStage;
  intentMode?: IntentMode;
  contextRefs?: string[];
  requiredContextRefs?: string[];
  blockedContextRefs?: string[];
  candidateCapabilities?: HarnessCandidate[];
  conversationSignals?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  evaluationMode?: HarnessEvaluationMode;
  humanApprovalSatisfied?: boolean;
  budgetOverrides?: PartialHarnessBudgets;
  startupContextEnvelope?: StartupContextEnvelope;
  workspaceMemoryIndex?: WorkspaceMemoryIndex;
  parallelWorkPlan?: ParallelWorkPlan;
}

export interface HarnessRuntime {
  evaluate(input: HarnessInput): Promise<HarnessEvaluation>;
  dispatchHook(stage: HarnessStage, context: HarnessContext): Promise<HarnessDecision>;
}

export interface HarnessProfile {
  id: HarnessProfileId;
  version: string;
  moduleStack?: string[];
  callbacks: HarnessCallback[];
  defaults: HarnessDefaults;
  mergePolicy: HarnessMergePolicy;
}

export type HarnessProfileId =
  | 'balanced-default'
  | 'fast-answer'
  | 'research-grade'
  | 'debug-repair'
  | 'low-cost'
  | 'privacy-strict'
  | 'high-recall-literature'
  | (string & {});

export interface HarnessCallback {
  id: string;
  version: string;
  stages: HarnessStage[];
  decide(context: HarnessContext): Promise<HarnessDecision> | HarnessDecision;
}

export interface HarnessContext {
  input: Readonly<HarnessInput>;
  profile: Readonly<HarnessProfile>;
  stage: HarnessStage;
  contract: Readonly<HarnessContract>;
  trace: Readonly<HarnessTrace>;
}

export interface HarnessEvaluation {
  contract: HarnessContract;
  trace: HarnessTrace;
}

export interface HarnessDecision {
  latencyTier?: LatencyTier;
  intentSignals?: TurnIntentSignals;
  contextHints?: ContextDecision;
  capabilityHints?: CapabilityDecision;
  budgets?: PartialHarnessBudgets;
  verification?: Partial<VerificationDecision>;
  repair?: Partial<RepairDecision>;
  progress?: Partial<ProgressDecision>;
  conversationPlan?: Partial<ConversationPlan>;
  presentation?: Partial<PresentationPlan>;
  promptDirectives?: PromptDirective[];
  blockedRefs?: string[];
  blockedCapabilities?: string[];
  auditNotes?: HarnessAuditNote[];
}

export interface HarnessDefaults {
  latencyTier?: LatencyTier;
  intentMode: IntentMode;
  explorationMode: ExplorationMode;
  allowedContextRefs: string[];
  blockedContextRefs: string[];
  requiredContextRefs: string[];
  contextBudget: ContextBudget;
  capabilityPolicy: CapabilityPolicy;
  toolBudget: CapabilityBudget;
  verificationPolicy: VerificationPolicy;
  repairContextPolicy: RepairContextPolicy;
  progressPlan: ProgressPlan;
  conversationPlan?: ConversationPlan;
  presentationPlan: PresentationPlan;
  promptDirectives: PromptDirective[];
}

export interface HarnessMergePolicy {
  allowBudgetWidening?: boolean;
  allowVerificationDowngradeWithHumanApproval?: boolean;
  allowSideEffectWideningWithHumanApproval?: boolean;
}

export interface TurnIntentSignals {
  intentMode?: IntentMode;
  explorationMode?: ExplorationMode;
  latencyTier?: LatencyTier;
  confidence?: number;
  reasons?: string[];
}

export interface ContextDecision {
  allowedContextRefs?: string[];
  blockedContextRefs?: string[];
  requiredContextRefs?: string[];
  contextBudget?: Partial<ContextBudget>;
}

export interface CapabilityDecision {
  candidates?: HarnessCandidate[];
  preferredCapabilityIds?: string[];
  blockedCapabilities?: string[];
  sideEffects?: Partial<SideEffectPolicy>;
  escalationPlan?: CapabilityEscalationStep[];
  candidateTiers?: Partial<Record<CapabilityEscalationTier, string[]>>;
}

export interface CapabilityEscalationStep {
  tier: CapabilityEscalationTier;
  candidateIds: string[];
  benefit: string;
  cost: string;
  expectedBenefit?: string;
  costClass?: CapabilityCostClass;
  latencyClass?: CapabilityLatencyClass;
  sideEffectClass?: CapabilitySideEffectClass;
  stopCondition: string;
}

export interface HarnessCandidate {
  kind: 'skill' | 'tool' | 'observe' | 'action' | 'verifier' | 'view' | 'runtime-adapter' | 'composed';
  id: string;
  manifestRef: string;
  score: number;
  reasons: string[];
  costClass?: CapabilityCostClass;
  latencyClass?: CapabilityLatencyClass;
  sideEffectClass?: CapabilitySideEffectClass;
  providerAvailability?: ProviderAvailability[];
  budget?: Partial<CapabilityBudget>;
  fallbackCandidateIds?: string[];
}

export interface ProviderAvailability {
  providerId: string;
  available: boolean;
  reason?: string;
}

export interface HarnessBudgets {
  contextBudget: ContextBudget;
  toolBudget: CapabilityBudget;
}

export interface LatencyTierPolicy {
  latencyTier: LatencyTier;
  explorationMode: ExplorationMode;
  contextBudget: ContextBudget;
  capabilityPolicy: CapabilityPolicy;
  toolBudget: CapabilityBudget;
  verificationPolicy: VerificationPolicy;
  repairContextPolicy: RepairContextPolicy;
  progressPlan: ProgressPlan;
  conversationPlan: ConversationPlan;
  presentationPlan: PresentationPlan;
}

export interface PartialHarnessBudgets {
  contextBudget?: Partial<ContextBudget>;
  toolBudget?: Partial<CapabilityBudget>;
}

export interface ContextBudget {
  maxPromptTokens: number;
  maxHistoryTurns: number;
  maxReferenceDigests: number;
  maxFullTextRefs: number;
}

export interface CapabilityBudget {
  maxWallMs: number;
  maxContextTokens: number;
  maxToolCalls: number;
  maxObserveCalls: number;
  maxActionSteps: number;
  maxNetworkCalls: number;
  maxDownloadBytes: number;
  maxResultItems: number;
  maxProviders: number;
  maxRetries: number;
  perProviderTimeoutMs: number;
  costUnits: number;
  exhaustedPolicy: BudgetExhaustedPolicy;
}

export interface VerificationDecision {
  intensity?: VerificationIntensity;
  verificationLayers?: VerificationLayer[];
  requireCitations?: boolean;
  requireCurrentRefs?: boolean;
  requireArtifactRefs?: boolean;
  selectedVerifierIds?: string[];
}

export interface VerificationPolicy {
  intensity: VerificationIntensity;
  verificationLayers: VerificationLayer[];
  requireCitations: boolean;
  requireCurrentRefs: boolean;
  requireArtifactRefs: boolean;
  selectedVerifierIds?: string[];
}

export interface RepairDecision {
  kind?: 'none' | 'repair-rerun' | 'supplement' | 'fail-closed' | 'needs-human';
  maxAttempts?: number;
  includeStdoutSummary?: boolean;
  includeStderrSummary?: boolean;
  maxWallMs?: number;
  cheapOnly?: boolean;
  partialFirst?: boolean;
  materializePartialOnFailure?: boolean;
  checkpointArtifacts?: boolean;
  stopOnRepeatedFailure?: boolean;
  tierBudgets?: Partial<Record<RepairBudgetTier, RepairTierBudget>>;
  stopConditions?: RepairStopCondition[];
}

export interface RepairContextPolicy {
  kind: 'none' | 'repair-rerun' | 'supplement' | 'fail-closed' | 'needs-human';
  maxAttempts: number;
  includeStdoutSummary: boolean;
  includeStderrSummary: boolean;
  maxWallMs: number;
  cheapOnly: boolean;
  partialFirst: boolean;
  materializePartialOnFailure: boolean;
  checkpointArtifacts: boolean;
  stopOnRepeatedFailure: boolean;
  tierBudgets: Partial<Record<RepairBudgetTier, RepairTierBudget>>;
  stopConditions: RepairStopCondition[];
}

export interface RepairTierBudget {
  maxAttempts: number;
  maxWallMs: number;
  maxContextTokens?: number;
  maxToolCalls?: number;
}

export interface ProgressDecision {
  initialStatus?: string;
  visibleMilestones?: string[];
  phaseNames?: string[];
  silenceTimeoutMs?: number;
  backgroundContinuation?: boolean;
  firstResultDeadlineMs?: number;
  phaseDeadlines?: Partial<Record<string, number>>;
  backgroundAfterMs?: number;
  silencePolicy?: Partial<SilencePolicy>;
  backgroundPolicy?: Partial<BackgroundPolicy>;
  cancelPolicy?: Partial<CancelPolicy>;
  interactionPolicy?: Partial<InteractionPolicy>;
}

export interface ProgressPlan {
  initialStatus: string;
  visibleMilestones: string[];
  phaseNames?: string[];
  silenceTimeoutMs: number;
  backgroundContinuation: boolean;
  firstResultDeadlineMs?: number;
  phaseDeadlines?: Record<string, number>;
  backgroundAfterMs?: number;
  silencePolicy?: SilencePolicy;
  backgroundPolicy?: BackgroundPolicy;
  cancelPolicy?: CancelPolicy;
  interactionPolicy?: InteractionPolicy;
}

export interface ConversationPlan {
  answerStrategy: ConversationAnswerStrategy;
  evidenceMode: ConversationEvidenceMode;
  refsFirst: boolean;
  auditHydration: ConversationAuditHydration;
  maxInlineEvidenceRefs: number;
  maxInlineAuditNotes: number;
  exposeAuditDrawer: boolean;
}

export type PresentationPrimaryMode = 'answer-first' | 'artifact-first' | 'failure-first' | 'diagnostic-first';
export type PresentationSectionId =
  | 'answer'
  | 'key-findings'
  | 'evidence'
  | 'artifacts'
  | 'next-actions'
  | 'process'
  | 'diagnostics'
  | 'raw-payload';
export type PresentationVisibility = 'hidden' | 'collapsed' | 'expanded';
export type PresentationRoleMode = 'standard' | 'power-user' | 'debug';

export interface CitationPolicy {
  requireCitationOrUncertainty: boolean;
  maxInlineCitationsPerFinding: number;
  showVerificationState: boolean;
}

export interface ArtifactActionPolicy {
  primaryActions: string[];
  secondaryActions: string[];
  preferRightPane: boolean;
}

export interface PresentationPlan {
  primaryMode: PresentationPrimaryMode;
  status?: ResultPresentationStatus;
  defaultExpandedSections: PresentationSectionId[];
  defaultCollapsedSections: PresentationSectionId[];
  citationPolicy: CitationPolicy;
  artifactActionPolicy: ArtifactActionPolicy;
  diagnosticsVisibility: PresentationVisibility;
  processVisibility: PresentationVisibility;
  roleMode?: PresentationRoleMode;
}

export interface SilencePolicy {
  timeoutMs: number;
  decision: 'visible-status' | 'retry' | 'abort' | 'background';
  status: string;
  maxRetries: number;
  auditRequired: boolean;
}

export interface BackgroundPolicy {
  enabled: boolean;
  status: string;
  notifyOnCompletion: boolean;
}

export interface CancelPolicy {
  allowUserCancel: boolean;
  userCancellation: HarnessRunCancellationReason;
  systemAbort: HarnessRunCancellationReason;
  timeout: HarnessRunCancellationReason;
  backendError: HarnessRunCancellationReason;
}

export interface InteractionPolicy {
  clarification: 'allow' | 'require' | 'block';
  humanApproval: 'allow' | 'require' | 'block';
  guidanceQueue: 'allow' | 'block';
}

export interface HarnessInteractionProgressEvent {
  schemaVersion: 'sciforge.interaction-progress-event.v1';
  type: HarnessInteractionProgressEventType;
  runState: HarnessRunState;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  phase?: string;
  status: HarnessProgressPhaseStatus;
  importance: HarnessProgressEventImportance;
  reason?: string;
  budget?: ProgressEventBudget;
  cancellationReason?: HarnessRunCancellationReason;
  termination?: {
    schemaVersion: 'sciforge.run-termination.v1';
    reason: HarnessRunCancellationReason;
    actor: 'user' | 'system' | 'backend';
    progressStatus: 'cancelled' | 'failed';
    runState: 'cancelled' | 'failed';
    sessionStatus: 'cancelled' | 'failed';
    retryable: boolean;
    detail?: string;
  };
  interaction?: ProgressInteractionRequest;
}

export interface WorkspaceMemoryProvenance {
  source: 'runtime' | 'harness' | 'capability' | 'user' | 'imported';
  sourceRef: string;
  sourceRunId?: string;
  producedAt: string;
  observedAt?: string;
  capabilityId?: string;
  capabilityVersion?: string;
  artifactRef?: string;
  fileRef?: string;
  contentHash?: string;
}

export interface WorkspaceMemoryEntry {
  id: string;
  kind: WorkspaceMemoryEntryKind;
  ref: string;
  title?: string;
  summary?: string;
  tags?: string[];
  sourceRunId?: string;
  provenance: WorkspaceMemoryProvenance;
  validity: WorkspaceMemoryValidity;
  confidence: number;
  expiresAt?: string;
  lastValidatedAt?: string;
  invalidatedAt?: string;
  invalidationReason?: WorkspaceMemoryStaleReason;
  evidenceRefs?: string[];
  duplicateOf?: string;
  invalidationKeys?: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkspaceMemoryIndex {
  schemaVersion: 'sciforge.workspace-memory-index.v1';
  indexId?: string;
  workspaceId: string;
  generatedAt: string;
  sourceRefs?: string[];
  entries: WorkspaceMemoryEntry[];
  artifactRefs: string[];
  recentRuns: string[];
  knownFailures: string[];
  downloadedRefs: string[];
  verifiedClaims: string[];
  openedFiles: string[];
  capabilityOutcomes: string[];
}

export interface WorkspaceMemoryStaleSignal {
  ref?: string;
  fileRef?: string;
  contentHash?: string;
  capabilityId?: string;
  capabilityVersion?: string;
  userRequestedRerun?: boolean;
  invalidatedRefs?: string[];
  sourceRunStatus?: 'completed' | 'failed' | 'cancelled' | 'unknown';
}

export interface WorkspaceMemoryStaleAssessment {
  entryId: string;
  validity: WorkspaceMemoryValidity;
  staleReasons: WorkspaceMemoryStaleReason[];
  refreshRequired: boolean;
}

export interface WorkspaceMemoryReuseDecision {
  schemaVersion: 'sciforge.workspace-memory-reuse-decision.v1';
  decisionId: string;
  requestId?: string;
  reusedEntries: WorkspaceMemoryEntry[];
  skippedDuplicateSteps: WorkspaceMemoryReuseStep[];
  staleEntries: WorkspaceMemoryStaleAssessment[];
  actions: WorkspaceMemoryReuseActionRecord[];
  auditNote: HarnessAuditNote;
}

export interface WorkspaceMemoryReuseStep {
  stepId: string;
  reason: string;
  reusedEntryId: string;
  ref: string;
}

export interface WorkspaceMemoryReuseActionRecord {
  entryId: string;
  action: WorkspaceMemoryReuseAction;
  reason: string;
  staleReasons?: WorkspaceMemoryStaleReason[];
}

export interface ParallelWorkOwner {
  id: string;
  kind: ParallelWorkOwnerKind;
  owns: string[];
  readOnly?: boolean;
}

export interface ParallelWorkTask {
  id: string;
  title?: string;
  dependsOn?: string[];
  readSet: string[];
  writeSet: string[];
  externalResourceKeys?: string[];
  sideEffectClass: CapabilitySideEffectClass;
  costClass: CapabilityCostClass;
  deadlineMs: number;
  owner: ParallelWorkOwner;
  expectedOutput: string;
  executionKind?: ParallelWorkExecutionKind;
  criticalPath?: boolean;
  valueScore?: number;
}

export interface ParallelWorkConflict {
  kind: ParallelWorkConflictKind;
  taskIds: string[];
  resource: string;
  resolution: 'serialize' | 'skip' | 'cancel' | 'defer';
  reason: string;
}

export interface ParallelWorkPlan {
  schemaVersion: 'sciforge.parallel-work-plan.v1';
  planId: string;
  latencyTier: LatencyTier;
  maxConcurrency: number;
  firstResultDeadlineMs: number;
  backgroundAfterMs?: number;
  tasks: ParallelWorkTask[];
  batches: ParallelWorkBatch[];
  conflicts: ParallelWorkConflict[];
  earlyStopPolicy: ParallelWorkEarlyStopPolicy;
}

export interface ParallelWorkBatch {
  index: number;
  taskIds: string[];
  blocksFirstResult: boolean;
  deadlineMs: number;
}

export interface ParallelWorkEarlyStopPolicy {
  sidecarValueThreshold: number;
  cancelSidecarsAfterFirstResult: boolean;
  stopReasons: ParallelWorkEarlyStopReason[];
}

export interface ParallelWorkTaskTrace {
  taskId: string;
  ownerId: string;
  status: ParallelWorkStatus;
  batchIndex?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  reason?: string;
  outputRef?: string;
  mergeDecision?: 'merge' | 'ignore' | 'defer' | 'needs-human';
}

export interface ParallelWorkResult {
  schemaVersion: 'sciforge.parallel-work-result.v1';
  planId: string;
  status: 'complete' | 'partial' | 'cancelled' | 'failed';
  taskResults: ParallelWorkTaskTrace[];
  firstResultReadyAfterBatch?: number;
  cancelledTaskIds: string[];
  skippedTaskIds: string[];
  mergeDecisions: ParallelWorkTaskTrace[];
}

export interface StartupContextEnvelope {
  schemaVersion: 'sciforge.startup-context-envelope.v1';
  envelopeId: string;
  generatedAt: string;
  ttlMs: number;
  hash: string;
  sourceRefs: string[];
  workspace: {
    root: string;
    branch?: string;
    dirty?: boolean;
  };
  session: {
    sessionId?: string;
    runId?: string;
    backend?: string;
  };
  budget: {
    latencyTier: LatencyTier;
    maxPromptTokens: number;
    maxToolCalls: number;
  };
  alwaysOnFacts: Record<string, unknown>;
  capabilityBriefIndex: CapabilityBriefIndex;
  workspaceMemoryRef?: string;
  sections: StartupContextSection[];
  policyReminders: string[];
  invalidationKeys: string[];
  cache?: StartupContextCache;
  onDemandExpansion?: StartupOnDemandExpansion;
  noDuplicateExplorationGuard?: StartupNoDuplicateExplorationGuard;
}

export interface StartupContextSection {
  id: string;
  kind: StartupContextSectionKind;
  ref: string;
  tokenEstimate: number;
  expandOnDemand: boolean;
}

export interface StartupContextCache {
  cacheKey: string;
  validUntil: string;
  sourceHashes: Record<string, string>;
  invalidatesOn: StartupContextInvalidationReason[];
}

export interface StartupOnDemandExpansion {
  schemaVersion: 'sciforge.startup-context.on-demand-expansion.v1';
  defaultPolicy: 'expand-selected-ref-only';
  entries: StartupExpansionRef[];
}

export interface StartupExpansionRef {
  ref: string;
  kind: StartupContextExpansionKind;
  targetId: string;
  sourceRef?: string;
  hash?: string;
  summary?: string;
}

export interface StartupNoDuplicateExplorationGuard {
  schemaVersion: 'sciforge.startup-context.no-duplicate-exploration-guard.v1';
  coveredFacts: string[];
  coveredRefs: string[];
  skipExpensiveExplorationBeforeExpansion: boolean;
  duplicateExplorationStopReasons: string[];
}

export interface CapabilityBriefIndex {
  schemaVersion: 'sciforge.capability-brief-index.v1';
  generatedAt: string;
  sourceRefs: string[];
  briefs: CapabilityBrief[];
}

export interface CapabilityBrief {
  id: string;
  name: string;
  purpose: string;
  inputRefs: string[];
  outputRefs: string[];
  costClass: CapabilityCostClass;
  latencyClass: CapabilityLatencyClass;
  sideEffectClass: CapabilitySideEffectClass;
  manifestRef: string;
  expansionRef: string;
}

export interface ProgressEventBudget {
  elapsedMs?: number;
  remainingMs?: number;
  retryCount?: number;
  maxRetries?: number;
  maxWallMs?: number;
}

export interface ProgressInteractionRequest {
  id: string;
  kind: 'clarification' | 'human-approval' | 'guidance';
  required: boolean;
  promptRef?: string;
}

export interface FirstResultRecord {
  schemaVersion: 'sciforge.first-result-record.v1';
  id: string;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  latencyTier: LatencyTier;
  kind: FirstResultKind;
  status: FirstResultStatus;
  createdAtMs: number;
  deadlineMs: number;
  elapsedMs?: number;
  presentationRef?: string;
  artifactRefs: string[];
  evidenceRefs: string[];
  failureReason?: string;
  needsHumanReason?: string;
  backgroundContinuationId?: string;
}

export interface BackgroundContinuationRevision {
  id: string;
  revision: number;
  kind: ContinuationRevisionKind;
  createdAtMs: number;
  summary: string;
  supersedesRevisionId?: string;
  presentationRef?: string;
  artifactRefs: string[];
  evidenceRefs: string[];
  verificationRefs: string[];
  provenanceRefs: string[];
}

export interface BackgroundContinuationRecord {
  schemaVersion: 'sciforge.background-continuation-record.v1';
  id: string;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  latencyTier: LatencyTier;
  trigger: BackgroundContinuationTrigger;
  status: BackgroundContinuationStatus;
  createdAtMs: number;
  foregroundResultId: string;
  reason: string;
  provenanceRefs: string[];
  revisions: BackgroundContinuationRevision[];
}

export interface ContinuationPolicy {
  latencyTier: LatencyTier;
  firstResultDeadlineMs: number;
  backgroundAfterMs: number;
  firstResultKinds: FirstResultKind[];
  backgroundEnabled: boolean;
  revisionRequired: boolean;
  provenanceRequired: boolean;
  foregroundStatus: ResultPresentationStatus;
  backgroundStatus: ResultPresentationStatus;
  allowedTriggers: BackgroundContinuationTrigger[];
}

export interface ExplorationTopKPolicy {
  retrieval: number;
  download: number;
  artifactScan: number;
  verifier: number;
  repair: number;
}

export interface ExplorationEarlyStopPolicy {
  reasons: ExplorationEarlyStopReason[];
  budgetRemainingRatioThreshold: number;
  diminishingReturnMinNewEvidence: number;
  stopAfterFirstResultForSidecars: boolean;
  remainingUpgradePaths: CapabilityEscalationTier[];
  requireStopReason: boolean;
}

export interface ExplorationDedupPolicy {
  enabled: boolean;
  keyKinds: ExplorationDedupKeyKind[];
  scope: 'request' | 'run' | 'workspace';
  ttlMs?: number;
  skipDuplicateByDefault: boolean;
}

export interface ExplorationPolicy {
  latencyTier: LatencyTier;
  topK: ExplorationTopKPolicy;
  earlyStop: ExplorationEarlyStopPolicy;
  dedup: ExplorationDedupPolicy;
  auditReasonRequired: boolean;
}

export interface PromptDirective {
  id: string;
  sourceCallbackId: string;
  priority: number;
  text: string;
}

export interface HarnessAuditNote {
  sourceCallbackId: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface CapabilityPolicy {
  candidates: HarnessCandidate[];
  preferredCapabilityIds: string[];
  blockedCapabilities: string[];
  sideEffects: SideEffectPolicy;
  escalationPlan: CapabilityEscalationStep[];
  candidateTiers: Partial<Record<CapabilityEscalationTier, string[]>>;
}

export interface SideEffectPolicy {
  network: SideEffectAllowance;
  workspaceWrite: SideEffectAllowance;
  externalMutation: SideEffectAllowance;
  codeExecution: SideEffectAllowance;
}

export interface HarnessContract {
  schemaVersion: 'sciforge.agent-harness-contract.v1';
  profileId: string;
  latencyTier: LatencyTier;
  intentMode: IntentMode;
  explorationMode: ExplorationMode;
  allowedContextRefs: string[];
  blockedContextRefs: string[];
  requiredContextRefs: string[];
  contextBudget: ContextBudget;
  capabilityPolicy: CapabilityPolicy;
  toolBudget: CapabilityBudget;
  verificationPolicy: VerificationPolicy;
  repairContextPolicy: RepairContextPolicy;
  progressPlan: ProgressPlan;
  conversationPlan: ConversationPlan;
  presentationPlan: PresentationPlan;
  promptDirectives: PromptDirective[];
  traceRef?: string;
}

export interface HarnessTrace {
  schemaVersion: 'sciforge.agent-harness-trace.v1';
  traceId: string;
  requestId?: string;
  profileId: string;
  latencyTier: LatencyTier;
  stages: HarnessTraceStage[];
  auditHooks: HarnessAuditHookTrace[];
  conflicts: HarnessMergeConflict[];
  auditNotes: HarnessAuditNote[];
}

export interface HarnessTraceStage {
  stage: HarnessStage;
  pathKind: HarnessStagePathKind;
  callbackId: string;
  auditStatus?: HarnessAuditHookStatus;
  decision: HarnessDecision;
  contractSnapshot: HarnessContract;
}

export interface HarnessAuditHookTrace {
  stage: HarnessStage;
  callbackId?: string;
  status: HarnessAuditHookStatus;
  reason: string;
}

export interface HarnessMergeConflict {
  field: string;
  previous: unknown;
  incoming: unknown;
  chosen: unknown;
  reason: string;
  sourceCallbackId: string;
  stage: HarnessStage;
}

export interface HarnessModule {
  id: string;
  version: string;
  ownedStages: HarnessStage[];
  inputs: string[];
  outputs: string[];
  cost: 'free' | 'cheap' | 'bounded' | 'expensive';
  defaultTierApplicability: LatencyTier[];
}
