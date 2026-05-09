import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentServerArtifactSelectionPromptPolicyLines,
  agentServerBibliographicVerificationPromptPolicyLines,
  agentServerCurrentReferencePromptPolicyLines,
  agentServerToolPayloadProtocolContractLines,
  CURRENT_REFERENCE_GATE_TOOL_ID,
  defaultArtifactSchemaForSkillDomain,
} from './artifact-policy';

test('runtime artifact policy owns AgentServer ToolPayload prompt contract', () => {
  assert.equal(CURRENT_REFERENCE_GATE_TOOL_ID, 'sciforge.current-reference-gate');
  assert.deepEqual(defaultArtifactSchemaForSkillDomain('literature'), { type: 'paper-list' });

  const protocol = agentServerToolPayloadProtocolContractLines().join('\n');
  assert.match(protocol, /ToolPayload schema is strict/);
  assert.match(protocol, /unknown-artifact-inspector/);

  const selection = agentServerArtifactSelectionPromptPolicyLines().join('\n');
  assert.match(selection, /Only treat expectedArtifactTypes as required/);
  assert.match(selection, /generate a coordinated Python task/);

  const currentRefs = agentServerCurrentReferencePromptPolicyLines().join('\n');
  assert.match(currentRefs, /currentReferences/);
  assert.match(currentRefs, /failed-with-reason/);

  const bibliography = agentServerBibliographicVerificationPromptPolicyLines().join('\n');
  assert.match(bibliography, /Bibliographic verification contract/);
  assert.match(bibliography, /verified_title/);
});
