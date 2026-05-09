import type { SciForgeAgentHandoffSource, SharedAgentHandoffContract } from '../shared/agentHandoff.js';
import type { WorkEvidence } from './gateway/work-evidence-types.js';

export type SciForgeSkillDomain = 'literature' | 'structure' | 'omics' | 'knowledge';

export type ExecutionUnitStatus =
  | 'planned'
  | 'running'
  | 'done'
  | 'failed'
  | 'record-only'
  | 'repair-needed'
  | 'self-healed'
  | 'failed-with-reason'
  | 'needs-human';

export type VerificationVerdict = 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';
export type VerificationMode = 'none' | 'lightweight' | 'automatic' | 'human' | 'hybrid' | 'unverified';
export type VerificationRiskLevel = 'low' | 'medium' | 'high';

export interface VerificationPolicy {
  required: boolean;
  mode: VerificationMode;
  riskLevel: VerificationRiskLevel;
  reason: string;
  selectedVerifierIds?: string[];
  humanApprovalPolicy?: 'none' | 'optional' | 'required';
  unverifiedReason?: string;
}

export interface VerificationResult {
  id?: string;
  verdict: VerificationVerdict;
  reward?: number;
  confidence: number;
  critique?: string;
  evidenceRefs: string[];
  repairHints: string[];
  diagnostics?: Record<string, unknown>;
}

export interface GatewayRequest {
  skillDomain: SciForgeSkillDomain;
  prompt: string;
  handoffSource?: SciForgeAgentHandoffSource;
  sharedAgentContract?: SharedAgentHandoffContract;
  workspacePath?: string;
  agentServerBaseUrl?: string;
  agentBackend?: string;
  modelProvider?: string;
  modelName?: string;
  maxContextWindowTokens?: number;
  llmEndpoint?: LlmEndpointConfig;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  artifacts: Array<Record<string, unknown>>;
  references?: Array<Record<string, unknown>>;
  uiState?: Record<string, unknown>;
  availableSkills?: string[];
  selectedToolIds?: string[];
  selectedSenseIds?: string[];
  selectedActionIds?: string[];
  expectedArtifactTypes?: string[];
  selectedComponentIds?: string[];
  selectedVerifierIds?: string[];
  riskLevel?: VerificationRiskLevel;
  actionSideEffects?: string[];
  userExplicitVerification?: VerificationMode;
  verificationPolicy?: VerificationPolicy;
  artifactPolicy?: Record<string, unknown>;
  referencePolicy?: Record<string, unknown>;
  failureRecoveryPolicy?: Record<string, unknown>;
  humanApprovalPolicy?: Record<string, unknown>;
  humanApproval?: Record<string, unknown>;
  unverifiedReason?: string;
  verificationResult?: VerificationResult | Record<string, unknown>;
  recentVerificationResults?: Array<VerificationResult | Record<string, unknown>>;
}

export interface WorkspaceRuntimeEvent {
  type: string;
  message?: string;
  detail?: string;
  status?: string;
  source?: string;
  toolName?: string;
  text?: string;
  output?: string;
  usage?: WorkspaceRuntimeTokenUsage;
  contextWindowState?: WorkspaceRuntimeContextWindowState;
  contextCompaction?: WorkspaceRuntimeContextCompaction;
  rateLimit?: WorkspaceRuntimeRateLimit;
  workEvidence?: WorkEvidence[];
  raw?: unknown;
}

export type WorkspaceRuntimeContextWindowSource = 'native' | 'provider-usage' | 'agentserver-estimate' | 'agentserver' | 'estimate' | 'unknown';

export interface WorkspaceRuntimeContextWindowState {
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
  source: WorkspaceRuntimeContextWindowSource;
  status?: 'healthy' | 'watch' | 'near-limit' | 'exceeded' | 'compacting' | 'blocked' | 'unknown';
  compactCapability?: 'native' | 'agentserver' | 'handoff-only' | 'handoff-slimming' | 'session-rotate' | 'none' | 'unknown';
  budget?: WorkspaceRuntimeContextBudget;
  auditRefs?: string[];
  autoCompactThreshold?: number;
  watchThreshold?: number;
  nearLimitThreshold?: number;
  lastCompactedAt?: string;
  pendingCompact?: boolean;
}

export interface WorkspaceRuntimeContextBudget {
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
}

export interface WorkspaceRuntimeContextCompaction {
  status: 'started' | 'completed' | 'failed' | 'pending' | 'skipped';
  source?: WorkspaceRuntimeContextWindowSource;
  backend?: string;
  compactCapability?: WorkspaceRuntimeContextWindowState['compactCapability'];
  before?: WorkspaceRuntimeContextWindowState;
  after?: WorkspaceRuntimeContextWindowState;
  auditRefs?: string[];
  startedAt?: string;
  completedAt?: string;
  lastCompactedAt?: string;
  reason?: string;
  message?: string;
}

export interface WorkspaceRuntimeRateLimit {
  limited?: boolean;
  retryAfterMs?: number;
  resetAt?: string;
  provider?: string;
  model?: string;
  backend?: string;
  source?: string;
}

export interface WorkspaceRuntimeTokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  provider?: string;
  model?: string;
  source?: string;
}

export interface WorkspaceRuntimeCallbacks {
  onEvent?: (event: WorkspaceRuntimeEvent) => void;
  signal?: AbortSignal;
}

export interface LlmEndpointConfig {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
}

export interface ScenarioPackageRef {
  id: string;
  version: string;
  source: 'built-in' | 'workspace' | 'generated';
}

export interface ToolPayload {
  message: string;
  confidence: number;
  claimType: string;
  evidenceLevel: string;
  reasoningTrace: string;
  claims: Array<Record<string, unknown>>;
  uiManifest: Array<Record<string, unknown>>;
  executionUnits: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  logs?: Array<Record<string, unknown>>;
  displayIntent?: Record<string, unknown>;
  objectReferences?: Array<Record<string, unknown>>;
  verificationResults?: VerificationResult[];
  verificationPolicy?: VerificationPolicy;
  workEvidence?: WorkEvidence[];
}

export interface WorkspaceTaskSpec {
  id: string;
  language: 'python' | 'r' | 'shell' | 'cli';
  entrypoint: string;
  entrypointArgs?: string[];
  codeTemplatePath?: string;
  input: Record<string, unknown>;
  outputRel: string;
  stdoutRel: string;
  stderrRel: string;
  taskRel?: string;
  timeoutMs?: number;
  inputArgMode?: 'json-file' | 'empty-data-path';
  retentionProtectedInputRels?: string[];
}

export interface WorkspaceTaskRunResult {
  spec: Required<Pick<WorkspaceTaskSpec, 'taskRel'>> & WorkspaceTaskSpec;
  workspace: string;
  command: string;
  args: string[];
  exitCode: number;
  stdoutRef: string;
  stderrRef: string;
  outputRef: string;
  stdout: string;
  stderr: string;
  runtimeFingerprint: Record<string, unknown>;
}

export interface SkillManifest {
  id: string;
  kind: 'package' | 'workspace' | 'installed';
  description: string;
  skillDomains: SciForgeSkillDomain[];
  inputContract: Record<string, unknown>;
  outputArtifactSchema: Record<string, unknown>;
  entrypoint: {
    type: 'workspace-task' | 'inspector' | 'agentserver-generation' | 'markdown-skill';
    command?: string;
    path?: string;
  };
  environment: Record<string, unknown>;
  validationSmoke: Record<string, unknown>;
  examplePrompts: string[];
  promotionHistory: Array<Record<string, unknown>>;
  scopeDeclaration?: Record<string, unknown>;
}

export interface SkillAvailability {
  id: string;
  kind: SkillManifest['kind'];
  available: boolean;
  reason: string;
  checkedAt: string;
  manifestPath: string;
  manifest: SkillManifest;
}

export interface AgentBackendCapabilities {
  contextWindowTelemetry: boolean;
  nativeCompaction: boolean;
  compactionDuringTurn: boolean;
  rateLimitTelemetry: boolean;
  sessionRotationSafe: boolean;
}

export interface BackendContextWindowState {
  backend: string;
  agentId: string;
  provider?: string;
  model?: string;
  usedTokens?: number;
  input?: number;
  output?: number;
  cache?: number;
  window?: number;
  ratio?: number;
  source: 'native' | 'provider-usage' | 'agentserver-estimate' | 'unknown';
  status: 'healthy' | 'watch' | 'near-limit' | 'exceeded' | 'unknown';
  contextWindowTokens?: number;
  contextWindowLimit?: number;
  contextWindowRatio?: number;
  autoCompactThreshold?: number;
  lastCompactedAt?: string;
  rateLimit?: {
    limited?: boolean;
    retryAfterMs?: number;
    resetAt?: string;
  };
  compactCapability: 'native' | 'agentserver' | 'handoff-only' | 'session-rotate' | 'none';
  budget?: WorkspaceRuntimeContextBudget;
  auditRefs?: string[];
  snapshot?: Record<string, unknown>;
}

export interface BackendContextCompactionResult {
  ok: boolean;
  status?: 'compacted' | 'skipped' | 'failed' | 'unsupported';
  backend: string;
  agentId: string;
  strategy: 'native' | 'agentserver' | 'handoff-slimming' | 'session-rotate' | 'none';
  reason: string;
  before?: BackendContextWindowState;
  after?: BackendContextWindowState;
  message?: string;
  runId?: string;
  auditRefs?: string[];
}

export interface AgentBackendAdapter {
  backend: string;
  capabilities: AgentBackendCapabilities;
  readContextWindowState?: (sessionRef: { agentId: string; workspace: string; baseUrl: string }) => Promise<BackendContextWindowState | undefined>;
  compactContext?: (
    sessionRef: { agentId: string; workspace: string; baseUrl: string },
    reason: string,
  ) => Promise<BackendContextCompactionResult>;
}

export interface SkillPromotionProposal {
  id: string;
  status: 'draft' | 'needs-user-confirmation' | 'accepted' | 'rejected' | 'archived';
  createdAt: string;
  statusUpdatedAt?: string;
  statusReason?: string;
  source: {
    workspacePath: string;
    taskCodeRef: string;
    inputRef?: string;
    outputRef?: string;
    stdoutRef?: string;
    stderrRef?: string;
    successfulExecutionUnitRefs: string[];
  };
  proposedManifest: SkillManifest;
  generalizationNotes: string[];
  validationPlan: {
    smokePrompts: string[];
    expectedArtifactTypes: string[];
    requiredEnvironment: Record<string, unknown>;
    rerunAfterAccept?: {
      mode: 'registry-discovered-workspace-task';
      expectedStatus: 'done';
    };
  };
  securityGate?: {
    passed: boolean;
    checks: {
      noHardCodedAbsolutePaths: boolean;
      noCredentialLikeText: boolean;
      noPrivateFileReferences: boolean;
      reproducibleDependencies: boolean;
    };
    findings: string[];
  };
  reviewChecklist: {
    noHardCodedUserData: boolean;
    noHardCodedAbsolutePaths?: boolean;
    noCredentialLikeText?: boolean;
    noPrivateFileReferences?: boolean;
    reproducibleDependencies?: boolean;
    reproducibleEntrypoint: boolean;
    artifactSchemaValidated: boolean;
    failureModeIsExplicit: boolean;
    userConfirmedPromotion: boolean;
  };
}

export interface AgentServerGenerationRequest {
  prompt: string;
  skillDomain: SciForgeSkillDomain;
  contextEnvelope?: Record<string, unknown>;
  workspaceTreeSummary: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
  availableSkills: Array<Pick<SkillAvailability, 'id' | 'kind' | 'available' | 'reason' | 'manifestPath'> & {
    description?: string;
    entrypointType?: SkillManifest['entrypoint']['type'];
    scopeDeclaration?: Record<string, unknown>;
  }>;
  availableTools?: Array<Record<string, unknown>>;
  availableRuntimeCapabilities?: Record<string, unknown>;
  artifactSchema: Record<string, unknown>;
  uiManifestContract: Record<string, unknown>;
  uiStateSummary?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  recentExecutionRefs?: Array<Record<string, unknown>>;
  priorAttempts: TaskAttemptRecord[];
}

export interface AgentServerGenerationResponse {
  taskFiles: Array<{ path: string; content: string; language: string }>;
  entrypoint: {
    language: WorkspaceTaskSpec['language'];
    path: string;
    command?: string;
    args?: string[];
  };
  environmentRequirements: Record<string, unknown>;
  validationCommand: string;
  expectedArtifacts: string[];
  patchSummary?: string;
}

export interface AgentServerRepairRequest {
  prompt: string;
  skillDomain: SciForgeSkillDomain;
  contextEnvelope?: Record<string, unknown>;
  codeRef: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  schemaErrors: string[];
  userFeedback?: string;
  uiStateSummary?: Record<string, unknown>;
  priorAttempts: TaskAttemptRecord[];
}

export interface AgentServerRepairResponse extends AgentServerGenerationResponse {
  parentAttempt: number;
  selfHealReason: string;
  diffSummary: string;
}

export interface TaskAttemptRecord {
  id: string;
  prompt: string;
  skillDomain: SciForgeSkillDomain;
  skillId?: string;
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
  attempt: number;
  parentAttempt?: number;
  selfHealReason?: string;
  patchSummary?: string;
  diffRef?: string;
  failureReason?: string;
  status: ExecutionUnitStatus;
  codeRef?: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  exitCode?: number;
  schemaErrors?: string[];
  workEvidenceSummary?: {
    count: number;
    items: Array<{
      kind: string;
      status: string;
      provider?: string;
      resultCount?: number;
      outputSummary?: string;
      evidenceRefs: string[];
      failureReason?: string;
      recoverActions: string[];
      nextStep?: string;
      diagnostics: string[];
      rawRef?: string;
    }>;
  };
  contextRecovery?: {
    kind: 'contextWindowExceeded';
    backend?: string;
    provider?: string;
    agentId?: string;
    sessionRef?: string;
    originalErrorSummary?: string;
    compaction?: BackendContextCompactionResult;
    retryAttempted?: boolean;
    retrySucceeded?: boolean;
  };
  createdAt: string;
}
