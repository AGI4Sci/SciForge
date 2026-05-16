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

const DOMAIN_DEFAULT_COMPONENTS: Record<string, string[]> = {
  literature: ['paper-card-list', 'evidence-matrix', 'execution-unit-table'],
  structure: ['structure-viewer', 'evidence-matrix', 'execution-unit-table'],
  omics: ['point-set-viewer', 'matrix-viewer', 'execution-unit-table'],
  knowledge: ['graph-viewer', 'record-table', 'evidence-matrix', 'execution-unit-table'],
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
  'runtime-context-summary': 'report-viewer',
};

const PREVIEW_KIND_COMPONENTS: Partial<Record<PreviewDescriptorKind, string>> = {
  markdown: 'report-viewer',
  text: 'report-viewer',
  json: 'unknown-artifact-inspector',
  table: 'record-table',
  html: 'report-viewer',
  structure: 'structure-viewer',
};

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
  const incomingComponents = incoming
    .map((slot) => typeof slot.componentId === 'string' ? normalizeUIComponentId(slot.componentId) : undefined)
    .filter((id): id is string => typeof id === 'string' && REGISTERED_COMPONENTS.has(id));
  const componentIds = uniqueStrings([
    ...overrideComponents,
    ...selectedComponents,
    ...(overrideComponents.length || selectedComponents.length ? [] : incomingComponents),
    ...(overrideComponents.length || selectedComponents.length || incomingComponents.length ? [] : DOMAIN_DEFAULT_COMPONENTS[request.skillDomain] ?? []),
    'execution-unit-table',
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
      encoding: isRecord(base.encoding) ? base.encoding : undefined,
      layout: isRecord(base.layout) ? base.layout : undefined,
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
  const artifacts = new Set<string>();
  for (const componentId of selectedViewComponentsForIntent(request.prompt, request.selectedComponentIds)) {
    for (const artifactType of primaryArtifactTypesForComponent(componentId)) {
      if (!artifactTypeMatchesCurrentTurnIntent(artifactType, request.prompt)) continue;
      artifacts.add(artifactType);
    }
  }
  return orderArtifactsByComponentOrder(Array.from(artifacts));
}

function artifactTypeMatchesCurrentTurnIntent(artifactType: string, prompt: string) {
  if (artifactType === 'paper-list') return /\b(?:paper|papers|literature|pubmed|arxiv|citation|bibliography|doi|pmid)\b|文献|论文|引用|书目/i.test(prompt);
  if (artifactType === 'runtime-context-summary') return /runtime[-\s_]?context|context summary|运行上下文|上下文摘要/i.test(prompt);
  return true;
}

export function selectedViewComponentsForIntent(_prompt: string, configuredComponentIds: string[] = []) {
  const configured = normalizeComponentIds(configuredComponentIds);
  return uniqueStrings(configured);
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

function orderArtifactsByComponentOrder(types: string[]) {
  return [...types].sort((left, right) => artifactMentionIndex(left) - artifactMentionIndex(right));
}

function artifactMentionIndex(type: string) {
  return 100_000 + Object.keys(ARTIFACT_COMPONENTS).indexOf(type);
}

function modulePreferred(module: ViewPolicyModule, preferredModuleIds: string[]) {
  return preferredModuleIds.includes(module.moduleId ?? '') || preferredModuleIds.includes(module.componentId);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
