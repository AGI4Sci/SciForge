import assert from 'node:assert/strict';
import test from 'node:test';
import { guidanceQueuedEvent } from '@sciforge-ui/runtime-contract';
import type { BackgroundCompletionRuntimeEvent, NormalizedAgentResponse, RuntimeArtifact, RuntimeExecutionUnit, SciForgeMessage, SciForgeSession, UserGoalSnapshot } from '../../domain';
import {
  applyBackgroundCompletionEventToSession,
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
import { latestProgressModelFromCompactTrace } from '../../processProgress';

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

test('compacts prior work payloads for multi-turn requests', () => {
  const messages = Array.from({ length: 18 }, (_, index) => message(
    `msg-${index}`,
    index % 2 ? 'scenario' : 'user',
    `message ${index} ${'x'.repeat(700)}`,
    `2026-05-07T00:${String(index).padStart(2, '0')}:00.000Z`,
  ));
  const userMessage = message('msg-user', 'user', 'continue', '2026-05-07T01:00:00.000Z');
  const artifacts: RuntimeArtifact[] = Array.from({ length: 20 }, (_, index) => ({
    id: `artifact-${index}`,
    type: 'table',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: `file:.sciforge/artifacts/${index}.json`,
    data: { rows: Array.from({ length: 200 }, () => ({ value: 'large inline value' })) },
  }));
  const executionUnits: RuntimeExecutionUnit[] = Array.from({ length: 20 }, (_, index) => ({
    id: `unit-${index}`,
    tool: 'shell',
    params: 'p'.repeat(2_000),
    status: 'done',
    hash: `hash-${index}`,
  }));
  const runs = Array.from({ length: 10 }, (_, index) => ({
    id: `run-${index}`,
    scenarioId: 'literature-evidence-review' as const,
    status: 'completed' as const,
    prompt: 'prompt '.repeat(600),
    response: 'response '.repeat(600),
    createdAt: `2026-05-07T02:${String(index).padStart(2, '0')}:00.000Z`,
    raw: {
      streamProcess: {
        eventCount: 40,
        summary: 'recent status '.repeat(300),
        events: Array.from({ length: 40 }, (_, eventIndex) => ({ label: `event-${eventIndex}` })),
      },
      trace: 't'.repeat(4_000),
    },
  }));

  const payload = requestPayloadForTurn(session({
    messages: [...messages, userMessage],
    artifacts,
    executionUnits,
    runs,
  }), userMessage, []);

  assert.equal(payload.messages.length, 12);
  assert.equal(payload.messages.at(-1)?.id, 'msg-user');
  assert.equal(payload.artifacts.length, 16);
  assert.equal(payload.executionUnits.length, 16);
  assert.equal(payload.runs.length, 8);
  assert.equal(payload.artifacts[0]?.data, undefined);
  assert.equal(payload.artifacts[0]?.metadata?.inlineDataOmittedFromChatPayload, true);
  assert.ok((payload.executionUnits[0]?.params.length ?? 0) < 1_600);
  assert.doesNotMatch(JSON.stringify(payload.runs[0]?.raw), /event-39/);
  assert.match((payload.runs[0]?.raw as { streamProcess?: { summary?: string } }).streamProcess?.summary ?? '', /recent status/);
});

test('compact prior run payload can still recover recent process progress from stream summary', () => {
  const userMessage = message('msg-user', 'user', 'continue', '2026-05-07T01:00:00.000Z');
  const priorRun = {
    id: 'run-progress',
    scenarioId: 'literature-evidence-review' as const,
    status: 'failed' as const,
    prompt: 'run long task',
    response: 'backend timeout',
    createdAt: '2026-05-07T00:00:00.000Z',
    raw: {
      streamProcess: {
        eventCount: 80,
        summary: [
          '工作过程摘要:',
          '- 等待: 正在等待后端返回新事件 · 等 后端返回新事件 · 最近 读取: 正在读取 /workspace/input/papers.csv · 下一步 收到新事件后继续执行；也可以安全中止当前 stream 或继续补充指令排队。',
        ].join('\n'),
        events: Array.from({ length: 80 }, (_, index) => ({ label: `event-${index}` })),
      },
    },
  };
  const payload = requestPayloadForTurn(session({
    messages: [message('msg-old', 'user', 'old', '2026-05-07T00:00:00.000Z'), userMessage],
    runs: [priorRun],
  }), userMessage, []);
  const model = latestProgressModelFromCompactTrace(payload);

  assert.doesNotMatch(JSON.stringify(payload.runs[0]?.raw), /event-79/);
  assert.equal(model?.phase, 'wait');
  assert.equal(model?.waitingFor, '后端返回新事件');
  assert.equal(model?.lastEvent?.label, '读取');
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
  const events = [guidanceQueuedEvent({ id: 'evt-guidance', createdAt: guidance.receivedAt }, guidance)];
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

test('background completion initial response creates a running run and assistant message with stable refs', () => {
  const event: BackgroundCompletionRuntimeEvent = {
    contract: 'sciforge.background-completion.v1',
    type: 'background-initial-response',
    runId: 'run-bg-1',
    stageId: 'stage-initial',
    ref: 'run:run-bg-1#stage-initial',
    status: 'running',
    prompt: 'prepare long report',
    message: '我先给出摘要，后台继续补全 artifact 和验证。',
    createdAt: '2026-05-08T01:00:00.000Z',
  };
  const updated = applyBackgroundCompletionEventToSession(session(), event);

  assert.equal(updated.runs[0].id, 'run-bg-1');
  assert.equal(updated.runs[0].status, 'running');
  assert.equal(updated.messages[0].id, 'msg-run-bg-1');
  assert.equal(updated.messages[0].status, 'running');
  assert.equal(updated.messages[0].objectReferences?.[0]?.ref, 'run:run-bg-1');
  assert.equal((updated.runs[0].raw as { backgroundCompletion?: { contract?: string; messageId?: string } }).backgroundCompletion?.contract, 'sciforge.background-completion.v1');
  assert.equal((updated.runs[0].raw as { backgroundCompletion?: { messageId?: string } }).backgroundCompletion?.messageId, 'msg-run-bg-1');
});

test('background completion success finalizes the same run and exposes results to the next turn', () => {
  const initial = applyBackgroundCompletionEventToSession(session(), {
    contract: 'sciforge.background-completion.v1',
    type: 'background-initial-response',
    runId: 'run-bg-2',
    stageId: 'stage-initial',
    status: 'running',
    prompt: 'long report',
    message: '后台补全中。',
    createdAt: '2026-05-08T01:00:00.000Z',
  });
  const final = applyBackgroundCompletionEventToSession(initial, {
    contract: 'sciforge.background-completion.v1',
    type: 'background-finalization',
    runId: 'run-bg-2',
    stageId: 'stage-final',
    status: 'completed',
    finalResponse: '最终报告已完成。',
    completedAt: '2026-05-08T01:03:00.000Z',
    workEvidence: [{ id: 'we-1', kind: 'final-response', ref: 'run:run-bg-2#stage-final' }],
  });
  const user = message('msg-next-bg', 'user', '继续解释上一轮结果', '2026-05-08T01:04:00.000Z');
  const payload = requestPayloadForTurn({ ...final, messages: [...final.messages, user] }, user, []);

  assert.equal(final.runs.length, 1);
  assert.equal(final.messages.length, 1);
  assert.equal(final.runs[0].status, 'completed');
  assert.equal(final.messages[0].content, '最终报告已完成。');
  assert.match(JSON.stringify(payload.runs), /we-1/);
});

test('background completion failure writes recovery context without inventing scenario state', () => {
  const updated = applyBackgroundCompletionEventToSession(session(), {
    contract: 'sciforge.background-completion.v1',
    type: 'background-stage-update',
    runId: 'run-bg-fail',
    stageId: 'stage-artifact',
    status: 'failed',
    prompt: 'materialize report',
    message: 'artifact materialization failed',
    failureReason: 'schema validation failed for research-report',
    recoverActions: ['Regenerate the report artifact with schemaVersion=1.'],
    nextStep: 'Retry artifact materialization before presenting success.',
    updatedAt: '2026-05-08T01:10:00.000Z',
  });

  const run = updated.runs[0];
  const unit = updated.executionUnits[0];
  assert.equal(run.status, 'failed');
  assert.match(run.response, /artifact materialization failed/);
  assert.match(unit.failureReason ?? '', /schema validation/);
  assert.deepEqual(unit.recoverActions, ['Regenerate the report artifact with schemaVersion=1.']);
  assert.equal((run.raw as { backgroundCompletion?: { nextStep?: string } }).backgroundCompletion?.nextStep, 'Retry artifact materialization before presenting success.');
});

test('background completion user cancellation keeps runId and recoverable next step', () => {
  const updated = applyBackgroundCompletionEventToSession(session(), {
    contract: 'sciforge.background-completion.v1',
    type: 'background-finalization',
    runId: 'run-bg-cancel',
    stageId: 'stage-final',
    status: 'cancelled',
    prompt: 'long report',
    message: '用户已取消后台补全。',
    cancellationReason: 'user requested cancel',
    recoverActions: ['Start a new turn to inherit completed partial artifacts and rerun remaining stages.'],
    nextStep: 'Keep partial context visible; do not mark the run completed.',
    completedAt: '2026-05-08T01:12:00.000Z',
  });

  assert.equal(updated.runs[0].status, 'cancelled');
  assert.equal(updated.messages[0].status, 'cancelled');
  assert.match(updated.executionUnits[0].failureReason ?? '', /user requested cancel/);
  const termination = (updated.runs[0].raw as { backgroundCompletion?: { termination?: { reason?: string; sessionStatus?: string } } })
    .backgroundCompletion?.termination;
  assert.equal(termination?.reason, 'user-cancelled');
  assert.equal(termination?.sessionStatus, 'cancelled');
});

test('background completion can finish while a newer user turn already exists', () => {
  const withUser = session({
    messages: [message('msg-user-1', 'user', 'start long task', '2026-05-08T01:00:00.000Z')],
  });
  const initial = applyBackgroundCompletionEventToSession(withUser, {
    contract: 'sciforge.background-completion.v1',
    type: 'background-initial-response',
    runId: 'run-bg-overlap',
    status: 'running',
    prompt: 'start long task',
    message: '后台继续跑。',
    createdAt: '2026-05-08T01:01:00.000Z',
  });
  const nextUser = message('msg-user-2', 'user', '顺便解释第一段', '2026-05-08T01:02:00.000Z');
  const withNextUser = { ...initial, messages: [...initial.messages, nextUser] };
  const completed = applyBackgroundCompletionEventToSession(withNextUser, {
    contract: 'sciforge.background-completion.v1',
    type: 'background-finalization',
    runId: 'run-bg-overlap',
    status: 'completed',
    finalResponse: '后台结果完成。',
    completedAt: '2026-05-08T01:03:00.000Z',
  });

  assert.deepEqual(completed.messages.map((item) => item.id), ['msg-user-1', 'msg-run-bg-overlap', 'msg-user-2']);
  assert.equal(completed.messages.find((item) => item.id === 'msg-run-bg-overlap')?.content, '后台结果完成。');
});

test('background artifact and verification updates merge by runId, stageId, and refs', () => {
  const artifact: RuntimeArtifact = {
    id: 'artifact-bg-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Report' },
  };
  const updated = applyBackgroundCompletionEventToSession(session(), {
    contract: 'sciforge.background-completion.v1',
    type: 'background-stage-update',
    runId: 'run-bg-artifact',
    stageId: 'stage-report',
    ref: 'run:run-bg-artifact#stage-report',
    status: 'running',
    prompt: 'build report',
    message: '报告 artifact 已写入，验证继续后台执行。',
    artifacts: [artifact],
    verificationResults: [{
      id: 'verify-report',
      verdict: 'pass',
      confidence: 0.9,
      evidenceRefs: ['artifact:artifact-bg-report'],
    }],
    updatedAt: '2026-05-08T01:20:00.000Z',
  });

  assert.equal(updated.artifacts[0].metadata?.runId, 'run-bg-artifact');
  assert.equal(updated.artifacts[0].metadata?.stageId, 'stage-report');
  assert.equal(updated.executionUnits[0].id, 'EU-run-bg-artifact-stage-report');
  assert.equal(updated.executionUnits[0].status, 'running');
  assert.equal(updated.executionUnits[0].outputRef, 'run:run-bg-artifact#stage-report');
  assert.deepEqual(updated.executionUnits[0].outputArtifacts, ['artifact-bg-report']);
  assert.equal(updated.executionUnits[0].verificationRef, 'verification:verify-report');
  assert.equal(updated.executionUnits[0].verificationVerdict, 'pass');
  assert.match(JSON.stringify(updated.runs[0].raw), /verify-report/);
  assert.match(JSON.stringify(updated.runs[0].raw), /artifact:artifact-bg-report/);
});
