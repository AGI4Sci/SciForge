import type { BioAgentSkillDomain, GatewayRequest, LlmEndpointConfig } from '../runtime-types.js';
import { cleanUrl, isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';

const SKILL_DOMAIN_SET = new Set<BioAgentSkillDomain>(['literature', 'structure', 'omics', 'knowledge']);

export function normalizeGatewayRequest(body: Record<string, unknown>): GatewayRequest {
  const skillDomain = String(body.skillDomain || '') as BioAgentSkillDomain;
  if (!SKILL_DOMAIN_SET.has(skillDomain)) throw new Error(`Unsupported BioAgent skill domain: ${String(body.skillDomain || '')}`);
  return {
    skillDomain,
    prompt: String(body.prompt || ''),
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
    expectedArtifactTypes: Array.isArray(body.expectedArtifactTypes) ? uniqueStrings(body.expectedArtifactTypes.map(String)) : undefined,
    selectedComponentIds: Array.isArray(body.selectedComponentIds) ? uniqueStrings(body.selectedComponentIds.map(String)) : undefined,
  };
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
