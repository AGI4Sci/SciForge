import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types';
import { agentServerAgentId, agentServerContextPolicy, compactAgentServerCoreSnapshot, currentTurnReferences, requestNeedsAgentServerContinuity } from './agentserver-context-window';

test('digest-only current turn is isolated from AgentServer continuity context', () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'Summarize the current digest only.',
    artifacts: [],
    uiState: {
      sessionId: 'session-1',
      currentReferenceDigests: [{
        id: 'digest-1',
        status: 'ok',
        sourceRef: 'file:current.md',
        digestRef: '.sciforge/digests/current.md',
        digestText: 'Current bounded digest.',
      }],
    },
  } as GatewayRequest;

  assert.equal(currentTurnReferences(request).length, 1);
  assert.equal(requestNeedsAgentServerContinuity(request), false);
  assert.deepEqual(agentServerContextPolicy(request), {
    includeCurrentWork: false,
    includeRecentTurns: false,
    includePersistent: false,
    includeMemory: false,
    persistRunSummary: false,
    persistExtractedConstraints: false,
    maxContextWindowTokens: undefined,
    contextWindowLimit: undefined,
    modelContextWindow: undefined,
  });
});

test('pure multi-turn recall uses stable AgentServer session context', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '你还记得我一开始问的问题吗？',
    artifacts: [],
    uiState: {
      sessionId: 'session-memory-1',
      contextReusePolicy: {
        mode: 'continue',
        historyReuse: { allowed: true, scope: 'same-task-recent-turns' },
      },
    },
  } as GatewayRequest;
  const followup = {
    ...request,
    prompt: '我一开始问的是什么？',
  } as GatewayRequest;

  assert.equal(requestNeedsAgentServerContinuity(request), true);
  assert.deepEqual(agentServerContextPolicy(request), {
    includeCurrentWork: true,
    includeRecentTurns: true,
    includePersistent: false,
    includeMemory: false,
    persistRunSummary: true,
    persistExtractedConstraints: false,
    maxContextWindowTokens: undefined,
    contextWindowLimit: undefined,
    modelContextWindow: undefined,
  });
  assert.equal(agentServerAgentId(request, 'task-generation'), agentServerAgentId(followup, 'task-generation'));
});

test('repair continuation uses stable session id without implicit raw AgentServer current work', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '请复用失败诊断继续，修正生成任务并完成报告。',
    artifacts: [],
    uiState: {
      sessionId: 'session-repair-1',
      contextReusePolicy: {
        mode: 'repair',
        historyReuse: { allowed: true, scope: 'failed-run' },
      },
      recentExecutionRefs: [{
        id: 'EU-failed',
        status: 'repair-needed',
        codeRef: '.sciforge/tasks/generated-literature.py',
        stdoutRef: '.sciforge/logs/generated.stdout.log',
        stderrRef: '.sciforge/logs/generated.stderr.log',
        outputRef: '.sciforge/task-results/generated.json',
      }],
    },
  } as GatewayRequest;

  assert.equal(requestNeedsAgentServerContinuity(request), true);
  assert.deepEqual(agentServerContextPolicy(request), {
    includeCurrentWork: false,
    includeRecentTurns: false,
    includePersistent: false,
    includeMemory: false,
    persistRunSummary: true,
    persistExtractedConstraints: false,
    maxContextWindowTokens: undefined,
    contextWindowLimit: undefined,
    modelContextWindow: undefined,
  });
});

test('AgentServer core snapshot recent turns are refs and digests only', () => {
  const snapshot = compactAgentServerCoreSnapshot({
    session: { id: 'agent-session-1', status: 'active' },
    recentTurns: [{
      turnNumber: 7,
      role: 'assistant',
      runId: 'run-7',
      contentRef: '.sciforge/refs/turn-7.md',
      content: 'RAW_AGENTSERVER_TURN_BODY_SHOULD_NOT_LEAK',
      createdAt: '2026-05-16T00:00:00.000Z',
    }],
  }) as Record<string, unknown>;

  const recentTurns = snapshot.recentTurns as Array<Record<string, unknown>>;
  assert.equal(recentTurns.length, 1);
  assert.equal(recentTurns[0]?.contentRef, '.sciforge/refs/turn-7.md');
  assert.equal(recentTurns[0]?.contentChars, 'RAW_AGENTSERVER_TURN_BODY_SHOULD_NOT_LEAK'.length);
  assert.equal(typeof recentTurns[0]?.contentDigest, 'string');
  assert.equal(recentTurns[0]?.contentOmitted, true);
  assert.equal('content' in (recentTurns[0] ?? {}), false);
  assert.doesNotMatch(JSON.stringify(snapshot), /RAW_AGENTSERVER_TURN_BODY_SHOULD_NOT_LEAK/);
});
