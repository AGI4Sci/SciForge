import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-knowledge-unsupported-'));
const result = await runWorkspaceRuntimeGateway({
  skillDomain: 'knowledge',
  prompt: 'melanoma disease OpenTargets connector status',
  availableSkills: ['knowledge.uniprot_chembl_lookup'],
  workspacePath: workspace,
});

assert.equal(result.executionUnits.length, 1);
assert.equal(result.executionUnits[0].status, 'repair-needed');
assert.match(String(result.executionUnits[0].failureReason || result.message), /AgentServer|base URL|generation/i);
assert.ok(
  result.artifacts.some((artifact) => artifact.type === 'runtime-diagnostic'),
  'unsupported knowledge requests should preserve visible runtime diagnostics instead of returning an empty result panel',
);
assert.ok(
  result.artifacts.some((artifact) => artifact.type === 'verification-result'),
  'unsupported knowledge requests should keep verification evidence for audit and repair',
);

console.log('[ok] knowledge unsupported smoke returns repair-needed diagnostics without fabricated knowledge graph success');
