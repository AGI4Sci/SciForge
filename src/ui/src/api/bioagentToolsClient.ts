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
  const compileHints = input.scenarioOverride ? recommendScenarioElements(input.scenarioOverride.description || input.scenarioOverride.scenarioMarkdown || input.prompt) : undefined;
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
      prompt: input.prompt,
      workspacePath: input.config.workspacePath,
      agentServerBaseUrl: input.config.agentServerBaseUrl,
      roleView: input.roleView,
      artifacts: summarizeArtifacts(input),
      availableSkills: compileHints?.selectedSkillIds,
      expectedArtifactTypes: compileHints?.selectedArtifactTypes,
      selectedComponentIds: input.scenarioOverride?.defaultComponents ?? compileHints?.selectedComponentIds,
      uiState: {
        scopeCheck: scopeCheck(builtInScenarioId, input.prompt),
        scenarioOverride: input.scenarioOverride,
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        expectedArtifactTypes: compileHints?.selectedArtifactTypes,
        selectedComponentIds: input.scenarioOverride?.defaultComponents ?? compileHints?.selectedComponentIds,
        freshTaskGeneration: true,
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
