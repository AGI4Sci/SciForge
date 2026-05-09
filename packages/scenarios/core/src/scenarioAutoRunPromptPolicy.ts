import type { ScenarioId } from './contracts';

export interface ScenarioAutoRunPromptArtifact {
  id: string;
  type: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
}

export interface ScenarioHandoffAutoRunPromptRequest {
  targetScenario: ScenarioId;
  artifact: ScenarioAutoRunPromptArtifact;
  sourceScenarioName: string;
  targetScenarioName: string;
}

const focusedHandoffPromptTemplates: Partial<Record<ScenarioId, (focus: string) => string>> = {
  'literature-evidence-review': (focus: string) => `${focus} clinical trials，返回 paper-list JSON artifact、claims、ExecutionUnit。`,
  'structure-exploration': (focus: string) => `分析 ${focus} 的结构，返回 structure-summary artifact、dataRef、质量指标和 ExecutionUnit。`,
  'biomedical-knowledge-graph': (focus: string) => `${focus} gene/protein knowledge graph，返回 knowledge-graph、来源链接、数据库访问日期和 ExecutionUnit。`,
};

export function scenarioHandoffAutoRunPrompt({
  targetScenario,
  artifact,
  sourceScenarioName,
  targetScenarioName,
}: ScenarioHandoffAutoRunPromptRequest): string {
  const focus = artifactFocusTerm(artifact);
  const focusedTemplate = focus ? focusedHandoffPromptTemplates[targetScenario]?.(focus) : undefined;
  if (focusedTemplate) return focusedTemplate;
  return [
    `消费 handoff artifact ${artifact.id} (${artifact.type})。`,
    `来源 Scenario: ${sourceScenarioName}。`,
    `请按${targetScenarioName}的 input contract 生成下一步 claims、ExecutionUnit、UIManifest 和 runtime artifact。`,
  ].join('\n');
}

export function artifactFocusTerm(artifact: ScenarioAutoRunPromptArtifact): string | undefined {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return asString(metadata.entity)
    || asString(metadata.accession)
    || asString(metadata.uniprotAccession)
    || asString(data.uniprotId)
    || asString(data.pdbId)
    || rowValue(data.rows, 'entity')
    || rowValue(data.rows, 'uniprot_accession')
    || nodeId(data.nodes, ['gene', 'protein']);
}

function rowValue(value: unknown, key: string): string | undefined {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = rows.find((row) => asString(row.key)?.toLowerCase() === key.toLowerCase());
  return asString(found?.value);
}

function nodeId(value: unknown, preferredTypes: string[]): string | undefined {
  const nodes = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = nodes.find((node) => {
    const type = asString(node.type)?.toLowerCase();
    return type ? preferredTypes.includes(type) : false;
  }) ?? nodes[0];
  return asString(found?.id) || asString(found?.label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
