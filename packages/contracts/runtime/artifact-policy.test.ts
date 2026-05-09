import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentServerArtifactSelectionPromptPolicyLines,
  agentServerToolPayloadProtocolContractLines,
  defaultArtifactSchemaForSkillDomain,
} from './artifact-policy';

test('runtime artifact policy owns AgentServer ToolPayload prompt contract', () => {
  assert.deepEqual(defaultArtifactSchemaForSkillDomain('literature'), { type: 'paper-list' });

  const protocol = agentServerToolPayloadProtocolContractLines().join('\n');
  assert.match(protocol, /ToolPayload schema is strict/);
  assert.match(protocol, /unknown-artifact-inspector/);

  const selection = agentServerArtifactSelectionPromptPolicyLines().join('\n');
  assert.match(selection, /Only treat expectedArtifactTypes as required/);
  assert.match(selection, /generate a coordinated Python task/);
});
