import {
  buildSharedAgentHandoffContract,
  normalizeAgentHandoffSource,
  type SciForgeAgentHandoffSource,
  type SciForgeSharedSkillDomain,
} from './handoff';

export type VerificationMode = 'none' | 'lightweight' | 'automatic' | 'human' | 'hybrid' | 'unverified';

export interface VerificationPolicy {
  required: boolean;
  mode: VerificationMode;
  reason: string;
  riskLevel?: 'low' | 'medium' | 'high';
  unverifiedReason?: string;
}

export interface HumanApprovalPolicy {
  required: boolean;
  mode: 'none' | 'optional' | 'required-before-action' | 'required-before-final';
  reason?: string;
}

export interface FailureRecoveryPolicy {
  mode: 'preserve-context' | 'repair-first' | 'fail-closed' | 'none';
  priorFailureReason?: string;
  recoverActions?: string[];
  attemptHistoryRefs?: string[];
  attemptHistory?: Array<Record<string, unknown>>;
  nextStep?: string;
  evidenceRefs?: string[];
}

export interface AgentHandoffPolicySet {
  artifactPolicy?: Record<string, unknown>;
  referencePolicy?: Record<string, unknown>;
  failureRecoveryPolicy?: FailureRecoveryPolicy | Record<string, unknown>;
  verificationPolicy?: VerificationPolicy | Record<string, unknown>;
  humanApprovalPolicy?: HumanApprovalPolicy | Record<string, unknown>;
  unverifiedReason?: string;
  verificationResult?: Record<string, unknown>;
  recentVerificationResults?: Array<Record<string, unknown>>;
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
