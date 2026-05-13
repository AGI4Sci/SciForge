import {
  buildSharedAgentHandoffContract,
  normalizeAgentHandoffSource,
  type SciForgeAgentHandoffSource,
  type SciForgeSharedSkillDomain,
} from './handoff';

export type VerificationMode = 'none' | 'lightweight' | 'automatic' | 'human' | 'hybrid' | 'unverified';
export type VerificationVerdict = 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';
export type VerificationRiskLevel = 'low' | 'medium' | 'high';
export type AgentHandoffRef = string;
export type AgentHandoffArtifactPolicyMode =
  | 'refs-first-bounded-read'
  | 'explicit-current-turn-or-backend-decides'
  | 'backend-decides'
  | 'none';
export type AgentHandoffReferencePolicyMode =
  | 'explicit-refs-first'
  | 'current-turn-refs-only'
  | 'backend-decides'
  | 'none';
export type FailureRecoveryMode = 'preserve-context' | 'repair-first' | 'fail-closed' | 'none';
export type FailureRecoveryEvidenceExpansionDefaultAction =
  | 'refs-and-digests-only'
  | 'refs-and-digests-first'
  | 'fail-closed';

export interface VerificationPolicy {
  required: boolean;
  mode: VerificationMode;
  reason: string;
  riskLevel?: VerificationRiskLevel;
  selectedVerifierIds?: string[];
  humanApprovalPolicy?: 'none' | 'optional' | 'required';
  unverifiedReason?: string;
}

export interface HumanApprovalPolicy {
  required: boolean;
  mode: 'none' | 'optional' | 'required-before-action' | 'required-before-final';
  reason?: string;
}

export interface AgentHandoffArtifactPolicy {
  mode: AgentHandoffArtifactPolicyMode;
  maxInlineBytes?: number;
  maxInlineArtifacts?: number;
  allowedArtifactTypes?: string[];
  expectedArtifactTypes?: string[];
  requiredArtifactRefs?: AgentHandoffRef[];
  reason?: string;
}

export interface AgentHandoffReferencePolicy {
  mode: AgentHandoffReferencePolicyMode;
  currentReferenceCount?: number;
  requiredRefs?: AgentHandoffRef[];
  allowedRefKinds?: string[];
  defaultAction?: string;
  allowHistoryFallback?: boolean;
  reason?: string;
}

export interface FailureRecoveryAttemptSnapshot {
  id?: string;
  status?: string;
  tool?: string;
  failureReason?: string;
  recoverActions?: string[];
  nextStep?: string;
  ref?: AgentHandoffRef;
  codeRef?: AgentHandoffRef;
  inputRef?: AgentHandoffRef;
  outputRef?: AgentHandoffRef;
  stdoutRef?: AgentHandoffRef;
  stderrRef?: AgentHandoffRef;
  traceRef?: AgentHandoffRef;
  evidenceRefs?: AgentHandoffRef[];
  workEvidenceSummary?: Record<string, unknown>;
}

export interface FailureRecoveryEvidenceExpansionPolicy {
  defaultAction: FailureRecoveryEvidenceExpansionDefaultAction | string;
  logRefs?: string;
  artifactRefs?: string;
  authority?: string;
  policyRef?: AgentHandoffRef;
}

export interface FailureRecoveryPolicy {
  mode: FailureRecoveryMode;
  priorFailureReason?: string;
  recoverActions?: string[];
  attemptHistoryRefs?: AgentHandoffRef[];
  attemptHistory?: FailureRecoveryAttemptSnapshot[];
  nextStep?: string;
  evidenceRefs?: AgentHandoffRef[];
  evidenceExpansionPolicy?: FailureRecoveryEvidenceExpansionPolicy;
}

export interface AgentHandoffVerificationSnapshot {
  id?: string;
  verdict: VerificationVerdict;
  confidence?: number;
  reward?: number;
  critique?: string;
  evidenceRefs?: AgentHandoffRef[];
  repairHints?: string[];
  dataRef?: AgentHandoffRef;
  traceRef?: AgentHandoffRef;
  diagnostics?: Record<string, unknown>;
}

export interface AgentHandoffPolicySet {
  artifactPolicy?: AgentHandoffArtifactPolicy | Record<string, unknown>;
  referencePolicy?: AgentHandoffReferencePolicy | Record<string, unknown>;
  failureRecoveryPolicy?: FailureRecoveryPolicy | Record<string, unknown>;
  verificationPolicy?: VerificationPolicy | Record<string, unknown>;
  humanApprovalPolicy?: HumanApprovalPolicy | Record<string, unknown>;
  unverifiedReason?: string;
  verificationResult?: AgentHandoffVerificationSnapshot | Record<string, unknown>;
  recentVerificationResults?: Array<AgentHandoffVerificationSnapshot | Record<string, unknown>>;
}

export interface BuildAgentHandoffPayloadInput extends AgentHandoffPolicySet {
  scenarioId: string;
  handoffSource?: SciForgeAgentHandoffSource;
  scenarioPackageRef?: unknown;
  skillPlanRef?: string;
  uiPlanRef?: string;
  skillDomain: SciForgeSharedSkillDomain;
  agentBackend?: string;
  prompt: string;
  workspacePath?: string;
  agentServerBaseUrl?: string;
  modelProvider?: string;
  modelName?: string;
  maxContextWindowTokens?: number;
  llmEndpoint?: Record<string, unknown>;
  roleView?: string;
  artifacts?: Array<Record<string, unknown>>;
  references?: Array<Record<string, unknown>>;
  availableSkills?: string[];
  selectedToolIds?: string[];
  selectedToolContracts?: Array<Record<string, unknown>>;
  selectedSenseIds?: string[];
  selectedActionIds?: string[];
  selectedVerifierIds?: string[];
  expectedArtifactTypes?: string[];
  selectedComponentIds?: string[];
  availableComponentIds?: string[];
  uiState?: Record<string, unknown>;
  agentContext?: Record<string, unknown>;
}

export function isAgentHandoffArtifactPolicy(value: unknown): value is AgentHandoffArtifactPolicy {
  if (!isRecord(value)) return false;
  return isArtifactPolicyMode(value.mode)
    && optionalNumber(value.maxInlineBytes)
    && optionalNumber(value.maxInlineArtifacts)
    && optionalStringList(value.allowedArtifactTypes)
    && optionalStringList(value.expectedArtifactTypes)
    && optionalStringList(value.requiredArtifactRefs)
    && optionalString(value.reason);
}

export function isAgentHandoffReferencePolicy(value: unknown): value is AgentHandoffReferencePolicy {
  if (!isRecord(value)) return false;
  return isReferencePolicyMode(value.mode)
    && optionalNumber(value.currentReferenceCount)
    && optionalStringList(value.requiredRefs)
    && optionalStringList(value.allowedRefKinds)
    && optionalString(value.defaultAction)
    && optionalBoolean(value.allowHistoryFallback)
    && optionalString(value.reason);
}

export function isFailureRecoveryPolicy(value: unknown): value is FailureRecoveryPolicy {
  if (!isRecord(value)) return false;
  return isFailureRecoveryMode(value.mode)
    && optionalString(value.priorFailureReason)
    && optionalStringList(value.recoverActions)
    && optionalStringList(value.attemptHistoryRefs)
    && optionalString(value.nextStep)
    && optionalStringList(value.evidenceRefs)
    && (value.evidenceExpansionPolicy === undefined || isFailureRecoveryEvidenceExpansionPolicy(value.evidenceExpansionPolicy))
    && (value.attemptHistory === undefined
      || (Array.isArray(value.attemptHistory) && value.attemptHistory.every(isFailureRecoveryAttemptSnapshot)));
}

export function isFailureRecoveryEvidenceExpansionPolicy(value: unknown): value is FailureRecoveryEvidenceExpansionPolicy {
  if (!isRecord(value)) return false;
  return typeof value.defaultAction === 'string'
    && optionalString(value.logRefs)
    && optionalString(value.artifactRefs)
    && optionalString(value.authority)
    && optionalString(value.policyRef);
}

export function isFailureRecoveryAttemptSnapshot(value: unknown): value is FailureRecoveryAttemptSnapshot {
  if (!isRecord(value)) return false;
  return optionalString(value.id)
    && optionalString(value.status)
    && optionalString(value.tool)
    && optionalString(value.failureReason)
    && optionalStringList(value.recoverActions)
    && optionalString(value.nextStep)
    && optionalString(value.ref)
    && optionalString(value.codeRef)
    && optionalString(value.inputRef)
    && optionalString(value.outputRef)
    && optionalString(value.stdoutRef)
    && optionalString(value.stderrRef)
    && optionalString(value.traceRef)
    && optionalStringList(value.evidenceRefs)
    && (value.workEvidenceSummary === undefined || isRecord(value.workEvidenceSummary));
}

export function isAgentHandoffVerificationSnapshot(value: unknown): value is AgentHandoffVerificationSnapshot {
  if (!isRecord(value)) return false;
  return isVerificationVerdict(value.verdict)
    && optionalString(value.id)
    && optionalNumber(value.confidence)
    && optionalNumber(value.reward)
    && optionalString(value.critique)
    && optionalStringList(value.evidenceRefs)
    && optionalStringList(value.repairHints)
    && optionalString(value.dataRef)
    && optionalString(value.traceRef)
    && (value.diagnostics === undefined || isRecord(value.diagnostics));
}

export function buildAgentHandoffPayload(input: BuildAgentHandoffPayloadInput) {
  const source = normalizeAgentHandoffSource(input.handoffSource, 'cli');
  const sharedAgentContract = buildSharedAgentHandoffContract(source);
  const policySet = compactRecord({
    artifactPolicy: input.artifactPolicy,
    referencePolicy: input.referencePolicy,
    failureRecoveryPolicy: input.failureRecoveryPolicy,
    verificationPolicy: input.verificationPolicy,
    humanApprovalPolicy: input.humanApprovalPolicy,
    unverifiedReason: input.unverifiedReason,
    verificationResult: input.verificationResult,
    recentVerificationResults: input.recentVerificationResults,
  });
  const uiState = compactRecord({
    ...input.uiState,
    expectedArtifactTypes: input.expectedArtifactTypes,
    selectedComponentIds: input.selectedComponentIds,
    availableComponentIds: input.availableComponentIds,
    selectedSkillIds: input.availableSkills,
    selectedToolIds: input.selectedToolIds,
    selectedToolContracts: input.selectedToolContracts,
    selectedSenseIds: input.selectedSenseIds,
    selectedActionIds: input.selectedActionIds,
    selectedVerifierIds: input.selectedVerifierIds,
    artifactPolicy: input.artifactPolicy,
    referencePolicy: input.referencePolicy,
    failureRecoveryPolicy: input.failureRecoveryPolicy,
    verificationPolicy: input.verificationPolicy,
    humanApprovalPolicy: input.humanApprovalPolicy,
    unverifiedReason: input.unverifiedReason,
    verificationResult: input.verificationResult,
    recentVerificationResults: input.recentVerificationResults,
    sharedAgentContract,
    agentContext: input.agentContext ? compactRecord({
      ...input.agentContext,
      selectedSenseIds: input.selectedSenseIds,
      selectedActionIds: input.selectedActionIds,
      selectedVerifierIds: input.selectedVerifierIds,
      policies: policySet,
    }) : undefined,
  });

  return compactRecord({
    scenarioId: input.scenarioId,
    handoffSource: source,
    sharedAgentContract,
    scenarioPackageRef: input.scenarioPackageRef,
    skillPlanRef: input.skillPlanRef,
    uiPlanRef: input.uiPlanRef,
    skillDomain: input.skillDomain,
    agentBackend: input.agentBackend,
    prompt: input.prompt,
    workspacePath: input.workspacePath,
    agentServerBaseUrl: input.agentServerBaseUrl,
    modelProvider: input.modelProvider,
    modelName: input.modelName,
    maxContextWindowTokens: input.maxContextWindowTokens,
    llmEndpoint: input.llmEndpoint,
    roleView: input.roleView,
    artifacts: input.artifacts ?? [],
    references: input.references ?? [],
    availableSkills: input.availableSkills,
    selectedToolIds: input.selectedToolIds,
    selectedToolContracts: input.selectedToolContracts,
    selectedSenseIds: input.selectedSenseIds,
    selectedActionIds: input.selectedActionIds,
    selectedVerifierIds: input.selectedVerifierIds,
    expectedArtifactTypes: input.expectedArtifactTypes,
    selectedComponentIds: input.selectedComponentIds,
    availableComponentIds: input.availableComponentIds,
    artifactPolicy: input.artifactPolicy,
    referencePolicy: input.referencePolicy,
    failureRecoveryPolicy: input.failureRecoveryPolicy,
    verificationPolicy: input.verificationPolicy,
    humanApprovalPolicy: input.humanApprovalPolicy,
    unverifiedReason: input.unverifiedReason,
    verificationResult: input.verificationResult,
    recentVerificationResults: input.recentVerificationResults,
    uiState,
  });
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

function isArtifactPolicyMode(value: unknown): value is AgentHandoffArtifactPolicyMode {
  return value === 'refs-first-bounded-read'
    || value === 'explicit-current-turn-or-backend-decides'
    || value === 'backend-decides'
    || value === 'none';
}

function isReferencePolicyMode(value: unknown): value is AgentHandoffReferencePolicyMode {
  return value === 'explicit-refs-first'
    || value === 'current-turn-refs-only'
    || value === 'backend-decides'
    || value === 'none';
}

function isFailureRecoveryMode(value: unknown): value is FailureRecoveryMode {
  return value === 'preserve-context' || value === 'repair-first' || value === 'fail-closed' || value === 'none';
}

function isVerificationVerdict(value: unknown): value is VerificationVerdict {
  return value === 'pass' || value === 'fail' || value === 'uncertain' || value === 'needs-human' || value === 'unverified';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function optionalStringList(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
}
