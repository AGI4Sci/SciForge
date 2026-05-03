import type { ScenarioId } from './data';
import type { UIManifestSlot } from './domain';

export type ScenarioRuntimeMode = 'scenario-server';
export type SkillDomain = 'literature' | 'structure' | 'omics' | 'knowledge';

export interface ScenarioInputField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'multiselect';
  required?: boolean;
  options?: string[];
  defaultValue?: string | number | string[];
}

export interface ArtifactSchemaField {
  key: string;
  type: 'string' | 'number' | 'string[]' | 'object[]' | 'object';
  required?: boolean;
  description: string;
}

export interface ScenarioArtifactSchema {
  type: string;
  description: string;
  fields: ArtifactSchemaField[];
  consumers: ScenarioId[];
}

export interface ScenarioScopeDeclaration {
  supportedTasks: string[];
  requiredInputs: string[];
  unsupportedTasks: string[];
  handoffTargets: ScenarioId[];
  phaseLimitations: string[];
}

export interface ScenarioSpec {
  id: ScenarioId;
  title: string;
  description: string;
  source: 'built-in' | 'markdown-import' | 'workspace';
  skillDomain: SkillDomain;
  scenarioMarkdown: string;
  componentPolicy: {
    defaultComponents: string[];
    allowedComponents: string[];
    fallbackComponent: string;
    dynamicPlugins: 'disabled-by-default' | 'sandbox-required';
  };
}

export interface ScenarioContract {
  id: ScenarioId;
  title: string;
  description: string;
  source: ScenarioSpec['source'];
  skillDomain: SkillDomain;
  scenarioMarkdown: string;
  componentPolicy: ScenarioSpec['componentPolicy'];
  runtimeId: string;
  mode: ScenarioRuntimeMode;
  nativeTools: string[];
  fallbackTools: string[];
  inputContract: ScenarioInputField[];
  outputArtifacts: ScenarioArtifactSchema[];
  scopeDeclaration: ScenarioScopeDeclaration;
  defaultSlots: UIManifestSlot[];
  executionDefaults: {
    environment: string;
    status: 'planned' | 'record-only';
    databaseVersions: string[];
  };
}

export const SCENARIO_SPECS = {
  'literature-evidence-review': {
    id: 'literature-evidence-review',
    title: '文献证据评估场景',
    description: '从自然语言检索问题出发，生成 paper-list、证据矩阵、研究记录和可复现检索执行单元。',
    source: 'built-in',
    skillDomain: 'literature',
    scenarioMarkdown: [
        '# 文献证据评估场景',
        '',
        '用户目标：检索生命科学文献、提取事实/推断/假设、并排展示支持与反向证据。',
        '',
        '默认展示：paper-card-list、evidence-matrix、notebook-timeline。',
        '',
        '边界：不做系统综述最终裁判、不提取付费全文、不输出临床建议。',
    ].join('\n'),
    componentPolicy: {
      defaultComponents: ['paper-card-list', 'evidence-matrix', 'notebook-timeline'],
      allowedComponents: ['paper-card-list', 'evidence-matrix', 'notebook-timeline', 'record-table', 'unknown-artifact-inspector', 'execution-unit-table'],
      fallbackComponent: 'unknown-artifact-inspector',
      dynamicPlugins: 'disabled-by-default',
    },
    runtimeId: 'sciforge-literature-evidence-review',
    mode: 'scenario-server',
    nativeTools: ['PubMed', 'Semantic Scholar', 'Crossref', 'EvidenceGraph'],
    fallbackTools: ['web-search', 'manual-source-entry'],
    inputContract: [
      { key: 'query', label: '检索 query', type: 'text', required: true },
      { key: 'timeRange', label: '时间范围', type: 'select', options: ['1y', '3y', '5y', 'all'], defaultValue: '3y' },
      { key: 'species', label: '物种', type: 'text', defaultValue: 'human' },
      { key: 'diseaseOrTarget', label: '疾病/靶点', type: 'text' },
      { key: 'maxResults', label: '最大结果数', type: 'number', defaultValue: 30 },
    ],
    outputArtifacts: [{
      type: 'paper-list',
      description: '文献卡片列表，可直接驱动 paper-card-list 和 evidence-matrix。',
      fields: [
        { key: 'papers', type: 'object[]', required: true, description: 'title, authors, journal/source, year, url, abstract, evidenceLevel' },
        { key: 'query', type: 'string', description: '原始检索 query' },
      ],
      consumers: ['structure-exploration', 'biomedical-knowledge-graph'],
    }],
    scopeDeclaration: {
      supportedTasks: ['PubMed query', 'paper-list artifact', 'evidence claim extraction', 'handoff to structure or knowledge'],
      requiredInputs: ['query or artifact-derived entity'],
      unsupportedTasks: ['Systematic review final judgment', 'paywalled full-text extraction', 'clinical recommendation'],
      handoffTargets: ['structure-exploration', 'biomedical-knowledge-graph'],
      phaseLimitations: ['Phase 1 summarizes database evidence and cannot certify biological truth without researcher review.'],
    },
    defaultSlots: [
      { componentId: 'paper-card-list', title: '文献卡片', artifactRef: 'paper-list', priority: 1 },
      { componentId: 'evidence-matrix', title: '证据矩阵', priority: 2 },
      { componentId: 'notebook-timeline', title: '研究记录', priority: 3 },
    ],
    executionDefaults: {
      environment: 'sciforge-literature-search',
      status: 'record-only',
      databaseVersions: ['PubMed current', 'Semantic Scholar current'],
    },
  },
  'structure-exploration': {
    id: 'structure-exploration',
    title: '结构探索场景',
    description: '检索、下载并可视化 PDB/AlphaFold 结构，展示结构质量、来源和可复现坐标下载记录。',
    source: 'built-in',
    skillDomain: 'structure',
    scenarioMarkdown: [
        '# 结构探索场景',
        '',
        '用户目标：根据 PDB ID、UniProt、蛋白/基因名或自然语言请求获取真实结构并交互式查看。',
        '',
        '默认展示：structure-viewer、evidence-matrix、execution-unit-table。',
        '',
        '边界：不做分子动力学、不做结合自由能计算、不把结构观察直接升级为机制结论。',
    ].join('\n'),
    componentPolicy: {
      defaultComponents: ['structure-viewer', 'evidence-matrix', 'execution-unit-table'],
      allowedComponents: ['structure-viewer', 'evidence-matrix', 'execution-unit-table', 'record-table', 'unknown-artifact-inspector'],
      fallbackComponent: 'unknown-artifact-inspector',
      dynamicPlugins: 'disabled-by-default',
    },
    runtimeId: 'sciforge-structure-exploration',
    mode: 'scenario-server',
    nativeTools: ['PDB', 'AlphaFold DB', 'Mol*', 'fpocket'],
    fallbackTools: ['manual-structure-entry'],
    inputContract: [
      { key: 'pdbId', label: 'PDB ID', type: 'text' },
      { key: 'uniprotId', label: 'UniProt ID', type: 'text' },
      { key: 'mutation', label: 'Mutation', type: 'text' },
      { key: 'ligand', label: 'Ligand', type: 'text' },
      { key: 'residueRange', label: 'Residue range', type: 'text' },
    ],
    outputArtifacts: [{
      type: 'structure-summary',
      description: '结构、口袋、残基和质量指标摘要。',
      fields: [
        { key: 'pdbId', type: 'string', description: 'PDB accession' },
        { key: 'uniprotId', type: 'string', description: 'UniProt accession' },
        { key: 'ligand', type: 'string', description: 'Ligand or pocket label' },
        { key: 'highlightResidues', type: 'string[]', description: 'Residues to highlight' },
        { key: 'metrics', type: 'object', description: 'resolution, pLDDT, pocketVolume, mutationRisk' },
      ],
      consumers: ['biomedical-knowledge-graph'],
    }],
    scopeDeclaration: {
      supportedTasks: ['RCSB entry fetch', 'RCSB search', 'AlphaFold DB lookup', 'coordinate artifact generation', 'residue highlighting'],
      requiredInputs: ['PDB id, UniProt accession, gene/protein name, or structure prompt'],
      unsupportedTasks: ['Molecular dynamics', 'binding free energy calculation', 'de novo structure prediction', 'wet-lab validation'],
      handoffTargets: ['biomedical-knowledge-graph'],
      phaseLimitations: ['Phase 1 can retrieve and summarize structures but cannot infer mechanism beyond artifact-backed evidence.'],
    },
    defaultSlots: [
      { componentId: 'structure-viewer', title: '结构查看器', artifactRef: 'structure-summary', priority: 1 },
      { componentId: 'evidence-matrix', title: '结构证据', priority: 2 },
      { componentId: 'execution-unit-table', title: '结构执行单元', priority: 3 },
    ],
    executionDefaults: {
      environment: 'sciforge-structure-analysis',
      status: 'record-only',
      databaseVersions: ['PDB current', 'AlphaFold DB current'],
    },
  },
  'omics-differential-exploration': {
    id: 'omics-differential-exploration',
    title: '组学差异分析场景',
    description: '读取工作区矩阵和 metadata，生成差异表达、降维、热图与可复现实验记录。',
    source: 'built-in',
    skillDomain: 'omics',
    scenarioMarkdown: [
        '# 组学差异分析场景',
        '',
        '用户目标：对表达矩阵进行可复现差异分析，并用火山图、热图、UMAP 浏览结果。',
        '',
        '默认展示：point-set-viewer、matrix-viewer。',
        '',
        '边界：不无界处理原始 FASTQ；没有明确设计矩阵时不声称 publication-grade batch correction。',
    ].join('\n'),
    componentPolicy: {
      defaultComponents: ['point-set-viewer', 'matrix-viewer'],
      allowedComponents: ['point-set-viewer', 'matrix-viewer', 'record-table', 'evidence-matrix', 'execution-unit-table', 'unknown-artifact-inspector'],
      fallbackComponent: 'unknown-artifact-inspector',
      dynamicPlugins: 'disabled-by-default',
    },
    runtimeId: 'sciforge-omics-differential-exploration',
    mode: 'scenario-server',
    nativeTools: ['DESeq2', 'Scanpy', 'clusterProfiler'],
    fallbackTools: ['workspace-csv-fixture', 'agentserver-task-generation'],
    inputContract: [
      { key: 'matrixRef', label: '表达矩阵', type: 'text', required: true, defaultValue: 'matrix.csv' },
      { key: 'metadataRef', label: '样本 metadata', type: 'text' },
      { key: 'groupColumn', label: '分组列', type: 'text', defaultValue: 'condition' },
      { key: 'designFormula', label: 'Design formula', type: 'text', defaultValue: '~ condition' },
      { key: 'alpha', label: 'FDR threshold', type: 'number', defaultValue: 0.05 },
    ],
    outputArtifacts: [{
      type: 'omics-differential-expression',
      description: '差异表达与降维结果，可驱动 volcano/heatmap/UMAP。',
      fields: [
        { key: 'points', type: 'object[]', description: 'gene, logFC, pValue, fdr, significant' },
        { key: 'heatmap', type: 'object', description: 'genes x samples matrix payload' },
        { key: 'umap', type: 'object[]', description: 'sample coordinates and labels' },
      ],
      consumers: ['literature-evidence-review', 'biomedical-knowledge-graph'],
    }],
    scopeDeclaration: {
      supportedTasks: ['CSV differential expression', 'volcano/heatmap/UMAP artifact generation', 'runner provenance capture'],
      requiredInputs: ['matrixRef', 'metadataRef', 'groupColumn', 'caseGroup', 'controlGroup'],
      unsupportedTasks: ['Unbounded raw FASTQ processing', 'publication-grade batch correction without explicit design', 'biological conclusion without researcher confirmation'],
      handoffTargets: ['literature-evidence-review', 'biomedical-knowledge-graph'],
      phaseLimitations: ['Phase 1 executes reproducible local statistics and flags limitations; interpretation remains evidence-scoped.'],
    },
    defaultSlots: [
      { componentId: 'point-set-viewer', title: '火山图 / UMAP', artifactRef: 'omics-differential-expression', priority: 1 },
      { componentId: 'matrix-viewer', title: '热图', artifactRef: 'omics-differential-expression', priority: 2 },
    ],
    executionDefaults: {
      environment: 'sciforge-omics-runtime',
      status: 'planned',
      databaseVersions: ['Bioconductor current'],
    },
  },
  'biomedical-knowledge-graph': {
    id: 'biomedical-knowledge-graph',
    title: '生物医学知识图谱场景',
    description: '围绕基因、蛋白、疾病或化合物查询数据库事实，生成 graph/table/evidence 视图。',
    source: 'built-in',
    skillDomain: 'knowledge',
    scenarioMarkdown: [
        '# 生物医学知识图谱场景',
        '',
        '用户目标：围绕实体检索 UniProt、ChEMBL 等数据库，展示来源链接、关系网络和知识卡片。',
        '',
        '默认展示：graph-viewer、record-table、evidence-matrix。',
        '',
        '边界：缺少连接器时返回 unsupported/failed-with-reason，不把数据库事实伪装成因果证明。',
    ].join('\n'),
    componentPolicy: {
      defaultComponents: ['graph-viewer', 'record-table', 'evidence-matrix'],
      allowedComponents: ['graph-viewer', 'record-table', 'evidence-matrix', 'paper-card-list', 'execution-unit-table', 'unknown-artifact-inspector'],
      fallbackComponent: 'unknown-artifact-inspector',
      dynamicPlugins: 'disabled-by-default',
    },
    runtimeId: 'sciforge-biomedical-knowledge-graph',
    mode: 'scenario-server',
    nativeTools: ['UniProt', 'ChEMBL', 'OpenTargets', 'ClinicalTrials'],
    fallbackTools: ['manual-knowledge-card'],
    inputContract: [
      { key: 'entity', label: 'Gene / protein / disease / compound', type: 'text', required: true },
      { key: 'entityType', label: '实体类型', type: 'select', options: ['gene', 'protein', 'disease', 'compound'], defaultValue: 'gene' },
      { key: 'includeTrials', label: '临床试验', type: 'select', options: ['yes', 'no'], defaultValue: 'yes' },
    ],
    outputArtifacts: [{
      type: 'knowledge-graph',
      description: '节点、边、知识卡片和来源。',
      fields: [
        { key: 'nodes', type: 'object[]', required: true, description: 'id, label, type, confidence' },
        { key: 'edges', type: 'object[]', required: true, description: 'source, target, relation, evidenceLevel' },
        { key: 'rows', type: 'object[]', description: 'record-table rows for target cards' },
      ],
      consumers: ['literature-evidence-review', 'structure-exploration', 'omics-differential-exploration'],
    }],
    scopeDeclaration: {
      supportedTasks: ['UniProt gene/protein lookup', 'ChEMBL compound mechanism lookup', 'knowledge-graph artifact', 'source-linked rows'],
      requiredInputs: ['entity and optional entityType'],
      unsupportedTasks: ['Unsupported disease connector claims', 'clinical trial synthesis without connector', 'causal pathway proof'],
      handoffTargets: ['literature-evidence-review', 'structure-exploration', 'omics-differential-exploration'],
      phaseLimitations: ['Phase 1 returns database-backed graph facts and explicit unsupported states for missing connectors.'],
    },
    defaultSlots: [
      { componentId: 'graph-viewer', title: '知识网络', artifactRef: 'knowledge-graph', priority: 1 },
      { componentId: 'record-table', title: '知识卡片', artifactRef: 'knowledge-graph', priority: 2 },
      { componentId: 'evidence-matrix', title: '证据矩阵', priority: 3 },
    ],
    executionDefaults: {
      environment: 'sciforge-knowledge-query',
      status: 'record-only',
      databaseVersions: ['UniProt current', 'ChEMBL current', 'OpenTargets current'],
    },
  },
} satisfies Record<ScenarioId, ScenarioContract>;

export const componentManifest = Object.fromEntries(
  Object.entries(SCENARIO_SPECS).map(([scenarioId, spec]) => [
    scenarioId,
    ['conversation-panel', 'parameter-panel', ...spec.defaultSlots.map((slot) => slot.componentId)],
  ]),
) as Record<ScenarioId, string[]>;

export const SCENARIO_PRESETS = Object.fromEntries(
  Object.entries(SCENARIO_SPECS).map(([scenarioId, spec]) => [scenarioId, {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    source: spec.source,
    skillDomain: spec.skillDomain,
    scenarioMarkdown: spec.scenarioMarkdown,
    componentPolicy: spec.componentPolicy,
  }]),
) as Record<ScenarioId, ScenarioSpec>;

export function agentProtocolForPrompt(scenarioId: ScenarioId) {
  const spec = SCENARIO_SPECS[scenarioId];
  return JSON.stringify({
    scenario: SCENARIO_PRESETS[scenarioId],
    runtimeId: spec.runtimeId,
    mode: spec.mode,
    nativeTools: spec.nativeTools,
    fallbackTools: spec.fallbackTools,
    inputContract: spec.inputContract,
    outputArtifacts: spec.outputArtifacts,
    scopeDeclaration: spec.scopeDeclaration,
    defaultSlots: spec.defaultSlots,
    executionDefaults: spec.executionDefaults,
  }, null, 2);
}
