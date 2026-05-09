import {
  normalizeUIComponentId,
  uiComponentCompatibilityAliases,
  uiComponentManifests,
} from '../components';
import type { PreviewDescriptorKind } from '@sciforge-ui/runtime-contract/preview';

export type RuntimeUiManifestPolicyRequest = {
  prompt: string;
  skillDomain: string;
  scenarioDefaultComponents?: string[];
  selectedComponentIds?: string[];
};

export type ArtifactIntentPolicyRequest = {
  scenarioId: string;
  prompt: string;
  selectedComponentIds?: string[];
};

export type RuntimeResultViewSlotsPolicyRequest = {
  primaryArtifactRef?: string;
  primaryArtifactType?: string;
  runtimeResultRef: string;
  priorityStart?: number;
};

export type RepairDiagnosticViewSlotPolicyRequest = {
  skillDomain: string;
  title?: string;
  priority?: number;
};

type ViewPolicyModule = {
  componentId: string;
  moduleId?: string;
  priority?: number;
  acceptsArtifactTypes?: string[];
  outputArtifactTypes?: string[];
  defaultSection?: string;
};

const REGISTERED_COMPONENTS = new Set([
  ...uiComponentManifests.map((manifest) => manifest.componentId),
  ...uiComponentCompatibilityAliases.map((alias) => alias.legacyComponentId),
]);

const COMPONENT_ALIASES: Array<{ id: string; patterns: RegExp[] }> = [
  { id: 'report-viewer', patterns: [/report[-\s]?viewer/i, /research[-\s]?report/i, /报告|总结|系统性整理/i] },
  { id: 'paper-card-list', patterns: [/paper[-\s]?card/i, /paper[-\s]?list/i, /文献卡片|文献列表|论文列表/i] },
  { id: 'structure-viewer', patterns: [/molecule[-\s]?viewer/i, /structure[-\s]?viewer/i, /mol\*/i, /分子|结构查看|蛋白结构/i] },
  { id: 'scientific-plot-viewer', patterns: [/scientific[-\s]?plot/i, /plotly/i, /plot[-\s]?spec/i, /科学绘图|交互图/i] },
  { id: 'point-set-viewer', patterns: [/volcano/i, /火山图/i, /umap/i, /降维/i, /point[-\s]?set/i, /scatter/i] },
  { id: 'matrix-viewer', patterns: [/heatmap/i, /matrix[-\s]?viewer/i, /热图|矩阵/i] },
  { id: 'graph-viewer', patterns: [/network[-\s]?graph/i, /graph[-\s]?viewer/i, /drug[-\s]?target network/i, /knowledge graph/i, /网络图|知识图谱|关系网络/i] },
  { id: 'record-table', patterns: [/data[-\s]?table/i, /record[-\s]?table/i, /\btable\b/i, /blast/i, /alignment hits?/i, /数据表|表格|证据表|知识卡片|比对结果/i] },
  { id: 'sequence-viewer', patterns: [/sequence[-\s]?viewer/i, /fasta|fastq/i, /序列|核酸|蛋白序列/i] },
  { id: 'alignment-viewer', patterns: [/alignment[-\s]?viewer/i, /\bmsa\b/i, /multiple sequence alignment/i, /比对|多序列/i] },
  { id: 'genome-track-viewer', patterns: [/genome[-\s]?track/i, /\bbed\b|\bgff\b|\bvcf\b|\bbam\b/i, /基因组轨道|变异轨道/i] },
  { id: 'image-annotation-viewer', patterns: [/image[-\s]?annotation/i, /microscopy|pathology|gel|blot/i, /图像标注|显微|病理|凝胶|印迹/i] },
  { id: 'spatial-omics-viewer', patterns: [/spatial[-\s]?omics/i, /visium|spatial map/i, /空间组学|组织切片/i] },
  { id: 'time-series-viewer', patterns: [/time[-\s]?series/i, /growth curve|kinetics|longitudinal/i, /时间序列|生长曲线|动力学/i] },
  { id: 'plate-layout-viewer', patterns: [/plate[-\s]?layout/i, /96[-\s]?well|384[-\s]?well|well map/i, /孔板|板图/i] },
  { id: 'model-eval-viewer', patterns: [/model[-\s]?eval/i, /\broc\b|\bpr\b|confusion matrix|calibration/i, /模型评估|混淆矩阵/i] },
  { id: 'prediction-reviewer', patterns: [/prediction[-\s]?review/i, /human[-\s]?in[-\s]?the[-\s]?loop/i, /预测审核|人工确认/i] },
  { id: 'protocol-editor', patterns: [/protocol[-\s]?editor/i, /stepwise protocol|materials/i, /实验方案|操作步骤|protocol/i] },
  { id: 'schema-form-editor', patterns: [/schema[-\s]?form/i, /json schema|parameter form/i, /表单|参数编辑/i] },
  { id: 'comparison-viewer', patterns: [/comparison[-\s]?viewer/i, /artifact diff|schema diff|side[-\s]?by[-\s]?side/i, /对比|差异|diff/i] },
  { id: 'publication-figure-builder', patterns: [/publication[-\s]?figure/i, /figure builder|multi[-\s]?panel|journal figure/i, /投稿图|多面板图/i] },
  { id: 'statistical-annotation-layer', patterns: [/statistical[-\s]?annotation/i, /p[-\s]?value|effect size|confidence interval/i, /统计标注|显著性|置信区间/i] },
  { id: 'evidence-matrix', patterns: [/evidence[-\s]?matrix/i, /证据矩阵|证据表/i] },
  { id: 'execution-unit-table', patterns: [/execution[-\s]?unit/i, /可复现|执行单元/i] },
  { id: 'notebook-timeline', patterns: [/notebook[-\s]?timeline/i, /研究记录|时间线/i] },
  { id: 'unknown-artifact-inspector', patterns: [/inspector/i, /原始\s*json|raw json|日志/i] },
];

const DOMAIN_DEFAULT_COMPONENTS: Record<string, string[]> = {
  literature: ['paper-card-list', 'evidence-matrix', 'execution-unit-table'],
  structure: ['structure-viewer', 'evidence-matrix', 'execution-unit-table'],
  omics: ['point-set-viewer', 'matrix-viewer', 'execution-unit-table'],
  knowledge: ['graph-viewer', 'record-table', 'evidence-matrix', 'execution-unit-table'],
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

const PREVIEW_KIND_COMPONENTS: Partial<Record<PreviewDescriptorKind, string>> = {
  markdown: 'report-viewer',
  text: 'report-viewer',
  json: 'unknown-artifact-inspector',
  table: 'record-table',
  html: 'report-viewer',
  structure: 'structure-viewer',
};

const INTENT_ARTIFACT_RULES: Array<{ artifactType: string; matches: (text: string) => boolean }> = [
  {
    artifactType: 'research-report',
    matches: (text) => /\b(research-report|summary-report|markdown-report)\b|阅读报告|调研报告|研究报告|报告|总结|摘要|markdown|\.md\b|report|summary/i.test(text),
  },
  {
    artifactType: 'paper-list',
    matches: (text) => /\bpaper-list\b|文献列表|论文列表|paper list/i.test(text)
      || (
        /检索|搜索|查找|最新|今天|今日|arxiv|pubmed|semantic scholar|google scholar|bioRxiv|medRxiv|search|retrieve|latest|recent/i.test(text)
        && /论文|文献|paper|article|preprint/i.test(text)
      )
      || (
        /比较|评估|梳理|review|compare|evaluate/i.test(text)
        && /论文|文献|paper|article|preprint/i.test(text)
      ),
  },
  {
    artifactType: 'evidence-matrix',
    matches: (text) => /\bevidence-matrix\b|证据矩阵|证据表|文献证据|证据|evidence table|claim matrix|evidence/i.test(text),
  },
  {
    artifactType: 'notebook-timeline',
    matches: (text) => /\bnotebook-timeline\b|研究记录|实验记录|时间线|timeline|notebook/i.test(text),
  },
  {
    artifactType: 'structure-summary',
    matches: (text) => /structure-summary|PDB|AlphaFold|蛋白结构|分子结构|结构查看|molecule|protein structure/i.test(text),
  },
  {
    artifactType: 'omics-differential-expression',
    matches: (text) => /omics|差异表达|表达矩阵|DESeq|Scanpy|UMAP|火山图|heatmap|volcano/i.test(text),
  },
  {
    artifactType: 'knowledge-graph',
    matches: (text) => /knowledge-graph|知识图谱|关系网络|网络图|graph|network/i.test(text),
  },
  {
    artifactType: 'data-table',
    matches: (text) => /\bdata-table\b|CSV|TSV|表格文件|数据表格|table artifact/i.test(text),
  },
];

const ARTIFACT_INTENT_COMPONENT_EXCLUSIONS = new Set(['graph', 'structure-3d', 'pdb-file', 'mmcif-file']);
const EVIDENCE_ARTIFACT_TYPES = new Set(['evidence-matrix']);

const PRESENTATION_ONLY_COMPONENTS = new Set(['evidence-matrix', 'execution-unit-table', 'notebook-timeline']);
const AUDIT_COMPONENTS = new Set([...PRESENTATION_ONLY_COMPONENTS, 'unknown-artifact-inspector']);
const TABULAR_COMPONENTS = new Set(['record-table', 'data-table']);
const PRIMARY_RESULT_COMPONENTS = new Set([
  'report-viewer',
  'structure-viewer',
  'molecule-viewer',
  'point-set-viewer',
  'volcano-plot',
  'umap-viewer',
  'matrix-viewer',
  'heatmap-viewer',
  'graph-viewer',
  'network-graph',
]);
const DEFAULT_RESULT_COMPONENT_ORDER = [
  'report-viewer',
  'structure-viewer',
  'molecule-viewer',
  'evidence-matrix',
  'paper-card-list',
  'graph-viewer',
  'network-graph',
  'point-set-viewer',
  'matrix-viewer',
  'record-table',
  'data-table',
  'execution-unit-table',
  'notebook-timeline',
  'unknown-artifact-inspector',
];

export const interactiveViewFallbackModuleIds = {
  genericInspector: 'generic-artifact-inspector',
  evidenceMatrix: 'evidence-matrix-panel',
  executionProvenance: 'execution-provenance-table',
} as const;

export const defaultInteractiveViewFallbackAcceptable = ['generic-data-table', interactiveViewFallbackModuleIds.genericInspector];
export const defaultInteractiveViewAcceptanceCriteria = ['primary result visible', 'artifact binding validated', 'fallback explains missing fields'];
export const interactiveViewFallbackBindingStatus = 'fallback';

export function composeRuntimeUiManifestSlots(
  incoming: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  request: RuntimeUiManifestPolicyRequest,
): Array<Record<string, unknown>> {
  const overrideComponents = normalizeComponentIds(request.scenarioDefaultComponents ?? []).filter((id) => REGISTERED_COMPONENTS.has(id));
  const selectedComponents = normalizeComponentIds(request.selectedComponentIds ?? []).filter((id) => REGISTERED_COMPONENTS.has(id));
  const promptComponents = componentsRequestedByPrompt(request.prompt);
  const incomingComponents = incoming
    .map((slot) => typeof slot.componentId === 'string' ? normalizeUIComponentId(slot.componentId) : undefined)
    .filter((id): id is string => typeof id === 'string' && REGISTERED_COMPONENTS.has(id));
  const componentIds = uniqueStrings([
    ...overrideComponents,
    ...selectedComponents,
    ...promptComponents,
    ...(overrideComponents.length || selectedComponents.length || promptComponents.length ? [] : incomingComponents),
    ...(overrideComponents.length || selectedComponents.length || promptComponents.length || incomingComponents.length ? [] : DOMAIN_DEFAULT_COMPONENTS[request.skillDomain] ?? []),
    ...(componentNegated(request.prompt, 'execution-unit-table') ? [] : ['execution-unit-table']),
  ]).slice(0, 8);
  const sourceByComponent = new Map(incoming.map((slot) => [normalizeUIComponentId(String(slot.componentId || '')), slot]));
  return componentIds.map((componentId, index) => {
    const base = sourceByComponent.get(componentId) ?? {};
    return {
      ...base,
      componentId,
      title: typeof base.title === 'string' && base.title.trim() ? base.title : titleForComponent(componentId),
      artifactRef: typeof base.artifactRef === 'string' && base.artifactRef.trim()
        ? base.artifactRef
        : inferArtifactRef(componentId, artifacts),
      priority: typeof base.priority === 'number' ? base.priority : index + 1,
      encoding: isRecord(base.encoding) ? base.encoding : inferEncoding(request.prompt, componentId),
      layout: isRecord(base.layout) ? base.layout : inferLayout(request.prompt),
    };
  });
}

export function runtimeResultViewSlotsPolicy(request: RuntimeResultViewSlotsPolicyRequest): Array<Record<string, unknown>> {
  const priorityStart = typeof request.priorityStart === 'number' ? request.priorityStart : 1;
  const slots: Array<Record<string, unknown>> = [];
  const primaryComponent = request.primaryArtifactType ? ARTIFACT_COMPONENTS[request.primaryArtifactType] : undefined;
  if (request.primaryArtifactRef && primaryComponent) {
    slots.push({
      componentId: primaryComponent,
      artifactRef: request.primaryArtifactRef,
      priority: priorityStart,
    });
  }
  slots.push({
    componentId: 'execution-unit-table',
    artifactRef: request.runtimeResultRef,
    priority: priorityStart + slots.length,
  });
  return slots;
}

export function preferredInteractiveViewComponentForPreviewKind(kind: PreviewDescriptorKind) {
  return PREVIEW_KIND_COMPONENTS[kind] ?? 'unknown-artifact-inspector';
}

export function reportRuntimeResultViewSlots(reportArtifactRef: string, runtimeResultRef: string) {
  return runtimeResultViewSlotsPolicy({
    primaryArtifactRef: reportArtifactRef,
    primaryArtifactType: 'research-report',
    runtimeResultRef,
  });
}

export function repairDiagnosticViewSlotPolicy(request: RepairDiagnosticViewSlotPolicyRequest): Record<string, unknown> {
  return {
    componentId: 'execution-unit-table',
    title: request.title ?? 'Execution units',
    artifactRef: `${request.skillDomain}-runtime-result`,
    priority: request.priority ?? 1,
  };
}

export function expectedArtifactTypesForIntent(request: ArtifactIntentPolicyRequest) {
  const text = normalizeIntentText(request.prompt);
  const artifacts = new Set<string>();
  for (const rule of INTENT_ARTIFACT_RULES) {
    if (rule.matches(text)) artifacts.add(rule.artifactType);
  }
  for (const componentId of selectedViewComponentsForIntent(request.prompt, request.selectedComponentIds)) {
    for (const artifactType of primaryArtifactTypesForComponent(componentId)) artifacts.add(artifactType);
  }
  return orderArtifactsByPrompt(Array.from(artifacts), text);
}

export function selectedViewComponentsForIntent(prompt: string, configuredComponentIds: string[] = []) {
  const text = normalizeIntentText(prompt);
  const configured = normalizeComponentIds(configuredComponentIds);
  const mentioned = configured.filter((componentId) => componentMentioned(text, componentId));
  const inferred = expectedArtifactsForPromptOnly(text)
    .map((artifactType) => ARTIFACT_COMPONENTS[artifactType])
    .filter((componentId): componentId is string => Boolean(componentId));
  return uniqueStrings([...mentioned, ...inferred]);
}

export type MinimalInteractiveToolPayloadExampleRequest = {
  skillDomain: string;
  uiState?: unknown;
  selectedComponentIds?: string[];
  expectedArtifactTypes?: string[];
};

export function minimalValidInteractiveToolPayloadExample(request: MinimalInteractiveToolPayloadExampleRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const selectedComponent = uniqueStrings([
    ...toStringList(request.selectedComponentIds),
    ...toStringList(uiState.selectedComponentIds),
  ]).find(Boolean);
  const expectedArtifact = uniqueStrings([
    ...toStringList(request.expectedArtifactTypes),
    ...toStringList(uiState.expectedArtifactTypes),
  ]).find(Boolean);
  const artifactType = expectedArtifact || `${request.skillDomain}-runtime-result`;
  const artifactId = expectedArtifact || `${request.skillDomain}-runtime-result`;
  return {
    message: 'Concise user-visible result or honest failure summary.',
    confidence: 0.5,
    claimType: 'evidence-summary',
    evidenceLevel: 'workspace-task',
    reasoningTrace: 'Brief audit of sources/tools/retries used by the task.',
    claims: [],
    displayIntent: { primaryView: selectedComponent || 'generic-artifact-inspector' },
    uiManifest: [
      { componentId: selectedComponent || 'unknown-artifact-inspector', artifactRef: artifactId, priority: 1 },
    ],
    executionUnits: [
      { id: `${request.skillDomain}-task`, tool: 'agentserver.generated.task', status: 'done' },
    ],
    artifacts: [
      { id: artifactId, type: artifactType, data: { summary: 'Result content goes here.', rows: [] } },
    ],
    objectReferences: [],
  };
}

export function interactiveViewModuleAcceptsArtifact(module: ViewPolicyModule, artifactType?: string) {
  const accepted = module.acceptsArtifactTypes ?? [];
  if (!artifactType) return accepted.includes('*');
  return accepted.includes('*') || accepted.includes(artifactType);
}

export function compareInteractiveViewModulesForArtifact(
  left: ViewPolicyModule,
  right: ViewPolicyModule,
  artifactType?: string,
  preferredModuleIds: string[] = [],
) {
  const leftPreferred = modulePreferred(left, preferredModuleIds) ? 0 : 1;
  const rightPreferred = modulePreferred(right, preferredModuleIds) ? 0 : 1;
  if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
  const leftAccepts = interactiveViewModuleAcceptsArtifact(left, artifactType) ? 0 : 1;
  const rightAccepts = interactiveViewModuleAcceptsArtifact(right, artifactType) ? 0 : 1;
  if (leftAccepts !== rightAccepts) return leftAccepts - rightAccepts;
  return (left.priority ?? 99) - (right.priority ?? 99);
}

export function isPrimaryInteractiveResultComponent(componentId: string) {
  return PRIMARY_RESULT_COMPONENTS.has(normalizeUIComponentId(componentId));
}

export function interactiveViewComponentAllowsMissingArtifact(componentId: string) {
  return PRESENTATION_ONLY_COMPONENTS.has(normalizeUIComponentId(componentId));
}

export function isAuditOnlyInteractiveViewComponent(componentId: string) {
  return AUDIT_COMPONENTS.has(normalizeUIComponentId(componentId));
}

export function isUnknownArtifactInspectorComponent(componentId: string) {
  return normalizeUIComponentId(componentId) === 'unknown-artifact-inspector';
}

export function isTabularInteractiveViewComponent(componentId: string) {
  return TABULAR_COMPONENTS.has(normalizeUIComponentId(componentId));
}

export function isExecutionInteractiveViewComponent(componentId: string) {
  return normalizeUIComponentId(componentId) === 'execution-unit-table';
}

export function isEvidenceInteractiveViewComponent(componentId: string) {
  return normalizeUIComponentId(componentId) === 'evidence-matrix';
}

export function isEvidenceInteractiveArtifactType(artifactType: string) {
  return EVIDENCE_ARTIFACT_TYPES.has(artifactType);
}

export function isNotebookInteractiveViewComponent(componentId: string) {
  return normalizeUIComponentId(componentId) === 'notebook-timeline';
}

export function interactiveViewComponentRank(componentId: string) {
  const index = DEFAULT_RESULT_COMPONENT_ORDER.indexOf(normalizeUIComponentId(componentId));
  return index === -1 ? 99 : index;
}

export function componentMatchesInteractiveViewFocus(componentId: string, focusMode: 'all' | 'visual' | 'evidence' | 'execution' | 'results') {
  if (focusMode === 'all') return true;
  if (focusMode === 'evidence') return isEvidenceInteractiveViewComponent(componentId);
  if (focusMode === 'execution') return isExecutionInteractiveViewComponent(componentId);
  return isPrimaryInteractiveResultComponent(componentId);
}

function componentsRequestedByPrompt(prompt: string) {
  return COMPONENT_ALIASES
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(prompt)))
    .filter((entry) => !componentNegated(prompt, entry.id))
    .map((entry) => normalizeUIComponentId(entry.id));
}

function expectedArtifactsForPromptOnly(text: string) {
  return INTENT_ARTIFACT_RULES
    .filter((rule) => rule.matches(text))
    .map((rule) => rule.artifactType);
}

function componentMentioned(text: string, componentId: string) {
  if (componentIdMentioned(text, componentId)) return true;
  return COMPONENT_ALIASES
    .filter((entry) => normalizeUIComponentId(entry.id) === normalizeUIComponentId(componentId))
    .some((entry) => entry.patterns.some((pattern) => pattern.test(text)));
}

function componentIdMentioned(text: string, componentId: string) {
  const escaped = escapeRegExp(componentId);
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function primaryArtifactTypesForComponent(componentId: string) {
  const normalized = normalizeUIComponentId(componentId);
  const direct = Object.entries(ARTIFACT_COMPONENTS)
    .filter(([, component]) => normalizeUIComponentId(component) === normalized)
    .map(([artifact]) => artifact);
  if (direct.length) return direct;
  const manifestTypes = uiComponentManifests
    .filter((manifest) => normalizeUIComponentId(manifest.componentId) === normalized)
    .flatMap((manifest) => manifest.outputArtifactTypes ?? []);
  return uniqueStrings(manifestTypes).filter((type) => !ARTIFACT_INTENT_COMPONENT_EXCLUSIONS.has(type));
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

function modulePreferred(module: ViewPolicyModule, preferredModuleIds: string[]) {
  return preferredModuleIds.includes(module.moduleId ?? '') || preferredModuleIds.includes(module.componentId);
}

function componentNegated(prompt: string, componentId: string) {
  const labels: Record<string, string[]> = {
    'paper-card-list': ['paper', '文献', '论文'],
    'molecule-viewer': ['molecule', 'structure', '结构', '分子'],
    'structure-viewer': ['molecule', 'structure', '结构', '分子'],
    'scientific-plot-viewer': ['plotly', 'plot', '科学绘图', '交互图'],
    'volcano-plot': ['volcano', '火山图'],
    'point-set-viewer': ['volcano', 'umap', 'point set', 'scatter', '火山图', '降维'],
    'heatmap-viewer': ['heatmap', '热图'],
    'matrix-viewer': ['heatmap', 'matrix', '热图', '矩阵'],
    'umap-viewer': ['umap'],
    'network-graph': ['network', '网络图', '知识图谱'],
    'graph-viewer': ['network', 'graph', '网络图', '知识图谱'],
    'data-table': ['table', '表格', '数据表'],
    'record-table': ['table', 'record table', '表格', '数据表'],
    'sequence-viewer': ['sequence', '序列'],
    'alignment-viewer': ['alignment', '比对'],
    'genome-track-viewer': ['genome track', '基因组轨道'],
    'image-annotation-viewer': ['image annotation', '图像标注'],
    'spatial-omics-viewer': ['spatial omics', '空间组学'],
    'time-series-viewer': ['time series', '时间序列'],
    'plate-layout-viewer': ['plate layout', '孔板'],
    'model-eval-viewer': ['model eval', '模型评估'],
    'prediction-reviewer': ['prediction review', '预测审核'],
    'protocol-editor': ['protocol', '实验方案'],
    'schema-form-editor': ['schema form', '表单'],
    'comparison-viewer': ['comparison', '对比'],
    'publication-figure-builder': ['publication figure', '投稿图'],
    'statistical-annotation-layer': ['statistical annotation', '统计标注'],
    'evidence-matrix': ['evidence matrix', '证据矩阵'],
    'execution-unit-table': ['execution unit', '执行单元', '可复现'],
    'notebook-timeline': ['timeline', 'notebook', '时间线', '研究记录'],
  };
  return (labels[componentId] ?? []).some((label) => {
    const escaped = escapeRegExp(label);
    return new RegExp(`(?:不需要|不要|无需|\\bwithout\\b|\\bno\\b)[^。；;,.，\\n]{0,32}${escaped}`, 'i').test(prompt)
      || new RegExp(`${escaped}[^。；;,.，\\n]{0,16}(?:不需要|不要|无需|\\bwithout\\b|\\bno\\b)`, 'i').test(prompt);
  });
}

function inferArtifactRef(componentId: string, artifacts: Array<Record<string, unknown>>) {
  if (componentId === 'evidence-matrix' || componentId === 'execution-unit-table' || componentId === 'notebook-timeline') {
    return firstArtifactRef(artifacts);
  }
  const targetType = componentTargetType(componentId, artifacts);
  if (targetType === 'research-report') return 'research-report';
  const direct = artifacts.find((artifact) => artifact.type === targetType || artifact.id === targetType);
  return refForArtifact(direct) ?? firstArtifactRef(artifacts);
}

function componentTargetType(componentId: string, artifacts: Array<Record<string, unknown>>) {
  if (componentId === 'paper-card-list') return 'paper-list';
  if (componentId === 'report-viewer') return 'research-report';
  if (componentId === 'structure-viewer') return 'structure-summary';
  if (componentId === 'scientific-plot-viewer') return 'plot-spec';
  if (componentId === 'sequence-viewer') return 'sequence';
  if (componentId === 'alignment-viewer') return 'sequence-alignment';
  if (componentId === 'genome-track-viewer') return 'genome-track';
  if (componentId === 'image-annotation-viewer') return 'image-annotation';
  if (componentId === 'spatial-omics-viewer') return 'spatial-map';
  if (componentId === 'time-series-viewer') return 'time-series';
  if (componentId === 'plate-layout-viewer') return 'plate-layout';
  if (componentId === 'model-eval-viewer') return 'model-artifact';
  if (componentId === 'prediction-reviewer') return 'prediction-set';
  if (componentId === 'protocol-editor') return 'protocol';
  if (componentId === 'schema-form-editor') return 'editable-design';
  if (componentId === 'comparison-viewer') return 'artifact-diff';
  if (componentId === 'publication-figure-builder') return 'figure-spec';
  if (componentId === 'statistical-annotation-layer') return 'statistical-result';
  if (componentId === 'point-set-viewer' || componentId === 'matrix-viewer') return 'omics-differential-expression';
  if (componentId === 'graph-viewer') return 'knowledge-graph';
  if (componentId === 'record-table') {
    return artifacts.find((artifact) => artifact.type === 'sequence-alignment') ? 'sequence-alignment' : 'knowledge-graph';
  }
  return undefined;
}

function firstArtifactRef(artifacts: Array<Record<string, unknown>>) {
  return refForArtifact(artifacts[0]);
}

function refForArtifact(artifact?: Record<string, unknown>) {
  if (!artifact) return undefined;
  return typeof artifact.id === 'string' ? artifact.id : typeof artifact.type === 'string' ? artifact.type : undefined;
}

function inferEncoding(prompt: string, componentId: string) {
  const encoding: Record<string, unknown> = {};
  const colorBy = prompt.match(/(?:colorBy|按)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*(?:着色|color)/i)?.[1];
  const splitBy = prompt.match(/(?:splitBy|按)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*(?:分组|拆分|split|facet)/i)?.[1];
  const highlight = prompt.match(/(?:highlight|高亮|标记)\s*([A-Za-z0-9_,\-\s]+)/i)?.[1];
  if (colorBy && (componentId === 'point-set-viewer' || componentId === 'graph-viewer' || componentId === 'spatial-omics-viewer' || componentId === 'plate-layout-viewer')) encoding.colorBy = colorBy;
  if (splitBy) encoding.splitBy = splitBy;
  if (highlight) encoding.highlightSelection = highlight.split(/[\s,，]+/).filter(Boolean).slice(0, 12);
  return Object.keys(encoding).length ? encoding : undefined;
}

function inferLayout(prompt: string) {
  if (/side[-\s]?by[-\s]?side|并排|对比/.test(prompt)) return { mode: 'side-by-side', columns: 2 };
  if (/grid|网格/.test(prompt)) return { mode: 'grid', columns: 2 };
  return undefined;
}

function titleForComponent(componentId: string) {
  const titles: Record<string, string> = {
    'paper-card-list': '文献卡片',
    'molecule-viewer': '分子结构查看器',
    'structure-viewer': '结构查看器',
    'scientific-plot-viewer': '科学绘图',
    'volcano-plot': '火山图',
    'point-set-viewer': '点集视图',
    'heatmap-viewer': '热图',
    'matrix-viewer': '矩阵视图',
    'umap-viewer': 'UMAP',
    'network-graph': '知识网络',
    'graph-viewer': '图谱视图',
    'data-table': '数据表',
    'record-table': '记录表',
    'sequence-viewer': '序列查看器',
    'alignment-viewer': '序列比对',
    'genome-track-viewer': '基因组轨道',
    'image-annotation-viewer': '图像标注',
    'spatial-omics-viewer': '空间组学',
    'time-series-viewer': '时间序列',
    'plate-layout-viewer': '孔板布局',
    'model-eval-viewer': '模型评估',
    'prediction-reviewer': '预测审核',
    'protocol-editor': '实验方案编辑器',
    'schema-form-editor': 'Schema 表单',
    'comparison-viewer': 'Artifact 对比',
    'publication-figure-builder': '投稿图构建器',
    'statistical-annotation-layer': '统计标注层',
    'evidence-matrix': '证据矩阵',
    'execution-unit-table': '可复现执行单元',
    'notebook-timeline': '研究记录',
    'unknown-artifact-inspector': 'Artifact Inspector',
  };
  return titles[componentId] ?? componentId;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeComponentIds(values: string[]) {
  return uniqueStrings(values.map(normalizeUIComponentId));
}

function normalizeIntentText(value: string) {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
