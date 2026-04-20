import { BIOAGENT_PROFILES } from '../agentProfiles';
import type { AgentId, ClaimType, EvidenceLevel } from '../data';
import {
  makeId,
  nowIso,
  type BioAgentRun,
  type EvidenceClaim,
  type NormalizedAgentResponse,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type UIManifestSlot,
} from '../domain';

interface LocalAdapterPayload {
  message: string;
  confidence: number;
  evidenceLevel: EvidenceLevel;
  claimType: ClaimType;
  reasoningTrace: string;
  claims: Array<Omit<EvidenceClaim, 'id' | 'updatedAt'>>;
  artifact: RuntimeArtifact;
}

export function runLocalBioAgentAdapter(agentId: AgentId, prompt: string): NormalizedAgentResponse {
  const profile = BIOAGENT_PROFILES[agentId];
  const now = nowIso();
  const runId = makeId(`local-${agentId}`);
  const payload = localPayload(agentId, prompt);
  const executionUnit: RuntimeExecutionUnit = {
    id: `EU-${runId.slice(-6)}`,
    tool: `${agentId}.local-record-adapter`,
    params: JSON.stringify({ prompt, mode: 'record-only' }),
    status: profile.executionDefaults.status,
    hash: runId.slice(0, 10),
    code: `localAdapter("${agentId}")`,
    seed: stableSeed(prompt),
    time: 'record-only',
    environment: profile.executionDefaults.environment,
    inputData: [prompt],
    dataFingerprint: fingerprint(`${agentId}:${prompt}`),
    databaseVersions: profile.executionDefaults.databaseVersions,
    artifacts: [payload.artifact.id],
    outputArtifacts: [payload.artifact.type],
  };
  const run: BioAgentRun = {
    id: runId,
    agentId,
    status: 'completed',
    prompt,
    response: payload.message,
    createdAt: now,
    completedAt: now,
    raw: { source: 'local-record-adapter', profile: agentId },
  };
  const uiManifest: UIManifestSlot[] = profile.defaultSlots.map((slot) => ({
    ...slot,
    artifactRef: slot.artifactRef ?? payload.artifact.type,
  }));

  return {
    message: {
      id: makeId('msg'),
      role: 'agent',
      content: payload.message,
      confidence: payload.confidence,
      evidence: payload.evidenceLevel,
      claimType: payload.claimType,
      expandable: payload.reasoningTrace,
      createdAt: now,
      status: 'completed',
    },
    run,
    uiManifest,
    claims: payload.claims.map((claim) => ({
      ...claim,
      id: makeId('claim'),
      updatedAt: now,
    })),
    executionUnits: [executionUnit],
    artifacts: [payload.artifact],
    notebook: [{
      id: makeId('note'),
      time: new Date(now).toLocaleString('zh-CN', { hour12: false }),
      agent: agentId,
      title: `Local adapter: ${prompt.slice(0, 28)}`,
      desc: payload.message.slice(0, 96),
      claimType: payload.claimType,
      confidence: payload.confidence,
    }],
  };
}

function localPayload(agentId: AgentId, prompt: string): LocalAdapterPayload {
  if (agentId === 'literature') return literaturePayload(prompt);
  if (agentId === 'structure') return structurePayload(prompt);
  if (agentId === 'omics') return omicsPayload(prompt);
  return knowledgePayload(prompt);
}

function literaturePayload(prompt: string): LocalAdapterPayload {
  const query = prompt || 'KRAS G12C resistance';
  const artifact: RuntimeArtifact = {
    id: 'paper-list',
    type: 'paper-list',
    producerAgent: 'literature',
    schemaVersion: '1',
    metadata: { mode: 'record-only', query },
    data: {
      query,
      papers: [
        {
          title: 'Record-only review: KRAS G12C resistance mechanisms',
          authors: ['BioAgent local adapter'],
          journal: 'Local fixture',
          year: '2026',
          url: '',
          abstract: 'Record-only summary for UI and pipeline validation; replace with PubMed/Semantic Scholar output in real mode.',
          evidenceLevel: 'review',
        },
        {
          title: 'EGFR/MET bypass activation record',
          authors: ['BioAgent local adapter'],
          journal: 'Local fixture',
          year: '2026',
          url: '',
          abstract: 'Supports a common bypass-activation hypothesis for KRAS inhibitor resistance.',
          evidenceLevel: 'cohort',
        },
      ],
    },
  };
  return {
    message: '已生成文献 Agent 的 record-only 检索草案。它遵循 paper-list schema，可驱动文献卡片和证据矩阵，但需要真实文献工具替换来源。',
    confidence: 0.72,
    evidenceLevel: 'review',
    claimType: 'inference',
    reasoningTrace: `Local adapter parsed query: ${query}\nNext real tool: PubMed/Semantic Scholar search.`,
    claims: [{
      text: 'KRAS G12C 耐药常见分析路径包括旁路激活、二次突变和组织学转化。',
      type: 'inference',
      confidence: 0.72,
      evidenceLevel: 'review',
      supportingRefs: ['paper-list:record-only-review'],
      opposingRefs: [],
    }],
    artifact,
  };
}

function structurePayload(prompt: string): LocalAdapterPayload {
  const pdbId = extractToken(prompt, /\b[0-9][A-Za-z0-9]{3}\b/);
  const artifact: RuntimeArtifact = {
    id: 'structure-summary',
    type: 'structure-summary',
    producerAgent: 'structure',
    schemaVersion: '1',
    metadata: { mode: 'record-only', source: 'local-adapter' },
    data: {
      pdbId: pdbId ?? '',
      ligand: prompt.toUpperCase().includes('6SI') ? '6SI' : 'unknown',
      highlightResidues: prompt.match(/[A-Z][0-9]{2,4}[A-Z]/g) ?? ['Y96D'],
      pocketLabel: 'Candidate binding pocket',
      metrics: {
        pLDDT: 88.5,
        resolution: undefined,
        pocketVolume: 628,
        mutationRisk: prompt.match(/[A-Z][0-9]{2,4}[A-Z]/g)?.[0] ?? 'review-needed',
      },
    },
  };
  return {
    message: pdbId
      ? `已生成 ${pdbId} 的结构 record-only 草案；真实坐标需要 BioAgent project tool 或 AgentServer backend 完成。`
      : '没有明确 PDB ID，local adapter 不会替换为默认 7BZ5；请连接 BioAgent project tool 进行 RCSB 搜索，或返回无法完成的原因。',
    confidence: pdbId ? 0.56 : 0.35,
    evidenceLevel: 'database',
    claimType: 'inference',
    reasoningTrace: pdbId
      ? `Local adapter extracted PDB=${pdbId}; no remote structure fetch was performed.`
      : 'Local adapter found no PDB ID and intentionally avoided default/demo substitution.',
    claims: [{
      text: pdbId
        ? `${pdbId} 已形成结构分析草案，关键残基和口袋指标需要真实结构工具确认。`
        : 'Local adapter did not select a structure because the prompt lacks an explicit PDB ID and no remote search was available.',
      type: 'inference',
      confidence: pdbId ? 0.56 : 0.35,
      evidenceLevel: 'database',
      supportingRefs: ['structure-summary:record-only'],
      opposingRefs: [],
    }],
    artifact,
  };
}

function omicsPayload(prompt: string): LocalAdapterPayload {
  const points = ['TP53', 'MYC', 'BRCA1', 'EGFR', 'MET', 'KRAS'].map((gene, index) => {
    const logFC = Math.sin(index * 1.7) * 2.6;
    const pValue = 10 ** -(2 + index * 0.55);
    return { gene, logFC, pValue, fdr: Math.min(0.2, pValue * 8), significant: Math.abs(logFC) > 1 && pValue < 0.01 };
  });
  const artifact: RuntimeArtifact = {
    id: 'omics-differential-expression',
    type: 'omics-differential-expression',
    producerAgent: 'omics',
    schemaVersion: '1',
    metadata: { mode: 'demo-record-only', prompt },
    data: {
      points,
      heatmap: {
        label: 'record-only expression matrix',
        matrix: [
          [1.1, 0.5, -0.7, -1.1],
          [0.3, 0.9, -0.4, -0.6],
          [-1.0, -0.2, 0.8, 1.4],
          [0.6, -0.3, 1.1, -0.9],
        ],
      },
      umap: [
        { x: -1.2, y: 0.4, cluster: 'control' },
        { x: -0.8, y: 0.7, cluster: 'control' },
        { x: 1.1, y: -0.3, cluster: 'treated' },
        { x: 1.4, y: -0.6, cluster: 'treated' },
      ],
    },
  };
  return {
    message: '已生成组学 Agent 的 record-only 差异分析草案，包含 volcano/heatmap/UMAP artifact。真实 DESeq2/Scanpy 执行仍待 backend 接入。',
    confidence: 0.7,
    evidenceLevel: 'experimental',
    claimType: 'inference',
    reasoningTrace: 'Local adapter generated deterministic demo matrix and differential-expression points.',
    claims: [{
      text: '示例差异分析提示 TP53/MYC 等基因可作为下游文献或知识库查询入口。',
      type: 'hypothesis',
      confidence: 0.7,
      evidenceLevel: 'experimental',
      supportingRefs: ['omics-differential-expression:record-only'],
      opposingRefs: [],
    }],
    artifact,
  };
}

function knowledgePayload(prompt: string): LocalAdapterPayload {
  const entity = extractToken(prompt, /\b[A-Z0-9]{2,12}\b/) ?? 'KRAS';
  const artifact: RuntimeArtifact = {
    id: 'knowledge-graph',
    type: 'knowledge-graph',
    producerAgent: 'knowledge',
    schemaVersion: '1',
    metadata: { mode: 'record-only', entity },
    data: {
      nodes: [
        { id: entity, label: entity, type: 'gene', confidence: 0.9 },
        { id: 'SOTORASIB', label: 'Sotorasib', type: 'drug', confidence: 0.86 },
        { id: 'MAPK', label: 'MAPK pathway', type: 'pathway', confidence: 0.82 },
      ],
      edges: [
        { source: entity, target: 'SOTORASIB', relation: 'targeted_by', evidenceLevel: 'database' },
        { source: entity, target: 'MAPK', relation: 'participates_in', evidenceLevel: 'database' },
      ],
      rows: [
        { key: 'entity', value: entity, source: 'local adapter' },
        { key: 'candidate_drugs', value: entity === 'KRAS' ? 'sotorasib, adagrasib' : 'review needed', source: 'record-only' },
        { key: 'pathway', value: 'MAPK signaling', source: 'record-only' },
      ],
    },
  };
  return {
    message: `已生成 ${entity} 的知识库 record-only 草案，可驱动知识网络和知识卡片。真实 UniProt/ChEMBL/OpenTargets 查询仍待 backend 接入。`,
    confidence: 0.74,
    evidenceLevel: 'database',
    claimType: 'fact',
    reasoningTrace: `Local adapter extracted entity=${entity}; no remote database query was performed.`,
    claims: [{
      text: `${entity} 已进入知识图谱草案，可作为文献、结构或组学 Agent 的上下文输入。`,
      type: 'fact',
      confidence: 0.74,
      evidenceLevel: 'database',
      supportingRefs: ['knowledge-graph:record-only'],
      opposingRefs: [],
    }],
    artifact,
  };
}

function extractToken(text: string, pattern: RegExp) {
  return text.match(pattern)?.[0]?.toUpperCase();
}

function stableSeed(text: string) {
  return Array.from(text).reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 17);
}

function fingerprint(text: string) {
  return `sha256:${stableSeed(text).toString(16).padStart(8, '0')}`;
}
