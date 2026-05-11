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
export type VerificationIntensity = 'none' | 'light' | 'standard' | 'strict' | 'audit';
export type SideEffectAllowance = 'block' | 'requires-approval' | 'allow';
export type BudgetExhaustedPolicy = 'partial-payload' | 'needs-human' | 'fail-with-reason';
export type HarnessInteractionProgressEventType =
  | 'process-progress'
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

export interface HarnessInput {
  requestId?: string;
  prompt?: string;
  request?: unknown;
  profileId?: HarnessProfileId;
  stage?: HarnessStage;
  intentMode?: IntentMode;
  contextRefs?: string[];
  requiredContextRefs?: string[];
  blockedContextRefs?: string[];
  candidateCapabilities?: HarnessCandidate[];
  conversationSignals?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  humanApprovalSatisfied?: boolean;
  budgetOverrides?: PartialHarnessBudgets;
}

export interface HarnessRuntime {
  evaluate(input: HarnessInput): Promise<HarnessEvaluation>;
  dispatchHook(stage: HarnessStage, context: HarnessContext): Promise<HarnessDecision>;
}

export interface HarnessProfile {
  id: HarnessProfileId;
  version: string;
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
  intentSignals?: TurnIntentSignals;
  contextHints?: ContextDecision;
  capabilityHints?: CapabilityDecision;
  budgets?: PartialHarnessBudgets;
  verification?: Partial<VerificationDecision>;
  repair?: Partial<RepairDecision>;
  progress?: Partial<ProgressDecision>;
  presentation?: Partial<PresentationPlan>;
  promptDirectives?: PromptDirective[];
  blockedRefs?: string[];
  blockedCapabilities?: string[];
  auditNotes?: HarnessAuditNote[];
}

export interface HarnessDefaults {
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
}

export interface HarnessCandidate {
  kind: 'skill' | 'tool' | 'observe' | 'action' | 'verifier' | 'view' | 'runtime-adapter' | 'composed';
  id: string;
  manifestRef: string;
  score: number;
  reasons: string[];
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
  requireCitations?: boolean;
  requireCurrentRefs?: boolean;
  requireArtifactRefs?: boolean;
  selectedVerifierIds?: string[];
}

export interface VerificationPolicy {
  intensity: VerificationIntensity;
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
}

export interface RepairContextPolicy {
  kind: 'none' | 'repair-rerun' | 'supplement' | 'fail-closed' | 'needs-human';
  maxAttempts: number;
  includeStdoutSummary: boolean;
  includeStderrSummary: boolean;
}

export interface ProgressDecision {
  initialStatus?: string;
  visibleMilestones?: string[];
  phaseNames?: string[];
  silenceTimeoutMs?: number;
  backgroundContinuation?: boolean;
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
  silencePolicy?: SilencePolicy;
  backgroundPolicy?: BackgroundPolicy;
  cancelPolicy?: CancelPolicy;
  interactionPolicy?: InteractionPolicy;
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
  presentationPlan: PresentationPlan;
  promptDirectives: PromptDirective[];
  traceRef?: string;
}

export interface HarnessTrace {
  schemaVersion: 'sciforge.agent-harness-trace.v1';
  traceId: string;
  requestId?: string;
  profileId: string;
  stages: HarnessTraceStage[];
  conflicts: HarnessMergeConflict[];
  auditNotes: HarnessAuditNote[];
}

export interface HarnessTraceStage {
  stage: HarnessStage;
  callbackId: string;
  decision: HarnessDecision;
  contractSnapshot: HarnessContract;
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
