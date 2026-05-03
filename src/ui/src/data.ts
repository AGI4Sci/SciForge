import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  Blocks,
  Database,
  Dna,
  FileText,
  FlaskConical,
  GitBranch,
  MessageSquare,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type ScenarioId = 'literature-evidence-review' | 'structure-exploration' | 'omics-differential-exploration' | 'biomedical-knowledge-graph';
export type PageId = 'dashboard' | 'workbench' | 'components' | 'alignment' | 'timeline' | 'feedback';
export type ClaimType = 'fact' | 'inference' | 'hypothesis';
export type EvidenceLevel = 'meta' | 'rct' | 'cohort' | 'case' | 'experimental' | 'review' | 'database' | 'preprint' | 'prediction';

export interface ScenarioViewConfig {
  id: ScenarioId;
  name: string;
  domain: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  tools: string[];
  status: 'active' | 'ready';
  defaultResult: string;
}

export const scenarios: ScenarioViewConfig[] = [
  {
    id: 'literature-evidence-review',
    name: '文献证据评估',
    domain: 'literature-research',
    desc: '文献检索、综述生成、证据矩阵与矛盾证据整理',
    icon: BookOpen,
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
    icon: FlaskConical,
    color: '#FF7043',
    tools: ['PDB', 'AlphaFold DB', 'Mol*'],
    status: 'active',
    defaultResult: 'molecule-viewer',
  },
  {
    id: 'omics-differential-exploration',
    name: '组学差异分析',
    domain: 'omics-analysis',
    desc: '差异表达、富集分析、热图、火山图与 UMAP 探索',
    icon: Dna,
    color: '#4ECDC4',
    tools: ['DESeq2', 'Scanpy', 'clusterProfiler'],
    status: 'active',
    defaultResult: 'volcano-plot',
  },
  {
    id: 'biomedical-knowledge-graph',
    name: '生物医学知识图谱',
    domain: 'bio-knowledge',
    desc: 'UniProt、ChEMBL、OpenTargets、ClinicalTrials 知识查询',
    icon: Database,
    color: '#FFD54F',
    tools: ['UniProt', 'ChEMBL', 'OpenTargets'],
    status: 'active',
    defaultResult: 'network-graph',
  },
];

export const navItems = [
  { id: 'dashboard' as const, label: '研究概览', icon: Activity },
  { id: 'workbench' as const, label: '场景工作台', icon: Brain },
  { id: 'components' as const, label: '组件工作台', icon: Blocks },
  { id: 'alignment' as const, label: '对齐工作台', icon: Users },
  { id: 'timeline' as const, label: '研究时间线', icon: GitBranch },
  { id: 'feedback' as const, label: '反馈收件箱', icon: MessageSquare },
];

export const stats = [
  { label: 'Built-in Scenarios', value: '4', icon: Brain, color: '#00E5A0' },
  { label: 'Execution Units', value: '18', icon: Shield, color: '#FF7043' },
  { label: 'Evidence Claims', value: '64', icon: FileText, color: '#4ECDC4' },
  { label: 'UI Components', value: '11', icon: BarChart3, color: '#FFD54F' },
];

export const feasibilityRows = [
  { dim: '样本量', ai: '200 样本可支持基础建模', bio: '每个样本成本高，无法轻易扩充', action: '公共数据预训练 + 内部数据微调', status: 'caution' },
  { dim: '标签质量', ai: '3 种药物标签严重不平衡', bio: '窄谱药物响应率本身极低', action: '拆分建模，避免混入主任务', status: 'ok' },
  { dim: '特征维度', ai: '20K 基因 vs 200 样本存在过拟合', bio: '需要保留通路相关基因', action: '先验知识驱动特征筛选', status: 'caution' },
  { dim: '成功标准', ai: 'AUROC > 0.8', bio: '假阳性率 < 20% 才值得验证', action: 'AI 指标 + 实验验证双阈值', status: 'ok' },
];

export const radarData = [
  { subject: '数据充分性', ai: 65, bio: 80 },
  { subject: '任务可行性', ai: 72, bio: 90 },
  { subject: '工具成熟度', ai: 88, bio: 70 },
  { subject: '团队经验', ai: 60, bio: 85 },
  { subject: '时间预算', ai: 45, bio: 55 },
  { subject: '验证可行', ai: 70, bio: 75 },
];

