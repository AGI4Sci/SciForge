import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { BioAgentSkillDomain, ToolPayload } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-seed-runtime-'));
await writeFile(join(workspace, 'matrix.csv'), [
  'gene,c1,c2,t1,t2',
  'TP53,10,11,40,42',
  'MYC,80,82,20,18',
  'ACTB,50,51,50,49',
  '',
].join('\n'));
await writeFile(join(workspace, 'metadata.csv'), [
  'sample,condition',
  'c1,control',
  'c2,control',
  't1,treated',
  't2,treated',
  '',
].join('\n'));

const cases: Array<{
  skillDomain: BioAgentSkillDomain;
  prompt: string;
  artifactType: string;
  skillId: string;
  availableSkills?: string[];
  uiState?: Record<string, unknown>;
  allowedStatuses?: string[];
}> = [
  {
    skillDomain: 'literature',
    prompt: 'TP53 tumor suppressor reviews',
    artifactType: 'paper-list',
    skillId: 'literature.pubmed_search',
  },
  {
    skillDomain: 'structure',
    prompt: 'PDB 7BZ5 residues 142-158',
    artifactType: 'structure-summary',
    skillId: 'structure.rcsb_latest_or_entry',
  },
  {
    skillDomain: 'structure',
    prompt: '请使用已注册本地 workspace skill structure.rcsb_latest_or_entry；不要生成新代码，不要调用 AgentServer。对 PDB 6LUD 运行真实 RCSB metadata/coordinate retrieval。',
    artifactType: 'structure-summary',
    skillId: 'structure.rcsb_latest_or_entry',
    availableSkills: ['structure.rcsb_latest_or_entry'],
    uiState: {
      freshTaskGeneration: true,
      forceAgentServerGeneration: false,
      scenarioPackageRef: { id: 'workspace-structure-exploration-t055-smoke', version: '1.0.0', source: 'workspace' },
    },
  },
  {
    skillDomain: 'knowledge',
    prompt: 'TP53 gene',
    artifactType: 'knowledge-graph',
    skillId: 'knowledge.uniprot_chembl_lookup',
  },
  {
    skillDomain: 'knowledge',
    prompt: 'sotorasib compound ChEMBL',
    artifactType: 'knowledge-graph',
    skillId: 'knowledge.uniprot_chembl_lookup',
  },
  {
    skillDomain: 'omics',
    prompt: 'matrixRef=matrix.csv metadataRef=metadata.csv groupColumn=condition caseGroup=treated controlGroup=control',
    artifactType: 'omics-differential-expression',
    skillId: 'omics.differential_expression',
  },
];

for (const item of cases) {
  const result = await runSeedCase(item);
  assertSeedResult(item, result);
  console.log(`[ok] ${item.skillId} -> ${item.artifactType}`);
}

async function runSeedCase(item: {
  skillDomain: BioAgentSkillDomain;
  prompt: string;
  artifactType: string;
  skillId: string;
  availableSkills?: string[];
  uiState?: Record<string, unknown>;
}) {
  let last: ToolPayload | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await runWorkspaceRuntimeGateway({
      skillDomain: item.skillDomain,
      prompt: item.prompt,
      workspacePath: workspace,
      artifacts: [],
      availableSkills: item.availableSkills,
      uiState: item.uiState,
    });
    if (last.artifacts[0]?.type === item.artifactType && last.executionUnits[0]?.status === 'done') return last;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  throw new Error([
    `${item.skillId} did not return ${item.artifactType} after retries.`,
    `message=${last?.message || ''}`,
    `unitStatus=${String(last?.executionUnits?.[0]?.status || '')}`,
    `failureReason=${String(last?.executionUnits?.[0]?.failureReason || '')}`,
    `artifactType=${String(last?.artifacts?.[0]?.type || '')}`,
  ].join(' '));
}

function assertSeedResult(
  expected: { skillDomain: BioAgentSkillDomain; artifactType: string; skillId: string },
  result: ToolPayload,
) {
  assert.equal(result.artifacts[0]?.type, expected.artifactType);
  assert.equal(result.executionUnits[0]?.skillId, expected.skillId);
  assert.equal(result.executionUnits[0]?.status, 'done');
  assert.ok(result.executionUnits[0]?.codeRef, `${expected.skillId} should record codeRef`);
  assert.ok(result.executionUnits[0]?.stdoutRef, `${expected.skillId} should record stdoutRef`);
  assert.ok(result.executionUnits[0]?.stderrRef, `${expected.skillId} should record stderrRef`);
  assert.match(String(result.reasoningTrace), new RegExp(expected.skillId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
