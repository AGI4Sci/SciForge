import assert from 'node:assert/strict';

import type { RuntimeArtifact, RuntimeExecutionUnit, SciForgeMessage, SciForgeRun, SciForgeSession } from '../../src/ui/src/domain.js';
import { sendSciForgeToolMessage } from '../../src/ui/src/api/sciforgeToolsClient.js';
import {
  appendRunningGuidanceRecord,
  createGuidanceQueueRecord,
  requestPayloadForTurn,
  updateGuidanceQueueRecords,
} from '../../src/ui/src/app/chat/sessionTransforms.js';

const originalFetch = globalThis.fetch;

try {
  const firstUser = message('msg-1', 'user', '生成 evidence matrix', '2026-05-09T00:00:00.000Z');
  const firstAssistant = message('msg-2', 'scenario', '已生成 evidence matrix artifact。', '2026-05-09T00:01:00.000Z');
  const failedUnit: RuntimeExecutionUnit = {
    id: 'unit-failed',
    tool: 'python',
    params: 'python tasks/filter_matrix.py --input matrix.csv',
    status: 'failed-with-reason',
    hash: 'hash-failed',
    codeRef: '.sciforge/tasks/filter_matrix.py',
    stdoutRef: '.sciforge/task-results/filter.stdout.txt',
    stderrRef: '.sciforge/task-results/filter.stderr.txt',
    outputRef: '.sciforge/task-results/filter.output.json',
    failureReason: 'Missing required column: confidence_score',
    recoverActions: ['Map confidence_score to confidence or provide a replacement column.'],
    nextStep: 'Ask the user for a column mapping, then rerun the filter stage.',
  };
  const matrixArtifact: RuntimeArtifact = {
    id: 'artifact-evidence-matrix',
    type: 'evidence-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    path: '.sciforge/artifacts/evidence-matrix.json',
    dataRef: '.sciforge/artifacts/evidence-matrix.json',
    data: { rows: Array.from({ length: 160 }, (_, index) => ({ id: index, evidence: 'large inline evidence row' })) },
    metadata: { title: 'Evidence matrix', rowCount: 160 },
  };
  const failedRun: SciForgeRun = {
    id: 'run-failed',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: '只保留高置信度机制证据',
    response: '缺少 confidence_score，无法筛选。',
    createdAt: '2026-05-09T00:02:00.000Z',
    raw: {
      streamProcess: {
        eventCount: 25,
        summary: '失败原因：Missing required column: confidence_score。下一步：补充列映射。',
        events: Array.from({ length: 25 }, (_, index) => ({ label: `event-${index}`, detail: 'large event detail' })),
      },
    },
  };
  const baseSession = session({
    messages: [firstUser, firstAssistant],
    artifacts: [matrixArtifact],
    executionUnits: [failedUnit],
    runs: [failedRun],
  });
  const guidance = createGuidanceQueueRecord('不要覆盖原始 evidence matrix，只生成修复后的新 revision。', {
    id: 'guidance-1',
    activeRunId: failedRun.id,
    receivedAt: '2026-05-09T00:03:00.000Z',
  });
  const queued = appendRunningGuidanceRecord(baseSession, guidance).session;
  const mergedGuidance = updateGuidanceQueueRecords(queued, [guidance.id], {
    status: 'merged',
    reason: '当前 run 已结束，下一轮应带入该约束。',
    handlingRunId: 'run-repair',
  });
  const nextUser = message('msg-next', 'user', '继续刚才失败的筛选，我把 confidence_score 映射为 confidence。', '2026-05-09T00:04:00.000Z');
  const payload = requestPayloadForTurn({
    ...mergedGuidance,
    messages: [...mergedGuidance.messages, nextUser],
  }, nextUser, []);

  assert.equal(payload.artifacts[0]?.data, undefined);
  assert.match(JSON.stringify(payload.runs[0]?.raw), /Missing required column/);
  assert.doesNotMatch(JSON.stringify(payload.runs[0]?.raw), /event-24/);
  assert.match(payload.messages.map((item) => item.content).join('\n'), /不要覆盖原始 evidence matrix/);

  let handoff: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    handoff = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return streamResponse([
      {
        event: {
          type: 'text-delta',
          label: '生成内容',
          detail: '正在基于上一轮失败原因和 guidance 生成修复计划。',
        },
      },
      {
        result: {
          message: '已基于 confidence 映射修复筛选，并生成新的 evidence matrix revision。',
          executionUnits: [{ id: 'unit-repair', status: 'done', tool: 'python' }],
          artifacts: [{
            id: 'artifact-evidence-matrix-revision',
            type: 'evidence-matrix',
            schemaVersion: '1',
            data: { markdown: 'revision complete' },
          }],
        },
      },
    ]);
  }) as typeof fetch;

  await sendSciForgeToolMessage({
    sessionId: mergedGuidance.sessionId,
    scenarioId: 'literature-evidence-review',
    agentName: 'Literature',
    agentDomain: 'literature',
    prompt: nextUser.content,
    references: [],
    roleView: 'researcher',
    messages: payload.messages,
    artifacts: payload.artifacts,
    executionUnits: payload.executionUnits,
    runs: payload.runs,
    config: {
      schemaVersion: 1,
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
      workspacePath: '/tmp/sciforge-complex-multiturn',
      agentBackend: 'codex',
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
      requestTimeoutMs: 60_000,
      maxContextWindowTokens: 200_000,
      visionAllowSharedSystemInput: true,
      updatedAt: '2026-05-09T00:00:00.000Z',
    },
    availableComponentIds: [],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.literature-evidence-review.default',
    uiPlanRef: 'ui-plan.literature-evidence-review.default',
  }, {});

  assert.ok(handoff);
  const bodyText = JSON.stringify(handoff);
  assert.match(bodyText, /artifact-evidence-matrix/);
  assert.match(bodyText, /Missing required column: confidence_score/);
  assert.match(bodyText, /不要覆盖原始 evidence matrix/);
  assert.match(bodyText, /confidence_score 映射为 confidence/);
  assert.doesNotMatch(bodyText, /large inline evidence row/);
  assert.doesNotMatch(bodyText, /event-24/);
  console.log('complex multiturn chat regression smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}

function message(id: string, role: SciForgeMessage['role'], content: string, createdAt: string): SciForgeMessage {
  return { id, role, content, createdAt, status: 'completed' };
}

function session(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-complex-multiturn',
    scenarioId: 'literature-evidence-review',
    title: '复杂多轮回归',
    createdAt: '2026-05-09T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}

function streamResponse(items: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const item of items) controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}
