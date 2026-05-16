import assert from 'node:assert/strict';
import test from 'node:test';
import { guidanceQueuedEvent } from '@sciforge-ui/runtime-contract';
import type { BackgroundCompletionRuntimeEvent, NormalizedAgentResponse, RuntimeArtifact, RuntimeExecutionUnit, SciForgeMessage, SciForgeRun, SciForgeSession, UserGoalSnapshot } from '../../domain';
import {
  applyHistoricalUserMessageEdit,
  applyBackgroundCompletionEventToSession,
  appendFailedRunToSession,
  appendRunningGuidance,
  appendRunningGuidanceRecord,
  attachGuidanceQueueToResponse,
  attachProcessRecoveryToFailedSession,
  createGuidanceQueueRecord,
  createOptimisticUserTurnSession,
  mergeAgentResponseIntoSession,
  mergeClaims,
  mergeExecutionUnits,
  mergeRuntimeArtifacts,
  requestPayloadForTurn,
  resolveGuidanceQueueAfterRun,
  rollbackSessionBeforeMessage,
  titleFromPrompt,
  updateGuidanceQueueRecords,
} from './sessionTransforms';
import { streamProcessTranscript } from './RunningWorkProcess';
import { latestProgressModelFromCompactTrace } from '../../processProgress';
import { conversationProjectionMigrationAuditFixtureForRun } from '../conversation-projection-view-model';

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
  const value = {
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
  } as SciForgeSession;
  const projections = Object.fromEntries(value.runs.flatMap((run) => {
    const projection = conversationProjectionMigrationAuditFixtureForRun(run);
    return projection ? [[run.id, projection]] : [];
  }));
  return Object.keys(projections).length ? { ...value, materializedConversationProjections: projections } as SciForgeSession : value;
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
  assert.doesNotMatch(JSON.stringify(payload.runs[0]?.raw), /recent status recent status/);
  assert.equal((payload.runs[0]?.raw as { streamProcess?: { summaryDigest?: { hash?: string } } }).streamProcess?.summaryDigest, undefined);
});

test('compact prior run payload keeps stream transcript as digest only', () => {
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
  assert.doesNotMatch(JSON.stringify(payload.runs[0]?.raw), /最近 读取/);
  assert.equal((payload.runs[0]?.raw as { streamProcess?: { summaryDigest?: { hash?: string } } }).streamProcess?.summaryDigest, undefined);
  assert.equal(model, undefined);
});

test('next-turn payload prefers conversation projection and keeps raw execution state audit-only', () => {
  const userMessage = message('msg-user', 'user', 'continue from the verified artifact', '2026-05-07T01:00:00.000Z');
  const rawBody = `RAW_SESSION_RUN_BODY ${'provider payload '.repeat(500)}`;
  const projectedRun: SciForgeRun = {
    id: 'run-projected',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'make the report',
    response: rawBody,
    createdAt: '2026-05-07T00:00:00.000Z',
    raw: {
      providerPayload: rawBody,
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'session-1',
          currentTurn: { id: 'turn-projected', prompt: rawBody },
          visibleAnswer: {
            status: 'degraded-result',
            text: `Visible bounded answer ${'summary '.repeat(200)}`,
            artifactRefs: ['artifact:report-1'],
            diagnostic: 'External verifier stopped after partial evidence.',
          },
          activeRun: { id: 'run-projected', status: 'degraded-result' },
          artifacts: [{ ref: 'artifact:report-1', digest: 'sha256-report', label: 'Report' }],
          executionProcess: [],
          recoverActions: ['Resume from checkpoint without resending raw provider payload.'],
          verificationState: { status: 'uncertain', verifierRef: 'file:.sciforge/verifier.json', verdict: 'uncertain' },
          backgroundState: {
            status: 'running',
            checkpointRefs: ['file:.sciforge/checkpoints/run-projected.json'],
            revisionPlan: 'Continue the remaining verification pass.',
          },
          auditRefs: ['file:.sciforge/audit/provider.log', 'execution-unit:unit-audit'],
          diagnostics: [{
            severity: 'warning',
            code: 'partial-verification',
            message: 'Verification was partial.',
            refs: [{ ref: 'file:.sciforge/diagnostics/partial.json' }],
          }],
        },
      },
    },
  };
  const rawExecutionUnit: RuntimeExecutionUnit = {
    id: 'unit-raw-old',
    tool: 'raw.provider.tool',
    params: `RAW_EXECUTION_PARAMS ${'large params '.repeat(400)}`,
    status: 'done',
    hash: 'raw-old',
    runId: 'old-run',
  };
  const auditExecutionUnit: RuntimeExecutionUnit = {
    id: 'unit-audit',
    tool: 'verifier.audit',
    params: `AUDIT_PARAMS ${'large params '.repeat(400)}`,
    status: 'failed',
    hash: 'audit-hash',
    runId: 'run-projected',
    stdoutRef: 'file:.sciforge/audit/provider.log',
    outputArtifacts: ['report-1'],
    failureReason: rawBody,
    recoverActions: ['legacy raw recover action should not drive continuation'],
  };

  const payload = requestPayloadForTurn(session({
    messages: [message('msg-old', 'user', 'old', '2026-05-07T00:00:00.000Z'), userMessage],
    runs: [projectedRun],
    executionUnits: [rawExecutionUnit, auditExecutionUnit],
  }), userMessage, [{
    id: 'selected-ref-1',
    kind: 'message',
    title: 'Selected prior answer',
    ref: 'message:prior',
    summary: 'User selected the prior answer.',
    payload: { textPreview: 'large selected text should not be copied here'.repeat(200) },
  }]);

  const projectionUnit = payload.executionUnits.find((unit) => unit.tool === 'conversation.projection.continuation');
  const auditUnit = payload.executionUnits.find((unit) => unit.id === 'unit-audit');
  const rawRun = payload.runs[0]?.raw as {
    projectionAudit?: { auditRefs?: string[]; selectedRefs?: string[] };
    streamProcess?: unknown;
  } | undefined;
  const serialized = JSON.stringify(payload);

  assert.ok(projectionUnit, 'projection continuation unit should be present');
  assert.equal(payload.executionUnits.some((unit) => unit.id === 'unit-raw-old'), false);
  assert.equal(auditUnit?.params.includes('RAW_EXECUTION_PARAMS'), false);
  assert.match(auditUnit?.failureReason ?? '', /execution-unit-failure-reason omitted/);
  assert.deepEqual(auditUnit?.recoverActions, ['legacy raw recover action should not drive continuation']);
  assert.match(projectionUnit?.params ?? '', /conversation-projection-continuation-set/);
  assert.match(projectionUnit?.params ?? '', /degraded-result/);
  assert.match(projectionUnit?.params ?? '', /message:prior/);
  assert.match(rawRun?.projectionAudit?.auditRefs?.join('\n') ?? '', /provider\.log|verifier\.json/);
  assert.deepEqual(rawRun?.projectionAudit?.selectedRefs, ['message:prior']);
  assert.equal(rawRun?.streamProcess, undefined);
  assert.doesNotMatch(serialized, /RAW_SESSION_RUN_BODY provider payload/);
  assert.doesNotMatch(serialized, /RAW_EXECUTION_PARAMS large params/);
});

test('next-turn continuation payload omits prior message expandable and raw task payloads', () => {
  const rawGeneratedTask = [
    'PYTHON_RAW_LEAK',
    'import requests',
    'import urllib.request',
    'requests.get("https://example.invalid/raw-generated-task")',
    'urllib.request.urlopen("https://example.invalid/debug-trace")',
  ].join('\n').repeat(200);
  const priorScenario = {
    ...message('msg-prior-scenario', 'scenario', 'Previous answer with refs only.', '2026-05-07T00:00:00.000Z'),
    expandable: rawGeneratedTask,
    references: [{
      id: 'ref-prior-message',
      kind: 'message' as const,
      title: 'prior message',
      ref: 'message:msg-prior-scenario',
      summary: 'prior projected answer',
      payload: {
        taskFiles: rawGeneratedTask,
        debugTrace: rawGeneratedTask,
      },
    }],
    objectReferences: [{ id: 'obj-partial', kind: 'artifact' as const, ref: 'artifact:partial-report', title: 'Partial report' }],
    goalSnapshot: {
      ...goalSnapshot,
      turnId: 'turn-prior',
      rawPrompt: rawGeneratedTask,
    },
    acceptance: {
      pass: false,
      severity: 'repairable' as const,
      checkedAt: '2026-05-07T00:05:00.000Z',
      failures: [{
        code: 'needs-repair',
        detail: rawGeneratedTask,
        repairAction: 'Continue from projection refs.',
      }],
      objectReferences: [{ id: 'obj-partial', kind: 'artifact' as const, ref: 'artifact:partial-report', title: 'Partial report' }],
      repairPrompt: rawGeneratedTask,
    },
    taskFiles: {
      'generated_task.py': rawGeneratedTask,
    },
    debugTrace: rawGeneratedTask,
  } as SciForgeMessage & { taskFiles: unknown; debugTrace: string };
  const nextUser = message('msg-next-user', 'user', 'please repair from the saved projection', '2026-05-07T01:00:00.000Z');
  const projectedRun: SciForgeRun = {
    id: 'run-continuation',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'old prompt should be digest only',
    response: rawGeneratedTask,
    createdAt: '2026-05-07T00:10:00.000Z',
    raw: {
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'session-1',
          currentTurn: { id: 'turn-continuation', prompt: 'repair handoff' },
          visibleAnswer: {
            status: 'repair-needed',
            text: 'Partial report is available via artifact refs.',
            artifactRefs: ['artifact:partial-report'],
            diagnostic: 'AgentServer generation stopped by convergence guard after token limit.',
          },
          activeRun: { id: 'run-continuation', status: 'repair-needed' },
          artifacts: [{ ref: 'artifact:partial-report', digest: 'sha256-partial', label: 'Partial report' }],
          executionProcess: [],
          recoverActions: ['Resume from projection and artifact refs; do not inline generated task source.'],
          verificationState: { status: 'failed', verifierRef: 'verification:repair-handoff', verdict: 'fail' },
          auditRefs: ['artifact:partial-report', 'execution-unit:EU-repair-handoff', 'file:.sciforge/repair-summary.json'],
        },
      },
      taskFiles: { 'generated_task.py': rawGeneratedTask },
      requests: rawGeneratedTask,
    },
    objectReferences: [{ id: 'obj-run-partial', kind: 'artifact', ref: 'artifact:partial-report', title: 'Partial report' }],
  };

  const payload = requestPayloadForTurn(session({
    messages: [priorScenario, nextUser],
    runs: [projectedRun],
  }), nextUser, []);
  const serialized = JSON.stringify(payload);
  const priorPayload = payload.messages.find((item) => item.id === priorScenario.id) as (SciForgeMessage & {
    contentDigest?: { hash?: string };
    taskFiles?: unknown;
    debugTrace?: unknown;
  }) | undefined;
  const projectionUnit = payload.executionUnits.find((unit) => unit.tool === 'conversation.projection.continuation');
  const rawRun = payload.runs[0]?.raw as { projectionAudit?: { auditRefs?: string[] } } | undefined;

  assert.equal(priorPayload?.expandable, undefined);
  assert.equal(priorPayload?.taskFiles, undefined);
  assert.equal(priorPayload?.debugTrace, undefined);
  assert.match(priorPayload?.content ?? '', /previous-message omitted/);
  assert.ok(priorPayload?.contentDigest?.hash);
  assert.match(projectionUnit?.params ?? '', /conversation-projection-continuation-set/);
  assert.match(projectionUnit?.params ?? '', /convergence guard/);
  assert.match(projectionUnit?.params ?? '', /artifact:partial-report/);
  assert.match(rawRun?.projectionAudit?.auditRefs?.join('\n') ?? '', /repair-summary\.json|EU-repair-handoff/);
  assert.doesNotMatch(serialized, /PYTHON_RAW_LEAK/);
  assert.doesNotMatch(serialized, /requests\.get/);
  assert.doesNotMatch(serialized, /urllib\.request/);
  assert.doesNotMatch(serialized, /generated_task\.py/);
});

test('explicit old artifact follow-up only carries selected refs in request payload', () => {
  const priorMessage = {
    ...message('msg-prior', 'scenario', 'prior answer', '2026-05-07T00:00:00.000Z'),
    objectReferences: [
      { id: 'obj-old', kind: 'artifact' as const, ref: 'artifact:old-report', title: 'Old report' },
      { id: 'obj-latest', kind: 'artifact' as const, ref: 'artifact:latest-report', title: 'Latest report' },
    ],
  };
  const userMessage = message('msg-user', 'user', 'use the selected old report only', '2026-05-07T01:00:00.000Z');
  const payload = requestPayloadForTurn(session({
    messages: [priorMessage, userMessage],
    artifacts: [{
      id: 'old-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      dataRef: 'file:.sciforge/artifacts/old-report.md',
    }, {
      id: 'latest-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      dataRef: 'file:.sciforge/artifacts/latest-report.md',
      data: { markdown: 'LATEST_REPORT_BODY_SHOULD_NOT_APPEAR' },
    }],
    runs: [{
      id: 'run-latest',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'latest',
      response: 'latest',
      createdAt: '2026-05-07T00:30:00.000Z',
      objectReferences: [{ id: 'obj-run-latest', kind: 'artifact', ref: 'artifact:latest-report', title: 'Latest report' }],
    }],
  }), userMessage, [{
    id: 'ref-old',
    kind: 'task-result',
    title: 'Old report',
    ref: 'artifact:old-report',
  }]);
  const serialized = JSON.stringify(payload);

  assert.deepEqual(payload.artifacts.map((artifact) => artifact.id), ['old-report']);
  assert.deepEqual(payload.runs, []);
  assert.match(serialized, /artifact:old-report/);
  assert.doesNotMatch(serialized, /latest-report|LATEST_REPORT_BODY_SHOULD_NOT_APPEAR/);
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

test('reverts a historical user message edit and records invalidated downstream refs', () => {
  const edited = applyHistoricalUserMessageEdit({
    session: session({
      messages: [
        message('msg-1', 'user', 'first', '2026-05-07T00:00:00.000Z'),
        message('msg-answer-1', 'scenario', 'first answer', '2026-05-07T00:10:00.000Z'),
        message('msg-2', 'user', 'edit me', '2026-05-07T00:20:00.000Z'),
        {
          ...message('msg-answer-2', 'scenario', 'downstream answer', '2026-05-07T00:40:00.000Z'),
          objectReferences: [{ id: 'obj-after-artifact', kind: 'artifact', ref: 'artifact:artifact-after', title: 'after artifact' }],
        },
      ],
      runs: [{
        id: 'run-before',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'first',
        response: 'ok',
        createdAt: '2026-05-07T00:10:00.000Z',
        objectReferences: [{ id: 'obj-before-artifact', kind: 'artifact', ref: 'artifact:artifact-before', title: 'before artifact' }],
      }, {
        id: 'run-after',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'second',
        response: 'late',
        createdAt: '2026-05-07T00:40:00.000Z',
        objectReferences: [
          { id: 'obj-after-run', kind: 'run', ref: 'run:run-after', title: 'after run' },
          { id: 'obj-after-artifact-run', kind: 'artifact', ref: 'artifact:artifact-after', title: 'after artifact' },
        ],
      }],
      executionUnits: [{
        id: 'unit-before',
        tool: 'read',
        params: '',
        status: 'done',
        hash: 'a',
        routeDecision: { selectedAt: '2026-05-07T00:05:00.000Z' },
      }, {
        id: 'unit-after',
        tool: 'write',
        params: '',
        status: 'done',
        hash: 'b',
        routeDecision: { selectedAt: '2026-05-07T00:30:00.000Z' },
        outputArtifacts: ['artifact-after'],
      }],
      artifacts: [{
        id: 'artifact-before',
        type: 'report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { runId: 'run-before' },
      }, {
        id: 'artifact-after',
        type: 'report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { runId: 'run-after' },
      }, {
        id: 'uploaded-context',
        type: 'file',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
      }],
      claims: [{
        id: 'claim-after',
        text: 'downstream conclusion',
        type: 'inference',
        confidence: 0.7,
        evidenceLevel: 'review',
        supportingRefs: ['artifact:artifact-after'],
        opposingRefs: [],
        updatedAt: '2026-05-07T00:45:00.000Z',
      }],
    }),
    messageId: 'msg-2',
    content: 'edited user instruction',
    mode: 'revert',
    editedAt: '2026-05-07T01:00:00.000Z',
  });

  assert.deepEqual(edited.session.messages.map((item) => item.id), ['msg-1', 'msg-answer-1', 'msg-2']);
  assert.equal(edited.session.messages.at(-1)?.content, 'edited user instruction');
  assert.deepEqual(edited.session.runs.map((item) => item.id), ['run-before']);
  assert.deepEqual(edited.session.executionUnits.map((item) => item.id), ['unit-before']);
  assert.deepEqual(edited.session.artifacts.map((item) => item.id), ['artifact-before', 'uploaded-context']);
  assert.deepEqual(edited.session.claims, []);
  assert.equal(edited.branch?.mode, 'revert');
  assert.deepEqual(edited.branch?.invalidatedRefs.map((item) => item.ref).sort(), [
    'artifact:artifact-after',
    'claim:claim-after',
    'execution-unit:unit-after',
    'message:msg-answer-2',
    'run:run-after',
  ]);
  assert.equal(edited.branch?.kernelEventLog.schemaVersion, 'sciforge.conversation-event-log.v1');
  assert.match(edited.branch?.kernelEventLogDigest ?? '', /^fnv1a-/);
  assert.equal(edited.branch?.kernelEventLog.events[0]?.type, 'HistoryEdited');
  assert.equal(edited.branch?.projectionInvalidation.invalidatesProjection, true);
  assert.deepEqual(edited.branch?.refInvalidation.invalidatedRefs.sort(), [
    'artifact:artifact-after',
    'claim:claim-after',
    'execution-unit:unit-after',
    'message:msg-answer-2',
    'run:run-after',
  ]);
  assert.deepEqual((edited.branch?.kernelEventLog.events[0]?.payload as { invalidatedRefs?: string[] }).invalidatedRefs?.sort(), [
    'artifact:artifact-after',
    'claim:claim-after',
    'execution-unit:unit-after',
    'message:msg-answer-2',
    'run:run-after',
  ]);
});

test('continues after a historical user message edit with conflict and confirmation metadata', () => {
  const continued = applyHistoricalUserMessageEdit({
    session: session({
      messages: [
        message('msg-1', 'user', 'original instruction', '2026-05-07T00:00:00.000Z'),
        message('msg-answer-1', 'scenario', 'answer based on original instruction', '2026-05-07T00:10:00.000Z'),
      ],
      runs: [{
        id: 'run-answer',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'original instruction',
        response: 'answer based on original instruction',
        createdAt: '2026-05-07T00:10:00.000Z',
        objectReferences: [{ id: 'obj-report', kind: 'artifact', ref: 'artifact:report-original', title: 'original report' }],
      }],
      artifacts: [{
        id: 'report-original',
        type: 'report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        metadata: { runId: 'run-answer', title: 'original report' },
      }],
      claims: [{
        id: 'claim-answer',
        text: 'conclusion from original answer',
        type: 'inference',
        confidence: 0.8,
        evidenceLevel: 'review',
        supportingRefs: ['artifact:report-original'],
        opposingRefs: [],
        updatedAt: '2026-05-07T00:11:00.000Z',
      }],
    }),
    messageId: 'msg-1',
    content: 'revised instruction',
    mode: 'continue',
    editedAt: '2026-05-07T01:00:00.000Z',
  });

  assert.equal(continued.session.messages[0].content, 'revised instruction');
  assert.deepEqual(continued.session.runs.map((item) => item.id), ['run-answer']);
  assert.deepEqual(continued.session.artifacts.map((item) => item.id), ['report-original']);
  assert.equal(continued.branch?.mode, 'continue');
  assert.deepEqual(continued.branch?.invalidatedRefs, []);
  assert.equal(continued.branch?.projectionInvalidation.invalidatesProjection, true);
  assert.deepEqual(continued.branch?.refInvalidation.invalidatedRefs, []);
  assert.ok(continued.branch?.refInvalidation.affectedRefs.includes('run:run-answer'));
  assert.equal(continued.branch?.kernelEventLog.events[0]?.type, 'HistoryEdited');
  assert.equal((continued.branch?.kernelEventLog.events[0]?.payload as { requiresUserConfirmation?: boolean }).requiresUserConfirmation, true);
  assert.equal(continued.branch?.requiresUserConfirmation, true);
  assert.match(continued.branch?.nextStep ?? '', /confirm whether to keep/);
  assert.deepEqual(continued.branch?.affectedConclusions.map((item) => item.ref), ['claim:claim-answer']);
  assert.deepEqual(continued.branch?.conflicts[0]?.affectedRefs, ['run:run-answer', 'artifact:report-original']);
  const raw = continued.session.runs[0].raw as { historicalEditConflict?: { branchId?: string; requiresUserConfirmation?: boolean } };
  assert.equal(raw.historicalEditConflict?.branchId, continued.branch?.id);
  assert.equal(raw.historicalEditConflict?.requiresUserConfirmation, true);
  assert.deepEqual(continued.session.artifacts[0].metadata?.historicalEditConflict, raw.historicalEditConflict);
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
  assert.deepEqual(mergeClaims([
    { id: 'claim-1', text: 'new', type: 'fact', confidence: 0.8, evidenceLevel: 'meta', supportingRefs: [], opposingRefs: [], updatedAt: '2026-05-07T01:00:01.000Z' },
  ], [
    { id: 'claim-1', text: 'old', type: 'fact', confidence: 0.4, evidenceLevel: 'meta', supportingRefs: [], opposingRefs: [], updatedAt: '2026-05-07T01:00:00.000Z' },
  ]).map((item) => item.text), ['new']);
  assert.deepEqual(mergeExecutionUnits([{ id: 'u', tool: 'a', params: '', status: 'done', hash: '1' }], [{ id: 'u', tool: 'b', params: '', status: 'planned', hash: '0' }]).map((item) => item.tool), ['a']);
  assert.equal(merged.runs[0].scenarioPackageRef?.id, 'pkg');
  assert.equal(merged.artifacts[0].metadata?.title, 'new');
  assert.equal(failed.session.runs.at(-1)?.status, 'failed');
  assert.equal(failed.session.messages.at(-1)?.content, 'backend down');
});

test('merge helpers keep recent repair-needed refs when compacting crowded sessions', () => {
  const oldUnits: RuntimeExecutionUnit[] = Array.from({ length: 32 }, (_, index) => ({
    id: `unit-old-${index}`,
    tool: 'old-tool',
    params: '{}',
    status: 'done',
    hash: `old-${index}`,
  }));
  const recentRepairUnit: RuntimeExecutionUnit = {
    id: 'unit-recent-repair',
    tool: 'validator',
    params: '{}',
    status: 'repair-needed',
    hash: 'recent-repair',
    outputRef: 'run:run-recent/failed-output.json',
    recoverActions: ['resume with retained refs'],
  };
  const mergedUnits = mergeExecutionUnits([recentRepairUnit], oldUnits);
  const mergedArtifacts = mergeRuntimeArtifacts([{
    id: 'artifact-recent',
    type: 'diagnostic',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-recent' },
  }], Array.from({ length: 32 }, (_, index) => ({
    id: `artifact-old-${index}`,
    type: 'diagnostic',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
  })));

  assert.equal(mergedUnits.length, 32);
  assert.equal(mergedUnits.some((unit) => unit.id === 'unit-old-0'), false);
  assert.equal(mergedUnits.at(-1)?.id, 'unit-recent-repair');
  assert.equal(mergedArtifacts.length, 32);
  assert.equal(mergedArtifacts.at(-1)?.id, 'artifact-recent');
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
  assert.equal(mergedForNextTurn.messages.find((item) => item.guidanceQueue?.id === guidance.id)?.guidanceQueue?.handlingRunId, 'run-guidance');
  assert.match(nextPayload.messages.map((item) => item.content).join('\n'), /skip broad web fetches/);
  assert.equal(nextPayload.runs.at(-1)?.guidanceQueue?.[0]?.status, 'merged');
});

test('user cancel rejects queued guidance instead of replaying it across the cancel boundary', () => {
  const guidance = createGuidanceQueueRecord('continue with a narrower rerun', {
    id: 'guidance-cancelled',
    receivedAt: '2026-05-08T00:01:00.000Z',
  });
  const queued = appendRunningGuidanceRecord(session({
    messages: [message('msg-user', 'user', 'start long task', '2026-05-08T00:00:00.000Z')],
  }), guidance).session;
  const resolved = resolveGuidanceQueueAfterRun(queued, [guidance], { userCancelled: true });

  assert.equal(resolved.nextGuidance, undefined);
  assert.deepEqual(resolved.remainingQueue, []);
  const queuedMessage = resolved.session.messages.find((item) => item.guidanceQueue?.id === guidance.id);
  assert.equal(queuedMessage?.guidanceQueue?.status, 'rejected');
  assert.match(queuedMessage?.guidanceQueue?.reason ?? '', /cancel boundary|不可逆 side effect/);
});

test('failed run defers queued guidance instead of auto-replaying into another backend generation', () => {
  const guidance = createGuidanceQueueRecord('narrow the report after the current run', {
    id: 'guidance-failed-run',
    receivedAt: '2026-05-08T00:01:00.000Z',
  });
  const queued = appendRunningGuidanceRecord(session({
    messages: [message('msg-user', 'user', 'start long task', '2026-05-08T00:00:00.000Z')],
  }), guidance).session;
  const resolved = resolveGuidanceQueueAfterRun(queued, [guidance], {
    runFailed: true,
    runEndedReason: '当前 run 失败；等待用户确认。',
  });

  assert.equal(resolved.nextGuidance, undefined);
  assert.equal(resolved.remainingQueue[0]?.status, 'deferred');
  assert.match(resolved.remainingQueue[0]?.reason ?? '', /run 失败/);
  const queuedMessage = resolved.session.messages.find((item) => item.guidanceQueue?.id === guidance.id);
  assert.equal(queuedMessage?.guidanceQueue?.status, 'deferred');
  assert.equal(queuedMessage?.status, 'completed');
});

test('deferred guidance remains parked after a later successful run until the user confirms it', () => {
  const deferred = createGuidanceQueueRecord('do not replay without confirmation', {
    id: 'guidance-deferred',
    receivedAt: '2026-05-08T00:01:00.000Z',
    status: 'deferred',
    reason: 'previous run failed',
  });
  const queued = appendRunningGuidanceRecord(session({
    messages: [message('msg-user', 'user', 'start long task', '2026-05-08T00:00:00.000Z')],
  }), deferred).session;
  const resolved = resolveGuidanceQueueAfterRun(queued, [deferred]);

  assert.equal(resolved.nextGuidance, undefined);
  assert.equal(resolved.remainingQueue[0]?.status, 'deferred');
  const queuedMessage = resolved.session.messages.find((item) => item.guidanceQueue?.id === deferred.id);
  assert.equal(queuedMessage?.guidanceQueue?.status, 'deferred');
});

test('successful run only selects queued guidance and leaves deferred guidance parked', () => {
  const deferred = createGuidanceQueueRecord('old failed-run guidance', {
    id: 'guidance-old',
    receivedAt: '2026-05-08T00:01:00.000Z',
    status: 'deferred',
  });
  const queuedGuidance = createGuidanceQueueRecord('new running guidance', {
    id: 'guidance-new',
    receivedAt: '2026-05-08T00:02:00.000Z',
  });
  const queued = appendRunningGuidanceRecord(appendRunningGuidanceRecord(session(), deferred).session, queuedGuidance).session;
  const resolved = resolveGuidanceQueueAfterRun(queued, [deferred, queuedGuidance]);

  assert.equal(resolved.nextGuidance?.id, 'guidance-new');
  assert.deepEqual(resolved.remainingQueue.map((item) => item.id), ['guidance-old']);
  const newMessage = resolved.session.messages.find((item) => item.guidanceQueue?.id === queuedGuidance.id);
  const oldMessage = resolved.session.messages.find((item) => item.guidanceQueue?.id === deferred.id);
  assert.equal(newMessage?.guidanceQueue?.status, 'merged');
  assert.equal(newMessage?.guidanceQueue?.handlingRunId, 'pending-next-run');
  assert.equal(oldMessage?.guidanceQueue?.status, 'deferred');
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
  const failedRunPayload = nextPayload.runs.find((run) => run.id === failed.failedRunId);

  assert.doesNotMatch(recovered.messages.at(-1)?.content ?? '', /工作过程摘要/);
  assert.doesNotMatch(recovered.runs.at(-1)?.response ?? '', /安全中止当前 stream/);
  assert.deepEqual((recovered.runs.at(-1)?.raw as { streamProcess?: { eventSummaries?: unknown[] } }).streamProcess?.eventSummaries?.length, 1);
  assert.doesNotMatch(JSON.stringify(failedRunPayload?.raw), /最近 读取/);
  assert.doesNotMatch(JSON.stringify(failedRunPayload?.raw), /继续补充指令/);
  assert.match(String((failedRunPayload?.raw as { streamProcess?: { summaryDigest?: { hash?: string } } } | undefined)?.streamProcess?.summaryDigest?.hash ?? ''), /^fnv1a-/);
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

test('next-turn run payload omits raw background verification and WorkEvidence bodies', () => {
  const rawSentinel = `RAW_BACKGROUND_SENTINEL ${'verification body '.repeat(400)}`;
  const base = session({
    messages: [message('msg-user', 'user', 'start task', '2026-05-08T01:00:00.000Z')],
    runs: [{
      id: 'run-with-raw',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'start task',
      response: 'done',
      createdAt: '2026-05-08T01:00:00.000Z',
      completedAt: '2026-05-08T01:01:00.000Z',
      raw: {
        backgroundCompletion: {
          status: 'completed',
          lastEvent: {
            type: 'background-finalization',
            verificationResults: [{ rawProviderPayload: rawSentinel, evidenceRefs: ['file:.sciforge/verifications/raw.json'] }],
            workEvidence: [{ id: 'we-raw', kind: 'fetch', evidenceRefs: ['file:.sciforge/evidence/raw.json'], rawRef: 'file:.sciforge/evidence/raw-provider.json' }],
          },
        },
        finalResponse: { message: rawSentinel },
        workEvidence: [{ outputSummary: rawSentinel, evidenceRefs: ['file:.sciforge/evidence/root.json'] }],
      },
    }],
  });
  const nextUser = message('msg-next-raw', 'user', '继续上一轮，只列 refs', '2026-05-08T01:02:00.000Z');
  const payload = requestPayloadForTurn({ ...base, messages: [...base.messages, nextUser] }, nextUser, []);
  const serialized = JSON.stringify(payload.runs);

  assert.doesNotMatch(serialized, /RAW_BACKGROUND_SENTINEL/);
  assert.match(serialized, /run-raw-body/);
  assert.match(serialized, /raw-provider\.json/);
  assert.match(serialized, /we-raw/);
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

test('cancelled run payload carries a boundary instead of auto-resume instructions', () => {
  const cancelled = applyBackgroundCompletionEventToSession(session(), {
    contract: 'sciforge.background-completion.v1',
    type: 'background-finalization',
    runId: 'run-bg-cancel-boundary',
    stageId: 'stage-final',
    status: 'cancelled',
    prompt: 'long irreversible workspace task',
    message: '用户已取消后台任务。',
    cancellationReason: 'user requested cancel',
    completedAt: '2026-05-08T01:12:00.000Z',
  });
  const nextUser = message('msg-after-cancel', 'user', '继续上一轮', '2026-05-08T01:13:00.000Z');
  const payload = requestPayloadForTurn({ ...cancelled, messages: [...cancelled.messages, nextUser] }, nextUser, []);
  const raw = payload.runs[0]?.raw as { cancelBoundary?: { reason?: string; sideEffectPolicy?: string; nextStep?: string } };

  assert.equal(raw.cancelBoundary?.reason, 'user-cancelled');
  assert.equal(raw.cancelBoundary?.sideEffectPolicy, 'do-not-auto-resume');
  assert.match(raw.cancelBoundary?.nextStep ?? '', /Ask the user to confirm/);
  assert.match(raw.cancelBoundary?.nextStep ?? '', /do not automatically resume irreversible side effects/);
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
