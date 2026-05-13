import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runWorkspaceRuntimeGateway } from './generation-gateway.js';

test('runtime gateway fails closed before AgentServer when conversation policy fails without turn constraints', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-policy-fail-closed-'));
  const original = {
    mode: process.env.SCIFORGE_CONVERSATION_POLICY_MODE,
    command: process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON,
  };
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'active';
  process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON = '/usr/bin/false';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Summarize current context from available refs.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
    });

    assert.equal(payload.artifacts[0]?.id, 'runtime-execution-forbidden');
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.conversation-policy');
    assert.match(payload.message, /fail-closed|没有启动新的 runtime/);
    assert.doesNotMatch(JSON.stringify(payload), /agentserver\.generate/);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original.mode);
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_PYTHON', original.command);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('agentServerForbidden constraints override forced AgentServer generation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-forbidden-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use existing current refs only.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
      uiState: {
        forceAgentServerGeneration: true,
        turnExecutionConstraints: {
          schemaVersion: 'sciforge.turn-execution-constraints.v1',
          policyId: 'sciforge.current-turn-execution-constraints.v1',
          source: 'runtime-contract.turn-constraints',
          contextOnly: true,
          agentServerForbidden: true,
          workspaceExecutionForbidden: false,
          externalIoForbidden: false,
          codeExecutionForbidden: false,
          reasons: ['AgentServer dispatch is forbidden by structured current-turn constraints.'],
          evidence: { hasPriorContext: true, referenceCount: 1 },
        },
      },
    });

    assert.equal(payload.artifacts[0]?.id, 'agentserver-dispatch-forbidden');
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.turn-execution-constraints');
    assert.match(payload.message, /没有启动 AgentServer/);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
