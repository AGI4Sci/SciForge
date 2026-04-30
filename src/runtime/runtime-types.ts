export type BioAgentSkillDomain = 'literature' | 'structure' | 'omics' | 'knowledge';

export type ExecutionUnitStatus =
  | 'planned'
  | 'running'
  | 'done'
  | 'failed'
  | 'record-only'
  | 'repair-needed'
  | 'self-healed'
  | 'failed-with-reason';

export interface GatewayRequest {
  skillDomain: BioAgentSkillDomain;
  prompt: string;
  workspacePath?: string;
  agentServerBaseUrl?: string;
  agentBackend?: string;
  modelProvider?: string;
  modelName?: string;
  llmEndpoint?: LlmEndpointConfig;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  artifacts: Array<Record<string, unknown>>;
  uiState?: Record<string, unknown>;
  availableSkills?: string[];
  expectedArtifactTypes?: string[];
  selectedComponentIds?: string[];
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
  raw?: unknown;
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
  kind: 'seed' | 'workspace' | 'installed';
  description: string;
  skillDomains: BioAgentSkillDomain[];
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
  skillDomain: BioAgentSkillDomain;
  contextEnvelope?: Record<string, unknown>;
  workspaceTreeSummary: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
  availableSkills: Array<Pick<SkillAvailability, 'id' | 'kind' | 'available' | 'reason' | 'manifestPath'> & {
    description?: string;
    entrypointType?: SkillManifest['entrypoint']['type'];
    scopeDeclaration?: Record<string, unknown>;
  }>;
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
  skillDomain: BioAgentSkillDomain;
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
  skillDomain: BioAgentSkillDomain;
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
  createdAt: string;
}
