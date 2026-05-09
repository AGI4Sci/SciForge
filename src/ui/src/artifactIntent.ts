import type { ScenarioId } from './data';
import { artifactTypesForComponents } from './uiModuleRegistry';

const ARTIFACT_COMPONENTS: Record<string, string> = {
  'research-report': 'report-viewer',
  'paper-list': 'paper-card-list',
  'evidence-matrix': 'evidence-matrix',
  'notebook-timeline': 'notebook-timeline',
  'structure-summary': 'structure-viewer',
  'omics-differential-expression': 'point-set-viewer',
  'knowledge-graph': 'graph-viewer',
  'data-table': 'record-table',
};

const ARTIFACT_ALIASES: Record<string, string[]> = {
  'paper-list': ['paper-list', '文献列表', '论文列表', 'paper list'],
  'evidence-matrix': ['evidence-matrix', '证据矩阵', '证据表', 'evidence table', 'claim matrix'],
  'notebook-timeline': ['notebook-timeline', '研究记录', '实验记录', '时间线', 'timeline', 'notebook'],
  'research-report': ['research-report', 'summary-report', 'markdown-report', '阅读报告', '调研报告', '研究报告', '报告', '总结', '摘要', 'markdown', 'report', 'summary'],
  'structure-summary': ['structure-summary', 'PDB', 'AlphaFold', '蛋白结构', '分子结构', '结构查看', 'molecule', 'protein structure'],
  'omics-differential-expression': ['omics-differential-expression', 'omics', '差异表达', '表达矩阵', 'DESeq', 'Scanpy', 'UMAP', '火山图', 'heatmap', 'volcano'],
  'knowledge-graph': ['knowledge-graph', '知识图谱', '关系网络', '网络图', 'graph', 'network'],
  'data-table': ['data-table', 'CSV', 'TSV', '表格文件', '数据表格', 'table artifact'],
};

export function expectedArtifactsForCurrentTurn({
  scenarioId,
  prompt,
  selectedComponentIds = [],
}: {
  scenarioId: ScenarioId;
  prompt: string;
  selectedComponentIds?: string[];
}) {
  const text = normalizeIntentText(prompt);
  const artifacts = new Set<string>();

  if (/\b(research-report|summary-report|markdown-report)\b|阅读报告|调研报告|研究报告|报告|总结|摘要|markdown|\.md\b|report|summary/i.test(text)) {
    artifacts.add('research-report');
  }
  if (/\bpaper-list\b|文献列表|论文列表|paper list/i.test(text) || (
    /检索|搜索|查找|最新|今天|今日|arxiv|pubmed|semantic scholar|google scholar|bioRxiv|medRxiv|search|retrieve|latest|recent/i.test(text)
    && /论文|文献|paper|article|preprint/i.test(text)
  ) || (
    /比较|评估|梳理|review|compare|evaluate/i.test(text)
    && /论文|文献|paper|article|preprint/i.test(text)
  )) {
    artifacts.add('paper-list');
  }
  if (/\bevidence-matrix\b|证据矩阵|证据表|文献证据|证据|evidence table|claim matrix|evidence/i.test(text)) {
    artifacts.add('evidence-matrix');
  }
  if (/\bnotebook-timeline\b|研究记录|实验记录|时间线|timeline|notebook/i.test(text)) {
    artifacts.add('notebook-timeline');
  }
  if (scenarioId === 'structure-exploration' || /structure-summary|PDB|AlphaFold|蛋白结构|分子结构|结构查看|molecule|protein structure/i.test(text)) {
    if (/structure-summary|PDB|AlphaFold|蛋白结构|分子结构|结构查看|molecule|protein structure/i.test(text)) artifacts.add('structure-summary');
  }
  if (scenarioId === 'omics-differential-exploration' || /omics|差异表达|表达矩阵|DESeq|Scanpy|UMAP|火山图|heatmap|volcano/i.test(text)) {
    if (/omics|差异表达|表达矩阵|DESeq|Scanpy|UMAP|火山图|heatmap|volcano/i.test(text)) artifacts.add('omics-differential-expression');
  }
  if (scenarioId === 'biomedical-knowledge-graph' || /knowledge-graph|知识图谱|关系网络|网络图|graph|network/i.test(text)) {
    if (/knowledge-graph|知识图谱|关系网络|网络图|graph|network/i.test(text)) artifacts.add('knowledge-graph');
  }
  if (/\bdata-table\b|CSV|TSV|表格文件|数据表格|table artifact/i.test(text)) {
    artifacts.add('data-table');
  }

  for (const componentId of selectedComponentsForCurrentTurn(prompt, selectedComponentIds)) {
    for (const type of primaryArtifactTypesForComponent(componentId)) artifacts.add(type);
  }

  return orderArtifactsByPrompt(Array.from(artifacts), text);
}

export function selectedComponentsForCurrentTurn(prompt: string, configuredComponentIds: string[] = []) {
  const text = normalizeIntentText(prompt);
  const mentioned = configuredComponentIds.filter((componentId) => componentMentioned(text, componentId));
  const inferred = expectedArtifactsForPromptOnly(text).map((type) => ARTIFACT_COMPONENTS[type]).filter((type): type is string => Boolean(type));
  return uniqueStrings([...mentioned, ...inferred]);
}

function expectedArtifactsForPromptOnly(text: string) {
  const out: string[] = [];
  if (/\b(research-report|summary-report|markdown-report)\b|阅读报告|调研报告|研究报告|报告|总结|摘要|markdown|\.md\b|report|summary/i.test(text)) out.push('research-report');
  if (/\bpaper-list\b|文献列表|论文列表|paper list/i.test(text) || ((/检索|搜索|查找|最新|今天|今日|arxiv|pubmed|semantic scholar|google scholar|bioRxiv|medRxiv|search|retrieve|latest|recent/i.test(text) || /比较|评估|梳理|review|compare|evaluate/i.test(text)) && /论文|文献|paper|article|preprint/i.test(text))) out.push('paper-list');
  if (/\bevidence-matrix\b|证据矩阵|证据表|文献证据|证据|evidence table|claim matrix|evidence/i.test(text)) out.push('evidence-matrix');
  if (/\bnotebook-timeline\b|研究记录|实验记录|时间线|timeline|notebook/i.test(text)) out.push('notebook-timeline');
  if (/structure-summary|PDB|AlphaFold|蛋白结构|分子结构|结构查看|molecule|protein structure/i.test(text)) out.push('structure-summary');
  if (/omics|差异表达|表达矩阵|DESeq|Scanpy|UMAP|火山图|heatmap|volcano/i.test(text)) out.push('omics-differential-expression');
  if (/knowledge-graph|知识图谱|关系网络|网络图|graph|network/i.test(text)) out.push('knowledge-graph');
  if (/\bdata-table\b|CSV|TSV|表格文件|数据表格|table artifact/i.test(text)) out.push('data-table');
  return uniqueStrings(out);
}

function componentMentioned(text: string, componentId: string) {
  const escaped = componentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escaped}\\b`, 'i').test(text)) return true;
  if (componentId === 'report-viewer') return /报告视图|report viewer|报告预览/i.test(text);
  if (componentId === 'paper-card-list') return /文献卡片|论文卡片|paper card/i.test(text);
  if (componentId === 'evidence-matrix') return /证据矩阵|evidence matrix/i.test(text);
  if (componentId === 'notebook-timeline') return /研究记录|时间线|notebook timeline/i.test(text);
  if (componentId === 'execution-unit-table') return /执行单元|execution unit/i.test(text);
  return false;
}

function normalizeIntentText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function primaryArtifactTypesForComponent(componentId: string) {
  const direct = Object.entries(ARTIFACT_COMPONENTS)
    .filter(([, component]) => component === componentId)
    .map(([artifact]) => artifact);
  if (direct.length) return direct;
  const accepted = artifactTypesForComponents([componentId]);
  return accepted.filter((type) => !['graph', 'structure-3d', 'pdb-file', 'mmcif-file'].includes(type));
}

function orderArtifactsByPrompt(types: string[], text: string) {
  return [...types].sort((left, right) => artifactMentionIndex(left, text) - artifactMentionIndex(right, text));
}

function artifactMentionIndex(type: string, text: string) {
  const aliases = ARTIFACT_ALIASES[type] ?? [type];
  const indexes = aliases
    .map((alias) => text.toLowerCase().indexOf(alias.toLowerCase()))
    .filter((index) => index >= 0);
  if (indexes.length) return Math.min(...indexes);
  return 100_000 + Object.keys(ARTIFACT_COMPONENTS).indexOf(type);
}
