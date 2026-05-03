import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { BioAgentSkillDomain } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-skill-md-capability-'));

const cases: Array<{
  skillDomain: BioAgentSkillDomain;
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
  assert.equal(unit.status, 'repair-needed');
  const routeDecision = unit.routeDecision as Record<string, unknown> | undefined;
  assert.equal(routeDecision?.selectedSkill, `agentserver.generate.${item.skillDomain}`);
  assert.equal(routeDecision?.selectedRuntime, 'agentserver-generation');
  assert.match(String(unit.failureReason || ''), /AgentServer base URL is not configured|no AgentServer base URL is configured/i);
  assert.ok(result.message || unit.failureReason, `${item.skillId} should require AgentServer reasoning before execution`);
  console.log(`[ok] ${item.skillId} SKILL.md request is routed through AgentServer generation`);
}
