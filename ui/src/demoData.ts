import type { AgentId, ClaimType, EvidenceLevel } from './data';

export const messagesByAgent: Record<AgentId, Array<{
  role: 'user' | 'agent';
  content: string;
  confidence?: number;
  evidence?: EvidenceLevel;
  claimType?: ClaimType;
  expandable?: string;
}>> = {
  literature: [
    { role: 'user', content: '检索近三年关于 KRAS G12C 抑制剂耐药机制的文献，并标注证据强度。' },
    {
      role: 'agent',
      content:
        '已形成可审计文献证据矩阵：47 篇相关文献中，12 篇直接研究耐药机制。EGFR/MET 旁路激活是当前支持最强的机制，KRAS Y96D 二次突变和组织学转化为需要并排展示的备选机制。',
      confidence: 0.91,
      evidence: 'cohort',
      claimType: 'inference',
      expandable:
        'Step 1: PubMed/Semantic Scholar 检索 KRAS G12C resistance\nStep 2: 按证据等级分组 Meta/RCT/队列/案例\nStep 3: 生成 contradiction group：旁路激活 vs 二次突变\nStep 4: 输出 EvidenceGraph 与 PaperCardList manifest',
    },
  ],
  structure: [
    { role: 'user', content: '分析 PDB:7BZ5 的 Switch-II 口袋，以及 Y96D 突变对结合的影响。' },
    {
      role: 'agent',
      content:
        '结构记录已生成。7BZ5 分辨率 1.79 Å，Switch-II 口袋体积约 628 Å3。Y96D 位点靠近抑制剂结合构象核心区域，当前作为推断性风险标记，需要分子动力学或突变实验验证。',
      confidence: 0.94,
      evidence: 'rct',
      claimType: 'fact',
      expandable:
        'ExecutionUnit: structure.fetch-or-predict\nData fingerprint: PDB:7BZ5 + ligand 6SI\nUI slots: molecule-viewer, evidence-matrix, notebook-timeline',
    },
  ],
  omics: [
    { role: 'user', content: '对 RNA-seq 数据做差异表达，并展示火山图和富集结果。' },
    {
      role: 'agent',
      content:
        'DESeq2 record-only 执行单元已生成。示例结果显示 847 个差异基因，上调 492 个，下调 355 个；干扰素γ反应为最显著富集通路。当前结果是 mock 数据契约，用于验证 UIManifest 渲染。',
      confidence: 0.88,
      evidence: 'prediction',
      claimType: 'inference',
      expandable:
        'ExecutionUnit params: design=~condition, alpha=0.05, seed=1\nArtifacts: volcano-plot, enrichment-table, execution-unit.json',
    },
  ],
  knowledge: [
    { role: 'user', content: '查询 KRAS 靶点的成药性、已上市药物和临床试验。' },
    {
      role: 'agent',
      content:
        '已从 UniProt、ChEMBL、OpenTargets 和 ClinicalTrials 形成知识卡片。KRAS G12C 已有 sotorasib 与 adagrasib 上市，非共价泛 KRAS 抑制剂仍处于临床探索阶段。',
      confidence: 0.96,
      evidence: 'meta',
      claimType: 'fact',
    },
  ],
};

export const paperCards = [
  { title: 'KRAS G12C acquired resistance landscape', source: 'Cancer Discovery', year: '2024', level: 'cohort' as EvidenceLevel },
  { title: 'Adagrasib and sotorasib clinical response comparison', source: 'Nature Medicine', year: '2024', level: 'rct' as EvidenceLevel },
  { title: 'EGFR-MET bypass activation in KRAS inhibitor escape', source: 'JCO', year: '2023', level: 'case' as EvidenceLevel },
];

export const executionUnits = [
  { id: 'EU-001', tool: 'literature.search', params: 'query=KRAS G12C resistance, max=50', status: 'done', hash: 'a3f2c9...', time: '1.8s' },
  { id: 'EU-002', tool: 'evidence.reduce', params: 'levels=meta,rct,cohort,case', status: 'done', hash: 'b7d1e4...', time: '0.6s' },
  { id: 'EU-003', tool: 'structure.fetch', params: 'pdb=7BZ5, ligand=6SI', status: 'done', hash: 'c8e5f2...', time: '2.1s' },
  { id: 'EU-004', tool: 'omics.deseq2', params: 'design=~condition, alpha=0.05', status: 'planned', hash: '-', time: '-' },
];

export const timeline = [
  { time: '2026-04-19 14:30', agent: 'literature' as AgentId, title: 'KRAS G12C 耐药文献综述', desc: '47 篇文献进入证据矩阵，识别 3 类耐药机制', claimType: 'inference' as ClaimType, confidence: 0.91 },
  { time: '2026-04-19 15:05', agent: 'structure' as AgentId, title: '7BZ5 结合口袋分析', desc: 'Switch-II 口袋体积和关键残基已归档', claimType: 'fact' as ClaimType, confidence: 0.94 },
  { time: '2026-04-19 15:40', agent: 'omics' as AgentId, title: '差异表达 mock 契约', desc: '火山图、热图、UMAP 组件契约完成验证', claimType: 'inference' as ClaimType, confidence: 0.82 },
  { time: '2026-04-19 16:10', agent: 'knowledge' as AgentId, title: 'KRAS 知识库卡片', desc: 'UniProt / ChEMBL / OpenTargets 视图进入 manifest', claimType: 'fact' as ClaimType, confidence: 0.96 },
];
