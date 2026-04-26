import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadSkillRegistry, matchSkill } from '../../src/runtime/skill-registry.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { BioAgentSkillDomain, ToolPayload } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-tools-skills-diverse-'));
await writeFile(join(workspace, 'matrix.csv'), [
  'gene,c1,c2,c3,t1,t2,t3',
  'EGFR,12,11,13,48,51,50',
  'KRAS,90,88,92,30,28,33',
  'ALK,8,7,9,20,21,18',
  'ACTB,55,57,54,56,55,57',
  '',
].join('\n'));
await writeFile(join(workspace, 'metadata.csv'), [
  'sample,condition,batch',
  'c1,control,A',
  'c2,control,A',
  'c3,control,B',
  't1,treated,A',
  't2,treated,B',
  't3,treated,B',
  '',
].join('\n'));

const registry = await loadSkillRegistry({ workspacePath: workspace });
assert.equal(registry.filter((skill) => skill.id.startsWith('scp.') && skill.available).length, 121);

const routeCases: Array<{ name: string; skillDomain: BioAgentSkillDomain; prompt: string; expectedSkill: string }> = [
  {
    name: 'literature PubMed seed',
    skillDomain: 'literature',
    prompt: 'KRAS G12D pancreatic cancer resistance review papers with evidence matrix',
    expectedSkill: 'literature.pubmed_search',
  },
  {
    name: 'literature explicit Google/web search',
    skillDomain: 'literature',
    prompt: '通过google搜索一下今天arxiv上AI+生命科学的文章',
    expectedSkill: 'literature.web_search',
  },
  {
    name: 'structure RCSB seed',
    skillDomain: 'structure',
    prompt: 'Fetch PDB 1A3N and show chain/residue metadata in molecule viewer',
    expectedSkill: 'structure.rcsb_latest_or_entry',
  },
  {
    name: 'knowledge UniProt seed',
    skillDomain: 'knowledge',
    prompt: 'P04637 UniProt protein knowledge graph and source-linked table',
    expectedSkill: 'knowledge.uniprot_chembl_lookup',
  },
  {
    name: 'knowledge BLASTP seed',
    skillDomain: 'knowledge',
    prompt: 'BLASTP protein sequence alignment result table for sequence=MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKT',
    expectedSkill: 'sequence.ncbi_blastp_search',
  },
  {
    name: 'omics local matrix seed',
    skillDomain: 'omics',
    prompt: 'matrixRef=matrix.csv metadataRef=metadata.csv groupColumn=condition caseGroup=treated controlGroup=control runner=csv show volcano heatmap and UMAP',
    expectedSkill: 'omics.differential_expression',
  },
  {
    name: 'SCP markdown protein properties',
    skillDomain: 'knowledge',
    prompt: 'Calculate protein physicochemical properties molecular weight isoelectric point instability index and amino acid composition for sequence MKWVTFISLLFLFSSAYSRGVFRRDTHKSEIAHRFKDLGE',
    expectedSkill: 'scp.protein-properties-calculation',
  },
  {
    name: 'SCP markdown TCGA expression',
    skillDomain: 'omics',
    prompt: 'Query TCGA gene expression for EGFR in LUAD tumor versus normal and include subtype and survival context',
    expectedSkill: 'scp.tcga-gene-expression',
  },
  {
    name: 'SCP markdown docking/structure',
    skillDomain: 'structure',
    prompt: 'Run molecular docking for aspirin against a target structure and report binding site interactions',
    expectedSkill: 'scp.drug-screening-docking',
  },
  {
    name: 'SCP markdown biomedical search',
    skillDomain: 'literature',
    prompt: 'Use biomedical web search across PubMed UniProt DrugBank for BRCA1 PARP inhibitor resistance',
    expectedSkill: 'scp.biomedical-web-search',
  },
];

for (const item of routeCases) {
  const matched = matchSkill({
    skillDomain: item.skillDomain,
    prompt: item.prompt,
    workspacePath: workspace,
    artifacts: [],
  }, registry);
  assert.equal(matched?.id, item.expectedSkill, `${item.name} routed to ${matched?.id || 'none'}`);
  console.log(`[ok] route ${item.name} -> ${item.expectedSkill}`);
}

const runtimeCases: Array<{
  name: string;
  skillDomain: BioAgentSkillDomain;
  prompt: string;
  artifactType: string;
  skillId: string;
  requiredComponents: string[];
}> = [
  {
    name: 'omics runner with local CSV',
    skillDomain: 'omics',
    prompt: 'matrixRef=matrix.csv metadataRef=metadata.csv groupColumn=condition caseGroup=treated controlGroup=control runner=csv show volcano heatmap and UMAP',
    artifactType: 'omics-differential-expression',
    skillId: 'omics.differential_expression',
    requiredComponents: ['volcano-plot', 'heatmap-viewer', 'umap-viewer', 'execution-unit-table'],
  },
  {
    name: 'knowledge UniProt lookup',
    skillDomain: 'knowledge',
    prompt: 'TP53 gene knowledge graph with data table and evidence matrix',
    artifactType: 'knowledge-graph',
    skillId: 'knowledge.uniprot_chembl_lookup',
    requiredComponents: ['network-graph', 'data-table', 'evidence-matrix', 'execution-unit-table'],
  },
  {
    name: 'structure coordinate fetch',
    skillDomain: 'structure',
    prompt: 'PDB 7BZ5 residues 142-158 show molecule-viewer data-table and execution unit',
    artifactType: 'structure-summary',
    skillId: 'structure.rcsb_latest_or_entry',
    requiredComponents: ['molecule-viewer', 'data-table', 'execution-unit-table'],
  },
];

for (const item of runtimeCases) {
  const result = await retryRuntime(item);
  assertRuntimePayload(item, result);
  console.log(`[ok] runtime ${item.name} -> ${item.artifactType}`);
}

const markdownOnly = await runWorkspaceRuntimeGateway({
  skillDomain: 'knowledge',
  prompt: 'Calculate protein physicochemical properties molecular weight isoelectric point instability index and amino acid composition for sequence MKWVTFISLLFLFSSAYSRGVFRRDTHKSEIAHRFKDLGE',
  workspacePath: workspace,
  artifacts: [],
});
assert.equal(markdownOnly.executionUnits[0]?.status, 'failed-with-reason');
assert.match(String(markdownOnly.reasoningTrace), /scp\.protein-properties-calculation/);
assert.match(String(markdownOnly.message), /SCP_HUB_API_KEY|SCPhub_api_key/);
console.log('[ok] runtime SCP live skill reports missing API key without fake artifacts');

async function retryRuntime(item: (typeof runtimeCases)[number]) {
  let last: ToolPayload | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await runWorkspaceRuntimeGateway({
      skillDomain: item.skillDomain,
      prompt: item.prompt,
      workspacePath: workspace,
      artifacts: [],
    });
    if (last.artifacts.some((artifact) => artifact.type === item.artifactType) && last.executionUnits[0]?.status === 'done') return last;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  throw new Error(`${item.name} failed: ${JSON.stringify({
    message: last?.message,
    status: last?.executionUnits?.[0]?.status,
    skillId: last?.executionUnits?.[0]?.skillId,
    artifactTypes: last?.artifacts?.map((artifact) => artifact.type),
  })}`);
}

function assertRuntimePayload(
  expected: (typeof runtimeCases)[number],
  result: ToolPayload,
) {
  assert.ok(result.artifacts.some((artifact) => artifact.type === expected.artifactType), `${expected.name} artifact missing`);
  assert.equal(result.executionUnits[0]?.skillId, expected.skillId);
  assert.equal(result.executionUnits[0]?.status, 'done');
  const components = result.uiManifest.map((slot) => String(slot.componentId));
  for (const component of expected.requiredComponents) {
    assert.ok(components.includes(component), `${expected.name} missing component ${component}; got ${components.join(', ')}`);
  }
}
