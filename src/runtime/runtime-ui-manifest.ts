import type { GatewayRequest } from './runtime-types.js';

const REGISTERED_COMPONENTS = new Set([
  'report-viewer',
  'paper-card-list',
  'molecule-viewer',
  'scientific-plot-viewer',
  'volcano-plot',
  'heatmap-viewer',
  'umap-viewer',
  'network-graph',
  'data-table',
  'record-table',
  'graph-viewer',
  'point-set-viewer',
  'matrix-viewer',
  'structure-viewer',
  'sequence-viewer',
  'alignment-viewer',
  'genome-track-viewer',
  'image-annotation-viewer',
  'spatial-omics-viewer',
  'time-series-viewer',
  'plate-layout-viewer',
  'model-eval-viewer',
  'prediction-reviewer',
  'protocol-editor',
  'schema-form-editor',
  'comparison-viewer',
  'publication-figure-builder',
  'statistical-annotation-layer',
  'evidence-matrix',
  'execution-unit-table',
  'notebook-timeline',
  'unknown-artifact-inspector',
]);

const COMPONENT_ID_ALIASES: Record<string, string> = {
  'data-table': 'record-table',
  'network-graph': 'graph-viewer',
  'volcano-plot': 'point-set-viewer',
  'umap-viewer': 'point-set-viewer',
  'heatmap-viewer': 'matrix-viewer',
  'molecule-viewer': 'structure-viewer',
  'molecule-viewer-3d': 'structure-viewer',
};

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

export function composeRuntimeUiManifest(
  incoming: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  request: Pick<GatewayRequest, 'prompt' | 'skillDomain' | 'uiState' | 'selectedComponentIds'>,
): Array<Record<string, unknown>> {
  const override = isRecord(request.uiState?.scenarioOverride) ? request.uiState.scenarioOverride : undefined;
  const overrideComponents = normalizeComponentIds(toStringList(override?.defaultComponents)).filter((id) => REGISTERED_COMPONENTS.has(id));
  const selectedComponents = normalizeComponentIds(selectedComponentIdsForRequest(request)).filter((id) => REGISTERED_COMPONENTS.has(id));
  const promptComponents = componentsRequestedByPrompt(request.prompt);
  const incomingComponents = incoming
    .map((slot) => typeof slot.componentId === 'string' ? normalizeComponentId(slot.componentId) : undefined)
    .filter((id): id is string => typeof id === 'string' && REGISTERED_COMPONENTS.has(id));
  const componentIds = uniqueStrings([
    ...overrideComponents,
    ...selectedComponents,
    ...promptComponents,
    ...(overrideComponents.length || selectedComponents.length || promptComponents.length ? [] : incomingComponents),
    ...(overrideComponents.length || selectedComponents.length || promptComponents.length || incomingComponents.length ? [] : DOMAIN_DEFAULT_COMPONENTS[request.skillDomain] ?? []),
    ...(componentNegated(request.prompt, 'execution-unit-table') ? [] : ['execution-unit-table']),
  ]).slice(0, 8);
  const sourceByComponent = new Map(incoming.map((slot) => [normalizeComponentId(String(slot.componentId || '')), slot]));
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

function selectedComponentIdsForRequest(request: Pick<GatewayRequest, 'selectedComponentIds' | 'uiState'>) {
  return uniqueStrings([
    ...(request.selectedComponentIds ?? []),
    ...toStringList(request.uiState?.selectedComponentIds),
  ]);
}

function componentsRequestedByPrompt(prompt: string) {
  return COMPONENT_ALIASES
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(prompt)))
    .filter((entry) => !componentNegated(prompt, entry.id))
    .map((entry) => normalizeComponentId(entry.id));
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

function normalizeComponentIds(values: string[]) {
  return uniqueStrings(values.map(normalizeComponentId));
}

function normalizeComponentId(value: string) {
  return COMPONENT_ID_ALIASES[value] ?? value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
