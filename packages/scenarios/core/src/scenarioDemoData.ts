import type { ScenarioId } from './contracts';
import { SCENARIO_SPECS } from './scenarioSpecs';

export type { ScenarioId } from './contracts';

export type ClaimType = 'fact' | 'inference' | 'hypothesis';
export type EvidenceLevel = 'meta' | 'rct' | 'cohort' | 'case' | 'experimental' | 'review' | 'database' | 'preprint' | 'prediction';
export type ScenarioTagBadgeVariant = 'success' | 'info' | 'warning' | 'coral' | 'muted';

export type ScenarioDisplayIconKey = 'bookOpen' | 'flaskConical' | 'dna' | 'database';
export type OverviewStatIconKey = 'brain' | 'shield' | 'fileText' | 'barChart3';

export interface ScenarioDisplayConfig {
  id: ScenarioId;
  name: string;
  domain: string;
  desc: string;
  icon: ScenarioDisplayIconKey;
  color: string;
  tools: string[];
  status: 'active' | 'ready';
  defaultResult: string;
}

export interface OverviewStatDisplay {
  label: string;
  value: string;
  icon: OverviewStatIconKey;
  color: string;
}

export interface DemoScenarioMessage {
  role: 'user' | 'scenario';
  content: string;
  confidence?: number;
  evidence?: EvidenceLevel;
  claimType?: ClaimType;
  expandable?: string;
}

const evidenceDisplay: Record<EvidenceLevel, { label: string; variant: ScenarioTagBadgeVariant }> = {
  meta: { label: 'Meta分析', variant: 'success' },
  rct: { label: 'RCT/临床', variant: 'info' },
  cohort: { label: '队列研究', variant: 'warning' },
  case: { label: '案例报告', variant: 'coral' },
  experimental: { label: '实验验证', variant: 'success' },
  review: { label: '综述', variant: 'info' },
  database: { label: '数据库', variant: 'muted' },
  preprint: { label: '预印本', variant: 'warning' },
  prediction: { label: '计算预测', variant: 'muted' },
};

const claimDisplay: Record<ClaimType, { label: string; variant: ScenarioTagBadgeVariant }> = {
  fact: { label: '事实', variant: 'success' },
  inference: { label: '推断', variant: 'warning' },
  hypothesis: { label: '假设', variant: 'coral' },
};

export function evidenceLevelDisplay(level: EvidenceLevel) {
  return evidenceDisplay[level];
}

export function claimTypeDisplay(type: ClaimType) {
  return claimDisplay[type];
}

export const builtInScenarioDisplayData: ScenarioDisplayConfig[] = [
  {
    id: 'literature-evidence-review',
    name: '文献证据评估',
    domain: 'literature-research',
    desc: '文献检索、综述生成、证据矩阵与矛盾证据整理',
    icon: 'bookOpen',
    color: '#00E5A0',
    tools: ['PubMed', 'Semantic Scholar', 'EvidenceGraph'],
    status: 'active',
    defaultResult: 'paper-card-list',
  },
  {
    id: 'structure-exploration',
    name: '结构探索',
    domain: 'protein-structure',
    desc: '蛋白结构、结合口袋、pLDDT 置信度与分子查看器',
    icon: 'flaskConical',
    color: '#FF7043',
    tools: ['PDB', 'AlphaFold DB', 'Mol*'],
    status: 'active',
    defaultResult: 'structure-viewer',
  },
  {
    id: 'omics-differential-exploration',
    name: '组学差异分析',
    domain: 'omics-analysis',
    desc: '差异表达、富集分析、热图、火山图与 UMAP 探索',
    icon: 'dna',
    color: '#4ECDC4',
    tools: ['DESeq2', 'Scanpy', 'clusterProfiler'],
    status: 'active',
    defaultResult: 'point-set-viewer',
  },
  {
    id: 'biomedical-knowledge-graph',
    name: '生物医学知识图谱',
    domain: 'bio-knowledge',
    desc: 'UniProt、ChEMBL、OpenTargets、ClinicalTrials 知识查询',
    icon: 'database',
    color: '#FFD54F',
    tools: ['UniProt', 'ChEMBL', 'OpenTargets'],
    status: 'active',
    defaultResult: 'graph-viewer',
  },
];

export const overviewStats: OverviewStatDisplay[] = [
  { label: 'Built-in Scenarios', value: String(builtInScenarioDisplayData.length), icon: 'brain', color: '#00E5A0' },
  { label: 'Execution Units', value: '0', icon: 'shield', color: '#FF7043' },
  { label: 'Evidence Claims', value: '0', icon: 'fileText', color: '#4ECDC4' },
  { label: 'UI Components', value: '11', icon: 'barChart3', color: '#FFD54F' },
];

export const demoMessagesByScenario: Record<ScenarioId, DemoScenarioMessage[]> = {
  'literature-evidence-review': [],
  'structure-exploration': [],
  'omics-differential-exploration': [],
  'biomedical-knowledge-graph': [],
};

export const demoPaperCards: Array<{ title: string; source: string; year: string; level: EvidenceLevel }> = [];

export const demoExecutionUnits: Array<{ id: string; tool: string; params: string; status: string; hash: string; time: string }> = [];

export const demoTimeline: Array<{
  time: string;
  scenario: ScenarioId;
  title: string;
  desc: string;
  claimType: ClaimType;
  confidence: number;
  action?: string;
}> = [];

export function scenarioDisplayMatchesSpec() {
  return builtInScenarioDisplayData.every((scenario) => SCENARIO_SPECS[scenario.id].title.length > 0);
}
