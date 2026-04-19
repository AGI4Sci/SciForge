import type { AgentId } from './data';
import type { UIManifestSlot } from './domain';

export type AgentMode = 'agent-server' | 'demo';

export interface AgentInputField {
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

export interface AgentArtifactSchema {
  type: string;
  description: string;
  fields: ArtifactSchemaField[];
  consumers: AgentId[];
}

export interface BioAgentProfileContract {
  id: AgentId;
  agentServerId: string;
  mode: AgentMode;
  nativeTools: string[];
  fallbackTools: string[];
  inputContract: AgentInputField[];
  outputArtifacts: AgentArtifactSchema[];
  defaultSlots: UIManifestSlot[];
  executionDefaults: {
    environment: string;
    status: 'planned' | 'record-only';
    databaseVersions: string[];
  };
}

export const BIOAGENT_PROFILES = {
  literature: {
    id: 'literature',
    agentServerId: 'bioagent-literature',
    mode: 'agent-server',
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
      consumers: ['structure', 'knowledge'],
    }],
    defaultSlots: [
      { componentId: 'paper-card-list', title: '文献卡片', artifactRef: 'paper-list', priority: 1 },
      { componentId: 'evidence-matrix', title: '证据矩阵', priority: 2 },
      { componentId: 'notebook-timeline', title: '研究记录', priority: 3 },
    ],
    executionDefaults: {
      environment: 'bioagent-literature-search',
      status: 'record-only',
      databaseVersions: ['PubMed current', 'Semantic Scholar current'],
    },
  },
  structure: {
    id: 'structure',
    agentServerId: 'bioagent-structure',
    mode: 'agent-server',
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
      consumers: ['knowledge'],
    }],
    defaultSlots: [
      { componentId: 'molecule-viewer', title: '分子结构查看器', artifactRef: 'structure-summary', priority: 1 },
      { componentId: 'evidence-matrix', title: '结构证据', priority: 2 },
      { componentId: 'execution-unit-table', title: '结构执行单元', priority: 3 },
    ],
    executionDefaults: {
      environment: 'bioagent-structure-analysis',
      status: 'record-only',
      databaseVersions: ['PDB current', 'AlphaFold DB current'],
    },
  },
  omics: {
    id: 'omics',
    agentServerId: 'bioagent-omics',
    mode: 'agent-server',
    nativeTools: ['DESeq2', 'Scanpy', 'clusterProfiler'],
    fallbackTools: ['demo-expression-matrix'],
    inputContract: [
      { key: 'matrixRef', label: '表达矩阵', type: 'text', required: true, defaultValue: 'demo:rna-seq' },
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
      consumers: ['literature', 'knowledge'],
    }],
    defaultSlots: [
      { componentId: 'volcano-plot', title: '火山图', artifactRef: 'omics-differential-expression', priority: 1 },
      { componentId: 'heatmap-viewer', title: '热图', artifactRef: 'omics-differential-expression', priority: 2 },
      { componentId: 'umap-viewer', title: 'UMAP', artifactRef: 'omics-differential-expression', priority: 3 },
    ],
    executionDefaults: {
      environment: 'bioagent-omics-record-only',
      status: 'planned',
      databaseVersions: ['Bioconductor current'],
    },
  },
  knowledge: {
    id: 'knowledge',
    agentServerId: 'bioagent-knowledge',
    mode: 'agent-server',
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
        { key: 'rows', type: 'object[]', description: 'data-table rows for target cards' },
      ],
      consumers: ['literature', 'structure', 'omics'],
    }],
    defaultSlots: [
      { componentId: 'network-graph', title: '知识网络', artifactRef: 'knowledge-graph', priority: 1 },
      { componentId: 'data-table', title: '知识卡片', artifactRef: 'knowledge-graph', priority: 2 },
      { componentId: 'evidence-matrix', title: '证据矩阵', priority: 3 },
    ],
    executionDefaults: {
      environment: 'bioagent-knowledge-query',
      status: 'record-only',
      databaseVersions: ['UniProt current', 'ChEMBL current', 'OpenTargets current'],
    },
  },
} satisfies Record<AgentId, BioAgentProfileContract>;

export const componentManifest = Object.fromEntries(
  Object.entries(BIOAGENT_PROFILES).map(([agentId, profile]) => [
    agentId,
    ['conversation-panel', 'parameter-panel', ...profile.defaultSlots.map((slot) => slot.componentId)],
  ]),
) as Record<AgentId, string[]>;

export function agentProtocolForPrompt(agentId: AgentId) {
  const profile = BIOAGENT_PROFILES[agentId];
  return JSON.stringify({
    agentId,
    agentServerId: profile.agentServerId,
    mode: profile.mode,
    nativeTools: profile.nativeTools,
    fallbackTools: profile.fallbackTools,
    inputContract: profile.inputContract,
    outputArtifacts: profile.outputArtifacts,
    defaultSlots: profile.defaultSlots,
    executionDefaults: profile.executionDefaults,
  }, null, 2);
}
