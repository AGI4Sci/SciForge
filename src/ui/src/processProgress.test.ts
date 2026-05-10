import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROCESS_PROGRESS_EVENT_TYPE,
  PROCESS_PROGRESS_PHASE,
  PROCESS_PROGRESS_REASON,
  PROCESS_PROGRESS_STATUS,
  CLARIFICATION_NEEDED_EVENT_TYPE,
  GUIDANCE_QUEUED_EVENT_TYPE,
  HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
  INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
  RUN_CANCELLED_EVENT_TYPE,
  buildSilentStreamDecisionRecord,
} from '@sciforge-ui/runtime-contract';
import type { AgentStreamEvent } from './domain';
import { normalizeWorkspaceRuntimeEvent } from './api/sciforgeToolsClient/runtimeEvents';
import { buildInitialResponseProgressEvent, buildRequestAcceptedProgressEvent, buildSilentStreamProgressEvent, formatProgressHeadline, latestProgressModelFromCompactTrace, progressModelFromEvent, progressModelsFromCompactTrace, silentStreamWaitThresholdMs } from './processProgress';

function event(partial: Partial<AgentStreamEvent>): AgentStreamEvent {
  return {
    id: partial.id ?? `evt-${partial.type ?? 'test'}`,
    type: partial.type ?? 'event',
    label: partial.label ?? partial.type ?? 'event',
    createdAt: partial.createdAt ?? '2026-05-02T00:00:00.000Z',
    ...partial,
  };
}

function compactInteractionEvent(type: string, label: string, detailLines: string[]) {
  return {
    type,
    label,
    detail: detailLines.join('\n'),
    createdAt: '2026-05-08T00:01:00.000Z',
    prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
    scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE retrieval repair blocked',
    message: 'NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE search write failed approval',
  };
}

test('normalizes Python process-progress events into visible work model', () => {
  const progressEvent = event({
    type: PROCESS_PROGRESS_EVENT_TYPE,
    label: '过程',
    detail: '正在等待 AgentServer 返回',
    raw: {
      type: PROCESS_PROGRESS_EVENT_TYPE,
      progress: {
        phase: PROCESS_PROGRESS_PHASE.WAIT,
        title: '正在等待 AgentServer 返回',
        detail: 'HTTP stream still waiting.',
        reading: ['/workspace/input/papers.csv'],
        writing: ['/workspace/tasks/review.py'],
        waitingFor: 'AgentServer 返回',
        nextStep: '收到新事件后继续执行。',
      },
    },
  });

  const model = progressModelFromEvent(progressEvent);
  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.WAIT);
  assert.deepEqual(model?.reading, ['/workspace/input/papers.csv']);
  assert.deepEqual(model?.writing, ['/workspace/tasks/review.py']);
  assert.match(formatProgressHeadline(model) ?? '', /下一步 收到新事件后继续执行/);
});

test('builds generic waiting progress after 5s without new backend events and keeps last real event', () => {
  const silent = buildSilentStreamProgressEvent({
    events: [
      event({ type: 'queued', label: '已提交', detail: 'run', createdAt: '2026-05-08T00:00:00.000Z' }),
      event({ type: 'tool-call', label: '读取', detail: '正在读取 /workspace/input/papers.csv', createdAt: '2026-05-08T00:00:10.000Z' }),
    ],
    nowMs: Date.parse('2026-05-08T00:00:16.000Z'),
    backend: 'agentserver',
  });

  const model = silent ? progressModelFromEvent(silent) : undefined;
  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.WAIT);
  assert.equal(model?.reason, PROCESS_PROGRESS_REASON.BACKEND_WAITING);
  assert.equal(model?.waitingFor, '后端返回新事件');
  assert.equal(model?.lastEvent?.label, '读取');
  assert.equal(model?.canAbort, true);
  assert.equal(model?.canContinue, true);
  assert.match(formatProgressHeadline(model) ?? '', /最近 读取/);
});

test('builds generic waiting progress after 5s without any real backend event', () => {
  const silent = buildSilentStreamProgressEvent({
    events: [
      event({ type: 'queued', label: '已提交', detail: 'run', createdAt: '2026-05-08T00:00:00.000Z' }),
    ],
    nowMs: Date.parse('2026-05-08T00:00:06.000Z'),
  });

  const model = silent ? progressModelFromEvent(silent) : undefined;
  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.WAIT);
  assert.equal(model?.lastEvent, undefined);
  assert.match(model?.detail ?? '', /尚无可展示的后端事件/);
  assert.match(model?.nextStep ?? '', /中止当前 stream/);
});

test('does not show backend waiting before the silent threshold', () => {
  const silent = buildSilentStreamProgressEvent({
    events: [
      event({ type: 'tool-call', label: '读取', detail: '正在读取 file', createdAt: '2026-05-08T00:00:10.000Z' }),
    ],
    nowMs: Date.parse('2026-05-08T00:00:14.000Z'),
  });

  assert.equal(silent, undefined);
});

test('uses harness silence policy before falling back to generic waiting threshold', () => {
  const events = [
    event({
      type: 'agent-harness-contract',
      label: 'Harness',
      detail: 'contract evaluated',
      createdAt: '2026-05-08T00:00:00.000Z',
      raw: {
        contract: {
          progressPlan: {
            silenceTimeoutMs: 5_000,
            silencePolicy: {
              timeoutMs: 12_000,
              decision: 'visible-status',
              maxRetries: 1,
            },
          },
        },
      },
    }),
    event({ type: 'tool-call', label: '读取', detail: '正在读取 file', createdAt: '2026-05-08T00:00:10.000Z' }),
  ];

  assert.equal(silentStreamWaitThresholdMs(events), 12_000);
  assert.equal(buildSilentStreamProgressEvent({
    events,
    nowMs: Date.parse('2026-05-08T00:00:17.000Z'),
  }), undefined);

  const silent = buildSilentStreamProgressEvent({
    events,
    nowMs: Date.parse('2026-05-08T00:00:23.000Z'),
  });
  const raw = silent?.raw as { thresholdMs?: number; silencePolicy?: { decision?: string; maxRetries?: number } } | undefined;
  assert.equal(raw?.thresholdMs, 12_000);
  assert.equal(raw?.silencePolicy?.decision, 'visible-status');
  assert.equal(raw?.silencePolicy?.maxRetries, 1);
});

test('silent waiting progress reuses transport silent decision record for the same run', () => {
  const transportDecision = buildSilentStreamDecisionRecord({
    runId: 'session-a:turn-silent',
    source: 'ui.transport.silenceWatchdog',
    layer: 'transport-watchdog',
    decision: 'retry',
    timeoutMs: 8_000,
    elapsedMs: 8_500,
    detail: 'transport retry after silent stream',
  });
  const silent = buildSilentStreamProgressEvent({
    events: [
      event({ type: 'queued', label: '已提交', detail: 'run', createdAt: '2026-05-08T00:00:00.000Z' }),
      event({
        type: 'backend-silent',
        label: '项目工具',
        detail: '后端 8s 没有输出新事件',
        createdAt: '2026-05-08T00:00:08.000Z',
        raw: {
          type: 'backend-silent',
          silentStreamDecision: transportDecision,
        },
      }),
    ],
    nowMs: Date.parse('2026-05-08T00:00:17.000Z'),
    runId: 'session-a:turn-silent',
  });
  const raw = silent?.raw as { silentStreamDecision?: { decisionId?: string; layers?: string[] } } | undefined;
  assert.equal(raw?.silentStreamDecision?.decisionId, transportDecision.decisionId);
  assert.deepEqual(raw?.silentStreamDecision?.layers, ['transport-watchdog', 'ui-progress']);
});

test('builds immediate request accepted progress before backend stream starts', () => {
  const progress = buildRequestAcceptedProgressEvent('继续上一轮，修复缺失的验证并给出结果');
  const model = progressModelFromEvent(progress);

  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.PLAN);
  assert.equal(progress.type, PROCESS_PROGRESS_EVENT_TYPE);
  assert.equal(model?.reason, PROCESS_PROGRESS_REASON.REQUEST_ACCEPTED_BEFORE_BACKEND_STREAM);
  assert.equal(model?.waitingFor, 'workspace runtime 首个事件');
  assert.match(model?.detail ?? '', /继续上一轮/);
});

test('builds visible quick status from responsePlan without waiting for workspace completion', () => {
  const progress = buildInitialResponseProgressEvent({
    initialResponseMode: 'quick-status',
    userVisibleProgress: [PROCESS_PROGRESS_PHASE.PLAN, PROCESS_PROGRESS_PHASE.EXECUTE, 'emit'],
  });

  const model = progress ? progressModelFromEvent(progress) : undefined;
  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.PLAN);
  assert.equal(model?.status, PROCESS_PROGRESS_STATUS.RUNNING);
  assert.match(model?.detail ?? '', /已收到请求/);
  assert.equal(model?.nextStep, PROCESS_PROGRESS_PHASE.PLAN);
});

test('builds direct-context visible status from responsePlan', () => {
  const progress = buildInitialResponseProgressEvent({
    initialResponseMode: 'direct-context-answer',
    userVisibleProgress: ['answer'],
  });

  const model = progress ? progressModelFromEvent(progress) : undefined;
  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.READ);
  assert.equal(model?.waitingFor, undefined);
  assert.match(formatProgressHeadline(model) ?? '', /正在整理当前上下文/);
});

test('maps structured interaction contract events into process progress without prompt or scenario semantics', () => {
  const normalized = normalizeWorkspaceRuntimeEvent({
    schemaVersion: INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
    type: HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
    phase: 'verification',
    status: 'blocked',
    importance: 'blocking',
    reason: 'side-effect-policy',
    interaction: {
      id: 'approval-1',
      kind: 'human-approval',
      required: true,
    },
    prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
    scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE retrieval repair blocked',
    message: 'NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE search write failed approval',
  });

  const model = progressModelFromEvent(normalized);
  const headline = formatProgressHeadline(model);

  assert.equal(normalized.type, HUMAN_APPROVAL_REQUIRED_EVENT_TYPE);
  assert.equal(normalized.label, '需要确认');
  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.OBSERVE);
  assert.equal(model?.status, PROCESS_PROGRESS_STATUS.RUNNING);
  assert.equal(model?.waitingFor, '人工确认');
  assert.match(model?.detail ?? '', /Interaction: human-approval required/);
  assert.doesNotMatch(normalized.detail ?? '', /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(normalized.detail ?? '', /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(normalized.detail ?? '', /NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(headline ?? '', /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
});

test('maps structured run cancellation into process progress cancellation status', () => {
  const normalized = normalizeWorkspaceRuntimeEvent({
    schemaVersion: INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
    type: RUN_CANCELLED_EVENT_TYPE,
    phase: 'run',
    status: 'cancelled',
    cancellationReason: 'system-aborted',
    reason: 'network abort',
  });

  const model = progressModelFromEvent(normalized);
  assert.equal(model?.title, '运行取消');
  assert.equal(model?.status, PROCESS_PROGRESS_STATUS.CANCELLED);
  assert.equal(model?.nextStep, '运行已结束，保留结构化终止原因供下一轮恢复或审计。');
  assert.match(model?.detail ?? '', /Cancellation: system-aborted/);
});

test('restores compact interaction progress streamProcess events without prompt or scenario semantics', () => {
  const models = progressModelsFromCompactTrace({
    runs: [{
      id: 'run-interactions',
      raw: {
        streamProcess: {
          eventCount: 4,
          events: [
            compactInteractionEvent(CLARIFICATION_NEEDED_EVENT_TYPE, '需要澄清', [
              'Phase: interaction',
              'Status: blocked',
              'Reason: missing-study-scope',
              'Interaction: clarification required',
            ]),
            compactInteractionEvent(HUMAN_APPROVAL_REQUIRED_EVENT_TYPE, '需要确认', [
              'Phase: verification',
              'Status: blocked',
              'Reason: side-effect-policy',
              'Interaction: human-approval required',
            ]),
            compactInteractionEvent(GUIDANCE_QUEUED_EVENT_TYPE, '引导已排队', [
              'Phase: interaction',
              'Status: running',
              'Reason: backend run is active',
              'Interaction: guidance optional',
            ]),
            compactInteractionEvent(RUN_CANCELLED_EVENT_TYPE, '运行取消', [
              'Phase: run',
              'Status: cancelled',
              'Reason: user interrupt',
              'Cancellation: user-aborted',
            ]),
          ],
        },
      },
    }],
  });

  assert.deepEqual(models.map((model) => model.title), ['需要澄清', '需要确认', '引导已排队', '运行取消']);
  assert.equal(models[0].waitingFor, '澄清信息');
  assert.equal(models[1].waitingFor, '人工确认');
  assert.equal(models[2].waitingFor, '当前 run 结束后合并引导');
  assert.equal(models[3].status, PROCESS_PROGRESS_STATUS.CANCELLED);
  const visible = models.map((model) => formatProgressHeadline(model) || model.detail).join('\n');
  assert.doesNotMatch(visible, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visible, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(visible, /NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE/);
});

test('recovers latest progress model from compact stream process events without the React event array', () => {
  const model = latestProgressModelFromCompactTrace({
    streamProcess: {
      eventCount: 2,
      events: [
        {
          type: 'tool-call',
          label: '读取',
          detail: '正在读取 /workspace/input/papers.csv',
          createdAt: '2026-05-08T00:00:10.000Z',
        },
        {
          type: PROCESS_PROGRESS_EVENT_TYPE,
          label: '等待',
          detail: '正在等待后端返回新事件 · 最近 读取: 正在读取 /workspace/input/papers.csv · 下一步 收到新事件后继续执行；也可以安全中止当前 stream 或继续补充指令排队。',
          createdAt: '2026-05-08T00:01:05.000Z',
        },
      ],
    },
  });

  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.WAIT);
  assert.equal(model?.reason, PROCESS_PROGRESS_REASON.BACKEND_WAITING);
  assert.equal(model?.lastEvent?.label, '读取');
  assert.match(model?.nextStep ?? '', /收到新事件后继续执行/);
  assert.equal(model?.canAbort, true);
  assert.equal(model?.canContinue, true);
});

test('recovers latest progress model from compact session history summary after events are omitted', () => {
  const model = latestProgressModelFromCompactTrace({
    runs: [{
      id: 'run-failed',
      raw: {
        streamProcess: {
          eventCount: 40,
          summary: [
            '工作过程摘要:',
            '- 读取: 正在读取 · 读 /workspace/input/papers.csv',
            '- 等待: 正在等待后端返回新事件 · 等 后端返回新事件 · 最近 读取: 正在读取 /workspace/input/papers.csv · 下一步 收到新事件后继续执行；也可以安全中止当前 stream 或继续补充指令排队。',
          ].join('\n'),
        },
      },
    }],
  });

  assert.equal(model?.phase, PROCESS_PROGRESS_PHASE.WAIT);
  assert.equal(model?.waitingFor, '后端返回新事件');
  assert.equal(model?.lastEvent?.detail, '正在读取 /workspace/input/papers.csv');
  assert.match(formatProgressHeadline(model) ?? '', /最近 读取/);
});
