import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentServerExecutionModePromptPolicyLines,
  agentServerExternalIoReliabilityContractLines,
  agentServerFreshRetrievalPromptPolicyLines,
  agentServerGeneratedTaskPromptPolicyLines,
  agentServerRepairPromptPolicyLines,
} from './runtime-policy';

test('skills runtime policy owns AgentServer retrieval and task prompt snippets', () => {
  const executionMode = agentServerExecutionModePromptPolicyLines().join('\n');
  assert.match(executionMode, /thin-reproducible-adapter/);
  assert.match(executionMode, /For lightweight search\/news\/current-events lookups/);
  assert.match(executionMode, /For heavy or durable work/);

  const taskPolicy = agentServerGeneratedTaskPromptPolicyLines().join('\n');
  assert.match(taskPolicy, /Entrypoint contract/);
  assert.match(taskPolicy, /inputPath argument/);

  const freshRetrieval = agentServerFreshRetrievalPromptPolicyLines().join('\n');
  assert.match(freshRetrieval, /fresh retrieval\/analysis\/report requests/);

  const repair = agentServerRepairPromptPolicyLines().join('\n');
  assert.match(repair, /failureReason/);
  assert.match(repair, /logs are readable/);

  const externalIo = agentServerExternalIoReliabilityContractLines().join('\n');
  assert.match(externalIo, /External I\/O reliability contract/);
  assert.match(externalIo, /For provider-specific APIs/);
});
