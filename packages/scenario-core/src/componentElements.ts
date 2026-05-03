import type { UIComponentElement } from './elementTypes';
import { uiComponentManifests } from '../../ui-components';

const componentArtifactTypes: Record<string, string[]> = uiComponentManifests.reduce<Record<string, string[]>>((acc, module) => {
  const current = acc[module.componentId] ?? [];
  acc[module.componentId] = Array.from(new Set([...current, ...module.acceptsArtifactTypes]));
  return acc;
}, {});

componentArtifactTypes['data-table'] = componentArtifactTypes['record-table'] ?? componentArtifactTypes['data-table'] ?? [];
componentArtifactTypes['network-graph'] = componentArtifactTypes['graph-viewer'] ?? componentArtifactTypes['network-graph'] ?? [];
componentArtifactTypes['volcano-plot'] = componentArtifactTypes['point-set-viewer'] ?? componentArtifactTypes['volcano-plot'] ?? [];
componentArtifactTypes['umap-viewer'] = componentArtifactTypes['point-set-viewer'] ?? componentArtifactTypes['umap-viewer'] ?? [];
componentArtifactTypes['heatmap-viewer'] = componentArtifactTypes['matrix-viewer'] ?? componentArtifactTypes['heatmap-viewer'] ?? [];
componentArtifactTypes['molecule-viewer'] = componentArtifactTypes['structure-viewer'] ?? componentArtifactTypes['molecule-viewer'] ?? [];
componentArtifactTypes['molecule-viewer-3d'] = componentArtifactTypes['structure-viewer'] ?? componentArtifactTypes['molecule-viewer'] ?? [];

function acceptedArtifactTypesForComponent(componentId: string) {
  return componentArtifactTypes[componentId] ?? [];
}

const builtInUIComponentElements: UIComponentElement[] = [
  {
    id: 'component.report-viewer',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Report viewer',
    description: 'Render structured markdown or sectioned research-report artifacts.',
    source: 'built-in',
    componentId: 'report-viewer',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('report-viewer'),
    requiredFields: ['markdown'],
    emptyState: {
      title: '等待 research-report',
      detail: '报告视图需要 research-report artifact，至少包含 markdown 或 sections 字段；可由 AgentServer/native backend 在运行期生成。',
    },
    recoverActions: ['run-current-scenario', 'repair-task:report-generation', 'fallback-component:unknown-artifact-inspector'],
    viewParams: ['filter', 'limit'],
    interactionEvents: ['open-ref', 'select-section'],
    roleDefaults: ['experimental-biologist', 'pi'],
    fallback: 'unknown-artifact-inspector',
  },
  {
    id: 'component.paper-card-list',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Paper cards',
    description: 'Render PubMed/Semantic Scholar style paper-list artifacts as evidence cards.',
    source: 'built-in',
    componentId: 'paper-card-list',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('paper-card-list'),
    requiredFields: ['papers'],
    emptyState: {
      title: '等待真实 paper-list',
      detail: '文献卡片需要 paper-list artifact 的 papers 字段；请运行 literature.pubmed_search 或导入包含 paper-list 的 package。',
    },
    recoverActions: ['run-skill:literature.pubmed_search', 'inspect-artifact-schema:paper-list', 'import-package:literature'],
    viewParams: ['filter', 'sort', 'limit', 'colorBy'],
    interactionEvents: ['select-paper', 'select-target'],
    roleDefaults: ['experimental-biologist', 'pi'],
    fallback: 'record-table',
  },
  {
    id: 'component.structure-viewer',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Structure viewer',
    description: 'Render structure-summary and structure-3d artifacts with declared refs and metadata.',
    source: 'built-in',
    componentId: 'structure-viewer',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('structure-viewer'),
    requiredFields: [],
    emptyState: {
      title: '等待真实 structure-summary',
      detail: '结构查看器需要 structure artifact，至少包含 dataRef、path、PDB/UniProt 字段之一；没有坐标时不会加载 demo 结构。',
    },
    recoverActions: ['run-skill:structure.rcsb_latest_or_entry', 'add-field:dataRef', 'add-field:pdb_id', 'inspect-artifact-schema:structure-summary'],
    viewParams: ['colorBy', 'highlightSelection', 'syncViewport'],
    interactionEvents: ['highlight-residue', 'select-chain'],
    roleDefaults: ['experimental-biologist', 'bioinformatician'],
    fallback: 'unknown-artifact-inspector',
  },
  {
    id: 'component.point-set-viewer',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Point set viewer',
    description: 'Render differential-expression, UMAP, PCA, t-SNE, and embedding point sets.',
    source: 'built-in',
    componentId: 'point-set-viewer',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('point-set-viewer'),
    requiredFields: ['points'],
    emptyState: {
      title: '等待真实 point-set',
      detail: '点集视图需要 points、umap 或 Plotly scatter trace；请先运行差异表达或降维 skill。',
    },
    recoverActions: ['run-skill:omics.differential_expression', 'map-fields:logFC,pValue,x,y', 'fallback-component:record-table'],
    viewParams: ['colorBy', 'filter', 'x', 'y', 'label'],
    interactionEvents: ['select-gene'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallback: 'record-table',
  },
  {
    id: 'component.matrix-viewer',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Matrix viewer',
    description: 'Render numeric matrix, heatmap, similarity, attention, and confusion-matrix payloads.',
    source: 'built-in',
    componentId: 'matrix-viewer',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('matrix-viewer'),
    requiredFields: ['heatmap'],
    emptyState: {
      title: '等待真实 heatmap matrix',
      detail: '热图需要 heatmap.matrix 或 matrix 字段；当前 artifact 不满足矩阵视图输入契约。',
    },
    recoverActions: ['run-skill:omics.differential_expression', 'add-field:heatmap.matrix', 'fallback-component:record-table'],
    viewParams: ['colorBy', 'splitBy', 'facetBy'],
    interactionEvents: ['select-gene-set'],
    roleDefaults: ['bioinformatician'],
    fallback: 'record-table',
  },
  {
    id: 'component.graph-viewer',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Graph viewer',
    description: 'Render generic graph nodes and edges, including knowledge graphs and pathways.',
    source: 'built-in',
    componentId: 'graph-viewer',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('graph-viewer'),
    requiredFields: ['nodes', 'edges'],
    emptyState: {
      title: '等待真实 knowledge graph',
      detail: '网络图需要 knowledge-graph artifact 的 nodes/edges；请运行知识图谱 skill 或导入匹配 artifact。',
    },
    recoverActions: ['run-skill:knowledge.uniprot_chembl_lookup', 'add-fields:nodes,edges', 'fallback-component:record-table'],
    viewParams: ['colorBy', 'filter', 'highlightSelection'],
    interactionEvents: ['select-node', 'select-edge'],
    roleDefaults: ['experimental-biologist', 'pi'],
    fallback: 'record-table',
  },
  {
    id: 'component.evidence-matrix',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Evidence matrix',
    description: 'Render session claims and evidence levels.',
    source: 'built-in',
    componentId: 'evidence-matrix',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('evidence-matrix'),
    requiredFields: [],
    emptyState: {
      title: '等待 claims / evidence',
      detail: '证据矩阵需要 session claims 或可映射的 evidence 字段；运行场景后会从结果中抽取。',
    },
    recoverActions: ['run-current-scenario', 'inspect-claims', 'repair-task:evidence-extraction'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['select-claim'],
    roleDefaults: ['experimental-biologist', 'pi', 'clinical'],
    fallback: 'unknown-artifact-inspector',
  },
  {
    id: 'component.execution-unit-table',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Execution units',
    description: 'Render reproducible execution units, logs, code refs, and statuses.',
    source: 'built-in',
    componentId: 'execution-unit-table',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('execution-unit-table'),
    requiredFields: [],
    emptyState: {
      title: '等待 ExecutionUnit',
      detail: '执行单元表需要 runtime 写入 tool、params、status、hash 和输出引用；没有执行记录时保持空状态。',
    },
    recoverActions: ['rerun-current-scenario', 'inspect-runtime-route', 'export-diagnostics'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['open-code-ref', 'open-log-ref'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallback: 'unknown-artifact-inspector',
  },
  {
    id: 'component.notebook-timeline',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Notebook timeline',
    description: 'Render the structured research notebook timeline.',
    source: 'built-in',
    componentId: 'notebook-timeline',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('notebook-timeline'),
    requiredFields: [],
    emptyState: {
      title: '等待研究记录',
      detail: '研究记录来自 run、artifact、handoff 和人工决策事件；运行或导入后会自动沉淀。',
    },
    recoverActions: ['run-current-scenario', 'create-timeline-event', 'import-research-bundle'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['select-timeline-event'],
    roleDefaults: ['experimental-biologist', 'pi'],
    fallback: 'unknown-artifact-inspector',
  },
  {
    id: 'component.record-table',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Record table',
    description: 'Generic row and record artifact renderer.',
    source: 'built-in',
    componentId: 'record-table',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('record-table'),
    requiredFields: [],
    emptyState: {
      title: '等待可表格化 artifact rows',
      detail: '数据表需要 rows、papers、nodes 或其他数组字段；若 schema 不匹配，请打开 Artifact Inspector。',
    },
    recoverActions: ['inspect-artifact', 'map-array-field:rows', 'repair-ui-plan'],
    viewParams: ['filter', 'sort', 'limit', 'group'],
    interactionEvents: ['select-row'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallback: 'unknown-artifact-inspector',
  },
  {
    id: 'component.unknown-artifact-inspector',
    kind: 'ui-component',
    version: '1.0.0',
    label: 'Unknown artifact inspector',
    description: 'Safe fallback for JSON, table, file, and log previews.',
    source: 'built-in',
    componentId: 'unknown-artifact-inspector',
    acceptsArtifactTypes: acceptedArtifactTypesForComponent('unknown-artifact-inspector'),
    requiredFields: [],
    emptyState: {
      title: '等待任意 runtime artifact',
      detail: '通用 inspector 会展示 JSON、表格、文件和日志引用；当前 slot 还没有可检查的 artifact。',
    },
    recoverActions: ['run-current-scenario', 'inspect-ui-manifest', 'import-matching-artifact'],
    viewParams: ['filter', 'sort', 'limit'],
    interactionEvents: ['open-ref'],
    roleDefaults: ['bioinformatician', 'pi'],
    fallback: 'unknown-artifact-inspector',
  },
];

const builtInComponentIds = new Set(builtInUIComponentElements.map((component) => component.componentId));
const componentIdByModuleId = new Map(uiComponentManifests.map((manifest) => [manifest.moduleId, manifest.componentId]));

const manifestBackedComponentElements: UIComponentElement[] = uiComponentManifests
  .filter((manifest) => !builtInComponentIds.has(manifest.componentId))
  .map((manifest) => ({
    id: `component.${manifest.componentId}`,
    kind: 'ui-component',
    version: manifest.version,
    label: manifest.title,
    description: manifest.description,
    source: 'package',
    componentId: manifest.componentId,
    acceptsArtifactTypes: acceptedArtifactTypesForComponent(manifest.componentId),
    requiredFields: manifest.requiredFields ?? [],
    emptyState: {
      title: `等待 ${manifest.acceptsArtifactTypes[0] ?? 'runtime artifact'}`,
      detail: `${manifest.title} 是 T080 manifest skeleton；需要匹配 ${manifest.acceptsArtifactTypes.join('/')} artifact，当前阶段不加载重型 renderer。`,
    },
    recoverActions: [
      'run-current-scenario',
      `inspect-artifact-schema:${manifest.acceptsArtifactTypes[0] ?? 'runtime-artifact'}`,
      `fallback-component:${fallbackComponentIdForManifest(manifest.fallbackModuleIds?.[0])}`,
    ],
    viewParams: manifest.viewParams ?? [],
    interactionEvents: manifest.interactionEvents ?? [],
    roleDefaults: manifest.roleDefaults ?? [],
    fallback: fallbackComponentIdForManifest(manifest.fallbackModuleIds?.[0]),
  }));

export const uiComponentElements: UIComponentElement[] = [
  ...builtInUIComponentElements,
  ...manifestBackedComponentElements,
];

function fallbackComponentIdForManifest(fallbackModuleId?: string) {
  if (!fallbackModuleId) return 'unknown-artifact-inspector';
  return componentIdByModuleId.get(fallbackModuleId) ?? fallbackModuleId;
}
