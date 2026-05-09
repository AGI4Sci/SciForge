import type { ScenarioId } from './contracts';
import { SCENARIO_SPECS } from './scenarioSpecs';

export type { ScenarioId } from './contracts';

export type ClaimType = 'fact' | 'inference' | 'hypothesis';
export type EvidenceLevel = 'meta' | 'rct' | 'cohort' | 'case' | 'experimental' | 'review' | 'database' | 'preprint' | 'prediction';

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
  { label: 'Execution Units', value: '18', icon: 'shield', color: '#FF7043' },
  { label: 'Evidence Claims', value: '64', icon: 'fileText', color: '#4ECDC4' },
  { label: 'UI Components', value: '11', icon: 'barChart3', color: '#FFD54F' },
];

export const demoMessagesByScenario: Record<ScenarioId, DemoScenarioMessage[]> = {
  'literature-evidence-review': [
    { role: 'user', content: '检索近三年关于 KRAS G12C 抑制剂耐药机制的文献，并标注证据强度。' },
    {
      role: 'scenario',
      content:
        '已形成可审计文献证据矩阵：47 篇相关文献中，12 篇直接研究耐药机制。EGFR/MET 旁路激活是当前支持最强的机制，KRAS Y96D 二次突变和组织学转化为需要并排展示的备选机制。',
      confidence: 0.91,
      evidence: 'cohort',
      claimType: 'inference',
      expandable:
        'Step 1: PubMed/Semantic Scholar 检索 KRAS G12C resistance\nStep 2: 按证据等级分组 Meta/RCT/队列/案例\nStep 3: 生成 contradiction group：旁路激活 vs 二次突变\nStep 4: 输出 EvidenceGraph 与 PaperCardList manifest',
    },
  ],
  'structure-exploration': [
    { role: 'user', content: '分析 PDB:7BZ5 的 Switch-II 口袋，以及 Y96D 突变对结合的影响。' },
    {
      role: 'scenario',
      content:
        '结构记录已生成。7BZ5 分辨率 1.79 Å，Switch-II 口袋体积约 628 Å3。Y96D 位点靠近抑制剂结合构象核心区域，当前作为推断性风险标记，需要分子动力学或突变实验验证。',
      confidence: 0.94,
      evidence: 'rct',
      claimType: 'fact',
      expandable:
        'ExecutionUnit: structure.fetch-or-predict\nData fingerprint: PDB:7BZ5 + ligand 6SI\nUI slots: molecule-viewer, evidence-matrix, notebook-timeline',
    },
  ],
  'omics-differential-exploration': [
    { role: 'user', content: '对 RNA-seq 数据做差异表达，并展示火山图和富集结果。' },
    {
      role: 'scenario',
      content:
        '示例会话展示了 omics runtime 的预期产物形态：差异基因摘要、火山图、热图和 UMAP 都应来自 workspace task artifact；没有真实 artifact 时动态结果区保持 empty state。',
      confidence: 0.88,
      evidence: 'prediction',
      claimType: 'inference',
      expandable:
        'Expected ExecutionUnit params: design=~condition, alpha=0.05\nExpected artifacts: omics-differential-expression, execution-unit.json',
    },
  ],
  'biomedical-knowledge-graph': [
    { role: 'user', content: '查询 KRAS 靶点的成药性、已上市药物和临床试验。' },
    {
      role: 'scenario',
      content:
        '已从 UniProt、ChEMBL、OpenTargets 和 ClinicalTrials 形成知识卡片。KRAS G12C 已有 sotorasib 与 adagrasib 上市，非共价泛 KRAS 抑制剂仍处于临床探索阶段。',
      confidence: 0.96,
      evidence: 'meta',
      claimType: 'fact',
    },
  ],
};

export const demoPaperCards = [
  { title: 'KRAS G12C acquired resistance landscape', source: 'Cancer Discovery', year: '2024', level: 'cohort' as EvidenceLevel },
  { title: 'Adagrasib and sotorasib clinical response comparison', source: 'Nature Medicine', year: '2024', level: 'rct' as EvidenceLevel },
  { title: 'EGFR-MET bypass activation in KRAS inhibitor escape', source: 'JCO', year: '2023', level: 'case' as EvidenceLevel },
];

export const demoExecutionUnits = [
  { id: 'EU-001', tool: 'literature.search', params: 'query=KRAS G12C resistance, max=50', status: 'done', hash: 'a3f2c9...', time: '1.8s' },
  { id: 'EU-002', tool: 'evidence.reduce', params: 'levels=meta,rct,cohort,case', status: 'done', hash: 'b7d1e4...', time: '0.6s' },
  { id: 'EU-003', tool: 'structure.fetch', params: 'pdb=7BZ5, ligand=6SI', status: 'done', hash: 'c8e5f2...', time: '2.1s' },
  { id: 'EU-004', tool: 'omics.deseq2', params: 'design=~condition, alpha=0.05', status: 'planned', hash: '-', time: '-' },
];

export const demoTimeline = [
  { time: '2026-04-19 14:30', scenario: 'literature-evidence-review' as ScenarioId, title: 'KRAS G12C 耐药文献综述', desc: '47 篇文献进入证据矩阵，识别 3 类耐药机制', claimType: 'inference' as ClaimType, confidence: 0.91 },
  { time: '2026-04-19 15:05', scenario: 'structure-exploration' as ScenarioId, title: '7BZ5 结合口袋分析', desc: 'Switch-II 口袋体积和关键残基已归档', claimType: 'fact' as ClaimType, confidence: 0.94 },
  { time: '2026-04-19 15:40', scenario: 'omics-differential-exploration' as ScenarioId, title: '差异表达视图契约', desc: '火山图、热图、UMAP 等待 workspace task artifact 驱动', claimType: 'inference' as ClaimType, confidence: 0.82 },
  { time: '2026-04-19 16:10', scenario: 'biomedical-knowledge-graph' as ScenarioId, title: 'KRAS 知识库卡片', desc: 'UniProt / ChEMBL / OpenTargets 视图进入 manifest', claimType: 'fact' as ClaimType, confidence: 0.96 },
];

export function scenarioDisplayMatchesSpec() {
  return builtInScenarioDisplayData.every((scenario) => SCENARIO_SPECS[scenario.id].title.length > 0);
}
