import type { ClaimType, EvidenceLevel, ScenarioId } from './data';

export type BuiltInScenarioId = ScenarioId;
export type ScenarioInstanceId = ScenarioId | (string & {});

export type MessageRole = 'user' | 'scenario' | 'system';
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed';
export type ExecutionUnitStatus = 'planned' | 'running' | 'done' | 'failed' | 'record-only' | 'repair-needed' | 'self-healed' | 'failed-with-reason' | 'needs-human';
export type ObjectReferenceKind = 'artifact' | 'file' | 'folder' | 'run' | 'execution-unit' | 'url' | 'scenario-package';
export type ObjectReferenceStatus = 'available' | 'missing' | 'expired' | 'blocked' | 'external';
export type ObjectAction = 'focus-right-pane' | 'inspect' | 'open-external' | 'reveal-in-folder' | 'copy-path' | 'pin' | 'compare';
export type SciForgeReferenceKind = 'file' | 'file-region' | 'message' | 'task-result' | 'chart' | 'table' | 'table-range' | 'structure-selection' | 'ui';
export type PreviewDescriptorKind = 'pdf' | 'image' | 'markdown' | 'text' | 'json' | 'table' | 'html' | 'structure' | 'office' | 'folder' | 'binary';
export type PreviewDescriptorSource = 'path' | 'dataRef' | 'artifact' | 'url';
export type PreviewInlinePolicy = 'inline' | 'stream' | 'thumbnail' | 'extract' | 'external' | 'unsupported';
export type PreviewDerivativeKind = 'text' | 'thumb' | 'pages' | 'schema' | 'html' | 'structure-bundle' | 'metadata';
export type ArtifactPreviewAction = 'open-inline' | 'system-open' | 'copy-ref' | 'extract-text' | 'make-thumbnail' | 'select-region' | 'select-page' | 'select-rows' | 'inspect-metadata';

export interface PreviewDerivative {
  kind: PreviewDerivativeKind;
  ref: string;
  mimeType?: string;
  sizeBytes?: number;
  hash?: string;
  generatedAt?: string;
  status?: 'available' | 'lazy' | 'failed' | 'unsupported';
  diagnostics?: string[];
}

export interface PreviewDescriptor {
  kind: PreviewDescriptorKind;
  source: PreviewDescriptorSource;
  ref: string;
  mimeType?: string;
  sizeBytes?: number;
  hash?: string;
  title?: string;
  rawUrl?: string;
  inlinePolicy: PreviewInlinePolicy;
  derivatives?: PreviewDerivative[];
  actions: ArtifactPreviewAction[];
  diagnostics?: string[];
  locatorHints?: Array<'page' | 'region' | 'row-range' | 'column-range' | 'structure-selection' | 'text-range'>;
}

export interface SciForgeReference {
  id: string;
  kind: SciForgeReferenceKind;
  title: string;
  ref: string;
  summary?: string;
  sourceId?: string;
  runId?: string;
  locator?: {
    page?: number;
    sheet?: string;
    rowRange?: string;
    columnRange?: string;
    textRange?: string;
    region?: string;
  };
  payload?: unknown;
}

export interface ObjectReference {
  id: string;
  title: string;
  kind: ObjectReferenceKind;
  ref: string;
  artifactType?: string;
  runId?: string;
  executionUnitId?: string;
  preferredView?: string;
  actions?: ObjectAction[];
  status?: ObjectReferenceStatus;
  summary?: string;
  provenance?: {
    dataRef?: string;
    path?: string;
    producer?: string;
    version?: string;
    hash?: string;
    size?: number;
    screenshotRef?: string;
  };
}

export interface ObjectResolution {
  reference: ObjectReference;
  status: 'resolved' | 'missing' | 'blocked';
  artifact?: RuntimeArtifact;
  path?: string;
  reason?: string;
  actions: ObjectAction[];
}

export type UserGoalType = 'answer' | 'report' | 'analysis' | 'visualization' | 'file' | 'repair' | 'continuation' | 'workflow';
export type TurnAcceptanceSeverity = 'pass' | 'warning' | 'repairable' | 'failed';

export interface UserGoalSnapshot {
  turnId: string;
  rawPrompt: string;
  goalType: UserGoalType;
  requiredFormats: string[];
  requiredArtifacts: string[];
  requiredReferences: string[];
  freshness?: {
    kind: 'today' | 'latest' | 'current-session' | 'prior-run';
    date?: string;
  };
  uiExpectations: string[];
  acceptanceCriteria: string[];
}

export interface TurnAcceptanceFailure {
  code: string;
  detail: string;
  repairAction?: string;
}

export interface SemanticTurnAcceptance {
  pass: boolean;
  confidence: number;
  unmetCriteria: string[];
  missingArtifacts: string[];
  referencedEvidence: string[];
  repairPrompt?: string;
  backendRunRef?: string;
}

export interface TurnAcceptance {
  pass: boolean;
  severity: TurnAcceptanceSeverity;
  checkedAt: string;
  failures: TurnAcceptanceFailure[];
  objectReferences: ObjectReference[];
  repairPrompt?: string;
  repairAttempt?: number;
  semantic?: SemanticTurnAcceptance;
  repairHistory?: Array<{
    attempt: number;
    action: string;
    status: 'started' | 'completed' | 'failed-with-reason' | 'skipped-budget-exhausted';
    startedAt: string;
    completedAt?: string;
    sourceRunId?: string;
    repairRunId?: string;
    failureCodes: string[];
    reason?: string;
  }>;
}

export interface SciForgeMessage {
  id: string;
  role: MessageRole;
  content: string;
  confidence?: number;
  evidence?: EvidenceLevel;
  claimType?: ClaimType;
  expandable?: string;
  createdAt: string;
  updatedAt?: string;
  status?: RunStatus;
  tokenUsage?: AgentTokenUsage;
  references?: SciForgeReference[];
  objectReferences?: ObjectReference[];
  goalSnapshot?: UserGoalSnapshot;
  acceptance?: TurnAcceptance;
}

export interface SessionVersionRecord {
  id: string;
  reason: string;
  createdAt: string;
  messageCount: number;
  runCount: number;
  artifactCount: number;
  checksum: string;
  snapshot: Omit<SciForgeSession, 'versions'>;
}

export interface EvidenceClaim {
  id: string;
  text: string;
  type: ClaimType;
  confidence: number;
  evidenceLevel: EvidenceLevel;
  supportingRefs: string[];
  opposingRefs: string[];
  dependencyRefs?: string[];
  updateReason?: string;
  updatedAt: string;
}

export type BeliefNodeKind = 'claim' | 'evidence' | 'artifact' | 'assumption' | 'decision';
export type BeliefEdgeKind = 'supports' | 'opposes' | 'depends-on' | 'derived-from' | 'supersedes';

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

export type ResearcherDecisionStatus = 'supported' | 'not-supported' | 'inconclusive' | 'needs-repeat';
export type DecisionRevisionStatus = 'original' | 'supersede' | 'retract' | 'amend' | 'reaffirm';

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

export type TimelineVisibility = 'private-draft' | 'team-visible' | 'project-record' | 'restricted-sensitive';
export type TimelineVariantKind = 'parameter' | 'method' | 'hypothesis';
export type TimelineDecisionStatus = ResearcherDecisionStatus | 'not-a-decision';

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

export interface UIManifestSlot {
  componentId: string;
  title?: string;
  props?: Record<string, unknown>;
  artifactRef?: string;
  priority?: number;
  encoding?: ViewEncoding;
  layout?: ViewLayout;
  selection?: ViewSelection;
  sync?: ViewSync;
  transform?: ViewTransform[];
  compare?: ViewCompare;
}

export interface ViewEncoding {
  colorBy?: string;
  splitBy?: string;
  overlayBy?: string;
  facetBy?: string;
  compareWith?: string | string[];
  highlightSelection?: string | string[];
  syncViewport?: boolean;
  x?: string;
  y?: string;
  label?: string;
}

export interface ViewLayout {
  mode?: 'single' | 'side-by-side' | 'stacked' | 'grid' | 'faceted';
  columns?: number;
  height?: number;
}

export interface ViewSelection {
  id?: string;
  field?: string;
  values?: string[];
}

export interface ViewSync {
  selectionIds?: string[];
  viewportIds?: string[];
}

export interface ViewTransform {
  type: 'filter' | 'sort' | 'limit' | 'group' | 'derive';
  field?: string;
  op?: string;
  value?: unknown;
}

export interface ViewCompare {
  artifactRefs?: string[];
  mode?: 'overlay' | 'side-by-side' | 'diff';
}

export type UIModuleLifecycle = 'draft' | 'validated' | 'published' | 'deprecated';
export type ViewPlanSection = 'primary' | 'supporting' | 'provenance' | 'raw';

export interface UIModuleManifest {
  moduleId: string;
  version: string;
  title: string;
  componentId: string;
  lifecycle: UIModuleLifecycle;
  acceptsArtifactTypes: string[];
  requiredFields?: string[];
  requiredAnyFields?: string[][];
  viewParams?: string[];
  interactionEvents?: string[];
  roleDefaults?: string[];
  fallbackModuleIds?: string[];
  defaultSection?: ViewPlanSection;
  priority?: number;
  safety?: {
    sandbox?: boolean;
    externalResources?: 'none' | 'declared-only' | 'allowed';
    executesCode?: boolean;
  };
}

export interface ViewPreset {
  presetId: string;
  moduleId: string;
  version: string;
  title: string;
  slot: UIManifestSlot;
  lifecycle: UIModuleLifecycle;
}

export interface DisplayIntent {
  primaryGoal: string;
  requiredArtifactTypes?: string[];
  preferredModules?: string[];
  fallbackAcceptable?: string[];
  layoutPreference?: ViewLayout;
  acceptanceCriteria?: string[];
  source?: 'agentserver' | 'runtime-artifact' | 'ui-design-studio' | 'fallback-inference';
}

export interface ResolvedViewPlan {
  displayIntent: DisplayIntent;
  sections: Record<ViewPlanSection, UIManifestSlot[]>;
  diagnostics: string[];
  blockedDesign?: {
    reason: string;
    requiredModuleCapability: string;
    resumeRunId?: string;
  };
}

export interface RuntimeArtifact {
  id: string;
  type: string;
  producerScenario: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  schemaVersion: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  dataRef?: string;
  path?: string;
  previewDescriptor?: PreviewDescriptor;
  visibility?: TimelineVisibility;
  audience?: string[];
  sensitiveDataFlags?: string[];
  exportPolicy?: CollaborationPolicy['exportPolicy'];
}

export interface RuntimeExecutionUnit {
  id: string;
  tool: string;
  params: string;
  status: ExecutionUnitStatus;
  hash: string;
  code?: string;
  language?: string;
  codeRef?: string;
  entrypoint?: string;
  stdoutRef?: string;
  stderrRef?: string;
  outputRef?: string;
  attempt?: number;
  parentAttempt?: number;
  selfHealReason?: string;
  patchSummary?: string;
  diffRef?: string;
  failureReason?: string;
  seed?: number;
  time?: string;
  environment?: string;
  inputData?: string[];
  dataFingerprint?: string;
  databaseVersions?: string[];
  artifacts?: string[];
  outputArtifacts?: string[];
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  runtimeProfileId?: string;
  routeDecision?: {
    selectedSkill?: string;
    selectedRuntime?: string;
    fallbackReason?: string;
    selectedAt: string;
  };
  requiredInputs?: string[];
  recoverActions?: string[];
  nextStep?: string;
  verificationRef?: string;
  verificationVerdict?: 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';
}

export interface NotebookRecord {
  id: string;
  time: string;
  scenario: ScenarioInstanceId;
  title: string;
  desc: string;
  claimType: ClaimType;
  confidence: number;
  artifactRefs?: string[];
  executionUnitRefs?: string[];
  beliefRefs?: string[];
  dependencyRefs?: string[];
  updateReason?: string;
}

export interface SciForgeRun {
  id: string;
  scenarioId: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  status: RunStatus;
  prompt: string;
  response: string;
  createdAt: string;
  completedAt?: string;
  raw?: unknown;
  references?: SciForgeReference[];
  objectReferences?: ObjectReference[];
  goalSnapshot?: UserGoalSnapshot;
  acceptance?: TurnAcceptance;
}

export interface SciForgeSession {
  schemaVersion: 2;
  sessionId: string;
  scenarioId: ScenarioInstanceId;
  title: string;
  createdAt: string;
  messages: SciForgeMessage[];
  runs: SciForgeRun[];
  uiManifest: UIManifestSlot[];
  claims: EvidenceClaim[];
  executionUnits: RuntimeExecutionUnit[];
  artifacts: RuntimeArtifact[];
  notebook: NotebookRecord[];
  versions: SessionVersionRecord[];
  /** Resolved view-plan item ids hidden in the results pane only; artifacts/workspace files are untouched. */
  hiddenResultSlotIds?: string[];
  updatedAt: string;
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

export type FeedbackCommentStatus = 'open' | 'triaged' | 'planned' | 'fixed' | 'needs-discussion' | 'wont-fix';
export type FeedbackPriority = 'low' | 'normal' | 'high' | 'urgent';

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

export interface AlignmentContractRecord {
  id: string;
  type: 'alignment-contract';
  schemaVersion: '1';
  title: string;
  createdAt: string;
  updatedAt: string;
  reason: string;
  checksum: string;
  sourceRefs: string[];
  assumptionRefs: string[];
  decisionAuthority: string;
  confirmationStatus: 'draft' | 'user-confirmed' | 'needs-data';
  confirmedBy?: string;
  confirmedAt?: string;
  sourceContractVersion?: string;
  data: {
    dataReality: string;
    aiAssessment: string;
    bioReality: string;
    feasibilityMatrix: string;
    researchGoal: string;
    technicalRoute: string;
    successCriteria: string;
    knownRisks: string;
    recalibrationRecord: string;
    dataAssetsChecklist: string;
    sampleSizeChecklist: string;
    labelQualityChecklist: string;
    batchEffectChecklist: string;
    experimentalConstraints: string;
    feasibilitySourceNotes: string;
  };
}

export interface SciForgeConfig {
  schemaVersion: 1;
  agentServerBaseUrl: string;
  workspaceWriterBaseUrl: string;
  workspacePath: string;
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

export interface SendAgentMessageInput {
  sessionId?: string;
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
  verificationResult?: Record<string, unknown>;
  recentVerificationResults?: Array<Record<string, unknown>>;
}

export interface ScenarioPackageRef {
  id: string;
  version: string;
  source: 'built-in' | 'workspace' | 'generated';
}

export interface ScenarioRuntimeOverride {
  title: string;
  description: string;
  skillDomain: 'literature' | 'structure' | 'omics' | 'knowledge';
  scenarioMarkdown: string;
  defaultComponents: string[];
  allowedComponents: string[];
  fallbackComponent: string;
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
  selectedSenseIds?: string[];
  selectedActionIds?: string[];
  selectedVerifierIds?: string[];
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

export interface AgentStreamEvent {
  id: string;
  type: string;
  label: string;
  detail?: string;
  usage?: AgentTokenUsage;
  contextWindowState?: AgentContextWindowState;
  contextCompaction?: AgentContextCompaction;
  createdAt: string;
  raw?: unknown;
}

export type AgentContextWindowSource = 'native' | 'provider-usage' | 'agentserver-estimate' | 'agentserver' | 'estimate' | 'unknown';
export type AgentCompactCapability = 'native' | 'agentserver' | 'handoff-only' | 'handoff-slimming' | 'session-rotate' | 'none' | 'unknown';

export interface AgentContextWindowState {
  backend?: string;
  provider?: string;
  model?: string;
  usedTokens?: number;
  input?: number;
  output?: number;
  cache?: number;
  window?: number;
  windowTokens?: number;
  ratio?: number;
  source: AgentContextWindowSource;
  status?: 'healthy' | 'watch' | 'near-limit' | 'exceeded' | 'compacting' | 'blocked' | 'unknown';
  compactCapability?: AgentCompactCapability;
  budget?: {
    rawRef?: string;
    rawSha1?: string;
    rawBytes?: number;
    normalizedBytes?: number;
    maxPayloadBytes?: number;
    rawTokens?: number;
    normalizedTokens?: number;
    savedTokens?: number;
    normalizedBudgetRatio?: number;
    decisions?: Array<Record<string, unknown>>;
  };
  auditRefs?: string[];
  autoCompactThreshold?: number;
  watchThreshold?: number;
  nearLimitThreshold?: number;
  lastCompactedAt?: string;
  pendingCompact?: boolean;
}

export interface AgentContextCompaction {
  status: 'started' | 'completed' | 'failed' | 'pending' | 'skipped';
  source?: AgentContextWindowSource;
  backend?: string;
  compactCapability?: AgentCompactCapability;
  before?: AgentContextWindowState;
  after?: AgentContextWindowState;
  auditRefs?: string[];
  startedAt?: string;
  completedAt?: string;
  lastCompactedAt?: string;
  reason?: string;
  message?: string;
}

export interface AgentTokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  provider?: string;
  model?: string;
  source?: string;
}

export type AgentBackendId = 'codex' | 'openteam_agent' | 'claude-code' | 'hermes-agent' | 'openclaw' | 'gemini';

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
