import type { SciForgeSkillDomain, GatewayRequest, LlmEndpointConfig, VerificationMode, VerificationRiskLevel } from '../runtime-types.js';
import { cleanUrl, isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';
import { buildSharedAgentHandoffContract, normalizeAgentHandoffSource, normalizeSharedSkillDomain, type SciForgeAgentHandoffSource } from '../../shared/agentHandoff.js';

export function normalizeGatewayRequest(body: Record<string, unknown>): GatewayRequest {
  const skillDomain = normalizeSharedSkillDomain(body.skillDomain) as SciForgeSkillDomain | undefined;
  if (!skillDomain) throw new Error(`Unsupported SciForge skill domain: ${String(body.skillDomain || '')}`);
  const handoffSource = normalizeAgentHandoffSource(body.handoffSource, 'cli');
  return {
    skillDomain,
    prompt: String(body.prompt || ''),
    handoffSource,
    sharedAgentContract: normalizeSharedAgentContract(body.sharedAgentContract, handoffSource),
    workspacePath: typeof body.workspacePath === 'string' ? body.workspacePath : undefined,
    agentServerBaseUrl: typeof body.agentServerBaseUrl === 'string' ? cleanUrl(body.agentServerBaseUrl) : undefined,
    agentBackend: typeof body.agentBackend === 'string' ? body.agentBackend : undefined,
    modelProvider: typeof body.modelProvider === 'string' ? body.modelProvider : undefined,
    modelName: typeof body.modelName === 'string' ? body.modelName : undefined,
    maxContextWindowTokens: finiteNumber(body.maxContextWindowTokens),
    llmEndpoint: normalizeLlmEndpoint(body.llmEndpoint),
    scenarioPackageRef: normalizeScenarioPackageRef(body.scenarioPackageRef),
    skillPlanRef: typeof body.skillPlanRef === 'string' ? body.skillPlanRef : undefined,
    uiPlanRef: typeof body.uiPlanRef === 'string' ? body.uiPlanRef : undefined,
    artifacts: Array.isArray(body.artifacts) ? body.artifacts.filter(isRecord) : [],
    uiState: isRecord(body.uiState) ? body.uiState : undefined,
    availableSkills: Array.isArray(body.availableSkills) ? body.availableSkills.map(String) : undefined,
    selectedToolIds: Array.isArray(body.selectedToolIds) ? uniqueStrings(body.selectedToolIds.map(String)) : undefined,
    selectedSenseIds: uniqueStrings([
      ...(Array.isArray(body.selectedSenseIds) ? body.selectedSenseIds.map(String) : []),
      ...toStringList(isRecord(body.uiState) ? body.uiState.selectedSenseIds : undefined),
    ]),
    selectedActionIds: uniqueStrings([
      ...(Array.isArray(body.selectedActionIds) ? body.selectedActionIds.map(String) : []),
      ...toStringList(isRecord(body.uiState) ? body.uiState.selectedActionIds : undefined),
    ]),
    expectedArtifactTypes: Array.isArray(body.expectedArtifactTypes) ? uniqueStrings(body.expectedArtifactTypes.map(String)) : undefined,
    selectedComponentIds: Array.isArray(body.selectedComponentIds) ? uniqueStrings(body.selectedComponentIds.map(String)) : undefined,
    selectedVerifierIds: uniqueStrings([
      ...(Array.isArray(body.selectedVerifierIds) ? body.selectedVerifierIds.map(String) : []),
      ...toStringList(isRecord(body.uiState) ? body.uiState.selectedVerifierIds : undefined),
    ]),
    riskLevel: normalizeOptionalVerificationRiskLevel(body.riskLevel, isRecord(body.uiState) ? body.uiState.riskLevel : undefined),
    actionSideEffects: uniqueStrings([
      ...(Array.isArray(body.actionSideEffects) ? body.actionSideEffects.map(String) : []),
      ...toStringList(isRecord(body.uiState) ? body.uiState.actionSideEffects : undefined),
    ]),
    userExplicitVerification: normalizeOptionalVerificationMode(body.userExplicitVerification, isRecord(body.uiState) ? body.uiState.userExplicitVerification : undefined),
    artifactPolicy: normalizeRecord(body.artifactPolicy, isRecord(body.uiState) ? body.uiState.artifactPolicy : undefined),
    referencePolicy: normalizeRecord(body.referencePolicy, isRecord(body.uiState) ? body.uiState.referencePolicy : undefined),
    failureRecoveryPolicy: normalizeRecord(body.failureRecoveryPolicy, isRecord(body.uiState) ? body.uiState.failureRecoveryPolicy : undefined),
    verificationPolicy: normalizeVerificationPolicy(body.verificationPolicy, isRecord(body.uiState) ? body.uiState.verificationPolicy : undefined),
    humanApprovalPolicy: normalizeRecord(body.humanApprovalPolicy, isRecord(body.uiState) ? body.uiState.humanApprovalPolicy : undefined),
    humanApproval: normalizeHumanApproval(body.humanApproval, isRecord(body.uiState) ? body.uiState.humanApproval : undefined),
    unverifiedReason: typeof body.unverifiedReason === 'string'
      ? body.unverifiedReason
      : isRecord(body.uiState) && typeof body.uiState.unverifiedReason === 'string'
        ? body.uiState.unverifiedReason
        : undefined,
    verificationResult: normalizeRecord(body.verificationResult, isRecord(body.uiState) ? body.uiState.verificationResult : undefined),
    recentVerificationResults: normalizeRecordList(body.recentVerificationResults, isRecord(body.uiState) ? body.uiState.recentVerificationResults : undefined),
  };
}

function normalizeSharedAgentContract(value: unknown, source: SciForgeAgentHandoffSource): GatewayRequest['sharedAgentContract'] {
  if (!isRecord(value)) return buildSharedAgentHandoffContract(source);
  return buildSharedAgentHandoffContract(normalizeAgentHandoffSource(value.source, source));
}

export function normalizeScenarioPackageRef(value: unknown): GatewayRequest['scenarioPackageRef'] {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const version = typeof value.version === 'string' ? value.version.trim() : '';
  const source = value.source === 'built-in' || value.source === 'workspace' || value.source === 'generated' ? value.source : undefined;
  return id && version && source ? { id, version, source } : undefined;
}

export function normalizeLlmEndpoint(value: unknown): LlmEndpointConfig | undefined {
  if (!isRecord(value)) return undefined;
  const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
  const baseUrl = typeof value.baseUrl === 'string' ? cleanUrl(value.baseUrl) : '';
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  const modelName = typeof value.modelName === 'string' ? value.modelName.trim() : '';
  if (!baseUrl && !apiKey && !modelName) return undefined;
  return {
    provider: provider || undefined,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    modelName: modelName || undefined,
  };
}

export function expectedArtifactTypesForRequest(request: GatewayRequest) {
  return uniqueStrings([
    ...(request.expectedArtifactTypes ?? []),
    ...toStringList(request.uiState?.expectedArtifactTypes),
  ]);
}

export function selectedComponentIdsForRequest(request: Pick<GatewayRequest, 'selectedComponentIds' | 'uiState'>) {
  return uniqueStrings([
    ...(request.selectedComponentIds ?? []),
    ...toStringList(request.uiState?.selectedComponentIds),
  ]);
}

function finiteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function normalizeVerificationPolicy(...values: unknown[]): GatewayRequest['verificationPolicy'] {
  const record = values.find(isRecord);
  if (!record) return undefined;
  const mode = normalizeVerificationMode(record.mode);
  const riskLevel = normalizeVerificationRiskLevel(record.riskLevel);
  return {
    required: typeof record.required === 'boolean' ? record.required : mode !== 'none',
    mode,
    riskLevel,
    reason: typeof record.reason === 'string' && record.reason.trim()
      ? record.reason.trim()
      : 'Runtime request supplied a verification policy.',
    selectedVerifierIds: uniqueStrings([
      ...toStringList(record.selectedVerifierIds),
      ...toStringList(record.verifierIds),
    ]),
    humanApprovalPolicy: record.humanApprovalPolicy === 'required' || record.humanApprovalPolicy === 'optional' || record.humanApprovalPolicy === 'none'
      ? record.humanApprovalPolicy
      : undefined,
    unverifiedReason: typeof record.unverifiedReason === 'string' ? record.unverifiedReason : undefined,
  };
}

function normalizeVerificationMode(value: unknown): VerificationMode {
  return value === 'none'
    || value === 'lightweight'
    || value === 'automatic'
    || value === 'human'
    || value === 'hybrid'
    || value === 'unverified'
    ? value
    : 'lightweight';
}

function normalizeVerificationRiskLevel(value: unknown): VerificationRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'low';
}

function normalizeOptionalVerificationMode(...values: unknown[]): VerificationMode | undefined {
  const value = values.find((item) => typeof item === 'string');
  return value === 'none'
    || value === 'lightweight'
    || value === 'automatic'
    || value === 'human'
    || value === 'hybrid'
    || value === 'unverified'
    ? value
    : undefined;
}

function normalizeOptionalVerificationRiskLevel(...values: unknown[]): VerificationRiskLevel | undefined {
  const value = values.find((item) => typeof item === 'string');
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function normalizeHumanApproval(...values: unknown[]): GatewayRequest['humanApproval'] {
  const record = values.find(isRecord);
  return record ? record : undefined;
}

function normalizeRecord(...values: unknown[]) {
  return values.find(isRecord);
}

function normalizeRecordList(...values: unknown[]) {
  const value = values.find(Array.isArray);
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}
