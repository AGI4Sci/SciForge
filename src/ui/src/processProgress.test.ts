import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROCESS_PROGRESS_EVENT_TYPE,
  PROCESS_PROGRESS_PHASE,
  PROCESS_PROGRESS_REASON,
  PROCESS_PROGRESS_STATUS,
  buildSilentStreamDecisionRecord,
} from '@sciforge-ui/runtime-contract';
import type { AgentStreamEvent } from './domain';
import { buildInitialResponseProgressEvent, buildRequestAcceptedProgressEvent, buildSilentStreamProgressEvent, formatProgressHeadline, progressModelFromEvent, silentStreamWaitThresholdMs } from './processProgress';

function event(partial: Partial<AgentStreamEvent>): AgentStreamEvent {
  return {
    id: partial.id ?? `evt-${partial.type ?? 'test'}`,
    type: partial.type ?? 'event',
    label: partial.label ?? partial.type ?? 'event',
    createdAt: partial.createdAt ?? '2026-05-02T00:00:00.000Z',
    ...partial,
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
