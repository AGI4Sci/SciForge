import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedAgentResponse, RuntimeArtifact, RuntimeExecutionUnit, SciForgeMessage, SciForgeSession, UserGoalSnapshot } from '../../domain';
import {
  appendFailedRunToSession,
  appendRunningGuidance,
  createOptimisticUserTurnSession,
  mergeAgentResponseIntoSession,
  mergeExecutionUnits,
  mergeRuntimeArtifacts,
  requestPayloadForTurn,
  rollbackSessionBeforeMessage,
  titleFromPrompt,
} from './sessionTransforms';

const goalSnapshot: UserGoalSnapshot = {
  turnId: 'turn-1',
  rawPrompt: 'make report',
  goalType: 'report',
  requiredFormats: [],
  requiredArtifacts: [],
  requiredReferences: [],
  uiExpectations: [],
  acceptanceCriteria: [],
};

function message(id: string, role: SciForgeMessage['role'], content: string, createdAt: string): SciForgeMessage {
  return { id, role, content, createdAt, status: 'completed' };
}

function session(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: '新聊天',
    createdAt: '2026-05-07T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...overrides,
  };
}

test('creates optimistic user turns and only derives a title for the first real message', () => {
  const first = createOptimisticUserTurnSession({
    baseSession: session(),
    prompt: '  compare   papers about BRCA1 evidence  ',
    references: [],
    goalSnapshot,
  });
  const followup = createOptimisticUserTurnSession({
    baseSession: first.session,
    prompt: 'another prompt',
    references: [],
    goalSnapshot,
  });

  assert.equal(titleFromPrompt('  a   b  '), 'a b');
  assert.equal(first.session.title, 'compare papers about BRCA1 evidence');
  assert.equal(first.userMessage.role, 'user');
  assert.equal(followup.session.title, first.session.title);
});

test('builds minimal first-turn payload but retains prior work and explicit references', () => {
  const userMessage = message('msg-user', 'user', 'hello', '2026-05-07T00:00:00.000Z');
  const seeded = session({ messages: [message('seed-1', 'scenario', 'seed', '2026-05-07T00:00:00.000Z'), userMessage] });
  const prior = session({
    messages: [message('msg-old', 'user', 'old', '2026-05-07T00:00:00.000Z'), userMessage],
  });

  assert.deepEqual(requestPayloadForTurn(seeded, userMessage, []).messages.map((item) => item.id), ['msg-user']);
  assert.deepEqual(requestPayloadForTurn(prior, userMessage, []).messages.map((item) => item.id), ['msg-old', 'msg-user']);
  assert.deepEqual(requestPayloadForTurn(seeded, userMessage, [{ id: 'ref-1', kind: 'message', title: 'ref', ref: 'message:1' }]).messages.map((item) => item.id), ['msg-user']);
});

test('rolls back an edited user message and prunes later run-owned state', () => {
  const before: RuntimeExecutionUnit = {
    id: 'unit-before',
    tool: 'read',
    params: '',
    status: 'done',
    hash: 'a',
    routeDecision: { selectedAt: '2026-05-07T00:05:00.000Z' },
  };
  const after: RuntimeExecutionUnit = {
    id: 'unit-after',
    tool: 'write',
    params: '',
    status: 'done',
    hash: 'b',
    routeDecision: { selectedAt: '2026-05-07T00:30:00.000Z' },
  };
  const rolled = rollbackSessionBeforeMessage(session({
    messages: [
      message('msg-1', 'user', 'first', '2026-05-07T00:00:00.000Z'),
      message('msg-2', 'user', 'edit me', '2026-05-07T00:20:00.000Z'),
    ],
    runs: [{
      id: 'run-before',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'first',
      response: 'ok',
      createdAt: '2026-05-07T00:10:00.000Z',
    }, {
      id: 'run-after',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'second',
      response: 'late',
      createdAt: '2026-05-07T00:40:00.000Z',
    }],
    executionUnits: [before, after],
  }), 'msg-2');

  assert.deepEqual(rolled.messages.map((item) => item.id), ['msg-1']);
  assert.deepEqual(rolled.runs.map((item) => item.id), ['run-before']);
  assert.deepEqual(rolled.executionUnits.map((item) => item.id), ['unit-before']);
});

test('merges response records and failed runs without dropping existing session state', () => {
  const baseArtifact: RuntimeArtifact = { id: 'artifact-1', type: 'report', producerScenario: 'literature-evidence-review', schemaVersion: '1', metadata: { title: 'old' } };
  const nextArtifact: RuntimeArtifact = { id: 'artifact-1', type: 'report', producerScenario: 'literature-evidence-review', schemaVersion: '1', metadata: { title: 'new' } };
  const response: NormalizedAgentResponse = {
    message: message('msg-response', 'scenario', 'done', '2026-05-07T01:00:00.000Z'),
    run: {
      id: 'run-1',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'go',
      response: 'done',
      createdAt: '2026-05-07T01:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [nextArtifact],
    notebook: [],
  };
  const merged = mergeAgentResponseIntoSession({
    baseSession: session({ artifacts: [baseArtifact] }),
    response,
    scenarioPackageRef: { id: 'pkg', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan',
    uiPlanRef: 'ui-plan',
  });
  const failed = appendFailedRunToSession({
    optimisticSession: merged,
    scenarioId: 'literature-evidence-review',
    scenarioPackageRef: { id: 'pkg', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan',
    uiPlanRef: 'ui-plan',
    prompt: 'go',
    message: 'backend down',
    references: [],
    goalSnapshot,
  });

  assert.deepEqual(mergeRuntimeArtifacts([nextArtifact], [baseArtifact]).map((item) => item.metadata?.title), ['new']);
  assert.deepEqual(mergeExecutionUnits([{ id: 'u', tool: 'a', params: '', status: 'done', hash: '1' }], [{ id: 'u', tool: 'b', params: '', status: 'planned', hash: '0' }]).map((item) => item.tool), ['a']);
  assert.equal(merged.runs[0].scenarioPackageRef?.id, 'pkg');
  assert.equal(merged.artifacts[0].metadata?.title, 'new');
  assert.equal(failed.session.runs.at(-1)?.status, 'failed');
  assert.equal(failed.session.messages.at(-1)?.content, 'backend down');
});

test('appends running guidance as a queued user message', () => {
  const guided = appendRunningGuidance(session(), 'add controls');

  assert.equal(guided.messages[0].role, 'user');
  assert.equal(guided.messages[0].status, 'running');
  assert.equal(guided.messages[0].content, '运行中引导：add controls');
});
