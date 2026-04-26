import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../domain';
import type { ScenarioId } from '../data';
import { makeId, nowIso } from '../domain';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { normalizeAgentResponse } from './agentClient';
import { scopeCheck } from './scopeCheck';
import { recommendScenarioElements } from '../scenarioCompiler/scenarioElementCompiler';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function sendBioAgentToolMessage(
  input: SendAgentMessageInput,
  callbacks: { onEvent?: (event: AgentStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const recentConversation = input.messages.slice(-8).map((message) => `${message.role}: ${message.content}`);
  const artifactSummary = summarizeArtifacts(input);
  const runtimePrompt = buildRuntimePrompt(input, recentConversation, artifactSummary);
  const compileText = [
    input.scenarioOverride?.title,
    input.scenarioOverride?.description,
    input.scenarioOverride?.scenarioMarkdown,
    recentConversation.join('\n'),
    input.prompt,
  ].filter(Boolean).join('\n');
  const compileHints = recommendScenarioElements(compileText || input.prompt);
  const expectedArtifactTypes = compileHints.selectedArtifactTypes;
  const selectedComponentIds = input.scenarioOverride?.defaultComponents?.length ? input.scenarioOverride.defaultComponents : compileHints.selectedComponentIds;
  const forceAgentServerGeneration = shouldForceGeneralAgentWork(input, expectedArtifactTypes, selectedComponentIds, recentConversation, artifactSummary);
  const availableSkills = forceAgentServerGeneration
    ? [`agentserver.generate.${input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain}`]
    : compileHints.selectedSkillIds;
  callbacks.onEvent?.(toolEvent('project-tool-start', `BioAgent ${input.scenarioId} project tool started`));
  const response = await fetch(`${input.config.workspaceWriterBaseUrl}/api/bioagent/tools/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenarioId: input.scenarioId,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      skillDomain: input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain,
      prompt: runtimePrompt,
      workspacePath: input.config.workspacePath,
      agentServerBaseUrl: input.config.agentServerBaseUrl,
      modelProvider: input.config.modelProvider,
      modelName: input.config.modelName,
      llmEndpoint: buildToolLlmEndpoint(input),
      roleView: input.roleView,
      artifacts: artifactSummary,
      availableSkills,
      expectedArtifactTypes,
      selectedComponentIds,
      uiState: {
        scopeCheck: scopeCheck(builtInScenarioId, input.prompt),
        scenarioOverride: input.scenarioOverride,
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        currentPrompt: input.prompt,
        recentConversation,
        expectedArtifactTypes,
        selectedComponentIds,
        freshTaskGeneration: true,
        forceAgentServerGeneration,
      },
    }),
    signal,
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // Keep raw text for the error below.
  }
  if (!response.ok || !isRecord(json) || json.ok !== true) {
    const detail = isRecord(json) ? asString(json.error) || asString(json.message) : undefined;
    throw new Error(detail || `BioAgent project tool failed: HTTP ${response.status}`);
  }
  callbacks.onEvent?.(toolEvent('project-tool-done', `BioAgent ${input.scenarioId} project tool completed`));
  const result = isRecord(json.result) ? json.result : {};
  return normalizeAgentResponse(input.scenarioId, input.prompt, {
    ok: true,
    data: {
      run: {
        id: makeId(`project-${input.scenarioId}`),
        status: 'completed',
        createdAt: nowIso(),
        completedAt: nowIso(),
        output: {
          result: JSON.stringify(result),
        },
      },
    },
  });
}

function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
  if (input.scenarioId === 'structure-exploration'
    || input.scenarioId === 'omics-differential-exploration'
    || input.scenarioId === 'biomedical-knowledge-graph'
    || input.scenarioId === 'literature-evidence-review') return input.scenarioId as ScenarioId;
  const skillDomain = input.scenarioOverride?.skillDomain;
  if (skillDomain === 'structure') return 'structure-exploration';
  if (skillDomain === 'omics') return 'omics-differential-exploration';
  if (skillDomain === 'knowledge') return 'biomedical-knowledge-graph';
  return 'literature-evidence-review';
}

function summarizeArtifacts(input: SendAgentMessageInput) {
  return (input.artifacts ?? []).slice(0, 8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    schemaVersion: artifact.schemaVersion,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
    data: artifact.data,
  }));
}

function buildToolLlmEndpoint(input: SendAgentMessageInput) {
  const provider = input.config.modelProvider.trim();
  const modelName = input.config.modelName.trim();
  const baseUrl = input.config.modelBaseUrl.trim().replace(/\/+$/, '');
  const apiKey = input.config.apiKey.trim();
  const useNative = !provider || provider === 'native';
  if (useNative) return undefined;
  if (!baseUrl && !modelName) return undefined;
  return {
    provider,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    modelName: modelName || undefined,
  };
}

function buildRuntimePrompt(
  input: SendAgentMessageInput,
  recentConversation: string[],
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
) {
  const scenario = input.scenarioOverride;
  return [
    'BioAgent should complete the user task end-to-end like a general coding/research agent, not only run a narrow seed search.',
    scenario ? `Scenario title: ${scenario.title}` : '',
    scenario ? `Scenario goal: ${scenario.description}` : '',
    scenario ? `Scenario markdown:\n${scenario.scenarioMarkdown}` : '',
    recentConversation.length ? 'Recent multi-turn conversation:' : '',
    recentConversation.join('\n'),
    artifactSummary.length ? 'Existing artifacts from previous turns:' : '',
    artifactSummary.length ? JSON.stringify(artifactSummary, null, 2) : '',
    'Current user request:',
    input.prompt,
    '',
    'Work requirements:',
    '- Infer the full user intent across turns.',
    '- If the user asks to read, summarize, compare, or write a report, produce a research-report artifact, not just search metadata.',
    '- Reuse previous paper-list/artifacts when useful; fetch or compute additional data only when needed.',
    '- Emit BioAgent ToolPayload JSON with message, claims, artifacts, executionUnits, uiManifest, and reasoningTrace.',
  ].filter(Boolean).join('\n');
}

function shouldForceGeneralAgentWork(
  input: SendAgentMessageInput,
  expectedArtifactTypes: string[],
  selectedComponentIds: string[],
  recentConversation: string[],
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
) {
  const text = [
    input.scenarioOverride?.description,
    input.scenarioOverride?.scenarioMarkdown,
    recentConversation.join('\n'),
    input.prompt,
  ].filter(Boolean).join('\n').toLowerCase();
  const wantsReport = expectedArtifactTypes.includes('research-report')
    || selectedComponentIds.includes('report-viewer')
    || /report|summary|summari[sz]e|systematic|read|reading|review|报告|总结|系统性|阅读|综述/.test(text);
  const wantsFreshExternalResearch = /\barxiv\b|\blatest\b|\btoday\b|\bweb\b|\bbrowser\b|最新|今天|今日|网页|浏览器/.test(text);
  const multiTurnContinuation = artifactSummary.length > 0 && /继续|这些|上述|它们|阅读|总结|报告|不只是|not only|not just|write|draft/.test(text);
  return wantsReport && (wantsFreshExternalResearch || multiTurnContinuation);
}

function toolEvent(type: string, detail: string): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type,
    label: '项目工具',
    detail,
    createdAt: nowIso(),
    raw: { type, detail },
  };
}
