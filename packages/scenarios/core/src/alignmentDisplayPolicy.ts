import type { ScenarioId } from './contracts';

export interface AlignmentContractDisplayData {
  dataReality: string;
  aiAssessment: string;
  bioReality: string;
  feasibilityMatrix: string;
  researchGoal: string;
  technicalRoute: string;
  successCriteria: string;
  knownRisks: string;
  recalibrationRecord: string;
  dataAssetsChecklist: string;
  sampleSizeChecklist: string;
  labelQualityChecklist: string;
  batchEffectChecklist: string;
  experimentalConstraints: string;
  feasibilitySourceNotes: string;
}

export interface AlignmentMetricDisplay {
  id: string;
  label: string;
  value: number;
  color: string;
  detail: string;
}

export interface AlignmentFeasibilityDisplayRow {
  dim: string;
  ai: string;
  bio: string;
  action: string;
  status: 'caution' | 'ok';
}

export interface AlignmentTimelineSourceInput {
  id: string;
  title: string;
  reason: string;
  checksum: string;
  sourceRefs?: string[];
}

export interface RuntimeTimelineSourceInput {
  branchId?: string;
  action: string;
  subject: string;
  artifactRefs: string[];
  executionUnitRefs: string[];
}

export const alignmentFeasibilityRows: AlignmentFeasibilityDisplayRow[] = [
  { dim: '样本量', ai: '200 样本可支持基础建模', bio: '每个样本成本高，无法轻易扩充', action: '公共数据预训练 + 内部数据微调', status: 'caution' },
  { dim: '标签质量', ai: '3 种药物标签严重不平衡', bio: '窄谱药物响应率本身极低', action: '拆分建模，避免混入主任务', status: 'ok' },
  { dim: '特征维度', ai: '20K 基因 vs 200 样本存在过拟合', bio: '需要保留通路相关基因', action: '先验知识驱动特征筛选', status: 'caution' },
  { dim: '成功标准', ai: 'AUROC > 0.8', bio: '假阳性率 < 20% 才值得验证', action: 'AI 指标 + 实验验证双阈值', status: 'ok' },
];

export const alignmentRadarData = [
  { subject: '数据充分性', ai: 65, bio: 80 },
  { subject: '任务可行性', ai: 72, bio: 90 },
  { subject: '工具成熟度', ai: 88, bio: 70 },
  { subject: '团队经验', ai: 60, bio: 85 },
  { subject: '时间预算', ai: 45, bio: 55 },
  { subject: '验证可行', ai: 70, bio: 75 },
];

export const alignmentDefaultContractData: AlignmentContractDisplayData = {
  dataReality: '内部药敏样本约 200 例，包含 GDSC/CCLE 对齐后的表达矩阵、药物响应标签和基础质控记录。',
  aiAssessment: '特征维度显著高于样本量，主模型需要正则化、先验通路约束和外部数据预训练。',
  bioReality: '窄谱靶向药低响应率是生物学现实，需要按机制拆分模型，不能简单合并为一个泛化分类器。',
  feasibilityMatrix: alignmentFeasibilityRows.map((row) => `${row.dim}: status=needs-data; source=AI-draft; AI=${row.ai}; Bio=${row.bio}; Action=${row.action}`).join('\n'),
  researchGoal: '聚焦 12 种药物的敏感性预测，排除 3 种极低响应率窄谱靶向药。',
  technicalRoute: 'GDSC/CCLE 预训练 + 内部数据微调，按机制拆分模型。',
  successCriteria: 'AUROC > 0.80，假阳性率 < 20%，至少 3 个命中完成实验验证。',
  knownRisks: '批次效应、药物机制差异和验证成本可能影响项目节奏。',
  recalibrationRecord: '模型在 2 种 HDAC 抑制剂上 AUROC 仅 0.58；共识为拆分模型并补充组蛋白修饰数据。',
  dataAssetsChecklist: 'needs-data: 列出表达矩阵、药敏标签、质控报告和外部公共数据 sourceRefs。',
  sampleSizeChecklist: 'needs-data: 按药物、癌种、批次统计样本量；低于阈值不得给出确定可行判断。',
  labelQualityChecklist: 'needs-data: 标注标签来源、缺失率、不平衡比例和人工复核状态。',
  batchEffectChecklist: 'needs-data: 记录 GDSC/CCLE/内部数据批次变量、校正策略和残余风险。',
  experimentalConstraints: 'needs-data: 记录预算、周期、可用细胞系、验证读出和失败重试条件。',
  feasibilitySourceNotes: 'unknown: 每个矩阵单元必须标注 user-input / artifact-statistic / literature-evidence / AI-draft。',
};

export const alignmentPageDisplayPolicy = {
  contractArtifactLabel: 'alignment-contract',
  draftArtifactLabel: 'draft-only',
  missingArtifactLabel: 'not saved',
  defaultDecisionAuthority: 'researcher',
  defaultSaveReason: 'alignment contract saved from workspace',
  restoreReasonPrefix: 'restore alignment contract',
  confirmSaveReason: 'researcher confirmed alignment contract',
  recalibrationSaveReason: 'alignment recalibration saved',
  steps: ['数据摸底', '可行性评估', '方案共识', '持续校准'],
  surveyMetrics: {
    ai: [
      { id: 'sample-size', label: '样本量', value: 20, color: '#FFD54F', detail: '200 / 1000 ideal' },
      { id: 'feature-dimension', label: '特征维度', value: 100, color: '#00E5A0', detail: '20K genes' },
      { id: 'label-balance', label: '标签平衡度', value: 35, color: '#FF7043', detail: '3 drugs < 5%' },
    ] satisfies AlignmentMetricDisplay[],
    bio: [
      { id: 'drug-coverage', label: '药物覆盖', value: 100, color: '#00E5A0', detail: '15 / 15' },
      { id: 'omics-modalities', label: '组学模态', value: 60, color: '#FFD54F', detail: '3 / 5' },
      { id: 'batch-consistency', label: '批次一致性', value: 60, color: '#FFD54F', detail: 'GDSC vs CCLE' },
    ] satisfies AlignmentMetricDisplay[],
  },
  feasibility: {
    statusBadge: 'needs-data',
    aiDraftLabel: 'AI draft',
    bioInputLabel: 'Bio input',
    sourceCode: 'source=AI-draft',
    unknownStateCode: 'state=unknown until sourceRefs are attached',
  },
  contractDraftBadge: 'AI draft · needs-data until researcher confirmation',
  timeline: {
    contractScenarioId: 'biomedical-knowledge-graph' as ScenarioId,
    runtimeFallbackScenarioId: 'literature-evidence-review' as ScenarioId,
    contractAction: 'alignment.contract',
    demoAction: 'demo.timeline',
    searchPlaceholder: '搜索 run、artifact、package、scenario...',
    allActionsLabel: '全部事件',
    exportFilePrefix: 'sciforge-timeline',
    emptyTitle: '没有匹配的时间线事件',
    emptyDetail: '运行任务、发布 package、handoff artifact 或保存契约后，会在这里形成可过滤记录。',
  },
} as const;

export const alignmentTimelineClassNames = {
  list: 'timeline-list',
  card: 'timeline-card',
  dot: 'timeline-dot',
  meta: 'timeline-meta',
} as const;

export function alignmentContractTimelineDisplay(contract: AlignmentTimelineSourceInput) {
  return {
    scenario: alignmentPageDisplayPolicy.timeline.contractScenarioId,
    title: contract.title,
    desc: `${alignmentPageDisplayPolicy.contractArtifactLabel} ${contract.id} · ${contract.reason} · checksum ${contract.checksum}`,
    claimType: 'fact' as const,
    confidence: 1,
    action: alignmentPageDisplayPolicy.timeline.contractAction,
    refs: contract.sourceRefs ?? [],
  };
}

export function alignmentRuntimeTimelineDisplay(event: RuntimeTimelineSourceInput) {
  const executionUnitRefs = realExecutionUnitRefs(event.executionUnitRefs);
  return {
    scenario: event.branchId ?? alignmentPageDisplayPolicy.timeline.runtimeFallbackScenarioId,
    title: event.action,
    desc: `${event.subject} · artifacts=${event.artifactRefs.length} · units=${executionUnitRefs.length}`,
    claimType: 'fact' as const,
    confidence: event.action.includes('failed') ? 0.35 : 0.9,
    action: event.action,
    refs: [...event.artifactRefs, ...executionUnitRefs],
  };
}

function realExecutionUnitRefs(refs: string[]) {
  return refs.filter((ref) => {
    const value = ref.trim();
    return /^(execution-unit:{1,2})?(EU[-_:]|unit[-_:])/i.test(value);
  });
}
