import type { ClaimType, EvidenceLevel, ScenarioId } from './data';

export type BuiltInScenarioId = ScenarioId;
export type ScenarioInstanceId = ScenarioId | (string & {});

export type MessageRole = 'user' | 'scenario' | 'system';
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed';
export type ExecutionUnitStatus = 'planned' | 'running' | 'done' | 'failed' | 'record-only' | 'repair-needed' | 'self-healed' | 'failed-with-reason';

export interface BioAgentMessage {
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
}

export interface SessionVersionRecord {
  id: string;
  reason: string;
  createdAt: string;
  messageCount: number;
  runCount: number;
  artifactCount: number;
  checksum: string;
  snapshot: Omit<BioAgentSession, 'versions'>;
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

export interface RuntimeArtifact {
  id: string;
  type: string;
  producerScenario: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  schemaVersion: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  dataRef?: string;
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

export interface BioAgentRun {
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
}

export interface BioAgentSession {
  schemaVersion: 2;
  sessionId: string;
  scenarioId: ScenarioInstanceId;
  title: string;
  createdAt: string;
  messages: BioAgentMessage[];
  runs: BioAgentRun[];
  uiManifest: UIManifestSlot[];
  claims: EvidenceClaim[];
  executionUnits: RuntimeExecutionUnit[];
  artifacts: RuntimeArtifact[];
  notebook: NotebookRecord[];
  versions: SessionVersionRecord[];
  updatedAt: string;
}

export interface BioAgentWorkspaceState {
  schemaVersion: 2;
  workspacePath: string;
  sessionsByScenario: Record<ScenarioInstanceId, BioAgentSession>;
  archivedSessions: BioAgentSession[];
  alignmentContracts: AlignmentContractRecord[];
  beliefGraphs?: BeliefDependencyGraph[];
  timelineEvents?: TimelineEventRecord[];
  reusableTaskCandidates?: ReusableTaskCandidateRecord[];
  hiddenOfficialPackageIds?: string[];
  branches?: ResearchBranchRecord[];
  researcherDecisions?: ResearcherDecisionRecord[];
  collaborationPolicy?: CollaborationPolicy;
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

export interface BioAgentConfig {
  schemaVersion: 1;
  agentServerBaseUrl: string;
  workspaceWriterBaseUrl: string;
  workspacePath: string;
  modelProvider: string;
  modelBaseUrl: string;
  modelName: string;
  apiKey: string;
  requestTimeoutMs: number;
  updatedAt: string;
}

export interface SendAgentMessageInput {
  scenarioId: ScenarioInstanceId;
  agentName: string;
  agentDomain: string;
  prompt: string;
  roleView: string;
  messages: BioAgentMessage[];
  artifacts?: RuntimeArtifact[];
  config: BioAgentConfig;
  scenarioOverride?: ScenarioRuntimeOverride;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
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
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
}

export interface NormalizedAgentResponse {
  message: BioAgentMessage;
  run: BioAgentRun;
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
  createdAt: string;
  raw?: unknown;
}

export interface AgentServerRunPayload {
  agent: {
    id: string;
    name: string;
    backend: 'codex';
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
    backend?: 'codex';
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
