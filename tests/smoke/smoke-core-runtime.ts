import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { SciForgeSkillDomain } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-skill-md-capability-'));

const cases: Array<{
  skillDomain: SciForgeSkillDomain;
  prompt: string;
  skillId: string;
  expectedArtifactType: string;
}> = [
  {
    skillDomain: 'literature',
    prompt: 'Extract text from this uploaded PDF for LLM processing',
    skillId: 'pdf-extract',
    expectedArtifactType: 'research-report',
  },
  {
    skillDomain: 'knowledge',
    prompt: 'BLASTP protein sequence alignment',
    skillId: 'scp.protein-blast-search',
    expectedArtifactType: 'sequence-alignment',
  },
  {
    skillDomain: 'omics',
    prompt: 'biomarker discovery from gene expression differential analysis',
    skillId: 'scp.biomarker_discovery',
    expectedArtifactType: 'omics-differential-expression',
  },
];

for (const item of cases) {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: item.skillDomain,
    prompt: item.prompt,
    workspacePath: workspace,
    artifacts: [],
    availableSkills: [item.skillId],
    expectedArtifactTypes: [item.expectedArtifactType],
    selectedComponentIds: ['execution-unit-table'],
    uiState: {
      forceAgentServerGeneration: false,
      freshTaskGeneration: true,
    },
  });

  const unit = result.executionUnits[0] ?? {};
  assert.equal(unit.status, 'needs-human');
  assert.match(String(unit.tool || ''), /sciforge\.(?:capability-provider-preflight|runtime-codex)/);
  assert.match(
    [result.message, unit.failureReason, unit.params, unit.nextStep].map(String).join('\n'),
    /provider route|legacy AgentServer generation fallback is retired|migrated Runtime Codex/,
  );
  assert.ok(result.message || unit.failureReason, `${item.skillId} should fail closed without legacy generation fallback`);
  console.log(`[ok] ${item.skillId} SKILL.md request fails closed without legacy AgentServer generation fallback`);
}
