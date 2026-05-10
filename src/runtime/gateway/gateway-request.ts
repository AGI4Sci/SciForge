import type { SciForgeSkillDomain, GatewayRequest, LlmEndpointConfig, VerificationMode, VerificationRiskLevel } from '../runtime-types.js';
import { cleanUrl, isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { buildSharedAgentHandoffContract, normalizeAgentHandoffSource, normalizeSharedSkillDomain, type SciForgeAgentHandoffSource } from '@sciforge-ui/runtime-contract/handoff';
import { normalizeRuntimeLlmEndpoint } from '@sciforge-ui/runtime-contract/agent-backend-policy';

export function normalizeGatewayRequest(body: Record<string, unknown>): GatewayRequest {
  const skillDomain = normalizeSharedSkillDomain(body.skillDomain) as SciForgeSkillDomain | undefined;
  if (!skillDomain) throw new Error(`Unsupported SciForge skill domain: ${String(body.skillDomain || '')}`);
  const handoffSource = normalizeAgentHandoffSource(body.handoffSource, 'cli');
  const uiState = normalizeGatewayUiState(body);
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
    references: Array.isArray(body.references) ? body.references.filter(isRecord) : undefined,
    uiState,
    availableSkills: Array.isArray(body.availableSkills) ? body.availableSkills.map(String) : undefined,
    selectedToolIds: Array.isArray(body.selectedToolIds) ? uniqueStrings(body.selectedToolIds.map(String)) : undefined,
    selectedSenseIds: uniqueStrings([
      ...(Array.isArray(body.selectedSenseIds) ? body.selectedSenseIds.map(String) : []),
      ...toStringList(uiState?.selectedSenseIds),
    ]),
    selectedActionIds: uniqueStrings([
      ...(Array.isArray(body.selectedActionIds) ? body.selectedActionIds.map(String) : []),
      ...toStringList(uiState?.selectedActionIds),
    ]),
    expectedArtifactTypes: Array.isArray(body.expectedArtifactTypes) ? uniqueStrings(body.expectedArtifactTypes.map(String)) : undefined,
    selectedComponentIds: Array.isArray(body.selectedComponentIds) ? uniqueStrings(body.selectedComponentIds.map(String)) : undefined,
    selectedVerifierIds: uniqueStrings([
      ...(Array.isArray(body.selectedVerifierIds) ? body.selectedVerifierIds.map(String) : []),
      ...toStringList(uiState?.selectedVerifierIds),
    ]),
    riskLevel: normalizeOptionalVerificationRiskLevel(body.riskLevel, uiState?.riskLevel),
    actionSideEffects: uniqueStrings([
      ...(Array.isArray(body.actionSideEffects) ? body.actionSideEffects.map(String) : []),
      ...toStringList(uiState?.actionSideEffects),
    ]),
    userExplicitVerification: normalizeOptionalVerificationMode(body.userExplicitVerification, uiState?.userExplicitVerification),
    artifactPolicy: normalizeRecord(body.artifactPolicy, uiState?.artifactPolicy),
    referencePolicy: normalizeRecord(body.referencePolicy, uiState?.referencePolicy),
    failureRecoveryPolicy: normalizeRecord(body.failureRecoveryPolicy, uiState?.failureRecoveryPolicy),
    humanApprovalPolicy: normalizeRecord(body.humanApprovalPolicy, uiState?.humanApprovalPolicy),
    humanApproval: normalizeHumanApproval(body.humanApproval, uiState?.humanApproval),
    unverifiedReason: typeof body.unverifiedReason === 'string'
      ? body.unverifiedReason
      : typeof uiState?.unverifiedReason === 'string'
        ? uiState.unverifiedReason
        : undefined,
    verificationResult: normalizeRecord(body.verificationResult, uiState?.verificationResult),
    recentVerificationResults: normalizeRecordList(body.recentVerificationResults, uiState?.recentVerificationResults),
  };
}

function normalizeGatewayUiState(body: Record<string, unknown>): GatewayRequest['uiState'] {
  const rawUiState = isRecord(body.uiState) ? body.uiState : undefined;
  const ignoredLegacySources = ignoredLegacyVerificationPolicySources(body, rawUiState);
  if (!rawUiState && !ignoredLegacySources.length) return undefined;
  const uiState: Record<string, unknown> = rawUiState ? { ...rawUiState } : {};
  delete uiState.verificationPolicy;
  const scenarioOverride = isRecord(uiState.scenarioOverride) ? { ...uiState.scenarioOverride } : undefined;
  if (scenarioOverride) {
    delete scenarioOverride.verificationPolicy;
    uiState.scenarioOverride = scenarioOverride;
  }
  if (ignoredLegacySources.length) {
    uiState.ignoredLegacyVerificationPolicySources = [
      ...toRecordList(uiState.ignoredLegacyVerificationPolicySources),
      ...ignoredLegacySources,
    ];
  }
  return uiState;
}

function ignoredLegacyVerificationPolicySources(
  body: Record<string, unknown>,
  uiState: Record<string, unknown> | undefined,
) {
  return [
    ignoredLegacyVerificationPolicySource('request.verificationPolicy', body.verificationPolicy),
    ignoredLegacyVerificationPolicySource('request.uiState.verificationPolicy', uiState?.verificationPolicy),
    ignoredLegacyVerificationPolicySource(
      'request.uiState.scenarioOverride.verificationPolicy',
      isRecord(uiState?.scenarioOverride) ? uiState.scenarioOverride.verificationPolicy : undefined,
    ),
  ].filter((entry) => entry !== undefined);
}

function ignoredLegacyVerificationPolicySource(source: string, value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return {
    source,
    decision: 'ignored',
    keys: Object.keys(value).sort().slice(0, 12),
    reason: 'Legacy verificationPolicy request fields are ignored; structured contract projection records runtime verification settings.',
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
  return normalizeRuntimeLlmEndpoint(value) as LlmEndpointConfig | undefined;
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
