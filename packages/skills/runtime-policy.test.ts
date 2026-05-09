import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentServerGeneratedEntrypointContractReason,
  agentServerGeneratedTaskInterfaceContractReason,
  agentServerExecutionModePromptPolicyLines,
  agentServerExternalIoReliabilityContractLines,
  agentServerFreshRetrievalPromptPolicyLines,
  agentServerGeneratedTaskPromptPolicyLines,
  agentServerGeneratedTaskRetryDetail,
  agentServerPathOnlyStrictRetryDirectPayloadReason,
  agentServerPathOnlyStrictRetryStillMissingReason,
  agentServerPathOnlyTaskFilesReason,
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

test('skills runtime policy owns generated task retry and interface contract semantics', () => {
  assert.match(agentServerGeneratedTaskRetryDetail('entrypoint'), /Retrying AgentServer generation once/);
  assert.match(agentServerGeneratedTaskRetryDetail('task-interface'), /generated tasks must consume/);

  const entrypointReason = agentServerGeneratedEntrypointContractReason({
    entrypoint: { path: '.sciforge/tasks/report.md', language: 'markdown' },
    taskFiles: [{ path: '.sciforge/tasks/report.md', language: 'markdown', content: '# Report' }],
  });
  assert.match(String(entrypointReason), /non-executable artifact\/report/);

  const interfaceReason = agentServerGeneratedTaskInterfaceContractReason({
    entryRel: '.sciforge/tasks/static.py',
    language: 'python',
    source: 'print("static answer")',
  });
  assert.match(String(interfaceReason), /does not read the SciForge inputPath argument and write the SciForge outputPath argument/);

  assert.equal(agentServerGeneratedTaskInterfaceContractReason({
    entryRel: '.sciforge/tasks/adapter.py',
    language: 'python',
    source: 'import sys\ninput_path = sys.argv[1]\noutput_path = sys.argv[2]\n',
  }), undefined);

  const pathOnly = agentServerPathOnlyTaskFilesReason(['.sciforge/tasks/a.py']);
  assert.match(pathOnly, /path-only taskFiles/);
  assert.match(agentServerPathOnlyStrictRetryDirectPayloadReason(pathOnly), /direct ToolPayload/);
  assert.match(agentServerPathOnlyStrictRetryStillMissingReason(pathOnly, ['.sciforge/tasks/a.py']), /Strict retry still returned path-only/);
});
