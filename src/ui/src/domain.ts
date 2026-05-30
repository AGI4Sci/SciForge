import type { ScenarioId } from './data';
import type { RuntimeAgentBackend } from '@sciforge-ui/runtime-contract/agent-backend-policy';
import type { SkillDomain } from '@sciforge/scenario-core/scenario-routing-policy';
import type {
  AgentStreamEvent,
  AlignmentContractRecord,
  BeliefEdgeKind,
  BeliefNodeKind,
  DecisionRevisionStatus,
  DisplayIntent,
  EvidenceClaim,
  ExecutionUnitStatus,
  FeedbackCommentStatus,
  FeedbackPriority,
  GuidanceQueueRecord,
  NotebookRecord,
  ObjectAction,
  ObjectReference,
  PresentationInput,
  PreviewDescriptor,
  ResolvedViewPlan,
  RuntimeArtifact,
  RuntimeCompatibilityDiagnostic,
  RuntimeCompatibilityFingerprint,
  RuntimeExecutionUnit,
  RunStatus,
  ScenarioInstanceId,
  ScenarioPackageRef,
  SciForgeReference,
  SciForgeMessage,
  SciForgeRun,
  SciForgeSession,
  TaskRunCard,
  ResearcherDecisionStatus,
  TimelineDecisionStatus,
  TimelineVariantKind,
  TimelineVisibility,
  UIManifestSlot,
  ViewPlanSection,
} from '@sciforge-ui/runtime-contract';

export {
  ALIGNMENT_CONTRACT_ARTIFACT_TYPE,
  ALIGNMENT_CONTRACT_SCHEMA_VERSION,
  ALIGNMENT_CONTRACT_VERSION_ARTIFACT_TYPE,
} from '@sciforge-ui/runtime-contract';

export type BuiltInScenarioId = ScenarioId;
export type {
  AlignmentContractRecord,
  ArtifactPreviewAction,
  AgentCompactCapability,
  AgentContextCompaction,
  AgentContextWindowSource,
  AgentContextWindowState,
  AgentStreamEvent,
  AgentTokenUsage,
  BackgroundCompletionEventType,
  BackgroundCompletionRef,
  BackgroundCompletionRuntimeEvent,
  BackgroundCompletionStatus,
  BeliefEdgeKind,
  BeliefNodeKind,
  DecisionRevisionStatus,
  DisplayIntent,
  EvidenceClaim,
  ExecutionUnitStatus,
  FeedbackCommentStatus,
  FeedbackPriority,
  GuidanceQueueRecord,
  GuidanceQueueStatus,
  MessageRole,
  NotebookRecord,
  ObjectAction,
  ObjectReference,
  ObjectReferenceKind,
  ObjectReferenceStatus,
  ObjectResolution,
  PresentationInput,
  PreviewDerivative,
  PreviewDerivativeKind,
  PreviewDescriptor,
  PreviewDescriptorKind,
  PreviewDescriptorSource,
  PreviewInlinePolicy,
  ResolvedViewPlan,
  RuntimeArtifact,
  RuntimeCompatibilityDiagnostic,
  RuntimeCompatibilityFingerprint,
  RuntimeExecutionUnit,
  RunStatus,
  ScenarioInstanceId,
  ScenarioPackageRef,
  SciForgeReference,
  SciForgeReferenceKind,
  SciForgeMessage,
  SciForgeRun,
  SciForgeSession,
  TaskRunCard,
  ResearcherDecisionStatus,
  SemanticTurnAcceptance,
  SessionVersionRecord,
  TimelineDecisionStatus,
  TimelineVariantKind,
  TimelineVisibility,
  TurnAcceptance,
  TurnAcceptanceFailure,
  TurnAcceptanceSeverity,
  UIManifestSlot,
  UIModuleLifecycle,
  UIModuleManifest,
  UserGoalSnapshot,
  UserGoalType,
  ViewCompare,
  ViewEncoding,
  ViewLayout,
  ViewPlanSection,
  ViewPreset,
  ViewSelection,
  ViewSync,
  ViewTransform,
} from '@sciforge-ui/runtime-contract';

export interface BeliefGraphNode {
  id: string;
  kind: BeliefNodeKind;
  label: string;
  confidence?: number;
  refs?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface BeliefGraphEdge {
  id: string;
  kind: BeliefEdgeKind;
  source: string;
  target: string;
  weight?: number;
  updateReason?: string;
  createdAt: string;
}

export interface BeliefDependencyGraph {
  id: string;
  schemaVersion: '1';
  nodes: BeliefGraphNode[];
  edges: BeliefGraphEdge[];
  currentDecisionRefs?: string[];
  updatedAt: string;
}

export interface ResearcherDecisionRecord {
  id: string;
  status: ResearcherDecisionStatus;
  revisionStatus: DecisionRevisionStatus;
  subjectRef: string;
  evidenceRefs: string[];
  supersedesRef?: string;
  confirmedBy: string;
  confirmedAt: string;
  rationale: string;
}

export interface WetLabEvidenceSummary {
  qualityChecks: Array<{ key: string; status: 'pass' | 'warn' | 'fail' | 'unknown'; detail: string }>;
  supports: string[];
  opposes: string[];
  uncertain: string[];
  limitations: string[];
  recommendedNextActions: string[];
  researcherDecisionRefs?: string[];
}

export interface TimelineEventRecord {
  id: string;
  actor: string;
  action: string;
  subject: string;
  artifactRefs: string[];
  executionUnitRefs: string[];
  beliefRefs: string[];
  branchId?: string;
  visibility: TimelineVisibility;
  decisionStatus: TimelineDecisionStatus;
  createdAt: string;
}

export interface ResearchBranchRecord {
  id: string;
  variantKind: TimelineVariantKind;
  parentBranchId?: string;
  sourceContractVersion?: string;
  sourceBeliefId?: string;
  mergeFrom?: string[];
  archivedAt?: string;
  restoreReason?: string;
}

export interface CollaborationPolicy {
  roles: string[];
  visibility: TimelineVisibility;
  audience: string[];
  sensitiveDataFlags: string[];
  exportPolicy: 'allowed' | 'restricted' | 'blocked';
  decisionAuthority: string[];
}

/** Snapshot of an Issue while it remains open on GitHub (REST `/issues`, excludes pull requests). */
export interface GithubSyncedOpenIssueRecord {
  schemaVersion: 1;
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  state?: string;
  updatedAt: string;
  authorLogin?: string;
  labels: string[];
  syncedAt: string;
  conflict?: {
    status: 'none' | 'local-edited-after-remote' | 'remote-edited-after-local' | 'body-diverged';
    localFeedbackId?: string;
    localUpdatedAt?: string;
    remoteUpdatedAt?: string;
    note?: string;
  };
}

export interface SciForgeWorkspaceState {
  schemaVersion: 2;
  workspacePath: string;
  sessionsByScenario: Record<ScenarioInstanceId, SciForgeSession>;
  archivedSessions: SciForgeSession[];
  alignmentContracts: AlignmentContractRecord[];
  feedbackComments?: FeedbackCommentRecord[];
  feedbackRequests?: FeedbackRequestRecord[];
  feedbackRepairRuns?: FeedbackRepairRunRecord[];
  feedbackRepairResults?: FeedbackRepairResultRecord[];
  feedbackRepairActions?: FeedbackRepairActionRecord[];
  feedbackRepairGuidance?: FeedbackRepairGuidanceRecord[];
  /** Open GitHub Issues synced from the configured feedback repo (PRs excluded). Replaced on each sync. */
  githubSyncedOpenIssues?: GithubSyncedOpenIssueRecord[];
  beliefGraphs?: BeliefDependencyGraph[];
  timelineEvents?: TimelineEventRecord[];
  reusableTaskCandidates?: ReusableTaskCandidateRecord[];
  hiddenOfficialPackageIds?: string[];
  branches?: ResearchBranchRecord[];
  researcherDecisions?: ResearcherDecisionRecord[];
  collaborationPolicy?: CollaborationPolicy;
  updatedAt: string;
}

export interface FeedbackTargetSnapshot {
  selector: string;
  stableSelector?: string;
  path: string;
  domPath?: string;
  text: string;
  textSnippet?: string;
  tagName: string;
  role?: string;
  label?: string;
  ariaLabel?: string;
  rect: { x: number; y: number; width: number; height: number };
  commentPoint?: { x: number; y: number };
}

export interface FeedbackRuntimeSnapshot {
  page: string;
  url: string;
  scenarioId: ScenarioInstanceId;
  sessionId?: string;
  activeRunId?: string;
  sessionTitle?: string;
  messageCount?: number;
  artifactSummary?: Array<{ id: string; type: string; title?: string }>;
  executionSummary?: Array<{ id: string; tool: string; status: ExecutionUnitStatus }>;
  uiManifest?: string[];
  appVersion?: string;
}

export interface FeedbackScreenshotEvidence {
  schemaVersion: 1;
  captureMode?: 'full-page' | 'page-structure-fallback';
  dataUrl: string;
  rawDataUrl?: string;
  annotatedDataUrl?: string;
  rawScreenshotRef?: string;
  annotatedScreenshotRef?: string;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  capturedAt: string;
  targetRect: { x: number; y: number; width: number; height: number };
  targetAnnotations?: Array<{
    label: string;
    rect: { x: number; y: number; width: number; height: number };
    commentPoint?: { x: number; y: number };
    selector?: string;
    title?: string;
  }>;
  commentPoint?: { x: number; y: number };
  scrollX?: number;
  scrollY?: number;
  annotationLabel?: string;
  includeForAgent?: boolean;
  note?: string;
}

export interface FeedbackEvidenceStatus {
  status: 'complete' | 'partial' | 'missing';
  rawScreenshot: boolean;
  annotatedScreenshot: boolean;
  targetSnapshot: boolean;
  runtimeSnapshot: boolean;
  scrubbed: boolean;
  diagnostics: string[];
}

export interface FeedbackEvidenceAssetRecord {
  schemaVersion: 1;
  id: string;
  kind: 'raw-screenshot' | 'annotated-screenshot' | 'scrubbed-annotated-screenshot';
  label: string;
  ref: string;
  sourceRef?: string;
  localRef?: string;
  markdownImageUrl?: string;
  githubMarkdownUrl?: string;
  publicUrl?: string;
  uploadRef?: string;
  uploadProvider?: string;
  uploadStatus?: 'private' | 'local' | 'ready' | 'uploaded' | 'failed';
  uploadedAt?: string;
  uploadedBy?: string;
  uploadBranch?: string;
  uploadCommitUrl?: string;
  uploadError?: string;
  localOnly?: boolean;
  visibility?: 'public' | 'private';
  mediaType?: 'image/jpeg' | 'image/png';
  width?: number;
  height?: number;
  bytes?: number;
  sha256?: string;
  createdAt: string;
  includeForAgent?: boolean;
  metadata?: Record<string, unknown>;
}

export interface FeedbackCommentRecord {
  id: string;
  schemaVersion: 1;
  authorId: string;
  authorName: string;
  comment: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  status: FeedbackCommentStatus;
  priority: FeedbackPriority;
  severity?: FeedbackPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  restoredAt?: string;
  requestId?: string;
  target: FeedbackTargetSnapshot;
  viewport: { width: number; height: number; devicePixelRatio: number; scrollX: number; scrollY: number };
  runtime: FeedbackRuntimeSnapshot;
  screenshotRef?: string;
  rawScreenshotRef?: string;
  annotatedScreenshotRef?: string;
  evidenceBundleRef?: string;
  evidenceAssets?: FeedbackEvidenceAssetRecord[];
  evidenceStatus?: FeedbackEvidenceStatus;
  screenshot?: FeedbackScreenshotEvidence;
  githubIssueUrl?: string;
  githubIssueNumber?: number;
  githubSyncStatus?: 'not-synced' | 'pending' | 'github-open' | 'github-closed' | 'conflict' | 'failed';
  githubSyncError?: string;
  githubSyncedAt?: string;
  githubIssueState?: 'open' | 'closed';
  githubIssueUpdatedAt?: string;
  repairPolicy?: {
    defaultCommit: false;
    defaultPush: false;
    defaultMerge: false;
    requiresUserConfirmation: true;
    allowedOperations: string[];
    forbiddenOperations: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface FeedbackRepairGuidanceRecord {
  schemaVersion: 1;
  id: string;
  issueId?: string;
  repairRunId: string;
  repairResultId?: string;
  status: 'recorded' | 'resumed' | 'blocked';
  requestedAt: string;
  requestedBy: string;
  message: string;
  terminalMirrorRef?: string;
  codexSessionId?: string;
  eventCount?: number;
  responseSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface FeedbackRequestRecord {
  id: string;
  schemaVersion: 1;
  title: string;
  status: 'draft' | 'ready' | 'in-progress' | 'fixed' | 'closed';
  feedbackIds: string[];
  summary: string;
  acceptanceCriteria: string[];
  evidenceRefs?: string[];
  expectedResult?: string;
  risks?: string[];
  allowedOperations?: string[];
  forbiddenOperations?: string[];
  metadata?: Record<string, unknown>;
  githubIssueUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SciForgeInstanceManifest {
  schemaVersion: 1;
  instance: {
    id: string;
    name: string;
  };
  workspacePath: string;
  repo: {
    detected: boolean;
    root?: string;
    branch?: string;
    commit?: string;
    remote?: string;
    dirty?: boolean;
  };
  stableVersion?: {
    schemaVersion: 1;
    instanceId: string;
    role: string;
    repoRoot: string;
    branch?: string;
    commit?: string;
    versionLabel: string;
    promotedAt: string;
    tests: Array<{
      name?: string;
      command?: string;
      status: 'passed' | 'failed' | 'skipped' | 'unknown';
      summary?: string;
      outputRef?: string;
      completedAt?: string;
    }>;
    promotedBy: string;
    sourceInstance?: string;
    syncState: {
      status: 'local-stable' | 'promoted-from-source' | 'pending-sync' | 'synced' | 'rolled-back';
      sourceCommit?: string;
      targetCommit?: string;
      planId?: string;
      notes?: string[];
    };
  };
  capabilities: string[];
}

export interface SciForgeWorkspaceWriterHealth {
  ok: boolean;
  service: string;
  schemaVersion: 1;
  pid?: number;
  startedAt?: string;
  instanceId?: string;
  lifecycleToken?: string;
  capabilities: string[];
  endpoints?: Record<string, unknown>;
}

export interface FeedbackScreenshotMetadata {
  screenshotRef?: string;
  schemaVersion?: 1;
  mediaType?: FeedbackScreenshotEvidence['mediaType'];
  width?: number;
  height?: number;
  capturedAt?: string;
  targetRect?: FeedbackScreenshotEvidence['targetRect'];
  includeForAgent?: boolean;
  note?: string;
  hasDataUrl: boolean;
  dataUrlBytes?: number;
}

export interface FeedbackIssueGithubMetadata {
  issueNumber?: number;
  issueUrl?: string;
  openIssue?: GithubSyncedOpenIssueRecord;
}

export type FeedbackRepairStatus =
  | 'assigned'
  | 'analyzing'
  | 'patching'
  | 'testing'
  | 'needs-human-verification'
  | 'fixed'
  | 'blocked'
  | 'github-synced';

export interface FeedbackRepairExecutorInstance {
  id?: string;
  name?: string;
  appUrl?: string;
  workspaceWriterUrl?: string;
  workspacePath?: string;
}

export interface FeedbackRepairTestEvidence {
  name?: string;
  command?: string;
  status: 'passed' | 'failed' | 'skipped' | 'unknown';
  outputRef?: string;
  summary?: string;
}

export interface FeedbackRepairHumanVerification {
  status: 'not-required' | 'required' | 'pending' | 'passed' | 'failed' | 'verified' | 'rejected' | 'not-run';
  verifier?: string;
  conclusion?: string;
  evidenceRefs?: string[];
  verifiedAt?: string;
  reviewer?: string;
  note?: string;
}

export interface FeedbackIssueSummary {
  schemaVersion: 1;
  id: string;
  kind: 'feedback-comment';
  title: string;
  status: FeedbackCommentStatus;
  priority: FeedbackPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  comment: string;
  requestId?: string;
  runtime: Pick<FeedbackRuntimeSnapshot, 'page' | 'scenarioId' | 'sessionId' | 'activeRunId'>;
  screenshot?: FeedbackScreenshotMetadata;
  github?: FeedbackIssueGithubMetadata;
}

export interface FeedbackRepairRunRecord {
  schemaVersion: 1;
  id: string;
  issueId: string;
  status: FeedbackRepairStatus | 'running';
  externalInstanceId?: string;
  externalInstanceName?: string;
  actor?: string;
  startedAt: string;
  handoffRef?: string;
  note?: string;
  terminalMirrorRef?: string;
  terminalMirror?: Array<{ timestamp: string; stream: 'stdout' | 'stderr' | 'event'; text: string }>;
  planRef?: string;
  baseCommit?: string;
  dirtyWorktreeDigest?: string;
  protectedFilesDigest?: string;
  feedbackDataDigest?: string;
  confirmationPolicy?: {
    commit: 'disabled' | 'requires-user-confirmation';
    push: 'disabled' | 'requires-second-confirmation';
    pr: 'disabled' | 'requires-second-confirmation';
    merge: 'never';
  };
  metadata?: Record<string, unknown>;
}

export interface FeedbackRepairActionRecord {
  schemaVersion: 1;
  id: string;
  issueId: string;
  repairResultId: string;
  action: 'commit' | 'push' | 'pr' | 'merge' | 'browser-recheck';
  status: 'requires-user-confirmation' | 'requires-second-confirmation' | 'requires-safe-mode-confirmation' | 'completed' | 'blocked';
  sideEffect: 'none' | 'local-commit';
  requestedAt: string;
  confirmedAt?: string;
  safeModeConfirmed?: boolean;
  safeMode?: {
    active: boolean;
    reason: string;
    matchedPaths: string[];
    requiresExternalControlSurface?: boolean;
  };
  browserVerification?: FeedbackRepairHumanVerification;
  message: string;
}

export interface FeedbackRepairResultRecord {
  schemaVersion: 1;
  id: string;
  issueId: string;
  repairRunId?: string;
  status?: FeedbackRepairStatus;
  verdict: 'fixed' | 'partially-fixed' | 'wont-fix' | 'needs-follow-up' | 'failed';
  summary: string;
  executorInstance?: FeedbackRepairExecutorInstance;
  targetInstance?: FeedbackRepairExecutorInstance;
  changedFiles: string[];
  diffRef?: string;
  commit?: string;
  refs?: { commitSha?: string; commitUrl?: string; prUrl?: string; patchRef?: string };
  terminalMirrorRef?: string;
  auditBundleRef?: string;
  planRef?: string;
  tests?: FeedbackRepairTestEvidence[];
  testResults?: FeedbackRepairTestEvidence[];
  humanVerification?: FeedbackRepairHumanVerification;
  githubSyncStatus?: 'skipped' | 'synced' | 'failed';
  githubSyncError?: string;
  githubSyncedAt?: string;
  githubCommentUrl?: string;
  evidenceRefs: string[];
  followUp?: string;
  completedAt: string;
  metadata?: Record<string, unknown>;
}

export interface FeedbackIssueHandoffBundle extends Omit<FeedbackIssueSummary, 'comment' | 'runtime'> {
  workspacePath: string;
  request?: FeedbackRequestRecord;
  comment: FeedbackCommentRecord;
  target: FeedbackTargetSnapshot;
  runtime: FeedbackRuntimeSnapshot;
  repairRuns: FeedbackRepairRunRecord[];
  repairResults: FeedbackRepairResultRecord[];
}

export interface RuntimeProviderPreflightManifest {
  schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1';
  checkedAt: string;
  releaseAcceptance: 'not-evaluated';
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  upstreamKeySourceKind: 'env' | 'config-debug-fallback' | 'missing';
  upstreamBaseUrlSourceKind: 'env' | 'config' | 'missing';
  category: 'ready' | 'config-secret-source' | 'missing-runtime-env' | 'missing-upstream' | 'provider-auth' | 'rate-limited' | 'upstream-outage' | 'repo-bug' | 'unknown';
  owner: 'environment' | 'provider' | 'repo';
  policyViolations: string[];
  missingEnv: string[];
  evidenceMode: 'current-env-diagnostic-only';
  checkedHealthz?: {
    category: string;
    ok: boolean;
    retryable: boolean;
    httpStatus?: number;
    releaseAcceptance: 'not-evaluated';
  };
  nextActions: Array<{
    label: string;
    command?: string;
    writesRepo: boolean;
  }>;
}

export interface RuntimeCodexBrowserAcceptanceManifest {
  schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1';
  status: 'blocked' | 'failed' | 'partial' | 'passed';
  source: 'codex-in-app-browser';
  observedAt?: string;
  actualUrl?: string;
  actualPort?: number;
  workspacePath?: string;
  provider?: string;
  model?: string;
  commandId?: string;
  startedFromDefaultChatEntry: boolean;
  submittedThroughRuntimeCodex: boolean;
  providerModelProfileVisible: boolean;
  mainAnswerVisible: boolean;
  rawAuditFoldedByDefault: boolean;
  acceptanceConclusionFromRealBrowser?: boolean;
  currentRunEvidenceScope?: 'preflight-only' | 'live-browser-current-run';
  reason?: string;
  blocker?: string;
  blockedOn?: string[];
  failureClass?: 'missing-runtime-env' | 'config-secret-source' | 'missing-upstream' | 'provider-unavailable' | 'runtime-bridge' | 'unknown';
  owner?: 'environment' | 'provider' | 'repo';
  policyViolations?: string[];
  missingEnv?: string[];
  expectedRetestCommand?: string;
  releaseBlocking?: boolean;
  releaseEligible?: boolean;
  providerPreflightRef?: string;
  providerPreflightCategory?: string;
  providerPreflightCheckedAt?: string;
  providerPreflightReleaseAcceptance?: 'not-evaluated';
  providerPreflightEvidenceMode?: 'current-env-diagnostic-only';
  runtimeApiKeyPresentInServiceEnv?: boolean;
  upstreamBaseUrlPresent?: boolean;
  upstreamKeySourceKind?: 'env' | 'config-debug-fallback' | 'missing';
  upstreamBaseUrlSourceKind?: 'env' | 'config' | 'missing';
  configPathsChecked?: string[];
  configSecretFallbackPaths?: string[];
  nextActions?: Array<{
    label: string;
    command?: string;
    expected?: string;
    writesRepo?: boolean;
  }>;
  evidence?: {
    screenshotPath?: string;
    domSnapshotPath?: string;
    notesPath?: string;
    runtimeAuditPath?: string;
  };
  freshness?: {
    checkedAt: string;
    observedAtFresh: boolean;
    evidenceFresh: boolean;
    staleEvidenceRefs: string[];
  };
}

export interface ReusableTaskCandidateRecord {
  id: string;
  runId: string;
  scenarioId: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  prompt: string;
  status: RunStatus;
  promotionState: 'candidate' | 'promoted' | 'rejected';
  createdAt: string;
}

export interface SciForgeConfig {
  schemaVersion: 1;
  agentServerBaseUrl: string;
  workspaceWriterBaseUrl: string;
  workspacePath: string;
  peerInstances?: PeerInstance[];
  /** `owner/repo` or full `https://github.com/owner/repo` — feedback inbox creates/syncs issues against this repo. */
  feedbackGithubRepo?: string;
  /** GitHub PAT with Issues read (sync) + write (create). Stored like API keys (local config only). */
  feedbackGithubToken?: string;
  feedbackGithubLabels?: string[];
  feedbackGithubAssignees?: string[];
  feedbackGithubMilestone?: number | string;
  feedbackGithubDryRun?: boolean;
  theme?: 'dark' | 'light';
  locale?: 'zh-CN' | 'en-US';
  agentBackend: string;
  runtimeProfile?: string;
  allowOpenAiRuntime?: boolean;
  modelProvider: string;
  modelBaseUrl: string;
  modelName: string;
  apiKey: string;
  requestTimeoutMs: number;
  maxContextWindowTokens: number;
  visionAllowSharedSystemInput: boolean;
  toolProviderRoutes?: Record<string, ToolProviderRouteOverride>;
  updatedAt: string;
}

export type PeerInstanceRole = 'main' | 'repair' | 'peer';
export type PeerInstanceTrustLevel = 'readonly' | 'repair' | 'sync';

export interface PeerInstance {
  name: string;
  appUrl: string;
  workspaceWriterUrl: string;
  workspacePath: string;
  role: PeerInstanceRole;
  trustLevel: PeerInstanceTrustLevel;
  enabled: boolean;
}

export interface TargetInstanceContext {
  mode: 'current' | 'peer';
  selectedAt: string;
  banner: string;
  peer?: Pick<PeerInstance, 'name' | 'appUrl' | 'workspaceWriterUrl' | 'workspacePath' | 'role' | 'trustLevel'>;
  issueLookup?: {
    trigger: 'feedback-id' | 'github-number' | 'issue-summaries';
    query: string;
    workspaceWriterUrl: string;
    workspacePath: string;
    summaries?: FeedbackIssueSummary[];
    bundle?: FeedbackIssueHandoffBundle;
    matchedIssueId?: string;
    githubIssueNumber?: number;
    status: 'resolved' | 'not-found' | 'failed';
    error?: string;
  };
}

export type ConversationTurnMode = 'normal' | 'annotation-plan-only' | 'annotation-quick-action';
export type RuntimeResumePolicy = 'same-conversation-lane' | 'explicit-reference-only' | 'none';

export interface SendAgentMessageInput {
  sessionId?: string;
  sessionCreatedAt?: string;
  sessionUpdatedAt?: string;
  currentTurnId?: string;
  scenarioId: ScenarioInstanceId;
  agentName: string;
  agentDomain: string;
  prompt: string;
  references?: SciForgeReference[];
  roleView: string;
  messages: SciForgeMessage[];
  artifacts?: RuntimeArtifact[];
  claims?: Array<Pick<EvidenceClaim, 'id' | 'text' | 'type' | 'confidence' | 'evidenceLevel'> & Partial<Pick<EvidenceClaim, 'supportingRefs' | 'opposingRefs' | 'updatedAt'>>>;
  executionUnits?: RuntimeExecutionUnit[];
  runs?: SciForgeRun[];
  config: SciForgeConfig;
  scenarioOverride?: ScenarioRuntimeOverride;
  availableComponentIds?: string[];
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  targetInstanceContext?: TargetInstanceContext;
  turnMode?: ConversationTurnMode;
  conversationEnvelope?: unknown;
  conversationLaneId?: string;
  runtimeResumePolicy?: RuntimeResumePolicy;
  verificationResult?: Record<string, unknown>;
  recentVerificationResults?: Array<Record<string, unknown>>;
}

export interface ScenarioRuntimeOverride {
  title: string;
  description: string;
  skillDomain: SkillDomain;
  scenarioMarkdown: string;
  defaultComponents: string[];
  allowedComponents: string[];
  fallbackComponent: string;
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
  selectedSenseIds?: string[];
  selectedActionIds?: string[];
  selectedVerifierIds?: string[];
  toolProviderRoutes?: Record<string, ToolProviderRouteOverride>;
  turnExecutionConstraints?: Record<string, unknown>;
  artifactPolicy?: Record<string, unknown>;
  referencePolicy?: Record<string, unknown>;
  failureRecoveryPolicy?: Record<string, unknown>;
  verificationPolicy?: Record<string, unknown>;
  humanApprovalPolicy?: Record<string, unknown>;
  completionEvidencePolicy?: Record<string, unknown>;
  unverifiedReason?: string;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  computerUseLong?: Record<string, unknown>;
  computerUseNext?: Record<string, unknown>;
}

export type ToolProviderSource = 'local' | 'agentserver' | 'mcp' | 'http' | 'ssh' | 'client-worker' | 'backend-native' | 'package' | 'workspace' | 'external';

export interface ToolProviderRouteOverride {
  enabled?: boolean;
  capabilityId?: string;
  source?: ToolProviderSource;
  primaryProviderId?: string;
  fallbackProviderIds?: string[];
  permissions?: string[];
  requiredConfig?: string[];
  health?: 'ready' | 'unknown' | 'unavailable' | 'unauthorized' | 'rate-limited';
  endpoint?: string;
  baseUrl?: string;
  url?: string;
  invokeUrl?: string;
  invokePath?: string;
  timeoutMs?: number;
}

export interface NormalizedAgentResponse {
  message: SciForgeMessage;
  run: SciForgeRun;
  uiManifest: UIManifestSlot[];
  claims: EvidenceClaim[];
  executionUnits: RuntimeExecutionUnit[];
  artifacts: RuntimeArtifact[];
  notebook: NotebookRecord[];
}

export type AgentBackendId = RuntimeAgentBackend;

export interface AgentServerRunPayload {
  agent: {
    id: string;
    name: string;
    backend: AgentBackendId;
    workspace: string;
    workingDirectory?: string;
    systemPrompt: string;
    reconcileExisting: boolean;
    metadata: Record<string, unknown>;
  };
  input: {
    text: string;
    metadata: Record<string, unknown>;
  };
  runtime?: {
    backend?: AgentBackendId;
    cwd?: string;
    modelProvider?: string;
    modelName?: string;
    llmEndpoint?: {
      provider: string;
      baseUrl?: string;
      apiKey?: string;
      modelName?: string;
    };
    metadata?: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
