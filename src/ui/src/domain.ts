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
  updatedAt: string;
  authorLogin?: string;
  labels: string[];
  syncedAt: string;
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
  path: string;
  text: string;
  tagName: string;
  role?: string;
  ariaLabel?: string;
  rect: { x: number; y: number; width: number; height: number };
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
  dataUrl: string;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  capturedAt: string;
  targetRect: { x: number; y: number; width: number; height: number };
  includeForAgent?: boolean;
  note?: string;
}

export interface FeedbackCommentRecord {
  id: string;
  schemaVersion: 1;
  authorId: string;
  authorName: string;
  comment: string;
  status: FeedbackCommentStatus;
  priority: FeedbackPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  requestId?: string;
  target: FeedbackTargetSnapshot;
  viewport: { width: number; height: number; devicePixelRatio: number; scrollX: number; scrollY: number };
  runtime: FeedbackRuntimeSnapshot;
  screenshotRef?: string;
  screenshot?: FeedbackScreenshotEvidence;
  githubIssueUrl?: string;
  githubIssueNumber?: number;
}

export interface FeedbackRequestRecord {
  id: string;
  schemaVersion: 1;
  title: string;
  status: 'draft' | 'ready' | 'in-progress' | 'fixed' | 'closed';
  feedbackIds: string[];
  summary: string;
  acceptanceCriteria: string[];
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
  metadata?: Record<string, unknown>;
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
  theme?: 'dark' | 'light';
  agentBackend: string;
  modelProvider: string;
  modelBaseUrl: string;
  modelName: string;
  apiKey: string;
  requestTimeoutMs: number;
  maxContextWindowTokens: number;
  visionAllowSharedSystemInput: boolean;
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

export interface SendAgentMessageInput {
  sessionId?: string;
  sessionCreatedAt?: string;
  sessionUpdatedAt?: string;
  scenarioId: ScenarioInstanceId;
  agentName: string;
  agentDomain: string;
  prompt: string;
  references?: SciForgeReference[];
  roleView: string;
  messages: SciForgeMessage[];
  artifacts?: RuntimeArtifact[];
  executionUnits?: RuntimeExecutionUnit[];
  runs?: SciForgeRun[];
  config: SciForgeConfig;
  scenarioOverride?: ScenarioRuntimeOverride;
  availableComponentIds?: string[];
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  targetInstanceContext?: TargetInstanceContext;
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
  turnExecutionConstraints?: Record<string, unknown>;
  artifactPolicy?: Record<string, unknown>;
  referencePolicy?: Record<string, unknown>;
  failureRecoveryPolicy?: Record<string, unknown>;
  verificationPolicy?: Record<string, unknown>;
  humanApprovalPolicy?: Record<string, unknown>;
  unverifiedReason?: string;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
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
