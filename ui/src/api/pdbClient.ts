import type { AgentId } from '../data';
import {
  makeId,
  nowIso,
  type NormalizedAgentResponse,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
} from '../domain';

interface RcsbSearchHit {
  identifier?: string;
}

interface RcsbEntry {
  struct?: {
    title?: string;
  };
  rcsb_accession_info?: {
    initial_release_date?: string;
  };
  rcsb_entry_info?: {
    resolution_combined?: number[];
  };
  exptl?: Array<{
    method?: string;
  }>;
}

export async function runLatestPdbStructureRescue(prompt: string): Promise<NormalizedAgentResponse | null> {
  if (!isLatestPdbPrompt(prompt)) return null;
  const pdbId = await fetchLatestProteinPdbId();
  if (!pdbId) return null;
  const entry = await fetchPdbEntry(pdbId);
  const now = nowIso();
  const title = entry?.struct?.title || `RCSB PDB entry ${pdbId}`;
  const releaseDate = entry?.rcsb_accession_info?.initial_release_date || 'unknown release date';
  const resolution = entry?.rcsb_entry_info?.resolution_combined?.[0];
  const method = entry?.exptl?.[0]?.method || 'experimental structure';
  const artifact: RuntimeArtifact = {
    id: `structure-summary-${pdbId}`,
    type: 'structure-summary',
    producerAgent: 'structure' as AgentId,
    schemaVersion: '1.0.0',
    metadata: {
      source: 'RCSB PDB Search API',
      rescueMode: true,
      prompt,
      releaseDate,
    },
    dataRef: `https://files.rcsb.org/download/${pdbId}.cif`,
    data: {
      pdbId,
      title,
      ligand: '',
      highlightResidues: [],
      metrics: {
        resolution: resolution ?? null,
        pLDDT: null,
        pocketVolume: null,
        mutationRisk: 'not assessed',
      },
      releaseDate,
      method,
    },
  };
  const unit: RuntimeExecutionUnit = {
    id: makeId('EU-pdb'),
    tool: 'RCSB.search.latest-protein-entry',
    params: `sort=initial_release_date desc; return_type=entry; query=${prompt.slice(0, 80)}`,
    status: 'done',
    hash: pdbId,
    environment: 'RCSB PDB public APIs',
    databaseVersions: ['RCSB PDB current'],
    outputArtifacts: [artifact.id],
    dataFingerprint: `${pdbId}:${releaseDate}`,
  };
  const message = [
    `AgentServer 本次没有及时返回可用结构结果，我已用 RCSB PDB native fallback 完成检索。`,
    `最新匹配的蛋白结构条目是 ${pdbId}：${title}。`,
    `发布日期：${releaseDate}；实验方法：${method}${resolution ? `；分辨率：${resolution} A` : ''}。`,
    `结构文件：${artifact.dataRef}`,
  ].join('\n');
  return {
    message: {
      id: makeId('msg'),
      role: 'agent',
      content: message,
      confidence: 0.72,
      evidence: 'database',
      claimType: 'fact',
      expandable: `RCSB PDB rescue run\nentry=${pdbId}\nreleaseDate=${releaseDate}\nsource=${artifact.dataRef}`,
      createdAt: now,
      status: 'completed',
    },
    run: {
      id: makeId('run-pdb'),
      agentId: 'structure',
      status: 'completed',
      prompt,
      response: message,
      createdAt: now,
      completedAt: now,
      raw: { pdbId, entry },
    },
    uiManifest: [
      { componentId: 'molecule-viewer', title: 'PDB 结构可视化', artifactRef: artifact.id, priority: 1 },
      { componentId: 'execution-unit-table', title: 'RCSB 检索记录', priority: 2 },
      { componentId: 'evidence-matrix', title: '数据库证据', priority: 3 },
    ],
    claims: [{
      id: makeId('claim'),
      text: `${pdbId} 是 RCSB PDB 当前最新匹配的蛋白结构条目之一。`,
      type: 'fact',
      confidence: 0.72,
      evidenceLevel: 'database',
      supportingRefs: [artifact.dataRef || `https://www.rcsb.org/structure/${pdbId}`],
      opposingRefs: [],
      updatedAt: now,
    }],
    executionUnits: [unit],
    artifacts: [artifact],
    notebook: [{
      id: makeId('note'),
      time: new Date(now).toLocaleString('zh-CN', { hour12: false }),
      agent: 'structure',
      title: `RCSB 最新结构 ${pdbId}`,
      desc: title.slice(0, 96),
      claimType: 'fact',
      confidence: 0.72,
    }],
  };
}

function isLatestPdbPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  return normalized.includes('pdb') && (normalized.includes('最新') || normalized.includes('latest'));
}

async function fetchLatestProteinPdbId() {
  const response = await fetch('https://search.rcsb.org/rcsbsearch/v2/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        type: 'terminal',
        service: 'text',
        parameters: {
          attribute: 'rcsb_entry_info.polymer_entity_count_protein',
          operator: 'greater',
          value: 0,
        },
      },
      request_options: {
        paginate: { start: 0, rows: 1 },
        sort: [{ sort_by: 'rcsb_accession_info.initial_release_date', direction: 'desc' }],
      },
      return_type: 'entry',
    }),
  });
  if (!response.ok) return null;
  const json = await response.json() as { result_set?: RcsbSearchHit[] };
  return json.result_set?.[0]?.identifier || null;
}

async function fetchPdbEntry(pdbId: string): Promise<RcsbEntry | null> {
  const response = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${pdbId}`);
  if (!response.ok) return null;
  return await response.json() as RcsbEntry;
}
