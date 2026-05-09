import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedAgentResponse, RuntimeArtifact, RuntimeExecutionUnit, SciForgeMessage, SciForgeSession, UserGoalSnapshot } from '../../domain';
import {
  appendFailedRunToSession,
  appendRunningGuidance,
  appendRunningGuidanceRecord,
  attachGuidanceQueueToResponse,
  attachProcessRecoveryToFailedSession,
  createGuidanceQueueRecord,
  createOptimisticUserTurnSession,
  mergeAgentResponseIntoSession,
  mergeExecutionUnits,
  mergeRuntimeArtifacts,
  requestPayloadForTurn,
  rollbackSessionBeforeMessage,
  titleFromPrompt,
  updateGuidanceQueueRecords,
} from './sessionTransforms';
import { streamProcessTranscript } from './RunningWorkProcess';

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
  assert.equal(guided.messages[0].guidanceQueue?.status, 'queued');
});

test('running guidance keeps queue status in UI message, event transcript, final run, and next payload context', () => {
  const guidance = createGuidanceQueueRecord('skip broad web fetches and keep the report conservative', {
    id: 'guidance-1',
    receivedAt: '2026-05-08T00:01:00.000Z',
    activeRunId: 'run-active',
    reason: 'backend run is active',
  });
  const queued = appendRunningGuidanceRecord(session({
    messages: [message('msg-active', 'user', 'prepare an evidence report', '2026-05-08T00:00:00.000Z')],
  }), guidance).session;
  const events = [{
    id: 'evt-guidance',
    type: 'guidance-queued',
    label: '引导已排队',
    detail: `${guidance.prompt}\n状态：已排队，等待当前 run 结束后合并到下一轮。`,
    createdAt: guidance.receivedAt,
    raw: {
      guidanceQueue: guidance,
      contract: 'guidance-queue/run-orchestration',
    },
  }];
  const response: NormalizedAgentResponse = {
    message: message('msg-response', 'scenario', 'active run finished', '2026-05-08T00:02:00.000Z'),
    run: {
      id: 'run-active',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'prepare an evidence report',
      response: 'active run finished',
      createdAt: '2026-05-08T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  };
  const responseWithGuidance = attachGuidanceQueueToResponse(
    response,
    [guidance],
    'deferred',
    '当前 run 已经在执行中，追加引导已接收并等待下一轮合并处理。',
  );
  const finalSession = mergeAgentResponseIntoSession({
    baseSession: queued,
    response: responseWithGuidance,
    scenarioPackageRef: { id: 'pkg', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan',
    uiPlanRef: 'ui-plan',
  });
  const mergedForNextTurn = updateGuidanceQueueRecords(finalSession, [guidance.id], {
    status: 'merged',
    reason: '当前 run 已结束，已按 run orchestration contract 合并为下一轮用户引导。',
    handlingRunId: 'run-guidance',
  });
  const nextUser = message('msg-next', 'user', guidance.prompt, '2026-05-08T00:03:00.000Z');
  const nextPayload = requestPayloadForTurn({ ...mergedForNextTurn, messages: [...mergedForNextTurn.messages, nextUser] }, nextUser, []);

  assert.equal(queued.messages.at(-1)?.guidanceQueue?.status, 'queued');
  assert.match(streamProcessTranscript(events), /引导已排队: .*等待当前 run 结束后合并到下一轮/);
  assert.equal(responseWithGuidance.run.guidanceQueue?.[0]?.status, 'deferred');
  assert.equal((responseWithGuidance.run.raw as { guidanceQueue?: Array<{ prompt: string }> }).guidanceQueue?.[0]?.prompt, guidance.prompt);
  assert.equal(mergedForNextTurn.messages.find((item) => item.guidanceQueue?.id === guidance.id)?.guidanceQueue?.status, 'merged');
  assert.match(nextPayload.messages.map((item) => item.content).join('\n'), /运行中引导：skip broad web fetches/);
  assert.equal(nextPayload.runs.at(-1)?.guidanceQueue?.[0]?.status, 'merged');
});

test('failed runs preserve silent waiting recovery clues for the next turn payload', () => {
  const failed = appendFailedRunToSession({
    optimisticSession: session({ messages: [message('msg-user', 'user', 'run long task', '2026-05-08T00:00:00.000Z')] }),
    scenarioId: 'literature-evidence-review',
    scenarioPackageRef: { id: 'pkg', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan',
    uiPlanRef: 'ui-plan',
    prompt: 'run long task',
    message: 'backend down',
    references: [],
    goalSnapshot,
  });
  const transcript = [
    '工作过程摘要:',
    '- 等待: 正在等待后端返回新事件 · 最近 读取: 正在读取 /workspace/input/papers.csv · 下一步 收到新事件后继续执行；也可以安全中止当前 stream 或继续补充指令排队。',
  ].join('\n');
  const recovered = attachProcessRecoveryToFailedSession({
    session: failed.session,
    failedRunId: failed.failedRunId,
    transcript,
    events: [{
      type: 'process-progress',
      label: '等待',
      detail: 'HTTP stream 仍在等待；最近事件：读取 - 正在读取 /workspace/input/papers.csv',
      createdAt: '2026-05-08T00:01:05.000Z',
    }],
  });
  const nextUser = message('msg-next', 'user', '继续上一轮', '2026-05-08T00:02:00.000Z');
  const nextPayload = requestPayloadForTurn({ ...recovered, messages: [...recovered.messages, nextUser] }, nextUser, []);

  assert.doesNotMatch(recovered.messages.at(-1)?.content ?? '', /工作过程摘要/);
  assert.doesNotMatch(recovered.runs.at(-1)?.response ?? '', /安全中止当前 stream/);
  assert.deepEqual((recovered.runs.at(-1)?.raw as { streamProcess?: { events?: unknown[] } }).streamProcess?.events?.length, 1);
  assert.match((nextPayload.runs.at(-1)?.raw as { streamProcess?: { summary?: string } }).streamProcess?.summary ?? '', /最近 读取/);
  assert.match((nextPayload.runs.at(-1)?.raw as { streamProcess?: { summary?: string } }).streamProcess?.summary ?? '', /继续补充指令/);
});
